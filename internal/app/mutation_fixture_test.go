package app

import "context"

// Compact fixture adapter for the existing table-driven integration tests.
// Production transports use only resource-specific typed operations.
type Input struct {
	Name        *string
	Title       *string
	Description *string
	ProjectID   *int64
	EpicID      *int64
	Status      *string
	Completed   *bool
	Archived    *bool
	BlockerID   int64
	BlockedID   int64
}

func (s *Store) Mutate(ctx context.Context, kind, action string, id int64, in Input) (any, error) {
	if kind != "projects" && kind != "epics" && kind != "tickets" && kind != "links" {
		return nil, missing()
	}
	if action == "delete" && kind != "links" {
		return s.Delete(ctx, kind, id, DeleteOptions{})
	}
	switch kind + "/" + action {
	case "projects/create":
		return s.CreateProject(ctx, CreateProjectInput{Name: value(in.Name, "")})
	case "projects/update":
		return s.UpdateProject(ctx, id, UpdateProjectInput{Name: in.Name})
	case "epics/create":
		return s.CreateEpic(ctx, CreateEpicInput{ProjectID: value(in.ProjectID, 0), Title: value(in.Title, ""), Completed: in.Completed, Archived: in.Archived})
	case "epics/update":
		return s.UpdateEpic(ctx, id, UpdateEpicInput{ProjectID: in.ProjectID, Title: in.Title, Completed: in.Completed, Archived: in.Archived})
	case "tickets/create":
		return s.CreateTicket(ctx, CreateTicketInput{EpicID: value(in.EpicID, 0), Title: value(in.Title, ""), Description: value(in.Description, ""), Status: in.Status})
	case "tickets/update":
		return s.UpdateTicket(ctx, id, UpdateTicketInput{EpicID: in.EpicID, Title: in.Title, Description: in.Description, Status: in.Status})
	case "links/create":
		return s.CreateLink(ctx, LinkInput{in.BlockerID, in.BlockedID})
	case "links/delete":
		return s.DeleteLink(ctx, LinkInput{in.BlockerID, in.BlockedID})
	default:
		return nil, invalid("Unknown action")
	}
}
func (a *App) Mutate(ctx context.Context, kind, action string, id int64, in Input) (any, error) {
	out, err := a.Store.Mutate(ctx, kind, action, id, in)
	return publishResult(a, out, err)
}
