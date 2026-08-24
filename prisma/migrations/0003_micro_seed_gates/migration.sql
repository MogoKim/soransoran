-- Micro Seed 게이트 (M0 Schema & Gate Foundation)
--
-- 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §3 C-1 · §4 · §5-1
--
-- 이 migration 은 "게이트를 먼저 세운다". Micro Seed 글은 아직 0건이며
-- 모든 신규 컬럼이 기존 동작과 같은 기본값을 갖는다 → 기존 서비스 회귀 0.
--
-- Post 3필드
--   isMicroSeed           Micro Seed 레인 발행물인가
--   permanentNoindex      영구 noindex (정책 8·10)
--   indexPromotionBlocked 승격·추천 write-path 차단 (정책 9·10 · C-4)
--   → 셋 다 DEFAULT false. 기존 글은 전부 기존과 동일하게 색인·추천 대상이다.
--
-- Comment.commentOrigin
--   🔴 AuthorSource 를 확장하지 않는다. "사람이 썼나"(source)와
--      "어느 레인에서 왔나"(commentOrigin)는 다른 축이다 (§8-6).
--   → DEFAULT 'MEMBER'. 기존 실회원 댓글(source=USER)은 그대로 MEMBER 다.

-- CreateEnum
CREATE TYPE "CommentOrigin" AS ENUM ('MEMBER', 'PERSONA', 'MICRO_SEED_VERBATIM');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "isMicroSeed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permanentNoindex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "indexPromotionBlocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "commentOrigin" "CommentOrigin" NOT NULL DEFAULT 'MEMBER';

-- CreateIndex
-- sitemap 등 색인 대상 조회용. SEARCH_INDEXABLE_WHERE 와 짝이다.
CREATE INDEX "Post_status_isMicroSeed_permanentNoindex_idx" ON "Post"("status", "isMicroSeed", "permanentNoindex");
