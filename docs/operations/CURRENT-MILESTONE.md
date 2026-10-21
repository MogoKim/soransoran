# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-21 10:30 KST
> 마지막 창업자 동기화: 2026-10-21 (quality-v14 자연 운영에서 Content Core가 허용한 bounded creativity를
> 발행 뒤 의미 감사가 옛 기준으로 다시 차단한 불일치를 quality-v15로 보정하되,
> 품질·자동 READY·Persona·댓글·조회수의 code/deployed/operating 상태를 섞지 않는다)
>
> 이 문서는 **검증된 현재 상태와 다음 실행**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**quality-v14는 main·보조 Mac runtime `7e5e1ae7`에 배포됐고, 10-21 08:15 자연 공급은 READY 4건을 적재해
공급 수율을 회복했다. 그러나 08:40 발행 뒤 의미 감사가 원문의 핵심을 바꾸지 않은 자연스러운 강조를
`sourceDistortions`로 확정해 gate를 닫았다. quality-v15 후보는 Content Core와 사후 감사의 품질 경계를 하나로
묶고, 옛 감사 기록을 수정하지 않은 채 같은 결속의 재감사 `no`만 append-only로 해소한다. 정확한 D10 재개는
exact-head CI·계약 전환·runtime 배포·다음 자연 회차 검증 뒤 판정한다. D20 Persona 10명은 D10 operating PASS 뒤 적용한다.**

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ 보조 Mac `HEAD=pin=manifest` | ✅ tracked 0 · D100 9개 loaded · main 차이는 D100 무관 M-GRAPH 1건 |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ 보조 Mac | ✅ `PREPARE · 공개 d5 · 준비 d10` |
| 자동 D3 | ✅ | ✅ | ✅ 10-14 d3 증거 PASS |
| 자동 D5 | ✅ | ✅ | ❌ 10-19 d5 증거 FAIL · 4/5 · 감사 결함 1 |
| 자동 D10 | ✅ 10개 슬롯·Persona 30 | ✅ v14 runtime | ❌ 10-21 07:00 미개방 · 이전 D5 증거 실패와 08:40 감사 결함 보정 중 |
| 자동 D20 | ✅ code universe 40·비용 ceiling | ⚠️ 웹 코드만 · Persona DB/profile 미적용 | UNKNOWN - D10 PASS·Persona 40·profile 필요 |
| 자동 D30·D50 | ✅ 단계 사다리 | ⚠️ profile 코드 | UNKNOWN - Persona 60/100·앞 단계 PASS 필요 |
| 자동 D100 | ❌ 100 슬롯 runtime scheduler/profile 없음 | ❌ | UNKNOWN - Persona 180 canary·300+ 지속 용량 필요 |
| quality-v14 | ✅ | ✅ runtime `7e5e1ae7` | ❌ 08:40 의미 감사 오탐 1 · gate closed |
| quality-v15 후보 | ✅ Content Core·사후 감사 단일 품질 경계 · append-only 재감사 해소 | ❌ 로컬 검증 완료 · exact-head CI 전 | UNKNOWN - 전환·runtime·자연 회차 전 |
| 기계 초안 자동 생명주기 | ✅ | ✅ runtime | ✅ routine 사람 검토 없이 자동 READY·품질 격리 |
| Persona 계약 | ✅ 기존 30·code universe 40 | ✅ 기존 30 | ✅ contract-valid 30 · active 30 |
| D20 Persona 이름 | ✅ PR #762 exact-head | ❌ Draft·DB row 0 | UNKNOWN - D10 PASS 뒤 활성화 gate 필요 |
| 첫 댓글 | ✅ 60분·automatic provenance·복구 | ✅ runner loaded | ✅ 10-18 자동 글 7편 모두 첫 댓글 |
| 추가 댓글·답글 | ✅ 첫 댓글 1 + 선택적 0~4 · 실제 `parentId` 답글 · automatic provenance | ✅ 운영 공통 profile | ✅ 10-19 followup 3건 · 2개 글 · 모든 글 5개 강제 아님 |
| 고객 조회수 | ✅ 실제 상세 열람+목록노출 원장 | ✅ Production | ✅ 누적 400 · 최근 24h 203 · 목록 359 · 상세 41 |
| 운영 작성자 | ✅ OP01~OP50 코드 | ✅ 운영 DB | ✅ 50/50 · Account 0 · Persona 0 · Dn 증거와 무관 |
| North Star | ❌ 7일 재방문+글/댓글 measure job 없음 | ❌ | UNKNOWN |
| CI 효율 | ✅ domain 병렬·fail-closed scope | ✅ required check 유지 | ✅ 약 10~12분 최근 표본 · 검사 삭제 0 |

`code PASS`·`deployed PASS`·`operating PASS`는 서로 대체하지 않는다. 단계 PASS는 무인 운영 계약의
증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일 공개, 실회원 재방문, 자연스러운 대화와 실제
열람·노출은 별도로 관측한다.

## 2. 현재 운영 실측

### 2.1 git · runtime · 호스트

| 항목 | 값 |
|---|---|
| 원격 main (2026-10-21 10:45 관측) | `7e5e1ae7ac65a6c372a2781ce6f1a7ae2b98a3ab` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `7e5e1ae7ac65a6c372a2781ce6f1a7ae2b98a3ab` · main 차이를 별도 판정: 0 · tracked 0 · quality-v15 배포 전 |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 owner |
| 회사 Mac D100 job | 0 |
| 현재 controller | `PREPARE · 공개 d5 · 준비 d10` · 10-21 07:00 D10 미개방 |
| 품질 계약 | quality-v14 deployed · 미해소 의미 감사 결함 1 · gate closed · quality-v15 보정 후보 |
| 추가 댓글 설정 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 |
| event wake | unset · OFF |
| Persona | contract-valid 30 · active 30 · code-ready 40 · 운영 작성자 OP01~OP50 적용 확인 |

보조 Mac 확인은 read-only SSH로 수행했다. 배포·재시작·DB write·수동 회차는 0이다.

### 2.2 최근 자연 증거

| 날짜·단계 | 판정 | 핵심 증거 |
|---|---|---|
| 10-17 d5 증거 | **PASS** | 자동 5/5 · 서로 다른 화자 5 · 첫 댓글 5 · 감사 1/1 · release stamp 5 · usageUnknown 0 |
| 10-18 d10 증거 | **FAIL `PUBLISH_NOT_AUTO_READY`** | 자동 7/10 · 서로 다른 화자 7 · 첫 댓글 7 · 감사 2/2 · release stamp 7 · usageUnknown 0 · followup 0 |
| 10-19 d5 증거 | **FAIL `PUBLISH_NOT_AUTO_READY` · `AUDIT_DEFECT`** | 자동 4/5 · 첫 댓글 4 · followup 3(2개 글) · 감사 1/1 결함 yes |
| 10-20 11:39 다음 d10 preflight | **FAIL(오판 재현)** | `OPPORTUNITY_SHORT` · `THROUGHPUT_SHORT` · `SUPPLY_COST_UNKNOWN` · 같은 날 06:15 공급을 전날 자정에서 잘라 READY 0 |
| 10-20 14:15 v13 자연 공급 | **완주 · 병목 재현** | 원천 9 · ADOPT 3 · HOLD 5 · READY/발행 1 · 호출 26 · $0.0891 · usageUnknown 0 · 추가/누락 경고만 있던 2건이 auto-READY 끝단에서 재차단 |
| 10-20 14:38 다음 d10 preflight | **FAIL(실측 병목)** | 기회 10 · Persona/댓글/품질 정상 · 처리량 7/10 · 투영 공급비 $0.891/$0.80 |
| 10-21 07:00 controller | **PREPARE d5** | 전날 D5 증거 4/5 · 감사 결함 · usageUnknown 때문에 D10 미개방 |
| 10-21 08:15 quality-v14 자연 공급 | **완주** | READY 4 적재 · 이월 3 · 누락 0 · 공급 수율 회복 |
| 10-21 08:40 발행 뒤 감사 | **결함 yes · gate closed** | 원문 핵심을 바꾸지 않은 자연스러운 강조를 `sourceDistortions`로 판정 · Content Core와 감사 기준 불일치 |

10-18 실패는 자동 READY 공급량 부족이었다. #760의 최신 원천 우선과 뒤이은 자동 품질 생명주기는 배포됐다.
10-19에는 성인 자녀 Persona가 2살 아이를 자기 자녀처럼 말한 v12 결함과 4/5가 확인됐다. 10-20 preflight의
READY 0은 공급 0이 아니라 시계 결함이다. 두 결함의 보정 이후 자연 D10 operating 증거는 아직 없다.

### 2.3 현재 열린 정책 PR·통합 후보

| PR | 상태 | 채택된 목적 | 운영 반영 조건 |
|---|---|---|---|
| #762 D20 Persona 이름 | Draft · CLEAN · exact-head CI PASS | P34~P43 합성 닉네임 다양화, 실제 닉네임 복제 금지 | D10 PASS → 충돌 gate → DB 생성·활성화 |
| quality-v15 보정 | 로컬 targeted·격리 DB PASS | Content Core와 사후 감사가 같은 bounded creativity를 쓰고, 옛 오탐은 재감사 no로만 append-only 해소 | exact-head CI → main → 전환 → runtime → 자연 회차 |

Draft와 로컬 후보를 운영 PASS로 쓰지 않는다. #762는 D10 operating PASS 전 활성화하지 않고, quality-v15는
exact-head 검증과 품질 계약 전환·오탐 재감사·runtime 동기화를 한 순서로 확인한다.

## 3. D10 개방의 정확한 blocker

| blocker | 현재 | 해소 조건 |
|---|---|---|
| `AUDIT_DEFECT` | 08:40 의미 감사 오탐 1 · gate closed | quality-v15 exact-head에서 같은 결속 재감사 no → append-only 해소 · 실제 결함이면 계속 BLOCK |
| `THROUGHPUT_SHORT` | 08:15 READY 4 적재로 개선 | 다음 preflight에서 READY capacity ≥ D10 필요량 확인 |
| `SUPPLY_COST_SHORT` | 수율 회복 뒤 재계산 필요 | 다음 preflight 투영 공급비 ≤ D10 profile 상한 확인 |
| `PUBLISH_NOT_AUTO_READY` | 전날 D5 4/5 | 다음 유효 자연 증명에서 exact-N 자동 발행 확인 |

실패 축은 코드·계약·runtime을 한 번에 맞춘 뒤 다음 유효 자연 D10에서 재시험한다. 수동 READY·stage·게시·댓글·
장부 보정으로 증거를 만들지 않는다.

## 4. 통합 workstream

| ID | 목적 | 현재 상태 | 다음 완료 조건 |
|---|---|---|---|
| STAGE | D10→D100 무인 확장 | d5 최근 증거 FAIL · d10 재시험 보정 | 각 단계 exact-N operating PASS |
| QUALITY | 재미와 사실 경계 | quality-v14 deployed · v15 후보 | transition·runtime·첫 자연 감사 PASS |
| LIFECYCLE | routine 사람 검토 제거 | operating | autoReadyPending/qualityQuarantine 지속 관측 |
| CONV | 글당 댓글 1..5 | 공통 profile operating · followup 3 | D10에서 비용·중복·대화가치 PASS |
| VIEW | 실제 활력 표시 | Production 원장 operating | dedupe·내부/봇 제외·UI 합산 지속 대조 |
| PERSONA | 단계별 계약 유효 화자 | 기존 30 operating · 신규 10 code-ready | D20 40, D30 60, D50 100, D100 180 canary |
| NORTH | 실제 회원 성과 | 미구현 | 7일 재방문+글/댓글 고유 실사용자 측정 |
| DOCS | 1년 뒤 재현 가능한 권위 | 10-20 정본 동기화 진행 | 상태표·정책·가드·runtime snapshot 한 변경으로 PASS |
| DEBT | 레거시·중복 제거 | 열린 legacy PR #708만 별도 보존 | owner·대체 근거 없는 worktree/경로 정리 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #699 · #700 · #704 · #706 · #709 · #710 · #711 · #713 · #714 ·
#715 · #716 · #717 · #720 · #722 · #723 · #724 · #729 · #731 · #737 · #741 · #743 · #744 · #745 ·
#747 · #748 · #750 · #751 · #752 · #753 · #754 · #757 · #760 · #761 · #763 · #766 · #767 · #768 · #769 · #770 · #771.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D10-FIX | quality-v15 감사 의미 정합·계약 전환·runtime sync | exact-head CI · 재감사 no일 때만 unresolved 0 · gate open · HEAD=pin=manifest | 기존 감사 행 변경·수동 READY |
| D10 | 다음 자연 D10 재시험 | 자동 10/10·첫 댓글 10·선택적 추가 0~4·감사·usageUnknown 0·중복 0 | 수동 stage·READY·게시 |
| P20 | #762 기반 Persona 40 활성화 | D10 PASS · 이름/말투/카드/회원·크롤 작성자 충돌 0 · contract-valid 40 | 이름만 만들고 용량으로 계산 |
| C20 | D20 댓글·공급 profile | D10 실측 단가·수율·추가 댓글 결과로 예산과 run cap 산정 | 근거 없는 선증액 |
| D20 | 자연 D20 · D10 operating PASS 뒤 | Persona 40·preflight green·자동 20/20·댓글 1..5·감사·비용 PASS | 단계 건너뛰기 |
| D30 | 자연 D30 · D20 operating PASS 뒤 | Persona 60·profile green·자동 30/30 | D30 생략 |
| D50 | 자연 D50 · D30 operating PASS 뒤 | Persona 100·profile green·자동 50/50 | D20에서 바로 D50 |
| D100 | D50 운영 중 기반 완성 | scheduler/profile·Persona 180 canary·300+ 지속·자동 100/100 | 날짜만 선언 |
| VIEWS | 실제 근거 조회수 | Production 원장·dedupe·내부/봇 제외·UI 합산 표본 PASS | 댓글 배수·최소값·난수 |
| NORTH | 실회원 North Star | 7일 안 재방문해 글/댓글을 남긴 고유 실사용자 · Persona/운영자 제외 | 자동 활동을 성과로 계산 |

공격적 목표일은 PASS 약속이 아니다. 그러나 실패를 이유로 임의 관측일을 추가하지 않는다. 실패 축만 보정하고
다음 유효 슬롯에서 다시 시험한다. D30은 생략하지 않음이 단계 계약이다.

## 6. 운영·문서 유지 규칙

- 한 문제를 여러 agent가 다시 조사하지 않는다. D100 master가 증거 packet 하나를 만들고 담당자에게 좁게 준다.
- 한 파일은 한 writer만 소유한다. 다른 worktree의 dirty 파일을 덮어쓰지 않는다.
- 수정 중에는 targeted 반례, 통합 직전 exact-head 전체 CI 한 번이 기본이다.
- 정책 변경은 D100 canon과 제거된 옛 경로를 함께 고친다.
- 운영 사실 변경은 이 문서의 as-of·main·runtime·stage·증거를 같은 날 갱신한다.
- Draft는 `code PASS`, 배포는 `deployed PASS`, 자연 증거는 `operating PASS`로만 기록한다.
- 보조 Mac 변경은 승인된 runtime deploy로만 하고, 회사 Mac에 D100 job을 올리지 않는다.

## 7. 지금 하지 않는 것

- Dn 증거를 위한 수동 게시·댓글·stage·READY·장부 수정.
- 실제 회원 댓글에 대한 자동 답글 확대, 모든 글에 댓글 5개 강제.
- 댓글 배수·최소값·난수로 조회수 만들기.
- 실제 회원·크롤 작성자의 닉네임 복사·변형·로그 출력.
- 격리된 과거 초안을 routine 사람 검토나 무제한 자동 재작성으로 구제하기.
- D30 생략, 두 Mac의 D100 job 동시 소유, D100 scheduler 없이 D100 선언.
- 외부 간판 확장을 이유로 자동 운영 고객 범위를 즉시 30대로 확대하기.
- M-GRAPH·M-AUTO 작업을 D100 runtime 배포와 근거 없이 결합하기.

## 8. 다음 갱신 조건

1. D10 복구 packet이 merge·deploy·transition 된다.
2. D10 preflight가 PASS/FAIL로 확정되거나 자연 D10 재시험이 끝난다.
3. #762 Persona 40이 DB에 생성·활성화된다.
4. 수집→생성 wake(C3)가 설계·구현되거나 명시적으로 보류된다.
5. runtime HEAD·pin·manifest 또는 loaded job 수가 바뀐다.

## 9. 2026-10-19 fresh-first·board routing 배포 기록

- 자격 gate 뒤 공급 순위를 신선도 1순위로 통일(compareReleaseRank 재정렬). retry/recovery/lane 분리는 관측 축으로만
  남고, source time 1순위 ordering(selectJitWorkset·prepareCandidates·compareAutoRow·pickPublishTarget·
  compareFreshFirst) 로 수집→생성→READY→발행 끝단까지 흐른다. 숫자 article id 를 source-time proxy 로 쓰지 않는다.
- `micro-seed-auto-judge` 에 `boardTopic` 필수 enum 추가(auto-judge-v4·semantic-shadow-v3). `gateResults.autoJudge.
  boardTopic` 한 칸을 publish tx 의 `routeBoardType` 이 읽어 FREE/MENOPAUSE 로 라우팅한다. current provenance 결여/
  invalid 는 publish 0(fail-closed), 실제 legacy인 `autoJudge` 부재/`auto-judge-v3`만 FREE 유지한다. `null`·모르는/
  미래 판은 publish 0이다.
- code/static 검증과 runtime 배포는 PASS다. 타입·lint·build·정적 계약·변이·격리 DB에서 source-time 단일 순위,
  lane/recovery 비개입, current boardTopic fail-closed, legacy v3 FREE 호환, 발행 전 write 0을 확인했다.
- 최신 원천 선택은 operating이지만, 10-20 최근 7일 원천→공개 p50 26.58h/p90 66.04h·같은 날 11.5%라
  end-to-end 목표(가급적 4h, 보통 12h, 최대 24h)는 아직 미달이다. 다음 병목은 수집→생성 wake(C3)다.
