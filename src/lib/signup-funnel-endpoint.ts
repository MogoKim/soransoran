import 'server-only'

import { parseAnonymousFunnelPayload, type SignupFunnelKey } from '@/lib/signup-funnel'
import { signupFunnelGate, type SignupFunnelEnv } from '@/lib/signup-funnel-gate'

/**
 * 익명 회원가입 전환 기록 — `POST /api/signup-funnel` 의 판정 전부.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-3 · §8-7 · §8-10 · §8-11.
 *
 * 🔴 판정 순서가 계약이다. 앞 단계에서 걸리면 뒤 단계는 **실행하지 않는다.**
 *      1 gate → 2 prefetch → 3 same-origin → 4 body 크기 → 5 JSON → 6 strict payload → 7 로그인 → 8 저장
 *    gate 가 닫혀 있으면 인증 · body 읽기 · DB 가 전부 0 이다(Preview·개발·수집 전).
 *
 * 🔴 무엇이 걸리든 응답은 같은 204 다. 계측이 읽기·인증·가입 흐름을 바꾸지 않는다(§8-11).
 *    저장 실패도 삼킨다 — 이 자리는 사용자 흐름 쪽이라 실패를 올리지 않는다(저장 모듈은 올린다).
 * 🔴 payload · 사용자 정보 · 헤더 값을 로그로 남기지 않는다.
 *
 * 🔴 인증·DB·시계·env 는 deps 로 받는다. Production 연결은 route.ts 한 곳에서만 한다 —
 *    시험이 "gate 가 닫히면 이 함수들이 한 번도 불리지 않는다" 를 대역으로 증명할 수 있어야 한다.
 */

export const SIGNUP_FUNNEL_BODY_LIMIT_BYTES = 256

export type SignupFunnelEndpointDeps = {
  env: SignupFunnelEnv
  now: () => Date
  /** 지금 요청에 로그인 세션이 있는가 — 있으면 익명 집계가 아니다 */
  isLoggedIn: () => Promise<boolean>
  increment: (key: SignupFunnelKey, now: Date) => Promise<void>
}

function done(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
  })
}

/**
 * 사람이 화면에서 보낸 것이 아닌 요청.
 * 🔴 prefetch 신호와, 자사 도구가 스스로 밝히는 헤더만 본다(정본 §4). UA 문자열로 봇을 가리지 않는다.
 */
function isAutomated(headers: Headers): boolean {
  if (headers.get('next-router-prefetch') !== null) return true
  if (headers.get('purpose') === 'prefetch') return true
  if (headers.get('sec-purpose')?.includes('prefetch')) return true
  if (headers.get('x-bot-type') !== null) return true
  return false
}

/**
 * 같은 출처에서 보낸 요청인가.
 *
 * 🔴 `Origin` 이 **반드시** 있어야 하고 요청 URL 의 origin 과 정확히 같아야 한다.
 *    `Sec-Fetch-Site` 는 보조다 — 있으면 `same-origin` 만 받는다. 하나만으로 판정하지 않는다(정본 §8-3).
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false

  let expected: string
  try {
    expected = new URL(request.url).origin
  } catch {
    return false
  }
  if (origin !== expected) return false

  const site = request.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin'
}

/**
 * body 를 상한까지만 읽는다. 넘으면 그 자리에서 읽기를 끊고 null.
 * 🔴 Content-Length 를 믿지 않는다 — 있으면 먼저 걸러 읽기 전에 끊고, 없거나 거짓이어도 실제 바이트를 센다.
 */
async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isInteger(length) || length < 0 || length > limit) return null
  }
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** 깨진 UTF-8 · 깨진 JSON 은 undefined — strict parser 가 거부한다 */
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return undefined
  }
}

export async function handleSignupFunnelRequest(
  request: Request,
  deps: SignupFunnelEndpointDeps,
): Promise<Response> {
  const now = deps.now()
  const gate = signupFunnelGate(deps.env, now)
  if (!gate.active) return done()

  if (isAutomated(request.headers)) return done()
  if (!isSameOrigin(request)) return done()

  const bytes = await readLimitedBody(request, SIGNUP_FUNNEL_BODY_LIMIT_BYTES)
  if (!bytes) return done()

  const payload = parseAnonymousFunnelPayload(parseJson(bytes))
  if (!payload) return done()

  // 🔴 인증 판정이 실패하면 익명이라고 단정하지 않는다 — 세지 않는다.
  try {
    if (await deps.isLoggedIn()) return done()
  } catch {
    return done()
  }

  try {
    await deps.increment({ ...payload, day: gate.today }, now)
  } catch {
    // 삼킨다. 계측 실패가 화면에 닿지 않게 하는 자리가 여기다.
  }
  return done()
}
