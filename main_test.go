package main

import (
	"context"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"tinytickets/internal/app"
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
}
