#!/usr/bin/env tsx
/**
 * AUTO_SEED → 초안 → 채택 → publish candidate — 🔴 **파일까지만** (§4-AS)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AS
 *
 * 판정(§4-AR)이 `AUTO_SEED` 로 남긴 소재에서 초안을 만들고, 하나를 골라
 * `supply-autofill` 이 먹을 수 있는 후보 파일까지 낸다.
 *
 * 🔴 **초안 생성을 새로 만들지 않는다.** 기존 `expandSeed`(소재 사전 + 템플릿)를 그대로 쓴다.
 *    LLM 을 부르지 않는다 — 이 구간은 원래 LLM 없이 도는 곳이다.
 *
 * 🔴 **사람의 ADOPT 를 사칭하지 않는다.** 결정은 `AUTO_ADOPT` · `AUTO_HOLD` · `AUTO_DROP`,
 *    provenance 는 `machine-shadow` 다. 후보 파일에도 그 표시가 그대로 남는다 —
 *    `supply-autofill` 이 `sourceDecision` 으로 사람 판정을 요구하므로,
 *    **이 파일에서 나온 후보는 지금 큐로 갈 수 없다.** 그게 맞다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · 큐 적재 · 발행 · 네트워크 · LLM · Sheet · Raw Vault.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-auto-draft.mts            # 계획만 · 파일 write 0
 *   npx tsx scripts/micro-seed-auto-draft.mts --apply    # 초안 · 후보 파일 생성
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// 🔴 기존 템플릿 생성기를 그대로 쓴다. 새 생성 로직을 만들지 않는다
import { expandSeed, findMaterial } from './lib/micro-seed-seed-originality.mjs'
import {
  pickDraft, summarizeDrafts, violatesDraftProvenance, normalize, parseQuality,
  hasRepetitiveWording, echoesTitleAtEnd, hasBannedWord, overlapOk, checkDraft,
  DRAFT_REASON_LABEL, DRAFT_RULE_VERSION, DRAFT_PROMPT_VERSION, DRAFT_PROVENANCE,
  MAX_OVERLAP, MAX_DRAFTS_PER_SOURCE, DRAFT_QUALITY_AXES, QUALITY_PROMPT_VERSION,
  hasInformalSpeech, endsWithQuestion,
  type DraftCandidate, type Judgement, type Pick, type DraftQualityVerdict,
} from '../src/lib/micro-seed-auto-draft'
// 🔴 기존 LLM 경로를 그대로 쓴다. 새 HTTP 클라이언트도 SDK 도 만들지 않는다
import { callProvider, keyStatus, type ProviderModel } from './lib/voice-m3-provider.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { inputHashOf } from '../src/lib/micro-seed-auto-judge'

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
/**
 * 🔴 **세 경로를 섞지 않는다** (§4-AR 과 같은 계약).
 *   인자 없음        오프라인 계획 — LLM 0 · 네트워크 0 · 파일 write 0
 *   --call           템플릿 + 필요한 LLM fallback · cache write 있음
 *   --call --apply   picks · candidates 파일 생성
 *   --apply 단독     🔴 거부
 */
const CALL = argv.includes('--call')
const APPLY = argv.includes('--apply')
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

export function isInsideDataDir(p: string): boolean {
  const rel = relative(resolve(process.cwd()), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${DATA_DIR}/`)
}
function filesEnding(suffix: string): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(suffix)).sort().map((f) => join(DATA_DIR, f))
}
function jsonl(path: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return out }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try { out.push(JSON.parse(t) as Record<string, unknown>) } catch { /* 건너뛴다 */ }
  }
  return out
}

/** 최신 판정 파일의 AUTO_SEED — 🔴 회차가 여럿이면 마지막 판정이 정본이다 */
/** 🔴 판정 출처. Judgement 는 초안 생성에 필요한 3필드만 담으므로 따로 모은다 —
 *  상수를 찍지 않고 **그 판에서 나온 값**을 후보에 이관하기 위한 것이다 (§4-AT) */
type JudgeProv = {
  ruleVersion: string; promptVersion: string; model: string
  inputHash: string; provenance: string
}
const seedProv = new Map<string, JudgeProv>()

function loadAutoSeeds(): Judgement[] {
  const files = filesEnding('.shadow.jsonl')
  if (files.length === 0) return []
  const byId = new Map<string, Judgement>()
  for (const f of files) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      if (id === '') continue
      byId.set(id, {
        sourceArticleId: id, decision: S(r.decision),
        semanticRisks: Array.isArray(r.semanticRisks) ? r.semanticRisks.map(String) : [],
      })
      seedProv.set(id, {
        ruleVersion: S(r.ruleVersion), promptVersion: S(r.promptVersion),
        model: S(r.model), inputHash: S(r.inputHash), provenance: S(r.provenance),
      })
    }
  }
  return [...byId.values()].filter((j) => j.decision === 'AUTO_SEED')
}

/** 소재의 제목 — 초안 생성에 필요하다. 🔴 본문은 쓰지 않는다 */
function loadTitles(): Map<string, { title: string; site: string }> {
  const out = new Map<string, { title: string; site: string }>()
  for (const suffix of ['.detail.jsonl', '.raw-detail.jsonl']) {
    for (const f of filesEnding(suffix)) {
      for (const r of jsonl(f)) {
        const id = S(r.sourceArticleId)
        const t = S(r.title)
        if (id !== '' && t !== '') out.set(id, { title: t, site: S(r.sourceSite) })
      }
    }
  }
  return out
}

/** 이미 후보가 된 제목·본문 — 같은 글을 두 번 내지 않는다 */
function seenFromCandidates(): { titles: Set<string>; bodies: Set<string> } {
  const titles = new Set<string>()
  const bodies = new Set<string>()
  for (const f of readdirSync(DATA_DIR).filter((x) => /^publish-candidates-.*\.json$/.test(x))) {
    try {
      const j = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as { candidates?: Record<string, unknown>[] }
      for (const c of j.candidates ?? []) {
        titles.add(normalize(S(c.title)))
        bodies.add(normalize(S(c.body)))
      }
    } catch { /* 건너뛴다 */ }
  }
  return { titles, bodies }
}

export const DRAFT_MODEL: ProviderModel = 'claude-haiku-4.5'
export const DRAFT_TIMEOUT_MS = 25000
export const DRAFT_MAX_TOKENS = 1200
export const MAX_ATTEMPTS = 2
const RETRY_BASE_MS = 400
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })
export function backoffMs(attempt: number, rand: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1)
  return base + Math.floor(rand * base)
}

/**
 * 🔴 **원문 전문 · 댓글 · 작성자 · URL 을 보내지 않는다.**
 *    제목과 마스킹된 앞 300자, 그리고 판정이 남긴 한 줄이 전부다.
 */
export const GEN_SYSTEM_PROMPT = [
  '너는 40대 중반~60대 중반 여성 커뮤니티에 올릴 짧은 글을 쓴다.',
  '주어진 소재를 **다시 써서** 우리 커뮤니티 이야기로 만든다. 원문을 옮기지 않는다.',
  '',
  '문체:',
  '- 🔴 **반드시 존댓말.** 본문 모든 문장이 "~요 · ~네요 · ~더라고요 · ~까요?" 로 끝난다.',
  '    실제로 걸린 반말 예: "신기하네" · "말이야" · "몰라" · "영향을 주는 걸까?" · "전산반이었어"',
  '    → 고쳐 쓰면: "신기하네요" · "말이에요" · "모르겠어요" · "영향을 주는 걸까요?" · "전산반이었어요"',
  '    남의 말을 옮길 때만 따옴표 안에서 반말을 써도 된다.',
  '- 40~60대 여성이 쓰는 자연스러운 구어체.',
  '- "시니어 · 어르신 · 노인 · 실버" 는 절대 쓰지 않는다. "우리 나이" · "우리 또래" 를 쓴다.',
  '- 🔴 본문 2~4문장. **마지막 문장은 반드시 물음표로 끝나는 질문**이다.',
  '    "다들 어떠세요?" 처럼 읽는 사람이 바로 답할 수 있어야 한다.',
  '    🔴 마지막 글자가 물음표여야 한다. "궁금해요." 처럼 끝내면 안 된다.',
  '    회고만 적고 끝내면 안 된다 — 질문이 없으면 게시판 글이 아니다.',
  '- 제목에 같은 낱말을 두 번 넣지 않는다.',
  '- 제목을 본문 끝에 그대로 되풀이하지 않는다.',
  '- 원문 문장을 6자 이상 그대로 가져오지 않는다.',
  '',
  '🔴 쓰지 않는다: 정치 · 공인 · 연예인 · 방송 · 약 · 치료 · 검사 주기 ·',
  '   광고 · 판매처 문의 · 갈등 유도 · 특정 개인을 알아볼 수 있는 사연.',
  '',
  '초안 2개를 JSON 으로만 답한다:',
  '{"drafts":[{"title":"...","body":"...","intendedQuestion":"본문이 묻는 것 한 줄",',
  '  "sourceAngle":"이 소재의 어떤 결을 살렸는지 한 줄"}]}',
].join('\n')

/** 🔴 초안 품질 판정 — auto-judge 와 분리된 물음이다 */
export const QUALITY_SYSTEM_PROMPT = [
  '너는 40대 중반~60대 중반 여성 커뮤니티의 글 검수자다.',
  '주어진 초안이 그 게시판에 올라가도 되는 글인지 본다.',
  '',
  '🔴 아래 중 하나라도 해당하면 통과시키지 않는다:',
  '- informalSpeech: 본문에 반말이 있다. 우리 게시판은 존댓말이다.',
  '    예: "신기하네" · "말이야" · "몰라" · "걸까?" · "전산반이었어"',
  '    (따옴표 안 인용문은 반말이어도 된다. 제목의 명사형도 반말이 아니다)',
  '- naturalKorean: 한국어가 어색하다 · 번역투 · 기계가 쓴 티가 난다',
  '- titleBodyCoherence: 제목과 본문이 다른 이야기다',
  '- communityFit4050: 우리 또래 이야기가 아니다',
  '- answerableQuestion: 무엇을 답해야 할지 모르겠다',
  '- repetitiveWording: 같은 말이 어색하게 되풀이된다',
  '- genericWithoutSourceAngle: 소재가 사라진 일반론이다',
  '- medicalOrConflictRisk: 의료 조언 · 갈등 유도 위험이 있다',
  '',
  '애매하면 통과시키지 말고 AUTO_HOLD 로 답한다.',
  '',
  'JSON 만 답한다:',
  '{"decision":"AUTO_ADOPT|AUTO_HOLD|AUTO_DROP","confidence":0.0~1.0,',
  ' "issues":["위 이름 중 해당하는 것. 없으면 빈 배열"]}',
].join('\n')

export function buildGenPayload(t: {
  title: string; bodyHead: string; communityAngle: string; axis: string; lane: string
}): string {
  // 🔴 보내는 것이 이게 전부다. url · 작성자 · 댓글 · 전문 필드가 없다
  return JSON.stringify({
    sourceTitle: t.title,
    sourceBodyHead: t.bodyHead.slice(0, 300),
    communityAngle: t.communityAngle,
    axis: t.axis, lane: t.lane,
  })
}

type CallOutcome<T> = { value: T | null; status: string; attemptCount: number; errorCode: string | null }

async function callJson<T>(
  system: string, payload: string, parse: (raw: string) => T | null,
): Promise<CallOutcome<T>> {
  let attempt = 0
  let status = 'skipped'
  let errorCode: string | null = null
  for (; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs(attempt, Math.random()))
    const res = await callProvider({
      model: DRAFT_MODEL, systemPrompt: system, userPayload: payload,
      maxOutputTokens: DRAFT_MAX_TOKENS, timeoutMs: DRAFT_TIMEOUT_MS,
    })
    errorCode = res.errorCode
    if (res.maxTokensReached) { status = 'maxTokens'; break }
    if (!res.ok) {
      status = /timeout|abort/i.test(String(res.errorCode ?? '')) ? 'timeout' : 'httpError'
      continue
    }
    const v = parse(res.rawText)
    if (v !== null) return { value: v, status: 'ok', attemptCount: attempt + 1, errorCode: null }
    // 🔴 파싱 실패 — 형식을 다시 일러 한 번만 더
    status = 'parseError'
    const retry = await callProvider({
      model: DRAFT_MODEL,
      systemPrompt: `${system}\n\n🔴 지난 답이 JSON 이 아니었다. 설명 없이 JSON 객체 하나만 답한다.`,
      userPayload: payload, maxOutputTokens: DRAFT_MAX_TOKENS, timeoutMs: DRAFT_TIMEOUT_MS,
    })
    attempt += 1
    const v2 = (retry.ok && !retry.maxTokensReached) ? parse(retry.rawText) : null
    if (v2 !== null) return { value: v2, status: 'ok', attemptCount: attempt + 1, errorCode: null }
    break
  }
  return { value: null, status, attemptCount: attempt + 1, errorCode }
}

type GenDraft = { title: string; body: string; intendedQuestion: string; sourceAngle: string }

export function parseGen(raw: string): GenDraft[] | null {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch { return null }
  const list = Array.isArray(j.drafts) ? j.drafts : null
  if (list === null || list.length === 0) return null
  const out: GenDraft[] = []
  for (const d of list.slice(0, MAX_DRAFTS_PER_SOURCE)) {
    const o = d as Record<string, unknown>
    const title = S(o.title)
    const body = S(o.body)
    if (title === '' || body === '') continue
    out.push({
      title, body,
      intendedQuestion: S(o.intendedQuestion), sourceAngle: S(o.sourceAngle),
    })
  }
  return out.length === 0 ? null : out
}

/** 🔴 캐시 — 원문·제목·본문 머리를 담지 않는다. 해시와 결과만 */
const CACHE_PATH = join(DATA_DIR, 'auto-draft-cache.json')
type CacheEntry = { drafts: GenDraft[]; quality: Record<string, DraftQualityVerdict | null>; status: string; attemptCount: number }
function loadCache(): Map<string, CacheEntry> {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as Record<string, CacheEntry>))
  } catch { return new Map() }
}
function saveCache(m: ReadonlyMap<string, CacheEntry>): void {
  writeFileSync(CACHE_PATH, `${JSON.stringify(Object.fromEntries(m))}\n`, 'utf-8')
}

function runId(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

/**
 * 초안별 품질 판정 — 🔴 **deterministic 을 통과한 것만 묻는다.**
 *
 * 반말이나 질문 없음으로 이미 막힌 초안에 모델을 부르는 것은 돈만 쓰는 일이다.
 */
async function askQuality(
  drafts: readonly DraftCandidate[],
  cache: Map<string, CacheEntry>,
  qKey: (d: string) => string,
  statusCount: Map<string, number>,
  onHit: (n: number) => void,
  onMiss: (n: number) => void,
): Promise<Map<number, DraftQualityVerdict | null>> {
  const out = new Map<number, DraftQualityVerdict | null>()
  for (const d of drafts) {
    // 🔴 deterministic 에서 이미 막힌 것은 묻지 않는다
    if (S(d.title) === '' || S(d.body) === '' || S(d.safetyVerdict) !== 'pass'
      || hasBannedWord(d.title + d.body) || !overlapOk(d.overlap)
      || hasRepetitiveWording(d.title) || echoesTitleAtEnd(d.title, d.body)
      || hasInformalSpeech(d.body) || !endsWithQuestion(d.body)) {
      continue
    }
    const k = qKey(String(d.draftNo))
    const c = cache.get(k)
    if (c !== undefined && c.status === 'ok') {
      onHit(1)
      out.set(d.draftNo, c.quality[String(d.draftNo)] ?? null)
      statusCount.set('ok', (statusCount.get('ok') ?? 0) + 1)
      continue
    }
    onMiss(1)
    const q = await callJson(QUALITY_SYSTEM_PROMPT,
      JSON.stringify({ title: d.title, body: d.body }), parseQuality)
    statusCount.set(q.status, (statusCount.get(q.status) ?? 0) + 1)
    out.set(d.draftNo, q.value)
    if (q.value !== null) {
      cache.set(k, { drafts: [], quality: { [String(d.draftNo)]: q.value }, status: 'ok', attemptCount: q.attemptCount })
    }
  }
  return out
}

/** 소재 메타 — 제목 · bodyHead · 판정이 남긴 한 줄 */
type Meta = { title: string; site: string; bodyHead: string; axis: string; lane: string; angle: string }

function loadMeta(): Map<string, Meta> {
  const out = new Map<string, Meta>()
  for (const suffix of ['.detail.jsonl', '.raw-detail.jsonl']) {
    for (const f of filesEnding(suffix)) {
      for (const r of jsonl(f)) {
        const id = S(r.sourceArticleId)
        const t = S(r.title)
        if (id === '' || t === '') continue
        out.set(id, {
          title: t, site: S(r.sourceSite), bodyHead: S(r.bodyHead),
          axis: S(r.axis), lane: S(r.lane), angle: '',
        })
      }
    }
  }
  // 판정이 남긴 communityAngle 을 붙인다
  for (const f of filesEnding('.shadow.jsonl')) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      const m = out.get(id)
      if (m !== undefined && S(r.communityAngle) !== '') m.angle = S(r.communityAngle)
    }
  }
  return out
}

async function main(): Promise<void> {
  await loadEnvLocal()
  if (APPLY && !CALL) fail('--apply 는 --call 과 함께 씁니다')

  const mode = !CALL ? '오프라인 계획' : APPLY ? '생성 + 파일' : '생성 (파일 write 0 · cache write 있음)'
  console.log(`\n══ ${mode} ══\n`)
  console.log(`  규칙 ${DRAFT_RULE_VERSION} · 프롬프트 ${DRAFT_PROMPT_VERSION} · provenance ${DRAFT_PROVENANCE}`)
  console.log('  🔴 사람의 ADOPT 를 사칭하지 않는다')
  console.log(`  🔴 DB 0 · 큐 0 · 발행 0 · Sheet 0${CALL ? '' : ' · LLM 0 · 네트워크 0 · 파일 write 0'}\n`)

  const seeds = loadAutoSeeds()
  if (seeds.length === 0) fail('AUTO_SEED 가 0건이다 — 먼저 micro-seed:auto-judge 를 돌린다')
  const metas = loadMeta()
  const seen = seenFromCandidates()
  const now = new Date()
  const nowIso = now.toISOString()
  console.log(`① AUTO_SEED ${seeds.length}건`)

  if (!CALL) {
    let tmplOk = 0
    for (const j of seeds) {
      const m = metas.get(j.sourceArticleId)
      if (m === undefined) continue
      const ex = expandSeed({ sourceArticleId: j.sourceArticleId, sourceSite: m.site, title: m.title }, nowIso)
      if ((ex.drafts ?? []).length > 0) tmplOk += 1
    }
    console.log(`\n② 오프라인 추정 — 템플릿이 초안을 내는 것 ${tmplOk}건 · LLM fallback 필요 ${seeds.length - tmplOk}건`)
    console.log('   🟡 LLM 0 · 네트워크 0 · 파일 write 0. 실행하려면 --call 을 붙이세요.\n')
    return
  }

  const key = keyStatus(DRAFT_MODEL)
  if (!key.present) fail(`${key.envName} 가 없습니다`)
  const cache = loadCache()
  let hit = 0
  let miss = 0
  const statusCount = new Map<string, number>()

  const picks: Pick[] = []
  const adopted: { pick: Pick; draft: DraftCandidate; meta: Meta; from: string }[] = []
  const usedSources = new Set<string>()
  const seenTitles = new Set(seen.titles)
  const seenBodies = new Set(seen.bodies)

  for (const j of seeds) {
    const meta = metas.get(j.sourceArticleId)
    if (meta === undefined) {
      picks.push(pickDraft({
        judgement: j, drafts: [], material: '', seenTitles, seenBodies, sourceUsed: false,
      }, nowIso))
      continue
    }
    const material = String(findMaterial(meta.title).material ?? '')

    // ── ① 템플릿 먼저 ──
    const ex = expandSeed({
      sourceArticleId: j.sourceArticleId, sourceSite: meta.site, title: meta.title,
      sourceInput: 'auto-judge', sourceDecision: 'AUTO_SEED',
    }, nowIso)
    let from: string = 'template'
    let drafts: DraftCandidate[] = (ex.drafts ?? []).slice(0, MAX_DRAFTS_PER_SOURCE).map((d) => ({
      sourceArticleId: j.sourceArticleId, draftNo: d.draftNo,
      title: d.title, body: d.body,
      safetyVerdict: String(d.safety?.verdict ?? ''), overlap: Number(d.overlap ?? 0),
      generatedAt: d.generatedAt,
    }))
    // 🔴 템플릿 초안이 deterministic 게이트를 하나도 통과하지 못하면 LLM 으로 넘어간다
    const deterministicOk = drafts.some((d) =>
      S(d.title) !== '' && S(d.body) !== '' && S(d.safetyVerdict) === 'pass'
      && !hasBannedWord(d.title + d.body) && overlapOk(d.overlap)
      && !hasRepetitiveWording(d.title) && !echoesTitleAtEnd(d.title, d.body))

    const hash = inputHashOf({ title: meta.title, bodyHead: meta.bodyHead, axis: meta.axis, lane: meta.lane })
    // 🔴 **생성 캐시와 품질 캐시를 나눈다.** 한 덩어리로 두면 품질 판정만 바꿔도
    //    생성 호출 전체를 다시 하게 된다 — 2026-09-07 에 그 구조로 24건을 다시 불렀다.
    const genKey = `gen|${j.sourceArticleId}|${hash}|${DRAFT_PROMPT_VERSION}|${DRAFT_MODEL}`
    const qKey = (d: string): string =>
      `q|${j.sourceArticleId}|${d}|${QUALITY_PROMPT_VERSION}|${DRAFT_MODEL}`

    if (!deterministicOk) {
      from = 'llm'
      // ── 생성 (생성 캐시) ──
      const cg = cache.get(genKey)
      let gen: GenDraft[] | null = null
      if (cg !== undefined && cg.status === 'ok') {
        hit += 1
        gen = cg.drafts
        statusCount.set('ok', (statusCount.get('ok') ?? 0) + 1)
      } else {
        miss += 1
        const g = await callJson(GEN_SYSTEM_PROMPT, buildGenPayload({
          title: meta.title, bodyHead: meta.bodyHead, communityAngle: meta.angle,
          axis: meta.axis, lane: meta.lane,
        }), parseGen)
        statusCount.set(g.status, (statusCount.get(g.status) ?? 0) + 1)
        gen = g.value
        if (gen !== null) cache.set(genKey, { drafts: gen, quality: {}, status: 'ok', attemptCount: g.attemptCount })
      }
      drafts = (gen ?? []).map((d, i2) => ({
        sourceArticleId: j.sourceArticleId, draftNo: i2 + 1,
        title: d.title, body: d.body,
        // 🔴 LLM 초안도 기존 safetyFilter 로 다시 잰다 — 모델 말을 믿지 않는다
        safetyVerdict: safetyFilter({ title: d.title, body: d.body }).verdict,
        overlap: longestRun(d.title + d.body, meta.bodyHead),
        generatedAt: nowIso,
      }))
      // ── 품질 (품질 캐시) — 🔴 deterministic 을 통과한 초안만 묻는다. 물어봐야 소용없는 것에 돈을 쓰지 않는다
      const qmap = await askQuality(drafts, cache, qKey, statusCount, (n) => { hit += n }, (n) => { miss += n })
      const p = pickDraft({
        judgement: j, drafts, material, seenTitles, seenBodies,
        sourceUsed: usedSources.has(j.sourceArticleId), quality: qmap,
      }, nowIso)
      picks.push(p)
      if (p.decision === 'AUTO_ADOPT' && p.draftNo !== null) {
        const d = drafts.find((x) => x.draftNo === p.draftNo)!
        adopted.push({ pick: p, draft: d, meta, from })
        usedSources.add(j.sourceArticleId)
        seenTitles.add(normalize(d.title))
        seenBodies.add(normalize(d.body))
      }
      continue
    }

    // 템플릿 초안도 품질 판정을 받는다 — 🔴 deterministic 통과가 곧 채택이 아니다
    const qmap2 = await askQuality(drafts, cache, qKey, statusCount, (n) => { hit += n }, (n) => { miss += n })
    const p = pickDraft({
      judgement: j, drafts, material, seenTitles, seenBodies,
      sourceUsed: usedSources.has(j.sourceArticleId), quality: qmap2,
    }, nowIso)
    picks.push(p)
    if (p.decision === 'AUTO_ADOPT' && p.draftNo !== null) {
      const d = drafts.find((x) => x.draftNo === p.draftNo)!
      adopted.push({ pick: p, draft: d, meta, from })
      usedSources.add(j.sourceArticleId)
      seenTitles.add(normalize(d.title))
      seenBodies.add(normalize(d.body))
    }
  }

  const s = summarizeDrafts(picks)
  console.log(`\n② 호출  cache hit ${hit} · miss ${miss}`)
  for (const [st, n] of [...statusCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${st === 'ok' ? '🟢' : '🔴'} ${st.padEnd(10)} ${n}건`)
  }
  console.log('\n③ 채택')
  console.log(`   🟢 AUTO_ADOPT ${s.AUTO_ADOPT}건  — 🔴 사람의 ADOPT 가 아니다`)
  console.log(`   🟡 AUTO_HOLD  ${s.AUTO_HOLD}건`)
  console.log(`   🔴 AUTO_DROP  ${s.AUTO_DROP}건`)
  console.log(`   출처: 템플릿 ${adopted.filter((a) => a.from === 'template').length} · LLM ${adopted.filter((a) => a.from === 'llm').length}`)
  console.log('\n④ 사유')
  for (const [code, n] of Object.entries(s.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}건  ${DRAFT_REASON_LABEL[code as keyof typeof DRAFT_REASON_LABEL] ?? code}`)
  }
  console.log(`\n⑤ 원천당 1개 — 채택 ${adopted.length}건 · 고유 원천 ${usedSources.size}건`
    + `${adopted.length === usedSources.size ? ' ✅' : ' 🔴'}`)

  if (!APPLY) {
    saveCache(cache)
    console.log('\n⑥ picks · candidates 파일을 만들지 않는다 — --apply 를 붙이세요.')
    console.log('   🟡 판정 캐시는 갱신한다. 원문·제목·본문 머리는 담기지 않는다.\n')
    return
  }
  for (const a of adopted) {
    const bad = violatesDraftProvenance(a.pick as unknown as Record<string, unknown>)
    if (bad.length > 0) fail(`provenance 위반\n${bad.map((b) => `     ${b}`).join('\n')}`)
  }
  const rid = runId(now)
  const pickPath = join(DATA_DIR, `auto-draft-${rid}.picks.jsonl`)
  const candPath = join(DATA_DIR, `auto-draft-${rid}.candidates.json`)
  for (const pp of [pickPath, candPath]) if (!isInsideDataDir(pp)) fail(`${pp} 은 ${DATA_DIR}/ 밖이다`)
  writeFileSync(pickPath, `${picks.map((pp) => JSON.stringify(pp)).join('\n')}\n`, 'utf-8')
  // 🔴 후보마다 "어느 판정에서 왔는지"를 실어 보낸다. 상수를 찍으면 근거가 아니라 장식이 된다 —
  //    supply-autofill 은 이 값이 없으면 큐 payload 를 만들지 않는다 (§4-AT)
  writeFileSync(candPath, `${JSON.stringify({
    note: '🔴 기계가 만들고 기계가 고른 초안이다. 사람의 ADOPT 가 아니다 —'
      + ' sourceDecision 이 AUTO_ADOPT 라 supply-autofill 이 받지 않는다.',
    generatedAt: nowIso, ruleVersion: DRAFT_RULE_VERSION,
    promptVersion: DRAFT_PROMPT_VERSION, model: DRAFT_MODEL, provenance: DRAFT_PROVENANCE,
    candidates: adopted.map((a) => ({
      candidateType: 'seedOriginality',
      sourceArticleId: a.pick.sourceArticleId,
      sourceSite: a.meta.site,
      sourceInput: 'auto-judge',
      sourceDecision: 'AUTO_ADOPT',
      draftFrom: a.from,
      title: a.draft.title, body: a.draft.body,
      safetyVerdict: a.draft.safetyVerdict, maxOverlap: a.draft.overlap,
      leakedTokens: '', reviewedAt: nowIso, writtenAt: a.draft.generatedAt,
      provenanceNote: `기계 생성 · ${DRAFT_RULE_VERSION} · ${DRAFT_PROVENANCE} · ${a.from}`,
      autoJudge: seedProv.get(a.pick.sourceArticleId) ?? null,
    })),
  }, null, 2)}\n`, 'utf-8')
  saveCache(cache)
  console.log(`\n⑥ 🔴 파일 2개`)
  console.log(`   ✅ ${pickPath}  ${picks.length}건`)
  console.log(`   ✅ ${candPath}  ${adopted.length}건`)
  console.log('   🔴 큐에 넣지 않았다 · 발행하지 않았다.\n')
}

/** 두 글에서 가장 길게 이어지는 조각 — 🔴 원문을 그대로 옮겼는지 본다 */
export function longestRun(draft: string, source: string): number {
  const a = normalize(draft)
  const b = normalize(source)
  if (a === '' || b === '') return 0
  let best = 0
  for (let i = 0; i < a.length; i += 1) {
    for (let len = best + 1; i + len <= a.length; len += 1) {
      if (b.includes(a.slice(i, i + len))) best = len
      else break
    }
  }
  return best
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
export { MAX_OVERLAP }
