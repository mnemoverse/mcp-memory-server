<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Cline** — in the Cline panel, open **MCP Servers**, then the **Remote Servers** tab. Enter `mnemoverse` as the server name and `https://mcp.mnemoverse.com/mcp` as the URL, choose **Streamable HTTP**, click **Add Server**, then click **Authenticate** on the server's row and sign in in the browser. The same entry by hand, in `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "mnemoverse": {
      "type": "streamableHttp",
      "url": "https://mcp.mnemoverse.com/mcp"
    }
  }
}
```

Keep `"type": "streamableHttp"`: without it Cline uses the older SSE transport.
