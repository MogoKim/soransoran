/**
 * WebP 크기 판독 — **readWebpSize 의 정의는 여기 한 곳이다** (S1 C3 · 2026-11-09).
 *
 * 앞판: QA CLI(`magazine-qa.mjs`)가 정의·export 하고 `lib/magazine-hero.mjs` 가 그 CLI 를 import 했으며,
 *       `magazine-packet.mjs` 에 같은 판독이 한 벌 더 있었다(같은 분기 · 같은 오프셋).
 *       이 파일은 QA 본문을 그대로 옮겼다 — 동작 변경 0. QA 는 같은 이름으로 다시 내보낸다(기존 import 경로 유지).
 *
 * 🔴 import 시점 부작용 0 — `node:fs` 말고 아무것도 import 하지 않는다(`magazine-load.mjs` 를 거치지 않는다).
 * 사본이 다시 생기는지는 `scripts/magazine-vnext-boundary-check.mjs`(R5)가 본다.
 */
import { readFileSync } from 'node:fs'

/** RIFF/WEBP 헤더에서 크기를 읽는다. 알 수 없으면 null */
export function readWebpSize(path) {
  const buf = readFileSync(path)
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null

  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  }
  if (fourcc === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}
