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
import { readFileSync } from 'node:fs'
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

/** 🔴 action id 는 빌드 산출물에서 찾는다 — 손으로 적지 않는다 */
const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')) as {
  node: Record<string, { workers: Record<string, unknown> }>
}
const ids = Object.entries(manifest.node).filter(([, v]) => Object.keys(v.workers).some((w) => w.includes('admin/auto-ready-evidence'))).map(([k]) => k)
if (ids.length !== 1) { console.error(`\n🔴 이 화면의 서버 액션이 정확히 하나가 아니다 (${ids.length})\n`); process.exit(2) }
const ACTION = ids[0]!

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const prisma = new PrismaClient()
const cookieFor = async (userId: string): Promise<string> =>
  `authjs.session-token=${await encode({ token: { uid: userId, sub: userId }, secret: SECRET, salt: 'authjs.session-token' })}`

async function call(body: unknown, cookie: string | null): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/admin/auto-ready-evidence`, {
    method: 'POST',
    headers: { 'Next-Action': ACTION, 'Content-Type': 'text/plain;charset=UTF-8', ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify([body]), redirect: 'manual',
  })
  return { status: res.status, text: await res.text() }
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

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · localhost 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()
