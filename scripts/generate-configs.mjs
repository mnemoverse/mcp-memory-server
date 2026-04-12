#!/usr/bin/env node
/**
 * generate-configs.mjs
 *
 * Single source of truth → all distribution channel configs.
 *
 * Reads: src/configs/source.json
 * Writes: docs/configs/*, smithery.yaml, server.json
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

/**
 * Smithery.ai config — custom yaml with configSchema + commandFunction.
 *
 * Smithery shows configSchema fields to user as form, then calls commandFunction(config)
 * to build the launch command.
 */
function genSmitheryYaml() {
  // Build configSchema properties from source.env
  const schemaProperties = {};
  const required = [];
  const camelCaseEnvMap = {}; // Smithery uses camelCase keys, then we map back to ENV_VAR

  for (const [envKey, meta] of Object.entries(source.env)) {
    // Convert MNEMOVERSE_API_KEY → mnemoverseApiKey
    const camelKey = envKey
      .toLowerCase()
      .split("_")
      .map((part, i) =>
        i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join("");

    camelCaseEnvMap[camelKey] = envKey;
    schemaProperties[camelKey] = {
      type: "string",
      description: meta.description,
    };
    if (meta.required) required.push(camelKey);
  }

  // Build commandFunction body
  const envAssignments = Object.entries(camelCaseEnvMap)
    .map(([camel, envVar]) => `        ${envVar}: config.${camel},`)
    .join("\n");

  const yaml = `# Smithery configuration — AUTO-GENERATED from src/configs/source.json
# Do not edit by hand. Run \`npm run generate:configs\` to regenerate.
# Docs: https://smithery.ai/docs/build/project-config/smithery.yaml

startCommand:
  type: ${source.type}
  configSchema:
    type: object
    required:
${required.map((k) => `      - ${k}`).join("\n")}
    properties:
${Object.entries(schemaProperties)
  .map(
    ([key, prop]) => `      ${key}:
        type: ${prop.type}
        description: |
          ${prop.description}`,
  )
  .join("\n")}
  commandFunction:
    |-
    (config) => ({
      command: '${source.command}',
      args: ${JSON.stringify(source.args)},
      env: {
${envAssignments}
      }
    })
`;
  return yaml;
}

/**
 * Official MCP Registry server.json.
 *
 * https://registry.modelcontextprotocol.io/
 * Schema: https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json
 */
function genServerJson() {
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
    name: "io.github.mnemoverse/mcp-memory-server",
    description: source.description,
    repository: {
      url: source.metadata.repository,
      source: "github",
    },
    version: PACKAGE_VERSION,
    packages: [
      {
        registryName: source.package.registry,
        name: source.package.name,
        version: PACKAGE_VERSION,
        runtimeArguments: source.args.slice(1), // skip "-y"
        environmentVariables: Object.entries(source.env).map(([key, meta]) => ({
          name: key,
          description: meta.description,
          isRequired: meta.required ?? false,
          isSecret: meta.secret ?? false,
        })),
      },
    ],
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
    path: "smithery.yaml",
    content: genSmitheryYaml(),
  },
  {
    path: "server.json",
    content: JSON.stringify(genServerJson(), null, 2) + "\n",
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

if (checkMode) {
  console.log(`✓ All ${OUTPUTS.length} configs in sync with source.json`);
} else {
  console.log(
    `\nDone: ${written} written, ${unchanged} unchanged (${OUTPUTS.length} total)`,
  );
}
