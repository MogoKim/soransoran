-- 0024_persona_comment_provenance
--
-- 🔴 **후보의 생성 근거를 전용 컬럼으로 옮긴다.**
--
--    앞선 판은 `storyRefs` · `topicTags` 문자열 배열에 `provenance:…` · `model:…` 표식을
--    끼워 넣었다. 그 배열은 다른 뜻으로 쓰이는 자리이고, 표식은 누구나 흉내 낼 수 있으며
--    타입도 없다 — "어느 모델이 만들었는가" 를 나중에 확실히 물을 수 없다.
--
-- 🔴 **additive 만 한다.** 컬럼 3개를 nullable 로 더할 뿐,
--    기존 컬럼을 지우거나 바꾸지 않는다. 기존 행은 전부 NULL 로 남는다.
--    NULL 인 행은 자동 공개 대상이 아니다(코드가 fail-closed 로 막는다).
--
-- 🔴 prisma migrate · db push 를 쓰지 않는다 (/prisma-guide).
--    pg 모듈로 직접 실행하고 information_schema 로 검증한다.

ALTER TABLE "PersonaApprovalQueue"
  ADD COLUMN IF NOT EXISTS "generatedModel" TEXT,
  ADD COLUMN IF NOT EXISTS "canonRunId"     TEXT,
  ADD COLUMN IF NOT EXISTS "canonDigest"    TEXT;

-- 🔴 어느 회차의 후보인지 묶어 보기 위한 인덱스. UNIQUE 가 아니다 —
--    한 회차에서 여러 후보가 나온다.
CREATE INDEX IF NOT EXISTS "PersonaApprovalQueue_canonRunId_idx"
  ON "PersonaApprovalQueue" ("canonRunId");
