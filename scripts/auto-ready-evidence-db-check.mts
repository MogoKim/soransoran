#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 — 복원·배치 검토 기록 실행 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   A. 의미 검수 복원 — 정확한 artifact 만 · 쓰는 칸은 gateResults 하나 · CAS · 재실행 0
 *   B. 배치 검토 기록 — 검토자 출처 · 사람만 표본 · hardDefect 미측정은 unmeasured
 *   C. 게이트 — 29 닫힘 · 30·90%·0 열림 · 기준 불변
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다(sentinel · localhost · soran_test). 모델 호출 0.
 *
 *   npm run auto-ready:evidence-db-check
 */
import { PrismaClient } from '@prisma/client'

import {
  digestOf, bindingOf, humanSampleOf, EVIDENCE_REVIEW_CONTRACT, readEvidenceReviews, type ArtifactDoc, type CandidateDoc,
} from '../src/lib/auto-ready-evidence'
import {
  planSemanticRestore, applySemanticRestore, planNonHumanImport, applyReviewImport, recordHumanBatch, readHumanRowStates, SEMANTIC_RESTORE_KEY,
  type HumanActor, type ReviewFile,
} from '../src/lib/auto-ready-evidence-store'
import { HUMAN_DECIDER, CONTRACT } from '../src/lib/auto-ready-v2'
import { evidenceFromDb, legacyEvidenceFromDb } from '../src/lib/auto-ready-repo'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE, semanticSummaryOf,
} from '../src/lib/micro-seed-supply-autofill'

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

/** 🔴 jsonb 는 키 순서를 바꾼다 — 비교는 키를 정렬해서 한다 */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x)) ?? 'undefined'
const NOW = new Date()
const CAP = new Date(NOW.getTime() - 2 * 864e5)
const REVIEW = {
  deterministic: { pass: true }, semanticCompletion: { complete: true },
  semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.95 },
}
const CONTRACT_A = { pipelineVersion: 'content-core-v2.1', promptVersion: 'p7', stageModels: { draftGen: 'g', speakerPlan: 'g', semanticReview: 'h' } }

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY 증거 — 복원·배치 검토 기록 (격리 DB 전용 · 운영 DB 0) ══\n')
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE',
  )
  const u = await prisma.user.create({ data: { nickname: '증거P' }, select: { id: true } })
  const persona = await prisma.persona.create({ data: { code: 'P04', userId: u.id, status: 'active' }, select: { id: true } })

  const artifacts = new Map<string, ArtifactDoc[]>()
  const candidates = new Map<string, CandidateDoc[]>()
  let seq = 0
  /**
   * 사람 결정 표식이 있는 기계 후보 한 건 + 그 artifact 한 장.
   * 🔴 `semanticReview` 는 비어 있다 — 운영의 founder 기계 행과 같은 모양이다(실측 11/11).
   */
  const seed = async (o: {
    artifactId?: string; addArtifact?: boolean; artifactDraftBody?: string; artifactVoice?: string
    edited?: boolean; body?: string; declined?: boolean; undecided?: boolean; matchedPersonaId?: string; published?: boolean
    /** 🔴 지금 품질 계약으로 적재된 행 — 적재 때 의미 검수 요약과 계약 표식이 함께 저장돼 있다 */
    current?: boolean
  } = {}) => {
    seq += 1
    const art = o.artifactId ?? digestOf(`art-${seq}`).slice(0, 32)
    const base = `A${1000 + seq}`
    const title = `평범한 하루 ${seq}`
    const body = o.body ?? `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`
    const raw = await prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, sourceUrl: `https://example.invalid/e${seq}`,
        sourceArticleId: `${base}-deadbeef`, sourceCapturedAt: CAP, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
    const row = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: raw.id, status: o.declined === true ? 'DECLINED' : o.edited === true ? 'EDITED' : 'APPROVED',
        draftTitle: title, draftBody: body, ...(o.declined === true ? { declineReason: 'TOPIC_UNFIT' } : {}),
        ...(o.edited === true ? { editedBody: `${body} (수정)` } : {}),
        gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        gateResults: {
          holds: [], blocks: [],
          autoDraft: {
            provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
            draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
            artifactId: o.artifactId === '' ? '' : art, sourceArticleId: base, pipelineVersion: CONTRACT_A.pipelineVersion,
            draftPromptVersion: CONTRACT_A.promptVersion, stageModels: CONTRACT_A.stageModels,
            voice: { personaCode: 'P04', bundleDigest: 'bd', sourceDigest: 'sd' },
          },
          ...(o.current === true ? { semanticReview: semanticSummaryOf(REVIEW), [QUALITY_CONTRACT_KEY]: currentQualityContract() } : {}),
        } as never,
        editDiff: o.edited === true ? { bodyChanged: true, titleChanged: false } as never : undefined,
        // 🔴 결정 전 그림자는 기계 표식 · 미배정이다(운영의 HUMAN_REVIEW_REQUIRED 행과 같은 모양)
        decidedBy: o.undecided === true ? 'machine:auto-draft-v5' : HUMAN_DECIDER, dedupKey: `ev-${seq}`,
        ...(o.undecided === true ? {} : { matchedPersonaId: o.matchedPersonaId ?? persona.id, matchedAt: NOW }),
      },
      select: { id: true },
    })
    if (o.published === true) {
      // 🔴 발행된 행 — 실제 글을 가리킨다(createdPostId FK)
      const post = await prisma.post.create({ data: { boardType: 'FREE', title, content: body, authorId: u.id }, select: { id: true } })
      await prisma.originalPostApprovalQueue.update({ where: { id: row.id }, data: { status: 'PUBLISHED', createdPostId: post.id } })
    }
    if (o.addArtifact !== false && o.artifactId !== '') {
      const doc: ArtifactDoc = {
        file: `auto-draft-${seq}.artifacts.json`, artifactId: art, sourceArticleId: base, contract: CONTRACT_A,
        planPersonaCode: o.artifactVoice ?? 'P04', voice: { personaCode: o.artifactVoice ?? 'P04', bundleDigest: 'bd', sourceDigest: 'sd' },
        draft: { title, body: o.artifactDraftBody ?? body }, review: REVIEW,
      }
      artifacts.set(art, [...(artifacts.get(art) ?? []), doc])
      candidates.set(art, [{ file: `auto-draft-${seq}.candidates.json`, artifactId: art, sourceArticleId: base, sourceSite: 'navercafe:x' }])
    }
    return { id: row.id, art, title, body }
  }
  const snap = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
  const planOf = async (id: string) => (await planSemanticRestore(prisma, artifacts, candidates, NOW)).find((p) => p.id === id)!

  console.log('A. 🔴 의미 검수 복원')
  {
    const ok = await seed()
    const before = await snap(ok.id)
    const postsBefore = await prisma.post.count()
    const p = await planOf(ok.id)
    check('정확한 artifact 한 장 · 출처·Persona·초안 일치 → clean · write 계획', p.klass === 'clean' && p.action === 'write', JSON.stringify(p.reasons))
    check('🔴 계획은 쓰지 않는다 (dry-run 과 같은 경로)', (await snap(ok.id)).updatedAt.getTime() === before.updatedAt.getTime())
    check('🔴 🔴 **적용 → 정확히 1행**', await applySemanticRestore(prisma, p) === 1)
    const after = await snap(ok.id)
    const g = after.gateResults as Record<string, unknown>
    check('🔴 🔴 **복원값은 artifact 의 기존 판정 그대로 — semanticSummaryOf(review)**',
      stable(g.semanticReview) === stable(semanticSummaryOf(REVIEW)), `${stable(g.semanticReview)} vs ${stable(semanticSummaryOf(REVIEW))}`)
    check('🔴 복원 표식에 artifactId·파일·review digest 가 남는다',
      (g[SEMANTIC_RESTORE_KEY] as Record<string, unknown>)?.artifactId === ok.art)
    check('🔴 🔴 **바뀐 칸은 gateResults(+updatedAt)뿐 — decidedBy·status·createdPostId·Persona·초안·editDiff 불변 · Post 0**',
      after.decidedBy === before.decidedBy && after.status === before.status && after.createdPostId === before.createdPostId
      && after.matchedPersonaId === before.matchedPersonaId && after.draftTitle === before.draftTitle && after.draftBody === before.draftBody
      && stable(after.editDiff) === stable(before.editDiff) && (await prisma.post.count()) === postsBefore
      && stable((before.gateResults as Record<string, unknown>).autoDraft) === stable(g.autoDraft))
    const again = await planOf(ok.id)
    check('🔴 🔴 **재실행 → unchanged · 쓰기 0 · updatedAt 그대로**',
      again.action === 'unchanged' && await applySemanticRestore(prisma, again) === 0
      && (await snap(ok.id)).updatedAt.getTime() === after.updatedAt.getTime())

    const writes0 = async (label: string, id: string, want: string) => {
      const b = await snap(id)
      const q = await planOf(id)
      const n = await applySemanticRestore(prisma, q)
      check(`🔴 🔴 **${label} → ${want} · write 0**`, q.klass === want && q.action === 'skip' && n === 0
        && (await snap(id)).updatedAt.getTime() === b.updatedAt.getTime(), `${q.klass} · ${n}`)
    }
    await writes0('artifactId 없음', (await seed({ artifactId: '' })).id, 'missing')
    await writes0('artifact 정본에 없음', (await seed({ addArtifact: false })).id, 'missing')
    const dup = await seed()
    artifacts.set(dup.art, [...artifacts.get(dup.art)!, { ...artifacts.get(dup.art)![0]!, file: 'other.artifacts.json' }])
    await writes0('같은 artifact 두 장', dup.id, 'ambiguous')
    await writes0('초안 한 글자 변경', (await seed({ artifactDraftBody: undefined, body: '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?' }).then(async (s) => {
      artifacts.get(s.art)![0]!.draft.body = `${s.body}!`; return s
    })).id, 'draftMismatch')
    await writes0('Persona provenance 변경 (artifact 는 P05)', (await seed({ artifactVoice: 'P05' })).id, 'provenanceMismatch')
    const u5 = await prisma.user.create({ data: { nickname: '증거P5' }, select: { id: true } })
    const p05 = await prisma.persona.create({ data: { code: 'P05', userId: u5.id, status: 'active' }, select: { id: true } })
    await writes0('큐 배정 Persona(P05) ≠ artifact plan·voice(P04)', (await seed({ matchedPersonaId: p05.id })).id, 'provenanceMismatch')

    const race = await seed()
    const rp = await planOf(race.id)
    // 🔴 같은 ms 안의 경쟁을 결정적으로 만든다 — 경쟁자가 gateResults 를 바꾸고 updatedAt 은 그대로다
    await prisma.originalPostApprovalQueue.update({
      where: { id: race.id },
      data: { gateResults: { ...(rp.snapshot.gateResults as object), holds: ['경쟁'] } as never, updatedAt: rp.snapshot.updatedAt },
    })
    const rn = await applySemanticRestore(prisma, rp)
    check('🔴 🔴 **계획 뒤 경쟁 수정(같은 updatedAt) → CAS 0 · 경쟁자 값 보존**',
      rp.action === 'write' && rn === 0 && (await snap(race.id)).gateResults !== null
      && ((await snap(race.id)).gateResults as Record<string, unknown>).semanticReview === undefined
      && JSON.stringify(((await snap(race.id)).gateResults as Record<string, unknown>).holds) === '["경쟁"]', String(rn))
  }

  const founderUser = (await prisma.user.create({ data: { nickname: '창업자', isAdmin: true }, select: { id: true } })).id
  /** 🔴 인증된 관리자는 human:operator — 사람을 가르는 정본은 userId 다 */
  const FOUNDER: HumanActor = { userId: founderUser, reviewer: 'human:operator' }
  const opB = (await prisma.user.create({ data: { nickname: '운영자B', isAdmin: true }, select: { id: true } })).id
  const OP_B: HumanActor = { userId: opB, reviewer: 'human:operator' }
  const bundleOf = (rows: { id: string; title: string; body: string }[], tag: string) => ({
    digest: digestOf(`bundle-${tag}`),
    items: rows.map((r) => ({ queueId: r.id, draftTitleDigest: digestOf(r.title), draftBodyDigest: digestOf(r.body) })),
  })
  /**
   * 🔴 의미 검수가 채워진 행. 사람 결정 행은 복원 경로로 채우고, 결정 전 그림자는 적재 때 이미
   *    저장돼 있던 모양으로 만든다(운영의 그림자 5건은 경고 0 · 의미 검수 저장됨이다).
   */
  const restored = async (o: Parameters<typeof seed>[0] = {}) => {
    const r = await seed(o)
    if (o.undecided === true) {
      const g = (await snap(r.id)).gateResults as Record<string, unknown>
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { gateResults: { ...g, semanticReview: semanticSummaryOf(REVIEW) } as never } })
    } else {
      await applySemanticRestore(prisma, await planOf(r.id))
    }
    return r
  }
  /**
   * 🔴 B 구간은 **사람 기록 규칙**(출처 · 결속 · 사용자별 최신)을 잰다 — 옛 계약 행의 보고(legacy)로 센다.
   *    열림 판정(지금 품질 계약 cohort)은 C 구간과 `auto-ready:quality-db-check` 가 본다.
   */
  const ev = () => legacyEvidenceFromDb(prisma)

  console.log('\nB-1. 🔴 CLI importer — 사람 기록을 만들지 못한다 (P0-1 반례)')
  {
    const a = await restored()
    const bundle = bundleOf([a], 'cli')
    const file = (o: Record<string, unknown> = {}): ReviewFile => ({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', bundleDigest: bundle.digest,
      items: [{ ...bundle.items[0], hardDefect: 'no' }], ...o,
    })
    const run = async (f: ReviewFile) => {
      const plan = await planNonHumanImport(prisma, f, bundle, NOW)
      let n = 0
      if (plan.ok) for (const i of plan.items) n += await applyReviewImport(prisma, i)
      return { plan, n }
    }
    for (const who of ['human:founder', 'human:operator']) {
      const r = await run(file({ reviewer: who }))
      check(`🔴 🔴 **임의 파일 reviewer=${who} → 파일 거절 · write 0 · 표본 0**`, !r.plan.ok && r.n === 0 && (await ev()).eligible === 0)
    }
    check('🔴 임의 문자열 · 대소문자 변형 · machine:auto-ready 도 거절',
      !(await run(file({ reviewer: 'founder' }))).plan.ok && !(await run(file({ reviewer: 'Human:founder' }))).plan.ok
      && !(await run(file({ reviewer: 'machine:auto-ready' }))).plan.ok)
    const cx = await run(file({ reviewer: 'codex:master-review', reviewedAt: '2099-01-01T00:00:00Z' }))
    const saved = readEvidenceReviews((await snap(a.id)).editDiff)[0]
    check('🔴 🔴 **Codex 기록은 남지만 사람 표본이 아니다**', cx.n === 1 && saved?.reviewer === 'codex:master-review' && (await ev()).eligible === 0)
    check('🔴 🔴 **파일의 미래 reviewedAt(2099)은 저장되지 않는다 — 프로세스 시계 (P0 반례 4)**',
      saved?.reviewedAt === NOW.toISOString(), String(saved?.reviewedAt))
    check('🔴 Codex 기록의 결과도 파일이 아니라 지금 행 상태로 결속된다', saved?.outcome === 'noEdit' && saved.reviewerUserId === null)
    check('🔴 모델 기록도 표본이 아니다', (await run(file({ reviewer: 'model:semantic-audit' }))).n === 1 && (await ev()).eligible === 0)
    check('🔴 같은 Codex 재실행 → unchanged · write 0', (await run(file({ reviewer: 'codex:master-review' }))).n === 0)
  }

  console.log('\nB-2. 🔴 서버 경계 — 인증된 검토자만 · 요청의 reviewer·reviewedAt 무시')
  {
    // 🔴 발행된 행 — 결함 yes 도 사후 기록으로 받는다(재판정 반례에 쓴다)
    const a = await restored({ published: true })
    const bundle = bundleOf([a], 'auth')
    const before = await snap(a.id)
    for (const [label, actor] of [
      ['비사람 actor', { userId: founderUser, reviewer: 'codex:master-review' }],
      ['사용자 id 없음', { userId: '', reviewer: 'human:founder' }],
      ['DB 에 없는 사용자', { userId: 'no-such-user', reviewer: 'human:founder' }],
    ] as const) {
      const r = await recordHumanBatch(prisma, { actor: actor as never, now: NOW, bundle, entries: [{ queueId: a.id, hardDefect: 'no' }] })
      check(`🔴 🔴 **인증되지 않은 기록(${label}) → write 0**`, r.every((x) => x.result === 'reject')
        && (await snap(a.id)).updatedAt.getTime() === before.updatedAt.getTime(), JSON.stringify(r))
    }
    const later = new Date(NOW.getTime() + 1000)
    const r = await recordHumanBatch(prisma, {
      actor: FOUNDER, now: later, bundle,
      entries: [{ queueId: a.id, hardDefect: 'no', reviewer: 'codex:master-review', reviewedAt: '2099-01-01T00:00:00Z' } as never],
    })
    const rec0 = readEvidenceReviews((await snap(a.id)).editDiff).find((x) => x.reviewerUserId === founderUser)
    check('🔴 🔴 **서버가 검토자·시각을 정한다 — 요청의 reviewer·reviewedAt 은 무시**',
      r[0]?.result === 'recorded' && rec0?.reviewerUserId === founderUser && rec0.reviewedAt === later.toISOString(), JSON.stringify(r))
    check('🔴 🔴 **인증된 사람 기록 → 사람 표본 1**', (await ev()).eligible === 1)
    const again = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(later.getTime() + 1000), bundle, entries: [{ queueId: a.id, hardDefect: 'no' }] })
    check('🔴 같은 사람·같은 결속 재실행 → unchanged · write 0', again[0]?.result === 'unchanged')
    const rejudge = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(later.getTime() + 2000), bundle, entries: [{ queueId: a.id, hardDefect: 'yes', reasons: ['모순'] }] })
    const mine = readEvidenceReviews((await snap(a.id)).editDiff).filter((x) => x.reviewerUserId === founderUser)
    check('🔴 🔴 **같은 사람의 재판정 → 새 기록을 쌓는다 · 옛 기록 보존 · 최신이 유효(yes)**',
      rejudge[0]?.result === 'recorded' && mine.length === 2 && (await ev()).hardDefects === 1, JSON.stringify(rejudge))
    await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(later.getTime() + 3000), bundle, entries: [{ queueId: a.id, hardDefect: 'no' }] })
    const back = await ev()
    check('🔴 🔴 **같은 사람이 yes 뒤에 no 로 다시 판정 → 최신 no 가 유효 · 기록 3개 이력 보존**',
      back.hardDefects === 0 && readEvidenceReviews((await snap(a.id)).editDiff).filter((x) => x.reviewerUserId === founderUser).length === 3, JSON.stringify(back))
    const noDecisionChange = await recordHumanBatch(prisma, { actor: FOUNDER, now: later, bundle, entries: [{ queueId: a.id, decision: 'reject', declineReason: 'TOPIC_UNFIT', hardDefect: 'no' }] })
    check('🔴 이미 결정된 행의 결정은 바꾸지 않는다', noDecisionChange[0]?.result === 'reject' && (await snap(a.id)).status === 'PUBLISHED')
    // 🔴 서버를 거치지 않고 DB 에 직접 넣은 사람 기록 — 사용자 id 가 없으면 무효
    const forged = await restored()
    const fr = await snap(forged.id)
    await prisma.originalPostApprovalQueue.update({
      where: { id: forged.id },
      data: { editDiff: { evidenceReviews: [{
        contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: null,
        ...bindingOf(fr), hardDefect: 'no', reasons: [], bundleDigest: digestOf('x'), reviewedAt: NOW.toISOString(),
      }] } as never },
    })
    const ef = await ev()
    check('🔴 🔴 **사용자 id 없는 human 기록(DB 직접 위조) → 표본 아님**', ef.eligible === 1 && readEvidenceReviews((await snap(forged.id)).editDiff).length === 0, JSON.stringify(ef.excluded))
    const stale = await restored()
    const staleBundle = bundleOf([stale], 'stale')
    await prisma.originalPostApprovalQueue.update({ where: { id: stale.id }, data: { draftBody: `${stale.body}.` } })
    check('🔴 묶음 뒤 초안이 바뀌었다 → 거절 · write 0',
      (await recordHumanBatch(prisma, { actor: FOUNDER, now: later, bundle: staleBundle, entries: [{ queueId: stale.id, hardDefect: 'no' }] }))[0]?.result === 'reject')
  }

  console.log('\nB-3. 🔴 결과(outcome)는 사람 기록이 확정한다 · 검토 뒤 바뀌면 즉시 제외 (P0-2 반례)')
  {
    const e1b = await ev()
    const base0 = e1b.eligible
    const ne = await restored()
    const ed = await restored({ edited: true })
    const dc = await restored({ declined: true })
    // 🔴 Codex 가 남긴 옛 수정 표식 — 본문은 그대로다(결과는 표식이 아니라 상태가 정한다)
    const lg = await restored()
    await prisma.originalPostApprovalQueue.update({ where: { id: lg.id }, data: { editDiff: { bodyChanged: true, note: 'codex 수정 표식' } as never } })
    const bundle = bundleOf([ne, ed, dc, lg], 'outcome')
    const r = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle, entries: [ne, ed, dc, lg].map((x) => ({ queueId: x.id, hardDefect: 'no' })) })
    const e1 = await ev()
    check('🔴 🔴 **noEdit · edited · declined 각각 결속 기록 · 표본 +4**',
      r.every((x) => x.result === 'recorded') && e1.eligible === base0 + 4, JSON.stringify(r))
    const outs = await Promise.all([ne, ed, dc, lg].map(async (x) => readEvidenceReviews((await snap(x.id)).editDiff).find((y) => y.reviewerUserId === founderUser)?.outcome))
    const e0 = await ev()
    check('🔴 🔴 **표본의 결과 집계도 기록에서 온다 — 옛 수정 표식 행은 noEdit 로 센다**',
      e0.noEdit - e1b.noEdit === 2 && e0.edited - e1b.edited === 1 && e0.declined - e1b.declined === 1,
      `noEdit +${e0.noEdit - e1b.noEdit} · edited +${e0.edited - e1b.edited} · declined +${e0.declined - e1b.declined}`)
    check('🔴 🔴 **각 기록의 결과 — noEdit · edited · declined · (옛 수정 표식 행) noEdit**',
      outs.join(',') === 'noEdit,edited,declined,noEdit', outs.join(','))
    await prisma.originalPostApprovalQueue.update({ where: { id: ed.id }, data: { editedBody: '검토 뒤 또 고친 본문' } })
    const e2 = await ev()
    check('🔴 🔴 **검토 뒤 editedBody 변경 → 즉시 표본 제외**', e2.eligible === e1.eligible - 1 && e2.excluded.bindingBroken >= 1)
    await prisma.originalPostApprovalQueue.update({ where: { id: dc.id }, data: { declineReason: 'TITLE_WEAK' } })
    check('🔴 🔴 **검토 뒤 폐기 사유 변경 → 즉시 표본 제외**', (await ev()).eligible === e2.eligible - 1)
    await prisma.originalPostApprovalQueue.update({ where: { id: ne.id }, data: { status: 'DECLINED', declineReason: 'TOPIC_UNFIT' } })
    check('🔴 🔴 **noEdit 검토 뒤 폐기 → 즉시 표본 제외**', (await ev()).eligible === e2.eligible - 2)
    await prisma.originalPostApprovalQueue.update({ where: { id: lg.id }, data: { editedTitle: '검토 뒤 새 제목' } })
    check('🔴 🔴 **noEdit 검토 뒤 수정본 생김 → 즉시 표본 제외**', (await ev()).eligible === e2.eligible - 3)
  }

  console.log('\nB-4. 🔴 결정 전 그림자 5건 — 한 번의 배치로 결정 + 결함 기록')
  {
    const shadows = []
    for (let k = 0; k < 5; k += 1) shadows.push(await restored({ undecided: true }))
    const base0 = (await ev()).eligible
    const bundle = bundleOf(shadows, 'shadow')
    const r = await recordHumanBatch(prisma, {
      actor: FOUNDER, now: NOW, bundle,
      entries: [
        { queueId: shadows[0]!.id, decision: 'ready', hardDefect: 'no' },
        { queueId: shadows[1]!.id, decision: 'ready', hardDefect: 'no' },
        { queueId: shadows[2]!.id, decision: 'reject', declineReason: 'TOPIC_UNFIT', hardDefect: 'no' },
        { queueId: shadows[3]!.id, hardDefect: 'no' },
        { queueId: shadows[4]!.id, decision: 'edit', hardDefect: 'no' },
      ],
    })
    const rows = await Promise.all(shadows.map((x) => snap(x.id)))
    check('🔴 🔴 **ready 2 · reject 1 → 결정 저장과 사람 기록이 한 트랜잭션**',
      r[0]?.result === 'decidedAndRecorded' && r[1]?.result === 'decidedAndRecorded' && r[2]?.result === 'decidedAndRecorded'
      && rows[0]!.decidedBy === HUMAN_DECIDER && rows[0]!.status === 'APPROVED'
      && rows[2]!.status === 'DECLINED' && rows[2]!.declineReason === 'TOPIC_UNFIT', JSON.stringify(r))
    check('🔴 🔴 **결정 없는 그림자 → 기록 0 · 결정 0 (표본 아님)**',
      r[3]?.result === 'reject' && rows[3]!.decidedBy === 'machine:auto-draft-v5' && readEvidenceReviews(rows[3]!.editDiff).length === 0)
    check('🔴 🔴 **edit 결정은 이 경계에서 받지 않는다 (게이트가 로컬 artifact 를 요구) → write 0**',
      r[4]?.result === 'reject' && rows[4]!.decidedBy === 'machine:auto-draft-v5' && readEvidenceReviews(rows[4]!.editDiff).length === 0)
    check('🔴 🔴 **결정이 실제 저장된 3건만 표본 (+3)**', (await ev()).eligible === base0 + 3)
    const bad = await restored({ undecided: true })
    const badR = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bundleOf([bad], 'bad'), entries: [{ queueId: bad.id, decision: 'reject', hardDefect: 'no' }] })
    check('🔴 폐기 사유 없는 reject → 결정·기록 모두 0', badR[0]?.result === 'reject' && (await snap(bad.id)).decidedBy === 'machine:auto-draft-v5')
  }

  console.log('\nB-5. 🔴 🔴 빈 판정 건너뜀 · 재검토 append-only · 사용자별 최신 판정 (마스터 반례 8)')
  {
    const hdOf = async (id: string) => { const r = await snap(id); const v = humanSampleOf(r); return v.counted ? v.hardDefect : `excluded:${v.why}` }
    // ① blank 제출 → 기록 0
    const x = await restored()
    const bx = bundleOf([x], 'b5-x')
    const r1 = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bx, entries: [{ queueId: x.id }, ] })
    check('🔴 🔴 **① blank 제출 → 기록 0 · write 0**', r1[0]?.result === 'skip' && readEvidenceReviews((await snap(x.id)).editDiff).length === 0)
    const blankShadow = await restored({ undecided: true })
    const r1b = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bundleOf([blankShadow], 'b5-bs'), entries: [{ queueId: blankShadow.id, decision: 'ready' }] })
    check('🔴 blank 인 그림자는 결정도 하지 않는다 (결정·기록 0)', r1b[0]?.result === 'skip' && (await snap(blankShadow.id)).decidedBy === 'machine:auto-draft-v5')
    // ② blank 후 no → 표본 no
    const r2 = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 1000), bundle: bx, entries: [{ queueId: x.id, hardDefect: 'no' }] })
    check('🔴 🔴 **② blank 후 no → 표본 no**', r2[0]?.result === 'recorded' && await hdOf(x.id) === 'no')
    // ③ no 검토 후 본문 변경 → 기존 표본 제외
    await prisma.originalPostApprovalQueue.update({ where: { id: x.id }, data: { status: 'EDITED', editedBody: `${x.body} 고친 문안` } })
    check('🔴 🔴 **③ no 검토 후 본문 변경 → 표본 제외 (bindingBroken)**', await hdOf(x.id) === 'excluded:bindingBroken')
    // ④ 같은 사용자가 바뀐 본문을 재검토 → 새 표본 복구 · 옛 기록 보존
    const r4 = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 2000), bundle: bx, entries: [{ queueId: x.id, hardDefect: 'no' }] })
    const hist = readEvidenceReviews((await snap(x.id)).editDiff).filter((r) => r.reviewerUserId === founderUser)
    const v4 = humanSampleOf(await snap(x.id))
    check('🔴 🔴 **④ 바뀐 본문을 같은 사용자가 재검토 → 새 표본(edited · no) 복구 · 옛 기록 보존**',
      r4[0]?.result === 'recorded' && v4.counted && v4.outcome === 'edited' && v4.hardDefect === 'no' && hist.length === 2, JSON.stringify(r4))
    // ⑤ 같은 binding 동일 재제출 → unchanged
    const r5 = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 3000), bundle: bx, entries: [{ queueId: x.id, hardDefect: 'no' }] })
    check('🔴 🔴 **⑤ 같은 binding 동일 재제출 → unchanged · 기록 수 그대로**',
      r5[0]?.result === 'unchanged' && readEvidenceReviews((await snap(x.id)).editDiff).filter((r) => r.reviewerUserId === founderUser).length === 2)
    // ⑥ 동시 재검토 → 유효 최신 기록 1개
    const y = await restored()
    const by = bundleOf([y], 'b5-y')
    const [c1, c2] = await Promise.all([
      recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 4000), bundle: by, entries: [{ queueId: y.id, hardDefect: 'no' }] }),
      recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 4000), bundle: by, entries: [{ queueId: y.id, hardDefect: 'no' }] }),
    ])
    const ys = readEvidenceReviews((await snap(y.id)).editDiff).filter((r) => r.reviewerUserId === founderUser)
    check('🔴 🔴 **⑥ 동시 재검토 → 기록 1개 · 둘 다 예외 없이 끝난다(값으로)**',
      ys.length === 1 && [c1[0]?.result, c2[0]?.result].filter((k) => k === 'recorded').length === 1, `${c1[0]?.result}/${c2[0]?.result} · ${ys.length}`)
    // ⑦ A unmeasured + B no → no  (A 의 unmeasured 는 앞판 경로가 남긴 기록 — DB 에 그대로 둔다)
    const z = await restored()
    const zr = await snap(z.id)
    await prisma.originalPostApprovalQueue.update({
      where: { id: z.id },
      data: { editDiff: { evidenceReviews: [{
        contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:operator', reviewerUserId: founderUser, ...bindingOf(zr),
        hardDefect: 'unmeasured', reasons: [], bundleDigest: digestOf('old'), reviewedAt: NOW.toISOString(),
      }] } as never },
    })
    check('선행 — A 의 unmeasured 기록만 있으면 unmeasured', await hdOf(z.id) === 'unmeasured')
    await recordHumanBatch(prisma, { actor: OP_B, now: new Date(NOW.getTime() + 5000), bundle: bundleOf([z], 'b5-z'), entries: [{ queueId: z.id, hardDefect: 'no' }] })
    check('🔴 🔴 **⑦ A unmeasured + B no → no**', await hdOf(z.id) === 'no')
    // ⑧ A no + B yes → yes
    const w = await restored({ published: true })
    const bw = bundleOf([w], 'b5-w')
    await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 6000), bundle: bw, entries: [{ queueId: w.id, hardDefect: 'no' }] })
    await recordHumanBatch(prisma, { actor: OP_B, now: new Date(NOW.getTime() + 7000), bundle: bw, entries: [{ queueId: w.id, hardDefect: 'yes', reasons: ['생활사 모순'] }] })
    check('🔴 🔴 **⑧ A no + B yes → yes**', await hdOf(w.id) === 'yes')
    check('🔴 사람 경로는 unmeasured 를 명시해도 받지 않는다',
      (await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bw, entries: [{ queueId: w.id, hardDefect: 'unmeasured' }] }))[0]?.result === 'reject')
    check('🔴 🔴 **기록의 사람 식별은 세션 User.id — 두 관리자 모두 human:operator**',
      readEvidenceReviews((await snap(w.id)).editDiff).every((r) => r.reviewer === 'human:operator')
      && new Set(readEvidenceReviews((await snap(w.id)).editDiff).map((r) => r.reviewerUserId)).size === 2)
  }

  console.log('\nB-6. 🔴 🔴 중대 결함이 있는데 발행 가능한 상태가 남지 않는다 (마스터 P0)')
  {
    const hd = async (id: string) => { const v = humanSampleOf(await snap(id)); return v.counted ? `${v.outcome}/${v.hardDefect}` : `excluded:${v.why}` }
    const one = async (x: { id: string; title: string; body: string }, entry: Record<string, unknown>, tag: string) =>
      (await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bundleOf([x], tag), entries: [{ queueId: x.id, ...entry }] }))[0]
    // ── 결정 전 그림자 ──
    const s1 = await restored({ undecided: true })
    const r1 = await one(s1, { decision: 'ready', hardDefect: 'yes', reasons: ['생활사 모순'] }, 'b6-s1')
    const q1 = await snap(s1.id)
    check('🔴 🔴 **그림자 ready + yes → 전체 거절 · write 0**',
      r1?.result === 'reject' && q1.decidedBy === 'machine:auto-draft-v5' && q1.status === 'APPROVED' && readEvidenceReviews(q1.editDiff).length === 0, JSON.stringify(r1))
    const s2 = await restored({ undecided: true })
    const r2 = await one(s2, { decision: 'reject', declineReason: 'TOPIC_UNFIT', hardDefect: 'yes', reasons: ['생활사 모순'] }, 'b6-s2')
    check('🔴 🔴 **그림자 reject + yes + 사유 → DECLINED · 표본 declined/yes**',
      r2?.result === 'decidedAndRecorded' && (await snap(s2.id)).status === 'DECLINED' && await hd(s2.id) === 'declined/yes', JSON.stringify(r2))
    // ── 이미 결정된 미발행 승인 행 ──
    const ap = await restored()
    const before = await snap(ap.id)
    const stock0 = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
    check('선행 — 승인 미발행 행은 발행 대상이다', stock0.targets.some((t) => t.id === ap.id))
    const noW = await one(ap, { hardDefect: 'yes', reasons: ['단정'] }, 'b6-ap')
    check('🔴 🔴 **승인 행 yes 인데 철회 선택 없음 → 기록·상태 변경 0**',
      noW?.result === 'reject' && (await snap(ap.id)).status === 'APPROVED' && readEvidenceReviews((await snap(ap.id)).editDiff).length === 0
      && (await snap(ap.id)).updatedAt.getTime() === before.updatedAt.getTime(), JSON.stringify(noW))
    const noReason = await one(ap, { hardDefect: 'yes', reasons: ['단정'], withdraw: true }, 'b6-ap')
    check('🔴 🔴 **철회는 골랐지만 사유 없음 → 철회·기록 0 (기본 사유 없음)**',
      noReason?.result === 'reject' && (await snap(ap.id)).status === 'APPROVED' && readEvidenceReviews((await snap(ap.id)).editDiff).length === 0)
    const w1 = await one(ap, { hardDefect: 'yes', reasons: ['단정'], withdraw: true, declineReason: 'GATE_MISS_AI_TONE' }, 'b6-ap')
    const after = await snap(ap.id)
    const wd = (after.editDiff as Record<string, unknown>).withdrawal as Record<string, unknown> | undefined
    check('🔴 🔴 **APPROVED 미발행 + yes + 철회 → DECLINED · 표본 declined/yes**',
      w1?.result === 'withdrawnAndRecorded' && after.status === 'DECLINED' && after.declineReason === 'GATE_MISS_AI_TONE' && await hd(ap.id) === 'declined/yes', JSON.stringify(w1))
    check('🔴 🔴 **철회는 원래 승인 도장을 덮지 않는다 — decidedBy·decidedAt 그대로 · 철회 기록은 따로**',
      after.decidedBy === before.decidedBy && after.decidedAt?.getTime() === before.decidedAt?.getTime()
      && wd?.prevStatus === 'APPROVED' && wd.withdrawnByUserId === founderUser && wd.reasonCode === 'GATE_MISS_AI_TONE')
    const stock1 = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
    const pub1 = await publishOriginalPostTx(prisma, { queueId: ap.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: {} })
    check('🔴 🔴 **철회된 행 — selector 대상 0 · 발행 트랜잭션 0**',
      !stock1.targets.some((t) => t.id === ap.id) && pub1.kind === 'blocked' && (await snap(ap.id)).createdPostId === null, JSON.stringify(pub1))
    const ed = await restored({ edited: true })
    const w2 = await one(ed, { hardDefect: 'yes', reasons: ['단정'], withdraw: true, declineReason: 'TITLE_WEAK' }, 'b6-ed')
    check('🔴 🔴 **EDITED 미발행 + yes + 철회 → DECLINED**', w2?.result === 'withdrawnAndRecorded' && (await snap(ed.id)).status === 'DECLINED', JSON.stringify(w2))
    const okNo = await restored()
    check('🔴 승인 미발행 + no → 기록 · 상태 그대로', (await one(okNo, { hardDefect: 'no' }, 'b6-no'))?.result === 'recorded' && (await snap(okNo.id)).status === 'APPROVED')
    check('🔴 결함 없음(no)에 철회를 붙이면 거절', (await one(await restored(), { hardDefect: 'no', withdraw: true, declineReason: 'TOPIC_UNFIT' }, 'b6-nw'))?.result === 'reject')
    // ── 발행된 행 · 폐기된 행 ──
    const pb = await restored({ published: true })
    const rp = await one(pb, { hardDefect: 'yes', reasons: ['사후 발견'] }, 'b6-pb')
    check('🔴 🔴 **PUBLISHED + yes → 사후 기록만 · 상태 그대로**',
      rp?.result === 'recorded' && (await snap(pb.id)).status === 'PUBLISHED' && await hd(pb.id) === 'noEdit/yes', JSON.stringify(rp))
    check('🔴 발행된 행은 철회 불가', (await one(pb, { hardDefect: 'yes', reasons: ['사후 발견 2'], withdraw: true, declineReason: 'TOPIC_UNFIT' }, 'b6-pb'))?.result === 'reject')
    const dc = await restored({ declined: true })
    check('🔴 DECLINED + yes → 기록', (await one(dc, { hardDefect: 'yes', reasons: ['원래 문제'] }, 'b6-dc'))?.result === 'recorded' && await hd(dc.id) === 'declined/yes')
    // ── 발행 · 철회 순서 — 먼저 성공한 쪽만 남는다 ──
    const alone = await restored()
    const pa = await publishOriginalPostTx(prisma, { queueId: alone.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: {} })
    check('선행 — 이 행은 단독이면 실제로 발행된다 (경쟁 검사가 공허하지 않다)', pa.kind === 'published', JSON.stringify(pa))
    const late = await one(alone, { hardDefect: 'yes', reasons: ['발행 뒤 철회 시도'], withdraw: true, declineReason: 'TOPIC_UNFIT' }, 'b6-late')
    check('🔴 🔴 **발행 → 철회 순서 — 철회 거절 · 기록 0 · PUBLISHED 그대로**',
      late?.result === 'reject' && (await snap(alone.id)).status === 'PUBLISHED' && readEvidenceReviews((await snap(alone.id)).editDiff).length === 0)
    // ── 동시 발행 · 철회 경쟁 — 둘 중 하나만 ──
    let publishWins = 0
    let withdrawWins = 0
    for (let k = 0; k < 4; k += 1) {
      const race = await restored()
      const [p, w] = await Promise.all([
        publishOriginalPostTx(prisma, { queueId: race.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: {} }),
        one(race, { hardDefect: 'yes', reasons: ['경쟁'], withdraw: true, declineReason: 'TOPIC_UNFIT' }, `b6-race-${k}`),
      ])
      const q = await snap(race.id)
      const both = p.kind === 'published' && w?.result === 'withdrawnAndRecorded'
      const neither = p.kind !== 'published' && w?.result !== 'withdrawnAndRecorded'
      if (p.kind === 'published') publishWins += 1
      if (w?.result === 'withdrawnAndRecorded') withdrawWins += 1
      check(`🔴 🔴 **동시 발행/철회 경쟁 #${k + 1} — 둘 중 하나만 성공 · 최종 상태가 그 쪽과 같다**`,
        !both && !neither && (p.kind === 'published' ? q.status === 'PUBLISHED' && readEvidenceReviews(q.editDiff).length === 0 : q.status === 'DECLINED' && q.createdPostId === null),
        `${p.kind}/${w?.result} → ${q.status}`)
    }
    console.log(`     (경쟁 결과 — 발행 ${publishWins} · 철회 ${withdrawWins})`)
    // ── D. 최신의 정본은 append 순서 ──
    const od = await restored({ published: true })
    const odr = await snap(od.id)
    const mk = (hdv: 'yes' | 'no', at: string, reasons: string[]) => ({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:operator', reviewerUserId: founderUser, ...bindingOf(odr),
      hardDefect: hdv, reasons, bundleDigest: digestOf('order'), reviewedAt: at,
    })
    await prisma.originalPostApprovalQueue.update({ where: { id: od.id }, data: { editDiff: { evidenceReviews: [
      mk('no', '2026-09-26T05:00:00Z', []), mk('yes', '2026-09-26T01:00:00Z', ['나중에 붙었지만 시각은 과거']),
    ] } as never } })
    check('🔴 🔴 **D. 나중에 붙은 기록의 시각이 더 과거여도 그 기록이 최신 (yes)**', await hd(od.id) === 'noEdit/yes')
  }

  console.log('\nB-7. 🔴 🔴 반복 클릭 · 같은 요청 재제출 · 이미 결정된 행 · 지금 상태 (2026-09-27 운영 P0)')
  {
    const mineOf = async (id: string, uid = founderUser) => readEvidenceReviews((await snap(id)).editDiff).filter((r) => r.reviewerUserId === uid)
    // ① 결정 전 그림자 — ready + no, 같은 요청 두 번
    const s1 = await restored({ undecided: true })
    const b1 = bundleOf([s1], 'b7-s1')
    const e1 = [{ queueId: s1.id, decision: 'ready', hardDefect: 'no' }]
    const first = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b1, entries: e1 })
    const u1 = (await snap(s1.id)).updatedAt.getTime()
    const second = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 1000), bundle: b1, entries: e1 })
    check('🔴 🔴 **① 같은 사람 · 같은 묶음 · 같은 결정 재제출 → unchanged(성공 동급) · 기록 1 · 행 write 0**',
      first[0]?.result === 'decidedAndRecorded' && second[0]?.result === 'unchanged'
      && (await mineOf(s1.id)).length === 1 && (await snap(s1.id)).updatedAt.getTime() === u1, `${first[0]?.result}/${second[0]?.result}`)

    // ② 운영 uili19gp 모양 — 폐기(OTHER) + 결함 yes 로 결정된 행
    const s2 = await restored({ undecided: true })
    const b2 = bundleOf([s2], 'b7-s2')
    const e2 = { queueId: s2.id, decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: ['생활사 모순'] }
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b2, entries: [e2] })
    const d0 = await snap(s2.id)
    const again = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 1000), bundle: b2, entries: [e2] })
    check('🔴 🔴 **② 폐기된 행 같은 요청 재제출 → unchanged · 재폐기 0 · 기록 1**',
      again[0]?.result === 'unchanged' && (await mineOf(s2.id)).length === 1 && (await snap(s2.id)).updatedAt.getTime() === d0.updatedAt.getTime())
    const other = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b2, entries: [{ ...e2, declineReason: 'TOPIC_UNFIT' }] })
    check('🔴 🔴 **② 다른 사유로 다시 폐기 → 거절 · 사유 OTHER 그대로 · 기록 1**',
      other[0]?.result === 'reject' && (await snap(s2.id)).declineReason === 'OTHER' && (await mineOf(s2.id)).length === 1, JSON.stringify(other))
    const b2x = bundleOf([s2], 'b7-s2-new-bundle')
    const otherBundle = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b2x, entries: [e2] })
    check('🔴 🔴 **② 다른 묶음으로 같은 결정 → 거절(결정은 한 번뿐) · 기록 1**',
      otherBundle[0]?.result === 'reject' && (await mineOf(s2.id)).length === 1, JSON.stringify(otherBundle))
    const byB = await recordHumanBatch(prisma, { actor: OP_B, now: NOW, bundle: b2, entries: [e2] })
    check('🔴 🔴 **② 다른 관리자가 같은 결정을 보냄 → 거절 · 재폐기 0 · B 기록 0**',
      byB[0]?.result === 'reject' && (await mineOf(s2.id, OP_B.userId)).length === 0 && (await snap(s2.id)).updatedAt.getTime() === d0.updatedAt.getTime())

    // ③ 더블 클릭 — 같은 요청 둘이 동시에
    const s3 = await restored({ undecided: true })
    const b3 = bundleOf([s3], 'b7-s3')
    const e3 = [{ queueId: s3.id, decision: 'ready', hardDefect: 'no' }]
    const [c1, c2] = await Promise.all([
      recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b3, entries: e3 }),
      recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: b3, entries: e3 }),
    ])
    const pair = [c1[0]?.result, c2[0]?.result].sort().join('/')
    check('🔴 🔴 **③ 동시 두 요청 → 기록 1 · 결과 decidedAndRecorded + unchanged (거절 0)**',
      (await mineOf(s3.id)).length === 1 && pair === 'decidedAndRecorded/unchanged', pair)

    // ④ 철회 재제출 — 미발행 승인 + yes + 철회
    const ap = await restored()
    const bap = bundleOf([ap], 'b7-ap')
    const eap = [{ queueId: ap.id, hardDefect: 'yes', reasons: ['단정'], withdraw: true, declineReason: 'TOPIC_UNFIT' }]
    const w1 = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bap, entries: eap })
    const w2 = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bap, entries: eap })
    check('🔴 🔴 **④ 철회 같은 요청 재제출 → unchanged · 기록 1 · DECLINED 그대로**',
      w1[0]?.result === 'withdrawnAndRecorded' && w2[0]?.result === 'unchanged' && (await mineOf(ap.id)).length === 1
      && (await snap(ap.id)).status === 'DECLINED', `${w1[0]?.result}/${w2[0]?.result}`)

    // ⑤ 부분 성공 — 하나는 정상, 하나는 묶음 이후 초안이 바뀜
    const g = await restored({ undecided: true })
    const st = await restored({ undecided: true })
    const bp = bundleOf([g, st], 'b7-partial')
    await prisma.originalPostApprovalQueue.update({ where: { id: st.id }, data: { draftBody: `${st.body} (묶음 뒤 수정)` } })
    const stBefore = await snap(st.id)
    const pr = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bp, entries: [
      { queueId: g.id, decision: 'ready', hardDefect: 'no' }, { queueId: st.id, decision: 'ready', hardDefect: 'no' },
    ] })
    const stAfter = await snap(st.id)
    check('🔴 🔴 **⑤ 부분 성공 — 정상 행만 결정·기록 · stale 행은 거절(사유 그대로) · write 0**',
      pr[0]?.result === 'decidedAndRecorded' && pr[1]?.result === 'reject' && pr[1]?.why.includes('초안이 바뀌었다')
      && stAfter.decidedBy === 'machine:auto-draft-v5' && stAfter.updatedAt.getTime() === stBefore.updatedAt.getTime()
      && readEvidenceReviews(stAfter.editDiff).length === 0, JSON.stringify(pr))

    // ⑥ 지금 상태 — 화면이 믿는 값 · 읽기만
    const fresh = await restored({ undecided: true })
    const dec = await restored()
    const items = [...bundleOf([s2, g, st, fresh, dec], 'b7-state').items, { queueId: 'no-such-row', draftTitleDigest: 'x', draftBodyDigest: 'y' }]
    const beforeRows = await prisma.originalPostApprovalQueue.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
    const mine = await readHumanRowStates(prisma, { userId: founderUser, items })
    const theirs = await readHumanRowStates(prisma, { userId: OP_B.userId, items })
    const afterRows = await prisma.originalPostApprovalQueue.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
    const ph = (xs: typeof mine) => xs.map((x) => x.phase).join(',')
    check('🔴 🔴 **⑥ 지금 상태 — 내가 결정한 행 recorded · stale · 결정 전 · 결정됨 · 없음**',
      ph(mine) === 'recorded,recorded,stale,undecided,decided,missing', ph(mine))
    check('🔴 🔴 **⑥ 같은 행이 다른 관리자에게는 decided — 결정 칸 없음 · 결함 기록만**',
      ph(theirs) === 'decided,decided,stale,undecided,decided,missing', ph(theirs))
    const u = mine[0]!
    check('🔴 🔴 **⑥ uili19gp 모양 — DECLINED · OTHER · 내 기록 yes 가 보인다**',
      u.status === 'DECLINED' && u.declineReason === 'OTHER' && u.outcome === 'declined' && u.mine?.hardDefect === 'yes' && u.mine.bundleDigest === b2.digest, JSON.stringify(u))
    check('🔴 🔴 **⑥ 상태 읽기는 write 0**',
      beforeRows.length === afterRows.length && beforeRows.every((r, k) => afterRows[k]!.id === r.id && afterRows[k]!.updatedAt.getTime() === r.updatedAt.getTime()))
  }

  console.log('\nB-8. 🔴 🔴 같은 사람의 재검토 — 판정 변경은 append-only · no→yes 는 철회 동반 (2026-09-27 P0 정정)')
  {
    const mineOf = async (id: string) => readEvidenceReviews((await snap(id)).editDiff).filter((r) => r.reviewerUserId === founderUser)
    const hd = async (id: string) => { const v = humanSampleOf(await snap(id)); return v.counted ? `${v.outcome}/${v.hardDefect}` : `excluded:${v.why}` }
    const phaseOf = async (x: { id: string; title: string; body: string }, tag: string) =>
      (await readHumanRowStates(prisma, { userId: founderUser, items: bundleOf([x], tag).items }))[0]!
    // ① 미발행 승인 — 처음 no 로 잘못 기록
    const ap = await restored()
    const bap = bundleOf([ap], 'b8-ap')
    const one = async (entry: Record<string, unknown>, at: number) =>
      (await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + at), bundle: bap, entries: [{ queueId: ap.id, ...entry }] }))[0]
    check('선행 — 처음 no 기록', (await one({ hardDefect: 'no' }, 0))?.result === 'recorded' && (await phaseOf(ap, 'b8-ap')).phase === 'recorded')
    const before = await snap(ap.id)
    const noW = await one({ hardDefect: 'yes', reasons: ['생활사 모순'] }, 1000)
    check('🔴 🔴 **no → yes · 철회 없음 → 거절 · 상태·기록 write 0**',
      noW?.result === 'reject' && (await mineOf(ap.id)).length === 1 && (await snap(ap.id)).updatedAt.getTime() === before.updatedAt.getTime())
    const noReason = await one({ hardDefect: 'yes', reasons: ['생활사 모순'], withdraw: true }, 1500)
    check('🔴 🔴 **no → yes · 철회했지만 사유 없음 → 거절 · write 0**', noReason?.result === 'reject' && (await mineOf(ap.id)).length === 1 && (await snap(ap.id)).status === 'APPROVED')
    const noWhy = await one({ hardDefect: 'yes', withdraw: true, declineReason: 'TOPIC_UNFIT' }, 1700)
    check('🔴 🔴 **no → yes · 근거 없음 → 거절 · write 0**', noWhy?.result === 'reject' && (await mineOf(ap.id)).length === 1 && (await snap(ap.id)).status === 'APPROVED')
    const w = await one({ hardDefect: 'yes', reasons: ['생활사 모순'], withdraw: true, declineReason: 'TOPIC_UNFIT' }, 2000)
    const hist = await mineOf(ap.id)
    const stock = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
    const pub = await publishOriginalPostTx(prisma, { queueId: ap.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: {} })
    check('🔴 🔴 **같은 사람 no → yes + 철회 → +1 기록 · 옛 no 보존 · 최신 yes · DECLINED**',
      w?.result === 'withdrawnAndRecorded' && hist.length === 2 && hist[0]?.hardDefect === 'no' && hist[1]?.hardDefect === 'yes'
      && (await snap(ap.id)).status === 'DECLINED' && await hd(ap.id) === 'declined/yes', `${w?.result} · ${hist.map((r) => r.hardDefect).join(',')}`)
    check('🔴 🔴 **철회 뒤 selector 대상 0 · 발행 트랜잭션 0**', !stock.targets.some((t) => t.id === ap.id) && pub.kind === 'blocked' && (await snap(ap.id)).createdPostId === null, JSON.stringify(pub))
    const st1 = await phaseOf(ap, 'b8-ap')
    check('🔴 🔴 **재검토 뒤 지금 상태 — 다시 recorded · 최신 판정 yes**', st1.phase === 'recorded' && st1.mine?.hardDefect === 'yes' && st1.status === 'DECLINED')
    const same = await one({ hardDefect: 'yes', reasons: ['생활사 모순'], withdraw: true, declineReason: 'TOPIC_UNFIT' }, 3000)
    check('🔴 🔴 **같은 판정 재제출 → unchanged · +0**', same?.result === 'unchanged' && (await mineOf(ap.id)).length === 2)
    // ② 이미 폐기된 행 — yes → no 재검토 (폐기는 다시 하지 않는다)
    const dSnap = await snap(ap.id)
    const back = await one({ hardDefect: 'no' }, 4000)
    const hist2 = await mineOf(ap.id)
    const dAfter = await snap(ap.id)
    check('🔴 🔴 **같은 사람 yes → no (폐기된 행) → +1 · 옛 기록 보존 · 최신 no · 상태·사유 그대로**',
      back?.result === 'recorded' && hist2.length === 3 && hist2.map((r) => r.hardDefect).join(',') === 'no,yes,no'
      && dAfter.status === 'DECLINED' && dAfter.declineReason === dSnap.declineReason && await hd(ap.id) === 'declined/no', `${back?.result} · ${hist2.map((r) => r.hardDefect).join(',')}`)
    check('🔴 폐기된 행에 철회를 다시 붙이면 거절 · 기록 +0',
      (await one({ hardDefect: 'yes', reasons: ['x'], withdraw: true, declineReason: 'OTHER' }, 5000))?.result === 'reject' && (await mineOf(ap.id)).length === 3)
    // ③ 발행된 행 — 사후 재판정만
    const pb = await restored({ published: true })
    const bpb = bundleOf([pb], 'b8-pb')
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bpb, entries: [{ queueId: pb.id, hardDefect: 'no' }] })
    const r3 = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 1000), bundle: bpb, entries: [{ queueId: pb.id, hardDefect: 'yes', reasons: ['사후 발견'] }] })
    check('🔴 🔴 **발행된 행 no → yes → 사후 기록 +1 · PUBLISHED 그대로**',
      r3[0]?.result === 'recorded' && (await mineOf(pb.id)).length === 2 && (await snap(pb.id)).status === 'PUBLISHED' && await hd(pb.id) === 'noEdit/yes')
    // ④ 철회가 실패하면 결함 기록도 0 — 재검토 직전에 발행이 끼어든다
    const race = await restored()
    const brace = bundleOf([race], 'b8-race')
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: brace, entries: [{ queueId: race.id, hardDefect: 'no' }] })
    const pr = await publishOriginalPostTx(prisma, { queueId: race.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: {} })
    const late = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(NOW.getTime() + 1000), bundle: brace, entries: [{ queueId: race.id, hardDefect: 'yes', reasons: ['늦은 발견'], withdraw: true, declineReason: 'TOPIC_UNFIT' }] })
    check('🔴 🔴 **no 뒤 발행 → no → yes 철회 시도 → 철회 실패 · 결함 기록 +0 · PUBLISHED 그대로**',
      pr.kind === 'published' && late[0]?.result === 'reject' && (await mineOf(race.id)).length === 1 && (await snap(race.id)).status === 'PUBLISHED', JSON.stringify(late))
  }

  console.log('\nC. 🔴 게이트 — 29 닫힘 · 30·90%·0 열림 · 기준 불변')
  {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OriginalPostApprovalQueue","MicroSeedRawContent" CASCADE')
    artifacts.clear(); candidates.clear()
    const rows: { id: string; title: string; body: string }[] = []
    // 🔴 열림 판정은 지금 품질 계약 cohort 다 — 적재 때 저장된 모양 그대로 만든다(복원 경로가 아니다)
    for (let k = 0; k < 30; k += 1) rows.push(await seed({ edited: k >= 27, current: true }))
    const bundle = bundleOf(rows, 'gate')
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle, entries: rows.slice(0, 29).map((x) => ({ queueId: x.id, hardDefect: 'no' })) })
    const g29 = await evidenceFromDb(prisma)
    check('🔴 🔴 **사람 표본 29건 → 닫힘**', g29.eligible === 29 && !g29.meetsContract, JSON.stringify(g29.reasons))
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle, entries: [{ queueId: rows[29]!.id, hardDefect: 'no' }] })
    const g30 = await evidenceFromDb(prisma)
    check('🔴 🔴 **30건 · 무수정 27(90%) · 결함 0 → 열림**', g30.eligible === 30 && g30.noEdit === 27 && g30.hardDefects === 0 && g30.meetsContract, JSON.stringify(g30))
    const um = await seed({ current: true })
    const skip = await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bundleOf([um], 'um'), entries: [{ queueId: um.id }] })
    const g31 = await evidenceFromDb(prisma)
    check('🔴 🔴 **빈 판정은 건너뜀 — 기록 0 · 표본도 게이트도 그대로(30 · 열림)**',
      skip[0]?.result === 'skip' && readEvidenceReviews((await snap(um.id)).editDiff).length === 0 && g31.eligible === 30 && g31.meetsContract)
    check('🔴 🔴 **기준은 30 · 90% · 0 그대로**', CONTRACT.reviewSampleMin === 30 && CONTRACT.noEditAccuracyMin === 0.9 && CONTRACT.hardDefectMax === 0)
  }

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE',
  )
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()
