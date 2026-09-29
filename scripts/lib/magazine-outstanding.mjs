/**
 * 미해결 자동 작업 판정 — 🔴 **한 번에 하나만 돈다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 Codex 마스터 검토 P0-1).
 *
 *    복구판은 자동 PR 을 만든 뒤 runtime 을 main 으로 되돌린다. 그 자체는 옳다 —
 *    그래야 다음 회차가 `NOT_ON_MAIN` 으로 멈추지 않는다.
 *    그런데 **PR 이 아직 merge 되지 않은 상태**에서 다음 날 회차가 돌면 이렇게 된다.
 *
 *      Day 1  producer 가 `autumn-low-mood` 선정 → 원고 → register → PR #A (OPEN)
 *             runtime 은 main 으로 복귀. main 의 articles.ts 에는 **아직 그 글이 없다.**
 *      Day 2  producer 가 articles.ts 를 다시 읽는다 → `autumn-low-mood` 가 없다
 *             → **같은 slug 를 또 선정**하고, 슬롯 계산도 **같은 빈 날짜**를 고른다
 *             → PR #B 가 같은 원고를 같은 날짜로 또 등록한다
 *
 *    두 PR 을 다 merge 하면 같은 slug 가 두 번 등록되거나 슬롯이 겹친다.
 *    `register.mjs` 의 중복 가드는 **main 의 articles.ts** 를 보므로 이것을 막지 못한다 —
 *    PR 안의 변경은 아직 main 에 없기 때문이다.
 *
 * 🔴 **그래서 계약은 하나다 — 미해결 자동 작업은 동시에 최대 1개.**
 *    이전 것을 merge 하거나 **명시적으로 폐기**하기 전에는 다음 회차가 HOLD 한다.
 *    producer 와 auto-register 가 **같은 이 함수**를 쓴다. 판정이 두 벌이면 갈라진다.
 *
 * 🔴 **commit ancestry 로 판단하지 않는다.**
 *    squash merge 는 PR 의 커밋을 main 에 남기지 않는다. `merge-base --is-ancestor` 로 보면
 *    merge 된 PR 이 영원히 "미해결" 로 남아 레인이 죽는다.
 *    **GitHub 의 PR state(MERGED)** 가 정본이다.
 *
 * 🔴 **모르면 멈춘다(fail closed).**
 *    GitHub 을 읽지 못하면 "미해결이 없다" 가 아니라 "확정할 수 없다" 다.
 *    확정하지 못한 채 새 PR 을 만들면 중복을 막을 방법이 없다.
 *
 * 🔴 이 모듈은 파일을 쓰지 않고 자식 프로세스를 직접 띄우지 않는다.
 *    `exec` 를 주입받는다 — 회귀 테스트가 실제 gh·git 없이 전 분기를 돈다.
 */

/** 자동 레인이 만드는 브랜치의 접두. `magazine-auto-git.mjs` 의 branchName() 과 같은 값이다 */
export const AUTO_BRANCH_PREFIX = 'feat/magazine-auto-register-'

export const isAutoBranch = (name) => String(name ?? '').startsWith(AUTO_BRANCH_PREFIX)

/**
 * 심각도 두 가지.
 *
 *   HOLD     정상이다. 사람이 아직 PR 을 처리하지 않았을 뿐 — 종료 코드 0
 *   FAILURE  운영 이상이다. 사람이 봐야 한다 — 종료 코드 non-zero
 */
export const SEVERITY = { HOLD: 'HOLD', FAILURE: 'FAILURE' }

/**
 * 지금 새 회차를 시작해도 되는가. **아무것도 읽지 않는다 — 넘겨받은 값만 본다.**
 *
 * @param {object} p
 * @param {boolean} p.queryOk            GitHub 상태를 읽었는가
 * @param {{number:number,url:string,headRefName:string,state:'OPEN'|'MERGED'|'CLOSED'}[]} p.prs
 * @param {string[]} p.remoteBranches     origin 의 자동 브랜치
 * @param {string[]} p.localBranches      runtime 의 자동 브랜치
 * @returns {{ok:boolean, code:string, severity:string|null, message:string, pr:object|null, branches:string[]}}
 */
export function judgeOutstanding({ queryOk, prs = [], remoteBranches = [], localBranches = [] }) {
  const autoPrs = prs.filter((p) => isAutoBranch(p.headRefName))
  const remote = remoteBranches.filter(isAutoBranch)
  const local = localBranches.filter(isAutoBranch)

  // ── ④ 확정할 수 없으면 멈춘다 ────────────────────────────
  // 🔴 맨 앞에 둔다. 읽지 못한 목록으로 "없다" 를 말할 수는 없다.
  if (!queryOk) {
    return {
      ok: false,
      code: 'GITHUB_QUERY_FAILED',
      severity: SEVERITY.FAILURE,
      message: 'GitHub 에서 자동 PR 상태를 읽지 못했다 — 미해결 작업 유무를 확정할 수 없어 시작하지 않는다',
      pr: null,
      branches: [],
    }
  }

  // ── ① OPEN 자동 PR ─────────────────────────────────────
  // 🔴 정상 HOLD 다. 사람이 merge 하면 다음 회차가 그냥 진행된다.
  const open = autoPrs.find((p) => p.state === 'OPEN')
  if (open) {
    return {
      ok: false,
      code: 'OUTSTANDING_PR',
      severity: SEVERITY.HOLD,
      message: `자동 PR #${open.number} 이 아직 열려 있다 — merge 하거나 폐기하기 전에는 다음 회차를 시작하지 않는다 (${open.url})`,
      pr: open,
      branches: [open.headRefName],
    }
  }

  // ── CLOSED(미merge) 인데 브랜치가 남아 있다 ──────────────
  // 🔴 **"명시적 폐기" 의 신호를 브랜치 삭제로 정한다.**
  //    PR 만 닫고 브랜치를 남겨 두면 되살릴 수 있는 상태다 — 그것을 해소로 보면
  //    사람이 "아직 안 끝났다" 고 생각하는 작업 위에 새 PR 이 얹힌다.
  //    브랜치를 지우면 그 회차는 없던 일이 되고, 다음 회차가 진행된다.
  const closedWithBranch = autoPrs.find(
    (p) => p.state === 'CLOSED' && (remote.includes(p.headRefName) || local.includes(p.headRefName)),
  )
  if (closedWithBranch) {
    return {
      ok: false,
      code: 'ABANDONED_PR_BRANCH',
      severity: SEVERITY.HOLD,
      message:
        `PR #${closedWithBranch.number} 이 merge 없이 닫혔는데 브랜치 ${closedWithBranch.headRefName} 가 남아 있다 — ` +
        '폐기를 확정하려면 그 브랜치를 지운다 (그때까지 다음 회차는 HOLD)',
      pr: closedWithBranch,
      branches: [closedWithBranch.headRefName],
    }
  }

  // ── ② push 됐는데 PR 이 없는 원격 브랜치 ─────────────────
  // 🔴 **운영 실패다.** 정확히 "push 성공 · PR 생성 실패" 회차가 남기는 모양이다.
  //    사람이 PR 을 열거나 브랜치를 지워야 한다. 조용히 넘어가면 그 원고가 영영 뜬다.
  const known = new Set(autoPrs.map((p) => p.headRefName))
  const orphanRemote = remote.filter((b) => !known.has(b))
  if (orphanRemote.length > 0) {
    return {
      ok: false,
      code: 'ORPHAN_REMOTE_BRANCH',
      severity: SEVERITY.FAILURE,
      message:
        `origin 에 PR 없는 자동 브랜치가 있다: ${orphanRemote.join(', ')} — ` +
        'push 는 됐는데 PR 이 열리지 않은 회차다. 사람이 PR 을 열거나 브랜치를 지운다',
      pr: null,
      branches: orphanRemote,
    }
  }

  // ── ③ runtime 에 남은 미해결 로컬 브랜치 ──────────────────
  // 🔴 PR 이 **한 번도 없었던** 로컬 브랜치만 본다. push 자체가 실패한 회차다.
  //    merge 된 PR 의 로컬 브랜치는 남아 있어도 해소된 것이다 — 우리는 브랜치를 지우지 않는다.
  const orphanLocal = local.filter((b) => !known.has(b))
  if (orphanLocal.length > 0) {
    return {
      ok: false,
      code: 'ORPHAN_LOCAL_BRANCH',
      severity: SEVERITY.FAILURE,
      message:
        `runtime 에 PR 도 origin 도 없는 자동 브랜치가 있다: ${orphanLocal.join(', ')} — ` +
        'push 가 실패한 회차다. 사람이 내용을 확인하고 살리거나 지운다',
      pr: null,
      branches: orphanLocal,
    }
  }

  const merged = autoPrs.filter((p) => p.state === 'MERGED').length
  return {
    ok: true,
    code: 'CLEAR',
    severity: null,
    message: `미해결 자동 작업 0건 (지난 자동 PR ${merged}건은 merge 됨)`,
    pr: null,
    branches: [],
  }
}

/**
 * GitHub·git 에서 판정에 필요한 값을 읽는다. **읽기 전용이다.**
 *
 * 🔴 **브랜치마다 정확한 head 이름으로 PR 을 직접 조회한다** (2026-09-30 운영 실측).
 *    앞판은 `gh pr list --state all --limit 100` 한 번을 정본으로 썼다. PR 이 쌓여 최저 번호가 #531 이
 *    되자, 2026-09-16 에 MERGED 된 #524 의 브랜치가 목록 밖으로 밀려 **"PR 없는 브랜치"(ORPHAN_REMOTE_BRANCH)**
 *    로 오판됐고 producer·자동 등록이 선정 전에 멈췄다. 창 크기를 키워도 언젠가 다시 밀린다.
 *    그래서 ① origin·local 의 자동 브랜치 목록을 먼저 읽고 ② 각 브랜치를 `--head <이름>` 으로 조회해
 *    ③ 합친 결과를 같은 `judgeOutstanding` 에 넘긴다.
 *
 * 🔴 `--state all` 이어야 MERGED(해소)·CLOSED(폐기 대기)를 구분한다.
 * 🔴 **한 브랜치라도** 조회 실패·JSON 손상이면 전체가 "확정할 수 없다" 다 — fail closed.
 *
 * @param {{exec:(cmd:string,args:string[])=>{code:number,out:string,err?:string}}} p
 */
export function readOutstanding({ exec }) {
  // origin 의 자동 브랜치. 실패하면 목록을 비우지 않고 **확정 실패**로 넘긴다.
  const ls = exec('git', ['ls-remote', '--heads', 'origin', `refs/heads/${AUTO_BRANCH_PREFIX}*`])
  if (ls.code !== 0) return judgeOutstanding({ queryOk: false })
  const remoteBranches = String(ls.out ?? '')
    .split('\n')
    .map((l) => l.split('\t')[1] ?? '')
    .map((r) => r.replace(/^refs\/heads\//, ''))
    .filter(Boolean)

  const lb = exec('git', ['branch', '--list', `${AUTO_BRANCH_PREFIX}*`, '--format=%(refname:short)'])
  if (lb.code !== 0) return judgeOutstanding({ queryOk: false })
  const localBranches = String(lb.out ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

  const prs = []
  for (const head of [...new Set([...remoteBranches, ...localBranches])].filter(isAutoBranch)) {
    const r = exec('gh', [
      'pr', 'list', '--state', 'all', '--head', head, '--limit', '10',
      '--json', 'number,url,headRefName,state',
    ])
    if (r.code !== 0) return judgeOutstanding({ queryOk: false })
    let parsed
    try {
      parsed = JSON.parse(r.out || '[]')
      if (!Array.isArray(parsed)) throw new Error('not an array')
    } catch {
      // 🔴 읽기는 성공했는데 해석하지 못했다 — 이것도 "확정할 수 없다" 다
      return judgeOutstanding({ queryOk: false })
    }
    // 🔴 정확히 그 브랜치의 PR 만 받는다 — 다른 head 가 섞여 들어와도 판정에 쓰지 않는다
    for (const pr of parsed) if (pr?.headRefName === head) prs.push(pr)
  }

  return judgeOutstanding({ queryOk: true, prs, remoteBranches, localBranches })
}
