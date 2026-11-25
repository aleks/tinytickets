package app

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestSlowRequestBodyTimesOut(t *testing.T) {
	a := testApp(t)
	a.bodyReadTimeout = 75 * time.Millisecond
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(server.URL, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprintf(conn, "POST /api/projects HTTP/1.1\r\nHost: %s\r\nContent-Length: 100\r\nContent-Type: application/json\r\n\r\n{", strings.TrimPrefix(server.URL, "http://")); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 408 {
		t.Fatal(response.Status)
	}
	state, err := a.Store.Snapshot(context.Background())
	if err != nil || len(state.Projects) != 0 {
		t.Fatal(state, err)
	}
}

func TestBodyCancellationInterruptsRead(t *testing.T) {
	a := testApp(t)
	a.bodyReadTimeout = 5 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan struct{})
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); testHandler(a).ServeHTTP(w, r) }))
	server.Config.BaseContext = func(net.Listener) context.Context { return ctx }
	server.Start()
	defer server.Close()
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(server.URL, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := fmt.Fprintf(conn, "POST /api/projects HTTP/1.1\r\nHost: %s\r\nContent-Length: 100\r\n\r\n{", strings.TrimPrefix(server.URL, "http://")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("handler not entered")
	}
	cancel()
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 408 {
		t.Fatal(response.Status)
	}
}

func TestLargeBodyReturns413(t *testing.T) {
	a := testApp(t)
	w := httptest.NewRecorder()
	testHandler(a).ServeHTTP(w, httptest.NewRequest("POST", "/api/projects", strings.NewReader(strings.Repeat("x", (1<<20)+1))))
	if w.Code != 413 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestRejectedRequestDoesNotDrainAnUnboundedBody(t *testing.T) {
	a := testApp(t)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	for _, tc := range []struct {
		path, extra string
		status      int
	}{
		{"/api/projects", "Origin: https://untrusted.example\r\n", 403},
		{"/", "", 405},
	} {
		conn, err := net.DialTimeout("tcp", strings.TrimPrefix(server.URL, "http://"), time.Second)
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		if _, err := fmt.Fprintf(conn, "POST %s HTTP/1.1\r\nHost: %s\r\nContent-Length: 100\r\n%s\r\n{", tc.path, strings.TrimPrefix(server.URL, "http://"), tc.extra); err != nil {
			conn.Close()
			t.Fatal(err)
		}
		response, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			conn.Close()
			t.Fatal(err)
		}
		if response.StatusCode != tc.status {
			t.Error(response.Status)
		}
		response.Body.Close()
		conn.Close()
	}
}

type pipeResponse struct {
	net.Conn
	headers http.Header
}

func (w *pipeResponse) Header() http.Header { return w.headers }
func (w *pipeResponse) WriteHeader(int)     {}
func (w *pipeResponse) Flush()              {}

func TestInitialEventWriteHasDeadline(t *testing.T) {
	a := testApp(t)
	a.eventWriteTimeout = 30 * time.Millisecond
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	w := &pipeResponse{Conn: server, headers: make(http.Header)}
	done := make(chan struct{})
	go func() { defer close(done); a.events(w, httptest.NewRequest("GET", "/api/events", nil)) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("initial SSE write blocked without a deadline")
	}
	a.mu.Lock()
	count := len(a.subs)
	a.mu.Unlock()
	if count != 0 {
		t.Fatal("subscriber leaked")
	}
}

func TestStreamingResponsesOutliveBodyDeadline(t *testing.T) {
	for _, http2 := range []bool{false, true} {
		t.Run(fmt.Sprintf("HTTP2=%v", http2), func(t *testing.T) { testStreamingResponse(t, http2) })
	}
}

func testStreamingResponse(t *testing.T, http2 bool) {
	a := testApp(t)
	a.bodyReadTimeout = 40 * time.Millisecond
	addTool(a.MCP, "slow_response", "Test long processing", func(ctx context.Context, _ struct{}) (struct{}, error) {
		timer := time.NewTimer(150 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-timer.C:
			return struct{}{}, nil
		case <-ctx.Done():
			return struct{}{}, ctx.Err()
		}
	})
	server := httptest.NewUnstartedServer(testHandler(a))
	server.EnableHTTP2 = http2
	server.StartTLS()
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if (response.ProtoMajor == 2) != http2 {
		t.Fatal(response.Proto)
	}
	reader := bufio.NewReader(response.Body)
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "stream-test", Version: "test"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp", HTTPClient: server.Client()}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "slow_response", Arguments: map[string]any{}})
	if err != nil || out.IsError {
		t.Fatal(out, err)
	}
	a.publish()
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		t.Fatal(err)
	}
	if !strings.HasPrefix(line, "event: change") {
		t.Fatalf("SSE failed after body deadline: %q %v", line, err)
	}
}
