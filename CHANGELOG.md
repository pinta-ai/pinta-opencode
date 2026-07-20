# Changelog

## 0.5.1

- Bump `@pinta-ai/core` `^0.3.0` → `^0.4.1` (devDependency, bundled
  into `dist/` at build). Pulls in the oversized-flush fix (pinta-manager#180
  follow-up): the in-memory retry buffer now flushes in 900 KiB chunks instead
  of one unbounded POST, spans are capped at 800 KiB at build time, and a
  payload that alone exceeds the POST budget is dropped with a diagnostic
  instead of poisoning every later flush. No adapter source change was needed.

## 0.4.0

- Consolidate the duplicated low-level utilities (`guard`, `otlp`, `redact`,
  `transport`, `trace`) into the shared private package `@pinta-ai/core`. `src/core/*`
  is now a thin opencode-specific binding layer: the plugin keeps its 50ms
  fail-open guard default, its `pinta-opencode/<version>` User-Agent, explicit
  (non-`process.env`) options, and core's **in-memory** retry queue +
  `MemorySessionTraceManager`, since it is a long-lived in-process plugin.
- `@pinta-ai/core` is a devDependency, bundled into `dist/plugin.js` by esbuild at
  build time, so npmjs consumers never need private-registry access.
- Bump `@pinta-ai/core` `^0.2.0` → `^0.3.0`. The upgrade is additive; no adapter
  source change was needed. Tool spans now carry `pinta.client.rtt_ms` /
  `pinta.client.op` for free: the plugin already forwards its guard result
  through `telemetry.toolBefore` → `buildOtlpPayload` → core's `buildPayload`,
  and core `0.3.0` derives the client-call timing from the
  `GuardResult.clientRttMs` it now measures. The manager can only time its own
  handler, so `clientRttMs - durationMs` gives it the transport overhead.
- Fix `package-lock.json`, which resolved `@pinta-ai/core` as a local link to
  `../pinta-core` (a dev-machine-only path) and recorded it as a runtime
  dependency. It now resolves from GitHub Packages with an integrity hash, as a
  devDependency, so `npm ci` works in CI.
- Restore npm OIDC trusted publishing in the publish workflow (the committed
  `.npmrc` pointed npmjs auth at a nonexistent `NPM_TOKEN` secret, which would
  have failed `npm publish` with ENEEDAUTH), and pin npm to `11.18.0` (npm 12.x
  requires node >=22.22, but the job runs node 20).

## 0.2.1

- Fix `package-lock.json` so CI `npm ci` resolves (regenerated with a full
  install to include rollup's cross-platform optional binaries).
- Add the publish-to-npm GitHub workflow.

## 0.2.0

- Unify env var names under the `PINTA_OPENCODE_*` namespace so the adapter,
  Pinta Manager enroll, and the catalog manifest share identical keys
  (`PINTA_OPENCODE_ENDPOINT` / `_GUARD` / `_TOKEN` / `_HEADERS` /
  `_GUARD_TIMEOUT_MS` / `_GUARD_DISABLED`). `OTEL_EXPORTER_OTLP_*` remain as
  vendor-neutral fallbacks.
- Downstream wiring (separate repos): aware-backend `opencode` ingest slice,
  Manager `opencode-plugin` enroll, catalog entry.
- Repository org moved `awarecorp` → `pinta-ai`.

## 0.1.0

Initial implementation — OTLP forwarder + guard for opencode, as an in-process plugin.

- Plugin entry (`PintaOpencode`) wiring `chat.message` (trace rotation), `event`
  (lifecycle telemetry + flush on `session.idle`), `tool.execute.before`
  (guard gate → DENY throws with reason), `tool.execute.after` (tool span).
- Core (ported from pinta-copilot): `otlp` (Bronze flattening, `ingest.type=opencode`),
  `redact`, `transport` (in-memory retry), `trace` (in-memory, sessionID-keyed),
  `guard` (50ms fail-open, decoupled from env).
- Config resolution: plugin options → `process.env` → `pinta-opencode.env`.
- Validated end-to-end against opencode 1.15.3 (ALLOW/DENY + OTLP collection).
  See `HYPOTHESIS_VALIDATION.md` §10–13.
- Robustness (M2): 40 unit/integration tests incl. a real local collector+guard
  harness covering ALLOW / DENY / fail-open / session.idle flush.
