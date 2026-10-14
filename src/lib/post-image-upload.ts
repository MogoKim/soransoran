import 'server-only'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { optimizeImage, type OptimizedImage } from '@/lib/image-optimize'
import {
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
  HEIC_EXTENSION,
  IMAGE_TOO_LARGE,
  IMAGE_TYPE_NOT_ALLOWED,
  IMAGE_UPLOAD_FAILED,
} from '@/lib/post-media-policy'

/**
 * 글에 넣을 사진 한 장을 받아 검사·변환·저장한다 — 회원(`/api/uploads`)과
 * 운영 직접 작성(`/api/admin/uploads`)이 **같은 함수**를 지난다.
 *
 * 🔴 **누가 올리는가는 여기서 묻지 않는다.** 로그인·가입 완료·관리자 여부는 라우트가
 *    먼저 판정하고, 통과한 사람의 id 만 `ownerId` 로 넘긴다. 이 함수는 "이 파일을
 *    받아도 되는가" 하나만 답한다 — 둘이 섞이면 한쪽 문을 고칠 때 다른 쪽이 따라 열린다.
 *
 * 🔴 **크기·형식·sharp 검사·WebP 변환·EXIF 제거가 한 곳에 있다.** 관리자 경로라고
 *    더 느슨한 규칙을 쓰지 않는다. 운영 글의 사진도 같은 목록·같은 화면에 실린다.
 *
 * 🔴 저장 함수(`store`)는 부르는 쪽이 넘긴다. 라우트는 `uploadToR2` 를 넘기고,
 *    검사는 가짜 저장소를 넘긴다 — 그래서 검사가 운영 R2 에 한 장도 올리지 않는다.
 */

/** 사용자당 1분에 12장. 여섯 장짜리 글 하나를 한 번에 올리고도 남는다. 🔴 회원·관리자 같은 한도 */
export const UPLOAD_LIMIT = 12
export const UPLOAD_WINDOW_MS = 60 * 1000

export type StoreImage = (buffer: Buffer, key: string, contentType: string) => Promise<{ url: string }>
export type OptimizeImage = (input: Buffer) => Promise<OptimizedImage>

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function receivePostImage(
  request: Request,
  opts: { ownerId: string; store: StoreImage; optimize?: OptimizeImage; logTag: string },
): Promise<NextResponse> {
  const optimize = opts.optimize ?? optimizeImage

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
    const optimized = await optimize(raw)
    const key = `posts/${opts.ownerId}/${randomUUID()}.webp`
    const stored = await opts.store(optimized.buffer, key, optimized.contentType)

    return NextResponse.json(
      { url: stored.url, width: optimized.width, height: optimized.height },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // 🔴 원인을 화면에 흘리지 않는다. 로그에만 남긴다.
    console.error(`[${opts.logTag}] 실패:`, (error as Error).message)
    return bad(IMAGE_UPLOAD_FAILED, 500)
  }
}
