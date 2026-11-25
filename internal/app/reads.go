package app

import (
	"context"
	"database/sql"
	"fmt"
)

type EpicFilter struct {
	ProjectID       *int64
	Completed       *bool
	Archived        *bool
	IncludeArchived bool
}
type TicketFilter struct {
	EpicID          *int64
	Status          *string
	IncludeArchived bool
}

func (s *Store) Project(ctx context.Context, id int64) (Project, error) {
	if err := validID(id); err != nil {
		return Project{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readProject(ctx, s.db, id)
}
func (s *Store) Epic(ctx context.Context, id int64) (Epic, error) {
	if err := validID(id); err != nil {
		return Epic{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readEpic(ctx, s.db, id)
}
func (s *Store) Ticket(ctx context.Context, id int64) (Ticket, error) {
	if err := validID(id); err != nil {
		return Ticket{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readTicket(ctx, s.db, id)
}

type rowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}
type scanner interface{ Scan(...any) error }

func queryRows[T any](ctx context.Context, q rowsQuerier, query string, args []any, scan func(scanner) (T, error)) ([]T, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query resources: %w", err)
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("scan resource: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func scanProject(row scanner) (Project, error) {
	var p Project
	err := row.Scan(&p.ID, &p.Name)
	return p, err
}
func scanEpic(row scanner) (Epic, error) {
	var e Epic
	err := row.Scan(&e.ID, &e.ProjectID, &e.Title, &e.Completed, &e.Archived)
	return e, err
}
func scanLink(row scanner) (Link, error) {
	var l Link
	err := row.Scan(&l.BlockerID, &l.BlockedID)
	return l, err
}

func (s *Store) Projects(ctx context.Context) ([]Project, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return queryRows(ctx, s.db, "SELECT id,name FROM projects ORDER BY id", nil, scanProject)
}
func (s *Store) Epics(ctx context.Context, f EpicFilter) ([]Epic, error) {
	if f.ProjectID != nil {
		if err := validID(*f.ProjectID); err != nil {
			return nil, err
		}
	}
	query, args := "SELECT id,project_id,title,completed,archived FROM epics WHERE 1=1", []any{}
	if f.ProjectID != nil {
		query += " AND project_id=?"
		args = append(args, *f.ProjectID)
	}
	if f.Completed != nil {
		query += " AND completed=?"
		args = append(args, *f.Completed)
	}
	if f.Archived != nil {
		query += " AND archived=?"
		args = append(args, *f.Archived)
	} else if !f.IncludeArchived {
		query += " AND archived=0"
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return queryRows(ctx, s.db, query+" ORDER BY id", args, scanEpic)
}
func (s *Store) Tickets(ctx context.Context, f TicketFilter) ([]Ticket, error) {
	if f.EpicID != nil {
		if err := validID(*f.EpicID); err != nil {
			return nil, err
		}
	}
	if err := validTicketFields(nil, f.Status); err != nil {
		return nil, err
	}
	query, args := ticketSelect+" JOIN epics e ON e.id=t.epic_id WHERE 1=1", []any{}
	if !f.IncludeArchived {
		query += " AND e.archived=0"
	}
	if f.EpicID != nil {
		query += " AND t.epic_id=?"
		args = append(args, *f.EpicID)
	}
	if f.Status != nil {
		query += " AND t.status=?"
		args = append(args, *f.Status)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return queryRows(ctx, s.db, query+" ORDER BY t.id", args, scanTicket)
}
func (s *Store) Links(ctx context.Context) ([]Link, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return queryRows(ctx, s.db, "SELECT blocker_id,blocked_id FROM links ORDER BY blocker_id,blocked_id", nil, scanLink)
}
