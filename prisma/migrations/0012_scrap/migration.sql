-- 스크랩 — 나중에 다시 보려고 담아 둔 글
--
-- 이 migration 은 테이블 하나만 세운다. 기존 테이블은 한 줄도 고치지 않는다.
-- 적용 직후 Scrap 은 비어 있고, 사용자에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 Post 에 scrapCount 를 만들지 않는다.
--    스크랩 수는 상세에도 목록에도 표시하지 않는다. 쓰지 않는 카운터는
--    토글마다 Post 행을 잠그기만 한다 — 보여주기로 결정한 날 그때 만든다.
--    (공감은 화면에 숫자를 두기로 해서 likeCount 를 만들었다. 여기는 다르다)
--
-- 🔴 unique 는 (postId, userId) 순서다.
--    Like 와 같은 순서로 맞춘다. 두 테이블의 키 순서가 다르면
--    읽는 사람이 매번 어느 쪽인지 확인해야 한다.
--
-- 🔴 index 를 하나 만든다 — (userId, createdAt DESC).
--    likeCount 때와 달리 여기는 쓸 곳이 이미 있다:
--    /my/scraps 가 "내 것을 최신순으로" 읽는다. 정렬까지 index 가 받는다.
--
-- 🔴 FK 는 양쪽 다 CASCADE 다.
--    글이 지워지면 그 글의 스크랩도 의미가 없고, 회원이 지워지면 그 사람의 스크랩도 그렇다.
--    남겨 두면 어디로도 갈 수 없는 행만 쌓인다.

CREATE TABLE IF NOT EXISTS "Scrap" (
    "id"        TEXT NOT NULL,
    "postId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scrap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Scrap_postId_userId_key" ON "Scrap"("postId", "userId");
CREATE INDEX IF NOT EXISTS "Scrap_userId_createdAt_idx" ON "Scrap"("userId", "createdAt" DESC);

-- 🔴 FK 는 있을 때만 건너뛴다.
--    CREATE TABLE/INDEX 는 IF NOT EXISTS 로 멱등한데 ADD CONSTRAINT 에는 그 문법이 없다.
--    그대로 두면 두 번째 실행이 duplicate 로 죽고, 그 순간 이 파일은
--    "한 번만 돌릴 수 있는 스크립트" 가 된다 — 재실행이 안전해야 손으로 다시 돌릴 수 있다.
--    기존 제약을 DROP 하지 않는다. 이미 맞게 걸려 있으면 그대로 두는 것이 맞다.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Scrap_postId_fkey'
    ) THEN
        ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_postId_fkey"
            FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Scrap_userId_fkey'
    ) THEN
        ALTER TABLE "Scrap" ADD CONSTRAINT "Scrap_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
