#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 배치 검토 — 실제 브라우저 화면 검사** (격리 DB + 로컬 `next start` 전용)
 *
 *   2026-09-27 운영 P0 — 운영자가 제출 뒤 성공 여부를 알 수 없어 반복 클릭했다. 순수 계획 검사와
 *   HTTP 검사는 "무엇을 보내면 무엇이 저장되는가" 를 잰다. 이 검사는 **화면이 실제로 무엇을 보내고
 *   무엇을 보여 주는가**를 잰다 — 브라우저로 묶음을 올리고 칸을 고르고 버튼을 누른다.
 *
 *   · 브라우저 기본 확인창(dialog) 0
 *   · 결정만 고르고 결함을 비우면 CTA 가 닫히고 행에 막힘 사유가 보인다
 *   · 제출 요청은 **정확히 1번**(같은 틱 두 번 클릭) · 보낸 행은 **고른 행뿐**
 *   · 성공 행은 즉시 잠기고 결정 칸이 사라진다 · 새로 불러와도 결정 칸이 다시 나오지 않는다
 *   · 이미 폐기된 행(운영 uili19gp 모양)은 결정 칸이 없다
 *   · 부분 성공 — 성공 · 거절(사유)이 행마다 보인다
 *
 * 🔴 사람 검토 기록은 **실제 서버 액션**(테스트 세션 쿠키)으로만 만든다. DB 에 직접 쓰지 않는다.
 * 🔴 운영 DB·외부 네트워크 0 — localhost 서버와 격리 Postgres(soran_test)만.
 *
 *   실행: BASE_URL=http://localhost:3998 DATABASE_URL=… SORAN_ISOLATED_DB=yes-throwaway AUTH_SECRET=… \
 *         [CHROMIUM_PATH=…] npx tsx scripts/auto-ready-evidence-ui-check.mts
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encode } from '@auth/core/jwt'
import { PrismaClient } from '@prisma/client'
import { chromium, type Page } from 'playwright-core'

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

/** 브라우저 — 지정이 없으면 로컬 Playwright 캐시의 가장 새 headless shell */
function chromiumPath(): string | undefined {
  if ((process.env.CHROMIUM_PATH ?? '') !== '') return process.env.CHROMIUM_PATH
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!existsSync(cache)) return undefined
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const d of dirs) {
    const p = join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
    if (existsSync(p)) return p
  }
  return undefined
}

const actionIdOf = (name: string): string =>
  createHash('sha1').update(`${resolve('src/lib/actions/auto-ready-evidence.ts')}:${name}`).digest('hex')
const SUBMIT = actionIdOf('submitEvidenceBatch')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const prisma = new PrismaClient()
const tokenFor = async (userId: string): Promise<string> =>
  encode({ token: { uid: userId, sub: userId }, secret: SECRET, salt: 'authjs.session-token' })

const GATE = {
  holds: [], blocks: [],
  semanticReview: semanticSummaryOf({ deterministic: { pass: true }, semanticCompletion: { complete: true }, semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.95 } }),
  autoDraft: { provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision, draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion },
}
let seq = 0
async function shadowRow(tag: string): Promise<{ id: string; title: string; body: string }> {
  seq += 1
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, sourceUrl: `https://example.invalid/ui${seq}`, sourceArticleId: `UI${seq}-x`, sourceCapturedAt: new Date(Date.now() - 864e5), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  const title = `화면 검사 ${tag}`
  const body = `오늘은 ${tag} 이야기를 해 볼게요. 다들 어떻게 지내세요?`
  const q = await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: title, draftBody: body, gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: 'machine:auto-draft-v5', dedupKey: `ui${seq}`, gateResults: GATE as never },
    select: { id: true },
  })
  return { id: q.id, title, body }
}
const bundleOf = (rows: { id: string; title: string; body: string }[]): string => JSON.stringify({
  items: rows.map((x) => ({
    group: 'undecidedShadow', queueId: x.id, source: null, draft: { title: x.title, body: x.body, titleDigest: digestOf(x.title), bodyDigest: digestOf(x.body) },
    edit: null, persona: null, semantic: { stored: null, restoredFromArtifact: null }, holds: [], blocks: [], restore: { klass: 'clean' },
  })),
})
const recCount = async (id: string): Promise<number> =>
  readEvidenceReviews((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })).editDiff).length

/** 제출 요청 본문의 entries queueId 들 — 🔴 bundleText 에는 모든 행 id 가 있으니 entries 만 본다 */
const sentIds = (postData: string | undefined): string[] => {
  try {
    const args = JSON.parse(postData ?? '') as { entries?: { queueId?: unknown }[] }[]
    return (args[0]?.entries ?? []).map((e) => String(e.queueId))
  } catch { return ['(해석 실패)'] }
}
const row = (page: Page, id: string) => page.locator(`section[data-queue-id="${id}"]`)
const pick = async (page: Page, id: string, name: string, value: string): Promise<void> => {
  await row(page, id).locator(`select[name="${name}"]`).selectOption(value)
}

async function main(): Promise<void> {
  console.log('\n══ 자동 READY 증거 — 실제 브라우저 화면 (격리 DB · localhost) ══\n')
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  const admin = await prisma.user.create({ data: { nickname: '화면관리자', isAdmin: true }, select: { id: true } })
  const token = await tokenFor(admin.id)

  const a = await shadowRow('가')
  const b = await shadowRow('나')
  const c = await shadowRow('다')
  const u = await shadowRow('폐기됨')
  const bundleText = bundleOf([a, b, c, u])

  // 🔴 운영 uili19gp 모양 — 폐기(OTHER) + 결함 yes. **실제 서버 액션**으로 만든다
  const seedRes = await fetch(`${BASE}/admin/auto-ready-evidence`, {
    method: 'POST',
    headers: { 'Next-Action': SUBMIT, 'Content-Type': 'text/plain;charset=UTF-8', cookie: `authjs.session-token=${token}` },
    body: JSON.stringify([{ bundleText, entries: [{ queueId: u.id, decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: ['생활사 모순'] }] }]),
  })
  await seedRes.text()
  const uRow = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: u.id } })
  check('선행 — 폐기(OTHER) 행을 실제 서버 액션으로 만들었다', uRow.status === 'DECLINED' && uRow.decidedBy === HUMAN_DECIDER && await recCount(u.id) === 1)

  const dir = mkdtempSync(join(tmpdir(), 'soran-ui-'))
  const file = join(dir, 'bundle.json')
  writeFileSync(file, bundleText)

  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 767, height: 1000 } })
    await ctx.addCookies([{ name: 'authjs.session-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
    const page = await ctx.newPage()
    let dialogs = 0
    page.on('dialog', (d) => { dialogs += 1; void d.dismiss() })
    const submits: string[] = []
    page.on('request', (r) => { if (r.method() === 'POST' && r.headers()['next-action'] === SUBMIT) submits.push(r.postData() ?? '') })

    const load = async (): Promise<void> => {
      await page.goto(`${BASE}/admin/auto-ready-evidence`)
      await page.setInputFiles('#bundle-file', file)
      await page.locator('[data-cta="review"]').waitFor()
    }
    await load()

    console.log('1. 🔴 지금 상태 — 이미 결정된 행에는 결정 칸이 없다')
    check('🔴 🔴 **폐기된 행(uili19gp 모양) → 내 기록 있음 · 잠김 · 결정 칸 0**',
      await row(page, u.id).getAttribute('data-phase') === 'recorded' && await row(page, u.id).getAttribute('data-locked') === 'yes'
      && await row(page, u.id).locator('select').count() === 0)
    check('결정 전 행 셋은 결정 칸이 있다', (await Promise.all([a, b, c].map((x) => row(page, x.id).locator('select[name="decision"]').count()))).every((n) => n === 1))
    check('🔴 아무것도 고르지 않으면 CTA 닫힘', await page.locator('[data-cta="review"]').isDisabled())

    console.log('\n2. 🔴 🔴 빈 판정은 보내기 전에 막는다')
    await pick(page, a.id, 'decision', 'ready')
    check('🔴 🔴 **결정만 고르고 결함 비움 → 행에 막힘 사유 · CTA 닫힘 · "막힌 행 1건"**',
      await row(page, a.id).locator('[data-row-issue]').count() === 1 && await page.locator('[data-cta="review"]').isDisabled()
      && (await page.locator('[data-cta="review"]').innerText()).includes('막힌 행 1건'))
    await pick(page, a.id, 'hardDefect', 'no')
    check('결함 없음을 고르면 막힘이 풀리고 "1건 기록 내용 확인"',
      await row(page, a.id).locator('[data-row-issue]').count() === 0 && !(await page.locator('[data-cta="review"]').isDisabled())
      && (await page.locator('[data-cta="review"]').innerText()).includes('1건'))

    console.log('\n3. 🔴 🔴 화면 안 확인 단계 · 같은 틱 두 번 클릭 · 고른 행만 전송')
    await page.locator('[data-cta="review"]').click()
    check('🔴 확인 단계 — 목록 1건 · 입력 칸 닫힘', await page.locator('[data-confirm-panel] li').count() === 1
      && await row(page, b.id).locator('select[name="decision"]').isDisabled())
    // 🔴 같은 틱에 두 번 누른다 — 렌더 전 두 번째 클릭은 ref 잠금만 막을 수 있다
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-cta="submit"]')
      btn?.click(); btn?.click()
    })
    await page.locator('[data-results]').waitFor()
    await page.waitForTimeout(500)
    check('🔴 🔴 **브라우저 기본 확인창 0**', dialogs === 0, String(dialogs))
    check('🔴 🔴 **제출 요청 정확히 1번(두 번 클릭)**', submits.length === 1, String(submits.length))
    const sent = sentIds(submits[0])
    check('🔴 🔴 **보낸 행은 고른 행 하나뿐 — 손대지 않은 행 · 잠긴 행 0**', sent.join(',') === a.id, sent.join(','))
    check('🔴 🔴 **DB — 고른 행 기록 1 · 나머지 0 · 폐기된 행 기록 그대로 1**',
      await recCount(a.id) === 1 && await recCount(b.id) === 0 && await recCount(c.id) === 0 && await recCount(u.id) === 1)
    check('🔴 🔴 **성공 행 즉시 잠금 — 결정 칸 사라짐 · 결과 "성공"**',
      await row(page, a.id).getAttribute('data-locked') === 'yes' && await row(page, a.id).locator('select').count() === 0
      && await row(page, a.id).locator('[data-result-tone="성공"]').count() === 1)
    check('🔴 확인 단계가 닫히고 결과 요약이 보인다', await page.locator('[data-confirm-panel]').count() === 0
      && (await page.locator('[data-results]').innerText()).includes('성공 1'))

    console.log('\n4. 🔴 🔴 새로 불러와도 결정 칸이 다시 나오지 않는다')
    await load()
    check('🔴 🔴 **새로 불러온 뒤 — 처리한 행 recorded · 결정 칸 0**',
      await row(page, a.id).getAttribute('data-phase') === 'recorded' && await row(page, a.id).locator('select').count() === 0)

    console.log('\n5. 🔴 🔴 부분 성공 — 하나는 성공, 하나는 묶음 이후 초안이 바뀜')
    await pick(page, b.id, 'decision', 'ready'); await pick(page, b.id, 'hardDefect', 'no')
    await pick(page, c.id, 'decision', 'reject'); await pick(page, c.id, 'declineReason', 'TOPIC_UNFIT'); await pick(page, c.id, 'hardDefect', 'no')
    // 화면이 상태를 읽은 **뒤** DB 초안이 바뀐다(묶음이 낡는다)
    await prisma.originalPostApprovalQueue.update({ where: { id: c.id }, data: { draftBody: `${c.body} (묶음 뒤 수정)` } })
    await page.locator('[data-cta="review"]').click()
    await page.locator('[data-cta="submit"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-result-tone]').length >= 2)
    check('🔴 🔴 **성공 행 — "성공" · 잠김**', await row(page, b.id).locator('[data-result-tone="성공"]').count() === 1 && await row(page, b.id).getAttribute('data-locked') === 'yes')
    check('🔴 🔴 **stale 행 — "거절" + 사유(초안이 바뀌었다) · write 0**',
      (await row(page, c.id).locator('[data-result-tone="거절"]').innerText()).includes('초안이 바뀌었다') && await recCount(c.id) === 0
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: c.id } })).decidedBy === 'machine:auto-draft-v5')
    check('🔴 stale 행은 다시 보낼 입력이 없다(새 묶음 필요)', await row(page, c.id).getAttribute('data-phase') === 'stale' && await row(page, c.id).locator('select').count() === 0)
    check('🔴 🔴 **이번 제출도 요청 1번 · 보낸 행 둘(b · c)뿐**', submits.length === 2 && sentIds(submits[1]).sort().join(',') === [b.id, c.id].sort().join(','), sentIds(submits[1]).join(','))

    console.log('\n6. 🔴 🔴 재검토 — 기본 잠금 · 누를 때만 결함 칸 · 결정 칸 0 · 성공하면 다시 잠금 (2026-09-27 P0 정정)')
    await load()
    const submitsBefore = submits.length
    const hist = async (id: string) => readEvidenceReviews((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })).editDiff).map((r) => r.hardDefect).join(',')
    check('🔴 🔴 **기록 행은 기본 잠금 — 입력 칸 0 · 재검토 버튼 있음**',
      await row(page, a.id).getAttribute('data-locked') === 'yes' && await row(page, a.id).locator('select, textarea').count() === 0
      && await row(page, a.id).locator('[data-cta="rereview"]').count() === 1)
    check('🔴 🔴 **재검토를 누르지 않은 기록 행 → 보낼 행 0 · CTA 닫힘 · 요청 0**',
      await page.locator('[data-cta="review"]').isDisabled() && submits.length === submitsBefore)
    await row(page, a.id).locator('[data-cta="rereview"]').click()
    check('🔴 🔴 **재검토 중 — 결정(ready/reject) 칸 0 · 결함 칸 1 · 다른 행은 잠긴 그대로**',
      await row(page, a.id).locator('select[name="decision"]').count() === 0 && await row(page, a.id).locator('select[name="hardDefect"]').count() === 1
      && await row(page, b.id).locator('select').count() === 0)
    await pick(page, a.id, 'hardDefect', 'yes')
    await row(page, a.id).locator('textarea[name="reasons"]').fill('생활사 모순')
    check('🔴 🔴 **미발행 승인 no → yes · 철회 없음 → 막힘(사유: 철회 필요) · CTA 닫힘**',
      (await row(page, a.id).locator('[data-row-issue]').innerText()).includes('철회와 철회 사유를 함께') && await page.locator('[data-cta="review"]').isDisabled())
    await row(page, a.id).locator('input[name="withdraw"]').check()
    check('🔴 철회만 하고 사유 없음 → 여전히 막힘', await page.locator('[data-cta="review"]').isDisabled())
    await pick(page, a.id, 'withdrawReason', 'TOPIC_UNFIT')
    await page.locator('[data-cta="review"]').click()
    await page.locator('[data-cta="submit"]').click()
    await page.locator('[data-cta="review"]').waitFor()
    await row(page, a.id).locator('[data-cta="rereview"]').waitFor()
    const aRow = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    check('🔴 🔴 **no → yes + 철회 → DECLINED · 기록 no,yes (+1 · 옛 기록 보존)**',
      aRow.status === 'DECLINED' && aRow.declineReason === 'TOPIC_UNFIT' && await hist(a.id) === 'no,yes', `${aRow.status} · ${await hist(a.id)}`)
    check('🔴 🔴 **요청 1번 · 보낸 행은 재검토한 행 하나뿐**', submits.length === submitsBefore + 1 && sentIds(submits[submits.length - 1]).join(',') === a.id)
    check('🔴 🔴 **성공 뒤 다시 잠금 — 입력 0 · 재검토 버튼 · 최신 판정 "있음" 표시**',
      await row(page, a.id).getAttribute('data-locked') === 'yes' && await row(page, a.id).locator('select, textarea').count() === 0
      && (await row(page, a.id).innerText()).includes('중대 결함 있음'))
    // 같은 판정 재제출 → unchanged · +0 (이제 폐기된 행이라 철회 칸은 없다)
    await row(page, a.id).locator('[data-cta="rereview"]').click()
    check('🔴 🔴 **이미 폐기된 행 재검토 — 철회 칸 0 (재폐기 없음)**',
      await (async () => { await pick(page, a.id, 'hardDefect', 'yes'); return await row(page, a.id).locator('input[name="withdraw"]').count() === 0 })())
    await row(page, a.id).locator('textarea[name="reasons"]').fill('생활사 모순')
    await page.locator('[data-cta="review"]').click()
    await page.locator('[data-cta="submit"]').click()
    await row(page, a.id).locator('[data-cta="rereview"]').waitFor()
    check('🔴 🔴 **같은 판정 재제출 → "성공 — 이미 기록" · 기록 +0**',
      (await row(page, a.id).locator('[data-result-tone="성공"]').innerText()).includes('이미 기록') && await hist(a.id) === 'no,yes')
    // yes → no
    await row(page, a.id).locator('[data-cta="rereview"]').click()
    await pick(page, a.id, 'hardDefect', 'no')
    await page.locator('[data-cta="review"]').click()
    await page.locator('[data-cta="submit"]').click()
    await row(page, a.id).locator('[data-cta="rereview"]').waitFor()
    const aNo = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    check('🔴 🔴 **yes → no → 기록 no,yes,no (+1) · DECLINED·사유 그대로 · 최신 "없음" 표시**',
      await hist(a.id) === 'no,yes,no' && aNo.status === 'DECLINED' && aNo.declineReason === 'TOPIC_UNFIT'
      && (await row(page, a.id).innerText()).includes('중대 결함 없음'), await hist(a.id))
    await load()
    check('🔴 🔴 **새로 불러와도 다시 잠김 · 최신 판정 없음**',
      await row(page, a.id).getAttribute('data-locked') === 'yes' && (await row(page, a.id).innerText()).includes('중대 결함 없음'))
    check('🔴 🔴 **끝까지 브라우저 기본 확인창 0**', dialogs === 0)
  } finally {
    await browser.close()
  }

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · localhost 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()
