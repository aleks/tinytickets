package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestTicketCurrentColumnEntry(t *testing.T) {
	a := testApp(t)
	_, e, id := seed(t, a)
	ctx := context.Background()
	read := func() Ticket {
		t.Helper()
		state, err := a.Store.Snapshot(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, ticket := range state.Tickets {
			if ticket.ID == id {
				return ticket
			}
		}
		t.Fatal("ticket missing")
		return Ticket{}
	}
	move := func(status string) Ticket {
		t.Helper()
		result, err := a.Mutate(ctx, "tickets", "update", id, Input{Status: &status})
		if err != nil {
			t.Fatal(err)
		}
		return result.(Ticket)
	}
	if read().StatusSince != nil {
		t.Fatal("todo must not have a timer")
	}
	ticket := move("in_progress")
	if ticket.StatusSince == nil {
		t.Fatal("in-progress entry time missing")
	}
	history, err := a.Store.TicketHistory(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if *ticket.StatusSince != history[len(history)-1].ChangedAt {
		t.Fatal("not using the latest transition")
	}
	// Use an older known entry in this isolated fixture to distinguish it from
	// updated_at and prove that edits/no-ops preserve the column-entry anchor.
	older := "2020-01-01T00:00:00.000Z"
	if _, err = a.Store.db.Exec("UPDATE ticket_status_events SET changed_at=? WHERE id=?", older, history[len(history)-1].ID); err != nil {
		t.Fatal(err)
	}
	for _, in := range []Input{{Title: ptr("Renamed")}, {Description: ptr("Changed")}, {Status: ptr("in_progress")}, {EpicID: &e}} {
		out, err := a.Mutate(ctx, "tickets", "update", id, in)
		if err != nil {
			t.Fatal(err)
		}
		if out.(Ticket).StatusSince == nil || *out.(Ticket).StatusSince != older {
			t.Fatal("ordinary edit reset the timer", out)
		}
	}
	if *read().StatusSince != older {
		t.Fatal("snapshot lost the entry anchor")
	}
	ticket = move("ready_for_review")
	if ticket.StatusSince == nil || *ticket.StatusSince == older {
		t.Fatal("review should start a new counter", ticket)
	}
	ticket = move("in_progress")
	history, _ = a.Store.TicketHistory(ctx, id)
	if ticket.StatusSince == nil || *ticket.StatusSince != history[len(history)-1].ChangedAt || *ticket.StatusSince == older {
		t.Fatal("returning to progress reused an earlier visit", ticket)
	}
	for _, status := range []string{"todo", "done", "todo", "ready_for_review", "done", "in_progress"} {
		ticket = move(status)
		timed := status == "in_progress" || status == "ready_for_review"
		if (ticket.StatusSince != nil) != timed {
			t.Fatal(status, ticket)
		}
	}
	for _, status := range []string{"todo", "in_progress", "ready_for_review", "done"} {
		out, err := a.Mutate(ctx, "tickets", "create", 0, Input{EpicID: &e, Title: ptr("Created in " + status), Status: &status})
		if err != nil {
			t.Fatal(err)
		}
		created := out.(Ticket)
		if status == "in_progress" || status == "ready_for_review" {
			if created.StatusSince == nil || *created.StatusSince != created.CreatedAt {
				t.Fatal("creation in a timed column must have a known entry", created)
			}
		} else if created.StatusSince != nil {
			t.Fatal(created)
		}
	}
	h := testHandler(a)
	if w := request(h, "PATCH", "/api/tickets/1", `{"status_since":"1999-01-01T00:00:00Z"}`); w.Code != 400 {
		t.Fatal("column-entry time must remain read-only", w.Code, w.Body.String())
	}
	for _, path := range []string{"/api/tickets/1", "/api/tickets"} {
		w := request(h, "GET", path, "")
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var tickets []Ticket
		if path == "/api/tickets/1" {
			var ticket Ticket
			if err := json.Unmarshal(w.Body.Bytes(), &ticket); err != nil {
				t.Fatal(err)
			}
			tickets = []Ticket{ticket}
		} else if err := json.Unmarshal(w.Body.Bytes(), &tickets); err != nil {
			t.Fatal(err)
		}
		if tickets[0].StatusSince == nil || *tickets[0].StatusSince != *read().StatusSince {
			t.Fatal("REST response disagrees with snapshot", tickets)
		}
	}
}

func TestLegacyColumnEntryAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "column-timer.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	a := New(s)
	_, _, id := seed(t, a)
	ctx := context.Background()
	// Simulate a legacy ticket whose only record is the migration baseline.
	_, err = s.db.Exec("UPDATE ticket_status_events SET kind='baseline',to_status='in_progress' WHERE ticket_id=?", id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec("DROP TRIGGER ticket_status_changed; UPDATE tickets SET status='in_progress',created_at='2019-01-01T00:00:00Z',updated_at='2020-01-01T00:00:00Z' WHERE id=?; PRAGMA user_version=1", id)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if state.Tickets[0].StatusSince != nil {
		t.Fatal("legacy baseline was treated as a known start")
	}
	for _, in := range []Input{{Title: ptr("Edited legacy ticket")}, {Status: ptr("in_progress")}} {
		out, err := s.Mutate(ctx, "tickets", "update", id, in)
		if err != nil {
			t.Fatal(err)
		}
		if out.(Ticket).StatusSince != nil {
			t.Fatal("legacy timing fabricated by an edit")
		}
	}
	// Old/direct writers are covered by the existing database history trigger.
	if _, err = s.db.Exec("UPDATE tickets SET status='ready_for_review' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	state, err = s.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if state.Tickets[0].StatusSince == nil {
		t.Fatal("observed transition must start a timer")
	}
	anchor := *state.Tickets[0].StatusSince
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state, err = s.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if state.Tickets[0].StatusSince == nil || *state.Tickets[0].StatusSince != anchor {
		t.Fatal("entry time did not persist")
	}
}

func TestColumnTimerMCP(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "column-timer-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for _, status := range []string{"in_progress", "ready_for_review", "todo", "ready_for_review", "done"} {
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "update_ticket", Arguments: map[string]any{"id": id, "status": status}})
		if err != nil || result.IsError {
			t.Fatalf("tool call failed: %v %v", result, err)
		}
		encoded, err := json.Marshal(result.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		var ticket Ticket
		if err = json.Unmarshal(encoded, &ticket); err != nil {
			t.Fatal(err)
		}
		timed := status == "in_progress" || status == "ready_for_review"
		if ticket.Status != status || (ticket.StatusSince != nil) != timed {
			t.Fatal("MCP mutation did not expose the current entry time", ticket)
		}
	}
}
