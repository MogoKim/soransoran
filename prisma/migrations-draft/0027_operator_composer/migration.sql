-- 운영자 직접 작성(Operator Composer) — 🔴 **초안이다. 적용하지 않는다.**
--
-- 🔴 `prisma/migrations/` 가 아니라 `migrations-draft/` 에 있다.
--    활성 schema 에 컬럼만 올리고 DB 에 적용하지 않으면 `select` 없는 `create()` 가
--    없는 컬럼을 RETURNING 하다가 죽는다 — 자세한 것은 ../README.md.
--    🔴 **이 PR 은 schema 변경과 이 파일을 함께 담는다.** merge 전에 ③(적용)을 먼저 한다.
--
-- 무엇을 만드는가
--   ① OperatorWriter      창업자가 고르는 운영용 작성자 (자동 Persona 와 다른 표다)
--   ② OperatorWriteLog    누가(관리자) 누구 이름으로(작성자) 무엇을 했는가 · 중복 등록 차단
--   ③ Post/Comment 에 operatorWriterId 한 칸씩
--   ④ CommentOrigin 에 OPERATOR
--
-- 🔴 **기존 행을 하나도 건드리지 않는다.** 더하는 컬럼은 전부 NULL 허용이고 기본값이 없다 —
--    Postgres 는 그런 ADD COLUMN 을 재작성 없이 즉시 끝낸다. 백필도 하지 않는다.
--    NULL 은 "운영 직접 작성이 아니다" 는 뜻이고, 기존 글·댓글은 전부 그쪽이 맞다.
--
-- 🔴 **enum 값 추가는 되돌릴 수 없다.** Postgres 는 enum label 삭제를 지원하지 않는다.
--    그래서 이름을 `OPERATOR` 로 못박는다 — 나중에 뜻을 바꿔 쓰지 않는다.
--
-- 🔴 적용 순서가 중요하다. ④(enum)를 ②·③보다 **먼저** 둔다 —
--    Postgres 는 `ALTER TYPE ... ADD VALUE` 로 더한 label 을 **같은 트랜잭션 안에서**
--    쓰지 못한다(PG 12+ 도 마찬가지다). 이 파일은 값을 쓰지 않으므로 한 파일로 충분하지만,
--    적재 코드는 반드시 이 migration 이 커밋된 뒤에 돈다.

-- ─────────── ④ CommentOrigin 확장 ───────────
ALTER TYPE "CommentOrigin" ADD VALUE IF NOT EXISTS 'OPERATOR';

-- ─────────── enum 신설 ───────────
CREATE TYPE "OperatorWriterStatus" AS ENUM ('active', 'retired');
CREATE TYPE "OperatorWriteAction" AS ENUM ('create', 'update', 'delete');
CREATE TYPE "OperatorWriteKind" AS ENUM ('post', 'comment');

-- ─────────── ① OperatorWriter ───────────
CREATE TABLE "OperatorWriter" (
    "id"        TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "status"    "OperatorWriterStatus" NOT NULL DEFAULT 'active',
    "note"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorWriter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorWriter_code_key"   ON "OperatorWriter"("code");
CREATE UNIQUE INDEX "OperatorWriter_userId_key" ON "OperatorWriter"("userId");
CREATE INDEX "OperatorWriter_status_code_idx"   ON "OperatorWriter"("status", "code");

-- 🔴 Restrict — 글을 쓴 작성자의 User 는 지워지지 않는다
ALTER TABLE "OperatorWriter"
  ADD CONSTRAINT "OperatorWriter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────── ② OperatorWriteLog ───────────
CREATE TABLE "OperatorWriteLog" (
    "id"               TEXT NOT NULL,
    "operatorWriterId" TEXT NOT NULL,
    "actorUserId"      TEXT,
    "kind"             "OperatorWriteKind" NOT NULL,
    "action"           "OperatorWriteAction" NOT NULL,
    "targetId"         TEXT NOT NULL,
    "postId"           TEXT,
    "requestKey"       TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorWriteLog_pkey" PRIMARY KEY ("id")
);

-- 🔴 중복 등록 차단의 정본. NULL 은 unique 로 세지 않으므로 수정·삭제는 걸리지 않는다
CREATE UNIQUE INDEX "OperatorWriteLog_requestKey_key" ON "OperatorWriteLog"("requestKey");
CREATE INDEX "OperatorWriteLog_operatorWriterId_createdAt_idx" ON "OperatorWriteLog"("operatorWriterId", "createdAt");
CREATE INDEX "OperatorWriteLog_createdAt_idx"                  ON "OperatorWriteLog"("createdAt");
CREATE INDEX "OperatorWriteLog_kind_createdAt_idx"             ON "OperatorWriteLog"("kind", "createdAt");

ALTER TABLE "OperatorWriteLog"
  ADD CONSTRAINT "OperatorWriteLog_operatorWriterId_fkey"
  FOREIGN KEY ("operatorWriterId") REFERENCES "OperatorWriter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 🔴 SetNull — 관리자 계정이 사라져도 "무엇을 했는가" 는 남는다
ALTER TABLE "OperatorWriteLog"
  ADD CONSTRAINT "OperatorWriteLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────── ③ Post · Comment 의 새 칸 ───────────
-- 🔴 NULL 허용 · 기본값 없음 — 기존 행 재작성이 없다
ALTER TABLE "Post"    ADD COLUMN "operatorWriterId" TEXT;
ALTER TABLE "Comment" ADD COLUMN "operatorWriterId" TEXT;

CREATE INDEX "Post_operatorWriterId_createdAt_idx"    ON "Post"("operatorWriterId", "createdAt");
CREATE INDEX "Comment_operatorWriterId_createdAt_idx" ON "Comment"("operatorWriterId", "createdAt");

-- 🔴 Restrict — 글이 남아 있으면 작성자를 지울 수 없다. Persona 와 같은 계약이다
ALTER TABLE "Post"
  ADD CONSTRAINT "Post_operatorWriterId_fkey"
  FOREIGN KEY ("operatorWriterId") REFERENCES "OperatorWriter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_operatorWriterId_fkey"
  FOREIGN KEY ("operatorWriterId") REFERENCES "OperatorWriter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
