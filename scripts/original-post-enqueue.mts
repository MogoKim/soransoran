#!/usr/bin/env tsx
/**
 * 오리지널 초안 → 검수 대기열 적재 (enqueue)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [생성] tmp/original-post-candidates.json ──▶ [판정 gate] ──▶ [적재] ──▶ [검수]
 *                                                                  ↑ 여기
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=N` 이 **둘 다** 있어야 한다.
 *    적재는 되돌리기 번거롭고, 그 뒤 창업자 승인으로 이어지는 경로의 첫 칸이다.
 *    스위치를 두 개 요구하면 크론이나 오타로 도는 일이 없다.
 *
 * 🔴 **발행하지 않는다.** status 는 PENDING 으로만 만든다.
 *    APPROVED · PUBLISHED 로 가는 경로가 이 파일에 없다. Post 도 만들지 않는다.
 *
 * 🔴 **BLOCK 은 적재하지 않는다.** 화면에 건수만 남긴다 —
 *    SOURCE_ECHO 로 막힌 초안은 원문 조각이 든 레코드다.
 *
 * 🔴 **멱등하다.** dedupKey 를 쓰기 전에 확인한다. 같은 명령을 두 번 돌려도
 *    원장이 두 벌 생기지 않는다.
 *
 * 사용법
 *   npx tsx scripts/original-post-enqueue.mts --prompt-version 14판 --model gemini-3.7-flash
 *       → dry-run. 계획만. DB write 0
 *   npx tsx scripts/original-post-enqueue.mts --prompt-version 14판 --model gemini-3.7-flash --apply --limit=5
 *       → 🔴 실제 적재 5건까지
 *
 *   옵션  --input <path>   기본 tmp/original-post-candidates.json
 *         --from <n>       초안 번호 n 부터 (1-base · 판별로 나눠 넣을 때)
 *         --to <n>         초안 번호 n 까지
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { readSourceProfile, mustKeepDetails } from './lib/source-profile'
import { analyzeDraft } from './lib/original-post-prompt'
import { gateDraft } from './lib/original-post-gate'
import { planEnqueue, assertEnqueueable, formatPlan, type QueueRecord } from './lib/original-post-queue'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`)
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${k}=`))
  return eq === undefined ? undefined : eq.slice(k.length + 3)
}
const APPLY = argv.includes('--apply')
const LIMIT_RAW = arg('limit')
const INPUT = arg('input') ?? 'tmp/original-post-candidates.json'
const PROMPT_VERSION = (arg('prompt-version') ?? '').trim()
const MODEL = (arg('model') ?? '').trim()
const FROM = Number.parseInt(arg('from') ?? '1', 10)
const TO = Number.parseInt(arg('to') ?? '0', 10)

const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`
/** 🔴 전문을 남기지 않는다 — 첫 글자 + 길이 */
const brief = (v: string): string => {
  const c = [...v.trim()]
  return c.length === 0 ? '(비어 있음)' : `"${c[0]}…" (${c.length}자)`
}

// 🔴 판·모델을 지어내지 않는다. 사람이 아는 사실이므로 사람이 준다
if (PROMPT_VERSION === '') fail('--prompt-version 이 필요합니다 (예: 14판). 어느 판에서 나온 초안인지 지어내지 않습니다.')
if (MODEL === '') fail('--model 이 필요합니다 (예: gemini-3.7-flash)')
if (!existsSync(INPUT)) fail(`${INPUT} 가 없습니다. 생성을 먼저 돌리세요.`)

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 적재 (--apply) ══\n' : '\n══ dry-run (DB write 0) ══\n')
console.log(`  입력  ${INPUT}`)
console.log(`  판    ${PROMPT_VERSION} · 모델 ${MODEL}`)

type Draft = { sourceRawContentId: string; title: string; body: string }
const all = JSON.parse(readFileSync(INPUT, 'utf-8')) as Draft[]
const lo = Number.isInteger(FROM) && FROM >= 1 ? FROM : 1
const hi = Number.isInteger(TO) && TO >= 1 ? Math.min(TO, all.length) : all.length
if (lo > hi) { await prisma.$disconnect(); fail(`--from ${lo} 이 --to ${hi} 보다 큽니다`) }
const slice = all.slice(lo - 1, hi)
console.log(`  범위  #${lo}~#${hi} · ${slice.length}건 (파일 전체 ${all.length}건)\n`)

// ── 원문 조달 — 🔴 읽기만 한다 ──
const raws = await prisma.microSeedRawContent.findMany({
  where: { id: { in: [...new Set(slice.map((d) => d.sourceRawContentId))] } },
  select: { id: true, sourceArticleId: true, rawTitle: true, rawBody: true },
})
const byId = new Map(raws.map((r) => [r.id, r]))
const missing = slice.filter((d) => !byId.has(d.sourceRawContentId))
if (missing.length > 0) {
  await prisma.$disconnect()
  fail(`원문을 찾지 못한 초안이 ${missing.length}건 있습니다 — 판정할 수 없습니다`)
}

// ── 판정 — 🔴 gate 를 여기서 다시 만들지 않는다. 부르기만 한다 ──
const judged = slice.map((d) => {
  const raw = byId.get(d.sourceRawContentId)!
  const profile = readSourceProfile({ rawTitle: raw.rawTitle, rawBody: raw.rawBody })
  const signals = analyzeDraft({
    title: d.title, body: d.body, sourceTexts: [raw.rawTitle, raw.rawBody],
    allowedContentUrl: profile.contentReferenceUrl,
    closingIntent: profile.closingIntent,
    allowNumberedList: profile.preserveStructure.numberedList,
  })
  const must = mustKeepDetails(profile.concreteDetailsToKeep)
  const both = `${d.title}\n${d.body}`
  const gate = gateDraft({
    signals, closingIntent: profile.closingIntent,
    sourceBodyLength: [...raw.rawBody].length,
    mustKeepTotal: must.length,
    mustKeepFound: must.filter((x) => both.includes(x.sample)).length,
  })
  return { ...d, gate, articleId: raw.sourceArticleId }
})

// ── 이미 대기열에 있는 것 ──
const existing = await prisma.originalPostApprovalQueue.findMany({ select: { dedupKey: true } })
const existingKeys = new Set(existing.map((e) => e.dedupKey))
console.log(`  대기열 현재 ${existing.length}건\n`)

const plan = planEnqueue({
  drafts: judged, existingKeys, promptVersion: PROMPT_VERSION, model: MODEL,
})
console.log(`  ${formatPlan(plan)}\n`)

// 🔴 BLOCK 은 적재하지 않는다. 대신 **화면에 남긴다** — 조용히 사라지면 아무도 모른다
const blocked = judged.filter((j) => j.gate.verdict === 'BLOCK')
if (blocked.length > 0) {
  console.log(`  🔴 BLOCK ${blocked.length}건 — DB 에 넣지 않습니다 (실행 로그로만 남깁니다)`)
  for (const b of blocked) {
    console.log(`     · ${b.articleId} · ${brief(b.title)} · ${b.gate.blocks.map((x) => x.code).join(' · ')}`)
  }
  console.log('')
}

for (const e of plan.enqueue) {
  const j = judged.find((x) => x.sourceRawContentId === e.sourceRawContentId && x.body === e.draftBody)!
  const why = e.gateResults.holds.map((h) => h.code).join(' · ')
  console.log(
    `  ${e.gateVerdict === 'PASS' ? '✅' : '🟡'} ${j.articleId} · ${mask(e.sourceRawContentId)}` +
      ` · 제목 ${brief(e.draftTitle)} · 본문 ${brief(e.draftBody)}` +
      `${why === '' ? '' : ` · ${why}`}`,
  )
}

if (plan.enqueue.length === 0) {
  await prisma.$disconnect()
  console.log('\n🟡 적재할 것이 없습니다.\n')
  process.exit(0)
}

// ── 🔴 --apply --limit 둘 다 있어야 쓴다 ──
if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 적재하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
  process.exit(0)
}
const LIMIT = LIMIT_RAW === undefined ? null : Number.parseInt(LIMIT_RAW, 10)
if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
  await prisma.$disconnect()
  fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
}

const take: QueueRecord[] = plan.enqueue.slice(0, LIMIT)
// 🔴 저장 직전 한 번 더 본다. 타입은 이 파일을 거쳐 갈 때만 유효하다
assertEnqueueable(take)

console.log(`\n══ 적재 ${take.length}건 (--limit ${LIMIT}) ══`)
let done = 0
for (const r of take) {
  // 🔴 건별로 쓴다. 한 건이 걸려도 나머지가 통째로 사라지지 않는다
  const row = await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: r.sourceRawContentId,
      status: 'PENDING',
      draftTitle: r.draftTitle,
      draftBody: r.draftBody,
      gateVerdict: r.gateVerdict,
      gateResults: r.gateResults,
      promptVersion: r.promptVersion,
      model: r.model,
      dedupKey: r.dedupKey,
    },
    select: { id: true, status: true, gateVerdict: true },
  })
  done += 1
  console.log(`  ✅ ${row.id} · status=${row.status} · gate=${row.gateVerdict}`)
}

const after = await prisma.originalPostApprovalQueue.count()
await prisma.$disconnect()
console.log(`\n  적재 ${done}건 · 대기열 ${existing.length} → ${after}`)
console.log('  🔴 status 는 PENDING 입니다. 승인도 발행도 하지 않았습니다 — 사람이 읽는 것이 다음 단계입니다.\n')
