-- 0032 — 실제 고객 조회·목록 노출의 30일 중복 제거 원장
-- 적용 순서와 복구는 같은 폴더의 APPLY.md 를 따른다.
-- 기존 Post.viewCount 값은 건드리지 않고 seed·backfill 도 하지 않는다.

CREATE TYPE "PostExposureKind" AS ENUM ('DETAIL_OPEN', 'LIST_EXPOSURE');
CREATE TYPE "PostExposureSurface" AS ENUM ('DETAIL', 'HOME', 'BOARD', 'BEST', 'NEXT_TO_READ');

CREATE TABLE "PostExposureEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" "PostExposureKind" NOT NULL,
    "surface" "PostExposureSurface" NOT NULL,
    "viewerKeyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostExposureEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostExposureEvent_postId_kind_viewerKeyHash_windowStart_key"
ON "PostExposureEvent"("postId", "kind", "viewerKeyHash", "windowStart");

CREATE INDEX "PostExposureEvent_createdAt_idx" ON "PostExposureEvent"("createdAt");
CREATE INDEX "PostExposureEvent_postId_kind_createdAt_idx"
ON "PostExposureEvent"("postId", "kind", "createdAt");

ALTER TABLE "PostExposureEvent"
ADD CONSTRAINT "PostExposureEvent_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
