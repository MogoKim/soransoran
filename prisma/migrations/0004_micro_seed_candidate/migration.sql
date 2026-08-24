-- Micro Seed Founder Gate 원장 (M1-A′)
--
-- 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6
--
-- 이 migration 은 "원장을 먼저 세운다". 후보 적재 · 발행 코드는 이후 PR 이다.
-- 이 시점에 Micro Seed 후보는 0건이고 발행물도 0건이다.
--
-- 🔴 왜 DB 테이블인가 (정책 16 · §5-2-0)
--    Google Sheets API 에는 compare-and-set 이 없다. 두 워커가 같은 행을 읽고
--    둘 다 PROCESSING 을 쓸 수 있다 — 즉 Sheet 만으로는 중복 발행을 구조적으로
--    막을 수 없다. `UPDATE ... WHERE status='PENDING'` 의 원자성이 1차 방어의
--    전부다 (§6-10). Sheet 는 창업자 승인 UI 이고 DB 가 진실의 원장이다.
--
-- 🔴 기존 구조를 건드리지 않는다
--    DROP · RENAME · 컬럼 타입 변경 · 기존 컬럼에 NOT NULL 추가가 전부 없다.
--    신규 테이블 2개 + Post 에 nullable 컬럼 6개 + 인덱스만 더한다.
--    → 이 migration 을 먼저 적용해도 현재 배포된 코드는 정상 동작한다.
--      (0003 과 같은 구조. 배포 순서는 정본 §12-3 참조)
--
-- 🚫 3축 플래그(isMicroSeed · permanentNoindex · indexPromotionBlocked)를
--    후보 테이블에 두지 않는다. 두는 순간 창업자가 Sheet 에서 뒤집을 수 있고
--    정책 8·10 이 사람 손 하나로 무너진다. publisher 코드 상수로 강제한다
--    (§6-7-B · §6-9-C). M0 의 Post 3필드는 그대로 둔다.
--
-- 🚫 Post.dedupKey 를 만들지 않는다. dedupKey 는 MicroSeedCandidate 에만 둔다.
--    Post 쪽 중복은 sheetCandidateId 의 UNIQUE 가 이미 막는다 (§5-2-3).

-- CreateEnum
-- §6-2 상태 기계. 8상태에서 늘리거나 줄이지 않는다.
-- 🔴 ReportStatus 에도 'PENDING' 이 있다. 타입이 다르므로 공존하지만
--    코드에서 헷갈리지 않도록 타입명에 접두를 붙였다.
CREATE TYPE "MicroSeedCandidateStatus" AS ENUM ('HOLD', 'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'SKIPPED', 'DECLINED', 'TAKEDOWN');

-- CreateTable
-- 후보 원장. Sheet 행 1개 = 이 테이블 1행.
CREATE TABLE "MicroSeedCandidate" (
    -- = Sheet 의 candidateId. 불변이며 행 번호를 대신한다 (§6-4).
    "id" TEXT NOT NULL,
    "status" "MicroSeedCandidateStatus" NOT NULL DEFAULT 'HOLD',
    "sourceSite" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceArticleId" TEXT NOT NULL,
    "sourceBoardName" TEXT,
    -- 정책 3 — 좋은 원문의 1순위 신호. 왜 뽑혔는지의 근거값이다.
    "sourceCommentCount" INTEGER NOT NULL DEFAULT 0,
    "sourceCapturedAt" TIMESTAMP(3) NOT NULL,
    -- 중복 방어 2차 — sha256(sourceSite::sourceArticleId) (§6-10)
    "dedupKey" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "founderTitle" TEXT,
    "targetBoardType" "BoardType",
    -- 창업자가 적는 희망 시각(입력). Post.publishAt(결과)과 분리한다 (§5-2-3).
    "scheduledPublishAt" TIMESTAMP(3),
    -- timeout 판정의 유일한 근거 (§6-3). Sheet 에 두지 않는다.
    "processingStartedAt" TIMESTAMP(3),
    "processingBy" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    -- 발행 결과. Post.sheetCandidateId 와 짝을 이루는 양방향 키 (§6-1).
    "createdPostId" TEXT,
    -- 사유 3개를 합치지 않는다. 성격도 추적 질문도 다르다.
    "holdReason" TEXT,
    "declineReason" TEXT,
    "failureReason" TEXT,
    "founderApprovedBy" TEXT,
    "founderApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicroSeedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 상태 전이 감사. §6-4 "되돌리기" 방어의 근거다.
-- 이게 없으면 창업자가 무엇을 언제 왜 바꿨는지 알 수 없다.
CREATE TABLE "MicroSeedCandidateHistory" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    -- 최초 적재는 from 이 없다
    "fromStatus" "MicroSeedCandidateStatus",
    "toStatus" "MicroSeedCandidateStatus" NOT NULL,
    -- 'founder' | 'worker:{id}' | 'validator'
    "by" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MicroSeedCandidateHistory_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Post 역조회 필드 (§5-2-3). 전부 nullable — 회원 글(대다수)에는 채워지지 않는다.
-- 🔴 sheetCandidateId · sourceUrl 두 인덱스가 takedown 성립 조건이다 (§6-6).
--    "원문 삭제 요청이 왔다 → 어느 글인가" 를 답하는 유일한 경로다.
ALTER TABLE "Post" ADD COLUMN     "sheetCandidateId" TEXT,
ADD COLUMN     "sourceSite" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "sourceArticleId" TEXT,
ADD COLUMN     "sourceCapturedAt" TIMESTAMP(3),
-- 예약 발행 시각이지 SEO 허용 신호가 아니다. 3축 판정에 넣지 마라.
ADD COLUMN     "publishAt" TIMESTAMP(3);

-- CreateIndex
-- 중복 방어 2차 — collector 가 같은 원문을 두 번 담아도 거부한다.
CREATE UNIQUE INDEX "MicroSeedCandidate_dedupKey_key" ON "MicroSeedCandidate"("dedupKey");

-- CreateIndex
-- 한 후보가 두 Post 를 만들 수 없다.
CREATE UNIQUE INDEX "MicroSeedCandidate_createdPostId_key" ON "MicroSeedCandidate"("createdPostId");

-- CreateIndex
-- PENDING 픽업 — 예약시각이 지난 승인 후보를 고른다.
CREATE INDEX "MicroSeedCandidate_status_scheduledPublishAt_idx" ON "MicroSeedCandidate"("status", "scheduledPublishAt");

-- CreateIndex
-- timeout 스캔 — PROCESSING 중 오래된 것을 찾는다 (§6-3).
CREATE INDEX "MicroSeedCandidate_status_processingStartedAt_idx" ON "MicroSeedCandidate"("status", "processingStartedAt");

-- CreateIndex
-- takedown 역조회 — 원문 URL 로 후보를 찾는다 (§6-6).
CREATE INDEX "MicroSeedCandidate_sourceUrl_idx" ON "MicroSeedCandidate"("sourceUrl");

-- CreateIndex
CREATE INDEX "MicroSeedCandidateHistory_candidateId_at_idx" ON "MicroSeedCandidateHistory"("candidateId", "at");

-- CreateIndex
-- 중복 방어 3차 — 같은 후보로 Post 두 개가 생길 수 없다 (§6-10).
-- takedown 역조회 키를 겸하므로 비용이 추가되지 않는다.
CREATE UNIQUE INDEX "Post_sheetCandidateId_key" ON "Post"("sheetCandidateId");

-- CreateIndex
-- takedown 역조회 (§6-6)
CREATE INDEX "Post_sourceUrl_idx" ON "Post"("sourceUrl");

-- AddForeignKey
-- 후보가 지워지면 그 이력도 함께 지운다. 이력만 남으면 참조 대상이 없다.
ALTER TABLE "MicroSeedCandidateHistory" ADD CONSTRAINT "MicroSeedCandidateHistory_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "MicroSeedCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
