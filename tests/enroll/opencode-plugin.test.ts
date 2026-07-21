import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  applyOpencodePlugin,
  removeOpencodePlugin,
  safeParseOpencodeConfig,
  pluginEntryPackageName,
  basePackageName,
  upsertPluginEntry,
  stripPluginEntry,
  invalidateOpencodeCacheIfStale,
  type OpencodePluginInstall,
} from "../../src/enroll/opencode-plugin.js";
import type { EnrollContext } from "../../src/enroll/types.js";

const PKG = "@pinta-ai/pinta-opencode";
// makeCtx() defaults adaptorVersion to '1.2.0', so the enrolled entry is pinned.
const PINNED = `${PKG}@1.2.0`;

let tmpHome: string;
let tmpAdaptorBase: string;
let tmpAdaptorRoot: string;
let tmpBackupRoot: string;

// Mirrors the manager's TokenSource resolver (sidecar/src/enroll/relay.ts)
// for a sidecar on :4318 with relay token OPENCODE-TOKEN.
function testTokenResolver(source: string): string {
  switch (source) {
    case "relay-endpoint":
      return "http://127.0.0.1:4318/v1/traces";
    case "relay-token":
      return "x-pinta-relay-token=OPENCODE-TOKEN";
    case "relay-token-raw":
      return "OPENCODE-TOKEN";
    case "relay-guard-endpoint":
      return "http://127.0.0.1:4318/guard/evaluate";
    default:
      throw new Error(`unknown token source: ${source}`);
  }
}

function makeCtx(overrides: Partial<EnrollContext> = {}): EnrollContext {
  return {
    adaptorId: "pinta-opencode",
    adaptorVersion: "1.2.0",
    adaptorRoot: tmpAdaptorRoot,
    homeDir: tmpHome,
    platform: "darwin",
    nodePath: "node",
    resolveToken: testTokenResolver,
    backupRoot: tmpBackupRoot,
    ...overrides,
  };
}

const configPath = () => path.join(tmpHome, ".config", "opencode", "opencode.json");
const envPath = () => path.join(tmpHome, ".config", "opencode", "pinta-opencode.env");
// opencode's version-agnostic plugin install dir (see invalidateOpencodeCacheIfStale).
const cacheDir = () => path.join(tmpHome, ".cache", "opencode", "packages", `${PKG}@latest`);
function writeFakeOpencodeCache(version: string) {
  const inner = path.join(cacheDir(), "node_modules", PKG);
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, "package.json"), JSON.stringify({ name: PKG, version }));
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pmgr-opencode-home-"));
  tmpAdaptorBase = fs.mkdtempSync(path.join(os.tmpdir(), "pmgr-opencode-base-"));
  tmpAdaptorRoot = path.join(tmpAdaptorBase, "pinta-opencode", "1.2.0");
  tmpBackupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pmgr-opencode-bak-"));
  fs.mkdirSync(tmpAdaptorRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpAdaptorBase, { recursive: true, force: true });
  fs.rmSync(tmpBackupRoot, { recursive: true, force: true });
});

const install: OpencodePluginInstall = {
  package_name: PKG,
  plugin_options: {
    endpoint: "relay-endpoint",
    guard: "relay-guard-endpoint",
    token: "relay-token-raw",
  },
  env_file_keys: {
    PINTA_OPENCODE_ENDPOINT: "relay-endpoint",
    PINTA_OPENCODE_GUARD: "relay-guard-endpoint",
    PINTA_OPENCODE_TOKEN: "relay-token-raw",
  },
};

describe("plugin-array helpers", () => {
  it("pluginEntryPackageName: handles bare strings and tuples", () => {
    expect(pluginEntryPackageName("foo")).toBe("foo");
    expect(pluginEntryPackageName(["foo", { a: 1 }])).toBe("foo");
  });

  it("basePackageName: strips a pinned version but keeps the scope", () => {
    expect(basePackageName(`${PKG}@0.3.1`)).toBe(PKG);
    expect(basePackageName(PKG)).toBe(PKG); // bare scoped name unchanged
    expect(basePackageName("foo@1.2.3")).toBe("foo");
    expect(basePackageName("foo")).toBe("foo");
  });

  it("upsertPluginEntry: replaces a prior pinned-version entry on upgrade (matched by base name)", () => {
    const existing = ["other", [`${PKG}@0.3.0`, { stale: true }]] as any;
    const next = upsertPluginEntry(existing, `${PKG}@0.3.1`, { endpoint: "x" });
    expect(next).toEqual(["other", [`${PKG}@0.3.1`, { endpoint: "x" }]]);
    expect(next.filter((e) => basePackageName(pluginEntryPackageName(e as any) ?? "") === PKG)).toHaveLength(1);
  });

  it("stripPluginEntry: removes a pinned-version entry by base name", () => {
    const existing = ["a", [`${PKG}@0.3.0`, {}], "b"] as any;
    expect(stripPluginEntry(existing, `${PKG}@0.3.1`)).toEqual(["a", "b"]);
  });

  it("upsertPluginEntry: strips prior entry for the package then appends tuple (idempotent)", () => {
    const existing = ["other-plugin", [PKG, { stale: true }]] as any;
    const once = upsertPluginEntry(existing, PKG, { endpoint: "x" });
    expect(once).toEqual(["other-plugin", [PKG, { endpoint: "x" }]]);
    // Re-apply yields a single manager entry — no duplicate.
    const twice = upsertPluginEntry(once, PKG, { endpoint: "y" });
    expect(twice).toEqual(["other-plugin", [PKG, { endpoint: "y" }]]);
    expect(twice.filter((e) => pluginEntryPackageName(e as any) === PKG)).toHaveLength(1);
  });

  it("upsertPluginEntry: strips a prior bare-string entry for the package", () => {
    const existing = [PKG, "other"] as any;
    const next = upsertPluginEntry(existing, PKG, { endpoint: "x" });
    expect(next).toEqual(["other", [PKG, { endpoint: "x" }]]);
  });

  it("stripPluginEntry: removes every entry for the package, preserving others", () => {
    const existing = ["a", [PKG, {}], "b"] as any;
    expect(stripPluginEntry(existing, PKG)).toEqual(["a", "b"]);
  });

  it("safeParseOpencodeConfig: tolerates empty / corrupt / array content", () => {
    expect(safeParseOpencodeConfig("")).toEqual({});
    expect(safeParseOpencodeConfig("{not json")).toEqual({});
    expect(safeParseOpencodeConfig("[1,2]")).toEqual({});
    expect(safeParseOpencodeConfig('{"plugin":["x"]}')).toEqual({ plugin: ["x"] });
  });
});

describe("applyOpencodePlugin", () => {
  it("creates ~/.config/opencode/{opencode.json,pinta-opencode.env} on fresh install", async () => {
    const result = await applyOpencodePlugin(makeCtx(), install);
    expect(result.installed).toBe(true);
    expect(result.configPath).toBe(configPath());

    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.plugin).toHaveLength(1);
    const [name, opts] = config.plugin[0];
    expect(name).toBe(PINNED);
    // Every option resolved from the manifest's plugin_options record.
    expect(opts).toEqual({
      endpoint: "http://127.0.0.1:4318/v1/traces",
      guard: "http://127.0.0.1:4318/guard/evaluate",
      token: "OPENCODE-TOKEN",
    });

    const env = fs.readFileSync(envPath(), "utf-8");
    expect(env).toContain("PINTA_OPENCODE_ENDPOINT=http://127.0.0.1:4318/v1/traces");
    expect(env).toContain("PINTA_OPENCODE_GUARD=http://127.0.0.1:4318/guard/evaluate");
    expect(env).toContain("PINTA_OPENCODE_TOKEN=OPENCODE-TOKEN");
  });

  it("preserves other plugin entries and unrelated config keys", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", theme: "dark", plugin: ["other-plugin"] }),
    );
    await applyOpencodePlugin(makeCtx(), install);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.theme).toBe("dark");
    expect(config.plugin[0]).toBe("other-plugin");
    expect(pluginEntryPackageName(config.plugin[1])).toBe(PINNED);
  });

  it("idempotent: re-running replaces the prior manager entry (no duplicate)", async () => {
    await applyOpencodePlugin(makeCtx(), install);
    await applyOpencodePlugin(makeCtx(), install);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    const managerEntries = config.plugin.filter(
      (e: any) => basePackageName(pluginEntryPackageName(e) ?? "") === PKG,
    );
    expect(managerEntries).toHaveLength(1);
  });

  it("upgrade: re-enrolling a newer version replaces the prior pinned entry (no duplicate)", async () => {
    await applyOpencodePlugin(makeCtx({ adaptorVersion: "0.3.0" }), install);
    await applyOpencodePlugin(makeCtx({ adaptorVersion: "0.3.1" }), install);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    const managerEntries = config.plugin.filter(
      (e: any) => basePackageName(pluginEntryPackageName(e) ?? "") === PKG,
    );
    expect(managerEntries).toHaveLength(1);
    expect(pluginEntryPackageName(managerEntries[0])).toBe(`${PKG}@0.3.1`);
  });

  it("strips a prior bare-string manager entry before adding the tuple", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ plugin: [PKG] }));
    await applyOpencodePlugin(makeCtx(), install);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.plugin).toHaveLength(1);
    expect(Array.isArray(config.plugin[0])).toBe(true);
    expect(config.plugin[0][0]).toBe(PINNED);
  });

  it("plugin options are data-driven: empty plugin_options yields empty options object", async () => {
    const noOptsInstall = { ...install, plugin_options: {} };
    await applyOpencodePlugin(makeCtx(), noOptsInstall);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    const [, opts] = config.plugin[0];
    // Nothing is injected unconditionally — options come entirely from manifest.
    expect(opts).toEqual({});
  });

  it("pinta-opencode.env: preserves user-set keys not in env_file_keys", async () => {
    fs.mkdirSync(path.dirname(envPath()), { recursive: true });
    fs.writeFileSync(
      envPath(),
      `USER_KEY=user-value\nPINTA_OPENCODE_ENDPOINT=stale\n`,
    );
    await applyOpencodePlugin(makeCtx(), install);
    const env = fs.readFileSync(envPath(), "utf-8");
    expect(env).toContain("USER_KEY=user-value");
    expect(env).toContain("PINTA_OPENCODE_ENDPOINT=http://127.0.0.1:4318/v1/traces");
    expect(env.match(/PINTA_OPENCODE_ENDPOINT=/g)).toHaveLength(1);
  });

  it("tolerates a corrupt opencode.json (parses to {} then writes manager entry)", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), "{not valid json");
    await applyOpencodePlugin(makeCtx(), install);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.plugin).toHaveLength(1);
    expect(pluginEntryPackageName(config.plugin[0])).toBe(PINNED);
  });

  it("invalidates a stale opencode plugin cache on a version change (opencode#21609 workaround)", async () => {
    writeFakeOpencodeCache("0.2.1"); // makeCtx() enrolls 1.2.0 → stale
    const result = await applyOpencodePlugin(makeCtx(), install);
    expect((result.details as any)?.cacheInvalidated).toBe(true);
    expect(fs.existsSync(cacheDir())).toBe(false);
  });

  it("leaves a current opencode plugin cache intact", async () => {
    writeFakeOpencodeCache("1.2.0"); // matches makeCtx() adaptorVersion
    const result = await applyOpencodePlugin(makeCtx(), install);
    expect((result.details as any)?.cacheInvalidated).toBe(false);
    expect(fs.existsSync(cacheDir())).toBe(true);
  });
});

describe("invalidateOpencodeCacheIfStale", () => {
  it("removes the cache dir when the installed version differs from the pin", () => {
    writeFakeOpencodeCache("0.2.1");
    expect(invalidateOpencodeCacheIfStale(tmpHome, PKG, "0.3.1")).toBe(true);
    expect(fs.existsSync(cacheDir())).toBe(false);
  });

  it("keeps the cache dir when the installed version already matches the pin", () => {
    writeFakeOpencodeCache("0.3.1");
    expect(invalidateOpencodeCacheIfStale(tmpHome, PKG, "0.3.1")).toBe(false);
    expect(fs.existsSync(cacheDir())).toBe(true);
  });

  it("no-ops (false) when no plugin cache is present", () => {
    expect(invalidateOpencodeCacheIfStale(tmpHome, PKG, "0.3.1")).toBe(false);
  });
});

describe("removeOpencodePlugin", () => {
  it("removes only the manager-owned plugin entry, preserving others", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ plugin: ["other-plugin"] }));
    await applyOpencodePlugin(makeCtx(), install);
    const result = await removeOpencodePlugin(makeCtx(), install);
    expect(result.installed).toBe(false);

    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.plugin).toEqual(["other-plugin"]);
  });

  it("no-op (installed:false) when opencode.json is absent", async () => {
    const result = await removeOpencodePlugin(makeCtx(), install);
    expect(result.installed).toBe(false);
    expect(result.configPath).toBe(configPath());
  });
});

describe("enroll export (EnrollSource)", () => {
  it("declares identity, installType, and watch paths", async () => {
    const { enroll } = await import("../../src/enroll/index.js");
    expect(enroll.id).toBe("pinta-opencode");
    expect(enroll.mcp).toBeUndefined();
    expect(enroll.hooks!.installType).toBe("opencode-plugin");
    expect(enroll.hooks!.watchPaths("/h")).toEqual([
      path.join("/h", ".config", "opencode", "opencode.json"),
      path.join("/h", ".config", "opencode", "pinta-opencode.env"),
    ]);
  });

  it("apply/remove round-trip through the provider interface", async () => {
    const { enroll } = await import("../../src/enroll/index.js");
    const applied = await enroll.hooks!.apply(makeCtx(), install as any);
    expect(applied.installed).toBe(true);
    const removed = await enroll.hooks!.remove(makeCtx(), install as any);
    expect(removed.installed).toBe(false);
    const config = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    expect(config.plugin).toEqual([]);
  });
});
