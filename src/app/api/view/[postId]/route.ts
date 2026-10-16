import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  newAnonymousViewerToken,
  postExposureSecret,
  POST_EXPOSURE_VISITOR_COOKIE,
  POST_EXPOSURE_VISITOR_MAX_AGE,
  shouldRejectExposureRequest,
  validAnonymousViewerToken,
  viewerKeyHash,
} from '@/lib/post-exposure'
import { recordPostExposure } from '@/lib/post-exposure-store'

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
 *   탭 안 sessionStorage — 불필요한 요청을 줄이는 빠른 길
 *   서버 원장 unique      — 회원/익명 HMAC + 30분 창의 정본
 *
 * SEO
 *   robots.ts 가 이미 '/api/' 를 Disallow 한다 — robots 수정 0줄
 *   sitemap.ts 는 화이트리스트라 라우트를 만들어도 들어가지 않는다 — sitemap 수정 0줄
 *   아래에서 x-robots-tag: noindex 를 직접 붙인다
 */
export const dynamic = 'force-dynamic'

/** 세었든 걸렀든 클라이언트에게는 같은 응답을 준다. 화면이 이 결과를 읽지 않는다. */
function done() {
  const res = new NextResponse(null, { status: 204 })
  res.headers.set('x-robots-tag', 'noindex')
  res.headers.set('cache-control', 'no-store')
  return res
}

function withAnonymousCookie(
  response: NextResponse,
  request: Request,
  token: string | null,
  previous: string | undefined,
): NextResponse {
  if (token === null || token === previous) return response
  response.cookies.set({
    name: POST_EXPOSURE_VISITOR_COOKIE,
    value: token,
    maxAge: POST_EXPOSURE_VISITOR_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(request),
  })
  return response
}

/**
 * 사람이 실제로 연 것이 아닌 요청을 걸러낸다.
 *
 * 🔴 UA 문자열로 봇을 가리지 않는다. 우회가 쉽고 오탐이 많다.
 *    "브라우저가 화면을 그렸는가" 가 더 확실한 신호이고, 그 판정은
 *    이 라우트를 부르는 쪽(하이드레이션 이후 실행)이 이미 하고 있다.
 *    여기서는 명시적으로 자기를 밝히는 요청만 추가로 거른다.
 */
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
  if (shouldRejectExposureRequest(request)) return done()

  const postId = params.postId?.trim()
  if (!postId) return done()

  const secret = postExposureSecret(process.env)
  if (!secret) return done()

  let userId: string | null = null
  try {
    userId = (await auth())?.user?.id ?? null
  } catch {
    return done()
  }

  const jar = cookies()
  const currentToken = jar.get(POST_EXPOSURE_VISITOR_COOKIE)?.value
  const anonymousToken = userId === null
    ? validAnonymousViewerToken(currentToken) ? currentToken : newAnonymousViewerToken()
    : null
  const identity = userId === null ? `anonymous:${anonymousToken}` : `member:${userId}`
  const hash = viewerKeyHash(secret, identity)
  if (!checkRateLimit(`post-exposure:detail:${hash}`, 60, 60_000).ok) {
    return withAnonymousCookie(done(), request, anonymousToken, currentToken)
  }

  /**
   * 🔴 기록 실패가 읽기를 막으면 안 된다.
   *    조회수 하나 때문에 글이 안 보이는 쪽이 훨씬 큰 손해다.
   *
   * 없는 글 · 숨긴 글 · 지운 글은 updateMany 가 0건을 고치고 조용히 끝난다.
   * where 를 COMMUNITY_VISIBLE_WHERE 로 좁혀, 화면에 보이지 않는 글의 숫자가 오르지 않게 한다.
   */
  try {
    await recordPostExposure(prisma, {
      postId,
      kind: 'DETAIL_OPEN',
      surface: 'DETAIL',
      userId,
      anonymousToken,
      secret,
      now: new Date(),
    })
  } catch {
    // 삼킨다. 실패가 잦으면 계기판의 0 이 그걸 드러낸다.
  }

  const res = done()
  /**
   * 고친 행이 0 건이어도 창을 연다.
   * 없는 글에만 쿠키가 안 붙으면, 쿠키 유무가 글의 존재 여부를 알려 주는 신호가 된다.
   */
  return userId === null
    ? withAnonymousCookie(res, request, anonymousToken, currentToken)
    : res
}
