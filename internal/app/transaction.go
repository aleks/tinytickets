package app

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"time"
)

// writeTx reserves SQLite's writer before any validation reads. The reservation
// protects against other HTTP/stdio processes, unlike the Store mutex alone.
// It never retries writes: a failed COMMIT can have an uncertain outcome.
type writeTx struct {
	*sql.Conn
	ctx  context.Context
	done bool
}

func beginWrite(ctx context.Context, db *sql.DB) (*writeTx, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire write connection: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("reserve SQLite writer: %w", err)
	}
	return &writeTx{Conn: conn, ctx: ctx}, nil
}

func (tx *writeTx) Commit() error {
	if tx.done {
		return sql.ErrTxDone
	}
	if _, err := tx.ExecContext(tx.ctx, "COMMIT"); err != nil {
		return err // The caller's deferred Rollback releases/discards the connection.
	}
	tx.done = true
	_ = tx.Conn.Close()
	return nil
}

func (tx *writeTx) Rollback() error {
	if tx.done {
		return nil
	}
	tx.done = true
	// Request cancellation must not prevent cleanup, or leave the pool holding
	// a write reservation. Bound cleanup and discard an unusable connection.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := tx.ExecContext(ctx, "ROLLBACK")
	if err != nil {
		_ = tx.Raw(func(any) error { return driver.ErrBadConn })
	}
	_ = tx.Conn.Close()
	return err
}
