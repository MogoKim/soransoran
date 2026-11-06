# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-11-06 20:19 KST
> 마지막 창업자 동기화: 2026-11-06 (D100 continuous-flow target 정책 승인)
>
> 이 문서는 검증된 현재 상태와 다음 실행만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. code PASS, deployed PASS,
> operating PASS를 서로 대신 쓰지 않는다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**11월 6일 자연 결정은 `PREPARE · 공개 d10 · 준비 d20`이고, 공급·발행·댓글·감사 건강은 ok, Persona는 40/40이다.
main은 #833 병합(§1 원격 main)이고 web Production은 그 SHA로 성공했지만, 보조 Mac D100 runtime은 아직 #832
`c6142e34`(#833 미포함)다. 옛 runtime의 11월 7일 준비 판정은 공급·READY 예측 코드와 preflight 결정일 결속 결함으로
막힌다. 이 결함들은 PR1b가 코드로 고친다 — runtime 설치 여부는 §1, code·deployed·operating PASS는 §1.2가 정본이다.
11월 3일 D20 operating FAIL(옛 하루 전체 비용 계약)은 소급 PASS로 바꾸지 않는다.**

## 1. 검증된 운영 기준선

| 항목 | 현재 사실 |
|---|---|
| 원격 main (2026-11-06 20:19 관측) | `903c14e07084fa854d1ddeca3f57b7cb1d960f08` |
| 원격 main 내용 | PR #833(정책 문서·원천 순위 정본·v6 reader) 병합 · `git ls-remote` read-only 관측 |
| web Production (2026-11-06 관측) | Vercel 배포 성공 · id 7598477580 · 위 main SHA |
| 보조 Mac D100 runtime HEAD = pin = manifest | `c6142e340adc2742a49647f72b7fd8616e4bb6a8` · 2026-11-06 20:19 관측 · tracked 변경 0 · main 차이를 별도 판정: PR #832까지이고 **#833(v6 reader)은 runtime 미배포** — 의도된 차이이며 #833 설치는 22:15 공급 종료 뒤 idle 창 |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 자연 운영 owner — 2026-11-04 13:20 관측값 · 11-06 재관측 안 함 |
| 회사 Mac D100 job | 0 |
| 오늘 자연 결정 (2026-11-06) | `PREPARE · 공개 d10 · 준비 d20` |
| 운영 건강 (2026-11-06 관측) | 공급·발행·댓글·감사 ok |
| 다음 날 준비 판정 (2026-11-06 관측 · 옛 runtime) | 11-07 D20 준비 판정 차단 — 공급·READY 예측 코드가 시험을 막고, preflight 결정일을 판정 시각에서 가져와 오늘 아침 회차를 다음 날 판정에 섞는다. 보정 코드는 PR1b, 설치 상태는 §1.2 |
| 최신 확정 단계 증거 | 10-28 d10 증거 PASS |
| 최신 시험 단계 증거 | 11-03 d20 증거 FAIL · 늦은 다음날 준비 공급 비용 1건 외 실질 축 충족 · 그 뒤 증거 행은 이 갱신에서 따로 읽지 않았다 |
| D20 operating | **FAIL (11-03)** · 콘텐츠·대화·감사 20/20은 충족, 옛 하루 전체 비용 계약이 늦은 준비 회차 미상 1건으로 차단 · D20 operating PASS 없음 |
| Persona (2026-11-06 관측) | contract-valid 40 · active 40 |
| 추가 댓글 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 (11-04 관측값) |
| 현재 댓글 정책 | 첫 댓글 1 + 선택적 0~9 · 총 구조 상한 10 · 일반 Persona 1회 · 글쓴이 답글 최대 3회 · 사슬 최대 6 · automatic provenance |
| 최대 10 변경 상태 | PR #827 code·CI·Production·runtime 배포 PASS(runtime `c6142e34`에 포함) · 첫 댓글 1, 일반 planner 기준 5/절대 하루 500, followup profile 40·$0.08·3·3 불변 · 구조 상한 10 operating 증거 대기 |
| 비용 보정의 운영 상태 | PR #826 bounded 비용 계약은 runtime `c6142e34`에 포함 · D20 자연 operating PASS 전 |

마지막 확정 D10 증거는 자동 공개 10/10, 서로 다른 자동 Persona 10, 첫 댓글 10/10,
감사 2/2, 공급 `usageUnknown=0`, 수동 stage·READY·게시·댓글·장부 보정 0이었다.

### 1.1 보조 Mac 실장부 재생 증거 (2026-11-04 05:38 KST · read-only)

- 공식 owner의 2026-11-03 공급 본문 terminal 193건: 정산 192 · `usageUnknown` 1.
- 193/193 모두 `scheduled`·현재 공급 계약·가격판·기록 예산 출처·자연 run token
  (`runTokenShadow.ok=true`)을 보존했다.
- 새 계약을 메모리에서 2026-11-05 날짜로 투영한 proof 5회 표본은 정산 178 · 미상 0 ·
  ineligible 0 · 위험액 `$0.63505675` / 기록 한도 `$1.20`이었다.
- 이 재생은 코드 경계와 기존 장부 모양의 호환 증거일 뿐, 11월 3일 FAIL을 소급 PASS로 바꾸거나
  11월 5일 자연 operating PASS를 대신하지 않는다.

### 1.2 PASS 경계

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| D10 기준선 | ✅ | ✅ | ✅ 10-28 d10 증거 PASS |
| D20 비용 판정 정합 보정 | ✅ PR #826 exact-head CI·공식 격리 DB PASS · main 병합 | ✅ 현재 runtime `c6142e34`에 포함 | ❌ 새 계약 D20 자연 증명 전 |
| Persona 40 | ✅ | ✅ | contract-valid 40 · active 40 (11-06 관측) · D20 자연 증명 전 |
| 첫 댓글·추가 댓글 | ✅ PR #827 · 첫 댓글 1과 provenance 불변 · 총 구조 상한 10 | ✅ Production·현재 runtime `c6142e34`에 포함 | 11-04 13:24 loop 정상·write 0 · 적격 대화의 최대 10 자연 검증 전 |
| 정책 문서·원천 순위 정본·v6 reader (#833) | ✅ exact-head CI · main 병합(§1 원격 main) | web Production ✅ (Vercel id 7598477580) · 보조 Mac runtime ❌ 미배포 | — 판정 경로 변화 없음(reader) |
| 예측 경고화·v6 writer·결정일 결속 (PR1b) | PR1b exact-head CI·공식 격리 DB로 판정 | 보조 Mac runtime 미설치 (§1 runtime 행) | ❌ 자연 관측 전 |
| 실제 조회수 | ✅ 실제 상세 열람·목록 노출 원장 | ✅ | ✅ 실제 행동만 집계 · 가짜 숫자 0 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일
공개, 자연스러운 대화, 실제 회원 재방문과 실제 열람은 별도로 관측한다.

### 1.3 승인된 target 정책과 구현 상태 (2026-11-06 창업자 승인)

이 절은 정책과 **코드**의 차이만 적는다. 무엇이 어디에 설치됐는지는 §1·§1.2가 정본이다. 가운데 칸은 옛 구현
(보조 Mac runtime `c6142e34`가 실행하는 코드)이고, 오른쪽 칸은 그 차이를 닫는 코드 변경이다. 이 차이를 정책 위반으로
고쳐 쓰거나 운영 증거로 보정하지 않는다.

| target 정책 (canon) | 옛 구현 | 코드 해소 |
|---|---|---|
| 공급·READY 예측은 경고·계획 입력 (§3.1·§3.2) | `judgeNextPreflight`가 `OPPORTUNITY_SHORT`·`OPPORTUNITY_UNKNOWN`·`THROUGHPUT_SHORT`·`THROUGHPUT_UNKNOWN`·`READY_REQUIREMENT_UNKNOWN`·`LATENCY_UNKNOWN`으로 시험을 막는다 | PR1b: 예측 5코드는 막지 않는 `forecastWarnings`, 지연 관측은 막지 않는 `warnings` |
| 평상일·증명일 같은 실행 경로, 공급 부족 제한 복구 없음 (§3.3) | `stage-active-recovery-v2` 경로(`src/lib/stage-active-recovery.ts`·`scripts/stage-active-recovery.mts`·controller 복구 단계)와 07:00~07:58 controller 다섯 시각. 회계 경계는 canon §11.1 📜 전환기 호환 | PR1b: 예측만 있는 판정은 PASS라 복구가 열리지 않는다(코드는 한 릴리스 rollback 호환) → rollback·의존성 감사 뒤 별도 삭제 |
| 공급 부족으로 `N` 미달인 증명일은 결함 아님 · 다음 운영일 재시험 (§6) | 재시험 계획(`trialPlanOf` RETEST)은 있으나 다음 날 예측 부족이 다시 시험을 막는다 | PR1b |
| `sourceAge` 오름차순 단일 정본 비교 (§2.3) | 생산 비교 함수가 여럿이었다 | #833: `compareReleaseRank` 하나 · 판정·생성 순서는 묶음 순위 |
| StageDecision v6 계약 | writer v5 · reader v5 + v4 legacy | 코드: reader v5+v6 (#833) · writer v6 (PR1b). runtime 설치 순서는 #833 reader 먼저·rollback 판독 확인 → 그 뒤 PR1b writer |
| preflight 결정일 결속 | recovery 신원 판정 날짜를 판정 시각 `now`에서 가져와, 다음 날 리허설이 오늘 아침 복구 회차를 claim 없는 복구로 읽는다 | PR1b: 증명 슬롯의 단일 KST 날짜(비면·섞이면·깨지면 fail-closed) |
| 자동 일정 owner launchd 하나 (§6) | 수동 `workflow_dispatch` 전용 `auto-publish.yml`·`supply-collect.yml`이 남아 있다 (예약 실행 없음 · 수동 실행은 commissioning) | rollback·의존성 감사 뒤 별도 삭제 |

## 2. 현재 runtime에 배포된 11월 2일·4일 근본 보정

| 경로 | 재현된 문제 | 보정 계약 |
|---|---|---|
| D20 preflight | 07:00 현재 snapshot만으로 하루 전체 기회를 요구하거나, 반대로 설정상 회차 수로 미래를 부풀릴 수 있음 | 직전 3개 완결일의 동일한 미래 proof 공급 슬롯에서 provenance가 완전한 자연 예약 요청의 실제 slot-valid 원천 기회 절대 하한만 사용 · 예약 follow-up은 자연 요청으로 인정하되 실제 시작+45분 뒤부터만 재료 가용 · 기준선은 판정 시각 직전에 창이 끝난 자연 proof 슬롯 하나(07:00이면 06:15)이며 전날 밤·event·수동·복구 회차로 대신하지 않음 · 끝난 `failed` 회차는 snapshot·marker·runId·시각·runtime SHA·provenance가 온전할 때만 사용하고 `running`·모름·손상은 `UNKNOWN` |
| stage brake | 일시 감속된 release가 다음 날 새 인증 기반처럼 남을 수 있음 | 최근 자연 PASS 기반의 계획을 최대 3일, 연속된 유효 결정 행으로만 복원 · 3일 밖은 결정 행의 `CERTIFIED` 칸으로 복원 — **이 릴리스는 reader 판(`READER_READY`)이라 읽기만 하고 쓰지 않는다** (§3-1) |
| 증명일 runner 건강 | 오늘 오류나 늦은 회차가 과거 증명일을 오염시키거나 event kickstart가 정기 실행처럼 보일 수 있음 | 그날 자연 예약 요청 5개·동일 runtime SHA만 판정 · 예약 겹침 follow-up은 scheduled marker 원시각으로 귀속 |
| supply wake/recovery | 실행시간 상한이 없는 비예약 공급이 controller·자연 증명 슬롯과 겹쳐 부분 상태·가짜 자연 회차를 만들 수 있음 | 공급 event wake와 공급 recovery kickstart를 전부 닫고, 하루 7회 자연 예약만 실행 · 증명에는 앞 5회만 사용 |
| 첫 댓글 시도 기억 | preview가 손상 파일을 격리해 read-only가 아니거나, 손상이 영구 차단이 될 수 있음 | preview write 0, 실제 실행만 만료 손상 격리 후 복구 |
| Persona 자산 | 같은 코드 SHA에서도 말투 corpus·manifest가 달라질 수 있음 | 배포 전·job 재기동 뒤·rollback에서 실제 자산 digest 재대조 |

비용 보정 PR 자체는 첫 댓글·추가 댓글의 품질 정책이나 글당 댓글 상한을 바꾸지 않는다. 최대 댓글 10은
별도 PR #827에서 검증한 뒤 main에서만 함께 배포했다. 두 변경의 구현 커밋·exact-head 검증은 분리했으며,
배포 SHA가 같다는 사실이 각 PR의 code PASS를 서로 대신하지 않는다.

## 3. D20 개방의 정확한 blocker

2026-11-06 기준 옛 runtime `c6142e34`의 11-07 준비 판정이다. 운영 DB·장부·stage 수동 보정으로 우회하지 않는다.

| blocker code | 현재 (옛 runtime) | 해소 |
|---|---|---|
| `OPPORTUNITY_SHORT` | 공급 기회 예측이 시험을 막는다 (예측 gate) | PR1b: 막지 않는 `forecastWarnings` → runtime 설치 후 readiness 재관측 |
| `THROUGHPUT_SHORT` | READY 처리량 예측이 시험을 막는다 (예측 gate) | 위와 같음 |
| `SUPPLY_COST_UNKNOWN` | preflight 결정일을 판정 시각에서 잡아 오늘 아침 회차를 다음 날 비용 신원에 섞는다 (결정일 오결속) | PR1b: 증명 슬롯의 단일 KST 날짜로 결속 → runtime 설치 후 readiness 재관측 |
| `OPERATING_PROOF_PENDING` | 자연 D20 operating PASS 없음 | 11-07 이후 자연 D20 증명 (20/20·댓글·감사·비용·provenance) |

📜 역사: 11-03 D20은 콘텐츠·대화·감사 20/20을 채웠지만 늦은 준비 회차 `usageUnknown` 1건을 하루 전체로 센 옛 비용 계약으로
FAIL이다. 새 코드로 다시 읽어 소급 PASS로 바꾸지 않는다.

### 3-1. `CERTIFIED` 두 단계 배포 — reader 먼저, writer는 별도 릴리스

- 이 릴리스의 단계는 코드 상수 `CERTIFIED_ROLLOUT_PHASE = 'READER_READY'`(`src/lib/stage-controller.ts`)다. env·문자열
  파싱으로 바꾸지 않는다. validator와 `sustainedReleaseOf`는 `CERTIFIED` 행을 읽고, controller의 모든 경로(감속·lease
  안전 HOLD·다리 HOLD·입력 실패 HOLD)는 그 칸을 쓰지 않는다(write 0). 검사가 둘 다 고정한다.
- 왜 나누는가: 옛 runtime의 validator는 `CERTIFIED`가 붙은 HOLD·PREPARE를 깨진 행으로 거절한다. writer를 같은 릴리스에서
  켜고 rollback하면, 옛 controller가 다음 날 전날 행을 `PREVIOUS_BROKEN`으로 읽고 결정을 멈춘다.
- **writer 활성 릴리스는 필수이며 별도다.** 순서: ① 이 reader 릴리스를 main·runtime에 배포 → ② 그 SHA가 rollback 대상이
  되어도 `CERTIFIED` 행을 읽는다는 사실(배포된 validator·HEAD=pin=manifest)을 확인 → ③ 다른 PR에서 상수만
  `WRITER_ACTIVE`로 바꾸고 S-CERT·replay ② 기대값을 writer 기준으로 갱신 → ④ 그 릴리스를 배포. ①·③을 한 배포로 합치지 않는다.
- reader 단계의 상태는 `READER_READY`이지 `WRITER_ACTIVE`가 아니다. 3일 이월 밖 감속은 계속 낮은 release가 남으므로
  `BRAKE_DEMOTION_PERSISTS`를 닫힌 것으로 보고하지 않는다.
- **`READER_READY`는 전체 종결이 아니다.** `BRAKE_DEMOTION_PERSISTS`는 reader 판에서도 `READER_READY`로 남는다 —
  해소·`GAP_CLOSED`로 세지 않는다. writer 활성 릴리스(`WRITER_ACTIVE`) 배포 전에는 전체 종결을 보고하지 않는다.

### 3-2. 신호를 보지 못한 HOLD · 다리 · 깨진 전날 행 · 신규 provenance 용량

- **신호 없는 HOLD의 보이는 공개는 d1이다 (다리·첫 시작).** 입력 실패 HOLD와 lease 안전 HOLD는 같은 순수 함수
  `signalBlindReleaseOf`(`src/lib/stage-controller.ts`)로 공개를 정한다. 인접한 전날 행(exact)이면 그 행이 보이던 공개를
  지키고, 전날 행이 없으면(bridge·first-run) consumer가 오늘 결정 전에 d1을 보므로 d1을 보이게 붙잡는다. 이틀 전 공개를
  오늘 신호를 보지 않고 되살리지 않는다. 숨은 인증 권한은 `WRITER_ACTIVE` 판에서만 행에 남고 `READER_READY`는 `CERTIFIED` 0이다.
  신호를 보는 정상 `bridgeHoldOf`는 이 규칙과 별개이며 바뀌지 않는다.
- **새 provenance tag는 완전한 자연 3일이 쌓여야 `futureSupplyCapacity`가 열린다.** 첫 증명 슬롯(06:15) 전에
  배포하면 가장 빠르게 D+3 07:00, 그 슬롯 뒤에 배포하면 D+4가 될 수 있다. 현재 재고만으로 이미 통과하는 경우가
  아니면 **다음 날 D20 승격을 약속하지 않는다.**
- **깨진 전날 행은 이틀 연속 fail-closed를 만들 수 있다.** 전날 행이 `PREVIOUS_BROKEN`이면 그날은 계산·저장 0으로 멈추고
  건너뛰지 않는다. 다음 날은 전날 행이 없는 날(다리)이 되거나 같은 깨짐을 다시 만난다. 조용히 넘기지 않는다 — 멈춤은
  알림으로 올라가야 하고, 해소는 운영자 격리(quarantine) 절차(깨진 행의 원인 확인 → 승인된 방법으로 격리 → 다음 예약 재판독)로만 한다.
  이 알림·격리 절차는 아직 코드로 닫히지 않았다(잔여 위험).

## 4. 배포 완료 조건과 자연 증명 경계

1. D100 reliability replay에서 다섯 gap이 `GAP_CLOSED`이고, `BRAKE_DEMOTION_PERSISTS`는 이 reader 릴리스에서
   `READER_READY`다(해소로 세지 않는다). writer 활성 릴리스의 완료 조건만 여섯 gap 모두 `GAP_CLOSED`다.
2. stage scheduler·evidence·ops loop·event wake·댓글 loop·runtime isolation 검사가 PASS다.
3. 변이 시험이 보호 단언을 실제로 깨뜨린다.
4. 공식 D100 격리 DB 사슬이 한 번 PASS다.
5. typecheck·typecheck:ops·lint·build가 PASS다.
6. Claude read-only 재검토와 Codex 독립 대조에서 새 blocker가 없다.
7. diff에는 이번 계약과 무관한 파일·운영 비밀·임시 산출물이 없다.
8. 창업자 승인 전 commit 이후의 merge·Production·runtime 배포·운영 DB write는 0이다.

배포 승인이 난 뒤에도 code PASS가 operating PASS를 대신하지 않는다. 승인된 main SHA는 유일한
D100 owner에 배포됐고 HEAD=pin=manifest, Persona 자산 식별자, 설치 plist, loaded job을 확인했다.
이제 다음 자연 증명 결과를 기다린다.

원칙상 배포는 당일 마지막 22:15 자연 공급 회차가 실제로 끝난 뒤부터 다음 날 05:30 전까지, 모든 D100
runner가 idle인 창에서만 한다. 11월 4일은 창업자의 명시적 당일 배포 승인으로 13시대 idle 창에 배포했으며,
그 대가로 06:15~22:15에 runtime SHA가 섞인 11월 4일 전체를 증명일에서 제외했다. 이후 배포는 다시 이 원칙을 따른다.

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796 · #810 · #811 · #814 · #816 · #819.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D20-FIX | **PR1b** · 공급·READY 예측을 경고로 · v6 writer · preflight 결정일 결속 | #833 runtime 설치·HEAD=pin=manifest·v6 reader 판독 확인 뒤 22:15 공급 종료~05:30 idle 창에 병합·배포 | 수동 stage·READY·장부 보정 · 실제 비용 상한 완화 · 11월 3일 소급 PASS |
| D20 | D10 operating PASS 선행 · 새 계약의 다음 자연 증명 | 자동 20/20·댓글·감사·비용·READY·provenance PASS | stage·READY·게시·댓글·장부 수동 보정 |
| D30 | D20 operating PASS 선행 | Persona 60·preflight green·자동 30/30 | D30 생략 |
| D50 | D30 operating PASS 선행 | Persona 100·preflight green·자동 50/50 | D20에서 바로 D50 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·내부/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. 실패 축을 근본에서 고치되, code·deployed·operating의
검증 순서를 생략하지 않는다. D30은 생략하지 않음이 단계 계약이다.

### D20 operating PASS 직후

1. D10·D20의 원문→선정→Persona→초안→READY→발행→댓글·답글 기준선을 읽기 전용으로 보존한다.
2. 기존 1~5와 새 최대 10 댓글의 좋은 예·나쁜 예·획일화 예와 원문 대비 글 품질을 A-to-Z로 감사한다.
3. 최대 10은 말투 개편과 분리한다. 첫 댓글 예산·운영 profile을 늘리지 않고, 맥락·중복·실회원 우선권을
   통과한 경우에만 한 회차 한 건씩 자연스럽게 이어지는지 bounded operating으로 확인한다.
4. PR #807 같은 비핵심 보류 작업은 D20 기준선과 파일 교집합을 확인한 뒤 별도 통합한다.
5. OP51~OP90 직접작성 계정과 고객 홈 PR-1은 D100 Persona·runtime과 섞지 않고 별도 PR·배포로 다룬다.

## 6. 금지

- 자연 증거를 위한 수동 controller apply, stage, READY, 게시, 댓글, 장부 수정.
- D20을 위해 85~90개 완성 글을 아침 전에 강제로 쌓는 것.
- 설정상 `남은 회차 × 20`을 실제 미래 기회로 간주하는 것.
- 오늘 오류를 과거 증명일에 소급하거나 수동·event 회차로 정기 proof 슬롯을 채우는 것.
- 최대 댓글 10, 닉네임 확장, 고객 홈 변경을 D20 비용 근본 복구 PR 한 커밋에 섞는 것. 최대 10은 별도 PR·별도 exact head로만 통합한다.
- 두 Mac에서 D100 job을 동시에 올리는 것.
- 전체 검증 전 일부 파일만 main이나 runtime에 배포하는 것.

### 새 run-token provenance 배포 유의사항

- 옛 ProcessRun의 trigger-only shadow는 자연 회차로 승격해 읽지 않는다. 배포 직후 과거 증명일과 미래 기회 3일 하한은
  새 형식의 자연 예약 요청 provenance가 채워질 때까지 `UNKNOWN`일 수 있다. 이는 회귀를 숨기는 호환 판독을 넣지 않은 fail-closed 결과다.
- 배포 승인은 이 워밍업을 감수하거나, 당일 snapshot 기회가 목표를 이미 채워 미래 하한이 필요 없는지 확인한 뒤 내린다.
  날짜 약속을 맞추기 위해 옛 event·복구 회차를 자연 표본으로 소급하지 않는다.
- 안전 창에서 05:30 전에 배포하면 새 형식의 완결일 3개가 쌓인 뒤 **가장 이른 D+3 07:00**에 미래 하한이 열린다.
  당일 첫 proof 회차 뒤에 배포해 그날이 불완전하면 **가장 이른 D+4 07:00**이다. 현재 snapshot만으로 목표를 채우면
  이 워밍업과 무관하게 판정할 수 있지만, 그 사실을 배포 전에 미리 보장하지 않는다.
- 🔴 **새 tag가 생기기 전에 배포하면 직전 TRIAL 증명과 이월 계획이 `UNKNOWN`이 될 수 있다.** 배포 전날의 proof 회차는 옛
  trigger-only marker라 자연 예약 요청으로 증명되지 않는다. 그래서 그날 runner 건강이 `unknown`이 되고, 그날이 TRIAL이면
  증거가 PASS가 아니어서 지속 단계는 시험 기반에 머문다. 같은 이유로 그 증명일을 되짚는 이월 계획(`carriedPlan`)도
  근거를 잃는다. TRIAL 날 밤 배포는 이 손실을 감수한다는 결정이다.
- 🔴 **첫 proof 슬롯(06:15) 뒤에 배포하면 그날은 runtime SHA가 섞여 증명일로 무효다.** 다섯 자연 proof 요청은 같은 runtime
  SHA여야 하므로, 06:15를 옛 코드가 돌고 08:15부터 새 코드가 돌면 그날 runner 건강은 `unknown`이다. 그 날짜가
  미래 기회 3일 표본에 들어가는 동안에는 옛 marker의 06:15 기준선 때문에 미래분도 `UNKNOWN`이다.
- 🔴 **안전 순서 — producer → reader → writer.** ① producer: 새 run-token tag와 opportunity marker를 쓰는 공급 러너를
  22:15 회차 종료 뒤~05:30 전 창에서 배포해 다음 날 06:15부터 새 tag가 쌓이게 한다. 같은 릴리스의 tag reader(증명일 runner
  건강·미래 기회·기준선)는 옛 marker를 `UNKNOWN`으로 닫는다(fail-closed · 호환 판독 없음). ② reader: `CERTIFIED`
  reader(§3-1)는 이 릴리스에 함께 있고 writer는 꺼져 있다. ③ writer: 새 tag 완결일과 reader 배포·rollback 호환을
  확인한 뒤 별도 릴리스로 켠다. 옛 marker를 자연 회차로 승격하거나 이 순서를 한 배포로 합치지 않는다.

## 7. 다음 문서 갱신 조건

1. 로컬 전체 검증과 독립 재검토 결과가 확정된다.
2. 승인된 merge SHA가 생긴다.
3. 보조 Mac runtime HEAD·pin·manifest·Persona 자산·job 설치 상태가 재관측된다.
4. 배포 뒤 read-only D20 preflight가 PASS·FAIL·UNKNOWN 중 하나로 확정된다.
5. 자연 D20이 20/20 PASS·FAIL·UNKNOWN으로 확정된다.
6. 댓글 상한·Persona 수·품질 계약이 별도 승인으로 실제 변경된다.
