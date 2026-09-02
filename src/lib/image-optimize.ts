import 'server-only'
import sharp from 'sharp'

/**
 * 올라온 사진을 WebP 로 바꾼다.
 *
 * 🔴 원본을 그대로 두지 않는다.
 *    폰 사진은 한 장에 3~5MB 이고 4000px 이 넘는다. 그대로 두면
 *    목록 한 번 넘길 때마다 그 무게가 그대로 내려간다 —
 *    데이터를 아껴 쓰는 사람이 많은 자리다.
 *
 * 🔴 .rotate() 를 먼저 부른다. EXIF 회전 정보만 있고 픽셀은 그대로인 사진이 많다.
 *    변환하면서 그 정보를 버리면 옆으로 누운 사진이 된다 —
 *    폰으로 세로로 찍은 사진에서 특히 자주 난다.
 *
 * 🔴 위치 정보를 남기지 않는다. withMetadata 를 부르지 않으면 EXIF 가 통째로 빠진다.
 *    집 앞에서 찍은 사진에 좌표가 붙어 공개되는 일을 만들지 않는다.
 */
const MAX_EDGE = 1200
const QUALITY = 80

export type OptimizedImage = {
  buffer: Buffer
  contentType: 'image/webp'
  width: number
  height: number
}

export async function optimizeImage(input: Buffer): Promise<OptimizedImage> {
  const output = await sharp(input)
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer({ resolveWithObject: true })

  return {
    buffer: output.data,
    contentType: 'image/webp',
    width: output.info.width,
    height: output.info.height,
  }
}
