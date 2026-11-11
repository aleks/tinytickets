# Frontend development

TinyTickets uses React, TypeScript, Vite and plain CSS. Go embeds the committed
`dist/` directory; Node and the development tools are not needed to run the binary.
There is no client state framework, router package, generated API client, or hosted
CI configuration.

## Setup and commands

Use Node **22.13+** (or a supported newer version) and npm. The new development
tools also support Node 20.19, but existing Mermaid/parser dependencies declare
Node 22 engines, so Node 22+ is recommended for clean installs.

```sh
npm ci
npm exec -- playwright install chromium
npm run dev              # Vite; proxies /api and /mcp to localhost:8080
npm run lint             # ESLint: TypeScript, Hooks and accessibility
npm run lint:fix
npm run format
npm run format:check
npm run typecheck        # application/tests plus tooling and E2E configuration
npm test                 # Vitest unit/component tests, once
npm run test:watch
npm run check            # lint, format, types, unit/component tests
npm run build            # typecheck and rebuild embedded assets
npm run test:e2e          # Playwright against the already-built Go binary
npm run test:e2e -- live-sync --repeat-each=3
```

From the repository root, **`make check`** runs the full sequence: frontend checks,
frontend build, static Go build, Go race tests/vet, and browser tests. **`make test`**
remains Go-only and excludes third-party Go files inside installed `node_modules`.
Never rebuild frontend assets concurrently with Go compilation: the compiler reads
those embedded files. Commit rebuilt `dist/`, but not installed dependencies,
coverage, traces, screenshots, local databases, or the binary.

ESLint 9 is kept compatible with the current accessibility plugin's peer range.
The scoped `minimatch` override patches a development-tool glob advisory; reassess
it when upstream TypeScript ESLint updates its dependency. No production dependency
versions were changed by this reorganization.

## Module ownership

```text
src/
  main.tsx                 bootstrap and global CSS import only
  app/                     App composition, shell, page headings, hash routing
  shared/
    types.ts               canonical API/domain types and distinct report DTOs
    api.ts                 typed endpoint functions and transport errors
    status.ts              status labels, icons and guards
    ui/                    shared modal/search and control styles
  features/
    workspace/             indexed selectors, live snapshot hook, read queue
    board/                 board and board ticket cards
    projects/              project/epic listings and fields
    editor/                dialog model, dirty-field submission and editor
    tickets/               ticket page, fields, log, column clock and log hook
    markdown/              safe Markdown and lazy Mermaid rendering
    dependencies/          dependency map, pure graph model and local CSS
    progress/              execution view and report hook
  styles/                  tokens, base/layout and ordered responsive overrides
tests/
  setup.ts                 isolated DOM/mock/timer/storage cleanup
  e2e/                     independent Playwright specs, server and API fixtures
```

Keep unit/component tests beside the feature (`*.test.ts` / `*.test.tsx`). Shared
types are the API contract; use projections such as `Pick<Ticket, ...>` rather than
redeclaring a status as an arbitrary string. Execution reports intentionally use
their own DTOs. The single JSON assertion lives at the transport boundary—not in
UI components. Requests preserve omitted/false/null fields and support cancellation;
**writes are never automatically retried**, since an interrupted response may have
already committed.

`App` owns composition, selection/dialog state and user operations. `AppShell` owns
navigation and page framing. Hash parsing/link generation are pure and tested;
existing deep URLs and browser history are preserved. Modal focus and dismissal are
shared, but field ownership remains with features. Editors submit only changed
fields so refreshes cannot undo another agent's unrelated edits.

## Live data and invalidation

`useWorkspace` owns the SSE connection, initial snapshot, 15-second fallback,
reconnect synchronization and focus/visibility catch-up. The server sends an initial
`change` event; this bootstraps loading without an unconditional duplicate read.
A 100 ms fallback handles unavailable or buffered SSE.

`refreshQueue` coalesces read invalidations over 20 ms and serializes reads. An event
received during an in-flight request always schedules a trailing read: that write
may not be in the earlier snapshot. Cleanup aborts reads and releases subscriptions,
timers and waiting callers. Read errors remain visible and can recover on explicit
refresh or subsequent events; the queue does not retry by itself.

`useTicketWorkLog` and `useProjectExecution` own cancellable feature reads and retry
state. A successful workspace read increments an explicit revision, **even if
ticket fields did not change**. Work-log appends intentionally leave
`ticket.updated_at` unchanged, so that timestamp is not a valid log invalidation key.
Draft form state stays in the rendering component; log entries merge by immutable
ID so late reads cannot erase an accepted append. Changing ticket/project keys
cannot display an old resource's response.

Under the controlled healthy-SSE browser scenario, initial ticket loading and one
note submission each require **one** workspace GET rather than the audited two.
This is not a blanket one-request promise: delayed connections, polling and writes
during reads legitimately require additional snapshots. Prefer safe invalidation
over suppressing real changes. Keep the shared one-second card clock separate from
network activity; heavy views and Mermaid remain lazy-loaded.

## Styling and tests

`src/style.css` is an explicit import-order manifest. Theme/base/layout, shared
controls and feature styles retain the original cascade, including responsive
overrides at the end. Preserve that order when moving rules; the dependency map's
styles remain with its lazy feature. Appearance preferences stay in localStorage,
with first-paint initialization in `index.html`. Do not add a CSS framework or
redesign visuals as part of maintenance work.

Vitest runs only colocated source tests. Setup cleans the DOM, fake timers, mocks,
environment stubs and storage. Routing, indexed selectors, dirty editors, modal
focus, API failures/aborts, shared clocks, graph layout and resource lifecycle are
tested without a real workspace database.

Playwright Test provides a **new temporary database/server and browser context per
test**, dynamic ports, bounded process cleanup, runtime-error checks across pages,
and failure traces/screenshots. Tests never connect to the user's server/database
or depend on an earlier spec's IDs, theme or clock. The stdio live-sync case starts
a separate MCP process against that test's own database. Keep all tests individually
runnable, and seed API entities through the shared helpers instead of fixed IDs.

Vendor chunk tuning, runtime dependency upgrades, broader compiler strictness,
virtualization and adding a CI provider remain separate decisions, not prerequisites
for this structure.
