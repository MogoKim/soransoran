#!/usr/bin/env tsx
/**
 * Micro Seed 예약시각 재동기화 — DB + Sheet
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-7-A · §6-8 R5 · 정책 21
 *
 * 🔴 왜 publisher 가 아니라 별도 스크립트인가
 *    정책 21 · R5 는 "scheduledPublishAt 이 과거면 즉시 발행하지 않고 HOLD" 다.
 *    publisher 가 과거 예약을 스스로 미래로 밀면 그 규칙이 무의미해진다 —
 *    "예약이 지났다" 는 창업자가 다시 판단할 신호이지 시스템이 지울 사실이 아니다.
 *    그래서 재예약은 **사람이 명시적으로 부르는 경로**로 분리한다.
 *
 * 🔴 DB 와 Sheet 를 같은 시각으로 맞춘다
 *    한쪽만 바뀌면 validator(Sheet 기준)와 publisher(DB 기준)가 다른 시각을 본다.
 *
 * 🔴 Sheet 는 bootstrap 모드로 행을 재작성한다
 *    scheduledPublishAt 은 §6-7-A 허용 열(status·holdReason·postUrl·updatedBySystemAt)에
 *    없다 — 창업자 칸이라 시스템이 부분 갱신할 수 없다. 사람이 명시 지시한 이 경로에서만
 *    DB 기준으로 행 전체를 다시 쓴다. status 는 Sheet 실측값을 그대로 되쓴다.
 *    ⚠️ 발행 이후(postUrl 이 찬 뒤)에는 bootstrap 이 거부한다 — 그때는 재예약이 의미 없다.
 *
 * 사용법
 *   npm run micro-seed:reschedule-live -- --candidate=<uuid> --at="2026-08-25 18:45"
 *   npm run micro-seed:reschedule-live -- --candidate=<uuid> --in=20      (지금부터 N분 뒤, 5분 올림)
 */
import { PrismaClient } from '@prisma/client'
import { SHEET_HEADERS, SHEET_TAB_NAME, SHEET_READONLY_SCOPE, MICRO_SEED_SHEET_ID_ENV, buildSheetRow, updateCandidateRow } from './lib/micro-seed-sheet.mjs'
import { parseKst } from './micro-seed-validate.mjs'
import { loadEnvLocal, kstString, utcWallClock, roundUpToFiveMinutes } from './lib/micro-seed-time.mjs'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  await loadEnvLocal()

  const candidateId = arg('candidate')
  if (!candidateId) throw new Error('--candidate=<uuid> 가 필요하다. 어떤 후보인지 모른 채 쓰지 않는다.')

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

  // 🔴 과거로 미는 것을 막는다. R5 로 곧바로 HOLD 가 될 값을 쓰는 것은 의도일 수 없다.
  if (target <= now) {
    throw new Error(`지정 시각이 과거다 (now=${kstString(now)} KST / target=${kstString(target)} KST). 쓰지 않는다.`)
  }

  const targetKst = kstString(target)
  const targetUtc = utcWallClock(target)

  console.log('\nMicro Seed 예약 재동기화')
  console.log(`  후보: ${candidateId}`)
  console.log(`  현재: ${kstString(now)} KST`)
  console.log(`  목표: ${targetKst} KST (= ${targetUtc} UTC) · +${Math.round((target.getTime() - now.getTime()) / 60000)}분\n`)

  const prisma = new PrismaClient()
  try {
    const before = await prisma.microSeedCandidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true, status: true, scheduledPublishAt: true, targetBoardType: true,
        founderTitle: true, originalTitle: true, sourceSite: true, sourceUrl: true,
        sourceArticleId: true, sourceBoardName: true, sourceCommentCount: true,
        sourceCapturedAt: true, dedupKey: true, holdReason: true, declineReason: true,
      },
    })
    if (!before) throw new Error(`후보를 찾지 못했다: ${candidateId}`)

    // ── ① DB ──
    await prisma.microSeedCandidate.update({
      where: { id: candidateId },
      data: { scheduledPublishAt: target },
    })
    const after = await prisma.microSeedCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { scheduledPublishAt: true, status: true },
    })
    if (!after.scheduledPublishAt || utcWallClock(after.scheduledPublishAt) !== targetUtc) {
      throw new Error(`DB read-back 불일치: ${after.scheduledPublishAt?.toISOString()} (기대 ${targetUtc} UTC)`)
    }
    console.log(`  ✅ DB      scheduledPublishAt = ${targetUtc} UTC`)

    // ── ② Sheet — 행 번호와 현재 status 를 실측한다 ──
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
    const sheetStatus = String(sheetRow[SHEET_HEADERS.indexOf('status')] ?? '').trim()

    // 🔴 status 는 Sheet 실측값을 되쓴다. DB 값으로 덮으면 창업자 승인이 풀린다.
    const values = buildSheetRow({
      candidateId,
      status: sheetStatus,
      board: (before.targetBoardType ?? '').toLowerCase(),
      founderTitle: before.founderTitle ?? '',
      originalTitle: before.originalTitle,
      scheduledPublishAt: targetKst,
      sourceSite: before.sourceSite,
      sourceUrl: before.sourceUrl,
      sourceArticleId: before.sourceArticleId,
      sourceBoardName: before.sourceBoardName ?? '',
      sourceCommentCount: before.sourceCommentCount,
      sourceCapturedAt: kstString(before.sourceCapturedAt),
      dedupKey: before.dedupKey,
      holdReason: before.holdReason ?? '',
      declineReason: before.declineReason ?? '',
      postUrl: '',
      updatedBySystemAt: '',
    })
    const write = await updateCandidateRow({
      mode: 'bootstrap', tab: SHEET_TAB_NAME, rowNumber, values, expectId: candidateId,
    })
    console.log(`  ✅ Sheet   ${write.ranges.join(', ')} · ${write.updatedCells}셀 · read-back ${write.readBackVerified ? '검증됨' : '미검증'}`)
    console.log(`     status  ${sheetStatus} (유지) · F열 ${targetKst}\n`)
    console.log('  🔴 발행하지 않는다. status 전환 없음 · Post 생성 없음.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
