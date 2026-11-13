# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-11-13 11:11 KST
> 마지막 창업자 동기화: 2026-11-13 (D30 stretch · stage-active 하한 · 생동감 관측 · 비용 진단 분리 · 30대 별도 canary)
>
> 이 문서는 검증된 현재 상태와 다음 실행만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. code PASS, deployed PASS,
> operating PASS를 서로 대신 쓰지 않는다. 관측하지 않은 것을 PASS로 쓰지 않는다 — 모르면 UNKNOWN이다.
> 출처 표기: **관측**은 이 저장소에서 직접 읽은 값, **전달**은 Codex 가 상시 호스트에서 읽어 넘긴 값이다.

## 0. 창업자용 한 문장

**11월 12일 D20은 operating PASS다(자동 20/20 · 첫 댓글 20/20 · 감사 4/4 · 비용 envelope 안). 11월 13일 07:00 자연 결정은
`PREPARE · 공개 d20 · 준비 d30`이고, D30을 막는 것은 Persona(계약 유효 40 < 60)와 공급 결과당 비용 두 가지다.
11월 14일 D30은 조건부 stretch이며, 조건이 하나라도 빠지면 D20 평상 운영을 하고 11월 15일 07:00 판정으로 넘어간다.**

## 1. 검증된 운영 기준선

| 항목 | 현재 사실 |
|---|---|
| 원격 main (2026-11-13 11:11 관측) | `5a9d663ddca3af62bc05bd4e740ff357690ba985` |
| 원격 main 내용 | PR #841(매거진 S2) 병합까지 · `git ls-remote` read-only 관측 |
| 보조 Mac D100 runtime HEAD = pin = manifest | `410d9a452228a6aa172a67833325be61980f87f1` · 2026-11-13 07:00 전달 · main 차이를 별도 판정: #838(재시도 권위)·#839·#840(shadow·observer, 권위 0)까지이고 #841(매거진)은 D100 runtime 무관 |
| 보조 Mac D100 job | 9개 loaded — 2026-11-04 13:20 관측값 · 11-13 재관측 안 함 |
| 회사 Mac D100 job | 0 — 2026-11-12 23:50 이 작업 Mac `launchctl` 관측(소란소란 job 은 매거진 5개뿐) |
| 오늘 자연 결정 (2026-11-13) | `PREPARE · 공개 d20 · 준비 d30` · controller v6 · 행 1개 · 전달 |
| 최신 단계 증거 | 11-12 d20 증거 PASS · codes 0 · 전달 |
| D20 operating | **PASS (11-12)** · 자동 READY 20 · 사람 승인 0 · 서로 다른 Persona 20 · 첫 댓글 20/20(60분 · 자동 provenance) · 감사 4/4/4 · 공개면=DB 표본 4/4 · 자연 공급 5회 같은 SHA · 수동 표식 0 · 11-13 07:00 결정 사유에 기록 |
| Persona (2026-11-13 07:00 전달) | contract-valid 40 · active 40 (active 는 11-06 관측값 · 11-13 재관측 안 함) |
| 다음 단계 preflight (d30) | FAIL — `PERSONA_SHORT` 40<60 · `SUPPLY_COST_SHORT` 위험액 $1.46773296875 > $1.20 · 다른 막는 코드 0 · 전달 |
| 공급 결과당 비용 | 약 $0.0489244/slot-valid 결과(D30 통과에 필요한 값 ≤ $0.040) · 관측 정산 $2.34837275 중 READY 미생성(noReady) $1.6285675 · 장부 미정산·미상 문제 아님 · 전달 |
| 추가 댓글 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인(11-04 관측값) · 11-12 증명일 후속 18건(글당 0.9) · 전달 |
| 현재 댓글 정책 | 첫 댓글 1 + 선택적 0~9 · 총 구조 상한 10 · 일반 Persona 1회 · 글쓴이 답글 최대 3회 · 사슬 최대 6 · automatic provenance |
| 글당 댓글 | 11-12 실측 1.9(첫 20 + 후속 18 / 20) — 결과값이다. 평균 5는 quota 가 아니다(canon §5) |

### 1.1 PASS 경계

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| D20 비용 envelope·runner 건강 | ✅ | ✅ runtime `410d9a45` | ✅ 11-12 D20 자연 증명 |
| 재시도 권위 단일화 (#838) | ✅ | ✅ runtime `410d9a45` 포함(정확한 배포 시각 UNKNOWN) | UNKNOWN — 효과는 아래 비용 진단으로만 관측 |
| ops shadow plan·observer (#839·#840) | ✅ | ✅ 권위 0 | 관측만 · 운영 PASS 대상 아님 |
| D30 stage-active 하한 · 수동 Persona 증명 관문 · 비용 진단 · 생동감 하네스 (이번 변경) | 이번 PR exact-head 로 판정 | ❌ 미배포 — 배포 전 runtime 은 계약 유효 수만 본다 | ❌ |
| 실제 조회수 | ✅ 실제 상세 열람·목록 노출 원장 | ✅ | ✅ 실제 행동만 집계 · 가짜 숫자 0 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일
공개, 자연스러운 대화, 실제 회원 재방문과 실제 열람은 별도로 관측한다.

## 2. 이번 변경이 코드로 닫는 것 (2026-11-13 · 미배포)

| 정책 (canon) | 배포된 runtime 의 동작 | 이번 코드 |
|---|---|---|
| D30 이상은 stage-active 도 하한 (§4) | preflight 가 계약 유효 수(reserve 포함)만 본다 — reserve 만 늘리면 열린다 | `PERSONA_ACTIVE_SHORT`·`PERSONA_ACTIVE_UNKNOWN` · Persona 4상태 판정 한 번에서 두 칸(`readPersonaCapacity`) · D1~D20 판정 불변 |
| 자동 증명 글의 수동 Persona 댓글 = FAIL (§6) | 첫 댓글 증거에서만 빠지고 그날 증명은 통과할 수 있다 | `COMMENT_MANUAL_PERSONA` · 2026-11-14 KST 증거부터 · 그 전 날짜 재판정 불변 |
| 비용 창 진단 분리 (§3.4) | noReady 를 한 칸으로만 보고 | preflight `detail.costDiagnostics` — noReady 장부 단계 분해 · #838 병합 시각 뒤 회차 단가. 판정 입력 불변 |
| 생동감 관측 (§5) | 측정 도구 없음 | `npm run comment:vitality` (읽기 전용) |

🔴 **배포 전 공백:** 지금 runtime 은 stage-active 를 보지 않는다. 이번 변경이 배포되기 전에는 "reserve 와 active 를
같은 비증명일에 함께 올린다" 는 운영 절차로만 막힌다. 배포 여부와 시점은 Codex 결정이다.

## 3. D30 개방의 정확한 blocker

2026-11-13 07:00 controller 의 d30 preflight 다(전달). 운영 DB·장부·stage 수동 보정으로 우회하지 않는다.

| blocker code | 현재 | 해소 |
|---|---|---|
| `PERSONA_SHORT` | 계약 유효 40 < 60 | 기존 40명의 말투 배정 불변인 새 +20명(30대 제외)을 reserve 와 stage-active 로 **같은 비증명일에** 투입. 운영 DB create·seed·activate 는 창업자 승인 |
| `SUPPLY_COST_SHORT` | 위험액 $1.4677 > $1.20 · 결과당 약 $0.0489 | rolling 72h 창은 완화하지 않는다. #838 이전 회차가 창을 벗어나는 것을 기다리고, 진단으로 #838 뒤 단가를 본다. 그래도 $0.040 초과면 비용 구조 PR(초안 뒤 terminal 원인을 앞 단계로) |
| `PERSONA_ACTIVE_SHORT` (이번 변경 배포 뒤) | — | 위 Persona 해소에서 active 60 을 함께 맞춘다 |

- 비용 창의 자연 만료: 창은 판정 시각 직전 72h 다. #838 이 11-11 08:15 공급 회차 전에 배포됐으면 11-14 07:00 판정부터,
  그 뒤(11-11 오후)였으면 11-15 07:00 판정부터 창이 #838 뒤 회차로만 채워진다. **실제 배포 시각은 UNKNOWN** 이다.
  창이 깨끗해져도 단가가 $0.040 이하인지는 UNKNOWN 이다.

### 3-1. 11-14 07:00 D30 stretch — 조건과 fallback

stretch 는 아래가 **같은 11-14 07:00 판정에서** 전부 성립할 때만 controller 가 연다. 사람이 날짜로 열지 않는다.

1. 계약 유효 ≥ 60 **이고** stage-active ≥ 60(reserve 만으로 열지 않는다).
2. 비용 envelope green — 11-11 07:00~11-14 07:00 창의 결과당 단가 × 30 ≤ $1.20. 사람이 바꿀 수 있는 값이 아니다.
3. 새 cohort 가 기존 40명의 말투 배정을 바꾸지 않았다.
4. 🔴 **증명 전·도중 runtime 배포 금지.** 새 +20 의 카드·말투 자산이 이미 runtime `410d9a45` 에 있는지는 UNKNOWN 이다.
   없으면 11-14 를 열려면 증명 전날 밤 배포가 필요하므로 **stretch 는 불가능**하다.

fallback(어느 하나라도 빠지면): 11-14 은 D20 평상일이다. 11-14 07:00 판정에서 Persona 가 아직 60 미만이면 그날은 증명일이
될 수 없으므로 그 전날 밤 Persona 자산 배포는 "증명 전 배포" 가 아니다. 11-14 07:00 뒤 비증명일에 create·seed·activate 를
함께 하고, 하루 자연 관측 뒤 **11-15 07:00 판정**으로 넘어간다. D20 operating PASS 는 그대로 유지된다.

## 4. 배포 경계

1. runtime 배포는 당일 마지막 22:15 자연 공급 회차가 끝난 뒤부터 다음 날 05:30 전까지, 모든 D100 runner 가 idle 인 창에서만 한다.
2. 🔴 controller 가 `TRIAL` 을 기록할 수 있는 날의 전날 밤과 증명일 당일에는 runtime·Persona cohort 를 바꾸지 않는다.
   하룻밤 runtime 배포는 1건이다.
3. 배포 승인 뒤에도 code PASS 가 operating PASS 를 대신하지 않는다. HEAD=pin=manifest · Persona 자산 digest · 설치 plist ·
   loaded job 을 다시 확인한다.
4. 새 run-token provenance 처럼 자연 표본 워밍업이 필요한 변경은 producer → reader → writer 순서로 나눈다.

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796 · #810 · #811 · #814 · #816 · #819 · #838 · #839 · #840.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D30-FIX | Persona +20(30대 제외) · stage-active 하한 코드 배포 · 비용 진단 | 계약 유효 60 · stage-active 60 · 기존 말투 배정 변동 0 · 비용 envelope green | reserve 만 투입 · 비용 창 완화·회차 골라내기 · 상한 증액으로 대신하기 · 수동 stage·READY 보정 |
| D30 | D20 operating PASS 선행(11-12 ✅) · controller 가 연 자연 증명 | 자동 30/30·첫 댓글 30/30·감사·비용·provenance·수동 표식 0 | D30 생략 · 증명 전·도중 runtime 배포 |
| D20 | D10 operating PASS 선행 · 인증 유지 | 평상일 0..20 운영 · 지속 다양성 60 을 향한 관측 | 인증된 단계 매일 재증명 |
| D50 | D30 operating PASS 선행 | Persona 계약 유효·stage-active 100 · preflight green · 자동 50/50 | D20에서 바로 D50 · 30대 cohort 로 하한 채우기 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·내부/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. 실패 축을 근본에서 고치되, code·deployed·operating의
검증 순서를 생략하지 않는다. D30은 생략하지 않음이 단계 계약이다.

### 5-1. 병행 트랙 (D 사다리와 파일·운영 경계 분리)

| 트랙 | 목표일 | 경계 |
|---|---|---|
| OP51~90 직접작성 확장 | code PASS 11-14 → 낮 배포 11-16 → operating 판정 11-17 07:00 | 별도 owner·worktree(선행 변경은 origin/main 보다 54커밋 뒤의 미완성 3파일). 운영자 글·댓글은 단계 증거·READY cohort·자동 target 집계에 들어가지 않음을 replay 로 증명하기 전에는 증명일에 공개하지 않는다. 증거 집합에 운영자 글이 섞이는지는 UNKNOWN — 배포 전 필수 확인 |
| 30대 Persona 별도 canary | 설계 11-16~17 · 자산 11-18~19 · 활성 11-24 07:00 뒤 · 7일 관측 | 단계 하한 수에 넣지 않는다. 비율·브랜드 범위는 창업자 결정 |
| 댓글 PR-1(반복 실패·fallback) | 사유 분포 측정 → code PASS → D30 증거가 닫힌 밤 배포 | 첫 댓글 지연 회귀 0 · 중복 Persona 0 · 실회원 자동 답 0. 댓글 수를 채우지 않는다 |
| 최대 20 | 하지 않는다 | 상한 10 이 대화를 막는다는 여러 평상일 증거 · D50 · 예산·부하 · 창업자 승인 뒤에만 검토 |

### 5-2. 하네스 — 쓰는 법과 판정의 뜻

| 명령 | 무엇 | PASS · FAIL · UNKNOWN |
|---|---|---|
| `npm run check:d30-stretch` | 순수 fixture 검사 + 변이 시험(보호 장치를 지운 코드가 검사에 잡히는지) | 코드 계약 판정이다. 운영 PASS 가 아니다 |
| `npm run comment:vitality -- [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--json]` | 커뮤니티 게시판 공개 글의 24시간 고립률 · 실회원 참여 글 · 분포 · 8~10 비중 · 평균(결과값). DB 읽기만 | **PASS** = 불변식(같은 글 일반 Persona 중복 · 글쓴이 답글 3회 초과 · 구조 상한 10 초과) 위반 0이고 모두 읽음 — 대화가 충분하다는 뜻이 아니다. **FAIL** = 불변식 위반. **UNKNOWN** = 글 0 · 출처·시각을 못 읽은 글(비율 null). 열린 질문 응답률은 hook 권위 통합 전에는 재지 않는다 |
| controller preflight `detail.costDiagnostics` | noReady 의 장부 단계별 분해(재시도 = `…Retry` 단계) · 재시도 권위 단일화 병합 시각 뒤 회차 단가 | 진단 전용이다. 판정은 rolling 72h cohort 의 `costAttribution` 만 쓴다. 원천 종류·막은 gate 는 장부에 없어 `unknown`. 병합 시각은 배포 시각이 아니다 |
| preflight `PERSONA_ACTIVE_SHORT` · `PERSONA_ACTIVE_UNKNOWN` | D30·D50·D100 시험의 stage-active 하한 | SHORT = FAIL · UNKNOWN = 칸 없음·읽기 실패·계약 유효보다 큼 |
| 증거 `COMMENT_MANUAL_PERSONA` | 2026-11-14 KST 증거부터 자동 target 글의 수동 Persona 댓글 | FAIL. 수동 댓글은 지우지 않고 자동 증거에서 빠진다 |

## 6. 금지

- 자연 증거를 위한 수동 controller apply, stage, READY, 게시, 댓글, 장부 수정.
- reserve 만 늘려 D30 을 여는 것. 30대 cohort 로 단계 하한을 채우는 것.
- 비용 판정 창을 완화하거나 유리한 회차만 골라 판정하는 것. 상한 증액을 비용 blocker 의 해법으로 쓰는 것.
- 댓글 수를 평균 목표에 맞춰 채우는 것. 최대 20 구현.
- 오늘 오류를 과거 증명일에 소급하거나 수동·event 회차로 정기 proof 슬롯을 채우는 것.
- 증명 전날 밤·증명 도중 runtime·Persona cohort 변경. 두 Mac에서 D100 job을 동시에 올리는 것.
- 전체 검증 전 일부 파일만 main이나 runtime에 배포하는 것.

## 7. 다음 문서 갱신 조건

1. 이번 PR 의 exact-head 검증·독립 재검토 결과가 확정된다.
2. 승인된 merge SHA 와 runtime 배포(HEAD·pin·manifest·Persona 자산·job)가 재관측된다.
3. 11-14 07:00 결정이 `TRIAL d30` 또는 `PREPARE` 로 확정된다.
4. Persona +20 의 운영 DB 투입 결과(계약 유효·stage-active)가 관측된다.
5. 자연 D30 이 PASS·FAIL·UNKNOWN 으로 확정된다.
