#!/usr/bin/env tsx
/**
 * Raw 공급망 규칙 fixture — 🔴 DB · 네트워크 · 파일 없음
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md
 *
 * 🔴 **여기서 막는 사고**
 *    ① `--batch=50` 이 Micro Seed 레인으로 새어 Sheet 에 50행이 꽂히는 것
 *    ② raw-only 가 Candidate 를 만들어 승인 게이트를 우회하는 것
 *    ③ 스위치 하나(`--apply`)만으로 write 가 일어나는 것
 *    ④ 자동 선별이 정치·실명 글을 열어 생성기 재료로 넣는 것
 *
 * 사용법: npx tsx scripts/micro-seed-supply-check.mts
 */
import { readFileSync } from 'node:fs'
import {
  planSupplyMode, violatesSupplyInvariant, planAutoFetch,
  AUTO_FETCH_MAX, AUTO_MIN_SCORE, AUTO_SKIP_FLAGS, RAW_ONLY_BATCH_MAX, SHEET_LANE_LIMIT,
  type SupplyModeInput,
} from './lib/micro-seed-supply.mjs'

let failed = 0
const ok = (label: string) => console.log(`  ✅ ${label}`)
const bad = (label: string, detail: string) => {
  console.error(`  ❌ ${label}\n     ${detail}`)
  failed += 1
}
const check = (label: string, cond: boolean, detail = '') => (cond ? ok(label) : bad(label, detail))

const mode = (o: Partial<SupplyModeInput>) =>
  planSupplyMode({ apply: false, limit: null, rawOnly: false, batch: null, ...o })

console.log('\nRaw 공급망 규칙 fixture\n')

// ─────────────────────────────────────────────────────────
console.log('① 스위치 두 개 원칙 — 하나로는 아무것도 쓰이지 않는다')
// ─────────────────────────────────────────────────────────
check('인자 없음 → dry-run', mode({}).mode === 'dry-run')
check('--apply 만 → dry-run', mode({ apply: true }).mode === 'dry-run')
check('--limit=1 만 → dry-run', mode({ limit: 1 }).mode === 'dry-run')
check('--raw-only 만 → dry-run', mode({ rawOnly: true }).mode === 'dry-run')
check('--raw-only --batch=10 (apply 없음) → dry-run', mode({ rawOnly: true, batch: 10 }).mode === 'dry-run')
check(
  '--apply --raw-only (batch 없음) → dry-run',
  mode({ apply: true, rawOnly: true }).mode === 'dry-run',
)
for (const m of [mode({}), mode({ apply: true }), mode({ limit: 1 }), mode({ rawOnly: true })]) {
  check(
    `dry-run 은 write 가 전부 false (${m.mode})`,
    !m.writes.rawContent && !m.writes.candidate && !m.writes.sheet && m.take === 0,
    JSON.stringify(m.writes),
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n② Micro Seed 레인 — Sheet 승인 게이트는 여전히 1건이다')
// ─────────────────────────────────────────────────────────
const ms = mode({ apply: true, limit: 1 })
check('--apply --limit=1 → micro-seed', ms.mode === 'micro-seed')
check(`take === ${SHEET_LANE_LIMIT}`, ms.take === SHEET_LANE_LIMIT, String(ms.take))
check('RawContent + Candidate + Sheet 셋 다 쓴다', ms.writes.rawContent && ms.writes.candidate && ms.writes.sheet)
check('--apply --limit=5 → dry-run (상향 불가)', mode({ apply: true, limit: 5 }).mode === 'dry-run')
check('--apply --limit=50 → dry-run', mode({ apply: true, limit: 50 }).mode === 'dry-run')
check(
  '🔴 --batch 는 Micro Seed 레인으로 새지 않는다 (fatal)',
  mode({ apply: true, batch: 50 }).fatal !== null,
  '배치가 Sheet 레인에서 허용되면 승인 게이트에 50행이 꽂힌다',
)

// ─────────────────────────────────────────────────────────
console.log('\n③ raw-only 레인 — Candidate 도 Sheet 도 만들지 않는다')
// ─────────────────────────────────────────────────────────
const ro = mode({ apply: true, rawOnly: true, batch: 30 })
check('--apply --raw-only --batch=30 → raw-only', ro.mode === 'raw-only')
check('take === 30', ro.take === 30, String(ro.take))
check('RawContent 만 쓴다', ro.writes.rawContent)
check('🔴 Candidate 를 만들지 않는다', !ro.writes.candidate)
check('🔴 Sheet 를 쓰지 않는다', !ro.writes.sheet)
check(
  `--batch=${RAW_ONLY_BATCH_MAX + 1} → fatal (상한 초과)`,
  mode({ apply: true, rawOnly: true, batch: RAW_ONLY_BATCH_MAX + 1 }).fatal !== null,
)
check('--batch=0 → fatal', mode({ apply: true, rawOnly: true, batch: 0 }).fatal !== null)
check('--batch=1.5 → fatal', mode({ apply: true, rawOnly: true, batch: 1.5 }).fatal !== null)
check(
  '🔴 --raw-only --limit 섞으면 fatal',
  mode({ apply: true, rawOnly: true, limit: 1 }).fatal !== null,
  '두 레인의 상한을 같은 이름으로 부르면 어느 문이 열리는지 모호해진다',
)

// ─────────────────────────────────────────────────────────
console.log('\n④ 불변식 — 어떤 조합에서도 깨지지 않는다')
// ─────────────────────────────────────────────────────────
{
  const bools = [false, true]
  const limits = [null, 1, 5, 50]
  const batches = [null, 0, 1, 30, 50, 51]
  let n = 0
  let violated = 0
  for (const apply of bools) for (const rawOnly of bools) for (const limit of limits) for (const batch of batches) {
    const p = planSupplyMode({ apply, limit, rawOnly, batch })
    n += 1
    if (p.fatal !== null) continue // fatal 은 실행되지 않으므로 불변식 대상 밖이다
    if (violatesSupplyInvariant(p)) {
      violated += 1
      bad('불변식 위반', JSON.stringify({ apply, limit, rawOnly, batch, plan: p }))
    }
  }
  check(`전 조합 ${n}가지에서 불변식 위반 0`, violated === 0, `${violated}건 위반`)
}
check(
  '🔴 Sheet 를 쓰면서 Candidate 를 안 만드는 계획은 불변식 위반으로 잡힌다',
  violatesSupplyInvariant({ mode: 'raw-only', take: 1, writes: { rawContent: true, candidate: false, sheet: true }, notes: [], fatal: null }),
)
check(
  '🔴 dry-run 인데 write 가 있으면 불변식 위반으로 잡힌다',
  violatesSupplyInvariant({ mode: 'dry-run', take: 0, writes: { rawContent: true, candidate: false, sheet: false }, notes: [], fatal: null }),
)

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 자동 선별 — 자동 경로에는 사람이 없다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    { sourceArticleId: 'a1', score: 90, flags: ['targetLikely'] },
    { sourceArticleId: 'a2', score: 80, flags: ['targetLikely', 'politicalOrPublicFigure'] },
    { sourceArticleId: 'a3', score: 70, flags: ['personalExperienceLikely'] },
    { sourceArticleId: 'a4', score: 10, flags: [] },
    { sourceArticleId: 'a5', score: 60, flags: ['medicalOrAdLikely'] },
    { sourceArticleId: 'a6', score: 50, flags: [], alreadyInVault: true },
  ]
  const p = planAutoFetch(rows)
  check('🔴 정치·실명은 자동으로 열지 않는다', !p.picked.includes('a2'))
  check('🔴 의료·광고성은 자동으로 열지 않는다', !p.picked.includes('a5'))
  check(`점수 ${AUTO_MIN_SCORE} 미만은 열지 않는다`, !p.picked.includes('a4'))
  check('이미 Vault 에 있으면 열지 않는다', !p.picked.includes('a6'))
  check('나머지는 점수 순으로 열린다', p.picked.join(',') === 'a1,a3', p.picked.join(','))
  check(
    '🔴 제외는 버려지지 않고 사유와 함께 남는다',
    p.skipped.length === 4 && p.skipped.every((s) => s.detail.length > 0),
    JSON.stringify(p.skipped),
  )
  // a2·a5 가 둘 다 SKIP_FLAG 라 제외 4건의 사유는 3종이다
  check(
    '제외 사유가 전부 코드로 분류된다',
    [...new Set(p.skipped.map((s) => s.reason))].sort().join(',') === 'ALREADY_IN_VAULT,BELOW_MIN_SCORE,SKIP_FLAG',
    JSON.stringify(p.skipped.map((s) => s.reason)),
  )
}
{
  const many = Array.from({ length: AUTO_FETCH_MAX + 15 }, (_, i) => ({
    sourceArticleId: `b${String(i).padStart(3, '0')}`,
    score: 100 - i,
    flags: ['targetLikely'],
  }))
  const p = planAutoFetch(many)
  check(`한 실행 상한 ${AUTO_FETCH_MAX}건을 넘지 않는다`, p.picked.length === AUTO_FETCH_MAX, String(p.picked.length))
  check('상한 초과분은 OVER_MAX 로 남는다', p.skipped.every((s) => s.reason === 'OVER_MAX'))
  const p10 = planAutoFetch(many, { max: 10 })
  check('--auto-max 로 더 줄일 수 있다', p10.picked.length === 10, String(p10.picked.length))
}
check('같은 입력이면 같은 결과다 (재현성)', (() => {
  const rows = [
    { sourceArticleId: 'z2', score: 50, flags: [] },
    { sourceArticleId: 'z1', score: 50, flags: [] },
  ]
  return planAutoFetch(rows).picked.join(',') === planAutoFetch(rows).picked.join(',')
})())

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 소스 스캔 — 발행 경로가 이 레일에 없다')
// ─────────────────────────────────────────────────────────
{
  const importer = readFileSync('scripts/micro-seed-import-82cook-live.mts', 'utf-8')
  const collector = readFileSync('scripts/micro-seed-collect-82cook.mts', 'utf-8')

  // 🔴 Prisma data 블록만 본다. 읽기(findFirst)나 문구까지 잡으면 fixture 가 무뎌진다
  const dataBlocks = (src: string): string[] => {
    const out: string[] = []
    const re = /prisma\.(\w+)\.create|tx\.(\w+)\.create/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2] ?? '')
    return out
  }
  const created = dataBlocks(importer)
  check(
    '🔴 importer 가 만드는 테이블은 RawContent · Candidate 둘뿐이다',
    created.every((t) => t === 'microSeedRawContent' || t === 'microSeedCandidate'),
    created.join(','),
  )
  check('🔴 importer 에 post.create 가 없다', !/\.post\.create/.test(importer))
  check('🔴 importer 에 PENDING · PUBLISHED 전환이 없다', !/status:\s*'(PENDING|PUBLISHED)'/.test(importer))
  check('🔴 collector 는 prisma 를 import 하지 않는다', !/from '@prisma\/client'/.test(collector))
  check('collector 에 --auto 가 있다', /argv\.includes\('--auto'\)/.test(collector))
  check(
    '🔴 collector 가 자동 선별분도 robots 로 다시 본다',
    /autoBlocked/.test(collector) && /isPathAllowed/.test(collector),
  )
  check(
    '🔴 importer 가 모드 판정을 직접 다시 쓰지 않는다 (planSupplyMode 경유)',
    /planSupplyMode\(/.test(importer) && !/APPLY && LIMIT === 1/.test(importer),
  )
  check(
    '🔴 raw-only 경로가 Sheet 를 부르지 않는다',
    /if \(RAW_ONLY\) \{[\s\S]{0,900}?microSeedRawContent\.create/.test(importer)
      && !/if \(RAW_ONLY\) \{[\s\S]{0,900}?updateCandidateRow/.test(importer),
  )
}

// ─────────────────────────────────────────────────────────
console.log(
  failed === 0
    ? `\n✅ 전부 통과 — 두 레인의 문이 서로 열리지 않는다.\n`
    : `\n❌ ${failed}건 실패\n`,
)
process.exit(failed === 0 ? 0 : 1)
