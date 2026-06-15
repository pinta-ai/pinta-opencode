# Changelog

## 0.1.0 (unreleased)

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
