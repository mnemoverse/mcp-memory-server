#!/usr/bin/env node
/**
 * generate-configs.mjs
 *
 * Single source of truth → all distribution channel configs.
 *
 * Reads: src/configs/source.json
 * Writes: docs/configs/*, docs/snippets/*, server.json, README.md install block
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

// Helper: extract { KEY: "value" } from source.env (which has nested {value, description, ...})
function envValues(envObj) {
  const result = {};
  for (const [key, meta] of Object.entries(envObj)) {
    result[key] = meta.value;
  }
  return result;
}

const ENV_VALUES = envValues(source.env);

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
 * VS Code (Copilot Chat) format — uses `servers` key (not `mcpServers`).
 */
function genVscodeFormat() {
  return {
    servers: {
      [source.name]: {
        type: source.type,
        command: source.command,
        args: source.args,
        env: ENV_VALUES,
      },
    },
  };
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
 * VS Code deep link.
 *
 * Format: vscode:mcp/install?{URL_ENCODED_JSON}
 * The JSON contains name + the server object (not wrapped in `servers`).
 */
function genVscodeDeepLink() {
  const inner = {
    name: source.name,
    type: source.type,
    command: source.command,
    args: source.args,
    env: ENV_VALUES,
  };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(inner))}`;
}

/**
 * Claude Code CLI command.
 *
 * Format: claude mcp add NAME -e KEY=VAL ... -- command args...
 */
function genClaudeCodeCli() {
  const envFlags = Object.entries(ENV_VALUES)
    .map(([k, v]) => `  -e ${k}=${v}`)
    .join(" \\\n");
  return `claude mcp add ${source.name} \\\n${envFlags} \\\n  -- ${source.command} ${source.args.join(" ")}\n`;
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
  // shell command, multiline with backslash continuations
  return (
    "**Claude Code** — add via CLI:\n\n" +
    "```bash\n" +
    genClaudeCodeCli().trim() +
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
  // VS Code uses `servers` (not `mcpServers`) and requires `type: "stdio"`
  const json = JSON.stringify(genVscodeFormat(), null, 2);
  return (
    "**VS Code** — add to `.vscode/mcp.json` (note: VS Code uses `servers`, not `mcpServers`):\n\n" +
    "```json\n" +
    json +
    "\n```\n"
  );
}

const WHY_LATEST_NOTE =
  "> Why `@latest`? Bare `npx @mnemoverse/mcp-memory-server` is cached indefinitely by npm and stops re-checking the registry. The `@latest` suffix forces a metadata lookup on every Claude Code / Cursor / VS Code session start (~100-300ms), so you always pick up new releases.";

/**
 * Build the README install block contents (without the START/END markers).
 * The order here matches the README — change here, README rewrites itself.
 */
function readmeInstallBlock() {
  return [
    snippetClaudeCodeCli(),
    snippetMcpServersJson("Cursor", ".cursor/mcp.json"),
    snippetVscode(),
    snippetMcpServersJson("Windsurf", "~/.codeium/windsurf/mcp_config.json"),
    WHY_LATEST_NOTE,
  ].join("\n");
}

// ─── README in-place rewriter ─────────────────────────────────────────────────

const README_START =
  "<!-- INSTALL_SNIPPETS_START — generated from src/configs/source.json. Run `npm run generate:configs` to refresh. Do not edit by hand. -->";
const README_END = "<!-- INSTALL_SNIPPETS_END -->";

/**
 * Take current README content + the freshly assembled install block and return
 * the rewritten README content. Idempotent.
 *
 * Throws if the markers are missing — that means a contributor stripped them
 * out and we don't know where to inject the snippets, so we fail loudly
 * instead of silently doing the wrong thing.
 */
function rewriteReadme(currentReadme, freshBlock) {
  const startIdx = currentReadme.indexOf("<!-- INSTALL_SNIPPETS_START");
  const endIdx = currentReadme.indexOf("<!-- INSTALL_SNIPPETS_END -->");

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      "README.md is missing the INSTALL_SNIPPETS_START / INSTALL_SNIPPETS_END markers.\n" +
        "These markers tell the generator where to inject the install snippets.\n" +
        "Restore them around the install section and re-run `npm run generate:configs`.",
    );
  }
  if (startIdx >= endIdx) {
    throw new Error(
      "README.md INSTALL_SNIPPETS_END marker appears before INSTALL_SNIPPETS_START.",
    );
  }

  const before = currentReadme.slice(0, startIdx);
  const after = currentReadme.slice(endIdx + README_END.length);

  return `${before}${README_START}\n\n${freshBlock}\n\n${README_END}${after}`;
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
 * MCPB-specific extras (privacy policy, user_config, tools, icon, compatibility)
 * live under source.mcpb.
 */
function genMcpbManifest() {
  const m = source.mcpb;
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
    tools: m.tools,
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
    content: JSON.stringify(genMcpbManifest(), null, 2) + "\n",
  },
  // ─── Markdown partials (consumed by README + mnemoverse-docs) ──────────────
  {
    path: "docs/snippets/claude-code.md",
    content: PARTIAL_HEADER + snippetClaudeCodeCli(),
  },
  {
    path: "docs/snippets/cursor.md",
    content:
      PARTIAL_HEADER + snippetMcpServersJson("Cursor", ".cursor/mcp.json"),
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
];

// ─── Write files ─────────────────────────────────────────────────────────────

const checkMode = process.argv.includes("--check");

let written = 0;
let unchanged = 0;

for (const { path, content } of OUTPUTS) {
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
  freshReadme = rewriteReadme(currentReadme, readmeInstallBlock());
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
    "  The INSTALL_SNIPPETS_START/END region in README.md does not match",
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
