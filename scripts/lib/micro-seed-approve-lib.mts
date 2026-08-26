/**
 * Micro Seed 승격 판정 — sync-approval 과 approve-live 의 공유 지점
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-8 · §6-10
 *
 * 🔴 왜 추출했는가
 *    approve-live 가 sync-approval-live 를 통째로 호출하면 **Sheet 의 다른 PENDING 행까지
 *    전부 승격**시킨다. 단일 candidate 원칙과 정면으로 충돌한다.
 *    판정을 한 곳에 두고 양쪽이 부르게 한다 (C-2 단일 지점).
 *
 * 🔴 이 파일은 DB 도 Sheet 도 건드리지 않는다
 *    값을 받아 판정만 돌려준다. 실제 write 는 부르는 쪽이 한다 —
 *    그래야 fixture 가 네트워크 없이 판정 전체를 검증할 수 있다.
 *
 * 🔴 자동으로 시각을 밀지 않는다
 *    scheduledPublishAt 이 과거면 승격하지 않는다. 정책 21 · R5 가
 *    "과거면 즉시 발행하지 않는다" 이고, 그 판단을 시스템이 대신하면 규칙이 무의미해진다.
 */
import { MIN_POST_TITLE_LENGTH, MAX_POST_TITLE_LENGTH } from '../../src/lib/post-policy'
import { resolvePublishableBoard } from '../../src/lib/micro-seed-write-guard'

/**
 * 승격을 부르는 두 경로.
 *
 * `sync`    — 창업자가 Sheet 를 직접 편집한 뒤 동기화한다. Sheet 가 이미 PENDING 이다.
 * `approve` — 창업자가 명령으로 승인한다. Sheet 는 아직 HOLD 이고 예약시각을 인자로 받는다.
 */
export type PromotionMode = 'sync' | 'approve'

export type PromotionDbState = {
  status: string
  dedupKey: string
  createdPostId: string | null
  founderTitle: string | null
  targetBoardType: string | null
  scheduledPublishAt: Date | null
  declineReason: string | null
}

export type PromotionInput = {
  mode: PromotionMode
  candidateId: string
  /** Sheet 행의 편집 칸 원본값 (문자열이 아닐 수 있어 unknown 으로 받는다) */
  sheet: {
    status: unknown
    dedupKey: unknown
    founderTitle: unknown
    board: unknown
    scheduledPublishAt: unknown
    declineReason: unknown
    /** 🔴 approve 모드에서만 본다 — 발행 흔적이 있으면 승인 대상이 아니다 */
    postUrl?: unknown
    updatedBySystemAt?: unknown
  }
  db: PromotionDbState
  now: Date
  /**
   * approve 모드에서 명령으로 지정한 예약시각.
   * 🔴 Sheet F열이 비어 있는 것이 정상이므로 Sheet 값 대신 이 값을 쓴다.
   */
  overrideScheduledPublishAt?: Date | null
  /** `parseKst` 를 주입받는다 — .mjs 구현을 이 파일이 알 필요가 없다 */
  parseKst: (value: unknown) => Date | null
  /** KST 문자열 포매터 (보고 문구용) */
  kstString: (d: Date) => string
}

export type PromotionVerdict = {
  promote: boolean
  blockedBy: string | null
  /** DB update 에 넘길 payload. 승격하지 않아도 편집칸 반영분은 담긴다 */
  data: Record<string, unknown>
  fieldsUpdated: string[]
  fieldIssues: string[]
  /** 확정된 예약시각. 파싱 실패면 null */
  scheduledPublishAt: Date | null
  scheduleIsPast: boolean
}

/** 승격할 수 없는 DB 상태 — HOLD 만 승격 대상이다 */
export const NON_PROMOTABLE_STATUSES: readonly string[] = [
  'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'SKIPPED', 'DECLINED', 'TAKEDOWN',
]

/**
 * 승격 가능 여부를 판정한다. 순수 함수 — 같은 입력이면 항상 같은 결과다.
 *
 * 🔴 차단 조건을 편집칸 반영보다 **먼저** 본다.
 *    신뢰할 수 없는 행은 값도 받지 않는다.
 */
export function evaluatePromotion(input: PromotionInput): PromotionVerdict {
  const { mode, sheet, db, now, parseKst, kstString } = input
  let blocked: string | null = null

  // ── R11 (§6-10 0차) — 다른 원문을 가리키는 행일 수 있다 ──
  const sheetDedup = String(sheet.dedupKey ?? '').trim()
  if (sheetDedup !== db.dedupKey) {
    blocked = `dedupKey 가 원장과 다르다 (R11). Sheet="${sheetDedup}" 원장="${db.dedupKey}"`
  }
  // ── R9 (§6-4) — 발행 이력이 있으면 승인 경로로 되돌리지 않는다 ──
  else if (db.createdPostId) {
    blocked = `이미 발행된 후보다 (createdPostId=${db.createdPostId}). 승인 경로로 되돌리지 않는다 (R9)`
  }

  const sheetStatus = String(sheet.status ?? '').trim()

  // ── approve 모드 전용 사전 조건 ────────────────────────
  if (!blocked && mode === 'approve') {
    // 🔴 Sheet 가 이미 PENDING 이면 승인은 끝났다. 다시 쓰는 것은 의도를 알 수 없다.
    //    HOLD 가 아닌 상태(DECLINED · TAKEDOWN 등)를 명령으로 뒤집지도 않는다.
    if (sheetStatus !== 'HOLD') {
      blocked = `Sheet status 가 HOLD 가 아니다 (${sheetStatus || '(공란)'}). approve 대상이 아니다`
    } else {
      // 🔴 발행 흔적이 있는 행은 승인 대상이 아니다 (§6-1)
      const postUrl = String(sheet.postUrl ?? '').trim()
      const stamp = String(sheet.updatedBySystemAt ?? '').trim()
      if (postUrl || stamp) {
        blocked = `Sheet 에 발행 흔적이 있다 (postUrl="${postUrl}" updatedBySystemAt="${stamp}"). 승인하지 않는다`
      }
    }
  }

  // ── 편집 칸 검증 (§6-7-A) ──────────────────────────────
  const data: Record<string, unknown> = {}
  const fieldsUpdated: string[] = []
  const fieldIssues: string[] = []

  const founderTitle = typeof sheet.founderTitle === 'string' ? sheet.founderTitle.trim() : ''
  if (!founderTitle) {
    fieldIssues.push('founderTitle 이 비었다 (R3)')
  } else if (founderTitle.length < MIN_POST_TITLE_LENGTH || founderTitle.length > MAX_POST_TITLE_LENGTH) {
    fieldIssues.push(`founderTitle 길이가 범위 밖이다 (${founderTitle.length}자, R3)`)
  } else if (founderTitle !== db.founderTitle) {
    data.founderTitle = founderTitle
    fieldsUpdated.push('founderTitle')
  }

  const boardVerdict = resolvePublishableBoard(sheet.board)
  if (!boardVerdict.ok) {
    fieldIssues.push(`board: ${boardVerdict.reason} (R2)`)
  } else if (boardVerdict.boardType !== db.targetBoardType) {
    data.targetBoardType = boardVerdict.boardType
    fieldsUpdated.push('targetBoardType')
  }

  // ── 예약시각 ───────────────────────────────────────────
  //    approve 모드는 명령 인자를 쓴다. Sheet F열이 비어 있는 것이 정상이기 때문이다.
  let parsed: Date | null
  if (mode === 'approve') {
    parsed = input.overrideScheduledPublishAt ?? null
    if (!parsed) fieldIssues.push('예약시각이 없다. --at 또는 --in 이 필요하다 (R4)')
  } else {
    parsed = parseKst(sheet.scheduledPublishAt)
    if (!parsed) {
      fieldIssues.push(`scheduledPublishAt 형식이 아니다: "${String(sheet.scheduledPublishAt ?? '')}" (R4)`)
    }
  }

  let scheduleIsPast = false
  if (parsed) {
    if (parsed.getTime() !== (db.scheduledPublishAt?.getTime() ?? NaN)) {
      data.scheduledPublishAt = parsed
      fieldsUpdated.push('scheduledPublishAt')
    }
    // 🔴 과거여도 값 자체는 반영한다. 창업자가 적은 것이 원장의 사실이다.
    //    다만 그 상태로 PENDING 승격은 하지 않는다.
    if (parsed <= now) scheduleIsPast = true
  }

  const declineReason = typeof sheet.declineReason === 'string' ? sheet.declineReason.trim() : ''
  const nextDecline = declineReason || null
  if (nextDecline !== db.declineReason) {
    data.declineReason = nextDecline
    fieldsUpdated.push('declineReason')
  }

  // ── status 승격 판정 ───────────────────────────────────
  if (!blocked) {
    if (db.status !== 'HOLD') {
      blocked = `DB status 가 HOLD 가 아니다 (${db.status}). 승격 대상이 아니다`
    } else if (fieldIssues.length) {
      blocked = `편집 칸이 유효하지 않다 — ${fieldIssues.join(' / ')}`
    } else if (scheduleIsPast && parsed) {
      // 🔴 여기서 시각을 밀지 않는다 (정책 21 · R5).
      blocked =
        `scheduledPublishAt 이 과거다 (${kstString(parsed)} KST < ${kstString(now)} KST). ` +
        'PENDING 으로 올리지 않는다. 재예약은 micro-seed:reschedule-live 로 명시 지시한다'
    }
  }

  const promote = !blocked
  if (promote) {
    data.status = 'PENDING'
    fieldsUpdated.push('status')
  }

  return { promote, blockedBy: blocked, data, fieldsUpdated, fieldIssues, scheduledPublishAt: parsed, scheduleIsPast }
}
