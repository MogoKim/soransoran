# 현재 실행 - 자동 D100 커뮤니티

> as-of: 2026-10-16 20:53 KST
> 마지막 창업자 동기화: 2026-10-16 (D5→D10→D20→D30→D50→D100을 임의 대기 없이 진행하고,
> 댓글·조회수·Persona 확장·North Star·레거시 제거를 의존관계가 겹치지 않는 범위에서 병렬 준비한다)
>
> 이 문서는 **검증된 현재 상태와 통합 실행판**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**10-16 d5 증거 FAIL은 quality-v10 결함과 `usageUnknown`이 있는 과거 증거로 확정됐고 고쳐 쓰지 않는다.
quality-v11과 D5 제한 시험 보정은 배포됐으며, 17:15 자연 공급 뒤 10-17 07:00 예측은
`PREPARE · 공개 d3 · 준비 d5`에서 D5 `TRIAL` 진입 PASS다. 21:22에 read-only로 한 번 더 확인한 뒤
10-17 자연 D5를 증명한다. D10·D20은 아직 PASS가 아니다. 그 사이 조회수·확장 Persona·D30/D50 용량·
North Star·레거시 정리는 별도 소유권으로 설계부터 진행한다.**

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ 마지막 독립 확인 HEAD=pin=manifest | ✅ tracked 0 · D100 9개 loaded · 최신 main 차이를 별도 판정해야 함 |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority · 제한 trial envelope | ✅ 보조 Mac | ⚠️ 현재 `PREPARE · 공개 d3 · 준비 d5` · 10-17 D5 예측 PASS |
| 자동 D3 | ✅ 같은 루프와 3개 슬롯 | ✅ | ✅ 10-14 d3 증거 PASS |
| 자동 D5 | ✅ 5개 슬롯·비용 envelope·증거 unknown 승격 | ✅ | ❌ 10-16 d5 증거 FAIL · 10-17 fresh proof 필요 |
| 자동 D10 | ✅ 10개 슬롯·Persona 30·preflight | ✅ scheduler 지원 | UNKNOWN - D5 PASS 뒤 자연 D10 필요 |
| 자동 D20 | ✅ 20개 슬롯·code universe 40·비용 ceiling | ✅ 웹 코드 · runtime/DB 활성화 전 | UNKNOWN - D10 실측·Persona 40·profile 필요 |
| 자동 D30·D50 | ✅ runtime profile·단계 사다리 | ✅ 코드 포함 | UNKNOWN - Persona 60/100·앞 단계 PASS 필요 |
| 자동 D100 | ❌ runtime scheduler/profile 없음 | ❌ | ❌ Persona 180 canary·300+ 지속 용량 필요 |
| quality-v11 | ✅ 자녀 no-go 의미 변형 차단 | ✅ runtime | ✅ gate open · unresolved 0 |
| Persona 계약 | ✅ code universe 40 · 신규 10명 카드·말투 근거 | ✅ main 포함 | ✅ contract-valid 30 · active 30 · 신규 10명 DB 생성·활성화 전 |
| 첫 댓글 | ✅ 60분·automatic provenance·복구 | ✅ runner loaded | ✅ 발행 뒤 4분 표본 |
| 추가 댓글·답글 | ✅ 첫 댓글 1 + 선택적 0~4 · 실제 `parentId` 답글 | ✅ switch ON · D10 profile · E6 consumer plist | UNKNOWN - 현재 공개 d3라 stage mismatch로 추가 0이 정상 |
| 고객 조회수 | ✅ 실제 상세 열람+목록 노출 정책 | ❌ 목록 노출 원장 구현 전 | UNKNOWN |
| North Star | ❌ 실회원 7일 재방문+글/댓글 measure job 없음 | ❌ | UNKNOWN |
| 외부 간판·동의 판본 | ✅ 연령 없는 외부 간판 · 개인정보 동의 판본 정합 | ✅ Production | ✅ HTTP·검색/공유 표면 확인 · 자동 운영 고객 범위는 아직 확대하지 않음 |
| CI 효율 | ✅ domain 병렬·fail-closed scope | ✅ required check 유지 | ✅ 19m25s → 10m34s 표본 · 검사 삭제 0 |

`code PASS`·`deployed PASS`·`operating PASS`는 서로 대체하지 않는다.
단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. 같은 KST 운영일 공개,
실회원 재방문, 자연스러운 대화와 실제 열람·노출은 별도로 관측한다.

## 2. 현재 운영 실측

### 2.1 git · runtime · 호스트

| 항목 | 값 |
|---|---|
| 원격 main (2026-10-16 20:53 관측) | `75a889022103402ce28442ec42e996e3b5228112` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `697fcad2ec80d3465a3e28c8d125420762ceaa48` · 마지막 독립 확인 tracked 0 · main 차이를 별도 판정 |
| 보조 Mac D100 job | 9개 loaded · 유일한 D100 owner |
| 회사 Mac D100 job | 0 |
| 추가 댓글 설정 | `SORAN_PERSONA_COMMENT_FOLLOWUP=on` · D10 profile · E6 consumer 경유 |
| event wake | unset · OFF |
| Persona | contract-valid 30 · active 30 · code-ready 40 · 운영 작성자 OP01~OP30 |

실제 자연 실행은 보조 Mac만 소유한다. 회사 Mac의 21:22 예약은 read-only 예측이며 운영 owner가 아니다.

### 2.2 10-17 D5 예측

| 축 | 17:22 실측 | D5 기준 |
|---|---:|---:|
| quality-v11 원천 / READY | 24 / 4 (공개 3 · 예정 1 · 유실/unknown 0) | 처리량으로 환산 |
| 처리량 용량 | 10 | ≥5 |
| 기회 | 5 | ≥5 |
| 위험 반영 결과당 비용 | $0.0487 | 실측 입력 |
| 목표 5건 공급 투영 | $0.244 | ≤ 현재 $0.50 운영 cap |
| Persona / 첫 댓글 용량 | 30 / 5 | ≥24 / ≥5 |

21:22에 같은 정본 함수로 한 번 더 계산한다. PASS면 22:15는 수요 0이 정상이고, 부족하면 부족분만 공급한다.

### 2.3 이미 해소된 병목

- 비용 미상 1건 때문에 충분한 정산 표본 전체를 버리던 D5 진입 오류는 bounded envelope로 해소했다.
- 평상일 exact-N 증거를 사전 라벨만으로 버리던 오류를 해소했다.
- quality-v10 자녀 경험 모순은 quality-v11 no-go로 생성 전·게이트·감사에서 차단한다.
- 원천마다 Persona 2~3명만 보던 선분배를 전체 적격 풀에서 회차 중복을 제외하는 방식으로 바꿨다.
- CI 직렬 19분대 병목은 domain 병렬 실행으로 줄였다. required check와 검사 범위는 유지했다.

## 3. D5 개방의 정확한 blocker

| blocker | 현재 | 다음 판정 |
|---|---|---|
| `NO_CURRENT_BLOCKER` | 17:22 예측 PASS · 품질·비용·오류 신호 green | 21:22 read-only 재확인 |
| `PROOF_NOT_RUN` | 10-17 자연 D5는 아직 실행 전 | 자동 5/5·첫 댓글·감사·비용 미상 0·중복 0으로만 해소 |

21:22에 FAIL이면 D5를 포기하지 않는다. 실패 축 하나를 당일 확정하고, 데이터 조작 없이 필요한 코드·설정만
targeted 검사 → exact-head CI 1회 → 안전 배포 → 다음 유효 슬롯 순으로 보정한다.

## 4. 통합 workstream과 설계 산출물

| ID | 목적 | 지금 만들 설계·정책 | 구현/운영 완료 조건 | 소유권 경계 |
|---|---|---|---|---|
| STAGE | D5→D100 무인 확장 | 단계별 preflight·비용·감사·rollback 입력표 | 각 단계 exact-N operating PASS | D100 master 한 명 |
| CONV | 글당 댓글 1..5 | D20/D30/D50 profile 산식 · 첫 댓글 우선 · 실회원 우선 | D10에서 첫 추가 댓글·실제 답글·상한/비용 PASS | 댓글 runner·profile |
| VIEW | 실제 활력 표시 | 상세 열람/목록 노출 원장 · dedupe TTL · 제외 주체 · 개인정보 최소화 | UI 숫자=실제 두 원장의 합 · 봇/내부 0 | 웹·schema 전용 |
| PERSONA | 단계별 계약 유효 화자 | 크롤 닉네임 **분포** 기반 합성 작명 · 카드/말투/no-go · reserve→active | D20 40, D30 60, D50 100, D100 180 canary | Persona expansion 전용 |
| NORTH | 실제 회원 성과 | 7일 재방문+글/댓글 event·고유 사용자·Persona 제외 | read-only 주간 지표와 관리자 관측 | analytics 전용 |
| LEGAL | 외부 약속 정합 | 약관·방침·동의 판본·고객 범위 변경 절차 | 화면·기록 판본 일치 | 가입/동의 전용 |
| DEBT | 속도 저하 제거 | 오래된 PR/worktree/문서/중복 gate·불필요 full CI inventory | 삭제가 아니라 대체 근거를 남긴 정리 | 코드 owner 승인 뒤 |

### 4.1 조회수 설계 일정

1. **10-17 설계 확정**: 상세 open과 실제 목록 노출을 별도 원장으로 정의하고, 짧은 반복·관리자·Persona·자동화·검색봇을 제외한다.
2. **10-18 구현 목표**: schema/API/UI/격리 반례를 한 worktree에서 구현하고 targeted 검사 뒤 push 1회·exact-head CI 1회만 실행한다.
3. **10-19 Production 목표**: 실제 노출과 상세 열람 표본을 대조한다. 조회수는 홈·베스트 실회원 인기 점수에 넣지 않는다.

### 4.2 Persona 확장·작명 일정

1. **D20 신규 10명**: 실제 고객 크롤 닉네임의 문자열이 아니라 길이·리듬·작명 습관 분포를 참고해 합성한다.
2. 활성화 직전에 회원·기존 Persona·같은 cohort·수집 작성자 exact/근접 충돌을 다시 검사한다.
3. D10 PASS 뒤 40명 canary를 적용하고, D20 운영과 병렬로 지속 목표 60명을 contract-valid reserve로 준비한다.
4. D30용 60명, D50용 100명, D100용 180명은 앞 단계 운영 중 미리 준비한다. 기존 30명은 일괄 개명하지 않는다.

### 4.3 레거시·병목 제거 순서

| 순서 | 대상 | 처리 |
|---|---|---|
| L1 | 낡은 CURRENT 상태와 날짜 고정 문서 검사 | 이번 통합 실행판과 구조 검사로 교체 |
| L2 | 오래된 열린 PR 14개 | main 포함·대체·보존 가치·폐기 후보를 read-only 분류한 뒤 owner 승인으로 닫기 |
| L3 | 다수의 오래된 worktree | dirty/미push/운영 참조 여부를 먼저 분류하고 안전한 것만 제거 |
| L4 | main↔보조 runtime 차이 | D100 영향 diff를 판정해 필요한 runtime 변경만 한 번에 sync |
| L5 | D20 이후 profile 수작업 | D10/D20 실측을 입력으로 profile 후보·검사·승인 packet을 자동 생성 |
| L6 | D100 scheduler 미지원 | D30/D50 운영과 병렬로 100 슬롯·복구·댓글 창·lease 용량을 설계·구현 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: #699 · #700 · #704 · #706 · #709 · #710 · #711 · #713 · #714 ·
#715 · #716 · #717 · #720 · #722 · #723 · #724 · #729 · #731 · #737 · #741 · #743 · #744 · #745 · #747 · #748.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| D5-FIX | 10-16 21:22 최종 재확인 | 같은 정본 함수 PASS · 새 blocker 0 | 수동 READY·장부 보정 |
| D5 | 자연 D5 · 10-17 목표 | 자동 5/5·서로 다른 화자·첫 댓글 5·감사·usageUnknown 0·중복 0 | 수동 stage·발행 |
| D10 | 자연 D10 · 10-18 목표 · D5 operating PASS 뒤 자동 10/10 | 첫 댓글 10·선택적 추가 0~4·감사·비용·복구 PASS | 모든 글 5개 강제 |
| P20 | D20 Persona 40명 적용 | D10 PASS 뒤 dry-run·이름/말투/카드 충돌 0·contract-valid 40 | 이름만 만들고 용량으로 계산 |
| C20 | D20 댓글·공급 profile | D10 실측 단가·수율로 첫 댓글 우선 예산·run cap 산정 | 근거 없는 선증액 |
| D20 | 자연 D20 · 10-19 목표 · D10 operating PASS | Persona 40·preflight green·자동 20/20·댓글 1..5·감사·비용 PASS | 단계 건너뛰기 |
| D30 | 자연 D30 · 10-20 공격적 목표 | D20 PASS·Persona 60·profile green·자동 30/30 | D30 생략하지 않음 |
| D50 | 자연 D50 · 10-21 이후 공격적 목표 | D30 PASS·Persona 100·profile green·자동 50/50 | D20에서 바로 D50 |
| D100 | D50 운영 중 기반 완성 | scheduler/profile·Persona 180 canary·300+ 지속·자동 100/100 | 날짜만 선언 |
| VIEWS | 실제 근거 조회수 | 상세 열람·목록 노출 별도 원장·dedupe·내부/봇 제외·UI 합산 | 댓글 배수·최소값·난수 |
| NORTH | 실회원 North Star | 7일 안 재방문해 글/댓글을 남긴 고유 실사용자 · Persona/운영자 제외 | 자동 활동을 성과로 계산 |

공격적 목표일은 PASS 약속이 아니다. 그러나 실패를 이유로 임의 관측일을 추가하지 않는다. 실패 축만 당일 보정하고
다음 유효 슬롯에서 다시 시험한다. D30은 생략하지 않음이 단계 계약이다.

## 6. 날짜별 실행판

| 날짜 | 운영 증명 | 병렬 설계·구현 | 그날 종료 조건 |
|---|---|---|---|
| 10-16 | 21:22 D5 최종 예측 | 통합 실행판·Persona 이름 정책·레거시 inventory 설계 | blocker 0 또는 단일 원인 확정 |
| 10-17 | 자연 D5 | VIEW 설계/구현 시작 · Persona 40 activation packet · D30 60명 gap | D5 operating PASS 또는 실패 축 보정 착수 |
| 10-18 | 자연 D10 | VIEW exact-head CI · D20 profile · D30/D50 Persona 공급 설계 | 댓글 1..5 첫 operating 증거 |
| 10-19 | 자연 D20 목표 | VIEW Production 검증 · D30 60명 준비 · North Star 설계 | D20 PASS 또는 실패 축 즉시 보정 |
| 10-20 | 자연 D30 목표 | D50 100명·profile · D100 scheduler 설계 | D30 PASS |
| 10-21+ | 자연 D50 목표 | D100 180/300+ 공급·scheduler 구현 | D50 PASS 뒤 D100 preflight green |

## 7. 시간·토큰·CI 운영 규칙

- 한 문제를 여러 agent가 다시 조사하지 않는다. D100 master가 AS-IS와 증거 packet을 한 번 만들고 담당자에게 좁게 준다.
- 한 파일은 한 writer만 소유한다. 설계·구현·독립 검토를 분리하되 같은 worktree를 동시에 쓰지 않는다.
- 수정 중에는 관련 targeted 반례만 돌린다. 로컬 통과 뒤 의미 있는 커밋 하나, push 한 번, exact-head 전체 CI 한 번이 기본이다.
- 자연 회차 대기 시간에는 조회수·Persona reserve·D100 scheduler·North Star처럼 파일 소유권이 다른 선행 작업을 진행한다.
- 운영 read-only 관측은 정해진 판정 시각에 한 번 한다. 계속 polling하거나 같은 보고를 여러 세션에 시키지 않는다.
- 새 추상화·새 queue·새 예외 lane은 실제 중복이나 병목을 제거할 때만 만든다. 옛 경로를 남긴 채 새 경로를 겹치지 않는다.

## 8. 지금 하지 않는 것

- Dn 증거를 위한 수동 게시·댓글·stage·READY·장부 수정.
- 실제 회원 댓글에 대한 자동 답글 확대, 모든 글에 댓글 5개 강제.
- 댓글 배수·최소값·난수로 조회수 만들기.
- 실제 회원·크롤 작성자의 닉네임 복사·변형·로그 출력.
- D30 생략, 두 Mac의 D100 job 동시 소유, D100 scheduler 없이 D100 선언.
- 외부 간판 확장을 이유로 30대 Persona·자동 운영 고객 범위를 즉시 확대하기.
- M-GRAPH·M-AUTO 작업을 D100 runtime과 같은 배포로 임의 결합하기.

## 9. 다음 갱신 조건

1. 21:22 D5 예측 또는 10-17 D5 자연 증명이 끝난다.
2. D10 첫 추가 댓글·답글 operating 증거가 생긴다.
3. 조회수 schema/PR 또는 Production 표본이 생긴다.
4. Persona contract-valid 수·runtime HEAD·stage가 바뀐다.
5. 레거시 PR/worktree 분류가 끝나거나 D100 scheduler 구현이 시작된다.
