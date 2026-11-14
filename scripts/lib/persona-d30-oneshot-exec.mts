/**
 * D30 1회 투입 **실행 순서** — 🔴 잠금을 잡은 뒤의 순서만. 효과(DB·정본 명령·표식)는 주입받는다
 *    운영 CLI(`persona-d30-oneshot.mts`)와 격리 DB 통합 검사가 **같은 함수**를 부른다.
 *
 * 순서 계약
 *   ① 다시 관측·판정. GO 면 ③. 정확히 39/39 + 다른 게이트 전부 통과(`remediationEligible`)면 ②. 그 밖은 write 0
 *   ② 표식 started(phase p15) → P15 교정 → 다시 관측·판정(표식 자기 자신 제외). GO(40/40) 가 아니면 held · cohort write 0
 *      🔴 교정이 성공하고 뒤가 실패해도 P15 교정은 **남는다** — 정본 일치는 운영 개선이지 투입의 일부가 아니다
 *   ③ 기존 40 지문 기준점(교정 **뒤**) · 관리자 1 확인 → 표식 started → seed 파일 → create → seed → check → activate
 *   ④ 결과 판정(`judgeOutcome`). PASS 아니면 새 cohort 만 pause(active 가 있을 때) 아니면 held
 */
import { COHORT_CODES, judgeOneShot, judgeOutcome, remediationEligible, type OneShotFacts, type MarkerState } from './persona-d30-oneshot.mjs'

export type Step = 'seed-file' | 'create' | 'seed' | 'check-before-activate' | 'activate' | 'check-after-activate'
export type ExecEffects = {
  gather: () => Promise<OneShotFacts>
  writeMarker: (state: NonNullable<MarkerState>['state'], extra?: Record<string, unknown>) => void
  remediate: () => Promise<boolean>
  step: (s: Step, actorId: string | null) => Promise<boolean>
  pause: (actorId: string, why: string) => Promise<boolean>
  cohortStatuses: () => Promise<Map<string, string>>
  adminIds: () => Promise<string[]>
  old40Fingerprint: () => Promise<string>
  counts: () => Promise<{ totalActive: number; cohortActive: number }>
  capacity: () => Promise<{ contractValid: number | null; stageActive: number | null }>
  log: (event: string, data?: Record<string, unknown>) => void
}
export type ExecResult = { exit: number; result: string; why?: string }

export async function executeOneShot(fx: ExecEffects): Promise<ExecResult> {
  let facts = await fx.gather()
  let v = judgeOneShot(facts)
  if (!v.go && remediationEligible(v, facts)) {
    fx.writeMarker('started', { phase: 'p15-remediation' })
    const fixed = await fx.remediate().catch(() => false)
    facts = await fx.gather()
    v = judgeOneShot({ ...facts, marker: null })
    fx.log('after-remediation', { fixed, code: v.code, capacity: facts.capacity })
    if (!fixed || !v.go) {
      const why = `P15_REMEDIATION_${fixed ? v.code : 'FAILED'}`
      fx.writeMarker('held', { why })
      return { exit: 3, result: 'NO_GO_AFTER_REMEDIATION', why }
    }
  } else if (!v.go) return { exit: 3, result: 'NO_GO_IN_LOCK', why: v.code }

  const old40Before = await fx.old40Fingerprint()
  const admins = await fx.adminIds()
  if (admins.length !== 1) return { exit: 3, result: 'NO_GO_IN_LOCK', why: 'ACTOR' }
  const actor = admins[0]!
  fx.writeMarker('started', { phase: 'cohort' })

  const stop = async (why: string): Promise<ExecResult> => {
    const st = await fx.cohortStatuses().catch(() => null)
    const active = st === null ? COHORT_CODES.length : [...st.values()].filter((s) => s === 'active').length
    fx.log('stop', { why, cohortRows: st?.size ?? null, cohortActive: st === null ? null : active })
    if (active > 0) {
      const paused = await fx.pause(actor, why).catch(() => false)
      fx.writeMarker(paused ? 'paused' : 'failed', { why, pauseOk: paused })
      return { exit: 4, result: paused ? 'PAUSED_NEW_COHORT' : 'PAUSE_FAILED', why }
    }
    fx.writeMarker('held', { why, cohortRows: st?.size ?? null })
    return { exit: 4, result: 'HELD', why }
  }
  const run = (s: Step, a: string | null = null): Promise<boolean> => fx.step(s, a).catch(() => false)

  if (!(await run('seed-file'))) return stop('SEED_FILE')
  if (!(await run('create'))) return stop((await fx.cohortStatuses().catch(() => new Map())).size === COHORT_CODES.length ? 'CREATE_POSTCHECK' : 'CREATE')
  if (!(await run('seed'))) return stop('SEED')
  if (!(await run('check-before-activate'))) return stop('CHECK')
  const act = await run('activate', actor)
  const activated = [...(await fx.cohortStatuses()).values()].filter((s) => s === 'active').length === COHORT_CODES.length
  if (!act && !activated) return stop('ACTIVATE')

  try {
    const checkOk = await run('check-after-activate')
    const c = await fx.counts()
    const old40Same = (await fx.old40Fingerprint()) === old40Before
    const cap = await fx.capacity()
    const outcome = judgeOutcome({ activated, contractValid: cap.contractValid, stageActive: cap.stageActive, totalActive: c.totalActive, cohortActive: c.cohortActive, old40Same, checkOk })
    fx.log('outcome', { code: outcome.code, problems: outcome.problems, ...cap, ...c, old40Same, checkOk })
    if (outcome.code !== 'PASS') return stop(`OUTCOME_${outcome.code}`)
    fx.writeMarker('done', { ...cap, ...c })
    return { exit: 0, result: 'PASS' }
  } catch (e) {
    // 🔴 켠 뒤 판정 중 예외 — PASS 가 아니다. 새 cohort 만 멈춘다
    return stop(`OUTCOME_ERROR:${(e as Error).message.slice(0, 80)}`)
  }
}
