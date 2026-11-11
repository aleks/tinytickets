---
name: tinytickets
description: Track implementation work in TinyTickets. Use for task planning, atomic claims, progress notes, interrupted work, verification, and review handoffs.
---

# Track work in TinyTickets

## Select work

1. Read the repository's work-tracking policy.
2. Call `get_workspace`. Resolve the approved project and epic.
3. Inspect related tickets before creating new work.
4. Read the selected ticket's description and `get_ticket_work_log`.
5. Create new work as Todo. Use `claim_ticket` before implementation.
6. Use `claim_next_ticket` only when the user asks you to select work.
   Scope it to the approved project or epic.

Ready means Todo, an unfinished and unarchived epic, and all blockers Done.
`get_ready_tickets` does not reserve work.
If a claim fails, refresh. Do not force the status to In progress.
If no ready work exists, report that result.

## Record work

1. Keep acceptance requirements in the description.
2. Use `add_work_log` at meaningful checkpoints.
3. Record decisions, blockers, and verification results.
4. Use `link_tickets` when one result blocks another.
5. Keep local task lists consistent with TinyTickets.
   A local task list is not a replacement for shared tracking.

Do not add a note for every tool call. Do not add secrets to tickets or logs.
Author labels identify displayed text, not authenticated owners.

## Resume work

1. Restore the project and ticket from this session's confirmed context.
2. Re-read the ticket and work log after a new session or context compaction.
3. Check status and blockers. Do not assume any active ticket belongs to you.
4. Ask if another agent might still be working on the ticket.
5. Continue confirmed active work without a new claim.
   Claim tools start Todo work; they do not acquire an active-ticket ownership lock.

Do not return another session's ticket to Todo.
Claims have no owner field, lease, or automatic reassignment.

## Hand off or finish

1. Run the repository's required checks.
2. Record successful, failed, and not-run checks accurately.
3. If review is required, use `create_review_handoff`.
   Supply summary and verification. Add references and review notes when useful.
   This operation saves the handoff and moves the ticket to Ready for review together.
4. Otherwise, mark Done only when the agreed work and verification are complete.
5. Include ticket references in the final response.

Ordinary log entries do not change status or restart timers.
A repeated handoff in Ready for review does not restart its timer.
Do not close a ticket only because the session ends.

## Handle failures

Follow the repository's outage policy.
Report missing tools. Do not hide a failed claim with an ordinary status update.
Do not write directly to SQLite.
If the user permits work during an outage, keep a short summary and reconcile it
after recovery. Do not invent historical start times.
