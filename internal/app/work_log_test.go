package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestWorkLogAndHandoff(t *testing.T) {
	a := testApp(t)
	_, e, id := seed(t, a)
	ctx := context.Background()
	if _, err := a.Mutate(ctx, "tickets", "update", id, Input{Status: ptr("in_progress"), Description: ptr("Original specification")}); err != nil {
		t.Fatal(err)
	}
	before, _ := a.Store.Snapshot(ctx)
	ch := make(chan struct{}, 10)
	a.subs[ch] = struct{}{}
	empty, err := a.Store.TicketWorkLog(ctx, id)
	if err != nil || empty.Entries == nil || len(empty.Entries) != 0 {
		t.Fatal(empty, err)
	}
	note, err := a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "  Started **implementation**  ", Author: "  Agent A  "})
	if err != nil || note.Body != "Started **implementation**" || note.Author != "Agent A" || note.Kind != "note" || note.CreatedAt == "" {
		t.Fatal(note, err)
	}
	after, _ := a.Store.Snapshot(ctx)
	if before.Tickets[0].UpdatedAt != after.Tickets[0].UpdatedAt || *before.Tickets[0].StatusSince != *after.Tickets[0].StatusSince {
		t.Fatal("note reset ticket timing")
	}
	handoff, err := a.CreateReviewHandoff(ctx, id, ReviewHandoffInput{Summary: "Added feature", Verification: "make test passed", References: "`abc123`", ReviewNotes: "Check mobile", Author: "Agent B"})
	if err != nil || handoff.Ticket.Status != "ready_for_review" || handoff.Ticket.StatusSince == nil || handoff.Ticket.Description != "Original specification" || handoff.Entry.Kind != "review_handoff" {
		t.Fatal(handoff, err)
	}
	history, _ := a.Store.TicketHistory(ctx, id)
	if len(history) != 3 || history[2].ChangedAt != *handoff.Ticket.StatusSince {
		t.Fatal("handoff history", history)
	}
	again, err := a.CreateReviewHandoff(ctx, id, ReviewHandoffInput{Summary: "Additional context", Verification: "Not rerun; documentation only"})
	if err != nil || *again.Ticket.StatusSince != *handoff.Ticket.StatusSince || again.Ticket.UpdatedAt != handoff.Ticket.UpdatedAt {
		t.Fatal("repeated handoff reset timer", again, err)
	}
	history, _ = a.Store.TicketHistory(ctx, id)
	if len(history) != 3 {
		t.Fatal("no-op status wrote history")
	}
	log, err := a.Store.TicketWorkLog(ctx, id)
	if err != nil || len(log.Entries) != 3 || log.Entries[0].ID != note.ID || log.Entries[1].ID != handoff.Entry.ID || log.Entries[2].ID != again.Entry.ID {
		t.Fatal(log, err)
	}
	if len(ch) != 3 {
		t.Fatal("missing live notifications", len(ch))
	}
	// Archived tickets retain their log and remain intentionally writable.
	if _, err := a.Mutate(ctx, "epics", "update", e, Input{Completed: ptr(true), Archived: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "Archived follow-up"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.db.Exec("UPDATE ticket_work_log SET body='overwrite' WHERE id=?", note.ID); err == nil {
		t.Fatal("log must be immutable")
	}
	if _, err := a.Store.db.Exec("DELETE FROM ticket_work_log WHERE id=?", note.ID); err == nil {
		t.Fatal("independent deletion must be rejected")
	}
	if _, err := a.Mutate(ctx, "tickets", "delete", id, Input{}); err != nil {
		t.Fatal("ticket delete must cascade log", err)
	}
	var remaining int
	if err := a.Store.db.QueryRow("SELECT count(*) FROM ticket_work_log").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal(remaining, err)
	}
}

func TestWorkLogValidationAndAtomicity(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	ctx := context.Background()
	for _, in := range []WorkLogNoteInput{{}, {Body: " \n\t "}, {Body: strings.Repeat("x", 100001)}, {Body: "Text", Author: strings.Repeat("é", 201)}} {
		if _, err := a.AddWorkLog(ctx, id, in); err == nil {
			t.Fatal("accepted invalid note")
		}
	}
	for _, in := range []ReviewHandoffInput{{Summary: "Missing verification"}, {Verification: "Missing summary"}, {Summary: " ", Verification: "Tests passed"}, {Summary: "Summary", Verification: strings.Repeat("x", 100000)}} {
		if _, err := a.CreateReviewHandoff(ctx, id, in); err == nil {
			t.Fatal("accepted invalid handoff")
		}
	}
	for _, bad := range []int64{0, -1, 999} {
		if _, err := a.Store.TicketWorkLog(ctx, bad); err == nil {
			t.Fatal("bad read ID")
		}
		if _, err := a.AddWorkLog(ctx, bad, WorkLogNoteInput{Body: "Text"}); err == nil {
			t.Fatal("bad note ID")
		}
		if _, err := a.CreateReviewHandoff(ctx, bad, ReviewHandoffInput{Summary: "Text", Verification: "Tests passed"}); err == nil {
			t.Fatal("bad handoff ID")
		}
	}
	ch := make(chan struct{}, 1)
	a.subs[ch] = struct{}{}
	if _, err := a.Store.db.Exec(`CREATE TRIGGER reject_handoff AFTER UPDATE OF status ON tickets BEGIN SELECT RAISE(ABORT,'handoff failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateReviewHandoff(ctx, id, ReviewHandoffInput{Summary: "Text", Verification: "Passed"}); err == nil {
		t.Fatal("expected failed transition")
	}
	log, _ := a.Store.TicketWorkLog(ctx, id)
	state, _ := a.Store.Snapshot(ctx)
	history, _ := a.Store.TicketHistory(ctx, id)
	if len(log.Entries) != 0 || state.Tickets[0].Status != "todo" || len(history) != 1 || len(ch) != 0 {
		t.Fatal("partial handoff leaked", log, state, history)
	}
	if _, err := a.Store.db.Exec("DROP TRIGGER reject_handoff"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateReviewHandoff(ctx, id, ReviewHandoffInput{Summary: "Text", Verification: "Not run; manual review requested"}); err != nil {
		t.Fatal("failed transaction not cleaned up", err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := a.AddWorkLog(canceled, id, WorkLogNoteInput{Body: "Must not persist"}); err == nil {
		t.Fatal("canceled append succeeded")
	}
	log, err := a.Store.TicketWorkLog(ctx, id)
	if err != nil || len(log.Entries) != 1 {
		t.Fatal("canceled append changed log", log, err)
	}
}

func TestWorkLogMigrationPersistenceAndConcurrency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "log.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	a := New(s)
	_, _, id := seed(t, a)
	// Recreate the schema-v3 boundary without work-log tables or triggers.
	if _, err := s.db.Exec("DROP TRIGGER work_log_no_update; DROP TRIGGER work_log_no_delete; DROP TABLE ticket_work_log; PRAGMA user_version=3"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a = New(s)
	ctx := context.Background()
	if log, err := s.TicketWorkLog(ctx, id); err != nil || len(log.Entries) != 0 {
		t.Fatal(log, err)
	}
	if _, err := a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "Persisted note"}); err != nil {
		t.Fatal(err)
	}
	// Repairing an older process's schema marker must not erase existing entries.
	if _, err := s.db.Exec("PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	var version int
	if err := other.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 4 {
		t.Fatal(version, err)
	}
	apps := []*App{a, New(other)}
	var wg sync.WaitGroup
	for _, app := range apps {
		wg.Add(1)
		go func(app *App) {
			defer wg.Done()
			for i := 0; i < 12; i++ {
				if _, err := app.AddWorkLog(ctx, id, WorkLogNoteInput{Body: fmt.Sprintf("Parallel note %d", i)}); err != nil {
					t.Error(err)
				}
			}
		}(app)
	}
	wg.Wait()
	log, err := other.TicketWorkLog(ctx, id)
	if err != nil || len(log.Entries) != 25 || log.Entries[0].Body != "Persisted note" {
		t.Fatal(log, err)
	}
	for i := 1; i < len(log.Entries); i++ {
		if log.Entries[i].ID <= log.Entries[i-1].ID {
			t.Fatal("unstable append ordering")
		}
	}
	state, _ := other.Snapshot(ctx)
	if state.Tickets[0].Status != "todo" {
		t.Fatal("notes changed status")
	}
}

func TestWorkLogREST(t *testing.T) {
	a := testApp(t)
	seed(t, a)
	h := testHandler(a)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/tickets/1/work-log", "", 200},
		{"GET", "/api/tickets/0/work-log", "", 400},
		{"GET", "/api/tickets/nope/work-log", "", 400},
		{"GET", "/api/tickets/999/work-log", "", 404},
		{"POST", "/api/tickets/999/work-log", `{"body":"Note"}`, 404},
		{"POST", "/api/tickets/1/work-log", `{"body":"  "}`, 400},
		{"POST", "/api/tickets/1/work-log", `{"body":"Note","created_at":"2000-01-01"}`, 400},
		{"POST", "/api/tickets/1/work-log", `null`, 400},
		{"POST", "/api/tickets/1/work-log", `{} {}`, 400},
		{"PATCH", "/api/tickets/1/work-log", `{"body":"No"}`, 405},
		{"DELETE", "/api/tickets/1/work-log", "", 405},
		{"GET", "/api/tickets/1/review-handoff", "", 405},
		{"POST", "/api/tickets/0/review-handoff", `{}`, 400},
		{"POST", "/api/tickets/999/review-handoff", `{"summary":"Changes","verification":"Passed"}`, 404},
		{"POST", "/api/tickets/1/review-handoff", `{"summary":"Changes"}`, 400},
		{"POST", "/api/tickets/1/review-handoff", `{"summary":"Changes","verification":"Passed","status":"done"}`, 400},
		{"POST", "/api/tickets/1/work-log", `{"body":"First note","author":"Agent"}`, 201},
		{"POST", "/api/tickets/1/review-handoff", `{"summary":"Changes","verification":"Passed","references":"abc123","review_notes":"Check UI"}`, 201},
	} {
		w := request(h, tc.method, tc.path, tc.body)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	w := request(h, "GET", "/api/tickets/1/work-log", "")
	var log WorkLogResult
	if err := json.Unmarshal(w.Body.Bytes(), &log); err != nil || len(log.Entries) != 2 || log.Entries[0].Kind != "note" || log.Entries[1].References != "abc123" {
		t.Fatal(w.Body.String(), err)
	}
	state, _ := a.Store.Snapshot(context.Background())
	if state.Tickets[0].Status != "ready_for_review" {
		t.Fatal("handoff did not request review")
	}
}

func TestWorkLogMCP(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "work-log-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if !strings.Contains(session.InitializeResult().Instructions, "Use add_work_log") || !strings.Contains(session.InitializeResult().Instructions, "create_review_handoff") {
		t.Fatal("missing agent work-log guidance")
	}
	call := func(name string, args map[string]any, wantError bool) []byte {
		t.Helper()
		out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil || out.IsError != wantError {
			t.Fatalf("%s: %v %v", name, out, err)
		}
		raw, err := json.Marshal(out.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	call("add_work_log", map[string]any{"ticket_id": id, "body": "Progress", "author": "Agent"}, false)
	call("add_work_log", map[string]any{"ticket_id": id, "body": " "}, true)
	call("create_review_handoff", map[string]any{"ticket_id": id, "summary": "Changes"}, true)
	var handoff ReviewHandoffResult
	if err := json.Unmarshal(call("create_review_handoff", map[string]any{"ticket_id": id, "summary": "Changes", "verification": "Tests passed", "references": "abc123", "review_notes": "Check accessibility"}, false), &handoff); err != nil || handoff.Ticket.Status != "ready_for_review" || handoff.Ticket.StatusSince == nil {
		t.Fatal(handoff, err)
	}
	var log WorkLogResult
	if err := json.Unmarshal(call("get_ticket_work_log", map[string]any{"ticket_id": id}, false), &log); err != nil || len(log.Entries) != 2 || log.Entries[0].Body != "Progress" || log.Entries[1].ReviewNotes != "Check accessibility" {
		t.Fatal(log, err)
	}
}
