package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

type StatusEvent struct {
	ID         int64   `json:"id"`
	TicketID   int64   `json:"ticket_id"`
	FromStatus *string `json:"from_status"`
	ToStatus   string  `json:"to_status"`
	ChangedAt  string  `json:"changed_at"`
	Kind       string  `json:"kind"`
}

type TicketHistoryResult struct {
	TicketID        int64         `json:"ticket_id"`
	HistoryComplete bool          `json:"history_complete"`
	Events          []StatusEvent `json:"events"`
}

func historyResult(id int64, events []StatusEvent) TicketHistoryResult {
	return TicketHistoryResult{TicketID: id, HistoryComplete: len(events) > 0 && events[0].Kind == "created", Events: events}
}

const supportedSchemaVersion = 4

const baseSchema = `
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
`

func schemaVersion(ctx context.Context, q readyQuerier) (int, error) {
	var version int
	if err := q.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, err
	}
	if version > supportedSchemaVersion {
		return version, fmt.Errorf("database schema version %d is newer than supported version %d", version, supportedSchemaVersion)
	}
	return version, nil
}

func initializeDatabase(db *sql.DB) error {
	ctx := context.Background()
	// Reject unsupported files before even changing their persistent journal mode.
	if _, err := schemaVersion(ctx, db); err != nil {
		return err
	}
	if err := enableWAL(ctx, db); err != nil {
		return err
	}
	return migrateDatabase(db)
}

func enableWAL(ctx context.Context, db *sql.DB) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := db.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
			var se *sqlite.Error
			if !errors.As(err, &se) || se.Code()&0xff != sqlite3.SQLITE_BUSY {
				return fmt.Errorf("configure journal mode: %w", err)
			}
			// Concurrent first opens can contend while switching journal mode.
			// Retrying this idempotent setting is safe; application writes are
			// never retried, including commits with an uncertain outcome.
			select {
			case <-ctx.Done():
				return fmt.Errorf("configure journal mode: %w", ctx.Err())
			case <-ticker.C:
			}
			continue
		}
		return nil
	}
}

// Initialization, upgrades and baseline capture share one writer reservation.
// Recheck the version after acquiring it: another process may have migrated first.
func migrateDatabase(db *sql.DB) error {
	ctx := context.Background()
	conn, err := beginWrite(ctx, db)
	if err != nil {
		return err
	}
	defer conn.Rollback()
	version, err := schemaVersion(ctx, conn)
	if err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, baseSchema); err != nil {
		return err
	}
	if version < 2 {
		// v1 binaries unconditionally reset user_version on open. Existing v2
		// events/triggers must survive repairing that marker without duplicates.
		_, err = conn.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS ticket_status_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
				from_status TEXT CHECK(from_status IN ('todo','in_progress','ready_for_review','done')),
				to_status TEXT NOT NULL CHECK(to_status IN ('todo','in_progress','ready_for_review','done')),
				changed_at TEXT NOT NULL,
				kind TEXT NOT NULL CHECK(kind IN ('created','baseline','transition'))
			);
			CREATE INDEX IF NOT EXISTS status_events_ticket ON ticket_status_events(ticket_id, id);
			INSERT INTO ticket_status_events(ticket_id, to_status, changed_at, kind)
				SELECT id, status, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'baseline' FROM tickets
				WHERE NOT EXISTS (SELECT 1 FROM ticket_status_events h WHERE h.ticket_id=tickets.id);
			CREATE TRIGGER IF NOT EXISTS ticket_status_created AFTER INSERT ON tickets BEGIN
				INSERT INTO ticket_status_events(ticket_id, to_status, changed_at, kind)
				VALUES (NEW.id, NEW.status, NEW.created_at, 'created');
			END;
			CREATE TRIGGER IF NOT EXISTS ticket_status_changed AFTER UPDATE OF status ON tickets
			WHEN NEW.status != OLD.status BEGIN
				INSERT INTO ticket_status_events(ticket_id, from_status, to_status, changed_at, kind)
				VALUES (NEW.id, OLD.status, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'transition');
			END;
			PRAGMA user_version = 2;
		`)
		if err != nil {
			return err
		}
	}
	if version < 3 {
		// Older v1 binaries can reset the version marker. Preserve an existing
		// archive column and its values when repairing that marker.
		var columns int
		if err = conn.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info('epics') WHERE name='archived'").Scan(&columns); err != nil {
			return err
		}
		if columns == 0 {
			_, err = conn.ExecContext(ctx, `ALTER TABLE epics ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
				CHECK(archived IN (0,1) AND (archived=0 OR completed=1))`)
			if err != nil {
				return err
			}
		}
		if _, err = conn.ExecContext(ctx, "PRAGMA user_version=3"); err != nil {
			return err
		}
	}
	if version < 4 {
		if err = migrateWorkLog(ctx, conn.Conn); err != nil {
			return err
		}
	}
	return conn.Commit()
}

func historyTx(ctx context.Context, tx *sql.Tx, ticketID, projectID int64) ([]StatusEvent, error) {
	rows, err := tx.QueryContext(ctx, `SELECT h.id, h.ticket_id, h.from_status, h.to_status, h.changed_at, h.kind
		FROM ticket_status_events h JOIN tickets t ON t.id=h.ticket_id JOIN epics e ON e.id=t.epic_id
		WHERE (?=0 OR t.id=?) AND (?=0 OR e.project_id=?) ORDER BY h.id`, ticketID, ticketID, projectID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []StatusEvent{}
	for rows.Next() {
		var e StatusEvent
		if err := rows.Scan(&e.ID, &e.TicketID, &e.FromStatus, &e.ToStatus, &e.ChangedAt, &e.Kind); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func (s *Store) TicketHistory(ctx context.Context, id int64) ([]StatusEvent, error) {
	if id <= 0 {
		return nil, invalid("A positive ticket ID is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM tickets WHERE id=?", id).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, missing()
	}
	events, err := historyTx(ctx, tx, id, 0)
	if err != nil {
		return nil, err
	}
	return events, tx.Commit()
}
