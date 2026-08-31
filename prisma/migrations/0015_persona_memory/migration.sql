-- Persona Memory 4종 — Self · Relationship · Community · Negative
--
-- 정본: docs/operations/2026-08-31-persona-db-model-design.md §6-4 · §8
--
-- 이 migration 은 새 테이블 네 개만 만든다. 기존 테이블은 한 줄도 고치지 않는다.
--
-- 🔴 네 종류를 한 테이블에 두지 않는다.
--    Relationship 만 회원(User)을 가리킨다. 그것만 회원 탈퇴 시 즉시 삭제해야 한다.
--    합치면 지울 대상을 kind 필터로 골라야 하고, 그 필터가 틀리면 지워야 할 것이 남는다.
--    테이블이 다르면 지우는 경로도 다르다 — 그게 이 분리의 이유다.
--
-- 🔴 PersonaUserRelationship 에 @@index([userId]) 를 단독으로 만든다.
--    복합 인덱스(personaId, userId)만 두면 userId 로만 지울 때 전체 스캔이 된다.
--    "익명화가 아니라 삭제" 를 실행 가능하게 만드는 것이 이 한 줄이다.
--
-- 🔴 다만 User 행 자체의 삭제는 여전히 막혀 있다.
--    Post.authorId 가 Restrict 라 글이 있는 회원은 삭제가 실패한다
--    (schema.prisma Post 모델 주석: "탈퇴/익명화 정책은 private preview 범위 밖").
--    이 migration 이 여는 것은 "관계 기억을 지우는 경로" 이지 "회원을 지우는 경로" 가 아니다.
--
-- 🔴 Self · Community · Negative 는 보존한다.
--    은퇴 후에도 이력으로 남는다. Negative 를 지우면 같은 실수를 반복한다.
--
-- 🔴 어느 테이블에도 생성물 원문을 담지 않는다. 요약과 코드만이다.
--
-- 멱등하다.

CREATE TABLE IF NOT EXISTS "PersonaSelfMemory" (
    "id"               TEXT NOT NULL,
    "personaId"        TEXT NOT NULL,
    "summary"          TEXT NOT NULL,
    "sourceActivityId" TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaSelfMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonaSelfMemory_personaId_createdAt_idx"
    ON "PersonaSelfMemory"("personaId", "createdAt");

CREATE TABLE IF NOT EXISTS "PersonaUserRelationship" (
    "id"               TEXT NOT NULL,
    "personaId"        TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "knownFacts"       JSONB,
    "lastInteractedAt" TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaUserRelationship_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersonaUserRelationship_personaId_userId_key"
    ON "PersonaUserRelationship"("personaId", "userId");
-- 🔴 이 한 줄이 탈퇴 시 즉시 삭제를 가능하게 한다
CREATE INDEX IF NOT EXISTS "PersonaUserRelationship_userId_idx"
    ON "PersonaUserRelationship"("userId");
CREATE INDEX IF NOT EXISTS "PersonaUserRelationship_personaId_lastInteractedAt_idx"
    ON "PersonaUserRelationship"("personaId", "lastInteractedAt");

CREATE TABLE IF NOT EXISTS "PersonaCommunityMemory" (
    "id"        TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "topic"     TEXT NOT NULL,
    "summary"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaCommunityMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonaCommunityMemory_personaId_topic_idx"
    ON "PersonaCommunityMemory"("personaId", "topic");

CREATE TABLE IF NOT EXISTS "PersonaNegativeMemory" (
    "id"         TEXT NOT NULL,
    "personaId"  TEXT NOT NULL,
    "avoidance"  TEXT NOT NULL,
    "reasonCode" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaNegativeMemory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonaNegativeMemory_personaId_createdAt_idx"
    ON "PersonaNegativeMemory"("personaId", "createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaSelfMemory_personaId_fkey') THEN
        ALTER TABLE "PersonaSelfMemory"
            ADD CONSTRAINT "PersonaSelfMemory_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaUserRelationship_personaId_fkey') THEN
        ALTER TABLE "PersonaUserRelationship"
            ADD CONSTRAINT "PersonaUserRelationship_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    -- 🔴 User 쪽은 Cascade 다. 회원이 지워지면 관계 기억도 함께 사라져야 한다
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaUserRelationship_userId_fkey') THEN
        ALTER TABLE "PersonaUserRelationship"
            ADD CONSTRAINT "PersonaUserRelationship_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaCommunityMemory_personaId_fkey') THEN
        ALTER TABLE "PersonaCommunityMemory"
            ADD CONSTRAINT "PersonaCommunityMemory_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonaNegativeMemory_personaId_fkey') THEN
        ALTER TABLE "PersonaNegativeMemory"
            ADD CONSTRAINT "PersonaNegativeMemory_personaId_fkey"
            FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
