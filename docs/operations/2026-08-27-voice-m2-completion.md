# VE-M2 완료 기록 — 규칙 신호 전량 적용

> **이 문서의 역할**: VE-M2가 어디서 끝났는지를 못박는다.
> VE-M3를 시작할 때, 또는 나중에 버그를 쫓을 때 **"여기까지는 이랬다"의 기준점**이다.
>
> 🔴 **VE-M2 전 구간의 LLM · 외부 API 비용은 0원이었다.** 첫 비용은 VE-M3다(§8).
>
> 작성 2026-08-27 · 전부 read-only 실측
> 설계 정본 [VE-M2 VoiceDerived 설계](./2026-08-26-voice-derived-m2-design.md) ·
> 선행 기록 [코퍼스 적재 운영](./2026-08-26-voice-corpus-import-operations.md)

---

## 1. 최종 상태

| 자산 | 건수 |
|---|---|
| `VoiceSource` | **9,674** |
| `VoiceJudgment` | **3,093** (전부 `referenced` · `approved` **0**) |
| **`VoiceDerived`** | **9,674** = VoiceSource 전량 |
| **`VoiceCommentSignal`** | **59,252** |

`VoiceDerived` 9,674건의 메타는 **단일 조합**이다.

```
method        = 'rule'
model         = ''                    ← NULL 이 아니다 (§3 참조)
promptVersion = ''
ruleVersion   = 'voice-m2-rule-v1'
```

신호 6종(`typingArtifacts` · `punctuationHabit` · `spacingVariance` · `mobileInputTrace` ·
`communityRegister` · `artifactFrequency`)이 **9,674/9,674행 전부에 채워졌다.** 빈 신호 행은 0이다.

`VoiceJudgment`가 `VoiceSource`보다 적은 것이 정상이다 — `usedAt`이 있는 건만 판단이 따라붙는다.

---

## 2. 실행 단계 — 한 번에 넣지 않았다

되돌리기 어려운 작업은 **눈으로 확인할 수 있는 크기부터** 시작한다.
각 단계 사이에 창업자 승인이 있었고, `--apply`는 `--limit` 없이는 거부된다.

| 단계 | 저장 | 누적 Derived | 누적 CommentSignal | SKIP | 확인한 것 |
|---|---|---|---|---|---|
| 10건 | 10 | 10 | 79 | 0 | 저장 형태 · `model`/`promptVersion` 실값 · 재실행 SKIP |
| 500건 | 500 | 510 | 3,144 | 10 | **호칭 사전이 실제로 작동하는가** (§4) |
| 1,000건 | 1,000 | 1,510 | 9,395 | 510 | 규모가 커져도 지표가 안정적인가 |
| **전량** | 8,164 | **9,674** | **59,252** | 1,510 | 완주 · 무결성 |

**매 단계 PASS 기준 (공통)**

- 증가분이 실행 로그의 댓글 신호 수와 **정확히 일치**
- 중복 SKIP이 **직전 적재분과 정확히 일치** — 커서 재개가 성립한다는 증거
- `(voiceSourceId, ruleVersion, method, model, promptVersion)` 중복 **0**
- `(voiceSourceId, ordinal)` 중복 **0** · 고아 행 **0**
- 원문 20자 연속 조각 대조 **0**
- `VoiceSource` 9,674 · `VoiceJudgment` 3,093 · `approved` 0 불변
- Micro Seed 5·5·4·4 · row6 `HOLD` 불변 · Sheet write 0
- LLM/API 0 · 크롤링 0

중간에 끊겨도 같은 명령을 다시 실행하면 이어진다 — 상태 파일 없이
`UNIQUE` 제약과 id 커서만으로 성립한다. 전량 배치에서 SKIP 1,510이 그것을 증명했다.

---

## 3. 원문 유출 방지 — 무엇을 어떻게 확인했나

### 컬럼 차원

`VoiceDerived` · `VoiceCommentSignal` 두 테이블에
`content` · `body` · `rawBody` · `commentBody` · `topComments` · `author` · `nickname`
컬럼이 **하나도 없다.** `information_schema` 조회로 확인했다 — **0건**.

`VoiceCommentSignal`의 이름이 `Source`가 아니라 `Signal`인 이유가 이것이다.
댓글 본문이 필요한 순간마다 우나어 DB를 read-only로 다시 읽는다.
`authorHash`는 닉네임 원문이 아니라 salt 단방향 해시다.

### 값 차원 — 전수 대조

컬럼이 없다는 것과 **값을 통해 새지 않았다는 것은 다른 문제**다.
legacyLabels 경유로 원문 조각이 들어온 전례가 있다([VE-R3.1 · PR #93](./2026-08-26-voice-corpus-import-operations.md)).

그래서 저장이 끝난 뒤 **9,674행 전부**에 대해:

```
우나어 원문 본문 + topComments 에서 20자 조각을 떼어
저장된 VoiceDerived · VoiceCommentSignal 과 대조

조각 110,713개  →  20자 이상 연속 일치 0개
```

### 생성 금지어 차원

`targetDescriptorRisk`에 담긴 표현이 `soransoranRegister`(치환 결과 후보)로
승격된 건 **0건**이다. 방향이 반대인 갈래가 섞이지 않았다.

---

## 4. `communityRegister` 최종 분포

원출처 호칭이 **247개 행**에서 검출됐다.

| 호칭 | 건수 | 출처 |
|---|---|---|
| **우갱님들** | 173 | 우아한 갱년기 (`navercafe:wgang`) |
| **은오님들** | 42 | `navercafe:dlxogns01` |
| 우갱님 | 20 | 〃 wgang |
| **레테님들** | 11 | 레몬테라스 (`navercafe:remonterrace`) |
| 은오님 | 11 | 〃 dlxogns01 |
| 레테님 | 1 | 〃 remonterrace |

**500건 단계에서 이미 확인된 것**: 각 호칭이 **해당 카페 글에서만** 나왔다.
사전의 호칭 ↔ 카페 매핑이 추측이 아니라 실측으로 맞았다.

### `82님들`이 0인 이유

**82cook은 이 코퍼스가 아니라 Micro Seed 레인의 수집원**이다.
우나어 `CafePost`에 82cook 글이 없으므로 0이 정상이며, 결함이 아니다.
Micro Seed 쪽 원문을 다룰 때 이 호칭이 나타난다.

### `soransoranRegister`는 0이다

우나어 원문에 소란소란 호칭이 있을 리 없다.
이 자리는 **소란소란이 생성한 글**에서 채워진다.

---

## 5. `targetDescriptorRisk` 최종 분포 — 가드가 값을 한 지점

| 표현 | 건수 |
|---|---|
| 중년 여성 | 3 |
| **우리 또래** | 2 |
| 중년 여성분들 | 1 |
| 같은 세대 | 1 |
| **합** | **7** |

🔴 **이 7건은 전부 "생성 금지" 신호로만 저장됐고, 치환 후보로 승격된 건 0건이다.**

의미가 있는 결과다. `우리 또래` · `중년 여성분들`은 우리가
[PR #100](./2026-08-26-voice-derived-m2-design.md)에서 **폐기한 바로 그 표현**인데,
실제 커뮤니티 글에 존재한다. 원문에 있다는 이유로 "좋은 표현"으로 되돌아올 여지가 있었고,
가드가 그것을 막았다.

**원문에 있다 ≠ 우리가 써도 된다.** 커뮤니티 안에서 사람들은 서로를 설명하지 않는다.
소란소란 글의 호칭은 `소란님들` · `소란소란님들`이다.

---

## 6. 댓글 `reactionType` 최종 분포

| 유형 | 건수 | 비율 |
|---|---|---|
| **other** | 47,840 | **81%** |
| question | 7,769 | 13% |
| empathy | 1,842 | 3% |
| rebuttal | 862 | 1% |
| experience | 557 | 1% |
| information | 382 | 1% |

`truncated` **2,983 / 59,252 (5.0%)** — 199자에서 잘린 댓글이다.
모르고 학습하면 "우리 또래는 200자에서 말을 끊는다"는 거짓 패턴을 배운다.

### 🔴 `other` 81%는 VE-M2 규칙의 한계다

이 비율은 10건 · 500건 · 1,000건 · 전량에서 **규모와 무관하게 일정하게 재현됐다.**
사전이 부족해서가 아니다 — 별도 실측에서 `other` 중 **61%가 어떤 키워드 패턴에도 걸리지 않았다.**
감사 · 축하 · 추측/의견 같은 카테고리를 추가해도 그 61%는 남는다.

그래서 **정규식을 늘리지 않았다.** `other`가 많다는 사실 자체가
"규칙으로는 여기까지"라는 정직한 신호다. 정교한 분류는 **VE-M3에서 LLM으로 풀 문제**이지
정규식을 100줄 늘려 풀 문제가 아니다.

⚠️ **`other`를 버리지 마라.** 댓글이 붙었다는 사실 자체가 참여 신호이고,
`contentLength` · `likeCount` · `ordinal` · `truncated`는 유형과 무관하게 쓰인다.

---

## 7. 운영 영향 — 없다

| 항목 | 상태 |
|---|---|
| Micro Seed `Candidate`·`RawContent`·`History`·`Post` | **5 · 5 · 4 · 4 불변** |
| row6 (`sourceArticleId=4232060`) | DB `HOLD` · `scheduledPublishAt` null · `createdPostId` null |
| Sheet row6 | B=`HOLD` · F/P/Q 공란 |
| Sheet write | **0** (5행 불변) |
| `recover-live` dry-run divergence | **0** |
| `publisher` · `approve` · `import-82cook` · `recover` `--apply` | **0회** |
| **어드민 영향** | **없음** — Voice 자산은 어드민 화면에 노출되지 않는다 |

Voice 레일과 Micro Seed 발행 레일은 접점이 0이다. 전량 배치 중에도 그러했다.

---

## 8. 다음 단계

### VE-M3 — 첫 LLM 비용 발생 지점

VE-M2는 **전 구간 LLM · API 0원**으로 끝났다. VE-M3는 다르다.

착수 **전에** 정해야 할 것:

| 항목 | 상태 |
|---|---|
| **비용 cap** | `tokenCap` 500K/실행 · `costCap` $5/실행 — 설계는 있으나 구현 전 |
| **cache key** | `sha256(contentHash + ruleVersion + method + model + promptVersion)` 권고안 — **schema 미반영** |
| **10건 이하 dry-run** | 대표성이 아니라 **사람이 전량을 눈으로 읽을 수 있는 크기**가 목적 |
| **모델 선택** | Haiku 4.5 권장(전량 $35~40 추정) · 단가는 실행 전 콘솔 재확인 필요 |

`retry`도 cap에 포함해야 한다 — cap 밖에 두면 실패가 많을수록 비용이 커진다.
상세는 [VE-M2 설계 §5](./2026-08-26-voice-derived-m2-design.md)에 있다.

VE-M3가 계산할 품질·위험 7종은 **생성물이 있어야 성립한다.**
지금 있는 9,674건 신호가 그 비교 기준선이다.

### PR #97 — 별도 대기

코퍼스 적재 운영 기록 문서 PR이 Vercel rate limit 실패 상태로 남아 있다.
내용은 merge 가능하나 체크 재실행이 필요하다. **이 문서와 무관한 별도 트랙이다.**
