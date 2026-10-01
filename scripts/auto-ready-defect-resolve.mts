#!/usr/bin/env tsx
/**
 * 🔴 **확정 결함 해소 — 재검증 후 기록** (2026-10-01 · Lane E)
 *
 *   npm run auto-ready:defect-resolve -- --queue=<queueId>            계획만(dry-run · 기본 · write 0)
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply    격리 DB 에서만 기록(그대로)
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply --production --target=<40자리 SHA> \
 *     --digest=<dry-run digest> --expect=<지금>:<적용 뒤> --reason="…"     🔴 운영(Phase G) — 배포된 SHA 에서만
 *
 * 🔴 플래그 없는 `--apply` 는 격리 DB(sentinel · localhost · soran_test)에서만 돈다. 운영은 `production-activation-guard`
 *    (플래그 셋 · 다섯 SHA = target · runtime 깨끗 · writer job 0 · canonical env)와 승인(digest · expect · reason)을 모두 지나야 열린다.
 *    거부는 DB 에 붙기 전에 끝난다(write 0).
 * 🔴 출력은 코드·id·hash 뿐이다 — 초안 · 원문 글자를 찍지 않는다. DB 주소를 찍지 않는다.
 * 🔴 감사 행에는 어떤 쓰기도 하지 않는다(정본 `applyDefectResolution`).
 */
import { PrismaClient } from '@prisma/client'

import { applyDefectResolution, planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { applyApprovedDefectResolution, defectPlanDigestOf, expectationOf } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import { openActivation } from './lib/production-activation.mjs'

const argv = process.argv.slice(2)
const queueId = (argv.find((a) => a.startsWith('--queue=')) ?? '').slice('--queue='.length).trim()
const apply = argv.includes('--apply')

function isolatedDbProblems(): string[] {
  const url = process.env.DATABASE_URL ?? ''
  const p: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') p.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) p.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(url)) p.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  return p
}

async function main(): Promise<number> {
  if (queueId === '') { console.error('🔴 --queue=<queueId> 가 필요하다'); return 2 }
  const act = openActivation(argv, { repoRoot: process.cwd() })
  if (act.kind === 'refuse') {
    console.error('🔴 열지 않는다(write 0)')
    for (const p of act.problems) console.error(`   · ${p}`)
    return 2
  }
  // 🔴 dry-run 은 canonical env 의 DB 주소를 기존 helper 로 채운다(찍지 않는다) — 쓰지 않는다
  if (act.kind === 'dry-run' && !fillDbConnection()) { console.error('🔴 DB 주소가 없다'); return 2 }
  if (act.kind === 'production') {
    const prisma = new PrismaClient()
    try {
      const a = await applyApprovedDefectResolution(prisma, {
        queueId, approval: act.approval, contextOf: makeReverifyContextLoader(), now: new Date(),
      })
      console.log(`RESOLVE_APPLY production@${act.target.slice(0, 12)} ${a.kind} written=${a.written}${'reason' in a ? ` · ${a.reason}` : ''} · reason="${act.approval.reason}"`)
      return a.kind === 'written' || a.kind === 'noop' ? 0 : 1
    } finally {
      await prisma.$disconnect()
    }
  }
  if (apply) {
    const bad = isolatedDbProblems()
    if (bad.length > 0) {
      console.error('🔴 --apply 는 이번 단계에서 격리 DB 에서만 돈다 — 운영 적용은 범위 밖이다. 멈춘다(write 0).')
      for (const b of bad) console.error(`   · ${b}`)
      return 2
    }
  }
  const prisma = new PrismaClient()
  try {
    const contextOf = makeReverifyContextLoader()
    const now = new Date()
    const e = await planDefectResolution(prisma, { queueId, contextOf, now })
    if (e.kind === 'refuse') { console.log(`RESOLVE_PLAN refuse code=${e.code} · ${e.reason}`); return 1 }
    if (e.kind === 'already') { console.log(`RESOLVE_PLAN already · ${e.reason}`); return 0 }
    const r = e.plan.record
    console.log(`RESOLVE_PLAN plan queue=${e.plan.queueId} post=${e.plan.postId} contract=${r.qualityContract.version}/${r.qualityContract.digest.slice(0, 16)}`
      + ` audit=${e.plan.auditFingerprint.slice(0, 16)} gate=${r.reverify.gateVersion} blocked=${r.reverify.failureCodes.join(',')}`
      + ` review=${r.reverify.reviewCodes.join(',') || '-'} input=${r.reverify.inputDigest.slice(0, 16)}`)
    if (!apply) {
      // 🔴 운영 승인에 넣을 값 — 결정적 계획 지문 · 기대 상태(미해소 결함 수 지금:적용 뒤)
      const ex = await expectationOf(prisma, e.plan)
      console.log(`RESOLVE_APPROVAL digest=${defectPlanDigestOf(e.plan)} expect=${ex.before}:${ex.after}`)
      console.log('RESOLVE_APPLY skipped (dry-run) written=0')
      return 0
    }
    const a = await applyDefectResolution(prisma, { plan: e.plan, contextOf, now: new Date() })
    console.log(`RESOLVE_APPLY ${a.kind} written=${a.written}${a.kind === 'written' ? '' : ` · ${'reason' in a ? a.reason : ''}`}`)
    return a.kind === 'written' || a.kind === 'already' ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

main().then((c) => process.exit(c), (e: unknown) => { console.error(`🔴 ${(e as Error).name}`); process.exit(1) })
