#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY v2 — 실행 사슬 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   후보 → 적격 판정 → auto-ready:v1 도장 → selector 수용
 *   → 발행 트랜잭션 내부 재검증(+ 자동 행 배정) → Post
 *   → 감사 선정(hash 묶음) → 감사 회차(규칙 무결성·안전) → 결과 저장 → 확정 결함이 다음 회차를 실제로 닫음
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    주소를 한 글자도 찍지 않는다.
 *
 * ── 격리 Postgres 세우는 법 ───────────────────────────────────────────
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH" LANG=C LC_ALL=C
 *   PGDIR=/tmp/soran-pg ; SOCK=/tmp/soran-sock ; rm -rf "$PGDIR" "$SOCK" ; mkdir -p "$PGDIR" "$SOCK"
 *   initdb -D "$PGDIR" -U soran --auth=trust -E UTF8 --locale=C
 *   pg_ctl -D "$PGDIR" -o "-p 54329 -k $SOCK -h 127.0.0.1" -l "$PGDIR/server.log" start
 *   psql -h 127.0.0.1 -p 54329 -U soran -d postgres -c "create database soran_test;"
 *   export DATABASE_URL=... DIRECT_URL=... SORAN_ISOLATED_DB=yes-throwaway
 *   npx prisma migrate deploy && npm run auto-ready:db-check
 */
import { Prisma, PrismaClient } from '@prisma/client'

import {
  AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, AUDIT_CONTRACT_VERSION,
  readStamp, makeStamp, digestOf, type AuditJudge,
} from '../src/lib/auto-ready-v2'
import {
  authoritativeGate, stampAutoReady, stampRound, selectAudits, recordAuditResult,
  unresolvedDefectCount, runAuditRound, INTEGRITY_AUDITOR, INTEGRITY_MODEL, STAMP_BATCH_SIZE, isTransientTxLost,
} from '../src/lib/auto-ready-repo'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { loadPublishableStock, planPublishBatch } from './lib/publishable-stock.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { PROFILES, releaseCapsOf } from '../src/lib/scale-profile'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'

import { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf, digestOf as evDigest } from '../src/lib/auto-ready-evidence'
import { markedStageEnv } from './lib/stage-decision-fixture'
/**
 * 🔴 증거 픽스처의 사람 검토 기록(v2) — 운영에서는 관리자 서버 경계(로그인 세션)만 쓴다.
 *    발행된 사람 결정 행 · 수정·폐기 없음 → noEdit 로 결속한다.
 */
const humanReviewed = (title: string, body: string, hardDefect: 'yes' | 'no' = 'no') => ({
  [EVIDENCE_REVIEW_KEY]: [{
    contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'fixture-founder',
    ...bindingOf({ status: 'PUBLISHED', draftTitle: title, draftBody: body, editedTitle: null, editedBody: null, declineReason: null }),
    hardDefect, reasons: hardDefect === 'yes' ? ['fixture 중대 결함'] : [], bundleDigest: evDigest('fixture-bundle'), reviewedAt: '2026-09-25T00:00:00Z',
  }],
})

// ── 🔴 격리 가드 — 주소를 찍지 않는다 ──
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

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const NOW = new Date()
const CAP = new Date(NOW.getTime() - 2 * 864e5)
/** 🔴 스위치 — 검사가 env 를 **값으로** 넘긴다. 프로세스 env 는 건드리지 않는다 */
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const OFF = {} as const
const GOOD_SR = {
  complete: true, deterministicPass: true,
  unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9,
}
/**
 * 🔴 **지금 품질 계약으로 적재된 행** (2026-09-27) — 적재기가 남기는 표식 그대로다.
 *    `legacy: true` 면 표식이 없다(옛 계약 행) — 증거 표본도 자동 도장 대상도 아니다.
 */
// 🔴 (2026-09-30 · source-slot-v1) 원문 증거 — 적재기가 늘 싣는다. 없으면 발행 트랜잭션이 EVIDENCE_MISSING 으로 만료한다
const gate = (sr: unknown = GOOD_SR, holds: string[] = [], voiceCode: string | null = null, legacy = false) => ({
  holds, blocks: [], semanticReview: sr,
  ...fakeEvidenceGate(NOW),
  ...(legacy ? {} : { [QUALITY_CONTRACT_KEY]: currentQualityContract() }),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    // 🔴 이 글을 쓴 말투 — 발행 트랜잭션이 정본 judgeVoiceMatch 로 대조한다
    ...(voiceCode === null ? {} : { voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 } }),
  },
})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY v2 — 실행 사슬 (격리 DB 전용 · 운영 DB 0) ══')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)\n')

  const wipe = async (): Promise<void> => {
    // 🔴 검사 파일의 청소다 — 격리 DB 에서만 돈다. adapter 에는 삭제 경로가 없다
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
      + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
    )
  }
  await wipe()

  // ── 시드 ──
  const personas: { id: string; code: string }[] = []
  for (let i = 1; i <= 3; i += 1) {
    const u = await prisma.user.create({ data: { nickname: `자동${i}` }, select: { id: true } })
    personas.push(await prisma.persona.create({
      data: { code: `P0${i}`, userId: u.id, status: 'active' }, select: { id: true, code: true },
    }))
  }
  let seq = 0
  const raw = async () => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:t`, sourceUrl: `https://example.invalid/${seq}`,
        sourceArticleId: `${1000 + seq}-abcd`, sourceCapturedAt: CAP, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  /**
   * 🔴 **행마다 새 Persona** (2026-09-25). 발행 트랜잭션이 이미 배정된 자동 행의 Persona 도
   *    정본 상한(가장 안전한 d1: 주 1 · 최소 5일)으로 다시 판정한다. 세 Persona 를 돌려 쓰면
   *    정상 행이 **다른 행의** 배정 때문에 막힌다 — 실제 배정기는 상한을 지켜 배정한다.
   *    상한 반례는 ⑧ 에서 따로 만든다.
   */
  let fresh = 0
  const freshPersona = async (identity: Record<string, unknown> = {}) => {
    fresh += 1
    const u = await prisma.user.create({ data: { nickname: `새${fresh}` }, select: { id: true } })
    const p = await prisma.persona.create({
      data: { code: `F${String(fresh).padStart(3, '0')}`, userId: u.id, status: 'active', identity: identity as never },
      select: { id: true, code: true },
    })
    personas.push(p)
    return p
  }
  /** 기계 행 — persona 를 null 로 주면 배정 없는 행이다 · 주지 않으면 새 Persona 에 배정한다 */
  const codeOf = (id: string | null | undefined): string | null => personas.find((p) => p.id === id)?.code ?? null
  const machineRow = async (o: { sr?: unknown; persona?: string | null; voice?: string; body?: string; legacy?: boolean } = {}) => {
    const r = await raw()
    const personaId = o.persona === null ? null : (o.persona ?? (await freshPersona()).id)
    return prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `평범한 하루 이야기 ${seq}`,
        draftBody: o.body ?? `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
        gateVerdict: 'PASS', gateResults: gate(o.sr, [], o.voice ?? codeOf(personaId), o.legacy === true) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `dk-${seq}`,
        matchedPersonaId: personaId,
        matchedAt: personaId === null ? null : NOW,
      },
      select: { id: true },
    })
  }
  const evidenceIds: string[] = []
  const evidenceAuthor = (await prisma.user.create({ data: { nickname: '증거작성' }, select: { id: true } })).id
  const evidenceRow = async (i: number) => {
    const r = await raw()
    // 🔴 createdPostId 는 FK(Restrict)다 — 가짜 id 를 넣지 않고 실제 글을 만든다
    const ep = await prisma.post.create({
      data: { boardType: 'FREE', title: `사람이 본 글 ${i}`, content: `사람이 본 본문 ${i}`, authorId: evidenceAuthor },
      select: { id: true },
    })
    const q = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
        gateVerdict: 'PASS', gateResults: gate() as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, createdPostId: ep.id, dedupKey: `ev-${i}`,
        // 🔴 사람 정답 표본 — human:founder 검토 기록이 이 초안에 묶여 있다(결함 no)
        editDiff: humanReviewed(`사람이 본 글 ${i}`, `사람이 본 본문 ${i}`) as never,
      },
      select: { id: true },
    })
    evidenceIds.push(q.id)
  }
  /**
   * 🔴 **증거를 무너뜨린다** (quality-v4) — 열림 근거가 창업자 gold 로 바뀌어 사람 표본 수(30→29)는 더 이상 열림을
   *    좌우하지 않는다. v4 에서 증거를 무너뜨리는 운영 사건은 **지금 계약 행에 사람이 중대 결함을 적는 것**이다
   *    (`cohortHardDefects`). 그 행 하나의 사람 기록을 yes/no 로 바꾼다.
   */
  const breakOneEvidence = (on: boolean) => prisma.originalPostApprovalQueue.update({
    where: { id: evidenceIds[0]! }, data: { editDiff: humanReviewed('사람이 본 글 0', '사람이 본 본문 0', on ? 'yes' : 'no') as never },
  })
  /** 🔴 증거 검사를 우회해 도장만 직접 찍은 행 — 호출자가 게이트를 건너뛴 상황이다 */
  const forceStamp = async (id: string) => {
    const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
    await prisma.originalPostApprovalQueue.update({
      where: { id },
      data: { decidedBy: AUTO_DECIDER, editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(r.draftTitle, r.draftBody, NOW) } as never },
    })
  }
  const postCount = () => prisma.post.count()
  check('기준선 — 시작할 때 founder 결정 0',
    await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } }) === 0)

  console.log('① 🔴 스위치 OFF — 도장 0 · selector 닫힘 · 감사 표를 읽지 않는다')
  {
    /**
     * 🔴 ①② 의 행은 **옛 계약(legacy)** 이다 (2026-09-27). 지금 계약 행이면 증거 창의 **미검토 선행 행**이
     *    되어 이후 구간이 열리지 않는다(그것이 새 규칙이다). 지금 계약 행의 같은 반례는
     *    `auto-ready:quality-db-check` 가 따로 본다.
     */
    const m = await machineRow({ legacy: true })
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit" RENAME TO "AutoReadyAudit_hidden"')
    let threw = ''
    try {
      check('OFF 이면 닫힘', !(await authoritativeGate(prisma, OFF)).open)
      check('🔴 🔴 **OFF 이면 도장 0**', (await stampRound(prisma, { env: OFF, now: NOW })).size === 0)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
      check('🔴 기계 행은 여전히 사람 검토 대상이다', s.rejected.some((x) => x.id === m.id && x.code === 'HUMAN_REVIEW_REQUIRED'))
      check('🔴 감사 회차도 OFF 면 표를 읽지 않는다',
        (await runAuditRound(prisma, { env: OFF, judge: ruleAuditJudge, auditor: 'rule-auditor', now: NOW })).kind === 'off')
    } catch (e) { threw = String(e).slice(0, 120) }
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit_hidden" RENAME TO "AutoReadyAudit"')
    check('🔴 🔴 **감사 표가 없어도 OFF 경로는 깨지지 않는다 (운영에 아직 표가 없다)**', threw === '', threw)
  }

  // 🔴 (quality-v4) 증거가 닫힌 상태를 만든다 — 지금 계약 행 하나에 사람 중대 결함
  await evidenceRow(0)
  await breakOneEvidence(true)
  console.log('\n② 🔴 🔴 증거가 닫혔는데(사람 중대 결함) 호출자가 "열림" 을 넘겨도 — 도장 0 · Post 0')
  {
    const r = await machineRow({ legacy: true })
    // 🔴 앞판 시그니처처럼 `open: { open: true }` 를 억지로 넘긴다 — 이제 받는 자리가 없다
    const o = await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW, open: { open: true, reasons: [] } } as never)
    check('🔴 🔴 **증거 닫힘(사람 중대 결함) · 호출자 open:true → closed · 도장 0**',
      o.kind === 'closed' && o.reason.includes('중대 결함'), JSON.stringify(o))
    check('그 행은 기계 도장 그대로', (await prisma.originalPostApprovalQueue.findUnique({ where: { id: r.id } }))?.decidedBy === 'machine:auto-draft-v5')
    await forceStamp(r.id)
    const before = await postCount()
    const p = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **우회해 찍힌 도장도 발행 트랜잭션이 닫힌 증거로 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(p))
  }

  console.log('\n③ 🔴 (quality-v4) 열림 근거 = 창업자 gold 재현 + 사람 중대 결함 0 — 사람 표본 수는 요구하지 않는다')
  const withDefect = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **사람 중대 결함 1건 → 닫힘**', !withDefect.open && withDefect.reasons.some((x) => x.includes('중대 결함')), withDefect.reasons.join(' · '))
  await breakOneEvidence(false)
  const oneSample = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **사람 표본 1/30 이어도 gold 재현 · 결함 0 → 열림 (새 30건 사람 검토 없음)**', oneSample.open, oneSample.reasons.join(' · '))
  for (let i = 1; i < 30; i += 1) await evidenceRow(i)
  const founderBefore = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
  const open = await authoritativeGate(prisma, ON)
  check('🔴 증거 30/30 · 결함 0 → 열림', open.open, open.reasons.join(' · '))

  console.log('\n④ 🔴 적격 판정 — 경고 행은 예외 묶음 · 도장 없음')
  {
    const bad = await machineRow({ sr: { ...GOOD_SR, confidence: 'high' } })
    check('🔴 🔴 **semanticReview 가 망가진 행 → exception**', (await stampAutoReady(prisma, { queueId: bad.id, env: ON, now: NOW })).kind === 'exception')
    const empty = await machineRow({ sr: {} })
    check('🔴 빈 semanticReview {} → exception', (await stampAutoReady(prisma, { queueId: empty.id, env: ON, now: NOW })).kind === 'exception')
  }

  console.log('\n⑤ 🔴 도장 — 조건부 · 본문 hash · founder 0 · 동시 도장 1회')
  const a = await machineRow()
  {
    check('도장이 찍힌다', (await stampAutoReady(prisma, { queueId: a.id, env: ON, now: NOW })).kind === 'stamped')
    const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    const st = readStamp(row.editDiff)
    check('🔴 🔴 **decidedBy 는 auto-ready:v1 · hash 가 실제 글과 같다**',
      row.decidedBy === AUTO_DECIDER && st !== null && st.bodyHash === digestOf(row.draftBody))
    const r = await machineRow()
    const res = await Promise.all(Array.from({ length: 4 }, () => stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })))
    check('🔴 🔴 **네 회차가 동시에 찍어도 도장은 정확히 한 번**',
      res.filter((x) => x.kind === 'stamped').length === 1, res.map((x) => x.kind).join(','))
  }

  console.log('\n⑤-b 🔴 🔴 도장 회차 — bounded Serializable batch · 총량 제한 없음 · 동시 회차에도 한 번')
  {
    const autoBefore = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER } })
    const many: string[] = []
    for (let i = 0; i < STAMP_BATCH_SIZE * 2 + 3; i += 1) many.push((await machineRow()).id)
    const [r1, r2] = await Promise.all([stampRound(prisma, { env: ON, now: NOW }), stampRound(prisma, { env: ON, now: NOW })])
    const stampedRows = (await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER } })) - autoBefore
    const first = (r1.get('stamped') ?? 0) + (r2.get('stamped') ?? 0)
    // 🔴 한 회차가 진 묶음은 쓴 것이 없다 — 남은 행은 다음 회차가 찍는다
    const r3 = await stampRound(prisma, { env: ON, now: NOW })
    const all = await prisma.originalPostApprovalQueue.count({ where: { id: { in: many }, decidedBy: AUTO_DECIDER } })
    check(`🔴 🔴 **묶음 크기(${STAMP_BATCH_SIZE})를 넘는 ${many.length}행도 전부 찍힌다 — 총량 제한이 아니다**`,
      all === many.length, `${all}/${many.length}`)
    check('🔴 🔴 **동시 두 회차 — 행마다 도장은 정확히 한 번 (보고한 stamped 수 = 실제 찍힌 행 수)**',
      first === stampedRows
      && first + (r3.get('stamped') ?? 0) === (await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER } })) - autoBefore,
      `r1 ${[...r1].map(([k, v]) => `${k} ${v}`).join(' ')} / r2 ${[...r2].map(([k, v]) => `${k} ${v}`).join(' ')} / r3 ${[...r3].map(([k, v]) => `${k} ${v}`).join(' ')}`)
    check('🔴 도장 회차가 founder 를 쓰지 않았다', await prisma.originalPostApprovalQueue.count({ where: { id: { in: many }, decidedBy: HUMAN_DECIDER } }) === 0)
    await breakOneEvidence(true)
    const extra = await machineRow()
    const rc = await stampRound(prisma, { env: ON, now: NOW })
    await breakOneEvidence(false)
    check('🔴 🔴 **증거가 닫히면(사람 중대 결함) 묶음 회차도 도장 0 (closed)**',
      (rc.get('stamped') ?? 0) === 0 && (rc.get('closed') ?? 0) >= 1
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: extra.id } })).decidedBy === 'machine:auto-draft-v5',
      [...rc].map(([k, v]) => `${k} ${v}`).join(' '))
    // 🔴 이 행들은 이후 구간의 발행 대상이 되지 않게 치운다(도장만 찍힌 채 남으면 selector 가 고른다)
    await prisma.originalPostApprovalQueue.updateMany({ where: { id: { in: [...many, extra.id] } }, data: { status: 'EXPIRED' } })
  }

  console.log('\n⑤-c 🔴 🔴 도장 트랜잭션이 엔진에서 사라졌다(P2028) — 한 번만 새로 시작 · 부분 커밋 0 · 중복 도장 0 (2026-09-30 운영 반례)')
  {
    /**
     * 🔴 **P2028 을 지어내지 않는다.** 운영 반례는 엔진이 트랜잭션 id 를 잊은 것이다("Transaction not found").
     *    격리 DB 에서 **실제로** 같은 일을 만든다 — 도장 트랜잭션 안에서 지정한 행을 읽기 직전에
     *    엔진 연결을 끊었다 다시 붙인다(`$disconnect`→`$connect`). 그러면 진짜 엔진이 진짜 P2028 을 던지고,
     *    Postgres 는 끊긴 연결의 트랜잭션(앞 행의 도장 쓰기 포함)을 실제로 롤백한다. fixture 가 실제보다 강하지 않다.
     *    비대상 P2028 도 진짜다 — 이미 commit 된 트랜잭션 클라이언트로 읽게 해 엔진이 내는 "committed transaction" 이다.
     *    P2034/P2002 만 같은 code 의 PrismaClientKnownRequestError 를 던진다(실제 동시 충돌은 ⑤ · ⑤-b 가 본다).
     */
    type Fault = 'lost' | 'committed' | 'P2034' | 'P2002'
    /**
     * 🔴 이미 commit 된 트랜잭션 클라이언트 — **쓰기 직전에 새로 만든다.** 엔진이 다시 붙은 뒤에는 옛 id 를 잊어
     *    "committed" 가 아니라 "Transaction not found"(transient)가 나온다(이 검사를 처음 돌렸을 때 실측).
     */
    let dead: typeof prisma | null = null
    const freshDead = async (): Promise<void> => {
      let t: unknown = null
      await prisma.$transaction(async (tx) => { t = tx; await tx.user.count() })
      dead = t as typeof prisma
    }
    /** `faultAt(행 id, 시도 번호)` 가 준 결함을 그 행을 읽기 직전에 일으킨다. 시도 번호 = 몇 번째 `$transaction` 인가 */
    const faulty = (faultAt: (id: string, attempt: number) => Fault | null) => {
      const s = { attempts: 0 }
      const wrapTx = (tx: object, attempt: number): object => new Proxy(tx, {
        get(t, k) {
          const v = Reflect.get(t, k) as unknown
          if (k !== 'originalPostApprovalQueue') return v
          const d = v as { findUnique: (a: { where: { id: string } }) => Promise<unknown> }
          return new Proxy(d, {
            get(dt, dk) {
              if (dk !== 'findUnique') return Reflect.get(dt, dk)
              return async (a: { where: { id: string } }) => {
                const f = faultAt(a.where.id, attempt)
                if (f === 'lost') { await prisma.$disconnect(); await prisma.$connect() }
                if (f === 'committed') return dead!.originalPostApprovalQueue.findUnique(a as never)
                if (f === 'P2034' || f === 'P2002') {
                  throw new Prisma.PrismaClientKnownRequestError(`fixture ${f}`, { code: f, clientVersion: Prisma.prismaVersion.client })
                }
                return dt.findUnique(a)
              }
            },
          })
        },
      })
      const client = new Proxy(prisma, {
        get(t, k) {
          if (k !== '$transaction') return Reflect.get(t, k)
          return (cb: (tx: object) => Promise<unknown>, opts: never) => {
            s.attempts += 1
            const attempt = s.attempts
            return t.$transaction((tx) => cb(wrapTx(tx, attempt)), opts)
          }
        },
      })
      return { client: client as typeof prisma, s }
    }
    const rowOf = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
    const isStampedOnce = async (id: string): Promise<boolean> => {
      const r = await rowOf(id)
      const st = readStamp(r.editDiff)
      return r.decidedBy === AUTO_DECIDER && r.decidedAt?.getTime() === NOW.getTime()
        && st !== null && st.bodyHash === digestOf(r.draftBody) && r.createdPostId === null
    }
    const untouched = async (ids: string[]): Promise<boolean> => (await prisma.originalPostApprovalQueue.count({
      where: { id: { in: ids }, decidedBy: 'machine:auto-draft-v5', decidedAt: null, status: 'APPROVED' },
    })) === ids.length
    const errOf = async (f: () => Promise<unknown>): Promise<unknown> => { try { await f(); return null } catch (e) { return e } }
    /** 🔴 던져도 검사를 멈추지 않는다 — 실패를 ❌ 로 센다(변이 시험에서 원인이 보이게) */
    const threw = (e: unknown) => ({ kind: 'threw' as const, reason: String((e as { meta?: { error?: unknown } }).meta?.error ?? e).slice(0, 80) })
    const noTally = new Map<string, number>()
    const postsBefore = await postCount()
    const mine: string[] = []
    const mk = async (): Promise<string> => { const id = (await machineRow()).id; mine.push(id); return id }

    // (a) stampAutoReady — 첫 시도에서 트랜잭션을 잃는다 → 새로 시작해 도장
    {
      const id = await mk()
      const { client, s } = faulty((rid, at) => (rid === id && at === 1 ? 'lost' : null))
      const o = await stampAutoReady(client, { queueId: id, env: ON, now: NOW }).catch(threw)
      check('🔴 🔴 **(a) stampAutoReady — 실제 P2028(Transaction not found) 1회 → 트랜잭션 2번째에 stamped · 행 도장 1회**',
        o.kind === 'stamped' && s.attempts === 2 && await isStampedOnce(id), `${JSON.stringify(o)} · 시도 ${s.attempts}`)
    }
    // (a)+(e) stampRound — 앞 행을 이미 쓴 뒤 다음 행에서 트랜잭션을 잃는다 → 첫 시도의 쓰기는 남지 않는다
    {
      const rs = [await mk(), await mk(), await mk()]
      const { client, s } = faulty((rid, at) => (rid === rs[1] && at === 1 ? 'lost' : null))
      const t: Map<string, number> = await stampRound(client, { env: ON, now: NOW }).catch(() => noTally)
      const ok = (await Promise.all(rs.map(isStampedOnce))).every(Boolean)
      /**
       * 🔴 첫 시도의 R1 도장이 커밋돼 남았다면 두 번째 시도는 R1 을 `auto-ready:v1` 로 읽어 skip 했을 것이다 —
       *    stamped 가 정확히 3 이면 첫 시도의 부분 쓰기는 없다. 행 잠금이 남았다면 두 번째 시도의 R1 쓰기가 막혔을 것이다.
       */
      check('🔴 🔴 **(a)(e) stampRound — 앞 행을 쓴 뒤 실제 P2028 → 묶음 전체를 한 번 새로 · stamped 정확히 3 · race 0 · 부분 커밋 0**',
        (t.get('stamped') ?? 0) === 3 && (t.get('race') ?? 0) === 0 && s.attempts === 2 && ok,
        `${[...t].map(([k, v]) => `${k} ${v}`).join(' ')} · 시도 ${s.attempts}`)
    }
    // (b) 두 번 연속 잃는다 → 던진다(fail-closed) · 시도는 정확히 2 · 쓴 것 0
    {
      const id = await mk()
      const { client, s } = faulty((rid) => (rid === id ? 'lost' : null))
      const e = await errOf(() => stampAutoReady(client, { queueId: id, env: ON, now: NOW }))
      check('🔴 🔴 **(b) stampAutoReady — 반복 P2028 → throw · 시도 정확히 2 · 도장 0**',
        isTransientTxLost(e) && s.attempts === 2 && await untouched([id]), `시도 ${s.attempts} · ${String(e).slice(0, 80)}`)
      const rs = [await mk(), await mk()]
      const r2 = faulty((rid) => (rid === rs[1] ? 'lost' : null))
      const e2 = await errOf(() => stampRound(r2.client, { env: ON, now: NOW }))
      check('🔴 🔴 **(b)(e) stampRound — 앞 행을 쓴 뒤 두 시도 모두 잃음 → throw · 시도 2 · 두 행 모두 그대로(부분 커밋 0)**',
        isTransientTxLost(e2) && r2.s.attempts === 2 && await untouched([id, ...rs]), `시도 ${r2.s.attempts} · ${String(e2).slice(0, 80)}`)
      // 🔴 끊긴 트랜잭션이 잠금을 쥐고 남지 않았다 — 결함 없는 회차가 같은 행을 바로 찍는다
      const clean: Map<string, number> = await stampRound(prisma, { env: ON, now: NOW }).catch(() => noTally)
      check('🔴 (b) 뒤 결함 없는 회차 — 남은 세 행을 정확히 한 번씩 찍는다(잠금·부분 쓰기 없음)',
        (clean.get('stamped') ?? 0) === 3 && (await Promise.all([id, ...rs].map(isStampedOnce))).every(Boolean),
        [...clean].map(([k, v]) => `${k} ${v}`).join(' '))
    }
    // (c) 비대상 P2028(엔진이 낸 진짜 "committed transaction") → 재시도 없이 즉시 throw
    {
      const id = await mk()
      await freshDead()
      const { client, s } = faulty((rid, at) => (rid === id && at === 1 ? 'committed' : null))
      const e = await errOf(() => stampAutoReady(client, { queueId: id, env: ON, now: NOW }))
      const meta = String((e as { meta?: { error?: unknown } } | null)?.meta?.error ?? '')
      check('🔴 🔴 **(c) 비대상 P2028(committed transaction) → 즉시 throw · 시도 1 · 도장 0**',
        (e as { code?: string } | null)?.code === 'P2028' && meta.includes('committed transaction') && !isTransientTxLost(e)
        && s.attempts === 1 && await untouched([id]), `시도 ${s.attempts} · ${meta.slice(0, 80)}`)
      await freshDead()
      const r2 = faulty((rid, at) => (rid === id && at === 1 ? 'committed' : null))
      const e2 = await errOf(() => stampRound(r2.client, { env: ON, now: NOW }))
      check('🔴 (c) stampRound 도 비대상 P2028 은 시도 1 · 던진다 · 도장 0',
        (e2 as { code?: string } | null)?.code === 'P2028' && r2.s.attempts === 1 && await untouched([id]), `시도 ${r2.s.attempts}`)
      // 🔴 이 행은 도장되지 않았다(맞다) — 아래 "찍힌 행" 집합에서 빼고 치운다
      mine.splice(mine.indexOf(id), 1)
      await prisma.originalPostApprovalQueue.update({ where: { id }, data: { status: 'EXPIRED' } })
    }
    // (d) P2034/P2002 — 기존 race 계약 그대로 · 재시도 없음
    {
      const id = await mk()
      for (const f of ['P2034', 'P2002'] as const) {
        const { client, s } = faulty((rid) => (rid === id ? f : null))
        const o = await stampAutoReady(client, { queueId: id, env: ON, now: NOW }).catch(threw)
        check(`🔴 🔴 **(d) stampAutoReady ${f} → race · 시도 1 · 도장 0**`, o.kind === 'race' && s.attempts === 1 && await untouched([id]),
          `${JSON.stringify(o)} · 시도 ${s.attempts}`)
        const r2 = faulty((rid) => (rid === id ? f : null))
        const t: Map<string, number> = await stampRound(r2.client, { env: ON, now: NOW }).catch(() => noTally)
        const cands = await prisma.originalPostApprovalQueue.count({ where: { status: 'APPROVED', createdPostId: null, decidedBy: { startsWith: 'machine:' } } })
        check(`🔴 (d) stampRound ${f} → 묶음 전체 race(${cands}) · 시도 1 · 도장 0`,
          (t.get('race') ?? 0) === cands && (t.get('stamped') ?? 0) === 0 && r2.s.attempts === 1 && await untouched([id]),
          `${[...t].map(([k, v]) => `${k} ${v}`).join(' ')} · 시도 ${r2.s.attempts}`)
      }
      mine.splice(mine.indexOf(id), 1)
      await prisma.originalPostApprovalQueue.update({ where: { id }, data: { status: 'EXPIRED' } })
    }
    // 🔴 중복 발행 0 — 도장은 글을 만들지 않고, 재시도로 찍힌 행도 발행은 정확히 한 번이다
    {
      check('🔴 🔴 **재시도·실패 회차 전부 — Post 증가 0 (도장은 발행하지 않는다)**', (await postCount()) === postsBefore)
      const stampedIds = (await prisma.originalPostApprovalQueue.findMany({
        where: { id: { in: mine }, decidedBy: AUTO_DECIDER }, select: { id: true },
      })).map((r) => r.id)
      const once = stampedIds[0]!
      const p1 = await publishOriginalPostTx(prisma, { queueId: once, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      const p2 = await publishOriginalPostTx(prisma, { queueId: once, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      check('🔴 🔴 **재시도로 찍힌 행을 두 번 발행해도 Post 는 정확히 1**',
        stampedIds.length === mine.length && p1.kind === 'published' && p2.kind !== 'published' && (await postCount()) === postsBefore + 1,
        `${stampedIds.length}/${mine.length} · ${p1.kind}/${p2.kind}`)
      // 🔴 이후 구간의 발행 대상이 되지 않게 치운다(⑤-b 와 같다)
      await prisma.originalPostApprovalQueue.updateMany({ where: { id: { in: mine.filter((x) => x !== once) } }, data: { status: 'EXPIRED' } })
    }
  }

  console.log('\n⑥ 🔴 selector — 열림일 때만 · 도장이 지금 글과 같을 때만')
  {
    check('🔴 🔴 **열림 → 도장 행이 발행 대상에 들어온다**',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).targets.some((t) => t.id === a.id))
    check('🔴 닫힘 → AUTO_READY_CLOSED',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })).rejected.some((x) => x.id === a.id && x.code === 'AUTO_READY_CLOSED'))
  }

  console.log('\n⑦ 🔴 🔴 선택 뒤 증거가 무너졌다(사람 중대 결함) — Post 0')
  {
    const r = await machineRow()
    await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
    check('선택 시점에는 발행 대상이었다', (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).targets.some((t) => t.id === r.id))
    await breakOneEvidence(true)
    const before = await postCount()
    const p = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **선택 뒤 증거 붕괴(사람 중대 결함) → 발행 트랜잭션이 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && p.detail.includes('중대 결함') && (await postCount()) === before,
      JSON.stringify(p))
    await breakOneEvidence(false)
    check('증거를 되돌리면 다시 열린다', (await authoritativeGate(prisma, ON)).open)
  }

  console.log('\n⑧ 🔴 🔴 자동 행 배정은 발행 트랜잭션 안에서 — 실패하면 배정도 불변')
  {
    /** 🔴 계획 — personaId 와 근거만 넘긴다. 시각·상한 숫자는 넘기지 않는다(트랜잭션이 정한다) */
    type Assign = { personaId: string; matchMeta: unknown }
    const planFor = (p: { id: string }): Assign => ({ personaId: p.id, matchMeta: { test: true } })
    const unassigned = async (o: { voice: string; body?: string }) => {
      const r = await machineRow({ persona: null, voice: o.voice, body: o.body })
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      return r.id
    }
    const untouched = async (id: string) => {
      const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { matchedPersonaId: true, matchedAt: true, createdPostId: true } })
      return q.matchedPersonaId === null && q.matchedAt === null && q.createdPostId === null
    }
    const pA = await freshPersona()
    const idA = await unassigned({ voice: pA.code })
    await prisma.originalPostApprovalQueue.update({ where: { id: idA }, data: { editedBody: '도장 뒤에 바뀐 본문' } })
    check('🔴 🔴 **도장 뒤 본문이 바뀌면 selector 가 먼저 AUTO_READY_STALE 로 거절한다**',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).rejected.some((x) => x.id === idA && x.code === 'AUTO_READY_STALE'))
    const pa = await publishOriginalPostTx(prisma, { queueId: idA, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON, autoAssign: planFor(pA) })
    check('🔴 🔴 **재검증 실패(본문 변경) → Post 0 · matchedPersonaId/matchedAt 불변**',
      pa.kind === 'blocked' && pa.code === 'AUTO_READY_RECHECK' && await untouched(idA), JSON.stringify(pa))
    const pB = await freshPersona()
    const idB = await unassigned({ voice: pB.code })
    /**
     * 🔴 일 상한에 **실제로** 걸리게 한다. `dailyCap: 0` 은 "주입 안 됨" 으로 읽혀 가장 안전한
     *    상수 1 로 떨어지는 기존 계약이다(첫 판이 그 값을 넣어 오히려 발행됐다).
     *    격리 DB 에 오늘 발행 기록 1건을 두고 상한 1 을 준다.
     */
    await prisma.personaActivityLog.create({
      data: { personaId: personas[2]!.id, kind: 'post', targetId: 'cap-fixture', gateStatus: 'PASS', decidedBy: 'operator', publishedAt: new Date() },
    })
    const pb = await publishOriginalPostTx(prisma, { queueId: idB, publishedToday: 1, mode: { kind: 'manual-live', dailyCap: 1 }, autoReadyEnv: ON, autoAssign: planFor(pB) })
    check('🔴 🔴 **발행 판정 실패(일 상한) → 배정 불변**',
      pb.kind === 'blocked' && pb.code === 'DAILY_CAP' && await untouched(idB), JSON.stringify(pb))
    const pC = await freshPersona()
    const idC = await unassigned({ voice: pC.code })
    await breakOneEvidence(true)
    const pc = await publishOriginalPostTx(prisma, { queueId: idC, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON, autoAssign: planFor(pC) })
    await breakOneEvidence(false)
    check('🔴 🔴 **증거 게이트 실패 → 배정 불변**', pc.kind === 'blocked' && await untouched(idC), JSON.stringify(pc))
    const pd = await publishOriginalPostTx(prisma, { queueId: idC, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: OFF, autoAssign: planFor(pC) })
    check('🔴 스위치 OFF → 배정 불변', pd.kind === 'blocked' && await untouched(idC))
    const beforeE = Date.now()
    // 🔴 미래 matchedAt 을 억지로 넘긴다 — 받는 자리가 없다. 배정 시각은 트랜잭션 시계다
    const future = new Date(NOW.getTime() + 30 * 864e5)
    const pe = await publishOriginalPostTx(prisma, {
      queueId: idC, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON,
      autoAssign: { ...planFor(pC), matchedAt: future } as never,
    })
    const qe = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: idC } })
    check('🔴 🔴 **통과하면 한 트랜잭션에서 배정 + Post**',
      pe.kind === 'published' && pe.personaCode === pC.code && qe.matchedPersonaId === pC.id
      && qe.createdPostId !== null, JSON.stringify(pe))
    check('🔴 🔴 **미래 matchedAt 을 넘겨도 배정 시각은 트랜잭션 시계다**',
      qe.matchedAt !== null && qe.matchedAt.getTime() >= beforeE && qe.matchedAt.getTime() <= Date.now(),
      String(qe.matchedAt?.toISOString()))
    /**
     * ── 🔴 🔴 **계획한 Persona 를 트랜잭션 안에서 다시 판정한다** (2026-09-25 마스터 지적) ──
     *    호출자가 넘긴 personaId 는 "누구를 검토할지" 일 뿐이다. 정본 judgeVoiceMatch ·
     *    readPostRequirements · hardFilter 가 하나라도 떨어뜨리면 AUTO_ASSIGN_STALE · 쓰기 0.
     */
    const personaWith = async (code: string, identity: Record<string, unknown>) => {
      const u = await prisma.user.create({ data: { nickname: `생활사${code}` }, select: { id: true } })
      return prisma.persona.create({ data: { code, userId: u.id, status: 'active', identity: identity as never }, select: { id: true, code: true } })
    }
    type Extra = { releaseStage?: string; env?: Record<string, string>; caps?: unknown }
    const stale = async (label: string, id: string, assign: Assign | undefined, want: string, x: Extra = {}) => {
      const before = await postCount()
      const q0 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { matchedPersonaId: true, matchedAt: true } })
      const r = await publishOriginalPostTx(prisma, {
        queueId: id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100, releaseStage: x.releaseStage as never }, autoReadyEnv: x.env ?? ON,
        ...(assign === undefined ? {} : { autoAssign: (x.caps === undefined ? assign : { ...assign, caps: x.caps }) as never }),
      })
      const q1 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { matchedPersonaId: true, matchedAt: true, createdPostId: true } })
      check(`🔴 🔴 **${label} → AUTO_ASSIGN_STALE · Post 0 · 배정 불변**`,
        r.kind === 'blocked' && r.code === 'AUTO_ASSIGN_STALE' && r.detail.includes(want)
        && (await postCount()) === before && q1.createdPostId === null
        && q1.matchedPersonaId === q0.matchedPersonaId && q1.matchedAt?.getTime() === q0.matchedAt?.getTime(), JSON.stringify(r))
    }
    // (g) 말투가 다른 사람 — 글은 P01 말투인데 새 Persona 로 계획
    const pG = await freshPersona()
    await stale('VOICE_MISMATCH (말투 P01 · 계획은 다른 사람)', await unassigned({ voice: personas[0]!.code }), planFor(pG), 'VOICE_MISMATCH')
    // (h) 임의의 active Persona id — 글을 쓴 사람이 아니다
    const stranger = await personaWith('P90', {})
    await stale('임의 active Persona id', await unassigned({ voice: pG.code }), planFor(stranger), 'VOICE_MISMATCH')
    await stale('존재하지 않는 Persona id', await unassigned({ voice: pG.code }), { personaId: 'no-such-persona', matchMeta: {} }, '없다')
    // (i) 혼인 충돌 — 미혼 Persona 에 현재형 배우자 글
    const single = await personaWith('P91', { maritalStatus: '미혼', childrenCount: 0, childrenAgeBands: [] })
    await stale('혼인 충돌 (미혼 · "남편이")',
      await unassigned({ voice: single.code, body: '남편이 요즘 퇴근이 늦어요. 다들 어떻게 지내세요?' }), planFor(single), 'MARITAL_CONFLICT')
    // (j) 자녀 충돌 — 무자녀 Persona 에 자녀 글
    const noKids = await personaWith('P92', { maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] })
    await stale('자녀 충돌 (무자녀 · "딸아이가")',
      await unassigned({ voice: noKids.code, body: '딸아이가 수능을 봐요. 다들 어떻게 지내세요?' }), planFor(noKids), 'NO_CHILDREN')
    /** 🔴 이 Persona 가 다른 글을 `daysAgo` 일 전에 받았다 */
    const usedBefore = async (p: { id: string; code: string }, daysAgo: number) => {
      const other = await machineRow({ persona: p.id, voice: p.code })
      await prisma.originalPostApprovalQueue.update({ where: { id: other.id }, data: { matchedAt: new Date(NOW.getTime() - daysAgo * 864e5) } })
    }
    // (k) 계획 뒤 주 cap 소진 — 정본 단계(설정 없음 = d1 · 주 1)에서 이번 주 한 편을 이미 받았다
    const busy = await personaWith('P93', {})
    const idK = await unassigned({ voice: busy.code })
    await usedBefore(busy, 6)
    await stale('계획 뒤 주 cap 소진 (d1 · 주 1 · 이번 주 1)', idK, planFor(busy), 'WEEKLY_CAP')
    // (l) 최소 간격 소진 — 어제 한 편 · d1 최소 5일
    const recent = await personaWith('P94', {})
    const idL = await unassigned({ voice: recent.code })
    await usedBefore(recent, 1)
    await stale('최소 간격 소진 (d1 · 어제 · 최소 5일)', idL, planFor(recent), 'TOO_SOON')
    /**
     * (m) 🔴 🔴 **과도한 상한** — 호출자가 `releaseStage: 'd10'` 과 자유형 `caps` 숫자를 넘긴다.
     *    env 천장이 d1 이면 d1 상한이다. 같은 행을 env 가 d10 을 허락할 때 다시 내면 나간다 —
     *    막은 것이 호출자 값이 아니라 **env 천장**이라는 대조다.
     */
    const greedy = await personaWith('P95', {})
    const idM = await unassigned({ voice: greedy.code })
    await usedBefore(greedy, 2)
    await stale('과도한 상한 (d10 요청 + caps 1e9 · env 천장 d1)', idM, planFor(greedy), '(d1)',
      { releaseStage: 'd10', caps: { postsPerWeek: 1e9, minDaysBetween: 0 } })
    await stale('모르는 단계 문자열 → 가장 안전한 d1', idM, planFor(greedy), '(d1)', { releaseStage: 'd999' })
    const pm = await publishOriginalPostTx(prisma, {
      queueId: idM, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100, releaseStage: 'd10' }, autoAssign: planFor(greedy),
      autoReadyEnv: markedStageEnv({ ...ON, SORAN_RELEASE_STAGE: 'd10', SORAN_CAPACITY_STAGE: 'd10' }),
    })
    check('🔴 대조 — env 가 d10 을 허락하면 같은 행이 나간다 (2일 전 · d10 최소 1일)', pm.kind === 'published', JSON.stringify(pm))
    const pm2 = await (async () => {
      const id = await unassigned({ voice: greedy.code })
      return publishOriginalPostTx(prisma, {
        queueId: id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100, releaseStage: 'd10' }, autoAssign: planFor(greedy),
        autoReadyEnv: markedStageEnv({ ...ON, SORAN_RELEASE_STAGE: 'd10', SORAN_CAPACITY_STAGE: 'd3' }),
      })
    })()
    check('🔴 🔴 **env release 가 d10 이어도 capacity d3 이 천장이다**',
      pm2.kind === 'blocked' && pm2.code === 'AUTO_ASSIGN_STALE' && pm2.detail.includes('(d3)'), JSON.stringify(pm2))

    const hr = await raw()
    const human = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: hr.id, status: 'APPROVED', draftTitle: '사람 글', draftBody: '사람이 고른 글',
        gateVerdict: 'PASS', gateResults: gate() as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, dedupKey: `human-${seq}`,
      },
      select: { id: true },
    })
    const ph = await publishOriginalPostTx(prisma, { queueId: human.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON, autoAssign: planFor(pG) })
    check('🔴 사람 행은 autoAssign 을 쓰지 않는다 — 배정 없으면 기존처럼 NO_MATCH',
      ph.kind === 'blocked' && ph.code === 'NO_MATCH' && await untouched(human.id), JSON.stringify(ph))

    console.log('\n⑧-b 🔴 🔴 이미 배정된 자동 행도 발행 트랜잭션에서 다시 판정한다 — 재배정 없음')
    const pinnedRow = async (p: { id: string; code: string }, body?: string) => {
      const r = await machineRow({ persona: p.id, voice: p.code, body })
      check(`   (${p.code} 도장)`, (await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })).kind === 'stamped')
      return r.id
    }
    // (p) 정상 — 자기 matchedAt(지금) 때문에 WEEKLY_CAP·TOO_SOON 으로 막히지 않는다
    const ok = await freshPersona()
    const idP = await pinnedRow(ok)
    const pp = await publishOriginalPostTx(prisma, { queueId: idP, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **정상 기존 배정 행은 자기 배정 때문에 막히지 않는다 (d1 · 주 1 · 최소 5일)**',
      pp.kind === 'published' && pp.personaCode === ok.code, JSON.stringify(pp))
    // (q) 배정 뒤 말투가 바뀌었다 — 글의 말투 기록이 다른 사람
    const vq = await freshPersona()
    const idQ = await pinnedRow(vq)
    await prisma.originalPostApprovalQueue.update({ where: { id: idQ }, data: { gateResults: gate(GOOD_SR, [], personas[0]!.code) as never } })
    await stale('[기존 배정] 배정 뒤 말투 변경', idQ, undefined, 'VOICE_MISMATCH')
    // (r) 배정 뒤 Persona 생활사가 바뀌었다 — 기혼 → 미혼인데 글은 "남편이"
    const life = await freshPersona({ maritalStatus: '기혼' })
    const idR = await pinnedRow(life, '남편이 요즘 퇴근이 늦어요. 다들 어떻게 지내세요?')
    await prisma.persona.update({ where: { id: life.id }, data: { identity: { maritalStatus: '미혼' } as never } })
    await stale('[기존 배정] 배정 뒤 Persona 생활사 변경 (기혼 → 미혼)', idR, undefined, 'MARITAL_CONFLICT')
    // (s) 배정 뒤 Persona 비활성화
    const off = await freshPersona()
    const idS = await pinnedRow(off)
    await prisma.persona.update({ where: { id: off.id }, data: { status: 'paused' } })
    await stale('[기존 배정] 배정 뒤 Persona 비활성화', idS, undefined, 'NOT_ACTIVE')
    // (t) 배정 뒤 그 Persona 계정에 실제 로그인 Account 가 생겼다
    const acct = await freshPersona()
    const idT = await pinnedRow(acct)
    const acctUser = (await prisma.persona.findUniqueOrThrow({ where: { id: acct.id }, select: { userId: true } })).userId
    await prisma.account.create({ data: { userId: acctUser, type: 'oauth', provider: 'kakao', providerAccountId: `k-${acct.code}` } })
    await stale('[기존 배정] 배정 뒤 실회원 Account 생김', idT, undefined, 'REAL_MEMBER')
    // (u) 자기 배정만 뺀다 — 같은 Persona 가 이번 주 **다른** 글을 받았으면 막힌다
    const two = await freshPersona()
    const idU = await pinnedRow(two)
    await usedBefore(two, 6)
    await stale('[기존 배정] 같은 Persona 의 다른 배정은 센다 (d1 · 주 1)', idU, undefined, 'WEEKLY_CAP')
    // (v) 기존 배정 행에 다른 Persona 계획을 넘겨도 재배정하지 않는다
    const idV = await pinnedRow(await freshPersona())
    const other = await freshPersona()
    const pv = await publishOriginalPostTx(prisma, { queueId: idV, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON, autoAssign: planFor(other) })
    const qv = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: idV } })
    check('🔴 🔴 **기존 배정은 재배정하지 않는다 — 넘긴 계획은 무시된다**',
      pv.kind === 'published' && qv.matchedPersonaId !== other.id && pv.personaCode !== other.code, JSON.stringify(pv))
  }

  console.log('\n⑧-c 🔴 🔴 계획기와 발행 트랜잭션이 같은 판정을 본다 — 막히는 기존 배정 행은 줄에서 빠진다')
  {
    const caps = releaseCapsOf(PROFILES.d1)
    const pinned = async (p: { id: string; code: string }, body?: string) => {
      const r = await machineRow({ persona: p.id, voice: p.code, body })
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      return r.id
    }
    const life = await freshPersona({ maritalStatus: '기혼' })
    const idLife = await pinned(life, '남편이 요즘 퇴근이 늦어요. 다들 어떻게 지내세요?')
    await prisma.persona.update({ where: { id: life.id }, data: { identity: { maritalStatus: '미혼' } as never } })
    const busy = await freshPersona()
    const idBusy = await pinned(busy)
    const used = await machineRow({ persona: busy.id, voice: busy.code })
    await prisma.originalPostApprovalQueue.update({ where: { id: used.id }, data: { status: 'EXPIRED', matchedAt: new Date(NOW.getTime() - 6 * 864e5) } })
    const off = await freshPersona()
    const idOff = await pinned(off)
    await prisma.persona.update({ where: { id: off.id }, data: { status: 'paused' } })
    const good = await freshPersona()
    const idGood = await pinned(good)
    const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })
    const plan = planPublishBatch({ loaded, caps, at: NOW })
    const exc = new Map(plan.autoExceptions.map((x) => [x.id, x.codes]))
    const def = new Map(plan.autoDeferred.map((x) => [x.id, x.codes]))
    check('🔴 🔴 **계획기 — 생활사 충돌은 예외로 뺀다**', exc.get(idLife)?.includes('MARITAL_CONFLICT') === true, JSON.stringify(exc.get(idLife)))
    check('🔴 🔴 **계획기 — 주 상한 소진은 유예로 뺀다**', def.get(idBusy)?.includes('WEEKLY_CAP') === true, JSON.stringify(def.get(idBusy)))
    check('🔴 🔴 **계획기 — 비활성 Persona 는 예외로 뺀다 (러너 전체 중단이 아니다)**',
      exc.get(idOff)?.includes('NOT_ACTIVE') === true && !plan.brokenRecovery.some((b) => b.id === idOff), JSON.stringify(exc.get(idOff)))
    check('🔴 🔴 **계획기 — 정상 기존 배정 행은 자기 배정 때문에 빠지지 않는다**', !exc.has(idGood) && !def.has(idGood)
      && plan.freshOrdered.some((t) => t.id === idGood))
    check('🔴 뺀 행은 발행 줄에 없다', ![idLife, idBusy, idOff].some((id) => plan.freshOrdered.some((t) => t.id === id)))
    // 🔴 같은 행을 발행 트랜잭션에 직접 넣으면 같은 갈래로 막힌다 — 계획기와 트랜잭션이 갈리지 않는다
    for (const [id, route] of [[idLife, '예외'], [idBusy, '유예'], [idOff, '예외']] as const) {
      const r = await publishOriginalPostTx(prisma, { queueId: id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100, releaseStage: 'd1' }, autoReadyEnv: ON })
      check(`🔴 🔴 **트랜잭션도 같은 갈래 (${route})**`, r.kind === 'blocked' && r.code === 'AUTO_ASSIGN_STALE' && r.detail.includes(`${route}:`), JSON.stringify(r))
    }
    for (const id of [idLife, idBusy, idOff, idGood]) {
      await prisma.originalPostApprovalQueue.update({ where: { id }, data: { status: 'EXPIRED' } })
    }
  }

  console.log('\n⑨ 🔴 발행 — 스위치·동시성')
  {
    check('🔴 🔴 **스위치 OFF → 도장 행도 발행 안 됨**',
      (await publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: OFF })).kind === 'blocked')
    const before = await postCount()
    const [p1, p2] = await Promise.all([
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON }),
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON }),
    ])
    check('🔴 🔴 **같은 행을 동시에 발행해도 한 번만 나간다**',
      [p1, p2].filter((x) => x.kind === 'published').length === 1 && (await postCount()) === before + 1, `${p1.kind}/${p2.kind}`)
  }

  console.log('\n⑩ 🔴 감사 선정 — ceil(N×0.2) · 중복 0 · 무엇을 감사하는지 묶는다')
  {
    for (let i = 0; i < 9; i += 1) {
      const r = await machineRow()
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    }
    const n = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
    const s1 = await selectAudits(prisma)
    check(`🔴 🔴 **자동 발행 ${n}건 → 감사 ceil(${n}×0.2)=${Math.ceil(n / 5)}건**`,
      s1.kind === 'ok' && s1.picked.length === Math.ceil(n / 5), JSON.stringify(s1))
    const s2 = await selectAudits(prisma)
    check('🔴 다시 돌려도 더 고르지 않는다', s2.kind === 'ok' && s2.picked.length === 0
      && await prisma.autoReadyAudit.count() === Math.ceil(n / 5))
    const au = await prisma.autoReadyAudit.findFirstOrThrow()
    const post = await prisma.post.findUniqueOrThrow({ where: { id: au.postId } })
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: au.queueId } })
    check('🔴 🔴 **고를 때 발행 글 hash 와 도장 계약 판을 묶었다**',
      au.publishedTitleHash === digestOf(post.title) && au.publishedBodyHash === digestOf(post.content)
      && au.stampContractDigest === readStamp(q.editDiff)?.contractDigest)
  }

  console.log('\n⑪ 🔴 🔴 결과 기록 — 잘못된 글·옛 판정·깨진 결과는 붙지 않는다')
  {
    // 🔴 개수에 기대지 않는다 — 감사가 셋이 될 때까지 자동 발행을 늘리고 고른다
    for (let i = 0; i < 20 && (await prisma.autoReadyAudit.count()) < 3; i += 1) {
      const r = await machineRow()
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      await selectAudits(prisma)
    }
    const audits = await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } })
    check('기록을 시험할 감사가 셋 이상 있다', audits.length >= 3, `${audits.length}건`)
    const au = audits[0]!
    const post = await prisma.post.findUniqueOrThrow({ where: { id: au.postId } })
    const stampOf = async (id: string) => readStamp((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })).editDiff)
    const good = await ruleAuditJudge({ queueId: au.queueId, postId: au.postId, title: post.title, body: post.content, stamp: await stampOf(au.queueId) })
    const rec = (v: typeof good, auditor = 'rule-auditor') => recordAuditResult(prisma, { queueId: au.queueId, verdict: v, auditor, now: NOW })
    check('🔴 🔴 **다른 감사 계약 판의 결과 → staleContract**', await rec({ ...good, contractVersion: 'auto-ready-audit-v0' }) === 'staleContract')
    check('🔴 모델·프롬프트 판이 없는 결과 → badVerdict', await rec({ ...good, model: '' }) === 'badVerdict')
    check('🔴 🔴 **감사자 founder → rejectedAuditor**', await rec(good, 'founder') === 'rejectedAuditor')
    check('🔴 그 사이 아무것도 기록되지 않았다', (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: au.queueId } })).defect === null)
    check('🔴 🔴 **정상 결과는 기록된다**', await rec(good) === 'recorded')
    const saved = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: au.queueId } })
    check('기록에 감사 계약·모델·프롬프트가 남는다',
      saved.defect === 'no' && saved.auditContractVersion === AUDIT_CONTRACT_VERSION
      && saved.auditModel === good.model && saved.auditPromptVersion === good.promptVersion)
    let dbBlocked = false
    try {
      await prisma.$executeRawUnsafe(`UPDATE "AutoReadyAudit" SET "auditModel"=NULL WHERE "queueId"=$1`, au.queueId)
    } catch { dbBlocked = true }
    check('🔴 DB 제약도 판정에 출처가 빠지는 것을 막는다', dbBlocked)
    /**
     * 🔴 🔴 **대기로 남기지 않는다** (2026-09-25 마스터 지적). 앞판은 아래 둘을
     *    `hashMismatch`·`postChanged` 로 돌려주고 감사를 판정 전으로 영원히 남겼다.
     */
    const h = audits[1]!
    const hp = await prisma.post.findUniqueOrThrow({ where: { id: h.postId } })
    const hv = await ruleAuditJudge({ queueId: h.queueId, postId: h.postId, title: hp.title, body: hp.content, stamp: await stampOf(h.queueId) })
    const hr = await recordAuditResult(prisma, { queueId: h.queueId, verdict: { ...hv, defect: 'no', reasons: [], judgedBodyHash: digestOf('다른 글') }, auditor: 'rule-auditor', now: NOW })
    const hs = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: h.queueId } })
    check('🔴 🔴 **판정자가 다른 글을 판정했다(no) → 무결성 yes · 대기 아님**',
      hr === 'integrityDefect' && hs.defect === 'yes' && hs.auditor === INTEGRITY_AUDITOR, `${hr} · ${String(hs.defect)}`)
    const c = audits[2]!
    const cp = await prisma.post.findUniqueOrThrow({ where: { id: c.postId } })
    const cv = await ruleAuditJudge({ queueId: c.queueId, postId: c.postId, title: cp.title, body: cp.content, stamp: await stampOf(c.queueId) })
    await prisma.post.update({ where: { id: c.postId }, data: { content: `${cp.content} (고른 뒤 수정)` } })
    const cr = await recordAuditResult(prisma, { queueId: c.queueId, verdict: { ...cv, defect: 'no', reasons: [] }, auditor: 'rule-auditor', now: NOW })
    const cs = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: c.queueId } })
    check('🔴 🔴 **고른 뒤 글이 바뀌었다(판정 no) → 무결성 yes · 대기 아님**',
      cr === 'integrityDefect' && cs.defect === 'yes' && cs.auditor === INTEGRITY_AUDITOR, `${cr} · ${String(cs.defect)}`)
    await prisma.post.update({ where: { id: c.postId }, data: { content: cp.content } })
    check('확정 결함이 생겨 닫혔다', !(await authoritativeGate(prisma, ON)).open)
    // 🔴 검사 파일의 초기화다 — 다음 구간이 열린 상태에서 시작하도록 감사 표를 비운다
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit"')
    check('감사 표를 비우면 다시 열린다 (다음 구간의 출발점)', (await authoritativeGate(prisma, ON)).open)
  }

  console.log('\n⑫ 🔴 🔴 감사 회차 → 결함 yes → 다음 자동 도장과 발행이 실제로 닫힌다')
  {
    const waiting = await machineRow()
    check('결함 전 도장', (await stampAutoReady(prisma, { queueId: waiting.id, env: ON, now: NOW })).kind === 'stamped')
    check('판정 전 대기는 열림을 막지 않는다 (대기 개수 제한 없음)', (await authoritativeGate(prisma, ON)).open)
    /**
     * 🔴 🔴 **판정자를 믿지 않는다** (2026-09-25 마스터 지적). 무조건 `no` 를 내는 판정자를 넣고,
     *    발행 뒤 큐의 도장을 두 가지로 바꾼다 — 본문 hash · 도장 계약 판.
     *    저장 경계가 직접 대조해 둘 다 `yes`(시스템 무결성)로 남겨야 한다.
     */
    const alwaysNo: AuditJudge = async (i) => ({ ...(await ruleAuditJudge(i)), defect: 'no', reasons: [] })
    /** 🔴 개수에 기대지 않는다 — 판정 전 감사가 넷(바꿀 셋 + 그대로 둘 하나)이 될 때까지 자동 발행을 늘리고 고른다 */
    for (let i = 0; i < 30 && (await prisma.autoReadyAudit.count({ where: { defect: null } })) < 4; i += 1) {
      const r = await machineRow()
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      await selectAudits(prisma)
    }
    const pend = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { queueId: 'asc' } })
    check('바꿔 볼 셋 + 그대로 둘 하나 — 판정 전 감사가 넷 이상 있다', pend.length >= 4, `${pend.length}건`)
    const target = pend[0]!
    const target2 = pend[1]!
    const target3 = pend[2]!
    const tamper = async (queueId: string, patch: Record<string, unknown>) => {
      const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: queueId } })
      await prisma.originalPostApprovalQueue.update({
        where: { id: queueId },
        data: { editDiff: { [AUTO_READY_RECORD_KEY]: { ...readStamp(q.editDiff)!, ...patch } } as never },
      })
    }
    await tamper(target.queueId, { bodyHash: digestOf('도장이 본 것은 다른 본문이었다') })
    await tamper(target2.queueId, { contractDigest: 'other-contract-digest' })
    // 🔴 선정 뒤 **발행 글** 본문이 바뀌었다 — 판정자는 바뀐 글을 보고 no 라고 한다
    const p3 = await prisma.post.findUniqueOrThrow({ where: { id: target3.postId } })
    await prisma.post.update({ where: { id: target3.postId }, data: { content: `${p3.content} (선정 뒤 수정)` } })
    const pendingBefore = await prisma.autoReadyAudit.count({ where: { defect: null } })
    const round = await runAuditRound(prisma, { env: ON, judge: alwaysNo, auditor: 'always-no-auditor', now: NOW })
    check('🔴 🔴 **감사 회차가 판정 전 감사를 전부 판정했다 (개수 제한 없음)**',
      round.kind === 'ok' && round.pending === pendingBefore && (await prisma.autoReadyAudit.count({ where: { defect: null } })) === 0,
      round.kind === 'ok' ? `${round.pending}건 · ${[...round.tally].map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'off')
    const t1 = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: target.queueId } })
    const t2 = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: target2.queueId } })
    check('🔴 🔴 **판정자는 no 인데 도장 본문 hash 가 바뀌었다 → 저장 경계가 yes(무결성)**',
      t1.defect === 'yes' && t1.auditor === INTEGRITY_AUDITOR && t1.auditModel === INTEGRITY_MODEL, `${t1.defect} · ${t1.auditor}`)
    check('🔴 🔴 **판정자는 no 인데 도장 계약 판이 바뀌었다 → 저장 경계가 yes(무결성)**',
      t2.defect === 'yes' && t2.auditor === INTEGRITY_AUDITOR, `${t2.defect} · ${t2.auditor}`)
    const t3 = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: target3.queueId } })
    check('🔴 🔴 **판정자는 no 인데 선정 뒤 Post 본문이 바뀌었다 → 저장 경계가 yes(무결성)**',
      t3.defect === 'yes' && t3.auditor === INTEGRITY_AUDITOR && (t3.note ?? '').includes('바뀌었다'), `${t3.defect} · ${t3.auditor} · ${t3.note}`)
    check('🔴 바뀌지 않은 감사는 판정자의 no 가 그대로 기록됐다 — 과하게 막지 않는다',
      (await prisma.autoReadyAudit.count({ where: { defect: 'no', auditor: 'always-no-auditor' } })) >= 1)
    check('확정 결함 ≥ 1', await unresolvedDefectCount(prisma) >= 1)
    const next = await authoritativeGate(prisma, ON)
    check('🔴 🔴 **다음 회차 열림 판정 → 닫힘**', !next.open && next.reasons.some((x) => x.includes('확정 결함')))
    const fresh = await machineRow()
    check('🔴 🔴 **다음 자동 도장 → closed · 도장 0**', (await stampAutoReady(prisma, { queueId: fresh.id, env: ON, now: NOW })).kind === 'closed'
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: fresh.id } })).decidedBy === 'machine:auto-draft-v5')
    const before = await postCount()
    const pw = await publishOriginalPostTx(prisma, { queueId: waiting.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **결함 전에 찍힌 도장 행도 발행 트랜잭션에서 막힌다 · Post 0**',
      pw.kind === 'blocked' && pw.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(pw))
    const noJudge: AuditJudge = async (i) => ({ ...(await ruleAuditJudge(i)), defect: 'no', reasons: [] })
    const tp = await prisma.post.findUniqueOrThrow({ where: { id: target.postId } })
    const vNo = await noJudge({ queueId: target.queueId, postId: target.postId, title: tp.title, body: tp.content, stamp: null })
    check('🔴 🔴 **yes → no 는 안 된다 (끈적하다)**',
      await recordAuditResult(prisma, { queueId: target.queueId, verdict: vNo, auditor: 'other-auditor', now: NOW }) === 'stickyYes')
  }

  console.log('\n⑫-b 🔴 🔴 같은 감사에 yes 와 no 가 동시에 들어와도 yes 가 사라지지 않는다')
  {
    // 판정 전 감사 하나를 새로 만든다 — 자동 발행을 늘리고 모자란 만큼 고른다
    let fresh: string | null = null
    for (let i = 0; i < 5 && fresh === null; i += 1) {
      const r = await machineRow()
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { decidedBy: AUTO_DECIDER } })
      const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: r.id } })
      await prisma.originalPostApprovalQueue.update({
        where: { id: r.id },
        data: { editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(row.draftTitle, row.draftBody, NOW) } as never },
      })
      // 🔴 확정 결함 때문에 자동 발행은 닫혀 있다 — 감사 대상을 만들려고 검사가 직접 Post 를 붙인다
      const u = await prisma.user.create({ data: { nickname: `감사대상${i}` }, select: { id: true } })
      const post = await prisma.post.create({
        data: { boardType: 'FREE', title: row.draftTitle, content: row.draftBody, authorId: u.id },
        select: { id: true },
      })
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { status: 'PUBLISHED', createdPostId: post.id } })
      const s = await selectAudits(prisma)
      if (s.kind === 'ok' && s.picked.length > 0) fresh = s.picked[0]!
    }
    check('동시 기록을 시험할 판정 전 감사가 있다', fresh !== null)
    if (fresh !== null) {
      const a2 = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: fresh } })
      const p2 = await prisma.post.findUniqueOrThrow({ where: { id: a2.postId } })
      const base = await ruleAuditJudge({ queueId: fresh, postId: a2.postId, title: p2.title, body: p2.content, stamp: null })
      const [ry, rn] = await Promise.all([
        recordAuditResult(prisma, { queueId: fresh, verdict: { ...base, defect: 'yes' }, auditor: 'auditor-a', now: NOW }),
        recordAuditResult(prisma, { queueId: fresh, verdict: { ...base, defect: 'no', reasons: [] }, auditor: 'auditor-b', now: NOW }),
      ])
      const final = (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: fresh } })).defect
      check('🔴 🔴 **yes 가 기록됐다고 답했으면 최종 값은 반드시 yes**',
        ry !== 'recorded' || final === 'yes', `yes=${ry} · no=${rn} · 최종=${String(final)}`)
      check('🔴 충돌은 예외가 아니라 값(race)으로 온다 — 조용히 잃지 않는다',
        ['recorded', 'stickyYes', 'race'].includes(ry) && ['recorded', 'stickyYes', 'race'].includes(rn), `${ry}/${rn}`)
    }
  }

  console.log('\n⑭ 🔴 🔴 감사 대상 유실 → 대기로 남기지 않고 무결성 yes → 다음 도장 0 · 기존 도장 발행 0')
  {
    // 🔴 검사 파일의 초기화다 — Queue·Post 유실을 각각 독립으로 보려고 감사 표를 비운다
    const resetAudits = () => prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit"')
    /** 🔴 FK 를 우회해야만 지울 수 있다 — 격리 DB 에서 "그래도 사라진" 상황을 만든다 */
    const lose = (table: 'Post' | 'OriginalPostApprovalQueue', id: string) => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1`, id)
    })
    const fkCode = async (f: () => Promise<unknown>): Promise<string> => {
      try { await f(); return 'deleted' } catch (e) { return (e as { code?: string }).code ?? 'error' }
    }
    /** 🔴 무조건 no — 판정자를 믿지 않는다는 것을 보이려고 넣는다 */
    const alwaysNo14: AuditJudge = async (i) => ({ ...(await ruleAuditJudge(i)), defect: 'no', reasons: [] })
    for (const kind of ['PostEdit', 'Queue', 'Post'] as const) {
      await resetAudits()
      const lab = kind === 'PostEdit' ? 'Post 본문 변경' : `${kind} 유실`
      check(`[${kind}] 시작 — 확정 결함 0 · 열림`, (await authoritativeGate(prisma, ON)).open)
      const waiting = await machineRow()
      check(`[${kind}] 유실 전에 찍힌 대기 도장`, (await stampAutoReady(prisma, { queueId: waiting.id, env: ON, now: NOW })).kind === 'stamped')
      const sel = await selectAudits(prisma)
      const au = sel.kind === 'ok' ? sel.picked[0] : undefined
      check(`[${kind}] 감사 대상이 골라졌다`, au !== undefined, JSON.stringify(sel))
      if (au === undefined) continue
      const row = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: au } })
      if (kind === 'PostEdit') {
        // 🔴 선정 뒤 발행 글 본문이 바뀌었다 — 지우지 않고 고친다
        const p0 = await prisma.post.findUniqueOrThrow({ where: { id: row.postId } })
        await prisma.post.update({ where: { id: row.postId }, data: { content: `${p0.content} (선정 뒤 수정)` } })
      } else if (kind === 'Post') {
        const code = await fkCode(() => prisma.post.delete({ where: { id: row.postId } }))
        check('🔴 🔴 **FK RESTRICT — 감사 중인 Post 는 지울 수 없다 (P2003)**', code === 'P2003', code)
        await lose('Post', row.postId)
      } else {
        const code = await fkCode(() => prisma.originalPostApprovalQueue.delete({ where: { id: row.queueId } }))
        check('🔴 🔴 **FK RESTRICT — 감사 중인 큐 행은 지울 수 없다 (P2003)**', code === 'P2003', code)
        await lose('OriginalPostApprovalQueue', row.queueId)
      }
      const round = await runAuditRound(prisma, {
        env: ON, judge: kind === 'PostEdit' ? alwaysNo14 : ruleAuditJudge, auditor: 'rule-auditor', now: NOW,
      })
      const after = await prisma.autoReadyAudit.findUnique({ where: { queueId: au } })
      check(`🔴 🔴 **[${lab}] 대기로 남기지 않고 시스템 무결성 yes 를 기록했다${kind === 'PostEdit' ? ' (판정자는 무조건 no)' : ''}**`,
        after?.defect === 'yes' && after.auditor === INTEGRITY_AUDITOR
        && round.kind === 'ok' && (round.tally.get('integrityDefect') ?? 0) >= 1,
        `${String(after?.defect)} · ${String(after?.auditor)} · ${round.kind === 'ok' ? [...round.tally].map(([k, v]) => `${k} ${v}`).join(' ') : 'off'}`)
      check(`[${lab}] 판정 전 감사가 남지 않았다`, (await prisma.autoReadyAudit.count({ where: { defect: null } })) === 0)
      const fresh = await machineRow()
      const st = await stampAutoReady(prisma, { queueId: fresh.id, env: ON, now: NOW })
      check(`🔴 🔴 **[${lab}] 다음 자동 도장 0**`,
        st.kind === 'closed' && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: fresh.id } })).decidedBy === 'machine:auto-draft-v5',
        JSON.stringify(st))
      const before = await postCount()
      const pw = await publishOriginalPostTx(prisma, { queueId: waiting.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      check(`🔴 🔴 **[${lab}] 유실 전에 찍힌 도장 행도 발행 0**`,
        pw.kind === 'blocked' && pw.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(pw))
    }
  }

  console.log('\n⑭-b 🔴 🔴 감사로 뽑히지 않은 자동 발행 글이 사라져도 — 열림이 닫힌다 (감사 행 없음)')
  {
    // 🔴 검사 파일의 초기화 — 앞 구간이 남긴 유실 행(글 없는 큐 행)과 감사 표를 치운다
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit"')
    const pubRows = await prisma.originalPostApprovalQueue.findMany({ where: { createdPostId: { not: null } }, select: { id: true, createdPostId: true } })
    const alive = new Set((await prisma.post.findMany({ where: { id: { in: pubRows.map((x) => x.createdPostId!) } }, select: { id: true } })).map((x) => x.id))
    for (const o of pubRows.filter((x) => !alive.has(x.createdPostId!))) await prisma.originalPostApprovalQueue.delete({ where: { id: o.id } })
    check('시작 — 열림', (await authoritativeGate(prisma, ON)).open, (await authoritativeGate(prisma, ON)).reasons.join(' · '))
    const waiting = await machineRow()
    check('유실 전에 찍힌 대기 도장', (await stampAutoReady(prisma, { queueId: waiting.id, env: ON, now: NOW })).kind === 'stamped')
    const r = await machineRow()
    await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
    const pub = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('자동 발행 1건 — 감사 선정은 돌리지 않는다', pub.kind === 'published', JSON.stringify(pub))
    if (pub.kind === 'published') {
      check('🔴 그 글에는 감사 행이 없다', (await prisma.autoReadyAudit.count({ where: { queueId: r.id } })) === 0)
      let code = 'deleted'
      try { await prisma.post.delete({ where: { id: pub.postId } }) } catch (e) { code = (e as { code?: string }).code ?? 'error' }
      check('🔴 🔴 **FK RESTRICT — 큐 행이 가리키는 발행 글은 지울 수 없다 (P2003)**', code === 'P2003', code)
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
        await tx.$executeRawUnsafe('DELETE FROM "Post" WHERE "id" = $1', pub.postId)
      })
      const g = await authoritativeGate(prisma, ON)
      check('🔴 🔴 **감사 행이 없어도 열림 판정이 닫힌다 — 글이 사라진 자동 발행**',
        !g.open && g.reasons.some((x) => x.includes('글이 사라진 자동 발행 1건')), g.reasons.join(' · '))
      const next = await machineRow()
      const st = await stampAutoReady(prisma, { queueId: next.id, env: ON, now: NOW })
      check('🔴 🔴 **다음 자동 도장 0**', st.kind === 'closed', JSON.stringify(st))
      const round = await stampRound(prisma, { env: ON, now: NOW })
      check('🔴 🔴 **도장 회차(묶음)도 0**', (round.get('stamped') ?? 0) === 0, [...round].map(([k, v]) => `${k} ${v}`).join(' '))
      const before = await postCount()
      const pw = await publishOriginalPostTx(prisma, { queueId: waiting.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
      check('🔴 🔴 **유실 전에 찍힌 도장 행도 발행 0**',
        pw.kind === 'blocked' && pw.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(pw))
      const sel = await selectAudits(prisma)
      check('🔴 선정은 멈추지 않고 유실을 값으로 알린다 (러너는 이 값이 있으면 실패로 끝낸다)',
        sel.kind === 'ok' && sel.missingPost.includes(r.id), JSON.stringify(sel))
      check('🔴 선정 뒤에도 닫힘은 그대로다 — 로그가 아니라 DB 상태가 닫는다', !(await authoritativeGate(prisma, ON)).open)
    }
  }

  console.log('\n⑬ 🔴 founder 기록 0')
  {
    const founderAfter = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
    // 사람 행 1건(⑧)은 검사가 직접 만든 사람 결정이다 — 사슬이 만든 것이 아니다
    check('🔴 🔴 **사슬 전체를 돌아도 사슬이 founder 결정을 만들지 않았다**',
      founderAfter === founderBefore + 1, `${founderBefore} → ${founderAfter} (검사가 직접 만든 사람 행 1)`)
    check('🔴 감사자 founder 0', await prisma.autoReadyAudit.count({ where: { auditor: HUMAN_DECIDER } }) === 0)
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()
