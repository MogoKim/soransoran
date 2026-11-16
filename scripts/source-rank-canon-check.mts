/**
 * 🔴 **원천 순위 정본 하나 — 검사** (2026-11-06 창업자 결정 · canon §2.3)
 *
 *    계약: 안전·품질 자격 gate 뒤 `sourceAge` 오름차순 → (실질 동률에서만) 댓글 백분위 → 조회 백분위 → velocity →
 *    결정적 열쇠(코드 포인트). `sourceAge` = 기준 시각 − 원문 게시 시각의 이른 끝(수집 시각이 아니다).
 *
 *    ① 생산 경로에 두 번째 비교 구현이 없다 (정적)
 *    ② 정본 정렬이 독립 oracle 과 같다 (무작위)
 *    ③ 결정적 열쇠는 locale 이 아니라 코드 포인트다
 *    ④ 판정 rank 의 나이와 정본 나이 계산이 같다
 *    ⑤ 발행 후보 줄도 정본 정렬이다 · 게시 시각은 판정과 같은 엄격 판독기로 읽는다
 *    ⑥ workset 이 쓴 순위 순서를 읽기에서 잃지 않는다
 *    ⑦ 11-06 반례 재생 — 판정·생성이 workset 순위를 지키면 영수증 원천이 화자 자리를 얻고 queue 결속이 남는다
 *    ⑧ 판정·생성 러너가 그 순서를 실제로 쓴다 (배선)
 *
 *    🔴 DB · 네트워크 · provider · 파일 write 0. 순수 함수와 소스 텍스트만 본다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  compareReleaseRank, sortBySourceRank, sourceRankSignalOf, sourceAgeHoursAt, judgeSlotRelease,
  buildSourceEvidence, postedLowerBoundOf, articleIdHashOf, type ReleaseRank, type SourceRankSignal,
} from '../src/lib/source-slot-release'
import { readWorkset, readRunWorkset, orderByWorksetRank, WORKSET_KIND, WORKSET_VERSION } from '../src/lib/supply-workset'
import { SUPPLY_JIT_CONTRACT, WORKSET_VERSION_JIT } from '../src/lib/supply-intent'
import { sourceIdentityOf } from '../src/lib/source-identity'
import { createAttemptPool } from '../src/lib/content-core/speaker-availability'
import type { AutoRow } from '../src/lib/original-post-auto-publish'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}
const H = 3_600_000

/** 결정적 의사 난수 — 같은 seed 면 같은 벌 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n① 생산 경로의 원천 비교 구현은 정본 하나다')
// ─────────────────────────────────────────────────────────
{
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const files = [
    ...readdirSync('src/lib').filter((f) => f.endsWith('.ts')).map((f) => join('src/lib', f)),
    ...readdirSync('scripts').filter((f) => f.endsWith('.mts')).map((f) => join('scripts', f)),
    ...readdirSync('scripts/lib').filter((f) => f.endsWith('.mts')).map((f) => join('scripts/lib', f)),
  ].filter((f) => !/-(check|mutation)\.mts$/.test(f))
  const defs: string[] = []
  for (const f of files) {
    const body = strip(readFileSync(f, 'utf8'))
    for (const m of body.matchAll(/export function (compare\w*(?:Rank|Row|First)\w*)\s*\(/g)) defs.push(`${f}:${m[1]}`)
  }
  const allowed = new Set(['src/lib/source-slot-release.ts:compareReleaseRank', 'src/lib/supply-workset.ts:compareSupplyRank'])
  const extra = defs.filter((d) => !allowed.has(d))
  check('🔴 정본(`compareReleaseRank`)과 열쇠 어댑터(`compareSupplyRank`) 밖에 원천 비교 함수가 없다', extra.length === 0, extra.join(', '))
  const workset = strip(readFileSync('src/lib/supply-workset.ts', 'utf8'))
  const adapter = workset.slice(workset.indexOf('export function compareSupplyRank'), workset.indexOf('export function compareSupplyRank') + 300)
  check('🔴 `compareSupplyRank` 는 정본에 열쇠만 넘기는 한 줄이다',
    /return compareReleaseRank\(\{ \.\.\.a\.rank, tieBreak: a\.key \}, \{ \.\.\.b\.rank, tieBreak: b\.key \}\)\s*\}/.test(adapter), adapter.slice(0, 200))
  const publish = strip(readFileSync('src/lib/original-post-auto-publish.ts', 'utf8'))
  check('🔴 발행 줄이 게시 시각을 따로 파싱하지 않는다 (`autoRowSourceSignalOf` · `compareAutoRow` 없음)',
    !publish.includes('autoRowSourceSignalOf') && !publish.includes('compareAutoRow'))
  const supply = strip(readFileSync('scripts/lib/micro-seed-supply.mts', 'utf8'))
  check('🔴 수집 목록도 정본 정렬을 쓴다 (`compareFreshFirst` 없음)',
    !supply.includes('compareFreshFirst') && supply.includes('sortBySourceRank('))
  const release = strip(readFileSync('src/lib/source-slot-release.ts', 'utf8'))
  const canon = release.slice(release.indexOf('export function compareReleaseRank'), release.indexOf('export function compareReleaseRank') + 500)
  check('🔴 정본 비교는 locale 비교를 쓰지 않는다', canon.length > 0 && !canon.includes('localeCompare'))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 정본 정렬 = 독립 oracle (무작위 400벌)')
// ─────────────────────────────────────────────────────────
{
  /** 독립 oracle — 정본 코드를 부르지 않는다: 게시 이른 끝 최신 → 댓글↓ → 조회↓ → velocity↓ → 코드 포인트 */
  const nullLast = (a: number | null, b: number | null, dir: 1 | -1): number =>
    (a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : dir * (a - b))
  const oracle = (a: SourceRankSignal, b: SourceRankSignal): number =>
    nullLast(a.postedLowerBoundMs, b.postedLowerBoundMs, -1)
    || nullLast(a.commentsPct, b.commentsPct, -1)
    || nullLast(a.viewsPct, b.viewsPct, -1)
    || nullLast(a.velocity, b.velocity, -1)
    || (a.tieBreak < b.tieBreak ? -1 : a.tieBreak > b.tieBreak ? 1 : 0)
  const r = rng(1106)
  let same = 0
  const N = 400
  const base = Date.UTC(2026, 10, 5, 0, 0, 0)
  for (let k = 0; k < N; k += 1) {
    const rows: SourceRankSignal[] = Array.from({ length: 2 + Math.floor(r() * 25) }, (_, i) => ({
      // 분 단위 게시 시각 · 일부 동률 · 일부 모름
      postedLowerBoundMs: r() < 0.15 ? null : base + Math.floor(r() * 6) * 60 * 60_000 + Math.floor(r() * 3) * 60_000,
      commentsPct: r() < 0.3 ? null : Math.floor(r() * 4) / 4,
      viewsPct: r() < 0.3 ? null : Math.floor(r() * 4) / 4,
      velocity: r() < 0.5 ? null : Math.floor(r() * 3),
      tieBreak: `${String.fromCharCode(65 + Math.floor(r() * 3))}${String.fromCharCode(97 + Math.floor(r() * 3))}${i}`,
    }))
    const got = sortBySourceRank(rows, (x) => x).map((x) => x.tieBreak).join()
    const want = [...rows].sort(oracle).map((x) => x.tieBreak).join()
    if (got === want) same += 1
  }
  check('🔴 `sortBySourceRank` 순서가 독립 oracle 과 모든 벌에서 같다', same === N, `${same}/${N}`)
  const reversed = sortBySourceRank([...[1, 2, 3].map((i) => ({
    postedLowerBoundMs: base + i * H, commentsPct: null, viewsPct: null, velocity: null, tieBreak: `t${i}`,
  }))].reverse(), (x) => x).map((x) => x.tieBreak).join()
  check('입력 순서와 무관하게 최신 원문이 먼저다', reversed === 't3,t2,t1', reversed)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 결정적 열쇠 — 코드 포인트')
// ─────────────────────────────────────────────────────────
{
  const rank = (tieBreak: string): ReleaseRank => ({ ageAtSlotH: 1, commentsPct: 0.5, viewsPct: 0.5, velocity: null, tieBreak })
  // 'B'(66) < 'a'(97) — locale 비교는 'a' 를 앞에 둔다
  check('🔴 모든 성분이 같으면 코드 포인트 순 (`B` < `a`)', compareReleaseRank(rank('B'), rank('a')) < 0)
  check('같은 열쇠면 0', compareReleaseRank(rank('x'), rank('x')) === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 판정 rank 나이 = 정본 나이 계산')
// ─────────────────────────────────────────────────────────
{
  const postedAt = '2026-11-05T21:22:00.000Z'
  const slot = new Date('2026-11-06T00:00:00.000Z')
  const ev = buildSourceEvidence({
    sourceSite: 'navercafe:fixture', sourceArticleId: 'n1', postedAt,
    capturedAt: '2026-11-05T22:00:00.000Z',
  })
  const v = judgeSlotRelease({
    evidence: ev, slotAt: slot, now: slot, hardGates: { ok: true, codes: [] }, assignment: 'pending', tieBreak: 'n1',
  })
  const lb = postedLowerBoundOf(ev)
  check('🔴 판정 rank 의 ageAtSlotH 는 `sourceAgeHoursAt(게시 이른 끝, 슬롯)` 이다',
    lb !== null && v.rank.ageAtSlotH === sourceAgeHoursAt(lb.getTime(), slot.getTime()),
    `${String(v.rank.ageAtSlotH)} vs ${lb === null ? 'null' : sourceAgeHoursAt(lb.getTime(), slot.getTime())}`)
  check('나이는 시간 단위 · 0.001h 반올림 · 음수 없음',
    sourceAgeHoursAt(0, 2.6334 * H) === 2.633 && sourceAgeHoursAt(10 * H, 0) === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 발행 후보 줄 — 정본 정렬 · 엄격 판독')
// ─────────────────────────────────────────────────────────
{
  const gate = (id: string, postedAt: unknown): Record<string, unknown> => ({
    sourceEvidence: buildSourceEvidence({ sourceSite: 'navercafe:fixture', sourceArticleId: id, postedAt }),
  })
  const sig = sourceRankSignalOf(gate('a', '2026-11-05T10:00:00.000Z'), 'a')
  check('🔴 큐 행 신호의 게시 시각은 판정과 같은 `postedLowerBoundOf` 값이다',
    sig.postedLowerBoundMs === Date.parse('2026-11-05T10:00:00.000Z') && sig.tieBreak === 'a')
  check('🔴 evidence 를 못 읽으면 게시 시각을 모른다(뒤로 간다) — 느슨한 파싱으로 known 을 만들지 않는다',
    sourceRankSignalOf({ sourceEvidence: { version: 'nope' } }, 'z').postedLowerBoundMs === null
    && sourceRankSignalOf(null, 'z').postedLowerBoundMs === null)
  const row = (id: string, gateResults: Record<string, unknown>): AutoRow => ({
    id, status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS', title: `t-${id}`, body: `b-${id}`,
    gateResults, decidedAt: null, createdAt: new Date('2026-11-05T00:00:00Z'),
  } as unknown as AutoRow)
  const rows = [
    row('old', gate('old', '2026-11-05T01:00:00.000Z')),
    row('unk', { sourceEvidence: { version: 'nope' } }),
    row('new', gate('new', '2026-11-05T09:00:00.000Z')),
  ]
  const want = sortBySourceRank(rows, (r) => sourceRankSignalOf(r.gateResults, r.id)).map((r) => r.id)
  check('정본 정렬은 최신 → 이른 → 모름 순이다', want.join() === 'new,old,unk', want.join())
  check('🔴 `selectAutoTargets` 는 순서를 따로 정하지 않고 정본 정렬 결과를 낸다 (정적)',
    /targets:\s*sortBySourceRank\(targets,\s*\(r\)\s*=>\s*sourceRankSignalOf\(r\.gateResults,\s*r\.id\)\)/
      .test(readFileSync('src/lib/original-post-auto-publish.ts', 'utf8')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ workset 순위 순서를 읽기에서 잃지 않는다')
// ─────────────────────────────────────────────────────────
const QC = { version: 'fixture-quality', digest: 'a'.repeat(64) }
const jitFile = (runId: string, sources: { site: string; id: string; age: number }[]): unknown => ({
  kind: WORKSET_KIND, version: WORKSET_VERSION_JIT, runId, takenAt: '2026-11-05T22:02:20.000Z', limit: 20,
  contract: SUPPLY_JIT_CONTRACT, qualityContract: QC,
  sources: sources.map((s) => ({
    sourceSite: s.site, sourceArticleId: s.id, slotAt: '2026-11-06T00:00:00.000Z', ageAtSlotH: s.age,
  })),
})
{
  const src = [{ site: 'navercafe:b', id: '2', age: 1 }, { site: 'navercafe:a', id: '9', age: 2 }, { site: 'navercafe:c', id: '1', age: 3 }]
  const r = readWorkset(jitFile('r1', src), 'r1')
  check('🔴 JIT 묶음의 `rankedKeys` 는 파일에 쓴 순위 순서 그대로다',
    r.ok && r.rankedKeys !== null && r.rankedKeys.join('|') === src.map((s) => sourceIdentityOf(s.site, s.id)).join('|'))
  const v2 = readWorkset({
    kind: WORKSET_KIND, version: WORKSET_VERSION, runId: 'r2', takenAt: '2026-11-05T22:02:20.000Z', limit: 5,
    sources: src.map((s) => ({ sourceSite: s.site, sourceArticleId: s.id })),
  }, 'r2')
  check('v2 묶음도 순위 순서를 준다', v2.ok && v2.rankedKeys?.length === 3 && v2.rankedKeys[0] === sourceIdentityOf('navercafe:b', '2'))
  const legacy = readWorkset({
    kind: WORKSET_KIND, version: 'workset-v1', runId: 'r3', takenAt: '2026-11-05T22:02:20.000Z', limit: 5, sourceIds: ['1', '2'],
  }, 'r3')
  check('🔴 옛 판(v1 · 사이트 없음)은 순위를 지어내지 않는다 (`rankedKeys: null`)', legacy.ok && legacy.rankedKeys === null)
  const keep = orderByWorksetRank([{ k: 'x' }, { k: 'b' }, { k: 'y' }, { k: 'a' }], (o) => o.k, ['a', 'b'])
  check('🔴 묶음 밖 행은 뒤에 원래 순서대로 남는다 (지우지 않는다)', keep.map((o) => o.k).join() === 'a,b,x,y', keep.map((o) => o.k).join())
  check('순위가 없으면 원래 순서 그대로', orderByWorksetRank([{ k: 'b' }, { k: 'a' }], (o) => o.k, null).map((o) => o.k).join() === 'b,a')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 11-06 반례 재생 — 화자 자리 1 · 이름순 판정 파일 · 영수증 원천 6 + 영수증 밖 늙은 원천 1')
// ─────────────────────────────────────────────────────────
{
  // 모양만 재생한다(합성 id): 07:00 복구 수집 영수증 = wgang 6건, 묶음 7건 = 신선도 순 2.633h … 7.95h,
  // 가장 늙은 1건은 영수증 밖 레몬테라스. 판정 결과 파일은 이름순(`navercafe-remonterrace…` < `navercafe-wgang…`).
  const W = 'navercafe:wgang'
  const R = 'navercafe:remonterrace'
  const ranked = [
    { site: W, id: '900001', age: 2.633 }, { site: W, id: '900002', age: 3.2 }, { site: W, id: '900003', age: 4.1 },
    { site: W, id: '900004', age: 5.0 }, { site: W, id: '900005', age: 6.4 }, { site: W, id: '900006', age: 7.3 },
    { site: R, id: '35000001', age: 7.95 },
  ]
  const ws = readWorkset(jitFile('20261105-220220', ranked), '20261105-220220')
  const receipt = new Set(ranked.filter((s) => s.site === W).map((s) => articleIdHashOf(s.site, s.id)))
  // 판정 파일 순서 = 파일 이름순 — 레몬테라스가 먼저다
  const fileOrder = [...ranked].sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : 0))
  const keyOf = (s: { site: string; id: string }): string | null => sourceIdentityOf(s.site, s.id)
  const draftFirst = (seeds: typeof ranked): typeof ranked[number] | null => {
    const pool = createAttemptPool({ attemptCapacity: [{ code: 'P15', attemptCapacity: 1 }], attemptDemand: seeds.length })
    for (const s of seeds) {
      const left = pool.take()
      if (left.length === 0) continue
      pool.markChosen(left[0]!)
      return s
    }
    return null
  }
  const before = draftFirst(fileOrder)
  check('반례 고정: 파일 순서로는 영수증 밖 7.95h 원천이 유일한 화자 자리를 가져간다',
    before?.id === '35000001' && !receipt.has(articleIdHashOf(before.site, before.id)))
  const ordered = ws.ok ? orderByWorksetRank(fileOrder, keyOf, ws.rankedKeys) : []
  const after = draftFirst(ordered)
  check('🔴 workset 순위를 지키면 가장 신선한 2.633h 원천이 그 자리를 얻는다', after?.id === '900001', String(after?.id))
  const intent = ws.ok && after !== null ? ws.intents?.get(keyOf(after)!) ?? null : null
  check('🔴 그 원천의 queue 결속(`supplyIntent.sourceHash`)이 복구 영수증 hash 와 같은 함수로 맞물린다',
    intent !== null && after !== null && intent.sourceHash === articleIdHashOf(after.site, after.id) && receipt.has(intent.sourceHash))
  check('묶음 7건 모두 판정 순서에 남는다 (거르지 않는다)', ordered.length === 7)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 배선 — 판정·생성 러너가 묶음 순위를 실제로 쓴다')
// ─────────────────────────────────────────────────────────
{
  const judge = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf8')
  check('🔴 판정 러너가 묶음 필터 뒤 `orderByWorksetRank(…, ws.rankedKeys)` 로 판정 순서를 세운다',
    /all = orderByWorksetRank\([\s\S]{0,200}ws\.rankedKeys\)/.test(judge))
  const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf8')
  const iPool = draft.indexOf('createAttemptPool({')
  const iOrder = draft.indexOf('seeds = orderByWorksetRank(')
  check('🔴 생성 러너가 화자 시도 풀을 만들기 전에 묶음 순위로 원천을 세운다', iOrder > 0 && iPool > iOrder)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 생성 러너의 묶음 판독 — 품질 계약 불일치는 "묶음 없음" 으로 삼켜지지 않는다')
// ─────────────────────────────────────────────────────────
{
  const src3 = [{ site: 'navercafe:a', id: '1', age: 1 }, { site: 'navercafe:b', id: '2', age: 2 }]
  const raw = JSON.stringify(jitFile('rq', src3))
  const ok = readRunWorkset(raw, 'rq', QC)
  check('같은 품질 계약이면 의도·순위를 준다',
    ok.kind === 'ok' && ok.intents?.size === 2 && ok.rankedKeys?.join('|') === src3.map((s) => sourceIdentityOf(s.site, s.id)).join('|'))
  check('🔴 품질 계약이 다르면 `qualityMismatch` 다 — "묶음 없음" 이 아니다',
    readRunWorkset(raw, 'rq', { version: 'other-quality', digest: 'b'.repeat(64) }).kind === 'qualityMismatch')
  const m = readRunWorkset(null, 'rq', QC)
  const u = readRunWorkset('{not json', 'rq', QC)
  const i = readRunWorkset(JSON.stringify({ kind: 'other' }), 'rq', QC)
  check('파일 없음 · 깨진 JSON · 계약 밖 모양은 각자 사유가 있는 `none` 이다',
    m.kind === 'none' && m.reason === 'MISSING' && u.kind === 'none' && u.reason === 'UNREADABLE'
    && i.kind === 'none' && i.reason === 'INVALID')
  const v2 = readRunWorkset(JSON.stringify({
    kind: WORKSET_KIND, version: WORKSET_VERSION, runId: 'rv', takenAt: '2026-11-05T22:02:20.000Z', limit: 5,
    sources: src3.map((s) => ({ sourceSite: s.site, sourceArticleId: s.id })),
  }), 'rv', { version: 'other-quality', digest: 'b'.repeat(64) })
  check('품질 계약 표식이 없는 v2 묶음은 대조 대상이 아니다(종전과 같다)', v2.kind === 'ok' && v2.intents === null)
  // 🔴 배선 — 판독 실패만 try 안에서 잡고, 불일치 중단은 try 밖에서 한다
  const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf8')
  const fn = draft.slice(draft.indexOf('function runWorkset('), draft.indexOf('\n}\n', draft.indexOf('function runWorkset(')))
  const tryBlock = fn.includes('try {') ? fn.slice(fn.indexOf('try {'), fn.indexOf('} catch')) : ''
  check('🔴 생성 러너가 `readRunWorkset` 결과의 `qualityMismatch` 에서 중단한다',
    fn.includes('readRunWorkset(') && /if \(r\.kind === 'qualityMismatch'\) fail\(/.test(fn), fn.slice(0, 300))
  check('🔴 그 중단과 판독은 파일 읽기 try 블록 밖에 있다 (catch 가 안전 중단을 삼키지 않는다)',
    tryBlock !== '' && !tryBlock.includes('fail(') && !tryBlock.includes('readRunWorkset(') && !tryBlock.includes('JSON.parse'), tryBlock)
}

console.log(`\n원천 순위 정본 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
