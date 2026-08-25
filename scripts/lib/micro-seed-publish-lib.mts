/**
 * Micro Seed 발행·복구 공용 라이브러리
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-1 · §6-3 · §6-7-A
 *
 * 🔴 왜 이 파일이 생겼는가
 *    publisher 안에 비-export 로 있던 네 함수(buildPostUrl · demote · syncSheet ·
 *    findSheetRow)를 recover scanner(R-2)가 그대로 필요로 한다. 복사하면 두 곳이 갈라지고,
 *    갈라진 쪽은 "한쪽은 통과, 한쪽은 차단" 이 되어 가장 늦게 발견된다 (C-2).
 *    오늘 SHEET_WRITABLE_COLUMNS 복제에서 이미 겪은 문제다.
 *
 * 🔴 여기 있는 것은 **DB 상태 전이와 그 Sheet 반영**뿐이다.
 *    Post 를 만들지 않는다 — Post 생성은 publisher 의 성공 경로 하나뿐이며
 *    이 파일에 옮기지 않는다. 입구가 늘어나면 §6-9-C 의 3축 강제를 우회할 자리가 생긴다.
 */
import type { PrismaClient, BoardType, MicroSeedCandidateStatus } from '@prisma/client'
import { getBoardByType } from '../../src/lib/board-registry'
import { SITE } from '../../src/lib/brand'
import {
  buildSheetWriteCells,
  verifySheetWriteColumns,
  type PublishOutcome,
} from '../../src/lib/micro-seed-write-guard'
import { SHEET_TAB_NAME, SHEET_HEADERS, updateCandidateRow, createGoogleSheetSource } from './micro-seed-sheet.mjs'

/** DB 는 바뀌었는데 Sheet 반영에 실패한 후보. 사람이 손으로 맞춰야 한다 */
export type Divergence = {
  candidateId: string
  dbStatus: string
  sheetStatus: string
  reason: string
}

/**
 * 발행된 글의 공개 URL. §6-1 — Post.id 는 DB 가 발급하고 Sheet 가 기록한다.
 *
 * 🔴 던질 수 있다. 부르는 쪽은 **Post 생성 뒤** 이 함수가 실패해도 divergence 로
 *    잡히도록 감싸야 한다 — 감싸지 않으면 DB=PUBLISHED · Sheet=PENDING 이
 *    로그에도 목록에도 남지 않고 조용히 사라진다(2026-08-25 감사에서 발견).
 */
export function buildPostUrl(boardType: BoardType, postId: string): string {
  const board = getBoardByType(boardType)
  if (!board) throw new Error(`board slug 를 찾지 못했다: ${boardType}`)
  return `${SITE.url}/community/${board.slug}/${postId}`
}

/**
 * Sheet 에서 이 후보의 행 번호를 찾는다.
 *
 * 🔴 행 번호는 정렬·삽입으로 흔들리므로 매번 실측한다 (§6-4).
 *    candidateId 가 행 번호를 대신하는 이유가 그것이다.
 *
 * @param rows 이미 읽어 둔 탭 내용(헤더 제외). 주면 API 를 다시 부르지 않는다 —
 *             전수 대조(R-2)는 탭을 한 번만 읽어야 한다
 */
export async function findSheetRow(candidateId: string, rows?: unknown[][]): Promise<number> {
  const body =
    rows ?? ((await (await createGoogleSheetSource({ tab: SHEET_TAB_NAME })).fetchRows()).rows as unknown[][])
  const idx = body.findIndex(
    (r) => String(r?.[SHEET_HEADERS.indexOf('candidateId')] ?? '').trim() === candidateId,
  )
  if (idx === -1) throw new Error(`Sheet 에서 후보 행을 찾지 못했다: ${candidateId}`)
  return idx + 2 // 헤더가 1행, fetchRows 는 헤더를 뺀 배열을 준다
}

/**
 * DB 에서 확정된 상태를 Sheet 에 남긴다. **DB 를 바꾼 모든 경로가 이 함수를 부른다.**
 *
 * 🔴 무엇을 쓸지 고르지 않는다. buildSheetWriteCells 가 결과 종류로 정한다 —
 *    호출부가 셀을 조립하면 언젠가 실패 경로에 postUrl 이 섞인다.
 *
 * 🔴 실패해도 DB 를 되돌리지 않는다
 *    되돌리면 창업자가 재승인해 이중 발행이 된다 (§6-3). 대신 **불일치로 기록**하고
 *    부르는 쪽이 끝에서 출력·exit 2 로 드러낸다.
 *
 * @returns Sheet 반영에 성공했으면 true
 */
export async function syncSheet(
  candidateId: string,
  outcome: PublishOutcome,
  dbStatus: string,
  divergences: Divergence[],
  rows?: unknown[][],
): Promise<boolean> {
  const cells = buildSheetWriteCells(outcome)

  // §6-7-A 허용 열인지 한 번 더 본다. buildSheetWriteCells 가 지키지만,
  // 그 함수가 바뀌었을 때 조용히 통과하지 않도록 여기서 확인한다.
  const columnCheck = verifySheetWriteColumns(Object.keys(cells))
  if (!columnCheck.ok) {
    divergences.push({ candidateId, dbStatus, sheetStatus: '(쓰지 않음)', reason: columnCheck.reason })
    console.error(`     ⚠️ Sheet 열 검증 실패: ${columnCheck.reason}`)
    return false
  }

  try {
    const write = await updateCandidateRow({
      mode: 'columns',
      tab: SHEET_TAB_NAME,
      rowNumber: await findSheetRow(candidateId, rows),
      cells,
      expectId: candidateId,
    })
    console.log(
      `     Sheet ${write.ranges.join(', ')} · ${Object.keys(cells).join('·')} · ` +
        `read-back ${write.readBackVerified ? '검증됨' : '미검증'}`,
    )
    return true
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    divergences.push({ candidateId, dbStatus, sheetStatus: '(반영 실패)', reason })
    console.error(`     ⚠️ Sheet 역기록 실패 — DB 는 ${dbStatus} 로 확정됐다: ${reason}`)
    console.error('        DB 를 되돌리지 않는다. 재승인 시 이중 발행이 되기 때문이다 (§6-3).')
    return false
  }
}

/**
 * 상태를 되돌리고 이력을 남긴다.
 *
 * 🔴 attemptCount 를 건드리지 않는다 — 획득한 적이 없으므로 시도가 아니다.
 *    획득 후 실패는 부르는 쪽에서 attemptCount 를 올린다.
 * 🔴 PENDING 을 목적지로 받지 않는다 (§5-4 · 정책 14). 타입으로 막는다 —
 *    사람 승인 없이 다시 집히는 경로를 만들지 않는다.
 */
export async function demote(
  prisma: PrismaClient,
  candidateId: string,
  from: MicroSeedCandidateStatus,
  to: Exclude<MicroSeedCandidateStatus, 'PENDING'>,
  reason: string,
  workerId: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.microSeedCandidate.update({
      where: { id: candidateId },
      data: { status: to, holdReason: reason },
    })
    await tx.microSeedCandidateHistory.create({
      data: { candidateId, fromStatus: from, toStatus: to, by: `worker:${workerId}`, reason },
    })
  })
}
