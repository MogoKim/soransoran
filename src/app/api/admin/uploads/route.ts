import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { receivePostImage, UPLOAD_LIMIT, UPLOAD_WINDOW_MS } from '@/lib/post-image-upload'
import { checkActionRateLimit, retryMessage } from '@/lib/rate-limit'
import { IMAGE_UPLOAD_OFF } from '@/lib/post-media-policy'

/**
 * 운영 직접 작성(`/admin/compose`) 글에 넣을 사진 한 장 업로드 — 🔴 관리자 전용.
 *
 * 🔴 **왜 회원 업로드(`/api/uploads`)를 그대로 쓰지 않는가.** 그쪽 문은 "가입을 마친 회원" 이다.
 *    관리자 계정이 그 조건을 우연히 만족해서 열리는 것은 이 화면의 근거가 아니다 —
 *    관리자의 `isOnboarded` 가 바뀌는 날 운영 글의 사진이 조용히 막힌다.
 *    문을 따로 두고, 그 문은 `requireAdmin()` 하나로만 연다.
 *
 * 🔴 **조작자는 서버 세션에서 얻는다.** 요청 본문에서 누가 올리는지 받지 않는다 —
 *    받으면 그 값은 클라이언트가 정하는 값이 된다. 저장 key 의 주인도 세션의 id 다.
 *
 * 🔴 **파일 규칙은 회원과 같다.** 크기·형식·sharp 검사·WebP·EXIF 제거·한도 모두
 *    `receivePostImage` 하나를 지난다. 관리자라고 느슨하게 받지 않는다.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const session = await auth()
  const actorUserId = session?.user?.id
  if (!actorUserId) return bad('로그인이 필요합니다.', 401)

  // 🔴 관리자 판정은 어드민 화면·서버 액션과 같은 함수다
  const { ok } = await requireAdmin()
  if (!ok) return bad('권한이 없습니다.', 403)

  if (!isR2Configured()) {
    console.error('[admin-uploads] R2 환경변수가 채워지지 않았다 — 업로드를 받지 않는다')
    return bad(IMAGE_UPLOAD_OFF, 503)
  }

  const limited = checkActionRateLimit('admin-upload', actorUserId, UPLOAD_LIMIT, UPLOAD_WINDOW_MS)
  if (!limited.ok) return bad(retryMessage(limited.retryAfterSec), 429)

  return receivePostImage(request, { ownerId: actorUserId, store: uploadToR2, logTag: 'admin-uploads' })
}
