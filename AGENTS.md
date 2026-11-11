# TinyTickets agent workflow

## Progress tracking

When the TinyTickets MCP server is available, use it to track **all work on this project**, including implementation, bugs, tests, documentation, and configuration changes.

- Start by calling `get_workspace`. Find the **TinyTickets** project and reuse relevant epics/tickets; create the project only if it does not exist. Do not modify unrelated projects or sample data.
- Before making changes, create or update tickets under a suitable epic in that project. Every epic belongs to the project, and every ticket belongs to an epic. Do not hardcode database IDs; discover them through MCP.
- Before starting new work, use `claim_ticket(ticket_id)` for a chosen ticket or `claim_next_ticket(project_id?, epic_id?)` to select one atomically. Use `get_ready_tickets` for planning only, not as a reservation; do not claim through separate reads and `update_ticket(status: "in_progress")`. Create new work as Todo, then claim it. Ready means Todo, an unfinished/unarchived epic, and every blocker Done (including cross-project blockers). Reopen the epic before claiming follow-up work.
- If a specific claim fails, refresh and choose again; `claimed: false, ticket: null` means no ready work in scope. Claiming moves to In progress and starts history/timing, but adds no owner lock, lease, or automatic reassignment. Return abandoned work to Todo explicitly. Existing updates/drag-and-drop remain supported; use `update_ticket` for edits and subsequent transitions. If connected to an older server without claim tools, fall back to checking eligibility and updating status, noting that this is not concurrency-safe.
- Keep descriptions focused on the task specification and scope. Use `add_work_log(ticket_id, body, author?)` for progress, decisions, blockers, test results, and commit references rather than rewriting descriptions. Read previous context with `get_ticket_work_log`; notes and review handoffs are shown together oldest-first on the full ticket page. Entries are append-only; append a correction instead of editing/removing earlier notes. Author labels are informational, not authenticated ownership.
- When handing work to a reviewer, use `create_review_handoff(ticket_id, summary, verification, references?, review_notes?, author?)`. It atomically saves the handoff and moves the ticket to `ready_for_review`; include what changed, checks/results (including failures/not-run checks), commit/artifact references, and what to review. A further handoff while already in review does not restart its timer. Ordinary notes do not change status or timing. If connected to an older server without log tools, retain progress notes in the description until upgraded.
- Represent dependencies with `link_tickets` when useful.
- Use `ready_for_review` when waiting for review and `done` when work is finished and verified. Include relevant commit hashes and test results in completion notes. Never mark unfinished or failing work as done.
- Complete an epic only when its scope is finished; reopen it when adding follow-up work. Keep the tracker updated as work progresses, not just in the final response.
- If MCP is unavailable, mention that limitation and continue with a brief progress summary in the conversation. Reconcile the tracker when MCP becomes available; do not silently substitute direct database edits for MCP tracking.

## Development and commits

- Use conventional commits and commit all relevant source, tests, documentation, and rebuilt `web/dist` assets. Do not commit local databases, installed dependencies, or binaries.
- Rebuild the frontend with `npm --prefix web run build` after UI changes; Go embeds `web/dist` into the binary. Do not rebuild frontend assets concurrently with Go compilation/tests.
- Verify changes with `make test`. For UI work, also build the binary (`CGO_ENABLED=0 go build -trimpath -o tinytickets .`) and run `npm --prefix web run test:e2e`. The browser tests use their own temporary database, not the user's workspace.
- Frontend work must also pass `npm --prefix web run check` (lint, formatting, application/tooling typechecks, and unit/component tests). `make check` runs that plus the sequential frontend/binary builds, Go checks and isolated Playwright suite. `make test` remains Go-only. Follow the module/style ownership and test-fixture guidance in `web/README.md`; use `npm --prefix web run format` rather than hand-compressing JSX. Do not format generated `web/dist` assets.
- Preserve the compact interface, keyboard accessibility, responsive layout, and support for both light and dark modes. Store browser appearance preferences in localStorage, not the application database.
