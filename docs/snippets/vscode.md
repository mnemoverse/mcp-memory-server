<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**VS Code** — the [VS Code extension](https://github.com/mnemoverse/mnemoverse-vscode) signs in through the browser and needs no key; that's the default path. In VS Code's non-interactive Agent Host mode, servers that prompt for inputs like this one are not started; for unattended use there, put the key in the environment of the process that launches VS Code instead. To wire the MCP server directly instead, add this to `.vscode/mcp.json` (note: VS Code uses `servers`, not `mcpServers`). Never put a literal `mk_live_` key in that file — it's committed with the repo. The `inputs` entry below prompts for the key instead: VS Code masks what you type and stores it in its own secret storage, not in the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "mnemoverse-api-key",
      "description": "Mnemoverse API key (starts with mk_live_), for this local package only: the hosted server https://mcp.mnemoverse.com/mcp signs in with OAuth and takes no key. Optional to install and inspect — the server starts and lists its tools without a key; every actual tool call requires one. Get one free in ~30s at https://console.mnemoverse.com",
      "password": true
    }
  ],
  "servers": {
    "mnemoverse": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@mnemoverse/mcp-memory-server@latest"
      ],
      "env": {
        "MNEMOVERSE_API_KEY": "${input:mnemoverse-api-key}",
        "MNEMOVERSE_API_URL": "https://core.mnemoverse.com/api/v1"
      }
    }
  }
}
```
