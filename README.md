# @mnemoverse/mcp-memory-server

[![npm version](https://img.shields.io/npm/v/@mnemoverse/mcp-memory-server.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![npm downloads](https://img.shields.io/npm/dm/@mnemoverse/mcp-memory-server.svg?color=blue&label=downloads)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-0ea5e9)](https://registry.modelcontextprotocol.io/v0/servers?search=mnemoverse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Research: SLoD arXiv](https://img.shields.io/badge/Research-arXiv%3A2603.08965-b31b1b)](https://arxiv.org/abs/2603.08965)

Hosted memory for AI agents that learns and forgets. Feedback reranks the facts that help; recall fades by recency. One API key works across Claude, Cursor, VS Code, ChatGPT, and any MCP client.

Memory that persists across sessions, projects, and tools — and improves with use. Hosted, so there's no infrastructure to run, and not locked to a single cloud.

## Quick Start

### 1. Get a free API key

Sign up at [console.mnemoverse.com](https://console.mnemoverse.com) — takes 30 seconds, no credit card.

### 2. Connect to your AI tool

<!-- INSTALL_SNIPPETS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->

**Claude Code** — add via CLI:

```bash
claude mcp add mnemoverse \
  -e MNEMOVERSE_API_KEY=mk_live_YOUR_KEY \
  -e MNEMOVERSE_API_URL=https://core.mnemoverse.com/api/v1 \
  -- npx -y @mnemoverse/mcp-memory-server@latest
```

**Cursor** — click to install, or add to `.cursor/mcp.json`:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=mnemoverse&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtbmVtb3ZlcnNlL21jcC1tZW1vcnktc2VydmVyQGxhdGVzdCJdLCJlbnYiOnsiTU5FTU9WRVJTRV9BUElfS0VZIjoibWtfbGl2ZV9ZT1VSX0tFWSIsIk1ORU1PVkVSU0VfQVBJX1VSTCI6Imh0dHBzOi8vY29yZS5tbmVtb3ZlcnNlLmNvbS9hcGkvdjEifX0%3D)

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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
      }
    }
  }
}
```

**More MCP clients** — same server, different config file:

**Zed** — add to `~/.config/zed/settings.json` (Zed uses `context_servers`, and `"source": "custom"` is required):

```json
{
  "context_servers": {
    "mnemoverse": {
      "source": "custom",
      "command": "npx",
      "args": [
        "-y",
        "@mnemoverse/mcp-memory-server@latest"
      ],
      "env": {
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
      }
    }
  }
}
```

**JetBrains** (AI Assistant) — *Settings → Tools → AI Assistant → Model Context Protocol (MCP)*, then paste:

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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
      }
    }
  }
}
```

**Cline** — *MCP Servers → Configure* (or edit `cline_mcp_settings.json`). Cline reads `env` values literally, so paste your real key — not a `${VAR}` reference:

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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
      }
    }
  }
}
```

**Continue** — add `~/.continue/mcpServers/mnemoverse.yaml` (Continue uses YAML):

```yaml
mcpServers:
  - name: mnemoverse
    command: npx
    args:
      - "-y"
      - "@mnemoverse/mcp-memory-server@latest"
    env:
      MNEMOVERSE_API_KEY: "mk_live_YOUR_KEY"
      MNEMOVERSE_API_URL: "https://core.mnemoverse.com/api/v1"
```

> Why `@latest`? Bare `npx @mnemoverse/mcp-memory-server` is cached indefinitely by npm and stops re-checking the registry. The `@latest` suffix forces a metadata lookup on every Claude Code / Cursor / VS Code session start (~100-300ms), so you always pick up new releases.

<!-- INSTALL_SNIPPETS_END -->

> ⚠️ **Restart your AI client** after editing the config. MCP servers are only picked up on client startup.

### 3. Try it — 30 seconds to verify it works

Paste this in your AI chat:

> **"Remember that my favourite TypeScript framework is Hono, and please call `memory_write` to save it."**

Your agent should call `memory_write` and confirm the memory was stored.

Then open a **new chat / new session** (this is the whole point — memory survives restarts), and ask:

> **"What's my favourite TypeScript framework?"**

Your agent should call `memory_read`, find the entry, and answer "Hono". If it does — you're wired up. Write whatever you want next.

If it doesn't remember: check that the client was fully restarted and the config has your real `mk_live_...` key, not the placeholder.

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
- [Releases](https://github.com/mnemoverse/mcp-memory-server/releases)
- [MCP Registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=mnemoverse)
- [Contributing](CONTRIBUTING.md)

## Privacy

This server sends only what you explicitly choose to store or search to the Mnemoverse API (`core.mnemoverse.com`), authenticated with your API key. It does **not** read your AI client's conversation history, your local files, or anything you don't pass to a `memory_*` tool. Stored memories live under your account and are never sold or shared with third parties.

| | |
|---|---|
| **Privacy Policy** | <https://mnemoverse.com/privacy.html> |
| **Data sent** | the `content` / `concepts` / `domain` you pass to `memory_write`; the `query` you pass to `memory_read` |
| **Retention & deletion** | delete one memory with `memory_delete`, or an entire namespace with `memory_delete_domain` |
| **Contact** | hello@mnemoverse.com |

## License

[MIT](LICENSE) © Mnemoverse
