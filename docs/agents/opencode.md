# Set up OpenCode V2

First complete [Prepare the environment](../environment.md).
Run setup commands from the repository that will use TinyTickets.

## 1. Add the MCP server

For a project connection, run:

```sh
opencode mcp add tinytickets -- /absolute/path/to/tinytickets --mcp-stdio --db /absolute/path/to/tickets.db
opencode mcp list
```

To make the connection available in all projects, add `--global` before `--`.
Inspect existing settings before either operation.

Alternatively, merge this entry into `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "tinytickets": {
        "type": "local",
        "command": ["/absolute/path/to/tinytickets", "--mcp-stdio", "--db", "/absolute/path/to/tickets.db"]
      }
    }
  }
}
```

V2 server entries go under `mcp.servers`, not directly under `mcp`.
The user configuration file is `~/.config/opencode/opencode.json(c)`.
Do not put MCP settings in `cli.json`.

For HTTP, use the running server from the environment guide:

```sh
opencode mcp add tinytickets --url http://127.0.0.1:8080/mcp
```

TinyTickets has no local sign-in step. If the client requests authentication,
check the endpoint and proxy configuration before proceeding.

## 2. Add the policy

Merge the [policy template](../templates/repository-policy.md) into the repository's
root `AGENTS.md`. Replace `<PROJECT_NAME>`.
Keep existing instructions. OpenCode V2 does not use `CLAUDE.md` as a fallback.

## 3. Add the optional skill

Copy the [skill template](../templates/tinytickets-skill/SKILL.md) to
`.opencode/skills/tinytickets/SKILL.md` in the target repository.
For personal use in all repositories, use
`~/.config/opencode/skills/tinytickets/SKILL.md` instead.
Avoid duplicate copies. Use `@tinytickets` in a prompt to load the skill explicitly.

## 4. Verify

OpenCode reloads configuration changes automatically. Use `/reload` to force a reload.
Use `/mcps` to inspect the server connection.
Replacing a TinyTickets binary does not replace an already running stdio process.
Reconnect that process when you update TinyTickets.

Complete [Verify the setup](../verification.md).
Do not disable tool approvals or other permissions to make setup pass.

## Optional enforcement

A custom server plugin can restore ticket context and check tool execution.
No TinyTickets enforcement plugin is supplied here.
Read [Hooks and plugins](../hooks-and-plugins.md) before implementing one.

## Official references

- [MCP servers](https://opencode.ai/v2/docs/mcp-servers)
- [Instructions](https://opencode.ai/v2/docs/instructions)
- [Skills](https://opencode.ai/v2/docs/skills)
- [Server plugins](https://opencode.ai/v2/docs/build/plugins/server)

Configuration examples were checked against these references on 2026-11-11.
They were not executed in every customer environment.
