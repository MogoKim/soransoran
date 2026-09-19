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

/**
 * 🔴 **제목을 포함한 저장 원문 총량의 상한**이다 (기존 bodyHead 예산과 같은 300자).
 *
 *    앞판은 본문만 세어서 **제목 100자 + 본문 300자 = 400자**가 조용히 통과했다.
 *    상한은 "우리가 원문에서 들고 있는 글자 수" 전체에 걸린다.
 */
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
  /** 실제로 담은 본문 글자 수 (제목 제외) */
  bodyEvidenceChars: number
  /** 🔴 **제목까지 합친 저장 원문 총량** — 예산이 걸리는 값은 이것이다 */
  totalEvidenceChars: number
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

/**
 * 🔴 **낱말 하나로 막지 않는다.** *"사진 정리하다 울었어요"* 는 완결된 글이고,
 *    *"아래 사진 보시고 알려주세요"* 는 사진을 봐야 아는 글이다. 가르는 것은
 *    **지시어 + 보라는 요청**이지 `사진` 이라는 낱말이 아니다.
 *    앞판은 낱말만 보고 정상 글을 막았다.
 */
const DEICTIC = '(?:이|그|저|아래|위|여기|첨부(?:한|된)?|다음|밑)'
const VISUAL = '(?:사진|이미지|짤|캡처|캡쳐|그림|영상)'
const ASK_TO_SEE = '(?:보시고|보세요|봐\\s*주|참고|참조|확인)'
const NEEDS_IMAGE_RE = new RegExp(
  `${DEICTIC}\\s*${VISUAL}|${VISUAL}\\s*(?:처럼|같이)?\\s*${ASK_TO_SEE}|${VISUAL}\\s*첨부`,
)
const NEEDS_LINK_RE = /\[링크\]|링크\s*(?:참고|참조|보세요|확인|겁니다)|주소\s*남겨|여기\s*클릭/
const NEEDS_PRIOR_RE = /지난\s*(?:글|번\s*글)|앞\s*글|이전\s*글|전에\s*쓴\s*글|앞서\s*말|그\s*글\s*보고|이어서/

/**
 * 🔴 **명시 낱말이 없어도 앞 대화를 알아야 하는 글이 있다.**
 *    가리키는 말만 있고 가리킬 것이 글 안에 없으면 이어지는 글이다 —
 *    *"그거 어떻게 됐어요?"* 처럼.
 */
const BARE_DEICTIC_RE = /(?:그거|그건|그게|저거|이거)\s*(?:어떻게|어떤|왜|언제|누가)?/
/**
 * 🔴 **가리킬 것이 글 안에 있는가** — 낱말 수로 본다.
 *
 *    한국어 형태소 분석 없이 "명사인가" 를 가릴 수 없다. 대신 **글에 재료가
 *    얼마나 있는가**를 본다 — 가리키는 말을 빼고 남는 것이 이보다 적으면
 *    가리킬 것이 글 안에 없다고 본다.
 *    🔴 어림이다. 그래서 **짧은 글에만** 걸리고, 재료가 있는 글은 통과한다.
 */
export const DEICTIC_ANTECEDENT_MIN_TOKENS = 6
function hasAntecedent(text: string): boolean {
  const words = new Set(
    text.replace(/(?:그거|그건|그게|저거|이거|그것|이것)/g, ' ')
      .split(/[^가-힣A-Za-z0-9]+/).filter((w) => w.length >= 2),
  )
  return words.size >= DEICTIC_ANTECEDENT_MIN_TOKENS
}

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

  const whole = `${title}\n${body}`
  const reasons: InsufficientReason[] = []
  if (body === '') reasons.push('emptyBody')
  if (NEEDS_IMAGE_RE.test(whole)) reasons.push('needsImage')
  if (NEEDS_LINK_RE.test(whole)) reasons.push('needsLink')
  if (NEEDS_PRIOR_RE.test(whole)) reasons.push('needsPriorThread')
  // 🔴 가리키는 말만 있고 가리킬 것이 없다 — 앞 대화가 있어야 읽힌다
  if (BARE_DEICTIC_RE.test(whole) && !hasAntecedent(whole)) reasons.push('needsPriorThread')

  const len = body.length
  // 🔴 **제목이 먼저 예산을 쓴다.** 남은 만큼만 본문에서 들고 온다
  const bodyBudget = Math.max(0, budget - title.length)
  let omitted = 0
  if (len > 0 && len <= bodyBudget) {
    // 🔴 짧은 글 — 흐름을 통째로 남긴다
    spans.push({ kind: 'head', text: body, fromRatio: 0, toRatio: 1 })
  } else if (len > bodyBudget) {
    /**
     * 🔴 머리를 넉넉히, 꼬리를 짧게 — 사람이 쓴 글은 **마무리에 묻는 말**이 온다.
     *    그래서 꼬리를 버리면 참여 지점이 통째로 사라진다.
     */
    const tailChars = Math.min(Math.floor(bodyBudget * 0.4), len)
    const headChars = bodyBudget - tailChars
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
    totalEvidenceChars: bodyEvidenceChars + title.length,
    bodyLength: len,
    truncated: len > bodyBudget,
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
  // 🔴 제목까지 합친 총량이 예산이다 — 앞판은 본문만 세어 제목이 공짜였다
  if (p.totalEvidenceChars > budget) {
    bad.push(`저장 원문 총량 ${p.totalEvidenceChars}자 (제목 ${p.title.length} + 본문 ${p.bodyEvidenceChars}) — 예산 ${budget}자를 넘었다`)
  }
  const head = p.spans.find((s) => s.kind === 'head')
  const tail = p.spans.find((s) => s.kind === 'tail')
  if (head !== undefined && tail !== undefined && head.toRatio > tail.fromRatio) {
    bad.push('머리와 꼬리가 겹친다')
  }
  return bad
}
