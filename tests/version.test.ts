import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/config.js";
import { buildOtlpPayload } from "../src/core/otlp.js";

/**
 * `service.version` was the literal string "unknown" on every opencode span,
 * because the only source read was `OPENCODE_VERSION` and opencode does not set
 * it. Dumping the environment a real plugin sees (opencode 1.18.31,
 * `opencode run`) returned `OPENCODE=1`, `OPENCODE_PID` and
 * `OPENCODE_CONFIG_DIR`, and nothing else in reach carried a version either —
 * not the plugin input, not the SDK client's namespaces, and not `process.argv`
 * (`["bun", "/$bunfs/root/src/index.js", …]`, a virtual path).
 *
 * `process.execPath` is the exception: measured as
 * `/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode.exe`, which makes
 * the package manifest a walk up from there. These tests pin that walk, and
 * pin that it matches on package name rather than a fixed depth, and that an
 * unresolved version stays undefined so the OTLP attribute is omitted instead
 * of shipping a placeholder — "unknown" is indistinguishable from a real value
 * downstream.
 */

const MEASURED_VERSION = "1.18.31";

const SAVE = { ...process.env };
let tmp: string;
let realExecPath: string;

function setExecPath(p: string) {
  Object.defineProperty(process, "execPath", { value: p, configurable: true, writable: true });
}

/**
 * Reproduce the measured layout: `<root>/node_modules/opencode-ai/bin/opencode.exe`
 * with the manifest two levels above the binary.
 */
function fakeInstall(opts: { name?: string; version?: string; binDepth?: number }): string {
  const pkgDir = path.join(tmp, "node_modules", opts.name ?? "opencode-ai");
  const binDir = path.join(pkgDir, ...Array(opts.binDepth ?? 1).fill("bin"));
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: opts.name ?? "opencode-ai", version: opts.version ?? MEASURED_VERSION }),
  );
  const exe = path.join(binDir, "opencode.exe");
  fs.writeFileSync(exe, "");
  return exe;
}

beforeEach(() => {
  realExecPath = process.execPath;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-version-test-"));
  delete process.env.OPENCODE_VERSION;
  // resolveConfig() loads an env file from the opencode config dir; point at a
  // dir with none so an enrolled dev machine cannot leak into these tests.
  process.env.OPENCODE_CONFIG_DIR = path.join(os.tmpdir(), "pinta-opencode-test-no-env-file");
});

afterEach(() => {
  setExecPath(realExecPath);
  Object.assign(process.env, SAVE);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("opencode version resolution", () => {
  it("derives the version from the package that owns process.execPath", () => {
    setExecPath(fakeInstall({}));
    expect(resolveConfig({}).serviceVersion).toBe(MEASURED_VERSION);
  });

  it("reports a real version under the environment a real plugin actually gets", () => {
    // The regression this whole change exists for: OPENCODE_VERSION is unset.
    setExecPath(fakeInstall({}));
    expect(resolveConfig({}).serviceVersion).toBe(MEASURED_VERSION);
  });

  it("matches on package name, not a fixed depth", () => {
    setExecPath(fakeInstall({ binDepth: 3 }));
    expect(resolveConfig({}).serviceVersion).toBe(MEASURED_VERSION);
  });

  it("ignores a package.json that is not opencode-ai", () => {
    // A wrapper package sitting between the binary and the real manifest must
    // not be mistaken for opencode itself.
    setExecPath(fakeInstall({ name: "some-wrapper", version: "9.9.9" }));
    expect(resolveConfig({}).serviceVersion).toBeUndefined();
  });

  it("lets OPENCODE_VERSION override the derived value", () => {
    setExecPath(fakeInstall({}));
    process.env.OPENCODE_VERSION = "2.0.0";
    expect(resolveConfig({}).serviceVersion).toBe("2.0.0");
  });

  it("ignores a blank OPENCODE_VERSION rather than reporting it", () => {
    setExecPath(fakeInstall({}));
    process.env.OPENCODE_VERSION = "   ";
    expect(resolveConfig({}).serviceVersion).toBe(MEASURED_VERSION);
  });

  it("resolves to undefined when execPath belongs to no package", () => {
    setExecPath(path.join(tmp, "nowhere", "opencode"));
    expect(resolveConfig({}).serviceVersion).toBeUndefined();
  });

  it("omits the OTLP attribute entirely when the version is unresolved", () => {
    // Not "unknown", and not an empty string either: the key must be absent.
    // A placeholder is indistinguishable from a real value downstream.
    setExecPath(path.join(tmp, "nowhere", "opencode"));
    const payload = buildOtlpPayload({
      name: "opencode.tool.before",
      traceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      fields: { kind: "tool.before" },
      serviceVersion: resolveConfig({}).serviceVersion,
    });
    const resource = payload.resourceSpans[0].resource.attributes;
    expect(resource.find((a) => a.key === "service.version")).toBeUndefined();
    expect(resource.find((a) => a.key === "service.name")).toBeDefined();
  });

  it("survives a corrupt package.json on the way up", () => {
    const exe = fakeInstall({});
    fs.writeFileSync(path.join(path.dirname(exe), "package.json"), "not json");
    setExecPath(exe);
    expect(resolveConfig({}).serviceVersion).toBe(MEASURED_VERSION);
  });
});
