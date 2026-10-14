# 글당 Persona 댓글 1~5 — 첫 댓글 뒤 선택적 추가 댓글(0~4)

작성: 2026-10-13 · 연결: 2026-10-14(main 7b532940 통합 · 러너·발행 트랜잭션·장부·CI · E6 consumer 경유) · 상태: **code PASS · 기본 OFF · D10 bounded canary 승인** (운영 env 0 · E5 미실행)
근거 정본: D100 canon §5 "첫 댓글에서 선택적 다중 턴으로" · 답글 안전 불변식 · NORTH-STAR "이어지는 대화"

## 결론

- 자동 글마다 60분 안 첫 댓글 1건 계약과 provenance는 **그대로**다. 첫 댓글 경로는 한 바이트도 다르게 돌지 않는다
  (첫 댓글 프롬프트 바이트 동일 · 첫 댓글 격리 DB 검사 39/39 · 단계 증거 격리 DB 검사 81/81).
- 첫 댓글 뒤 **아직 답이 없는 질문·반론·경험·공감**이 있을 때만 Persona 댓글을 한 건씩, 시간차를 두고 잇는다. 글당 Persona 총 5건이 상한이다.
- 러너 · 발행 트랜잭션 · 장부 · 단계 증거 분리 · CI 까지 **실행 경로가 연결됐다.** 그러나 스위치 `SORAN_PERSONA_COMMENT_FOLLOWUP` 와
  profile 경로 `SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE` 은 **어디에도 설정하지 않았다** — 스위치가 꺼져 있으면 추가 댓글 단계는 DB 읽기도 0 이다.
- event-wake(`SORAN_EVENT_WAKE`)·launchd·runtime·운영 DB·운영 env 변경 0.

## 1. 실행 경로

```
launchd → stage-consume-exec --by=comment → persona-comment-loop --live      (E6)
  · 추가 댓글 스위치 OFF  → consumer 는 결정을 읽지 않는다(DB 0) · safest · 표식 없음
  · ON · 오늘 결정 있음   → 표식(오늘) · 공개 · 천장 env 를 넣는다
  · ON · 결정 없음·깨짐  → safest · 표식 없음
정기 회차(followupEligibleFor: scheduled · --live · 스위치 on) 일 때만
  runCommentLoop
    ① 첫 댓글 sweep → 생성 → sweep            ← 지금과 같다. 추가 댓글 행(comment-followup:*)은 집지 않는다
    ② followupPhase (첫 댓글 sweep 뒤 · 실패해도 첫 댓글 결과 불변)
         readFollowupContext   그날 단계(consumer 결정 env · decisionStageEnv) · 승인 profile 파일 · 대화 감사(judgeConversationAudit)
         sweepFollowupLane     남은 추가 댓글 PENDING 먼저(복구 · provider 0)
         judgeFollowupTick     스위치 · 단계 · kill switch · 첫 댓글 대기 양보 · profile · 대화 감사 · 장부(첫 댓글 몫 선차감)
         judgeFollowupPost     출처 · 첫 댓글 · 총량 · 실회원 우선 · 현재성 · 시간차 · 미해결 거리(classifyReaction)
         orderFollowupGo → pickFollowupPersona → buildCommentInput(replyToDigest)
         runEnqueuePipeline    9관문 정본 · 장부 단계 commentFollowupGen · judgeFollowupText(중복·같은 도입)
         PENDING 적재          dedupKey comment-followup:<글>:<순번> · editDiff.followupStamp
         sweepFollowupLane     publishCandidateTx({ followupLane: true })
```

- **사건 깨움 · 복구 · 수동 회차는 추가 댓글을 돌지 않는다** — 첫 댓글만 한다. 정기 회차가 사건 표식을 거둬 trigger 가 `event` 가 되면 그 회차도 건너뛴다(다음 정기 회차가 본다).
- **발행 트랜잭션**(`followupLane`)은 기존 재검사(9관문 · 실회원 3건 · 같은 Persona · kill switch · 하루 예산 · provenance · 생활사 · cap)를 **하나도 빼지 않고** 돌리고,
  그 위에 `judgeFollowupPublish` 를 더한다: 스위치·단계 재판독 · profile 재판독 · 오늘 추가 수(profile 상한) · Persona 하루 상한 · 다른 열린 후보 ·
  도장 검증 · 순번 = 지금 자리 · 최소 간격 · 같은 Persona/글쓴이 · 대상 유효성(살아 있음 · Persona 댓글 · 신고 없음 · 아직 답 없음 · 사슬 3) · 글 hook 1회.
  트랜잭션은 반응을 다시 분류하지 않는다(분류기가 `scripts/` 에 있다) — 대상은 도장이 가리키고 유효성만 다시 본다.
- 생성 쪽과 트랜잭션 쪽은 **같은 함수**(`followupBaseOf` · `replyTargetOpen` · `postHookOpen`)를 쓴다.
- 답글은 `Comment.parentId` 로 쓴다. 첫 댓글 · 사람 발행은 언제나 최상위다.

## 2. 정책 → 코드

| # | 정책 | 코드 |
|---|---|---|
| 1 | 첫 댓글 1개 계약·provenance 유지 | 자동 출처(`auto`) 첫 댓글이 없는 글 `STOP` · 60분 안 첫 댓글 대기 글이 있으면 회차 0건 · 표식·분류는 #707 정본(`FOLLOWUP_LANE_*` · `personaCommentProvenanceOf`) · 대화 감사 FAIL·판독 불가 → 추가 0(첫 댓글은 계속) |
| 2 | 추가 0~4 | `FOLLOWUP_EXTRA_PER_POST_MAX = 5 − 1` |
| 3 | 모든 글을 5개로 채우지 않음 | 수량은 **미해결 hook** 이 정한다. 근거 0 → 0. 한 건이 hook 하나를 소비 — 답이 한 번이라도 달린 대상(실회원·지운 답 포함)과 이미 쓴 글 hook 은 재소비 금지. 해시는 동률 순서·jitter 에만 |
| 4 | 같은 Persona · 자기 글 · 내용 중복 금지 | 그 글에 쓴 Persona(지운 것 포함)·글쓴이 제외(생성·트랜잭션 둘 다) · 자기 댓글 답글은 같은 규칙으로 막힘 · 정규화 일치 / bigram Jaccard ≥0.5 / 같은 도입 6자 |
| 5 | 실회원 우선 · 추가량 축소 | 실회원 1~2건 → 추가 ≤1 · 3건 이상 → 0 · 마지막 말이 실회원이면 0 · 실회원 댓글에는 답하지 않음 |
| 6 | 시간차 | 직전 Persona 댓글 + 30분 + 결정적 0~40분 · 한 회차 한 글 1건 · 회차 전체는 profile `runMax` · 같은 회차 같은 Persona 한 글 · 공개 24시간 뒤 종료 |
| 7 | 이어질 가치가 있을 때만 | 답 없는 Persona 댓글의 question·rebuttal·experience·empathy, 없으면 글 반응으로 최상위 추가 1회 |
| 8 | 글당 Persona 최대 5 | `PERSONA_COMMENTS_PER_POST_MAX` · 트랜잭션 `recheckBeforePublish` 도 그대로 본다 |
| 9 | 비용 · 상한 · kill switch · 멱등 · 복구 | §3 · §4 |
| 10 | 기본 OFF | `SORAN_PERSONA_COMMENT_FOLLOWUP=on` 정확히 그 값 · 트랜잭션도 다시 읽는다 · 이 PR 은 설정하지 않는다 |

## 3. 비용 · 상한 · kill switch

- 장부: 같은 댓글 장부(`persona-comment-ledger`) · 같은 하루 상한($0.20) · **단계 `commentFollowupGen`** — 첫 댓글(`commentGen`)과 줄이 나뉜다.
  유료 생성 문(장부 판정)이 닫혀 있으면 추가 댓글 생성도 0.
- 공유 장부 잔량에서 **오늘 남은 첫 댓글 의무**(지금 대기 + 그날 단계 목표 중 아직 공개되지 않은 자리) × 1건 예약액을 먼저 뗀다.
  1건 예약액 = 확정 모델 단가 × 댓글 호출 모양 × 여유 배수. 단가를 모르면 0건.
- 수량 상한은 **승인 profile 파일**(`followup-profile-v1`)에서만 온다: `{ stage · dailyCount · dailyUsd · runMax · perPersonaDailyMax · approvedBy · approvedAt }`.
  파일 없음 · 손상 · 단계 ≠ 그날 단계 · 사람 승인 없음(`machine:` 포함) → 0건. 트랜잭션도 같은 파일을 다시 읽는다.
  그날 단계는 **consumer 가 넣은 결정 env** 로만 안다 — 정본 읽기 문 `decisionStageEnv` 결과를 `followupStageOf` 가 판정한다
  (회차·트랜잭션 같은 함수): 표식 날짜 = 오늘(KST) · 공개·천장이 정본 단계 · 공개 ≤ 천장. 아니면 단계 모름 → 0건.
  러너·트랜잭션은 결정 표를 직접 읽지 않는다(`stage:ladder-check` adapter 계약). 이 모듈은 단계 칸 env 를 직접 읽지 않는다.
  `FOLLOWUP_CANARY_PROFILE_CANDIDATE`(40건 · $0.08 · 3 · 3)는 승인자가 비어 있는 **후보값**이다.
- kill switch: `PersonaGlobalSwitch` — 회차와 트랜잭션 둘 다.

## 4. 멱등 · 복구

- 멱등 열쇠 `comment-followup:<postId>:<ordinal>` → `PersonaApprovalQueue.dedupKey`(`@unique`). 같은 자리 두 번 0.
- 도장은 `editDiff.followupStamp`(판 `followup-v1`) — `gateResults` 는 관문 배열이라 섞지 않는다. 사람이 고쳐 칸이 바뀌면 발행하지 않는다.
- 첫 댓글 sweep 은 추가 댓글 행을 집지 않고, 추가 댓글 sweep 은 추가 댓글 행만 집는다 — 두 레인이 서로의 행을 닫지 않는다.
- 적재 뒤 죽으면 다음 정기 회차가 먼저 발행한다(provider 0). 발행 뒤 다시 돌아도 Queue · ActivityLog 중복 0.
- 놓친 회차를 메우지 않는다 — 늦으면 다음 회차에 한 건, 24시간이 지나면 끝.

## 5. 단계 증거 분리 (D10)

- 추가 댓글은 Queue `machine:persona-comment-followup` · ActivityLog `auto-followup` 표식으로 남는다 → `personaCommentProvenanceOf` = `followup`.
- 단계 증거는 `followup*` 를 첫 댓글 분자 · 상한(1) · 중복 · 자기 글 어디에도 세지 않는다(#707). 추가 댓글 결함은 대화 감사 FAIL 로만 드러나고, 그 FAIL 이 추가 댓글 브레이크다.
- 격리 DB 검사가 실제 행으로 확인한다: 첫 댓글 1건 인정 · `COMMENT_*` 코드 0 · `followupComments` 1 — 그리고 같은 행을 수동 출처로 섞으면 `COMMENT_OVER_CAP`(대조군).

## 6. 검사

| 명령 | CI | 내용 |
|---|---|---|
| `npm run check:persona-followup` | `베스트·댓글 정책 가드` step | 순수 173개 — 시나리오 26 · profile 반례 15 · 시뮬레이션 · 트랜잭션 판정 · 첫 댓글 프롬프트 바이트 동일 |
| `npm run check:persona-followup-mutation` | 같은 step | 막는 줄 63개를 하나씩 지워 전부 잡히는지(임시 디렉터리 · worktree 변경 0) |
| `npm run persona:followup-db-check` | 격리 Postgres step | 68개 — 실제 consumer 프로세스 e2e(오늘 결정 · 없음 · 어제 · 위조 env 4종 · OFF 읽기 0) · — OFF 무변화 · 첫 댓글 회귀 · 대화 감사 FAIL 에도 첫 댓글 · 정상 답글 · 총 5 상한 도달 · 실회원 우선 · 우회 주입 반례(그 사유로 막혔는지 단언) · 중복·동시 · 복구 · 브레이크 9종 · 장부 단계 · 단계 증거 분리 |

새 step 은 없다(무조건 step 상한 불변 · `check:workflow-budget` 90/90).

## 7. 활성화 선행조건 — 이 PR 밖

| ID | 무엇 | 상태 |
|---|---|---|
| E1 | 단계 증거 상한·출처 분리 | ✅ #707 |
| E2 | 발행 트랜잭션 추가 댓글 레인 | ✅ 이 PR(기본 OFF) |
| E3 | 홈·베스트 랭킹의 Persona 댓글 합산 분리(Batch F · C-03) | ✅ #706 (main · Production) — 홈 인기 신호는 실회원 사람 수 · Persona·운영 댓글 제외 · 비회원 상한 3. `/best`(best-v2)는 원래 실회원 전용이라 변경 없음 |
| E4 | North Star 와 병렬인 제한 canary 정책 · D10 profile 사람 승인 | ✅ 2026-10-14 창업자 승인. Persona·운영자 활동은 North Star 에서 제외하고 첫 댓글·실회원·비용·중복·감사·kill switch·rollback 불변 |
| E5 | 런타임 반영 — 보조 Mac runtime 배포 · 댓글 러너 plist 재설치 · env 2개 · profile 파일 | ❌ 미실행 · 아래 승인 절차로만 적용 |
| E6 | 댓글 러너를 consumer(`stage-consume-exec --by=comment`) 경유로 | ✅ 이 PR — 템플릿 · consumer 종류 `comment` · 스위치 OFF 면 consumer 결정 읽기 0 · 오늘 결정만(`followupStageOf`). **설치된 plist 는 아직 옛 모양**이다 — E5 배포·재설치 때 바뀐다 |

## 8. 추가 발견 · 제안

- E6 로 댓글 러너가 consumer 를 지나도 **첫 댓글은 단계 칸을 읽지 않아 그대로다**(첫 댓글 경로 import 그래프에서 단계 함수 호출 0 · 첫 댓글 격리 DB 검사 39/39).
  consumer 의 결정 읽기는 추가 댓글 스위치가 켜졌을 때만 일어난다.
- 설치된 댓글 러너 plist 는 옛 모양(직접 실행)이다. 이 PR 은 템플릿만 바꾼다 — 보조 Mac 재설치(E5) 전에는 운영에서 consumer 를 지나지 않고, 따라서 스위치를 켜도 추가 댓글은 0 이다.

- 🔴 첫 연결판은 그날 단계를 `StageDecision` 표에서 직접 읽었다 — `stage:ladder-check`(adapter 는 controller·consumer·운영 화면만)가 잡았다.
  consumer env 로 바꾸자 지금 댓글 러너 모양에서는 단계가 비어 0건이 된다. 켜려면 E6(댓글 러너 consumer 경유)이 먼저다.

- stamina 를 지운 뒤 근거 있는 글이 길게 이어진다. 시뮬레이션에서 D10 근거 있는 글이 추가 1~4건, 격리 DB 에서 질문이 이어지는 글은 5건 상한에 실제로 닿았다.
  추가 댓글이 스스로 질문을 만들면 다음 거리가 되기 때문이다. 상한·사슬 3·같은 대상 1회·실회원 우선이 막지만, 실제 생성기가 질문을 얼마나 자주 내는지는
  운영 관측 전이다 — profile 의 `dailyCount` · `runMax` 를 정할 때 이 수치를 본다.
- 정기 회차가 사건 표식을 거두면 trigger 가 `event` 로 기록되어 그 회차는 추가 댓글을 건너뛴다. 사건이 잦은 날 추가 댓글이 적게 돌 수 있다(첫 댓글에는 영향 없음).
- 변이 시험이 실제로 일을 했다: 실회원 댓글이 첫 댓글 뒤에 있던 우회 반례는 모든 사례가 "마지막 말 실회원" 하나로 막혀 의도한 사유를 못 보고 있었다 — 사유 단언으로 고쳤다.
  트랜잭션의 "자기 댓글 답글" 분기는 혼자서는 절대 걸리지 않는 죽은 분기라 지웠다(같은 Persona 규칙이 막는다).

## 9. D10 bounded canary 승인과 E5 runbook (2026-10-14)

이 값은 D100 영구값이 아니라 **첫 D10 실운영 canary** 승인값이다. 그날 정본 공개 단계가 `d10`이 아니면
profile 단계 불일치로 0건(fail-closed)이다.

```json
{
  "v": "followup-profile-v1",
  "stage": "d10",
  "dailyCount": 40,
  "dailyUsd": 0.08,
  "runMax": 3,
  "perPersonaDailyMax": 3,
  "approvedBy": "founder",
  "approvedAt": "2026-10-14T21:37:00+09:00"
}
```

정본 profile 경로는 `~/Library/Application Support/soransoran/followup-profile-v1-d10.json`이다.
정본 env `~/Library/Application Support/soransoran/env.local`에는 아래 두 키만 추가한다.

```text
SORAN_PERSONA_COMMENT_FOLLOWUP=on
SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE=/Users/<owner>/Library/Application Support/soransoran/followup-profile-v1-d10.json
```

적용 순서는 다음과 같다.

1. 병합된 main SHA에 exact-head CI가 성공했는지, 보조 Mac job·잠금·실행 프로세스가 idle인지 확인한다.
2. runtime을 기본 OFF 상태로 배포한다: `npm run runtime:deploy -- --apply --target=<merged-main-full-sha>`.
3. profile을 위 정본 경로에 mode `0600`으로 쓰고, JSON을 다시 읽어 위 승인값과 정확히 같은지 확인한다.
4. 정본 env 두 키를 중복 없이 추가한 뒤 runtime `.env.local` 심볼릭 링크가 같은 파일을 가리키는지 확인한다.
5. runtime 트리에서 `npm run persona:comment-loop-install -- --apply`로 E6 consumer 경유 plist를 재설치한다.
6. `npm run runtime:isolation-check -- --require-runtime`과 댓글 runner dry-run(provider 0 · write 0)을 통과시킨다.
7. 다음 정기 자연 회차부터 canary를 관측한다. 수동 회차·수동 stage·READY 변경으로 D10 증거를 만들지 않는다.

가장 빠른 OFF rollback은 정본 env에서 `SORAN_PERSONA_COMMENT_FOLLOWUP`을 지우거나 `off`로 바꾸는 것이다.
이 경우 다음 회차부터 추가 댓글은 DB 읽기 0이고 첫 댓글은 계속 돈다. 구조 rollback이 필요하면 switch를 먼저 OFF한 뒤
댓글 runner를 재설치 전 plist로 되돌리거나 runtime을 직전 pin으로 rollback한다. profile 파일은 감사 근거로 보존하며 삭제하지 않는다.
