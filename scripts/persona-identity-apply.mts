#!/usr/bin/env tsx
/**
 * P07 · P10 · P15 · P17 identity 보강 + P05 무효 role 정리 — 적용 스크립트
 *
 *   npx tsx scripts/persona-identity-apply.mts            # dry-run (기본)
 *   npx tsx scripts/persona-identity-apply.mts --apply    # 실제 적용
 *   npx tsx scripts/persona-identity-apply.mts --check    # 반영 검증
 *
 * 근거: docs/operations/2026-08-30-persona-pool-design.md (페르소나 정의 정본)
 * 입력: tmp/persona-identity-fill.json — 🔴 gitignored. 값을 repo 에 커밋하지 않는다
 *       (헌법 §9-6 — 페르소나를 코드 상수로 두지 않는다)
 *
 * 🔴 값을 출력하지 않는다. 채움 여부 · 필드 수 · 검출 코드만 남긴다.
 * 🔴 status 는 건드리지 않는다. draft 가 아니면 시작하지 않는다.
 * 🔴 하나라도 검증에 실패하면 아무것도 적용하지 않는다. 부분 적용은 없다.
 * 🔴 P05 는 roles 정리만 허용한다 — 다른 키가 섞이면 중단한다.
 */
import { PrismaClient, type PersonaStatus } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { checkIdentifyingDetail } from './lib/persona-gate-234.mjs'
import { checkCommentCandidate, type CandidateInput } from './lib/persona-comment-candidate.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const INPUT_PATH = 'tmp/persona-identity-fill.json'
const CANDIDATES_PATH = 'tmp/persona-comment-candidates.json'

/** identity 보강 대상 */
const TARGETS = ['P07', 'P10', 'P15', 'P17'] as const
/** 🔴 roles 정리만 허용 — identity 가 이미 있는 페르소나다 */
const ROLE_FIX_ONLY = ['P05'] as const
const DRAFT: PersonaStatus = 'draft'

/** 🔴 이 작업이 남기는 AuditLog 표식. 중복 적용 판정의 기준이다 */
const AUDIT_REASON = 'identity 보강 · 무효 role 정리'

/**
 * 🔴 분류기가 실제로 내는 값 — voice-comment-signals.mts 의 ReactionType.
 *    pool 문서의 advice · caution · levity 는 M3 roleWeights 체계라
 *    여기 넣어도 classifyReaction 결과와 대조되지 않는다. 죽은 값이 된다.
 */
const REACTION_TYPES = ['empathy', 'question', 'rebuttal', 'experience', 'information', 'other']

/**
 * 🔴 ③ 판정부가 보지 않는 축만 여기서 본다.
 *    나이 · 지명 · 병명 · 금액 · 기관은 checkIdentifyingDetail 이 이미 본다 —
 *    사전을 두 벌 두면 언젠가 어긋난다.
 */
const EXTRA_FORBIDDEN: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: 'URL', re: /https?:\/\//u },
  { code: 'SOURCE_REF', re: /\bc[a-z0-9]{24}\b/u },
  { code: 'SOURCE_MARKER', re: /(82cook|masanmam|goondae|yeowooya|navercafe|82님|등업)/iu },
]

type FillEntry = {
  identity?: Record<string, unknown>
  voiceCore?: Record<string, unknown>
  noGoTopics?: string[]
  noGoExpressions?: string[]
  forbiddenReactionRoles?: string[]
}
type CandidateFile = { personaCode: string; text: string; sourceTexts?: string[] }

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string): void => console.log(`   ✅ ${m}`)

// ══ 입력 ══════════════════════════════════════════
function readFill(): Record<string, FillEntry> {
  if (!existsSync(INPUT_PATH)) fail(`${INPUT_PATH} 이 없습니다. (tmp/ 는 gitignored 입니다)`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'))
  } catch (e) {
    return fail(`${INPUT_PATH} 을 읽을 수 없습니다: ${(e as Error).message}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(`${INPUT_PATH} 이 객체가 아닙니다.`)
  }
  return parsed as Record<string, FillEntry>
}
const fill = readFill()

const codes = Object.keys(fill).filter((k) => !k.startsWith('_'))
const known = [...TARGETS, ...ROLE_FIX_ONLY] as readonly string[]

console.log(`\n══ ${CHECK ? '검증 (--check)' : APPLY ? '적용 (--apply)' : 'dry-run'} ══`)

// ── 대상 ──
const extra = codes.filter((c) => !known.includes(c))
if (extra.length > 0) fail(`대상 밖 persona ${extra.length}종이 있습니다.`)
const missing = TARGETS.filter((t) => !codes.includes(t))
if (missing.length > 0) fail(`보강안이 없는 대상 ${missing.length}종: ${missing.join(', ')}`)
// 🔴 roles 정리 대상에 다른 키가 섞였는가 — "겸사겸사" 를 여기서 막는다
for (const c of ROLE_FIX_ONLY) {
  const e = fill[c]
  if (e === undefined) continue
  const others = Object.keys(e).filter((k) => k !== 'forbiddenReactionRoles')
  if (others.length > 0) fail(`${c} 는 roles 정리만 허용합니다 — 키 ${others.length}개가 더 있습니다.`)
}
const fillTargets = codes.filter((c) => (TARGETS as readonly string[]).includes(c))
const fillRoleOnly = codes.filter((c) => (ROLE_FIX_ONLY as readonly string[]).includes(c))
ok(`identity 보강 ${fillTargets.length}종 · roles 정리만 ${fillRoleOnly.length}종`)

await loadEnvLocal()
const prisma = new PrismaClient()

const personas = await prisma.persona.findMany({
  select: {
    id: true, code: true, status: true, identity: true, voiceCore: true,
    noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
  },
  orderBy: { code: 'asc' },
})
const byCode = new Map(personas.map((p) => [p.code, p]))
const unknownCode = codes.filter((c) => !byCode.has(c))
if (unknownCode.length > 0) { await prisma.$disconnect(); fail(`DB 에 없는 persona: ${unknownCode.join(', ')}`) }

// ══ --check — 🔴 파일 기준으로 "실제 반영됐는가" 를 본다 ══
if (CHECK) {
  let failed = 0
  const good = (m: string): void => ok(m)
  const bad = (m: string): void => { console.log(`   ❌ ${m}`); failed++ }

  for (const code of codes) {
    const want = fill[code] ?? {}
    const cur = byCode.get(code)
    if (cur === undefined) { bad(`${code} 없음`); continue }
    const diffs: string[] = []
    if (want.identity !== undefined) {
      const got = (cur.identity ?? null) as Record<string, unknown> | null
      if (got === null) diffs.push('identity 미반영')
      else {
        const missKeys = Object.keys(want.identity).filter(
          (k) => JSON.stringify(got[k]) !== JSON.stringify(want.identity?.[k]),
        )
        if (missKeys.length > 0) diffs.push(`identity ${missKeys.length}필드 불일치`)
      }
    }
    if (want.voiceCore !== undefined) {
      const got = (cur.voiceCore ?? null) as Record<string, unknown> | null
      if (got === null) diffs.push('voiceCore 미반영')
      else {
        const missKeys = Object.keys(want.voiceCore).filter(
          (k) => JSON.stringify(got[k]) !== JSON.stringify(want.voiceCore?.[k]),
        )
        if (missKeys.length > 0) diffs.push(`voiceCore ${missKeys.length}필드 불일치`)
      }
    }
    for (const [key, got] of [
      ['noGoTopics', cur.noGoTopics], ['noGoExpressions', cur.noGoExpressions],
      ['forbiddenReactionRoles', cur.forbiddenReactionRoles],
    ] as const) {
      const w = want[key as keyof FillEntry] as string[] | undefined
      if (w === undefined) continue
      if (JSON.stringify([...got].sort()) !== JSON.stringify([...w].sort())) diffs.push(`${key} 불일치`)
    }
    if (diffs.length > 0) bad(`${code} — ${diffs.join(' · ')}`)
    else good(`${code} 반영됨`)
  }

  // 🔴 무효 role 이 DB 에 남아 있는가
  const deadLeft = personas.reduce(
    (s, p) => s + p.forbiddenReactionRoles.filter((r) => !REACTION_TYPES.includes(r)).length, 0)
  if (deadLeft === 0) good('무효 role 0종')
  else bad(`무효 role ${deadLeft}종이 남아 있다`)

  const logs = await prisma.personaAuditLog.count({
    where: { action: 'updated', reason: AUDIT_REASON, persona: { code: { in: codes } } },
  })
  if (logs === codes.length) good(`AuditLog ${logs}/${codes.length}`)
  else bad(`AuditLog ${logs}/${codes.length} — 적용 이력이 맞지 않는다`)

  const notDraftNow = personas.filter((p) => p.status !== DRAFT)
  if (notDraftNow.length === 0) good(`전부 ${DRAFT} 유지`)
  else bad(`${DRAFT} 아닌 persona ${notDraftNow.length}명`)

  const [lp, lc] = await Promise.all([
    prisma.post.count({ where: { personaId: { not: null } } }),
    prisma.comment.count({ where: { personaId: { not: null } } }),
  ])
  if (lp === 0 && lc === 0) good('Post/Comment.personaId 전부 NULL')
  else bad(`Post ${lp} · Comment ${lc} 에 personaId 가 채워졌다`)

  await prisma.$disconnect()
  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  process.exit(failed === 0 ? 0 : 1)
}

// ══ 검증 — 🔴 하나라도 실패하면 아무것도 적용하지 않는다 ══
const blockers: string[] = []

// ① status
const notDraft = personas.filter((p) => p.status !== DRAFT)
if (notDraft.length > 0) blockers.push(`${DRAFT} 아닌 persona ${notDraft.length}명`)
else ok(`Persona ${personas.length}명 · 전부 ${DRAFT}`)

// ② 금지 패턴 — ③ 판정부 + 그것이 보지 않는 축
const riskCodes = new Set<string>()
for (const code of fillTargets) {
  const strings: string[] = []
  const collect = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(collect)
  }
  collect(fill[code])
  for (const sv of strings) {
    const d = checkIdentifyingDetail(sv)
    // 🔴 걸린 값이 아니라 카테고리 코드만 모은다
    if (!d.detail.startsWith('식별 디테일 없음')) {
      const cats = d.detail.split('—')[1]?.trim()
      if (cats !== undefined && cats !== '') for (const c of cats.split('·')) riskCodes.add(c.trim())
    }
    for (const f of EXTRA_FORBIDDEN) if (f.re.test(sv)) riskCodes.add(f.code)
  }
}
if (riskCodes.size > 0) blockers.push(`금지 패턴 ${riskCodes.size}종 (${[...riskCodes].join(' · ')})`)
else ok('금지 패턴 0 — 나이 · 지명 · 병명 · 금액 · URL · sourceRef · 출처표식')

// ③ role 유효성 — 🔴 죽은 값을 새로 넣지 않는다
const deadIn = codes.flatMap((c) =>
  (fill[c]?.forbiddenReactionRoles ?? []).filter((r) => !REACTION_TYPES.includes(r)).map((r) => `${c}:${r}`))
if (deadIn.length > 0) blockers.push(`분류기에 없는 role ${deadIn.length}종 (${deadIn.join(' · ')})`)
else ok(`role 전부 분류기 값 (${REACTION_TYPES.length}종 중)`)

const deadAfter = personas.reduce((s, p) => {
  const after = fill[p.code]?.forbiddenReactionRoles ?? p.forbiddenReactionRoles
  return s + after.filter((r) => !REACTION_TYPES.includes(r)).length
}, 0)
if (deadAfter > 0) blockers.push(`적용 후에도 무효 role ${deadAfter}종이 남는다`)
else ok('적용 후 무효 role 0종')

// ④ 🔴 apply 전 Gate ⑦ 재확인 — 값이 실제로 관문을 작동시키는가
if (!existsSync(CANDIDATES_PATH)) {
  blockers.push(`${CANDIDATES_PATH} 이 없어 Gate ⑦ 를 재확인하지 못했다`)
} else {
  const cands = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf-8')) as CandidateFile[]
  const notRunOf = (applyFill: boolean): number => {
    let n = 0
    for (const c of cands) {
      const cur = byCode.get(c.personaCode)
      const e = applyFill ? fill[c.personaCode] : undefined
      const input: CandidateInput = {
        personaCode: c.personaCode,
        text: c.text,
        sourceTexts: c.sourceTexts ?? [],
        identity: (e?.identity ?? cur?.identity ?? null) as CandidateInput['identity'],
        noGoTopics: e?.noGoTopics ?? cur?.noGoTopics ?? [],
        noGoExpressions: e?.noGoExpressions ?? cur?.noGoExpressions ?? [],
        forbiddenRoles: e?.forbiddenReactionRoles ?? cur?.forbiddenReactionRoles ?? [],
      }
      if (checkCommentCandidate(input).gates.find((g) => g.gate === '⑦')?.outcome === 'notRun') n++
    }
    return n
  }
  const before = notRunOf(false)
  const after = notRunOf(true)
  if (after >= before) blockers.push(`Gate ⑦ notRun 이 줄지 않는다 (${before} → ${after})`)
  else ok(`Gate ⑦ notRun ${before} → ${after}건`)

  // 🔴 "돈다" 와 "잡는다" 는 다르다 — 설정과 어긋나는 합성 문장으로 검출을 본다
  const PROBES: ReadonlyArray<{ code: string; text: string; expect: string }> = [
    { code: 'P15', text: '우리 애들은 다 컸어요', expect: 'CHILD_CONFLICT' },
    { code: 'P10', text: '남편이 요즘 자꾸 그래요', expect: 'SPOUSE_CONFLICT' },
    { code: 'P17', text: '우리 때는 다 그러고 살았죠', expect: 'NO_GO' },
    { code: 'P07', text: '우리 딸도 그 병원 다녀왔어요', expect: 'FAMILY_PROXY' },
  ]
  const caught = PROBES.filter((p) => {
    const e = fill[p.code] ?? {}
    const g = checkCommentCandidate({
      personaCode: p.code, text: p.text, sourceTexts: ['합성 원문입니다'],
      identity: (e.identity ?? byCode.get(p.code)?.identity ?? null) as CandidateInput['identity'],
      noGoTopics: e.noGoTopics ?? [], noGoExpressions: e.noGoExpressions ?? [],
    }).gates.find((x) => x.gate === '⑦')
    return g?.outcome === 'regenerate' && g.detail.includes(p.expect)
  }).length
  if (caught !== PROBES.length) blockers.push(`합성 모순 ${caught}/${PROBES.length}건만 검출 — 채워도 잡지 못한다`)
  else ok(`합성 모순 ${caught}/${PROBES.length}건 검출`)
}

// ⑤ 중복 적용 — 🔴 --force 는 만들지 않는다
const priorLogs = await prisma.personaAuditLog.count({
  where: { action: 'updated', reason: AUDIT_REASON, persona: { code: { in: codes } } },
})
if (priorLogs > 0) blockers.push(`이미 적용된 이력 ${priorLogs}건 — 중복 적용을 막는다 (--check 로 확인하세요)`)
else ok('적용 이력 없음')

// ── 요약 (🔴 값 미출력) ──
console.log('\n══ 반영 예정 ══')
for (const code of fillTargets) {
  const e = fill[code] ?? {}
  const cur = byCode.get(code)
  console.log(
    `  ${code}  identity ${cur?.identity === null ? 'null' : '있음'} → ${Object.keys(e.identity ?? {}).length}필드 · ` +
    `voiceCore ${Object.keys(e.voiceCore ?? {}).length}필드 · ` +
    `noGo ${(e.noGoTopics ?? []).length}+${(e.noGoExpressions ?? []).length} · ` +
    `roles ${(e.forbiddenReactionRoles ?? []).length}종`,
  )
}
for (const code of fillRoleOnly) {
  const cur = byCode.get(code)
  console.log(
    `  ${code}  🔴 roles 정리만 — ${cur?.forbiddenReactionRoles.length ?? 0}종 → ` +
    `${(fill[code]?.forbiddenReactionRoles ?? []).length}종 (identity · voiceCore · noGo 미변경)`,
  )
}

if (blockers.length > 0) {
  await prisma.$disconnect()
  fail(`검증 ${blockers.length}건 실패 — 아무것도 적용하지 않았습니다.\n     ` + blockers.join('\n     '))
}
console.log('\n   ✅ 검증 전부 통과')

if (!APPLY) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. DB write 0 · 적용하려면 --apply 를 붙이세요.\n')
  process.exit(0)
}

// ══ 적용 — 🔴 하나의 트랜잭션 ══════════════════════
const ops = []
for (const code of codes) {
  const e = fill[code] ?? {}
  const cur = byCode.get(code)
  if (cur === undefined) continue
  const data: Record<string, unknown> = {}
  const changed: string[] = []
  // 🔴 파일에 있는 필드만 쓴다. status 는 어떤 경우에도 넣지 않는다
  if (e.identity !== undefined) { data.identity = e.identity; changed.push('identity') }
  if (e.voiceCore !== undefined) { data.voiceCore = e.voiceCore; changed.push('voiceCore') }
  if (e.noGoTopics !== undefined) { data.noGoTopics = e.noGoTopics; changed.push('noGoTopics') }
  if (e.noGoExpressions !== undefined) { data.noGoExpressions = e.noGoExpressions; changed.push('noGoExpressions') }
  if (e.forbiddenReactionRoles !== undefined) {
    data.forbiddenReactionRoles = e.forbiddenReactionRoles
    changed.push('forbiddenReactionRoles')
  }
  if (changed.length === 0) continue
  ops.push(prisma.persona.update({ where: { id: cur.id }, data }))
  ops.push(prisma.personaAuditLog.create({
    data: { personaId: cur.id, action: 'updated', reason: AUDIT_REASON, changedFields: changed },
  }))
}

console.log(`\n══ 적용 ══\n   트랜잭션 1개 · 연산 ${ops.length}건`)
await prisma.$transaction(ops)
ok('적용 완료')

const after = await prisma.persona.findMany({
  select: { code: true, status: true, identity: true, forbiddenReactionRoles: true },
  orderBy: { code: 'asc' },
})
console.log(
  `   identity 보유 ${after.filter((p) => p.identity !== null).length}/${after.length} · ` +
  `무효 role ${after.reduce((s, p) => s + p.forbiddenReactionRoles.filter((r) => !REACTION_TYPES.includes(r)).length, 0)}종 · ` +
  `status ${[...new Set(after.map((p) => p.status))].join('/')}`,
)
await prisma.$disconnect()
console.log('\n✅ 적용했습니다. --check 로 검증하세요.\n')
