# 현재 실행 — D30 복구와 D100 병행

> as-of: 2026-11-14 05:41 KST
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
| 원격 main (2026-11-14 05:36 관측) | `1e728155de22e58c1c2048d10defcb8e23eedce4` |
| 원격 main 내용 | PR #842 병합까지 · D30 stage-active 하한·비용 진단·생동감 관측 도구 포함 |
| 보조 Mac D100 runtime HEAD = pin = manifest | `410d9a452228a6aa172a67833325be61980f87f1` · main 차이를 별도 판정: 복구 브랜치와 PR #842 이후 main은 아직 runtime에 배포하지 않음 |
| 보조 Mac D100 job | 9개 loaded · 2026-11-14 05:35 읽기 전용 관측 · 최근 종료코드 0 |
| 회사 Mac D100 job | 0 · D100 owner 아님 |
| 오늘 자연 결정 (2026-11-13) | `PREPARE · 공개 d20 · 준비 d30` · controller 행 1개 |
| 최신 단계 증거 | 11-12 d20 증거 PASS · 11-13 07:00 controller 확정 |
| D20 operating | **PASS** · 자동 20/20 · 첫 댓글 20/20 · 감사 표본 4/4 · 같은 runtime SHA |
| Persona 운영 DB (2026-11-14 05:35 관측) | contract-valid 40 · active 40 · D30 하한 60에 20 부족 |
| Persona 확장 자산 | P44~P63 20명 · 30대 0 · 기존 40명 말투 배정 불변 · 호스트 read-only 20/20 ready · 운영 DB write 0 |
| Persona 보충 근거 | 20 bundles · digest `cf3dbdac17476f12a8b8cfe0e4dda0e5d7e350cacbeb3a8e5634be59d833de2c` · dry-run write 0 |
| 비용 기준선 | 49개 slot-valid · $2.4056 · 약 **$0.04909/result** · D30 기준 $0.040 초과 |
| 비용 수리 | 유료 의미 검수 전에 지배 판정 · publish/safety/quality gate 완화 0 · 운영 효과 UNKNOWN |
| 추가 댓글 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 |
| 현재 댓글 정책 | 첫 댓글 1 + 선택적 0~9 · 총 구조 상한 10 · 글쓴이 답글 최대 3회 · automatic provenance |
| 댓글 기준선과 수리 | 11-12 글당 1.9 · 실패 254건의 두 Persona 집중 원인 확인 · typed block code·KST-day 격리·same-tick 재선정은 코드 검증, 운영 효과 UNKNOWN |
| 완료증거 하네스 | exact head·main·runtime pin·자연 운영창을 단계별로 강제 · self-test 6/6 |

### 1.1 이번 변경의 실제 검증

- Persona 계약 fixture: 131/131.
- Persona 자동 생성: 134/134, cohort seed 47/47.
- Persona 보충 근거: 37/37.
- 댓글 engine 전체: 1160/1160, H1 독립 fixture 61/61, mutation 14/14.
- 비용 지배 판정: generation-loss 77, mutation 27, supply e2e 154.
- 완료증거 하네스: 6/6.
- typecheck·lint: green.
- build·token 검사: green.
- 전체 문서 검사: 532 PASS · 0 FAIL.
- D30 stretch 계약: 54 PASS · mutation 17/17.
- exact-head 원격 CI: 아직 이 문서 시점에는 미완료.

위 검사는 **CODE_PASS 후보 증거**다. main 병합·runtime 배포·자연 운영 효과를 대신하지 않는다.

### 1.2 PASS 경계

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| D20 | ✅ | ✅ runtime `410d9a45` | ✅ 11-12 자연 증명 |
| 댓글 starvation 수리 | ✅ targeted·mutation | ❌ | UNKNOWN |
| 비용 지배 판정 | ✅ targeted·mutation | ❌ | UNKNOWN — rolling 72h 실측 필요 |
| Persona +20 | ✅ local·host read-only 20/20 | ❌ 운영 DB write 0 | UNKNOWN |
| 완료증거 하네스 | ✅ self-test 6/6 | 해당 없음 | 해당 없음 |

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
`AUTO_ADOPT`가 최선의 의미검수 결과를 받아도 불가능한 후보만 유료 의미검수 전에 멈춘다.

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

## 3. D30 개방의 정확한 blocker

| blocker code | 현재 | 해소 조건 |
|---|---|---|
| `PERSONA_SHORT` | contract-valid 40 · active 40 < 60 | 비증명일에 P44~P63 전체를 create→seed→check→activate하고 기존 40 배정 diff 0을 재검증 |
| `SUPPLY_COST_SHORT` | rolling 72h 기준 약 $0.04909/result > $0.040 | 지배 판정 코드 배포 뒤 같은 판정창의 자연 정산 실측이 $0.040 이하 |
| `COMMENT_STARVATION` | 11-12 실패 254건이 두 Persona에 집중 | typed 격리·same-tick 재선정 배포 뒤 자연 회차에서 starvation 0과 불변식 위반 0 |

### 3.1 배포 순서와 안전창

1. 전체 회귀검사와 독립 교차검수를 끝낸다.
2. exact-head CI가 모두 green인 한 PR만 main에 병합한다.
3. runtime은 22:15 마지막 자연 회차 뒤~05:30, 모든 runner idle인 안전창에 한 번만 배포한다.
4. 배포 직후 HEAD=pin=manifest, launchd, rollback, profile을 확인한다.
5. 11-14 07:00 controller 결정이 `PREPARE`임을 확인한 뒤, 그날이 증명일이 아닐 때만 새 Persona 20명을
   create→seed→check→activate 한다. 수동 stage·READY·장부 보정은 하지 않는다.
6. 자연 운영으로 비용·댓글·Persona cadence를 관측하고 다음 07:00 controller가 D30을 열게 한다.

🔴 11-14 07:00 이전에 Persona를 투입해 억지로 D30을 여는 것은 증명 전날 밤 cohort 변경이므로 하지 않는다.
가장 빠른 정직한 후보는 11-15 07:00이며, rolling 72h 비용이 아직 red면 green이 되는 첫 07:00으로 자동 이월한다.

## 4. PASS/FAIL/UNKNOWN과 rollback

| 축 | PASS | FAIL | UNKNOWN | rollback |
|---|---|---|---|---|
| runtime | HEAD=pin=manifest=merge SHA, jobs green | SHA 불일치·job 오류 | 읽기 실패 | 직전 pin 복구 |
| Persona | contract-valid 60 · active 60 · 기존 40 배정 불변 | 일부 적재·충돌·cadence 위반 | DB/근거 판독 실패 | 새 cohort 전체 pause |
| 비용 | rolling 72h ≤ $0.040/result | 초과 | 장부 미정산·분모 0 | 지배 판정 경로 off/직전 SHA |
| 댓글 | block code 정상 · starvation 0 · 불변식 위반 0 | 첫 댓글/실회원/중복 회귀 | 표본 또는 provenance 부족 | followup switch off |
| D30 | controller `TRIAL d30` 뒤 자연 30/30 증명 | controller/preflight 또는 증명 FAIL | 증거 부족 | D20 공개 유지 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796 · #810 · #811 · #814 · #816 · #819 · #838 · #839 · #840 · #842.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D30-FIX | Persona +20 · 비용 지배 판정 · 댓글 starvation 수리 · 완료증거 하네스 | exact-head CI · runtime exact SHA · contract-valid/active 60 · rolling 비용 green · 자연 댓글 불변식 green | 수동 stage·READY·게시·댓글·장부 보정 · gate 완화 |
| D30 | D20 operating PASS 선행(11-12 ✅) · controller 자연 개방 | 자동 30/30 · 첫 댓글 30/30 · 비용·감사·provenance · 수동 표식 0 | 날짜로 강제 개방 · 증명 전·도중 runtime 변경 |
| D20 | D10 operating PASS 선행 · 인증 유지 | 평상일 0..20 자연 운영 | 매일 재증명 강제 |
| D50 | D30 operating PASS 선행 | Persona 100 · preflight green · 자동 50/50 | D30 생략 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·관리자/Persona/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. D30은 생략하지 않음이 단계 계약이다. 실패 축은 즉시 수리하지만
code·deployed·operating 증거를 서로 대신 쓰지 않는다.

### 5.1 병행 일정 — D 사다리와 파일을 분리

| 우선 | 트랙 | 공격 목표 | 완료 조건 |
|---:|---|---|---|
| 1 | D30 복구 | 이번 안전창 code deploy · 11-14 낮 Persona · 가장 빠른 green 07:00 D30 | 비용·Persona·댓글·exact-head 모두 green |
| 2 | OP51~90 직접작성 | D30 파일과 겹치지 않는 별도 worktree에서 즉시 rebase·code PASS | 출처·소유권·Dn 증거 제외 replay |
| 3 | 댓글 PR-2 | H1 운영 표본 뒤 hook·역할 권위 통합 | 실회원 무개입·중복 hook 0 |
| 4 | #829 | D30 증거와 파일 분리 뒤 canary | 자동 Dn·기억·베스트 제외 |
| 5 | 고객 홈·실제 조회수 | 독립 owner로 병행 | 실제 행동만, Persona·admin·bot 제외 |
| 6 | M-GRAPH → M-AUTO | 제품 결과 아래 별도 owner | 기사 1개나 자동화 1개 PASS를 전체 완료로 선언하지 않음 |
| 7 | D50 | D30 operating PASS 뒤 Persona 100·비용·host 준비 | controller 자연 개방 |
| 8 | D100 | D50 operating PASS 뒤 180/300+·100편 부하·host 전환 | 제품·운영 전체 증거 |

30대 여성 Persona는 이번 +20이나 D50 하한에 섞지 않는다. 비율·브랜드 범위를 창업자가 정한 뒤 별도 canary로 관측한다.

## 6. 완료 보고 계약

- `npm run check:delivery-evidence`의 상태기계를 따른다.
- 테스트 green은 `CODE_PASS`, PR 병합은 `MERGED`, runtime exact SHA는 `DEPLOYED`, 자연 `StageDecision`과 운영 표본은
  `OPERATING_PASS`다.
- 창업자에게는 현재 단계, 증거 SHA/수치, 다음 담당자와 명령, rollback을 함께 보고한다.
- 답변·계획·일정표를 실행으로 세지 않는다.

## 7. 창업자 결정이 필요한 것

- 새 비용 상한, credential, DB migration, 법률·브랜드 정책, host 최종 cutover.
- 30대 Persona canary의 비율·브랜드 범위.

현재 승인된 가역 범위 안의 PR·merge·runtime 배포 순서는 Codex가 판정하고 Claude Code가 실행한다.
