package app

import (
	"context"
	"database/sql"
	"sort"
	"time"
)

type ExecutionSegment struct {
	Status  string `json:"status"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Ongoing bool   `json:"ongoing"`
}

type TicketExecution struct {
	Ticket                    Ticket             `json:"ticket"`
	HistoryComplete           bool               `json:"history_complete"`
	ObservedFrom              *string            `json:"observed_from"`
	TimingState               string             `json:"timing_state"`
	StartedAt                 *string            `json:"started_at"`
	CompletedAt               *string            `json:"completed_at"`
	FirstObservedCompletionAt *string            `json:"first_observed_completion_at"`
	CycleSeconds              *float64           `json:"cycle_seconds"`
	ActiveAgeSeconds          *float64           `json:"active_age_seconds"`
	InProgressSeconds         float64            `json:"in_progress_seconds"`
	ReviewSeconds             float64            `json:"review_seconds"`
	Segments                  []ExecutionSegment `json:"segments"`
}

type ExecutionMetrics struct {
	Total                   int            `json:"total"`
	Completed               int            `json:"completed"`
	Active                  int            `json:"active"`
	Blocked                 int            `json:"blocked"`
	NotStarted              int            `json:"not_started"`
	PartialHistory          int            `json:"partial_history"`
	TimingUnavailable       int            `json:"timing_unavailable"`
	StatusCounts            map[string]int `json:"status_counts"`
	InProgressSeconds       float64        `json:"in_progress_seconds"`
	ReviewSeconds           float64        `json:"review_seconds"`
	MedianCompletionSeconds *float64       `json:"median_completion_seconds"`
	CompletionSamples       int            `json:"completion_samples"`
	OldestActiveAgeSeconds  *float64       `json:"oldest_active_age_seconds"`
	ActiveAgeSamples        int            `json:"active_age_samples"`
}

type EpicExecution struct {
	Epic    Epic              `json:"epic"`
	Metrics ExecutionMetrics  `json:"metrics"`
	Tickets []TicketExecution `json:"tickets"`
}

type CompletionBucket struct {
	Date    string `json:"date"`
	Tickets int    `json:"tickets"`
}

type ProjectExecution struct {
	Project           Project            `json:"project"`
	GeneratedAt       string             `json:"generated_at"`
	Metrics           ExecutionMetrics   `json:"metrics"`
	EpicsTotal        int                `json:"epics_total"`
	EpicsCompleted    int                `json:"epics_completed"`
	EpicsArchived     int                `json:"epics_archived"`
	Epics             []EpicExecution    `json:"epics"`
	DailyCompletions  []CompletionBucket `json:"daily_completions"`
	WeeklyCompletions []CompletionBucket `json:"weekly_completions"`
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }
func seconds(start, end time.Time) float64 {
	if end.Before(start) {
		return 0
	}
	return end.Sub(start).Seconds()
}

func deriveExecution(ticket Ticket, events []StatusEvent, now time.Time) (TicketExecution, error) {
	out := TicketExecution{Ticket: ticket, Segments: []ExecutionSegment{}, TimingState: "unavailable"}
	if len(events) == 0 {
		return out, nil
	}
	out.HistoryComplete = events[0].Kind == "created"
	out.ObservedFrom = ptrValue(events[0].ChangedAt)
	times := make([]time.Time, len(events))
	for i, event := range events {
		at, err := time.Parse(time.RFC3339Nano, event.ChangedAt)
		if err != nil {
			return out, err
		}
		// Preserve event ordering even if the host clock moves backwards.
		if i > 0 && at.Before(times[i-1]) {
			at = times[i-1]
		}
		times[i] = at
		if out.HistoryComplete && out.StartedAt == nil && event.ToStatus == "in_progress" {
			out.StartedAt = ptrValue(stamp(at))
		}
		if event.ToStatus == "done" && event.Kind != "baseline" && out.FirstObservedCompletionAt == nil {
			out.FirstObservedCompletionAt = ptrValue(stamp(at))
		}
	}
	if now.Before(times[len(times)-1]) {
		now = times[len(times)-1]
	}
	observingWork := false
	for i, event := range events {
		start := times[i]
		end := now
		ongoing := i == len(events)-1 && event.ToStatus != "done"
		if i+1 < len(events) {
			end = times[i+1]
		} else if event.ToStatus == "done" {
			end = start
		}
		if event.ToStatus == "in_progress" {
			out.InProgressSeconds += seconds(start, end)
		}
		if event.ToStatus == "ready_for_review" {
			out.ReviewSeconds += seconds(start, end)
		}
		if event.ToStatus == "in_progress" || event.ToStatus == "ready_for_review" || (event.ToStatus == "done" && event.Kind != "baseline") {
			observingWork = true
		}
		if observingWork {
			out.Segments = append(out.Segments, ExecutionSegment{event.ToStatus, stamp(start), stamp(end), ongoing})
		}
	}
	last := events[len(events)-1]
	if ticket.Status == "done" && last.ToStatus == "done" && last.Kind != "baseline" {
		out.CompletedAt = ptrValue(stamp(times[len(times)-1]))
	}
	if out.StartedAt != nil {
		started, _ := time.Parse(time.RFC3339Nano, *out.StartedAt)
		if out.CompletedAt != nil {
			completed, _ := time.Parse(time.RFC3339Nano, *out.CompletedAt)
			out.CycleSeconds = ptrValue(seconds(started, completed))
		} else if ticket.Status != "done" {
			out.ActiveAgeSeconds = ptrValue(seconds(started, now))
		}
	}
	if len(out.Segments) > 0 {
		out.TimingState = "observed"
	} else if out.HistoryComplete && ticket.Status == "todo" {
		out.TimingState = "not_started"
	}
	return out, nil
}

func ptrValue[T any](v T) *T { return &v }

func executionMetrics(tickets []TicketExecution, blocked map[int64]bool) ExecutionMetrics {
	m := ExecutionMetrics{StatusCounts: map[string]int{"todo": 0, "in_progress": 0, "ready_for_review": 0, "done": 0}}
	cycles := []float64{}
	for _, t := range tickets {
		m.Total++
		m.StatusCounts[t.Ticket.Status]++
		if t.Ticket.Status == "done" {
			m.Completed++
		}
		if t.Ticket.Status != "done" && blocked[t.Ticket.ID] {
			m.Blocked++
		}
		if t.Ticket.Status == "in_progress" || t.Ticket.Status == "ready_for_review" {
			m.Active++
			if t.ActiveAgeSeconds != nil {
				m.ActiveAgeSamples++
				if m.OldestActiveAgeSeconds == nil || *t.ActiveAgeSeconds > *m.OldestActiveAgeSeconds {
					m.OldestActiveAgeSeconds = ptrValue(*t.ActiveAgeSeconds)
				}
			}
		}
		if !t.HistoryComplete {
			m.PartialHistory++
		}
		if t.TimingState == "not_started" {
			m.NotStarted++
		}
		if t.TimingState == "unavailable" {
			m.TimingUnavailable++
		}
		m.InProgressSeconds += t.InProgressSeconds
		m.ReviewSeconds += t.ReviewSeconds
		if t.CycleSeconds != nil {
			cycles = append(cycles, *t.CycleSeconds)
		}
	}
	sort.Float64s(cycles)
	m.CompletionSamples = len(cycles)
	if len(cycles) > 0 {
		mid := len(cycles) / 2
		median := cycles[mid]
		if len(cycles)%2 == 0 {
			median = (cycles[mid-1] + cycles[mid]) / 2
		}
		m.MedianCompletionSeconds = &median
	}
	return m
}

func completionBuckets(tickets []TicketExecution, now time.Time, weekly bool) []CompletionBucket {
	now = now.UTC()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	count, step := 28, 1
	if weekly {
		end = end.AddDate(0, 0, -(int(end.Weekday())+6)%7)
		count, step = 12, 7
	}
	buckets := make([]CompletionBucket, count)
	indices := map[string]int{}
	for i := range buckets {
		date := end.AddDate(0, 0, -(count-1-i)*step).Format("2006-01-02")
		buckets[i] = CompletionBucket{Date: date}
		indices[date] = i
	}
	for _, t := range tickets {
		if t.FirstObservedCompletionAt == nil {
			continue
		}
		at, _ := time.Parse(time.RFC3339Nano, *t.FirstObservedCompletionAt)
		at = at.UTC()
		if at.After(now) {
			continue
		}
		if weekly {
			at = at.AddDate(0, 0, -(int(at.Weekday())+6)%7)
		}
		if i, ok := indices[at.Format("2006-01-02")]; ok {
			buckets[i].Tickets++
		}
	}
	return buckets
}

func buildProjectExecution(state State, events []StatusEvent, id int64, now time.Time) (ProjectExecution, error) {
	out := ProjectExecution{GeneratedAt: stamp(now), Epics: []EpicExecution{}}
	found := false
	for _, p := range state.Projects {
		if p.ID == id {
			out.Project = p
			found = true
			break
		}
	}
	if !found {
		return out, missing()
	}
	byTicket := map[int64][]StatusEvent{}
	for _, event := range events {
		byTicket[event.TicketID] = append(byTicket[event.TicketID], event)
	}
	statuses := map[int64]string{}
	blocked := map[int64]bool{}
	for _, t := range state.Tickets {
		statuses[t.ID] = t.Status
	}
	for _, l := range state.Links {
		if status, ok := statuses[l.BlockerID]; ok && status != "done" {
			blocked[l.BlockedID] = true
		}
	}
	all := []TicketExecution{}
	for _, epic := range state.Epics {
		if epic.ProjectID != id {
			continue
		}
		e := EpicExecution{Epic: epic, Tickets: []TicketExecution{}}
		out.EpicsTotal++
		if epic.Completed {
			out.EpicsCompleted++
		}
		if epic.Archived {
			out.EpicsArchived++
		}
		for _, ticket := range state.Tickets {
			if ticket.EpicID != epic.ID {
				continue
			}
			timing, err := deriveExecution(ticket, byTicket[ticket.ID], now)
			if err != nil {
				return out, err
			}
			e.Tickets = append(e.Tickets, timing)
			all = append(all, timing)
		}
		e.Metrics = executionMetrics(e.Tickets, blocked)
		// Archived work remains in aggregate metrics and throughput, but is not
		// an ordinary epic/ticket listing or a project timeline row.
		if !epic.Archived {
			out.Epics = append(out.Epics, e)
		}
	}
	out.Metrics = executionMetrics(all, blocked)
	out.DailyCompletions = completionBuckets(all, now, false)
	out.WeeklyCompletions = completionBuckets(all, now, true)
	return out, nil
}

func (s *Store) ProjectExecution(ctx context.Context, id int64) (ProjectExecution, error) {
	if id <= 0 {
		return ProjectExecution{}, invalid("A positive project ID is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ProjectExecution{}, err
	}
	defer tx.Rollback()
	state, err := snapshotTx(ctx, tx)
	if err != nil {
		return ProjectExecution{}, err
	}
	events, err := historyTx(ctx, tx, 0, id)
	if err != nil {
		return ProjectExecution{}, err
	}
	out, err := buildProjectExecution(state, events, id, time.Now().UTC())
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
