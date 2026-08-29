import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { COMMUNITY_VISIBLE_WHERE } from '@/lib/post-visibility'

/**
 * 글 조회 진단선
 *
 * 상세 화면이 실제로 열렸을 때만 클라이언트가 한 번 부른다.
 * 🔴 조회수는 North Star 가 아니다. 어떤 글이 읽히는지 보기 위한 진단선이다.
 *    승격 · 추천 · 인기 점수의 입력으로 쓰지 않는다 (정본 C-4).
 *
 * 🔴 상세 페이지를 쓰기 경로로 만들지 않으려고 라우트를 따로 둔다.
 *    서버 렌더 중에 세면 프리페치와 크롤러가 그대로 조회수가 되고,
 *    무엇보다 그 화면을 다시는 캐시할 수 없게 된다.
 *
 * 중복은 두 겹으로 막는다.
 *   탭 안  sessionStorage — 새로고침·뒤로가기 (PostViewBeacon)
 *   브라우저 쿠키 30분   — 새 탭·창을 다시 열어도 같은 창 안에서는 한 번 (여기)
 *   정확한 1인 1조회가 목표가 아니다. 짧은 시간의 반복을 줄이는 것이 목표다.
 *
 * SEO
 *   robots.ts 가 이미 '/api/' 를 Disallow 한다 — robots 수정 0줄
 *   sitemap.ts 는 화이트리스트라 라우트를 만들어도 들어가지 않는다 — sitemap 수정 0줄
 *   아래에서 x-robots-tag: noindex 를 직접 붙인다
 */
export const dynamic = 'force-dynamic'

/** 저장키 관례는 soran-font-size 와 맞춘다. 값에는 아무 정보도 담지 않는다. */
const viewedCookie = (postId: string) => `soran-viewed-${postId}`

/** 같은 브라우저가 이 안에 다시 열면 세지 않는다. */
const VIEW_WINDOW_SECONDS = 30 * 60

/** 세었든 걸렀든 클라이언트에게는 같은 응답을 준다. 화면이 이 결과를 읽지 않는다. */
function done() {
  const res = new NextResponse(null, { status: 204 })
  res.headers.set('x-robots-tag', 'noindex')
  return res
}

/**
 * 사람이 실제로 연 것이 아닌 요청을 걸러낸다.
 *
 * 🔴 UA 문자열로 봇을 가리지 않는다. 우회가 쉽고 오탐이 많다.
 *    "브라우저가 화면을 그렸는가" 가 더 확실한 신호이고, 그 판정은
 *    이 라우트를 부르는 쪽(하이드레이션 이후 실행)이 이미 하고 있다.
 *    여기서는 명시적으로 자기를 밝히는 요청만 추가로 거른다.
 */
function shouldSkip(request: Request): boolean {
  const h = request.headers
  // Next.js 가 링크를 미리 받아 둘 때 붙인다. 사람이 연 것이 아니다.
  if (h.get('next-router-prefetch')) return true
  // 브라우저 표준 프리페치 신호. Chrome 계열이 붙인다.
  if (h.get('purpose') === 'prefetch' || h.get('sec-purpose')?.includes('prefetch')) return true
  // 자사 도구가 스스로 밝히는 헤더. 계기판을 흐리지 않는다.
  if (h.get('x-bot-type')) return true
  return false
}

/**
 * https 로 들어온 요청에만 Secure 를 건다.
 *
 * NODE_ENV 로 판정하지 않는다 — 로컬에서 프로덕션 빌드를 돌릴 때도 production 이라,
 * http 인 그 환경에서 브라우저가 쿠키를 통째로 버린다.
 */
function isSecureRequest(request: Request): boolean {
  if (request.headers.get('x-forwarded-proto') === 'https') return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(request: Request, { params }: { params: { postId: string } }) {
  if (shouldSkip(request)) return done()

  const postId = params.postId?.trim()
  if (!postId) {
    const res = NextResponse.json({ error: 'postId required' }, { status: 400 })
    res.headers.set('x-robots-tag', 'noindex')
    return res
  }

  const name = viewedCookie(postId)
  // 창이 열려 있으면 DB 를 건드리지 않는다.
  if (cookies().get(name)) return done()

  /**
   * 🔴 기록 실패가 읽기를 막으면 안 된다.
   *    조회수 하나 때문에 글이 안 보이는 쪽이 훨씬 큰 손해다.
   *
   * 없는 글 · 숨긴 글 · 지운 글은 updateMany 가 0건을 고치고 조용히 끝난다.
   * where 를 COMMUNITY_VISIBLE_WHERE 로 좁혀, 화면에 보이지 않는 글의 숫자가 오르지 않게 한다.
   */
  try {
    await prisma.post.updateMany({
      where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },
      data: { viewCount: { increment: 1 } },
    })
  } catch {
    // 삼킨다. 실패가 잦으면 계기판의 0 이 그걸 드러낸다.
  }

  const res = done()
  /**
   * 고친 행이 0 건이어도 창을 연다.
   * 없는 글에만 쿠키가 안 붙으면, 쿠키 유무가 글의 존재 여부를 알려 주는 신호가 된다.
   */
  res.cookies.set({
    name,
    value: '1',
    maxAge: VIEW_WINDOW_SECONDS,
    // 이 라우트만 읽는 쿠키다. 경로를 좁혀 두면 홈·목록·이미지 요청 헤더에 실리지 않는다.
    path: `/api/view/${postId}`,
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(request),
  })
  return res
}
