import 'server-only'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

/**
 * Cloudflare R2 — 글에 붙는 사진을 두는 곳.
 *
 * 🔴 우나어 bucket(unaeo-uploads)·커스텀 도메인(img.age-doesnt-matter.com)을
 *    그대로 쓰지 않는다. 두 서비스가 한 bucket 을 쓰면 정리·과금·유출 범위가 엉킨다.
 *    기본값을 두지 않는 것도 그래서다 — 미설정이면 조용히 남의 bucket 에
 *    올라가는 대신 여기서 멈춘다.
 *
 * 🔴 키는 이 bucket 하나만 쓸 수 있게 발급받는다(bucket 스코프).
 *    계정 전체 키를 넣으면 이 코드의 실수 하나가 다른 bucket 까지 닿는다.
 *
 * 🔴 값을 로그에 찍지 않는다. 미설정 경고도 "무엇이 없다" 까지만 말한다.
 */
const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
const ACCESS_KEY = (process.env.CLOUDFLARE_R2_ACCESS_KEY ?? '').trim()
const SECRET_KEY = (process.env.CLOUDFLARE_R2_SECRET_KEY ?? '').trim()
const BUCKET = (process.env.CLOUDFLARE_R2_BUCKET ?? '').trim()
/** 공개 읽기 주소. r2.dev 이거나 소란소란 전용 커스텀 도메인이다. */
const PUBLIC_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')

/** 넷 중 하나라도 비면 업로드를 켜지 않는다. 반쯤 설정된 상태가 가장 위험하다. */
export const isR2Configured = Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_URL)

const client = isR2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    })
  : null

export type R2Object = { key: string; url: string }

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<R2Object> {
  if (!client) throw new Error('R2 미설정')

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // 같은 key 를 다시 쓰지 않으므로(uuid) 길게 잡는다.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )

  return { key, url: `${PUBLIC_URL}/${key}` }
}

/**
 * 🔴 지금은 어디서도 부르지 않는다. 삭제 정책이 정해지기 전까지 호출하지 않는다 —
 *    같은 사진 주소가 여러 글에 붙어 있을 수 있고(복붙), 참조를 세는 곳이 없다.
 *    세지 않고 지우면 살아 있는 글의 사진이 깨진다.
 *    자세한 판단은 docs/decisions/post-media-orphan-files.md 에 적었다.
 */
export async function deleteFromR2(key: string): Promise<void> {
  if (!client) throw new Error('R2 미설정')
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/**
 * 우리 bucket 의 공개 주소인가.
 *
 * 🔴 문자열 startsWith 로 보지 않는다. `https://our-cdn.evil.com` 이
 *    `https://our-cdn.com` 으로 시작하는 것처럼 보이는 일을 막는다.
 */
export function isOwnPublicUrl(url: string): boolean {
  if (!PUBLIC_URL) return false
  try {
    return new URL(url).origin === new URL(PUBLIC_URL).origin
  } catch {
    return false
  }
}

/** 우리 공개 주소 → bucket key. 우리 것이 아니면 null. */
export function toR2Key(url: string): string | null {
  if (!isOwnPublicUrl(url)) return null
  try {
    const path = new URL(url).pathname.replace(/^\/+/, '')
    // 경로 순회 차단 — key 에 .. 이 들어갈 일은 없다.
    if (!path || path.includes('..')) return null
    return path
  } catch {
    return null
  }
}
