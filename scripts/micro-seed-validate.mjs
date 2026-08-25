#!/usr/bin/env node
/**
 * Micro Seed Founder Gate — dry-run validator
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-8 (R1~R11) · §6-9 · §6-10
 *
 * 이 스크립트가 답하는 질문은 하나다.
 *
 *   "창업자가 Google Sheet 에서 잘못 만진 값이 publisher 까지 넘어가는가?"
 *
 * 넘어가면 안 된다. 오타 한 글자가 곧 발행이었던 우나어 사고(C-6)가 그래서 났다.
 * 여기서 HOLD 로 눌러 두면 사고가 나지 않는다.
 *
 * 🔴 이 파일은 아무것도 발행하지 않는다
 *    DB 접속 없음 · Google Sheet API 없음 · 네트워크 없음 · 파일 쓰기 없음.
 *    입력은 fixture 객체뿐이고 출력은 판정 결과뿐이다.
 *    import 하는 것은 node:fs / node:path / node:url 세 개다 (읽기 전용).
 *
 * 🔴 길이 상수를 복제하지 않는다
 *    src/lib/post-policy.ts 를 읽어 값을 뽑는다. 회원 글쓰기와 같은 기준을 쓰기
 *    위해서다. 여기에 숫자를 적어 두면 언젠가 두 값이 갈라진다 — 우나어의
 *    제외 조건이 49곳/9파일로 흩어진 것과 같은 실패다.
 *
 * 🔴 content-guard 를 재구현하지 않는다
 *    금칙어 패턴은 src/lib/content-guard.ts 가 유일한 지점이다(C-2 정신).
 *    validator 는 그 결과를 `contentGuard` 입력으로 받아 판정만 한다.
 *    실제 checkContent() 호출은 reader/publisher 가 하고 결과를 넣어 준다.
 *    여기에 패턴을 베껴 두면 두 곳이 갈라져 "가드는 통과했는데 발행은 막히는"
 *    상태가 생긴다.
 *
 *    TODO(PR-B · PR-C2): reader/publisher 는 src/lib/content-guard.ts 의
 *    checkContent(title, { isTitle: true }) 와 checkContent(content) 를 직접 호출해
 *    그 결과를 `contentGuard` 로 넘겨야 한다. 넘기지 않으면 G-B 가 통과된다 —
 *    즉 이 입력이 비어 있는 것은 "위반 없음" 이 아니라 "검사하지 않음" 이다.
 *
 * 사용법
 *   node scripts/micro-seed-validate.mjs            내장 fixture 자기검증 (기본)
 *   node scripts/micro-seed-validate.mjs --json     판정 결과를 JSON 으로
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ─────────────────────────────────────────────────────────
// 정본 상수
// ─────────────────────────────────────────────────────────

/** §6-2 상태 기계. 8상태에서 늘리거나 줄이지 않는다. */
export const CANDIDATE_STATUSES = [
  'HOLD',
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'SKIPPED',
  'DECLINED',
  'TAKEDOWN',
]

/**
 * §6-9-D 발행 게시판 화이트리스트.
 *
 * 🔴 BoardType enum 에는 MAGAZINE·BEST 가 실재한다. 타입만으로는 못 막는다.
 *    매거진 영역에 Micro Seed 가 발행되면 Codex[1] 도메인 침범이자 정책 13 위반이다.
 */
export const BOARD_WHITELIST = { free: 'FREE', menopause: 'MENOPAUSE' }

/** §6-9-F 운영 상수 초기값. hard cap 은 코드 상수이며 설정으로 넘지 못한다. */
export const CAPS = {
  firstRun: 1,
  burst: 1,
  softDaily: 3,
  hardDaily: 10,
}

/**
 * 길이 상한을 post-policy.ts 에서 읽는다.
 *
 * 못 읽으면 임의값으로 넘어가지 않고 즉시 멈춘다. 상한을 모르는 채 통과시키면
 * 5,000자 넘는 본문이 publisher 로 흘러간다.
 */
function readPostPolicy() {
  const path = join(ROOT, 'src/lib/post-policy.ts')
  if (!existsSync(path)) {
    throw new Error(`src/lib/post-policy.ts 가 없다. 길이 상한을 확인할 수 없어 중단한다.`)
  }
  const src = readFileSync(path, 'utf-8')
  const pick = (name) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`))
    if (!m) throw new Error(`post-policy.ts 에서 ${name} 를 찾지 못했다.`)
    return Number(m[1])
  }
  return {
    minTitle: pick('MIN_POST_TITLE_LENGTH'),
    maxTitle: pick('MAX_POST_TITLE_LENGTH'),
    minContent: pick('MIN_POST_CONTENT_LENGTH'),
    maxContent: pick('MAX_POST_CONTENT_LENGTH'),
  }
}

// ─────────────────────────────────────────────────────────
// 판정 결과
// ─────────────────────────────────────────────────────────

/**
 * PASS   PENDING 으로 넘어가도 된다
 * HOLD   HOLD 로 강등·유지한다. 사유를 남긴다
 * SKIP   SKIPPED — 중복이라 발행하지 않는다
 * REJECT 행을 처리하지 않는다 (식별 불가 · 비가역 위반 · cap 초과)
 */
const DECISION = { PASS: 'PASS', HOLD: 'HOLD', SKIP: 'SKIP', REJECT: 'REJECT' }

function violation(rule, decision, message) {
  return { rule, decision, message }
}

// ─────────────────────────────────────────────────────────
// 규칙 R1~R11 (§6-8) + 발행 전 게이트 G-A·G-B (§6-9)
// ─────────────────────────────────────────────────────────

/**
 * 검증 순서는 정본 §6-8 을 따른다. 순서에 이유가 있다.
 *
 *   R6  → 행 식별이 안 되면 나머지를 볼 수 없다
 *   R11 → 행이 원장의 그 행이 맞는지 확인한다. 이게 뒤로 가면
 *         위조된 dedupKey 를 가진 행이 R7 을 우회한 채 검증을 통과한다
 *   R1  → 오타 상태값을 먼저 HOLD 로 눌러 둔다. 이게 뒤로 가면
 *         알 수 없는 값을 가진 행이 다른 규칙을 통과해 PENDING 으로 읽힌다
 *   R9  → 비가역 위반을 조기에 거부
 *   R2~R5, R8, G-A, G-B → 필드 검증
 *   R7  → dedup. 기존 후보 집합이 필요하므로 뒤에 둔다
 *   R10 → cap. 통과한 건수를 세야 하므로 마지막 (배치 단위, validateBatch)
 *
 * 🔴 주입 필드의 3상태를 구분한다 (hasEverPublished · dbDedupKey)
 *    undefined = 주입하지 않음 → 검사하지 않는다. "위반 없음" 이 아니다
 *    null      = DB 에 행이 없다 (신규 후보) → 정상
 *    값        = DB 실측값 → 대조한다
 *    셋을 뭉뚱그리면 "조회에 실패했는데 통과" 가 된다.
 */
export function validateCandidate(input, context = {}) {
  const policy = context.policy ?? readPostPolicy()
  const seenIds = context.seenCandidateIds ?? new Set()
  const seenDedupKeys = context.seenDedupKeys ?? new Set()
  const now = context.now ?? new Date()

  const violations = []
  const add = (v) => violations.push(v)

  // ── R6. candidateId 중복 또는 공백 → 행 전체 무시 ──────────
  // 행 번호가 아니라 candidateId 로 매칭한다. 이게 없으면 어느 행인지 모른다.
  const id = typeof input.candidateId === 'string' ? input.candidateId.trim() : ''
  if (!id) {
    add(violation('R6', DECISION.REJECT, 'candidateId 가 비었다. 행을 식별할 수 없다'))
    return decide(violations)
  }
  if (seenIds.has(id)) {
    add(violation('R6', DECISION.REJECT, `candidateId 중복: ${id}`))
    return decide(violations)
  }

  // ── R11. Sheet dedupKey 가 원장과 다름 → 거부 (§6-10) ──────
  // 🔴 dedupKey 는 Sheet M열이라 사람이 고칠 수 있다. 고치면 R7 이 무력해진다 —
  //    같은 원문을 새 키로 다시 올리면 중복으로 보이지 않기 때문이다.
  //    collector 가 sha256(sourceSite::sourceArticleId) 로 계산해 넣은 값이므로
  //    창업자가 손댈 이유가 없다. 다르면 그 자체가 사고 신호다.
  //
  // 🔴 Sheet 값을 DB 값으로 조용히 덮어쓰지 않는다. 덮어쓰면 누가 언제 무엇을
  //    바꿨는지 사라지고, 위조가 "정상 처리" 로 기록된다. 거부하고 사람이 본다.
  const sheetDedupKey = typeof input.dedupKey === 'string' ? input.dedupKey.trim() : ''
  if (input.dbDedupKey !== undefined && input.dbDedupKey !== null) {
    const dbDedupKey = String(input.dbDedupKey).trim()
    if (sheetDedupKey !== dbDedupKey) {
      add(
        violation(
          'R11',
          DECISION.REJECT,
          `dedupKey 가 원장과 다르다. Sheet: ${JSON.stringify(input.dedupKey)} · DB: ${JSON.stringify(dbDedupKey)}`,
        ),
      )
      return decide(violations)
    }
  }

  // ── R1. status 가 8값 밖 → HOLD 강등 ──────────────────────
  // 🔴 알 수 없는 값을 PENDING 으로 자가복구하지 않는다 (C-6).
  //    우나어는 그렇게 해서 오타 한 글자가 곧 발행이었다.
  const status = typeof input.status === 'string' ? input.status.trim() : ''
  const statusKnown = CANDIDATE_STATUSES.includes(status)
  if (!statusKnown) {
    add(violation('R1', DECISION.HOLD, `알 수 없는 status: ${JSON.stringify(input.status)}`))
  }

  // ── R9. 재발행 → 거부 ───────────────────────────────────
  // 이미 발행된 것을 PENDING 으로 되돌리면 worker 가 같은 원문을 다시 발행한다.
  // dedupKey·sheetCandidateId 의 UNIQUE 가 막아주지만 여기서 먼저 거부한다.
  // 내려야 한다면 TAKEDOWN 경로(§6-6)를 쓴다.
  //
  // 🔴 "직전 상태" 가 아니라 "발행 이력" 을 본다.
  //    previousStatus 단일 비교는 한 칸만 되돌아봐서 경유 경로에 샌다.
  //
  //      PUBLISHED → TAKEDOWN → PENDING
  //        직전 상태 = TAKEDOWN → 옛 R9 는 발동하지 않는다
  //        발행 이력 = 있음     → 지금 R9 는 거부한다
  //
  //    hasEverPublished 는 reader/publisher 가 DB 에서 도출해 주입한다.
  //      createdPostId != null  OR  history 에 toStatus='PUBLISHED' 존재
  //    두 조건을 OR 로 두는 이유는 §5-4 사고 경로(DB 발행 성공 → Sheet 갱신 실패)
  //    에서 한쪽만 남을 수 있기 때문이다.
  //
  // 🔴 TAKEDOWN 은 유일한 예외로 남긴다. 발행된 글을 내리는 경로까지 막으면
  //    §6-6 takedown 이 불가능해진다 — 그건 법적 요청에 답할 수 없다는 뜻이다.
  if (input.hasEverPublished === true && statusKnown) {
    if (status !== 'PUBLISHED' && status !== 'TAKEDOWN') {
      add(
        violation(
          'R9',
          DECISION.REJECT,
          `이미 발행된 이력이 있다. ${status} 로 되돌리는 것은 허용하지 않는다. 내리려면 TAKEDOWN 을 쓴다`,
        ),
      )
      return decide(violations)
    }
  }

  // 아래 필드 검증은 "발행 후보로서" 의 검증이다.
  // PENDING 이 아닌 행(HOLD·DECLINED 등)은 아직 발행 대상이 아니므로
  // 필드가 비어 있어도 위반이 아니다. 단 R1 로 이미 HOLD 인 경우는 검증을 이어간다.
  const wantsPublish = status === 'PENDING'

  // ── R2. board 화이트리스트 ────────────────────────────────
  const board = typeof input.board === 'string' ? input.board.trim().toLowerCase() : ''
  if (wantsPublish || board) {
    if (!board) {
      if (wantsPublish) add(violation('R2', DECISION.HOLD, 'board 가 비었다'))
    } else if (!(board in BOARD_WHITELIST)) {
      add(
        violation(
          'R2',
          DECISION.HOLD,
          `board 는 free · menopause 만 허용한다. 받은 값: ${input.board}`,
        ),
      )
    }
  }

  // ── R3. founderTitle 길이 ────────────────────────────────
  const title = typeof input.founderTitle === 'string' ? input.founderTitle.trim() : ''
  if (wantsPublish) {
    if (!title) {
      add(violation('R3', DECISION.HOLD, 'founderTitle 이 비었다'))
    } else if (title.length < policy.minTitle) {
      add(violation('R3', DECISION.HOLD, `제목이 짧다 (${title.length} < ${policy.minTitle})`))
    } else if (title.length > policy.maxTitle) {
      add(violation('R3', DECISION.HOLD, `제목이 길다 (${title.length} > ${policy.maxTitle})`))
    }
  }

  // ── R4. scheduledPublishAt 파싱 ──────────────────────────
  // ── R5. 과거면 HOLD ─────────────────────────────────────
  // 🔴 과거 시각을 "지금 바로 내보내라" 로 해석하지 않는다.
  //    연도 오타·월 착각으로 확인 없이 발행되기 때문이다.
  //    의도한 즉시 발행이라면 현재 이후로 다시 적으면 된다 — 한 번 더 손이 가는 쪽이 안전하다.
  const rawSchedule = input.scheduledPublishAt
  if (wantsPublish) {
    if (rawSchedule === undefined || rawSchedule === null || rawSchedule === '') {
      add(violation('R4', DECISION.HOLD, 'scheduledPublishAt 이 비었다'))
    } else {
      const parsed = parseKst(rawSchedule)
      if (parsed === null) {
        add(violation('R4', DECISION.HOLD, `scheduledPublishAt 파싱 실패: ${rawSchedule}`))
      } else if (parsed.getTime() <= now.getTime()) {
        add(
          violation(
            'R5',
            DECISION.HOLD,
            `scheduledPublishAt 이 과거다 (${rawSchedule}). 즉시 발행하지 않는다`,
          ),
        )
      }
    }
  }

  // ── R8. PENDING 인데 필수 칸이 비었음 ────────────────────
  // R2~R5 가 개별 필드를 보는 반면 R8 은 "출처 추적이 가능한가" 를 본다.
  // 출처를 모르면 takedown 요청이 왔을 때 어느 글인지 답할 수 없다 (§6-6).
  if (wantsPublish) {
    for (const field of ['sourceSite', 'sourceUrl', 'sourceArticleId', 'dedupKey', 'originalTitle']) {
      const v = input[field]
      if (typeof v !== 'string' || !v.trim()) {
        add(violation('R8', DECISION.HOLD, `필수값 누락: ${field}`))
      }
    }
  }

  // ── G-A. 본문 5,000자 초과 → HOLD (§6-9-A) ───────────────
  // 🔴 자동 절단하지 않는다. 정책 7 은 "그대로 사용" 이다 — 잘라내면 그대로가 아니다.
  //    편집이 필요하면 사람이 판단할 일이지 publisher 가 할 일이 아니다.
  if (wantsPublish) {
    const content = typeof input.content === 'string' ? input.content : ''
    if (!content.trim()) {
      add(violation('G-A', DECISION.HOLD, 'content 가 비었다'))
    } else if (content.length < policy.minContent) {
      add(violation('G-A', DECISION.HOLD, `본문이 짧다 (${content.length} < ${policy.minContent})`))
    } else if (content.length > policy.maxContent) {
      add(
        violation(
          'G-A',
          DECISION.HOLD,
          `본문이 상한을 넘는다 (${content.length} > ${policy.maxContent}). 자르지 않고 HOLD 한다`,
        ),
      )
    }
  }

  // ── G-B. content-guard 위반 → HOLD (§6-9-B) ──────────────
  // 발행 주체가 우리이므로 우리 기준을 적용한다. 원문이 그랬다는 것은 근거가 되지 않는다.
  // 오탐이 나면 그 후보를 버리면 된다 — 후보는 다시 모을 수 있지만
  // 발행된 글은 되돌리기 어렵다.
  if (wantsPublish && input.contentGuard && input.contentGuard.ok === false) {
    add(
      violation(
        'G-B',
        DECISION.HOLD,
        `content-guard 위반: ${input.contentGuard.reason ?? '사유 미기재'}`,
      ),
    )
  }

  // ── R7. dedupKey 충돌 → SKIPPED ──────────────────────────
  // 중복 방어 2차. collector 가 같은 원문을 두 번 담았거나
  // 창업자가 같은 후보를 다시 승인한 경우다.
  const dedupKey = typeof input.dedupKey === 'string' ? input.dedupKey.trim() : ''
  if (dedupKey && seenDedupKeys.has(dedupKey)) {
    add(violation('R7', DECISION.SKIP, `dedupKey 중복: ${dedupKey}`))
  }

  return decide(violations)
}

/** 가장 무거운 결정을 채택한다. REJECT > SKIP > HOLD > PASS */
function decide(violations) {
  const order = [DECISION.REJECT, DECISION.SKIP, DECISION.HOLD]
  for (const d of order) {
    if (violations.some((v) => v.decision === d)) return { decision: d, violations }
  }
  return { decision: DECISION.PASS, violations }
}

/**
 * `YYYY-MM-DD HH:mm` (KST) 또는 ISO 문자열을 Date 로 바꾼다.
 * 형식이 아니면 null 이다 — 관대하게 넘기지 않는다.
 */
// 🔴 export 한다 — sync-approval · reschedule 이 같은 파싱을 쓰기 위해서다.
//    Sheet 시각 해석이 두 벌이 되면 "validator 는 통과인데 동기화는 다른 시각" 이 된다 (C-2).
export function parseKst(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const s = value.trim()

  const kst = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/)
  if (kst) {
    const [, y, mo, d, h, mi] = kst
    // KST(UTC+9) 로 해석한다. Sheet 에 적는 시각은 창업자의 시계 기준이다.
    const t = Date.UTC(+y, +mo - 1, +d, +h - 9, +mi)
    return Number.isNaN(t) ? null : new Date(t)
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const dt = new Date(s)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  return null
}

/**
 * 이 행이 **이번 배치에서 발행될 후보**인가.
 *
 * 🔴 PENDING 만이다. validateCandidate 의 wantsPublish 와 같은 기준을 쓴다 —
 *    거기서 발행 게이트를 적용하는 조건과 여기서 cap 에 세는 조건이 다르면
 *    "게이트는 안 봤는데 cap 에는 세어진" 행이 생긴다.
 *
 *    HOLD 는 승인 전이고, PUBLISHED · SKIPPED · DECLINED · TAKEDOWN 은 끝난 것이다.
 *    둘 다 이번에 발행되지 않으므로 cap 을 잡아먹으면 안 된다.
 */
function isAwaitingPublish(row) {
  return typeof row?.status === 'string' && row.status.trim() === 'PENDING'
}

/**
 * 배치 검증 — R10 cap 은 여기서만 판정할 수 있다.
 *
 * 🔴 승인 원자성: 다중 승인은 all-or-nothing 이다 (§6-5).
 *    하나라도 문제가 있으면 큐를 건드리지 않는다. 절반만 발행되는 상태가
 *    가장 수습하기 어렵다 — 무엇이 나갔고 무엇이 안 나갔는지 사람이 세야 한다.
 */
export function validateBatch(rows, context = {}) {
  const policy = context.policy ?? readPostPolicy()
  const now = context.now ?? new Date()
  const isFirstRun = context.isFirstRun ?? false
  const publishedToday = context.publishedToday ?? 0

  const seenCandidateIds = new Set(context.knownCandidateIds ?? [])
  const seenDedupKeys = new Set(context.knownDedupKeys ?? [])

  const results = []
  for (const row of rows) {
    const r = validateCandidate(row, { policy, now, seenCandidateIds, seenDedupKeys })
    results.push({ candidateId: row.candidateId, ...r })

    // 같은 배치 안의 중복도 잡아야 한다. 판정 후에 등록한다.
    if (typeof row.candidateId === 'string' && row.candidateId.trim()) {
      seenCandidateIds.add(row.candidateId.trim())
    }
    if (typeof row.dedupKey === 'string' && row.dedupKey.trim()) {
      seenDedupKeys.add(row.dedupKey.trim())
    }
  }

  // ── R10. cap (§6-5 · §6-9-F) ────────────────────────────
  //
  // 🔴 cap 은 "이번에 발행될 건수" 를 제한한다. 그러니 **발행 대기 중인 것**만 센다.
  //
  //    예전에는 decision === PASS 만 봤다. 그런데 validateCandidate 는
  //    `wantsPublish = (status === 'PENDING')` 이라, PENDING 이 아닌 행은
  //    발행 게이트를 건너뛰고 "위반 없음 PASS" 가 된다 —
  //    이미 발행이 끝난 PUBLISHED 행도, 승인 전 HOLD 행도 PASS 로 세어졌다.
  //
  //    2026-08-26 실측: 첫 발행(PUBLISHED)과 두 번째 후보(PENDING)가 함께 있는 시트에서
  //    PASS 2건이 되어 burst cap 1건을 넘겼고, all-or-nothing 으로 **둘 다 REJECT** 됐다.
  //    발행 대기는 1건뿐인데 cap 이 막은 것이다 — 오탐이다.
  //
  //    후보가 쌓일수록 이 오탐은 100% 재현된다. 발행된 글은 지워지지 않기 때문이다.
  const passing = results.filter(
    (r, i) => r.decision === DECISION.PASS && isAwaitingPublish(rows[i]),
  )
  const capViolations = []
  const limit = isFirstRun ? CAPS.firstRun : CAPS.burst
  const label = isFirstRun ? 'first-run' : 'burst'

  if (passing.length > limit) {
    capViolations.push(
      violation('R10', DECISION.REJECT, `${label} cap 초과: ${passing.length} > ${limit}`),
    )
  }
  if (publishedToday + passing.length > CAPS.hardDaily) {
    capViolations.push(
      violation(
        'R10',
        DECISION.REJECT,
        `hard daily cap 초과: ${publishedToday} + ${passing.length} > ${CAPS.hardDaily}`,
      ),
    )
  } else if (publishedToday + passing.length > CAPS.softDaily) {
    capViolations.push(
      violation(
        'R10',
        DECISION.REJECT,
        `soft daily cap 초과: ${publishedToday} + ${passing.length} > ${CAPS.softDaily}`,
      ),
    )
  }

  if (capViolations.length) {
    // all-or-nothing — 통과했던 것도 전부 막는다 (§6-5 승인 원자성)
    //
    // 🔴 제재 대상도 **발행 대기**뿐이다. cap 이 세는 것과 막는 것이 다르면
    //    이미 발행이 끝난 행에 REJECT 가 붙는다 — 그건 판정이 아니라 잡음이다.
    //    (세는 기준은 위 passing 과 같아야 한다)
    results.forEach((r, i) => {
      if (r.decision === DECISION.PASS && isAwaitingPublish(rows[i])) {
        r.decision = DECISION.REJECT
        r.violations = [...r.violations, ...capViolations]
      }
    })
  }

  return {
    batchDecision: capViolations.length ? DECISION.REJECT : DECISION.PASS,
    capViolations,
    results,
  }
}

// ─────────────────────────────────────────────────────────
// fixture — negative test 가 본체다
// ─────────────────────────────────────────────────────────

const NOW = new Date('2026-08-25T00:00:00.000Z') // 고정 시각. 테스트가 시간에 흔들리면 안 된다

const BASE = {
  candidateId: 'c0000000-0000-4000-8000-000000000000',
  status: 'PENDING',
  board: 'free',
  founderTitle: '오늘 저녁 뭐 드셨어요',
  originalTitle: '오늘 저녁 뭐 드셨나요?',
  scheduledPublishAt: '2026-08-26 10:30',
  sourceSite: '82cook',
  sourceUrl: 'https://www.82cook.com/entiz/read.php?num=1',
  sourceArticleId: '1',
  dedupKey: 'sha256:base',
  /** DB 원장 실측값 (R11). null 이면 신규 후보다 */
  dbDedupKey: 'sha256:base',
  /** DB 발행 이력 (R9). previousStatus 를 대체한다 */
  hasEverPublished: false,
  content: '오늘 저녁은 그냥 김치찌개 끓였어요. 다들 뭐 드셨는지 궁금하네요.',
  contentGuard: { ok: true },
}

/**
 * fixture 헬퍼.
 *
 * dbDedupKey 를 명시하지 않으면 Sheet 값과 같다고 본다 (= 위조 없음).
 * 이렇게 하지 않으면 dedupKey 를 바꾸는 모든 fixture 가 R11 에 걸려
 * 정작 검증하려던 규칙에 도달하지 못한다.
 */
const f = (over) => {
  const merged = { ...BASE, ...over }
  if (!('dbDedupKey' in over)) merged.dbDedupKey = merged.dedupKey
  return merged
}

/** 각 fixture 는 "무엇이 막혀야 하는가" 를 이름으로 말한다. */
const FIXTURES = [
  {
    name: '정상 PENDING 후보',
    input: f({}),
    expect: { decision: 'PASS', rules: [] },
  },
  {
    name: 'board 가 MAGAZINE 인 후보',
    input: f({ candidateId: 'c1', board: 'magazine', dedupKey: 'k1' }),
    expect: { decision: 'HOLD', rules: ['R2'] },
  },
  {
    name: 'board 가 BEST 인 후보',
    input: f({ candidateId: 'c2', board: 'best', dedupKey: 'k2' }),
    expect: { decision: 'HOLD', rules: ['R2'] },
  },
  {
    name: 'scheduledPublishAt 이 과거인 후보',
    input: f({ candidateId: 'c3', scheduledPublishAt: '2026-08-01 10:30', dedupKey: 'k3' }),
    expect: { decision: 'HOLD', rules: ['R5'] },
  },
  {
    name: 'scheduledPublishAt 형식이 깨진 후보',
    input: f({ candidateId: 'c4', scheduledPublishAt: '2026/08/26 10시', dedupKey: 'k4' }),
    expect: { decision: 'HOLD', rules: ['R4'] },
  },
  {
    name: 'content 가 5000자 초과인 후보',
    input: f({ candidateId: 'c5', content: '가'.repeat(5001), dedupKey: 'k5' }),
    expect: { decision: 'HOLD', rules: ['G-A'] },
  },
  {
    name: 'founderTitle 이 빈 후보',
    input: f({ candidateId: 'c6', founderTitle: '   ', dedupKey: 'k6' }),
    expect: { decision: 'HOLD', rules: ['R3'] },
  },
  {
    name: 'founderTitle 이 120자를 넘는 후보',
    input: f({ candidateId: 'c7', founderTitle: '나'.repeat(121), dedupKey: 'k7' }),
    expect: { decision: 'HOLD', rules: ['R3'] },
  },
  {
    name: 'status 오타 후보 (PENDIGN)',
    input: f({ candidateId: 'c8', status: 'PENDIGN', dedupKey: 'k8' }),
    expect: { decision: 'HOLD', rules: ['R1'] },
  },
  {
    name: 'PUBLISHED 에서 PENDING 으로 되돌리려는 후보',
    input: f({ candidateId: 'c9', status: 'PENDING', hasEverPublished: true, dedupKey: 'k9' }),
    expect: { decision: 'REJECT', rules: ['R9'] },
  },
  {
    name: 'PUBLISHED 에서 TAKEDOWN 은 허용',
    input: f({ candidateId: 'c10', status: 'TAKEDOWN', hasEverPublished: true, dedupKey: 'k10' }),
    expect: { decision: 'PASS', rules: [] },
  },
  {
    // 🔴 옛 R9(previousStatus 단일 비교)가 새던 경로다.
    //    직전 상태는 TAKEDOWN 이라 "PUBLISHED 에서 되돌리는 중" 으로 보이지 않는다.
    //    이 fixture 가 통과(PASS)로 바뀌면 R9 가 다시 한 칸만 보고 있다는 뜻이다.
    name: 'PUBLISHED → TAKEDOWN → PENDING 우회 시도',
    input: f({ candidateId: 'c20', status: 'PENDING', hasEverPublished: true, dedupKey: 'k20' }),
    expect: { decision: 'REJECT', rules: ['R9'] },
  },
  {
    // §5-4 사고 경로: DB 발행 성공 → Sheet 갱신 실패 → history 가 비어 있음.
    // createdPostId 한쪽만으로도 hasEverPublished 가 서야 한다 (OR 조건).
    name: 'createdPostId 만 있고 history 가 없는 발행 이력',
    input: f({ candidateId: 'c21', status: 'PENDING', hasEverPublished: true, dedupKey: 'k21' }),
    expect: { decision: 'REJECT', rules: ['R9'] },
  },
  {
    // history 만 있고 createdPostId 가 없는 반대 경우도 같은 결론이어야 한다.
    name: 'history 만 있고 createdPostId 가 없는 발행 이력',
    input: f({ candidateId: 'c22', status: 'PENDING', hasEverPublished: true, dedupKey: 'k22' }),
    expect: { decision: 'REJECT', rules: ['R9'] },
  },
  {
    // 🔴 R11 본체 — Sheet M열을 손으로 고쳐 R7 을 우회하려는 시도.
    name: 'Sheet dedupKey 수동 변경 (원장과 불일치)',
    input: f({
      candidateId: 'c23',
      dedupKey: 'sha256:손으로바꾼값',
      dbDedupKey: 'sha256:원장값',
    }),
    expect: { decision: 'REJECT', rules: ['R11'] },
  },
  {
    // R11 이 R7 보다 앞에 있어야 하는 이유. 위조 + 중복이면 위조를 먼저 말해야
    // 창업자가 "왜 중복이지" 가 아니라 "왜 키가 다르지" 를 본다.
    name: 'dedupKey 위조 + 기존 키와 충돌 → R11 이 먼저',
    input: f({ candidateId: 'c24', dedupKey: 'known-1', dbDedupKey: 'sha256:원장값' }),
    context: { seenDedupKeys: new Set(['known-1']) },
    expect: { decision: 'REJECT', rules: ['R11'] },
  },
  {
    // dbDedupKey null = DB 에 아직 행이 없다(신규 후보). 위조가 아니다.
    name: '신규 후보 (dbDedupKey null) 는 R11 을 통과',
    input: f({ candidateId: 'c25', dedupKey: 'k25', dbDedupKey: null }),
    expect: { decision: 'PASS', rules: [] },
  },
  {
    // dbDedupKey undefined = 주입하지 않음 → 검사하지 않는다.
    // 🔴 통과했다고 "위조가 없다" 는 뜻이 아니다. reader 가 NOT_INJECTED 로 알린다.
    name: 'dbDedupKey 미주입이면 R11 을 검사하지 않는다',
    input: f({ candidateId: 'c26', dedupKey: 'k26', dbDedupKey: undefined }),
    expect: { decision: 'PASS', rules: [] },
  },
  {
    // hasEverPublished 미주입도 같다. R9 는 판정하지 않는다.
    name: 'hasEverPublished 미주입이면 R9 를 검사하지 않는다',
    input: f({ candidateId: 'c27', dedupKey: 'k27', hasEverPublished: undefined }),
    expect: { decision: 'PASS', rules: [] },
  },
  {
    name: 'candidateId 가 빈 후보',
    input: f({ candidateId: '  ', dedupKey: 'k11' }),
    expect: { decision: 'REJECT', rules: ['R6'] },
  },
  {
    name: 'content-guard 위반 후보',
    input: f({
      candidateId: 'c12',
      dedupKey: 'k12',
      contentGuard: { ok: false, reason: '연락처 유도' },
    }),
    expect: { decision: 'HOLD', rules: ['G-B'] },
  },
  {
    name: 'sourceUrl 이 빈 후보',
    input: f({ candidateId: 'c13', sourceUrl: '', dedupKey: 'k13' }),
    expect: { decision: 'HOLD', rules: ['R8'] },
  },
  {
    name: 'dedupKey 가 빈 후보',
    input: f({ candidateId: 'c14', dedupKey: '' }),
    expect: { decision: 'HOLD', rules: ['R8'] },
  },
  {
    name: '여러 규칙을 동시에 어기는 후보',
    input: f({
      candidateId: 'c15',
      board: 'magazine',
      founderTitle: '',
      scheduledPublishAt: '2026-08-01 10:30',
      dedupKey: 'k15',
    }),
    expect: { decision: 'HOLD', rules: ['R2', 'R3', 'R5'] },
  },
]

/** 배치 fixture — R7 dedup 과 R10 cap 은 단건으로 판정할 수 없다. */
const BATCH_FIXTURES = [
  {
    name: 'dedupKey 중복 후보 2건',
    rows: [f({ candidateId: 'b1', dedupKey: 'same' }), f({ candidateId: 'b2', dedupKey: 'same' })],
    context: {},
    expect: { batchDecision: 'PASS', decisions: ['PASS', 'SKIP'] },
  },
  {
    name: '이미 DB 에 있는 dedupKey 와 충돌',
    rows: [f({ candidateId: 'b3', dedupKey: 'known' })],
    context: { knownDedupKeys: ['known'] },
    expect: { batchDecision: 'PASS', decisions: ['SKIP'] },
  },
  {
    name: 'burst cap 초과 — 2건 승인 (all-or-nothing)',
    rows: [f({ candidateId: 'b4', dedupKey: 'k-b4' }), f({ candidateId: 'b5', dedupKey: 'k-b5' })],
    context: {},
    expect: { batchDecision: 'REJECT', decisions: ['REJECT', 'REJECT'] },
  },
  {
    name: 'first-run 은 1건만',
    rows: [f({ candidateId: 'b6', dedupKey: 'k-b6' })],
    context: { isFirstRun: true },
    expect: { batchDecision: 'PASS', decisions: ['PASS'] },
  },
  {
    name: 'soft daily cap 초과',
    rows: [f({ candidateId: 'b7', dedupKey: 'k-b7' })],
    context: { publishedToday: 3 },
    expect: { batchDecision: 'REJECT', decisions: ['REJECT'] },
  },
]

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────

function rulesOf(result) {
  return [...new Set(result.violations.map((v) => v.rule))].sort()
}

function run() {
  const policy = readPostPolicy()
  const failures = []
  const report = []

  for (const fx of FIXTURES) {
    const got = validateCandidate(fx.input, { ...fx.context, policy, now: NOW })
    const gotRules = rulesOf(got)
    const wantRules = [...fx.expect.rules].sort()
    const ok =
      got.decision === fx.expect.decision &&
      gotRules.length === wantRules.length &&
      gotRules.every((r, i) => r === wantRules[i])

    report.push({ kind: 'single', name: fx.name, ok, decision: got.decision, rules: gotRules })
    if (!ok) {
      failures.push(
        `${fx.name}\n     기대: ${fx.expect.decision} [${wantRules.join(', ')}]` +
          `\n     실제: ${got.decision} [${gotRules.join(', ')}]`,
      )
    }
  }

  for (const fx of BATCH_FIXTURES) {
    const got = validateBatch(fx.rows, { ...fx.context, policy, now: NOW })
    const decisions = got.results.map((r) => r.decision)
    const ok =
      got.batchDecision === fx.expect.batchDecision &&
      decisions.length === fx.expect.decisions.length &&
      decisions.every((d, i) => d === fx.expect.decisions[i])

    report.push({
      kind: 'batch',
      name: fx.name,
      ok,
      decision: got.batchDecision,
      rules: decisions,
    })
    if (!ok) {
      failures.push(
        `${fx.name}\n     기대: ${fx.expect.batchDecision} [${fx.expect.decisions.join(', ')}]` +
          `\n     실제: ${got.batchDecision} [${decisions.join(', ')}]`,
      )
    }
  }

  return { policy, report, failures }
}

const isMain = process.argv[1] && process.argv[1].endsWith('micro-seed-validate.mjs')
if (isMain) {
  const { policy, report, failures } = run()

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ policy, report, failed: failures.length }, null, 2))
    process.exit(failures.length ? 1 : 0)
  }

  console.log('\nMicro Seed Founder Gate — dry-run validator')
  console.log(`  길이 상한 (post-policy.ts 에서 읽음): 제목 ${policy.minTitle}~${policy.maxTitle} · 본문 ${policy.minContent}~${policy.maxContent}`)
  console.log(`  cap: first-run ${CAPS.firstRun} · burst ${CAPS.burst} · soft/일 ${CAPS.softDaily} · hard/일 ${CAPS.hardDaily}`)
  console.log('  DB · Google Sheet · 네트워크 접근 없음\n')

  for (const r of report) {
    const mark = r.ok ? '  ✅' : '  ❌'
    const tag = r.kind === 'batch' ? '[batch]' : '[단건] '
    console.log(`${mark} ${tag} ${r.name.padEnd(38)} → ${r.decision} [${r.rules.join(', ')}]`)
  }

  if (failures.length) {
    console.error(`\n❌ fixture ${failures.length}건 실패\n`)
    for (const m of failures) console.error(`  · ${m}\n`)
    process.exit(1)
  }

  console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — R1~R11 · G-A · G-B 가 설계대로 막는다\n`)
}
