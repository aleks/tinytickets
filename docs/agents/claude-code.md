# Set up Claude Code

This guide is for the local Claude Code client, not Claude Desktop connector setup.
First complete [Prepare the environment](../environment.md).
Run setup commands from the target repository.

## 1. Add the MCP server

For a private connection in this project, run:

```sh
claude mcp add --transport stdio --scope local tinytickets -- /absolute/path/to/tinytickets --mcp-stdio --db /absolute/path/to/tickets.db
claude mcp get tinytickets
claude mcp list
```

Select the scope deliberately:

| Scope | Use |
| --- | --- |
| `local` | Private settings for this project; default recommendation |
| `project` | Shared `.mcp.json` in the repository |
| `user` | Personal settings for all projects |

Use `--scope project` only if the paths work for the intended users.
Review and approve a project server when Claude Code requests approval.
Do not add blanket approval settings.

For HTTP, use this command instead of the stdio registration:

```sh
claude mcp add --transport http --scope local tinytickets http://127.0.0.1:8080/mcp
```

## 2. Add the policy

Merge the [policy template](../templates/repository-policy.md) into `CLAUDE.md`.
Replace `<PROJECT_NAME>` and preserve existing instructions.

If the policy is already in root `AGENTS.md`, add this import to root `CLAUDE.md`
instead of copying the same rules:

```text
@AGENTS.md
```

Recent Claude Code versions can load `AGENTS.md` directly when no project
`CLAUDE.md` or `CLAUDE.local.md` takes its place. This is version- and setting-dependent.
The explicit import supports repositories that already use `CLAUDE.md`.
Check which files actually load.

## 3. Add the optional skill

Copy the [skill template](../templates/tinytickets-skill/SKILL.md) to
`.claude/skills/tinytickets/SKILL.md`.
For personal use in all projects, use `~/.claude/skills/tinytickets/SKILL.md` instead.
Use `/tinytickets` to load it explicitly.

## 4. Verify

Open `/mcp` in Claude Code. Confirm that TinyTickets connects and exposes tools.
Use `/context all` to inspect loaded instruction files in versions that support it.
If a new skill directory is not discovered, use `/reload-skills` where supported,
or start a new session.
Complete [Verify the setup](../verification.md).

## Optional enforcement

Claude Code provides `SessionStart`, `PreToolUse`, and `Stop` hooks.
Hooks can add reminders or block supported actions.
They require a separate TinyTickets-aware script or integration.
Do not install a hook that marks tickets Done at every `Stop` event.
Read [Hooks and plugins](../hooks-and-plugins.md).

## Official references

- [MCP](https://code.claude.com/docs/en/mcp)
- [Project instructions](https://code.claude.com/docs/en/memory)
- [Skills](https://code.claude.com/docs/en/skills)
- [Hooks](https://code.claude.com/docs/en/hooks-guide)

Configuration examples were checked against these references on 2026-11-11.
They were not executed in every customer environment.
