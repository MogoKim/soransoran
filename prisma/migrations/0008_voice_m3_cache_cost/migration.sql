-- Voice Engine VE-M3 — cache · cost · run (VE-M3-1)
--
-- 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
--
-- 이 migration 은 "그릇만 세운다". LLM client · 실험 실행은 이후 PR 이다(계약 §J).
-- 이 시점에 세 테이블은 0건이고, LLM 호출은 아직 한 번도 없었다.
--
-- 🔴 이 세 테이블의 존재 이유는 **돈이 새는 것을 막는 것**이다
--    VE-M2 까지는 비용이 0원이라 실수해도 시간만 잃었다. VE-M3 부터는 다르다.
--      · VoiceM3Cache      같은 원문을 두 번 부르지 않는다
--      · VoiceM3CostEvent  호출 한 번마다 얼마 썼는지 남긴다 (retry 포함)
--      · VoiceM3Run        실행 단위로 cap 을 걸고 넘으면 멈춘다
--
-- 🔴 원문을 복제하지 않는다 (0006 · 0007 과 같은 원칙)
--    본문 · 댓글 본문 · 닉네임 컬럼이 **아예 없다**.
--    LLM 은 원문을 입력으로 보지만, 그 결과가 원문을 물고 나오면
--    이 테이블이 본문 저장소가 된다 — legacyLabels 경유로 실제 그런 일이 있었다(VE-R3.1).
--    `output` 은 저장 전에 우나어 원문과 20자 연속 대조를 통과해야 한다(계약 §H).
--
-- 🔴 model · promptVersion · outputSchemaVersion 은 NOT NULL 이다
--    Postgres 에서 NULL 은 서로 같지 않다. 이 값들이 NULL 이면
--    cacheKey 를 재구성할 수 없고 "어느 모델의 결과인가" 를 알 수 없어
--    캐시가 무의미해진다. VoiceDerived 에서 같은 결정을 했다(0007).
--
-- 🔴 기존 구조를 건드리지 않는다 (0004 · 0005 · 0006 · 0007 과 같은 원칙)
--    DROP · TRUNCATE · RENAME · 컬럼 타입 변경 · **기존 테이블 ALTER 가 전부 없다.**
--    신규 enum 3개 + 신규 테이블 3개 + 인덱스 + FK 3개만 더한다.
--    → 이 migration 을 먼저 적용해도 현재 배포된 코드는 정상 동작한다.
--      Micro Seed 발행 레일과 접점이 0이다.
--
-- 🔴 멱등하게 쓴다
--    재실행돼도 실패하지 않도록 IF NOT EXISTS / DO $$ 로 감싼다.
--
-- ⚠️ 적용 방법: /prisma-guide 절차 — pg 모듈 직접 SQL + information_schema 검증.
--    `prisma migrate` · `db push` 를 쓰지 않는다.

-- ─────────────────────────────────────────────────────────
-- enum 3종
-- 🔴 String 이 아니라 enum 인 이유: 이 값들로 "멈춰야 하는가" 를 판정한다.
--    오타 하나가 cap 을 무력화한다.
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "VoiceM3RunStatus" AS ENUM ('planned', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VoiceM3CacheStatus" AS ENUM ('succeeded', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VoiceM3CostEventType" AS ENUM ('call', 'retry', 'cache_hit', 'estimate');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────
-- VoiceM3Run — 실행 단위. cap 이 걸리는 자리
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VoiceM3Run" (
  "id"     TEXT NOT NULL,
  "status" "VoiceM3RunStatus" NOT NULL DEFAULT 'planned',

  -- 🔴 NOT NULL. cacheKey 구성 요소이기도 하다
  "taskVersion"         TEXT NOT NULL,
  "model"               TEXT NOT NULL,
  "promptVersion"       TEXT NOT NULL,
  "outputSchemaVersion" TEXT NOT NULL,

  -- cap — 실행 전에 정하고 실행 중에 넘으면 멈춘다
  -- 🔴 건수 cap 만으로는 못 막는다. 3,000자 글이 몰리면 같은 건수에 토큰이 3배다
  "itemLimit" INTEGER NOT NULL,
  "tokenCap"  INTEGER NOT NULL,
  -- 🔴 달러는 NUMERIC 이다. FLOAT 로 두면 반올림 오차가 누적된다
  "dollarCap" DECIMAL(10,4) NOT NULL,

  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  -- counters
  "attempted" INTEGER NOT NULL DEFAULT 0,
  "succeeded" INTEGER NOT NULL DEFAULT 0,
  "failed"    INTEGER NOT NULL DEFAULT 0,
  "skipped"   INTEGER NOT NULL DEFAULT 0,
  "cacheHit"  INTEGER NOT NULL DEFAULT 0,
  "cacheMiss" INTEGER NOT NULL DEFAULT 0,

  -- cost
  "inputTokens"      INTEGER NOT NULL DEFAULT 0,
  "outputTokens"     INTEGER NOT NULL DEFAULT 0,
  "totalTokens"      INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,

  -- 🔴 실패 사유를 버리지 않는다. 원문이 아니라 사유 요약만 담는다
  "errorSummary" TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VoiceM3Run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VoiceM3Run_status_createdAt_idx"
  ON "VoiceM3Run" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "VoiceM3Run_taskVersion_model_promptVersion_idx"
  ON "VoiceM3Run" ("taskVersion", "model", "promptVersion");

-- ─────────────────────────────────────────────────────────
-- VoiceM3Cache — 같은 원문을 두 번 부르지 않는다
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VoiceM3Cache" (
  "id" TEXT NOT NULL,

  -- 🔴 중복 호출 방지의 핵심.
  --    sha256(origin + sourceRef + contentHash + ruleVersion
  --           + taskVersion + model + promptVersion + outputSchemaVersion)
  "cacheKey" TEXT NOT NULL,

  "voiceSourceId" TEXT NOT NULL,

  -- cacheKey 구성 요소를 개별 컬럼으로도 둔다.
  -- 해시만 있으면 "어느 프롬프트 결과만" 을 골라낼 때 역산할 수 없다.
  "origin"    TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  -- 🔴 원문이 수정되면 키가 달라져 자동 무효화된다
  "contentHash" TEXT,
  "ruleVersion" TEXT NOT NULL,

  -- 🔴 NOT NULL — NULL 이면 캐시가 무의미해진다
  "taskVersion"         TEXT NOT NULL,
  "model"               TEXT NOT NULL,
  "promptVersion"       TEXT NOT NULL,
  "outputSchemaVersion" TEXT NOT NULL,

  -- 🔴 'llm' 고정. VoiceDerived.method='rule' 과 섞이지 않게 하는 표식
  "method" TEXT NOT NULL DEFAULT 'llm',

  "status" "VoiceM3CacheStatus" NOT NULL DEFAULT 'succeeded',

  -- 🔴 LLM 산출물. 원문 문장이 들어가면 안 된다.
  --    저장 전에 우나어 원문과 20자 연속 대조를 통과해야 한다(계약 §H)
  "output" JSONB,

  "inputTokens"      INTEGER NOT NULL DEFAULT 0,
  "outputTokens"     INTEGER NOT NULL DEFAULT 0,
  "totalTokens"      INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,

  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 실패도 남긴다 — 같은 실패를 반복하지 않기 위해서다
  "errorCode"    TEXT,
  "errorMessage" TEXT,

  CONSTRAINT "VoiceM3Cache_pkey" PRIMARY KEY ("id")
);

-- 🔴 이 UNIQUE 가 중복 호출을 막는 유일한 방어다
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceM3Cache_cacheKey_key"
  ON "VoiceM3Cache" ("cacheKey");
CREATE INDEX IF NOT EXISTS "VoiceM3Cache_voiceSourceId_generatedAt_idx"
  ON "VoiceM3Cache" ("voiceSourceId", "generatedAt");
CREATE INDEX IF NOT EXISTS "VoiceM3Cache_origin_sourceRef_idx"
  ON "VoiceM3Cache" ("origin", "sourceRef");
CREATE INDEX IF NOT EXISTS "VoiceM3Cache_model_promptVersion_taskVersion_idx"
  ON "VoiceM3Cache" ("model", "promptVersion", "taskVersion");
CREATE INDEX IF NOT EXISTS "VoiceM3Cache_status_generatedAt_idx"
  ON "VoiceM3Cache" ("status", "generatedAt");

-- ─────────────────────────────────────────────────────────
-- VoiceM3CostEvent — 호출 한 번마다의 비용. retry 도 남는다
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VoiceM3CostEvent" (
  "id"    TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  -- 🔴 NULL 허용. cap 초과로 **호출조차 못 한 사건**도 기록해야 하는데
  --    그때는 캐시 행이 없다
  "cacheId" TEXT,

  "eventType" "VoiceM3CostEventType" NOT NULL,
  "model"     TEXT NOT NULL,

  "inputTokens"      INTEGER NOT NULL DEFAULT 0,
  "outputTokens"     INTEGER NOT NULL DEFAULT 0,
  "totalTokens"      INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,

  -- 0 = 최초 시도. 1 이상이면 재시도다.
  -- 🔴 retry 를 cap 밖에 두면 실패가 많을수록 비용이 커진다(계약 §E)
  "retryAttempt" INTEGER NOT NULL DEFAULT 0,
  -- 사유 요약. 🔴 원문을 넣지 않는다
  "reason" TEXT,

  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VoiceM3CostEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VoiceM3CostEvent_runId_occurredAt_idx"
  ON "VoiceM3CostEvent" ("runId", "occurredAt");
CREATE INDEX IF NOT EXISTS "VoiceM3CostEvent_cacheId_idx"
  ON "VoiceM3CostEvent" ("cacheId");
CREATE INDEX IF NOT EXISTS "VoiceM3CostEvent_eventType_occurredAt_idx"
  ON "VoiceM3CostEvent" ("eventType", "occurredAt");

-- ─────────────────────────────────────────────────────────
-- FK — 전부 신규 테이블에만 건다
--
-- 🔴 삭제 정책이 서로 다르고, 그 이유가 있다:
--    · Cache → VoiceSource   CASCADE  원천이 사라지면 그 파생도 의미가 없다
--    · CostEvent → Run       CASCADE  실행이 사라지면 그 실행의 사건도 사라진다
--    · CostEvent → Cache     SET NULL 🔴 **비용 기록은 남아야 한다.**
--                                     캐시를 지웠다고 "얼마 썼는지" 를 잃으면
--                                     지출 추적이 끊긴다. 그래서 CASCADE 가 아니다.
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VoiceM3Cache_voiceSourceId_fkey') THEN
    ALTER TABLE "VoiceM3Cache"
      ADD CONSTRAINT "VoiceM3Cache_voiceSourceId_fkey"
      FOREIGN KEY ("voiceSourceId") REFERENCES "VoiceSource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VoiceM3CostEvent_runId_fkey') THEN
    ALTER TABLE "VoiceM3CostEvent"
      ADD CONSTRAINT "VoiceM3CostEvent_runId_fkey"
      FOREIGN KEY ("runId") REFERENCES "VoiceM3Run"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VoiceM3CostEvent_cacheId_fkey') THEN
    ALTER TABLE "VoiceM3CostEvent"
      ADD CONSTRAINT "VoiceM3CostEvent_cacheId_fkey"
      FOREIGN KEY ("cacheId") REFERENCES "VoiceM3Cache"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
