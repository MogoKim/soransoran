#!/usr/bin/env tsx
/**
 * 🔴 **단계 controller · consumer 실제 실행 — 격리 Postgres 에서만** (운영 DB 0)
 *
 *    fixture 로는 잴 수 없는 것을 **진짜 진입점**으로 본다:
 *      · flag OFF 면 `--apply` 여도 행 0
 *      · flag ON 이면 결정 행 1 · 정본 validator 통과 · 다시 돌려도 덮지 않는다
 *      · consumer 가 그 행을 러너 env 로 옮긴다 · flag OFF 면 아무것도 넣지 않는다
 *      · DB 에 못 닿으면 controller 는 아무것도 쓰지 않고 exit 1 · consumer 는 d1
 *      · 감싼 명령의 종료 코드를 그대로 돌려준다
 *
 * 🔴 HOME 을 임시 디렉터리로 바꿔 돌린다 — 정본 env · LaunchAgents · 장부가 전부 가짜 HOME 안이다.
 *    진짜 `~/Library/Application Support/soransoran` 은 읽지도 쓰지도 않는다.
 *
 * 세우는 법은 `stage-decision-db-check.mts` 맨 위 주석과 같다 (SORAN_ISOLATED_DB=yes-throwaway · soran_test).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { previousKstDate, validateStoredDecision } from '../src/lib/stage-decision-contract'
import { createStageDecision, rowToValidatorInput } from '../src/lib/stage-decision-repo'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL) && !/host=\/tmp\//.test(URL)) {
  problems.push('DATABASE_URL 이 localhost(또는 /tmp 소켓) 주소가 아니다')
}
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const HOME = mkdtempSync(join(tmpdir(), 'ops-loop-home-'))
const APP = join(HOME, 'Library', 'Application Support', 'soransoran')
mkdirSync(APP, { recursive: true })
mkdirSync(join(HOME, 'Library', 'LaunchAgents'), { recursive: true })
const writeEnv = (flag: 'on' | 'off'): void => writeFileSync(join(APP, 'env.local'), [
  'SORAN_RELEASE_STAGE=d1', 'SORAN_CAPACITY_STAGE=d10', `STAGE_CONTROLLER_ENABLED=${flag}`,
  'SORAN_LLM_DAILY_BUDGET_USD=0.5', 'SORAN_LLM_RUN_REQUEST_CAP=20', 'SORAN_LLM_RESERVE_HEADROOM=1.2',
  'SORAN_AUDIT_LLM_DAILY_BUDGET_USD=0.3', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP=25', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM=1.5', '',
].join('\n'), { mode: 0o600 })

const run = (script: string, args: readonly string[], env: Record<string, string> = {}): { code: number | null; out: string; err: string } => {
  const r = spawnSync(process.execPath, [...process.execArgv, script, ...args], {
    encoding: 'utf-8', env: { ...process.env, HOME, ...env }, timeout: 300_000,
  })
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

const prisma = new PrismaClient()
const today = kstDateString(new Date())
const yesterday = previousKstDate(today)!
try {
  // 🔴 격리 DB 청소 — 이 검사가 쓰는 두 날짜만
  await prisma.stageDecision.deleteMany({ where: { kstDate: { in: [today, yesterday] } } })

  console.log('\n① flag OFF — --apply 여도 쓰지 않는다')
  writeEnv('off')
  const off = run('scripts/stage-controller.mts', ['--apply'])
  check('exit 0', off.code === 0, off.err.slice(-300))
  check('🔴 행 0', (await prisma.stageDecision.count({ where: { kstDate: today } })) === 0)

  console.log('\n② flag ON — 전날 SUSTAIN d5 위에서 결정 하나를 쓴다')
  writeEnv('on')
  const prevRow = {
    kstDate: yesterday, capacity: 'd10', release: 'd5', state: 'SUSTAIN', reasons: ['fixture'], blocks: [],
    dayPinned: false, supply: null, decidedAt: new Date(Date.parse(`${yesterday}T00:00:00Z`)).toISOString(),
    contractVersion: 'stage-decision-v4', decidedBy: 'controller', transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
  }
  const pv = validateStoredDecision({ row: prevRow, expectKstDate: yesterday })
  check('fixture 전날 결정이 정본 validator 를 통과한다', pv.ok, pv.ok ? '' : pv.reason)
  if (pv.ok) check('전날 결정 저장(create)', (await createStageDecision(prisma, pv.decision)) === 'inserted')
  const on = run('scripts/stage-controller.mts', ['--apply'])
  check('exit 0', on.code === 0, on.err.slice(-300))
  const row = await prisma.stageDecision.findUnique({ where: { kstDate: today } })
  check('🔴 오늘 결정 행 1', row !== null)
  const v = row === null ? null : validateStoredDecision({ row: rowToValidatorInput(row), expectKstDate: today })
  check('🔴 저장된 행이 정본 validator 를 통과한다', v?.ok === true, v !== null && !v.ok ? v.reason : '')
  check('writer = controller · 천장 = env 승인값 d10 그대로', row?.decidedBy === 'controller' && row?.capacity === 'd10')
  check('🔴 공개는 지속 단계 d5 를 넘지 않는다(빈 재고 · 신호 모름 → 올리지 않는다)',
    row !== null && ['d1', 'd3', 'd5'].includes(row.release), String(row?.release))

  console.log('\n③ 다시 돌려도 덮지 않는다')
  const again = run('scripts/stage-controller.mts', ['--apply'])
  const row2 = await prisma.stageDecision.findUnique({ where: { kstDate: today } })
  check('exit 0 · 이미 있어 읽었다', again.code === 0 && /이미 있어 읽었다/.test(again.out), again.out.slice(-300))
  check('🔴 행이 그대로다(createdAt · decidedAt 동일)',
    row !== null && row2 !== null && row.createdAt.getTime() === row2.createdAt.getTime()
    && row.decidedAt.getTime() === row2.decidedAt.getTime())

  console.log('\n④ consumer — 결정을 러너 env 로 옮긴다')
  const pr = run('scripts/stage-consume-exec.mts', ['--by=publish', '--print'])
  check('flag ON → 공개·천장 = 결정 · window 허가 빈 값',
    pr.code === 0 && pr.out.includes(`SORAN_RELEASE_STAGE=${row?.release ?? '?'}`) && pr.out.includes('SORAN_CAPACITY_STAGE=d10')
    && /^SORAN_RELEASE_WINDOW_STAGE=$/m.test(pr.out), pr.out)
  const child = run('scripts/stage-consume-exec.mts', ['--by=supply', '--', process.execPath, '-e', 'console.log("REL="+process.env.SORAN_RELEASE_STAGE)'])
  check('🔴 감싼 명령이 결정 값을 본다', child.out.includes(`REL=${row?.release ?? '?'}`), child.out + child.err.slice(-200))
  const code7 = run('scripts/stage-consume-exec.mts', ['--by=publish', '--', process.execPath, '-e', 'process.exit(7)'])
  check('감싼 명령의 종료 코드를 그대로 돌려준다', code7.code === 7, String(code7.code))
  writeEnv('off')
  const legacy = run('scripts/stage-consume-exec.mts', ['--by=publish', '--print'])
  check('🔴 flag OFF → 아무것도 넣지 않는다(legacy)', legacy.code === 0 && legacy.out.trim() === '', legacy.out)

  console.log('\n⑤ DB 에 못 닿으면')
  writeEnv('on')
  const DEAD = 'postgresql://nobody@127.0.0.1:1/soran_test'
  const dead = run('scripts/stage-controller.mts', ['--apply'], { DATABASE_URL: DEAD, DIRECT_URL: DEAD })
  check('🔴 controller 는 아무것도 쓰지 않고 exit 1', dead.code === 1, `${dead.code} ${dead.err.slice(-300)}`)
  const deadConsume = run('scripts/stage-consume-exec.mts', ['--by=publish', '--print'], { DATABASE_URL: DEAD, DIRECT_URL: DEAD })
  check('🔴 consumer 는 가장 안전한 d1 로 간다', deadConsume.code === 0 && deadConsume.out.includes('SORAN_RELEASE_STAGE=d1'), deadConsume.out)
} finally {
  await prisma.stageDecision.deleteMany({ where: { kstDate: { in: [today, yesterday] } } })
  await prisma.$disconnect()
  rmSync(HOME, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
