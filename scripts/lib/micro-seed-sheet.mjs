#!/usr/bin/env node
/**
 * Micro Seed Sheet — 행 → 후보 입력 변환 (reader 코어)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-4 · §6-8 · §6-9
 *
 * 이 파일이 답하는 질문은 하나다.
 *
 *   "Google Sheet 의 한 행을 validateCandidate() 가 받는 객체로 어떻게 바꾸는가?"
 *
 * 🔴 이 파일은 Google Sheet 에 접속하지 않는다
 *    네트워크 없음 · DB 없음 · 파일 쓰기 없음 · 인증 없음.
 *    입력은 이미 읽혀 있는 2차원 배열이고 출력은 후보 객체다.
 *    실제 fetch 는 PR-B2 의 auth adapter 가 맡는다 (createGoogleSheetSource).
 *
 * 🔴 자가복구하지 않는다
 *    'pending' → 'PENDING', 'FREE' → 'free' 같은 교정을 여기서 하면
 *    validator 의 R1·R2 가 영원히 발동하지 않는다. 오타는 오타인 채로 넘겨
 *    HOLD 를 받게 한다 — 우나어 C-6 사고가 정확히 "관대한 정규화" 였다.
 *    여기서 하는 것은 trim 과 빈 값 판정, 그리고 숫자 컬럼 파싱뿐이다.
 *
 * 🔴 시트에 없는 값을 지어내지 않는다
 *    content · hasEverPublished · dbDedupKey · contentGuard 네 개는
 *    17열 안에 없다(§ INJECTED_FIELDS).
 *    주입되지 않으면 undefined 로 두고 진단에 남긴다. 빈 문자열이나 기본값을
 *    채워 넣으면 G-A·G-B·R9·R11 이 "검사했는데 통과" 로 보이게 된다.
 *    비어 있는 것은 "위반 없음" 이 아니라 "검사하지 않음" 이다.
 *
 * 🔴 Sheet 의 dedupKey 를 신뢰하지 않는다 (R11)
 *    M열은 사람이 고칠 수 있고, 고치면 R7(중복 차단)이 무력해진다.
 *    reader 는 Sheet 값을 그대로 넘기고 DB 원장값을 dbDedupKey 로 함께 주입해
 *    validator 가 대조하게 한다. 여기서 조용히 덮어쓰면 위조 흔적이 사라진다.
 */

/** 창업자가 여는 탭. 다른 탭을 읽으면 안 된다 */
export const SHEET_TAB_NAME = 'micro_seed_candidates'

/**
 * §5-4 시트 17열. **순서까지 정본이다.**
 *
 * 이름만 맞고 순서가 바뀌면 컬럼 인덱스로 읽는 모든 값이 한 칸씩 밀린다.
 * 밀린 값은 대개 타입이 맞아 보여서 조용히 통과한다 — 그래서 순서를 검증한다.
 */
export const SHEET_HEADERS = [
  'candidateId',
  'status',
  'board',
  'founderTitle',
  'originalTitle',
  'scheduledPublishAt',
  'sourceSite',
  'sourceUrl',
  'sourceArticleId',
  'sourceBoardName',
  'sourceCommentCount',
  'sourceCapturedAt',
  'dedupKey',
  'holdReason',
  'declineReason',
  'postUrl',
  'updatedBySystemAt',
]

/** validator 가 실제로 읽는 필드 중 시트에서 오는 것 */
export const VALIDATOR_FIELDS_FROM_SHEET = [
  'candidateId',
  'status',
  'board',
  'founderTitle',
  'originalTitle',
  'scheduledPublishAt',
  'sourceSite',
  'sourceUrl',
  'sourceArticleId',
  'dedupKey',
]

/**
 * validator 가 읽지만 시트 17열에 **없는** 필드.
 *
 *   content           G-A 가 본다. 시트는 원문 URL 만 갖고 본문을 갖지 않는다.
 *                     Raw Vault 의 rawBody 에서 온다 (PR-C0b)
 *   hasEverPublished  R9 가 본다. 시트는 현재 상태 한 칸뿐이라 발행 이력을 모른다.
 *                     createdPostId != null OR history 에 toStatus='PUBLISHED' 존재
 *   dbDedupKey        R11 이 본다. Sheet M열은 사람이 고칠 수 있으므로 원장값과 대조한다.
 *                     🔴 null(= DB 에 행 없음, 신규 후보)과 undefined(= 조회하지 않음)는
 *                        다른 뜻이다. null 은 정상이고 undefined 는 검사 누락이다
 *   contentGuard      G-B 가 본다. checkContent() 호출 결과여야 한다
 *
 * 넷 다 reader 바깥에서 주입되어야 하고, 주입되지 않으면 해당 게이트는
 * 판정을 못 한다. 그 사실을 진단으로 드러내는 것이 이 상수의 존재 이유다.
 *
 * 🚫 previousStatus 는 폐기했다 (PR-C0a).
 *    한 칸만 되돌아봐서 PUBLISHED → TAKEDOWN → PENDING 경유 우회에 샜다.
 *    hasEverPublished 가 대체한다.
 */
export const INJECTED_FIELDS = ['content', 'hasEverPublished', 'dbDedupKey', 'contentGuard']

/** 숫자로 정규화하는 컬럼. 나머지는 문자열 그대로 넘긴다 */
const NUMERIC_COLUMNS = ['sourceCommentCount']

// ─────────────────────────────────────────────────────────
// 헤더 검증
// ─────────────────────────────────────────────────────────

/**
 * 1행 헤더가 정본 17열과 같은지 본다.
 *
 * 누락 · 순서 오류 · 알 수 없는 컬럼 · 중복을 각각 구분해 보고한다.
 * "헤더가 다르다" 한 줄로 끝내면 창업자가 시트에서 무엇을 고쳐야 하는지 모른다.
 */
export function validateHeaders(headers) {
  const errors = []

  if (!Array.isArray(headers)) {
    return { ok: false, errors: [{ kind: 'SHAPE', message: '헤더가 배열이 아니다' }] }
  }

  const got = headers.map((h) => (typeof h === 'string' ? h.trim() : ''))

  // 중복부터 본다. 중복이 있으면 인덱스 매핑 자체가 성립하지 않는다.
  const seen = new Set()
  for (const name of got) {
    if (!name) continue
    if (seen.has(name)) {
      errors.push({ kind: 'DUPLICATE', column: name, message: `헤더 중복: ${name}` })
    }
    seen.add(name)
  }

  const expected = new Set(SHEET_HEADERS)
  for (const name of got) {
    if (name && !expected.has(name)) {
      errors.push({ kind: 'UNKNOWN', column: name, message: `알 수 없는 컬럼: ${name}` })
    }
  }

  for (const name of SHEET_HEADERS) {
    if (!got.includes(name)) {
      errors.push({ kind: 'MISSING', column: name, message: `필수 컬럼 누락: ${name}` })
    }
  }

  // 순서는 이름이 다 있을 때만 의미가 있다. 누락된 상태에서 순서를 따지면
  // 같은 문제를 두 번 보고하게 된다.
  if (!errors.some((e) => e.kind === 'MISSING' || e.kind === 'DUPLICATE')) {
    for (let i = 0; i < SHEET_HEADERS.length; i += 1) {
      if (got[i] !== SHEET_HEADERS[i]) {
        errors.push({
          kind: 'ORDER',
          column: SHEET_HEADERS[i],
          message: `컬럼 순서 오류: ${i + 1}번째는 ${SHEET_HEADERS[i]} 여야 한다. 받은 값: ${got[i] || '(빈칸)'}`,
        })
      }
    }
  }

  if (got.length > SHEET_HEADERS.length) {
    const extra = got.length - SHEET_HEADERS.length
    errors.push({
      kind: 'WIDTH',
      message: `열이 ${extra}개 많다 (${got.length} > ${SHEET_HEADERS.length})`,
    })
  }

  return { ok: errors.length === 0, errors }
}

// ─────────────────────────────────────────────────────────
// 셀 정규화
// ─────────────────────────────────────────────────────────

/**
 * 셀 하나를 꺼낸다.
 *
 * Date 를 문자열로 바꾸지 않는다 — Sheets 가 날짜 서식 셀을 Date 로 주는 경우가 있고
 * validator 의 parseKst() 가 Date 를 그대로 받는다. 문자열로 만들면 로케일이 끼어든다.
 */
function cell(row, index) {
  const v = row[index]
  if (v === undefined || v === null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'string') return v.trim()
  return String(v).trim()
}

/** 모든 칸이 빈 행 — 시트 하단의 남은 행이다. 후보로 세지 않는다 */
function isBlankRow(row) {
  if (!Array.isArray(row)) return true
  return row.every((c) => c === undefined || c === null || String(c).trim() === '')
}

/**
 * 숫자 컬럼 정규화.
 *
 * 파싱 실패를 0 으로 떨어뜨리지 않는다. 0 은 "댓글 없음" 이라는 유효한 값이라
 * 파싱 실패와 구분되지 않는다. 실패는 null 로 두고 진단에 남긴다.
 */
function normalizeCount(raw, diagnostics, rowNumber, column) {
  if (raw === '' || raw === undefined || raw === null) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    diagnostics.push({
      kind: 'TYPE',
      rowNumber,
      column,
      message: `${column} 는 0 이상 정수여야 한다. 받은 값: ${JSON.stringify(raw)}`,
    })
    return null
  }
  return n
}

// ─────────────────────────────────────────────────────────
// 행 → 후보
// ─────────────────────────────────────────────────────────

/**
 * 한 행을 validateCandidate() 입력으로 바꾼다.
 *
 * @param row          시트 한 행 (17칸 기준, 짧으면 빈칸 취급)
 * @param rowNumber    시트 행 번호 (1행 헤더이므로 데이터 첫 행이 2)
 * @param injections   { content, hasEverPublished, dbDedupKey, contentGuard } — §INJECTED_FIELDS
 */
export function mapRowToCandidate(row, rowNumber, injections = {}) {
  const diagnostics = []
  const candidate = {}

  SHEET_HEADERS.forEach((name, index) => {
    const raw = cell(row, index)
    if (NUMERIC_COLUMNS.includes(name)) {
      candidate[name] = normalizeCount(raw, diagnostics, rowNumber, name)
      return
    }
    candidate[name] = raw
  })

  // 주입 필드 — 없으면 채우지 않고 진단만 남긴다.
  // 🔴 `?? ''` 로 기본값을 주면 G-A 가 "본문이 비었다" 를 내면서 마치 검사한 것처럼 보인다.
  //    실제로는 본문을 아직 가져오지도 않은 상태다. 둘은 다른 사건이다.
  for (const field of INJECTED_FIELDS) {
    if (field in injections && injections[field] !== undefined) {
      candidate[field] = injections[field]
    } else {
      diagnostics.push({
        kind: 'NOT_INJECTED',
        rowNumber,
        column: field,
        message: `${field} 가 주입되지 않았다 — 해당 게이트는 판정하지 않는다 (위반 없음이 아니다)`,
      })
    }
  }

  candidate.sheetRowNumber = rowNumber

  return { candidate, diagnostics }
}

// ─────────────────────────────────────────────────────────
// source 어댑터
// ─────────────────────────────────────────────────────────

/**
 * @typedef {{ describe(): string, fetchRows(): Promise<{headers: unknown[], rows: unknown[][]}> }} SheetSource
 */

/** fixture source — PR-B 의 유일한 source. 네트워크 없음 */
export function createFixtureSource({ headers = SHEET_HEADERS, rows = [] } = {}) {
  return {
    describe: () => 'fixture (네트워크 없음)',
    async fetchRows() {
      return { headers, rows }
    },
  }
}

/**
 * Google Sheet source — PR-B2 에서 구현한다.
 *
 * TODO(PR-B2): Workload Identity Federation 기반 인증.
 *   조직 정책 iam.disableServiceAccountKeyCreation 으로 SA JSON key 를 만들 수 없다.
 *   키 파일이 아니라 GitHub Actions OIDC → WIF → micro-seed-reader SA 임퍼소네이션으로 간다.
 *
 *     - GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
 *       ADC 를 자동 인식하므로 키 파싱 코드가 필요 없다
 *     - 로컬:  gcloud auth application-default login
 *     - CI  :  google-github-actions/auth@v2 (permissions: id-token: write 필요)
 *
 *   🔴 우나어 GOOGLE_SERVICE_ACCOUNT_JSON 을 가져다 쓰지 않는다.
 *      그 키는 auth/indexing(write) 을 포함한 광역 권한이고 소란소란은 독립 권한으로 간다.
 *   🔴 PR-B 범위에서 Sheet write 는 없다. 읽기 전용 스코프만 쓴다.
 */
export function createGoogleSheetSource() {
  throw new Error(
    'createGoogleSheetSource 는 PR-B2 에서 구현한다. ' +
      'PR-B 는 fixture 전용이며 Google Sheet 에 접속하지 않는다.',
  )
}

// ─────────────────────────────────────────────────────────
// reader
// ─────────────────────────────────────────────────────────

/**
 * source 에서 행을 읽어 후보 목록으로 만든다.
 *
 * 헤더가 틀리면 **행을 하나도 매핑하지 않고** 멈춘다.
 * 순서가 밀린 채로 매핑하면 값이 한 칸씩 어긋난 후보가 나오는데,
 * 그건 validator 를 통과할 수도 있어서 가장 위험하다.
 *
 * @param source       SheetSource
 * @param injectionsBy candidateId → { content, hasEverPublished, dbDedupKey, contentGuard }
 */
export async function readCandidates(source, { injectionsBy = {} } = {}) {
  const { headers, rows } = await source.fetchRows()

  const headerCheck = validateHeaders(headers)
  if (!headerCheck.ok) {
    return {
      ok: false,
      headerErrors: headerCheck.errors,
      candidates: [],
      diagnostics: [],
      skippedBlankRows: 0,
    }
  }

  const candidates = []
  const diagnostics = []
  let skippedBlankRows = 0

  rows.forEach((row, i) => {
    const rowNumber = i + 2 // 1행은 헤더다
    if (isBlankRow(row)) {
      skippedBlankRows += 1
      return
    }

    const id = typeof row[0] === 'string' ? row[0].trim() : String(row[0] ?? '').trim()
    const injections = injectionsBy[id] ?? {}

    const { candidate, diagnostics: rowDiagnostics } = mapRowToCandidate(row, rowNumber, injections)
    candidates.push(candidate)
    diagnostics.push(...rowDiagnostics)
  })

  return { ok: true, headerErrors: [], candidates, diagnostics, skippedBlankRows }
}
