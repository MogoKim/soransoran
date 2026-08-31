-- Persona 로그와 kill switch
--
-- 정본: docs/operations/2026-08-31-persona-db-model-design.md §7-2 · §10
--
-- 이 migration 은 새 테이블 세 개만 만든다. 기존 테이블은 한 줄도 고치지 않는다.
--
-- 🔴 AuditLog 와 ActivityLog 를 합치지 않는다.
--    AuditLog   = 페르소나 "정의" 의 변경 — 생성 · 승인 · 수정 · 상태전환 · 폐기. 드물다
--    ActivityLog = 페르소나의 "발화" — 후보 생성 · Gate 결과 · 승인 · 발행. 잦다
--    주기가 100배 다르다. 합치면 "이 페르소나 정의가 언제 바뀌었나" 를
--    발화 수십만 건 속에서 찾아야 한다.
--
-- 🔴 ActivityLog 에 생성물 원문을 담지 않는다.
--    발행된 것은 Post·Comment 에 있고, 폐기된 것은 남길 이유가 없다.
--    요약과 Gate 결과 코드만 남긴다.
--
-- 🔴 ActivityLog.targetId 에 FK 를 걸지 않는다.
--    폐기된 후보는 대상이 없고, kind 에 따라 가리키는 테이블이 다르다.
--
-- 🔴 aiToneTags 는 TEXT[] 다. enum 이 아니다.
--    8종이 관찰로 늘어나는데 그때마다 migration 을 요구할 이유가 없다
--    (VoiceSource.origin 이 string 인 것과 같은 판단).
--    반대로 status · action · kind 는 enum 이다 — 값이 늘면 코드 분기도 바뀐다.
--
-- 🔴 kill switch 는 단일 행 테이블이다.
--    페르소나 20개의 status 를 하나씩 바꾸는 것은 사고 상황에서 쓸 수 없다.
--    전략 §10-2 가 못박았다 — kill switch 가 없으면 자동화 2단계를 열 수 없다.
--    기본값은 false 다. 만들자마자 켜지지 않는다.
--
-- 멱등하다.

CREATE TABLE IF NOT EXISTS "PersonaAuditLog" (
    "id"            TEXT NOT NULL,
    "personaId"     TEXT NOT NULL,
    "action"        "PersonaAuditAction" NOT NULL,
    "fromStatus"    "PersonaStatus",
    "toStatus"      "PersonaStatus",
    "actorUserId"   TEXT,
    "reason"        TEXT,
    "changedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonaAuditLog_personaId_createdAt_idx" ON "PersonaAuditLog"("personaId", "createdAt");
CREATE INDEX IF NOT EXISTS "PersonaAuditLog_action_createdAt_idx"    ON "PersonaAuditLog"("action", "createdAt");

CREATE TABLE IF NOT EXISTS "PersonaActivityLog" (
    "id"          TEXT NOT NULL,
    "personaId"   TEXT NOT NULL,
    "kind"        "PersonaActivityKind" NOT NULL,
    "targetId"    TEXT,
    "gateStatus"  TEXT,
    "gateHits"    JSONB,
    "aiToneTags"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "decidedBy"   TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonaActivityLog_personaId_createdAt_idx" ON "PersonaActivityLog"("personaId", "createdAt");
CREATE INDEX IF NOT EXISTS "PersonaActivityLog_createdAt_idx"           ON "PersonaActivityLog"("createdAt");
CREATE INDEX IF NOT EXISTS "PersonaActivityLog_kind_createdAt_idx"      ON "PersonaActivityLog"("kind", "createdAt");

CREATE TABLE IF NOT EXISTS "PersonaGlobalSwitch" (
    "id"        TEXT NOT NULL DEFAULT 'global',
    "enabled"   BOOLEAN NOT NULL DEFAULT false,
    "reason"    TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaGlobalSwitch_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaAuditLog_personaId_fkey') THEN
        ALTER TABLE "PersonaAuditLog"
            ADD CONSTRAINT "PersonaAuditLog_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaActivityLog_personaId_fkey') THEN
        ALTER TABLE "PersonaActivityLog"
            ADD CONSTRAINT "PersonaActivityLog_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
