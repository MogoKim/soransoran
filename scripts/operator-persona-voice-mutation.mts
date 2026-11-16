#!/usr/bin/env tsx
/**
 * Persona 목소리 판정 — **변이 시험** (막는 줄 하나를 바꾸면 operator-persona-voice-check 가 반드시 FAIL 해야 한다)
 *
 * 🔴 worktree 를 고치지 않는다. 판정 모듈 사본을 OS 임시 디렉터리에 쓰고(상대 import 는 절대 경로로 바꾼다)
 *    `OPERATOR_PERSONA_VOICE_MODULE` 로 주입한다.
 * 🔴 결과 줄이 찍히고 FAIL 이 1 이상일 때만 "잡았다" 로 센다 — 사본이 깨져 실행 오류로 죽은 것은 잡은 것이 아니다.
 * 🔴 바꿀 문자열은 원본에 정확히 1곳 있어야 한다(0곳 = 죽은 방어).
 * 🔴 트랜잭션 쪽(거절 throw · PV 확보 순서 · createMany)은 같은 검사의 소스 계약 절과 격리 DB 시험이 잡는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '../src/lib')
const source = readFileSync(join(libDir, 'operator-persona-voice.ts'), 'utf-8')
  .replace(/from '\.\/([^']+)'/g, (_m, p: string) => `from '${join(libDir, p)}'`)

type Mutation = { id: string; name: string; from: string; to: string }
const MUTATIONS: Mutation[] = [
  { id: 'W1', name: '25시간 경계를 0으로', from: 'export const PERSONA_VOICE_AUTO_POST_MIN_AGE_MS = 25 * HOUR_MS', to: 'export const PERSONA_VOICE_AUTO_POST_MIN_AGE_MS = 0' },
  { id: 'W2', name: '경계 포함 → 제외', from: 'if (nowMs < opensAtMs) {', to: 'if (nowMs <= opensAtMs) {' },
  { id: 'W3', name: 'Micro Seed 확인 제거', from: "if (belongsToMicroSeedLane(f)) return { ok: false, code: 'MICRO_SEED', reason: '외부 원문 글에는 쓰지 않습니다.' }", to: '' },
  { id: 'W4', name: '신고 수 모름(null)을 통과', from: 'if (f.pendingReports !== 0) {', to: 'if (f.pendingReports !== null && f.pendingReports > 0) {' },
  { id: 'W5', name: '활동 상태 확인 제거', from: "if (f.status !== 'active') return", to: "if (false) return" },
  { id: 'W6', name: '글쓴이 계정 모름을 실회원으로', from: 'if (real.real && !real.unknown) return', to: 'if (real.real) return' },
  { id: 'W7', name: 'PV 코드 형식 느슨', from: 'const PERSONA_CODE = /^P(\\d+)$/', to: 'const PERSONA_CODE = /P(\\d+)/' },
  { id: 'W8', name: '공개 시각 모름을 통과', from: "if (f.publishedAt === null) return { ok: false, code: 'TOO_EARLY', reason: '공개 시각을 알 수 없습니다.' }", to: "if (f.publishedAt === null) return { ok: true, kind: 'persona' }" },
  { id: 'W9', name: '게시판 확인 제거', from: "if (!VOICE_BOARDS.has(f.boardType)) return", to: 'if (false) return' },
]

const check = join(here, 'operator-persona-voice-check.mts')
const run = (code: string): number | null => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-voice-mut-'))
  try {
    const file = join(dir, 'operator-persona-voice.ts')
    writeFileSync(file, code)
    const r = spawnSync('npx', ['tsx', check], { env: { ...process.env, OPERATOR_PERSONA_VOICE_MODULE: file }, encoding: 'utf8' })
    const m = /결과: PASS (\d+) · FAIL (\d+)/.exec(r.stdout ?? '')
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
  const hits = source.split(mu.from).length - 1
  if (hits !== 1) {
    report(false, `${mu.id} ${mu.name} — 바꿀 문자열이 ${hits}곳(정확히 1곳이어야 한다)`)
    continue
  }
  const failed = run(source.replace(mu.from, mu.to))
  report(failed !== null && failed > 0, `${mu.id} ${mu.name} → ${failed === null ? 'crash — 🔴 시험이 아니라 실행 오류' : `FAIL ${failed}`}`)
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
