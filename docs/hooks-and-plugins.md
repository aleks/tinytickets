# Hooks and plugins

## Status

TinyTickets supplies MCP tools and server instructions.
This repository does not supply a tracking-enforcement hook or client plugin.
This page specifies a possible integration. It is not an installation procedure.

Start with the [repository policy](templates/repository-policy.md).
Build custom checks only if the policy is not sufficient.

## Required checks

| Event or action | Integration behavior |
| --- | --- |
| Session start or resume | Restore the confirmed repository, project, and ticket context |
| Context compaction | Restore the same context and tracking rules |
| Successful claim | Save the returned ticket ID for the invoking session |
| Before implementation changes | Check the session's ticket and project; require a successful claim for new work |
| Handoff | Check that an honest verification summary and handoff exist |
| Completion | Check ticket status and recorded results; do not infer completion from session termination |

Allow read-only investigation before ticket selection.
Allow MCP setup and repair when no ticket connection exists yet.
Do not block the tools needed to fix the missing tracking state.

Store context by session and repository/worktree.
Do not use one global “current ticket” file.
Do not treat any In progress ticket as owned by the current session.
A remembered claim is coordination context, not authenticated ownership.

## Use supported client mechanisms

**OpenCode V2:** use a server plugin. Context hooks and session instruction entries
can restore guidance. Tool and permission hooks can check supported execution paths.
See the [plugin guide](https://opencode.ai/v2/docs/build/plugins) and
[server API](https://opencode.ai/v2/docs/build/plugins/server).

**Claude Code:** use `SessionStart` for restored context and `PreToolUse` for
supported pre-execution checks. Use `Stop` only for a bounded final check.
Prevent repeated stop checks from creating an endless loop.
See the [hook reference](https://code.claude.com/docs/en/hooks).

**Codex and Cursor:** check the installed client's official extension documentation.
Do not copy OpenCode plugin code or Claude Code hook JSON into another client.
The setup guides in this directory configure instructions, not enforcement.

## Cover alternative write paths

An edit-tool check does not cover shell writes.
Also consider scripts, delegated agents, code-execution tools, and external tools.
Do not classify arbitrary shell commands as safe with a simple text search.
Document any write path that the integration cannot check.

Hooks are not a substitute for filesystem, network, or database access controls.
TinyTickets has no per-project authorization.
Use separate databases when environments need separate access.

## Select failure behavior

- In stop mode, reject implementation changes when tracking cannot be verified.
- Keep diagnosis and repair available.
- Provide an explicit, user-approved outage exception.
- Record the exception and reconcile work when the connection returns.
- Bound retries and network timeouts. Do not hang the client indefinitely.
- Do not automatically claim work on every prompt.
- Do not automatically mark Done when a session stops or becomes idle.

## Test before distribution

Use an isolated database and temporary client settings.
Test missing tools, failed claims, blocked tickets, duplicate calls, and outages.
Test two concurrent sessions and separate worktrees.
Test shell writes and any delegated execution path.
Test resume, compaction, review, interrupted work, and user overrides.
Confirm that checks cannot change unrelated projects or falsely report verification.

Next: [Verify the setup](verification.md).
