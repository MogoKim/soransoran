#!/usr/bin/env tsx
/**
 * 🔴 댓글 하루 상한(그날 단계별 천장) 변이 시험 — 2026-11-25 밤 4 PR-C
 *
 *   npm run check:comment-daily-cap-mutation
 *
 * 현재 worktree 를 고치지 않고 OS 임시 사본에서 불변 조건을 하나씩 깨뜨린다(`supply-cost-envelope-mutation` 과 같은 방식).
 * 문법·적재 오류는 검출로 세지 않고, 겨냥한 정본 검사가 판정 FAIL 을 남겨야 통과다.
 * 🔴 변이 자리가 정확히 1곳이 아니면(0곳 = 문장이 옮겨졌다) FAIL 이다 — 지점 0곳은 죽은 방어다.
 *
 * 지점:
 *   ① `commentDailyCapOf` 의 d50 분기 — D50 날이 base 칸을 받는다
 *   ② 모르는 단계(null) · D30 이 base 가 아닌 칸을 받는다
 *   ③ min(env, 그날 천장) → env 만(천장 없음)
 *   ④ 컨트롤러 하루 증거가 판정하는 그날 단계(`i.stage`) 대신 다른 단계를 넘긴다 · 브레이크 신호가 전날 결정 단계를 버린다
 *   ⑤ 러너 · 화면이 읽은 그날 단계를 버린다
 *   ⑥ 단계 인자에 기본값이 생긴다(한 곳만 고친 상태가 컴파일되는 길)
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LANE = 'src/lib/persona-comment-auto-lane.ts'
const SIGNALS = 'scripts/lib/ops-signals.mts'
const CONTROLLER = 'scripts/stage-controller.mts'
const RUNNER = 'scripts/persona-comment-loop.mts'
const STATUS = 'scripts/ops-status.mts'
const LOOP_CHECK = 'scripts/persona-comment-loop-check.mts'
const OPS_CHECK = 'scripts/ops-loop-check.mts'

const CAP_BRANCH = "  stage === 'd50' ? COMMENT_DAILY_USD_CAP.d50 : COMMENT_DAILY_USD_CAP.base"
const MIN_LINE = '  if (daily !== null && daily > cap) {'
const EVIDENCE_CALL = 'readCostSignals(new Date(`${i.kstDate}T12:00:00+09:00`), i.stage)'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const mutations: readonly Mutation[] = [
  {
    name: '① D50 날이 base 칸을 받는다(d50 분기 제거) — 상한 함수',
    file: LANE, from: CAP_BRANCH, to: "  stage === 'd50' ? COMMENT_DAILY_USD_CAP.base : COMMENT_DAILY_USD_CAP.base", check: LOOP_CHECK,
  },
  {
    name: '① D50 날이 base 칸을 받는다(d50 분기 제거) — 장부 파일 왕복',
    file: LANE, from: CAP_BRANCH, to: "  stage === 'd50' ? COMMENT_DAILY_USD_CAP.base : COMMENT_DAILY_USD_CAP.base", check: OPS_CHECK,
  },
  {
    name: '② 모르는 단계(null)가 d50 칸을 받는다',
    file: LANE, from: CAP_BRANCH, to: "  stage === 'd50' || stage === null ? COMMENT_DAILY_USD_CAP.d50 : COMMENT_DAILY_USD_CAP.base", check: LOOP_CHECK,
  },
  {
    name: '② D30 날이 d50 칸을 받는다 — 장부 파일 왕복(이튿날 재판정 반례)',
    file: LANE, from: CAP_BRANCH, to: "  stage === 'd50' || stage === 'd30' ? COMMENT_DAILY_USD_CAP.d50 : COMMENT_DAILY_USD_CAP.base", check: OPS_CHECK,
  },
  {
    name: '③ min(env, 그날 천장) → env 만(천장 없음) — 상한 함수',
    file: LANE, from: MIN_LINE, to: '  if (false) {', check: LOOP_CHECK,
  },
  {
    name: '③ min(env, 그날 천장) → env 만(천장 없음) — 장부 파일 왕복',
    file: LANE, from: MIN_LINE, to: '  if (false) {', check: OPS_CHECK,
  },
  {
    name: '④ 컨트롤러 하루 증거가 그날 단계 대신 모름(null)을 넘긴다',
    file: CONTROLLER, from: EVIDENCE_CALL, to: 'readCostSignals(new Date(`${i.kstDate}T12:00:00+09:00`), null)', check: OPS_CHECK,
  },
  {
    name: "④ 컨트롤러 하루 증거가 그날 단계 대신 고정 단계('d30')를 넘긴다",
    file: CONTROLLER, from: EVIDENCE_CALL, to: "readCostSignals(new Date(`${i.kstDate}T12:00:00+09:00`), 'd30')", check: OPS_CHECK,
  },
  {
    name: '④ 컨트롤러 브레이크 신호가 전날 결정 단계를 버린다',
    file: CONTROLLER, from: 'readCostSignals(NOW, previous?.release ?? null)', to: 'readCostSignals(NOW, null)', check: OPS_CHECK,
  },
  {
    name: '⑤ 러너 세션 상한이 그날 단계를 버린다',
    file: RUNNER, from: 'commentLoopLimitsFromEnv(process.env, day.stage)', to: 'commentLoopLimitsFromEnv(process.env, null)', check: LOOP_CHECK,
  },
  {
    name: '⑤ 러너 장부 관문이 그날 단계를 버린다',
    file: RUNNER, from: 'readCostSignals(now, day.stage, process.env', to: 'readCostSignals(now, null, process.env', check: LOOP_CHECK,
  },
  {
    name: '⑤ ops-status 가 읽은 오늘 결정 단계를 버린다',
    file: STATUS, from: 'readCostSignals(NOW, todayRelease, env.values)', to: 'readCostSignals(NOW, null, env.values)', check: OPS_CHECK,
  },
  {
    name: '⑥ 상한 함수의 단계 인자에 기본값이 생긴다',
    file: LANE, from: '  env: Readonly<Record<string, string | undefined>>, stage: RuntimeStage | null,\n',
    to: "  env: Readonly<Record<string, string | undefined>>, stage: RuntimeStage | null = 'd50',\n", check: LOOP_CHECK,
  },
  {
    name: '⑥ readCostSignals 의 댓글 단계 인자에 기본값이 생긴다',
    file: SIGNALS, from: '  commentStage: RuntimeStage | null,\n', to: "  commentStage: RuntimeStage | null = 'd50',\n", check: OPS_CHECK,
  },
]

// 🔴가 포함된 통과 항목 이름이 있으므로 단어 검색을 하면 거짓 검출이 된다.
// 각 정본 검사가 마지막에 남기는 `N pass · M fail` 집계에서 실제 실패 개수만 읽는다.
const FAIL_SUMMARY = /(?:✅|🔴)\s+\d+\s+pass\s+·\s+([1-9]\d*)\s+fail/m
const dir = mkdtempSync(join(tmpdir(), 'comment-daily-cap-mut-'))
const run = (check: string): { code: number; judged: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], {
    cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000,
  })
  const stdout = r.stdout ?? ''
  const output = `${stdout}${r.stderr ?? ''}`
  return {
    code: r.status ?? 99,
    judged: FAIL_SUMMARY.test(stdout),
    tail: output.trim().split('\n').slice(-1)[0] ?? '',
  }
}

let failed = 0
try {
  for (const entry of readdirSync(root)) {
    if (entry === 'src' || entry === 'scripts' || entry === '.git' || entry === '.next') continue
    symlinkSync(join(root, entry), join(dir, entry))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ 댓글 하루 상한(그날 단계별 천장) 변이 시험 (worktree 변경 0) ══')
  for (const check of [...new Set(mutations.map((mutation) => mutation.check))]) {
    const result = run(check)
    console.log(`  ${result.code === 0 ? '✅' : '🔴'} 기준선 ${check} — exit ${result.code} (${result.tail})`)
    if (result.code !== 0) throw new Error(`기준선이 FAIL이다 — ${check}`)
  }

  for (const mutation of mutations) {
    const path = join(dir, mutation.file)
    const original = readFileSync(path, 'utf-8')
    const matches = original.split(mutation.from).length - 1
    if (matches !== 1) {
      failed += 1
      console.log(`  🔴 변이 자리 ${matches}곳(정확히 1곳이어야 함) — ${mutation.name}`)
      continue
    }
    writeFileSync(path, original.replace(mutation.from, mutation.to))
    try {
      const result = run(mutation.check)
      if (result.code === 0) {
        failed += 1
        console.log(`  🔴 살아남음 — ${mutation.name}`)
      } else if (!result.judged) {
        failed += 1
        console.log(`  🔴 로드 실패(검출 아님) — ${mutation.name} · ${result.tail}`)
      } else {
        console.log(`  ✅ 검출 — ${mutation.name}`)
      }
    } finally {
      writeFileSync(path, original)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? '✅ PASS' : `🔴 FAIL ${failed}건`} — 변이 ${mutations.length}개`)
process.exit(failed === 0 ? 0 : 1)
