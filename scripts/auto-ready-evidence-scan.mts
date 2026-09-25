#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 복원 scan — read-only** (2026-09-25)
 *
 * 🔴 DB write 0 · 과거 decidedBy 수정 0 · LLM 0 · 발행 0.
 *    DB 는 읽기만 한다. 쓰는 것은 **저장소 밖**의 Codex 검토 묶음 파일 하나뿐이다
 *    (원문이 들어가므로 git 에 넣지 않는다).
 *
 * 정본 위치: ~/Library/Application Support/soransoran/microseed-data (`--dir=` 로 바꿀 수 있다)
 *
 * 무엇을 하나
 *   ① `*.artifacts.json` · `*.candidates.json` 을 읽어 artifactId 색인을 만든다
 *   ② 사람(founder)이 결정한 기계 후보를 `restoreRow` 로 여섯 갈래로 나눈다
 *   ③ clean 만 적격 표본으로 세고, 무수정·수정·폐기·중대 결함을 잰다
 *   ④ 복원된 과거 행 + 현재 그림자 후보를 **하나의 Codex 마스터 검토 묶음**으로 쓴다
 *      🔴 창업자에게 개별 승인을 요청하지 않는다
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

import {
  restoreRow, cohortSampleOf, outcomeOf, hardDefectOf, digestOf, RESTORE_CLASSES,
  type ArtifactDoc, type CandidateDoc, type DecidedRow, type RestoreResult,
} from '../src/lib/auto-ready-evidence'
import { HUMAN_DECIDER, CONTRACT, eligibilityOf } from '../src/lib/auto-ready-v2'
import { profileOf } from '../src/lib/original-post-auto-publish'
import { semanticSummaryOf } from '../src/lib/micro-seed-supply-autofill'
import { loadPublishableStock } from './lib/publishable-stock.mjs'

const argv = process.argv.slice(2)
const DIR = argv.find((a) => a.startsWith('--dir='))?.slice(6)
  ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data')
const OUT_ROOT = join(homedir(), 'Library', 'Application Support', 'soransoran', 'auto-ready-review')
const NOW = new Date()

const S = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

function loadIndex(): {
  artifacts: Map<string, ArtifactDoc[]>; candidates: Map<string, CandidateDoc[]>
  files: { artifacts: number; candidates: number }; raw: Map<string, Record<string, unknown>>
} {
  const artifacts = new Map<string, ArtifactDoc[]>()
  const candidates = new Map<string, CandidateDoc[]>()
  const raw = new Map<string, Record<string, unknown>>()
  const names = readdirSync(DIR)
  const aFiles = names.filter((n) => n.endsWith('.artifacts.json'))
  const cFiles = names.filter((n) => n.endsWith('.candidates.json'))
  for (const f of aFiles) {
    const arr = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as unknown
    for (const a of Array.isArray(arr) ? arr : []) {
      const r = rec(a)
      const id = S(r.artifactId)
      if (id === '') continue
      const doc: ArtifactDoc = {
        file: f, artifactId: id, sourceArticleId: S(r.sourceArticleId),
        contract: rec(r.contract), planPersonaCode: S(rec(r.plan).personaCode) || null,
        voice: rec(rec(r.voice).provenance),
        draft: { title: S(rec(r.draft).title), body: S(rec(r.draft).body) },
        review: r.review,
      }
      artifacts.set(id, [...(artifacts.get(id) ?? []), doc])
      raw.set(`${f}#${id}`, r)
    }
  }
  for (const f of cFiles) {
    const env = rec(JSON.parse(readFileSync(join(DIR, f), 'utf8')))
    for (const c of Array.isArray(env.candidates) ? env.candidates : []) {
      const r = rec(c)
      const id = S(r.artifactId)
      if (id === '') continue
      const doc: CandidateDoc = {
        file: f, artifactId: id, sourceArticleId: S(r.sourceArticleId), sourceSite: S(r.sourceSite),
      }
      candidates.set(id, [...(candidates.get(id) ?? []), doc])
    }
  }
  return { artifacts, candidates, files: { artifacts: aFiles.length, candidates: cFiles.length }, raw }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY 증거 복원 scan (read-only · DB write 0) ══')
  const idx = loadIndex()
  console.log(`   정본 디렉터리 artifact 파일 ${idx.files.artifacts}개 · candidates 파일 ${idx.files.candidates}개`)
  console.log(`   artifactId ${idx.artifacts.size}종 · 중복 ${[...idx.artifacts.values()].filter((v) => v.length > 1).length}종\n`)

  const select = {
    id: true, decidedBy: true, status: true, createdPostId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    gateVerdict: true, gateResults: true, editDiff: true, declineReason: true,
    promptVersion: true, model: true,
    matchedPersona: { select: { code: true } },
    rawContent: {
      select: {
        sourceSite: true, sourceArticleId: true, sourceCapturedAt: true, rawTitle: true, rawBody: true,
      },
    },
  } as const
  const toDecided = (r: Awaited<ReturnType<typeof prisma.originalPostApprovalQueue.findMany<{ select: typeof select }>>>[number]): DecidedRow => ({
    id: r.id, decidedBy: r.decidedBy, draftTitle: r.draftTitle, draftBody: r.draftBody,
    gateVerdict: r.gateVerdict, gateResults: r.gateResults, editDiff: r.editDiff,
    declineReason: r.declineReason, rawSourceSite: r.rawContent.sourceSite,
    rawSourceArticleId: r.rawContent.sourceArticleId, sourceCapturedAt: r.rawContent.sourceCapturedAt,
  })

  /** ── ② 사람이 결정한 기계 후보 ── */
  const humanRows = (await prisma.originalPostApprovalQueue.findMany({
    where: { decidedBy: HUMAN_DECIDER }, select,
  })).filter((r) => profileOf({
    promptVersion: r.promptVersion, model: r.model, sourceSite: r.rawContent.sourceSite,
    gateResults: r.gateResults,
  } as never) === 'machine')
  const results = humanRows.map((r) => restoreRow(toDecided(r), idx.artifacts, idx.candidates))
  console.log(`② 사람(founder)이 결정한 기계 후보 ${humanRows.length}건 → 복원 분류`)
  for (const k of RESTORE_CLASSES) {
    const n = results.filter((x) => x.klass === k).length
    console.log(`   ${k.padEnd(20)} ${String(n).padStart(3)}`)
  }
  const reasonTally = new Map<string, number>()
  for (const x of results) if (x.klass !== 'clean') {
    const key = `${x.klass}: ${(x.reasons[0] ?? '').replace(/[0-9a-f]{32}/g, '<id>').replace(/ — .*/, '')}`
    reasonTally.set(key, (reasonTally.get(key) ?? 0) + 1)
  }
  if (reasonTally.size > 0) {
    console.log('   사유(첫 줄 기준)')
    for (const [k, v] of [...reasonTally].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`)
  }

  /** ── ③ 표본 — clean 만 ── */
  const cleanIds = new Set(results.filter((x) => x.klass === 'clean').map((x) => x.id))
  const sample = cohortSampleOf(humanRows.filter((r) => cleanIds.has(r.id)).map(toDecided))
  console.log('\n③ 증거 표본 (clean 복원만 · 계약을 낮추지 않는다)')
  console.log(`   적격 ${sample.eligible}/${CONTRACT.reviewSampleMin} · 무수정 ${sample.noEdit} · 수정 ${sample.edited} · 폐기 ${sample.declined}`)
  console.log(`   무수정률 ${sample.noEditRate === null ? '측정 불가(표본 0)' : `${(sample.noEditRate * 100).toFixed(1)}%`}`
    + ` · 중대 결함 ${sample.hardDefects === null ? `unmeasured(${sample.hardDefectUnmeasured}건)` : sample.hardDefects}`)
  console.log(`   계약 충족 ${sample.meetsContract ? '🟢 예' : '🔴 아니오'}${sample.reasons.length > 0 ? ` — ${sample.reasons.join(' · ')}` : ''}`)

  /** ── 현재 그림자 후보 ── */
  const stock = await loadPublishableStock(prisma, NOW)
  const reviewIds = stock.rejected.filter((r) => r.code === 'HUMAN_REVIEW_REQUIRED').map((r) => r.id)
  const shadowAll = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: reviewIds } }, select })
  const shadow = shadowAll.filter((r) => eligibilityOf({
    gateVerdict: r.gateVerdict, gateResults: r.gateResults,
    title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
    sourceCapturedAt: r.rawContent.sourceCapturedAt,
  }).auto)
  const shadowRes = shadow.map((r) => restoreRow(toDecided(r), idx.artifacts, idx.candidates))
  console.log(`\n④ 현재 그림자 자동 대상 ${shadow.length}건 — artifact 복원: `
    + RESTORE_CLASSES.map((k) => `${k} ${shadowRes.filter((x) => x.klass === k).length}`).join(' · '))

  /** ── ⑤ Codex 마스터 검토 묶음 (저장소 밖) ── */
  const entry = (
    group: 'pastHumanDecision' | 'currentShadow',
    r: (typeof humanRows)[number], res: RestoreResult,
  ) => {
    const a = res.artifactFile === null ? null : idx.raw.get(`${res.artifactFile}#${S(rec(rec(r.gateResults).autoDraft).artifactId)}`) ?? null
    return {
      group, queueId: r.id, restore: { klass: res.klass, reasons: res.reasons, artifactFile: res.artifactFile },
      decidedBy: r.decidedBy, status: r.status, published: r.createdPostId !== null,
      humanOutcome: group === 'pastHumanDecision' ? outcomeOf(r) : null,
      hardDefect: group === 'pastHumanDecision' ? hardDefectOf(r.editDiff) : null,
      source: {
        site: r.rawContent.sourceSite, articleId: r.rawContent.sourceArticleId,
        capturedAt: r.rawContent.sourceCapturedAt, title: r.rawContent.rawTitle, body: r.rawContent.rawBody,
      },
      draft: { title: r.draftTitle, body: r.draftBody, titleDigest: digestOf(r.draftTitle), bodyDigest: digestOf(r.draftBody) },
      edited: r.editedTitle !== null || r.editedBody !== null
        ? { title: r.editedTitle, body: r.editedBody, editDiff: r.editDiff } : null,
      persona: { matched: r.matchedPersona?.code ?? null, voice: rec(rec(rec(r.gateResults).autoDraft).voice).personaCode ?? null },
      semantic: {
        stored: rec(r.gateResults).semanticReview ?? null,
        restoredFromArtifact: a === null ? null : semanticSummaryOf(a.review),
      },
      warnings: eligibilityOf({
        gateVerdict: r.gateVerdict,
        gateResults: a === null ? r.gateResults : { ...rec(r.gateResults), semanticReview: semanticSummaryOf(a.review) },
        title: r.draftTitle, body: r.draftBody, sourceCapturedAt: r.rawContent.sourceCapturedAt,
      }).reasons,
    }
  }
  const bundle = {
    kind: 'auto-ready-v2 Codex master review bundle',
    note: '🔴 창업자 개별 승인 요청이 아니다. 복원 근거와 그림자 판정을 한 번에 검토하는 묶음이다.',
    generatedAt: NOW.toISOString(),
    contract: CONTRACT,
    evidenceDir: 'microseed-data (정본 위치)',
    sample,
    classes: Object.fromEntries(RESTORE_CLASSES.map((k) => [k, results.filter((x) => x.klass === k).length])),
    items: [
      ...humanRows.map((r, i) => entry('pastHumanDecision', r, results[i]!)),
      ...shadow.map((r, i) => entry('currentShadow', r, shadowRes[i]!)),
    ],
  }
  const stamp = NOW.toISOString().replace(/[:.]/g, '-')
  const outDir = join(OUT_ROOT, stamp)
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'bundle.json')
  const text = JSON.stringify(bundle, null, 2)
  writeFileSync(outFile, text)
  console.log(`\n⑤ Codex 마스터 검토 묶음 — 과거 ${humanRows.length}건 + 그림자 ${shadow.length}건`)
  console.log(`   ${outFile.replace(homedir(), '~')}`)
  console.log(`   sha256 ${digestOf(text).slice(0, 16)} · ${(text.length / 1024).toFixed(1)}KB · 🔴 저장소 밖 (원문 포함 · git 에 넣지 않는다)`)

  console.log('\n🔴 DB write 0 · 과거 decidedBy 수정 0 · 유료 호출 0\n')
  await prisma.$disconnect()
}

await main()
