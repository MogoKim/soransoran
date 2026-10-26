# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-26 15:31 KST
> 마지막 창업자 동기화: 2026-10-26 (`quality-v24`는 main·보조 Mac runtime에 반영됐다.
> 자연 회차에서 확인된 후단 생활 게이트 중복 권위는 `quality-v25` 후보로 수정 중이며 code/deployed/operating을 구분한다.)
>
> 이 문서는 **검증된 현재 상태와 다음 실행**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**`quality-v24` 배포와 공급 상한 `$1.20` 조정 뒤 자연 12:15·14:15 공급은 정상 종료했다. 하지만 Content Core가
ADOPT한 가족 건강 글 2건을 Queue의 옛 생활 검토가 다시 막았고, 자료 의존 글 1건은 정상 차단됐다.
현재 critical path는 중복 권위를 제거한 `quality-v25`의 exact-head 검증·배포와 다음 자연 회차 증명이다.
오늘 D10 operating PASS는 아직 아니며 수동 READY·게시·댓글·stage·운영 행 보정은 하지 않는다.**

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ main과 보조 Mac 동일 SHA | ✅ tracked 0 · D100 9개 loaded |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ 보조 Mac | ✅ `TRIAL · 공개 d10 · 준비 d20` |
| 자동 D3 | ✅ | ✅ | ✅ 10-14 d3 증거 PASS |
| 자동 D5 | ✅ | ✅ | ✅ 최근 자연 D5 증거 PASS |
| 자동 D10 | ✅ 10개 슬롯·Persona 30 | ✅ runtime | **UNKNOWN** - 10-26 현재 공개 1건, operating PASS 미달 |
| 자동 D20 | ✅ code universe 40·단계 사다리 | ⚠️ Persona 40·profile 미적용 | **UNKNOWN** - D10 operating PASS 선행 |
| 자동 D30·D50 | ✅ 단계 사다리 | ⚠️ profile 코드 | **UNKNOWN** - 앞 단계 PASS와 Persona 확장 필요 |
| 자동 D100 | ❌ 100 슬롯 runtime scheduler/profile 없음 | ❌ | **UNKNOWN** - Persona 180 canary·300+ 지속 용량 필요 |
| quality-v24 | ✅ | ✅ main·보조 Mac runtime | ❌ 후단 생활 검토가 ADOPT 2건을 다시 차단 |
| quality-v25 | ✅ 로컬 정적·계약·변이·격리 DB 검사 | ❌ PR·CI·runtime 전 | **UNKNOWN** - 자연 회차 미관측 |
| 기계 초안 자동 생명주기 | ✅ | ✅ runtime | ✅ routine 사람 검토 없이 자동 READY·품질 격리 |
| Persona 계약 | ✅ 기존 30·code universe 40 | ✅ 기존 30 | ✅ contract-valid 30 · active 30 |
| 첫 댓글 | ✅ 60분·automatic provenance·복구 | ✅ runner loaded | ✅ 운영 중 |
| 추가 댓글·답글 | ✅ 첫 댓글 1 + 선택적 0~4 · 실제 `parentId` 답글 · automatic provenance | ✅ 운영 공통 profile | ✅ 자연 followup 3건 확인 · 모든 글 5개 강제 아님 |
| 고객 조회수 | ✅ 실제 상세 열람+목록노출 원장 | ✅ Production | ✅ 실제 행동만 집계 · 가짜 숫자 0 |
| North Star | ❌ 7일 재방문+글/댓글 measure job 없음 | ❌ | **UNKNOWN** |

`code PASS`·`deployed PASS`·`operating PASS`는 서로 대체하지 않는다. 단계 PASS는 무인 운영 계약의
증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일 공개, 실회원 재방문, 자연스러운 대화와 실제
열람·노출은 별도로 관측한다.

## 2. 현재 운영 실측

### 2.1 git · runtime · 호스트

| 항목 | 값 |
|---|---|
| 원격 main (2026-10-26 15:31 관측) | `069881a8e5cd5b62697860f56a03fe1aaf95ca46` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `069881a8e5cd5b62697860f56a03fe1aaf95ca46` · main과 동일 SHA · tracked 0 |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 owner |
| 회사 Mac D100 job | 0 |
| 현재 controller | `TRIAL · 공개 d10 · 준비 d20` · 10-26 자연 D10 진행 중 |
| 품질 계약 | runtime·main `quality-v24` · 로컬 후보 `quality-v25` |
| 추가 댓글 설정 | switch ON · 운영 공통 profile · E6 consumer plist · 자연 followup 3건 확인 |
| event wake | 현재 runtime 설정 유지 · 이번 변경 범위 아님 |
| Persona | contract-valid 30 · active 30 · D10 용량 충족 |

15:31 KST 읽기 전용 상태에서 `quality-v24` 자연 12:15·14:15 공급은 정상 종료했다. 공급 상한은
승인 범위 안의 `$1.20`으로 반영됐다. 수동 공급·READY·발행·댓글·stage·운영 행 변경은 0이다.

### 2.2 최근 자연 증거

| 날짜·단계 | 판정 | 핵심 증거 |
|---|---|---|
| 10-25 d5 증거 | **PASS** | 자연 D5 완료 · 다음 controller가 D10을 자동 개방 |
| 10-26 d10 증거 | **UNKNOWN** | controller는 D10 개방 · 현재 공개 1건 · operating PASS 미선언 |
| 10-26 v24 자연 공급 | **부분 PASS** | 12:15·14:15 정상 종료 · Content Core ADOPT 3건 중 가족 건강 2건 후단 오차단, 자료 의존 1건 정상 차단 |
| 10-26 비용 상한 | **해소** | 승인 범위 안에서 공급 상한 `$1.20` 반영 |

최근 7일 원천→공개 시간은 p50 5.81h·p90 18.36h이고, 첫 댓글은 p50 13.86분·p90 34.76분이다.
남은 품질 병목은 생성 프롬프트 부족이 아니라 Content Core 뒤의 옛 생활 검토가 같은 품질을 다시 판정하는 구조다.
`quality-v25`는 차단 결론을 Content Core에서 끝내고, 확정할 수 없는 가족 건강 주체는 advisory로만 기록한다.

### 2.3 현재 통합 후보

| 후보 | 상태 | 채택된 목적 | 운영 반영 조건 |
|---|---|---|---|
| Content Core 단일 생활 게이트 권위 · quality-v25 | 로컬 code candidate · targeted·격리 DB PASS | Content Core ADOPT를 Queue가 재해석하지 않고 advisory만 기록 | exact-head CI → main → runtime 활성화 → 자연 회차 |
| D20 Persona 확장 | D10과 분리해 보존 | contract-valid 40과 자연스러운 합성 닉네임 | D10 operating PASS 뒤 충돌 gate·DB 생성·활성화 |

로컬 후보를 배포 또는 운영 PASS로 쓰지 않는다.

## 3. D10 개방의 정확한 blocker

| blocker | 현재 | 해소 조건 |
|---|---|---|
| `LATE_LIFE_REVIEW` | Content Core ADOPT 가족 건강 글 2건을 Queue가 다시 막음 | quality-v25 exact-head CI·runtime 배포 |
| `OPERATING_EVIDENCE_PENDING` | 10-26 현재 공개 1건 | 다음 유효 자연 회차의 자동 10/10·댓글·감사·비용·중복 증거 확정 |

현재 D10은 이미 자동 개방됐지만 위 항목 때문에 성공 선언은 아직 할 수 없다. 실패 축만 고치며, 수동 READY·stage·게시·댓글·
장부 보정으로 증거를 만들지 않는다.

## 4. 통합 workstream

| ID | 목적 | 현재 상태 | 다음 완료 조건 |
|---|---|---|---|
| STAGE | D10→D100 무인 확장 | 자연 D10 진행 중 | 각 단계 exact-N operating PASS |
| QUALITY | 재미와 사실 경계 | quality-v24 deployed · quality-v25 code candidate | v25 exact-head CI·runtime 전환·새 실제 결함 0 |
| LIFECYCLE | routine 사람 검토 제거 | operating | autoReadyPending/qualityQuarantine 지속 관측 |
| CONV | 글당 댓글 1..5 | 공통 profile operating | D10에서 비용·중복·대화가치 PASS |
| VIEW | 실제 활력 표시 | Production 원장 operating | dedupe·내부/봇 제외·UI 합산 지속 대조 |
| PERSONA | 단계별 계약 유효 화자 | 기존 30 operating · 신규 10 보존 | D20 40, D30 60, D50 100, D100 180 canary |
| NORTH | 실제 회원 성과 | 미구현 | 7일 재방문+글/댓글 고유 실사용자 측정 |
| DOCS | 1년 뒤 재현 가능한 권위 | quality-v25 후보와 함께 갱신 | main·runtime·정책·가드 일치 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #699 · #700 · #704 · #706 · #709 · #710 · #711 · #713 · #714 ·
#715 · #716 · #717 · #720 · #722 · #723 · #724 · #729 · #731 · #737 · #741 · #743 · #744 · #745 ·
#747 · #748 · #750 · #751 · #752 · #753 · #754 · #757 · #760 · #761 · #763 · #766 · #767 · #768 · #769 ·
#770 · #771 · #783 · #785 · #798 · #800.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D10-FIX | Content Core 단일 생활 게이트 권위 | v25 exact-head CI·runtime sync·자연 신규 행에서 오차단 0 | 기존 운영 행 수정·DB 직접 수정·수동 증거 |
| D10 | 다음 유효 자연 D10 증명 | 자동 10/10·첫 댓글 10·선택적 추가 0~4·감사·usageUnknown 0·중복 0 | 수동 stage·READY·게시 |
| P20 | Persona 40 활성화 | D10 PASS·이름/말투/카드/회원·크롤 작성자 충돌 0·contract-valid 40 | 이름만 만들고 용량으로 계산 |
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
- 모든 글에 댓글 5개 강제, 댓글 배수·최소값·난수로 조회수 만들기.
- 사후 모델 finding을 지우거나 Content Core의 의미 결정을 다시 판정하기.
- 실제 회원·크롤 작성자의 닉네임 복사·변형·로그 출력.
- 격리된 과거 초안을 routine 사람 검토나 무제한 자동 재작성으로 구제하기.
- D30 생략, 두 Mac의 D100 job 동시 소유, D100 scheduler 없이 D100 선언.
- 외부 간판 확장을 이유로 자동 운영 고객 범위를 즉시 30대로 확대하기.
- M-GRAPH·M-AUTO 작업을 D100 runtime 배포와 근거 없이 결합하기.

## 8. 다음 갱신 조건

1. quality-v25가 merge·runtime activate 된다.
2. 다음 자연 공급에서 Content Core ADOPT를 Queue가 다시 막지 않는다.
3. 자연 D10이 PASS/FAIL로 확정된다.
4. D20 Persona 40이 DB에 생성·활성화된다.
5. runtime HEAD·pin·manifest 또는 loaded job 수가 바뀐다.

## 9. fresh-first·board routing 운영 기준

- 자격 gate 뒤 공급 순위는 신선도 1순위다. source time ordering은 수집→생성→READY→발행 끝단까지 흐르고,
  숫자 article id를 source-time proxy로 쓰지 않는다.
- `boardTopic`은 중심 주제 하나로 FREE/MENOPAUSE를 정한다. current provenance 결여·invalid는 fail-closed이고,
  실제 legacy 판만 FREE 호환을 유지한다.
- 목표는 가급적 4시간, 보통 12시간, 최대 24시간 안에 원천을 공개로 연결하는 것이다. 48·72시간은 실패 시 관측
  구간이지 별도 quota나 복잡한 분기 정책이 아니다.
