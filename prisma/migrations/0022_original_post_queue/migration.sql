-- 0022_original_post_queue
--
-- 오리지널 초안 검수 대기열.
-- 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
--
-- 🔴 신규 enum 1개 + 신규 테이블 1개만 만든다.
--    기존 테이블은 어떤 것도 ALTER 하지 않는다 — MicroSeedCandidate 는 손대지 않는다.
--    그 테이블은 Sheet 17열과 1:1 로 묶여 있어(§6-7-A) 다른 레인을 끼우면 계약이 깨진다.
--
-- 🔴 원문(rawTitle · rawBody)을 담는 컬럼이 없다.
--    원문은 MicroSeedRawContent 에 이미 원형으로 있고, 여기는 sourceRawContentId 로만 잇는다.
--    두 벌 두지 않는다 — 원문 저장 금지 계약(PR #288)의 연장이다.
--
-- 🔴 BLOCK 판정 초안은 이 테이블에 들어오지 않는다.
--    SOURCE_ECHO 로 막힌 초안은 곧 원문 조각이 든 레코드다. 그걸 DB 에 남기면
--    파일에서 assertNoStoredSource 가 막아온 것을 DB 로 우회하게 된다.
--    적재는 PASS · HOLD 만 한다 (scripts/lib/original-post-queue.ts 가 강제).

CREATE TYPE "OriginalPostCandidateStatus" AS ENUM (
  'PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED'
);

CREATE TABLE "OriginalPostApprovalQueue" (
  "id" TEXT NOT NULL,
  "sourceRawContentId" TEXT NOT NULL,
  "status" "OriginalPostCandidateStatus" NOT NULL DEFAULT 'PENDING',

  -- 생성 원본. 🔴 사람이 고쳐도 이 값은 그대로 남는다 — 무엇이 나왔었는지가 이력이다
  "draftTitle" TEXT NOT NULL,
  "draftBody" TEXT NOT NULL,
  -- 창업자 수정본. 🔴 EDITED 면 반드시 채워져 있어야 한다
  "editedTitle" TEXT,
  "editedBody" TEXT,
  "editDiff" JSONB,

  -- 판정. 🔴 PASS 는 승인이 아니라 "대기열로 보내도 된다" 는 뜻이다
  "gateVerdict" TEXT NOT NULL,
  "gateResults" JSONB NOT NULL,

  -- 어느 판·어느 모델에서 나왔나. 14판까지의 이력이 값을 가진다
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "regenCount" INTEGER NOT NULL DEFAULT 0,

  "declineReason" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),

  -- 🔴 이번 PR 에서는 아무도 채우지 않는다. 발행 경로는 별도 승인 대상이다
  "createdPostId" TEXT,

  "dedupKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OriginalPostApprovalQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OriginalPostApprovalQueue_dedupKey_key"
  ON "OriginalPostApprovalQueue"("dedupKey");
CREATE UNIQUE INDEX "OriginalPostApprovalQueue_createdPostId_key"
  ON "OriginalPostApprovalQueue"("createdPostId");
CREATE INDEX "OriginalPostApprovalQueue_status_createdAt_idx"
  ON "OriginalPostApprovalQueue"("status", "createdAt");
CREATE INDEX "OriginalPostApprovalQueue_sourceRawContentId_createdAt_idx"
  ON "OriginalPostApprovalQueue"("sourceRawContentId", "createdAt");

-- 🔴 Restrict — 대기열 이력이 남아 있는 원문은 지워지지 않는다.
--    초안만 남고 무엇에서 나왔는지 모르는 상태를 만들지 않는다.
ALTER TABLE "OriginalPostApprovalQueue"
  ADD CONSTRAINT "OriginalPostApprovalQueue_sourceRawContentId_fkey"
  FOREIGN KEY ("sourceRawContentId") REFERENCES "MicroSeedRawContent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
