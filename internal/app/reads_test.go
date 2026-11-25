package app

import (
	"context"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestTargetedReadsAndFilterValidation(t *testing.T) {
	a := testApp(t)
	p, e, id := seed(t, a)
	archived, err := a.CreateEpic(context.Background(), CreateEpicInput{ProjectID: p, Title: "Archive", Completed: ptr(true), Archived: ptr(true)})
	if err != nil {
		t.Fatal(err)
	}
	old, err := a.CreateTicket(context.Background(), CreateTicketInput{EpicID: archived.ID, Title: "Archived"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path     string
		status   int
		fragment string
	}{
		{fmt.Sprintf("/api/projects/%d", p), 200, `"name":"Project"`},
		{fmt.Sprintf("/api/epics/%d", archived.ID), 200, `"archived":true`},
		{fmt.Sprintf("/api/tickets/%d", old.ID), 200, `"title":"Archived"`},
		{"/api/tickets/999", 404, `"error"`},
		{"/api/epics?archived=false&include_archived=true", 200, `"title":"Epic"`},
		{fmt.Sprintf("/api/tickets?epic_id=%d&status=todo", e), 200, fmt.Sprintf(`"id":%d`, id)},
		{"/api/tickets?epic_id=999", 200, `[]`},
		{"/api/epics?project_id=bad", 400, `"error"`},
		{"/api/epics?completed=maybe", 400, `"error"`},
		{"/api/epics?completed=true&completed=false", 400, `"error"`},
		{"/api/tickets?status=unknown", 400, `"error"`},
		{"/api/tickets?epic_id=0", 400, `"error"`},
		{"/api/tickets?include_archived=", 400, `"error"`},
	} {
		w := httptest.NewRecorder()
		testHandler(a).ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.fragment) {
			t.Fatalf("%s: %d %s", tc.path, w.Code, w.Body.String())
		}
	}
	epics, err := a.Store.Epics(context.Background(), EpicFilter{Archived: ptr(false), IncludeArchived: true})
	if err != nil || len(epics) != 1 || epics[0].ID != e {
		t.Fatal(epics, err)
	}
	tickets, err := a.Store.Tickets(context.Background(), TicketFilter{})
	if err != nil || len(tickets) != 1 || tickets[0].ID != id {
		t.Fatal(tickets, err)
	}
	// Detail and project-list reads must not depend on unrelated workspace tables.
	if _, err := a.Store.db.Exec("DROP TABLE links"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.Ticket(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.Projects(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestExecutionSnapshotScopeAndConnectionRelease(t *testing.T) {
	a := testApp(t)
	p, _, id := seed(t, a)
	other, err := a.CreateProject(context.Background(), CreateProjectInput{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	e, err := a.CreateEpic(context.Background(), CreateEpicInput{ProjectID: other.ID, Title: "External"})
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := a.CreateTicket(context.Background(), CreateTicketInput{EpicID: e.ID, Title: "External blocker"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateTicket(context.Background(), CreateTicketInput{EpicID: e.ID, Title: "Unrelated"}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateLink(context.Background(), LinkInput{blocker.ID, id}); err != nil {
		t.Fatal(err)
	}
	state, events, err := a.Store.projectExecutionData(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Projects) != 1 || len(state.Epics) != 1 || len(state.Tickets) != 2 {
		t.Fatalf("report loaded unrelated resources: %+v", state)
	}
	if a.Store.db.Stats().InUse != 0 {
		t.Fatal("report snapshot retains database connection")
	}
	if !a.Store.mu.TryLock() {
		t.Fatal("report snapshot retains store lock")
	}
	a.Store.mu.Unlock()
	full, err := a.Store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	want, err := buildProjectExecution(full, events, p, now)
	if err != nil {
		t.Fatal(err)
	}
	got, err := buildProjectExecution(state, events, p, now)
	if err != nil || !reflect.DeepEqual(got, want) || got.Metrics.Blocked != 1 {
		t.Fatal(got, want, err)
	}
}

func BenchmarkTargetedTicketRead(b *testing.B) {
	s, err := Open(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.Exec(`INSERT INTO projects(name) VALUES('Benchmark');
		WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20)
		INSERT INTO epics(project_id,title) SELECT 1,'Epic '||x FROM n;
		WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000)
		INSERT INTO tickets(epic_id,title,description) SELECT (x%20)+1,'Ticket '||x,printf('%01000d',x) FROM n;`); err != nil {
		b.Fatal(err)
	}
	ctx := context.Background()
	b.Run("full_snapshot_lookup", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			state, err := s.Snapshot(ctx)
			if err != nil {
				b.Fatal(err)
			}
			if len(state.Tickets) != 2000 || state.Tickets[999].ID != 1000 {
				b.Fatal("invalid benchmark fixture")
			}
		}
	})
	b.Run("targeted_lookup", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			ticket, err := s.Ticket(ctx, 1000)
			if err != nil || ticket.ID != 1000 {
				b.Fatal(ticket, err)
			}
		}
	})
}
