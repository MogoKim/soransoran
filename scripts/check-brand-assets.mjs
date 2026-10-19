#!/usr/bin/env node
/**
 * 브랜드 자산 manifest 검사
 *
 * 🔴 목록이 현실과 어긋나면 목록이 없는 것보다 나쁘다.
 *    "여기 다 적혀 있다"고 믿고 리브랜딩 당일에 열었는데 경로가 옛것이면,
 *    빠뜨린 것을 빠뜨렸는지도 모른 채 넘어간다.
 *
 * ── 이 검사가 보장하는 것 ──
 *   · 엔트리 구조가 유효하다 (필수 필드 · 허용된 category 값)
 *   · path 가 목록 안에서 유일하다 (중복 등록 없음)
 *   · 필수 category 가 하나도 빠지지 않았다
 *   · 적힌 파일·코드 진입점이 실제로 존재한다
 *   · 외부 브랜드(locked)가 구분돼 있다
 *   · 🔴 **PNG 자산의 실제 픽셀 크기가 적힌 값과 같다** (PNG 헤더를 직접 읽는다)
 *   · 🔴 **manifest 의 아이콘 4종이 실제 파일·실제 크기·MIME 과 맞는다**
 *   · 🔴 **manifest 아이콘이 any 192·512 · maskable 192·512 이고, 쿼리 없는 /icon.png · /apple-icon.png 가 없다**
 *   · 🔴 **manifest 아이콘 픽셀** — 불투명 · 배경이 가장자리까지 채움 · 내부 네모 섬 없음 ·
 *        maskable 은 내용이 안전 원(지름 80%) 안 (PNG 를 zlib 로 직접 풀어 잰다)
 *   · 🔴 **우나어 3원 심볼 자산의 해시가 public/ · src/ 에 0건**
 *   · 🔴 **탭·검색 favicon(src/app/icon.png)이 정사각이고 48px 보다 크다** (소란소란 제품 계약)
 *   · 🔴 **가로형 로고 파일이 표시 상자(brand-logo.ts)의 정확히 2배다**
 *   · 🔴 **구 텍스트 워드마크 계약이 코드에 남아 있지 않다**
 *
 * ── 🔴 보장하지 못하는 것 (과장하지 않는다) ──
 *   · **manifest 에 적지 않은 새 브랜드 자산은 찾아내지 못한다.**
 *     누군가 로고 이미지를 추가하고 목록에 넣지 않으면 이 검사는 그대로 통과한다.
 *     자동 탐색은 매거진·사용자 이미지까지 끌어와 오탐이 되므로 하지 않는다.
 *   · 이미지 **안에** 브랜드 요소(글자·로고)가 있는지 시각적으로 판정하지 못한다.
 *     크기는 재지만 **무엇이 그려져 있는지는 사람이 본다.**
 *   · 새 로고·아이콘을 만들어 주지 않는다. 교체는 사람의 일이다.
 *
 * 🔴 새 dependency 를 쓰지 않는다. PNG 크기는 헤더 24바이트에 있어
 *    이미지 라이브러리 없이 Node 표준만으로 읽는다.
 *
 * 🔴 이미지 파일 자체는 읽기만 한다. 수정·이동·이름 변경을 하지 않는다.
 *
 * manifest 는 src/lib/brand-assets.ts 다. TypeScript 파일이라 node 가 직접 못 읽으므로
 * 파서로 배열 리터럴을 훑는다 — 새 dependency 없이 tsc 만 쓴다.
 */
import { createHash } from 'node:crypto'
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import ts from 'typescript'

const ROOT = process.cwd()
const MANIFEST = join(ROOT, 'src/lib/brand-assets.ts')

/** 배타적 분류 — 이 값 외에는 오타로 본다 */
const CATEGORIES = [
  'app-icon',
  'apple-icon',
  'logo',
  'og',
  'manifest',
  'hero',
  'login-image',
  'external',
]

/**
 * 최소 하나는 있어야 하는 category.
 *
 * 🔴 자산을 지우면서 목록에서만 빼는 것을 막는다 —
 *    "OG 이미지 항목이 사라졌다"를 사람이 알아채기는 어렵다.
 */
const REQUIRED_CATEGORIES = [
  'app-icon',
  'apple-icon',
  'logo',
  'og',
  'manifest',
  'hero',
  'login-image',
  'external',
]

const REQUIRED_FIELDS = ['path', 'kind', 'category', 'use', 'replace', 'locked', 'note']

/**
 * PNG 의 실제 픽셀 크기 — 헤더에서 읽는다.
 *
 * PNG 는 8바이트 시그니처 뒤 첫 청크가 반드시 IHDR 이고, 그 안에 가로·세로가
 * 빅엔디안 uint32 로 들어 있다(12~15 'IHDR' · 16~19 width · 20~23 height).
 * 규격이 그렇게 정해져 있어 라이브러리 없이 확정적으로 읽을 수 있다.
 *
 * 🔴 크기를 못 읽으면 null 이 아니라 **문제로 올린다.** "못 읽었으니 통과"는
 *    검사가 아니다 — PNG 가 아니거나 깨진 것이고, 둘 다 자산으로는 실패다.
 */
export function readPngSize(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buf.length < 24) return { error: '24바이트보다 작습니다 — PNG 가 아닙니다' }
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return { error: 'PNG 시그니처가 아닙니다' }
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return { error: '첫 청크가 IHDR 이 아닙니다' }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** `'192x96'` → `{ width, height }`. 형식이 아니면 null */
export function parsePixels(text) {
  const m = /^(\d+)x(\d+)$/.exec(String(text ?? ''))
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null
}

/**
 * manifest 가 선언한 주소를 저장소 경로로 옮긴다.
 *
 * 🔴 Next.js app 규약 파일(`app/icon.png` · `app/apple-icon.png`)은 `public/` 에 없다.
 *    빌드가 루트 주소로 내보낸다 — 그 두 개만 예외이고 나머지는 전부 `public/` 이다.
 *    이 대응을 적어 두지 않으면 "manifest 에는 있는데 파일이 없다"로 오탐이 난다.
 */
const APP_CONVENTION = { '/icon.png': 'src/app/icon.png', '/apple-icon.png': 'src/app/apple-icon.png' }
export function manifestSrcToPath(src) {
  return APP_CONVENTION[src] ?? (src.startsWith('/') ? join('public', src.slice(1)) : null)
}

/**
 * 검색 결과 favicon 조건 — Google 공식 문서는 정사각 · 최소 8×8 을 요구하고,
 * 여러 플랫폼에서 잘 보이도록 48×48 보다 큰 크기를 권장한다. 배수 조건은 없다.
 * 소란소란은 그 권장을 **제품 계약으로 올려** 48px 초과를 강제한다(채택 규격 96×96).
 *
 * 🔴 2026-09-21~09-29 에 탭 아이콘이 32×32 였다. 탭에서는 멀쩡히 보이지만 검색 결과용으로는
 *    권장 크기에 못 미친다 — 파일만 봐서는 아무도 모른다. 그래서 크기 자체를 검사로 고정한다.
 */
export function faviconSizeProblem(size) {
  if (size.width !== size.height) return `정사각이 아닙니다 (${size.width}x${size.height})`
  if (size.width <= 48) return `${size.width}px — 48 보다 커야 합니다`
  return null
}
const FAVICON_PATH = 'src/app/icon.png'

/**
 * PNG 를 픽셀로 푼다 — 8비트 RGB/RGBA · 비인터레이스만. 그 밖은 오류로 돌려준다.
 *
 * 🔴 이미지 라이브러리 없이 zlib 만 쓴다(머리말 원칙). 앱 아이콘은 생성기가 이 형식으로만 만든다.
 *    "못 풀었으니 통과"는 없다 — 형식이 다르면 문제로 올린다.
 */
export function decodePng(buf) {
  const head = readPngSize(buf)
  if (head.error) return head
  const bitDepth = buf[24]
  const colorType = buf[25]
  const interlace = buf[28]
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    return { error: `지원하지 않는 PNG 형식 (bitDepth ${bitDepth} · colorType ${colorType} · interlace ${interlace})` }
  }
  const idat = []
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len))
    if (type === 'IEND') break
    off += 12 + len
  }
  const { width, height } = head
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length !== height * (stride + 1)) return { error: 'IDAT 길이가 크기와 맞지 않습니다' }
  const data = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= channels ? data[y * stride + x - channels] : 0
      const b = y > 0 ? data[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0
      let p
      if (f === 0) p = 0
      else if (f === 1) p = a
      else if (f === 2) p = b
      else if (f === 3) p = (a + b) >> 1
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else return { error: `알 수 없는 필터 ${f}` }
      data[y * stride + x] = (v + p) & 0xff
    }
  }
  return { width, height, channels, data }
}

/** CRC-32 — 시험용 PNG 를 만들 때만 쓴다 (Node 20 에는 zlib.crc32 가 없다) */
function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

/** 시험용 PNG 인코더 — 줄마다 필터를 돌려 써서 decodePng 의 다섯 필터를 모두 지나게 한다 */
export function encodePng({ width, height, channels, data }) {
  const stride = width * channels
  const rows = []
  for (let y = 0; y < height; y++) {
    const f = y % 5
    const row = Buffer.alloc(stride + 1)
    row[0] = f
    for (let x = 0; x < stride; x++) {
      const v = data[y * stride + x]
      const a = x >= channels ? data[y * stride + x - channels] : 0
      const b = y > 0 ? data[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const p = [0, a, b, (a + b) >> 1, paeth][f]
      row[1 + x] = (v - p) & 0xff
    }
    rows.push(row)
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb))
    return Buffer.concat([len, tb, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 앱 아이콘 픽셀 판정 — 배경은 왼쪽 위 모서리 색이다.
 *
 *   opaque      알파가 없거나 전부 255
 *   edgeDiff    가장자리 1px 둘레가 배경색에서 벗어난 최대치 (채널별) — 작으면 끝까지 채움
 *   radius      내용(배경에서 CONTENT_TOL 넘게 벗어난 픽셀)의 중심에서 가장 먼 거리 / (한 변의 절반)
 *   island      배경이 로고 상자(배경에서 STROKE_TOL 넘게 벗어난 진한 획) 네 변 바로 바깥까지
 *               닿지 못한 변의 수. 흰 캔버스 위에 아이보리 네모를 깔고 그 안에 로고를 둔 그림
 *               (2026-09-29 판)은 바깥 배경이 네모 테두리에서 멈춰 로고 상자에 닿지 못한다.
 *               🔴 상자를 CONTENT_TOL 로 잡으면 아이보리 네모 자체가 내용으로 세어져 섬을 놓친다
 *                  (실제 09-29 파일로 확인). 그래서 섬은 진한 획 기준으로 본다.
 */
export const EDGE_TOL = 8
export const BG_TOL = 12
export const CONTENT_TOL = 24
export const STROKE_TOL = 64
export const MASKABLE_SAFE_RADIUS = 0.8
export function analyzeIcon({ width: w, height: h, channels: ch, data }) {
  const px = (x, y) => data.subarray((y * w + x) * ch, (y * w + x) * ch + ch)
  const bg = px(0, 0)
  const diff = (x, y) => {
    const p = px(x, y)
    return Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]))
  }
  let opaque = true
  if (ch === 4) for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break }

  let edgeDiff = 0
  for (let x = 0; x < w; x++) edgeDiff = Math.max(edgeDiff, diff(x, 0), diff(x, h - 1))
  for (let y = 0; y < h; y++) edgeDiff = Math.max(edgeDiff, diff(0, y), diff(w - 1, y))

  let radius = 0
  const box = { x0: w, y0: h, x1: -1, y1: -1 }
  const half = w / 2
  let hasContent = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = diff(x, y)
      if (d <= CONTENT_TOL) continue
      hasContent = true
      radius = Math.max(radius, Math.hypot(x + 0.5 - half, y + 0.5 - h / 2) / half)
      if (d <= STROKE_TOL) continue
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y)
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y)
    }
  }

  // 가장자리에서 배경색으로 이어진 영역을 칠한다
  const reached = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h || reached[y * w + x] || diff(x, y) > BG_TOL) return
    reached[y * w + x] = 1
    stack.push(x, y)
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop()
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }
  let island = 0
  if (box.x1 >= 0) {
    const rowHit = (y, from, to) => { for (let x = from; x <= to; x++) if (reached[y * w + x]) return true; return false }
    const colHit = (x, from, to) => { for (let y = from; y <= to; y++) if (reached[y * w + x]) return true; return false }
    if (box.y0 > 0 && !rowHit(box.y0 - 1, box.x0, box.x1)) island++
    if (box.y1 < h - 1 && !rowHit(box.y1 + 1, box.x0, box.x1)) island++
    if (box.x0 > 0 && !colHit(box.x0 - 1, box.y0, box.y1)) island++
    if (box.x1 < w - 1 && !colHit(box.x1 + 1, box.y0, box.y1)) island++
  }
  return { opaque, edgeDiff, radius, island, hasContent, bg: [bg[0], bg[1], bg[2]] }
}

/** 판정 → 문제 목록. maskable 이면 안전 원도 본다 */
export function iconPixelProblems(a, { maskable }) {
  const out = []
  if (!a.opaque) out.push('투명 픽셀이 있습니다 — 불투명이어야 합니다')
  if (a.edgeDiff > EDGE_TOL) out.push(`가장자리가 배경색으로 채워져 있지 않습니다 (최대 차이 ${a.edgeDiff})`)
  if (!a.hasContent) out.push('내용이 없습니다')
  if (a.island) out.push(`내부 네모 섬이 있습니다 — 배경이 내용 상자 ${a.island}개 변에 닿지 못합니다`)
  if (maskable && a.radius > MASKABLE_SAFE_RADIUS) {
    out.push(`내용이 maskable 안전 원 밖입니다 (반지름 비 ${a.radius.toFixed(3)} > ${MASKABLE_SAFE_RADIUS})`)
  }
  return out
}

/**
 * 우나어 3원 심볼 — 소란소란에 2026-08-26~09-07 동안 /icon.png · /apple-icon.png 로 있던 재렌더본과
 * 우나어 원본 아이콘들의 SHA-256. 어느 것도 저장소에 다시 들어오면 안 된다.
 */
export const RETIRED_FOREIGN_ICON_SHA256 = new Set([
  '72674b12272f214825e752f7fd64b272caf49fb4c295847044bdeb3d4d1821c6',
  '229160d4f0c5ae5ac842492540ecafbd538a0c3f4210c9c93693f57bd4a065a9',
  'bf56c90c6354aa00470d10fb8a2ab66d149f5292adb84b173c9af7a3d9eab4ad',
  '16bac3bb424c730c8b166c46661c21b42963c53a5212dce421d96a45f8aaab73',
  '88f013d930f202de0d2b9e2e5bb60a0f12bc91db457e251f9d9d6583d11efdbb',
])

/** manifest 가 담아야 하는 아이콘 — 이 넷이 정확히 있어야 한다 */
export const REQUIRED_MANIFEST_ICONS = [
  { src: '/brand/icon-192.png', sizes: '192x192', purpose: 'any' },
  { src: '/brand/icon-512.png', sizes: '512x512', purpose: 'any' },
  { src: '/brand/icon-maskable-192.png', sizes: '192x192', purpose: 'maskable' },
  { src: '/brand/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
]
/** 1년 immutable 캐시인 쿼리 없는 Next.js 규약 주소 — manifest 에 있으면 옛 그림이 설치 아이콘으로 나온다 */
export const FORBIDDEN_MANIFEST_SRC = ['/icon.png', '/apple-icon.png']

/** manifest 아이콘 구성 판정 */
export function manifestIconSetProblems(icons) {
  const out = []
  for (const ic of icons) {
    const path = String(ic.src ?? '').split(/[?#]/)[0]
    if (FORBIDDEN_MANIFEST_SRC.includes(path)) out.push(`쿼리 없는 1년 캐시 주소를 선언합니다: ${ic.src}`)
    if (ic.purpose !== 'any' && ic.purpose !== 'maskable') {
      out.push(`purpose 는 'any' 또는 'maskable' 이어야 합니다: ${ic.src} → '${ic.purpose}'`)
    }
  }
  for (const want of REQUIRED_MANIFEST_ICONS) {
    if (!icons.some((ic) => ic.src === want.src && ic.sizes === want.sizes && ic.purpose === want.purpose)) {
      out.push(`필수 아이콘 누락: ${want.src} ${want.sizes} purpose '${want.purpose}'`)
    }
  }
  return out
}

/** manifest.ts 의 icons 배열에서 { src, sizes, type, purpose } 를 읽는다 */
export function readManifestIcons(text) {
  const sf = ts.createSourceFile('manifest.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const icons = []
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'icons' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const el of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue
        const o = {}
        for (const pr of el.properties) {
          if (!ts.isPropertyAssignment(pr) || !ts.isIdentifier(pr.name)) continue
          if (ts.isStringLiteral(pr.initializer)) o[pr.name.text] = pr.initializer.text
        }
        icons.push(o)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return icons
}

/**
 * 구 텍스트 워드마크 계약이 **코드에** 남아 있는지 본다.
 *
 * 🔴 주석은 세지 않는다. 옛 정책을 시점과 함께 남긴 서술은 지워야 할 것이 아니라
 *    남겨야 할 것이다(운영 정본과 같은 규칙). 지워야 하는 것은 **살아 있는 참조**다 —
 *    import 로 끌어다 쓰거나 아직 export 하고 있는 상태를 말한다.
 */
const RETIRED_WORDMARK = ['BRAND_NAME_HEAD', 'BRAND_NAME_TAIL', 'BRAND_NAME_SPLIT_AT']
export function findRetiredWordmark(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const el of node.importClause.namedBindings.elements) {
        if (RETIRED_WORDMARK.includes(el.name.text)) hits.push({ rel, name: el.name.text, how: 'import' })
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && RETIRED_WORDMARK.includes(d.name.text)) {
          hits.push({ rel, name: d.name.text, how: 'export' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/**
 * brand-logo.ts 의 표시 상자를 읽는다.
 *
 * 🔴 파일은 표시 상자의 **정확히 2배**여야 한다. 고밀도 화면에서 흐려지지 않게
 *    2배로 두기로 한 계약이고, 한쪽만 바뀌면 흐려지거나 쓸데없이 무거워진다.
 *    주석으로 적어 두면 어긋나도 아무도 모른다 — 그래서 검사가 센다.
 */
export function readLogoDisplaySize(text) {
  const sf = ts.createSourceFile('brand-logo.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let out = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND_LOGO' &&
      node.initializer
    ) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) {
        const o = {}
        for (const pr of init.properties) {
          if (!ts.isPropertyAssignment(pr) || !ts.isIdentifier(pr.name)) continue
          if (ts.isNumericLiteral(pr.initializer)) o[pr.name.text] = Number(pr.initializer.text)
          else if (ts.isStringLiteral(pr.initializer)) o[pr.name.text] = pr.initializer.text
        }
        if (o.width && o.height) out = o
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 파일 자산이 PNG 인지 — 확장자로 본다 */
export const isPng = (path) => path.toLowerCase().endsWith('.png')

/**
 * OG 가 런타임에 읽는 로고 경로 — `readFileSync(join(process.cwd(), '<여기>'))` 의 리터럴.
 *
 * 🔴 왜 리터럴을 따로 확인하는가
 *    이 경로는 상수가 아니라 **문자열로 박혀 있다.** 파일 추적기가 상수를 따라가지
 *    못해서 그렇게 둔 것인데(brand-logo-image.ts 머리말), 그 대가로 `brand-logo.ts` 와
 *    갈라질 수 있다. 갈라지면 OG 만 조용히 빈 로고가 된다.
 */
export function readRuntimeLogoPath(text) {
  const m = /readFileSync\(\s*join\(\s*process\.cwd\(\)\s*,\s*'([^']+)'\s*\)\s*\)/.exec(text)
  return m ? m[1] : null
}

/**
 * 빌드가 그 파일을 서버 번들에 올리도록 적어 두었는가.
 *
 * 🔴 **이 항목이 빠지면 로컬은 통과하고 배포만 깨진다.** 실제로 그렇게 깨졌다 —
 *    `.nft.json` 에 로고가 없었다. 그래서 설정의 존재를 검사로 고정한다.
 * 🔴 이 검사는 "적혀 있는가" 만 본다. 키가 실제 route 와 맞는지는 빌드 뒤
 *    `.nft.json` 을 열어 확인한다 — 어긋난 키는 조용히 아무것도 하지 않는다.
 */
export function tracingIncludesLogo(configText, logoPath, routeKeys) {
  const missing = []
  for (const key of routeKeys) {
    const re = new RegExp(`'${key.replace(/[[\]/]/g, (c) => '\\' + c)}'\\s*:\\s*\\[[^\\]]*${logoPath.replace(/[./]/g, (c) => '\\' + c)}`)
    if (!re.test(configText)) missing.push(key)
  }
  return missing
}

/** brand-assets.ts 의 BRAND_ASSETS 배열에서 각 항목을 읽는다 */
export function readManifest(text) {
  const sf = ts.createSourceFile('brand-assets.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const assets = []

  const literal = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    // 문자열 이어붙이기(+)는 note 에서 쓴다 — 합쳐서 돌려준다
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = literal(node.left)
      const r = literal(node.right)
      if (typeof l === 'string' && typeof r === 'string') return l + r
    }
    return undefined
  }

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND_ASSETS' &&
      node.initializer
    ) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isArrayLiteralExpression(init)) {
        for (const el of init.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue
          const obj = {}
          for (const p of el.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
            const v = literal(p.initializer)
            if (v !== undefined) obj[p.name.text] = v
          }
          if (obj.path) assets.push(obj)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return assets
}

/** 구조·중복·필수 category 검사. 파일 시스템을 건드리지 않으므로 self-test 가 그대로 쓴다 */
export function validate(assets) {
  const problems = []

  if (!assets.length) problems.push('BRAND_ASSETS 배열을 찾을 수 없거나 비어 있습니다')

  for (const a of assets) {
    for (const f of REQUIRED_FIELDS) {
      if (a[f] === undefined) problems.push(`필드 누락: ${a.path ?? '(경로 없음)'} 에 ${f} 가 없습니다`)
    }
    if (a.category !== undefined && !CATEGORIES.includes(a.category)) {
      problems.push(`알 수 없는 category: ${a.path} → '${a.category}'`)
    }
    if (a.kind !== undefined && a.kind !== 'file' && a.kind !== 'code') {
      problems.push(`알 수 없는 kind: ${a.path} → '${a.kind}'`)
    }
    // 🔴 PNG 파일 자산은 크기를 적는다 — 적지 않으면 아래 픽셀 대조가 통째로 건너뛰어진다
    if (a.kind === 'file' && a.path && isPng(a.path)) {
      if (a.pixels === undefined) problems.push(`pixels 누락: ${a.path} — PNG 파일 자산은 '가로x세로' 를 적습니다`)
      else if (!parsePixels(a.pixels)) problems.push(`pixels 형식 오류: ${a.path} → '${a.pixels}' (예: '180x180')`)
    }
  }

  const seen = new Set()
  for (const a of assets) {
    if (seen.has(a.path)) problems.push(`경로 중복: ${a.path}`)
    seen.add(a.path)
  }

  const present = new Set(assets.map((a) => a.category))
  for (const c of REQUIRED_CATEGORIES) {
    if (!present.has(c)) problems.push(`필수 category 누락: ${c}`)
  }

  return problems
}

/** category 별 개수를 프로그램으로 센다 — 눈으로 더하지 않는다 */
export function countByCategory(assets) {
  const out = new Map(CATEGORIES.map((c) => [c, 0]))
  for (const a of assets) out.set(a.category, (out.get(a.category) ?? 0) + 1)
  return out
}

/** self-test — 파일을 만들지 않고 문자열만으로 검사기 자신을 확인한다 */
function selfTest() {
  // 🔴 표본도 실제 규칙을 지켜야 한다 — PNG 파일 자산이므로 pixels 를 갖는다.
  //    표본이 실제보다 느슨하면 검사가 아니라 검사를 피하는 장치가 된다.
  const entry = (path, category, extra = '') =>
    `{ path: '${path}', kind: 'file', category: '${category}', use: 'x', replace: false, locked: false, pixels: '1x1', note: 'n'${extra} }`
  const full = REQUIRED_CATEGORIES.map((c, i) => entry(`p/${i}.png`, c)).join(',\n      ')
  const wrap = (body) => `export const BRAND_ASSETS = [\n      ${body}\n    ] as const`

  const parsed = readManifest(
    wrap(
      `{ path: 'a/b.png', kind: 'file', category: 'app-icon', use: 'x', replace: true, locked: false, note: '앞' + '뒤' }`,
    ),
  )

  const checks = [
    ['배열 항목을 읽는다', parsed.length === 1],
    ['경로를 읽는다', parsed[0].path === 'a/b.png'],
    ['boolean 을 읽는다', parsed[0].replace === true],
    ['이어붙인 문자열을 합친다', parsed[0].note === '앞뒤'],
    ['category 를 읽는다', parsed[0].category === 'app-icon'],
    ['필수 category 가 다 있으면 문제 0', validate(readManifest(wrap(full))).length === 0],
    [
      '필수 category 누락을 잡는다',
      validate(readManifest(wrap(full.split(',\n      ').slice(1).join(',\n      ')))).some((p) =>
        p.includes('필수 category 누락'),
      ),
    ],
    [
      '경로 중복을 잡는다',
      validate(
        readManifest(wrap([full, entry('p/0.png', 'app-icon')].join(',\n      '))),
      ).some((p) => p.includes('경로 중복')),
    ],
    [
      '알 수 없는 category 를 잡는다',
      validate(readManifest(wrap([full, entry('p/z.png', 'nope')].join(',\n      ')))).some((p) =>
        p.includes('알 수 없는 category'),
      ),
    ],
    [
      '필드 누락을 잡는다',
      validate(
        readManifest(wrap(`{ path: 'x.png', kind: 'file', category: 'logo', use: 'u', replace: false }`)),
      ).some((p) => p.includes('필드 누락')),
    ],
    [
      'category 합계가 엔트리 수와 같다 (이중 계산 방지)',
      (() => {
        const a = readManifest(wrap(full))
        return [...countByCategory(a).values()].reduce((x, y) => x + y, 0) === a.length
      })(),
    ],
    ['빈 manifest 는 문제로 잡는다', validate(readManifest('export const BRAND_ASSETS = [] as const')).length > 0],

    // ── PNG 헤더 판독 ──
    (() => {
      // 32×32 PNG 헤더를 손으로 만든다 — 파일을 만들지 않는다
      const b = Buffer.alloc(24)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
      b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(32, 16); b.writeUInt32BE(48, 20)
      const r = readPngSize(b)
      return ['PNG 헤더에서 크기를 읽는다', r.width === 32 && r.height === 48]
    })(),
    ['PNG 가 아니면 오류를 돌려준다', Boolean(readPngSize(Buffer.from('not a png at all......')).error)],
    ['너무 짧은 파일도 오류다', Boolean(readPngSize(Buffer.alloc(8)).error)],
    ['favicon 96×96 은 통과', faviconSizeProblem({ width: 96, height: 96 }) === null],
    ['🔴 favicon 32×32 는 잡는다', faviconSizeProblem({ width: 32, height: 32 }) !== null],
    ['🔴 favicon 48×48 은 잡는다 (48 보다 커야 한다)', faviconSizeProblem({ width: 48, height: 48 }) !== null],
    ['favicon 100×100 은 통과 (배수 조건 없음)', faviconSizeProblem({ width: 100, height: 100 }) === null],
    ['🔴 favicon 96×48 은 잡는다 (정사각 아님)', faviconSizeProblem({ width: 96, height: 48 }) !== null],
    ["pixels 문자열을 읽는다", parsePixels('192x96')?.width === 192 && parsePixels('192x96')?.height === 96],
    ['pixels 형식 오류를 잡는다', parsePixels('192 x 96') === null && parsePixels('big') === null],
    [
      '🔴 PNG 파일 자산에 pixels 가 없으면 잡는다',
      validate(readManifest(wrap(`{ path: 'a/b.png', kind: 'file', category: 'logo', use: 'u', replace: false, locked: false, note: 'n' }`)))
        .some((x) => x.includes('pixels 누락')),
    ],
    [
      'code 진입점에는 pixels 를 요구하지 않는다',
      !validate(readManifest(wrap(`{ path: 'a/b.tsx', kind: 'code', category: 'logo', use: 'u', replace: false, locked: false, note: 'n' }`)))
        .some((x) => x.includes('pixels')),
    ],

    // ── manifest 아이콘 ──
    (() => {
      const icons = readManifestIcons(
        `export default function m(){return{icons:[{ src: '/icon.png', sizes: '32x32', type: 'image/png' }]}}`,
      )
      return ['manifest icons 를 읽는다', icons.length === 1 && icons[0].sizes === '32x32']
    })(),
    [
      'app 규약 주소를 저장소 경로로 옮긴다',
      manifestSrcToPath('/icon.png') === 'src/app/icon.png' &&
        manifestSrcToPath('/brand/icon-192.png') === join('public', 'brand/icon-192.png'),
    ],
    (() => {
      const icons = readManifestIcons(
        `export default function m(){return{icons:[{ src: '/a.png', sizes: '1x1', type: 'image/png', purpose: 'maskable' }]}}`,
      )
      return ['manifest icons 의 purpose 를 읽는다', icons[0]?.purpose === 'maskable']
    })(),
    ['필수 아이콘 4종이 맞으면 문제 0', manifestIconSetProblems(REQUIRED_MANIFEST_ICONS).length === 0],
    [
      '🔴 쿼리 없는 /icon.png 를 잡는다',
      manifestIconSetProblems([...REQUIRED_MANIFEST_ICONS, { src: '/icon.png', sizes: '96x96', purpose: 'any' }])
        .some((x) => x.includes('1년 캐시')),
    ],
    [
      '🔴 /apple-icon.png 를 잡는다',
      manifestIconSetProblems([...REQUIRED_MANIFEST_ICONS, { src: '/apple-icon.png', sizes: '180x180', purpose: 'any' }])
        .some((x) => x.includes('1년 캐시')),
    ],
    [
      '🔴 purpose 없는 아이콘을 잡는다',
      manifestIconSetProblems([...REQUIRED_MANIFEST_ICONS, { src: '/brand/x.png', sizes: '1x1' }])
        .some((x) => x.includes('purpose')),
    ],
    [
      '🔴 maskable 이 빠지면 잡는다',
      manifestIconSetProblems(REQUIRED_MANIFEST_ICONS.filter((x) => x.purpose === 'any'))
        .some((x) => x.includes('필수 아이콘 누락')),
    ],

    // ── 아이콘 픽셀 ──
    ...(() => {
      // 섬 색은 2026-09-29 판 실측(252,241,224)이다 — 흰 바탕과 24 넘게 달라 "내용"으로도 세어지는 실제 조건
      const IVORY = [253, 248, 232], WHITE = [255, 255, 255], ORANGE = [250, 70, 1], ISLAND = [252, 241, 224]
      const make = (n, paint, channels = 3) => {
        const data = Buffer.alloc(n * n * channels)
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const c = paint(x, y)
          for (let k = 0; k < channels; k++) data[(y * n + x) * channels + k] = c[k] ?? 255
        }
        return { width: n, height: n, channels, data }
      }
      const inBox = (x, y, a, b) => x >= a && x <= b && y >= a && y <= b
      const good = make(40, (x, y) => (inBox(x, y, 12, 27) ? ORANGE : IVORY))
      const wide = make(40, (x, y) => (inBox(x, y, 2, 37) ? ORANGE : IVORY))
      const island = make(40, (x, y) => (inBox(x, y, 14, 25) ? ORANGE : inBox(x, y, 6, 33) ? ISLAND : WHITE))
      const holey = make(40, (x, y) => (x === 0 && y === 0 ? [...IVORY, 0] : inBox(x, y, 12, 27) ? ORANGE : IVORY), 4)
      const edged = make(40, (x, y) => (x === 39 && y === 20 ? ORANGE : inBox(x, y, 12, 27) ? ORANGE : IVORY))
      const roundTrip = decodePng(encodePng(good))
      const has = (img, opts, word) => iconPixelProblems(analyzeIcon(img), opts).some((x) => x.includes(word))
      return [
        ['PNG 다섯 필터를 모두 왕복한다', !roundTrip.error && roundTrip.data.equals(good.data)],
        ['꽉 채운 아이콘은 maskable 로도 문제 0', iconPixelProblems(analyzeIcon(good), { maskable: true }).length === 0],
        ['🔴 안전 원 밖 내용을 maskable 에서 잡는다', has(wide, { maskable: true }, '안전 원')],
        ['같은 그림도 any 에서는 안전 원을 묻지 않는다', !has(wide, { maskable: false }, '안전 원')],
        ['🔴 흰 캔버스 위 네모 섬을 잡는다 (2026-09-29 판)', has(island, { maskable: false }, '네모 섬')],
        ['🔴 투명 픽셀을 잡는다', has(holey, { maskable: false }, '투명')],
        ['🔴 가장자리 미채움을 잡는다', has(edged, { maskable: false }, '가장자리')],
        ['RGB 가 아닌 PNG 는 오류다', Boolean(decodePng(Buffer.concat([encodePng(good).subarray(0, 25), Buffer.from([3]), encodePng(good).subarray(26)])).error)],
      ]
    })(),

    // ── 구 워드마크 계약 ──
    [
      '🔴 구 워드마크 import 를 잡는다',
      findRetiredWordmark('x.tsx', "import { BRAND_NAME_HEAD } from '@/lib/brand-name'").length === 1,
    ],
    [
      '🔴 구 워드마크 export 를 잡는다',
      findRetiredWordmark('x.ts', 'export const BRAND_NAME_SPLIT_AT = 2').length === 1,
    ],
    [
      '주석·역사 기록은 잡지 않는다',
      findRetiredWordmark('x.ts', '// 이전에는 BRAND_NAME_HEAD 가 있었다\n/* BRAND_NAME_TAIL */').length === 0,
    ],

    // ── 로고 표시 상자 ──
    (() => {
      const o = readLogoDisplaySize("export const BRAND_LOGO = { src: '/a.png', width: 96, height: 48 } as const")
      return ['brand-logo.ts 의 표시 상자를 읽는다', o?.width === 96 && o?.height === 48]
    })(),
    ['BRAND_LOGO 가 없으면 null', readLogoDisplaySize('export const OTHER = { width: 1, height: 2 }') === null],

    // ── OG 런타임 경로 · 파일 추적 ──
    [
      'OG 가 읽는 리터럴 경로를 읽는다',
      readRuntimeLogoPath("const b = readFileSync(join(process.cwd(), 'public/brand/x.png'))") === 'public/brand/x.png',
    ],
    ['리터럴이 없으면 null', readRuntimeLogoPath('const b = readFileSync(somewhereElse)') === null],
    [
      '파일 추적 설정이 있으면 빠진 route 0',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/brand/x.png'], '/a/[b]/og': ['./public/brand/x.png'] }",
        './public/brand/x.png',
        ['/og', '/a/[b]/og'],
      ).length === 0,
    ],
    [
      '🔴 한 route 만 빠져도 잡는다',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/brand/x.png'] }",
        './public/brand/x.png',
        ['/og', '/a/[b]/og'],
      ).join() === '/a/[b]/og',
    ],
    [
      '🔴 다른 파일을 적어 두면 잡는다',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/other.png'] }",
        './public/brand/x.png',
        ['/og'],
      ).length === 1,
    ],
  ]

  const failed = checks.filter(([, ok]) => !ok).map(([why]) => why)
  if (failed.length) {
    console.error('🔴 브랜드 자산 검사 self-test 실패 — 검사기 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  return checks.length
}

const selfTestCount = selfTest()

if (!existsSync(MANIFEST)) {
  console.error('브랜드 자산 manifest 가 없습니다: src/lib/brand-assets.ts')
  process.exit(1)
}

const assets = readManifest(readFileSync(MANIFEST, 'utf8'))

const problems = validate(assets)
if (problems.length) {
  console.error('브랜드 자산 manifest 구조에 문제가 있습니다:\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const missing = []
const notFile = []
for (const a of assets) {
  const abs = join(ROOT, a.path)
  if (!existsSync(abs)) {
    missing.push(a)
    continue
  }
  if (a.kind === 'file' && !statSync(abs).isFile()) notFile.push(a)
}

if (missing.length || notFile.length) {
  console.error('브랜드 자산 manifest 가 실제 파일과 어긋납니다:\n')
  for (const a of missing) console.error(`  없음: ${a.path}   (${a.use})`)
  for (const a of notFile) console.error(`  파일이 아님: ${a.path}   (${a.use})`)
  console.error('\n경로를 옮겼다면 src/lib/brand-assets.ts 를 함께 고치세요.')
  process.exit(1)
}

// ── 🔴 PNG 자산의 실제 픽셀을 잰다 — note 의 서술을 믿지 않는다 ──
const pixelProblems = []
const pngSize = new Map()
for (const a of assets) {
  if (a.kind !== 'file' || !isPng(a.path)) continue
  const got = readPngSize(readFileSync(join(ROOT, a.path)))
  if (got.error) { pixelProblems.push(`${a.path} — ${got.error}`); continue }
  pngSize.set(a.path, got)
  const want = parsePixels(a.pixels)
  if (want.width !== got.width || want.height !== got.height) {
    pixelProblems.push(`${a.path} — 적힌 값 ${a.pixels} · 실제 ${got.width}x${got.height}`)
  }
}

// ── 🔴 탭·검색 favicon 이 정사각 · 48px 초과인가 (Google 권장을 올린 제품 계약) ──
{
  const got = pngSize.get(FAVICON_PATH)
  if (!got) pixelProblems.push(`${FAVICON_PATH} — 자산 목록에 없거나 크기를 재지 못했습니다`)
  else {
    const why = faviconSizeProblem(got)
    if (why) pixelProblems.push(`${FAVICON_PATH} — 검색 favicon 조건 위반: ${why}`)
  }
}

// ── 🔴 manifest 가 선언한 아이콘이 실제와 맞는가 ──
const MANIFEST_TS = join(ROOT, 'src/app/manifest.ts')
const icons = readManifestIcons(readFileSync(MANIFEST_TS, 'utf8'))
const iconProblems = []
if (!icons.length) iconProblems.push('manifest.ts 에서 icons 배열을 찾지 못했습니다')
const seenIconSrc = new Set()
for (const ic of icons) {
  const rel = manifestSrcToPath(ic.src)
  if (!rel) { iconProblems.push(`주소가 '/' 로 시작하지 않습니다: ${ic.src}`); continue }
  if (seenIconSrc.has(ic.src)) iconProblems.push(`manifest 아이콘 주소 중복: ${ic.src}`)
  seenIconSrc.add(ic.src)
  if (!existsSync(join(ROOT, rel))) { iconProblems.push(`파일이 없습니다: ${ic.src} → ${rel}`); continue }
  if (!isPng(rel) || ic.type !== 'image/png') {
    iconProblems.push(`MIME·확장자 불일치: ${ic.src} → type '${ic.type}'`)
  }
  const got = pngSize.get(rel) ?? readPngSize(readFileSync(join(ROOT, rel)))
  const want = parsePixels(ic.sizes)
  if (!want) iconProblems.push(`sizes 형식 오류: ${ic.src} → '${ic.sizes}'`)
  else if (got.error) iconProblems.push(`${ic.src} — ${got.error}`)
  else if (want.width !== got.width || want.height !== got.height) {
    iconProblems.push(`크기 불일치: ${ic.src} — 선언 ${ic.sizes} · 실제 ${got.width}x${got.height}`)
  }
  // 🔴 manifest 에만 있고 자산 목록에 없으면, 리브랜딩 당일 이 아이콘만 남는다
  if (!assets.some((a) => a.path === rel)) {
    iconProblems.push(`자산 목록에 없습니다: ${ic.src} → ${rel} (brand-assets.ts 에 추가하세요)`)
  }
}
iconProblems.push(...manifestIconSetProblems(icons))

// ── 🔴 manifest 아이콘 픽셀 — 크기만이 아니라 그려진 면을 잰다 ──
const iconPixels = []
for (const ic of icons) {
  const rel = manifestSrcToPath(ic.src)
  if (!rel || !existsSync(join(ROOT, rel))) continue
  const img = decodePng(readFileSync(join(ROOT, rel)))
  if (img.error) { iconProblems.push(`${ic.src} — ${img.error}`); continue }
  const a = analyzeIcon(img)
  iconPixels.push({ ic, a })
  for (const why of iconPixelProblems(a, { maskable: ic.purpose === 'maskable' })) iconProblems.push(`${ic.src} — ${why}`)
}

// ── 🔴 우나어 3원 심볼 해시가 다시 들어오지 않았는가 ──
const foreignHits = []
{
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (/\.(png|ico|svg|webp|jpe?g)$/i.test(name)) {
        const sha = createHash('sha256').update(readFileSync(abs)).digest('hex')
        if (RETIRED_FOREIGN_ICON_SHA256.has(sha)) foreignHits.push(abs.slice(ROOT.length + 1))
      }
    }
  }
  walk(join(ROOT, 'public'))
  walk(join(ROOT, 'src'))
}
for (const rel of foreignHits) iconProblems.push(`우나어 3원 심볼 자산이 있습니다: ${rel}`)

// ── 🔴 가로형 로고는 표시 상자의 정확히 2배여야 한다 ──
const logoProblems = []
{
  const display = readLogoDisplaySize(readFileSync(join(ROOT, 'src/lib/brand-logo.ts'), 'utf8'))
  if (!display) logoProblems.push('src/lib/brand-logo.ts 에서 BRAND_LOGO 표시 상자를 읽지 못했습니다')
  else {
    const rel = 'public/brand/soransoran-logo.png'
    const got = pngSize.get(rel)
    if (!got) logoProblems.push(`${rel} 크기를 재지 못했습니다`)
    else if (got.width !== display.width * 2 || got.height !== display.height * 2) {
      logoProblems.push(
        `${rel} — 표시 ${display.width}x${display.height} 의 2배(${display.width * 2}x${display.height * 2})여야 하는데 ` +
          `실제는 ${got.width}x${got.height} 입니다`,
      )
    }
    if (display.src !== '/' + rel.replace(/^public\//, '')) {
      logoProblems.push(`BRAND_LOGO.src '${display.src}' 가 등록 경로 ${rel} 와 맞지 않습니다`)
    }

    // 🔴 OG 가 런타임에 읽는 리터럴이 같은 파일을 가리키는가
    const runtimePath = readRuntimeLogoPath(readFileSync(join(ROOT, 'src/lib/brand-logo-image.ts'), 'utf8'))
    if (runtimePath === null) {
      logoProblems.push('src/lib/brand-logo-image.ts 에서 OG 가 읽는 로고 경로를 찾지 못했습니다')
    } else if (runtimePath !== rel) {
      logoProblems.push(`OG 가 읽는 경로 '${runtimePath}' 가 등록 경로 ${rel} 와 다릅니다`)
    }

    // 🔴 그 파일이 서버 번들에 올라가도록 적어 두었는가 (없으면 배포에서만 깨진다)
    const OG_ROUTES = ['/opengraph-image', '/community/[boardSlug]/[postId]/opengraph-image']
    const missingTrace = tracingIncludesLogo(
      readFileSync(join(ROOT, 'next.config.js'), 'utf8'),
      './' + rel,
      OG_ROUTES,
    )
    for (const key of missingTrace) {
      logoProblems.push(
        `next.config.js 의 outputFileTracingIncludes 에 '${key}' → './${rel}' 가 없습니다 ` +
          '(없으면 서버리스 함수에 파일이 빠져 배포에서만 로고가 사라집니다)',
      )
    }
  }
}

// ── 🔴 구 텍스트 워드마크 계약이 코드에 남아 있지 않은가 ──
const retired = []
{
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (/\.(ts|tsx)$/.test(name)) {
        retired.push(...findRetiredWordmark(abs.slice(ROOT.length + 1), readFileSync(abs, 'utf8')))
      }
    }
  }
  walk(join(ROOT, 'src'))
}

if (pixelProblems.length || iconProblems.length || logoProblems.length || retired.length) {
  console.error('브랜드 자산이 선언과 어긋납니다:\n')
  for (const x of pixelProblems) console.error(`  픽셀 불일치: ${x}`)
  for (const x of iconProblems) console.error(`  manifest 아이콘: ${x}`)
  for (const x of logoProblems) console.error(`  가로형 로고: ${x}`)
  for (const x of retired) console.error(`  구 워드마크 계약 잔존: ${x.rel} 에서 ${x.name} 을 ${x.how} 합니다`)
  console.error('\n🔴 통과시키려고 선언을 파일에 맞추지 마세요 — 어느 쪽이 맞는지 먼저 정합니다.')
  process.exit(1)
}

// ── 집계는 전부 프로그램이 센다. 사람이 더하지 않는다 ──
const byCategory = countByCategory(assets)
const categoryTotal = [...byCategory.values()].reduce((a, b) => a + b, 0)
const byKind = { file: assets.filter((a) => a.kind === 'file').length, code: assets.filter((a) => a.kind === 'code').length }
const mustReplace = assets.filter((a) => a.replace)
const locked = assets.filter((a) => a.locked)

console.log(
  `브랜드 자산 manifest 통과 — 총 ${assets.length}건 전부 존재 (self-test ${selfTestCount}건 통과)`,
)
console.log('')
console.log(`category 별 (배타적 분류 · 합계 ${categoryTotal} = 총 ${assets.length}):`)
for (const [c, n] of byCategory) console.log(`  ${String(n).padStart(2)}  ${c}`)
console.log('')
console.log('겹치는 축 (위 분류와 따로 세지 말 것):')
console.log(`  kind        file ${byKind.file} · code ${byKind.code}`)
console.log(`  replace     ${mustReplace.length}건 — 리브랜딩 시 사람이 새로 만들어야 한다`)
for (const a of mustReplace) console.log(`    🔁 ${a.path}`)
console.log(`  locked      ${locked.length}건 — 외부 브랜드, 손대지 않는다`)
for (const a of locked) console.log(`    🔒 ${a.path}`)
console.log('')
console.log(`PNG 실측 ${pngSize.size}건 — 전부 적힌 크기와 일치`)
for (const [rel, s] of pngSize) console.log(`    ${s.width}x${s.height}  ${rel}`)
console.log(`검색 favicon ${FAVICON_PATH} — 정사각 · 48px 초과`)
console.log(`manifest 아이콘 ${icons.length}건 — 경로·크기·MIME·purpose 전부 실제와 일치 · 쿼리 없는 /icon.png·/apple-icon.png 0건`)
for (const { ic, a } of iconPixels) {
  console.log(
    `    ${ic.purpose.padEnd(8)} ${ic.sizes.padEnd(8)} 불투명 ${a.opaque ? '예' : '아니오'} · 가장자리 차이 ${a.edgeDiff} · ` +
      `네모 섬 ${a.island} · 내용 반지름 비 ${a.radius.toFixed(3)}${ic.purpose === 'maskable' ? ` (≤ ${MASKABLE_SAFE_RADIUS})` : ''}  ${ic.src}`,
  )
}
console.log(`우나어 3원 심볼 해시 — public/ · src/ 에서 0건`)
console.log('가로형 로고 — 파일이 표시 상자의 정확히 2배 (@2x)')
console.log('가로형 로고 — 화면 주소 · OG 런타임 경로 · 파일 추적 설정이 모두 같은 파일을 가리킨다')
console.log('구 텍스트 워드마크 계약(HEAD·TAIL·SPLIT_AT) 코드 잔존 0건')
console.log('')
console.log('🔴 이 검사는 manifest 에 적힌 것만 본다 —')
console.log('   목록에 넣지 않은 새 자산, 이미지 **안에** 무엇이 그려져 있는지는 잡지 못한다.')
console.log('   크기는 재지만 "아이콘이 원본 Favicon.png 를 그대로 줄인 것인가" 는')
console.log('   node scripts/generate-app-icons.mjs <원본 경로> 가 원본과 대조한다 (원본은 저장소 밖).')

if (process.argv.includes('--verbose')) {
  console.log('')
  for (const a of assets) {
    const mark = a.locked ? '🔒' : a.replace ? '🔁' : '  '
    console.log(`  ${mark} [${a.category}/${a.kind}] ${a.path}`)
    console.log(`      ${a.use}`)
    console.log(`      ${a.note}`)
  }
}
