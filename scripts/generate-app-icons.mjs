#!/usr/bin/env node
/**
 * 앱 아이콘 4종 생성 — 창업자가 지정한 최신 asset/Favicon.png 전체를 그대로 축소한다
 *
 *   node scripts/generate-app-icons.mjs <원본 경로>           대조만 한다 (기본 · 파일을 쓰지 않는다)
 *   node scripts/generate-app-icons.mjs <원본 경로> --write   4종을 덮어쓴다
 *
 * 🔴 허용되는 변형은 **정사각 원본 전체를 각 규격으로 축소하는 것 하나**다.
 *    크롭 · 여백 제거 · 배경 교체 · 색 보정 · 팔레트 양자화 · 알파 추가를 하지 않는다.
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
]

/** 원본 전체 → size×size. lanczos3 축소 · 무손실 PNG · 메타데이터 제거 */
export function renderIcon(source, size) {
  return sharp(source)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
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

  let mismatch = 0
  for (const icon of APP_ICONS) {
    const out = await renderIcon(source, icon.size)
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
  console.log(`\n원본 ${SOURCE_SIZE}×${SOURCE_SIZE} · sha256 ${sha}${write ? '' : ' — 4종 모두 원본 축소 결과와 픽셀 단위로 같다'}`)
}

main()
