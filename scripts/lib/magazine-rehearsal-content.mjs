/**
 * rehearsal 결정론 콘텐츠 — 가짜 Claude 가 돌려줄 brief·review, 가짜 ChatGPT 가 돌려줄 원고.
 *
 * 🔴 **판정을 흉내 내지 않는다.** 여기서 만든 글은 실제 정본 관문(verifyBrief · 형식 계약 · 원고 관문 ·
 *    md-to-draft · QA)을 그대로 지나야 한다. 통과 여부는 rehearsal 이 실제 래퍼로 확인한다.
 * 🔴 저장소에 이미 있는(사람이 검수해 합격한) brief·원고를 뼈대로 쓰고, 큐 행의 사실만 바꿔 끼운다.
 *    새로운 문장을 지어내 관문을 맞추지 않는다 — fixture 가 실제보다 강해지면 시험이 결함을 덮는다.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/** 가짜 ChatGPT 이미지 — 결정적 PNG (같은 sharp 로 같은 바이트). rehearsal 검사가 기대 변환 결과를 독립 계산할 때도 쓴다 */
export const FIXTURE_HERO_SPEC = Object.freeze({ width: 1536, height: 1024, channels: 3, background: { r: 214, g: 180, b: 150 } })
export const fixtureHeroPng = () => sharp({ create: FIXTURE_HERO_SPEC }).png().toBuffer()

/** 뼈대 — 저장소에 추적된 합격본 (rehearsal 루트의 저장소 사본에서 읽는다) */
export const SKELETON = Object.freeze({
  brief: { slug: 'avoiding-gatherings', title: '모임에 나가기 싫어질 때' },
})

const read = (p) => readFileSync(p, 'utf8')

/**
 * 가짜 Claude 출력 — `===BRIEF===` · `===REVIEW===` 두 마커 (brief-auto 의 splitOutput 계약).
 * @param {{repo:string, item:object, mode?:'good'|'no-format-contract'}} p
 */
export function claudeBriefOutput({ repo, item, mode = 'good' }) {
  const dir = join(repo, 'drafts', 'magazine', SKELETON.brief.slug)
  let brief = read(join(dir, 'brief.md'))
    .replaceAll(SKELETON.brief.title, item.title)
    .replace(/^cluster: .*$/m, `cluster: ${item.cluster}`)
  const review = read(join(dir, 'review.ts'))
    .replace(`slug: '${SKELETON.brief.slug}'`, `slug: '${item.slug}'`)
    // 🔴 위험 축 하나를 MEDIUM 으로 — 큐 riskLevel 이 무엇이든 G6 가 같은 근거(진료 확인 문장)를 요구한다
    .replace("medical: 'LOW'", "medical: 'MEDIUM'")
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
 * 가짜 ChatGPT 원고 — brief 뼈대와 짝인 합격 원고(avoiding-gatherings) + 이 글의 제목·클러스터·의료 여부·반드시 넣을 문장·CTA.
 *    medical 은 실제 QA 정본(`MEDICAL_REQUIRED`)으로 정한다 — fixture 가 규칙을 따로 갖지 않는다.
 * @param {{repo:string, draftsDir:string, slug:string, item:object, mode?:'good'|'too-short'|'brief-echo'|'qa-fail', medicalRequired?:Set<string>}} p
 *   qa-fail  형식 관문은 통과하지만 실제 QA 가 결정적으로 막는 원고 — medical: true 인데 진료 권고 문장이 없다
 */
export function manuscriptFor({ repo, draftsDir, slug, item, mode = 'good', medicalRequired = new Set() }) {
  const briefPath = join(draftsDir, slug, 'brief.md')
  const reviewPath = join(draftsDir, slug, 'review.ts')
  const brief = existsSync(briefPath) ? read(briefPath) : ''
  if (mode === 'brief-echo') return brief
  const fm = frontmatterOf(brief)
  const skeleton = read(join(repo, 'drafts', 'magazine', SKELETON.brief.slug, 'draft.md'))
  let body = skeleton.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\n\[CTA\][^\n]*\n?$/, '\n').trimEnd()
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
  return `${head}\n${body}\n\n[CTA] ${cta.href} | ${cta.label} | 비슷한 순간이 있었다면 편하게 이야기를 남겨 주세요.\n`
}
