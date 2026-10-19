# Changelog

## 0.12.1

### Changed

- `@pinta-ai/core` 0.11.0 (PTA-735). 16,384바이트 이상 긴 입력은 guard 판정을 최대 3초 기다린다(요청 쪽만, 짧은 입력은 그대로). 이전에는 긴 명령의 판정이 마감에 걸려 판정 없이 통과할 수 있었다. 서버로 보낼 사본만 새 모양까지 가리고, guard 가 판정할 사본은 그대로 둔다.

## 0.12.0

- A tool-output DENY now tells the model why. The after-hook error carries the
  policy's own `userMessage` (or a fixed default notice), the manager's
  `evaluationId` when it sent one, and a fixed recovery hint: the tool already
  ran, do not retry it to bypass the block, tell the user, report the
  evaluation id if it looks like a false positive. The previous one-line
  `Pinta withheld this tool output because it violated an active policy.` is
  gone. The session stays alive exactly as before; only the error text changed.
- Partial masking is wired but off. When the manager marks the DENY as `mask`
  and sends the detected values (`outputAction` + `redactions`,
  `@pinta-ai/core` `buildOutputDenial`), the adaptor can deliver the builtin
  output with just those values replaced by `[REDACTED:<category>]`, prefixed
  by the notice and hint, instead of throwing. This path is behind
  `PINTA_OPENCODE_OUTPUT_MASK=1` / `outputMask: true` because it works by
  mutating `output.output` inside `tool.execute.after`, and this repository has
  verified only the before-hook `throw` against a live OpenCode
  (`HYPOTHESIS_VALIDATION.md` H-A1) — not that the host delivers a mutated
  after-hook output to the model. Until that is measured, `mask` throws the
  same notice + hint as `withhold`, without the masked text in the error. Raw
  MCP results (no `output` string) always throw, flag or not.
- The manager's `redactions` are the secrets themselves: they are read from the
  loopback response and never copied onto the span, the deferred payload or a
  log line.

Compatibility:

- `@pinta-ai/core` `^0.9.2` -> `^0.10.0` (`GuardResult.evaluationId` /
  `outputAction` / `redactions`, `buildOutputDenial`).
- Pinta Manager < 0.1.16 sends none of the new fields: every output DENY is a
  withhold whose notice is the policy `userMessage`. Manager 0.1.11 remains the
  guard-payload floor.
- Before-hook DENY (`throw new Error(userMessage ?? reason ?? "guard_deny")`)
  is unchanged.

Refs PTA-695 (parent PTA-580). Open follow-up: verify on a live OpenCode that
`tool.execute.after` output mutation reaches the model, then flip the default.

## 0.11.2

- Bundle published `@pinta-ai/core` 0.9.2, including the narrowly scoped
  `CommandLine` JSON-command masking alias fix. Arbitrary JSON strings and fake
  executable wrappers are not treated as native command fields.
- Preserve the existing output gate, original evidence, fail-open behavior and
  collector-independent DENY. OpenCode 1.18.31 still skips the after hook for
  MCP `isError: true`; this distinct host gap remains open as PTA-608.
- Forward-only patch: the published 0.11.1 version, tag and artifact are
  unchanged. No Manager, backend or catalog change accompanies this release.

Refs PTA-584, PTA-608.

## 0.11.1

- Evaluate the original `tool.execute.after` payload before OpenCode delivers
  supported builtin and raw MCP output. DENY uses fixed safe feedback, preserves
  original masked execution evidence/IDs, and attaches the output target only
  after evaluation. ALLOW, REVIEW and explicit fail-open behavior are unchanged.
- Return before/after DENY without collector IO. Retain telemetry in a bounded,
  endpoint-aware memory queue using the existing UTF-8 POST limit; flush it
  before the next idle-event POST, rather than waiting behind that POST's ACK.
  The queue is not durable across process termination.
- Bundle published `@pinta-ai/core` 0.9.1, including its mysql-family-only short
  password masking fix. The effective guard timeout remains 100ms.
- Isolate private-dependency installation from setup-node's npmjs auth binding.
  The GitHub token is bound only to GitHub Packages; public publishing uses OIDC.
- Verify the actual OpenCode 1.18.31 CLI with a keyless loopback provider:
  returned builtin success/nonzero exit and raw MCP success/structured output
  are gated. MCP `isError: true` and other thrown executions skip the after hook
  in that host and remain an explicit unsupported error-output boundary.
- Keep Manager 0.1.11 as the existing envelope floor, without implying it
  supplies native after-phase projection and output-only policy evaluation.

Refs PTA-584.

## 0.11.0

- Guard default timeout 50ms -> 100ms. At 50ms a manager answering in its
  normal range still lost the race often enough to show up as timeout
  fail-opens. The plugin awaits the verdict in-process before the tool runs
  (`tool.execute.before`), so a tool call can now stall on the guard for up to
  100ms instead of 50ms. `PINTA_OPENCODE_GUARD_TIMEOUT_MS` / `guardTimeoutMs`
  still override it.
- `@pinta-ai/core` `^0.8.0` -> `^0.9.0`: the effective timeout (default or
  override) is declared to the manager as `x-pinta-guard-budget-ms`. Manager
  0.1.10+ plans its own work around it instead of the 50ms it had copied for
  this adaptor, so the backend package check gets 80ms rather than 40ms. Older
  managers ignore the header.
- README no longer says the guard never blocks tool execution; it does, for up
  to the timeout.
- Pinta Manager 0.1.11 or later remains the guard-payload compatibility floor.

Refs PTA-579.

## 0.10.0

- Emit exact scalar `opencode.model` with source/provider evidence from verified
  host model shapes. Preserve original nested fields and conflicting top-level
  model values; omit blanks, placeholders and every JSON-prefixed ID, including
  malformed/truncated strings.
- Correlate tool models through the exact session + callID -> messageID join.
  Request evidence is scoped to its user message and agent, not reused as a
  session default. Bounded caches handle switches, subagents, concurrent
  sessions, out-of-order updates, stale state and end/removal events without
  borrowing an unrelated model.
- Report assistant metadata as host selection, not proof of actual provider
  response identity. Span counts, guard behavior and redaction remain unchanged;
  model resolution adds no file scans, host commands or network requests.
- Pinta Manager 0.1.11 or later remains the guard-payload compatibility floor,
  with `@pinta-ai/core` still at `^0.8.0` and no new required envelope fields or
  additional desktop upgrade.

Refs PTA-524.

## 0.9.0

- The guard is asked about the span, not about a summary of it. Until now the
  `PreToolUse` gate assembled a five-field `GuardInput` (tool name, input, working
  directory, hook, session) beside the span that carried the same facts under
  `opencode.*`, and the two were free to drift — `cwd` (PTA-176) and the hook name
  (PTA-207) were on the span and missing from the summary. Now the span is built
  first, `POST /guard/evaluate` receives that OTLP payload unwrapped, the manager
  projects it through the same AgentEvent assembly the backend stores it with,
  and the verdict is attached to the same object before it is relayed — the span
  the manager judged is the span the backend stores, `spanId` included.
  Requires Pinta Manager 0.1.11 or later; an older manager answers `400` and the
  gate fails open (`pinta.guard.fail_open_reason: error`), a newer manager that
  refuses a body answers `410`, recorded as `refused`.
- `@pinta-ai/core` `^0.6.0` → `^0.8.0` (`evaluateGuard(payload)`, `attachGuard`). `Telemetry.toolBeforePayload` builds the
  span the guard is asked about; `Telemetry.send` relays it once the verdict is
  attached.

## 0.8.0

- Version derived from one literal (`src/core/version.ts`); the build fails on drift.

## 0.7.0

- Telemetry now names each tool span by the opencode hook it arrived on
  (`opencode.hook` = `tool.execute.before` / `tool.execute.after` / `event`) —
  the same string the guard leg already sends as `method` — and reports
  `opencode.cwd`, which the guard leg already sent and this leg never did.

  Before this, the two halves of one tool call described it differently
  (`kind: "tool.before"` vs `method: "tool.execute.before"`) and the ingest
  parser dropped **every** span this plugin emitted, so opencode activity was
  guarded but never recorded. The parser side was widened first
  (`@pinta-ai/guard-runtime` 0.27.0) so already-installed copies of this plugin
  are recorded too; this release makes new installs speak the aligned names
  from the start.

  Tool fields follow the same vocabulary as the other adapters:
  `tool_name` / `tool_input` / `tool_response` / `tool_use_id`. Nothing is sent
  under two names — the parser accepts the old spelling on behalf of installed
  copies, and a field carried twice is a field whose copies can disagree.

  The redaction policy tracks the renamed keys, so shell secrets in
  `tool_input` / `tool_response` are still masked.

## 0.5.1

- Bump `@pinta-ai/core` `^0.3.0` → `^0.5.0` (devDependency, bundled
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
