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

func TestEpicArchiveLifecycle(t *testing.T) {
	a := testApp(t)
	p, e, ticket := seed(t, a)
	ctx := context.Background()
	for _, in := range []Input{{Archived: ptr(true)}, {Archived: ptr(true), Completed: ptr(false)}} {
		if _, err := a.Mutate(ctx, "epics", "update", e, in); err == nil {
			t.Fatal("archived an incomplete epic")
		}
	}
	if _, err := a.Mutate(ctx, "epics", "create", 0, Input{Title: ptr("Invalid"), ProjectID: &p, Archived: ptr(true)}); err == nil {
		t.Fatal("created an archived incomplete epic")
	}
	for _, status := range []string{"in_progress", "done"} {
		if _, err := a.Mutate(ctx, "tickets", "update", ticket, Input{Status: &status}); err != nil {
			t.Fatal(err)
		}
	}
	before, err := a.Store.ProjectExecution(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	historyBefore, _ := a.Store.TicketHistory(ctx, ticket)
	out, err := a.Mutate(ctx, "epics", "update", e, Input{Completed: ptr(true), Archived: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	if !out.(Epic).Archived || !out.(Epic).Completed {
		t.Fatal(out)
	}
	for _, in := range []Input{{Completed: ptr(false)}, {Completed: ptr(false), Archived: ptr(true)}} {
		_, err := a.Mutate(ctx, "epics", "update", e, in)
		if err == nil {
			t.Fatal("reopened an archived epic")
		}
		code, _ := errorStatus(err)
		if code != 400 {
			t.Fatal(err)
		}
	}
	if _, err := a.Store.db.Exec("UPDATE epics SET completed=0 WHERE id=?", e); err == nil {
		t.Fatal("database invariant allowed a legacy writer to reopen an archived epic")
	}
	if _, err := a.Store.db.Exec("INSERT INTO epics(project_id,title,completed,archived) VALUES (?,'Invalid',0,1)", p); err == nil {
		t.Fatal("database invariant allowed an invalid insert")
	}
	state, err := a.Store.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Epics) != 1 || !state.Epics[0].Archived || len(state.Tickets) != 1 || state.Tickets[0].ID != ticket {
		t.Fatal("archiving damaged the workspace", state)
	}
	historyAfter, _ := a.Store.TicketHistory(ctx, ticket)
	if len(historyAfter) != len(historyBefore) {
		t.Fatal("archiving changed ticket history")
	}
	report, err := a.Store.ProjectExecution(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Epics) != 0 || report.EpicsArchived != 1 || report.EpicsTotal != 1 || report.EpicsCompleted != 1 || report.Metrics.Total != before.Metrics.Total || report.Metrics.Completed != before.Metrics.Completed || report.Metrics.CompletionSamples != before.Metrics.CompletionSamples {
		t.Fatal(report)
	}
	if report.DailyCompletions[len(report.DailyCompletions)-1].Tickets != before.DailyCompletions[len(before.DailyCompletions)-1].Tickets {
		t.Fatal("archiving removed throughput")
	}
	h := testHandler(a)
	for _, tc := range []struct {
		path  string
		count int
	}{
		{"/api/epics", 0}, {"/api/epics?archived=false", 0}, {"/api/epics?archived=true", 1},
		{"/api/epics?include_archived=true", 1}, {"/api/epics?include_archived=true&archived=false", 0},
		{"/api/epics?project_id=999&archived=true", 0}, {"/api/tickets", 0}, {"/api/tickets?include_archived=true", 1},
	} {
		w := request(h, "GET", tc.path, "")
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var items []json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &items); err != nil {
			t.Fatal(err)
		}
		if len(items) != tc.count {
			t.Fatalf("%s: %d, want %d", tc.path, len(items), tc.count)
		}
	}
	for _, path := range []string{"/api/epics/1", "/api/tickets/1", "/api/tickets/1/history", "/api/state", "/api/projects/1/execution"} {
		if w := request(h, "GET", path, ""); w.Code != 200 {
			t.Fatalf("direct access %s: %s", path, w.Body.String())
		}
	}
	for _, path := range []string{"/api/epics?archived=invalid", "/api/epics?include_archived=invalid", "/api/tickets?include_archived=invalid"} {
		if w := request(h, "GET", path, ""); w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
	if w := request(h, "PATCH", "/api/epics/1", `{"completed":false}`); w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request(h, "PATCH", "/api/epics/1", `{"archived":false}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	state, _ = a.Store.Snapshot(ctx)
	if state.Epics[0].Archived || !state.Epics[0].Completed {
		t.Fatal("unarchive should preserve completion")
	}
	if _, err = a.Mutate(ctx, "epics", "update", e, Input{Archived: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Mutate(ctx, "epics", "update", e, Input{Archived: ptr(false), Completed: ptr(false)}); err != nil {
		t.Fatal("combined restore/reopen must be atomic", err)
	}
	state, _ = a.Store.Snapshot(ctx)
	if state.Epics[0].Archived || state.Epics[0].Completed {
		t.Fatal(state.Epics)
	}
}

func TestArchiveMigrationAndMarkerRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "archive.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	a := New(s)
	_, e, ticket := seed(t, a)
	// Recreate the pre-archive v2 schema, preserving status events and tickets.
	if _, err = s.db.Exec("ALTER TABLE epics DROP COLUMN archived; PRAGMA user_version=2"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Epics) != 1 || state.Epics[0].Archived || len(state.Tickets) != 1 {
		t.Fatal(state)
	}
	if _, err = s.Mutate(context.Background(), "epics", "update", e, Input{Completed: ptr(true), Archived: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec("PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state, _ = s.Snapshot(context.Background())
	if !state.Epics[0].Archived || !state.Epics[0].Completed {
		t.Fatal("migration reset archive state")
	}
	history, err := s.TicketHistory(context.Background(), ticket)
	if err != nil || len(history) != 1 || history[0].Kind != "created" {
		t.Fatal("migration changed known history", history, err)
	}
	var version int
	s.db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 3 {
		t.Fatal(version)
	}
}

func TestArchiveMCP(t *testing.T) {
	a := testApp(t)
	_, e, _ := seed(t, a)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "archive-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	call := func(args map[string]any, wantError bool) {
		t.Helper()
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "update_epic", Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if result.IsError != wantError {
			t.Fatalf("unexpected tool result: %+v", result)
		}
	}
	call(map[string]any{"id": e, "archived": true}, true)
	call(map[string]any{"id": e, "completed": true, "archived": true}, false)
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "get_workspace", Arguments: map[string]any{}})
	if err != nil || result.IsError {
		t.Fatalf("workspace not discoverable: %v %v", result, err)
	}
	state, _ := a.Store.Snapshot(ctx)
	if !state.Epics[0].Archived {
		t.Fatal(state)
	}
	call(map[string]any{"id": e, "completed": false}, true)
	call(map[string]any{"id": e, "archived": false}, false)
	state, _ = a.Store.Snapshot(ctx)
	if state.Epics[0].Archived || !state.Epics[0].Completed {
		t.Fatal(state)
	}
	call(map[string]any{"id": e, "completed": false}, false)
}
