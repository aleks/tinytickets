# Application, API, and development reference

A small, local-first ticket board. One Go binary serves an embedded React frontend, a REST API, and an MCP server. SQLite is the only datastore; no external services or CGO are needed.

## Documentation

See the [documentation index](README.md) for coding-agent setup and work tracking.
To let an agent do the setup, give it the [agent setup procedure](setup-for-agents.md).
To build or host the static documentation website, see [site/README.md](../site/README.md).

Run the commands below from the repository root.


## Run

Requires Go 1.26+ to build. The built frontend is checked in, so Node is not required unless you change it.

```sh
go build -o tinytickets .
./tinytickets
```

Open **http://127.0.0.1:8080**.

```sh
./tinytickets --addr 127.0.0.1:9000 --db /path/to/tickets.db
./tinytickets --help
```

The database defaults to `~/.tinytickets/tinytickets.db`. Parent directories are created automatically. New database files are private to your user. Changes persist immediately. To back up a running database, use SQLite's backup command (for example, `sqlite3 ~/.tinytickets/tinytickets.db '.backup backup.db'`), rather than copying only the `.db` file while WAL writes are active. Alternatively, stop **all** processes using the database before copying it.

**Security:** TinyTickets is a single-user application without authentication. It binds to loopback by default, rejects cross-origin API/MCP requests, and checks the Host header on local-only listeners. Do not expose it to untrusted networks. Use an authenticated reverse proxy if remote access is needed. MCP clients have full access to the selected database; only connect trusted agents.

## Workspace

- Projects contain epics; epics contain tickets. Neither parent is optional.
- Project board epic cards show active epics first and completed epics last, newest-created first within each group. Creation, completion, and reopening update their order live.
- Tickets have a title, a description stored as text, and one of four statuses: **Todo**, **In progress**, **Ready for review**, **Done**.
- Click a ticket's title in its editor header to open its full page (`/#ticket/{id}`). Descriptions render as Markdown with tables, task lists, fenced code blocks, and fenced `mermaid` diagrams. Raw HTML and active diagram content are not allowed; invalid diagrams show their source instead. Mermaid loads locally on demand, with no external rendering service. Diagrams follow your theme and accent.
- Full ticket pages show project/epic links, status, dependencies, and timestamps. Use **Edit ticket** to change titles, descriptions, or dependencies; status and epic can also be changed directly in the details sidebar. Full pages support direct links, browser navigation, live updates, and completed epics.
- Below the description, **Work log** shows notes and structured **review handoffs** together, oldest append first, with timestamps and optional author labels. Use **Add an update** to append Markdown progress, decisions, tests, or a handoff. New entries update live without overwriting an unsent draft. Entries cannot be edited/deleted independently; append corrections instead. Author labels are informational, not authenticated identities.
- A review handoff requires **Summary** and **Verification**, with optional **References** (commits/artifacts) and **Review notes**. Saving atomically appends the handoff and moves the ticket to **Ready for review**. Verification should honestly include failing/not-run checks, not just successes. Ordinary notes leave status, `updated_at`, and timers unchanged; another handoff while already in review preserves its timer. The original description remains the task specification.
- Drag tickets between columns, or change status in the ticket editor (also works with keyboard/touch).
- Cards in **In progress** and **Ready for review** show a live clock for time spent in their **current column**. Every actual column move resets it, including moves between progress/review or back from done; todo/done cards have no counter. Title/description edits and same-status updates do not reset it. Clocks use one shared local one-second tick, survive reloads, and do not write to the database or poll the API every second. Unknown column-entry times show `—` instead of a fabricated age.
- Links express **blocks / blocked by**. The two labels describe the same directed link. Self-links and dependency cycles are rejected. Unfinished blockers are flagged on cards; they do not prevent moving a ticket.
- Open a project's **Dependencies** tab (`/#project/{id}/dependencies`) for an interactive, read-only dependency map. Arrows run **blocker → dependent**, with roots on the left and dependent work to the right. Completed tickets/satisfied arrows are muted; **Ready to start** requires Todo, an unfinished/unarchived epic, and every blocker Done. Blocked badges also flag active work whose blockers were reopened. Independent tickets are shown too; a completed epic's unfinished tickets are not ready.
- Select a map card (click or Tab/Enter) to highlight its ancestors and descendants and inspect all direct blockers/dependents. **Show only this ticket's chain** removes unrelated/sibling branches; **Open ticket** goes to its full page for editing links. Maps update live from the same workspace snapshot as the board; selection and filters survive refreshes while the view is open. The map itself never changes statuses, claims tickets, or modifies links; readiness is a snapshot, not a reservation.
- Directly linked tickets from other projects or hidden archives appear as **dashed context cards**, labeled with their project/archive state, so boundary blockers are not silently omitted. **Expand external chains** includes the full connected components beyond those one-hop boundaries. Cards report connections outside the filtered view; the selected-ticket panel always lists all direct relationships. **Include archived epics** adds otherwise hidden project tickets; linked archive context remains visible by default. **Hide done tickets** also hides their arrows without changing readiness, which always checks global blockers. Archived/completed blocker epics do not satisfy a dependency—the blocking ticket must be Done.
- Map controls offer **Fit width**, **25–150% zoom**, and a keyboard-focusable, scrollable graph. Ticket links, textual status badges and relationship lists support keyboard/touch and light/dark/mobile layouts. Layout is deterministic by dependency depth and ticket ID, not a schedule or priority order. Invalid imported cycles show a warning and keep tickets accessible instead of hanging. Rendering uses local HTML/SVG with no external graph service.
- **How to read the map**, below the graph, explains dotted unresolved dependencies, solid muted satisfied dependencies, accent-highlighted chains (which override normal line styling), and dashed context-card borders, with visual samples and text.
- The overview shows active epics and their tickets. Completing an epic hides it **and its tickets** from the overview without deleting anything. Completed epics remain in the sidebar, all-epics page, and project pages, and can be reopened.
- Completed epics can additionally be **archived**. Archived epics and their tickets disappear from ordinary sidebar/project/board listings, epic assignment options, and project timeline rows. The **Epics** page separates active/completed epics from an **Archived epics** section. Search covers both sections. Open an archived epic's page to unarchive it; archive controls are also available on completed epic pages and in the epic editor.
- A project's Board tab has a **Show archived epics** toggle beside the **Epics** heading when that project has archives. It includes archived cards in the same epic list and updates the heading count. Open an archived epic's page to restore it or review its deletion impact. Archives stay hidden by default; showing their cards does not add their tickets to the board.
- Archiving preserves tickets, links, status history, and direct epic/ticket URLs. Direct pages clearly show archive state and allow restoration; existing tickets remain editable. A current archived parent is retained as a disabled selection when editing its ticket, not offered as a new assignment. Only completed epics can be archived, and an epic must be unarchived before reopening; unarchive preserves its completed state. An atomic `{"archived":false,"completed":false}` update can restore and reopen together. The database also enforces this invariant.
- Deletion opens a confirmation modal with aggregate counts, not a list of children. Nonempty projects/epics require an unchecked-by-default **Force delete** checkbox to include their contents, including completed/archived work. Empty parents and tickets need no force checkbox. Deletion permanently removes affected tickets' links, status history, work logs and review handoffs, including their contribution to metrics. Archiving preserves this data instead.
- Linked tickets outside the deleted hierarchy survive, but their links to deleted tickets disappear and some may become ready. A warning makes this explicit. If the deletion scope changes while confirming, nothing is deleted and the modal refreshes its preview and clears Force delete. Failed writes are never automatically retried; refresh their preview before confirming again. Cancelling ticket deletion retains unsaved editor fields.
- Light/dark mode initially follows your system preference; the toggle saves an explicit choice locally.
- The color picker beside the theme toggle offers five muted accents: Sage (default), Slate, Lavender, Clay, and Sand. In dark mode, backgrounds, borders, and text neutrals also follow the selected palette. The choice applies in both modes and is saved locally alongside your theme preference.
- Server-sent events refresh the board after REST/MCP changes. A SQLite watcher also detects writes from separate stdio processes (within about one second). A 15-second polling fallback handles buffered streams; reconnecting or waking the tab triggers a fresh snapshot.

No sample projects or tickets are added to your database.

## Execution insights

Open a project and choose **Progress** next to **Board**, or link directly to `/#project/{id}/progress`. This is a record of actual execution, not a schedule: there are no start/due-date inputs, estimates, or extra agent bookkeeping.

- Expand/collapse epics to see their tickets on a status-colored timeline. In-progress, review, returned-to-todo, and done intervals are distinct, including repeated reviews and reopenings. Ongoing intervals extend to now. Epic spans derive from observed ticket intervals, not when the epic was manually marked completed.
- Choose all recorded history or a recent hour/day/week/month window. Range selection affects the timeline only; summary metrics cover all current project tickets. Timeline timestamps use local time, with seconds/milliseconds for short agent runs. Completed epics can be hidden from the timeline and untimed lists without changing the project totals.
- New todo tickets appear under **Not started**. Tickets without observed execution appear under **Timing unavailable**, not at fabricated dates. Partial observed timelines are explicitly labeled.
- Archived epics are excluded from timeline/untimed rows, but remain in all aggregate metrics, sample coverage, epic counts, and recorded completions. An archive count/note makes this explicit; restore an epic from the Epics page to see its rows again.
- Metrics show completed/total tickets, active tickets (in progress or review), unfinished blocked tickets (including cross-project blockers), median completion time, summed observed in-progress/review time, and the oldest active ticket with a known start. Completion is ticket-count based, not a measure of effort. Explicit epic completion flags are independent of ticket completion counts.

### History and metric definitions

A **baseline** event records a ticket's known status when its earlier history is unavailable. Neither `created_at` nor `updated_at` is used to guess a historical start or completion. Subsequent observed intervals remain useful, but baseline tickets never enter start-dependent completion/age samples.

SQLite triggers record each new ticket's initial status and every actual status change in the same transaction as the write. REST, MCP, and UI writes are covered. No-op status updates and title/description edits do not add events. Tickets created directly in review/done have no known in-progress start. History is read-only through the API/MCP.

- **Median completion time:** first recorded in-progress timestamp → latest recorded done timestamp for *currently done* tickets with full history and a known start. It includes pauses, repeated reviews, and closed intervals before reopening. Reopened unfinished tickets leave the sample until completed again. Sample counts are shown; unavailable values stay `null`/`—`, not zero.
- **Observed work/review:** sum of recorded time in `in_progress` / `ready_for_review`, including partial intervals observed after a baseline. Parallel tickets overlap, so this is neither agent effort nor project wall-clock duration.
- **Oldest active ticket:** lifecycle age from first known in-progress timestamp to now, among currently in-progress/review tickets with full history. Closed/reopened gaps are included; unknown starts are excluded and coverage is shown.
- **Card clock:** a separate, current-column counter using the latest known entry into in-progress/review, not lifecycle age or summed work/review time. A ticket can acquire a known current-column clock after a real move even when its earlier lifecycle history is incomplete.
- **Recorded completions:** each ticket counts once at its **first observed** creation/transition into done, even if later reopened. A baseline in done does not count. Daily buckets cover 28 UTC days; weekly buckets cover 12 UTC weeks starting Monday, including the current day/week. Zeros mean no *recorded* completions, not proof that no older work occurred. Counts can differ from the current done total.
- Aggregate reports include all tickets/epics currently in the project, including completed/archived epics. The `epics` detail rows exclude archived epics; `epics_total`, `epics_completed`, `epics_archived`, metrics, and completion buckets still include them. Moving a ticket/epic carries its execution history into the new project; this is current-membership reporting, not historical project attribution. Deleting a ticket deletes its history and removes it from reports; this is not a permanent audit log.

Reports use a consistent database snapshot and refresh through the same live-update/polling mechanism as the board. Status changes record execution history automatically; agents do not need to enter timing data.

## MCP

### OpenCode

From this repository, build the binary and register it globally in OpenCode:

```sh
go build -o tinytickets .
opencode mcp add tinytickets --global -- "$(pwd)/tinytickets" --mcp-stdio
opencode mcp list
```

The list should show `tinytickets connected`. OpenCode starts the stdio process automatically; no running HTTP server is needed. Configuration reloads automatically (or use `/reload`). Omit `--global` to configure only the current project.

This uses `~/.tinytickets/tinytickets.db`, the same database as `./tinytickets`. Append `--db /absolute/path/to/tickets.db` to the registration command to use another database. The configuration stores the binary's absolute path, so keep it there (and rebuild it after source changes), or register it again after moving it.

### Streamable HTTP

Start TinyTickets normally, then connect your MCP client to:

```text
http://127.0.0.1:8080/mcp
```

Example client configuration (the exact remote-server configuration varies by client):

```json
{
  "mcpServers": {
    "tinytickets": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp"
    }
  }
}
```

### Stdio

For clients that launch a local MCP process:

```json
{
  "mcpServers": {
    "tinytickets": {
      "command": "/absolute/path/to/tinytickets",
      "args": ["--mcp-stdio", "--db", "/absolute/path/to/tickets.db"]
    }
  }
}
```

Use the same `--db` path for the HTTP and stdio processes if they should share a workspace. Stdio mode does not start an HTTP server and does not write application logs to stdout.

The official Go MCP SDK supplies protocol negotiation, tool schemas, validation, and transport handling. Tools:

| Tool | Purpose |
| --- | --- |
| `get_workspace` | Complete, hierarchy-consistent snapshot including completed/archived epics and their tickets/links; inspect `archived` flags when making ordinary listings |
| `get_ready_tickets` | Read ready tickets, oldest-created first; optional `project_id`, `epic_id`; returns `{ "tickets": [...] }` |
| `claim_next_ticket` | Atomically select ready work and move it to In progress; optional `project_id`, `epic_id` |
| `claim_ticket` | Atomically recheck and start a specific ready ticket using `ticket_id` |
| `get_ticket_history` | Ordered creation/baseline/status events for `ticket_id`, with a `history_complete` flag |
| `get_ticket_work_log` | Read notes and review handoffs for `ticket_id` together in stable append order; returns `{ "ticket_id": 1, "entries": [...] }` |
| `add_work_log` | Append Markdown `body` for `ticket_id`, optional `author`; preserves description/status/timing |
| `create_review_handoff` | Append `summary`, `verification`, optional `references`, `review_notes`, `author` for `ticket_id`, and atomically move to review; returns `{ "entry": {...}, "ticket": {...} }` |
| `get_project_execution` | Execution segments, project/epic/ticket metrics, coverage, and UTC completion buckets for `project_id` |
| `get_deletion_preview` | Aggregate permanent-deletion impact for `kind` (`projects`, `epics`, `tickets`) and `id`; returns counts, `requires_force`, and `confirmation_token` |
| `create_project`, `update_project`, `delete_project` | Manage projects |
| `create_epic`, `update_epic`, `delete_epic` | Manage epics; `completed: true` removes them from home; `archived: true` hides completed epics from ordinary listings; `archived: false` restores them |
| `create_ticket`, `update_ticket`, `delete_ticket` | Manage tickets and change status |
| `link_tickets`, `unlink_tickets` | Set/remove a dependency using `blocker_id` and `blocked_id` |

Updates are partial: omitted fields stay unchanged. IDs are positive integers. Dependency creation/removal is idempotent. `get_workspace` is intentionally a full snapshot suitable for small workspaces, rather than a paginated issue-tracker API.

`delete_project` and `delete_epic` reject nonempty
parents unless explicitly passed `force: true` and a current `confirmation_token`
from `get_deletion_preview`. Every `delete_*` accepts these optional fields in
addition to `id`. Force always requires a token; any supplied token is checked
atomically even without force. On changed impact, review a new preview and obtain
confirmation again—do not silently substitute a new token and retry. Previewing
does not grant authorization to delete. Prefer completion/archiving when retaining
work history is appropriate.

### Preferred agent workflow

Before starting work, use **`claim_next_ticket`** (usually scoped to a project) or **`claim_ticket`** for a chosen ticket, instead of separate reads and `update_ticket(status: "in_progress")`. Create new tasks as Todo, then claim them. `get_ready_tickets` is useful for planning but does not reserve anything. The server advertises this guidance in MCP instructions and tool descriptions; repository agents also receive it through `AGENTS.md`.

A ticket is ready only when it is **Todo**, its epic is **unfinished and unarchived**, and **every blocking ticket is Done**, including blockers in other projects. Completing/archiving a blocker's epic is not enough. Results are ordered by creation timestamp, then ID. Optional scope IDs must be positive and exist; when both are supplied, the epic must belong to that project.

Both claim operations return `{ "claimed": true, "ticket": { ... } }` on success. `claim_next_ticket` returns `{ "claimed": false, "ticket": null }` when no ready work exists in scope. A missing specific ticket is an error; an existing but no-longer-ready ticket is a conflict. Refresh and choose again rather than bypassing the failed claim with an ordinary update.

Claims check readiness and move to In progress in a single SQLite write transaction, including across HTTP/stdio processes sharing a database. Status history, column timers, and live updates start automatically. Completing/reopening blockers and returning candidates to Todo recomputes eligibility without queue bookkeeping; reopening a blocker does not move active work backward.

This is coordination, **not ownership enforcement**: no owner field, lease, automatic reassignment, priority, or separate queue UI. Ordinary updates and board drag-and-drop may start blocked tickets. Use `update_ticket` for edits and subsequent transitions; return abandoned work to Todo explicitly. Separate readiness reads and status updates are not concurrency-safe; use claim tools to start ready work.

Keep task specifications in descriptions. Prefer `add_work_log` for implementation progress, decisions, blockers, test results, and commit links; read prior context with `get_ticket_work_log`. When handing work to a reviewer, prefer `create_review_handoff` to separate description/status updates. Handoffs are durable context, not reviewer assignments or approval locks; ordinary status updates are also supported.

## REST API

All requests/responses are JSON, except the SSE endpoint. Errors use `{ "error": "message" }` with an appropriate HTTP status. No CORS access is enabled.

| Method | Endpoint | Body / filters |
| --- | --- | --- |
| GET | `/api/state` | Full workspace snapshot, including archived epics and their tickets/links so direct links and restoration remain possible |
| GET | `/api/tickets/ready` | Optional query filters `project_id`, `epic_id`; returns `{ "tickets": [...] }` (empty list when no ready work) |
| POST | `/api/tickets/claim-next` | JSON body with optional `project_id`, `epic_id` (or empty body); returns `{ "claimed": true, "ticket": {...} }` or `{ "claimed": false, "ticket": null }` |
| POST | `/api/tickets/{id}/claim` | Empty body or `{}`; same success shape; `404` if missing, `409` if no longer ready |
| GET | `/api/tickets/{id}/history` | `{ "ticket_id": 1, "history_complete": true, "events": [...] }`; events contain `id`, `ticket_id`, `from_status`, `to_status`, `changed_at`, `kind` (`created`, `baseline`, `transition`) |
| GET / POST | `/api/tickets/{id}/work-log` | GET: `{ "ticket_id": 1, "entries": [...] }`; POST: `{ "body": "Implemented feature; tests passed", "author": "Agent" }`, optional `author`; returns created entry (`201`) |
| POST | `/api/tickets/{id}/review-handoff` | `{ "summary": "What changed", "verification": "Checks/results", "references": "Commit/artifact links", "review_notes": "What to check", "author": "Agent" }`; only summary/verification required; returns entry and updated ticket (`201`) |
| GET | `/api/projects/{id}/execution` | Project, `generated_at`, aggregate `metrics`, unarchived epic/ticket rows, `epics_archived` count, and `daily_completions`/`weekly_completions`; aggregates include archives; durations are seconds, unknown start-dependent values are `null` |
| GET | `/api/{kind}/{id}/deletion-preview` | `kind`: `projects`, `epics`, or `tickets`; aggregate deletion impact and confirmation token; no mutation |
| GET / POST | `/api/projects` | Create: `{ "name": "Website" }` |
| GET / PATCH / DELETE | `/api/projects/{id}` | Update: `{ "name": "New name" }` |
| GET / POST | `/api/epics` | Create: `{ "project_id": 1, "title": "Launch" }`; optional `completed`, `archived`; GET defaults to unarchived epics, filters: `project_id`, `completed=true\|false`, `archived=true\|false`, `include_archived=true` |
| GET / PATCH / DELETE | `/api/epics/{id}` | Update any of `title`, `project_id`, `completed`, `archived`; direct GET still returns archived epics |
| GET / POST | `/api/tickets` | Create: `{ "epic_id": 1, "title": "Build it", "description": "…", "status": "todo" }`; GET filters: `epic_id`, `status`; archived-parent tickets are omitted unless `include_archived=true` |
| GET / PATCH / DELETE | `/api/tickets/{id}` | Update any of `title`, `description`, `epic_id`, `status` |
| GET / POST / DELETE | `/api/links` | POST/DELETE: `{ "blocker_id": 1, "blocked_id": 2 }` |
| GET | `/api/events` | SSE `change` events; fetch `/api/state` after each event |

Status values are `todo`, `in_progress`, `ready_for_review`, `done`. Titles/names are trimmed and limited to 200 characters; descriptions to 100,000 bytes. `description` defaults to empty and `status` to `todo`. Project/epic deletion returns `409` when nonempty unless explicitly force-confirmed as described below. Dependencies can cross epic/project boundaries.

### Deletion previews and force confirmation

`GET /api/{kind}/{id}/deletion-preview` returns:

```json
{
  "kind": "projects",
  "id": 42,
  "name": "Example project",
  "requires_force": true,
  "confirmation_token": "<opaque token>",
  "counts": {
    "epics": 2,
    "tickets": 5,
    "archived_epics": 1,
    "work_log_entries": 7,
    "status_events": 12,
    "dependency_links": 3,
    "external_dependency_links": 1
  }
}
```

Counts include completed and archived work. `epics` and `tickets` count
**descendants**, not the root being deleted. Work-log entries include review
handoffs; status events and links include those attached to the root ticket.
`archived_epics` counts archived epics in the scope, including an archived epic
root. `external_dependency_links` counts links with exactly one endpoint in the
scope; the survivor may belong to the same project. Dependency links are counted
once, even when both tickets are deleted.

DELETE requests accept an optional JSON body:

```json
{ "force": true, "confirmation_token": "<token from the reviewed preview>" }
```

- Without options, empty parents and tickets can be deleted;
  nonempty parents return `409`. Force defaults to `false`.
- Force requires a nonempty token (`400` otherwise). Supplied tokens must match the
  current impact (`409` if stale), including exact resource identities—not just
  aggregate counts. UI deletes always include a token, including empty targets.
- The server reserves the SQLite writer before validating and deleting, including
  across HTTP/stdio processes sharing a database. Children and parent are removed
  in one transaction; any failure rolls back the entire operation.
- Changes to affected resources, membership, logs, history or links can invalidate
  confirmation. Refetch and explicitly reconfirm; do not automatically retry a
  destructive request or reuse a newly fetched token without review.
- Success returns `{ "id": 42 }`; a missing/already-deleted target returns `404`.
  An interrupted response does not prove deletion failed—check current state.
- This is permanent deletion, not a trash/undo facility. External tickets survive;
  only incident links are removed. Deleted work no longer contributes to metrics.

### Ticket history, logs, and archives

Ticket responses (workspace snapshots, REST reads/mutations, and MCP) include read-only `status_since`: the timestamp of the latest known entry into the current `in_progress` or `ready_for_review` column, or `null` for todo/done/unknown entry times. Creation directly in a timed column is a known entry. This is derived from status history; neither `created_at` nor `updated_at` is substituted for a missing entry event.

Work-log entries contain `id`, `ticket_id`, `kind` (`note` or `review_handoff`), `author`, `body` (the handoff's summary for review entries), `verification`, `references`, `review_notes`, and server-generated `created_at`. Unused fields are empty strings. Tickets without log entries return an empty `entries` array. Order is ascending append ID, including timestamp ties and clock changes. IDs/timestamps/kind cannot be supplied on append; there are no update/delete-entry routes. Markdown content fields are trimmed and limited to **100,000 bytes combined**; author labels to **200 characters**. Log reads/appends work for completed/archived tickets. Handoffs can intentionally move from any column to review and do not enforce dependency readiness; an already-in-review handoff adds an entry without a status transition. Logs are fetched per ticket, not embedded in every workspace snapshot.

TinyTickets applies required database migrations on startup. Before updating, back up the database and stop all processes that use it. Use the same TinyTickets version for all HTTP/stdio processes sharing a database. After updating, restart those processes and refresh MCP tool discovery. Do not downgrade a binary against a newer database schema.

`GET /api/epics?archived=true` explicitly discovers archived epics; `?include_archived=true` returns both groups. An explicit `archived` filter takes precedence over `include_archived`. Complete workspace snapshots (`/api/state`, MCP `get_workspace`) always retain archived parents and children for consistent discovery. Invalid archive/reopen combinations return `400`, including on creation. Archives are a listing preference, not an access-control boundary or a read-only ticket state; intentional API/MCP ticket updates and direct detail pages remain available.

```sh
curl -X POST http://127.0.0.1:8080/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"Website"}'
curl -X POST http://127.0.0.1:8080/api/epics \
  -H 'Content-Type: application/json' -d '{"project_id":1,"title":"Launch"}'
curl -X POST http://127.0.0.1:8080/api/tickets \
  -H 'Content-Type: application/json' -d '{"epic_id":1,"title":"Build the homepage"}'
curl -X POST http://127.0.0.1:8080/api/tickets/1/claim
```

## Development

Use Node 22.13+ (or a supported newer version) and npm for frontend work. The
diagram/parser dependencies declare Node 22 engines. See [frontend architecture and
development](../web/README.md) for module ownership, tooling and invalidation behavior.

```sh
make build  # npm ci, typecheck, Vite build, then a single static Go binary
make test   # Go tests with race detector and go vet
make fmt-go       # format first-party Go source/tests with gofmt
make fmt-check-go # fail on unformatted Go source without modifying files
make lint-go      # gofmt check, go vet, and pinned Staticcheck
make check  # app/site checks + assets/binary + Go lint/tests + browser tests
npm --prefix web exec -- playwright install chromium
npm --prefix web run check  # lint, format, TypeScript, unit/component tests
npm --prefix web test       # Vitest unit/component suite
npm --prefix web run test:e2e # isolated browser smoke test against the built binary
```

For hot reload, run `go run .` in one terminal and `make dev` in another. Open `http://127.0.0.1:5173`; Vite proxies `/api` and `/mcp` to port 8080. Rebuild `web/dist` with `make web` before building or committing frontend changes. Do not rebuild the frontend concurrently with a Go build/test: embedding reads those files during compilation.

Go development uses **Go 1.26+**, as declared in `go.mod`. Run `make lint-go` and
`make test` for Go changes. `make check` includes both alongside frontend/browser
verification; `make test` remains Go-only and does not download a linter.

Staticcheck is pinned to **`honnef.co/go/tools v0.8.2`** in the Makefile and invoked
with `go run ...@version`, so no globally installed Staticcheck is required or used.
The first lint run needs network access to download the tool and its dependencies;
subsequent runs use the Go cache. This does not add tooling dependencies to the
application's `go.mod` or `go.sum`. Keep the pin compatible with the project's Go
version when upgrading it. The standard Staticcheck checks are enabled without a
custom rule suppression file.

The formatting commands include tests and untracked Go source, support paths with
spaces, and skip `node_modules`, `vendor`, `.git`, `dist` directories and files with
the standard `// Code generated ... DO NOT EDIT.` marker. Analysis/tests also
exclude dependency packages under `node_modules`; normal Go package discovery
excludes vendored packages. `make fmt-check-go` is read-only; use `make fmt-go` to
apply formatting.

Tests cover persistence, hierarchy validation, status transitions, dependency cycles, deletion rules, REST filtering, origin checks, SSE notifications, and real MCP client/server round trips. Execution tests cover legacy migrations, atomic/no-op/external writes, reopen/review durations, missing starts, UTC bucket boundaries, and project attribution. Archive tests cover schema upgrades/marker recovery, database constraints, REST/MCP round trips, preserved history/metrics, live listing removal/restoration, direct-page editing, search, assignment options, and mobile use. Browser tests use their own temporary database.

Ready-work tests cover cross-project blockers, completed/archived epics, ordering/scopes, stale selections, explicit empty results, concurrent claims through independent stores and processes, history/timer anchors, notifications, and REST/MCP validation.

Work-log tests cover database migrations/marker repair, persistence, append-only database constraints and ticket deletion, independent concurrent writers, input limits, handoff rollback atomicity, history/timer preservation, REST and HTTP/stdio MCP. Browser regressions cover chronological mixed entries, live remote appends/draft preservation, handoff forms/status, retries, Markdown safety, archives, ticket navigation, both themes and mobile layouts.

Deletion tests cover safe defaults, force/token validation, same-count scope
replacement, cross-process writer serialization, rollback on parent-delete failure,
archived descendants, surviving external tickets/readiness, HTTP and HTTP/stdio MCP.
Browser tests cover force gating, stale re-confirmation, one active focus trap,
draft cancellation, in-flight dismissal/duplicate guards, error recovery without
write retries, parent navigation, and mobile dark-mode modal bounds.

Dependency-map model tests cover deterministic non-overlapping fork/join layout, overhead routing and separate connection ports for long arrows, global readiness, external/archive expansion, chain focus versus siblings, hidden completed blockers, empty graphs, cycle recovery and iterative 4,000-ticket chains. They run with `npm test`; `make check` explicitly runs both unit and browser suites. Browser tests compare map readiness with the backend, verify arrow direction, live claims/status/link/epic/deletion changes, direct URLs/history, keyboard selection and ticket links, zoom/fit/scroll, safe titles, empty/archive states and both mobile themes.

Frontend tests also cover typed API errors/cancellation, hash routing, modal focus,
dirty-field editor updates, and live-data hooks. Playwright cases have independent
temporary databases/servers/contexts, including a real external stdio log-update
case. Controlled network checks verify that healthy initial ticket loading and note
submission avoid duplicate workspace reads while preserving necessary trailing reads.
