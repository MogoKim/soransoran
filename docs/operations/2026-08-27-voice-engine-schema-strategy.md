# Voice Engine — 자산 구조 정본 (schema strategy)

> **이 문서의 역할**: `VoiceSource` / `VoiceDerived` / `VoiceJudgment` / `VoiceCommentSignal`
> 4구조를 **구현 전 문서 정본**으로 확정한다.
>
> 🔴 **`schema.prisma` 는 아직 수정하지 않는다.** migration 0 · runtime 0 · LLM 0.
> 아래 Prisma 블록은 **설계 초안**이며 실제 파일에 들어가 있지 않다.
>
> 작성 2026-08-27 · 근거 우나어 심층 데이터 감사 (read-only 실측)
> 상위 문서 [VE-0 계약](./2026-08-27-voice-engine-v0-contract.md) ·
> [legacy 데이터 전략](./2026-08-27-voice-engine-legacy-data-strategy.md) ·
> [스타일 전략](./2026-08-27-voice-engine-style-strategy.md)

---

## 1. 🔴 1차 전략 — 참조하되 복제하지 않는다

```
우나어 DB  ──read-only──▶  분석  ──▶  소란소란 DB
(원문·댓글 원본)                      (Derived 자산만)
```

| | |
|---|---|
| **우나어 DB** | **read-only 참조.** 원문 · 댓글 · 닉네임의 원본은 여기 남는다 |
| **소란소란 DB** | **Derived 자산만 저장.** 말투 · 감정 · 반응 신호 · 판단 |

🔴 **우나어 `CafePost.content` · `topComments[].content` · `author` 닉네임을
소란소란 DB 에 대량 복제하지 않는다.**

필요하면 나중에 **샘플 · 캐시 단위로만 제한 이관**을 검토한다.
지금 33,031건 본문과 154,872개 댓글을 옮기면 되돌리기 어렵다.

### 1-1. 복제하지 않는 대가와 그 대비책

원문을 갖지 않으면 **원문이 삭제·수정됐을 때 Derived 의 근거를 확인할 수 없다.**
그래서 **본문 자체가 아니라 "그때 그 본문이었다" 의 증거만** 남긴다.

```
contentHash    sha256(본문)     ← 원문 복제가 아니다
contentLength  글자 수
capturedAt     수집 시점
```

이것으로 "이 Derived 는 지금 원문과 같은 것에서 나왔는가" 를 판정할 수 있다.

---

## 2. Prisma 설계 초안

> 🔴 **아래는 문서일 뿐이다.** `schema.prisma` 에 넣지 않았고 migration 도 만들지 않았다.

### 2-1. `VoiceSource` — 원천 참조

```prisma
model VoiceSource {
  id            String   @id @default(uuid())

  /// 'unao_cafe' | 'micro_seed' | 'soransoran_own'
  origin        String
  /// 원천 레코드 id. 우나어 CafePost.id · 소란소란 MicroSeedRawContent.id
  /// 🔴 FK 가 아니다 — 다른 DB 를 가리킬 수 있다
  sourceRef     String
  sourceSite    String
  sourceUrl     String            // 🔴 역추적용. 외부 노출 금지
  sourceBoardName String?

  /// 🔴 닉네임 원문을 저장하지 않는다. 동일인 추적만 가능한 단방향 해시
  authorHash    String?

  postedAt      DateTime?
  capturedAt    DateTime

  // ── 원문 스냅샷 (본문이 아니라 증거) ──
  contentHash   String?
  contentLength Int?
  commentCount  Int?

  /// 헌법 §10-3 이 요구하는 원문 생존 확인
  lastVerifiedAt    DateTime?
  deletedDetectedAt DateTime?

  /// 우나어가 이미 매긴 라벨 91% 를 그대로 보존 (재계산 비용 0)
  legacyLabels       Json?
  legacyLabelVersion String?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  derived        VoiceDerived[]
  judgments      VoiceJudgment[]
  commentSignals VoiceCommentSignal[]

  @@unique([origin, sourceRef])
  @@index([origin, capturedAt])
  @@index([sourceSite, postedAt])
  @@index([deletedDetectedAt])
}
```

**🔴 FK 를 걸 수 없는 이유**: 우나어 DB 와 소란소란 DB 는 **별개의 데이터베이스**다.
`sourceRef` 는 문자열이고, 무결성은 `@@unique([origin, sourceRef])` 로만 지킨다.

### 2-2. `VoiceDerived` — 추출 신호

```prisma
model VoiceDerived {
  id            String   @id @default(uuid())
  voiceSourceId String
  voiceSource   VoiceSource @relation(fields: [voiceSourceId], references: [id], onDelete: Cascade)

  /// 🔴 어느 규칙으로 매겼는가. Q-1 규칙은 이미 두 번 바뀌었다 (PR #72 → #75)
  ruleVersion   String
  /// 'rule' | 'llm' — LLM 산출물과 규칙 산출물을 섞지 않는다
  method        String   @default("rule")

  flags         Json
  signals       Json

  // ── 말투 · 구조 ──
  toneNotes           Json?
  sentenceRhythm      Json?
  emotionFlow         Json?
  concernStructure    Json?
  titleSense          Json?
  lifeDetailNotes     Json?
  originalityNotes    Json?
  /// 🔴 방향만. 완성 본문이 아니다 (VE-0 §4-1)
  rewriteDirection    String? @db.Text
  targetFit           Int?
  riskFlags           Json?

  // ── 품질 · 위험 축 (스타일 전략 §3) ──
  naturalnessScore       Int?   // 🟢 사람이 쓴 것 같은 자연스러움
  voiceRetention         Int?   // 🟢 원문 말투와 감정이 살아 있는 정도
  originalityDelta       Int?   // 🟢 소란소란 글로 새로워진 정도
  overSanitizedRisk      Int?   // 🔴 과교정 — 매끈해서 사람 말투가 사라짐
  overMimicryRisk        Int?   // 🔴 과모방 — 오타 남발로 조롱처럼 보임
  expressionRisk         Int?   // 🔴 고유 표현 · 비유 복제
  sequenceSimilarityRisk Int?   // 🔴 연속 문장 · 문단 구조 유사

  // ── 문체 · 입력 흔적 축 (스타일 전략 §4) ──
  typingArtifacts     Json?   // 오타 · 자판 인접 오류
  punctuationHabit    Json?   // `..` `~~` `ㅠㅠ` `^^`
  spacingVariance     Json?   // 띄어쓰기 흔들림
  mobileInputTrace    Json?   // 짧은 문단 · 잦은 줄바꿈
  communityRegister   Json?   // 커뮤니티 어투 · 호칭
  /// 🔴 위 요소가 나타나는 빈도. 이 값이 없으면 남발한다
  artifactFrequency   Json?

  // ── 반응 ──
  commentReactionMap  Json?

  derivedAt     DateTime @default(now())

  @@unique([voiceSourceId, ruleVersion, method])
  @@index([voiceSourceId, derivedAt])
  @@index([ruleVersion])
}
```

🔴 **원문 문장을 저장하지 않는다.** 위 필드 중 어디에도 본문·댓글 텍스트가 들어가지 않는다.
`rewriteDirection` 만 문자열이고, 그것은 **원문이 아니라 우리가 쓴 방향 메모**다.

**`overSanitizedRisk` 와 `overMimicryRisk` 는 반대 방향이다.** 한쪽만 보면 반대편으로
넘어간다 — 두 값을 함께 읽어야 한다(스타일 전략 §3-3).

### 2-3. `VoiceJudgment` — 사람 판단

```prisma
model VoiceJudgment {
  id            String   @id @default(uuid())
  voiceSourceId String
  voiceSource   VoiceSource @relation(fields: [voiceSourceId], references: [id], onDelete: Cascade)

  /// approved      승인해 발행까지 간 것
  /// held          보고 보류한 것 ("아직 안 봤다" 와 구분된다)
  /// declined      명시적으로 제외한 것
  /// not_imported  fetch 했으나 원장에 넣지 않은 것
  /// referenced    🔴 우나어 usedAt — 큐레이션이 참조했을 뿐 승인이 아니다
  decision      String
  reason        String?  @db.Text
  /// 'founder' | 'unao-curation' | 'system'
  decidedBy     String
  decidedAt     DateTime @default(now())

  /// 판단 시점의 Derived. 규칙이 바뀌어도 "그때 무엇을 보고 정했는지" 가 남는다
  derivedIdAtDecision String?

  @@index([voiceSourceId, decidedAt])
  @@index([decision, decidedAt])
}
```

#### 🔴 `usedAt` 은 `approved` 가 아니다

실측이 그렇게 말한다.

```
usedAt NOT NULL                       6,494건
그중 Post.sourceUrl 로 연결된 것          13건   ← 0.2%
```

스키마 주석도 *"큐레이션 참조 시각"* 이다.
**6,494건을 `approved` 로 넣으면 "사람이 승인했다" 는 거짓 정답지가 만들어진다.**

`referenced` 는 **약한 긍정 신호**로만 쓴다. `usedAt IS NULL` 인 미참조군과
대비쌍을 만들 수 있다는 점에서 여전히 가치가 있다.

#### `not_imported` 가 필요한 이유

fetch 했으나 적재하지 않은 후보는 **DB 에 행 자체가 없다.**
`4231978`(제주도관광 · 댓글 수 1위 · 본문 62자 · URL 65%)이 그 예다.
**부정 사례를 남기는 유일한 자리**가 이 값이다.

### 2-4. `VoiceCommentSignal` — 댓글 반응 신호

```prisma
model VoiceCommentSignal {
  id            String   @id @default(uuid())
  voiceSourceId String
  voiceSource   VoiceSource @relation(fields: [voiceSourceId], references: [id], onDelete: Cascade)

  /// topComments 배열 순서. 🔴 댓글에 날짜가 없어 이것이 유일한 순서 정보다
  ordinal       Int
  authorHash    String?
  contentLength Int
  contentHash   String?
  likeCount     Int      @default(0)
  replyCount    Int      @default(0)

  /// 🔴 200자에서 잘린 댓글이 4.1% 다. 모르고 학습하면
  ///    "우리 또래는 200자에서 말을 끊는다" 는 거짓 패턴을 배운다
  truncated     Boolean  @default(false)

  /// 규칙 기반 라벨 — 공감 · 질문 · 반박 · 경험공유 · 정보제공
  reactionType  String?
  /// 원문의 어느 지점에 반응했는가. 🔴 현재 데이터로는 대부분 null
  anchorHint    Json?

  capturedAt    DateTime

  @@unique([voiceSourceId, ordinal])
  @@index([voiceSourceId, likeCount])
  @@index([reactionType])
}
```

#### 🔴 이름이 `Source` 가 아니라 `Signal` 인 이유

댓글 **본문을 저장하지 않기 때문**이다. §1 의 "복제하지 않는다" 를 지키면
댓글도 지표만 남고, 그러면 `Source` 가 아니라 `Signal` 이 정확한 이름이다.

**대가**: 댓글 본문이 필요한 순간(말투 추출 · 반응 문구 분석)마다
**우나어 DB 를 다시 읽어야 한다.** 그래서 §5 의 `UNAO_READONLY_DATABASE_URL` 이 전제다.

**`anchorHint` 는 대부분 null 이 된다.** 댓글에 날짜도 인용 정보도 없어
"본문 어느 지점에 반응했는지" 를 복원할 수 없다. **필드는 두되 비어 있는 것이 정상**이다.

---

## 3. 우나어 / 소란소란 매핑

| `VoiceSource` | 우나어 `CafePost` | 소란소란 `MicroSeedRawContent` |
|---|---|---|
| `origin` | `'unao_cafe'` | `'micro_seed'` |
| `sourceRef` | `id` | `id` |
| `sourceSite` | `'navercafe:' + cafeId` | `sourceSite` |
| `sourceUrl` | `postUrl` | `sourceUrl` |
| `sourceBoardName` | `boardName` | `Candidate.sourceBoardName` |
| `authorHash` | `sha256(author)` | — |
| `postedAt` | `postedAt` | — |
| `capturedAt` | `crawledAt` | `sourceCapturedAt` |
| `contentHash` / `contentLength` | `sha256(content)` / `length` | 동일 |
| `commentCount` | `commentCount` | `Candidate.sourceCommentCount` |
| `legacyLabels` | `desireCategory` · `desireType` · `emotionTags` · `urgencyLevel` · `communitySignal` · `ageSignal` · `viralType` · `commentSplit` · `psychInsight` · `conflictTrigger` · `emotionalPeak` | **null** |

| `VoiceJudgment` | 우나어 | 소란소란 |
|---|---|---|
| `referenced` | `usedAt IS NOT NULL` **6,494건** | — |
| `approved` | — | `founderApprovedAt` |
| `held` · `declined` | — | `holdReason` · `declineReason` |
| `not_imported` | — | fetch 했으나 미적재분 |

| `VoiceCommentSignal` | 우나어 `topComments[i]` |
|---|---|
| `ordinal` | 배열 인덱스 |
| `authorHash` | `sha256(author)` |
| `contentLength` | `length(content)` |
| `likeCount` | `likeCount` |
| `replyCount` | `replies.length` |
| `truncated` | `length(content) >= 200` |

**소란소란 `rawComments` 는 5건 전부 null** 이라 지금은 대상이 없다.

### 3-1. 예상 규모

| 테이블 | 행 수 |
|---|---|
| `VoiceSource` | 33,031 + 5 → **33,036** |
| `VoiceDerived` | 33,036 × 규칙 버전 수 |
| `VoiceJudgment` | 6,494(referenced) + 증가분 |
| `VoiceCommentSignal` | **154,872** |

---

## 4. 🔴 Micro Seed 발행 레일에 영향 0

4구조 전부 **신규 테이블**이다.

```
무변경  MicroSeedCandidate · MicroSeedRawContent · MicroSeedCandidateHistory
        Post · Comment · Sheet A:Q 17열
        publisher · approve-live · recover · importer
```

**기존 컬럼을 하나도 건드리지 않으므로** 발행 경로 회귀 위험이 없다.
`0004` migration 과 같은 구조다 — 신규 테이블은 배포본에 영향이 0이다.

---

## 5. 🔔 runtime 전제 — `UNAO_READONLY_DATABASE_URL`

**원문을 복제하지 않는 설계는 우나어 DB 를 계속 읽을 수 있어야 성립한다.**

```
소란소란 .env.local
  UNAO_READONLY_DATABASE_URL=...   ← 🔔 창업자 액션 필요
```

🔴 **읽기 전용 role 이어야 한다.** 지금은 앱 `DATABASE_URL`(write 권한)로 읽고 있다.
읽기 전용 계정이 있어야 **사고가 규칙이 아니라 구조로 막힌다** —
Voice 작업이 우나어 운영 DB 를 건드릴 가능성 자체가 사라진다.

```
① 우나어 Supabase 에서 read-only role 생성
     CafePost · Post · Comment · Like 등에 SELECT 만
② 소란소란 .env.local 에 UNAO_READONLY_DATABASE_URL 추가
```

**이것 없이는 runtime PR 을 시작할 수 없다.**

---

## 6. PR 분할 — migration-only 와 runtime 을 나눈다

🔴 **한 PR 에 schema 와 런타임 코드를 같이 담지 않는다.**
헌법 §12-3 의 교훈이다 — merge 즉시 Vercel 배포이고 migration 은 자동 실행되지 않아,
**컬럼 없이 새 코드가 먼저 나가면 런타임이 깨진다.**

### 6-1. migration-only (런타임 0줄)

| PR | 내용 | 상태 |
|---|---|---|
| **VE-M1** | `VoiceSource` + `VoiceJudgment` | 🟡 **schema·migration 작성 완료 · DB 미적용** |
| **VE-M2** | `VoiceDerived` | 대기 |
| **VE-M3** | `VoiceCommentSignal` (154,872행 예상 — 인덱스 먼저) | 대기 |

#### VE-M1 적용 상태 (2026-08-27)

```
schema.prisma                                    ✅ 모델 2 + enum 1 추가 (기존 변경 0줄)
prisma/migrations/0006_voice_source_judgment/    ✅ 작성 완료
DB 적용                                          🔴 미적용 — 창업자 승인 대기
```

🔴 **`decision` 은 `String` 이 아니라 enum `VoiceJudgmentDecision` 으로 확정했다.**
이 5값은 학습 정답지의 라벨이고, 오타 하나가 조용히 데이터를 오염시킨다.
반면 `origin` 은 `String` 으로 뒀다 — M6 multi-source 확장에서 값이 늘어나는데
그때마다 migration 을 요구하면 source 추가가 schema 작업이 된다.

> 🔴 **`/prisma-guide` 절차**: pg 모듈 직접 SQL + `information_schema` 검증.
> `prisma migrate` · `db push` **금지**. 창업자 수동 적용이 선행된다.

### 6-2. runtime

| PR | 내용 | 전제 |
|---|---|---|
| **VE-R1** | 우나어 read-only 커넥터 + fixture | VE-M1 · §5 |
| **VE-R2** | `VoiceSource` 적재 — **dry-run 기본 · `--limit=1`** | VE-R1 |
| **VE-R3** | `VoiceJudgment` 백필 — `usedAt` → **`referenced`** 6,494건 | VE-R2 |
| **VE-R4** | `VoiceCommentSignal` 적재 154,872행 (배치) | VE-M3 · VE-R2 |
| **VE-R5** | 소란소란 연결 — importer · approve 가 Source/Judgment 기록 | VE-R2 |
| **VE-R6** | offline derive — **LLM 없이** 규칙 기반 | VE-R2 |
| **VE-R7** | 제한적 LLM — `method='llm'` · 캐시 · 비용 hard stop | VE-R6 |

**VE-R5 가 소란소란 쪽 첫 연결점이다.** 여기서 창업자 판단이 원장에 남기 시작한다.

---

## 7. PASS 기준

```
VE-M1~M3   information_schema 로 테이블 · 컬럼 · 인덱스 확인
           기존 Micro Seed 5건 무변경 · dry-run-live PASS · divergence 0
           CI 게이트 7종 유지

VE-R1      커넥터가 read-only 임을 소스로 검사 (INSERT/UPDATE/DELETE 참조 0)
VE-R2      --limit=1 로 1건 → contentHash 재계산 일치
           🔴 fixture: VoiceSource 에 본문 컬럼이 없다 (원문 복제 방지)
VE-R3      referenced 6,494건 · approved 0건
           🔴 fixture: usedAt 을 approved 로 넣지 않는다
VE-R4      154,872행 · truncated 비율 4% 안팎 · 댓글 본문 미저장
VE-R5      approve-live 가 Judgment 를 남긴다 · publisher 무변경 · approve-check 14건 유지
VE-R6      LLM 호출 0 · ruleVersion 기록 · method='rule'
VE-R7      비용 상한 · 캐시 적중 시 재호출 0

전 구간    typecheck · typecheck:ops · build · check:visibility ·
           collect-check 31 · approve-check 14 · read 65 · plan 58 · validate 29

역검증     원문 본문 저장 / 닉네임 원문 저장 / usedAt→approved /
           publisher 참조 / 댓글 본문 저장 → 각각 fixture 가 잡아야 한다
```

---

## 8. 남은 결정

| # | 항목 | 왜 |
|---|---|---|
| **1** | 🔔 **read-only role 발급** | VE-R1 의 전제 (§5) |
| **2** | 댓글 본문이 필요할 때의 접근 방식 | 매번 우나어 조회 vs 분석 시점 임시 캐시 |
| 3 | `authorHash` salt 관리 | salt 가 바뀌면 동일인 추적이 끊긴다 |
| 4 | 200자 절단분 재크롤링 여부 | 지금 안 정하면 데이터가 두 종류가 된다 |
| 5 | `legacyLabels` 승계 범위 | 91% 전부인가, 재계산 대상(`sentiment` 0% · `topics` 1건)만 분리인가 |
| 6 | 광고성 글 필터 | `isUsable=true` 에 성형외과 광고가 섞여 있다 |

**1번이 모든 runtime PR 의 선행 조건이다.**
