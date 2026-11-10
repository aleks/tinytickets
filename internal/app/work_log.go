package app

import (
	"context"
	"database/sql"
	"strings"
)

type WorkLogEntry struct {
	ID           int64  `json:"id"`
	TicketID     int64  `json:"ticket_id"`
	Kind         string `json:"kind"`
	Author       string `json:"author"`
	Body         string `json:"body"`
	Verification string `json:"verification"`
	References   string `json:"references"`
	ReviewNotes  string `json:"review_notes"`
	CreatedAt    string `json:"created_at"`
}

type WorkLogResult struct {
	TicketID int64          `json:"ticket_id"`
	Entries  []WorkLogEntry `json:"entries"`
}

type WorkLogNoteInput struct {
	Body   string `json:"body"`
	Author string `json:"author,omitempty" jsonschema:"Optional informational author label; not authenticated identity"`
}

type ReviewHandoffInput struct {
	Summary      string `json:"summary"`
	Verification string `json:"verification"`
	References   string `json:"references,omitempty"`
	ReviewNotes  string `json:"review_notes,omitempty"`
	Author       string `json:"author,omitempty" jsonschema:"Optional informational author label; not authenticated identity"`
}

type ReviewHandoffResult struct {
	Entry  WorkLogEntry `json:"entry"`
	Ticket Ticket       `json:"ticket"`
}

func migrateWorkLog(ctx context.Context, conn *sql.Conn) error {
	_, err := conn.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS ticket_work_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK(kind IN ('note','review_handoff')),
			author TEXT NOT NULL DEFAULT '' CHECK(length(author)<=200),
			body TEXT NOT NULL CHECK(length(trim(body))>0),
			verification TEXT NOT NULL DEFAULT '',
			"references" TEXT NOT NULL DEFAULT '',
			review_notes TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
			CHECK(kind!='review_handoff' OR length(trim(verification))>0)
		);
		CREATE INDEX IF NOT EXISTS work_log_ticket ON ticket_work_log(ticket_id,id);
		CREATE TRIGGER IF NOT EXISTS work_log_no_update BEFORE UPDATE ON ticket_work_log BEGIN
			SELECT RAISE(ABORT,'Work log entries are append-only');
		END;
		CREATE TRIGGER IF NOT EXISTS work_log_no_delete BEFORE DELETE ON ticket_work_log
		WHEN EXISTS(SELECT 1 FROM tickets WHERE id=OLD.ticket_id) BEGIN
			SELECT RAISE(ABORT,'Work log entries are append-only; delete the ticket to remove its log');
		END;
		PRAGMA user_version=4;
	`)
	return err
}

const workLogSelect = `SELECT id,ticket_id,kind,author,body,verification,"references",review_notes,created_at FROM ticket_work_log`

func scanWorkLog(row interface{ Scan(...any) error }) (WorkLogEntry, error) {
	var entry WorkLogEntry
	err := row.Scan(&entry.ID, &entry.TicketID, &entry.Kind, &entry.Author, &entry.Body, &entry.Verification, &entry.References, &entry.ReviewNotes, &entry.CreatedAt)
	return entry, err
}

func (s *Store) TicketWorkLog(ctx context.Context, id int64) (WorkLogResult, error) {
	out := WorkLogResult{TicketID: id, Entries: []WorkLogEntry{}}
	if id <= 0 {
		return out, invalid("A positive ticket ID is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM tickets WHERE id=?)", id).Scan(&exists); err != nil {
		return out, err
	}
	if !exists {
		return out, missing()
	}
	// IDs represent append order even when concurrent callers share a timestamp.
	rows, err := tx.QueryContext(ctx, workLogSelect+" WHERE ticket_id=? ORDER BY id", id)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		entry, err := scanWorkLog(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Entries = append(out.Entries, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s *Store) appendWorkLog(ctx context.Context, id int64, entry WorkLogEntry) (ReviewHandoffResult, error) {
	out := ReviewHandoffResult{}
	if id <= 0 {
		return out, invalid("A positive ticket ID is required")
	}
	entry.Author = strings.TrimSpace(entry.Author)
	entry.Body = strings.TrimSpace(entry.Body)
	entry.Verification = strings.TrimSpace(entry.Verification)
	entry.References = strings.TrimSpace(entry.References)
	entry.ReviewNotes = strings.TrimSpace(entry.ReviewNotes)
	if entry.Body == "" {
		return out, invalid("A log body or handoff summary is required")
	}
	if entry.Kind == "review_handoff" && entry.Verification == "" {
		return out, invalid("Review handoffs require verification results (including checks not run or failing)")
	}
	if len([]rune(entry.Author)) > 200 {
		return out, invalid("Author labels must be at most 200 characters")
	}
	if len(entry.Body)+len(entry.Verification)+len(entry.References)+len(entry.ReviewNotes) > 100000 {
		return out, invalid("Work log content is too long (maximum 100,000 bytes combined)")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return out, err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return out, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	var exists bool
	if err = conn.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM tickets WHERE id=?)", id).Scan(&exists); err != nil {
		return out, err
	}
	if !exists {
		return out, missing()
	}
	res, err := conn.ExecContext(ctx, `INSERT INTO ticket_work_log(ticket_id,kind,author,body,verification,"references",review_notes) VALUES (?,?,?,?,?,?,?)`, id, entry.Kind, entry.Author, entry.Body, entry.Verification, entry.References, entry.ReviewNotes)
	if err != nil {
		return out, err
	}
	entryID, err := res.LastInsertId()
	if err != nil {
		return out, err
	}
	if entry.Kind == "review_handoff" {
		// A second handoff in review adds context without restarting its timer.
		if _, err = conn.ExecContext(ctx, `UPDATE tickets SET status='ready_for_review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status!='ready_for_review'`, id); err != nil {
			return out, err
		}
	}
	out.Entry, err = scanWorkLog(conn.QueryRowContext(ctx, workLogSelect+" WHERE id=?", entryID))
	if err != nil {
		return out, err
	}
	out.Ticket, err = scanTicket(conn.QueryRowContext(ctx, ticketSelect+" WHERE t.id=?", id))
	if err != nil {
		return out, err
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return ReviewHandoffResult{}, err
	}
	return out, nil
}

func (a *App) AddWorkLog(ctx context.Context, id int64, in WorkLogNoteInput) (WorkLogEntry, error) {
	out, err := a.Store.appendWorkLog(ctx, id, WorkLogEntry{Kind: "note", Body: in.Body, Author: in.Author})
	if err == nil {
		a.publish()
	}
	return out.Entry, err
}

func (a *App) CreateReviewHandoff(ctx context.Context, id int64, in ReviewHandoffInput) (ReviewHandoffResult, error) {
	out, err := a.Store.appendWorkLog(ctx, id, WorkLogEntry{Kind: "review_handoff", Body: in.Summary, Author: in.Author, Verification: in.Verification, References: in.References, ReviewNotes: in.ReviewNotes})
	if err == nil {
		a.publish()
	}
	return out, err
}
