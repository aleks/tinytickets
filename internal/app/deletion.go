package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
)

type DeletionCounts struct {
	Epics                   int `json:"epics"`
	Tickets                 int `json:"tickets"`
	ArchivedEpics           int `json:"archived_epics"`
	WorkLogEntries          int `json:"work_log_entries"`
	StatusEvents            int `json:"status_events"`
	DependencyLinks         int `json:"dependency_links"`
	ExternalDependencyLinks int `json:"external_dependency_links"`
}

type DeletionPreview struct {
	Kind              string         `json:"kind"`
	ID                int64          `json:"id"`
	Name              string         `json:"name"`
	RequiresForce     bool           `json:"requires_force"`
	ConfirmationToken string         `json:"confirmation_token"`
	Counts            DeletionCounts `json:"counts"`
}

type DeleteOptions struct {
	Force             bool    `json:"force,omitempty"`
	ConfirmationToken *string `json:"confirmation_token,omitempty"`
}

func (o *DeleteOptions) UnmarshalJSON(raw []byte) error {
	type plain DeleteOptions
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for key, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return invalid(key + " must not be null")
		}
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode((*plain)(o))
}

type deletionQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// Scope never follows dependencies into surviving tickets, and includes archives.
func deletionScope(kind string) (epics, tickets string) {
	switch kind {
	case "projects":
		return "SELECT id FROM epics WHERE project_id=?", "SELECT t.id FROM tickets t JOIN epics e ON e.id=t.epic_id WHERE e.project_id=?"
	case "epics":
		return "SELECT id FROM epics WHERE id=?", "SELECT id FROM tickets WHERE epic_id=?"
	default:
		return "SELECT id FROM epics WHERE 0 AND id=?", "SELECT id FROM tickets WHERE id=?"
	}
}

func deletionPreview(ctx context.Context, q deletionQuerier, kind string, id int64) (DeletionPreview, error) {
	p := DeletionPreview{Kind: kind, ID: id}
	if kind != "projects" && kind != "epics" && kind != "tickets" {
		return p, missing()
	}
	if id <= 0 {
		return p, invalid("A positive ID is required")
	}
	name := "title"
	if kind == "projects" {
		name = "name"
	}
	err := q.QueryRowContext(ctx, "SELECT "+name+" FROM "+kind+" WHERE id=?", id).Scan(&p.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return p, missing()
	}
	if err != nil {
		return p, err
	}
	epics, tickets := deletionScope(kind)
	queries := []struct {
		sql  string
		args []any
	}{
		{"SELECT * FROM " + kind + " WHERE id=?", []any{id}},
		{"SELECT * FROM epics WHERE id IN (" + epics + ") ORDER BY id", []any{id}},
		{"SELECT * FROM tickets WHERE id IN (" + tickets + ") ORDER BY id", []any{id}},
		{"SELECT * FROM ticket_work_log WHERE ticket_id IN (" + tickets + ") ORDER BY id", []any{id}},
		{"SELECT * FROM ticket_status_events WHERE ticket_id IN (" + tickets + ") ORDER BY id", []any{id}},
		{"SELECT * FROM links WHERE blocker_id IN (" + tickets + ") OR blocked_id IN (" + tickets + ") ORDER BY blocker_id, blocked_id", []any{id, id}},
	}
	// Full ordered rows detect same-count replacements, moves, edits and new notes.
	h := sha256.New()
	enc := json.NewEncoder(h)
	if err = enc.Encode([]any{"deletion-v1", kind, id, p.Name}); err != nil {
		return p, err
	}
	counts := make([]int, len(queries))
	for i, query := range queries {
		rows, err := q.QueryContext(ctx, query.sql, query.args...)
		if err != nil {
			return p, err
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return p, err
		}
		if err = enc.Encode(columns); err != nil {
			rows.Close()
			return p, err
		}
		for rows.Next() {
			values := make([]any, len(columns))
			dest := make([]any, len(columns))
			for j := range values {
				dest[j] = &values[j]
			}
			if err = rows.Scan(dest...); err != nil {
				rows.Close()
				return p, err
			}
			if err = enc.Encode(values); err != nil {
				rows.Close()
				return p, err
			}
			counts[i]++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return p, err
		}
		if err = enc.Encode(counts[i]); err != nil {
			return p, err
		}
	}
	p.Counts.Epics, p.Counts.Tickets = counts[1], counts[2]
	if kind == "epics" {
		p.Counts.Epics = 0
	}
	if kind == "tickets" {
		p.Counts.Tickets = 0
	}
	p.Counts.WorkLogEntries, p.Counts.StatusEvents, p.Counts.DependencyLinks = counts[3], counts[4], counts[5]
	if err = q.QueryRowContext(ctx, "SELECT count(*) FROM epics WHERE archived=1 AND id IN ("+epics+")", id).Scan(&p.Counts.ArchivedEpics); err != nil {
		return p, err
	}
	if err = q.QueryRowContext(ctx, "SELECT count(*) FROM links WHERE (blocker_id IN ("+tickets+")) != (blocked_id IN ("+tickets+"))", id, id).Scan(&p.Counts.ExternalDependencyLinks); err != nil {
		return p, err
	}
	p.RequiresForce = p.Counts.Epics > 0 || p.Counts.Tickets > 0
	p.ConfirmationToken = hex.EncodeToString(h.Sum(nil))
	return p, nil
}

func (s *Store) DeletionPreview(ctx context.Context, kind string, id int64) (DeletionPreview, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DeletionPreview{}, err
	}
	defer tx.Rollback()
	p, err := deletionPreview(ctx, tx, kind, id)
	if err != nil {
		return p, err
	}
	return p, tx.Commit()
}

func (s *Store) Delete(ctx context.Context, kind string, id int64, options DeleteOptions) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if options.Force && (options.ConfirmationToken == nil || *options.ConfirmationToken == "") {
		return nil, invalid("force requires a nonempty confirmation_token from a deletion preview")
	}
	conn, err := beginWrite(ctx, s.db)
	if err != nil {
		return nil, err
	}
	defer conn.Rollback()
	p, err := deletionPreview(ctx, conn, kind, id)
	if err != nil {
		return nil, err
	}
	if options.ConfirmationToken != nil && *options.ConfirmationToken != p.ConfirmationToken {
		return nil, conflict("Deletion impact changed. Review the updated preview and confirm again.")
	}
	if p.RequiresForce && !options.Force {
		return nil, conflict("This item contains work. Review the deletion preview and explicitly confirm with force and confirmation_token.")
	}
	epics, tickets := deletionScope(kind)
	if _, err = conn.ExecContext(ctx, "DELETE FROM tickets WHERE id IN ("+tickets+")", id); err != nil {
		return nil, err
	}
	if kind != "tickets" {
		if _, err = conn.ExecContext(ctx, "DELETE FROM epics WHERE id IN ("+epics+")", id); err != nil {
			return nil, err
		}
	}
	if kind == "projects" {
		if _, err = conn.ExecContext(ctx, "DELETE FROM projects WHERE id=?", id); err != nil {
			return nil, err
		}
	}
	if err = conn.Commit(); err != nil {
		return nil, err
	}
	return map[string]int64{"id": id}, nil
}

func (a *App) Delete(ctx context.Context, kind string, id int64, options DeleteOptions) (any, error) {
	out, err := a.Store.Delete(ctx, kind, id, options)
	if err == nil {
		a.publish()
	}
	return out, err
}
