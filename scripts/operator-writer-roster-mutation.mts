#!/usr/bin/env tsx
/**
 * 운영자 이름 명단 — **변이 시험** (막는 줄 하나를 바꾸면 operator-writer-roster-check 가 반드시 FAIL 해야 한다)
 *
 * 🔴 worktree 를 고치지 않는다. 판정 모듈 사본을 OS 임시 디렉터리에 쓰고
 *    (상대 import 는 절대 경로로 바꾼다) `OPERATOR_ROSTER_LIB` 으로 주입한다.
 * 🔴 결과 줄이 찍히고 FAIL 이 **무변이 사본보다 많을 때만** "잡았다" 로 센다 — 사본이 깨져 실행 오류로 죽은 것은
 *    잡은 것이 아니고, 무변이부터 FAIL 이 있으면(예: 명단에 TO_FILL_FROM_DB 가 남은 동안) "FAIL > 0" 은 모든 변이를
 *    공짜로 잡은 것으로 센다.
 * 🔴 바꿀 문자열은 원본에 정확히 1곳 있어야 한다(0곳 = 죽은 방어).
 * 🔴 트랜잭션 쪽(throw · createMany 순서)은 같은 검사의 소스 계약 절과 격리 DB 시험이 잡는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, 'lib')
const srcLibDir = join(here, '../src/lib')

const rawSource = readFileSync(join(libDir, 'operator-writer-roster.mts'), 'utf-8')

/** 상대 import 를 절대 경로로 바꾼다 — 임시 디렉터리에서 실행되어도 resolve 된다 */
const source = rawSource
  // './xxx' → 절대 경로 (scripts/lib/ 아래)
  .replace(/from '\.\/([^']+)'/g, (_m, p: string) => `from '${join(libDir, p)}'`)
  // '../../src/lib/xxx' → 절대 경로 (src/lib/ 아래)
  .replace(/from '\.\.\/\.\.\/src\/lib\/([^']+)'/g, (_m, p: string) => `from '${join(srcLibDir, p)}'`)

type Mutation = { id: string; name: string; from: string; to: string }

const MUTATIONS: Mutation[] = [
  // M1: P3 닉네임 불변 — stop 분기 삭제
  {
    id: 'M1',
    name: 'P3 닉네임 불변 stop 분기 삭제',
    from: "    if (dbRow.nickname !== entry.nickname) {",
    to:   "    if (false) {",
  },
  // M2: PV 무시 정규식 느슨 — isOpCode 가 모든 code 를 통과시킴
  {
    id: 'M2',
    name: 'isOpCode 정규식 `^OP\\d+$` → `.*`',
    from: "  return /^OP\\d+$/.test(code)",
    to:   "  return /.*/.test(code)",
  },
  // M3: Gate ⑥-B 허용 조건 느슨 — review 를 통과시킴
  {
    id: 'M3',
    name: "Gate ⑥-B status !== 'pass' → === 'reject' (review 통과)",
    from: "  if (collision.status !== 'pass') {",
    to:   "  if (collision.status === 'reject') {",
  },
  // M4: verifyNamePolicy 호출 삭제
  {
    id: 'M4',
    name: 'verifyNamePolicy 호출 삭제',
    from: "  const policy = verifyNamePolicy(nickname)\n  if (!policy.ok) problems.push(...policy.problems)",
    to:   "  // verifyNamePolicy 삭제됨",
  },
  // M5: DB retired → active 되살리기 금지 삭제 (P4)
  {
    id: 'M5',
    name: "P4 DB retired→active 되살리기 stop 삭제",
    from: "    if (dbRow.status === 'retired' && entry.status === 'active') {",
    to:   "    if (false) {",
  },
  // M6: DB 에만 있는 OP → stop 삭제 (P5)
  {
    id: 'M6',
    name: 'P5 DB에만 있는 OP → stop 삭제',
    from: "    if (!rosterCodes.has(w.code)) {",
    to:   "    if (false) {",
  },
  // M7: 시간 가드 호출 삭제 (P11)
  {
    id: 'M7',
    name: 'P11 시간 가드 judgeKstQuietWindow 삭제',
    from: "  return judgeKstQuietWindow(now, OPERATOR_ROSTER_QUIET_WINDOW)",
    to:   "  return { ok: true }",
  },
  // M8: 계획 지문 계산 삭제 → 항상 같은 값
  {
    id: 'M8',
    name: 'planDigestOf 계산 → 상수 반환',
    from: "    .update(rDigest + JSON.stringify(sorted), 'utf8')",
    to:   "    .update('constant', 'utf8')",
  },
  // M9: note 나이대 정규식 느슨 — 40대 초반을 허용
  {
    id: 'M9',
    name: 'NOTE_AGE_RE 40대 (중반|후반) → 40대 (초반도 허용)',
    from: "const NOTE_AGE_RE = /^(40대 (중반|후반)|50대 (초반|중반|후반)|60대 (초반|중반))/",
    to:   "const NOTE_AGE_RE = /^(40대|50대 (초반|중반|후반)|60대 (초반|중반))/",
  },
]

const check = join(here, 'operator-writer-roster-check.mts')
const tsconfigOps = join(here, '../tsconfig.ops.json')

const run = (code: string): number | null => {
  const dir = mkdtempSync(join(tmpdir(), 'roster-mut-'))
  try {
    const file = join(dir, 'operator-writer-roster.mts')
    writeFileSync(file, code)
    const r = spawnSync(
      'npx',
      ['tsx', '--tsconfig', tsconfigOps, check],
      { env: { ...process.env, OPERATOR_ROSTER_LIB: file }, encoding: 'utf8', cwd: join(here, '..') },
    )
    const m = /결과: PASS (\d+) · FAIL (\d+)/.exec(r.stdout ?? '')
    if (!m && r.stderr) {
      // crash 출력 중 FAIL 줄 없음
      const errPreview = r.stderr.slice(0, 200).replace(/\n/g, ' ')
      process.stderr.write(`    [crash] ${errPreview}\n`)
    }
    return m ? Number(m[2]) : null
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
report(base === 0, `원본 사본 → FAIL ${base ?? 'crash'}`)

console.log('\n② 변이 — 시험이 FAIL 해야 한다')
for (const mu of MUTATIONS) {
  // 겨냥 문자열이 정확히 1곳 있는지 먼저 확인
  const hits = source.split(mu.from).length - 1
  if (hits !== 1) {
    report(false, `${mu.id} ${mu.name} — 바꿀 문자열이 ${hits}곳(정확히 1곳이어야 한다)`)
    continue
  }
  const failed = run(source.replace(mu.from, mu.to))
  report(
    failed !== null && base !== null && failed > base,
    `${mu.id} ${mu.name} → ${failed === null ? 'crash — 🔴 시험이 아니라 실행 오류' : `FAIL ${failed} (무변이 ${base ?? 'crash'})`}`,
  )
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
