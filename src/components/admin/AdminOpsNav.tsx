/**
 * 운영 메뉴 정의 — 「개요 · 운영」 묶음의 상위 항목 7개와 현재 위치 판정.
 *
 * 🔴 그리는 일은 AdminNav 가 한다(데스크탑 사이드바 · 모바일 전체 화면 메뉴).
 *    이 파일은 목록과 판정만 갖는다 — 메뉴가 바뀌면 여기 한 곳만 고친다.
 *
 * 🔴 상위 항목은 7개다. 늘리지 않는다 — 회원 · 게시글 · 신고 · 홈 노출 · 배너를 손으로 처리하고
 *    창업자가 직접 쓰는 것이 운영 묶음의 전부다.
 *    회원의 하위 화면(고객 구성 · 가입 전환)은 상위 항목이 아니다 — MemberAdminTabs 의 탭 목록을
 *    하위 메뉴로 그대로 쓴다(회원가입 전환 정본 §10 · 새 상위 메뉴 0).
 *    자동 운영(페르소나 · 후보 · 자동 READY)은 이 7개와 다른 묶음이다 — AdminNav 의 AUTO_NAV.
 *
 *    🔴 6개에서 7개로 늘렸다 (2026-09-17). 직접 작성은 신고·게시글 조치와 다른 일이다 —
 *       저쪽은 남이 쓴 것을 가리고 고치는 일이고, 이쪽은 내가 쓰는 일이다.
 *    🔴 5개에서 6개로 늘렸다 (2026-09-14 · 창업자 승인). 배너는 홈 노출과 다른 일이다 —
 *       홈 노출은 이미 있는 글을 올리고 내리는 것이고, 배너는 운영자가 만든 이미지를 새로 올리는 것이다.
 */
export type OpsNavItem = { href: string; label: string; hint: string }

export const OPS_NAV: readonly OpsNavItem[] = [
  { href: '/admin', label: '운영 홈', hint: '오늘 확인할 것' },
  { href: '/admin/reports', label: '신고', hint: '판단하고 조치' },
  { href: '/admin/content', label: '게시글', hint: '수정하고 숨기기' },
  { href: '/admin/members', label: '회원', hint: '차단 · 고객 구성 · 가입 전환' },
  { href: '/admin/home', label: '홈 노출', hint: '고정 · 숨김' },
  { href: '/admin/banners', label: '배너 관리', hint: '히어로 배너' },
  { href: '/admin/compose', label: '직접 작성', hint: '운영자가 쓰기' },
]

/** 이 경로가 그 메뉴 아래인가 — '/admin' 은 정확히 일치할 때만(하위 전부에서 켜지면 표시가 의미를 잃는다) */
export function isCurrent(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}
