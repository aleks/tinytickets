package app

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func ptr[T any](v T) *T { return &v }

func testApp(t *testing.T) *App {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return New(s)
}

func create(t *testing.T, a *App, kind string, in Input) int64 {
	t.Helper()
	out, err := a.Mutate(context.Background(), kind, "create", 0, in)
	if err != nil {
		t.Fatal(err)
	}
	switch v := out.(type) {
	case Project:
		return v.ID
	case Epic:
		return v.ID
	case Ticket:
		return v.ID
	}
	t.Fatal("unexpected result")
	return 0
}

func seed(t *testing.T, a *App) (int64, int64, int64) {
	t.Helper()
	p := create(t, a, "projects", Input{Name: ptr("Project")})
	e := create(t, a, "epics", Input{Title: ptr("Epic"), ProjectID: &p})
	ticket := create(t, a, "tickets", Input{Title: ptr("First ticket"), EpicID: &e})
	return p, e, ticket
}

func TestHierarchyAndValidation(t *testing.T) {
	a := testApp(t)
	p, e, ticket := seed(t, a)
	cases := []struct {
		kind, action string
		id           int64
		in           Input
		status       int
	}{
		{"projects", "create", 0, Input{Name: ptr("  ")}, 400},
		{"projects", "create", 0, Input{Name: ptr(strings.Repeat("x", 201))}, 400},
		{"epics", "create", 0, Input{Title: ptr("Orphan")}, 400},
		{"epics", "create", 0, Input{Title: ptr("Orphan"), ProjectID: ptr(int64(999))}, 400},
		{"tickets", "create", 0, Input{Title: ptr("Orphan")}, 400},
		{"tickets", "update", ticket, Input{EpicID: ptr(int64(999))}, 400},
		{"tickets", "update", ticket, Input{Status: ptr("unknown")}, 400},
		{"tickets", "update", ticket, Input{Description: ptr(strings.Repeat("x", 100001))}, 400},
		{"tickets", "update", 999, Input{Title: ptr("Missing")}, 404},
		{"projects", "delete", p, Input{}, 409},
		{"epics", "delete", e, Input{}, 409},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s_%s_%d_%v", tc.kind, tc.action, tc.id, tc.in), func(t *testing.T) {
			_, err := a.Mutate(context.Background(), tc.kind, tc.action, tc.id, tc.in)
			if err == nil {
				t.Fatal("expected validation error")
			}
			code, _ := errorStatus(err)
			if code != tc.status {
				t.Fatalf("status %d, want %d: %v", code, tc.status, err)
			}
		})
	}
	for _, status := range []string{"in_progress", "ready_for_review", "done", "todo"} {
		out, err := a.Mutate(context.Background(), "tickets", "update", ticket, Input{Status: &status, Description: ptr("Details")})
		if err != nil {
			t.Fatal(err)
		}
		if out.(Ticket).Status != status || out.(Ticket).Title != "First ticket" {
			t.Fatal(out)
		}
	}
	if _, err := a.Mutate(context.Background(), "epics", "update", e, Input{Completed: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	state, _ := a.Store.Snapshot(context.Background())
	if !state.Epics[0].Completed || len(state.Tickets) != 1 {
		t.Fatal("completion must preserve tickets")
	}
}

func TestDependencies(t *testing.T) {
	a := testApp(t)
	_, e, first := seed(t, a)
	second := create(t, a, "tickets", Input{Title: ptr("Second"), EpicID: &e})
	third := create(t, a, "tickets", Input{Title: ptr("Third"), EpicID: &e})
	for _, l := range []Link{{first, second}, {second, third}, {first, second}} {
		if _, err := a.Mutate(context.Background(), "links", "create", 0, Input{BlockerID: l.BlockerID, BlockedID: l.BlockedID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, l := range []Link{{third, first}, {second, first}, {first, first}, {first, 999}} {
		if _, err := a.Mutate(context.Background(), "links", "create", 0, Input{BlockerID: l.BlockerID, BlockedID: l.BlockedID}); err == nil {
			t.Fatalf("accepted invalid dependency: %v", l)
		}
	}
	state, _ := a.Store.Snapshot(context.Background())
	if len(state.Links) != 2 {
		t.Fatalf("idempotent insert: %v", state.Links)
	}
	if _, err := a.Mutate(context.Background(), "tickets", "delete", second, Input{}); err != nil {
		t.Fatal(err)
	}
	state, _ = a.Store.Snapshot(context.Background())
	if len(state.Links) != 0 {
		t.Fatal("ticket deletion must cascade links")
	}
	if _, err := a.Mutate(context.Background(), "links", "delete", 0, Input{BlockerID: first, BlockedID: second}); err != nil {
		t.Fatalf("unlink must remain idempotent after ticket deletion: %v", err)
	}
}

func TestPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "tickets.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seed(t, New(s))
	s.Close()
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Projects) != 1 || len(state.Epics) != 1 || len(state.Tickets) != 1 {
		t.Fatal(state)
	}
}

func testHandler(a *App) http.Handler {
	return a.Handler(fstest.MapFS{"index.html": {Data: []byte("<html>app</html>")}, "assets/app.js": {Data: []byte("console.log('app')")}})
}

func request(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestREST(t *testing.T) {
	a := testApp(t)
	p, e, ticket := seed(t, a)
	h := testHandler(a)
	cases := []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/state", "", 200},
		{"GET", "/api/projects", "", 200},
		{"GET", fmt.Sprintf("/api/epics?project_id=%d&completed=false", p), "", 200},
		{"GET", fmt.Sprintf("/api/tickets?epic_id=%d&status=todo", e), "", 200},
		{"GET", fmt.Sprintf("/api/tickets/%d", ticket), "", 200},
		{"GET", "/api/tickets/999", "", 404},
		{"GET", "/api/tickets/nope", "", 400},
		{"GET", "/api/unknown", "", 404},
		{"POST", "/api/projects", `{"name":"New project"}`, 201},
		{"POST", "/api/projects", `{"name":"New project","unknown":true}`, 400},
		{"POST", "/api/projects", `not json`, 400},
		{"POST", "/api/projects", `{"name":"New project"} {}`, 400},
		{"POST", "/api/projects", `null`, 400},
		{"PATCH", fmt.Sprintf("/api/tickets/%d", ticket), `{"status":"done"}`, 200},
		{"PUT", "/api/projects", `{}`, 405},
		{"POST", "/api/projects/1", `{}`, 405},
		{"GET", "/", "", 200},
		{"GET", "/project/1", "", 200},
		{"GET", "/assets/app.js", "", 200},
		{"GET", "/assets/missing.js", "", 404},
	}
	for _, tc := range cases {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) {
			w := request(h, tc.method, tc.path, tc.body)
			if w.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
	w := request(h, "GET", "/api/tickets?status=done", "")
	var tickets []Ticket
	if err := json.Unmarshal(w.Body.Bytes(), &tickets); err != nil {
		t.Fatal(err)
	}
	if len(tickets) != 1 || tickets[0].Status != "done" {
		t.Fatal(tickets)
	}
	for _, origin := range []string{"https://evil.example", "null"} {
		r := httptest.NewRequest("POST", "http://localhost/api/projects", strings.NewReader(`{"name":"evil"}`))
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("cross origin %q accepted", origin)
		}
	}
}

func TestLiveUpdates(t *testing.T) {
	a := testApp(t)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	reader := bufio.NewReader(res.Body)
	readEvent := func() {
		t.Helper()
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			if line == "\n" {
				return
			}
		}
	}
	readEvent() // initial sync
	create(t, a, "projects", Input{Name: ptr("Live project")})
	readEvent() // mutation event
}

func TestExternalDatabaseUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	a := New(s)
	ch := make(chan struct{}, 1)
	a.subs[ch] = struct{}{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Establish the baseline before making an external write.
	var baseline int64
	if err := s.db.QueryRow("PRAGMA data_version").Scan(&baseline); err != nil {
		t.Fatal(err)
	}
	if _, err := other.Mutate(ctx, "projects", "create", 0, Input{Name: ptr("External")}); err != nil {
		t.Fatal(err)
	}
	var next int64
	s.db.QueryRow("PRAGMA data_version").Scan(&next)
	if next == baseline {
		t.Fatal("external writes must change the SQLite data version")
	}
	// Repeated external writes avoid racing the watcher's initial baseline read.
	done := make(chan struct{})
	go func() { a.WatchDatabase(ctx); close(done) }()
	writes := time.NewTicker(100 * time.Millisecond)
	defer writes.Stop()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
waiting:
	for {
		select {
		case <-ch:
			break waiting
		case <-writes.C:
			if _, err := other.Mutate(ctx, "projects", "create", 0, Input{Name: ptr("Another external write")}); err != nil {
				t.Fatal(err)
			}
		case <-deadline.C:
			t.Fatal("watcher did not notify subscribers about external database writes")
		}
	}
	// Watcher must shut down promptly as well as tolerate a shared database.
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("watcher failed to stop")
	}
}

func TestMCP(t *testing.T) {
	a := testApp(t)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) < 12 {
		t.Fatalf("missing tools: %d", len(tools.Tools))
	}
	call := func(name string, args any) *mcp.CallToolResult {
		t.Helper()
		out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if out.IsError {
			t.Fatalf("tool %s: %v", name, out.Content)
		}
		return out
	}
	call("create_project", map[string]any{"name": "Agent project"})
	call("create_epic", map[string]any{"project_id": 1, "title": "Agent epic"})
	call("create_ticket", map[string]any{"epic_id": 1, "title": "Agent task"})
	call("create_ticket", map[string]any{"epic_id": 1, "title": "Second task"})
	call("link_tickets", map[string]any{"blocker_id": 1, "blocked_id": 2})
	call("update_ticket", map[string]any{"id": 1, "status": "ready_for_review"})
	call("update_epic", map[string]any{"id": 1, "completed": true})
	call("get_workspace", map[string]any{})
	state, _ := a.Store.Snapshot(ctx)
	if len(state.Links) != 1 || state.Tickets[0].Status != "ready_for_review" || !state.Epics[0].Completed {
		t.Fatal(state)
	}
	out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "link_tickets", Arguments: map[string]any{"blocker_id": 2, "blocked_id": 1}})
	if err != nil {
		t.Fatal(err)
	}
	if !out.IsError {
		t.Fatal("invalid dependency must return an MCP tool error")
	}
}
