package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type CreateProjectInput struct {
	Name string `json:"name"`
}
type UpdateProjectInput struct {
	Name *string `json:"name,omitempty"`
}
type CreateEpicInput struct {
	ProjectID int64  `json:"project_id"`
	Title     string `json:"title"`
	Completed *bool  `json:"completed,omitempty"`
	Archived  *bool  `json:"archived,omitempty"`
}
type UpdateEpicInput struct {
	Title     *string `json:"title,omitempty"`
	ProjectID *int64  `json:"project_id,omitempty"`
	Completed *bool   `json:"completed,omitempty"`
	Archived  *bool   `json:"archived,omitempty"`
}
type CreateTicketInput struct {
	EpicID      int64   `json:"epic_id"`
	Title       string  `json:"title"`
	Description string  `json:"description,omitempty"`
	Status      *string `json:"status,omitempty" jsonschema:"todo, in_progress, ready_for_review, or done"`
}
type UpdateTicketInput struct {
	EpicID      *int64  `json:"epic_id,omitempty"`
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty" jsonschema:"todo, in_progress, ready_for_review, or done"`
}
type LinkInput struct {
	BlockerID int64 `json:"blocker_id"`
	BlockedID int64 `json:"blocked_id"`
}

func applyWrite[T any](ctx context.Context, s *Store, fn func(*writeTx) (T, error)) (T, error) {
	var zero T
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := beginWrite(ctx, s.db)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	out, err := fn(tx)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return out, nil
}

// Table names are internal constants, never request values.
func requireParent(ctx context.Context, q readyQuerier, table string, id int64, message string) error {
	var exists bool
	if err := q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id=?)", id).Scan(&exists); err != nil {
		return fmt.Errorf("check %s existence: %w", table, err)
	}
	if !exists {
		return invalid(message)
	}
	return nil
}

func readProject(ctx context.Context, q readyQuerier, id int64) (Project, error) {
	var p Project
	err := q.QueryRowContext(ctx, "SELECT id,name FROM projects WHERE id=?", id).Scan(&p.ID, &p.Name)
	return p, readError(err)
}
func readEpic(ctx context.Context, q readyQuerier, id int64) (Epic, error) {
	var e Epic
	err := q.QueryRowContext(ctx, "SELECT id,project_id,title,completed,archived FROM epics WHERE id=?", id).Scan(&e.ID, &e.ProjectID, &e.Title, &e.Completed, &e.Archived)
	return e, readError(err)
}
func readTicket(ctx context.Context, q readyQuerier, id int64) (Ticket, error) {
	t, err := scanTicket(q.QueryRowContext(ctx, ticketSelect+" WHERE t.id=?", id))
	return t, readError(err)
}
func readError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	return err
}
func validID(id int64) error {
	if id <= 0 {
		return invalid("A positive ID is required")
	}
	return nil
}
func validArchive(completed, archived bool) error {
	if archived && !completed {
		return invalid("Only completed epics can be archived. Unarchive the epic before reopening it.")
	}
	return nil
}
func validTicketFields(description, status *string) error {
	if status != nil && !validStatus(*status) {
		return invalid("Status must be todo, in_progress, ready_for_review, or done")
	}
	if description != nil && len(*description) > 100000 {
		return invalid("Description is too long (maximum 100,000 bytes)")
	}
	return nil
}

func (s *Store) CreateProject(ctx context.Context, in CreateProjectInput) (Project, error) {
	if err := validTitle(&in.Name, true); err != nil {
		return Project{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Project, error) {
		res, err := tx.ExecContext(ctx, "INSERT INTO projects(name) VALUES(?)", in.Name)
		if err != nil {
			return Project{}, err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return Project{}, err
		}
		return readProject(ctx, tx, id)
	})
}
func (s *Store) UpdateProject(ctx context.Context, id int64, in UpdateProjectInput) (Project, error) {
	if err := validID(id); err != nil {
		return Project{}, err
	}
	if err := validTitle(in.Name, false); err != nil {
		return Project{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Project, error) {
		if _, err := readProject(ctx, tx, id); err != nil {
			return Project{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE projects SET name=COALESCE(?,name) WHERE id=?", in.Name, id); err != nil {
			return Project{}, err
		}
		return readProject(ctx, tx, id)
	})
}
func (s *Store) CreateEpic(ctx context.Context, in CreateEpicInput) (Epic, error) {
	if err := validTitle(&in.Title, true); err != nil {
		return Epic{}, err
	}
	if err := validArchive(value(in.Completed, false), value(in.Archived, false)); err != nil {
		return Epic{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Epic, error) {
		if err := requireParent(ctx, tx, "projects", in.ProjectID, "Project does not exist"); err != nil {
			return Epic{}, err
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO epics(project_id,title,completed,archived) VALUES(?,?,?,?)", in.ProjectID, in.Title, value(in.Completed, false), value(in.Archived, false))
		if err != nil {
			return Epic{}, err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return Epic{}, err
		}
		return readEpic(ctx, tx, id)
	})
}
func (s *Store) UpdateEpic(ctx context.Context, id int64, in UpdateEpicInput) (Epic, error) {
	if err := validID(id); err != nil {
		return Epic{}, err
	}
	if err := validTitle(in.Title, false); err != nil {
		return Epic{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Epic, error) {
		e, err := readEpic(ctx, tx, id)
		if err != nil {
			return Epic{}, err
		}
		if err := validArchive(value(in.Completed, e.Completed), value(in.Archived, e.Archived)); err != nil {
			return Epic{}, err
		}
		if in.ProjectID != nil {
			if err := requireParent(ctx, tx, "projects", *in.ProjectID, "Project does not exist"); err != nil {
				return Epic{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE epics SET title=COALESCE(?,title),project_id=COALESCE(?,project_id),completed=COALESCE(?,completed),archived=COALESCE(?,archived) WHERE id=?", in.Title, in.ProjectID, in.Completed, in.Archived, id); err != nil {
			return Epic{}, err
		}
		return readEpic(ctx, tx, id)
	})
}
func (s *Store) CreateTicket(ctx context.Context, in CreateTicketInput) (Ticket, error) {
	status := value(in.Status, "todo")
	if err := validTitle(&in.Title, true); err != nil {
		return Ticket{}, err
	}
	if err := validTicketFields(&in.Description, &status); err != nil {
		return Ticket{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Ticket, error) {
		if err := requireParent(ctx, tx, "epics", in.EpicID, "Epic does not exist"); err != nil {
			return Ticket{}, err
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO tickets(epic_id,title,description,status) VALUES(?,?,?,?)", in.EpicID, in.Title, in.Description, status)
		if err != nil {
			return Ticket{}, err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return Ticket{}, err
		}
		return readTicket(ctx, tx, id)
	})
}
func (s *Store) UpdateTicket(ctx context.Context, id int64, in UpdateTicketInput) (Ticket, error) {
	if err := validID(id); err != nil {
		return Ticket{}, err
	}
	if err := validTitle(in.Title, false); err != nil {
		return Ticket{}, err
	}
	if err := validTicketFields(in.Description, in.Status); err != nil {
		return Ticket{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Ticket, error) {
		if _, err := readTicket(ctx, tx, id); err != nil {
			return Ticket{}, err
		}
		if in.EpicID != nil {
			if err := requireParent(ctx, tx, "epics", *in.EpicID, "Epic does not exist"); err != nil {
				return Ticket{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE tickets SET title=COALESCE(?,title),epic_id=COALESCE(?,epic_id),description=COALESCE(?,description),status=COALESCE(?,status),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", in.Title, in.EpicID, in.Description, in.Status, id); err != nil {
			return Ticket{}, err
		}
		return readTicket(ctx, tx, id)
	})
}
func validLink(in LinkInput) error {
	if in.BlockerID <= 0 || in.BlockedID <= 0 || in.BlockerID == in.BlockedID {
		return invalid("Two different, positive ticket IDs are required")
	}
	return nil
}
func (s *Store) CreateLink(ctx context.Context, in LinkInput) (Link, error) {
	if err := validLink(in); err != nil {
		return Link{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Link, error) {
		for _, id := range []int64{in.BlockerID, in.BlockedID} {
			if err := requireParent(ctx, tx, "tickets", id, "Linked ticket does not exist"); err != nil {
				return Link{}, err
			}
		}
		var cycle bool
		if err := tx.QueryRowContext(ctx, `WITH RECURSIVE reachable(id) AS (
			SELECT blocked_id FROM links WHERE blocker_id=?
			UNION SELECT links.blocked_id FROM links JOIN reachable ON links.blocker_id=reachable.id
		) SELECT EXISTS(SELECT 1 FROM reachable WHERE id=?)`, in.BlockedID, in.BlockerID).Scan(&cycle); err != nil {
			return Link{}, err
		}
		if cycle {
			return Link{}, invalid("This link would create a dependency cycle")
		}
		_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO links(blocker_id,blocked_id) VALUES(?,?)", in.BlockerID, in.BlockedID)
		return Link(in), err
	})
}
func (s *Store) DeleteLink(ctx context.Context, in LinkInput) (Link, error) {
	if err := validLink(in); err != nil {
		return Link{}, err
	}
	return applyWrite(ctx, s, func(tx *writeTx) (Link, error) {
		_, err := tx.ExecContext(ctx, "DELETE FROM links WHERE blocker_id=? AND blocked_id=?", in.BlockerID, in.BlockedID)
		return Link(in), err
	})
}

func publishResult[T any](a *App, out T, err error) (T, error) {
	if err == nil {
		a.publish()
	}
	return out, err
}
func (a *App) CreateProject(ctx context.Context, in CreateProjectInput) (Project, error) {
	out, err := a.Store.CreateProject(ctx, in)
	return publishResult(a, out, err)
}
func (a *App) UpdateProject(ctx context.Context, id int64, in UpdateProjectInput) (Project, error) {
	out, err := a.Store.UpdateProject(ctx, id, in)
	return publishResult(a, out, err)
}
func (a *App) CreateEpic(ctx context.Context, in CreateEpicInput) (Epic, error) {
	out, err := a.Store.CreateEpic(ctx, in)
	return publishResult(a, out, err)
}
func (a *App) UpdateEpic(ctx context.Context, id int64, in UpdateEpicInput) (Epic, error) {
	out, err := a.Store.UpdateEpic(ctx, id, in)
	return publishResult(a, out, err)
}
func (a *App) CreateTicket(ctx context.Context, in CreateTicketInput) (Ticket, error) {
	out, err := a.Store.CreateTicket(ctx, in)
	return publishResult(a, out, err)
}
func (a *App) UpdateTicket(ctx context.Context, id int64, in UpdateTicketInput) (Ticket, error) {
	out, err := a.Store.UpdateTicket(ctx, id, in)
	return publishResult(a, out, err)
}
func (a *App) CreateLink(ctx context.Context, in LinkInput) (Link, error) {
	out, err := a.Store.CreateLink(ctx, in)
	return publishResult(a, out, err)
}
func (a *App) DeleteLink(ctx context.Context, in LinkInput) (Link, error) {
	out, err := a.Store.DeleteLink(ctx, in)
	return publishResult(a, out, err)
}
