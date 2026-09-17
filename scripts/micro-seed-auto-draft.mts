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
import { expandSeed } from './lib/micro-seed-seed-originality.mjs'
import {
  pickDraft, summarizeDrafts, violatesDraftProvenance, normalize, parseQuality,
  echoesTitleAtEnd, hasBannedWord, checkDraft,
  DRAFT_REASON_LABEL, DRAFT_RULE_VERSION, DRAFT_PROMPT_VERSION, DRAFT_PROVENANCE,
  MAX_DRAFTS_PER_SOURCE, DRAFT_QUALITY_AXES, DRAFT_QUALITY_AXIS_PROMPT,
  LIFE_CONFLICT_MISSING, LIFE_EVIDENCE_NOT_FOUND,
  QUALITY_PROMPT_VERSION, BANNED_WORDS,
  lifeHistoryLines, lifeReferenceLines, noGoAvoidLines, applyQuality, judgeSourceGate, judgeDraftGate,
  pickDraftGated, judgeLifeRetry,
} from '../src/lib/micro-seed-auto-draft'
import { judgeSelfAgeConflict, SELF_AGE_RULE_VERSION } from '../src/lib/persona-self-age'
/**
 * 🔴 **생성 전 큐 스냅샷** (2026-09-17). 이 스크립트는 여전히 **DB 를 읽지 않는다** —
 *    러너가 읽어 파일로 건넨 것을 검증해서 쓴다. 판정 규칙은 여기서 만들지 않는다.
 */
import { readQueueSnapshot, planPreDraftExclusion } from '../src/lib/supply-queue-snapshot'
import {
  MACHINE_AGE_HUMAN_REVIEW_NOTE, AGE_CHECK_MODEL_TRIAL, AGE_CHECK_QUALIFIED_MODEL,
  type DraftCandidate, type Judgement, type Pick, type DraftQualityVerdict,
  type PersonaLifeHistory,
  evidenceFoundIn, mergeLifeConflict,
  type LifeConflict,
} from '../src/lib/micro-seed-auto-draft'
/** 🔴 독창성 정본 — 생성 · 적재 · 발행 전 재검사가 같은 함수를 쓴다 */
import {
  measureOriginality, judgeCopy, describeOriginality, COPY_REASON_LABEL,
  copiesSourceTitle, SOURCE_TITLE_CHECK_VERSION,
} from '../src/lib/draft-originality'
/**
 * 🔴 **말투 자산을 새로 만들지 않는다** (2026-09-13).
 *
 *    이 레인은 "존댓말 · 2~4문장 · 마지막에 물음표" 라는 손으로 적은 25줄 프롬프트를 썼고,
 *    그래서 모든 글이 한 모양으로 나왔다. 그런데 이 저장소에는 이미
 *    원문을 읽고 **온도 · 제목 모양 · 전개 · 맺음** 을 정하는 정본이 있다 —
 *    `source-profile.ts` 는 Original Post 레인이 창업자 피드백 11판을 거쳐 만든 것이다.
 *    그것을 여기로 **연결**한다. 두 벌째 체계를 만들면 한쪽만 낡는다.
 */
import { createHash } from 'node:crypto'
import { readSourceProfile, profileDirectives, titleDirectives, type SourceProfile } from './lib/source-profile'
/**
 * 🔴 **말투 근거를 새로 만들지 않는다** (2026-09-13).
 *
 *    댓글 레인이 2026-09-10 에 세운 정본 자산을 그대로 쓴다 —
 *    외부 커뮤니티 댓글 879건을 익명화하고 작성자 대조(유출 0건)를 마친 것이다.
 *    🔴 **소란소란 회원 글·댓글은 여기 들어 있지 않고, provider 로 나가지도 않는다.**
 *
 * 🔴 **Persona 를 점유하지 않는다.** `planBundles` 에 Persona 코드가 아니라
 *    말투 슬롯 이름을 준다. 묶음은 **리듬 근거**일 뿐이고 생활사를 주장하지 않는다 —
 *    `allowExperience: false` 가 경험형 댓글을 빼기 때문에, 발행 시점에 어떤 Persona 가
 *    배정되든 모순될 사실이 없다.
 */
import { loadCanonAsset, planBundles } from './lib/persona-reference-store.mjs'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
/**
 * 🔴 **Persona 정체성의 정본은 Pool 카드 문서다.** 여기서 만들지도 복제하지도 않는다.
 *    생활사 판정도 발행 matcher 의 정본(`readPostRequirements` · `hardFilter`)을 그대로 쓴다 —
 *    `voice-persona-plan` 이 그 둘을 맞춰 볼 뿐이다.
 */
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { planVoicePersonas, loadSpread } from '../src/lib/voice-persona-plan'

/** 🔴 정본 문서 경로 — `persona-pool-card` 파일 머리가 가리키는 그 문서다 */
export const PERSONA_POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
import type { VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import type { VoiceProvenance } from '../src/lib/original-post-voice-match'
import { humanVoiceDirectives, registerFreedomDirectives, VOICE_TAKEAWAYS } from './lib/original-post-prompt'
// 🔴 기존 LLM 경로를 그대로 쓴다. 새 HTTP 클라이언트도 SDK 도 만들지 않는다
import { keyStatus, type LlmResponse, type ProviderModel } from './lib/voice-m3-provider.mjs'
/**
 * 🔴 **유료 요청은 장부를 지나서만 나간다** (2026-09-17).
 *    `callProvider` 를 직접 부르지 않는다 — 나이 검수가 바로 그렇게 새어 나가
 *    회차 상한(`CallBudget`)에도 관제 집계에도 잡히지 않았다.
 */
import { SupplyLlmSession, limitsFromEnv } from './lib/supply-llm-call.mjs'
import { type LedgerStage } from '../src/lib/llm-ledger'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { judgeCrisisSignal, SAFETY_SIGNAL_VERSION } from '../src/lib/micro-seed-safety-signals'
import { generateWithRetries } from '../src/lib/micro-seed-draft-run'
import { SEMANTIC_RISKS, DRAFT_HARM_AXES } from '../src/lib/micro-seed-auto-judge'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { inputHashOf, SEMANTIC_DROP } from '../src/lib/micro-seed-auto-judge'

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
/**
 * 🔴 **cache 를 지우지 않고 무시한다** (2026-09-13).
 *    새 코드만 평가하고 싶을 때 운영 cache 파일을 지우면 되돌릴 수 없다.
 *    읽지도 쓰지도 않는 쪽이 안전하다.
 */
const NO_CACHE = argv.includes('--no-cache')
/**
 * 🔴 **생성 전 큐 스냅샷** — 러너가 넘긴다.
 *
 *    `--require-queue-snapshot` 은 *"없거나 어긋나면 만들지 말라"* 는 뜻이다.
 *    러너는 항상 이 셋을 같이 넘긴다. 손으로 부를 때는 안 넘겨도 종전대로 돈다 —
 *    🔴 그 경우 **사전 제외가 없다는 사실을 화면에 적는다.** 조용히 넘어가지 않는다.
 */
const QUEUE_SNAPSHOT = ((): string | null => {
  const hit = argv.find((a) => a.startsWith('--queue-snapshot='))
  return hit === undefined ? null : hit.slice('--queue-snapshot='.length)
})()
const RUN_ID = ((): string | null => {
  const hit = argv.find((a) => a.startsWith('--run-id='))
  return hit === undefined ? null : hit.slice('--run-id='.length)
})()
const REQUIRE_QUEUE_SNAPSHOT = argv.includes('--require-queue-snapshot')
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

/**
 * 🔴 **판정 결과 파일을 지정한다** (`--input=<path>`).
 *
 * 지정이 없으면 종전대로 `.shadow.jsonl` 전체를 읽는다. Autopilot 이 끊긴 회차를
 * 이을 때는 앞 회차가 낸 **그 판정**으로 초안을 써야 한다 — 최신 파일에 맡기면
 * 이번에 수집하지도 판정하지도 않은 원천으로 글을 쓴다.
 */
function shadowOverride(): string[] | null {
  const hit = argv.find((a) => a.startsWith('--input='))
  if (hit === undefined) return null
  const paths = hit.slice('--input='.length).split(',').map((x) => x.trim())
    .filter((x) => x !== '' && x.endsWith('.shadow.jsonl'))
  return paths.length === 0 ? null : paths
}

function loadAutoSeeds(): Judgement[] {
  const files = shadowOverride() ?? filesEnding('.shadow.jsonl')
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
/** 🔴 나이 검수는 JSON 한 줄만 받는다 — 큰 검수와 같은 상한을 쓰지 않는다 */
export const AGE_CHECK_MAX_TOKENS = 200
export const DRAFT_TIMEOUT_MS = 25000
export const DRAFT_MAX_TOKENS = 1200
export const MAX_ATTEMPTS = 2
/**
 * 🔴 **원문을 옮겼을 때 다시 쓰게 하는 횟수** (2026-09-13).
 *    2회면 충분하다 — 세 번째도 같으면 소재 자체가 베낄 수밖에 없는 형태라는 뜻이고,
 *    그때는 사람이 보는 편이 낫다. 호출 비용은 원천당 최대 3회로 묶인다.
 */
/**
 * 🔴 **원천당 1회** (2026-09-13, 2에서 줄였다).
 *    실제 요청 상한을 4회/source 로 잡으면서 재생성 자리는 하나다 —
 *    두 번째 재생성이 첫 번째보다 나아진다는 근거가 아직 없다.
 */
export const MAX_ORIGINALITY_RETRIES = 1
/** 🔴 생활사가 어긋났을 때 **관점을 바꿔** 다시 쓰는 횟수 — 기존 호출 예산 안이다 */
export const MAX_LIFE_CONFLICT_RETRIES = 1

/** 🔴 소재는 그대로 두고 **자리만 바꾸라**고 말한다. 소재를 버리라고 하지 않는다 */
/**
 * 🔴 **무엇이 잘못됐는지 그대로 말해 준다** (2026-09-13).
 *    "우리 축이 아닌 이름" 하나로 뭉뚱그리면 모델이 같은 실수를 반복한다.
 */
export function schemaRetryDirective(unknown: readonly string[]): string {
  const lines = ['🔴 지난 답의 형식이 맞지 않았다.']
  if (unknown.includes(LIFE_CONFLICT_MISSING)) {
    lines.push('   · `lifeConflict` 를 빠뜨렸다. 이 항목은 **반드시** 채운다 —'
      + ' 해당이 없으면 {"conflict":false,"evidence":""} 다.')
  }
  if (unknown.includes(LIFE_EVIDENCE_NOT_FOUND)) {
    lines.push('   · `evidence` 가 **초안에 없는 문장**이었다. 초안의 문장을'
      + ' **그대로 옮겨** 적는다. 옮길 문장이 없으면 conflict 는 false 다.')
  }
  const others = unknown.filter((x) => x !== LIFE_CONFLICT_MISSING && x !== LIFE_EVIDENCE_NOT_FOUND)
  if (others.length > 0) {
    lines.push(`   · 우리 축이 아닌 이름이 있었다: ${others.join(' · ')}`)
    lines.push('     위에 적힌 이름만 쓴다. 해당이 없으면 빈 배열이다.')
  }
  return lines.join('\n')
}

export function lifeConflictDirective(p: PersonaLifeHistory, evidence: readonly string[]): string {
  return ['', '', '🔴 방금 쓴 글이 **당신의 삶과 어긋났습니다.**',
    ...lifeHistoryLines(p).map((x) => `   ${x}`),
    ...(evidence.length > 0 ? ['', '   이렇게 읽혔습니다:', ...evidence.slice(0, 2).map((e) => `   · ${e}`)] : []),
    '', '🔴 **소재는 그대로 씁니다.** 재미있고 할 말이 있는 소재라는 사실은 변하지 않습니다.',
    '   바꾸는 것은 **당신이 서 있는 자리**입니다 —',
    '   곁에서 본 이야기로 · 궁금해서 묻는 글로 · 읽고 든 생각으로 · 비슷한 다른 경험으로.',
    // 🔴 2026-09-14 — 나이가 안 맞으면 버릴 것이 아니라 **세대를 옮기면 된다**
    '   나이가 맞지 않으면 **세대를 옮깁니다** —',
    '   자녀 세대 이야기로 · 조카/후배 이야기로 · 주변에서 본 사례로 ·',
    '   세대 차이에 대한 생각으로 · 내가 그 나이였을 때와 비교하는 글로.',
    '   없는 가족을 지어내지도, 새 개인 사정을 만들지도 않습니다.',
  ].join('\n')
}

/**
 * 🔴 **말투 근거를 Persona 에 묶는다** (2026-09-13 정정).
 *
 *    앞선 판은 `voice-a`~`voice-h` 라는 **가짜 슬롯**에 묶었다.
 *    발행 자리를 점유하지 않는다는 점은 맞았지만, 그 이름을 아무도 읽지 않아서
 *    **반말 중심 말투로 쓴 글이 존댓말 중심 Persona 이름으로 나갈 수 있었다** —
 *    matcher 는 `voice-a` 가 무엇인지 모른다.
 *
 *    이제 정본 universe 의 Persona 코드에 묶는다(`bundlesForPersonas` 가 그 검사를 한다).
 *    🔴 **후보를 만드는 것만으로 발행 슬롯을 점유하지는 않는다** —
 *    DB 에 `matchedAt` 를 쓰지 않고, 발행 시 `hardFilter` 와 여력을 **다시** 본다.
 */

/**
 * 🔴 **원천 ID 해시로 고르던 것을 없앴다** (2026-09-13).
 *
 *    옛 `voiceSlotOf` 는 원문이 무엇을 요구하는지, 그 Persona 가 누구인지 보지 않았다.
 *    실측: 생성 **전** 생활사 충돌 3/8 · P03 혼자 3건 · 18명 중 6명만 쓰임.
 *    쓸 수 없는 사람의 목소리로 AI 생성부터 하는 것이 구조적 낭비였다.
 *    이제 `planVoicePersonas` 가 **정본 생활사 판정**으로 고른다 → `src/lib/voice-persona-plan.ts`
 */

/** 🔴 provenance 에 남기는 것 — **텍스트도 작성자도 남기지 않는다. 근거의 신원뿐이다** */
// 🔴 모양의 정본은 `src/lib/original-post-voice-match.ts` 하나다 — 여기서 다시 적지 않는다
export type { VoiceProvenance } from '../src/lib/original-post-voice-match'

const RETRY_BASE_MS = 400
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })
export function backoffMs(attempt: number, rand: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1)
  return base + Math.floor(rand * base)
}


/**
 * 🔴 **원문 전문 · 댓글 · 작성자 · URL 을 보내지 않는다.**
 *    제목과 마스킹된 앞 300자, 그리고 판정이 남긴 한 줄이 전부다.
 *    이 경계는 v4 에서도 그대로다 — 바꾼 것은 **무엇을 시키는가** 이지 무엇을 보내는가가 아니다.
 *
 * 🔴 **v3 프롬프트를 왜 버렸나** (2026-09-13).
 *
 *    v3 은 손으로 적은 25줄이었고 그중 셋이 형식을 못박았다 —
 *    "본문 모든 문장이 ~요 로 끝난다" · "본문 2~4문장" · "마지막 문장은 반드시 물음표".
 *    그 셋을 동시에 만족하는 글은 사실상 한 종류다. 실제로 한 종류만 나왔다.
 *    더 나쁜 것은 v3 이 `"다들 어떠세요?"` 를 **따라 쓰라고 예시로 준 것**인데,
 *    같은 저장소의 Original Post 레인은 그 문장을 창업자 피드백 9판 끝에
 *    **억지 CTA** 로 분류해 경계 목록에 올려 두고 있었다. 두 레인이 정반대를 시키고 있었다.
 *
 * 🔴 **고치는 방법은 지시를 더 얹는 것이 아니다.** 이미 있는 정본을 연결한다 —
 *    `readSourceProfile` 이 원문에서 온도 · 제목 모양 · 전개 · **맺음 방식**을 읽고,
 *    `profileDirectives` 가 그것을 사람 말로 옮긴다. 맺음은 원문이 정한다:
 *    묻는 글이면 묻고, 털어놓는 글이면 묻지 않고 끝난다.
 *
 * 🔴 **글마다 프롬프트가 달라진다.** 그래서 상수가 아니라 함수다 —
 *    상수 하나로 모든 글을 만들면 모든 글이 같은 모양이 된다. 그것이 v3 이었다.
 */
/**
 * 🔴 **글쓴이가 누구인지 알려 준다** (2026-09-13).
 *
 *    원문에서 생활사를 읽어 후보를 좁히는 방식은 한국어의 생략 때문에 반드시 샌다.
 *    `어제 남편이 늦게 들어왔어요` 에는 임자가 없어 조건이 서지 않고,
 *    발행 직전 `hardFilter` 도 **같은 함수의 출력**을 받으므로 거기서 다시 잡히지 않는다.
 *    막을 수 있는 자리는 **쓰는 순간**이다.
 *
 * 🔴 **소재를 버리라는 말이 아니다.** 남편 이야기도 자녀 이야기도 그대로 쓴다.
 *    자기 삶과 다르면 **관점을 바꾼다** — 보고 느낀 것 · 묻고 싶은 것 · 곁에서 본 것.
 *    없는 가족을 지어내지 않는 것과, 그 소재를 못 쓰는 것은 다른 일이다.
 */
function personaLifeDirectives(p?: PersonaLifeHistory): string[] {
  if (p === undefined) return []
  return [
    '## 🔴 당신은 이런 사람입니다',
    ...lifeHistoryLines(p),
    '',
    '위 항목은 **당신의 실제 삶**입니다. 글에서 1인칭으로 말할 때 이것과 어긋나지 않습니다.',
    '- 혼인 상태에 없는 배우자를 "우리 남편" 이라고 부르지 않습니다.',
    '- 없는 자녀를, 다른 나이대의 자녀를 자기 아이처럼 말하지 않습니다.',
    '- 해 본 적 없는 부모 돌봄을 자기 경험으로 말하지 않습니다.',
    '- 아직 오지 않은 갱년기를 자기 증상으로 말하지 않습니다.',
    /**
     * 🔴 2026-09-17 — **직업을 안 주고 "지어내지 말라" 고만 했다.**
     *    실측: 카드가 `은퇴` 인 P14 가 *"우리 직장도 그런데"* 를 썼다.
     *    이제 값을 주되, **가능한 생활사를 모순으로 단정하지 않는다** —
     *    은퇴한 사람도 다시 일하고, 전업도 부업을 하고, 누구나 옛 직장 이야기를 한다.
     */
    '- 지금 하는 일을 **다른 것으로 바꿔 말하지 않습니다.**',
    '  🔴 다만 다음은 전부 자연스럽습니다 — 막지 않습니다:',
    '   · 은퇴한 뒤 다시 일을 찾거나 짧게 일하는 이야기 · 부업 · 봉사 · 소일거리',
    '   · 예전에 다니던 직장 이야기 · 배우자나 자녀의 일 이야기',
    '   · 남의 직장 이야기를 듣고 드는 생각',
    '- 사는 곳을 다른 지역으로 바꿔 말하지 않습니다. 여행·방문 이야기는 자연스럽습니다.',
    // 🔴 2026-09-14 — 나이를 안 넘겨서 `우리 언니(30~32)` 가 나왔다. 관계의 **나이**를 본다
    '- 당신 나이에서 나올 수 없는 가족 관계를 지어내지 않습니다.',
    '  (예: 40대 후반인데 "우리 언니가 서른 하나" · 50대인데 "우리 엄마가 예순 하나")',
    /**
     * 🔴 2026-09-16 — **자기 나이를 직접 말하는 경우가 빠져 있었다.**
     *    실측: `60대 초반` 인데 본문 첫 줄이 *"40대 후반이고 …"*,
     *    `50대 후반` 인데 *"내가 서른 대 중반쯤 될 때"*. 가족 관계는 맞는데
     *    **화자 자신의 나이**가 어긋났고, 검수 프롬프트도 그것을 묻지 않았다.
     */
    `- 🔴 당신이 **자기 나이를 직접 말할 때**는 반드시 ${p.ageBand ?? '당신의 나이대'} 안이어야 합니다.`,
    '  (예: "저는 40대 후반이고" · "올해 쉰 둘인데" · 문장 첫머리의 "50대 초반이라")',
    '  당신 나이대 밖의 숫자로 자기를 소개하지 않습니다.',
    '',
    '🔴 **나이 이야기를 못 한다는 뜻이 아닙니다.** 다음은 전부 자연스럽습니다 —',
    '   · "요즘은 서른 넘어 결혼하는 사람이 많더라" 처럼 **일반적인 이야기**',
    '   · "우리 애 또래가" · "조카가" · "후배가" · "아는 집 딸이" 처럼 **아래 세대 이야기**',
    '   · 실제로 있을 수 있는 연상·연하 관계 (언니가 쉰 넷 · 동생이 마흔 둘)',
    '   · 세대 차이에 대한 생각, 내가 그 나이였을 때와의 비교',
    '',
    '🔴 **[소재] 는 남이 쓴 글입니다. 당신이 겪은 일이 아닙니다.**',
    '   소재의 사연이 당신 삶과 다르면 **소재를 버리지 말고 자리를 바꿔 씁니다** —',
    '   곁에서 본 이야기로 · 궁금해서 묻는 글로 · 읽고 든 생각으로 · 비슷한 다른 경험으로.',
    '   그 소재가 재미있고 할 말이 있는 소재라는 사실은 변하지 않습니다.',
    '',
    /**
     * 🔴 2026-09-17 — 옛 문장은 *"직업 · 사는 곳 …은 지어내지 않습니다"* 였는데
     *    **직업과 사는 곳을 주지 않았다.** 이제 위에서 준다. 그래서 여기 남는 것은
     *    **끝내 주지 않는 것**(병력 · 가족 구성)뿐이다 — 지킬 수 있는 지시만 남긴다.
     */
    '🔴 위에 적히지 않은 개인 사정(병력 · 가족 구성 · 학력 · 재산)은 **지어내지 않습니다.**',
    '',
    // 🔴 형편은 배경으로만 준다 — 본문에 드러내지 않는다(창업자 지정)
    ...lifeReferenceLines(p),
    ...(lifeReferenceLines(p).length > 0 ? [''] : []),
    // 🔴 카드가 정한 회피 소재. 발행 쪽 hardFilter 는 글자 그대로만 보므로 여기가 유일한 자리다
    ...noGoAvoidLines(p),
    ...(noGoAvoidLines(p).length > 0 ? [''] : []),
  ]
}

export function buildGenSystemPrompt(t: {
  title: string
  bodyHead: string
  /**
   * 🔴 **말투 근거.** 내용이 아니라 리듬이다 — 정본 자산에서 온 익명 댓글.
   *    없으면 이 섹션 자체가 빠진다. 빈 목록을 보여 주면 모델이 그것을 지시로 읽는다.
   */
  voiceSamples?: readonly string[]
  /**
   * 🔴 **이 글을 쓰는 사람의 생활사.** 정본은 Pool 카드이고, 여기서 만들지 않는다.
   *    없으면 섹션 자체가 빠진다 — 빈 값을 보여 주면 모델이 그것을 지시로 읽는다.
   */
  persona?: PersonaLifeHistory
}): string {
  // 🔴 프로파일은 **모델에게 보내는 것과 같은 재료**로 읽는다.
  //    여기서만 원문 전문을 보면 화면에 찍힌 근거와 모델이 받은 것이 어긋난다
  const profile = readSourceProfile({ rawTitle: t.title, rawBody: t.bodyHead })
  const samples = (t.voiceSamples ?? []).map((x) => x.trim()).filter((x) => x !== '')
  return [
    '당신은 한국의 40대 중반~60대 중반 여성들이 모인 커뮤니티의 회원입니다.',
    '아래 [소재] 는 다른 곳에서 읽은 글입니다. 그것을 읽고 **당신이 우리 게시판에 쓰는 글**을 씁니다.',
    '',
    ...(samples.length > 0
      ? ['## 🔴 재료가 두 가지입니다 — 섞지 마세요',
         '- **[소재]**: 무엇에 대해 쓸지. 소재와 문제의식만 가져옵니다.',
         '- **[말투 참고]**: 어떻게 쓸지. **말하는 방식만** 가져옵니다. 내용은 가져오지 않습니다.',
         '']
      : []),
    ...personaLifeDirectives(t.persona),
    ...profileDirectives(profile),
    '',
    ...titleDirectives(profile),
    '',
    ...voiceSampleDirectives(samples),
    ...humanVoiceDirectives(),
    ...registerFreedomDirectives(profile),
    '',
    ...topicFreedomDirectives(),
    '',
    '## 🔴 옮겨 적는 것이 아닙니다',
    '[소재] 는 **무엇에 대해 쓸지**일 뿐입니다. 번역도 요약도 재구성도 아닙니다.',
    '원문의 문장을 이어서 그대로 가져오지 않습니다. 말을 살짝 바꿔 옮기는 것도 안 됩니다.',
    '흔한 표현이 겹치는 것은 괜찮습니다 — 막는 것은 **문장이 통째로 넘어오는 것**입니다.',
    '🔴 다만 **사람 이름 · 프로그램 이름 · 작품 이름은 그대로 씁니다.**',
    '   그 이름이 바로 무슨 이야기인지 알려 주는 말이고, 바꾸면 글이 뭘 말하는지 알 수 없게 됩니다.',
    '   "어떤 배우" · "한 방송인" 으로 뭉개지 않습니다.',
    '원문의 문단 순서를 따라가지 않습니다. 그건 구조를 베낀 것입니다.',
    '',
    `## 🔴 이 낱말을 쓰지 않습니다: ${BANNED_WORDS.join(' · ')}`,
    `## 🔴 쓰지 않습니다: ${HARM_BANS.join(' · ')}`,
    '',
    `초안 ${MAX_DRAFTS_PER_SOURCE}개를 JSON 으로만 답합니다.`,
    '🔴 두 초안의 **말투와 길이를 서로 다르게** 씁니다. 같은 모양 둘은 하나만 있는 것과 같습니다.',
    '{"drafts":[{"title":"...","body":"...","intendedQuestion":"본문이 묻는 것 한 줄 (묻지 않는 글이면 빈 문자열)",',
    '  "sourceAngle":"이 소재의 어떤 결을 살렸는지 한 줄"}]}',
  ].join('\n')
}

/** 🔴 말투 참고 — **내용을 가져오지 않는다.** 섹션 문구는 Original Post 레인 정본과 같은 뜻이다 */
export function voiceSampleDirectives(samples: readonly string[]): string[] {
  if (samples.length === 0) return []
  return [
    '## 🔴 말투 참고 — 실제 사람이 쓴 댓글',
    '아래에서 볼 것은 이것뿐입니다:',
    ...VOICE_TAKEAWAYS.map((x) => `- ${x}`),
    '- 존댓말인지 반말인지, 섞어 쓰는지',
    '- 감정을 얼마나 세게 쓰는지 · 얼마나 직설적인지',
    '- 웃음(ㅋㅋ · ㅎㅎ) · 말줄임(…) · 감탄을 쓰는 자리',
    '- 글을 어떻게 끝내는지',
    '',
    '🔴 **내용을 가져오지 않습니다.** 여기 나온 사건·상황은 이번 글과 아무 상관이 없습니다.',
    '   문장을 옮기지 않고 표현을 빌려오지 않습니다. **쓸 내용은 [소재] 에서 가져옵니다.**',
    '🔴 이 사람을 흉내 내는 것이 아닙니다. 이렇게 **편하게 쓰면 된다**는 기준입니다.',
    '🔴 말투 참고와 위의 「이 글이 어떤 글인지」 가 어긋나면 **위쪽이 우선**입니다.',
    '',
    ...samples.flatMap((x, i) => [`--- 참고 ${i + 1} ---`, x, '']),
  ]
}

/**
 * 🔴 **주제를 막지 않는다는 것을 이름 대고 말한다** (2026-09-13, 창업자 결정).
 *
 *    무엇을 쓰지 마라만 주면 모델은 남은 가장 안전한 자리로 간다.
 *    옛 판은 `정치 · 공인 · 연예인 · 방송 · 약 · 치료 · 갈등` 을 통째로 금지했고,
 *    그래서 40~60대 여성이 실제로 쓰는 이야기가 통째로 빠졌다.
 */
export function topicFreedomDirectives(): string[] {
  return [
    '## 🔴 이런 이야기도 우리 이야기입니다',
    '- 연예인 · 방송인 · 공개 인물의 **실명**과 드라마 · 예능 · 작품 이름을 그대로 씁니다.',
    '- 화제가 된 발언과 사건을 다뤄도 됩니다. 검색으로 사람이 들어오는 글입니다.',
    '- 건강 · 갱년기 · 병원 다녀온 이야기 · 약을 먹어 본 경험을 써도 됩니다.',
    '- 부부 · 가족 · 직장 · 이웃과 있었던 갈등을 써도 됩니다.',
    '- 솔직한 불만 · 반박 · 취향 차이 · 가벼운 이견을 써도 됩니다.',
    '🔴 검색어를 도배하지는 않습니다. 이름과 사실은 남기고 **문장은 새로 씁니다.**',
  ]
}

/** 🔴 hard block — **소재가 아니라 위해다.** 목록이 이것뿐이어야 한다 */
export const HARM_BANS: readonly string[] = [
  '비공개 개인을 알아볼 수 있는 정보 (실명 + 직장 · 주소 · 연락처)',
  '확인되지 않은 범죄 · 불륜 · 질병을 사실로 단정하는 것',
  '특정인을 향한 위협 · 괴롭힘 · 신상 털기 · 혐오 선동',
  '약 · 용량 · 진단 · 치료를 확정적으로 지시하는 것 (경험담은 됩니다)',
  '정치 · 진영 선동',
  '광고 · 판매처 문의',
] as const

/**
 * 🔴 겹쳐서 다시 쓰라고 돌려보낼 때 덧붙이는 한 줄 (2026-09-13).
 *    원천 전체를 버리지 않는다 — 초안 하나가 베꼈을 뿐이다.
 */
export function retryDirective(reason: string): string {
  return [
    '',
    `🔴 방금 쓴 초안이 원문을 그대로 옮겼습니다 — ${reason}`,
    '   같은 소재로 **다시 씁니다.** 원문의 문장 구조를 따라가지 마세요.',
    // 🔴 **없는 생활사를 지어내게 하지 않는다** (2026-09-13 정정).
    //    첫 판은 "당신의 자리에서 겪은 같은 종류의 일로 바꿔 씁니다" 였다.
    //    말투 근거에는 생활사가 없다(`allowExperience: false`) — 겪은 일이 없는데
    //    겪은 것처럼 쓰라고 시키면 모델은 **경험을 만들어 낸다.**
    //    댓글 레인이 2026-09-10 에 같은 사고를 겪었다(18건 중 7건이 없는 경험을 지어냄).
    '   🔴 겪지 않은 일을 지어내지 않습니다. 근거가 없으면 경험담으로 쓰지 말고,',
    '   이 이야기를 **읽고 든 생각 · 반응 · 궁금한 것**으로 씁니다.',
    '   문장 순서와 시작하는 자리를 바꾸고, 원문이 길게 쓴 곳은 짧게 지나갑니다.',
  ].join('\n')
}

/**
 * 🔴 **provider 요청을 코드가 센다** (2026-09-13).
 *
 *    `MAX_ORIGINALITY_RETRIES = 2` 와 `callJson()` 안의 `MAX_ATTEMPTS`·파싱 재시도가
 *    곱해지면 원천 하나가 실제로 여러 번 나갈 수 있다.
 *    "최대 3회" 라는 말은 **재생성 횟수**이지 요청 수가 아니었다 — 보고가 틀렸다.
 *    이제 실제 요청을 한 곳에서 세고, 상한을 넘으면 더 부르지 않는다.
 */
export class CallBudget {
  private used = 0
  /** 🔴 **공동 예산이지만 어디에 썼는지는 보인다** — 원천별 사용량 (2026-09-13) */
  private readonly bySource = new Map<string, number>()
  private current: string | null = null
  constructor(private readonly max: number) {}
  get spent(): number { return this.used }
  get left(): number { return Math.max(0, this.max - this.used) }
  /** 지금부터 나가는 요청은 이 원천의 것으로 센다 */
  enter(sourceArticleId: string | null): void { this.current = sourceArticleId }
  get perSource(): ReadonlyMap<string, number> { return this.bySource }
  /** 원천당 가장 많이 쓴 수 — 계약(6회)을 넘었는지 본다 */
  get worstPerSource(): number {
    return this.bySource.size === 0 ? 0 : Math.max(...this.bySource.values())
  }
  take(): boolean {
    if (this.used >= this.max) return false
    this.used += 1
    if (this.current !== null) {
      this.bySource.set(this.current, (this.bySource.get(this.current) ?? 0) + 1)
    }
    return true
  }
}

/**
 * 🔴 초안 품질 판정 — auto-judge 와 분리된 물음이다.
 *
 * 🔴 **축 목록에서 만든다. 문자열을 손으로 적지 않는다** (2026-09-13).
 *    옛 판은 상수 문자열이었고, `DRAFT_QUALITY_AXES` 에서 `informalSpeech` 를 뺐는데도
 *    프롬프트에는 그대로 남아 있었다 — 모델은 프롬프트를 따르고, parser 는 그 답을
 *    다른 사유로 바꿔 HOLD 시켰다. 반말 허용이 실제 경로에 없었다.
 */
/**
 * 🔴 **나이·가족·세대 정합만 보는 짧은 검수 프롬프트** (2026-09-14).
 *
 *    큰 품질 프롬프트에 절차를 덧붙였더니 모델이 실측 결함을 **2/2 통과**시켰다.
 *    프롬프트가 길수록 뒤에 붙인 지시는 묻힌다. 그래서 **이 하나만 묻는 호출**을 따로 둔다.
 *
 * 🔴 이것은 **새 차단 축이 아니다.** 답은 기존 `lifeConflict` 칸으로 합쳐진다
 *    (`mergeLifeConflict`). 소재·말투·위해는 이 호출이 보지 않는다 — 큰 검수가 그대로 본다.
 */
export function buildAgeCheckSystemPrompt(ageBand: string): string {
  return [
    '너는 글 한 편을 읽고 **딱 하나만** 판정한다.',
    '',
    `글쓴이는 **${ageBand}** 여성이다.`,
    '',
    '🔴 **두 가지를 본다.**',
    '',
    `**(가) 글쓴이가 자기 나이를 직접 말하는데, 그 나이가 ${ageBand} 와 어긋나는가?**`,
    '  · "저는 40대 후반이고" · "올해 쉰 둘인데" · 문장 첫머리의 "50대 초반이라" 처럼',
    '    **자기를 가리키는** 나이 표현만 센다.',
    '  · "주변 40대가" · "30대 후배" · "50대 언니" 처럼 **남의 나이**는 세지 않는다.',
    '',
    '**(나) 글이 자기 가족을 말하면서, 그 가족의 나이가 글쓴이 나이와 모순되는가?**',
    '',
    '(나) 는 이 순서로 센다:',
    '  ① 글에 "우리 ○○" · "내 ○○" 같은 **자기 가족**이 나오는가',
    '     (언니 · 오빠 · 형 · 누나 · 동생 · 엄마 · 아빠 · 딸 · 아들 · 시부모)',
    '  ② 그 가족의 나이나 세대가 **글 안에** 적혀 있는가',
    '     (숫자 · "서른 하나" · 앞 문장을 받는 "그 나이대" · "저 나이" 도 포함한다)',
    '  ③ ①②가 모두 있으면, 글쓴이 나이와 견주어 **가능한 관계인지** 센다',
    `     · 언니 · 오빠 · 형 · 누나 → ${ageBand} 보다 **많아야** 한다`,
    `     · 엄마 · 아빠 · 시부모 → ${ageBand} 보다 **한 세대 많아야** 한다`,
    `     · 딸 · 아들 → ${ageBand} 보다 **한 세대 적어야** 한다`,
    '  ④ 불가능하면 conflict=true 이고, **글에 있는 그 문장을 그대로** evidence 에 옮긴다',
    '',
    '🔴 **①이나 ②가 없으면 (나) 는 conflict=false 다. 추측해서 세지 않는다.**',
    '',
    '🔴 **(가) 는 자기 자녀의 학령이 당신 생활사와 어긋나는 경우도 본다.**',
    '  · "우리 애 유치원" · "우리 아이 초등학교" 처럼 **자기 자녀**임이 분명할 때만이다.',
    '  · "조카" · "이웃 애" · "아는 집 딸" 은 남의 아이다 — 세지 않는다.',
    '',
    '🔴 아래는 전부 conflict=false 다:',
    '  · "요즘 서른 넘어 결혼하는 사람이 많다" — 자기 가족이 아니다',
    '  · "조카" · "후배" · "아는 집 딸" · "우리 애 또래" — 아래 세대다',
    '  · "주변 30대가" — 관찰이다',
    `  · "우리 언니가 쉰 넷" — ${ageBand} 보다 많으니 가능하다`,
    '  · 나이를 말하지 않은 가족 이야기 — 모르면 어긋난 것이 아니다',
    '',
    '🔴 **소재 · 말투 · 재미 · 갈등은 보지 않는다.** 반말도 · 연예 · 방송 · 건강 · 시댁 ·',
    '   부부 갈등 이야기도 여기서는 전부 상관없다. 나이 모순 하나만 본다.',
    '',
    'JSON 만 답한다:',
    '{"conflict":true|false,"evidence":"모순으로 읽히는 글의 문장 그대로. 없으면 빈 문자열"}',
  ].join('\n')
}

/**
 * 🔴 나이 검수 응답을 읽는다 — **근거가 글에 실제로 있어야 한다**(기존 계약 그대로).
 *    지어낸 문장으로는 막지 않는다.
 */
export function parseAgeCheck(raw: string, draftText: string): LifeConflict | null {
  let j: Record<string, unknown>
  try {
    const t = raw.trim()
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a === -1 || b === -1) return null
    j = JSON.parse(t.slice(a, b + 1)) as Record<string, unknown>
  } catch { return null }
  if (typeof j.conflict !== 'boolean') return null
  const ev = typeof j.evidence === 'string' ? j.evidence.trim() : ''
  if (!j.conflict) return { conflict: false, evidence: '' }
  // 🔴 근거가 초안에 없으면 충돌로 세지 않는다 — 지어낸 문장으로 막지 않는다
  return evidenceFoundIn(ev, draftText) ? { conflict: true, evidence: ev } : { conflict: false, evidence: '' }
}

export function buildQualitySystemPrompt(persona?: PersonaLifeHistory): string {
  return [
    '너는 40대 중반~60대 중반 여성 커뮤니티의 글 검수자다.',
    '주어진 초안이 그 게시판에 올라가도 되는 글인지 본다.',
    '',
    '🔴 **말투와 맺음은 보지 않는다.**',
    '   반말도 · 존댓말과 섞인 말투도 · 질문 없이 끝나는 글도 우리 게시판의 글이다.',
    '   다듬어지지 않았다는 이유로 막지 않는다 — 하다 만 말 · 감탄 · 줄임말 ·',
    '   고르지 않은 문장 길이는 사람 글의 표시이지 결함이 아니다.',
    '',
    '🔴 **소재로 막지 않는다.** 연예인 · 방송 · 드라마 · 건강 · 갱년기 · 병원 경험 ·',
    '   부부 · 가족 · 직장 · 이웃 갈등 · 솔직한 불만과 이견은 전부 우리 이야기다.',
    '',
    '🔴 먼저 **위해**를 본다. 아래는 소재가 아니라 **행동**이다:',
    ...DRAFT_HARM_AXES.map((h) => `- ${h}: ${HARM_PROMPT[h] ?? ''}`),
    '   🔴 원문에 없던 것을 글쓴이가 지어낸 경우도 해당한다.',
    '',
    '🔴 그다음 **품질**을 본다. 아래 중 하나라도 해당하면 통과시키지 않는다:',
    ...DRAFT_QUALITY_AXES.map((a) => `- ${a}: ${DRAFT_QUALITY_AXIS_PROMPT[a]}`),
    '',
    '🔴 **위 이름 말고 다른 이름을 만들어 내지 않는다.** 해당이 없으면 빈 배열이다.',
    '',
    ...(persona === undefined ? [] : [
      '🔴 마지막으로 **글쓴이의 삶과 어긋나는 1인칭 경험**만 본다.',
      '   글쓴이는 이런 사람이다:',
      ...lifeHistoryLines(persona).map((x) => `  ${x}`),
      '',
      '   글이 **자기 일로** 말하는 것이 위와 명백히 어긋날 때만 conflict=true 다.',
      '   예: 비혼인데 "우리 남편이" · 무자녀인데 "우리 애가" ·',
      '       갱년기 전인데 "내가 요즘 갱년기라" · 돌봄 없음인데 "내가 간병하느라".',
      /**
       * 🔴 2026-09-17 — 하는 일·사는 곳을 검수에도 준다. 다만 **가능한 생활사를
       *    모순으로 단정하지 않는다** — 은퇴한 사람이 다시 일하는 것은 흔한 일이고,
       *    옛 직장 이야기와 지금 직장 이야기는 다르다. 좁게만 센다.
       */
      '',
      '   🔴 **하는 일·사는 곳은 좁게 본다.** 지금 자기 신분을 **다르게 말할 때만** 충돌이다.',
      '      충돌 아님: 은퇴한 뒤 다시 일하거나 부업·봉사를 하는 이야기 · 예전 직장 이야기 ·',
      '                배우자나 자녀의 직장 이야기 · 남의 직장 이야기 · 여행·방문한 지역 이야기.',
      '      충돌: 은퇴라고 적혀 있는데 지금 다니는 회사가 있는 것처럼 "우리 회사 사람들이" ·',
      '            수도권인데 "여기 읍내는".',
      // 🔴 **나이·세대는 여기서 묻지 않는다** (2026-09-14). 큰 프롬프트에 절차를 덧붙였더니
      //    모델이 실측 결함을 그대로 통과시켰고(2/2), 프롬프트만 비싸졌다.
      //    나이는 `buildAgeCheckSystemPrompt` 가 **짧고 집중된 호출 하나**로 따로 본다.
      '',
      '   🔴 **소재로 판단하지 않는다.** 남편 · 자녀 · 갱년기 · 돌봄 · 결혼 · 연예 · 방송 · 병원',
      '      이야기를 하는 것 자체는 어긋남이 아니다. 남의 이야기 · 관찰 · 질문 · 공감은',
      '      전부 정상이다. 애매하면 conflict=false 다.',
      '   conflict=true 면 **글에서 그렇게 읽히는 부분을 그대로** evidence 에 옮긴다.',
      '',
    ]),
    'JSON 만 답한다:',
    '{"decision":"AUTO_ADOPT|AUTO_HOLD|AUTO_DROP","confidence":0.0~1.0,',
    ' "harms":["위 위해 이름 중 해당하는 것. 없으면 빈 배열"],',
    persona === undefined
      ? ' "issues":["위 품질 이름 중 해당하는 것. 없으면 빈 배열"]}'
      : ' "issues":["위 품질 이름 중 해당하는 것. 없으면 빈 배열"],',
    ...(persona === undefined ? []
      : [' "lifeConflict":{"conflict":true|false,"evidence":"어긋나게 읽히는 글의 문장. 없으면 빈 문자열"}}']),
  ].join('\n')
}

/**
 * 🔴 **생성된 글의 위해 축** — 이름은 판정 단계 정본(`SEMANTIC_DROP`)을 그대로 쓴다.
 *    여기 있는 것은 **모델에게 설명하는 말**뿐이고, 목록을 새로 만들지 않는다.
 */
export const HARM_PROMPT: Readonly<Record<string, string>> = {
  identifiablePrivatePerson: '공인이 아닌 사람이 특정된다 (실명 + 직장 · 주소 · 동호수 · 연락처)',
  unverifiedDefamation: '확인되지 않은 범죄 · 불륜 · 질병을 **사실로 단정**한다 ("~했대요" 를 단정으로)',
  targetedHarassmentOrThreat: '특정인을 향한 위협 · 괴롭힘 · 신상 털기 · 혐오 선동',
  dangerousMedicalInstruction: '약 · 용량 · 진단 · 치료를 **확정적으로 지시**한다 (경험담은 해당하지 않는다)',
  politicalCampaigning: '정치 · 진영 선동',
  // 🔴 2026-09-16 — deterministic 판정(`micro-seed-safety-signals`)과 **같은 이름**이다
  crisisSignal: '자해 · 자살 · 극단적 선택을 암시한다'
    + ' (명시 표현 하나 · 또는 서로 다른 간접 갈래 둘 이상. 한 갈래만으로는 해당하지 않는다)',
  medicalDecisionRequest: '치료 · 의료기기 · 약물의 **부작용 · 교체 · 중단 · 계속 사용 ·'
    + ' 안전 여부 판단**을 묻는다 (겪은 이야기와 제품명만 나오는 글은 해당하지 않는다)',
  healthEfficacyClaim: '몸 · 건강에 대한 **효능을 주장**한다'
    + ' ("~라고 한다" 는 전언형이어도 해당한다)',
}

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

/** 🔴 회차 전체의 실제 provider 요청 수 — **여기 하나로만 센다** */
let BUDGET: CallBudget = new CallBudget(Number.MAX_SAFE_INTEGER)

/**
 * 🔴 **회차 장부.** `main()` 이 열기 전에는 `null` 이고, 그동안은 요청이 나가지 않는다.
 *    "장부가 없으면 그냥 보낸다" 는 선택지를 두지 않는다 — 그 한 줄이 통제를 없앤다.
 */
let LEDGER: SupplyLlmSession | null = null

/**
 * 🔴 이 파일에서 provider 로 나가는 **유일한 문** (2026-09-17).
 *
 *    생성 · 품질 · JSON 재시도 · 축 재시도 · 나이 검수가 **전부** 여기를 지난다.
 *    하나라도 `callProvider` 를 직접 부르면 그 요청은 계산되지도 예약되지도 않는다.
 */
async function ask(stage: LedgerStage, system: string, payload: string, maxOut: number): Promise<LlmResponse> {
  if (LEDGER === null) {
    return {
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
      finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
      usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
      errorCode: 'NO_LEDGER', errorMessage: '장부가 열리지 않아 유료 요청을 보내지 않았다',
    }
  }
  return LEDGER.call({
    stage, model: DRAFT_MODEL, systemPrompt: system, userPayload: payload,
    maxOutputTokens: maxOut, timeoutMs: DRAFT_TIMEOUT_MS,
  })
}

async function callJson<T>(
  stage: LedgerStage, system: string, payload: string, parse: (raw: string) => T | null,
): Promise<CallOutcome<T>> {
  let attempt = 0
  let status = 'skipped'
  let errorCode: string | null = null
  for (; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs(attempt, Math.random()))
    // 🔴 상한을 넘으면 부르지 않는다. 조용히 넘기지 않고 사유를 남긴다
    if (!BUDGET.take()) return { value: null, status: 'budgetExhausted', attemptCount: attempt + 1, errorCode }
    countCall(attempt === 0 ? 'first' : 'transportRetry')
    const res = await ask(stage, system, payload, DRAFT_MAX_TOKENS)
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
    if (!BUDGET.take()) return { value: null, status: 'budgetExhausted', attemptCount: attempt + 1, errorCode }
    countCall('jsonRetry')
    const retry = await ask(
      'jsonRetry',
      `${system}\n\n🔴 지난 답이 JSON 이 아니었다. 설명 없이 JSON 객체 하나만 답한다.`,
      payload, DRAFT_MAX_TOKENS,
    )
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
  if (NO_CACHE) return new Map()
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as Record<string, CacheEntry>))
  } catch { return new Map() }
}
function saveCache(m: ReadonlyMap<string, CacheEntry>): void {
  if (NO_CACHE) return
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
 * 금지어나 실질 복제로 이미 막힌 초안에 모델을 부르는 것은 돈만 쓰는 일이다.
 */
async function askQuality(
  drafts: readonly DraftCandidate[],
  cache: Map<string, CacheEntry>,
  qKey: (d: DraftCandidate) => string,
  statusCount: Map<string, number>,
  onHit: (n: number) => void,
  onMiss: (n: number) => void,
  /** 🔴 이 글을 쓴 사람의 생활사 — 검수도 **같은 것**을 본다 */
  persona?: PersonaLifeHistory,
): Promise<Map<number, DraftQualityVerdict | null>> {
  const out = new Map<number, DraftQualityVerdict | null>()
  for (const d of drafts) {
    // 🔴 deterministic 에서 이미 막힌 것은 묻지 않는다
    if (S(d.title) === '' || S(d.body) === '' || S(d.safetyVerdict) !== 'pass'
      || hasBannedWord(d.title + d.body) || judgeCopy(d.originality).copied
      || echoesTitleAtEnd(d.title, d.body)) {
      continue
    }
    /**
     * 🔴 **명백한 자기 나이 모순은 캐시 조회와 provider 호출보다 **먼저** 판정한다**
     *    (2026-09-16 정정).
     *
     *    옛 판은 이 검사가 품질 호출 **뒤**에 있었고, 충돌을 잡고도 나이 호출을 또 했다.
     *    그리고 캐시 hit 경로가 이 검사보다 먼저 `continue` 해서 **옛 판정이 그대로 재사용**됐다.
     *    🔴 충돌이 확정된 초안은 여기서 끝낸다 — 품질·나이 provider 를 부르지 않는다.
     *    🔴 새 축을 만들지 않는다. 기존 `lifeConflict` 칸으로 나가 재생성·HOLD 경로를 그대로 탄다.
     */
    const selfAge = persona?.ageBand == null || persona.ageBand.trim() === ''
      ? null
      : judgeSelfAgeConflict({ ageBand: persona.ageBand, text: `${d.title}\n${d.body}` })
    if (selfAge !== null && selfAge.conflict) {
      selfAgeCaught += 1
      out.set(d.draftNo, {
        lifeConflict: { conflict: true, evidence: selfAge.evidence },
        decision: 'AUTO_HOLD', confidence: 1, issues: [], unknownIssues: [], harms: [],
      })
      /**
       * 🔴 **`statusCount` 에 넣지 않는다** (2026-09-16 정정).
       *    `statusCount` 는 **provider 응답**을 세는 칸이고, 아래 `kindOf` 가
       *    모르는 이름을 전부 `provider` 로 분류한다. 로컬 결정론 판정을 거기 넣었더니
       *    부르지도 않은 호출이 provider 응답 수로 잡혔다.
       *    이 판정은 전용 집계 `selfAgeCaught` 로만 보고한다.
       */
      continue
    }
    // 🔴 key 가 **이 글의 본문**을 담는다. 같은 draftNo 라도 글이 바뀌면 다시 묻는다
    const k = qKey(d)
    const c = cache.get(k)
    if (c !== undefined && c.status === 'ok') {
      onHit(1)
      out.set(d.draftNo, c.quality[String(d.draftNo)] ?? null)
      statusCount.set('ok', (statusCount.get('ok') ?? 0) + 1)
      continue
    }
    onMiss(1)
    const payload = JSON.stringify({ title: d.title, body: d.body })
    const ctx = { persona, draftText: `${d.title}\n${d.body}` }
    let q = await callJson('draftQuality', buildQualitySystemPrompt(persona), payload, (t) => parseQuality(t, ctx))
    statusCount.set(q.status, (statusCount.get(q.status) ?? 0) + 1)
    /**
     * 🔴 **모르는 축이 오면 한 번만 다시 묻는다** (2026-09-13).
     *    모델이 이름을 지어내는 것은 흔하다. 한 번은 형식을 다시 일러 준다.
     *    그래도 우리 축이 아니면 **명시적으로 막는다** — 조용히 통과시키지도,
     *    다른 품질 사유로 둔갑시키지도 않는다.
     */
    if (q.value !== null && q.value.unknownIssues.length > 0) {
      schemaRetry += 1
      for (const u of q.value.unknownIssues) unknownAxis.set(u, (unknownAxis.get(u) ?? 0) + 1)
      const retry = await callJson(
        'schemaRetry',
        `${buildQualitySystemPrompt(persona)}\n\n${schemaRetryDirective(q.value.unknownIssues)}`,
        payload, (t) => parseQuality(t, ctx),
      )
      statusCount.set(`schemaRetry:${retry.status}`, (statusCount.get(`schemaRetry:${retry.status}`) ?? 0) + 1)
      if (retry.value !== null) q = retry
    }
    /**
     * 🔴 **나이·가족·세대만 보는 짧은 호출 하나를 덧붙인다** (2026-09-14).
     *
     *    큰 품질 프롬프트에 절차를 넣었더니 실측 결함을 2/2 통과시켰다.
     *    그래서 **길게 만들지 않고 따로 묻는다** — 이 호출은 나이 하나만 본다.
     *    답은 새 축이 아니라 **기존 `lifeConflict` 칸**으로 합쳐진다(`mergeLifeConflict`).
     *
     * 🔴 `ageBand` 가 없으면 부르지 않는다 — 정본이 없으면 애초에 여기 오지 못한다(§ loadVoice).
     */
    if (q.value !== null && persona?.ageBand != null && persona.ageBand.trim() !== '') {
      ageCalls += 1
      /**
       * 🔴 **여기가 새던 자리다** (2026-09-17 수정).
       *    이 호출은 `callProvider` 를 직접 불러 `BUDGET.take()` 도 `countCall()` 도
       *    지나지 않았다. 회차 상한에 잡히지 않았고 관제 집계에도 없었다 —
       *    실측 506건이 통제 밖에 있었다. 이제 다른 호출과 **같은 문**을 지난다.
       */
      if (!BUDGET.take()) {
        // 🔴 회차 상한에 닿았으면 부르지 않는다. 확인하지 못한 것으로 센다
        ageUnread += 1
        countCall('ageCheckBudgetExhausted')
      } else {
        countCall('ageCheck')
        const ageRes = await ask(
          'ageCheck', buildAgeCheckSystemPrompt(persona.ageBand), payload, AGE_CHECK_MAX_TOKENS,
        )
        const age: LifeConflict | null = ageRes.ok && !ageRes.maxTokensReached
          ? parseAgeCheck(ageRes.rawText, ctx.draftText)
          : null
        if (age === null) ageUnread += 1
        const merged = mergeLifeConflict(q.value.lifeConflict, age)
        if (merged !== q.value.lifeConflict) {
          q = { ...q, value: { ...q.value, lifeConflict: merged } }
          if (merged?.conflict === true) ageCaught += 1
        }
      }
    }
    out.set(d.draftNo, q.value)
    for (const u of q.value?.unknownIssues ?? []) unknownAxis.set(u, (unknownAxis.get(u) ?? 0) + 1)
    if (q.value !== null) {
      cache.set(k, { drafts: [], quality: { [String(d.draftNo)]: q.value }, status: 'ok', attemptCount: q.attemptCount })
    }
  }
  return out
}

/**
 * 소재 메타 — 제목 · bodyHead · 판정이 남긴 한 줄
 *
 * 🔴 **세 시각을 함께 들고 온다** (2026-09-17). 생성 산출물이 이 값을 싣지 않으면
 *    적재가 다시 `sourceCapturedAt` 밖에 볼 것이 없다. 프롬프트에는 넣지 않는다 —
 *    **글을 쓰는 데 쓰는 값이 아니라 뒤에 전달할 값**이다.
 */
type Meta = {
  title: string; site: string; bodyHead: string; axis: string; lane: string; angle: string
  sourcePostedAt: string; sourceListedAt: string; sourceCapturedAt: string
}

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
          // 🔴 옛 파일에는 이 키가 없다 — 그러면 빈 문자열(모른다)이다
          sourcePostedAt: S(r.sourcePostedAt),
          sourceListedAt: S(r.sourceListedAt),
          sourceCapturedAt: S(r.sourceCapturedAt),
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

/**
 * 🔴 **한 회차 전체가 쓸 수 있는 provider 요청** — 원천 수에 이 값을 곱해 만든다.
 *
 * 🔴 **원천당 상한이 아니다** (2026-09-13 정정). 이름이 `CALL_ALLOWANCE_PER_SOURCE` 였고
 *    설명도 "원천 하나가 나가는 최대치" 라고 적혀 있었지만, 구현은 처음부터
 *    **공동 예산**이었다 — `CallBudget` 은 총량만 세고 원천별로 막지 않는다.
 *    한 원천이 다 써 버려도 막는 장치가 없었다.
 *
 *    최악 경로는 실제로 4회를 넘는다:
 *      생성 1 + 초안 검수 2(초안 2개) + 생활사 재생성 1 + 재검수 2 = **6회**
 *    (여기에 schema 재요청·transport 재시도가 더 붙을 수 있다. 전부 같은 예산에서 나간다.)
 *
 * 🔴 그래서 **이름과 출력을 공동 예산으로 정정한다.** 상한을 올리지 않았다 —
 *    평균 사용량이 계약을 지키는지는 `perSource` 관측으로 본다.
 */
export const CALL_ALLOWANCE_PER_SOURCE = 4

/**
 * 🔴 **강제 상한이 아니라 설계상 기대치다** (2026-09-13).
 *
 *    한 원천이 정상 경로를 다 밟았을 때 나가는 요청 수 —
 *      생성 1 + 초안 검수 2 + 생활사 재생성 1 + 재검수 2 = 6
 *
 *    🔴 **이 수를 넘을 수 있다.** schema 재요청과 transport 재시도가 붙으면
 *       더 나간다. 막는 것은 **공동 예산 하나뿐**이고, 원천별로 조이는 장치는 없다.
 *       이 값은 관측한 사용량(`BUDGET.perSource`)을 읽을 때 쓰는 **눈금**이다 —
 *       평소보다 훨씬 큰 수가 보이면 어딘가 새고 있다는 뜻이다.
 */
export const CALL_EXPECTED_PATH_PER_SOURCE = 6

export function callBudgetOf(sources: number): number {
  return Math.max(0, sources) * CALL_ALLOWANCE_PER_SOURCE
}

/** 🔴 요청을 종류별로 센다 — 어디서 새는지 모르면 줄일 수 없다 */
const callKind = new Map<string, number>()
let schemaRetry = 0
/** 🔴 나이 검수 호출 수 · 잡은 수 · 못 읽은 수 — 회차 로그에 그대로 찍는다 */
let ageCalls = 0
/** 🔴 결정론 자기 나이 판정이 잡은 수 — 회차 로그에 그대로 찍는다 */
let selfAgeCaught = 0
let ageCaught = 0
let ageUnread = 0
/** 🔴 생활사 충돌로 다시 쓴 원천 · 고쳐진 수 · 그래도 어긋나 사람에게 넘긴 수 */
let lifeRetried = 0
/** 🔴 위기 신호로 재생성을 멈춘 회차 — 전용 줄로 따로 보고한다 */
let crisisHeld = 0
/** 🔴 **부르기 전에** 멈춘 원천 — 위기 소재는 생성 자체를 시작하지 않는다(§4) */
let sourceCrisisHeld = 0
let lifeFixed = 0
let lifeHeld = 0
/**
 * 🔴 **생활사 해소를 확인하지 못한 초안** — 해소로 세지 않는다.
 *    예산이 없어 다시 묻지 못한 경우만이 아니다. 응답이 오지 않았거나,
 *    `lifeConflict` 가 빠졌거나, 모델이 초안에 없는 근거를 댄 경우가 전부 여기 들어간다.
 *    한 가지 원인만 적으면 로그를 읽는 사람이 다른 원인을 못 본다.
 */
let lifeUnverified = 0
export function countCall(kind: string): void {
  callKind.set(kind, (callKind.get(kind) ?? 0) + 1)
}

/** 🔴 digest — key 가 "무엇으로 만들었는가" 를 담게 한다 */
export const digest16 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

/** 🔴 모르는 품질 축을 회차 단위로 센다 — 숨기지 않고 화면에 찍는다 */
const unknownAxis = new Map<string, number>()

type VoiceRuntime = {
  describe: string
  samplesFor: (sourceArticleId: string) => readonly string[]
  provenanceFor: (sourceArticleId: string) => VoiceProvenance | null
  /** 🔴 이 원천을 쓰기로 한 Persona 의 생활사 — 생성·검수가 같은 것을 본다 */
  lifeOf: (sourceArticleId: string) => PersonaLifeHistory | undefined
  /** 🔴 **말투 근거가 하나도 없을 때만** 멈춘다. 소재를 이유로 멈추지 않는다 */
  holdReasonFor: (sourceArticleId: string) => string | null
  /**
   * 🔴 **정본을 못 읽었다 — 전 원천을 막는다** (2026-09-13).
   *    `null` 이 아니면 machine 생성을 **provider 호출 전에** 통째로 멈춘다.
   *    자산이 없으면 아무 Persona 도 못 고르고, 그러면 누구 이름으로 발행할지
   *    정할 수 없다. 말투 없이 써 두면 나중에 전량 보류될 글만 쌓인다.
   */
  blockAllCode: string | null
  load: Record<string, number>
}

/**
 * 🔴 **말투 근거를 붙이고, 누가 쓸지 생성 전에 정한다** (2026-09-13).
 *
 * 🔴 Persona 정체성의 정본은 **Pool 카드 문서**다(`parsePoolDoc` → `cardToPersona`).
 *    DB 를 읽지 않는다 — 이 러너는 파일까지다.
 *
 * 🔴 **정본을 못 읽으면 machine 생성을 provider 호출 전에 멈춘다** (2026-09-13).
 *    말투 자산 · Persona 카드 · 쓸 수 있는 사람 0명 — 셋 다 `blockAllCode` 를 세워
 *    모든 원천에 같은 원인 코드를 남긴다. 예전에는 "말투 근거 없이 씁니다" 하고
 *    그냥 진행했는데, 그렇게 만든 글은 누구 이름으로 낼지 정할 수 없어 전량 보류됐다.
 */
function loadVoice(sources: readonly { sourceArticleId: string; title: string; body: string }[]): VoiceRuntime {
  const none: VoiceRuntime = {
    describe: '', samplesFor: () => [], provenanceFor: () => null,
    lifeOf: () => undefined, holdReasonFor: () => null, blockAllCode: null, load: {},
  }
  /** 🔴 정본을 못 읽었다 — 쓰지 않는다. 조용히 품질이 낮은 글을 만들지 않는다 */
  const blocked = (code: string, why: string): VoiceRuntime => ({
    ...none, blockAllCode: code,
    describe: `  🔴 ${why} — machine 생성을 멈춥니다 (provider 호출 0)`,
    holdReasonFor: () => why,
  })
  const asset = loadCanonAsset()
  if (!asset.ok || asset.rows.length === 0) {
    return blocked('voiceAssetMissing', `말투 근거 정본을 읽지 못했다 (${asset.code})`)
  }
  const plan = planBundles({ rows: asset.rows, personaCodes: PRODUCTION_PERSONA_CODES })
  const bundleOf = new Map<string, VoiceReferenceBundle>(plan.bundles.map((b) => [b.personaCode, b]))

  // 🔴 정본 카드 — 여기서 Persona 를 만들지 않는다. 문서가 정본이다
  let cards: ReturnType<typeof cardToPersona>[] = []
  let cardNote = ''
  try {
    const doc = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
    cards = doc.cards.map(cardToPersona)
    if (doc.problems.length > 0) cardNote = ` · 🟡 카드 문제 ${doc.problems.length}건`
  } catch {
    return blocked('personaCanonMissing', `Persona 정본 카드를 읽지 못했다 (${PERSONA_POOL_DOC})`)
  }
  /**
   * 🔴 **말투 근거가 선 사람 + 나이대가 있는 사람만 후보다** (2026-09-14).
   *
   *    `ageBand` 가 없으면 생성 프롬프트도 나이 검수도 글쓴이가 몇 살인지 모른다 —
   *    그 상태로 provider 를 부르면 실측 결함(`40대 후반의 언니가 30대 초반`)이 그대로 난다.
   *    🔴 **호출 전에 멈춘다.** 모르는 채로 돈을 쓰고 글을 만들지 않는다.
   */
  const withVoice = cards.filter((p) => bundleOf.has(p.code))
  const hasAge = (p: { ageBand?: string | null }): boolean =>
    typeof p.ageBand === 'string' && p.ageBand.trim() !== ''
  const usable = withVoice.filter(hasAge)
  const noAge = withVoice.filter((p) => !hasAge(p))
  if (withVoice.length === 0) {
    return blocked('noUsablePersona', '말투 근거가 선 Persona 가 0명이다')
  }
  if (usable.length === 0) {
    return blocked('personaAgeBandMissing',
      `정본 나이대(ageBand)가 있는 Persona 가 0명이다 — provider 를 부르지 않는다`
      + ` (말투 근거는 ${withVoice.length}명이 섰다)`)
  }
  const { picks, load } = planVoicePersonas({ sources, personas: usable })
  const byId = new Map(picks.map((x) => [x.sourceArticleId, x]))
  const textsOf = (code: string): string[] => (bundleOf.get(code)?.comments ?? []).map((x) => x.text)

  const spread = loadSpread(load)
  const used = Object.entries(load).filter(([, n]) => n > 0)
  return {
    describe: `  🟢 말투 근거·나이대 모두 선 ${usable.length}명 · 이번 회차 배정 ${used.length}명`
      + (noAge.length > 0 ? `\n     🔴 나이대(ageBand) 없어 제외 ${noAge.length}명: ${noAge.map((x) => x.code).join(' · ')}` : '')
      + ` (편차 ${spread}) · 자산 ${asset.sourceDigest ?? '?'}${cardNote}`
      + (plan.blocks.length > 0 ? `\n     🟡 ${plan.blocks.slice(0, 2).join(' · ')}` : ''),
    samplesFor: (id) => {
      const c = byId.get(id)?.personaCode
      return c === undefined || c === null ? [] : textsOf(c)
    },
    provenanceFor: (id) => {
      const c = byId.get(id)?.personaCode
      if (c === undefined || c === null) return null
      const texts = textsOf(c)
      return {
        personaCode: c, comments: texts.length,
        bundleDigest: digest16(texts.join('\u0000')), sourceDigest: asset.sourceDigest,
      }
    },
    lifeOf: (id) => {
      const c = byId.get(id)?.personaCode
      if (c === undefined || c === null) return undefined
      const card = usable.find((x) => x.code === c)
      if (card === undefined) return undefined
      /**
       * 🔴 정본 카드에서 옮긴다. 복제본을 만들지 않는다.
       *
       * 🔴 **2026-09-17 — 여기가 누락 지점이었다.** `cardToPersona` 는 `workStatus` ·
       *    `region` · `economicStatus` · `noGoTopics` 를 전부 채워 놓는데 이 함수가
       *    7칸만 옮겨서 **생성 프롬프트에 닿지 못했다.** 카드에 있고 이미 읽어 둔 값이라
       *    새로 만들 것이 없다 — 옮기기만 한다.
       *
       * 🔴 `voiceCore` · `voiceLength` 는 **옮기지 않는다.** 말투 지시를 프롬프트에 박으면
       *    모든 글이 그 지시대로 균질해진다 — `NORTH-STAR.md` 가 경고한 실패 모드다.
       *    말투 근거는 지금처럼 **익명 실제 댓글**이 맡는다.
       */
      return {
        // 🔴 `ageBand` 는 정본 카드의 값 그대로다 — 여기서 지어내거나 보정하지 않는다
        code: card.code, ageBand: card.ageBand, maritalStatus: card.maritalStatus,
        childrenCount: card.childrenCount, childrenAgeBands: card.childrenAgeBands,
        parentCare: card.parentCare, menopauseStatus: card.menopauseStatus,
        workStatus: card.workStatus, region: card.region,
        economicStatus: card.economicStatus, noGoTopics: card.noGoTopics,
      }
    },
    /**
     * 🔴 **소재를 이유로 멈추지 않는다** (2026-09-13).
     *    생활사가 안 맞는다는 것은 "그 사람이 그 사연의 주인공이 아니다" 일 뿐이다.
     *    곁에서 본 이야기 · 궁금해서 묻는 글로 얼마든지 쓸 수 있다.
     *    멈추는 경우는 하나다 — **말투 근거가 선 Persona 가 아예 없을 때**.
     */
    holdReasonFor: (id) => {
      const x = byId.get(id)
      return x === undefined || x.personaCode === null ? '말투 근거가 선 Persona 가 없다' : null
    },
    // 🔴 여기까지 왔으면 정본을 다 읽은 것이다
    blockAllCode: null,
    load,
  }
}

async function main(): Promise<void> {
  await loadEnvLocal()
  if (APPLY && !CALL) fail('--apply 는 --call 과 함께 씁니다')

  const mode = !CALL ? '오프라인 계획' : APPLY ? '생성 + 파일' : '생성 (파일 write 0 · cache write 있음)'
  console.log(`\n══ ${mode} ══\n`)
  console.log(`  규칙 ${DRAFT_RULE_VERSION} · 프롬프트 ${DRAFT_PROMPT_VERSION} · provenance ${DRAFT_PROVENANCE}`)
  // 🔴 회차마다 찍는다 — 문서에만 적으면 아무도 읽지 않는다
  console.log(`  ${MACHINE_AGE_HUMAN_REVIEW_NOTE}`)
  console.log(`     실측 ${AGE_CHECK_MODEL_TRIAL.ranAt} · 합격선 ${AGE_CHECK_MODEL_TRIAL.bar} · 합격 모델 `
    + `${AGE_CHECK_QUALIFIED_MODEL ?? '없음'}`
    + ` (${AGE_CHECK_MODEL_TRIAL.results.map((r) => `${r.model} ${r.defects}/3`).join(' · ')})`)
  console.log('  🔴 사람의 ADOPT 를 사칭하지 않는다')
  console.log(`  🔴 DB 0 · 큐 0 · 발행 0 · Sheet 0${CALL ? '' : ' · LLM 0 · 네트워크 0 · 파일 write 0'}\n`)

  const seedsAll = loadAutoSeeds()
  if (seedsAll.length === 0) fail('AUTO_SEED 가 0건이다 — 먼저 micro-seed:auto-judge 를 돌린다')

  /**
   * ── 🔴 **생성 전 제외 — 유료 호출보다 먼저** (2026-09-17) ──
   *
   *    12:15 회차 실측: 266건을 유료로 만들어 183건을 채택했는데 적재는 10건이었고,
   *    빠진 이유 1위가 `SIBLING` 161건 — *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 였다.
   *    그 판정은 **원문 id 와 큐 상태만 있으면** 알 수 있다. 만든 뒤에 버릴 이유가 없다.
   *
   * 🔴 **앞당기는 것은 `SIBLING` 하나뿐이다.** `ALREADY`·`HELD` 는 후보 **제목**을 보는 판정이고
   *    생성 전에는 제목이 없다. 원문 id 로 대신하면 그 원문에서 나올 **다른 초안까지** 막는다 —
   *    그것은 다른 정책이다. 적재 단계의 검사는 **그대로 남는다.**
   *
   * 🔴 **fail-closed.** 파일이 없거나 어긋나면 만들지 않는다.
   *    입력 파일을 지우지도 처리 완료로 적지도 않으므로 **다음 정상 회차가 그대로 다시 집는다.**
   */
  let seeds = seedsAll
  let preExcluded = 0
  if (QUEUE_SNAPSHOT !== null || REQUIRE_QUEUE_SNAPSHOT) {
    if (QUEUE_SNAPSHOT === null) {
      fail('큐 스냅샷을 요구했는데 --queue-snapshot 이 없다 — 생성을 보류한다 (입력은 그대로 둔다)')
    }
    if (RUN_ID === null) {
      fail('큐 스냅샷을 쓰려면 --run-id 가 있어야 한다 — 생성을 보류한다 (입력은 그대로 둔다)')
    }
    // 🔴 파일을 못 읽는 것과 내용이 어긋난 것을 섞지 않는다 — 둘 다 보류지만 사유가 다르다
    let raw: string | null = null
    try { raw = readFileSync(QUEUE_SNAPSHOT, 'utf-8') } catch { raw = null }
    const read = readQueueSnapshot({ raw, runId: RUN_ID, now: new Date() })
    if (!read.ok) {
      fail(`큐 스냅샷을 쓸 수 없다 [${read.code}] ${read.reason}`
        + ' — 생성을 보류한다. 입력은 그대로 두고 다음 회차가 다시 집는다')
    }
    const plan = planPreDraftExclusion({
      sourceArticleIds: seedsAll.map((j) => j.sourceArticleId),
      pendingSourceIds: read.pendingSourceIds,
    })
    const keep = new Set(plan.keep)
    seeds = seedsAll.filter((j) => keep.has(j.sourceArticleId))
    preExcluded = plan.excluded.length
    console.log(`\n⓪ 생성 전 제외 ${preExcluded}건 — 같은 원문의 미발행 후보가 큐에 있다`)
    console.log(`   스냅샷 ${QUEUE_SNAPSHOT} (${Math.round(read.ageMs / 1000)}초 전 · 회차 ${RUN_ID})`)
    console.log(`   🔴 적재 단계의 중복·보류·트랜잭션 검사는 그대로 남는다 — 여기서 대신하지 않는다`)
  } else {
    // 🔴 손으로 부른 경우. 조용히 넘어가지 않는다
    console.log('\n⓪ 🟡 큐 스냅샷 없이 돈다 — **생성 전 제외를 적용하지 않았다**')
  }
  if (seeds.length === 0) {
    console.log('\n① AUTO_SEED 0건 — 전부 큐에 미발행 형제가 있다. 🟢 유료 호출 0\n')
    return
  }
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
  /**
   * 🔴 **실제 provider 요청 상한.** 회차 하나가 몇 번 나갈지는 사람이 알아야 한다 —
   *    "최대 3회" 라는 말은 재생성 횟수였지 요청 수가 아니었다.
   */
  BUDGET = new CallBudget(callBudgetOf(seeds.length))
  /**
   * 🔴 **회차 장부를 연다** (2026-09-17). 이 줄 뒤에야 유료 요청이 나갈 수 있다.
   *
   *    예산·여유 배수는 **env 에서만** 온다. 비어 있으면 모든 유료 요청이 보류되고
   *    회차는 호출 0 으로 끝난다 — 아무도 정하지 않은 금액으로 돈을 쓰지 않는다.
   */
  /**
   * 🔴 **회차 id 를 지어내지 않는다** (2026-09-17 보정). 앞판은 없으면 스스로 만들었다 —
   *    그러면 장부에서 그 회차의 사용량이 언제나 0 으로 보여 상한이 없는 것과 같아진다.
   */
  if (RUN_ID === null || RUN_ID.trim() === '') {
    fail('--run-id 가 없습니다 — 회차 요청 상한을 판정 단계와 나눠 쓸 수 없어 유료 호출을 멈춥니다')
  }
  LEDGER = new SupplyLlmSession({ runId: RUN_ID, limits: limitsFromEnv(process.env) })
  console.log(`   회차 ${RUN_ID} — 판정 단계와 요청 상한을 나눠 쓴다`)
  console.log(`   장부 ${LEDGER.dir}`)
  console.log(`   예산 ${LEDGER.limits.dailyUsd === null ? '🔴 미설정 — 유료 요청을 보류한다' : `$${LEDGER.limits.dailyUsd}/일`}`
    + ` · 여유 배수 ${LEDGER.limits.headroomMultiplier ?? '🔴 미설정'}`
    + ` · 회차 요청 상한 ${LEDGER.limits.runRequestCap ?? '없음'}`)
  /**
   * 🔴 **누가 쓸지 생성 **전**에 정한다** (2026-09-13).
   *    원문의 생활사 요구를 정본 판정으로 읽고, 쓸 수 있는 Persona 중에서 고른다.
   *    쓸 수 없는 사람의 목소리로 AI 를 부르지 않는다.
   */
  const voice = loadVoice(seeds.map((j) => {
    const m = metas.get(j.sourceArticleId)
    return {
      sourceArticleId: j.sourceArticleId,
      title: m?.title ?? '', body: m?.bodyHead ?? '',
    }
  }))
  console.log(voice.describe)
  const cache = loadCache()
  let hit = 0
  let miss = 0
  /** 🔴 겹쳐서 다시 쓴 횟수 — 화면에 찍는다. 안 보이면 늘어도 모른다 */
  let retried = 0
  /** 🔴 쓸 Persona 가 없어 **생성 전에** 멈춘 원천 수 */
  let voiceHeld = 0
  const statusCount = new Map<string, number>()

  const picks: Pick[] = []
  const adopted: { pick: Pick; draft: DraftCandidate; meta: Meta; from: string }[] = []
  const usedSources = new Set<string>()
  const seenTitles = new Set(seen.titles)
  const seenBodies = new Set(seen.bodies)

  for (const j of seeds) {
    // 🔴 지금부터 나가는 요청은 이 원천의 것으로 센다 (공동 예산 · 원천별 관측)
    BUDGET.enter(j.sourceArticleId)
    const meta = metas.get(j.sourceArticleId)
    if (meta === undefined) {
      picks.push(pickDraft({
        judgement: j, drafts: [], seenTitles, seenBodies, sourceUsed: false,
      }, nowIso))
      continue
    }
    /**
     * 🔴 **쓸 사람이 없으면 생성하지 않는다** (2026-09-13).
     *    이 소재의 생활사를 감당할 Persona 가 하나도 없으면, 만들어 봐야 발행되지 않는다.
     *    AI 를 부르기 **전에** 멈춘다 — 그것이 이번 회차에서 줄인 낭비다.
     */
    // 🔴 정본을 못 읽었으면 **원천마다 같은 원인 코드**를 남기고 전부 멈춘다
    const voiceHold = voice.blockAllCode !== null
      ? `${voice.blockAllCode}: ${voice.holdReasonFor(j.sourceArticleId) ?? ''}`
      : voice.holdReasonFor(j.sourceArticleId)
    if (voiceHold !== null) {
      voiceHeld += 1
      picks.push(pickDraft({
        judgement: j, drafts: [], seenTitles, seenBodies, sourceUsed: false,
      }, nowIso))
      continue
    }
    /**
     * 🔴 **위기 소재는 만들지 않는다** — 정본 §4 선행 차단 (2026-09-16).
     *
     *    옛 판은 위기 판정이 **생성된 초안**에만 돌았다. 그래서 위기 소재로
     *    글을 한 번 만든 뒤에야 막혔다 — 토큰도 쓰고, 그 글이 캐시에 남았다.
     *    🔴 여기는 **생성 캐시 조회보다도 앞**이다. 옛 AUTO 판정이 무엇이든,
     *       캐시에 결과가 있든, 이 검사를 건너뛰지 못한다.
     *    🔴 재생성하지 않는다 — persona 를 바꿔도 소재 자체가 대상이 아니다(§4).
     */
    const sourceGate = judgeSourceGate({ title: meta.title, bodyHead: meta.bodyHead })
    if (!sourceGate.generate) {
      sourceCrisisHeld += 1
      picks.push(pickDraft({
        judgement: j, drafts: [], seenTitles, seenBodies, sourceUsed: false,
      }, nowIso))
      continue
    }

    /** 🔴 초안이 겹쳤는지 재는 기준 원문 — 제목과 본문 머리 둘 다 본다 */
    const sourceText = `${meta.title}\n${meta.bodyHead}`

    // ── ① 템플릿 먼저 ──
    const ex = expandSeed({
      sourceArticleId: j.sourceArticleId, sourceSite: meta.site, title: meta.title,
      sourceInput: 'auto-judge', sourceDecision: 'AUTO_SEED',
    }, nowIso)
    let from: string = 'template'
    let drafts: DraftCandidate[] = (ex.drafts ?? []).slice(0, MAX_DRAFTS_PER_SOURCE).map((d) => ({
      sourceArticleId: j.sourceArticleId, draftNo: d.draftNo,
      title: d.title, body: d.body,
      safetyVerdict: String(d.safety?.verdict ?? ''),
      // 🔴 템플릿은 제목만 보고 만들지만, 실제 복제 판정은 **보내는 재료 전체**로 잰다
      originality: measureOriginality(`${d.title}\n${d.body}`, sourceText),
      generatedAt: d.generatedAt,
    }))
    // 🔴 템플릿 초안이 deterministic 게이트를 하나도 통과하지 못하면 LLM 으로 넘어간다
    const deterministicOk = drafts.some((d) =>
      S(d.title) !== '' && S(d.body) !== '' && S(d.safetyVerdict) === 'pass'
      && !hasBannedWord(d.title + d.body) && !judgeCopy(d.originality).copied
      && !echoesTitleAtEnd(d.title, d.body)
      // 🔴 원문 제목을 그대로 쓴 초안은 통과로 치지 않는다 — 소재가 아니라 제목을 옮긴 것이다
      && !copiesSourceTitle(meta.title, d.title))

    const hash = inputHashOf({ title: meta.title, bodyHead: meta.bodyHead, axis: meta.axis, lane: meta.lane })
    // 🔴 **생성 캐시와 품질 캐시를 나눈다.** 한 덩어리로 두면 품질 판정만 바꿔도
    //    생성 호출 전체를 다시 하게 된다 — 2026-09-07 에 그 구조로 24건을 다시 불렀다.
    /**
     * 🔴 **key 가 실제로 무엇으로 만들었는지를 담는다** (2026-09-13).
     *    판 값만 보던 옛 key 는 voiceSamples 를 넣고도 옛 결과를 그대로 hit 시켰다.
     *    system prompt digest 에 말투 근거가 이미 들어 있으므로 voice 가 바뀌면 자동 miss 다.
     */
    const persona = voice.lifeOf(j.sourceArticleId)
    const genSystem = buildGenSystemPrompt({
      title: meta.title, bodyHead: meta.bodyHead,
      voiceSamples: voice.samplesFor(j.sourceArticleId), persona,
    })
    const genKey = `gen|${j.sourceArticleId}|${hash}|${DRAFT_PROMPT_VERSION}`
      + `|${DRAFT_MODEL}|${digest16(genSystem)}`
    // 🔴 **본문 digest 를 담는다.** draftNo 만 보면 글이 바뀌어도 옛 판정이 재사용된다
    const qSystemDigest = digest16(buildQualitySystemPrompt(persona))
    /**
     * 🔴 **나이 판정 계약이 바뀌면 옛 캐시를 쓰지 않는다** (2026-09-16).
     *
     *    옛 key 는 품질 프롬프트 digest 만 담았다. 그래서 나이 검수 프롬프트와
     *    자기 나이 판정이 바뀌어도 **옛 판정이 그대로 hit** 됐다.
     *    운영 캐시 파일을 손으로 지우지 않는다 — key 가 계약을 담으면 저절로 miss 된다.
     */
    /**
     * 🔴 **판정 계약이 바뀌면 옛 품질 캐시를 재사용하지 않는다.**
     *    나이 검사 계약에 더해 **안전 축 taxonomy 와 그 판** 도 담는다 (2026-09-16) —
     *    위기 신호 축을 새로 세웠는데 옛 캐시가 hit 되면 새 판정이 조용히 건너뛰어진다.
     */
    const ageContractDigest = digest16(
      `${buildAgeCheckSystemPrompt(persona?.ageBand ?? '')}|${SELF_AGE_RULE_VERSION}`
      + `|${SAFETY_SIGNAL_VERSION}|${[...SEMANTIC_RISKS].join(',')}`,
    )
    const qKey = (d: DraftCandidate): string =>
      `q|${j.sourceArticleId}|${d.draftNo}|${QUALITY_PROMPT_VERSION}|${DRAFT_MODEL}`
      + `|${qSystemDigest}|${ageContractDigest}|${digest16(`${d.title}\n${d.body}`)}`

    if (!deterministicOk) {
      from = 'llm'
      /**
       * ── 생성 · 복제 재생성 — 🔴 **정본 함수 하나가 순서를 갖는다** (2026-09-16) ──
       *
       *    옛 판은 이 루프가 여기 인라인으로 있었고 위기 판정이 그 **뒤**였다.
       *    그래서 위기 초안이 복제 조건까지 만족하면 생성을 한 번 더 불렀다.
       *    🔴 이제 `generateWithRetries` 가 **복제 재생성 전에** 위기를 본다.
       *    🔴 캐시로 받은 초안에도 같은 계약이 걸린다.
       */
      const cg = cache.get(genKey)
      const cachedGen = cg !== undefined && cg.status === 'ok' ? cg.drafts : null
      if (cachedGen !== null) {
        hit += 1
        statusCount.set('ok', (statusCount.get('ok') ?? 0) + 1)
      } else miss += 1
      const payload = buildGenPayload({
        title: meta.title, bodyHead: meta.bodyHead, communityAngle: meta.angle,
        axis: meta.axis, lane: meta.lane,
      })
      let lastAttempt = 0
      const run = await generateWithRetries<GenDraft>({
        maxRetries: MAX_ORIGINALITY_RETRIES, cached: cachedGen,
      }, {
        generate: async (retryReason) => {
          if (retryReason !== null) retried += 1
          const g = await callJson(
            'draftGen',
            retryReason === null ? genSystem : genSystem + retryDirective(retryReason),
            payload, parseGen,
          )
          statusCount.set(g.status, (statusCount.get(g.status) ?? 0) + 1)
          lastAttempt = g.attemptCount
          return g.value
        },
        /**
         * 🔴 **제목 복제도 다시 쓸 이유다** (2026-09-14).
         *    본문 기준(어절·글자·덮임)은 짧은 제목에 닿지 않는다.
         */
        allCopied: (ds) => ds.every((d) => copiesSourceTitle(meta.title, d.title)
          || judgeCopy(measureOriginality(`${d.title}\n${d.body}`, sourceText)).copied),
        copyReason: (ds) => {
          const worst = ds
            .map((d) => copiesSourceTitle(meta.title, d.title)
              ? { copied: true, reason: 'runWords' as const }
              : judgeCopy(measureOriginality(`${d.title}\n${d.body}`, sourceText)))
            .filter((v) => v.copied)
          return COPY_REASON_LABEL[worst[0]?.reason ?? 'runWords']
        },
      })
      const gen = run.drafts
      if (gen !== null && !run.fromCache) {
        cache.set(genKey, { drafts: gen, quality: {}, status: 'ok', attemptCount: lastAttempt })
      }
      /** 🔴 이 원천 회차가 위기로 멈췄는가 — 한 번 서면 되돌리지 않는다 */
      let crisisStop: 'crisisSignal' | null = run.crisisStop
      if (crisisStop !== null) {
        crisisHeld += 1
        console.log(`   🔴 위기 신호로 회차를 멈췄다 — ${j.sourceArticleId} (${crisisStop} · 생성 ${run.generateCalls}회)`)
      }
      drafts = (gen ?? []).map((d, i2) => ({
        sourceArticleId: j.sourceArticleId, draftNo: i2 + 1,
        title: d.title, body: d.body,
        // 🔴 LLM 초안도 기존 safetyFilter 로 다시 잰다 — 모델 말을 믿지 않는다
        safetyVerdict: safetyFilter({ title: d.title, body: d.body }).verdict,
        originality: measureOriginality(`${d.title}\n${d.body}`, sourceText),
        generatedAt: nowIso,
      }))
      // ── 품질 (품질 캐시) — 🔴 deterministic 을 통과한 초안만 묻는다. 물어봐야 소용없는 것에 돈을 쓰지 않는다
      let qmap = crisisStop !== null
        ? new Map<number, DraftQualityVerdict | null>()
        : await askQuality(drafts, cache, qKey, statusCount, (n) => { hit += n }, (n) => { miss += n }, persona)
      /**
       * 🔴 **모델이 잡은 위기도 같은 계약이다** (2026-09-16).
       *    결정론이 놓친 것을 품질 판정이 말했으면 그때도 회차를 멈춘다.
       */
      const noteCrisis = (): void => {
        if (crisisStop !== null) return
        const why = judgeDraftGate({
          drafts, allLifeConflict: false,
          qualityHarms: [...qmap.values()].map((v) => v?.harms ?? []),
        }).reason
        if (why === null) return
        crisisStop = why
        crisisHeld += 1
        console.log(`   🔴 위기 신호로 회차를 멈췄다 — ${j.sourceArticleId} (${why} · 검수 판정)`)
      }
      noteCrisis()
      /**
       * 🔴 **생활사가 어긋나면 소재를 버리지 않고 자리를 바꿔 다시 쓴다** (2026-09-13).
       *
       *    어긋난 것은 **이번에 쓴 글**이지 소재가 아니다. 남편 이야기 · 자녀 이야기 ·
       *    돌봄 이야기는 이 커뮤니티의 알맹이다. 그 사람이 주인공이 아닐 뿐이다.
       *    그래서 같은 소재로 **관점을 바꿔** 한 번 다시 쓰게 하고,
       *    그래도 자기 일로 말하면 그때 사람에게 넘긴다.
       */
      const allConflict = (): boolean =>
        qmap.size > 0 && [...qmap.values()].every((v) => applyQuality(v) === 'lifeHistoryConflict')
      /**
       * 🔴 **위기 신호가 붙은 회차는 다시 쓰지 않는다** (정본 §4 · §8, 2026-09-16).
       *    *"crisis_hold 는 재생성하지 않는다 — persona 를 바꿔도 생성하지 않는다."*
       *    관점을 바꿔 다시 쓰게 하면 같은 위기 소재를 한 번 더 만들 뿐이다.
       */
      /**
       * 🔴 **결정론이 잡은 위기와 모델이 잡은 위기를 함께 본다** (2026-09-16).
       *    의미 판정으로만 감지된 위기도 재생성 금지에 걸려야 한다 —
       *    정규식이 놓친 것을 모델이 말했는데 다시 쓰게 하면 같은 소재를 또 만든다.
       */
      if (persona !== undefined && allConflict() && crisisStop === null) {
        lifeRetried += 1
        for (let n = 0; n < MAX_LIFE_CONFLICT_RETRIES && allConflict() && crisisStop === null; n += 1) {
          const ev = [...qmap.values()].map((v) => v?.lifeConflict?.evidence ?? '').filter((x) => x !== '')
          const g2 = await callJson('draftGen', genSystem + lifeConflictDirective(persona, ev), buildGenPayload({
            title: meta.title, bodyHead: meta.bodyHead, communityAngle: meta.angle,
            axis: meta.axis, lane: meta.lane,
          }), parseGen)
          statusCount.set(`lifeRetry:${g2.status}`, (statusCount.get(`lifeRetry:${g2.status}`) ?? 0) + 1)
          if (g2.value === null) break
          drafts = g2.value.map((d, i2) => ({
            sourceArticleId: j.sourceArticleId, draftNo: i2 + 1,
            title: d.title, body: d.body,
            safetyVerdict: safetyFilter({ title: d.title, body: d.body }).verdict,
            originality: measureOriginality(`${d.title}\n${d.body}`, sourceText),
            generatedAt: nowIso,
          }))
          qmap = await askQuality(drafts, cache, qKey, statusCount, (n) => { hit += n }, (n) => { miss += n }, persona)
          // 🔴 **다시 쓴 결과에도 같은 계약을 건다** — 새 글이 위기면 거기서 멈춘다
          noteCrisis()
        }
        /**
         * 🔴 **집계 정본은 `judgeLifeRetry` 하나다** (2026-09-13).
         *    여기서 조건을 다시 적으면 fixture 와 러너가 다른 답을 내게 된다.
         *
         * 🔴 이것은 **생활사 축만** 세는 숫자다. 위해·품질로 막히는 글은 따로 있고,
         *    최종 HOLD 통계와 섞지 않는다 — 생활사가 풀린 글이 위해로 막힐 수 있다.
         *    채택 판정은 `applyQuality` 가 지금처럼 위해 우선 fail-closed 로 한다.
         */
        const outcome = judgeLifeRetry([...qmap.values()])
        if (outcome === 'fixed') lifeFixed += 1
        else if (outcome === 'held') lifeHeld += 1
        else lifeUnverified += 1
      }
      // 🔴 위기로 멈춘 회차는 **정상 초안이 함께 있어도** 채택하지 않는다
      const p = pickDraftGated({
        judgement: j, drafts, seenTitles, seenBodies,
        sourceUsed: usedSources.has(j.sourceArticleId), quality: qmap, crisisStop,
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
    const qmap2 = await askQuality(drafts, cache, qKey, statusCount, (n) => { hit += n }, (n) => { miss += n }, voice.lifeOf(j.sourceArticleId))
    /**
     * 🔴 **템플릿 초안에도 같은 계약을 건다** (2026-09-16).
     *    템플릿은 제목을 확장해 만들지만, 원천이 위기이면 그 확장도 위기다.
     */
    const tmplCrisis = judgeDraftGate({
      drafts, allLifeConflict: false,
      qualityHarms: [...qmap2.values()].map((v) => v?.harms ?? []),
    }).reason
    if (tmplCrisis !== null) {
      crisisHeld += 1
      console.log(`   🔴 위기 신호로 회차를 멈췄다 — ${j.sourceArticleId} (${tmplCrisis} · 템플릿)`)
    }
    const p = pickDraftGated({
      judgement: j, drafts, seenTitles, seenBodies,
      sourceUsed: usedSources.has(j.sourceArticleId), quality: qmap2, crisisStop: tmplCrisis,
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
  console.log(`\n② 호출  cache hit ${hit} · miss ${miss} · 겹쳐서 다시 쓴 것 ${retried}회`)
  console.log(`   🔴 실제 provider 요청 ${BUDGET.spent}회`
    + ` (공동 예산 ${callBudgetOf(seeds.length)}회 = ${CALL_ALLOWANCE_PER_SOURCE}×${seeds.length} · 남은 ${BUDGET.left})`)
  // 🔴 공동 예산이라 한 원천이 몰아 쓸 수 있다 — 실제로 그랬는지 본다
  {
    const per = [...BUDGET.perSource.entries()].sort((a, b) => b[1] - a[1])
    const avg = per.length === 0 ? 0 : BUDGET.spent / per.length
    console.log(`   원천별 사용: 최다 ${BUDGET.worstPerSource}회`
      + ` (정상 경로 기대치 ${CALL_EXPECTED_PATH_PER_SOURCE}회 · 강제 상한 아님) · 평균 ${avg.toFixed(1)}회`
      + `${per.length > 0 ? ` · ${per.slice(0, 3).map(([k, n]) => `${k}×${n}`).join(' ')}` : ''}`)
  }
  console.log(`      종류별 ${[...callKind.entries()].map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}`
    + ` · schema 재요청 ${schemaRetry}회`)
  /**
   * 🔴 **장부를 화면에 찍는다** (2026-09-17). 안 보이면 늘어도 모른다.
   *    위의 `BUDGET.spent` 는 **요청 수**이고, 아래는 **금액**이다. 둘은 다른 것을 센다 —
   *    같은 줄에 합치면 어느 쪽이 막았는지 읽는 사람이 구분하지 못한다.
   */
  if (LEDGER !== null) console.log(`   ${LEDGER.describe().split('\n').join('\n   ')}`)
  /**
   * 🔴 **나이 판정을 결정론과 모델로 나눠 센다** (2026-09-16).
   *    합쳐 세면 "모델이 잡았다" 와 "부르기 전에 잡았다" 가 구분되지 않는다.
   */
  console.log(`   🔴 위기 소재로 **부르기 전에** 멈춘 원천 ${sourceCrisisHeld}건 — AI 를 부르지 않았다 (정본 §4)`)
  console.log(`      위기 신호로 재생성을 멈춘 회차 ${crisisHeld}건 — 사람이 본다`)
  console.log(`      나이 자기모순(결정론) ${selfAgeCaught}건`
    + ` · 나이 검수 호출 ${ageCalls}회 (잡음 ${ageCaught} · 못 읽음 ${ageUnread})`)
  // 🔴 소재 차단 · 생활사 재생성 · 최종 HOLD 를 **따로** 센다 — 섞으면 어디가 막혔는지 모른다
  console.log(`   🔴 소재를 이유로 막은 원천 0건 (설계상 없음)`
    + ` · 생활사 충돌 재생성 ${lifeRetried}건`
    + ` (생활사 해소 ${lifeFixed} · 생활사 충돌 유지 ${lifeHeld} · 해소 미확인 ${lifeUnverified})`)
  // 🔴 provider 오류 · schema 오류 · 품질 HOLD 를 **나눠 센다.** 합치면 원인을 못 찾는다
  const kindOf = (st: string): string =>
    st === 'ok' ? 'ok'
      : st.startsWith('schemaRetry') ? 'schema'
        : st === 'parseError' ? 'schema'
          : st === 'budgetExhausted' ? 'budget' : 'provider'
  const grouped = new Map<string, number>()
  for (const [st, n] of statusCount) grouped.set(kindOf(st), (grouped.get(kindOf(st)) ?? 0) + n)
  console.log(`      응답 ${[...grouped.entries()].map(([k, n]) => `${k} ${n}`).join(' · ')}`)
  if (voiceHeld > 0) {
    console.log(`   🟡 쓸 Persona 가 없어 생성 전에 멈춘 원천 ${voiceHeld}건 — AI 를 부르지 않았다`)
  }
  {
    const used = Object.entries(voice.load).filter(([, n]) => n > 0).sort()
    if (used.length > 0) {
      console.log(`   🟢 말투 배정 ${used.map(([k, n]) => `${k}×${n}`).join(' · ')}`)
    }
  }
  if (unknownAxis.size > 0) {
    console.log(`   🟡 우리 축이 아닌 이름 ${[...unknownAxis.entries()].map(([k, n]) => `"${k}"×${n}`).join(' · ')}`)
    console.log('      — 다시 물었고, 그래도 같으면 qualitySchemaMismatch 로 막았다')
  }
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
      /**
       * 🔴 **대조 결과만 싣는다** (2026-09-14).
       *    원문 제목은 바로 위 `a.meta.title` 에 **메모리로만** 있다 —
       *    전문도 해시도 파일·DB 어디에도 남기지 않는다(§4-AF ⑤).
       *    🔴 `copied` 는 **제목을 다시 쓴 뒤에도 같았다**는 뜻이다.
       */
      sourceTitleChecked: true,
      sourceTitleCopied: copiesSourceTitle(a.meta.title, a.draft.title),
      sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
      sourceInput: 'auto-judge',
      sourceDecision: 'AUTO_ADOPT',
      draftFrom: a.from,
      title: a.draft.title, body: a.draft.body,
      safetyVerdict: a.draft.safetyVerdict,
      // 🔴 **잰 값을 싣는다. 판정이 아니다.** 적재 쪽이 같은 정본으로 다시 판정한다
      originality: a.draft.originality,
      // 🔴 **어떤 말투 근거로 썼는지.** 텍스트도 작성자도 남기지 않는다 — 근거의 신원뿐이다
      voiceProvenance: voice.provenanceFor(a.pick.sourceArticleId),
      leakedTokens: '', reviewedAt: nowIso, writtenAt: a.draft.generatedAt,
      /**
       * 🔴 **원문 쪽 세 시각** (2026-09-17) — 적재가 신선도를 제대로 재려면 여기를 지나야 한다.
       *
       *    🔴 `sourcePostedAt` 은 **원문이 올라온 시각**이다. 사건·방송·발언 시각이 아니다.
       *    🔴 `writtenAt`(= 우리가 초안을 쓴 시각)과 섞지 않는다. 재생성해도 원문 시각은 안 바뀐다.
       *    🔴 모르면 빈 문자열이다 — 지금 시각으로 채우지 않는다.
       */
      sourcePostedAt: a.meta.sourcePostedAt,
      sourceListedAt: a.meta.sourceListedAt,
      sourceCapturedAt: a.meta.sourceCapturedAt,
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

// 🔴 겹침을 재는 함수는 여기 두지 않는다 — `src/lib/draft-originality.ts` 하나다.

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
