/**
 * 자동 레인의 git 안전장치 — 판정만 하고, 실행기는 주입받는다.
 *
 * 🔴 이 모듈은 spawn 을 직접 부르지 않는다. `exec` 를 인자로 받는다.
 *    그래야 회귀 테스트가 실제 git 을 건드리지 않고 분기를 전부 확인할 수 있다.
 *    (기본 실행기는 호출부가 넘긴다 — magazine-auto-register-ready.mjs)
 *
 * 🔴 왜 register write 앞에 브랜치를 먼저 만드는가
 *    브랜치를 나중에 만들면 articles.ts · topic-queue.ts 가 **먼저 바뀐 뒤**
 *    브랜치 생성에 실패했을 때 그 변경이 현재 브랜치(main)에 남는다.
 *    순서를 뒤집으면 실패가 "아무 일도 안 일어남"으로 끝난다.
 *
 * 🔴 브랜치 이름이 이미 있으면 그 브랜치를 재사용하지 않는다.
 *    재사용하면 남의 커밋 위에 얹히거나, 현재 브랜치에 그대로 커밋하게 된다.
 *    초 단위를 붙여 충돌 자체를 만들지 않되, 그래도 부딪히면 멈춘다.
 *
 * 🔴 **한 회차가 끝나면 main 으로 돌아온다** (2026-09-15 진단).
 *    돌아오는 코드가 없어서, 첫 성공 회차 이후 저장소가 자동 브랜치에 남고
 *    다음 날부터 매일 `NOT_ON_MAIN` 으로 영구 정지했다. PR 을 만들었든 못 만들었든
 *    **작업 트리는 원래 자리로 돌려놓는다.**
 *
 * 🔴 **돌아오지 못하는 상황에서 파괴적으로 정리하지 않는다.**
 *    미커밋 변경이 남아 있으면 `switch -f` 도 `reset --hard` 도 쓰지 않는다.
 *    그 변경이 사람 것일 수 있다. BLOCKED 로 멈추고 복구 방법을 적는다.
 */

// ─────────────────────────────────────────────────────────
// 실행 의존성 — 🔴 commit·push 뒤에 없는 것을 발견하면 늦다
// ─────────────────────────────────────────────────────────

/**
 * write 회차가 시작 전에 확인하는 실행 파일들.
 *
 * 🔴 **`gh` 가 여기 있는 이유** (2026-09-15 진단).
 *    launchd 의 PATH 에는 `/opt/homebrew/bin` 이 없다. 그래서 `gh` 를 찾지 못하는데,
 *    옛 순서는 `git add` → `commit` → `push` → `gh pr create` 였다.
 *    **`gh` 가 없다는 사실을 push 가 끝난 뒤에 알게 된다** —
 *    PR 없는 브랜치가 origin 에 조용히 올라가고, 로그는 exit 0 이었다.
 *    없는 것은 **아무것도 쓰기 전에** 말한다.
 *
 * 🔴 `claude` 는 이 레인이 직접 부르지 않는다. producer(brief 생성)가 쓴다.
 *    그래도 같은 PATH 조건에서 도는 job 이라 함께 확인한다 —
 *    빠졌으면 다음 날 brief 가 통째로 비고, 그 원인은 여기서만 보인다.
 */
export const REQUIRED_TOOLS = [
  { name: 'git', probe: ['--version'], why: 'stage·commit·push' },
  { name: 'gh', probe: ['--version'], why: 'PR 생성' },
  { name: 'node', probe: ['--version'], why: '자식 스크립트 실행' },
  { name: 'claude', probe: ['--version'], why: 'producer 의 brief 생성' },
]

/**
 * 실행 파일이 **지금 이 PATH 에서** 실제로 돌아가는가.
 *
 * 🔴 `existsSync` 로 경로만 보지 않는다. launchd 가 주는 PATH 로 실제 실행해 본다 —
 *    파일은 있는데 PATH 에 없는 경우가 정확히 우리가 당한 모양이다.
 *
 * @param {{exec: Function, tools?: typeof REQUIRED_TOOLS}} p
 */
export function preflightTools({ exec, tools = REQUIRED_TOOLS }) {
  const blockedBy = []
  const found = {}
  for (const t of tools) {
    const r = exec(t.name, t.probe)
    if (r.code !== 0) {
      blockedBy.push({
        code: 'TOOL_MISSING',
        message: `${t.name} 을 실행할 수 없다 (${t.why}) — launchd PATH 에 없다`,
      })
      found[t.name] = null
      continue
    }
    found[t.name] = String(r.out ?? '').split('\n')[0].trim()
  }
  return { ok: blockedBy.length === 0, blockedBy, found }
}

/**
 * GitHub 로 PR 을 열 수 있는 상태인가. **값은 출력하지 않는다.**
 *
 * 🔴 `gh auth status` 의 출력에는 계정명과 scope 가 들어 있다.
 *    판정에 필요한 것은 exit code 뿐이므로 **출력을 돌려주지 않는다.**
 *    토큰은 애초에 이 명령이 찍지 않지만, 찍지 않는 것에 기대지 않는다.
 */
export function ghAuthReady({ exec }) {
  const r = exec('gh', ['auth', 'status'])
  if (r.code !== 0) {
    return {
      ok: false,
      blockedBy: [{ code: 'GH_AUTH_FAILED', message: 'gh 가 GitHub 에 인증돼 있지 않다 — 사람이 `gh auth login` 을 한다' }],
    }
  }
  return { ok: true, blockedBy: [] }
}

/**
 * push 가 될 자격이 있는가 — **아무것도 올리지 않고** 확인한다.
 *
 * 🔴 `--dry-run` 은 원격과 실제로 악수하고 권한까지 확인하지만 아무것도 만들지 않는다.
 *    credential helper(osxkeychain)가 launchd 세션에서 열리는지도 여기서 드러난다.
 *    keychain 이 잠겨 있으면 이 단계에서 막히고, commit 은 시작도 하지 않는다.
 */
export function pushReady({ exec, probeRef = 'refs/heads/__magazine_auto_preflight__' }) {
  const r = exec('git', ['push', '--dry-run', 'origin', `HEAD:${probeRef}`])
  if (r.code !== 0) {
    return {
      ok: false,
      blockedBy: [{
        code: 'PUSH_NOT_READY',
        message: `origin 에 push 할 수 없다 — 자격 증명 또는 권한 문제 (${String(r.err || r.out).split('\n').pop()})`,
      }],
    }
  }
  return { ok: true, blockedBy: [] }
}

/**
 * write 회차가 **파일을 하나도 건드리기 전에** 통과해야 하는 전부.
 *
 * 🔴 순서가 의미를 만든다 — 도구 → 인증 → push 자격 → git 상태.
 *    앞이 막히면 뒤를 묻지 않는다. `gh` 가 없는데 push 자격을 묻는 것은 의미가 없고,
 *    묻는 만큼 원격에 불필요한 접속이 생긴다.
 */
export function writePreflight({ exec }) {
  const tools = preflightTools({ exec })
  if (!tools.ok) return { ok: false, stage: 'tools', blockedBy: tools.blockedBy, tools: tools.found, git: null }

  const gh = ghAuthReady({ exec })
  if (!gh.ok) return { ok: false, stage: 'gh-auth', blockedBy: gh.blockedBy, tools: tools.found, git: null }

  const git = preflight({ exec })
  if (!git.ok) return { ok: false, stage: 'git', blockedBy: git.blockedBy, tools: tools.found, git }

  // 🔴 push 자격은 git 상태가 깨끗한 것을 확인한 뒤에 본다.
  //    더러운 트리에서 원격에 접속해 봐야 어차피 시작하지 않는다.
  const push = pushReady({ exec })
  if (!push.ok) return { ok: false, stage: 'push', blockedBy: push.blockedBy, tools: tools.found, git }

  return { ok: true, stage: null, blockedBy: [], tools: tools.found, git }
}

// ─────────────────────────────────────────────────────────
// 브랜치 이름
// ─────────────────────────────────────────────────────────

/** 브랜치 이름 — 날짜만 쓰면 같은 날 두 번째 실행이 충돌한다. 초까지 넣는다 */
export function branchName(now = Date.now()) {
  const kst = new Date(now + 9 * 3600 * 1000).toISOString()
  const date = kst.slice(0, 10)
  const hhmmss = kst.slice(11, 19).replace(/:/g, '')
  return `feat/magazine-auto-register-${date}-${hhmmss}`
}

// ─────────────────────────────────────────────────────────
// preflight — 🔴 깨끗한 main 에서, origin/main 과 맞춘 뒤에 시작한다
// ─────────────────────────────────────────────────────────

/**
 * write 를 시작해도 되는 git 상태인가.
 *   ① 현재 브랜치가 main
 *   ② 추적 파일 변경 0건
 *   ③ origin/main 을 fetch 하고 **ff-only 로 따라붙는다**
 *   ④ 그러고도 origin/main 과 다르면 BLOCKED (갈라졌다는 뜻이다)
 *
 * 🔴 ②를 ③앞에 둔다. 더러운 트리에서 merge 를 시도하는 것 자체가 사고다.
 *
 * 🔴 **ff-only 다.** merge 커밋을 만들지 않는다 — 만들면 runtime 저장소에
 *    origin 에 없는 커밋이 생기고, 그 순간 ④에 영구히 걸린다.
 *    따라붙지 못하면 사람이 볼 일이다.
 *
 * 🔴 미추적 파일은 보지 않는다. 운영상 남아 있는 것들이라 여기서 판단할 일이 아니다.
 *    대신 stage 대상에 절대 넣지 않는다(stageCheck).
 */
export function preflight({ exec }) {
  const blockedBy = []
  const block = (code, message) => blockedBy.push({ code, message })

  const branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch.code !== 0) {
    block('GIT_UNAVAILABLE', `현재 브랜치를 읽지 못했다: ${branch.err || branch.out}`)
    return { ok: false, blockedBy, branch: null, synced: false }
  }
  const current = branch.out.trim()
  if (current !== 'main') {
    block('NOT_ON_MAIN', `현재 브랜치가 ${current} 다 — write 는 main 에서만 시작한다`)
    // 🔴 여기서 멈춘다. main 이 아닌 곳에서 fetch·merge 를 하지 않는다.
    return { ok: false, blockedBy, branch: current, synced: false }
  }

  // --untracked-files=no — 미추적은 보지 않는다
  const dirty = exec('git', ['status', '--porcelain', '--untracked-files=no'])
  if (dirty.code !== 0) {
    block('STATUS_FAILED', '작업 트리 상태를 읽지 못했다')
    return { ok: false, blockedBy, branch: current, synced: false }
  }
  if (dirty.out.trim()) {
    const n = dirty.out.trim().split('\n').length
    block('DIRTY_TREE', `추적 파일 변경 ${n}건 — write 는 깨끗한 트리에서만 시작한다`)
    return { ok: false, blockedBy, branch: current, synced: false }
  }

  const fetched = exec('git', ['fetch', 'origin', 'main'])
  if (fetched.code !== 0) {
    block('FETCH_FAILED', `origin/main 을 가져오지 못했다: ${fetched.err || fetched.out}`)
    return { ok: false, blockedBy, branch: current, synced: false }
  }

  let head = exec('git', ['rev-parse', 'HEAD'])
  const remote = exec('git', ['rev-parse', 'origin/main'])
  if (head.code !== 0 || remote.code !== 0) {
    block('REV_PARSE_FAILED', 'HEAD 또는 origin/main 을 읽지 못했다')
    return { ok: false, blockedBy, branch: current, synced: false }
  }

  let synced = head.out.trim() === remote.out.trim()
  let fastForwarded = false
  if (!synced) {
    // 🔴 따라붙기를 한 번 시도한다. 뒤처진 것뿐이면 여기서 해결된다 —
    //    이것이 없으면 main 이 하루만 밀려도 레인이 멈춘다.
    const ff = exec('git', ['merge', '--ff-only', 'origin/main'])
    if (ff.code === 0) {
      head = exec('git', ['rev-parse', 'HEAD'])
      synced = head.code === 0 && head.out.trim() === remote.out.trim()
      fastForwarded = synced
    }
  }

  if (!synced) {
    block(
      'NOT_IN_SYNC',
      `HEAD(${head.out.trim().slice(0, 7)}) 가 origin/main(${remote.out.trim().slice(0, 7)}) 과 다르다 — ff-only 로 따라붙지 못했다(갈라졌다)`,
    )
  }

  return { ok: blockedBy.length === 0, blockedBy, branch: current, synced, fastForwarded }
}

/**
 * PR 브랜치를 만든다. **이미 있으면 실패다.**
 * 만든 뒤 현재 브랜치가 정말 그 이름인지 다시 확인한다 — switch 가 조용히 실패할 여지를 없앤다.
 */
export function createBranch(name, { exec }) {
  const created = exec('git', ['switch', '-c', name])
  if (created.code !== 0) {
    const why = /already exists/i.test(created.err + created.out)
      ? `브랜치 ${name} 가 이미 있다 — 현재 브랜치에 커밋하지 않는다`
      : `브랜치 생성 실패: ${(created.err || created.out).split('\n').pop()}`
    return { ok: false, name, blockedBy: [{ code: 'BRANCH_CREATE_FAILED', message: why }] }
  }
  const now = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (now.code !== 0 || now.out.trim() !== name) {
    return {
      ok: false,
      name,
      blockedBy: [{ code: 'BRANCH_MISMATCH', message: `브랜치 전환이 확인되지 않는다 (현재 ${now.out.trim() || '?'})` }],
    }
  }
  return { ok: true, name, blockedBy: [] }
}

/** commit 직전 — 지금도 그 브랜치인가 */
export function assertOnBranch(name, { exec }) {
  const now = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = now.out.trim()
  if (now.code !== 0 || current !== name) {
    return { ok: false, blockedBy: [{ code: 'BRANCH_DRIFTED', message: `현재 브랜치가 ${current || '?'} 다 — ${name} 이어야 한다` }] }
  }
  return { ok: true, blockedBy: [] }
}

/**
 * staged 목록이 예상 파일뿐인가.
 * 🔴 초과가 하나라도 있으면 커밋하지 않는다 — 다른 세션의 변경을 휩쓸 수 있다.
 */
export function stageCheck(expected, stagedOut) {
  const staged = String(stagedOut ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const want = new Set(expected)
  const unexpected = staged.filter((f) => !want.has(f))
  if (staged.length === 0) {
    return { ok: false, staged, unexpected, blockedBy: [{ code: 'NOTHING_STAGED', message: 'staged 파일이 없다' }] }
  }
  if (unexpected.length > 0) {
    return {
      ok: false,
      staged,
      unexpected,
      blockedBy: [{ code: 'UNEXPECTED_STAGED', message: `예상 밖 staged 파일: ${unexpected.join(', ')}` }],
    }
  }
  return { ok: true, staged, unexpected, blockedBy: [] }
}

// ─────────────────────────────────────────────────────────
// 복귀 — 🔴 다음 회차가 시작될 수 있는 자리로 돌려놓는다
// ─────────────────────────────────────────────────────────

/**
 * 작업 트리를 main 으로 되돌린다.
 *
 * 🔴 **이 함수가 없어서 레인이 하루 만에 죽는 구조였다** (2026-09-15 진단).
 *    성공하든 실패하든 부른다. 브랜치에 남겨 두면 다음 회차의 preflight 가
 *    `NOT_ON_MAIN` 을 내고, 사람이 손댈 때까지 매일 같은 자리에서 멈춘다.
 *
 * 🔴 **미커밋 변경이 있으면 돌아가지 않는다.**
 *    `switch` 는 충돌하면 실패하고, `-f` 나 `reset --hard` 는 그 변경을 지운다.
 *    자동화가 사람의 작업을 지우는 일은 만들지 않는다 —
 *    BLOCKED 로 남기고 무엇을 어떻게 되살리는지 적는다.
 *
 * 🔴 **작업 브랜치를 지우지 않는다.** push 됐든 아니든 커밋이 거기 있다.
 *    지우면 PR 이 안 열린 회차의 결과물이 통째로 사라진다.
 *
 * @returns {{ok: boolean, code: string, message: string, leftOnBranch: string|null}}
 */
export function returnToMain({ exec }) {
  const now = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = now.code === 0 ? now.out.trim() : null
  if (!current) {
    return { ok: false, code: 'RETURN_UNKNOWN_BRANCH', message: '현재 브랜치를 읽지 못해 복귀를 판단할 수 없다', leftOnBranch: null }
  }
  if (current === 'main') {
    return { ok: true, code: 'ALREADY_ON_MAIN', message: '이미 main 이다', leftOnBranch: null }
  }

  const dirty = exec('git', ['status', '--porcelain', '--untracked-files=no'])
  if (dirty.code !== 0) {
    return { ok: false, code: 'RETURN_STATUS_FAILED', message: '작업 트리 상태를 읽지 못해 복귀하지 않는다', leftOnBranch: current }
  }
  if (dirty.out.trim()) {
    const n = dirty.out.trim().split('\n').length
    return {
      ok: false,
      code: 'RETURN_DIRTY',
      message:
        `${current} 에 미커밋 변경 ${n}건이 남아 main 으로 돌아가지 않는다 (아무것도 지우지 않았다). ` +
        '사람이 확인한다 — git -C <runtime> status 로 내용을 보고, 살릴 것이 없으면 git -C <runtime> switch main',
      leftOnBranch: current,
    }
  }

  const switched = exec('git', ['switch', 'main'])
  if (switched.code !== 0) {
    return {
      ok: false,
      code: 'RETURN_SWITCH_FAILED',
      message: `main 으로 돌아가지 못했다: ${String(switched.err || switched.out).split('\n').pop()}`,
      leftOnBranch: current,
    }
  }

  const after = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (after.code !== 0 || after.out.trim() !== 'main') {
    return {
      ok: false,
      code: 'RETURN_MISMATCH',
      message: `복귀가 확인되지 않는다 (현재 ${after.out.trim() || '?'})`,
      leftOnBranch: current,
    }
  }

  return { ok: true, code: 'RETURNED', message: `main 으로 복귀했다 (작업 브랜치 ${current} 는 남겨 둔다)`, leftOnBranch: null }
}
