-- 자동 READY 사후 감사 (AutoReadyAudit)
--
-- 🔴 **아직 운영에 적용하지 않았다.** 파일만 만들고 격리 DB 에서만 돌렸다.
--    `SORAN_AUTO_READY_ENABLED` 가 꺼져 있는 동안(기본) 이 표를 읽는 경로는 돌지 않는다.
--
-- 🔴 기존 표를 하나도 건드리지 않는다. 새 표 하나뿐이다.
--
-- 🔴 queueId 기본키 — 같은 글을 두 번 감사 대상으로 고르지 않는다.
-- 🔴 defect 는 NULL(판정 전) · 'yes' · 'no'. 'yes' 는 'no' 로 덮이지 않는다(app 조건부 쓰기).
--    값 모양은 아래 CHECK 가 DB 에서도 막는다.

CREATE TABLE "AutoReadyAudit" (
    "queueId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "selectedAtN" INTEGER NOT NULL,
    "selectedTarget" INTEGER NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 🔴 무엇을 감사하는가 — 고를 때 묶는다. 결과는 이 글에만 붙는다
    "publishedTitleHash" TEXT NOT NULL,
    "publishedBodyHash" TEXT NOT NULL,
    "stampContractDigest" TEXT NOT NULL,
    "defect" TEXT,
    "judgedAt" TIMESTAMP(3),
    "auditor" TEXT,
    "note" TEXT,
    -- 🔴 어느 판으로 판정했는가 — 옛 계약·모델·프롬프트의 결과가 붙지 않게 한다
    "auditContractVersion" TEXT,
    "auditModel" TEXT,
    "auditPromptVersion" TEXT,

    CONSTRAINT "AutoReadyAudit_pkey" PRIMARY KEY ("queueId"),
    CONSTRAINT "AutoReadyAudit_judged_has_provenance" CHECK (
      "defect" IS NULL OR (
        "judgedAt" IS NOT NULL AND "auditor" IS NOT NULL AND "auditContractVersion" IS NOT NULL
        AND "auditModel" IS NOT NULL AND "auditPromptVersion" IS NOT NULL
      )
    ),
    CONSTRAINT "AutoReadyAudit_hashes_present" CHECK (
      length("publishedTitleHash") = 64 AND length("publishedBodyHash") = 64 AND length("stampContractDigest") > 0
    ),
    CONSTRAINT "AutoReadyAudit_defect_check" CHECK ("defect" IS NULL OR "defect" IN ('yes', 'no')),
    CONSTRAINT "AutoReadyAudit_auditor_not_founder" CHECK ("auditor" IS NULL OR "auditor" <> 'founder'),
    CONSTRAINT "AutoReadyAudit_selection_check" CHECK ("selectedAtN" > 0 AND "selectedTarget" > 0)
);

CREATE UNIQUE INDEX "AutoReadyAudit_postId_key" ON "AutoReadyAudit"("postId");
CREATE INDEX "AutoReadyAudit_defect_idx" ON "AutoReadyAudit"("defect");
