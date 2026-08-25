#!/usr/bin/env tsx
/**
 * Micro Seed 복구 스캐너 — PROCESSING 잔류 · DB↔Sheet 불일치
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-2 · §6-3 · §6-4 · §6-7-A
 *
 * publisher 가 남길 수 있는 어긋난 상태를 찾아 **조용히 남지 않게** 한다.
 *
 *   ① PROCESSING 잔류   worker 가 획득한 뒤 죽었다. timeout 을 넘겼으면 실측 후 정리한다
 *   ② DB↔Sheet 불일치   DB 는 바뀌었는데 Sheet 역기록이 실패했다
 *
 * 🔴 dry-run 이 기본이다. 바꾸려면 --apply 를 **명시**해야 한다
 *    publisher 는 --dry-run 을 명시해야 안전한 구조지만 여기는 반대다.
 *    복구는 사람이 안 보는 사이에 상태를 바꾸는 장치라 "실수로 도는" 쪽이 훨씬 위험하다.
 *
 * 🔴 PUBLISHED 후보는 조회 단계에서 **영구 제외**한다 (§6-4 · R9)
 *    발행은 비가역이다. 복구 장치가 그것을 건드릴 수 있으면 비가역이 아니게 된다.
 *    ⚠️ 그 대가로 "DB=PUBLISHED · Sheet=PENDING" 은 이 스캐너가 고치지 못한다.
 *       그 경우는 publisher 가 divergence 로 출력하고 사람이 맞춘다.
 *
 * 🔴 PENDING 으로 되돌리는 경로가 없다 (§5-4 · 정책 14)
 *    resolveTimeoutRecovery 가 PENDING 을 반환하지 않고, demote 의 타입도 그것을 막는다.
 *
 * 🔴 자동화하지 않는다 (§6-9-F)
 *    M1 은 수동 실행이다. 스캐너야말로 더욱 그렇다 — 사람이 안 볼 때 상태를 바꾸는 장치다.
 *
 * 사용법
 *   npm run micro-seed:recover-live                 진단만 (기본)
 *   npm run micro-seed:recover-live -- --apply      실제 복구
 *   npm run micro-seed:recover-live -- --json
 */
import { PrismaClient, type MicroSeedCandidateStatus } from '@prisma/client'
import {
  PROCESSING_TIMEOUT_MINUTES,
  resolveTimeoutRecovery,
  type PublishOutcome,
  type TimeoutProbe,
} from '../src/lib/micro-seed-write-guard'
import { buildPostUrl, findSheetRow, syncSheet, type Divergence } from './lib/micro-seed-publish-lib.mjs'
import { SHEET_TAB_NAME, SHEET_HEADERS, createGoogleSheetSource } from './lib/micro-seed-sheet.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')
const WORKER_ID = `recover-live:${process.pid}`

/**
 * 🔴 이 스캐너가 절대 손대지 않는 상태 (§6-4 · R9).
 *    조회 where 절과 아래 이중 확인에 함께 쓴다 — 쿼리만 믿지 않는다.
 */
const EXCLUDED_STATUSES = ['PUBLISHED'] as const

type Verdict =
  /** 어긋난 것이 없다 */
  | { kind: 'OK' }
  /** PROCESSING 이 timeout 을 넘겼다 */
  | { kind: 'TIMEOUT'; next: MicroSeedCandidateStatus; nextAttemptCount: number; reason: string; outcome: PublishOutcome }
  /** DB 는 시스템 상태인데 Sheet 가 따라오지 못했다 — 복구 가능 */
  | { kind: 'SHEET_BEHIND'; dbStatus: string; sheetStatus: string; outcome: PublishOutcome }
  /** Sheet 가 앞서 있다 (창업자 승인 대기) — 이 스캐너의 일이 아니다 */
  | { kind: 'NEEDS_SYNC_APPROVAL'; dbStatus: string; sheetStatus: string }
  /** 사람이 판단해야 한다 */
  | { kind: 'AMBIGUOUS'; dbStatus: string; sheetStatus: string; reason: string }

async function main() {
  await loadEnvLocal()
  const now = new Date()

  if (!AS_JSON) {
    console.log('\nMicro Seed 복구 스캐너')
    console.log(`  기준 ${kstString(now)} KST · timeout ${PROCESSING_TIMEOUT_MINUTES}분`)
    console.log(`  🔴 ${EXCLUDED_STATUSES.join(' · ')} 후보는 조회하지 않는다 (발행은 비가역 · §6-4)`)
    console.log(APPLY ? '  🔴 --apply: 실제로 바꾼다\n' : '  🔍 진단만 한다. DB·Sheet write 없음 (--apply 로 실행)\n')
  }

  const prisma = new PrismaClient()
  const divergences: Divergence[] = []
  const results: Array<{ candidateId: string; verdict: Verdict; applied: boolean }> = []
  try {
    // ── ① 후보 조회 — PUBLISHED 는 where 절에서 배제 ──────
    const rows = await prisma.microSeedCandidate.findMany({
      where: { status: { notIn: [...EXCLUDED_STATUSES] } },
      select: {
        id: true, status: true, attemptCount: true, processingStartedAt: true, processingBy: true,
        createdPostId: true, targetBoardType: true, sourceUrl: true,
      },
    })

    // 🔴 쿼리를 믿고 넘어가지 않는다. where 절이 바뀌어도 여기서 다시 걸러진다.
    const scoped = rows.filter((r) => !(EXCLUDED_STATUSES as readonly string[]).includes(r.status))
    if (scoped.length !== rows.length && !AS_JSON) {
      console.error(`  🔴 조회에 제외 대상이 섞였다 (${rows.length - scoped.length}건). where 절을 확인한다.`)
    }

    // ── ② Sheet 를 한 번만 읽는다 ─────────────────────────
    //    전수 대조가 목적이라 후보마다 API 를 부르면 안 된다.
    const source = await createGoogleSheetSource({ tab: SHEET_TAB_NAME })
    const { rows: sheetRows } = (await source.fetchRows()) as { rows: unknown[][] }
    const sheetStatusById = new Map<string, string>()
    for (const r of sheetRows) {
      const id = String(r?.[SHEET_HEADERS.indexOf('candidateId')] ?? '').trim()
      if (id) sheetStatusById.set(id, String(r?.[SHEET_HEADERS.indexOf('status')] ?? '').trim())
    }
    if (!AS_JSON) console.log(`  대상 ${scoped.length}건 (PUBLISHED 제외) · Sheet 행 ${sheetStatusById.size}건\n`)

    const timeoutFloor = new Date(now.getTime() - PROCESSING_TIMEOUT_MINUTES * 60_000)

    for (const row of scoped) {
      const sheetStatus = sheetStatusById.get(row.id) ?? '(행 없음)'
      let verdict: Verdict = { kind: 'OK' }

      // ── ③ PROCESSING 잔류 ────────────────────────────
      if (row.status === 'PROCESSING') {
        if (!row.processingStartedAt || row.processingStartedAt > timeoutFloor) {
          verdict = {
            kind: 'AMBIGUOUS',
            dbStatus: row.status,
            sheetStatus,
            reason: row.processingStartedAt
              ? `아직 timeout 전이다 (${PROCESSING_TIMEOUT_MINUTES}분 미경과). 작업 중일 수 있다`
              : 'PROCESSING 인데 processingStartedAt 이 없다. 언제 시작했는지 알 수 없어 판정하지 않는다',
          }
        } else {
          // 🔴 실측이 먼저다 (§6-3). Post 가 있는데 HOLD 로 되돌리면 재승인 → 이중 발행이다.
          const linkedPost = await prisma.post.findUnique({
            where: { sheetCandidateId: row.id },
            select: { id: true, createdAt: true, boardType: true },
          })
          const otherPost = linkedPost
            ? null
            : await prisma.post.findFirst({
                where: { sourceUrl: row.sourceUrl, sheetCandidateId: { not: row.id } },
                select: { id: true },
              })

          const probe: TimeoutProbe = {
            hasPost: linkedPost !== null || otherPost !== null,
            postLinkedToCandidate: linkedPost !== null,
            attemptCount: row.attemptCount,
          }
          const recovery = resolveTimeoutRecovery(probe)

          // 🔴 Sheet 셀 구성은 buildSheetWriteCells 만 쓴다 — outcome 으로 넘긴다.
          let outcome: PublishOutcome
          if (recovery.nextStatus === 'PUBLISHED') {
            if (!linkedPost || !row.targetBoardType) {
              verdict = {
                kind: 'AMBIGUOUS', dbStatus: row.status, sheetStatus,
                reason: 'PUBLISHED 로 정정해야 하는데 Post 또는 board 를 실측하지 못했다',
              }
              results.push({ candidateId: row.id, verdict, applied: false })
              continue
            }
            outcome = {
              kind: 'PUBLISHED',
              postUrl: buildPostUrl(row.targetBoardType, linkedPost.id),
              at: linkedPost.createdAt,
            }
          } else if (recovery.nextStatus === 'SKIPPED') {
            outcome = { kind: 'SKIPPED', reason: recovery.reason }
          } else if (recovery.nextStatus === 'FAILED') {
            outcome = { kind: 'FAILED', reason: recovery.reason }
          } else {
            outcome = { kind: 'HOLD', reason: recovery.reason }
          }
          verdict = {
            kind: 'TIMEOUT',
            next: recovery.nextStatus,
            nextAttemptCount: recovery.nextAttemptCount,
            reason: recovery.reason,
            outcome,
          }
        }
      }
      // ── ④ DB↔Sheet 불일치 ───────────────────────────
      else if (sheetStatus !== row.status) {
        if (sheetStatus === '(행 없음)') {
          verdict = { kind: 'AMBIGUOUS', dbStatus: row.status, sheetStatus, reason: 'Sheet 에 해당 행이 없다' }
        } else if (row.status === 'FAILED' || row.status === 'SKIPPED') {
          // 창업자가 Sheet 에 적을 이유가 없는 값들이다 — 시스템이 만든 상태이므로 DB 가 정본이다.
          verdict = {
            kind: 'SHEET_BEHIND',
            dbStatus: row.status,
            sheetStatus,
            outcome: { kind: row.status, reason: `DB 기준 동기화 (${row.status})` },
          }
        } else if (sheetStatus === 'PENDING' && row.status === 'HOLD') {
          // 🔴 이건 어긋난 게 아니라 **승인 대기**일 수 있다.
          //    창업자가 방금 PENDING 으로 올렸고 sync-approval 을 아직 안 돌린 상태다.
          //    여기서 Sheet 를 HOLD 로 덮으면 승인이 사라진다.
          verdict = { kind: 'NEEDS_SYNC_APPROVAL', dbStatus: row.status, sheetStatus }
        } else {
          verdict = {
            kind: 'AMBIGUOUS', dbStatus: row.status, sheetStatus,
            reason: '창업자 편집 칸일 수 있어 자동으로 덮지 않는다',
          }
        }
      }

      // ── ⑤ 적용 (--apply 일 때만) ─────────────────────
      let applied = false
      if (APPLY && (verdict.kind === 'TIMEOUT' || verdict.kind === 'SHEET_BEHIND')) {
        if (verdict.kind === 'TIMEOUT') {
          const detail = `${verdict.reason} [${WORKER_ID}]`
          await prisma.$transaction(async (tx) => {
            await tx.microSeedCandidate.update({
              where: { id: row.id },
              data: {
                status: verdict.next,
                attemptCount: verdict.nextAttemptCount,
                processedAt: new Date(),
                ...(verdict.next === 'FAILED' ? { failureReason: detail } : {}),
                ...(verdict.next === 'HOLD' ? { holdReason: detail } : {}),
              },
            })
            await tx.microSeedCandidateHistory.create({
              data: {
                candidateId: row.id, fromStatus: 'PROCESSING', toStatus: verdict.next,
                by: `worker:${WORKER_ID}`, reason: detail,
              },
            })
          })
        }
        // 🔴 SHEET_BEHIND 는 DB 를 바꾸지 않는다. History 도 남기지 않는다 —
        //    상태 전이가 없었는데 이력을 남기면 measureCapContext 집계가 오염된다.
        applied = await syncSheet(row.id, verdict.outcome, verdict.kind === 'TIMEOUT' ? verdict.next : verdict.dbStatus, divergences, sheetRows)
      }
      results.push({ candidateId: row.id, verdict, applied })
    }
  } finally {
    await prisma.$disconnect()
  }

  // ── 보고 ───────────────────────────────────────────────
  if (AS_JSON) {
    console.log(JSON.stringify({ apply: APPLY, results, divergences }, null, 2))
  } else {
    const label: Record<Verdict['kind'], string> = {
      OK: '✅ 정상',
      TIMEOUT: '🔧 timeout 복구',
      SHEET_BEHIND: '🔧 Sheet 뒤처짐',
      NEEDS_SYNC_APPROVAL: '⏭️  승인 동기화 필요',
      AMBIGUOUS: '⚠️  사람 판단 필요',
    }
    for (const r of results) {
      if (r.verdict.kind === 'OK') continue
      console.log(`  ${label[r.verdict.kind]}  ${r.candidateId}`)
      if (r.verdict.kind === 'TIMEOUT') {
        console.log(`     PROCESSING → ${r.verdict.next} · attempt ${r.verdict.nextAttemptCount}`)
        console.log(`     ${r.verdict.reason}`)
      } else if (r.verdict.kind === 'SHEET_BEHIND') {
        console.log(`     DB=${r.verdict.dbStatus} · Sheet=${r.verdict.sheetStatus} → Sheet 를 DB 로 맞춘다`)
      } else if (r.verdict.kind === 'NEEDS_SYNC_APPROVAL') {
        console.log(`     DB=${r.verdict.dbStatus} · Sheet=${r.verdict.sheetStatus}`)
        console.log('     창업자 승인일 수 있다. micro-seed:sync-approval-live 를 먼저 돌린다')
      } else {
        console.log(`     DB=${r.verdict.dbStatus} · Sheet=${r.verdict.sheetStatus} — ${r.verdict.reason}`)
      }
      console.log(`     ${r.applied ? '적용됨' : APPLY ? '적용 안 함' : '(dry-run)'}\n`)
    }
    const counts = results.reduce<Record<string, number>>((a, r) => {
      a[r.verdict.kind] = (a[r.verdict.kind] ?? 0) + 1
      return a
    }, {})
    console.log(`  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || '대상 없음'}`)
    if (!APPLY) console.log('  🔍 진단만 했다. DB·Sheet 에 아무것도 쓰지 않았다. 바꾸려면 --apply 를 붙인다.')
  }

  if (divergences.length) {
    console.error(`\n  🔴 DB ↔ Sheet 불일치 ${divergences.length}건 — 사람이 Sheet 를 맞춰야 한다`)
    for (const d of divergences) {
      console.error(`     · ${d.candidateId}\n       DB=${d.dbStatus} · Sheet=${d.sheetStatus}\n       ${d.reason}`)
    }
    process.exit(2)
  }
  console.log('')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
