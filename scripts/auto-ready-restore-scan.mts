/**
 * 🔴 **과거 기계 행의 의미 검수 근거를 실제 artifact 에 대조한다** (read-only · write 0).
 *
 *   적재가 `holds: [], blocks: []` 를 하드코딩해서, 모델이 낸 판정이 DB 에 오지 못했다.
 *   그 결과 과거 행 전부가 `SEMANTIC_REVIEW_MISSING` 이 되어 표본이 0 이 됐다.
 *
 *   🔴 **30건을 처음부터 다시 검토할 이유는 없다.** 근거는 `.microseed-data` 의
 *      artifact 에 남아 있다. 행마다 `artifactId`·`sourceArticleId` 로 찾아
 *      **복원 가능한지**를 센다.
 *
 * 🔴 결정 주체(`decidedBy`)·발행 기록(`createdPostId`)은 읽지도 쓰지도 않는다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { MACHINE_SITE_PREFIX, semanticSummaryOf, semanticHoldsOf } from '../src/lib/micro-seed-supply-autofill'
import { sampleOf, judgeAutoReadyOpen, outcomeOf, HUMAN_DECIDER, type SampleRow } from '../src/lib/auto-ready'
import { AUTO_READY_CONTRACT } from '../src/lib/supply-schedule-contract'

const DIRS = [
  join(homedir(), 'Documents/soransoran-runtime/.microseed-data'),
  '.microseed-data',
]

/**
 * 🔴 **정확한 `artifactId` 만 근거로 쓴다** (2026-09-23 보정).
 *
 *    앞판은 `sourceArticleId` 도 열쇠로 넣고 `Map.set` 으로 덮어썼다. 같은 원천이
 *    여러 회차에 있으면 **마지막에 읽은 장의 판정**이 이겼다 — 다른 회차의 다른
 *    초안에 대한 판정을 그 행의 근거로 쓰는 셈이다.
 *
 *    대체 매칭은 **세 가지가 모두 입증될 때만** 허용한다.
 *      ① 그 원천이 파일 전체에서 **유일**하다 (회차가 하나뿐)
 *      ② 사이트가 같다
 *      ③ 그 장의 초안 제목·본문이 DB 행의 초안과 **같다**
 *    하나라도 못 밝히면 **미측정**으로 둔다.
 */
type ArtRec = { review: unknown; site: string | null; title: string | null; body: string | null; file: string }
const byArtifact = new Map<string, ArtRec>()
/** sourceArticleId → 그 원천의 모든 장. **덮어쓰지 않는다** */
const bySource = new Map<string, ArtRec[]>()
let files = 0
for (const dir of DIRS) {
  let names: string[] = []
  try { names = readdirSync(dir).filter((n) => n.includes('artifacts')) } catch { continue }
  for (const n of names) {
    files += 1
    try {
      const o = JSON.parse(readFileSync(join(dir, n), 'utf-8')) as { artifacts?: unknown[] }
      const arr = (Array.isArray(o) ? o : (o.artifacts ?? [])) as Array<Record<string, unknown>>
      for (const a of arr) {
        if (a.review === undefined) continue
        const d = (a.draft !== null && typeof a.draft === 'object') ? a.draft as Record<string, unknown> : {}
        const rec: ArtRec = {
          review: a.review,
          site: typeof a.sourceSite === 'string' ? a.sourceSite : null,
          title: typeof d.title === 'string' ? d.title : null,
          body: typeof d.body === 'string' ? d.body : null,
          file: n,
        }
        if (typeof a.artifactId === 'string') byArtifact.set(a.artifactId, rec)
        if (a.sourceArticleId !== undefined) {
          const k = String(a.sourceArticleId)
          bySource.set(k, [...(bySource.get(k) ?? []), rec])
        }
      }
    } catch { /* 깨진 파일은 건너뛴다 — 없는 근거를 지어내지 않는다 */ }
  }
}

await loadEnvLocal()
const prisma = new PrismaClient()
const rows = await prisma.originalPostApprovalQueue.findMany({
  where: { rawContent: { sourceSite: { startsWith: MACHINE_SITE_PREFIX } } },
  select: {
    id: true, decidedBy: true, gateResults: true, gateVerdict: true, createdAt: true,
    draftTitle: true, draftBody: true, editDiff: true, declineReason: true,
    rawContent: { select: { sourceCapturedAt: true } },
  },
})

const keyOf = (g: unknown): { art: string | null; src: string | null; site: string | null; rule: string | null } => {
  const none = { art: null, src: null, site: null, rule: null }
  if (g === null || typeof g !== 'object') return none
  const d = (g as Record<string, unknown>).autoDraft
  if (d === null || typeof d !== 'object') return none
  const m = d as Record<string, unknown>
  return {
    art: typeof m.artifactId === 'string' ? m.artifactId : null,
    src: m.sourceArticleId === undefined ? null : String(m.sourceArticleId),
    site: typeof m.sourceSite === 'string' ? m.sourceSite : null,
    rule: typeof m.draftRuleVersion === 'string' ? m.draftRuleVersion
      : typeof m.pipelineVersion === 'string' ? m.pipelineVersion : null,
  }
}
/** 🔴 artifact 저장 기능이 들어온 날 — 그 전 행은 **생성 당시 기록이 없다** */
const ARTIFACT_SAVE_SINCE = new Date('2026-09-20T00:00:00+09:00')

let restorable = 0, withWarnings = 0, noEvidence = 0, alreadyHas = 0
let byExactId = 0, byFallback = 0, fallbackRefused = 0
const restored = new Map<string, unknown>()
/** 222건을 나누기 위한 통계 */
const noEvidenceRows: Array<{ id: string; createdAt: Date; rule: string; hasArtId: boolean }> = []
for (const r of rows) {
  const g = r.gateResults as Record<string, unknown> | null
  if (g !== null && typeof g === 'object' && g.semanticReview != null) { alreadyHas += 1; continue }
  const k = keyOf(r.gateResults)
  let rec: ArtRec | undefined
  // ① 정확한 artifactId 가 최우선이다
  if (k.art !== null) { rec = byArtifact.get(k.art); if (rec !== undefined) byExactId += 1 }
  // ② 대체 매칭 — 유일한 원천 · 같은 사이트 · 같은 초안일 때만
  if (rec === undefined && k.src !== null) {
    const cands = bySource.get(k.src) ?? []
    if (cands.length === 1) {
      const c = cands[0]!
      const siteOk = c.site === null || k.site === null || c.site === k.site
      const sameDraft = c.title === r.draftTitle && c.body === r.draftBody
      if (siteOk && sameDraft) { rec = c; byFallback += 1 }
      else fallbackRefused += 1
    } else if (cands.length > 1) fallbackRefused += 1
  }
  const sum = rec === undefined ? null : semanticSummaryOf(rec.review)
  if (sum === null) {
    noEvidence += 1
    noEvidenceRows.push({ id: r.id, createdAt: r.createdAt, rule: k.rule ?? '(불명)', hasArtId: k.art !== null })
    continue
  }
  restored.set(r.id, sum)
  if (semanticHoldsOf(sum).length > 0) withWarnings += 1
  else restorable += 1
}

console.log(`\n══ 과거 기계 행 근거 대조 (read-only · DB write 0 · artifact 파일 ${files}장) ══\n`)
console.log(`  기계 행 전체                 ${rows.length}건`)
console.log(`  ├ 이미 기록이 있다            ${alreadyHas}건`)
console.log(`  ├ 🟢 복원 가능 · 경고 없음     ${restorable}건`)
console.log(`  ├ 🟡 복원 가능 · 경고 있음     ${withWarnings}건`)
console.log(`  └ 🔴 근거를 찾을 수 없다       ${noEvidence}건`)
console.log(`\n  매칭 근거   정확한 artifactId ${byExactId}건 · 대체 매칭 허용 ${byFallback}건 · 대체 매칭 거절 ${fallbackRefused}건`)
console.log('  🔴 대체 매칭은 유일한 원천 · 같은 사이트 · 같은 초안일 때만 허용했다. 나머지는 미측정이다.')

// ── 🔴 근거 없는 행을 **증거로** 나눈다 ──
const before = noEvidenceRows.filter((x) => x.createdAt < ARTIFACT_SAVE_SINCE)
const after = noEvidenceRows.filter((x) => x.createdAt >= ARTIFACT_SAVE_SINCE)
const afterNoId = after.filter((x) => !x.hasArtId)
const afterWithId = after.filter((x) => x.hasArtId)
console.log(`\n  ── 근거 없는 ${noEvidence}건을 나눈다 ──`)
console.log(`  ① 생성 당시 미기록 (artifact 저장 기능 도입 2026-09-20 이전)  ${before.length}건`)
console.log(`  ② 도입 이후인데 행에 artifactId 자체가 없다                   ${afterNoId.length}건`)
console.log(`  ③ 도입 이후 · artifactId 는 있는데 파일에서 못 찾았다          ${afterWithId.length}건`)
if (afterWithId.length > 0) {
  console.log('     🔴 ③ 은 삭제·다른 저장 위치·다른 머신 중 하나다 — 아래 ID 로 확인한다')
  for (const x of afterWithId.slice(0, 8)) {
    console.log(`        ${x.id} · ${x.createdAt.toISOString().slice(0, 16)} · ${x.rule}`)
  }
}
const ruleTally = new Map<string, number>()
for (const x of noEvidenceRows) ruleTally.set(x.rule, (ruleTally.get(x.rule) ?? 0) + 1)
console.log(`  파이프라인 판: ${[...ruleTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}건`).join(' · ')}`)

// ── 복원했다고 치면 사람 결정 표본이 얼마가 되는가 (메모리상 계산 · DB 미변경) ──
const decided = rows.filter((r) => (r.decidedBy ?? '').trim() === HUMAN_DECIDER)
const asRow = (r: (typeof rows)[number]): SampleRow => {
  const base = (r.gateResults !== null && typeof r.gateResults === 'object')
    ? { ...(r.gateResults as Record<string, unknown>) } : {}
  const sum = restored.get(r.id)
  if (sum !== undefined) {
    base.semanticReview = sum
    base.holds = semanticHoldsOf(sum as never)
  }
  return {
    gateVerdict: r.gateVerdict, gateResults: base,
    draftTitle: r.draftTitle, draftBody: r.draftBody,
    decidedBy: r.decidedBy, editDiff: r.editDiff, declineReason: r.declineReason,
    sourceCapturedAt: r.rawContent?.sourceCapturedAt ?? null,
  }
}
const sample = sampleOf(decided.map((r) => outcomeOf(asRow(r))))
const open = judgeAutoReadyOpen({
  enabled: true,
  reviewSampleMin: AUTO_READY_CONTRACT.reviewSampleMin,
  noEditAccuracyMin: AUTO_READY_CONTRACT.noEditAccuracyMin,
  hardDefectMax: AUTO_READY_CONTRACT.hardDefectMax,
  sample,
})
console.log(`\n  ── 복원을 적용하면 (메모리상 계산 · DB 는 그대로다) ──`)
console.log(`  사람 결정 완료               ${decided.length}건`)
console.log(`  표본(적격)                   ${sample.total} / ${AUTO_READY_CONTRACT.reviewSampleMin}`)
console.log(`  무수정률                     ${sample.noEditAccuracy === null ? '—' : `${(sample.noEditAccuracy * 100).toFixed(1)}%`}`)
console.log(`  중대 결함                    ${sample.hardDefects === null ? '🔴 미측정' : sample.hardDefects}`)
console.log(`  게이트                       ${open.open ? '열 수 있다' : '닫힘'} — ${open.reason}`)
console.log('\n🔴 decidedBy·createdPostId 는 읽지도 쓰지도 않았다. DB write 0.\n')
await prisma.$disconnect()
