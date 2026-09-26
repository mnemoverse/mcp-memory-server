#!/usr/bin/env node
/**
 * generate-configs.mjs
 *
 * Single source of truth → all distribution channel configs.
 *
 * Reads: src/configs/source.json (every channel's identity, command, env)
 *        tools.json (the tool list, generated from the built server by
 *        scripts/generate-tools-manifest.mjs; the .mcpb manifest's tools[]
 *        is derived from it, never typed by hand)
 * Writes: docs/configs/*, docs/snippets/*, server.json, manifest.json,
 *         README.md install block
 *
 * Usage:
 *   node scripts/generate-configs.mjs            # generate
 *   node scripts/generate-configs.mjs --check    # CI: regenerate + diff (fail if changed)
 *
 * When you add a new distribution channel, add a new generator function below.
 * Never edit generated files by hand — they will be overwritten.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ─── Load source ─────────────────────────────────────────────────────────────

const SOURCE_PATH = resolve(ROOT, "src/configs/source.json");
const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8"));

const PACKAGE_VERSION = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
).version;

// The tool list is NOT in source.json. It is tools.json, produced by
// scripts/generate-tools-manifest.mjs from the built server (dist/shared.js),
// so the .mcpb manifest below declares exactly what the server registers.
// A missing file never becomes an empty list (a manifest with no tools would
// pass every drift check and ship a Desktop Extension that declares nothing).
// It is only possible on the FIRST build of a fresh checkout without the
// committed file: `prebuild` runs this generator before tsc, and `postbuild`
// writes tools.json and runs this generator again. So in generate mode a
// missing file leaves manifest.json untouched with a notice, and postbuild
// completes it; in --check mode it is a failure (Copilot on #179).
const TOOLS_PATH = resolve(ROOT, "tools.json");
const TOOLS_MANIFEST = existsSync(TOOLS_PATH) ? JSON.parse(readFileSync(TOOLS_PATH, "utf8")) : null;
if (!TOOLS_MANIFEST) {
  const how = "it is generated from the built server by `npm run build` (postbuild), or by `node scripts/generate-tools-manifest.mjs` on an existing dist/";
  if (process.argv.includes("--check")) {
    console.error(`✗ tools.json not found at ${TOOLS_PATH}: ${how}.`);
    process.exit(1);
  }
  console.warn(`! tools.json not found: manifest.json is left as it is this run; ${how}.`);
}

// Helper: extract { KEY: "value" } from source.env (which has nested {value, description, ...})
function envValues(envObj) {
  const result = {};
  for (const [key, meta] of Object.entries(envObj)) {
    result[key] = meta.value;
  }
  return result;
}

const ENV_VALUES = envValues(source.env);

// Helper: the sample value a snippet carries for one env entry, looked up by
// entry name through the registry itself. Prose that names the sample (the
// Cursor paragraph under the one-click badge) reads it here rather than as
// ENV_VALUES.MNEMOVERSE_API_KEY on purpose: every value in source.env is a
// documented sample that ships in public README text, but a property access
// named *_API_KEY flowing into the --check drift printout (which echoes the
// first 200 characters of a regenerated artifact) reads to CodeQL as
// clear-text logging of a credential (js/clear-text-logging, alert #4 on PR
// #123). Going through the entries keeps the single source of truth and the
// drift check, and drops the false credential signal.
function sampleValue(envName) {
  for (const [name, meta] of Object.entries(source.env)) {
    if (name === envName) return meta.value;
  }
  throw new Error(`source.json env has no entry named ${envName}`);
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Cursor / Claude Desktop / Windsurf format (mcpServers key, stdio).
 */
function genMcpServersFormat() {
  return {
    mcpServers: {
      [source.name]: {
        command: source.command,
        args: source.args,
        env: ENV_VALUES,
      },
    },
  };
}

/**
 * VS Code `inputs` id for one source.env entry: lowercase, underscores to
 * dashes (MNEMOVERSE_API_KEY → mnemoverse-api-key), so it reads as the
 * `${input:mnemoverse-api-key}` reference VS Code substitutes at connect time.
 */
function vscodeInputId(envName) {
  return envName.toLowerCase().replace(/_/g, "-");
}

/**
 * `.vscode/mcp.json` is committed with the repo like any other project file,
 * so a literal secret in its `env` block ships to every collaborator's git
 * history. VS Code's own docs warn against exactly this and document the fix:
 * an `inputs` entry with `password: true` prompts for the value once and
 * VS Code stores it in its own secret storage, substituting
 * `${input:<id>}` at connect time — the value itself never lands in the file.
 * (docs.md source: https://code.visualstudio.com/docs/agents/reference/mcp-configuration#_input-variables-for-sensitive-data,
 * verified 2026-09-14.) Only entries marked `secret: true` in source.json get
 * an input; MNEMOVERSE_API_URL is not a secret and stays a literal default.
 *
 * `description` reads from source.env[key].description rather than a
 * hardcoded string, so this prompt text and the registry-facing
 * `environmentVariables[].description` in genServerJson() below say one
 * thing instead of two that can drift apart (found diverged on review of
 * #126, 2026-09-15). The VS-Code-only detail that used to live here, namely
 * the extension's browser sign-in as a no-key alternative, is not in
 * source.json's shared description, so it is not repeated here either; it
 * still ships to VS Code users in the prose above the JSON in
 * snippetVscode() below.
 */
function genVscodeInputs() {
  return Object.entries(source.env)
    .filter(([, meta]) => meta.secret)
    .map(([key, meta]) => ({
      type: "promptString",
      id: vscodeInputId(key),
      description: meta.description,
      password: true,
    }));
}

function genVscodeEnv() {
  const result = {};
  for (const [key, meta] of Object.entries(source.env)) {
    result[key] = meta.secret ? `\${input:${vscodeInputId(key)}}` : meta.value;
  }
  return result;
}

/**
 * VS Code (Copilot Chat) format — uses `servers` key (not `mcpServers`), plus
 * a top-level `inputs` array so the secret env value is prompted for rather
 * than written into the file (see genVscodeInputs() above).
 */
function genVscodeFormat() {
  const inputs = genVscodeInputs();
  return {
    ...(inputs.length ? { inputs } : {}),
    servers: {
      [source.name]: {
        type: source.type,
        command: source.command,
        args: source.args,
        env: genVscodeEnv(),
      },
    },
  };
}

/**
 * Zed format — Zed uses `context_servers` (NOT `mcpServers`), and a custom
 * command server MUST set `"source": "custom"` so Zed treats it as a raw stdio
 * command rather than an extension. Flat command/args/env (per Zed PR #33539,
 * which replaced the older nested `command: { path, args, env }` shape).
 */
function genZedFormat() {
  return {
    context_servers: {
      [source.name]: {
        source: "custom",
        command: source.command,
        args: source.args,
        env: ENV_VALUES,
      },
    },
  };
}

/**
 * Continue format — YAML, an `mcpServers` list. stdio is inferred from the
 * presence of `command` (only sse/http need an explicit transport). The legacy
 * config.json `experimental.modelContextProtocolServers` shape is deprecated.
 */
function genContinueYaml() {
  const argsLines = source.args.map((a) => `      - "${a}"`).join("\n");
  const envLines = Object.entries(ENV_VALUES)
    .map(([k, v]) => `      ${k}: "${v}"`)
    .join("\n");
  return (
    "mcpServers:\n" +
    `  - name: ${source.name}\n` +
    `    command: ${source.command}\n` +
    "    args:\n" +
    argsLines +
    "\n    env:\n" +
    envLines +
    "\n"
  );
}

/**
 * Cursor deep link.
 *
 * Format: cursor://anysphere.cursor-deeplink/mcp/install?name=NAME&config=BASE64
 * The base64 payload is the inner server object (NOT wrapped in mcpServers).
 */
function genCursorDeepLink() {
  const inner = {
    command: source.command,
    args: source.args,
    env: ENV_VALUES,
  };
  const config = Buffer.from(JSON.stringify(inner)).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
    source.name,
  )}&config=${config}`;
}

/**
 * "Add to Cursor" one-click install button (official badge).
 *
 * Badge: https://cursor.com/deeplink/mcp-install-dark.svg (verified 200, image/svg+xml).
 * Link:  https://cursor.com/en/install-mcp?name=NAME&config=BASE64 — the web form.
 * The bare /install-mcp path 404s; /en/install-mcp 307-redirects into the
 * cursor:// deep link, so the button is clickable straight from a rendered
 * README/browser. The base64 payload is the SAME inner server object as
 * genCursorDeepLink() (command + args + env, NOT wrapped in mcpServers).
 */
function genCursorInstallButton() {
  const inner = {
    command: source.command,
    args: source.args,
    env: ENV_VALUES,
  };
  const config = Buffer.from(JSON.stringify(inner)).toString("base64");
  return `[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=${encodeURIComponent(
    source.name,
  )}&config=${encodeURIComponent(config)})`;
}

/**
 * VS Code deep link.
 *
 * Format: vscode:mcp/install?{URL_ENCODED_JSON}
 * The JSON contains name + the server object (not wrapped in `servers`), plus
 * a top-level `inputs` array: the SAME prompt mechanism `.vscode/mcp.json`
 * uses (see genVscodeInputs() above), not something the link format lacks.
 * None of VS Code's published docs pages document the install-link JSON shape
 * beyond `name`/`command` (checked docs/agents/reference/mcp-configuration,
 * docs/agent-customization/mcp-servers, and api/extension-guides/ai/mcp on
 * 2026-09-15, none mention `inputs` here). Confirmed instead by VS Code's own
 * source: `parseMcpInstallUriPayload` in
 * https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/browser/mcpWorkbenchService.ts
 * declares `interface IMcpInstallUriPayload { name; config; inputs?:
 * IMcpServerVariable[] }` and reads `inputs` off the SAME top-level JSON
 * object as `name`/`command`/`env` (`sanitizeMcpServerConfiguration` reads
 * those from that same payload; there is no nested `config` key on the
 * wire). `IMcpServerVariable` in
 * src/vs/platform/mcp/common/mcpPlatformTypes.ts is `{id, type, description,
 * password, ...}`, exactly what genVscodeInputs() already emits for
 * mcp.json. Verified against microsoft/vscode `main`, 2026-09-15. So the deep
 * link now carries the identical `${input:...}` env reference and `inputs`
 * array as the JSON snippet, instead of the literal
 * `MNEMOVERSE_API_KEY=mk_live_YOUR_KEY` sample it used to encode (#126
 * leftover, found on review 2026-09-15).
 */
function genVscodeDeepLink() {
  const inputs = genVscodeInputs();
  const inner = {
    name: source.name,
    type: source.type,
    command: source.command,
    args: source.args,
    env: genVscodeEnv(),
    ...(inputs.length ? { inputs } : {}),
  };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(inner))}`;
}

/**
 * Claude Code CLI command.
 *
 * Format: claude mcp add NAME -s user -e KEY=VAL ... -- command args...
 *
 * `-s user` is LOAD-BEARING: the CLI's default scope is `local`, which
 * registers the server for the current project directory only — memory
 * installed in one repo is silently absent in the next, the opposite of
 * cross-tool memory. The user scope registers it once for every project.
 * (History of how this shipped without the flag: git log on this function.)
 */
function genClaudeCodeCli() {
  const envFlags = Object.entries(ENV_VALUES)
    .map(([k, v]) => `  -e ${k}=${v}`)
    .join(" \\\n");
  return `claude mcp add ${source.name} -s user \\\n${envFlags} \\\n  -- ${source.command} ${source.args.join(" ")}\n`;
}

/**
 * Claude Code CLI command — single-line PowerShell variant.
 *
 * Format: claude mcp add NAME -s user -e KEY=VAL ... -- command args... (one line, no `\` continuations)
 *
 * Same command as genClaudeCodeCli(), reflowed onto one line: PowerShell
 * (the default shell on Windows) does not read the bash-style `\` line
 * continuations, so a Windows user pasting the multiline block gets a
 * parse error instead of the intended command. `-s user` remains
 * LOAD-BEARING here for the same reason as in genClaudeCodeCli() above.
 */
function genClaudeCodeCliOneLine() {
  const envFlags = Object.entries(ENV_VALUES)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  return `claude mcp add ${source.name} -s user ${envFlags} -- ${source.command} ${source.args.join(" ")}\n`;
}

// NOTE: genSmitheryYaml() was removed on 2026-04-12 after an empirical
// check showed that Smithery's current CLI (@smithery/cli 4.7.4) entirely
// ignores the legacy `startCommand` / `configSchema` / `commandFunction`
// shape and requires instead either (a) a Streamable HTTP MCP endpoint
// URL or (b) a TypeScript source tree built with their @smithery/sdk
// framework via `smithery build`. Our stdio + raw @modelcontextprotocol/sdk
// server matches neither. Shipping a fake smithery.yaml in the repo was
// misleading (suggested compatibility we don't have) and polluted the
// drift pipeline with a no-op artifact.
//
// When Phase 2 (Remote MCP server at mcp.mnemoverse.com) lands, Smithery
// publishing becomes a one-liner:
//   smithery mcp publish https://mcp.mnemoverse.com/mcp -n mnemoverse/mcp-memory-server
// No smithery.yaml file required at that point either — the CLI reads
// the endpoint directly. So we don't need to re-introduce the generator.

// ─── Markdown partials ────────────────────────────────────────────────────────
//
// These are the SAME install snippets that ship to:
//   - mcp-memory-server/README.md (assembled into the INSTALL_SNIPPETS block)
//   - mnemoverse-docs (synced via cross-repo workflow → docs/.snippets/)
//
// One channel = one partial = one place to edit (source.json). The README's
// install block is rebuilt from these partials in-place — never edit it by hand.

const PARTIAL_HEADER =
  "<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->\n\n";

function snippetClaudeCodeCli() {
  // shell command, multiline with backslash continuations, plus a one-line
  // variant for Windows: PowerShell rejects the `\` continuations, and the
  // multiline block pasted there fails with a parse error.
  return (
    "**Claude Code** — add via CLI:\n\n" +
    "```bash\n" +
    genClaudeCodeCli().trim() +
    "\n```\n\n" +
    "On Windows (PowerShell), paste the same command as one line — PowerShell does not read the `\\` line continuations:\n\n" +
    "```powershell\n" +
    genClaudeCodeCliOneLine().trim() +
    "\n```\n"
  );
}

function snippetMcpServersJson(label, configPath) {
  // Cursor / Claude Desktop / Windsurf — shared mcpServers shape
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  return (
    `**${label}** — add to \`${configPath}\`:\n\n` +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetVscode() {
  // VS Code uses `servers` (not `mcpServers`) and requires `type: "stdio"`.
  // `.vscode/mcp.json` is a project file and gets committed with the repo
  // like any other — so a literal key in it ships to every collaborator's
  // git history. Never advise that; VS Code's own `inputs` mechanism (see
  // genVscodeInputs() above) exists to avoid exactly this, prompting for the
  // secret and keeping it out of the file entirely, so the JSON below is
  // generated with that shape rather than a literal key.
  //
  // That same `inputs` mechanism is why this config (and the VS Code deep
  // link, which carries the identical `inputs` array, see genVscodeDeepLink()
  // above) does not work unattended: VS Code's own docs say it "forwards the
  // servers you configure to the Agent Host, except servers that require
  // interactive input (for example, `${input:...}` variables)"
  // (https://code.visualstudio.com/docs/agents/reference/mcp-configuration,
  // "Configuration file" section, verified 2026-09-15). There is no second,
  // input-free config to generate instead; the fix is the caveat below, not
  // a new snippet, per PR #127 review.
  const json = JSON.stringify(genVscodeFormat(), null, 2);
  return (
    "**VS Code** — the [VS Code extension](https://github.com/mnemoverse/mnemoverse-vscode) signs in through the browser and needs no key; that's the default path. In VS Code's non-interactive Agent Host mode, servers that prompt for inputs like this one are not started; for unattended use there, put the key in the environment of the process that launches VS Code instead. To wire the MCP server directly instead, add this to `.vscode/mcp.json` (note: VS Code uses `servers`, not `mcpServers`). Never put a literal `mk_live_` key in that file — it's committed with the repo. The `inputs` entry below prompts for the key instead: VS Code masks what you type and stores it in its own secret storage, not in the file:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetCursor({ utm = false } = {}) {
  // Cursor gets a one-click "Add to Cursor" button (official badge) plus the
  // manual JSON fallback. The button and the JSON encode the same config.
  // The button carries the source.json placeholder key, so the paragraph
  // below it must keep saying so — don't drop it if this function changes.
  // The placeholder text is read from source.json (sampleValue), not
  // hardcoded: if the MNEMOVERSE_API_KEY sample value ever changes, this
  // sentence must not silently drift out of sync with it.
  //
  // `utm`: this function backs both the README block (npm's install page,
  // where the CHANGELOG's "two console links carry UTM tags" policy applies
  // because npm strips referrers) and docs/snippets/cursor.md, a partial
  // mirrored as-is into mnemoverse-docs — a surface that already links
  // console.mnemoverse.com cleanly elsewhere. Keep the tag npm-only: pass
  // `utm: true` only from the README assembly below.
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  const placeholderKey = sampleValue("MNEMOVERSE_API_KEY");
  const consoleUrl = utm
    ? // /sign-up, not the root: the root redirects to /sign-in and drops the UTM tags.
      "https://console.mnemoverse.com/sign-up?utm_source=npm&utm_medium=readme&utm_campaign=mcp-memory-server"
    : "https://console.mnemoverse.com";
  return (
    "**Cursor** — click to install, or add the JSON below to `~/.cursor/mcp.json`, the global config that covers every project. Do not put it in a project-level `.cursor/mcp.json`: that file lives inside the repository and is committed with it unless you exclude it, and this config holds your key.\n\n" +
    genCursorInstallButton() +
    "\n\n" +
    `The install button carries the placeholder key \`${placeholderKey}\`, not yours, so the shortest path is to skip the button: add the JSON below to \`~/.cursor/mcp.json\`, merging it with any servers already there, and put your own key in place. Get one at [console.mnemoverse.com](${consoleUrl}). If you did click the button, edit the same key in the \`mcp.json\` it wrote; Cursor keeps MCP environment values in that file, not in a settings form. Until the key is real the server starts and lists its tools, but every tool call is refused.\n\n` +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetZed() {
  const json = JSON.stringify(genZedFormat(), null, 2);
  return (
    '**Zed** — add to `~/.config/zed/settings.json` (Zed uses `context_servers`, and `"source": "custom"` is required):\n\n' +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetJetBrains() {
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  return (
    "**JetBrains** (AI Assistant) — *Settings → Tools → AI Assistant → Model Context Protocol (MCP)*, then paste:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetCline() {
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  return (
    "**Cline** — *MCP Servers → Configure* (or edit `cline_mcp_settings.json`). Cline reads `env` values literally, so paste your real key — not a `${VAR}` reference:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

function snippetContinue() {
  return (
    "**Continue** — add `~/.continue/mcpServers/mnemoverse.yaml` (Continue uses YAML):\n\n" +
    "```yaml\n" +
    genContinueYaml() +
    "```\n"
  );
}

const WHY_LATEST_NOTE =
  "> Why `@latest`? Bare `npx @mnemoverse/mcp-memory-server` is cached indefinitely by npm and stops re-checking the registry. The `@latest` suffix forces a metadata lookup on every Claude Code / Cursor / VS Code session start (~100-300ms), so you always pick up new releases.";

/**
 * The FEATURED clients: the two this README leads with, above any fold.
 *
 * They are generated rather than hand-written for one reason. The Cursor entry
 * carries the install button AND the paragraph explaining that the button
 * writes the placeholder key `mk_live_YOUR_KEY` rather than yours. A README
 * that hand-copies the JSON above the fold and leaves the generated entry
 * below it puts the warning further from the button it warns about, and the
 * copy drifts from source.json the first time either changes.
 */
function readmeFeaturedBlock() {
  return [snippetClaudeCodeCli(), snippetCursor({ utm: true })].join("\n");
}

/**
 * Every other client, plus the @latest note. A README may fold this region
 * behind a <details> — see rewriteReadme.
 */
function readmeMoreClientsBlock() {
  return [
    snippetVscode(),
    snippetMcpServersJson("Windsurf", "~/.codeium/windsurf/mcp_config.json"),
    "**More MCP clients** — same server, different config file:\n",
    snippetZed(),
    snippetJetBrains(),
    snippetCline(),
    snippetContinue(),
    WHY_LATEST_NOTE,
  ].join("\n");
}

/**
 * Build the README install block contents (without the START/END markers).
 * The order here matches the README — change here, README rewrites itself.
 *
 * A README with only the INSTALL_SNIPPETS markers gets everything in one
 * region, byte-identical to what this function emitted before the featured
 * split existed. A README that also carries the MORE_CLIENTS markers gets the
 * two featured clients here and the rest there.
 */
function readmeInstallBlock() {
  return [readmeFeaturedBlock(), readmeMoreClientsBlock()].join("\n");
}

// ─── README in-place rewriter ─────────────────────────────────────────────────

const README_START =
  "<!-- INSTALL_SNIPPETS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->";
const README_END = "<!-- INSTALL_SNIPPETS_END -->";

// Optional second region. A README that carries these markers folds every
// non-featured client behind them (typically inside a <details>); one that
// does not keeps the single-region layout and this pair is simply absent.
const MORE_START =
  "<!-- MORE_CLIENTS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->";
const MORE_END = "<!-- MORE_CLIENTS_END -->";

/**
 * Take current README content + the freshly assembled install block and return
 * the rewritten README content. Idempotent.
 *
 * Throws if the markers are missing — that means a contributor stripped them
 * out and we don't know where to inject the snippets, so we fail loudly
 * instead of silently doing the wrong thing.
 */
function replaceRegion(text, openPrefix, openMarker, closeMarker, fresh) {
  const startIdx = text.indexOf(openPrefix);
  const endIdx = text.indexOf(closeMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `README.md is missing the ${openPrefix.replace("<!-- ", "")} / ` +
        `${closeMarker.replace("<!-- ", "").replace(" -->", "")} markers.\n` +
        "These markers tell the generator where to inject the install snippets.\n" +
        "Restore them around the install section and re-run `npm run generate:configs`.",
    );
  }
  if (startIdx >= endIdx) {
    throw new Error(
      `README.md ${closeMarker} appears before ${openPrefix.replace("<!-- ", "")}.`,
    );
  }

  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + closeMarker.length);

  return `${before}${openMarker}\n\n${fresh}\n\n${closeMarker}${after}`;
}

function rewriteReadme(currentReadme) {
  // A README that folds the long tail declares a second region. Without it,
  // everything goes in the first region and the output is unchanged from
  // before the featured/more split existed.
  //
  // Half a pair is always a mistake, and a silent one: with only the END
  // marker left behind, `folded` would be false, the second region would never
  // be rewritten, and a stale block of client snippets would sail through the
  // --check drift gate because nothing compares it to anything. Fail loudly.
  const hasMoreStart = currentReadme.includes("<!-- MORE_CLIENTS_START");
  const hasMoreEnd = currentReadme.includes(MORE_END);
  if (hasMoreStart !== hasMoreEnd) {
    throw new Error(
      "README.md carries only one of the MORE_CLIENTS_START / MORE_CLIENTS_END markers.\n" +
        `Found START: ${hasMoreStart}, END: ${hasMoreEnd}.\n` +
        "Either both are present, and the non-featured clients are generated between them,\n" +
        "or neither is, and every client is generated in the INSTALL_SNIPPETS region.",
    );
  }
  const folded = hasMoreStart;

  let out = replaceRegion(
    currentReadme,
    "<!-- INSTALL_SNIPPETS_START",
    README_START,
    README_END,
    folded ? readmeFeaturedBlock() : readmeInstallBlock(),
  );

  if (folded) {
    out = replaceRegion(
      out,
      "<!-- MORE_CLIENTS_START",
      MORE_START,
      MORE_END,
      readmeMoreClientsBlock(),
    );
  }

  return out;
}

/**
 * Official MCP Registry server.json.
 *
 * https://registry.modelcontextprotocol.io/
 * Schema: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
 *
 * The canonical shape was verified empirically by running `mcp-publisher init`
 * in a sandbox and matching its output. Key differences vs the older
 * 2025-09-29 schema: registryName → registryType, packages[0].name →
 * packages[0].identifier, new required `transport` object, dropped
 * runtimeArguments (the registry runtime builds its own launch command
 * from identifier + version), and environmentVariables entries gained a
 * `format` field.
 *
 * The `@latest` pin we use in docs/configs/* does NOT belong here — that
 * is for direct JSON-snippet installs where users stay on the bleeding
 * edge. Registry-installed clients get the exact pinned version from
 * server.json.version and we re-publish on each npm release to advance
 * them.
 */
function genServerJson() {
  // Build env vars, conditionally including `default` so absence stays absent
  // (registry schema validates types strictly — sending "default": undefined
  // in JSON is different from omitting the key).
  const environmentVariables = Object.entries(source.env).map(([key, meta]) => {
    const entry = {
      name: key,
      description: meta.description,
      isRequired: meta.required ?? false,
      format: "string",
      isSecret: meta.secret ?? false,
    };
    if (meta.placeholder) {
      // `default` is the 2025-12-11 field for an example/placeholder value
      // that clients can surface in their config UI.
      entry.default = meta.placeholder;
    }
    return entry;
  });

  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "io.github.mnemoverse/mcp-memory-server",
    // `title` is the human-friendly display label shown in registry UIs —
    // without it the UI falls back to the reverse-DNS name which is unreadable.
    title: source.title || source.displayName,
    description: source.description,
    // `websiteUrl` surfaces separately from `repository.url` in registry UIs,
    // giving a second, distinct clickthrough (landing page vs source code).
    ...(source.websiteUrl ? { websiteUrl: source.websiteUrl } : {}),
    repository: {
      url: source.metadata.repository,
      source: "github",
      // `id` is GitHub's numeric repository ID — an anti-resurrection trust
      // marker. Even if the repo is deleted and recreated at the same URL,
      // the new id would differ and clients can detect the swap.
      ...(source.metadata.repositoryId
        ? { id: String(source.metadata.repositoryId) }
        : {}),
    },
    version: PACKAGE_VERSION,
    packages: [
      {
        registryType: source.package.registry,
        identifier: source.package.name,
        version: PACKAGE_VERSION,
        transport: {
          type: "stdio",
        },
        environmentVariables,
      },
    ],
    // The hosted remote endpoint (e.g. mcp.mnemoverse.com/mcp), published
    // alongside the npm `packages` entry so registry consumers can discover the
    // one-click-OAuth path, not just the local npx install. Emitted only when
    // `source.remotes` is present; OAuth-protected remotes carry no headers.
    ...(source.remotes ? { remotes: source.remotes } : {}),
  };
}

/**
 * Claude Desktop Extension (MCPB) manifest.json.
 *
 * Spec: https://github.com/anthropics/mcpb (manifest_version 0.3). Packages the
 * local stdio server as a one-click Desktop Extension that can be submitted to
 * the Claude Connectors Directory WITHOUT a hosted remote server or OAuth.
 *
 * The API key is collected from the user via `user_config` (sensitive) and
 * injected into the server env as ${user_config.api_key} at runtime — never
 * hardcoded into the bundle. `version` is taken from package.json so the .mcpb
 * always matches the npm release; identity fields reuse source.metadata; the
 * MCPB-specific extras (privacy policy, user_config, icon, compatibility) live
 * under source.mcpb. `tools` comes from tools.json (see TOOLS_MANIFEST above):
 * the MCPB shape is `{name, description}` per tool, so the other fields the
 * artifact carries (title, annotations) are dropped here, not restated.
 */
function genMcpbManifest() {
  const m = source.mcpb;
  const tools = TOOLS_MANIFEST.tools.map(({ name, description }) => ({
    name,
    description,
  }));
  return {
    manifest_version: "0.3",
    name: m.name,
    display_name: source.displayName,
    version: PACKAGE_VERSION,
    description: source.description,
    long_description: m.longDescription,
    // The MCPB directory submission requires `author` to point at a GitHub
    // profile — so this comes from source.mcpb.author (a github.com URL), not
    // the marketing websiteUrl.
    author: m.author,
    repository: {
      type: "git",
      url: `${source.metadata.repository}.git`,
    },
    homepage: source.metadata.homepage,
    documentation: source.metadata.homepage,
    support: `${source.metadata.repository}/issues`,
    icon: m.icon,
    license: source.metadata.license,
    keywords: source.metadata.tags,
    // Required for MCPB directory review — "missing or incomplete privacy
    // policies result in immediate rejection".
    privacy_policies: m.privacyPolicies,
    server: {
      type: "node",
      entry_point: "dist/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/dist/index.js"],
        env: {
          MNEMOVERSE_API_KEY: "${user_config.api_key}",
        },
      },
    },
    tools,
    user_config: m.userConfig,
    compatibility: {
      claude_desktop: m.compatibility.claudeDesktop,
      platforms: m.compatibility.platforms,
      runtimes: {
        node: m.compatibility.node,
      },
    },
  };
}

// ─── Output ──────────────────────────────────────────────────────────────────

const OUTPUTS = [
  {
    path: "docs/configs/cursor.json",
    content: JSON.stringify(genMcpServersFormat(), null, 2) + "\n",
  },
  {
    path: "docs/configs/claude-desktop.json",
    content: JSON.stringify(genMcpServersFormat(), null, 2) + "\n",
  },
  {
    path: "docs/configs/windsurf.json",
    content: JSON.stringify(genMcpServersFormat(), null, 2) + "\n",
  },
  {
    path: "docs/configs/vscode.json",
    content: JSON.stringify(genVscodeFormat(), null, 2) + "\n",
  },
  {
    path: "docs/configs/cursor-deep-link.txt",
    content: genCursorDeepLink() + "\n",
  },
  {
    path: "docs/configs/vscode-deep-link.txt",
    content: genVscodeDeepLink() + "\n",
  },
  {
    path: "docs/configs/claude-code-cli.sh",
    content: "#!/usr/bin/env bash\n" + genClaudeCodeCli(),
  },
  {
    path: "server.json",
    content: JSON.stringify(genServerJson(), null, 2) + "\n",
  },
  {
    // Claude Desktop Extension manifest — see genMcpbManifest() above.
    path: "manifest.json",
    // null only on a first build without tools.json (see TOOLS_MANIFEST above):
    // the file is then left as it is and postbuild regenerates it.
    content: TOOLS_MANIFEST ? JSON.stringify(genMcpbManifest(), null, 2) + "\n" : null,
  },
  // ─── Markdown partials (consumed by README + mnemoverse-docs) ──────────────
  {
    path: "docs/snippets/claude-code.md",
    content: PARTIAL_HEADER + snippetClaudeCodeCli(),
  },
  {
    path: "docs/snippets/cursor.md",
    content: PARTIAL_HEADER + snippetCursor(),
  },
  {
    path: "docs/snippets/claude-desktop.md",
    content:
      PARTIAL_HEADER +
      snippetMcpServersJson("Claude Desktop", "claude_desktop_config.json"),
  },
  {
    path: "docs/snippets/vscode.md",
    content: PARTIAL_HEADER + snippetVscode(),
  },
  {
    path: "docs/snippets/windsurf.md",
    content:
      PARTIAL_HEADER +
      snippetMcpServersJson(
        "Windsurf",
        "~/.codeium/windsurf/mcp_config.json",
      ),
  },
  {
    path: "docs/snippets/zed.md",
    content: PARTIAL_HEADER + snippetZed(),
  },
  {
    path: "docs/snippets/jetbrains.md",
    content: PARTIAL_HEADER + snippetJetBrains(),
  },
  {
    path: "docs/snippets/cline.md",
    content: PARTIAL_HEADER + snippetCline(),
  },
  {
    path: "docs/snippets/continue.md",
    content: PARTIAL_HEADER + snippetContinue(),
  },
];

// ─── Write files ─────────────────────────────────────────────────────────────

const checkMode = process.argv.includes("--check");

let written = 0;
let unchanged = 0;

for (const { path, content } of OUTPUTS) {
  if (content === null) continue;
  const fullPath = resolve(ROOT, path);
  mkdirSync(dirname(fullPath), { recursive: true });

  const existing = existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
  if (existing === content) {
    unchanged++;
    continue;
  }

  if (checkMode) {
    console.error(`✗ Drift detected: ${path}`);
    console.error("  Expected (regenerated):");
    console.error("  " + content.slice(0, 200).split("\n").join("\n  "));
    console.error("  Got (committed):");
    console.error("  " + existing.slice(0, 200).split("\n").join("\n  "));
    process.exit(1);
  }

  writeFileSync(fullPath, content, "utf8");
  console.log(`✓ Generated ${path}`);
  written++;
}

// ─── README install block (in-place rewrite) ────────────────────────────────
//
// Special-cased because README is read-modify-write — we can only update the
// region between the INSTALL_SNIPPETS markers, the rest of the file is human-
// authored prose.

const README_PATH = resolve(ROOT, "README.md");

if (!existsSync(README_PATH)) {
  console.error(`✗ README.md not found at ${README_PATH}`);
  process.exit(1);
}

const currentReadme = readFileSync(README_PATH, "utf8");
let freshReadme;
try {
  freshReadme = rewriteReadme(currentReadme);
} catch (err) {
  console.error("✗ Cannot rewrite README.md install block:");
  console.error("  " + (err.message || err).split("\n").join("\n  "));
  process.exit(1);
}

if (currentReadme === freshReadme) {
  unchanged++;
} else if (checkMode) {
  console.error("✗ Drift detected: README.md install block is stale");
  console.error(
    "  A generated region in README.md (INSTALL_SNIPPETS, and MORE_CLIENTS",
  );
  console.error(
    "  if present) does not match",
  );
  console.error(
    "  what the generator would emit from src/configs/source.json.",
  );
  console.error("  Run `npm run generate:configs` and commit the result.");
  process.exit(1);
} else {
  writeFileSync(README_PATH, freshReadme, "utf8");
  console.log("✓ Generated README.md (install block)");
  written++;
}

const totalArtifacts = OUTPUTS.length + 1; // +1 for README

if (checkMode) {
  console.log(
    `✓ All ${totalArtifacts} artifacts in sync with source.json`,
  );
} else {
  console.log(
    `\nDone: ${written} written, ${unchanged} unchanged (${totalArtifacts} total)`,
  );
}
