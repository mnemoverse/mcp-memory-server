# Installing Mnemoverse Memory (instructions for AI agents)

Choose the user's current app before configuring a server. This file then explains hosted and local MCP setup for an agent such as Cline. The human-facing version is in `README.md`.

## ChatGPT: install the published plugin

Open [Mnemoverse Memory](https://chatgpt.com/plugins/plugin_asdk_app_6ada598cec7c81918b22105edfafcb33), select **Install plugin**, and let the user complete ChatGPT login and Mnemoverse browser sign-in. Follow the [ChatGPT guide](https://mnemoverse.com/docs/api/chatgpt), then stop here: the local-package steps below are not needed. Start a new chat, select the plugin and check an actual `memory_stats` response before a user-requested write and read-back. If installation is unavailable, report the actual message; custom-server creation limits do not establish published-plugin eligibility.

For other apps, use the recommended route in [Install by host](https://mnemoverse.com/docs/api/install-by-host). Never ask for passwords, API keys or OAuth codes in chat.

## First: the hosted server needs no key

If the client can add a remote MCP server by URL and run its browser sign-in, follow the hosted setup in this section, then skip the local-package sections after it: there is no key to ask for and nothing to install. The URL is `https://mcp.mnemoverse.com/mcp` (streamable HTTP, OAuth sign-in). Host-specific differences are listed in [tool availability](https://mnemoverse.com/docs/api/tool-availability).

In Claude Code, run:

```bash
claude mcp add --scope user --transport http mnemoverse https://mcp.mnemoverse.com/mcp
```

Keep `--scope user`: without it the server is added for the current directory only. A Claude Code session that was running when the command ran does not load the new server, so tell the user to exit, start `claude` again, run `/mcp`, select `mnemoverse` and choose **Authenticate**.

In Cline, open MCP Servers, then the Remote Servers tab. Enter `mnemoverse` as the server name and `https://mcp.mnemoverse.com/mcp` as the URL, choose Streamable HTTP and click Add Server, then tell the user to click Authenticate on the server's row and sign in in the browser. The same entry by hand, in `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "type": "streamableHttp",
      "url": "https://mcp.mnemoverse.com/mcp"
    }
  }
}
```

A client that only starts local commands reaches the same hosted server through the `mcp-remote` bridge, which needs Node.js 20.18.1 or newer and opens the same browser sign-in on first start. There is still no key:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://mcp.mnemoverse.com/mcp"
      ]
    }
  }
}
```

Use the local package below when the user deliberately chooses it, needs an unattended connection, or their MCP client cannot complete browser sign-in. An unavailable ChatGPT install button is not a reason to run a local package: use the ChatGPT guide to diagnose that account's actual restriction.

## What you are installing

Mnemoverse Memory is a hosted memory service for AI agents, reached over the Model Context Protocol. This package is a local MCP server (Node.js, stdio transport) that forwards tool calls to the hosted API at `https://core.mnemoverse.com/api/v1`. There is nothing to deploy and no database to run. For this local package the user needs two things: a Node.js runtime and an API key.

## Requirements

- Node.js 18 or newer. `npx` ships with npm, so no global install is needed; `npx -y @mnemoverse/mcp-memory-server@latest` downloads and runs the current release.
- A Mnemoverse API key. It starts with `mk_live_`. The user gets one at https://console.mnemoverse.com (free tier, no credit card) and enters it in the client's protected settings or a private user-level configuration. Do not ask them to paste it into chat or invent one. The server starts and lists its tools without a key, but every tool call is refused until a real key is set.

## Step 1: add the server to the client config

For Cline, open MCP Servers, then Configure, or edit `cline_mcp_settings.json` directly. Merge this object with any servers already present. Cline reads `env` values literally, so have the user replace `mk_live_YOUR_KEY` privately in that config, not with a `${VAR}` reference. Do not print or commit the completed config.

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

Other clients use the same command and the same two environment variables in their own config file. The exact blocks for Claude Code, Cursor, VS Code, Devin Desktop (formerly Windsurf), Zed, JetBrains and Cline are in `README.md` under "Local package with an API key". VS Code uses the key `servers` instead of `mcpServers`.

Keep the key out of files that are committed to a repository. Prefer a user-level config over a project-level one.

## Step 2: restart the client

MCP servers are picked up on client startup. After editing the config, restart the client fully, then check that a server named `mnemoverse` shows eleven tools.

## Step 3: verify

1. Call `memory_stats` and inspect the actual response. Visible tool names alone do not verify an authenticated connection.
2. If setup was the only request, report verified read access and stop; writes have not been tested. Do not create a test memory just to finish setup. If the user already requested saving a fact or testing persistence, continue that task. For a persistence test, let the user choose a harmless true fact and a domain such as `setup-check`.
3. For that requested save, call `memory_write` with the fact and domain, and inspect the result. Report saved only when it confirms storage. `NOT STORED` or `stored: false` means no new memory was saved: retain the returned reason if present, do not assume it was a duplicate, and do not retry writes blindly. For a requested persistence test, start a new session and verify that `memory_read` returns the fact from the same domain. A natural-language answer without the tool result does not establish persistence. If a read finds a pre-existing matching memory after a refused write, report that distinction.
4. If a call returns an authentication error, read it: the message says which problem it is (no key set, the placeholder still in place, a key cut short or wrapped in quotes, a key that does not exist, or a revoked key). Have the user fix `MNEMOVERSE_API_KEY` in their private configuration (a revoked key needs a new one from the console) and restart the client again. Keep secrets out of troubleshooting output.

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `MNEMOVERSE_API_KEY` | Yes, for every tool call | none |
| `MNEMOVERSE_API_URL` | No | `https://core.mnemoverse.com/api/v1` |

## Tools

Eleven tools in this local package. The hosted endpoint has [host-specific tool availability](https://mnemoverse.com/docs/api/tool-availability); ChatGPT deliberately does not receive every local tool. Memories are shared by clients connected to the same Mnemoverse account.

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
| `memory_graph` | Read the association edges around given concepts: weight, outcome valence, co-activation count |
| `vault_list` | List Vault secrets by alias and purpose; the secret value is never returned |

Deletion is not exposed through this server. To correct a wrong or stale memory, write a fresh one with `memory_write`.

## Notes for agents

- Windows: if you run the Claude Code CLI command from `README.md` in PowerShell, paste it as one line.
- The `@latest` suffix makes `npx` check the registry on each start, so the user picks up new releases without reinstalling.
- Transport is stdio only for this package. The hosted server in the first section is a separate streamable HTTP endpoint with an OAuth 2.1 browser sign-in; https://mnemoverse.com/docs/api/remote-mcp-server documents it in full.
- Do not put the API key into a project file that is committed with the repository.

## Links

- Documentation: https://mnemoverse.com/docs/api/mcp-server
- Console (API key): https://console.mnemoverse.com
- Source: https://github.com/mnemoverse/mcp-memory-server
- Contact: hello@mnemoverse.com
