# d10 activation preparation

> 선행: [Scale Foundation](2026-09-08-scale-foundation.md) · [Pool 설계](2026-08-30-persona-pool-design.md) ·
> [Raw 공급망](2026-09-03-raw-supply-chain-design.md)
>
> 🔴 이 PR 은 **준비와 dry-run 까지만** 한다.
> DB write · persona 생성·활성화 · launchd 등록 · GitHub Variables 변경 · cron 실제 변경 · 발행 **전부 0**.

## §0 무엇이 준비됐나 — 한 장

| | 지금 | 준비 후 |
|---|---|---|
| 준비도 시간축 | 시작점이 호출부마다 달랐고, 다음 슬롯을 쓰면 오늘 낸 몫 위에 하루 상한이 다시 얹혔다 | **지평 = 다음 KST 운영일 0시부터 완전한 14일**. 네 단계가 같은 창을 본다 |
| 다음 발행 슬롯 | 준비도와 한 값이었다 | **표시용으로 분리**. 단계마다 다르고 준비도에는 들어가지 않는다 |
| persona | Pool 20장 · 유효 19명 (d10 139/140) | Pool **25장** · 유효 **24명** (d10 **140/140**, pause 4명 여유) |
| 닉네임 | 코드가 6자까지 허용해 `봄볕나무` 를 만들었다 | 정본 §3-2 그대로 **두세 글자**. dry-run 이 코드→이름·Gate ⑥-B 를 함께 보여 준다 |
| 재고 소비 | FIFO — 140건이면 맨 뒤가 14일 대기 | **현재성 우선**. 시각 미상·TTL 초과·상한 복구는 **사람 검수**(삭제 아님) |
| 수집 능력 | 계획 회차(4/8회)를 실제 능력처럼 셌다 (실제는 1회 job) | **current 20 / prepared 320 / required 382** 를 따로 낸다 |
| 등록 상태 정본 | 코드의 정적 `loaded: true` | **launchctl + 설치된 plist 관측** (CI 는 synthetic 주입) |
| 수집 준비도 | `>= 380` 이라는 손으로 낮춘 문턱을 통과 | 필요 382 · 여유 기준 546 · 다회 job 미등록 → **BLOCKED** |
| 수집 보호장치 | 없음 | **예산 · 지수 backoff · 403/429/TCP 별 차단기** + health 노출 |
| 차단기 half-open | 시험 실패해도 half-open 유지 → 무한 재시도 | **즉시 open · 새 쿨다운** · 시험은 **한 건** |
| 상태 파일 동시성 | 두 프로세스가 예산·시험을 각자 씀 | **파일 잠금 + 원자적 read-decide-record** |
| 403 해제 | 파일 삭제·수동 편집 | **전용 도구** (dry-run · allowlist · reason · append-only 이력) |
| freshness | 러너만 hold → 화면은 READY, 실제는 미달 | **러너=관제=예측=준비도** 같은 함수 |
| 러너 vs 예측 선택 | 같은 입력에 러너 `z-hot` · 예측 `a-ever` | **같은 글·같은 persona** (수가 아니라 선택이 같다) |
| 예측의 후보 나이 | `ageDays` 스냅숏이 굳어 14일 뒤에도 그대로 | `capturedAt` 보존 · **날짜마다 다시 잰다** |
| 단계별 준비도 | d1 로 미리 정렬한 큐로 d10 계산 | **단계마다 그 cap 으로 다시 계산** |
| 잠금 획득 | 빈 잠금을 죽은 것으로 보고 **훔침** | 원자적 획득 · mtime TTL · owner token |
| Naver 보호장치 | 없음 (Playwright 우회) | `guardedNavigate` — 82cook 과 같은 계약 |
| current 정본 | 관측 20 · 정적 60 **두 벌** | 관측 하나 · autopilot 은 **조건부**로 분리 |
| Gate ⑥-B | salt 를 `loadEnvLocal()` **앞**에서 읽어 authorHash 대조가 무력했다 | 뒤에서 만든다. salt 가 판정을 실제로 바꾸는 것을 fixture 가 증명한다 |
| 승격 조건 | "미달" 만 표시 | **무엇을 얼마나 채워야 하는지** 숫자로 |

---

## §1 준비도 시간축 — 지평과 다음 슬롯을 나눈다

### 무엇이 틀렸나

두 가지가 겹쳐 있었다.

**① 호출부마다 시작점이 달랐다.** `simulateAllStages` 가 `startAt` 을 인자로 받아
러너는 `now`, 관제는 `nextScheduleAt` 을 넘겼다 — 같은 DB 를 보고 다른 준비도를 말했다.

**② 그것을 "단계별 다음 발행 슬롯" 으로 통일했더니 다른 것이 깨졌다.**
예측기는 시작점부터 **하루씩** 밀며 그날의 상한만큼 배정한다. 시작점이 오늘 13:25 이면
그 조각 하루가 **완전한 하루**로 세어진다 — d10 에서 오늘 3건을 이미 냈는데
그 위에 10건이 다시 얹혀 **오늘 13건**이 된다. 재고와 인원이 실제보다 넉넉해 보인다.

그리고 단계마다 anchor 가 다르므로 d1 은 내일 00:05, d10 은 오늘 13:25 에서 시작한다 —
**서로 다른 창**(그것도 한쪽만 조각 하루가 섞인 창)을 비교하게 된다.

### 어떻게 고쳤나 — 시간축은 두 개다

```
① nextSlotAnchor(profile, axis)   그 단계의 **다음 실제 발행 슬롯**
                                  "다음에 언제 나가는가" 를 말할 때만 쓴다
② horizonStart(now)               **준비도 지평의 시작점 = 다음 KST 운영일 0시**
                                  단계를 모른다. 오늘(조각 하루)은 들어가지 않는다
```

`simulateStage` 는 ②로 14일을 센다. 오늘 낸 몫은 지평 밖이라 **더할 것도 뺄 것도 없다** —
`publishedToday` 가 3이든 10이든 준비도가 같다(fixture 가 그것을 본다).

실측 (2026-09-08 12:00 KST 기준):

| 단계 | 오늘 발행 | 다음 슬롯 (표시) | 지평 시작 (판정) |
|---|---|---|---|
| d1 | 0 | 내일 00:05 | 내일 00:00 |
| d10 | 3 | **오늘 13:25** | 내일 00:00 |
| d10 | 10 | 내일 00:05 | 내일 00:00 |

**요구 조건 충족** — d1 · 오늘 1건 완료 · 후보 14건 → `14일 14/14 · 공백 0일 · READY`.
그리고 **d1 · d3 · d5 · d10 이 같은 창**(내일 0시부터 완전한 14일)을 본다 —
`horizonMismatches()` 가 그 어긋남을 잡고 health JSON 이 `scale.horizon` 으로 내보낸다.

### 최저 단계마저 미달일 때

d1 아래로는 내려갈 곳이 없어 `throttled` 가 서지 않는다. 그때 "달성 가능" 이라고 적으면
**미달을 초록으로 보여 준다.** 그래서 `safeStageFor` 가 `chosenReady` 를 따로 들고 다니고,
화면은 그 값으로 색을 정한다.

```
🔴 NOT_READY — d1 를 유지하지만 그 단계도 지금 큐·인원으로는 미달이다
```

health · planner · auto-publish 세 곳이 **같은 `axis`** 를 넘긴다(fixture 가 대조).

---

## §2 persona 24명

### 얇은 축은 사람이 고르지 않는다

`src/lib/persona-axis-coverage.ts` 가 세 종류를 함께 센다 — 생활사 · 반응 역할 · 문체 길이.
**두께 2 미만이면 얇다**(한 명이 쉬면 그 축이 통째로 막힌다).

🔴 처음 측정에서 `문체: 짧게/보통 0명` 이 나왔는데, `PoolCard.voiceLength` 가 **원문 토큰**(`중간 길이`)이라
문자열을 직접 비교하면 어느 밴드에도 안 걸렸다. `readLengthBand` 정본으로 읽도록 고쳤다 —
실제로는 짧게 8 · 보통 6 · 길게 5 로 얇지 않았다.

### 측정 결과와 보강

| 축 | 20장 | 25장 | 새 카드 |
|---|---|---|---|
| 별거 | 1 | 2 | P21 |
| 이혼 | 2 | 3 | P22 |
| 사별 | 2 | 3 | P23 |
| 비혼 | 2 | 3 | P24 |
| 자녀 초등 | 2 | 4 | P21 · P25 |
| 자녀 대학·취준 | 2 | 3 | P22 |
| 일: 직장 | 2 | 4 | P21 · P24 |
| 돌봄 상시 | 3 | 4 | P23 |

### 🔴 메우지 않은 축 — 숫자가 0이라고 다 메우는 것이 아니다

```
자녀 영유아  0명 → 공식 타겟이 40대 중반~60대 중반이라 드물다. 억지로 넣으면
                  Pool 이 타겟에서 벗어난다. 손주는 다른 축이다
반응 advice  0명 → Pool §5-1 ②가 정한 설계 원칙이다. 건강 경험자가 많은 Pool 에서
반응 caution 0명   의료 조언으로 새는 것을 막는 장치다
                  🔴 카드에는 `advice(의료)` 처럼 **영역을 한정한** 표기가 많은데
                     파서는 역할 이름만 읽어 전면 금지로 기록한다 — 안전한 쪽 오차다
                  🔴 이 정책을 푸는 것은 **창업자 결정 사항**이다
```

### cohort — 총 24명

| cohort | 인원 | 상태 |
|---|---|---|
| `wave1-mvp` | 5 | 🔒 CLOSED (운영 중) |
| `wave2` | 3 | 🔒 CLOSED (운영 중) |
| `wave3-scale` | 11 | 🟢 RUNNABLE |
| **`wave4-depth`** | **5** (P21~P25) | 🟢 RUNNABLE · `wave3-scale` 선행 |

합 **24명** = Pool 25장 − P09(길이 미상).

### 닉네임 — 정본은 **두세 글자**다

🔴 **길이 정책이 정본과 어긋나 있었다.** Pool §3-2 는 `두세 글자 순우리말` 이라고 못박았는데,
코드는 "조합형은 6자까지" 라는 예외를 스스로 만들어 `봄볕나무` 같은 네 글자를 생성했다.
정본에 그런 예외가 없고, 네 글자 조합은 그 자체로 지어낸 티가 난다.

```
길이        NAME_LENGTH = { min: 2, max: 3 }   ← 생성기와 검사기가 같은 상수를 쓴다
후보 공간   src/lib/persona-nickname-candidates.ts
              SOLO(두·세 글자)  +  HEAD1(한 글자) × BODY2(두 글자) = 세 글자
              🔴 두 글자 머리를 두지 않는다 — 네 글자가 나올 경로 자체를 없앴다
정책 검사   숫자·영문·봇/AI·운영자·출처 커뮤니티·지역명·나이/가족상태/병명·브랜드 금지어
최종 판정   적용 시점의 Gate ⑥-B (회원 닉네임 · 크롤 authorHash · 기존 persona)
```

🔴 **코드에 "P21 = ○○" 배정표를 두지 않는다** — Pool §3-2 이유 ②(헌법 §9-6)가 금지한다.
후보 공간만 두고 **누구에게 갈지는 적용 시점이 정한다.** fixture 가 배정표 부재를 검사한다.

🔴 `tmp/persona-<cohort>-displayname.json` 이 있으면 **그것이 우선한다** — 직접 고르는 문은 닫지 않는다.
어느 경로로 왔든 정책은 다시 본다.

### dry-run 이 무슨 이름이 붙을지 보여 준다

"전원 pass" 한 줄만 내면 창업자는 **무슨 이름이 붙을지 모른 채** `--apply` 를 눌러야 한다.
이름은 회원에게 그대로 보이는 것이라 적용 전에 눈으로 볼 수 있어야 한다.

```
   ── 예정 닉네임 (P 코드 → 이름 · Gate ⑥-B)
      P21  조약돌   ✅ pass  충돌 없음
      P22  오솔길   ✅ pass  충돌 없음
      …
      🔴 적용 시점에 트랜잭션 안에서 다시 판정한다 — 위 결과는 지금 시점의 안내다
```

🔴 여기 적히는 것은 **우리가 만들 persona 의 이름**이다. 대조 대상(회원 닉네임 · 크롤 author)은
한 글자도 나오지 않는다 — 판정부가 원문을 돌려주지 않기 때문이다.

---

## §3 freshness 계약

### TTL 근거 — 실제 후보 age 분포 (2026-09-08 read-only 조사)

```
발행 대기 후보 19건의 age(원문 작성 기준, 일):
  0 1 1 1 1 1 1 1 1 1 2 2 2 2 6 6 6 6 6      p50=1 · p75=6 · max=6
이미 발행된 5건의 적재→결정 지연: 전부 0일
```

| | 값 | 근거 |
|---|---|---|
| `hot` | ≤ 2일 | 19건 중 14건이 여기 든다 — 지금 파이프라인의 정상 대기 시간 |
| 현재성 `warm` | ≤ 7일 | 실측 max 6일 + 하루 여유. 일주일 넘으면 "요즘" 이 어긋난다 |
| 상시 `warm` | ≤ **28일** | 재고 지평(14일)의 **2배**. 14일로 잡으면 d10 에서 재고를 한 바퀴 소비하는 순간 맨 뒤가 통째로 만료된다 |

### 🔴 모르는 시각을 `warm` 이라고 적지 않는다

예전 판은 `ageDays === null` 을 "가장 보수적으로 warm" 이라고 적었다. 그런데 `warm` 은
**"괜찮다" 는 뜻**이라 자동 발행 대상에 그대로 들어갔다 — 몇 년 전 글일 수도 있는데도.

```
freshnessOf({ ageDays: null })  →  'unknown'      🔴 등급이 아니라 "모른다" 는 사실
isAutoPublishable('unknown')    →  false          자동에서 빠져 사람 검수로 간다
```

### 🔴 상한 복구는 자동으로 내보내지 않는다

예전 계약은 "복구는 신선도를 따지지 않는다 — 이미 그 사람에게 준 글이다" 였다.
그러면 **가장 오래 상한 글이 가장 먼저 나간다.** 배정만 하고 며칠 멈춰 있던 행이 정확히 그런 행이다.

복구는 여전히 **우선**이지만, TTL 을 넘겼거나 시각을 모르면 자동에서 빼고 사람에게 보낸다.
🔴 배정을 지우지도 재배정하지도 삭제하지도 않는다 — 큐에 그대로 있다.

### 🔴 러너 · 관제 · 예측 · 준비도가 **같은 함수**를 부른다

freshness hold 를 발행 러너에만 넣었더니 화면과 실제가 갈렸다.

```
사고 재현   후보 14건 중 1건이 시각 미상
            supply-health   14건을 재고로 세고 → READY
            forecast        14건으로 14일 발행량 계산
            실제 러너        1건 hold → 13건
```

이제 넷이 `prepareCandidates` 하나를 부른다. 같은 입력이면
**자동 대상 id · hold 사유 · 정렬 순서가 글자 그대로 같다**(fixture 가 세 경로를 대조한다).

🔴 hold 된 글은 매칭에 **들어가지 않는다** — persona 자리를 선점하지 못한다.
예전 러너는 `planBatch` 를 먼저 돌리고 순서를 나중에 바꿔, 상한 글이 자리를 쥐고 있었다.

🔴 발행 우선순위를 넣어도 **최대 매칭 총량과 persona 주 상한은 깨지지 않는다.**
`maxMatch` 가 증가 경로(Kuhn)라 처리 순서가 배정 수를 바꾸지 않기 때문이다 —
자리 경쟁이 있을 때 **누가 앉는지**만 달라진다. 자리가 하나뿐이면 현재성 hot 이 가져간다.

### 소비 순서

```
① 기존 배정 복구 (살아 있는 것)   맨 앞. 화면이 보여준 필자와 실제가 달라지지 않게
② 현재성 hot → warm               신선도가 먼저
③ 상시                            적합도 → 신선도 → 줄 순서
④ 사람 검수 (hold)                TTL_EXPIRED · AGE_UNKNOWN · RECOVERY_STALE
                                  🔴 자동 발행에서만 뺀다. 삭제하지 않는다
```

### 🔴 "적합도 우선" 을 계약으로만 두지 않는다

③의 적합도는 `fitScore` 다. 러너가 그 값을 넘기지 않으면 전부 0 이 되어 **상시 후보는 그냥 FIFO** 다 —
문서에는 "적합도 우선" 이라고 적혀 있는데 실제로는 아니었다.

```
fitScoreOf(id) = 배정된 persona 의 score.total
                 (아직 배정 전이면 eligible[0] — planBatch 가 점수 내림차순으로 준다)
```

생산 경로(`original-post-auto-publish.mts`)가 이 값을 넘기는지 fixture 가 소스로 확인한다.

### 🔴 '설' 같은 한 글자 신호의 오탐 제거

`TIMELY_MARKERS` 에 `'설'` 을 두고 `includes` 로 찾으면 **`설거지` · `소설` · `말설임` · `주말설계`**
가 전부 명절 이야기가 된다. 그러면 상시 글이 현재성으로 분류돼 TTL 이 28일에서 7일로 줄고,
멀쩡한 재고가 3주 만에 자동 발행에서 빠진다.

```
TIMELY_MARKERS      두 글자 이상 — 부분 문자열 오탐이 잘 나지 않는다
TIMELY_SYLLABLES    한 글자(설 · 봄) — **경계를 본다**
                      · 앞이 한글이면 그 말의 꼬리다      → 신호 아님 (소설 · 말설임)
                      · 뒤가 한글이면 조사·짧은 접미일 때만 → 신호  (설날 · 봄이)
                      · 그 밖은 다른 낱말로 본다          → 놓치는 쪽이 안전하다
```

주제 판정은 이 신호 포함 여부 하나뿐이다. **안전성·품질 게이트를 대신하지 않는다.**
legacy 제외 · 안전 판정 · 최대 매칭 계약은 그대로다.

---

## §4 세 수집원 다회 운영

### 실측 (로그·목록 JSONL read-only 조사)

| | 목록 1p | 회차당 페이지 | 상세/회차 | 상세 성공률 | 세션 오류 | 신규 유입 |
|---|---|---|---|---|---|---|
| 82cook | **25** | 3 | 30 | **0.8 (8/10)** | 0 | 🔴 **미측정** |
| remonterrace | 21 | 1 | 10 | 1.0 (6/6) | 0 | 약 1.0건/h (하한) |
| wgang | 21 | 1 | 10 | 1.0 (6/6) | 0 | 약 0.8건/h (하한) |

요청 간격은 목록 4,000ms · 상세 3,000ms (±jitter) — 실측 그대로다.

### 🔴 1,147 은 페이지 크기가 아니었다

예전 판은 82cook 의 `listPageSize` 에 **1,147** 을 넣었다. 1,147 은 `listToDetail = 10/1,147` 의
**분모** — 하루치 목록을 훑어 모은 표본 전체다. 그것을 페이지 크기로 쓰면
"페이지가 넘어가는 데 57시간" 이 되어, 한 시간에도 넘어갈 수 있는 게시판을
**하루 열 번만 봐도 안전하다**고 말하게 된다.

실제 페이지 크기는 목록 JSONL 로 잰다.

```
.microseed-data/82cook.list.jsonl 을 회차 경계(글번호가 다시 커지는 지점)로 나누면
  25 · 125 · 150 · 75 건   ← 전부 25의 배수
82cook-verify.list.jsonl (--pages=1) = 정확히 25건
→ 목록 1페이지 = 25건
```

### 🔴 회차 수가 아니라 **간격**이 계약이다

한 회차가 보는 범위(`페이지 크기 × 회차당 페이지 수`)가 넘어가는 시간보다 간격이 길면
그 사이 글을 영원히 못 본다.

```
페이지 수명 = (21건 × 1장) ÷ 1.0건/h ≈ 21h      안전 상한 = 그 절반 = 10.5h
```

🔴 **82cook 은 이 계산을 할 수 없다.** 신규 유입을 잰 적이 없다 —
회차별 목록 스냅숏을 시각과 함께 남긴 기록이 없다. 예전 판의 `20건/h` 는
"페이지 3장이면 약 120건" 이라는 어림에서 나온 값이고 근거가 없었다.

모르는 값을 무한대로 두면 "아무리 드물게 봐도 안전" 이 된다. 그래서 `null` 로 두고,
`verifySchedule('82cook', …)` 이 **계획 미성립**으로 잡는다.

### 스케줄

| | 시작 | 안정 | 최대 간격 | 안전 상한 | 하루 요청 / 상한 |
|---|---|---|---|---|---|
| 82cook | 10회 (:10) | 10회 | 3h | 🔴 계산 불가 | 330 / 400 |
| remonterrace | **4회** `04:20 10:20 16:20 22:20` | 8회 | 6h | 10.5h | 44 / 150 |
| wgang | **4회** `02:50 08:50 14:50 20:50` | 8회 | 6h | 13.1h | 44 / 150 |

🔴 **분(minute)이 소스마다 다르다** (:10 / :20 / :50). 같은 분에 겹치면 한 세션이
두 곳을 연속으로 긁는 모양이 되고, 차단은 그 모양을 본다.

### 🔴 이론 최대와 유효 처리량을 나눈다

```
이론 최대    시작 380건/day   안정 460건/day     ← 한 건도 실패하지 않았을 때
prepared     시작 320건/day   안정 400건/day     ← 성공률을 곱한 계획값
             82cook  30 × 10 × 0.8 = 240
             remonterrace 10 × 4 × 1.0 = 40 · wgang 40
current       20건/day                          ← 🔴 **지금 실제로 열리는 것**
             remonterrace 10 × 1 × 1.0 = 10 · wgang 10 · 82cook 미등록 0
```

🔴 **current 와 prepared 를 합치지 않는다.** `launchctl` 에 올라와 있는 것은 카페 **1회 job** 두 개와
`supply-autopilot` 뿐이다. `*-multi` job 도 82cook job 도 등록되지 않았다.
계획 회차(4·8회)를 곱해 40·80 을 실제 능력으로 세면, **아무도 등록하지 않은 job 을 능력으로 세는 것**이다.

등록 상태의 정본은 **관측**이다 — `launchctl list` 와 `~/Library/LaunchAgents/*.plist` 의
실제 `StartCalendarInterval`. 코드의 정적 `loaded: true` 를 쓰지 않는다.
그 관측을 `supply-health` 는 실측으로 넣고, CI 순수 fixture 는 synthetic 으로 주입한다.

`label` 과 슬롯 수가 **정확히** 계획과 같을 때만 current 에 반영된다 —
다회 label 이어도 슬롯이 2개면 그것은 2회 job 이다.

82cook 상세 두 건 중 하나꼴로 실패하는 것이 아니라 열에 둘이다. 그 둘은 계획에서 사라지지 않고
**큐가 채워지지 않는 형태**로 나중에 드러난다. 그래서 능력은 처음부터 성공률을 곱해 말한다.
격리 보고도 같은 기준이다.

### 🔴 보호장치 — 예산 · 지수 backoff · 분류별 차단기

회차를 하루 1회에서 10회로 늘리면 **실패의 성격이 달라진다.** 막혔을 때 그대로 계속
두드리면 다음에 오는 것은 느려짐이 아니라 차단이다.

| 분류 | 무슨 뜻인가 | 재시도 | 차단기 임계 | 쿨다운 |
|---|---|---|---|---|
| `FORBIDDEN` (403) | 우리를 알아보고 막았다 | 🔴 **하지 않는다** | **1회** | 🔴 사람이 확인해야 닫힌다 |
| `RATE_LIMIT` (429) | 속도가 문제다 — 기다리면 풀린다 | 4회 (30s→15m) | 2회 | 1시간 |
| `NETWORK` (TCP) | 연결 자체가 안 됐다 | 3회 (5s→2m) | 5회 | 10분 |
| `SERVER` (5xx) | 남의 서버 문제다 | 3회 | 5회 | 30분 |
| `OTHER` | 모른다 | 2회 | 3회 | 30분 |

🔴 셋을 한 임계로 묶으면 **403 을 다섯 번 맞을 때까지 계속 두드린다.**
🔴 모르는 실패를 `NETWORK` 로 넘기지 않는다 — 임계가 가장 느슨한 칸에 쌓인다.
🔴 예산은 KST 하루 단위로 초기화하지만 **차단기는 넘어간다.** 403 을 자정이 지났다고
잊으면 다음 날 같은 자리에서 다시 맞는다.

```
판정   src/lib/collect-guard.ts          🔴 순수 함수 — 파일·네트워크·시각 조회 0
저장   scripts/lib/collect-guard-store.mts  .microseed-data/collect-guard-<source>.json
적용   scripts/micro-seed-collect-82cook.mts 의 모든 요청이 guardedGet 을 지난다
노출   supply:health ④-b (화면) · JSON `collect.guards`
해제   npm run collect:guard-status / collect:guard-clear
```

### 🔴 half-open 에서 시험이 실패하면 **즉시 다시 닫는다**

```
closed ──(연속 실패 = 임계)──> open
open   ──(쿨다운 경과)────────> half-open
half-open ──(시험 요청 1건)──> open        시험 중에는 두 번째 요청을 보내지 않는다
half-open ──(시험 성공)──────> closed
half-open ──(시험 실패)──────> open        🔴 openedAt 을 그 실패 시각으로 갱신한다
```

예전 판은 `openedAt` 을 **첫 실패 시각으로 유지**했다. 그래서 시험이 실패해도
`now - openedAt` 이 여전히 쿨다운을 넘어 **계속 half-open** 이었고,
물러나야 할 때 오히려 무한히 두드렸다.

"한 건만 시험한다" 도 계약이다. 시험 요청을 보내면 그 분류를 "시험 중" 으로 표시해
두 번째 요청을 막는다. 프로세스가 죽어 결과를 못 남기면 5분 뒤 버려진 시험으로 보고 푼다.

### 🔴 상태 파일은 두 프로세스가 나눠 쓴다

앞으로 82cook 독립 job 과 `supply-autopilot` 이 **같은 상태 파일**을 쓴다.
읽고-판단하고-기록하는 사이에 끼어들면 두 가지가 깨진다(재현 확인).

```
① 예산 유실   둘 다 requestsToday=0 을 읽고 둘 다 1 을 쓴다 → 2건 보내고 1건으로 기록
② 시험 중복   둘 다 half-open 을 보고 **각자** 시험 요청을 보낸다
```

그래서 **예약(read-decide-record)을 파일 잠금 안에서 한 번에** 한다.
네트워크 요청은 잠금 밖에서 한다 — 남의 서버를 기다리는 동안 다른 job 을 세우지 않기 위해서다.
잠금은 시효 60초가 지나면 뺏고, 15초 안에 얻지 못하면 **그 회차는 요청하지 않는다**(fail-closed).
상태 write 는 임시 파일 + rename 으로 원자적이고, 잠금 밖 저장은 코드가 막는다.

### 🔴 403 은 사람이 연다 — 파일 삭제를 절차로 두지 않는다

```
npm run collect:guard-status                                            # read-only
npm run collect:guard-clear -- --source=82cook --class=FORBIDDEN        # dry-run
npm run collect:guard-clear -- --source=82cook --class=FORBIDDEN --apply --reason "..."
```

- 기본 dry-run · source·class **allowlist** · `--apply` 와 `--reason` 필수
- 지정한 **하나만** 연다. 예산과 다른 분류는 건드리지 않는다
- 열리지 않은 차단기, 잘못된 source/class, reason 없음은 **fail-closed**
- 상태 파일을 지우지 않는다. 원자적 write · 해제 이력은
  `.microseed-data/collect-guard-audit.log` 에 **append-only**
- DB · 네트워크 호출 0

### 🔴 수집 준비도는 **BLOCKED** 다

```
100/day 내부 목표 → 하루 상세 382건 필요 (required)
여유 기준(기존 30% 규칙, COLLECT_MARGIN_RATIO = 0.7) → 546건 필요

current   20   🔴 362건 모자란다 — 다회 job 이 하나도 등록되지 않았다
prepared  320  🔴 전부 올려도 62건 모자란다
82cook         신규 유입 미측정 · 보호장치 상태 없음 · job 미등록
카페 둘        1회판이 돌고 있다 (계획은 다회 4회)
→ 소스 셋 전부 BLOCKED · 수집 준비도 = BLOCKED
```

🔴 **d1 운영 건강성과 d10 승격 준비도를 섞지 않는다.**
d1 이 요구하는 상세는 하루 6건이라 지금 능력(20건)으로 충분하다 — d1 은 정상 운영될 수 있다.
그 사실이 d10 준비 완료를 뜻하지 않는다.

🔴 예전 fixture 는 `detailPerDay('start') >= 380` 이라고 적어 두고 통과했다.
필요량은 382 였다 — **필요량보다 작은 수에 맞춰 문턱을 손으로 낮춘 것**이고,
380 은 성공률도 곱하지 않은 이론 최대였다. 그 검사를 지웠다.

### 장애 격리

job 을 소스마다 따로 둔다 — 한 프로세스의 실패가 다른 job 의 exit status 에 영향을 주지 않는다.

```
82cook 장애        → 나머지 2개 · 유효 80건/day 유지
remonterrace 장애  → 나머지 2개 · 유효 280건/day 유지
셋 다 장애         → 🔴 격리가 아니다. 전면 중단이다
```

### 🔴 등록하지 않았다

```
docs/operations/launchd/
  com.soransoran.navercafe-collect-remonterrace.plist.template        ← 지금 도는 1회판 (불변)
  com.soransoran.navercafe-collect-remonterrace-multi.plist.template  ← 다회 준비판
  com.soransoran.navercafe-collect-wgang.plist.template               ← 지금 도는 1회판 (불변)
  com.soransoran.navercafe-collect-wgang-multi.plist.template         ← 다회 준비판
```

다회판은 **Label · 로그 파일이 다르다** — 같은 job 을 덮어쓰지 않는다.
올릴 때는 다회판을 render·load 하고 1회판을 unload 한다(README 교체 절차).
🔴 `launchctl list` 실측: 지금 올라와 있는 것은 여전히 `remonterrace` · `wgang` · `supply-autopilot` **3개뿐**이다.

---

## §5 d10 dry-run 준비도

### capacity 와 release 는 여전히 분리돼 있다

`capacity=d10 · release=d1` → 내부 재고 목표 **140** · 공개 발행 **1**건/day.

### 인원별 (후보 140건 · Pool 유효 카드)

```
19명 (옛 Pool)  → 14일 139/140 · 공백 0일   🔴 미달 — 여유가 없었다
20명            → 140/140                    🟢 READY
24명 (Wave4 후) → 140/140 · 공백 0일         🟢 READY
```

### pause 시 자동 감속

```
24명 → 23 → 22 → 21 → 20   d10 유지 (여유 4명)
19명                        🔴 d10 139/140 → **자동으로 d5 로 감속**
```

### 승격·감속 조건 — 화면과 JSON 이 같은 값을 낸다

```
지금 올릴 수 있는 최고 단계: d1
  🟢 d1   승격 가능
  🔴 d3   승격 조건 — 재고 +28건 (지금 14 / 필요 42) · 발행 여력 +28건 · 공백 9일 해소
  🔴 d5   승격 조건 — 재고 +56건 (지금 14 / 필요 70) · 발행 여력 +56건 · 공백 11일 해소
  🔴 d10  승격 조건 — 재고 +126건 (지금 14 / 필요 140) · 발행 여력 +126건 · 공백 12일 해소
🔴 감속 조건은 같은 표의 뒤집음이다 — ready 였던 단계가 아니게 되면 내려간다
```

🔴 재고는 있는데 못 내는 경우는 **인원·생활사 조합 문제**라고 따로 적는다 —
할 일이 완전히 다르기 때문이다.

---

## §6 실제 활성화 순서 (이 PR 에서 실행 0)

```
① wave3 생성·seed·활성화      11명   🔴 별도 승인
② wave4 생성·seed·활성화       5명   🔴 별도 승인 · wave3 선행
③ 82cook 신규 유입 실측        회차별 목록 스냅숏을 시각과 함께 남긴다   🔴 선행 필수
④ 수집 다회 전환               다회판 render·load + 1회판 unload   🔴 별도 승인 · ③ 선행
⑤ 82cook 독립 job 등록                                              🔴 별도 승인 · ③ 선행
⑥ 재고를 140건까지 축적        ④⑤가 선행                          자동
⑦ 단계 전환                    GitHub vars 두 줄                   🔴 별도 승인
⑧ 슬롯 확장                    auto-publish.yml cron               🔴 별도 승인
```

🔴 ③ 이 없으면 ④⑤ 는 **놓치는지 알 수 없는 계획**이다. 그래서 순서를 앞으로 옮겼다.
🔴 ⑦ 을 해도 **준비도가 미달이면 러너가 스스로 내려간다.** 그것이 이 구조의 목적이다.

---

## §7 advice · caution — 🔴 이번 PR 에서 전면 해제하지 않는다

Pool 카드는 `advice(의료)` 처럼 **영역을 한정해** 적는 경우가 많은데, 파서는 역할 이름만 읽어
`advice` 전면 금지로 기록한다. 안전한 쪽 오차다.

**이번 PR 은 그것을 그대로 둔다.** 지금 상태에서

```
advice 를 맡을 수 있는 카드   0명   ← P21~P25 도 금지를 그대로 물려받았다
caution 를 맡을 수 있는 카드  0명
안전 필터 medicalClaim        의료 단정·시술 유도 → hold (이번 PR 이 건드리지 않았다)
```

🔴 **의료 · 법률 · 재무 단정 조언 차단은 유지한다.** Pool §5-1 ②와 §6-1
(건강 축 `전원 advice · information` 금지 · 돈 축 `전원 advice(재무)` 금지)이 정본이고,
지금의 전면 금지는 그 셋을 한꺼번에 덮는다.

### 다음 Conversation 작업 (이 PR 밖)

`advice(의료)` 처럼 **scoped 금지**를 파서가 그대로 읽어, 의료·법률·재무만 막고
생활 정보 조언은 여는 전환. 🔴 이것은 **창업자 결정 사항**이며 다음 Conversation 에서 다룬다.

```
필요한 것  ① 파서가 괄호 안 영역을 읽어 { role, scopes } 로 보관
           ② 매칭이 글의 주제 축과 scopes 를 대조
           ③ 안전 필터의 medicalClaim 과 겹치는 구간 정리
           ④ 풀기 전후의 Pool 축 두께 재측정
전제       ①~④ 가 끝나기 전에는 **전면 금지를 유지한다**
```

---

## §8 검증

🔴 **pass 개수를 문서에 박지 않는다.** 검사를 하나 더할 때마다 낡고, 낡은 숫자는
다음 사람이 "왜 다르지" 를 먼저 의심하게 만든다. **0 fail 이 계약이고 총계는 실행이 답한다.**

```bash
npm run d10:prep-check           # 0 fail
npm run scale:foundation-check   # 0 fail
npm run supply:health-check      # 0 fail
npm run supply:forecast-check    # 0 fail
npm run launchd:template-check   # 0 fail
npm run master:doc-check         # 0 fail
npm run collect:guard-lock-check # 0 fail — 🔴 실제 프로세스 경쟁
npx tsc --noEmit && npm run typecheck:ops && npx eslint . --ext .ts,.tsx,.mts && npm run build
git diff --check
```

🔴 **결함을 일부러 주입해 전부 FAIL 하는 것을 확인했다.** (묶음은 아래 표)

| 묶음 | 재주입 |
|---|---|
| 시간축 | 지평을 오늘 자정으로 · 지평 대신 다음 슬롯 · 지평 불일치 검사 무력화 |
| Gate ⑥-B | salt 를 `loadEnvLocal` 앞으로 · 세 호출 중 하나에서 `hashOf` 빼기 |
| 82cook 사실 | 페이지 크기를 1,147 로 · 성공률 100% 로 · 유입을 근거 없이 20건/h · 유효 처리량에서 성공률 제거 |
| 준비도·보호장치 | 여유 30%→90% · 처리량 미달 사유 삭제 · 403 임계 5회 · 403 을 쿨다운으로 해제 · backoff 고정값 · 403 재시도 허용 · 예산 검사 제거 · 자정에 차단기 초기화 · 수집기에서 보호장치 우회 · 미측정 유입을 무한대로 |
| freshness | 시각 미상을 warm 으로 · unknown 을 자동 대상으로 · 상한 복구 TTL 면제 · `'설'` 부분 문자열 복귀 · 러너 `fitScore` 제거 · 상시 정렬에서 적합도 무시 |
| 닉네임 | 길이 상한 6자 복귀 · dry-run 코드→이름 표 제거 |
| advice | 새 카드에서 금지 해제 · 이월 절 삭제 · 차단 유지 문구 삭제 · 전면 해제 금지 문구 삭제 |

> 🔴 처음 재주입에서 **3건이 통과해 fixture 를 보강했다** —
> ① `hashOf` 를 한 호출에서만 검사하고 있었다(나머지에서 빼도 통과) →
>    세 호출 **전부**가 넘기는지 본다.
> ② 처리량이 필요량에 못 미치는 것과 여유가 모자란 것을 같은 문구로 읽고 있었다 →
>    **부족분(62건)** 을 숫자로 확인한다.
> ③ advice 이월 기록을 제목만 바꿔도 통과했다 →
>    **절 제목 · 전제 ①~④ · "전면 금지를 유지한다"** 를 함께 본다.

### 운영 불변 (이 PR 이 건드리지 않은 것)

```
DB before/after   users 12 · personas 8 · posts 40 · comments 26 · queue 24 ·
                  activity 6 · raw 58 · audit 37   → 🔴 완전 동일 (write 0)
launchctl         remonterrace · wgang · supply-autopilot  → 🔴 3개 그대로
운영 중 1회 템플릿  5개 불변 · auto-publish.yml cron 불변
GitHub Variables  변경 0 · .env 변경 0 · persona 생성·활성화 0 · 발행 0
82cook / Naver    live 요청 0 (수집기는 코드만 고쳤고 실행하지 않았다)
```

---

## §9 정본 반영 완료 — MASTER-OPERATING-SYSTEM.md

🔴 **PR #482 가 merge 되어 `docs/operations/MASTER-OPERATING-SYSTEM.md` 가 `main` 에 있다.**
예전 §9 는 "merge 되면 반영할 것" 이라는 delta 표였다. **그 표는 실제로 반영했으므로 지웠다** —
미반영 작업처럼 남겨 두면 다음 사람이 같은 일을 다시 한다.

반영한 절:

| MASTER 절 | 내용 |
|---|---|
| §8.0 | 수집 능력 **current 20 / prepared 320 / required 382** · 여유 기준 546 · d10 BLOCKED |
| §8.2 | 발행 후보 준비가 러너·관제·예측·준비도의 **단일 계약**이라는 것 · hold 3종 · 우선순위 |
| §8.3 | 차단기 상태 전이(half-open 재실패 포함) · 403 사람 해제 절차 · 잠금 |
| §10.1 | 도서관/스타벅스 관측 · 단정 금지 · 도서관 live 금지 · 403≠TCP |
| §10.3 | 활성화 선행 조건 9개의 현재 상태 표 (구현 6 · 미해결 3) |

`npm run master:doc-check` 가 그 문서를 검사한다(#482 가 가져온 CI 항목).

---

## §10 82cook 네트워크 관측 (2026-09-08)

망을 바꿔 가며 **같은 Mac · 같은 코드**로 확인했다.

| 네트워크 | 82cook 접속 |
|---|---|
| 도서관 Wi-Fi | 🔴 실패 — HTTP·HTTPS 모두 **TCP 연결 단계** |
| 스타벅스 Wi-Fi | 🟢 정상 |
| 집 Wi-Fi | 🟢 정상 |

### 결론

- **전역 차단 · 기기 차단 · 계정 차단 가능성은 낮다** — 같은 기기·같은 코드가 두 망에서 정상이었다.
- **도서관 공인 IP · 방화벽 · DNS · 라우팅 등 네트워크 경로 문제 가능성이 높다.**
- 🔴 **정확한 원인은 미확정이다.** 위 둘은 가능성의 크기이지 확정이 아니다.
- 🔴 **도서관 Wi-Fi 에서는 82cook live 수집을 하지 않는다.**

🔴 **403 과 TCP 를 같은 원인으로 합치지 않는다.**

| | 뜻 | 재시도 | 차단기 | 해제 |
|---|---|---|---|---|
| `403 FORBIDDEN` | 상대가 우리를 알아보고 막았다 | 🔴 하지 않는다 | 1회에 open | 🔴 사람 확인 |
| `TCP NETWORK` | 연결 자체가 안 됐다 (우리 망일 수도) | 3회 (5s→2m) | 5회에 open | 쿨다운 10분 |

합쳐서 세면 403 을 다섯 번 맞을 때까지 두드리게 되고, 도서관 망 문제를 차단으로 오해하게 된다.
Playwright timeout 도 `NETWORK` 으로 분류한다 — 응답을 못 받은 것이지 거절당한 것이 아니다.

🔴 **핫스팟 확인을 필수 다음 단계로 두지 않는다.** 같은 Mac에서 정상 망 두 개
(스타벅스 · 집)를 이미 확인했으므로 기기·계정·전역 차단은 사실상 배제됐다.
핫스팟은 같은 종류의 관측을 하나 더 얻을 뿐이고, 그것이 없어서 다음 작업이 막히지 않는다.

원인을 좁히려면 **도서관 망 자체를 보는 관측**이 필요하다 —
공인 IP · 방화벽 · DNS 응답 · 경로 추적. 그 전까지 정확한 원인은 미확정이다.

🔴 VPN · 프록시 · UA 위장 · IP 회전으로 우회하지 않는다.

---

## §11 `sourceCapturedAt` 은 게시 시각이 아니다

🔴 **"우리가 그 글을 본 시각" 이다.** 수집기가 목록·상세를 연 순간을 적는다.
원문 게시 시각은 지금 어느 수집원에서도 가져오지 않는다.

freshness TTL 은 이 값을 **관측 시각 proxy** 로 쓴다. 그래서

- 오래된 글을 오늘 처음 수집하면 우리 기준으로는 "갓 들어온 글" 이다
- 즉 **완전한 실시간성 보장이 아니다** — "수집 후 며칠 지났는가" 를 보장할 뿐이다
- 게시 시각을 수집하기 전까지 이 한계를 그대로 안고 간다.
  문서에 "최신 글만 나간다" 고 적지 않는다

`sourceCapturedAt` 이 없는 행은 나이를 알 수 없으므로 `AGE_UNKNOWN` 으로 hold 한다(fail-closed).

---

## §12 회수 잠금(reaper) 이 남았을 때 — 🔔 사람이 복구한다

🔴 **자동으로 회수하지 않는다.** 시효가 지났다는 이유로 reaper 를 뺏으면
그 "뺏는 판정" 자체가 다시 경쟁이 되어 두 프로세스가 같이 들어간다.
2026-09-09 강제 안무 재현에서 `MAX_CONCURRENT=2` 가 나온 자리가 정확히 여기다.
근거와 불변식: MASTER §8.4 · `scripts/lib/collect-guard-store.mts` 머리 주석.

### 언제 알게 되는가

- `npm run collect:guard-status` 에 `🔔 회수 잠금(reaper) 남음` 줄이 뜬다
- 수집 job 이 `보호장치 잠금을 …ms 안에 얻지 못했다` 로 끝나고,
  그 오류에 남은 reaper 경로와 아래 절차가 함께 찍힌다

### 증상

해당 source 의 수집이 **멈춘다**(fail-closed). 요청은 나가지 않는다 —
데이터가 틀어지는 사고가 아니라 공급이 서는 사고다. 서둘러 지우다 두 주인을 만드는 것보다 낫다.

### 복구 절차 (순서를 지킨다)

1. **이 source 의 수집 job 을 전부 멈춘다.**
   `launchctl list | grep soransoran` 로 걸린 job 을 확인하고, 도는 것이 없을 때까지 기다린다.
   🔴 job 이 도는 채로 지우면 지금 정상적으로 쥔 프로세스의 reaper 를 뺏는 것이다.
2. **소유 프로세스가 없음을 확인한다.**
   `cat .microseed-data/collect-guard-<source>.json.reap` 의 `pid` 를 `ps -p <pid>` 로 확인한다.
   살아 있으면 **지우지 않는다** — 끝날 때까지 기다린다.
3. **그 뒤에만** `.microseed-data/collect-guard-<source>.json.reap` 을 지운다.
4. 남아 있는 `…json.lock` 도 같은 조건에서 함께 지운다(주인이 없어야 한다).
5. `npm run collect:guard-status` 로 이상이 사라졌는지 확인하고 job 을 다시 켠다.

🔴 이 PR 에서는 job 정지·파일 삭제·live 수집을 **하지 않았다.** 절차만 적었다.

---

## §13 상태 write fencing — 승계당한 옛 주인은 쓰지 못한다

🔴 **2026-09-09 재현**: 잠금을 "쥐었었다" 는 사실만 보고 쓰던 판은
승계당한 옛 owner 의 write 를 받아들였다(`staleOwnerWriteAccepted = true`).
근거·불변식: MASTER §8.5.

### 운영에서 무엇이 달라지나

- 상태를 쓰는 길은 `saveGuard` 하나뿐이고, write 직전에 **새 reaper 를 `wx` 로 얻어**
  실제 잠금의 token 이 내 것인지 확인한다. 아니면 **쓰지 않고 던진다**(fail-closed).
- 그래서 다음 오류는 **정상 동작**이다 — 데이터가 틀어진 것이 아니라 틀어지는 것을 막은 것이다.
  - `… 잠금이 이미 다른 프로세스(pid N)에게 넘어갔다 — 승계당한 옛 주인은 상태를 쓰지 않는다`
  - `… 상태를 저장할 회수 잠금을 얻지 못했다 — 쓰지 않는다(fail-closed)`
  - `… 잠금을 확인할 수 없다 (absent|unreadable|opaque) — 상태를 쓰지 않는다(fail-closed)`
- 이 오류가 **반복**되면 그 회차의 수집이 계속 비는 것이므로 §12 의 reaper 이상부터 확인한다.

### 잠금 안에서 하면 안 되는 것

🔴 **잠금 안에서 `await` 하지 않는다.** 네트워크·대기·브라우저 조작은 잠금 **밖**이다.
`withGuardLock` callback 이 Promise 를 돌려주면 실행 중에 던진다 —
TTL 을 넘긴 옛 callback 이 회수 뒤에 돌아와 부작용을 만드는 경로를 원천 차단한다.

🔴 이 PR 에서 job 정지·파일 삭제·live 수집은 **하지 않았다.** 계약과 절차만 적었다.

---

## §14 Scale Activation Wave A — 🔴 activate 에서 멈춤 (2026-09-09)

### 무슨 일이 있었나

Wave A(persona 24명)를 실행하다 **wave3-scale 11명 activate 에서 멈췄다.**

```
create  ✅ 커밋   User 12→23 · Persona 8→19(draft) · AuditLog 37→59
seed    ✅ 커밋   11명 draft-seeded · AuditLog 59→70
activate 🔴 2회 연속 실패 — 전원 롤백(write 0)
```

원인은 **Prisma interactive transaction 기본 마감 5초**다.
회차 전원을 한 트랜잭션으로 묶는 계약이라 왕복이 인원에 비례하는데,
이 환경의 DB 왕복은 **220~290ms** 였다. 11명 activate 는 사람마다 3왕복(33왕복)이라
5초를 넘겼고 `Transaction not found ... refers to an old closed transaction` 으로 끝났다.

🔴 read-only 재현(write 0): 같은 DB에서 `$transaction` 안에 33왕복을 넣으면 **5,718ms 에서 실패**하고,
같은 프로세스의 두 번째 트랜잭션(44왕복)은 2,254ms 에 끝난다 — 콜드 스타트가 겹치면 넘어간다.

### 지금 상태 (안전)

- 🟢 데이터는 안전하다. **부분 활성화 0** — 11명 전부 `draft` · `activatedAt` null · `status_changed` 0.
- 🟢 기존 8명은 그대로 active 이고 값도 불변이다.
- 🟢 Post · Comment · Queue · ActivityLog · RawContent 불변. 공개 발행은 계속 d1.
- 🔴 **wave4-depth 는 시작하지 않았다** — wave3 가 끝나야 시작한다는 계약을 지켰다.

🔴 **이 상태를 임의로 되돌리지 않는다.** `draft-seeded` 는 안전한 중간 상태이고,
수동 status 변경·Raw SQL·직접 보정은 하지 않는다.

### 복구 순서 (수정 PR merge 뒤)

```bash
# 1. 지금 상태 확인 — 11명이 draft-seeded 그대로인지
npm run persona:cohort-run -- --cohort=wave3-scale --step=check

# 2. activate (create·seed 는 다시 하지 않는다 — 이미 커밋됐다)
ACTOR_USER_ID=<admin id> npm run persona:cohort-run -- \
  --cohort=wave3-scale --step=activate --apply --limit=11 --reason "..."
npm run persona:cohort-run -- --cohort=wave3-scale --step=check

# 3. wave3 가 전원 active 로 검증된 뒤에만 wave4
npm run persona:cohort-run -- --cohort=wave4-depth --step=create   # 이하 동일 순서
```

🔴 `--step=create` 를 다시 돌리면 "이미 존재" 로 막힌다. 그것이 정상이다.

---

## §15 Scale Activation Wave A 완료 — Persona 24명 active (2026-09-09)

> 🔴 아래는 **2026-09-09 실행 시점의 운영 데이터 순간값**이다. 고정 계약이 아니다.

§14 에서 멈췄던 wave3 activate 를 PR #485 merge 뒤 이어서 완료하고, wave4 까지 마쳤다.

### 실행 결과

| 회차 | 대상 | create | seed | activate |
|---|---|---|---|---|
| wave3-scale | 11명 | ✅ | ✅ | ✅ (재개 1회 성공) |
| wave4-depth | 5명 | ✅ | ✅ | ✅ |

배정된 표시명 — Gate ⑥-B 전원 pass (회원 표시명 25 · authorHash 17,992 · norm 17,945 대조)

```
P03 골목   P04 창가   P06 그늘   P08 갈대
P12 봉숭아  P13 민들레  P14 마루   P16 자락
P18 조약돌  P19 들국화  P20 산딸기  P21 제비꽃
P22 달맞이  P23 물봉선  P24 노루귀  P25 패랭이
```

P09 는 정본에 따라 **제외 상태를 유지**한다.

### DB before/after

| | before | after |
|---|---|---|
| User | 12 | **28** |
| Persona | 8 | **24** (active 24 · draft 0) |
| PersonaAuditLog | 37 | **101** |
| Account | 3 | **3** (신규 16명 전원 0) |
| Post · Comment · Queue · ActivityLog · Raw | 42 · 26 · 24 · 7 · 58 | **동일** |

persona 별 분포도 확인했다 — 신규 16명 각각 `created` 1 · `display_name_assigned` 1 ·
`updated`(seed) 1 · `status_changed` 1(draft→active · actorUserId·reason 있음).
기존 8명은 status·값·AuditLog 건수 불변.

### 활성화가 실측에 반영된 것

| | before | after |
|---|---|---|
| activePersonas | 8 | **24** |
| theoreticalPerWeek | 8 | **24** |
| effectivePerDay | 1.02 | **2.85** |
| personas shortfall | 0 | **0** |

### 🔴 공개 발행은 여전히 d1 이다

`capacity=d1 · release=d1` 그대로다. 이번 작업은 **켠 것이지 내보낸 것이 아니다** —
발행은 auto-publish 러너가 스케줄에 따라 한다. 실제 발행 0 · Comment 0 · Raw/Queue 0.

### d10 readiness — 억지로 READY 로 만들지 않는다

- `persona:capacity-planner` — **NOT_READY**. d1 조차 14일 12/14건(2건 미달 · 공백 2일).
  🔴 **원인은 인원이 아니라 재고다** — 재고 13/14 (inventory-limited).
- `supply:health` collect readiness — start · stable 모두 **BLOCKED**
  - 82cook `com.soransoran.raw-collect-82cook` **미등록** (현재 0건/day)
  - 카페 2개가 계획된 다회 job 이 아니라 1회판이다 (현재 각 10건/day)
  - current 20 · prepared 320 · required 6(여유 기준 9) — 등록 2/3
  - 통과율(judgePass · draftPass) 실측 없음

즉 **다음 병목은 인원이 아니라 재고와 수집 능력**이다.

### 다음 단계

`Scale Activation Wave B — 다회 수집 활성화와 재고 확장`.
🔴 이번 PR 에서 launchctl 등록·cron·env·GitHub Variables·capacity/release 승격은 **하지 않았다**.

---

## §16 Scale Activation Wave B — 다회 수집 활성화와 재고 확장 (2026-09-09)

> 🔴 아래 숫자는 **실행 시점의 운영 데이터 순간값**이다. 현재값 정본은 MASTER §6.3.

### 구현 / 설정 / 가동 / 관찰

| | 상태 |
|---|---|
| 구현 | 다회 job 템플릿·schedule 계약은 이미 main 에 있었다 |
| 설정 | 🟢 single 2개 → **multi 4회/day 2개** 로 교체 · `SORAN_CAPACITY_STAGE=d3` |
| 가동 | 🟢 사전 live 검증 2 source · 공급 회차 1회 수동 실행 |
| 관찰 | 🔴 **아직 없다** — 첫 자동 회차(02:50 wgang · 04:20 remonterrace)를 봐야 한다 |

### A. source 사전 검증 (`--pages=1 --max=3 --thin --live`)

| source | 목록 | 상세 | thin | 판정 |
|---|---|---|---|---|
| remonterrace | 23건 | 3건 | 2건 | 🟢 통과 |
| wgang | 21건 | 3건 | 3건 | 🟢 통과 |

403·429 0 · 차단기 전부 closed · 세션 정상(우나어 재사용 아님) ·
thin 파일에 전문 없음(`bodyHead` 최대 300자, `body`/`rawBody` 컬럼 없음).

### B. launchd 전환

```
before  navercafe-collect-remonterrace        1회/day 09:20
        navercafe-collect-wgang               1회/day 13:20
after   navercafe-collect-remonterrace-multi  4회/day 04:20 · 10:20 · 16:20 · 22:20
        navercafe-collect-wgang-multi         4회/day 02:50 · 08:50 · 14:50 · 20:50
        supply-autopilot                      21:10 (변경 없음)
```

🔴 source 마다 **unload → load 순서**로 바꿔 old/new 가 동시에 loaded 인 순간을 남기지 않았다.
설치본은 템플릿과 치환값 외 차이 0 · `plutil -lint` PASS · placeholder 0.
옛 single plist 파일은 **지우지 않고 남겼다**(롤백용, loaded 아님).
🔴 안정 단계 8회/day 로 올리지 않았다.

### C. 수집 능력

```
현재  20건/day → 80건/day   (remonterrace 4회 40 · wgang 4회 40 · 82cook 0)
```

### D. 공급 회차 1회 (수동)

`collect` 는 82cook 이 막혀 **건너뛰고**, 나머지 5단계가 돌았다. checkpoint `done`.

```
재고    13 → 25 (목표 42)     구성 사람 3 · 기계 22 · legacy 5
판정    SEED 33 · HOLD 88 · DROP 35      생성 채택 22 · 적재 12
LLM     Haiku 호출 6건
Raw     58 → 70              Queue 24 → 36
Post    42 → 42 ✅ 불변       Comment · Persona · Account 불변
```

🔴 재고가 42 에 못 미쳐도 **반복 실행하지 않았다.** 21:10 정기 회차가 이어받는다.

### E. 82cook 관측 — 🔴 네트워크 실패 (403 아님)

이 망에서 `www.82cook.com:443` 이 **12ms 만에 연결 거부**됐다(`ECONNREFUSED`).
기존 CLI 가 `--list --pages=1` + `--fetch`/`--auto` 없음이면 **상세 요청 0** 을 보장하는 것을
코드로 확인한 뒤 목록 1페이지 snapshot 을 1회 시도했고, `robots.txt` 단계에서 끝났다.

- 보호장치 분류 **NETWORK** (연속 3회 · 차단기 closed) — 🔴 **403 과 합치지 않는다**
- IP·프록시·VPN 우회 **하지 않았다**
- 🔴 `--auto --auto-max=30` 10슬롯 job 은 **등록하지 않았다**
- 새 유입량 관측은 **아직 시작하지 못했다** — 82cook 에 닿는 망에서 다시 시도한다

### F. 이번에 드러난 코드 결함 3종 (같은 PR 에서 수정)

1. **한 source 의 장애가 전체 공급을 세웠다.** `collect` 가 첫 단계라 82cook 실패로
   뒤 단계를 전부 건너뛰었고, 받아 둔 네이버 thin 이 그대로 묵었다.
   → 네트워크 단계가 **이번 회차에 실제로 source 차단을 겪었을 때만** 그 단계를 `skipped` 로
   남기고 로컬 단계는 계속한다. 건너뜀은 성공이 아니라 다음 회차가 다시 시도한다.

   🔴 **판정은 "실행 전후 보호장치 지문 대조" 다** (첫 판을 Codex 가 잡아 고쳤다).
   첫 판은 실행 **후** 스냅숏만 보고 `consecutive > 0` 이면 차단이라고 했는데,
   82cook 은 도서관 Wi-Fi 의 `ECONNREFUSED` 로 **연속 3회 기록이 남아 있다.**
   그 상태에서는 설정 오류·코드 오류·spawn 오류까지 전부 "82cook 장애" 로 읽혀
   **DB write 단계까지 그대로 진행**된다(실측 재현: guard 불변 · exit 1 → `sourceBlocked=true`).

   지금 계약:

   🔴 **2차 오판도 있었다**(Codex 재지적): 전후를 `status:count:time` **문자열로** 비교하니
   `closed:3:-` → `closed:0:-`, 즉 **수집이 성공해 연속 실패가 초기화된 것**까지
   "달라졌으니 실패" 가 됐다. 그래서 값을 값으로 들고 **방향**을 본다.

   | 상황 | 판정 |
   |---|---|
   | `spawnError` (프로세스가 뜨지 못함) | 🔴 **STOP** — guard 상태와 무관하다 |
   | guard 없음·손상 | 🔴 **STOP** (fail-closed) |
   | 실행 **전부터** breaker `open` 또는 예산 소진 | 🟡 SKIP — 자식을 **띄우지도 않는다** |
   | 실행 전 `half-open` | 🔴 사전 SKIP 하지 않는다 — 복구 시험이므로 실제로 두드려 본다 |
   | remote 분류가 **실패 방향**으로 이동 (연속 증가 · openedAt 생성/전진 · closed→open) | 🟡 SKIP |
   | **복구 방향**으로 이동 (연속 감소·0 초기화 · open→closed) 뒤 exit 1 | 🔴 **STOP** — 수집은 됐고 그 뒤가 틀렸다 |
   | 전후 지문 **동일** | 🔴 **STOP** |
   | `OTHER` 분류만 움직임 | 🔴 **STOP** — 원인 불명을 남의 서버 탓으로 돌리지 않는다 |

   🔴 82cook 접속 실패 자체는 도서관 Wi-Fi 사정이다(집·핫스팟에서는 접속된다).
   IP 우회도 82cook 수집 정책 변경도 하지 않았다 — 고친 것은 **실패 원인 판정**뿐이다.
2. **목표 42 로 올리자 적재가 영영 0이 됐다.** 러너가 부족분(29)을 `--limit`(정확히)으로
   요구하는데 한 회차 후보는 몇 건뿐이다. → 자동 경로용 `--up-to`(상한까지)를 나눴다.
   사람이 주는 `--limit` 의 "정확히" 계약은 그대로다.
3. **러너 최종 정합이 목표를 14 로 봤다.** capacity 목표를 `verifyRun` 에 넘기지 않아
   정상 적재를 "목표 초과" 로 잘못 경고했다. → `CAPACITY_LIMITS.target` 을 넘긴다.

### F-b. launchd 는 **현재 checkout 을 직접 실행한다**

🔴 앞선 보고에서 "merge 전이면 옛 코드가 돈다" 고 적은 것은 **틀렸다.** plist 의
`ProgramArguments` 는 `/Users/yanadoo/Documents/soransoran-m0/scripts/supply-autopilot.mts` 를
가리킨다 — `origin/main` 이 아니라 **그 순간 checkout 된 작업 트리 파일**이다.
따라서 21:10 회차는 merge 여부가 아니라 **그때 어느 브랜치가 checkout 돼 있는가**로 정해진다.

### G. 다음 자동 회차와 관찰 항목

```
02:50 wgang-multi · 04:20 remonterrace-multi · 21:10 supply-autopilot
```

- 다회 job 이 실제로 4회 다 도는가 (`~/Library/Logs/soransoran/*-multi.log`)
- 네이버 예산·차단기 (`collect:guard-status`) — 4배로 늘어난 요청에서 403·429 가 없는가
- 재고가 25 → 42 로 차는가 · `fill` 이 `--up-to` 로 부분 적재를 잇는가
- 82cook 은 닿는 망에서 다시 관측
- 🔴 공개 발행은 계속 1/day 인가

🔴 이 PR 에서 launchctl 은 **이번 전환분 외에 건드리지 않았고**, cron·GitHub Variables·
release 단계·82cook job 등록은 하지 않았다.

---

## §17 예약 실행 격리 — runtime worktree (2026-09-09)

### 왜 했나

launchd 가 **개발 작업트리를 직접 실행**하고 있었다. plist 가
`~/Documents/soransoran-m0/scripts/*.mts` 를 가리켰고, 그 경로는 `origin/main` 이 아니라
**그 순간 checkout 된 파일**이다 — 개발자가 브랜치를 바꿔 두면 밤 예약 회차가 그 코드로 돈다.
Wave B 작업 중 실제로 그 상태로 21:10 을 맞을 뻔했다.

### 구조

```
~/Documents/soransoran-runtime          예약 실행 전용 worktree (detached · main 계보 고정 SHA)
  ├─ node_modules                       🔴 자체 설치 — 개발 트리와 공유하지 않는다
  ├─ .env.local        ─┐
  └─ .microseed-data   ─┤ 심볼릭 링크
                        ↓
~/Library/Application Support/soransoran/
  ├─ env.local                          비밀 정본 (평문 복제 0)
  ├─ microseed-data/                    상태 정본 (보호장치·checkpoint·thin)
  └─ runtime-pinned-sha                 무엇을 돌리기로 했는지
~/Library/Logs/soransoran/              로그 (Documents 밖)
```

🔴 **코드는 나누고 상태는 하나로 둔다.** 보호장치 예산·차단기는 source 하나당 **원장 하나**여야 한다.
worktree 마다 따로 두면 같은 사이트를 하루에 두 배로 두드린다.
그래서 데이터·비밀은 두 worktree **밖**에 두고 양쪽이 같은 실체를 가리킨다.

### 전환 순서 (실행한 그대로)

1. `git worktree add --detach ~/Documents/soransoran-runtime <검증된 origin/main SHA>`
2. `npm ci` + `npx prisma generate` — 🔴 runtime 이 혼자 돌 수 있어야 한다
3. `.microseed-data` 를 정본 위치로 **이동**하고 양쪽에 심볼릭 링크 (파일 178개 그대로)
4. `.env.local` 도 같은 방식 (sha256 동일 · 평문 복제 0)
5. 템플릿을 `__REPO__=runtime` 으로 render → `plutil -lint` → placeholder 0 · 개발 경로 참조 0
6. **source 마다** unload → 내려간 것 확인(0) → load → 올라온 것 확인(1)
   🔴 old/new 가 동시에 loaded 인 순간을 만들지 않는다
7. 고정 SHA 를 `runtime-pinned-sha` 에 적는다

### 되돌리기

옛 plist 는 `/tmp/<label>.plist.rollback` 에 두었고, 언제든
`launchctl unload → cp rollback → launchctl load` 로 개발 트리 실행으로 돌아간다.
🔴 다만 그것은 **이 §17 이 없애려던 상태**다 — 되돌린다면 이유를 남긴다.

### 정본 권한 (2026-09-09 강화)

```
~/Library/Application Support/soransoran   700
  ├─ env.local                             600
  └─ microseed-data/                       700
```

🔴 심볼릭 링크가 아니라 **최종 실체**의 권한을 본다. group/other 비트가 하나라도 서 있으면
`--require-runtime` 에서 FAIL 이다 — 비밀이 644 면 같은 기계의 다른 계정이 읽고,
상태가 755 면 남이 보호장치 예산을 지울 수 있다. 🔴 값·해시는 로그에 찍지 않는다.

### 배포 기록 (manifest)

`~/Library/Application Support/soransoran/runtime-manifest.json` — `sha` · `deployedAt` ·
통과한 게이트 · 직전 SHA. **원자적으로**(tmp → rename) 쓴다.
공급 회차 checkpoint 에도 그 회차가 돈 `runtimeSha` 를 남긴다.
🔴 **전환 이후 회차인데 `runtimeSha` 가 없으면 Wave C 증거가 아니다** — 없는 것을
"옛 회차일 수도 있으니" 라며 통과시키지 않는다(전환 이전 회차는 `deployedAt` 에서 이미 걸러진다).

### 배포 도구 — `npm run runtime:deploy`

기본은 dry-run. `--apply --target=<40자리 SHA>` 만 실제로 바꾼다.
🔴 **배포 잠금이 하나 있다.** 두 배포가 겹치면 어느 SHA 가 올라갔는지 알 수 없다 —
잠금을 잡지 못하거나 잠금 상태를 읽지 못하면 들어가지 않는다(fail-closed).

막는 것: 축약 SHA · 방금 fetch 한 origin/main 과 다른 SHA · main 계보 아님 ·
runtime dirty · 실행 중 job · 상태를 읽지 못함(fail-closed).

#### 🔴 배포 순서 (이 순서여야 하는 이유가 각각 있다)

1. 배포 잠금을 잡는다
2. `git fetch` — 🔴 **실패하면 그 자리에서 멈춘다.** 오래된 ref 로 "최신" 을 판단하지 않는다
3. preflight 게이트 · 직전 SHA·manifest 보존
4. job 3개 unload — 🔴 **하나씩 실제로 내려간 것을 확인**한다. 하나라도 실패하면
   이미 내린 것만 다시 올리고 **코드는 건드리지 않은 채** 멈춘다
5. `git checkout --detach <target>` · `npm ci` · `prisma generate`
6. **offline 게이트** — `supply:autopilot-check` · `collect:guard-lock-check` · `launchd:template-check`
7. manifest·pin 준비 → job 3개 load → 🔴 **하나씩 올라온 것을 확인**
8. 🔴 **실제 loaded 설정 대조** → `runtime:isolation-check --require-runtime`
9. 여기까지 통과해야 "배포 완료" 다

#### 🔴 launchctl 상태는 세 가지다 — loaded / unloaded / unknown

`launchctl print` 실패를 곧바로 "내려가 있다" 로 읽으면, 권한 오류·도메인 오류·명령 실패가
전부 "확인했다" 가 된다. **`unloaded` 로 인정하는 근거는 하나뿐이다** —
launchctl 이 그 이름의 서비스를 도메인에서 **찾지 못했다고 말한 경우**.

| 실측(macOS 15.6 · `gui/501`) | 판정 |
|---|---|
| exit 0 | `loaded` |
| exit 113 · `Could not find service "…" in domain` | `unloaded` |
| exit 125 · `Could not print domain: … Domain does not support specified action` | `unknown` |
| 명령 자체를 못 돌림 | `unknown` |

exit code 만으로 가르지 않는다 — 113 은 넓은 "Bad request" 계열이라 다른 이유로도 나온다.
`unknown` 은 **모든 단계에서 fail-closed** 다: preflight 의 실행 여부 확인, unload 뒤 확인,
load 뒤 확인 어디서든 통과가 아니다.

#### 🔴 runtime 아래여야 하는 것은 program 과 WorkingDirectory 뿐이다

정상 `launchctl print` 출력에는 runtime 밖 경로가 셋 들어 있다 —
plist(`~/Library/LaunchAgents/…`) · `stdout path` · `stderr path`(`~/Library/Logs/soransoran/…`).
"soransoran 이 들어간 경로는 전부 runtime 밑" 이라는 규칙은 **정상 job 3개를 전부 실패시켰다**(실측).
판정은 `parseLaunchctlPrint` + `judgeLoadedConfig` **정본 하나**만 쓴다 —
`.mts` program 과 `working directory` 만 본다.

🔴 **`runtime:isolation-check --require-runtime` 은 6단계에 둘 수 없다.**
그 검사는 job 3개가 loaded 여야 통과하는데 그 시점에는 우리가 내려 둔 상태다 —
그 순서였던 첫 판은 정상 배포가 **구조적으로 항상 실패**했다.

#### 🔴 되돌리기는 best-effort 다

어느 단계에서 실패하든 checkout → `npm ci` → `prisma generate` → manifest/pin 복원 →
job 3개 재load 를 **끝까지 시도한다.** 한 단계가 죽었다고 뒤 단계를 건너뛰지 않는다 —
예전 판은 `npm ci` 가 죽으면 job 을 다시 올리지 못하고 3개가 내려간 채 끝났다.
직전 manifest 가 없었다면 새로 쓴 것을 **지운다**(배포하지 않았는데 기록이 남으면 안 된다).
복구 뒤 SHA·pin·manifest·의존성·loaded job 3개를 다시 확인하고,
완전하지 않으면 **무엇이 남았는지 그대로 적고 exit 1** 한다.

🔴 **복구 대상은 "성공했다고 적어 둔 목록" 이 아니라 지금의 실제 상태다.**
`launchctl unload` 가 실패를 돌려줬는데 실제로는 내려간 경우가 있다 —
성공 목록만 되돌리면 그 job 은 내려간 채 남는다. 그래서 expected 3개를 **전부 다시 관측**해
`unloaded` 인 것만 올리고, `loaded` 는 그대로 두고, `unknown` 은 복구 불완전으로 적는다.
마지막에 3개가 모두 `loaded` 인지 다시 본다.

🔴 **load 는 멱등이다.** 이미 올라와 있으면 다시 부르지 않는다 —
`launchctl load` 는 이미 loaded 인 job 에 실패를 돌려주므로, 반환값만 보면
**정상인 상태를 복구 실패로 오판**하게 된다.

🔴 **배포 잠금에는 token 을 적는다.** 무조건 `unlink` 하면 먼저 죽은 배포의 뒷정리가
그 사이 시작한 배포의 잠금을 지운다. 풀 때 파일의 token 이 내 것일 때만 지우고,
다르거나 읽지 못하면 그대로 둔다. stale 잠금 자동 회수는 하지 않는다 — 사람이 지운다.

🔴 위 문장들은 `runtime:isolation-check` 의 배포 행동 fixture A~I 가 실제로 증명한다
(가짜 명령 세계 · 실제 launchctl 0). 증명되지 않은 복구 약속은 여기 적지 않는다.

🔴 배포는 live crawl·DB write·발행·release 변경을 하지 않는다.

### 🔴 격리 ≠ 최신

| | 뜻 |
|---|---|
| **isolation** | detached · 고정 SHA · main 계보 · 추적 변경 0 |
| **promotion freshness** | runtime HEAD == 지금 **원격** `main` |

🔴 **로컬 `origin/main` 은 "지금 main" 이 아니다.** fetch 하지 않은 저장소에서는 며칠 전 ref 일 수
있고, 그러면 뒤처진 runtime 이 "최신" 으로 보인다. 그래서 Wave C 판정은 `git ls-remote origin
refs/heads/main` 으로 **원격에 직접 묻고**, 읽지 못하면 NOT_READY 로 둔다(fail-closed).
화면에는 로컬 ref 와 원격 main 을 **따로** 적어 둘이 다를 때 눈에 보이게 한다.
🔴 이것은 live crawl 도 DB write 도 아니다 — 우리 저장소의 ref 하나를 읽을 뿐이다.

runtime 이 원격 main 보다 뒤여도 **격리는 성립한다**(고정돼 있으니까). lag 는 화면에 적되
격리 실패로 세지 않는다. 다만 **Wave C 승격은 최신이 배포된 뒤에만** 허용한다 —
올리는 순간의 코드가 무엇인지 모르는 채로 공개 발행량을 늘리지 않는다.

### 검사

`npm run runtime:isolation-check`

- CI: runtime 이 없으므로 **판정 규칙만** 시험한다(관측은 건너뛴다)
- 운영 기계: `--require-runtime` 을 붙이면 **관측 없이는 통과하지 않는다**(fail-closed)

잡는 것: 개발 작업트리 실행 · 이름이 비슷한 이웃 경로 · WorkingDirectory 누락/오지정 ·
브랜치를 문 runtime · 고정 SHA 불일치 · main 계보 아님(feature branch 고정) · 계보 확인 실패 ·
옛 1회판 잔여 loaded · 중복 loaded · node_modules/Prisma 누락 · env 평문 복제 · 데이터 원장 분리 ·
🔴 **설치 plist 는 runtime 인데 실제 loaded 는 개발 경로**(`launchctl print` 대조) ·
🔴 **runtime 추적 파일 변경**(`--untracked-files=no`) · 🔴 **정본 권한 열림**.

### 실증

개발 트리를 임시 feature branch 로 바꾸고 `supply-autopilot.mts` 를 실제로 고쳐도
runtime HEAD 와 파일 해시가 **바뀌지 않았다**(`a2977dac…` 유지).

---

## §18 Wave C 준비 — 공개 d3 승격 (🔴 아직 올리지 않았다)

`npm run wave-c:readiness [-- --plan]` — read-only · DB write 0 · 승격 0.

여섯 조건을 **하나의 판정**으로 묶는다. 흩어져 있으면 사람이 "대충 됐다" 고 읽는다.

| 조건 | 2026-09-09 14시 기준 |
|---|---|
| 재고가 목표를 채웠다 | 🔴 25/42 — 17건 모자란다 |
| Naver 다회 슬롯이 계획대로 돌았다 | 🔴 0/4 · 0/4 — 전환 이후 지나간 슬롯 0개 |
| 보호장치 이상 0 | ✅ |
| 마지막 회차 checkpoint done | 🔴 **전환 이전 회차라 증거가 아니다** |
| 공개 단계가 아직 d1 | ✅ |
| 예약 실행 격리 성립 | ✅ |
| (승격 신선도) runtime == 원격 main | ✅ |

🔴 **checkpoint 는 네 가지를 함께 본다** — status=done · `runtimeSha` 가 **있고**
manifest 의 sha 와 **같고** · startedAt/completedAt 이 온전하고(순서·미래·손상) ·
그 회차가 **21:10 예약 슬롯의 회차**여야 한다. 손으로 돌린 회차는 정기 회차 증거가 아니다.

🔴 **슬롯은 "오늘 몇 번" 이 아니라 회차 증거로 센다.** 로그의 runId 시각을 읽어
**전환 이후 고유 성공 회차**를 최근 4개 예정 슬롯에 하나씩 붙인다 —
그래서 자정이 지나도 증거가 0 으로 되돌아가지 않는다.
전환 이전 회차·같은 runId 중복·시작 줄·중단 출력은 세지 않는다.

🔴 **슬롯 창은 한 방향이다** — `슬롯 시각 ≤ 회차 시각 ≤ 슬롯 + 90분`.
양쪽으로 열어 두면 13:20 에 손으로 돌린 회차가 14:50 예약 슬롯을 채운다.
슬롯보다 **먼저** 끝난 회차는 그 슬롯이 돌았는지에 대해 아무것도 말해 주지 않는다.
미래 시각 runId 와 없는 날짜(9/31 · 2/30 · 25시) runId 도 회차로 읽지 않는다.

→ **NOT_READY.** 남은 둘은 오늘 밤 자동 회차가 채울 항목이다.

🔴 **`--plan` 은 승격 절차와 롤백을 함께 낸다.** 올리기 전에 되돌리는 법부터 읽는다.
승격은 `SORAN_RELEASE_STAGE` 한 줄 + workflow 슬롯 3개이고, 롤백도 같은 두 줄이다.
🔴 이미 나간 글은 되돌리지 않는다 — 발행 취소는 회원이 본 것을 지우는 일이다.
