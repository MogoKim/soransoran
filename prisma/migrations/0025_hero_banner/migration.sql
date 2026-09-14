-- 0025_hero_banner
--
-- 홈 히어로 배너 — 운영자가 재배포 없이 홈 첫 화면을 교체한다.
--
-- 🔴 신규 enum 1개 + 신규 테이블 1개만 만든다.
--    기존 테이블은 어떤 것도 ALTER 하지 않는다. User 는 역관계라 스키마상
--    필드가 늘어 보이지만 DB 에는 컬럼이 생기지 않는다. (0019 와 같은 형태다)
--
-- 🔴 공개 이미지 URL 을 담지 않는다. R2 object key 만 담는다 —
--    공개 도메인이 바뀌면 저장된 URL 이 통째로 죽는다.
--
-- 🔴 이미지의 width·height 컬럼을 두지 않는다. 자리는 aspect-ratio 컨테이너가 잡는다.
--
-- 🔴 팝업용 type 컬럼과 campaignId 를 미리 만들지 않는다.
--    id 가 이미 변하지 않는 배너 식별자이고, nullable 컬럼은 나중에 무중단으로 붙는다.
--
-- 🔴 sortOrder 에 unique 를 걸지 않는다. 자리를 맞바꾸는 중간 상태가 제약에 걸린다.
--
-- 🔴 행을 지우지 않는다. archivedAt 으로 보관한다.
--    보관해도 R2 파일은 지우지 않는다 — 참조를 세는 곳이 없는 채로 지우면
--    살아 있는 배너의 그림이 깨진다.
--
-- 🔴 createdBy · updatedBy 는 SET NULL 이다. 사람이 떠나도 배너는 남아야 한다.
--
-- 🔴 down SQL 을 넣지 않는다. 되돌리기는 "모든 배너를 끄면 현재 정적 Hero 로 돌아간다" 가
--    정본이다. 테이블을 지우는 것은 데이터가 생긴 뒤에는 되돌릴 수 없고,
--    자동화해 두면 사고로 실행된다. DROP 은 창업자의 별도 명시 승인 사항이다.
--
-- 🔴 이 커밋에서 적용하지 않는다. 반영은 창업자 승인 후 별도 절차로 진행한다
--    (schema.prisma 머리말과 같은 규칙).

CREATE TYPE "HeroBannerLinkKind" AS ENUM ('NONE', 'INTERNAL', 'EXTERNAL');

CREATE TABLE "HeroBanner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "mobileImageKey" TEXT,
    "desktopImageKey" TEXT,
    "linkKind" "HeroBannerLinkKind" NOT NULL DEFAULT 'NONE',
    "linkUrl" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroBanner_pkey" PRIMARY KEY ("id")
);

-- 홈 조회가 쓰는 조합 그대로 둔다 — 켜져 있고 · 보관되지 않았고 · 순서대로
CREATE INDEX "HeroBanner_isActive_archivedAt_sortOrder_idx"
  ON "HeroBanner"("isActive", "archivedAt", "sortOrder");

-- 예약 구간을 훑는 조회용. 시각 판정 자체는 SQL 이 아니라 규칙 함수가 한다.
CREATE INDEX "HeroBanner_startsAt_idx" ON "HeroBanner"("startsAt");

CREATE INDEX "HeroBanner_endsAt_idx" ON "HeroBanner"("endsAt");

ALTER TABLE "HeroBanner"
  ADD CONSTRAINT "HeroBanner_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HeroBanner"
  ADD CONSTRAINT "HeroBanner_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
