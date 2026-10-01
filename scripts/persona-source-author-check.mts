#!/usr/bin/env tsx
/**
 * 원본 작가명 단일 불변식 fixture — 🔴 DB 0 · 네트워크 0 · 파일 write 0(임시 디렉터리 제외) (2026-10-01 · #641)
 *
 *   npm run persona:source-author-check
 *
 * 결정: 우나어 CafePost(원본 작가명)는 9/10 폐기돼 복구할 수 없다. 저장된 크롤 작가 해시는 증명도 재생성도 안 된다.
 *   그래서 Gate ⑥-B 의 크롤 작가 대조(옛 B2)를 계약 판정의 권위에서 뺐다. 대신 지키는 **새 단일 불변식**:
 *
 *     원본 작가명 · source author 를 Persona 작명 · 생성 입력에 넣지 않는다.
 *
 * 보는 것
 *   ① 작명 · 생성 경로(후보 이름 · 자동 생성 · 프롬프트)가 원천 작가 칸 · 크롤 원천 표 · 작가 해시를 읽지 않는다
 *   ② 원본 작가를 읽는 유일한 곳(말투 자산 적재)은 그 자리에서 불투명 speakerId 로 바꾼다 — 행동으로 확인
 *   ③ 새 원천 행은 작가 식별값을 만들지 않는다(authorHash null) — 행동으로 확인
 *   ④ 크롤 작가 대조 · 작가 해시 key · 공개 사슬 · 전환 도구가 운영 코드로 돌아오지 않는다(정적 잠금)
 *
 * 🔴 이름은 전부 지어낸 합성 문자열이다. 출력에 이름 · 해시를 싣지 않는다.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { candidatesFor } from '../src/lib/persona-nickname-candidates'
import { REFERENCE_SOURCES, loadLocalComments } from './lib/persona-reference-store.mjs'
import { toCommentSignals } from './lib/voice-comment-signals.mjs'
import { toSourceRow } from './lib/voice-unao-readonly.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const failures: string[] = []
const check = (name: string, ok: boolean): void => {
  if (ok) pass += 1
  else { failures.push(name); console.log(`  🔴 FAIL  ${name}`) }
}
/** 주석은 코드가 아니다 — 설명 문구의 낱말을 위반으로 읽지 않는다 */
const codeOf = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

// 🔴 합성 이름
const AUTHOR_A = '봄뜰하나'
const AUTHOR_B = '겨울숲둘'

console.log('\n① 작명 · 생성 경로는 원본 작가를 읽지 않는다')
/** Persona 표시명 후보 · 자동 생성 · 생성 프롬프트 — 원천 작가가 들어가면 안 되는 자리 */
const GENERATION = [
  'src/lib/persona-nickname-candidates.ts',
  'src/lib/persona-autogen.ts',
  'scripts/lib/persona-autogen.mts',
  'scripts/lib/persona-autogen-apply.mts',
  'scripts/persona-autogen.mts',
  'scripts/lib/persona-prompt.ts',
]
for (const f of GENERATION) {
  const code = codeOf(f)
  const offenders: string[] = []
  if (/\.author\b|\bauthor\s*:|\bauthorOf\(/.test(code)) offenders.push('원천 작가 칸')
  if (/voiceSource|voiceCommentSignal|CafePost|topComments/.test(code)) offenders.push('크롤 원천 표')
  if (/authorHash|hashOf\b|voice-author-hash/.test(code)) offenders.push('작가 해시')
  check(`${f} — 원천 작가 · 크롤 원천 · 작가 해시 0${offenders.length ? ` (${offenders.join(' · ')})` : ''}`, offenders.length === 0)
}
{
  const a = candidatesFor('P30')
  const b = candidatesFor('P30')
  check('표시명 후보는 Persona 코드만으로 결정적으로 만든다(원천 입력 없음)',
    a.length > 0 && JSON.stringify(a) === JSON.stringify(b) && candidatesFor.length <= 2)
}

console.log('\n② 원본 작가를 읽는 유일한 곳은 그 자리에서 불투명 id 로 바꾼다')
{
  const store = codeOf('scripts/lib/persona-reference-store.mts')
  const reads = store.match(/authorOf\(/g) ?? []
  const wrapped = store.match(/speakerIdOf\(authorOf\(/g) ?? []
  // 정의는 화살표 함수(`const authorOf =`)라 호출만 잡힌다 — 호출은 전부 speakerIdOf 로 감싸야 한다
  check(`말투 자산 적재 — authorOf 호출은 전부 speakerIdOf 안 (${wrapped.length}/${reads.length})`,
    reads.length >= 1 && wrapped.length === reads.length && /const authorOf = /.test(store))
  const dir = mkdtempSync(join(tmpdir(), 'source-author-check-'))
  try {
    const rel = REFERENCE_SOURCES[0]!
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    const line = (n: number): string => `그러게요 저도 비슷하게 느꼈어요 ${'정말'.repeat(n % 3 + 1)} 그렇네요`
    writeFileSync(join(dir, rel), JSON.stringify([{ comments: [
      { author: AUTHOR_A, content: line(1) }, { author: AUTHOR_A, content: line(2) }, { author: AUTHOR_B, content: line(3) },
    ] }]))
    const { rows } = loadLocalComments(dir)
    const json = JSON.stringify(rows)
    check('적재 결과에 작가명이 없다', rows.length > 0 && !json.includes(AUTHOR_A) && !json.includes(AUTHOR_B))
    check('speakerId 는 12자 불투명 값 · 같은 작가는 같은 값 · 다른 작가는 다른 값',
      rows.every((r) => /^[0-9a-f]{12}$/.test(r.speakerId)) && rows.length === 3
      && rows[0]!.speakerId === rows[1]!.speakerId && rows[0]!.speakerId !== rows[2]!.speakerId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\n③ 새 원천 행은 작가 식별값을 만들지 않는다')
{
  const src = toSourceRow({ id: 'x', cafeId: 'c', postUrl: 'u', author: AUTHOR_A, content: '본문입니다', crawledAt: new Date(0) })
  check('VoiceSource 행 — authorHash null · 작가명 없음', src.authorHash === null && !JSON.stringify(src).includes(AUTHOR_A))
  const sig = toCommentSignals([{ author: AUTHOR_B, content: '저도 그랬어요' }], { capturedAt: new Date(0) })
  check('VoiceCommentSignal 행 — authorHash null · 작가명 없음',
    sig.length === 1 && sig[0]!.authorHash === null && !JSON.stringify(sig).includes(AUTHOR_B))
}

console.log('\n④ 정적 잠금 — 크롤 작가 대조 · key · 공개 사슬 · 전환 도구가 돌아오지 않는다')
{
  const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', '.claude', '.omc', '.bkit', '.playwright-mcp'])
  const walk = (dir: string, out: string[]): string[] => {
    for (const e of readdirSync(dir)) {
      if (SKIP.has(e)) continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(mts|mjs|ts|tsx|js|cjs)$/.test(e)) out.push(relative(ROOT, p))
    }
    return out
  }
  const files = [...walk(join(ROOT, 'scripts'), []), ...walk(join(ROOT, 'src'), [])]
    .filter((f) => !/-check\.(mts|mjs|ts)$/.test(f) && !/(^|\/)__tests__\//.test(f))
  check('스캔 대상이 비지 않았다', files.length > 100)
  const hits = (re: RegExp): string[] => files.filter((f) => re.test(codeOf(f)))
  for (const [label, re] of [
    ['크롤 작가 판정 종류(B2_CRAWL_AUTHOR)', /B2_CRAWL_AUTHOR/],
    ['작가 해시 key env', /VOICE_AUTHOR_HASH_SALT/],
    ['공개 v1 사슬 문자열', /soransoran-voice-v1/],
    ['작가 해시 helper · 전환 도구', /voice-author-hash|authorGateOf|loadAuthorHashSets|storedAuthorHashState/],
    ['인라인 salt 작가 해시', /createHash\(\s*['"]sha256['"]\s*\)\s*\.update\(\s*`\$\{[^}]*(salt|Salt|SALT)[^}]*\}::/],
  ] as const) {
    const h = hits(re)
    check(`${label} 0${h.length ? ` — ${h.join(', ')}` : ''}`, h.length === 0)
  }
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf-8')
  check('package script 에 작가 해시 전환 · 증명 도구가 없다', !/voice:author-hash|author-hash-norm-backfill/.test(pkg))
}

console.log(`\n원본 작가명 불변식: ${pass} PASS · ${failures.length} FAIL`)
process.exit(failures.length === 0 ? 0 : 1)
