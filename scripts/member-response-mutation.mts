#!/usr/bin/env tsx
/**
 * 답 기다리는 글 판정 — **변이 시험** (막는 줄 하나를 바꾸면 check:member-response 가 반드시 FAIL 해야 한다)
 *
 *   npm run check:member-response-mutation
 *
 * 🔴 worktree 를 고치지 않는다. 판정 모듈 사본을 OS 임시 디렉터리에 쓰고(상대 import 는 절대 경로로 바꾼다)
 *    검사에 `MEMBER_RESPONSE_MODULE` 로 주입한다(persona-comment-followup-mutation 과 같은 방식).
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 하네스가 늘 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 * 🔴 바꿀 문자열(from)은 원본에 **정확히 1곳** 있어야 한다. 0곳이면 죽은 방어, 2곳 이상이면 무엇을 바꿨는지 모호하다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '../src/lib')
const source = readFileSync(join(libDir, 'member-response.ts'), 'utf-8')
  .replace(/from '\.\/([^']+)'/g, (_m, p: string) => `from '${join(libDir, p)}'`)

type Mutation = { id: string; name: string; from: string; to: string; catches: string }
const MUTATIONS: Mutation[] = [
  { id: 'V1', name: '글쓴이 본인 댓글을 답으로', catches: 'R2',
    from: 'if (c.authorId !== null && c.authorId === post.authorId) continue', to: '' },
  { id: 'V2', name: '지운 댓글을 답으로', catches: 'R5',
    from: 'if (c.isDeleted) continue', to: '' },
  { id: 'V3', name: '글쓴이 차단 무시', catches: 'R7 · R10',
    from: 'if (c.authorId !== null && blockedByAuthor.has(c.authorId)) continue', to: '' },
  { id: 'V4', name: '작성자 상태 모름을 통과', catches: 'R6(null) · R11',
    from: "if (k.kind === 'member' && c.authorBlocked !== false) continue", to: "if (k.kind === 'member' && c.authorBlocked === true) continue" },
  { id: 'V5', name: 'Persona 자동 댓글을 답으로', catches: 'R3',
    from: "new Set<ResponderKind>(['member', 'guest', 'operator'])", to: "new Set<string>(['member', 'guest', 'operator', 'persona'])" },
  { id: 'V6', name: 'Micro Seed 원문을 답으로', catches: 'R4',
    from: "new Set<ResponderKind>(['member', 'guest', 'operator'])", to: "new Set<string>(['member', 'guest', 'operator', 'micro-seed'])" },
  { id: 'V7', name: '판정 불가 행을 답으로', catches: 'R12',
    from: 'if (!k.ok) {\n      unknownSeen = true\n      continue\n    }',
    to: "if (!k.ok) {\n      if (first === null) first = { at: c.createdAt, kind: 'member' }\n      continue\n    }" },
  { id: 'V8', name: '기한 경계 ≥ → >', catches: 'R1',
    from: 'waitedMs >= MEMBER_RESPONSE_TARGET_MS', to: 'waitedMs > MEMBER_RESPONSE_TARGET_MS' },
  { id: 'V9', name: '첫 답 = 가장 이른 시각 → 첫 행', catches: 'R13',
    from: 'if (first === null || c.createdAt.getTime() < first.at.getTime())', to: 'if (first === null)' },
  { id: 'V10', name: '새벽 끝 7시 → 6시', catches: 'R16',
    from: 'export const MEMBER_RESPONSE_DAWN_END_HOUR_KST = 7', to: 'export const MEMBER_RESPONSE_DAWN_END_HOUR_KST = 6' },
  { id: 'V11', name: '기다린 시간 음수 허용', catches: 'R15',
    from: 'const waitedMs = Math.max(0, now.getTime() - post.createdAt.getTime())', to: 'const waitedMs = now.getTime() - post.createdAt.getTime()' },
]

const check = join(here, 'member-response-check.mts')
/**
 * 🔴 exit 코드만 보지 않는다 — 사본이 깨져 실행 오류로 죽어도 exit 1 이다. 결과 줄이 찍혔고 FAIL 이 1 이상일 때만
 *    "시험이 잡았다" 로 센다. 결과 줄이 없으면 'crash' 다.
 */
type Outcome = { failed: number | null }
const run = (code: string): Outcome => {
  const dir = mkdtempSync(join(tmpdir(), 'member-response-mut-'))
  try {
    const file = join(dir, 'member-response.ts')
    writeFileSync(file, code)
    const r = spawnSync('npx', ['tsx', check], { env: { ...process.env, MEMBER_RESPONSE_MODULE: file }, encoding: 'utf8' })
    const m = /결과: PASS (\d+) · FAIL (\d+)/.exec(r.stdout ?? '')
    return { failed: m ? Number(m[2]) : null }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let pass = 0
let fail = 0
const report = (ok: boolean, line: string) => {
  console.log(`  ${ok ? '✅' : '🔴'} ${line}`)
  ok ? (pass += 1) : (fail += 1)
}

console.log('\n① 무변이 사본 — PASS 해야 한다')
const base = run(source)
report(base.failed === 0, `원본 사본 → check:member-response FAIL ${base.failed ?? 'crash'}`)

console.log('\n② 변이 — 검사가 FAIL 해야 한다')
for (const mu of MUTATIONS) {
  const hits = source.split(mu.from).length - 1
  if (hits !== 1) {
    report(false, `${mu.id} ${mu.name} — 바꿀 문자열이 ${hits}곳(정확히 1곳이어야 한다)`)
    continue
  }
  const { failed } = run(source.replace(mu.from, mu.to))
  const caught = failed !== null && failed > 0
  report(caught, `${mu.id} ${mu.name} (${mu.catches}) → ${failed === null ? 'crash — 🔴 시험이 아니라 실행 오류' : `FAIL ${failed}`}${failed === 0 ? ' — 🔴 아무 시험도 잡지 못했다' : ''}`)
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
