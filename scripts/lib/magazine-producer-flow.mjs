/**
 * producer 회차의 흐름 — **주입식이다. 실제 프로세스도 네트워크도 모른다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 Codex 재검토).
 *
 *    직전 판은 "실패 회차에서도 Slack 을 반드시 시도한다" 고 적어 두고,
 *    정작 두 경로가 그 앞에서 빠져나갔다.
 *
 *      preflightTools 실패 (claude·gh 부재)  → process.exit(1)   ← 알림 없음
 *      git preflight 실패 (NOT_ON_MAIN 등)   → process.exit(1)   ← 알림 없음
 *
 *    회귀 테스트는 있었지만 **소스에서 `runNotify()` 의 위치만** 봤다.
 *    그래서 "runNotify 가 judgeProducerRun 보다 앞이다" 는 통과하는데,
 *    **그 줄에 도달하지 못하는 경로**는 아무도 보지 않았다.
 *    위치 검사는 흐름을 시험하지 못한다 — 흐름은 흐름으로 시험한다.
 *
 * 🔴 **그래서 종료 경로를 하나로 모은다.**
 *    어떤 이유로 끝나든 `finalize()` 를 지난다. 알림은 거기 한 곳에만 있다.
 *    새 중단 사유가 생겨도 `finalize` 를 거치지 않으면 값을 돌려줄 수 없다.
 *
 * 🔴 **알림은 정확히 한 번 시도한다.** 두 번 보내면 사람이 로그를 못 믿는다.
 * 🔴 **알림 결과는 종료 코드를 바꾸지 않는다.** 양방향으로 —
 *    알림이 실패해도 원래 실패는 실패이고, 성공 회차가 실패가 되지도 않는다.
 * 🔴 **알림을 보내려고 파일을 쓰거나 AI 를 부르지 않는다.**
 *    중단 경로에서는 plan·brief·fetch 를 **한 번도 호출하지 않는다.**
 */
import { judgeProducerRun, stage } from './magazine-producer-exit.mjs'
import { SEVERITY } from './magazine-outstanding.mjs'

/**
 * 한 회차를 끝까지 몬다.
 *
 * @param {object} p
 * @param {boolean} p.dryRun
 * @param {object} p.deps  전부 주입받는다 — 테스트가 실제 git·gh·claude·Slack 없이 돈다
 *   @param {() => {ok:boolean, blockedBy?:object[], found?:object}} p.deps.checkTools
 *   @param {() => {ok:boolean, blockedBy?:object[], fastForwarded?:boolean}} p.deps.checkGit
 *   @param {() => object} p.deps.checkOutstanding
 *   @param {() => {spawnError?:string|null, status?:number|null}} p.deps.runPlan
 *   @param {() => {spawnError?:string|null, status?:number|null}} p.deps.runBrief
 *   @param {() => {spawnError?:string|null, status?:number|null}} p.deps.runFetch
 *   @param {(ctx:object) => Promise<{ok:boolean, reason?:string}>|{ok:boolean, reason?:string}} p.deps.notify
 *   @param {(msg:string) => void} [p.deps.log]
 * @returns {Promise<{code:number, verdict:string, reason:string, notify:object, ran:string[]}>}
 */
export async function runProducerFlow({ dryRun = false, deps }) {
  const log = deps.log ?? (() => {})
  /** 🔴 실제로 부른 단계. 중단 경로에서 비어 있어야 한다 (write·AI 0건의 증거) */
  const ran = []

  let notified = null
  /**
   * 🔴 **단 하나의 종료 자리.** 알림은 여기에만 있고, 여기서만 한 번 돈다.
   */
  const finalize = async ({ preflight = null, outstanding = null, plan, brief, fetch }) => {
    const verdict = judgeProducerRun({
      preflight,
      outstanding,
      plan: plan ?? stage('plan', { skipped: true }),
      brief: brief ?? stage('brief', { skipped: true }),
      fetch: fetch ?? stage('fetch', { skipped: true }),
    })

    if (notified === null) {
      try {
        notified = (await deps.notify({ verdict, outstanding, preflight, dryRun })) ?? { ok: true }
      } catch (e) {
        // 🔴 알림이 던져도 삼킨다. 알림 때문에 회차 판정이 바뀌면 안 된다.
        notified = { ok: false, reason: String(e?.message ?? e) }
      }
      if (!notified.ok) log(`알림 실패 — 판정에 반영하지 않는다 (${notified.reason ?? '사유 없음'})`)
    }

    // 🔴 notified 를 본 뒤에도 code 는 verdict 것 그대로다. 덮어쓰지 않는다.
    return { code: verdict.code, verdict: verdict.verdict, reason: verdict.reason, failures: verdict.failures, notify: notified, ran }
  }

  // ── 시작 전 검사 — 🔴 **파일도 AI 도 건드리기 전에** ──────
  if (!dryRun) {
    // 🔴 **잠금이 맨 앞이다.** 다른 회차가 돌고 있으면 도구·git 조회조차 하지 않는다.
    //    그리고 이 경로도 finalize 를 지난다 — 잠금 실패도 Slack 으로 알린다.
    //    (2026-09-16: 잠금을 flow 밖에서 process.exit 로 처리했다가
    //     "모든 종료 경로가 단일 finalizer 를 지난다" 계약을 스스로 깼다)
    const lock = deps.checkLock ? deps.checkLock() : { ok: true }
    if (!lock.ok) {
      log(`🔒 ${lock.code}: ${lock.message}`)
      return finalize({ preflight: { ok: false, stage: 'lock', blockedBy: [{ code: lock.code, message: lock.message }] } })
    }

    const tools = deps.checkTools()
    if (!tools.ok) {
      for (const b of tools.blockedBy ?? []) log(`🔴 ${b.code}: ${b.message}`)
      return finalize({ preflight: { ok: false, stage: 'tools', blockedBy: tools.blockedBy ?? [] } })
    }

    const git = deps.checkGit()
    if (!git.ok) {
      for (const b of git.blockedBy ?? []) log(`🔴 ${b.code}: ${b.message}`)
      log('  → 첫 write 전에 멈췄다. 파일 변경 0건.')
      return finalize({ preflight: { ok: false, stage: 'git', blockedBy: git.blockedBy ?? [] } })
    }
    log(`git: main · origin/main 동기${git.fastForwarded ? ' (ff-only 로 따라붙음)' : ''}`)

    const outstanding = deps.checkOutstanding()
    if (!outstanding.ok) {
      log(`${outstanding.severity === SEVERITY.HOLD ? '⏸' : '🔴'} ${outstanding.code}: ${outstanding.message}`)
      log('  → 선정·brief·원고 회수를 시작하지 않는다. 파일 변경 0건 · AI 호출 0건.')
      return finalize({ outstanding })
    }
    log(`미해결 자동 작업: 없음 — ${outstanding.message}`)
  }

  // ── 1) 선정 ─────────────────────────────────────────────
  let planStage = stage('plan', { skipped: true })
  if (dryRun) log('dry-run — producer 를 실행하지 않는다')
  else {
    ran.push('plan')
    const r = deps.runPlan()
    planStage = stage('plan', { spawnError: r.spawnError ?? null, status: r.status ?? null })
    if (planStage.spawnError) log(`producer 실행 자체가 실패했다: ${planStage.spawnError}`)
    else log(`producer 종료 코드 ${planStage.status}`)
  }
  const planOk = planStage.skipped || (!planStage.spawnError && planStage.status === 0)
  /** 🔴 아래에서 공급 상태를 읽어 brief 호출 여부를 정한다 */

  /**
   * 🔴 **selected 0 이면 brief 를 부르지 않는다** (2026-09-28 공급 0건).
   *
   *    그날 producer 는 선정 0건으로 끝났는데도 brief 를 불렀고,
   *    `_runs/2026-09-28/selected` 가 없어 **종료 코드 2(SYSTEM)** 로 실패했다.
   *    그 SYSTEM 실패가 회차 전체를 실패로 물들였다 — 만들 것이 없었을 뿐인데.
   *
   *    이제 셋을 구분한다:
   *      NEW_WORK    새로 만들 주제가 있다 → brief 를 부른다
   *      REUSE_READY 새로 만들 것은 없지만 **기존 재료가 있다** → auto-register 로 넘긴다
   *      NO_WORK     큐가 비었다 → 정상적으로 아무것도 하지 않는다
   */
  const supply = deps.readSupply ? deps.readSupply() : { selected: null, reusable: 0, queue: null }
  const selectedCount = Number.isFinite(supply.selected) ? supply.selected : null
  const reusableCount = Number.isFinite(supply.reusable) ? supply.reusable : 0
  const supplyState = selectedCount === null
    ? 'UNKNOWN'
    : selectedCount > 0 ? 'NEW_WORK' : (reusableCount > 0 ? 'REUSE_READY' : 'NO_WORK')
  if (supplyState !== 'UNKNOWN' && supplyState !== 'NEW_WORK') {
    log(`선정 0건 — ${supplyState === 'REUSE_READY'
      ? `기존 재료 ${reusableCount}건이 있다. brief 를 부르지 않고 auto-register 로 넘긴다`
      : '큐에 만들 것이 없다 (정상 no-work)'}`)
  }

  // ── 2) brief 생성 (AI 호출) ──────────────────────────────
  let briefStage = stage('brief', { skipped: true })
  if (dryRun) log('dry-run — brief 생성을 실행하지 않는다')
  else if (!planOk) log('producer 가 실패해 brief 생성을 건너뛴다')
  else if (supplyState === 'REUSE_READY' || supplyState === 'NO_WORK') {
    // 🔴 없는 selected 경로로 brief 를 부르지 않는다 — 그 호출이 SYSTEM 실패를 만들었다
    briefStage = stage('brief', { skipped: true, reason: supplyState })
  }
  else {
    ran.push('brief')
    const r = deps.runBrief()
    briefStage = stage('brief', { spawnError: r.spawnError ?? null, status: r.status ?? null })
    if (briefStage.spawnError) log(`🔴 brief 생성을 실행하지 못했다 (${briefStage.spawnError}) — claude 가 PATH 에 없을 수 있다`)
    else if (briefStage.status === 0) log('brief 생성 완료')
    else if (briefStage.status === 2) log('🔴 brief 생성이 사용법/시스템 오류로 끝났다 (종료 코드 2)')
    else log('brief 게이트에 막힌 건이 있다 — 회차 자체는 계속한다')
  }

  // ── 3) 원고 회수 ────────────────────────────────────────
  let fetchStage = stage('fetch', { skipped: true })
  if (dryRun) log('dry-run — 원고 회수를 실행하지 않는다')
  else if (!planOk) log('producer 가 실패해 원고 회수를 건너뛴다')
  else {
    ran.push('fetch')
    const r = deps.runFetch()
    fetchStage = stage('fetch', { spawnError: r.spawnError ?? null, status: r.status ?? null })
    if (fetchStage.spawnError) log(`🔴 원고 회수를 실행하지 못했다 (${fetchStage.spawnError})`)
    else if (fetchStage.status === 0) log('원고 회수 완료')
    else log('🔴 원고 회수 전역 실패 — ChatGPT 접근 또는 브라우저 시작에 실패했다')
  }

  return finalize({ plan: planStage, brief: briefStage, fetch: fetchStage })
}

/**
 * HOLD·실패 회차에 보낼 Slack 문구를 만든다. **발송하지 않는다.**
 *
 * 🔴 **OPEN 자동 PR 이면 번호와 URL 이 반드시 들어간다.**
 *    로그에만 있고 Slack 에 없으면 창업자는 무엇을 merge 해야 하는지 모른 채
 *    "또 HOLD 네" 만 보게 된다. 그 순간 이 알림은 읽히지 않는 알림이 된다.
 */
export function composeProducerMessage({ verdict, outstanding, preflight }) {
  const hold = outstanding && outstanding.severity === SEVERITY.HOLD
  const severity = verdict.code === 0 ? (hold ? 'INFO' : 'INFO') : 'ERROR'

  if (hold && outstanding.pr) {
    return {
      severity,
      title: `매거진 producer HOLD — 자동 PR #${outstanding.pr.number} 이 열려 있다`,
      reason: `${outstanding.code} · merge 또는 명시적 폐기 전 다음 생산 HOLD`,
      next: outstanding.pr.url,
    }
  }
  if (hold) {
    return {
      severity,
      title: '매거진 producer HOLD — 미해결 자동 작업이 있다',
      reason: `${outstanding.code} · merge 또는 명시적 폐기 전 다음 생산 HOLD`,
      next: outstanding.message,
    }
  }
  if (outstanding && !outstanding.ok) {
    return {
      severity: 'ERROR',
      title: '매거진 producer 중단 — 미해결 자동 브랜치',
      reason: `${outstanding.code}: ${outstanding.message}`,
      next: '사람이 PR 을 열거나 브랜치를 지운다',
    }
  }
  if (preflight && !preflight.ok) {
    return {
      severity: 'ERROR',
      title: `매거진 producer 중단 — 시작 전 검사 실패 (${preflight.stage})`,
      reason: (preflight.blockedBy ?? []).map((b) => `${b.code}: ${b.message}`).join(' / '),
      next: '파일 변경 0건 · AI 호출 0건 — 원인을 고친 뒤 다음 회차를 기다린다',
    }
  }
  return {
    severity: 'ERROR',
    title: '매거진 producer 실패',
    reason: verdict.reason,
    next: '로그 확인: ~/Library/Logs/soransoran/magazine-producer.log',
  }
}
