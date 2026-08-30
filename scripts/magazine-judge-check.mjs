#!/usr/bin/env node
/**
 * PASS/FAIL/UNKNOWN 판정 회귀 테스트 (M-AUTO-3)
 *
 * 🔴 지켜야 할 것이 두 가지다.
 *    ① **UNKNOWN 은 PASS 로 흘러가지 않는다** — 하나라도 있으면 자동 등록 대상이 아니다
 *    ② **UNKNOWN 이 소음이 되지 않는다** — 글마다 두세 개여야 창업자가 읽는다
 *
 * 파일을 쓰지 않고 LLM 도 부르지 않는다.
 *
 * 실행: node scripts/magazine-judge-check.mjs
 */

import { loadArticles } from './lib/magazine-load.mjs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './lib/magazine-load.mjs'
import { collectUnknowns, decide, autoRegisterable, VERDICT, CLUSTER_CROWDED } from './lib/magazine-judge.mjs'

/** 등록 전 draft 를 흉내 낼 유일한 자료 — 미등록 draft 가 repo 에 0건이다 */
const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine-packet/high/article-draft.ts')

/**
 * 리포트를 JSON 으로 받는다.
 * 🔴 FAIL 이면 종료 코드가 1 이라 execFileSync 가 던진다. 그건 실패가 아니라 판정이다 —
 *    stdout 을 회수해서 그대로 쓴다.
 */
function runReport(args) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [join(ROOT, 'scripts/magazine-judge-report.mjs'), ...args, '--json'], {
        encoding: 'utf8',
        cwd: ROOT,
      }),
    )
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout)
    throw err
  }
}

let failed = 0
let passed = 0
const expect = (label, actual, want) => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}
const ids = (list) => list.map((u) => u.id)

console.log('\n══════ decide — UNKNOWN 은 PASS 로 흘러가지 않는다')
expect('FAIL 있으면 FAIL', decide({ qaFail: 1, unknowns: [] }), VERDICT.FAIL)
expect('FAIL 이 UNKNOWN 을 이긴다', decide({ qaFail: 1, unknowns: [{}] }), VERDICT.FAIL)
expect('UNKNOWN 있으면 UNKNOWN', decide({ qaFail: 0, unknowns: [{}] }), VERDICT.UNKNOWN)
expect('둘 다 없으면 PASS', decide({ qaFail: 0, unknowns: [] }), VERDICT.PASS)
expect('자동 등록은 PASS 뿐', autoRegisterable(VERDICT.PASS), true)
expect('UNKNOWN 은 자동 등록 불가', autoRegisterable(VERDICT.UNKNOWN), false)
expect('FAIL 은 자동 등록 불가', autoRegisterable(VERDICT.FAIL), false)

const published = loadArticles()
const article = (slug) => published.find((a) => a.slug === slug)
const bodyOf = (a) => {
  const out = []
  for (const b of a.body ?? []) {
    if (b.text) out.push(b.text)
    if (b.items) out.push(...b.items)
  }
  return out.join('\n')
}

console.log('\n══════ which-clinic-menopause — 이 아크의 기준 샘플')
{
  const a = article('which-clinic-menopause')
  const u = collectUnknowns({ article: a, bodyText: bodyOf(a), published })
  expect('UNKNOWN 3건', u.length, 3)
  expect('  J-과역할', ids(u).includes('J-과역할'), true)
  expect('  J-내과경로', ids(u).includes('J-내과경로'), true)
  expect('  J-톤기준선 (clinic 첫 글)', ids(u).includes('J-톤기준선'), true)
  expect('  근거가 본문 문장이다', u[0].where.includes('산부인과에서는 폐경과 호르몬'), true)
  expect('  J-판단회피는 안 뜬다 (hedge 있음)', ids(u).includes('J-판단회피'), false)
  expect('  J-기관명은 안 뜬다', ids(u).includes('J-기관명'), false)
  expect('  J-진료지연은 안 뜬다', ids(u).includes('J-진료지연'), false)
}

console.log('\n══════ 소음 억제 — UNKNOWN 이 매번 쏟아지지 않는가')
{
  const counts = published.map((a) => collectUnknowns({ article: a, bodyText: bodyOf(a), published }).length)
  const max = Math.max(...counts)
  const avg = counts.reduce((s, n) => s + n, 0) / counts.length
  console.log(`     등록 ${published.length}건 · 최대 ${max}건 · 평균 ${avg.toFixed(2)}건`)
  expect('한 글에 4건을 넘지 않는다', max <= 3, true)
  expect('평균 2건 이하', avg <= 2, true)
  expect('UNKNOWN 0건인 글이 있다 (전부 뜨는 게 아니다)', counts.some((n) => n === 0), true)
}

console.log('\n══════ 트리거 — 조건이 맞을 때만 묻는다')
{
  const base = { cluster: 'daily', title: 'x', slug: 'x', medical: true }

  // hedge 가 있으면 판단회피를 묻지 않는다
  const withHedge = collectUnknowns({ article: base, bodyText: '증상은 사람마다 다릅니다.', published: [] })
  expect('hedge 있으면 J-판단회피 없음', ids(withHedge).includes('J-판단회피'), false)

  const noHedge = collectUnknowns({ article: base, bodyText: '증상이 나타납니다.', published: [] })
  expect('hedge 없으면 J-판단회피 발동', ids(noHedge).includes('J-판단회피'), true)

  // 비의료 cluster 는 판단회피를 묻지 않는다
  const money = collectUnknowns({ article: { ...base, cluster: 'money-work' }, bodyText: '연금이 있습니다.', published: [] })
  expect('money-work 는 J-판단회피 없음', ids(money).includes('J-판단회피'), false)

  // 상호명
  const inst = collectUnknowns({ article: base, bodyText: '가까운 행복의원에서 진료를 받았습니다.', published: [] })
  expect('상호명이 있으면 J-기관명 발동', ids(inst).includes('J-기관명'), true)
  const general = collectUnknowns({ article: base, bodyText: '가까운 대학병원에서 확인해 보세요. 사람마다 다릅니다.', published: [] })
  expect('일반명사(대학병원)는 묻지 않는다', ids(general).includes('J-기관명'), false)

  // 진료 지연 — deterministic 오탐이 났던 실문장
  const delay = collectUnknowns({
    article: base,
    bodyText: '병원에 갈 정도는 아닌 것 같고, 그렇다고 매일 참기에는 신경 쓰이지요. 사람마다 다릅니다.',
    published: [],
  })
  expect('지연 표현이 있으면 J-진료지연 발동', ids(delay).includes('J-진료지연'), true)

  // 어절 경계 — "동안과" 의 '안과' (D5 에서 잡은 함정)
  const boundary = collectUnknowns({
    article: base,
    bodyText: '걷는 동안과 걷고 난 뒤 몸이 어떤지 살펴보는 편이 좋습니다. 사람마다 다릅니다.',
    published: [],
  })
  expect('"동안과" 는 진료과가 아니다', ids(boundary).includes('J-과역할'), false)
}

console.log('\n══════ 소재 중복 임계')
{
  const base = { cluster: 'daily', title: 'x', slug: 'x', medical: false }
  const few = Array.from({ length: CLUSTER_CROWDED - 1 }, (_, i) => ({ slug: `a${i}`, cluster: 'daily', title: `t${i}` }))
  const many = Array.from({ length: CLUSTER_CROWDED }, (_, i) => ({ slug: `a${i}`, cluster: 'daily', title: `t${i}` }))
  expect(`${CLUSTER_CROWDED - 1}건이면 묻지 않는다`, ids(collectUnknowns({ article: base, bodyText: 'x', published: few })).includes('J-소재중복'), false)
  expect(`${CLUSTER_CROWDED}건이면 묻는다`, ids(collectUnknowns({ article: base, bodyText: 'x', published: many })).includes('J-소재중복'), true)
  expect('첫 글이면 J-톤기준선', ids(collectUnknowns({ article: base, bodyText: 'x', published: [] })).includes('J-톤기준선'), true)
}

console.log('\n══════ 등록 전 draft 를 실제로 읽는가 (loadTarget 결함 회귀)')
{
  // 🔴 runQa() 반환에는 targets 가 없다. 한때 qa.targets?.[0] 을 기대했고,
  //    미등록 draft 가 0건이라 드러나지 않았다. 등록 전 HIGH 원고를 보는 것이
  //    M-AUTO-3 의 핵심이므로 이 경로를 fixture 로 고정한다.
  const r = runReport(['--path', FIXTURE])
  expect('draft-only 리포트가 만들어진다', Boolean(r.slug), true)
  expect('  출처가 article-draft.ts', r.source, 'article-draft.ts')
  expect('  error 가 없다', r.error === undefined, true)
  expect('  article 을 읽었다 (cluster)', r.cluster, 'clinic')
  expect('  deterministic 6종이 돈다', r.deterministic.length, 6)
  expect('  verdict 가 셋 중 하나다', [VERDICT.PASS, VERDICT.FAIL, VERDICT.UNKNOWN].includes(r.verdict), true)
}

console.log('\n══════ 없는 slug 는 명확한 에러')
{
  const r = runReport(['--slug', 'no-such-slug-xyz'])
  expect('error 를 낸다', Boolean(r.error), true)
  expect('  메시지에 slug 가 있다', r.error.includes('no-such-slug-xyz'), true)
}

console.log('\n══════ --all-high 는 에러 없이 끝난다')
{
  let ok = true
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/magazine-judge-report.mjs'), '--all-high', '--json'], {
      encoding: 'utf8', cwd: ROOT,
    })
  } catch {
    ok = false
  }
  expect('--all-high 종료 코드 0', ok, true)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
