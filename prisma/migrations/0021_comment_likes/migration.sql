-- 댓글 공감 — 그릇과 표만 세운다
--
-- 🔴 production 에 아직 적용하지 않았다. 창업자 승인 후 pg 모듈로 직접 실행한다.
--    Prisma CLI(migrate deploy · db push)는 쓰지 않는다.
--
-- 이 migration 은 컬럼 하나와 테이블 하나를 세운다. 화면도 서버 액션 호출부도 없다.
-- 적용 직후 모든 댓글의 likeCount 는 0 이고, 사용자에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 Like 를 nullable polymorphic 으로 바꾸지 않는다.
--    Like.postId 는 NOT NULL 이고, 그것을 열면 unique·index·모든 호출부가 함께 흔들린다.
--    글 공감이 조용히 깨지는 위험을 댓글 공감이 질 이유가 없다. 표를 따로 세운다.
--
-- 🔴 DEFAULT 0 · NOT NULL 로 둔다.
--    NULL 을 허용하면 "아직 안 센 댓글" 과 "0 인 댓글" 이 섞인다.
--    공감은 없으면 0 이다. 모르는 상태가 없다.
--
-- 🔴 backfill 을 하지 않는다.
--    CommentLike 는 이 migration 에서 처음 생기므로 세어야 할 과거가 없다.
--    기존 댓글은 전부 0 이 곧 정답이다.
--
-- 🔴 likeCount 에 index 를 만들지 않는다.
--    공감순으로 정렬하는 화면이 아직 없다. 정렬을 붙이는 날 그때 만든다 —
--    쓰지 않는 index 는 쓰기마다 비용만 낸다. (Post.likeCount 도 같은 판단이었다)
--
-- 🔴 재실행이 안전해야 한다. 손으로 다시 돌릴 수 있어야 하기 때문이다.
--    CREATE 는 IF NOT EXISTS 로, 제약은 DO 블록으로 감싼다.

-- ── 1. 댓글에 공감 수 컬럼 ────────────────────────────────
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "likeCount" INTEGER NOT NULL DEFAULT 0;

-- ── 2. 댓글 공감 표 (회원 전용) ───────────────────────────
CREATE TABLE IF NOT EXISTS "CommentLike" (
    "id"        TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("id")
);

-- 🔴 unique 는 (commentId, userId) 순서다 — Like·Scrap 과 같은 (대상, 사람) 순서.
--    한 사람이 같은 댓글에 두 번 공감하는 것을 DB 가 막는다.
--    앱이 먼저 확인하지만, 두 번 눌린 요청이 겹치면 앱만으로는 늦는다.
CREATE UNIQUE INDEX IF NOT EXISTS "CommentLike_commentId_userId_key" ON "CommentLike"("commentId", "userId");
CREATE INDEX IF NOT EXISTS "CommentLike_userId_idx" ON "CommentLike"("userId");

-- ── 3. FK — 양쪽 다 CASCADE ───────────────────────────────
-- 🔴 댓글이 지워지면 그 댓글의 공감도 의미가 없고, 회원이 지워지면 그 사람의 공감도 그렇다.
--    남겨 두면 어디로도 갈 수 없는 행만 쌓인다.
--    (Comment.authorId 는 SetNull 이다 — 댓글 자체는 남아야 대화가 이어지기 때문이고,
--     공감은 남길 이유가 없다. 두 판단은 다르다)
--
-- 🔴 ADD CONSTRAINT 에는 IF NOT EXISTS 가 없다. 그대로 두면 두 번째 실행이
--    duplicate 로 죽어 이 파일이 "한 번만 돌릴 수 있는 스크립트" 가 된다.
--    기존 제약을 DROP 하지 않는다 — 이미 맞게 걸려 있으면 그대로 두는 것이 맞다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommentLike_commentId_fkey'
    ) THEN
        ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey"
            FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommentLike_userId_fkey'
    ) THEN
        ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
