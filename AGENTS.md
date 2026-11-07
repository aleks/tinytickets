# TinyTickets agent workflow

## Progress tracking

When the TinyTickets MCP server is available, use it to track **all work on this project**, including implementation, bugs, tests, documentation, and configuration changes.

- Start by calling `get_workspace`. Find the **TinyTickets** project and reuse relevant epics/tickets; create the project only if it does not exist. Do not modify unrelated projects or sample data.
- Before making changes, create or update tickets under a suitable epic in that project. Every epic belongs to the project, and every ticket belongs to an epic. Do not hardcode database IDs; discover them through MCP.
- Set tickets to `in_progress` when starting work. Keep descriptions current with scope, decisions, blockers, and verification results. Represent dependencies with `link_tickets` when useful.
- Use `ready_for_review` when waiting for review and `done` when work is finished and verified. Include relevant commit hashes and test results in completion notes. Never mark unfinished or failing work as done.
- Complete an epic only when its scope is finished; reopen it when adding follow-up work. Keep the tracker updated as work progresses, not just in the final response.
- If MCP is unavailable, mention that limitation and continue with a brief progress summary in the conversation. Reconcile the tracker when MCP becomes available; do not silently substitute direct database edits for MCP tracking.

## Development and commits

- Use conventional commits and commit all relevant source, tests, documentation, and rebuilt `web/dist` assets. Do not commit local databases, installed dependencies, or binaries.
- Rebuild the frontend with `npm --prefix web run build` after UI changes; Go embeds `web/dist` into the binary. Do not rebuild frontend assets concurrently with Go compilation/tests.
- Verify changes with `make test`. For UI work, also build the binary (`CGO_ENABLED=0 go build -trimpath -o tinytickets .`) and run `npm --prefix web run test:e2e`. The browser tests use their own temporary database, not the user's workspace.
- Preserve the compact interface, keyboard accessibility, responsive layout, and support for both light and dark modes. Store browser appearance preferences in localStorage, not the application database.
