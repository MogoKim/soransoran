#!/usr/bin/env tsx
/**
 * 82cook 수집분 → Micro Seed 원장 적재 (importer)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-9 · §6-10
 *
 * 수집(JSONL) → MicroSeedRawContent + MicroSeedCandidate + Sheet A:Q row.
 * **여기가 이 레일에서 DB·Sheet write 가 처음 생기는 지점**이다.
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 **스위치 두 개**가 있어야 한다
 *    적재는 되돌리기 번거롭다. 스위치를 두 개 요구하면 크론이나 오타로 도는 일이 없다.
 *
 * 🔴 **레인이 둘이고 상한이 다르다** (PR-S2)
 *
 *      Micro Seed 레인   --apply --limit=1
 *        RawContent + Candidate(HOLD) + Sheet 행 1개
 *        🔴 여전히 1건이다 — Sheet 는 창업자가 읽는 승인 게이트다.
 *           한 번에 50행이 꽂히면 그 화면은 게이트로서 기능하지 않는다.
 *
 *      Original Post 공급   --apply --raw-only --batch=N   (N ≤ 50)
 *        RawContent 만
 *        🔴 Candidate 를 만들지 않고 Sheet 를 건드리지 않는다.
 *           Original Post 레인은 Raw 를 **재료로만** 쓰고 승인은
 *           OriginalPostApprovalQueue 에서 따로 받는다 —
 *           그 레인에 Sheet 행은 아무 역할이 없다.
 *
 *    두 레인을 섞은 명령은 **거부한다** (`--raw-only --limit` · `--batch` 단독).
 *    규칙은 scripts/lib/micro-seed-supply.mts 가 정하고 fixture 가 검증한다.
 *
 * 🔴 발행하지 않는다
 *    status 는 HOLD 로만 만든다. PENDING · PUBLISHED 로 가는 경로가 이 파일에 없다.
 *    raw-only 는 Candidate 자체를 만들지 않으므로 더 멀다.
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
 *   npm run micro-seed:import-82cook -- --apply --limit=1              Micro Seed 적재
 *   npm run micro-seed:import-82cook -- --raw-only --batch=30          raw-only dry-run
 *   npm run micro-seed:import-82cook -- --apply --raw-only --batch=30  🔴 Raw Vault 적재
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
import {
  planSupplyMode, violatesSupplyInvariant, judgeAutoHold,
  RAW_ONLY_BATCH_MAX, AUTO_HOLD_DETAIL_FLAGS,
} from './lib/micro-seed-supply.mjs'
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
const RAW_ONLY = process.argv.includes('--raw-only')
const BATCH_RAW = arg('batch')
const BATCH = BATCH_RAW === undefined ? null : Number(BATCH_RAW)

// 🔴 모드 판정은 순수 함수가 한다. 여기서 조건을 다시 쓰지 않는다 —
//    두 곳에 쓰면 언젠가 갈라지고, 갈라지는 쪽이 Sheet 에 50행을 꽂는다.
const PLAN = planSupplyMode({ apply: APPLY, limit: LIMIT, rawOnly: RAW_ONLY, batch: BATCH })
if (PLAN.fatal !== null) {
  console.error(`\n🛑 ${PLAN.fatal}\n`)
  process.exit(1)
}
if (violatesSupplyInvariant(PLAN)) {
  console.error('\n🛑 적재 계획이 불변식을 위반했다. 실행하지 않는다.\n')
  process.exit(1)
}
const WRITE_DB = PLAN.mode !== 'dry-run'
const WRITE_SHEET = PLAN.writes.sheet

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
 * 🔴 8분인 이유 — 세 번째 발행 실측(2026-08-26)이 근거다
 *
 *    처음엔 25분으로 잡았다. "승인 → sync-approval → publish dry-run 까지 보통 몇 분" 이라는
 *    가정이었는데, **실측은 80초였다.** 그 결과 발행까지 28분을 기다려야 했고,
 *    reschedule --in=5 로 당겨서야 실제 대기가 4분이 됐다(총 소요 10분 53초).
 *
 *    기본값이 실제 소요보다 크면 매번 reschedule 을 한 번 더 돌리게 된다 —
 *    그 명령을 없애려고 만든 값이 다시 그 명령을 부르는 셈이다.
 *
 *    8분은 승인 80초에 여유를 6배 이상 준 값이다. 유예창이 도래 후 30분이라
 *    조금 늦어져도 창을 놓치지 않는다.
 *
 * 🔴 창업자가 직접 천천히 승인할 때는 --in=30 을 쓴다.
 *    이 값은 **Claude 대행 운영 기준**이다. 사람이 Sheet 를 열어 읽고 판단하는 흐름이면
 *    8분은 짧다 — 그때는 명시적으로 늘린다.
 */
const SCHEDULE_DEFAULT_MINUTES = 8
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

  const laneLabel = RAW_ONLY ? 'Original Post 공급 (raw-only)' : 'Micro Seed 레인'
  console.log('\nMicro Seed importer — 82cook')
  console.log(`  입력 ${INPUT} · ${kstString(now)} KST`)
  console.log(`  레인 ${laneLabel}`)
  console.log(
    RAW_ONLY
      ? '  적재 규칙: RawContent origin=live 만 — 🔴 Candidate 없음 · Sheet write 없음'
      : `  적재 규칙: RawContent origin=live · Candidate ${INITIAL_STATUS} · board=${BOARD_SHEET_VALUE}(${BOARD_TYPE}) · postUrl/updatedBySystemAt 공란`,
  )

  // 🔴 예약은 **제안값**이다. status 는 HOLD 이고 창업자가 F열에서 고칠 수 있다.
  //    raw-only 는 Candidate 를 만들지 않으므로 예약 자체가 없다.
  const proposed = RAW_ONLY || NO_SCHEDULE
    ? null
    : roundUpToFiveMinutes(new Date(now.getTime() + SCHEDULE_MINUTES * 60_000))
  if (RAW_ONLY) {
    console.log('  예약 제안: 해당 없음 — raw-only 는 Candidate 를 만들지 않는다')
  } else if (proposed) {
    console.log(`  예약 제안: ${kstString(proposed)} KST (= ${utcWallClock(proposed)} UTC) · 지금 +${SCHEDULE_MINUTES}분, 5분 올림`)
    console.log('             ⚠️ 제안값이다. status 는 HOLD 이고 창업자가 Sheet F열에서 수정할 수 있다')
  } else {
    console.log('  예약 제안: 없음 (--no-schedule) — 창업자가 Sheet F열에 직접 적는다')
  }
  console.log(
    WRITE_DB
      ? `  🔴 실제 적재 · 모드 ${PLAN.mode} · 이번 실행 최대 ${PLAN.take}건\n`
      : `  🔍 dry-run — DB · Sheet write 없음\n`,
  )
  for (const n of PLAN.notes) console.log(`     · ${n}`)
  console.log('')
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
  /** 🔴 자동 보류. SKIP 과 따로 센다 — 이유가 다르면 숫자도 달라야 한다 */
  let held = 0
  try {
    // ── ② Sheet 를 한 번만 읽는다 (중복 검사 + 빈 행 찾기) ──
    //
    // 🔴 raw-only 는 Sheet 를 **읽지도 않는다.** 읽기만 해도 자격 증명이 필요하고,
    //    그 경로가 살아 있으면 언젠가 쓰기로 이어진다. 레인을 나눈 이유가 사라진다.
    const sheetIds = new Set<string>()
    const sheetKeys = new Set<string>()
    let nextRowNumber = 0
    if (RAW_ONLY) {
      console.log('  Sheet: 접근하지 않는다 (raw-only)\n')
    } else {
      const source = await createGoogleSheetSource({ tab: SHEET_TAB_NAME })
      const { rows: sheetRows } = (await source.fetchRows()) as { rows: unknown[][] }
      const idCol = SHEET_HEADERS.indexOf('candidateId')
      const keyCol = SHEET_HEADERS.indexOf('dedupKey')
      sheetRows.forEach((r) => {
        const id = String(r?.[idCol] ?? '').trim()
        const k = String(r?.[keyCol] ?? '').trim()
        if (id) sheetIds.add(id)
        if (k) sheetKeys.add(k)
      })
      // 🔴 append 하지 않는다. 빈 첫 행을 찾아 그 자리에 bootstrap 으로 쓴다.
      nextRowNumber = sheetRows.findIndex((r) => !String(r?.[idCol] ?? '').trim()) + 2
      if (nextRowNumber === 1) nextRowNumber = sheetRows.length + 2 // 빈 행이 없으면 맨 끝 다음
      console.log(`  Sheet 행 ${sheetRows.length}건 · 다음 빈 행 ${nextRowNumber}\n`)
    }

    for (const row of rows) {
      // 🔴 이번 실행 상한. dry-run 은 전체를 보여주되 실제 적재는 take 에서 멈춘다.
      if (WRITE_DB && imported >= PLAN.take) {
        console.log(`  ⏸  이번 실행 상한 ${PLAN.take}건에 도달했다. 나머지는 다음 실행에서 적재한다`)
        break
      }
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
      // ── ④-b 자동 보류 — 상세 플래그를 여기서 본다 (PR-S2-a) ──
      //
      // 🔴 자동 경로에만 적용한다. `--sourceArticleId` 로 지목한 것은 사람의 판단이다.
      //    보류는 삭제가 아니다 — 상세 JSONL 의 원자료는 그대로 남는다.
      if (RAW_ONLY) {
        const verdict = judgeAutoHold({
          sourceArticleId: id,
          flags: Array.isArray(row.qualityFlags) ? row.qualityFlags : [],
          humanDesignated: ONLY_ID === id,
        })
        if (verdict.hold) {
          console.log(`  🟡 ${id} — ${verdict.detail}`)
          diagnostics.push({ kind: 'AUTO_HELD', sourceArticleId: id, message: verdict.flags.join('·') })
          held += 1
          continue
        }
      }

      // 🔴 raw-only 는 Sheet 를 읽지 않았으므로 이 검사도 하지 않는다.
      //    Raw Vault 의 멱등성은 위 rawHit(@@unique[sourceSite,sourceArticleId])이 보장한다.
      if (!RAW_ONLY && sheetKeys.has(row.dedupKey)) {
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

      // 🔴 raw-only 는 Sheet 행을 조립하지도 않는다. 만들어 두면 언젠가 누가 쓴다.
      const sheetValues = RAW_ONLY ? [] : buildSheetRow({
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

      if (!WRITE_DB) {
        console.log(`  🔍 ${id} — 적재 예정`)
        console.log(`     raw=${rawContentId} · origin=live · ${rawBody.length}자`)
        if (RAW_ONLY) {
          console.log('     🔴 raw-only — Candidate 없음 · Sheet 행 없음')
        } else {
          console.log(`     candidate=${candidateId}`)
          console.log(`     Sheet 행 ${nextRowNumber} · status=${INITIAL_STATUS} · board=${BOARD_SHEET_VALUE}`)
          console.log(
            proposed
              ? `     예약 제안 ${kstString(proposed)} KST (= ${utcWallClock(proposed)} UTC) · F열에 들어간다`
              : '     예약 없음 (--no-schedule)',
          )
        }
        imported += 1
        continue
      }

      // ── raw-only — RawContent 하나만 만든다 ────────────
      //
      // 🔴 트랜잭션을 쓰지 않는다. write 가 하나뿐이라 나눠질 부분이 없다 —
      //    없는 원자성을 흉내 내면 다음 사람이 "여기 두 개가 들어가는구나" 로 읽는다.
      if (RAW_ONLY) {
        await prisma.microSeedRawContent.create({
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
        console.log(`  ✅ ${id} — Raw Vault 적재 (raw=${rawContentId} · ${rawBody.length}자) · Candidate 0 · Sheet 0`)
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
  console.log(
    `\n  ${WRITE_DB ? '적재' : '적재 예정'} ${imported}건 · SKIP ${skipped}건` +
      (RAW_ONLY ? ` · 🟡 자동 보류 ${held}건` : ''),
  )
  if (RAW_ONLY && held > 0) {
    console.log(`     보류 기준: ${AUTO_HOLD_DETAIL_FLAGS.join(' · ')} (상세 단계 플래그)`)
    console.log('     🔴 삭제가 아니다 — 상세 JSONL 원자료는 남아 있다.')
    console.log('     넣으려면 사람이 --sourceArticleId=<id> 로 지목한다.')
  }
  if (!WRITE_DB) {
    console.log('  🔍 dry-run 이었다. DB · Sheet 에 아무것도 쓰지 않았다.')
    if (APPLY) {
      console.log(
        RAW_ONLY
          ? `     (--apply 를 줬지만 --batch=N(1~${RAW_ONLY_BATCH_MAX}) 이 없어 적재하지 않았다)`
          : '     (--apply 를 줬지만 --limit=1 이 없어 적재하지 않았다)',
      )
    }
  } else if (RAW_ONLY) {
    console.log(`  🔴 Raw Vault 에만 적재했다 — Candidate 0 · Sheet write 0 · Post 0.`)
    console.log('     이 원문은 Original Post 생성기(original-post-generate)가 재료로 읽는다.')
    console.log('     Micro Seed 레인으로 보내려면 --raw-only 없이 --apply --limit=1 을 따로 돌린다.')
  } else {
    console.log('  🔴 status 는 HOLD 다. 승인은 Sheet 에서 사람이 하고, 발행은 publisher 가 따로 한다.')
  }
  console.log('')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
