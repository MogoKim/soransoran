#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 — 의미 검수 복원** (2026-09-25) · 🔴 기본 dry-run · DB write 0
 *
 *   사람 결정 표식이 있는 기계 후보 중, artifact 정본과 **정확히 한 장**으로 맞고 출처·Persona·
 *   초안이 모두 같은(`clean`) 행에만, 비어 있는 `gateResults.semanticReview` 를 artifact 의
 *   **기존 판정**으로 채운다. 새로 판정하지 않는다. 모델을 부르지 않는다.
 *
 * 🔴 바꾸는 칸은 `gateResults` 하나다(`@updatedAt` 은 함께 바뀐다).
 *    `decidedBy` · `status` · `createdPostId` · Post · Persona 배정은 쓰지 않는다.
 * 🔴 `--apply` 가 없으면 DB write 0. 있어도 행마다 CAS(updatedAt · 초안 · 결정 칸) — 그 사이
 *    바뀐 행은 0건. 다시 돌리면 이미 복원된 행은 `unchanged` 다.
 * 🔴 복원은 **사람 정답 표본을 만들지 않는다.** 표본이 되려면 사람 검토 기록이 따로 있어야 한다
 *    (`auto-ready:review-bundle` → `auto-ready:review-import`).
 *
 *   npm run auto-ready:evidence-restore                 # dry-run
 *   npm run auto-ready:evidence-restore -- --apply      # 🔴 쓰기 (운영에는 승인 전 금지)
 */
import { PrismaClient } from '@prisma/client'

import { planSemanticRestore, applySemanticRestore } from '../src/lib/auto-ready-evidence-store'
import { RESTORE_CLASSES } from '../src/lib/auto-ready-evidence'
import { evidenceFromDb, legacyEvidenceFromDb } from '../src/lib/auto-ready-repo'
import { describeCohort } from '../src/lib/auto-ready-quality-cohort'
import { loadArtifactIndex, DEFAULT_ARTIFACT_DIR } from './lib/microseed-artifacts.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const DIR = argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? DEFAULT_ARTIFACT_DIR
const NOW = new Date()

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log(APPLY ? '\n══ 🔴 의미 검수 복원 (--apply) ══\n' : '\n══ 의미 검수 복원 (dry-run · DB write 0) ══\n')
  const idx = loadArtifactIndex(DIR)
  console.log(`   artifact 파일 ${idx.files.artifacts} · candidates 파일 ${idx.files.candidates} · artifactId ${idx.artifacts.size}종`)
  // 🔴 복원은 legacy(품질 계약 표식 없는) 행만 쓴다 — 지금 계약 cohort 는 복원 대상이 아니다
  const before = await legacyEvidenceFromDb(prisma)
  const plan = await planSemanticRestore(prisma, idx.artifacts, idx.candidates, NOW)
  console.log(`\n① 사람 결정 표식 · 기계 profile 행 ${plan.length}건`)
  for (const k of RESTORE_CLASSES) console.log(`   ${k.padEnd(20)} ${plan.filter((p) => p.klass === k).length}`)
  console.log(`   → 쓰기 ${plan.filter((p) => p.action === 'write').length} · 이미 복원 ${plan.filter((p) => p.action === 'unchanged').length}`
    + ` · 건너뜀 ${plan.filter((p) => p.action === 'skip').length}`)
  console.log('\n② 행별')
  for (const p of plan) {
    const ch = p.changes === null ? '-' : `${p.changes.column}{${p.changes.keys.join(',')}} + updatedAt`
    console.log(`   ${p.id}  ${p.klass.padEnd(18)} ${p.action.padEnd(9)} ${ch}${p.action === 'skip' ? `  — ${(p.reasons[0] ?? '').slice(0, 80)}` : ''}`)
  }
  let written = 0
  let lost = 0
  if (APPLY) {
    for (const p of plan.filter((x) => x.action === 'write')) {
      const n = await applySemanticRestore(prisma, p)
      if (n === 1) written += 1
      else { lost += 1; console.log(`   🔴 ${p.id} — 계획 뒤 행이 바뀌었다(CAS 0) · 쓰지 않았다`) }
    }
  }
  const clean = plan.filter((p) => p.klass === 'clean')
  const humanClean = clean.filter((p) => p.human.counted)
  console.log(`\n③-0 적용 시 예상 — 복원으로 적격이 되는 행 ${clean.length}건 · 그중 사람 정답 표본 ${humanClean.length}건`)
  console.log(`   사람 표본이 아닌 이유 ${JSON.stringify(Object.fromEntries(['notHumanDecision', 'noReview', 'nonHumanOnly', 'bindingBroken']
    .map((w) => [w, clean.filter((p) => !p.human.counted && p.human.why === w).length])))}`)
  const after = await legacyEvidenceFromDb(prisma)
  console.log(`\n③ 쓰기 ${written}건 · CAS 실패 ${lost}건${APPLY ? '' : ' · 🟡 dry-run — 쓰지 않았다'}`)
  console.log(`   legacy 증거(판정 밖 · 감사 이력) 전 ${before.eligible} → 후 ${after.eligible}`
    + ` (사람 검토 기록이 없으면 복원해도 표본이 아니다 — 제외 ${JSON.stringify(after.excluded)})`)
  console.log(`   🔴 열림 판정(지금 품질 계약 cohort) — ${describeCohort(await evidenceFromDb(prisma))}`)
  console.log('\n🔴 유료 호출 0 · decidedBy·status·createdPostId·Post·Persona 쓰기 0\n')
  await prisma.$disconnect()
}

await main()
