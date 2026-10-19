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
import { resolveValidationProfile } from './magazine-validation-profile.mjs'

/** 가짜 ChatGPT 이미지 — 결정적 PNG (같은 sharp 로 같은 바이트). rehearsal 검사가 기대 변환 결과를 독립 계산할 때도 쓴다 */
export const FIXTURE_HERO_SPEC = Object.freeze({ width: 1536, height: 1024, channels: 3, background: { r: 214, g: 180, b: 150 } })
export const fixtureHeroPng = () => sharp({ create: FIXTURE_HERO_SPEC }).png().toBuffer()

/** 뼈대 — 저장소에 추적된 합격본 (rehearsal 루트의 저장소 사본에서 읽는다) */
export const SKELETON = Object.freeze({
  brief: { slug: 'avoiding-gatherings', title: '모임에 나가기 싫어질 때' },
})

const read = (p) => readFileSync(p, 'utf8')

/**
 * 🔴 **FINANCIAL 프로필 뼈대** (2026-10-19) — 관계 글 본문을 금융 제목에 끼우지 않는다.
 *    앞판은 모든 cluster 에 avoiding-gatherings 본문을 썼다. money-work 대상(national-pension-voluntary)은
 *    제목만 금융이고 본문은 모임 이야기라 FIN_AUTHORITY_LINE 으로 막혀 S1 이 연쇄 실패했다.
 *    이 fixture 는 #765 가 사실 정정한 **공개본**(health-insurance-after-retire)을 글자 그대로 렌더한 것이다 — 새 문장 0.
 *    저장소 drafts 의 금융 brief·review 는 #765 에서 바로잡은 틀린 지시(자동차 부과 · 퇴직일 기준 두 달 ·
 *    「되돌리기 어렵다」)를 아직 담고 있어 뼈대로 쓰지 않는다. brief·review 의 **형식 껍데기**는 템플릿 그대로다.
 *    읽을 때 확인한다 (fail-closed): 반드시 넣을 문장 5개가 본문에 글자 그대로 있다.
 */
export const FINANCIAL_SKELETON_FIXTURE = join('scripts', '__fixtures__', 'magazine', 'rehearsal-financial-skeleton.json')
export function profileSkeleton({ repo, item }) {
  if (resolveValidationProfile(item).profile !== 'FINANCIAL') return null
  const fx = JSON.parse(read(join(repo, FINANCIAL_SKELETON_FIXTURE)))
  if (fx.profile !== 'FINANCIAL' || fx.riskSentences?.length !== 5) throw new Error('rehearsal 금융 뼈대 fixture 모양이 다르다')
  const missing = fx.riskSentences.filter((s) => !fx.body.includes(s))
  if (missing.length) throw new Error(`rehearsal 금융 뼈대 — 반드시 넣을 문장이 본문에 없다: ${missing.join(' / ')}`)
  return fx
}

/** 템플릿 review 의 반드시 넣을 문장 — 뼈대가 바뀌면 brief 마커와 review 를 같은 글자로 바꿔 끼운다 */
const templateRiskSentences = (repo) => riskSentencesOf(read(join(repo, 'drafts', 'magazine', SKELETON.brief.slug, 'review.ts')))

/**
 * 가짜 Claude 출력 — `===BRIEF===` · `===REVIEW===` 두 마커 (brief-auto 의 splitOutput 계약).
 * @param {{repo:string, item:object, mode?:'good'|'no-format-contract'}} p
 */
export function claudeBriefOutput({ repo, item, mode = 'good' }) {
  const dir = join(repo, 'drafts', 'magazine', SKELETON.brief.slug)
  let brief = read(join(dir, 'brief.md'))
    .replaceAll(SKELETON.brief.title, item.title)
    .replace(/^cluster: .*$/m, `cluster: ${item.cluster}`)
  let review = read(join(dir, 'review.ts'))
    .replace(`slug: '${SKELETON.brief.slug}'`, `slug: '${item.slug}'`)
  const fx = profileSkeleton({ repo, item })
  if (fx) {
    // 🔴 금융 — 반드시 넣을 문장 5개(brief 마커 · review)를 같은 글자로, 위험 축·금지 패턴은 금융 review 그대로
    templateRiskSentences(repo).forEach((s, i) => {
      brief = brief.replaceAll(s, fx.riskSentences[i])
      review = review.replace(`'${s}'`, `'${fx.riskSentences[i]}'`)
    })
    review = review
      .replace(/risk: \{[^}]*\}/, `risk: {\n    medical: '${fx.risk.medical}',\n    money: '${fx.risk.money}',\n    legal: '${fx.risk.legal}',\n  }`)
      .replace(/forbiddenPatterns: \[[\s\S]*?\]/, `forbiddenPatterns: [\n${fx.forbiddenPatterns.map((p) => `    '${p}',`).join('\n')}\n  ]`)
  } else {
    // 🔴 위험 축 하나를 MEDIUM 으로 — 큐 riskLevel 이 무엇이든 G6 가 같은 근거(진료 확인 문장)를 요구한다
    review = review.replace("medical: 'LOW'", "medical: 'MEDIUM'")
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
  let body = fx
    ? fx.body.trimEnd()
    : read(join(repo, 'drafts', 'magazine', SKELETON.brief.slug, 'draft.md')).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\n\[CTA\][^\n]*\n?$/, '\n').trimEnd()
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
