# pinta-opencode — OTLP forwarder + guard for opencode

Converts **opencode** session/tool events into OTLP/HTTP spans and forwards them to any OpenTelemetry-compatible collector, with an optional external **guard** that can allow/deny tool calls and surface a human-readable reason. Vendor-neutral. No Pinta CLI dependency. Identity is attached at the relay layer.

Unlike the Claude Code / Codex / Copilot adapters (which spawn a process per hook and talk over stdin/stdout), opencode loads plugins **in-process**. pinta-opencode is therefore a **single importable plugin module** — installed via `opencode.json` or a plugins-dir drop-in, no opencode source changes.

> Status: spec complete and validated end-to-end against **opencode 1.15.3**. See [`SPEC.md`](./SPEC.md), [`PLAN.md`](./PLAN.md), and the empirical record in [`HYPOTHESIS_VALIDATION.md`](./HYPOTHESIS_VALIDATION.md) (§10–13).

## How it hooks in

opencode fires plugin hooks around every built-in **and** MCP tool. This adapter uses only non-experimental hooks:

| Hook | Adapter does | Verified payload |
|---|---|---|
| `chat.message` | start a new trace (turn boundary) | `{ sessionID, agent, model, messageID, variant }` |
| `event` | lifecycle span (Bronze flatten) + flush on `session.idle` | `{ event: { id, type, properties } }`, every event carries `properties.sessionID` |
| `tool.execute.before` | query guard → **`throw` on DENY** + emit span | input `{ tool, sessionID, callID }`, output `{ args }` (full tool args, mutable) |
| `tool.execute.after` | tool-result span (incl. exit code) | output `{ title, output, metadata{ output, exit, truncated, … } }` |

> The `permission.ask` plugin hook is **declared but never triggered** in opencode — do not depend on it. Gating is done in `tool.execute.before` only.

## Install

Add to global `~/.config/opencode/opencode.json` (or a project `opencode.json`):

```jsonc
{
  "plugin": [
    ["@pinta-ai/pinta-opencode", {
      "endpoint": "https://your-collector.example.com/v1/traces",
      "guard": "https://your-relay.example.com/guard"
    }]
  ]
}
```

opencode installs the npm package on demand and checks `engines.opencode` for compatibility. Alternatively drop a single file into `~/.config/opencode/plugins/` (global) or `.opencode/plugins/` (project) — auto-discovered, no config edit.

> Managed installs (Pinta Manager) inject the same `plugin` line via the sidecar enroll module — no manual step.

## Configuration

Resolution order: **plugin options (2nd arg) → `process.env` → `~/.config/opencode/pinta-opencode.env`** (unset-only). Both options and env are visible at runtime (verified).

```env
# ~/.config/opencode/pinta-opencode.env
PINTA_OPENCODE_ENDPOINT=https://your-collector.example.com/v1/traces
PINTA_OPENCODE_TOKEN=YOUR-TOKEN
# optional: external guard (allow/deny tool calls)
PINTA_OPENCODE_GUARD=https://your-relay.example.com/guard
```

| Var (option / env) | Purpose |
|---|---|
| `endpoint` / `PINTA_OPENCODE_ENDPOINT` | Full OTLP/HTTP traces URL. Falls back to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` → `OTEL_EXPORTER_OTLP_ENDPOINT` (+`/v1/traces`). No endpoint → telemetry disabled. |
| `headers` / `PINTA_OPENCODE_HEADERS` | `key=val,key=val` request headers (auth). Falls back to `OTEL_EXPORTER_OTLP_HEADERS`. |
| `guard` / `PINTA_OPENCODE_GUARD` | Optional. POST'd on `tool.execute.before`; a `DENY` blocks the tool. No endpoint → governance disabled. |
| `token` / `PINTA_OPENCODE_TOKEN` | Sent as `x-pinta-relay-token` on guard + OTLP. |
| `PINTA_OPENCODE_GUARD_TIMEOUT_MS` | Guard client timeout (default `50`; `300` recommended in production for cold-start). |
| `PINTA_OPENCODE_GUARD_DISABLED=1` | Force-disable the guard. |

Telemetry and governance are independent — endpoint only, guard only, both, or neither all work.

## Guard (allow / deny + reason)

On `tool.execute.before` the adapter POSTs to the guard endpoint (cc/codex/copilot contract — backend unchanged):

```
POST {guard}   header: x-pinta-relay-token: {PINTA_RELAY_TOKEN}
body: { "input": { "spanId", "toolName", "toolInput", "rawTextFields": { "toolInput" } } }
200: { "decision": "ALLOW"|"DENY"|"REVIEW", "reason", "userMessage?", "durationMs?" }
```

A `DENY` becomes `throw new Error(userMessage ?? reason ?? "guard_deny")`. Verified effect: **only that tool is blocked** (`tool.execute.after` does not fire), the reason shows as `✗ … failed` + `Error: <reason>` to the model/TUI, and the session stays alive. `ALLOW`/`REVIEW` pass through.

Guard is **fail-open** (no endpoint / `PINTA_GUARD_DISABLED=1` / non-200 / timeout / error → allow), so it never breaks a session. The 50ms inline call does not block tool execution.

## Span conventions

| Attribute | Value |
|---|---|
| `ingest.type` | `"opencode"` (aware-backend discriminator) |
| `opencode.kind` | `event` \| `tool.before` \| `tool.after` |
| `opencode.event_type` | event type (`message.part.updated`, `session.idle`, …) |
| `opencode.<key>` | every other field (Bronze flattening, raw key preserved) |
| `pinta.guard.{decision,duration_ms,matched_rule,fail_open_reason}` | guard result |
| `service.name` | `"opencode"` · `telemetry.sdk.name` `"pinta-opencode"` |

Tool spans are built from `tool.execute.before/after` (richer: args, output, exit) rather than the event bus; `event` covers lifecycle and turn boundaries.

## Architecture

```
src/
├── plugin.ts             # entry: export const PintaOpencode = async (input, options) => Hooks
├── config.ts             # options → process.env → pinta-opencode.env (unset-only)
├── telemetry.ts          # event → span (Bronze flatten), tool span from before/after
├── core/
│   ├── otlp.ts           # Bronze flattening (opencode.*) + ingest.type + guard attrs
│   ├── trace.ts          # ULID trace, keyed by sessionID, rotated on chat.message
│   ├── transport.ts      # POST OTLP/HTTP traces (5s), in-memory retry queue
│   ├── retry-queue.ts    # batched flush on next event
│   ├── guard.ts          # POST PINTA_GUARD_ENDPOINT (50ms), fail-open
│   └── redact.ts         # Tier-1 redaction + Tier-3 truncation
```

State lives in memory (keyed by `sessionID`) — opencode instantiates the plugin once per instance, so per-event file persistence is unnecessary (optional via `PINTA_PERSIST=1`).

## Development

```bash
bun install
bun run build         # → dist/
bun test
```

Compatibility: opencode **>= 1.15.0** (`engines.opencode`). Uses only non-experimental hooks.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — see [LICENSE](LICENSE). Commercial use is not permitted; contact Pinta AI for a commercial license.
