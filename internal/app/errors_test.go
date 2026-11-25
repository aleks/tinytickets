package app

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestApplicationErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err     error
		status  int
		message string
	}{
		{invalid("Invalid title"), 400, "Invalid title"},
		{missing(), 404, "Not found"},
		{conflict("State changed"), 409, "State changed"},
		{&Error{Kind: ErrUnavailable, Message: "Storage unavailable", Err: errors.New("private path")}, 503, "Storage unavailable"},
		{context.Canceled, 408, "Request canceled"},
		{context.DeadlineExceeded, 503, "Operation timed out"},
		{errors.New("SQL and private data"), 500, "Internal server error"},
	} {
		err := fmt.Errorf("operation: %w", tc.err)
		status, message := errorStatus(err)
		if status != tc.status || message != tc.message {
			t.Fatalf("%v: %d %s", err, status, message)
		}
		w := httptest.NewRecorder()
		respond(w, nil, err, 0)
		if w.Code != tc.status || strings.Contains(w.Body.String(), "private") || strings.Contains(w.Body.String(), "SQL") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if !errors.Is(fmt.Errorf("wrapped: %w", missing()), ErrNotFound) {
		t.Fatal("application category lost")
	}
}

func TestParentLookupPreservesDatabaseFailure(t *testing.T) {
	a := testApp(t)
	if _, err := a.Store.db.Exec("DROP TABLE projects"); err != nil {
		t.Fatal(err)
	}
	_, err := a.Mutate(context.Background(), "epics", "create", 0, Input{ProjectID: ptr(int64(1)), Title: ptr("Epic")})
	if status, _ := errorStatus(err); status != 500 || !strings.Contains(err.Error(), "check projects existence") {
		t.Fatalf("storage failure misreported: %v", err)
	}
}

func TestWriteErrorsPreserveCancellationAndBusy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "busy.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Mutate(ctx, "projects", "create", 0, Input{Name: ptr("cancel")}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	tx, err := beginWrite(context.Background(), other.db)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := s.db.Exec("PRAGMA busy_timeout=1"); err != nil {
		t.Fatal(err)
	}
	_, err = s.Mutate(context.Background(), "projects", "create", 0, Input{Name: ptr("busy")})
	if code, _ := errorStatus(err); code != 503 {
		t.Fatalf("busy mapping: %v", err)
	}
}

func TestMCPErrorMappingHidesInternalDetails(t *testing.T) {
	a := testApp(t)
	addTool(a.MCP, "test_failure", "Test failure mapping", func(context.Context, struct{}) (struct{}, error) {
		return struct{}{}, fmt.Errorf("query secret_table at /private/database: %w", errors.New("internal failure"))
	})
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "error-test", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	for _, tc := range []struct {
		name    string
		args    map[string]any
		message string
	}{
		{"test_failure", map[string]any{}, "Internal server error"},
		{"create_epic", map[string]any{"project_id": 99, "title": "Epic"}, "Project does not exist"},
	} {
		out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tc.name, Arguments: tc.args})
		if err != nil {
			t.Fatal(err)
		}
		if !out.IsError || len(out.Content) != 1 {
			t.Fatal(out)
		}
		text, ok := out.Content[0].(*mcp.TextContent)
		if !ok || text.Text != tc.message {
			t.Fatalf("unsafe/unexpected error: %+v", out.Content)
		}
	}
}
