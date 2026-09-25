/**
 * hero 대체 텍스트·장면 — **검수 단계에서 만들고, 자동 레인이 읽는다.**
 *
 * 🔴 **왜 생겼나** (2026-09-15 진단).
 *    `magazine-auto-register-ready.mjs` 가 `drive()` 에 `alt: null` 을 고정으로 넘겼다.
 *    그래서 `imageMode=REQUIRED` 인 글은 **구조적으로 언제나** `HERO_ALT_REQUIRED` 로 막혔다.
 *    (역사) 옛 원칙은 "alt 는 사람이 적는다" 였으나 적을 자리가 없었다 —
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
 *    (역사) 그때는 alt 가 생겨도 등급이 막았다 — 지금은 등급이 막지 않는다.
 *    `gate()` 는 hero 보다 앞이고, 이 모듈은 gate 를 통과한 뒤에만 불린다.
 *
 * 🔴 **자동 레인에는 alt 를 적어 줄 사람이 없다** (2026-09-24 실측).
 *    gate 를 통과한 후보 3건이 전부 `HERO_BRIEF_MISSING` 으로 막혔다 —
 *    review.ts 에 hero 블록이 한 번도 쓰인 적이 없기 때문이다.
 *    "사람이 적는다" 는 곧 "아무도 안 적는다" 였고, 자동 공급이 0건이 됐다.
 *
 *    그래서 **결정론적 기본값**을 둔다.
 *      ① review.ts 의 hero 가 있으면 그것이 정본이다 (Claude 가 적은 값)
 *      ② 없으면 cluster 별 고정 기본값을 쓴다 — 같은 cluster 는 늘 같은 값이다
 *    사람에게 입력을 요구하지 않는다. 지어내지도 않는다 — **미리 정해 둔 표**를 읽는다.
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
    fail('HERO_ALT_MISSING', 'hero.alt 가 없다 — review.ts 에 없으면 cluster 기본값을 쓴다')
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
/**
 * 🔴 **cluster 별 고정 기본값.** 사람이 미리 정해 둔 표다 — 실행할 때 만들지 않는다.
 *    alt 는 `checkAlt` 규칙(10~120자 · "…여성" 종결 · 금지 호칭 없음)을 지킨다.
 *    scene 은 `FORBIDDEN_SCENE_TERMS` 를 피한다 (병원·의사·약 등).
 */
export const CLUSTER_HERO_DEFAULT = {
  clinic: { alt: '창가에서 서류를 들여다보며 생각에 잠긴 50대 한국 여성',
    scene: '밝은 창가에 앉아 종이 한 장을 들고 차분히 생각하는 모습' },
  'menopause-symptom': { alt: '이른 아침 창가에서 차를 마시며 숨을 고르는 50대 한국 여성',
    scene: '아침 햇살이 드는 거실에서 따뜻한 차를 들고 잠시 쉬는 모습' },
  sleep: { alt: '늦은 밤 스탠드 불빛 아래 조용히 앉아 있는 50대 한국 여성',
    scene: '어두운 방에 작은 조명만 켜 두고 침대 가에 앉아 있는 모습' },
  'money-work': { alt: '식탁에서 수첩에 무언가 적어 보는 50대 한국 여성',
    scene: '식탁에 앉아 수첩과 펜을 놓고 천천히 적어 보는 모습' },
  emotion: { alt: '창밖을 바라보며 생각에 잠긴 50대 한국 여성',
    scene: '흐린 날 창가에 서서 바깥을 바라보는 모습' },
  daily: { alt: '동네 길을 천천히 걷는 50대 한국 여성',
    scene: '가을 햇살이 드는 동네 길을 편한 옷차림으로 걷는 모습' },
  family: { alt: '부엌에서 식재료를 정리하는 50대 한국 여성',
    scene: '부엌 조리대에서 장바구니를 정리하는 모습' },
  relationship: { alt: '거실 소파에 앉아 휴대폰을 내려다보는 50대 한국 여성',
    scene: '저녁 거실 소파에 앉아 잠시 생각하는 모습' },
}
/** 🔴 cluster 를 모르면 쓰는 값. 이것도 고정이다 */
export const FALLBACK_HERO_DEFAULT = {
  alt: '창가에 앉아 잠시 생각에 잠긴 50대 한국 여성',
  scene: '밝은 창가에 앉아 차분히 생각하는 모습',
}

/**
 * 한 slug 의 hero 정보를 읽고 판정까지 한 결과.
 *
 * @param {string} slug
 * @param {{cluster?:string|null}} [item] 큐 항목 — cluster 기본값을 고르는 데만 쓴다
 */
export function resolveHeroBrief(slug, item = null) {
  const raw = readHeroBrief(slug)
  if (raw.present) {
    const verdict = validateHeroBrief(raw)
    if (verdict.ok) {
      return { ok: true, alt: raw.alt, scene: raw.scene, source: 'review', reasons: [] }
    }
    // 🔴 review 에 적혀 있는데 규칙에 어긋나면 **기본값으로 덮지 않는다.**
    //    누가 잘못 적었다는 뜻이고, 그건 조용히 고칠 일이 아니다.
    return { ok: false, alt: null, scene: null, source: 'review', reasons: verdict.reasons }
  }

  // 🔴 없으면 고정 기본값 — 사람에게 입력을 요구하지 않는다
  const d = CLUSTER_HERO_DEFAULT[item?.cluster] ?? FALLBACK_HERO_DEFAULT
  const verdict = validateHeroBrief(d)
  if (!verdict.ok) {
    return { ok: false, alt: null, scene: null, source: 'default',
      reasons: [{ code: 'HERO_DEFAULT_INVALID', why: `기본값이 규칙을 어긴다: ${verdict.reasons.map((r) => r.why).join(' · ')}` }] }
  }
  return { ok: true, alt: d.alt, scene: d.scene, source: 'default', reasons: [] }
}
