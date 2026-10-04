# Persona MVP 활성화 설계 — 초기 5명

> 📜 **역사 문서 — 현재 정책에 투표하지 않는다.** 현재 권위와 상태는
> [`README.md`](./README.md)가 가리키는 네 문서가 정한다.
> 작성 2026-08-30 · 상태 **당시 설계 기록 · MVP 및 Wave2 활성화 구현 완료**
> 선행: [Persona Pool 설계](2026-08-30-persona-pool-design.md) · [M3 반응 지도](2026-08-30-m3-reaction-map-design.md) · [Safety / Originality Gate](2026-08-30-persona-safety-originality-gate-design.md)

---

## §0 전제 결정 (창업자 확정)

```
🔴 ageBand 확장 보류        현행 4밴드 유지 (40대 후반 · 50대 초반 · 50대 후반 · 60대 초반)
🟢 MVP 초기 활성 5명        Pool 20명 중 선정
🔴 displayName 작명 보류    Gate ⑥ 닉네임 중복 검사 설계 이후
```

이 문서는 **누구를 먼저 켤 것인가**를 정한다. 켜는 방법은 정하지 않는다.

---

## §1 선정 결과 — P05 · P07 · P10 · P15 · P17

| 코드 | 라벨 | ageBand | 지역 | 혼인 | 자녀 | 일 | 형편 | 갱년기 | 간병 |
|---|---|---|---|---|---|---|---|---|---|
| **P05** | 시어머니 모시는 집 | 40대 후반 | 읍면 | 기혼(원만) | 2 (동거) | 전업 | 보통 | **전** | **상시** |
| **P07** | 대학생 하나, 요양원 오가며 | 50대 초반 | 광역시 | 기혼(원만) | 1 (동거) | 파트타임 | 빠듯 | **진행중** | 간헐 |
| **P10** | 다시 일자리 찾는 중 | 50대 초반 | 광역시 | **이혼** | 1 (분가·소원) | **구직** | **어려움** | **진행중** | 없음 |
| **P15** | 혼자 살며 부모를 돌보는 | 50대 후반 | 수도권 | **비혼** | **없음** | 직장 | 보통 | **후** | **상시** |
| **P17** | 손주 보는 재미로 | 60대 초반 | 수도권 | 기혼(원만) | 2 (분가·손주) | **은퇴** | 보통 | **후** | 없음 |

---

## §2 선정 기준 ① — 글 유형 커버리지

**선정의 1순위 기준이다.** 5개 글 유형 각각에 `experience` 자격자가 **최소 2명**씩 있어야 한다.

| 글 유형 | 글수(실측) | `experience` 자격 | 커버 |
|---|---|---|---|
| 가족 · 관계 갈등 | 2,040 | **P05**(시댁·간병) · **P17**(성인 자녀·손주) | 🟢 2명 |
| 건강 · 갱년기 · 병원 | 1,285 | **P07**(갱년기·간병) · **P15**(간병·갱년기 후) | 🟢 2명 |
| 돈 · 일 · 자산 | 2,125 | **P07**(파트타임) · **P10**(구직·형편) | 🟢 2명 |
| 외로움 · 감정 토로 | 1,895 | **P10**(이혼 후) · **P15**(독거) | 🟢 2명 |
| 생활 정보 · 잡담 | 2,329 | **P05**(살림) · **P17**(취미·손주) | 🟢 2명 |

### 🔴 왜 유형당 2명인가

```
1명이면   그 페르소나가 silenceRate 로 침묵하는 날
          그 유형 글에는 experience 를 쓸 사람이 아무도 없다
          → 공감·질문만 붙어 대화가 얕아진다

2명이면   한 명이 빠져도 유형이 비지 않는다
          두 명이 다르게 말하므로 같은 유형이라도 반응이 흔들린다
```

**5명 × 주축 2개 = 10슬롯이 5유형에 정확히 2개씩 배분된다.** 낭비도 공백도 없다.

---

## §3 선정 기준 ② — 서로 닮지 않을 것

같은 유형을 담당해도 **다른 사람으로 읽혀야** 한다.

| 축 | P05 | P07 | P10 | P15 | P17 | 판정 |
|---|---|---|---|---|---|---|
| **ageBand** | 40후 | 50초 | 50초 | 50후 | 60초 | 🟢 4밴드 전부 |
| **혼인** | 기혼(원만) | 기혼(원만) | 이혼 | 비혼 | 기혼(원만) | 🟡 기혼 3 |
| **자녀** | 2 동거 | 1 동거 | 1 분가·소원 | **없음** | 2 분가·손주 | 🟢 전부 다름 |
| **일** | 전업 | 파트타임 | 구직 | 직장 | 은퇴 | 🟢 **5종 전부** |
| **형편** | 보통 | 빠듯 | 어려움 | 보통 | 보통 | 🟢 3종 |
| **갱년기** | 전 | 진행중 | 진행중 | 후 | 후 | 🟢 3종 전부 |
| **지역** | 읍면 | 광역시 | 광역시 | 수도권 | 수도권 | 🟡 중소도시 0 |
| **간병** | 상시 | 간헐 | 없음 | 상시 | 없음 | 🟢 3종 전부 |

### §3-1 `voiceCore` — 다섯이 전부 다르다

```
P05   짧고 툭툭 · 구어체 · "~네요" · 띄어쓰기 불규칙 · 이모티콘 가끔
P07   중간 길이 · "~더라고요" · 존댓말 · 이모티콘 드묾
P10   중간 길이 · "ㅎㅎ" 가끔 · 오타 있음 · 말끝 흐림
P15   짧고 정확 · 존댓말 · 이모티콘 없음 · 문장 사이 여백
P17   길게 · 구어체 · 이모티콘 자주 · 감탄사 많음
```

**길이 · 말끝 · 이모티콘 · 오타 네 축이 서로 겹치지 않는다.**
한 글에 다섯이 나란히 달려도 같은 사람으로 읽히지 않는다.

### §3-2 `activityRhythm` — 시간대를 흩는다

```
P05  전업 + 간병 상시   오전 늦게~점심 · 저녁 짧게      빈도 중
P07  파트타임 + 간병     이른 아침 · 밤 9~11시           빈도 중
P10  구직               낮 산발 · 밤 늦게               빈도 높음
P15  직장 + 간병 상시    출근 전 · 밤 10시 이후          빈도 낮음
P17  은퇴               오전~오후 폭넓게                빈도 높음
```

🔴 **리듬이 겹치면 댓글이 한꺼번에 달린다.** 그것 자체가 AI 티다.
생활 조건에서 리듬이 나오게 했다 — 직장인은 출퇴근 전후, 은퇴자는 낮에 있다.

### §3-3 `silenceRate` 상대 서열

```
높음  P15   과묵 · 직장 · 간병 상시로 시간이 없다
중    P05 · P07
낮음  P10 · P17   시간이 많고 말수가 있다

🔴 절대값은 구현 시 결정한다 (Pool 설계 §10-③)
   여기서는 **서로 달라야 한다**는 것과 상대 서열만 고정한다
```

### §3-4 🟡 인정하는 편중 두 가지

```
🟡 기혼(원만) 3명    P05 · P07 · P17
   → 이혼(P10) · 비혼(P15)이 있어 혼인 축이 완전히 단조롭지는 않다
   → 다만 갈등/사별/별거가 없다. 무거운 관계 서사는 2차 활성에서 연다

🟡 중소도시 0명
   → 읍면 · 광역시 · 수도권 3종으로 시작한다
   → 2차 활성 시 P14 · P19(중소도시)를 우선 후보로 둔다
```

**의도적 선택이다.** 초기 5명에 갈등·사별을 넣으면 커뮤니티 첫인상이 무거워진다.

---

## §4 역할 매트릭스

```
W  작성자 후보          E  experience 가능
M  empathy 가능         Q  question 가능
L  levity 가능
S  🔴 침묵 권장 — silenceRate 로 확률 조절 (참여 자체는 가능)
X  🔴 hard forbidden — forbiddenReactionRoles 로 차단 (확률 아님)
```

🔴 **`S` 와 `X` 는 다르다.** `S` 는 "웬만하면 하지 마라"이고 `X` 는 "코드가 막는다"이다.

| 글 유형 | P05 | P07 | P10 | P15 | P17 |
|---|---|---|---|---|---|
| **가족 · 관계 갈등** | **W · E**(시댁·간병) M Q L | M Q | M Q | 🔴 **X**(부부·자녀 E) · S | **W · E**(성인 자녀·손주) M Q L |
| **건강 · 갱년기 · 병원** | M Q · 🔴 **X**(advice·info) | **W · E**(갱년기·간병) M Q · 🔴 **X**(advice·info) | 🔴 **S** · **X**(advice·info) | **W · E**(간병·갱년기 후) M Q · 🔴 **X**(advice·info) | M Q · 🔴 **X**(advice·info) |
| **돈 · 일 · 자산** | 🔴 **S** | **W · E**(파트타임) M Q · 🔴 **X**(financial advice) | **W · E**(구직·형편) M Q L · 🔴 **X**(financial advice) | Q M · 🔴 **X**(financial advice) | 🔴 **S** |
| **외로움 · 감정 토로** | M · 🔴 **X**(advice·caution·rebuttal) | 🔴 **S** | **W · E**(이혼 후) M Q · 🔴 **X**(advice·caution·rebuttal) | **W · E**(독거) M Q · 🔴 **X**(advice·caution·rebuttal) | 🔴 **S** |
| **생활 정보 · 잡담** | **W · E**(살림) M Q L | M Q L | M Q L | Q | **W · E**(취미·손주) M Q L |

🟢 **생활 정보 · 잡담이 `X` 가 하나도 없는 유일한 유형이다.** 가장 안전하다 —
MVP 를 이 유형부터 여는 선택지도 있다(§8-⑨).

### §4-1 전 유형 공통 금지

```
🔴 advice      건강 · 외로움 글에서는 5명 전원 금지
               돈 글에서는 재무 advice 전원 금지
               가족 글에서는 판단형 advice 전원 금지
🔴 information  건강 · 돈 글에서 전원 금지
🔴 caution      외로움 글에서 전원 금지
🔴 rebuttal     외로움 글에서 전원 금지
```

### §4-2 개별 하드 차단

| 페르소나 | 🔴 `forbiddenReactionRoles` |
|---|---|
| P05 | `advice`(의료) · `information` · `caution` |
| P07 | `advice`(의료) · `information` · `caution` |
| P10 | `advice`(재무·법률) · `caution` · `information` |
| P15 | **`experience`(부부·자녀)** · `advice`(의료) · `caution` · `levity`(무거운 글) |
| P17 | `advice` · `caution` · `information` · `rebuttal` |

🔴 **P15의 `experience`(부부·자녀) 차단이 가장 중요하다.**
비혼·무자녀 페르소나가 육아 seed 를 재작성하면 **존재하지 않는 자녀가 생기고**,
그 순간 Gate ⑦ Persona Consistency 위반이다.

### §4-3 침묵 배치의 의도

```
가족 글    P15 침묵    → 부부·자녀 경험이 없다
건강 글    P10 침묵    → 여유가 없어 무심하게 읽힌다
돈 글      P05 · P17 침묵 → 전업 · 은퇴라 실감이 없다
외로움 글  P07 · P17 침묵 → 해결책으로 새거나 톤이 밝다
잡담 글    침묵 없음   → 🟢 가장 안전한 유형. 다섯 다 참여 가능
```

**유형마다 2~3명만 참여하는 것이 정상이다.** 다섯이 모든 글에 달리면 그것이 AI 티다.

### §4-4 seed 등급 배정

| 등급 | MVP 5명 적용 |
|---|---|
| **A** | 🟢 5명 전원 — 짧은 일반 반응. 🔴 동일 seed 반복 금지 · 글 단위 배분 |
| **B** | 🟡 해당 유형 `E` 자격자만 (§4 표의 `E`) — 페르소나 말투로 재작성 |
| **C** | 🔴 전원 문장 재사용 불가. 역할·구조만 |

---

## §5 비활성 15명 — 왜 지금 켜지 않는가

| 사유 | 페르소나 | 설명 |
|---|---|---|
| **주축 중복** | P01 P03 P11 P12 P14 P19 P20 | 활성 5명이 이미 덮는 유형이다. 켜면 다양성이 아니라 밀도만 늘어난다 |
| **무거운 관계 서사** | P06(부부 갈등) P08(사별) P13(부부 갈등) P16(별거) P18(사별) | 🔴 초기 커뮤니티 첫인상이 무거워진다. 실회원이 늘고 나서 연다 |
| **Gate ⑧ 사전 위험** | P09(정리벽) P13(감정 과다) P17*(이모티콘 반복) | Pool 설계 §7-3에서 미리 표시한 셋. **P17만 예외적으로 활성** |
| **역할 폭 좁음** | P02(advice·caution·rebuttal 전부 금지) P04(자녀 E 불가) | 참여 가능 범위가 좁아 초기 5명으로는 효율이 낮다 |

### §5-1 🔴 P17을 위험 표시에도 켜는 이유

```
P17 은 Gate ⑧ "이모티콘 · 감탄사 반복" 위험이 미리 표시된 페르소나다.
그럼에도 켜는 이유 —

  ① 60대 초반이 P17 뿐이다. 빼면 ageBand 한 밴드가 통째로 빈다
  ② 밝은 톤이 5명 중 유일하다. 없으면 전체가 가라앉는다
  ③ 🟢 위험이 **미리 보이는** 페르소나라 관찰 대상으로 적합하다

🔴 대신 운영 초기에 ⑧ 태그를 우선 관찰한다.
   "말투 반복" 태그가 반복되면 P17 을 먼저 조정한다.
```

**위험이 없는 페르소나가 아니라 위험을 아는 페르소나로 시작한다.**

### §5-2 2차 활성 우선순위 (권고 · 미확정)

```
1순위  P14 또는 P19   중소도시 축이 비어 있다 (§3-4)
2순위  P11            읍면 · 다자녀 · 밝은 톤
3순위  P08 또는 P18   외로움 축 심화 — 🔴 실회원 밀도가 오른 뒤
```

---

## §6 Persona DB 모델 검토 — 필드 후보

> 🔴 **Prisma schema 를 작성하지 않는다.** 아래는 **검토용 필드 목록**이며 스키마 문법이 아니다.
> migration · seed 파일도 만들지 않는다. [Architecture §14](2026-08-30-persona-architecture-design.md) 후보를 기준으로 한다.

### §6-1 `Persona` — 정체성 (고정)

| 필드 | 타입 후보 | 제약 · 비고 |
|---|---|---|
| `id` | uuid | |
| `code` | string | 🔴 `P01`~ 내부 코드. **unique** · 외부 노출 금지 |
| `displayName` | string? | 🔴 **nullable 로 시작** — 작명 전까지 비운다 |
| `userId` | string | 🔴 **unique** → `User`. `Post.authorId` NOT NULL 때문에 필수 |
| `ageBand` | enum 4 | 40대 후반 / 50대 초반 / 50대 후반 / 60대 초반 |
| `gender` | enum 1 | 🔴 `female` 고정 |
| `region` | enum 4 | 수도권 / 광역시 / 중소도시 / 읍면 — 🔴 시·구 단위 없음 |
| `lifeStage` | enum | 자녀 양육 / 자녀 독립 / 남편 은퇴 / 재취업 고민 / 노후 준비 |
| `maritalStatus` | enum 5 | 기혼 / 사별 / 이혼 / 별거 / 비혼 |
| `spouseRelationship` | enum 4 | 원만 / 소원 / 갈등 / 해당없음 |
| `childrenCount` | int | 0~3 |
| `children` | json | `[{ ageBand, gender, livingWith }]` — 🔴 나이 아닌 밴드 |
| `childRelationship` | enum 4 | 가까움 / 보통 / 소원 / 해당없음 |
| `parentCare` | enum 3 | 없음 / 간헐 / 상시 |
| `workStatus` | enum 5 | 전업 / 파트타임 / 자영업 / 구직 / 은퇴 |
| `economicStatus` | enum 4 | 여유 / 보통 / 빠듯 / 어려움 |
| `housing` | enum 3 | 자가 / 전세 / 월세 |
| `healthBands` | json | 관절 · 혈압 · 수면 · 체중 — 🔴 **병명 컬럼 없음** |
| `menopauseStatus` | enum 3 | 전 / 진행중 / 후 |
| `personality` | string[] | 5~7개 태그 |
| `coreWound` | string? | 🔴 요약 한 줄. 사건 서술 금지 |
| `warmPoint` | string? | |
| `noGoTopics` | string[] | |
| `noGoExpressions` | string[] | 공통분 + 개별분 |

### §6-2 `PersonaVoice` — 말투

| 필드 | 타입 후보 | 비고 |
|---|---|---|
| `personaId` | fk | |
| `lengthBand` · `endings` · `politenessBase` · `emojiPattern` · `typoPattern` · `hookTypes` | enum / string[] | 🔴 오타는 교정 대상이 아니다 |
| `voiceAnchors` | string[] | voice_gold `sourceRef` 3~5건 참조 |
| `targetSignals` | json | nat/vR/oD/exp/seq 목표 밴드 |

### §6-3 `VoiceVariation` — 변주 5~8개

| 필드 | 타입 후보 | 비고 |
|---|---|---|
| `personaId` · `variationKey` | fk / string | **unique(personaId, variationKey)** |
| `lengthBand` · `hookType` · `endingUsed` · `emojiUsed` · `politenessDelta` | enum / int | |
| `contextFit` | enum 3 | post / comment / reply |
| `ngramFingerprint` | json | 헌법 §9-7 지문 중복률 근거 |
| `lastUsedAt` | datetime? | 🔴 **직전 3회 제외**의 근거. 인덱스 후보 |

### §6-4 운영 · 리듬

| 필드 | 타입 후보 | 비고 |
|---|---|---|
| `isActive` | boolean | 🟢 **MVP 5명만 true** |
| `status` | enum | draft / active / paused / retired |
| `activityRhythm` | json | 시간대 · 빈도 |
| `silenceRate` | float | 🔴 기본값 **구현 시 결정** |
| `dailyCap` · `weeklyCap` | int | 🔴 기본값 구현 시 결정 |
| `eligibleReactionRoles` | string[] | §4 표 |
| `forbiddenReactionRoles` | string[] | 🔴 §4-2 하드 차단 |
| `createdAt` · `retiredAt` | datetime | |

### §6-5 `PersonaActivityRhythm` — 리듬 (별도 모델 후보)

`Persona` 안의 json 으로 둘 수도 있으나, **시간대별 조회가 필요해지면 별도 모델이 낫다.**

| 필드 | 타입 후보 | 비고 |
|---|---|---|
| `personaId` | fk | |
| `slots` | json 또는 행 분리 | 요일 · 시간대 · 활동 확률 |
| `frequencyBand` | enum 3 | 낮음 / 중 / 높음 |
| `silenceRate` | float | 🔴 기본값 구현 시 결정 |
| `dailyCap` · `weeklyCap` | int | 🔴 기본값 구현 시 결정 |

🔴 **json 인가 행 분리인가는 결정하지 않는다**(§6-8).
"지금 이 시간에 활동 가능한 페르소나" 를 자주 조회하면 행 분리가 유리하다.

### §6-6 메모리 4종 (Pool 설계 §8)

| 모델 후보 | 핵심 필드 | 🔴 제약 |
|---|---|---|
| `PersonaSelfMemory` | `personaId` · `factKey` · `summary` · `statedAt` | 원문 전문 저장 금지 |
| `PersonaUserRelationship` | `personaId` · `userId` · `knownFacts` · `doNotMention` · `closeness` · `lastInteractionAt` | 🔴 회원이 **직접 공개한 것만** · 탈퇴 시 **전량 삭제** · **unique(personaId, userId)** |
| `PersonaTopicMemory` | `personaId` · `topicKey` · `reactionType` · `count` · `lastAt` | 롤링. 개별 글 원문 없음 |
| `PersonaNegativeMemory` | `personaId` · `userId?` · `patternKey` · `reason` · `createdAt` | 🆕 피해야 할 말·상황. 🔴 **회원 평가·낙인 저장 금지** — 페르소나의 행동 제약만 |

🔴 **`PersonaNegativeMemory` 가 회원을 평가하는 테이블이 되면 안 된다.**
*"이 회원은 예민함"* 이 아니라 *"이 주제에서는 조언하지 않는다"* 를 담는다.
`userId` 가 nullable 인 이유가 이것이다 — 회원 무관한 전역 제약도 들어간다.

### §6-7 인덱스 후보

```
Persona                  code(unique) · userId(unique) · isActive
VoiceVariation           (personaId, variationKey) unique · (personaId, lastUsedAt)
PersonaActivityRhythm    (personaId)
PersonaTopicMemory       (personaId, topicKey)
PersonaNegativeMemory    (personaId) · (userId)
🔴 PersonaUserRelationship  (personaId, userId) unique · **(userId)**
```

🔴 **마지막 줄의 `(userId)` 단일 인덱스가 핵심이다.**

```
회원 탈퇴 시   userId 로 걸린 RelationshipMemory 를 **즉시 전량 삭제**해야 한다
              (personaId, userId) 복합 인덱스만 있으면 userId 단독 조회가 느리다
              → 활성 페르소나가 늘수록 삭제가 무거워진다

🔴 지우는 경로를 설계 단계에서 먼저 만들어 둔다.
   NegativeMemory 의 (userId) 도 같은 이유다.
```

Pool 설계 §8-4 의 *"익명화가 아니라 삭제"* 를 실행 가능하게 하는 것이 이 인덱스다.

### §6-8 🔴 이 단계에서 결정하지 않는 것

```
🔴 enum 을 DB enum 으로 둘지 string 으로 둘지
   VoiceSource.origin 이 "enum 이 아니다 — 값이 늘 때마다 migration 을 요구하면
   source 추가가 schema 작업이 된다" 는 이유로 string 이다. 같은 판단이 필요하다
🔴 Persona ↔ User 생성 순서 · 트랜잭션 경계
🔴 Comment.personaId 컬럼을 둘지 (헌법 §12 에 후보로 예고됨)
```

---

## §6-9 이번 설계에서 하지 않은 것

```
🔴 Persona Bot 생성            5명을 고른 것이지 만든 것이 아니다
🔴 displayName 작명            Gate ⑥ 닉네임 중복 검사 설계 이후
🔴 DB schema · migration       위 §6 은 검토용 필드 표이지 스키마가 아니다
🔴 seed 파일 생성
🔴 댓글 · 글 생성 실험
🔴 LLM / API 호출
🔴 자동 발행 구현   ← 이번 단계 한정. 정책상으로는 최종 목표(전략 §4-0)
🔴 코드 수정 · DB write
```

**이 문서가 만든 것은 명부 다섯 줄과 자격 표 하나다.** 그 외에는 아무것도 움직이지 않았다.

---

## §7 현 시점 금지

```
🔴 Prisma schema 작성 · migration · seed 파일 생성
🔴 실제 persona 데이터 DB 삽입 · displayName 배정
🔴 Persona Bot 생성 · 글/댓글 생성 실험 · 자동 발행 구현   ← 이번 단계 한정
🔴 코드 수정 · DB write · LLM/API 호출
```

---

## §8 남은 결정사항

| # | 결정 | 상태 |
|---|---|---|
| ① | **MVP 5명 선정안 승인** | P05 · P07 · P10 · P15 · P17 |
| ② | 🟡 기혼(원만) 3명 · 중소도시 0명 편중 수용 여부 | §3-4 — 의도적 선택 |
| ③ | 🔴 P17 을 Gate ⑧ 위험 표시에도 켤 것인가 | §5-1 — 관찰 조건부 권고 |
| ④ | `silenceRate` · `dailyCap` · `weeklyCap` 절대값 | 🔴 구현 시 결정 |
| ⑤ | enum vs string (§6-7) | DB 모델 검토 시 |
| ⑥ | `Comment.personaId` 컬럼 신설 여부 | 헌법 §12 예고분 |
| ⑦ | ✅ **공개 · 신뢰 정책** | ✅ **확정 — 외부 비공개 / 내부 어드민 명확 구분** ([전략 §10](2026-08-29-persona-network-strategy.md)) |
| ⑧ | `displayName` 작명 | Gate ⑥ 중복 검사 설계 이후 |
| ⑨ | 🟡 **생활 정보 · 잡담 유형부터 열 것인가** | `X` 가 하나도 없는 유일한 유형이다 (§4). 가장 안전한 시작점 |

---

## §9 다음 우선순위

```
1) 🔴 결정 ① ② ③ 확정
2) Gate ⑥ 닉네임 중복 검사 설계 → displayName 작명
3) Persona DB 모델 확정 (§6 · §6-7)
4) 후보 생성 도구 (comment)   🔴 Gate 통과분만 대기열로
5) 🔴 어드민 자동화 관제실 + AI 티 태그   status · cap · kill switch · 감사 로그
6) silenceRate · seedReuseRate 기본값 실측 후 확정
```

🔴 **생성기보다 가드가 먼저라는 순서는 유지된다.**

---

## §10 참조

| 문서 | 내용 |
|---|---|
| [Persona Pool 설계](2026-08-30-persona-pool-design.md) | 20명 카드 · 스키마 초안 · Memory 원칙 |
| [M3 반응 지도](2026-08-30-m3-reaction-map-design.md) | 글 유형 5종 · roleWeights · seed A/B/C |
| [Safety / Originality Gate](2026-08-30-persona-safety-originality-gate-design.md) | 9관문 · ⑥ 닉네임 · ⑦ Consistency · ⑧ Fingerprint |
| [Persona Architecture 설계](2026-08-30-persona-architecture-design.md) | §14 DB 스키마 후보 |
