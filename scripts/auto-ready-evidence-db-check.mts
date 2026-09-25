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
  digestOf, EVIDENCE_REVIEW_CONTRACT, readEvidenceReviews, type ArtifactDoc, type CandidateDoc,
} from '../src/lib/auto-ready-evidence'
import {
  planSemanticRestore, applySemanticRestore, planReviewImport, applyReviewImport, SEMANTIC_RESTORE_KEY,
  type BundleItem, type ReviewFile,
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
    edited?: boolean; body?: string
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
        sourceRawContentId: raw.id, status: o.edited === true ? 'EDITED' : 'APPROVED', draftTitle: title, draftBody: body,
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
        decidedBy: HUMAN_DECIDER, dedupKey: `ev-${seq}`, matchedPersonaId: persona.id, matchedAt: NOW,
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

  console.log('\nB. 🔴 배치 검토 기록')
  {
    const a = await seed()
    const pa = await planOf(a.id)
    await applySemanticRestore(prisma, pa)
    const e0 = await evidenceFromDb(prisma)
    check('🔴 🔴 **복원만으로는 사람 표본이 아니다 (legacy founder 표식 · 검토 기록 없음)**',
      e0.excluded.noReview >= 1 && e0.eligible === 0, JSON.stringify(e0.excluded))
    const bundle = { digest: digestOf('bundle-text-1'), items: [{ queueId: a.id, draftTitleDigest: digestOf(a.title), draftBodyDigest: digestOf(a.body) }] as BundleItem[] }
    const file = (o: Partial<Record<keyof ReviewFile, unknown>> = {}, item: Record<string, unknown> = {}): ReviewFile => ({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', bundleDigest: bundle.digest, reviewedAt: '2026-09-25T12:00:00Z',
      items: [{ ...bundle.items[0], hardDefect: 'no', reasons: [], ...item }], ...o,
    })
    const importAll = async (f: ReviewFile, b = bundle) => {
      const plan = await planReviewImport(prisma, f, b)
      let n = 0
      if (plan.ok) for (const i of plan.items) n += await applyReviewImport(prisma, i)
      return { plan, n }
    }
    const bad = await importAll(file({ reviewer: 'founder' }))
    check('🔴 🔴 **검토자 "founder"(임의 문자열) → 파일 거절 · write 0**', !bad.plan.ok && bad.n === 0)
    const badCase = await importAll(file({ reviewer: 'Human:founder' }))
    check('🔴 검토자 대소문자 변형도 거절', !badCase.plan.ok && badCase.n === 0)
    const wrongBundle = await importAll(file({ bundleDigest: digestOf('다른 묶음') }))
    check('🔴 다른 묶음을 가리키는 파일 → 거절 · write 0', !wrongBundle.plan.ok && wrongBundle.n === 0)

    const cx = await importAll(file({ reviewer: 'codex:master-review' }))
    const e1 = await evidenceFromDb(prisma)
    check('🔴 🔴 **Codex 검토 기록은 남지만 사람 표본이 아니다**',
      cx.n === 1 && readEvidenceReviews((await snap(a.id)).editDiff).some((r) => r.reviewer === 'codex:master-review')
      && e1.eligible === 0 && e1.excluded.nonHumanOnly === 1, JSON.stringify(e1.excluded))
    const md = await importAll(file({ reviewer: 'model:semantic-audit' }))
    check('🔴 모델 검토 기록도 표본이 아니다', md.n === 1 && (await evidenceFromDb(prisma)).eligible === 0)

    const hu = await importAll(file())
    const e2 = await evidenceFromDb(prisma)
    check('🔴 🔴 **human:founder 기록 → 사람 표본 1 · 결함 no 측정됨**', hu.n === 1 && e2.eligible === 1 && e2.hardDefects === 0, JSON.stringify(e2))
    const rerun = await importAll(file())
    check('🔴 🔴 **같은 파일 재실행 → unchanged · write 0**',
      rerun.plan.ok && rerun.plan.items.every((i) => i.action === 'unchanged') && rerun.n === 0)
    const conflict = await importAll(file({}, { hardDefect: 'yes', reasons: ['생활사 모순'] }))
    check('🔴 🔴 **같은 검토자의 다른 판정 → 덮지 않고 거절 · write 0**',
      conflict.plan.ok && conflict.plan.items[0]!.action === 'reject' && conflict.n === 0
      && readEvidenceReviews((await snap(a.id)).editDiff).filter((r) => r.reviewer === 'human:founder')[0]!.hardDefect === 'no')

    // 🔴 hardDefect 비움 → unmeasured → 게이트 닫힘
    const b2 = await seed()
    await applySemanticRestore(prisma, await planOf(b2.id))
    const bundle2 = { digest: digestOf('bundle-text-2'), items: [{ queueId: b2.id, draftTitleDigest: digestOf(b2.title), draftBodyDigest: digestOf(b2.body) }] }
    const um = await importAll({ contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:operator', bundleDigest: bundle2.digest, reviewedAt: '2026-09-25T12:00:00Z', items: [{ ...bundle2.items[0] }] }, bundle2)
    const e3 = await evidenceFromDb(prisma)
    check('🔴 🔴 **hardDefect 비움 → unmeasured 로 기록 (no 가 아니다) · 게이트 결함 null**',
      um.n === 1 && readEvidenceReviews((await snap(b2.id)).editDiff)[0]!.hardDefect === 'unmeasured'
      && e3.eligible === 2 && e3.hardDefects === null && e3.hardDefectUnmeasured === 1 && !e3.meetsContract, JSON.stringify(e3))
    const noReason = await importAll({ ...file(), items: [{ ...bundle.items[0], hardDefect: 'yes', reasons: [] }] })
    check('🔴 hardDefect yes 에 근거가 없으면 그 줄을 거절', noReason.plan.ok && noReason.plan.items[0]!.action === 'reject' && noReason.n === 0)
    const weird = await importAll({ ...file({ reviewer: 'human:operator' }), items: [{ ...bundle.items[0], hardDefect: 'false' }] })
    check('🔴 hardDefect 가 yes|no 가 아니면 그 줄을 거절', weird.plan.ok && weird.plan.items[0]!.action === 'reject' && weird.n === 0)

    // 🔴 묶음 뒤 초안이 바뀌었다 · 경쟁 수정 CAS
    const c = await seed()
    const bundle3 = { digest: digestOf('bundle-text-3'), items: [{ queueId: c.id, draftTitleDigest: digestOf(c.title), draftBodyDigest: digestOf(c.body) }] }
    await prisma.originalPostApprovalQueue.update({ where: { id: c.id }, data: { draftBody: `${c.body}.` } })
    const drift = await importAll({ contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', bundleDigest: bundle3.digest, reviewedAt: '2026-09-25T12:00:00Z', items: [{ ...bundle3.items[0], hardDefect: 'no' }] }, bundle3)
    check('🔴 🔴 **묶음을 만든 뒤 DB 초안이 바뀌었다 → 거절 · write 0**', drift.plan.ok && drift.plan.items[0]!.action === 'reject' && drift.n === 0)
    const d = await seed()
    const bundle4 = { digest: digestOf('bundle-text-4'), items: [{ queueId: d.id, draftTitleDigest: digestOf(d.title), draftBodyDigest: digestOf(d.body) }] }
    const plan4 = await planReviewImport(prisma, { contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', bundleDigest: bundle4.digest, reviewedAt: '2026-09-25T12:00:00Z', items: [{ ...bundle4.items[0], hardDefect: 'no' }] }, bundle4)
    // 🔴 같은 ms 경쟁 — editDiff 만 바뀌고 updatedAt 은 계획 때 값 그대로
    await prisma.originalPostApprovalQueue.update({
      where: { id: d.id }, data: { editDiff: { note: '경쟁' } as never, updatedAt: plan4.ok ? plan4.items[0]!.snapshot!.updatedAt : new Date() },
    })
    const n4 = plan4.ok ? await applyReviewImport(prisma, plan4.items[0]!) : -1
    check('🔴 🔴 **계획 뒤 경쟁 수정(같은 updatedAt) → CAS 0**', n4 === 0 && readEvidenceReviews((await snap(d.id)).editDiff).length === 0, String(n4))
    // 🔴 사람 기록은 **그 초안**에 묶인다 — 기록 뒤 초안이 바뀌면 표본에서 빠진다
    const beforeDrift = (await evidenceFromDb(prisma)).eligible
    await prisma.originalPostApprovalQueue.update({ where: { id: a.id }, data: { draftBody: `${a.body} 바뀜` } })
    const afterDrift = await evidenceFromDb(prisma)
    check('🔴 🔴 **사람 기록 뒤 초안이 바뀌면 그 행은 표본에서 빠진다 (draftMismatch)**',
      afterDrift.eligible === beforeDrift - 1 && afterDrift.excluded.draftMismatch >= 1, `${beforeDrift} → ${afterDrift.eligible} · ${JSON.stringify(afterDrift.excluded)}`)
    await prisma.originalPostApprovalQueue.update({ where: { id: a.id }, data: { draftBody: a.body } })
    check('🔴 🔴 **importer 는 decidedBy·status·createdPostId·Persona 를 쓰지 않았다**',
      (await snap(a.id)).decidedBy === HUMAN_DECIDER && (await snap(a.id)).status === 'APPROVED'
      && (await snap(a.id)).createdPostId === null && (await snap(a.id)).matchedPersonaId === persona.id)
  }

  console.log('\nC. 🔴 게이트 — 29 닫힘 · 30·90%·0 열림 · 기준 불변')
  {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OriginalPostApprovalQueue","MicroSeedRawContent" CASCADE')
    artifacts.clear(); candidates.clear()
    const rows: { id: string; title: string; body: string }[] = []
    for (let i = 0; i < 30; i += 1) rows.push(await seed({ edited: i >= 27 }))
    for (const p of await planSemanticRestore(prisma, artifacts, candidates, NOW)) await applySemanticRestore(prisma, p)
    const bundle = { digest: digestOf('bundle-gate'), items: rows.map((r) => ({ queueId: r.id, draftTitleDigest: digestOf(r.title), draftBodyDigest: digestOf(r.body) })) }
    const f = (items: BundleItem[]): ReviewFile => ({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', bundleDigest: bundle.digest, reviewedAt: '2026-09-25T12:00:00Z',
      items: items.map((i) => ({ ...i, hardDefect: 'no', reasons: [] })),
    })
    const p29 = await planReviewImport(prisma, f(bundle.items.slice(0, 29)), bundle)
    if (p29.ok) for (const i of p29.items) await applyReviewImport(prisma, i)
    const g29 = await evidenceFromDb(prisma)
    check('🔴 🔴 **사람 표본 29건 → 닫힘**', g29.eligible === 29 && !g29.meetsContract, JSON.stringify(g29.reasons))
    const p30 = await planReviewImport(prisma, f(bundle.items), bundle)
    if (p30.ok) for (const i of p30.items) await applyReviewImport(prisma, i)
    const g30 = await evidenceFromDb(prisma)
    check('🔴 🔴 **30건 · 무수정 27(90%) · 결함 0 → 열림**',
      g30.eligible === 30 && g30.noEdit === 27 && g30.hardDefects === 0 && g30.meetsContract, JSON.stringify(g30))
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
