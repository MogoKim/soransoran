-- 0031 — 회원가입 전환 일별 집계 (SignupFunnelDaily)
--
-- 🔴 0031 의 적용 순서·확인·복구는 같은 폴더의 APPLY.md 를 단일 실행 절차로 따른다.
--    APPLY.md 는 제품 정책·D100 운영 정책·회원가입 전환 정책을 새로 정하지 않는다.
-- 🔴 회원가입 전환 영역 정책 기준은 docs/operations/MEMBER-CONVERSION-CANON.md §8 (MC-M3 최소 측정 계약)이다.
-- 🔴 이 파일은 적용 뒤 수정하지 않는다.
--
-- 무엇을 만드는가
--   SignupFunnelDaily — 회원가입 전환 **전용** 익명 일별 발생 횟수. 사람 단위 퍼널이 아니다.
--   범용 이벤트 저장소로 쓰지 않는다.
--
-- 🔴 개인정보·회원 식별·콘텐츠 식별 열이 **없다.** IP · User-Agent · 회원 ID · 카카오 ID · 이메일 ·
--    콘텐츠 ID·slug · URL 을 담을 자리 자체를 만들지 않는다.
-- 🔴 step · contentType · entryPoint 는 enum 이 아니라 TEXT 다. 허용값은 앱 코드 한 곳이 검증한다 —
--    DB 에 enum 을 박으면 새 출입구를 추가할 때마다 migration 이 필요해진다.
-- 🔴 증가는 앱의 원자적 upsert(+1)가 한다. 이 SQL 은 seed·backfill 을 하지 않는다.
-- 🔴 기존 표를 하나도 건드리지 않는다. FK · 별도 인덱스가 없다 — 조회는 복합 PK 앞부분(day)으로 충분하다.

-- CreateTable
CREATE TABLE "SignupFunnelDaily" (
    -- KST 'YYYY-MM-DD' — 서버가 정한다
    "day" TEXT NOT NULL,
    -- logged_out_view | prompt_reach | prompt_impression | auth_start | signup_complete
    "step" TEXT NOT NULL,
    -- community | magazine
    "contentType" TEXT NOT NULL,
    -- 현재 content_end
    "entryPoint" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupFunnelDaily_pkey" PRIMARY KEY ("day","step","contentType","entryPoint")
);
