import 'server-only'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { primaryPublicOrigin, publicUrlFromKey } from '@/lib/r2-public'

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
/**
 * 넷 중 하나라도 비면 업로드를 켜지 않는다. 반쯤 설정된 상태가 가장 위험하다.
 *
 * 🔴 공개 주소는 **여기서 문자열로 다시 만들지 않는다.** r2-public 의
 *    primaryPublicOrigin 하나에 묻는다. 전에는 이 파일이 env 를 따로 읽어
 *    `${PUBLIC_URL}/${key}` 를 이어 붙였고, 그래서 어드민 배너는 검증을 지난
 *    주소를, 회원 사진은 검증을 지나지 않은 주소를 받았다 — 같은 bucket 에
 *    두 규칙이 생긴 것이다. 경로가 붙은 env 하나면 회원 사진만 조용히 깨진다.
 *
 * 🔴 함수다. 값이 아니다. env 판정이 부를 때마다 이뤄지므로
 *    "설정됐는가" 도 같은 시점에 물어야 답이 어긋나지 않는다.
 */
export function isR2Configured(): boolean {
  return Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && primaryPublicOrigin())
}

/**
 * S3 클라이언트는 처음 쓸 때 한 번 만든다.
 *
 * 🔴 미설정이면 만들지 않는다. 자격증명 없이 만들어 두면 "설정됐는지" 판단이
 *    클라이언트 존재 여부와 갈라져, 한쪽만 보고 쓰는 코드가 생긴다.
 */
let cachedClient: S3Client | null = null
function r2Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    })
  }
  return cachedClient
}

export type R2Object = { key: string; url: string }

/**
 * 🔴 **주소를 먼저 만들고, 만들 수 있을 때만 R2 에 쓴다.**
 *    순서가 반대면 객체는 올라갔는데 돌려줄 주소가 없는 상태가 된다 —
 *    부르는 쪽은 실패로 보고 글을 저장하지 않는데 bucket 에는 파일이 남는다.
 *    아무도 참조하지 않는 파일이라 나중에 찾아 지울 근거조차 없다.
 *
 * 🔴 `${PUBLIC_URL}/${key}` 로 직접 잇지 않는다. 어드민 배너 업로드와
 *    **같은 함수**(publicUrlFromKey)를 지난다 — 그래야 두 경로가 갈라지지 않는다.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<R2Object> {
  if (!isR2Configured()) throw new Error('R2 미설정')

  const url = publicUrlFromKey(key)
  if (!url) throw new Error('R2 공개 주소를 만들 수 없다')

  await r2Client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // 같은 key 를 다시 쓰지 않으므로(uuid) 길게 잡는다.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )

  return { key, url }
}

/**
 * 🔴 지금은 어디서도 부르지 않는다. 삭제 정책이 정해지기 전까지 호출하지 않는다 —
 *    같은 사진 주소가 여러 글에 붙어 있을 수 있고(복붙), 참조를 세는 곳이 없다.
 *    세지 않고 지우면 살아 있는 글의 사진이 깨진다.
 *    자세한 판단은 docs/decisions/post-media-orphan-files.md 에 적었다.
 */
export async function deleteFromR2(key: string): Promise<void> {
  if (!isR2Configured()) throw new Error('R2 미설정')
  await r2Client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/**
 * 🔴 "우리 주소인가" 판단은 r2-public.ts 하나가 한다.
 *    sanitize(server-only) 도 글쓰기 폼(브라우저) 도 같은 것을 물어야 하는데,
 *    이 모듈은 S3 클라이언트를 만들어 브라우저가 부를 수 없다.
 *    같은 판단을 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.
 */
export { isOwnPublicUrl, toR2Key } from '@/lib/r2-public'
