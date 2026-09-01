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
 */

/** 브랜치 이름 — 날짜만 쓰면 같은 날 두 번째 실행이 충돌한다. 초까지 넣는다 */
export function branchName(now = Date.now()) {
  const kst = new Date(now + 9 * 3600 * 1000).toISOString()
  const date = kst.slice(0, 10)
  const hhmmss = kst.slice(11, 19).replace(/:/g, '')
  return `feat/magazine-auto-register-${date}-${hhmmss}`
}

/**
 * write 를 시작해도 되는 상태인가.
 *   ① 현재 브랜치가 main
 *   ② origin/main 과 같은 커밋
 *   ③ 추적 파일 변경 0건
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
    return { ok: false, blockedBy, branch: null }
  }
  const current = branch.out.trim()
  if (current !== 'main') {
    block('NOT_ON_MAIN', `현재 브랜치가 ${current} 다 — write 는 main 에서만 시작한다`)
  }

  const fetched = exec('git', ['fetch', 'origin', 'main'])
  if (fetched.code !== 0) block('FETCH_FAILED', `origin/main 을 가져오지 못했다: ${fetched.err || fetched.out}`)

  const head = exec('git', ['rev-parse', 'HEAD'])
  const remote = exec('git', ['rev-parse', 'origin/main'])
  if (head.code !== 0 || remote.code !== 0) {
    block('REV_PARSE_FAILED', 'HEAD 또는 origin/main 을 읽지 못했다')
  } else if (head.out.trim() !== remote.out.trim()) {
    block('NOT_IN_SYNC', `HEAD(${head.out.trim().slice(0, 7)}) 가 origin/main(${remote.out.trim().slice(0, 7)}) 과 다르다`)
  }

  // --untracked-files=no — 미추적은 보지 않는다
  const dirty = exec('git', ['status', '--porcelain', '--untracked-files=no'])
  if (dirty.code !== 0) block('STATUS_FAILED', '작업 트리 상태를 읽지 못했다')
  else if (dirty.out.trim()) {
    const n = dirty.out.trim().split('\n').length
    block('DIRTY_TREE', `추적 파일 변경 ${n}건 — write 는 깨끗한 트리에서만 시작한다`)
  }

  return { ok: blockedBy.length === 0, blockedBy, branch: current }
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
