# 글당 Persona 댓글 최대 10 — 첫 댓글 뒤 선택적 추가 댓글·답글(0~9)

작성: 2026-10-13 · 연결: 2026-10-14(main 7b532940 통합 · 러너·발행 트랜잭션·장부·CI · E6 consumer 경유) · 2026-10-19 profile 보정 · 2026-11-04 구조 상한 보정 · 2026-11-14 H1 실패 분류·같은 회차 재선정(§4-1) · 상태: **최대 10 구현 후보 · 운영 검증 전**
근거 정본: D100 canon §5 "첫 댓글에서 선택적 다중 턴으로" · 답글 안전 불변식 · NORTH-STAR "이어지는 대화"

## 결론

- 자동 글마다 60분 안 첫 댓글 1건 계약과 provenance는 **그대로**다. 첫 댓글 경로는 한 바이트도 다르게 돌지 않는다
  (첫 댓글 프롬프트 바이트 동일 · 첫 댓글 격리 DB 검사 39/39 · 단계 증거 격리 DB 검사 81/81).
- 첫 댓글 뒤 **아직 답이 없는 질문·반론·경험·공감**이 있을 때만 Persona 댓글을 한 건씩, 시간차를 두고 잇는다. 글당 Persona 총 10건이 구조 상한이다.
- 러너 · 발행 트랜잭션 · 장부 · 단계 증거 분리 · CI 까지 실행 경로가 연결됐다. 기존 보조 Mac runtime에는
  E6 consumer 경유 plist, 스위치 `on`, 승인된 D10 전용 profile이 설치돼 있었다.
- 2026-10-19부터 기능 사용 가능 여부를 단계와 분리한다. 승인된 운영 공통 profile(`stage: all`)은 d5부터 D100까지
  같은 안전 관문을 쓰고, 공개량·Persona·예산·회차 상한만 실측에 맞춰 조정한다. 모든 글을 10건으로 채우지는 않는다.
- `SORAN_EVENT_WAKE`는 공개 직후 댓글 첫 반응만 재촉한다. 켜는 값은 `comment` 하나다. 옛 `all`은 2026-11-07 폐지되어
  모르는 값(off)으로 읽는다. 켜짐 출처는 정본 env 한 곳이다(발행 러너·고아 복구·readiness가 같은 키를 읽는다). 공급 event wake와
  공급 recovery kickstart는 실행시간 상한 없는 비예약 owner가 자연 증명과 충돌하지 않도록 닫혀 있다.
  공급은 하루 7회 자연 예약만 사용한다. 이 결정은 댓글 event-assisted 실행을 바꾸지 않는다.

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
- **발행 트랜잭션**(`followupLane`)은 공통 안전 재검사(9관문 · 실회원 3건 · kill switch · provenance · 생활사 · 하루 절대 500)를 그대로 돌린다. 첫 댓글의 글당 provider 기준 5는 followup에 재적용하지 않고, followup은 승인 profile 잔량과 글당 구조 상한 10을 함께 본다. 일반 Persona는 한 글에 한 번만 말하고, 글쓴이 Persona만 서로 다른 유효 대상에 답글로 최대 3회 말할 수 있다.
  그 위에 `judgeFollowupPublish` 를 더한다: 스위치·단계 재판독 · profile 재판독 · 오늘 추가 수(profile 상한) · Persona 하루 상한 · 다른 열린 후보 ·
  도장 검증 · 순번 = 지금 자리 · 최소 간격 · 같은 Persona/글쓴이 · 대상 유효성(살아 있음 · Persona 댓글 · 신고 없음 · 아직 답 없음 · 사슬 6) · 글 hook 1회.
  트랜잭션은 반응을 다시 분류하지 않는다(분류기가 `scripts/` 에 있다) — 대상은 도장이 가리키고 유효성만 다시 본다.
- 생성 쪽과 트랜잭션 쪽은 **같은 함수**(`followupBaseOf` · `replyTargetOpen` · `postHookOpen`)를 쓴다.
- 답글은 `Comment.parentId` 로 쓴다. 첫 댓글 · 사람 발행은 언제나 최상위다.

## 2. 정책 → 코드

| # | 정책 | 코드 |
|---|---|---|
| 1 | 첫 댓글 1개 계약·provenance 유지 | 자동 출처(`auto`) 첫 댓글이 없는 글 `STOP` · 60분 안 첫 댓글 대기 글이 있으면 회차 0건 · 표식·분류는 #707 정본(`FOLLOWUP_LANE_*` · `personaCommentProvenanceOf`) · 대화 감사 FAIL·판독 불가 → 추가 0(첫 댓글은 계속) |
| 2 | 추가 0~9 | `FOLLOWUP_EXTRA_PER_POST_MAX = 10 − 1` |
| 3 | 모든 글을 10개로 채우지 않음 | 수량은 **미해결 hook** 이 정한다. 근거 0 → 0. 한 건이 hook 하나를 소비 — 답이 한 번이라도 달린 대상(실회원·지운 답 포함)과 이미 쓴 글 hook 은 재소비 금지. 해시는 동률 순서·jitter 에만 |
| 4 | 일반 Persona 반복 금지 · 글쓴이 제한 답글 | 일반 Persona는 그 글에 1회. 글쓴이는 최상위 댓글 0, 서로 다른 유효 대상에 답글로 최대 3회. 정규화 일치 / bigram Jaccard ≥0.5 / 같은 도입 6자 |
| 5 | 실회원 우선 · 추가량 축소 | 실회원 1~2건 → 추가 ≤1 · 3건 이상 → 0 · 마지막 말이 실회원이면 0 · 실회원 댓글에는 답하지 않음 |
| 6 | 시간차 | 직전 Persona 댓글 + 30분 + 결정적 0~40분 · 한 회차 한 글 1건 · 회차 전체는 profile `runMax` · 같은 회차 같은 Persona 한 글 · 공개 24시간 뒤 종료 |
| 7 | 이어질 가치가 있을 때만 | 답 없는 Persona 댓글의 question·rebuttal·experience·empathy, 없으면 글 반응으로 최상위 추가 1회 |
| 8 | 글당 Persona 최대 10 · 사슬 최대 6 | `PERSONA_COMMENTS_PER_POST_MAX` · `PERSONA_REPLY_CHAIN_MAX` · 트랜잭션 `recheckBeforePublish` 도 그대로 본다 |
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
  `FOLLOWUP_CANARY_PROFILE_CANDIDATE`(80건 · $0.16 · 3 · 3 — H1 에서 40건 · $0.08 에서 올렸다)는 승인자가 비어 있는 **후보값**이다.
  승인자가 없으므로 이 값만으로는 0건이다. 운영에 설치된 승인 profile(§9)은 이 코드 변경으로 바뀌지 않는다.
- 구조 상한 10은 운영 예산을 확대하지 않는다. 첫 댓글 부트스트랩 계산은 기존 기준 5(첫 댓글 1 + profile 산출 기준 4),
  하루 절대 500을 유지한다. 공유 장부 하루 상한 $0.20(`COMMENT_LOOP_DAILY_USD_DEFAULT`)은 H1 에서도 그대로다.
  운영 승인 profile 은 §9 의 40건 · $0.08 · 회차 3 · Persona당 3 이고, 바꾸려면 승인 파일을 새로 써야 한다.
- kill switch: `PersonaGlobalSwitch` — 회차와 트랜잭션 둘 다.

## 4. 멱등 · 복구

- 멱등 열쇠 `comment-followup:<postId>:<ordinal>` → `PersonaApprovalQueue.dedupKey`(`@unique`). 같은 자리 두 번 0.
- 도장은 `editDiff.followupStamp`(판 `followup-v1`) — `gateResults` 는 관문 배열이라 섞지 않는다. 사람이 고쳐 칸이 바뀌면 발행하지 않는다.
- 첫 댓글 sweep 은 추가 댓글 행을 집지 않고, 추가 댓글 sweep 은 추가 댓글 행만 집는다 — 두 레인이 서로의 행을 닫지 않는다.
- 적재 뒤 죽으면 다음 정기 회차가 먼저 발행한다(provider 0). 발행 뒤 다시 돌아도 Queue · ActivityLog 중복 0.
- 놓친 회차를 메우지 않는다 — 늦으면 다음 회차에 한 건, 24시간이 지나면 끝.

## 4-1. 실패 분류 · 최소 범위 격리 · 같은 회차 재선정 (H1 · 2026-11-14 · 미배포 코드)

- 문제: picker 가 (글, 순번) 해시로 Persona 를 고르는 결정적 선택이라, 실패한 Persona 를 다음 회차에도 다시 골랐다(starvation).
  직전 미완 diff 는 실패한 글 **전체**를 KST 하루 격리해 같은 글의 정상 Persona 까지 막았다. 그 post 전체 격리는 지웠다.
- 추가 댓글 시도 기억은 첫 댓글과 다른 파일(`followup-attempts.v1.json`)이고, 기억 기간은 KST 하루다(자정에 풀린다).
  첫 댓글 파일(`first-comment-attempts.v1.json` · 60분)과 첫 댓글 lane 판정은 바꾸지 않았다.
- 실패는 `classifyFollowupFailure` 가 다섯 코드 중 하나로 나누고, 시도 기억 `blockCodes` 에 함께 적는다(적힌 코드가 재분류보다 우선한다).

| 코드 | 원인 | 오늘(KST) 격리 범위 | 같은 회차 |
|---|---|---|---|
| `FU_PERSONA_DAY` | Persona 에 묶인 결정적 실패(설정 · 말투 · bootstrap · prompt 근거 · 비활성 · 실회원) | 그 Persona — 모든 글 | 같은 글에서 다음 정상 Persona 재선정 |
| `FU_POST_DAY` | 글에 묶인 실패(글 사라짐 · 비공개 · 게시판 바뀜 · Persona 댓글 꽉 참 · 글 상태 모름) | 그 글 하나 | 다음 글로 넘어간다 |
| `FU_COMBO_DAY` | 그 글 × 그 Persona 본문 실패(관문 · 본문 중복 · 파싱 · 잘림 · 자리 중복) | 글 × Persona 쌍 | 같은 글에서 재선정 |
| `FU_TRANSIENT` | 일시 provider · IO · 장부(429 · 5xx · NETWORK · TIMEOUT · LEDGER_BLOCKED · DB ERROR) | 없음 | 회차를 멈춘다. 다음 회차에 같은 조합을 새로 시작할 수 있다 |
| `FU_HALT` | 모르는 · 내부 실패 · 요청 모양 거부(400) | 글 × Persona 쌍 | 회차를 멈춘다 |

- 상한: 적재는 profile 잔량(`allowed`) 그대로다. provider 호출은 `min(followupPlanCap(allowed) = allowed × 2, 비용 잔량 건수)`이고,
  한 글에서 한 회차에 부르는 횟수는 `FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK` = 2 다. 하루 USD · 공유 장부 $0.20 · 첫 댓글 몫 선차감은 그대로다.
- 후보 필터(`followupPersonaCandidates`)는 실회원 · 비활성 · 프로필 미완 · 말투 불가 · 격리 Persona · 격리 쌍 · 이번 회차 사용 Persona 를 뺀다.
  회차 안의 격리 사본은 실패 직후 갱신되므로, 같은 글에 머무는 재선정은 방금 실패한 Persona 를 다시 고르지 않는다.
- 시작 기록이나 결과 기록을 쓰지 못하면 provider 를 더 부르지 않고 회차를 멈춘다(fail-closed).
- 범위가 넓어진 판정 둘: 출처 문맥 판정은 회차 앞에서 **GO 글 전부**를 본다(하나라도 모르면 회차 전체 유료 호출 0).
  생성기(`makeGenerate`)에는 계획된 Persona 만이 아니라 재선정될 수 있는 정상 Persona 전부를 넘긴다.
- 실제 회원 댓글 · 원문은 읽기 판정에만 쓰고 쓰지 않는다. 9관문 · 대화 감사 · 발행 트랜잭션 재검사는 바뀌지 않았다.

## 5. 단계 증거 분리 (D10)

- 추가 댓글은 Queue `machine:persona-comment-followup` · ActivityLog `auto-followup` 표식으로 남는다 → `personaCommentProvenanceOf` = `followup`.
- 단계 증거는 `followup*` 를 첫 댓글 분자 · 상한(1) · 중복 · 자기 글 어디에도 세지 않는다(#707). 추가 댓글 결함은 대화 감사 FAIL 로만 드러나고, 그 FAIL 이 추가 댓글 브레이크다.
- 격리 DB 검사가 실제 행으로 확인한다: 첫 댓글 1건 인정 · `COMMENT_*` 코드 0 · `followupComments` 1 — 그리고 같은 행을 수동 출처로 섞으면 `COMMENT_OVER_CAP`(대조군).

## 6. 검사

| 명령 | CI | 내용 |
|---|---|---|
| `npm run check:persona-followup` | `베스트·댓글 정책 가드` step | 순수 시나리오 · profile 반례 · 구조 상한 10 · 일반 Persona 1회 · 글쓴이 답글 3회 · 사슬 6 · 첫 댓글 프롬프트 바이트 동일 |
| `npm run check:persona-followup-mutation` | 같은 step | 구조 상한·글쓴이 예외·일반 반복 금지·profile·비용·증거를 지우거나 넓히면 잡히는지 확인 |
| `npm run check:persona-followup-reselect` | 같은 step | H1 러너 결정 시험 — 실패 Persona 반복 0 · 같은 회차 대체 성공 · 글 실패가 다른 Persona·글을 막지 않음 · KST 자정 해제 · 일시 실패 오격리 0 · 모든 후보 실패 · 호출·비용 상한 · 결과 기록 IO 실패 · 첫 댓글 lane 규칙 불변(첫 댓글 저장소를 받으면 호출 0) · 실회원 Persona 선택 0 |
| `npm run check:persona-followup-reselect-mutation` | 같은 step | 러너 사본에 재선정·격리·상한·중단 분기 14개를 하나씩 깨서 위 시험이 잡는지 확인 |
| `npm run persona:followup-db-check` | 격리 Postgres step | 실제 consumer e2e · OFF 무변화 · 첫 댓글 회귀 · 정상 답글 · 총 10 상한 · 글쓴이 두 번째 답글 · 일반 반복 차단 · 실회원 우선 · 중복·동시 · 복구 · 장부 · 단계 증거 분리 |

새 step 은 없다(무조건 step 상한 불변 · `check:workflow-budget` 90/90).

## 7. 활성화 선행조건 — 이 PR 밖

| ID | 무엇 | 상태 |
|---|---|---|
| E1 | 단계 증거 상한·출처 분리 | ✅ #707 |
| E2 | 발행 트랜잭션 추가 댓글 레인 | ✅ 이 PR(기본 OFF) |
| E3 | 홈·베스트 랭킹의 Persona 댓글 합산 분리(Batch F · C-03) | ✅ #706 (main · Production) — 홈 인기 신호는 실회원 사람 수 · Persona·운영 댓글 제외 · 비회원 상한 3. `/best`(best-v2)는 원래 실회원 전용이라 변경 없음 |
| E4 | North Star 와 병렬인 제한 canary 정책 · D10 profile 사람 승인 | ✅ 2026-10-14 창업자 승인. Persona·운영자 활동은 North Star 에서 제외하고 첫 댓글·실회원·비용·중복·감사·kill switch·rollback 불변 |
| E5 | 런타임 반영 — 보조 Mac runtime 배포 · 댓글 러너 plist 재설치 · env 2개 · profile 파일 | ✅ 2026-10-15 확인 — runtime `6f28fc3`, E6 plist, switch ON, D10 profile 설치. D10 자연 회차 operating 증거는 대기 |
| E6 | 댓글 러너를 consumer(`stage-consume-exec --by=comment`) 경유로 | ✅ 코드·설치 모두 확인 — `stage-consume-exec --by=comment` 뒤 `persona-comment-loop --live`. 스위치 OFF면 consumer 결정 읽기 0 · 오늘 결정만(`followupStageOf`) |

## 8. 추가 발견 · 제안

- E6 로 댓글 러너가 consumer 를 지나도 **첫 댓글은 단계 칸을 읽지 않아 그대로다**(첫 댓글 경로 import 그래프에서 단계 함수 호출 0 · 첫 댓글 격리 DB 검사 39/39).
  consumer 의 결정 읽기는 추가 댓글 스위치가 켜졌을 때만 일어난다.
- 설치된 댓글 러너 plist 는 옛 모양(직접 실행)이다. 이 PR 은 템플릿만 바꾼다 — 보조 Mac 재설치(E5) 전에는 운영에서 consumer 를 지나지 않고, 따라서 스위치를 켜도 추가 댓글은 0 이다.

- 🔴 첫 연결판은 그날 단계를 `StageDecision` 표에서 직접 읽었다 — `stage:ladder-check`(adapter 는 controller·consumer·운영 화면만)가 잡았다.
  consumer env 로 바꾸자 지금 댓글 러너 모양에서는 단계가 비어 0건이 된다. 켜려면 E6(댓글 러너 consumer 경유)이 먼저다.

- stamina 를 지운 뒤 근거 있는 글이 길게 이어진다. 구조는 추가 0~9건까지 허용하지만 실제 수량은 미해결 hook과 승인 profile이 정한다.
  추가 댓글이 스스로 질문을 만들면 다음 거리가 되기 때문이다. 상한 10·사슬 6·같은 대상 1회·실회원 우선이 막지만, 실제 생성기가 질문을 얼마나 자주 내는지는
  운영 관측 전이다 — profile 의 `dailyCount` · `runMax` 를 정할 때 이 수치를 본다.
- 정기 회차가 사건 표식을 거두면 trigger 가 `event` 로 기록되어 그 회차는 추가 댓글을 건너뛴다. 사건이 잦은 날 추가 댓글이 적게 돌 수 있다(첫 댓글에는 영향 없음).
- 변이 시험이 실제로 일을 했다: 실회원 댓글이 첫 댓글 뒤에 있던 우회 반례는 모든 사례가 "마지막 말 실회원" 하나로 막혀 의도한 사유를 못 보고 있었다 — 사유 단언으로 고쳤다.
  트랜잭션의 "자기 댓글 답글" 분기는 혼자서는 절대 걸리지 않는 죽은 분기라 지웠다(같은 Persona 규칙이 막는다).

## 9. 운영 공통 profile 승인과 적용 runbook (2026-10-19)

이 값은 기능 사용 가능 여부를 단계와 분리하는 운영 공통 profile이다. 수량과 비용은 영구값이 아니며 운영 실측으로
조정한다. 값이 없거나 승인·판독·장부·감사 관문이 깨지면 0건(fail-closed)이다.

```json
{
  "v": "followup-profile-v1",
  "stage": "all",
  "dailyCount": 40,
  "dailyUsd": 0.08,
  "runMax": 3,
  "perPersonaDailyMax": 3,
  "approvedBy": "founder",
  "approvedAt": "2026-10-19T15:25:00+09:00"
}
```

정본 profile 경로는 `~/Library/Application Support/soransoran/followup-profile-v1-operating.json`이다.
정본 env `~/Library/Application Support/soransoran/env.local`에는 아래 두 키만 추가한다.

```text
SORAN_PERSONA_COMMENT_FOLLOWUP=on
SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE=/Users/<owner>/Library/Application Support/soransoran/followup-profile-v1-operating.json
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
