/**
 * VE-M3 export 의 CSV 직렬화 — **side effect 가 없는 순수 함수만** 둔다
 *
 * 🔴 왜 분리했나
 *    fixture 가 `voice-m3-export.mts` 를 import 하자 그 파일의 `main()` 이
 *    모듈 로드 시점에 실행돼 **실제 export 가 돌아갔다.**
 *    검증하려고 부른 것이 작업을 일으키면 안 된다.
 *    검사 대상이 되는 로직은 실행 진입점과 같은 파일에 두지 않는다.
 */

/**
 * 🔴 CSV formula injection 방어 — 셀이 `=` `+` `-` `@` 로 시작하면
 *    Excel · Google Sheets 가 **수식으로 해석한다.**
 *    `notes` 는 LLM 출력이다. 우리가 쓴 문장이 아니라 모델이 만든 문장이고,
 *    그것을 사람이 스프레드시트로 연다 — 그 사이에 방어가 없으면 안 된다.
 *
 *    `=HYPERLINK("http://evil","click")` 한 줄이면 클릭 유도가 되고,
 *    구형 Excel 의 DDE(`+cmd|...`)는 외부 명령까지 닿는다.
 *
 * 판정 기준
 *    - **trim 한 값**으로 본다. 선행 공백 · 탭으로 회피하는 것을 막는다
 *      (` =SUM(A1)` 도 Excel 은 수식으로 읽는다).
 *    - 탭 · CR · LF 로 시작하는 것도 같은 이유로 위험 문자 취급한다.
 *    - **원본은 바꾸지 않는다.** 앞에 작은따옴표만 덧댄다 —
 *      Excel 은 이것을 "텍스트로 읽으라" 는 표식으로 쓰고 셀에는 보이지 않는다.
 *      trim 해서 저장하면 원문 데이터가 바뀐다. 우리는 표시만 중립화한다.
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/

export function neutralizeFormula(s: string): string {
  const t = s.trim()
  return t !== '' && FORMULA_LEAD.test(t) ? `'${s}` : s
}

/**
 * RFC4180 셀 직렬화.
 * 🔴 숫자 · 불리언은 중립화하지 않는다 — 음수 `-1` 이 `'-1` 이 되면
 *    스프레드시트가 텍스트로 읽어 **정렬 · 합계가 깨진다.**
 *    수식 위험은 문자열에서만 온다.
 * 🔴 중립화가 먼저, quoting 이 나중이다.
 */
export function csvCell(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const raw = v === null || v === undefined ? '' : String(v)
  const s = neutralizeFormula(raw)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV 본문을 만든다.
 * 🔴 `bom` 은 호출부가 정한다 — CSV 는 사람이 Excel 로 열고(BOM 필요),
 *    JSONL · manifest 는 기계가 읽는다(BOM 이 파서를 혼란시킨다).
 */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  bom: string,
): string {
  return bom
    + [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n')
    + '\n'
}
