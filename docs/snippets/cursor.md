<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Cursor** — for the local server through `npx` with an API key, add the JSON below to `~/.cursor/mcp.json`, the global config that covers every project, merging it with any servers already there, and put your key in place of `mk_live_YOUR_KEY`; get one at [console.mnemoverse.com](https://console.mnemoverse.com). Do not put it in a project-level `.cursor/mcp.json`: that file lives inside the repository and is committed with it unless you exclude it, and this config holds your key. The keyless path is the **Add to Cursor** button, which adds the hosted server with a browser sign-in. Pick one path, not both, so the tools are not listed twice.

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
