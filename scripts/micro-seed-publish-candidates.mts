#!/usr/bin/env tsx
/**
 * 발행 후보 모으기 — 🔴 **발행하지 않는다. 파일 하나를 만들 뿐이다** (§4-AH)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AH
 *
 * 두 레인에서 **사람이 고른 글**을 한 파일로 모은다.
 *   🟢 Seed 초안 검수(§4-AB)의 `ADOPT`
 *   🔵 Raw 재작성 작업대(§4-AG)의 `SAVE`
 *
 * 🔴 **SRN(`APPROVE`)은 오지 않는다.** 그쪽은 원문을 그대로 내되 noindex 로 두는 레인이라
 *    발행 정책이 다르다(§4-Y·§4-Z). 같은 파일에 섞으면 **어느 행이 어떤 정책으로
 *    나가는지 파일만 보고는 알 수 없다.** 경로를 따로 둔다.
 *
 * 🔴 **하지 않는 것**
 *    실제 발행 · DB write · Prisma · Google Sheet · LLM · noindex 배포 ·
 *    Raw Vault 적재 · 네이버 접속 · scout · 82cook adapter.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-publish-candidates.mts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PUBLISH_NOTE, dedupe, toTsv,
  type PublishCandidate,
} from './lib/micro-seed-publish-candidates.mjs'

export const PUBLISH_DATA_DIR = '.microseed-data'

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

export function isInsideDataDir(p: string): boolean {
  const rel = relative(process.cwd(), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${PUBLISH_DATA_DIR}/`)
}
export function assertInsideDataDir(p: string): void {
  if (!isInsideDataDir(p)) {
    fail(`🔴 ${relative(process.cwd(), resolve(p))} 은 ${PUBLISH_DATA_DIR}/ 밖이다 — 거부한다.`)
  }
}
export function publishRunId(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

type Row = Record<string, unknown>

function readJsonList(path: string, key: string): Row[] {
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const list = j[key]
    return Array.isArray(list) ? (list as Row[]) : []
  } catch { return [] }
}
const S = (v: unknown): string => String(v ?? '')

/** 🟢 Seed 초안 검수에서 `ADOPT` 만 (§4-AB) */
export function fromSeedReview(rows: readonly Row[], from: string): PublishCandidate[] {
  return rows
    .filter((r) => S(r.decision) === 'ADOPT')
    .map((r) => ({
      candidateType: 'seedOriginality' as const,
      sourceArticleId: S(r.sourceArticleId),
      sourceSite: S(r.sourceSite),
      sourceInput: from,
      sourceDecision: 'ADOPT',
      title: S(r.title),
      // 🔴 템플릿으로 만든 초안이다 — 원문이 아니다
      body: S(r.body),
      safetyVerdict: S(r.safetyVerdict),
      maxOverlap: Number(r.maxOverlap ?? 0),
      leakedTokens: S(r.leakedTokens),
      reviewedAt: S(r.reviewedAt),
      writtenAt: S(r.generatedAt),
      provenanceNote: `Seed Originality 초안 · 소재 사전+템플릿 · 사람 ADOPT (${from})`,
    }))
}

/** 🔵 Raw 재작성 작업대에서 `SAVE` 만 (§4-AG) */
export function fromRawRewrite(
  rows: readonly Row[], from: string, safetyById: ReadonlyMap<string, string> = new Map(),
): PublishCandidate[] {
  return rows
    .filter((r) => S(r.decision) === 'SAVE')
    .map((r) => ({
      candidateType: 'rawOriginality' as const,
      sourceArticleId: S(r.sourceArticleId),
      sourceSite: S(r.sourceSite),
      sourceInput: from,
      sourceDecision: 'SAVE',
      title: S(r.draftTitle),
      // 🔴 사람이 다시 쓴 글이다 — 원문도, bodyHead 도 아니다
      body: S(r.draftBody),
      // 🟡 작업대 산출에는 safety 가 없다(14컬럼). 승인 파일에서 끌어온다 —
      //    발행 후보인데 safety 가 비어 있으면 그 파일의 의미가 약해진다.
      safetyVerdict: safetyById.get(S(r.sourceArticleId)) ?? '',
      maxOverlap: Number(r.overlapWithSource ?? 0),
      // 🔴 Raw 쪽 leakedTokens 는 아직 없다 — 소재 사전이 필요해 T7-2 로 미뤘다(§4-AG ⑨)
      leakedTokens: '',
      reviewedAt: S(r.writtenAt),
      writtenAt: S(r.writtenAt),
      provenanceNote: `Raw Originality 재작성 · 사람이 직접 씀(${S(r.writtenBy) || 'human'}) · SAVE (${from})`,
    }))
}

/** Raw 승인 파일에서 `sourceArticleId` → `safetyVerdict` 를 모은다 */
export function safetyIndex(dir: string): Map<string, string> {
  const m = new Map<string, string>()
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /^raw-originality-approvals-.*\.json$/.test(f)).sort()
  } catch { return m }
  for (const f of files) {
    for (const r of readJsonList(join(dir, f), 'decisions')) {
      const id = S(r.sourceArticleId)
      if (id !== '' && S(r.safetyVerdict) !== '') m.set(id, S(r.safetyVerdict))
    }
  }
  return m
}

export function collect(dir: string): {
  candidates: PublishCandidate[]
  seedFiles: string[]
  rawFiles: string[]
} {
  let all: string[] = []
  try { all = readdirSync(dir).sort() } catch { return { candidates: [], seedFiles: [], rawFiles: [] } }
  const seedFiles = all.filter((f) => /^seed-review-.*\.json$/.test(f))
  const rawFiles = all.filter((f) => /^raw-rewrite-workbench-.*\.json$/.test(f))
  const safety = safetyIndex(dir)
  const candidates: PublishCandidate[] = []
  for (const f of seedFiles) candidates.push(...fromSeedReview(readJsonList(join(dir, f), 'decisions'), f))
  for (const f of rawFiles) candidates.push(...fromRawRewrite(readJsonList(join(dir, f), 'drafts'), f, safety))
  return { candidates, seedFiles, rawFiles }
}

function main(): void {
  const { candidates, seedFiles, rawFiles } = collect(PUBLISH_DATA_DIR)
  if (seedFiles.length === 0 && rawFiles.length === 0) {
    fail(`${PUBLISH_DATA_DIR} 에서 검수 결과를 찾지 못했다 —\n`
      + '   seed-review-*.json 또는 raw-rewrite-workbench-*.json 이 필요하다')
  }
  const { kept, dropped } = dedupe(candidates)

  console.log('\n발행 후보 모으기 — 🔴 발행하지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${PUBLISH_NOTE}`)
  console.log('  🔴 실제 발행 0 · DB write 0 · Sheet 0 · LLM 0 · noindex 0 · Raw Vault 0 · 네이버 0')
  console.log('  🔴 SRN(APPROVE)은 오지 않는다 — noindex 정책이 달라 경로가 따로다')
  console.log(`  입력  Seed 검수 ${seedFiles.length}개 · Raw 작업대 ${rawFiles.length}개`)
  console.log(`  후보  ${candidates.length}건 → 중복 정리 후 ${kept.length}건`)
  if (dropped.length > 0) {
    console.log(`  🟡 같은 글 ${dropped.length}건 정리 — 최신 판단을 남긴다`)
    for (const d of dropped.slice(0, 6)) {
      console.log(`     ${d.key.split(' ')[0]}  남김 ${d.keptFrom} · 버림 ${d.droppedFrom}`)
    }
    if (dropped.length > 6) console.log(`     … 외 ${dropped.length - 6}건`)
  }
  const byType = new Map<string, number>()
  for (const c of kept) byType.set(c.candidateType, (byType.get(c.candidateType) ?? 0) + 1)
  for (const [t, n] of byType) console.log(`     ${t.padEnd(18)} ${n}건`)
  for (const c of kept) {
    console.log(`    ${c.candidateType === 'seedOriginality' ? '🟢' : '🔵'} ${c.sourceArticleId.padEnd(10)}`
      + ` safety ${(c.safetyVerdict || '?').padEnd(6)} 겹침 ${String(c.maxOverlap).padStart(2)}자  ${c.title.slice(0, 24)}`)
  }
  const noSafety = kept.filter((c) => c.safetyVerdict !== 'pass')
  if (noSafety.length > 0) console.log(`  🔴 safety 가 pass 가 아닌 후보 ${noSafety.length}건 — 사람이 봐야 한다`)

  const runId = publishRunId(new Date())
  const tsvPath = `${PUBLISH_DATA_DIR}/publish-candidates-${runId}.tsv`
  const jsonPath = `${PUBLISH_DATA_DIR}/publish-candidates-${runId}.json`
  assertInsideDataDir(tsvPath)
  assertInsideDataDir(jsonPath)
  writeFileSync(tsvPath, toTsv(kept), 'utf-8')
  writeFileSync(jsonPath, JSON.stringify({
    note: PUBLISH_NOTE,
    generatedAt: new Date().toISOString(),
    inputs: { seed: seedFiles, raw: rawFiles },
    excludedNote: 'SRN(APPROVE)은 noindex 정책이 달라 이 파일에 오지 않는다 (§4-AH ③)',
    candidates: kept,
  }, null, 2), 'utf-8')

  console.log(`\n  ✅ ${tsvPath}`)
  console.log(`  ✅ ${jsonPath}`)
  console.log('\n  🔴 이 파일은 발행 큐가 아니다. 무엇을 언제 낼지는 사람이 정한다.')
  console.log(`  🔴 ${PUBLISH_NOTE}\n`)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 파일을 쓰지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
