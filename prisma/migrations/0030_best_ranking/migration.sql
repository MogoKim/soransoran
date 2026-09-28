-- 0030 — /best 영구 랭킹·기록
--
-- 🔴 적용 순서·복구는 같은 폴더의 APPLY.md 가 정본이다. 코드 배포보다 먼저 적용한다.
-- 🔴 계수는 여기 적지 않는다(src/lib/best-ranking.ts). 이 회차는 칼럼·표·인덱스만 만든다.

-- AlterTable
-- 새 글은 삽입 시각을 기본 순위 키로 받는다 — 어느 발행 경로도 이 칼럼을 몰라도 된다.
ALTER TABLE "Post" ADD COLUMN     "bestRankScore" DOUBLE PRECISION NOT NULL DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP))::double precision,
ADD COLUMN     "bestReactionWeight" INTEGER NOT NULL DEFAULT 0;

-- 기존 글은 적용 시각이 아니라 자기 작성 시각에서 출발한다.
-- 실반응 기여는 여기서 계산하지 않는다 — 식이 한 곳에 있어야 한다. `npm run best:backfill -- --apply` 가 채운다.
UPDATE "Post" SET "bestRankScore" = EXTRACT(EPOCH FROM "createdAt")::double precision;

-- CreateTable
CREATE TABLE "BestSelection" (
    "postId" TEXT NOT NULL,
    "firstEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoreAtEntry" DOUBLE PRECISION NOT NULL,
    "peakRank" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,

    CONSTRAINT "BestSelection_pkey" PRIMARY KEY ("postId")
);

-- CreateIndex
CREATE INDEX "BestSelection_firstEnteredAt_postId_idx" ON "BestSelection"("firstEnteredAt" DESC, "postId" DESC);

-- CreateIndex
CREATE INDEX "Post_status_isMicroSeed_indexPromotionBlocked_bestRankScore_idx" ON "Post"("status", "isMicroSeed", "indexPromotionBlocked", "bestRankScore" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "BestSelection" ADD CONSTRAINT "BestSelection_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
