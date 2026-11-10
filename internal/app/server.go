package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type App struct {
	Store *Store
	mu    sync.Mutex
	subs  map[chan struct{}]struct{}
	MCP   *mcp.Server
}

func New(store *Store) *App {
	a := &App{Store: store, subs: make(map[chan struct{}]struct{})}
	a.MCP = a.newMCP()
	return a
}

func (a *App) publish() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for ch := range a.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (a *App) Mutate(ctx context.Context, kind, action string, id int64, in Input) (any, error) {
	out, err := a.Store.Mutate(ctx, kind, action, id, in)
	if err == nil {
		a.publish()
	}
	return out, err
}

// WatchDatabase also picks up writes made by a separate --mcp-stdio process.
func (a *App) WatchDatabase(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var previous int64
	for {
		a.Store.mu.RLock()
		var version int64
		err := a.Store.db.QueryRowContext(ctx, "PRAGMA data_version").Scan(&version)
		a.Store.mu.RUnlock()
		if err == nil {
			if previous != 0 && version != previous {
				a.publish()
			}
			previous = version
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *App) Handler(assets fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		state, err := a.Store.Snapshot(r.Context())
		respond(w, state, err, 200)
	})
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("/api/tickets/ready", a.readyTicketsHTTP)
	mux.HandleFunc("/api/tickets/claim-next", a.claimNextHTTP)
	mux.HandleFunc("/api/tickets/{id}/claim", a.claimTicketHTTP)
	mux.HandleFunc("/api/tickets/{id}/history", func(w http.ResponseWriter, r *http.Request) {
		if !readOnly(w, r) {
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id <= 0 {
			respond(w, nil, invalid("Invalid ID"), 0)
			return
		}
		events, err := a.Store.TicketHistory(r.Context(), id)
		respond(w, historyResult(id, events), err, 200)
	})
	mux.HandleFunc("/api/projects/{id}/execution", func(w http.ResponseWriter, r *http.Request) {
		if !readOnly(w, r) {
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id <= 0 {
			respond(w, nil, invalid("Invalid ID"), 0)
			return
		}
		report, err := a.Store.ProjectExecution(r.Context(), id)
		respond(w, report, err, 200)
	})
	mux.HandleFunc("/api/{kind}", a.collection)
	mux.HandleFunc("/api/{kind}/{id}", a.item)
	mux.Handle("/mcp", mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return a.MCP }, &mcp.StreamableHTTPOptions{Stateless: true}))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { respond(w, nil, missing(), 0) })
	files := http.FileServer(http.FS(assets))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			respond(w, nil, &APIError{405, "Method not allowed"}, 0)
			return
		}
		if r.URL.Path != "/" {
			name := strings.TrimPrefix(r.URL.Path, "/")
			if !fs.ValidPath(name) {
				http.NotFound(w, r)
				return
			}
			if _, err := fs.Stat(assets, name); err != nil {
				if strings.Contains(name, ".") || strings.HasPrefix(name, "api/") {
					http.NotFound(w, r)
					return
				}
				r.URL.Path = "/"
			}
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/mcp" {
			w.Header().Set("Cache-Control", "no-store")
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				if err != nil || !strings.EqualFold(u.Host, r.Host) || (u.Scheme != "http" && u.Scheme != "https") {
					respond(w, nil, &APIError{403, "Cross-origin requests are not allowed"}, 0)
					return
				}
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				respond(w, nil, &APIError{403, "Cross-site requests are not allowed"}, 0)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		}
		mux.ServeHTTP(w, r)
	})
}

func readOnly(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet {
		return true
	}
	w.Header().Set("Allow", "GET")
	respond(w, nil, &APIError{405, "Method not allowed"}, 0)
	return false
}

func respond(w http.ResponseWriter, data any, err error, success int) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		status, message := errorStatus(err)
		if status == 500 {
			slog.Error("request failed", "error", err)
		}
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": message})
		return
	}
	w.WriteHeader(success)
	json.NewEncoder(w).Encode(data)
}

func readInput(r *http.Request) (Input, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return Input{}, invalid("Request body is too large or unreadable")
	}
	return decodeInput(raw)
}

func (a *App) collection(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != "projects" && kind != "epics" && kind != "tickets" && kind != "links" {
		respond(w, nil, missing(), 0)
		return
	}
	if r.Method == "GET" {
		includeArchived := false
		var archived *bool
		if kind == "epics" || kind == "tickets" {
			if raw := r.URL.Query().Get("include_archived"); raw != "" {
				var err error
				includeArchived, err = strconv.ParseBool(raw)
				if err != nil {
					respond(w, nil, invalid("include_archived must be true or false"), 0)
					return
				}
			}
		}
		if kind == "epics" {
			if raw := r.URL.Query().Get("archived"); raw != "" {
				v, err := strconv.ParseBool(raw)
				if err != nil {
					respond(w, nil, invalid("archived must be true or false"), 0)
					return
				}
				archived = &v
			}
		}
		state, err := a.Store.Snapshot(r.Context())
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		var out any
		switch kind {
		case "projects":
			out = state.Projects
		case "epics":
			items := []Epic{}
			for _, e := range state.Epics {
				if archived != nil {
					if e.Archived != *archived {
						continue
					}
				} else if e.Archived && !includeArchived {
					continue
				}
				if matchID(r, "project_id", e.ProjectID) && (r.URL.Query().Get("completed") == "" || strconv.FormatBool(e.Completed) == r.URL.Query().Get("completed")) {
					items = append(items, e)
				}
			}
			out = items
		case "tickets":
			items := []Ticket{}
			archivedEpics := map[int64]bool{}
			for _, e := range state.Epics {
				archivedEpics[e.ID] = e.Archived
			}
			for _, t := range state.Tickets {
				if archivedEpics[t.EpicID] && !includeArchived {
					continue
				}
				if matchID(r, "epic_id", t.EpicID) && (r.URL.Query().Get("status") == "" || t.Status == r.URL.Query().Get("status")) {
					items = append(items, t)
				}
			}
			out = items
		case "links":
			out = state.Links
		}
		respond(w, out, nil, 200)
		return
	}
	if r.Method != "POST" && !(kind == "links" && r.Method == "DELETE") {
		w.Header().Set("Allow", "GET, POST"+map[bool]string{true: ", DELETE"}[kind == "links"])
		respond(w, nil, &APIError{405, "Method not allowed"}, 0)
		return
	}
	in, err := readInput(r)
	if err != nil {
		respond(w, nil, err, 0)
		return
	}
	action, status := "create", 201
	if r.Method == "DELETE" {
		action, status = "delete", 200
	}
	out, err := a.Mutate(r.Context(), kind, action, 0, in)
	respond(w, out, err, status)
}

func matchID(r *http.Request, key string, id int64) bool {
	raw := r.URL.Query().Get(key)
	return raw == "" || raw == strconv.FormatInt(id, 10)
}

func (a *App) item(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != "projects" && kind != "epics" && kind != "tickets" {
		respond(w, nil, missing(), 0)
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond(w, nil, invalid("Invalid ID"), 0)
		return
	}
	if r.Method == "GET" {
		state, err := a.Store.Snapshot(r.Context())
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
		var out any
		switch kind {
		case "projects":
			for _, p := range state.Projects {
				if p.ID == id {
					out = p
					break
				}
			}
		case "epics":
			for _, e := range state.Epics {
				if e.ID == id {
					out = e
					break
				}
			}
		case "tickets":
			for _, t := range state.Tickets {
				if t.ID == id {
					out = t
					break
				}
			}
		}
		if out == nil {
			respond(w, nil, missing(), 0)
			return
		}
		respond(w, out, nil, 200)
		return
	}
	if r.Method != "PATCH" && r.Method != "DELETE" {
		w.Header().Set("Allow", "GET, PATCH, DELETE")
		respond(w, nil, &APIError{405, "Method not allowed"}, 0)
		return
	}
	action := "delete"
	var in Input
	if r.Method == "PATCH" {
		action = "update"
		in, err = readInput(r)
		if err != nil {
			respond(w, nil, err, 0)
			return
		}
	}
	out, err := a.Mutate(r.Context(), kind, action, id, in)
	respond(w, out, err, 200)
}

func (a *App) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unavailable", 500)
		return
	}
	ch := make(chan struct{}, 1)
	a.mu.Lock()
	a.subs[ch] = struct{}{}
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.subs, ch); a.mu.Unlock() }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	// Sync on every connection, including reconnects after missed events.
	if _, err := fmt.Fprint(w, "event: change\ndata: {}\n\n"); err != nil {
		return
	}
	flusher.Flush()
	tick := time.NewTicker(20 * time.Second)
	defer tick.Stop()
	for {
		var message string
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			message = "event: change\ndata: {}\n\n"
		case <-tick.C:
			message = ": heartbeat\n\n"
		}
		// Bound writes so disconnected/slow clients cannot hold shutdown open.
		rc := http.NewResponseController(w)
		_ = rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, message); err != nil {
			return
		}
		flusher.Flush()
		_ = rc.SetWriteDeadline(time.Time{})
	}
}
