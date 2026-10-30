<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**VS Code** — the [VS Code extension](https://github.com/mnemoverse/mnemoverse-vscode) signs in through the browser, with no key to paste: install it and run **Mnemoverse: Sign In**. Without the extension, add the hosted server to `.vscode/mcp.json` (VS Code 1.102 or later; VS Code uses `servers`, not `mcpServers`). VS Code opens the browser sign-in on first use, and the entry holds no key, so the file is safe to commit:

```json
{
  "servers": {
    "mnemoverse": {
      "type": "http",
      "url": "https://mcp.mnemoverse.com/mcp"
    }
  }
}
```
