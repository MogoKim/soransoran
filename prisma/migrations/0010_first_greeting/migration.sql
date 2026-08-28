-- 첫 가입 인사 — 그릇 (G1)
--
-- 이 migration 은 컬럼만 세운다. 화면도 서버 액션도 쿼리도 이 PR 에 없다.
-- 적용 직후 세 컬럼은 전부 NULL 이고, 사용자에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 Post.category 는 nullable 이다.
--    이미 22 건의 글이 있어 NOT NULL 은 적용 자체가 실패한다.
--    기존 글은 전부 NULL 로 남고 그것이 "일반 글" 을 뜻한다.
--
-- 🔴 category 는 콘텐츠 종류를 가리키는 축이다. 노출 여부를 뜻하지 않는다.
--    "검색에 넣을까 / 추천에 올릴까" 는 3 축 플래그가 답한다
--    (isMicroSeed · permanentNoindex · indexPromotionBlocked — post-visibility.ts).
--    한 컬럼이 두 질문에 답하게 두면 언젠가 한쪽이 틀린다.
--
-- 🔴 firstGreetingPostId 에 FOREIGN KEY 를 걸지 않는다.
--    이 값의 목적은 "이미 첫 인사를 했다" 를 기억하는 것이다.
--    FK + CASCADE 면 글을 지운 순간 이력도 함께 사라져 위젯이 다시 뜬다 —
--    막으려던 일이 바로 그것이다. 여기서는 무결성보다 이력 보존이 앞선다.
--
-- 🔴 index 를 만들지 않는다.
--    현재 글 22 건 · 회원 3 명이다. 이 규모에서 index 는 이득이 없고,
--    복합 index 는 데이터가 쌓여 실제 쿼리 모양이 정해진 뒤에 넣는 편이 낫다.
--
-- 적용: Supabase SQL Editor 에서 아래 전체를 한 번에 실행한다 (0002~0009 와 같은 방식).
--       Prisma CLI(migrate deploy · db push · db seed)는 이 프로젝트에서 쓰지 않는다.

BEGIN;

-- ── 1. Post — 콘텐츠 종류 축 ────────────────────────────────────────
-- 일반 글은 NULL. 첫 인사 글만 '가입인사' 가 들어간다.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- ── 2. User — 첫 인사 이력 ──────────────────────────────────────────
-- 최초 1 회만 기록된다. 두 값은 항상 함께 쓰이고 함께 비어 있다.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstGreetingAt"     TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstGreetingPostId" TEXT;

COMMIT;
