-- Voice Engine 자산 2차 — VoiceDerived + VoiceCommentSignal (VE-M2-1)
--
-- 정본: docs/operations/2026-08-26-voice-derived-m2-design.md
--       docs/operations/2026-08-27-voice-engine-schema-strategy.md §2-2 · §2-4
--       docs/operations/2026-08-27-voice-engine-style-strategy.md §3-2 · §4-3
--
-- 이 migration 은 "그릇을 먼저 세운다". 신호 계산 코드는 다음 PR(VE-M2-2)이다.
-- 이 시점에 두 테이블은 0건이고, VoiceSource 9,674건 · VoiceJudgment 3,093건은 그대로다.
--
-- 🔴 VE-M2 는 비용 0원 단계다
--    여기 담기는 신호 6종은 전부 **원문에서 규칙으로 세는 것**이라 LLM 이 필요 없다.
--    첫 LLM 비용은 VE-M3 이며, 그때 method='llm' 행이 같은 테이블에 붙는다.
--
-- 🔴 원문을 복제하지 않는다 (0006 과 같은 원칙)
--    본문 · 댓글 본문 · 닉네임 원문 컬럼이 **아예 없다**.
--    남는 것은 해시 · 길이 · 개수 · 신호뿐이다.
--    댓글 본문이 필요한 순간마다 우나어 DB 를 다시 읽는다 —
--    그래서 이름이 CommentSource 가 아니라 CommentSignal 이다.
--
-- 🔴 품질 · 위험 7종을 만들지 않는다
--    naturalnessScore · voiceRetention · originalityDelta · overSanitizedRisk ·
--    overMimicryRisk · expressionRisk · sequenceSimilarityRisk 는 전부
--    "소란소란이 쓴 글 ↔ 원문" 의 비교 축이다. 생성물이 없으면 계산이 성립하지 않는다.
--    빈 컬럼으로 미리 두지도 않는다 — 있으면 채우고 싶어지고,
--    채우면 의미 없는 숫자가 학습 정답지에 남는다. VE-M3 에서 만든다.
--
-- 🔴 기존 구조를 건드리지 않는다 (0004 · 0005 · 0006 과 같은 원칙)
--    DROP · TRUNCATE · RENAME · 컬럼 타입 변경 · **기존 테이블 ALTER 가 전부 없다.**
--    신규 테이블 2개 + 인덱스 + FK 2개만 더한다.
--    → 이 migration 을 먼저 적용해도 현재 배포된 코드는 정상 동작한다.
--      Micro Seed 발행 레일(publisher · approve · recover · importer)과 접점이 0이다.
--
-- 🔴 멱등하게 쓴다
--    우나어에서 migration 이력과 실제 스키마가 어긋나 `migrate deploy` 가 영구 차단된
--    사고가 있었다. 재실행돼도 실패하지 않도록 IF NOT EXISTS / DO $$ 로 감싼다.
--
-- ⚠️ 적용 방법: /prisma-guide 절차 — pg 모듈 직접 SQL + information_schema 검증.
--    `prisma migrate` · `db push` 를 쓰지 않는다.

-- ─────────────────────────────────────────────────────────
-- VoiceDerived — 규칙으로 뽑은 문체 신호
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VoiceDerived" (
  "id"            TEXT NOT NULL,
  "voiceSourceId" TEXT NOT NULL,

  -- 어느 규칙으로 매겼는가. Q-1 규칙은 이미 두 번 바뀌었다(PR #72 → #75).
  "ruleVersion"   TEXT NOT NULL,
  -- 'rule' | 'llm' — 규칙 산출물과 LLM 산출물을 섞지 않는다
  "method"        TEXT NOT NULL DEFAULT 'rule',

  -- 🔴 NULL 이 아니라 빈 문자열이 기본값이다.
  --    Postgres 에서 NULL 은 서로 같지 않아, 이 둘이 NULL 이면 아래 UNIQUE 가
  --    중복을 전혀 막지 못한다 — 같은 행이 무한히 쌓인다.
  --    VE-M2(rule)에서는 둘 다 '' 이고, VE-M3(llm)에서 실제 값이 들어간다.
  "model"         TEXT NOT NULL DEFAULT '',
  "promptVersion" TEXT NOT NULL DEFAULT '',

  -- VE-M2 신호 6종 — 구조가 아직 열려 있어 JSONB 다
  "typingArtifacts"   JSONB,
  "punctuationHabit"  JSONB,
  "spacingVariance"   JSONB,
  "mobileInputTrace"  JSONB,
  -- 🔴 단순 사전이 아니라 다섯 갈래다:
  --    sourceSpecific         82님들 · 우갱님들 · 레테님들 · 은오님들 → 치환 대상
  --    soransoranRegister     소란님들 · 소란소란님들 → 치환 결과
  --    targetDescriptorRisk   우리 또래분들 · 50대 여성분들 · 중년 여성분들 ·
  --                           같은 세대 분들 → 🔴 생성 금지 신호. 좋은 치환어가 아니다
  --    genericCommunityPhrase 일반 커뮤니티 표현 → 학습하고 살린다
  --    preserveStructure      질문 · 공동체 호출 구조 보존 여부
  "communityRegister" JSONB,
  -- 🔴 위 요소가 나타나는 빈도. 이 값이 없으면 나중에 남발한다
  "artifactFrequency" JSONB,

  "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceDerived_pkey" PRIMARY KEY ("id")
);

-- 🔴 같은 원천 · 같은 규칙 · 같은 방법 · 같은 모델 · 같은 프롬프트면 한 행이다.
--    model · promptVersion 이 빠지면 Haiku 산출물과 Sonnet 산출물이 같은 키를 다투고,
--    프롬프트를 고쳐도 캐시가 깨지지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceDerived_voiceSourceId_ruleVersion_method_model_promptV_key"
  ON "VoiceDerived" ("voiceSourceId", "ruleVersion", "method", "model", "promptVersion");
CREATE INDEX IF NOT EXISTS "VoiceDerived_voiceSourceId_derivedAt_idx"
  ON "VoiceDerived" ("voiceSourceId", "derivedAt");
CREATE INDEX IF NOT EXISTS "VoiceDerived_ruleVersion_method_idx"
  ON "VoiceDerived" ("ruleVersion", "method");

-- ─────────────────────────────────────────────────────────
-- VoiceCommentSignal — 댓글 반응 신호 (본문 없음)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VoiceCommentSignal" (
  "id"            TEXT NOT NULL,
  "voiceSourceId" TEXT NOT NULL,

  -- topComments 배열에서의 순서 (= commentIndex).
  -- 🔴 댓글에 날짜가 없어 이것이 유일한 순서 정보다.
  "ordinal"       INTEGER NOT NULL,

  -- 🔴 닉네임 원문이 아니다. 동일인 추적만 가능한 단방향 해시
  "authorHash"    TEXT,

  -- 댓글 본문이 아니라 "그때 그 댓글이었다" 의 증거
  "contentHash"   TEXT,
  "contentLength" INTEGER NOT NULL,

  "likeCount"     INTEGER NOT NULL DEFAULT 0,
  "replyCount"    INTEGER NOT NULL DEFAULT 0,

  -- 🔴 199자 이상 댓글이 약 4.0% 다. 모르고 학습하면
  --    "우리 또래는 200자에서 말을 끊는다" 는 거짓 패턴을 배운다.
  "truncated"     BOOLEAN NOT NULL DEFAULT false,

  -- 공감 · 질문 · 반박 · 경험공유 · 정보제공.
  -- 분류 체계가 아직 굳지 않아 TEXT 다. 굳으면 enum 으로 올린다.
  "reactionType"  TEXT,
  -- ⚠️ 댓글에 인용 정보가 없어 대부분 NULL 이 되는 것이 정상이다
  "anchorHint"    JSONB,

  "capturedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoiceCommentSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VoiceCommentSignal_voiceSourceId_ordinal_key"
  ON "VoiceCommentSignal" ("voiceSourceId", "ordinal");
CREATE INDEX IF NOT EXISTS "VoiceCommentSignal_voiceSourceId_likeCount_idx"
  ON "VoiceCommentSignal" ("voiceSourceId", "likeCount");
CREATE INDEX IF NOT EXISTS "VoiceCommentSignal_reactionType_idx"
  ON "VoiceCommentSignal" ("reactionType");

-- ─────────────────────────────────────────────────────────
-- FK — 원천이 사라지면 파생도 사라진다 (CASCADE)
-- 🔴 VoiceSource ↔ 우나어 사이에는 FK 가 없지만(다른 DB),
--    소란소란 DB 안에서는 걸 수 있다. 여기서는 건다.
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VoiceDerived_voiceSourceId_fkey'
  ) THEN
    ALTER TABLE "VoiceDerived"
      ADD CONSTRAINT "VoiceDerived_voiceSourceId_fkey"
      FOREIGN KEY ("voiceSourceId") REFERENCES "VoiceSource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VoiceCommentSignal_voiceSourceId_fkey'
  ) THEN
    ALTER TABLE "VoiceCommentSignal"
      ADD CONSTRAINT "VoiceCommentSignal_voiceSourceId_fkey"
      FOREIGN KEY ("voiceSourceId") REFERENCES "VoiceSource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
