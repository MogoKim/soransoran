import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { receivePostImage, UPLOAD_LIMIT, UPLOAD_WINDOW_MS } from '@/lib/post-image-upload'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { IMAGE_UPLOAD_OFF } from '@/lib/post-media-policy'

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

  // 🔴 파일 검사·변환·저장은 관리자 업로드와 같은 함수를 지난다(post-image-upload.ts)
  return receivePostImage(request, { ownerId: userId, store: uploadToR2, logTag: 'uploads' })
}
