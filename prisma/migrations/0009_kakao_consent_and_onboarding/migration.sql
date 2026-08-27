-- 카카오 동의 항목 · 가입 온보딩 · 동의 이력 (P1-KAKAO-A)
--
-- 이 migration 은 "그릇만 세운다". 실제 수집은 이후 PR 이다.
-- 이 시점에 카카오 권한은 아직 승인 전이고, scope 도 profile() 도 그대로다.
-- 따라서 적용 직후 이 컬럼들은 전부 NULL 이고 Agreement 는 0 건이다.
--
-- 🔴 신규 컬럼은 전부 nullable 이다.
--    이미 가입한 회원이 있어 NOT NULL 은 적용 자체가 실패한다.
--    "필수" 는 컬럼 제약이 아니라 가입 게이트가 정한다.
--
-- 🔴 isOnboarded 만 NOT NULL DEFAULT false 다.
--    기존 회원은 false 로 시작해 다음 로그인 때 온보딩을 한 번 거친다 — 의도한 동작이다.
--
-- 🔴 birthyear 는 TEXT 다. 카카오가 주는 값이 "1975" 같은 문자열이고,
--    숫자로 바꾸면 "0000" 이 0 으로 조용히 저장된다.
--
-- 🔴 phoneNumber 에 UNIQUE 를 걸지 않는다.
--    가족이 한 번호를 함께 쓰는 경우가 있고, unique 는 그 가입을 이유 없이 막는다.
--
-- 적용: Supabase SQL Editor 에서 아래 전체를 한 번에 실행한다 (0002~0008 과 같은 방식).
--       Prisma CLI(migrate deploy · db push · db seed)는 이 프로젝트에서 쓰지 않는다.

BEGIN;

-- ── 1. User — 카카오 동의 항목 · 온보딩 상태 ─────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender"             TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "birthyear"          TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneNumber"        TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileConsentAt"   TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "marketingConsentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOnboarded"        BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Agreement — 동의 이력 ────────────────────────────────────────
-- type 은 TEXT 다. enum 으로 두면 항목이 하나 늘 때마다 migration 이 필요하다.
--   쓰는 값: 'TERMS_OF_SERVICE' | 'PRIVACY_POLICY' | 'MARKETING'
CREATE TABLE IF NOT EXISTS "Agreement" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  -- 약관 판본. 약관이 바뀌면 새 version 으로 다시 받는다.
  "version"   TEXT NOT NULL,
  "agreedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- 회원이 사라지면 그 동의 기록도 함께 사라진다 (개인정보 파기 원칙)
ALTER TABLE "Agreement" DROP CONSTRAINT IF EXISTS "Agreement_userId_fkey";
ALTER TABLE "Agreement"
  ADD CONSTRAINT "Agreement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 같은 판본에 두 번 동의한 것으로 기록되지 않는다. 재동의는 upsert 로 agreedAt 만 갱신한다.
CREATE UNIQUE INDEX IF NOT EXISTS "Agreement_userId_type_version_key"
  ON "Agreement"("userId", "type", "version");
CREATE INDEX IF NOT EXISTS "Agreement_userId_idx" ON "Agreement"("userId");
CREATE INDEX IF NOT EXISTS "Agreement_type_idx"   ON "Agreement"("type");

COMMIT;
