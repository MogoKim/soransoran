#!/usr/bin/env tsx
/**
 * 🔴 **확정 결함 해소 — 재검증 후 기록** (2026-10-01 · Lane E)
 *
 *   npm run auto-ready:defect-resolve -- --queue=<queueId>            계획만(dry-run · 기본 · write 0)
 *   npm run auto-ready:defect-resolve -- --queue=<queueId> --apply    격리 DB 에서만 기록
 *
 * 🔴 이번 단계는 **운영 DB 적용을 하지 않는다** — `--apply` 는 격리 DB(sentinel · localhost · soran_test)에서만 돈다.
 *    운영 주소로 `--apply` 를 주면 아무것도 읽지 않고 exit 2 다.
 * 🔴 출력은 코드·id·hash 뿐이다 — 초안 · 원문 글자를 찍지 않는다. DB 주소를 찍지 않는다.
 * 🔴 감사 행에는 어떤 쓰기도 하지 않는다(정본 `applyDefectResolution`).
 */
import { PrismaClient } from '@prisma/client'

import { applyDefectResolution, planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'

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
    if (!apply) { console.log('RESOLVE_APPLY skipped (dry-run) written=0'); return 0 }
    const a = await applyDefectResolution(prisma, { plan: e.plan, contextOf, now: new Date() })
    console.log(`RESOLVE_APPLY ${a.kind} written=${a.written}${a.kind === 'written' ? '' : ` · ${'reason' in a ? a.reason : ''}`}`)
    return a.kind === 'written' || a.kind === 'already' ? 0 : 1
  } finally {
    await prisma.$disconnect()
  }
}

main().then((c) => process.exit(c), (e: unknown) => { console.error(`🔴 ${(e as Error).name}`); process.exit(1) })
