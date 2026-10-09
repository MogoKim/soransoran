# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-09 14:45 KST
> 마지막 창업자 동기화: 2026-10-09 (D5 운영 PASS · 보조 Mac 단일 owner · Persona 30 · D10 공급 병목)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS로 쓰지 않는다.

## 0. 창업자용 한 문장

**D5는 10월 8일 자동 5/5·첫 댓글 5/5·감사·도장까지 PASS했고, 보조 Mac이 D100 9개 job의
유일한 owner이며, 계약 유효 Persona 30명도 전원 active다. D10은 Persona가 아니라 공급 능력
11/12와 과거 미정산 비용 증거 때문에 아직 BLOCK이다.**

10월 9일 공개 단계는 `d5`, 준비 단계는 `d10`이다. 오늘 D5 재증명 운영일은 진행 중이므로
마지막 슬롯·댓글·감사·controller가 끝나기 전에는 오늘 결과를 PASS나 FAIL로 확정하지 않는다.

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ pin·manifest·격리 계약 | ✅ 보조 Mac HEAD=pin `b819413` | ✅ mixed SHA 0 · D100 9개 loaded |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ controller loaded | ✅ 10-09 `REPROVE · release d5 · capacity d10` |
| 자동 D3 | ✅ 자동 READY·발행·댓글·감사 | ✅ | ✅ 10-06 PASS |
| 자동 D5 | ✅ 같은 루프와 5개 슬롯 | ✅ | ✅ 10-08 자동 5/5 PASS · 10-09 재증명 진행 중 |
| 자동 D10 | ✅ 10개 발행 슬롯·Persona 하한·preflight | ✅ scheduler 지원 | ❌ 공급 능력 11 < 필요 12 · 공급 비용 증거 UNKNOWN |
| 상시 실행 owner | ✅ 이관·소유·rollback 계약 | ✅ 보조 Mac 9개 · 회사 Mac D100 0 | ✅ 단일 owner · 회사 Mac 매거진 4개 유지 |
| JIT source-to-slot | ✅ 부족 슬롯 기반 호출·발행 재검사 | ✅ | ❌ 같은 KST 운영일 공개 0% · 원문→공개 p50 49.91h |
| Persona 계약 | ✅ production universe 30 | ✅ runtime 30 인식 | ✅ contract-valid 30 · active 30 · draft 0 |
| 첫 댓글 | ✅ 60분 계약 | ✅ runner loaded | ⚠️ 최근 자동 공개 27건 중 25건 댓글 · 댓글 있는 글은 60분 안 100% |
| 댓글 복구·증거 | ⚠️ 기본 트랜잭션·중복 방지 있음 | ✅ | ❌ 수동 Persona 댓글 provenance·stale lock·runner recovery 구멍 |
| 감사 | ✅ 자동 공개의 `ceil(N×20%)` | ✅ loaded | ✅ 최근 27건 중 7건 선정·7건 판정·결함 0 |
| 82cook | ✅ bounded canary 계약 | ❌ policy-disabled · job 0 | UNKNOWN — clean canary 0회 |
| 실회원 우선 홈 랭킹 | ❌ Persona 댓글 합산 경로 잔존 | ❌ | UNKNOWN — 분리 지표 없음 |
| North Star | ❌ 재방문 이벤트 3종 없음 | ❌ measure job 미등록 | UNKNOWN — 실제 7일 재방문 참여 측정 불가 |
| D100 scheduler | ❌ d3~d50만 지원 | ❌ | ❌ d100 runtime profile 없음 |

`code PASS`는 코드와 검사가 있다는 뜻이고, `deployed PASS`는 보조 Mac runtime에 있다는 뜻이며,
`operating PASS`는 실제 자연 회차 증거가 있다는 뜻이다. 셋을 합쳐서 “완료”라고 쓰지 않는다.

## 2. 현재 운영 실측

### 2.1 자동 단계와 호스트

- 원격 main: `e2389f2`.
- 보조 Mac runtime HEAD=pin: `b819413`. main과의 차이는 뒤에 병합된 매거진 변경이며 runtime 내부 mixed SHA는 0이다.
- 보조 Mac: D100 9개 job loaded. 회사 Mac: D100 0개, 매거진 4개 loaded.
- 10월 9일 `StageDecision`: `REPROVE · release d5 · capacity d10`.
- 10월 8일 D5 증거:
  `target=5 · published=5 · autoTargets=5 · distinctAuthors=5 · firstCommentOk=5 · audit=1/1 · releaseStamped=5`.

### 2.2 최근 7일 루프

```text
후보 170 → 생성 78 → READY 78(자동 58) → 공개 27(자동·도장 27)
```

| 관측 | 값 | 판정 |
|---|---:|---|
| 원문 게시→수집 | p50 2.37h · p90 8.85h | 수집은 주병목이 아님 |
| 수집→생성 | p50 31.72h · p90 64.73h | 🔴 가장 큰 현재성 병목 |
| 생성→READY | p50 0.06h · p90 1.06h | 정상 |
| READY→공개 | p50 8.17h · p90 29.17h | 긴 대기 꼬리 |
| 원문 게시→공개 | p50 49.91h · p90 70.47h | 🔴 “지금의 이야기” 목표 미달 |
| 같은 KST 운영일 공개 | 0/27 · 0% | 🔴 JIT 제품 결과 미달 |
| 자동 슬롯 채움 | 27/30 · 90% | 단계 증명 밖의 누락 존재 |
| 첫 댓글 | 25건 · p50 13.69분 · p90 20.61분 | 댓글 있는 글은 60분 안 100%, 2건은 없음 |
| 자동 공개 감사 | 7/7 · 결함 0 | 표본 경로 동작 |
| 전체 루프 비용 | $2.2696 · 공개 1건당 $0.0841 | D100 선형 확대 전 예산 재설계 필요 |

단계 PASS는 무인 운영 계약의 증거이지 제품 건강 전체의 PASS가 아니다. D5가 PASS여도 위 현재성·재방문·랭킹
문제는 별도로 실패일 수 있다.

### 2.3 10월 9일 14:15 자연 공급 회차

- 회차는 수동 호출 없이 `done`으로 끝났다.
- 판정 장부 9건과 생성 장부 5건 모두 `usageUnknown 0`, 예약 초과 0이었다.
- 자동 채택 1건, 큐 적재 2건. 발행 가능은 8→8, 사람 검토 대기는 20→22였다.
- 따라서 새 Gemini usage 보정은 자연 회차에서 작동했다. 다만 **과거 미정산 2건**을 정산한 것은 아니다.
- 과거 미정산은 실제 사용량 근거로 해소되거나 cohort 창에서 빠질 때까지 비용 판정 UNKNOWN으로 남긴다.

## 3. D10의 정확한 blocker

| blocker | 현재 | 해소 조건 |
|---|---|---|
| `THROUGHPUT_SHORT` | 공급 능력 11 · 필요 하한 12 | 기준 완화 없이 같은 cohort에서 유효 결과 12 이상 실측 |
| `SUPPLY_COST_UNKNOWN` | 과거 usage 미상 2건 | 실제 근거로 정산하거나 3일 cohort 창 이탈 |
| preflight 분자 회귀 | PR #677 미병합 | 최신 main 통합·CI·merge·보조 Mac 배포 |

PR #677은 미도장 기계 행 중 정본 `eligibilityOf`가 자동 부적격으로 판정한 행을 분자에서 제외한다.
head `95c2a4c`, CI·Vercel은 PASS지만 base `b819413` 뒤로 main이 `e2389f2`까지 전진했다.
겹치는 파일은 없더라도 최신 main을 통합해 한 번 검증한 exact head만 병합한다. 이 보정은 과거 미상 행이
cohort를 벗어나는 10월 12일보다 먼저 runtime에 들어가야 공급 능력이 거짓으로 부풀지 않는다.

## 4. 정본·구현·운영 충돌 장부

| ID | 확인된 충돌 | 영향 | 처리 원칙 |
|---|---|---|---|
| T-01 | 직접 `supply:health`는 env 기본값으로 d1/CRITICAL, stage wrapper는 d5/d10 | 운영자 오판 | 직접 명령도 `StageDecision`을 읽거나 wrapper 밖 실행을 거부 |
| T-02 | 날짜 문서는 전부 역사라는 README 문장과, Persona Pool 문서를 runtime이 직접 읽는 현실이 충돌 | 문서 authority 불명확 | 정책 authority와 좁은 기술 입력을 분리해 목록화 |
| T-03 | 소란소란 세션이 우나어 작업 루트에서 시작될 수 있고 UnaEO 이름의 active import·env가 남음 | 서비스 혼동·오작업 | repo identity guard · 중립 상수 분리 · legacy 분류 |
| P-01 | 원문→공개 p50 49.91h · 같은 날 공개 0% | 현재성 상실 | 오래된 원천 우선·capture→generation 대기부터 해결 |
| C-01 | 수동 Persona 댓글도 `commentOrigin=PERSONA`면 자동 증거가 될 수 있음 | 거짓 댓글 증명 | 자동 runner provenance를 증거 계약에 포함 |
| C-02 | 댓글 runner는 recovery 대상 밖이고 stale lock 자동 회수가 없음 | 하루 댓글 0 가능 | bounded recovery와 lock owner/lease 증거 |
| C-03 | Persona 댓글이 홈 인기 점수에 합산됨 | 합성 인기 | 실회원 반응과 Persona 반응 분리 |
| M-01 | North Star 이벤트와 measure job 없음 | 사업 성과 측정 불가 | 3개 이벤트·실사용자 제외 규칙·관측 job 구현 |
| H-01 | runbook은 AC 상시를 요구하나 실제 야간 배터리 운영이 있음 | 방전·sleep 위험 | AC 계약 준수 또는 배터리 임계 알림을 별도 승인 |
| S-01 | 82cook off·미측정, 현재 상세 처리량 98.2/day | D30부터 원천 부족 | bounded canary 뒤 관측값으로만 확대 |
| S-02 | d100 scheduler/runtime profile 없음 | D100 코드상 실행 불가 | D20~D50 실측 뒤 동일 계약으로 구현 |

## 5. 다음 critical path

| 우선순위 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| P0-1 | PR #677 최신 main 통합·배포 | exact head CI PASS · merge · 보조 Mac runtime 일치 · 9 job 정상 | 현재 head 즉시 병합, D10 기준 완화 |
| P0-2 | 진단 authority 단일화 | 직접·wrapped health가 같은 d5/d10·같은 blocker를 보고 | env 기본값으로 조용히 판정 |
| P0-3 | D10 실제 공급 능력 확보 | 같은 cohort 유효 능력 ≥12 · 비용 정산 가능 · 자동 preflight PASS | 수동 글·댓글·장부 조작 |
| P0-4 | 문서 authority 재동기화 | 현재 상태·runbook·guide·문서 목록이 CI로 서로 대조 | 과거 문서를 삭제해 증거 소실 |
| P1-1 | 현재성 회복 | 수집→생성 지연·oldest-first 제거, same-day share 관측 개선 | 이미 돈 쓴 초안 구제 |
| P1-2 | 댓글 증거·복구 정직화 | automatic provenance · recovery · stale lock · 비용 실측 | 수동 댓글을 자동 증거로 인정 |
| P1-3 | 서비스 경계 강화 | repo identity fail-closed · UnaEO active import 0 · worktree 정리 기준 | legacy 자산 무검증 삭제 |
| P1-4 | Persona 닉네임 현실화 | 30명 전체 privacy-safe 분포 · 충돌 0 · atomic rename·audit·rollback | 실제 닉네임 복사 |
| P1-5 | 사람 검토 calibration | hard reject·safe roughness·WIP·legacy를 표본으로 분리 | 대기 22건 전부 무검증 공개 |
| P1-6 | North Star 계측 | 실사용자 7일 재방문+글/댓글을 Persona·봇·운영자 제외하고 측정 | 게시량을 성공 지표로 대체 |
| P2-1 | D20~D50 단계 파생 용량 | source·Persona·댓글·감사·비용 profile을 자연 회차로 검증 | 완성 글 stockpile |
| P2-2 | D100 구현 | scheduler profile · canary 180 · sustained 300+ · 원천 382/day · 복구·예산 증명 | 200명을 최종 D100 기준으로 오인 |

## 6. 창업자 결정이 필요한 것

| 결정 | 현재 추천 |
|---|---|
| D20 이상 공급·전체 루프 일 예산 | 품질·수율 개선 전 무조건 증액하지 않고, 단계별 실측 상한으로 승인 |
| Persona 닉네임 현실성 | 출생연도 숫자·`00맘`·영문/혼합을 분포로 허용하되 실제 닉네임은 복제하지 않음 |
| 사람 검토 soft gate | 욕·거친 말·가십·불만은 자동 차단 사유가 아님. privacy·truth·harm·originality는 hard 유지 |
| Persona 200명 | D100의 중간 목표로 사용. sustained 정본 300+는 실사용 집중도 근거 전까지 유지 |
| 야간 전원 | AC 상시가 기본. 배터리 운영을 허용하려면 임계 알림·자동 중지·복구 계약을 먼저 설계 |

P0-1~P0-4는 새 정책 결정 없이 진행할 수 있다. 위 결정은 해당 구현 직전에만 창업자에게 묻는다.

## 7. 지금 하지 않는 것

- 오늘 D5나 D10을 PASS로 만들기 위한 수동 발행·댓글·stage 변경.
- 미정산 예약액을 실제 비용으로 간주하거나 장부를 임의로 settled 처리.
- 회사 Mac에서 D100 job을 되살려 두 host를 동시에 owner로 만들기.
- 82cook을 공용 Wi-Fi·우회·위장 UA로 시험하기.
- 사람 검토 대기 글을 이유 구분 없이 전부 공개하기.
- Persona 이름을 실제 카페 작성자에게서 복사하기.
- 새 콘텐츠 레인 또는 별도 SEO 정보형 레인 만들기.

## 8. 다음 갱신 조건

이 문서는 다음 중 하나가 발생하면 같은 PR 또는 바로 다음 docs-only PR에서 갱신한다.

1. PR #677이 병합·배포되거나 중단된다.
2. 10월 9일 D5 재증명이 PASS·FAIL·UNKNOWN으로 끝난다.
3. D10 preflight가 비용·공급 능력의 새 판정을 기록한다.
4. Persona 닉네임 30명 변경이 승인·적용된다.
5. 82cook 첫 bounded canary 또는 North Star 첫 측정이 생긴다.
6. runtime·pin·main SHA가 갈라지거나 주요 runner가 반복 실패한다.
