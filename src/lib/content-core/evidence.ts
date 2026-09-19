/**
 * SourceEvidencePacket — 🔴 **원문에서 들고 오는 것의 전부이자 상한**
 *
 * 🔴 **입력은 이미 마스킹된 title·body 다.** 여기서 마스킹하지 않는다 —
 *    마스킹 정본은 수집기(`maskSensitive`)이고, 두 곳에서 하면 한쪽이 낡는다.
 *
 * 🔴 **저장 상한은 기존 `bodyHead` 예산과 같은 300자다.** 늘리지 않는다.
 *    짧은 글은 흐름을 통째로 남기고, 긴 글은 겹치지 않는 머리·꼬리만 남긴다.
 *    잘라 낸 가운데는 **위치 비율로만** 남긴다 — 전문을 보관하지 않기 위해서다.
 *
 * 🔴 **반응 신호(댓글·조회·신선도)는 여기 들어오지 않는다.** 그것은 어디에 먼저
 *    돈을 쓸지 정하는 값이지 이 글이 무슨 이야기인지와 무관하다.
 */

/** 🔴 기존 bodyHead 예산과 같은 값 — 여기서 새 예산을 만들지 않는다 */
export const EVIDENCE_CHAR_BUDGET = 300
export const EVIDENCE_PACKET_VERSION = 'evidence-v1'

/**
 * 🔴 가운데를 이만큼 넘게 버렸는데 꼬리가 마무리를 보여 주지 못하면
 *    **무슨 이야기인지 확인하지 못한 것**이다. 지어내지 않고 insufficient 로 둔다.
 */
export const OMITTED_CORE_RATIO = 0.5

export type EvidenceSpanKind = 'title' | 'head' | 'tail'

export type EvidenceSpan = {
  kind: EvidenceSpanKind
  text: string
  /** 원문 본문에서의 위치 — 0~1. 🔴 전문을 담지 않으므로 비율로만 남긴다 */
  fromRatio: number
  toRatio: number
}

export type ContextSufficiency = 'sufficient' | 'insufficient'

export type InsufficientReason =
  | 'emptyBody'
  | 'needsImage'
  | 'needsLink'
  | 'needsPriorThread'
  | 'middleUnverified'

export const INSUFFICIENT_REASON_LABEL: Readonly<Record<InsufficientReason, string>> = {
  emptyBody: '본문이 없다',
  needsImage: '사진 없이는 무슨 이야기인지 알 수 없다',
  needsLink: '링크를 열어야 알 수 있다',
  needsPriorThread: '앞 글·앞 대화를 알아야 이어진다',
  middleUnverified: '가운데를 확인하지 못했고 꼬리도 마무리를 보여 주지 않는다',
}

export type SourceEvidencePacket = {
  sourceArticleId: string
  title: string
  spans: EvidenceSpan[]
  /** 실제로 담은 글자 수 (제목 제외) */
  bodyEvidenceChars: number
  /** 마스킹된 원문 본문의 길이 — 🔴 길이만이다. 본문을 담지 않는다 */
  bodyLength: number
  truncated: boolean
  /** 버린 가운데의 비율 */
  omittedRatio: number
  contextSufficiency: ContextSufficiency
  insufficientReasons: InsufficientReason[]
  packetVersion: string
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 사진·링크·앞 대화에 기대는 글인가 — 🔴 있으면 **만들지 않는다** */
const NEEDS_IMAGE_RE = /사진|이미지|짤|캡처|캡쳐|아래 그림|위 그림|첨부/
const NEEDS_LINK_RE = /\[링크\]|링크\s*(참고|참조|보세요|겁니다)|주소\s*남겨|여기\s*클릭/
const NEEDS_PRIOR_RE = /지난\s*(글|번\s*글)|앞\s*글|이전\s*글|전에\s*쓴\s*글|앞서\s*말|그\s*글\s*보고/

/** 마무리를 보여 주는가 — 물음표 · 종결 어미 · 부르는 말 중 하나라도 */
const CLOSING_RE = /[?？]|(?:요|다|죠|네요|까요|세요|군요|네|음)\s*[.!…]*\s*$/

/**
 * 🔴 **머리와 꼬리를 겹치지 않게 자른다.**
 *    짧은 글은 머리 하나로 통째로 남는다 — 억지로 둘로 나누지 않는다.
 */
export function buildEvidencePacket(input: {
  sourceArticleId: string
  /** 🔴 이미 마스킹된 제목 */
  title: string
  /** 🔴 이미 마스킹된 본문 */
  maskedBody: string
  budget?: number
}): SourceEvidencePacket {
  const budget = input.budget ?? EVIDENCE_CHAR_BUDGET
  const title = S(input.title)
  const body = S(input.maskedBody)
  const spans: EvidenceSpan[] = []
  if (title !== '') spans.push({ kind: 'title', text: title, fromRatio: 0, toRatio: 0 })

  const reasons: InsufficientReason[] = []
  if (body === '') reasons.push('emptyBody')
  if (NEEDS_IMAGE_RE.test(`${title}\n${body}`)) reasons.push('needsImage')
  if (NEEDS_LINK_RE.test(body)) reasons.push('needsLink')
  if (NEEDS_PRIOR_RE.test(body)) reasons.push('needsPriorThread')

  const len = body.length
  let omitted = 0
  if (len > 0 && len <= budget) {
    // 🔴 짧은 글 — 흐름을 통째로 남긴다
    spans.push({ kind: 'head', text: body, fromRatio: 0, toRatio: 1 })
  } else if (len > budget) {
    /**
     * 🔴 머리를 넉넉히, 꼬리를 짧게 — 사람이 쓴 글은 **마무리에 묻는 말**이 온다.
     *    그래서 꼬리를 버리면 참여 지점이 통째로 사라진다.
     */
    const tailChars = Math.min(Math.floor(budget * 0.4), len)
    const headChars = budget - tailChars
    const head = body.slice(0, headChars)
    const tail = body.slice(len - tailChars)
    spans.push({ kind: 'head', text: head, fromRatio: 0, toRatio: headChars / len })
    spans.push({ kind: 'tail', text: tail, fromRatio: (len - tailChars) / len, toRatio: 1 })
    omitted = (len - headChars - tailChars) / len
    /**
     * 🔴 가운데를 절반 넘게 버렸는데 꼬리가 마무리를 보여 주지 않으면
     *    무슨 이야기인지 **확인하지 못한 것**이다.
     */
    if (omitted > OMITTED_CORE_RATIO && !CLOSING_RE.test(tail)) reasons.push('middleUnverified')
  }

  const bodyEvidenceChars = spans
    .filter((s) => s.kind !== 'title')
    .reduce((n, s) => n + s.text.length, 0)

  return {
    sourceArticleId: S(input.sourceArticleId),
    title,
    spans,
    bodyEvidenceChars,
    bodyLength: len,
    truncated: len > budget,
    omittedRatio: omitted,
    contextSufficiency: reasons.length > 0 ? 'insufficient' : 'sufficient',
    insufficientReasons: [...new Set(reasons)],
    packetVersion: EVIDENCE_PACKET_VERSION,
  }
}

/** 근거로 담은 글 전체 — 🔴 대조 검사가 "원문에 있던 말인가" 를 이걸로 본다 */
export function evidenceText(p: SourceEvidencePacket): string {
  return p.spans.map((s) => s.text).join('\n')
}

/** 🔴 예산을 넘겼는가 — 러너가 저장 전에 스스로 본다 */
export function violatesEvidenceBudget(p: SourceEvidencePacket, budget = EVIDENCE_CHAR_BUDGET): string[] {
  const bad: string[] = []
  if (p.bodyEvidenceChars > budget) bad.push(`본문 근거 ${p.bodyEvidenceChars}자 — 예산 ${budget}자를 넘었다`)
  const head = p.spans.find((s) => s.kind === 'head')
  const tail = p.spans.find((s) => s.kind === 'tail')
  if (head !== undefined && tail !== undefined && head.toRatio > tail.fromRatio) {
    bad.push('머리와 꼬리가 겹친다')
  }
  return bad
}
