-- Micro Seed 원문 보관 — M2 발행에 필요한 최소본 (PR-C0b)
--
-- 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §10-3 · §10-5 · §11-2 · §12
--
-- 🔴 이것은 M5 Voice Vault 가 아니다
--    §12 마일스톤에서 Raw / Derived / Publishing Input 3계층 자산화는 M5 다.
--    여기는 M2("본문 발행 · 원문 그대로 사용")가 당장 필요로 하는 것만 담는다.
--    §5-5 "넣으면 과한 것" 에 따라 sourceAuthorHash · sourceBoardCategory 를 넣지 않는다.
--
-- 🔴 기존 구조를 건드리지 않는다 (0004 와 같은 원칙)
--    DROP · RENAME · 컬럼 타입 변경 · 기존 컬럼에 NOT NULL 추가가 전부 없다.
--    신규 enum 1개 + 신규 테이블 1개 + MicroSeedCandidate 에 nullable 컬럼 1개 + 인덱스만 더한다.
--    → 이 migration 을 먼저 적용해도 현재 배포된 코드는 정상 동작한다.
--
-- 🔴 멱등하게 쓴다
--    우나어에서 migration 이력과 실제 스키마가 어긋나 `migrate deploy` 가 영구 차단된
--    사고가 있었다. 재실행돼도 실패하지 않도록 IF NOT EXISTS / DO $$ 로 감싼다.
--    (0003 의 FK 처리와 같은 방식)

-- CreateEnum
-- §10-3 표기를 그대로 쓴다: unao_legacy | live (소문자)
-- 🔴 unao_legacy 는 학습·분석 자산이며 직접 발행 금지다 (정책 12 · §10-1).
--    publisher 는 후보 쿼리에서 이 값을 코드로 배제해야 한다.
DO $$
BEGIN
  CREATE TYPE "MicroSeedRawOrigin" AS ENUM ('live', 'unao_legacy');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
-- 원문 1건 = 1행. MicroSeedCandidate 와 1:1.
CREATE TABLE IF NOT EXISTS "MicroSeedRawContent" (
    "id" TEXT NOT NULL,
    -- 기본값을 두지 않는다. 적재 주체가 명시하게 한다 —
    -- legacy 를 실수로 live 로 넣으면 정책 12 가 조용히 뚫린다.
    "origin" "MicroSeedRawOrigin" NOT NULL,

    -- 출처
    "sourceSite" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceArticleId" TEXT NOT NULL,
    "sourceCapturedAt" TIMESTAMP(3) NOT NULL,

    -- 원문. 5,000자 상한은 발행 게이트(G-A)가 보고, 저장은 원형 그대로 한다.
    -- 자르면 "그대로 사용"(정책 7)이 아니게 되고 되돌릴 수도 없다.
    "rawTitle" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,

    -- 원문 댓글 원형. M2 는 댓글을 발행하지 않는다 (댓글 활성화는 M3).
    -- M3 스펙(반응 지도 · 댓글 유형 분포 · 인용 적합성 라벨)이 아직 없어 구조를 정할 수 없고,
    -- 그렇다고 수집을 미루면 원문이 삭제됐을 때 영영 못 가져온다 → 원형만 담아 둔다.
    -- 🔴 M3 에서 별도 테이블로 승격해야 한다. §11-2 는 삭제 요청 시 **댓글 단위**
    --    역조회를 요구하는데 JSON 으로는 댓글 하나만 내릴 수 없다.
    "rawComments" JSONB,

    -- 원문 생존. §10-3 이 "이것이 중요하다" 고 명시한 필드다.
    -- 우나어는 발행 직전 게이트로만 사후 대응했고 이미 저장된 원문의 삭제는 감지하지 못했다.
    "deletedDetectedAt" TIMESTAMP(3),

    -- 보존 만료 예정 시각. 🔴 자동 삭제를 구현하지 않는다 — "언제까지 두기로 했는가" 의 기록이다.
    -- 기본 정책: 후보가 터미널 상태(PUBLISHED · DECLINED · SKIPPED · FAILED · TAKEDOWN)에
    --           들어간 뒤 90일. active 후보(HOLD · PENDING · PROCESSING)는 null 이다.
    -- ⚠️ 정본 TODO-9(Voice Vault 보존 정책) 확정 시 갱신한다.
    "retentionUntil" TIMESTAMP(3),

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicroSeedRawContent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- 🔴 nullable 로 더한다. 기존 행이 0건이지만 원칙을 지킨다 —
--    후보가 먼저 적재되고 본문이 나중에 붙는 순서를 허용해야 한다.
--    본문 없이 발행되지는 않는다: G-A 가 content 빈 값을 HOLD 로 막는다.
ALTER TABLE "MicroSeedCandidate" ADD COLUMN IF NOT EXISTS "rawContentId" TEXT;

-- CreateIndex
-- 1:1 — 한 원문이 두 후보로 갈라지지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS "MicroSeedCandidate_rawContentId_key" ON "MicroSeedCandidate"("rawContentId");

-- CreateIndex
-- collector 중복 적재 차단.
-- 🔴 dedupKey 문자열이 아니라 이 테이블 자신의 필드로 잠근다 —
--    dedupKey 는 Sheet 를 거치며 사람 손을 탈 수 있다 (§6-8 R11).
CREATE UNIQUE INDEX IF NOT EXISTS "MicroSeedRawContent_sourceSite_sourceArticleId_key" ON "MicroSeedRawContent"("sourceSite", "sourceArticleId");

-- CreateIndex
-- §10-1 legacy 배제 쿼리 — publisher 가 origin='unao_legacy' 를 걸러낸다
CREATE INDEX IF NOT EXISTS "MicroSeedRawContent_origin_idx" ON "MicroSeedRawContent"("origin");

-- CreateIndex
-- §11-2 takedown 역조회 — 원문 URL 로 찾는다
CREATE INDEX IF NOT EXISTS "MicroSeedRawContent_sourceUrl_idx" ON "MicroSeedRawContent"("sourceUrl");

-- CreateIndex
-- 원문 삭제 감지 스캔 — 아직 확인하지 않은 것을 고른다
CREATE INDEX IF NOT EXISTS "MicroSeedRawContent_deletedDetectedAt_idx" ON "MicroSeedRawContent"("deletedDetectedAt");

-- AddForeignKey
-- 🔴 ON DELETE SET NULL — Cascade 가 아니다.
--    원문을 보존기간 만료로 파기해도 후보 원장은 남아야 한다. 후보가 사라지면
--    "무엇을 발행했는지" 의 감사 기록이 함께 사라진다 (§6-4).
DO $$
BEGIN
  ALTER TABLE "MicroSeedCandidate"
    ADD CONSTRAINT "MicroSeedCandidate_rawContentId_fkey"
    FOREIGN KEY ("rawContentId") REFERENCES "MicroSeedRawContent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
