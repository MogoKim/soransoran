/**
 * hero 생성 로직 — 판정·프롬프트·주입 (M-AUTO-5 1차)
 *
 * 🔴 이 파일은 파일을 쓰지 않고 브라우저도 띄우지 않는다. 순수 함수만 둔다.
 *    CLI(`magazine-hero-runner.mjs`)가 이 판정을 받아 실제 생성·저장을 한다.
 *    분리해 두어야 실패 케이스(hero 이미 있음 · alt 없음 · OPTIONAL 등)를
 *    이미지 생성 없이 테스트할 수 있다.
 *
 * 🔴 이 파일은 등록 게이트를 열지 않는다.
 *    🔴 M3-A — 등급은 아무것도 막지 않는다. hero 는 등록 관문과 무관하다.
 *    hero 는 batch-qa 의 ⑥번 조건 하나일 뿐이다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, DRAFTS_DIR } from './magazine-load.mjs'
import { HERO_WIDTH, HERO_HEIGHT, readWebpSize } from '../magazine-qa.mjs'

export { HERO_WIDTH, HERO_HEIGHT }

/** hero 는 언제나 이 경로다. slug 하나로 정해진다 */
export const heroPublicPath = (slug) => `/magazine/${slug}/hero.webp`
export const heroFilePath = (slug) => join(ROOT, 'public', 'magazine', slug, 'hero.webp')

// ── 안전 정책 ──────────────────────────────────────────────

/**
 * 프롬프트에 항상 붙는 금지 목록.
 *
 * 코퍼스 17건이 전부 이 선을 지킨다 — **병원이 아니라 일상 공간**이고,
 * 증상을 전시하지 않으며, 표정이 과장되지 않는다. 매거진이 의료 광고처럼
 * 보이는 순간 커뮤니티 신뢰가 깎인다.
 *
 * 나이를 명시하는 이유는 실측이다. 그냥 "Korean woman" 으로 두면 20~30 대가
 * 나온다. 우리 독자는 40 대 중반~60 대 중반이다.
 */
export const SAFETY_RULES = [
  'no hospitals, clinics, examination rooms or hospital beds',
  'no white coats, stethoscopes, medical devices or medical equipment',
  'no medicine, pills, supplements or syringes',
  'no medical or pharmaceutical advertising look',
  'no visible text, letters, numbers, logos or signage anywhere in the image',
  'no exaggerated pain, crying, fear or distress',
  'not a young woman in her 20s or 30s',
  'not a Western or European woman',
  'not an elderly woman and not a nursing-home setting',
]

/** 기본 장면 — `--prompt` 가 없을 때 cluster 로 고른다 */
const CLUSTER_SCENES = {
  clinic: 'at home in the morning, pausing for a moment while looking down at her smartphone',
  'menopause-symptom': 'at home by a bright window, pausing quietly in the middle of an ordinary day',
  sleep: 'sitting on the edge of the bed in early morning light, looking toward the window',
  daily: 'in her kitchen or living room during the day, in the middle of an everyday routine',
  emotion: 'sitting by a window at home with a mug, looking outside',
  relationship: 'at the dining table at home, resting for a moment',
  family: 'in the living room at home, pausing during an ordinary afternoon',
  'money-work': 'at the dining table at home with papers and a notebook, thinking quietly',
}

const DEFAULT_SCENE = 'at home in ordinary daylight, pausing quietly for a moment'

/**
 * 이미지 생성 프롬프트를 조립한다.
 *
 * @param {{ title?: string, cluster?: string, scene?: string }} p
 * @returns {string}
 */
export function buildPrompt({ title, cluster, scene } = {}) {
  const body = scene?.trim() || CLUSTER_SCENES[cluster] || DEFAULT_SCENE
  return [
    'Create a photorealistic horizontal image, 16:9 aspect ratio.',
    '',
    `Subject: a Korean woman in her late 40s to early 50s, ${body}.`,
    'Setting: an ordinary Korean home — living room, kitchen or bedroom. Bright natural daylight.',
    'Expression: calm and composed. Neutral, unexaggerated. Not sad, not anxious, not in pain.',
    '',
    'Absolutely avoid:',
    ...SAFETY_RULES.map((r) => `- ${r}`),
    '',
    'Style: warm natural documentary photography, soft daylight, shallow depth of field, muted warm tones.',
    title ? `Context (do not render as text): the article is about "${title}".` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * alt 로 쓸 만한 문장인가.
 *
 * 코퍼스 17건이 전부 "{장소·행동} 여성" 형태다. 화면에 무엇이 있는지 적지
 * 않으면 스크린리더 사용자에게 아무 정보가 되지 않는다.
 */
export function checkAlt(alt) {
  const value = String(alt ?? '').trim()
  if (!value) return { ok: false, why: 'alt 가 없다 — 화면에 무엇이 있는지 한 문장으로 적는다' }
  if (value.length < 10) return { ok: false, why: `alt 가 너무 짧다 (${value.length}자)` }
  if (value.length > 120) return { ok: false, why: `alt 가 너무 길다 (${value.length}자)` }
  if (!value.endsWith('여성')) {
    return { ok: false, why: 'alt 는 "…여성" 으로 끝낸다 — 등록 17건이 전부 그 형태다' }
  }
  return { ok: true, why: null }
}

// ── 판정 ───────────────────────────────────────────────────

/** article-draft.ts 에서 필요한 값만 뽑는다. vm 을 쓰지 않는다 — 문자열로 충분하다 */
export function readDraftMeta(slug) {
  const path = join(DRAFTS_DIR, slug, 'article-draft.ts')
  if (!existsSync(path)) return null
  const src = readFileSync(path, 'utf8')
  const g = (k) => (new RegExp(`${k}:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(src) ?? [, null])[1]
  return {
    path,
    src,
    title: g('title'),
    description: g('description'),
    cluster: g('cluster'),
    medical: /medical:\s*true/.test(src),
    hasHeroImage: /^\s*heroImage:\s*\{/m.test(src),
    hasHeroPlaceholder: src.includes('// heroImage 는 이미지 회수 후 채운다'),
  }
}

/**
 * 생성해도 되는가. **파일을 쓰지 않는다.**
 *
 * @param {{ slug?: string, alt?: string, queueItem?: object|null, force?: boolean, allowOptional?: boolean }} p
 */
export function planHero({ slug, alt, queueItem = null, force = false, allowOptional = false }) {
  const reasons = []
  const notes = []

  if (!slug) return { slug: null, verdict: 'BLOCKED', reasons: ['--slug 가 필요하다'], notes, checks: {} }

  const meta = readDraftMeta(slug)
  if (!meta) reasons.push(`article-draft.ts 가 없다: drafts/magazine/${slug}/`)

  const imageMode = queueItem?.imageMode ?? null
  if (!queueItem) {
    notes.push('topic-queue 에 없다 — 이미 등록됐거나 큐 밖에서 만든 글이다. imageMode 를 확인할 수 없다')
  } else if (imageMode !== 'REQUIRED' && !allowOptional) {
    reasons.push(`imageMode=${imageMode} — REQUIRED 가 아니다. 만들려면 --allow-optional`)
  }

  const filePath = heroFilePath(slug)
  const exists = existsSync(filePath)
  if (exists && !force) reasons.push(`hero 가 이미 있다 (public${heroPublicPath(slug)}) — 덮어쓰려면 --force`)
  if (exists && force) notes.push('기존 hero 를 덮어쓴다 (--force)')

  const altCheck = checkAlt(alt)
  if (!altCheck.ok) reasons.push(altCheck.why)

  if (meta?.hasHeroImage) {
    notes.push('article-draft.ts 에 heroImage 가 이미 있다 — 주입하지 않고 파일만 바꾼다')
  } else if (meta && !meta.hasHeroPlaceholder) {
    reasons.push('article-draft.ts 에서 heroImage 자리를 찾지 못했다 — 변환기 출력이 아니다')
  }

  return {
    slug,
    verdict: reasons.length ? 'BLOCKED' : 'READY',
    reasons,
    notes,
    checks: {
      imageMode,
      heroExists: exists,
      force,
      allowOptional,
      altOk: altCheck.ok,
      title: meta?.title ?? null,
      cluster: meta?.cluster ?? null,
      willInject: Boolean(meta && !meta.hasHeroImage),
      publicPath: heroPublicPath(slug),
    },
    _meta: meta,
  }
}

// ── 주입 ───────────────────────────────────────────────────

/**
 * article-draft.ts 에 heroImage 4필드를 넣은 **새 문자열**을 돌려준다.
 * 파일을 쓰지 않는다 — CLI 가 `--write` 일 때만 쓴다.
 */
export function injectHeroImage(src, slug, alt) {
  const placeholder = '  // heroImage 는 이미지 회수 후 채운다\n'
  const block =
    '  heroImage: {\n' +
    `    src: '${heroPublicPath(slug)}',\n` +
    `    alt: '${String(alt).replace(/'/g, "\\'")}',\n` +
    `    width: ${HERO_WIDTH},\n` +
    `    height: ${HERO_HEIGHT},\n` +
    '  },\n'
  if (src.includes(placeholder)) return { ok: true, text: src.replace(placeholder, block) }
  if (/^\s*heroImage:\s*\{/m.test(src)) return { ok: true, text: src, note: 'heroImage 가 이미 있다 — 그대로 둔다' }
  return { ok: false, why: 'heroImage 자리를 찾지 못했다' }
}

/**
 * 저장된 파일이 기준 크기인가. **여기서 실패하면 파일을 지운다** (CLI 책임).
 * 선언과 실제가 다르면 magazine-qa 가 FAIL 을 낸다 — 반쯤 남기지 않는다.
 */
export function verifyHeroFile(slug) {
  const path = heroFilePath(slug)
  if (!existsSync(path)) return { ok: false, why: '파일이 없다', size: null }
  const size = readWebpSize(path)
  if (!size) return { ok: false, why: 'webp 헤더를 읽지 못했다 — webp 가 아니다', size: null }
  if (size.width !== HERO_WIDTH || size.height !== HERO_HEIGHT) {
    return { ok: false, why: `${size.width}×${size.height} — 기준 ${HERO_WIDTH}×${HERO_HEIGHT}`, size }
  }
  return { ok: true, why: null, size }
}
