#!/usr/bin/env tsx
/**
 * 🔴 **댓글 대화 스레드 — 격리 Postgres 실행 검사**
 *
 * 실제 경로 그대로 돈다: 회원·비회원 action 이 부르는 `writeComment`(Serializable 한 트랜잭션:
 * 글 상태 → 답글 대상 → 중복 → 저장 → /best 갱신)와 게시글 상세가 부르는 `loadPostThreads`.
 * 가짜는 한 곳뿐이다 — "저장 뒤 실패" 를 만들려고 트랜잭션 안의 /best 갱신 한 곳을 **던지게** 한다
 * (실제로도 일어날 수 있는 일이다. 성공을 꾸며 내지 않는다).
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test).
 *
 *   DATABASE_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run check:comment-thread-db
 */
const URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

const { PrismaClient } = await import('@prisma/client')
const bcrypt = (await import('bcryptjs')).default
/** 비회원 댓글 id 와 그 비밀번호 — 소유 확인 검사가 쓴다 */
const OWNERSHIP: [string, string][] = []
const { writeComment, COMMENT_DUPLICATE_WINDOW_MS } = await import('../src/lib/comment-write')
const { loadPostThreads } = await import('../src/lib/queries/comment-threads')
const { REPLY_TARGET_GONE, REPLY_TARGET_BLOCKED } = await import('../src/lib/comment-policy')
const { checkGuestCredential } = await import('../src/lib/guest-credential')
const { toPublishState, countsAsNewComment } = await import('../src/lib/comment-publish')
const { GUEST_PASSWORD_WRONG } = await import('../src/lib/guest-comment-policy')
type Db = InstanceType<typeof PrismaClient>

const prisma: Db = new PrismaClient()
// 🔴 멈춤도 실패다 — 4분 안에 끝나지 않으면 그 사실을 남기고 끝낸다(잠금을 쥔 채 조용히 서 있지 않게)
setTimeout(() => {
  console.error('🔴 시간 초과 — 4분 안에 끝나지 않았다(잠금 대기 · 멈춘 트랜잭션 의심)')
  process.exit(1)
}, 240_000).unref()
type R = { name: string; ok: boolean; detail: string }
const report: R[] = []
let failures = 0
const check = (name: string, cond: boolean, detail: string) => {
  if (!cond) failures++
  report.push({ name, ok: cond, detail })
}

const tag = `ct${Date.now().toString(36)}`
const member = (userId: string) => ({ kind: 'member' as const, userId })
/** 실제 action 과 같은 모양 — 원문 번호(비교용)와 그 번호의 진짜 해시(저장용) */
const FIXTURE_PW = '0000'
const FIXTURE_HASH = bcrypt.hashSync(FIXTURE_PW, 4)
const guest = (nickname: string) => ({ kind: 'guest' as const, nickname, password: FIXTURE_PW, passwordHash: FIXTURE_HASH })

async function main() {
  const author = await prisma.user.create({ data: { nickname: `${tag}글쓴이` }, select: { id: true } })
  const a = await prisma.user.create({ data: { nickname: `${tag}박마음` }, select: { id: true } })
  const b = await prisma.user.create({ data: { nickname: `${tag}초록대문집막내딸오십둘` }, select: { id: true } })
  const bad = await prisma.user.create({ data: { nickname: `${tag}차단될회원` }, select: { id: true } })
  const post = await prisma.post.create({
    data: { boardType: 'FREE', title: '새벽 3시', content: '본문', authorId: author.id },
    select: { id: true },
  })
  const other = await prisma.post.create({
    data: { boardType: 'FREE', title: '다른 글', content: '본문', authorId: author.id },
    select: { id: true },
  })
  const hidden = await prisma.post.create({
    data: { boardType: 'FREE', title: '내려간 글', content: '본문', authorId: author.id, status: 'HIDDEN' },
    select: { id: true },
  })
  const count = (postId = post.id) => prisma.comment.count({ where: { postId } })
  const write = (rawParentId: string, content: string, who: ReturnType<typeof member> | ReturnType<typeof guest>, postId = post.id) =>
    writeComment(prisma, { postId, rawParentId, content, author: who })
  const must = async (p: ReturnType<typeof write>) => {
    const r = await p
    if (!r.ok) throw new Error(`저장 실패: ${r.code} ${r.error}`)
    return r.commentId
  }

  // ① 원댓글부터 5턴 이상 · ② 회원·비회원 섞임 · ③ 비회원이 답글에 다시 답함
  const c1 = await must(write('', '저도 딱 그 시간이에요', member(a.id)))
  const c2 = await must(write(c1, '샤워하고 자요', member(b.id)))
  const c3 = await must(write(c2, '몇 도로 두세요?', member(author.id)))
  const c4 = await must(write(c3, '22도로 둬요', guest('지나가던이')))
  const c5 = await must(write(c4, '목이 칼칼하지 않으세요?', member(a.id)))
  const c6 = await must(write(c5, '가습기를 같이 틀어요', guest('새벽뜨개')))
  const c7 = await must(write(c2, '마그네슘은 처음 들어요', member(bad.id)))
  const chain = await prisma.comment.findMany({ where: { id: { in: [c1, c2, c3, c4, c5, c6] } }, select: { id: true, parentId: true } })
  const parentOf = new Map(chain.map((c) => [c.id, c.parentId]))
  {
    const { threads, anomalies } = await loadPostThreads(prisma, { postId: post.id, postAuthorId: author.id, blockedAuthorIds: [] })
    const t = threads[0]
    check(
      '①②③ 6턴 · 섞인 대화',
      parentOf.get(c1) === null && parentOf.get(c2) === c1 && parentOf.get(c6) === c5 &&
        threads.length === 1 && t.replies.map((r) => r.id).join() === [c2, c3, c4, c5, c6, c7].join() &&
        t.replies.find((r) => r.id === c4)?.isGuest === true &&
        t.replies.find((r) => r.id === c4)?.replyTo?.state === 'live' &&
        t.replies.find((r) => r.id === c3)?.isPostAuthor === true && anomalies.length === 0,
      `parentId = 직접 대상(c6→c5) · 한 스레드 · 시간순 답글 ${t?.replies.length}개 · 비회원 c4 · 글쓴이 c3`,
    )
  }

  // ④ 다른 글의 commentId 주입 · ⑤ 없는 대상
  {
    const foreign = await must(write('', '다른 글 댓글', member(a.id), other.id))
    const before = await count()
    const r1 = await write(foreign, '주입', member(a.id))
    const r2 = await write('does-not-exist', '없는 대상', member(a.id))
    const r3 = await write('   ', '공백 대상은 원댓글', member(a.id))
    check(
      '④⑤ 주입 · 없는 대상',
      !r1.ok && r1.code === 'TARGET_GONE' && r1.error === REPLY_TARGET_GONE && !r2.ok && r2.code === 'TARGET_GONE' &&
        r3.ok && (await count()) === before + 1,
      `다른 글 대상 ${r1.ok ? '통과!' : r1.code} · 없는 대상 ${r2.ok ? '통과!' : r2.code} · 저장 늘어난 수 ${(await count()) - before}(공백=원댓글 1)`,
    )
  }

  // ⑥ 지운 대상에 새 답글 · ⑦ 쓰는 도중 대상이 지워짐(같은 서버 판정) · 다른 글 상태
  {
    const doomed = await must(write(c1, '곧 지워질 답글', member(a.id)))
    await prisma.comment.update({ where: { id: doomed }, data: { isDeleted: true } })
    const before = await count()
    const r = await write(doomed, '지운 댓글에 답글', guest('늦은손님'))
    const h = await write('', '내려간 글에 댓글', member(a.id), hidden.id)
    check(
      '⑥⑦ 지운 대상 · 내려간 글',
      !r.ok && r.code === 'TARGET_GONE' && (await count()) === before && !h.ok && h.code === 'POST_GONE',
      `지운 대상 ${r.ok ? '통과!' : r.code} · 저장 0 · 내려간 글 ${h.ok ? '통과!' : h.code}`,
    )
  }

  // 차단한 회원의 댓글에는 답글 불가(보는 사람 기준) — 차단하지 않은 사람은 된다
  {
    await prisma.userBlock.create({ data: { blockerId: a.id, blockedUserId: bad.id }, select: { id: true } })
    const r = await write(c7, '차단한 사람에게 답글', member(a.id))
    const okOther = await write(c7, '차단 안 한 사람의 답글', member(b.id))
    check(
      '차단 대상 답글',
      !r.ok && r.code === 'TARGET_BLOCKED' && r.error === REPLY_TARGET_BLOCKED && okOther.ok,
      `차단한 사람 ${r.ok ? '통과!' : r.code} · 차단 안 한 사람 ${okOther.ok ? '저장' : okOther.code}`,
    )
  }

  // ⑧⑨⑩ 지운 원댓글 · 지운 중간 · 차단 중간 + 살아 있는 후속 — 실제 조회로
  {
    const r1 = await must(write('', '지워질 원댓글', member(b.id)))
    const r2 = await must(write(r1, '원댓글이 지워져도 남는 답글', member(a.id)))
    await prisma.comment.update({ where: { id: r1 }, data: { isDeleted: true } })
    const m1 = await must(write('', '뜨개질해요', member(b.id)))
    const m2 = await must(write(m1, '지워질 중간 답글', member(author.id)))
    const m3 = await must(write(m2, '중간이 지워져도 남는 답글', guest('새벽뜨개')))
    await prisma.comment.update({ where: { id: m2 }, data: { isDeleted: true } })
    const k1 = await must(write('', '휴대폰을 거실에', member(b.id)))
    const k2 = await must(write(k1, '차단될 사람의 중간 답글', member(bad.id)))
    const k3 = await must(write(k2, '차단 뒤에도 남는 답글', member(author.id)))
    const k4 = await must(write(k1, '차단될 사람의 끝 답글', member(bad.id)))

    const { threads } = await loadPostThreads(prisma, { postId: post.id, postAuthorId: author.id, blockedAuthorIds: [bad.id] })
    const tr = threads.find((t) => t.root.id === r1)
    const tm = threads.find((t) => t.root.id === m1)
    const tk = threads.find((t) => t.root.id === k1)
    const json = JSON.stringify(threads)
    check(
      '⑧ 지운 원댓글',
      tr?.root.state === 'deleted' && tr.root.content === '' && tr.replies[0]?.id === r2 && tr.replies[0].replyTo?.state === 'deleted',
      `자리 ${tr?.root.state} · 후속 ${tr?.replies.length}개 보존`,
    )
    check(
      '⑨ 지운 중간 댓글',
      tm?.replies.map((r) => `${r.id === m2 ? 'm2' : 'm3'}:${r.state}`).join() === 'm2:deleted,m3:live' && tm.replies[1].replyTo?.state === 'deleted',
      `${tm?.replies.map((r) => r.state).join(' → ')} · m3 의 대상은 "삭제된 댓글"`,
    )
    check(
      '⑩ 차단 중간 댓글',
      tk?.replies.map((r) => r.id).join() === [k2, k3].join() && tk.replies[0].state === 'blocked' && tk.replies[1].replyTo?.state === 'blocked' && !tk.replies.some((r) => r.id === k4),
      `차단 자리 ${tk?.replies[0]?.state} · 후속 보존 · 대답 없는 차단 끝 답글은 빠짐`,
    )
    const leaks = ['지워질 원댓글', '지워질 중간 답글', '차단될 사람의 중간 답글', '차단될 사람의 끝 답글', `${tag}차단될회원`, bad.id].filter((w) => json.includes(w))
    check('🔴 지움·차단 정보 새지 않음', leaks.length === 0, leaks.length ? `샌 값 ${leaks.join(', ')}` : '실제 조회 결과 전체에서 0건')

    // 차단하지 않은 보는 사람에게는 그대로 보인다
    const other = await loadPostThreads(prisma, { postId: post.id, postAuthorId: author.id, blockedAuthorIds: [] })
    check('차단은 보는 사람 기준', other.threads.find((t) => t.root.id === k1)?.replies.some((r) => r.id === k4 && r.state === 'live') === true, '차단하지 않은 사람에게는 k4 가 살아 있다')
  }

  // ⑪ 같은 요청 중복 — 연달아 두 번 · 동시에 다섯 번 · 창 밖은 새 댓글
  {
    const before = await count()
    const s1 = await write(c3, '연타한 답글', member(b.id))
    const s2 = await write(c3, '연타한 답글', member(b.id))
    const conc = await Promise.allSettled(Array.from({ length: 5 }, () => write(c3, '동시에 누른 답글', guest('동시손님'))))
    const concIds = new Set(conc.map((x) => (x.status === 'rejected' ? `예외:${String(x.reason).slice(0, 60)}` : x.value.ok ? x.value.commentId : `실패:${x.value.code}`)))
    const afterDup = await count()
    // 창 밖으로 밀어 두면 같은 말이라도 새 댓글이다
    if (s1.ok) await prisma.comment.update({ where: { id: s1.commentId }, data: { createdAt: new Date(Date.now() - COMMENT_DUPLICATE_WINDOW_MS - 1000) } })
    const s3 = await write(c3, '연타한 답글', member(b.id))
    check(
      '⑪ 중복 submit',
      s1.ok && s2.ok && s2.duplicate && s1.commentId === s2.commentId && concIds.size === 1 && ![...concIds][0].startsWith('실패') &&
        afterDup === before + 2 && s3.ok && !s3.duplicate,
      `연달아 2번 → 1건(같은 id) · 동시 5번 → ${concIds.size}개 id · 저장 ${afterDup - before}건 · 창 밖 재전송 → 새 댓글`,
    )
  }

  // ⑲ 실패하면 부분 데이터 0 — 저장 뒤 /best 갱신이 던지면 댓글도 남지 않는다
  {
    const before = await count()
    const failing = new Proxy(prisma, {
      get(target, prop, recv) {
        if (prop !== '$transaction') return Reflect.get(target, prop, recv)
        return (fn: (tx: unknown) => Promise<unknown>, opts: unknown) =>
          target.$transaction(async (tx) => {
            const txp = new Proxy(tx, {
              get(t, p, r) {
                // syncBestEligibility 가 처음 읽는 모델에서 던진다 — 댓글 create 는 이미 끝난 뒤다
                if (p === 'post' && (t as unknown as { __created?: boolean }).__created) throw new Error('fixture: /best 갱신 실패')
                if (p === 'comment') {
                  const real: object = Reflect.get(t, p, r)
                  return new Proxy(real, {
                    get(ct, cp, cr) {
                      const v = Reflect.get(ct, cp, cr)
                      if (cp !== 'create' || typeof v !== 'function') return v
                      return async (...args: unknown[]) => {
                        const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(ct, args)
                        ;(t as unknown as { __created?: boolean }).__created = true
                        return out
                      }
                    },
                  })
                }
                return Reflect.get(t, p, r)
              },
            })
            return fn(txp)
          }, opts as never)
      },
    }) as Db
    let threw = false
    try {
      await writeComment(failing, { postId: post.id, rawParentId: c1, content: '실패할 답글', author: member(a.id) })
    } catch {
      threw = true
    }
    check('⑲ 실패 시 부분 데이터 0', threw && (await count()) === before && (await prisma.comment.count({ where: { postId: post.id, content: '실패할 답글' } })) === 0, `저장 뒤 실패 → 예외 ${threw} · 남은 댓글 0`)
  }

  // ⑪-b 비회원 중복은 **자격 증명**까지 같아야 한다 — 닉네임·내용이 같아도 비밀번호가 다르면 다른 사람이다
  {
    const hash = (pw: string) => bcrypt.hash(pw, 10)
    const g = async (pw: string) => ({ kind: 'guest' as const, nickname: '같은이름', password: pw, passwordHash: await hash(pw) })
    const d1 = await write(c3, '같은 이름 같은 말', await g('1111'))
    const d2 = await write(c3, '같은 이름 같은 말', await g('2222'))
    check(
      '⑪-b 비회원 다른 자격 증명',
      d1.ok && d2.ok && d1.commentId !== d2.commentId && !d2.duplicate,
      `1111 → ${d1.ok ? d1.commentId.slice(-6) : d1.code} · 2222 → ${d2.ok ? d2.commentId.slice(-6) : d2.code}${d2.ok && d2.duplicate ? ' (중복으로 합쳐짐!)' : ''}`,
    )
    // 같은 자격 증명의 동시 재전송 5번 — 요청마다 해시를 새로 만든다(실제 action 과 같다 · salt 가 다르다)
    const same = await Promise.allSettled(Array.from({ length: 5 }, async () => write(c3, '같은 사람 동시 재전송', await g('3333'))))
    const sameIds = new Set(same.map((x) => (x.status === 'rejected' ? `예외:${String(x.reason).slice(0, 60)}` : x.value.ok ? x.value.commentId : `실패:${x.value.code}`)))
    check('⑪-b 비회원 같은 자격 증명 동시 5번', sameIds.size === 1 && !/^(실패|예외)/.test([...sameIds][0]), `id ${sameIds.size}개 ${[...sameIds].filter((x) => /^(실패|예외)/.test(x)).join(' ')}`)
    if (d1.ok && d2.ok) OWNERSHIP.push([d1.commentId, '1111'], [d2.commentId, '2222'])
  }

  // ⑪-d 계측 — 최초 등록만 comment_publish 로 센다. 중복 재전송은 같은 댓글로 가되 세지 않는다
  {
    const first = toPublishState(await write(c2, '계측 확인 답글', member(a.id)))
    const again = toPublishState(await write(c2, '계측 확인 답글', member(a.id)))
    const gFirst = toPublishState(await write(c2, '계측 확인 비회원', guest('계측손님')))
    const gAgain = toPublishState(await write(c2, '계측 확인 비회원', guest('계측손님')))
    check(
      '⑪-d 중복은 계측 안 함',
      countsAsNewComment(first) && !countsAsNewComment(again) && again.duplicate === true && again.commentId === first.commentId &&
        countsAsNewComment(gFirst) && !countsAsNewComment(gAgain) && gAgain.commentId === gFirst.commentId,
      `회원 최초 ${countsAsNewComment(first) ? '셈' : '안 셈'} · 재전송 ${countsAsNewComment(again) ? '셈!' : '안 셈'}(같은 id) · 비회원 최초 ${countsAsNewComment(gFirst) ? '셈' : '안 셈'} · 재전송 ${countsAsNewComment(gAgain) ? '셈!' : '안 셈'}`,
    )
  }

  // ⑪-c 각 번호는 자기 댓글만 고치고 지울 수 있다 — 고치기·지우기가 거치는 실제 확인 함수로
  {
    const [[id1, pw1], [id2, pw2]] = OWNERSHIP
    const own1 = await checkGuestCredential(prisma, id1, pw1)
    const own2 = await checkGuestCredential(prisma, id2, pw2)
    const cross1 = await checkGuestCredential(prisma, id1, pw2)
    const cross2 = await checkGuestCredential(prisma, id2, pw1)
    check(
      '⑪-c 번호별 소유',
      own1.ok && own2.ok && !cross1.ok && cross1.error === GUEST_PASSWORD_WRONG && !cross2.ok && cross2.error === GUEST_PASSWORD_WRONG,
      `1111→첫 댓글 ${own1.ok ? '통과' : '거절'} · 2222→둘째 ${own2.ok ? '통과' : '거절'} · 2222→첫 댓글 ${cross1.ok ? '통과!' : '거절'} · 1111→둘째 ${cross2.ok ? '통과!' : '거절'}`,
    )
  }

  // ⑳ 삭제와 답글 저장 경합 — 실제 두 세션을 겹친다
  {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    // 방향 ① 삭제가 먼저 확정된다 → 답글은 TARGET_GONE · 삭제된 대상 아래 새 답글 0
    const t1 = await must(write('', '경합 대상 — 삭제가 먼저', member(a.id)))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let held!: () => void
    const heldP = new Promise<void>((r) => (held = r))
    const del = prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: t1 }, data: { isDeleted: true }, select: { id: true } })
      held()
      await gate
    })
    await heldP
    const replyP = write(t1, '삭제와 겹친 답글', member(b.id))
    await sleep(500)
    release()
    await del
    const r1 = await replyP
    const under1 = await prisma.comment.count({ where: { parentId: t1 } })
    check('⑳ 경합 ① 삭제가 먼저', !r1.ok && r1.code === 'TARGET_GONE' && under1 === 0, `답글 ${r1.ok ? '저장됨!' : r1.code} · 삭제된 대상 아래 새 답글 ${under1}`)

    // 방향 ② 답글이 먼저 대상 자격을 확보한다 → 삭제는 기다렸다가 된다 · 답글은 자리 아래 보존
    const t2 = await must(write('', '경합 대상 — 답글이 먼저', member(a.id)))
    const before = await prisma.comment.findUniqueOrThrow({ where: { id: t2 }, select: { updatedAt: true } })
    let go!: () => void
    const hold = new Promise<void>((r) => (go = r))
    let locked!: () => void
    const lockedP = new Promise<'locked'>((r) => (locked = () => r('locked')))
    const pausing = new Proxy(prisma, {
      get(target, prop, recv) {
        if (prop !== '$transaction') return Reflect.get(target, prop, recv)
        return (fn: (tx: unknown) => Promise<unknown>, opts: unknown) =>
          target.$transaction(async (tx) => {
            const txp = new Proxy(tx, {
              get(t, p, r) {
                if (p !== 'comment') return Reflect.get(t, p, r)
                const real: object = Reflect.get(t, p, r)
                return new Proxy(real, {
                  get(ct, cp, cr) {
                    const v = Reflect.get(ct, cp, cr)
                    // 대상 자격을 확보한 직후 — 여기서 잠시 멈춰 다른 세션이 끼어들 틈을 연다
                    if (cp !== 'updateMany' || typeof v !== 'function') return v
                    return async (...args: unknown[]) => {
                      const out = await (v as (...a: unknown[]) => Promise<unknown>).apply(ct, args)
                      locked()
                      await hold
                      return out
                    }
                  },
                })
              },
            })
            return fn(txp)
          }, opts as never)
      },
    }) as Db
    const replyP2 = writeComment(pausing, { postId: post.id, rawParentId: t2, content: '먼저 자격을 얻은 답글', author: member(b.id) })
    const gotLock = await Promise.race([lockedP, sleep(3000).then(() => 'no-lock' as const)])
    let delDone = false
    const del2 = prisma.comment.update({ where: { id: t2 }, data: { isDeleted: true }, select: { id: true } }).then(() => (delDone = true))
    await sleep(500)
    const delWaited = !delDone
    go()
    const r2 = await replyP2
    await del2
    const under2 = await prisma.comment.findMany({ where: { parentId: t2 }, select: { id: true } })
    const { threads } = await loadPostThreads(prisma, { postId: post.id, postAuthorId: author.id, blockedAuthorIds: [] })
    const th = threads.find((x) => x.root.id === t2)
    check(
      '⑳ 경합 ② 답글이 먼저',
      gotLock === 'locked' && delWaited && r2.ok && under2.length === 1 && th?.root.state === 'deleted' && th.replies[0]?.state === 'live',
      `대상 잠금 ${gotLock} · 삭제는 답글 확정까지 대기 ${delWaited} · 답글 ${r2.ok ? '저장' : r2.code} · 자리 ${th?.root.state} 아래 답글 ${under2.length}`,
    )
    // 잠금은 대상의 updatedAt 을 바꾸지 않는다
    const t3 = await must(write('', '잠금 흔적 확인', member(a.id)))
    const u0 = await prisma.comment.findUniqueOrThrow({ where: { id: t3 }, select: { updatedAt: true } })
    await sleep(20)
    await must(write(t3, '잠금만 하고 지나간다', member(b.id)))
    const u1 = await prisma.comment.findUniqueOrThrow({ where: { id: t3 }, select: { updatedAt: true } })
    check('⑳ 대상 updatedAt 불변', u0.updatedAt.getTime() === u1.updatedAt.getTime(), `${u0.updatedAt.toISOString()} → ${u1.updatedAt.toISOString()}`)
    void before
  }

  // ㉑ 동시 수정 경합 — 답글이 대상을 **읽은 뒤 · 잠그기 전** 다른 세션이 대상 본문을 고쳐 커밋한다.
  //    두 세션의 진행 지점을 관문으로 제어한다(sleep 으로 순서를 짐작하지 않는다).
  {
    const tgt = await must(write('', '고쳐질 대상 — 원래 본문', member(a.id)))
    const u0 = (await prisma.comment.findUniqueOrThrow({ where: { id: tgt }, select: { updatedAt: true } })).updatedAt
    const countBefore = await count()
    const events: string[] = []
    let attempts = 0
    let readSeen!: () => void
    const readP = new Promise<void>((r) => (readSeen = r))
    let resume!: () => void
    const resumeP = new Promise<void>((r) => (resume = r))
    // 성공한 시도에서 저장과 /best 갱신이 같은 트랜잭션에 있었는가
    const txLog: { attempt: number; created: boolean; bestAfterCreate: boolean; committed: boolean }[] = []
    const controlled = new Proxy(prisma, {
      get(target, prop, recv) {
        if (prop !== '$transaction') return Reflect.get(target, prop, recv)
        return async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
          const n = ++attempts
          const rec = { attempt: n, created: false, bestAfterCreate: false, committed: false }
          txLog.push(rec)
          const out = await target.$transaction(async (tx) => {
            const txp = new Proxy(tx, {
              get(t, p, r) {
                if (p === 'post' && rec.created) rec.bestAfterCreate = true
                if (p !== 'comment') return Reflect.get(t, p, r)
                const real: object = Reflect.get(t, p, r)
                return new Proxy(real, {
                  get(ct, cp, cr) {
                    const v = Reflect.get(ct, cp, cr)
                    if (typeof v !== 'function') return v
                    return async (...args: unknown[]) => {
                      const arg = args[0] as { where?: { id?: string } } | undefined
                      if (cp === 'updateMany' && arg?.where?.id === tgt) events.push(`답글:잠금 시도(${n}회차)`)
                      const res = await (v as (...a: unknown[]) => Promise<unknown>).apply(ct, args)
                      if (cp === 'findUnique' && arg?.where?.id === tgt && n === 1) {
                        events.push('답글:대상 읽음(1회차)')
                        readSeen()
                        await resumeP // ← 여기서 멈춘다: 읽었지만 아직 잠그지 않았다
                        events.push('답글:재개(1회차)')
                      }
                      if (cp === 'create') rec.created = true
                      return res
                    }
                  },
                })
              },
            })
            return fn(txp)
          }, opts as never)
          rec.committed = true
          return out
        }
      },
    }) as Db
    const replyP = writeComment(controlled, { postId: post.id, rawParentId: tgt, content: '고치는 동안 쓴 답글', author: member(b.id) })
    await readP
    // 다른 세션 — 답글이 읽은 뒤 · 잠그기 전에 대상 본문을 고치고 커밋한다(실제 회원 수정 경로와 같은 update)
    const edited = await prisma.comment.update({ where: { id: tgt }, data: { content: '고쳐진 대상 — 새 본문' }, select: { updatedAt: true } })
    events.push('수정:커밋')
    resume()
    const res = await replyP
    const after = await prisma.comment.findUniqueOrThrow({ where: { id: tgt }, select: { content: true, updatedAt: true } })
    // 🔴 이번 실행의 글 안에서만 센다 — CI 는 앞 검사들이 쓴 격리 DB 를 이어 쓰고, 같은 DB 재실행에는
    //    앞 회차의 같은 본문 답글이 남아 있다(전역으로 세면 2회차부터 "답글 2개" 로 실패했다 · 2026-10-01)
    const replies = await prisma.comment.findMany({ where: { postId: post.id, content: '고치는 동안 쓴 답글' }, select: { id: true, parentId: true } })
    const countAfter = await count()
    const ok = txLog.filter((t) => t.committed)
    const order = events.join(' → ')
    const ordered =
      events.indexOf('답글:대상 읽음(1회차)') < events.indexOf('수정:커밋') &&
      events.indexOf('수정:커밋') < events.indexOf('답글:재개(1회차)') &&
      events.indexOf('답글:재개(1회차)') < events.indexOf('답글:잠금 시도(1회차)')
    check(
      '㉑ 동시 수정 경합',
      ordered &&
        attempts >= 2 &&
        res.ok && !res.duplicate &&
        after.content === '고쳐진 대상 — 새 본문' &&
        after.updatedAt.getTime() === edited.updatedAt.getTime() &&
        after.updatedAt.getTime() > u0.getTime() &&
        replies.length === 1 && replies[0].parentId === tgt &&
        countAfter === countBefore + 1 &&
        ok.length === 1 && ok[0].created && ok[0].bestAfterCreate,
      `순서 [${order}] · 시도 ${attempts}회(커밋 ${ok.length}) · 대상 본문 ${after.content === '고쳐진 대상 — 새 본문' ? '새 본문 유지' : '되돌아감!'} · ` +
        `updatedAt ${after.updatedAt.getTime() === edited.updatedAt.getTime() ? '수정 시각 유지' : after.updatedAt.getTime() === u0.getTime() ? '과거로 되돌아감!' : '다른 값!'} · ` +
        `답글 ${replies.length}개(parent=${replies[0]?.parentId === tgt ? '대상' : '다름'}) · 늘어난 댓글 ${countAfter - countBefore} · 성공 시도에서 저장→/best ${ok[0]?.bestAfterCreate ? '같은 트랜잭션' : '확인 안 됨'}`,
    )
  }

  // Persona · Operator 경계 — 사람 경로는 PERSONA/OPERATOR 행을 만들지 않고, 자동 댓글은 최상위다
  {
    const human = await prisma.comment.count({ where: { postId: post.id, OR: [{ personaId: { not: null } }, { operatorWriterId: { not: null } }, { commentOrigin: { in: ['PERSONA', 'OPERATOR'] } }] } })
    check('사람 경로 경계', human === 0, `writeComment 가 만든 자동 댓글 행 ${human}`)
  }

  // ⑮ 매우 긴 스레드 — 실제 DB 로 40턴 이어 쓰고 한 번에 읽는다
  {
    let prev = await must(write('', '긴 대화 시작', member(a.id)))
    const root = prev
    for (let i = 0; i < 40; i++) prev = await must(write(prev, `긴 대화 ${i}`, i % 2 ? member(a.id) : guest('긴손님')))
    const t0 = performance.now()
    const { threads } = await loadPostThreads(prisma, { postId: post.id, postAuthorId: author.id, blockedAuthorIds: [] })
    const ms = performance.now() - t0
    const t = threads.find((x) => x.root.id === root)
    check('⑮ 긴 스레드(실DB)', t?.replies.length === 40 && t.replies[39].replyTo?.id === t.replies[38].id, `40턴 · 한 번의 조회 ${ms.toFixed(0)}ms · 끝 답글의 대상 = 바로 앞 답글`)
  }
}

try {
  await main()
} catch (e) {
  // 🔴 도중에 멈춘 것도 실패로 남긴다 — 어느 단계에서 왜 멈췄는지 결과표에 보인다
  check('실행 중단', false, e instanceof Error ? e.message : String(e))
} finally {
  await prisma.$disconnect()
}

console.log('\n댓글 대화 스레드 — 격리 DB 검사')
console.log('  실제 writeComment · loadPostThreads · Serializable 트랜잭션\n')
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(18)} → ${r.detail}`)
if (failures > 0) {
  console.log(`\n🔴 ${failures}건 실패\n`)
  process.exit(1)
}
console.log(`\n✅ ${report.length}건 전부 기대와 일치\n`)
