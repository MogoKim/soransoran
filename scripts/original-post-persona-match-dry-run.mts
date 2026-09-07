#!/usr/bin/env tsx
/**
 * Original Post ↔ Persona 매칭 dry-run — 🔴 DB write 0. 언제나.
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §5
 *
 *   … → ⑤ Founder Decision → **⑥ Persona Matching (여기 · dry-run)** → ⑦ Persona Publish
 *
 * 🔴 **이 파일에는 --apply 가 없다.** 매칭 결과 저장 테이블은 E-2 에서 만든다.
 *    지금은 "규칙이 맞는가" 를 눈으로 보는 단계다 — 규칙이 흔들리는 동안 테이블을 만들면
 *    규칙이 바뀔 때마다 migration 을 다시 해야 한다.
 *
 * 🔴 **발행하지 않는다. Post 를 만들지 않는다. Persona 를 고치지 않는다.**
 *
 * 🔴 **판정 불가를 통과로 적지 않는다.**
 *    자녀 나이대가 기재되지 않은 페르소나는 `CHILD_AGE_UNKNOWN` 으로 막힌다.
 *    창업자가 값을 정하기 전까지 그 글은 발행 불가다 — 그것이 맞는 상태다.
 *
 * 🔴 **override 는 DB 를 고치지 않는다.**
 *    아직 확정되지 않은 childrenAgeBands 를 **파일로 넣어** 결과만 미리 본다.
 *    확정되면 그때 identity 에 반영하고(별도 승인) override 는 버린다.
 *
 * 사용법
 *   npx tsx scripts/original-post-persona-match-dry-run.mts
 *   npx tsx scripts/original-post-persona-match-dry-run.mts --override tmp/bands.json
 *
 *   override 파일  { "<코드>": { "childrenAgeBands": ["<밴드>"], "assumeActive": true }, … }
 *   🔴 assumeActive 는 **가정**이다. 결과에 가정 표시가 붙는다
 *   🔴 여기에 특정 페르소나의 실제 밴드를 예시로 적지 않는다 —
 *      예시가 값 결정으로 읽히는 순간, 아무도 정하지 않은 정체성이 코드에 굳는다
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import {
  planBatch, isChildAgeBand, BLOCK_LABEL, CHILD_AGE_BANDS,
  POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS, TOP_CANDIDATES,
  type PersonaForMatch, type ChildAgeBand, type BlockCode, type BatchDraft,
} from '../src/lib/original-post-persona-match'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`)
  if (i !== -1 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${k}=`))
  return eq === undefined ? undefined : eq.slice(k.length + 3)
}
const OVERRIDE = (arg('override') ?? '').trim()
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

type Override = { childrenAgeBands?: unknown; assumeActive?: unknown }
const overrides = new Map<string, { bands?: ChildAgeBand[]; assumeActive: boolean }>()
if (OVERRIDE !== '') {
  if (!existsSync(OVERRIDE)) fail(`override 파일이 없습니다: ${OVERRIDE}`)
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(OVERRIDE, 'utf-8')) } catch { fail('override 파일이 JSON 이 아닙니다') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('override 는 { code: {...} } 객체여야 합니다')
  for (const [code, raw] of Object.entries(parsed as Record<string, Override>)) {
    const o = raw ?? {}
    let bands: ChildAgeBand[] | undefined
    if (o.childrenAgeBands !== undefined) {
      if (!Array.isArray(o.childrenAgeBands)) fail(`${code}.childrenAgeBands 는 배열이어야 합니다`)
      const bad = o.childrenAgeBands.filter((b) => !isChildAgeBand(b))
      if (bad.length > 0) fail(`${code}.childrenAgeBands 에 알 수 없는 밴드: ${bad.join(' · ')}\n     허용 ${CHILD_AGE_BANDS.join(' · ')}`)
      bands = o.childrenAgeBands as ChildAgeBand[]
    }
    overrides.set(code, { ...(bands === undefined ? {} : { bands }), assumeActive: o.assumeActive === true })
  }
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log('\n══ Persona Matching dry-run — 🔴 DB write 0 ══\n')
console.log(`  리듬  주 ${POST_CAP_PER_WEEK}건 · 최소 간격 ${MIN_DAYS_BETWEEN_POSTS}일`)
console.log(`  추천  단건 = 상위 ${TOP_CANDIDATES}명 중 가중 무작위`)
console.log(`  배정  배치 = 최대 매칭 · 상위 ${TOP_CANDIDATES}명 우선 선호, 자리가 겹치면 eligible 전체까지`)
if (overrides.size > 0) console.log(`  🟡 override ${overrides.size}명 — ${OVERRIDE} (DB 는 고치지 않습니다)`)
console.log('  🔴 발행하지 않습니다 · Post 를 만들지 않습니다 · Persona 를 고치지 않습니다\n')

// ── 페르소나 조달 — 🔴 읽기만 한다 ──
const personaRows = await prisma.persona.findMany({
  select: {
    code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
    user: { select: { providerId: true } },
  },
  orderBy: { code: 'asc' },
})

const WEEK_AGO = new Date(Date.now() - 7 * 864e5)
const personas: PersonaForMatch[] = []
for (const r of personaRows) {
  const id = (r.identity ?? {}) as Record<string, unknown>
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  const ov = overrides.get(r.code)

  // 🔴 DB 값이 먼저다. override 는 없을 때만 채운다 — 있는 값을 덮으면 실측이 아니다
  const dbBands = Array.isArray(id.childrenAgeBands)
    ? (id.childrenAgeBands as unknown[]).filter(isChildAgeBand)
    : undefined
  const bands = dbBands ?? ov?.bands

  // 🔴 글 수는 ActivityLog 에서 센다. Persona 에 카운터를 두지 않는다는 스키마 판단 그대로다
  const postsThisWeek = await prisma.personaActivityLog.count({
    where: { persona: { code: r.code }, kind: 'post', createdAt: { gte: WEEK_AGO } },
  })
  const last = await prisma.personaActivityLog.findFirst({
    where: { persona: { code: r.code }, kind: 'post' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  personas.push({
    code: r.code,
    status: ov?.assumeActive === true ? 'active' : r.status,
    providerId: r.user?.providerId ?? null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(bands === undefined ? {} : { childrenAgeBands: bands }),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: typeof id.workStatus === 'string' ? id.workStatus : null,
    economicStatus: typeof id.economicStatus === 'string' ? id.economicStatus : null,
    region: null,
    noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last === null ? null : Math.floor((Date.now() - last.createdAt.getTime()) / 864e5),
  })
}

console.log('── 페르소나 상태')
for (const p of personas) {
  const ov = overrides.get(p.code)
  // 🔴 미기재(모름)와 빈 배열(무자녀를 앎)은 다르다 — 화면에서도 구분한다
  const bandTxt = p.childrenAgeBands == null
    ? '🔴 미기재'
    : p.childrenAgeBands.length === 0 ? '(무자녀)' : p.childrenAgeBands.join('·')
  console.log(
    `  ${p.code}  ${p.status.padEnd(7)}${ov?.assumeActive ? '(가정)' : '      '}` +
    ` 자녀 ${p.childrenCount ?? '—'}명 [${bandTxt}]` +
    ` · ${p.maritalStatus ?? '—'} · 돌봄 ${p.parentCare ?? '—'} · 갱년기 ${p.menopauseStatus ?? '—'}`,
  )
}

// ── 승인 초안 조달 ──
const drafts = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] } },
  select: {
    id: true, status: true, gateVerdict: true, createdAt: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    rawContent: { select: { sourceArticleId: true } },
  },
  orderBy: { createdAt: 'asc' },
})
console.log(`\n── 대상 ${drafts.length}건 (APPROVED · EDITED)\n`)

// 🔴 수정본이 있으면 그것이 발행될 글이다. 초안으로 매칭하면 다른 글을 판정하는 셈이다
const batchDrafts: BatchDraft[] = drafts.map((d) => ({
  queueId: d.id,
  title: d.editedTitle ?? d.draftTitle,
  body: d.editedBody ?? d.draftBody,
  gateVerdict: d.gateVerdict,
  createdAt: d.createdAt.getTime(),
}))
const batch = planBatch(batchDrafts, personas)
const byId = new Map(batch.assignments.map((a) => [a.queueId, a]))

let publishable = 0
let assignedCount = 0
const blockTally = new Map<string, number>()
const soloCandidate: string[] = []

for (const d of drafts) {
  const a = byId.get(d.id)!
  const body = d.editedBody ?? d.draftBody
  const score = (code: string | null): string => {
    const hit = a.eligible.find((c) => c.code === code)
    return hit === undefined ? '' : ` (${hit.score.total}점)`
  }

  console.log(`══ ${d.id}  ${d.rawContent.sourceArticleId}  gate=${d.gateVerdict}  ${[...body].length}자`)
  console.log(`   요구  ${a.requirements.labels.length === 0 ? '(없음 — 누구나)' : a.requirements.labels.join(' · ')}`)

  if (a.eligible.length > 0) {
    publishable += 1
    if (a.eligible.length === 1) soloCandidate.push(d.id)
    console.log(`   ✅ 매칭 가능 · 후보 ${a.eligible.length}명${a.eligible.length === 1 ? ' 🟡 단독' : ''}`)
    // 🔴 두 방식을 나란히 보여준다. 어느 쪽이 달라졌는지가 이 판의 요점이다
    console.log(`      독립 추천  ${a.standalone ?? '—'}${score(a.standalone)}`)
    if (a.assigned === null) {
      console.log(`      🟡 순차 배정  없음 — 여력 소진 (${a.deferredBy.join(' · ')})`)
      console.log('         🔴 발행 불가가 아니라 **다음 주기로 밀림**입니다')
    } else {
      assignedCount += 1
      const mark = a.assigned === a.standalone ? '' : '  ← 🔄 바뀜'
      console.log(`      🟢 순차 배정  ${a.assigned}${score(a.assigned)}${mark}`)
      const alts = a.top.filter((c) => c.code !== a.assigned)
      console.log(`      대체        ${alts.length === 0 ? '(없음)' : alts.map((c) => `${c.code} ${c.score.total}점`).join(' · ')}`)
    }
  } else {
    console.log('   🔴 매칭 불가 — 조건을 만족하는 페르소나가 없습니다')
    console.log('      억지로 배정하지 않습니다. 글을 고쳐 맞추지도 않습니다.')
  }

  for (const b of a.blocked) {
    const codes = b.reasons.map((r) => `${BLOCK_LABEL[r.code as BlockCode] ?? r.code}(${r.detail})`)
    for (const r of b.reasons) blockTally.set(r.code, (blockTally.get(r.code) ?? 0) + 1)
    console.log(`      ⛔ ${b.code}  ${codes.join(' · ')}`)
  }
  console.log('')
}

// ── 두 방식 비교 ──
const standaloneLoad = new Map<string, number>()
for (const a of batch.assignments) {
  if (a.standalone !== null) standaloneLoad.set(a.standalone, (standaloneLoad.get(a.standalone) ?? 0) + 1)
}
const fmtLoad = (m: Map<string, number> | Record<string, number>): string => {
  const e = m instanceof Map ? [...m.entries()] : Object.entries(m)
  return e.length === 0 ? '(없음)' : e.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k, v]) => `${k} ×${v}`).join(' · ')
}

console.log('══ 결산 ══')
console.log(`  매칭 가능  ${publishable} / ${drafts.length}건 · 🟡 단독 후보 ${soloCandidate.length}건`)
console.log(`  순차 배정  ${assignedCount}건 · 여력 소진으로 밀림 ${publishable - assignedCount}건`)
console.log('\n  추천 분산 비교')
console.log(`    독립      ${fmtLoad(standaloneLoad)}`)
console.log(`    순차 배정  ${fmtLoad(batch.load)}   ← 🔴 주 ${POST_CAP_PER_WEEK}건 여력 차감`)
console.log('\n  차단 사유 집계')
for (const [code, n] of [...blockTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}회  ${code} — ${BLOCK_LABEL[code as BlockCode] ?? ''}`)
}
console.log('\n  🔴 DB write 0 · Post 0 · 발행 0. 이 명령에는 --apply 가 없습니다.\n')

await prisma.$disconnect()
