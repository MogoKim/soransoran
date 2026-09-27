/**
 * 🔴 **자동 READY 사후 감사 — 의미 감사자** (2026-09-27 · feat/auto-ready-audit-loop)
 *
 *   규칙 무결성·안전 감사(`auto-ready-rule-judge`)가 **못 보는 것**을 본다 —
 *     ① 원문 근거에 없는 사실을 지어냈는가 (unsupportedFacts)
 *     ② 글쓴이 Persona 카드의 생활사와 어긋나는가 (lifeContradictions)
 *     ③ 원문의 뜻을 뒤집거나 비틀었는가 (sourceDistortions)
 *
 * 🔴 **무엇에 묶이는가** — 판정은 아래 넷을 함께 본 것이어야 하고, 그 넷의 지문(`binding`)이
 *    결과와 함께 저장 경계로 간다. 저장 경계는 DB 에서 다시 잴 수 있는 것(글·도장)을 직접 대조한다.
 *      · 발행된 Post — id · 지금 제목·본문 hash
 *      · 그 글의 auto-ready:v1 도장 — 도장 전체의 digest
 *      · 초안을 만든 artifact 의 원문 근거 — artifactId · 근거 digest
 *      · 글쓴이 Persona 카드 — code · 생활사 계약 digest
 *
 * 🔴 **fail-closed** — 근거·카드를 못 읽었거나, 모델이 실패했거나, 응답을 못 읽었으면
 *    `defect: 'yes'`(measured=false) 다. `no` 로 읽히는 길은 **측정이 끝나고 발견이 0 일 때 하나뿐**이다.
 *    왜 "대기(null)" 가 아니라 yes 인가 — 감사 표에는 null·yes·no 셋뿐이고(0029 CHECK), 판정 대기는
 *    열림을 막지 않는다(계약). 측정하지 못한 것을 대기로 두면 게이트가 **열린 채** 남는다.
 *    대가 — 일시적 제공사 장애도 자동 회차를 멈춘다(yes 는 끈적하다). 사람이 원인을 본 뒤 푼다.
 *
 * 🔴 **판·모델·계약 상수는 무결성 감사자와 따로다.** 섞지 않는다.
 * 🔴 **품질 계약 digest 밖이다** — 이 파일의 상수는 `qualityContractComponents()` 에 들어가지 않는다.
 * 🔴 순수 함수다 — DB·파일·네트워크를 모른다. 제공사는 `SemanticAuditProvider` 로 주입받는다.
 */
import { createHash } from 'node:crypto'

import type { AuditVerdict, AutoReadyStamp } from './auto-ready-v2'
import { LIFE_CONTRACT_FIELDS, lifeContractIdentity, type PersonaLifeContract } from './content-core/speaker'

// ─────────────────────────────────────────────────────────
// 🔴 판 — 무결성 감사자(`integrity-v1` · `rule:integrity-safety-audit`)와 섞지 않는다
// ─────────────────────────────────────────────────────────

/** 🔴 의미 감사 계약의 판 — 판정 기준·출력 모양·묶음 구성이 바뀌면 올린다 */
export const SEMANTIC_AUDIT_CONTRACT_VERSION = 'auto-ready-semantic-audit-v1'
/** 🔴 프롬프트 판 — 지시문이 한 글자라도 바뀌면 올린다 */
export const SEMANTIC_AUDIT_PROMPT_VERSION = 'semantic-audit-prompt-v1'
/**
 * 🔴 **의미 감사 모델** — 가격표(`llm-pricing`)에 단가가 있는 내부 라벨이어야 한다.
 *    초안 생성(`gemini-3.7-flash`)과 다른 계열을 쓴다 — 쓴 모델이 제 글을 채점하지 않게 한다.
 */
export const SEMANTIC_AUDIT_MODEL = 'claude-haiku-4.5'
/** 🔴 감사자 표식 — `review-provenance` 의 비사람 종류 그대로다(사람 종류를 쓰지 않는다) */
export const SEMANTIC_AUDITOR = 'model:semantic-audit'
/** 🔴 지시문에 박는 표식 — 가짜 제공사(fixture)가 이 요청을 알아보는 유일한 근거다 */
export const SEMANTIC_AUDIT_MARK = 'SORAN_AUTO_READY_SEMANTIC_AUDIT'
/** 🔴 한 번의 감사가 받을 수 있는 출력 토큰 상한 — 예약액 계산에 그대로 들어간다 */
export const SEMANTIC_AUDIT_MAX_OUTPUT_TOKENS = 800
export const SEMANTIC_AUDIT_TIMEOUT_MS = 60_000

/**
 * 🔴 **유료 호출 스위치 — 기본 OFF.** 정확히 `on` 일 때만 제공사를 부른다.
 *    이 값은 어디에도 설정돼 있지 않다. 꺼져 있으면 의미 감사는 "측정 불가" 이고 → 결함 yes 다.
 *    켜도 공급 장부의 예산 env 셋이 없으면 요청 전에 막힌다(같은 장부 · 같은 차단).
 */
export const SEMANTIC_PAID_ENV = 'SORAN_AUTO_READY_SEMANTIC_PAID'
export function semanticPaidEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[SEMANTIC_PAID_ENV] ?? '').trim().toLowerCase() === 'on'
}

// ─────────────────────────────────────────────────────────
// 🔴 문맥 — 무엇을 보고 판정하는가
// ─────────────────────────────────────────────────────────

export type SemanticAuditContext = {
  /** 🔴 **발행된** Post — 큐의 초안이 아니다 */
  post: { id: string; title: string; body: string }
  stamp: AutoReadyStamp | null
  /** 🔴 초안을 만든 artifact 의 **원문 근거**(마스킹된 조각) — 로컬 정본에서만 온다 */
  artifact: { artifactId: string; sourceArticleId: string; sourceTitle: string; sourceBody: string }
  /** 🔴 글쓴이 Persona 의 정본 카드(생활사 계약) */
  persona: { code: string; card: PersonaLifeContract }
}

export type SemanticContextResult =
  | { ok: true; ctx: SemanticAuditContext }
  | { ok: false; code: string; reason: string }

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x)) ?? 'undefined'

/** 🔴 도장 전체의 지문 — 도장이 없으면 고정 문자열(그 자체로 다른 값이다) */
export function stampDigestOf(stamp: AutoReadyStamp | null): string {
  return stamp === null ? 'no-stamp' : sha(stableJson(stamp))
}

export type SemanticBindingParts = {
  postId: string
  titleHash: string
  bodyHash: string
  stampDigest: string
  artifactId: string
  /** 원문 근거(제목 + 본문 조각) digest */
  sourceDigest: string
  personaCode: string
  /** 생활사 계약 한 줄(`lifeContractIdentity`) digest */
  personaCardDigest: string
}
export type SemanticBinding = SemanticBindingParts & { digest: string }

/** 🔴 묶음 digest — 칸 순서를 고정해 조립한다(객체 키 순서에 기대지 않는다) */
export function bindingDigestOf(p: SemanticBindingParts): string {
  return sha([
    SEMANTIC_AUDIT_CONTRACT_VERSION, p.postId, p.titleHash, p.bodyHash, p.stampDigest,
    p.artifactId, p.sourceDigest, p.personaCode, p.personaCardDigest,
  ].join('\u0001'))
}

export function semanticBindingOf(ctx: SemanticAuditContext): SemanticBinding {
  const parts: SemanticBindingParts = {
    postId: ctx.post.id,
    titleHash: sha(ctx.post.title),
    bodyHash: sha(ctx.post.body),
    stampDigest: stampDigestOf(ctx.stamp),
    artifactId: ctx.artifact.artifactId,
    sourceDigest: sha(`${ctx.artifact.sourceTitle}\u0001${ctx.artifact.sourceBody}`),
    personaCode: ctx.persona.code,
    personaCardDigest: sha(lifeContractIdentity(ctx.persona.card)),
  }
  return { ...parts, digest: bindingDigestOf(parts) }
}

// ─────────────────────────────────────────────────────────
// 🔴 요청 — 실제로 나가는 문자열. 원문 근거와 카드가 **반드시** 실린다
// ─────────────────────────────────────────────────────────

export const SEMANTIC_AUDIT_SYSTEM_PROMPT = [
  `[${SEMANTIC_AUDIT_MARK} ${SEMANTIC_AUDIT_PROMPT_VERSION}]`,
  '당신은 40대 중반~60대 중반 여성 커뮤니티에 이미 게시된 글을 사후 감사한다.',
  '입력은 JSON 이다 — "게시글"(실제로 게시된 제목·본문), "원문근거"(이 글의 바탕이 된 원문 조각),',
  '"글쓴이카드"(이 글을 쓴 사람으로 표시된 인물의 생활사). 세 가지를 서로 대조해 아래 셋만 찾는다.',
  '1) unsupportedFacts: 원문근거에도 글쓴이카드에도 없는 구체적 사실(숫자·금액·장소·사건·진단 등)을 지어냈다.',
  '   일반적인 감상·질문·인사는 사실이 아니다.',
  '2) lifeContradictions: 글쓴이카드의 생활사(나이대·혼인·자녀·일·갱년기·부양 등)와 게시글이 어긋난다.',
  '3) sourceDistortions: 원문근거의 뜻을 뒤집거나, 원문에 없는 결론을 원문이 한 말처럼 옮겼다.',
  '확실한 것만 적는다. 없으면 빈 배열이다. defect 는 셋 중 하나라도 비어 있지 않으면 "yes", 모두 비면 "no" 다.',
  '출력은 JSON 객체 하나뿐이다. 다른 글자를 쓰지 않는다:',
  '{"unsupportedFacts":[{"claim":"","why":""}],"lifeContradictions":[{"claim":"","card":""}],'
    + '"sourceDistortions":[{"claim":"","source":""}],"defect":"yes|no"}',
].join('\n')

/** 🔴 카드에서 프롬프트에 싣는 칸 — 생활사 계약 정본 칸 그대로다(다시 고르지 않는다) */
function cardPayload(card: PersonaLifeContract): Record<string, unknown> {
  return Object.fromEntries(LIFE_CONTRACT_FIELDS.map((k) => [k, card[k] ?? null]))
}

export function buildSemanticAuditRequest(ctx: SemanticAuditContext): { systemPrompt: string; userPayload: string } {
  return {
    systemPrompt: SEMANTIC_AUDIT_SYSTEM_PROMPT,
    userPayload: JSON.stringify({
      게시글: { 제목: ctx.post.title, 본문: ctx.post.body },
      원문근거: { 제목: ctx.artifact.sourceTitle, 본문: ctx.artifact.sourceBody },
      글쓴이카드: cardPayload(ctx.persona.card),
    }),
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 응답 — 모양이 하나라도 어긋나면 "못 읽었다" 다(결코 no 가 아니다)
// ─────────────────────────────────────────────────────────

export type SemanticFindings = {
  unsupportedFacts: { claim: string; why: string }[]
  lifeContradictions: { claim: string; card: string }[]
  sourceDistortions: { claim: string; source: string }[]
}

export type SemanticParse =
  | { ok: true; defect: 'yes' | 'no'; findings: SemanticFindings }
  | { ok: false; reason: string }

const FINDING_KEYS = {
  unsupportedFacts: ['claim', 'why'],
  lifeContradictions: ['claim', 'card'],
  sourceDistortions: ['claim', 'source'],
} as const

export function parseSemanticAuditResponse(raw: string): SemanticParse {
  let v: unknown
  try { v = JSON.parse(raw.trim()) } catch { return { ok: false, reason: '응답이 JSON 이 아니다' } }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: '응답이 객체가 아니다' }
  const o = v as Record<string, unknown>
  const findings: Record<string, Record<string, string>[]> = {}
  for (const [k, fields] of Object.entries(FINDING_KEYS)) {
    const arr = o[k]
    if (!Array.isArray(arr)) return { ok: false, reason: `${k} 가 배열이 아니다` }
    const items: Record<string, string>[] = []
    for (const it of arr) {
      if (it === null || typeof it !== 'object' || Array.isArray(it)) return { ok: false, reason: `${k} 항목이 객체가 아니다` }
      const r = it as Record<string, unknown>
      const item: Record<string, string> = {}
      for (const f of fields) {
        if (typeof r[f] !== 'string') return { ok: false, reason: `${k}.${f} 가 문자열이 아니다` }
        item[f] = r[f] as string
      }
      // 🔴 빈 주장은 발견이 아니다 — 그러나 무시하지도 않는다(모양이 깨진 것이다)
      if (item.claim.trim() === '') return { ok: false, reason: `${k}.claim 이 비었다` }
      items.push(item)
    }
    findings[k] = items
  }
  const any = Object.values(findings).some((a) => a.length > 0)
  if (o.defect !== 'yes' && o.defect !== 'no') return { ok: false, reason: `defect=${String(o.defect)}` }
  /**
   * 🔴 **스스로 모순된 응답은 못 읽은 것이다.** 발견이 있는데 no, 발견이 없는데 yes —
   *    어느 쪽을 믿을지 모르므로 측정 불가(→ yes)로 간다.
   */
  if ((o.defect === 'yes') !== any) return { ok: false, reason: `defect=${o.defect} 인데 발견 ${any ? '있음' : '없음'} — 모순` }
  return { ok: true, defect: any ? 'yes' : 'no', findings: findings as unknown as SemanticFindings }
}

// ─────────────────────────────────────────────────────────
// 🔴 제공사 — 인터페이스 뒤에 둔다. CI 는 가짜 · 운영 유료는 기본 OFF
// ─────────────────────────────────────────────────────────

export type SemanticProviderResult = { ok: true; text: string } | { ok: false; code: string; reason: string }
export type SemanticAuditProvider = {
  /** 🔴 실제로 부르는 모델 — `SEMANTIC_AUDIT_MODEL` 과 다르면 판정하지 않는다 */
  model: string
  complete: (req: { systemPrompt: string; userPayload: string; maxOutputTokens: number; timeoutMs: number }) => Promise<SemanticProviderResult>
}

export type SemanticVerdict = {
  defect: 'yes' | 'no'
  /** 🔴 측정이 끝났는가 — false 면 defect 는 언제나 yes 다 */
  measured: boolean
  reasons: string[]
  /** 🔴 무엇에 묶였나 — 문맥을 못 만들었으면 null(그때 defect 는 yes) */
  binding: SemanticBinding | null
  contractVersion: string
  model: string
  promptVersion: string
}

const unmeasured = (reason: string, binding: SemanticBinding | null): SemanticVerdict => ({
  defect: 'yes', measured: false, reasons: [`🔴 의미 감사 측정 불가(fail-closed) — ${reason}`], binding,
  contractVersion: SEMANTIC_AUDIT_CONTRACT_VERSION, model: SEMANTIC_AUDIT_MODEL, promptVersion: SEMANTIC_AUDIT_PROMPT_VERSION,
})

/**
 * 🔴 **의미 감사 한 건.** 어떤 실패도 `no` 로 끝나지 않는다.
 *    · 문맥 없음(artifact · 카드 · 글) → yes(측정 불가)
 *    · 제공사 모델이 계약 모델과 다름 → yes(측정 불가)
 *    · 제공사 실패 · 예외 → yes(측정 불가)
 *    · 응답 모양 어긋남 · 자기모순 → yes(측정 불가)
 */
export async function judgeSemantic(ctxRes: SemanticContextResult, provider: SemanticAuditProvider): Promise<SemanticVerdict> {
  if (!ctxRes.ok) return unmeasured(`${ctxRes.code} · ${ctxRes.reason}`, null)
  const binding = semanticBindingOf(ctxRes.ctx)
  if (provider.model !== SEMANTIC_AUDIT_MODEL) return unmeasured(`제공사 모델 ${provider.model} ≠ 계약 ${SEMANTIC_AUDIT_MODEL}`, binding)
  let res: SemanticProviderResult
  try {
    res = await provider.complete({
      ...buildSemanticAuditRequest(ctxRes.ctx),
      maxOutputTokens: SEMANTIC_AUDIT_MAX_OUTPUT_TOKENS, timeoutMs: SEMANTIC_AUDIT_TIMEOUT_MS,
    })
  } catch (e) {
    return unmeasured(`제공사 예외 ${e instanceof Error ? e.name : 'unknown'}`, binding)
  }
  if (!res.ok) return unmeasured(`제공사 실패 ${res.code} · ${res.reason}`, binding)
  const p = parseSemanticAuditResponse(res.text)
  if (!p.ok) return unmeasured(`응답을 읽지 못했다 — ${p.reason}`, binding)
  const reasons = [
    ...p.findings.unsupportedFacts.map((f) => `근거 없는 사실: ${f.claim} (${f.why})`),
    ...p.findings.lifeContradictions.map((f) => `생활사 모순: ${f.claim} ↔ 카드 ${f.card}`),
    ...p.findings.sourceDistortions.map((f) => `원문 왜곡: ${f.claim} ↔ 원문 ${f.source}`),
  ]
  return {
    defect: p.defect, measured: true, reasons, binding,
    contractVersion: SEMANTIC_AUDIT_CONTRACT_VERSION, model: SEMANTIC_AUDIT_MODEL, promptVersion: SEMANTIC_AUDIT_PROMPT_VERSION,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 합치기 — 둘 중 하나라도 yes 면 yes
// ─────────────────────────────────────────────────────────

export type CombinedAudit = { verdict: AuditVerdict; semantic: SemanticVerdict }

/**
 * 🔴 **규칙 감사 + 의미 감사 → 최종 판정 하나.** 어느 쪽이든 yes 면 yes 다.
 *    기록되는 모델·프롬프트 판은 **둘을 이은 값**이다 — 무엇으로 판정했는지 한 칸에 둘 다 남는다.
 *    감사 계약 판(`contractVersion`)은 규칙 감사의 것을 그대로 쓴다(저장 경계가 그 값을 요구한다).
 */
export function combineAuditVerdicts(rule: AuditVerdict, semantic: SemanticVerdict): CombinedAudit {
  const defect = rule.defect === 'yes' || semantic.defect === 'yes' ? 'yes' : 'no'
  return {
    verdict: {
      defect,
      reasons: [...rule.reasons, ...semantic.reasons],
      contractVersion: rule.contractVersion,
      model: `${rule.model}+${semantic.model}`,
      promptVersion: `${rule.promptVersion}+${semantic.promptVersion}`,
      judgedTitleHash: rule.judgedTitleHash,
      judgedBodyHash: rule.judgedBodyHash,
    },
    semantic,
  }
}

/** 🔴 감사 note 의 머리 — 묶음 digest 를 **전부** 남긴다(잘리지 않게 머리에 둔다) */
export function semanticNoteHead(s: SemanticVerdict): string {
  const b = s.binding
  return b === null
    ? `[${s.contractVersion} measured=${s.measured} binding=none]`
    : `[${s.contractVersion} measured=${s.measured} binding=${b.digest} artifact=${b.artifactId} persona=${b.personaCode} card=${b.personaCardDigest.slice(0, 16)}]`
}
