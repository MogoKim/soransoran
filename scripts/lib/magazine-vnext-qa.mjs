/**
 * Magazine vNext S4 — 원고 **결정론적 검증 · 수리 분류** (runbook §0.0B.3). AI 로 다시 심사하지 않는다.
 *
 * 판정은 기존 검증기를 그대로 쓴다 — 새 사본을 만들지 않는다.
 *   release 구조     lib/magazine-release.mjs articleProblems (release 가 쓰는 같은 함수)
 *   공통 QA          lib/magazine-qa-core.mjs checkArticleRows (legacy QA 의 checkArticle 그대로 · 최종 backstop)
 *   편집 판정        lib/magazine-editorial.mjs (1인칭 · 제목 형태 · 제목↔본문 · 진료 안내)
 *   프로필 · 단정    lib/magazine-profile-qa.mjs (공통 금지 + plan.forbiddenClaims 를 같은 규칙표로 대조)
 *   다루지 않을 주제 lib/magazine-forbidden.mjs judgeForbidden(plan.exclusions) — 제외 고지(면책 문장)는 면제된다
 *   분량             lib/magazine-body-length.mjs
 * vNext 에만 있는 것: 원고 밖의 말(메타 · 자리표시자 · AI 자기 언급) · 출처 없는 통계(사실 오류로 본다) · 구조 붕괴(h2 3개 미만).
 *
 * 분류(표 §0.0B.3)
 *   FIXED     고정 문장 — CTA 누락 · 목적지 · 중복 · 진료 안내 누락 · 마크다운 잔재 → 결정적으로 고친다(호출 0)
 *   FIELD     title · description · heroAlt 칸 하나 → 그 칸만 provider 수리
 *   SENTENCE  금지 패턴 · 메타 문장 하나 → 그 문장만 provider 재작성(빈 문자열이면 뺀다)
 *   REGEN     구조 붕괴 · 분량 · 1인칭 · 검색 의도 불일치 · 출처 없는 수치 · 분류 못 한 QA FAIL → 전체 재생성
 * 🔴 VALID 는 모든 검증기(구조 · QA backstop · 프로필 · vNext 규칙)가 FAIL 0 일 때만이다. 모르면 막는다.
 */
import { articleProblems, RELEASE_ARTICLE_SCHEMA } from './magazine-release.mjs'
import { CONTENT_PLAN_POLICY_BOARD } from './magazine-content-plan.mjs'
import { BANNED_WORDS, MEDICAL_ASSERTIONS, MEDICAL_REQUIRED } from './magazine-qa-constants.mjs'
import { measureBody, publishText, bodyBlocksText } from './magazine-body-length.mjs'
import { checkCareAdvice, checkFirstPerson, checkTitleBodyMatch, checkTitleForm } from './magazine-editorial.mjs'
import { isNegatedClaim, PROFILE_RULES, runProfileQA } from './magazine-profile-qa.mjs'
import { judgeForbidden } from './magazine-forbidden.mjs'
import { checkArticleRows } from './magazine-qa-core.mjs'

export const QA_ID = 'magazine-vnext-qa/1'
/** 부분 수리 최대 2곳 · 전체 재생성 최대 1회 (§0.0B.3 기본 상한) */
export const REPAIR_LIMITS = Object.freeze({ places: 2, regenerations: 1 })

/** 고정 문장 — 결정적 삽입에만 쓴다(기존 공개 글의 CTA 문구와 같은 말) */
export const CANONICAL_CTA = Object.freeze({
  '/community/free': { label: '자유게시판에 이야기 남기기', text: '비슷한 고민이 있다면 자유게시판에서 편하게 나눠 보세요.' },
  '/community/menopause': { label: '갱년기톡에 이야기 남기기', text: '비슷한 변화를 겪고 있다면 혼자 넘기지 말고 갱년기톡에서 편하게 나눠 보세요.' },
})
export const CANONICAL_CARE_LINE = '증상이 오래가거나 일상이 힘들 만큼 심해지면 병원에서 진료를 받아 확인해 보세요.'

/** plan.forbiddenClaims 의 낱말 → 같은 규칙표(profile QA)의 규칙. 표에 없는 낱말은 검증할 수 없다 → 생성 전 HOLD */
const FIN = PROFILE_RULES.FORBIDDEN.FINANCIAL
const CLAIM_RULES = Object.freeze({
  '의학·재정 단정': [...PROFILE_RULES.FORBIDDEN.MEDICAL, ...FIN.filter((r) => r.code !== 'FIN_PRODUCT_PUSH')],
  '제품 추천': FIN.filter((r) => r.code === 'FIN_PRODUCT_PUSH'),
})
export function claimRulesOf(plan) {
  const unmapped = (plan.forbiddenClaims ?? []).filter((c) => !CLAIM_RULES[c])
  return { ok: unmapped.length === 0, unmapped, rules: (plan.forbiddenClaims ?? []).flatMap((c) => CLAIM_RULES[c] ?? []) }
}

// vNext 규칙 — 원고 밖의 말 · 출처 없는 수치
const META_RULES = Object.freeze([
  ['META_AI_SELF', /(?:AI|인공지능|언어\s?모델)\s?(?:로서|으로서|입니다)|as an AI|language model|I(?:'m| am) an AI|죄송하지만|도와드릴 수 없|답변드릴 수 없/i],
  ['META_PLACEHOLDER', /\[[^\]\n]{0,40}\]|\{\{|\}\}|\bTODO\b|\bTBD\b|\bXXX\b|여기에\s?(?:입력|작성|내용)/],
  ['META_PROMPT_ECHO', /\b(?:primaryQuery|audienceSituation|answerScope|inclusions|exclusions|forbiddenClaims|relatedArticles|officialSourceUrls|validationProfile|heroScene|slugProposal|providerPlan|ProviderPlan)\b|요청하신|(?:다음|아래)은\s?[^.!?\n]{0,20}(?:원고|기사|초안)|원고를 작성|글자 수|^(?:제목|설명|description|title)\s?[:：]/i],
])
const MARKDOWN_RE = /\*\*|__|```|^#{1,6}\s|^\s*[-*]\s/m
const UNSOURCED_STAT_RE = /\d+(?:\.\d+)?\s*(?:%|퍼센트)|\d+\s*명\s*(?:중|가운데)\s*\d*|\d+(?:\.\d+)?\s*배\s*(?:높|낮|많|적|증가|감소|늘|줄)/
const URL_RE = /https?:\/\//i
const SENTENCES = (t) => String(t ?? '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

const PROBLEM_TEXT = Object.freeze({
  BANNED_WORD: `쓰지 않는 호칭(${BANNED_WORDS.join(' · ')})이 있다 — 우리 나이 · 우리 또래로 쓴다`,
  AGE_WORDING: `쓰지 않는 호칭(${BANNED_WORDS.join(' · ')})이 있다 — 우리 나이 · 우리 또래로 쓴다`,
  BRAND_LEAK: '다른 서비스 이름이 섞였다',
  MEDICAL_ASSERTION: '단정 표현(반드시 · 완치 · 효과적입니다 등)이 있다',
  EXTERNAL_LINK: '본문에 링크를 쓰지 않는다',
  META_AI_SELF: '원고 밖의 말(AI 자기 언급 · 거절)이 있다',
  META_PLACEHOLDER: '자리표시자(대괄호 · 중괄호 · 작성 안내)가 남았다',
  META_PROMPT_ECHO: '원고 밖의 말(작성 안내 · 입력 칸 이름 · 요청 확인)이 있다',
  EXCLUSION_TOPIC: '이 기사에서 다루지 않기로 한 주제를 다룬다',
  CLAIM_ASSERTION: '의학 · 재정 · 상품을 단정하거나 권한다',
  INTERNAL_MARKER: '기호 표식이 섞였다',
  TITLE_FORM: '제목은 8~60자이고 primaryQuery 의 핵심어를 담는다',
  TITLE_INVALID: '제목은 4~80자, 앞뒤 공백 없이',
  DESCRIPTION_LENGTH: 'description 은 90~120자 안팎(60~160자)이다',
  HEROALT_INVALID: 'heroAlt 는 이미지를 설명하는 4~120자 한 문장이다',
  DUPLICATE_TITLE: '이미 공개된 글과 제목이 같다',
  DUPLICATE_DESCRIPTION: '이미 공개된 글과 description 이 같다',
})

/** provider 출력 → release 원고(`magazine-release-article/1`). CTA 목적지 · medical 은 plan 이 정한다(provider 가 정하지 않는다) */
export function articleFromManuscript(value, plan) {
  const t = (s) => String(s ?? '').trim()
  return {
    schemaVersion: RELEASE_ARTICLE_SCHEMA,
    title: t(value.title), description: t(value.description), heroAlt: t(value.heroAlt),
    medical: MEDICAL_REQUIRED.has(plan.cluster),
    body: value.body.map((b) => {
      if (b.type === 'cta') return { type: 'cta', href: plan.cta.communityDestination, label: t(b.label), ...(t(b.text) ? { text: t(b.text) } : {}) }
      if (b.type === 'list') return { type: 'list', items: b.items.map(t), ...(b.ordered ? { ordered: true } : {}) }
      return { type: b.type, text: t(b.text) }
    }),
  }
}

// ── 문장 위치 ────────────────────────────────────────────────

/** 본문의 문장 칸 — { path, text } (cta 는 고정 문장 자리라 따로 다룬다) */
function textSlots(article) {
  const out = []
  article.body.forEach((b, i) => {
    if (['p', 'h2', 'h3', 'callout'].includes(b.type)) out.push({ path: [i], text: b.text })
    else if (b.type === 'list') b.items.forEach((x, j) => out.push({ path: [i, j], text: x }))
  })
  return out
}
const FIELDS = ['title', 'description', 'heroAlt']
const keyOf = (target) => (target.kind === 'field' ? `field:${target.field}` : `sentence:${target.path.join('.')}:${target.sentence}`)

/**
 * 원고 한 편 판정.
 * @param {{ article: object, plan: object, published: { slug: string, title: string, description: string }[] }} p
 * @returns {{ verdict: 'VALID'|'NEEDS_REPAIR'|'REGENERATE', issues: object[], warnings: string[], backstop: string[] }}
 */
export function validateArticle({ article, plan, published = [] }) {
  const issues = [], seen = new Set()
  const add = (code, cls, target = null, message = null) => {
    const k = `${code}|${cls}|${target ? keyOf(target) : ''}`
    if (seen.has(k)) return
    seen.add(k); issues.push({ code, class: cls, target, message: message ?? PROBLEM_TEXT[code] ?? code })
  }
  // ① release 구조 — 깨졌으면 다른 판정을 하지 않는다
  const ap = articleProblems(article, plan)
  const STRUCT = ['ARTICLE_SCHEMA', 'ARTICLE_BODY_INVALID', 'ARTICLE_BLOCK_TYPE', 'ARTICLE_BLOCK_KEYS', 'ARTICLE_BLOCK_TEXT', 'ARTICLE_MEDICAL_INVALID']
  for (const c of ap.filter((x) => STRUCT.includes(x))) add('STRUCTURE', 'REGEN', null, c)
  if (issues.length) return { verdict: 'REGENERATE', issues, warnings: [], backstop: [] }
  if (ap.includes('ARTICLE_TITLE_INVALID')) add('TITLE_INVALID', 'FIELD', { kind: 'field', field: 'title' })
  if (ap.includes('ARTICLE_DESCRIPTION_INVALID')) add('DESCRIPTION_LENGTH', 'FIELD', { kind: 'field', field: 'description' })
  if (ap.includes('ARTICLE_HEROALT_INVALID')) add('HEROALT_INVALID', 'FIELD', { kind: 'field', field: 'heroAlt' })

  // ② 문장 · 칸 단위 패턴
  const claim = claimRulesOf(plan)
  const markers = CONTENT_PLAN_POLICY_BOARD.text.internalMarkers
  const hitsOf = (s) => {
    const h = []
    if (BANNED_WORDS.some((w) => s.includes(w))) h.push('BANNED_WORD')
    if (markers.some((m) => s.includes(m))) h.push('INTERNAL_MARKER')
    if (MEDICAL_ASSERTIONS.some((w) => s.includes(w))) h.push('MEDICAL_ASSERTION')
    if (URL_RE.test(s)) h.push('EXTERNAL_LINK')
    for (const [code, re] of META_RULES) if (re.test(s)) h.push(code)
    for (const r of PROFILE_RULES.COMMON_FORBIDDEN) if (r.re.test(s)) h.push(r.code)
    for (const r of claim.rules) { const m = r.re.exec(s); if (m && !(r.negatable && isNegatedClaim(s, m))) h.push('CLAIM_ASSERTION') }
    if (judgeForbidden(s, plan.exclusions).violations.length) h.push('EXCLUSION_TOPIC')
    return [...new Set(h)]
  }
  const noSources = !(plan.officialSourceUrls ?? []).length
  for (const f of FIELDS) {
    for (const code of hitsOf(article[f])) add(code, 'FIELD', { kind: 'field', field: f })
    if (noSources && UNSOURCED_STAT_RE.test(article[f])) add('FACT_UNSOURCED', 'REGEN', null, `${f}: 출처 없는 수치`)
  }
  for (const slot of textSlots(article)) {
    for (const sentence of SENTENCES(slot.text)) {
      const target = { kind: 'sentence', path: slot.path, sentence }
      for (const code of hitsOf(sentence)) add(code, 'SENTENCE', target)
      if (noSources && UNSOURCED_STAT_RE.test(sentence)) add('FACT_UNSOURCED', 'REGEN', null, `출처 없는 수치: ${sentence.slice(0, 60)}`)
    }
    if (MARKDOWN_RE.test(slot.text)) add('MARKDOWN', 'FIXED', { kind: 'sentence', path: slot.path, sentence: slot.text })
  }
  // CTA — 고정 문장 자리
  const ctas = article.body.map((b, i) => [b, i]).filter(([b]) => b.type === 'cta')
  if (ctas.length === 0) add('CTA_MISSING', 'FIXED')
  if (ctas.length > 1) add('CTA_DUPLICATE', 'FIXED')
  for (const [b, i] of ctas) {
    if (b.href !== plan.cta.communityDestination) add('CTA_DESTINATION', 'FIXED')
    if ([b.label, b.text].filter(Boolean).some((s) => hitsOf(s).length || MARKDOWN_RE.test(s))) add('CTA_TEXT', 'FIXED', { kind: 'sentence', path: [i], sentence: b.label })
  }

  // ③ 칸 규칙 — QA core 와 같은 기준(설명 60~160 · 제목 형태 · 공개 글 중복)
  const descLen = article.description.length
  if (descLen < 60 || descLen > 160) add('DESCRIPTION_LENGTH', 'FIELD', { kind: 'field', field: 'description' })
  if (checkTitleForm(article.title).level === 'FAIL') add('TITLE_FORM', 'FIELD', { kind: 'field', field: 'title' })
  for (const o of published) {
    if (o.title === article.title) add('DUPLICATE_TITLE', 'FIELD', { kind: 'field', field: 'title' })
    if (o.description === article.description) add('DUPLICATE_DESCRIPTION', 'FIELD', { kind: 'field', field: 'description' })
  }

  // ④ 전체 재생성 — 구조 · 분량 · 화자 · 검색 의도
  const bodyText = bodyBlocksText(article)
  const len = measureBody(article)
  if (!len.hard.ok) add('BODY_LENGTH', 'REGEN', null, len.hard.message)
  const h2 = article.body.filter((b) => b.type === 'h2').length
  if (h2 < 3) add('STRUCTURE', 'REGEN', null, `h2 ${h2}개 — 3개 미만이면 구조가 무너진 응답으로 본다`)
  const voice = checkFirstPerson(bodyText)
  if (voice.level === 'FAIL') add('FIRST_PERSON', 'REGEN', null, voice.reason)
  const tb = checkTitleBodyMatch(article.title, bodyText)
  if (tb.level === 'FAIL') add('INTENT_TITLE_BODY', 'REGEN', null, tb.reason)
  const qb = checkTitleBodyMatch(plan.primaryQuery, `${article.title}\n${bodyText}`)
  if (qb.level === 'FAIL') add('INTENT_QUERY', 'REGEN', null, `검색어 핵심어가 원고에 없다 — ${qb.missing.join(' · ')}`)
  if (checkCareAdvice(bodyText, article.medical).level === 'FAIL') add('CARE_LINE_MISSING', 'FIXED')

  // ⑤ backstop — legacy QA 의 checkArticle · 프로필 QA 를 그대로. 분류한 문제가 없는데 FAIL 이 있으면 재생성(모르면 막는다)
  const rows = checkArticleRows({ slug: '(vnext)', title: article.title, description: article.description, cluster: plan.cluster, medical: article.medical, body: article.body,
    heroImage: { alt: article.heroAlt } }, { published })
  const backstop = rows.filter((r) => r.level === 'FAIL').map((r) => r.msg)
  const profile = runProfileQA({ profile: plan.validationProfile, title: article.title, bodyText: publishText(article) })
  if (!profile.ok) backstop.push(...profile.failures.map((f) => `${f.code}: ${f.sentence}`))
  if (!issues.length && backstop.length) add('QA_CORE_UNCLASSIFIED', 'REGEN', null, backstop.slice(0, 3).join(' | '))
  const warnings = rows.filter((r) => r.level === 'WARN').map((r) => r.msg)

  const verdict = issues.length === 0 ? 'VALID' : issues.some((i) => i.class === 'REGEN') ? 'REGENERATE' : 'NEEDS_REPAIR'
  return { verdict, issues, warnings, backstop }
}

// ── 수리 ─────────────────────────────────────────────────────

const clone = (a) => JSON.parse(JSON.stringify(a))
const stripMarkdown = (s) => s.replace(/\*\*|__|```/g, '').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*]\s+/gm, '').trim()

/** FIXED 를 결정적으로 고친다 — provider 호출 0. 고친 코드 목록을 돌려준다 */
export function applyFixedRepairs(article, issues, plan) {
  const a = clone(article), applied = []
  const fixed = issues.filter((i) => i.class === 'FIXED')
  const canon = CANONICAL_CTA[plan.cta.communityDestination]
  for (const i of fixed.filter((x) => x.code === 'MARKDOWN')) {
    const [bi, j] = i.target.path
    if (j === undefined) a.body[bi].text = stripMarkdown(a.body[bi].text)
    else a.body[bi].items[j] = stripMarkdown(a.body[bi].items[j])
    applied.push('MARKDOWN')
  }
  if (fixed.some((x) => ['CTA_DUPLICATE', 'CTA_DESTINATION', 'CTA_TEXT', 'CTA_MISSING'].includes(x.code))) {
    if (!canon) return { article, applied: [], blocked: 'CTA_CANONICAL_MISSING' }
    const lastCta = [...a.body].reverse().find((b) => b.type === 'cta')
    const keep = fixed.some((x) => x.code === 'CTA_TEXT') || !lastCta ? { type: 'cta', href: plan.cta.communityDestination, label: canon.label, text: canon.text } : { ...lastCta, href: plan.cta.communityDestination }
    a.body = [...a.body.filter((b) => b.type !== 'cta'), keep]
    applied.push(...fixed.filter((x) => x.code.startsWith('CTA_')).map((x) => x.code))
  }
  if (fixed.some((x) => x.code === 'CARE_LINE_MISSING')) {
    const at = a.body.findIndex((b) => b.type === 'cta')
    a.body.splice(at === -1 ? a.body.length : at, 0, { type: 'callout', text: CANONICAL_CARE_LINE })
    applied.push('CARE_LINE_MISSING')
  }
  return { article: a, applied: [...new Set(applied)].sort() }
}

/** provider 로 고칠 대상 — 칸 · 문장 단위로 묶는다(같은 자리의 여러 문제는 한 곳이다) */
export function repairTargetsOf(issues, article) {
  const by = new Map()
  for (const i of issues.filter((x) => x.class === 'FIELD' || x.class === 'SENTENCE')) {
    const k = keyOf(i.target)
    const cur = by.get(k) ?? { ...i.target, current: i.target.kind === 'field' ? article[i.target.field] : i.target.sentence, problems: [] }
    if (!cur.problems.includes(i.message)) cur.problems.push(i.message)
    by.set(k, cur)
  }
  return [...by.values()]
}

/** 수리 결과 반영 — 칸은 바꾸고, 문장은 그 문장만 바꾼다(빈 문자열이면 문장을 뺀다 · 빈 블록은 뺀다) */
export function applyReplacement(article, target, replacement) {
  const a = clone(article)
  const r = String(replacement ?? '').trim()
  if (target.kind === 'field') { a[target.field] = r; return { ok: r.length > 0, article: a } }
  const [bi, j] = target.path
  const block = a.body[bi]
  if (!block) return { ok: false, article }
  const cur = j === undefined ? block.text : block.items?.[j]
  if (typeof cur !== 'string' || !cur.includes(target.sentence)) return { ok: false, article }
  const next = cur.replace(target.sentence, r).replace(/\s{2,}/g, ' ').trim()
  if (j === undefined) block.text = next
  else block.items[j] = next
  if (j !== undefined && !next) block.items.splice(j, 1)
  if ((j === undefined && !next) || (block.type === 'list' && block.items.length === 0)) a.body.splice(bi, 1)
  return { ok: true, article: a }
}
