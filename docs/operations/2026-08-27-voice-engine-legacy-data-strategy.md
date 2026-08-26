# Voice Engine — 우나어 legacy 데이터 전략

> **이 문서의 역할**: Voice Engine 의 **핵심 초기 자산이 어디에 있는지**와
> **그것을 어떻게 쓰고 어디까지 쓰지 않는지**를 확정한다.
>
> 🔴 **이 문서가 존재하는 이유**: VE-0 계약(`2026-08-27-voice-engine-v0-contract.md`)은
> 방향은 맞았지만 **소란소란 Micro Seed 5건만 보고 설계됐다.**
> 우나어에 원문 33,031건 · 댓글 원문 154,872개가 이미 쌓여 있다는 사실이 빠져 있었다.
> 그 상태로 schema 를 만들면 **자산의 99.98% 를 담지 못하는 그릇**이 나온다.
>
> 작성 2026-08-27 · 근거 S-0/L-0 통합 감사 (우나어 DB read-only 실측)
> 🔴 코드 0줄 · schema 0 · migration 0 · LLM 호출 0

---

## 1. Voice Engine 의 본질

**Voice Engine 은 자동 글쓰기 도구가 아니다.**

우나어 과거 원문과 댓글을 **하나하나 뜯어보고**, 40대 후반~60대 초반 여성의
**실제 말투 · 감정선 · 고민 구조 · 댓글 반응 포인트**를 분석해
**소란소란의 오리지널 콘텐츠를 만드는 핵심 엔진**이다.

말투를 흉내 내는 것과 이해하는 것은 다르다.
흉내는 문장 몇 개로 끝나지만, 이해는 **"이 나이대 사람이 무엇을 어떻게 걱정하는가"** 를 안다.
후자만이 자산이 되고, 그 자산은 **읽은 원문의 양**에서 나온다.

🔴 **rewrite 도구가 아니다.** 원문에서 멀어지는 것이 목표가 아니라,
원문이 왜 사람들에게 닿았는지를 이해해 우리 글을 쓰는 것이 목표다.
**자연 유사성(우리 또래 공통 말투)과 복제 유사성(개인 고유 표현)을 가르는 기준**은
[`voice-engine-style-strategy.md`](./2026-08-27-voice-engine-style-strategy.md) §2 에 있다.

🚫 **금지 표현**: 시니어 · 어르신 · 노인 · 실버
✅ **대체**: 우리 나이 · 우리 또래 · 40대 후반~60대 초반 여성 · 인생 2막

---

## 2. 🔴 우나어 과거 데이터는 보조 자료가 아니라 **핵심 초기 자산**이다

### 2-1. 실측 (2026-08-27 · read-only)

| 자산 | 건수 | 의미 |
|---|---|---|
| **CafePost 원문** | **33,031** | 네이버 카페 원문 본문 |
| **topComments 댓글 원문** | **154,872개** | 🔴 **반응 지도의 유일한 재료** |
| `aiAnalyzed` | **30,139** | 심리 분석 완료 — Derived 라벨이 이미 있다 |
| `isUsable` | 25,970 | 참고용 적합 판정 완료 |
| `commentCrawled` | 25,426 | 댓글 수집 완료 |
| `ageSignal` 50s/60s | **24,297** | 🔴 **타겟이 정확히 일치** |
| `desireCategory` 부여 | 30,021 | 21종 분류 |
| **`usedAt` (실제 사용)** | **6,494** | 🔴 **사람이 고른 판단 = 정답지** |
| Post (우나어 발행글) | 11,704 | 봇 포함 — 구분 필요 |
| Comment | 67,085 | 봇 포함 — 구분 필요 |
| Like | 31,184 | 반응 신호 |

**본문 길이 분포**

```
<150자      15,658건
150~499자   10,995건   ← 소란소란 shortBody 기준(150자) 통과
500~1499자   4,499건
1500자+      1,879건
─────────────────────
150자 이상   17,373건
```

**기간**: 수집 2026-03-26 ~ 08-24 (5개월) · **원문 작성일 2016-07 ~ 2026-08 (10년치)**

### 2-2. 소란소란 신규 데이터만 기다리면 안 되는 이유

| | 소란소란 Micro Seed | 우나어 legacy |
|---|---|---|
| 원문 | **5건** | **33,031건** |
| 댓글 원문 | **0개** | **154,872개** |
| 분석 라벨 | 0건 (JSONL 에만) | **30,139건** |
| 사람 선별 판단 | 기록 안 됨 | **6,494건** |

**축적 속도는 하루 1~3건이다.** 말투 학습에 필요한 수백 건까지 몇 달이 걸린다.
**그동안 33,031건은 놀고 있다.**

### 2-3. 이미 Derived Vault 의 절반이 만들어져 있다

`CafePost` 는 헌법 §10-4 가 요구하는 산출 대부분을 **이미 갖고 있다.**

| 헌법 §10-4 요구 | 우나어 기존 필드 |
|---|---|
| 감정 흐름 | `emotionTags` · `emotionalPeak` · `sentiment` |
| 고민 구조 | `desireCategory`(21종) · `desireType` · `psychInsight` · `urgencyLevel` |
| 생활 디테일 | `content` · `topics` |
| 제목 감각 | `title` |
| 댓글이 달린 포인트 | **`topComments`** · `commentSplit` |
| 댓글 유형 분포 | `communitySignal` |
| 갱년기 신호 · target fit | `ageSignal` · `qualityScore` · `killerScore` |
| risk labels | `viralType` · `conflictTrigger` · `betrayalFactor` |
| 반응 시퀀스 | `likeCount` · `commentCount` · `viewCount` |
| **선별 판단** | **`isUsable` · `usedAt`** |

**Voice Engine 은 백지에서 시작하지 않는다.** 이미 있는 것을 잇는 데서 시작한다.

---

## 3. 데이터 사용 경계

### 3-1. 계층

| 계층 | 내용 | 사용 |
|---|---|---|
| **Raw Vault** | 원문 본문 · 댓글 원문 · 출처 · 수집 시점 · 작성자 닉네임 · 기존 분석 라벨 | 🔒 **내부 분석 전용** |
| **Derived Vault** | 말투 패턴 · 문장 리듬 · 감정 흐름 · 고민 구조 · 위험 라벨 · 댓글 반응 지도 | 🟢 **엔진 입력** |
| **Micro Seed Lane** | 원문 그대로 (82cook · 네이버 카페 한정) | 🔴 **noindex · 소량 · 승인 기반** |
| **Original Content Lane** | Derived 기반 오리지널 | 🟡 index 가능성은 **별도 검증 후** |

### 3-2. 🔴 무엇이 되고 무엇이 안 되는가

| | |
|---|---|
| 🟢 **원문 · 댓글을 내부에서 뜯어본다** | **진행 전제** |
| 🟢 말투 · 감정선 · 고민 구조 · 반응 포인트 추출 | **핵심 목표** |
| 🟢 통계 · 길이 밴드 · 라벨 분포 · 반응 시퀀스 분석 | 허용 |
| 🟢 Derived 를 바탕으로 소란소란 오리지널 콘텐츠 생성 | **목표** |
| 🔴 원문 · 댓글을 그대로 소란소란에 **SEO/index 공개 발행** | **금지** |
| 🔴 `author` 닉네임 외부 노출 | **금지** |
| 🔴 원문 댓글을 그대로 외부 노출 | **금지** |
| 🔴 원문 본문을 그대로 외부 노출 | **금지** (Micro Seed noindex 예외만) |

### 3-2-A. 🔴 1차 전략 — 참조하되 복제하지 않는다 (2026-08-27 확정)

```
우나어 DB  ──read-only──▶  분석  ──▶  소란소란 DB
(원문·댓글 원본)                      (Derived 자산만)
```

**우나어 `content` · `topComments[].content` · `author` 닉네임을
소란소란 DB 에 대량 복제하지 않는다.** 필요하면 나중에 샘플 · 캐시 단위로만 제한 이관을 검토한다.

🔔 **runtime 전제**: 소란소란 `.env.local` 에 **`UNAO_READONLY_DATABASE_URL`** 이 필요하다.
읽기 전용 role 이어야 한다 — 사고가 규칙이 아니라 **구조로** 막힌다.

### 3-3. provenance 는 항상 보존한다

`postUrl`(유일키) · `cafeId` · `cafeName` · `author` · `postedAt` · `crawledAt` 이 전부 남아 있다.
**어떤 산출물이든 어느 원문에서 나왔는지 역추적할 수 있어야 한다.**
추적 불가능한 Derived 는 검증도 삭제도 할 수 없다.

---

## 4. 법률 · 운영 경계

### 4-1. 법률 검토는 완료됐다 — 전제로 둔다

**창업자가 10명 이상의 변호사에게 자문했고, 우나어 과거 원문 · 댓글을
LLM 내부 분석과 말투 · 패턴 추출 목적으로 사용하는 것은 진행 가능한 것으로 확인됐다.**

🔴 **따라서 "법적 검토가 안 됐으니 보류" 를 blocker 로 다시 세우지 않는다.**
이 문서 이후의 모든 판단은 아래 기준으로만 한다.

```
비용 · 품질 · 원문 복사 방지 · 데이터 구조 · 운영 안정성
```

### 4-2. 안전 운영 원칙은 유지한다

법률 판단과 별개로 **원문 그대로 SEO 노출 금지**는 운영 원칙으로 유지한다.

이유는 법이 아니라 **우나어에서 실제로 겪은 일**이다 —
네이버 색인이 4,600 → 0 이 된 것은 **콘텐츠 품질 문제가 아니라
원문을 SEO 노출 방식으로 다룬 구조의 문제**였다.

**같은 구조를 소란소란에 복사하지 않는다.** 이것이 레인 분리의 실질적 근거다.

---

## 5. VE-1 schema 보류 사유

### 5-1. 기존 3필드 제안은 전제가 무효화됐다

```
제안:  MicroSeedCandidate 에 qualityFlags · qualitySignals · qualityRuleVersion 추가
전제:  다뤄야 할 데이터는 Micro Seed 후보뿐이다
실측:  우나어 33,031건 + 댓글 154,872개가 이미 있다
```

**Micro Seed 5건 기준으로는 빠르고 옳은 설계였다.**
그러나 `MicroSeedCandidate` 에 매달면 **우나어 자산이 영원히 그 구조 밖에 남는다.**

### 5-2. 그래서 순서를 바꾼다

```
❌ VE-1a schema PR 을 지금 진행
✅ 우나어 심층 데이터 감사 → source-neutral Voice 자산 구조 확정 → schema PR
```

**schema 를 먼저 굳히면 나중에 두 번 만든다.** 헌법 §12-1 의 교훈과 같다 —
게이트를 나중에 붙이면 소급 작업이 생긴다.

---

## 6. 향후 구조 후보 (🔴 문서상 후보일 뿐 — 구현하지 않는다)

> ✅ **2026-08-27 확정.** 아래 후보는 심층 감사를 거쳐 정본이 됐다.
> **정본**: [`2026-08-27-voice-engine-schema-strategy.md`](./2026-08-27-voice-engine-schema-strategy.md)
> 이 절은 그 정본의 요약이며, 상세(필드 · 매핑 · PR 분할 · PASS 기준)는 그쪽을 본다.
> 🔴 여전히 `schema.prisma` 는 수정하지 않았다.
>
> 감사에서 바뀐 것 둘:
> · `VoiceCommentSource` → **`VoiceCommentSignal`** — 댓글 본문을 저장하지 않으므로 이름이 맞지 않았다
> · `usedAt` → **`referenced`** — Post 연결이 13건뿐이라 `approved` 가 아니다

### 6-1. `VoiceSource` — source-neutral 원천 참조

```
origin       'unao_cafe' | 'micro_seed' | 'soransoran_own'
sourceRef    CafePost.id | MicroSeedRawContent.id | Post.id
sourceSite · sourceUrl · capturedAt
```

🔴 **원문을 복제하지 않고 참조만 한다.** 우나어 DB 와 소란소란 DB 가 다르므로
이관 방식(복제 vs 참조 vs 추출물만)은 심층 감사에서 결정한다.

### 6-2. `VoiceDerived` — 원문 미포함 추출물

```
voiceSourceId · ruleVersion
flags · signals · toneNotes · emotionFlow · sentenceRhythm
concernStructure · titleSense · targetFit · riskFlags · commentReactionMap
derivedAt
```

`ruleVersion` 이 있어야 **규칙이 바뀌어도 과거 판정을 재현**할 수 있다.
Q-1 규칙은 이미 두 번 바뀌었다(PR #72 → #75).

### 6-3. `VoiceJudgment` — 사람 판단

```
voiceSourceId
decision   'approved' | 'held' | 'declined' | 'not_imported'
reason · decidedBy · decidedAt
```

🔴 **`not_imported` 가 핵심이다.** fetch 했으나 적재하지 않은 부정 사례를 남기는
유일한 자리다. 우나어 `usedAt` 6,494건도 이 구조로 들어온다.

### 6-4. 댓글 자산 구조

`topComments` 는 JSON 배열이라 **댓글 하나만 라벨링하거나 내릴 수 없다.**
헌법 §11-2 가 요구하는 **댓글 단위 역추적**을 하려면 별도 구조가 필요하다.
소란소란 `MicroSeedRawContent.rawComments` 도 같은 문제를 갖는다.

---

## 7. 🔴 절대 누락 금지 — 고아 방지 큐

| # | 항목 | 왜 |
|---|---|---|
| 1 | **댓글 원문 154,872개** | 소란소란은 0개. **M10 Comment Engine 의 유일한 재료** |
| 2 | **`usedAt` 6,494건** | 사람이 실제로 고른 판단. 나머지 19,476건은 **부정 사례** |
| 3 | **`aiAnalyzed` 30,139건** | 이미 매겨진 Derived 라벨. 다시 만들 이유가 없다 |
| 4 | **fetch 했으나 import 안 한 부정 사례** | 현재 DB 에 행 자체가 없다 (예: 4231978) |
| 5 | **창업자 보류 · 제외 판단** | 지금도 매 세션 사라지는 중 |
| 6 | **네이버 차단은 품질 문제가 아니었다** | 원문을 **SEO 노출 방식으로 다룬 구조**의 문제였다 |
| 7 | **소란소란은 독립 브랜드지만 Voice 자산은 우나어와 연결된다** | 타겟 · 정서 · 말투가 같다 |

---

## 8. 마일스톤 보정

| M | 이름 | 상태 |
|---|---|---|
| **M1** | Micro Seed 운영 레일 | ✅ **완료** |
| **M2** | Source Quality Engine (Q-1) | ✅ **1차 완료** |
| **M3** | Founder Gate (approve-live) | ✅ **1차 완료** |
| **M4** | Voice Engine Contract | 🟡 VE-0 완료 · **이번 PR 로 legacy 반영** |
| **M5** | **Legacy Data Vault** | 🔜 **다음 핵심** |
| **M6** | Derived Voice Dataset | 대기 |
| **M7** | Offline Voice Analyzer | LLM 전 단계 |
| **M8** | LLM Voice Engine v0 | 데이터 구조 · 샘플 확보 후 |
| **M9** | Original Content Lane | Derived 기반 index 콘텐츠 |
| **M10** | Comment / Conversation Engine | 댓글 원문 자산화 후 |

> 🔴 이 번호는 **운영 마일스톤**이며 헌법 §12 의 마일스톤 번호와 다르다.
> 인용할 때는 `헌법 M3` 처럼 출처를 붙인다.

---

## 9. 다음 작업 순서

```
1) VE-0 보강 문서 PR                        ← 이번 PR
2) 우나어 심층 데이터 감사 (read-only)
     · topComments JSON 구조
     · 봇 / 사람 발행 구분 (PostSource)
     · usedAt 의 실제 의미
     · 고품질 후보 샘플 추출
     · 댓글 반응 지도 가능성
3) VoiceSource / VoiceDerived / VoiceJudgment schema 확정
4) VE-1 schema PR
5) importer · approval · founder judgment 저장
6) offline analyzer (LLM 없이)
7) 제한적 LLM 실험
```

**2번이 3번의 입력이다.** 감사 없이 schema 를 정하면 또 한 번 다시 만든다.

---

## 10. row6 발행과의 관계

**row6(`4232060`) 발행은 별도 운영 트랙이다.**

- 현재 DB · Sheet 모두 `HOLD` · `F/P/Q` 공란
- KST 2026-08-27 이후 `approve-live` → `publish-live` 로 진행 가능
- **이번 문서 PR 은 row6 를 건드리지 않는다** (docs 만 변경)

두 트랙은 **충돌 지점이 0** 이므로 병렬로 진행한다.
