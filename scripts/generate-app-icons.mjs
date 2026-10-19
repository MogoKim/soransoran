#!/usr/bin/env node
/**
 * 앱 아이콘 6종 생성 — 창업자가 지정한 최신 asset/Favicon.png 전체를 그대로 축소한다
 *
 *   node scripts/generate-app-icons.mjs <원본 경로>           대조만 한다 (기본 · 파일을 쓰지 않는다)
 *   node scripts/generate-app-icons.mjs <원본 경로> --write   6종을 덮어쓴다
 *
 * 🔴 허용되는 변형은 **정사각 원본 전체를 각 규격으로 축소하는 것 하나**다.
 *    크롭 · 여백 제거 · 배경 교체 · 색 보정 · 팔레트 양자화 · 알파 추가를 하지 않는다.
 *
 * 🔴 **한정 예외 — Android maskable 2종만** (2026-10-19 창업자 승인 · S-PWA)
 *    maskable 은 "가운데 지름 80% 원 안에 내용이 다 들어온다"는 약속이다. 원본은 내용이
 *    반지름의 약 84% 까지 나가 그대로는 원형 마스크에 잘린다. 그래서 maskable 에 한해
 *    원본 전체를 MASKABLE_SCALE 로 줄이고, 바깥을 원본 모서리와 같은 아이보리로 끝까지 채운다.
 *    로고의 색·형태·글자·비율은 바꾸지 않는다. 자르기 · 재해석 · 새 심볼 · 색 변경은 여전히 금지다.
 *    이 규칙은 renderMaskable 한 곳에만 있다. any 아이콘 4종은 위 규칙 그대로다.
 *
 * 🔴 원본은 저장소에 들어오지 않는다. 대신 SHA-256 을 고정해 **다른 파일로 만든 아이콘**을 막는다.
 *    원본이 바뀌면 이 값을 고치기 전에 창업자 승인부터 받는다.
 *
 * 기본 모드는 원본에서 다시 만든 픽셀과 저장소 파일의 픽셀을 비교한다 —
 * 같으면 "저장소 아이콘이 이 원본·이 방식에서 나왔다" 는 재현 증거다.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const ROOT = process.cwd()
const SOURCE_SHA256 = '31386c4076006d7e8abb8abddd88ffb956e19a151aa0e8542acc5da3e262dcbe'
const SOURCE_SIZE = 1254

/** 쓰임새별 규격 — manifest.ts · brand-assets.ts 와 같은 값이어야 한다 (check:brand-assets 가 대조) */
export const APP_ICONS = [
  { path: 'src/app/icon.png', size: 96, use: '브라우저 탭 · 검색 결과 favicon (48px 초과 정사각 · 채택 규격)' },
  { path: 'src/app/apple-icon.png', size: 180, use: 'iPhone·iPad 홈 화면' },
  { path: 'public/brand/icon-192.png', size: 192, use: 'Android/PWA 설치' },
  { path: 'public/brand/icon-512.png', size: 512, use: 'Android/PWA 고해상도·스플래시' },
  { path: 'public/brand/icon-maskable-192.png', size: 192, maskable: true, use: 'Android 원형·둥근 사각형 마스크' },
  { path: 'public/brand/icon-maskable-512.png', size: 512, maskable: true, use: 'Android 원형·둥근 사각형 마스크 고해상도' },
]

/** maskable 전용 축소 비율 — 내용 반지름 약 84% × 0.90 ≈ 75% 로 안전 원(80%) 안에 든다 */
export const MASKABLE_SCALE = 0.9

/** 원본 전체 → size×size. lanczos3 축소 · 무손실 PNG · 메타데이터 제거 */
export function renderIcon(source, size) {
  return sharp(source)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

/**
 * 원본 모서리 색 — 원본 테두리 1px 전체의 평균.
 * 🔴 색 값을 코드에 적지 않고 원본에서 읽는다. 원본 SHA 가 고정이라 결과도 고정이다.
 */
export async function edgeColor(source) {
  const { data, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: c } = info
  const sum = [0, 0, 0]
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y !== 0 && y !== h - 1 && x !== 0 && x !== w - 1) continue
      const i = (y * w + x) * c
      sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]
      n++
    }
  }
  const [r, g, b] = sum.map((v) => Math.round(v / n))
  return { r, g, b }
}

/** maskable — 원본 전체를 MASKABLE_SCALE 로 축소하고 가운데 둔 뒤, 바깥을 모서리 색으로 채운다. 불투명 RGB */
export function renderMaskable(source, size, fill) {
  const inner = Math.round(size * MASKABLE_SCALE)
  const lead = Math.floor((size - inner) / 2)
  const trail = size - inner - lead
  return sharp(source)
    .resize(inner, inner, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .extend({ top: lead, bottom: trail, left: lead, right: trail, background: { ...fill, alpha: 1 } })
    .removeAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
}

async function rawPixels(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  return { data, info }
}

async function main() {
  const sourcePath = process.argv[2]
  const write = process.argv.includes('--write')
  if (!sourcePath || sourcePath.startsWith('--')) {
    console.error('사용법: node scripts/generate-app-icons.mjs <asset/Favicon.png 경로> [--write]')
    process.exit(1)
  }

  const source = readFileSync(sourcePath)
  const sha = createHash('sha256').update(source).digest('hex')
  if (sha !== SOURCE_SHA256) {
    console.error(`🔴 원본 SHA-256 이 다릅니다\n  기대 ${SOURCE_SHA256}\n  실제 ${sha}`)
    process.exit(1)
  }
  const meta = await sharp(source).metadata()
  if (meta.width !== SOURCE_SIZE || meta.height !== SOURCE_SIZE) {
    console.error(`🔴 원본 크기가 ${SOURCE_SIZE}×${SOURCE_SIZE} 가 아닙니다: ${meta.width}×${meta.height}`)
    process.exit(1)
  }

  const fill = await edgeColor(source)
  let mismatch = 0
  for (const icon of APP_ICONS) {
    const out = icon.maskable ? await renderMaskable(source, icon.size, fill) : await renderIcon(source, icon.size)
    const abs = join(ROOT, icon.path)
    if (write) {
      writeFileSync(abs, out)
      console.log(`쓰기  ${icon.size}×${icon.size}  ${icon.path}  sha256 ${createHash('sha256').update(out).digest('hex')}`)
      continue
    }
    const want = await rawPixels(out)
    let got
    try {
      got = await rawPixels(readFileSync(abs))
    } catch (e) {
      console.error(`불일치  ${icon.path} — 읽지 못했습니다 (${e.message})`)
      mismatch++
      continue
    }
    const same =
      got.info.width === want.info.width &&
      got.info.height === want.info.height &&
      got.info.channels === want.info.channels &&
      got.data.equals(want.data)
    if (!same) mismatch++
    console.log(`${same ? '일치  ' : '불일치'}  ${icon.size}×${icon.size}  ${icon.path}`)
  }

  if (!write && mismatch) {
    console.error(`\n🔴 ${mismatch}건이 원본 축소 결과와 다릅니다. --write 로 다시 만들기 전에 왜 다른지 먼저 확인하세요.`)
    process.exit(1)
  }
  console.log(`\n원본 ${SOURCE_SIZE}×${SOURCE_SIZE} · sha256 ${sha} · 모서리 색 rgb(${fill.r},${fill.g},${fill.b})`)
  if (!write) console.log(`${APP_ICONS.length}종 모두 원본에서 다시 만든 결과와 픽셀 단위로 같다`)
}

main()
