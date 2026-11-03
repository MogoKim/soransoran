# 매거진 자동화 운영 runbook

작성 2026-09-15 · 갱신 2026-11-03 · 대상: `com.soransoran.magazine-producer` · `com.soransoran.magazine-auto-register` · `com.soransoran.magazine-watch` · `com.soransoran.magazine-auto-merge-recovery`(2026-10-09) · `com.soransoran.magazine-graph-watch`

이 문서가 **설치·가동·롤백의 정본**이다. 다른 곳에 절차를 다시 적지 않는다.

---

## 0. 경계 — 무엇을 자동으로 하고 무엇을 안 하나

| | 자동 | 사람·CI |
|---|---|---|
| graph readiness·ContentPlan | vNext: ✅ M-GRAPH 공급 loop (charter §18-B.5) | legacy·DIRECT 현행: M-GRAPH·G8·사람 승인 ArticlePlan 이 queue 앞에서 완료 |
| 다음 계획 선택 | ✅ producer — DIRECT 현행: `SPEC_READY` 참조 · vNext: usable ContentPlan(charter §18-B.5) | 계획 내용을 재해석하지 않음 |
| 원고 생성 + 관문 | ✅ producer — legacy: ChatGPT 웹 UI · vNext: ManuscriptProvider API(§0.0B.2) | |
| 변환 · QA · hero · batch-qa | ✅ auto-register | |
| `articles.ts` 등록 (**PR 브랜치 위에서**) | ✅ auto-register | |
| **PR 생성** (`[merge 금지]`) | ✅ auto-register | |
| **PR merge** | ✅ auto-merge (검증 통과 시) | |
| **production 공개** | 🔴 **절대 안 함** | `publishAt`(10:30 KST) 도달 시 자동 |

🔴 **2026-09-16 경영 결정 — 목표는 완전 무인 운영이다.** merge 도 자동이 됐다.

🔴 **그러나 자동 "공개" 는 아니다.** merge 해도 글은 `publishAt` 전까지 어디에도 안 나온다.
사람이 사라진 자리는 "PR 을 읽는 눈" 이고, 그 자리를 `lib/magazine-merge-gate.mjs` 가 대신한다.
**모르면 막는다** — 확인하지 못한 항목이 하나라도 있으면 merge 하지 않는다.

### 0.0A 📜 plan-first 제작 계약 전환 (2026-10-16 창업자 결정 · 대체됨 2026-11-03)

> 📜 이 절은 2026-10-16 판이다. 아래 `ArticlePlan` 명령은 **현재 main 코드의 동작 설명**으로 남기지만, 정책으로서는 §0.0B 와
> charter §18-B 로 대체됐다 — 사람 승인 ArticlePlan → 정책 판 영수증 · direct 2 생산 최소선 → 선택량 3+1 · 공개 예약을 담은 ArticleSpec →
> 날짜 없는 ContentPlan · "DIRECT 2건 뒤 legacy 제거" → §0.0B.7 의 네 조건.

현재 Production은 Claude가 `brief.md`·`review.ts`를 만드는 `LEGACY_BRIEF_V1`이다. 목표 경로는
M-GRAPH가 미리 준비한 `GRAPH_READY` 계획을 G8이 편입하고, 승인된 ArticlePlan을 버전 고정
`ArticleSpec`으로 컴파일해 M-AUTO가 실행만 하는 `DIRECT_SPEC_V1`이다. 전환 완료 전의 자연 회차
설명은 현재 legacy 경로를 뜻한다.

```text
LEGACY_BRIEF_V1  frozen legacy queue -> Claude brief -> ChatGPT manuscript -> draft.md -> QA...
DIRECT_SPEC_V1   GRAPH_READY -> G8 -> ArticlePlan -> ArticleSpec -> manuscript -> draft.md -> QA...
```

- M-GRAPH는 생산 최소선인 공개 direct 2개 이상 + discovery 1개를 갖춘 계획만 `GRAPH_READY`로 낸다.
  제품 표시는 direct 최대 3개 + discovery 1개다. 숫자를 위해 관계를 만들지 않는다.
- M-AUTO는 `SPEC_READY` 참조 중 다음 하나를 결정적으로 고르며 주제·관계·계획을 다시 판단하지 않는다.
- queue는 최종 목표에서 `planId`·`planHash`·`executeAt`만 참조한다.
- 일일 Claude brief와 review 생성은 direct 경로에서 제거한다.
- `draft.md`, QA, 재생성 예산, HOLD, dirty-tree, 원자 교체, exact-head, 배포·watch 관문은 유지한다.
- DIRECT와 LEGACY는 runner 입구와 후보 집합을 분리한다. 한 run에서 두 mode를 섞지 않는다.
- DIRECT 실패 행을 legacy로 자동 강등하지 않는다. 정확한 HOLD를 남기고 같은 spec 신원으로 재개한다.
- rollback은 행별 mode 변경이 아니라 실행 lane 전체를 명시적으로 legacy runner로 전환한다.
- 서로 다른 DIRECT 계획 2건과 rollback 증거 전에는 legacy를 격리 보존한다. 증거 뒤에는 daily brief/review,
  direct 대상 input-repair, mixed selected/reusable, 행별 mode 분기와 그 전용 검사를 활성 경로에서 제거한다.
- 일정과 완료 게이트는 `magazine/MAGAZINE-CURRENT-MILESTONE.md`를 따른다.
- **ArticlePlan (2026-10-22 · PR C)** — G8은 연구 admission(receipt · slug manifest · ledger)만 기록하고 큐를 쓰지 않는다.
  큐 행은 사람이 승인한 source/2 entry에서만 만든다. 세 단계를 섞지 않는다.
  - `magazine-direct-spec-source-authoring.mjs prepare` — 읽기 전용. 큐 행 없이 admission과 현재 제품 graph를 대조해
    DRAFT 후보를 낸다. 관계는 receipt edge로 고정한다.
  - `approve` — 사람 승인자만 받는다. 승인 직전에 admission·graph를 다시 대조하고, plan을 topic-queue union으로 검증한 뒤
    `drafts/magazine/article-spec-source/<graphVersion>.json`에 entry 하나를 더한다.
  - `materialize` — 승인 entry 하나로 큐 writer lock 안에서 `max(day)+1` 행을 넣고, 같은 parser로 다시 읽어 대조한다.
  - 소비 쪽 fail-closed: G8 해시(`g8ManifestHash` · `articlePlanHash`) 중 하나라도 있는 행은 둘 다 있고 `DIRECT_SPEC_V1`이어야 한다
    (`G8_ROW_NOT_DIRECT`). plan 복제 필드를 손으로 고치면 `SOURCE_QUEUE_DRIFT`다.
  - 승인 잠금(`article-spec-source/<graphVersion>.json.lock`)이 있어 `LOCK_BUSY`이면 자동으로 지우거나 재시도하지 않는다.
    잠금의 pid와 실행 중 프로세스를 확인한 뒤 사람만 stale 잠금을 정리한다.
  - `.release-*` 파일이 보이면 자동으로 지우지 않는다 — 해제 경쟁의 사고 잔존물로 보고 주인을 확인한다.
  - materialize가 `QUEUE_WRITE_CONFLICT`이면 큐에서 해당 slug·intent 행과 source 관문 결과를 확인하기 전에는
    producer를 실행하지 않는다. `concurrentWrite: true` 성공은 다른 writer의 변경을 보존한 채 내 행이 그대로라는 뜻이다.


### 0.0B 🔴 Magazine vNext 실행 계약 (2026-11-03 · Codex DESIGN_FREEZE_APPROVED · 구현 전)

권위 객체·관계·ContentPlan·공급 정책은 charter §18-B, 현재 상태와 구현 커밋 순서는 milestone 이 정본이다. 이 절은 **실행**만 정한다.
🔴 아직 구현 전이다. 아래는 구현이 지켜야 할 계약이며, 지금 운영은 legacy 경로다.

#### 0.0B.1 Job — 글 하나의 실행 기록

- 위치: runtime 밖 `~/Library/Application Support/soransoran/magazine-jobs/<planHash>/job.json` (Git 밖). 글 하나당 하나.
- 담는 것(파생할 수 없는 사실만): `planHash` · `contractHash` · provider 작업 ID·응답 해시 · 원고·이미지 해시 · 실제 또는 계산 가능한 비용 ·
  검증 결과 · 부분 수리·전체 재생성 횟수 · release PR 번호 · 실패 원인 · 상한 있는 `attempts[]`.
- 담지 않는 것: READY · EXPIRED · RELEASE_READY 같은 파생 상태. 매번 계산한다.
- 쓰기: temp + rename 원자 덮어쓰기. replay·compaction 장부를 만들지 않는다.
- 🔴 기존 격리 장부의 불변조건(같은 메시지 지문 재전송 0 · 전송 전 예약 · 전송 불명 시 재전송 금지)을 Job 이 그대로 지킨다.
  Job 이 이를 시험으로 증명하기 전에는 `scripts/lib/magazine-quarantine.mjs` 의 전송 예약·지문을 지우지 않는다.

#### 0.0B.2 Provider 계약

- **ManuscriptProvider · ImageProvider · EvidenceProvider 를 코드 계약으로 분리한다.** 같은 OpenAI API 를 쓸 수 있지만 실패·비용·재시도는 독립이다.
- provider 는 graph · queue · `publishAt` · PR · Git · 다른 후보를 모른다. 계약 객체만 받는다.
- 🔴 **브라우저 ChatGPT 는 자동 fallback 이 아니라 수동 비상수단이다.** 어떤 실패도 브라우저로 자동 강등하지 않는다.
- ImageProvider 는 원고가 아니라 ContentPlan 의 hero 장면 방향에서 만든다 — 이미지 실패에 원고 재생성 0, 원고 수리에 이미지 재생성 0.

**ManuscriptProvider — Responses API · background + polling · `store: false`**

1. 생성 요청 직전에 요청 키를 배타 생성하고(`openSync wx`), 요청 직후 받은 **response ID 를 Job 에 원자적으로 기록**한다.
2. `queued`·`in_progress` 동안 바로 polling 한다.
3. 🔴 **임의의 5분·10분 생성 timeout 을 두지 않는다.**
4. provider 가 문서화한 **terminal 상태까지 durable 하게 재조회**한다(프로세스가 다시 떠도 Job 의 response ID 로 이어서 본다).
5. terminal 응답을 받으면 즉시 원고·usage·response 해시를 Job 에 저장한다.
6. 🔴 **response ID 를 받기 전에 전송 결과가 불명확하면 자동 재전송하지 않는다** — 그 후보 HOLD.
7. 🔴 **response ID 가 있지만 더 이상 조회할 수 없으면 그 후보만 HOLD 하고 자동 재생성하지 않는다.**
8. AUTH·계통 장애가 아니면 다른 후보는 계속 처리한다.
9. background + strict JSON schema(Structured Outputs)는 **실제 모델 canary** 에서 검증한다.
10. 🔴 canary 가 실패하면 **`DESIGN_CONTRACT_CONFLICT` 로 중단**한다. browser 방식으로 자동 강등하지 않는다.

- Batch 는 pilot 에서 쓰지 않는다.
- 모델 선택: 원고 baseline `gpt-6.1-sol` · challenger `gpt-6.1-terra` 를 같은 기존 계획 3건으로 비교(품질·구조화 성공·비용) → 품질이 같으면 저비용 모델.
  이미지 baseline `gpt-image-2.5-flare`(필요 시 `gpt-image-2.5-sunburst` 비교). 실제 A 는 선택된 모델을 쓴다. 모델명·단가는 구현 직전 공식 가격 페이지로 다시 대조한다.

**EvidenceProvider (M-GRAPH 공급 loop 의 외부 수집기 — 정책은 charter §18-B.5)**

- 입력 `{ intentId, graphVersion, slot: DIRECT | DISCOVERY, query, locale, engine }` · 출력은 정규화 가능한 검색 hit 목록.
- 멱등 키 = `sha256(engine | query | locale | YYYY-MM)` — 같은 달 같은 질의는 저장된 결과를 쓰고 호출 0.
- 예산: 현재 SerpAPI 구독 범위 안 · 유료 추가 0(증거 예산은 승인된 적 없다) · 기본 상한 하루 20회 · 월 200회.
- 실패 범위는 질의 1개. 429·5xx·네트워크는 같은 키로 백오프 2회 → 그 질의만 다음 회차. 상한 도달은 그날 loop 중단(실패 아님).
- 키는 출력·저장하지 않는다.

**예산 (2026-11-03 창업자 결정)**

| 항목 | 상한 | 넘으면 |
|---|---|---|
| A commissioning 총액(모델 비교 포함) | **$5** | A 중단 |
| 편당 provider hard cap | **$1** | 그 후보만 HOLD |
| pilot 월 hard cap | **$30** | 새 provider 호출 0 · 검증된 후보의 release 는 계속 · 알림 1회 · 다음 달 재개 |
| 월 $100 확대 | **미승인** | — |

비용은 Job 에 호출마다 기록하고 합계는 계산한다. 코드 상한이 1차 방어다.

#### 0.0B.3 검증 · 부분 수리 · 전체 재생성

검증은 결정론적 코드다(기존 `magazine-qa.mjs` · `magazine-batch-qa.mjs` · `lib/magazine-forbidden.mjs` · profile QA).

| 위반 | 처리 |
|---|---|
| 고정 문장 누락(진료 안내 · 위기 상담 안내 · CTA) | 정본 문장을 **결정적으로 삽입** → 재검증 |
| description · FAQ · CTA · 단순 표현 | **그 필드·문장만** 수리 → 같은 검증기로 재판정 |
| 금지 패턴 일치 | **일치 문장 하나만** 재작성 → 같은 검증기로 재판정. 동사·문맥 예외 목록을 늘리지 않는다 |
| 의료·법률·세금·금융 사실 오류 · 검색 의도 불일치 · 구조 붕괴 | 문장 수리로 덮지 않는다 → **전체 재생성** |
| 그 뒤에도 실패 | **그 후보만 HOLD** |

- 기본 상한: 부분 수리 최대 2곳 · 전체 재생성 최대 1회 · 이후 그 후보 HOLD.
- CONTROLLED 후보(charter §18-B.6)는 release 직전에 사실 확인 항목의 기준일을 다시 대조한다.
- hero: 크기·형식 · 비율 왜곡 0 · 기존 hero 와의 지각 해시 중복을 자동으로 본다. 실패하면 이미지 1장만 다시 만들고, 그래도 실패하면 그 후보 HOLD.

#### 0.0B.4 release writer · 날짜 마지막 배정

- **release writer 는 하나다.** `articles.ts` 와 날짜를 쓰는 주체가 하나다. 생성 worker 와 분리한다.
- 입력은 검증을 통과했고 아직 release 되지 않은 후보 중 `targetCandidates` 개 이하다. 묶기 위해 원고를 더 만들지 않는다.
- `publishAt` 은 이때 배정한다 — main 과 열린 release PR 의 날짜를 읽어 내일부터 빈 날(10:30 KST). 관계 대상이 같은 release 에 있으면 대상 날짜 ≤ 원문 날짜.
- 쓰기는 기존 `scripts/magazine-register.mjs` journal 트랜잭션을 후보마다 쓰고 PR 은 하나다. 한 편과 여러 편이 같은 코드다.
- 실패한 후보는 PR 조립 전에 빠진다. release PR 의 CI 가 실패하면 그 release 만 닫고 후보를 검증됨으로 되돌린다.
- 🔴 **열린 release PR 은 다음 release 만 기다리게 한다. 생성은 막지 않는다.** (§0.1 의 전역 HOLD 는 legacy 경로의 현행 동작이다.)
- merge 관문(SHA 고정 · 변경 파일 모양 · CI · 중복 slug · 예약일 · 과거 날짜)은 그대로 둔다. 변경 파일 모양은 release 의 slug 집합 기준으로 본다.

#### 0.0B.5 rollout switch — lifecycle

**전환 중**

| 항목 | 계약 |
|---|---|
| 위치 | runtime 밖 설정 파일 1개 — merge 가 곧 활성화가 되지 않게 한다(runtime 은 00:10 에 main 을 ff-only 로 따라붙는다) |
| 값 | `legacy` 또는 `vnext` · A 에서만 쓰는 Draft release 표시 · `targetCandidates` |
| 없음 · 손상 · schema 불일치 | `legacy` |
| 쓰기 | 단일 owner CLI · schema 검증 · 원자 쓰기 · 변경자·시각·old/new 기록 |
| 읽기 | producer · auto-register 가 회차 시작 때 읽어 분기한다. plist 변경 0 |

**A · 첫 무인 글 · 다른 cluster 검증 이후**

- vNext 를 고정하고, legacy 삭제와 **같은 변경에서** switch 분기와 A 전용 Draft 분기를 코드에서 제거한다.
- 제거 이후의 이상 상태는 legacy fallback 이 아니라 **생성 HOLD** 다. release 와 이미 공개된 Article 은 영향 없다.

#### 0.0B.6 A commissioning · 첫 무인 글 · 다른 cluster

**A (1회)**

1. 실제 provider 로 후보 1개 생성(공급 loop 가 만든 3+1 ContentPlan).
2. 실제 검증.
3. **Draft release PR** 생성 — **auto-merge 0**.
4. 창업자가 로컬 production 렌더로 상세·홈·목록·hero·띠배너를 확인한다(제품 route 추가 0).
5. 창업자 **예/아니오 1칸**.
6. 예 → **수동 병합**. 아니오 → 병합하지 않고 닫은 뒤 원고가 아니라 **시스템을 고치고** 같은 ContentPlan 으로 재생성.

- 사람이 원고를 직접 고치지 않는다. 고쳐야만 통과한다면 A 는 FAIL 이다.
- A 전용 승인 필드 · 승인자 필드 · 영구 대기 상태를 만들지 않는다. 판정은 PR 병합 여부 그 자체다.
- 🔴 **A 는 M-AUTO `OPERATING_PASS` 가 아니다.**

**첫 신규 무인 글 B · 다른 cluster**

- 첫 신규 무인 글 B 의 release·배포·공개가 **자연 회차로** 끝나야 M-AUTO 판정 근거가 된다.
- 다른 cluster 의 production-shaped 검증도 필요하다. release 선택은 직전과 다른 cluster 를 우선한다.
- 완성 원고 여러 편을 미리 만드는 정책은 없다. 구조는 N 개 후보를 처리하되 `targetCandidates` 는 근거로 올린다
  (직전 release 들의 검증 첫 통과 · 전체 재생성 0 · 이미지 재시도 · 중복 0 · 잔존물 0 · watch 실패 0 · 비용 상한).
  올리는 것은 사람의 설정 변경이고, 기준이 하나라도 깨지면 기계가 1로 내린다.

#### 0.0B.7 legacy 삭제 조건 · rollback

다음 **네 조건이 모두** 충족되기 전에는 legacy 를 삭제하지 않는다.

1. 운영 진입점에서 옛 모듈 도달 0 (import 그래프로 기계 확인)
2. vNext 신규 글의 무인 release·배포·공개 완료
3. 다른 cluster 의 production-shaped 검증 완료
4. fixture · mutation · rollback 참조 0

- 옛 graph 판 파일은 위 네 조건과 함께 연구·제품 각 계층의 current·previous·rollback 소비처를 확인한 뒤에만 지운다.
- legacy 큐 행은 기계로 분류한다 — 계절 창이 지난 행은 만료 · 격리 원인이 원고 결함인 행은 원고를 버리고 같은 intent 를 공급 loop 로 ·
  전달 불명 HOLD 는 같은 intent 의 3+1 ContentPlan 이 있으면 이전하고 없으면 보류 유지.
- rollback 단위: rollout switch `legacy`(분기 제거 전) → release PR revert → 글 1편 `status: 'BLOCKED'` → graph kill(graph watch) →
  계층별 previous(charter §18-B.3 — 신규 공급은 current 가 다시 맞을 때까지 HOLD). 분기 제거 뒤에는 Git revert.

#### 0.0B.8 구현 · 검사 게이트

- 구현 커밋 순서와 진행 위치는 milestone 이 정본이다.
- **완성 exact head 의 공통 PASS**: rollout switch 가 없거나 손상됐거나 `legacy` 일 때 legacy 회차 산출(run.json · handoff · PR 모양) 바이트 불변 ·
  `legacy` 에서 vNext 진입점 쓰기 0 · ContentPlan 해시에 날짜·provider·경로 0 · `typecheck` · `typecheck:ops` · `lint` · `build` · `check:tokens` ·
  `magazine:auto-check` · `check:m3a` · `check:magazine-graph` · `check:research-current` · `magazine:rehearsal`.
- **production-shaped rehearsal** (fake provider · 녹화 evidence · 격리 저장소): 서로 다른 cluster 를 포함한 계획 여러 개 · 공급 loop(보강·부족·상한) ·
  이미지 실패 · 금지 패턴(면책 문장) · 메타 칸 · 의료 안내 누락 · 사실 오류 · 비용 상한 · 급사 후 재개 · 같은 slug 동시 실행 · release CI 실패 ·
  날짜 놓침 · switch 손상 · Draft release 를 주입한다. PASS 는 실패 후보만 격리 · 나머지는 PR 하나에 서로 다른 날짜 · 이미지 실패 시 원고 재생성 0 ·
  같은 멱등 키 재호출 0 · ID 수신 전 불명 재전송 0 · 날짜를 놓쳐도 ContentPlan 해시 불변 · exact-head · 중복 0 · 잔존물 0 · Chrome/CDP 0 ·
  사람 입력 0 · vNext 진입점의 legacy 모듈 도달 0 · Draft release 의 병합 0.

#### 0.0B.9 실패 범위와 알림

| 실패 | 범위 | 동작 | 알림 |
|---|---|---|---|
| 원고·이미지·검증·수리 실패 · ID 수신 전 불명 · ID 있으나 조회 불가 | 그 후보 | HOLD · 다른 후보 계속 | 상태가 바뀔 때 1회 |
| 관계 근거 부족 | 그 intent | `HOLD(evidence)` | 없음(정상 상태) |
| EvidenceProvider 상한 · 429 | 그날 공급 loop | 중단 · 다음 회차 | 1회 |
| AUTH · 월 비용 상한 | 생성 전체 | 새 호출 0 · 검증된 후보 release 계속 | 1회 |
| release CI 실패 | 그 release | 후보를 검증됨으로 되돌림 | 1회 |
| 정상 대기(열린 release PR · 목표 도달) | — | 아무것도 안 함 | 없음 |

### 0.0 자동 병합이 확인하는 것

| 확인 | 막는 것 |
|---|---|
| 브랜치 접두 | 사람 PR 을 자동 merge 하지 않는다 |
| **SHA 고정** | 검증 뒤 커밋이 붙으면 `SHA_DRIFTED` |
| 변경 파일 **모양** | `articles.ts` · `topic-queue.ts` · `drafts/{slug}/*` · `hero.webp` 밖이면 막는다 (소스·워크플로 변경 불가) |
| CI · check-runs | 하나라도 실패·진행 중이면 막는다 |
| **큐 등급 변경** | PR 이 큐 행의 `riskLevel`·`autoEligible` 을 바꾸면 `QUEUE_GRADE_CHANGED`. 등급 자체로 병합을 가르지 않는다(M3-A · `lib/magazine-merge-gate.mjs:62,286`) |
| 중복 slug | PR 안 · main 양쪽 |
| 예약일 | 10:30 KST 형태 · `publishedAt` 일치 · 중복 없음 |
| **과거 날짜** | `PUBLISH_AT_PAST` — merge 즉시 공개되는 것을 막는다 |

🔴 `--admin` 을 쓰지 않는다. 보호 규칙과 CI 를 우회하는 손잡이는 이 경로에 없다.

### 0.1 미해결 자동 PR 은 **한 번에 하나** (legacy·현행)

> vNext 는 열린 release PR 이 다음 release 만 기다리게 하고 생성은 막지 않는다(§0.0B.4). 이 절은 지금 운영 중인 경로의 동작이다.

🔴 **이전 PR 이 처리되기 전에는 다음 생산 회차가 HOLD 한다.**
무인 운영에서는 **같은 회차의 자동 병합이 그것을 푼다** — 01:00 등록 직후 merge 까지 간다.
자동 병합이 막힌 회차만 다음 날 HOLD 로 남고, 그때는 Slack 이 사유를 말한다.

왜 그런가 — 자동 PR 을 만든 뒤 runtime 은 main 으로 돌아온다. 그 main 의
`articles.ts` 에는 **그 등록이 아직 없다**(PR 안에만 있다). 그대로 다음 날 회차가 돌면

```
Day 1  autumn-low-mood 선정 → PR #A (OPEN) → main 복귀
Day 2  main 의 articles.ts 를 읽는다 → autumn-low-mood 가 없다
       → 같은 slug 를 또 선정하고, 빈 슬롯도 같은 날짜를 고른다 → PR #B
```

`register.mjs` 의 중복 가드는 **main 만** 보므로 이것을 막지 못한다.
그래서 producer 와 auto-register가 **시작 전에 같은 판정**을 본다
(`scripts/lib/magazine-outstanding.mjs`).

| 상태 | 판정 | 종료 코드 | 사람이 할 일 |
|---|---|---|---|
| OPEN 자동 PR 있음 | `OUTSTANDING_PR` · **HOLD** | 0 (정상) | 보통은 자동 병합이 같은 회차에 푼다. 막혔으면 사유를 본다 |
| CLOSED(미merge) + 브랜치 잔존 | `ABANDONED_PR_BRANCH` · **HOLD** | 0 (정상) | **브랜치를 지운다** = 명시적 폐기 |
| push 됐는데 PR 없음 | `ORPHAN_REMOTE_BRANCH` · 🔴 실패 | 1 | PR 을 열거나 브랜치를 지운다 |
| 로컬에만 남은 자동 브랜치 | `ORPHAN_LOCAL_BRANCH` · 🔴 실패 | 1 | 내용 확인 후 살리거나 지운다 |
| GitHub 을 못 읽음 | `GITHUB_QUERY_FAILED` · 🔴 실패 | 1 | 네트워크·gh 인증 확인 |
| 미해결 0건 | `CLEAR` | — | 없음 (그냥 진행) |

🔴 **merge 판정은 GitHub 의 PR state 가 정본이다.** commit ancestry 로 보지 않는다 —
squash merge 는 PR 커밋을 main 에 남기지 않아 merge 된 PR 이 영원히 "미해결" 로 남는다.

🔴 **모르면 멈춘다(fail closed).** GitHub 을 읽지 못하면 "미해결 없음" 이 아니라
"확정할 수 없음" 이다. 확정하지 못한 채 새 PR 을 만들면 중복을 막을 길이 없다.

---

## 1. 무엇이 고장나 있었나 (2026-09-03 ~ 09-15)

두 job 이 **12일간 한 번도 돌지 않았다.** 로그가 없으니 아무도 몰랐다.

### 근인 — TCC 가 plist 를 읽지 못한다

```
kernel [com.apple.sandbox.reporting:violation]
System Policy: smd(…) deny(1) file-read-data
/Users/…/Documents/soransoran/launchd/com.soransoran.magazine-producer.plist
```

옛 설치는 `~/Library/LaunchAgents` 에 `~/Documents` 를 가리키는 **symlink** 를 두었다.
macOS 의 Documents 접근 보호가 `smd` 의 plist 읽기를 거부한다 —
읽지 못하니 **서비스 등록 자체가 되지 않는다.**

같은 기계의 D100 job 4개는 `~/Library/LaunchAgents` 안의 **실제 파일**이라 정상이었다.

### 그 밖에 켰으면 사고가 났을 것들

| | 증상 |
|---|---|
| `gh` 가 launchd PATH 에 없음 | `add → commit → push → gh pr create` 순서라 **push 뒤에** gh 부재를 안다. PR 없는 브랜치가 origin 에 조용히 올라간다 |
| main 복귀 코드 없음 | 첫 성공 회차 뒤 저장소가 자동 브랜치에 남아 **다음 날부터 매일 `NOT_ON_MAIN`** |
| exit 0 고정 + Slack 발송 0 | 실패가 종료 코드에도 Slack 에도 안 남는다 |
| lock 없음 | 사람 수동 실행과 01:00 회차가 겹칠 수 있다 |
| `imageMode=REQUIRED` | 호출부가 `alt: null` 고정 → **구조적으로 언제나 BLOCKED** |
| 대상 저장소가 개발 작업트리 | 진단 시점 브랜치가 `fix/write-guest-start-flow` |

전부 이 PR 에서 고쳤다.

---

## 2. runtime worktree

```
/Users/yanadoo/Documents/soransoran-magazine-runtime
```

🔴 **개발 작업트리를 쓰지 않는다.** 그날 누가 브랜치를 바꿨는지에 따라 결과가 달라진다.
🔴 **D100 의 `soransoran-runtime` 과도 다르다.** 두 레인이 서로의 배포에 묶이지 않는다.
설치기가 `soransoran` · `soransoran-m0` · `soransoran-runtime` 을 명시적으로 거부한다.

만드는 법 (한 번):

```bash
git -C ~/Documents/soransoran worktree add ~/Documents/soransoran-magazine-runtime main
```

조건: 브랜치 `main` · 추적 변경 0건. 설치기가 확인한다.

---

## 3. 활성화 게이트 — supervised 1회 end-to-end 성공

🔴 **옛 "5일 관찰 후 허용" 조건은 경영 결정(2026-09-15)으로 폐기됐다.**

대신 **사람이 지켜보는 앞에서 `--write --pr` 이 1회 성공**해야 한다.
성공의 정의는 하나다 — **PR 이 실제로 열렸다.**

그 사실을 영수증으로 남긴다:

```
~/Library/Application Support/soransoran/magazine-supervised-run.json
{
  "result": "SUCCESS",
  "prUrl": "https://github.com/MogoKim/soransoran/pull/NNN",
  "ranAt": "2026-09-16T01:00:00+09:00"
}
```

영수증이 없거나 `result !== "SUCCESS"` 거나 PR URL 이 없으면
`magazine:launchd-install --apply` 가 **아무것도 설치하지 않고 멈춘다.**

### supervised 실행 중의 진행 규칙

🔴 **gate 가 통과하면 중간에 창업자에게 "계속할까요" 를 다시 묻지 않는다.**
producer → auto-register 검증까지 **이어서** 끝낸다. 매 단계 확인을 받으면
그 자체가 새로운 병목이 되고, 무엇을 승인한 것인지도 흐려진다.
판단이 필요한 자리는 이미 코드가 막는다 — gate · 관문 · preflight · 미해결 판정.

🔴 **예외는 하나다 — ChatGPT 전용 프로필 로그인이 실제로 필요할 때.**
`LOGIN_REQUIRED` · `CLOUDFLARE_BLOCKED` 처럼 사람이 화면에서 로그인해야만
풀리는 상태면, 그때만 창업자에게 화면을 넘긴다. 그 밖의 실패는 보고하고 멈춘다.

---

## 4. 설치

```bash
npm run magazine:launchd-check          # 판정 함수 회귀 (파일 변경 0)
npm run magazine:launchd-install        # 계획만 (변경 0)
npm run magazine:launchd-install -- --apply   # 🔴 실제 설치
```

설치기가 하는 일:

1. runtime worktree 확인 (존재 · main · 깨끗함 · 개발 트리 아님)
2. supervised 영수증 확인
3. `docs/operations/launchd/*.plist.template` 렌더 — placeholder 가 하나라도 남으면 중단
4. 기존 **symlink 를 보관소로 옮긴다** (지우지 않는다)
   → `~/Library/Application Support/soransoran/launchd-rollback/`
5. 실제 plist 파일을 `~/Library/LaunchAgents` 에 원자적으로 쓴다

🔴 **설치기는 `launchctl` 을 부르지 않는다.** 파일만 놓는다.

### 가동 (사람이 한다)

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist

# 등록됐는지 확인 — "Could not find service" 가 나오면 실패다
launchctl print gui/$(id -u)/com.soransoran.magazine-producer | head -20
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | head -20
```

---

## 4.5 무인 운영 — 하루의 흐름

아래는 **지금 배포된 코드의 하루**다. `LEGACY` 는 운영 중인 경로이고, `DIRECT` 는 main 에 있는 현행 코드 경로다(운영 회차 0).
vNext(§0.0B)는 구현 전이며, 구현 뒤에는 rollout switch 가 `vnext` 일 때만 producer 입구가
`ContentPlan → Job → ManuscriptProvider·ImageProvider → 검증·부분 수리` 로, 날짜 배정이 release writer(§0.0B.4)로 바뀐다.
한 회차에서 두 경로를 섞지 않는다.

```
00:10 KST  producer        LEGACY: 동결 queue → brief(claude) → 원고 회수 → 관문 → 알림
                           DIRECT(현행 코드): SPEC_READY 선택 → ArticleSpec 검증 → 원고 회수 → 관문 → 알림
                           끝나면 _runs/{date}/producer-handoff.json 을 남긴다
01:00 KST  auto-register   ① producer 완료 신호·lock 을 최대 40분 기다린다 (재시도 없음)
                           ② 미해결 자동 PR 확인 → ③ 변환·QA·hero·batch-qa·register
                           ④ PR 생성 → ⑤ 자동 병합(--merge) → main
                           ⑥ merge SHA 의 Production 배포 확인 → 예약 글이 **아직 안 나왔는지**(404)
                           필수 CI 는 최대 30분 기다린다 · 명시적 실패는 즉시 중단 (병합 잠금 안에서)
02:00 KST  auto-merge-recovery  01:00 이 CI 시간 초과 등으로 못 끝낸 자동 PR 1건을 **같은 관문**으로
                           다시 본다(`--recover`) · 0건 no-op · 2건 이상 멈춤
                           01:00 병합이 아직 잠금을 쥐고 있으면 최대 90분 기다린다 → 풀리면 진행 ·
                           끝까지 잠겨 있으면 merge 0 · non-zero · Slack (성공·no-op 로 세지 않는다)
                           결과는 시도마다 _runs/{date}/auto-merge-recovery-<시각>-<pid>-<꼬리>.json
                           (01:00 의 auto-merge.json 도, 앞선 복구 결과도 덮지 않는다)
10:30 KST  (해당일)        publishAt 도달 → 예약 글이 공개된다
11:00 KST  magazine-watch  본문·대표 이미지·/magazine 목록 노출 확인 → 실패면 Slack
```

🔴 **02:00 복구는 새 관문이 아니다** (2026-10-09 #675 — 필수 CI 21분 7초 · 옛 상한 20분에서 시간 초과 ·
   CI 는 61초 뒤 성공했으나 PR 이 OPEN 으로 남았다). `runAutoMerge({ apply: true })` 를 그대로 다시 돈다 —
   재전송·재생성·재등록은 없다. 11:00 watch 는 계속 공개 확인 전용이고 merge 하지 않는다.

🔴 **01:00 의 확인과 11:00 의 확인은 서로 다른 것을 본다.**
   01:00 은 "**아직 안 나왔는가**"(404) — 예약이 지켜졌는지.
   11:00 은 "**이제 나왔는가**"(본문·이미지·목록 전부 200/노출) — 공개가 됐는지.
   앞의 것만 있으면, 글이 끝내 안 나온 사실을 제일 먼저 아는 사람이 **독자**가 된다.

🔴 **필수 검사는 `completed` + `success` 하나뿐이다.** `skipped`·`neutral` 은 인정하지 않는다 —
   워크플로에 경로 필터나 조건이 붙으면 검사는 돌지 않고 skipped 로 완료된다.
   그것을 통과로 세면 "필수 검사를 확인했다" 가 **한 번도 돌지 않은 검사**를 가리키게 된다.
   부수 검사의 skipped 는 그대로 둔다 — 막을 이유가 없고, 막으면 매 회차 시끄럽다.

🔴 **check-run 이 다 끝나도 합산 status 가 pending 이면 기다린다.** 두 값은 다른 곳에서 온다 —
   check-run 은 Actions 가, 합산은 Commit Status API 를 쓰는 것들(Vercel 등)이 올린다.
   `pending → success` 진행 · `failure`·`error` 실패 · `unknown`·조회 실패는
   **성공이 아니다**(계속 보다가 시간이 다하면 `CI_OBSERVE_TIMEOUT`).

🔴 **커밋 합산 status 를 배포 확인으로 쓰지 않는다.** 그것은 CI 판정에 쓰는 바로 그 값이라
   검사가 전부 초록이면 success 가 된다 — **운영 도메인이 아직 옛 빌드를 서빙해도 success 다.**
   대신 세 가지를 따로 본다.

   | 보는 것 | 어디서 |
   |---|---|
   | Production 배포가 **그 SHA 로** 있는가 | GitHub Deployments API (`?sha=&environment=Production`) |
   | 그 배포가 **READY 인가** | 그 deployment 의 status = `success` |
   | **운영 도메인이 그 배포를 서빙 중인가** | `soransoran.com` HTML 의 `dpl_<id>` 표식 |

   마지막 줄이 핵심이다. 앞의 둘만 보면 "배포는 됐는데 도메인은 구버전" 을 못 본다.
   Vercel 이 `next/image` URL 에 `dpl=dpl_<id>` 를 심고, 같은 id 가 그 커밋의 Vercel
   status `target_url` 끝에 들어간다 — 두 값을 맞추면 추측 없이 알 수 있다.
   🔴 표식을 못 읽으면 `PRODUCTION_UNVERIFIED` 로 **막는다** — 모르면 통과가 아니다.

   🔴 **GitHub 증거가 비면 Vercel 을 직접 본다** (2026-10-13 #701 — merge SHA 에 대해 GitHub
   Deployments 가 빈 배열·커밋 status 0건이었다. Vercel 에는 그 SHA 의 Production READY 배포가 있었고
   도메인이 서빙 중이었는데 결과는 `MERGED_UNVERIFIED`).
   GitHub 증거가 완전하면(배포 · success · 같은 SHA · `dpl_` id) Vercel 호출은 0 이다.
   없거나 불완전할 때만 `vercel inspect soransoran.com` → `vercel api /v13/deployments/<그 id>` 순서로 보고,
   `gitSource.sha` = merge SHA · `target` = production · `readyState` = READY · 두 id 일치가 **모두** 참일
   때만 인정한다. 최신 배포·HTTP 200 은 증거가 아니다. 결과의 `deploy.evidenceSource` 에
   `github-deployments` / `vercel-direct` 를 남긴다. 판정 기준(위 표)은 그대로다.
   🔴 **GitHub 의 명시적 결론은 덮지 않는다** — deployment state 가 failure·error 이거나 다른 SHA 를
   명시하면 Vercel 을 부르지 않고 그대로 실패·충돌로 끝낸다. fallback 은 배포 없음·조회 실패·
   pending/queued/in_progress/null·success 인데 배포 id 없음일 때만.
   🔴 Vercel 직접 확인은 **이미 로그인된 CLI 자격**(launchd 의 HOME)으로 읽기 두 번만 한다 —
   새 토큰·env·plist 0 · redeploy/promote/alias/rollback 0 · CLI 원문·자격은 결과·로그에 남기지 않는다.
   실행 파일은 `SORAN_MAGAZINE_VERCEL_BIN` → 지금 node 옆(`dirname(process.execPath)/vercel`) → PATH
   순서로 **실행 가능한 것**만 고른다. 없으면 `VERCEL_UNAVAILABLE` (`scripts/lib/magazine-deploy-evidence.mjs`).

🔴 **404 만이 "안 나갔다" 를 확인한 것이다.** 500·인증 리다이렉트·네트워크 실패는
   비공개 확인이 아니라 **확인 실패**다 — 즉 배포가 망가진 날 자동 병합이
   가장 자신 있게 초록을 보고하는 일을 만들지 않는다.

🔴 **magazine-watch 는 고치지 않는다.** 재배포도 재시도도 없다. 알리고 non-zero 로 끝난다.

🔴 **producer 가 실패해도 등록은 진행한다.** 이미 준비된 후보로 돈다 — 공급이 목적이다.
🔴 **막힌 후보는 격리된다.** 2회 연속 QA 에 막히면 7일간 비켜 주고 **다음 후보가 진행**한다.
   원고를 고치면(파일이 바뀌면) 냉각을 기다리지 않고 즉시 다시 후보가 된다.
   📜 (legacy 현행 · vNext 대체) 자동화가 원고를 고쳐 주지 않는다 — 비켜 줄 뿐이다. → vNext 는 §0.0B.3 의 부분 수리.
📜 (legacy 현행 · 2026-11-03 대체) API 를 새로 붙이지 않는다 — brief 는 claude CLI(구독), 원고·이미지는 ChatGPT 웹 UI.
   → vNext 는 §0.0B.2 의 API provider 를 예산 상한 안에서 쓰고 브라우저는 수동 비상수단이다.
🔴 생성 경로의 제한(로그인 만료·Cloudflare·한도·provider 장애)은 **숨기지 않고 그대로 실패로 낸다.** 우회하지 않는다.

## 5. 감시

### producer 종료 코드의 뜻

🔴 옛 판은 brief·원고 회수 실패를 **삼키고** plan 의 코드만 돌려줬다.
ChatGPT 로그인이 만료돼 원고를 한 건도 못 받아도 `exit 0` 이었다.
지금은 `launchctl` 의 last exit status 만 봐도 구분된다.

| 코드 | 판정 | 뜻 |
|---|---|---|
| 0 | `OK` | 정상 |
| 0 | `CONTENT` | 일부 slug 가 brief 게이트에 막혔다 — **정상이다**. 관문이 일한 것 |
| 0 | `HOLD` | 미해결 자동 PR 을 기다리는 중 — **정상이다** |
| 1 | `SYSTEM` | plan 실패 · claude 부재 · **ChatGPT 접근 실패 · 브라우저 시작 실패** · 회수기 전역 실패 |

🔴 Slack 은 판정을 바꾸지 않는다 — 양방향으로. 알림이 실패해도 원래 실패는 실패이고,
실패 회차에서도 알림은 **반드시 시도한다**.

### 알림 계약 — 종료 경로는 하나다

🔴 non-dry-run producer 의 **모든** 종료 경로가 단일 finalizer 를 지난다
(`scripts/lib/magazine-producer-flow.mjs`). 알림은 거기 한 곳에만 있고 **회차당 정확히 한 번** 돈다.

| 중단 사유 | exit | Slack | write·AI |
|---|---|---|---|
| `TOOL_MISSING` (claude·gh 부재) | 1 | ✅ 1회 | 0 |
| `NOT_ON_MAIN` · `DIRTY_TREE` | 1 | ✅ 1회 | 0 |
| `OUTSTANDING_PR` (HOLD) | 0 | ✅ 1회 — **PR 번호·URL 포함** | 0 |
| `ORPHAN_*` · `GITHUB_QUERY_FAILED` | 1 | ✅ 1회 | 0 |
| plan·brief·fetch 실패 | 1 | ✅ 1회 | 실행된 단계까지 |
| 정상 | 0 | ✅ 1회 | 전부 |

🔴 **알림을 보내려고 파일을 쓰거나 AI 를 부르지 않는다.** 중단 경로에서는
`plan`·`brief`·`fetch` 를 **한 번도 호출하지 않는다** — 회귀가 호출 횟수로 증명한다.

🔴 **HOLD 알림에는 PR 번호와 URL 이 반드시 들어간다.**
로그에만 있고 Slack 에 없으면 창업자는 무엇을 merge 해야 하는지 모른 채
"또 HOLD 네" 만 보게 된다. auto-register 의 HOLD 알림도 같은 PR 을 지목한다.

🔴 **dry-run 은 실제로 보내지 않는다.**

> **2026-09-16 에 배운 것** — 직전 판은 이 계약을 문서와 주석에 적어 두고도
> 두 경로가 `process.exit(1)` 로 빠져나가 실제로는 성립하지 않았다.
> 회귀는 있었지만 **소스에서 `runNotify()` 의 위치만** 봤다. 위치는 도달 여부를 보지 못한다.
> 지금 회귀는 주입한 흐름을 **실제로 돌려** 호출 횟수와 종료 코드를 본다.

| 무엇 | 어디 |
|---|---|
| producer 로그 | `~/Library/Logs/soransoran/magazine-producer.log` |
| auto-register 로그 | `~/Library/Logs/soransoran/magazine-auto-register.log` |
| write 회차 리포트 | `drafts/magazine/_runs/{date}/auto-register.json` (runtime 안) |
| Slack | write 회차는 **성공도 실패도** 보낸다 (`#소란소란-알림`) |
| launchd 종료 코드 | write 회차 실패는 non-zero 로 남는다 |

🔴 로그에 반드시 남는 것: PR URL · 처리 slug · 막힌 단계 이름 · 남은 브랜치.

### 매일 30초 점검

```bash
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register | grep -E 'last exit|runs'
tail -40 ~/Library/Logs/soransoran/magazine-auto-register.log
```

---

## 6. 상태도 — 성공 · 실패 · 복귀

```
01:00 회차 시작
  │
  ├─ lock 잡기 ────────── 실패(LOCK_HELD/STUCK/CORRUPT) ─→ exit 1 · main 복귀 안 함(남의 회차)
  │                                                        🔴 재시도하지 않는다
  ├─ writePreflight
  │    ├ 도구(git·gh·node·claude) ─ 없음 ─→ TOOL_MISSING ─┐
  │    ├ gh 인증 ──────────────── 실패 ─→ GH_AUTH_FAILED ─┤
  │    ├ git(main·clean·ff-only) ─ 실패 ─→ NOT_ON_MAIN 등 ─┤→ 🔴 파일 변경 0 · main 복귀 · exit 1
  │    └ push 자격(--dry-run) ──── 실패 ─→ PUSH_NOT_READY ─┘
  │
  ├─ PR 브랜치 생성 ───── 실패 ─→ BRANCH_CREATE_FAILED ─→ 파일 변경 0 · main 복귀 · exit 1
  │
  ├─ slug 별 drive()  gate → 회수 → 변환 → QA → hero → batch-qa → register write
  │      (막히면 그 slug 만 BLOCKED. 다른 slug 는 계속 간다)
  │
  ├─ finishPr  stage(명시) → stageCheck → commit → push → gh pr create
  │      ├ stageCheck 실패 ─→ restore --staged · commit 안 함 · pushed:false
  │      ├ push 실패 ───────→ pushed:false
  │      └ PR 실패 ────────→ 🔴 pushed:true 를 남긴다 ("브랜치는 origin 에 있다")
  │
  └─ finish
       ├ main 복귀 시도
       │   ├ 깨끗함 ─→ switch main ─→ RETURNED (작업 브랜치는 남긴다)
       │   └ 미커밋 변경 ─→ 🔴 RETURN_DIRTY — 아무것도 지우지 않고 BLOCKED
       ├ lock 해제
       ├ Slack 발송 (write 회차는 성공도 알린다)
       └ exit  BLOCKED 있으면 non-zero
```

### 복구 가능한 실패의 처리

| 상황 | 자동화가 하는 것 | 사람이 하는 것 |
|---|---|---|
| push 성공 · PR 실패 | 브랜치명 로그·Slack 에 남기고 **main 복귀** | GitHub 에서 그 브랜치로 PR 을 연다 |
| 미커밋 변경으로 복귀 실패 | 🔴 **아무것도 지우지 않는다.** BLOCKED + 복구 방법 | `git -C <runtime> status` 로 확인 후 판단 |
| 살아 있는 lock | 그 회차 건너뜀 | 없음 (다음 회차가 정상 진행) |
| 45분 이상 붙잡힌 lock | `LOCK_STUCK` 으로 멈춤 | 프로세스 확인 후 lock 파일 제거 |

🔴 **어떤 경우에도 `reset --hard` · `switch -f` · `branch -D` 를 쓰지 않는다.**

---

## 7. 롤백

```bash
# ① 가동 중지
launchctl bootout gui/$(id -u)/com.soransoran.magazine-auto-register
launchctl bootout gui/$(id -u)/com.soransoran.magazine-producer

# ② 파일 제거 — 🔴 bootout 만으로는 로그인 때 다시 등록된다
rm ~/Library/LaunchAgents/com.soransoran.magazine-auto-register.plist
rm ~/Library/LaunchAgents/com.soransoran.magazine-producer.plist

# ③ 확인 — "Could not find service" 가 정상이다
launchctl print gui/$(id -u)/com.soransoran.magazine-auto-register
```

옛 symlink 로 되돌려야 한다면 보관소에 있다:
`~/Library/Application Support/soransoran/launchd-rollback/`
🔴 다만 그 symlink 는 TCC 때문에 **애초에 동작하지 않는다.** 되돌릴 이유는 없다.

### 자동 PR 만 끄고 싶다면

템플릿의 `ProgramArguments` 에서 `--write` · `--pr` 두 줄을 빼고 다시 설치한다.
그러면 dry-run 리포트만 나간다 (파일 변경 0 · Slack 발송 0).

---

## 8. 회귀 테스트

```bash
npm run magazine:auto-check       # 자동 레인 게이트 · 관문 · git lifecycle (node)
npm run magazine:launchd-check    # 설치기 판정 · 템플릿 렌더 (tsx)
```

🔴 **clean checkout 에서 0 FAIL 이어야 한다.**
옛 테스트는 커밋된 적 없는 원고 3건에 의존해 CI 에서 언제나 1 FAIL 이었다.
지금 표본은 `scripts/__fixtures__/magazine/` 에 추적돼 있다.

---

## 9. 알려진 것

- `drafts/magazine/after-holiday-body-ache/draft.md` 에는 ChatGPT 인용 마커가 **아직 남아 있다.**
  `dea1c7a` (#299) 가 `articles.ts` 본문만 고쳤다. 관문은 이것을 정상적으로 막는다 —
  회귀 테스트가 "여전히 막힌다" 를 시험한다. 원본 정리는 별건이다.
- 📜 ~~`imageMode: OPTIONAL` 은 여전히 기본 스킵이다.~~ 현재 코드: 자동 레인은 `imageMode` 와 무관하게 hero 를 요구한다(`scripts/magazine-auto-register.mjs:1253` `--require-hero` · `scripts/magazine-batch-qa.mjs:274`). hero 는 유지가 창업자 결정이다(charter §12).
- 📜 ~~HIGH · `autoEligible=false` 는 gate 와 `register.mjs` 의 `AUTO_RISK` 두 겹으로 막힌다.~~ 현재 코드: `AUTO_RISK` 는 M3-A 에서 제거됐다(`scripts/magazine-register.mjs:49`). 위험은 등급이 아니라 검증 강도로 다룬다(charter §3-B).
