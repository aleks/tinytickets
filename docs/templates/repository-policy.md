## TinyTickets work tracking

Use TinyTickets to track code, test, documentation, and configuration changes.
Use one ticket per meaningful result. Ordinary questions do not need tickets.

Project name: `<PROJECT_NAME>`.
Replace this placeholder with the user-approved project name before use.

- Call `get_workspace` to find the project. Confirm ambiguous matches with the user.
  Create a missing project only with approval. Do not change unrelated projects.
- Before implementation, select a suitable epic and ticket.
  Create new tickets as Todo. Unarchive and reopen an epic before follow-up work.
- Use `claim_ticket(ticket_id)` to start a chosen Todo ticket.
  Use `claim_next_ticket(project_id)` only when asked to select the next work.
  `get_ready_tickets` is for planning, not reservation.
- If a claim fails, refresh and choose again. Do not bypass it with a status update.
  A no-work result is not permission to select work from another project.
- Read the description and `get_ticket_work_log` before you continue existing work.
  Confirm the session's ticket before you resume an In progress ticket.
  An In progress status is not proof of ownership.
- Keep the description as the task specification.
  Use `add_work_log` for progress, decisions, blockers, checks, and commit references.
  Append corrections. Do not replace earlier log entries.
- Use `link_tickets` for dependencies. A blocking ticket must be Done before new
  dependent work can be claimed, including dependencies in other projects.
- Use `create_review_handoff` when waiting for review.
  Include the summary, verification results, references, and review notes.
  Report failed and not-run checks. Do not claim that unrun tests passed.
- Mark Done only after the agreed work and verification are complete.
  Keep unfinished or failing work open. Complete an epic only when its scope is complete.
- If work is abandoned, confirm that execution has stopped before returning it to Todo.
  Claims have no owner lock, lease, or automatic reassignment.
- If TinyTickets is unavailable, report the failure and stop implementation changes.
  Allow read-only diagnosis and setup repair. Ask for approval to continue without tracking.
  Reconcile approved untracked work after recovery. Never edit the database directly.
- If required tools are missing, report the missing names and repair the connection.
  Do not silently replace atomic claiming with separate read and update calls.

If a TinyTickets skill is installed, load it for detailed workflow instructions.
The rules above apply even if the skill does not load.
