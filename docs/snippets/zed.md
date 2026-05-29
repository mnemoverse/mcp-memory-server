<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

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
        "MNEMOVERSE_API_KEY": "mk_live_YOUR_KEY"
      }
    }
  }
}
```
