import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { optimizeImage } from '@/lib/image-optimize'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import {
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
  HEIC_EXTENSION,
  IMAGE_TOO_LARGE,
  IMAGE_TYPE_NOT_ALLOWED,
  IMAGE_UPLOAD_FAILED,
  IMAGE_UPLOAD_OFF,
} from '@/lib/post-media-policy'

/**
 * 글에 넣을 사진 한 장 업로드.
 *
 * 🔴 서버를 거쳐 올린다. presigned URL 로 브라우저가 R2 에 직접 올리는 길도 있지만
 *    그러면 sharp 를 지나지 못해 원본이 그대로 저장된다(우나어가 그렇다).
 *    4MB 상한이 Vercel 본문 한도 안이라 서버 경유가 가능하고,
 *    경유해야 WebP 변환·EXIF 제거·용량 축소가 실제로 일어난다.
 *
 * 🔴 로그인 + 가입 완료한 사람만. 비회원 댓글에는 열지 않는다 —
 *    신원 없는 업로드는 스팸이 가장 먼저 찾는 문이다.
 *
 * 🔴 파일 내용을 믿지 않는다. Content-Type 은 보내는 쪽이 정하는 값이라
 *    sharp 가 실제로 열 수 있는지가 진짜 검사다. 못 열면 거기서 끝난다.
 *
 * 🔴 R2 가 설정되지 않았으면 500 이 아니라 안내를 준다.
 *    설정 누락은 쓰는 사람 잘못이 아니고, 글은 사진 없이도 올릴 수 있다.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 사용자당 1분에 12장. 여섯 장짜리 글 하나를 한 번에 올리고도 남는다. */
const UPLOAD_LIMIT = 12
const UPLOAD_WINDOW_MS = 60 * 1000

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return bad('로그인이 필요합니다.', 401)

  if (!isR2Configured()) {
    console.error('[uploads] R2 환경변수가 채워지지 않았다 — 업로드를 받지 않는다')
    return bad(IMAGE_UPLOAD_OFF, 503)
  }

  // 🔴 가입을 안 끝낸 사람은 글도 못 쓴다. 사진만 먼저 올릴 이유가 없다.
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOnboarded: true },
  })
  if (!member?.isOnboarded) return bad('가입을 먼저 마쳐 주세요.', 403)

  const limited = checkActionRateLimit('upload', userId, UPLOAD_LIMIT, UPLOAD_WINDOW_MS)
  if (!limited.ok) return bad(retryMessage(limited.retryAfterSec), 429)

  let file: File | null = null
  try {
    const form = await request.formData()
    const value = form.get('file')
    if (value instanceof File) file = value
  } catch {
    // 본문이 4.5MB 를 넘으면 여기까지 오지 못하고 잘린다 — 그 경우도 같은 문구로 답한다.
    return bad(IMAGE_TOO_LARGE, 413)
  }
  if (!file) return bad('사진을 골라주세요.', 400)

  if (file.size > MAX_IMAGE_BYTES) return bad(IMAGE_TOO_LARGE, 413)

  // iOS 17 일부에서 heic 의 type 이 빈 문자열로 온다 — 확장자로 한 번 더 본다.
  const declared = file.type
  const looksHeic = declared === '' && HEIC_EXTENSION.test(file.name)
  if (!looksHeic && !ALLOWED_IMAGE_TYPES.includes(declared as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return bad(IMAGE_TYPE_NOT_ALLOWED, 415)
  }

  try {
    const raw = Buffer.from(await file.arrayBuffer())
    // sharp 가 열지 못하면 이미지가 아니다 — 확장자·MIME 보다 이쪽이 확실하다.
    const optimized = await optimizeImage(raw)
    const key = `posts/${userId}/${randomUUID()}.webp`
    const stored = await uploadToR2(optimized.buffer, key, optimized.contentType)

    return NextResponse.json(
      { url: stored.url, width: optimized.width, height: optimized.height },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // 🔴 원인을 화면에 흘리지 않는다. 로그에만 남긴다.
    console.error('[uploads] 실패:', (error as Error).message)
    return bad(IMAGE_UPLOAD_FAILED, 500)
  }
}
