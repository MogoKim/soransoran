# Persona Safety / Originality Gate 설계

> 작성 2026-08-30 · 상태 **설계 확정 · 구현 미착수**
> 선행: [Persona Architecture 설계](2026-08-30-persona-architecture-design.md) · [Persona Network 전략](2026-08-29-persona-network-strategy.md)
> 상위: [Micro Seed Lane 헌법](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) §9-7 문장 지문 중복률

---

## §1 이 Gate 의 목적

### 🔴 자동 발행을 가능하게 하려는 장치가 아니다

Gate 는 **후보 생성물이 사람에게 올라가기 전에 위험을 막는 장치**다.
Gate 를 통과했다고 발행되지 않는다. **운영자 승인이 별도로 필요하다.**

```
1차 MVP    🔴 자동 발행 금지
Gate 통과  →  운영자 승인 대기열로 갈 자격을 얻은 것뿐
실패       →  재생성 (최대 3회)
반복 실패  →  폐기
```

### 왜 생성기보다 먼저 만드는가

VE-M3 에서 배운 것이다.

> **가드를 나중에 붙이면 이미 나간 것을 되돌릴 수 없다.**

VE-M3 전량 분석 9,411건에서 저장 output 20자 유출 **0건** · 금지 호칭 저장 **0건** ·
raw output 전문 저장 **0건** 을 지킬 수 있었던 이유는, 가드가 **실행보다 먼저** 있었기 때문이다.
33건이 terminal skip 됐는데 그것은 실패가 아니라 **가드가 일한 증거**다.

생성기를 먼저 만들면 "일단 만들고 나중에 막자" 가 된다. 그 순서는 되돌릴 수 없다.

---

## §2 Gate 의 위치

```
① Crawler / Trend Ingestion
        ↓
② Topic / Story Extraction          🔴 문장이 아니라 구조를 추출
        ↓
③ Persona Matching                  누구의 경험인가
        ↓
④ Draft Generation                  Identity + Variation + Mood
        ↓
🔴 ⑤ Safety / Originality Gate      ← 여기서 막지 못하면 사람에게 간다
        ↓
⑥ Operator Approval Queue           🔴 전건 승인
        ↓
⑦ Publish
        ↓
⑧ Metrics Loop                      → 다음 선택에 반영
```

**Gate 는 ④와 ⑥ 사이에 있다.** 생성물이 사람 눈에 닿기 전 마지막 자동 관문이다.

🔴 **위기 신호만 예외다.** ①~③ 단계에서 감지되면 **④ 생성 자체를 시작하지 않는다**(§4).

---

## §3 9개 필수 관문

각 관문은 독립이다. 하나라도 실패하면 그 자리에서 멈춘다.

### ① 20자 연속 유출

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 전문 ↔ source body · source comments · 학습 anchor(voice_gold few-shot) |
| **실패 기준** | 공백 제거 후 **20자 이상 연속 일치 1건** |
| **조치** | 🔴 `regenerate` — 1건이라도 예외 없음 |
| **재사용 자산** | 🟢 `assertNoSourceLeak(outputText, sourceTexts, minRun = M3_LEAK_RUN_MIN)` — **그대로 쓸 수 있다.** 9,411건에서 검증됨 |
| **새로 필요** | 대조 대상에 **학습 anchor 추가** (VE-M3 는 원문만 봤다) |

**실측으로 확인한 시그니처**
```ts
assertNoSourceLeak(outputText: string, sourceTexts: readonly string[], minRun = M3_LEAK_RUN_MIN)
  → { ok: boolean; leaked: boolean }
공백을 제거하고 비교한다 — 띄어쓰기로 우회할 수 없다
```

🔴 **`minRun` 을 호출부에서 넘기지 않는다.** VE-M3 fixture 가 인자 3개 호출을 차단하고 있고,
같은 규칙을 Gate 에도 적용한다. 완화 가능한 가드는 가드가 아니다.

### ② 고유 표현 / 특이 조어 복제

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 ↔ source 의 **희귀 n-gram** |
| **실패 기준** | 아래 3단 판정 |
| **조치** | 희귀도 높음 → `regenerate` · 중간 → `review` |
| **재사용 자산** | 🟡 없음 |
| **새로 필요** | 🔴 **희귀도 사전** + n-gram 추출기 |

**20자 룰로 못 잡는 것을 잡는다.** *"남의편"* 같은 표현은 3글자라 ①을 통과하지만,
그 사람의 말버릇이라면 복제해서는 안 된다.

```
판정 3단
  a. source 에서 3~10자 n-gram 추출
  b. 코퍼스 빈도 조회 — voice_gold 135 + silver 1,065 + story 1,304 를 기준 코퍼스로
  c. 희귀도 판정
       코퍼스 빈도 0~1회  → 🔴 고유 표현. 생성물에 있으면 regenerate
       빈도 2~5회         → 🟡 review
       빈도 6회 이상      → 🟢 일반 표현. 허용
```

🔴 **"흔한 표현" 의 기준을 코퍼스로 정한다.** 사람이 목록을 관리하면 반드시 빠진다.

### ③ 식별 디테일

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물의 고유명사 · 수치 · 관계 조합 |
| **실패 기준** | 아래 카테고리 **2개 이상 결합** |
| **조치** | 2개 → `review` · 3개 이상 → `regenerate` |
| **재사용 자산** | 🟡 VE-M3 의 `IDENT` 판정 정규식(개념만) |
| **새로 필요** | 카테고리 분류기 · 결합 판정 |

```
카테고리
  지명(시·구·동) · 병원 · 학교 · 회사 · 구체 날짜 · 정확한 나이
  금액 · 가족관계 특이조합 · 희귀 사건

🟢 단일 일반 표현은 허용
   "집 근처 병원" · "50대 초반" · "수도권"
🔴 2개 이상 결합은 특정 가능
   "분당 ○○병원" + "3월 12일" → review
   + "둘째 딸 결혼식 전날" → regenerate
```

**사적인 이야기가 위험한 게 아니다.** 위험한 것은 **결합**이다.
이 원칙은 [학습 후보 선별 정책](2026-08-29-voice-m3-learning-policy.md) 에서 확정한
*"식별 디테일은 차단이 아니라 일반화"* 와 같다.

### ④ 원문 문장 순서 / 구조 과복제

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물의 사건 전개 순서 ↔ source 전개 순서 |
| **실패 기준** | 🔴 **핵심 전개 3개 이상이 같은 순서** |
| **조치** | 3개 → `review` · 4개 이상 → `regenerate` |
| **재사용 자산** | 🟡 없음 |
| **새로 필요** | 전개 단위 추출 · 순서 정렬 비교 |

**문장을 다 바꿔도 사건 순서가 같으면 그것은 복제다.**

```
🟢 허용 — 흔한 상황 구조
   "일이 있었다 → 속상했다 → 시간이 지났다"
   "병원에 갔다 → 검사했다 → 결과를 기다린다"
   → 이런 구조는 누가 써도 비슷하다. 막으면 아무 글도 못 쓴다

🔴 차단 — 고유 전개
   source 특유의 사건 순서가 3개 이상 그대로 유지되는 경우
```

판정은 **일반 구조 사전**을 두고, 거기 없는 전개가 순서까지 같을 때만 잡는다.

### ⑤ 금지 호칭 / 브랜드 금칙어

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 전문 |
| **실패 기준** | 금칙어 **1개라도 포함** |
| **조치** | 🔴 `regenerate` — 저장·발행 전 반드시 차단 |
| **재사용 자산** | 🟢 `M3_FORBIDDEN_ADDRESS_TERMS` (**15개 항목**) · `M3_ALLOWED_ADDRESS_TERMS` (4개) · `validateAddressCandidates()` — **그대로 쓸 수 있다** |
| **새로 필요** | 없음 |

**실측** — `scripts/lib/voice-style-signals.mts` 에 정의되고 `voice-m3-contract.mts` 가 재수출한다.
```
TARGET_DESCRIPTOR_TERMS   15개 → M3_FORBIDDEN_ADDRESS_TERMS
SORANSORAN_REGISTER_TERMS  4개 → M3_ALLOWED_ADDRESS_TERMS
```

🔴 **원문에 있어도 우리가 만들어내지 않는다.** 이것이 VE-M3 의 원칙이고 Gate 도 그대로 따른다.
계약 주석에 *"'우리 또래분들' 이 한 번 좋은 치환어로 문서에 적혔다가 폐기됐다(PR #100).
사람은 같은 실수를 반복한다"* 고 적혀 있다.

#### 🔴 ⑤ 와 ⑨ 는 다른 관문이다

| | ⑤ 금지 호칭 / 브랜드 금칙어 | ⑨ Source Community Marker |
|---|---|---|
| 막는 것 | **소란소란 브랜드 · 대상 호칭 정책 위반** | **외부 출처의 흔적** |
| 예 | 시니어 · 어르신 · 노인 · 실버 · 우리 또래분들 · 중년 여성 | 82쿡님들 · 우갱님들 · 레테님들 · 우리 카페 |
| 근거 | 브랜드 규칙 (원문에 있어도 만들지 않는다) | 재맥락화 실패 (여기 글이 아니게 된다) |
| 자산 | 🟢 `M3_FORBIDDEN_ADDRESS_TERMS` 15개 — **이미 있다** | 🔴 marker dictionary — **새로 만든다** |

**두 관문을 합치면 안 된다.** 하나는 브랜드 정책이고 하나는 출처 세탁이다.
실패했을 때 필요한 조치도 다르다 — ⑤는 표현 교체, ⑨는 **호칭이 필요한지부터 재검토**.

### ⑥ 닉네임 / author 재사용

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 ↔ source comment author · 회원 닉네임 · 학습 데이터 author |
| **실패 기준** | 1건이라도 등장 |
| **조치** | 🔴 `regenerate` |
| **재사용 자산** | 🟢 PR #200/#204 의 두 함수 원칙 |
| **새로 필요** | 회원 닉네임 대조 (실시간 조회) |

### 🔴 두 함수의 비대칭을 그대로 유지한다

```
학습 추출 (commentBodiesForLearning)
  content 만 읽는다. author 에 **접근조차 하지 않는다**
  → 닉네임을 문체로 배우지 않게

유출 대조 (topCommentsToText)
  author 를 **포함해서** 넓게 읽는다
  → 닉네임이 생성물에 섞여 나오는 것도 잡아야 하므로
  → 실측: author 포함 시 대조 문자열이 8.8% 넓어진다 = 놓칠 위험이 준다
```

**Gate 는 후자를 쓴다.** 학습에서 뺀 것과 검사에서 빼는 것은 정반대 방향이다.

### ⑦ Persona Consistency

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 ↔ Persona Identity · Voice Core · No-Go · SelfMemory |
| **실패 기준** | 모순 1건 |
| **조치** | `regenerate` (같은 persona 로 prompt 수정) 또는 persona 변경 |
| **재사용 자산** | 🟡 없음 |
| **새로 필요** | 사실 추출기 + 모순 판정 |

```
🔴 모순 예시
   이혼 · 사별 · 별거 설정인데 남편과 화목한 현재형 서술
   자녀 없음인데 딸 결혼 이야기를 자기 경험처럼
   갱년기 후 설정인데 갱년기 시작 전처럼
   작년에 "자녀 둘" 이라 했는데 오늘 "하나"
   No-Go 에 걸리는 말
```

**Mood 는 표현의 진폭만 바꾼다**([Architecture §6](2026-08-30-persona-architecture-design.md)).
mood 를 이유로 관계나 사실이 바뀌면 그것은 모순이다.

### ⑧ Voice Fingerprint / 반복 패턴

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 ↔ **같은 persona 의 최근 발행물** (n-gram · 시작 문장 · 말끝 · 이모티콘) |
| **실패 기준** | 상위 빈출 n-gram 점유율이 임계 초과 |
| **조치** | `regenerate` — **다른 variation 으로** |
| **재사용 자산** | 🟢 헌법 §9-7 **문장 지문 중복률** 개념 · `VoiceVariation` 모델 |
| **새로 필요** | n-gram 점유율 계산기 · 임계 확정 |

**고정 말투 1개가 반복되어 AI 티 나는 것을 막는 관문이다.**
[Architecture §5](2026-08-30-persona-architecture-design.md) 의 Voice Variations ·
Mood State · Activity Rhythm 과 직접 연결된다.

```
검사 축
  최근 N건의 시작 문장 패턴      같은 hookType 반복
  말끝 분포                     같은 ending 반복
  이모티콘 패턴                 빈도 · 위치
  상위 빈출 n-gram 점유율        🔴 헌법 §9-7 역지표

🔴 우나어에는 이 지표가 없어 225명의 실효 다양성을 아무도 몰랐다.
```

### ⑨ Source Community Marker — 외부 커뮤니티 흔적

| 항목 | 내용 |
|---|---|
| **검사 대상** | 생성물 전문 ↔ **sourceSite 별 marker dictionary** · 외부 커뮤니티 별칭 · 카페 내부 호칭 |
| **실패 기준** | marker 1건이라도 잔존 |
| **조치** | 기본 `regenerate` · 애매하면 `review` · 🔴 source 자체가 카페 운영/공지/광고 문맥이면 `reject` |
| **재사용 자산** | 🟡 VE-M3 `sourceSite` 메타데이터 (marker dictionary 의 키) |
| **새로 필요** | 🔴 marker dictionary · alias list · 소란소란 호칭 variation list |

**20자 유출이 없어도 외부 커뮤니티 내부 호칭이 남으면 소란소란 글이 아니다.**
①이 잡는 것은 *문장의 복제*이고, ⑨가 잡는 것은 *출처의 흔적*이다. 둘은 다른 문제다.

#### Source Community Marker 의 정의

```
외부 커뮤니티 이름 · 별칭 · 약칭
외부 카페 내부 호칭 (그 카페에서만 자연스러운 부름말)
외부 카페 운영 문구 (공지 · 등업 · 규정 안내)
출처 맥락 표현 — "우리 카페" · "이 카페" · "카페 회원님들"
```

#### 예시 (유형 예시일 뿐, 실제 sourceRef·URL·원문은 담지 않는다)

| 유형 | 예 |
|---|---|
| 커뮤니티명 · 약칭 | `82쿡님들` · `82님들` · `레몬테라스님들` · `레테님들` |
| 카페 내부 호칭 | `우갱님들` · `우갱 언니들` · `은오 회원님들` |
| 역할 기반 호칭 | `맘님들` · `선배맘님들` · `카페 회원님들` |
| 출처 맥락 | `우리 카페` · `이 카페` · `여기 카페에서는` |

#### 실패 판정 5종

```
□ 생성물에 외부 출처명이 남아 있다
□ 외부 커뮤니티 내부 호칭이 남아 있다
□ 외부 카페 맥락의 "여기 / 우리 / 카페" 가 그대로 남았다
□ 원문 댓글 닉네임이나 외부 카페 호칭을 **소란소란 호칭처럼 재사용**했다
□ sourceSite 별 marker dictionary 에 걸리는 표현이 있다
```

#### 🔴 단순 일괄 치환은 금지한다

```
🔴 금지  "82쿡님들" → "소란소란님들" 로 기계적 치환
```

치환하면 문장은 통과하지만 **말투가 죽는다.** 그 자리에 호칭이 꼭 필요한지부터 다시 본다.
댓글은 호칭 없이 바로 공감으로 시작해도 된다.

---

## §3-1 🔴 소란소란 내부 호칭 원칙

⑨가 외부 호칭을 걷어낸 자리에 **무엇을 넣을 것인가**의 문제다.

### 무조건 "소란소란님들" 로 치환하지 않는다

```
🔴 금지  모든 외부 호칭 → "소란소란님들" 일괄 치환
```

**항상 같은 호칭을 쓰면 그것이 곧 AI 티다.**
[Architecture §5](2026-08-30-persona-architecture-design.md) 의 Voice Variations 와
같은 이유다 — 고정된 표현의 반복이 사람이 아님을 드러낸다.

### 페르소나 성향별 선택

| 성향 | 어울리는 호칭 |
|---|---|
| 조심스러운 | `여기 계신 분들` · `혹시 저 같은 분 계세요?` · `저만 이런가요?` |
| 친근한 | `언니들` · `소란님들` |
| 담담한 | **무호칭** |
| 공통 | 🟢 **댓글은 호칭 없이 바로 공감으로 시작해도 된다** |

```
🔴 한 페르소나가 같은 호칭만 반복하면 ⑧ Voice Fingerprint 에 걸린다
```

### 🔴 허용 후보와 코드 상수의 충돌 — 결정 필요

Codex 가 제시한 허용 후보 중 **`우리 또래분들` 은 코드상 금지어다.**

```
실측 — scripts/lib/voice-style-signals.mts

TARGET_DESCRIPTOR_TERMS (15개, ⑤ 가 차단)
  '우리 또래분들' · '우리 또래 분들' · '우리또래분들' · '우리 또래'
  '40대 여성분들' · '50대 여성분들' · '60대 여성분들' · '40대 여성' · '50대 여성' · '60대 여성'
  '중년 여성분들' · '중년 여성' · '같은 세대 분들' · '같은 세대분들' · '같은 세대'

SORANSORAN_REGISTER_TERMS (4개, 허용)
  '소란소란님들' · '소란소란님' · '소란님들' · '소란님'
```

**⑨가 `우리 또래분들` 로 치환하면 ⑤가 즉시 `regenerate` 시킨다.**
계약 주석이 그 이유를 남겨 두었다 —
*"'우리 또래분들' 이 한 번 좋은 치환어로 문서에 적혔다가 폐기됐다(PR #100). 사람은 같은 실수를 반복한다."*

| 후보 | 상태 |
|---|---|
| `소란님들` · `소란소란님들` | 🟢 `SORANSORAN_REGISTER_TERMS` 에 있음 |
| `우리 소란님들` | 🟡 상수에 없음 — `validateAddressCandidates()` 가 `unknown` 으로 판정 |
| `여기 계신 분들` · `언니들` · `저만 이런가요?` · 무호칭 | 🟢 일반 표현 — 상수 대상 아님 |
| 🔴 `우리 또래분들` | **금지어 15개에 포함. 현행 코드에서는 쓸 수 없다** |

**결정이 필요하다**(§14-⑩) — 금지어에서 푸는 것은 브랜드 정책 변경이므로 창업자 판단 사안이다.
이 문서는 **현행 코드 기준으로 `우리 또래분들` 을 허용 후보에서 뺀 상태**로 둔다.

---

---

## §4 위기 신호 별도 경로

### 🔴 이것은 Gate 관문이 아니라 **선행 차단**이다

```
자해 · 자살 · 극단 선택 · 학대 · 폭력
긴급 의료 위기 · 긴급 법률 위기 · 긴급 재무 위기
```

### 흐름

```
① Trend Ingestion / ③ Persona Matching 단계에서 감지
        ↓
🔴 ④ Draft Generation 을 시작하지 않는다
        ↓
crisis_hold 상태로 기록
        ↓
운영자 알림 → 필요 시 사람이 수동 대응
```

**페르소나는 상담자처럼 답하지 않는다.**
봇이 위로하려다 상황을 악화시키는 것이 최악이다. **사람에게 넘긴다.**

### 규칙

```
🔴 위기 신호 글에 페르소나 댓글 생성 금지
🔴 crisis_hold 는 재생성하지 않는다 (§8)
🔴 persona 를 바꿔도 생성하지 않는다 — source 자체가 대상이 아니다
```

**운영자 알림 경로는 아직 미정으로 남긴다**(§14).

---

## §5 조언 제한 정책

### 🔴 금지

```
진단                        "그거 갑상선일 수 있어요"
약 · 용량                   "○○ 하루 두 알 드세요"
병원 · 의사 특정 추천        "○○병원 △△ 선생님이 잘 봐요"
법적 판단                   "그건 명백히 위자료 대상이에요"
투자 · 대출 · 보험 단정      "지금 사두면 올라요"
구체 금액 지시               "500만 원 정도면 충분해요"
가족관계 단정               "그건 이혼 사유예요"
```

### 🟢 허용

```
자기 경험 공유              "저도 그맘때 그랬어요"
감정 공감                   "얼마나 답답하셨을까요"
일반 권유                   "병원에 한번 가보시는 게 좋겠어요"
                           "전문가한테 물어보시는 게 나을 것 같아요"
조심스러운 표현              "제 경우엔 그랬는데 사람마다 다르더라고요"
```

**경계는 "단정" 이다.** 경험을 나누는 것과 판단을 내려주는 것은 다르다.

---

## §6 Originality 의 정확한 의미

### 🔴 원문 0% 유사성이 목표가 아니다

원문을 한 단어도 못 쓰게 하면 *"시어머니"* 도 *"갱년기"* 도 쓸 수 없다.
그러면 소란소란 글이 될 수 없다.

| 허용 🟢 | 금지 🔴 |
|---|---|
| 주제 (간병 · 가족갈등 · 몸 · 돈 · 외로움) | 긴 문장 복사 |
| 흔한 상황 | 고유 표현 · 특이 조어 |
| 감정 흐름 | 식별 디테일 |
| 일반 표현 · 관용구 | 원문 문장 순서 과복제 |
| 댓글 **반응 구조** | **원댓글 문장 복사** |
| 문단 호흡 · 줄바꿈 습관 | 닉네임 재사용 |

### "오리지널리티 강화" 의 정의

> **소스 글을 소란소란 페르소나의 삶과 기억으로 재맥락화하는 것.**

같은 주제를 다루되, **그 페르소나가 겪었다면 어땠을까**로 다시 쓰는 것이다.
50대 초반 간병 중인 페르소나와 40대 후반 재취업 준비 중인 페르소나는
같은 소재를 완전히 다르게 쓴다. 그 차이가 오리지널리티다.

---

## §7 Gate 결과 상태

| 상태 | 의미 | 다음 액션 |
|---|---|---|
| **`pass`** | 9관문 전부 통과 | → **운영자 승인 대기열** |
| **`review`** | 위험은 있으나 판단이 필요 | → 대기열 + **위험 항목 표시**. 운영자가 확인 |
| **`regenerate`** | 명백한 실패. 다시 만들면 해결 가능 | → 재생성 (최대 3회) |
| **`reject`** | 재생성으로 해결 불가 | → **후보 폐기** · 사유 기록 |
| **`crisis_hold`** | 위기 신호 | → 🔴 **페르소나 응답 금지** · 운영자 알림 |

### 관문 → 상태 매핑

| 관문 | 실패 시 기본 상태 |
|---|---|
| ① 20자 유출 | `regenerate` |
| ② 고유 표현 | 희귀도 높음 `regenerate` · 중간 `review` |
| ③ 식별 디테일 | 2개 `review` · 3개+ `regenerate` |
| ④ 문장 순서 | 3개 `review` · 4개+ `regenerate` |
| ⑤ 금지 호칭 | `regenerate` |
| ⑥ 닉네임 | `regenerate` |
| ⑦ Persona 모순 | `regenerate` |
| ⑧ 지문 중복 | `regenerate` (다른 variation) |
| ⑨ Source Community Marker | `regenerate` · 애매하면 `review` · 🔴 source 가 카페 운영/공지/광고면 `reject` |
| 위기 신호 | 🔴 `crisis_hold` |

🔴 **`pass` 도 발행이 아니다.** 대기열로 갈 자격을 얻은 것뿐이다.

---

## §8 재생성 정책

```
최대 3회
같은 실패가 반복되면 → reject (폐기)
```

### 실패 유형별 처리

| 실패 | 처리 |
|---|---|
| **source leak** (①②) | 재작성 — 같은 persona, prompt 에 회피 지시 강화 |
| **식별 디테일** (③) | 일반화 지시 추가 후 재작성 |
| **문장 순서** (④) | 전개 재구성 지시 |
| **금지 호칭** (⑤) · **닉네임** (⑥) | 재작성 |
| **Persona 모순** (⑦) | 🔴 **persona 변경** 또는 prompt 수정 |
| **지문 중복** (⑧) | 🔴 **다른 variation 으로** 재생성 |
| **Source Marker** (⑨) | 🔴 **일괄 치환 금지.** 호칭이 필요한지부터 재검토 후 재작성 |
| **crisis** | 🔴 **재생성 금지** |
| 🔴 **source 자체가 위험** | **persona 를 바꿔도 재생성하지 않는다** |

**마지막 줄이 중요하다.** 소스가 문제인데 페르소나만 바꾸면 같은 문제가 반복된다.
소스 단위로 `reject` 하고 그 소스를 후보에서 뺀다.

---

## §9 Gate 로그 설계

🔴 **DB schema 변경은 하지 않는다. 후보만 제시한다.**

```
PersonaGenerationLog
  id · personaId · sourceTopicId · targetType(post|comment)
  generationAttempt · model · inputTokens · outputTokens · costUsd
  createdAt

PersonaGateResult
  id · generationLogId
  gateVersion            🔴 기준이 바뀌면 과거 판정을 재해석할 수 있어야 한다
  status                 pass | review | regenerate | reject | crisis_hold
  failedChecks[]         ['LEAK_20', 'IDENT_DETAIL', ...]  코드만
  matchedFragmentsHash[] 🔴 일치 조각의 **해시만**. 원문 저장 금지
  riskSummary            요약 문자열 (원문 조각 금지)
  regenerationCount
  reviewerDecision       approve | edit | reject | null
  reviewerEdited         boolean
  editDiffHash           🔴 수정 내용은 해시로
  finalAction
  checkedAt
```

### 🔴 저장 금지 / 저장 가능

| 저장 금지 | 저장 가능 |
|---|---|
| 원문 · 댓글 전문 | 해시 |
| LLM raw output 전문 | 길이 |
| 프롬프트 전문 | risk code |
| 일치한 문자열 자체 | 요약 (원문 조각 없이) |
| 회원 개인정보 | 토큰 · 비용 |

**VE-M3 와 같은 원칙이다.** 9,411건에서 raw output 전문 저장 0건을 지켰다.

---

## §10 Operator Approval Queue 와의 연결

운영자 화면에 있어야 할 것.

```
생성물          제목 · 본문 (또는 댓글) · 반응 유형
페르소나        누가 · 왜 매칭됐는지 (매칭 점수) · 어떤 variation · 오늘 mood
Gate 결과       9관문 통과/실패 · status · 실패·주의 항목
source          topic summary · 🔴 원문 링크는 운영자만
참조            story refs · voice anchors
재생성          횟수 · 실패 이력
수정            diff (승인 후 기록)
액션            [승인] [수정 후 승인] [폐기]
```

### 🔴 `review` 상태는 다르게 보여준다

`pass` 와 같은 화면에 섞으면 운영자가 위험 항목을 놓친다.
**`review` 는 실패 항목을 상단에 펼친 채로** 보여준다.

---

## §11 Metrics — Gate 품질을 보는 지표

| 지표 | 의미 | 나쁜 신호 |
|---|---|---|
| **gate fail rate** | 관문 실패 비율 | 너무 높으면 생성 품질 문제, 너무 낮으면 가드가 헐거움 |
| **regenerate rate** | 재생성 비율 | 50% 초과 시 검토 |
| **operator edit rate** | 운영자 수정 비율 | 🔴 30% 초과 시 검토 |
| **reject rate** | 폐기 비율 | |
| **source leak catch count** | ①②가 잡은 건수 | 🔴 **0이면 가드가 작동하는지 의심** |
| **persona contradiction count** | ⑦이 잡은 건수 | 3건 이상 시 persona 정의 재검토 |
| **repeated phrase count** | ⑧이 잡은 건수 | 상승 = AI 티 증가 |
| **source marker catch count** | ⑨가 잡은 건수 | 🔴 sourceSite 별로 본다. 특정 출처에서 높으면 dictionary 보강 |
| **crisis hold count** | 위기 신호 건수 | |
| **published content complaint count** | 발행 후 불만 | 🔴 1건이라도 즉시 중단 |
| **persona comment ratio** | 전체 댓글 중 페르소나 비율 | 🔴 **30% 초과 시 자동 감속** |

🔴 **`source leak catch count` 가 0인 것은 좋은 신호가 아니다.**
VE-M3 에서 terminal skip 33건이 나온 것이 가드가 일한 증거였다.
0이면 가드가 실제로 검사하고 있는지 역검증해야 한다.

---

## §12 MVP 적용 범위

```
1차   🔴 설계만. 구현하지 않는다
2차   Gate 구현 (생성기 없이 가드만) + fixture + 역검증
3차   후보 생성 — 🔴 post 보다 comment 부터 권장
4차   운영자 승인 UI
5차   제한 발행
```

### 🔴 comment 부터 권장하는 이유

| | comment | post |
|---|---|---|
| 정체성 부담 | 낮음 — 반응만 | 🔴 높음 — 사건을 만들어야 함 |
| 실패 시 영향 | 작음 | 큼 |
| Gate 검증 난이도 | 낮음 (짧다) | 높음 |
| 현재 문제와의 적합성 | 🟢 **댓글 0개 글 65%** | 간접 |

**다만 확정이 아니다** — Persona Network 는 글도 만든다. 순서 문제일 뿐이다(§14).

```
🔴 자동 발행 금지
🔴 모든 후보는 운영자 승인 대기열로 보낸다
```

---

## §13 기존 자산 재사용 가능성 (코드 실측)

### 🟢 그대로 쓸 수 있는 것

| 자산 | 위치 | 확인 |
|---|---|---|
| `assertNoSourceLeak()` | `scripts/lib/voice-m3-contract.mts` | ✅ 시그니처 확인. 공백 제거 후 비교 · 9,411건 검증 |
| `M3_LEAK_RUN_MIN` | 같음 | ✅ `LEAK_RUN_MIN` 재수출 |
| `M3_FORBIDDEN_ADDRESS_TERMS` | 같음 | ✅ **15개 항목** (`TARGET_DESCRIPTOR_TERMS`) |
| `M3_ALLOWED_ADDRESS_TERMS` | 같음 | ✅ **4개 항목** (`SORANSORAN_REGISTER_TERMS`) |
| `validateAddressCandidates()` | 같음 | ✅ forbidden · unknown 분리 반환 |
| `topCommentsToText()` | `scripts/lib/voice-unao-readonly.mts` | ✅ **유출 대조용** — author 포함, 넓게 |
| `commentBodiesForLearning()` | 같음 | ✅ **학습 추출용** — content 만, author 접근 0 |
| voice_gold 135 · silver 1,065 · story 1,304 | `tmp/voice-m3-learning/` | ✅ ②의 희귀도 기준 코퍼스로 활용 |
| Persona Architecture 7층 | [문서](2026-08-30-persona-architecture-design.md) | ✅ ⑦⑧의 판정 근거 |
| 문장 지문 중복률 · `VoiceVariation` | 헌법 §9-5 · §9-7 | ✅ ⑧의 개념 정의 |
| `sourceSite` 메타데이터 | `VoiceSource` · 학습 산출물 | ✅ ⑨ marker dictionary 의 키 (실측 6종) |
| `SORANSORAN_REGISTER_TERMS` 4개 | `voice-style-signals.mts` | ✅ ⑨ 치환 후보의 기준선 |

### 🔴 새로 만들어야 하는 것

| # | 자산 | 난이도 | 비고 |
|---|---|---|---|
| ② | **희귀도 사전** + n-gram 추출기 | 중 | 코퍼스 2,504건으로 빈도표 구축 |
| ③ | 식별 디테일 카테고리 분류기 | 중 | 9종 카테고리 · 결합 판정 |
| ④ | 전개 단위 추출 · 순서 비교 | 🔴 높음 | **가장 어렵다.** 일반 구조 사전 필요 |
| ⑥ | 회원 닉네임 실시간 대조 | 낮음 | |
| ⑦ | 사실 추출기 + 모순 판정 | 🔴 높음 | SelfMemory 와 연동 |
| ⑧ | n-gram 점유율 계산기 | 중 | 임계 확정 필요 |
| ⑨ | 🔴 **sourceSite 별 marker dictionary** | 중 | VE-M3 `sourceSite` 6종이 키 |
| ⑨ | source community **alias list** | 낮음 | 약칭 · 별칭 (82님들 · 레테님들 …) |
| ⑨ | 소란소란 **내부 호칭 variation list** | 낮음 | 🔴 일괄 치환 금지 — 성향별 선택지 |
| ⑨ | marker scan **fixture** | 낮음 | 역검증 포함 |
| ⑨ | marker `regenerate`/`review` 기준 | 중 | 임계 확정 |
| 위기 | 위기 신호 감지기 | 🔴 높음 | 오탐·미탐 양쪽이 위험 |

**④ 와 ⑦ 이 가장 어렵다.** 이 둘이 Gate 구현 일정의 대부분을 차지할 것이다.

---

## §14 남은 결정사항

| # | 결정 | 상태 |
|---|---|---|
| ① | 🔴 **공개 · 신뢰 정책** | 미결정 (전략 문서 §10) |
| ② | 🔴 **위기 신호 운영자 알림 경로** | 미정 — Slack? 이메일? 어드민 배지? |
| ③ | **`review` 와 `fail` 의 경계** | 관문별 임계 미확정 |
| ④ | **20자 룰 외 고유 표현 탐지 방식** | 희귀도 임계(0~1 / 2~5 / 6+) 검증 필요 |
| ⑤ | **sentence order similarity 기준** | "핵심 전개 3개" 의 정의 미확정 |
| ⑥ | **Gate 로그를 어디까지 저장할지** | 해시 범위 · 보존 기간 |
| ⑦ | **자동 재생성 비용 상한** | 3회 × 후보 수 × 단가 |
| ⑧ | **post 먼저인지 comment 먼저인지** | comment 권고이나 확정 아님 |
| ⑨ | **M3 반응 지도 의존** | Architecture 에서 이월 |
| ⑩ | 🔴 **`우리 또래분들` 을 금지어에서 풀 것인가** | 브랜드 정책 변경 — 현행 코드는 금지 (§3-1) |
| ⑪ | **`우리 소란님들` 을 register term 에 넣을 것인가** | 현재 `unknown` 판정 |
| ⑫ | **marker dictionary 를 sourceSite 별로 둘 것인가 통합할 것인가** | 출처가 늘면 관리 비용 차이 |

---

## §15 현 시점 금지

```
🔴 Gate 구현 · Persona Bot 구현 · 글 생성 실험
🔴 DB schema 변경 · Prisma migration
🔴 src/ · scripts/ 수정
🔴 SEO 작업 · 추가 워크벤치
🔴 DB write · 유료 LLM/API 호출
🔴 자동 발행
```

이번 단계는 **설계 문서화**다.

---

## §16 참조

| 문서 | 내용 |
|---|---|
| [Persona Architecture 설계](2026-08-30-persona-architecture-design.md) | 7층 구조 · ⑦⑧의 판정 근거 |
| [Persona Network 전략](2026-08-29-persona-network-strategy.md) | 시스템 흐름 · 공개 정책 3안 |
| [VE-M3 학습 후보 선별 정책](2026-08-29-voice-m3-learning-policy.md) | bucket · 식별 디테일 일반화 원칙 |
| [VE-M3 export 설계](2026-08-29-voice-m3-export-design.md) | 유출 방지 4중 · 가드 우선 원칙 |
| [Micro Seed Lane 헌법](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) | §9-7 문장 지문 중복률 · §8-2 반응 지도 |

🔴 **Gate 는 생성기보다 먼저 만든다.** 막을 수 없으면 만들지 않는다.
