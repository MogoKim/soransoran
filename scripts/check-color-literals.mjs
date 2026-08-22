#!/usr/bin/env node
/**
 * 색상 리터럴 가드
 *
 * 정본 §3-4 원칙 1·2:
 *   hex literal 은 토큰 정의 파일(globals.css)에만 존재한다.
 *   컴포넌트는 semantic token 만 쓴다.
 *
 * 우나어 반례: 토큰이 있는데도 코랄 리터럴이 39개 파일에 흩어져
 * 컬러 변경이 1줄 수정이 아니라 39파일 추적이 되었다.
 * 소란소란은 #FF6F61 을 임시 채택했으므로, 리터럴이 흩어지면 교체가 불가능해진다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src')
// hex 정의가 허용되는 파일 — 이 둘이 색상의 SSoT 다.
// globals.css = 화면에 그려지는 색 / brand.ts = metadata·manifest 전용
const ALLOWED = new Set(['src/app/globals.css', 'src/lib/brand.ts'])
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const ARBITRARY = /(?:bg|text|border|fill|stroke|ring|shadow)-\[#[0-9a-fA-F]{3,8}\]/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p)
  }
  return out
}

const violations = []
for (const file of walk(TARGET)) {
  const rel = relative(ROOT, file)
  if (ALLOWED.has(rel)) continue
  const text = readFileSync(file, 'utf8')
  // 주석은 검사하지 않는다. 근거·대비값을 주석에 남기는 규율을 막지 않기 위해서다.
  let inBlock = false
  text.split('\n').forEach((raw, i) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return
      inBlock = false
      line = line.slice(end + 2)
    }
    const open = line.indexOf('/*')
    if (open !== -1) {
      const close = line.indexOf('*/', open + 2)
      if (close === -1) { inBlock = true; line = line.slice(0, open) }
      else line = line.slice(0, open) + line.slice(close + 2)
    }
    const lineComment = line.indexOf('//')
    if (lineComment !== -1) line = line.slice(0, lineComment)
    if (!line.trim()) return

    for (const m of line.match(HEX) ?? []) violations.push({ rel, line: i + 1, hit: m })
    for (const m of line.match(ARBITRARY) ?? []) violations.push({ rel, line: i + 1, hit: m })
  })
}

if (violations.length) {
  console.error('색상 리터럴이 토큰 정의 파일 밖에서 발견되었습니다:\n')
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  ${v.hit}`)
  console.error(`\n총 ${violations.length}건. semantic token 으로 교체하세요.`)
  process.exit(1)
}

console.log('색상 리터럴 가드 통과 — 토큰 정의 파일 외 0건')
