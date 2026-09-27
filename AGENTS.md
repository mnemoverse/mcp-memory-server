# AGENTS.md

Instructions for AI coding agents working in this repository. The human-facing version of the same rules is `CONTRIBUTING.md`; where the two differ, `CONTRIBUTING.md` wins.

## If you are here to connect memory for a user

You do not need to change this repository. Use one of these:

- Hosted endpoint, no key to paste: `https://mcp.mnemoverse.com/mcp` (Streamable HTTP, OAuth sign-in in the browser). Per-client setup: https://mnemoverse.com/docs/api/install-by-host
- Local stdio server: follow `llms-install.md`, which is written for an agent installing on a user's behalf. Ask the user for their key; never invent one and never write a literal `mk_live_` key into a file that gets committed.

## Setup and checks

- Node.js 18 or newer. Install with `npm ci`.
- Build: `npm run build` (the prebuild step runs the config generator, the postbuild step regenerates `tools.json`).
- Tests: `npm test` (vitest). Test types: `npm run typecheck:test`.
- Drift checks: `npm run verify:configs` (generated files match `src/configs/source.json`) and `npm run verify:tools` (committed `tools.json` matches the built server).

CI runs the tests in three time zones, so do not assume UTC in tests that touch timestamps.

## The one rule: `src/configs/source.json`

`src/configs/source.json` is the only file edited by hand for distribution metadata: descriptions, install snippets, env variables, registry fields. After changing it:

1. `npm run generate:configs`
2. `npm run verify:configs`
3. Commit the source change together with every regenerated file.

Do not edit generated files by hand. They are `server.json`, `manifest.json`, everything under `docs/configs/` and `docs/snippets/`, and the README regions between the `INSTALL_SNIPPETS` and `MORE_CLIENTS` HTML comment markers. A hand edit is overwritten on the next run and fails `verify-configs.yml` in the meantime. If a diff appears in one of these files and `source.json` did not change, discard it.

Do not hard-code distribution metadata in `src/`, and do not add a parallel config file next to `source.json`.

## Tool surface and changelog

Any change to what a tool does, returns or says about itself, including a description or parameter text, needs an entry under `## [Unreleased]` in `CHANGELOG.md` in the same PR. That text is what a model reads, so even a wording change is a release-worthy patch. An internal refactor with identical behaviour gets `[skip changelog]` in the PR description instead. `changelog-reminder.yml` enforces this for changes under `src/`.

## Versions and releases

The version lives only in `package.json`; `src/index.ts` reads it and `server.json` is generated from it. Releases are cut by pushing a `vX.Y.Z` tag, and `.github/workflows/release.yml` publishes to npm and the MCP Registry. Do not bump versions, tag or publish unless a maintainer asks you to.

## Pull requests

Keep one concern per PR, run `npm test` and `npm run verify:configs` before pushing, and say in the description which of the checks above you ran.
