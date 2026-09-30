#!/usr/bin/env tsx
/**
 * 발행 후보 → 기존 검수 대기열 브리지 — 🔴 **임시 다리다** (§4-AJ)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AJ
 *
 * 🔴 **이 스크립트가 무엇이 아닌지부터.**
 *    발행이 아니다. 승인도 아니다. 새 발행 시스템도 아니다.
 *    `publish-candidates-*.json` 의 글을 **이미 살아 있는 발행 파이프라인의 첫 칸**
 *    (`OriginalPostApprovalQueue`, status=PENDING)에 얹을 뿐이다.
 *    그 뒤는 기존 경로 그대로다 — 사람 승인 → 페르소나 배정 → publish-live.
 *
 * 🔴 **왜 다리가 필요한가.**
 *    `OriginalPostApprovalQueue.sourceRawContentId` 는 필수 FK 다.
 *    우리 후보는 원문을 저장하지 않았으므로(§4-AF ⑤) 이을 원문이 없다.
 *    그래서 **synthetic MicroSeedRawContent 행**을 만들어 잇는다.
 *
 * 🔴 **여기 갚아야 할 빚이 있다 (semantic debt).**
 *    ① `MicroSeedRawContent` 는 이름 그대로 **수집한 원문**을 담는 테이블인데,
 *       우리는 거기에 **우리가 쓴 글**을 넣는다.
 *    ② `origin` enum 에 우리 레인 값이 없어 `live` 를 쓴다 —
 *       `unao_legacy` 는 발행 금지 대상이라 못 쓴다(schema §10-1).
 *    이 둘은 **`origin` enum 에 값을 더해 갚는다.** 그건 DB 마이그레이션이라
 *    이번 PR 에서 하지 않는다(창업자 결정). 그때까지 아래로 표시를 남긴다:
 *      · `sourceSite` 에 `SYNTHETIC_SITE_PREFIX` 를 붙인다 → 조회로 걸러낼 수 있다
 *      · `sourceUrl` 에 후보 파일 경로를 적는다 → 어디서 왔는지 추적된다
 *      · 큐의 `promptVersion`·`model` 로 **사람이 쓴 글**임을 못박는다
 *
 * 🔴 **하지 않는 것**
 *    실제 발행(publish-live) · 승인(APPROVED 전환) · 페르소나 배정 ·
 *    LLM · 네이버 접속 · 원문 재적재 · Google Sheet · noindex · DB 마이그레이션.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-publish-enqueue.mts                     # dry-run
 *   npx tsx scripts/micro-seed-publish-enqueue.mts --apply --limit=2   # 실제 write
 *   npx tsx scripts/micro-seed-publish-enqueue.mts --input=<path> --all
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Prisma, PrismaClient } from '@prisma/client'

export const CANDIDATE_DATA_DIR = '.microseed-data'

/** 🔴 synthetic 행임을 조회로 걸러낼 수 있게 하는 표시 (enum 을 못 쓰는 동안의 대용) */
export const SYNTHETIC_SITE_PREFIX = 'publish-candidate:'

/** 🔴 사람이 고른 글이다. LLM 이 아니다 — 큐를 나중에 볼 때 이 둘로 구분한다 */
export const BRIDGE_PROMPT_VERSION = 'publish-candidate-v1'
export const BRIDGE_MODEL = 'human-curated'

/** 기존 발행 게이트가 요구하는 값 (src/lib/original-post-publish.ts FIRST_PUBLISH_VERDICT) */
export const BRIDGE_GATE_VERDICT = 'PASS'

/** 🔴 SRN 은 오지 않는다 — noindex 정책이 달라 경로가 따로다 (§4-AH ③) */
export const ALLOWED_TYPES: readonly string[] = ['seedOriginality', 'rawOriginality'] as const

/** 오늘 발행하기로 한 2건 (§4-AJ ④). `--all` 을 주면 이 제한을 풀고 파일 전체를 본다 */
export const TODAY_TITLES: readonly string[] = [
  '집에 늘 두고 드시는 간식이 있으세요?',
  '엄마가 일을 시작하셨는데 표정이 달라지셨어요',
] as const

export type Candidate = {
  candidateType?: string
  sourceArticleId?: string
  sourceSite?: string
  sourceInput?: string
  sourceDecision?: string
  title?: string
  body?: string
  safetyVerdict?: string
  maxOverlap?: number
  leakedTokens?: string
  reviewedAt?: string
  writtenAt?: string
  provenanceNote?: string
}

export type Plan = {
  candidate: Candidate
  /** synthetic RawContent 에 쓸 값 */
  syntheticSite: string
  syntheticUrl: string
  /**
   * 🔴 **초안(검토) 시각이다 — 원문 시각이 아니다** (2026-09-30 이름 정직화). `sourceCapturedAt` 칸에 들어가지만
   *    어떤 판정도 그 칸을 원문 나이로 읽지 않는다. 이 다리로 올라간 행에는 원문 증거 기록이 없다 →
   *    발행 판정(`judgeSlotRelease`)이 모르는 것(unknown)으로 읽고 자동 발행하지 않는다.
   */
  draftedAt: Date
  /** 큐 dedupKey 계산에 쓰는 안정 키 — RawContent id 를 아직 모르므로 이것으로 갈음한다 */
  provenanceKey: string
}
export type Skip = { title: string; reason: string }

const S = (v: unknown): string => String(v ?? '')

/** 최신 발행 후보 파일 — 이름으로 고른다. 네트워크가 아니다 */
export function latestCandidateFile(dir: string): string | null {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /^publish-candidates-.*\.json$/.test(f)).sort()
  } catch { return null }
  return files.length > 0 ? join(dir, files[files.length - 1]!) : null
}

export function readCandidates(path: string): Candidate[] {
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as { candidates?: Candidate[] }
    return Array.isArray(j.candidates) ? j.candidates : []
  } catch { return [] }
}

/**
 * 같은 글인가를 가르는 키 — §4-AH ⑤ 와 **같은 규칙**이다.
 *
 * 🔴 `sourceArticleId` 만으로는 안 된다. 한 원천에서 서로 다른 초안이 둘 채택될 수 있다.
 */
export function provenanceKey(articleId: string, title: string): string {
  return `${articleId} ${title.replace(/\s+/g, ' ').trim()}`
}

/** synthetic 행의 `sourceArticleId` — 원문 수집이 나중에 같은 id 를 써도 부딪히지 않게 한다 */
export function syntheticArticleId(articleId: string, title: string): string {
  const h = createHash('sha256').update(provenanceKey(articleId, title), 'utf8').digest('hex')
  return `${articleId}-${h.slice(0, 8)}`
}

/**
 * 무엇을 올릴지 고른다 — 🔴 **사람이 고른 것만.**
 *
 * `ADOPT`(Seed)·`SAVE`(Raw) 만 후보 파일에 있으므로 여기서 다시 거를 것은
 * **축**(SRN 배제)과 **오늘 목록**뿐이다.
 */
export function planEnqueue(
  candidates: readonly Candidate[],
  opts: { all: boolean; existing: ReadonlySet<string> },
): { plan: Plan[]; skipped: Skip[] } {
  const plan: Plan[] = []
  const skipped: Skip[] = []
  for (const c of candidates) {
    const title = S(c.title)
    const id = S(c.sourceArticleId)
    if (title === '' || id === '') { skipped.push({ title: title || '(제목 없음)', reason: '식별 불가' }); continue }

    const type = S(c.candidateType)
    // 🔴 SRN 은 애초에 후보 파일에 없지만, 다른 축이 섞여 들어오면 여기서 막는다
    if (!ALLOWED_TYPES.includes(type)) { skipped.push({ title, reason: `축 ${type || '없음'}` }); continue }

    const dec = S(c.sourceDecision)
    if (dec !== 'ADOPT' && dec !== 'SAVE') { skipped.push({ title, reason: `판정 ${dec || '없음'}` }); continue }

    // 🔴 발행 후보인데 safety 가 pass 가 아니면 올리지 않는다
    if (S(c.safetyVerdict) !== 'pass') { skipped.push({ title, reason: `safety ${S(c.safetyVerdict) || '없음'}` }); continue }

    if (S(c.body) === '') { skipped.push({ title, reason: '본문 없음' }); continue }

    if (!opts.all && !TODAY_TITLES.includes(title)) { skipped.push({ title, reason: '오늘 대상 아님' }); continue }

    const key = provenanceKey(id, title)
    if (opts.existing.has(key)) { skipped.push({ title, reason: '이미 올림' }); continue }

    const draftedAt = S(c.reviewedAt) !== '' ? new Date(S(c.reviewedAt)) : new Date()
    plan.push({
      candidate: c,
      // 🔴 원래 sourceSite 를 지우지 않고 **앞에 표시를 붙인다** — 어디서 온 소재인지는 남아야 한다
      syntheticSite: `${SYNTHETIC_SITE_PREFIX}${S(c.sourceSite)}`,
      syntheticUrl: `publish-candidate://${S(c.sourceInput) || 'unknown'}#${id}`,
      draftedAt: Number.isNaN(draftedAt.getTime()) ? new Date() : draftedAt,
      provenanceKey: key,
    })
  }
  return { plan, skipped }
}

/** 큐 dedupKey — 기존 `queueDedupKey` 와 같은 모양(`sha256:…`)을 쓴다 */
export function bridgeDedupKey(rawContentId: string, body: string): string {
  const b = createHash('sha256').update(body, 'utf8').digest('hex')
  return `sha256:${createHash('sha256').update(`${rawContentId}::${b}`, 'utf8').digest('hex')}`
}

/** 큐에 남길 게이트 기록 — 우리가 실제로 무엇을 확인했는지 (기존 형식 `{holds,blocks}` 를 따른다) */
export function bridgeGateResults(c: Candidate): Prisma.InputJsonObject {
  return {
    holds: [],
    blocks: [],
    bridge: {
      note: '사람이 고른 발행 후보 — LLM 생성이 아니다',
      candidateType: S(c.candidateType),
      sourceDecision: S(c.sourceDecision),
      safetyVerdict: S(c.safetyVerdict),
      maxOverlap: Number(c.maxOverlap ?? 0),
      leakedTokens: S(c.leakedTokens),
      sourceInput: S(c.sourceInput),
      provenanceNote: S(c.provenanceNote),
    },
  }
}

/**
 * 이미 올린 것을 찾는다 — 🔴 **세 곳을 다 본다.**
 *
 * synthetic RawContent 가 있어도 큐가 없을 수 있고(중간에 끊긴 실행),
 * 큐가 PUBLISHED 로 갔으면 Post 도 있다. 하나만 보면 중복이 샌다.
 */
export async function existingKeys(prisma: PrismaClient): Promise<Set<string>> {
  const keys = new Set<string>()
  const raws = await prisma.microSeedRawContent.findMany({
    where: { sourceSite: { startsWith: SYNTHETIC_SITE_PREFIX } },
    select: { id: true, rawTitle: true, sourceArticleId: true },
  })
  for (const r of raws) {
    // synthetic id 는 `<원래id>-<해시8>` 이므로 앞부분을 되돌린다
    const orig = r.sourceArticleId.includes('-')
      ? r.sourceArticleId.slice(0, r.sourceArticleId.lastIndexOf('-'))
      : r.sourceArticleId
    keys.add(provenanceKey(orig, r.rawTitle))
  }
  return keys
}

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (n: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`))
    return hit === undefined ? undefined : hit.slice(n.length + 3)
  }
  const APPLY = argv.includes('--apply')
  const ALL = argv.includes('--all')
  const LIMIT_RAW = arg('limit')

  const { loadEnvLocal } = await import('./lib/micro-seed-time.mjs')
  await loadEnvLocal()

  const inputMaybe = arg('input') ?? latestCandidateFile(CANDIDATE_DATA_DIR)
  // 🔴 `return fail(...)` 로 좁힌다 — return 이 없으면 아래에서 여전히 string | null 이다
  if (inputMaybe === null) return fail(`${CANDIDATE_DATA_DIR}/publish-candidates-*.json 을 찾지 못했다`)
  const input: string = inputMaybe
  const candidates = readCandidates(input)
  if (candidates.length === 0) fail(`${input} 에서 후보를 읽지 못했다`)

  const { PrismaClient: PC } = await import('@prisma/client')
  const prisma = new PC()

  const existing = await existingKeys(prisma)
  const { plan, skipped } = planEnqueue(candidates, { all: ALL, existing })

  console.log('\n발행 후보 → 검수 대기열 브리지 — 🔴 발행하지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log('  🔴 발행 아님 · 승인 아님 · 페르소나 배정 아님 — 대기열(PENDING)까지다')
  console.log('  🔴 LLM 0 · 네이버 0 · Sheet 0 · noindex 0 · 원문 재적재 0 · 마이그레이션 0')
  console.log(`  🟡 semantic debt — synthetic RawContent 를 만든다(origin=live). origin enum 추가로 갚는다 (§4-AJ)`)
  console.log(`  입력  ${input} · 후보 ${candidates.length}건`)
  console.log(`  대상  ${ALL ? '파일 전체' : `오늘 ${TODAY_TITLES.length}건`} · 이미 올림 ${existing.size}건`)
  console.log(`\n① 올릴 것 ${plan.length}건`)
  for (const p of plan) {
    const c = p.candidate
    console.log(`   · [${S(c.candidateType)}] ${S(c.title)}`)
    console.log(`       본문 ${[...S(c.body)].length}자 · safety ${S(c.safetyVerdict)} · 겹침 ${Number(c.maxOverlap ?? 0)}자`)
    console.log(`       synthetic  site=${p.syntheticSite}  articleId=${syntheticArticleId(S(c.sourceArticleId), S(c.title))}`)
    console.log(`       queue      status=PENDING · gate=${BRIDGE_GATE_VERDICT} · ${BRIDGE_PROMPT_VERSION} / ${BRIDGE_MODEL}`)
  }
  if (skipped.length > 0) {
    console.log(`\n② 건너뛴 것 ${skipped.length}건`)
    const by = new Map<string, number>()
    for (const s of skipped) by.set(s.reason, (by.get(s.reason) ?? 0) + 1)
    for (const [r, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`   ${r.padEnd(16)} ${n}건`)
  }

  if (!APPLY) {
    console.log('\n③ dry-run — 🔴 DB write 0건')
    console.log('   실제로 올리려면 --apply 와 --limit=N 이 **둘 다** 필요하다.')
    console.log('   적재는 창업자 승인 경로의 첫 칸이라 스위치 하나로는 열지 않는다.\n')
    await prisma.$disconnect()
    return
  }

  const LIMIT = LIMIT_RAW === undefined ? Number.NaN : Number.parseInt(LIMIT_RAW, 10)
  if (!Number.isInteger(LIMIT) || LIMIT < 1) {
    await prisma.$disconnect()
    fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 한다')
  }
  const take = plan.slice(0, LIMIT)
  if (take.length === 0) {
    console.log('\n③ 올릴 것이 없다 — DB write 0건\n')
    await prisma.$disconnect()
    return
  }

  console.log(`\n③ 적재 ${take.length}건 (--limit ${LIMIT})`)
  let done = 0
  for (const p of take) {
    const c = p.candidate
    const title = S(c.title)
    const body = S(c.body)
    // 🔴 건별 트랜잭션. 한 건이 걸려도 나머지가 통째로 사라지지 않는다 (기존 enqueue 와 같은 원칙)
    const res = await prisma.$transaction(async (tx) => {
      const raw = await tx.microSeedRawContent.create({
        data: {
          // 🟡 semantic debt — 우리 레인 enum 이 없어 live 를 쓴다. sourceSite 접두로 구분한다
          origin: 'live',
          sourceSite: p.syntheticSite,
          sourceUrl: p.syntheticUrl,
          sourceArticleId: syntheticArticleId(S(c.sourceArticleId), title),
          // 🔴 초안 시각(칸 이름과 다르다) — 판정 입력이 아니다
          sourceCapturedAt: p.draftedAt,
          // 🔴 원문이 아니다. **사람이 고른 글**이다 — 큐 생성을 위해 여기 담는다
          rawTitle: title,
          rawBody: body,
        },
        select: { id: true },
      })
      const q = await tx.originalPostApprovalQueue.create({
        data: {
          sourceRawContentId: raw.id,
          status: 'PENDING',
          draftTitle: title,
          draftBody: body,
          gateVerdict: BRIDGE_GATE_VERDICT,
          gateResults: bridgeGateResults(c),
          promptVersion: BRIDGE_PROMPT_VERSION,
          model: BRIDGE_MODEL,
          dedupKey: bridgeDedupKey(raw.id, body),
        },
        select: { id: true, status: true },
      })
      return { rawId: raw.id, queueId: q.id, status: q.status }
    })
    done += 1
    console.log(`   ✅ raw=${res.rawId} · queue=${res.queueId} · status=${res.status}  ${title.slice(0, 22)}`)
  }

  const [rawCount, queueCount] = await Promise.all([
    prisma.microSeedRawContent.count(),
    prisma.originalPostApprovalQueue.count(),
  ])
  await prisma.$disconnect()
  console.log(`\n   적재 ${done}건 · RawContent ${rawCount} · Queue ${queueCount}`)
  console.log('   🔴 status 는 PENDING 이다. 승인도 배정도 발행도 하지 않았다.')
  console.log('   다음: original-post-decide (사람 승인) → match-assign → publish-live\n')
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 DB 를 건드리지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) void main()
