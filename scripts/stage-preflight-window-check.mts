#!/usr/bin/env tsx
/**
 * 🔴 **preflight 시계 둘 — 증명 창(전날 KST 달력일)과 용량 창(`now` 에서 72h)** 반례 (2026-10-20 D10 preflight 시계 결함)
 *
 *   SORAN_ISOLATED_DB=yes-throwaway DATABASE_URL=postgresql://…@127.0.0.1:PORT/soran_test npx tsx scripts/stage-preflight-window-check.mts
 *
 * 운영 실측: 06:15 자연 공급이 READY 를 만들었는데 07:00 판정의 용량 창 끝이 오늘 00:00 KST 에 멈춰 있어
 * readyRaw=0 · worksetSources 가 전날 것만 셌다. 이 파일은 같은 모양을 격리 DB 에서 다시 만들어
 *   ① 순수 — `preflightWindowsOf` 의 증명 창이 `now` 에 흔들리지 않고, 용량 창이 정확히 `[now − 72h, now)` 이다.
 *   ② DB   — `readPreflightFacts` 가 06:15 회차를 07:00 판정에 넣고, `now` 이후 · 72h 이전 회차는 뺀다.
 *   ③ 읽기 전용 — 호출 전후 큐 행 수가 같다.
 * 를 잰다. 🔴 격리 DB 가 아니면 멈춘다(주소는 찍지 않는다). 🔴 HOME 을 임시 디렉터리로 고정한 뒤 장부 모듈을 불러온다.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ISOLATION_SENTINEL_ENV = 'SORAN_ISOLATED_DB'
const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env[ISOLATION_SENTINEL_ENV] ?? '').trim() !== 'yes-throwaway') problems.push(`${ISOLATION_SENTINEL_ENV}=yes-throwaway 가 없다`)
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

// 🔴 장부 · 데이터 경로가 이 머신의 실제 HOME 으로 가지 않게 먼저 고정한다 — 아래 모듈은 전부 그 뒤에 불러온다
const HOME = mkdtempSync(join(tmpdir(), 'pf-window-home-'))
process.env.HOME = HOME

const { PrismaClient } = await import('@prisma/client')
const { preflightWindowsOf, readPreflightFacts, CAPACITY_WINDOW_MS } = await import('./lib/stage-preflight-facts.mjs')
const { loadPublishableStock } = await import('./lib/publishable-stock.mjs')
const { defaultLedgerDir, ledgerPathOf } = await import('./lib/llm-ledger-store.mjs')
const { buildSourceEvidence, articleIdHashOf } = await import('../src/lib/source-slot-release')
const { WORKSET_KIND, WORKSET_VERSION_JIT, SUPPLY_JIT_CONTRACT, SUPPLY_INTENT_KEY, worksetFileName } = await import('../src/lib/supply-workset')
const { currentQualityContract } = await import('../src/lib/quality-contract')
const { AUTO_DECIDER } = await import('../src/lib/auto-ready-v2')
const { profileOf, releaseCapsOf } = await import('../src/lib/scale-profile')
const { slotTimesOn } = await import('../src/lib/stage-ladder-generic')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const kst = (s: string): Date => new Date(`${s}+09:00`)
const iso = (d: Date): string => d.toISOString()

console.log('\n① 🔴 순수 — preflightWindowsOf')
{
  const now = kst('2026-10-20T07:00:00')
  const w = preflightWindowsOf('2026-10-19', now)
  check('증명 창 = 전날 KST 달력일 3일 [10-17 00:00, 10-20 00:00)',
    iso(w.proof.from) === iso(kst('2026-10-17T00:00:00')) && iso(w.proof.to) === iso(kst('2026-10-20T00:00:00'))
    && w.proof.dates.join() === '2026-10-17,2026-10-18,2026-10-19', JSON.stringify(w.proof))
  check('🔴 용량 창 = [now − 72h, now) — 06:15 회차(10-20)가 안에 든다',
    iso(w.capacity.from) === iso(kst('2026-10-17T07:00:00')) && iso(w.capacity.to) === iso(now)
    && w.capacity.to.getTime() - w.capacity.from.getTime() === CAPACITY_WINDOW_MS && CAPACITY_WINDOW_MS === 72 * 3_600_000,
    JSON.stringify(w.capacity))
  check('🔴 용량 창 끝이 증명 창 끝(오늘 00:00 KST)에 멈추지 않는다', w.capacity.to.getTime() > w.proof.to.getTime())
  check('🔴 장부 날짜 = 창이 걸친 KST 4일 + 다음 날 파일(오늘 장부 포함)',
    w.capacity.ledgerDates.join() === '2026-10-17,2026-10-18,2026-10-19,2026-10-20,2026-10-21', w.capacity.ledgerDates.join())
  const later = preflightWindowsOf('2026-10-19', kst('2026-10-20T23:59:59'))
  check('🔴 전날 증명 창은 now 가 움직여도 그대로 — 오늘 데이터가 새지 않는다',
    iso(later.proof.from) === iso(w.proof.from) && iso(later.proof.to) === iso(w.proof.to) && later.proof.dates.join() === w.proof.dates.join())
  check('🔴 증명 창에 오늘(10-20) 날짜가 없다', !w.proof.dates.includes('2026-10-20') && !later.proof.dates.includes('2026-10-20'))
  const mid = preflightWindowsOf('2026-10-20', kst('2026-10-21T00:00:00'))
  check('🔴 KST 자정 정각 — 창 끝은 자정 그대로 · 그날(10-21) 파일은 장부 날짜가 아니라 다음 날(spill)로만 든다',
    iso(mid.capacity.to) === iso(kst('2026-10-21T00:00:00')) && mid.capacity.ledgerDates.join() === '2026-10-18,2026-10-19,2026-10-20,2026-10-21',
    mid.capacity.ledgerDates.join())
  const justAfter = preflightWindowsOf('2026-10-20', kst('2026-10-21T00:00:01'))
  check('🔴 자정 1초 뒤 — 10-21 장부가 날짜에 든다', justAfter.capacity.ledgerDates.includes('2026-10-21') && justAfter.capacity.ledgerDates.at(-1) === '2026-10-22',
    justAfter.capacity.ledgerDates.join())
}

console.log('\n② 🔴 DB — 06:15 자연 공급이 07:00 판정에 든다 (운영 2026-10-20 모양)')
const prisma = new PrismaClient()
const site = 'fixture:pf-window'
const QUALITY = currentQualityContract()
const dir = mkdtempSync(join(tmpdir(), 'pf-window-data-'))
const runIdAt = (d: Date): string => `${iso(d).slice(0, 10).replace(/-/g, '')}-${iso(d).slice(11, 19).replace(/:/g, '')}`
const wipe = async (): Promise<void> => {
  await prisma.originalPostApprovalQueue.deleteMany({ where: { dedupKey: { startsWith: 'pfw-' } } })
  await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: site } })
}
const writeRun = (runAt: Date, n: number, ids: readonly string[] = []): string => {
  const runId = runIdAt(runAt)
  writeFileSync(join(dir, worksetFileName(runId)), JSON.stringify({
    kind: WORKSET_KIND, version: WORKSET_VERSION_JIT, contract: SUPPLY_JIT_CONTRACT, qualityContract: QUALITY, runId,
    takenAt: iso(runAt), limit: 10,
    sources: Array.from({ length: n }, (_, i) => ({
      sourceSite: site, sourceArticleId: ids[i] ?? `${runId}-${i}`, slotAt: '2026-10-20T00:00:00.000Z', ageAtSlotH: 5,
    })),
  }))
  return runId
}
try {
  await wipe()
  const NOW = kst('2026-10-20T07:00:00')
  // 회차: 06:15(10-20) 오늘 아침 10 · 06:15(10-19) 7 · 정확히 창 시작(10-17 07:00) 4 · 1초 전 3 · 07:15 (now 이후) 9 · 정확히 now 6
  const morning = writeRun(kst('2026-10-20T06:15:00'), 10, ['pfw-0', 'pfw-1', 'pfw-2', 'pfw-future'])
  writeRun(kst('2026-10-19T06:15:00'), 7)
  writeRun(kst('2026-10-17T07:00:00'), 4)
  writeRun(kst('2026-10-17T06:59:59'), 3)
  writeRun(kst('2026-10-20T07:15:00'), 9)
  writeRun(NOW, 6)
  // 06:15 회차가 만든 READY 3건 — 공개로 끝남(결말 확정)
  for (let k = 0; k < 3; k += 1) {
    const raw = await prisma.microSeedRawContent.create({
      data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/pfw${k}`, sourceArticleId: `pfw-${k}`,
        sourceCapturedAt: kst('2026-10-20T06:00:00'), rawTitle: `원문 ${k}`, rawBody: `원문 본문 ${k}` },
      select: { id: true },
    })
    await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: raw.id, status: 'PUBLISHED', draftTitle: `초안 ${k}`, draftBody: `본문 ${k}`,
        gateResults: {
          sourceEvidence: buildSourceEvidence({ sourceSite: site, sourceArticleId: `pfw-${k}` }),
          [SUPPLY_INTENT_KEY]: {
            contract: SUPPLY_JIT_CONTRACT, runId: morning, sourceHash: articleIdHashOf(site, `pfw-${k}`),
            intendedSlotAt: '2026-10-20T00:00:00.000Z', ageAtSlotH: 5, qualityContract: QUALITY,
          },
        } as never,
        gateVerdict: 'PASS', promptVersion: 'pfw', model: 'pfw',
        decidedBy: AUTO_DECIDER, decidedAt: kst('2026-10-20T06:40:00'), dedupKey: `pfw-${k}`,
        createdAt: kst('2026-10-20T06:30:00') },
    })
  }
  // 같은 창 안 회차를 주장해도 큐 행 자체가 스냅샷 뒤면 아직 존재하지 않은 사건이다.
  const futureRaw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: site, sourceUrl: 'https://example.invalid/pfw-future', sourceArticleId: 'pfw-future',
      sourceCapturedAt: kst('2026-10-20T07:20:00'), rawTitle: '미래 원문', rawBody: '미래 원문 본문' },
    select: { id: true },
  })
  await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: futureRaw.id, status: 'PUBLISHED', draftTitle: '미래 초안', draftBody: '미래 본문',
      gateResults: {
        sourceEvidence: buildSourceEvidence({ sourceSite: site, sourceArticleId: 'pfw-future' }),
        [SUPPLY_INTENT_KEY]: {
          contract: SUPPLY_JIT_CONTRACT, runId: morning, sourceHash: articleIdHashOf(site, 'pfw-future'),
          intendedSlotAt: '2026-10-20T00:00:00.000Z', ageAtSlotH: 5, qualityContract: QUALITY,
        },
      } as never,
      gateVerdict: 'PASS', promptVersion: 'pfw', model: 'pfw', decidedBy: AUTO_DECIDER,
      decidedAt: kst('2026-10-20T07:30:00'), dedupKey: 'pfw-future', createdAt: kst('2026-10-20T07:20:00') },
  })
  // 🔴 지연 조회가 실제로 어느 창으로 나가는지 본다 — 진짜 DB 위에서 인자만 엿본다(결과를 바꾸지 않는다)
  const latencyWindows: { gte: Date; lt: Date }[] = []
  type Where = { where?: { kind?: string; createdAt?: { gte?: Date; lt?: Date } } }
  const spy = new Proxy(prisma, {
    get(t, p, r) {
      const v: unknown = Reflect.get(t, p, r)
      if (p !== 'personaActivityLog') return v
      const log = v as { findMany: (a: Where) => unknown }
      return new Proxy(log, {
        get(t2, p2, r2) {
          const f: unknown = Reflect.get(t2, p2, r2)
          if (p2 !== 'findMany') return f
          return (a: Where) => {
            const w = a.where?.createdAt
            if (a.where?.kind === 'post' && w?.gte !== undefined && w.lt !== undefined) latencyWindows.push({ gte: w.gte, lt: w.lt })
            return log.findMany(a)
          }
        },
      })
    },
  })
  const facts = async (now: Date) => readPreflightFacts(spy, {
    loaded: await loadPublishableStock(prisma, now, { autoReadyOpen: false }),
    autoOpen: { open: false, reasons: [] }, proofSlots: slotTimesOn('2026-10-20', profileOf('d5')),
    caps: releaseCapsOf(profileOf('d5')), evidenceDate: '2026-10-19', env: {}, dataDir: dir, now,
    runnerHealth: 'ok', contractValidPersonas: async () => 30,
  })
  const before = await prisma.originalPostApprovalQueue.count()
  const r = await facts(NOW)
  const c = r.facts.readyCohort
  // 새 창: 06:15(10) + 06:15 어제(7) + 창 시작 정각(4) = 21. 앞판(끝 = 오늘 00:00): 06:15 어제(7) + 1초 전(3) + 창 시작 정각(4)… 아래 별도 대조
  check('🔴 worksetSources = 21 — 06:15 회차 10 포함 · 창 시작 정각 4 포함 · 1초 전 3 · now 이후 9 · 정확히 now 6 제외',
    r.detail.worksetSources === 21, String(r.detail.worksetSources))
  check('🔴 06:15 회차 READY 3건이 cohort 에 들고 같은 회차를 주장한 스냅샷 이후 큐 행은 빠진다',
    r.detail.readyCount === 3 && c !== null && c.sources === 21 && c.published === 3, JSON.stringify({ readyCount: r.detail.readyCount, c }))
  check('🔴 전날 증명 — 지연 조회 창 = [10-17 00:00, 10-20 00:00) · 댓글/감사 단가 날짜에 오늘(10-20)이 없다',
    latencyWindows.length === 1 && iso(latencyWindows[0]!.gte) === iso(kst('2026-10-17T00:00:00'))
    && iso(latencyWindows[0]!.lt) === iso(kst('2026-10-20T00:00:00'))
    && JSON.stringify(r.detail.unitCostDates) === JSON.stringify(['2026-10-17', '2026-10-18', '2026-10-19']),
    JSON.stringify({ latencyWindows, unit: r.detail.unitCostDates }))
  check('🔴 보고된 창 — 용량 [now − 72h, now) · 증명 [10-17 00:00, 10-20 00:00)',
    JSON.stringify(r.detail.capacityWindow) === JSON.stringify({ from: iso(kst('2026-10-17T07:00:00')), to: iso(NOW) })
    && JSON.stringify(r.detail.proofWindow) === JSON.stringify({ from: iso(kst('2026-10-17T00:00:00')), to: iso(kst('2026-10-20T00:00:00')) }),
    JSON.stringify({ c: r.detail.capacityWindow, p: r.detail.proofWindow }))

  // 🔴 now 가 06:00 이면 06:15 회차는 아직 없는 사건 — 같은 DB 행이 있어도 cohort 에 들지 않는다(snapshot 이후 제외)
  const early = await facts(kst('2026-10-20T06:00:00'))
  check('🔴 now = 06:00 — 06:15 회차 · 그 READY 는 스냅샷 이후라 제외(worksetSources 14 · readyCount 0)',
    early.detail.worksetSources === 14 && early.detail.readyCount === 0, JSON.stringify({ w: early.detail.worksetSources, r: early.detail.readyCount }))
  // 🔴 KST 자정 정각 — 10-19 22:00~ 이후 회차가 now 에 맞춰 정확히 갈린다
  writeRun(kst('2026-10-20T23:59:59'), 2)
  writeRun(kst('2026-10-21T00:00:00'), 5)
  const mid = await facts(kst('2026-10-21T00:00:00'))
  // 창 [10-18 00:00, 10-21 00:00): 06:15(10-19) 7 + 06:15(10-20) 10 + 07:15(10-20) 9 + 정각 now(10-20 07:00) 6 + 23:59:59 2 = 34 · 정각 자정 5 제외
  check('🔴 now = 10-21 00:00:00 정확히 — 23:59:59 회차(2) 포함 · 00:00:00 회차(5) 제외',
    mid.detail.worksetSources === 34, String(mid.detail.worksetSources))

  // 🔴 장부: 오늘(10-20) 공급 장부가 손상이면 용량 창이 걸친 날이므로 모른다 — 증명 날짜만 봤다면 놓친다
  const ledgerDir = defaultLedgerDir()
  mkdirSync(ledgerDir, { recursive: true })
  const okLedger = (await facts(NOW)).notes.some((n) => n.includes('공급 장부가 손상'))
  writeFileSync(ledgerPathOf(ledgerDir, '2026-10-20'), '{ 손상\n')
  const badLedger = (await facts(NOW)).notes.some((n) => n.includes('공급 장부가 손상'))
  check('🔴 오늘(10-20) 공급 장부 손상 → 용량 창이 읽으므로 모른다 (손상 전에는 알림 없음)', !okLedger && badLedger, JSON.stringify({ okLedger, badLedger }))

  check('🔴 읽기 전용 — 호출 전후 큐 행 수가 같다', (await prisma.originalPostApprovalQueue.count()) === before)
} finally {
  rmSync(dir, { recursive: true, force: true })
  rmSync(HOME, { recursive: true, force: true })
  await wipe().catch(() => undefined)
  await prisma.$disconnect()
}
console.log(`\n${fail === 0 ? '✅' : '🔴'} stage-preflight-window-check — 통과 ${pass} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
