# Persona Architecture 설계

> 작성 2026-08-30 · 상태 **설계 확정 · 구현 미착수**
> 선행: [Persona Network 전략](2026-08-29-persona-network-strategy.md) · [VE-M3 학습 후보 선별 정책](2026-08-29-voice-m3-learning-policy.md)
> 상위: [Micro Seed Lane 헌법](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) **§9 페르소나 원칙** · §12 마일스톤 **M4 Persona OS**

---

## §0 이 문서가 정하는 것

[전략 문서](2026-08-29-persona-network-strategy.md)가 **무엇을 만들 것인가**를 정했다.
이 문서는 **그것을 어떤 구조로 만들 것인가**를 정한다. 구현은 하지 않는다.

### 헌법이 이미 정해 놓은 것

`MICRO_SEED_LANE_CONSTITUTION.md` §9 가 M4 Persona OS 를 이미 정의한다.
**이 설계는 새로 만드는 것이 아니라 헌법 §9 를 확장하는 것이다.**

| 항목 | 헌법 §9 |
|---|---|
| 모델 3종 | `Persona` · `PersonaMemory` · `VoiceVariation` (필드까지 명시) |
| 필수 속성 10개 | ageBand · lifeState · boardAffinity · writingLength · commentHabit · endings · typoPattern · emojiPattern · noGo · memory |
| 🚫 금지 | **페르소나를 TS 상수 배열로 두지 않는다** — 우나어가 225명을 배열에 두고 SSoT 통합에 **PR 7단계** 소모 |
| 역지표 | **문장 지문 중복률** — 상위 빈출 n-gram 점유율 |
| 규모 철학 | 🔴 **"active bot 10,000명이 아니라 voice variation 10,000개"** |
| 계정 구조 | `Persona.userId @unique → User` |

### 🔴 규모에 대한 긴장을 먼저 정리한다

전략 문서는 **"수십~수백 페르소나 확장 전제"**, 헌법은 **"계정 수는 비용을 선형으로 늘리지만 가치를 늘리지 않는다"** 라고 한다.

충돌이 아니라 **강조점 차이**다.

```
확장해야 하는 것   = 말투 축의 조합 수 (variation)
확장 비용이 드는 것 = 계정 수 (persona)
```

**아키텍처는 수백 계정을 감당하도록 설계하되, 실제 확장은 계정이 아니라 variation 축으로 먼저 간다.**
계정 30개로도 말투 조합 수백 개가 나온다.

### 순서 의존

헌법 마일스톤은 **M3 Comment Activation Engine → M4 Persona OS** 다.
M3 가 미착수이고, M3 의 산출물인 **"반응 지도"**(헌법 §8-2)가 §8 Comment Distribution 의 입력이다.
이 의존을 §13 MVP 3단계에 반영했다.

---

## §1 🔴 페르소나는 고정 말투 1개를 가지면 안 된다

**이 문서의 핵심 원칙이다.**

말투를 하나로 고정하면 그 페르소나가 쓴 글은 전부 같은 리듬을 갖는다.
사람은 그렇게 쓰지 않는다. 피곤한 날과 여유 있는 날의 문장이 다르고,
글 쓸 때와 댓글 달 때의 톤이 다르다.

**고정 말투는 자연스러움이 아니라 AI 티의 원인이다.**

### 7층 구조

| 층 | 성격 | 변하는가 |
|---|---|---|
| **① Persona Identity** | 변하지 않는 삶의 설정 | 🔒 고정 |
| **② Persona Voice Core** | 기본 말투 | 🔒 고정 |
| **③ Voice Variations** | 상황별 말투 변주 (5~8개) | 🔄 선택 |
| **④ Mood State** | 오늘의 컨디션 · 감정 상태 | 🔄 매일 |
| **⑤ Relationship Memory** | 유저 · 페르소나와의 거리감 | 📈 누적 |
| **⑥ Activity Rhythm** | 언제 · 얼마나 · 어디서 반응하는지 | 🔒 고정 (개인차) |
| **⑦ No-Go Pattern** | 절대 하지 않는 말 · 행동 | 🔒 고정 |

### 원칙

> **정체성은 일관, 표현은 변주.**
>
> variation 은 identity · noGo · memory 를 **절대 깨지 않는다.**

---

## §2 고정되는 것 / 변주되는 것

### 🔒 고정 — Persona Identity

```
나이대 · 여성 · 지역감
가족 구성 · 결혼/이혼/사별/별거/비혼 · 남편과의 관계 · 자녀 구성
경제 상황 · 일/직업 상태
건강 · 갱년기/폐경 상태
가치관
과거에 한 말 (SelfMemory)
특정 유저와의 관계 기억 (RelationshipMemory)
noGo
```

이 목록은 **한 번 정하면 바꾸지 않는다.** 바꾸면 다른 사람이 된다.

### 🔄 변주 — Voice Variations + Mood State

```
말 길이
댓글 시작 방식
공감 먼저 / 자기 경험 먼저 / 조심스러운 조언
존댓말 강도
줄임표 · ㅋㅋ · 이모티콘 빈도
피곤한 날 / 여유 있는 날 / 예민한 날 톤
본문 / 댓글 / 대댓글별 톤 차이
답변 속도
반응 강도
🔴 침묵 여부 — 아무 말도 하지 않는 것도 선택이다
```

**"침묵 여부"가 변주 목록에 있는 것이 중요하다.** 모든 글에 반응하는 사람은 없다.

---

## §3 Persona Identity — 변하지 않는 삶의 설정

헌법 §9-3(말투 축)과 창업자 요청(생활사 축)을 **두 테이블로 나눈다.**
한 테이블에 섞으면 "말투가 같은데 가족 구성만 다른 페르소나"를 만들 수 없다.

| 그룹 | 필드 | 값 · 제약 |
|---|---|---|
| **기본** | `displayName` | 닉네임 |
| | `userId` | 🔴 `@unique → User`. `Post.authorId` NOT NULL 제약(헌법 §5-2) 때문에 **페르소나마다 User 레코드 필수** |
| | `ageBand` | 40대 후반 / 50대 초반 / 50대 후반 / 60대 초반 (헌법 값) |
| | `gender` | 🔴 `'female'` 고정 |
| | `region` | 수도권 / 광역시 / 중소도시 / 읍면 — 🔴 **시·구 단위 금지** |
| **가족** | `maritalStatus` | 기혼 / 사별 / 이혼 / 별거 / 비혼 |
| | `spouseRelationship` | 원만 / 소원 / 갈등 / 해당없음 |
| | `household` | 배우자 · 자녀 · 부모 · 독거 (복수) |
| | `children` | `[{ ageBand, relationship, livingWith }]` — 🔴 나이 아닌 밴드 |
| | `parentCare` | 없음 / 간헐 / 상시 — **핵심 자산 소재** |
| **형편** | `economicStatus` | 여유 / 보통 / 빠듯 / 어려움 |
| | `housing` | 자가 / 전세 / 월세 / 부모집 |
| | `workStatus` | 전업 / 파트타임 / 자영업 / 구직 / 은퇴 |
| **몸** | `healthBands` | 관절 · 혈압 · 수면 · 체중 — 🔴 **병명 금지, 밴드만** |
| | `menopauseStatus` | 전 / 진행중 / 후 |
| **성향** | `lifeState` | 자녀 독립 / 남편 은퇴 / 재취업 고민 / 갱년기 진행 (헌법) |
| | `values` | 가치관 태그 |
| | `personality` | 5~7개 형용 태그 |
| | `interests` | 관심사 태그 |
| | `boardAffinity` | 자유게시판 중심 / 갱년기톡 중심 (헌법) |
| **금기** | `noGo` | 🔴 절대 하지 않는 말 · 행동 (헌법 필수) |
| **이력** | `lifeEvents` | `[{ ageBandAtEvent, category, summary }]` — 🔴 요약만 |
| **운영** | `isActive` · `dailyCap` · `status` · `createdAt` · `retiredAt` | 헌법 §9-5 |

### 🔴 구체적이되 특정 불가능하게

```
✅ "50대 초반 · 수도권 · 시어머니 간병 3년째 · 관절 통증"
🔴 "1973년생 · 성남 분당 · ○○병원 신경과 통원"
```

VE-M3 에서 확인한 **식별 디테일 문제**가 페르소나 정의에서 그대로 재현되기 때문이다.

### 🚫 TS 상수 배열 금지 (헌법 §9-6)

처음부터 DB 모델로 둔다. 우나어가 225명을 TS 배열에 두고 정의가 다섯 곳으로 흩어져
SSoT 통합에 PR 7단계를 소모했다.

---

## §4 Persona Voice Core — 기본 말투

헌법 §9-3 의 말투 축이 여기 들어간다.

```
personaId
endings          말끝 습관
writingLength    짧은 잡담형 / 질문형 / 긴 사연형
commentHabit     공감 먼저 / 경험 공유 / 조심스러운 조언
typoPattern      드문 오타 · 띄어쓰기 습관     🔴 교정하지 않는다
emojiPattern     거의 안 씀 / 가끔 씀
politenessBase   존댓말 기본 강도
hookTypes        글 시작 방식
voiceAnchors[]   🆕 voice_gold 135 중 3~5건 sourceRef
targetSignals    🆕 nat/vR/oD/exp/seq 목표 밴드 (gold 평균 기준)
```

`voiceAnchors` 가 VE-M3 와의 연결점이다.
gold 135건의 문체 좌표(nat 80.2 · vR 83.6 · oD 71.7 · exp 27.3 · seq 21.1)를 생성 검증 기준으로 쓴다.

---

## §5 Voice Variations — 상황별 말투 변주

### 원칙

```
🔴 그냥 랜덤 말투가 아니다
🔴 같은 사람 안에서 자연스럽게 흔들리는 말투여야 한다
🔴 variation 은 identity · noGo · memory 를 절대 깨지 않는다
🔴 반복되는 시작 문장 · 반복되는 말끝 · 반복되는 이모티콘 패턴을 막아야 한다
```

### 페르소나당 5~8개

```
VoiceVariation
  personaId · variationKey
  lengthBand       짧게 / 보통 / 길게
  hookType         상황 던지기 / 질문 / 한탄 / 인사 없이 바로
  endingUsed       이 변주에서 쓰는 말끝
  emojiUsed        이 변주의 이모지 빈도
  politenessDelta  기본 대비 존댓말 강도 (-1 / 0 / +1)
  contextFit       post / comment / reply — 어디에 어울리는가
  🔴 ngramFingerprint   문장 지문 중복률 산출 근거 (헌법 §9-7)
```

### 선택 규칙

| 상황 | 영향 |
|---|---|
| 글 / 댓글 / 대댓글 | `contextFit` 으로 후보 제한 |
| 오늘의 Mood | §6 이 `lengthBand` · `politenessDelta` 를 밀거나 당김 |
| 최근 사용 이력 | 🔴 **직전 3회에 쓴 variation 은 제외** |
| 지문 중복률 | 🔴 특정 hookType · ending 이 최근 발행물에서 과다하면 제외 |

**직전 3회 제외가 반복 패턴을 막는 1차 방어다.**

---

## §6 Mood State — 오늘의 컨디션

### 원칙

```
🔴 페르소나는 매번 같은 에너지로 말하지 않는다
🔴 오늘 컨디션에 따라 짧게 쓰거나 길게 쓸 수 있다
🔴 다만 mood 가 identity 를 뒤집으면 안 된다
```

**예 — 남편과 사이가 나쁜 페르소나가 갑자기 애정 넘치는 톤으로 쓰면 안 된다.**
mood 는 **표현의 진폭**을 바꾸지 **관계나 사실**을 바꾸지 않는다.

### 구조

```
PersonaMoodState
  personaId · date
  energy       낮음 / 보통 / 높음      → lengthBand · 활동량
  sensitivity  둔함 / 보통 / 예민함     → 반응 강도 · 존댓말 강도
  talkativeness 과묵 / 보통 / 수다      → 🔴 침묵 여부에 영향
  seed         재현 가능한 난수 시드
```

### 🔴 mood 가 바꿀 수 있는 것 / 없는 것

| 바꿀 수 있다 | 바꿀 수 없다 |
|---|---|
| 글 길이 · 반응 강도 | 가족 구성 · 혼인 상태 |
| 존댓말 강도 · 이모지 빈도 | 남편과의 관계 |
| 답변 속도 · 활동량 | 경제 상황 · 건강 상태 |
| **침묵 여부** | 과거에 한 말 (SelfMemory) |
| | noGo |

mood 는 하루 단위로 생성하고 **seed 로 재현 가능**하게 둔다.
운영자가 "왜 이 글은 이렇게 짧지?" 를 물었을 때 답할 수 있어야 한다.

---

## §7 Relationship Memory — 관계 기억

### 🔴 retention 의 핵심이자 가장 위험한 곳

```
🟢 "저번에 말씀하신 그 일은 좀 나아지셨어요?"      ← 이 정도는 가능하다
🔴 사용자가 공개하지 않은 정보를 추론하거나 단정     ← 금지
```

**과하면 무섭다.** 회원이 말하지 않은 것을 페르소나가 알고 있으면 그것은 온기가 아니라 감시다.

### 구조

```
PersonaUserRelationship
  personaId · userId
  firstInteractionAt · interactionCount · lastInteractionAt
  knownFacts[]         🔴 회원이 직접 공개한 것만. { factKey, summary, statedAt, sourcePostId }
  recurringConcerns[]  반복되는 고민 (간병 · 남편 · 돈)
  toneAdjustment       이 사람에게는 조금 더 조심스럽게
  lastTopics[]
  doNotMention[]       🔴 회원이 불편해한 주제
  closeness            거리감 (0~100) — 호칭 · 존댓말 강도에 영향
```

### 저장 원칙

```
🔴 회원이 직접 공개한 것만 저장한다. 추론 금지
   ("글투로 보아 이혼하신 듯" 같은 추정은 저장하지 않는다)
🔴 탈퇴 · 삭제 요청 시 즉시 삭제
🔴 knownFacts 는 180일 후 요약으로 축약
🔴 운영자 열람 시 로그를 남긴다
🔴 export · 외부 전송 금지
```

---

## §8 Activity Rhythm — 활동 리듬

### 원칙

```
🔴 모든 페르소나가 모든 글에 반응하면 안 된다
🔴 즉답만 반복해도 안 된다
🔴 페르소나마다 활동 시간대가 다르다 — 밤형 · 오전형
🔴 페르소나마다 활동 성향이 다르다 — 댓글 자주 / 글만 가끔
🔴 페르소나 댓글 비율이 전체 댓글의 30% 를 넘지 않도록 감시한다
```

### 구조

```
PersonaActivityRhythm
  personaId
  activeHours       [09-12] / [20-24] 등 개인차
  activeDays        주중 중심 / 주말 중심 / 무관
  postFrequency     주 0~1건 등
  commentFrequency  일 0~2건 등
  responseDelay     즉답 금지 — 최소 지연 밴드
  silenceRate       🔴 매칭돼도 침묵할 확률
```

### 🔴 전체 상한 (커뮤니티 보호)

```
페르소나 댓글 비율  ≤ 30%       ← 상시 감시. 넘으면 자동 감속
같은 회원에게       하루 1건 · 주 3건
같은 글에           페르소나 1명 (2단계 이후 최대 2명)
회원 댓글 3개 이상  🔴 개입하지 않는다
```

### 봇끼리 상호작용 — 3단 개방

| 단계 | 조건 | 허용 |
|---|---|---|
| 1단계 (현재) | 회원 4명 | 🔴 **전면 금지** |
| 2단계 | 페르소나 댓글 비율 30% 이하 안정 | 같은 글 최대 2명 · 주 1회 · 서로 다른 반응 유형 |
| 3단계 | 회원 100명+ | `PersonaRelationship` affinity 기반 자연스러운 관계 |

**전환 조건은 회원 수가 아니라 봇 비율이다.**

---

## §9 Persona Matching

크롤링된 화제 글이 들어왔을 때 **누가 이 이야기를 자기 경험처럼 쓸 것인가**를 고른다.

### 하드 필터 (점수 이전에 탈락)

```
□ isActive = false              □ dailyCap 소진
□ 활동 시간대 아님               □ noGo 에 걸리는 소재
□ 생활사 모순 (비혼인데 남편 이야기)
□ 최근 7일 내 같은 topicTag 로 발행
🔴 위기 신호 포함 화제 — 페르소나에게 주지 않는다
```

### 매칭 점수 (0~100)

| 축 | 가중 | 내용 |
|---|---|---|
| 소재 적합성 | 35 | topicTags ↔ Identity(parentCare · menopause · children …) |
| 생활사 정합성 | 25 | 🔴 모순이면 0점 · 즉시 탈락 |
| 말투 적합성 | 15 | writingLength ↔ 원 글 길이대 |
| 활동 분산 | 15 | 🔴 최근 활동 많으면 **감점** |
| 관심사 | 10 | interests ↔ topicTags |

### 🔴 최고점을 뽑지 않는다

**상위 3명 중 가중 무작위**로 뽑는다.
항상 최고점을 뽑으면 특정 페르소나에 활동이 몰리고, 그것이 "같은 사람이 쓴 티"의 원인이 된다
(헌법 §9-7 역지표와 직결).

---

## §10 Post Generation · Comment Distribution

### 10-1. Post Generation 입력

```
① Persona          Identity + VoiceCore + 선택된 Variation + 오늘의 Mood + SelfMemory 요약
② Source Topic     🔴 원문이 아니라 추출된 구조
                     topicTags · situationType · emotionArc · hookType
③ Story Reference  story_topic 1,304 중 유사 구조 2~3건
                     🔴 사건 구조만. 말투 few-shot 으로 쓰지 않는다
④ Voice Anchors    voice_gold 3~5건 (few-shot)
                     🔴 voice_silver 는 예시로 쓰지 않는다
⑤ Constraints      noGo · 길이 밴드 · 금지 표현 · 직전 3회 variation 제외
```

### 출력

```
{ title, body,
  meta: { personaId, variationKey, moodSeed, sourceTopicId, storyRefs[],
          voiceAnchors[], generationAttempt, model, tokens, cost },
  selfCheck: { estimatedSignals: {nat, vR, oD, exp, seq},
               claimedFacts: [] }   ← SelfMemory 후보
}
🔴 원문 · 프롬프트는 저장하지 않는다
```

### 10-2. Comment Distribution — 반응 지도만 쓴다

헌법 §8-2 가 *"원문 댓글은 부속물이 아니라 반응 지도다"* 라고 이미 정의했다.

```
원문 댓글 12개
   ↓  🔴 문장은 버린다
반응 지도 { 공감 5 · 경험공유 4 · 조언 2 · 다른관점 1 }
   ↓
페르소나 3명에게 유형 분배 (서로 다른 유형)
   ↓
각자 자기 정체성 · variation · mood 로 생성
```

### 반응 유형 5종

| 유형 | 어울리는 `commentHabit` |
|---|---|
| 공감 | 공감 먼저 |
| 자기 경험 공유 | 경험 공유 |
| 조심스러운 조언 | 조심스러운 조언 |
| 다른 관점 | 🔴 반박이 아니라 다른 각도 |
| 가벼운 유머 | personality 유머 태그 |

### 분산 규칙

```
□ 같은 글의 댓글은 서로 다른 페르소나에서 나온다
□ 🔴 여러 페르소나가 같은 반응 유형을 반복하지 않게 분산한다
□ 한 페르소나가 같은 글에 두 번 달지 않는다
□ 시간차를 둔다 (즉답 금지)
🔴 원댓글 문장 복사 금지 — 구조만 참고
🔴 회원 댓글이 이미 충분하면(3개+) 페르소나는 끼지 않는다
```

댓글 3개가 전부 공감형이면 사람이 쓴 것처럼 보이지 않는다.

---

## §11 Voice Engine 과의 관계

| 자산 | 용도 | 제약 |
|---|---|---|
| **voice_gold 135** | 기준 문체 anchor · few-shot 예시 | `speakerVerified=true` |
| **voice_silver 1,065** | 🔴 **통계적 참고만** — 어휘 분포 · 문체 다양성 | 🔴 few-shot 예시 금지. `speakerVerified=false`, 남성 화자 3~11% 혼입 가능 |
| **story_topic 1,304** | 사건 구조 · 소재 · 댓글 반응 구조 | 🔴 **말투 few-shot 으로 쓰지 않는다** (`usableForVoice=false`) |
| held 11 · excluded_manual 15 · mimicry_review 449 | 🔴 학습 금지 또는 보류 | |

### 🔴 원문 0% 유사성이 목표가 아니다

목표는 **충분한 오리지널리티와 소란소란식 재맥락화**다.
원문을 한 단어도 못 쓰게 하면 "시어머니" 도 "갱년기" 도 쓸 수 없다.

| 허용 🟢 | 금지 🔴 |
|---|---|
| 주제 | 긴 문장 복사 |
| 상황 유형 | 고유 표현 · 개인 말버릇 |
| 감정 흐름 | 원문 감정선의 과도한 복제 |
| 일반 표현 · 관용구 | 닉네임 |
| 댓글 **반응 구조** | **원댓글 문장** |
| 문단 호흡 | 식별 디테일 (지명 · 기관 · 병원 · 날짜) |

---

## §12 Safety / Originality Gate

🔴 **생성기보다 먼저 설계한다.**
VE-M3 에서 배운 것 — **가드를 나중에 붙이면 이미 나간 것을 되돌릴 수 없다.**

### 관문 (하나라도 실패 → 재생성, 3회 실패 → 폐기)

| # | 관문 | 판정 | 재사용 자산 |
|---|---|---|---|
| 1 | **20자 연속 유출** | 원문 · 댓글과 대조 | 🟢 `assertNoSourceLeak()` (9,411건 검증됨) |
| 2 | **닉네임 재사용** | 학습 데이터 author · 회원 닉네임 | 🟢 PR #204 원칙 |
| 3 | **식별 디테일** | 지명 · 기관 · 병원 · 날짜 · 숫자 **2개 이상 결합** | 신규 |
| 4 | **원문 문장 순서** | 🔴 **3개 이상 동일** | 신규 |
| 5 | **금지 호칭** | 시니어 · 어르신 · 노인 · 실버 | 🟢 `M3_FORBIDDEN_ADDRESS_TERMS` |
| 6 | **페르소나 정체성 모순** | SelfMemory · Identity 충돌 | 신규 |
| 7 | **n-gram 중복** | 🔴 최근 생성물과 문장 지문 중복 | 헌법 §9-7 |
| 8 | **AI 말투** | "추천드립니다" · 구조화 나열 · 불릿 · 마크다운 | 신규 |

### 🔴 위기 신호 — 별도 경로

```
자해 · 자살 신호 감지
  → 페르소나 응답 중단
  → 운영자 즉시 알림
  → 🔴 페르소나가 상담자 역할을 하지 않는다
```

봇이 위로하려다 상황을 악화시키는 것이 최악이다. **사람에게 넘긴다.**

### 조언 제한

```
🔴 금지  진단 · 약 · 용량 · 병원/의사 추천 · 법적 판단 · 소송 · 투자 · 대출 · 구체 금액
🟢 허용  "저도 그랬어요" 경험 공유 · "병원 가보셨어요?" 정도의 권유 · 감정 공감
```

### AI 말투 차단 / 오히려 필요한 것

```
🔴 차단  "~하시는 것을 추천드립니다" · "도움이 되셨으면 좋겠습니다"
        먼저/다음으로/마지막으로 구조화 · 불릿 · 번호 · 마크다운
        과도한 존댓말 일관성 · 이모지 남용
🟢 필요  오타 · 불규칙 띄어쓰기 · 줄바꿈 습관 · "ㅋㅋ" · "..." 같은 구어 표지
```

---

## §13 Operator Approval Flow

```
생성 → Safety Gate 통과 → 승인 대기열
                              ↓
                     운영자가 읽는다
          ┌────────────┼────────────┐
       승인          수정 후 승인      폐기
          ↓              ↓            ↓
        발행       수정본 발행      사유 코드 기록
                   🔴 수정 diff 기록
                      (개선 근거)
```

### 대기열 화면에 있어야 할 것

```
생성물          제목 · 본문 · 반응 유형
페르소나        누가 · 왜 매칭됐는지 (매칭 점수) · 어떤 variation · 오늘 mood
Safety Gate     8관문 결과 · 재생성 횟수
자기 검증        신호 5종 (gold 평균 대비)
소스            topicTags · storyRefs · 🔴 원문 링크는 운영자만
```

### 🔴 자동 발행은 계획하지 않는다

```
1차   전건 승인
2차   페르소나별 신뢰도 — 30건 연속 무수정 통과 시 부분 자동화 **검토**
자동  🔴 현 단계에서 계획하지 않는다
```

---

## §14 DB 스키마 후보

🔴 **migration 하지 않는다. 후보만 남긴다.**

### 신규 테이블

| 테이블 | 출처 | 내용 |
|---|---|---|
| `Persona` | 헌법 §9-5 | 최상위 (아래 둘로 분리 제안) |
| `PersonaIdentity` | 🆕 | 변하지 않는 삶의 설정 (§3) |
| `PersonaVoiceProfile` | 🆕 | 기본 말투 = Voice Core (§4) |
| `VoiceVariation` | 헌법 §9-5 | 상황별 변주 5~8개 (§5) |
| `PersonaMoodState` | 🆕 | 오늘의 컨디션 (§6) |
| `PersonaSelfMemory` | 헌법 `PersonaMemory` 분리 | 자기가 한 말 |
| `PersonaActivity` | 헌법 `PersonaMemory` 분리 | 활동 이력 (해시 + 요약) |
| `PersonaUserRelationship` | 🆕 | 🔴 가장 민감 (§7) |
| `PersonaRelationship` | 🆕 | 페르소나 간 관계 (§8) |
| `PersonaActivityRhythm` | 🆕 | 활동 리듬 (§8) |
| `PersonaGenerationLog` | 🆕 | 생성 시도 · Gate 결과 · 비용 |
| `PersonaApprovalQueue` | 🆕 | 승인 대기열 |

### 기존 테이블 변경 후보

```
Comment.personaId  String?    ← 🔴 헌법 §5-3 에서 이미 예고됨
Post.personaId     String?    🆕 (헌법에 없음 — 글도 만들기 때문)
Persona.userId     @unique → User   🔴 Post.authorId NOT NULL 제약 때문에 필수
```

### 🔴 `User.isPersona` 는 신중히 검토한다

기본 권고는 **역참조 방식(`Persona.userId`)** 이다.

헌법 §5-2 가 *"`authorId` 를 nullable 로 변경 = 파괴적 스키마 변경. 기존 목록 · 상세 쿼리와
`author` join 전부에 영향"* 이라고 경고한 것과 같은 이유다.
`User` 에 컬럼을 더하면 기존 쿼리 전반을 다시 검토해야 한다.

### 저장하는 것 / 하지 않는 것

| 저장 O | 저장 X |
|---|---|
| Identity · VoiceProfile · Variation | LLM 프롬프트 · 응답 원문 |
| SelfMemory 사실 요약 | 학습 데이터 원문 |
| 생성물 해시 + 요약 | 회원 원문 사본 |
| Gate 결과 코드 · 비용 · mood seed | 추론한 회원 정보 |
| `knownFacts` (회원 공개분) | 회원 개인정보 |

---

## §15 🔴 공개 · 신뢰 정책 — 창업자 미결정

| 안 | 방식 | 위험 |
|---|---|---|
| **A. 완전 은폐** | 표시하지 않음 | 🔴 **장기 신뢰 리스크 큼** — 나중에 알려지면 무너진다 |
| **B. 완전 표시** | 댓글마다 봇 배지 | 🔴 **커뮤니티 온기 훼손 가능** |
| **C. 중간 공개** | 아래 | Codex 권고 |

### C — 중간 공개 (Codex 권고)

```
🔴 DB / 운영자 화면에서는 PERSONA 를 명확히 구분한다   (CommentOrigin.PERSONA — 이미 존재)
🔴 외부에 완전히 은폐하지 않는다
🟡 댓글마다 큰 봇 배지는 보류
🟢 프로필 · 운영정책에서 "소란소란 운영 페르소나" 성격을 밝히는 방향
```

**기술 결정이 아니라 커뮤니티 신뢰에 관한 창업자 결정이다.**
헌법의 *"목적은 커뮤니티 신뢰와 참여"* 에 직접 걸린다. **미결정으로 남긴다.**

---

## §16 MVP 단계

```
0단계  기준선 측정 (페르소나 0명)
       댓글 0개 글 비율(현재 65%) · 첫 글 24h 재방문 · 7일 재방문 · 두 번째 글 작성률
       🔴 이 수치 없이는 효과를 판단할 수 없다

1단계  Persona Registry 설계
       스키마 + 20~30명 정의 (사람이 작성) · 🔴 TS 상수 배열 금지

2단계  🔴 Safety / Originality Gate
       8관문 + 위기 신호 경로 + fixture + 역검증
       🔴 생성기 없이 가드만. 막을 수 없으면 만들지 않는다

3단계  M3 반응 지도 최소 설계
       🔴 §10-2 의 입력. 헌법 마일스톤 M3 의존

4단계  후보 생성 (댓글 우선)
       Matching + Variation/Mood 선택 + Comment Distribution
       🔴 발행 없음. 대기열까지만

5단계  운영자 승인 UI
       승인 · 수정 · 폐기 + 수정 diff 기록

6단계  제한 발행
       활성 3~5명 · 일일 상한 · 봇끼리 금지 · 전건 승인
```

### 중단 조건

```
🔴 즉시   원문 20자 유출 1건 · 개인정보 노출 1건 · 회원 불쾌감 1건 ·
         의료/법률/재무 단정 조언 1건 · 위기 신호 글에 페르소나 응답
🟡 검토   운영자 수정률 30%+ · Gate 재생성률 50%+ · 페르소나 모순 3건+ ·
         문장 지문 중복률 상승 · 🔴 페르소나 댓글 비율 30% 초과
```

---

## §17 다음 우선순위

```
1) Persona Architecture 문서 PR        ← 이 문서
2) 🔴 공개 · 신뢰 정책 결정             창업자 결정. 나머지 설계 방향을 좌우한다
3) Safety / Originality Gate 설계      생성기보다 먼저
4) M3 반응 지도 최소 설계               §10-2 의 입력
5) Persona Pool 20~30명 설계
6) 후보 생성 도구
7) 운영자 승인 UI
8) Metrics Loop
```

---

## §18 현 시점 금지

```
🔴 Persona Bot 구현 · 글 생성 실험 · Safety Gate 구현
🔴 DB migration · Prisma schema 수정
🔴 src/ · scripts/ 수정
🔴 SEO 작업 · 추가 워크벤치
🔴 DB write · 유료 LLM/API 호출
```

이번 단계는 **설계 문서화**다.

---

## §19 참조

| 문서 | 내용 |
|---|---|
| [Persona Network 전략](2026-08-29-persona-network-strategy.md) | 무엇을 만들 것인가 · 시스템 흐름 11단계 |
| [VE-M3 학습 후보 선별 정책](2026-08-29-voice-m3-learning-policy.md) | voice_gold/silver · story_topic · manual override |
| [VE-M3 export 설계](2026-08-29-voice-m3-export-design.md) | 산출물 · 유출 방지 4중 |
| [Micro Seed Lane 헌법](../constitution/MICRO_SEED_LANE_CONSTITUTION.md) | 🔴 **§9 페르소나 원칙** · §8-2 반응 지도 · §12 M4 |
| [판정 데이터](decisions/ve-m3-manual-decisions.json) | 창업자 수동 판정 183건 |

🔴 **분석 모델(claude-haiku-4.5)은 생성 모델이 아니다.** 생성 모델은 별도 실험으로 정한다.
