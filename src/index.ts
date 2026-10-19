/**
 * Adaptor entry built to `dist/index.mjs` — the file the pinta-manager sidecar
 * imports by convention (`~/.pinta/adaptors/pinta-opencode/<ver>/dist/index.mjs`,
 * plan §4.2). It re-exports:
 *
 * - the opencode plugin as the **default export** (unchanged behavior — opencode
 *   itself still loads the package via `exports["."] → dist/plugin.js`),
 * - `lifecycle: TranscriptSource` as a **named export** the sidecar reads for
 *   transcript scan / snapshot, and
 * - `enroll: EnrollSource` as a **named export** the sidecar drives to register
 *   this wrapper into opencode (`opencode.json` plugin-array upsert +
 *   `pinta-opencode.env`) — per-tool ownership, troy §4.2.
 *
 * Importing this module has **no side effects** (it only re-exports functions
 * and plain objects) — the CI smoke asserts `lifecycle.id === 'pinta-opencode'`
 * without the plugin ever running.
 */
export { default, PintaOpencode } from "./plugin.js";
export { lifecycle, classify, roots } from "./lifecycle/scanner.js";
export type {
  TranscriptSource,
  TranscriptFile,
  TranscriptSemantics,
  TranscriptClass,
} from "./lifecycle/types.js";
export { enroll } from "./enroll/index.js";
export type {
  EnrollSource,
  EnrollContext,
  EnrollApplyResult,
  HookEnrollProvider,
  McpConfigSource,
  McpConfigScope,
  McpDetectContext,
  McpServerEntry,
} from "./enroll/index.js";
