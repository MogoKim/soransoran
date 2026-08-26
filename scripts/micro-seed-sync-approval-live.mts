#!/usr/bin/env tsx
/**
 * Micro Seed 창업자 승인 동기화 — Sheet → DB
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-8 · §6-10
 *
 * 🔴 왜 이 스크립트가 필요한가
 *    publisher 의 획득 SQL 은 **DB 의** `status='PENDING'` 을 조건으로 한다
 *    (write-guard.ts ACQUIRE_CANDIDATE_SQL). 그런데 창업자의 승인은 **Sheet** 에 적힌다.
 *    둘을 잇는 경로가 없으면 승인해도 후보를 영원히 집지 못한다.
 *
 *    §5-2 가 정한 방향이 그대로다:
 *      DB → Sheet   단방향 미러
 *      Sheet → DB   **창업자 편집 칸만** (§6-7-A 의 5칸)
 *    이 파일이 후자를 구현한다.
 *
 * 🔴 자동으로 시각을 밀지 않는다
 *    scheduledPublishAt 이 과거면 PENDING 으로 올리지 않고 HOLD 로 둔 채 사유를 보고한다.
 *    정책 21 · R5 가 "과거면 즉시 발행하지 않는다" 이고, 그 판단을 시스템이 대신하면
 *    규칙이 무의미해진다. 재예약은 micro-seed:reschedule-live 로 사람이 명시 지시한다.
 *
 * 🔴 승격 조건을 좁게 잡는다
 *    Sheet=PENDING · DB=HOLD · 발행 이력 없음 · dedupKey 원장 일치 · 편집칸 전부 유효 ·
 *    예약이 미래. 하나라도 어긋나면 status 를 올리지 않는다.
 *    올리는 것은 되돌리기 쉽지만, 올린 뒤 발행되면 되돌리기 어렵다.
 *
 * 🔴 승격 판정은 lib/micro-seed-approve-lib.mts 에 있다
 *    approve-live 가 같은 판정을 써야 한다. 이 파일이 Sheet 전체를 훑는 경로이고
 *    approve-live 가 단일 후보 경로다 — 판정이 갈라지면 두 경로가 다른 답을 낸다.
 *
 * 사용법
 *   npm run micro-seed:sync-approval-live
 *   npm run micro-seed:sync-approval-live -- --dry-run    (판정만, DB write 없음)
 */
import { PrismaClient } from '@prisma/client'
import { createGoogleSheetSource, readCandidates, SHEET_TAB_NAME } from './lib/micro-seed-sheet.mjs'
import { parseKst } from './micro-seed-validate.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
// 🔴 승격 판정은 approve-live 와 **같은 lib** 을 쓴다 (C-2).
//    갈라지면 "한쪽은 승격, 한쪽은 보류" 가 되는데 그게 가장 늦게 발견된다.
import { evaluatePromotion } from './lib/micro-seed-approve-lib.mjs'

const DRY_RUN = process.argv.includes('--dry-run')

type Outcome = {
  candidateId: string
  sheetStatus: string
  dbStatusBefore: string
  dbStatusAfter: string
  fieldsUpdated: string[]
  promoted: boolean
  blockedBy: string | null
}

async function main() {
  await loadEnvLocal()

  console.log('\nMicro Seed 승인 동기화 — Sheet → DB')
  console.log(`  탭: ${SHEET_TAB_NAME} · 편집 칸만 반영 (§6-7-A)`)
  console.log(
    DRY_RUN
      ? '  🔍 --dry-run: 판정만 한다. DB write 없음\n'
      : '  🔴 Sheet write 없음 · Post 생성 없음 · PUBLISHED 전환 없음\n',
  )

  const source = await createGoogleSheetSource({ tab: SHEET_TAB_NAME })
  const { ok, headerErrors, candidates, diagnostics } = await readCandidates(source)
  if (!ok) {
    console.error('  ❌ 헤더가 정본과 다르다. 행을 하나도 반영하지 않는다.')
    for (const e of headerErrors) console.error(`     · ${e.kind} ${e.column ?? ''} — ${e.message}`)
    process.exit(1)
  }
  // 🔴 NOT_INJECTED 는 여기서 정상이다.
  //    이 스크립트는 발행 게이트(content · contentGuard · hasEverPublished · dbDedupKey)를
  //    판정하지 않는다 — 그건 dry-run-live 와 publisher 의 일이다. 여기서 하는 것은
  //    "창업자가 적은 편집 칸을 원장에 옮기는 것" 뿐이라 주입이 필요 없다.
  //    다만 dedupKey 대조(R11)만은 DB 를 직접 읽어 아래에서 확인한다.
  for (const d of diagnostics ?? []) {
    if (d.kind === 'NOT_INJECTED') continue
    console.log(`  ⚠️  ${d.kind} ${d.candidateId ?? ''} — ${d.message}`)
  }

  // 🔴 Sheet 가 PENDING 이라고 적은 행만 본다. 나머지는 이 스크립트의 관심사가 아니다.
  const targets = candidates.filter((c: Record<string, unknown>) => String(c.status ?? '').trim() === 'PENDING')
  console.log(`  Sheet PENDING ${targets.length}건 / 전체 ${candidates.length}건\n`)
  if (targets.length === 0) {
    console.log('  반영할 것이 없다. 오류가 아니다 — 창업자가 아직 승인하지 않았을 뿐이다.\n')
    return
  }

  const prisma = new PrismaClient()
  const outcomes: Outcome[] = []
  const now = new Date()
  try {
    for (const row of targets as Record<string, unknown>[]) {
      const candidateId = String(row.candidateId ?? '').trim()
      const db = await prisma.microSeedCandidate.findUnique({
        where: { id: candidateId },
        select: {
          id: true, status: true, dedupKey: true, createdPostId: true,
          founderTitle: true, targetBoardType: true, scheduledPublishAt: true, declineReason: true,
        },
      })
      if (!db) {
        outcomes.push({
          candidateId, sheetStatus: 'PENDING', dbStatusBefore: '(없음)', dbStatusAfter: '(없음)',
          fieldsUpdated: [], promoted: false,
          blockedBy: '원장에 후보가 없다. Sheet 행만 있는 상태로는 반영하지 않는다',
        })
        continue
      }

      // ── 승격 판정 — approve-live 와 같은 lib 을 쓴다 (C-2) ──
      const verdict = evaluatePromotion({
        mode: 'sync',
        candidateId,
        sheet: {
          status: row.status,
          dedupKey: row.dedupKey,
          founderTitle: row.founderTitle,
          board: row.board,
          scheduledPublishAt: row.scheduledPublishAt,
          declineReason: row.declineReason,
        },
        db,
        now,
        parseKst,
        kstString,
      })
      const { data, fieldsUpdated, promote, blockedBy: blocked } = verdict

      if (Object.keys(data).length > 0 && !DRY_RUN) {
        await prisma.microSeedCandidate.update({ where: { id: candidateId }, data })
      }

      // read-back — DB 도 응답을 믿지 않는다
      const after = DRY_RUN
        ? db
        : await prisma.microSeedCandidate.findUniqueOrThrow({
            where: { id: candidateId },
            select: {
              id: true, status: true, dedupKey: true, createdPostId: true,
              founderTitle: true, targetBoardType: true, scheduledPublishAt: true, declineReason: true,
            },
          })
      if (!DRY_RUN && promote && after.status !== 'PENDING') {
        throw new Error(`DB read-back 불일치: status=${after.status} (기대 PENDING)`)
      }

      outcomes.push({
        candidateId,
        sheetStatus: 'PENDING',
        dbStatusBefore: db.status,
        dbStatusAfter: after.status,
        fieldsUpdated,
        promoted: promote && !DRY_RUN,
        blockedBy: blocked,
      })
    }
  } finally {
    await prisma.$disconnect()
  }

  // ── 보고 ───────────────────────────────────────────────
  for (const o of outcomes) {
    const mark = o.blockedBy ? '⛔' : DRY_RUN ? '🔍' : '✅'
    console.log(`  ${mark} ${o.candidateId}`)
    console.log(`     DB status  ${o.dbStatusBefore} → ${o.dbStatusAfter}`)
    console.log(`     반영 필드   ${o.fieldsUpdated.length ? o.fieldsUpdated.join(' · ') : '(없음)'}`)
    if (o.blockedBy) console.log(`     승격 보류   ${o.blockedBy}`)
    console.log('')
  }
  const promoted = outcomes.filter((o) => o.promoted).length
  const blocked = outcomes.filter((o) => o.blockedBy).length
  console.log(`  승격 ${promoted}건 · 보류 ${blocked}건 / 대상 ${outcomes.length}건`)
  console.log('  🔴 발행하지 않는다. publisher 는 별도이며 이 스크립트는 Post 를 만들지 않는다.\n')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
