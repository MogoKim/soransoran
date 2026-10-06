# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-06 09:18 KST
> 마지막 창업자 동기화: 2026-10-06 (D3 재증명 · JIT 비용 상한 · 운영/문서 정합)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS 로 쓰지 않는다.

## 0. 창업자용 한 문장

**10월 5일 D5 증명은 자동 글 5/5 중 첫 댓글 1건 누락으로 FAIL했고, 10월 6일은 d3 `REPROVE`다.
오늘 D5로 소급 승격하지 않는다. 내일 D5를 막던 `SUPPLY_COST_UNKNOWN`은 공급 부족이 아니라,
이미 지출한 결말 모름 비용 때문에 결과당 비용 전체를 UNKNOWN으로 만들던 과잉 차단이며 보수적 비용 상한으로 교체 중이다.**

운영은 멈추지 않았다. 08:40·09:00 publish heartbeat의 DB 연결 실패 뒤 09:10 예약 회차가 자동 회복했고,
publish runner의 최근 exit은 0이다. runtime은 `38efdd3`, main은 매거진 변경이 추가된 `f7581d1`이다.

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ runtime pin 계약 있음 | ✅ runtime `38efdd3` · main `f7581d1` | ✅ D100 runtime은 단일 SHA, main 차이는 매거진 변경 |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ controller ON·job loaded | ✅ 10-06 d3 REPROVE 기록 |
| 자동 발행 D3 | ✅ 자동 READY·거래·감사 경로 | ✅ runtime 반영 | ✅ 10-03 자동 3/3·서로 다른 Persona 3명·도장 3/3 |
| D5 준비도 | ✅ 고정 20% 제거 · 실측 cohort 판정 | ⚠️ 비용 상한 보정 PR 전 | ⚠️ 현재 `SUPPLY_COST_UNKNOWN`, 보정식으로는 D5 비용 $0.2752/$0.50 |
| JIT source-to-slot | ✅ 수요 기반 유료 호출·slot intent·발행 재검사 | ✅ runtime 반영 | ⚠️ 현재 계약 표본 9건, 장기 지연은 계속 관측 |
| Persona 계약 | ✅ contract-valid 판정 | ✅ 24명 | ✅ D3·D5 하한 충족, ❌ D10 하한 30명에 6명 부족 |
| 첫 댓글 | ✅ 60분 계약·runner | ✅ loaded | ✅ 10-03 3/3, 최근 측정 p50 13.68분 |
| 다중 댓글 UI | ✅ Conversation Thread R1 | ✅ production | ✅ 사람·비회원 다중 스레드 실확인 |
| Persona 자동 답글 | ⚠️ 맥락 인터페이스만 있음 | ❌ 비활성 | UNKNOWN — 운영 관측 없음 |
| 감사 | ✅ 일별 20% 표본·판정 | ✅ loaded | ✅ 10-03 1/1, 최근 7일 결함 1건은 별도 기록 |
| 실회원 우선 홈 랭킹 | ❌ Persona 댓글 합산 경로 잔존 | ❌ | UNKNOWN — 분리 지표 없음 |
| North Star | ❌ 재방문 이벤트 없음 | ❌ | UNKNOWN — `session_start`·`engaged_session`·`return_visit` 미측정 |
| D100 scheduler | ❌ d3~d50만 지원 | ❌ | ❌ d100 profile 없음 |

`code PASS`는 코드와 검사가 있다는 뜻이고, `deployed PASS`는 현재 runtime에 있다는 뜻이며,
`operating PASS`는 실제 회차 증거가 있다는 뜻이다. 셋을 합쳐서 “완료”라고 쓰지 않는다.
일반 원칙상 contract-valid가 0명이면 다음 단계 하한 검사 때문에 D1→D3 부터 막힌다.

## 2. 10월 4일 운영 실측

### 2.1 단계와 러너

- 단계 결정: `2026-10-04 REPROVE · release d3 · capacity d5`.
- supply·publish·comment·audit 모두 loaded, 마지막 exit 0.
- 10:40 publish에서 DB 연결 실패 로그가 한 번 있었으나 runner 최종 exit은 0이다. 재발 여부를 관측한다.
- 비용: supply $0.0524/$0.50, comment $0.0021/$0.20, audit $0.0015/$0.30.

### 2.2 최근 7일 깔때기

```text
후보 500 → 생성 137 → READY 131(자동 48) → 공개 15(자동 9 · 계약 도장 5)
```

| 관측 | 값 | 판정 |
|---|---:|---|
| 원문 게시→수집 | p50 2.02h · p90 8.85h | 수집 자체는 즉시 병목 아님 |
| 수집→생성 | p50 45.73h · p90 67.73h | 🔴 가장 큰 지연 |
| 생성→READY | p50 0.05h · p90 1.07h | 정상 |
| READY→공개 | p50 6.68h · p90 69.39h | 오래 대기하는 꼬리 존재 |
| 원문 게시→공개 | p50 57.51h · p90 70.59h | 🔴 현재성 목표 미달 |
| 같은 KST 운영일 공개 | 0/5 | 🔴 JIT 미달 |
| 자동 슬롯 채움 | 9/15, 60% | 미달 |
| 상세 수집 처리량 | 94.5/day | D5 원천량 부족 주장은 사실 아님 |
| READY 생산 | 2.5/day | 공개 목표보다 느림 |
| 첫 댓글 | p50 13.68분 · 60분 안 100% | 댓글이 달린 글은 통과, 댓글 없는 공개 5건 별도 |

게시 시각을 모르는 공개 10건에는 capture 시각을 대신 쓰지 않는다. slot-valid coverage는 아직 저장되지 않아
`UNKNOWN`이며 controller dry-run에서만 본다.

## 3. 정본과 구현의 충돌 장부

| ID | 현재 구현·문서 | 정본 판정 | 처리 원칙 |
|---|---|---|---|
| C-01 | 고정 20% READY 할증 | ✅ 삭제됨 | 같은 cohort의 공개·손실·예정·모름으로 필요량 범위 계산 |
| C-02 | 고정 상세 원천/day와 고정 유료 묶음 | ✅ 삭제됨 | source-to-slot 부족분과 현재 계약 실측 수율로만 호출 |
| C-03 | 정치와 공개 인물을 한 flag로 선필터 | ✅ 교체됨 | 정치 문맥만 제외, 연예·방송·셀럽은 위해 gate 뒤 정상 경쟁 |
| C-09 | 결말 모름 비용이 있으면 결과당 비용 전체 UNKNOWN | ❌ 이미 쓴 비용을 숨기지 않아도 안전한 판정 가능 | 전체 현재계약 비용 ÷ 확인된 slot-valid 결과를 보수적 상한으로 사용 |
| C-04 | 자동 댓글 경로가 글당 정확히 1건 | ⚠️ 첫 댓글 증명은 맞지만 제품 대화로는 부족 | 첫 댓글 계약 유지 + reply-worthiness 기반 0/1/복수 답글 |
| C-05 | 홈 인기에 Persona 댓글이 합산될 수 있음 | ❌ 합성 인기를 실사용자 반응처럼 사용 | 실회원 반응·현재성 우선, Persona 신호 분리 |
| C-06 | 재방문 참여 이벤트 없음 | ❌ North Star 측정 불가 | 실사용자 이벤트 계측 후 Persona·봇·운영자 제외 |
| C-07 | d100 scheduler profile 없음 | ❌ D100 미지원 | d20~d50 실측 뒤 같은 계약으로 d100 profile 구현 |
| C-08 | 82cook policy-disabled | canon상 필수 원천이나 현재 미가동 | 별도 보수 canary. D5 원천 부족의 핑계로 쓰지 않음 |

## 4. 다음 critical path

| 우선순위 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| P0-1 | ✅ 고정 READY·상세 원천 계약 제거 | 배포·현재계약 표본 생성 완료 | 하한만 낮추기, D5 수동 승격 |
| P0-2 | ⚠️ source-to-slot JIT 운영 수렴 | 비용 상한 보정 배포 뒤 동일 cohort로 처리량·비용 판정 | 식은 READY 구제, 이벤트별 예외 |
| P0-3 | ✅ 정치/연예 선필터 교체 | 실제 모델 replay와 CI 통과, runtime 반영 | 공개 인물을 한꺼번에 허용/차단 |
| P0-4 | 진행 중 — 자동 D3 재증명 후 D5 | 10-06 자동 3/3·서로 다른 Persona·첫 댓글·감사·비용·다음 결정 PASS | 사람 승인 글로 편수 채우기 |
| P0-5 | D10 Persona reserve +6 | contract-valid 30명, 근거 없는 생활사·말투 생성 0 | 단계를 열려고 하한 낮추기 |
| P1-1 | 선택적 자동 답글 | canon §5의 같은 reply-worthiness 판정, 실회원 우선, loop·중복·자기답글 0 | 모든 댓글에 의무 답글 |
| P1-2 | 실회원 우선 홈·베스트 | Persona 반응 분리, 현재성·실회원 참여 replay와 실제 화면 검증 | 합성 댓글로 인기 조작 |
| P1-3 | North Star 계측 | 7일 재방문 참여 고유 실사용자 측정, Persona·봇·운영자 제외 | 게시량을 성공 지표로 대체 |
| P1-4 | D20~D100 용량 | 같은 계약으로 scheduler·Persona·비용·복구를 단계별 증명 | 단계별 새 정책 fork |

P0-1~P0-3 통합은 #655로 main에 병합됐고 runtime에 배포됐다. 이후 보정도 중간 상태를 운영에 섞지 않고
exact head의 CI가 끝난 뒤 한 번의 runtime 배포로 적용한다.

## 5. 확인된 D3 결과와 D5 차단점

10월 3일 D3 증거는 다음을 모두 통과했다.

```text
target=3 · published=3 · autoTargets=3 · humanApproved=0 · distinctAuthors=3
firstCommentOk=3 · auditExpected=1 · auditSampled=1 · auditRows=1 · releaseStamped=3
```

따라서 **D3 증명일 자체는 operating PASS**다. 다만 다음 D5 preflight가 다음 한 이유로 FAIL했다.

```text
THROUGHPUT_SHORT: target=5 · opportunities=5 · readyNeeded=6 · readyCapacity=5
```

`opportunities=5`이고 상세 수집은 94.5/day이므로 원천 부족이 아니다. `readyNeeded=6`은 canon에서
폐기한 고정 20% 할증이고, 실제 문제는 수집→생성 지연과 READY 생산 2.5/day이다. controller가
10월 4일 d3 REPROVE를 기록한 것은 현재 코드의 보수적 동작이며, 과거 증거를 소급해 D5로 바꾸지 않는다.

## 6. 대화 상태

- Conversation Thread R1은 production에서 다중 답글·직접 답변 대상·한 단계 들여쓰기까지 검증됐다.
- Persona 자동 댓글은 아직 최상위 첫 댓글만 쓴다.
- 다음 자동화는 새 UI 구현이 아니라 기존 스레드 계약에 reply planner를 연결하는 일이다.
- 실회원과 Persona 댓글에 **canon §5의 같은 reply-worthiness 판정**을 쓰되 실회원을 우선한다.
- 자기 답글·중복·고아·삭제/신고 우회·두 Persona 무한 루프는 영구 0이다.

## 7. 지금 하지 않는 것

- D5를 열기 위한 수동 발행·댓글·승격.
- 이미 만든 글이 아깝다는 이유의 구제.
- 명절·연예·날씨별 별도 freshness 정책.
- 새 콘텐츠 레인 또는 별도 SEO 정보형 레인.
- 모든 거친 의견·논쟁을 위험으로 보는 광역 필터.
- 검증 전 운영 DB·env·launchd·예산 변경.
- 여러 PR을 각각 배포해 runtime을 중간 상태로 만드는 것.

## 8. 다음 갱신 조건

이 문서는 다음 중 하나가 발생하면 즉시 갱신한다.

1. C-01~C-03 교체 PR이 main에 병합되고 runtime에 배포됨.
2. D5 증명일이 PASS·FAIL·UNKNOWN 중 하나로 끝남.
3. contract-valid Persona가 30명에 도달함.
4. 선택적 자동 답글 또는 실회원 우선 랭킹이 production에서 첫 운영 증거를 남김.
5. runtime·pin·main SHA가 갈라지거나 주요 runner가 반복 실패함.
