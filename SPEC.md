# SPEC — pinta-opencode

> opencode용 Pinta 거버넌스/관측 어댑터. cc/codex/copilot 어댑터와 **동일한 백엔드 컨트랙트**(OTLP 텔레메트리 + guard 정책 집행)를, opencode의 **in-process 플러그인** 모델로 제공한다.
>
> 근거: [`BACKGROUND_RESEARCH.md`](./BACKGROUND_RESEARCH.md)(세 어댑터 분석), [`HYPOTHESIS_VALIDATION.md`](./HYPOTHESIS_VALIDATION.md)(opencode 1.15.3 실측 §10~13). 본 SPEC의 모든 동작은 실측으로 검증됨.

---

## 1. 목적 / 범위

pinta-opencode는 opencode에 로드되는 단일 플러그인으로:
1. **텔레메트리(항상 ON)** — 세션 라이프사이클·tool 실행을 OTLP/HTTP span으로 Pinta relay에 전송(감사·관측).
2. **거버넌스(선택 ON)** — tool 실행 직전 외부 guard 정책 서버에 질의해 `ALLOW/DENY/REVIEW` 판정, `DENY` 시 해당 tool을 차단하고 사람이 읽는 사유를 에이전트에 환류.

### Non-goals
- 로컬 정책 엔진 구현(정책은 서버사이드 Pinta Manager에 존재; 어댑터는 얇은 클라이언트).
- opencode 소스 수정(설치 통로만 사용: npm `plugin` / 파일 드롭인).
- 독립 실행 바이너리(opencode가 in-process import → **import 가능한 JS/TS 모듈**이어야 함).
- 외부 게이트키퍼(server+SSE+`permission.reply`) 모드는 **v2 선택지**로 보류(§12).

---

## 2. 아키텍처

```
[opencode instance]  ── import @pinta-ai/pinta-opencode (server(input, options) → Hooks) ──┐
                                                                                          │
  hooks:                                                                                  │
   event              ─▶ Telemetry.lifecycle(ev)         ── OTLP span ─┐                  │
   chat.message       ─▶ Trace.rotate(sessionID)  (turn-START)         │                  │
   tool.execute.before─▶ Guard.evaluate → DENY? throw(reason)  +span ──┤                  │
   tool.execute.after ─▶ Telemetry.tool(after)           ── OTLP span ─┤                  │
                                                                       ▼                  ▼
                                                       Transport(OTLP) ──▶ Pinta relay   Guard server
                                                       (5s, retry)         (collector)   (50ms, fail-open)
```

- **재사용 core**(cc/copilot에서 포팅): `otlp` / `redact` / `transport` / `retry-queue` / `guard` / `trace`.
- **신규 셸**: `plugin.ts`(엔트리), `config.ts`(옵션/env 머지), `telemetry.ts`(event→span 매핑).
- **상태**: 인스턴스당 1회 init 클로저에 **in-memory**(sessionID 키). 파일 영속은 서버 재시작 내구성용 *선택*. (검증: 플러그인은 인스턴스 수명 동안 1회 인스턴스화 — H-C1.)

---

## 3. 배포 / 설치

| 통로 | 형태 | 용도 |
|---|---|---|
| **npm**(기본) | `opencode.json` → `"plugin":[["@pinta-ai/pinta-opencode",{…}]]`. opencode가 자동 `Npm.add` + `engines.opencode` 호환성 게이트 | Pinta Manager 자동 enroll |
| **파일 드롭인** | `~/.config/opencode/plugins/pinta-opencode.js` (글로벌) 또는 `.opencode/plugins/`(프로젝트) | 무발행/엔터프라이즈 |
| 경로 참조 | `"plugin":["/abs/path.js"]` / `file://` | 개발 |

- **`package.json`**: ESM, 런타임 무의존(세 어댑터 정책 계승), `"engines":{"opencode":">=1.15.0"}`(검증 버전), 엔트리는 named export `export const PintaOpencode = async (input, options) => Hooks` (legacy 형식 — opencode가 모듈의 export된 함수를 `server(input, options)`로 호출). v1 `export const server` 형식도 호환.

---

## 4. 설정 (Configuration)

해석 우선순위: **플러그인 옵션(2번째 인자) → `process.env` → `~/.config/opencode/pinta-opencode.env`(unset-only)**. (검증: 옵션·env 모두 런타임 가시 — G5.)

| 키(옵션 / env) | 의미 | 기본 |
|---|---|---|
| `endpoint` / `PINTA_OTLP_ENDPOINT` (또는 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) | OTLP traces 전송 URL | (없으면 텔레메트리 비활성) |
| `headers` / `OTEL_EXPORTER_OTLP_HEADERS` | `k=v,k=v` 헤더 | — |
| `guard` / `PINTA_GUARD_ENDPOINT` | guard 정책 서버 URL | (없으면 거버넌스 비활성) |
| `PINTA_RELAY_TOKEN` | guard·OTLP 인증 → `x-pinta-relay-token` | — |
| `PINTA_GUARD_TIMEOUT_MS` | guard 타임아웃 | 50 (운영 300 권장) |
| `PINTA_GUARD_DISABLED=1` | guard 강제 비활성 | — |

- 등록 자체는 env로 불가(config/디렉토리만). 텔레메트리·거버넌스는 독립 — endpoint만 / guard만 / 둘 다 / 둘 없음 모두 유효.

---

## 5. Hook 통합 컨트랙트 (검증된 페이로드)

opencode가 발화하는 hook과 본 어댑터의 처리:

| hook | 입력(검증) | 처리 |
|---|---|---|
| `event` | `{event:{id, type, properties}}`. 모든 이벤트 `properties.sessionID` 보유 | 라이프사이클 span(Bronze flatten). turn-END(`session.idle`)에 flush |
| `chat.message` | `{sessionID, agent, model, messageID, variant}` | **turn-START → 새 trace 회전** |
| `tool.execute.before` | input `{tool, sessionID, callID}`, output `{args}`(변형가능 전체 인자) | **guard 평가 → DENY면 throw(사유)**, span 전송 |
| `tool.execute.after` | input `{tool, sessionID, callID, args}`, output `{title, output, metadata, attachments}` (bash metadata=`{output,exit,description,truncated}`) | tool 결과 span(exit·truncated 포함) |
| `tool.definition` | `{toolID}` | (선택) tool 인벤토리 관측 |

- ❌ `permission.ask` 플러그인 hook은 **미배선** — 의존 금지(K2 검증). 게이팅은 `tool.execute.before`로만.

### Trace 모델
- `chat.message`(turn-START) → sessionID에 새 ULID traceId 배정.
- 이후 모든 span은 같은 trace. `session.idle`(turn-END) → transport flush.
- 다중 세션 동시 진행 대비 **traceId는 sessionID 키 맵**으로 관리.

---

## 6. 텔레메트리 (OTLP)

- **Span 소스 2종**: ① `event` hook(라이프사이클·메시지) ② `tool.execute.before/after`(tool 호출 — 인자·출력·exit가 더 풍부하므로 tool span은 여기서 생성, `event` 버스 아님 — G6 결정).
- **Bronze flattening**: 이벤트 top-level 필드를 `opencode.<key>` attribute로 무손실. 공통 `ingest.type="opencode"`, `service.name="opencode"`, `telemetry.sdk.name="pinta-opencode"`. guard 결과는 `pinta.guard.{decision,duration_ms,matched_rule,fail_open_reason}`.
- **traceId**: ULID → 32-hex 변환(core `otlp.ts` 재사용).
- **Redaction**: 전송 전 core `redact.ts`(AWS/GCP/GitHub/JWT/PEM/DB-URL 등 마스킹) + 100KB 트렁케이션. tool args·output에 적용.
- **Transport**: `endpoint` 미설정 시 silent-disable. 5s 타임아웃, 실패 시 in-memory(+선택 디스크) retry-queue, 다음 이벤트에 batched flush.

---

## 7. 거버넌스 (Guard / 집행)

### Guard 컨트랙트 (cc/codex/copilot과 동일 — 백엔드 무변경)
```
POST {guard}   header: x-pinta-relay-token: {PINTA_RELAY_TOKEN}
body: { input: { spanId, toolName, toolInput, rawTextFields:{toolInput} } }
응답(200): { decision:"ALLOW"|"DENY"|"REVIEW", reason, userMessage?, durationMs? }
```
- **호출 지점**: `tool.execute.before` (모든 tool — 빌트인+MCP). `guard` 미설정 시 스킵.
- **타임아웃 50ms(운영 300ms)**, **fail-open**: 미설정 / `PINTA_GUARD_DISABLED=1` / 비200 / 타임아웃 / throw → ALLOW(`fail_open_reason` 기록).
- **집행**: `DENY` → `throw new Error(userMessage ?? reason ?? "guard_deny")`.
  - 검증된 효과(H-A1/G7): **해당 tool만 차단**, `tool.execute.after` 미발화, 사유가 `✗ … failed` + `Error: <사유>`로 TUI/LLM에 환류, **세션 생존**. `REVIEW`/`ALLOW` → 통과(no-op).
- **사유 우선순위**: `userMessage`(예: `⛔ Blocked by Pinta AI — <rule>`) → `reason` → `"guard_deny"`.

---

## 8. 실패 / 안전 모델

- **fail-open 불변식**: 텔레메트리·guard의 모든 오류 경로는 tool을 막지 않는다. DENY일 때만 의도적 throw.
- guard fetch·span 전송은 try/catch로 격리(throw 누수 0). transport는 fire-and-forget(tool 실행 비차단 — G7 검증).
- opencode CLI는 cc/copilot의 fail-closed 함정 없음(throw=그 tool만 실패) → "항상 exit 0" 규율은 불필요하나, **의도치 않은 throw 금지** 원칙은 유지.

---

## 9. 다운스트림 (aware-backend / Manager / catalog)

cc/copilot 슬라이스 복제(pinta-copilot DESIGNDOC §8 패턴):
- aware-backend: `opencode` ingest 슬라이스(`cc` 슬라이스 클론), DynamoDB `OPENCODESPAN#` prefix, OpenSearch `opencode*` 매핑(additive).
- Pinta Manager: 사이드카 enroll이 `opencode.json`에 `plugin` 한 줄 + 설정 주입.
- pinta-catalog: `@pinta-ai/pinta-opencode` 엔트리(sha256).

---

## 10. 수용 기준 (Acceptance) — 전부 검증 완료

- [x] 이미 설치된 opencode에 소스 수정 0으로 로드(npm/드롭인/경로).
- [x] tool 실행 전 가로채기(`tool.execute.before`, 빌트인+MCP).
- [x] 외부 guard 판정으로 ALLOW/DENY, DENY 시 해당 tool 차단 + 세션 생존.
- [x] 사유(`⛔ Blocked by Pinta AI — …`)를 에이전트/TUI에 환류.
- [x] OTLP span을 collector가 수신(라이프사이클 + tool, guard 결과 부착).
- [x] 50ms fail-open guard가 ALLOW 경로를 막지 않음.
- [x] 옵션·env로 endpoint/guard 주입.

---

## 11. 버전 호환

- 검증 기준: **opencode 1.15.3**. `engines.opencode` semver 게이트로 하한 명시.
- 의존 API(전부 비-experimental): `event` / `chat.message` / `tool.execute.before` / `tool.execute.after` hook, 플러그인 옵션 2번째 인자. `experimental.*` hook 미사용.

## 12. 향후 (v2 선택)

- 외부 게이트키퍼 모드(server + SSE `permission.asked` + `permission.reply`) — 프로세스 격리가 필요한 엔터프라이즈용.
- `tool.execute.before`의 `args` 변형을 통한 인자 sanitize(redaction-in-place).
- `tool.definition`을 통한 tool 비활성/설명 주입.
