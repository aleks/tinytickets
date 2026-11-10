package app

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const workLogInstructions = " Keep the description as the task specification. Use add_work_log for progress, decisions, blockers, verification and commit links instead of repeatedly rewriting descriptions. Use get_ticket_work_log to read prior context in append order. Use create_review_handoff with summary and honest verification results (optional references/review_notes) when handing work to a reviewer; it atomically saves the handoff and moves to ready_for_review. Log entries are append-only: append corrections. Optional author labels are not authenticated identity or ownership. Notes do not change status/timers; another handoff while already in review preserves its timer. Logs remain readable/writable for archived tickets and are removed only with ticket deletion."

func (a *App) addWorkLogTools(s *mcp.Server) {
	addTool(s, "get_ticket_work_log", "Read a ticket's notes and review handoffs together, oldest append first (stable ID order). Includes archived tickets. Entries are append-only and author labels are informational, not authenticated identities.", func(ctx context.Context, in struct {
		TicketID int64 `json:"ticket_id"`
	}) (WorkLogResult, error) {
		return a.Store.TicketWorkLog(ctx, in.TicketID)
	})
	addTool(s, "add_work_log", "Append a Markdown progress note, decision, blocker, test result or commit link without rewriting the ticket specification. Does not change status, updated_at or current-column timer. Entries cannot be edited/deleted independently; append a correction instead.", func(ctx context.Context, in struct {
		TicketID int64  `json:"ticket_id"`
		Body     string `json:"body"`
		Author   string `json:"author,omitempty" jsonschema:"Optional informational label, not authenticated identity"`
	}) (WorkLogEntry, error) {
		return a.AddWorkLog(ctx, in.TicketID, WorkLogNoteInput{Body: in.Body, Author: in.Author})
	})
	addTool(s, "create_review_handoff", "Append a structured review handoff and atomically move the ticket to ready_for_review. Require summary and verification (state failures/not-run checks honestly); optionally include Markdown commit/artifact references and review_notes. Preserves the original description. Already in review: append without resetting the column timer. Does not enforce dependency readiness or ownership.", func(ctx context.Context, in struct {
		TicketID     int64  `json:"ticket_id"`
		Summary      string `json:"summary"`
		Verification string `json:"verification"`
		References   string `json:"references,omitempty"`
		ReviewNotes  string `json:"review_notes,omitempty"`
		Author       string `json:"author,omitempty" jsonschema:"Optional informational label, not authenticated identity"`
	}) (ReviewHandoffResult, error) {
		return a.CreateReviewHandoff(ctx, in.TicketID, ReviewHandoffInput{Summary: in.Summary, Verification: in.Verification, References: in.References, ReviewNotes: in.ReviewNotes, Author: in.Author})
	})
}
