-- 0019_home_exposure_override
--
-- 홈 "지금 뜨는 이야기" 노출 예외 — 자동 인기 점수 위에 운영자가 얹는 한 겹.
--
-- 🔴 신규 enum 2개 + 신규 테이블 1개만 만든다.
--    기존 테이블은 어떤 것도 ALTER 하지 않는다. Post·User 는 역관계라 스키마상
--    필드가 늘어 보이지만 DB 에는 컬럼이 생기지 않는다.
--
-- 🔴 Post 를 고치지 않는다. status·isMicroSeed 같은 글의 성질은 그대로다.
--    "홈에서 안 보인다" 와 "글이 숨겨졌다" 는 다른 일이다.
--
-- 🔴 만료된 행을 지우지 않는다. 무엇을 언제 왜 올렸는지가 이력으로 남는다.
--    활성 판정은 isActive AND (expiresAt IS NULL OR expiresAt > now) 다.
--
-- 🔴 post 는 RESTRICT 다. 예외가 걸린 글이 사라지면 왜 그렇게 보였는지 설명할 수 없다.
-- 🔴 createdBy 는 SET NULL 이다. 사람이 떠나도 예외 이력은 남아야 한다.

CREATE TYPE "HomeExposureSurface" AS ENUM ('HOME_POPULAR');

CREATE TYPE "HomeExposureAction" AS ENUM ('PIN', 'HIDE');

CREATE TABLE "HomeExposureOverride" (
  "id" TEXT NOT NULL,
  "surface" "HomeExposureSurface" NOT NULL,
  "postId" TEXT NOT NULL,
  "action" "HomeExposureAction" NOT NULL,
  "position" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HomeExposureOverride_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomeExposureOverride_surface_isActive_idx"
  ON "HomeExposureOverride"("surface", "isActive");

CREATE INDEX "HomeExposureOverride_postId_idx"
  ON "HomeExposureOverride"("postId");

CREATE INDEX "HomeExposureOverride_expiresAt_idx"
  ON "HomeExposureOverride"("expiresAt");

ALTER TABLE "HomeExposureOverride"
  ADD CONSTRAINT "HomeExposureOverride_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HomeExposureOverride"
  ADD CONSTRAINT "HomeExposureOverride_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
