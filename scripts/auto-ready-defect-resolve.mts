#!/usr/bin/env tsx
/**
 * 🔴 **확정 결함 해소 — 재검증 후 기록** (2026-10-01 · Lane E)
 *
 *   npm run auto-ready:defect-resolve -- --queue=<queueId>            계획만(dry-run · 기본 · write 0)
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply    격리 DB 에서만 기록(그대로)
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply --production --target=<40자리 SHA> \
 *     --digest=<dry-run digest> --expect=<지금>:<적용 뒤> --reason="…"     🔴 운영(Phase G) — 배포된 SHA 에서만
 *
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply --production --staged --target=<40자리 SHA> \
 *     --digest=<dry-run digest> --expect=<지금>:<적용 뒤> --reason="…"     🔴 품질 계약 전환 — target 을 준비한
 *     **staging 트리**에서, 옛 runtime·job 을 그대로 둔 채 새 계약의 해소 기록을 활성화 **전에** 덧붙인다
 *   의미 재감사(`--semantic-clear`) 운영 적용은 dry-run이 낸 `--semantic-plan=<token>`도 필수다. provider는
 *   dry-run에서 정확히 한 번만 부르고, apply는 같은 계획의 DB·원문·글·Persona 결속만 결정적으로 재검사한다.
 *
 * 🔴 플래그 없는 `--apply` 는 격리 DB(sentinel · localhost · soran_test)에서만 돈다. 운영은 `production-activation-guard`
 *    (플래그 셋 · 다섯 SHA = target · runtime 깨끗 · writer job 0 · canonical env)와 승인(digest · expect · reason)을 모두 지나야 열린다.
 *    거부는 DB 에 붙기 전에 끝난다(write 0).
 * 🔴 출력은 코드·id·hash 뿐이다 — 초안 · 원문 글자를 찍지 않는다. DB 주소를 찍지 않는다.
 * 🔴 감사 행에는 어떤 쓰기도 하지 않는다(정본 `applyDefectResolution`).
 */
import { PrismaClient } from '@prisma/client'

import {
  applyDefectResolution, applySemanticDefectResolution, planDefectResolution, planSemanticDefectResolution,
} from '../src/lib/auto-ready-defect-resolution-store'
import {
  applyApprovedDefectResolution, applyApprovedSemanticDefectResolution, defectPlanDigestOf, expectationOf,
  semanticPlanFromToken, semanticPlanTokenOf,
} from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { makeAuditContextLoader } from './lib/auto-ready-audit-context.mjs'
import { semanticProviderFromEnv } from './lib/auto-ready-semantic-provider.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import { openActivation } from './lib/production-activation.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const queueId = (argv.find((a) => a.startsWith('--queue=')) ?? '').slice('--queue='.length).trim()
const apply = argv.includes('--apply')
const semanticClear = argv.includes('--semantic-clear')
const argOf = (key: string): string => (argv.find((a) => a.startsWith(`${key}=`)) ?? '').slice(key.length + 1).trim()

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
  const productionSemanticApply = semanticClear && apply && argv.includes('--production')
  const semanticPlan = productionSemanticApply ? semanticPlanFromToken(argOf('--semantic-plan')) : null
  if (semanticPlan !== null && !semanticPlan.ok) {
    console.error(`🔴 --semantic-plan 이 유효하지 않다(write 0) · ${semanticPlan.reason}`)
    return 2
  }
  if (semanticClear) await loadEnvLocal()
  // 🔴 품질 계약 전환은 활성화 전에 새 계약 기록을 써야 한다 — 이 CLI 만 `--staged` 를 받는다
  const act = openActivation(argv, { repoRoot: process.cwd(), allowStaged: true })
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
      const a = semanticClear
        ? await applyApprovedSemanticDefectResolution(prisma, {
          queueId, approval: act.approval, loadContext: makeAuditContextLoader(prisma, { freshEachCall: true }),
          plan: semanticPlan!.plan, now: new Date(),
        })
        : await applyApprovedDefectResolution(prisma, {
          queueId, approval: act.approval, contextOf: makeReverifyContextLoader(), now: new Date(),
        })
      console.log(`RESOLVE_APPLY ${act.staged ? 'staged' : 'production'}@${act.target.slice(0, 12)} ${a.kind} written=${a.written}${'reason' in a ? ` · ${a.reason}` : ''} · reason="${act.approval.reason}"`)
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
    const loadContext = makeAuditContextLoader(prisma, { freshEachCall: semanticClear })
    const provider = semanticProviderFromEnv(process.env, `defect-resolve-${Date.now()}`).provider
    const now = new Date()
    const e = semanticClear
      ? await planSemanticDefectResolution(prisma, { queueId, loadContext, provider, now })
      : await planDefectResolution(prisma, { queueId, contextOf, now })
    if (e.kind === 'refuse') { console.log(`RESOLVE_PLAN refuse code=${e.code} · ${e.reason}`); return 1 }
    if (e.kind === 'already') { console.log(`RESOLVE_PLAN already · ${e.reason}`); return 0 }
    const r = e.plan.record
    const proof = r.reverify.outcome === 'blocked'
      ? `gate=${r.reverify.gateVersion} blocked=${r.reverify.failureCodes.join(',')} review=${r.reverify.reviewCodes.join(',') || '-'} input=${r.reverify.inputDigest.slice(0, 16)}`
      : `semantic=${r.reverify.semanticContractVersion}/${r.reverify.semanticPromptVersion} binding=${r.reverify.inputDigest.slice(0, 16)}`
    console.log(`RESOLVE_PLAN plan queue=${e.plan.queueId} post=${e.plan.postId} contract=${r.qualityContract.version}/${r.qualityContract.digest.slice(0, 16)}`
      + ` audit=${e.plan.auditFingerprint.slice(0, 16)} ${proof}`)
    if (!apply) {
      // 🔴 운영 승인에 넣을 값 — 결정적 계획 지문 · 기대 상태(미해소 결함 수 지금:적용 뒤)
      const ex = await expectationOf(prisma, e.plan)
      const token = semanticClear ? ` semanticPlan=${semanticPlanTokenOf(e.plan)}` : ''
      console.log(`RESOLVE_APPROVAL digest=${defectPlanDigestOf(e.plan)} expect=${ex.before}:${ex.after}${token}`)
      console.log('RESOLVE_APPLY skipped (dry-run) written=0')
      return 0
    }
    const a = semanticClear
      ? await applySemanticDefectResolution(prisma, { plan: e.plan, loadContext, now: new Date() })
      : await applyDefectResolution(prisma, { plan: e.plan, contextOf, now: new Date() })
    console.log(`RESOLVE_APPLY ${a.kind} written=${a.written}${a.kind === 'written' ? '' : ` · ${'reason' in a ? a.reason : ''}`}`)
    return a.kind === 'written' || a.kind === 'already' ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

main().then((c) => process.exit(c), (e: unknown) => { console.error(`🔴 ${(e as Error).name}`); process.exit(1) })
