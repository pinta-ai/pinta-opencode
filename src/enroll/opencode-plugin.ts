import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { EnrollApplyResult, EnrollContext } from "./types.js";
import { writeAtomicWithBackup } from "./fs-util.js";
import { parseEnvFile, serializeEnvFile } from "./env-file.js";

/**
 * opencode enrollment — ported verbatim from pinta-manager
 * `sidecar/src/enroll/opencode-plugin.ts` (per-tool ownership, troy §4.2).
 *
 * opencode is an IN-PROCESS npm plugin (not a spawned hook binary like codex).
 * It is configured by editing `~/.config/opencode/opencode.json`, whose `plugin`
 * field is an array of either bare package-name strings or
 * `[package_name, options]` tuples. The manager owns exactly one entry for
 * `@pinta-ai/pinta-opencode`; enroll strips any prior manager-owned entry for
 * that package (matched by base name, ignoring any pinned version), then appends
 * a fresh `[package_name@version, options]` tuple. The version pin (plus a cache
 * invalidation that works around opencode#21609, where opencode reuses a cached
 * plugin install and ignores a changed pin) keeps opencode from loading a stale
 * version — making apply idempotent across re-runs and version upgrades.
 *
 * A sibling `~/.config/opencode/pinta-opencode.env` carries the canonical
 * PINTA_OPENCODE_* env keys (mirrors codex's pinta-codex.env), reusing the
 * shared env-file serializer. Both the plugin options and the env keys are
 * resolved entirely from the manifest's `plugin_options` / `env_file_keys`
 * records — no key names are hardcoded here.
 */

/** The catalog manifest `install` block for the `opencode-plugin` target. */
export interface OpencodePluginInstall {
  package_name: string;
  /** optionKey → TokenSource placeholder, resolved via ctx.resolveToken. */
  plugin_options: Record<string, string>;
  /** ENV_NAME → TokenSource placeholder, resolved via ctx.resolveToken. */
  env_file_keys: Record<string, string>;
  dist_root?: string;
  [key: string]: unknown;
}

/** Resolve a `Record<key, TokenSource>` manifest mapping to runtime values. */
function resolveTokenMap(
  map: Record<string, string>,
  resolveToken: (source: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = resolveToken(v);
  }
  return out;
}

// A `plugin` array entry: either a bare package name or a [name, options] tuple.
type PluginEntry = string | [string, Record<string, unknown>];

interface OpencodeConfig {
  plugin?: PluginEntry[];
  [key: string]: unknown;
}

// --- opencode.json parse ---

/**
 * Safely parse an opencode.json file. Returns `{}` on empty content, non-object
 * values, or JSON parse errors — so callers never throw on a user-emptied or
 * corrupted file (mirrors codex `safeParseHooks`). Plain JSON only (no JSONC).
 */
export function safeParseOpencodeConfig(content: string): OpencodeConfig {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as OpencodeConfig;
    }
    return {};
  } catch {
    return {};
  }
}

// --- plugin-array helpers ---

/** Extract the package spec from a plugin entry (bare string or tuple). */
export function pluginEntryPackageName(entry: PluginEntry): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0];
  return undefined;
}

/**
 * The base package name of a plugin spec, ignoring any pinned `@version` suffix:
 *   `@pinta-ai/pinta-opencode@0.3.1` → `@pinta-ai/pinta-opencode`
 *   `@pinta-ai/pinta-opencode`       → `@pinta-ai/pinta-opencode`
 *   `foo@1.2.3` → `foo`
 * The leading `@` of a scope is not a version separator, so only an `@` past
 * index 0 is treated as the version delimiter. Used so the manager matches (and
 * replaces) its single owned entry across version upgrades, regardless of which
 * version the existing entry pins.
 */
export function basePackageName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * Strip every existing entry whose base package name matches `packageSpec`
 * (whether bare string or tuple, pinned to any version or none), then append
 * the manager-owned `[packageSpec, options]` tuple. Pure transform — idempotent:
 * repeated apply (and version upgrades) yield a single manager entry regardless
 * of prior state. Other plugins' entries are preserved in their original order.
 */
export function upsertPluginEntry(
  existing: PluginEntry[],
  packageSpec: string,
  options: Record<string, unknown>,
): PluginEntry[] {
  const base = basePackageName(packageSpec);
  const others = existing.filter((e) => {
    const name = pluginEntryPackageName(e);
    return name === undefined || basePackageName(name) !== base;
  });
  return [...others, [packageSpec, options]];
}

/** Remove every entry whose base package name matches `packageSpec` (any version). */
export function stripPluginEntry(
  existing: PluginEntry[],
  packageSpec: string,
): PluginEntry[] {
  const base = basePackageName(packageSpec);
  return existing.filter((e) => {
    const name = pluginEntryPackageName(e);
    return name === undefined || basePackageName(name) !== base;
  });
}

function opencodeConfigDir(homeDir: string): string {
  return path.join(homeDir, ".config", "opencode");
}

/** opencode's version-agnostic install dir for a plugin: `<cache>/packages/<pkg>@latest`. */
function opencodePluginCacheDir(homeDir: string, packageName: string): string {
  return path.join(homeDir, ".cache", "opencode", "packages", `${packageName}@latest`);
}

/**
 * Workaround for opencode#21609. opencode installs a plugin into a
 * version-agnostic cache dir (`~/.cache/opencode/packages/<pkg>@latest`) and
 * reuses it as long as it exists — it does NOT re-resolve when our pinned
 * version in opencode.json changes. So a version bump alone leaves opencode on
 * the previously-installed version (the stale plugin keeps sending — or omitting
 * — the old guard User-Agent). Remove that cache dir when the version it has
 * installed differs from `wantVersion`, so opencode re-installs the pin on its
 * next start. Returns true if a stale install was removed.
 *
 * Best-effort and side-effect-tolerant: a missing cache (fresh machine) or any
 * fs/JSON error is a no-op — the version pin alone still makes a fresh install
 * correct; this only closes the upgrade path. Couples to opencode's cache layout
 * by necessity; revisit once #21609 is fixed.
 */
export function invalidateOpencodeCacheIfStale(
  homeDir: string,
  packageName: string,
  wantVersion: string,
): boolean {
  try {
    const cacheDir = opencodePluginCacheDir(homeDir, packageName);
    const installedManifest = path.join(cacheDir, "node_modules", packageName, "package.json");
    if (!fs.existsSync(installedManifest)) return false; // nothing cached → fresh install honors the pin
    const installed = JSON.parse(fs.readFileSync(installedManifest, "utf-8")) as { version?: unknown };
    if (typeof installed.version === "string" && installed.version === wantVersion) return false; // current
    fs.rmSync(cacheDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// --- public API ---

export async function applyOpencodePlugin(
  ctx: EnrollContext,
  install: OpencodePluginInstall,
): Promise<EnrollApplyResult> {
  const configDir = opencodeConfigDir(ctx.homeDir);
  const configJsonPath = path.join(configDir, "opencode.json");
  const envFilePath = path.join(configDir, "pinta-opencode.env");

  await fsp.mkdir(configDir, { recursive: true });

  // 1. Build the manager-owned plugin options entirely from the manifest's
  //    `plugin_options` record (optionKey → TokenSource). Every key/value is
  //    resolved through the relay resolver — nothing is hardcoded here, so the
  //    canonical PINTA_OPENCODE_* contract lives wholly in the catalog manifest.
  const pluginOptions: Record<string, unknown> = resolveTokenMap(
    install.plugin_options,
    ctx.resolveToken,
  );

  // 2. Read/parse opencode.json (create if missing; tolerate corrupt → {}).
  const config: OpencodeConfig = fs.existsSync(configJsonPath)
    ? safeParseOpencodeConfig(fs.readFileSync(configJsonPath, "utf-8"))
    : {};
  const existingPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  // Pin the exact enrolled version (e.g. `@pinta-ai/pinta-opencode@0.3.1`)
  // instead of the bare name. A bare name resolves as `@latest`, which opencode
  // caches and then fails to refresh (opencode#21609) — so the in-process plugin
  // (and the guard User-Agent it sends) sticks at a stale version. An explicit
  // version is opencode's own recommended workaround for that bug. upsert matches
  // on the base name, so a prior bare/differently-pinned entry is replaced (not
  // duplicated) on upgrade.
  const packageSpec = `${install.package_name}@${ctx.adaptorVersion}`;
  config.plugin = upsertPluginEntry(existingPlugins, packageSpec, pluginOptions);

  await writeAtomicWithBackup(
    configJsonPath,
    JSON.stringify(config, null, 2) + "\n",
    ctx.backupRoot,
  );

  // 2b. Pinning fixes a *fresh* install, but not an upgrade: opencode installs
  //     the plugin into a version-agnostic cache dir
  //     (~/.cache/opencode/packages/<pkg>@latest) and REUSES it whenever the dir
  //     exists — it does not re-resolve when our pinned version changes
  //     (opencode#21609). So drop that cache dir when its installed version
  //     differs from the one we're enrolling; opencode then re-installs the pin
  //     on its next start. Best-effort workaround — remove once #21609 is fixed.
  const cacheInvalidated = invalidateOpencodeCacheIfStale(
    ctx.homeDir,
    install.package_name,
    ctx.adaptorVersion,
  );

  // 3. pinta-opencode.env: merge keys (preserve user-set keys not in env_file_keys).
  const envExisting = fs.existsSync(envFilePath)
    ? parseEnvFile(fs.readFileSync(envFilePath, "utf-8"))
    : {};
  // Resolve every ENV_NAME → TokenSource from the manifest. Env key names
  // (e.g. PINTA_OPENCODE_ENDPOINT/_GUARD/_TOKEN) come entirely from the catalog
  // — nothing is injected unconditionally here.
  const newEnv = resolveTokenMap(install.env_file_keys, ctx.resolveToken);
  const mergedEnv = { ...envExisting, ...newEnv };
  await writeAtomicWithBackup(envFilePath, serializeEnvFile(mergedEnv), ctx.backupRoot);

  return {
    installed: true,
    configPath: configJsonPath,
    details: { configDir, packageName: install.package_name, packageSpec, envFilePath, cacheInvalidated },
  };
}

export async function removeOpencodePlugin(
  ctx: EnrollContext,
  install: OpencodePluginInstall,
): Promise<EnrollApplyResult> {
  const configDir = opencodeConfigDir(ctx.homeDir);
  const configJsonPath = path.join(configDir, "opencode.json");
  if (!fs.existsSync(configJsonPath)) {
    return { installed: false, configPath: configJsonPath };
  }
  const config: OpencodeConfig = safeParseOpencodeConfig(
    fs.readFileSync(configJsonPath, "utf-8"),
  );
  const existingPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  config.plugin = stripPluginEntry(existingPlugins, install.package_name);
  await writeAtomicWithBackup(
    configJsonPath,
    JSON.stringify(config, null, 2) + "\n",
    ctx.backupRoot,
  );
  // After successful remove, the adaptor is no longer installed.
  return { installed: false, configPath: configJsonPath };
}
