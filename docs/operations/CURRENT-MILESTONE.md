# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-04 10:41 KST
> 마지막 창업자 동기화: 2026-10-04 (생동감 · 정치/연예 경계 · 실측 보충 · 레거시 제거)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path**만 적는다. 정책은
> [`NORTH-STAR.md`](./NORTH-STAR.md)와
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 정한다.
> 권위 지도는 [`README.md`](./README.md) 하나다. 관측하지 않은 것을 PASS 로 쓰지 않는다.

## 0. 창업자용 한 문장

**10월 3일 D3 증명일 자체는 PASS했다. 그러나 10월 4일 controller는 D5 준비도를
`THROUGHPUT_SHORT`로 판정해 공개 단계를 d3 `REPROVE`로 유지했다. 원천 부족이 아니라,
READY 목표에 근거 없는 20%를 고정 가산한 옛 preflight 계약과 수집→생성 45.73시간 지연이 현재 병목이다.**

운영은 멈추지 않았다. runtime·pin·main은 같은 SHA이고 supply·publish·comment·audit job은 loaded,
최근 exit은 모두 0이다. 정책 정본을 먼저 바로잡은 뒤 코드를 한 번의 교체 경로로 수렴시킨다.

## 1. 검증 기준과 상태

| 축 | code PASS | deployed PASS | operating PASS |
|---|---|---|---|
| runtime 일치 | ✅ main과 runtime 계약 있음 | ✅ HEAD·pin·main `5551f96` 일치 | ✅ mixed runtime 아님 |
| 자동 단계 controller | ✅ `StageDecision` 단일 authority | ✅ controller ON·job loaded | ✅ 10-03 D3 증거 PASS, 10-04 d3 REPROVE 기록 |
| 자동 발행 D3 | ✅ 자동 READY·거래·감사 경로 | ✅ runtime 반영 | ✅ 10-03 자동 3/3·서로 다른 Persona 3명·도장 3/3 |
| D5 준비도 | ⚠️ 실행되지만 옛 고정 20% 계약 | ✅ runtime 반영 | ❌ `readyNeeded=6`, `readyCapacity=5`로 FAIL |
| JIT source-to-slot | ⚠️ 증거 도장과 판정 일부 구현, 고정 재고 계산 잔존 | ⚠️ 부분 반영 | ❌ 원문→공개 p50 57.51h, 같은 날 공개 0/5 |
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
| C-01 | 단계별 READY를 공개량의 120%로 고정 | ❌ 근거 없는 고정 할증 | 실측 실패·만료·복구 여유로 교체하고 옛 상수 삭제 |
| C-02 | 상세 원천/day를 과거 전환율로 고정 | ❌ 관측값을 정책으로 승격 | source-to-slot 기회 coverage와 실측 수율로 계산 |
| C-03 | 정치와 공개 인물을 한 flag로 선필터 | ❌ 연예·방송·셀럽까지 제거 | 정치 선동만 제외하고 공개 인물은 안전 gate 뒤 정상 경쟁 |
| C-04 | 자동 댓글 경로가 글당 정확히 1건 | ⚠️ 첫 댓글 증명은 맞지만 제품 대화로는 부족 | 첫 댓글 계약 유지 + reply-worthiness 기반 0/1/복수 답글 |
| C-05 | 홈 인기에 Persona 댓글이 합산될 수 있음 | ❌ 합성 인기를 실사용자 반응처럼 사용 | 실회원 반응·현재성 우선, Persona 신호 분리 |
| C-06 | 재방문 참여 이벤트 없음 | ❌ North Star 측정 불가 | 실사용자 이벤트 계측 후 Persona·봇·운영자 제외 |
| C-07 | d100 scheduler profile 없음 | ❌ D100 미지원 | d20~d50 실측 뒤 같은 계약으로 d100 profile 구현 |
| C-08 | 82cook policy-disabled | canon상 필수 원천이나 현재 미가동 | 별도 보수 canary. D5 원천 부족의 핑계로 쓰지 않음 |

## 4. 다음 critical path

| 우선순위 | 목표 | 완료 조건 | 금지 |
|---|---|---|---|
| P0-1 | 고정 READY·상세 원천 계약 제거 | preflight가 슬롯별 유효 기회·실측 손실·복구시간으로 필요량 산출, 옛 상수와 중복 판정 삭제 | 하한만 낮추기, D5 수동 승격 |
| P0-2 | source-to-slot JIT 수렴 | 유료 생성 전·선택·발행 직전·준비도가 같은 판정을 사용, 원문 게시→공개 지연 급감 | 식은 READY 구제, 이벤트별 예외 |
| P0-3 | 정치/연예 선필터 교체 | 창업자 정치 목록은 유지, 연예·방송·셀럽 정상 수집, 명예훼손·사생활 gate 별도 replay PASS | 공개 인물을 한꺼번에 허용/차단 |
| P0-4 | 자동 D5 재증명 | 자동 5/5·서로 다른 Persona·첫 댓글·감사·비용·다음 결정 PASS | 사람 승인 글로 편수 채우기 |
| P0-5 | D10 Persona reserve +6 | contract-valid 30명, 근거 없는 생활사·말투 생성 0 | 단계를 열려고 하한 낮추기 |
| P1-1 | 선택적 자동 답글 | canon §5의 같은 reply-worthiness 판정, 실회원 우선, loop·중복·자기답글 0 | 모든 댓글에 의무 답글 |
| P1-2 | 실회원 우선 홈·베스트 | Persona 반응 분리, 현재성·실회원 참여 replay와 실제 화면 검증 | 합성 댓글로 인기 조작 |
| P1-3 | North Star 계측 | 7일 재방문 참여 고유 실사용자 측정, Persona·봇·운영자 제외 | 게시량을 성공 지표로 대체 |
| P1-4 | D20~D100 용량 | 같은 계약으로 scheduler·Persona·비용·복구를 단계별 증명 | 단계별 새 정책 fork |

P0-1~P0-3은 서로 같은 판정 파일을 건드릴 가능성이 높아 한 통합 브랜치에서 순차 구현한다.
Persona reserve와 답글 replay처럼 파일 경계가 다른 일은 병렬로 진행한다. 최종 exact head에서 CI를 한 번 돌린다.

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
