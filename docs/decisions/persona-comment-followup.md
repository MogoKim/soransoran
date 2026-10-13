# 글당 Persona 댓글 1~5 — 첫 댓글 뒤 선택적 추가 댓글(0~4)

작성: 2026-10-13 · 보정: 2026-10-13(stamina 제거 · 단계별 profile 주입) · 상태: **준비만 · 기본 OFF · 미연결 · 활성화 아님**
근거 정본: D100 canon §5 "첫 댓글에서 선택적 다중 턴으로" · 답글 안전 불변식 · NORTH-STAR "이어지는 대화"

## 결론

- 자동 글마다 60분 안 첫 댓글 1건 계약과 provenance는 **그대로**다. 이 모듈은 그 위에서만 돈다.
- 첫 댓글 뒤 **대화 가치가 있을 때만** Persona 댓글을 한 건씩, 시간차를 두고 잇는다. 글당 Persona 총 5건이 상한이다.
- 만든 것은 순수 판정 모듈 · fixture · 검사 · 변이 시험뿐이다. **DB write · provider 호출 · env · launchd · runtime 변경 0.**
- 기존 runner·발행 트랜잭션·단계 증거에는 **연결하지 않았다.** 연결 접점과 활성화 선행조건은 아래 §4·§5에 있다.

| 파일 | 무엇 |
|---|---|
| `src/lib/persona-comment-followup.ts` | 스위치 · 미해결 hook · 한 글 판정 · profile 검증 · 회차 판정 · Persona 선택 · 본문 중복 · Queue 도장 · 출처 분류 |
| `scripts/fixtures/persona-comment-followup/scenarios.json` | 한 글 판정 시나리오 25건 (GO·WAIT·STOP·BLOCK) · profile 반례 15건 |
| `scripts/persona-comment-followup-check.mts` | fixture · profile · 회차 판정 · 24시간 D10/D100 시뮬레이션 불변식 · 글 id 무관성 · `stage-evidence` 실제 접점 (113개) |
| `scripts/persona-comment-followup-mutation.mts` | 막는 줄 42개를 하나씩 지워 검사가 전부 잡는지 (worktree 변경 0) |

```bash
npx tsx scripts/persona-comment-followup-check.mts      # 113/113 PASS
npx tsx scripts/persona-comment-followup-mutation.mts   # 변이 42/42 잡힘
```

`package.json` 스크립트와 CI(`visibility-guard.yml`) 등록은 하지 않았다 — 두 파일 모두 Batch C1/C2 PR이 수정 중이다(§4 C-4).

## 1. 정책 → 코드

| # | 정책 | 코드 |
|---|---|---|
| 1 | 첫 댓글 1개 계약·provenance 유지 | 자동 출처(`auto`) 첫 댓글이 없는 글은 `STOP` · 60분 안 첫 댓글 대기 글이 하나라도 있으면 회차 전체 0건 · 표식 분리(`machine:persona-comment-followup` / `auto-followup`) — 지금 `commentProvenanceOf` 가 추가 댓글을 `auto` 로도 `broken` 으로도 보지 않음을 검사가 실행으로 확인 |
| 2 | 추가 0~4 | `FOLLOWUP_EXTRA_PER_POST_MAX = 5 − 1` (기존 상수에서 파생 · 새 숫자 아님) |
| 3 | 모든 글을 5개로 채우지 않음 | 🔴 **수량은 미해결 hook 이 정한다** (글 id 해시 stamina 폐기). 근거 0 → 0건, 근거가 이어지면 최대 4. 한 건이 미해결 hook 하나를 소비한다 — 답이 한 번이라도 달린 대상(실회원 답·지워진 답 포함)과 이미 최상위 추가 댓글로 쓴 글 hook 은 다시 쓰지 않는다 |
| 4 | 같은 Persona 반복 · 자기 글 · 내용 중복 금지 | 이미 그 글에 쓴 Persona·글쓴이 제외 · Persona 댓글에만 답하므로 자기 댓글 답글 불가 · 정규화 일치 / bigram Jaccard ≥0.5 / Persona끼리 같은 도입 6자 차단 · Persona 하루 상한은 profile 값 |
| 5 | 실회원 댓글 우선 · 자동 추가량 축소 | 실회원 1~2건 → 추가 상한 1 · 3건 이상 → 0 · 마지막 말이 실회원이면 `STOP` · **실회원 댓글에는 답하지 않는다**(CURRENT §6 창업자 결정 항목) |
| 6 | 시간차 | 직전 Persona 댓글 + 30분 + 글·순번별 결정적 0~40분 · 한 회차 한 글 1건 · 회차 전체는 profile `runMax` · 공개 24시간 뒤에는 잇지 않음 |
| 7 | 이어질 가치가 있을 때만 | 답 없는 Persona 댓글의 `question·rebuttal·experience·empathy`(이 순서, 같은 hook 이면 먼저 쓴 댓글 → id), 없으면 글 자체 반응이 그 넷일 때 새 최상위 추가 댓글 한 번. 첫 댓글은 글 hook 을 소비하지 않는다. `other`·`information` 은 자연스러운 끝 |
| 8 | 글당 Persona 최대 5 | `PERSONA_COMMENTS_PER_POST_MAX`(기존 정본) |
| 9 | 비용·일일 상한·kill switch·멱등·복구 | 아래 §2·§3 |
| 10 | 기본 OFF | `SORAN_PERSONA_COMMENT_FOLLOWUP=on` 정확히 그 값일 때만 · `1`·`true`·`ON` 은 OFF · 댓글 단계가 `bootstrap-auto` 가 아니면 0 |

답글 안전 불변식(canon §5): 자기 답글 0(Persona 반복 금지로 구조적) · 중복 답글 0(이미 답한 댓글 제외 + 멱등 열쇠) · 고아 답글 0(관계 이상 글 `BLOCK`) ·
깊이 상한(사슬 3) · 두 화자 자동 루프 0(같은 Persona 글당 1회) · 삭제·신고 대상 0(신고 모름도 제외) · 안전·예산 우회 0(기존 9관문·트랜잭션 재검사를 대체하지 않음).

## 2. 비용 · 상한 · kill switch — 단계별 승인 profile

- kill switch: 기존 `PersonaGlobalSwitch` 를 그대로 본다. 켜짐·모름 → 0건.
- 🔴 **수량·비용 상한은 코드 상수가 아니다.** 호출부가 그날 런타임 단계(`StageDecision` 공개 단계)에 맞는 승인 profile 을 주입한다.
  `followup-profile-v1 { stage · dailyCount · dailyUsd · runMax · perPersonaDailyMax · approvedBy · approvedAt }`
- 주입 없음 · 판 다름 · 단계 불일치 · 그날 단계 모름 · 수치 손상(0·소수·문자열·회차>하루) · 승인자 없음/`machine:` · 승인 시각 손상 → **0건**(fail-closed).
- 40건 · $0.08 · 회차 3 · Persona 3 은 `FOLLOWUP_CANARY_PROFILE_CANDIDATE`(단계 `canary`) **후보값**일 뿐이다. 승인자가 비어 있어 그대로는 0건이다. D100 상한이 아니다.
- 🔴 첫 댓글 우선은 profile 과 무관하다: 60분 안 첫 댓글 대기 글이 있으면 0건 · 공유 장부에서 **오늘 남은 첫 댓글 의무 × 1건 예약액을 먼저 뗀** 잔량과 profile `dailyUsd` 잔량 중 작은 쪽만 쓴다.
- profile 저장 위치·형식(어느 파일/행에서 읽는가)과 D10·D20·D100 값은 이 PR 이 정하지 않는다 — 창업자 승인 항목이다(E4).

## 3. 멱등 · 복구

- 멱등 열쇠 `comment-followup:<postId>:<ordinal>` 을 `PersonaApprovalQueue.dedupKey`(이미 `@unique`)에 쓴다. 같은 자리에 두 회차가 넣으면 하나만 남는다.
- 판정은 대화 사실로만 정해지고, 해시는 동률 순서·시간차 jitter·같은 자격 Persona 사이 순서에만 쓴다. 같은 입력이면 재시도·재기동에도 같은 결정이다(시뮬레이션 두 번 동일 · 글 id 300개 판정 동일을 검사).
- 답글 대상·순번·이어질 거리는 스키마를 바꾸지 않고 `gateResults.followup`(판 `followup-v1`) 도장에 싣고, 발행 직전 `verifyStamp` 로 열쇠·글·순번을 대조한다.
- 🔴 **복구 대상이 아니다.** 추가 댓글은 선택 사항이라 놓친 회차를 메우지 않는다. 늦으면 다음 정규 회차에 한 건, 24시간이 지나면 끝이다 — 몰아서 다는 일이 생기지 않는다.

## 4. Batch C 와 연결할 최소 접점 — 문서만 · 해당 파일 수정 0

| ID | 파일(Batch C 수정 중) | 접점 |
|---|---|---|
| C-1 | `scripts/lib/persona-comment-loop.mts` (C2) | `runCommentLoop` 의 `sweepAfter` 뒤에 추가 댓글 단계를 하나 둔다. 그날 `StageDecision` 공개 단계와 승인 profile 을 읽어 넘긴다. 순서: 첫 댓글 sweep·생성·sweep → `judgeFollowupTick(profile, runtimeStage)` → `judgeFollowupPost` 전부 → `orderFollowupGo` → 허용 수만큼 `pickFollowupPersona` → 기존 `runEnqueuePipeline`(9관문) → 본문 `judgeFollowupText` → PENDING 적재(열쇠·도장·`FOLLOWUP_DECIDED_BY`). **새 job·새 큐·새 lease 없음.** |
| C-2 | `scripts/lib/runner-wake.mts` · `scripts/original-post-auto-publish.mts` (C2) | 공개 commit 이 깨우는 것은 **첫 댓글뿐**이다. 사건 깨움 회차에서는 추가 댓글 단계를 돌지 않는다(첫 댓글 지연 0). |
| C-3 | `src/lib/runner-recovery.ts` · `scripts/runner-recover.mts` (C2) | 복구 회차는 추가 댓글 단계를 **건너뛴다**(§3). 복구 판정에 추가 댓글을 넣지 않는다. |
| C-4 | `scripts/lib/runner-lease.mts` · `supply-lease.mts` (C1) · `package.json` · `visibility-guard.yml` (C1·C2) | 추가 댓글은 댓글 runner 의 기존 lease 안에서만 돈다. C 병합 뒤 `check:persona-followup` · `check:persona-followup-mutation` 스크립트와 CI 단계를 등록한다. |

## 5. 활성화 선행조건 — 이 PR 밖 · 각각 별도 PR과 승인

| ID | 무엇 | 왜 |
|---|---|---|
| E1 | `stage-evidence` 의 댓글 상한·출처 | 🔴 지금 `bootstrap-auto` 단계 증거 상한이 **1**(`personaCommentCapFor`)이다. 켜는 순간 자동 글마다 `COMMENT_OVER_CAP` 로 Dn 증명이 FAIL 한다. 상한은 "자동 출처 첫 댓글 1 + 추가 댓글" 로 나눠 세고, 출처 분류는 `followupProvenanceOf`(첫 댓글 판정 위에 `followup` 한 칸)로 바꿔 추가 댓글을 수동 Persona 댓글(`manualPersonaComments`)로 잘못 세지 않게 한다. 검사 ⑤가 지금 상한 1 을 실행으로 잠가 두었다 — 바뀌면 이 항목을 다시 본다. |
| E2 | 발행 트랜잭션 | 지금 무인 발행은 `judgeAutoLane`(60분 창 · 글당 1)만 연다. 추가 댓글 레인은 트랜잭션 안에서 도장 검증 · `judgeFollowupPost` 재판정 · 도장의 `parentCommentId` 로 답글 write · Queue `decidedBy`/ActivityLog `decidedBy` 를 추가 댓글 표식으로 같은 시각에 남겨야 한다. |
| E3 | 홈·베스트 랭킹 (CURRENT K C-03 · Batch F) | Persona 댓글이 아직 홈 인기 점수에 합산된다. 추가 댓글을 켜면 합성 인기가 그만큼 오른다. Batch F 분리 전에는 켜지 않는다. |
| E4 | 창업자 결정 | CURRENT §7 "실회원 계측 전에 자동 답글 확장" 금지 · §6 실회원 댓글 글의 Persona 응답. North Star 계측(Batch F) 뒤 창업자 승인으로만 켠다. 단계별 profile(D10·D20·D100) 값과 저장 위치, 시간 숫자(30+0~40분 · 24시간)도 그때 확정한다. |
| E5 | 장부 | 댓글 장부에 추가 댓글 단계 라벨을 따로 두어 첫 댓글 비용과 섞지 않는다. 1건 예약액은 확정 모델 단가로 `estimateCost` 가 낸다. |
| E6 | 입력 | 반응 라벨은 정본 분류기 `classifyReaction`(`scripts/lib/voice-comment-signals.mts`)으로 붙이고, 신고 여부는 신고 테이블에서 읽는다. 모르면 null — 모듈이 막는다. |

## 6. 추가 발견 · 제안

- 🔴 **E1 이 가장 큰 함정이다.** 단계 증거는 지금 "글당 Persona 1건" 을 증명 조건으로 쓰고 있어, 이 기능을 켜면 D10 증명이 조용히 깨진다. 연결 PR 보다 E1 PR 이 먼저여야 한다.
- 🔴 stamina 를 지우자 근거 있는 글이 더 길게 이어진다. 시뮬레이션(반응 3/8 이 hook): D10 근거 있는 글 7편의 추가 2·4·3·1·3·2·1건, D100 승인 profile(300건) 하루 추가 160건 · 첫 댓글로 끝난 글 25/100.
  추가 댓글이 스스로 질문·공감을 만들면 다음 hook 이 되기 때문이다. 상한 4 · 사슬 3 · 같은 대상 1회 · 실회원 우선은 그대로 막지만, 실제 생성기가 hook 을 얼마나 자주 내는지는 운영 관측 전이다 — profile 값을 정할 때 이 수치를 본다.
- d10 profile(40건)로 100편을 돌리면 상한이 묶이고, 추가가 적은 글부터 잇는 순서 덕에 40편이 1건씩 받는다.
- 시뮬레이션이 실제 결함 하나를 잡았다: 회차 자리를 읽은 순서대로 주면 앞 글이 하루 상한을 독차지해 D100 의 71/100 글이 첫 댓글로 끝났다. `orderFollowupGo`(추가가 적은 글 먼저)로 고쳤고 검사·변이로 잠갔다.
