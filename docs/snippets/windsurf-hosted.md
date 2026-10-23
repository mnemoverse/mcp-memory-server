<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Devin Desktop (formerly Windsurf)** — add the bridge to `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows) and restart Devin Desktop; the bridge opens the browser sign-in on first start:

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

Devin also documents a remote entry with only `"url"` and its own sign-in; that sign-in has not been tested with Mnemoverse yet.
