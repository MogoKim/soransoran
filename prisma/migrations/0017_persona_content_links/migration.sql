-- Post.personaId · Comment.personaId — 어느 페르소나가 썼는지
--
-- 정본: docs/operations/2026-08-31-persona-db-model-design.md §11 · §14
--
-- 🔴 이 migration 만 운영 중 테이블을 건드린다.
--    0014~0016 은 새 테이블만 만들어 기존 경로에 영향이 없었다.
--    그래서 마지막에 두었고, 앞의 셋이 적용·검증된 뒤에 실행한다.
--
-- 컬럼 두 개와 인덱스 두 개, FK 두 개를 더한다.
-- 기존 컬럼·데이터는 한 줄도 고치지 않는다. 적용 직후 두 컬럼은 전부 NULL 이고,
-- 고객에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 nullable 이다. 실회원 글·댓글은 NULL 로 남는다.
--    NOT NULL 이면 기존 23개 글 · 6개 댓글에 값이 없어 적용 자체가 실패한다.
--
-- 🔴 AuthorSource 를 확장하지 않는다.
--    schema.prisma 41~44행 주석이 이미 정했다 —
--      AuthorSource  = "사람이 썼나"        (USER / SYSTEM)
--      CommentOrigin = "어느 레인에서 왔나" (MEMBER / PERSONA / MICRO_SEED_VERBATIM)
--      personaId     = "누가 썼나"          ← 세 번째 축
--    한 필드가 두 질문에 답하게 하면 분류가 무너진다.
--
-- 🔴 postOrigin enum 을 만들지 않는다.
--    Comment 의 commentOrigin 과 대칭을 맞추고 싶어지지만, personaId 만으로 판별된다.
--    같은 질문에 답하는 축을 둘 두면 언젠가 어긋난다.
--
-- 🔴 CommentOrigin 의 값도 의미도 바꾸지 않는다.
--    commentOrigin 은 레인을, personaId 는 사람을 가리킨다. 둘 다 남는다.
--
-- 🔴 FK 는 Restrict 다. SetNull 이 아니다.
--    글이 남아 있으면 Persona 삭제가 막힌다. 페르소나는 지우는 것이 아니라
--    status=retired 로 끄는 것이고(설계 §5 · §15),
--    SetNull 이면 "어느 페르소나가 썼는지" 를 영구히 잃는다.
--    외부 비공개 정책에서 그 추적성이 유일한 통제 수단이다(전략 §10-3).
--
-- 🔴 인덱스를 만든다 — 0014 에서 안 만든 것과 다르다.
--    쓸 곳이 이미 있다: kill switch 후 "그 페르소나 발화만 골라 내리기".
--    takedown 은 급할 때 도는 쿼리다.
--
-- 멱등하다.

ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "personaId" TEXT;

ALTER TABLE "Comment"
  ADD COLUMN IF NOT EXISTS "personaId" TEXT;

CREATE INDEX IF NOT EXISTS "Post_personaId_idx"    ON "Post"("personaId");
CREATE INDEX IF NOT EXISTS "Comment_personaId_idx" ON "Comment"("personaId");

-- 🔴 FK 는 있을 때만 건너뛴다. ADD CONSTRAINT 에는 IF NOT EXISTS 문법이 없다
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Post_personaId_fkey') THEN
        ALTER TABLE "Post"
            ADD CONSTRAINT "Post_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Comment_personaId_fkey') THEN
        ALTER TABLE "Comment"
            ADD CONSTRAINT "Comment_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
