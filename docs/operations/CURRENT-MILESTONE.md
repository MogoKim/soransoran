# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-29 01:20 KST
> 마지막 창업자 동기화: 2026-10-29
>
> 이 문서는 검증된 현재 상태와 다음 실행만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. code PASS, deployed PASS,
> operating PASS를 서로 대신 쓰지 않는다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**10월 28일 자연 D10은 자동 10/10, 첫 댓글 10/10, 추가 댓글 7건, 감사 2/2,
수동 물량 0, usageUnknown 0으로 PASS했다. 다음 D20을 막은 유일한 실측 축은
구 공급 처리량 15 < 필요 20이었다. 이번 변경은 workset을 20으로 올리고 당일 증명
5회와 $1.20 proof-first 예산을 연결해 같은 실측에서 처리량 22를 만든다.
코드·격리 DB는 PASS 후보지만 main 병합, 보조 Mac 배포, 자연 D20은 아직 미증명이다.**

## 1. 검증된 운영 기준선

| 항목 | 현재 사실 |
|---|---|
| 원격 main (2026-10-29 01:04 관측) | `257868788e100fcdcfd325e9c8d22dc0f8756971` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `257868788e100fcdcfd325e9c8d22dc0f8756971` · main과 동일 SHA · clean |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 owner |
| 회사 Mac D100 job | 0 |
| 최신 자연 controller | `TRIAL · 공개 d10 · 준비 d20` |
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
| D20 처리량 전환 | ✅ 후보 · targeted·격리 DB | **UNKNOWN** · 아직 미배포 | **UNKNOWN** · 자연 20/20 미관측 |
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
| `THROUGHPUT_SHORT` | 구 처리량 15 < 필요 20 | 이번 계약 배포 뒤 read-only 처리량 22 확인 |

원인은 품질 실패나 Persona 부족이 아니라, workset 10과 당일 공급 회차 계산이 D20 목표를
구조적으로 감당하지 못한 것이다.

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
| D20 전환 code | **PASS 후보** · targeted·격리 DB 통과 |
| D20 전환 deployed | **PENDING** |
| D20 preflight | 기존 main은 처리량만 FAIL · 새 코드 배포 뒤 read-only 재판정 필요 |
| D20 operating | **PENDING** · 자연 20/20 전에는 PASS 금지 |
| D30 이상 | D20 operating PASS 전에는 개방 금지 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #804 · #789 · #796.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D20-FIX | 처리량·예산·controller 배포 | code·runtime·controller 네 슬롯·read-only preflight PASS | 수동 증거 |
| D20 | 자연 D20 · D10 operating PASS 선행 | 자동 20/20·댓글·감사·비용 PASS | stage·READY·게시 보정 |
| D30 | 자연 D30 · D20 operating PASS 선행 | Persona 60·profile green·자동 30/30 | D30 생략 |
| D50 | 자연 D50 · D30 operating PASS 선행 | Persona 100·profile green·자동 50/50 | D20에서 바로 D50 |
| VIEWS | 실제 근거 조회수 | 원장·dedupe·내부/봇 제외·UI 표본 PASS | 댓글 배수·최소값·난수 |

공격적 목표일은 PASS 약속이 아니다. 실패 축만 보정하고 다음 유효 슬롯에서 다시 시험한다.
D30은 생략하지 않음이 단계 계약이다.

### 실행 순서

1. 현재 diff의 독립 재검토와 exact-head 검사를 끝낸다.
2. 최신 origin/main을 일반 merge하고 전체 관련 검사를 한 번 다시 돈다.
3. Draft PR exact-head CI와 D100 격리 DB 사슬을 한 번 실행한다.
4. PASS하면 Ready·merge 후 보조 Mac runtime을 main merge SHA로 배포한다.
5. `ops:loop-install -- --apply`를 이어서 실행하고 controller 네 슬롯을 확인한다.
6. 배포 뒤 controller dry-run으로 D10 증거 PASS와 D20 preflight 처리량 22를 읽기 전용 확인한다.
7. stage·READY·게시·댓글을 손으로 만들지 않고 자연 07:00 controller와 자연 D20을 관측한다.

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
