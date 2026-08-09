/**
 * The startup gate — that making the handlers testable did not stop the CLI from
 * starting.
 *
 * This is the risk the whole harness change carries, and it is asymmetric: if
 * the seam misfires, the published `bin` exits 0 having opened no transport, and
 * the client reports a connection failure with nothing in any log. Every user of
 * every editor would hit it, and no test that only calls tools would notice —
 * the tools work fine in a server nobody started.
 *
 * So the gate is tested the same way the tools are: by importing the module and
 * observing whether a stdio transport was constructed. The transport class is
 * mocked, which is the point — a real one would seize the test runner's stdin
 * and stdout, which is the original problem.
 *
 * WHY NOT `import.meta.url === process.argv[1]`, THE USUAL IDIOM. This package
 * ships as an npm `bin`, so under `npx` — the canonical install, pinned in
 * src/configs/source.json and every README snippet — argv[1] is the generated
 * shim rather than this file; on Windows it is a `.cmd`/`.ps1` wrapper, and the
 * POSIX shim is a symlink whose realpath resolution differs between package
 * managers. Each of those makes the comparison false for a real user, silently.
 * An env opt-OUT inverts the risk: it can only misfire for something that
 * deliberately sets it, and no released version reads the name, so no existing
 * client config can be carrying it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** Records every stdio transport the module tries to open. */
const stdio = vi.hoisted(() => ({ constructed: 0 }));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    constructor() {
      stdio.constructed++;
    }
    async start() {}
    async send() {}
    async close() {}
  },
}));

const VAR = "MNEMOVERSE_MCP_NO_AUTOSTART";
const original = process.env[VAR];

beforeAll(() => {
  // No tool is called here, so nothing fetches; set anyway so a future addition
  // to this file cannot reach the live API.
  process.env.MNEMOVERSE_API_URL = "http://127.0.0.1:1/api/v1";
  process.env.MNEMOVERSE_API_KEY = "mk_live_startup_test";
});

afterEach(() => {
  if (original === undefined) delete process.env[VAR];
  else process.env[VAR] = original;
});

/** Import src/index.ts fresh with `VAR` set to `value`, and count transports. */
async function transportsOpenedWith(value: string | undefined): Promise<number> {
  vi.resetModules();
  stdio.constructed = 0;
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;

  await import("../src/index.js");
  // `main()` is async and is deliberately not awaited by the module — let the
  // microtask queue drain before looking.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return stdio.constructed;
}

describe("the published CLI still starts itself", () => {
  it("opens stdio when the variable is unset — the default is unchanged", async () => {
    expect(await transportsOpenedWith(undefined)).toBe(1);
  });

  // The failure mode of a WIDE check is a startup that silently does nothing, so
  // every value except the one opt-out token must fall through to starting. These
  // are the values a person would plausibly set while meaning "yes, do start".
  it.each(["0", "false", "no", "", "true", "yes", "2"])(
    "opens stdio when the variable is %o — only the exact token opts out",
    async (value) => {
      expect(await transportsOpenedWith(value)).toBe(1);
    },
  );

  it("opens NO transport for the exact opt-out token, so tests can hold the handlers", async () => {
    expect(await transportsOpenedWith("1")).toBe(0);
  });
});
