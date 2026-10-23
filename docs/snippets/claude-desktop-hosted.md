<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Claude Desktop** — add the hosted server as a custom connector: **Customize → Connectors**, then **+** and **Add custom connector**, paste `https://mcp.mnemoverse.com/mcp` and sign in when the browser opens. The connector also works on claude.ai and in the Claude mobile apps; free Claude plans allow one custom connector. To use `claude_desktop_config.json` instead, add the bridge and restart Claude Desktop; the bridge opens the same browser sign-in:

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
