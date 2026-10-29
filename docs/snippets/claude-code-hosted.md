<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->

**Claude Code** — the hosted server, with a browser sign-in. No API key, nothing to install:

```bash
claude mcp add --scope user --transport http mnemoverse https://mcp.mnemoverse.com/mcp
```

Then start Claude Code, run `/mcp`, select `mnemoverse` and choose **Authenticate**. If the command ran inside a Claude Code session (yours, or Claude ran it for you), that session does not load the new server: exit and start `claude` again first.
