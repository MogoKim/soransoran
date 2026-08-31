-- Persona 코어 — 페르소나 정의와 그날의 mood
--
-- 정본: docs/operations/2026-08-31-persona-db-model-design.md §3 · §5 · §6
--
-- 이 migration 은 새 테이블 두 개와 enum 세 개만 만든다.
-- 기존 테이블은 한 줄도 고치지 않는다. 적용 직후 두 테이블은 비어 있고,
-- 고객에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 Persona 를 User 와 분리하고 @unique userId 로 잇는다.
--    User 에 필드를 얹으면 실회원 행에 전부 nullable 로 붙고 회원 조회마다 딸려 온다.
--    분리해 두면 고객 화면 코드(display-name.ts)가 Persona 를 모르는 상태로 남는다 —
--    그것이 "외부 비공개" 정책의 구현이다.
--
-- 🔴 User 에 isPersona 플래그를 두지 않는다.
--    Persona.userId 의 존재 여부가 유일한 답이다. 플래그를 따로 두면
--    두 값이 어긋나는 날이 온다.
--
-- 🔴 displayName 컬럼을 만들지 않는다.
--    정본은 User.nickname 이다. 둘 다 두면 한쪽만 바꾸는 날이 반드시 온다.
--    폐기한 이름만 retiredDisplayNames 에 남긴다 — 지우면 다음 작명에서 다시 나오고,
--    Gate ⑥-B 의 B3 대조가 이 배열까지 본다.
--
-- 🔴 mood 를 Persona 컬럼으로 두지 않는다.
--    컬럼이면 어제 mood 를 알 수 없다. 생성물이 이상할 때 그날 mood 를 되짚는 것이
--    첫 단서다. 날짜별 행으로 남긴다.
--
-- 🔴 사용량 카운터를 Persona 에 두지 않는다.
--    dailyCap · weeklyCap 은 상한만이다. 실제 사용량은 0016 의 PersonaActivityLog 에서
--    센다. 여기 카운터를 두면 발화마다 이 행을 잠근다
--    (0012_scrap 이 Post.scrapCount 를 만들지 않은 것과 같은 판단).
--
-- 🔴 onDelete 는 Persona → User 만 Restrict 다.
--    페르소나가 붙은 User 는 실수로 지워지면 안 된다.
--
-- 멱등하다. 두 번 실행해도 같은 상태가 된다.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PersonaStatus') THEN
        CREATE TYPE "PersonaStatus" AS ENUM ('draft', 'active', 'paused', 'retired');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PersonaAuditAction') THEN
        CREATE TYPE "PersonaAuditAction" AS ENUM (
            'created', 'approved', 'updated', 'status_changed', 'retired',
            'display_name_assigned', 'display_name_retired'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PersonaActivityKind') THEN
        CREATE TYPE "PersonaActivityKind" AS ENUM ('post', 'comment');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Persona" (
    "id"                     TEXT NOT NULL,
    "code"                   TEXT NOT NULL,
    "userId"                 TEXT NOT NULL,
    "status"                 "PersonaStatus" NOT NULL DEFAULT 'draft',
    "activatedAt"            TIMESTAMP(3),
    "pausedAt"               TIMESTAMP(3),
    "retiredAt"              TIMESTAMP(3),
    "retiredDisplayNames"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "identity"               JSONB,
    "ageBand"                TEXT,
    "region"                 TEXT,
    "lifeStage"              TEXT,
    "voiceCore"              JSONB,
    "voiceVariations"        JSONB,
    "activityRhythm"         JSONB,
    "noGoTopics"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "noGoExpressions"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "forbiddenReactionRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dailyCap"               INTEGER,
    "weeklyCap"              INTEGER,
    "silenceRate"            DECIMAL(4,3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Persona_code_key"   ON "Persona"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Persona_userId_key" ON "Persona"("userId");
CREATE INDEX        IF NOT EXISTS "Persona_status_idx" ON "Persona"("status");

CREATE TABLE IF NOT EXISTS "PersonaMoodState" (
    "id"        TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "date"      TEXT NOT NULL,
    "mood"      TEXT NOT NULL,
    "seed"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaMoodState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PersonaMoodState_personaId_date_key" ON "PersonaMoodState"("personaId", "date");
CREATE INDEX        IF NOT EXISTS "PersonaMoodState_date_idx"           ON "PersonaMoodState"("date");

-- 🔴 FK 는 있을 때만 건너뛴다.
--    CREATE TABLE/INDEX 는 IF NOT EXISTS 로 멱등한데 ADD CONSTRAINT 에는 그 문법이 없다.
--    그대로 두면 두 번째 실행이 duplicate 로 죽는다 — 재실행이 안전해야 손으로 다시 돌릴 수 있다.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Persona_userId_fkey') THEN
        ALTER TABLE "Persona"
            ADD CONSTRAINT "Persona_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaMoodState_personaId_fkey') THEN
        ALTER TABLE "PersonaMoodState"
            ADD CONSTRAINT "PersonaMoodState_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
