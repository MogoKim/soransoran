#!/usr/bin/env tsx
/**
 * 창업자 gold 검사 — 🔴 **quality-v4 의 열림 근거가 사실인가** (2026-09-28)
 *
 *   ① 재생 — 지금 초안 게이트가 창업자 판정 30건을 그대로 재현한다
 *      (통과 22 과차단 0 · 중대 결함 3 확정 차단 · 수정 2 · 폐기 6 자동 READY 0)
 *   ② 불변 — 고정 digest · 1~30 순서 · id · 판정 · 결함 표시. 변조 반례는 전부 닫힘이어야 한다
 *   ③ 카드 스냅샷 = 정본 카드(게이트 칸)
 *   ④ 러너 경로 — 새 생성 · 캐시 채택 둘 다 `runContentCore → pickV2` 로 같은 답
 *   ⑤ 열림 근거 — gold 재현 · 사람 중대 결함 0 일 때만 증거 충족 · 스위치 · 감사 결함은 그대로 닫는다
 *   ⑥ 품질 계약 digest 에 gold digest · 열림 근거가 들어간다
 *
 *   🔴 네트워크 0 · provider 0 · DB 0.
 */
import { readFileSync } from 'node:fs'
import {
  replayFounderGold, founderGoldDigestOf, founderGoldShapeProblems, describeFounderGold, goldWant,
  FOUNDER_GOLD_PINNED_DIGEST, FOUNDER_GOLD_SHAPE, type FounderGoldRow,
} from '../src/lib/founder-gold'
import { FOUNDER_GOLD_V1_ROWS } from '../src/lib/founder-gold-v1.data'
import { applyFounderGoldBasis, type QualityCohortVerdict } from '../src/lib/auto-ready-quality-cohort'
import { judgeOpen } from '../src/lib/auto-ready-v2'
import { qualityContractComponents, QUALITY_CONTRACT_VERSION, QUALITY_EVIDENCE_BASIS } from '../src/lib/quality-contract'
import { GOLD_FIXTURES, GOLD_CARD_KEYS } from './lib/founder-gold-fixtures.mjs'
import { runFixturePath } from './lib/draft-gate-fixtures.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const clone = (): FounderGoldRow[] => JSON.parse(JSON.stringify(FOUNDER_GOLD_V1_ROWS)) as FounderGoldRow[]

console.log('\n══ 창업자 gold (quality-v4 열림 근거) — 🔴 provider 0 · DB 0 ══\n')

console.log('① 재생 — 지금 게이트가 창업자 판정 30건을 재현한다')
const g = replayFounderGold()
console.log(`   ${describeFounderGold(g)}`)
for (const r of g.results) {
  check(`#${String(r.n).padStart(2)} 기대 ${r.want} · 지금 ${r.got}${r.codes.length ? ` (${r.codes.join(',')})` : ''}`, r.ok)
}
check('🔴 🔴 **30/30 재현 · 통과 과차단 0 · 결함 누출 0 · 수정·폐기 자동 READY 0**',
  g.pass && g.counts.ok === 30 && g.counts.overBlockedPass === 0 && g.counts.leakedHard === 0 && g.counts.autoReadyNonPass === 0,
  g.reasons.join(' · '))

console.log('\n② 불변 — 고정 digest · 순서 · id · 판정 · 결함. 변조하면 닫힌다')
check('데이터 digest = 고정값', founderGoldDigestOf(FOUNDER_GOLD_V1_ROWS) === FOUNDER_GOLD_PINNED_DIGEST)
check('모양 = 창업자 확정값(30 · 통과 22 · 수정 2 · 폐기 6 · 결함 3)', founderGoldShapeProblems(FOUNDER_GOLD_V1_ROWS).length === 0
  && FOUNDER_GOLD_SHAPE.pass.length === 22 && FOUNDER_GOLD_SHAPE.edit.length === 2
  && FOUNDER_GOLD_SHAPE.decline.length === 6 && FOUNDER_GOLD_SHAPE.hardDefect.length === 3)
{
  const tamper: [string, (rows: FounderGoldRow[]) => FounderGoldRow[]][] = [
    ['#4 중대 결함 표시를 지운다(판정 완화)', (r) => { r[3]!.hardDefect = false; return r }],
    ['#28 폐기를 통과로 바꾼다', (r) => { r[27]!.verdict = 'pass'; return r }],
    ['#2 통과를 폐기로 바꾼다(과차단을 숨긴다)', (r) => { r[1]!.verdict = 'decline'; return r }],
    ['#10 초안 한 글자를 바꾼다', (r) => { r[9]!.draft.body = r[9]!.draft.body.replace('5년', '25년'); return r }],
    ['#1 과 #2 순서를 바꾼다', (r) => [r[1]!, r[0]!, ...r.slice(2)]],
    ['한 행을 뺀다(29건)', (r) => r.slice(0, 29)],
    ['#22 원천 시각을 채운다(시각 모름 → 같은 날)', (r) => { r[21]!.source.postedAt = r[21]!.runAt; return r }],
  ]
  for (const [label, f] of tamper) {
    const t = replayFounderGold(f(clone()))
    check(`🔴 변조 — ${label} → 재현 실패(닫힘)`, !t.pass, t.reasons.slice(0, 2).join(' · '))
  }
}

// 🔴 행 판정 자체 — 폐기 행(#1)이 게이트를 통과하게 되면 그 행은 불일치다(digest 와 별개로 · 변이 V16)
{
  const t = clone()
  t[0]!.plan = { ...t[0]!.plan, closingIntent: 'share' }
  const r1 = replayFounderGold(t).results.find((x) => x.n === 1)!
  check('🔴 🔴 **폐기 행이 게이트를 통과하게 되면 그 행 = 불일치(자동 READY 누출로 센다)**', r1.got === 'pass' && !r1.ok, JSON.stringify(r1))
  const t2 = clone()
  t2[3]!.draft = { ...t2[3]!.draft, body: '요즘 젊은 분들은 차례 안 지내나요?' }
  const r4 = replayFounderGold(t2).results.find((x) => x.n === 4)!
  check('🔴 🔴 **중대 결함 행이 확정 차단을 벗어나면 그 행 = 불일치**', r4.got !== 'hold' && !r4.ok, JSON.stringify(r4))
}

console.log('\n③ 카드 스냅샷 = 정본 카드(게이트 칸)')
for (const { row, fx } of GOLD_FIXTURES) {
  const snap = row.card as unknown as Record<string, unknown>
  const real = fx.card as unknown as Record<string, unknown>
  const diff = GOLD_CARD_KEYS.filter((k) => JSON.stringify(snap[k] ?? null) !== JSON.stringify(real[k] ?? null))
  check(`#${row.n} ${row.plan.personaCode} 카드 게이트 칸이 정본과 같다`, diff.length === 0, diff.join(','))
}

console.log('\n④ 러너 경로 — 새 생성 · 캐시 채택 (runContentCore → pickV2)')
for (const cached of [false, true]) {
  const tag = cached ? '캐시 채택' : '새 생성'
  for (const { row, fx } of GOLD_FIXTURES) {
    const r = await runFixturePath(fx, { cachedAdopt: cached })
    const want = goldWant(row)
    const adoptClean = r.pick?.decision === 'AUTO_ADOPT' && Array.isArray(r.pick.lifeReview) && r.pick.lifeReview.length === 0
    const askedReview = r.asks.some((a) => a.stage === 'semanticReview')
    const got = r.pick === null ? `artifact ${r.art.review.machineOutcome}(${r.art.review.machineReason.slice(0, 40)})`
      : `${r.pick.decision} · ${r.pick.reason} · lifeReview ${JSON.stringify(r.pick.lifeReview)}`
    if (want === 'pass') check(`${tag} · #${row.n} 통과 → AUTO_ADOPT · 경고 없음(자동 READY 후보)`, adoptClean, got)
    else if (want === 'hold') {
      check(`🔴 ${tag} · #${row.n} 중대 결함 → AUTO_HOLD${cached ? '' : ' · 유료 의미 검수 전'}`,
        r.pick?.decision === 'AUTO_HOLD' && (cached || !askedReview), `${got} · 검수 ${String(askedReview)}`)
    } else check(`🟡 ${tag} · #${row.n} ${row.verdict} → 자동 READY 아님(AUTO_HOLD 또는 사람 검토 경고)`, !adoptClean && r.pick !== null, got)
  }
}

console.log('\n⑤ 열림 근거 — gold 재현 + 사람 중대 결함 0 일 때만 증거 충족')
{
  const base = { meetsContract: false, reasons: ['무수정 0/30 < 27'], cohortHardDefects: 0 } as unknown as QualityCohortVerdict
  const ok = { pass: true, reasons: [], summary: 'ok' }
  const bad = { pass: false, reasons: ['#4 기대 hold · 지금 pass'], summary: 'bad' }
  const a = applyFounderGoldBasis(base, ok)
  check('🟢 gold 재현 · 사람 결함 0 → 증거 충족(사람 30건 표본 없이)', a.meetsContract && a.basis === 'founderGold', a.reasons.join(' · '))
  check('🔴 gold 재현 실패 → 증거 미달', !applyFounderGoldBasis(base, bad).meetsContract)
  check('🔴 지금 계약 행에 사람 중대 결함 1건 → 증거 미달',
    !applyFounderGoldBasis({ ...base, cohortHardDefects: 1 } as QualityCohortVerdict, ok).meetsContract)
  check('🔴 증거 충족이어도 스위치 OFF → 닫힘', !judgeOpen({ enabled: false, evidence: a, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('🔴 증거 충족 · 스위치 ON · 발행 뒤 감사 결함 1 → 닫힘', !judgeOpen({ enabled: true, evidence: a, confirmedDefects: 1, missingAutoPosts: 0 }).open)
  check('🔴 증거 충족 · 스위치 ON · 글 유실 1 → 닫힘', !judgeOpen({ enabled: true, evidence: a, confirmedDefects: 0, missingAutoPosts: 1 }).open)
  check('🟢 증거 충족 · 스위치 ON · 결함 0 · 유실 0 → 열림', judgeOpen({ enabled: true, evidence: a, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('품질 계약의 열림 근거 = founderGold', QUALITY_EVIDENCE_BASIS === 'founderGold')
  const repo = readFileSync('src/lib/auto-ready-repo.ts', 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('🔴 🔴 **런타임 증거(`evidenceFromDb`)가 gold 재생을 적용한다 — 도장·발행 트랜잭션이 같은 함수를 쓴다**',
    /applyFounderGoldBasis\(cohort,\s*\{\s*pass:\s*g\.pass/.test(repo) && /const g = replayFounderGold\(\)/.test(repo))
}

console.log('\n⑥ 품질 계약 — gold 가 digest 에 들어갔다')
{
  const c = qualityContractComponents() as Record<string, any>
  check(`판 = quality-v4 (지금 ${QUALITY_CONTRACT_VERSION})`, QUALITY_CONTRACT_VERSION === 'quality-v4')
  check('digest 구성에 열림 근거 · gold 판 · 고정 digest · 모양이 있다',
    c.evidenceBasis === 'founderGold' && c.founderGold?.digest === FOUNDER_GOLD_PINNED_DIGEST
    && JSON.stringify(c.founderGold?.shape) === JSON.stringify(FOUNDER_GOLD_SHAPE))
}

console.log('\n⑦ 스위치 — 한 명령으로 켜고 끈다 · 다른 키 변화 0 (임시 env)')
{
  const { mkdtempSync, writeFileSync, readFileSync: rd, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { spawnSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'ar-switch-'))
  const env = join(dir, 'env.local')
  const orig = 'A=1\nSORAN_LLM_DAILY_BUDGET_USD=0.50\nB="x y"\n'
  writeFileSync(env, orig)
  const run = (...a: string[]) => spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/auto-ready-switch.mts', ...a, `--env=${env}`], { encoding: 'utf8' })
  const dry = run('--on')
  check('dry-run 은 env 를 바꾸지 않는다', dry.status === 0 && rd(env, 'utf8') === orig)
  const on = run('--on', '--apply')
  const afterOn = rd(env, 'utf8')
  check('--on --apply → SORAN_AUTO_READY_ENABLED=on 한 줄만 더해진다',
    on.status === 0 && afterOn.split('\n').filter((l) => l === 'SORAN_AUTO_READY_ENABLED=on').length === 1
    && afterOn.replace('SORAN_AUTO_READY_ENABLED=on\n', '') === orig)
  const off = run('--off', '--apply')
  check('🔴 --off --apply → 원본과 바이트까지 같다(끄기 = 한 명령)', off.status === 0 && rd(env, 'utf8') === orig)
  check('--on 과 --off 를 함께 주면 거절', run('--on', '--off').status === 2)
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
