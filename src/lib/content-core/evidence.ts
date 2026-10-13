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
/**
 * 🔴 **evidence-v2 (2026-10-13)** — 묶기 전에 수집기가 두 번 이어 붙인 본문을 걷어낸다(`collapseRepeatedBody`).
 *    옛 판은 같은 글이 두 번 든 300자를 다시 머리·꼬리로 잘라, 끝나지 않은 문장을 꼬리로 보냈다.
 */
export const EVIDENCE_PACKET_VERSION = 'evidence-v2'

/**
 * 🔴 **본문이 통째로 한 번 더 이어 붙은 것으로 볼 최소 길이** — 공백 뺀 글자 수.
 *    짧은 되풀이(`보고싶다 보고싶다`)는 사람이 쓴 강조일 수 있어 건드리지 않는다.
 */
export const REPEAT_MIN_CHARS = 20

/**
 * 🔴 **수집 상한에 닿았다고 볼 여유** — 수집기는 300자를 자른 뒤 끝 공백을 다듬는다.
 *    실측(2026-10-13 보조 Mac 3,124건): 상한에서 잘린 두 벌 본문의 길이는 296~300자였다.
 */
export const COLLECTION_TRIM_SLACK = 10

/**
 * 🔴 **수집기가 본문을 두 번 이어 붙였으면 앞의 한 벌만 남긴다** (2026-10-13 의미 손실 감사).
 *
 *    네이버 카페 본문 선택자는 감싸는 칸과 안쪽 칸을 함께 잡는다. 둘의 글자를 이으면 같은 글이
 *    두 번 든다 — 보조 Mac 수집 본문 386건 중 227건, 9/7 첫 수집부터 같은 비율이다.
 *    수집 상한(300자) 안에서 두 번째 벌은 첫 벌의 **앞부분**으로 잘린다.
 *    그 300자를 다시 머리·꼬리로 자르면 꼬리는 원문의 끝이 아니라 **두 번째 벌의 중간**이다 —
 *    생성은 끝나지 않은 문장을 마무리로 읽고, 검수는 그 잘린 문장이 초안에서 "사라졌다" 고 적었다.
 *
 * 🔴 **구조로만 판정한다** — 낱말 사전이 아니다. 공백·줄바꿈만 지우고 견줘, 둘 중 하나일 때만 걷어낸다:
 *    · 본문이 **같은 글 두 벌**이다
 *    · 두 번째 벌이 첫 벌의 첫머리와 글자 그대로 같고, 본문이 **수집 상한에 닿아** 거기서 잘렸다
 *    글 끝에 첫 줄을 다시 쓴 짧은 글 · 가운데 한 줄 되풀이 · 뒤가 달라지는 글 · `REPEAT_MIN_CHARS` 미만은 그대로 둔다.
 * 🔴 원문을 고치지 않는다 — 남기는 것은 수집된 첫 벌의 글자 그대로다.
 */
export function collapseRepeatedBody(body: string): { text: string; collapsed: boolean } {
  const t = body.trim()
  const flat = t.replace(/\s+/g, '')
  const keep = { text: t, collapsed: false }
  if (flat.length < REPEAT_MIN_CHARS * 2) return keep
  // 🔴 수집 상한은 근거 예산과 같은 300자다(`bodyHead`) — 두 값이 같은지는 생성 손실 검사가 본다
  const cutAtCollection = t.length > EVIDENCE_CHAR_BUDGET - COLLECTION_TRIM_SLACK
  const key = flat.slice(0, REPEAT_MIN_CHARS)
  for (let at = flat.indexOf(key, REPEAT_MIN_CHARS); at > 0; at = flat.indexOf(key, at + 1)) {
    const first = flat.slice(0, at)
    const rest = flat.slice(at)
    // 🔴 `rest` 는 `key` 로 시작하므로 이미 `REPEAT_MIN_CHARS` 이상이다
    if (rest !== first && !(cutAtCollection && first.startsWith(rest))) continue
    // 🔴 공백 뺀 위치 `at` → 원문 위치. 공백이 아닌 글자를 그만큼 센 자리에서 자른다
    let seen = 0
    let cut = 0
    while (cut < t.length && seen < at) {
      if (!/\s/.test(t[cut]!)) seen += 1
      cut += 1
    }
    return { text: t.slice(0, cut).trim(), collapsed: true }
  }
  return keep
}

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
 * 🔴 **외부 자료 없이는 수행할 수 없음이 명백할 때만** 막는다.
 *
 *    `이 사진` · `그 사진` 은 그 자체로 의존이 아니다 —
 *    *"이 사진 정리하다 울었어요"* · *"그 사진만 보면 엄마 생각이 나요"* 는
 *    완결된 글이다. 앞판은 지시어 + 사진이면 막아서 이런 글을 통째로 잃었다.
 *
 * 🔴 **애매한 의존은 여기서 막지 않는다.** 소재 판정(`coreMoment` 가 안 나오면 HOLD)과
 *    사람 검토가 맡는다. deterministic 은 확정 가능한 것만 본다.
 */
const VISUAL = '(?:사진|이미지|짤|캡처|캡쳐|그림|영상)'
/** 🔴 "보고 알려 달라" — 자료를 봐야 **글쓴이의 요청을 수행할 수 있다** */
const ASK_TO_SEE_RE = new RegExp(
  `${VISUAL}[^.!?\\n]{0,12}?(?:보시고|보세요|봐\\s*주|보고\\s*(?:알려|말씀|판단|골라|추천)`
  + `|참고\\s*(?:해|하)|확인\\s*(?:해|하)|첨부)`,
)
const NEEDS_LINK_RE = /\[링크\][^.!?\n]{0,12}?(?:보시고|보세요|확인|참고)|링크\s*(?:참고|참조|보세요|확인)|여기\s*클릭/
/** 🔴 앞 글을 **명시적으로 가리킬 때만** — `이어서` 같은 흔한 말은 세지 않는다 */
const NEEDS_PRIOR_RE = /지난\s*(?:글|번\s*글)|앞\s*글|이전\s*글|전에\s*쓴\s*글|앞\s*글에\s*이어/

// ─────────────────────────────────────────────────────────
// 🔴 **초안 쪽 자료 의존** (2026-09-26 P12 실측)
//
//   우리 글에는 **사진·첨부가 없다.** 기계 초안은 글자만 올라간다. 그런데 원문이 사진을
//   붙인 글(*"전 아렇게 펌한뒤"*)이면 초안이 그 사진을 **있는 것처럼** 말한다:
//     제목 *"예전에 했던 파마머리 생각나서 올려봐요"*
//     본문 *"이런 스타일 잘 소화하시는 분들도 계실까요?"*
//   읽는 사람은 "무엇을 올렸다는 거지? 어떤 스타일?" 에서 멈춘다 — 댓글이 나올 자리가 없다.
//
//   🔴 **같은 자료 사전(`VISUAL` · `ASK_TO_SEE_RE`)을 쓴다.** 원천 쪽 판정과 두 벌이 되면
//      한쪽이 낡는다. 원천 쪽 carve-out 도 그대로다 —
//      *"이 사진 정리하다 울었어요"* 는 **올리는 동작이 없으므로** 완결된 글이다.
//   🔴 **두 조건이 함께 있을 때만** 막는다(보수적). 하나만으로는 모호하다:
//      · `올려봐요` 만 — *"궁금해서 올려봐요"* 는 글을 올린다는 뜻일 수 있다
//      · `이런 스타일` 만 — 앞 문장이 글로 설명한 스타일을 받을 수 있다
// ─────────────────────────────────────────────────────────

/** 🔴 **올리는 동작** — 사진을 붙일 때의 말. 목적어가 글이면 자료가 아니다(아래 `TEXT_OBJECT_RE`) */
const PRESENT_VERB_RE =
  /올려\s*(?:봐요|봅니다|볼게요|봐용|드려요|드립니다|드릴게요|요)|올립니다|첨부\s*(?:해요|합니다|했어요|했습니다)|보여\s*드(?:려요|릴게요|립니다)/
/** 🔴 올리는 것이 **글**이다 — `글 올려봐요` · `질문 올립니다` 는 자료 의존이 아니다 */
const TEXT_OBJECT_RE = /글|질문|얘기|이야기|사연|고민|하소연|푸념|후기|사정/
/**
 * 🔴 **눈으로 봐야 하는 것을 가리키는 지시어** — `이런 스타일` · `요런 머리` · `이 모습`.
 *    `이런 경우` · `이런 일` 은 글이 가리킬 수 있으므로 여기 없다.
 *    🔴 지시어는 **어절 머리**여야 한다 — `딸아이 머리` 의 `이` 는 지시어가 아니다.
 *    🔴 `저` 는 넣지 않는다 — `저 머리 잘랐어요` 의 `저` 는 글쓴이 자신이다.
 */
const DEICTIC_VISUAL_RE = new RegExp(
  `(?<![가-힣])(?:이런|요런|저런|이|요)\\s*(?:${VISUAL}|스타일|머리|헤어|모습|옷|코디|색깔|색상|디자인|모양)`,
)

export const MEDIA_DEPENDENCY_KINDS = ['askToSee', 'presentsVisual', 'deicticPresentation'] as const
export type MediaDependencyKind = (typeof MEDIA_DEPENDENCY_KINDS)[number]

export type MediaDependency = {
  kind: MediaDependencyKind
  /** 🔴 글에 **실제로 있는** 문장 — 근거 없이 막지 않는다 */
  evidence: string
}

/** 문장 단위 — 마침표 없이 쓰는 글이 많아 줄바꿈도 경계다 */
const sentencesOf = (t: string): string[] =>
  t.split(/(?<=[.!?？。])\s+|\n+/).map((x) => x.trim()).filter((x) => x !== '')

/**
 * 🔴 **이 글이 우리 글에 없는 자료(사진·첨부)에 기대는가.** 초안 게이트가 부른다.
 *    · `askToSee`   — 원천 쪽과 같은 규칙: 자료를 보고 답해 달라
 *    · `presentsVisual` — 자료 낱말과 올리는 동작이 한 문장에 있다(`사진 올려봐요`)
 *    · `deicticPresentation` — 목적어 없는 올리는 동작 + 눈으로 봐야 하는 지시어(`이런 스타일`)
 *    못 찾으면 `null` 이다.
 */
export function readMediaDependency(text: string): MediaDependency | null {
  const t = S(text)
  const ss = sentencesOf(t)
  const ask = ss.find((x) => ASK_TO_SEE_RE.test(x))
  if (ask !== undefined) return { kind: 'askToSee', evidence: ask }
  const visual = new RegExp(VISUAL)
  const shown = ss.find((x) => PRESENT_VERB_RE.test(x) && visual.test(x))
  if (shown !== undefined) return { kind: 'presentsVisual', evidence: shown }
  // 🔴 올리는 것이 글이면 자료가 아니다 — 목적어가 비었을 때만 자료를 올린 것으로 본다
  const bare = ss.find((x) => PRESENT_VERB_RE.test(x) && !TEXT_OBJECT_RE.test(x))
  const deictic = ss.find((x) => DEICTIC_VISUAL_RE.test(x))
  if (bare !== undefined && deictic !== undefined) {
    return { kind: 'deicticPresentation', evidence: bare === deictic ? bare : `${bare} / ${deictic}` }
  }
  return null
}

/**
 * 마무리를 보여 주는가 — 물음표 · 종결 어미 · 부르는 말 중 하나라도.
 * 🔴 (quality-v3) 초안 게이트가 **원문 끝이 잘렸는가**를 이 판정 하나로 본다 — 두 벌을 만들지 않는다.
 */
export const CLOSING_RE = /[?？]|(?:요|다|죠|네요|까요|세요|군요|네|음)\s*[.!…]*\s*$/

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
  // 🔴 (evidence-v2) 자르기 **전에** 이어 붙은 두 번째 벌을 걷어낸다 — 길이·머리·꼬리가 전부 한 벌 기준이다
  const body = collapseRepeatedBody(S(input.maskedBody)).text
  const spans: EvidenceSpan[] = []
  if (title !== '') spans.push({ kind: 'title', text: title, fromRatio: 0, toRatio: 0 })

  const whole = `${title}\n${body}`
  const reasons: InsufficientReason[] = []
  if (body === '') reasons.push('emptyBody')
  if (ASK_TO_SEE_RE.test(whole)) reasons.push('needsImage')
  if (NEEDS_LINK_RE.test(whole)) reasons.push('needsLink')
  if (NEEDS_PRIOR_RE.test(whole)) reasons.push('needsPriorThread')

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
