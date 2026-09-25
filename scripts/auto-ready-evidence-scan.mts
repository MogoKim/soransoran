#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 복원 scan — read-only** (2026-09-25)
 *
 * 🔴 DB write 0 · 파일 write 0 · LLM 0 · 발행 0.
 *
 *   사람 결정 표식이 있는 기계 후보를 artifact 정본과 대조해 여섯 갈래로 나누고,
 *   복원한다면 표본이 몇이 되는지를 **사람 검토 기록 기준으로** 보인다.
 *   🔴 검토 묶음은 여기서 만들지 않는다 — `auto-ready:review-bundle` 하나가 만든다.
 *   🔴 복원 쓰기는 `auto-ready:evidence-restore` 하나가 한다(같은 계획 함수).
 */
import { PrismaClient } from '@prisma/client'

import { RESTORE_CLASSES, cohortSampleOf } from '../src/lib/auto-ready-evidence'
import { planSemanticRestore, EVIDENCE_ROW_SELECT, decidedRowOf } from '../src/lib/auto-ready-evidence-store'
import { CONTRACT } from '../src/lib/auto-ready-v2'
import { evidenceFromDb } from '../src/lib/auto-ready-repo'
import { loadArtifactIndex, DEFAULT_ARTIFACT_DIR } from './lib/microseed-artifacts.mjs'

const argv = process.argv.slice(2)
const DIR = argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? DEFAULT_ARTIFACT_DIR

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY 증거 복원 scan (read-only · DB write 0) ══')
  const idx = loadArtifactIndex(DIR)
  console.log(`   artifact 파일 ${idx.files.artifacts}개 · candidates 파일 ${idx.files.candidates}개`
    + ` · artifactId ${idx.artifacts.size}종 · 중복 ${[...idx.artifacts.values()].filter((v) => v.length > 1).length}종\n`)
  const plan = await planSemanticRestore(prisma, idx.artifacts, idx.candidates, new Date())
  console.log(`② 사람 결정 표식이 있는 기계 후보 ${plan.length}건 → 복원 분류`)
  for (const k of RESTORE_CLASSES) console.log(`   ${k.padEnd(20)} ${String(plan.filter((p) => p.klass === k).length).padStart(3)}`)
  const cleanIds = new Set(plan.filter((p) => p.klass === 'clean').map((p) => p.id))
  const rows = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: [...cleanIds] } }, select: EVIDENCE_ROW_SELECT })
  const sample = cohortSampleOf(rows.map(decidedRowOf))
  console.log('\n③ 복원한다면 — clean 행 중 사람 정답 표본 (계약을 낮추지 않는다)')
  console.log(`   적격 ${sample.eligible}/${CONTRACT.reviewSampleMin} · 무수정 ${sample.noEdit} · 수정 ${sample.edited} · 폐기 ${sample.declined}`
    + ` · 중대 결함 ${sample.hardDefects === null ? `unmeasured(${sample.hardDefectUnmeasured})` : sample.hardDefects}`)
  console.log(`   표본에서 뺀 행 ${JSON.stringify(sample.excluded)}`)
  const now = await evidenceFromDb(prisma)
  console.log(`\n④ 지금 runtime evidence ${now.eligible}/${CONTRACT.reviewSampleMin} · 계약 충족 ${now.meetsContract ? '예' : '아니오'}`)
  console.log('\n🔴 DB write 0 · 유료 호출 0\n')
  await prisma.$disconnect()
}

await main()
