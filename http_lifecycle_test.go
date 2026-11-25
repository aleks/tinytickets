package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"tinytickets/internal/app"
)

func TestHTTPProcessHelper(t *testing.T) {
	path := os.Getenv("TINYTICKETS_HTTP_TEST_DB")
	if path == "" {
		return
	}
	os.Args = []string{"tinytickets", "--addr", "127.0.0.1:0", "--db", path}
	flag.CommandLine = flag.NewFlagSet("tinytickets", flag.ContinueOnError)
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func TestHTTPProcessShutdownWithActiveStreamsAndBody(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sending os.Interrupt to a child process is not supported on Windows")
	}
	path := filepath.Join(t.TempDir(), "lifecycle.db")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestHTTPProcessHelper$")
	cmd.Env = append(os.Environ(), "TINYTICKETS_HTTP_TEST_DB="+path)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		if !waited {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	urls := make(chan string, 1)
	go func() {
		scan := bufio.NewScanner(stderr)
		for scan.Scan() {
			for _, field := range strings.Fields(scan.Text()) {
				if strings.HasPrefix(field, "url=http://") {
					select {
					case urls <- strings.TrimPrefix(field, "url="):
					default:
					}
				}
			}
		}
	}()
	var base string
	select {
	case base = <-urls:
	case <-ctx.Done():
		t.Fatal("HTTP subprocess did not start")
	}
	request, err := http.NewRequestWithContext(ctx, "GET", base+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if line, err := bufio.NewReader(response.Body).ReadString('\n'); err != nil || line != "event: change\n" {
		t.Fatal(line, err)
	}
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(base, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := fmt.Fprintf(conn, "POST /api/projects HTTP/1.1\r\nHost: %s\r\nContent-Length: 100\r\n\r\n{", strings.TrimPrefix(base, "http://")); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		waited = true
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(7 * time.Second):
		t.Fatal("shutdown did not release active handlers")
	}
	s, err := app.Open(path)
	if err != nil {
		t.Fatalf("database unavailable after shutdown: %v", err)
	}
	defer s.Close()
	state, err := s.Snapshot(context.Background())
	if err != nil || len(state.Projects) != 0 {
		t.Fatal(state, err)
	}
}
