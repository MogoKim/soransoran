#!/usr/bin/env tsx
/**
 * AUTO_SEED → 초안 → 채택 → publish candidate — 🔴 **파일까지만** (§4-AS)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AS
 *
 * 판정(§4-AR)이 `AUTO_SEED` 로 남긴 소재에서 초안을 만들고, 하나를 골라
 * `supply-autofill` 이 먹을 수 있는 후보 파일까지 낸다.
 *
 * 🔴 **생성 경로는 Content Core v2 하나다** (2026-09-20 운영 전환).
 *      마스킹된 원문 근거
 *        → ① 화자 계획 (gemini-3.7-flash · 원문과 실제 카드를 함께 보고 고른다)
 *        → ② 초안 **한 편** (gemini-3.7-flash · 원문을 직접 읽는다)
 *        → ③ 통합 의미 검수 (claude-haiku-4.5 · 원문과 초안을 직접 견준다)
 *    🔴 고정 질문 템플릿 · 복수 초안 · 별도 나이 검수 · 옛 품질 검수는 **여기서 없앴다.**
 *       다섯 번의 유료 실측에서 그 경로의 사람 READY 는 최대 1/3 이었다.
 *    🔴 화자 자격은 **코드가 근거를 대조해** 허가한다. 못 대면 만들지 않는다.
 *    🔴 유료 요청은 전부 `ask()` 한 곳을 지나 장부에 남는다 — provider 직접 호출 0.
 *
 * 🔴 **사람의 ADOPT 를 사칭하지 않는다.** 결정은 `AUTO_ADOPT` · `AUTO_HOLD` · `AUTO_DROP`,
 *    provenance 는 `machine-generated` 다. 후보 파일에도 그 표시가 그대로 남는다 —
 *    `supply-autofill` 이 `sourceDecision` 으로 사람 판정을 요구하므로,
 *    **이 파일에서 나온 후보는 지금 큐로 갈 수 없다.** 그게 맞다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · 큐 적재 · 발행 · Sheet · Raw Vault. 사람 승인은 그대로 남는다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-auto-draft.mts            # 계획만 · 파일 write 0
 *   npx tsx scripts/micro-seed-auto-draft.mts --apply    # 초안 · 후보 파일 생성
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// 🔴 기존 템플릿 생성기를 그대로 쓴다. 새 생성 로직을 만들지 않는다
import {
  pickDraft, pickV2, summarizeDrafts, violatesDraftProvenance, normalize,
  hasBannedWord, judgeSourceGate, judgeDraftGate,
  DRAFT_REASON_LABEL, DRAFT_RULE_VERSION, DRAFT_PROVENANCE, BANNED_WORDS,
} from '../src/lib/micro-seed-auto-draft'
import { judgeSelfAgeConflict, SELF_AGE_RULE_VERSION } from '../src/lib/persona-self-age'
/**
 * 🔴 **생성 전 큐 스냅샷** (2026-09-17). 이 스크립트는 여전히 **DB 를 읽지 않는다** —
 *    러너가 읽어 파일로 건넨 것을 검증해서 쓴다. 판정 규칙은 여기서 만들지 않는다.
 */
import { readQueueSnapshot, planPreDraftExclusion } from '../src/lib/supply-queue-snapshot'
import {
  MACHINE_AGE_HUMAN_REVIEW_NOTE, AGE_CHECK_MODEL_TRIAL, AGE_CHECK_QUALIFIED_MODEL,
  type DraftCandidate, type Judgement, type Pick,
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
import { createHash, randomUUID } from 'node:crypto'
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
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'

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
import {
  SupplyLlmSession, limitsFromEnv, LEDGER_BLOCKED, type SupplyCallResult,
} from './lib/supply-llm-call.mjs'
/**
 * 🔴 **Content Core v2 — 이 러너의 유일한 생성 경로** (2026-09-20 운영 전환).
 *    계획(Gemini) → 초안 한 편(Gemini) → 통합 검수(Haiku). 병렬 경로를 두지 않는다.
 */
import {
  runContentCore, personaInputOf, STAGE_MODEL, type Ask, type PersonaInput,
} from './lib/content-core-run.mjs'
import { buildSpeakerPlanSystemPrompt } from './lib/content-core-prompts.mjs'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION,
  SPEAKER_PLAN_PROMPT_VERSION, V2_DRAFT_PROMPT_VERSION, V2_REVIEW_PROMPT_VERSION,
  STAGE_MAX_OUTPUT_TOKENS, STAGE_MAX_OUTPUT_LABEL,
} from '../src/lib/content-core/pipeline'
import { SPEAKER_PLAN_VERSION } from '../src/lib/content-core/speaker'
import { REVIEW_VERSION } from '../src/lib/content-core/review'
import { VOICE_SAMPLE_MAX } from '../src/lib/content-core/voice-evidence'
import {
  ARTIFACT_VERSION, violatesArtifact, type CallMeta, type HumanReviewArtifact,
} from '../src/lib/content-core/artifact'
import { type LedgerStage } from '../src/lib/llm-ledger'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { judgeCrisisSignal, SAFETY_SIGNAL_VERSION } from '../src/lib/micro-seed-safety-signals'
import { SEMANTIC_RISKS, DRAFT_HARM_AXES } from '../src/lib/micro-seed-auto-judge'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { maskSensitive } from './lib/micro-seed-raw-originality.mjs'
import { inputHashOf, SEMANTIC_DROP } from '../src/lib/micro-seed-auto-judge'

export const DATA_DIR = '.microseed-data'
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
/**
 * 🔴 **단계 공통 상한은 없앴다** (2026-09-20). 정본은
 *    `src/lib/content-core/pipeline.ts` 의 `STAGE_MAX_OUTPUT_TOKENS` 하나다 —
 *    세 단계가 1200 을 같이 쓰다가 thinking 이 본문 자리를 먹어 초안이 사라졌다.
 */

/**
 * 🔴 **원천 하나가 쓸 수 있는 v2 요청 수.** 정상 경로는 3회다 —
 *    계획 · 생성 · 검수. 넘기면 그 원천은 완주 실패로 남고 채택되지 않는다.
 */
export const V2_CALL_CAP = 3

/** 🔴 v2 단계 → 장부 단계 이름. 장부 어휘(`LEDGER_STAGES`)는 정본이라 바꾸지 않는다 */
export const V2_LEDGER_STAGE: Readonly<Record<CallMeta['stage'], LedgerStage>> = Object.freeze({
  speakerPlan: 'judge',
  draftGen: 'draftGen',
  semanticReview: 'draftQuality',
})
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
 *    이제 **Content Core v2 계획 호출**이 원문과 실제 카드를 함께 보고 고른다.
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




/** 🔴 말투 참고 — **내용을 가져오지 않는다.** 섹션 문구는 Original Post 레인 정본과 같은 뜻이다 */


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
 * 🔴 **provider 요청을 코드가 센다** (2026-09-13).
 *
 *    원천 하나가 여러 단계를 거치므로 실제 요청이 여러 번 나갈 수 있다.
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
 * 🔴 **소재 비교 근거** — 검수가 "무엇을 읽고 썼는가" 를 알기 위한 **최소** 자료.
 *
 * 🔴 **원문 전문도 본문 머리도 담지 않는다.** 제목 한 줄과 판정이 남긴 한 줄뿐이다.
 *    비교에 필요한 것은 "무슨 얘기였나" 이지 원문 자체가 아니다.
 *
 * 🔴 **모르면 빈 문자열이다.** 판정이 소재 설명을 남기지 않았으면 그대로 비워 둔다 —
 *    옛 값으로 메우면 지금 판정과 다른 것을 기준으로 검수하게 된다.
 */
export type SourceGround = {
  /** 원문 제목 */
  sourceTitle: string
  /** 판정이 남긴 한 줄 (`communityAngle`). 모르면 `''` */
  sourceAngle: string
}

/** 🔴 근거가 하나도 없으면 없는 것으로 친다 — 빈 칸을 보내 "모른다" 를 숨기지 않는다 */





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
/**
 * 🔴 **장부를 부르는 자리는 이 함수 하나다.** provider 를 직접 부르지 않는다.
 *    모델은 부르는 쪽이 준다 — v2 는 단계마다 다른 모델을 쓴다.
 */
async function ask(
  stage: LedgerStage, system: string, payload: string, maxOut: number,
  model: ProviderModel = DRAFT_MODEL,
): Promise<SupplyCallResult> {
  if (LEDGER === null) {
    return {
      settledUsd: null, settlementRecorded: false,
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0,
      finishReason: '', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
      usageKnown: false, cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [],
      errorCode: 'NO_LEDGER', errorMessage: '장부가 열리지 않아 유료 요청을 보내지 않았다',
    }
  }
  return LEDGER.call({
    stage, model, systemPrompt: system, userPayload: payload,
    maxOutputTokens: maxOut, timeoutMs: DRAFT_TIMEOUT_MS,
  })
}

/**
 * 🔴 **Content Core v2 가 쓰는 요청 하나** — 반드시 기존 장부 wrapper 를 지난다.
 *    provider 를 직접 부르지 않는다. 회차 요청 상한(`BUDGET`)도 여기서 센다.
 *    🔴 모델은 `runContentCore` 가 `STAGE_MODEL` 로 정해 넘겨준다 — 여기서 고르지 않는다.
 */
const v2Ask: Ask = async (stage, system, payload, model) => {
  const blockedRes = {
    ok: false, rawText: '', truncated: false, usageKnown: false,
    inputTokens: null, outputTokens: null, thoughtsTokens: null, usd: null, blocked: true,
  }
  if (!BUDGET.take()) return blockedRes
  countCall(stage)
  // 🔴 같은 장부 wrapper 를 지난다 — 여기서 provider 를 직접 부르지 않는다
  // 🔴 **그 단계의 상한**을 쓴다 — 장부 예약도 provider 요청도 이 값으로 나간다
  const r = await ask(V2_LEDGER_STAGE[stage], system, payload, STAGE_MAX_OUTPUT_TOKENS[stage], model)
  const code = String(r.errorCode ?? '')
  return {
    /**
     * 🔴 **정산 줄을 못 적었으면 완주가 아니다** (2026-09-20).
     *    provider 가 성공해도 장부에 안 적혔으면 금액을 모르는 글이다 —
     *    그런 글이 후보·캐시·AUTO_ADOPT 로 가지 않게 여기서 막는다.
     */
    ok: r.ok && r.settlementRecorded,
    rawText: r.rawText, truncated: r.maxTokensReached,
    usageKnown: r.usageKnown && r.settlementRecorded,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, thoughtsTokens: r.reasoningTokens,
    /**
     * 🔴 **영속 장부가 정산한 금액을 그대로 싣는다** (2026-09-20).
     *    여기서 두 번째로 계산하지 않는다 — 같은 값을 두 곳에서 계산하면 어긋난다.
     *    정산하지 못한 건은 `null` 이다. 0원이 아니다.
     */
    usd: r.settledUsd,
    blocked: code === 'NO_LEDGER' || code.startsWith(`${LEDGER_BLOCKED}:`),
  }
}

type GenDraft = { title: string; body: string; intendedQuestion: string; sourceAngle: string }


/** 🔴 캐시 — 원문·제목·본문 머리를 담지 않는다. 해시와 결과만 */
const CACHE_PATH = join(DATA_DIR, 'auto-draft-cache.json')
/**
 * 🔴 **v2 로 바뀌면서 캐시 값도 바뀌었다** (2026-09-20). 옛 항목은 key 가 달라
 *    hit 되지 않는다 — 파일을 지우지 않아도 저절로 miss 된다.
 */
type CacheEntry = { artifact?: HumanReviewArtifact; status: string; attemptCount: number }
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
  /**
   * 판정이 남긴 `communityAngle` 을 붙인다 — 🔴 **러너가 실제로 고른 그 판정에서.**
   *
   * 🔴 **두 가지를 고쳤다** (2026-09-17). 이 값이 검수의 비교 근거가 되면서
   *    "어느 판정에서 왔는가" 가 판정 결과만큼 중요해졌다.
   *
   *    ① 앞판은 `--input` 을 무시하고 **언제나 모든 shadow 파일**을 읽었다.
   *       `loadAutoSeeds` 는 `shadowOverride()` 를 쓰는데 여기만 안 썼다 —
   *       제한 입력으로 돌리면 **다른 파일의 소재 설명**이 붙을 수 있었다.
   *
   *    ② 앞판은 `!== ''` 로 **빈 값을 건너뛰었다.** 그래서 마지막 판정의 설명이
   *       비어 있으면 **과거의 비어 있지 않은 값이 그대로 남았다** —
   *       지금 판정이 "모른다" 인데 옛 설명으로 검수를 시키게 된다.
   *       모르는 것은 모르는 채로 둔다.
   *
   * 🔴 `loadAutoSeeds` 와 **같은 파일 목록 · 같은 순서 · 마지막이 이긴다**.
   */
  for (const f of shadowOverride() ?? filesEnding('.shadow.jsonl')) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      const m = out.get(id)
      // 🔴 빈 값도 덮는다 — 마지막 판정이 모른다고 하면 모르는 것이다
      if (m !== undefined) m.angle = S(r.communityAngle)
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

export function callBudgetOf(sources: number): number {
  return Math.max(0, sources) * CALL_ALLOWANCE_PER_SOURCE
}

/**
 * 🔴 **단계별 요청 수** — 혼합 모델이라 `단계:모델` 로 센다.
 *    합쳐 세면 어느 모델이 몇 번 갔는지 알 수 없다.
 */
const callKind = new Map<string, number>()
/** 🔴 결정론 자기 나이 판정이 잡은 수 — 회차 로그에 그대로 찍는다 */
let selfAgeCaught = 0
/** 🔴 위기 신호로 멈춘 회차 — 전용 줄로 따로 보고한다 */
let crisisHeld = 0
/** 🔴 **부르기 전에** 멈춘 원천 — 위기 소재는 생성 자체를 시작하지 않는다(§4) */
let sourceCrisisHeld = 0
export function countCall(kind: string): void {
  callKind.set(kind, (callKind.get(kind) ?? 0) + 1)
}

/** 🔴 digest — key 가 "무엇으로 만들었는가" 를 담게 한다 */
export const digest16 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

/**
 * 🔴 **화자를 여기서 미리 배정하지 않는다** (2026-09-20, Content Core v2 전환).
 *
 *    앞판은 원천마다 Persona 를 **먼저 찍어** 주는 계획 함수가 따로 있었다.
 *    고른 쪽이 원문을 본 적이 없어서 알바 원문에 전업 Persona 가 배정됐다(2026-09-19 실측).
 *    이제 v2 계획 호출이 **원문과 후보 카드를 함께** 보고 고르고, 코드가 근거를 검증한다.
 *    🔴 여기가 하는 일은 **후보 풀을 정본에서 읽어 오는 것**뿐이다.
 */
type VoiceRuntime = {
  describe: string
  /** 🔴 v2 계획 호출이 이 중에서 고른다 — 정본 카드 + 말투 묶음 */
  candidates: readonly PersonaInput[]
  /** 말투 자산 판 — artifact provenance 에 남는다 */
  sourceDigest: string
  /** 🔴 정본을 못 읽었다 — provider 호출 전에 전 원천을 막는다 */
  blockAllCode: string | null
  blockReason: string | null
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
    describe: '', candidates: [], sourceDigest: '', blockAllCode: null, blockReason: null,
  }
  /** 🔴 정본을 못 읽었다 — 쓰지 않는다. 조용히 품질이 낮은 글을 만들지 않는다 */
  const blocked = (code: string, why: string): VoiceRuntime => ({
    ...none, blockAllCode: code, blockReason: why,
    describe: `  🔴 ${why} — machine 생성을 멈춥니다 (provider 호출 0)`,
  })
  const asset = loadCanonAsset()
  if (!asset.ok || asset.rows.length === 0) {
    return blocked('voiceAssetMissing', `말투 근거 정본을 읽지 못했다 (${asset.code})`)
  }
  const plan = planBundles({ rows: asset.rows, personaCodes: PRODUCTION_PERSONA_CODES })
  const bundleOf = new Map<string, VoiceReferenceBundle>(plan.bundles.map((b) => [b.personaCode, b]))

  // 🔴 정본 카드 — 여기서 Persona 를 만들지 않는다. 문서가 정본이다
  let cards: PoolCard[] = []
  let cardNote = ''
  try {
    const doc = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
    cards = doc.cards
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
  const textsOf = (code: string): string[] => (bundleOf.get(code)?.comments ?? []).map((x) => x.text)
  /**
   * 🔴 **정본 변환 하나만 쓴다** (`personaInputOf`). 칸을 손으로 재조립하면
   *    2026-09-19 처럼 말투 기준이 빈 채로 유료 요청이 나간다.
   */
  const candidates = usable.map((c) => personaInputOf(c, {
    samples: textsOf(c.code).slice(0, VOICE_SAMPLE_MAX),
    bundleDigest: digest16(textsOf(c.code).join('\u0000')),
  }))
  return {
    describe: `  🟢 말투 근거·나이대 모두 선 ${usable.length}명 — v2 계획 호출이 이 중에서 고른다`
      + (noAge.length > 0 ? `\n     🔴 나이대(ageBand) 없어 제외 ${noAge.length}명: ${noAge.map((x) => x.code).join(' · ')}` : '')
      + ` · 자산 ${asset.sourceDigest ?? '?'}${cardNote}`
      + (plan.blocks.length > 0 ? `\n     🟡 ${plan.blocks.slice(0, 2).join(' · ')}` : ''),
    candidates,
    sourceDigest: asset.sourceDigest ?? '',
    blockAllCode: null,
    blockReason: null,
  }
}

async function main(): Promise<void> {
  await loadEnvLocal()
  if (APPLY && !CALL) fail('--apply 는 --call 과 함께 씁니다')

  const mode = !CALL ? '오프라인 계획' : APPLY ? '생성 + 파일' : '생성 (파일 write 0 · cache write 있음)'
  console.log(`\n══ ${mode} ══\n`)
  console.log(`  규칙 ${DRAFT_RULE_VERSION} · provenance ${DRAFT_PROVENANCE}`)
  console.log(`  🔴 생성 경로 Content Core v2 — `
    + Object.entries(STAGE_MODEL).map(([k, v]) => `${k}:${v}`).join(' · '))
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
    console.log(`\n② 오프라인 계획 — 생성 대상 ${seeds.length}건`)
    console.log('   🟡 LLM 0 · 네트워크 0 · 파일 write 0. 실행하려면 --call 을 붙이세요.\n')
    return
  }

  /**
   * 🔴 **세 단계가 쓰는 모델의 키를 전부 확인한다** (2026-09-20).
   *    한 모델만 보면 중간 단계에서 `NO_API_KEY` 로 멈추는데, 그때는 앞 단계 요청이
   *    이미 유료로 나간 뒤다.
   */
  for (const m of [...new Set(Object.values(STAGE_MODEL))]) {
    const k = keyStatus(m)
    if (!k.present) fail(`${k.envName} 가 없습니다 (${m})`)
  }
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
  /** 🔴 쓸 Persona 가 없어 **생성 전에** 멈춘 원천 수 */
  let voiceHeld = 0
  const statusCount = new Map<string, number>()

  const picks: Pick[] = []
  const adopted: { pick: Pick; draft: DraftCandidate; meta: Meta; art: HumanReviewArtifact }[] = []
  /** 🔴 사람이 근거를 보고 판단하는 한 장 */
  const artifacts: HumanReviewArtifact[] = []
  /** 🔴 v2 가 초안을 만들지 않고 멈춘 원천 수 (자격 없음 · 근거 부족 · 미완주) */
  let v2Held = 0
  const usedSources = new Set<string>()
  const seenTitles = new Set(seen.titles)
  const seenBodies = new Set(seen.bodies)

  /**
   * ── 🔴 **Content Core v2 — 원천 하나에 초안 한 편** (2026-09-20 운영 전환) ──
   *
   *    앞판은 이 자리에서 고정 질문 템플릿을 펴 보고, 안 되면 LLM 으로 **두 편**을
   *    만들고, 품질·나이·생활사를 **따로** 물어보고, 복제·생활사로 다시 쓰게 했다.
   *    다섯 번의 유료 실측에서 그 경로의 사람 READY 는 최대 1/3 이었다.
   *
   *    🔴 이제 한 경로다: 계획(Gemini) → 초안 한 편(Gemini) → 통합 검수(Haiku).
   *       화자 자격은 코드가 근거를 대조해 허가하고, 못 대면 만들지 않는다.
   */
  const v2Load: Record<string, number> = {}
  for (const j of seeds) {
    // 🔴 지금부터 나가는 요청은 이 원천의 것으로 센다 (공동 예산 · 원천별 관측)
    BUDGET.enter(j.sourceArticleId)
    const meta = metas.get(j.sourceArticleId)
    const holdPick = (): void => {
      picks.push(pickDraft({
        judgement: j, drafts: [], seenTitles, seenBodies, sourceUsed: false,
      }, nowIso))
    }
    if (meta === undefined) { holdPick(); continue }
    /** 🔴 정본을 못 읽었으면 전 원천을 멈춘다 — provider 호출 0 */
    if (voice.blockAllCode !== null) { voiceHeld += 1; holdPick(); continue }
    /**
     * 🔴 **위기 소재는 만들지 않는다** — 정본 §4 선행 차단 (2026-09-16).
     *    유료 호출보다 앞이다. v2 로 바뀌어도 이 순서는 그대로다.
     */
    if (!judgeSourceGate({ title: meta.title, bodyHead: meta.bodyHead }).generate) {
      sourceCrisisHeld += 1
      holdPick()
      continue
    }

    /**
     * 🔴 **생성 캐시 key 가 실제 계약을 담는다** (2026-09-20).
     *    옛 Haiku 생성 결과와 옛 검수 결과를 v2 가 재사용하면 안 된다 —
     *    stage-model · 프롬프트 판 · 원문 근거 · 후보 풀 · 말투 자산이 전부 들어간다.
     *    🔴 캐시 **파일**은 지우지 않는다. key 가 계약을 담으면 저절로 miss 된다.
     */
    const v2Key = `v2|${j.sourceArticleId}`
      + `|${inputHashOf({ title: meta.title, bodyHead: meta.bodyHead, axis: meta.axis, lane: meta.lane })}`
      + `|${SPEAKER_PLAN_PROMPT_VERSION}|${V2_DRAFT_PROMPT_VERSION}|${V2_REVIEW_PROMPT_VERSION}`
      + `|${STAGE_MODEL.speakerPlan}|${STAGE_MODEL.draftGen}|${STAGE_MODEL.semanticReview}`
      // 🔴 1200 으로 잘린 결과를 2000 짜리 계약이 재사용하지 않게 한다
      + `|${STAGE_MAX_OUTPUT_LABEL}`
      + `|${ARTIFACT_VERSION}|${REVIEW_VERSION}|${SPEAKER_PLAN_VERSION}`
      + `|${digest16(buildSpeakerPlanSystemPrompt())}`
      + `|${digest16(voice.candidates.map((c) => `${c.code}:${c.voiceTokens.join('/')}:${c.bundleDigest}`).join('|'))}`
      + `|${voice.sourceDigest}`

    const cached = cache.get(v2Key)
    let art: HumanReviewArtifact
    if (cached?.artifact !== undefined) {
      hit += 1
      art = cached.artifact
    } else {
      miss += 1
      art = await runContentCore({
        /**
         * 🔴 **회차마다 새로 만드는 불투명 id.** 원문에서 유도하지 않는다 —
         *    유도하면 id 가 원문의 지문이 되어 DB·큐로 원문이 새어 나간다.
         */
        artifactId: randomUUID().replace(/-/g, ''),
        sourceArticleId: j.sourceArticleId,
        /**
         * 🔴 **제목도 마스킹을 거친다** (2026-09-20). 본문은 수집 단계에서
         *    `maskSensitive` 를 지나는데 **제목은 지나지 않았다** — 연락처·메일·계정이
         *    제목에 있으면 그대로 provider 로 나갔다. 정본 함수를 그대로 쓴다.
         */
        title: maskSensitive(meta.title), maskedBody: meta.bodyHead,
        personas: voice.candidates, load: v2Load,
        voiceSourceDigest: voice.sourceDigest,
        ask: v2Ask, now, callCap: V2_CALL_CAP,
      })
      // 🔴 완주한 회차만 캐시에 남긴다 — 막힌 결과를 재사용하면 다음 회차도 막힌다
      if (art.review.semanticCompletion.complete) {
        cache.set(v2Key, { artifact: art, status: 'ok', attemptCount: art.cost.totalCalls })
      }
    }
    for (const c of art.cost.calls) {
      const k = `${c.stage}:${c.model ?? '?'}`
      statusCount.set(k, (statusCount.get(k) ?? 0) + 1)
    }
    if (art.plan.personaCode !== null) {
      v2Load[art.plan.personaCode] = (v2Load[art.plan.personaCode] ?? 0) + 1
    }
    artifacts.push(art)
    /** 🔴 담으면 안 되는 것이 들어갔는가 — 파일로 나가기 전에 본다 */
    const bad = violatesArtifact(art)
    if (bad.length > 0) {
      fail(`v2 artifact 계약 위반 (${j.sourceArticleId})\n${bad.map((b) => `     ${b}`).join('\n')}`)
    }

    if (art.draft === null) {
      v2Held += 1
      holdPick()
      continue
    }
    /**
     * 🔴 **정본 안전 필터를 다시 건다** — 모델 말을 믿지 않는다.
     *    v2 의 deterministic 은 개인정보·금지 낱말·복제·원자적 사실·나이를 보고,
     *    위기 신호 taxonomy 는 여기 정본(`safetyFilter`·`judgeDraftGate`)이 본다.
     */
    const cand: DraftCandidate = {
      sourceArticleId: j.sourceArticleId, draftNo: 1,
      title: art.draft.title, body: art.draft.body,
      safetyVerdict: safetyFilter({ title: art.draft.title, body: art.draft.body }).verdict,
      originality: measureOriginality(`${art.draft.title}\n${art.draft.body}`,
        `${meta.title}\n${meta.bodyHead}`),
      generatedAt: nowIso,
    }
    const crisis = judgeDraftGate({
      drafts: [cand], allLifeConflict: false,
      qualityHarms: [art.review.semantic?.issues.includes('harm') === true ? ['crisisSignal'] : []],
    }).reason
    if (crisis !== null) {
      crisisHeld += 1
      console.log(`   🔴 위기 신호로 회차를 멈췄다 — ${j.sourceArticleId} (${crisis})`)
    }
    /**
     * 🔴 **기계 판정을 그대로 채택으로 옮기지 않는다.** v2 가 `adopt` 여도
     *    제목 복제 · 중복 · 안전 · 위기 검사는 기존 정본이 다시 본다.
     */
    const p = pickV2({
      judgement: j, draft: cand, seenTitles, seenBodies,
      sourceUsed: usedSources.has(j.sourceArticleId),
      machineOutcome: art.review.machineOutcome,
      machineReason: art.review.machineReason,
      sourceTitleCopied: copiesSourceTitle(meta.title, cand.title),
      crisisStop: crisis,
    }, nowIso)
    picks.push(p)
    if (p.decision === 'AUTO_ADOPT') {
      adopted.push({ pick: p, draft: cand, meta, art })
      usedSources.add(j.sourceArticleId)
      seenTitles.add(normalize(cand.title))
      seenBodies.add(normalize(cand.body))
    }
  }

  const s = summarizeDrafts(picks)
  /**
   * ── 🔴 **v2 계약에 맞춘 지표** (2026-09-20) ──
   *
   *    앞판 `kindOf` 는 `ok` 가 아닌 모든 이름을 `provider` 오류로 셌다. v2 는
   *    단계 이름(`speakerPlan:gemini-3.7-flash` …)을 남기므로 **성공 호출이 전부
   *    provider 오류로 찍혔다.** 없앤 지표(ageCheck · 생활사 재생성 · unknownAxis)도 지운다.
   */
  console.log(`\n② 호출`)
  console.log(`   🟢 캐시 hit ${hit}건 — 🔴 provider 를 부르지 않았다`)
  console.log(`   🔴 캐시 miss ${miss}건 → 실제 provider 요청 ${BUDGET.spent}회`
    + ` (공동 예산 ${callBudgetOf(seeds.length)}회 = ${CALL_ALLOWANCE_PER_SOURCE}×${seeds.length}`
    + ` · 남은 ${BUDGET.left})`)
  {
    const per = [...BUDGET.perSource.entries()].sort((a, b) => b[1] - a[1])
    const avg = per.length === 0 ? 0 : BUDGET.spent / per.length
    console.log(`   원천별 사용: 최다 ${BUDGET.worstPerSource}회`
      + ` (정상 경로 ${V2_CALL_CAP}회 · 원천당 상한) · 평균 ${avg.toFixed(1)}회`
      + `${per.length > 0 ? ` · ${per.slice(0, 3).map(([k, n]) => `${k}×${n}`).join(' ')}` : ''}`)
  }
  // 🔴 단계마다 어느 모델이 몇 번 갔는가 — 혼합 회차라 합치면 알 수 없다
  {
    const byStage = [...statusCount.entries()].sort()
    console.log(`   단계별 ${byStage.length === 0 ? '없음' : byStage.map(([k, n]) => `${k} ${n}회`).join(' · ')}`)
  }
  /**
   * 🔴 **장부를 화면에 찍는다.** 위는 **요청 수**, 아래는 **금액**이다 —
   *    같은 줄에 합치면 어느 쪽이 막았는지 읽는 사람이 구분하지 못한다.
   */
  if (LEDGER !== null) console.log(`   ${LEDGER.describe().split('\n').join('\n   ')}`)
  console.log(`   🔴 위기 소재로 **부르기 전에** 멈춘 원천 ${sourceCrisisHeld}건 — AI 를 부르지 않았다 (정본 §4)`)
  console.log(`      위기 신호로 멈춘 회차 ${crisisHeld}건 — 사람이 본다`)
  console.log(`      자기 나이 모순(결정론) ${selfAgeCaught}건`)
  if (voiceHeld > 0) {
    console.log(`   🟡 쓸 Persona 가 없어 생성 전에 멈춘 원천 ${voiceHeld}건 — AI 를 부르지 않았다`)
  }
  {
    const used = Object.entries(v2Load).filter(([, n]) => n > 0).sort()
    if (used.length > 0) {
      console.log(`   🟢 말투 배정 ${used.map(([k, n]) => `${k}×${n}`).join(' · ')}`)
    }
  }
  console.log('\n③ 채택')
  console.log(`   🟢 AUTO_ADOPT ${s.AUTO_ADOPT}건  — 🔴 사람의 ADOPT 가 아니다`)
  console.log(`   🟡 AUTO_HOLD  ${s.AUTO_HOLD}건`)
  console.log(`   🔴 AUTO_DROP  ${s.AUTO_DROP}건`)
  console.log(`   🔴 v2 가 초안을 만들지 않고 멈춘 원천 ${v2Held}건 · artifact ${artifacts.length}장`)
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
  /** 🔴 사람이 근거를 보고 판단하는 한 장 — 채택되지 않은 것도 남긴다 */
  const artPath = join(DATA_DIR, `auto-draft-${rid}.artifacts.json`)
  for (const pp of [pickPath, candPath, artPath]) {
    if (!isInsideDataDir(pp)) fail(`${pp} 은 ${DATA_DIR}/ 밖이다`)
  }
  writeFileSync(pickPath, `${picks.map((pp) => JSON.stringify(pp)).join('\n')}\n`, 'utf-8')
  // 🔴 후보마다 "어느 판정에서 왔는지"를 실어 보낸다. 상수를 찍으면 근거가 아니라 장식이 된다 —
  //    supply-autofill 은 이 값이 없으면 큐 payload 를 만들지 않는다 (§4-AT)
  writeFileSync(candPath, `${JSON.stringify({
    /**
     * 🔴 **설명을 사실에 맞춘다** (2026-09-20). 앞판은 *"AUTO_ADOPT 라 autofill 이
     *    받지 않는다"* 라고 적혀 있었다 — 지금은 **정확히 반대**다.
     *    `MACHINE_PROFILE.sourceDecision === 'AUTO_ADOPT'` 이므로 autofill 은 받는다.
     *    막는 것은 그 다음 단계, **발행 전 사람 검토**(`publish:machine-review`)다.
     */
    note: '🔴 기계가 만들고 기계가 고른 초안이다. 사람의 ADOPT 가 아니다 —'
      + ' supply-autofill 은 이 후보를 큐에 올리지만,'
      + ' 발행은 사람이 publish:machine-review 로 검토를 마쳐야 열린다.',
    generatedAt: nowIso, ruleVersion: DRAFT_RULE_VERSION,
    /**
     * 🔴 **단계마다 모델이 다르다.** 한 칸에 하나만 적으면 거짓이 된다 —
     *    `stageModels` 로 통째로 싣고, 봉투 profile 이 정본과 대조한다.
     */
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    stageModels: STAGE_MODEL, provenance: DRAFT_PROVENANCE,
    candidates: adopted.map((a) => ({
      candidateType: 'seedOriginality',
      /** 🔴 사람 검토가 이 한 장을 정확히 찾는 열쇠 — 원문에서 유도하지 않은 값이다 */
      artifactId: a.art.artifactId,
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
      // 🔴 정본을 읽는다 — 여기에 판 이름을 다시 적지 않는다
      draftFrom: CONTENT_CORE_PIPELINE_VERSION,
      title: a.draft.title, body: a.draft.body,
      safetyVerdict: a.draft.safetyVerdict,
      // 🔴 **잰 값을 싣는다. 판정이 아니다.** 적재 쪽이 같은 정본으로 다시 판정한다
      originality: a.draft.originality,
      // 🔴 **어떤 말투 근거로 썼는지.** 텍스트도 작성자도 남기지 않는다 — 근거의 신원뿐이다
      /**
       * 🔴 **적재 정본(`readVoiceProvenance`)이 요구하는 모양으로 잇는다** (2026-09-20).
       *    v2 는 `sampleCount` 로 세고 적재는 `comments` 로 읽는다 — 이름이 달라
       *    그대로 실으면 `voiceProvenance 가 없거나 깨졌다` 로 전량 제외된다.
       *    🔴 두 계약을 잇는 자리는 여기 하나다. 값을 지어내지 않는다.
       */
      voiceProvenance: a.art.voice.provenance === null ? null : {
        personaCode: a.art.voice.provenance.personaCode,
        comments: a.art.voice.provenance.sampleCount,
        bundleDigest: a.art.voice.provenance.bundleDigest,
        sourceDigest: a.art.voice.provenance.sourceDigest,
      },
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
      provenanceNote: `기계 생성 · ${DRAFT_RULE_VERSION} · ${DRAFT_PROVENANCE} · content-core-v2`,
      autoJudge: seedProv.get(a.pick.sourceArticleId) ?? null,
    })),
  }, null, 2)}\n`, 'utf-8')
  writeFileSync(artPath, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf-8')
  saveCache(cache)
  console.log(`\n⑥ 🔴 파일 3개`)
  console.log(`   ✅ ${pickPath}  ${picks.length}건`)
  console.log(`   ✅ ${candPath}  ${adopted.length}건`)
  console.log(`   ✅ ${artPath}   ${artifacts.length}장 — 사람이 근거를 보는 한 장`)
  console.log('   🔴 큐에 넣지 않았다 · 발행하지 않았다 · 사람 승인은 그대로 남는다.\n')
}

// 🔴 겹침을 재는 함수는 여기 두지 않는다 — `src/lib/draft-originality.ts` 하나다.

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
