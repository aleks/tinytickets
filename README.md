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
- Tickets have a title, plain-text description, and one of four statuses: **Todo**, **In progress**, **Ready for review**, **Done**.
- Drag tickets between columns, or change status in the ticket editor (also works with keyboard/touch).
- Links express **blocks / blocked by**. The two labels describe the same directed link. Self-links and dependency cycles are rejected. Unfinished blockers are flagged on cards; they do not prevent moving a ticket.
- The overview shows active epics and their tickets. Completing an epic hides it **and its tickets** from the overview without deleting anything. Completed epics remain in the sidebar, all-epics page, and project pages, and can be reopened.
- Projects and epics can only be deleted when empty. Ticket deletion removes its links.
- Light/dark mode initially follows your system preference; the toggle saves an explicit choice locally.
- The color picker beside the theme toggle offers five muted accents: Sage (default), Slate, Lavender, Clay, and Sand. The choice applies in both modes and is saved locally alongside your theme preference.
- Server-sent events refresh the board after REST/MCP changes. A SQLite watcher also detects writes from separate stdio processes (within about one second). A 15-second polling fallback handles buffered streams; reconnecting or waking the tab triggers a fresh snapshot.

No sample projects or tickets are added to your database.

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

Tests cover persistence, hierarchy validation, status transitions, dependency cycles, deletion rules, REST filtering, origin checks, SSE notifications, and a real MCP client/server round trip over HTTP. The browser smoke test checks creation, dependencies, drag/drop, live updates, concurrent edits, themes, epic completion/reopening, and mobile navigation with a temporary database.
