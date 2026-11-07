package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestStatusHistory(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	ctx := context.Background()
	history := func() []StatusEvent {
		t.Helper()
		events, err := a.Store.TicketHistory(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return events
	}
	events := history()
	if len(events) != 1 || events[0].Kind != "created" || events[0].ToStatus != "todo" || events[0].FromStatus != nil {
		t.Fatal(events)
	}
	for _, in := range []Input{{Title: ptr("Renamed")}, {Status: ptr("todo")}, {Description: ptr("Details")}, {Status: ptr("in_progress")}, {Status: ptr("in_progress")}, {Status: ptr("ready_for_review")}, {Status: ptr("done")}, {Status: ptr("in_progress")}} {
		if _, err := a.Mutate(ctx, "tickets", "update", id, in); err != nil {
			t.Fatal(err)
		}
	}
	events = history()
	if len(events) != 5 || *events[1].FromStatus != "todo" || events[4].ToStatus != "in_progress" || *events[4].FromStatus != "done" {
		t.Fatal(events)
	}
	if _, err := a.Mutate(ctx, "tickets", "update", id, Input{Status: ptr("done"), EpicID: ptr(int64(999))}); err == nil {
		t.Fatal("invalid mutation accepted")
	}
	if len(history()) != 5 {
		t.Fatal("failed mutation recorded history")
	}
	tx, err := a.Store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE tickets SET status='done' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	tx.Rollback()
	if len(history()) != 5 {
		t.Fatal("rolled-back mutation recorded history")
	}
	// A pre-upgrade writer need not know about the new table or API.
	if _, err = a.Store.db.Exec("UPDATE tickets SET status='done' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	if len(history()) != 6 {
		t.Fatal("database-level writer bypassed history")
	}
	if _, err = a.Mutate(ctx, "tickets", "delete", id, Input{}); err != nil {
		t.Fatal(err)
	}
	var count int
	a.Store.db.QueryRow("SELECT count(*) FROM ticket_status_events WHERE ticket_id=?", id).Scan(&count)
	if count != 0 {
		t.Fatal("deletion did not cascade history")
	}
	if _, err = a.Store.TicketHistory(ctx, id); err == nil {
		t.Fatal("deleted ticket history should be missing")
	}
}

func TestLegacyHistoryMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	a := New(s)
	p, _, id := seed(t, a)
	_, err = s.db.Exec(`DROP TRIGGER ticket_status_created; DROP TRIGGER ticket_status_changed; DROP TABLE ticket_status_events;
		UPDATE tickets SET status='done',created_at='2020-01-01T00:00:00Z',updated_at='2020-01-02T00:00:00Z'; PRAGMA user_version=1;`)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events, err := s.TicketHistory(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Kind != "baseline" || events[0].ToStatus != "done" || events[0].ChangedAt < "2021" {
		t.Fatal(events)
	}
	report, err := s.ProjectExecution(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	timing := report.Epics[0].Tickets[0]
	if timing.HistoryComplete || timing.StartedAt != nil || timing.CompletedAt != nil || timing.CycleSeconds != nil || len(timing.Segments) != 0 || report.Metrics.PartialHistory != 1 {
		t.Fatal(report)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	events, _ = other.TicketHistory(context.Background(), id)
	if len(events) != 1 {
		t.Fatal("migration is not idempotent")
	}
	if _, err = other.db.Exec("UPDATE tickets SET status='in_progress' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	events, _ = s.TicketHistory(context.Background(), id)
	if len(events) != 2 || events[1].Kind != "transition" {
		t.Fatal("external writes must record transitions", events)
	}
}

func TestFutureHistorySchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s.db.Exec("PRAGMA user_version=99")
	s.Close()
	if opened, err := Open(path); err == nil {
		opened.Close()
		t.Fatal("accepted a newer schema")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 99 {
		t.Fatal("downgraded future database")
	}
}

func TestExecutionDurationsAndReopening(t *testing.T) {
	base := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	event := func(id int64, sec int, status, kind string) StatusEvent {
		return StatusEvent{ID: id, TicketID: 1, ToStatus: status, Kind: kind, ChangedAt: stamp(base.Add(time.Duration(sec) * time.Second))}
	}
	events := []StatusEvent{event(1, 0, "todo", "created"), event(2, 10, "in_progress", "transition"), event(3, 20, "ready_for_review", "transition"), event(4, 30, "in_progress", "transition"), event(5, 50, "done", "transition"), event(6, 60, "in_progress", "transition"), event(7, 70, "todo", "transition"), event(8, 80, "ready_for_review", "transition"), event(9, 100, "done", "transition")}
	ticket := Ticket{ID: 1, EpicID: 1, Status: "done"}
	timing, err := deriveExecution(ticket, events, base.Add(150*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if !timing.HistoryComplete || *timing.CycleSeconds != 90 || timing.InProgressSeconds != 40 || timing.ReviewSeconds != 30 || *timing.CompletedAt != events[8].ChangedAt || len(timing.Segments) != 8 {
		t.Fatal(timing)
	}
	if timing.Segments[3].Status != "done" || timing.Segments[3].End != events[5].ChangedAt || timing.Segments[7].Ongoing {
		t.Fatal(timing.Segments)
	}
	metrics := executionMetrics([]TicketExecution{timing}, nil)
	if *metrics.MedianCompletionSeconds != 90 || metrics.CompletionSamples != 1 {
		t.Fatal(metrics)
	}
	for _, weekly := range []bool{false, true} {
		buckets := completionBuckets([]TicketExecution{timing}, base.Add(150*time.Second), weekly)
		count := 0
		for _, b := range buckets {
			count += b.Tickets
		}
		if count != 1 {
			t.Fatal("reopening double-counted throughput", buckets)
		}
	}
	events = append(events, event(10, 120, "in_progress", "transition"))
	ticket.Status = "in_progress"
	timing, err = deriveExecution(ticket, events, base.Add(150*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if timing.CycleSeconds != nil || timing.CompletedAt != nil || *timing.ActiveAgeSeconds != 140 || timing.InProgressSeconds != 70 || !timing.Segments[len(timing.Segments)-1].Ongoing {
		t.Fatal(timing)
	}
	// Unknown starts never turn into zero-duration completion samples.
	legacy := []StatusEvent{event(1, 0, "in_progress", "baseline"), event(2, 20, "done", "transition")}
	timing, _ = deriveExecution(Ticket{Status: "done"}, legacy, base.Add(150*time.Second))
	if timing.StartedAt != nil || timing.CycleSeconds != nil || timing.InProgressSeconds != 20 || timing.HistoryComplete || timing.CompletedAt == nil {
		t.Fatal(timing)
	}
	metrics = executionMetrics([]TicketExecution{timing}, nil)
	if metrics.MedianCompletionSeconds != nil || metrics.CompletionSamples != 0 {
		t.Fatal(metrics)
	}
	// A ticket created in progress has a real known start; clock rollback cannot produce negative durations.
	timing, _ = deriveExecution(Ticket{Status: "done"}, []StatusEvent{event(1, 10, "in_progress", "created"), event(2, 0, "done", "transition")}, base)
	if timing.CycleSeconds == nil || *timing.CycleSeconds != 0 || timing.InProgressSeconds < 0 {
		t.Fatal(timing)
	}
}

func TestProjectExecutionScope(t *testing.T) {
	a := testApp(t)
	p, e, id := seed(t, a)
	ctx := context.Background()
	otherP := create(t, a, "projects", Input{Name: ptr("Other")})
	otherE := create(t, a, "epics", Input{Title: ptr("Other epic"), ProjectID: &otherP})
	blocker := create(t, a, "tickets", Input{Title: ptr("Blocker"), EpicID: &otherE, Status: ptr("in_progress")})
	if _, err := a.Mutate(ctx, "links", "create", 0, Input{BlockerID: blocker, BlockedID: id}); err != nil {
		t.Fatal(err)
	}
	a.Mutate(ctx, "epics", "update", e, Input{Completed: ptr(true)})
	report, err := a.Store.ProjectExecution(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if report.Metrics.Total != 1 || report.Metrics.Blocked != 1 || report.Metrics.NotStarted != 1 || report.EpicsCompleted != 1 || report.Metrics.MedianCompletionSeconds != nil {
		t.Fatal(report)
	}
	if _, err = a.Mutate(ctx, "tickets", "update", id, Input{EpicID: &otherE, Status: ptr("in_progress")}); err != nil {
		t.Fatal(err)
	}
	report, _ = a.Store.ProjectExecution(ctx, p)
	if report.Metrics.Total != 0 {
		t.Fatal("moved ticket remained in original project")
	}
	report, _ = a.Store.ProjectExecution(ctx, otherP)
	if report.Metrics.Total != 2 || report.Metrics.Active != 2 || len(report.Epics[0].Tickets[0].Segments) == 0 {
		t.Fatal(report)
	}
	h := testHandler(a)
	for _, tc := range []struct {
		method, path string
		code         int
	}{{"GET", "/api/projects/1/execution", 200}, {"GET", "/api/tickets/1/history", 200}, {"GET", "/api/projects/999/execution", 404}, {"GET", "/api/tickets/999/history", 404}, {"GET", "/api/projects/nope/execution", 400}, {"GET", "/api/tickets/0/history", 400}, {"POST", "/api/tickets/1/history", 405}} {
		w := request(h, tc.method, tc.path, "")
		if w.Code != tc.code {
			t.Fatalf("%s: %d %s", tc.path, w.Code, w.Body.String())
		}
	}
	w := request(h, "GET", "/api/tickets/1/history", "")
	var history TicketHistoryResult
	if err = json.Unmarshal(w.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if !history.HistoryComplete || len(history.Events) != 2 {
		t.Fatal(history)
	}
}

func TestExecutionMCP(t *testing.T) {
	a := testApp(t)
	p, _, id := seed(t, a)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	serverSession, err := a.MCP.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "execution-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for _, status := range []string{"in_progress", "ready_for_review", "done"} {
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "update_ticket", Arguments: map[string]any{"id": id, "status": status}})
		if err != nil || res.IsError {
			t.Fatalf("mutation failed: %v %v", res, err)
		}
	}
	for name, args := range map[string]any{"get_ticket_history": map[string]any{"ticket_id": id}, "get_project_execution": map[string]any{"project_id": p}} {
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil || res.IsError {
			t.Fatalf("%s: %v %v", name, res, err)
		}
	}
	events, _ := a.Store.TicketHistory(ctx, id)
	if len(events) != 4 {
		t.Fatal(events)
	}
	report, _ := a.Store.ProjectExecution(ctx, p)
	if report.Metrics.CompletionSamples != 1 || report.Metrics.Completed != 1 {
		t.Fatal(report)
	}
}
