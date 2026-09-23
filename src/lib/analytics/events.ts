/**
 * GA4 참여 계측 — 보낼 수 있는 것의 전부를 이 파일 하나에 적는다.
 *
 * 🔴 값 타입까지 좁힌다. 주석으로 "개인정보를 보내지 말자" 고 적는 대신
 *    board_slug 는 레지스트리 상수, method·member_type 은 리터럴, 나머지는 boolean 으로 둔다.
 *    제목·본문·댓글·닉네임·이메일·userId·postId·commentId·callbackUrl 이
 *    **타입에 자리가 없어** 컴파일러가 막는다. 사람의 기억에 맡기지 않는다.
 *
 * 🔴 이벤트 이름에 값을 넣지 않는다. `like_add` 가 아니라 `reaction` + `action:'add'` 다.
 *    개수 때문이 아니다 — 웹 스트림에는 서로 다른 이벤트 **이름 개수 제한이 없다**.
 *    이름에 값을 섞으면 한 가지 행동의 지표가 이름마다 흩어진다. "공감이 몇 번 일어났나" 를
 *    보려면 매번 여러 이벤트를 더해야 하고, 이름이 늘어난 만큼 보고서·측정기준·전환 설정을
 *    따로 관리하게 된다. 행동 하나는 이름 하나로 두고, 갈래는 파라미터로 나눈다.
 *
 * 🔴 여기 없는 이벤트는 보낼 수 없다. trackEvent 가 이 map 의 키만 받는다.
 */
import type { CommunityBoardSlug } from '@/lib/board-registry'
import type { MagazineRecommendationSlot } from '@/content/magazine/graph/types'
import type { MagazineRelationSurface, MagazineRelationType } from '@/lib/magazine-graph'

/**
 * 1차 이벤트 6종 + 매거진 연관 글 이동 1종.
 *
 * 깔때기: 진입(page_view) → 글쓰기 관문(write_login_prompt) → 인증 시작(write_auth_start)
 *        → 가입 완료(sign_up) → 글 복원(write_draft_restored) → 기여(post_publish · comment_publish)
 *
 * 매거진 연관 글(magazine_related_click)은 그 깔때기의 **앞단**이다 —
 * 검색으로 들어온 독자가 두 번째 글로 넘어갔는지를 본다. 넘어가지 않으면 글쓰기 관문까지 오지 않는다.
 */
/**
 * 노출과 클릭이 **같은 모양**을 쓴다.
 *
 * 🔴 두 이벤트의 필드가 갈라지면 "본 것"과 "누른 것"을 맞붙일 수 없다.
 *    같은 타입을 쓰면 컴파일러가 그 정합을 지켜 준다.
 *
 * 🔴 `slug` · `target_slug` 는 자유 문자열이 아니라 **매거진 글의 URL 경로**다.
 *    articles.ts 에 커밋된 닫힌 집합에서만 나오고, 이미 주소창에 노출돼 있으며,
 *    사용자 입력이 들어오는 경로가 없다. 제목·본문·닉네임·이메일·userId 는
 *    **타입에 자리가 없어** 컴파일러가 막는다.
 *
 * 🔴 `recommendation_slot` 은 보충 항목에서 `'none'` 이다 — 보충을 특정 슬롯인
 *    것처럼 세면 그 슬롯의 성과가 부풀고, 그 숫자로 슬롯 구성을 바꾸게 된다.
 */
export type MagazineRelatedParams = {
  slug: string
  target_slug: string
  relation_type: MagazineRelationType
  surface: MagazineRelationSurface
  /** 그래프가 고른 줄만 실제 슬롯. 보충은 'none' */
  recommendation_slot: MagazineRecommendationSlot | 'none'
  recommendation_source: 'GRAPH' | 'FALLBACK_FILL' | 'FALLBACK'
  /** 화면 순서. 0부터 */
  position: number
  /** 그래프가 고른 줄만 실제 버전. 보충은 'none' */
  graph_version: string
}

/** 이 방문에서 몇 번째 연속 열람인가. 4 이상은 한 칸으로 묶는다 */
export type MagazineReadDepth = '1' | '2' | '3' | '4+'

export type SoranEventMap = {
  /** 유효한 글을 쓴 비회원에게 로그인 안내가 실제로 열렸다 */
  write_login_prompt: { board_slug: CommunityBoardSlug; draft_saved: boolean }
  /** 그 안내에서 카카오로 계속하기를 실제로 눌렀다 */
  write_auth_start: { board_slug: CommunityBoardSlug; method: 'kakao' }
  /** 온보딩이 끝나 회원이 됐다. 계정 생애 1회 */
  sign_up: { method: 'kakao' }
  /** 인증 왕복을 마치고 돌아와 쓰던 글이 실제로 복원됐다 */
  write_draft_restored: { board_slug: CommunityBoardSlug; logged_in: boolean }
  /** 글이 DB 에 저장됐다 */
  post_publish: { board_slug: CommunityBoardSlug }
  /** 댓글이 DB 에 저장됐다 */
  comment_publish: { member_type: 'member' | 'guest'; is_reply: boolean }
  /**
   * 매거진 하단 「함께 읽어보세요」가 **화면에 실제로 보였다.**
   *
   * 🔴 이것이 클릭률의 **분모**다. 클릭만 세면 "몇 명이 눌렀나"는 알아도
   *    "본 사람 중 몇 %가 눌렀나"는 영영 모른다. 그 값이 없으면 슬롯을
   *    바꿔 보든 개수를 늘려 보든 나아졌는지 판단할 근거가 없다.
   *
   * 🔴 **한 세션에 항목당 1회만** 보낸다. 스크롤을 오르내릴 때마다 세면
   *    분모가 부풀어 클릭률이 실제보다 낮게 나온다.
   */
  magazine_related_impression: MagazineRelatedParams
  /**
   * 매거진 하단 「함께 읽어보세요」의 링크를 실제로 눌렀다.
   *
   * 🔴 `depth` 는 **이 방문에서 몇 번째로 이어 읽는가**다. 거미줄이 실제로
   *    독자를 붙잡는지는 한 번의 클릭이 아니라 **연속 열람**이 말한다.
   */
  magazine_related_click: MagazineRelatedParams & { depth: MagazineReadDepth }
}

export type SoranEventName = keyof SoranEventMap

/** 어떤 이벤트의 파라미터든 받는 자리에 쓴다 (trackEvent 내부 전용) */
export type SoranEventParams = SoranEventMap[SoranEventName]
