import { headers } from 'next/headers'

/**
 * 최소 rate limit
 *
 * 현재는 인메모리 고정 윈도우다. Vercel 서버리스는 인스턴스가 분산되므로
 * 실제 허용량은 설정값보다 느슨해질 수 있다.
 * public launch 전에 Upstash Redis 로 교체하는 것을 전제로 한 최소 방어선이다.
 *
 * 식별자 우선순위
 *   1) 로그인 사용자 id  — 가장 정확하다
 *   2) IP (x-forwarded-for)  — 비로그인 경로 fallback
 */
type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** 메모리 누수 방지 — 호출 때마다 만료 항목을 조금씩 정리한다 */
function sweep(now: number): void {
  if (buckets.size < 500) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export type RateLimitResult = {
  ok: boolean
  /** 다음 시도까지 남은 초 */
  retryAfterSec: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSec: 0 }
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) }
  }

  bucket.count += 1
  return { ok: true, retryAfterSec: 0 }
}

/** 요청 IP — 프록시 헤더 기준. 없으면 unknown */
export function getClientIp(): string {
  const h = headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return h.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * 액션용 헬퍼 — 사용자 id 기준으로 검사하고 IP 로도 한 번 더 본다.
 * 같은 사람이 여러 계정을 만들어도 IP 쪽에서 걸린다.
 */
export function checkActionRateLimit(
  action: string,
  userId: string,
  limit: number,
  windowMs: number,
  ipLimit = limit * 3,
): RateLimitResult {
  const byUser = checkRateLimit(`${action}:u:${userId}`, limit, windowMs)
  if (!byUser.ok) return byUser

  const ip = getClientIp()
  if (ip === 'unknown') return byUser
  return checkRateLimit(`${action}:ip:${ip}`, ipLimit, windowMs)
}

/** 사람이 읽는 대기 안내 */
export function retryMessage(retryAfterSec: number): string {
  if (retryAfterSec >= 60) {
    return `잠시 후 다시 시도해 주세요. (약 ${Math.ceil(retryAfterSec / 60)}분 뒤)`
  }
  return `조금 빠릅니다. ${retryAfterSec}초 뒤에 다시 시도해 주세요.`
}
