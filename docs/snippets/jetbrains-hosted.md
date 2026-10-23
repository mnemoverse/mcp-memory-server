<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**JetBrains** (AI Assistant) — *Settings → Tools → AI Assistant → Model Context Protocol (MCP)*, then paste the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which runs through `npx` (Node.js 20.18.1 or later); the bridge opens the browser sign-in on first start:

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
