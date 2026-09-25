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
  digestOf, bindingOf, EVIDENCE_REVIEW_CONTRACT, readEvidenceReviews, type ArtifactDoc, type CandidateDoc,
} from '../src/lib/auto-ready-evidence'
import {
  planSemanticRestore, applySemanticRestore, planNonHumanImport, applyReviewImport, recordHumanBatch, SEMANTIC_RESTORE_KEY,
  type HumanActor, type ReviewFile,
} from '../src/lib/auto-ready-evidence-store'
import { HUMAN_DECIDER, CONTRACT } from '../src/lib/auto-ready-v2'
import { evidenceFromDb } from '../src/lib/auto-ready-repo'
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
    edited?: boolean; body?: string; declined?: boolean; undecided?: boolean; matchedPersonaId?: string
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
        } as never,
        editDiff: o.edited === true ? { bodyChanged: true, titleChanged: false } as never : undefined,
        // 🔴 결정 전 그림자는 기계 표식 · 미배정이다(운영의 HUMAN_REVIEW_REQUIRED 행과 같은 모양)
        decidedBy: o.undecided === true ? 'machine:auto-draft-v5' : HUMAN_DECIDER, dedupKey: `ev-${seq}`,
        ...(o.undecided === true ? {} : { matchedPersonaId: o.matchedPersonaId ?? persona.id, matchedAt: NOW }),
      },
      select: { id: true },
    })
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
  const FOUNDER: HumanActor = { userId: founderUser, reviewer: 'human:founder' }
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
  const ev = () => evidenceFromDb(prisma)

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
    const a = await restored()
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
    const rec0 = readEvidenceReviews((await snap(a.id)).editDiff).find((x) => x.reviewer === 'human:founder')
    check('🔴 🔴 **서버가 검토자·시각을 정한다 — 요청의 reviewer·reviewedAt 은 무시**',
      r[0]?.result === 'recorded' && rec0?.reviewerUserId === founderUser && rec0.reviewedAt === later.toISOString(), JSON.stringify(r))
    check('🔴 🔴 **인증된 사람 기록 → 사람 표본 1**', (await ev()).eligible === 1)
    const again = await recordHumanBatch(prisma, { actor: FOUNDER, now: new Date(later.getTime() + 1000), bundle, entries: [{ queueId: a.id, hardDefect: 'no' }] })
    check('🔴 같은 사람·같은 결속 재실행 → unchanged · write 0', again[0]?.result === 'unchanged')
    const conflict = await recordHumanBatch(prisma, { actor: FOUNDER, now: later, bundle, entries: [{ queueId: a.id, hardDefect: 'yes', reasons: ['모순'] }] })
    check('🔴 같은 사람의 다른 판정 → 덮지 않고 거절', conflict[0]?.result === 'reject')
    const noDecisionChange = await recordHumanBatch(prisma, { actor: FOUNDER, now: later, bundle, entries: [{ queueId: a.id, decision: 'reject', declineReason: 'TOPIC_UNFIT' }] })
    check('🔴 이미 결정된 행의 결정은 바꾸지 않는다', noDecisionChange[0]?.result === 'reject' && (await snap(a.id)).status === 'APPROVED')
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
    const outs = await Promise.all([ne, ed, dc, lg].map(async (x) => readEvidenceReviews((await snap(x.id)).editDiff).find((y) => y.reviewer === 'human:founder')?.outcome))
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

  console.log('\nC. 🔴 게이트 — 29 닫힘 · 30·90%·0 열림 · 기준 불변')
  {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OriginalPostApprovalQueue","MicroSeedRawContent" CASCADE')
    artifacts.clear(); candidates.clear()
    const rows: { id: string; title: string; body: string }[] = []
    for (let k = 0; k < 30; k += 1) rows.push(await restored({ edited: k >= 27 }))
    const bundle = bundleOf(rows, 'gate')
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle, entries: rows.slice(0, 29).map((x) => ({ queueId: x.id, hardDefect: 'no' })) })
    const g29 = await ev()
    check('🔴 🔴 **사람 표본 29건 → 닫힘**', g29.eligible === 29 && !g29.meetsContract, JSON.stringify(g29.reasons))
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle, entries: [{ queueId: rows[29]!.id, hardDefect: 'no' }] })
    const g30 = await ev()
    check('🔴 🔴 **30건 · 무수정 27(90%) · 결함 0 → 열림**', g30.eligible === 30 && g30.noEdit === 27 && g30.hardDefects === 0 && g30.meetsContract, JSON.stringify(g30))
    const um = await restored()
    await recordHumanBatch(prisma, { actor: FOUNDER, now: NOW, bundle: bundleOf([um], 'um'), entries: [{ queueId: um.id }] })
    const g31 = await ev()
    check('🔴 🔴 **hardDefect 비움 → unmeasured 기록 → 게이트 닫힘**', g31.eligible === 31 && g31.hardDefects === null && !g31.meetsContract)
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
