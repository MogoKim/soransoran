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
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_DECIDED_BY, MACHINE_SITE_PREFIX,
  buildQueuePayload, queueProfileOf, machineProfileMismatch,
  type Envelope, type AutoJudgeProvenance,
} from '../src/lib/micro-seed-supply-autofill'
// 🔴 적재 직전 재검증 — 새 판정을 만들지 않고 §4-AS 의 함수를 그대로 쓴다
import {
  hasInformalSpeech, endsWithQuestion, hasRepetitiveWording, echoesTitleAtEnd,
  hasBannedWord, overlapOk,
} from '../src/lib/micro-seed-auto-draft'
import { RULE_VERSION as AUTO_JUDGE_RULE_VERSION, PROMPT_VERSION as AUTO_JUDGE_PROMPT_VERSION }
  from '../src/lib/micro-seed-auto-judge'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
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

/**
 * 🔴 **두 갈래를 모두 찾는다.** 사람 후보와 기계 후보가 다른 파일에 산다 —
 *    하나만 보면 나머지 갈래가 통째로 놀게 된다.
 *    `--input` 은 진단용 override 로 남는다.
 */
function latestOfEach(dir: string): string[] {
  if (!existsSync(dir)) return []
  const all = readdirSync(dir).sort()
  const last = (re: RegExp): string | null => {
    const hits = all.filter((f) => re.test(f))
    return hits.length === 0 ? null : join(dir, hits[hits.length - 1]!)
  }
  return [
    last(/^publish-candidates-.*\.json$/),
    last(/^auto-draft-.*\.candidates\.json$/),
  ].filter((x): x is string => x !== null)
}

/** 후보마다 어느 봉투에서 왔는지 — 🔴 파일을 합쳐도 봉투를 잃지 않는다 */
const envMap = new WeakMap<object, Envelope>()
const ajMap = new WeakMap<object, AutoJudgeProvenance>()
function envelopeOf(c: Candidate): Envelope { return envMap.get(c as object) ?? {} }
function autoJudgeOf(c: Candidate): AutoJudgeProvenance { return ajMap.get(c as object) ?? {} }

/** 🔴 봉투와 행을 함께 읽는다 — 행만 읽으면 기계 profile 을 검증할 수 없다 */
function readCandidateFile(path: string): { envelope: Envelope; candidates: Candidate[] } {
  const j = JSON.parse(readFileSync(path, 'utf-8')) as {
    candidates?: Candidate[]; provenance?: string; ruleVersion?: string
    promptVersion?: string; model?: string
  }
  return {
    envelope: {
      provenance: j.provenance, ruleVersion: j.ruleVersion,
      promptVersion: j.promptVersion, model: j.model,
    },
    candidates: Array.isArray(j.candidates) ? j.candidates : [],
  }
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

/** 우리가 만든 synthetic 인가 — 🔴 사람 접두와 기계 접두 둘 다 */
function isOurSite(site: string): boolean {
  return site.startsWith(AUTOFILL_SITE_PREFIX) || site.startsWith(MACHINE_SITE_PREFIX)
}

/**
 * 적재 직전 재검증 — 🔴 **새 판정을 만들지 않는다. §4-AS 의 함수를 그대로 부른다.**
 *
 * 파일과 DB 사이에 시간이 흐른다. 그 사이 무엇이 바뀔지 모르므로 여기서 한 번 더 잰다.
 * 두 곳이 다른 기준을 쓰면 어느 쪽이 맞는지 알 수 없게 되므로 **같은 함수**를 쓴다.
 */
function recheck(title: string, body: string, overlap: number): string[] {
  const bad: string[] = []
  if (title === '' || body === '') bad.push('제목이나 본문이 비었다')
  if (safetyFilter({ title, body }).verdict !== 'pass') bad.push('safety 가 pass 가 아니다')
  if (hasBannedWord(`${title}${body}`)) bad.push('🔴 금지어가 있다')
  if (!overlapOk(overlap)) bad.push(`🔴 원문 겹침 ${overlap}자`)
  if (hasRepetitiveWording(title)) bad.push('🔴 제목 낱말이 반복된다')
  if (echoesTitleAtEnd(title, body)) bad.push('🔴 제목을 본문 끝에 되풀이한다')
  if (hasInformalSpeech(body)) bad.push('🔴 반말이다')
  if (!endsWithQuestion(body)) bad.push('🔴 마지막이 물음표가 아니다')
  return bad
}

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
  const override = arg('input')
  const inputPaths = override !== null ? [override] : latestOfEach(DATA_DIR)
  if (inputPaths.length === 0) fail(`${DATA_DIR} 에 후보 파일이 없습니다`)
  for (const p2 of inputPaths) if (!existsSync(p2)) fail(`후보 파일을 찾지 못했습니다: ${p2}`)

  // 🔴 파일을 합치되 **봉투를 잃지 않는다.** 후보마다 어느 봉투에서 왔는지 기억한다
  const candidates: Candidate[] = []
  const fileNote: string[] = []
  for (const p2 of inputPaths) {
    const { envelope: env, candidates: rows } = readCandidateFile(p2)
    const isM = S(env.provenance) === MACHINE_PROFILE.envelopeProvenance
    fileNote.push(`${p2.split('/').pop()} (${isM ? '기계' : '사람'} ${rows.length}건)`)
    for (const r of rows) {
      envMap.set(r as object, env)
      // 🔴 후보에 실려 온 판정 출처를 이관한다 — 상수를 찍지 않는다
      const aj = (r as unknown as Record<string, unknown>).autoJudge
      if (aj !== null && typeof aj === 'object') ajMap.set(r as object, aj as AutoJudgeProvenance)
      candidates.push(r)
    }
  }
  // 🔴 순서를 고정한다 — 파일 순서가 달라도 같은 것을 고른다
  candidates.sort((a, b) =>
    S(a.sourceArticleId).localeCompare(S(b.sourceArticleId))
    || S(a.title).localeCompare(S(b.title)))
  const { held, missing } = readHeld(HELD_FILE)

  console.log(APPLY ? '\n══ 🔴 실제 보충 (--apply) ══\n' : '\n══ dry-run (DB write 0 · Post 0) ══\n')
  console.log(`  후보 파일  ${fileNote.join(' · ')} → 합계 ${candidates.length}건`)
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
      // 🔴 재고는 profile 로 센다 — 판만 보면 못 먹는 행까지 센다
      model: true, gateResults: true,
      rawContent: { select: { sourceArticleId: true, rawTitle: true, sourceSite: true } },
    },
  })

  // ── ① 재고 ──
  // 🔴 sourceSite 는 RawContent 에 산다 — profile 판정에 넘겨준다
  const stock = readStock(queueRows.map((r) => ({
    status: r.status, createdPostId: r.createdPostId,
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  })))
  const mark = stock.level === 'critical' ? '🔴' : stock.level === 'low' ? '🟡' : '🟢'
  console.log(`① 재고  ${mark} 러너가 먹을 수 있는 것 ${stock.usable}건`)
  console.log(`   큐 전체 ${queueRows.length}건 중 발행 러너가 인정하는 것만 센다`
    + ` — 사람 ${stock.human} · 기계 ${stock.machine}`)
  if (stock.shortfall > 0) console.log(`   목표까지 ${stock.shortfall}건 부족`)

  // 이미 올라간 것 — synthetic RawContent 기준으로 되돌린 키
  const existing = new Set<string>()
  for (const r of queueRows) {
    const rc = r.rawContent
    // 🔴 사람 것과 기계 것 둘 다 본다 — 한쪽만 보면 중복이 샌다
    if (rc === null || !isOurSite(rc.sourceSite)) continue
    existing.add(provenanceKeyOf(baseArticleId(rc.sourceArticleId), rc.rawTitle))
  }
  const queueForSibling = queueRows
    .filter((r) => r.rawContent !== null && isOurSite(r.rawContent.sourceSite))
    .map((r) => ({
      sourceArticleId: r.rawContent!.sourceArticleId,
      status: r.status,
      createdPostId: r.createdPostId,
    }))

  // ── ② 선별 ──
  // 🔴 후보마다 자기 봉투로 판정한다 — 합친 뒤에도 어느 갈래인지 잃지 않는다
  const targets: Candidate[] = []
  const skipped: { title: string; code: string }[] = []
  const seenKeys = new Set(existing)
  const siblingSeen = [...queueForSibling]
  for (const c of candidates) {
    const r = planRefill({
      envelope: envelopeOf(c), candidates: [c], held,
      existing: seenKeys, queue: siblingSeen, usable: stock.usable,
    })
    if (r.targets.length === 1) {
      targets.push(c)
      // 🔴 합친 뒤에도 중복·형제를 막는다
      seenKeys.add(provenanceKeyOf(S(c.sourceArticleId), S(c.title)))
      siblingSeen.push({
        sourceArticleId: syntheticArticleId(S(c.sourceArticleId), S(c.title)),
        status: 'APPROVED', createdPostId: null,
      })
    } else if (r.skipped[0] !== undefined) skipped.push(r.skipped[0])
  }
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

  // ── ③-b 적재 예정 payload 미리보기 ──
  // 🔴 dry-run 에서도 실제 create 에 쓰일 값을 그대로 만들어 profileOf 를 확인한다.
  //    P0 (기계 행에 사람 접두가 붙어 러너가 전부 거절) 이 다시 나면 여기서 먼저 걸린다.
  const previewN = LIMIT !== null && LIMIT > 0 ? Math.min(LIMIT, targets.length) : Math.min(stock.shortfall, targets.length)
  const preview = targets.slice(0, previewN).map((c) => {
    const pl = buildQueuePayload({
      envelope: envelopeOf(c), candidate: c,
      autoJudge: autoJudgeOf(c), now: new Date().toISOString(),
    })
    return {
      title: S(c.title),
      profile: pl === null ? null
        : queueProfileOf({
          promptVersion: pl.promptVersion, model: pl.model,
          sourceSite: pl.syntheticSite, gateResults: pl.gateResults,
        }),
      decidedBy: pl?.decidedBy ?? null,
      // 🔴 만들지 못했으면 왜인지 같이 보여준다 — null 만 보이면 진단이 다시 추측이 된다
      why: pl === null ? machineProfileMismatch(envelopeOf(c), c).join(' · ') : '',
    }
  })
  const nMachine = preview.filter((x) => x.profile === 'machine').length
  const nHuman = preview.filter((x) => x.profile === 'human').length
  const nNull = preview.filter((x) => x.profile === null).length
  console.log(`\n③-b 적재 예정 ${preview.length}건의 profile — machine ${nMachine} · human ${nHuman} · 만들지 않음 ${nNull}`)
  for (const x of preview) {
    console.log(`   ${x.profile === 'machine' ? '✅' : '🔴'} ${String(x.profile)} · ${String(x.decidedBy)} · ${x.title.slice(0, 22)}`)
  }
  for (const x of preview) if (x.why !== '') console.log(`   🔴 사유 ${x.title.slice(0, 18)} — ${x.why}`)
  if (nNull > 0) console.log('   🔴 profile 을 못 만든 건이 있다 — 그 건은 적재 단계에서 건너뛴다')

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
    // 🔴 적재 직전 마지막 관문 — 하나라도 어긋나면 이 건만 건너뛴다
    const bad = recheck(title, body, Number(c.maxOverlap ?? 0))
    if (bad.length > 0) {
      console.log(`   ⏭ 건너뜀 ${title.slice(0, 20)} — ${bad.join(' · ')}`)
      continue
    }
    // 🔴 큐에 넣을 값을 순수 함수가 만든다 — 러너가 접두를 붙이다 P0 를 냈다
    const payload = buildQueuePayload({
      envelope: envelopeOf(c), candidate: c,
      autoJudge: autoJudgeOf(c), now: new Date().toISOString(),
    })
    if (payload === null) {
      console.log(`   ⏭ 건너뜀 ${title.slice(0, 20)} — profile 이 어긋나 payload 를 만들지 않는다`)
      continue
    }
    // 🔴 건별 트랜잭션. 한 건이 걸려도 나머지가 통째로 사라지지 않는다 (enqueue 와 같은 원칙)
    const res = await prisma.$transaction(async (tx) => {
      const raw = await tx.microSeedRawContent.create({
        data: {
          // 🟡 semantic debt — 우리 레인 enum 이 없어 live 를 쓴다. sourceSite 접두로 구분한다 (§4-AJ)
          origin: 'live',
          sourceSite: payload.syntheticSite,
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
          status: 'APPROVED',
          decidedBy: payload.decidedBy,
          decidedAt: new Date(),
          draftTitle: title,
          draftBody: body,
          gateVerdict: 'PASS',
          gateResults: payload.gateResults as never,
          promptVersion: payload.promptVersion,
          model: payload.model,
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

  // 🔴 적재 전 조회와 같은 필드를 읽는다 — 한쪽만 profile 을 못 보면 재고가 어긋난다
  const stockAfter = readStock((await prisma.originalPostApprovalQueue.findMany({
    select: {
      status: true, promptVersion: true, createdPostId: true, model: true,
      gateResults: true, rawContent: { select: { sourceSite: true } },
    },
  })).map((r) => ({
    status: r.status, createdPostId: r.createdPostId,
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  })))
  console.log(`   재고 ${stock.usable} → ${stockAfter.usable}건 (목표 ${STOCK_TARGET})`)
  console.log('\n   🔴 발행하지 않았다. 다음 발행은 auto-publish 러너가 스케줄에 따라 한다.\n')
  await prisma.$disconnect()
  process.exit(v.ok ? 0 : 1)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 DB 를 건드리지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
