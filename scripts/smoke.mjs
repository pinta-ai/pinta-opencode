// Smoke: the adaptor entry the sidecar imports (`dist/index.mjs`) must expose a
// well-formed `lifecycle` with `id === 'pinta-opencode'` and must import with
// NO side effects (the opencode plugin must not run just because the sidecar
// loaded the module). Run after `npm run build`.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "index.mjs",
);

// Trip on any stray stderr write during import — the plugin's only stderr path
// is its `warn()` helper, which must never fire on a bare import.
let stderr = "";
const origWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  stderr += typeof chunk === "string" ? chunk : chunk.toString();
  return origWrite(chunk, ...rest);
};

const mod = await import(distEntry);

process.stderr.write = origWrite;

assert.equal(stderr, "", `import(dist/index.mjs) wrote to stderr (side effect): ${stderr}`);
assert.ok(mod.lifecycle, "named export `lifecycle` missing");
assert.equal(mod.lifecycle.id, "pinta-opencode", "lifecycle.id mismatch");
assert.equal(typeof mod.lifecycle.roots, "function", "lifecycle.roots missing");
assert.equal(typeof mod.lifecycle.scan, "function", "lifecycle.scan missing");
assert.equal(typeof mod.lifecycle.classify, "function", "lifecycle.classify missing");
assert.equal(typeof mod.lifecycle.snapshot, "function", "lifecycle.snapshot missing");
assert.equal(typeof mod.default, "function", "default export (plugin) missing/not a function");

process.stdout.write("smoke OK: dist/index.mjs exposes lifecycle.id='pinta-opencode' (no side effects)\n");
