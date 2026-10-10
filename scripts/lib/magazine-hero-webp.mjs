/**
 * hero 변환 — 이미지 Buffer → 1200×675 WebP Buffer (2026-10-10).
 *
 * 🔴 **왜 Chrome 에서 옮겼나.** 앞판은 ChatGPT 와 같은 Chrome(CDP)에 다시 붙어 `canvas.toDataURL('image/webp')` 로
 *    변환했다. 이미지를 받은 뒤에도 Chrome 세션에 기대야 했고, 격리 rehearsal 에서는 운영 Chrome 없이 실제 변환
 *    코드를 돌릴 길이 없었다. 지금은 저장소 직접 의존성 `sharp`(src/lib/image-optimize.ts 와 같은 것)로 Node 안에서 한다.
 * 🔴 계약은 그대로다 — 정확히 1200×675 · 비율 무시하고 채움(`fit: 'fill'` = canvas drawImage(0,0,w,h)) · WebP 품질 82.
 *    실패는 던지지 않고 `{ ok:false, stage:'webp', why }` 로 돌려준다 (호출부가 파일을 만들기 전에 멈춘다).
 */
import sharp from 'sharp'
import { HERO_WIDTH, HERO_HEIGHT } from './magazine-hero.mjs'

export const WEBP_QUALITY = 82

/**
 * @param {Buffer} input  ChatGPT 가 만든 이미지 (PNG 등 sharp 가 읽는 형식)
 * @returns {Promise<{ok:true, buffer:Buffer}|{ok:false, stage:'webp', why:string}>}
 */
export async function toHeroWebp(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) return { ok: false, stage: 'webp', why: 'webp: 입력 이미지가 비었다' }
  try {
    const buffer = await sharp(input)
      .resize(HERO_WIDTH, HERO_HEIGHT, { fit: 'fill' })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
    const meta = await sharp(buffer).metadata()
    if (meta.format !== 'webp' || meta.width !== HERO_WIDTH || meta.height !== HERO_HEIGHT) {
      return { ok: false, stage: 'webp', why: `webp: 변환 결과가 ${meta.format} ${meta.width}×${meta.height} 다` }
    }
    return { ok: true, buffer }
  } catch (err) {
    return { ok: false, stage: 'webp', why: `webp: ${err?.name ?? 'Error'} — ${String(err?.message ?? '').split('\n')[0].slice(0, 200)}` }
  }
}
