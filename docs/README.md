# Documentation

Use TinyTickets to track work done by coding agents.
Connect the agent through Model Context Protocol (MCP).
Then give the agent a work-tracking policy.

## Start here

1. Read [Choose an approach](approaches.md).
2. Follow [Prepare the environment](environment.md).
3. Select your agent from the table.
4. Complete [Verify the setup](verification.md).

| Agent | Setup guide |
| --- | --- |
| OpenCode V2 | [OpenCode](agents/opencode.md) |
| Claude Code, local client | [Claude Code](agents/claude-code.md) |
| Codex CLI or IDE extension | [Codex](agents/codex.md) |
| Cursor, local agent | [Cursor](agents/cursor.md) |

These guides describe local clients. A cloud agent cannot use your computer's
loopback address or local binary. Read the environment guide before remote setup.

## Let an agent do the setup

Give the agent [Setup procedure for agents](setup-for-agents.md).
For example:

```text
Read docs/setup-for-agents.md in the TinyTickets repository.
Use that procedure to set up TinyTickets for this repository.
Inspect my environment first. Ask before you change global settings.
Do not install hooks or change unrelated settings.
```

If you give the agent a web URL, use a trusted repository revision.
Give it access to the linked guides and templates, not only the setup page.

## Reference files

- [Repository policy template](templates/repository-policy.md)
- [Optional skill template](templates/tinytickets-skill/SKILL.md)
- [Hooks and plugins](hooks-and-plugins.md)
- [Application, API, and development reference](reference.md)

## Writing style

These pages use short sentences, active voice, and direct procedure steps.
The style follows ASD-STE100 Simplified Technical English principles.
This is a style target, not a claim of full standard compliance.
Product names, file names, and API identifiers are technical terms.
