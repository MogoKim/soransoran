#!/usr/bin/env node
/**
 * lane-author-identity-guard 변이 시험 — 가드가 위반을 정말 잡는가 · 범위 밖은 정말 통과시키는가
 *
 * 🔴 worktree 를 고치지 않는다. src/lib · scripts 를 OS 임시 디렉터리에 복사해 그 사본에만 줄을 넣고,
 *    가드를 ROOT 인자로 그 사본에 돌린다.
 *
 *   node scripts/lane-author-identity-guard-mutation.mjs
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(new URL('.', import.meta.url).pathname, '..')
const GUARD = join(ROOT, 'scripts/lane-author-identity-guard.mjs')

/** expect: 'fail' = 가드가 막아야 함 · 'pass' = 통과해야 함(범위·주석 증명) */
const CASES = [
  { name: '무변이 사본', expect: 'pass', apply: () => {} },
  { name: 'governor 에 authorId 와 Persona userId 비교', expect: 'fail',
    apply: (d) => appendFileSync(join(d, 'src/lib/persona-comment-governor.ts'), '\nconst _m1 = (c: { authorId: string }, persona: { userId: string }) => c.authorId === persona.userId\n') },
  { name: 'reserve-facts 에 작성자 관계로 Persona 거름', expect: 'fail',
    apply: (d) => appendFileSync(join(d, 'scripts/lib/persona-reserve-facts.mts'), '\nconst _m2 = { where: { author: { persona: { isNot: null } } } }\n') },
  { name: '단계 증거 repo 에 사용자 id 집합으로 거름', expect: 'fail',
    apply: (d) => appendFileSync(join(d, 'src/lib/stage-evidence-repo.ts'), '\nconst _m3 = (personaUserIds: string[]) => ({ authorId: { in: [...personaUserIds] } })\n') },
  { name: '같은 줄을 운영 레인 파일에 넣음(범위 밖)', expect: 'pass',
    apply: (d) => writeFileSync(join(d, 'src/lib/operator-persona-voice-tx.ts'), 'const _m4 = (personaUserIds: string[]) => ({ authorId: { in: [...personaUserIds] } })\n') },
  { name: '같은 줄을 주석으로만 넣음', expect: 'pass',
    apply: (d) => appendFileSync(join(d, 'src/lib/stage-evidence-repo.ts'), '\n// authorId: { in: [...personaUserIds] }\n') },
  { name: '레인 시험 파일(-check)에 넣음(범위 밖)', expect: 'pass',
    apply: (d) => writeFileSync(join(d, 'scripts/persona-zz-check.mts'), 'const _m5 = { author: { persona: { isNot: null } } }\n') },
]

let pass = 0
let fail = 0
for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), 'lane-guard-mut-'))
  try {
    cpSync(join(ROOT, 'src/lib'), join(dir, 'src/lib'), { recursive: true })
    cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true, filter: (src) => !src.includes('node_modules') })
    c.apply(dir)
    const r = spawnSync('node', [GUARD, dir], { encoding: 'utf8' })
    const got = r.status === 0 ? 'pass' : 'fail'
    const ok = got === c.expect
    console.log(`  ${ok ? '✅' : '🔴'} ${c.name} → 가드 ${got}(기대 ${c.expect})`)
    ok ? (pass += 1) : (fail += 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
