# Changelog

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
