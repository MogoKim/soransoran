/**
 * 댓글 대화 스레드 — 순수 함수.
 *
 * 저장은 그대로다. `Comment.parentId` 는 **직접 답변 대상**이다(원댓글은 null).
 *
 *   A (parentId = null)
 *   B (parentId = A)
 *   C (parentId = B)   ← 깊이 제한이 없다
 *
 * 화면이 쓰는 "스레드" 는 한 글의 댓글을 한 번에 읽은 뒤 여기서 계산한다.
 *   · 스레드 루트 = 부모를 따라 올라가 닿는 원댓글
 *   · 후속 답변   = 같은 루트 아래 모든 댓글을 **시간순으로 평면화**한 것
 *   · 직접 대상   = 각 답변의 parentId
 *
 * 🔴 DB 를 부르지 않는다. 재귀 질의·Raw SQL 없이 이미 읽은 행만 본다.
 * 🔴 잘못된 관계(순환 · 사라진 부모 · 다른 글의 부모)는 게시글을 깨뜨리지 않고
 *    그 댓글을 스레드 시작점으로 세운 뒤 `anomalies` 로 **드러낸다**. 조용히 정상인 척하지 않는다.
 * 🔴 지운 댓글 · 차단한 회원의 댓글은 뒤에 살아 있는 대답이 있을 때만 자리를 남긴다.
 */

export type ThreadRow = {
  id: string
  postId: string
  parentId: string | null
  createdAt: Date
  isDeleted: boolean
  /** 비회원 댓글은 null */
  authorId: string | null
}

/** 이 화면에서 댓글이 어떤 상태로 보이는가. 지움이 차단보다 앞선다(쓴 사람이 이미 거둔 말이다). */
export type EntryState = 'live' | 'deleted' | 'blocked'

export type ThreadAnomaly = {
  commentId: string
  kind: 'missing-parent' | 'cycle' | 'foreign-post'
}

export type ThreadEntry<T extends ThreadRow> = {
  row: T
  state: EntryState
  /**
   * 직접 답변 대상. 원댓글(또는 관계 이상으로 시작점이 된 댓글)은 null.
   * 대상이 살아 있을 때만 `row` 를 준다 — 지운·차단 대상의 이름·본문을 새로 내보내지 않는다.
   */
  replyTo: { id: string; state: EntryState; row: T | null } | null
}

export type CommentThread<T extends ThreadRow> = {
  root: ThreadEntry<T>
  /** 같은 스레드의 후속 댓글 — 시간순 · 들여쓰기 없이 한 줄로 */
  replies: ThreadEntry<T>[]
  /** 살아 있는 후속 댓글 중 가장 늦은 것. 접힌 스레드의 "마지막 답글" */
  lastReply: ThreadEntry<T> | null
}

export type ThreadBuild<T extends ThreadRow> = {
  threads: CommentThread<T>[]
  anomalies: ThreadAnomaly[]
}

const byTime = (a: ThreadRow, b: ThreadRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function entryStateOf(row: ThreadRow, blockedAuthorIds: ReadonlySet<string>): EntryState {
  if (row.isDeleted) return 'deleted'
  if (row.authorId !== null && blockedAuthorIds.has(row.authorId)) return 'blocked'
  return 'live'
}

/**
 * 부모 관계에서 끊어야 할 댓글을 찾는다 — 그 댓글은 스레드 시작점이 된다.
 * 각 댓글을 한 번씩만 따라가므로 행 수에 비례한다.
 */
function findCuts(rows: ThreadRow[], byId: Map<string, ThreadRow>, anomalies: ThreadAnomaly[]): Set<string> {
  const cut = new Set<string>()
  const done = new Set<string>()
  for (const start of rows) {
    if (done.has(start.id)) continue
    const path: ThreadRow[] = []
    const onPath = new Map<string, number>()
    let cur: ThreadRow | undefined = start
    while (cur && !done.has(cur.id)) {
      if (onPath.has(cur.id)) {
        // 순환 — 고리 안에서 가장 먼저 쓴 댓글을 시작점으로 세운다
        const loop = path.slice(onPath.get(cur.id))
        const oldest = [...loop].sort(byTime)[0]
        cut.add(oldest.id)
        anomalies.push({ commentId: oldest.id, kind: 'cycle' })
        break
      }
      onPath.set(cur.id, path.length)
      path.push(cur)
      if (cur.parentId === null) break
      const parent = byId.get(cur.parentId)
      if (!parent) {
        cut.add(cur.id)
        anomalies.push({ commentId: cur.id, kind: 'missing-parent' })
        break
      }
      cur = parent
    }
    for (const p of path) done.add(p.id)
  }
  return cut
}

export function buildCommentThreads<T extends ThreadRow>(
  rows: readonly T[],
  opts: { postId: string; blockedAuthorIds: ReadonlySet<string> },
): ThreadBuild<T> {
  const anomalies: ThreadAnomaly[] = []
  const own: T[] = []
  for (const r of rows) {
    if (r.postId === opts.postId) own.push(r)
    else anomalies.push({ commentId: r.id, kind: 'foreign-post' })
  }
  const byId = new Map<string, T>(own.map((r) => [r.id, r]))
  const cut = findCuts(own, byId, anomalies)
  const parentOf = (r: T): T | null => (r.parentId === null || cut.has(r.id) ? null : (byId.get(r.parentId) ?? null))

  // 루트 찾기 — 한 번 구한 값은 기억한다
  const rootMemo = new Map<string, string>()
  const rootOf = (r: T): string => {
    const trail: T[] = []
    let cur: T = r
    for (;;) {
      const known = rootMemo.get(cur.id)
      if (known) {
        for (const t of trail) rootMemo.set(t.id, known)
        return known
      }
      trail.push(cur)
      const p = parentOf(cur)
      if (!p) {
        for (const t of trail) rootMemo.set(t.id, cur.id)
        return cur.id
      }
      cur = p
    }
  }

  const state = new Map<string, EntryState>(own.map((r) => [r.id, entryStateOf(r, opts.blockedAuthorIds)]))

  // 뒤에 살아 있는 대답이 있는가 — 살아 있는 댓글에서 위로 한 번씩 올린다(이미 표시한 조상에서 멈춘다)
  const liveBelow = new Set<string>()
  for (const r of own) {
    if (state.get(r.id) !== 'live') continue
    let p = parentOf(r)
    while (p && !liveBelow.has(p.id)) {
      liveBelow.add(p.id)
      p = parentOf(p)
    }
  }
  const shown = (r: T) => state.get(r.id) === 'live' || liveBelow.has(r.id)

  const entryOf = (r: T): ThreadEntry<T> => {
    const p = parentOf(r)
    const ps = p ? (state.get(p.id) as EntryState) : null
    return {
      row: r,
      state: state.get(r.id) as EntryState,
      replyTo: p && ps ? { id: p.id, state: ps, row: ps === 'live' ? p : null } : null,
    }
  }

  const groups = new Map<string, T[]>()
  for (const r of [...own].sort(byTime)) {
    const root = rootOf(r)
    if (root === r.id) continue
    const list = groups.get(root)
    if (list) list.push(r)
    else groups.set(root, [r])
  }

  const threads: CommentThread<T>[] = []
  for (const r of [...own].sort(byTime)) {
    if (rootOf(r) !== r.id || !shown(r)) continue
    const replies = (groups.get(r.id) ?? []).filter(shown).map(entryOf)
    const live = replies.filter((e) => e.state === 'live')
    threads.push({ root: entryOf(r), replies, lastReply: live.length ? live[live.length - 1] : null })
  }
  return { threads, anomalies }
}

/* ────────────────────────────────────────────────────────────────
 * Persona 대댓글을 위한 대화 맥락 — 🔴 **연결하지 않는다.** 인터페이스만 있다.
 *
 * 자동 대댓글이 켜지는 날, 답하려는 댓글 하나에서 다음을 한 번에 얻는다:
 * 게시글 · 스레드 루트 · 직접 대상 · 시간순 전체 대화 · 작성자 종류 · 지움/차단 상태 ·
 * 자동 반복을 멈출지 판단할 최소 수치.
 * ──────────────────────────────────────────────────────────────── */

export type AuthorKind = 'member' | 'guest' | 'persona' | 'operator' | 'micro-seed'

export type ContextRow = ThreadRow & {
  commentOrigin: string
  personaId: string | null
  operatorWriterId: string | null
}

/**
 * 작성자 종류 — 🔴 **`commentOrigin` 이 정본이다.** authorId 로 회원/비회원을 짐작하지 않는다.
 *
 *   MEMBER               personaId · operatorWriterId 없음 (authorId 가 null 이어도 회원 — 탈퇴한 회원)
 *   GUEST                authorId · personaId · operatorWriterId 모두 없음
 *   PERSONA              personaId 있음 · operatorWriterId 없음
 *   OPERATOR             operatorWriterId 있음 · personaId 없음
 *   MICRO_SEED_VERBATIM  personaId · operatorWriterId 없음 — 회원도 비회원도 아닌 따로다
 *
 * 🔴 출처와 연결 id 가 어긋나거나 모르는 출처면 **거절**한다(fail-closed).
 *    어긋난 행을 어느 쪽으로든 짐작하면 자동 대댓글이 사람을 Persona 로, Persona 를 사람으로 볼 수 있다.
 */
export function authorKindOf(r: ContextRow): { ok: true; kind: AuthorKind } | { ok: false; reason: string } {
  const p = r.personaId !== null
  const o = r.operatorWriterId !== null
  switch (r.commentOrigin) {
    case 'MEMBER':
      return !p && !o ? { ok: true, kind: 'member' } : { ok: false, reason: 'MEMBER 인데 persona/operator 연결이 있다' }
    case 'GUEST':
      return !p && !o && r.authorId === null ? { ok: true, kind: 'guest' } : { ok: false, reason: 'GUEST 인데 회원·persona·operator 연결이 있다' }
    case 'PERSONA':
      return p && !o ? { ok: true, kind: 'persona' } : { ok: false, reason: 'PERSONA 인데 personaId 가 없거나 operator 연결이 있다' }
    case 'OPERATOR':
      return o && !p ? { ok: true, kind: 'operator' } : { ok: false, reason: 'OPERATOR 인데 operatorWriterId 가 없거나 persona 연결이 있다' }
    case 'MICRO_SEED_VERBATIM':
      return !p && !o ? { ok: true, kind: 'micro-seed' } : { ok: false, reason: 'MICRO_SEED 인데 persona/operator 연결이 있다' }
    default:
      return { ok: false, reason: `모르는 출처 ${r.commentOrigin}` }
  }
}

/** 사람이 아닌 차례 — 자동 반복을 멈출지 셀 때 쓴다 */
const AUTOMATED: ReadonlySet<AuthorKind> = new Set(['persona', 'operator', 'micro-seed'])

export type ConversationTurn = {
  id: string
  parentId: string | null
  createdAt: Date
  authorKind: AuthorKind
  /** 같은 사람인지 가르는 열쇠 — 회원 id · persona id · operator id. 비회원은 null(가를 수 없다) */
  actorKey: string | null
  state: EntryState
}

export type ConversationContext =
  | {
      ok: true
      postId: string
      threadRootId: string
      target: ConversationTurn
      /** 루트 → 대상까지의 직접 연결 */
      chain: ConversationTurn[]
      /** 같은 스레드 전체 — 시간순 */
      thread: ConversationTurn[]
      stats: {
        threadTurns: number
        /** 대상 쪽 끝에서부터 연달아 이어진 자동(persona · operator · micro-seed) 차례 수 */
        trailingAutoTurns: number
        /** 연결 안의 자동 차례 수 */
        autoTurnsInChain: number
        /** 대상이 persona 면 그 id — 자기 자신에게 답하는 것을 막는 데 쓴다 */
        targetPersonaId: string | null
      }
    }
  | { ok: false; reason: 'not-found' | 'target-deleted' | 'target-blocked' | 'relation-anomaly' | 'author-contradiction' }

export function conversationContextFor(
  rows: readonly ContextRow[],
  targetId: string,
  opts: { postId: string; blockedAuthorIds?: ReadonlySet<string> },
): ConversationContext {
  const blocked = opts.blockedAuthorIds ?? new Set<string>()
  const built = buildCommentThreads(rows, { postId: opts.postId, blockedAuthorIds: blocked })
  const target = rows.find((r) => r.id === targetId && r.postId === opts.postId)
  if (!target) return { ok: false, reason: 'not-found' }
  const st = entryStateOf(target, blocked)
  if (st === 'deleted') return { ok: false, reason: 'target-deleted' }
  if (st === 'blocked') return { ok: false, reason: 'target-blocked' }
  if (built.anomalies.length > 0) return { ok: false, reason: 'relation-anomaly' }

  const byId = new Map(rows.map((r) => [r.id, r]))
  const chain: ContextRow[] = []
  for (let cur: ContextRow | undefined = target; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) chain.unshift(cur)
  const rootId = chain[0].id
  const thread = built.threads.find((t) => t.root.row.id === rootId)
  const threadRows = thread ? [thread.root, ...thread.replies].map((e) => e.row) : [target]

  // 🔴 대화 안 어느 한 행이라도 작성자 종류가 모순이면 맥락을 만들지 않는다(fail-closed)
  const kinds = new Map<string, AuthorKind>()
  for (const r of new Set([...chain, ...threadRows])) {
    const k = authorKindOf(r)
    if (!k.ok) return { ok: false, reason: 'author-contradiction' }
    kinds.set(r.id, k.kind)
  }
  const kindOf = (r: ContextRow) => kinds.get(r.id) as AuthorKind
  const turn = (r: ContextRow): ConversationTurn => ({
    id: r.id,
    parentId: r.parentId,
    createdAt: r.createdAt,
    authorKind: kindOf(r),
    // 같은 사람인지 가르는 열쇠 — 종류에 맞는 id 만 쓴다. 비회원 · Micro Seed · 탈퇴 회원은 가를 수 없어 null
    actorKey:
      kindOf(r) === 'persona' ? r.personaId : kindOf(r) === 'operator' ? r.operatorWriterId : kindOf(r) === 'member' ? r.authorId : null,
    state: entryStateOf(r, blocked),
  })
  const isAuto = (r: ContextRow) => AUTOMATED.has(kindOf(r))
  let trailing = 0
  for (let i = chain.length - 1; i >= 0 && isAuto(chain[i]); i--) trailing++
  return {
    ok: true,
    postId: opts.postId,
    threadRootId: rootId,
    target: turn(target),
    chain: chain.map(turn),
    thread: threadRows.map(turn),
    stats: {
      threadTurns: threadRows.length,
      trailingAutoTurns: trailing,
      autoTurnsInChain: chain.filter(isAuto).length,
      targetPersonaId: target.personaId,
    },
  }
}
