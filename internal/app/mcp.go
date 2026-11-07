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
	s := mcp.NewServer(&mcp.Implementation{Name: "tinytickets", Version: "1.0.0"}, &mcp.ServerOptions{Instructions: "TinyTickets organizes projects > epics > tickets. Every epic needs a project and every ticket needs an epic. Statuses: todo, in_progress, ready_for_review, done. A link's blocker_id blocks its blocked_id. Completed epics are hidden from the home overview, not deleted. Use get_workspace to discover IDs and links. Descriptions are plain text. Dependencies are informational and do not prevent moving tickets."})
	addTool(s, "get_workspace", "List all projects, epics (including completed), tickets, and directed dependency links.", func(ctx context.Context, _ struct{}) (State, error) { return a.Store.Snapshot(ctx) })
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
	addTool(s, "update_epic", "Rename, move, complete, or reopen an epic. Omitted fields remain unchanged.", func(ctx context.Context, in struct {
		ID        int64   `json:"id"`
		Title     *string `json:"title,omitempty"`
		ProjectID *int64  `json:"project_id,omitempty"`
		Completed *bool   `json:"completed,omitempty"`
	}) (any, error) {
		return a.Mutate(ctx, "epics", "update", in.ID, Input{Title: in.Title, ProjectID: in.ProjectID, Completed: in.Completed})
	})
	addTool(s, "create_ticket", "Create a ticket in an epic. Status defaults to todo.", func(ctx context.Context, in struct {
		EpicID      int64   `json:"epic_id"`
		Title       string  `json:"title"`
		Description *string `json:"description,omitempty"`
		Status      *string `json:"status,omitempty" jsonschema:"todo, in_progress, ready_for_review, or done"`
	}) (any, error) {
		return a.Mutate(ctx, "tickets", "create", 0, Input{EpicID: &in.EpicID, Title: &in.Title, Description: in.Description, Status: in.Status})
	})
	addTool(s, "update_ticket", "Edit a ticket, move it between columns, or assign another epic. Omitted fields remain unchanged.", func(ctx context.Context, in struct {
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
