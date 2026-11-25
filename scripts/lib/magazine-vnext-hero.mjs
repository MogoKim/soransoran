/**
 * Magazine vNext S4 — hero 한 장 (runbook §0.0B.3 · charter §12).
 *
 *   원본 → 가운데 16:9 로 **잘라 맞추고**(늘리지 않는다) → 1200×675 WebP → 크기 · 형식 확인 → 지각 해시(dHash) 중복 확인
 * 🔴 legacy `toHeroWebp`(fit: fill — 비율을 무시하고 늘린다)는 동결이라 고치지 않는다. vNext 는 이 함수 하나만 쓴다.
 * 🔴 잘라 내는 면적이 원본의 25% 를 넘거나(정사각 · 세로 원본) 잘라 낸 뒤 1200×675 보다 작으면(확대 금지) 그 이미지를 쓰지 않는다.
 * 같은 hero 한 장을 상세 hero · 홈/목록 썸네일 · 본문 중간 띠배너에 재사용한다(따로 만들지 않는다).
 */
import sharp from 'sharp'
import { HERO_HEIGHT, HERO_WIDTH } from './magazine-qa-constants.mjs'

/** legacy toHeroWebp 와 같은 품질 82 — 그 모듈은 drafts 적재 검사(magazine-load)를 끌고 와서 vNext 가 import 하지 않는다 */
export const HERO_WEBP_QUALITY = 82
export const HERO_MAX_CROP_LOSS = 0.25
/** dHash 해밍 거리 — 이 값 이하면 같은 그림으로 본다 */
export const HERO_DUP_DISTANCE = 5

/**
 * @param {Buffer} source  provider 가 준 원본 바이트
 * @returns {Promise<{ ok: true, webp: Buffer, crop: object, source: object } | { ok: false, code: string, why: string }>}
 */
export async function heroFromSource(source) {
  let meta
  try { meta = await sharp(source).metadata() } catch { return { ok: false, code: 'IMAGE_UNREADABLE', why: '원본을 읽지 못했다' } }
  const { width: w, height: h, format } = meta
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return { ok: false, code: 'IMAGE_UNREADABLE', why: '크기를 읽지 못했다' }
  const target = HERO_WIDTH / HERO_HEIGHT
  const crop = w / h > target ? { width: Math.round(h * target), height: h } : { width: w, height: Math.round(w / target) }
  crop.left = Math.floor((w - crop.width) / 2)
  crop.top = Math.floor((h - crop.height) / 2)
  const loss = 1 - (crop.width * crop.height) / (w * h)
  if (loss > HERO_MAX_CROP_LOSS) return { ok: false, code: 'IMAGE_RATIO_FAR', why: `${w}×${h} 를 16:9 로 자르면 ${Math.round(loss * 100)}% 를 버린다` }
  if (crop.width < HERO_WIDTH || crop.height < HERO_HEIGHT) return { ok: false, code: 'IMAGE_TOO_SMALL', why: `잘라 낸 ${crop.width}×${crop.height} 가 ${HERO_WIDTH}×${HERO_HEIGHT} 보다 작다(확대하지 않는다)` }
  const webp = await sharp(source).extract(crop).resize(HERO_WIDTH, HERO_HEIGHT).webp({ quality: HERO_WEBP_QUALITY }).toBuffer()
  const back = await sharp(webp).metadata()
  if (back.format !== 'webp' || back.width !== HERO_WIDTH || back.height !== HERO_HEIGHT) return { ok: false, code: 'HERO_ENCODE_MISMATCH', why: `${back.format} ${back.width}×${back.height}` }
  return { ok: true, webp, crop, source: { width: w, height: h, format } }
}

/** 64비트 dHash — 9×8 회색조에서 이웃 밝기 비교 */
export async function dHash(bytes) {
  const px = await sharp(bytes).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0'
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0')
}

export const hamming = (a, b) => { let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0; while (x) { n += Number(x & 1n); x >>= 1n } return n }

/** 기존 hero 들과 같은 그림인가 — 가장 가까운 거리와 그 이름 */
export async function nearestHero(hash, others) {
  let best = null
  for (const o of others) {
    let h
    try { h = o.hash ?? await dHash(o.bytes) } catch { continue }
    const d = hamming(hash, h)
    if (!best || d < best.distance) best = { name: o.name, distance: d }
  }
  return best
}
