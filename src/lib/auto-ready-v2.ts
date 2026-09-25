/**
 * 🔴 **자동 READY v2 — 판정 조각** (2026-09-25 · feat/auto-ready-v2)
 *
 * 🔴 **새 규칙을 만들지 않는다.** 아래는 PR #565(`src/lib/auto-ready.ts`)에서 검증된
 *    순수 판정 조각을 **그대로** 옮긴 것이다. #565 는 병합·rebase·cherry-pick 하지 않고
 *    read-only 참고로만 썼다. 계약 값은 main 의 `AUTO_READY_CONTRACT` 가 정본이다.
 *
 * 🔴 이 파일은 순수 함수만 둔다 — DB·파일·네트워크·env 를 모른다.
 *    도장을 찍는 쓰기 경로는 아직 없다(운영 변수·flag 변경 금지 — 켤 수 없다).
 */
import { AUTO_READY_CONTRACT } from './supply-schedule-contract'

/** 🔴 사람 결정의 표식 — 기계는 이 값을 **절대** 쓰지 않는다(founder 위장 금지) */
export const HUMAN_DECIDER = 'founder'
/** 🔴 자동 판정의 표식 — 사람 값과 섞이지 않는 별개 문자열이다 */
export const AUTO_DECIDER = 'auto-ready:v1'

/** 계약 값은 정본을 그대로 쓴다 — 여기서 다시 적지 않는다 */
export const CONTRACT = AUTO_READY_CONTRACT

/**
 * 🔴 경고 = 저장 게이트가 남긴 `holds`·`blocks`. 기록 자체가 없으면 그것도 경고다.
 *    의미 검수 판정이 기록돼 있지 않아도 경고다 — **재지 않은 것을 이상 없음으로 읽지 않는다.**
 *    이 경고는 후보 생성도 사람 검토도 막지 않는다. 자동 READY 에서만 뺀다.
 */
export const SEMANTIC_RECORD_KEY = 'semanticReview'
export const NO_SEMANTIC_RECORD = 'SEMANTIC_REVIEW_MISSING'

export function warningsOfGate(gate: unknown): string[] {
  if (gate === null || typeof gate !== 'object') return ['gateResults 없음']
  const g = gate as Record<string, unknown>
  const arr = (k: string): string[] => (Array.isArray(g[k]) ? (g[k] as unknown[]).map(String) : [])
  const out = [...arr('holds'), ...arr('blocks')]
  const rec = g[SEMANTIC_RECORD_KEY]
  if (rec === null || rec === undefined || typeof rec !== 'object') out.push(NO_SEMANTIC_RECORD)
  return out
}

/** 🔴 회귀 사례에서 나온 네 가지 — #565 가 실측으로 얻은 값이다 */
export const AUTO_READY_BLOCKERS = {
  /** 이미지가 있어야 성립하는 문장 (P08 실측) */
  imageDependent: /이런\s*(가죽|레더|옷)|이\s*옷\s*어(떨|떻)|사진\s*보|위\s*사진|여기\s*보/,
  /** 발행일 당일처럼 읽히는 표현 (P03 실측) */
  timeDrift: /오늘도|아직도\s*안|방금|어제\s*밤|지금\s*막/,
  /** 근거 없는 단정 */
  unsourcedClaim: /확실히|틀림없이|반드시\s*그렇/,
  /** 후속 뉴스가 있을 수 있는 시의성 소재 (P01 실측) */
  followUpLikely: /저격|논란|해명|사과|입장문|폭로/,
} as const

export type RowInput = {
  gateVerdict: string
  /** 생성 시점 게이트가 남긴 경고 코드 — 빈 배열이면 경고 없음 */
  warnings: readonly string[]
  /** 원천을 언제 봤는지 아는가 — 모르면 사람이 본다 */
  sourceCapturedKnown: boolean
  title: string
  body: string
}
export type RowVerdict = { auto: boolean; reasons: string[] }

/**
 * 🔴 **그 행이 자동 판정 대상인가** — "경고 없는 적격 후보" 하나다.
 *    하나라도 걸리면 **예외 묶음**으로 간다. 조용히 통과시키지 않는다.
 */
export function judgeRow(i: RowInput): RowVerdict {
  const reasons: string[] = []
  if (i.gateVerdict !== 'PASS') reasons.push(`gate=${i.gateVerdict}`)
  if (i.warnings.length > 0) reasons.push(`경고 ${i.warnings.join(',')}`)
  if (!i.sourceCapturedKnown) reasons.push('원천 수집 시각을 모른다')
  const both = `${i.title}\n${i.body}`
  for (const [name, re] of Object.entries(AUTO_READY_BLOCKERS)) {
    const hit = re.exec(both)
    if (hit !== null) reasons.push(`${name}="${hit[0]}"`)
  }
  return { auto: reasons.length === 0, reasons }
}

/** 🔴 한 행을 판정 입력으로 — 러너·그림자 판정·표본이 같은 함수를 쓴다 */
export function eligibilityOf(r: {
  gateVerdict: unknown
  gateResults: unknown
  title: string
  body: string
  sourceCapturedAt: Date | null
}): RowVerdict {
  return judgeRow({
    gateVerdict: String(r.gateVerdict),
    warnings: warningsOfGate(r.gateResults),
    sourceCapturedKnown: r.sourceCapturedAt !== null,
    title: r.title, body: r.body,
  })
}
