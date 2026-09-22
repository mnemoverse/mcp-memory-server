# Installing Mnemoverse Memory (instructions for AI agents)

This file is for an AI agent such as Cline that installs `@mnemoverse/mcp-memory-server` on a user's behalf. Follow the steps in order. The human-facing version of the same steps is in `README.md`.

## What you are installing

Mnemoverse Memory is a hosted memory service for AI agents, reached over the Model Context Protocol. This package is a local MCP server (Node.js, stdio transport) that forwards tool calls to the hosted API at `https://core.mnemoverse.com/api/v1`. There is nothing to deploy and no database to run. The user needs two things: a Node.js runtime and an API key.

## Requirements

- Node.js 18 or newer. `npx` ships with npm, so no global install is needed; `npx -y @mnemoverse/mcp-memory-server@latest` downloads and runs the current release.
- A Mnemoverse API key. It starts with `mk_live_`. The user gets one at https://console.mnemoverse.com (free tier, no credit card). Ask the user for the key; do not invent one. The server starts and lists its tools without a key, but every tool call is refused until a real key is set.

## Step 1: add the server to the client config

For Cline, open MCP Servers, then Configure, or edit `cline_mcp_settings.json` directly. Merge this object with any servers already present. Cline reads `env` values literally, so put the real key in place of `mk_live_YOUR_KEY`, not a `${VAR}` reference.

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

Other clients use the same command and the same two environment variables in their own config file. The exact blocks for Claude Code, Cursor, VS Code, Windsurf, Zed, JetBrains and Continue are in `README.md` under "Connect to your AI tool". VS Code uses the key `servers` instead of `mcpServers`.

Keep the key out of files that are committed to a repository. Prefer a user-level config over a project-level one.

## Step 2: restart the client

MCP servers are picked up on client startup. After editing the config, restart the client fully, then check that a server named `mnemoverse` shows ten tools.

## Step 3: verify

1. Ask the assistant: "Remember that my favourite TypeScript framework is Hono, and call memory_write to save it." Expected: a `memory_write` call that reports the memory as stored. If it answers `NOT STORED`, the engine judged it a near-duplicate of something already in this account (typical when this guide is run a second time): the connection works, go to step 2.
2. Start a new session and ask: "What's my favourite TypeScript framework?" Expected: a `memory_read` call and the answer "Hono".
3. If step 1 or 2 returns an authentication error, read it: the message says which problem it is (no key set, the placeholder still in place, a key cut short or wrapped in quotes, a key that does not exist, or a revoked key). Fix the `MNEMOVERSE_API_KEY` value accordingly (a revoked key needs a new one from the console) and restart the client again.

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `MNEMOVERSE_API_KEY` | Yes, for every tool call | none |
| `MNEMOVERSE_API_URL` | No | `https://core.mnemoverse.com/api/v1` |

## Tools

Ten tools. The same set is served by the hosted endpoint, so memories written here are readable from every other client the user connects to the same account.

| Tool | What it does |
|---|---|
| `memory_write` | Store a memory: an insight, a preference, a lesson learned |
| `memory_read` | Search memories by natural language query, with optional recency ordering, time bounds and author exclusion |
| `memory_list_recent` | List the newest memories first, no query; `since` and `until` bounds plus cursor paging |
| `memory_feedback` | Rate recalled memories as helpful or not; the rating changes the order of the next recall |
| `memory_stats` | Count of stored memories and the list of domains |
| `memory_create_room` | Create a shared memory room; its address is used as `domain` on write and read |
| `memory_invite_to_room` | Mint an invite (code and link) for a room the user owns; single-use unless `max_uses` allows more |
| `memory_join_room` | Join a shared room with an invite code (`mnvr_...`) |
| `memory_list_rooms` | List rooms the user owns or joined, with each room's address |
| `vault_list` | List Vault secrets by alias and purpose; the secret value is never returned |

Deletion is not exposed through this server. To correct a wrong or stale memory, write a fresh one with `memory_write`.

## Notes for agents

- Windows: if you run the Claude Code CLI command from `README.md` in PowerShell, paste it as one line.
- The `@latest` suffix makes `npx` check the registry on each start, so the user picks up new releases without reinstalling.
- Transport is stdio only for this package. A hosted remote MCP endpoint with OAuth 2.1 sign-in through the browser is documented separately at https://mnemoverse.com/docs/api/remote-mcp-server for clients that support remote servers; it is not what this file installs.
- Do not put the API key into a project file that is committed with the repository.

## Links

- Documentation: https://mnemoverse.com/docs/api/mcp-server
- Console (API key): https://console.mnemoverse.com
- Source: https://github.com/mnemoverse/mcp-memory-server
- Contact: hello@mnemoverse.com
