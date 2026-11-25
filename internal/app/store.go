package app

import (
	"context"
	"database/sql"
	"net/url"
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
		if err := f.Close(); err != nil {
			return nil, err
		}
	}
	dsn := ":memory:"
	if path != ":memory:" {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return nil, err
		}
		dsn = (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String()
	}
	// Apply connection-local PRAGMAs to every physical connection/replacement.
	params := url.Values{"_pragma": {"foreign_keys(ON)", "busy_timeout(5000)"}}
	db, err := sql.Open("sqlite", dsn+"?"+params.Encode())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := initializeDatabase(db); err != nil {
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
		{"SELECT id,name FROM projects ORDER BY id", func(r *sql.Rows) error {
			var p Project
			if err := r.Scan(&p.ID, &p.Name); err != nil {
				return err
			}
			state.Projects = append(state.Projects, p)
			return nil
		}},
		{"SELECT id,project_id,title,completed,archived FROM epics ORDER BY id", func(r *sql.Rows) error {
			var e Epic
			if err := r.Scan(&e.ID, &e.ProjectID, &e.Title, &e.Completed, &e.Archived); err != nil {
				return err
			}
			state.Epics = append(state.Epics, e)
			return nil
		}},
		{ticketSelect + " ORDER BY t.id", func(r *sql.Rows) error {
			t, err := scanTicket(r)
			if err != nil {
				return err
			}
			state.Tickets = append(state.Tickets, t)
			return nil
		}},
		{"SELECT blocker_id,blocked_id FROM links ORDER BY blocker_id,blocked_id", func(r *sql.Rows) error {
			var l Link
			if err := r.Scan(&l.BlockerID, &l.BlockedID); err != nil {
				return err
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

func value[T any](p *T, fallback T) T {
	if p != nil {
		return *p
	}
	return fallback
}
