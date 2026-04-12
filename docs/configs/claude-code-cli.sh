#!/usr/bin/env bash
claude mcp add mnemoverse \
  -e MNEMOVERSE_API_KEY=mk_live_YOUR_KEY \
  -- npx -y @mnemoverse/mcp-memory-server
