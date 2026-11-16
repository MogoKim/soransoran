#!/usr/bin/env tsx
/**
 * 추가 댓글 실패 분류 · 같은 회차 재선정 검사 (2026-11-14 H1) — 🔴 DB · provider · 네트워크 · env 파일 · launchd 없음
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/persona-comment-followup-reselect-check.mts
 *
 * 근본 원인: 결정적 picker 는 같은 글에서 같은 Persona 를 매번 먼저 고른다. 실패를 기억하지 않으면 그 Persona 가
 * 다음 회차에도 같은 자리를 먹고(starvation), 글 전체를 막으면 그 글의 정상 Persona 까지 하루 동안 못 고른다.
 *
 * 무엇을 잠그나 — 실제 `runFollowupGeneration` + 실제 시도 기억 파일(mkdtemp) + 가짜 attempt(호출 · 결과 대역)
 *   A 실패 Persona 반복 0 — 다음 회차에 그 Persona 를 어느 글에서도 다시 부르지 않는다
 *   B 같은 회차 대체 성공 — 같은 글에서 다음 정상 Persona 가 적재된다
 *   C 글 한 건 실패가 다른 Persona · 다른 글을 막지 않는다(글 × Persona 실패도 그 쌍만)
 *   D KST 자정에 격리가 풀린다(23:59:59.999 까지 격리 · 00:00 부터 다시 고른다)
 *   E 일시 provider 실패는 아무것도 격리하지 않는다 — 회차만 멈추고 다음 회차에 같은 조합을 다시 시작한다
 *   F 모든 후보 실패 — 호출은 상한 안 · 적재 0 · 다음 회차 호출 0
 *   G 비용 · 호출 상한 — 호출 예산 · 적재 상한 · 한 글 시도 상한을 넘지 않는다 · 400 · 기록 IO 는 회차를 멈춘다
 *   H 첫 댓글 불변 — 첫 댓글 lane 은 재시작 · 격리 규칙이 그대로이고, 첫 댓글 저장소를 받으면 호출 0
 *   I 실회원 불변 — 실회원 Persona 는 다른 후보가 전부 격리돼도 고르지 않는다 · 정본 판정 함수를 그대로 쓴다
 */
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 🔴 시험은 운영 장부 · 경로에 쓰지 않는다 — import 전에 HOME 을 임시로 고정한다
const sandbox = mkdtempSync(join(tmpdir(), 'fu-reselect-'))
process.env.HOME = sandbox

const { createAttemptStore } = await import('./lib/persona-comment-attempt-store.mjs')
// 🔴 변이 시험(`persona-comment-followup-reselect-mutation.mts`)이 `FOLLOWUP_RUN_MODULE` 로 변이 사본을 주입한다
const { runFollowupGeneration } = (await import(process.env.FOLLOWUP_RUN_MODULE ?? './lib/persona-comment-followup-run.mjs')) as Run
const F = await import('../src/lib/persona-comment-followup')
const P = await import('../src/lib/persona-comment-attempt-policy')
type AttemptStore = import('./lib/persona-comment-attempt-store.mjs').AttemptStore
type Run = typeof import('./lib/persona-comment-followup-run.mjs')
type PipelineTarget = import('./lib/persona-comment-pipeline').PipelineTarget
type PipelineResult = import('./lib/persona-comment-pipeline').PipelineResult
type PipelineStep = import('./lib/persona-comment-pipeline').PipelineStep
type EnqueuePlan = NonNullable<PipelineResult['outcomes'][number]['plan']>

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
const lines: string[] = []
const check = (name: string, cond: boolean, detail = ''): void => {
  if (!cond) failures++
  lines.push(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const MIN = 60_000
// 2026-11-14 12:00 KST = 03:00Z — KST 날은 2026-11-14 00:00 KST(= 11-13 15:00Z) ~ 2026-11-15 00:00 KST(= 11-14 15:00Z)
const NOW = Date.parse('2026-11-14T03:00:00Z')
const KST_MIDNIGHT = Date.parse('2026-11-14T15:00:00Z')
const PUB = NOW - 30 * MIN

// ── 대역 — Persona · 글 · 결과 ──
type Persona = { code: string; id: string; realMember?: boolean }
const PERSONAS: Persona[] = [
  { code: 'pc-a', id: 'pid-a' }, { code: 'pc-b', id: 'pid-b' }, { code: 'pc-c', id: 'pid-c' }, { code: 'pc-d', id: 'pid-d' },
]
const factsOf = (ps: readonly Persona[]): import('../src/lib/persona-comment-followup').FollowupPersonaFacts[] =>
  ps.map((p) => ({
    code: p.code, personaId: p.id, active: true, realMember: p.realMember === true, profileComplete: true, voiceCapable: true,
    followupsToday: 0,
  }))
type Slot = { postId: string; postPublishedAtMs: number }
const slotsOf = (...ids: string[]): Slot[] => ids.map((postId) => ({ postId, postPublishedAtMs: PUB }))

/** 결과 대역 — `글:Persona` 또는 `*:Persona` 또는 `글:*` 에 걸린다. 없으면 적재 */
type Fake =
  | { step: 'ENQUEUED' }
  | { step: 'PROVIDER_FAILED'; errorCode: string }
  | { step: 'PARSE_FAILED' }
  | { step: 'ENQUEUE_BLOCKED'; gates?: { gate: string; outcome: string }[]; blocks?: string[] }
  | { step: 'WRITE_FAILED'; writeCode: string }
type Script = Record<string, Fake>
const fakeOf = (script: Script, postId: string, code: string): Fake =>
  script[`${postId}:${code}`] ?? script[`*:${code}`] ?? script[`${postId}:*`] ?? { step: 'ENQUEUED' }

const VOICE_FAIL: Fake = { step: 'ENQUEUE_BLOCKED', gates: [{ gate: '⑧', outcome: 'regenerate' }], blocks: ['GATE_BLOCKED'] }
const POST_GONE: Fake = { step: 'WRITE_FAILED', writeCode: 'POST_GONE' }
const TEXT_DUP: Fake = { step: 'PROVIDER_FAILED', errorCode: 'FOLLOWUP_TEXT_DUP' }
const HTTP_429: Fake = { step: 'PROVIDER_FAILED', errorCode: 'HTTP_429' }
const HTTP_503: Fake = { step: 'PROVIDER_FAILED', errorCode: 'HTTP_503' }
const HTTP_400: Fake = { step: 'PROVIDER_FAILED', errorCode: 'HTTP_400' }

let dirSeq = 0
const freshStore = (lane = F.FOLLOWUP_ATTEMPT_LANE): AttemptStore =>
  createAttemptStore({ dir: mkdtempSync(join(sandbox, `store-${dirSeq++}-`)), lane })

type Tick = Awaited<ReturnType<Run['runFollowupGeneration']>> & { calls: string[]; plans: string[] }
/**
 * 한 회차 — 저장소에서 오늘 격리를 읽고(운영과 같은 `followupIsolationOf`), 결정적 picker 대역(고정 순서 · 늘 앞사람부터)으로
 * 고른 뒤 실제 `runFollowupGeneration` 을 돌린다. attempt 대역은 운영 파이프라인처럼 `beforeProvider` 를 먼저 부른다.
 */
async function tick(o: {
  store: AttemptStore; nowMs: number; slots: Slot[]; script?: Script; personas?: readonly Persona[]
  allowed?: number; budget?: number
  /** 🔴 회차가 읽은 뒤 다른 프로세스가 기억을 썼다 — 낡은 격리로 고른다 */
  staleIsolation?: boolean
}): Promise<Tick> {
  const personas = o.personas ?? PERSONAS
  const facts = factsOf(personas)
  const read = o.store.read(o.nowMs)
  if (!read.ok) throw new Error(`기억 읽기 실패 ${read.code}`)
  const isolation = o.staleIsolation === true ? F.emptyFollowupIsolation() : F.followupIsolationOf(read.entries, o.nowMs)
  const calls: string[] = []
  const plans: string[] = []
  const allowed = o.allowed ?? 3
  const r = await runFollowupGeneration<Slot>({
    store: o.store, nowMs: o.nowMs, allowed,
    providerCallBudget: o.budget ?? F.followupPlanCap(allowed), slots: o.slots, isolation,
    planFor: (slot, ex) => {
      plans.push(slot.postId)
      const cands = F.followupPersonaCandidates({
        postId: slot.postId, personas: facts, isolation: ex.isolation, usedPersonaIds: ex.usedPersonaIds,
      })
      // 🔴 결정적 picker 대역 — 늘 같은 순서(근본 원인: 같은 글에서 같은 Persona 가 늘 먼저 뽑힌다)
      const first = cands[0]
      if (first === undefined) return { ok: false, reason: '이을 수 있는 Persona 가 없다' }
      const p = personas.find((x) => x.id === first.personaId)!
      const target = {
        facts: { postId: slot.postId, personaCode: p.code, reactionRole: 'empathy' },
      } as unknown as PipelineTarget
      return { ok: true, plan: { target, personaId: p.id } }
    },
    attempt: async (target, beforeProvider) => {
      const { postId, personaCode, reactionRole } = target.facts
      const out = (step: PipelineStep, extra: Partial<PipelineResult> = {}, plan: EnqueuePlan | null = null): PipelineResult => ({
        providerCalls: 0, created: 0, stoppedReason: null, stoppedCode: null,
        outcomes: [{ postId, personaCode, reactionRole, step, reason: step, plan }], ...extra,
      })
      const gate = await beforeProvider(target)
      if (!gate.proceed) {
        return { result: out('ATTEMPT_BLOCKED', gate.stopRound ? { stoppedReason: gate.reason } : {}), errorCode: null, writeCode: null }
      }
      calls.push(`${postId}:${personaCode}`)
      const f = fakeOf(o.script ?? {}, postId, personaCode)
      switch (f.step) {
        case 'ENQUEUED': return { result: out('ENQUEUED', { providerCalls: 1, created: 1 }), errorCode: null, writeCode: null }
        case 'PROVIDER_FAILED':
          return {
            result: out('PROVIDER_FAILED', {
              providerCalls: 1,
              ...(f.errorCode === 'HTTP_400' ? { stoppedReason: '요청 모양 거부', stoppedCode: 'PROVIDER_REQUEST_REJECTED' as const } : {}),
            }),
            errorCode: f.errorCode, writeCode: null,
          }
        case 'PARSE_FAILED': return { result: out('PARSE_FAILED', { providerCalls: 1 }), errorCode: null, writeCode: null }
        case 'ENQUEUE_BLOCKED': {
          const plan = {
            ok: false, gates: f.gates ?? [], blocks: (f.blocks ?? []).map((code) => ({ code, message: code })),
          } as unknown as EnqueuePlan
          return { result: out('ENQUEUE_BLOCKED', { providerCalls: 1 }, plan), errorCode: null, writeCode: null }
        }
        case 'WRITE_FAILED': return { result: out('WRITE_FAILED', { providerCalls: 1 }), errorCode: null, writeCode: f.writeCode }
      }
    },
  })
  return { ...r, calls, plans }
}
const enqueuedOf = (t: Tick): string[] => t.outcomes.filter((o) => o.step === 'ENQUEUED').map((o) => `${o.postId}:${o.personaCode}`)
const fileOf = (s: AttemptStore) => JSON.parse(readFileSync(s.path, 'utf-8')) as { entries: import('../src/lib/persona-comment-attempt-policy').AttemptEntry[] }

try {
  // ═════════ A · B — 실패 Persona 반복 0 · 같은 회차 대체 성공 ═════════
  {
    const store = freshStore()
    const script: Script = { '*:pc-a': VOICE_FAIL }
    const t1 = await tick({ store, nowMs: NOW, slots: slotsOf('post-1'), script, allowed: 1 })
    check('B 🔴 같은 회차 — 앞 Persona(⑧ 실패) 다음 같은 글에서 정상 Persona 가 적재된다',
      JSON.stringify(t1.calls) === JSON.stringify(['post-1:pc-a', 'post-1:pc-b']) && JSON.stringify(enqueuedOf(t1)) === JSON.stringify(['post-1:pc-b']),
      JSON.stringify(t1.calls))
    check('B 적재 1 · 호출 2 — 적재 상한(allowed=1) 안 · 호출 상한(2) 안', t1.created === 1 && t1.providerCalls === 2)
    check('B 🔴 실패 분류는 FU_PERSONA_DAY 이고 기억 파일 blockCodes 에 그대로 적힌다',
      t1.classified.length === 1 && t1.classified[0]!.code === 'FU_PERSONA_DAY'
      && fileOf(store).entries.some((e) => e.personaCode === 'pc-a' && e.blockCodes.includes('FU_PERSONA_DAY')),
      JSON.stringify(fileOf(store).entries.map((e) => [e.personaCode, e.step, e.blockCodes])))
    // 다음 회차(같은 KST 날) — 결정적 picker 는 여전히 pc-a 를 먼저 고르려 한다
    const t2 = await tick({ store, nowMs: NOW + 30 * MIN, slots: slotsOf('post-2', 'post-3'), script, allowed: 2 })
    check('A 🔴 다음 회차 — 실패 Persona(pc-a)를 어느 글에서도 다시 부르지 않는다(반복 0 · starvation 0)',
      !t2.calls.some((c) => c.endsWith(':pc-a')) && t2.created === 2, JSON.stringify(t2.calls))
    check('A 다음 회차 — 다른 정상 Persona 가 자리를 채운다(호출 = 적재)', t2.providerCalls === 2, JSON.stringify(enqueuedOf(t2)))
    // 🔴 반례 — 격리가 없으면(옛 동작: 기억 없음) 결정적 picker 는 pc-a 를 다시 부른다
    const tOld = await tick({ store: freshStore(), nowMs: NOW + 30 * MIN, slots: slotsOf('post-2'), script, allowed: 1 })
    check('A 반례 — 기억이 없으면 같은 실패 Persona 가 다시 먼저 불린다(시험이 근본 원인을 실제로 재현한다)',
      tOld.calls[0] === 'post-2:pc-a', JSON.stringify(tOld.calls))
    // 마지막 방어선 — 격리를 무시하고 직접 시작하려 해도 저장소가 받지 않는다
    const w = store.recordStart({
      postId: 'post-9', personaCode: 'pc-a', reactionRole: 'empathy', postPublishedAtMs: PUB, attemptedAtMs: NOW + 31 * MIN,
      step: 'STARTED', failedGates: [], blockCodes: [],
    }, NOW + 31 * MIN)
    check('A 🔴 저장소 마지막 방어선 — 오늘 격리된 Persona 는 다른 글에서도 시작 기록을 받지 않는다', !w.ok && w.kind === 'ALREADY_ATTEMPTED',
      w.ok ? 'ok' : w.reason)
  }

  // ═════════ C — 글 한 건 실패가 다른 Persona · 다른 글을 막지 않는다 ═════════
  {
    const store = freshStore()
    const t1 = await tick({ store, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script: { 'post-1:pc-a': POST_GONE }, allowed: 2 })
    check('C 🔴 글 실패(POST_GONE) → 그 글만 건너뛰고 같은 Persona 가 다음 글에서 적재된다',
      JSON.stringify(t1.calls) === JSON.stringify(['post-1:pc-a', 'post-2:pc-a']) && JSON.stringify(enqueuedOf(t1)) === JSON.stringify(['post-2:pc-a']),
      JSON.stringify(t1.calls))
    check('C 글 실패 분류 = FU_POST_DAY', t1.classified.map((c) => c.code).join(',') === 'FU_POST_DAY')
    check('C 글 실패 뒤 그 글에서 Persona 를 다시 고르지 않는다(바로 다음 글)', JSON.stringify(t1.plans) === JSON.stringify(['post-1', 'post-2']),
      JSON.stringify(t1.plans))
    const t2 = await tick({ store, nowMs: NOW + 30 * MIN, slots: slotsOf('post-1', 'post-3'), allowed: 2 })
    check('C 🔴 다음 회차 — 그 글만 빠지고 실패 당시 Persona(pc-a)는 다른 글에서 고른다',
      !t2.calls.some((c) => c.startsWith('post-1:')) && t2.calls.includes('post-3:pc-a'), JSON.stringify(t2.calls))
    check('C 다음 회차 — 격리된 글은 Persona 고르기 전에 건너뛴다', !t2.plans.includes('post-1'), JSON.stringify(t2.plans))

    // 글 × Persona 실패 — 그 쌍만
    const s2 = freshStore()
    const t3 = await tick({ store: s2, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script: { 'post-1:pc-a': TEXT_DUP }, allowed: 2 })
    check('C 🔴 글 × Persona 실패(본문 중복) → 같은 글에서 다음 Persona 가 적재되고, 그 Persona 는 같은 회차 다른 글에서 적재된다',
      JSON.stringify(t3.calls) === JSON.stringify(['post-1:pc-a', 'post-1:pc-b', 'post-2:pc-a'])
      && JSON.stringify(enqueuedOf(t3)) === JSON.stringify(['post-1:pc-b', 'post-2:pc-a']), JSON.stringify(t3.calls))
    check('C 글 × Persona 분류 = FU_COMBO_DAY', t3.classified.map((c) => c.code).join(',') === 'FU_COMBO_DAY')
    const iso = F.followupIsolationOf(fileOf(s2).entries, NOW + MIN)
    check('C 🔴 글 × Persona 실패 격리는 그 쌍 하나뿐 — Persona · 글 격리 0',
      iso.personaCodes.size === 0 && iso.postIds.size === 0 && iso.postPersonaKeys.size === 1 && iso.postPersonaKeys.has('post-1:pc-a'))
  }

  // ═════════ C2 — 같은 회차 사용 · 낡은 격리(다른 프로세스가 방금 쓴 기억) ═════════
  {
    const t1 = await tick({ store: freshStore(), nowMs: NOW, slots: slotsOf('post-1', 'post-2', 'post-3'), allowed: 3 })
    const who = enqueuedOf(t1).map((k) => k.split(':')[1])
    check('C2 🔴 한 회차에 같은 Persona 가 두 글에 적재되지 않는다(이번 회차 사용)',
      who.length === 3 && new Set(who).size === 3, JSON.stringify(enqueuedOf(t1)))

    const store = freshStore()
    const w = store.recordStart({
      postId: 'post-1', personaCode: 'pc-a', reactionRole: 'empathy', postPublishedAtMs: PUB, attemptedAtMs: NOW,
      step: 'STARTED', failedGates: [], blockCodes: [],
    }, NOW)
    const t2 = await tick({ store, nowMs: NOW + MIN, slots: slotsOf('post-1'), allowed: 1, staleIsolation: true })
    check('C2 🔴 낡은 격리로 pc-a 를 골라 저장소가 거절해도(호출 0) 같은 글에서 다음 정상 Persona 가 적재된다',
      w.ok && t2.calls.length === 1 && JSON.stringify(enqueuedOf(t2)) === JSON.stringify(['post-1:pc-b'])
      && t2.outcomes.some((o) => o.step === 'ATTEMPT_BLOCKED' && o.personaCode === 'pc-a'),
      JSON.stringify(t2.outcomes.map((o) => `${o.personaCode}:${o.step}`)))
  }

  // ═════════ D — KST 자정 reset ═════════
  {
    const store = freshStore()
    const late = KST_MIDNIGHT - 10 * MIN // 23:50 KST
    const pub = late - 30 * MIN
    await tick({ store, nowMs: late, slots: [{ postId: 'post-1', postPublishedAtMs: pub }], script: { '*:pc-a': VOICE_FAIL }, allowed: 1 })
    const before = store.read(KST_MIDNIGHT - 1)
    const after = store.read(KST_MIDNIGHT)
    check('D 🔴 23:59:59.999 KST — Persona 격리가 아직 살아 있다',
      before.ok && F.followupIsolationOf(before.entries, KST_MIDNIGHT - 1).personaCodes.has('pc-a'))
    check('D 🔴 00:00 KST — 기억이 끝나 격리가 풀린다(영구 차단 없음)',
      after.ok && after.entries.length === 0 && F.followupIsolationOf(after.ok ? after.entries : [], KST_MIDNIGHT).personaCodes.size === 0)
    check('D 만료 시각 = 시도한 KST 날의 마지막 ms', F.kstDayEndMs(late) === KST_MIDNIGHT - 1 && F.kstDayEndMs(KST_MIDNIGHT) === KST_MIDNIGHT + 24 * 60 * MIN - 1)
    const t2 = await tick({ store, nowMs: KST_MIDNIGHT + MIN, slots: [{ postId: 'post-2', postPublishedAtMs: KST_MIDNIGHT }], allowed: 1 })
    check('D 🔴 자정 뒤 회차 — 결정적 picker 가 pc-a 를 다시 고르고 적재된다', JSON.stringify(t2.calls) === JSON.stringify(['post-2:pc-a']),
      JSON.stringify(t2.calls))
  }

  // ═════════ E — 일시 provider 실패는 격리하지 않는다 ═════════
  for (const [name, f] of [['HTTP_429', HTTP_429], ['HTTP_503', HTTP_503], ['NETWORK', { step: 'PROVIDER_FAILED', errorCode: 'NETWORK' } as Fake],
    ['TIMEOUT', { step: 'PROVIDER_FAILED', errorCode: 'TIMEOUT' } as Fake], ['LEDGER_BLOCKED', { step: 'PROVIDER_FAILED', errorCode: 'LEDGER_BLOCKED_CAP' } as Fake],
    ['writer ERROR', { step: 'WRITE_FAILED', writeCode: 'ERROR' } as Fake]] as const) {
    const store = freshStore()
    const t1 = await tick({ store, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script: { 'post-1:pc-a': f }, allowed: 2 })
    check(`E 🔴 ${name} → FU_TRANSIENT · 이번 회차 남은 호출 0(다른 Persona 로 돈을 더 쓰지 않는다)`,
      t1.providerCalls === 1 && t1.created === 0 && t1.classified[0]?.code === 'FU_TRANSIENT' && t1.stoppedReason !== null,
      JSON.stringify(t1.calls))
    const iso = F.followupIsolationOf(fileOf(store).entries, NOW + MIN)
    check(`E 🔴 ${name} → Persona · 글 · 쌍 격리 0(오격리 없음)`,
      iso.personaCodes.size === 0 && iso.postIds.size === 0 && iso.postPersonaKeys.size === 0)
    const t2 = await tick({ store, nowMs: NOW + 10 * MIN, slots: slotsOf('post-1'), allowed: 1 })
    check(`E 🔴 ${name} → 다음 회차에 같은 조합을 다시 시작해 적재한다`,
      JSON.stringify(t2.calls) === JSON.stringify(['post-1:pc-a']) && t2.created === 1, JSON.stringify(t2.calls))
  }

  // ═════════ F — 모든 후보 실패 ═════════
  {
    const store = freshStore()
    const script: Script = Object.fromEntries(PERSONAS.map((p) => [`*:${p.code}`, VOICE_FAIL]))
    const t1 = await tick({ store, nowMs: NOW, slots: slotsOf('post-1', 'post-2', 'post-3'), script, allowed: 3 })
    check('F 🔴 모든 후보 실패 — 적재 0 · 호출은 Persona 수(4) 이하이고 호출 상한(6) 안',
      t1.created === 0 && t1.providerCalls === PERSONAS.length && t1.providerCalls <= F.followupPlanCap(3), JSON.stringify(t1.calls))
    check('F 🔴 같은 Persona 를 두 번 부르지 않는다', new Set(t1.calls.map((c) => c.split(':')[1])).size === t1.calls.length)
    check('F 후보가 떨어지면 이유를 남기고 멈춘다(무한 재시도 없음)', t1.lines.some((l) => l.includes('이을 수 있는 Persona 가 없다')))
    const t2 = await tick({ store, nowMs: NOW + 30 * MIN, slots: slotsOf('post-4', 'post-5'), script, allowed: 2 })
    check('F 🔴 다음 회차 — 전원 격리 · 호출 0', t2.providerCalls === 0 && t2.calls.length === 0)
  }

  // ═════════ G — 비용 · 호출 상한 ═════════
  {
    const script: Script = { 'post-1:*': TEXT_DUP, 'post-2:*': TEXT_DUP, 'post-3:*': TEXT_DUP }
    const t1 = await tick({ store: freshStore(), nowMs: NOW, slots: slotsOf('post-1', 'post-2', 'post-3'), script, allowed: 3, budget: 3 })
    check('G 🔴 호출 예산(비용 잔량 건수) 3 → 호출 정확히 3 · 그 뒤 0', t1.providerCalls === 3 && t1.calls.length === 3, JSON.stringify(t1.calls))
    check('G 🔴 한 글 시도 상한(FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK=2) — 한 글이 예산을 다 먹지 않는다',
      F.FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK === 2 && t1.calls.filter((c) => c.startsWith('post-1:')).length === 2
      && t1.calls.includes('post-2:pc-a'), JSON.stringify(t1.calls))
    const t2 = await tick({ store: freshStore(), nowMs: NOW, slots: slotsOf('post-1', 'post-2', 'post-3'), allowed: 2 })
    check('G 🔴 적재 상한 allowed=2 → 적재 2 · 호출 2 · 세 번째 글은 부르지 않는다', t2.created === 2 && t2.providerCalls === 2)
    const t3 = await tick({ store: freshStore(), nowMs: NOW, slots: slotsOf('post-1'), allowed: 2, budget: 0 })
    check('G 🔴 호출 예산 0 → 호출 0', t3.providerCalls === 0 && t3.calls.length === 0)
    check('G 🔴 계획 상한 = allowed × 2(예비 1) — 하루 USD · 공유 장부 상한은 호출 예산이 따로 묶는다', F.followupPlanCap(5) === 10 && F.followupPlanCap(0) === 0)
    // 400 — 요청 모양 거부 · 회차 멈춤 · 쌍만 막는다
    const s4 = freshStore()
    const t4 = await tick({ store: s4, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script: { 'post-1:pc-a': HTTP_400 }, allowed: 2 })
    const iso4 = F.followupIsolationOf(fileOf(s4).entries, NOW + MIN)
    check('G 🔴 HTTP_400 → FU_HALT · 회차 멈춤(다른 Persona 에 같은 모양을 다시 보내지 않는다) · 쌍만 격리',
      t4.providerCalls === 1 && t4.classified[0]?.code === 'FU_HALT' && t4.stoppedReason !== null
      && iso4.personaCodes.size === 0 && iso4.postIds.size === 0 && iso4.postPersonaKeys.has('post-1:pc-a'))
    // 시작 기록 IO 실패 — provider 0 · 회차 멈춤
    const dir = mkdtempSync(join(sandbox, 'io-'))
    const broken = createAttemptStore({
      dir, lane: F.FOLLOWUP_ATTEMPT_LANE,
      ops: { writeSync: () => { const e = new Error('EIO') as Error & { code: string }; e.code = 'EIO'; throw e } },
    })
    const t5 = await tick({ store: broken, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), allowed: 2 })
    check('G 🔴 시작 기록 IO 실패 → provider 0 · 회차 멈춤 · 아무도 격리하지 않는다',
      t5.providerCalls === 0 && t5.calls.length === 0 && t5.stoppedReason !== null && t5.classified.length === 0,
      `${t5.stoppedReason} · ${t5.warnings.join(' / ')}`)
    // 결과 기록 IO 실패 — 시작 기록(첫 rename)은 되고 결과 갱신(둘째 rename)부터 실패한다
    let renames = 0
    const half = createAttemptStore({
      dir: mkdtempSync(join(sandbox, 'io2-')), lane: F.FOLLOWUP_ATTEMPT_LANE,
      ops: { renameSync: (from: string, to: string) => {
        if (++renames >= 2) { const e = new Error('EIO') as Error & { code: string }; e.code = 'EIO'; throw e }
        return renameSync(from, to)
      } },
    })
    const t6 = await tick({ store: half, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script: { 'post-1:pc-a': VOICE_FAIL }, allowed: 2 })
    check('G 🔴 결과 기록 IO 실패 → 그 한 번 뒤 회차 멈춤(재선정 · 다음 글 호출 0) · 다음 회차는 미완(STARTED)으로 그 쌍만 막는다',
      t6.providerCalls === 1 && t6.calls.length === 1 && (t6.stoppedReason ?? '').includes('결과 기록')
      && F.followupIsolationOf(fileOf(half).entries, NOW + MIN).postPersonaKeys.has('post-1:pc-a')
      && F.followupIsolationOf(fileOf(half).entries, NOW + MIN).personaCodes.size === 0,
      `${t6.stoppedReason} · ${JSON.stringify(t6.calls)}`)
  }

  // ═════════ H — 첫 댓글 불변 ═════════
  {
    const first = freshStore(P.FIRST_COMMENT_ATTEMPT_LANE)
    let attempted = 0
    const r = await runFollowupGeneration<Slot>({
      store: first, nowMs: NOW, allowed: 3, providerCallBudget: 6, slots: slotsOf('post-1'), isolation: F.emptyFollowupIsolation(),
      planFor: () => { attempted++; return { ok: false, reason: 'x' } },
      attempt: async () => { attempted++; throw new Error('불리면 안 된다') },
    })
    check('H 🔴 첫 댓글 저장소를 받으면 planner · provider 0', r.providerCalls === 0 && attempted === 0 && r.stoppedReason !== null)
    const L = P.FIRST_COMMENT_ATTEMPT_LANE
    const e = (personaCode: string, step: import('../src/lib/persona-comment-attempt-policy').AttemptStep, codes: string[] = []) => ({
      postId: 'post-1', personaCode, reactionRole: 'empathy', postPublishedAtMs: PUB, attemptedAtMs: NOW, step, failedGates: [], blockCodes: codes,
    })
    const failedA = e('pc-a', 'PROVIDER_FAILED', ['FU_TRANSIENT'])
    check('H 🔴 첫 댓글 lane — 같은 조합은 일시 실패여도 다시 시작하지 않는다(재시작 규칙 불변)',
      !P.withAttemptStarted([failedA], e('pc-a', 'STARTED'), NOW + MIN, L).ok && L.replaceableOnRestart(failedA) === false)
    check('H 🔴 첫 댓글 lane — 실패가 같은 글의 다른 Persona 를 막지 않는다(글 격리 없음 · lane 방어선 null)',
      P.withAttemptStarted([e('pc-a', 'ENQUEUE_BLOCKED', ['FU_POST_DAY'])], e('pc-b', 'STARTED'), NOW + MIN, L).ok
      && L.startBlockedBy([e('pc-a', 'ENQUEUE_BLOCKED', ['FU_PERSONA_DAY'])], e('pc-a', 'STARTED')) === null)
    check('H 첫 댓글 lane 기억 기간 = 발행 + 60분 그대로', L.expiresAtMs({ postPublishedAtMs: PUB, attemptedAtMs: NOW }) === PUB + 60 * MIN)
    const firstLoop = readFileSync(join(here, 'lib/persona-comment-loop.mts'), 'utf-8')
    check('H 🔴 첫 댓글 회차 소스는 추가 댓글 분류 · 격리 · 재선정을 쓰지 않는다',
      !/classifyFollowupFailure|followupIsolationOf|followupPersonaCandidates|runFollowupGeneration|FOLLOWUP_ATTEMPT_LANE/.test(firstLoop))
  }

  // ═════════ I — 실회원 불변 ═════════
  {
    const withReal: Persona[] = [{ code: 'pc-r', id: 'pid-r', realMember: true }, ...PERSONAS.slice(0, 2)]
    const store = freshStore()
    const script: Script = { '*:pc-a': VOICE_FAIL, '*:pc-b': VOICE_FAIL }
    const t1 = await tick({ store, nowMs: NOW, slots: slotsOf('post-1', 'post-2'), script, personas: withReal, allowed: 2 })
    check('I 🔴 다른 후보가 전부 실패 · 격리돼도 실회원 Persona 는 부르지 않는다',
      !t1.calls.some((c) => c.endsWith(':pc-r')) && t1.created === 0, JSON.stringify(t1.calls))
    const cands = F.followupPersonaCandidates({
      postId: 'post-1', personas: factsOf(withReal), isolation: F.emptyFollowupIsolation(), usedPersonaIds: new Set(),
    })
    check('I 🔴 후보 걸러내기가 실회원을 뺀다(격리 0 이어도)', !cands.some((c) => c.personaId === 'pid-r') && cands.length === 2)
    const runSrc = readFileSync(join(here, 'lib/persona-comment-followup-run.mts'), 'utf-8')
    check('I 🔴 run 은 실회원 판정을 정본 `judgeRealMember` 로 한다(재선정이 바꾸지 않는다)',
      runSrc.includes('realMember: judgeRealMember({ accountCount: pe.user?.accountCount ?? null, providerId: pe.user?.providerId ?? null }).real'))
    check('I 🔴 run 은 글쓴이 실회원 · 외부 원문 판정(`judgePostAuthor` · externalSendAllowed)을 그대로 쓴다',
      runSrc.includes('autoManagedPost: author === null ? null : author.externalSendAllowed'))
    check('I 🔴 run 생성 경로는 실제 회원 댓글 · 글을 고치지 않는다(update · delete 0)',
      !/prisma\.(comment|post)\.(update|updateMany|delete|deleteMany|upsert)\(/.test(runSrc))
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

for (const l of lines) console.log(l)
console.log(`\n${failures === 0 ? '✅ PASS' : `❌ FAIL ${failures}`} — 추가 댓글 실패 분류 · 같은 회차 재선정 ${lines.length}개`)
process.exit(failures === 0 ? 0 : 1)
