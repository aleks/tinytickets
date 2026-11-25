package app

import (
	"context"
	"database/sql"
	"errors"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

var (
	ErrInvalid     = errors.New("invalid input")
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("conflict")
	ErrUnavailable = errors.New("unavailable")
)

// Error describes an application failure without depending on a transport.
// Message is safe for clients; Err retains an underlying diagnostic cause.
type Error struct {
	Kind    error
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}
func (e *Error) Unwrap() error        { return e.Err }
func (e *Error) Is(target error) bool { return e.Kind == target }

func invalid(message string) error  { return &Error{Kind: ErrInvalid, Message: message} }
func missing() error                { return &Error{Kind: ErrNotFound, Message: "Not found"} }
func conflict(message string) error { return &Error{Kind: ErrConflict, Message: message} }

// classifyError is shared by transport adapters. Never expose raw SQL/driver
// errors or request content to clients. Cancellation remains detectable with Is.
type errorInfo struct {
	kind    error
	message string
}

func classifyError(err error) errorInfo {
	if errors.Is(err, context.Canceled) {
		return errorInfo{context.Canceled, "Request canceled"}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errorInfo{ErrUnavailable, "Operation timed out"}
	}
	var application *Error
	if errors.As(err, &application) {
		return errorInfo{application.Kind, application.Message}
	}
	var se *sqlite.Error
	if errors.As(err, &se) && (se.Code()&0xff == sqlite3.SQLITE_BUSY || se.Code()&0xff == sqlite3.SQLITE_LOCKED) {
		return errorInfo{ErrUnavailable, "Database is busy; refresh state before trying again"}
	}
	if errors.Is(err, sql.ErrConnDone) {
		return errorInfo{ErrUnavailable, "Database connection is unavailable"}
	}
	return errorInfo{nil, "Internal server error"}
}
