#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 — 배치 검토 묶음 생성** (2026-09-25) · DB read-only · 🔴 저장소 밖에만 쓴다
 *
 *   창업자에게 글마다 묻지 않는다. **한 번에 볼 묶음** 하나와 **응답 양식** 하나를 만든다.
 *   묶음에는 원문 · 초안 · Persona 정본 · 의미 검수(저장값 · artifact 복원값) · holds/blocks ·
 *   수정 전후 · 결정 결과(무수정/수정/폐기)가 행마다 들어간다.
 *
 *   응답 양식(`review-template.json`)은 검토자가 채운다:
 *     · `reviewer`  — 🔴 비어 있다. `review-provenance` 목록 중 하나를 **직접** 적는다
 *                      (human:founder · human:operator · codex:master-review · model:semantic-audit)
 *     · 행마다 `hardDefect` — 🔴 비어 있다(null). 비워 두면 `unmeasured` 로 기록된다(no 가 아니다)
 *     · `hardDefect: "yes"` 면 `reasons` 에 근거를 적는다
 *   채운 파일은 `auto-ready:review-import` 가 출처와 함께 기록한다.
 *
 * 🔴 원문이 들어가므로 git 에 넣지 않는다. DB write 0 · 모델 호출 0.
 *
 *   npm run auto-ready:review-bundle
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

import { restoreRow, legacyOutcomeOf, stateOutcomeOf, humanSampleOf, digestOf, EVIDENCE_REVIEW_CONTRACT } from '../src/lib/auto-ready-evidence'
import { readReviewArtifact, sourceEvidenceOf } from '../src/lib/original-post-machine-review'
import { decidedRowOf, type BundleItem } from '../src/lib/auto-ready-evidence-store'
import { HUMAN_DECIDER, CONTRACT } from '../src/lib/auto-ready-v2'
import { describeCohort } from '../src/lib/auto-ready-quality-cohort'
import { selectBundleRows, type BundleRow, type CohortSlot } from './lib/auto-ready-bundle-select.mjs'
import { semanticSummaryOf } from '../src/lib/micro-seed-supply-autofill'
import { NON_HUMAN_IMPORTABLE } from '../src/lib/review-provenance'
import { loadArtifactIndex, DEFAULT_ARTIFACT_DIR } from './lib/microseed-artifacts.mjs'

const argv = process.argv.slice(2)
const DIR = argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? DEFAULT_ARTIFACT_DIR
const OUT_ROOT = argv.find((a) => a.startsWith('--out='))?.slice(6)
  ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'auto-ready-review')
const NOW = new Date()
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  const idx = loadArtifactIndex(DIR)
  /**
   * 🔴 **고르는 규칙은 한 함수다**(`selectBundleRows`) — 격리 DB 검사가 같은 함수를 부른다.
   *    ① 지금 품질 계약 창(생성 순서 · 첫 차단 표시) ② legacy 결정 행 ③ legacy 그림자
   */
  const { cohort, window, decided, shadow } = await selectBundleRows(prisma, NOW)
  type Row = BundleRow

  const entry = (group: 'cohortWindow' | 'decided' | 'undecidedShadow', r: Row, cohortSlot: CohortSlot | null = null) => {
    const humanDecided = (r.decidedBy ?? '').trim() === HUMAN_DECIDER
    const res = restoreRow(decidedRowOf(r), idx.artifacts, idx.candidates)
    const artifactId = String(rec(rec(r.gateResults).autoDraft).artifactId ?? '')
    const a = res.artifactFile === null ? null : idx.raw.get(`${res.artifactFile}#${artifactId}`) ?? null
    const g = rec(r.gateResults)
    return {
      group, queueId: r.id,
      /** 🔴 지금 품질 계약 창의 자리 — 첫 차단 행이면 이 행부터 봐야 열림이 풀린다 */
      cohort: cohortSlot,
      decision: {
        decidedBy: r.decidedBy, status: r.status, published: r.createdPostId !== null,
        // 🔴 지금 행 상태의 결과 — 사람 기록은 이 값을 결속한다. legacy 표식은 참고로만 보인다
        outcome: humanDecided ? stateOutcomeOf(r) : null,
        legacyOutcome: humanDecided ? legacyOutcomeOf(r) : null,
        humanSampleNow: humanSampleOf(r),
      },
      /**
       * 🔴 원문 근거는 artifact 의 마스킹된 근거다 — DB `rawContent` 는 기계 후보에서 AI 초안의 사본이다
       *    (`publish:machine-review` 와 같은 이유). DB 값은 참고로만 남긴다.
       */
      artifactSource: (() => { const ra = a === null ? null : readReviewArtifact(a); return ra === null ? null : sourceEvidenceOf(ra) })(),
      source: { site: r.rawContent.sourceSite, articleId: r.rawContent.sourceArticleId, dbRawTitle: r.rawContent.rawTitle, dbRawBody: r.rawContent.rawBody },
      draft: { title: r.draftTitle, body: r.draftBody, titleDigest: digestOf(r.draftTitle), bodyDigest: digestOf(r.draftBody) },
      edit: r.editedTitle !== null || r.editedBody !== null
        ? { before: { title: r.draftTitle, body: r.draftBody }, after: { title: r.editedTitle, body: r.editedBody }, editDiff: r.editDiff } : null,
      persona: r.matchedPersona === null ? null : { code: r.matchedPersona.code, status: r.matchedPersona.status, identity: r.matchedPersona.identity },
      voice: rec(rec(g.autoDraft).voice),
      semantic: { stored: g.semanticReview ?? null, restoredFromArtifact: a === null ? null : semanticSummaryOf(a.review) },
      holds: g.holds ?? [], blocks: g.blocks ?? [],
      restore: { klass: res.klass, reasons: res.reasons, artifactFile: res.artifactFile },
      /** 🔴 검토자가 채우는 칸은 응답 양식에 있다 — 여기서 미리 채우지 않는다 */
      toFill: { hardDefect: 'yes | no (비우면 unmeasured)', reasons: 'yes 면 근거 필수' },
    }
  }
  const items = [
    ...window.map((w) => entry('cohortWindow', w.row, w.slot)),
    ...decided.map((r) => entry('decided', r)), ...shadow.map((r) => entry('undecidedShadow', r)),
  ]
  const bundle = {
    kind: 'auto-ready evidence batch review bundle',
    contract: EVIDENCE_REVIEW_CONTRACT,
    note: '🔴 글마다 승인을 묻지 않는다. 이 묶음 전체를 한 번 보고 review-template.json 을 채운다.',
    generatedAt: NOW.toISOString(),
    gate: CONTRACT,
    rule: [
      '사람 정답 표본은 관리자 화면(/admin/auto-ready-evidence)에 이 묶음을 올려 로그인 세션으로 기록한 것만 센다',
      'review-template.json(CLI importer)은 codex:master-review · model:semantic-audit 기록만 만든다 — 표본이 아니다',
      '결과(무수정/수정/폐기)는 기록 시점의 행 상태로 결속된다 — 이후 수정본·폐기가 바뀌면 표본에서 빠진다',
      'hardDefect 를 비우면 unmeasured — 게이트는 닫힌 채다',
      'undecidedShadow 행은 결정(approve/edit/decline)이 따로 기록되기 전에는 표본이 아니다',
      'cohortWindow 는 지금 품질 계약의 첫 30건이다(생성 순서) — 앞의 행이 미검토면 뒤의 좋은 행으로 열리지 않는다. firstBlocking 행부터 본다',
      'decided · undecidedShadow 는 옛 계약(legacy) 행이다 — 감사·운영 재고에는 남지만 열림 판정 표본이 아니다',
    ],
    counts: { cohortWindow: window.length, decided: decided.length, undecidedShadow: shadow.length },
    /** 🔴 열림 판정 — 지금 품질 계약 cohort(첫 30건 · 생성 순서 · 선행 미검토면 닫힘) */
    cohort: { summary: describeCohort(cohort), meetsContract: cohort.meetsContract, reasons: cohort.reasons, firstBlocking: cohort.firstBlocking },
    items,
  }
  const text = JSON.stringify(bundle, null, 2)
  const bundleDigest = digestOf(text)
  const template = {
    contract: EVIDENCE_REVIEW_CONTRACT,
    reviewer: '',
    /** 🔴 이 양식은 비사람 기록 전용이다. 사람 검토는 관리자 화면에서 이 묶음을 올려 기록한다 */
    reviewerChoices: NON_HUMAN_IMPORTABLE,
    bundleDigest,
    items: items.map((it): BundleItem & { hardDefect: null; reasons: string[] } => ({
      queueId: it.queueId, draftTitleDigest: it.draft.titleDigest, draftBodyDigest: it.draft.bodyDigest, hardDefect: null, reasons: [],
    })),
  }
  const outDir = join(OUT_ROOT, NOW.toISOString().replace(/[:.]/g, '-'))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'bundle.json'), text)
  writeFileSync(join(outDir, 'review-template.json'), JSON.stringify(template, null, 2))
  console.log('\n══ 자동 READY 증거 — 배치 검토 묶음 (DB read-only · 저장소 밖) ══')
  console.log(`   품질 계약 창 ${window.length}건 · legacy 결정 ${decided.length}건 · legacy 그림자 ${shadow.length}건 · 합계 ${items.length}건`)
  console.log(`   ${describeCohort(cohort)}`)
  console.log(`   복원 분류(결정된 행) ${JSON.stringify(Object.fromEntries(['clean', 'warning', 'missing', 'ambiguous', 'draftMismatch', 'provenanceMismatch']
    .map((k) => [k, items.filter((i) => i.group === 'decided' && i.restore.klass === k).length])))}`)
  console.log(`   ${join(outDir, 'bundle.json').replace(homedir(), '~')}`)
  console.log(`   ${join(outDir, 'review-template.json').replace(homedir(), '~')}`)
  console.log(`   bundleDigest ${bundleDigest.slice(0, 16)}… · ${(text.length / 1024).toFixed(1)}KB · 🔴 원문 포함 — git 에 넣지 않는다`)
  console.log('\n🔴 DB write 0 · 유료 호출 0\n')
  await prisma.$disconnect()
}

await main()
