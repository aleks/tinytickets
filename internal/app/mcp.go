package app

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func addTool[In, Out any](s *mcp.Server, name, description string, fn func(context.Context, In) (Out, error)) {
	mcp.AddTool(s, &mcp.Tool{Name: name, Description: description}, func(ctx context.Context, _ *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		out, err := fn(ctx, in)
		return nil, out, err
	})
}

func (a *App) newMCP() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "tinytickets", Version: "1.0.0"}, &mcp.ServerOptions{Instructions: "TinyTickets organizes projects > epics > tickets. Every epic needs a project and every ticket needs an epic. Statuses: todo, in_progress, ready_for_review, done. A link's blocker_id blocks its blocked_id. Completed epics are hidden from the home overview, not deleted. Only completed epics may be archived; unarchive before reopening. Archived work keeps tickets, history, direct links, and aggregate metrics but is hidden from ordinary listings. get_workspace is a complete snapshot including archives; inspect archived flags when listing epics. Use update_epic archived:true/false to archive/restore. Descriptions accept Markdown, including fenced mermaid diagrams, rendered on full ticket pages. Dependencies are informational for ordinary updates. Before starting new work, use claim_next_ticket or claim_ticket, not separate reads and update_ticket(status:in_progress). get_ready_tickets is read-only discovery, not a reservation. Claims atomically require todo, an unfinished/unarchived epic, and every blocker done (including cross-project). If a specific claim fails, refresh and choose again; claimed:false means no ready work in scope. Use update_ticket for edits/subsequent transitions. Claiming starts history/timers but adds no ownership lock, lease, or automatic reassignment; ordinary updates and drag/drop remain supported." + workLogInstructions})
	addTool(s, "get_workspace", "Read the complete hierarchy-consistent workspace, including completed/archived epics and all their tickets and links. Check each epic's archived flag when building ordinary listings. Use update_epic with archived:false to restore archived work.", func(ctx context.Context, _ struct{}) (State, error) { return a.Store.Snapshot(ctx) })
	a.addWorkLogTools(s)
	addTool(s, "get_ready_tickets", "Read ready work, oldest-created first (ID breaks ties). Ready means todo, unfinished/unarchived epic, and all blockers done including cross-project blockers. Optional project_id/epic_id scope. This is a planning snapshot, not a reservation: use claim_ticket or claim_next_ticket before starting.", a.Store.ReadyTickets)
	addTool(s, "claim_next_ticket", "Atomically select the oldest ready ticket and move it to in_progress. Use before starting new work; prevents concurrent claimers taking the same todo ticket across processes. Optional project_id/epic_id scope. Returns claimed:false, ticket:null when no ready work exists. Starts status history/current-column timer; no owner lock or lease.", func(ctx context.Context, in ReadyFilter) (ClaimResult, error) { return a.ClaimTicket(ctx, in, nil) })
	addTool(s, "claim_ticket", "Atomically recheck a chosen ticket's readiness and move it to in_progress. Use before starting work, even after get_ready_tickets. Fails if missing or no longer ready; refresh and choose again. No owner lock or lease; ordinary updates remain compatible.", func(ctx context.Context, in struct {
		TicketID int64 `json:"ticket_id"`
	}) (ClaimResult, error) {
		return a.ClaimTicket(ctx, ReadyFilter{}, &in.TicketID)
	})
	addTool(s, "get_ticket_history", "Read automatically recorded creation/status events in order. A baseline means earlier history is unavailable, not that work started at that time. No-op updates do not create events.", func(ctx context.Context, in struct {
		TicketID int64 `json:"ticket_id"`
	}) (TicketHistoryResult, error) {
		events, err := a.Store.TicketHistory(ctx, in.TicketID)
		return historyResult(in.TicketID, events), err
	})
	addTool(s, "get_project_execution", "Read project execution timelines and metrics. Archived epics are omitted from rows but remain in totals, timing samples, and throughput; epics_archived reports their count. Status changes record time automatically; unknown starts are excluded from cycle/age samples. Throughput counts first observed completion once per ticket, attributed to its current project.", func(ctx context.Context, in struct {
		ProjectID int64 `json:"project_id"`
	}) (ProjectExecution, error) {
		return a.Store.ProjectExecution(ctx, in.ProjectID)
	})
	addTool(s, "create_project", "Create a project.", func(ctx context.Context, in struct {
		Name string `json:"name" jsonschema:"Project name"`
	}) (any, error) {
		return a.Mutate(ctx, "projects", "create", 0, Input{Name: &in.Name})
	})
	addTool(s, "update_project", "Rename a project.", func(ctx context.Context, in struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}) (any, error) {
		return a.Mutate(ctx, "projects", "update", in.ID, Input{Name: &in.Name})
	})
	addTool(s, "create_epic", "Create an epic in a project.", func(ctx context.Context, in struct {
		ProjectID int64  `json:"project_id"`
		Title     string `json:"title"`
	}) (any, error) {
		return a.Mutate(ctx, "epics", "create", 0, Input{ProjectID: &in.ProjectID, Title: &in.Title})
	})
	addTool(s, "update_epic", "Rename, move, complete, reopen, archive, or unarchive an epic. Only completed epics can be archived. Unarchive before reopening; a combined archived:false, completed:false update is valid. Archiving preserves tickets/history/direct links. Omitted fields remain unchanged.", func(ctx context.Context, in struct {
		ID        int64   `json:"id"`
		Title     *string `json:"title,omitempty"`
		ProjectID *int64  `json:"project_id,omitempty"`
		Completed *bool   `json:"completed,omitempty"`
		Archived  *bool   `json:"archived,omitempty"`
	}) (any, error) {
		return a.Mutate(ctx, "epics", "update", in.ID, Input{Title: in.Title, ProjectID: in.ProjectID, Completed: in.Completed, Archived: in.Archived})
	})
	addTool(s, "create_ticket", "Create a ticket in an epic. Status defaults to todo. For new agent work, create as todo then use claim_ticket before starting.", func(ctx context.Context, in struct {
		EpicID      int64   `json:"epic_id"`
		Title       string  `json:"title"`
		Description *string `json:"description,omitempty"`
		Status      *string `json:"status,omitempty" jsonschema:"todo, in_progress, ready_for_review, or done"`
	}) (any, error) {
		return a.Mutate(ctx, "tickets", "create", 0, Input{EpicID: &in.EpicID, Title: &in.Title, Description: in.Description, Status: in.Status})
	})
	addTool(s, "update_ticket", "Edit a ticket, make subsequent status changes, or assign another epic. Before starting new work prefer claim_ticket/claim_next_ticket, not separate reads and status updates. This compatibility operation does not enforce readiness or ownership. Omitted fields remain unchanged.", func(ctx context.Context, in struct {
		ID          int64   `json:"id"`
		EpicID      *int64  `json:"epic_id,omitempty"`
		Title       *string `json:"title,omitempty"`
		Description *string `json:"description,omitempty"`
		Status      *string `json:"status,omitempty" jsonschema:"todo, in_progress, ready_for_review, or done"`
	}) (any, error) {
		return a.Mutate(ctx, "tickets", "update", in.ID, Input{EpicID: in.EpicID, Title: in.Title, Description: in.Description, Status: in.Status})
	})
	type linkInput struct {
		BlockerID int64 `json:"blocker_id" jsonschema:"The ticket that blocks the other"`
		BlockedID int64 `json:"blocked_id" jsonschema:"The ticket that is blocked"`
	}
	addTool(s, "link_tickets", "Add a dependency: blocker_id blocks blocked_id. Rejects self-links and dependency cycles. Idempotent.", func(ctx context.Context, in linkInput) (any, error) {
		return a.Mutate(ctx, "links", "create", 0, Input{BlockerID: in.BlockerID, BlockedID: in.BlockedID})
	})
	addTool(s, "unlink_tickets", "Remove a directed dependency. Idempotent.", func(ctx context.Context, in linkInput) (any, error) {
		return a.Mutate(ctx, "links", "delete", 0, Input{BlockerID: in.BlockerID, BlockedID: in.BlockedID})
	})
	type idInput struct {
		ID int64 `json:"id"`
	}
	addTool(s, "delete_ticket", "Permanently delete a ticket and its dependency links.", func(ctx context.Context, in idInput) (any, error) {
		return a.Mutate(ctx, "tickets", "delete", in.ID, Input{})
	})
	addTool(s, "delete_epic", "Delete an empty epic. Move or delete its tickets first; use update_epic to mark it completed instead.", func(ctx context.Context, in idInput) (any, error) {
		return a.Mutate(ctx, "epics", "delete", in.ID, Input{})
	})
	addTool(s, "delete_project", "Delete an empty project. Move or delete its epics first.", func(ctx context.Context, in idInput) (any, error) {
		return a.Mutate(ctx, "projects", "delete", in.ID, Input{})
	})
	return s
}
