-- 하루 단계 결정 저장 (StageDecision)
--
-- 🔴 **아직 운영에 적용하지 않았다.** 이 회차는 파일만 만들고 격리 DB 에서만 돌렸다.
--    적용 순서와 되돌리는 법은 같은 폴더의 `APPLY.md` 에 있다.
--
-- 무엇을 만드는가
--   StageDecision — KST 날짜당 **하나**의 단계 결정. 공급과 발행이 같은 행을 읽는다.
--
-- 🔴 **유일키가 `kstDate` 하나다.** `(kstDate, contractVersion)` 로 두면 같은 날 계약 판을
--    올릴 때 두 번째 행이 생기고, 아침에 옛 판으로 낸 글과 낮에 새 판으로 낸 글이
--    서로 다른 상한 아래 놓인다. 하루 결정이 둘이 되는 것을 DB 수준에서 막는다.
--
-- 🔴 **불변은 이 SQL 이 지켜 주지 않는다.** `UPDATE`·`DELETE` 는 그대로 돈다.
--    `src/lib/stage-decision-repo.ts` 가 create/read 만 내주는 app-level 계약으로 지킨다.
--
-- 🔴 **기존 표를 하나도 건드리지 않는다.** 새 표 하나뿐이라 되돌리기는 `DROP TABLE` 이다.

CREATE TABLE "StageDecision" (
    -- KST 기준 YYYY-MM-DD. 하루에 하나
    "kstDate" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    -- d1|d3|d5|d10 — 값 검증은 app validator 가 한다(enum 을 DB 에 박으면 판을 못 올린다)
    "capacity" TEXT NOT NULL,
    "release" TEXT NOT NULL,
    -- SUSTAIN|TRIAL|PREPARE|HOLD
    "state" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "blocks" JSONB NOT NULL,
    "dayPinned" BOOLEAN NOT NULL,
    -- 🔴 nullable JSON — adapter 는 언제나 JSON `null` 로 쓴다(SQL NULL 이 아니다)
    "supply" JSONB,
    "transition" JSONB,
    -- 🔴 언제나 'controller'
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageDecision_pkey" PRIMARY KEY ("kstDate")
);

CREATE INDEX "StageDecision_createdAt_idx" ON "StageDecision"("createdAt");
