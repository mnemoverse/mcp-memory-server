<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**JetBrains** (AI Assistant) — *Settings → Tools → AI Assistant → Model Context Protocol (MCP)*, then paste the bridge; it opens the browser sign-in on first start:

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
