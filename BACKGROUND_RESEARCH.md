# BACKGROUND_RESEARCH — pinta-opencode

> 목적: 기존 `pinta-cc`(Claude Code) / `pinta-codex`(OpenAI Codex) / `pinta-copilot`(GitHub Copilot)
> 와 동일한 역할을 하는 **`pinta-opencode`** 를 만들기 위한 사전 조사.
> 1) 세 어댑터가 "무엇을 / 어떻게" 하는지 정리하고,
> 2) opencode가 동일 목표를 달성할 수 있는지(hook 매칭 / tool allow·deny / 사유 출력) 검증한다.
>
> 조사 기준 소스: `/Users/pintaai/PINTA/{pinta-cc,pinta-codex,pinta-copilot,opencode}` (2026-06-11).

---

## 0. 한 줄 요약 (결론 먼저)

- **세 어댑터의 공통 정체성** = "코딩 에이전트의 hook 이벤트를 가로채 ① **OTLP 텔레메트리**로 전송(감사 로깅)하고, ② 선택적으로 외부 **guard 정책 서버**에 물어 tool 실행을 **ALLOW/DENY** 하고, DENY 시 **사람이 읽을 사유**를 에이전트에 되돌려주는" 거버넌스/관측 어댑터.
- **opencode는 세 가지 핵심 요구(가로채기 / 허용·거부 / 사유 출력)를 모두 지원한다.** ✅
  - **외부 제품 연동도 정식 지원**한다 — 오히려 cc/codex/copilot보다 깔끔하다. 이미 설치된 opencode에 ⓐ **npm 플러그인**(`opencode.json`의 `plugin:[...]`, 자동 npm 설치), ⓑ **플러그인 파일 드롭인**(`~/.config/opencode/plugins/*.ts` — cc/codex/copilot의 "hook 파일식"에 정확히 대응), ⓒ **설정 경로 참조**로 붙일 수 있다. opencode 소스 수정 0. (근거: `plugin/loader.ts`, `plugin/shared.ts:resolvePluginTarget`→`Npm.add`, `config/plugin.ts:load` 글로브.)
  - 차이는 *연동 통로*가 아니라 *실행 모델*이다: cc/codex/copilot은 이벤트마다 외부 프로세스를 spawn해 stdin/stdout JSON으로 통신하지만, opencode는 플러그인을 **in-process로 dynamic import** 한다. 즉 pinta-opencode는 "독립 바이너리"가 아니라 **import 가능한 JS/TS 모듈**이어야 한다(모듈 내부에서 HTTP·shell-out·SDK 호출은 자유). 완전 격리가 필요하면 server 모드 + SSE(`permission.asked`) + `permission.reply` 외부 게이트키퍼도 가능.
  - 따라서 pinta-opencode는 세 어댑터의 *연동 셸*(stdin/stdout 디스패처)은 버리고 **플러그인 엔트리로 새로 작성**하되, **core 레이어(OTLP/redact/guard/transport/trace/retry)는 거의 그대로 재사용**한다.

---

## 1. 세 어댑터가 하는 일 (TODO 체크리스트 형태)

### 1.1 공통 책임 (세 어댑터 전부 동일)

- [x] **텔레메트리 포워딩(항상 ON)** — 모든 hook 이벤트 1건 → OTLP/HTTP span 1건 → 임의의 OTel collector(Pinta relay)로 POST.
      - "Bronze flattening": 이벤트의 top-level 필드를 전부 `<host>.<key>` span attribute로 무손실 변환 (`cc.*` / `codex.*` / `copilot.*`, `ingest.type` 디스크리미네이터).
      - ULID → 32-hex traceId 변환, **user turn 1회 = trace 1개** (`UserPromptSubmit`에서 새 trace 시작).
- [x] **Secret redaction** — span 전송 전 ~17–18개 정규식으로 AWS/GCP/GitHub/JWT/PEM/DB-URL 비밀번호 등 마스킹(`[REDACTED:<type>]`) + 100KB 트렁케이션.
- [x] **Guardrail / 정책 집행(선택 ON)** — `PINTA_GUARD_ENDPOINT` 설정 시에만 동작. tool 실행 직전(`PreToolUse`)에 guard 서버에 POST → `ALLOW|DENY|REVIEW` 수신 → `DENY`면 tool 차단 + 사유 출력.
      - **정책은 로컬에 없다.** 전부 서버사이드(Pinta Manager의 `/guard/evaluate`)에 존재. 어댑터는 얇은 집행 클라이언트.
- [x] **Fail-open(텔레메트리) / 50ms guard 타임아웃** — 텔레메트리·guard 오류는 에이전트를 막지 않음. guard는 inline 경로라 매우 빨라야 하므로 50ms 하드 타임아웃, 타임아웃·비200·예외 = ALLOW로 폴백.
- [x] **프로세스-per-event + 디스크 영속** — hook은 매 이벤트마다 새 `node` 프로세스. 따라서 traceId·재시도 큐는 파일(`.plugin-data/trace.json`, `failed-spans.jsonl` + lock)로 cross-process 공유.
- [x] **No 로컬 정책 / No Pinta CLI 의존 / identity는 relay에서 부착**.

### 1.2 Guard 컨트랙트(세 어댑터 공통, 포팅 대상)

```
POST {PINTA_GUARD_ENDPOINT}
  header: x-pinta-relay-token: <PINTA_RELAY_TOKEN>
  body:   { "input": { spanId, toolName, toolInput, rawTextFields:{toolInput} } }
응답(200): { decision: "ALLOW"|"DENY"|"REVIEW", reason: string|null,
            userMessage?: string|null, durationMs?: number }
폴백: endpoint 없음 / PINTA_GUARD_DISABLED=1 / 비200 / 50ms 타임아웃 / throw → ALLOW
```
- DENY 사유 우선순위: `guard.userMessage` (예: `⛔ Blocked by Pinta AI — deny_resource_destruction`) → `guard.reason` → `"guard_deny"`.

### 1.3 호스트별 연동 컨트랙트 — 무엇을 기대하는가

세 호스트 모두 **"stdin으로 이벤트 JSON 1건 받고 → stdout으로 결정 JSON 출력(없으면 allow) → exit"** 라는 동일 골격. 차이는 *활성화/등록/환경주입/실패모드/이벤트 어휘*.

| 항목 | **pinta-cc** (Claude Code) | **pinta-codex** (Codex) | **pinta-copilot** (Copilot) |
|---|---|---|---|
| 등록 위치 | 플러그인 `hooks/hooks.json` (자동 발견) | `~/.codex/hooks.json` (수동 install, 절대경로 머지) | `~/.copilot/hooks/pinta-copilot.json` (직접 install) |
| 매니페스트 자동로드 | ✅ `.claude-plugin/plugin.json` | ❌ (`.codex-plugin/plugin.json`은 미래용 스캐폴딩) | ❌ (의도적으로 직접 install) |
| 활성화 플래그 | 불필요 | **`[features] codex_hooks=true`** in `config.toml` | 불필요 (CLI/VS Code 동일 파일 공유) |
| 이벤트 수 | 14종 등록(11 캡처) | **5종** | 12종 |
| Pre/PostToolUse 범위 | **모든 tool** | **Bash 전용**(현 Codex 한계) | 모든 tool |
| 환경변수 주입 | settings.json env-prefix로 주입 ✅ | **주입 안 함** → hook이 `~/.codex/pinta-codex.env` 직접 로드 | hook `env` 블록 + env-file |
| DENY 출력 형식 | `{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason}}` (stdout, exit 0) | 동일 (CC와 필드 동일) | `PreToolUse`=CC와 동일 / `permissionRequest`=`{behavior:"deny",message}` |
| 추가 게이팅 이벤트 | — | — | **`permissionRequest`**(CLI 전용) |
| **실패 모드** | **fail-open** (오류=ALLOW) | fail-open | ⚠️ **CLI `preToolUse`=fail-closed**(비정상종료=DENY) → **항상 exit 0** 규율 필수. VS Code ext는 fail-open |
| 이벤트명 디스크리미네이터 | `hook_event_name` (snake) | `hook_event_name` (snake) | `hook_event_name`/`hookName`/`hookEventName` 3-way + `PINTA_COPILOT_EVENT` env 폴백 |
| span prefix | `cc.*` | `codex.*` | `copilot.*` |

> **핵심 교훈**: 어려운 건 JSON 스키마가 아니라 호스트의 *활성화·등록·환경주입·실패모드*다. opencode는 이 골격 자체가 달라서 표의 모든 행이 재설계 대상이다.

---

## 2. opencode 확장 표면 분석 (검증 결과)

opencode는 **일급(first-class) 플러그인 시스템 + allow/deny/ask 권한 엔진 + 서버 이벤트 스트림(SDK/HTTP)** 을 문서화된 형태로 제공한다. 위 세 호스트와 달리 "프로세스-per-event/stdin-stdout"이 **아니다**.

### 2.1 플러그인 시스템
- 공개 패키지 `@opencode-ai/plugin` (`packages/plugin/src/index.ts`). 플러그인 = `async (input:PluginInput) => Hooks` 모듈.
- `PluginInput`은 opencode **SDK `client`**, `project`, `directory`, `worktree`, `serverUrl`, Bun shell `$` 제공 (`packages/plugin/src/index.ts:56`).
- 로드 경로: 글로벌/프로젝트 `opencode.json`의 `plugin:[...]` (npm), 그리고 `~/.config/opencode/plugins/`, `.opencode/plugins/` 디렉토리 자동 로드.

### 2.2 Tool 실행 가로채기 지점 (검증 ✅)
`packages/opencode/src/session/tools.ts` — **모든 tool(빌트인 + MCP)** 이 래핑되어 실행 전후로 플러그인 hook이 발화한다:
```ts
// session/tools.ts (빌트인 tool 래퍼)
yield* plugin.trigger("tool.execute.before",
  { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID }, { args })   // ← 실행 직전
const result = yield* item.execute(args, ctx)
yield* plugin.trigger("tool.execute.after",
  { tool: item.id, sessionID, callID, args }, output)                          // ← 실행 직후
```
`Hooks` 인터페이스(`packages/plugin/src/index.ts:222`):
```ts
"tool.execute.before"?: (input:{tool,sessionID,callID}, output:{args:any}) => Promise<void>
"tool.execute.after"?:  (input:{tool,sessionID,callID,args}, output:{title,output,metadata}) => Promise<void>
"tool.definition"?:     (input:{toolID}, output:{description,parameters}) => Promise<void>
"permission.ask"?:      (input:Permission, output:{status:"ask"|"deny"|"allow"}) => Promise<void>
"event"?:               (input:{event:Event}) => Promise<void>   // 모든 이벤트 관측
"chat.message"? / "chat.params"? / ...
```
- **차단 방법 2가지**: (a) `output.args`를 **참조로 변형**(예: bash 명령 escape), (b) hook에서 **throw** → tool 미실행 + throw가 tool-error로 LLM에 노출. 공식 문서 `.env 보호` 예제가 정확히 `throw new Error("Do not read .env files")`.

### 2.3 권한 엔진 (allow/deny/ask) — 검증 ✅
`packages/opencode/src/permission/index.ts` + 타입 `packages/core/src/v1/permission.ts`:
- Action = `"allow"|"deny"|"ask"`. 룰은 와일드카드 패턴 매칭, **마지막 매칭 룰 승리**, 기본값 `"ask"` (`evaluate()`).
- `Permission.ask`: `deny` 룰이면 즉시 `DeniedError`로 실패. `ask`면 **`permission.asked` 이벤트 publish 후 `Deferred`에서 블록**하여 외부 응답 대기.
- `Permission.reply({requestID, reply:"once"|"always"|"reject", message?})`가 그 Deferred를 해소. **이것이 외부 거버넌스 주입점.**
- 빌트인 tool(bash/edit 등)은 부작용 전에 `ctx.ask(...)`를 호출하고, MCP tool은 자동으로 `ctx.ask({patterns:["*"]})` 게이팅됨 (`session/tools.ts`).

### 2.4 사유(reason) 피드백 채널 — 검증 ✅
`packages/core/src/v1/permission.ts`:
```ts
class CorrectedError { feedback:string
  get message(){ return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}` } }
class DeniedError { ruleset; get message(){ return `...rule which prevents you... ${JSON.stringify(this.ruleset)}` } }
```
- `permission.reply({reply:"reject", message:"<사유>"})` → `CorrectedError.feedback` → tool-error로 **LLM 대화에 그대로 주입**.
- 또는 `tool.execute.before`에서 `throw new Error("<사유>")` → 동일하게 tool 결과로 LLM에 노출.

### 2.5 서버 / SDK (외부 게이트키퍼 경로) — 검증 ✅
- SDK `@opencode-ai/sdk` (`packages/sdk/`), `client.event.subscribe()` → SSE 스트림. 방출 이벤트에 `permission.asked` / `permission.replied` / `tool.execute.before|after` / `session.*` 포함.
- 응답 엔드포인트: `POST /session/{id}/permissions/{permissionID}` (`{reply, message?}`), 실험적 `POST /permission/:requestID/reply`, 목록 `GET /permission`.
- 참고 구현: `packages/opencode/src/cli/cmd/run.ts` 의 `permission.asked` → `client.permission.reply(...)` 루프.

---

## 3. 목표 달성 가능성 — Hook 매칭 / Allow·Deny / 사유 출력

### 3.1 Hook 이벤트 매칭표 (CC/Copilot hook → opencode 등가물)

| CC/Codex/Copilot hook | opencode 등가 | 비고 |
|---|---|---|
| `UserPromptSubmit` | `chat.message` hook 또는 `message.updated` 이벤트 | turn 시작 = 새 trace 트리거로 사용 |
| `PreToolUse` (게이팅) | **`tool.execute.before`** hook  /  `permission.asked` 이벤트 | ★ 핵심. 모든 tool에서 발화(빌트인+MCP) |
| `PostToolUse` | **`tool.execute.after`** hook | `output:{title,output,metadata}` 제공 |
| `PostToolUseFailure` | `tool.execute.after`의 결과/이벤트에서 파생 | 별도 전용 hook 없음 → after 결과로 판별 |
| `PermissionRequest`(Copilot) | `permission.asked` 이벤트 + `permission.reply` | opencode가 가장 풍부한 대응 |
| `SessionStart` / `Stop` / `SessionEnd` | `session.*` 이벤트 (`event` hook으로 전량 관측) | 라이프사이클 텔레메트리 |
| `Notification` / `Subagent*` / `PreCompact` | `event` hook (전체 이벤트 버스 구독) | opencode의 `event` hook 하나로 광범위 관측 가능 |

> opencode는 **`event` hook 하나로 거의 모든 라이프사이클 이벤트**를 관측할 수 있어 텔레메트리 커버리지는 오히려 더 넓다.

### 3.2 Tool use Allow / Deny — **가능 ✅** (두 가지 방식)

- **방식 A: In-process 플러그인** (`.opencode/plugins/` 또는 `plugin:[...]`)
  - `tool.execute.before`에서 guard 서버 호출 → `DENY`면 `throw new Error(reason)` 로 차단.
  - 장점: 별도 프로세스 불필요, opencode SDK `client`·Bun `$` 즉시 사용. **세 어댑터와 가장 유사한 동기·inline 모델.**
  - 주의: 이 hook의 시그니처는 `Promise<void>` — "allow"를 위해 명시적으로 무엇을 반환할 필요 없음(throw 안 하면 통과). guard ALLOW/REVIEW = no-op = 통과(세 어댑터의 "stdout 비움 = allow"와 의미 동일).

- **방식 B: 외부 게이트키퍼** (서버 이벤트 스트림 구독)
  - `permission: { "*": "ask" }` 로 모든 tool이 `permission.asked` 발화하게 만든 뒤, 외부 프로세스가 구독 → guard 판정 → `permission.reply({reply:"reject"|"once", message})`.
  - 장점: 에이전트 프로세스와 격리(강한 거버넌스). 단점: opencode 서버 모드 + 영속 프로세스 운영 필요(세 어댑터의 stateless 모델과 멀어짐).

> 권장: **방식 A(플러그인)** 를 기본으로 한다. 세 어댑터의 "tool 직전 inline guard + fail-open + 50ms" 패턴을 가장 충실히 재현하며, 운영 모델(설치=파일 한 개)도 단순하다.

### 3.3 사유(reason) 출력 — **가능 ✅**

- 방식 A: `throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny")` → 메시지가 tool-error로 LLM에 노출. 세 어댑터의 `permissionDecisionReason`과 동일 효과.
- 방식 B: `permission.reply({reply:"reject", message: <사유>})` → `CorrectedError.feedback`로 LLM에 주입.
- 두 경로 모두 **사람이 읽는 브랜드 사유**(`⛔ Blocked by Pinta AI — <rule>`)를 그대로 전달 가능.

### 3.4 갭 / 주의사항 (반드시 반영)

- ⚠️ **`permission.ask` *플러그인* hook은 인터페이스에 선언돼 있으나 현재 opencode 소스 어디에서도 `plugin.trigger("permission.ask")`가 호출되지 않음**(미배선). → **이 hook에 의존하지 말 것.** 실제로 배선되어 발화하는 게이팅 지점은 `tool.execute.before`(그리고 빌트인 `ctx.ask`→권한엔진→`permission.asked` 이벤트)다. 거부는 ① `tool.execute.before` throw 또는 ② `permission.reply`로 구현.
- ⚠️ **프로세스 모델 차이**: opencode 플러그인은 **세션 수명 동안 살아있는 in-process 모듈**이다. 세 어댑터의 "프로세스-per-event + 파일 영속" 가정이 불필요해진다 → traceId/재시도 큐를 **메모리에 보관** 가능(단, opencode 서버 재시작 대비 디스크 백업은 선택).
- ⚠️ **stdin/stdout 컨트랙트 없음**: 결정은 stdout JSON이 아니라 throw/return-mutate(플러그인) 또는 HTTP reply(서버). DENY JSON 직렬화 코드는 **버리고** 호출부를 새로 작성.
- ✅ **설정/옵션 전달은 확정**(코드 검증): 플러그인은 `process.env`를 직독하고, **`opencode.json`의 플러그인 옵션이 엔트리 2번째 인자로 전달**된다 — `plugin.server(input, options)` (`plugin/index.ts:applyPlugin`, `config/plugin.ts:pluginOptions`). 즉 `PINTA_GUARD_ENDPOINT`/`PINTA_RELAY_TOKEN`/OTLP 키는 **env 또는 `plugin:[["@pinta-ai/pinta-opencode",{endpoint,guard,...}]]` 옵션** 어느 쪽으로도 주입 가능. (단, opencode엔 "env로 hook 명령을 주입"하는 메커니즘은 없음 — 등록은 config/디렉토리로.)
- ⚠️ **fail-open 보장**: guard fetch를 try/catch로 감싸 throw가 새지 않게(텔레메트리·guard 오류로 tool을 막지 않도록). DENY일 때만 의도적 throw.
- ℹ️ **재사용 가능**: `core/otlp.ts`, `core/redact.ts`, `core/guard.ts`, `core/transport.ts`, `core/retry-queue.ts`, `core/trace.ts` 는 호스트 독립적 → pinta-cc/copilot에서 거의 그대로 가져오고 prefix만 `opencode.*`, `ingest.type=opencode` 로 교체.

### 3.5 설치 / 등록 모델 (코드 검증 — 외부 연동 방법)

이미 설치된 opencode에 **소스 수정 없이** 붙이는 3가지 통로:

| 통로 | 방법 | cc/codex/copilot 대응 | 근거 |
|---|---|---|---|
| ⓐ npm 플러그인 | `opencode.json` → `"plugin":["@pinta-ai/pinta-opencode"]`. opencode가 `Npm.add(...@latest)`로 **자동 설치** + 버전 호환성 체크 후 import | "플러그인식"(`.claude-plugin/`) | `plugin/shared.ts:207 resolvePluginTarget`, `loader.ts:checkPluginCompatibility` |
| ⓑ 파일 드롭인 | `~/.config/opencode/plugins/*.ts`(글로벌) 또는 `.opencode/plugins/*.ts`(프로젝트)에 파일 1개. **자동 발견**(config 편집 불필요) | "hook 파일식"(`~/.codex/hooks.json`, `~/.copilot/hooks/*.json`) | `config/plugin.ts:load` 글로브 `{plugin,plugins}/*.{ts,js}` |
| ⓒ 경로 참조 | `"plugin":["./pinta-opencode.ts"]` 또는 절대경로/`file://` | — | `config/plugin.ts:resolvePluginSpec` |

- 옵션 동봉: `"plugin":[["@pinta-ai/pinta-opencode",{ "endpoint":"…", "guard":"…" }]]` → 엔트리에 `(input, options)`로 전달.
- 권장 배포: **ⓐ npm**(버전 호환성 게이트 + 자동 설치, Pinta Manager가 `opencode.json`에 한 줄 주입) 기본, **ⓑ 드롭인**은 무발행 로컬/엔터프라이즈 설치용.
- ❗제약: 엔트리는 **import 가능한 모듈**이어야 함(독립 바이너리 불가). npm 패키지는 `package.json`에 opencode 호환 범위를 선언해야 호환성 게이트 통과.

---

## 4. 권장 아키텍처 (pinta-opencode)

```
opencode 세션
  └─ .opencode/plugins/pinta-opencode.ts  (또는 npm @pinta-ai/pinta-opencode)
       export default async ({client, directory, $}) => ({
         event:              e => emitTelemetrySpan(e),     // 라이프사이클 전량 관측 → OTLP
         "tool.execute.before": async (input, output) => {  // ★ 게이팅
            const span = mkSpan(input, output.args)
            const guard = await evaluateGuard({spanId, toolName:input.tool,
                                               toolInput:output.args, rawTextFields}, ENDPOINT) // 50ms, fail-open
            await sendTelemetry(span, guard)                 // 텔레메트리는 항상
            if (guard?.decision === "DENY")
               throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny")  // 사유 + 차단
         },
         "tool.execute.after":  (input, output) => emitTelemetrySpan(...),
       })
```
- 재사용 core(otlp/redact/guard/transport/trace/retry) + 신규 셸(이 플러그인 1파일).
- 텔레메트리(`event` + `tool.execute.after`)와 집행(`tool.execute.before`)은 독립 → telemetry-only 모드도 동일 코드로 지원.

---

## 5. 실행 TODO (pinta-opencode 구현 백로그)

- [ ] **T1. 스캐폴딩**: `pinta-opencode` 패키지 생성(pinta-copilot를 fork). `package.json`/`tsconfig`/`vitest` 복사, deps 제거(런타임 무의존 유지).
- [ ] **T2. core 포팅**: `core/{otlp,redact,guard,transport,trace,retry-queue,config}.ts` 가져와 prefix `opencode.*`, `service.name=opencode`, `telemetry.sdk.name=pinta-opencode`, `ingest.type=opencode` 로 교체.
- [ ] **T3. 플러그인 엔트리**: `src/plugin.ts` (또는 `.opencode/plugins/pinta-opencode.ts`) — §4 구조로 `event`/`tool.execute.before`/`tool.execute.after` 구현. throw로 DENY + 사유.
- [ ] **T4. 이벤트 매핑**: opencode `event` 버스 → §3.1 매핑표대로 `UserPromptSubmit`(새 trace)/`Stop`/`Session*` 식별. opencode 이벤트 타입 확인(`packages/sdk` 이벤트 목록).
- [ ] **T5. 설정 주입**: `PINTA_GUARD_ENDPOINT`/`PINTA_RELAY_TOKEN`/OTLP 키를 env + 플러그인 옵션 양쪽에서 로드. `~/.config/opencode/pinta-opencode.env` 폴백(unset-only).
- [ ] **T6. fail-open/타임아웃 검증**: guard 50ms(또는 300ms 운영값), 모든 오류 경로 ALLOW, throw 누수 없음 테스트.
- [ ] **T7. 사유 표면 확인**: DENY throw 메시지가 실제 opencode 대화/TUI에 `⛔ Blocked by Pinta AI — <rule>` 로 노출되는지 e2e.
- [ ] **T8. (선택) 외부 게이트키퍼 모드**: 서버 SSE 구독 + `permission.reply` 경로를 격리 거버넌스 옵션으로 추가.
- [ ] **T9. 다운스트림**: aware-backend `opencode` ingest 슬라이스(`cc`/`copilot` 슬라이스 복제), `OPENCODESPAN#` DynamoDB prefix, OpenSearch `opencode*` 매핑, Manager 사이드카 enroll, catalog 엔트리.
- [ ] **T10. 문서**: DESIGNDOC.md(pinta-copilot 양식)로 "as-built" 결정 기록.

---

## 6. 참고 파일 (근거)

- pinta-cc: `src/handlers/pre-tool-use.ts`, `src/core/{guard,otlp,types,trace,redact}.ts`, `hooks/hooks.json`, `.claude-plugin/plugin.json`
- pinta-codex: `src/handlers/pre-tool-use.ts`, `src/core/config.ts:113`(env 미주입 워크어라운드), `hooks.json`, `~/.codex/config.toml` 플래그
- pinta-copilot: `DESIGNDOC.md`(D1~D11 결정), `src/core/types.ts`(3-way 디스크리미네이터, `formatDeny`), `src/index.ts`(항상 exit 0)
- opencode: `packages/plugin/src/index.ts:222`(Hooks), `packages/opencode/src/session/tools.ts`(가로채기), `packages/opencode/src/permission/index.ts` + `packages/core/src/v1/permission.ts`(결정/사유 타입), `packages/opencode/src/cli/cmd/run.ts`(reply 루프 참조), `packages/web/src/content/docs/plugins.mdx`(`.env` 차단 예제)
