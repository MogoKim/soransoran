-- 원문 시각 두 칸 — 🔴 **초안이다. 적용하지 않는다.**
--
-- 🔴 `prisma/migrations/` 가 아니라 `migrations-draft/` 에 있다.
--    활성 schema 에 컬럼만 올리고 DB 에 적용하지 않으면 `select` 없는 `create()` 가
--    없는 컬럼을 RETURNING 하다가 죽는다 — 자세한 것은 ../README.md.
--    schema 변경과 이 파일의 적용은 **같은 작업으로 묶는다.**
--
-- 왜 필요한가 (2026-09-17 실측):
--   수집기는 `sourcePostedAt` 을 이미 100% 뽑고 있었다(remonterrace 222/222 · wgang 82/82).
--   그런데 얇은 변환·adapt·생성 산출물·이 테이블 어디에도 자리가 없어서 전부 버려졌고,
--   신선도 판정이 `sourceCapturedAt`(= 우리가 본 시각)으로 떨어졌다.
--   그래서 2020년 글이 "오늘 들어온 글(0일차)" 로 잡혔다.
--
-- 🔴 두 칸 모두 NULL 을 허용한다. NULL 은 "없다" 가 아니라 **"모른다"** 다 —
--    82cook 은 지금 게시 시각을 뽑지 않고, 이 migration 이전 행에도 값이 없다.
--    기존 행을 `sourceCapturedAt` 으로 채우지 않는다. 채우면 바로 그 결함이 되살아난다.
--
-- 🔴 `sourcePostedAt` 은 **원문이 올라온 시각**이고 사건·방송·발언 시각이 아니다.
--
-- 🔴 기존 컬럼을 바꾸지 않는다. 인덱스도 지금 만들지 않는다 —
--    TTL 판정이 이 값을 실제로 읽기 시작할 때 질의 모양을 보고 정한다.

ALTER TABLE "MicroSeedRawContent" ADD COLUMN "sourcePostedAt" TIMESTAMP(3);
ALTER TABLE "MicroSeedRawContent" ADD COLUMN "sourceListedAt" TIMESTAMP(3);
