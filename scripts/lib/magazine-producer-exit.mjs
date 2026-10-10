/**
 * producer 회차의 종료 코드 판정 — **순수 함수다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 Codex 마스터 검토 P0-2).
 *
 *    `magazine-producer-run.mjs` 는 brief 생성 실패와 원고 회수 실패를 **삼키고**
 *    마지막에 `planCode` 만 돌려줬다. 그래서 이런 회차가 **성공(exit 0)** 으로 남는다.
 *
 *      · ChatGPT 로그인이 만료돼 원고를 한 건도 못 받음      → exit 0
 *      · Chrome 이 안 떠서 회수기가 시작조차 못 함           → exit 0
 *      · claude 가 PATH 에 없어 brief 생성이 통째로 죽음     → exit 0
 *
 *    `launchctl print` 의 last exit status 만 보는 사람은 이것을 정상으로 읽는다.
 *    2026-09-03 이후 12일을 못 알아챈 것과 같은 종류의 눈가림이다.
 *
 * 🔴 **그러나 "일부 slug 가 막힌 것" 은 실패가 아니다.**
 *    관문(`magazine-manuscript-guard`)이 오염된 원고 하나를 막는 것은 **정상 동작**이고,
 *    그날 5건 중 3건만 받은 것도 정상이다. 이것을 실패로 만들면 매일 붉은 불이 켜지고,
 *    그 순간 종료 코드는 다시 아무 의미가 없어진다.
 *
 *    그래서 **시스템 실패**와 **콘텐츠 판정**을 가른다.
 *      시스템  프로세스를 띄우지 못함 · 사용법 오류(2) · 회수기의 전역 실패(fatal)
 *      콘텐츠  게이트에 막힌 slug 가 있음 (brief-auto 1 · 회수기의 개별 skip)
 *
 * 🔴 자식들의 종료 코드 계약 (각 스크립트에 이미 있는 것을 그대로 쓴다)
 *      magazine-producer-plan      0 정상 · 그 외 실패
 *      magazine-brief-auto         0 전부 통과 · 1 게이트에 막힌 건 있음 · 2 사용법/시스템
 *      magazine-webui-runner       0 정상(개별 skip 포함) · 1 **전역 실패만** · 2 사용법
 *        (전역 = Cloudflare · 로그인 만료 · Chrome 없음 · 브라우저 없음 · 권한 · 연결 실패)
 *
 * 🔴 Slack 은 이 판정을 바꾸지 않는다. 알림이 실패해도 원래 실패는 실패다.
 */

/**
 * 🔴 **입력 수리 미해결은 성공 회차가 아니다** (2026-10-10 Codex P1).
 *    앞판은 수리 단계의 종료 코드만 로그에 남기고 판정에 넣지 않았다. 수리가 실패·REJECTED·전송불명이어도
 *    회차는 OK · exit 0 이었고, Slack 도 handoff 도 그 사실을 몰랐다.
 *    이제 수리 결과 파일을 구조화해 받아 **PARTIAL(종료 코드 3)** 로 남긴다.
 *    원고 회수는 그대로 돌고(판정만 다르다), handoff 는 SYSTEM 이 아니므로 등록은 기존 정책대로 진행한다.
 */
export const PARTIAL_EXIT = 3
/** 고쳐지지 않은 채 남은 결과 — 사람이 봐야 한다 */
export const REPAIR_UNRESOLVED = Object.freeze(['FAILED', 'REJECTED', 'DELIVERY_UNCERTAIN', 'REPAIR_EXHAUSTED', 'HELD'])

/**
 * 수리 단계의 실행 결과 + 구조화 결과(report) → 판정·알림·handoff 가 쓰는 요약. **순수 함수다.**
 * 🔴 결과를 못 읽으면 "문제없음" 이 아니라 REPAIR_RESULT_MISSING 이다.
 */
export function summarizeRepairStage({ spawnError = null, status = null, report = null }) {
  const failures = []
  if (spawnError) failures.push({ slug: null, type: null, outcome: 'REPAIR_STAGE_FAILED', reason: `실행하지 못했다 (${spawnError})` })
  else if (!report || typeof report !== 'object') failures.push({ slug: null, type: null, outcome: 'REPAIR_RESULT_MISSING', reason: `구조화 결과를 읽지 못했다 (종료 코드 ${status})` })
  else {
    if (report.ok === false) failures.push({ slug: null, type: null, outcome: report.code ?? 'REPAIR_STAGE_FAILED', reason: report.why ?? '' })
    for (const r of report.recovered ?? []) {
      if (r && r.recovered === false && r.code) failures.push({ slug: r.slug ?? null, type: 'JOURNAL', outcome: r.code, reason: r.why ?? '' })
    }
    for (const r of report.results ?? []) {
      if (REPAIR_UNRESOLVED.includes(r?.outcome)) failures.push({ slug: r.slug ?? null, type: r.type ?? null, outcome: r.outcome, reason: r.reason ?? '' })
    }
    if (status !== 0 && failures.length === 0) failures.push({ slug: null, type: null, outcome: 'REPAIR_STAGE_FAILED', reason: `종료 코드 ${status}` })
  }
  return {
    ran: true, spawnError, status,
    resultFile: report?.resultFile ?? null,
    applied: (report?.results ?? []).filter((r) => r?.outcome === 'APPLIED').map((r) => r.slug),
    failures,
  }
}

const repairList = (repair) => (repair?.failures ?? []).map((f) => `${f.slug ?? '입력 수리'}(${f.outcome})`).join(' · ')

/** 한 단계의 결과 — 자식을 띄우지 못한 경우와 종료 코드를 구분한다 */
export const stage = (name, { spawnError = null, status = null, skipped = false, note = null } = {}) => ({
  name, spawnError, status, skipped, note,
})

/**
 * 회차 전체를 판정한다.
 *
 * @param {object} p
 * @param {ReturnType<typeof stage>} p.plan
 * @param {ReturnType<typeof stage>} p.brief
 * @param {ReturnType<typeof stage>} p.fetch
 * @param {{code:string, severity:string}|null} [p.outstanding]  HOLD/FAILURE 판정 (있으면 그것이 먼저다)
 * @param {ReturnType<typeof summarizeRepairStage>|null} [p.repair]  입력 수리 요약 (돌지 않았으면 null)
 * @returns {{code:number, verdict:'OK'|'HOLD'|'CONTENT'|'PARTIAL'|'SYSTEM', reason:string, failures:string[]}}
 */
export function judgeProducerRun({ plan, brief, fetch, outstanding = null, preflight = null, repair = null }) {
  // ── 시작 전 검사가 막혔으면 그것이 먼저다 ────────────────
  //
  // 🔴 도구 부재(claude·gh)와 git 상태(NOT_ON_MAIN·DIRTY_TREE)는 **시스템 실패**다.
  //    이 판정을 여기 두는 이유는 하나다 — 그래야 종료 경로가 하나로 모이고,
  //    그 하나에 Slack 알림이 달린다. 옛 판은 이 둘이 `process.exit(1)` 로 빠져나가
  //    "실패 회차에서도 알린다" 는 계약이 실제로는 성립하지 않았다 (2026-09-16 재검토).
  if (preflight && !preflight.ok) {
    const codes = (preflight.blockedBy ?? []).map((b) => b.code)
    return {
      code: 1,
      verdict: 'SYSTEM',
      reason: (preflight.blockedBy ?? []).map((b) => `${b.code}: ${b.message}`).join(' / ') || 'preflight 실패',
      failures: codes.length ? codes : ['PREFLIGHT_FAILED'],
    }
  }

  // ── 미해결 작업이 있으면 그 판정이 먼저다 ──────────────────
  if (outstanding && outstanding.severity === 'FAILURE') {
    return { code: 1, verdict: 'SYSTEM', reason: outstanding.code, failures: [outstanding.code] }
  }
  if (outstanding && outstanding.severity === 'HOLD') {
    // 🔴 HOLD 는 실패가 아니다. 사람이 PR 을 처리하기를 기다리는 정상 상태다.
    return { code: 0, verdict: 'HOLD', reason: outstanding.code, failures: [] }
  }

  const failures = []
  const systemFail = (s, why) => failures.push(`${s.name}: ${why}`)

  // ── plan ────────────────────────────────────────────────
  // 🔴 선정이 실패하면 뒤는 의미가 없다. 무조건 시스템 실패다.
  // 🔴 `skipped` 를 반드시 먼저 본다 — dry-run 은 세 단계를 전부 건너뛰므로
  //    status 가 null 이다. 그것을 실패로 읽으면 dry-run 이 매번 SYSTEM 이 된다.
  if (!plan.skipped) {
    if (plan.spawnError) systemFail(plan, `실행하지 못했다 (${plan.spawnError})`)
    else if (plan.status !== 0) systemFail(plan, `종료 코드 ${plan.status}`)
  }

  // ── brief 생성 ──────────────────────────────────────────
  if (!brief.skipped) {
    if (brief.spawnError) systemFail(brief, `실행하지 못했다 (${brief.spawnError}) — claude 가 PATH 에 없을 수 있다`)
    else if (brief.status === 2) systemFail(brief, '사용법/시스템 오류 (종료 코드 2)')
    // status 1 = 일부 slug 가 게이트에 막혔다 → 콘텐츠 판정. 시스템 실패가 아니다.
  }

  // ── 원고 회수 ───────────────────────────────────────────
  if (!fetch.skipped) {
    if (fetch.spawnError) systemFail(fetch, `실행하지 못했다 (${fetch.spawnError})`)
    else if (fetch.status === 2) systemFail(fetch, '사용법/시스템 오류 (종료 코드 2)')
    else if (fetch.status !== 0) {
      // 🔴 회수기는 **전역 실패에만** 1 을 낸다 — ChatGPT 접근 실패 · 브라우저 시작 실패 등.
      //    개별 slug 실패는 0 으로 끝난다. 그래서 1 은 곧 시스템 실패다.
      systemFail(fetch, '전역 실패 — ChatGPT 접근 또는 브라우저 시작에 실패했다')
    }
  }

  const unresolved = repair?.failures ?? []
  if (failures.length > 0) {
    // 🔴 시스템 실패가 먼저다 — 다만 수리 미해결도 이유에서 지우지 않는다
    const note = unresolved.length ? ` / 입력 수리 미해결: ${repairList(repair)}` : ''
    return { code: 1, verdict: 'SYSTEM', reason: `${failures.join(' / ')}${note}`, failures }
  }

  const blocked = brief.status === 1
  if (unresolved.length > 0) {
    return {
      code: PARTIAL_EXIT,
      verdict: 'PARTIAL',
      reason: `입력 수리 미해결 ${unresolved.length}건 — ${repairList(repair)}${repair.resultFile ? ` · 결과 ${repair.resultFile}` : ''}${blocked ? ' · 일부 건이 brief 게이트에 막혔다' : ''}`,
      failures: unresolved.map((f) => `repair: ${f.slug ?? '입력 수리'} ${f.outcome}${f.reason ? ` — ${f.reason}` : ''}`),
    }
  }

  // 🔴 여기부터는 전부 정상 종료다. 게이트에 막힌 건이 있어도 회차는 성공이다.
  return {
    code: 0,
    verdict: blocked ? 'CONTENT' : 'OK',
    reason: blocked ? '일부 건이 brief 게이트에 막혔다 (회차 자체는 정상)' : '정상',
    failures: [],
  }
}
