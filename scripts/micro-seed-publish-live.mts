#!/usr/bin/env tsx
/**
 * Micro Seed publisher — 실제 발행
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-1 · §6-2 · §6-3 · §6-9 · §6-10
 *
 * 흐름
 *   ① 작성자·cap 실측 → ② 후보 픽업(origin='live') → ③ 예약 유예창 판정
 *   → ④ 원자적 획득(PENDING→PROCESSING) → ⑤ **재판정** → ⑥ Post 생성
 *   → ⑦ Candidate 갱신 + History → ⑧ Sheet 역기록(read-back)
 *
 * 🔴 dry-run 결과를 신뢰하지 않는다
 *    dry-run 은 판정 시점의 사진이다. 그 사이 Sheet 도 DB 도 바뀔 수 있고,
 *    plan 은 guard 를 주입받는 구조라 가짜 guard 로 빈 PASS 를 만들 수 있다(실증됨).
 *    획득 후 guardMicroSeedCandidate 를 **직접 다시 부른다.**
 *
 * 🔴 예약 유예창 (창업자 확정 2026-08-25)
 *      sched >  now            아직이다. 건드리지 않는다
 *      now-30m <= sched <= now 발행 대상
 *      sched <  now-30m        너무 지났다. HOLD + 사유. **시각을 밀지 않는다**
 *    재예약은 micro-seed:reschedule-live 로 사람이 명시 지시한다 (정책 21).
 *
 * 🔴 순서가 곧 안전장치다
 *    Post 생성 → Candidate 갱신 → History 까지 **한 트랜잭션**, 그 뒤에 Sheet.
 *    Sheet 를 먼저 쓰면 "Sheet 는 PUBLISHED 인데 Post 가 없는" 상태가 생기고,
 *    그건 창업자가 재승인할 수 없는 막다른 골목이다.
 *    반대 순서(DB 먼저)의 실패는 timeout 복구가 실측으로 정정할 수 있다 (§6-3).
 *
 * 사용법
 *   npm run micro-seed:publish-live -- --dry-run     판정만. DB·Sheet write 0
 *   npm run micro-seed:publish-live -- --limit=1     실제 발행 (기본 1건)
 */
import { PrismaClient, type BoardType, type MicroSeedCandidateStatus } from '@prisma/client'
import { guardMicroSeedCandidate } from '../src/lib/micro-seed-guard'
import { getMicroSeedAuthorId } from '../src/lib/micro-seed-author'
import { getBoardByType } from '../src/lib/board-registry'
import { SITE } from '../src/lib/brand'
import { MIN_POST_CONTENT_LENGTH, MAX_POST_CONTENT_LENGTH } from '../src/lib/post-policy'
import {
  ACQUIRE_CANDIDATE_SQL,
  PUBLISH_GRACE_MINUTES,
  assertMicroSeedPostData,
  buildMicroSeedPostData,
  interpretAcquireResult,
  isAttemptExhausted,
  requireCapContext,
  resolvePublishWindow,
  resolvePublishableBoard,
  verifyPublishAuthor,
  verifyPublishableOrigin,
} from '../src/lib/micro-seed-write-guard'
import { SHEET_TAB_NAME, SHEET_HEADERS, updateCandidateRow } from './lib/micro-seed-sheet.mjs'
import { CAPS } from './micro-seed-validate.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = (() => {
  const hit = process.argv.find((a) => a.startsWith('--limit='))
  const n = hit ? Number(hit.slice(8)) : 1
  if (!Number.isInteger(n) || n < 1) throw new Error(`--limit 은 1 이상 정수여야 한다: ${hit ?? ''}`)
  return n
})()

/** worker 식별자. 누가 집었는지 남긴다 (§6-3 소유권) */
const WORKER_ID = `publish-live:${process.pid}`

type Skipped = { candidateId: string; kind: string; reason: string }

/** 발행된 글의 공개 URL. §6-1 — Post.id 는 DB 가 발급하고 Sheet 가 기록한다 */
function buildPostUrl(boardType: BoardType, postId: string): string {
  const board = getBoardByType(boardType)
  if (!board) throw new Error(`board slug 를 찾지 못했다: ${boardType}`)
  return `${SITE.url}/community/${board.slug}/${postId}`
}

async function main() {
  await loadEnvLocal()
  const now = new Date()

  console.log('\nMicro Seed publisher')
  console.log(`  유예창: 도래 후 ${PUBLISH_GRACE_MINUTES}분 이내 · 기준 ${kstString(now)} KST`)
  console.log(
    DRY_RUN
      ? '  🔍 --dry-run: 판정만 한다. 획득·Post·Sheet write 전부 없음\n'
      : `  🔴 실제 발행 · 최대 ${LIMIT}건\n`,
  )

  // ── ① 작성자 (§6-9-E — 없으면 발행하지 않는다. 폴백 없음) ──
  const authorId = getMicroSeedAuthorId()

  const prisma = new PrismaClient()
  const skipped: Skipped[] = []
  let published = 0
  let failed = 0
  try {
    // ── ① cap 실측 (§6-9-F) ─────────────────────────────
    const kstNow = new Date(now.getTime() + 9 * 3600_000)
    const startOfKstDay = new Date(
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600_000,
    )
    const cap = requireCapContext({
      isFirstRun: (await prisma.microSeedCandidate.count({ where: { status: 'PUBLISHED' } })) === 0,
      publishedToday: await prisma.microSeedCandidateHistory.count({
        where: { toStatus: 'PUBLISHED', at: { gte: startOfKstDay } },
      }),
    })
    console.log(`  cap  isFirstRun=${cap.isFirstRun} · publishedToday=${cap.publishedToday}`)

    if (cap.publishedToday >= CAPS.hardDaily) {
      console.log(`  ⛔ hard daily cap ${CAPS.hardDaily}건에 도달했다. 발행하지 않는다.\n`)
      return
    }
    // 🔴 first-run guard: 최초 발행은 1건만. §12-0 완료 조건을 실측한 뒤 해제한다.
    const allowance = Math.min(
      LIMIT,
      cap.isFirstRun ? CAPS.firstRun : CAPS.burst,
      CAPS.hardDaily - cap.publishedToday,
    )
    console.log(`  이번 실행 허용: ${allowance}건 (burst ${CAPS.burst} · firstRun ${CAPS.firstRun})\n`)

    // ── ② 픽업 — DB PENDING + origin='live' (§10-1 은 쿼리에서 배제하라고 요구한다) ──
    const rows = await prisma.microSeedCandidate.findMany({
      where: {
        status: 'PENDING',
        attemptCount: { lt: 3 },
        rawContent: { origin: 'live' },
      },
      orderBy: { scheduledPublishAt: 'asc' },
      select: {
        id: true, status: true, attemptCount: true, dedupKey: true,
        founderTitle: true, targetBoardType: true, scheduledPublishAt: true,
        sourceSite: true, sourceUrl: true, sourceArticleId: true, sourceCapturedAt: true,
        createdPostId: true,
        rawContent: { select: { id: true, origin: true, rawBody: true, rawTitle: true } },
      },
    })
    console.log(`  PENDING · origin=live  ${rows.length}건\n`)

    for (const row of rows) {
      if (published >= allowance) {
        skipped.push({ candidateId: row.id, kind: 'CAP', reason: `이번 실행 허용(${allowance}건)을 채웠다` })
        continue
      }

      // ── ③ 예약 유예창 ──────────────────────────────────
      const window = resolvePublishWindow(row.scheduledPublishAt, now)
      if (window.kind === 'TOO_EARLY') {
        skipped.push({ candidateId: row.id, kind: 'TOO_EARLY', reason: window.reason })
        continue
      }
      if (window.kind === 'TOO_LATE' || window.kind === 'NOT_SCHEDULED') {
        // 🔴 시각을 밀지 않는다. HOLD 로 되돌리고 사유를 남긴다.
        if (!DRY_RUN) await demote(prisma, row.id, 'PENDING', 'HOLD', row.attemptCount, window.reason)
        skipped.push({ candidateId: row.id, kind: window.kind, reason: window.reason })
        continue
      }

      if (DRY_RUN) {
        const verdict = await reverify(prisma, row, authorId)
        skipped.push({
          candidateId: row.id,
          kind: verdict.ok ? 'DRY_RUN_WOULD_PUBLISH' : 'DRY_RUN_BLOCKED',
          reason: verdict.ok ? '창 안 · 재판정 통과 — 실제 실행이면 발행한다' : verdict.reason,
        })
        continue
      }

      // ── ④ 원자적 획득 (§6-10 1차 방어) ─────────────────
      const graceFloor = new Date(now.getTime() - PUBLISH_GRACE_MINUTES * 60_000)
      const acquired = await prisma.$executeRawUnsafe(ACQUIRE_CANDIDATE_SQL, row.id, WORKER_ID, now, graceFloor)
      const outcome = interpretAcquireResult(acquired)
      if (outcome.kind === 'ABORT') throw new Error(`획득 결과가 비정상이다: ${outcome.reason}`)
      if (outcome.kind === 'NOT_ACQUIRED_NEEDS_RECLASSIFY') {
        // 🔴 "다른 워커가 가져갔다" 로 단정하지 않는다. 조건이 셋이라 무엇인지 모른다.
        const cur = await prisma.microSeedCandidate.findUnique({
          where: { id: row.id },
          select: { status: true, attemptCount: true, processingBy: true, scheduledPublishAt: true },
        })
        const why = !cur
          ? '후보가 사라졌다'
          : cur.status !== 'PENDING'
            ? `status 가 ${cur.status} 다 (다른 워커: ${cur.processingBy ?? '없음'})`
            : isAttemptExhausted(cur.attemptCount)
              ? `attemptCount 상한 (${cur.attemptCount})`
              : '예약 창을 벗어났다 (판정과 획득 사이에 시각이 흘렀다)'
        skipped.push({ candidateId: row.id, kind: 'NOT_ACQUIRED', reason: why })
        continue
      }

      // ── ⑤ 재판정 — 여기서부터 이 워커가 소유자다 ─────────
      const verdict = await reverify(prisma, row, authorId)
      if (!verdict.ok) {
        const next = await demoteAfterAttempt(prisma, row.id, row.attemptCount, verdict.reason)
        skipped.push({ candidateId: row.id, kind: `REVERIFY_${next}`, reason: verdict.reason })
        if (next === 'FAILED') failed += 1
        continue
      }

      // ── ⑥⑦ Post 생성 + Candidate 갱신 + History — 한 트랜잭션 ──
      const postData = buildMicroSeedPostData({
        boardType: verdict.boardType,
        title: row.founderTitle as string,
        content: verdict.content,
        authorId,
        sheetCandidateId: row.id,
        sourceSite: row.sourceSite,
        sourceUrl: row.sourceUrl,
        sourceArticleId: row.sourceArticleId,
        sourceCapturedAt: row.sourceCapturedAt,
        publishAt: row.scheduledPublishAt,
      })
      // 🔴 create 직전. 함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다 (§6-9-C).
      assertMicroSeedPostData(postData)

      const postId = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({ data: postData, select: { id: true } })
        await tx.microSeedCandidate.update({
          where: { id: row.id },
          data: { createdPostId: post.id, status: 'PUBLISHED', processedAt: new Date() },
        })
        await tx.microSeedCandidateHistory.create({
          data: {
            candidateId: row.id,
            fromStatus: 'PROCESSING',
            toStatus: 'PUBLISHED',
            by: `worker:${WORKER_ID}`,
            reason: `발행 성공 (post=${post.id})`,
          },
        })
        return post.id
      })
      published += 1
      const postUrl = buildPostUrl(verdict.boardType, postId)
      console.log(`  ✅ ${row.id}\n     Post ${postId}\n     ${postUrl}`)

      // ── ⑧ Sheet 역기록 — DB 가 먼저 확정된 뒤에만 ────────
      //    🔴 여기서 실패해도 후보를 되돌리지 않는다. 글은 이미 나갔다.
      //       되돌리면 창업자가 재승인해 이중 발행이 된다 (§6-3).
      //       Sheet 는 PENDING 으로 남고 timeout 복구가 실측으로 정정한다.
      try {
        const write = await updateCandidateRow({
          mode: 'columns',
          tab: SHEET_TAB_NAME,
          rowNumber: await findSheetRow(row.id),
          cells: { status: 'PUBLISHED', postUrl, updatedBySystemAt: kstString(new Date()) },
          expectId: row.id,
        })
        console.log(`     Sheet ${write.ranges.join(', ')} · read-back ${write.readBackVerified ? '검증됨' : '미검증'}\n`)
      } catch (e) {
        console.error(`     ⚠️ Sheet 역기록 실패 (발행은 성공했다): ${e instanceof Error ? e.message : String(e)}`)
        console.error('        후보를 되돌리지 않는다. Sheet 는 PENDING 으로 남고 timeout 복구가 정정한다.\n')
        skipped.push({ candidateId: row.id, kind: 'SHEET_WRITE_FAILED', reason: '발행 성공 · Sheet 미반영' })
      }
    }
  } finally {
    await prisma.$disconnect()
  }

  for (const s of skipped) console.log(`  · ${s.kind}  ${s.candidateId}\n    ${s.reason}`)
  console.log(`\n  발행 ${published}건 · 실패 ${failed}건 · 보류 ${skipped.length}건`)
  if (DRY_RUN) console.log('  🔍 dry-run 이었다. DB·Sheet 에 아무것도 쓰지 않았다.')
  console.log('')
  if (skipped.some((s) => s.kind === 'SHEET_WRITE_FAILED')) process.exit(2)
}

/** 획득 후 재판정 — origin · board · 본문 · guard · author 를 **다시** 본다 */
async function reverify(
  prisma: PrismaClient,
  row: {
    id: string; founderTitle: string | null; targetBoardType: string | null
    rawContent: { origin: string; rawBody: string } | null
  },
  authorId: string,
): Promise<{ ok: true; boardType: BoardType; content: string } | { ok: false; reason: string }> {
  if (!row.rawContent) return { ok: false, reason: '원문이 연결돼 있지 않다 (rawContentId 없음)' }

  // §10-1 · 정책 12 — legacy 는 직접 발행 금지. 쿼리에서 걸렀지만 여기서 한 번 더 본다.
  const origin = verifyPublishableOrigin(row.rawContent.origin)
  if (!origin.ok) return { ok: false, reason: origin.reason }

  const board = resolvePublishableBoard((row.targetBoardType ?? '').toLowerCase())
  if (!board.ok) return { ok: false, reason: board.reason }

  const title = typeof row.founderTitle === 'string' ? row.founderTitle.trim() : ''
  if (!title) return { ok: false, reason: 'founderTitle 이 비었다 (R3)' }

  const content = row.rawContent.rawBody
  if (typeof content !== 'string' || !content.trim()) return { ok: false, reason: '본문이 비었다 (G-A)' }
  if (content.length < MIN_POST_CONTENT_LENGTH) return { ok: false, reason: `본문이 짧다 (${content.length}자, G-A)` }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return { ok: false, reason: `본문이 상한을 넘는다 (${content.length}자). 자르지 않는다 (G-A)` }
  }

  // 🔴 plan 결과를 쓰지 않는다. 진짜 guard 를 여기서 부른다 (§6-9-B).
  const guard = guardMicroSeedCandidate({ founderTitle: title, content })
  if (!guard.ok) return { ok: false, reason: `G-B: ${guard.reason}` }

  // 🔴 작성자를 다시 실측한다. providerId 를 빠뜨리면 verifyPublishAuthor 가 거부한다.
  const user = await prisma.user.findUnique({
    where: { id: authorId },
    select: { id: true, providerId: true, isBlocked: true },
  })
  const author = verifyPublishAuthor({
    id: authorId,
    exists: user !== null,
    providerId: user ? user.providerId : null,
    isBlocked: user ? user.isBlocked : false,
  })
  if (!author.ok) return { ok: false, reason: `작성자: ${author.reason}` }

  return { ok: true, boardType: board.boardType, content }
}

/** 상태를 되돌리고 이력을 남긴다. attemptCount 는 건드리지 않는다 (시도한 적 없는 강등) */
async function demote(
  prisma: PrismaClient,
  candidateId: string,
  from: MicroSeedCandidateStatus,
  to: MicroSeedCandidateStatus,
  _attemptCount: number,
  reason: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.microSeedCandidate.update({
      where: { id: candidateId },
      data: { status: to, holdReason: reason },
    })
    await tx.microSeedCandidateHistory.create({
      data: { candidateId, fromStatus: from, toStatus: to, by: `worker:${WORKER_ID}`, reason },
    })
  })
}

/**
 * 획득 후 실패 — attemptCount 를 올리고 HOLD 또는 FAILED 로 보낸다.
 *
 * 🔴 PENDING 으로 되돌리지 않는다 (§5-4 · 정책 14). 사람 승인 없이 다시 집힌다.
 */
async function demoteAfterAttempt(
  prisma: PrismaClient,
  candidateId: string,
  attemptCount: number,
  reason: string,
): Promise<'HOLD' | 'FAILED'> {
  const next = attemptCount + 1
  const to: 'HOLD' | 'FAILED' = isAttemptExhausted(next) ? 'FAILED' : 'HOLD'
  const detail = `${reason} (시도 ${next}/3)`
  await prisma.$transaction(async (tx) => {
    await tx.microSeedCandidate.update({
      where: { id: candidateId },
      data: {
        status: to,
        attemptCount: next,
        processedAt: new Date(),
        ...(to === 'FAILED' ? { failureReason: detail } : { holdReason: detail }),
      },
    })
    await tx.microSeedCandidateHistory.create({
      data: { candidateId, fromStatus: 'PROCESSING', toStatus: to, by: `worker:${WORKER_ID}`, reason: detail },
    })
  })
  return to
}

/** Sheet 에서 이 후보의 행 번호를 찾는다. 행 번호는 정렬로 흔들리므로 매번 실측한다 (§6-4) */
async function findSheetRow(candidateId: string): Promise<number> {
  const { createGoogleSheetSource } = await import('./lib/micro-seed-sheet.mjs')
  const source = await createGoogleSheetSource({ tab: SHEET_TAB_NAME })
  const { rows } = await source.fetchRows()
  const idx = (rows as unknown[][]).findIndex((r) => String(r?.[SHEET_HEADERS.indexOf('candidateId')] ?? '').trim() === candidateId)
  if (idx === -1) throw new Error(`Sheet 에서 후보 행을 찾지 못했다: ${candidateId}`)
  return idx + 2 // 헤더가 1행, fetchRows 는 헤더를 뺀 배열을 준다
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
