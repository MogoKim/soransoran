# VE-M3 학습 후보 선별 정책 (확정)

> 작성 2026-08-29 · 상태 **확정** · 선행 [export 설계](2026-08-29-voice-m3-export-design.md)
> 판정 데이터: [`decisions/ve-m3-manual-decisions.json`](decisions/ve-m3-manual-decisions.json)

## §0 이 문서가 정하는 것

분석은 끝났다 — `succeeded 9,411` · `terminal skipped 33` · `failed 0`.
남은 질문은 하나다. **"이 중 무엇을 Persona Bot 에게 배우게 할 것인가."**

그 답을 점수만으로 낼 수 없다는 것이 이번 작업의 결론이다.
7종 신호가 만점에 가까운데 **남성이 쓴 글**이 있었고, 점수가 낮은데 **사람이 좋다고 본 글**이 있었다.
그래서 창업자가 183건을 직접 읽었고, 이 문서는 그 판정을 코드가 재현할 수 있는 규칙으로 옮긴 것이다.

🔴 **추가 수동 리뷰는 요구하지 않는다.** 남은 약 1,026건은 사람 확인 없이 쓰되, **무엇이 확인됐는지는 기록**한다.

---

## §1 수동 판정 실적 — 183건

| 출처 | 판정 | 성격 |
|---|---|---|
| 대표 20건 | 20 | 첫 판독 — 오염 유형 확인 |
| V40 + R2 25 | 65 | voice 후보 · exp 36+ 회수 가능성 |
| speaker-b1 | 98 | 화자 성별 확인 |

**중복 0건 · 충돌 0건.** 세 표본이 서로 겹치지 않게 추출됐고, 같은 글에 다른 판정이 내려진 사례도 없다.

### 🟢 앵커 3/3 일치

speaker-b1 에 이미 판정된 3건을 섞어 넣었고 **전부 같은 판정이 나왔다.**
서로 다른 시점에 같은 글을 같게 판정했다는 뜻이고, **후반부 기준이 느슨해지지 않았다**는 증거다.

---

## §2 🔴 판정의 목적을 나눈다

이번 설계에서 가장 중요한 결정이다.

```
"학습 O"      →  사람이 말투까지 학습 가능하다고 본 판정
"여성 화자"    →  화자 성별만 확인한 판정
```

**둘은 같은 말이 아니다.** 뭉치면 화자만 확인한 글을 말투 승인으로 착각한다.
실측이 이를 뒷받침한다 — `humanVoiceApproved` 63건 중 **17건은 자동 기준으로 story_topic** 이었다.
사람은 "여성이 쓴 글이다" 를 확인했지만, 자동 기준으로는 말투 문턱을 넘지 못한 글들이다.

### manual class 6종

| class | 정의 | 출처 | 건수 |
|---|---|---|---|
| `humanVoiceApproved` | **말투까지** 승인 | 대표20 "학습 O" · V40R2 "voice/style 학습 O" | 63 |
| `speakerFemaleOnly` | **화자 성별만** 확인 | speaker-b1 "여성 화자" | 89 |
| `male` | 남성 화자 | 전 표본 | 5 |
| `storyOnly` | 여성이나 말투 부적합 | V40R2 | 0 |
| `held` | 불명확 · 보류 · 근거 애매 | 전 표본 | 11 |
| `excluded_manual` | 사람이 제외 | 전 표본 | 15 |

> `male` 이 5건인 이유 — 우선순위상 `held` 가 앞서므로 **"보류 + 남성" 6건은 held 로 흡수**된다.
> 다만 `speakerHint: 'male'` 로 정보를 보존해, 나중에 held 를 재검토할 때 남성이었음을 알 수 있다.

---

## §3 override 우선순위

```
1) excluded_manual   사람이 제외 → 자동 점수가 좋아도 모든 학습에서 뺀다
2) held              불명확 · 보류 → 학습 후보 아님 (speakerHint 보존)
3) male / storyOnly  → story_topic. 말투는 쓰지 않고 사건 구조만
4) humanVoiceApproved
     자동 voice/privacy → voice_gold
     자동 mimicry      → voice_gold + mimicryOverridden
     자동 story        → 🔴 story 유지 + 별도 집계 (무조건 gold 로 올리지 않는다)
5) speakerFemaleOnly
     자동 voice/privacy → voice_gold (speakerVerified)
     자동 story        → story 유지 + speakerVerified
     자동 excluded/review → 🔴 자동 유지. 여성이라는 이유로 품질·오염 판정을 덮지 않는다
6) 판정 없음 → 자동 bucket (voice_style 은 voice_silver 로)
```

### 왜 이 순서인가

**제외가 가장 앞이다.** 사람이 "이건 아니다" 라고 본 것은 점수가 아무리 좋아도 들어오면 안 된다.
실제로 자동 `voice_style` 에 있던 **5건을 사람이 제외**했다.

**보류가 화자 판정보다 앞이다.** "남성인 것 같지만 확신이 안 선다" 는 남성 확정이 아니다.
확신 없는 판정으로 데이터를 옮기지 않는다.

**mimicry override 는 `humanVoiceApproved` 에서만 허용한다.**
`seq 52+` 는 원문 모방 의심 신호지만, **사람이 실제 원문을 보고 학습 O 를 준 경우** 점수보다 사람이 우선한다.
반면 `speakerFemaleOnly` 는 화자만 본 것이므로 모방 판정을 덮을 근거가 없다.

---

## §4 최종 bucket

| bucket | 건수 | speakerVerified | 말투 학습 |
|---|---|---|---|
| **voice_gold** | 135 | `true` | 🟢 사용 — 가장 안전 |
| **voice_silver** | 1,065 | `false` | 🟡 사용 — gold 와 구분 필요 |
| **story_topic** | 1,304 | 일부 `true` | ⛔ **미사용** — 사건 구조만 |
| **held** | 11 | `false` | ⛔ 미사용 |
| **excluded_manual** | 15 | — | ⛔ 미사용 |
| mimicry_review | 449 | — | ⛔ (2건은 gold 로 override) |
| privacy_review · excluded · neutral | 6,432 | — | ⛔ |

**말투 학습 가능 총량 1,200건** (gold 135 + silver 1,065).
`usableForVoice` 컬럼이 이를 표시하며, story · held · excluded 는 항상 `false` 다.

### 🔴 voice_silver 를 그대로 쓰는 판단

1,065건은 **사람이 화자를 확인하지 않은 글**이다. 표본 추정 남성 비율은 **6.7%**(95% CI 2.9~10.6%)로,
1,209건 환산 **35~128건**이 섞여 있을 수 있다.

전수 확인은 6~8시간이 든다. 그 대신 **`speakerVerified` 로 구분해 두고 그대로 쓴다.**
Persona Bot 산출물에서 화자 정체성 문제가 실제로 드러나면, 그때 gold 만으로 재학습하거나
VE-M4 에 화자 지표를 추가한다. **문제가 나기 전에 6시간을 쓰지 않는다.**

---

## §5 🔴 memo 를 커밋하지 않는 이유

창업자 판정 메모에는 민감 표현이나 원문 조각이 섞일 수 있다.
그래서 커밋되는 판정 파일은 **`reasonCodes` 로 정규화**한다.

```json
{ "sourceRef": "cm...", "class": "male", "reasonCodes": ["SPEAKER_MALE"], "source": "speaker-b1", "speakerHint": "male" }
```

허용 필드는 **5개뿐**이다 — `sourceRef` · `class` · `reasonCodes` · `source` · `speakerHint`.
매핑표에 없는 근거는 `OTHER` 로 접고 **원문은 버린다.** 억지로 코드화하지 않는다.

fixture 가 커밋 파일 실물을 열어 `memo` · `verdict` · `sourceUrl` · `content` · `topComments` ·
`author` · `title` · `url` 이 없는지 검사한다.

---

## §6 유지되는 기존 정책

| 정책 | 상태 |
|---|---|
| 사적 소재는 제외 사유 아님 | 🟢 `isPrivateTopic` 은 기록만 · **판정에 쓰지 않는다** |
| `expressionRisk` 상한 없음 | 🟢 exp 36+ 회수분 125건이 학습 후보에 남는다 |
| 오타 · 줄바꿈 · 이모티콘 과교정 금지 | 🟢 원문을 한 글자도 바꾸지 않는다 |
| 댓글 `content` 만 사용 | 🟢 `author` 접근 0 · `replies` 1차 보류 · `likeCount` 미사용 |
| 💗 카페 공지 제거 · 기타 이모지 미제거 | 🟢 502건 제거 · 300자 미만 탈락 25건 |
| 유출 대조는 `author` 포함해 넓게 | 🟢 `topCommentsToText()` 불변 |

---

## §7 다음 단계

> 🔴 **후속 결정: [Persona Network 전략](2026-08-29-persona-network-strategy.md)**
> 이 문서가 정한 bucket 을 **무엇에 쓸 것인지**는 그쪽에서 확정했다.
> 요지 — 단순 댓글봇이 아니라 **외부 화제를 재맥락화하는 Persona Network** 다.
> Persona Pool 은 **20~30명 규모로 설계**하고 초기 활성만 소수로 제한한다.

```
1) Persona Network 전략 고정          ← 완료
2) Persona Architecture 설계 (Identity · Memory)
3) 🔴 Safety / Originality Gate 설계   생성기보다 먼저
4) Persona Pool 20~30명 설계
5) Trend ingestion 설계
6) story_topic 1,304 의 시점 일반화 규칙
7) privacy_review 25 의 식별 디테일 일반화
```

### bucket 이 어디에 쓰이는가

| bucket | Persona Network 에서의 용도 |
|---|---|
| voice_gold 135 | 기준 말투 · few-shot 예시 · `voiceAnchors` |
| voice_silver 1,065 | 말투 다양성 · 어휘 분포 참고 (🔴 few-shot 예시 아님) |
| story_topic 1,304 | 사건 구조 · **댓글 반응 구조** |
| held · excluded_manual · mimicry_review | 🔴 학습 금지 또는 보류 |

🔴 **점수로 학습을 자동화하지 않는다.** 이 문서의 bucket 은 후보이지 확정이 아니다.
