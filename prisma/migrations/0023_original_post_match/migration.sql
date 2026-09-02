-- 0023_original_post_match
--
-- 오리지널 초안에 "누가 이 글을 쓸 것인가" 를 남긴다.
-- 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §5
--
-- 🔴 **기존 테이블 하나만 ALTER 한다 — OriginalPostApprovalQueue.**
--    Persona 는 FK 로 **참조만** 한다(ALTER 하지 않는다).
--    Post · MicroSeedCandidate · MicroSeedRawContent · User · Comment 는 손대지 않는다.
--
-- 🔴 **새 테이블을 만들지 않는다.**
--    재매칭 이력을 위한 별도 테이블을 두지 않은 이유 —
--    매칭 점수는 순수 함수의 산물이라 dry-run 이 언제든 다시 낸다.
--    저장하면 규칙이 바뀌는 순간 낡은 값이 남고, 같은 질문에 답하는 자리가 둘이 된다.
--    진짜 저장해야 하는 것은 **배정 시점의 근거 하나**이고 그것이 matchMeta 다.
--    PersonaApprovalQueue.targetPostId 도 컬럼 하나로 같은 문제를 풀었다.
--
-- 🔴 **원문 본문 컬럼을 만들지 않는다.** 원문은 MicroSeedRawContent 에 원형으로 있다.
--
-- 🔴 **matchMeta 에 blockedBy 전문을 담지 않는다.**
--    누가 왜 탈락했는지는 dry-run 이 언제든 다시 낸다 — 저장할 이유가 없다.
--    담는 것은 "왜 이 사람이었나" 에 답할 최소치뿐이다.
--
-- 🔴 **멱등이다.** 두 번 돌려도 실패하지 않는다.
--    이 저장소는 Prisma CLI 마이그레이션을 쓰지 않고 pg 모듈로 직접 실행하므로
--    같은 파일이 다시 실행될 수 있다 (0021 · 0022 와 같은 판단).
--
-- 🔴 **배정은 발행이 아니다.** 이 컬럼들이 채워져도 Post 는 생기지 않는다.
--    createdPostId 는 그대로 비어 있고, 발행 경로는 별도 승인 대상이다.

-- ── 컬럼 3개 ──
ALTER TABLE "OriginalPostApprovalQueue" ADD COLUMN IF NOT EXISTS "matchedPersonaId" TEXT;
ALTER TABLE "OriginalPostApprovalQueue" ADD COLUMN IF NOT EXISTS "matchedAt" TIMESTAMP(3);
ALTER TABLE "OriginalPostApprovalQueue" ADD COLUMN IF NOT EXISTS "matchMeta" JSONB;

-- ── 인덱스 ──
-- 🔴 "이 페르소나에게 무엇이 배정됐나" 를 세는 조회가 실제로 있다(주간 여력 계산).
--    쓰지 않는 인덱스는 만들지 않지만, 이것은 쓴다.
CREATE INDEX IF NOT EXISTS "OriginalPostApprovalQueue_matchedPersonaId_matchedAt_idx"
  ON "OriginalPostApprovalQueue" ("matchedPersonaId", "matchedAt");

-- ── FK ──
-- 🔴 ON DELETE RESTRICT — 배정 이력이 있는 페르소나는 지워지지 않는다.
--    지우면 "누가 쓰기로 했었나" 를 영구히 잃는다 (Post.personaId 와 같은 원칙).
-- 🔴 DROP IF EXISTS 를 먼저 둔다 — 멱등을 위해서다. 기존 FK 를 지우는 것이 아니라
--    같은 이름이 이미 있을 때만 지운다(재실행 대비).
ALTER TABLE "OriginalPostApprovalQueue"
  DROP CONSTRAINT IF EXISTS "OriginalPostApprovalQueue_matchedPersonaId_fkey";

ALTER TABLE "OriginalPostApprovalQueue"
  ADD CONSTRAINT "OriginalPostApprovalQueue_matchedPersonaId_fkey"
  FOREIGN KEY ("matchedPersonaId") REFERENCES "Persona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
