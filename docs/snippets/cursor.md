<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Cursor** — click to install, or add to the global `~/.cursor/mcp.json` (recommended — one config for every project); a project-level `.cursor/mcp.json` also works, but it ships with the repository, so keep API keys out of it:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=mnemoverse&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtbmVtb3ZlcnNlL21jcC1tZW1vcnktc2VydmVyQGxhdGVzdCJdLCJlbnYiOnsiTU5FTU9WRVJTRV9BUElfS0VZIjoibWtfbGl2ZV9ZT1VSX0tFWSIsIk1ORU1PVkVSU0VfQVBJX1VSTCI6Imh0dHBzOi8vY29yZS5tbmVtb3ZlcnNlLmNvbS9hcGkvdjEifX0%3D)

The button pre-fills the placeholder mk_live_YOUR_KEY; after installing, open Cursor Settings, MCP, mnemoverse, and replace it with your key from console.mnemoverse.com — otherwise every tool call is refused.

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
