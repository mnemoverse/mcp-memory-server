# Mnemoverse Memory

`@mnemoverse/mcp-memory-server` — the MCP server for the Mnemoverse memory engine.

[![npm version](https://img.shields.io/npm/v/@mnemoverse/mcp-memory-server.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![npm downloads](https://img.shields.io/npm/dm/@mnemoverse/mcp-memory-server.svg?color=blue&label=downloads)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-0ea5e9)](https://registry.modelcontextprotocol.io/v0/servers?search=mnemoverse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Research: SLoD arXiv](https://img.shields.io/badge/Research-arXiv%3A2603.08965-b31b1b)](https://arxiv.org/abs/2603.08965)
[![Glama quality](https://glama.ai/mcp/servers/mnemoverse/mcp-memory-server/badges/score.svg)](https://glama.ai/mcp/servers/mnemoverse/mcp-memory-server)

## What is Mnemoverse Memory?

Mnemoverse is a hosted memory engine for AI agents, reached over the Model Context Protocol. Mnemoverse stores what your agents learn — decisions, preferences, lessons — and returns it in any connected tool, so one memory follows you across Claude Code, Cursor, VS Code and ChatGPT with a single API key. Mnemoverse re-ranks recall from outcomes: report that a recalled memory helped and a Rescorla-Wagner update on the prediction error raises it, report that it misled and it sinks — a different mechanism from similarity scoring, usable alongside it.

## How it compares

Most agent memory today lives in one of three places. Per-tool instruction files — `CLAUDE.md`, `.cursorrules`, `AGENTS.md` — are versioned and readable, but each copy belongs to one repo and one tool, and nothing follows you to the next window. A vector store behind RAG retrieves by similarity, and similarity never changes because advice helped or misled. Local-first memory servers win on privacy and latency, and ask you to run and update the infrastructure yourself. Mnemoverse is the managed, cross-tool option in that landscape: nothing to deploy, one key everywhere, and ranking that moves with reported outcomes. If you need memory inside your own perimeter, a local-first server is the better choice — this one is hosted by design.

The consolidation stage of the engine — HDBSCAN clustering with Von Restorff protection, so distinctive memories are not absorbed into the average — is designed in and currently switched off on the hosted service; our docs say so rather than hide it.

> ⭐ If Mnemoverse saves you from re-explaining context to your agents, [star the repo](https://github.com/mnemoverse/mcp-memory-server). It helps other builders find it.

## Quick Start

### 1. Get a free API key

Sign up at [console.mnemoverse.com](https://console.mnemoverse.com?utm_source=npm&utm_medium=readme&utm_campaign=mcp-memory-server) — takes 30 seconds, no credit card.

### 2. Connect to your AI tool

The canonical setup — both variants write the key **once, at user scope, covering every project**. Avoid per-project config files for this: they get committed with your repo, and keys must stay out of it:

**Claude Code** — one CLI command, user scope:

```bash
claude mcp add mnemoverse -s user   -e MNEMOVERSE_API_KEY=mk_live_YOUR_KEY   -- npx -y @mnemoverse/mcp-memory-server@latest
```

**Cursor** — add to the global `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "command": "npx",
      "args": ["-y", "@mnemoverse/mcp-memory-server@latest"],
      "env": { "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY" }
    }
  }
}
```

<details>
<summary><b>All other clients</b> — VS Code, Windsurf, Zed, JetBrains, Cline, Continue</summary>

<!-- INSTALL_SNIPPETS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->

**Claude Code** — add via CLI:

```bash
claude mcp add mnemoverse -s user \
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

</details>

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
| `memory_read` | Search memories by natural language query (optional recency ordering, time bounds, author exclusion) |
| `memory_list_recent` | List newest memories first — no query; `since`/`until` bounds (inclusive) + cursor paging |
| `memory_feedback` | Rate memories as helpful or not (improves future recall) |
| `memory_stats` | Check how many memories stored, which domains exist |
| `memory_create_room` | Create a shared memory room; its address works as a `domain` on write/read |
| `memory_invite_to_room` | Mint a one-time invite (code + link) for a room you own |
| `memory_join_room` | Join a shared room with an invite code (`mnvr_...`) |
| `memory_list_rooms` | List rooms you own or joined, with each room's address to use as `domain` |
| `vault_list` | List Vault secrets by alias and purpose — the secret value is never returned |

## Use cases

The pattern that pays off first is cross-tool continuity: a decision made while pairing in Claude Code is there when you open Cursor an hour later, and the preference you stated in VS Code holds in a ChatGPT session that evening. Teams use shared rooms the same way — one place where an agent's lessons about a codebase accumulate instead of being re-taught per seat. And because recall re-ranks from feedback, the memories that keep proving useful surface first, which matters once a store grows past what anyone curates by hand.

Concrete things worth writing:

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
| `MNEMOVERSE_API_KEY` | For every tool call — the server starts and lists its tools without one | — |
| `MNEMOVERSE_API_URL` | No | `https://core.mnemoverse.com/api/v1` |

## Research behind it

The retrieval model is published: [arXiv:2603.08965](https://arxiv.org/abs/2603.08965), accepted at the GRAAI workshop at IEEE WCCI 2026 — it establishes the abstraction-discovery method the memory model builds on. No benchmark figures appear in this README, ours or anyone's: numbers will come with a reproducible run to stand behind, not before.

## Links

**Setup and reference**

- [Documentation](https://mnemoverse.com/docs/api/mcp-server)
- [Cursor](https://mnemoverse.com/docs/api/cursor) · [VS Code](https://mnemoverse.com/docs/api/vs-code) · [Claude Code](https://mnemoverse.com/docs/api/claude) · [ChatGPT](https://mnemoverse.com/docs/api/chatgpt)
- [Python SDK](https://mnemoverse.com/docs/api/python-sdk)
- [API Reference](https://mnemoverse.com/docs/api/reference)
- [Console (get API key)](https://console.mnemoverse.com?utm_source=npm&utm_medium=readme&utm_campaign=mcp-memory-server)

**Background reading**

- [Memory MCP servers compared](https://mnemoverse.com/docs/library/memory-mcp-servers-compared) — thirteen shipping options, with pricing and registry presence
- [How to choose a memory MCP server](https://mnemoverse.com/docs/library/memory-mcp) — the five questions that narrow the field
- [What AI agent memory is](https://mnemoverse.com/docs/library/ai-agent-memory) — the category explained
- [Is this a vector database?](https://mnemoverse.com/docs/library/not-a-vector-database) — what makes a memory layer different
- [Shared memory for multi-agent systems](https://mnemoverse.com/docs/library/shared-memory-for-multi-agent-systems) — how Rooms work and when to use them

**Project**

- [GitHub](https://github.com/mnemoverse/mcp-memory-server)
- [Releases](https://github.com/mnemoverse/mcp-memory-server/releases)
- [MCP Registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=mnemoverse)
- [Contributing](CONTRIBUTING.md)

## Privacy Policy

This server sends to the Mnemoverse API (`core.mnemoverse.com`), authenticated with your API key, what a tool call carries — and nothing else it can see. It does **not** read your AI client's conversation history, your local files, or anything you don't pass to a `memory_*` / `vault_*` tool. Stored memories live under your account; Mnemoverse never sells them and never shares them on its own. The one sharing path is the one you create yourself: inviting someone to a shared room grants their assistant access to that room's memories, bounded by the invite's scope.

What each tool sends:

| Tool | Data sent |
|---|---|
| `memory_write` | the `content`, `concepts`, and `domain` you pass |
| `memory_read` | the `query`, plus any filters: `domain`, `since`/`until`, `exclude_author`, `top_k`, `order_by` |
| `memory_list_recent` | the feed filters: `domain`, `since`/`until`, `exclude_author`, `limit`, `cursor` |
| `memory_feedback` | the `atom_ids` being rated and the `outcome` score |
| `memory_create_room` | the room `name` and `description` |
| `memory_invite_to_room` | the `room_id`, invite `scope`, and expiry |
| `memory_join_room` | the invite `code` |
| `memory_stats` / `memory_list_rooms` / `vault_list` | no request body — authenticated GETs |

One thing goes out that you did not explicitly request: since 0.8.1, when a search or feed comes back empty, the server sends one or two authenticated read-only GET probes (`/memory/rooms` and/or `/memory/stats`) so the empty answer can say what it did not cover. The probes carry your API key and nothing else, change no stored state, and are disclosed in the [CHANGELOG](CHANGELOG.md).

| | |
|---|---|
| **Privacy Policy** | <https://mnemoverse.com/privacy> |
| **Retention & deletion** | correct a wrong or stale memory by writing a fresh one; deletion is an administrative operation on the REST API, not exposed through this MCP server |
| **Contact** | hello@mnemoverse.com |

## License

[MIT](LICENSE) © Mnemoverse
