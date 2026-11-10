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
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestReadyEligibility(t *testing.T) {
	a := testApp(t)
	p, e, first := seed(t, a)
	p2, e2, blocker := seed(t, a)
	ctx := context.Background()
	mutate := func(kind, action string, id int64, in Input) {
		t.Helper()
		if _, err := a.Mutate(ctx, kind, action, id, in); err != nil {
			t.Fatal(err)
		}
	}
	newTicket := func(epic int64, status string) int64 {
		return create(t, a, "tickets", Input{Title: ptr("Candidate"), EpicID: &epic, Status: &status})
	}
	second := newTicket(e, "todo")
	for _, status := range []string{"in_progress", "ready_for_review", "done"} {
		newTicket(e, status)
	}
	closed := create(t, a, "epics", Input{ProjectID: &p, Title: ptr("Closed"), Completed: ptr(true)})
	archived := create(t, a, "epics", Input{ProjectID: &p, Title: ptr("Archived"), Completed: ptr(true), Archived: ptr(true)})
	closedTicket, archivedTicket := newTicket(closed, "todo"), newTicket(archived, "todo")
	mutate("links", "create", 0, Input{BlockerID: blocker, BlockedID: first})
	check := func(f ReadyFilter, want ...int64) {
		t.Helper()
		out, err := a.Store.ReadyTickets(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		ids := []int64{}
		for _, ticket := range out.Tickets {
			ids = append(ids, ticket.ID)
			if ticket.StatusSince != nil {
				t.Fatal("todo timer", ticket)
			}
		}
		if want == nil {
			want = []int64{}
		}
		if !reflect.DeepEqual(ids, want) {
			t.Fatalf("ready %v want %v", ids, want)
		}
	}
	check(ReadyFilter{ProjectID: &p}, second)
	check(ReadyFilter{EpicID: &e}, second)
	check(ReadyFilter{ProjectID: &p2, EpicID: &e2}, blocker)
	// Completing or archiving the blocker's parent does not satisfy the link.
	mutate("epics", "update", e2, Input{Completed: ptr(true), Archived: ptr(true)})
	check(ReadyFilter{ProjectID: &p}, second)
	mutate("tickets", "update", blocker, Input{Status: ptr("done")})
	// Force distinct creation times: oldest-created ordering, not ID ordering.
	if _, err := a.Store.db.Exec("UPDATE tickets SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?", second); err != nil {
		t.Fatal(err)
	}
	check(ReadyFilter{ProjectID: &p}, second, first)
	// Equal timestamps have a stable ID tie-break.
	if _, err := a.Store.db.Exec("UPDATE tickets SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?", first); err != nil {
		t.Fatal(err)
	}
	check(ReadyFilter{ProjectID: &p}, first, second)
	// Every blocker must be done, not just one.
	mutate("links", "create", 0, Input{BlockerID: second, BlockedID: first})
	check(ReadyFilter{ProjectID: &p}, second)
	mutate("links", "delete", 0, Input{BlockerID: second, BlockedID: first})
	mutate("tickets", "update", blocker, Input{Status: ptr("todo")})
	check(ReadyFilter{ProjectID: &p}, second)
	_, err := a.ClaimTicket(ctx, ReadyFilter{}, &first)
	if code, _ := errorStatus(err); code != 409 {
		t.Fatalf("stale listing claim: %v", err)
	}
	for _, id := range []int64{closedTicket, archivedTicket} {
		if _, err := a.ClaimTicket(ctx, ReadyFilter{}, &id); err == nil {
			t.Fatal("claimed closed epic")
		}
	}
	mutate("tickets", "update", blocker, Input{Status: ptr("done")})
	claimed, err := a.ClaimTicket(ctx, ReadyFilter{ProjectID: &p}, nil)
	if err != nil || !claimed.Claimed || claimed.Ticket.ID != first || claimed.Ticket.Status != "in_progress" || claimed.Ticket.StatusSince == nil {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	history, err := a.Store.TicketHistory(ctx, first)
	if err != nil || len(history) != 2 || history[1].ToStatus != "in_progress" || history[1].ChangedAt != *claimed.Ticket.StatusSince {
		t.Fatalf("history: %+v %v", history, err)
	}
	mutate("tickets", "update", blocker, Input{Status: ptr("todo")})
	state, _ := a.Store.Snapshot(ctx)
	if state.Tickets[0].Status != "in_progress" {
		t.Fatal("reopening blocker moved active work")
	}
	mutate("tickets", "update", first, Input{Status: ptr("todo")})
	check(ReadyFilter{ProjectID: &p}, second)
	mutate("tickets", "update", blocker, Input{Status: ptr("done")})
	check(ReadyFilter{ProjectID: &p}, first, second)
	// Compatibility updates deliberately permit starting blocked work.
	mutate("tickets", "update", blocker, Input{Status: ptr("todo")})
	mutate("tickets", "update", first, Input{Status: ptr("in_progress")})
}

func TestReadyValidationAndNotifications(t *testing.T) {
	a := testApp(t)
	p, e, id := seed(t, a)
	ctx := context.Background()
	ch := make(chan struct{}, 10)
	a.subs[ch] = struct{}{}
	for _, f := range []ReadyFilter{{ProjectID: ptr(int64(0))}, {EpicID: ptr(int64(-1))}, {ProjectID: ptr(int64(999))}, {EpicID: ptr(int64(999))}} {
		if _, err := a.Store.ReadyTickets(ctx, f); err == nil {
			t.Fatal("accepted invalid listing scope")
		}
		if _, err := a.ClaimTicket(ctx, f, nil); err == nil {
			t.Fatal("accepted invalid claim scope")
		}
	}
	p2 := create(t, a, "projects", Input{Name: ptr("Other")})
	if _, err := a.Store.ReadyTickets(ctx, ReadyFilter{ProjectID: &p2, EpicID: &e}); err == nil {
		t.Fatal("mismatched scope")
	}
	if _, err := a.ClaimTicket(ctx, ReadyFilter{ProjectID: &p2, EpicID: &e}, nil); err == nil {
		t.Fatal("mismatched claim scope")
	}
	for len(ch) > 0 {
		<-ch
	}
	if _, err := a.Store.ReadyTickets(ctx, ReadyFilter{ProjectID: &p}); err != nil {
		t.Fatal(err)
	}
	if len(ch) != 0 {
		t.Fatal("read published")
	}
	if _, err := a.ClaimTicket(ctx, ReadyFilter{}, &id); err != nil {
		t.Fatal(err)
	}
	if len(ch) != 1 {
		t.Fatal("successful claim did not publish")
	}
	<-ch
	for _, bad := range []int64{0, -1, 999, id} {
		if _, err := a.ClaimTicket(ctx, ReadyFilter{}, &bad); err == nil {
			t.Fatal("invalid/repeated claim")
		}
	}
	out, err := a.ClaimTicket(ctx, ReadyFilter{}, nil)
	if err != nil || out.Claimed || out.Ticket != nil {
		t.Fatal(out, err)
	}
	if len(ch) != 0 {
		t.Fatal("empty/failed claim published")
	}
	history, _ := a.Store.TicketHistory(ctx, id)
	if len(history) != 2 {
		t.Fatal("failed claim wrote history")
	}
	// A canceled claim must not leave the connection in a transaction.
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := a.ClaimTicket(canceled, ReadyFilter{}, nil); err == nil {
		t.Fatal("canceled claim succeeded")
	}
	if _, err := a.Store.ReadyTickets(ctx, ReadyFilter{}); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentClaimsAcrossStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.db")
	stores := make([]*Store, 8)
	for i := range stores {
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		stores[i] = s
		defer s.Close()
	}
	a := New(stores[0])
	_, e, first := seed(t, a)
	for i := 0; i < 15; i++ {
		create(t, a, "tickets", Input{Title: ptr("Parallel"), EpicID: &e})
	}
	start := make(chan struct{})
	results := make(chan ClaimResult, 32)
	errs := make(chan error, 32)
	var wg sync.WaitGroup
	for _, s := range stores {
		wg.Add(1)
		go func(s *Store) {
			defer wg.Done()
			<-start
			for {
				out, err := s.ClaimTicket(context.Background(), ReadyFilter{}, nil)
				if err != nil {
					errs <- err
					return
				}
				if !out.Claimed {
					return
				}
				results <- out
			}
		}(s)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	seen := map[int64]bool{}
	for result := range results {
		id := result.Ticket.ID
		if seen[id] {
			t.Fatalf("duplicate claim %d", id)
		}
		seen[id] = true
	}
	if len(seen) != 16 || !seen[first] {
		t.Fatal("missing claims", seen)
	}
	for id := range seen {
		h, err := stores[0].TicketHistory(context.Background(), id)
		if err != nil || len(h) != 2 {
			t.Fatal("duplicate history", h, err)
		}
	}
	// All contenders for one explicit ticket: exactly one success.
	if _, err := a.Mutate(context.Background(), "tickets", "update", first, Input{Status: ptr("todo")}); err != nil {
		t.Fatal(err)
	}
	wg = sync.WaitGroup{}
	successes := make(chan bool, 8)
	for _, s := range stores {
		wg.Add(1)
		go func(s *Store) {
			defer wg.Done()
			out, err := s.ClaimTicket(context.Background(), ReadyFilter{}, &first)
			if err != nil {
				code, _ := errorStatus(err)
				if code != 409 {
					t.Errorf("claim: %v", err)
				}
				return
			}
			successes <- out.Claimed
		}(s)
	}
	wg.Wait()
	if len(successes) != 1 {
		t.Fatalf("explicit claim winners %d", len(successes))
	}
}

func TestClaimRollback(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	ctx := context.Background()
	ch := make(chan struct{}, 1)
	a.subs[ch] = struct{}{}
	// Abort the status update to exercise cleanup of a failed write transaction.
	// Neither the ticket nor its automatically recorded history may leak changes.
	if _, err := a.Store.db.Exec(`CREATE TRIGGER reject_claim AFTER UPDATE OF status ON tickets
		BEGIN SELECT RAISE(ABORT, 'test claim failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ClaimTicket(ctx, ReadyFilter{}, &id); err == nil {
		t.Fatal("expected failure")
	}
	state, err := a.Store.Snapshot(ctx)
	if err != nil || state.Tickets[0].Status != "todo" || state.Tickets[0].StatusSince != nil {
		t.Fatal(state, err)
	}
	history, err := a.Store.TicketHistory(ctx, id)
	if err != nil || len(history) != 1 || len(ch) != 0 {
		t.Fatal("failed claim leaked history/notification", history, err)
	}
	if _, err := a.Store.db.Exec("DROP TRIGGER reject_claim"); err != nil {
		t.Fatal(err)
	}
	if out, err := a.ClaimTicket(ctx, ReadyFilter{}, &id); err != nil || !out.Claimed {
		t.Fatal("connection left in transaction", out, err)
	}
}

func TestClaimRechecksAfterCompetingWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "competing.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := New(s)
	p, e, id := seed(t, a)
	blocker := create(t, a, "tickets", Input{EpicID: &e, Title: ptr("Blocker"), Status: ptr("done")})
	ctx := context.Background()
	if _, err := a.Mutate(ctx, "links", "create", 0, Input{BlockerID: blocker, BlockedID: id}); err != nil {
		t.Fatal(err)
	}
	ready, err := s.ReadyTickets(ctx, ReadyFilter{ProjectID: &p})
	if err != nil || len(ready.Tickets) != 1 {
		t.Fatal(ready, err)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	conn, err := other.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, "ROLLBACK")
	if _, err := conn.ExecContext(ctx, "UPDATE tickets SET status='todo' WHERE id=?", blocker); err != nil {
		t.Fatal(err)
	}
	started, result := make(chan struct{}), make(chan error, 1)
	go func() { close(started); _, err := a.ClaimTicket(ctx, ReadyFilter{}, &id); result <- err }()
	<-started
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err == nil {
		t.Fatal("claimed stale ready ticket")
	} else if code, _ := errorStatus(err); code != 409 {
		t.Fatal(err)
	}
	if _, err := s.ReadyTickets(ctx, ReadyFilter{}); err != nil {
		t.Fatal(err)
	}
}

func TestClaimProcessHelper(t *testing.T) {
	path := os.Getenv("TINYTICKETS_CLAIM_TEST_DB")
	if path == "" {
		return
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	out, err := s.ClaimTicket(context.Background(), ReadyFilter{}, ptr(int64(1)))
	if err != nil {
		if code, _ := errorStatus(err); code == 409 {
			return
		}
		t.Fatal(err)
	}
	if out.Claimed {
		fmt.Println("CLAIM_WINNER")
	}
}

func TestClaimsAcrossProcesses(t *testing.T) {
	path := filepath.Join(t.TempDir(), "process.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	seed(t, New(s))
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	outputs := make(chan string, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := exec.Command(executable, "-test.run=^TestClaimProcessHelper$")
			cmd.Env = append(os.Environ(), "TINYTICKETS_CLAIM_TEST_DB="+path)
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Errorf("process: %v %s", err, out)
			}
			outputs <- string(out)
		}()
	}
	wg.Wait()
	close(outputs)
	winners := 0
	for out := range outputs {
		winners += strings.Count(out, "CLAIM_WINNER")
	}
	if winners != 1 {
		t.Fatalf("process winners %d", winners)
	}
}

func TestReadyREST(t *testing.T) {
	a := testApp(t)
	_, _, id := seed(t, a)
	h := testHandler(a)
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/tickets/ready", "", 200},
		{"GET", "/api/tickets/ready?project_id=0", "", 400},
		{"GET", "/api/tickets/ready?epic_id=", "", 400},
		{"GET", "/api/tickets/ready?epic_id=1&epic_id=2", "", 400},
		{"GET", "/api/tickets/ready?project_id=nope", "", 400},
		{"GET", "/api/tickets/ready?epic_id=999", "", 404},
		{"POST", "/api/tickets/ready", "{}", 405},
		{"GET", "/api/tickets/claim-next", "", 405},
		{"POST", "/api/tickets/claim-next", `{"status":"done"}`, 400},
		{"POST", "/api/tickets/claim-next", `null`, 400},
		{"POST", "/api/tickets/claim-next", `{} {}`, 400},
		{"POST", "/api/tickets/claim-next", `{"epic_id":0}`, 400},
		{"POST", "/api/tickets/claim-next", `{"project_id":999}`, 404},
		{"POST", "/api/tickets/0/claim", "{}", 400},
		{"POST", "/api/tickets/nope/claim", "{}", 400},
		{"POST", "/api/tickets/999/claim", "{}", 404},
		{"GET", "/api/tickets/1/claim", "", 405},
		{"POST", "/api/tickets/1/claim", `{"status":"done"}`, 400},
	} {
		w := request(h, tc.method, tc.path, tc.body)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	w := request(h, "GET", "/api/tickets/ready?project_id=1&epic_id=1", "")
	var ready ReadyTicketsResult
	if err := json.Unmarshal(w.Body.Bytes(), &ready); err != nil || len(ready.Tickets) != 1 {
		t.Fatal(w.Body.String(), err)
	}
	w = request(h, "POST", fmt.Sprintf("/api/tickets/%d/claim", id), "")
	var claimed ClaimResult
	if err := json.Unmarshal(w.Body.Bytes(), &claimed); err != nil || w.Code != 200 || !claimed.Claimed || claimed.Ticket.StatusSince == nil {
		t.Fatal(w.Body.String(), err)
	}
	if w = request(h, "POST", "/api/tickets/1/claim", "{}"); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(h, "POST", "/api/tickets/claim-next", "{}"); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"claimed":false,"ticket":null}` {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = request(h, "GET", "/api/tickets/ready", ""); strings.TrimSpace(w.Body.String()) != `{"tickets":[]}` {
		t.Fatal(w.Body.String())
	}
	create(t, a, "tickets", Input{Title: ptr("Next"), EpicID: ptr(int64(1))})
	if w = request(h, "POST", "/api/tickets/claim-next", `{"project_id":1,"epic_id":1}`); w.Code != 200 || !strings.Contains(w.Body.String(), `"claimed":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestReadyMCP(t *testing.T) {
	a := testApp(t)
	p, e, id := seed(t, a)
	server := httptest.NewServer(testHandler(a))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "ready-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if !strings.Contains(session.InitializeResult().Instructions, "Before starting new work") {
		t.Fatal("missing claim instructions")
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
	var ready ReadyTicketsResult
	if err := json.Unmarshal(call("get_ready_tickets", map[string]any{"project_id": p, "epic_id": e}, false), &ready); err != nil || len(ready.Tickets) != 1 {
		t.Fatal(ready, err)
	}
	var claimed ClaimResult
	if err := json.Unmarshal(call("claim_ticket", map[string]any{"ticket_id": id}, false), &claimed); err != nil || !claimed.Claimed || claimed.Ticket.StatusSince == nil {
		t.Fatal(claimed, err)
	}
	call("claim_ticket", map[string]any{"ticket_id": id}, true)
	call("get_ready_tickets", map[string]any{"project_id": 0}, true)
	call("claim_next_ticket", map[string]any{"epic_id": 999}, true)
	if err := json.Unmarshal(call("claim_next_ticket", map[string]any{"project_id": p}, false), &claimed); err != nil || claimed.Claimed || claimed.Ticket != nil {
		t.Fatal(claimed, err)
	}
	create(t, a, "tickets", Input{Title: ptr("Next"), EpicID: &e})
	if err := json.Unmarshal(call("claim_next_ticket", map[string]any{"epic_id": e}, false), &claimed); err != nil || !claimed.Claimed {
		t.Fatal(claimed, err)
	}
}
