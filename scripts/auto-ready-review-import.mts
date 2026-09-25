#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 — 배치 검토 기록 importer** (2026-09-25) · 🔴 기본 dry-run · DB write 0
 *
 *   `auto-ready:review-bundle` 이 만든 묶음과, 검토자가 채운 응답 파일을 받아 행마다
 *   `editDiff.evidenceReviews` 에 **검토자 출처와 함께** 판정을 남긴다.
 *
 * 🔴 검토자 종류는 닫힌 목록과 정확히 같아야 한다 — 모르는 문자열이면 파일 전체를 거절한다.
 * 🔴 Codex·모델 기록은 남지만 사람 정답 표본이 아니다(`humanSampleOf`).
 * 🔴 `hardDefect` 를 비우면 `unmeasured` 로 남는다 — `no` 로 읽지 않는다.
 * 🔴 묶음 digest · 초안 digest(묶음과 지금 DB 둘 다)가 맞아야 한다. 같은 검토자의 다른 기록은 덮지 않는다.
 * 🔴 바꾸는 칸은 `editDiff` 하나(`@updatedAt` 함께). CAS — 계획 뒤 바뀐 행은 0건. 다시 돌리면 `unchanged`.
 *
 *   npm run auto-ready:review-import -- --bundle=<bundle.json> --review=<채운 응답.json>           # dry-run
 *   npm run auto-ready:review-import -- --bundle=… --review=… --apply                              # 🔴 쓰기
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

import { planReviewImport, applyReviewImport, type BundleItem, type ReviewFile } from '../src/lib/auto-ready-evidence-store'
import { digestOf } from '../src/lib/auto-ready-evidence'
import { evidenceFromDb } from '../src/lib/auto-ready-repo'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const BUNDLE = argv.find((a) => a.startsWith('--bundle='))?.slice(9) ?? ''
const REVIEW = argv.find((a) => a.startsWith('--review='))?.slice(9) ?? ''
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

async function main(): Promise<void> {
  if (BUNDLE === '' || REVIEW === '') fail('--bundle= 과 --review= 가 둘 다 필요하다')
  const bundleText = readFileSync(BUNDLE, 'utf8')
  const bundleJson = JSON.parse(bundleText) as { items?: { queueId: string; draft: { titleDigest: string; bodyDigest: string } }[] }
  const bundleItems: BundleItem[] = (bundleJson.items ?? []).map((i) => ({
    queueId: i.queueId, draftTitleDigest: i.draft.titleDigest, draftBodyDigest: i.draft.bodyDigest,
  }))
  const review = JSON.parse(readFileSync(REVIEW, 'utf8')) as ReviewFile
  const prisma = new PrismaClient()
  console.log(APPLY ? '\n══ 🔴 배치 검토 기록 (--apply) ══\n' : '\n══ 배치 검토 기록 (dry-run · DB write 0) ══\n')
  const before = await evidenceFromDb(prisma)
  const plan = await planReviewImport(prisma, review, { digest: digestOf(bundleText), items: bundleItems })
  if (!plan.ok) { await prisma.$disconnect(); return fail(`파일 거절 — ${plan.why} · DB write 0`) }
  console.log(`   검토자 ${plan.reviewer} · 줄 ${plan.items.length}`)
  for (const k of ['write', 'unchanged', 'reject'] as const) console.log(`   ${k.padEnd(10)} ${plan.items.filter((i) => i.action === k).length}`)
  const hd = (v: string) => plan.items.filter((i) => i.action !== 'reject' && i.entry?.hardDefect === v).length
  console.log(`   hardDefect yes ${hd('yes')} · no ${hd('no')} · unmeasured ${hd('unmeasured')}`)
  for (const i of plan.items) {
    console.log(`   ${i.queueId}  ${i.action.padEnd(9)} ${i.action === 'write' ? 'editDiff{evidenceReviews} + updatedAt' : i.why}`)
  }
  let written = 0
  let lost = 0
  if (APPLY) {
    for (const i of plan.items.filter((x) => x.action === 'write')) {
      if (await applyReviewImport(prisma, i) === 1) written += 1
      else { lost += 1; console.log(`   🔴 ${i.queueId} — 계획 뒤 행이 바뀌었다(CAS 0) · 쓰지 않았다`) }
    }
  }
  const after = await evidenceFromDb(prisma)
  console.log(`\n   쓰기 ${written} · CAS 실패 ${lost}${APPLY ? '' : ' · 🟡 dry-run — 쓰지 않았다'}`)
  console.log(`   runtime evidence ${before.eligible}/30 → ${after.eligible}/30 · 중대 결함 ${after.hardDefects === null ? `unmeasured(${after.hardDefectUnmeasured})` : after.hardDefects}`)
  console.log('\n🔴 decidedBy·status·createdPostId·Post·Persona 쓰기 0 · 유료 호출 0\n')
  await prisma.$disconnect()
}

await main()
