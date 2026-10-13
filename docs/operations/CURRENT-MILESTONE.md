# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-11 16:12 KST
> 마지막 창업자 동기화: 2026-10-11 (Dn = 인증된 최대 용량 · 가까운 수요 · event-assisted · 원천 순위 하나 ·
> Persona 결정 분리 · 자동 댓글 provenance — 정책은 D100 canon §1.1·§2.3·§3·§4.1·§5)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**D5는 10월 10일까지 자동 5/5로 PASS를 이어 가고, 보조 Mac이 D100 9개 job의 유일한 owner다. D10은 Persona가
아니라 공개 d5 중 준비 d10을 생산하는 수요 지평이 만든 READY 손실(필요 17~20 > 능력 12)과, 끊긴 유료 요청의 미정산
비용 때문에 BLOCK이다. 2026-10-11 창업자 결정을 코드에 반영하는 첫 배치는 Batch A다.**

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ 보조 Mac HEAD = pin = manifest 한 SHA | ✅ tracked 변경 0 · D100 9개 loaded |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ controller loaded | ✅ 10-11 `REPROVE · 공개 d5 · 준비 d10` |
| 자동 D5 | ✅ 같은 루프와 5개 슬롯 | ✅ | ✅ 10-10 증거 PASS (자동 5/5 · 첫 댓글 5/5 · 감사 1/1 · 도장 5/5) |
| 자동 D10 | ✅ 10개 슬롯·Persona 하한·preflight | ✅ scheduler 지원 | ❌ preflight FAIL `THROUGHPUT_SHORT` · `SUPPLY_COST_UNKNOWN` |
| 평상시 `0..Dn` / 증명일 정확 N (canon §1.1) | ❌ main · 🟡 Batch A PR-head ✅(미병합 · 막힌 날 REPROVE 제거 · REPROVE = 증명 기반 없음 + 다음 단계 preflight PASS + 첫 슬롯 전의 현재 단계 재인증) | ❌ | ❌ 막힌 날마다 같은 단계 재증명 |
| 가까운 수요 지평 (canon §3) | ❌ main · 🟡 Batch A PR-head ✅(미병합 · 오늘 남은 release + 다음 첫 기회 · Persona 여력 같은 지평) | ❌ | ❌ 72h 자동 READY 30 중 공개 14 · 대기 26 중 24 낡음 |
| event-assisted 실행 (canon §3.3) | ❌ 고정 시간표만 · 예산이 벽시계 슬롯 창으로만 정기 실행 인정 | ❌ | ❌ 수집 → 공급 선택 p50 30.7h |
| 원천 순위 하나 (canon §2.3) | ❌ 연속 참여 백분위 우선 | ❌ | ❌ P0-B1 뒤 4회차 갱년기·우아한갱년기 선호 결정 0회 |
| 날짜 정밀도 (canon §2.1) | ❌ 날짜만 아는 시각을 00:00 으로 변환 | ❌ | ❌ 72h 수집분 약 29% 가 정확히 자정 |
| Persona 결정 분리 (canon §4.1) | ❌ 화자 계획 모델이 Persona 선택 | ❌ | ⚠️ 생성 89회 중 기술 실패 35 · Persona 사유 탈락 약 14 |
| Persona 계약 | ✅ production universe 30 | ✅ runtime 30 인식 | ✅ contract-valid 30 · active 30 · draft 0 |
| 첫 댓글 | ✅ 60분 계약 | ✅ runner loaded | ⚠️ 72h 자동 공개 14/14 60분 안 · 7일 누락 2 (08:10 슬롯) |
| 자동 댓글 provenance · 복구 (canon §5) | ❌ main · 🟡 Batch A PR-head ✅(미병합 · 세 행 provenance · slot recovery · 공통 커널 lease `lockf` — holder 종료·SIGKILL 시 자동 해제) | ❌ | ❌ 10-07 절전 중 회차 미실행 · 복구 없음 |
| 감사 | ✅ 자동 공개의 `ceil(N×20%)` | ✅ loaded | ⚠️ 7일 표본 7건 판정 · 결함 0 — 결함 탐지력은 UNKNOWN |
| 82cook | ✅ bounded canary 계약 | ❌ policy-disabled · job 0 | UNKNOWN — clean canary 0회 |
| 실회원 우선 홈 랭킹 | ❌ main · 🟡 Batch F PR-head ✅(미병합 · 홈 신호 = 글쓴이 제외 서로 다른 실회원 수 + 비회원 댓글 min(n, /best `GUEST_COMMENT_CAP` 3) · Persona·운영·Micro Seed 원문·삭제·모순 행 제외 · 화면 댓글 수 불변 · /best 정책 불변 · 게시판 정렬은 최신·조회순뿐) | ❌ | UNKNOWN — 운영 순서 replay(`npm run replay:home-popularity`, 쓰기 차단 증명 후 해시·집계만) 결과는 PR #706 |
| North Star | ❌ 재방문 이벤트 없음 | ❌ measure job 미등록 | UNKNOWN — 7일 Persona 글 32편에 실회원·게스트 댓글 0 |
| D100 scheduler | ❌ d3~d50만 지원 | ❌ | ❌ d100 runtime profile 없음 |

`code PASS`는 코드와 검사가 있다는 뜻이고, `deployed PASS`는 보조 Mac runtime에 있다는 뜻이며,
`operating PASS`는 실제 자연 회차 증거가 있다는 뜻이다. 셋을 합쳐서 “완료”라고 쓰지 않는다.

## 2. 현재 운영 실측

### 2.1 git · runtime · 호스트

| 항목 | 값 |
|---|---|
| 원격 main (2026-10-11 16:12 관측 당시 origin/main · 이 P0-0 PR 의 base — 병합 뒤 현재 main 이 아니다) | `48572809694ed3527aeca4e0b19067f71c8e9b36` |
| 보조 Mac D100 runtime HEAD = pin = manifest | `c50016da59cbb67ae6abfbc8f57b135192f21df0` · tracked 변경 0 |
| 보조 Mac D100 job | 9개 loaded · as-of 시점 D100 실행 프로세스 0 · 전원 AC |
| 회사 Mac D100 job | 0 |
| 회사 Mac 매거진 job | 5개 loaded (`magazine-auto-register` 마지막 종료 코드 1 — 매거진 owner 영역) |
| 회사 Mac 매거진 runtime | 원격 main 과 같은 SHA · tracked 변경 0 |

`main`과 D100 runtime이 다른 SHA라는 사실만으로 mixed runtime 결함이 아니다. 배포 정합성은 D100 runtime 안의
HEAD = pin = manifest 일치와 설치 경로다. main과의 차이는 매거진 변경이며 D100 파일 차이는 0이다.

### 2.2 자동 단계

- 10-11 07:00 자연 controller: `REPROVE · 공개 d5 · 준비 d10` (07:20 · 07:40 은 같은 결정을 읽기만 함).
- 10-10 d5 증거 PASS: `target=5 · published=5 · autoTargets=5 · distinctAuthors=5 · firstCommentOk=5 · audit=1/1 · releaseStamped=5`.
- d10 preflight: `FAIL [THROUGHPUT_SHORT, SUPPLY_COST_UNKNOWN]` —
  `readyRaw=30 · published=12 · lost=12 · scheduled=3 · unknown=3 · readyNeeded 17~20 · readyCapacity 12 ·
  opportunities 10 · personas 30/30 · firstComments 10`.

### 2.3 고정 72시간 루프 (10-08 00:00 ~ 10-11 00:00 KST)

```text
목록 4,585 → 상세 357 → 본문 346 → 고유 원천 328 (seed 51% · raw 34% · shortRaw 8% · hold 6%)
→ 공급 선택 139 → 원천 판정 SEED 89 → 생성 89회 → 채택 40 → 자동 READY 30 · 사람 검토 10
→ 공개 14 → 첫 댓글 60분 안 14/14
```

| 관측 | 값 | 판정 |
|---|---:|---|
| 원문 게시→수집 | p50 2.4h · p90 6.0h | 수집은 주병목이 아님 |
| 수집→공급 선택 | p50 30.7h · p90 46.7h | 🔴 가장 큰 현재성 병목 |
| 원문 게시→공개 | p50 49.1h · p90 61.2h | 🔴 “지금의 이야기” 목표 미달 |
| 같은 KST 운영일 공개 | 0% | 🔴 JIT 제품 결과 미달 |
| 생성 기술 실패 | 89회 중 35 (화자 계획 잘림 23 · 응답 없음 7 · 파싱 3 · usage 미상 2) | 🔴 수율·비용 손실 |
| 대기 READY | 26 중 24 가 지금 슬롯에서 이미 낡음 | 🔴 수요 지평 결함 |
| 공급 정산 | 3일 $0.92 · 공개 1건당 약 $0.066 | 미정산 9건 별도 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. D5가 PASS여도 위 현재성·재방문·랭킹
문제는 별도로 실패일 수 있다.

## 3. D10의 정확한 blocker

| blocker | 현재 | 해소 조건 |
|---|---|---|
| `THROUGHPUT_SHORT` | 필요 17~20 > 능력 12. 필요량은 손실 12에서 나온다 — 공개 d5 중 준비 d10 수요로 만든 READY가 나이 한도를 넘김 | Batch A 가까운 수요 지평 + Batch B 생성 기술 손실 제거 뒤, 기준 완화 없이 자연 cohort로 재판정 |
| `SUPPLY_COST_UNKNOWN` | cohort 미정산 9건 = 끊긴 화자 계획 요청 7 + 사용량 칸 이전 옛 줄 2 | 실제 근거로 정산하거나 3일 cohort 창 이탈. 추정액으로 정산하지 않는다 |
| 증명일 계약 | 평상시와 증명일이 분리되지 않아 매일이 재증명일 | Batch A 평상시 `0..Dn` / 증명일 정확 N |

## 4. 정본·구현·운영 충돌 장부

| ID | 확인된 충돌 | 영향 | 처리 원칙 |
|---|---|---|---|
| K-01 | canon §1.1 평상시 `0..Dn` 과 코드의 매일 정확한 목표(프로필 슬롯 합 · 증거 미달/초과 FAIL) | 매일 재증명 · 손실 교착 | Batch A |
| K-02 | canon §3 가까운 수요와 코드의 오늘 공개 + 준비 단계 내일 전체 · 7일 Persona 여력 | READY 낡음 · D10 필요량 증폭 | Batch A |
| K-03 | canon §3.3 event-assisted 와 코드의 고정 시간표 · 벽시계 정기 예산 | 수집 직후 공급 불가 | Batch C (lease 계약은 Batch A) |
| K-04 | canon §2.3 순위와 코드의 연속 백분위 우선 · 목록 글 번호 동률 | 신선도·선호 미작동 | Batch D (품질 경계 replay 후 창업자 승인) |
| K-05 | canon §2.1 날짜 정밀도와 코드의 00:00 변환 | 이른 만료 | Batch D |
| K-06 | canon §4.1 과 화자 계획 모델의 Persona 선택 · 장부 단계 라벨 혼동 | 유료 후 탈락 · 원인 불명확 | Batch B |
| C-01 | 수동 Persona 댓글도 `commentOrigin=PERSONA`면 자동 증거가 될 수 있음 | 거짓 댓글 증명 | Batch A — automatic provenance |
| C-02 | 댓글 runner는 recovery 대상 밖이고 stale lock 자동 회수가 없음 (근거: 10-07 08:10 글 — 호스트 절전 중 60분 안 댓글 회차 3회 미실행 · 복구 없음) | 첫 댓글 누락 | Batch A — bounded recovery |
| C-03 | Persona 댓글이 홈 인기 점수에 합산됨 | 합성 인기 | Batch F |
| M-01 | North Star 이벤트와 measure job 없음 | 사업 성과 측정 불가 | Batch F |
| T-01 | 직접 `supply:health`는 env 기본값으로 단계를 읽고 stage wrapper는 `StageDecision`을 읽음 | 운영자 오판 | 직접 명령도 `StageDecision`을 읽거나 wrapper 밖 실행을 거부 |
| T-03 | UnaEO 이름의 역사 import·connector 잔존 | 서비스 혼동 | active import 0 증명 뒤 분류 (Batch G) |
| S-01 | 82cook off·미측정 | D30부터 원천 부족 가능 | bounded canary 뒤 관측값으로만 확대 |
| S-02 | d100 scheduler/runtime profile 없음 | D100 코드상 실행 불가 | D20~D50 실측 뒤 동일 계약으로 구현 |

## 5. 다음 critical path

📜 완료되어 활성 목록에서 뺀 작업: PR #677 · PR #681 · PR #683 · PR #685 (P0-B1) · P0-A/B0 read-only 감사.

| 순서 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| P0-0 | 정본·현재 상태 동기화 — **이 PR 병합으로 완료** | NORTH-STAR · canon · CURRENT · README 가 같은 목적·Dn 의미·우선순위를 말하고 문서 CI 가 옛 계약 복귀를 막는다. 병합 뒤 첫 실행 작업은 Batch A 다 | 다른 agent 의 미커밋 문서 덮어쓰기 · 오래된 문서 branch 통째 병합 |
| A | 계약·수요·증거·복구 정직화 | 평상시 `0..Dn` / 증명일 정확 N · 가까운 수요 지평 · 댓글 증거·복구 정직화(automatic provenance · bounded recovery · stale lock) · 실행 lease 계약 · 자연 공급 2회 + controller 1회 관측 | D10 기준 완화 · 수동 증명 |
| B | 생성 손실과 Persona 결정 분리 | 기술 실패 원인 분리 · 제한 재시도 · 장부 단계 라벨 · 원천 요구 → 코드 Persona 결정 shadow 동등 이상 | 안전 gate 완화 |
| C | event-assisted 최소 루프 | 수집 완료 → 공급 · 공개 commit → 첫 댓글 · 시간표 fallback · 중복 0 · kill switch | 새 큐 · exactly-once 시스템 |
| D | 시간·순위·수집 효율 | 날짜 정밀도 보존 · 품질 경계 replay · 순위 하나 · 우아한갱년기 본문 실패 원인 코드 · 계정 단위 요청 장부 · raw 라벨 replay | quota · 임의 가중치 · 요청량 선증액 |
| E | 자연 D10 증명 | 증명일 자동 10 · 서로 다른 Persona 10 · release 도장 10 · 자동 provenance 첫 댓글 10 · 감사 · 비용 · 복구 | 수동 게시·댓글·장부·stage |
| F | 제품 품질과 D20 준비 | North Star 계측 · 홈·베스트 실회원 분리 · 사람 검토 사유 보정 · 닉네임 atomic rename · Persona 40 → 60 | D10 전 Persona 증원 · 실회원 계측 전 자동 답글 |
| G | 문서·하네스 경량화 후속 | on-demand runbook · 역사·외부 memory 격리 · UnaEO 흔적 분류 | 역사 증거 대량 삭제 |
| H | D20 → D30 → D50 → D100 | 같은 계약으로 단계별 자연 증명 · d100 profile | 단계 정책 분기 |

## 6. 창업자 결정이 필요한 것

| 결정 | 언제 | 현재 추천 |
|---|---|---|
| 품질 경계(실질 동급 품질 범위) | Batch D replay 뒤 | 기존 증거의 작은 등급 · 임의 가중치 금지 |
| raw 처리 | 사람 라벨 표본 뒤 | 오분류 보정 먼저 · 새 lane 은 마지막 |
| 실회원 댓글 1~2건 글의 Persona 첫 댓글 | North Star 계측 뒤 | 실회원 대화 우선 · 필요성 실측 |
| 닉네임 소급 표시 | rename dry-run 뒤 | 과거 글도 현재 이름으로 통일하되 감사 이력 보존 |
| 요청·예산 확대 | Batch A~D 운영 관측 뒤 | 결과당 비용과 계정 위험 기준 단계 확대 |

지금 즉시 창업자가 새로 정할 항목은 없다.

## 7. 지금 하지 않는 것

- D10을 PASS로 만들기 위한 수동 발행·댓글·stage 변경 · D10 기준 완화.
- D10 통과를 위한 Persona 증원 · 요청량·예산 선증액.
- 미정산 예약액을 실제 비용으로 간주하거나 장부를 임의로 정산 처리.
- 사람 검토 대기 글을 이유 구분 없이 전부 공개하기.
- 갱년기·우아한갱년기 quota · 예약석 · 큰 가산점.
- raw 자동 소비 복구 · 새 콘텐츠 레인.
- 회사 Mac에서 D100 job을 되살려 두 host를 동시에 owner로 만들기.
- 실회원 계측 전에 자동 답글 확장.

## 8. 다음 갱신 조건

이 문서는 다음 중 하나가 발생하면 같은 PR 또는 바로 다음 docs-only PR에서 갱신한다.

1. 다음 Batch 가 병합·배포되거나 중단된다.
2. 자연 controller 가 새 단계 결정이나 새 blocker 를 기록한다.
3. 보조 Mac runtime HEAD·pin·manifest 가 바뀌거나 갈라진다.
4. 회사 Mac 매거진 job 구성이 바뀐다.
5. North Star 첫 측정 · 82cook 첫 canary · 닉네임 변경이 생긴다.
