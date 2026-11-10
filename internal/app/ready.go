package app

import (
	"context"
	"database/sql"
	"errors"
)

type ReadyFilter struct {
	ProjectID *int64 `json:"project_id,omitempty"`
	EpicID    *int64 `json:"epic_id,omitempty"`
}

type ReadyTicketsResult struct {
	Tickets []Ticket `json:"tickets"`
}

type ClaimResult struct {
	Claimed bool    `json:"claimed"`
	Ticket  *Ticket `json:"ticket"`
}

// This same predicate is used for discovery and claims. Blockers are deliberately
// not scoped to the candidate's project or epic.
const readyWhere = `t.status='todo' AND e.completed=0 AND e.archived=0
	AND NOT EXISTS (SELECT 1 FROM links l JOIN tickets b ON b.id=l.blocker_id
		WHERE l.blocked_id=t.id AND b.status!='done')`
const readyFrom = ` JOIN epics e ON e.id=t.epic_id WHERE ` + readyWhere
const readyOrder = ` ORDER BY t.created_at, t.id`

type readyQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (f ReadyFilter) validate(ctx context.Context, q readyQuerier) error {
	for _, field := range []struct {
		id    *int64
		table string
	}{{f.ProjectID, "projects"}, {f.EpicID, "epics"}} {
		if field.id == nil {
			continue
		}
		if *field.id <= 0 {
			return invalid("Scope IDs must be positive")
		}
		var exists bool
		if err := q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM "+field.table+" WHERE id=?)", *field.id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return missing()
		}
	}
	if f.ProjectID != nil && f.EpicID != nil {
		var projectID int64
		if err := q.QueryRowContext(ctx, "SELECT project_id FROM epics WHERE id=?", *f.EpicID).Scan(&projectID); err != nil {
			return err
		}
		if projectID != *f.ProjectID {
			return invalid("Epic does not belong to project")
		}
	}
	return nil
}

func (f ReadyFilter) sql() (string, []any) {
	where, args := "", []any{}
	if f.ProjectID != nil {
		where += " AND e.project_id=?"
		args = append(args, *f.ProjectID)
	}
	if f.EpicID != nil {
		where += " AND e.id=?"
		args = append(args, *f.EpicID)
	}
	return where, args
}

func scanTicket(row interface{ Scan(...any) error }) (Ticket, error) {
	var t Ticket
	err := row.Scan(&t.ID, &t.EpicID, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt, &t.StatusSince)
	return t, err
}

func (s *Store) ReadyTickets(ctx context.Context, f ReadyFilter) (ReadyTicketsResult, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := ReadyTicketsResult{Tickets: []Ticket{}}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = f.validate(ctx, tx); err != nil {
		return out, err
	}
	where, args := f.sql()
	rows, err := tx.QueryContext(ctx, ticketSelect+readyFrom+where+readyOrder, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		ticket, err := scanTicket(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Tickets = append(out.Tickets, ticket)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// BEGIN IMMEDIATE acquires SQLite's writer reservation before reading eligibility.
// A process-local mutex alone would not protect HTTP and stdio processes sharing
// a database. Keep selection, validation, transition, and result in this transaction.
func (s *Store) ClaimTicket(ctx context.Context, f ReadyFilter, ticketID *int64) (ClaimResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := ClaimResult{}
	if ticketID != nil && *ticketID <= 0 {
		return out, invalid("A positive ticket_id is required")
	}
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return out, err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return out, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	if err = f.validate(ctx, conn); err != nil {
		return out, err
	}
	where, args := f.sql()
	if ticketID != nil {
		where += " AND t.id=?"
		args = append(args, *ticketID)
	}
	var id int64
	err = conn.QueryRowContext(ctx, "SELECT t.id FROM tickets t"+readyFrom+where+readyOrder+" LIMIT 1", args...).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		if ticketID != nil {
			var exists bool
			if err = conn.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM tickets WHERE id=?)", *ticketID).Scan(&exists); err != nil {
				return out, err
			}
			if !exists {
				return out, missing()
			}
			return out, &APIError{409, "Ticket is not ready: it must be todo, in an unfinished/unarchived epic, with every blocker done"}
		}
		// No eligible ticket is a successful, explicit no-work result.
		_, err = conn.ExecContext(ctx, "COMMIT")
		return out, err
	}
	if err != nil {
		return out, err
	}
	if _, err = conn.ExecContext(ctx, "UPDATE tickets SET status='in_progress', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", id); err != nil {
		return out, err
	}
	ticket, err := scanTicket(conn.QueryRowContext(ctx, ticketSelect+" WHERE t.id=?", id))
	if err != nil {
		return out, err
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return out, err
	}
	return ClaimResult{Claimed: true, Ticket: &ticket}, nil
}

func (a *App) ClaimTicket(ctx context.Context, f ReadyFilter, ticketID *int64) (ClaimResult, error) {
	out, err := a.Store.ClaimTicket(ctx, f, ticketID)
	if err == nil && out.Claimed {
		a.publish()
	}
	return out, err
}
