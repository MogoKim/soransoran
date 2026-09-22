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

/** artifactId → review · sourceArticleId → review. 두 열쇠로 찾는다 */
const byArtifact = new Map<string, unknown>()
const bySource = new Map<string, unknown>()
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
        if (typeof a.artifactId === 'string') byArtifact.set(a.artifactId, a.review)
        if (a.sourceArticleId !== undefined) bySource.set(String(a.sourceArticleId), a.review)
      }
    } catch { /* 깨진 파일은 건너뛴다 — 없는 근거를 지어내지 않는다 */ }
  }
}

await loadEnvLocal()
const prisma = new PrismaClient()
const rows = await prisma.originalPostApprovalQueue.findMany({
  where: { rawContent: { sourceSite: { startsWith: MACHINE_SITE_PREFIX } } },
  select: {
    id: true, decidedBy: true, gateResults: true, gateVerdict: true,
    draftTitle: true, draftBody: true, editDiff: true, declineReason: true,
    rawContent: { select: { sourceCapturedAt: true } },
  },
})

const keyOf = (g: unknown): { art: string | null; src: string | null } => {
  if (g === null || typeof g !== 'object') return { art: null, src: null }
  const d = (g as Record<string, unknown>).autoDraft
  if (d === null || typeof d !== 'object') return { art: null, src: null }
  const m = d as Record<string, unknown>
  return {
    art: typeof m.artifactId === 'string' ? m.artifactId : null,
    src: m.sourceArticleId === undefined ? null : String(m.sourceArticleId),
  }
}

let restorable = 0, withWarnings = 0, noEvidence = 0, alreadyHas = 0
const restored = new Map<string, unknown>()
for (const r of rows) {
  const g = r.gateResults as Record<string, unknown> | null
  if (g !== null && typeof g === 'object' && g.semanticReview != null) { alreadyHas += 1; continue }
  const k = keyOf(r.gateResults)
  const rev = (k.art !== null ? byArtifact.get(k.art) : undefined)
    ?? (k.src !== null ? bySource.get(k.src) : undefined)
  if (rev === undefined) { noEvidence += 1; continue }
  const sum = semanticSummaryOf(rev)
  if (sum === null) { noEvidence += 1; continue }
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
