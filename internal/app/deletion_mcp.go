package app

import (
	"context"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const deletionInstructions = " Before deleting, use get_deletion_preview to review permanent impact, including archived work, notes, history and dependency links. Nonempty parents require explicit force:true and the preview confirmation_token; force defaults false. Force always requires a token. Any supplied token is atomically revalidated; if impact changed, fetch a new preview and confirm again. External linked tickets survive but their dependency links are removed. Prefer completing/archiving work to permanent deletion."

func (a *App) addDeletionTools(s *mcp.Server) {
	addTool(s, "get_deletion_preview", "Preview permanent deletion without changes. kind must be projects, epics, or tickets. Counts epics/tickets are descendants; ticket notes/history/links include the root. external_dependency_links touch one surviving ticket outside the chosen scope, even in the same project. Review counts and retain confirmation_token for delete; changed impact invalidates it.", func(ctx context.Context, in struct {
		Kind string `json:"kind"`
		ID   int64  `json:"id"`
	}) (DeletionPreview, error) {
		return a.Store.DeletionPreview(ctx, in.Kind, in.ID)
	})
	type deleteInput struct {
		ID                int64   `json:"id"`
		Force             bool    `json:"force,omitempty"`
		ConfirmationToken *string `json:"confirmation_token,omitempty"`
	}
	for _, item := range []struct{ name, kind string }{{"delete_project", "projects"}, {"delete_epic", "epics"}, {"delete_ticket", "tickets"}} {
		addTool(s, item.name, "Permanently delete the selected item. Empty parents and tickets may be deleted without force; nonempty parents require force:true and current confirmation_token. Includes all archived/completed descendants, notes, handoffs, status history, and incident links in one atomic operation; never deletes external linked tickets. force requires a nonempty valid token; any provided token is revalidated. On changed impact, preview and confirm again.", func(ctx context.Context, in deleteInput) (any, error) {
			return a.Delete(ctx, item.kind, in.ID, DeleteOptions{Force: in.Force, ConfirmationToken: in.ConfirmationToken})
		})
	}
}
