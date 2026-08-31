-- authorHashNorm — N2 정규화 후의 단방향 해시
--
-- Gate ⑥-B(displayName 충돌 검사)가 쓴다. 정본:
--   docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md §4-3 · §5-1
--
-- 이 migration 은 컬럼 두 개만 더한다. 기존 컬럼·인덱스·제약은 한 줄도 고치지 않는다.
-- 적용 직후 두 컬럼은 전부 NULL 이고, 사용자에게 보이는 것은 아무것도 바뀌지 않는다.
--
-- 🔴 nullable 로 만든다.
--    backfill 이 68,926 건을 채우는 데 시간이 걸리고, 부분 실패해도
--    NULL 로 남는 것이 정상 동작이어야 한다. NOT NULL 이면 backfill 전에 적용 자체가 실패한다.
--
-- 🔴 인덱스를 만들지 않는다.
--    Gate ⑥-B 는 이름 배정 시 1회만 도는 검사다. 쓰는 곳이 아직 없는 인덱스는
--    backfill 68,926 건의 UPDATE 를 느리게 만들기만 한다.
--    0012_scrap 이 scrapCount 를 만들지 않은 것과 같은 판단이다 —
--    쓸 곳이 생긴 날 그때 만든다.
--
-- 🔴 N3(숫자·영문 제거) 기준 컬럼은 만들지 않는다.
--    실측(설계 §6-4): N3 결과가 빈 문자열 10.4~10.5% ·
--    서로 다른 이름이 12~13% 뭉친다. 한글 없는 이름이 전부 같아져
--    근거 없는 충돌이 된다. N2 가 판정 경계다.
--
-- 🔴 원문 author 를 저장하는 컬럼은 추가하지 않는다.
--    authorHash 와 같은 salt · 같은 단방향 해시다.
--
-- 🔴 authorHash 를 대체하지 않는다. 둘 다 남는다 —
--    원본 일치와 정규화 일치는 다른 신호이고, 정규화 쪽만 남기면
--    "원문이 정확히 같다" 를 더 이상 말할 수 없게 된다.
--
-- 멱등하다. 두 번 실행해도 같은 상태가 된다.

ALTER TABLE "VoiceSource"
  ADD COLUMN IF NOT EXISTS "authorHashNorm" TEXT;

ALTER TABLE "VoiceCommentSignal"
  ADD COLUMN IF NOT EXISTS "authorHashNorm" TEXT;
