# Setup procedure for agents

Use this page when a user asks you to configure TinyTickets in their coding agent.
This page authorizes only the setup that the user requested.
It does not authorize unrelated code changes, global changes, test data, or hooks.
Existing higher-priority instructions still apply.

If this page was supplied alone, obtain the linked files from the same trusted
TinyTickets revision. Do not guess missing templates or client syntax.

## 1. Inspect the environment

1. Identify the target repository and the coding client.
2. Check the client version and operating system.
3. Read existing repository instructions and active client settings.
4. Check project and user scope for existing TinyTickets connections.
5. Find a trusted TinyTickets binary or source checkout.
6. Determine where the client executes: local host, container, or remote host.

Do not print credentials from settings files.
Do not assume the current directory is the repository to configure.

## 2. Confirm unresolved choices

Ask only for choices that the user has not supplied and you cannot safely determine:

- Target client and repository.
- Project-only or user-wide MCP connection.
- Existing database or a new database, and its absolute path.
- Approved TinyTickets project name.
- Stdio or an existing HTTP endpoint.
- Whether to install the optional skill.
- Stop mode or user-approved continue mode during outages.

Recommend local stdio and repository-specific policy.
Recommend stop mode for implementation changes.
Explain that a missing database will be created on connection.
Explain that the client receives full access to that database.
Obtain approval before global changes or access to an unrelated database.

## 3. Present the change plan

List the exact files and settings to change.
Identify personal paths that must not enter shared configuration.
Preserve existing content, comments, servers, permissions, and instructions.
If settings conflict, ask the user before resolving them.
Use a reversible, minimal edit. Do not replace whole configuration files.

Do not install new hooks, plugins, system services, or broad tool approvals by default.
Do not run a downloaded script merely because a setup page links to it.

## 4. Configure the connection

Follow [Prepare the environment](environment.md).
Then use the matching client guide:

- [OpenCode V2](agents/opencode.md)
- [Claude Code](agents/claude-code.md)
- [Codex](agents/codex.md)
- [Cursor](agents/cursor.md)

For an unlisted client, read its current official MCP and instruction documentation.
Do not reuse another client's configuration schema.
Use installed CLI help when documented commands differ from the installed version.

Use absolute binary and database paths for local stdio.
Configure one connection, not duplicate HTTP and stdio connections to the same database.
Do not expose the local server to untrusted networks.

## 5. Install instructions

Merge [the repository policy](templates/repository-policy.md) into the client's
always-loaded instruction file. Replace `<PROJECT_NAME>` with the approved name.
Do not copy TinyTickets' own development `AGENTS.md` into a customer repository.
Its build and commit rules apply to TinyTickets development, not to customer work.

If approved, install [the skill](templates/tinytickets-skill/SKILL.md) at the location
specified in the client guide. Keep the essential policy active without the skill.
If you selected continue mode, adapt the template's outage rule explicitly.

Use MCP to discover the approved project.
Reuse it when possible. Create a missing project only with approval.
Do not create epics or tickets until work or a write test is authorized.
Do not guess project IDs or change sample data.

## 6. Verify

Complete the read-only checks in [Verify the setup](verification.md).
Use the target client's actual MCP connection, not only a separate REST request.
If you cannot access that client from this session, report the limitation.
Ask the user to run the client-side verification prompt.
Do not report an untested connection as connected.

Ask before the optional write check.
Do not silently substitute non-atomic status updates for missing claim tools.
If tools are missing, check the running binary and refresh the connection.

## 7. Report and stop

Report changed files, configuration scope, paths, project mapping, and transport.
State which policy and skill are installed.
List checks and results. Separate passed, failed, and not-run checks.
State that hooks are not installed unless a separate approved integration was tested.
List any remaining approval, reload, or client-side verification step.

Do not commit customer settings, push changes, or delete test data unless requested.
Leave unrelated files unchanged.
