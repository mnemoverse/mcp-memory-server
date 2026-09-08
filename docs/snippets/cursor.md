<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Cursor** — click to install, or add the JSON below to `~/.cursor/mcp.json`, the global config that covers every project. Do not put it in a project-level `.cursor/mcp.json`: that file lives inside the repository and is committed with it unless you exclude it, and this config holds your key.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=mnemoverse&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtbmVtb3ZlcnNlL21jcC1tZW1vcnktc2VydmVyQGxhdGVzdCJdLCJlbnYiOnsiTU5FTU9WRVJTRV9BUElfS0VZIjoibWtfbGl2ZV9ZT1VSX0tFWSIsIk1ORU1PVkVSU0VfQVBJX1VSTCI6Imh0dHBzOi8vY29yZS5tbmVtb3ZlcnNlLmNvbS9hcGkvdjEifX0%3D)

The install button carries the placeholder key `mk_live_YOUR_KEY`, not yours, so the shortest path is to skip the button: add the JSON below to `~/.cursor/mcp.json`, merging it with any servers already there, and put your own key in place. Get one at [console.mnemoverse.com](https://console.mnemoverse.com). If you did click the button, edit the same key in the `mcp.json` it wrote; Cursor keeps MCP environment values in that file, not in a settings form. Until the key is real the server starts and lists its tools, but every tool call is refused.

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
