# Voice Engine — 고품질 코퍼스 적재 운영 기록 (VE-R3 · VE-R3.1)

> 설계 정본은 [`2026-08-27-voice-engine-schema-strategy.md`](./2026-08-27-voice-engine-schema-strategy.md)이고,
> 이 문서는 **그 설계를 실제로 돌린 결과**다. 무엇을 넣었고, 무엇이 걸렸고, 무엇을 아직 안 했는지를 남긴다.

작성 2026-08-26 · 실행 주체 Claude(실행) / 창업자(단계별 승인)

---

## 1. 무엇을 적재했나 — 고품질 9,674건

전체 33,031건이 아니라 **고품질 조건 5종을 모두 통과한 9,674건**만 대상으로 삼았다.

```
전체            33,031
→ isUsable      25,970
→ ageSignal 50s/60s  19,593
→ 150자 이상    11,535
→ aiAnalyzed    11,522
→ 댓글 有        9,674   ← 대상
```

조건은 `scripts/lib/voice-unao-readonly.mts`의 `HIGH_QUALITY_WHERE` 한 곳에 있다.

**왜 전체를 넣지 않는가.** `ageSignal` 70s+ 와 광고성 글이 섞이고, VoiceDerived 계산 대상이 3.4배로 늘어난다.
학습 자산은 많을수록 좋은 게 아니라 **우리 또래의 목소리일수록** 좋다.

---

## 2. 어떤 순서로 늘렸나 — 1 → 10 → 100 → 1,000 → 전량

한 번에 넣지 않았다. 되돌리기 어려운 작업은 **눈으로 확인할 수 있는 크기부터** 시작한다.

| 단계 | 건수 | 무엇을 확인했나 |
|---|---|---|
| VE-R2 | 1건 | 원문 미저장 · 해시 형식 · `referenced` 판단 |
| VE-R3 | 10건 | 중복 SKIP · 커서 재개 · 라벨 보존 |
| VE-R3 | 100건 | **라벨 경유 누출 발견** (아래 §3) |
| VE-R3.1 | 1,000건 | 가드가 실제로 잡는지 — 7건 drop |
| VE-R3.1 | 전량 | 남은 후보 소진 |

각 단계 사이에 창업자 승인이 있었다. `--apply`는 `--limit` 없이는 거부된다 — "전부 넣기"를 한 번에 할 수 없게 만든 게이트다.

**중단해도 이어받는다.** id 오름차순 커서 + `UNIQUE(origin, sourceRef)`로 성립하고 상태 파일이 없다.
같은 명령을 다시 실행하면 남은 것부터 계속한다.

---

## 3. 100건에서 발견한 것 — legacyLabels 경유 원문 누출

### 문제의 성격

VoiceSource는 설계대로 `content`·`topComments`·닉네임을 **저장하지 않는다**. 스키마에 그 컬럼이 아예 없다.
**이번 문제는 그 경로가 아니었다.**

우나어 psych 분석기가 만든 라벨(`legacyLabels`)을 그대로 옮겨 담는데, **그 라벨 안에 원문 문장이 들어 있었다.**
우리가 본문을 옮기지 않아도 **우나어가 만든 파생물이 본문을 물고 온다.**

100건 검증에서 자유서술 라벨 179개 값을 우나어 원문·댓글과 전수 대조한 결과:

- 값 전체가 원문에 그대로 존재: **0개**
- **20자 이상 연속 일치: 1개** — `emotionalPeak` 39자 중 **30자가 본문과 연속 일치**(원문 617자의 4.9%)

### 가드 (PR #93 · VE-R3.1)

`toSourceRow`가 변환 시점에 끊는다. 세 가지가 설계의 핵심이다.

**① 판정은 키 이름이 아니라 값의 타입·길이로 한다.**
이름 목록으로 잡으면 두 방향으로 틀린다 — 우나어가 새 라벨을 추가하면 놓치고,
`commentSplit`처럼 이름만 원문스러운 숫자형(0~8)을 잘못 버린다.
이 저장소에서 `commentSplit`은 `comments`로 이미 두 번 오인됐다.
`isFreeTextLabelValue()`는 **20자 이상 문자열만** 검사 대상으로 삼는다.
`ageSignal`(3자)·`desireCategory`(9자) 같은 분류값은 이름과 무관하게 자동으로 빠진다.

**② 임계값 20자.**
한국어 20자면 한 문장에 가깝다 — 우연히 겹칠 길이가 아니다.
공백을 끼워 우회하지 못하도록 정규화 후 비교한다. fixture가 19자/20자 경계를 **리터럴로** 잠근다.

**③ 전체가 아니라 key 단위 drop.**
한 키가 오염됐다고 `ageSignal`·`qualityScore`까지 잃으면 우나어가 이미 계산해 둔 자산(재계산 비용 0)이 통째로 사라진다.
실제 사례에서 13종 중 1종만 제거되고 12종이 남았다.
버려진 값은 어디에도 남기지 않는다 — 보고에 실리는 것은 **키 이름뿐**이다.

이미 적재된 행은 `npm run voice:label-sanitize -- --apply`로 같은 로직으로 정리했다(dry-run이 기본).
`legacyLabels` 외의 컬럼과 다른 테이블은 건드리지 않는다.

### drop 발생률

| 배치 | 검사 대상 | drop | 비율 | 걸린 키 |
|---|---|---|---|---|
| 100건 | 179개 값 | 1 | 약 1.0% | `emotionalPeak` |
| 1,000건 | 1,000건 | 7 | 약 0.7% | `emotionalPeak` |
| 전량 | 8,563건 | 82 | 약 0.96% | `emotionalPeak` 80 · `psychInsight` 2 |

1,000건까지는 **전부 `emotionalPeak`**였고, 전량 배치에서 `psychInsight` 2건이 처음 나왔다.
키 이름 목록으로 가드를 짰다면 그 2건을 놓쳤을 것이다 — §5에 상세.

---

## 4. 지키고 있는 원칙

### 원문·댓글·닉네임을 저장하지 않는다

VoiceSource에 남는 것은 **"그때 그 본문이었다"의 증거**뿐이다.

| 저장하는 것 | 저장하지 않는 것 |
|---|---|
| `contentHash` (sha256) | `content` |
| `contentLength` | `topComments` 본문 |
| `commentCount` | 닉네임 원문 |
| `authorHash` (salt `soransoran-voice-v1`) | |
| `legacyLabels` (정화 후) | |

본문은 해시를 계산하는 순간에만 메모리에 있고 배치마다 버려진다.
댓글 원문도 누출 가드가 대조할 때만 쓰이고 반환값에 들어가지 않는다.
원문은 우나어 DB에 남고 이쪽에는 참조와 증거만 온다.

닉네임을 해시로 다루는 이유는 우나어 닉네임이 3~7자라 원문을 두면 특정되기 때문이다.

### `usedAt`은 `approved`가 아니라 `referenced`다

우나어 `CafePost.usedAt` 6,494건 중 실제 발행으로 이어진 것은 **13건(0.2%)**뿐이고,
스키마 주석도 "큐레이션 참조 시각"이다.

`approved`로 넣으면 **"사람이 승인했다"는 거짓 정답지**가 만들어진다.
나중에 VoiceDerived가 이걸 학습 신호로 쓰면 6,494건짜리 잘못된 라벨이 된다.
그래서 `decision = 'referenced'`, `decidedBy = 'unao-curation'`으로 고정하고,
`approved`가 하나라도 생기면 배치가 즉시 실패한다.

### 이 단계의 LLM/API 비용은 0이다

적재 전 구간에서 **LLM 호출도 외부 API 호출도 크롤링도 없다.**
읽은 것은 우나어 Postgres(read-only role `unao_voice_readonly`)뿐이고, 쓴 것은 소란소란 `VoiceSource`·`VoiceJudgment`뿐이다.
라벨은 우나어가 이미 계산해 둔 것을 그대로 가져왔다 — 재계산 비용 0.

fixture가 이걸 잠근다: 적재 경로에 `openai`·`anthropic`·`fetch(`·`axios`가 있으면 실패한다.

---

## 5. 실행 결과 (2026-08-26 실측)

### 최종 원장

| 항목 | 값 |
|---|---|
| VoiceSource | **9,674건** = 고품질 대상 전량 |
| VoiceJudgment | **3,093건** = `usedAt` 보유 건수와 정확히 일치 |
| decision | `referenced` 3,093 · **그 외 0** |
| `approved` | **0** |
| `(origin, sourceRef)` 중복 | 0 |
| 고아 VoiceJudgment | 0 |

VoiceJudgment가 VoiceSource보다 적은 것이 정상이다 — `usedAt`이 있는 건만 판단이 따라붙는다.

### 저장값

| 항목 | 값 |
|---|---|
| `contentHash` | 9,674 / 9,674 (100%) |
| `authorHash` | 9,674 / 9,674 (100%) |
| `contentLength` ≥ 150 | 9,674 / 9,674 |
| `commentCount` | 9,674 / 9,674 · 합계 **102,258개** |
| `legacyLabels` | 9,674 / 9,674 · 9~14종 · **전체 삭제된 행 0** |
| 금지 컬럼(`content`·`body`·`rawBody`·`topComments`·`author`) | **0개** |

본문 150~3,000자(중앙값 323자) · 작성연도 2023~2026 · 카페 6곳
(`dlxogns01` · `wgang` · `remonterrace` · `goondae` · `masanmam` · `yeowooya`).

### 라벨 drop — 발생률 약 0.85%

| 배치 | drop | 비율 | 걸린 키 |
|---|---|---|---|
| 100건 | 1 | 약 1.0% | `emotionalPeak` |
| 1,000건 | 7 | 약 0.7% | `emotionalPeak` |
| 전량(8,563건) | **82** | 약 0.96% | `emotionalPeak` 80 · **`psychInsight` 2** |
| **누적** | **90** | **약 0.93%** (9,674건 기준) | |

**전량 배치에서 처음으로 `psychInsight`가 걸렸다.** 100·1,000건 구간에서는 `emotionalPeak`만 나왔다 —
키 이름 목록으로 가드를 짰다면 `emotionalPeak`만 넣었을 것이고, 이 2건은 그대로 통과했을 것이다.
**값의 타입·길이로 판정하기로 한 결정이 여기서 실제로 값을 했다.**

가드가 없었다면 9,674건에 90건의 원문 인용이 그대로 쌓였다.

### 전수 재대조 — 누출 0

적재 완료 후 **자유서술 라벨 18,956개(9,669행)를 우나어 원문·댓글과 다시 대조**했다.

- 20자 이상 연속 일치: **0개**
- 원본이 사라진 행: 0

적재 시점의 가드와 사후 독립 검증이 같은 결론에 도달했다.

### 건드리지 않은 것

| 항목 | 상태 |
|---|---|
| Micro Seed Candidate · RawContent · History · Post | **5 · 5 · 4 · 4 불변** |
| row6(`4232060`) | DB `HOLD` · `scheduledPublishAt` null · `createdPostId` null |
| Sheet row6 | B=`HOLD` · F/P/Q 공란 |
| Sheet write | **0** (5행 불변) |
| `recover-live` dry-run divergence | 0 |
| LLM · 외부 API · 크롤링 | **0 / 0 / 0** |
| `publisher` · `approve-live` · `import-82cook` · `recover-live` `--apply` | **0회** |


---

## 6. 아직 하지 않은 것

### 전체 33,031건은 보류다

고품질 9,674건 레인만 사용한다. 나머지 23,357건은 `ageSignal` 70s+ 와 광고성 글이 섞여 있고,
넣는 순간 VoiceDerived 계산 대상이 3.4배가 된다. **필요가 확인되기 전에는 넣지 않는다.**

### 다음 단계는 VE-M2 VoiceDerived

지금 있는 것은 "어떤 글이 있었다"는 참조와 증거뿐이다. 아직 **아무것도 파생시키지 않았다.**

VE-M2에서 할 일:
- `VoiceDerived` — 문체·어휘·구조 특징을 원문 없이 파생시킨다
- `VoiceCommentSignal` — 댓글이 어디서 붙는지의 신호
- **광고성·위험성 후보는 배치에서 버리지 않았다.** 창업자 결정에 따라 VoiceDerived의 risk 플래그로 표시한다

이 단계에서 처음으로 LLM 비용이 발생한다. 그 전에 대상 규모를 고정해 둔 것이 §1의 9,674건이다.

### row6 Micro Seed 발행은 별도 트랙이다

82cook row6(`sourceArticleId=4232060`)은 `HOLD` 상태이고 KST 2026-08-27 이후 발행 트랙이다.
**Voice 적재와 무관하며 서로 건드리지 않는다.**
모든 Voice 배치에서 Micro Seed 원장(Candidate 5 · RawContent 5 · History 4 · Post 4)과
Sheet 5행은 불변임을 매번 확인했다.

---

## 7. 다시 돌릴 때

```bash
npm run voice:unao-batch                        # 판정만 (DB write 0)
npm run voice:unao-batch -- --limit=100 --apply # 100건 적재 (중복 자동 SKIP)
npm run voice:label-sanitize                    # 적재분 누출 재검사 (dry-run)
npm run voice:unao-import-check                 # fixture 20건
```

`--apply`는 항상 `--limit`을 요구한다. 중복은 SKIP되므로 같은 명령을 반복해도 안전하다.
