-- 0033 — 관리자 수동 Persona 대화 감사 원장
-- 자동 Persona 후보·발행 기록과 섞지 않고, 공개 Comment 와 같은 트랜잭션에서 provenance 를 남긴다.
-- 기존 Comment·PersonaActivityLog 행은 backfill 하지 않는다.

CREATE TYPE "ManualPersonaThreadKind" AS ENUM ('COMMENT', 'REPLY', 'AUTHOR_REPLY');

CREATE TABLE "ManualPersonaThreadLog" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "parentId" TEXT,
    "actorUserId" TEXT,
    "kind" "ManualPersonaThreadKind" NOT NULL,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPersonaThreadLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualPersonaThreadLog_commentId_key"
ON "ManualPersonaThreadLog"("commentId");

CREATE UNIQUE INDEX "ManualPersonaThreadLog_requestKey_key"
ON "ManualPersonaThreadLog"("requestKey");

CREATE INDEX "ManualPersonaThreadLog_postId_createdAt_idx"
ON "ManualPersonaThreadLog"("postId", "createdAt");

CREATE INDEX "ManualPersonaThreadLog_personaId_createdAt_idx"
ON "ManualPersonaThreadLog"("personaId", "createdAt");

ALTER TABLE "ManualPersonaThreadLog"
ADD CONSTRAINT "ManualPersonaThreadLog_commentId_fkey"
FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPersonaThreadLog"
ADD CONSTRAINT "ManualPersonaThreadLog_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPersonaThreadLog"
ADD CONSTRAINT "ManualPersonaThreadLog_personaId_fkey"
FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManualPersonaThreadLog"
ADD CONSTRAINT "ManualPersonaThreadLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
