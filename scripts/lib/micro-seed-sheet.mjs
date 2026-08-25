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
 * 🔴 변환 로직은 Sheet 에 접속하지 않는다
 *    mapRowToCandidate · validateHeaders · readCandidates 는 네트워크 · DB · 파일 쓰기가 없다.
 *    입력은 이미 읽혀 있는 2차원 배열이고 출력은 후보 객체다.
 *
 *    네트워크를 타는 곳은 createGoogleSheetSource 하나뿐이고, 그것도 **읽기 전용**이다.
 *    fixture 경로(createFixtureSource)는 auth 패키지를 로드조차 하지 않는다 —
 *    동적 import 로 분리해 두었다.
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

/** Sheet ID 를 담는 환경변수. 이 이름 외에는 읽지 않는다 */
export const MICRO_SEED_SHEET_ID_ENV = 'SORAN_MICRO_SEED_SHEET_ID'

/**
 * 🔴 읽기 전용 스코프. 이것 하나만 쓴다.
 *
 *    §12-2 자동화 개방 순서가 read-only inventory 를 첫 칸으로 둔다.
 *    write 스코프를 미리 얻어 두면 "잘못 부르면 쓰이는" 경로가 생긴다 —
 *    쓸 수 없는 토큰이면 실수해도 쓰이지 않는다.
 *    상태 역기록(postUrl · updatedBySystemAt)은 PR-C2b 에서 스코프와 함께 올린다.
 */
export const SHEET_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

/**
 * Google Sheet source — 실제 read.
 *
 * 🔴 인증은 ADC(Application Default Credentials) + 서비스 계정 임퍼소네이션이다.
 *    키 파일을 만들지 않는다 — 조직 정책 iam.disableServiceAccountKeyCreation 이
 *    SA JSON key 를 막고 있고, ADC 는 애초에 키 파일을 쓰지 않는다.
 *
 *      로컬:
 *        gcloud auth application-default login \
 *          --impersonate-service-account=micro-seed-reader@project-8687edda-dc1b-4c7d-95a.iam.gserviceaccount.com
 *
 *      CI  :  M1 은 workflow 를 붙이지 않는다 (§6-9-F · §12-2).
 *             자동화를 열 때 WIF(google-github-actions/auth@v2)를 붙인다 — M2 이후다.
 *
 * 🔴 왜 사용자 계정 ADC 가 아니라 임퍼소네이션인가
 *    `--scopes=...spreadsheets.readonly` 로 사용자 동의를 받으려 하면 Google 이
 *    **"차단된 앱"** 으로 막는다(OAuth 앱 검증 정책). 우회할 수단이 없다.
 *
 *    임퍼소네이션은 그 벽을 피해 간다 — 사용자에게는 Sheets 스코프를 요청하지 않고
 *    cloud-platform 만으로 SA 토큰을 발급받으며, **Sheets 스코프는 그 SA 토큰이 갖는다.**
 *
 *    아래 scopes 가 실제로 적용되는 것도 임퍼소네이션이라서다.
 *    google-auth-library 는 `this.scopes || json.scopes || defaultScopes` 순으로
 *    targetScopes 를 정한다(googleauth.js). 사용자 계정 ADC 는 코드 스코프를 무시하지만
 *    impersonated ADC 는 코드 스코프를 쓴다.
 *
 *    전제: 로그인 계정에 그 SA 에 대한 roles/iam.serviceAccountTokenCreator 가 있어야 한다.
 *    🔴 프로젝트 IAM 이 아니라 **그 SA 의 [권한] 탭**에 부여한다 — 프로젝트에 걸면
 *       그 프로젝트의 모든 SA 를 가장할 수 있게 된다.
 *
 * 🔴 우나어 GOOGLE_SERVICE_ACCOUNT_JSON 을 가져다 쓰지 않는다.
 *    그 키는 auth/indexing(write)을 포함한 광역 권한이고 소란소란은 독립 권한으로 간다.
 *
 * 🔴 googleapis 를 쓰지 않는다.
 *    필요한 API 는 spreadsheets.values.get 하나뿐이다. 대형 패키지를 들이는 대신
 *    google-auth-library 로 토큰만 받아 REST 를 부른다 — 공용 파일(package-lock)의
 *    접촉면을 줄이는 편이 멀티 세션 환경에서 안전하다.
 *
 * @param sheetId  생략하면 SORAN_MICRO_SEED_SHEET_ID 를 읽는다
 * @param tab      생략하면 micro_seed_candidates
 * @param range    생략하면 탭 전체 (A:Q 는 강제하지 않는다 — 열 개수 검증은 validateHeaders 가 한다)
 */
export async function createGoogleSheetSource({ sheetId, tab, range } = {}) {
  const id = (sheetId ?? process.env[MICRO_SEED_SHEET_ID_ENV] ?? '').trim()
  if (!id) {
    throw new Error(
      `${MICRO_SEED_SHEET_ID_ENV} 가 설정되지 않았다. 어떤 시트를 읽을지 모르는 채로 진행하지 않는다.`,
    )
  }

  const tabName = (tab ?? SHEET_TAB_NAME).trim() || SHEET_TAB_NAME

  // google-auth-library 는 동적 import 로 가져온다. fixture 경로(createFixtureSource)는
  // 이 모듈을 import 해도 auth 패키지를 로드하지 않는다 — 테스트가 네트워크 라이브러리에
  // 의존하지 않게 하려는 것이다.
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: [SHEET_READONLY_SCOPE] })

  return {
    describe: () => `google sheets (read-only) · ${tabName}`,
    async fetchRows() {
      const client = await auth.getClient()
      const target = range ? `${tabName}!${range}` : tabName
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}` +
        `/values/${encodeURIComponent(target)}` +
        // 서식이 적용된 셀도 원본 문자열로 받는다. 로케일에 따라 날짜가 달리 보이는 것을 막는다.
        `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`

      const res = await client.request({ url, method: 'GET' })
      const values = res?.data?.values ?? []

      // 🔴 빈 시트를 조용히 통과시키지 않는다. 헤더가 없으면 무엇을 읽었는지 모른다.
      if (!values.length) {
        throw new Error(`시트가 비어 있다 (${tabName}). 헤더 행이 없으면 열 매핑을 확인할 수 없다.`)
      }

      const [headers, ...rows] = values
      return { headers, rows }
    },
  }
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

// ─────────────────────────────────────────────────────────
// writer (§6-7-A · §12-2)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 쓰기 스코프. read 경로(createGoogleSheetSource)는 여전히 readonly 를 쓴다.
 *
 *    §12-2 는 read-only inventory 를 자동화 개방의 첫 칸으로 두고, "write 스코프를
 *    미리 얻어 두면 잘못 부르면 쓰이는 경로가 생긴다" 고 못박는다. 그 원칙을
 *    스코프를 아예 갖지 않는 방식으로 지킬 수 있었던 것은 쓸 일이 없을 때까지였다.
 *
 *    이제 쓴다. 그래서 원칙을 **구조**로 옮긴다:
 *      · read 경로는 readonly 토큰만 받는다 — write 토큰을 손에 쥔 적이 없다
 *      · write 토큰을 받는 함수는 updateCandidateRow **하나뿐**이다
 *      · 그 함수는 append 를 제공하지 않고, 쓸 수 있는 열이 정해져 있다
 *    셋 다 micro-seed-read.mjs 의 가드가 **소스를 읽어** 검사한다. 주석이 아니라 검사다.
 *
 *    ⚠️ 전제: SA 가 대상 시트의 **편집자**여야 한다. 뷰어면 토큰이 있어도 403 이다.
 */
export const SHEET_WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

/**
 * 시스템이 갱신할 수 있는 열 (§6-7-A).
 *
 * 🔴 이 목록은 src/lib/micro-seed-write-guard.ts 의 SHEET_WRITABLE_COLUMNS 와 **같아야 한다**.
 *    .mjs 는 .ts 를 import 할 수 없어 상수를 공유하지 못한다. 그래서 복제하되
 *    micro-seed-read.mjs 가드가 두 파일을 읽어 **불일치를 실패로 만든다** —
 *    갈라지면 "한쪽은 통과, 한쪽은 차단" 이 되는데 그게 가장 늦게 발견된다.
 *
 * 창업자 입력 칸(founderTitle · board · scheduledPublishAt 등)은 여기 없다.
 * 시스템이 사람의 입력을 덮어쓰면 무엇이 사람의 판단이었는지 알 수 없게 된다.
 */
export const SHEET_UPDATABLE_COLUMNS = ['status', 'holdReason', 'postUrl', 'updatedBySystemAt']

/**
 * publisher 만 쓰는 열. 발행 전에는 **비어 있어야 한다**.
 * 발행하지 않은 후보에 발행 흔적이 있으면 원장이 거짓이 된다 (§6-1).
 */
export const SHEET_PUBLISHER_ONLY_COLUMNS = ['postUrl', 'updatedBySystemAt']

/** write 모드. bootstrap = 첫 행 완성(A:Q 17열) · columns = 허용 열만 갱신 */
export const SHEET_WRITE_MODES = ['bootstrap', 'columns']

/** 0-based 열 인덱스 → 시트 열 문자 (0 → A). 17열이라 한 글자로 충분하다. */
export function columnLetter(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SHEET_HEADERS.length) {
    throw new Error(`열 인덱스가 범위를 벗어난다: ${index}`)
  }
  return String.fromCharCode(65 + index)
}

/**
 * DB 후보 1건을 정본 17열 순서의 Sheet 행으로 만든다.
 *
 * 🔴 SHEET_HEADERS 순서를 그대로 따른다. 손으로 배열을 적지 않는다 —
 *    열이 하나 밀리면 값이 통째로 어긋난 채 validator 를 통과할 수 있다.
 *
 * @param row  헤더명과 같은 키를 갖는 객체
 */
export function buildSheetRow(row) {
  return SHEET_HEADERS.map((h) => {
    const v = row[h]
    if (v === undefined || v === null) return ''
    return typeof v === 'string' ? v : String(v)
  })
}

/**
 * write 인자를 검사한다. **네트워크를 타기 전에** 판정한다 —
 * 그래야 fixture 가 네트워크 없이 이 계약을 검증할 수 있다.
 *
 * @returns { ok: true, range, values } | { ok: false, reason }
 */
export function planSheetWrite({ mode = 'columns', rowNumber, values, cells, tab } = {}) {
  const fail = (reason) => ({ ok: false, reason })

  if (!SHEET_WRITE_MODES.includes(mode)) {
    return fail(`알 수 없는 write mode: ${JSON.stringify(mode)}. 허용: ${SHEET_WRITE_MODES.join(' · ')}`)
  }
  // 🔴 1행은 헤더다. 헤더를 덮어쓰면 이후 모든 매핑이 어긋난다.
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return fail(`rowNumber 가 올바르지 않다 (${JSON.stringify(rowNumber)}). 1행은 헤더다.`)
  }

  const tabName = (tab ?? SHEET_TAB_NAME).trim() || SHEET_TAB_NAME
  const lastCol = columnLetter(SHEET_HEADERS.length - 1)

  if (mode === 'bootstrap') {
    if (!Array.isArray(values) || values.length !== SHEET_HEADERS.length) {
      return fail(`bootstrap 은 ${SHEET_HEADERS.length}개 값이 필요하다 (받은 값: ${values?.length}).`)
    }
    // 🔴 발행 흔적을 미리 남기지 않는다 (§6-1)
    for (const col of SHEET_PUBLISHER_ONLY_COLUMNS) {
      const v = values[SHEET_HEADERS.indexOf(col)]
      if (v !== '' && v != null) {
        return fail(`${col} 은 publisher 전에는 비어 있어야 한다 (받은 값: ${JSON.stringify(v)}).`)
      }
    }
    const statusValue = values[SHEET_HEADERS.indexOf('status')]
    if (statusValue === 'PUBLISHED') {
      return fail('status 를 PUBLISHED 로 쓰지 않는다. 발행 결과는 DB 실측 후 publisher 가 기록한다.')
    }
    return { ok: true, updates: [{ range: `${tabName}!A${rowNumber}:${lastCol}${rowNumber}`, values: [values] }] }
  }

  // mode === 'columns'
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
    return fail('columns 모드는 { 열이름: 값 } 객체가 필요하다.')
  }
  const names = Object.keys(cells)
  if (names.length === 0) return fail('쓰려는 열이 없다. 빈 write 는 의도를 알 수 없다.')

  const allowed = new Set(SHEET_UPDATABLE_COLUMNS)
  const rejected = names.filter((n) => !allowed.has(n))
  if (rejected.length) {
    return fail(
      `Sheet 에 쓸 수 없는 열이다: ${rejected.join(', ')}. ` +
        `허용: ${SHEET_UPDATABLE_COLUMNS.join(' · ')} (§6-7-A)`,
    )
  }
  if (cells.status === 'PUBLISHED') {
    return fail('status 를 PUBLISHED 로 쓰지 않는다. 발행 결과는 DB 실측 후 publisher 가 기록한다.')
  }

  const updates = names.map((n) => {
    const col = columnLetter(SHEET_HEADERS.indexOf(n))
    const v = cells[n]
    return { range: `${tabName}!${col}${rowNumber}:${col}${rowNumber}`, values: [[v == null ? '' : String(v)]] }
  })
  return { ok: true, updates }
}

/**
 * 시트의 한 행을 **덮어쓴다**. append 하지 않는다.
 *
 * 🔴 append 를 제공하지 않는 이유
 *    같은 candidateId 가 두 행이 되면 R6(행 식별)이 깨지고, 어느 행이 정본인지
 *    사람도 코드도 알 수 없게 된다. 행 번호를 받아 그 자리만 갱신한다.
 *
 * 🔴 쓰기 전에 그 행의 A열을 확인한다
 *    행 번호는 정렬·삽입으로 흔들릴 수 있다. 기대한 candidateId 가 아니면 **쓰지 않고 멈춘다** —
 *    남의 행을 덮어쓰는 것이 빈 행에 쓰는 것보다 훨씬 수습하기 어렵다.
 *    빈 A열은 허용한다(부분 입력된 행을 완성하는 bootstrap 경로).
 *
 * 🔴 write 토큰을 받는 유일한 함수다. 늘리지 않는다 — micro-seed-read.mjs 가드가 센다.
 *
 * @param mode       'bootstrap'(A:Q 17열 완성) | 'columns'(허용 열만)
 * @param rowNumber  1-based. 헤더가 1행이므로 첫 후보는 2
 * @param values     bootstrap 모드의 17개 값 (buildSheetRow 결과)
 * @param cells      columns 모드의 { 열이름: 값 }
 * @param expectId   그 행에 있어야 할 candidateId
 */
export async function updateCandidateRow({ mode = 'columns', sheetId, tab, rowNumber, values, cells, expectId }) {
  const id = (sheetId ?? process.env[MICRO_SEED_SHEET_ID_ENV] ?? '').trim()
  if (!id) throw new Error(`${MICRO_SEED_SHEET_ID_ENV} 가 설정되지 않았다.`)

  const tabName = (tab ?? SHEET_TAB_NAME).trim() || SHEET_TAB_NAME
  const plan = planSheetWrite({ mode, rowNumber, values, cells, tab: tabName })
  if (!plan.ok) throw new Error(plan.reason)

  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: [SHEET_WRITE_SCOPE] })
  const client = await auth.getClient()
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}`

  // ① 대상 행 확인 — 기대한 행이 맞는지 본다
  const idCell = `${tabName}!A${rowNumber}:A${rowNumber}`
  const check = await client.request({
    url: `${base}/values/${encodeURIComponent(idCell)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    method: 'GET',
  })
  const existingId = String(check?.data?.values?.[0]?.[0] ?? '').trim()
  if (existingId && expectId && existingId !== expectId) {
    throw new Error(
      `행 ${rowNumber} 의 candidateId 가 다르다 (시트: "${existingId}" / 기대: "${expectId}"). 덮어쓰지 않는다.`,
    )
  }
  if (!existingId && mode === 'columns') {
    throw new Error(`행 ${rowNumber} 이 비어 있다. columns 모드는 기존 행만 갱신한다.`)
  }

  // ② 덮어쓰기. RAW 로 보낸다 — USER_ENTERED 는 시트가 값을 해석해
  //    날짜 문자열을 날짜 셀로, 긴 숫자를 지수 표기로 바꿔 버린다.
  const res = await client.request({
    url: `${base}/values:batchUpdate`,
    method: 'POST',
    data: { valueInputOption: 'RAW', data: plan.updates.map((u) => ({ ...u, majorDimension: 'ROWS' })) },
  })

  return {
    mode,
    ranges: plan.updates.map((u) => u.range),
    updatedRows: res?.data?.totalUpdatedRows ?? 0,
    updatedColumns: res?.data?.totalUpdatedColumns ?? 0,
    updatedCells: res?.data?.totalUpdatedCells ?? 0,
    previousId: existingId || null,
  }
}
