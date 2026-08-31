-- 0018_persona_approval_queue
--
-- 페르소나 댓글 후보 승인 대기열.
-- 정본: docs/operations/2026-08-30-persona-architecture-design.md §13
--
-- 🔴 신규 enum 1개 + 신규 테이블 1개만 만든다.
--    기존 테이블은 어떤 것도 ALTER 하지 않는다.
-- 🔴 sourceTexts(원문 · 원댓글 전문) 컬럼을 두지 않는다.
--    storyRefs 참조만 남긴다 (§13 "원문 링크는 운영자만").

CREATE TYPE "PersonaCandidateStatus" AS ENUM (
  'PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED'
);

CREATE TABLE "PersonaApprovalQueue" (
  "id" TEXT NOT NULL,
  "personaId" TEXT NOT NULL,
  "targetPostId" TEXT,
  "status" "PersonaCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "candidateText" TEXT NOT NULL,
  "editedText" TEXT,
  "editDiff" JSONB,
  "reactionType" TEXT NOT NULL,
  "gateStatus" TEXT NOT NULL,
  "gateResults" JSONB NOT NULL,
  "aiToneTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "regenCount" INTEGER NOT NULL DEFAULT 0,
  "storyRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "seedRef" TEXT,
  "dedupKey" TEXT NOT NULL,
  "declineReason" TEXT,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "publishedCommentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonaApprovalQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonaApprovalQueue_dedupKey_key" ON "PersonaApprovalQueue"("dedupKey");
CREATE UNIQUE INDEX "PersonaApprovalQueue_publishedCommentId_key" ON "PersonaApprovalQueue"("publishedCommentId");
CREATE INDEX "PersonaApprovalQueue_status_createdAt_idx" ON "PersonaApprovalQueue"("status", "createdAt");
CREATE INDEX "PersonaApprovalQueue_personaId_createdAt_idx" ON "PersonaApprovalQueue"("personaId", "createdAt");

-- 🔴 Restrict — 대기열 이력이 남아 있는 페르소나는 지워지지 않는다
ALTER TABLE "PersonaApprovalQueue"
  ADD CONSTRAINT "PersonaApprovalQueue_personaId_fkey"
  FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
