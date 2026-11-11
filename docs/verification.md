# Verify the setup

Verify the connection and the policy separately.
A saved configuration file is not proof of a working connection.

## 1. Check without changing data

Ask the agent:

```text
Check the TinyTickets connection without changing data.
Discover its tools and call get_workspace.
Identify this repository's approved project.
List the work-tracking instructions that apply here.
Do not create, claim, edit, or delete a ticket yet.
```

Confirm these results:

- The call succeeds from the intended client.
- The database contains the expected projects.
- The agent selects the approved project, or asks if the mapping is ambiguous.
- The agent can explain the claim, log, review, and outage rules.

Check that these tools are available to the agent:

```text
get_workspace
create_epic
create_ticket
claim_ticket
claim_next_ticket
get_ready_tickets
get_ticket_work_log
add_work_log
create_review_handoff
update_ticket
```

`create_project` is also needed if the user approves a new project.
`update_epic` is needed to restore or reopen an epic.
`link_tickets` is needed for dependencies.
Client-displayed tool names can include a server prefix.
Inspect schemas instead of guessing the full tool name or arguments.

## 2. Optional write check

Ask for approval before changing real data.
Prefer a separate temporary database and test client settings.
If you use the real workspace, agree on the exact test project and epic first.
Do not use unrelated customer tickets as test data.

1. Create a test ticket as Todo under an unfinished, unarchived test epic.
2. Call `claim_ticket` for that ticket.
3. Confirm `claimed: true`, In progress status, and a known `status_since`.
4. Append a note with `add_work_log`.
5. Read it with `get_ticket_work_log`.
6. Create a review handoff with accurate verification text.
7. Confirm Ready for review status and the saved handoff.
8. If the test is complete, record its result and mark the test ticket Done.

Label test data clearly. Do not claim that the test performed product work.
Do not delete test records without approval.

## 3. Check a fresh session

Start a fresh session in the target repository.
Ask the agent to explain the tracking policy without an extra reminder.
If a skill was installed, load it explicitly and inspect its instructions.
This checks instruction discovery. It does not prove future model compliance.

If hooks were installed separately, test them in an isolated environment.
Confirm that an untracked edit is blocked and a valid tracked edit is allowed.
An instruction-only setup is not an enforced setup.

## Troubleshoot

| Symptom | Check |
| --- | --- |
| Server cannot start | Binary path, execution permission, client environment, and database directory access |
| HTTP connection fails | Running server, port, `/mcp` route, and network location |
| Board and agent show different data | Exact database path used by each process |
| New tools are missing | Running binary version, old stdio processes, client tool cache, and tool permissions |
| Policy is ignored | Active instruction files, overrides, rule mode, and conflicting instructions |
| Skill is absent | Client-specific directory, `SKILL.md` name, frontmatter, and skill permissions |
| Ticket cannot be claimed | Todo status, unfinished/unarchived epic, and all blocking tickets Done |

After a TinyTickets update, replace old server/stdio processes with the new binary.
Refresh the client's MCP connection and tool list.
Do not downgrade a binary against a newer database schema.
Do not edit SQLite directly to repair agent setup.

## Completion report

Record the client and version, configuration scope, changed files, transport,
binary and database locations, confirmed project, installed policy, and optional skill.
List successful checks, failed checks, and checks not run.
State whether enforcement is installed. List any remaining user actions.
Do not include secrets in the report.
