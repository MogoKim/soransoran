#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 품질 계약 cohort — 실행 반례 (격리 Postgres 전용)** (2026-09-27 마스터 결정)
 *
 *   ① legacy 결함 yes(uili 모양)는 이력으로 남고 새 cohort 를 막지 않는다 — 30건(27 무수정 · 3 폐기) → 열림
 *   ② 1번 미검토 + 뒤 30건 좋음 → 첫 차단 #1 은 그대로 계산 · (quality-v4) 열림 근거는 창업자 gold 라 열림
 *   ③ 창 안 · 창 밖 결함 yes → 닫힘 · 26/30 은 그대로 센다(v4 열림 근거 아님) · 같은 사람 정정(append-only) 존중
 *   ④ 열림이어도 legacy 결정 전 행은 도장 0 · 우회 도장도 발행 재검증이 막는다(Post 0) · 지금 계약 행은 찍힌다
 *   ⑤ 열림이어도 발행 뒤 감사 결함 1 → 닫힘(전역 차단)
 *   ⑥ 의미 검수 복원은 지금 계약 행을 쓰지 않는다(계획 skip · 위조 계획도 적용 0)
 *   ⑦ 검토 묶음 — 창 안 행을 생성 순서로 · 첫 차단 표시 · 재고 분류(HRR)가 아닌 창 안 행도 포함
 *   ⑧ 실제 적재기(--apply) — 수정 전 파일 0 · 위조 digest 0 · env 주입 무시 · 지금 파일은 코드 상수로 저장
 *
 * 🔴 사람 기록은 **정본 서버 경계 함수**(`recordHumanBatch` — 관리자 서버 액션이 부르는 것)로만 만든다.
 * 🔴 운영 DB 에 절대 붙이지 않는다(sentinel · localhost · soran_test). 모델 호출 0.
 *
 *   npm run auto-ready:quality-db-check
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

const { PrismaClient } = await import('@prisma/client')
const { currentQualityContract, qualityContractDigest, QUALITY_CONTRACT_KEY, QUALITY_CONTRACT_VERSION } = await import('../src/lib/quality-contract')
const { evidenceFromDb, legacyEvidenceFromDb, authoritativeGate, stampRound } = await import('../src/lib/auto-ready-repo')
const { recordHumanBatch, planSemanticRestore, applySemanticRestore } = await import('../src/lib/auto-ready-evidence-store')
const { digestOf, readEvidenceReviews } = await import('../src/lib/auto-ready-evidence')
const { AUTO_DECIDER, AUTO_READY_RECORD_KEY, AUDIT_CONTRACT_VERSION, makeStamp } = await import('../src/lib/auto-ready-v2')
const { publishOriginalPostTx } = await import('../src/lib/original-post-publish-tx')
const af = await import('../src/lib/micro-seed-supply-autofill')
const { selectBundleRows } = await import('./lib/auto-ready-bundle-select.mjs')
const fxMod = await import('./lib/draft-gate-fixtures.mjs')
const { candidateEnvelope } = await import('./lib/candidate-envelope.mjs')
const { STAGE_MODEL } = await import('./lib/content-core-run.mjs')
const { DRAFT_RULE_VERSION, DRAFT_PROVENANCE } = await import('../src/lib/micro-seed-auto-draft')
const { copiesSourceTitle, SOURCE_TITLE_CHECK_VERSION } = await import('../src/lib/draft-originality')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x)) ?? 'undefined'

const NOW = new Date()
const CAP = new Date(NOW.getTime() - 2 * 864e5)
const T0 = NOW.getTime() - 30 * 864e5
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const GOOD_SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY 품질 계약 cohort — 실행 반례 (격리 DB 전용 · 운영 DB 0) ══\n')
  const wipe = () => prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE',
  )
  await wipe()

  let seq = 0
  let admin = ''
  let author = ''
  const setup = async () => {
    await wipe()
    admin = (await prisma.user.create({ data: { nickname: '검토자', isAdmin: true }, select: { id: true } })).id
    author = (await prisma.user.create({ data: { nickname: '작성자' }, select: { id: true } })).id
  }
  /** 🔴 적재기가 만드는 모양 — 결정 전(machine:*) · APPROVED · 생성 순서는 createdAt */
  const seed = async (o: { legacy?: boolean; holds?: string[]; status?: 'APPROVED' | 'EXPIRED'; persona?: { id: string; code: string } } = {}) => {
    seq += 1
    const k = seq
    const raw = await prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${af.MACHINE_SITE_PREFIX}navercafe:q`, sourceUrl: `https://example.invalid/q${k}`,
        sourceArticleId: `Q${10000 + k}-cafe`, sourceCapturedAt: CAP, rawTitle: `원문 ${k}`, rawBody: `원문 본문 ${k}`,
      },
      select: { id: true },
    })
    const title = `평범한 하루 이야기 ${k}`
    const body = `아침에 산책을 다녀왔어요 ${k}. 다들 어떻게 지내세요?`
    const row = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: raw.id, status: o.status ?? 'APPROVED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', promptVersion: af.MACHINE_PROMPT_VERSION, model: af.MACHINE_MODEL,
        decidedBy: af.MACHINE_DECIDED_BY, decidedAt: NOW, dedupKey: `qdk-${k}`,
        createdAt: new Date(T0 + k * 60_000),
        ...(o.persona === undefined ? {} : { matchedPersonaId: o.persona.id, matchedAt: NOW }),
        gateResults: {
          holds: o.holds ?? [], blocks: [], semanticReview: GOOD_SR,
          autoDraft: {
            provenance: af.MACHINE_PROFILE.envelopeProvenance, sourceDecision: af.MACHINE_PROFILE.sourceDecision,
            draftRuleVersion: af.MACHINE_PROFILE.envelopeRuleVersion,
            ...(o.persona === undefined ? {} : { voice: { personaCode: o.persona.code, bundleDigest: `bd-${o.persona.code}`, comments: 3 } }),
          },
          ...(o.legacy === true ? {} : { [QUALITY_CONTRACT_KEY]: currentQualityContract() }),
        } as never,
      },
      select: { id: true, draftTitle: true, draftBody: true },
    })
    return row
  }
  type Seeded = Awaited<ReturnType<typeof seed>>
  const bundleOf = (rows: Seeded[], tag: string) => ({
    digest: digestOf(`bundle-${tag}`),
    items: rows.map((r) => ({ queueId: r.id, draftTitleDigest: digestOf(r.draftTitle), draftBodyDigest: digestOf(r.draftBody) })),
  })
  let clock = 0
  /** 🔴 사람 기록 — 관리자 서버 액션이 부르는 **정본 경계 함수** 그대로 */
  const review = async (rows: Seeded[], e: { decision?: 'ready' | 'reject'; hardDefect: 'yes' | 'no'; withdraw?: boolean }, tag: string, user = admin) => {
    clock += 1
    const res = await recordHumanBatch(prisma, {
      actor: { userId: user, reviewer: 'human:operator' }, now: new Date(NOW.getTime() + clock * 1000), bundle: bundleOf(rows, tag),
      entries: rows.map((r) => ({
        queueId: r.id, ...(e.decision === undefined ? {} : { decision: e.decision }),
        ...(e.decision === 'reject' || e.withdraw === true ? { declineReason: 'TOPIC_UNFIT' } : {}),
        hardDefect: e.hardDefect, reasons: e.hardDefect === 'yes' ? ['생활사 모순'] : [],
        ...(e.withdraw === true ? { withdraw: true } : {}),
      })),
    })
    const bad = res.filter((x) => !['recorded', 'decidedAndRecorded', 'withdrawnAndRecorded'].includes(x.result))
    if (bad.length > 0) throw new Error(`기록 실패 ${tag}: ${JSON.stringify(bad.slice(0, 2))}`)
  }
  const snap = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })

  // ─────────────────────────────────────────────────────────
  console.log('① 🔴 legacy 결함 yes 는 이력 · 새 cohort 는 열린다')
  // ─────────────────────────────────────────────────────────
  await setup()
  const uili = await seed({ legacy: true })
  await review([uili], { decision: 'reject', hardDefect: 'yes' }, 'uili')
  const uiliBefore = await snap(uili.id)
  const legacyGood = await Promise.all([0, 1].map(() => seed({ legacy: true })))
  await review(legacyGood, { decision: 'ready', hardDefect: 'no' }, 'legacy-good')
  const cur: Seeded[] = []
  for (let i = 0; i < 30; i += 1) cur.push(await seed())
  {
    const v0 = await evidenceFromDb(prisma)
    /**
     * 🔴 (quality-v4) 첫 차단 행은 **그대로 계산**한다(사람 표본 보고용). 다만 v4 열림 근거는 창업자 gold 라
     *    미검토 선행 행이 열림을 막지 않는다 — v3 의 "사람 30건" 요구를 v4 가 의도적으로 대체했다.
     */
    check('🔴 🔴 **#4 지금 계약 30건 모두 미검토 → 첫 차단 #1 은 그대로 · v4 열림은 창업자 gold**',
      v0.meetsContract && v0.basis === 'founderGold' && v0.firstBlocking?.index === 1 && v0.firstBlocking.id === cur[0]!.id, v0.reasons.join(' · '))
    await review(cur.slice(0, 27), { decision: 'ready', hardDefect: 'no' }, 'c-ready')
    await review(cur.slice(27), { decision: 'reject', hardDefect: 'no' }, 'c-reject')
    const v = await evidenceFromDb(prisma)
    check('🔴 🔴 **#2 legacy uili 모양(폐기 · 결함 yes) + 지금 계약 30(27 무수정 · 3 폐기) → 열림**',
      v.meetsContract && v.eligible === 30 && v.noEdit === 27 && v.declined === 3 && v.cohortHardDefects === 0, v.reasons.join(' · '))
    check('🔴 🔴 **#1 legacy 3행(uili 모양 + 무수정 2)은 수열에 없다 — DB 에서 digest 로 좁혀 읽지도 않는다**', v.sequence === 30 && !v.windowIds.includes(uili.id) && !legacyGood.some((r) => v.windowIds.includes(r.id)))
    const lg = await legacyEvidenceFromDb(prisma)
    check('🔴 🔴 **#8 legacy 결함은 이력에 그대로 보인다 (legacy 보고 결함 1)**', lg.hardDefects === 1 && lg.eligible === 3, JSON.stringify({ e: lg.eligible, hd: lg.hardDefects }))
    const uiliAfter = await snap(uili.id)
    check('🔴 🔴 **#8 uili 모양 행은 한 글자도 바뀌지 않았다 (editDiff · status · 사유 · updatedAt)**',
      stable(uiliAfter.editDiff) === stable(uiliBefore.editDiff) && uiliAfter.status === 'DECLINED'
      && uiliAfter.declineReason === uiliBefore.declineReason && uiliAfter.updatedAt.getTime() === uiliBefore.updatedAt.getTime())
    check('🔴 게이트(스위치 ON) 열림', (await authoritativeGate(prisma, ON)).open)
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n④ 🔴 열림이어도 legacy 는 자동으로 나가지 않는다 · 지금 계약 행은 찍힌다')
  // ─────────────────────────────────────────────────────────
  {
    const pu = await prisma.user.create({ data: { nickname: 'P자동' }, select: { id: true } })
    const persona = await prisma.persona.create({ data: { code: 'F901', userId: pu.id, status: 'active' }, select: { id: true, code: true } })
    const pu2 = await prisma.user.create({ data: { nickname: 'P자동2' }, select: { id: true } })
    const persona2 = await prisma.persona.create({ data: { code: 'F902', userId: pu2.id, status: 'active' }, select: { id: true, code: true } })
    const legacyPending = await seed({ legacy: true, persona })
    const curPending = await seed({ persona: persona2 })
    const tally = await stampRound(prisma, { env: ON, now: NOW })
    const lp = await snap(legacyPending.id)
    const cp = await snap(curPending.id)
    check('🔴 🔴 **#13 열림 · legacy 결정 전 행 → 도장 0 (skip)**', lp.decidedBy === af.MACHINE_DECIDED_BY && (tally.get('skip') ?? 0) >= 1, [...tally].map(([k, x]) => `${k} ${x}`).join(' '))
    check('🟢 대조 — 지금 계약 결정 전 행(창 밖)은 도장이 찍힌다', cp.decidedBy === AUTO_DECIDER)
    // 우회 — 도장을 직접 찍은 legacy 행
    await prisma.originalPostApprovalQueue.update({
      where: { id: legacyPending.id },
      data: { decidedBy: AUTO_DECIDER, editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(lp.draftTitle, lp.draftBody, NOW) } as never },
    })
    const posts0 = await prisma.post.count()
    const p = await publishOriginalPostTx(prisma, { queueId: legacyPending.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **#13 우회 도장 legacy 행 → 발행 재검증이 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && p.detail.includes('legacy') && (await prisma.post.count()) === posts0, JSON.stringify(p))
    const pc = await publishOriginalPostTx(prisma, { queueId: curPending.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🟢 대조 — 지금 계약 도장 행은 발행 재검증을 통과한다 (AUTO_READY_RECHECK 아님)', !(pc.kind === 'blocked' && pc.code === 'AUTO_READY_RECHECK'), JSON.stringify(pc))

    // ⑤ 전역 차단 — 발행 뒤 감사 결함
    console.log('\n⑤ 🔴 열림이어도 발행 뒤 감사 결함 1 → 닫힘 (판과 무관)')
    check('대조 — 지금 열림', (await authoritativeGate(prisma, ON)).open)
    const post = await prisma.post.create({ data: { boardType: 'FREE', title: '자동 발행 글', content: '본문', authorId: author }, select: { id: true } })
    const aq = await seed({ legacy: true })
    await prisma.originalPostApprovalQueue.update({ where: { id: aq.id }, data: { status: 'PUBLISHED', decidedBy: AUTO_DECIDER, createdPostId: post.id } })
    await prisma.autoReadyAudit.create({
      data: {
        queueId: aq.id, postId: post.id, selectedAtN: 1, selectedTarget: 1,
        publishedTitleHash: digestOf('자동 발행 글'), publishedBodyHash: digestOf('본문'), stampContractDigest: 'x',
        defect: 'yes', judgedAt: NOW, auditor: 'rule-auditor', note: '감사 결함',
        auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: 'rule', auditPromptVersion: 'rule-v1',
      },
    })
    const g = await authoritativeGate(prisma, ON)
    check('🔴 🔴 **#14 cohort 는 충족인데 감사 결함 yes 1 → 닫힘**', !g.open && (await evidenceFromDb(prisma)).meetsContract && g.reasons.some((r) => r.includes('확정 결함')), g.reasons.join(' · '))
    const t2 = await stampRound(prisma, { env: ON, now: NOW })
    check('🔴 #14 그 상태에서 도장 0', (t2.get('stamped') ?? 0) === 0)
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n⑥ 🔴 의미 검수 복원은 지금 계약 행을 쓰지 않는다')
  // ─────────────────────────────────────────────────────────
  {
    const target = cur[0]!
    const before = await snap(target.id)
    const plan = (await planSemanticRestore(prisma, new Map(), new Map(), NOW)).find((x) => x.id === target.id)
    check('🔴 🔴 **#16 계획 — 지금 계약 행은 skip**', plan !== undefined && plan.action === 'skip' && plan.reasons[0]!.includes('품질 계약'), JSON.stringify(plan?.reasons?.slice(0, 1)))
    const forged = { ...plan!, action: 'write' as const, changes: { column: 'gateResults' as const, keys: ['semanticReview'] },
      nextGateResults: { ...(before.gateResults as Record<string, unknown>), semanticReview: { ...GOOD_SR, confidence: 0.1 } } }
    const n = await applySemanticRestore(prisma, forged)
    const after = await snap(target.id)
    check('🔴 🔴 **#16 위조한 쓰기 계획도 적용 0 · gateResults 그대로**', n === 0 && stable(after.gateResults) === stable(before.gateResults))
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n② 🔴 선행 미검토 · 창 안팎 결함 · 26/30 · 정정')
  // ─────────────────────────────────────────────────────────
  {
    await setup()
    const first = await seed()
    const rest: Seeded[] = []
    for (let i = 0; i < 30; i += 1) rest.push(await seed())
    await review(rest, { decision: 'ready', hardDefect: 'no' }, 'rest')
    const v = await evidenceFromDb(prisma)
    check('🔴 🔴 **#4 1번 미검토 + 뒤 30건 좋음 → 첫 차단 #1 · 표본 29 그대로 셈 · v4 열림(gold)**',
      v.meetsContract && v.firstBlocking?.id === first.id && v.eligible === 29, v.reasons.join(' · '))
    // 🔴 도장 회차는 돌리지 않는다 — 열려 있으니 미검토 1번에 실제로 도장이 찍혀 뒤 단계(사람 기록)가 달라진다. 게이트만 본다
    check('🔴 #4 그 상태에서 게이트(스위치 ON)는 열림(v4 · 증거 충족)', (await authoritativeGate(prisma, ON)).open)
    await review([first], { decision: 'reject', hardDefect: 'no' }, 'first')
    const v2 = await evidenceFromDb(prisma)
    check('🔴 🔴 **#4 1번을 폐기(no)로 기록 → 창 1~30 · 무수정 29 · 열림**', v2.meetsContract && v2.declined === 1 && v2.noEdit === 29 && v2.windowIds[0] === first.id, v2.reasons.join(' · '))

    // 창 밖 결함 — 35번째 행을 폐기 + yes
    const extra: Seeded[] = []
    for (let i = 0; i < 4; i += 1) extra.push(await seed())
    const bad = await seed()
    await review([bad], { decision: 'reject', hardDefect: 'yes' }, 'bad-out')
    const v3 = await evidenceFromDb(prisma)
    check('🔴 🔴 **#5 창 밖(36번째) 결함 yes → 그 계약 실패 · 닫힘**', !v3.meetsContract && v3.cohortHardDefects === 1 && v3.hardDefects === 0, v3.reasons.join(' · '))
    // 같은 사람의 정정(append-only) — yes → no
    await review([bad], { hardDefect: 'no' }, 'bad-fix')
    const hist = readEvidenceReviews((await snap(bad.id)).editDiff)
    const v4 = await evidenceFromDb(prisma)
    check('🔴 🔴 **#15 같은 사람 yes → no 정정 → 기록 2개(이력 보존) · 최신 no · 다시 열림**',
      hist.length === 2 && hist.map((r) => r.hardDefect).join(',') === 'yes,no' && v4.meetsContract, v4.reasons.join(' · '))
    // 다른 사람 yes
    const other = (await prisma.user.create({ data: { nickname: '검토자B', isAdmin: true }, select: { id: true } })).id
    await review([bad], { hardDefect: 'yes' }, 'bad-b', other)
    check('🔴 🔴 **#15 다른 사람 yes → 닫힘 (누군가 yes 면 yes)**', !(await evidenceFromDb(prisma)).meetsContract)
  }
  {
    await setup()
    const rows: Seeded[] = []
    for (let i = 0; i < 30; i += 1) rows.push(await seed())
    await review(rows.slice(0, 29), { decision: 'ready', hardDefect: 'no' }, 'w29')
    await review([rows[29]!], { decision: 'reject', hardDefect: 'yes' }, 'w1')
    const v = await evidenceFromDb(prisma)
    check('🔴 🔴 **#5 창 안 결함 yes 1 → 닫힘**', !v.meetsContract && v.hardDefects === 1, v.reasons.join(' · '))
  }
  {
    await setup()
    const rows: Seeded[] = []
    for (let i = 0; i < 30; i += 1) rows.push(await seed())
    await review(rows.slice(0, 26), { decision: 'ready', hardDefect: 'no' }, 'r26')
    await review(rows.slice(26), { decision: 'reject', hardDefect: 'no' }, 'x4')
    const v = await evidenceFromDb(prisma)
    // 🔴 (quality-v4) 사람 표본은 그대로 센다(무수정 26 · 폐기 4) — 사람 비율은 v4 열림 근거가 아니다(창업자 gold)
    check('🔴 🔴 **#6 26/30 — 무수정 26 · 폐기 4 로 그대로 센다(폐기도 표본) · v4 열림은 gold**',
      v.meetsContract && v.basis === 'founderGold' && v.noEdit === 26 && v.declined === 4, v.reasons.join(' · '))
    // 미검토 경고 행이 끼어도 수열 밖
    const warn = await seed({ holds: ['SEMANTIC_UNSUPPORTED_ADDITION:1'] })
    check('🔴 경고 행은 수열에 들지 않는다', !(await evidenceFromDb(prisma)).windowIds.includes(warn.id))
    // 판이 섞인 행 — legacy 30 건은 아무리 좋아도 수열에 없다
    const lg: Seeded[] = []
    for (let i = 0; i < 3; i += 1) lg.push(await seed({ legacy: true }))
    await review(lg, { decision: 'ready', hardDefect: 'no' }, 'lg3')
    const v2 = await evidenceFromDb(prisma)
    check('🔴 🔴 **#3 판이 섞여도 합치지 않는다 — legacy 무수정 3건이 26/30 을 29 로 만들지 못한다**', v2.noEdit === 26 && v2.legacyRows === 0)
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n⑦ 🔴 검토 묶음 — 창 안 행 · 생성 순서 · 첫 차단 표시')
  // ─────────────────────────────────────────────────────────
  {
    await setup()
    const odd = await seed({ status: 'EXPIRED' })
    const rows: Seeded[] = []
    for (let i = 0; i < 29; i += 1) rows.push(await seed())
    await review(rows.slice(0, 10), { decision: 'ready', hardDefect: 'no' }, 'b10')
    const lgDecided = await seed({ legacy: true })
    await review([lgDecided], { decision: 'ready', hardDefect: 'no' }, 'lgd')
    const sel = await selectBundleRows(prisma, NOW)
    const ids = sel.window.map((w) => w.row.id)
    check('🔴 🔴 **#18 창 30건이 생성 순서로 묶음에 들어간다**', ids.length === 30 && ids[0] === odd.id && ids[1] === rows[0]!.id && ids[29] === rows[28]!.id, `${ids.length}`)
    check('🔴 🔴 **#18 재고 분류가 HRR 이 아닌(EXPIRED) 창 안 행도 들어가고 · 첫 차단으로 표시된다**',
      sel.window[0]?.slot.firstBlocking === true && sel.window.filter((w) => w.slot.firstBlocking).length === 1)
    check('🔴 창 행은 legacy 묶음에 중복되지 않는다 · legacy 결정 행은 따로', !sel.decided.some((r) => ids.includes(r.id)) && sel.decided.some((r) => r.id === lgDecided.id)
      && !sel.shadow.some((r) => ids.includes(r.id)))
    check('🔴 묶음 선택은 DB 를 쓰지 않는다', (await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER } })) === 0)
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n⑧ 🔴 실제 적재기(--apply) — 수정 전 파일 · 위조 digest · env 주입')
  // ─────────────────────────────────────────────────────────
  {
    await setup()
    const REPO = process.cwd()
    const T = realpathSync(mkdtempSync(join(tmpdir(), 'soran-qc-cwd-')))
    const H = realpathSync(mkdtempSync(join(tmpdir(), 'soran-qc-home-')))
    for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T, x), { recursive: true })
    symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T, 'node_modules'))
    const DATA = join(T, '.microseed-data')
    mkdirSync(DATA, { recursive: true })
    writeFileSync(join(DATA, 'held-candidates.json'), JSON.stringify({ held: [] }))
    const clean = fxMod.FIXTURES.filter((f) => f.expect.length === 0)
    const nowIso = fxMod.FIXTURE_NOW.toISOString()
    const items = []
    for (const fx of clean) {
      const r = await fxMod.runFixturePath(fx)
      if (r.pick?.decision !== 'AUTO_ADOPT') continue
      items.push({
        artifact: r.art, sourceArticleId: fx.source.id,
        meta: { site: 'navercafe:fixture', sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: '' },
        draft: { title: r.cand!.title, body: r.cand!.body, safetyVerdict: r.cand!.safetyVerdict, originality: r.cand!.originality, generatedAt: r.cand!.generatedAt },
        sourceTitleCopied: copiesSourceTitle(fx.source.title, r.art.draft!.title), sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
        autoJudge: { ruleVersion: 'fixture', promptVersion: 'fixture', model: 'fixture', inputHash: `h-${fx.source.id}`, provenance: 'machine-shadow' },
        ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, reviewedAt: nowIso,
        lifeReview: r.pick.lifeReview ?? null,
      })
    }
    check('대조 fixture 가 채택된다', items.length >= 1, `${items.length}`)
    const env0 = candidateEnvelope({ generatedAt: nowIso, ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, stageModels: STAGE_MODEL, items }) as Record<string, unknown>
    check('🔴 생성기 봉투가 지금 digest 를 싣는다', env0.qualityContractDigest === qualityContractDigest())
    let fileNo = 0
    const run = (envelope: Record<string, unknown>, extraEnv: Record<string, string> = {}) => {
      fileNo += 1
      for (const f of ['a', 'b', 'c', 'd', 'e']) rmSync(join(DATA, `auto-draft-2026092${f}-qc.candidates.json`), { force: true })
      writeFileSync(join(DATA, `auto-draft-2026092${'abcde'[fileNo - 1]}-qc.candidates.json`), JSON.stringify(envelope, null, 2))
      const res = spawnSync(process.execPath, [join(T, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(T, 'scripts', 'micro-seed-supply-autofill.mts'), '--apply', '--up-to=10'], {
        cwd: T, encoding: 'utf-8', env: { ...process.env, HOME: H, DATABASE_URL: URL, DIRECT_URL: URL, ...extraEnv },
      })
      return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` }
    }
    const { qualityContractDigest: _drop, ...noDigest } = env0
    void _drop
    const r1 = run(noDigest)
    const q1 = await prisma.originalPostApprovalQueue.count()
    check('🔴 🔴 **#10 수정 전 코드의 파일(digest 없음) → 적재 0 · CONTRACT 사유**', q1 === 0 && r1.out.includes(af.SKIP_LABEL.CONTRACT.slice(3, 20)), `queue ${q1} · exit ${r1.status}`)
    const r2 = run({ ...env0, qualityContractDigest: digestOf('다른 코드') })
    const q2 = await prisma.originalPostApprovalQueue.count()
    check('🔴 🔴 **#9 위조 digest 파일 → 적재 0**', q2 === 0, `queue ${q2} · exit ${r2.status}`)
    const r3 = run(env0, { SORAN_QUALITY_CONTRACT_DIGEST: 'f'.repeat(64), QUALITY_CONTRACT_DIGEST: 'f'.repeat(64), SORAN_QUALITY_CONTRACT_VERSION: 'quality-forged' })
    const rows = await prisma.originalPostApprovalQueue.findMany({ select: { gateResults: true, decidedBy: true, status: true } })
    const marks = rows.map((r) => (r.gateResults as Record<string, unknown>)[QUALITY_CONTRACT_KEY] as Record<string, unknown> | undefined)
    check('🟢 지금 파일 → 적재된다 (APPROVED · machine:*)', r3.status === 0 && rows.length === items.length && rows.every((r) => r.status === 'APPROVED' && r.decidedBy === af.MACHINE_DECIDED_BY), `rows ${rows.length} · exit ${r3.status}`)
    check('🔴 🔴 **#9 env 에 가짜 digest·판을 넣어도 저장값은 코드 상수**',
      marks.length > 0 && marks.every((m) => m?.digest === qualityContractDigest() && m?.version === QUALITY_CONTRACT_VERSION), JSON.stringify(marks[0]))
    const v = await evidenceFromDb(prisma)
    check('🔴 적재된 행은 지금 계약 cohort 수열에 들어간다(미검토 · v4 열림 근거는 gold)', v.sequence === rows.length && v.basis === 'founderGold')
    rmSync(T, { recursive: true, force: true })
    rmSync(H, { recursive: true, force: true })
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()
