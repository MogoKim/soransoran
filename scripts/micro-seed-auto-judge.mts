#!/usr/bin/env tsx
/**
 * 자동 판정 Shadow — 🔴 **판정 파일까지만. DB 도 큐도 발행도 없다** (§4-AR)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AR
 *
 * 🔴 **사람 판정을 사칭하지 않는다.** 결정 값은 `AUTO_` 접두가 붙고
 *    provenance 는 `machine-shadow` 다. 사람이 쓰는 `SEED`·`ADOPT`·`founder` 를
 *    이 경로가 쓰면 **자동 발행의 전제("사람이 고른 글")가 조용히 무너진다.**
 *
 * 🔴 **새 검수 UI 를 만들지 않는다.** 기존 화면은 그대로다.
 *    이건 그 옆에서 도는 그림자일 뿐이고, 사람이 언제든 화면에서 다시 판정할 수 있다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · 큐 적재 · 발행 · 네트워크 · LLM · Sheet · Raw Vault.
 *    산출은 `.microseed-data/` 안 판정 파일 하나뿐이다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-auto-judge.mts            # 계획만 · 파일 0
 *   npx tsx scripts/micro-seed-auto-judge.mts --apply    # 판정 파일 생성
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  judgeOne, summarize, checkRegression, violatesProvenance, parseSemantic, inputHashOf,
  hardGate, preSemanticGate, HARD_BLOCK, BODY_HEAD_MAX,
  REASON_LABEL, RULE_VERSION, PROMPT_VERSION, AUTO_PROVENANCE, SEED_AXIS, RAW_AXIS, SKIPPED,
  type Judgement, type JudgeInput, type RegressionRow, type SemanticOutcome, type SemanticStatus,
} from '../src/lib/micro-seed-auto-judge'
// 🔴 기존 LLM 경로를 그대로 쓴다. 새 HTTP 클라이언트도 새 SDK 도 만들지 않는다
import { keyStatus, type LlmResponse, type ProviderModel } from './lib/voice-m3-provider.mjs'
/**
 * 🔴 **유료 요청은 장부를 지나서만 나간다** (2026-09-17).
 *    `callProvider` 를 직접 부르지 않는다 — 부르면 그 요청은 세어지지도 막히지도 않는다.
 */
import { SupplyLlmSession, limitsFromEnv } from './lib/supply-llm-call.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
/**
 * 🔴 **세 경로를 섞지 않는다.**
 *
 * v2 첫 판은 "계획만 · 네트워크 0 · LLM 0" 이라고 찍으면서 실제로는 모델을 불렀다.
 * 화면이 거짓말을 하면 그 화면을 근거로 한 판단이 전부 흔들린다.
 *
 *   인자 없음        오프라인 계획만 — 네트워크 0 · LLM 0 · **파일 write 0**
 *   --call           LLM 호출 — shadow 결과 파일 0 · **cache write 있음**
 *   --call --apply   LLM 호출 · cache 사용 — shadow 결과 파일 생성
 *   --apply 단독     🔴 거부. 무엇을 근거로 쓸지 정하지 않은 채 쓰는 것이다
 *
 * 🔴 **`--call` 이 파일을 아예 안 쓴다고 적지 않는다.** 판정 캐시는 쓴다 —
 *    반복 호출을 막는 데 필요하고, 화면이 "파일 0" 이라고 하면 그것이 거짓말이 된다.
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
function jsonList(path: string, keys: readonly string[]): Record<string, unknown>[] {
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    for (const k of keys) if (Array.isArray(j[k])) return j[k] as Record<string, unknown>[]
    return []
  } catch { return [] }
}

/** 사람이 이미 판정한 글 — 회귀 표본이자 중복 판정 방지 */
function humanDecisions(): Map<string, string> {
  const out = new Map<string, string>()
  for (const re of ['seed-originality-source-approvals-', 'srn-approvals', 'raw-originality-approvals-']) {
    for (const f of readdirSync(DATA_DIR).filter((x) => x.startsWith(re) && x.endsWith('.json'))) {
      for (const r of jsonList(join(DATA_DIR, f), ['decisions'])) {
        const id = S(r.sourceArticleId)
        if (id !== '') out.set(id, S(r.decision))
      }
    }
  }
  return out
}

/**
 * 판정 대상 — 🔴 **검수 화면이 보는 그 파일들을 그대로 읽는다.**
 *
 * 두 화면의 access 키 이름이 다르므로(`access` vs `accessStatus`) 여기서 맞춘다.
 */
/**
 * 🔴 **판정할 파일을 지정한다** (`--input=a,b`).
 *
 * 지정이 없으면 종전대로 디렉터리 전체를 읽는다. 지정이 있으면 그것만 읽는다 —
 * Autopilot 이 끊긴 회차를 이을 때 앞 회차가 만든 **그 파일**을 판정해야 하기 때문이다.
 * 최신 파일에 맡기면 수집한 판과 판정한 판이 어긋난다.
 */
function inputOverride(): string[] | null {
  const hit = argv.find((a) => a.startsWith('--input='))
  if (hit === undefined) return null
  const paths = hit.slice('--input='.length).split(',').map((x) => x.trim()).filter((x) => x !== '')
  return paths.length === 0 ? null : paths
}

function loadTargets(): JudgeInput[] {
  const byId = new Map<string, JudgeInput>()
  const only = inputOverride()
  // 🔴 지정이 있으면 그 목록에서만 고른다. 없으면 종전대로 디렉터리 전체다
  const pick = (suffix: string): string[] => (only === null
    ? filesEnding(suffix)
    : only.filter((f) => f.endsWith(suffix)))
  for (const f of pick('.detail.jsonl')) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      if (id === '') continue
      byId.set(id, {
        sourceArticleId: id, axis: S(r.axis), access: S(r.access),
        // 🔴 v1 이 여기서 title · bodyHead 를 빠뜨렸다. 저장은 돼 있는데 판정에 안 넣었다
        title: S(r.title), bodyHead: S(r.bodyHead), commentCount: Number(r.commentCount ?? 0),
        lane: S(r.lane), assetAxes: S(r.assetAxes),
        safetyVerdict: S(r.safetyVerdict), safetyReasons: S(r.safetyReasons),
        bodyLength: Number(r.bodyLength ?? 0),
        qualityFlags: Array.isArray(r.qualityFlags) ? r.qualityFlags.map(String) : [],
      })
    }
  }
  for (const f of pick('.raw-detail.jsonl')) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      if (id === '') continue
      // 🔴 raw 파일이 더 최신 판정을 가질 수 있다 — 축이 rawOriginality 면 덮어쓴다
      const prev = byId.get(id)
      const cand: JudgeInput = {
        sourceArticleId: id, axis: S(r.axis), access: S(r.accessStatus),
        title: S(r.title), bodyHead: S(r.bodyHead), commentCount: Number(r.commentCount ?? 0),
        lane: S(r.lane), assetAxes: S(r.assetAxes),
        safetyVerdict: S(r.safetyVerdict), safetyReasons: S(r.safetyReasons),
        bodyLength: Number(r.bodyLength ?? 0),
        qualityFlags: Array.isArray(r.qualityFlags) ? r.qualityFlags.map(String) : [],
      }
      if (prev === undefined || S(r.axis) === RAW_AXIS) byId.set(id, cand)
    }
  }
  return [...byId.values()]
}

/** 🔴 판정에 쓰는 모델. 기존 계약의 라벨을 그대로 쓴다 */
export const JUDGE_MODEL: ProviderModel = 'claude-haiku-4.5'
export const JUDGE_TIMEOUT_MS = 20000
// 🔴 400 에서 3건이 잘렸다(2026-09-07). 답이 잘리면 판정 자체가 없어진다 —
//    아끼다가 못 쓰는 것보다 넉넉히 준다
export const JUDGE_MAX_TOKENS = 700

/**
 * 🔴 **원문 전문을 보내지 않는다.** 제목과 마스킹된 앞 300자뿐이다.
 *    이 프롬프트가 커질수록 전문이 새어 들어갈 자리가 생긴다 — 필드를 늘리지 마라.
 */
export const SYSTEM_PROMPT = [
  '너는 40대 중반~60대 중반 여성 커뮤니티의 소재 검수자다.',
  '주어진 글이 "우리 커뮤니티에서 다시 써서 올릴 소재" 로 적합한지 판정한다.',
  '',
  '🔴 **소재를 막지 않는다.** 연예인 · 방송 · 드라마 · 건강 · 갱년기 · 병원 경험 ·',
  '   부부 · 가족 · 직장 · 이웃 갈등 · 솔직한 불만과 이견은 **전부 우리 이야기다.**',
  '   공개 인물 이름과 프로그램 이름이 나온다는 이유만으로 위험이 아니다.',
  '',
  '🔴 아래는 **누군가에게 해가 되는 것**이다. 해당하면 이름을 적는다:',
  '- identifiablePrivatePerson: 공인이 아닌 사람이 특정된다 (실명 + 직장 · 주소 · 연락처 등)',
  '- unverifiedDefamation: 확인되지 않은 범죄 · 불륜 · 질병을 **사실로 단정**한다',
  '    (누가 무엇을 했다더라 수준의 소문을 단정으로 옮기는 것)',
  '- targetedHarassmentOrThreat: 특정인을 향한 위협 · 괴롭힘 · 신상 털기 · 혐오 선동',
  '- dangerousMedicalInstruction: 약 · 용량 · 진단 · 치료를 **확정적으로 지시**한다',
  '    🔴 경험담은 해당하지 않는다. "저는 이 약 먹고 이랬어요" 는 정상이다.',
  '    "이 약을 하루 두 알 먹으면 반드시 낫는다" 가 해당한다.',
  '- politicalCampaigning: 정치 · 진영 선동',
  '- purchaseOrSellerRequest: 어디서 사는지 · 판매처 · 구매처를 묻는 글 (판매 유도로 읽힌다)',
  '- brandListBait: 댓글이 브랜드 이름 나열로 흐를 소재',
  '- insufficientContext: 판단할 만큼 내용이 없다',
  // 🔴 2026-09-16 — deterministic 판정과 **같은 이름**을 쓴다 (micro-seed-safety-signals)
  '- crisisSignal: 자해 · 자살 · 극단적 선택을 암시한다',
  '    🔴 명시 표현 하나면 해당한다. 간접 표현은 **서로 다른 갈래가 둘 이상** 겹칠 때만이다.',
  '    "그런 생각이 들었다" 한 줄, "애들 좀 봐줘" 한 줄만으로는 해당하지 않는다.',
  '- medicalDecisionRequest: 치료 · 의료기기 · 약물의 **부작용 · 교체 · 중단 · 계속 사용 ·',
  '    안전 여부 판단**을 커뮤니티에 요청한다.',
  '    🔴 소재는 막지 않는다. 겪은 이야기와 제품명만 나오는 글은 해당하지 않는다.',
  '- healthEfficacyClaim: 몸 · 건강에 대한 **효능을 주장**한다.',
  '    🔴 "~라고 한다" 는 전언형이어도 해당한다. 읽는 사람에게 닿는 것은 주장 그 자체다.',
  '',
  '🔴 **위 목록에 없으면 위험이 아니다.** 자극적이거나 화제성이 있다는 이유로 막지 않는다.',
  '',
  'JSON 만 답한다:',
  '{"decision":"AUTO_SEED|AUTO_RAW|AUTO_HOLD|AUTO_DROP",',
  ' "confidence":0.0~1.0,',
  ' "risks":["위 이름 중 해당하는 것. 없으면 빈 배열"],',
  ' "communityAngle":"우리 커뮤니티에서 어떤 이야기가 될지 한 줄. 40자 이내"}',
].join('\n')

/** 🔴 보내는 것이 이게 전부다. 전문 필드가 없다 */
export function buildPayload(t: JudgeInput): string {
  return JSON.stringify({
    title: S(t.title),
    bodyHead: S(t.bodyHead).slice(0, BODY_HEAD_MAX),
    axis: S(t.axis),
    lane: S(t.lane),
    assetAxes: S(t.assetAxes),
    commentCount: Number(t.commentCount ?? 0),
    bodyLength: Number(t.bodyLength ?? 0),
  })
}

export const MAX_ATTEMPTS = 2
export const RETRY_BASE_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/** 🔴 지수 백오프 + jitter — 같은 간격으로 재시도하면 상대 서버에 파형이 남는다 */
export function backoffMs(attempt: number, rand: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1)
  return base + Math.floor(rand * base)
}

/** provider 오류 코드를 상태로 옮긴다 — 🔴 원인이 다르면 대응이 다르다 */
export function statusOf(errorCode: string | null, maxTokens: boolean): SemanticStatus {
  if (maxTokens) return 'maxTokens'
  const c = String(errorCode ?? '')
  if (c === 'NO_API_KEY') return 'noKey'
  if (c === 'TIMEOUT' || c === 'ABORTED' || /timeout/i.test(c)) return 'timeout'
  if (c !== '') return 'httpError'
  return 'ok'
}

/** 재시도해도 소용없는 것 — 키가 없거나 상한에 닿았다 */
export function isRetryable(st: SemanticStatus): boolean {
  return st === 'timeout' || st === 'httpError'
}

/**
 * 모델에 묻는다 — 🔴 **실패를 종류별로 남기고, 종류에 맞게만 재시도한다.**
 *
 * provider 오류·타임아웃은 최대 2회. 파싱 실패는 형식을 다시 일러 1회.
 * 그래도 안 되면 `verdict: null` 이고 judgeOne 이 HOLD 로 보낸다.
 */
/**
 * 🔴 **회차 장부.** `main()` 이 열기 전에는 `null` 이고, 그동안은 요청이 나가지 않는다.
 *    "장부가 없으면 그냥 보낸다" 는 선택지를 두지 않는다 — 그 한 줄이 통제를 없앤다.
 */
let LEDGER: SupplyLlmSession | null = null

/** 🔴 이 파일에서 provider 로 나가는 **유일한 문**. 장부가 없으면 보내지 않는다 */
async function ask(stage: 'judge' | 'judgeRetry', systemPrompt: string, userPayload: string): Promise<LlmResponse> {
  if (LEDGER === null) {
    return {
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
      finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
      usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
      errorCode: 'NO_LEDGER', errorMessage: '장부가 열리지 않아 유료 요청을 보내지 않았다',
    }
  }
  return LEDGER.call({
    stage, model: JUDGE_MODEL, systemPrompt, userPayload,
    maxOutputTokens: JUDGE_MAX_TOKENS, timeoutMs: JUDGE_TIMEOUT_MS,
  })
}

async function askSemantic(t: JudgeInput): Promise<SemanticOutcome> {
  let attempt = 0
  let lastStatus: SemanticStatus = 'skipped'
  let lastError: string | null = null

  for (; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs(attempt, Math.random()))
    const res = await ask('judge', SYSTEM_PROMPT, buildPayload(t))
    lastError = res.errorCode
    lastStatus = statusOf(res.errorCode, res.maxTokensReached)
    if (lastStatus !== 'ok') {
      if (!isRetryable(lastStatus)) break
      continue
    }
    const v = parseSemantic(res.rawText)
    if (v !== null) {
      return {
        verdict: v, status: 'ok', attemptCount: attempt + 1,
        providerErrorCode: null, model: JUDGE_MODEL,
      }
    }
    // 🔴 파싱 실패 — 형식을 다시 일러 한 번만 더 묻는다
    lastStatus = 'parseError'
    const retry = await ask(
      'judgeRetry',
      `${SYSTEM_PROMPT}\n\n🔴 지난 답이 JSON 이 아니었다. 설명 없이 JSON 객체 하나만 답한다.`,
      buildPayload(t),
    )
    attempt += 1
    const v2 = (retry.ok && !retry.maxTokensReached) ? parseSemantic(retry.rawText) : null
    if (v2 !== null) {
      return {
        verdict: v2, status: 'ok', attemptCount: attempt + 1,
        providerErrorCode: null, model: JUDGE_MODEL,
      }
    }
    break
  }
  return {
    verdict: null, status: lastStatus, attemptCount: attempt + 1,
    providerErrorCode: lastError, model: JUDGE_MODEL,
  }
}

/**
 * 판정 캐시 — 🔴 **원문 · 제목 · 본문 머리를 담지 않는다.** 해시와 결과뿐이다.
 *
 * 같은 글을 같은 규칙·같은 모델로 다시 묻지 않는다. 돈보다 재현성 때문이다 —
 * 재실행할 때마다 답이 달라지면 dry-run 에서 본 것이 무의미해진다.
 */
const CACHE_PATH = join(DATA_DIR, 'auto-judge-cache.json')
type CacheEntry = {
  decision: string; confidence: number | null; semanticRisks: string[]
  communityAngle: string; semanticStatus: string; attemptCount: number
}
function cacheKey(id: string, hash: string): string {
  return `${id}|${hash}|${RULE_VERSION}|${PROMPT_VERSION}|${JUDGE_MODEL}`
}
function loadCache(): Map<string, CacheEntry> {
  try {
    const j = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as Record<string, CacheEntry>
    return new Map(Object.entries(j))
  } catch { return new Map() }
}
function saveCache(m: ReadonlyMap<string, CacheEntry>): void {
  writeFileSync(CACHE_PATH, `${JSON.stringify(Object.fromEntries(m), null, 0)}\n`, 'utf-8')
}

async function main(): Promise<void> {
  await loadEnvLocal()
  // 🔴 --apply 단독 거부 — 무엇을 근거로 쓸지 정하지 않은 채 쓰는 것이다
  if (APPLY && !CALL) fail('--apply 는 --call 과 함께 씁니다. 무엇을 근거로 쓸지 먼저 정합니다')

  const mode = !CALL ? '오프라인 계획만' : APPLY ? '호출 + shadow 파일 생성' : '호출 (shadow 파일 0 · cache write 있음)'
  console.log(`\n══ ${mode} ══\n`)
  console.log(`  규칙  ${RULE_VERSION} · 프롬프트 ${PROMPT_VERSION} · provenance ${AUTO_PROVENANCE}`)
  console.log(`  모델  ${CALL ? JUDGE_MODEL : '(부르지 않는다)'}`)
  console.log('  🔴 사람 판정을 사칭하지 않는다 — SEED·ADOPT·founder 를 쓰지 않는다')
  console.log(`  🔴 DB 0 · 큐 0 · 발행 0 · Sheet 0${CALL ? '' : ' · 네트워크 0 · LLM 0 · 파일 write 0'}\n`)

  const all = loadTargets()
  if (all.length === 0) fail(`${DATA_DIR} 에 판정할 상세 행이 없다`)
  const human = humanDecisions()
  const fresh = all.filter((t) => !human.has(S(t.sourceArticleId)))
  const seen = all.filter((t) => human.has(S(t.sourceArticleId)))
  const now = new Date().toISOString()

  // ① deterministic 게이트 — 🔴 여기서 확정되는 것은 모델을 부르지 않는다
  const needAsk: JudgeInput[] = []
  const preJudged: Judgement[] = []
  for (const t of fresh) {
    const hard = hardGate(t)
    if (hard.some((c) => HARD_BLOCK.includes(c)) || S(t.sourceArticleId) === '') {
      preJudged.push(judgeOne(t, now)); continue
    }
    if (preSemanticGate(t).length > 0) { preJudged.push(judgeOne(t, now)); continue }
    needAsk.push(t)
  }
  console.log(`① 상세 ${all.length}건 → 신규 ${fresh.length}건 · 사람이 이미 본 것 ${seen.length}건`)
  console.log(`   deterministic 확정 ${preJudged.length}건 · 의미 판정이 필요한 것 ${needAsk.length}건`)

  if (!CALL) {
    console.log('\n② 부르지 않는다 — 오프라인 계획만이다.')
    console.log('   🟡 네트워크 0 · LLM 0 · 파일 write 0. 물어보려면 --call 을 붙이세요.\n')
    return
  }

  const key = keyStatus(JUDGE_MODEL)
  if (!key.present) fail(`${key.envName} 가 없습니다`)

  /**
   * 🔴 **회차 장부를 연다** (2026-09-17). 이 줄 뒤에야 유료 요청이 나갈 수 있다.
   *
   *    예산·여유 배수는 **env 에서만** 온다. 비어 있으면 모든 유료 요청이 보류되고
   *    회차는 호출 0 으로 끝난다 — 아무도 정하지 않은 금액으로 돈을 쓰지 않는다.
   */
  const ledgerRunId = `judge-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')}`
  LEDGER = new SupplyLlmSession({ runId: ledgerRunId, limits: limitsFromEnv(process.env) })
  console.log(`   장부 ${LEDGER.dir}`)
  console.log(`   예산 ${LEDGER.limits.dailyUsd === null ? '🔴 미설정 — 유료 요청을 보류한다' : `$${LEDGER.limits.dailyUsd}/일`}`
    + ` · 여유 배수 ${LEDGER.limits.headroomMultiplier ?? '🔴 미설정'}`
    + ` · 회차 요청 상한 ${LEDGER.limits.runRequestCap ?? '없음'}`)

  // ② 캐시 — 🔴 같은 입력을 두 번 묻지 않는다
  const cache = loadCache()
  let hit = 0
  let miss = 0
  const asked: Judgement[] = []
  const statusCount = new Map<string, number>()
  for (const [i, t] of needAsk.entries()) {
    const k = cacheKey(S(t.sourceArticleId), inputHashOf(t))
    const c = cache.get(k)
    let outcome: SemanticOutcome
    if (c !== undefined) {
      hit += 1
      outcome = {
        verdict: c.semanticStatus === 'ok'
          ? { decision: c.decision as never, confidence: c.confidence ?? 0,
            risks: c.semanticRisks as never[], communityAngle: c.communityAngle }
          : null,
        status: c.semanticStatus as SemanticStatus,
        attemptCount: c.attemptCount, providerErrorCode: null, model: JUDGE_MODEL,
      }
    } else {
      miss += 1
      outcome = await askSemantic(t)
      // 🔴 **실패는 캐시하지 않는다.** 실패를 캐시하면 다음 실행에서도 영원히 실패다 —
      //    성공한 판정만 재사용하고, 못 받은 것은 다음 회차에 다시 묻는다
      if (outcome.status === 'ok') {
        cache.set(k, {
          decision: outcome.verdict?.decision ?? '', confidence: outcome.verdict?.confidence ?? null,
          semanticRisks: outcome.verdict?.risks ?? [], communityAngle: outcome.verdict?.communityAngle ?? '',
          semanticStatus: outcome.status, attemptCount: outcome.attemptCount,
        })
      }
    }
    statusCount.set(outcome.status, (statusCount.get(outcome.status) ?? 0) + 1)
    asked.push(judgeOne(t, now, outcome))
    if ((i + 1) % 20 === 0) console.log(`   … ${i + 1}/${needAsk.length}`)
  }
  const judged = [...preJudged, ...asked]
  const s = summarize(judged)

  console.log(`\n② 호출  cache hit ${hit} · miss ${miss} · 실제 호출 ${miss}건`)
  for (const [st, n] of [...statusCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${st === 'ok' ? '🟢' : '🔴'} ${st.padEnd(10)} ${n}건`)
  }
  const okCount = statusCount.get('ok') ?? 0
  const rate = needAsk.length === 0 ? 1 : okCount / needAsk.length
  console.log(`   호출 성공률 ${(rate * 100).toFixed(1)}%`)

  console.log('\n③ 판정')
  console.log(`   🟢 AUTO_SEED  ${s.AUTO_SEED}건`)
  console.log(`   🟢 AUTO_RAW   ${s.AUTO_RAW}건`)
  console.log(`   🟡 AUTO_HOLD  ${s.AUTO_HOLD}건  — 실패가 아니라 자동 격리다`)
  console.log(`   🔴 AUTO_DROP  ${s.AUTO_DROP}건`)

  console.log('\n④ 사유')
  for (const [code, n] of Object.entries(s.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}건  ${REASON_LABEL[code as keyof typeof REASON_LABEL] ?? code}`)
  }

  // ── 회귀 대조 ──
  const regRows: RegressionRow[] = []
  for (const t of seen) {
    const blocked = hardGate(t).some((c) => HARD_BLOCK.includes(c))
    const pre = preSemanticGate(t).length > 0
    let outcome: SemanticOutcome = SKIPPED
    if (!blocked && !pre) {
      const k = cacheKey(S(t.sourceArticleId), inputHashOf(t))
      const c = cache.get(k)
      if (c !== undefined) {
        hit += 1
        outcome = {
          verdict: c.semanticStatus === 'ok'
            ? { decision: c.decision as never, confidence: c.confidence ?? 0,
              risks: c.semanticRisks as never[], communityAngle: c.communityAngle }
            : null,
          status: c.semanticStatus as SemanticStatus,
          attemptCount: c.attemptCount, providerErrorCode: null, model: JUDGE_MODEL,
        }
      } else {
        miss += 1
        outcome = await askSemantic(t)
        if (outcome.status === 'ok') {
          cache.set(k, {
            decision: outcome.verdict?.decision ?? '', confidence: outcome.verdict?.confidence ?? null,
            semanticRisks: outcome.verdict?.risks ?? [], communityAngle: outcome.verdict?.communityAngle ?? '',
            semanticStatus: outcome.status, attemptCount: outcome.attemptCount,
          })
        }
      }
    }
    const v = judgeOne(t, now, outcome)
    regRows.push({
      sourceArticleId: S(t.sourceArticleId),
      humanDecision: human.get(S(t.sourceArticleId)) ?? '',
      autoDecision: v.decision,
    })
  }
  // 🔴 **장부를 화면에 찍는다.** 안 보이면 늘어도 모른다
  if (LEDGER !== null) console.log(`\n④-b ${LEDGER.describe()}`)

  const reg = checkRegression(regRows)
  console.log(`\n⑤ 회귀 대조 (사람이 이미 판정한 ${regRows.length}건)`)
  console.log(`   🔴 false pass  ${reg.falsePass.length}건 · 🟡 보수적 ${reg.conservative.length}건 · 🟢 일치 ${reg.agree.length}건`)
  for (const r of reg.falsePass) {
    console.log(`      🔴 ${r.sourceArticleId}  사람 ${r.humanDecision} · 기계 ${r.autoDecision}`)
  }
  console.log('   🔴 표본이 작다. 이 수로 정확도를 주장하지 않는다.')
  console.log('   🔴 pre-gate 로 막힌 건은 semantic judge 가 가른 증거가 아니다.')
  if (reg.falsePass.length > 0) fail('회귀 false pass 가 나왔다')

  if (!APPLY) {
    console.log('\n⑥ shadow 판정 파일을 만들지 않는다 — --apply 를 붙이세요.')
    console.log('   🟡 판정 캐시는 갱신한다 (반복 호출 방지). 원문·제목·본문 머리는 담기지 않는다.\n')
    saveCache(cache)
    return
  }
  for (const jd of judged) {
    const bad = violatesProvenance(jd as unknown as Record<string, unknown>)
    if (bad.length > 0) fail(`provenance 위반\n${bad.map((b) => `     ${b}`).join('\n')}`)
  }
  const runId = now.replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const out = join(DATA_DIR, `auto-judge-${runId}.shadow.jsonl`)
  if (!isInsideDataDir(out)) fail(`${out} 은 ${DATA_DIR}/ 밖이다`)
  writeFileSync(out, `${judged.map((jd) => JSON.stringify(jd)).join('\n')}\n`, 'utf-8')
  saveCache(cache)
  console.log(`\n⑥ 🔴 판정 파일 ${judged.length}건`)
  console.log(`   ✅ ${out}`)
  console.log('   🔴 큐에 넣지 않았다 · 발행하지 않았다 · 원문·제목·본문 머리는 결과 파일에 없다.\n')
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
export { SEED_AXIS }
