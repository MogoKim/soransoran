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
  judgeReferenceBundle, judgeVoiceEvidence,
  REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS, REFERENCE_MIN_COUNT, REFERENCE_MIN_SAFE_TEXTS,
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
import {
  isProductionPersonaCode, PRODUCTION_PERSONA_CODES,
} from '../../src/lib/persona-cohort'
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
  const read = readCanonAsset()
  if (!read.ok || read.asset === null) {
    return { rows: [], ok: false, code: read.code, reason: read.reason, sourceDigest: read.digest }
  }
  const rows: LocalComment[] = []
  for (const c of read.asset.comments) {
    const t = c.content.trim()
    // 🔴 정본 자산에는 이미 불투명 값만 들어 있다 — 다시 해싱하지 않는다
    if (t !== '' && inBand(t)) rows.push({ speakerId: c.speakerId, text: t })
  }
  return { rows, ok: true, code: 'OK', reason: read.reason, sourceDigest: read.digest }
}

/**
 * 🔴 **자산을 여는 한 곳.** 경로·manifest·digest·권한·모양을 여기서 한 번만 본다.
 *    말투 묶음(`loadCanonAsset`)과 ② 빈도 코퍼스(`loadCanonCorpusTexts`)가
 *    같은 파일을 각자 열면 게이트가 두 벌이 되고, 한쪽만 고쳐지는 날이 온다.
 */
function readCanonAsset(): {
  ok: boolean
  code: string
  reason: string
  asset: ReferenceAsset | null
  digest: string | null
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
  if (!ready.ok) return { ok: false, code: ready.code, reason: ready.reason, asset: null, digest: actualDigest }
  const shape = judgeAssetShape(parsed)
  if (!shape.ok) return { ok: false, code: shape.code, reason: shape.reason, asset: null, digest: actualDigest }
  return { ok: true, code: 'OK', reason: ready.reason, asset: parsed as ReferenceAsset, digest: actualDigest }
}

/**
 * 🔴 **② 고유 표현 판정에 쓰는 빈도 코퍼스** (2026-09-11).
 *
 * 🔴 **`speakerId` 를 돌려주지 않는다.** ② 는 "이 표현이 이 공동체에서 흔한가" 를 묻고,
 *    그 물음에 누가 썼는지는 들어가지 않는다. 반환 타입에서 아예 빼서
 *    호출부가 실수로도 화자를 빈도 판정에 섞지 못하게 한다.
 *
 * 🔴 **밴드로 거르지 않는다.** 말투 묶음은 "인용할 만한 길이" 를 고르지만,
 *    빈도 코퍼스는 **이 공동체가 실제로 쓰는 말 전부**여야 한다 —
 *    짧은 맞장구를 빼면 `그쵸` 같은 흔한 말이 희귀어로 잡힌다.
 *
 * 🔴 원문을 Git·DB 로 옮기지 않는다. 이 함수는 메모리에만 올린다.
 */
export function loadCanonCorpusTexts(): {
  texts: string[]
  ok: boolean
  code: string
  reason: string
} {
  const read = readCanonAsset()
  if (!read.ok || read.asset === null) {
    return { texts: [], ok: false, code: read.code, reason: read.reason }
  }
  const texts: string[] = []
  for (const c of read.asset.comments) {
    const t = c.content.trim()
    if (t !== '') texts.push(t)
  }
  return {
    texts, ok: true, code: 'OK',
    reason: `정본 자산 ${texts.length}건 — ${read.reason}`,
  }
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

/**
 * 🔴 한 묶음이 "한 사람의 말투" 라고 불리려면 **같은 화자의 관측**이 이만큼은 있어야 한다.
 *    판정은 `judgeVoiceEvidence` 하나다 — 관측 3건 이상 · 그중 안전 원문 2건 이상.
 */
export const ANCHOR_MIN_COMMENTS = REFERENCE_MIN_COUNT
/**
 * 🔴 묶음 **상한**. 목표가 아니다 — 이보다 적어도 된다.
 *
 * 🔴 **다른 화자 댓글로 채우던 것을 없앴다** (2026-09-10).
 *    앞선 판은 8건을 맞추려고 문체가 가까운 **다른 사람의 댓글**로 보완했다.
 *    실측: 18개 중 13개가 anchor 3건 + 보완 5건이었다 —
 *    **말투 근거의 과반이 남의 말**이었고, 그것을 "이 Persona 의 말투" 라고 불렀다.
 *    한 묶음은 **정확히 한 화자**의 댓글만 쓴다. 모자라면 모자란 채로 둔다.
 */
export const BUNDLE_MAX = 8

export type BundlePlan = {
  bundles: VoiceReferenceBundle[]
  /** 🔴 사람이 볼 수 있게 남기는 근거 — 🔴 작성자 식별자는 담지 않는다 */
  table: {
    personaCode: string
    /** 🔴 같은 화자의 **관측 총수**(style-only 포함) — 계약의 말투 근거 수다 */
    anchorComments: number
    /** provider 로 원문을 싣는 안전 댓글 수 */
    safeTexts: number
    /** 경험형이라 원문 없이 문체·길이에만 쓴 관측 수 */
    styleOnly: number
    supplements: number
    /** 🔴 언제나 1.0 이다 — 한 묶음은 한 화자뿐이다 */
    anchorRatio: number
    medianLen: number
    p90Len: number
  }[]
  blocks: string[]
}

/**
 * 🔴 **한 화자 = 한 묶음 = 한 Persona.**
 *
 *    ① 화자별로 **모든 관측**을 모으고, 그중 경험형이 아닌 **안전 댓글**을 따로 센다.
 *    ② `judgeVoiceEvidence`(관측 ≥ 3 · 안전 원문 ≥ 2)를 통과한 화자만 후보다.
 *    ③ 안전 원문이 많은 순 · 동수는 화자 id 순으로 Persona 에 하나씩 배정한다 —
 *       🔴 이 정렬은 옛 판(안전 3건 이상만 후보)과 같은 키다. 그래서 그때 서 있던 18명의 배정은
 *       **그대로**이고, 새로 서는 화자(안전 2건)는 그 뒤에 붙는다.
 *    ④ provider 로 나가는 원문(`comments`)은 **안전 댓글뿐**이다. 경험형은 `styleOnlyTexts` 로
 *       관측 수 · 문체 좌표 · 길이 분포에만 들어간다 — 그 사람의 장면·사실이 실리지 않는다.
 *
 * 🔴 Persona 수만큼 화자가 없으면 **억지로 채우지 않고 blocker 를 낸다.**
 */
export function planBundles(input: {
  rows: readonly LocalComment[]
  personaCodes: readonly string[]
  target?: number
}): BundlePlan {
  const cap = input.target ?? BUNDLE_MAX
  const blocks: string[] = []

  // ── 화자별로 묶는다 — 원문 후보(안전)와 style-only(경험형)를 가른다 ──
  const bySpeaker = new Map<string, { send: string[]; styleOnly: string[] }>()
  let excluded = 0
  for (const r of input.rows) {
    if (r.speakerId === '') continue
    const cur = bySpeaker.get(r.speakerId) ?? { send: [], styleOnly: [] }
    // 🔴 경험형은 **언제나** style-only 다 — 원문으로 싣는 옵션 · 분기가 없다(Phase F 보정)
    const exp = carriesExperience(r.text)
    const into = exp ? cur.styleOnly : cur.send
    if (!cur.send.includes(r.text) && !cur.styleOnly.includes(r.text)) {
      into.push(r.text)
      if (exp) excluded += 1
    }
    bySpeaker.set(r.speakerId, cur)
  }
  if (excluded > 0) {
    blocks.push(`🟡 경험형 참고 댓글 ${excluded}건은 원문 제외 — 같은 화자의 문체·길이 관측(style-only)으로만 쓴다`)
  }
  /**
   * 🔴 안전 원문이 많은 순 · 동수는 화자 id 순 — 순서를 고정해야 다시 돌려도 같은 배정이 나온다.
   * 🔴 `judgeVoiceEvidence` 를 통과하지 못한 화자는 아예 후보가 아니다.
   */
  const speakers = [...bySpeaker.entries()]
    .filter(([, s]) => judgeVoiceEvidence({ observed: s.send.length + s.styleOnly.length, safeTexts: s.send.length }).ok)
    .sort((a, b) => b[1].send.length - a[1].send.length || a[0].localeCompare(b[0]))

  const codes = [...new Set(input.personaCodes)].sort()
  if (speakers.length < codes.length) {
    blocks.push(
      `화자가 ${speakers.length}명뿐이다 — Persona ${codes.length}종을 채울 수 없다`
      + ` (기준 관측 ${REFERENCE_MIN_COUNT}건 · 안전 원문 ${REFERENCE_MIN_SAFE_TEXTS}건 이상)`,
    )
  }

  const bundles: VoiceReferenceBundle[] = []
  const table: BundlePlan['table'] = []
  for (let i = 0; i < Math.min(codes.length, speakers.length); i += 1) {
    const code = codes[i]!
    const s = speakers[i]![1]
    /**
     * 🔴 **이 화자의 안전 댓글만** 원문으로 싣는다. 다른 화자에서 가져오지 않는다.
     *    길이순으로 세워 고르게 집어 짧은 것만 모이지 않게 한다.
     */
    const own = s.send.slice()
      .sort((a, b) => [...a].length - [...b].length || a.localeCompare(b))
    const take = own.length <= cap
      ? own
      : Array.from({ length: cap }, (_, k) => own[Math.floor(k * (own.length / cap))]!)

    const v = judgeReferenceBundle({ personaCode: code, texts: take, anchorCount: take.length, styleOnlyTexts: s.styleOnly })
    if (!v.ok) { blocks.push(...v.blocks.map((b) => b.message)); continue }
    bundles.push(v.bundle)
    table.push({
      personaCode: code,
      anchorComments: v.bundle.observedCount,
      safeTexts: v.bundle.comments.length,
      styleOnly: v.bundle.styleOnlyCount,
      supplements: 0,
      anchorRatio: 1,
      medianLen: v.bundle.lengths.median,
      p90Len: v.bundle.lengths.p90,
    })
  }
  return { bundles, table, blocks }
}

/**
 * 🔴 **안정 배정 — 전체 정본 universe 를 기준으로 **한 번** 계산한다** (2026-09-10).
 *
 *    앞선 판은 부르는 쪽이 넘긴 코드 목록으로 그때그때 나눴다.
 *    그래서 **같은 Persona 가 배치에 따라 다른 묶음**을 받았다 —
 *    실측: `P10` 이 단독 · 둘 · 24명 안에서 각각 다른 8건을 받았다(digest 3종).
 *    말투가 배치마다 달라지면 그 Persona 의 말투라고 부를 수 없다.
 *
 *    이제 **정본 24명 전체로 한 번 계산하고, 실행 대상은 거기서 꺼내 쓴다.**
 *    배치 인원·순서·다른 Persona 포함 여부가 바뀌어도 결과가 같다.
 *
 * 🔴 정본 밖 코드는 **임의로 재배정하지 않는다.** 묶음을 주지 않으면
 *    `buildPrompt` 가 `REFERENCE_MISSING` 으로 막는다.
 */
export function stableAssignment(input: {
  repoRoot: string
  target?: number
}): {
  byCode: Map<string, VoiceReferenceBundle>
  assets: ReferenceAssetReport[]
  table: BundlePlan['table']
  blocks: string[]
  origin: string
  rows: LocalComment[]
  sourceDigest: string | null
} {
  const canon = loadCanonAsset()
  const dev = canon.ok ? { rows: [] as LocalComment[], assets: [] as ReferenceAssetReport[] }
    : loadLocalComments(input.repoRoot)
  const rows = canon.ok ? canon.rows : dev.rows
  const assets = canon.ok
    ? [{ path: REFERENCE_CORPUS_FILE, exists: true, posts: 0, comments: rows.length, skipped: 0 }]
    : dev.assets
  const origin = canon.ok ? '정본 자산' : `🟡 개발 자산 (정본 없음 — ${canon.code})`
  if (rows.length === 0) {
    return {
      byCode: new Map(), assets, table: [],
      blocks: [`말투 근거 자산이 없다 — ${canon.reason}`],
      origin, rows: [], sourceDigest: canon.sourceDigest,
    }
  }
  /** 🔴 **언제나 정본 24명 전체**로 나눈다. 부르는 쪽의 목록을 보지 않는다 */
  const plan = planBundles({
    rows, personaCodes: PRODUCTION_PERSONA_CODES, target: input.target,
  })
  return {
    byCode: new Map(plan.bundles.map((b) => [b.personaCode, b])),
    assets, table: plan.table, blocks: plan.blocks, origin, rows,
    sourceDigest: canon.sourceDigest ?? sha16(JSON.stringify(rows.map((r) => r.text).sort())),
  }
}

/**
 * 🔴 **⑧ seed 재사용 — 같은 seed 를 받은 Persona 가 몇 명인가** (2026-09-29).
 *
 *    계약(§3-⑧ · 안전·독창성 게이트 설계): seed 재사용은 "같은 source comment seed 가
 *    **여러 페르소나에게** 반복 배분" 되는 것이고, **persona 단위가 아니라 전체 단위**로 본다.
 *    이 경로의 seed 는 고정 배정 reference 묶음의 댓글이다. 그래서 내 묶음의 댓글 하나하나가
 *    **몇 개의 묶음에 들어 있는가**를 세고, 그중 최대를 돌려준다(겹침 하나도 재사용이다).
 *
 *    🔴 앞판(`comments + queue + 1`)은 **그 Persona 의 댓글 이력**을 셌다 — 다른 축이다.
 *       같은 댓글을 Comment 와 PUBLISHED Queue 로 두 번 세어, 댓글 1건을 단 Persona 는
 *       3 → ⑧ regenerate 로 **영구히** 막혔다(2026-09-28·29 운영 반례 P01).
 *       자기 말투 반복은 ⑧ 의 반복 축(`priorTexts` 말끝·시작어절·3-gram)이 본다.
 *    🔴 이 Persona 에게 묶음이 없으면(배정이 통째로 비었어도) `1` — 받은 seed 가 없으니 나눈 seed 도 없다.
 *       생성 경로도 같은 뜻으로 읽는다(배정이 비면 reference 없이 부르고, 일부만 없으면 그 대상만
 *       `REFERENCE_MISSING`). 여기서 null 을 내면 materializer 가 **회차 전체**를 멈춘다 —
 *       fail-closed 가 정상 대상까지 막는다(CI 격리 DB 검사가 실제로 그렇게 멈췄다).
 *    🔴 `null`(못 셈)은 **배정을 읽다 실패한 경우**뿐이다 — 호출부(`makeDbTargetSource`)가 예외를 null 로 바꾼다.
 */
export function referenceSeedShareCount(
  byCode: ReadonlyMap<string, VoiceReferenceBundle>,
  personaCode: string,
): number | null {
  const mine = byCode.get(personaCode)
  if (mine === undefined || mine.comments.length === 0) return 1
  const holders = new Map<string, number>()
  for (const b of byCode.values()) {
    for (const t of new Set(b.comments.map((c) => c.text))) holders.set(t, (holders.get(t) ?? 0) + 1)
  }
  return Math.max(...mine.comments.map((c) => holders.get(c.text) ?? 1))
}

/**
 * 🔴 **생성 경로가 쓰는 단일 진입점.**
 *
 *    고정 배정에서 **필요한 것만 꺼낸다.** 여기서 다시 나누지 않는다 —
 *    나누는 순간 배치에 따라 달라진다.
 */
export function bundlesForPersonas(input: {
  repoRoot: string
  personaCodes: readonly string[]
  target?: number
}): {
  byCode: Map<string, VoiceReferenceBundle>
  assets: ReferenceAssetReport[]
  table: BundlePlan['table']
  blocks: string[]
  origin: string
  rows: LocalComment[]
  sourceDigest: string | null
} {
  const all = stableAssignment({ repoRoot: input.repoRoot, target: input.target })
  const want = [...new Set(input.personaCodes)]
  const byCode = new Map<string, VoiceReferenceBundle>()
  const blocks = [...all.blocks]
  for (const code of want) {
    if (!isProductionPersonaCode(code)) {
      // 🔴 정본 밖은 채우지 않는다. 받지 못하면 buildPrompt 가 막는다
      blocks.push(`${code}: production 정본 universe 밖이다 — reference 를 주지 않는다`)
      continue
    }
    const b = all.byCode.get(code)
    if (b === undefined) {
      blocks.push(`${code}: anchor 가 모자라 묶음이 서지 않았다`)
      continue
    }
    byCode.set(code, b)
  }
  return {
    byCode,
    assets: all.assets,
    table: all.table.filter((t) => byCode.has(t.personaCode)),
    blocks,
    origin: all.origin,
    rows: all.rows,
    sourceDigest: all.sourceDigest,
  }
}

/**
 * 🔴 **식별자 유출 검사** — 근거 텍스트가 작성자 식별자와 **같은지** 본다.
 *
 * 🔴 **회차에서는 이 함수를 쓰지 않는다.** 회차 시점에 남아 있는 것은 불투명
 *    `speakerId` 뿐이라, 그것을 "작성자" 라고 부르며 대조하면 **늘 0건**이 나온다 —
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
 * 🔴 **자산 manifest 의 검사 증거를 이어받는다.**
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
      detail: `자산 생성 시점 실제 작성자명 대조를 이어받음 — ${l.detail}`,
    }
  } catch {
    return { ran: false, hits: 0, detail: '자산 manifest 를 읽지 못했다' }
  }
}

/**
 * 🔴 **회차가 남길 manifest.** 이것이 없으면 canon 승격이 막힌다.
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
    identityLeakCheck: inheritedIdentityLeakCheck(),
  }
}

/**
 * 🔴 **실제 코퍼스 분포로 역할을 배정한다.**
 *    고정 교대는 인위적 균등 분배다 — 실제 댓글은 `other` 가 81.3% 다.
 * 🔴 분포는 **자산에서 매번 다시 잰다.** 최대잉여법 · 무작위 없음 · 재현 가능.
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
  const usable = input.roles.map((role) => ({ role, n: seen.get(role) ?? 0 }))
  const sum = usable.reduce((a, x) => a + x.n, 0) || 1
  const base = usable.map((x) => {
    const share = (x.n / sum) * input.count
    return { ...x, share, floor: Math.floor(share) }
  })
  let left = input.count - base.reduce((a, x) => a + x.floor, 0)
  const order = base.slice().sort((a, b) =>
    (b.share - b.floor) - (a.share - a.floor) || b.n - a.n || a.role.localeCompare(b.role))
  const assigned = new Map(base.map((x) => [x.role, x.floor]))
  for (const o of order) {
    if (left <= 0) break
    assigned.set(o.role, (assigned.get(o.role) ?? 0) + 1)
    left -= 1
  }
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
