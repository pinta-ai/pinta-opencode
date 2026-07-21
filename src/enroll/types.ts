/**
 * Enroll lifecycle contract — the wrapper-owned side of enrollment.
 *
 * Mirrors, VERBATIM, the pinta-manager sidecar's contract
 * (`sidecar/src/enroll/enroll-source.ts`, troy §4.2): each wrapper adaptor
 * owns "what lives where" for ITS host tool — where the host keeps its MCP
 * configs (`mcp`) and how the wrapper's hooks/plugin are registered into the
 * host (`hooks`). The manager sidecar owns only generic engines and
 * `import()`s `export const enroll: EnrollSource` from the installed
 * adaptor's side-effect-free ESM entry. The contract lives here (and in each
 * wrapper repo) until it ships in `@pinta-ai/core` alongside
 * `TranscriptSource`.
 *
 * pinta-opencode implements only the `hooks` section (`installType:
 * 'opencode-plugin'`): opencode loads the wrapper as an in-process npm plugin
 * configured via `~/.config/opencode/opencode.json`, so "enrollment" is a
 * plugin-array upsert plus a sibling env file — no MCP-config detection.
 *
 * Only `node:*` primitives in the type surface — the same `.ts` must compile
 * and run identically under Node 20 (current sidecar) and Bun (Linux daemon).
 */

/** One entry under a host config's `mcpServers` map. */
export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Everything MCP detection may depend on — injected so any platform's behavior is testable anywhere. */
export interface McpDetectContext {
  homeDir: string;
  platform: NodeJS.Platform;
}

/**
 * One enrollable config scope discovered for a host client — a (file, JSON
 * path) pair the wrap engine can rewrite, plus the servers found there.
 */
export interface McpConfigScope {
  client: string;
  configPath: string;
  scopePath: string[];
  displayPath?: string;
  servers: Record<string, McpServerEntry>;
}

/** The wrapper-owned side of MCP-config enrollment. Detection must be read-only. */
export interface McpConfigSource {
  /** Host client ids this source owns detection for. */
  clients: readonly string[];
  detect(client: string, ctx: McpDetectContext): Promise<McpConfigScope[]>;
  /**
   * The global-scope config path a host is expected to use even when no file
   * exists yet ("supported but not yet configured" placeholders). Null when
   * the host doesn't apply to this platform or is unknown.
   */
  expectedConfigPath(client: string, ctx: McpDetectContext): string | null;
}

/** Context passed to a wrapper's hook install lifecycle. */
export interface EnrollContext {
  adaptorId: string;
  adaptorVersion: string;
  /** Absolute root of the extracted adaptor version dir (contains `package/`). */
  adaptorRoot: string;
  homeDir: string;
  platform: NodeJS.Platform;
  /** `'node'` or the absolute path of the manager-bundled Node binary. */
  nodePath: string;
  /** Resolve a catalog TokenSource placeholder (e.g. `'relay-endpoint'`) to its runtime value. */
  resolveToken(source: string): string;
  /** Directory user-config backups are written into before any mutation. */
  backupRoot: string;
  /** Detected host-tool CLI version (semver), when the manager could probe it. */
  hostVersion?: string;
}

export interface EnrollApplyResult {
  /** True iff the wrapper is installed into the host after this call returns. */
  installed: boolean;
  /** Absolute path to the primary user-facing config file mutated. */
  configPath: string;
  details?: Record<string, unknown>;
}

/**
 * The wrapper-owned side of hook/plugin enrollment. `install` is the raw
 * catalog manifest `install` block for this wrapper's target — the wrapper
 * defines and validates its own shape.
 */
export interface HookEnrollProvider {
  /** Catalog `install.type` this provider implements, e.g. `'codex-plugin'`. */
  installType: string;
  apply(ctx: EnrollContext, install: Record<string, unknown>): Promise<EnrollApplyResult>;
  remove(ctx: EnrollContext, install: Record<string, unknown>): Promise<EnrollApplyResult>;
  /** Host config files to watch for drift; a change triggers a reconcile. */
  watchPaths(homeDir: string): string[];
}

/** What a wrapper exports as `export const enroll` from its ESM entry. */
export interface EnrollSource {
  /** Stable wrapper identifier, e.g. `'pinta-opencode'`. */
  id: string;
  mcp?: McpConfigSource;
  hooks?: HookEnrollProvider;
}
