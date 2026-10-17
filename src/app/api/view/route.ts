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
  validListExposurePayload,
  viewerKeyHash,
} from '@/lib/post-exposure'
import { recordPostExposureBatch } from '@/lib/post-exposure-store'

export const dynamic = 'force-dynamic'

function done() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
  })
}

function isSecureRequest(request: Request): boolean {
  if (request.headers.get('x-forwarded-proto') === 'https') return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
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

export async function POST(request: Request) {
  if (shouldRejectExposureRequest(request)) return done()
  const length = Number(request.headers.get('content-length') ?? '0')
  if (!Number.isFinite(length) || length > 4_096) return done()

  let payload: ReturnType<typeof validListExposurePayload>
  try {
    payload = validListExposurePayload(await request.json())
  } catch {
    return done()
  }
  if (!payload) return done()

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
  if (!checkRateLimit(`post-exposure:list:${hash}`, 30, 60_000).ok) {
    return withAnonymousCookie(done(), request, anonymousToken, currentToken)
  }

  try {
    await recordPostExposureBatch(prisma, {
      postIds: payload.postIds,
      kind: 'LIST_EXPOSURE',
      surface: payload.surface,
      userId,
      anonymousToken,
      secret,
      now: new Date(),
    })
  } catch {
    // 계측 실패는 목록 탐색을 막지 않는다.
  }
  return userId === null
    ? withAnonymousCookie(done(), request, anonymousToken, currentToken)
    : done()
}
