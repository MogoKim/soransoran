/**
 * rehearsal 결정론 콘텐츠 — 가짜 Claude 가 돌려줄 brief·review, 가짜 ChatGPT 가 돌려줄 원고.
 *
 * 🔴 **판정을 흉내 내지 않는다.** 여기서 만든 글은 실제 정본 관문(verifyBrief · 형식 계약 · 원고 관문 ·
 *    md-to-draft · QA)을 그대로 지나야 한다. 통과 여부는 rehearsal 이 실제 래퍼로 확인한다.
 * 🔴 저장소에 이미 있는(사람이 검수해 합격한) brief·원고를 뼈대로 쓰고, 큐 행의 사실만 바꿔 끼운다.
 *    새로운 문장을 지어내 관문을 맞추지 않는다 — fixture 가 실제보다 강해지면 시험이 결함을 덮는다.
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { resolveValidationProfile } from './magazine-validation-profile.mjs'
import { parseQueueSource } from './magazine-load.mjs'
import { extractMarkers } from './magazine-brief-policy.mjs'

/** 가짜 ChatGPT 이미지 — 결정적 PNG (같은 sharp 로 같은 바이트). rehearsal 검사가 기대 변환 결과를 독립 계산할 때도 쓴다 */
export const FIXTURE_HERO_SPEC = Object.freeze({ width: 1536, height: 1024, channels: 3, background: { r: 214, g: 180, b: 150 } })
export const fixtureHeroPng = () => sharp({ create: FIXTURE_HERO_SPEC }).png().toBuffer()

/** 뼈대 — 저장소에 추적된 합격본 (rehearsal 루트의 저장소 사본에서 읽는다) */
export const SKELETON = Object.freeze({
  brief: { slug: 'avoiding-gatherings', title: '모임에 나가기 싫어질 때' },
})

const read = (p) => readFileSync(p, 'utf8')

/**
 * 🔴 **FINANCIAL 정상 후보 뼈대** (2026-10-19) — 한 질문의 큐 행 · 제목 · 본문을 한 묶음으로 쓴다.
 *    앞판은 모든 cluster 에 avoiding-gatherings 본문을 썼다. money-work 대상(national-pension-voluntary)은
 *    제목만 금융이고 본문은 모임 이야기라 FIN_AUTHORITY_LINE 으로 막혀 S1 이 연쇄 실패했다.
 *    이 fixture 는 #765 가 사실 정정한 **공개본**(health-insurance-after-retire)을 글자 그대로 렌더한 것이다 — 새 문장 0.
 *    그 질문의 큐 행(`queueBlock`)도 함께 들고 있다 — rehearsal 이 sandbox 사본 큐에만 넣는다.
 *    🔴 이 뼈대는 **출처 글과 slug·title 이 같은 대상**에만 쓴다. 금융 프로필이라는 이유로 다른 질문에 끼우지 않는다.
 *    저장소 drafts 의 금융 brief·review 는 #765 에서 바로잡은 틀린 지시(자동차 부과 · 퇴직일 기준 두 달 ·
 *    「되돌리기 어렵다」)를 아직 담고 있어 뼈대로 쓰지 않는다. brief·review 의 **형식 껍데기**는 템플릿 그대로다.
 */
export const FINANCIAL_SKELETON_FIXTURE = join('scripts', '__fixtures__', 'magazine', 'rehearsal-financial-skeleton.json')
export const FINANCIAL_SKELETON_SCHEMA = 'rehearsal-financial-skeleton/1'

/**
 * 🔴 **provenance fail-closed** — 쓰기 전에 전부 본다. 하나라도 어긋나면 throw (조용히 다른 뼈대로 넘어가지 않는다).
 *    schema · profile · 비어 있지 않은 본문 · sha256(body) = source.bodySha256 · 출처 slug·title ·
 *    반드시 넣을 문장 5개가 본문에 글자 그대로 · 큐 행이 같은 slug·title
 */
export function validateFinancialSkeleton(fx) {
  const bad = (why) => { throw new Error(`rehearsal 금융 뼈대 fixture 거부 — ${why}`) }
  if (fx?.schema !== FINANCIAL_SKELETON_SCHEMA) bad(`schema ${JSON.stringify(fx?.schema)} ≠ ${FINANCIAL_SKELETON_SCHEMA}`)
  if (fx.profile !== 'FINANCIAL') bad(`profile ${JSON.stringify(fx.profile)}`)
  if (typeof fx.body !== 'string' || !fx.body.trim()) bad('본문이 비었다')
  const sha = createHash('sha256').update(fx.body).digest('hex')
  if (sha !== fx.source?.bodySha256) bad(`본문 sha256 ${sha} ≠ source.bodySha256 ${fx.source?.bodySha256}`)
  if (typeof fx.source?.slug !== 'string' || !fx.source.slug || typeof fx.source?.title !== 'string' || !fx.source.title) bad('출처 slug·title 이 없다')
  if (typeof fx.source.description !== 'string' || !fx.source.description || createHash('sha256').update(fx.source.description).digest('hex') !== fx.source.descriptionSha256) bad('출처 description 이 없거나 sha256 이 다르다')
  if (!Array.isArray(fx.riskSentences) || fx.riskSentences.length !== 5) bad('반드시 넣을 문장이 5개가 아니다')
  const missing = fx.riskSentences.filter((s) => typeof s !== 'string' || !fx.body.includes(s))
  if (missing.length) bad(`반드시 넣을 문장이 본문에 없다: ${missing.join(' / ')}`)
  if (typeof fx.queueBlock !== 'string' || !fx.queueBlock.includes(`slug: '${fx.source.slug}',`) || !fx.queueBlock.includes(`title: '${fx.source.title}',`)) bad('큐 행이 출처 slug·title 과 다르다')
  return fx
}

/** 저장소(또는 sandbox 사본)의 금융 뼈대 — 검증을 지난 것만 돌려준다 */
export function financialSkeleton(repo) {
  return validateFinancialSkeleton(JSON.parse(read(join(repo, FINANCIAL_SKELETON_FIXTURE))))
}

export function profileSkeleton({ repo, item }) {
  if (resolveValidationProfile(item).profile !== 'FINANCIAL') return null
  const fx = financialSkeleton(repo)
  if (item?.slug !== fx.source.slug || item?.title !== fx.source.title) {
    throw new Error(`rehearsal 금융 원고 뼈대는 ${fx.source.slug} 「${fx.source.title}」 한 질문뿐이다 — ${item?.slug} 「${item?.title}」 에 다른 질문의 본문을 쓰지 않는다`)
  }
  return fx
}

/**
 * 🔴 **STANDARD 정상 성공 뼈대** (2026-10-19 · Codex 재검토 P1 — 거짓 녹색).
 *    앞판 manuscriptFor 는 비FINANCIAL 대상에 avoiding-gatherings 본문을 쓰고 제목만 바꿔 붙였다.
 *    S11 의 두 번째 대상·S12 gray 는 그 원고로 실제 등록·PR·병합·배포까지 PASS 했다 — 다른 질문 본문이 등록되는데 녹색이었다.
 *    이제 **정상 등록 경로**는 아래 공개본 출처와 slug·title 이 같은 대상만 그 본문을 받는다 (새 문장 0).
 *    출처가 아닌 대상의 원고는 여전히 avoiding 본문 뼈대지만 **등록되지 않는 실패 경로 전용**이다 —
 *    rehearsal-check 가 모든 시나리오의 등록 글 신원을 따로 단언한다 (등록되면 FAIL).
 */
export const STANDARD_SKELETON_FIXTURE = join('scripts', '__fixtures__', 'magazine', 'rehearsal-standard-skeletons.json')
export const STANDARD_SKELETON_SCHEMA = 'rehearsal-standard-skeletons/1'

/** provenance fail-closed — 출처마다 slug·title · 본문 sha256 · 큐 행 slug·title · 대표 문장 전부 본문에 */
export function validateStandardSkeletons(fx) {
  const bad = (why) => { throw new Error(`rehearsal STANDARD 뼈대 fixture 거부 — ${why}`) }
  if (fx?.schema !== STANDARD_SKELETON_SCHEMA) bad(`schema ${JSON.stringify(fx?.schema)} ≠ ${STANDARD_SKELETON_SCHEMA}`)
  if (!Array.isArray(fx.sources) || !fx.sources.length) bad('출처가 없다')
  const seen = new Set()
  for (const x of fx.sources) {
    if (typeof x?.slug !== 'string' || !x.slug || typeof x?.title !== 'string' || !x.title) bad('출처 slug·title 이 없다')
    if (seen.has(x.slug)) bad(`출처 slug 중복 ${x.slug}`)
    seen.add(x.slug)
    if (typeof x.body !== 'string' || !x.body.trim()) bad(`${x.slug} 본문이 비었다`)
    const sha = createHash('sha256').update(x.body).digest('hex')
    if (sha !== x.bodySha256) bad(`${x.slug} 본문 sha256 ${sha} ≠ bodySha256 ${x.bodySha256}`)
    if (!Array.isArray(x.representativeSentences) || x.representativeSentences.length < 3) bad(`${x.slug} 대표 문장이 3개 미만이다`)
    const missing = x.representativeSentences.filter((r) => typeof r !== 'string' || !r || !x.body.includes(r))
    if (missing.length) bad(`${x.slug} 대표 문장이 본문에 없다: ${missing.join(' / ')}`)
    if (typeof x.queueBlock !== 'string' || !x.queueBlock.includes(`slug: '${x.slug}',`) || !x.queueBlock.includes(`title: '${x.title}',`)) bad(`${x.slug} 큐 행이 출처 slug·title 과 다르다`)
  }
  return fx
}

export function standardSkeletons(repo) {
  return validateStandardSkeletons(JSON.parse(read(join(repo, STANDARD_SKELETON_FIXTURE))))
}

/**
 * 이 대상이 STANDARD 정상 출처인가 — slug 가 같으면 title 도 글자 그대로 같아야 한다 (다르면 throw).
 * 출처가 아니면 null — 그 원고는 실패 경로 전용 뼈대를 받는다.
 */
export function standardSkeleton({ repo, item }) {
  const fx = standardSkeletons(repo)
  const x = fx.sources.find((s) => s.slug === item?.slug)
  if (!x) return null
  if (item?.title !== x.title) throw new Error(`rehearsal STANDARD 뼈대 ${x.slug} 는 「${x.title}」 질문이다 — 「${item?.title}」 제목에 쓰지 않는다`)
  return x
}

/**
 * 🔴 **금융 정상 후보의 brief·review — 같은 질문에서 결정적으로 컴파일한다** (2026-10-19 · Codex 재검토 P1).
 *    앞판은 avoiding-gatherings brief·review 를 불러 제목·cluster·5문장만 바꿔 끼웠다. 그래서 금융 brief 의
 *    description·검색 의도·도입 장면·h2 설계가 모임 이야기로 남았다 (원고는 fixture 본문이라 등록 신원 검사로는 안 보였다).
 *    이제 근거는 같은 질문뿐이다 — 새 사실 문장 0:
 *      fixture 큐 행 (title · cluster · target · whyNow · notes) · #765 공개본 (description · 첫 문단 · h2 구성) ·
 *      fixture 반드시 넣을 문장 5개 · 금지 패턴 · 위험 축
 *    템플릿 brief 에서는 내용과 무관한 「공통 규칙」 형식 블록(출력 형식 · 허용 표기 · 공통 금지 · 톤 · 분량)만 가져온다.
 *    #765 이전 health drafts 는 근거로 쓰지 않는다.
 */
const queueItemOf = (fx) => parseQueueSource(`export const TOPIC_QUEUE = [\n${fx.queueBlock}]\n`, 'rehearsal-financial-skeleton.json')[0]
const h2sOf = (body) => body.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3))
const firstParagraphOf = (body) => body.split('\n\n').find((x) => x && !/^(##|>|- )/.test(x))
const tsString = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/** 템플릿 brief 의 「공통 규칙」 블록 — 형식만 (출력 형식의 title·cluster 는 이 글의 값으로) */
function commonRulesOf(repo, item) {
  const t = read(join(repo, 'drafts', 'magazine', SKELETON.brief.slug, 'brief.md'))
  const at = t.indexOf('\n---\n\n## 공통 규칙')
  if (at < 0) throw new Error('템플릿 brief 에 「공통 규칙」 블록이 없다')
  return t.slice(at + 1)
    .replace(`title: ${SKELETON.brief.title}`, `title: ${item.title}`)
    .replace(/^cluster: .*$/m, `cluster: ${item.cluster}`)
}

export function financialBriefReview({ repo, fx }) {
  const q = queueItemOf(fx)
  const h2s = h2sOf(fx.body)
  if (q.slug !== fx.source.slug || q.title !== fx.source.title) throw new Error('금융 큐 행이 출처와 다른 질문이다')
  if (h2s.length < 3 || h2s.length > CIRCLED.length) throw new Error(`금융 공개본 h2 수 ${h2s.length}`)
  const brief = [
    '---', `title: ${q.title}`, `description: ${fx.source.description}`, `cluster: ${q.cluster}`, 'medical: false', '---', '',
    '## 검색 의도', '', '이 글이 답하는 질문입니다.', '', `- "${q.title}"`, '', `답하는 범위: ${q.notes}`, '',
    '## 대상 독자', '', `- ${q.target}`, `- ${q.whyNow}`, '',
    '## 도입에서 해야 할 것', '', '공개본의 첫 장면으로 엽니다.', '', `> ${firstParagraphOf(fx.body)}`, '',
    `## 글 구조 (h2 ${h2s.length}개)`, '', ...h2s.map((h, i) => `- **h2 ${CIRCLED[i]}  ${h}**`), '', '마지막 줄은 자유게시판 CTA 한 줄로 닫습니다.', '',
    '## 반드시 그대로 넣을 문장', '', ...fx.riskSentences.map((x, i) => `${i + 1}. ${x}`), '',
    '## 절대 쓰지 말 것', '', ...fx.forbiddenPatterns.map((x) => `- "${x}"`), `- ${q.notes}`, '',
  ].join('\n') + commonRulesOf(repo, q)
  const review = [
    "import type { ReviewData } from '../_template/review'", '',
    'export const REVIEW: ReviewData = {',
    `  slug: ${tsString(q.slug)},`,
    '  summary: [', ...h2s.map((h) => `    ${tsString(h)},`), '  ],',
    '  riskSentences: [', ...fx.riskSentences.map((x) => `    ${tsString(x)},`), '  ],',
    `  risk: {\n    medical: '${fx.risk.medical}',\n    money: '${fx.risk.money}',\n    legal: '${fx.risk.legal}',\n  },`,
    '  factsToVerify: [', ...fx.riskSentences.map((x) => `    ${tsString(x)},`), '  ],',
    '  forbiddenPatterns: [', ...fx.forbiddenPatterns.map((x) => `    ${tsString(x)},`), '  ],',
    "  preparedAt: '2026-10-19',", "  preparedBy: 'Claude Code',", `  notes: ${tsString(q.notes)},`, '}', '',
  ].join('\n')
  return { brief, review }
}

/** avoiding-gatherings 의 내용 문구 — 금융 brief·review 에 한 줄도 남으면 안 된다 */
export const FINANCIAL_FOREIGN_PHRASES = Object.freeze(['모임', '약속', '친목', '관계의 무게', '카톡', '동창회', '사회성', '나가기 싫'])
/** #765 이전 health drafts 의 틀린 사실 문장 조각 — 되살아나면 안 된다 */
export const FINANCIAL_STALE_PHRASES = Object.freeze(['소득과 재산과 자동차', '소득, 재산, 자동차', '퇴직일로부터 두 달', '두 달 안에 신청', '자동차를 보유', '얼마나 나오나요', '60대 초반 퇴직'])

const sectionOf = (text, name) => {
  const lines = String(text ?? '').split('\n')
  const at = lines.findIndex((l) => l.startsWith(`## ${name}`))
  if (at < 0) return null
  const end = lines.findIndex((l, i) => i > at && (l.startsWith('## ') || l === '---'))
  return lines.slice(at + 1, end < 0 ? lines.length : end).join('\n')
}
const listOf = (reviewText, key) => {
  const m = new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`).exec(reviewText ?? '')
  return m ? [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'")) : null
}

/**
 * 🔴 **상류 신원 판정** — brief·review 가 금융 정상 후보와 같은 질문인가 (등록 글 신원 검사와 별도).
 *    순수 함수 · 문제 목록을 돌려준다 (빈 목록이면 같은 질문).
 */
export function financialUpstreamIdentity({ brief, review, fx }) {
  const p = []
  const fm = frontmatterOf(brief)
  const h2s = h2sOf(fx.body)
  if (fm.title !== fx.source.title) p.push(`frontmatter title ${fm.title}`)
  if (fm.description !== fx.source.description) p.push('description 이 공개본과 다르다')
  const intent = sectionOf(brief, '검색 의도') ?? ''
  if (!intent.includes(`- "${fx.source.title}"`)) p.push('검색 의도 primary query 가 이 질문이 아니다')
  const design = [...(sectionOf(brief, '글 구조') ?? '').matchAll(/^- \*\*h2 \S+\s+(.+)\*\*$/gm)].map((m) => m[1])
  if (JSON.stringify(design) !== JSON.stringify(h2s)) p.push('h2 설계가 공개본 구성과 다르다')
  if (JSON.stringify(extractMarkers(brief)) !== JSON.stringify(fx.riskSentences)) p.push('brief 반드시 넣을 문장이 fixture 와 다르다')
  if (!new RegExp(`slug:\\s*'${fx.source.slug}'`).test(review ?? '')) p.push('review slug 가 다르다')
  if (JSON.stringify(listOf(review, 'summary')) !== JSON.stringify(h2s)) p.push('review summary(글 설계)가 공개본 구성과 다르다')
  if (JSON.stringify(listOf(review, 'riskSentences')) !== JSON.stringify(fx.riskSentences)) p.push('review riskSentences 가 fixture 와 다르다')
  const all = `${brief}\n${review}`
  const foreign = FINANCIAL_FOREIGN_PHRASES.filter((x) => all.includes(x))
  if (foreign.length) p.push(`다른 질문 문구 ${foreign.join(',')}`)
  const stale = FINANCIAL_STALE_PHRASES.filter((x) => all.includes(x))
  if (stale.length) p.push(`옛 사실 문구 ${stale.join(',')}`)
  return p
}

/**
 * 가짜 Claude 출력 — `===BRIEF===` · `===REVIEW===` 두 마커 (brief-auto 의 splitOutput 계약).
 * @param {{repo:string, item:object, mode?:'good'|'no-format-contract'}} p
 */
export function claudeBriefOutput({ repo, item, mode = 'good' }) {
  const fx = profileSkeleton({ repo, item })
  let brief
  let review
  if (fx) {
    // 🔴 금융 — 같은 질문에서 컴파일한 brief·review (avoiding brief 부분 치환 0)
    ({ brief, review } = financialBriefReview({ repo, fx }))
  } else {
    const dir = join(repo, 'drafts', 'magazine', SKELETON.brief.slug)
    brief = read(join(dir, 'brief.md'))
      .replaceAll(SKELETON.brief.title, item.title)
      .replace(/^cluster: .*$/m, `cluster: ${item.cluster}`)
    review = read(join(dir, 'review.ts'))
      .replace(`slug: '${SKELETON.brief.slug}'`, `slug: '${item.slug}'`)
      // 🔴 위험 축 하나를 MEDIUM 으로 — 큐 riskLevel 이 무엇이든 G6 가 같은 근거(진료 확인 문장)를 요구한다
      .replace("medical: 'LOW'", "medical: 'MEDIUM'")
  }
  if (mode === 'no-format-contract') brief = stripFormatContract(brief)
  return `===BRIEF===\n${brief}\n===REVIEW===\n${review}\n`
}

/** 형식 계약(GF)을 깬 brief — `[CTA]` 지시·허용 표기·금지 규칙 줄을 지운다 (10/10 gray-hair 와 같은 모양) */
export function stripFormatContract(brief) {
  return brief.split('\n').filter((l) => !/\[CTA\]|허용 표기|금지 규칙|`\[|\| `/.test(l)).join('\n')
}

function frontmatterOf(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/** review.ts 의 riskSentences — 실행하지 않고 문자열만 꺼낸다 */
export function riskSentencesOf(reviewText) {
  const m = /riskSentences:\s*\[([\s\S]*?)\]/.exec(reviewText ?? '')
  if (!m) return []
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, "'"))
}

/** brief 의 `[CTA] href | 문구 | 앞 문장` 지시에서 href · 문구 */
export function ctaOf(briefText) {
  const m = /^\[CTA\]\s*(\S+)\s*\|\s*([^|\n]+?)\s*\|/m.exec(briefText ?? '')
  return m ? { href: m[1], label: m[2] } : { href: '/community/free', label: '자유게시판에 이야기 남기기' }
}

/**
 * 가짜 ChatGPT 원고 — brief 뼈대와 짝인 합격 원고(avoiding-gatherings · FINANCIAL 은 금융 정정 공개본) + 이 글의 제목·클러스터·의료 여부·반드시 넣을 문장·CTA.
 *    medical 은 실제 QA 정본(`MEDICAL_REQUIRED`)으로 정한다 — fixture 가 규칙을 따로 갖지 않는다.
 * @param {{repo:string, draftsDir:string, slug:string, item:object, mode?:'good'|'too-short'|'brief-echo'|'qa-fail', medicalRequired?:Set<string>}} p
 *   qa-fail        형식 관문은 통과하지만 실제 QA 가 결정적으로 막는 원고 — medical: true 인데 진료 권고 문장이 없다
 *   no-frontmatter 첫 줄에 머리말이 붙어 frontmatter 로 시작하지 않는 원고 (2026-10-11 gray-hair 모양)
 *   too-long       형식·QA 다른 규칙은 통과하지만 발행 길이 3000자를 넘는 원고 (2026-10-11 autumn 모양)
 *   short-description 형식·관문은 통과하지만 description 57자로 QA FAIL (2026-10-11 cold-weather 모양)
 *   cold-shape     description 57자 + 발행 길이 초과 (2026-10-12 cold-weather 모양)
 *   no-identity    정상 원고 — 다만 가짜 ChatGPT 가 대화 주소를 주지 않는다 (응답 신원 부족)
 */
export function manuscriptFor({ repo, draftsDir, slug, item, mode = 'good', medicalRequired = new Set() }) {
  const briefPath = join(draftsDir, slug, 'brief.md')
  const reviewPath = join(draftsDir, slug, 'review.ts')
  const brief = existsSync(briefPath) ? read(briefPath) : ''
  if (mode === 'brief-echo') return brief
  const fm = frontmatterOf(brief)
  // 🔴 뼈대 본문 — FINANCIAL 은 금융 정정 공개본 fixture, 그 밖은 brief 뼈대와 짝인 합격 원고
  const fx = profileSkeleton({ repo, item })
  // 🔴 정상 출처(금융·STANDARD)와 같은 질문이면 그 공개본 — 아니면 실패 경로 전용 뼈대(등록되면 rehearsal-check 가 FAIL)
  //    실패 경로 뼈대도 fixture 의 avoiding 공개본이다 — sandbox drafts 상태(curate 가 지운 폴더)에 기대지 않는다
  const sx = fx ? null : standardSkeleton({ repo, item })
  const foreign = () => standardSkeletons(repo).sources.find((x) => x.slug === SKELETON.brief.slug).body
  let body = (fx ? fx.body : sx ? sx.body : foreign()).trimEnd()
  const title = item?.title ?? fm.title ?? slug
  const cluster = item?.cluster ?? fm.cluster ?? 'relationship'
  const medical = mode === 'qa-fail' || medicalRequired.has(cluster) || String(fm.medical) === 'true'
  const cta = ctaOf(brief)
  if (mode === 'too-short') {
    return ['---', `title: ${title}`, `description: ${title}`, `cluster: ${cluster}`, `medical: ${medical}`, '---', '', '## 짧은 이야기', '', '짧습니다.', '', `[CTA] ${cta.href} | ${cta.label} | 남겨 주세요.`, ''].join('\n')
  }
  // 🔴 제목의 핵심어가 본문에 있어야 한다 (QA) — 뼈대 첫 문단 앞에 제목 문장 하나
  body = `${title} — 오늘은 이 이야기를 천천히 나눠 보려고 합니다.\n\n${body}`
  const sentences = existsSync(reviewPath) ? riskSentencesOf(read(reviewPath)) : []
  const missing = sentences.filter((x) => !body.includes(x))
  if (missing.length) body += `\n\n## 기억해 둘 문장\n\n${missing.map((x) => `> ${x}`).join('\n\n')}`
  const description = `${title} — 우리 또래가 비슷한 순간에 겪는 마음과 지금 해 볼 수 있는 작은 일을 차분히 정리해 봅니다. 서두르지 않고 한 걸음씩 살펴봅니다.`
  const head = ['---', `title: ${title}`, `description: ${description}`, `cluster: ${cluster}`, `medical: ${medical}`, '---', ''].join('\n')
  const full = `${head}\n${body}\n\n[CTA] ${cta.href} | ${cta.label} | 비슷한 순간이 있었다면 편하게 이야기를 남겨 주세요.\n`
  if (mode === 'no-frontmatter') return `요청하신 원고를 아래에 정리했습니다.\n\n${full}`
  if (mode === 'cold-shape') {
    // 2026-10-11/12 cold-weather 모양 — description 57자 + 발행 길이 3000자 초과 (형식·관문은 통과)
    const long = manuscriptFor({ repo, draftsDir, slug, item, mode: 'too-long', medicalRequired })
    return long.replace(/^description: .*$/m, `description: ${`${title} — 우리 또래 이야기`.padEnd(57, ' 이야기').slice(0, 57)}`)
  }
  if (mode === 'short-description') {
    // 형식·관문은 통과하지만 QA 가 description 길이(60~160자)로 FAIL — 2026-10-11 cold-weather 의 실제 사유 모양
    const d57 = `${title} — 우리 또래 이야기`.padEnd(57, ' 이야기').slice(0, 57)
    return full.replace(/^description: .*$/m, `description: ${d57}`)
  }
  if (mode === 'too-long') {
    // 뼈대 본문 문단을 한 번 더 이어 붙여 발행 길이(공백·줄바꿈 포함 3000자)를 넘긴다 — 다른 규칙은 그대로
    const extra = body.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('-')).join('\n\n')
    return `${head}\n${body}\n\n## 조금 더 이야기해 보면\n\n${extra}\n\n[CTA] ${cta.href} | ${cta.label} | 비슷한 순간이 있었다면 편하게 이야기를 남겨 주세요.\n`
  }
  return full
}

/**
 * 🔴 **지시받은 것만 고치는 재생성 응답** (2026-10-12 cold 재현 · fixture 가 실제보다 강하지 않게).
 *    실제 모델은 "실패하지 않은 frontmatter 값은 그대로 둔다" 는 지시를 지킨다 — 10/12 cold 는 재생성 두 번 내내
 *    description 57자가 그대로였다. 이 응답도 **보낸 글자에 적힌 위반만** 고친다:
 *      description 위반 문장이 실려 있으면 → description 을 90자 이상으로
 *      BODY_TOO_LONG 에 "최소 N자를 줄인다" 목표가 있으면 → 일반 문단을 덜어 N자 이상 줄인다
 *      목표 없이 "넘었다" 만 있으면 → 일반 문단 하나만 덜어 낸다 (10/12 관측: 3432 → 3267 → 3194)
 *    지정 문장(보낸 글자의 brief 지정 문장이 든 줄 · 인용)·소제목·목록·CTA 는 건드리지 않는다.
 */
export function obedientRevision(typed) {
  const t = String(typed ?? '')
  const a = t.indexOf(CURRENT_DRAFT_BEGIN_MARK)
  const b = t.indexOf(CURRENT_DRAFT_END_MARK)
  if (a < 0 || b < a) return '현재 원고를 찾지 못했다'
  let draft = t.slice(a + CURRENT_DRAFT_BEGIN_MARK.length, b).trim()
  if (/description \d+자 — 허용 60~160자 밖/.test(t)) {
    draft = draft.replace(/^description: (.*)$/m, (_, d) => `description: ${`${d.trim()} — 같은 시기를 지나는 우리 또래가 겪는 마음과 지금 해 볼 수 있는 작은 일을 차분히 정리했습니다`.slice(0, 120)}`)
  }
  const long = /BODY_TOO_LONG: 본문 \d+자/.test(t)
  const need = Number((/최소 (\d+)자를 줄인다/.exec(t) ?? [])[1] ?? 0)
  // 패킷은 "지정 문장·CTA·소제목 구조는 유지" 라고 지시한다 — 보낸 글자에 실린 brief 의 지정 문장이 든 줄은 지우지 않는다
  const markerBlock = t.split('## 반드시 그대로 넣을 문장')[1] ?? ''
  const markers = [...markerBlock.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5)
  if (long) {
    const lines = draft.split('\n')
    const fmEnd = lines.indexOf('---', 1)
    let removed = 0
    let removedParas = 0
    for (let i = lines.length - 1; i > fmEnd; i--) {
      const l = lines[i]
      if (!l.trim() || /^(#|>|-|\[CTA\])/.test(l) || markers.some((m) => l.includes(m))) continue
      if (need ? removed >= need : removedParas >= 1) break
      removed += l.length + 2
      removedParas++
      lines.splice(i, 1)
    }
    draft = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  }
  return `${draft}\n`
}
const CURRENT_DRAFT_BEGIN_MARK = '===== 현재 원고 시작 (이 원고를 기준으로 실패 항목만 고친다) ====='
const CURRENT_DRAFT_END_MARK = '===== 현재 원고 끝 ====='
