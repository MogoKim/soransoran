/**
 * 오리지널 초안 검수 화면 보조 (0022)
 *
 * 🔴 판정하지 않는다. 라벨과 표시 형식만 있다 —
 *    판정은 scripts/lib/original-post-gate.ts 하나뿐이고,
 *    화면이 제 나름의 기준을 갖기 시작하면 두 개의 진실이 생긴다.
 *
 * 🔴 목록에는 본문 전문을 내지 않는다. 첫 글자 + 길이만 —
 *    persona-admin.ts 의 maskCandidateText 와 같은 원칙이다.
 */

/** 대기열 상태 라벨 */
export const OP_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  APPROVED: '승인',
  EDITED: '수정 후 승인',
  DECLINED: '폐기',
  PUBLISHED: '발행됨',
  EXPIRED: '만료',
}

/**
 * 판정 라벨.
 *
 * 🔴 PASS 를 "통과" 라고만 쓰지 않는다. 통과로 읽히면 승인으로 읽힌다 —
 *    이 대기열의 PASS 는 "사람이 볼 차례" 라는 뜻이다.
 */
export const OP_VERDICT_LABEL: Record<string, string> = {
  PASS: '검수 대기',
  HOLD: '먼저 볼 것',
  BLOCK: '차단(적재 안 됨)',
}

/** 판정별 배지 색. 🔴 PASS 를 초록으로 칠하지 않는다 — 승인 신호로 읽힌다 */
export const OP_VERDICT_TONE: Record<string, string> = {
  PASS: 'border-gray-200 bg-gray-50 text-gray-700',
  HOLD: 'border-amber-200 bg-amber-50 text-amber-900',
  BLOCK: 'border-red-200 bg-red-50 text-red-900',
}

/** gate 사유 코드 → 사람 말 */
export const OP_REASON_LABEL: Record<string, string> = {
  // BLOCK — 이 화면에는 나타나지 않지만(적재 대상이 아님) 이력 표시를 위해 둔다
  SOURCE_ECHO: '원문 20자 유출',
  ORIGIN_URL: '출처 링크',
  ORIGIN_TRACE: '출처 흔적',
  EXTERNAL_ADDRESS: '외부 호칭',
  BANNED_TERM: '금지 낱말',
  CRITIQUE_PHRASE: '실패 표현',
  FORCED_CTA: '억지 마무리 호출',
  // HOLD
  QUESTION_MISSING: '질문 소실',
  QUESTION_OVERUSE: '질문 남발',
  WORD_SHARE_HIGH: '원문에 너무 붙음',
  WORD_SHARE_LOW: '원문에서 너무 멀어짐',
  OVER_EXPANDED: '과팽창',
  OVER_COMPRESSED: '과압축',
  MUST_KEEP_SHORT: '필수 디테일 부족',
  WATCH_PHRASE: '경계 표현',
  CLICHE_OPENER: '상투 시작',
  STRUCTURE_TRACE: '구조 흔적',
  CTA_IN_ASKING_POST: '마무리 호출(원문이 묻는 글)',
}

export type GateFindingRow = { code: string; detail: string }

/**
 * gateResults(Json) 를 화면용 행으로 편다.
 *
 * 🔴 모양이 다르면 조용히 비우지 않고 빈 배열을 준다 —
 *    화면이 깨지는 것보다 낫지만, 무엇이 없는지는 화면에 나와야 한다.
 */
export function toGateFindings(value: unknown): { blocks: GateFindingRow[]; holds: GateFindingRow[] } {
  const pick = (v: unknown): GateFindingRow[] => {
    if (!Array.isArray(v)) return []
    return v.flatMap((x) => {
      if (typeof x !== 'object' || x === null) return []
      const o = x as Record<string, unknown>
      if (typeof o.code !== 'string') return []
      return [{ code: o.code, detail: typeof o.detail === 'string' ? o.detail : '' }]
    })
  }
  if (typeof value !== 'object' || value === null) return { blocks: [], holds: [] }
  const o = value as Record<string, unknown>
  return { blocks: pick(o.blocks), holds: pick(o.holds) }
}

/** 🔴 목록용 — 첫 글자 + 길이. 본문 전문을 내지 않는다 */
export function maskDraft(value: string | null | undefined): string {
  const c = [...(value ?? '').trim()]
  return c.length === 0 ? '(비어 있음)' : `${c[0]}… (${c.length}자)`
}
