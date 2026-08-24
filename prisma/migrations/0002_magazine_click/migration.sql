-- 매거진 CTA 클릭 진단선
--
-- 개인정보 컬럼이 없다. userId·IP·User-Agent·Referer 를 저장하지 않는다.
-- 컬럼을 늘릴 일이 생기면 "이걸 저장해야 답할 수 있는 질문이 무엇인가" 를 먼저 적는다.

-- CreateTable
CREATE TABLE "MagazineClick" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "boardSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagazineClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MagazineClick_slug_createdAt_idx" ON "MagazineClick"("slug", "createdAt");

-- CreateIndex
CREATE INDEX "MagazineClick_createdAt_idx" ON "MagazineClick"("createdAt");
