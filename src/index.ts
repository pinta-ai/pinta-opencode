/**
 * Adaptor entry built to `dist/index.mjs` — the file the pinta-manager sidecar
 * imports by convention (`~/.pinta/adaptors/pinta-opencode/<ver>/dist/index.mjs`,
 * plan §4.2). It re-exports:
 *
 * - the opencode plugin as the **default export** (unchanged behavior — opencode
 *   itself still loads the package via `exports["."] → dist/plugin.js`), and
 * - `lifecycle: TranscriptSource` as a **named export** the sidecar reads for
 *   transcript scan / snapshot.
 *
 * Importing this module has **no side effects** (it only re-exports functions
 * and a plain object) — the CI smoke asserts `lifecycle.id === 'pinta-opencode'`
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
