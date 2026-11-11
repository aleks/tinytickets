# Set up Cursor

This guide is for a local Cursor agent.
First complete [Prepare the environment](../environment.md).

## 1. Add the MCP server

Merge this entry into `.cursor/mcp.json` in the target repository:

```json
{
  "mcpServers": {
    "tinytickets": {
      "type": "stdio",
      "command": "/absolute/path/to/tinytickets",
      "args": ["--mcp-stdio", "--db", "/absolute/path/to/tickets.db"]
    }
  }
}
```

For personal use across projects, use `~/.cursor/mcp.json` instead.
Do not commit personal absolute paths as shared team settings.
Preserve existing servers.

For HTTP, use this entry instead:

```json
{
  "mcpServers": {
    "tinytickets": {
      "url": "http://127.0.0.1:8080/mcp"
    }
  }
}
```

## 2. Add the policy

Merge the [policy template](../templates/repository-policy.md) into root `AGENTS.md`.
Replace `<PROJECT_NAME>`.

Alternatively, create `.cursor/rules/tinytickets.mdc`.
Put this frontmatter first, followed by the policy template content:

```yaml
---
description: Track repository changes in TinyTickets
alwaysApply: true
---
```

Choose one policy location. Do not install duplicate rules.
Use `.mdc`, not `.md`, for files under `.cursor/rules`.
Do not use a file pattern or an agent-selected rule for mandatory work tracking.
The policy must be available before the first edit.

Keep essential rules in the policy body.
A file reference does not automatically include the referenced content.
For extra procedure detail, tell the agent to read the
[skill template](../templates/tinytickets-skill/SKILL.md) as a reference document.
This guide does not install a Cursor skill.

## 3. Verify

Open **Customize** and inspect the MCP server and active rules.
Enable TinyTickets and approve tool calls as required.
If a connection fails, inspect the MCP logs in the Output panel.
Complete [Verify the setup](../verification.md) in Agent chat.

These rules guide Agent. They do not require Cursor Tab completions to use tickets.
Cloud Agents cannot reach your local loopback server.
Do not expose an unauthenticated TinyTickets instance to solve that limitation.

For custom enforcement, read [Hooks and plugins](../hooks-and-plugins.md).
This guide does not supply a Cursor enforcement integration.

## Official references

- [MCP](https://cursor.com/docs/context/mcp)
- [Rules](https://cursor.com/docs/context/rules)

Configuration examples were checked against these references on 2026-11-11.
They were not executed in every customer environment.
