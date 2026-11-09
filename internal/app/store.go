package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

type Project struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Epic struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
	Archived  bool   `json:"archived"`
}

type Ticket struct {
	ID          int64   `json:"id"`
	EpicID      int64   `json:"epic_id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Status      string  `json:"status"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
	StatusSince *string `json:"status_since" jsonschema:"Known entry time into the current in_progress or ready_for_review column; null for todo, done, or unknown legacy timing"`
}

// Read the latest event, not updated_at or an earlier visit to the same column.
// A migration baseline is an observation, never a known column-entry time.
const ticketSelect = `SELECT t.id, t.epic_id, t.title, t.description, t.status, t.created_at, t.updated_at,
	CASE WHEN t.status IN ('in_progress','ready_for_review') THEN (
		SELECT CASE WHEN h.kind!='baseline' AND h.to_status=t.status THEN h.changed_at END
		FROM ticket_status_events h WHERE h.ticket_id=t.id ORDER BY h.id DESC LIMIT 1
	) END AS status_since FROM tickets t`

// A link is directed: BlockerID blocks BlockedID.
type Link struct {
	BlockerID int64 `json:"blocker_id"`
	BlockedID int64 `json:"blocked_id"`
}

type State struct {
	Projects []Project `json:"projects"`
	Epics    []Epic    `json:"epics"`
	Tickets  []Ticket  `json:"tickets"`
	Links    []Link    `json:"links"`
}

type Input struct {
	Name        *string `json:"name,omitempty"`
	Title       *string `json:"title,omitempty"`
	Description *string `json:"description,omitempty"`
	ProjectID   *int64  `json:"project_id,omitempty"`
	EpicID      *int64  `json:"epic_id,omitempty"`
	Status      *string `json:"status,omitempty"`
	Completed   *bool   `json:"completed,omitempty"`
	Archived    *bool   `json:"archived,omitempty"`
	BlockerID   int64   `json:"blocker_id,omitempty"`
	BlockedID   int64   `json:"blocked_id,omitempty"`
}

type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string  { return e.Message }
func invalid(message string) error { return &APIError{400, message} }
func missing() error               { return &APIError{404, "Not found"} }

type Store struct {
	db *sql.DB
	mu sync.RWMutex
}

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, err
		}
		// Create private databases; do not change permissions on existing user files.
		f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			return nil, err
		}
		f.Close()
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200)
		);
		CREATE TABLE IF NOT EXISTS epics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
			title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
			completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1))
		);
		CREATE TABLE IF NOT EXISTS tickets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			epic_id INTEGER NOT NULL REFERENCES epics(id) ON DELETE RESTRICT,
			title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
			description TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','ready_for_review','done')),
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
			updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		);
		CREATE TABLE IF NOT EXISTS links (
			blocker_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
			blocked_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
			PRIMARY KEY(blocker_id, blocked_id), CHECK(blocker_id != blocked_id)
		);
		CREATE INDEX IF NOT EXISTS epics_project ON epics(project_id);
		CREATE INDEX IF NOT EXISTS tickets_epic ON tickets(epic_id);
		CREATE INDEX IF NOT EXISTS links_blocked ON links(blocked_id);
	`)
	if err != nil {
		db.Close()
		return nil, err
	}
	if err := migrateDatabase(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Snapshot(ctx context.Context) (State, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback()
	state, err := snapshotTx(ctx, tx)
	if err != nil {
		return state, err
	}
	return state, tx.Commit()
}

func snapshotTx(ctx context.Context, tx *sql.Tx) (State, error) {
	state := State{Projects: []Project{}, Epics: []Epic{}, Tickets: []Ticket{}, Links: []Link{}}
	queries := []struct {
		sql  string
		scan func(*sql.Rows) error
	}{
		{"SELECT id, name FROM projects ORDER BY id", func(r *sql.Rows) error {
			var p Project
			if e := r.Scan(&p.ID, &p.Name); e != nil {
				return e
			}
			state.Projects = append(state.Projects, p)
			return nil
		}},
		{"SELECT id, project_id, title, completed, archived FROM epics ORDER BY id", func(r *sql.Rows) error {
			var e Epic
			if err := r.Scan(&e.ID, &e.ProjectID, &e.Title, &e.Completed, &e.Archived); err != nil {
				return err
			}
			state.Epics = append(state.Epics, e)
			return nil
		}},
		{ticketSelect + " ORDER BY t.id", func(r *sql.Rows) error {
			var t Ticket
			if e := r.Scan(&t.ID, &t.EpicID, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt, &t.StatusSince); e != nil {
				return e
			}
			state.Tickets = append(state.Tickets, t)
			return nil
		}},
		{"SELECT blocker_id, blocked_id FROM links ORDER BY blocker_id, blocked_id", func(r *sql.Rows) error {
			var l Link
			if e := r.Scan(&l.BlockerID, &l.BlockedID); e != nil {
				return e
			}
			state.Links = append(state.Links, l)
			return nil
		}},
	}
	for _, q := range queries {
		rows, err := tx.QueryContext(ctx, q.sql)
		if err != nil {
			return state, err
		}
		for rows.Next() {
			if err := q.scan(rows); err != nil {
				rows.Close()
				return state, err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return state, err
		}
	}
	return state, nil
}

func validTitle(p *string, required bool) error {
	if p == nil {
		if required {
			return invalid("A title or name is required")
		}
		return nil
	}
	*p = strings.TrimSpace(*p)
	if len(*p) == 0 || len([]rune(*p)) > 200 {
		return invalid("Titles and names must be between 1 and 200 characters")
	}
	return nil
}

func validStatus(status string) bool {
	return status == "todo" || status == "in_progress" || status == "ready_for_review" || status == "done"
}

// Mutate is shared by REST and MCP so both interfaces enforce the same rules.
func (s *Store) Mutate(ctx context.Context, kind, action string, id int64, in Input) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind != "projects" && kind != "epics" && kind != "tickets" && kind != "links" {
		return nil, missing()
	}
	if action != "create" && action != "update" && action != "delete" {
		return nil, invalid("Unknown action")
	}
	if kind != "links" && action != "create" && id <= 0 {
		return nil, invalid("A positive ID is required")
	}
	if kind == "links" && action == "update" {
		return nil, invalid("Links cannot be updated; remove and recreate the link")
	}
	create := action == "create"
	if action != "delete" && kind != "links" {
		name := in.Title
		if kind == "projects" {
			name = in.Name
		}
		if err := validTitle(name, create); err != nil {
			return nil, err
		}
		if in.Status != nil && !validStatus(*in.Status) {
			return nil, invalid("Status must be todo, in_progress, ready_for_review, or done")
		}
		if in.Description != nil && len(*in.Description) > 100000 {
			return nil, invalid("Description is too long (maximum 100,000 bytes)")
		}
		if create && kind == "epics" && in.ProjectID == nil {
			return nil, invalid("project_id is required")
		}
		if create && kind == "tickets" && in.EpicID == nil {
			return nil, invalid("epic_id is required")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	exists := func(table string, id int64) error {
		var n int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table+" WHERE id = ?", id).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return missing()
		}
		return nil
	}
	if kind != "links" && !create {
		if err := exists(kind, id); err != nil {
			return nil, err
		}
	}
	if kind == "epics" && action != "delete" {
		completed, archived := false, false
		if !create {
			if err := tx.QueryRowContext(ctx, "SELECT completed, archived FROM epics WHERE id=?", id).Scan(&completed, &archived); err != nil {
				return nil, err
			}
		}
		completed, archived = value(in.Completed, completed), value(in.Archived, archived)
		if archived && !completed {
			return nil, invalid("Only completed epics can be archived. Unarchive the epic before reopening it.")
		}
	}
	if action != "delete" {
		if kind == "epics" && in.ProjectID != nil {
			if err := exists("projects", *in.ProjectID); err != nil {
				return nil, invalid("Project does not exist")
			}
		}
		if kind == "tickets" && in.EpicID != nil {
			if err := exists("epics", *in.EpicID); err != nil {
				return nil, invalid("Epic does not exist")
			}
		}
	}
	var result any
	if kind == "links" {
		if in.BlockerID <= 0 || in.BlockedID <= 0 || in.BlockerID == in.BlockedID {
			return nil, invalid("Two different, positive ticket IDs are required")
		}
		if create {
			for _, ticketID := range []int64{in.BlockerID, in.BlockedID} {
				if err := exists("tickets", ticketID); err != nil {
					return nil, invalid("Linked ticket does not exist")
				}
			}
			var cycle bool
			err = tx.QueryRowContext(ctx, `WITH RECURSIVE reachable(id) AS (
				SELECT blocked_id FROM links WHERE blocker_id = ?
				UNION SELECT links.blocked_id FROM links JOIN reachable ON links.blocker_id = reachable.id
			) SELECT EXISTS(SELECT 1 FROM reachable WHERE id = ?)`, in.BlockedID, in.BlockerID).Scan(&cycle)
			if err != nil {
				return nil, err
			}
			if cycle {
				return nil, invalid("This link would create a dependency cycle")
			}
			_, err = tx.ExecContext(ctx, "INSERT OR IGNORE INTO links(blocker_id, blocked_id) VALUES (?, ?)", in.BlockerID, in.BlockedID)
		} else {
			_, err = tx.ExecContext(ctx, "DELETE FROM links WHERE blocker_id = ? AND blocked_id = ?", in.BlockerID, in.BlockedID)
		}
		result = Link{in.BlockerID, in.BlockedID}
	} else if action == "delete" {
		if kind == "projects" || kind == "epics" {
			child, column := "epics", "project_id"
			if kind == "epics" {
				child, column = "tickets", "epic_id"
			}
			var count int
			if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM "+child+" WHERE "+column+" = ?", id).Scan(&count); err != nil {
				return nil, err
			}
			if count > 0 {
				return nil, &APIError{409, "Move or delete the contained " + child + " first"}
			}
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM "+kind+" WHERE id = ?", id)
		result = map[string]int64{"id": id}
	} else {
		if create {
			var res sql.Result
			switch kind {
			case "projects":
				res, err = tx.ExecContext(ctx, "INSERT INTO projects(name) VALUES (?)", *in.Name)
			case "epics":
				res, err = tx.ExecContext(ctx, "INSERT INTO epics(project_id, title, completed, archived) VALUES (?, ?, ?, ?)", *in.ProjectID, *in.Title, value(in.Completed, false), value(in.Archived, false))
			case "tickets":
				res, err = tx.ExecContext(ctx, "INSERT INTO tickets(epic_id, title, description, status) VALUES (?, ?, ?, ?)", *in.EpicID, *in.Title, value(in.Description, ""), value(in.Status, "todo"))
			}
			if err == nil {
				id, err = res.LastInsertId()
			}
		} else {
			sets := []string{}
			args := []any{}
			add := func(key string, val any) { sets = append(sets, key+" = ?"); args = append(args, val) }
			switch kind {
			case "projects":
				if in.Name != nil {
					add("name", *in.Name)
				}
			case "epics":
				if in.Title != nil {
					add("title", *in.Title)
				}
				if in.ProjectID != nil {
					add("project_id", *in.ProjectID)
				}
				if in.Completed != nil {
					add("completed", *in.Completed)
				}
				if in.Archived != nil {
					add("archived", *in.Archived)
				}
			case "tickets":
				if in.Title != nil {
					add("title", *in.Title)
				}
				if in.Description != nil {
					add("description", *in.Description)
				}
				if in.EpicID != nil {
					add("epic_id", *in.EpicID)
				}
				if in.Status != nil {
					add("status", *in.Status)
				}
				sets = append(sets, "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
			}
			if len(sets) > 0 {
				args = append(args, id)
				_, err = tx.ExecContext(ctx, "UPDATE "+kind+" SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
			}
		}
		if err != nil {
			return nil, err
		}
		switch kind {
		case "projects":
			var p Project
			err = tx.QueryRowContext(ctx, "SELECT id, name FROM projects WHERE id = ?", id).Scan(&p.ID, &p.Name)
			result = p
		case "epics":
			var e Epic
			err = tx.QueryRowContext(ctx, "SELECT id, project_id, title, completed, archived FROM epics WHERE id = ?", id).Scan(&e.ID, &e.ProjectID, &e.Title, &e.Completed, &e.Archived)
			result = e
		case "tickets":
			var t Ticket
			err = tx.QueryRowContext(ctx, ticketSelect+" WHERE t.id = ?", id).Scan(&t.ID, &t.EpicID, &t.Title, &t.Description, &t.Status, &t.CreatedAt, &t.UpdatedAt, &t.StatusSince)
			result = t
		}
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func value[T any](p *T, fallback T) T {
	if p != nil {
		return *p
	}
	return fallback
}

func errorStatus(err error) (int, string) {
	var api *APIError
	if errors.As(err, &api) {
		return api.Status, api.Message
	}
	return 500, "Internal server error"
}

func decodeInput(raw json.RawMessage) (Input, error) {
	var in Input
	if len(strings.TrimSpace(string(raw))) == 0 || strings.TrimSpace(string(raw))[0] != '{' {
		return in, invalid("Input must be a JSON object")
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, invalid(fmt.Sprintf("Invalid input: %s", err))
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return in, invalid("Input must contain exactly one JSON object")
	}
	return in, nil
}
