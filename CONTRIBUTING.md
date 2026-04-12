# Contributing to mcp-memory-server

This package is the public face of Mnemoverse across every AI tool marketplace. A single typo in an install snippet breaks every Cursor / VS Code / Claude Desktop / Smithery / Official MCP Registry / GitHub README copy of it. To make that impossible, we use a **single source of truth** with mechanical drift detection.

> **Read this before editing any install snippet, config, or README install section.** The rules are short, but ignoring them produces silent breakage that we only notice when a user reports it.

---

## The one rule

**`src/configs/source.json` is the only file you may edit by hand for distribution metadata.** Everything else is generated and any manual edit will be overwritten — or, worse, will silently drift until CI catches it.

Files that are **generated** (never edit by hand):

| File | What it powers |
| ---- | -------------- |
| `docs/configs/cursor.json` | Cursor `.cursor/mcp.json` snippet |
| `docs/configs/claude-desktop.json` | Claude Desktop `claude_desktop_config.json` snippet |
| `docs/configs/windsurf.json` | Windsurf `mcp_config.json` snippet |
| `docs/configs/vscode.json` | VS Code `.vscode/mcp.json` snippet (uses `servers`, not `mcpServers`) |
| `docs/configs/cursor-deep-link.txt` | Base64-encoded `cursor://...` install URL |
| `docs/configs/vscode-deep-link.txt` | URL-encoded `vscode:mcp/install?...` URL |
| `docs/configs/claude-code-cli.sh` | `claude mcp add ...` shell command |
| `smithery.yaml` | Smithery.ai `configSchema` + `commandFunction` |
| `server.json` | Official MCP Registry manifest |
| `docs/snippets/claude-code.md` | Markdown partial — Claude Code install (consumed by README + docs site) |
| `docs/snippets/cursor.md` | Markdown partial — Cursor install |
| `docs/snippets/claude-desktop.md` | Markdown partial — Claude Desktop install |
| `docs/snippets/vscode.md` | Markdown partial — VS Code install |
| `docs/snippets/windsurf.md` | Markdown partial — Windsurf install |
| `README.md` (only the section between `<!-- INSTALL_SNIPPETS_START -->` and `<!-- INSTALL_SNIPPETS_END -->`) | Top-level install section, in-place rewritten by the generator |

If your editor pops up a diff in any of these files and you didn't change `src/configs/source.json`, the diff is wrong. Discard it.

## How to change a distribution config

```bash
# 1. Edit the source
$EDITOR src/configs/source.json

# 2. Regenerate everything
npm run generate:configs

# 3. Verify nothing else drifted
npm run verify:configs

# 4. Commit BOTH the source change AND every regenerated file
git add src/configs/source.json docs/ smithery.yaml server.json README.md
git commit -m "..."
```

If you forget step 2 and push only the source change, **CI will fail on the drift check** before the PR can merge. This is intentional — mechanical enforcement is the whole point.

## CI and the optional pre-push hook

There are two layers of drift detection — they catch the same problem at different points and you should not skip either.

### Layer 1: GitHub Actions (mandatory)

Every PR runs [`.github/workflows/verify-configs.yml`](.github/workflows/verify-configs.yml), which executes `node scripts/generate-configs.mjs --check`. The job fails the build if any of the 15 generated artifacts (or the README install block) does not match what would be re-emitted from `src/configs/source.json`. **The job is required for merge into `main`.** This is the authoritative gate — it works for forks, blocks PRs, can't be bypassed by `--no-verify`, and protects you from your own typos.

### Layer 2: Local pre-push hook (recommended, opt-in)

Faster feedback (~50 ms vs ~30-60 s for CI). Catches the drift before the commit even hits GitHub. Install once per clone:

```bash
npm run install-hooks
```

This writes `.git/hooks/pre-push` (per-clone, not committed) that runs `npm run verify:configs` before every push. If it fails, your push is aborted and you get the same `✗ Drift detected: ...` message you would have seen in CI — just locally and 1000× faster.

If you ever need to bypass it for a one-off (e.g., pushing a temporary branch you don't care about), use `git push --no-verify`. **Do not bypass for branches that target `main`** — CI will reject them anyway.

We deliberately avoid `husky` and `pre-commit` — those would add a dependency and force the hook on everyone, including casual contributors who just want to fix a typo. The opt-in script is one command and zero deps.

## How `npm run generate:configs` works

`scripts/generate-configs.mjs` reads `src/configs/source.json` and emits 15 artifacts:

1. **9 distribution configs** in `docs/configs/`, plus `smithery.yaml` and `server.json` at the repo root.
2. **5 Markdown partials** in `docs/snippets/` — these are the same install snippets, formatted for inclusion in any Markdown context (README, mnemoverse-docs site pages, llms.txt, etc.).
3. **1 in-place rewrite** of the install section in `README.md`, between the `<!-- INSTALL_SNIPPETS_START -->` and `<!-- INSTALL_SNIPPETS_END -->` HTML comment markers. The rest of the README is human-prose and is left untouched.

The generator is **idempotent**: running it twice in a row produces zero changes the second time. CI relies on this property — it runs the generator with `--check`, which verifies every output matches what is committed and fails the build otherwise.

## How to add a new distribution channel

1. Add a new generator function in `scripts/generate-configs.mjs` that produces the channel's config from the data already in `source.json` (do NOT introduce a parallel data source — extend `source.json` instead if you need new fields).
2. Add the new artifact to the `OUTPUTS` array.
3. If the channel needs a Markdown install snippet, also add a `snippet*()` helper and a `docs/snippets/{channel}.md` entry. If the snippet should also appear in README, append it to `readmeInstallBlock()`.
4. Update this `CONTRIBUTING.md` table above with the new file.
5. Run `npm run generate:configs && npm run verify:configs`. Both must succeed.
6. Commit everything together — the source change, the new generator function, the new generated files, and the updated `CONTRIBUTING.md`.

## Things you must not do

- ❌ **Edit a generated file directly.** Even a one-character fix will be reverted on the next `generate:configs` and CI will fail in the meantime.
- ❌ **Bypass the drift check.** Do not pass `--no-verify` or skip CI. The check exists because we got bitten by 8 copies of the same install snippet drifting in different directions.
- ❌ **Hard-code distribution metadata in `src/index.ts`.** The MCP server source code only knows about tools, transport, and the API URL. Channel-specific stuff lives in `source.json`.
- ❌ **Create a parallel "config" file alongside `source.json`.** If `source.json` is missing a field you need, add it to `source.json` and update the generator. One source.

## Versioning and releases

`package.json#version` → `src/index.ts#version` (server name reported to MCP clients) → `server.json#version` (Official MCP Registry).

Today these are bumped manually and kept in sync by hand. If they drift, the generator's drift check on `server.json` will catch it (because `server.json` is generated from `package.json#version`).

When releasing:

```bash
# 1. Bump version in package.json
$EDITOR package.json

# 2. Match it in src/index.ts (search for version: "...")
$EDITOR src/index.ts

# 3. Regenerate (this updates server.json to match)
npm run generate:configs

# 4. Build and run e2e
npm run build
# ... live e2e against production ...

# 5. Commit, tag, push, publish
git add -A && git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "..."
git push origin main vX.Y.Z
npm publish
gh release create vX.Y.Z --notes "..."
```

A future PR will templatize `src/index.ts#version` so `package.json` is the only place to edit it.

## Testing changes locally

The fastest feedback loop is:

```bash
# Build
npm run build

# Pack into an installable tarball
npm pack

# Smoke test in an isolated dir
mkdir /tmp/mcp-smoke && cd /tmp/mcp-smoke
npm init -y >/dev/null
npm install /path/to/mcp-memory-server/mnemoverse-mcp-memory-server-X.Y.Z.tgz
MNEMOVERSE_API_KEY=mk_test_fake ./node_modules/.bin/mcp-memory-server
# → should print "Error: MNEMOVERSE_API_KEY environment variable is required" if unset, or start a stdio MCP server if set
```

For end-to-end testing against the live API, set a real `mk_live_*` key and pipe a few JSON-RPC messages on stdin (`initialize`, `notifications/initialized`, `tools/call`).

## Who to ask

- For the design rationale behind single-source-of-truth: see [PR #6](https://github.com/mnemoverse/mcp-memory-server/pull/6).
- For the README rewriter design: see [PR #11](https://github.com/mnemoverse/mcp-memory-server/pull/11).
- For everything else, open an issue.
