# 현재 실행 — D30 복구와 D100 병행

> as-of: 2026-11-15 00:40 KST
> 마지막 창업자 동기화: 2026-11-14 (D30 blocker 근본 수리 · 댓글 starvation 제거 · Persona 60 · 비용 4.0¢)
>
> 이 문서는 검증된 현재 상태와 다음 실행만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다.
> `PLANNED → DESIGNED → CODE_PASS → MERGED → DEPLOYED → OPERATING_PASS`는 서로 다른 상태다.
> 관측하지 않은 것을 PASS로 쓰지 않는다. 모르는 운영 결과는 UNKNOWN이다.

## 0. 창업자용 한 문장

**D20 operating PASS는 유지된다. D30을 막던 Persona·비용·댓글 결함의 코드와 자산은 복구 브랜치에서
검증 중이며, 운영 호스트 읽기 전용 대조에서 새 Persona 20명은 20/20 ready다. 아직 main merge·runtime 배포·운영 DB 투입은
하지 않았으므로 D30이 열린 상태는 아니다.**

## 1. 검증된 현재 사실

| 항목 | 현재 사실 |
|---|---|
| 원격 main (2026-11-15 06:30 관측) | `6d23038041799bd2353a92a4aa6ae692bd02330d` |
| 원격 main 내용 | PR #847 병합까지 · #845 배포기 식별자 수리 · #846 D30 1회 투입기 · #847 실행기 DB 판독 수리 · #843 D30 복구 포함 |
| 보조 Mac D100 runtime HEAD = pin = manifest | `6d23038041799bd2353a92a4aa6ae692bd02330d` · main과 동일 SHA · 2026-11-15 05:01 배포(staging 배포기 진입) · strict 격리 551/0 · manifest Persona 자산 식별자 = 실측 v2 |
| 보조 Mac D100 job | 10개 loaded(observer 포함) · 2026-11-15 00:06 읽기 전용 관측 · 재기동 뒤 첫 자연 회차 전 |
| 회사 Mac D100 job | 0 · D100 owner 아님 |
| 직전 자연 결정 (2026-11-13) | `PREPARE · 공개 d20 · 준비 d30` · controller 행 1개 |
| 최신 단계 증거 | 11-12 d20 증거 PASS · 11-13 07:00 controller 확정 |
| D20 operating | **PASS** · 자동 20/20 · 첫 댓글 20/20 · 감사 표본 4/4 · 같은 runtime SHA |
| Persona 운영 DB (2026-11-15 06:06 정본 판독) | **contract-valid 39 · stage-active 39** · active 행 40 · P15 qualification-pending(seed≠정본 카드 workStatus) · P44~P63 0행 · D30 하한 60 |
| Persona 확장 자산 | P44~P63 20명 · 30대 0 · 기존 40명 말투 배정 불변 · 승인 fixture SHA-256 재대조 green · 운영 DB write 0 |
| Persona 보충 근거 | v2 snapshot 기록됨(2026-11-14 22:37) · 승인 digest `be47bb887a879706e47dd0cd86017d50dbe9f6cd87ff2e1aa55b8765cfda8ad5`(옛 `cf3dbdac…`는 낡음) · 독립 dry-run 4회 동일 · 독립 검사 18/18(기존 40 배정 diff 0 · 동결 10 바이트 동일 · 신규 20/20) · 운영 DB write 0 |
| 비용 기준선 | 49개 slot-valid · $2.4056 · 약 **$0.04909/result** · D30 기준 $0.040 초과 |
| 비용 수리 | 유료 의미 검수 전에 지배 판정 · publish/safety/quality gate 완화 0 · 운영 효과 UNKNOWN |
| 추가 댓글 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 · 80건/$0.16 profile은 창업자 승인(아직 미배포) |
| 현재 댓글 정책 | 첫 댓글 1 + 선택적 0~9 · 총 구조 상한 10 · 글쓴이 답글 최대 3회 · automatic provenance |
| 댓글 기준선과 수리 | 11-12 글당 1.9 · 실패 254건의 두 Persona 집중 원인 확인 · typed block code·KST-day 격리·same-tick 재선정은 코드 검증, 운영 효과 UNKNOWN |
| 완료 상태 계약 | 상태기계 self-test 6/6 · Git·CI·host 실제 증거는 별도 live 명령으로 수집(자가 수집 하네스가 아님) |

### 1.1 이번 변경의 실제 검증

- Persona 계약 fixture: 133/133(실제 fixture digest·1바이트 변이 포함).
- Persona 자동 생성: 134/134, creative 비용·품질·공식 token 계수 fail-closed 176/176, cohort seed 53/53.
- Persona 보충 근거: 37/37.
- 댓글 engine 전체: 1160/1160, H1 독립 fixture 61/61, mutation 14/14.
- 비용 지배 판정: generation-loss 77, mutation 27, supply e2e 154.
- 완료 상태 계약 self-test: 6/6. 입력 boolean을 검증하는 규칙이며 Git·CI·host 증거를 자동 수집하지 않는다.
- typecheck·lint: green.
- build·token 검사: green.
- 전체 문서 검사: 532 PASS · 0 FAIL.
- D30 stretch 계약: 54 PASS · mutation 17/17.
- exact-head 원격 CI: 아직 이 문서 시점에는 미완료.

위 검사는 **CODE_PASS 후보 증거**다. main 병합·runtime 배포·자연 운영 효과를 대신하지 않는다.

### 1.2 PASS 경계

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| D20 | ✅ | ✅ 11-12 증명 당시 runtime(직전 배포 SHA) | ✅ 11-12 자연 증명 |
| 댓글 starvation 수리 | ✅ targeted·mutation | ❌ | UNKNOWN |
| 비용 지배 판정 | ✅ targeted·mutation | ❌ | UNKNOWN — rolling 72h 실측 필요 |
| Persona +20 | ✅ local fixture·digest·mutation | ❌ 운영 DB write 0 | UNKNOWN |
| 완료 상태 계약 | ✅ self-test 6/6 | 해당 없음 | 해당 없음 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일
공개, 자연 댓글 분포, 실제 회원 재방문과 실제 열람은 별도로 관측한다.

## 2. 근본 원인과 수리

### 2.1 Persona 40/60

원인은 목표 문구와 실제 runnable cohort가 분리돼 있었고, 운영 회원 닉네임·말투 근거와 대조하지 않은 채 자산 준비를
완료처럼 보고한 것이다.

- D30 cohort를 P44~P63 append-only 20명으로 명시했다.
- 40대 6 · 50대 9 · 60대 5, 30대 0이다.
- 운영 DB와 익명 말투 근거를 읽어 닉네임·말투·생활사·creative·cadence·집단 다양성을 함께 판정한다.
- 기존 40명의 말투 배정 바이트를 보존하고 새 20명은 이미 점유된 화자 근거를 재사용하지 않는다.
- create·seed·activate는 각각 whole-20 Serializable transaction이며 부분 성공을 허용하지 않는다.
- 운영 DB write와 활성화는 아직 0이다.

### 2.2 공급 비용 4.909¢ → 4.0¢ 이하

기준선 49개 결과를 유지하면 총비용은 $1.96 이하여야 하므로 최소 $0.4456 절감이 필요하다. 코드 변경은
`AUTO_ADOPT`가 최선의 의미검수 결과를 받아도 불가능한 후보만 유료 의미검수 전에 멈춘다. Persona creative는
실제 유료 요청과 같은 입력을 공식 무료 `count_tokens`로 먼저 센 뒤 출력 hard cap과 함께 예약하며, 계수 실패는
유료 호출 0으로 끝낸다. UTF-8 byte를 token으로 간주해 한글 batch를 과대 차단하던 레거시는 제거했다.

- publish·safety·quality gate를 완화하지 않는다.
- 장부 92건에 같은 분포가 재현되면 모델상 약 $0.0377/result다.
- 이 숫자는 모델이지 운영 PASS가 아니다. 배포 뒤 rolling 72h 실측이 $0.040 이하일 때만 blocker가 닫힌다.
- 유리한 회차 골라내기·비용 창 단축·상한 증액으로 통과시키지 않는다.

### 2.3 댓글 starvation

원인은 글당 최대 10이 아니라 실패 후보 두 명이 매 회차 다시 선택돼 시도 용량을 소진한 것이다.

- 실패를 Persona-day · post-day · combo-day · transient · halt로 나눈다.
- 같은 tick에서 막힌 후보를 다시 뽑지 않고 다른 적격 Persona를 재선정한다.
- 첫 댓글 60분 계약, 실회원 우선, 일반 Persona 1회, 글쓴이 답글 3회, 구조 상한 10은 유지한다.
- 평균 5를 강제 quota로 만들지 않는다. 배포 후 고립률·실회원 참여·댓글 분포와 실제 평균을 함께 본다.

### 2.4 11-17 D30 시험 24/30 과 첫 수리 묶음 (2026-11-18)

11-17 은 controller 가 `TRIAL · d30` 을 열었고 공개 24편에서 멈췄다(`PUBLISH_NOT_AUTO_READY`). 전 단계 감사에서 확인한
직접 원인과, 그중 규칙이 사실과 어긋난 것만 먼저 바로잡은 변경이다. 운영 효과는 관측 전이라 전부 UNKNOWN 이다.
이 절만 2026-11-18 01:00 KST 에 더했다 — 그 밖의 절은 머리말의 as-of(11-15) 기준 그대로다.

| 원인(11-17 실측) | 변경 | 상태 |
|---|---|---|
| 잘린 원문 게이트에 걸린 89건(11-10~17) 중 50건이 수집 상한에 닿지 않은 글 | 상한에 닿은 원문에만 묻고 끝의 표정은 걷고 본다 — `quality-v27` · `draft-gates-v13` · `evidence-v3` | CODE_PASS |
| 카드 값 `진행중` 이 화자 자격에서만 갱년기 경험으로 읽히지 않음 | 판정을 `persona-life-facts` 한 곳으로 | CODE_PASS |
| 빈 슬롯 43회 전부 낼 글이 있었음 — 화자 최소 간격이 "직전 글 +24시간" | KST 날짜 기준 "하루 한 편"(`kstDaysBetween`) — 발행 게이트와 공급 예측이 같은 함수 | CODE_PASS |
| 첫 댓글 24편 전부 공개 +0~1분 | 글마다 읽는 시간 3~9분 뒤 — 60분 시한·단계 증거는 그대로 | CODE_PASS (별도 PR) |
| 추가 댓글 관문 탈락 4건 전부 글쓴이 답글 → 4편 동결 | 글쓴이 답글에서 자기 글은 ② 대조에서 빼고 ⑦ 근거로 싣는다 | CODE_PASS (별도 PR) |
| 둘째 댓글 자리의 남는 역할이 경험 하나뿐 → 입력 실패 243줄 | 역할표 끝에 되묻기 | CODE_PASS (별도 PR) |

고치지 않은 것: 의미 검수의 "지적 1건 = 탈락" · 고쳐 쓰기 부재 · 댓글 스레드 문법 · 수집량 · 축 구분. 재설계 설계서가 다룬다.

## 3. D30 개방의 정확한 blocker

| blocker code | 현재 | 해소 조건 |
|---|---|---|
| `PERSONA_SHORT` | contract-valid 40 · active 40 < 60 | 비증명일에 P44~P63 전체를 create→seed→check→activate하고 기존 40 배정 diff 0을 재검증 |
| `SUPPLY_COST_SHORT` | rolling 72h 기준 약 $0.04909/result > $0.040 | 지배 판정 코드 배포 뒤 같은 판정창의 자연 정산 실측이 $0.040 이하 |
| `COMMENT_STARVATION` | 11-12 실패 254건이 두 Persona에 집중 | typed 격리·same-tick 재선정 배포 뒤 자연 회차에서 starvation 0과 불변식 위반 0 |

### 3.1-b P15 정본 불일치와 11-15 투입 보류 (2026-11-15 06:06)

- 사실: 정본 `readPersonaCapacity`가 39/39다. P15 `identity.workStatus`가 2026-08-30 최초 정본부터 바뀐 적 없는 카드 값과 다르다.
  저장값은 2026-10-01 이후 불변이고, 9736e70f(#843)가 `verifySeedCard`에 그 축을 더한 뒤 runtime(11-15 00:01)부터 드러났다.
- 조치: 11-15 07:05 1회 job은 06:07에 내렸다(보관소 보존·실행 0). 운영 DB·StageDecision 변경 0.
- 수리: P15 정본 교정 1회(`persona:p15-remediation` — 이전 identity 정규 digest·updatedAt 고정 · Serializable 조건부 update ·
  감사 · 커밋 뒤 정본 판독 정확히 +1·다른 Persona 지문 diff 0 아니면 자동 되돌림)와 1회 투입기의 투입 전 hard gate
  (정본 contract-valid 40 AND stage-active 40, 마지막 게이트). 39/39이고 다른 게이트가 전부 통과할 때만 교정을 먼저 한 뒤 다시 판정한다.
- 이 수리는 code·CI·배포·설치 뒤 다음 PREPARE·비증명일 07:05에만 운영에서 실행된다. 그 전에는 운영 PASS가 아니다.

### 3.2 배포기 Persona 자산 식별자 결함 (2026-11-15 P0)

- 재현: 배포기가 자기 프로세스 코드로 식별자를 한 번 재고, 그 값을 manifest·재기동 대조·rollback 대조에 함께 썼다.
  runtime 트리(옛 SHA)에서 시작한 11-15 00:00 apply는 옛 코드가 읽는 v1 식별자를 새 runtime manifest에 적었다.
  재기동 대조도 같은 옛 함수로 재서 통과했다. 운영 소비자는 없지만 deployed 증거로는 red다.
- 수리: source(runtime 트리 코드)·target(staging 트리 코드)을 각 트리에서 따로 재고, manifest·재기동 대조는 target,
  rollback 대조는 source로 한다. fixture는 checkout된 SHA별로 다른 식별자를 돌려준다(반례 A-2d~g).
- 이 수리의 첫 재배포는 옛 runtime 배포기로는 수리가 실행되지 않으므로 **staging 트리(수리 포함 target)의 배포기**로 시작한다.
- 수동 manifest 수정은 하지 않는다. 재배포 뒤 manifest 식별자 = 실제 식별자를 확인해야 닫힌다.

### 3.1 배포 순서와 안전창

1. 전체 회귀검사와 독립 교차검수를 끝낸다.
2. exact-head CI가 모두 green인 한 PR만 main에 병합한다.
3. ✅ 보조 Mac에 말투 보충 묶음 v2 기록 · digest `be47bb88…` · 기존 40명 배정 diff 0 (2026-11-14 22:37 · 11-15 00:00 재검증).
   현재 runtime은 v2를 읽지 않으므로 이 준비만으로 운영은 바뀌지 않는다.
4. runtime은 23:40 감사 종료 뒤 00:30 수집 전인 **11-15 00:00~00:25**를 1순위로 삼는다.
   직전 `runner-recover`·observer·다른 job이 실제 idle인지 확인하고 한 번만 배포한다. 예비창은 01:00~01:25이며
   05:25를 넘기지 않는다. 단순히 22:15~05:30 전체를 idle로 가정하지 않는다.
5. 배포 직후 HEAD=pin=manifest, 말투 자산 식별자, launchd, rollback, profile, `ops:loop-install --apply`를 확인한다.
6. 11-14 07:00 controller 결정은 현재 runtime으로 확인만 한다. 05:30 안전창이 이미 닫혔으므로
   새 runtime은 위의 11-15 00:00~00:25 또는 01:00~01:25에 실제 idle을 확인한 뒤에만 배포한다.
7. 11-15 07:00 controller가 `PREPARE`를 확정하고 그날이 증명일이 아닐 때만 새 Persona 20명을
   create→seed→check→activate 한다. 수동 stage·READY·장부 보정은 하지 않는다.
   실행 수단은 무인 1회 job `com.soransoran.persona-d30-oneshot`(07:05 · 고정 날짜)이다 — `scripts/persona-d30-oneshot.mts`가
   그날 controller 행 `PREPARE · d20 · d30`·비증명일·origin/main=HEAD=pin=manifest·배포 잠금/실행 중 job 0·승인 digest `be47bb88…`와
   runtime 자산 식별자(따로)·기존 40 말투/상태·P44~P63 전원 미존재·관리자 1명을 모두 확인한 뒤에만 정본 `persona-cohort-run`을 부른다.
   하나라도 어긋나면 write 0. 켠 뒤에는 정본 `readPersonaCapacity` 한 번의 판독이 contract-valid 60·stage-active 60이고, active 행 60·새 cohort active 20·
   기존 40 행 지문 불변·정본 cohort check 0일 때만 PASS다. 판독 실패(null)·59·61을 포함해 그 밖이면 새 cohort만 pause한다. 설치·실행 결과는 관측 뒤에만 적는다.
8. 자연 운영으로 비용·댓글·Persona cadence를 관측하고 rolling 72h 비용이 실제 green인 첫 07:00 controller가 D30을 열게 한다.

~~11-14 07:00 이전에 Persona를 투입해 억지로 D30을 여는 것은 증명 전날 밤 cohort 변경이므로 하지 않는다.~~
🔴 **2026-11-16 창업자 결정으로 위 문장을 대체한다.** 정본(goal canon §6)이 고정하는 cohort는 TRIAL·REPROVE 기록 **이후**뿐이다.
1회 투입기는 그날 controller 결정 **전** 창(03:45~06:05 · 권위 = 전날 controller `PREPARE · d20 · d30` · 그날 행 없음)에서도
투입한다. 07:00 controller가 60/60을 보고 시험을 열 수 있게 하기 위해서다. 결정 뒤 창(07:05~07:19)은 두 번째 기회로 남는다.
공급 하루 승인 천장은 11-17부터 `$1.80`(날짜별 비용 계약)이다. 11-17 07:00 이 첫 현실 후보다 — 관측 전에는 PASS가 아니다.
현재 기준선과 새 코드 모델을 섞은 보수 추정상 11-16은 약 $0.045, 11-17은 약 $0.0415다. 창 전체가 새 코드인
**11-18 07:00**이 첫 현실 후보이며, 실제 rolling 72h 비용이 아직 red면 green이 되는 첫 07:00으로 자동 이월한다.

## 4. PASS/FAIL/UNKNOWN과 rollback

| 축 | PASS | FAIL | UNKNOWN | rollback |
|---|---|---|---|---|
| runtime | HEAD=pin=manifest=merge SHA, jobs green | SHA 불일치·job 오류 | 읽기 실패 | 직전 pin 복구 |
| Persona | contract-valid 60 · active 60 · 기존 40 배정 불변 | 일부 적재·충돌·cadence 위반 | DB/근거 판독 실패 | 새 runtime에서 cohort 전체 pause → active 0·기존 40 불변 확인 → 직전 runtime pin 복구 |
| 비용 | rolling 72h ≤ $0.040/result | 초과 | 장부 미정산·분모 0 | 지배 판정 경로 off/직전 SHA |
| 댓글 | block code 정상 · starvation 0 · 불변식 위반 0 | 첫 댓글/실회원/중복 회귀 | 표본 또는 provenance 부족 | followup switch off |
| D30 | controller `TRIAL d30` 뒤 자연 30/30 증명 | controller/preflight 또는 증명 FAIL | 증거 부족 | D20 공개 유지 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796 · #810 · #811 · #814 · #816 · #819 · #838 · #839 · #840 · #842.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D30-FIX | Persona +20 · 비용 지배 판정 · 댓글 starvation 수리 · 완료 상태 계약 | exact-head CI · runtime exact SHA · contract-valid/active 60 · rolling 비용 green · 자연 댓글 불변식 green | 수동 stage·READY·게시·댓글·장부 보정 · gate 완화 |
| D30 | D20 operating PASS 선행(11-12 ✅) · controller 자연 개방 | 자동 30/30 · 첫 댓글 30/30 · 비용·감사·provenance · 수동 표식 0 | 날짜로 강제 개방 · 증명 전·도중 runtime 변경 |
| D20 | D10 operating PASS 선행 · 인증 유지 | 평상일 0..20 자연 운영 | 매일 재증명 강제 |
| D50 | D30 operating PASS 선행 | Persona 100 · preflight green · 자동 50/50 | D30 생략 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·관리자/Persona/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. D30은 생략하지 않음이 단계 계약이다. 실패 축은 즉시 수리하지만
code·deployed·operating 증거를 서로 대신 쓰지 않는다.

### 5.1 병행 일정 — D 사다리와 파일을 분리

| 우선 | 트랙 | 공격 목표 | 완료 조건 |
|---:|---|---|---|
| 1 | D30 복구 | 11-15 00:00 1순위 runtime deploy · 11-15 07 후 Persona · 첫 현실 후보 11-18 07 D30 | 비용·Persona·댓글·exact-head 모두 green |
| 2 | OP51~90 직접작성 | D30 파일과 겹치지 않는 별도 worktree에서 즉시 rebase·code PASS | 출처·소유권·Dn 증거 제외 replay |
| 3 | 댓글 PR-2 | H1 운영 표본 뒤 hook·역할 권위 통합 | 실회원 무개입·중복 hook 0 |
| 4 | Persona 목소리 댓글(운영자 경로 · #829 대체) | D100 판독기 무변경 · 안전 기반 → 본 기능 순서 · 11-17 07:20 뒤 merge | D100 무영향 격리 DB 고정 · 운영자 이름 글 1건 실화면 |
| 5 | 고객 홈·실제 조회수 | 독립 owner로 병행 | 실제 행동만, Persona·admin·bot 제외 |
| 6 | M-GRAPH → M-AUTO | 제품 결과 아래 별도 owner | 기사 1개나 자동화 1개 PASS를 전체 완료로 선언하지 않음 |
| 7 | D50 | D30 operating PASS 뒤 Persona 100·비용·host 준비 | controller 자연 개방 |
| 8 | D100 | D50 operating PASS 뒤 180/300+·100편 부하·host 전환 | 제품·운영 전체 증거 |

30대 여성 Persona는 이번 +20이나 D50 하한에 섞지 않는다. 비율·브랜드 범위를 창업자가 정한 뒤 별도 canary로 관측한다.

## 6. 완료 보고 계약

- `npm run check:delivery-evidence`의 상태기계를 따른다. 이 검사는 주어진 증거 모양을 검증하지만
  Git·CI·host를 자동으로 읽지 않는다. 실제 SHA·CI·runtime·StageDecision은 live 명령으로 별도 대조한다.
- 테스트 green은 `CODE_PASS`, PR 병합은 `MERGED`, runtime exact SHA는 `DEPLOYED`, 자연 `StageDecision`과 운영 표본은
  `OPERATING_PASS`다.
- 창업자에게는 현재 단계, 증거 SHA/수치, 다음 담당자와 명령, rollback을 함께 보고한다.
- 답변·계획·일정표를 실행으로 세지 않는다.

## 7. 창업자 결정이 필요한 것

- 새 비용 상한, credential, DB migration, 법률·브랜드 정책, host 최종 cutover.
- 30대 Persona canary의 비율·브랜드 범위.

현재 승인된 가역 범위 안의 PR·merge·runtime 배포 순서는 Codex가 판정하고 Claude Code가 실행한다.
