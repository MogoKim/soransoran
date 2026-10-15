# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-15 10:38 KST
> 마지막 창업자 동기화: 2026-10-15 (준비된 다음 단계는 임의 대기 없이 시험 · 10-16 D10/10-17 D20 목표 ·
> 첫 댓글 1 + 선택적 추가 댓글·답글 0~4 · 고객 조회수는 실제 열람·노출만 사용)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**보조 Mac runtime은 main `6f28fc3a`와 일치하고 quality-v9·신선도·전체 화자 풀·후속 댓글·D20 말투 근거
도구까지 배포됐다. 그러나 오늘 자연 controller는 `PREPARE · 공개 d3 · 준비 d5`이고 D5 preflight가
`OPPORTUNITY_SHORT`, `THROUGHPUT_UNKNOWN`, `SUPPLY_COST_UNKNOWN`으로 막혀 있다. 따라서 10월 16일 D10과
10월 17일 D20은 공격적 목표일이지 아직 PASS가 아니며, 오늘의 최우선은 기준 완화가 아니라 D5 입력을 복구해
자연 D5 증명을 여는 것이다.**

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ 보조 Mac HEAD = pin = manifest `6f28fc3a` | ✅ tracked 변경 0 · D100 9개 loaded |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority · D3→D5→D10→D20→D30→D50 | ✅ controller loaded | ⚠️ 10-15 `PREPARE · 공개 d3 · 준비 d5` · D5 preflight FAIL |
| 자동 D3 | ✅ 같은 루프와 3개 슬롯 | ✅ | ⚠️ 10-14 d3 증거 FAIL `DECISION_NOT_TRANSITION` · 일반 PREPARE일 3편은 증명일 PASS가 아님 |
| 자동 D5 | ✅ 5개 슬롯·증명 계약 | ✅ | ❌ 다음 시험이 preflight 3개 코드로 BLOCK |
| 자동 D10 | ✅ 10개 슬롯·Persona 하한·preflight | ✅ scheduler 지원 | UNKNOWN - D5 PASS 뒤 자연 D10 증명 필요 |
| 자동 D20 | ✅ 20개 슬롯·Persona 40명 canary 하한·preflight | ✅ scheduler·말투 근거 consumer | UNKNOWN - Persona 40·profile·비용·D10 PASS 필요 |
| 자동 D30·D50 | ✅ runtime profile·단계 사다리 | ✅ 코드 포함 | UNKNOWN - 앞 단계 operating PASS 필요 |
| 자동 D100 | ❌ 표현 단계만 있고 runtime scheduler/profile 없음 | ❌ | ❌ 180명 canary·300+ 지속 Persona와 실행 용량 미준비 |
| quality-v9 | ✅ 화자 계획 thinking low · 현재 계약 | ✅ runtime 반영 | ✅ v8 결함 해소 뒤 gate open · v9 사용 회차 정상 |
| quality-v10 후보 | 🟡 로컬 커밋 `44145bd1` · 원문 복제/재서술 보정 | ❌ PR·CI·병합 전 | UNKNOWN |
| 신선도 #709 | ✅ 게시 시각 구간·수집 selector·72h 판정 | ✅ | ✅ 날짜 구간 저장 · 배포 뒤 두 벌 본문 표본 0건 |
| 전체 화자 풀 #717 | ✅ 원천마다 전체 적격 풀 - 이미 선택된 화자 | ✅ | ✅ 10-14 17:15 `requiredValueUnmet` 0 · 중복 화자 0 |
| Persona 계약 | ✅ production universe 30 | ✅ runtime 30 인식 | ✅ contract-valid 30 · active 30 · draft 0 |
| 첫 댓글 | ✅ 60분 계약·automatic provenance·복구 | ✅ runner loaded | ✅ quality-v8 operating 표본 발행 뒤 4분 |
| 추가 댓글·답글 #704 + E6 | ✅ 첫 댓글 1 + 선택적 0~4 · 실제 `parentId` 답글 · 글당 합계 1..5 | ✅ switch ON · D10 profile · E6 consumer plist | UNKNOWN - 현재 공개 d3라 stage mismatch로 추가 0이 정상 |
| 실회원 우선 홈 #706 | ✅ Persona·운영 댓글을 인기 점수에서 제외 | ✅ Production | ✅ 화면 댓글 수는 유지하고 실반응 순서와 20/20 일치 |
| 운영 직접 작성 #714·#716 | ✅ OP01~OP30 · 사진·유튜브·굵게 | ✅ Production·DB 30명 | ✅ 수동 운영 가능 · Dn 증거에는 포함하지 않음 |
| D20 말투 근거 #722·#723 | ✅ 익명 근거 capture·consumer | ✅ runtime 반영 | ⚠️ 기존 30명은 유효 · 신규 10명용 근거 bundle 확정 #724 대기 |
| 고객 조회수 정책 | ✅ 실제 상세 열람 + 실제 목록 노출 · 내부 분리 · 중복/봇 제외가 정본 | ❌ 구현 전 | UNKNOWN - 임의 배수·최소값·난수 금지 |
| North Star | ❌ 재방문 이벤트·measure job 없음 | ❌ | UNKNOWN |

`code PASS`는 코드와 검사가 있다는 뜻이고, `deployed PASS`는 보조 Mac runtime 또는 Production에 있다는 뜻이며,
`operating PASS`는 실제 자연 회차 증거가 있다는 뜻이다. 셋을 합쳐서 완료라고 쓰지 않는다.

## 2. 현재 운영 실측

### 2.1 git · runtime · 호스트

| 항목 | 값 |
|---|---|
| 원격 main (2026-10-15 10:38 관측) | `6f28fc3ad475c8b26587a87bb70eca007248f7c5` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `6f28fc3ad475c8b26587a87bb70eca007248f7c5` · tracked 변경 0 |
| 보조 Mac D100 job | 9개 loaded · 10:33 관측 때 remonterrace 수집기 실행 중 |
| 회사 Mac D100 job | 0 |
| 추가 댓글 설정 | `SORAN_PERSONA_COMMENT_FOLLOWUP=on` · D10 profile · E6 consumer 경유 |
| event wake | `SORAN_EVENT_WAKE` unset · OFF |
| Persona | contract-valid 30 · active 30 · 운영 작성자 OP01~OP30 |

보조 Mac이 D100 9개 job의 유일한 owner다. main과 runtime은 같은 SHA이고, 실행 중인 자연 수집·공급·댓글 작업을
사람이 끊어 단계 증거를 만들지 않는다.

### 2.2 오늘 자동 단계

- 10-15 자연 controller: `PREPARE · 공개 d3 · 준비 d5` · brake `none` · 지속 d3.
- D5 preflight: `FAIL [OPPORTUNITY_SHORT, THROUGHPUT_UNKNOWN, SUPPLY_COST_UNKNOWN]`.
- 관측 입력: slot-valid opportunity 0, current-quality `workset-v4` cohort 없음/손상, 현재 정산된 결과당 공급 비용 0.
- quality·댓글 비용·오류 상태는 green이다. 지금 blocker는 글 품질 기준을 낮춰 해결할 문제가 아니라 다음 단계의
  **현재 계약 기준 공급 cohort와 비용 증거가 비어 있는 문제**다.
- 10-14 일반 d3 공개는 3편이었지만 controller가 연 TRIAL/REPROVE 증명일이 아니어서
  `DECISION_NOT_TRANSITION`이다. 물량은 나왔어도 단계 PASS로 세지 않는다.

### 2.3 최근 자연 운영에서 확인된 것

- quality-v8 operating PASS: 자동 READY 발행, 4분 안 첫 댓글 provenance, 감사 `defect=no`, 미해소 0, gate open.
- 10-14 17:15 공급: 전체 화자 풀로 `requiredValueUnmet` 0, 서로 다른 화자 선택, 중복 실행 0.
- #709 배포 뒤 수집 표본의 두 벌 본문은 0건이었고, 선택 원천은 72시간 안이었다.
- 후속 댓글 코드·env·profile·consumer는 설치됐지만 그날 결정이 d3라 D10 profile과 맞지 않았다. 따라서 추가 댓글
  0건은 실패가 아니라 안전한 기본 동작이다.
- 단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일 공개, 실회원 재방문,
  자연스러운 1..5개 대화, 실제 열람·노출은 별도로 관측한다.

## 3. D10의 정확한 blocker

D10을 10월 16일에 시험하려면 먼저 오늘 D5 증명일이 열리고 PASS해야 한다. 현재 직접 blocker는 다음 세 개다.

| blocker | 현재 | 해소 조건 |
|---|---|---|
| `OPPORTUNITY_SHORT` | D5에 필요한 slot-valid 원천 기회가 0으로 측정됨 | 10-15 자연 수집·공급 뒤 현재 계약 원천이 실제 5개 이상인지 재측정 |
| `THROUGHPUT_UNKNOWN` | current-quality `workset-v4` cohort가 없거나 손상돼 READY 수율을 계산할 수 없음 | quality-v9 자연 cohort를 정상 기록하고 동일 계약 기준 수율 계산 |
| `SUPPLY_COST_UNKNOWN` | 현재 cohort의 정산된 결과당 공급 비용이 0이라 비용을 모름으로 판정 | 실제 provider 장부의 정산 비용으로 결과당 비용 산출 · 추정값/수동 장부 금지 |

추가 수율 병목은 원문 복제 차단과 재서술 손실이다. quality-v10 후보는 이 축을 고치되 안전 gate를 완화하지 않아야
한다. 세 preflight 코드가 green이 되지 않으면 D5·D10을 강제로 열지 않는다.

## 4. 정본·구현·운영 충돌 장부

| ID | 현재 차이 | 영향 | 처리 원칙 |
|---|---|---|---|
| Q-10 | quality-v10은 로컬 커밋만 있고 main·runtime은 quality-v9 | 원문 복제 HOLD와 재서술 수율 병목 지속 | 독립 검증·PR·정식 계약 전환 뒤 배포 |
| S-05 | D5 코드·runtime은 있으나 current-quality opportunity·수율·비용 입력 부족 | D5 trial과 10-16 D10 목표 차단 | 자연 cohort 복구 · 기준 완화/수동 증거 금지 |
| C-10 | 추가 댓글은 배포됐지만 현재 d3, profile은 D10 | 지금은 글당 첫 댓글만 보임 | D10 trial에서 1 + 선택적 0~4 operating 판정 |
| P-20 | D20은 contract-valid Persona 40명이 필요하나 현재 30명 | D20 preflight `PERSONA_SHORT` 가능 | #724 확정 → 신규 10명 dry-run/충돌 0 · 승인된 apply → 40명 검증 |
| C-20 | D20 이상 추가 댓글 profile·예산이 미승인·미설치 | D20에서 후속 대화 용량 미정 | D10 비용·수율 실측으로 D20 profile 작성·승인 |
| S-100 | d100은 runtime 단계가 아니고 canary 180·지속 300+ Persona가 없음 | D100 실행 불가 | D30·D50 실측과 병렬로 scheduler/profile·Persona 공급 준비 |
| V-01 | 고객 조회수는 아직 기존 상세 조회 중심이고 실제 목록 노출 합산이 없음 | 새 글이 0·1로 보여 활력이 약함 | 실제 노출 계측·중복/주체 제외 후 단순 조회수로 합산 |
| M-01 | North Star 이벤트와 measure job 없음 | 사업 성과 측정 불가 | Dn 물량과 분리해 재방문·실회원 작성 측정 연결 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: PR #699 · PR #700 · PR #704 · PR #706 · PR #709 · PR #710 ·
PR #711 · PR #713 · PR #714 · PR #715 · PR #716 · PR #717 · PR #720 · PR #722 · PR #723.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| Q10 | quality-v10 후보 완결 | 로컬 검사 → Draft PR → exact-head CI → 계약 전환 preflight · 원문 복제 감소와 안전 불변 | quality-v9 운영 행 덮어쓰기 · gate 완화 |
| D5 | 오늘 current-quality 입력 복구와 자연 D5 증명 | 세 blocker green → controller가 연 D5 TRIAL/REPROVE → 자동 5/5·첫 댓글·감사·비용 PASS | 수동 stage·READY·장부·발행으로 증거 만들기 |
| D10 | 자연 D10 + 글당 Persona 댓글 1..5 - **10-16 목표** | 자동 10/10 · 서로 다른 Persona · 첫 댓글 10 · 선택적 추가 0~4 · 감사·비용·중복 PASS | 모든 글 5개 강제 · 실회원 댓글 자동 답글 |
| P20 | D20 Persona 40명 준비 | #724 append-only bundle green · 신규 10명 dry-run/충돌 0 · 승인된 apply · contract-valid 40 | 근거 없는 Persona 활성화 |
| C20 | D20 후속 댓글 profile 준비 | D10 실측 단가·수율로 첫 댓글 우선 예산과 추가 댓글 상한 검증 · kill switch·rollback 유지 | 비용 상한 선증액 · D10 근거 없는 숫자 |
| D20 | 자연 D20 - **10-17 목표** | D10 PASS + preflight green → 자동 20/20 · 댓글 1..5 · 감사·비용·중복 PASS | D10 실패 은폐 · 단계 건너뛰기 |
| SCALE | D30 → D50 → D100 | 각 단계 operating PASS 직후 다음 유효 슬롯 · d100 scheduler/profile · Persona 180 canary/300+ 지속 | D30 생략 · 가짜 조회수 · 수동 물량을 Dn으로 계산 |
| VIEWS | 실제 근거 조회수 | 상세 열람·목록 노출 별도 원장 · 짧은 반복 dedupe · 관리자/Persona/자동화/봇 제외 · UI는 조회수 하나 | 댓글 배수·최소값·난수 |

속도 원칙은 **안전한 선행조건을 미리 병렬 준비하고, green이면 임의 관측일 없이 다음 유효 슬롯에서 시험하는 것**이다.
단계를 건너뛰거나 실패 증거를 사람이 고치는 것은 공격적 운영이 아니라 다음 단계의 판단 근거를 없애는 일이다.

## 6. 목표 일정과 판정

| 날짜 | 공격적 목표 | 성립 조건 | 실패 시 행동 |
|---|---|---|---|
| 10-15 | D5 증명 · D20 준비 완료 | D5 preflight green · quality-v10/#724/D20 profile은 파일 소유권이 겹치지 않게 병렬 준비 | blocker 코드 하나만 고쳐 같은 날 다음 유효 슬롯 재판정 |
| 10-16 | D10 자연 증명 | D5 operating PASS · D10 preflight green | D10 기준은 유지하고 실패 원인만 즉시 보정·재시험 |
| 10-17 | D20 자연 증명 | D10 PASS · Persona 40 · D20 comment/supply/audit 비용 green | 앞 단계로 rollback해 원인 보정 |
| 이후 | D30 → D50 → D100 | 매 단계 operating PASS · 다음 단계 preflight green | 달력 대기는 두지 않되 D30은 생략하지 않음 |

이 날짜는 창업자의 목표일이다. controller 결정과 자연 증거가 조건을 만족하기 전에는 완료 약속이나 PASS로 쓰지 않는다.
D100은 d50 뒤 별도 runtime scheduler/profile과 Persona 180/300+ 용량이 필요하므로 지금 날짜를 확정하지 않는다.

## 7. 지금 하지 않는 것

- D5·D10·D20을 PASS로 만들기 위한 수동 게시·댓글·stage·READY·장부 수정.
- 댓글을 모든 글에 정확히 5개씩 채우거나 실회원 댓글에 canary가 자동 답글을 다는 것.
- 댓글 수의 배수·최소값·난수를 조회수로 표시하는 것.
- Persona·운영자 댓글이나 공개 조회수를 실회원 인기 신호로 바꾸는 것.
- D30을 생략하고 D50으로 가거나, scheduler/profile 없이 D100을 선언하는 것.
- 회사 Mac에서 D100 job을 되살려 두 host를 동시에 owner로 만드는 것.
- 운영 직접 작성 글·댓글을 자동 Dn 증거에 포함하는 것.

## 8. 다음 갱신 조건

이 문서는 다음 중 하나가 발생하면 같은 PR 또는 바로 다음 docs-only PR에서 갱신한다.

1. quality-v10·#724·D20 profile 중 하나가 병합·배포되거나 중단된다.
2. 자연 controller가 D5/D10/D20을 열거나 새 blocker를 기록한다.
3. D10 첫 추가 댓글 operating 증거 또는 실제 조회수 계측이 생긴다.
4. 보조 Mac runtime HEAD·pin·manifest가 바뀌거나 갈라진다.
5. Persona contract-valid 수나 D100 scheduler 지원 단계가 바뀐다.
