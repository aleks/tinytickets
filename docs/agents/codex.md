# Set up Codex

This guide is for Codex CLI and the IDE extension on a local host.
First complete [Prepare the environment](../environment.md).

## 1. Add the MCP server

For a project connection, merge this table into `.codex/config.toml` in the target
repository. Project configuration loads only for trusted projects.

```toml
[mcp_servers.tinytickets]
command = "/absolute/path/to/tinytickets"
args = ["--mcp-stdio", "--db", "/absolute/path/to/tickets.db"]
```

For a personal connection across projects, use `~/.codex/config.toml` instead.
If `CODEX_HOME` is set, inspect that configuration directory first.
Do not create a second `[mcp_servers.tinytickets]` table in the same file.
Preserve other tables and tool restrictions.

For HTTP, use this table instead:

```toml
[mcp_servers.tinytickets]
url = "http://127.0.0.1:8080/mcp"
```

Do not combine stdio and HTTP fields in one server entry.
TinyTickets does not require a local OAuth login.

## 2. Add the policy

Merge the [policy template](../templates/repository-policy.md) into root `AGENTS.md`.
Replace `<PROJECT_NAME>`.
Check for `AGENTS.override.md` files. They can replace `AGENTS.md` in the same
directory. Do not delete an existing override to make setup pass.
Resolve conflicting instructions with the user.

## 3. Add the optional skill

Copy the [skill template](../templates/tinytickets-skill/SKILL.md) to
`.agents/skills/tinytickets/SKILL.md`.
For personal use in all projects, use `~/.agents/skills/tinytickets/SKILL.md` instead.
Use `/skills` or mention `$tinytickets` to select the skill.

## 4. Verify

Start a new Codex session in the target repository after configuration changes.
Use `/mcp` to inspect available servers and tools.
Ask Codex to summarize its active work-tracking instructions.
Complete [Verify the setup](../verification.md).

This guide does not install a Codex enforcement hook.
Do not assume another client's hook format works in Codex.
Check the installed version's supported extension APIs before custom integration.

## Official references

- [MCP](https://developers.openai.com/codex/extend/mcp)
- [AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md)
- [Skills](https://developers.openai.com/codex/skills)

Configuration examples were checked against these references on 2026-11-11.
They were not executed in every customer environment.
