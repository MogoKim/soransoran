#!/usr/bin/env tsx
/**
 * 🔴 **품질 계약 전환 preflight — 읽기 전용** (2026-10-13 · PR #710 보정)
 *
 *   npx tsx scripts/quality-contract-transition-check.mts --runtime=<판>:<digest>
 *
 *   · target 계약 = 이 파일을 돌리는 코드의 `currentQualityContract()` — 배포는 staging 트리(target)에서,
 *     그리고 checkout 뒤 runtime 트리에서 한 번 더 부른다
 *   · runtime 계약 = 배포가 runtime 트리(옛 SHA)에서 읽어 넘긴 값
 *   · runtime 미해소 0 · target 미해소 0 → exit 0 (PASS). 그 밖은 exit 1 (BLOCK) — 승인으로 여는 길은 없다
 *   · 입력·DB 문제 → exit 2. 🔴 모르는 것을 통과시키지 않는다
 *
 * 🔴 **운영 DB write 0.** 결함 행·큐 행 읽기와 공식 dry-run(`planDefectResolution` — 읽기 트랜잭션)뿐이다.
 *    해소 기록은 staging 트리에서 공식 `auto-ready:defect-resolve --apply --production --staged` 만 쓴다.
 * 🔴 출력은 판 · digest · 건수 · 코드 · 큐 id 뿐이다 — 제목 · 본문 · Persona 이름 · DB 주소를 찍지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { currentQualityContract, readQualityContract } from '../src/lib/quality-contract'
import { defectPlanDigestOf, expectationOf } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import {
  CONTRACT_TRANSITION_VERSION, judgeTransition, markText, parseContractMark, unresolvedUnder,
  type PlanObservation,
} from './lib/quality-contract-transition.mjs'

const argv = process.argv.slice(2)

async function main(): Promise<number> {
  const unknown = argv.filter((a) => !a.startsWith('--runtime='))
  if (unknown.length > 0) {
    // 🔴 우회·승인 플래그(`--force` · `--approve-…`)를 조용히 무시하지 않는다 — 모르는 인자는 거절이다
    console.error(`CONTRACT_TRANSITION refuse code=UNKNOWN_ARG · ${unknown.map((a) => a.split('=')[0]).join(' ')}`)
    return 2
  }
  const runtime = parseContractMark(argv.find((a) => a.startsWith('--runtime='))?.slice('--runtime='.length) ?? '')
  if (runtime === null) { console.error('CONTRACT_TRANSITION refuse code=NO_RUNTIME_CONTRACT · --runtime=<판>:<digest 64> 가 필요하다'); return 2 }
  const target = currentQualityContract()
  if (!fillDbConnection()) { console.error('CONTRACT_TRANSITION refuse code=NO_DB · DB 주소가 없다'); return 2 }

  const prisma = new PrismaClient()
  try {
    const audits = await prisma.autoReadyAudit.findMany({ where: { defect: 'yes' } })
    const rows = await prisma.originalPostApprovalQueue.findMany({
      where: { id: { in: audits.map((a) => a.queueId) } },
      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
    })
    const queues = new Map(rows.map((q) => [q.id, q]))
    // 🔴 공식 dry-run 과 같은 함수 · 같은 digest · 같은 expect — target 미해소 결함에만 묻는다(읽기 트랜잭션)
    const contextOf = makeReverifyContextLoader()
    const plans: PlanObservation[] = []
    const expects = new Map<string, string>()
    for (const id of unresolvedUnder(audits, queues, target)) {
      const e = await planDefectResolution(prisma, { queueId: id, contextOf, now: new Date() })
      if (e.kind === 'plan') {
        plans.push({ queueId: id, kind: 'plan', digest: defectPlanDigestOf(e.plan), record: e.plan.record })
        const ex = await expectationOf(prisma, e.plan)
        expects.set(id, `${ex.before}:${ex.after}`)
      } else plans.push(e.kind === 'already' ? { queueId: id, kind: 'already' } : { queueId: id, kind: 'refuse', code: e.code })
    }
    const r = judgeTransition({ runtime, target, audits, queues, plans })

    // 🔴 그때 남아 있는 자동 READY(도장 · 미발행) — 계약별 건수만. 재도장 · 승격은 어디에도 없다
    const ready = await prisma.originalPostApprovalQueue.findMany({
      where: { decidedBy: AUTO_DECIDER, status: 'APPROVED', createdPostId: null }, select: { gateResults: true },
    })
    const readyOf = (m: { version: string; digest: string }): number => ready.filter((x) => {
      const k = readQualityContract(x.gateResults)
      return k !== null && k.version === m.version && k.digest === m.digest
    }).length

    console.log(`CONTRACT_TRANSITION ${CONTRACT_TRANSITION_VERSION} verdict=${r.verdict} code=${r.code}`)
    console.log(`  runtime=${markText(r.runtime)} unresolved=${r.runtimeUnresolved.length} autoReadyPending=${readyOf(r.runtime)}`)
    console.log(`  target=${markText(r.target)} unresolved=${r.targetUnresolved.length} autoReadyPending=${readyOf(r.target)}`)
    console.log(`  transition=${r.transition ? 'yes' : 'no'} afterPlans target=${r.afterPlans.target} runtime=${r.afterPlans.runtime} autoReadyPendingOther=${ready.length - readyOf(r.runtime) - readyOf(r.target)}`)
    for (const p of r.plans) {
      console.log(`  defect queue=${p.queueId} plan=${p.kind}${p.digest === null ? '' : ` digest=${p.digest} expect=${expects.get(p.queueId) ?? '?'}`}${p.code === null ? '' : ` code=${p.code}`}`)
    }
    for (const p of r.problems) console.log(`  · ${p}`)
    if (r.code === 'TARGET_UNRESOLVED' && r.plans.every((p) => p.kind === 'plan') && r.afterPlans.target === 0) {
      console.log('  → 활성화 전 staging 트리에서: npm run auto-ready:defect-resolve -- --queue=<queue> --apply --production --staged'
        + ' --target=<staging SHA> --digest=<digest> --expect=<expect> --reason="…" · 그 뒤 이 검사를 다시 돌린다')
    }
    return r.verdict === 'PASS' ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

main().then((c) => process.exit(c), (e: unknown) => { console.error(`CONTRACT_TRANSITION refuse code=ERROR · ${(e as Error).name}`); process.exit(2) })
