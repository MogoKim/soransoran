/**
 * hero 대체 텍스트·장면 — **검수 단계에서 만들고, 자동 레인이 읽는다.**
 *
 * 🔴 **왜 생겼나** (2026-09-15 진단).
 *    `magazine-auto-register-ready.mjs` 가 `drive()` 에 `alt: null` 을 고정으로 넘겼다.
 *    그래서 `imageMode=REQUIRED` 인 글은 **구조적으로 언제나** `HERO_ALT_REQUIRED` 로 막혔다.
 *    "alt 는 사람이 적는다" 는 원칙은 옳았지만, 사람이 적을 **자리가 없었다** —
 *    자동 레인이 읽을 수 있는 곳에 alt 가 저장된 적이 없다.
 *
 * 🔴 **그 자리를 review.ts 로 정한다.**
 *    review.ts 는 이미 "원고를 쓰지 않은 주체가 만드는 검수 데이터" 다
 *    (`drafts/magazine/_template/review.ts` 의 역할 분리). alt 는 화면에 무엇이
 *    보이는지를 사람이 판단해 적는 값이라 정확히 그 성격이다.
 *    brief 생성기(`magazine-brief-auto.mjs`)가 review.ts 를 만들 때 함께 적고,
 *    G7 스키마 검사가 형식을 본다.
 *
 * 🔴 **이것은 등급 게이트를 열지 않는다.**
 *    alt 가 생겼다고 HIGH 나 `autoEligible=false` 가 통과하지 않는다 —
 *    `gate()` 는 hero 보다 앞이고, 이 모듈은 gate 를 통과한 뒤에만 불린다.
 *
 * 🔴 **OPTIONAL 을 REQUIRED 로 만들지 않는다.**
 *    여기서 하는 일은 "REQUIRED 인데 alt 가 없어서 막히던 것" 을 없애는 것뿐이다.
 *    `imageMode=OPTIONAL` 은 여전히 기본 스킵이고 `--allow-optional` 이 있어야 만든다.
 *
 * 🔴 파일을 쓰지 않는다. 읽고 판정만 한다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DRAFTS_DIR } from './magazine-load.mjs'
import { checkAlt } from './magazine-hero.mjs'
import { BANNED_WORDS } from '../magazine-qa.mjs'

/**
 * 장면 서술에 들어오면 안 되는 것.
 *
 * 🔴 `magazine-hero.mjs` 의 `SAFETY_RULES` 는 **영어 프롬프트에 붙는 금지문**이다.
 *    사람이 한국어로 적는 장면 서술은 그 규칙을 우회할 수 있다 —
 *    "진료실에서 기다리는 여성" 이라고 적으면 프롬프트의 `no clinics` 와 정면으로 다툰다.
 *    그래서 **입력 쪽에서 한 번 더 본다.**
 */
export const FORBIDDEN_SCENE_TERMS = [
  '병원', '진료실', '검사실', '병실', '침상',
  '의사', '간호사', '가운', '청진기', '주사',
  '약', '영양제', '보조제',
  '눈물', '울고', '고통', '괴로워',
]

/** alt 에 들어오면 안 되는 것 — 브랜드 금지 호칭이 정본이다 */
export const FORBIDDEN_ALT_TERMS = [...BANNED_WORDS]

export const reviewPath = (slug) => join(DRAFTS_DIR, slug, 'review.ts')

/**
 * review.ts 에서 hero 블록을 뽑는다.
 *
 * 🔴 vm 이나 tsx 로 평가하지 않는다. `magazine-hero.mjs` 의 `readDraftMeta` 와 같은
 *    방식으로 문자열에서 읽는다 — 검수 파일을 실행하지 않는 편이 안전하고,
 *    .mjs 에서 .ts 를 import 할 수도 없다.
 *
 * @returns {{alt: string|null, scene: string|null, present: boolean}}
 */
export function parseHeroBlock(src) {
  const block = /hero:\s*\{([\s\S]*?)\}/.exec(String(src ?? ''))
  if (block === null) return { alt: null, scene: null, present: false }

  const field = (k) => {
    const m = new RegExp(`${k}:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(block[1])
    return m === null ? null : m[1].replace(/\\'/g, "'")
  }
  return { alt: field('alt'), scene: field('scene'), present: true }
}

export function readHeroBrief(slug) {
  const path = reviewPath(slug)
  if (!existsSync(path)) return { alt: null, scene: null, present: false }
  return parseHeroBlock(readFileSync(path, 'utf8'))
}

/**
 * 자동 레인이 이 hero 정보를 그대로 써도 되는가.
 *
 * 🔴 `checkAlt` 를 다시 구현하지 않는다 — 길이(10~120자)와 "…여성" 종결은
 *    `magazine-hero.mjs` 가 정본이다. 여기서는 **그 위에 금지 표현만 덧댄다.**
 *
 * @returns {{ok: boolean, reasons: {code: string, why: string}[]}}
 */
export function validateHeroBrief({ alt, scene } = {}) {
  const reasons = []
  const fail = (code, why) => reasons.push({ code, why })

  const altValue = String(alt ?? '').trim()
  if (!altValue) {
    fail('HERO_ALT_MISSING', 'review.ts 에 hero.alt 가 없다 — 검수 단계에서 사람이 적는다')
    return { ok: false, reasons }
  }

  const shape = checkAlt(altValue)
  if (!shape.ok) fail('HERO_ALT_SHAPE', shape.why)

  for (const term of FORBIDDEN_ALT_TERMS) {
    if (altValue.includes(term)) fail('HERO_ALT_FORBIDDEN', `alt 에 금지 호칭이 있다: ${term}`)
  }

  // 🔴 scene 은 선택이다. 없으면 cluster 기본 장면을 쓴다(magazine-hero.mjs).
  //    있으면 반드시 검사한다 — 적어 둔 것이 프롬프트로 그대로 나간다.
  const sceneValue = String(scene ?? '').trim()
  if (sceneValue) {
    if (sceneValue.length < 10) fail('HERO_SCENE_SHAPE', `scene 이 너무 짧다 (${sceneValue.length}자)`)
    if (sceneValue.length > 200) fail('HERO_SCENE_SHAPE', `scene 이 너무 길다 (${sceneValue.length}자)`)
    for (const term of FORBIDDEN_SCENE_TERMS) {
      if (sceneValue.includes(term)) fail('HERO_SCENE_FORBIDDEN', `scene 에 금지 표현이 있다: ${term}`)
    }
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * 한 slug 의 hero 정보를 읽고 판정까지 한 결과.
 * `alt` 는 **통과했을 때만** 값이 있다 — 반쯤 맞는 alt 를 넘기지 않는다.
 */
export function resolveHeroBrief(slug) {
  const raw = readHeroBrief(slug)
  if (!raw.present) {
    return {
      ok: false,
      alt: null,
      scene: null,
      reasons: [{ code: 'HERO_BRIEF_MISSING', why: `review.ts 에 hero 블록이 없다 — drafts/magazine/${slug}/review.ts` }],
    }
  }
  const verdict = validateHeroBrief(raw)
  return { ok: verdict.ok, alt: verdict.ok ? raw.alt : null, scene: verdict.ok ? raw.scene : null, reasons: verdict.reasons }
}
