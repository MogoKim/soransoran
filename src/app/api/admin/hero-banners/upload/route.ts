import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { publicUrlFromKey } from '@/lib/r2-public'
import { optimizeImage } from '@/lib/image-optimize'
import { setHeroBannerImageKey } from '@/lib/actions/admin-hero-banner'
import {
  HERO_BANNER_ALLOWED_MIME_TYPES,
  HERO_BANNER_MAX_UPLOAD_BYTES,
  validateHeroBannerImageKey,
  validateHeroBannerImageMetadata,
  type HeroBannerSlot,
} from '@/lib/hero-banner-rules'

/**
 * 히어로 배너 이미지 한 장 업로드 — 운영자 전용.
 *
 * 🔴 회원용 /api/uploads 를 재사용하지 않는다. 같은 "사진 업로드" 로 보이지만
 *    막는 것이 서로 다르다 —
 *      회원: 로그인 + 가입 완료 · rate limit · HEIC 허용 · 1200px · 규격 없음
 *      배너: 운영자 · 규격(최소 크기·비율 ±1.5%) · HEIC 거부 · 1536px
 *    한 파일에 두 정책을 담으면 한쪽을 고칠 때 다른 쪽이 조용히 함께 바뀐다.
 *
 * 🔴 requireAdmin 이 **가장 먼저** 온다. 파일을 읽기도 전에 끝낸다 —
 *    본문을 먼저 파싱하면 권한 없는 사람이 4MB 를 보내 서버를 쓰게 만든다.
 *
 * 🔴 선언된 MIME 을 믿지 않는다. sharp 가 실제로 연 결과의 format 으로 판정한다.
 *    Content-Type 은 보내는 쪽이 정하는 값이다.
 *
 * 🔴 EXIF 를 남기지 않는다. optimizeImage 가 withMetadata 를 부르지 않아
 *    회전 정보를 적용한 뒤 나머지(촬영 위치 포함)를 통째로 버린다.
 *
 * 🔴 실패 원인을 화면에 흘리지 않는다. 자격증명·경로·스택은 로그에만 남긴다.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 저장 결과는 언제나 WebP 다. 배너는 폭 전체를 덮어 권장 규격(1536)까지 살린다. */
const STORED_MAX_EDGE = 1536
const STORED_QUALITY = 82

/** sharp 가 읽은 실제 형식 → MIME. 여기 없는 형식은 받지 않는다. */
const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function readSlot(raw: unknown): HeroBannerSlot | null {
  const value = String(raw ?? '')
  return value === 'mobile' || value === 'desktop' ? value : null
}

export async function POST(request: Request) {
  // 🔴 첫 줄이다. 이 아래 어떤 것도 권한 없이 실행되지 않는다.
  const { ok } = await requireAdmin()
  if (!ok) return bad('권한이 없습니다.', 403)

  if (!isR2Configured) {
    console.error('[hero-banner-upload] R2 환경변수가 채워지지 않았다 — 업로드를 받지 않는다')
    return bad('이미지 저장소가 아직 설정되지 않았습니다. 관리자에게 알려 주세요.', 503)
  }

  let bannerId = ''
  let slot: HeroBannerSlot | null = null
  let file: File | null = null

  try {
    const form = await request.formData()
    bannerId = String(form.get('bannerId') ?? '')
    slot = readSlot(form.get('slot'))
    const value = form.get('file')
    if (value instanceof File) file = value
  } catch {
    // 본문이 4.5MB 를 넘으면 여기까지 오지 못하고 잘린다 — 같은 문구로 답한다.
    return bad('사진이 너무 커요. 4MB 이하로 골라주세요.', 413)
  }

  if (!bannerId) return bad('배너를 찾지 못했습니다.', 400)
  if (!slot) return bad('알 수 없는 이미지 자리입니다.', 400)
  if (!file) return bad('사진을 골라주세요.', 400)

  // 🔴 보관한 배너에는 올리지 않는다. 쓸 일이 없는 파일을 R2 에 남기지 않는다.
  const banner = await prisma.heroBanner.findUnique({
    where: { id: bannerId },
    select: { id: true, archivedAt: true },
  })
  if (!banner) return bad('배너를 찾지 못했습니다.', 404)
  if (banner.archivedAt) {
    return bad('보관한 배너에는 이미지를 올릴 수 없습니다. 먼저 보관을 풀어 주세요.', 409)
  }

  if (file.size > HERO_BANNER_MAX_UPLOAD_BYTES) {
    return bad('사진이 너무 커요. 4MB 이하로 골라주세요.', 413)
  }

  const allowed: readonly string[] = HERO_BANNER_ALLOWED_MIME_TYPES
  if (!allowed.includes(file.type)) {
    return bad('사진 형식이 맞지 않아요. JPG · PNG · WebP 만 올릴 수 있어요.', 415)
  }

  try {
    const raw = Buffer.from(await file.arrayBuffer())

    /**
     * 🔴 규격 판정은 **원본**으로 한다. 변환한 뒤에 재면 1536 으로 줄어든 값이라
     *    "최소 1152" 를 언제나 통과해 버린다 — 작은 이미지가 늘어나는 대신
     *    withoutEnlargement 로 그대로 남아 흐릿한 배너가 된다.
     *
     * 🔴 sharp 가 못 열면 이미지가 아니다. 확장자·MIME 보다 이쪽이 확실하다.
     */
    const probe = await sharp(raw).metadata()
    const realMime = probe.format ? FORMAT_TO_MIME[probe.format] : undefined
    if (!realMime) {
      return bad('사진 형식이 맞지 않아요. JPG · PNG · WebP 만 올릴 수 있어요.', 415)
    }

    /**
     * 🔴 EXIF 회전을 반영한 크기로 잰다. 폰으로 세로로 찍은 사진은
     *    width/height 가 뒤바뀐 채 저장되고 orientation 5~8 이 "돌려서 보라" 고 말한다.
     *    그대로 재면 3:1 이 1:3 으로 읽혀 멀쩡한 이미지가 거부된다.
     */
    const rotated = (probe.orientation ?? 1) >= 5
    const width = rotated ? probe.height : probe.width
    const height = rotated ? probe.width : probe.height

    const invalid = validateHeroBannerImageMetadata(slot, {
      width: width ?? 0,
      height: height ?? 0,
      byteSize: file.size,
      mimeType: realMime,
    })
    if (invalid) return bad(invalid.error, 422)

    const optimized = await optimizeImage(raw, {
      maxEdge: STORED_MAX_EDGE,
      quality: STORED_QUALITY,
    })

    // 🔴 올린 사람의 파일명은 key 에 들어가지 않는다. 서버가 만든 uuid 만 쓴다.
    const key = `hero-banners/${new Date().getUTCFullYear()}/${randomUUID()}-${slot}.webp`

    // 만든 key 가 계약대로인지 올리기 전에 본다 — 잘못된 key 로 R2 를 더럽히지 않는다.
    const badKey = validateHeroBannerImageKey(slot, key)
    if (badKey) {
      console.error('[hero-banner-upload] 생성한 key 가 계약을 벗어났다')
      return bad('사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500)
    }

    // 🔴 교체된 옛 객체는 지우지 않는다. 참조를 세는 곳이 없다.
    await uploadToR2(optimized.buffer, key, optimized.contentType)

    const saved = await setHeroBannerImageKey(bannerId, slot, key)
    if (saved.error) return bad(saved.error, 409)

    return NextResponse.json(
      {
        key,
        url: publicUrlFromKey(key),
        width: optimized.width,
        height: optimized.height,
        byteSize: optimized.buffer.byteLength,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[hero-banner-upload] 실패:', (error as Error).message)
    return bad('사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500)
  }
}
