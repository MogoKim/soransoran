#!/usr/bin/env tsx
/**
 * 공급 자동 보충 — 🔴 **발행하지 않는다. 재고만 채운다** (§4-AN)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AN
 *
 * 사람이 **매일 후보 파일을 뒤져 큐에 올리는 일**을 없앤다.
 * 판정은 전부 `src/lib/micro-seed-supply-autofill.ts` 가 하고, 여기는 읽고 쓰기만 한다.
 *
 * 🔴 **경계가 이 파일의 전부다.**
 *      만든다  MicroSeedRawContent(synthetic) · OriginalPostApprovalQueue(→ APPROVED)
 *      안 만든다  Post · Comment · PersonaActivityLog · persona 배정
 *    발행은 `original-post-auto-publish` 의 일이다(§4-AL). 두 도구는 서로를 부르지 않고
 *    **DB 의 APPROVED 재고 한 지점에서만 만난다.**
 *
 * 🔴 **왜 PENDING 에서 멈추지 않고 APPROVED 까지 가나.**
 *    러너는 APPROVED·EDITED 만 먹는다. PENDING 에서 멈추면 사람이 또 승인을 눌러야 하고,
 *    그러면 사람 손을 없앤 것이 아니다. 대신 **사람이 이미 판단한 것만** 올린다 —
 *    파일의 `sourceDecision`(ADOPT·SAVE)이 그 판단이고, 판정 lib 이 그걸 검사한다.
 *    새로 판단하지 않는다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-supply-autofill.mts                    ← dry-run
 *   npx tsx scripts/micro-seed-supply-autofill.mts --apply --limit=3  ← 실제 보충
 *   npx tsx scripts/micro-seed-supply-autofill.mts --input=<path>     ← 후보 파일 지정
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import {
  planRefill, judgeApply, readStock, verifyAfterRefill, provenanceKeyOf, baseArticleId,
  SKIP_LABEL, STOCK_TARGET, STOCK_MIN, STOCK_WARN,
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  type Candidate, type HeldEntry,
} from '../src/lib/micro-seed-supply-autofill'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const DATA_DIR = '.microseed-data'
/** 🔴 사람이 보류한 글 — 재생성되는 후보 파일과 따로 산다 (§4-AN ②) */
const HELD_FILE = join(DATA_DIR, 'held-candidates.json')

const argv = process.argv.slice(2)
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? null : hit.slice(n.length + 3)
}
const APPLY = argv.includes('--apply')
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === null ? null : Number.parseInt(LIMIT_RAW, 10)
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

/** 최신 후보 파일 — 파일명에 시각이 들어가므로 이름순 마지막이 최신이다 */
function latestCandidateFile(dir: string): string | null {
  if (!existsSync(dir)) return null
  const hits = readdirSync(dir)
    .filter((f) => f.startsWith('publish-candidates-') && f.endsWith('.json'))
    .sort()
  return hits.length === 0 ? null : join(dir, hits[hits.length - 1]!)
}

function readCandidates(path: string): Candidate[] {
  const j = JSON.parse(readFileSync(path, 'utf-8')) as { candidates?: Candidate[] }
  return Array.isArray(j.candidates) ? j.candidates : []
}

/**
 * 보류 목록을 읽는다 — 🔴 **파일이 없으면 빈 목록이 아니라 경고다.**
 *
 * 없는 것과 비어 있는 것은 다르다. 없으면 "아직 안 만들었다" 이고,
 * 그 상태로 자동 보충을 돌리면 사람이 뺀 것을 도로 넣을 수 있다.
 */
function readHeld(path: string): { held: HeldEntry[]; missing: boolean } {
  if (!existsSync(path)) return { held: [], missing: true }
  const j = JSON.parse(readFileSync(path, 'utf-8')) as { held?: HeldEntry[] }
  return { held: Array.isArray(j.held) ? j.held : [], missing: false }
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function syntheticArticleId(articleId: string, title: string): string {
  const h = createHash('sha256').update(provenanceKeyOf(articleId, title), 'utf8').digest('hex')
  return `${articleId}-${h.slice(0, 8)}`
}
function dedupKeyOf(rawContentId: string, body: string): string {
  const b = createHash('sha256').update(body, 'utf8').digest('hex')
  return `sha256:${createHash('sha256').update(`${rawContentId}::${b}`, 'utf8').digest('hex')}`
}

async function main(): Promise<void> {
  await loadEnvLocal()
  const inputPath = arg('input') ?? latestCandidateFile(DATA_DIR)
  if (inputPath === null) fail(`${DATA_DIR} 에 publish-candidates-*.json 이 없습니다`)
  if (!existsSync(inputPath)) fail(`후보 파일을 찾지 못했습니다: ${inputPath}`)

  const candidates = readCandidates(inputPath)
  const { held, missing } = readHeld(HELD_FILE)

  console.log(APPLY ? '\n══ 🔴 실제 보충 (--apply) ══\n' : '\n══ dry-run (DB write 0 · Post 0) ══\n')
  console.log(`  후보 파일  ${inputPath} · ${candidates.length}건`)
  console.log(`  보류 목록  ${missing ? '🔴 없음' : `${HELD_FILE} · ${held.length}건`}`)
  console.log(`  재고 기준  경고 ${STOCK_WARN} 이하 · 최소 ${STOCK_MIN} · 목표 ${STOCK_TARGET}`)
  console.log('  🔴 이 도구는 발행하지 않는다 — Post · persona 배정 · ActivityLog 를 만들지 않는다\n')

  if (missing) {
    console.log(`  🔴 보류 목록 파일이 없습니다: ${HELD_FILE}`)
    console.log('     사람이 뺀 후보를 다시 집어넣을 수 있으므로 진행하지 않습니다.')
    console.log('     빈 목록이라도 `{"held":[]}` 로 만들어 두세요 — "없다" 와 "비었다" 는 다릅니다.\n')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  const queueRows = await prisma.originalPostApprovalQueue.findMany({
    select: {
      status: true, promptVersion: true, createdPostId: true,
      rawContent: { select: { sourceArticleId: true, rawTitle: true, sourceSite: true } },
    },
  })

  // ── ① 재고 ──
  const stock = readStock(queueRows)
  const mark = stock.level === 'critical' ? '🔴' : stock.level === 'low' ? '🟡' : '🟢'
  console.log(`① 재고  ${mark} 러너가 먹을 수 있는 것 ${stock.usable}건`)
  console.log(`   큐 전체 ${queueRows.length}건 중 우리 판 · APPROVED · 미발행만 센다`)
  if (stock.shortfall > 0) console.log(`   목표까지 ${stock.shortfall}건 부족`)

  // 이미 올라간 것 — synthetic RawContent 기준으로 되돌린 키
  const existing = new Set<string>()
  for (const r of queueRows) {
    const rc = r.rawContent
    if (rc === null || !rc.sourceSite.startsWith(AUTOFILL_SITE_PREFIX)) continue
    existing.add(provenanceKeyOf(baseArticleId(rc.sourceArticleId), rc.rawTitle))
  }
  const queueForSibling = queueRows
    .filter((r) => r.rawContent !== null && r.rawContent.sourceSite.startsWith(AUTOFILL_SITE_PREFIX))
    .map((r) => ({
      sourceArticleId: r.rawContent!.sourceArticleId,
      status: r.status,
      createdPostId: r.createdPostId,
    }))

  // ── ② 선별 ──
  const { targets, skipped } = planRefill({
    candidates, held, existing, queue: queueForSibling, usable: stock.usable,
  })
  console.log(`\n② 파일 ${candidates.length}건 → 보충 후보 ${targets.length}건`)
  for (const t of targets) {
    console.log(`   · [${S(t.candidateType)}] ${S(t.title).slice(0, 24)}`)
    console.log(`       ${S(t.sourceSite)}:${S(t.sourceArticleId)} · 본문 ${S(t.body).length}자`
      + ` · 겹침 ${Number(t.maxOverlap ?? 0)}자`)
  }
  if (targets.length === 0) console.log('   (없음)')

  if (skipped.length > 0) {
    console.log(`\n③ 제외 ${skipped.length}건`)
    const byCode = new Map<string, number>()
    for (const s of skipped) byCode.set(s.code, (byCode.get(s.code) ?? 0) + 1)
    for (const [code, n] of byCode) console.log(`   ${String(n).padStart(2)}건  ${SKIP_LABEL[code as keyof typeof SKIP_LABEL]}`)
    // 🔴 사람이 뺀 것은 제목까지 보여준다 — 조용히 사라지면 왜 안 들어왔는지 알 수 없다
    const heldOnes = skipped.filter((s) => s.code === 'HELD')
    if (heldOnes.length > 0) {
      console.log('\n   🔴 보류 목록에 걸린 것:')
      for (const h of heldOnes) console.log(`      · ${h.title.slice(0, 28)}`)
    }
  }

  // ── ④ 실행 판정 ──
  const gate = judgeApply({ targets, apply: APPLY, limit: LIMIT, usable: stock.usable })
  if (!gate.ok) {
    console.log(`\n④ 보충하지 않는다 — ${gate.reason}`)
    if (!APPLY) {
      console.log('   🟡 dry-run 입니다. DB write 0 · Post 0'
        + ' · 실행하려면 --apply 와 --limit=N 을 둘 다 붙이세요.')
    }
    console.log()
    await prisma.$disconnect()
    process.exit(0)
  }

  // ── ⑤ 보충 ──
  const before = {
    raw: await prisma.microSeedRawContent.count(),
    queue: await prisma.originalPostApprovalQueue.count(),
    post: await prisma.post.count(),
  }
  console.log(`\n⑤ 🔴 보충 ${gate.take.length}건 (--limit ${LIMIT})`)
  let done = 0
  for (const c of gate.take) {
    const title = S(c.title)
    const body = S(c.body)
    const at = S(c.reviewedAt) !== '' ? new Date(S(c.reviewedAt)) : new Date()
    // 🔴 건별 트랜잭션. 한 건이 걸려도 나머지가 통째로 사라지지 않는다 (enqueue 와 같은 원칙)
    const res = await prisma.$transaction(async (tx) => {
      const raw = await tx.microSeedRawContent.create({
        data: {
          // 🟡 semantic debt — 우리 레인 enum 이 없어 live 를 쓴다. sourceSite 접두로 구분한다 (§4-AJ)
          origin: 'live',
          sourceSite: `${AUTOFILL_SITE_PREFIX}${S(c.sourceSite)}`,
          sourceUrl: `publish-candidate://${S(c.sourceInput) || 'unknown'}#${S(c.sourceArticleId)}`,
          sourceArticleId: syntheticArticleId(S(c.sourceArticleId), title),
          sourceCapturedAt: Number.isNaN(at.getTime()) ? new Date() : at,
          rawTitle: title,
          rawBody: body,
        },
        select: { id: true },
      })
      const q = await tx.originalPostApprovalQueue.create({
        data: {
          sourceRawContentId: raw.id,
          // 🔴 바로 APPROVED 다. 사람의 판단은 파일의 sourceDecision 에 이미 있고,
          //    판정 lib 이 그걸 검사했다 — 여기서 새로 판단하지 않는다
          status: 'APPROVED',
          decidedBy: 'founder',
          decidedAt: new Date(),
          draftTitle: title,
          draftBody: body,
          gateVerdict: 'PASS',
          gateResults: {
            holds: [], blocks: [],
            autofill: {
              note: '공급 자동 보충 — 사람이 고른 글이다. LLM 생성이 아니다',
              candidateType: S(c.candidateType),
              sourceDecision: S(c.sourceDecision),
              safetyVerdict: S(c.safetyVerdict),
              maxOverlap: Number(c.maxOverlap ?? 0),
              sourceInput: S(c.sourceInput),
              provenanceNote: S(c.provenanceNote),
              filledAt: new Date().toISOString(),
            },
          },
          promptVersion: AUTOFILL_PROMPT_VERSION,
          model: AUTOFILL_MODEL,
          dedupKey: dedupKeyOf(raw.id, body),
        },
        select: { id: true, status: true },
      })
      return { rawId: raw.id, queueId: q.id, status: q.status }
    })
    done += 1
    console.log(`   ✅ queue=${res.queueId} · ${res.status}  ${title.slice(0, 24)}`)
  }

  // ── ⑥ 정합 ──
  const after = {
    raw: await prisma.microSeedRawContent.count(),
    queue: await prisma.originalPostApprovalQueue.count(),
    post: await prisma.post.count(),
  }
  const v = verifyAfterRefill({ before, after, added: done })
  console.log(`\n⑥ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
  for (const p of v.problems) console.log(`   🔴 ${p}`)
  console.log(`   RawContent ${before.raw} → ${after.raw} · Queue ${before.queue} → ${after.queue}`
    + ` · Post ${before.post} → ${after.post}`)

  const stockAfter = readStock(await prisma.originalPostApprovalQueue.findMany({
    select: { status: true, promptVersion: true, createdPostId: true },
  }))
  console.log(`   재고 ${stock.usable} → ${stockAfter.usable}건 (목표 ${STOCK_TARGET})`)
  console.log('\n   🔴 발행하지 않았다. 다음 발행은 auto-publish 러너가 스케줄에 따라 한다.\n')
  await prisma.$disconnect()
  process.exit(v.ok ? 0 : 1)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 DB 를 건드리지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
