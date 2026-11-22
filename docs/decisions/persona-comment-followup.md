# 글당 Persona 댓글 — 첫 댓글 뒤 대화 계획(글당 목표 평균에서 계산)

작성: 2026-10-13 · 연결: 2026-10-14(main 7b532940 통합 · 러너·발행 트랜잭션·장부·CI · E6 consumer 경유) · 2026-10-19 profile 보정 · 2026-11-04 구조 상한 보정 · 2026-11-14 H1 실패 분류·같은 회차 재선정(§4-1) · 2026-11-18 대화 계획으로 교체(§4-2) · 2026-11-19 목표 평균 하나 · 마감 8시간 · 상한 계산식(§4-3) · 2026-11-21 꼴은 실제 댓글에서 · 역할은 실제 몫(§4-2) · 상태: **운영 중**(추가 댓글은 2026-10-19부터 · 대화 계획은 그 코드가 runtime 에 배포된 날부터)
근거 정본: D100 canon §5 "첫 댓글에서 선택적 다중 턴으로" · 답글 안전 불변식 · NORTH-STAR "이어지는 대화"

## 결론

- 자동 글마다 60분 안 첫 댓글 1건 계약과 provenance는 **그대로**다. 첫 댓글 지시문은 2026-11-21 꼴 판(§4-2)으로 바뀌었고,
  그 지문을 `check:persona-followup` 이 고정한다 — 추가 댓글 자리 칸이 첫 댓글 지시문을 바꾸지 않는다.
- 첫 댓글 뒤 글의 **대화 계획**(글당 목표 평균에서 나온 크기 · `src/lib/persona-thread-target.ts`)에 남은 자리를 한 회차에 한 글 한 건씩,
  마감(공개 뒤 8시간)에서 역산한 간격으로 채운다. 글당 구조 상한은 목표 평균의 두 배다.
- 러너 · 발행 트랜잭션 · 장부 · 단계 증거 분리 · CI 까지 실행 경로가 연결됐다. 기존 보조 Mac runtime에는
  E6 consumer 경유 plist, 스위치 `on`, 승인된 profile이 설치돼 있다(처음에는 D10 전용 · 2026-10-19부터 운영 공통).
- 2026-10-19부터 기능 사용 가능 여부를 단계와 분리한다. 승인된 운영 공통 profile(`stage: all`)은 d5부터 D100까지
  같은 안전 관문을 쓰고, 공개량·Persona·예산·회차 상한만 실측에 맞춰 조정한다. 모든 글을 상한으로 채우지는 않는다.
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
launchd 회차(followupEligibleFor: scheduled — 정기 · 사건 깨움 · 복구 kickstart 모두 같은 label) · --live · 스위치 on 일 때만
  runCommentLoop
    ① 첫 댓글 sweep → 생성 → sweep            ← 지금과 같다. 추가 댓글 행(comment-followup:*)은 집지 않는다
    ② followupPhase (첫 댓글 sweep 뒤 · 실패해도 첫 댓글 결과 불변)
         readFollowupContext   그날 단계(consumer 결정 env · decisionStageEnv) · 승인 profile 파일 · 대화 감사(judgeConversationAudit)
         sweepFollowupLane     남은 추가 댓글 PENDING 먼저(복구 · provider 0)
         judgeFollowupTick     스위치 · 단계 · kill switch · 첫 댓글 대기 양보 · profile · 대화 감사 · 장부(첫 댓글 몫 선차감)
         judgeFollowupPost     출처 · 첫 댓글 · 계획 크기 · 실회원 우선 · 대화 마감 · 계획의 다음 자리(followupSeatsOf) · 시간차
         orderFollowupGo → pickFollowupSeat(자리·사람 넘기기 · 생활사·No-Go 사전 확인) → buildCommentInput(replyToDigest · threadSeat)
         runEnqueuePipeline    댓글 관문 정본(②·④ 는 2026-11-19 삭제) · 장부 단계 commentFollowupGen · judgeFollowupText(중복·같은 도입)
         PENDING 적재          dedupKey comment-followup:<글>:<순번> · editDiff.followupStamp
         sweepFollowupLane     publishCandidateTx({ followupLane: true })
```

- **launchd 가 연 회차는 정기 · 사건 깨움 · 복구 kickstart 모두 추가 댓글을 돈다** — 같은 label 이라 trigger 가 늘 `scheduled` 다
  (사건 표식은 진단 칸 `absorbed` 에만 남는다). 손으로 띄운 회차(`manual`)와 dry-run 만 첫 댓글만 한다.
- **발행 트랜잭션**(`followupLane`)은 공통 안전 재검사(댓글 관문 · 실회원 3건 · kill switch · provenance · 생활사 · 하루 절대 500)를 그대로 돌린다. 첫 댓글의 글당 provider 기준 5는 followup에 재적용하지 않고, followup은 승인 profile 잔량과 글당 구조 상한을 함께 본다. 글쓴이 아닌 Persona 는 한 글에 두 번까지 말하고(새 댓글 한 번 + 자기 댓글에 달린 답에 답글 한 번), 글쓴이 Persona 는 서로 다른 유효 대상에 답글로 최대 3회 말할 수 있다.
  그 위에 `judgeFollowupPublish` 를 더한다: 스위치·단계 재판독 · profile 재판독 · 오늘 추가 수(profile 상한) · Persona 하루 상한 · 다른 열린 후보 ·
  도장 검증 · 순번 = 지금 자리 · 최소 간격 10분 · 대상 유효성(살아 있음 · Persona 댓글 · 신고 없음 · 아직 답 없음 · 사슬 6) ·
  도장의 대상이 지금도 이 순번의 자리인지 · 정해진 사람(글쓴이 · 다시 답하는 사람)의 자리를 다른 Persona 가 쓰지 않는지.
- 생성 쪽과 트랜잭션 쪽은 **같은 함수**(`followupBaseOf` · `replyTargetOpen` · `followupSeatsOf`)를 쓴다.
- 답글은 `Comment.parentId` 로 쓴다. 첫 댓글 · 사람 발행은 언제나 최상위다.

## 2. 정책 → 코드

| # | 정책 | 코드 |
|---|---|---|
| 1 | 첫 댓글 1개 계약·provenance 유지 | 자동 출처(`auto`) 첫 댓글이 없는 글 `STOP` · 60분 안 첫 댓글 대기 글이 있으면 회차 0건 · 표식·분류는 #707 정본(`FOLLOWUP_LANE_*` · `personaCommentProvenanceOf`) · 대화 감사 FAIL·판독 불가 → 추가 0(첫 댓글은 계속) |
| 2 | 추가는 구조 상한 − 1 까지 | `FOLLOWUP_EXTRA_PER_POST_MAX = PERSONA_COMMENTS_PER_POST_MAX − 1` |
| 3 | 모든 글을 상한으로 채우지 않음 | 수량은 **글의 대화 계획**이 정한다(`src/lib/persona-thread-plan.ts` — 글 id 와 공개 시각의 목표 평균으로 크기를 뽑는다). 자리마다 종류(글에 답 · 글쓴이 답글 · 다른 사람 답글) · 모양 · 간격이 정해진다(길이는 꼴이 정한다 — §4-2). 한 댓글에는 답이 하나만 달린다 |
| 4 | 글쓴이 아닌 사람 두 번까지 · 글쓴이 제한 답글 | 글쓴이 아닌 Persona 는 그 글에 2회까지(`PERSONA_OTHER_TURNS_PER_POST_MAX`) — 두 번째는 자기 댓글에 달린 답에 답글로만. 글쓴이는 최상위 댓글 0, 서로 다른 유효 대상에 답글로 최대 3회. 정규화 일치 / bigram Jaccard ≥0.5 / 같은 도입 6자 |
| 5 | 실회원 우선 · 추가량 축소 | 실회원 1~2건 → 추가 ≤1 · 3건 이상 → 0 · 마지막 말이 실회원이면 0 · 실회원 댓글에는 답하지 않음 |
| 6 | 시간차 · 마감 | 직전 Persona 댓글에서 계획이 정한 간격(마감에서 역산 · 큰 대화일수록 짧다 · 최소 10분) · 발행 재검사는 최소 10분 · 한 회차 한 글 1건 · 회차 전체는 profile `runMax` · 같은 회차 같은 Persona 한 글 · 대화 마감(공개 뒤 8시간 · `THREAD_DEADLINE_MS`) 뒤 새 자리 0 |
| 7 | 한 후보의 실패가 글을 멈추지 않음 | 계획이 정한 자리가 지금 설 수 없으면 새 사람이 대신한다 — 글에 새 댓글 → 남의 댓글에 답글(`pickFollowupSeat`). 글쓴이 자리는 계획이 준 자리에서 글쓴이만 선다 |
| 8 | 글당 Persona 구조 상한 · 사슬 최대 6 | `PERSONA_COMMENTS_PER_POST_MAX` · `PERSONA_REPLY_CHAIN_MAX` · 트랜잭션 `recheckBeforePublish` 도 그대로 본다 |
| 9 | 비용 · 상한 · kill switch · 멱등 · 복구 | §3 · §4 |
| 10 | 기본 OFF | `SORAN_PERSONA_COMMENT_FOLLOWUP=on` 정확히 그 값 · 트랜잭션도 다시 읽는다 · 이 PR 은 설정하지 않는다 |

## 3. 비용 · 상한 · kill switch

- 장부: 같은 댓글 장부(`persona-comment-ledger`) · 같은 하루 상한(env 가 정한다 — 기본 $0.20 · 코드 천장 $0.90) · **단계 `commentFollowupGen`** — 첫 댓글(`commentGen`)과 줄이 나뉜다.
  유료 생성 문(장부 판정)이 닫혀 있으면 추가 댓글 생성도 0.
- 공유 장부 잔량에서 **오늘 남은 첫 댓글 의무**(지금 대기 + 그날 단계 목표 중 아직 공개되지 않은 자리) × 1건 예약액을 먼저 뗀다.
  1건 예약액 = 확정 모델 단가 × 댓글 호출 모양 × 여유 배수. 단가를 모르면 0건.
- 수량 상한은 **승인 profile 파일**(`followup-profile-v1`)에서만 온다: `{ stage · dailyCount · dailyUsd · runMax · perPersonaDailyMax · approvedBy · approvedAt }`.
  파일 없음 · 손상 · 단계 ≠ 그날 단계 · 사람 승인 없음(`machine:` 포함) → 0건. 트랜잭션도 같은 파일을 다시 읽는다.
  그날 단계는 **consumer 가 넣은 결정 env** 로만 안다 — 정본 읽기 문 `decisionStageEnv` 결과를 `followupStageOf` 가 판정한다
  (회차·트랜잭션 같은 함수): 표식 날짜 = 오늘(KST) 또는 그날 결정 전 consumer 가 넣은 전날 결정의 날짜(어제) ·
  공개·천장이 정본 단계 · 공개 ≤ 천장. 아니면 단계 모름 → 0건. (2026-11-22) 댓글 러너가 24시간 돌아, 자정~그날 결정 전에는
  consumer 가 공급과 같은 `readSupplyHeadStart` → `headStartFor` 로 전날 공개 단계를 넣는다 — 전날 행 없음 · 깨짐 · 브레이크로
  낮춘 날이면 넣지 않는다(→ 0건). 대화 감사는 오늘 글과 마감(8시간) 안의 어제 글을 함께 읽는다(`conversationAuditDatesOf`).
  러너·트랜잭션은 결정 표를 직접 읽지 않는다(`stage:ladder-check` adapter 계약). 이 모듈은 단계 칸 env 를 직접 읽지 않는다.
  profile 의 값은 계산식 `deriveCommentScale`(§4-3)이 낸 것을 옮겨 적는다.
- 구조 상한은 운영 예산을 확대하지 않는다. 첫 댓글 부트스트랩 계산은 글당 자리 기준 5와 하루 절대 500을 유지하고,
  추가 댓글에는 그 기준을 쓰지 않는다. 공유 장부 하루 상한의 기본값은 $0.20(`COMMENT_LOOP_DAILY_USD_DEFAULT`)이고 env 로 코드 천장 $0.90(`COMMENT_LOOP_DAILY_USD_MAX`)까지 올릴 수 있다.
  운영 수량은 §9 의 승인 profile 이 정하고, 바꾸려면 승인 파일을 새로 써야 한다.
- kill switch: `PersonaGlobalSwitch` — 회차와 트랜잭션 둘 다.

## 4. 멱등 · 복구

- 멱등 열쇠 `comment-followup:<postId>:<ordinal>` → `PersonaApprovalQueue.dedupKey`(`@unique`). 같은 자리 두 번 0.
  발행 재검사에서 닫힌 행은 열쇠를 `comment-followup-closed:<글>:<순번>:<행 id>` 로 바꿔 자리를 내놓는다 — 닫힌 행이 그 글을 식을 때까지 막지 않는다.
- 도장은 `editDiff.followupStamp`(판 `followup-v1`) — `gateResults` 는 관문 배열이라 섞지 않는다. 사람이 고쳐 칸이 바뀌면 발행하지 않는다.
- 첫 댓글 sweep 은 추가 댓글 행을 집지 않고, 추가 댓글 sweep 은 추가 댓글 행만 집는다 — 두 레인이 서로의 행을 닫지 않는다.
- 적재 뒤 죽으면 다음 정기 회차가 먼저 발행한다(provider 0). 발행 뒤 다시 돌아도 Queue · ActivityLog 중복 0.
- 놓친 회차를 메우지 않는다 — 늦으면 다음 회차에 한 건, 대화 마감(공개 뒤 8시간)이 지나면 끝.

## 4-1. 실패 분류 · 최소 범위 격리 · 같은 회차 재선정 (H1 · 2026-11-14)

- 문제: picker 가 (글, 순번) 해시로 Persona 를 고르는 결정적 선택이라, 실패한 Persona 를 다음 회차에도 다시 골랐다(starvation).
  직전 미완 diff 는 실패한 글 **전체**를 KST 하루 격리해 같은 글의 정상 Persona 까지 막았다. 그 post 전체 격리는 지웠다.
- 추가 댓글 시도 기억은 첫 댓글과 다른 파일(`followup-attempts.v1.json`)이고, 기억 기간은 KST 하루다(자정에 풀린다).
  첫 댓글 파일(`first-comment-attempts.v1.json` · 60분)과 첫 댓글 lane 판정은 바꾸지 않았다.
- 실패는 `classifyFollowupFailure` 가 다섯 코드 중 하나로 나누고, 시도 기억 `blockCodes` 에 함께 적는다(적힌 코드가 재분류보다 우선한다).

| 코드 | 원인 | 오늘(KST) 격리 범위 | 같은 회차 |
|---|---|---|---|
| `FU_PERSONA_DAY` | Persona 에 묶인 결정적 실패(⑧ 말투 · prompt 근거 · 비활성 · 실회원) | 그 Persona — 모든 글 | 같은 글에서 다음 정상 Persona 재선정 |
| `FU_POST_DAY` | 글에 묶인 실패(글 사라짐 · 비공개 · 게시판 바뀜 · Persona 댓글 꽉 참 · 글 상태 모름) | 그 글 하나 | 다음 글로 넘어간다 |
| `FU_COMBO_DAY` | 그 글 × 그 Persona 본문 실패(①~⑦ · ⑨ 관문 · 본문 중복 · 파싱 · 잘림 · 자리 중복). 막은 관문이 분류를 정한다 — ⑧ 미실행 꼬리표(`BOOTSTRAP_*`)는 원인이 아니다. 글쓴이는 자기 글에서 이 격리를 받지 않고 실패한 역할만 다시 보내지 않는다 | 글 × Persona 쌍 | 같은 글에서 재선정 |
| `FU_TRANSIENT` | 일시 provider · IO · 장부(429 · 5xx · NETWORK · TIMEOUT · LEDGER_BLOCKED · DB ERROR) | 없음 | 회차를 멈춘다. 다음 회차에 같은 조합을 새로 시작할 수 있다 |
| `FU_HALT` | 모르는 · 내부 실패 · 요청 모양 거부(400) | 글 × Persona 쌍 | 회차를 멈춘다 |

- 상한: 적재는 profile 잔량(`allowed`) 그대로다. provider 호출은 `min(followupPlanCap(allowed) = allowed × 2, 비용 잔량 건수)`이고,
  한 글에서 한 회차에 부르는 횟수는 `FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK` = 2 다. 하루 USD · 공유 장부 상한 · 첫 댓글 몫 선차감은 그대로다.
- 후보 필터(`followupPersonaCandidates`)는 실회원 · 비활성 · 프로필 미완 · 말투 불가 · 격리 Persona · 격리 쌍 · 이번 회차 사용 Persona 를 뺀다.
  회차 안의 격리 사본은 실패 직후 갱신되므로, 같은 글에 머무는 재선정은 방금 실패한 Persona 를 다시 고르지 않는다.
- 시작 기록이나 결과 기록을 쓰지 못하면 provider 를 더 부르지 않고 회차를 멈춘다(fail-closed).
- 출처 문맥은 GO 글마다 판정한다. 모르는 글은 그 글만 이번 회차에서 막고, 문맥이 확인된 다른 글은 계속 처리한다.
  막힌 글은 ⑨ 관문에서도 필수 입력 누락으로 다시 거부돼 안전 우회가 없다.
  생성기(`makeGenerate`)에는 계획된 Persona 만이 아니라 재선정될 수 있는 정상 Persona 전부를 넘긴다.
- 실제 회원 댓글 · 원문은 읽기 판정에만 쓰고 쓰지 않는다.

## 4-2. 대화 계획 (2026-11-18)

- 계획은 `threadPlanOf(글 id)` 하나가 정한다. 저장하지 않는다 — 같은 글은 언제 다시 세워도 같은 계획이다.
  크기(2 ~ 목표 평균의 두 배 · 평균 = 목표) · 자리 종류 셋 · 모양 넷(한마디 · 공감 · 되묻기 · 경험으로 답) · 간격(마감에서 역산).
  2026-11-19 부터 숫자는 `persona-thread-target` 의 목표 평균과 마감 둘이다.
- 🔴 모양은 자리 종류가 허용하는 것 안에서 실제 몫(`REAL_REACTION_SHARE` · 참고 댓글 879건 실측)으로 뽑는다. 첫 "글에 답"을 경험으로 몰지 않는다.
  첫 댓글 planner 도 같은 몫을 쓴다 — 쓴 수 ÷ 몫이 가장 작은 역할부터, 몫 없는 역할은 맨 뒤.
- 🔴 **꼴은 실제 댓글에서** (2026-11-21). 계획은 길이를 정하지 않는다. 자리마다(첫 댓글은 순번 1) `pickCommentForm` 이
  참고 댓글 풀(`commentFormPool` — 5~160자 전체)에서 `unitOf('form', 글, 순번)` 로 댓글 하나를 뽑아 `commentFormOf` 가 잰
  꼴 값(글자 수 · 한 줄/여러 줄 · 말끝 종류 · 끝부호 · 물음표 · 말줄임 · 이모티콘)**만** 요청 끝 JSON 으로 건넨다 — 그 댓글 본문은 건네지 않는다
  (본문을 주자 낱말이 샜고, 끝 3글자 · 줄 수를 글자 그대로 맞추느라 어색한 문장이 나왔다 — 11-21 실측 48건).
  말끝 종류는 `endingKindOf` 가 요(…요 · …죠) · 다(평서 · 반말 종결) · 끊김(연결어미 · 조사) · 명사(낱말 · 감탄)로 나눈다.
  경험으로 답하는 자리는 41자 이상에서 뽑는다. 꼴이 없으면 근거를 강제하는 경로에서 `FORM_MISSING` 으로 막는다. 꼴은 저장하지 않는다.
- 살아 있는 Persona 댓글 수가 계획 크기에 닿으면 그 글은 끝난다(`STOP`).
- 자리 넘기기: 계획이 정한 종류가 먼저다. 그 자리가 설 수 없으면 새 사람이 대신한다(글에 새 댓글 → 남의 댓글에 답글). 글쓴이는 대신 서지 않는다.
  고른 사람이 생활사·No-Go 확인에서 막히면 같은 자리의 다음 사람으로 간다. 끝까지 없으면 실제 사유를 모아 남긴다.
- 이때 바뀐 것은 셋이다(관문 ②·④ 는 2026-11-19 지웠다 — 대조 대상이 우리 사이트의 글·댓글이라 대화를 막았다).
  - 관문 ⑦(경험 근거)은 추가 댓글에서 가벼운 일상 경험을 허용한다. 막는 것은 근거 없는 의료 사실 · 카드가 겪는 중·겪은 뒤가
    아닌데 자기 일로 말하는 갱년기 · 카드나 자기 글이 뒷받침하지 않는 부부 불화 · 설정 모순이다. 첫 댓글은 이 허용을 받지 않는다.
  - 대화 감사(`judgeConversationAudit`)의 `FOLLOWUP_DUP_PERSONA` 는 글쓴이 아닌 사람이 세 번 이상 말했거나 새 댓글을 두 번 달았을 때 선다.
  - 발행 트랜잭션은 도장의 대상을 `followupSeatsOf` 의 자리와 대조한다.
- 프롬프트에는 "이 사람이 자기 이야기로 말해도 되는 사실"(카드의 축 + 자기가 쓴 글 제목)과 이 글의 앞 Persona 댓글 첫 어절 · 말끝 3자
  (`postPersonaMarksOf` · 실회원 댓글 제외 · 본문 없음)가 들어간다. 말투 카드(voiceCore · voiceVariations)는 싣지 않는다 —
  자기 발화가 없을 때 카드의 말버릇을 "최근에 썼다"로 넘기던 것도 지웠다.
  지시문은 경험담 · 질문을 권하지 않고, 글의 낱말을 받아 말하되 관문 ① 의 글자 수 이상 옮기지만 않게 한다.
- §4-1 의 실패 분류와 격리는 그대로다.

## 4-3. 목표 평균 하나 · 대화 마감 · 상한 계산식 (2026-11-19 밤 1)

- 숫자는 `src/lib/persona-thread-target.ts` 의 둘이다 — 글당 목표 평균(`THREAD_TARGETS` · 공개 시각별 줄)과 대화 마감(`THREAD_DEADLINE_MS`).
  크기 분포(2 + 이항) · 크기 상한(평균의 두 배) · 자리 종류 수 · 간격 · 글당 구조 상한(`PERSONA_COMMENTS_PER_POST_MAX`)이 여기서 나온다.
  평균을 바꿀 때는 줄을 덧붙인다 — 있는 줄을 고치면 이미 공개된 글의 계획 크기가 바뀌어 끝난 대화에 새 자리가 열린다.
- 간격은 마감에서 자리마다 러너 틱 하나를 떼고 크기로 나눈 평균을 0.5~1.5배로 흩는다(합 유지). 가장 긴 계획도 마감 안에 끝난다.
  마감이 지난 글에는 새 자리를 열지 않는다(생성 · 발행 트랜잭션 · 시도 기억 창이 같은 값).
- 상한은 `deriveCommentScale`(`src/lib/followup-profile-derive.ts`)이 하루 편수 · 글당 목표 평균 · Persona 수(조용한 Persona 는 절반)로 계산한다:
  Persona 하루/주 · 추가 댓글 하루 건수 · 회차 · Persona 하루(= Persona 하루 상한) · 하루 USD(실측 단가 · 적재율이 있을 때).
  운영 DB `Persona.dailyCap/weeklyCap` 은 `scripts/persona-comment-cap-apply.mts` 로, 호스트 profile 은 승인 파일로 그 값을 옮겨 적는다.

## 5. 단계 증거 분리 (D10)

- 추가 댓글은 Queue `machine:persona-comment-followup` · ActivityLog `auto-followup` 표식으로 남는다 → `personaCommentProvenanceOf` = `followup`.
- 단계 증거는 `followup*` 를 첫 댓글 분자 · 상한(1) · 중복 · 자기 글 어디에도 세지 않는다(#707). 추가 댓글 결함은 대화 감사 FAIL 로만 드러나고, 그 FAIL 이 추가 댓글 브레이크다.
- 격리 DB 검사가 실제 행으로 확인한다: 첫 댓글 1건 인정 · `COMMENT_*` 코드 0 · `followupComments` 1 — 그리고 같은 행을 수동 출처로 섞으면 `COMMENT_OVER_CAP`(대조군).

## 6. 검사

| 명령 | CI | 내용 |
|---|---|---|
| `npm run check:persona-followup` | `베스트·댓글 정책 가드` step | 순수 시나리오 · profile 반례 · 계획(평균 = 목표 · 마감 안 완주 · 큰 대화가 빠름 · 모양 = 실제 몫) · 구조 선(사슬 6 · 글쓴이 3) · 글쓴이 아닌 사람 2회 · 글쓴이 답글 3회 · 계획 자리 넘기기 · 사슬 6 · 첫 댓글 프롬프트 지문 고정 |
| `npm run persona:comment-form-check` | `Persona 프롬프트 계약` step | 꼴 재기 · 말끝 종류 · 꼴 결정성 · 1,000 자리 길이 분포 = 풀 ±3%p · 계획 10,000편 모양 = 실제 몫 ±2%p · planner 몫 순서 · 지시문의 꼴 절과 지운 문구 · 풀 본문 0 · 꼴 비저장 |
| `npm run check:persona-followup-mutation` | 같은 step | 구조 상한·글쓴이 예외·한 사람 두 번 상한·profile·비용·증거를 지우거나 넓히면 잡히는지 확인 |
| `npm run check:persona-followup-reselect` | 같은 step | H1 러너 결정 시험 — 실패 Persona 반복 0 · 같은 회차 대체 성공 · 글 실패가 다른 Persona·글을 막지 않음 · KST 자정 해제 · 일시 실패 오격리 0 · 모든 후보 실패 · 호출·비용 상한 · 결과 기록 IO 실패 · 첫 댓글 lane 규칙 불변(첫 댓글 저장소를 받으면 호출 0) · 실회원 Persona 선택 0 |
| `npm run check:persona-followup-reselect-mutation` | 같은 step | 러너 사본에 재선정·격리·상한·중단 분기 14개를 하나씩 깨서 위 시험이 잡는지 확인 |
| `npm run persona:followup-db-check` | 격리 Postgres step | 실제 consumer e2e · OFF 무변화 · 첫 댓글 회귀 · 정상 답글 · 총량 상한 · 글쓴이 두 번째 답글 · 한 사람 세 번째 말 차단 · 실회원 우선 · 중복·동시 · 복구 · 장부 · 단계 증거 분리 |

새 step 은 없다(무조건 step 상한 불변 — `check:workflow-budget`).
계획 분포를 글 id 표본으로 다시 세어 보는 읽기 전용 도구는 `scripts/persona-thread-plan-replay.mts` 다.

## 7. 활성화 선행조건 — 📜 전부 끝났다

| ID | 무엇 | 상태 |
|---|---|---|
| E1 | 단계 증거 상한·출처 분리 | ✅ #707 |
| E2 | 발행 트랜잭션 추가 댓글 레인 | ✅ 이 PR(기본 OFF) |
| E3 | 홈·베스트 랭킹의 Persona 댓글 합산 분리(Batch F · C-03) | ✅ #706 (main · Production) — 홈 인기 신호는 실회원 사람 수 · Persona·운영 댓글 제외 · 비회원 상한 3. `/best`(best-v2)는 원래 실회원 전용이라 변경 없음 |
| E4 | North Star 와 병렬인 제한 canary 정책 · D10 profile 사람 승인 | ✅ 2026-10-14 창업자 승인. Persona·운영자 활동은 North Star 에서 제외하고 첫 댓글·실회원·비용·중복·감사·kill switch·rollback 불변 |
| E5 | 런타임 반영 — 보조 Mac runtime 배포 · 댓글 러너 plist 재설치 · env 2개 · profile 파일 | ✅ 2026-10-15 확인 — runtime `6f28fc3`, E6 plist, switch ON, D10 profile 설치(2026-10-19 운영 공통 profile 로 교체) |
| E6 | 댓글 러너를 consumer(`stage-consume-exec --by=comment`) 경유로 | ✅ 코드·설치 모두 확인 — `stage-consume-exec --by=comment` 뒤 `persona-comment-loop --live`. 스위치 OFF면 consumer 결정 읽기 0 · 오늘 결정(그날 결정 전이면 전날 결정 · 2026-11-22)만(`followupStageOf`) |

## 8. 추가 발견 · 제안

- E6 로 댓글 러너가 consumer 를 지나도 **첫 댓글은 단계 칸을 읽지 않아 그대로다**(첫 댓글 경로 import 그래프에서 단계 함수 호출 0 · 첫 댓글 격리 DB 검사 39/39).
  consumer 의 결정 읽기는 추가 댓글 스위치가 켜졌을 때만 일어난다.
- 수량은 대화 계획과 승인 profile(하루 건수 · USD · 회차 상한)이 정한다. 대화 감사(`judgeConversationAudit`)가 같은 계약을 사후에 다시 본다.
- 변이 시험이 실제로 일을 했다: 실회원 댓글이 첫 댓글 뒤에 있던 우회 반례는 모든 사례가 "마지막 말 실회원" 하나로 막혀 의도한 사유를 못 보고 있었다 — 사유 단언으로 고쳤다.
  트랜잭션의 "자기 댓글 답글" 분기는 혼자서는 절대 걸리지 않는 죽은 분기라 지웠다(같은 Persona 규칙이 막는다).

## 9. 운영 공통 profile 승인과 적용 runbook (2026-10-19)

이 값은 기능 사용 가능 여부를 단계와 분리하는 운영 공통 profile이다. 수량과 비용은 영구값이 아니며 운영 실측으로
조정한다. 값이 없거나 승인·판독·장부·감사 관문이 깨지면 0건(fail-closed)이다.
아래는 2026-10-19 승인 파일(역사)이다. 2026-11-18 창업자 승인으로 130건 · $0.30 · 회차 6 · Persona 3 이 설치됐고, 2026-11-19 밤 1 부터는
§4-3 계산식의 값을 옮겨 적는다(값을 이 문서에 다시 적지 않는다).

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
