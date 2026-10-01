#!/usr/bin/env tsx
/**
 * Persona **말투 근거 공급** — 🔴 기본은 dry-run. 네트워크 0 · 유료 호출 0 · DB write 0 (2026-09-29, Lane 3)
 *
 *   npx tsx scripts/persona-voice-supply.mts                    # 수집 산출물만 · 회원 대조 미측정
 *   npx tsx scripts/persona-voice-supply.mts --db               # + 운영 DB read-only (rawComments · 회원 표시명 ·
 *                                                               #   Persona 코드 · cadence · 표시명 Gate ⑥-B)
 *   npx tsx scripts/persona-voice-supply.mts --db --count=6 --creative=fixture   # 🟡 fixture creative (적재 불가)
 *   SORAN_ISOLATED_DB=yes-throwaway npx tsx scripts/persona-voice-supply.mts --db --creative=fixture \
 *     --apply --limit=<draftable 수> --reason "..."             # 🔴 격리 DB 에서만 — draft 적재
 *
 * 한 사이클
 *   ① 공개 댓글   수집 산출물(`comments:[{author,content}]`) + `MicroSeedRawContent.rawComments` +
 *                 🔴 수집 시점 말투 근거(`*.voice-evidence.jsonl` — 작성자는 salt 해시뿐)를 읽는다.
 *                 말투 근거는 `SORAN_VOICE_EVIDENCE_SALT` 와 회원 표시명(--db)이 있어야 쓴다 — 없으면 전부 버린다
 *   ② 공급 계획   거르기·익명화 → 중복 화자 제거 → 운영 `planBundles` → seed 공유 1 → 운영 배정 바이트 불변
 *   ③ P20~P25    말투 보충 계획 (Persona 는 이미 있다 — 🔴 이 도구는 운영 생성 경로에 연결하지 않는다)
 *   ④ P26~       골격 · creative(예산 게이트 → 🔴 live 미실행) · 운영 검증기 → valid / quarantined / rejected
 *   ⑤ 적재       `--apply` 뒤에서만 · valid + live creative 만(격리 DB 는 fixture 허용) · draft 만
 *
 * 🔴 출력은 코드·개수·사유 코드뿐이다. 댓글 원문·작성자 표시·회원 이름은 나오지 않는다.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { assignCandidates } from '../src/lib/persona-nickname-candidates'
import { AUTOGEN_CODE_FIRST, AUTOGEN_CODE_LAST, autogenCodeOf, modeCadence, type Cadence } from '../src/lib/persona-autogen'
import { applyAutogenDrafts } from './lib/persona-autogen-apply.mjs'
import { loadCanonCorpusTexts, stableAssignment } from './lib/persona-reference-store.mjs'
import {
  planVoiceSupply, rowsFromCollectLine, rowsFromRawContent, type PublicCommentRow,
} from './lib/persona-voice-supply.mjs'
import {
  FixtureCreativeProvider, LiveCreativeProvider, readCreativeBudget, type CreativeProvider,
} from './lib/persona-voice-creative.mjs'
import { runVoiceSupply } from './lib/persona-voice-supply-run.mjs'
import { limitsFromEnv, missingBudgetEnvNames } from './lib/supply-llm-call.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readEvidenceSalt, rowsFromVoiceEvidence, VOICE_EVIDENCE_SUFFIX } from './lib/voice-evidence-capture.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const APPLY = argv.includes('--apply')
const USE_DB = argv.includes('--db') || APPLY
const COUNT = Number(arg('count') ?? '6')
const LIMIT = arg('limit') === null ? null : Number(arg('limit'))
const REASON_AT = argv.indexOf('--reason')
const REASON = REASON_AT >= 0 ? (argv[REASON_AT + 1] ?? '') : ''
const CREATIVE = arg('creative') ?? 'live'
const DATA_DIR = arg('data-dir') ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data')
const ISOLATED = (process.env.SORAN_ISOLATED_DB ?? '').trim() === 'yes-throwaway'
const fail = (m: string, code = 1): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(code) }

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > AUTOGEN_CODE_LAST - AUTOGEN_CODE_FIRST + 1) {
  fail(`--count 는 1~${AUTOGEN_CODE_LAST - AUTOGEN_CODE_FIRST + 1} 정수다`)
}
if (CREATIVE !== 'live' && CREATIVE !== 'fixture') fail('--creative 는 live | fixture 다')
// 🔴 운영 DB 에 fixture 로 만든 사람을 적재하지 않는다 — 판정 전에 막는다
if (APPLY && CREATIVE === 'fixture' && !ISOLATED) fail('fixture creative 는 격리 DB(SORAN_ISOLATED_DB=yes-throwaway)에서만 적재한다')

console.log(`\n══ Persona 말투 근거 공급 — ${APPLY ? '🔴 --apply (draft 적재)' : 'dry-run (DB write 0)'} · 네트워크 0 · 유료 호출 0 ══\n`)

// ── 정본 말투 배정 — 🔴 없으면 멈춘다. 없는 채로 돌면 P01~P19 자리에 공급 화자가 들어간다 ──
const canon = loadCanonCorpusTexts()
if (!canon.ok) fail(`정본 말투 자산을 읽지 못했다 [${canon.code}] — 운영 배정을 모르면 덧붙일 자리도 모른다`, 3)
const base = stableAssignment({ repoRoot: process.cwd() })
console.log(`  정본 배정 ${base.byCode.size}칸 (${[...base.byCode.keys()].sort().join('·')})`)

// ── ① 공개 댓글 — 수집 산출물 ──
const rows: PublicCommentRow[] = []
/** 🔴 수집 시점 말투 근거 — 회원 대조(--db) 뒤에만 공급 입력이 된다 */
const evidenceLines: unknown[] = []
let files = 0
let lines = 0
let evidenceFiles = 0
if (existsSync(DATA_DIR)) {
  for (const f of readdirSync(DATA_DIR)) {
    const p = join(DATA_DIR, f)
    if (!f.endsWith('.jsonl') || !statSync(p).isFile()) continue
    const isEvidence = f.endsWith(VOICE_EVIDENCE_SUFFIX)
    if (isEvidence) evidenceFiles += 1
    else files += 1
    for (const l of readFileSync(p, 'utf-8').split('\n')) {
      if (l.trim() === '') continue
      let o: unknown
      try { o = JSON.parse(l) } catch { if (isEvidence) evidenceLines.push(null); continue }
      if (isEvidence) { evidenceLines.push(o); continue }
      lines += 1
      rows.push(...rowsFromCollectLine(o))
    }
  }
}
console.log(`  수집 산출물 jsonl ${files}개 · ${lines}줄 → 댓글 ${rows.length}건`)
console.log(`  말투 근거 jsonl ${evidenceFiles}개 · ${evidenceLines.length}줄`)

// ── 운영 DB (read-only) ──
type Db = {
  memberNames: string[]
  codes: string[]
  cadence: Cadence | null
  gateOf: (n: string) => 'pass' | 'review' | 'regenerate' | 'reject'
  isTaken: (n: string) => boolean
}
let db: Db | null = null
let prismaRef: import('@prisma/client').PrismaClient | null = null
let hashOf: ((v: string) => string) | null = null
if (USE_DB) {
  await loadEnvLocal()
  const { PrismaClient } = await import('@prisma/client')
  const { loadNameCollisionSets, loadMemberNames } = await import('./lib/persona-name-collision-sets.mjs')
  const { checkNameCollision } = await import('./lib/persona-gate-name-collision.mjs')
  const salt = (process.env.VOICE_AUTHOR_HASH_SALT ?? 'soransoran-voice-v1').trim()
  const h = (v: string): string => `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`
  hashOf = h
  const prisma = new PrismaClient()
  prismaRef = prisma
  // 🔴 읽기만 — 세 칸만 고른다(원문 본문 `rawBody` 는 읽지 않는다)
  const raw = await prisma.microSeedRawContent.findMany({
    select: { sourceSite: true, sourceArticleId: true, rawComments: true },
  })
  const fromRaw = rowsFromRawContent(raw)
  rows.push(...fromRaw)
  console.log(`  운영 DB read-only — rawComments 가 있는 행 ${raw.filter((r) => r.rawComments !== null).length} → 댓글 ${fromRaw.length}건`)
  const personas = await prisma.persona.findMany({
    select: { code: true, status: true, dailyCap: true, weeklyCap: true, silenceRate: true, activityRhythm: true },
  })
  const sets = await loadNameCollisionSets(prisma)
  const cadences: Cadence[] = personas
    .filter((r) => r.status === 'active' && r.dailyCap !== null && r.weeklyCap !== null && r.silenceRate !== null
      && r.activityRhythm !== null && typeof r.activityRhythm === 'object')
    .map((r) => ({
      dailyCap: r.dailyCap!, weeklyCap: r.weeklyCap!, silenceRate: Number(r.silenceRate),
      activityRhythm: r.activityRhythm as Cadence['activityRhythm'],
    }))
  const memberNames = await loadMemberNames(prisma)
  {
    // 🔴 말투 근거 — salt 가 없거나 다르면 실회원 대조를 못 하므로 전부 버린다(값은 출력하지 않는다)
    const ev = rowsFromVoiceEvidence(evidenceLines, {
      salt: readEvidenceSalt(process.env),
      members: { memberNames, personaNames: sets.personaNames ?? [] },
      now: new Date(),
    })
    rows.push(...ev.rows)
    const dropped = Object.entries(ev.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')
    console.log(`  말투 근거 ${ev.read}줄 → 공급 입력 ${ev.rows.length}건${dropped === '' ? '' : ` · 버림 ${dropped}`}`)
  }
  db = {
    memberNames,
    codes: personas.map((p) => p.code),
    cadence: modeCadence(cadences),
    gateOf: (n) => checkNameCollision(n, sets, { hashOf: h }).status,
    isTaken: (n) => checkNameCollision(n, sets, { hashOf: h }).status !== 'pass',
  }
  console.log(`  회원 표시명 ${db.memberNames.length} · Persona ${personas.length}행 · cadence 표본 ${cadences.length}`)
}

// ── 코드 ──
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
if (pool.problems.length > 0) fail(`정본 Pool 카드 파싱 문제 ${pool.problems.length}건`)
const taken = new Set<string>([...pool.cards.map((c) => c.code), ...(db?.codes ?? [])])
/**
 * 🔴 **새 코드는 고정 순번이다 — 이미 있는 코드를 건너뛰지 않는다.**
 *    공급 묶음은 아직 어디에도 저장되지 않는다(남은 blocker). 건너뛰면 다시 돌릴 때 **같은 화자가
 *    다음 번호에 또 배정**되어 한 사람의 말투를 두 Persona 가 쓴다. 고정 순번이면 같은 화자는 같은
 *    코드로 가고, 그 코드가 이미 있으면 `CODE_TAKEN` 으로 격리된다(아래 적재 가드가 한 번 더 막는다).
 */
const newCodes: string[] = []
for (let n = AUTOGEN_CODE_FIRST; n <= AUTOGEN_CODE_LAST && newCodes.length < COUNT; n += 1) newCodes.push(autogenCodeOf(n))

// ── ② 공급 계획 ──
const plan = planVoiceSupply({
  rows,
  // 🔴 DB 없이는 회원 대조를 못 한다 — null 이면 전부 REAL_MEMBER_UNMEASURED 로 막힌다
  members: db === null ? null : { memberNames: db.memberNames },
  canonTexts: canon.texts,
  base: base.byCode,
  baseAfter: () => stableAssignment({ repoRoot: process.cwd() }).byCode,
  productionCodes: PRODUCTION_PERSONA_CODES,
  newCodes,
})
if (plan.screen.identityLeak.hits > 0) fail(`식별자 유출 ${plan.screen.identityLeak.hits}건 — 거르기 규칙이 깨졌다`)

console.log('\n── 공급 계획 (코드·개수만)')
console.log(`  입력 ${plan.screen.input} · 남김 ${plan.screen.kept} · 실회원 화자 ${plan.screen.realMemberSpeakers}`)
console.log(`  빠진 이유  ${Object.entries(plan.screen.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`)
console.log(`  중복 화자 ${plan.duplicateSpeakers} · 🔴 3건↑ 안전 화자(사용 가능) ${plan.availableSpeakers}`)
console.log(`  대상 순서 ${plan.targets.join('·')}`)
console.log(`  배정 ${plan.slots.length}칸 · 공급 차단 ${plan.blocks.join(' ') || '—'}`)
console.log(`  🔴 운영 배정 바이트 drift ${plan.drift.length === 0 ? '0 (P01~P19 그대로)' : plan.drift.join('·')}`)

// ── creative provider · 예산 ──
const provider: CreativeProvider = CREATIVE === 'fixture'
  ? new FixtureCreativeProvider()
  : new LiveCreativeProvider('gemini-3.7-flash')
const limits = limitsFromEnv(process.env)
const budget = CREATIVE === 'live'
  ? readCreativeBudget({ limits, runId: `persona-voice-supply-${new Date().toISOString().slice(0, 10)}`, now: new Date() })
  : null
if (CREATIVE === 'live') {
  const miss = missingBudgetEnvNames(limits)
  console.log(`\n  creative live — 예산 env 미설정 ${miss.length === 0 ? '0' : miss.join('·')} · 장부 읽기 ${budget?.ledgerOk ? 'OK' : '실패'}`
    + ' · 🔴 유료 호출은 이 PR 에서 실행하지 않는다')
} else {
  console.log('\n  🟡 creative fixture — 결정론 합성. 운영 적재 불가')
}

const names = db === null ? null : assignCandidates(newCodes, db.isTaken).picked
const run = await runVoiceSupply({
  plan, productionCodes: PRODUCTION_PERSONA_CODES, pool: pool.cards, takenCodes: taken,
  provider, budget, liveEnabled: false,
  cadence: db?.cadence ?? null, names, gateOf: db?.gateOf ?? null,
  allowFixture: ISOLATED,
})

console.log('\n── ③ P20~P25 말투 보충 (운영 Persona · 🔴 운영 생성 경로에는 연결하지 않았다)')
for (const t of run.topUps) {
  console.log(`  ${t.code}  ${t.comments > 0 ? `묶음 ${t.comments}건 · seed 공유 ${t.seedShareCount}` : '화자 없음'}${t.blocks.length > 0 ? ` · ${t.blocks.join(' ')}` : ''}`)
}
console.log('\n── ④ P26~ 후보 (코드만)')
const cnt: Record<string, number> = {}
for (const c of run.candidates) {
  console.log(`  ${c.code}  ${c.verdict.status.padEnd(11)} ${c.creativeCode ?? (c.creativeOrigin ?? '—')}  ${c.verdict.blocks.join(' ') || '—'}`)
  for (const b of c.verdict.blocks) cnt[b] = (cnt[b] ?? 0) + 1
}
const draftable = run.candidates.filter((c) => c.draftable)
console.log(`\n  valid ${run.candidates.filter((c) => c.verdict.status === 'valid').length}`
  + ` · quarantined ${run.candidates.filter((c) => c.verdict.status === 'quarantined').length}`
  + ` · rejected ${run.candidates.filter((c) => c.verdict.status === 'rejected').length} · draft 가능 ${draftable.length}`)
console.log(`  격리 사유  ${Object.entries(cnt).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`)
console.log(`  creative provider 호출 ${run.creativeCalls}회 (말투 있는 후보만)`)
if (plan.availableSpeakers === 0) {
  console.log('\n  🔴 첫 병목: 공급 파이프라인이 모은 공개 댓글에 작성자·원문이 없다 — 사용 가능 화자 0')
  if (evidenceLines.length === 0) {
    console.log('     말투 근거 0줄 — 수집기에 SORAN_VOICE_EVIDENCE_SALT 가 없으면 댓글을 읽지 않는다(fail-closed)')
  }
}

if (!APPLY) {
  console.log('\n🟡 dry-run — DB write 0 · 유료 호출 0\n')
  await prismaRef?.$disconnect()
  process.exit(0)
}
if (prismaRef === null || hashOf === null || names === null) fail('--apply 는 DB 읽기가 필요하다')
// 🔴 공급 배정을 보존하는 자산이 없다 — 대상 코드가 하나라도 이미 있으면 다시 적재하지 않는다
const already = run.candidates.filter((c) => taken.has(c.code)).map((c) => c.code)
if (already.length > 0) fail(`대상 코드가 이미 있다(${already.join('·')}) — 배정 보존 없이 다시 적재하지 않는다`)
const plans = draftable.map((c) => ({
  code: c.code, status: c.verdict.status, name: names!.get(c.code) ?? '', seed: c.verdict.seed ?? {},
}))
const res = await applyAutogenDrafts(prismaRef!, { plans, limit: LIMIT, hashOf: hashOf!, reason: REASON })
await prismaRef!.$disconnect()
if (!res.ok) fail(`적재하지 않았다 — ${res.reason}`)
console.log(`\n✅ draft 적재 ${res.ok ? res.created.join(" · ") : ""} — 🔴 status=draft. 켜지 않는다\n`)
