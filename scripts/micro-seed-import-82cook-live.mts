#!/usr/bin/env tsx
/**
 * 82cook 수집분 → Micro Seed 원장 적재 (importer)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-9 · §6-10
 *
 * 수집(JSONL) → MicroSeedRawContent + MicroSeedCandidate + Sheet A:Q row.
 * **여기가 이 레일에서 DB·Sheet write 가 처음 생기는 지점**이다.
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=1` 이 **둘 다** 있어야 한다
 *    적재는 되돌리기 번거롭다 — DB 두 테이블과 Sheet 한 행이 함께 생기고,
 *    그 뒤 창업자 승인 → 발행으로 이어지는 경로의 첫 칸이다.
 *    스위치를 두 개 요구하면 크론이나 오타로 도는 일이 없다.
 *
 * 🔴 발행하지 않는다
 *    status 는 HOLD 로만 만든다. PENDING · PUBLISHED 로 가는 경로가 이 파일에 없다.
 *    승인은 사람이 Sheet 에서 하고(§6-7-A), 발행은 publisher 가 따로 한다.
 *
 * 🔴 멱등하다
 *    DB(sourceSite+sourceArticleId · dedupKey)와 Sheet(candidateId · dedupKey)를
 *    쓰기 **전에** 확인한다. 이미 있으면 SKIP 이고 오류가 아니다 —
 *    같은 명령을 두 번 돌려도 원장이 두 벌 생기지 않아야 한다.
 *
 * 사용법
 *   npm run micro-seed:import-82cook                                   진단만
 *   npm run micro-seed:import-82cook -- --sourceArticleId=4231968      대상 지정
 *   npm run micro-seed:import-82cook -- --apply --limit=1              실제 적재
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { guardMicroSeedCandidate } from '../src/lib/micro-seed-guard'
import { MIN_POST_CONTENT_LENGTH, MAX_POST_CONTENT_LENGTH, MIN_POST_TITLE_LENGTH, MAX_POST_TITLE_LENGTH } from '../src/lib/post-policy'
import { SOURCE_SITE, computeDedupKey, type CollectedCandidate } from './lib/micro-seed-82cook.mjs'
import {
  SHEET_HEADERS, SHEET_TAB_NAME, buildSheetRow, createGoogleSheetSource, updateCandidateRow,
} from './lib/micro-seed-sheet.mjs'
import { loadEnvLocal, kstString, roundUpToFiveMinutes, utcWallClock } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const arg = (n: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const INPUT = arg('input') ?? './.microseed-data/82cook.jsonl'
const ONLY_ID = arg('sourceArticleId')
const LIMIT_RAW = arg('limit')
const LIMIT = LIMIT_RAW === undefined ? null : Number(LIMIT_RAW)

/** 🔴 board 는 free 고정 (§6-9-D 화이트리스트). magazine·best 로 갈 경로를 만들지 않는다 */
const BOARD_SHEET_VALUE = 'free'
const BOARD_TYPE = 'FREE' as const

/**
 * 예약 **제안값** 기본 간격 (분).
 *
 * 🔴 확정이 아니라 제안이다. scheduledPublishAt 은 창업자 편집 칸이고(§6-7-A),
 *    시스템이 정할 값이 아니다. 다만 **비워 두면 매 발행마다 reschedule 을 따로 돌려야 하고
 *    그때부터 20분을 기다린다** — 적재 시점에 값을 넣어 두면 그 대기가 절차에 흡수된다.
 *
 *    창업자는 Sheet F열에서 언제든 고칠 수 있고, micro-seed:reschedule-live 로도 밀 수 있다.
 *
 * 🔴 25분인 이유: 승인(Sheet PENDING) → sync-approval → publish dry-run 까지가
 *    보통 몇 분이고, publisher 유예창이 도래 후 30분이다. 25분이면 승인을 마치고
 *    창이 열린 뒤 여유 있게 발행할 수 있다.
 */
const SCHEDULE_DEFAULT_MINUTES = 25
const NO_SCHEDULE = process.argv.includes('--no-schedule')
const SCHEDULE_MINUTES = (() => {
  const hit = process.argv.find((a) => a.startsWith('--in='))
  if (!hit) return SCHEDULE_DEFAULT_MINUTES
  const n = Number(hit.slice(5))
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--in 은 양수 분이어야 한다: ${hit}`)
  return n
})()
/** 🔴 적재는 HOLD 로만 한다. 승인은 사람이 Sheet 에서 (§6-7-A) */
const INITIAL_STATUS = 'HOLD' as const

type Diagnostic = { kind: string; sourceArticleId?: string; message: string }

async function main() {
  await loadEnvLocal()
  const now = new Date()
  const diagnostics: Diagnostic[] = []

  console.log('\nMicro Seed importer — 82cook')
  console.log(`  입력 ${INPUT} · ${kstString(now)} KST`)
  console.log(`  적재 규칙: RawContent origin=live · Candidate ${INITIAL_STATUS} · board=${BOARD_SHEET_VALUE}(${BOARD_TYPE}) · postUrl/updatedBySystemAt 공란`)

  // 🔴 예약은 **제안값**이다. status 는 HOLD 이고 창업자가 F열에서 고칠 수 있다.
  const proposed = NO_SCHEDULE ? null : roundUpToFiveMinutes(new Date(now.getTime() + SCHEDULE_MINUTES * 60_000))
  if (proposed) {
    console.log(`  예약 제안: ${kstString(proposed)} KST (= ${utcWallClock(proposed)} UTC) · 지금 +${SCHEDULE_MINUTES}분, 5분 올림`)
    console.log('             ⚠️ 제안값이다. status 는 HOLD 이고 창업자가 Sheet F열에서 수정할 수 있다')
  } else {
    console.log('  예약 제안: 없음 (--no-schedule) — 창업자가 Sheet F열에 직접 적는다')
  }
  console.log(
    APPLY && LIMIT === 1
      ? '  🔴 --apply --limit=1 : 실제로 적재한다\n'
      : '  🔍 dry-run — DB · Sheet write 없음 (실제 적재는 --apply --limit=1 둘 다 필요)\n',
  )
  console.log('  🔴 발행하지 않는다: PENDING · PUBLISHED 전환 없음 · Post 생성 없음\n')

  // ── ① 입력 읽기 + dedupKey 중복 접기 ──────────────────
  if (!existsSync(INPUT)) {
    console.error(`  🛑 입력 파일이 없다: ${INPUT}\n`)
    process.exit(1)
  }
  const lines = readFileSync(INPUT, 'utf-8').split('\n').filter(Boolean)
  const byKey = new Map<string, CollectedCandidate>()
  for (const line of lines) {
    let row: CollectedCandidate
    try {
      row = JSON.parse(line) as CollectedCandidate
    } catch {
      diagnostics.push({ kind: 'PARSE_FAILED', message: 'JSON 파싱 실패한 줄이 있다' })
      continue
    }
    if (!row?.dedupKey) {
      diagnostics.push({ kind: 'NO_DEDUP_KEY', sourceArticleId: row?.sourceArticleId, message: 'dedupKey 가 없다' })
      continue
    }
    // 🔴 중복은 오류가 아니다 — JSONL 은 append 라 같은 후보가 여러 줄일 수 있다.
    //    같은 dedupKey 는 **뒤에 온 것(최신)** 을 쓴다.
    if (byKey.has(row.dedupKey)) {
      diagnostics.push({ kind: 'DUPLICATE_IN_JSONL', sourceArticleId: row.sourceArticleId, message: '같은 dedupKey 가 여러 줄이다. 최신 1건만 쓴다' })
    }
    byKey.set(row.dedupKey, row)
  }
  let rows = [...byKey.values()]
  console.log(`  입력 ${lines.length}줄 → dedup 후 ${rows.length}건`)

  if (ONLY_ID) {
    rows = rows.filter((r) => r.sourceArticleId === ONLY_ID)
    console.log(`  --sourceArticleId=${ONLY_ID} → ${rows.length}건\n`)
  } else {
    console.log('')
  }
  if (!rows.length) {
    console.log('  적재할 것이 없다.\n')
    return
  }

  const prisma = new PrismaClient()
  let imported = 0
  let skipped = 0
  try {
    // ── ② Sheet 를 한 번만 읽는다 (중복 검사 + 빈 행 찾기) ──
    const source = await createGoogleSheetSource({ tab: SHEET_TAB_NAME })
    const { rows: sheetRows } = (await source.fetchRows()) as { rows: unknown[][] }
    const idCol = SHEET_HEADERS.indexOf('candidateId')
    const keyCol = SHEET_HEADERS.indexOf('dedupKey')
    const sheetIds = new Set<string>()
    const sheetKeys = new Set<string>()
    sheetRows.forEach((r) => {
      const id = String(r?.[idCol] ?? '').trim()
      const k = String(r?.[keyCol] ?? '').trim()
      if (id) sheetIds.add(id)
      if (k) sheetKeys.add(k)
    })
    // 🔴 append 하지 않는다. 빈 첫 행을 찾아 그 자리에 bootstrap 으로 쓴다.
    let nextRowNumber = sheetRows.findIndex((r) => !String(r?.[idCol] ?? '').trim()) + 2
    if (nextRowNumber === 1) nextRowNumber = sheetRows.length + 2 // 빈 행이 없으면 맨 끝 다음
    console.log(`  Sheet 행 ${sheetRows.length}건 · 다음 빈 행 ${nextRowNumber}\n`)

    for (const row of rows) {
      const id = row.sourceArticleId
      const fail = (msg: string) => {
        console.log(`  ⛔ ${id} — ${msg}`)
        diagnostics.push({ kind: 'REJECTED', sourceArticleId: id, message: msg })
        skipped += 1
      }

      // ── ③ 입력 검증 ──────────────────────────────────
      if (row.sourceSite !== SOURCE_SITE) {
        fail(`sourceSite 가 ${SOURCE_SITE} 가 아니다: ${JSON.stringify(row.sourceSite)}`)
        continue
      }
      const expectKey = computeDedupKey(row.sourceSite, id)
      if (row.dedupKey !== expectKey) {
        fail(`dedupKey 가 재계산과 다르다 (${row.dedupKey} ≠ ${expectKey})`)
        continue
      }
      const rawBody = typeof row.rawBody === 'string' ? row.rawBody : ''
      if (!rawBody.trim()) {
        // 목록 JSONL 을 잘못 넘긴 경우가 여기로 온다.
        fail('rawBody 가 비었다. 목록 파일이 아니라 상세 fetch 산출물을 준다')
        continue
      }
      if (rawBody.length < MIN_POST_CONTENT_LENGTH || rawBody.length > MAX_POST_CONTENT_LENGTH) {
        fail(`rawBody 길이가 범위 밖이다 (${rawBody.length}자, G-A)`)
        continue
      }
      // 🔴 founderTitle 을 임의로 다듬지 않는다. 원제를 그대로 두고 길이·금칙어만 본다 —
      //    제목을 고치는 것은 창업자 편집 칸의 일이다 (§6-7-A).
      const founderTitle = (row.originalTitle ?? '').trim()
      if (founderTitle.length < MIN_POST_TITLE_LENGTH || founderTitle.length > MAX_POST_TITLE_LENGTH) {
        fail(`제목 길이가 범위 밖이다 (${founderTitle.length}자, R3)`)
        continue
      }
      const guard = guardMicroSeedCandidate({ founderTitle, content: rawBody })
      if (!guard.ok) {
        fail(`G-B: ${guard.reason}`)
        continue
      }

      // ── ④ 멱등성 — DB · Sheet 를 쓰기 전에 본다 ──────
      const dbHit = await prisma.microSeedCandidate.findFirst({
        where: { OR: [{ dedupKey: row.dedupKey }, { AND: [{ sourceSite: row.sourceSite }, { sourceArticleId: id }] }] },
        select: { id: true, status: true },
      })
      if (dbHit) {
        console.log(`  ⏭️  ${id} — 이미 원장에 있다 (candidate=${dbHit.id} · ${dbHit.status}). SKIP`)
        diagnostics.push({ kind: 'ALREADY_IN_DB', sourceArticleId: id, message: `candidate=${dbHit.id}` })
        skipped += 1
        continue
      }
      const rawHit = await prisma.microSeedRawContent.findFirst({
        where: { sourceSite: row.sourceSite, sourceArticleId: id },
        select: { id: true },
      })
      if (rawHit) {
        console.log(`  ⏭️  ${id} — 원문이 이미 있다 (raw=${rawHit.id}). SKIP`)
        diagnostics.push({ kind: 'ALREADY_IN_DB', sourceArticleId: id, message: `raw=${rawHit.id}` })
        skipped += 1
        continue
      }
      if (sheetKeys.has(row.dedupKey)) {
        console.log(`  ⏭️  ${id} — Sheet 에 같은 dedupKey 가 있다. SKIP`)
        diagnostics.push({ kind: 'ALREADY_IN_SHEET', sourceArticleId: id, message: 'dedupKey 중복' })
        skipped += 1
        continue
      }

      // ── ⑤ 적재 ───────────────────────────────────────
      const candidateId = randomUUID()
      const rawContentId = randomUUID()
      const capturedAt = new Date(row.sourceCapturedAt)
      if (Number.isNaN(capturedAt.getTime())) {
        fail(`sourceCapturedAt 을 읽지 못했다: ${JSON.stringify(row.sourceCapturedAt)}`)
        continue
      }

      const sheetValues = buildSheetRow({
        candidateId,
        status: INITIAL_STATUS,
        board: BOARD_SHEET_VALUE,
        founderTitle,
        originalTitle: row.originalTitle,
        // 🔴 제안값이다 (§6-7-A 편집 칸 — 창업자가 고칠 수 있다).
        //    --no-schedule 이면 비운다.
        scheduledPublishAt: proposed ? kstString(proposed) : '',
        sourceSite: row.sourceSite,
        sourceUrl: row.sourceUrl,
        sourceArticleId: id,
        sourceBoardName: row.sourceBoardName,
        sourceCommentCount: row.sourceCommentCount,
        sourceCapturedAt: kstString(capturedAt),
        dedupKey: row.dedupKey,
        holdReason: '',
        declineReason: '',
        postUrl: '',            // 🔴 발행 전 공란 강제
        updatedBySystemAt: '',  // 🔴 발행 전 공란 강제
      })

      if (!APPLY || LIMIT !== 1) {
        console.log(`  🔍 ${id} — 적재 예정`)
        console.log(`     candidate=${candidateId}`)
        console.log(`     raw=${rawContentId} · origin=live · ${rawBody.length}자`)
        console.log(`     Sheet 행 ${nextRowNumber} · status=${INITIAL_STATUS} · board=${BOARD_SHEET_VALUE}`)
        console.log(
          proposed
            ? `     예약 제안 ${kstString(proposed)} KST (= ${utcWallClock(proposed)} UTC) · F열에 들어간다`
            : '     예약 없음 (--no-schedule)',
        )
        imported += 1
        continue
      }

      // DB — RawContent 와 Candidate 를 한 트랜잭션으로 (부분 적재를 만들지 않는다)
      await prisma.$transaction(async (tx) => {
        await tx.microSeedRawContent.create({
          data: {
            id: rawContentId,
            origin: 'live',
            sourceSite: row.sourceSite,
            sourceUrl: row.sourceUrl,
            sourceArticleId: id,
            sourceCapturedAt: capturedAt,
            rawTitle: row.originalTitle,
            rawBody,
          },
        })
        await tx.microSeedCandidate.create({
          data: {
            id: candidateId,
            status: INITIAL_STATUS,
            sourceSite: row.sourceSite,
            sourceUrl: row.sourceUrl,
            sourceArticleId: id,
            sourceBoardName: row.sourceBoardName,
            sourceCommentCount: row.sourceCommentCount,
            sourceCapturedAt: capturedAt,
            rawContentId,
            dedupKey: row.dedupKey,
            originalTitle: row.originalTitle,
            founderTitle,
            targetBoardType: BOARD_TYPE,
            // 🔴 제안값. Prisma 가 UTC 로 저장하고 Sheet 에는 같은 순간을 KST 로 적는다.
            scheduledPublishAt: proposed,
          },
        })
      })
      console.log(`  ✅ ${id} — DB 적재 (candidate=${candidateId} · raw=${rawContentId})`)

      // Sheet — bootstrap 모드 · read-back 내장
      const write = await updateCandidateRow({
        mode: 'bootstrap', tab: SHEET_TAB_NAME, rowNumber: nextRowNumber, values: sheetValues, expectId: candidateId,
      })
      console.log(`     Sheet ${write.ranges.join(', ')} · ${write.updatedCells}셀 · read-back ${write.readBackVerified ? '검증됨' : '미검증'}`)

      // ── ⑥ 예약·상태 read-back — DB 와 Sheet 가 같은 순간인지 본다 ──
      //
      // 🔴 updateCandidateRow 의 read-back 은 "쓴 값이 시트에 있는가" 만 본다.
      //    DB 와 **같은 순간**인지는 별개다 — KST 문자열과 UTC timestamp 를 각각 쓰므로
      //    한쪽만 어긋나도 승인·발행이 다른 시각을 보게 된다.
      const back = await prisma.microSeedCandidate.findUniqueOrThrow({
        where: { id: candidateId },
        select: { status: true, scheduledPublishAt: true },
      })
      const dbKst = back.scheduledPublishAt ? kstString(back.scheduledPublishAt) : ''
      const sheetKst = sheetValues[SHEET_HEADERS.indexOf('scheduledPublishAt')] as string
      if (dbKst !== sheetKst) {
        throw new Error(
          `예약 read-back 불일치: DB=${dbKst || '(비어 있음)'} · Sheet=${sheetKst || '(비어 있음)'}. ` +
            'DB 가 정본이다. Sheet F열을 맞춘 뒤 다시 확인한다',
        )
      }
      if (back.status !== INITIAL_STATUS) {
        throw new Error(`status read-back 불일치: ${back.status} (기대 ${INITIAL_STATUS})`)
      }
      console.log(
        `     read-back ✅ status=${back.status} · 예약 ${dbKst || '(비어 있음)'} KST` +
          `${back.scheduledPublishAt ? ` (= ${utcWallClock(back.scheduledPublishAt)} UTC)` : ''} · DB=Sheet 일치`,
      )
      nextRowNumber += 1
      sheetKeys.add(row.dedupKey)
      sheetIds.add(candidateId)
      imported += 1
    }
  } finally {
    await prisma.$disconnect()
  }

  if (diagnostics.length) {
    console.log('\n  진단')
    for (const d of diagnostics) console.log(`     · ${d.kind} ${d.sourceArticleId ?? ''} — ${d.message}`)
  }
  console.log(`\n  ${APPLY && LIMIT === 1 ? '적재' : '적재 예정'} ${imported}건 · SKIP ${skipped}건`)
  if (!(APPLY && LIMIT === 1)) {
    console.log('  🔍 dry-run 이었다. DB · Sheet 에 아무것도 쓰지 않았다.')
    if (APPLY && LIMIT !== 1) console.log('     (--apply 를 줬지만 --limit=1 이 없어 적재하지 않았다)')
  } else {
    console.log('  🔴 status 는 HOLD 다. 승인은 Sheet 에서 사람이 하고, 발행은 publisher 가 따로 한다.')
  }
  console.log('')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
