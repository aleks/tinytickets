# TinyTickets

A small, local-first ticket board. One Go binary serves an embedded React frontend, a REST API, and an MCP server. SQLite is the only datastore; no external services or CGO are needed.

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
- Tickets have a title, a description stored as text, and one of four statuses: **Todo**, **In progress**, **Ready for review**, **Done**.
- Click a ticket's title in its editor header to open its full page (`/#ticket/{id}`). Descriptions render as Markdown with tables, task lists, fenced code blocks, and fenced `mermaid` diagrams. Raw HTML and active diagram content are not allowed; invalid diagrams show their source instead. Mermaid loads locally on demand, with no external rendering service. Diagrams follow your theme and accent.
- Full ticket pages show project/epic links, status, dependencies, and timestamps. Use **Edit ticket** to change titles, descriptions, or dependencies; status and epic can also be changed directly in the details sidebar. Full pages support direct links, browser navigation, live updates, and completed epics.
- Drag tickets between columns, or change status in the ticket editor (also works with keyboard/touch).
- Links express **blocks / blocked by**. The two labels describe the same directed link. Self-links and dependency cycles are rejected. Unfinished blockers are flagged on cards; they do not prevent moving a ticket.
- The overview shows active epics and their tickets. Completing an epic hides it **and its tickets** from the overview without deleting anything. Completed epics remain in the sidebar, all-epics page, and project pages, and can be reopened.
- Projects and epics can only be deleted when empty. Ticket deletion removes its links.
- Light/dark mode initially follows your system preference; the toggle saves an explicit choice locally.
- The color picker beside the theme toggle offers five muted accents: Sage (default), Slate, Lavender, Clay, and Sand. In dark mode, backgrounds, borders, and text neutrals also follow the selected palette. The choice applies in both modes and is saved locally alongside your theme preference.
- Server-sent events refresh the board after REST/MCP changes. A SQLite watcher also detects writes from separate stdio processes (within about one second). A 15-second polling fallback handles buffered streams; reconnecting or waking the tab triggers a fresh snapshot.

No sample projects or tickets are added to your database.

## Execution insights

Open a project and choose **Progress** next to **Board**, or link directly to `/#project/{id}/progress`. This is a record of actual execution, not a schedule: there are no start/due-date inputs, estimates, or extra agent bookkeeping.

- Expand/collapse epics to see their tickets on a status-colored timeline. In-progress, review, returned-to-todo, and done intervals are distinct, including repeated reviews and reopenings. Ongoing intervals extend to now. Epic spans derive from observed ticket intervals, not when the epic was manually marked completed.
- Choose all recorded history or a recent hour/day/week/month window. Range selection affects the timeline only; summary metrics cover all current project tickets. Timeline timestamps use local time, with seconds/milliseconds for short agent runs. Completed epics can be hidden from the timeline and untimed lists without changing the project totals.
- New todo tickets appear under **Not started**. Legacy tickets without observed execution appear under **Timing unavailable**, not at fabricated dates. Partial observed timelines are explicitly labeled.
- Metrics show completed/total tickets, active tickets (in progress or review), unfinished blocked tickets (including cross-project blockers), median completion time, summed observed in-progress/review time, and the oldest active ticket with a known start. Completion is ticket-count based, not a measure of effort. Explicit epic completion flags are independent of ticket completion counts.

### History and metric definitions

The first launch of this version atomically upgrades the SQLite database to schema version 2. Existing tickets receive a **baseline** of their current status at migration time; their earlier history is unavailable. Neither `created_at` nor `updated_at` is used to guess a historical start or completion. Subsequent observed intervals remain useful, but baseline tickets never enter start-dependent completion/age samples.

SQLite triggers record each new ticket's initial status and every actual status change in the same transaction as the write. REST, MCP, UI, and even already-running older processes using the database are covered. No-op status updates and title/description edits do not add events. Tickets created directly in review/done have no known in-progress start. History is read-only through the API/MCP.

- **Median completion time:** first recorded in-progress timestamp → latest recorded done timestamp for *currently done* tickets with full history and a known start. It includes pauses, repeated reviews, and closed intervals before reopening. Reopened unfinished tickets leave the sample until completed again. Sample counts are shown; unavailable values stay `null`/`—`, not zero.
- **Observed work/review:** sum of recorded time in `in_progress` / `ready_for_review`, including partial intervals observed after a legacy baseline. Parallel tickets overlap, so this is neither agent effort nor project wall-clock duration.
- **Oldest active ticket:** lifecycle age from first known in-progress timestamp to now, among currently in-progress/review tickets with full history. Closed/reopened gaps are included; unknown starts are excluded and coverage is shown.
- **Recorded completions:** each ticket counts once at its **first observed** creation/transition into done, even if later reopened. A baseline in done does not count. Daily buckets cover 28 UTC days; weekly buckets cover 12 UTC weeks starting Monday, including the current day/week. Zeros mean no *recorded* completions, not proof that no older work occurred. Counts can differ from the current done total.
- Reports include all tickets/epics currently in the project, including completed epics. Moving a ticket/epic carries its execution history into the new project; this is current-membership reporting, not historical project attribution. Deleting a ticket deletes its history and removes it from reports; this is not a permanent audit log.

Reports use a consistent database snapshot and refresh through the same live-update/polling mechanism as the board. Ordinary status changes continue to be the only action agents need to take.

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
| `get_workspace` | All projects, epics, tickets, and links, including completed work |
| `get_ticket_history` | Ordered creation/baseline/status events for `ticket_id`, with a `history_complete` flag |
| `get_project_execution` | Execution segments, project/epic/ticket metrics, coverage, and UTC completion buckets for `project_id` |
| `create_project`, `update_project`, `delete_project` | Manage projects |
| `create_epic`, `update_epic`, `delete_epic` | Manage epics; set `completed: true` to archive from overview |
| `create_ticket`, `update_ticket`, `delete_ticket` | Manage tickets and change status |
| `link_tickets`, `unlink_tickets` | Set/remove a dependency using `blocker_id` and `blocked_id` |

Updates are partial: omitted fields stay unchanged. IDs are positive integers. Dependency creation/removal is idempotent. `get_workspace` is intentionally a full snapshot suitable for small workspaces, rather than a paginated issue-tracker API.

## REST API

All requests/responses are JSON, except the SSE endpoint. Errors use `{ "error": "message" }` with an appropriate HTTP status. No CORS access is enabled.

| Method | Endpoint | Body / filters |
| --- | --- | --- |
| GET | `/api/state` | Full workspace snapshot |
| GET | `/api/tickets/{id}/history` | `{ "ticket_id": 1, "history_complete": true, "events": [...] }`; events contain `id`, `ticket_id`, `from_status`, `to_status`, `changed_at`, `kind` (`created`, `baseline`, `transition`) |
| GET | `/api/projects/{id}/execution` | Project, `generated_at`, aggregate `metrics`, epic/ticket execution details, and `daily_completions`/`weekly_completions`; durations are seconds, unknown start-dependent values are `null` |
| GET / POST | `/api/projects` | Create: `{ "name": "Website" }` |
| GET / PATCH / DELETE | `/api/projects/{id}` | Update: `{ "name": "New name" }` |
| GET / POST | `/api/epics` | Create: `{ "project_id": 1, "title": "Launch" }`; GET filters: `project_id`, `completed=true\|false` |
| GET / PATCH / DELETE | `/api/epics/{id}` | Update any of `title`, `project_id`, `completed` |
| GET / POST | `/api/tickets` | Create: `{ "epic_id": 1, "title": "Build it", "description": "…", "status": "todo" }`; GET filters: `epic_id`, `status` |
| GET / PATCH / DELETE | `/api/tickets/{id}` | Update any of `title`, `description`, `epic_id`, `status` |
| GET / POST / DELETE | `/api/links` | POST/DELETE: `{ "blocker_id": 1, "blocked_id": 2 }` |
| GET | `/api/events` | SSE `change` events; fetch `/api/state` after each event |

Status values are `todo`, `in_progress`, `ready_for_review`, `done`. Titles/names are trimmed and limited to 200 characters; descriptions to 100,000 bytes. `description` defaults to empty and `status` to `todo`. Project/epic deletion returns `409` when nonempty. Dependencies can cross epic/project boundaries.

```sh
curl -X POST http://127.0.0.1:8080/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"Website"}'
curl -X POST http://127.0.0.1:8080/api/epics \
  -H 'Content-Type: application/json' -d '{"project_id":1,"title":"Launch"}'
curl -X POST http://127.0.0.1:8080/api/tickets \
  -H 'Content-Type: application/json' -d '{"epic_id":1,"title":"Build the homepage"}'
curl -X PATCH http://127.0.0.1:8080/api/tickets/1 \
  -H 'Content-Type: application/json' -d '{"status":"in_progress"}'
```

## Development

Requires Node 20.19+ (or 22.12+) and npm for frontend work.

```sh
make build  # npm ci, typecheck, Vite build, then a single static Go binary
make test   # Go tests with race detector and go vet
npm --prefix web exec -- playwright install chromium
npm --prefix web run test:e2e # isolated browser smoke test against the built binary
```

For hot reload, run `go run .` in one terminal and `make dev` in another. Open `http://127.0.0.1:5173`; Vite proxies `/api` and `/mcp` to port 8080. Rebuild `web/dist` with `make web` before building or committing frontend changes. Do not rebuild the frontend concurrently with a Go build/test: embedding reads those files during compilation.

Tests cover persistence, hierarchy validation, status transitions, dependency cycles, deletion rules, REST filtering, origin checks, SSE notifications, and real MCP client/server round trips. Execution tests cover legacy migrations, atomic/no-op/external writes, reopen/review durations, missing starts, UTC bucket boundaries, and project attribution. The browser suite checks execution metrics/timelines and existing ticket/board workflows, themes, and mobile navigation with a temporary database.
