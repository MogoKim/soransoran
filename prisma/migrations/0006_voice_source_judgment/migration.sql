-- Voice Engine 자산 1차 — VoiceSource + VoiceJudgment (VE-M1)
--
-- 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md
--       docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §10-2 · §10-3 · §10-5-A
--
-- 이 migration 은 "그릇을 먼저 세운다". 적재 · 분석 코드는 이후 PR 이다.
-- 이 시점에 Voice 자산은 0건이다.
--
-- 🔴 1차 전략 — 참조하되 복제하지 않는다
--    우나어 DB 를 read-only 로 읽어 분석하고, 여기에는 Derived 자산만 남긴다.
--    우나어 CafePost.content · topComments[].content · author 닉네임을
--    이 테이블에 대량 복제하지 않는다. 그래서 본문 컬럼이 아예 없다.
--
-- 🔴 우나어 DB 와 소란소란 DB 는 별개다
--    FK 를 걸 수 없어 origin + sourceRef 문자열로 가리킨다.
--    무결성은 UNIQUE(origin, sourceRef) 하나로만 지킨다 —
--    참조 무결성이 없다는 뜻이므로, 적재 코드가 원천 존재를 먼저 확인해야 한다.
--
-- 🔴 기존 구조를 건드리지 않는다 (0004 · 0005 와 같은 원칙)
--    DROP · RENAME · 컬럼 타입 변경 · 기존 테이블 ALTER 가 전부 없다.
--    신규 enum 1개 + 신규 테이블 2개 + 인덱스만 더한다.
--    → 이 migration 을 먼저 적용해도 현재 배포된 코드는 정상 동작한다.
--      Micro Seed 발행 레일(publisher · approve · recover · importer)과 접점이 0이다.
--
-- 🔴 멱등하게 쓴다
--    우나어에서 migration 이력과 실제 스키마가 어긋나 `migrate deploy` 가 영구 차단된
--    사고가 있었다. 재실행돼도 실패하지 않도록 IF NOT EXISTS / DO $$ 로 감싼다.
--
-- ⚠️ 적용 방법: /prisma-guide 절차 — pg 모듈 직접 SQL + information_schema 검증.
--    `prisma migrate` · `db push` 를 쓰지 않는다.

-- CreateEnum
-- 🔴 referenced 가 approved 와 다른 것이 이 enum 의 존재 이유다.
--    우나어 usedAt 6,494건 중 실제 발행으로 이어진 것은 13건(0.2%)뿐이다.
--    스키마 주석도 "큐레이션 참조 시각" 이다 —
--    approved 로 넣으면 "사람이 승인했다" 는 거짓 정답지가 만들어진다.
--
--    String 이 아니라 enum 인 이유: 이 5값은 학습 정답지의 라벨이고,
--    오타 하나가 조용히 데이터를 오염시킨다.
DO $$
BEGIN
  CREATE TYPE "VoiceJudgmentDecision" AS ENUM (
    'approved',      -- 승인해 발행까지 간 것
    'held',          -- 보고 보류한 것. "아직 안 봤다" 와 구분된다
    'declined',      -- 명시적으로 제외한 것
    'not_imported',  -- fetch 했으나 원장에 넣지 않은 것 (부정 사례를 남기는 유일한 자리)
    'referenced'     -- 우나어 usedAt. 참조했을 뿐 승인이 아니다
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
-- 원천 1건 = 1행. 🔴 본문 컬럼이 없다 — 원문을 저장하지 않는 것이 설계다.
CREATE TABLE IF NOT EXISTS "VoiceSource" (
    "id" TEXT NOT NULL,

    -- 'unao_cafe' | 'micro_seed' | 'soransoran_own'
    -- 🔴 enum 이 아니다. M6 multi-source 확장에서 값이 늘어나는데
    --    그때마다 migration 을 요구하면 source 추가가 schema 작업이 된다.
    "origin" TEXT NOT NULL,
    -- 원천 레코드 id. 우나어 CafePost.id · 소란소란 MicroSeedRawContent.id
    -- 🔴 FK 아님 — 다른 DB 를 가리킬 수 있다
    "sourceRef" TEXT NOT NULL,

    "sourceSite" TEXT NOT NULL,
    -- 🔴 역추적용. 외부 노출 금지 (§10-5-A)
    "sourceUrl" TEXT NOT NULL,
    "sourceBoardName" TEXT,

    -- 🔴 닉네임 원문을 저장하지 않는다. 단방향 해시만.
    --    우나어 닉네임은 3~7자라 원문을 두면 검색으로 특정된다.
    "authorHash" TEXT,

    "postedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL,

    -- 원문 스냅샷 — 본문이 아니라 "그때 그 본문이었다" 의 증거.
    -- 🔴 원문을 복제하지 않는 대가를 메운다. 원문이 삭제·수정되면
    --    Derived 의 근거를 판정할 수 없게 되는데, 해시가 그것을 대신한다.
    "contentHash" TEXT,
    "contentLength" INTEGER,
    "commentCount" INTEGER,

    -- 원문 생존 확인 — 헌법 §10-3 이 "이것이 중요하다" 고 명시한 필드다.
    "lastVerifiedAt" TIMESTAMP(3),
    "deletedDetectedAt" TIMESTAMP(3),

    -- 우나어가 이미 매긴 라벨 (30,139건 · 재계산 비용 0).
    -- 🔴 필드로 펼치지 않는다 — 우나어 스키마에 종속되면 그쪽이 바뀔 때 같이 깨진다.
    "legacyLabels" JSONB,
    "legacyLabelVersion" TEXT,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 사람 판단 이력. 🔴 Voice Engine 이 학습할 정답지다.
CREATE TABLE IF NOT EXISTS "VoiceJudgment" (
    "id" TEXT NOT NULL,
    "voiceSourceId" TEXT NOT NULL,

    "decision" "VoiceJudgmentDecision" NOT NULL,
    "reason" TEXT,
    -- 'founder' | 'unao-curation' | 'system'
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 판단 시점의 VoiceDerived id.
    -- 🔴 VE-M2 전까지 VoiceDerived 테이블이 없으므로 FK 없이 문자열로만 둔다.
    --    "사람이 무엇을 보고 그렇게 정했는가" 가 없으면 정답지가 반쪽이다 —
    --    Q-1 규칙은 이미 두 번 바뀌었다 (PR #72 → #75).
    "derivedIdAtDecision" TEXT,

    CONSTRAINT "VoiceJudgment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 🔴 같은 원천을 두 번 등록하지 않는다.
--    FK 가 없으므로 중복 적재를 막는 유일한 방어다.
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceSource_origin_sourceRef_key" ON "VoiceSource"("origin", "sourceRef");

-- CreateIndex
-- 출처별 수집 순 스캔 — 'unao_cafe' 33,031건을 배치로 훑는다
CREATE INDEX IF NOT EXISTS "VoiceSource_origin_capturedAt_idx" ON "VoiceSource"("origin", "capturedAt");

-- CreateIndex
-- 사이트별 원문 작성일 — 우나어는 2016~2026 10년치다
CREATE INDEX IF NOT EXISTS "VoiceSource_sourceSite_postedAt_idx" ON "VoiceSource"("sourceSite", "postedAt");

-- CreateIndex
-- 원문 삭제 감지 스캔 — 아직 확인하지 않은 것을 고른다
CREATE INDEX IF NOT EXISTS "VoiceSource_deletedDetectedAt_idx" ON "VoiceSource"("deletedDetectedAt");

-- CreateIndex
-- 한 원천의 판단 이력을 시간순으로
CREATE INDEX IF NOT EXISTS "VoiceJudgment_voiceSourceId_decidedAt_idx" ON "VoiceJudgment"("voiceSourceId", "decidedAt");

-- CreateIndex
-- 판정별 집계 — referenced 6,494건 · approved N 건을 나눠 본다
CREATE INDEX IF NOT EXISTS "VoiceJudgment_decision_decidedAt_idx" ON "VoiceJudgment"("decision", "decidedAt");

-- AddForeignKey
-- 🔴 ON DELETE CASCADE — 0005 의 SET NULL 과 다르다.
--    VoiceJudgment 는 VoiceSource 없이 의미가 없다. 원천이 사라지면
--    "무엇에 대한 판단인지" 를 알 수 없는 고아 행이 남는다.
--    (MicroSeedCandidate 는 감사 기록이라 원문이 파기돼도 남아야 했다 — 성격이 다르다)
DO $$
BEGIN
  ALTER TABLE "VoiceJudgment"
    ADD CONSTRAINT "VoiceJudgment_voiceSourceId_fkey"
    FOREIGN KEY ("voiceSourceId") REFERENCES "VoiceSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
