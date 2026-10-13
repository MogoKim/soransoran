#!/usr/bin/env tsx
/**
 * 운영 적용 열림 — **순수 반례** (DB · 네트워크 0 · 사실은 주입) · 2026-10-02 Phase G
 *
 *   ① 플래그 조합 — 운영은 `--apply --production --target=<SHA>` 셋 다일 때만
 *   ② 승인 — digest · expect · reason 하나라도 없으면 거부
 *   ③ 다섯 SHA 중 하나만 달라도 · 모르면 거부 · dirty runtime · writer 실행 중/모름 · env 이상 거부
 *   ④ `openActivation` — 운영이 아니면 사실을 모으지 않는다 · 운영 열림이면 canonical env 로 DB 주소를 덮는다
 *   ⑤ 두 CLI 가 DB 에 붙기 **전에** 열림을 판정한다(소스 순서)
 *   ⑥ (2026-10-13) staged 운영 — staging 트리=target · runtime 은 옛 SHA 그대로 · defect-resolve 만 받는다
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  activationModeOf, approvalOf, productionGuardProblems, stagedGuardProblems, writerStateOf, type ProductionFacts,
} from '../src/lib/production-activation-guard'
import { D100_WRITER_JOBS, openActivation, type FactPaths } from './lib/production-activation.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const T = '0123456789abcdef0123456789abcdef01234567'
const OTHER = 'f'.repeat(40)
const good = (): ProductionFacts => ({
  originMain: T, repoHead: T, runtimeHead: T, runtimePin: T, runtimeManifestSha: T, runtimeClean: true,
  writers: D100_WRITER_JOBS.map((label) => ({ label, state: 'idle' as const })),
  canonicalEnv: { read: true, hasDatabaseUrl: true, looksIsolated: false },
})

console.log('\n① 플래그')
{
  check('플래그 없음 → dry-run', activationModeOf({ apply: false, production: false, target: null }).mode === 'dry-run')
  check('--apply 만 → 격리(기존 그대로)', activationModeOf({ apply: true, production: false, target: null }).mode === 'isolated')
  check('🔴 --production 만 → 거부', activationModeOf({ apply: false, production: true, target: T }).mode === 'refuse')
  check('🔴 --apply --target(운영 플래그 없음) → 거부', activationModeOf({ apply: true, production: false, target: T }).mode === 'refuse')
  check('🔴 --apply --production · target 없음 → 거부', activationModeOf({ apply: true, production: true, target: null }).mode === 'refuse')
  check('🔴 짧은 · 대문자 SHA → 거부', activationModeOf({ apply: true, production: true, target: T.slice(0, 12) }).mode === 'refuse'
    && activationModeOf({ apply: true, production: true, target: T.toUpperCase() }).mode === 'refuse')
  check('셋 다 → 운영', activationModeOf({ apply: true, production: true, target: T }).mode === 'production')
}

console.log('\n② 승인')
{
  const ok = approvalOf({ digest: 'a'.repeat(24), expect: '19:24', reason: '배포 뒤 계약 유효 복구' })
  check('digest · expect · reason → 열림 · expect 파싱', ok.ok && ok.approval.expected.before === 19 && ok.approval.expected.after === 24)
  check('🔴 digest 없음 → 거부', !approvalOf({ digest: null, expect: '19:24', reason: 'x' }).ok)
  check('🔴 digest 모양 틀림 → 거부', !approvalOf({ digest: 'xyz', expect: '19:24', reason: 'x' }).ok)
  check('🔴 expect 없음 · 모양 틀림 → 거부', !approvalOf({ digest: 'a'.repeat(24), expect: null, reason: 'x' }).ok
    && !approvalOf({ digest: 'a'.repeat(24), expect: '24', reason: 'x' }).ok)
  check('🔴 reason 비었음 → 거부', !approvalOf({ digest: 'a'.repeat(24), expect: '19:24', reason: '  ' }).ok)
}

console.log('\n③ 사실')
{
  check('전부 같음 · 깨끗 · writer idle · env 정상 → 열림', productionGuardProblems(T, good()).length === 0, productionGuardProblems(T, good()).join(' / '))
  for (const k of ['originMain', 'repoHead', 'runtimeHead', 'runtimePin', 'runtimeManifestSha'] as const) {
    check(`🔴 ${k} 하나만 다름 → 거부`, productionGuardProblems(T, { ...good(), [k]: OTHER }).length === 1)
    check(`🔴 ${k} 모름 → 거부`, productionGuardProblems(T, { ...good(), [k]: null }).length === 1)
  }
  check('🔴 dirty runtime → 거부', productionGuardProblems(T, { ...good(), runtimeClean: false }).some((p) => p.includes('변경')))
  check('🔴 runtime 상태 모름 → 거부', productionGuardProblems(T, { ...good(), runtimeClean: null }).length === 1)
  const w = good().writers.map((x, i) => (i === 0 ? { ...x, state: 'running' as const } : x))
  check('🔴 writer 하나 실행 중 → 거부(unload 하지 않는다)', productionGuardProblems(T, { ...good(), writers: w }).some((p) => p.includes('실행 중')))
  const u = good().writers.map((x, i) => (i === 1 ? { ...x, state: 'unknown' as const } : x))
  check('🔴 writer 상태 모름 → 거부', productionGuardProblems(T, { ...good(), writers: u }).some((p) => p.includes('모름')))
  check('🔴 writer 를 하나도 못 쟀다 → 거부', productionGuardProblems(T, { ...good(), writers: [] }).length === 1)
  check('🔴 canonical env 못 읽음 · DB 없음 · 격리 모양 → 거부',
    productionGuardProblems(T, { ...good(), canonicalEnv: { read: false, hasDatabaseUrl: false, looksIsolated: false } }).length === 1
    && productionGuardProblems(T, { ...good(), canonicalEnv: { read: true, hasDatabaseUrl: false, looksIsolated: false } }).length === 1
    && productionGuardProblems(T, { ...good(), canonicalEnv: { read: true, hasDatabaseUrl: true, looksIsolated: true } }).length === 1)
  check('🔴 거부 문구에 SHA 전체 · 주소가 없다', productionGuardProblems(T, { ...good(), repoHead: OTHER }).every((p) => !p.includes(OTHER) && !p.includes('postgresql')))
  check('writer 목록 = 공급 job + 같은 트리 writer(중복 0 · 비지 않음)', D100_WRITER_JOBS.length > 0 && new Set(D100_WRITER_JOBS).size === D100_WRITER_JOBS.length)
  check('launchctl: state = running → running', writerStateOf({ label: 'x', exitCode: 0, stdout: '\tstate = running\n', stderr: '' }) === 'running')
  check('launchctl: state = not running → idle', writerStateOf({ label: 'x', exitCode: 0, stdout: '\tstate = not running\n', stderr: '' }) === 'idle')
  check('launchctl: 서비스 없음 → idle', writerStateOf({ label: 'x', exitCode: 113, stdout: '', stderr: 'Could not find service "x" in domain' }) === 'idle')
  check('🔴 launchctl: 다른 실패 · state 없음 → unknown', writerStateOf({ label: 'x', exitCode: 5, stdout: '', stderr: 'boom' }) === 'unknown'
    && writerStateOf({ label: 'x', exitCode: 0, stdout: 'no state line', stderr: '' }) === 'unknown'
    && writerStateOf({ label: 'x', exitCode: null, stdout: '', stderr: '' }) === 'unknown')
}

console.log('\n④ openActivation (사실 주입)')
{
  const dir = mkdtempSync(join(tmpdir(), 'soran-activation-'))
  const envFile = join(dir, 'env.local')
  writeFileSync(envFile, 'DATABASE_URL="postgresql://canon@db.canon.invalid:5432/postgres"\nDIRECT_URL=postgresql://canon@db.canon.invalid:5432/postgres\n')
  const paths: FactPaths = { repoRoot: dir, runtimeRoot: dir, canonDir: dir, envFile }
  let collected = 0
  const collect = (f: ProductionFacts) => (): ProductionFacts => { collected += 1; return f }
  const prodArgs = ['--apply', '--production', `--target=${T}`, '--digest=' + 'a'.repeat(24), '--expect=19:24', '--reason=배포 뒤']
  const saved = { ...process.env }
  delete process.env.SORAN_ISOLATED_DB
  try {
    check('dry-run · 격리 apply 는 사실을 모으지 않는다(fetch 0)', openActivation([], { repoRoot: dir, paths, collect: collect(good()) }).kind === 'dry-run'
      && openActivation(['--apply'], { repoRoot: dir, paths, collect: collect(good()) }).kind === 'isolated' && collected === 0)
    process.env.DATABASE_URL = 'postgresql://inherited@localhost:5432/soran_test'
    const ok = openActivation(prodArgs, { repoRoot: dir, paths, collect: collect(good()) })
    check('🟢 전부 맞으면 운영 열림 · 승인 전달', ok.kind === 'production' && ok.approval.expected.after === 24 && collected === 1)
    check('🔴 운영 열림이면 물려받은 DB 주소를 canonical 값으로 덮는다', process.env.DATABASE_URL === 'postgresql://canon@db.canon.invalid:5432/postgres')
    const bad = openActivation(prodArgs, { repoRoot: dir, paths, collect: collect({ ...good(), runtimePin: OTHER }) })
    check('🔴 pin 하나 다름 → 거부', bad.kind === 'refuse')
    const noApproval = openActivation(prodArgs.filter((a) => !a.startsWith('--digest')), { repoRoot: dir, paths, collect: collect(good()) })
    check('🔴 승인 누락이면 사실도 모으지 않고 거부', noApproval.kind === 'refuse' && collected === 2)
    process.env.SORAN_ISOLATED_DB = 'yes-throwaway'
    check('🔴 격리 env 가 켜진 채 운영 플래그 → 거부', openActivation(prodArgs, { repoRoot: dir, paths, collect: collect(good()) }).kind === 'refuse')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
}

console.log('\n⑤ CLI 순서 — 열림 판정이 DB 접속보다 먼저')
{
  for (const f of ['scripts/persona-contract-remediation.mts', 'scripts/auto-ready-defect-resolve.mts']) {
    const src = readFileSync(f, 'utf-8')
    const open = src.indexOf('openActivation(argv')
    const db = src.indexOf('new PrismaClient()')
    check(`${f} — openActivation 이 PrismaClient 보다 먼저`, open > 0 && db > open)
  }
}

console.log('\n⑥ 🔴 staged 운영 — 활성화 전 새 계약 해소 기록 (2026-10-13)')
{
  const PREV = 'c'.repeat(40)
  const staged = (): ProductionFacts => ({
    ...good(), runtimeHead: PREV, runtimePin: PREV, runtimeManifestSha: PREV, repoClean: true, runtimeIsAncestorOfTarget: true,
  })
  check('플래그 — --staged 는 --apply --production --target 과 함께만', activationModeOf({ apply: true, production: true, target: T, staged: true }).mode === 'production'
    && activationModeOf({ apply: true, production: false, target: null, staged: true }).mode === 'refuse'
    && activationModeOf({ apply: false, production: false, target: null, staged: true }).mode === 'refuse')
  check('🟢 staging=target · runtime 옛 SHA 셋 일치 · 조상 · 깨끗 · writer idle → 열림', stagedGuardProblems(T, staged()).length === 0, stagedGuardProblems(T, staged()).join(' / '))
  check('🔴 같은 사실을 일반 운영 판정에 넣으면 거부 — 옛 runtime 위에서 쓰는 길은 staged 하나다', productionGuardProblems(T, staged()).length > 0)
  for (const [why, f] of [
    ['staging HEAD ≠ target', { repoHead: OTHER }],
    ['origin/main ≠ target', { originMain: OTHER }],
    ['staging 트리 변경 있음', { repoClean: false }],
    ['staging 트리 상태 모름', { repoClean: null }],
    ['runtime pin ≠ HEAD', { runtimePin: OTHER }],
    ['runtime manifest 모름', { runtimeManifestSha: null }],
    ['runtime 이 이미 target', { runtimeHead: T, runtimePin: T, runtimeManifestSha: T }],
    ['runtime 이 target 의 조상이 아님(되돌아가기)', { runtimeIsAncestorOfTarget: false }],
    ['조상 관계 모름', { runtimeIsAncestorOfTarget: null }],
    ['runtime 트리 변경 있음', { runtimeClean: false }],
    ['writer job 실행 중', { writers: [{ label: D100_WRITER_JOBS[0]!, state: 'running' as const }] }],
    ['writer job 상태 모름', { writers: [{ label: D100_WRITER_JOBS[0]!, state: 'unknown' as const }] }],
    ['canonical env 가 격리 DB', { canonicalEnv: { read: true, hasDatabaseUrl: true, looksIsolated: true } }],
  ] as const) {
    check(`🔴 staged — ${why} → 거부`, stagedGuardProblems(T, { ...staged(), ...f }).length > 0)
  }
  const dir = mkdtempSync(join(tmpdir(), 'soran-staged-'))
  const envFile = join(dir, '.env.local')
  writeFileSync(envFile, 'DATABASE_URL="postgresql://canon@db.canon.invalid:5432/postgres"\nDIRECT_URL=postgresql://canon@db.canon.invalid:5432/postgres\n')
  const paths: FactPaths = { repoRoot: dir, runtimeRoot: dir, canonDir: dir, envFile }
  const args = ['--apply', '--production', '--staged', `--target=${T}`, '--digest=' + 'a'.repeat(64), '--expect=1:0', '--reason=v8 전환']
  const saved = { ...process.env }
  delete process.env.SORAN_ISOLATED_DB
  try {
    const no = openActivation(args, { repoRoot: dir, paths, collect: () => staged() })
    check('🔴 🔴 **허용하지 않은 CLI(persona 등)는 --staged 를 거부**', no.kind === 'refuse')
    const yes = openActivation(args, { repoRoot: dir, paths, collect: () => staged(), allowStaged: true })
    check('🟢 defect-resolve(허용) → staged 운영 열림', yes.kind === 'production' && yes.staged === true)
    const back = openActivation(args, { repoRoot: dir, paths, collect: () => ({ ...staged(), runtimeIsAncestorOfTarget: false }), allowStaged: true })
    check('🔴 허용해도 사실이 어긋나면 거부', back.kind === 'refuse')
    const plain = openActivation(args.filter((a) => a !== '--staged'), { repoRoot: dir, paths, collect: () => staged(), allowStaged: true })
    check('🔴 --staged 없이 옛 runtime 사실이면 일반 운영 판정으로 거부', plain.kind === 'refuse')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
  const persona = readFileSync('scripts/persona-contract-remediation.mts', 'utf-8')
  const resolve = readFileSync('scripts/auto-ready-defect-resolve.mts', 'utf-8')
  check('🔴 staged 를 받는 CLI 는 defect-resolve 하나 — persona 는 allowStaged 를 넘기지 않는다', !persona.includes('allowStaged') && resolve.includes('allowStaged: true'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail — DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
