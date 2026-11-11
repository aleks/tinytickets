package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func preview(t *testing.T, s *Store, kind string, id int64) DeletionPreview {
	t.Helper()
	p, err := s.DeletionPreview(context.Background(), kind, id)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDeletionScopeAndAtomicity(t *testing.T) {
	a := testApp(t)
	ctx := context.Background()
	p, e, id := seed(t, a)
	_, _, external := seed(t, a)
	sameProjectEpic := create(t, a, "epics", Input{Title: ptr("Survivor"), ProjectID: &p})
	sameProjectTicket := create(t, a, "tickets", Input{Title: ptr("Survivor"), EpicID: &sameProjectEpic})
	for _, target := range []int64{external, sameProjectTicket} {
		if _, err := a.Mutate(ctx, "links", "create", 0, Input{BlockerID: id, BlockedID: target}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.CreateReviewHandoff(ctx, id, ReviewHandoffInput{Summary: "Ready", Verification: "Checked"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "Note"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Mutate(ctx, "epics", "update", e, Input{Completed: ptr(true), Archived: ptr(true)}); err != nil {
		t.Fatal(err)
	}
	pr := preview(t, a.Store, "epics", e)
	if !pr.RequiresForce || pr.Counts != (DeletionCounts{Tickets: 1, ArchivedEpics: 1, WorkLogEntries: 2, StatusEvents: 2, DependencyLinks: 2, ExternalDependencyLinks: 2}) {
		t.Fatalf("preview %+v", pr)
	}
	tr := preview(t, a.Store, "tickets", id)
	if tr.RequiresForce || tr.Counts.Tickets != 0 || tr.Counts.WorkLogEntries != 2 {
		t.Fatal(tr)
	}
	ch := make(chan struct{}, 10)
	a.subs[ch] = struct{}{}
	for _, opts := range []DeleteOptions{{}, {Force: true}, {Force: true, ConfirmationToken: ptr("")}, {Force: true, ConfirmationToken: &tr.ConfirmationToken}} {
		if _, err := a.Delete(ctx, "epics", e, opts); err == nil {
			t.Fatal("unsafe delete accepted", opts)
		}
	}
	if len(ch) != 0 {
		t.Fatal("failed delete notified")
	}
	before, _ := a.Store.Snapshot(ctx)
	if _, err := a.Store.db.Exec(`CREATE TRIGGER fail_parent_delete BEFORE DELETE ON epics BEGIN SELECT RAISE(ABORT,'injected'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Delete(ctx, "epics", e, DeleteOptions{Force: true, ConfirmationToken: &pr.ConfirmationToken}); err == nil {
		t.Fatal("injected failure ignored")
	}
	after, _ := a.Store.Snapshot(ctx)
	if !reflect.DeepEqual(before, after) || len(ch) != 0 || preview(t, a.Store, "epics", e).ConfirmationToken != pr.ConfirmationToken {
		t.Fatal("partial deletion or notification")
	}
	if _, err := a.Store.db.Exec("DROP TRIGGER fail_parent_delete"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Delete(ctx, "epics", e, DeleteOptions{Force: true, ConfirmationToken: &pr.ConfirmationToken}); err != nil {
		t.Fatal(err)
	}
	if len(ch) != 1 {
		t.Fatal("expected one notification", len(ch))
	}
	state, _ := a.Store.Snapshot(ctx)
	if len(state.Tickets) != 2 || len(state.Links) != 0 {
		t.Fatal(state)
	}
	ready, err := a.Store.ReadyTickets(ctx, ReadyFilter{})
	if err != nil || len(ready.Tickets) != 2 {
		t.Fatal("survivors should become ready", ready, err)
	}
	for _, table := range []string{"ticket_work_log", "ticket_status_events"} {
		var n int
		if err := a.Store.db.QueryRow("SELECT count(*) FROM "+table+" WHERE ticket_id=?", id).Scan(&n); err != nil || n != 0 {
			t.Fatal(table, n, err)
		}
	}
	if _, err := a.Delete(ctx, "epics", e, DeleteOptions{Force: true, ConfirmationToken: &pr.ConfirmationToken}); err == nil {
		t.Fatal("deleted target accepted")
	} else if code, _ := errorStatus(err); code != 404 {
		t.Fatal(err)
	}
}

func TestDeletionStaleImpact(t *testing.T) {
	for _, change := range []string{"same-count-child", "note", "link", "same-count-link", "status", "rename", "move"} {
		t.Run(change, func(t *testing.T) {
			a := testApp(t)
			ctx := context.Background()
			p, e, id := seed(t, a)
			_, otherEpic, other := seed(t, a)
			if change == "same-count-link" {
				if _, err := a.Mutate(ctx, "links", "create", 0, Input{BlockerID: id, BlockedID: other}); err != nil {
					t.Fatal(err)
				}
			}
			pr := preview(t, a.Store, "projects", p)
			var err error
			switch change {
			case "same-count-child":
				_, err = a.Mutate(ctx, "tickets", "delete", id, Input{})
				if err == nil {
					create(t, a, "tickets", Input{Title: ptr("First ticket"), EpicID: &e})
				}
			case "note":
				_, err = a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "new"})
			case "link":
				_, err = a.Mutate(ctx, "links", "create", 0, Input{BlockerID: id, BlockedID: other})
			case "same-count-link":
				_, err = a.Mutate(ctx, "links", "delete", 0, Input{BlockerID: id, BlockedID: other})
				if err == nil {
					_, err = a.Mutate(ctx, "links", "create", 0, Input{BlockerID: other, BlockedID: id})
				}
			case "status":
				_, err = a.Mutate(ctx, "tickets", "update", id, Input{Status: ptr("done")})
			case "rename":
				_, err = a.Mutate(ctx, "projects", "update", p, Input{Name: ptr("Renamed")})
			case "move":
				_, err = a.Mutate(ctx, "tickets", "update", id, Input{EpicID: &otherEpic})
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = a.Delete(ctx, "projects", p, DeleteOptions{Force: true, ConfirmationToken: &pr.ConfirmationToken})
			code, message := errorStatus(err)
			if code != 409 || message != "Deletion impact changed. Review the updated preview and confirm again." {
				t.Fatal(code, message)
			}
			fresh := preview(t, a.Store, "projects", p)
			if _, err = a.Delete(ctx, "projects", p, DeleteOptions{Force: true, ConfirmationToken: &fresh.ConfirmationToken}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDeletionReservesWriterBeforeValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writer.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	p, _, id := seed(t, New(s))
	pr := preview(t, s, "projects", p)
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := other.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	if _, err := conn.ExecContext(ctx, "UPDATE tickets SET title='Uncommitted writer change' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.Delete(ctx, "projects", p, DeleteOptions{Force: true, ConfirmationToken: &pr.ConfirmationToken})
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("delete escaped writer reservation: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		t.Fatal(err)
	}
	if code, _ := errorStatus(<-done); code != 409 {
		t.Fatal("did not revalidate after writer committed", code)
	}
	if got := preview(t, s, "projects", p); got.ConfirmationToken == pr.ConfirmationToken {
		t.Fatal("writer change not reflected")
	}
}

func TestDeletionREST(t *testing.T) {
	a := testApp(t)
	p, _, id := seed(t, a)
	h := testHandler(a)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/projects/1/deletion-preview", "", 200},
		{"GET", "/api/tickets/0/deletion-preview", "", 400},
		{"GET", "/api/tickets/nope/deletion-preview", "", 400},
		{"GET", "/api/projects/999/deletion-preview", "", 404},
		{"GET", "/api/links/1/deletion-preview", "", 404},
		{"POST", "/api/projects/1/deletion-preview", "", 405},
		{"DELETE", "/api/projects/1", "", 409},
		{"DELETE", "/api/projects/1", `{"force":true}`, 400},
		{"DELETE", "/api/tickets/1", `{"unexpected":true}`, 400},
		{"DELETE", "/api/tickets/1", `{"force":"true"}`, 400},
		{"DELETE", "/api/tickets/1", `{"force":null}`, 400},
		{"DELETE", "/api/tickets/1", `{"confirmation_token":null}`, 400},
		{"DELETE", "/api/tickets/1", `{"confirmation_token":3}`, 400},
		{"DELETE", "/api/tickets/1", `{"confirmation_token":"wrong"}`, 409},
		{"DELETE", "/api/tickets/1", `[]`, 400},
		{"DELETE", "/api/tickets/1", `{} {}`, 400},
	} {
		w := request(h, tc.method, tc.path, tc.body)
		if w.Code != tc.status {
			t.Fatalf("%+v: %d %s", tc, w.Code, w.Body.String())
		}
	}
	r := httptest.NewRequest("GET", "/api/projects/1/deletion-preview", nil)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
	// A supplied token is rechecked even when force is false and not needed.
	tr := preview(t, a.Store, "tickets", id)
	if w := request(h, "DELETE", fmt.Sprintf("/api/tickets/%d", id), fmt.Sprintf(`{"confirmation_token":%q}`, tr.ConfirmationToken)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	pr := preview(t, a.Store, "projects", p)
	if w := request(h, "DELETE", fmt.Sprintf("/api/projects/%d", p), fmt.Sprintf(`{"force":true,"confirmation_token":%q}`, pr.ConfirmationToken)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	empty := create(t, a, "projects", Input{Name: ptr("Empty")})
	if w := request(h, "DELETE", fmt.Sprintf("/api/projects/%d", empty), ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestDeletionExternalProcessMutation(t *testing.T) {
	if path := os.Getenv("TT_DELETE_TEST_DB"); path != "" {
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if _, err := s.Mutate(context.Background(), "tickets", "create", 0, Input{Title: ptr("External process"), EpicID: ptr(int64(1))}); err != nil {
			t.Fatal(err)
		}
		return
	}
	path := filepath.Join(t.TempDir(), "shared.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	p, _, _ := seed(t, New(s))
	before := preview(t, s, "projects", p)
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if got := preview(t, s2, "projects", p); got.ConfirmationToken != before.ConfirmationToken {
		t.Fatal("instance-specific token")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestDeletionExternalProcessMutation$")
	cmd.Env = append(os.Environ(), "TT_DELETE_TEST_DB="+path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	if _, err = s.Delete(context.Background(), "projects", p, DeleteOptions{Force: true, ConfirmationToken: &before.ConfirmationToken}); err == nil {
		t.Fatal("cross-process stale preview accepted")
	}
}

func TestDeletionMCP(t *testing.T) {
	a := testApp(t)
	p, _, _ := seed(t, a)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "deletion-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if !strings.Contains(session.InitializeResult().Instructions, "get_deletion_preview") {
		t.Fatal("missing instructions")
	}
	call := func(name string, args map[string]any, wantError bool) json.RawMessage {
		t.Helper()
		out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if out.IsError != wantError {
			t.Fatalf("%s: %+v", name, out)
		}
		raw, err := json.Marshal(out.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	var pr DeletionPreview
	if err := json.Unmarshal(call("get_deletion_preview", map[string]any{"kind": "projects", "id": p}, false), &pr); err != nil {
		t.Fatal(err)
	}
	if pr.ConfirmationToken != preview(t, a.Store, "projects", p).ConfirmationToken {
		t.Fatal("MCP token mismatch")
	}
	call("delete_project", map[string]any{"id": p}, true)
	call("delete_project", map[string]any{"id": p, "force": true}, true)
	call("delete_project", map[string]any{"id": p, "force": true, "confirmation_token": "wrong"}, true)
	call("delete_project", map[string]any{"id": p, "force": true, "confirmation_token": pr.ConfirmationToken}, false)
	call("get_deletion_preview", map[string]any{"kind": "projects", "id": p}, true)
}

func TestDeletionMCPStdio(t *testing.T) {
	if path := os.Getenv("TT_DELETE_STDIO_DB"); path != "" {
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if err := New(s).MCP.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
			t.Fatal(err)
		}
		return
	}
	path := filepath.Join(t.TempDir(), "stdio.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := New(s)
	p, _, id := seed(t, a)
	pr := preview(t, s, "projects", p)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.Command(os.Args[0], "-test.run=^TestDeletionMCPStdio$")
	cmd.Env = append(os.Environ(), "TT_DELETE_STDIO_DB="+path)
	client := mcp.NewClient(&mcp.Implementation{Name: "stdio-delete-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: cmd}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	call := func(name string, args map[string]any, wantError bool) json.RawMessage {
		t.Helper()
		out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		if out.IsError != wantError {
			t.Fatalf("%s: %+v", name, out)
		}
		raw, err := json.Marshal(out.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	var remote DeletionPreview
	if err := json.Unmarshal(call("get_deletion_preview", map[string]any{"kind": "projects", "id": p}, false), &remote); err != nil {
		t.Fatal(err)
	}
	if remote.ConfirmationToken != pr.ConfirmationToken {
		t.Fatal("stdio/HTTP preview mismatch")
	}
	call("delete_project", map[string]any{"id": p}, true)
	call("delete_project", map[string]any{"id": p, "force": true}, true)
	call("delete_project", map[string]any{"id": p, "force": "true"}, true)
	call("delete_project", map[string]any{"id": p, "unknown": true}, true)
	if _, err := a.AddWorkLog(ctx, id, WorkLogNoteInput{Body: "HTTP-side change"}); err != nil {
		t.Fatal(err)
	}
	call("delete_project", map[string]any{"id": p, "force": true, "confirmation_token": pr.ConfirmationToken}, true)
	pr = preview(t, s, "projects", p)
	call("delete_project", map[string]any{"id": p, "force": true, "confirmation_token": pr.ConfirmationToken}, false)
	if _, err := s.DeletionPreview(ctx, "projects", p); err == nil {
		t.Fatal("stdio did not delete shared target")
	}
}
