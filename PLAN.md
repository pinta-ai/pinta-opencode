# PLAN — pinta-opencode 구현 계획

> 대상: [`SPEC.md`](./SPEC.md) 구현. 모든 미지는 [`HYPOTHESIS_VALIDATION.md`](./HYPOTHESIS_VALIDATION.md)에서 실측 해소됨(G1~G7). 재설계 위험 없음 → 직선 구현.
>
> 전략: **MVP 슬라이스는 이미 e2e로 가동 검증됨**(§HV-13). 본 계획은 그 슬라이스를 프로덕션 품질(redaction·retry·trace·테스트·다운스트림)로 확장.

---

## 0. 마일스톤

| M | 목표 | 게이트 |
|---|---|---|
| **M1 코어 어댑터** | 로컬 opencode에 로드되어 텔레메트리+DENY 동작(프로덕션 core 포함) | 로컬 e2e 통과(ALLOW/DENY, span 수집) |
| **M2 견고성** | redaction·retry·trace 회전·fail-open·테스트 | 단위·통합 테스트 green, fail-open 검증 |
| **M3 다운스트림** | aware-backend `opencode` 슬라이스 + Manager enroll + catalog | 실 relay로 span 저장·조회, Manager 자동 enroll |
| **M4 릴리스** | npm publish + 문서 | `engines` 호환성, 설치 가이드, DESIGNDOC |

---

## 1. 작업 분해 (의존순)

### M1 — 코어 어댑터
- [ ] **T1 스캐폴딩** — `pinta-copilot`를 fork. `package.json`(ESM, 무의존, `engines.opencode>=1.15.0`, files=[dist]), `tsconfig`, `vitest.config`, `.gitignore`. 엔트리 named export `PintaOpencode`.
- [ ] **T2 core 포팅** — `src/core/{otlp,redact,transport,retry-queue,guard,trace}.ts` 복제 후:
  - prefix `opencode.*`, `service.name=opencode`, `telemetry.sdk.name=pinta-opencode`, `ingest.type=opencode`.
  - `guard.ts`: 요청/응답 컨트랙트 그대로(타임아웃 옵션화 `PINTA_GUARD_TIMEOUT_MS`).
  - `trace.ts`: **sessionID 키 in-memory 맵**(파일 영속은 옵션 플래그). 의존: T1.
- [ ] **T3 config.ts** — 옵션(2nd arg) → `process.env` → env-file(`~/.config/opencode/pinta-opencode.env`, unset-only) 머지. OTLP/guard 키 해석. 의존: T1.
- [ ] **T4 telemetry.ts** — `event` 매핑(G6 표): 모든 이벤트 `properties` Bronze flatten → `opencode.*`; tool span은 `tool.execute.before/after`에서 생성(exit·truncated 포함). redaction 적용. 의존: T2.
- [ ] **T5 plugin.ts(엔트리)** — `PintaOpencode(input, options)`:
  - init: config 로드, core 인스턴스(클로저 상태).
  - `chat.message` → `trace.rotate(sessionID)`.
  - `event` → telemetry.lifecycle + `session.idle`에 `transport.flush`.
  - `tool.execute.before` → guard 평가 → span → `DENY` throw(사유). try/catch로 throw 누수 차단(DENY만 통과).
  - `tool.execute.after` → tool span. 의존: T2,T3,T4.

### M2 — 견고성
- [ ] **T6 fail-open 보강** — guard/transport 전 경로 try/catch, fire-and-forget. 50ms 타임아웃. 의존: T5.
- [ ] **T7 단위 테스트** — `guard`(200/타임아웃/비200/disabled), `redact`, `config` 머지 우선순위, `trace` 회전, `telemetry` 매핑(G6 픽스처). 의존: T2~T5.
- [ ] **T8 통합 테스트** — 로컬 collector+guard(HV §13 하네스 재사용)로 ALLOW/DENY/REVIEW + fail-open(guard down) 시나리오. 픽스처: `phase1-e2e-events.jsonl`. 의존: T5.

### M3 — 다운스트림
- [ ] **T9 aware-backend** — `cc` ingest 슬라이스 클론 → `opencode`(`OPENCODESPAN#` prefix, OpenSearch `opencode*` additive 매핑). 별도 레포 브랜치.
- [ ] **T10 Pinta Manager** — 사이드카 enroll: `opencode.json`에 `plugin:[["@pinta-ai/pinta-opencode",{endpoint,guard}]]` 주입 + `pinta-opencode.env` 작성. doctor 점검.
- [ ] **T11 pinta-catalog** — 엔트리 + sha256.

### M4 — 릴리스
- [ ] **T12 e2e on 실 relay** — Manager 환경에서 span 저장/조회 + DENY 사유 노출 확인.
- [ ] **T13 DESIGNDOC.md** — as-built 결정(pinta-copilot 양식, D1~Dn).
- [ ] **T14 npm publish** `@pinta-ai/pinta-opencode@0.1.0` + 설치 가이드.

---

## 2. 디렉토리 구조(목표)

```
pinta-opencode/
  package.json            # ESM, engines.opencode, 무의존
  src/
    plugin.ts             # 엔트리 (export const PintaOpencode)
    config.ts
    telemetry.ts
    core/{otlp,redact,transport,retry-queue,guard,trace}.ts
  tests/{guard,redact,config,telemetry,e2e}.test.ts
  tests/fixtures/         # phase1-e2e-events.jsonl 등
  SPEC.md PLAN.md BACKGROUND_RESEARCH.md HYPOTHESIS_VALIDATION.md DESIGNDOC.md
```

---

## 3. 리스크 / 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| opencode 플러그인 API 변경(빠른 릴리스) | hook 시그니처 깨짐 | `engines.opencode` 핀 + 비-experimental hook만 사용 + CI에서 타겟 버전 스모크 |
| 라이브 event type이 버전마다 다름 | Bronze flatten 키 변동 | tool span은 hook(안정) 기반, event는 flatten(필드 무관 무손실) → 내성 |
| in-memory 상태가 서버 재시작에 소실 | retry-queue·trace 유실 | 옵션 디스크 백업 플래그(`PINTA_PERSIST=1`) |
| guard 콜드 첫 fetch 50ms 초과 → fail-open | 첫 tool 미집행 | 운영 `PINTA_GUARD_TIMEOUT_MS=300`(copilot 선례) |
| 무의존 정책 vs OTLP proto | 직접 JSON OTLP 작성 | core `otlp.ts` 재사용(검증됨) |

---

## 4. 착수 순서 (다음 액션)

1. **T1 스캐폴딩**(pinta-copilot fork) → 2. **T2 core 포팅** → 3. **T5 plugin.ts** 최소판으로 로컬 e2e(이미 가동된 미니 플러그인을 프로덕션 core로 교체) → 이후 T3/T4/T6~T8.

> MVP는 이미 실증됐으므로 T1~T5는 "검증된 미니 플러그인을 정식 core로 승격"하는 작업. 가장 빠른 가치 경로.
