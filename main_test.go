package main

import (
	"context"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/aleks/tinytickets/internal/app"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Run the actual CLI in a subprocess, without writing test-runner output into
// the stdio protocol stream.
func TestStdioHelper(t *testing.T) {
	if os.Getenv("TINYTICKETS_TEST_STDIO") != "1" {
		return
	}
	os.Args = []string{"tinytickets", "--mcp-stdio", "--db", os.Getenv("TINYTICKETS_TEST_DB")}
	flag.CommandLine = flag.NewFlagSet("tinytickets", flag.ContinueOnError)
	if err := run(); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func TestStdioRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stdio.db")
	cmd := exec.Command(os.Args[0], "-test.run=^TestStdioHelper$")
	cmd.Env = append(os.Environ(), "TINYTICKETS_TEST_STDIO=1", "TINYTICKETS_TEST_DB="+path)
	cmd.Stderr = os.Stderr
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "stdio-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: cmd}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "create_project", Arguments: map[string]any{"name": "Stdio project"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatal(result.Content)
	}
	s, err := app.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	state, err := s.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Projects) != 1 || state.Projects[0].Name != "Stdio project" {
		t.Fatal(state)
	}
	for _, call := range []struct {
		name string
		args map[string]any
	}{
		{"create_epic", map[string]any{"project_id": state.Projects[0].ID, "title": "Stdio work"}},
		{"create_ticket", map[string]any{"epic_id": 1, "title": "Claim through stdio"}},
		{"get_ready_tickets", map[string]any{"project_id": state.Projects[0].ID}},
		{"claim_next_ticket", map[string]any{"project_id": state.Projects[0].ID}},
	} {
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: call.name, Arguments: call.args})
		if err != nil || result.IsError {
			t.Fatalf("%s: %v %v", call.name, result, err)
		}
	}
	state, err = s.Snapshot(ctx)
	if err != nil || len(state.Tickets) != 1 || state.Tickets[0].Status != "in_progress" || state.Tickets[0].StatusSince == nil {
		t.Fatalf("stdio claim not persisted: %+v %v", state, err)
	}
	id := state.Tickets[0].ID
	for _, call := range []struct {
		name string
		args map[string]any
	}{
		{"add_work_log", map[string]any{"ticket_id": id, "body": "Implemented through stdio", "author": "stdio agent"}},
		{"create_review_handoff", map[string]any{"ticket_id": id, "summary": "Ready for review", "verification": "Stdio round trip passed"}},
		{"get_ticket_work_log", map[string]any{"ticket_id": id}},
	} {
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: call.name, Arguments: call.args})
		if err != nil || result.IsError {
			t.Fatalf("%s: %v %v", call.name, result, err)
		}
	}
	log, err := s.TicketWorkLog(ctx, id)
	if err != nil || len(log.Entries) != 2 || log.Entries[0].Kind != "note" || log.Entries[1].Kind != "review_handoff" {
		t.Fatal(log, err)
	}
	state, err = s.Snapshot(ctx)
	if err != nil || state.Tickets[0].Status != "ready_for_review" {
		t.Fatal(state, err)
	}
}
