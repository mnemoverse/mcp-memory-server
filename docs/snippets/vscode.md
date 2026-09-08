<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**VS Code** — add to `.vscode/mcp.json` (note: VS Code uses `servers`, not `mcpServers`). That file is meant to be committed and shared with your team, so the key in it is too — if you'd rather keep it out of the repo, run **MCP: Open User Configuration** from the Command Palette and add the same JSON to your user profile's `mcp.json` instead:

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
