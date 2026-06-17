#!/usr/bin/env bash
claude mcp add mnemoverse \
  -e MNEMOVERSE_API_KEY=mk_live_YOUR_KEY \
  -e MNEMOVERSE_API_URL=https://core.mnemoverse.com/api/v1 \
  -- npx -y @mnemoverse/mcp-memory-server@latest
