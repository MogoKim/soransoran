#!/usr/bin/env tsx
/**
 * 승인 철회 **실제 UI 호출 검사** — 🔴 격리 DB + 실제 서버에서만 돈다
 *
 * 🔴 **왜 순수 fixture 로 부족한가** (2026-09-21).
 *
 *    전이 규칙은 순수 함수가 잠근다. 그런데 앞판의 결함은 규칙이 아니라 **배선**이었다 —
 *    `withdrawPersonaCandidate` 가 export 만 되고 **부르는 곳이 없었다.**
 *    규칙 fixture 는 그것을 잡지 못한다. 부르지 않으면 알 수 없는 것이 셋이다:
 *      · 화면이 그 명령을 **실제로 그리는가** (그리고 조건이 아닐 때 안 그리는가)
 *      · `requireAdmin` 이 **실제로** 막는가
 *      · 조건부 UPDATE 가 **실제로** 0건을 내고, read-back 이 그것을 보이는가
 *
 * 🔴 **운영 DB 에서 돌지 않는다.** 주소에 격리 표식이 없으면 첫 줄에서 멈춘다.
 * 🔴 provider 0 · 외부 네트워크 0 — localhost 와 격리 Postgres 만 쓴다.
 *
 *   준비: 격리 Postgres · prisma migrate deploy · seed · next start
 *   실행: BASE_URL=… DATABASE_URL=… AUTH_SECRET=… SEED=… WITHDRAW_ACTION_ID=… \
 *         npx tsx scripts/persona-candidate-withdraw-http-check.mts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encode } from '@auth/core/jwt'
import { PrismaClient } from '@prisma/client'

const DB = process.env.DATABASE_URL ?? ''
if (!/soran_withdraw/.test(DB) || !/\/tmp\//.test(DB)) {
  console.error('\n🔴 격리 DB 가 아니다 — 이 검사는 운영 DB 에서 돌지 않는다\n')
  process.exit(1)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3999'
if (!/^http:\/\/localhost:/.test(BASE)) {
  console.error('\n🔴 localhost 가 아니다 — 외부로 요청을 보내지 않는다\n')
  process.exit(1)
}
const SECRET = process.env.AUTH_SECRET ?? ''
const ACTION = process.env.WITHDRAW_ACTION_ID ?? ''
if (SECRET === '' || ACTION === '') {
  console.error('\n🔴 AUTH_SECRET · WITHDRAW_ACTION_ID 가 필요하다\n')
  process.exit(1)
}
const seed = JSON.parse(readFileSync(process.env.SEED ?? '/tmp/claude-501/seed.json', 'utf-8')) as {
  adminId: string; plainId: string; postId: string
  approved: string; edited: string; pending: string; published: string; keep: string
}

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const prisma = new PrismaClient()

/** 🔴 카카오 로그인 없이 세션을 만든다 — 격리 환경 전용이다 */
async function cookieFor(userId: string): Promise<string> {
  const token = await encode({
    token: { uid: userId, sub: userId },
    secret: SECRET, salt: 'authjs.session-token',
  })
  return `authjs.session-token=${token}`
}

const detailUrl = (id: string): string => `${BASE}/admin/persona-candidates/${id}`

async function getPage(id: string, cookie: string | null): Promise<{ status: number; html: string }> {
  const res = await fetch(detailUrl(id), {
    headers: cookie === null ? {} : { cookie },
    redirect: 'manual',
  })
  return { status: res.status, html: await res.text() }
}

/** 🔴 **실제 server action 을 부른다** — 화면이 누르는 것과 같은 경로다 */
async function callWithdraw(id: string, reason: string, cookie: string | null): Promise<number> {
  const res = await fetch(detailUrl(id), {
    method: 'POST',
    headers: {
      'Next-Action': ACTION,
      'Content-Type': 'text/plain;charset=UTF-8',
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify([id, reason]),
    redirect: 'manual',
  })
  await res.text()
  return res.status
}

const row = (id: string) => prisma.personaApprovalQueue.findUnique({
  where: { id },
  select: {
    status: true, declineReason: true, decidedBy: true, decidedAt: true,
    candidateText: true, targetPostId: true, publishedCommentId: true,
  },
})

const adminCookie = await cookieFor(seed.adminId)
const plainCookie = await cookieFor(seed.plainId)

console.log('\n승인 철회 — 실제 UI 호출 (격리 DB · localhost)\n')

// ── ① 화면이 그 명령을 실제로 그린다 ──
{
  const approved = await getPage(seed.approved, adminCookie)
  const shows = approved.status === 200 && approved.html.includes('승인 철회')
  // 🔴 조건이 아니면 **그리지 않는다**
  const pending = await getPage(seed.pending, adminCookie)
  const published = await getPage(seed.published, adminCookie)
  check('🔴 ① **APPROVED 미발행에서만 명령이 보인다**',
    shows && !pending.html.includes('승인 철회') && !published.html.includes('승인 철회'),
    JSON.stringify({ approved: approved.status, shows,
      pending: pending.html.includes('승인 철회'),
      published: published.html.includes('승인 철회') }))
}

// ── ②  사유 선택과 확인을 요구한다 ──
{
  const p = await getPage(seed.approved, adminCookie)
  /**
   * 🔴 **확인 문구는 서버 HTML 에 없다.** `window.confirm` 안의 글이라 클라이언트
   *    번들에 실린다 — 그래서 **실제로 빌드된 chunk** 에서 찾는다.
   *    소스 파일을 보면 "빌드에 실렸는가" 를 묻지 못한다.
   */
  const chunkDir = '.next/static/chunks/app/admin/persona-candidates/[id]'
  let shipped = false
  try {
    for (const f of readdirSync(chunkDir)) {
      if (!f.endsWith('.js')) continue
      const js = readFileSync(join(chunkDir, f), 'utf-8')
      if (js.includes('되돌리는 버튼은 없습니다') && js.includes('confirm')) { shipped = true; break }
    }
  } catch { shipped = false }

  check('🔴 ② **사유 선택과 확인을 요구한다**',
    // 🔴 사유 선택은 서버가 그린다
    p.html.includes('거둬들이는 사유')
    // 🔴 원래 승인 기록이 보존된다고 화면이 알린다
    && p.html.includes('지워지지 않고') && p.html.includes('원래 승인 기록')
    // 🔴 확인 절차가 실제로 빌드에 실렸다
    && shipped,
    JSON.stringify({
      사유라벨: p.html.includes('거둬들이는 사유'),
      보존안내: p.html.includes('지워지지 않고'),
      확인문구_빌드됨: shipped,
    }))
}

// ── ③ requireAdmin 이 실제로 막는다 ──
{
  const before = await row(seed.approved)
  const noCookie = await callWithdraw(seed.approved, 'PERSONA_MISMATCH', null)
  const notAdmin = await callWithdraw(seed.approved, 'PERSONA_MISMATCH', plainCookie)
  const after = await row(seed.approved)
  check('🔴 ③ **로그인·관리자 아니면 행이 그대로다**',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify({ noCookie, notAdmin, before, after }))
}

// ── ④ 관리자는 철회할 수 있다 · read-back ──
{
  const status = await callWithdraw(seed.approved, 'PERSONA_MISMATCH', adminCookie)
  const after = await row(seed.approved)
  const reason = after?.declineReason ?? ''
  check('🔴 ④ **관리자는 철회한다 — read-back 으로 확인한다**',
    status === 200 && after?.status === 'DECLINED'
    && reason.startsWith('WITHDRAWN:PERSONA_MISMATCH:')
    // 🔴 원래 승인자·승인 시각이 남는다
    && reason.includes('admin-원래') && reason.includes('2026-09-01T01:27:00.000Z')
    // 🔴 철회한 사람이 새 도장이다
    && after.decidedBy === seed.adminId
    // 🔴 본문·대상·공개 여부는 건드리지 않는다
    && after.candidateText === '시험 댓글' && after.targetPostId === seed.postId
    && after.publishedCommentId === null,
    JSON.stringify({ status, after }))
}

// ── ⑤ EDITED 도 거둘 수 있다 ──
{
  const status = await callWithdraw(seed.edited, 'LOW_VALUE', adminCookie)
  const after = await row(seed.edited)
  check('🔴 ⑤ **EDITED 도 거둘 수 있다**',
    status === 200 && after?.status === 'DECLINED'
    && (after.declineReason ?? '').startsWith('WITHDRAWN:LOW_VALUE:'),
    JSON.stringify({ status, after }))
}

// ── ⑥ PENDING · 이미 공개된 것은 바뀌지 않는다 ──
{
  const pBefore = await row(seed.pending)
  const qBefore = await row(seed.published)
  await callWithdraw(seed.pending, 'PERSONA_MISMATCH', adminCookie)
  await callWithdraw(seed.published, 'PERSONA_MISMATCH', adminCookie)
  check('🔴 ⑥ **PENDING 결정 · 이미 공개된 댓글은 바뀌지 않는다**',
    JSON.stringify(pBefore) === JSON.stringify(await row(seed.pending))
    && JSON.stringify(qBefore) === JSON.stringify(await row(seed.published)),
    JSON.stringify({ pBefore, qBefore }))
}

// ── ⑦ 다른 행 · Post · Comment 는 그대로다 ──
{
  const keep = await row(seed.keep)
  check('🔴 ⑦ **다른 행은 바뀌지 않는다**',
    keep?.status === 'APPROVED' && keep.declineReason === null
    && keep.decidedBy === 'admin-원래')
}

// ── ⑧ 거둔 것은 runner 가 집지 않는다 ──
{
  /**
   * 🔴 **회귀.** 거둬들였는데 runner 가 여전히 "승인 후보" 로 세면 아무것도 고친 것이 없다.
   *    runner 와 **같은 조건**(`status: 'APPROVED'`)으로 다시 센다.
   */
  const approvedNow = await prisma.personaApprovalQueue.count({ where: { status: 'APPROVED' } })
  const declinedNow = await prisma.personaApprovalQueue.count({ where: { status: 'DECLINED' } })
  const withdrawnIds = await prisma.personaApprovalQueue.findMany({
    where: { status: 'APPROVED' }, select: { id: true },
  })
  const picked = new Set(withdrawnIds.map((r) => r.id))
  check('🔴 ⑧ **거둔 것을 runner 가 집지 않는다**',
    !picked.has(seed.approved) && !picked.has(seed.edited)
    // 🔴 거두지 않은 것은 그대로 집힌다 — 전부 사라지게 만든 것이 아니다
    && picked.has(seed.keep)
    && approvedNow === 1 && declinedNow === 2,
    JSON.stringify({ approvedNow, declinedNow, picked: [...picked] }))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 격리 DB · localhost 전용 — 운영 DB write 0 · provider 0\n')
await prisma.$disconnect()
if (fail > 0) process.exit(1)
