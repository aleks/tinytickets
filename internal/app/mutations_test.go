package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestTypedMutationPartialUpdates(t *testing.T) {
	a := testApp(t)
	ctx := context.Background()
	p, err := a.CreateProject(ctx, CreateProjectInput{Name: "  Typed project  "})
	if err != nil || p.Name != "Typed project" {
		t.Fatal(p, err)
	}
	e, err := a.CreateEpic(ctx, CreateEpicInput{ProjectID: p.ID, Title: "Typed epic", Completed: ptr(true), Archived: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	e, err = a.UpdateEpic(ctx, e.ID, UpdateEpicInput{Completed: ptr(false), Archived: ptr(false)})
	if err != nil || e.Archived || e.Completed {
		t.Fatal(e, err)
	}
	ticket, err := a.CreateTicket(ctx, CreateTicketInput{EpicID: e.ID, Title: "Ticket", Status: ptr("in_progress"), Description: "specification"})
	if err != nil || ticket.StatusSince == nil {
		t.Fatal(ticket, err)
	}
	updated, err := a.UpdateTicket(ctx, ticket.ID, UpdateTicketInput{Title: ptr("renamed")})
	if err != nil || updated.Description != ticket.Description || updated.Status != ticket.Status || !reflect.DeepEqual(updated.StatusSince, ticket.StatusSince) {
		t.Fatal(updated, err)
	}
	history, err := a.Store.TicketHistory(ctx, ticket.ID)
	if err != nil || len(history) != 1 {
		t.Fatal(history, err)
	}
	if _, err := a.CreateTicket(ctx, CreateTicketInput{EpicID: e.ID, Title: "invalid", Status: ptr("")}); err == nil {
		t.Fatal("explicit empty status accepted")
	}
}

func TestRESTRejectsResourceInapplicableFields(t *testing.T) {
	a := testApp(t)
	p, e, id := seed(t, a)
	before, err := a.Store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "/api/projects", `{"name":"new","status":"todo"}`},
		{"POST", "/api/epics", fmt.Sprintf(`{"project_id":%d,"title":"new","description":"invalid field"}`, p)},
		{"POST", "/api/tickets", fmt.Sprintf(`{"epic_id":%d,"title":"new","completed":true}`, e)},
		{"POST", "/api/links", fmt.Sprintf(`{"blocker_id":%d,"blocked_id":999,"title":"invalid"}`, id)},
		{"PATCH", fmt.Sprintf("/api/projects/%d", p), `{"title":"ignored before"}`},
		{"PATCH", fmt.Sprintf("/api/epics/%d", e), `{"status":"done"}`},
		{"PATCH", fmt.Sprintf("/api/tickets/%d", id), `{"project_id":1}`},
		{"POST", "/api/tickets", fmt.Sprintf(`{"epic_id":%d,"title":"new","status":""}`, e)},
		{"POST", "/api/projects", ""},
		{"POST", "/api/projects", "null"},
		{"POST", "/api/projects", `{"name":"new"} {}`},
	} {
		w := httptest.NewRecorder()
		testHandler(a).ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
		if w.Code != 400 {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	after, err := a.Store.Snapshot(context.Background())
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("invalid requests changed state", after, err)
	}
}

func TestTypedMCPRejectsInapplicableFields(t *testing.T) {
	a := testApp(t)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "typed-test", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "create_project", Arguments: map[string]any{"name": "new", "status": "todo"}})
	if err != nil || !out.IsError {
		t.Fatal(out, err)
	}
	out, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "create_project", Arguments: map[string]any{"name": "Typed MCP"}})
	if err != nil || out.IsError {
		t.Fatal(out, err)
	}
	raw, err := json.Marshal(out.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var p Project
	if err := json.Unmarshal(raw, &p); err != nil || p.ID <= 0 || p.Name != "Typed MCP" {
		t.Fatal(p, err, string(raw))
	}
}
