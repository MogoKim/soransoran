/**
 * Gate dry-run 전제 확인 — 🔴 순수 함수. DB · LLM · 파일 IO · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §1
 *
 * 🔴 왜 이 파일이 생겼나 (2026-09-01)
 *    persona-comment-dry-run 의 전제가 **"Persona 5명 전부 draft"** 였다.
 *    아무도 켜지지 않았던 시절에는 맞는 말이었고, 실제로 P05 를 켠 순간
 *    Gate 판정 도구 자체가 잠겼다 — 생성기를 붙여도 통과시킬 방법이 없어졌다.
 *
 *    가드를 없애지 않는다. **좁힌다.**
 *      전 → 전체 Persona 가 draft 여야 한다
 *      후 → **후보에 등장한 Persona** 가 생성 가능한 상태여야 한다
 *
 *    원래 가드가 지키려던 것은 "설정이 덜 된 페르소나로 판정하지 않는다" 이고,
 *    그건 status 가 아니라 **identity 유무**가 답한다. status 는 발화 허용 축이지
 *    판정 가능 축이 아니다(DB 모델 설계 §7-2 의 3층 분리).
 *
 * 🔴 후보에 등장하지 않은 페르소나 때문에 멈추지 않는다.
 *    P17 이 draft 든 retired 든, P05 후보를 판정하는 데 아무 상관이 없다.
 *
 * 🔴 이 파일은 Gate 판정 로직을 갖지 않는다. 전제만 본다.
 */

/** 생성·판정이 가능한 상태. 🔴 paused · retired 는 뺀다 — 운영자가 멈춘 것이다 */
export const GENERATABLE_STATUS: ReadonlySet<string> = new Set(['draft', 'active'])

export type PreflightPersona = {
  code: string
  status: string
  /** ⑦ 대조 근거. 🔴 비어 있으면 설정 모순을 볼 수 없다 */
  identity: unknown
}

export type PreflightBlockCode =
  | 'NO_CANDIDATES'
  | 'PERSONA_NOT_FOUND'
  | 'PERSONA_STATUS_BLOCKED'
  | 'PERSONA_IDENTITY_EMPTY'

export type PreflightBlock = { code: PreflightBlockCode; message: string }

export type PreflightPlan = {
  ok: boolean
  blocks: PreflightBlock[]
  /** 후보에 등장해 실제로 검사한 코드 (정렬됨) */
  used: string[]
  /** 후보에 없어 검사하지 않은 코드 (정렬됨) — 🔴 이것 때문에 멈추지 않는다 */
  ignored: string[]
}

/** identity 가 채워져 있는가. 🔴 빈 객체 · 빈 배열 · 빈 문자열은 '없음' 이다 */
function hasIdentity(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/**
 * 후보에 등장한 페르소나만 검사한다.
 *
 * 🔴 사유를 하나만 내고 멈추지 않는다 — 후보 파일을 한 번 고쳐 끝낼 수 있어야 한다.
 */
export function planPersonaPreflight(input: {
  candidateCodes: readonly string[]
  personas: readonly PreflightPersona[]
}): PreflightPlan {
  const blocks: PreflightBlock[] = []

  // 🔴 코드를 정규화한다. 파일이 손으로 쓰이므로 공백이 섞인다
  const used = [...new Set(input.candidateCodes.map((c) => (c ?? '').trim()).filter((c) => c !== ''))].sort()
  const byCode = new Map(input.personas.map((p) => [p.code, p]))
  const ignored = input.personas.map((p) => p.code).filter((c) => !used.includes(c)).sort()

  if (used.length === 0) {
    return {
      ok: false,
      blocks: [{ code: 'NO_CANDIDATES', message: '후보에 personaCode 가 없습니다' }],
      used, ignored,
    }
  }

  for (const code of used) {
    const persona = byCode.get(code)
    if (persona === undefined) {
      blocks.push({ code: 'PERSONA_NOT_FOUND', message: `${code} 를 찾을 수 없습니다` })
      continue
    }
    // 🔴 draft · active 만. paused · retired 는 사람이 멈춘 것이라 판정도 하지 않는다
    if (!GENERATABLE_STATUS.has(persona.status)) {
      blocks.push({
        code: 'PERSONA_STATUS_BLOCKED',
        message: `${code} 가 ${persona.status} 입니다 — draft · active 만 판정합니다`,
      })
    }
    // 🔴 원래 가드가 지키려던 것. status 가 아니라 여기가 답이다
    if (!hasIdentity(persona.identity)) {
      blocks.push({
        code: 'PERSONA_IDENTITY_EMPTY',
        message: `${code} 의 identity 가 비어 있습니다 — 설정 없이 판정하지 않습니다`,
      })
    }
  }

  return { ok: blocks.length === 0, blocks, used, ignored }
}

// ─────────────────────────────────────────────────────────
// 발행물 전제
// ─────────────────────────────────────────────────────────

export type PriorOutputBlockCode = 'POST_OUTPUT_EXISTS'

export type PriorOutputPlan = {
  ok: boolean
  blocks: Array<{ code: PriorOutputBlockCode; message: string }>
  /** 🔴 막지는 않되 반드시 알린다 */
  notes: string[]
}

/**
 * 이미 나간 발행물을 어떻게 볼 것인가.
 *
 * 🔴 원래 가드는 `Post.personaId != 0 || Comment.personaId != 0` 이면 중단이었다.
 *    "아직 아무것도 안 나갔다" 를 지키는 시대 표식이었고, 첫 댓글 발행(2026-09-01)으로
 *    그 시대가 끝났다. 그런데 이 도구는 **판정만 하는 read-only 도구**라
 *    이미 나간 댓글이 판정을 틀리게 만들지 않는다.
 *
 * 🔴 그렇다고 전부 없애지 않는다. 두 축을 갈라 둔다:
 *      Comment  발행이 시작됐다 — 사람이 연 것이다. 알리고 진행한다
 *      Post     🔴 글 발행 경로는 **열린 적이 없다.** 여기 숫자가 있으면
 *               우리가 모르는 경로가 있다는 뜻이다 — 멈춘다
 */
export function planPriorOutputPrecondition(input: {
  personaPosts: number
  personaComments: number
}): PriorOutputPlan {
  const blocks: PriorOutputPlan['blocks'] = []
  const notes: string[] = []

  if (input.personaPosts > 0) {
    blocks.push({
      code: 'POST_OUTPUT_EXISTS',
      message:
        `Post.personaId 가 ${input.personaPosts} 건입니다 — 글 발행 경로는 열린 적이 없습니다. ` +
        '모르는 경로가 있다는 뜻이므로 멈춥니다',
    })
  }
  if (input.personaComments > 0) {
    notes.push(`이미 발행된 페르소나 댓글 ${input.personaComments}건이 있습니다 (사람이 연 경로)`)
  }

  return { ok: blocks.length === 0, blocks, notes }
}
