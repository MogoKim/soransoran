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
 *   npx tsx scripts/micro-seed-supply-autofill.mts --input=<a>,<b>    ← 여러 파일 (공급 러너의 이월)
 *
 * 🔴 끝에 `FILL_REPORT {json}` 한 줄을 찍는다 — 파일별 적재·제외(코드)·상한 컷.
 *    공급 러너가 그 줄로 "그 파일을 끝냈는가" 를 기록한다(`src/lib/supply-fill-retry`).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { readWorkset, worksetFileName, sourceIdentityOf, type SupplyIntent } from '../src/lib/supply-workset'
import { findCjkIdeograph, HANJA_LANGUAGE_FIT } from '../src/lib/cjk-ideograph'
import { PrismaClient } from '@prisma/client'
import {
  planRefill, judgeApply, readStock, verifyAfterRefill, provenanceKeyOf, existingSourceKeysOf, sourceProvenanceKeyOf,
  SKIP_LABEL, type EvidenceMaterial,
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  type Candidate, type HeldEntry,
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_DECIDED_BY, MACHINE_SITE_PREFIX,
  buildQueuePayload, queueProfileOf, machineProfileMismatch, isOurSite,
  type Envelope, type AutoJudgeProvenance,
} from '../src/lib/micro-seed-supply-autofill'
import { FILL_REPORT_PREFIX, type FillReport, type FillReportFile, type FillSkipCode } from '../src/lib/supply-fill-retry'
// 🔴 적재 직전 재검증 — 새 판정을 만들지 않고 §4-AS 의 함수를 그대로 쓴다
import { echoesTitleAtEnd, hasBannedWord } from '../src/lib/micro-seed-auto-draft'
/** 🔴 독창성 정본 — 생성 · 적재 · 여기가 같은 함수를 쓴다 */
import { judgeCopy, readMeasure, describeOriginality } from '../src/lib/draft-originality'
/** 🔴 원문 증거 재료 — 목록 관측(반복 관측 · 원천 상대 스냅샷). 읽기만 한다 */
import { evidenceMaterialFor, readListObservations, type ListObservationIndex } from './lib/source-list-observations.mjs'
import { runClockFrom } from './lib/run-clock.mjs'
import { RULE_VERSION as AUTO_JUDGE_RULE_VERSION, PROMPT_VERSION as AUTO_JUDGE_PROMPT_VERSION }
  from '../src/lib/micro-seed-auto-judge'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { installFromEnv, describeScale } from '../src/lib/scale-runtime'
import { loadStockClassification, describeStockClassification } from './lib/publishable-stock.mjs'

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
/**
 * 🔴 **자동 경로용 상한.** "이만큼까지" 이지 "정확히 이만큼" 이 아니다 —
 *    러너가 부족분을 넘기는데 한 회차 후보는 몇 건뿐이라, `--limit` 으로 받으면 영영 0건이다.
 */
const UP_TO_RAW = arg('up-to')
const UP_TO = UP_TO_RAW === null ? null : Number.parseInt(UP_TO_RAW, 10)
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
/**
 * 🔴 **후보 → JIT 공급 의도** (2026-10-04 P0-2 보정). 후보 파일(`auto-draft-<runId>.candidates.json`)과 **같은 회차** 묶음
 *    (`supply-workset-<runId>.json` · `workset-v3`)이 그 원천에 배정한 슬롯을 옮긴다. 묶음이 옛 판 · 없음 · 손상이면 없다(legacy).
 */
const intentMap = new Map<object, SupplyIntent>()
function intentOf(c: Candidate): SupplyIntent | null { return intentMap.get(c as object) ?? null }
const CANDIDATE_RUN_RE = /^auto-draft-(\d{8}-\d{6})\.candidates\.json$/
export function intentsForFile(path: string): ReadonlyMap<string, SupplyIntent> | null {
  const m = CANDIDATE_RUN_RE.exec(path.split('/').pop() ?? '')
  if (m === null) return null
  const ws = join(dirname(path), worksetFileName(m[1]!))
  if (!existsSync(ws)) return null
  try {
    const r = readWorkset(JSON.parse(readFileSync(ws, 'utf-8')), m[1]!)
    return r.ok ? r.intents : null
  } catch { return null }
}
/** 후보마다 어느 파일에서 왔는지 — 🔴 보고서가 파일별로 센다 */
const fileMap = new WeakMap<object, string>()

/**
 * 🔴 **파일별 결과 한 줄** — 공급 러너가 이것으로 "그 파일을 끝냈는가" 를 기록한다.
 *    `cut` 은 관문은 지났지만 상한 때문에 이번에 넣지 못한 수다. 0 이 아니면 그 파일은 안 끝났다.
 */
function fillReport(input: {
  files: readonly { name: string; candidates: number }[]
  skipped: readonly { c: Candidate; code: FillSkipCode }[]
  loaded: readonly Candidate[]
  cut: readonly Candidate[]
  applied: boolean
}): FillReport {
  const byName = new Map<string, FillReportFile>(input.files.map((f) => [f.name, {
    name: f.name, candidates: f.candidates, loaded: 0, skipped: {}, cut: 0,
  }]))
  const total: Partial<Record<FillSkipCode, number>> = {}
  const fileOf = (c: Candidate): FillReportFile | undefined => byName.get(fileMap.get(c as object) ?? '')
  for (const s of input.skipped) {
    total[s.code] = (total[s.code] ?? 0) + 1
    const f = fileOf(s.c)
    if (f !== undefined) f.skipped[s.code] = (f.skipped[s.code] ?? 0) + 1
  }
  for (const c of input.loaded) { const f = fileOf(c); if (f !== undefined) f.loaded += 1 }
  for (const c of input.cut) { const f = fileOf(c); if (f !== undefined) f.cut += 1 }
  return {
    applied: input.applied, loaded: input.loaded.length, cut: input.cut.length,
    skipped: total, files: [...byName.values()],
  }
}
function autoJudgeOf(c: Candidate): AutoJudgeProvenance { return ajMap.get(c as object) ?? {} }

/**
 * 🔴 **후보가 들고 온 의미 검수 요약**. 생성 쪽(`micro-seed-auto-draft`)이 artifact 에서
 *    뽑아 `semanticReview` 칸에 실어 보낸다. 없으면 `null` 이고, 적재는 그것을
 *    **재지 못한 것**으로 읽어 경고를 남긴다 — "이상 없음" 으로 읽지 않는다.
 */
function reviewOf(c: Candidate): unknown {
  const v = (c as unknown as Record<string, unknown>).semanticReview
  if (v === null || v === undefined) return null
  // 🔴 이미 요약된 모양이면 그대로. `semanticSummaryOf` 가 다시 받아도 같은 값을 낸다
  return { semantic: v, deterministic: { pass: (v as Record<string, unknown>).deterministicPass === true },
    semanticCompletion: { complete: (v as Record<string, unknown>).complete === true } }
}

/**
 * 🔴 봉투와 행을 함께 읽는다 — 행만 읽으면 기계 profile 을 검증할 수 없다.
 *    🔴 **내보낸다** (2026-09-20). end-to-end fixture 가 **실제 러너가 쓴 파일**을
 *    이 함수로 읽어 봉투 계약을 검증한다 — 손으로 만든 봉투는 증거가 아니다.
 */
export function readCandidateFile(path: string): { envelope: Envelope; candidates: Candidate[] } {
  const j = JSON.parse(readFileSync(path, 'utf-8')) as {
    candidates?: Candidate[]; provenance?: string; ruleVersion?: string
    promptVersion?: string; pipelineVersion?: string; stageModels?: unknown
    qualityContractDigest?: string
  }
  return {
    envelope: {
      provenance: j.provenance, ruleVersion: j.ruleVersion,
      promptVersion: j.promptVersion, pipelineVersion: j.pipelineVersion,
      stageModels: j.stageModels,
      // 🔴 대조용으로만 읽는다 — 저장은 적재기의 코드 상수다(`buildQueuePayload`)
      qualityContractDigest: j.qualityContractDigest,
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

// 🔴 `isOurSite` 는 lib 정본을 그대로 쓴다 — 여기서 다시 쓰면 스냅샷과 범위가 갈린다

/**
 * 적재 직전 재검증 — 🔴 **새 판정을 만들지 않는다. §4-AS 의 함수를 그대로 부른다.**
 *
 * 파일과 DB 사이에 시간이 흐른다. 그 사이 무엇이 바뀔지 모르므로 여기서 한 번 더 잰다.
 * 두 곳이 다른 기준을 쓰면 어느 쪽이 맞는지 알 수 없게 되므로 **같은 함수**를 쓴다.
 */
export function recheck(title: string, body: string, originality: unknown): string[] {
  const bad: string[] = []
  if (title === '' || body === '') bad.push('제목이나 본문이 비었다')
  // 🔴 최종 생성 제목 · 본문의 실제 한자 문자 — 언어 핏(정치 아님). shared helper 하나(`findCjkIdeograph`)
  const hanja = findCjkIdeograph(title) ?? findCjkIdeograph(body)
  if (hanja !== null) bad.push(`🔴 ${HANJA_LANGUAGE_FIT}: 한자 문자(${hanja})`)
  if (safetyFilter({ title, body }).verdict !== 'pass') bad.push('safety 가 pass 가 아니다')
  if (hasBannedWord(`${title}${body}`)) bad.push('🔴 금지어가 있다')
  // 🔴 생성 · 적재 · 여기가 **같은 함수**를 쓴다. 기준을 여기서 다시 적지 않는다
  const m = readMeasure(originality)
  if (m === null) bad.push('🔴 독창성을 재지 않았다')
  else if (judgeCopy(m).copied) bad.push(`🔴 원문을 옮겼다 (${describeOriginality(m)})`)
  if (echoesTitleAtEnd(title, body)) bad.push('🔴 제목을 본문 끝에 되풀이한다')
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
  // 🔴 `loadEnvLocal()` 뒤에 설치한다 — 화면 한 줄에만 쓴다(적재 상한은 `--up-to` 하나다)
  const scale = installFromEnv(process.env)
  /**
   * 🔴 **적재 천장(700) · capacity 재고 눈금을 지웠다** (2026-09-30 · source-slot-v1).
   *    상한은 부르는 쪽이 준 `--up-to`/`--limit` 하나다 — 공급 러너는 다가오는 슬롯 수요(JIT)로 정한다.
   *    완성 글 재고를 채우는 목표는 더 이상 없다(정본: 700 · 2일치 · 14일치 창고 목표 폐기).
   */
  const override = arg('input')
  // 🔴 쉼표로 여러 파일 — 공급 러너가 이번 회차 파일에 **끝내지 못한 앞 회차 파일**을 얹는다
  const inputPaths = override !== null
    ? override.split(',').map((x) => x.trim()).filter((x) => x !== '')
    : latestOfEach(DATA_DIR)
  if (inputPaths.length === 0) fail(`${DATA_DIR} 에 후보 파일이 없습니다`)
  for (const p2 of inputPaths) if (!existsSync(p2)) fail(`후보 파일을 찾지 못했습니다: ${p2}`)

  // 🔴 파일을 합치되 **봉투를 잃지 않는다.** 후보마다 어느 봉투에서 왔는지 기억한다
  const candidates: Candidate[] = []
  const fileNote: string[] = []
  const fileCounts: { name: string; candidates: number }[] = []
  for (const p2 of inputPaths) {
    const { envelope: env, candidates: rows } = readCandidateFile(p2)
    const intents = intentsForFile(p2)
    const isM = S(env.provenance) === MACHINE_PROFILE.envelopeProvenance
    const fname = p2.split('/').pop() ?? p2
    fileNote.push(`${fname} (${isM ? '기계' : '사람'} ${rows.length}건)`)
    fileCounts.push({ name: fname, candidates: rows.length })
    for (const r of rows) {
      envMap.set(r as object, env)
      fileMap.set(r as object, fname)
      const ik = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
      const intent = ik === null ? undefined : intents?.get(ik)
      if (intent !== undefined) intentMap.set(r as object, intent)
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
  console.log(`  규모 설정  ${describeScale(scale)}`)
  console.log('  적재 상한  --up-to/--limit 하나 — 🔴 재고 목표(700 · ×14) 없음 · 공급 러너가 JIT 수요로 정한다')
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
  /**
   * 🔴 **두 수를 섞지 않는다** (2026-09-26). `stock.usable` 은 형식이 맞는 미발행 행이다 —
   *    사람 검토를 기다리는 기계 초안도 들어간다. **표시용**이다(2026-09-30 · 700 적재 천장 삭제 — 상한은 `--up-to`
   *    하나 = 공급 러너의 JIT 수요). 발행 가능 수는 발행 러너와 같은 분류(`publishableNow`)로 잰다.
   *    앞판은 형식 행을 "러너가 먹을 수 있는 것" 이라 찍었다 — 같은 DB 에서 러너는 0건이었다.
   */
  const view = await loadStockClassification(prisma, process.env, new Date())
  const publishableNow = view.classification.counts.publishableNow
  console.log(`① 큐  발행 러너 기준 지금 발행 가능 ${publishableNow}건 (분류 정본 · 슬롯 판정 source-slot-v1)`)
  for (const line of describeStockClassification(view.classification)) console.log(`   ${line}`)
  console.log(`   형식이 맞는 미발행 행 ${stock.usable}건 (사람 ${stock.human} · 기계 ${stock.machine})`
    + ` / 큐 ${queueRows.length}건 — 🔴 형식 행 수일 뿐 · 발행 가능 재고가 아니다`)

  // 이미 올라간 것 — synthetic RawContent 를 원래 원천 (사이트, id) + 제목으로 되돌린 열쇠(P0-B · `originalSourceOf`)
  // 🔴 사람 것과 기계 것 둘 다 본다 — 한쪽만 보면 중복이 샌다
  const existing = existingSourceKeysOf(queueRows.flatMap((r) =>
    r.rawContent === null || !isOurSite(r.rawContent.sourceSite) ? [] : [r.rawContent]))
  const queueForSibling = queueRows
    .filter((r) => r.rawContent !== null && isOurSite(r.rawContent.sourceSite))
    .map((r) => ({
      // 🔴 (P0-B) synthetic 사이트를 버리지 않는다 — 형제 검사가 원래 사이트로 되돌려 대 본다
      sourceSite: r.rawContent!.sourceSite,
      sourceArticleId: r.rawContent!.sourceArticleId,
      status: r.status,
      createdPostId: r.createdPostId,
    }))

  // ── ② 선별 ──
  // 🔴 후보마다 자기 봉투로 판정한다 — 합친 뒤에도 어느 갈래인지 잃지 않는다
  const targets: Candidate[] = []
  const skipped: { title: string; code: string }[] = []
  /** 🔴 보고서용 — 제목이 아니라 후보 자체를 잡아 둔다(파일별로 센다) */
  const skippedC: { c: Candidate; code: FillSkipCode }[] = []
  const seenKeys = new Set(existing)
  const siblingSeen = [...queueForSibling]
  for (const c of candidates) {
    const r = planRefill({
      envelope: envelopeOf(c), candidates: [c], held,
      existing: seenKeys, queue: siblingSeen,
    })
    if (r.targets.length === 1) {
      targets.push(c)
      // 🔴 합친 뒤에도 중복·형제를 막는다
      // 🔴 (P0-B) 같은 회차 — 원천 (사이트, id) 로 적는다. 사이트를 모르면 적재 선별이 이미 id 로 막는다
      const k = sourceProvenanceKeyOf(S(c.sourceSite), S(c.sourceArticleId), S(c.title))
      if (k !== null) seenKeys.add(k)
      siblingSeen.push({
        sourceSite: S(c.sourceSite), sourceArticleId: S(c.sourceArticleId),
        status: 'APPROVED', createdPostId: null,
      })
    } else if (r.skipped[0] !== undefined) {
      skipped.push(r.skipped[0])
      skippedC.push({ c, code: r.skipped[0].code })
    }
  }
  console.log(`\n② 파일 ${candidates.length}건 → 보충 후보 ${targets.length}건`)
  for (const t of targets) {
    console.log(`   · [${S(t.candidateType)}] ${S(t.title).slice(0, 24)}`)
    console.log(`       ${S(t.sourceSite)}:${S(t.sourceArticleId)} · 본문 ${S(t.body).length}자`
      + ` · ${(() => { const m = readMeasure(t.originality); return m === null ? '🔴 안 잼' : describeOriginality(m) })()}`)
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
  const askedN = UP_TO ?? LIMIT
  const previewN = askedN !== null && askedN > 0 ? Math.min(askedN, targets.length) : 0
  const preview = targets.slice(0, previewN).map((c) => {
    const pl = buildQueuePayload({
      envelope: envelopeOf(c), candidate: c, intent: intentOf(c),
      autoJudge: autoJudgeOf(c), review: reviewOf(c), now: new Date().toISOString(),
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
  const gate = judgeApply({ targets, apply: APPLY, limit: LIMIT, upTo: UP_TO })
  if (!gate.ok) {
    console.log(`\n④ 보충하지 않는다 — ${gate.reason}`)
    // 🔴 관문을 지난 후보가 있었는데 넣지 않았으면 전부 `cut` 이다 — 끝낸 것이 아니다
    console.log(`${FILL_REPORT_PREFIX}${JSON.stringify(fillReport({
      files: fileCounts, skipped: skippedC, loaded: [], cut: targets, applied: APPLY,
    }))}`)
    if (!APPLY) {
      console.log('   🟡 dry-run 입니다. DB write 0 · Post 0'
        + ' · 실행하려면 --apply 와 --limit=N(정확히) 또는 --up-to=N(상한까지) 을 붙이세요.')
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
  console.log(`\n⑤ 🔴 보충 ${gate.take.length}건 (${UP_TO !== null ? `--up-to ${UP_TO} · 상한까지` : `--limit ${LIMIT} · 정확히`})`)
  let done = 0
  const loadedC: Candidate[] = []
  /**
   * 🔴 **원문 증거 재료를 목록 관측에서 한 번 모은다** (2026-09-30 · source-evidence-v1).
   *    못 읽으면 재료 없음(빈 관측 · 스냅샷 null) — 행은 적재되지만 발행 판정이 모르는 것으로 읽는다(fail-closed).
   */
  /**
   * 🔴 **증거 시각은 회차 시각이다** (2026-09-30 Lane B) — 부모(`supply-process`)가 넘긴 `SORAN_RUN_AT` 을 쓴다.
   *    앞판은 여기서 벽시계를 다시 만들었다 — 부모가 묶음을 고른 시각과 표본 창이 달라졌고, 시각을 고정한 검사가
   *    이 단계만 재현하지 못했다. 단독 실행이면 자기 시계다(`runClockFrom`).
   */
  const evidenceAt = runClockFrom(process.env).at
  let listIndex: ListObservationIndex | null = null
  try { listIndex = readListObservations(DATA_DIR, evidenceAt) } catch (e) {
    console.log(`   🟡 목록 관측을 읽지 못했다 — ${e instanceof Error ? e.message : String(e)} (증거 재료 없음 = 모름)`)
  }
  if (listIndex !== null) console.log(`   목록 관측 ${listIndex.files}개 파일 · 관측 ${listIndex.sample.length}줄 · 못 읽음 ${listIndex.unreadable}`)
  /**
   * 🔴 **반응은 목록 관측에서 찾는다** (2026-09-30 Lane B) — 후보가 실어 온 목록 시각(`sourceListedAt`)이 열쇠다.
   *    앞판은 생성 봉투의 복사본(`sourceResponse`)을 읽었다 — 복사본은 지웠다(정본은 목록 artifact 하나).
   */
  const materialOf = (c: Candidate): EvidenceMaterial | null => {
    if (listIndex === null) return null
    return evidenceMaterialFor(listIndex, {
      sourceKey: S(c.sourceSite), articleId: S(c.sourceArticleId),
      postedAt: S(c.sourcePostedAt) === '' ? null : S(c.sourcePostedAt),
      listedAt: S(c.sourceListedAt) === '' ? null : S(c.sourceListedAt),
      at: evidenceAt,
    })
  }
  for (const c of gate.take) {
    const title = S(c.title)
    const body = S(c.body)
    /**
     * 🔴 **초안 시각이다 — 원문 시각이 아니다** (2026-09-30 이름 정직화). 아래 `sourceCapturedAt` 칸에 계속
     *    들어가지만(스키마 변경 없음) **어떤 판정도 이 칸을 읽지 않는다.** 원문 나이는 `gateResults.sourceEvidence`
     *    의 게시 시각으로만 잰다(`judgeSlotRelease`).
     */
    const draftedAt = S(c.reviewedAt) !== '' ? new Date(S(c.reviewedAt)) : new Date()
    // 🔴 적재 직전 마지막 관문 — 하나라도 어긋나면 이 건만 건너뛴다
    const bad = recheck(title, body, c.originality)
    if (bad.length > 0) {
      console.log(`   ⏭ 건너뜀 ${title.slice(0, 20)} — ${bad.join(' · ')}`)
      skippedC.push({ c, code: 'RECHECK' })
      continue
    }
    // 🔴 큐에 넣을 값을 순수 함수가 만든다 — 러너가 접두를 붙이다 P0 를 냈다
    const payload = buildQueuePayload({
      envelope: envelopeOf(c), candidate: c, intent: intentOf(c),
      autoJudge: autoJudgeOf(c), review: reviewOf(c), evidence: materialOf(c), now: new Date().toISOString(),
    })
    if (payload === null) {
      console.log(`   ⏭ 건너뜀 ${title.slice(0, 20)} — profile 이 어긋나 payload 를 만들지 않는다`)
      skippedC.push({ c, code: 'PAYLOAD' })
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
          // 🔴 초안 시각(칸 이름과 다르다) — 판정 입력이 아니다
          sourceCapturedAt: Number.isNaN(draftedAt.getTime()) ? new Date() : draftedAt,
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
    loadedC.push(c)
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
  console.log(`   형식 행 ${stock.usable} → ${stockAfter.usable}건 — 🔴 적재 정합용 수 · 발행 가능 재고가 아니다`)
  console.log('\n   🔴 발행하지 않았다. 다음 발행은 auto-publish 러너가 스케줄에 따라 한다.\n')
  // 🔴 상한 때문에 이번에 못 넣은 것 — `take` 밖의 관문 통과 후보
  const takenSet = new Set<object>(gate.take as object[])
  console.log(`${FILL_REPORT_PREFIX}${JSON.stringify(fillReport({
    files: fileCounts, skipped: skippedC, loaded: loadedC,
    cut: targets.filter((c) => !takenSet.has(c as object)), applied: true,
  }))}`)
  await prisma.$disconnect()
  process.exit(v.ok ? 0 : 1)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 DB 를 건드리지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
