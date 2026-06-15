# HYPOTHESIS_VALIDATION — pinta-opencode

> 목적: **spec/plan을 한 번에 정확히 쓰기 위해**, 그 spec이 의존하는 가정들을 *쓰기 전에* 실험으로 검증한다.
> 특히 "안다고 착각하는 것"(known knowns)과 "모른다는 걸 아는 것"(known unknowns)을 넘어,
> **"모른다는 것조차 모르는 것"(unknown unknowns)** 을 의도적으로 끌어내는(=놀라움을 유발하는) 프로세스를 정의한다.
>
> 전제 문서: [`BACKGROUND_RESEARCH.md`](./BACKGROUND_RESEARCH.md). 거기서 *소스 코드로 검증된 사실*과 *문서/추론에 의존한 가정*을 구분한다.
>
> **🟢 Phase-1 실측 완료(2026-06-15)** — 핵심 가설 H-A1/B1/B2/C1을 실제 opencode 1.15.3에서 프로브로 검증함. 결과는 §10. 원시 로그 샘플: [`phase1-probe-sample.jsonl`](./phase1-probe-sample.jsonl).

---

## 0. 왜 이 프로세스가 필요한가

세 어댑터(pinta-cc/codex/copilot)는 모두 같은 함정에 빠졌다 흔적이 있다: **"stdin/stdout JSON 컨트랙트는 동일하다"는 가정 → 실제로는 활성화/등록/환경주입/실패모드가 호스트마다 달라서** 각 어댑터가 별도 워크어라운드(`codex_hooks=true`, env-file 자체 로드, 항상 exit 0, 3-way 디스크리미네이터)를 *나중에* 붙였다. 이 워크어라운드들은 전부 **"코드 짜고 돌려보다 놀라서"** 발견된 unknown-unknown이었다.

pinta-opencode는 연동 모델 자체가 다르므로(in-process 플러그인 + 이벤트 스트림) **새로운 unknown-unknown 표면**을 가진다. 한 번에 맞는 spec을 쓰려면, "놀라움"을 spec 작성 *이후*가 아니라 *이전*에 끌어내야 한다.

### 검증의 ROI 원칙
- 모든 가정을 검증하지 않는다. **spec을 바꿀 수 있는 가정(load-bearing)만** 검증한다.
- 우선순위 = **영향도(틀리면 재설계) × 불확실성(현재 신뢰도)**. 둘 다 높은 것부터.
- 검증은 **반증 가능(falsifiable)** 해야 한다. "되는지 본다"가 아니라 "X면 H 참, Y면 H 거짓, 그러면 Z로 간다"까지 미리 적는다.

---

## 1. 신뢰도 분류 — 무엇을 이미 아는가 (검증 게이트의 출발점)

BACKGROUND_RESEARCH에서 **소스를 직접 읽어 확정한 사실**과 **아직 가정인 것**을 분리한다. 후자만 검증 대상.

| # | 명제 | 현재 신뢰도 | 근거 |
|---|---|---|---|
| K1 | `tool.execute.before`가 빌트인+MCP 모든 tool 실행 직전 발화 | **확정** | `session/tools.ts` 직접 확인 |
| K2 | `permission.ask` *플러그인* hook은 미배선(호출 안 됨) | **확정** | `grep plugin.trigger` 결과 0 |
| K3 | `CorrectedError.feedback` / `DeniedError`가 LLM-facing 메시지 텍스트를 가짐 | **확정** | `core/v1/permission.ts` 직접 확인 |
| K4 | `permission.reply({reply,message})` + `permission.asked` 이벤트 존재 | **확정** | `permission/index.ts` 직접 확인 |
| A1 | `tool.execute.before`에서 throw하면 **그 tool만** 차단되고 메시지가 LLM에 tool-error로 노출(세션은 계속) | **가정(문서)** | `plugins.mdx` 예제, 미실행 |
| A2 | 플러그인은 세션 수명 동안 **1회 인스턴스화**되어 살아있다(상태 보관 가능) | **가정** | 미검증 |
| A3 | `event` hook으로 라이프사이클 이벤트 전량 관측 가능 + **필드 이름을 안다** | **가정** | 이벤트 *목록*만 봄, *페이로드 필드*는 미확인 |
| A4 | turn 경계(UserPromptSubmit 등가)를 식별할 이벤트가 존재 | **가정** | 미확인 |
| A5 | 플러그인이 headless(`opencode run`)/TUI/server 모두에서 동일 로드 | **가정** | 미확인 |
| A6 | async hook은 tool 실행을 **inline 블록**(50ms guard 삽입 가능) | **가정** | `await plugin.trigger` 형태로 추정, 미측정 |
| ~~A7~~ | 플러그인 옵션/env 전달 경로 | **확정**(정정) | `plugin.server(input, options)` — 옵션은 엔트리 2번째 인자. env는 `process.env` 직독. (`plugin/index.ts:applyPlugin`) |
| K5 | 외부 연동 통로 = npm `plugin:[...]`(자동설치) / `~/.config/opencode/plugins/*.ts` 드롭인 / 경로참조 | **확정** | `plugin/shared.ts:resolvePluginTarget`→`Npm.add`, `config/plugin.ts:load` |

> **검증 대상 = A1~A7** + 아래 §3에서 추가로 끌어낼 unknown-unknown.

---

## 2. 프로세스 단계 (Phase 0 → 4)

```
Phase 0  FRAME      spec이 의존하는 가정을 나열 → 영향×불확실로 랭킹 → load-bearing 선정
   │                산출물: 가정 레지스터(§1 표 + 추가분)
Phase 1  DISCOVER   "전부 로깅하는" 프로브 플러그인으로 opencode를 다양한 작업에 노출
   │                → 로그를 *놀라움을 찾으며* 정독 (unknown-unknown 사냥)
   │                산출물: 관측 로그 + "예상과 달랐던 것" 목록
Phase 2  TEST       각 load-bearing 가정을 반증가능 실험으로 1:1 검증
   │                산출물: 실험 로그(H/예측/실측/판정/대응)
Phase 3  SMOKE      thin end-to-end 슬라이스(텔레메트리 1 span + DENY 1건)로 통합 검증
   │                산출물: e2e 증거(span 저장됨 / DENY 사유 노출됨)
Phase 4  CONSOLIDATE  검증된 사실 → "spec-ready facts" 표 → spec/plan 작성
                     게이트 통과 시에만 spec 착수
```

핵심은 **Phase 1을 Phase 2보다 먼저** 둔 것이다. Phase 2(가설 검증)는 *이미 떠올린* 가정만 다룬다 → known unknowns만 잡는다. unknown-unknowns는 Phase 1의 "광범위 노출 + 놀라움 탐색"에서만 나온다.

---

## 3. Phase 1 — Unknown-Unknown 사냥 (가장 중요)

목표: 우리가 *질문조차 못 한* 사실을 강제로 표면화. 방법은 "**관측을 극대화하고, 입력을 다양화하고, 예측과 실측의 차이를 사냥**".

### 3.1 프로브 플러그인 (throwaway instrumentation)
모든 hook을 등록해 **입력 전체를 JSONL로 덤프**하고, 아무것도 차단하지 않는 관측 전용 플러그인. `.opencode/plugins/_probe.ts`:

```ts
// 관측 전용. 어떤 결정도 내리지 않는다. 모든 것을 기록만 한다.
import fs from "node:fs"
const LOG = "/tmp/pinta-probe.jsonl"
const rec = (hook: string, input: unknown, output?: unknown) =>
  fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), hook, input, output }) + "\n")

export default async (ctx: any) => {
  rec("__init__", { keys: Object.keys(ctx), directory: ctx.directory, serverUrl: String(ctx.serverUrl) })
  return {
    event: async (i: any) => rec("event", i),                       // ← 이벤트 어휘/필드 전수 수집
    "chat.message": async (i: any, o: any) => rec("chat.message", i, { partsLen: o?.parts?.length }),
    "tool.execute.before": async (i: any, o: any) => rec("tool.execute.before", i, o), // args 원형 확인
    "tool.execute.after": async (i: any, o: any) =>
      rec("tool.execute.after", i, { title: o?.title, outLen: String(o?.output ?? "").length, meta: o?.metadata }),
    "tool.definition": async (i: any, o: any) => rec("tool.definition", i, { desc: o?.description?.slice(0, 60) }),
    "permission.ask": async (i: any, o: any) => rec("permission.ask", i, o), // K2 재확인: 정말 안 불리나?
  }
}
```

### 3.2 노출 배터리 (입력 다양화 — 각각이 다른 코드경로를 때린다)
같은 작업만 시키면 같은 unknown만 본다. **의도적으로 다른 형태**를 섞는다:

- [ ] B-read: 파일 읽기 (`read`) — 순수 부작용 없는 tool
- [ ] B-bash: 쉘 명령 (`bash`) — 네이티브 권한 프롬프트 있는 tool
- [ ] B-edit: 파일 수정 (`edit`/`write`) — 승인 게이트 tool
- [ ] B-mcp: MCP tool 1개 — 자동 `ctx.ask({patterns:["*"]})` 경로
- [ ] B-task: `task`(subagent) tool — **중첩 세션** 발생 여부
- [ ] B-parallel: 한 턴에 tool 여러 개 동시 호출 → 동시성/순서
- [ ] B-deny: 사용자가 TUI에서 권한 거부 → `permission.replied` 형태
- [ ] B-multiturn: 3턴 연속 대화 → turn 경계/trace 회전 신호
- [ ] B-headless: `opencode run "..."` (비대화형) vs TUI vs `serve` — 각각에서 플러그인 로드되나
- [ ] B-error: 일부러 실패하는 명령 → 실패 이벤트 표현(PostToolUseFailure 등가)

### 3.3 놀라움 탐색 체크리스트 (로그 정독 시 질문)
로그를 *확인*이 아니라 *반증*하려고 읽는다. 각 항목에 "예상 → 실제"를 적는다:

- [ ] `__init__`는 **세션당 1회**인가, **턴당/툴당** 인가? (→ A2: 상태 모델)
- [ ] `event` payload의 **실제 필드 이름**은? (`type`? `properties`? snake/camel?) (→ A3: Bronze flatten 키)
- [ ] turn 시작을 알리는 이벤트 type 이름은 무엇인가? (`message.updated`? `session.idle`?) (→ A4: trace 회전)
- [ ] `tool.execute.before`의 `output.args`는 **스키마 검증 후/전**? 다른 플러그인 변형 후 순서?
- [ ] subagent(task) tool은 **별도 sessionID**로 자체 `tool.execute.before`를 다시 쏘는가? trace 상관관계는?
- [ ] bash 네이티브 권한 프롬프트와 우리 hook의 **발화 순서**는? (before가 ask보다 먼저/나중)
- [ ] 한 턴 다중 tool 시 hook이 **순차/병렬**? state race 위험?
- [ ] tool_output에 **이미지/대용량 attachment** 가 들어오나? (after hook redaction 부하)
- [ ] 예상 못 한 hook이 불리거나, 예상한 hook이 **안 불리는** 경우는?

> **산출물**: `OBSERVATIONS.md` — "예상과 달랐던 것" 목록. 이게 unknown→known 전환의 증거다. 여기서 새 가정이 발견되면 §4 카탈로그에 추가.

---

## 4. Phase 2 — 가설 검증 카탈로그 (known unknowns)

각 가설은 **반증 가능**하다. 형식: *가설 / spec 영향 / 프로브 / 예측 / 확정·반증 기준 / 반증 시 대응*.

### 그룹 A. 가로채기 & 제어흐름 (가장 load-bearing)

**H-A1 — throw = 단일 tool 차단 + LLM 사유 노출, 세션 지속**
- spec 영향: ★★★ 거부 메커니즘의 근간. 거짓이면 전체 아키텍처 변경.
- 프로브: 프로브 플러그인에 `if (i.tool==="bash" && o.args.command.includes("rm")) throw new Error("⛔ Blocked by Pinta AI — test")` 추가 후 `rm` 명령 유도.
- 예측: bash만 실패, 에러 메시지가 LLM/TUI에 tool 결과로 표시, 다음 tool/턴 정상.
- 확정: 위 관측 일치. **반증**: 세션 크래시 / 메시지 미표시 / 다른 tool까지 죽음.
- 반증 시 대응: 외부 게이트키퍼(`permission.reply`) 모드로 전환(§B 방식). throw 대신 `ctx.ask` 경유 거부 탐색.

**H-A2 — async hook은 inline 블록(guard fetch를 await 가능)**
- spec 영향: ★★★ guard를 동기 inline에 넣을 수 있는지. 거짓이면 텔레메트리/집행 분리 설계 변경.
- 프로브: before hook에 `await sleep(200)` + 타임스탬프 로깅 → tool 실행 시각이 200ms 뒤인지 측정.
- 예측: tool 실행이 hook 완료까지 지연됨(블로킹).
- 반증: hook이 fire-and-forget(지연 없음) → 그러면 throw 차단도 안 먹힐 가능성 → H-A1 재확인 필요.
- 반증 시 대응: 게이트키퍼 모드로 전환.

**H-A3 — `output.args` 변형이 실제 실행 인자에 반영**
- spec 영향: ★ (redaction-in-place 또는 인자 sanitize 옵션 쓸 경우)
- 프로브: before에서 `o.args.command = "echo MUTATED"` → 실제 실행 결과 확인.
- 예측: 변형된 명령 실행. 반증: 원본 실행 → 변형 불가, throw만 유효.

### 그룹 B. 이벤트 / 텔레메트리 표면

**H-B1 — `event` hook 페이로드로 Bronze flatten에 충분한 필드(sessionID, type, tool명 등)가 온다**
- spec 영향: ★★★ OTLP span 속성/디스크리미네이터 키. 필드명 모르면 otlp.ts 못 씀.
- 프로브: Phase 1 로그에서 `event` 레코드의 키 전수 수집 → 표로.
- 예측: `{ type: string, properties: {...} }` 형태.
- 확정: 실제 필드명 문서화. 반증: 필드가 빈약 → tool.execute.before/after에서 직접 span 생성으로 대체.

**H-B2 — turn 경계 식별 가능(trace 회전 신호 존재)**
- spec 영향: ★★ "turn=trace 1개" 모델 유지 여부.
- 프로브: B-multiturn 로그에서 매 턴 시작에 공통으로 나오는 이벤트 type 식별.
- 예측: `message.updated`(role=user) 또는 유사.
- 반증: 명확한 신호 없음 → sessionID 기반 trace + 유휴타임아웃 기반 회전으로 폴백.

**H-B3 — tool 결과 크기/형식이 redaction·truncation 설계와 호환**
- spec 영향: ★ redact.ts 재사용 범위.
- 프로브: 대용량 출력(`find /`) + 이미지 반환 MCP로 after hook payload 관찰.
- 반증: 비문자열/바이너리 다수 → 트렁케이션 규칙 보강.

### 그룹 C. 라이프사이클 & 상태

**H-C1 — 플러그인 세션당 1회 인스턴스화, 클로저 상태 지속**
- spec 영향: ★★★ traceId/재시도 큐를 **메모리**에 둘지 **파일**에 둘지 결정.
- 프로브: `__init__` 호출 횟수 + 모듈 상위 카운터 증가 관찰.
- 예측: 세션당 1회, 상태 지속.
- 반증: 매 이벤트/턴마다 재로드 → 세 어댑터처럼 파일 영속 필요(core/trace.ts, retry-queue.ts 그대로).

**H-C2 — subagent(task) tool의 중첩 세션도 hook 발화 + 상관관계 가능**
- spec 영향: ★★ subagent tool 텔레메트리 누락/중복 방지.
- 프로브: B-task 로그에서 sessionID 분기 및 부모-자식 연결 필드 확인.
- 반증: 중첩 미발화 → subagent 내부 tool 관측 불가(스펙에 한계 명시).

### 그룹 D. 런타임 / 운영

**H-D1 — 플러그인이 headless/TUI/server 모두에서 동일 로드**
- spec 영향: ★★ 배포 단위(파일 1개) 보편성.
- 프로브: B-headless 3모드 각각에서 `/tmp/pinta-probe.jsonl` 생성 여부.
- 반증: 특정 모드 미로드 → 모드별 설치/문서 분기.

**H-D2 — env/플러그인 옵션 전달 경로** — ✅ **코드로 확정(정정됨)**
- spec 영향: ★★ `PINTA_GUARD_ENDPOINT` 등 주입 방법.
- 판정: 옵션은 **엔트리 2번째 인자로 전달됨** — `plugin.server(input, options)` (`plugin/index.ts:applyPlugin`, `config/plugin.ts:pluginOptions`). `process.env`도 직독 가능. *이전 예측("옵션 직접 전달 안 될 수 있음")은 오답.*
- spec 반영: 설정은 **(1) `plugin:[["@pinta-ai/pinta-opencode",{...}]]` 옵션 우선 → (2) `process.env` → (3) env-file(`~/.config/opencode/pinta-opencode.env`) unset-only** 순으로 머지. 등록 자체는 env 불가(config/디렉토리만).

**H-D3 — opencode 버전 안정성(타겟 버전 고정)**
- spec 영향: ★★ `experimental_*` hook 의존 시 깨짐. 우리가 쓰는 `event`/`tool.execute.*`/`permission.*`은 비-experimental.
- 프로브: 타겟 opencode 버전 핀 + 해당 버전 `packages/plugin` 인터페이스 스냅샷.
- 반증 시 대응: 비-experimental hook만 사용, 버전 핀 명시.

### 그룹 E. 다운스트림 통합

**H-E1 — aware-backend가 `opencode` ingest 슬라이스를 `cc`/`copilot` 복제로 수용**
- spec 영향: ★★ 백엔드 변경량.
- 프로브: pinta-copilot DESIGNDOC §8 다운스트림 목록 대조 + aware-backend `cc` 슬라이스 구조 확인.
- 반증 시 대응: 스펙에 백엔드 변경 항목 명시(T9).

---

## 5. 실험 로그 템플릿 (각 H마다 1건)

```
### H-XX  <한 줄 가설>
- 날짜/opencode버전:
- spec 영향도(★1~3) / 검증 전 신뢰도(%):
- 프로브(재현 명령/코드):
- 예측(관측 X면 참):
- 실측(붙여넣기):
- 판정: 확정 ✅ / 반증 ❌ / 불명 ⚠️(추가 프로브 필요)
- spec 반영: <확정 사실 한 줄> 또는 <대응으로 전환한 설계>
```

## 6. 의사결정 기록(ADR) 템플릿 — 검증이 설계를 바꿀 때

```
### ADR-XX <결정>
- 맥락: 어떤 H가 반증되어 무엇이 바뀌었나
- 선택지: A / B / C
- 결정 & 이유:
- 영향받는 TODO(BACKGROUND_RESEARCH §5):
```

---

## 7. 게이트 — "spec-ready" 판정 기준

아래를 **전부 충족**해야 spec/plan 착수:

- [ ] G1. 그룹 A 전부 확정(또는 반증→대응 확정). **거부 메커니즘이 실증됨.**
- [ ] G2. `event`/before/after 페이로드 **실제 필드명 표**가 존재(추측 0).
- [ ] G3. 상태 모델 결정(H-C1): 메모리 vs 파일, 근거와 함께.
- [ ] G4. turn=trace 회전 신호 확정(H-B2) 또는 폴백 확정.
- [ ] G5. 설정 주입 경로 확정(H-D2) + 타겟 opencode 버전 핀(H-D3).
- [ ] G6. Phase 1 `OBSERVATIONS.md`의 "놀라움" 항목이 **모두 H로 승격되어 처리**됨(미결 0).
- [ ] G7. Phase 3 thin e2e 1건 성공: 텔레메트리 span 1개 수집 + DENY 1건 사유 TUI 노출.

> 미결 ⚠️가 하나라도 남으면 spec을 쓰지 않는다 — 그게 다음 unknown-unknown의 씨앗이다.

---

## 8. Unknown-Unknown을 끌어내는 일반 기법 (체크리스트)

이 프로젝트뿐 아니라 재사용할 메타 기법:

- [ ] **전부-로깅 스파이크**: 결정하지 말고 관측만 하는 프로브를 먼저 만든다(§3.1).
- [ ] **입력 다양화**: 행복경로 1개가 아니라 의도적으로 다른 코드경로를 때리는 배터리(§3.2).
- [ ] **차등 테스트(differential)**: 같은 시나리오를 pinta-cc/copilot에서도 돌려 페이로드를 **비교**. 차이가 곧 호스트 고유 함정.
- [ ] **테스트를 오라클로**: 대상 레포의 기존 테스트/픽스처(`tests/fixtures/real-payloads.ts` 등)를 진실의 원천으로 읽는다.
- [ ] **반증 우선 독해**: 로그를 "맞네"가 아니라 "어디가 예상과 다르지?"로 읽는다.
- [ ] **경계/적대 입력**: 동시성, 대용량, 실패, 중첩(subagent), 비대화형 모드 — 경계가 함정을 토한다.
- [ ] **예상한 부재 확인**: 안 불려야 할 게 불리나? 불려야 할 게 안 불리나? (K2 재확인이 좋은 예)
- [ ] **버전 핀**: "experimental"·"빠른 릴리스" 프로젝트는 검증 시점 버전을 박제.
- [ ] **종료조건 명시**: 게이트(§7)로 "충분히 검증됨"을 사전 정의 → 무한 스파이크 방지.

---

## 9. 실행 순서 요약 (one-page)

1. **프로브 플러그인** `_probe.ts` 작성 → `.opencode/plugins/`에 투입.
2. **노출 배터리**(§3.2) 11종 실행, `/tmp/pinta-probe.jsonl` 수집.
3. 로그 정독 → `OBSERVATIONS.md`에 "놀라움" 기록 → 새 H 승격.
4. **그룹 A→B→C→D→E** 순으로 H 검증, 실험 로그 작성. 반증은 ADR.
5. **thin e2e**(span 1 + DENY 1) 성공시킴.
6. **게이트 §7** 전부 ✅ → `SPEC.md`/`PLAN.md` 1회 작성.

> 이 문서의 목적은 "코드 짜다 놀라는 일"을 spec 이전으로 당기는 것이다. Phase 1에서 충분히 놀랐다면, spec은 한 번에 맞는다.

---

## 10. Phase-1 실측 결과 (2026-06-15)

**환경**: opencode **1.15.3**(릴리스 바이너리), 모델 `openrouter/free`, 플러그인은 임시 프로젝트 `opencode.json`에 절대경로로 등록, `permission:{bash:"allow"}`. 헤드리스 `opencode run`. 프로브 = 관측 전용(throw 옵션 분리). 정적 근거는 소스(1.15.x) 병행 확인.

### 판정 요약

| H | 가설 | 판정 | 핵심 증거 |
|---|---|---|---|
| **H-A1** | `tool.execute.before` throw = 그 tool만 차단 + 사유 LLM 노출 + 세션 지속 | ✅ **확정(라이브)** | throw 시 `✗ ... failed` + `Error: ⛔ Blocked by Pinta AI — probe_test_deny` 표시, `tool.execute.after` **미발화(0회)**, `session.idle` 정상 방출(세션 생존), exit 0. 정적: `Plugin.trigger`는 hook 에러를 catch하지 않고 전파 → `run.promise`(Effect.runPromise) reject → ai-sdk `tool-error` → `errorMessage`로 모델에 환류. |
| **H-A2** | async hook이 tool 실행을 inline 블록 | ✅ **확정** | before가 `item.execute`보다 먼저 동기적으로 await됨(tools.ts) → throw가 실행을 막은 것이 곧 블로킹 증명. guard 50ms inline 삽입 가능. |
| **H-B1** | `event` hook으로 라이프사이클 관측 + 필드명 확보 | ✅ **확정** | payload = `{event:{id, type, properties}}`. 라이브 관측 type: `message.part.delta`(47) · `message.part.updated`(18) · `message.updated`(9) · `session.status`(6) · `session.updated`(3) · `session.diff`(2) · `session.idle`(1) · `session.next.agent.switched` · `session.next.model.switched` · `server.instance.disposed`. (정적 core 스키마 `session.next.tool.*`는 `properties`에 `sessionID/assistantMessageID/callID/tool/input/...` 필드 보유.) |
| **H-B2** | turn 경계(trace 회전) 신호 존재 | ✅ **확정** | **`chat.message` hook = 깨끗한 turn-START** (input `{sessionID, agent, model, messageID, variant}`, output `{message, parts}`). **`session.idle` = turn-END**. → 추측 불필요. |
| **H-C1** | 플러그인 세션당 1회 인스턴스화, 클로저 상태 지속 | ✅ **확정** | `instances:1` (모듈 카운터). 정적: `Plugin.init`이 instance 부트스트랩에서 1회, `InstanceState`(ScopedCache, key=instance dir)로 hooks 캐시 → **인스턴스 수명 동안 1회**. ctxKeys=`[client, project, worktree, directory, experimental_workspace, serverUrl, $]`. |
| K2 재확인 | `permission.ask` 플러그인 hook 미발화 | ✅ **재확인** | 라이브 0회 발화. 게이팅은 `tool.execute.before`로. |

### 부수 관측 (spec에 반영)
- **tool.execute.before** input=`{tool, sessionID, callID}`, **output.args = 전체 인자 객체(변형 가능)** — 예: bash `{command, description}`.
- **tool.execute.after** input에 `args` 추가, output=`{title, output, metadata, attachments}`. bash `metadata`=`{output, exit, description, truncated}` → 종료코드·트렁케이션 플래그까지 텔레메트리에 담을 수 있음.
- **tool.definition** 24회(등록 tool마다 1회) — tool 스키마 관측/재작성 가능.
- **set `permission:{bash:"allow"}`** 시 `permission.asked` 미발생 → tool이 헤드리스에서 프롬프트 없이 실행. 거버넌스는 우리 `tool.execute.before`가 전담.

### Spec 결정에 미친 영향
1. **상태 모델(H-C1 결과)**: trace/retry 큐를 **세션ID 키의 in-memory 맵**으로 보관(인스턴스당 1회 init 클로저). 파일 영속은 *서버 재시작 내구성용 선택*으로 강등(세 어댑터의 필수 파일영속 → opencode선 불필요).
2. **텔레메트리 소스**: 라이프사이클은 `event` hook 구독, **tool span은 `event` 버스가 아니라 `tool.execute.before/after`에서 직접 생성**(인자·출력·exit·metadata가 더 풍부). 
3. **trace 회전**: `chat.message`→새 trace, `session.idle`→flush. (B2 확정으로 폴백 불필요.)
4. **집행/사유**: `tool.execute.before`에서 DENY 시 `throw new Error(userMessage)` — 단일 tool 차단 + 브랜드 사유 환류 end-to-end 검증됨.

### 게이트(§7) 갱신 — **전부 ✅ (2026-06-15)**
- [x] G1 그룹 A 확정 (H-A1/A2 라이브)
- [x] G2 event/before/after **실제 필드명 표** 확보(추측 0)
- [x] G3 상태 모델 결정(in-memory, 위 1)
- [x] G4 turn=trace 회전 신호 확정(chat.message / session.idle)
- [x] **G5** 설정 주입 + 버전 핀 — §11
- [x] **G6** event 매핑 확정 (실제 필드명 표) — §12
- [x] **G7** thin e2e (실 OTLP 수집 + 실 guard DENY) — §13

> **결론**: 모든 게이트 통과. **SPEC/PLAN을 한 번에 작성 가능.**

---

## 11. G5 — 설정 주입 & 버전 핀 (e2e 확정)

- ✅ **플러그인 옵션 전달**: `plugin:[["/abs/pinta-mini.ts",{endpoint,guard}]]` → 플러그인 2번째 인자로 **그 객체가 그대로** 도착. 실측: `optionsSeen={"endpoint":"http://localhost:7891/v1/traces","guard":"http://localhost:7891/guard"}`.
- ✅ **env 가시성**: `PINTA_E2E_ENV=hello_from_env opencode run …` → 플러그인에서 `process.env.PINTA_E2E_ENV="hello_from_env"` 확인.
- ✅ **설정 머지 순서 확정**: `옵션 → process.env → env-file(unset-only)`.
- ✅ **버전 핀 메커니즘**(정적, `plugin/shared.ts:194 checkPluginCompatibility`): npm 플러그인은 `package.json`의 **`engines.opencode`** semver 범위 선언 → `semver.satisfies(opencodeVersion, range)` 불일치 시 로드 거부. file 플러그인은 이 게이트 스킵. → pinta-opencode `package.json`에 `"engines":{"opencode":">=1.15.0"}` 류 명시.

## 12. G6 — event hook 실제 필드명 (Bronze flattening 키 확정)

`event` payload = `{event:{id, type, properties}}`. **모든 이벤트가 `properties.sessionID`를 가짐 → 단일 상관키**. 실측 type→필드:

| event type | properties 필드 |
|---|---|
| `message.updated` | `sessionID`, `info{id, role, sessionID, time, agent, model{providerID,modelID}}}` ← `info.role=="user"` = **turn-START**(대안), agent/model 텔레메트리 |
| `message.part.updated` | `sessionID`, `part`, `time` ← tool 호출이 part로 도착 |
| `message.part.delta` | `sessionID`, `messageID`, `partID`, `field`, `delta` (스트리밍) |
| `session.idle` | `sessionID` ← **turn-END(flush)** |
| `session.status` | `sessionID`, `status` |
| `session.updated` | `sessionID`, `info` |
| `session.diff` | `sessionID`, `diff` |
| `session.next.agent.switched` | `sessionID`, `timestamp`, `agent` |
| `session.next.model.switched` | `sessionID`, `timestamp`, `model` |
| `server.instance.disposed` | `directory` (인스턴스 종료) |

- "놀라움" 해소: 라이브 stream은 정적 core의 `session.next.tool.*`가 아니라 **`message.part.*` + `session.*`** 가 우세. → **tool span은 `event`가 아니라 `tool.execute.before/after`에서 생성**(확정), `event`는 라이프사이클/turn경계 용도.
- 샘플: [`phase1-e2e-events.jsonl`](./phase1-e2e-events.jsonl).

## 13. G7 — thin e2e (실 OTLP + 실 guard DENY)

미니 플러그인(옵션의 endpoint/guard 사용) + 로컬 수집기(OTLP sink `/v1/traces` + guard `/guard`)로 2턴 실행:

- ✅ **ALLOW 턴**(`echo hello_allow_case`): guard가 HTTP로 `ALLOW` 반환 → bash 실행 → 출력 표시. 수집기에 `tool.before`+`tool.after` span 수신, `tool.after`에 `opencode.exit` 담김.
- ✅ **DENY 턴**(`echo DENYME_should_block`): guard가 HTTP로 `{decision:DENY, userMessage:"⛔ Blocked by Pinta AI — deny_resource_destruction"}` 반환 → 플러그인 throw → TUI에 `✗ … failed` + 그 사유 노출, **`tool.after` 미발화**, 세션 생존.
- ✅ **수집기 수신**: 총 **124 span**(121 `event` + 2 `tool.before` + 1 `tool.after`). DENY span에 `pinta.guard.decision:DENY` 부착.
- ✅ **50ms fail-open guard 클라이언트** + fire-and-forget transport이 tool 실행을 막지 않음(ALLOW 경로 정상).

> 즉 **텔레메트리(OTLP 전송) + 집행(guard 경유 DENY) + 사유 환류**가 실제 opencode에서 end-to-end로 동작함이 증명됨. MVP 슬라이스 가동.
