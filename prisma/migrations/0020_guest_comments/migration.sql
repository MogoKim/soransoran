-- 비회원 댓글 1차 MVP
--
-- 🔴 production 에 아직 적용하지 않았다. 창업자 승인 후 /prisma-guide 절차대로
--    pg 모듈로 직접 실행한다. Prisma CLI(migrate deploy·db push)는 쓰지 않는다.
--
-- 🔴 enum 값 추가는 트랜잭션 안에서 실행할 수 없다(PostgreSQL 제약).
--    STEP 1 을 따로 실행한 뒤 STEP 2 를 실행한다.
--
-- 🔴 authorId 를 nullable 로 바꾸는 것은 제약 완화라 기존 행을 건드리지 않는다.
--    기존 MEMBER · PERSONA · MICRO_SEED_VERBATIM 댓글은 그대로 authorId 를 갖는다.

-- ── STEP 1. enum 값 추가 (단독 실행) ─────────────────────────
ALTER TYPE "CommentOrigin" ADD VALUE IF NOT EXISTS 'GUEST';

-- ── STEP 2. 컬럼·제약 (여기부터 한 트랜잭션) ─────────────────
ALTER TABLE "Comment" ALTER COLUMN "authorId" DROP NOT NULL;

ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "guestNickname" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "guestPasswordHash" TEXT;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "guestPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "guestLockedUntil" TIMESTAMP(3);

-- FK 를 SetNull 로 바꾼다 — 회원이 탈퇴해도 댓글은 남는다.
-- 제약에는 IF NOT EXISTS 가 없어 DO 블록으로 감싼다.
ALTER TABLE "Comment" DROP CONSTRAINT IF EXISTS "Comment_authorId_fkey";
DO $$ BEGIN
  ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
