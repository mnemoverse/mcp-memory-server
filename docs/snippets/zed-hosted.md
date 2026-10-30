<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Zed** — add the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which runs through `npx` (Node.js 20.18.1 or later), to `~/.config/zed/settings.json` (Zed uses `context_servers`); the bridge opens the browser sign-in on first start:

```json
{
  "context_servers": {
    "mnemoverse": {
      "source": "custom",
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

Zed also accepts the URL itself (`"url": "https://mcp.mnemoverse.com/mcp"`) and runs its own sign-in; that route has not been tested with Mnemoverse yet.
