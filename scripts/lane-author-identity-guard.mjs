#!/usr/bin/env node
/**
 * 🔴 D100·Persona 레인은 작성자 계정(authorId)으로 Persona 를 판단하지 않는다 — CI 가드
 *
 * 왜: 2026-11-16 부터 같은 Persona User 가 운영 레인에서도 말한다(Persona 목소리 —
 *     commentOrigin=OPERATOR · personaId 없음 · 작성자 행 code `PV…`). 자동 레인의 예산·비율·단계 증거는
 *     commentOrigin 과 personaId 로만 세므로 지금은 섞이지 않는다. 앞으로 누가 "작성자 계정이 Persona 인가" 로
 *     판단하는 코드를 레인 파일에 넣으면 그 순간 운영 댓글이 자동 레인 숫자에 섞인다. 그 코드를 여기서 막는다.
 *
 * 레인 파일: src/lib/(persona-|stage-|auto-ready|supply-|comment-thread) · scripts/lib/(persona-|stage-) · scripts/(persona-|stage-)
 *            (시험 파일 -check · -mutation · -db-check 는 뺀다). 운영 레인(operator-*)은 밖이다.
 * 판정: 주석·문자열을 지운 코드에서 아래 패턴이 하나라도 보이면 FAIL.
 *
 *   node scripts/lane-author-identity-guard.mjs [ROOT]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.argv[2] ?? join(new URL('.', import.meta.url).pathname, '..')

const LANE = /^(src\/lib\/(persona-|stage-|auto-ready|supply-|comment-thread)|scripts\/lib\/(persona-|stage-)|scripts\/(persona-|stage-))/
const TEST_FILE = /-(check|mutation|db-check)\.m?[jt]sx?$/
const CODE_FILE = /\.(ts|tsx|mts|mjs|js)$/

const PATTERNS = [
  { re: /author\s*:\s*\{[^}]*\b(persona|operatorWriter)\b/, why: '작성자 관계를 타고 Persona·운영자 판단' },
  { re: /\bauthor\??\.(persona|operatorWriter)\b/, why: '작성자 관계의 Persona·운영자 값을 읽음' },
  { re: /authorId\s*:\s*\{\s*(in|notIn)\s*:/, why: '사용자 id 집합으로 댓글·글을 거름' },
  { re: /authorId\s*[!=]==?\s*[A-Za-z_.?]*([Uu]serId|[Pp]ersona)[A-Za-z_]*/, why: 'authorId 를 Persona/사용자 id 와 비교' },
  { re: /[A-Za-z_.?]*([Uu]serId|[Pp]ersona)[A-Za-z_]*\s*[!=]==?\s*[A-Za-z_.?]*authorId/, why: 'Persona/사용자 id 를 authorId 와 비교' },
  { re: /[Pp]ersona[A-Za-z_]*\.has\(\s*[A-Za-z_.?]*authorId/, why: 'Persona 집합에 authorId 가 있는지 봄' },
]

/** 주석과 문자열 내용을 지운다 — 주석에 적힌 예시나 문구를 코드로 오인하지 않게 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

function walk(dir, out = []) {
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = [...walk(join(ROOT, 'src/lib')), ...walk(join(ROOT, 'scripts'))]
  .map((p) => relative(ROOT, p).split('\\').join('/'))
  .filter((f) => CODE_FILE.test(f) && LANE.test(f) && !TEST_FILE.test(f))
  .sort()

const hits = []
for (const f of files) {
  const lines = strip(readFileSync(join(ROOT, f), 'utf8')).split('\n')
  lines.forEach((line, i) => {
    for (const p of PATTERNS) if (p.re.test(line)) hits.push(`${f}:${i + 1} — ${p.why}`)
  })
}

if (files.length === 0) {
  console.error('🔴 레인 파일을 하나도 찾지 못했다 — 경로가 바뀌었으면 이 가드는 죽은 가드다')
  process.exit(1)
}
if (hits.length > 0) {
  console.error('🔴 D100·Persona 레인은 작성자 계정으로 Persona 를 판단하지 않는다 — Persona 목소리 댓글(OPERATOR · PV 행)이 같은 User 로 쓰인다.')
  console.error('   레인은 commentOrigin, 화자는 personaId 다. "이 Persona 가 이미 말했나" 가 필요하면 personaId 와 PV 행을 함께 세는 정본 함수를 먼저 만든다.')
  for (const h of hits) console.error(`   ${h}`)
  process.exit(1)
}
console.log(`✅ 레인 파일 ${files.length}개 · 작성자 계정으로 Persona 판단 0건`)
