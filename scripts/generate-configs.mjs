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
 *         README.md install regions (keyless first, then the API-key ones)
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
 * The hosted server's URL: the streamable-http entry of source.remotes, the
 * same endpoint server.json publishes to the registry. OAuth-protected, so a
 * config that points at it carries no key and no headers; the client runs
 * the sign-in itself.
 */
function hostedMcpUrl() {
  const remote = (source.remotes ?? []).find((r) => r.type === "streamable-http");
  if (!remote?.url) {
    throw new Error(
      "source.json has no streamable-http entry in `remotes`: the Cursor install links add the hosted server and need its URL",
    );
  }
  return remote.url;
}

/**
 * The keyless entry for a client that only starts local (stdio) commands:
 * source.bridge (the mcp-remote package) with the hosted URL appended. The
 * bridge runs the hosted server's browser sign-in itself, so the entry holds
 * no key and no env. Verified live 2026-10-23 (see $comment_bridge in
 * source.json).
 */
function bridgeServer() {
  const bridge = source.bridge;
  if (!bridge?.command || !Array.isArray(bridge.args) || bridge.args.length === 0) {
    throw new Error(
      "source.json has no `bridge` {command, args}: the keyless entries for stdio-only clients need the mcp-remote command",
    );
  }
  return { command: bridge.command, args: [...bridge.args, hostedMcpUrl()] };
}

/** The bridge in the shared `mcpServers` shape (Claude Desktop, Devin Desktop, JetBrains, any stdio client). */
function genBridgeMcpServersFormat() {
  return { mcpServers: { [source.name]: bridgeServer() } };
}

/** The bridge in Zed's `context_servers` shape, with the same `"source": "custom"` as genZedFormat(). */
function genBridgeZedFormat() {
  return {
    context_servers: {
      [source.name]: { source: "custom", ...bridgeServer() },
    },
  };
}

/** A link to the bridge package's npm page, for prose that names it. */
function bridgeLink() {
  const pkg = source.bridge.package;
  return `[\`${pkg}\`](https://www.npmjs.com/package/${pkg})`;
}

/**
 * The `config` value of every Cursor install link: base64 of
 * {"url": <hosted server>} and nothing else, the payload mnemoverse-portal's
 * console button carries (src/lib/editor-install.ts, CURSOR_INSTALL_URL,
 * portal#290). Cursor writes it as {"mnemoverse": {"url": ...}} into
 * ~/.cursor/mcp.json, and the user signs in from Cursor's MCP settings
 * (Connect), so no key is ever written and none can be a placeholder.
 *
 * It used to be the local stdio server with
 * MNEMOVERSE_API_KEY=mk_live_YOUR_KEY: one click installed a server that
 * listed its tools and refused every call until the reader replaced the key
 * by hand (core#623, item 2).
 *
 * Written into the query string literally, as the portal does. That is only
 * safe while the base64 holds no `+` (a query-string reader turns it into a
 * space) and no `/`, so a URL change that produces either fails here rather
 * than shipping a button that silently installs nothing.
 */
function cursorHostedConfig() {
  const config = Buffer.from(JSON.stringify({ url: hostedMcpUrl() })).toString("base64");
  if (/[+/]/.test(config)) {
    throw new Error(
      `base64 of the hosted Cursor config contains '+' or '/' (${config}); percent-encode it in the Cursor install links before shipping them`,
    );
  }
  return config;
}

/**
 * Cursor deep link, for the hosted server.
 *
 * Format: cursor://anysphere.cursor-deeplink/mcp/install?name=NAME&config=BASE64
 * The base64 payload is the inner server object (NOT wrapped in mcpServers):
 * here {"url": ...}, see cursorHostedConfig() above.
 */
function genCursorDeepLink() {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
    source.name,
  )}&config=${cursorHostedConfig()}`;
}

/**
 * "Add to Cursor" one-click install button (official badge), for the hosted
 * server with a browser sign-in. Built exactly like mnemoverse-portal's
 * CURSOR_INSTALL_URL: same path, same name, same literal base64.
 *
 * Badge: https://cursor.com/deeplink/mcp-install-dark.svg (200, image/svg+xml).
 * Link:  https://cursor.com/install-mcp?name=NAME&config=BASE64, Cursor's web
 * page that hands off to its own MCP install. Checked 2026-10-14: this path
 * answers 200, and /en/install-mcp answers 308 to it (the opposite of
 * 2026-09, when the comment here said the bare path 404s).
 */
function genCursorInstallButton() {
  return `[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=${encodeURIComponent(
    source.name,
  )}&config=${cursorHostedConfig()})`;
}

/**
 * The OLD "Add to Cursor" button: the local stdio server with the
 * source.json placeholder key. It survives for ONE consumer only,
 * docs/snippets/cursor.md, which mnemoverse-docs mirrors at build time into
 * the API-key section of mnemoverse.com/docs/api/cursor. That page's own
 * prose describes this button as the one that installs the local server
 * with the placeholder, and its docs:build fails a clean-tree gate the
 * moment the mirrored partial changes upstream. So the partial changes
 * together with a docs PR, not before it; the README no longer uses this.
 * When that docs PR lands, delete this function and point
 * snippetCursorDocsPartial() at genCursorInstallButton() or at no button.
 */
function genCursorLocalInstallButton() {
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
 * Claude Code CLI command for the hosted server: browser sign-in, no key, no
 * Node.js. One line, so the same text runs in bash and in PowerShell.
 *
 * Format: claude mcp add --scope user --transport http NAME URL
 *
 * `--scope user` is LOAD-BEARING for the same reason as in
 * genClaudeCodeCli() below: without it the server lands in local scope, for
 * the current directory only. In the 2026-10-18 rehearsal an agent asked to
 * set up the memory first added it without the flag.
 */
function genClaudeCodeHostedCli() {
  return `claude mcp add --scope user --transport http ${source.name} ${hostedMcpUrl()}\n`;
}

/**
 * Claude Code CLI command, local server with an API key.
 *
 * Format: claude mcp add NAME --scope user -e KEY=VAL ... -- command args...
 *
 * `--scope user` is LOAD-BEARING: the CLI's default scope is `local`, which
 * registers the server for the current project directory only — memory
 * installed in one repo is silently absent in the next, the opposite of
 * cross-tool memory. The user scope registers it once for every project.
 * (History of how this shipped without the flag: git log on this function.)
 *
 * The long form, not `-s user`: the same flag (`claude mcp add --help` in
 * Claude Code 2.1.302 lists `-s, --scope <scope>`), but the hosted command
 * above and every hand-written page on mnemoverse.com/docs (docs#756,
 * 2026-10-21) spell it `--scope user`, and a reader comparing two commands
 * should not have to know that the two spellings are one flag.
 */
function genClaudeCodeCli() {
  const envFlags = Object.entries(ENV_VALUES)
    .map(([k, v]) => `  -e ${k}=${v}`)
    .join(" \\\n");
  return `claude mcp add ${source.name} --scope user \\\n${envFlags} \\\n  -- ${source.command} ${source.args.join(" ")}\n`;
}

/**
 * Claude Code CLI command — single-line PowerShell variant.
 *
 * Format: claude mcp add NAME --scope user -e KEY=VAL ... -- command args... (one line, no `\` continuations)
 *
 * Same command as genClaudeCodeCli(), reflowed onto one line: PowerShell
 * (the default shell on Windows) does not read the bash-style `\` line
 * continuations, so a Windows user pasting the multiline block gets a
 * parse error instead of the intended command. `--scope user` remains
 * LOAD-BEARING here for the same reason as in genClaudeCodeCli() above.
 */
function genClaudeCodeCliOneLine() {
  const envFlags = Object.entries(ENV_VALUES)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(" ");
  return `claude mcp add ${source.name} --scope user ${envFlags} -- ${source.command} ${source.args.join(" ")}\n`;
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
//   - mcp-memory-server/README.md (assembled into its three generated regions)
//   - mnemoverse-docs (scripts/sync-mcp-snippets.mjs there fetches five of
//     them at build time into docs/.mcp-snippets/)
//
// Two partials per client, one per path. `<client>-hosted.md` is the keyless
// path: the hosted server with a browser sign-in, natively where the client
// adds a remote URL, through the mcp-remote bridge where it only starts local
// commands. `<client>.md` is the local package with an API key.
//
// The five `<client>.md` partials mnemoverse-docs mirrors (claude-code,
// claude-desktop, cursor, vscode, windsurf) sit in the API-key sections of its
// pages, below keyless sections those pages write themselves, and its
// docs:build fails a clean-tree gate the moment a mirrored partial changes
// upstream. So the keyless-first restructure (2026-10-23) leaves those five
// byte for byte as they were and adds the `-hosted` partials beside them.
//
// One channel = one partial = one place to edit (source.json). The README's
// install regions are rebuilt from these partials in-place — never edit them
// by hand.

const PARTIAL_HEADER =
  "<!-- AUTO-GENERATED from src/configs/source.json. Run `npm run generate:configs`. Do not edit by hand. -->\n\n";

/**
 * Claude Code, hosted server first. The local-key command used to be the only
 * Claude Code block here, and an agent told to "set up Mnemoverse memory"
 * took it (and the directory listings copied from it), then asked for Node.js
 * and a key that the hosted path needs neither of (rehearsal, 2026-10-18).
 *
 * The restart sentence is from the same run: a server added by `claude mcp
 * add` from inside a session is not in that session's `/mcp` until Claude
 * Code starts again.
 */
function snippetClaudeCodeHosted() {
  return (
    "**Claude Code** — the hosted server, with a browser sign-in. No API key, nothing to install:\n\n" +
    "```bash\n" +
    genClaudeCodeHostedCli().trim() +
    "\n```\n\n" +
    `Then start Claude Code, run \`/mcp\`, select \`${source.name}\` and choose **Authenticate**. ` +
    "If the command ran inside a Claude Code session (yours, or Claude ran it for you), that session does not load the new server: exit and start `claude` again first.\n"
  );
}

function snippetClaudeCodeCli(label = "**Claude Code** — add via CLI:") {
  // shell command, multiline with backslash continuations, plus a one-line
  // variant for Windows: PowerShell rejects the `\` continuations, and the
  // multiline block pasted there fails with a parse error.
  // docs/snippets/claude-code.md keeps the default label: mnemoverse-docs
  // mirrors that partial into the API-key section of its Claude Code page.
  return (
    label +
    "\n\n" +
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
  // Cursor / Claude Desktop / Devin Desktop (ex-Windsurf) — shared mcpServers shape
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

/**
 * Cursor, keyless: the one-click button adds the HOSTED server, whose sign-in
 * Cursor runs itself. No JSON block on purpose: the sentence under the button
 * names the one-line entry it writes, and the first `mcpServers` block of the
 * README (which directory scrapers copy as "the config") is the bridge entry
 * of snippetAnyClientHosted(), which works in every client that starts local
 * commands, rather than a `url` entry that a config-file-only client ignores.
 */
function snippetCursorHosted() {
  return (
    "**Cursor** — click to add the hosted server. Cursor signs you in through the browser, so there is no key to paste:\n\n" +
    genCursorInstallButton() +
    "\n\n" +
    `The button writes \`{"url": "${hostedMcpUrl()}"}\` under \`${source.name}\` in \`~/.cursor/mcp.json\`, the global config that covers every project. Then click **Connect** next to \`${source.name}\` in Cursor's MCP settings (**Customize** in the sidebar; **Cursor Settings → Tools & MCPs** in Cursor 3.21.16) and approve in the browser. Cursor runs the sign-in and keeps the token itself.\n`
  );
}

/**
 * Cursor, the README's API-key entry: the JSON only, no install button (the
 * old placeholder button survives in docs/snippets/cursor.md alone, see
 * genCursorLocalInstallButton()).
 *
 * The placeholder named in the prose is read from source.json (sampleValue),
 * not hardcoded, so it cannot drift from the JSON it describes.
 */
function snippetCursorKeyReadme() {
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  const placeholderKey = sampleValue("MNEMOVERSE_API_KEY");
  return (
    `**Cursor** — add the JSON below to \`~/.cursor/mcp.json\`, the global config that covers every project, merging it with any servers already there, and put your own key in place of \`${placeholderKey}\`. Do not put it in a project-level \`.cursor/mcp.json\`: that file lives inside the repository and is committed with it unless you exclude it, and this config holds your key.\n\n` +
    "```json\n" +
    json +
    "\n```\n"
  );
}

/**
 * Any MCP client, keyless. Two sentences for the two kinds of client, and the
 * bridge entry as JSON. This is the README's first `mcpServers` block, the one
 * npm, GitHub and the directory scrapers copy (packaging lane, 2026-10-23), so
 * it is the entry that works with no key in any client that starts a local
 * command.
 *
 * The ~/.mcp-auth sentence is mcp-remote's own troubleshooting advice (its
 * README, "Clear your ~/.mcp-auth directory"), read 2026-10-23.
 */
function snippetAnyClientHosted() {
  const json = JSON.stringify(genBridgeMcpServersFormat(), null, 2);
  return (
    `**Any MCP client** — a client that adds a remote server by URL takes \`${hostedMcpUrl()}\` and runs the browser sign-in itself. A client that only starts local commands takes the entry below: ${bridgeLink()}, a separate open-source bridge, runs through \`npx\` (Node.js 18 or later), forwards to the same URL and opens the same browser sign-in on first start. Neither way needs a key:\n\n` +
    "```json\n" +
    json +
    "\n```\n\n" +
    `The bridge keeps its sign-ins in \`~/.mcp-auth\`. If a sign-in gets stuck, its README says to delete that folder and restart the client.\n`
  );
}

/**
 * VS Code, keyless: the extension, or the hosted server as an `http` entry in
 * `.vscode/mcp.json`. The `http` entry and its browser sign-in are the shape
 * mnemoverse-docs /api/vs-code records as verified on VS Code Desktop. The
 * entry holds no key, so unlike the API-key entry it may be committed.
 */
function snippetVscodeHosted() {
  const json = JSON.stringify(
    { servers: { [source.name]: { type: "http", url: hostedMcpUrl() } } },
    null,
    2,
  );
  return (
    "**VS Code** — the [VS Code extension](https://github.com/mnemoverse/mnemoverse-vscode) signs in through the browser, with no key to paste: install it and run **Mnemoverse: Sign In**. Without the extension, add the hosted server to `.vscode/mcp.json` (VS Code 1.102 or later; VS Code uses `servers`, not `mcpServers`). VS Code opens the browser sign-in on first use, and the entry holds no key, so the file is safe to commit:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

/**
 * VS Code, the README's API-key entry. Same JSON as snippetVscode() (the
 * `inputs` prompt, see genVscodeInputs()), shorter prose: the extension is
 * already the first sentence of the keyless entry. snippetVscode() keeps its
 * own wording because mnemoverse-docs mirrors docs/snippets/vscode.md.
 */
function snippetVscodeKeyReadme() {
  const json = JSON.stringify(genVscodeFormat(), null, 2);
  return (
    "**VS Code** — add to `.vscode/mcp.json` (VS Code uses `servers`, not `mcpServers`). Never put a literal `mk_live_` key in that file: it is committed with the repository. The `inputs` entry below prompts for the key instead; VS Code masks what you type and keeps it in its own secret storage, not in the file. VS Code's non-interactive Agent Host mode does not start servers that prompt for inputs; for unattended use there, put the key in the environment of the process that launches VS Code:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

/**
 * Claude Desktop, keyless: a custom connector (no file, no Node.js), or the
 * bridge in claude_desktop_config.json. Steps and the free-plan limit as
 * mnemoverse-docs /api/claude-apps and /api/install-by-host state them, from
 * Anthropic's custom-connector guide.
 */
function snippetClaudeDesktopHosted() {
  const json = JSON.stringify(genBridgeMcpServersFormat(), null, 2);
  return (
    `**Claude Desktop** — add the hosted server as a custom connector: **Customize → Connectors**, then **+** and **Add custom connector**, paste \`${hostedMcpUrl()}\` and sign in when the browser opens. The connector also works on claude.ai and in the Claude mobile apps; free Claude plans allow one custom connector. To use \`claude_desktop_config.json\` instead, add the bridge and restart Claude Desktop; the bridge opens the same browser sign-in:\n\n` +
    "```json\n" +
    json +
    "\n```\n"
  );
}

/**
 * Cline, keyless: its own remote-server entry and sign-in. Steps, the JSON
 * shape and the `streamableHttp` note as mnemoverse-docs /api/install-by-host
 * records them (Cline's MCP overview and source at v4.1.25, read 2026-10-21;
 * sign-in verified by replay against production on 2026-10-18).
 */
function snippetClineHosted() {
  const json = JSON.stringify(
    { mcpServers: { [source.name]: { type: "streamableHttp", url: hostedMcpUrl() } } },
    null,
    2,
  );
  return (
    `**Cline** — in the Cline panel, open **MCP Servers**, then the **Remote Servers** tab. Enter \`${source.name}\` as the server name and \`${hostedMcpUrl()}\` as the URL, choose **Streamable HTTP**, click **Add Server**, then click **Authenticate** on the server's row and sign in in the browser. The same entry by hand, in \`cline_mcp_settings.json\`:\n\n` +
    "```json\n" +
    json +
    "\n```\n\n" +
    'Keep `"type": "streamableHttp"`: without it Cline uses the older SSE transport.\n'
  );
}

/**
 * Devin Desktop (formerly Windsurf), keyless: the bridge. Devin documents a
 * plain `url` entry with its own sign-in, but mnemoverse-docs /api/windsurf
 * records that sign-in as not verified against Mnemoverse, and the bridge is.
 */
function snippetDevinHosted() {
  const json = JSON.stringify(genBridgeMcpServersFormat(), null, 2);
  return (
    "**Devin Desktop (formerly Windsurf)** — add the bridge to `~/.config/devin/mcp_config.json` (`%APPDATA%\\devin\\mcp_config.json` on Windows) and restart Devin Desktop; the bridge opens the browser sign-in on first start:\n\n" +
    "```json\n" +
    json +
    "\n```\n\n" +
    'Devin also documents a remote entry with only `"url"` and its own sign-in; that sign-in has not been tested with Mnemoverse yet.\n'
  );
}

/**
 * Zed, keyless: the bridge. Zed's docs (docs/src/ai/mcp.md on main, read
 * 2026-10-23) also describe a remote entry with only `url`, for which Zed runs
 * the MCP OAuth flow itself; nobody has run that against Mnemoverse, so it is
 * named as untested rather than offered as the path.
 */
function snippetZedHosted() {
  const json = JSON.stringify(genBridgeZedFormat(), null, 2);
  return (
    "**Zed** — add the bridge to `~/.config/zed/settings.json` (Zed uses `context_servers`); it opens the browser sign-in on first start:\n\n" +
    "```json\n" +
    json +
    "\n```\n\n" +
    `Zed also accepts the URL itself (\`"url": "${hostedMcpUrl()}"\`) and runs its own sign-in; that route has not been tested with Mnemoverse yet.\n`
  );
}

/**
 * JetBrains AI Assistant, keyless: the bridge. Its MCP page (read 2026-10-23)
 * documents a `url` entry for Streamable HTTP and says nothing about a sign-in
 * for one, so the browser sign-in comes from the bridge.
 */
function snippetJetBrainsHosted() {
  const json = JSON.stringify(genBridgeMcpServersFormat(), null, 2);
  return (
    "**JetBrains** (AI Assistant) — *Settings → Tools → AI Assistant → Model Context Protocol (MCP)*, then paste the bridge; it opens the browser sign-in on first start:\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

/**
 * docs/snippets/cursor.md, mirrored as-is into mnemoverse-docs. Unchanged,
 * byte for byte, by the switch of the README button to the hosted server:
 * see genCursorLocalInstallButton() for why this partial waits for a docs PR.
 * No UTM tags here: the docs site links console.mnemoverse.com cleanly
 * elsewhere.
 */
function snippetCursorDocsPartial() {
  const json = JSON.stringify(genMcpServersFormat(), null, 2);
  const placeholderKey = sampleValue("MNEMOVERSE_API_KEY");
  const consoleUrl = "https://console.mnemoverse.com";
  return (
    "**Cursor** — click to install, or add the JSON below to `~/.cursor/mcp.json`, the global config that covers every project. Do not put it in a project-level `.cursor/mcp.json`: that file lives inside the repository and is committed with it unless you exclude it, and this config holds your key.\n\n" +
    genCursorLocalInstallButton() +
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

const WHY_LATEST_NOTE =
  "> Why `@latest`? Bare `npx @mnemoverse/mcp-memory-server` is cached indefinitely by npm and stops re-checking the registry. The `@latest` suffix forces a metadata lookup on every Claude Code / Cursor / VS Code session start (~100-300ms), so you always pick up new releases.";

/**
 * README region 1, INSTALL_SNIPPETS: the keyless path for the two featured
 * clients, then the keyless rule for any client, above any fold.
 *
 * Keyless first for every client, and the API key in a section of its own
 * (packaging lane, room atom 1865727c, 2026-10-23): the README used to go from
 * a short no-key block straight to "Get a free API key", and showed Claude
 * Desktop, Devin Desktop, Zed, JetBrains and Cline only with
 * MNEMOVERSE_API_KEY. npm, GitHub and the directories that copy the first
 * `mcpServers` block all passed that on. The first `mcpServers` block is now
 * snippetAnyClientHosted()'s bridge entry, which carries no key.
 *
 * Generated rather than hand-written: the Cursor entry carries the install
 * button, built from source.json's hosted endpoint, and a hand-typed base64
 * blob is unreadable in review.
 */
function readmeHostedFeaturedBlock() {
  return [snippetClaudeCodeHosted(), snippetCursorHosted(), snippetAnyClientHosted()].join("\n");
}

/** README region 2, MORE_CLIENTS: the keyless path for every other client. */
function readmeHostedMoreBlock() {
  return [
    snippetVscodeHosted(),
    snippetClaudeDesktopHosted(),
    snippetClineHosted(),
    snippetDevinHosted(),
    snippetZedHosted(),
    snippetJetBrainsHosted(),
  ].join("\n");
}

/**
 * README region 3, LOCAL_KEY_SNIPPETS: the local package with an API key, for
 * the same clients in the same order, plus the @latest note. The Claude
 * Desktop, Devin Desktop, Zed, JetBrains and Cline entries are the very
 * functions their docs/snippets/<client>.md partials use.
 */
function readmeLocalKeyBlock() {
  const placeholderKey = sampleValue("MNEMOVERSE_API_KEY");
  return [
    snippetClaudeCodeCli(`**Claude Code** — put your own key in place of \`${placeholderKey}\`:`),
    snippetCursorKeyReadme(),
    snippetVscodeKeyReadme(),
    snippetMcpServersJson("Claude Desktop", "claude_desktop_config.json"),
    snippetCline(),
    snippetMcpServersJson("Devin Desktop (formerly Windsurf)", "~/.config/devin/mcp_config.json"),
    snippetZed(),
    snippetJetBrains(),
    WHY_LATEST_NOTE,
  ].join("\n");
}

// ─── README in-place rewriter ─────────────────────────────────────────────────

/**
 * The README's generated regions, in the order they must appear. Every one is
 * required: a README that lost a marker pair has no place for that content,
 * and a region left behind without its generator would sail through the
 * --check drift gate because nothing compares it to anything.
 */
const README_REGIONS = [
  { name: "INSTALL_SNIPPETS", build: readmeHostedFeaturedBlock },
  { name: "MORE_CLIENTS", build: readmeHostedMoreBlock },
  { name: "LOCAL_KEY_SNIPPETS", build: readmeLocalKeyBlock },
];

const regionStart = (name) =>
  `<!-- ${name}_START — generated from src/configs/source.json. Run \`npm run generate:configs\` to refresh. Do not edit by hand. -->`;
const regionEnd = (name) => `<!-- ${name}_END -->`;

/**
 * Replace one region of `text`, searching from `from`. Returns the new text
 * and the index just past the region's end marker, so the next region can be
 * required to come after it.
 *
 * Throws if a marker is missing or out of order: that means a contributor
 * stripped or moved one and we don't know where to inject the snippets, so we
 * fail loudly instead of silently doing the wrong thing.
 */
function replaceRegion(text, from, name, fresh) {
  const openPrefix = `<!-- ${name}_START`;
  const closeMarker = regionEnd(name);
  const startIdx = text.indexOf(openPrefix);
  const endIdx = text.indexOf(closeMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `README.md is missing the ${name}_START / ${name}_END markers ` +
        `(found START: ${startIdx !== -1}, END: ${endIdx !== -1}).\n` +
        "These markers tell the generator where to inject the install snippets.\n" +
        "Restore them and re-run `npm run generate:configs`.",
    );
  }
  if (startIdx >= endIdx) {
    throw new Error(`README.md ${closeMarker} appears before ${openPrefix}.`);
  }
  if (startIdx < from) {
    throw new Error(
      `README.md ${openPrefix} appears before the end of the region above it; ` +
        `the regions go in this order: ${README_REGIONS.map((r) => r.name).join(", ")}.`,
    );
  }

  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + closeMarker.length);
  const region = `${regionStart(name)}\n\n${fresh}\n\n${closeMarker}`;

  return { text: `${before}${region}${after}`, next: before.length + region.length };
}

/**
 * Take the current README and return it with every generated region rebuilt.
 * Idempotent.
 */
function rewriteReadme(currentReadme) {
  let text = currentReadme;
  let from = 0;
  for (const { name, build } of README_REGIONS) {
    ({ text, next: from } = replaceRegion(text, from, name, build()));
  }
  return text;
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
      // A secret's placeholder shows the shape of a key and works nowhere, so
      // it goes in `placeholder`. The 2025-12-11 schema keeps `default` for
      // "a valid value for the input" and sends examples to `placeholder`; a
      // client that pre-fills `default` would write mk_live_xxx…, which the
      // API refuses as placeholder_key. A non-secret placeholder here is the
      // real default (MNEMOVERSE_API_URL), so it stays `default`.
      if (meta.secret) entry.placeholder = meta.placeholder;
      else entry.default = meta.placeholder;
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
    // The registry line names the hosted URL as the no-key path; this bundle
    // is the local server and asks for a key, so it keeps its own line.
    description: m.description ?? source.description,
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
    path: "docs/snippets/claude-code-hosted.md",
    content: PARTIAL_HEADER + snippetClaudeCodeHosted(),
  },
  {
    path: "docs/snippets/claude-code.md",
    content: PARTIAL_HEADER + snippetClaudeCodeCli(),
  },
  {
    path: "docs/snippets/cursor.md",
    content: PARTIAL_HEADER + snippetCursorDocsPartial(),
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
        "Devin Desktop (formerly Windsurf)",
        "~/.config/devin/mcp_config.json",
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
  // ─── Keyless partials: the hosted server, natively or through the bridge ──
  {
    path: "docs/snippets/cursor-hosted.md",
    content: PARTIAL_HEADER + snippetCursorHosted(),
  },
  {
    path: "docs/snippets/vscode-hosted.md",
    content: PARTIAL_HEADER + snippetVscodeHosted(),
  },
  {
    path: "docs/snippets/claude-desktop-hosted.md",
    content: PARTIAL_HEADER + snippetClaudeDesktopHosted(),
  },
  {
    path: "docs/snippets/cline-hosted.md",
    content: PARTIAL_HEADER + snippetClineHosted(),
  },
  {
    path: "docs/snippets/windsurf-hosted.md",
    content: PARTIAL_HEADER + snippetDevinHosted(),
  },
  {
    path: "docs/snippets/zed-hosted.md",
    content: PARTIAL_HEADER + snippetZedHosted(),
  },
  {
    path: "docs/snippets/jetbrains-hosted.md",
    content: PARTIAL_HEADER + snippetJetBrainsHosted(),
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

// ─── README install regions (in-place rewrite) ──────────────────────────────
//
// Special-cased because README is read-modify-write — we can only update the
// regions between the README_REGIONS markers, the rest of the file is human-
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
  console.error("✗ Cannot rewrite README.md install regions:");
  console.error("  " + (err.message || err).split("\n").join("\n  "));
  process.exit(1);
}

if (currentReadme === freshReadme) {
  unchanged++;
} else if (checkMode) {
  console.error("✗ Drift detected: README.md install regions are stale");
  console.error(
    `  A generated region in README.md (${README_REGIONS.map((r) => r.name).join(", ")})`,
  );
  console.error(
    "  does not match what the generator would emit from src/configs/source.json.",
  );
  console.error("  Run `npm run generate:configs` and commit the result.");
  process.exit(1);
} else {
  writeFileSync(README_PATH, freshReadme, "utf8");
  console.log("✓ Generated README.md (install regions)");
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
