#!/usr/bin/env tsx
/**
 * Micro Seed 창업자 승인 — 명령 한 번으로 Sheet + DB
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-8 · §6-10
 *
 * 🔴 무엇을 줄이는가
 *    지금까지 후보 1건을 발행하려면 창업자가 Sheet 를 열어 두 칸을 손으로 고쳐야 했다 —
 *    B열을 PENDING 으로, F열에 예약시각을. 그 편집이 반복 운영의 병목이다.
 *    이 명령이 두 칸을 대신 쓰고 DB 까지 맞춘다.
 *
 * 🔴 승인 원칙은 그대로다
 *    승인은 "Sheet 를 손으로 편집하는 것" 이 아니라 **창업자가 명시적으로 지시하는 것**이다.
 *    --candidate 와 --at/--in 과 --apply 를 직접 적는 행위가 그 지시다.
 *    --apply 가 없으면 아무것도 쓰지 않는다.
 *
 * 🔴 publisher 를 부르지 않는다
 *    이 명령의 종점은 status=PENDING 이다. 발행은 사람이 dry-run 으로 확인한 뒤
 *    publish-live 를 따로 부른다. 승인과 발행 사이에 사람이 한 번 더 서야 한다.
 *
 * 🔴 후보 하나만 건드린다
 *    sync-approval-live 를 통째로 부르면 Sheet 의 다른 PENDING 행까지 승격된다.
 *    그래서 판정만 공유하고(lib/micro-seed-approve-lib.mts) 반영은 여기서 직접 한다.
 *
 * 🔴 Sheet 편집칸을 조용히 덮지 않는다
 *    Sheet 는 bootstrap 모드로 17열을 다시 쓴다(F열이 §6-7-A 허용 열이 아니라 부분 갱신이 안 된다).
 *    DB 값 기준으로 쓰면 창업자가 Sheet 에서 고친 founderTitle 이 사라진다.
 *    그래서 **Sheet 편집칸을 먼저 읽어 확정값으로 삼고**, 그 값으로 DB 와 Sheet 를 함께 맞춘다.
 *
 * 사용법
 *   npm run micro-seed:approve-live -- --candidate=<uuid> --at="2026-08-27 09:00"
 *   npm run micro-seed:approve-live -- --candidate=<uuid> --in=10
 *   npm run micro-seed:approve-live -- --candidate=<uuid> --at="..." --apply   실제 반영
 */
import { PrismaClient } from '@prisma/client'
import {
  SHEET_HEADERS, SHEET_TAB_NAME, SHEET_READONLY_SCOPE, MICRO_SEED_SHEET_ID_ENV,
  buildSheetRow, updateCandidateRow,
} from './lib/micro-seed-sheet.mjs'
import { evaluatePromotion } from './lib/micro-seed-approve-lib.mjs'
import { parseKst } from './micro-seed-validate.mjs'
import { loadEnvLocal, kstString, roundUpToFiveMinutes, utcWallClock } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

/** Sheet 행에서 열 이름으로 값을 꺼낸다 */
function cell(row: unknown[], name: string): unknown {
  return row[SHEET_HEADERS.indexOf(name)]
}

async function main() {
  await loadEnvLocal()

  // ── 인자 ────────────────────────────────────────────────
  const candidateId = arg('candidate')
  if (!candidateId) {
    throw new Error('--candidate=<uuid> 가 필요하다. 어떤 후보인지 모른 채 승인하지 않는다.')
  }
  const atRaw = arg('at')
  const inRaw = arg('in')
  if (!atRaw && !inRaw) throw new Error('--at="YYYY-MM-DD HH:mm" (KST) 또는 --in=<분> 중 하나가 필요하다.')
  if (atRaw && inRaw) throw new Error('--at 과 --in 을 함께 쓸 수 없다. 어느 쪽이 의도인지 모른다.')

  const now = new Date()
  let target: Date
  if (atRaw) {
    const parsed = parseKst(atRaw)
    if (!parsed) throw new Error(`--at 형식이 아니다: "${atRaw}". YYYY-MM-DD HH:mm (KST) 로 준다.`)
    target = parsed
  } else {
    const minutes = Number(inRaw)
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`--in 은 양수 분이어야 한다: "${inRaw}"`)
    target = roundUpToFiveMinutes(new Date(now.getTime() + minutes * 60_000))
  }
  // 🔴 과거를 쓰지 않는다. R5 로 곧바로 막힐 값을 적는 것은 의도일 수 없다.
  if (target <= now) {
    throw new Error(`지정 시각이 과거다 (now=${kstString(now)} KST / target=${kstString(target)} KST). 승인하지 않는다.`)
  }

  const targetKst = kstString(target)
  const targetUtc = utcWallClock(target)

  console.log('\nMicro Seed 창업자 승인 — Sheet + DB')
  console.log(`  후보: ${candidateId}`)
  console.log(`  현재: ${kstString(now)} KST`)
  console.log(`  예약: ${targetKst} KST (= ${targetUtc} UTC) · +${Math.round((target.getTime() - now.getTime()) / 60000)}분`)
  console.log(
    APPLY
      ? '  🔴 --apply : Sheet B/F 와 DB status 를 실제로 쓴다'
      : '  🔍 dry-run — 판정만 한다. Sheet write 0 · DB write 0 (반영은 --apply)',
  )
  console.log('  🔴 publisher 를 부르지 않는다. Post 생성 없음 · PUBLISHED 전환 없음\n')

  const prisma = new PrismaClient()
  try {
    // ── ① 원장에서 후보 1건 ──────────────────────────────
    const db = await prisma.microSeedCandidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true, status: true, dedupKey: true, createdPostId: true,
        founderTitle: true, originalTitle: true, targetBoardType: true,
        scheduledPublishAt: true, holdReason: true, declineReason: true,
        sourceSite: true, sourceUrl: true, sourceArticleId: true,
        sourceBoardName: true, sourceCommentCount: true, sourceCapturedAt: true,
      },
    })
    if (!db) throw new Error(`후보를 찾지 못했다: ${candidateId}`)

    // ── ② Sheet 행 실측 — 편집칸을 먼저 읽는다 ────────────
    //    🔴 이 순서가 중요하다. DB 값으로 bootstrap 하면 창업자의 Sheet 편집이 사라진다.
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({ scopes: [SHEET_READONLY_SCOPE] })
    const client = await auth.getClient()
    const sheetId = (process.env[MICRO_SEED_SHEET_ID_ENV] ?? '').trim()
    if (!sheetId) throw new Error(`${MICRO_SEED_SHEET_ID_ENV} 가 없다.`)
    const read = await client.request<{ values?: string[][] }>({
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
        `/values/${encodeURIComponent(SHEET_TAB_NAME)}` +
        `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    })
    const rows = read.data.values ?? []
    const idx = rows.findIndex((r, i) => i > 0 && String(r?.[0] ?? '').trim() === candidateId)
    if (idx === -1) throw new Error(`Sheet 에서 후보 행을 찾지 못했다: ${candidateId}`)
    const rowNumber = idx + 1
    const sheetRow = rows[idx]

    const sheetCells = {
      status: cell(sheetRow, 'status'),
      dedupKey: cell(sheetRow, 'dedupKey'),
      founderTitle: cell(sheetRow, 'founderTitle'),
      board: cell(sheetRow, 'board'),
      scheduledPublishAt: cell(sheetRow, 'scheduledPublishAt'),
      declineReason: cell(sheetRow, 'declineReason'),
      postUrl: cell(sheetRow, 'postUrl'),
      updatedBySystemAt: cell(sheetRow, 'updatedBySystemAt'),
    }

    console.log(`  Sheet 행 ${rowNumber} · status=${String(sheetCells.status ?? '').trim() || '(공란)'}`)
    console.log(`  DB    status=${db.status} · sched=${db.scheduledPublishAt ? utcWallClock(db.scheduledPublishAt) + ' UTC' : 'null'} · post=${db.createdPostId ?? 'null'}\n`)

    // ── ③ 승격 판정 — sync-approval 과 같은 lib ───────────
    const verdict = evaluatePromotion({
      mode: 'approve',
      candidateId,
      sheet: sheetCells,
      db,
      now,
      overrideScheduledPublishAt: target,
      parseKst,
      kstString,
    })

    if (!verdict.promote) {
      console.log(`  ⛔ 승인하지 않는다 — ${verdict.blockedBy}`)
      if (verdict.fieldIssues.length) {
        for (const f of verdict.fieldIssues) console.log(`     · ${f}`)
      }
      console.log('\n  🔴 Sheet · DB 에 아무것도 쓰지 않았다.\n')
      process.exitCode = 1
      return
    }

    // 확정 편집값 — Sheet 실측을 기준으로 삼는다 (②의 이유)
    const finalTitle = String(sheetCells.founderTitle ?? '').trim()
    const finalBoard = String(sheetCells.board ?? '').trim().toLowerCase()
    const finalDecline = String(sheetCells.declineReason ?? '').trim()

    console.log('  ✅ 판정 통과')
    console.log(`     DB 반영 예정  ${verdict.fieldsUpdated.join(' · ')}`)
    console.log(`     Sheet 예정    B${rowNumber}=PENDING · F${rowNumber}=${targetKst}`)
    console.log(`     편집칸 유지   founderTitle="${finalTitle}" · board=${finalBoard}`)
    console.log(`     P/Q           공란 유지 (발행 흔적은 publisher 만 쓴다)\n`)

    // ── 참고: 오늘 발행 수 ────────────────────────────────
    //    🔴 cap 으로 승인을 막지 않는다. 예약이 내일인데 오늘 cap 이 찼다고
    //       승인을 거부하면 잘못된 차단이 된다. 최종 판정은 publisher 가 한다.
    const kstNow = new Date(now.getTime() + 9 * 3600_000)
    const kstMidnight = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600_000,
    )
    const publishedToday = await prisma.microSeedCandidate.count({
      where: { status: 'PUBLISHED', processedAt: { gte: kstMidnight } },
    })
    console.log(`  참고: 오늘(KST) 발행 ${publishedToday}건 — cap 최종 판정은 publisher 가 한다\n`)

    if (!APPLY) {
      console.log('  🔍 dry-run 이었다. Sheet · DB 에 아무것도 쓰지 않았다. 반영하려면 --apply 를 붙인다.\n')
      return
    }

    // ── ④ Sheet write — bootstrap 17열 ───────────────────
    //    status 는 PENDING 으로 올리고 F열에 예약시각을 넣는다.
    //    나머지 열은 Sheet 편집칸(③에서 확정) + DB 원문 사실로 채운다.
    const values = buildSheetRow({
      candidateId,
      status: 'PENDING',
      board: finalBoard,
      founderTitle: finalTitle,
      originalTitle: db.originalTitle,
      scheduledPublishAt: targetKst,
      sourceSite: db.sourceSite,
      sourceUrl: db.sourceUrl,
      sourceArticleId: db.sourceArticleId,
      sourceBoardName: db.sourceBoardName ?? '',
      sourceCommentCount: db.sourceCommentCount,
      sourceCapturedAt: kstString(db.sourceCapturedAt),
      dedupKey: db.dedupKey,
      holdReason: db.holdReason ?? '',
      declineReason: finalDecline,
      // 🔴 발행 흔적은 publisher 만 쓴다 (§6-1). bootstrap 계약도 이를 강제한다.
      postUrl: '',
      updatedBySystemAt: '',
    })
    const write = await updateCandidateRow({
      mode: 'bootstrap', tab: SHEET_TAB_NAME, rowNumber, values, expectId: candidateId,
    })
    console.log(`  ✅ Sheet   ${write.ranges.join(', ')} · ${write.updatedCells}셀 · read-back ${write.readBackVerified ? '검증됨' : '미검증'}`)

    // ── ⑤ DB write + read-back ───────────────────────────
    await prisma.microSeedCandidate.update({ where: { id: candidateId }, data: verdict.data })
    const after = await prisma.microSeedCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { status: true, scheduledPublishAt: true, createdPostId: true, founderTitle: true },
    })
    if (after.status !== 'PENDING') {
      throw new Error(`DB read-back 불일치: status=${after.status} (기대 PENDING)`)
    }
    if (!after.scheduledPublishAt || utcWallClock(after.scheduledPublishAt) !== targetUtc) {
      throw new Error(`DB read-back 불일치: sched=${after.scheduledPublishAt?.toISOString()} (기대 ${targetUtc} UTC)`)
    }
    if (after.createdPostId) {
      throw new Error(`DB read-back 이상: createdPostId 가 생겼다 (${after.createdPostId}). 승인 경로는 Post 를 만들지 않는다`)
    }
    console.log(`  ✅ DB      status=${after.status} · scheduledPublishAt=${targetUtc} UTC · post=null`)
    console.log('\n  🔴 발행하지 않았다. 다음은 사람이 확인한다:')
    console.log('     npm run micro-seed:dry-run-live')
    console.log('     npm run micro-seed:publish-live -- --dry-run')
    console.log('     npm run micro-seed:publish-live -- --limit=1\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
