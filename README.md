# @mnemoverse/mcp-memory-server

Persistent AI memory for Claude Code, Cursor, VS Code, and any MCP client.

Your agent remembers everything — across sessions, projects, and tools. One memory, everywhere.

## Quick Start

### 1. Get a free API key

Sign up at [console.mnemoverse.com](https://console.mnemoverse.com) — takes 30 seconds, no credit card.

### 2. Connect to your AI tool

<!-- INSTALL_SNIPPETS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->

**Claude Code:**

```bash
claude mcp add mnemoverse \
  -e MNEMOVERSE_API_KEY=mk_live_YOUR_KEY \
  -- npx -y @mnemoverse/mcp-memory-server@latest
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "command": "npx",
      "args": [
        "-y",
        "@mnemoverse/mcp-memory-server@latest"
      ],
      "env": {
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY"
      }
    }
  }
}
```

**VS Code** — add to `.vscode/mcp.json` (note: VS Code uses `servers`, not `mcpServers`):

```json
{
  "servers": {
    "mnemoverse": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@mnemoverse/mcp-memory-server@latest"
      ],
      "env": {
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY"
      }
    }
  }
}
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "command": "npx",
      "args": [
        "-y",
        "@mnemoverse/mcp-memory-server@latest"
      ],
      "env": {
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY"
      }
    }
  }
}
```

> Why `@latest`? Bare `npx @mnemoverse/mcp-memory-server` is cached indefinitely by npm and stops re-checking the registry. The `@latest` suffix forces a metadata lookup on every Claude Code / Cursor / VS Code session start (~100-300ms), so you always pick up new releases.

<!-- INSTALL_SNIPPETS_END -->

### 3. Done

Your AI now has persistent memory. Try:

> "Remember that I prefer Railway for deployments"

Then in a new session:

> "Where should I deploy this?"

It remembers.

## Tools

| Tool | What it does |
|------|-------------|
| `memory_write` | Store a memory — insight, preference, lesson learned |
| `memory_read` | Search memories by natural language query |
| `memory_feedback` | Rate memories as helpful or not (improves future recall) |
| `memory_stats` | Check how many memories stored, which domains exist |
| `memory_delete` | Permanently delete a single memory by `atom_id` |
| `memory_delete_domain` | Wipe an entire domain (requires `confirm: true` safety interlock) |

## Ideas: What to Remember

- **User preferences**: "I use dark mode", "I prefer Tailwind over CSS modules"
- **Project context**: "This project uses PostgreSQL + Prisma", "Deploy to Railway"
- **Lessons learned**: "Always run tests before push on this repo"
- **Decisions made**: "We chose REST over GraphQL because of caching simplicity"
- **People & roles**: "Alice is the designer, Bob owns the API"
- **Past mistakes**: "Don't deploy on Fridays — learned this the hard way"

## Universal Memory

The same API key works across all tools. Write a memory in Claude Code — read it in Cursor. Learn something in VS Code — your GPT Custom Action knows it too.

```
                    ┌── Claude Code (this MCP server)
                    ├── Cursor (this MCP server)
   Mnemoverse API ──├── VS Code (this MCP server)
   (one memory)     ├── GPT (Custom Actions)
                    ├── Python SDK (pip install mnemoverse)
                    └── REST API (curl)
```

## Configuration

| Env Variable | Required | Default |
|-------------|----------|---------|
| `MNEMOVERSE_API_KEY` | Yes | — |
| `MNEMOVERSE_API_URL` | No | `https://core.mnemoverse.com/api/v1` |

## Links

- [Documentation](https://mnemoverse.com/docs/api/mcp-server)
- [Python SDK](https://mnemoverse.com/docs/api/python-sdk)
- [API Reference](https://mnemoverse.com/docs/api/reference)
- [Console (get API key)](https://console.mnemoverse.com)
- [GitHub](https://github.com/mnemoverse/mcp-memory-server)

## License

MIT
