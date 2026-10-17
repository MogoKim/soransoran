import { createHmac, randomBytes } from 'node:crypto'

export {
  POST_EXPOSURE_BATCH_MAX,
  POST_EXPOSURE_KINDS,
  POST_EXPOSURE_LIST_SURFACES,
  POST_EXPOSURE_RETENTION_DAYS,
  POST_EXPOSURE_SURFACES,
  POST_EXPOSURE_VISITOR_COOKIE,
  POST_EXPOSURE_VISITOR_MAX_AGE,
  POST_EXPOSURE_WINDOW_MS,
  validListExposurePayload,
  type ListExposurePayload,
  type PostExposureKind,
  type PostExposureListSurface,
  type PostExposureSurface,
} from '@/lib/post-exposure-contract'
import { POST_EXPOSURE_WINDOW_MS } from '@/lib/post-exposure-contract'

export function exposureWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / POST_EXPOSURE_WINDOW_MS) * POST_EXPOSURE_WINDOW_MS)
}

export function newAnonymousViewerToken(): string {
  return randomBytes(24).toString('base64url')
}

export function validAnonymousViewerToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value)
}

export function viewerKeyHash(secret: string, identity: string): string {
  if (secret.trim().length < 16) throw new Error('POST_EXPOSURE_SECRET_MISSING')
  return createHmac('sha256', secret)
    .update(`soransoran:post-exposure:v1:${identity}`, 'utf8')
    .digest('hex')
}

export function postExposureSecret(env: NodeJS.ProcessEnv): string | null {
  const value = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET
  return typeof value === 'string' && value.trim().length >= 16 ? value : null
}

export function shouldRejectExposureRequest(request: Request): boolean {
  const h = request.headers
  if (h.get('next-router-prefetch') !== null) return true
  if (h.get('purpose') === 'prefetch' || h.get('sec-purpose')?.includes('prefetch')) return true
  if (h.get('x-bot-type') !== null) return true
  if (isKnownBotUserAgent(h.get('user-agent'))) return true

  const origin = h.get('origin')
  if (!origin) return true
  try {
    if (origin !== new URL(request.url).origin) return true
  } catch {
    return true
  }
  const site = h.get('sec-fetch-site')
  return site !== null && site !== 'same-origin'
}

export function isKnownBotUserAgent(value: string | null): boolean {
  if (value === null) return false
  return /(?:bot(?:[/\s;]|$)|crawler|spider|slurp|headlesschrome|lighthouse|facebookexternalhit)/i.test(value)
}
