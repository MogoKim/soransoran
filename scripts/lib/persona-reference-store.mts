/**
 * 말투 근거 **자산 로더** — 🔴 파일만 읽는다. DB · 네트워크 · AI 없음
 *
 * 🔴 **읽는 것은 `{ content: string }` 하나뿐이다** (2026-09-10, P0-3).
 *    `body` · `text` fallback 을 지웠다. 자리 이름이 여럿이면 "댓글 비슷한 것" 을 줍게 되고,
 *    실제로 그렇게 **닉네임 약 454건**이 말투 근거로 들어가 외부 모델까지 나갔다.
 *    자료가 `content` 라고 이름 붙여 준 것만 댓글로 인정한다.
 *
 * 🔴 **작성자 식별자는 이 파일 밖으로 나가지 않는다** (P0-4).
 *    묶는 일(anchor 판정)에는 쓰지만, 반환하는 묶음에는 **텍스트만** 담긴다.
 *    `VoiceReferenceBundle` 에 작성자를 담을 자리가 없다 — 타입으로 막는다.
 *
 * 🔴 **길이순 라운드로빈을 폐기했다** (P0-4).
 *    앞선 판은 코퍼스를 길이순으로 세워 Persona 에게 번갈아 나눠 담았다.
 *    그러면 묶음은 겹치지 않지만 **말투는 전부 같다** — 같은 사람들의 말을
 *    길이만 기준으로 섞어 놓은 것이기 때문이다.
 *    "겹치지 않는다" 를 말투 차이의 증거로 쓴 것이 잘못이었다.
 *    이제 **한 작성자(anchor)를 중심으로** 묶고, 모자라면 **문체가 가까운 댓글**로 채운다.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  judgeReferenceBundle, styleCentroid, styleDistance, styleOf,
  REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS,
  type VoiceReferenceBundle,
} from '../../src/lib/persona-voice-reference'
import {
  judgeAssetReadiness, judgeAssetShape,
  REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE,
  type ReferenceAsset,
} from '../../src/lib/persona-reference-asset'
import {
  SANITIZER_VERSION, type IdentityLeakCheck, type ReferenceManifest,
} from '../../src/lib/persona-eval-invalidation'
import { findExperienceClaims } from '../../src/lib/persona-experience-grounding'
import { classifyReaction } from './voice-comment-signals.mjs'

/**
 * 🔴 **이 참고 댓글은 남의 경험을 담고 있는가** (2026-09-10, 창업자 판정 B).
 *
 *    참고 댓글의 표현·호흡을 가깝게 쓰는 것은 허용된다. 그러나 그 안에
 *    **그 사람의 경험**이 들어 있으면, 겪은 일이 없는 Persona 는 그것을
 *    자기 것으로 옮긴다 — 회차 `20260910-172838` 의 7/18 이 그렇게 나왔다.
 *
 * 🔴 **새 금지 문구나 어미 정규식을 만들지 않는다.**
 *    이미 있는 분류기 둘을 그대로 쓴다 —
 *      · `classifyReaction`      VE-M2 반응 유형 분류기
 *      · `findExperienceClaims`  후보 검증이 쓰는 바로 그 계약
 *    후보를 막는 기준과 근거를 고르는 기준이 **같아야** 한다.
 *
 *    실측(정본 자산 879건): 경험형 255건(29.0%) · 안전 624건(71.0%)
 */
export function carriesExperience(text: string): boolean {
  if (classifyReaction(text) === 'experience') return true
  return findExperienceClaims(text).length > 0
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * 🔴 소란소란 저장소 안의 자산.
 *
 * 🔴 `_sample-corpus.json` 은 뺐다 — `comments` 가 **닉네임과 댓글이 번갈아 든
 *    평문 문자열 배열**이라 어느 쪽인지 자료가 말해 주지 않는다.
 *    홀짝으로 거르는 것은 검증되지 않은 가정이다.
 */
export const REFERENCE_SOURCES: readonly string[] = [
  'tmp/voice-m3-review/_speaker-b1.json',
]

export type ReferenceAssetReport = {
  path: string
  exists: boolean
  posts: number
  comments: number
  /** 🔴 `content` 가 아닌 자리에 있어 버린 항목 수 — 숨기지 않는다 */
  skipped: number
}

/**
 * 🔴 로컬 전용. **`speakerId` 는 불투명 값**이고 원래 닉네임을 되돌릴 수 없다.
 *    개발 자산을 읽을 때만 실제 author 가 잠깐 쓰이고, 즉시 speakerId 로 바뀐다.
 */
export type LocalComment = { speakerId: string; text: string }

/**
 * 🔴 **`content` 만 받는다.** 맨 문자열도, `body` 도, `text` 도 받지 않는다.
 *    "댓글일 것 같은 것" 을 추측해 줍는 순간 닉네임이 섞인다(실측).
 */
const contentOf = (c: unknown): string => {
  if (c === null || typeof c !== 'object') return ''
  const v = (c as { content?: unknown }).content
  return typeof v === 'string' ? v : ''
}

/**
 * 🔴 **되돌릴 수 없는 불투명 식별자.**
 *
 *    같은 사람은 같은 값이 되어야 묶을 수 있고, 그 값에서 닉네임을 복원할 수는
 *    없어야 한다. 그래서 **저장하지 않는 salt** 를 쓴다 —
 *    salt 는 이 프로세스 안에서만 살고, 대응표도 남기지 않는다.
 *
 * 🔴 salt 없이 해시만 하면 닉네임 사전을 만들어 맞춰 볼 수 있다.
 *    (닉네임 공간은 작다 — 730명이면 전수 대입이 순식간이다)
 */
const SPEAKER_SALT = randomUUID()
const speakerIdOf = (author: string): string =>
  author.trim() === ''
    ? ''
    : createHash('sha256').update(`${SPEAKER_SALT}\u0000${author.trim()}`).digest('hex').slice(0, 12)

const authorOf = (c: unknown): string => {
  if (c === null || typeof c !== 'object') return ''
  const v = (c as { author?: unknown }).author
  return typeof v === 'string' ? v.trim() : ''
}

const inBand = (t: string): boolean => {
  const n = [...t].length
  return n >= REFERENCE_MIN_CHARS && n <= REFERENCE_MAX_CHARS
}

/**
 * 🔴 **시험용 — 로더와 같은 규칙.** 규칙이 두 곳에 있으면 언젠가 갈리고,
 *    그러면 검사가 통과하는 동안 실제 로더는 닉네임을 계속 먹는다.
 */
export function loadCommentsFrom(comments: readonly unknown[]): string[] {
  const out: string[] = []
  for (const c of comments) {
    const t = contentOf(c).trim()
    if (t !== '' && inBand(t)) out.push(t)
  }
  return out
}

/**
 * 🔴 **정본 자산을 먼저 본다** (P1).
 *    `~/Library/Application Support/soransoran/persona-reference/` 아래 600 권한.
 *    부재·digest 불일치는 fail-closed 다 — 그 상태로 생성하면 근거를 재현할 수 없다.
 */
export function loadCanonAsset(): {
  rows: LocalComment[]
  ok: boolean
  code: string
  reason: string
  sourceDigest: string | null
} {
  const corpusExists = existsSync(REFERENCE_CORPUS_FILE)
  const manifestExists = existsSync(REFERENCE_MANIFEST_FILE)
  let actualDigest: string | null = null
  let expectedDigest: string | null = null
  let mode: number | null = null
  let parsed: unknown = null
  if (corpusExists) {
    const raw = readFileSync(REFERENCE_CORPUS_FILE, 'utf-8')
    actualDigest = sha16(raw)
    mode = statSync(REFERENCE_CORPUS_FILE).mode
    try { parsed = JSON.parse(raw) } catch { parsed = null }
  }
  if (manifestExists) {
    try {
      /**
       * 🔴 **파일 digest 는 `sourceDigest` 와 대조한다.**
       *    `sanitizedCorpusDigest` 는 **정제된 본문 목록**의 digest 라 파일 digest 와 다르다.
       *    둘을 섞어 비교하면 정상 자산이 늘 불일치로 떨어진다(실측으로 잡음).
       */
      expectedDigest = (JSON.parse(readFileSync(REFERENCE_MANIFEST_FILE, 'utf-8')) as
        { sourceDigest?: string }).sourceDigest ?? null
    } catch { expectedDigest = null }
  }
  const ready = judgeAssetReadiness({
    corpusExists, manifestExists, actualDigest, expectedDigest, mode,
  })
  if (!ready.ok) return { rows: [], ok: false, code: ready.code, reason: ready.reason, sourceDigest: actualDigest }
  const shape = judgeAssetShape(parsed)
  if (!shape.ok) return { rows: [], ok: false, code: shape.code, reason: shape.reason, sourceDigest: actualDigest }
  const asset = parsed as ReferenceAsset
  const rows: LocalComment[] = []
  for (const c of asset.comments) {
    const t = c.content.trim()
    // 🔴 정본 자산에는 이미 불투명 값만 들어 있다 — 다시 해싱하지 않는다
    if (t !== '' && inBand(t)) rows.push({ speakerId: c.speakerId, text: t })
  }
  return { rows, ok: true, code: 'OK', reason: ready.reason, sourceDigest: actualDigest }
}

/** 자산을 읽어 **작성자와 댓글**을 모은다 — 🔴 작성자는 로컬에서만 쓴다 */
export function loadLocalComments(repoRoot: string): {
  rows: LocalComment[]
  assets: ReferenceAssetReport[]
} {
  const assets: ReferenceAssetReport[] = []
  const rows: LocalComment[] = []
  for (const rel of REFERENCE_SOURCES) {
    const path = `${repoRoot}/${rel}`
    if (!existsSync(path)) {
      assets.push({ path: rel, exists: false, posts: 0, comments: 0, skipped: 0 })
      continue
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { comments?: unknown }[]
    let n = 0
    let skipped = 0
    for (const row of Array.isArray(parsed) ? parsed : []) {
      const cs = row.comments
      if (!Array.isArray(cs)) continue
      for (const c of cs) {
        const t = contentOf(c).trim()
        // 🔴 버린 것을 센다. 조용히 줄어들면 자산이 바뀐 것을 아무도 모른다
        if (t === '' || !inBand(t)) { skipped += 1; continue }
        // 🔴 여기서 곧바로 불투명 값으로 바꾼다 — 실제 닉네임은 이 줄을 넘어가지 않는다
        rows.push({ speakerId: speakerIdOf(authorOf(c)), text: t })
        n += 1
      }
    }
    assets.push({ path: rel, exists: true, posts: Array.isArray(parsed) ? parsed.length : 0, comments: n, skipped })
  }
  return { rows, assets }
}

/** 🔴 한 묶음이 "한 사람의 말투" 라고 불리려면 anchor 가 이만큼은 있어야 한다 */
export const ANCHOR_MIN_COMMENTS = 3
/** 묶음 목표 크기 */
export const BUNDLE_TARGET = 8
/** 🔴 anchor 비중이 이보다 낮으면 그 묶음은 한 사람의 말투가 아니다 */
export const ANCHOR_MIN_RATIO = 0.375

export type BundlePlan = {
  bundles: VoiceReferenceBundle[]
  /** 🔴 사람이 볼 수 있게 남기는 근거 — 🔴 작성자 식별자는 담지 않는다 */
  table: {
    personaCode: string
    anchorComments: number
    supplements: number
    anchorRatio: number
    medianLen: number
    p90Len: number
  }[]
  blocks: string[]
}

/**
 * 🔴 **anchor 작성자 + 문체가 가까운 댓글**로 묶는다.
 *
 *    ① 작성자별로 묶어 `ANCHOR_MIN_COMMENTS` 이상 가진 사람만 anchor 후보로 둔다.
 *    ② 많이 가진 순으로 Persona 에 하나씩 배정한다(재현되도록 동수는 이름순).
 *    ③ anchor 댓글로 **문체 좌표 중심**을 낸다.
 *    ④ 아직 아무 묶음도 쓰지 않은 댓글 중 그 중심에 **가장 가까운 것**으로
 *       `BUNDLE_TARGET` 까지 채운다. 같은 댓글을 두 묶음이 쓰지 않는다.
 *    ⑤ anchor 비중이 `ANCHOR_MIN_RATIO` 미만이면 **그 묶음을 만들지 않는다.**
 *
 * 🔴 Persona 수만큼 anchor 가 없으면 **억지로 채우지 않고 blocker 를 낸다.**
 */
export function planBundles(input: {
  rows: readonly LocalComment[]
  personaCodes: readonly string[]
  target?: number
  /**
   * 🔴 **경험형 참고 댓글을 줘도 되는가** (B).
   *    `memory` 나 `identity` 에 구체적 경험이 있는 Persona 만 `true` 다.
   *    기본은 `false` — 모르면 주지 않는다.
   */
  allowExperience?: boolean
}): BundlePlan {
  const target = input.target ?? BUNDLE_TARGET
  const blocks: string[] = []
  /**
   * 🔴 **입력에서 걸러 낸다.** 프롬프트로 "따라 하지 마라" 고 더 말하는 대신
   *    애초에 보여 주지 않는다 — 이 Wave 가 배운 방식이다.
   */
  const rowsIn = input.allowExperience === true
    ? input.rows
    : input.rows.filter((r) => !carriesExperience(r.text))
  const excluded = input.rows.length - rowsIn.length
  if (excluded > 0) {
    blocks.push(`🟡 경험형 참고 댓글 ${excluded}건 제외 — 경험 근거 없는 Persona 용`)
  }

  // ── ① 작성자별 ──
  const byAuthor = new Map<string, string[]>()
  for (const r of rowsIn) {
    if (r.speakerId === '') continue
    const cur = byAuthor.get(r.speakerId) ?? []
    if (!cur.includes(r.text)) cur.push(r.text)
    byAuthor.set(r.speakerId, cur)
  }
  // 🔴 많이 가진 순 · 동수는 이름순 — 순서를 고정해야 다시 돌려도 같은 묶음이 나온다
  const anchors = [...byAuthor.entries()]
    .filter(([, ts]) => ts.length >= ANCHOR_MIN_COMMENTS)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  const codes = [...new Set(input.personaCodes)].sort()
  if (anchors.length < codes.length) {
    blocks.push(
      `anchor 작성자가 ${anchors.length}명뿐이다 — Persona ${codes.length}종을 채울 수 없다`
      + ` (기준 ${ANCHOR_MIN_COMMENTS}건 이상)`,
    )
  }

  // ── 보완 풀 — 🔴 텍스트만. 여기서부터 작성자는 쓰이지 않는다 ──
  const used = new Set<string>()
  const pool: string[] = []
  for (const r of rowsIn) if (!pool.includes(r.text)) pool.push(r.text)
  const poolStyle = new Map(pool.map((t) => [t, styleOf(t)]))

  const bundles: VoiceReferenceBundle[] = []
  const table: BundlePlan['table'] = []

  for (let i = 0; i < Math.min(codes.length, anchors.length); i += 1) {
    const code = codes[i]!
    const anchorTexts = anchors[i]![1].filter((t) => !used.has(t))
    for (const t of anchorTexts) used.add(t)

    // ── ③④ 문체 중심에 가까운 것으로 채운다 ──
    const centre = styleCentroid(anchorTexts)
    const supplements = pool
      .filter((t) => !used.has(t))
      .map((t) => ({ t, d: styleDistance(centre, poolStyle.get(t)!) }))
      .sort((a, b) => a.d - b.d || a.t.localeCompare(b.t))
      .slice(0, Math.max(0, target - anchorTexts.length))
      .map((x) => x.t)
    for (const t of supplements) used.add(t)

    const texts = [...anchorTexts, ...supplements]
    const ratio = texts.length === 0 ? 0 : anchorTexts.length / texts.length
    if (ratio < ANCHOR_MIN_RATIO) {
      // 🔴 빌린 말이 더 많으면 그것은 그 사람의 말투가 아니다
      blocks.push(`${code}: anchor 비중 ${(ratio * 100).toFixed(0)}%`
        + ` — 기준 ${(ANCHOR_MIN_RATIO * 100).toFixed(0)}% 미만이라 묶음을 만들지 않는다`)
      continue
    }
    const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: anchorTexts.length })
    if (!v.ok) { blocks.push(...v.blocks.map((b) => b.message)); continue }
    bundles.push(v.bundle)
    table.push({
      personaCode: code,
      anchorComments: anchorTexts.length,
      supplements: supplements.length,
      anchorRatio: v.bundle.anchorRatio,
      medianLen: v.bundle.lengths.median,
      p90Len: v.bundle.lengths.p90,
    })
  }
  return { bundles, table, blocks }
}

/**
 * 🔴 **생성 경로가 쓰는 단일 진입점.**
 *    자산이 없거나 anchor 가 모자라면 **빈 Map 과 blocker** 를 돌려준다 — 가짜로 채우지 않는다.
 */
export function bundlesForPersonas(input: {
  repoRoot: string
  personaCodes: readonly string[]
  target?: number
  /** 🔴 경험 근거가 있는 Persona 만 경험형 참고 댓글을 받는다 (B) */
  allowExperience?: boolean
}): {
  byCode: Map<string, VoiceReferenceBundle>
  assets: ReferenceAssetReport[]
  table: BundlePlan['table']
  blocks: string[]
  /** 정본 자산인가 개발 자산인가 — 🔴 숨기지 않는다 */
  origin: string
  /** manifest 계산용 (🔴 작성자 포함 · 로컬 전용) */
  rows: LocalComment[]
  sourceDigest: string | null
} {
  /** 🔴 정본 자산이 있으면 그것을 쓴다. 없으면 개발 자산으로 내려간다(소리 내어 말한다) */
  const canon = loadCanonAsset()
  const dev = canon.ok ? { rows: [] as LocalComment[], assets: [] as ReferenceAssetReport[] }
    : loadLocalComments(input.repoRoot)
  const rows = canon.ok ? canon.rows : dev.rows
  const assets = canon.ok
    ? [{ path: REFERENCE_CORPUS_FILE, exists: true, posts: 0, comments: rows.length, skipped: 0 }]
    : dev.assets
  const originNote = canon.ok ? '정본 자산' : `🟡 개발 자산 (정본 없음 — ${canon.code})`
  if (rows.length === 0) {
    return {
      byCode: new Map(),
      assets,
      table: [],
      blocks: [`말투 근거 자산이 없다 — ${canon.reason}`],
      origin: originNote,
      rows: [],
      sourceDigest: canon.sourceDigest,
    }
  }
  const plan = planBundles({
    rows, personaCodes: input.personaCodes, target: input.target,
    allowExperience: input.allowExperience,
  })
  return {
    byCode: new Map(plan.bundles.map((b) => [b.personaCode, b])),
    assets,
    table: plan.table,
    blocks: plan.blocks,
    origin: originNote,
    rows,
    sourceDigest: canon.sourceDigest ?? sha16(JSON.stringify(rows.map((r) => r.text).sort())),
  }
}


/**
 * 🔴 **식별자 유출 검사** — 근거 텍스트가 작성자 식별자와 **같은지** 본다.
 *
 *    `20260910-153254` 는 정확히 이 검사가 없어서 닉네임을 내보냈다.
 *    "안 돌렸다" 를 "깨끗하다" 로 세지 않도록 `ran` 을 따로 남긴다.
 *
 * 🔴 **회차에서는 이 함수를 쓰지 않는다** (2026-09-10 정정, P0-4).
 *    회차 시점에 남아 있는 것은 불투명 `speakerId` 뿐이라,
 *    그것을 "작성자" 라고 부르며 대조하면 **늘 0건**이 나온다 —
 *    검사한 적 없는 것을 검사했다고 보고하는 셈이다.
 *    실제 작성자명 대조는 **자산 생성 시점에만** 가능하고,
 *    회차는 그 증거를 `inheritedIdentityLeakCheck` 로 이어받는다.
 */
export function identityLeakCheck(input: {
  texts: readonly string[]
  authors: readonly string[]
}): IdentityLeakCheck {
  const names = new Set(input.authors.map((a) => a.trim()).filter((a) => a !== ''))
  const hits = input.texts.filter((t) => names.has(t.trim())).length
  return {
    ran: true,
    hits,
    detail: hits === 0
      ? `근거 ${input.texts.length}건 대 식별자 ${names.size}개 — 일치 0`
      : `근거 텍스트가 식별자와 같은 것 ${hits}건`,
  }
}

/**
 * 🔴 **자산 manifest 의 검사 증거를 이어받는다** (P0-4).
 *    이어받을 것이 없으면 **`ran: false`** 다 — 회차가 스스로 돌린 척하지 않는다.
 */
export function inheritedIdentityLeakCheck(): IdentityLeakCheck {
  try {
    if (!existsSync(REFERENCE_MANIFEST_FILE)) {
      return { ran: false, hits: 0, detail: '자산 manifest 가 없어 이어받을 증거가 없다' }
    }
    const m = JSON.parse(readFileSync(REFERENCE_MANIFEST_FILE, 'utf-8')) as
      { identityLeakCheck?: { ran?: unknown; hits?: unknown; detail?: unknown } }
    const l = m.identityLeakCheck
    if (l === undefined || typeof l.ran !== 'boolean' || typeof l.hits !== 'number'
      || typeof l.detail !== 'string') {
      return { ran: false, hits: 0, detail: '자산 manifest 의 검사 기록을 읽지 못했다' }
    }
    return {
      ran: l.ran,
      hits: l.hits,
      // 🔴 언제 · 무엇으로 한 검사인지 밝힌다
      detail: `자산 생성 시점 실제 작성자명 대조를 이어받음 — ${l.detail}`,
    }
  } catch {
    return { ran: false, hits: 0, detail: '자산 manifest 를 읽지 못했다' }
  }
}

/**
 * 🔴 **회차가 남길 manifest.** 이것이 없으면 canon 승격이 막힌다(P0-2).
 *    묶음 digest 는 **텍스트만**으로 낸다 — 작성자가 digest 에도 들어가지 않는다.
 */
export function buildReferenceManifest(input: {
  sourceDigest: string
  rows: readonly LocalComment[]
  bundles: readonly VoiceReferenceBundle[]
}): ReferenceManifest {
  const texts = input.rows.map((r) => r.text)
  const sanitizedCorpusDigest = sha16(JSON.stringify(texts.slice().sort()))
  const personaBundleDigest = sha16(JSON.stringify(
    input.bundles.map((b) => [b.personaCode, b.comments.map((c) => c.text)]),
  ))
  return {
    sanitizerVersion: SANITIZER_VERSION,
    sourceDigest: input.sourceDigest,
    sanitizedCorpusDigest,
    commentCount: texts.length,
    personaBundleDigest,
    /**
     * 🔴 회차는 검사를 **재실행하지 않는다.** speakerId 를 작성자라고 부르며
     *    대조하면 늘 0건이 나오고, 그것은 거짓 보고다(P0-4).
     */
    identityLeakCheck: inheritedIdentityLeakCheck(),
  }
}

/**
 * 🔴 **실제 코퍼스 분포로 역할을 배정한다** (2026-09-10, 창업자 판정 A).
 *
 *    고정 교대(`i % roles.length`)는 인위적 균등 분배다 —
 *    실제 댓글은 `other` 가 81.3% 인데 셋을 3분의 1씩 돌리면
 *    질문할 것이 없어도 질문을, 겪은 일이 없어도 공감을 만들게 된다.
 *
 * 🔴 분포는 **자산에서 매번 다시 잰다.** 숫자를 상수로 박으면 자산이 바뀔 때 갈린다.
 * 🔴 최대잉여법으로 나눈다 — 반올림 오차가 특정 역할에 몰리지 않는다.
 * 🔴 순서를 고정한다(비율 큰 것부터). 다시 돌려도 같은 배정이 나온다.
 */
export function allocateRolesByCorpus(input: {
  rows: readonly LocalComment[]
  roles: readonly string[]
  count: number
}): { roles: string[]; distribution: { role: string; corpusPct: number; assigned: number }[] } {
  const seen = new Map<string, number>()
  for (const r of input.rows) {
    const k = classifyReaction(r.text)
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const total = input.rows.length || 1
  // 🔴 planner 가 쓸 수 있는 역할만 남기고 비율을 다시 정규화한다
  const usable = input.roles.map((role) => ({ role, n: seen.get(role) ?? 0 }))
  const sum = usable.reduce((a, x) => a + x.n, 0) || 1
  const exact = usable.map((x) => ({ ...x, share: (x.n / sum) * input.count }))
  const base = exact.map((x) => ({ ...x, floor: Math.floor(x.share) }))
  let left = input.count - base.reduce((a, x) => a + x.floor, 0)
  // 잉여는 소수부가 큰 순서로 — 같으면 코퍼스 비율이 큰 쪽
  const order = base.slice().sort((a, b) =>
    (b.share - b.floor) - (a.share - a.floor) || b.n - a.n || a.role.localeCompare(b.role))
  const assigned = new Map(base.map((x) => [x.role, x.floor]))
  for (const o of order) {
    if (left <= 0) break
    assigned.set(o.role, (assigned.get(o.role) ?? 0) + 1)
    left -= 1
  }
  /** 🔴 많이 배정된 역할부터 늘어놓는다 — 무작위를 쓰지 않는다 */
  const roles: string[] = []
  for (const x of base.slice().sort((a, b) => (assigned.get(b.role) ?? 0) - (assigned.get(a.role) ?? 0)
    || a.role.localeCompare(b.role))) {
    for (let k = 0; k < (assigned.get(x.role) ?? 0); k += 1) roles.push(x.role)
  }
  return {
    roles,
    distribution: base.map((x) => ({
      role: x.role,
      corpusPct: Math.round((x.n / total) * 1000) / 10,
      assigned: assigned.get(x.role) ?? 0,
    })),
  }
}
