# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-31 07:00 KST
> 마지막 창업자 동기화: 2026-10-31
>
> 이 문서는 검증된 현재 상태와 다음 실행만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. code PASS, deployed PASS,
> operating PASS를 서로 대신 쓰지 않는다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**10월 28일 자연 D10은 PASS했다. opportunities-v3는 main·runtime에 배포됐고 10월 31일 06:15
자연 공급도 성공했지만, 네이버 수집 첫 회차가 07:30 이후라 07:00 controller가 target-date 원천
기회 14/20만 보고 `PREPARE d10`으로 닫혔다. 기준·수율을 낮추지 않고 네이버 수집 6회를
00:30~05:30으로 옮겨 `수집 → 06:15 공급 → 07:00 판정` 순서를 맞춘다. 코드·runtime·설치와
다음 자연 06:15·07:00 증거 전에는 D20 복구를 PASS로 쓰지 않는다.**

## 1. 검증된 운영 기준선

| 항목 | 현재 사실 |
|---|---|
| 원격 main (2026-10-31 06:48 관측) | `2654e004c9aea457d9e34cd79f845a597304d768` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `2654e004c9aea457d9e34cd79f845a597304d768` · main과 동일 SHA · clean |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 owner |
| 회사 Mac D100 job | 0 |
| 최신 자연 controller | `PREPARE · 공개 d10 · 준비 d20` · 2026-10-31 07:00 저장 · 기회 14/20 |
| D10 증거일 | 2026-10-28 |
| D10 판정 | **PASS** |
| D10 자동 공개 | 10/10 · 서로 다른 자동 Persona 10 |
| D10 댓글 | 첫 댓글 10/10 · 추가 댓글 7 · provenance broken 0 |
| D10 감사 | 기대 2 · 표본 2 · 행 2 |
| D10 비용 | supplyUsageUnknown 0 |
| 수동 개입 | 승인·READY·게시·댓글·stage·장부 보정 0 |
| Persona | contract-valid 40 · active 40 |
| 현재 품질 계약 | runtime·main 동일 |
| 추가 댓글 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 |

증거 정본 요약:

`target=10 · published=10 · autoTargets=10 · humanApproved=0 · distinctAuthors=10 ·
commentCap=1 · firstCommentOk=10 · commentProvenanceBroken=0 · manualPersonaComments=0 ·
followupComments=7 · auditExpected=2 · auditSampled=2 · auditRows=2 ·
releaseStamped=10 · supplyUsageUnknown=0`

### 1.1 PASS 경계

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| 자동 D10 | ✅ | ✅ | ✅ 10-28 d10 증거 PASS |
| D20 처리량 전환 | ✅ exact-head CI·격리 DB | ✅ runtime·pin·manifest·controller 4슬롯·strict 격리 | **10/31 미개방** · target-date 입력 14/20 |
| Persona 40 | ✅ | ✅ | ✅ contract-valid 40 · active 40 |
| 첫 댓글·추가 댓글 | ✅ 첫 댓글 1 + 선택적 0~4 · 실제 `parentId` 답글 · automatic provenance | ✅ | ✅ 자연 followup 관측 |
| 실제 조회수 | ✅ 실제 상세 열람·목록 노출 원장 | ✅ | ✅ 실제 행동만 집계 · 가짜 숫자 0 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일
공개, 자연스러운 대화, 실제 회원 재방문과 실제 열람은 별도로 관측한다.

## 3. D20 개방의 정확한 blocker

10월 29일 07:00 기준 시각을 기존 main으로 read-only 재생했을 때 다음 단계는 d20이었고,
품질·Persona·비용·오류 축은 모두 통과했다. 실패 코드는 `THROUGHPUT_SHORT` 하나였다.

| 축 | 기존 main 실측 | D20 기준 | 판정 |
|---|---:|---:|---|
| READY raw | 21 | - | 관측 |
| 공개 / 예정 / 손실 / 모름 | 19 / 2 / 0 / 0 | - | 결말 확정 |
| 원천 | 95 | - | 관측 |
| 구 처리량 | 15 | 20 | **FAIL** |
| Persona | 40 | 40 | PASS |
| 결과당 위험 비용 | 약 $0.0503 | - | 관측 |
| D20 공급 위험액 | 약 $1.006 | $1.20 이하 | PASS |

| blocker code | 현재 | 해소 조건 |
|---|---|---|
| `THROUGHPUT_SHORT` | **해소** · 새 처리량 22 >= 필요 20 | 10월 29일 read-only preflight와 자연 controller 모두 PASS |

원인은 품질 실패나 Persona 부족이 아니라, workset 10과 당일 공급 회차 계산이 D20 목표를
구조적으로 감당하지 못한 것이었다. 새 계약 배포 뒤 `readyCapacity=22`, Persona 40/40,
첫 댓글 용량 258, 예상 공급비 약 $0.993/$1.20, blocker 0으로 D20 시험이 열렸다.

## 4. 이번 D20 전환 변경

| 변경 | 계약 |
|---|---|
| 회차당 원천 | 10 → 20 |
| 유료 상한 | judge 20 · draft 80 · total 100 |
| 당일 증명 공급 | 06:15 · 08:15 · 12:15 · 14:15 · 17:15, 총 5회 |
| 늦은 공급 | 21:15 · 22:15는 다음 날 재고만 기여 |
| proof-first | $1.20에서 앞 5회 몫을 먼저 보호 |
| 저예산 호환 | $1.20 미만은 기존 7회 동적 배분 유지 |
| 예상 처리량 | `floor(21 × 20 × 5 / 95) = 22` |
| controller | 07:00 · 07:20 · 07:40 · 07:55 |
| lease 충돌 | 07:55 이후 부분 Queue를 읽지 않고 지속 단계 안전 HOLD |

controller 시각 변경은 runtime 배포만으로 설치되지 않는다. deployed PASS는 반드시 다음을
모두 만족해야 한다.

1. 승인된 main SHA를 보조 Mac runtime에 배포한다.
2. `npm run ops:loop-install` 계획을 확인한다.
3. `npm run ops:loop-install -- --apply`로 설치한다.
4. 설치된 stage-controller plist의 네 시각과 loaded 경로를 확인한다.
5. runtime HEAD·pin·manifest 일치, clean, 격리 검사를 확인한다.

## 4.1 현재 PASS 경계

| 축 | 상태 |
|---|---|
| D10 operating | **PASS** |
| D20 전환 code | **PASS** · PR #810·#811 exact-head CI·격리 DB 통과 |
| D20 전환 deployed | **PASS** · runtime HEAD=pin=manifest · controller 07:00/07:20/07:40/07:55 · strict 격리 |
| D20 preflight | **10/31 FAIL** · opportunities-v3 정상 · target-date 원천 14/20 |
| D20 operating | **재시험 미개방** · 10/31 `PREPARE d10` · 수집 시계 보정 후 자연 증거 필요 |
| D30 이상 | D20 operating PASS 전에는 개방 금지 |

## 4.2 10월 30일 D20 재시험 결함과 복구 계약

| 구간 | 관측 사실 | 판정 |
|---|---:|---|
| 10월 29일 22:15 원천 | lifecycle 후보 80 | 원천 재료는 존재 |
| 10월 30일 06:15 v2 스냅샷 | 원천 inventory 29 기록 · 51 `SLOT_INELIGIBLE` | 현재 JIT release로 다음 D20 원천을 먼저 잘라냄 |
| 07:00 controller | 29개 원천에 측정 수율을 적용한 최종 기회 12/20 · `PREPARE d10` | D20 재시험 미개방 |
| 08:15 이후 read-only | inventory 55 · D20 dry-run PASS | 기회 자체가 아닌 판정 시각·계약 문제 |

복구 정본은 다음 하나다.

1. 현재 공급 선택은 자신의 부족 슬롯 release를 계속 쓴다.
2. 회차 종료 후 실제 큐·생성 후보·결론 상태를 다시 읽어 소비된 원천만 뺀다.
3. 선택됐어도 실제 소비되지 않은 재시도 가능 원천은 stage-neutral inventory에 남긴다.
4. preflight가 각 원천을 자신의 대상 Dn 슬롯에서 다시 판정한다.
5. 최신 live 공급 회차와 inventory를 runId로 묶고, 옛 판·미래 판·손상·누락 inventory는
   직전 회차로 내려가지 않고 fail-closed한다.

## 4.3 10월 31일 D20 재시험 결함과 복구 계약

| 구간 | 관측 사실 | 판정 |
|---|---:|---|
| 06:15 자연 공급 | 성공 · opportunities-v3 inventory 기록 | v3 배포·실행 정상 |
| 07:00 controller | 기회 14/20 · READY 용량 21 · Persona 40 · 비용·댓글·감사 정상 | `OPPORTUNITY_SHORT` 하나로 미개방 |
| 네이버 수집 시계 | 첫 회차가 레몬 07:30·우아한갱년기 09:30 | target-date 판정 뒤에 입력이 도착 |
| 수집 실행시간 실측 | 레몬 정상 최대 약 3분 51초 · 우아한갱년기 약 2분 56초 | 05:30→06:15 45분 buffer 충분 |

복구는 기준 완화가 아니라 순서 보정 하나다.

1. 레몬테라스 5회는 유지하되 00:30·02:30·05:30을 06:15 공급 전에 둔다.
2. 우아한갱년기는 5회·110/150 요청으로 늘리고 01:30·03:30·04:30을 공급 전에 둔다.
3. 두 수집원은 기존 전역 락을 공유한다. 새 잠금 정책을 추가하지 않는다.
4. 전날 밤 리허설은 `npm run d20:readiness:next-day -- --json`으로 날짜를 명시한다.
   이 시점에는 다음 날 00:30~05:30 자연 수집 전이라 `UNKNOWN`·`FAIL`이 정상일 수 있다. 리허설은
   날짜 오판과 이미 드러난 차단축을 찾는 도구이지, 자연 06:15·07:00 증명을 대체하지 않는다.
5. 수동 controller·stage·READY·게시·댓글·장부 보정은 계속 금지한다.

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D20-FIX | **진행 중** · target-date 수집 시계 정렬 | 00:30~05:30 수집·06:15 공급·07:00 판정 자연 증거 | 판정 기준·수율 완화 |
| D20 | **재시험 대기** · D10 operating PASS 선행 | 자동 20/20·댓글·감사·비용 PASS | stage·READY·게시 보정 |
| D30 | 자연 D30 · D20 operating PASS 선행 | Persona 60·profile green·자동 30/30 | D30 생략 |
| D50 | 자연 D50 · D30 operating PASS 선행 | Persona 100·profile green·자동 50/50 | D20에서 바로 D50 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·내부/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. 실패 축만 보정하고 다음 유효 슬롯에서 다시 시험한다.
D30은 생략하지 않음이 단계 계약이다.

### 실행 순서

1. 자연 D20의 20개 공개·서로 다른 자동 Persona·첫 댓글 20개·추가 댓글·감사 4건·비용을 관측한다.
2. 같은 날 evidence를 read-only로 판정해 PASS/FAIL/UNKNOWN을 확정한다.
3. PASS면 D30 preflight를 읽기 전용 확인하고 Persona 60·profile green을 준비한다.
4. 실패면 실패 축 하나만 보정하고 stage·READY·게시·댓글·장부를 손으로 만들지 않는다.
5. D20 operating PASS 전에는 D30을 열지 않는다.

## 6. 금지

- D20 증거를 위한 수동 controller apply, stage, READY, 게시, 댓글, 장부 수정.
- 처리량을 채우기 위한 오래된 원천 강제 선택이나 불필요한 글 생성.
- 실제 회원·원문 작성자 닉네임 복사 또는 변형.
- 모든 글에 댓글 수 강제, 가짜 조회수, 자동 활동을 North Star로 계산.
- D20 operating PASS 전에 D30·D50을 여는 것.
- runtime deploy만 하고 controller plist 설치를 생략하는 것.
- 두 Mac에 D100 job을 동시에 올리는 것.

## 7. 다음 문서 갱신 조건

1. PR merge SHA와 보조 Mac runtime HEAD·pin·manifest가 확정된다.
2. 설치된 controller 네 슬롯이 확인된다.
3. 배포 후 read-only D20 preflight가 PASS 또는 다른 blocker를 낸다.
4. 자연 D20이 20/20 PASS·FAIL·UNKNOWN으로 확정된다.
5. Persona·댓글·감사·비용 계약이 바뀐다.
