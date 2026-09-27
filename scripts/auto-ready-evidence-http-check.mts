#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 — 사람 검토 서버 경계 실제 HTTP 검사** (격리 DB + 로컬 `next start` 전용)
 *
 *   순수·격리 DB 검사는 `recordHumanBatch` 까지 본다. 그 앞의 **서버 액션 경계**(requireAdmin ·
 *   세션 · 요청 칸 버리기 · 서버 시계)는 실제 서버에 실제 요청을 보내야 확인된다.
 *   `persona-candidate-withdraw-http-check` 와 같은 방식이다 — 세션은 `@auth/core/jwt` 로 만들고,
 *   화면이 부르는 것과 같은 `Next-Action` 요청을 보낸다.
 *
 * 🔴 운영 DB·외부 네트워크 0 — localhost 서버와 격리 Postgres(soran_test)만.
 *
 *   준비: 격리 Postgres · prisma migrate deploy · next build · next start (같은 DATABASE_URL · AUTH_SECRET)
 *   실행: BASE_URL=http://localhost:3998 DATABASE_URL=… SORAN_ISOLATED_DB=yes-throwaway AUTH_SECRET=… \
 *         npx tsx scripts/auto-ready-evidence-http-check.mts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encode } from '@auth/core/jwt'
import { PrismaClient } from '@prisma/client'

import { digestOf, readEvidenceReviews } from '../src/lib/auto-ready-evidence'
import { HUMAN_DECIDER } from '../src/lib/auto-ready-v2'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE, semanticSummaryOf,
} from '../src/lib/micro-seed-supply-autofill'

const DB = process.env.DATABASE_URL ?? ''
if ((process.env.SORAN_ISOLATED_DB ?? '') !== 'yes-throwaway' || !/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test$/.test(DB)) {
  console.error('\n🔴 격리 DB 가 아니다 — 이 검사는 운영 DB 에서 돌지 않는다\n'); process.exit(2)
}
const BASE = process.env.BASE_URL ?? 'http://localhost:3998'
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error('\n🔴 localhost 가 아니다\n'); process.exit(2) }
const SECRET = process.env.AUTH_SECRET ?? ''
if (SECRET === '') { console.error('\n🔴 AUTH_SECRET 이 필요하다\n'); process.exit(2) }

/**
 * 🔴 action id 는 빌드 산출물에서 찾는다 — 손으로 적지 않는다.
 *    이 화면의 액션은 둘(제출 · 지금 상태 읽기)이다. Next 14 의 id 는 sha1(`파일 절대경로:export 이름`)이라,
 *    이름으로 계산한 id 가 **빌드 manifest 에 실제로 있는지** 대조해 어느 쪽이 어느 액션인지 가른다.
 */
const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')) as {
  node: Record<string, { workers: Record<string, unknown> }>
}
const ids = Object.entries(manifest.node).filter(([, v]) => Object.keys(v.workers).some((w) => w.includes('admin/auto-ready-evidence'))).map(([k]) => k)
const actionIdOf = (name: string): string =>
  createHash('sha1').update(`${resolve('src/lib/actions/auto-ready-evidence.ts')}:${name}`).digest('hex')
const ACTION = actionIdOf('submitEvidenceBatch')
const STATE_ACTION = actionIdOf('readEvidenceBatchState')
if (ids.length !== 2 || !ids.includes(ACTION) || !ids.includes(STATE_ACTION)) {
  console.error(`\n🔴 이 화면의 서버 액션이 제출 · 상태 읽기 둘이 아니다 (${ids.join(', ')})\n`); process.exit(2)
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const prisma = new PrismaClient()
const cookieFor = async (userId: string): Promise<string> =>
  `authjs.session-token=${await encode({ token: { uid: userId, sub: userId }, secret: SECRET, salt: 'authjs.session-token' })}`

type Payload = { error?: string; reviewer?: string; results?: { queueId: string; result: string; why: string }[]; rows?: { queueId: string; phase: string; status: string | null; declineReason: string | null; mine: { hardDefect: string } | null }[] }

/** 🔴 RSC flight 응답의 줄(`N:{...}`) 중 액션 반환값(객체)을 꺼낸다 — 못 찾으면 null */
const payloadOf = (text: string): Payload | null => {
  for (const line of text.split('\n')) {
    const m = /^[0-9a-f]+:(\{.*\})$/.exec(line)
    if (m === null) continue
    try {
      const v = JSON.parse(m[1]!) as Record<string, unknown>
      if ('results' in v || 'rows' in v || 'error' in v) return v as Payload
    } catch { /* 다른 줄 */ }
  }
  return null
}

async function call(body: unknown, cookie: string | null, action = ACTION): Promise<{ status: number; text: string; payload: Payload | null }> {
  const res = await fetch(`${BASE}/admin/auto-ready-evidence`, {
    method: 'POST',
    headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify([body]), redirect: 'manual',
  })
  const text = await res.text()
  return { status: res.status, text, payload: payloadOf(text) }
}

async function main(): Promise<void> {
  console.log('\n══ 자동 READY 증거 — 서버 경계 실제 HTTP (격리 DB · localhost) ══\n')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  const admin = await prisma.user.create({ data: { nickname: '검토관리자', isAdmin: true }, select: { id: true } })
  const plain = await prisma.user.create({ data: { nickname: '일반회원' }, select: { id: true } })
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, sourceUrl: 'https://example.invalid/h1', sourceArticleId: 'H1-x', sourceCapturedAt: new Date(Date.now() - 864e5), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  const title = '평범한 하루 이야기'
  const body = '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?'
  const row = await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: title, draftBody: body, gateVerdict: 'PASS',
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: HUMAN_DECIDER, dedupKey: 'h1',
      gateResults: {
        holds: [], blocks: [],
        semanticReview: semanticSummaryOf({ deterministic: { pass: true }, semanticCompletion: { complete: true }, semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.95 } }),
        autoDraft: { provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision, draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion },
      } as never,
    },
    select: { id: true },
  })
  const bundleText = JSON.stringify({ items: [{ queueId: row.id, draft: { titleDigest: digestOf(title), bodyDigest: digestOf(body) } }] })
  /** 🔴 요청에 검토자·시각을 억지로 넣는다 — 서버가 버려야 한다 */
  const forged = { bundleText, entries: [{ queueId: row.id, hardDefect: 'no', reviewer: 'human:founder', reviewerUserId: plain.id, reviewedAt: '2099-01-01T00:00:00Z' }], reviewer: 'human:founder', reviewedAt: '2099-01-01T00:00:00Z' }
  const reviews = async () => readEvidenceReviews((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: row.id } })).editDiff)

  const page = await fetch(`${BASE}/admin/auto-ready-evidence`)
  check('비로그인 화면 → 접근 권한 없음', (await page.text()).includes('접근 권한이 없습니다'))
  const anon = await call(forged, null)
  check('🔴 🔴 **비로그인 요청 → DB write 0**', (await reviews()).length === 0, `status ${anon.status}`)
  const nonAdmin = await call(forged, await cookieFor(plain.id))
  check('🔴 🔴 **비관리자 세션 요청 → DB write 0**', (await reviews()).length === 0, `status ${nonAdmin.status}`)

  const t0 = Date.now()
  const ok = await call(forged, await cookieFor(admin.id))
  const t1 = Date.now()
  const recs = await reviews()
  check('관리자 요청이 처리됐다', ok.status === 200 && recs.length === 1, `status ${ok.status} · ${recs.length}`)
  const r = recs[0]
  check('🔴 🔴 **reviewerUserId = 관리자 세션의 User.id (요청의 reviewerUserId 무시)**', r?.reviewerUserId === admin.id)
  check('🔴 🔴 **reviewer = human:operator (요청의 human:founder 무시)**', r?.reviewer === 'human:operator')
  const at = r === undefined ? NaN : Date.parse(r.reviewedAt)
  check('🔴 🔴 **reviewedAt = 서버 시각 (요청의 2099 무시)**', at >= t0 - 1000 && at <= t1 + 1000, String(r?.reviewedAt))
  const blank = await call({ bundleText, entries: [{ queueId: row.id }] }, await cookieFor(admin.id))
  check('🔴 빈 판정 제출 → 기록 수 그대로', blank.status === 200 && (await reviews()).length === 1)

  // ── 🔴 결함 yes 인 미발행 승인 글 — 철회를 명시해야만 기록된다 ──
  const raw2 = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, sourceUrl: 'https://example.invalid/h2', sourceArticleId: 'H2-x', sourceCapturedAt: new Date(Date.now() - 864e5), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  const src = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: row.id }, select: { gateResults: true } })
  const t2 = '두 번째 하루 이야기'
  const b2 = '저녁에 동네를 한 바퀴 돌았어요. 다들 어떻게 지내세요?'
  const row2 = await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: raw2.id, status: 'APPROVED', draftTitle: t2, draftBody: b2, gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: HUMAN_DECIDER, decidedAt: new Date('2026-09-20T00:00:00Z'), dedupKey: 'h2', gateResults: src.gateResults as never },
    select: { id: true },
  })
  const bundle2 = JSON.stringify({ items: [{ queueId: row2.id, draft: { titleDigest: digestOf(t2), bodyDigest: digestOf(b2) } }] })
  const q2 = () => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: row2.id } })
  const noWithdraw = await call({ bundleText: bundle2, entries: [{ queueId: row2.id, hardDefect: 'yes', reasons: ['단정'] }] }, await cookieFor(admin.id))
  check('🔴 🔴 **결함 yes · 철회 선택 없음 → 상태·기록 0**',
    noWithdraw.status === 200 && (await q2()).status === 'APPROVED' && readEvidenceReviews((await q2()).editDiff).length === 0)
  const plainW = await call({ bundleText: bundle2, entries: [{ queueId: row2.id, hardDefect: 'yes', reasons: ['단정'], withdraw: true, declineReason: 'TOPIC_UNFIT' }] }, await cookieFor(plain.id))
  check('🔴 🔴 **비관리자의 철회 요청 → 상태·기록 0**', (await q2()).status === 'APPROVED', `status ${plainW.status}`)
  const okW = await call({ bundleText: bundle2, entries: [{ queueId: row2.id, hardDefect: 'yes', reasons: ['단정'], withdraw: true, declineReason: 'TOPIC_UNFIT' }] }, await cookieFor(admin.id))
  const after2 = await q2()
  check('🔴 🔴 **관리자 철회 → DECLINED · 사유 그대로 · 승인 시각 보존 · 결함 기록 1**',
    okW.status === 200 && after2.status === 'DECLINED' && after2.declineReason === 'TOPIC_UNFIT'
    && after2.decidedAt?.toISOString() === '2026-09-20T00:00:00.000Z' && readEvidenceReviews(after2.editDiff).length === 1,
    `${after2.status} · ${after2.declineReason} · ${after2.decidedAt?.toISOString()}`)

  // ── 🔴 🔴 2026-09-27 운영 P0 — 반복 클릭 · 같은 요청 재제출 · 이미 결정된 행 · 지금 상태 ──
  console.log('\n── 결정 전 그림자 · 반복 제출 · 지금 상태 (운영 P0) ──')
  let seq = 10
  const shadowRow = async (tag: string) => {
    seq += 1
    const rawS = await prisma.microSeedRawContent.create({
      data: { origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, sourceUrl: `https://example.invalid/s${seq}`, sourceArticleId: `S${seq}-x`, sourceCapturedAt: new Date(Date.now() - 864e5), rawTitle: 't', rawBody: 'b' },
      select: { id: true },
    })
    const t = `그림자 이야기 ${tag}`
    const b = `오늘은 ${tag} 이야기를 해 볼게요. 다들 어떻게 지내세요?`
    const q = await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: rawS.id, status: 'APPROVED', draftTitle: t, draftBody: b, gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: 'machine:auto-draft-v5', dedupKey: `s${seq}`, gateResults: src.gateResults as never },
      select: { id: true },
    })
    return { id: q.id, title: t, body: b }
  }
  const bundleFor = (rows: { id: string; title: string; body: string }[]) =>
    JSON.stringify({ items: rows.map((x) => ({ queueId: x.id, draft: { title: x.title, body: x.body, titleDigest: digestOf(x.title), bodyDigest: digestOf(x.body) } })) })
  const qrow = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
  const recCount = async (id: string) => readEvidenceReviews((await qrow(id)).editDiff).length
  const adminCookie = await cookieFor(admin.id)

  const s1 = await shadowRow('하나')
  const s2 = await shadowRow('둘')
  const s3 = await shadowRow('셋')
  const bundleS = bundleFor([s1, s2, s3])

  // 상태 읽기 — 인증 경계
  const stAnon = await call({ bundleText: bundleS }, null, STATE_ACTION)
  check('🔴 🔴 **비로그인 상태 읽기 → 행 상태 0**', stAnon.payload?.rows === undefined, `status ${stAnon.status}`)
  const stPlain = await call({ bundleText: bundleS }, await cookieFor(plain.id), STATE_ACTION)
  check('🔴 🔴 **비관리자 상태 읽기 → 권한 없음 · 행 상태 0**', stPlain.payload?.rows === undefined && stPlain.payload?.error === '권한이 없습니다.', stPlain.text.slice(0, 200))
  const st0 = await call({ bundleText: bundleS }, adminCookie, STATE_ACTION)
  check('관리자 상태 읽기 → 세 행 모두 결정 전(undecided)', st0.payload?.rows?.map((r) => r.phase).join(',') === 'undecided,undecided,undecided', st0.text.slice(0, 300))

  // 비인증 제출 — 그림자 결정 write 0
  const decideS1 = { bundleText: bundleS, entries: [{ queueId: s1.id, decision: 'ready', hardDefect: 'no' }] }
  await call(decideS1, null)
  await call(decideS1, await cookieFor(plain.id))
  check('🔴 🔴 **비로그인 · 비관리자 결정 제출 → 결정 0 · 기록 0**', (await qrow(s1.id)).decidedBy === 'machine:auto-draft-v5' && await recCount(s1.id) === 0)

  // 빈 판정 — 결정만 있고 결함 칸 비움
  const blankS = await call({ bundleText: bundleS, entries: [{ queueId: s1.id, decision: 'ready' }] }, adminCookie)
  check('🔴 🔴 **빈 판정(결정 ready · 결함 비움) → 건너뜀 · 결정 0 · 기록 0**',
    blankS.payload?.results?.[0]?.result === 'skip' && (await qrow(s1.id)).decidedBy === 'machine:auto-draft-v5' && await recCount(s1.id) === 0, blankS.text.slice(0, 300))

  // 정상 제출 → 성공 · 정본 상태 recorded
  const okS = await call(decideS1, adminCookie)
  const afterS1 = await qrow(s1.id)
  check('🔴 🔴 **운영자 정상 제출 → decidedAndRecorded · APPROVED · 기록 1**',
    okS.payload?.results?.[0]?.result === 'decidedAndRecorded' && afterS1.decidedBy === HUMAN_DECIDER && afterS1.status === 'APPROVED' && await recCount(s1.id) === 1,
    okS.text.slice(0, 300))
  check('🔴 🔴 **제출 응답에 DB 에서 다시 읽은 상태 — 처리한 행 recorded · 나머지 undecided**',
    okS.payload?.rows?.map((r) => r.phase).join(',') === 'recorded,undecided,undecided')
  const again = await call(decideS1, adminCookie)
  check('🔴 🔴 **같은 요청 두 번 → 기록 정확히 1 · 두 번째는 unchanged(성공 동급)**',
    again.payload?.results?.[0]?.result === 'unchanged' && await recCount(s1.id) === 1 && (await qrow(s1.id)).updatedAt.getTime() === afterS1.updatedAt.getTime(),
    again.text.slice(0, 300))
  const st1 = await call({ bundleText: bundleS }, adminCookie, STATE_ACTION)
  check('🔴 🔴 **성공 뒤 상태 읽기 → recorded (새로 불러와도 결정 칸이 다시 나오지 않는다)**', st1.payload?.rows?.[0]?.phase === 'recorded' && st1.payload.rows[0]?.mine?.hardDefect === 'no')

  // uili19gp 모양 — 폐기(OTHER) + 결함 yes
  const declS2 = { bundleText: bundleS, entries: [{ queueId: s2.id, decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: ['생활사 모순'] }] }
  const d1 = await call(declS2, adminCookie)
  const afterS2 = await qrow(s2.id)
  check('선행 — 폐기(OTHER) + 결함 yes → DECLINED · 기록 1', d1.payload?.results?.[0]?.result === 'decidedAndRecorded' && afterS2.status === 'DECLINED' && afterS2.declineReason === 'OTHER')
  const reDecline = await call({ bundleText: bundleS, entries: [{ queueId: s2.id, decision: 'reject', declineReason: 'TOPIC_UNFIT', hardDefect: 'yes', reasons: ['생활사 모순'] }] }, adminCookie)
  const s2b = await qrow(s2.id)
  check('🔴 🔴 **이미 폐기된 행 다른 사유로 재폐기 → 거절 · 사유 OTHER 그대로 · 행 write 0**',
    reDecline.payload?.results?.[0]?.result === 'reject' && s2b.declineReason === 'OTHER' && s2b.updatedAt.getTime() === afterS2.updatedAt.getTime() && await recCount(s2.id) === 1)
  const otherAdmin = await prisma.user.create({ data: { nickname: '다른관리자', isAdmin: true }, select: { id: true } })
  const byOther = await call(declS2, await cookieFor(otherAdmin.id))
  check('🔴 🔴 **다른 관리자가 같은 폐기 결정 제출 → 거절 · 재폐기 0**',
    byOther.payload?.results?.[0]?.result === 'reject' && (await qrow(s2.id)).updatedAt.getTime() === afterS2.updatedAt.getTime())
  const stOther = await call({ bundleText: bundleS }, await cookieFor(otherAdmin.id), STATE_ACTION)
  check('🔴 🔴 **다른 관리자에게 그 행은 decided(결정 칸 없음 · 결함 기록만)**', stOther.payload?.rows?.[1]?.phase === 'decided' && stOther.payload.rows[1]?.status === 'DECLINED')

  // 더블 클릭 — 동시 두 요청
  const decideS3 = { bundleText: bundleS, entries: [{ queueId: s3.id, decision: 'ready', hardDefect: 'no' }] }
  const [x1, x2] = await Promise.all([call(decideS3, adminCookie), call(decideS3, adminCookie)])
  const pair = [x1.payload?.results?.[0]?.result, x2.payload?.results?.[0]?.result].sort().join('/')
  check('🔴 🔴 **동시 두 요청(더블 클릭) → 기록 정확히 1 · decidedAndRecorded + unchanged**', await recCount(s3.id) === 1 && pair === 'decidedAndRecorded/unchanged', pair)

  // stale 묶음 · 부분 성공
  const g = await shadowRow('넷')
  const stl = await shadowRow('다섯')
  const bundleP = bundleFor([g, stl])
  await prisma.originalPostApprovalQueue.update({ where: { id: stl.id }, data: { draftBody: `${stl.body} (묶음 뒤 수정)` } })
  const stlBefore = await qrow(stl.id)
  const staleOnly = await call({ bundleText: bundleP, entries: [{ queueId: stl.id, decision: 'ready', hardDefect: 'no' }] }, adminCookie)
  check('🔴 🔴 **stale 묶음(초안 변경) → 거절 · write 0**',
    staleOnly.payload?.results?.[0]?.result === 'reject' && (await qrow(stl.id)).updatedAt.getTime() === stlBefore.updatedAt.getTime() && await recCount(stl.id) === 0)
  const partial = await call({ bundleText: bundleP, entries: [
    { queueId: g.id, decision: 'ready', hardDefect: 'no' }, { queueId: stl.id, decision: 'ready', hardDefect: 'no' },
  ] }, adminCookie)
  const pr = partial.payload?.results ?? []
  check('🔴 🔴 **부분 성공 — 정상 1 기록 · stale 1 거절(사유 그대로) · stale write 0**',
    pr.find((r) => r.queueId === g.id)?.result === 'decidedAndRecorded' && pr.find((r) => r.queueId === stl.id)?.result === 'reject'
    && (pr.find((r) => r.queueId === stl.id)?.why ?? '').includes('초안이 바뀌었다')
    && await recCount(g.id) === 1 && await recCount(stl.id) === 0 && (await qrow(stl.id)).updatedAt.getTime() === stlBefore.updatedAt.getTime(), JSON.stringify(pr))
  check('🔴 부분 성공 응답의 상태 — recorded · stale', partial.payload?.rows?.map((r) => r.phase).join(',') === 'recorded,stale')

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · localhost 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()
