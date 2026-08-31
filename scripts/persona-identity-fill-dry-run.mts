#!/usr/bin/env tsx
/**
 * P07 · P10 · P15 · P17 identity 보강안 dry-run — 🔴 DB write 0
 *
 * 근거: docs/operations/2026-08-30-persona-pool-design.md (페르소나 정의 정본)
 * 입력: tmp/persona-identity-fill.json (gitignored)
 *
 * 🔴 이 스크립트에는 --apply 가 없다. 읽기만 한다.
 * 🔴 값을 출력하지 않는다. 채움 여부 · 필드 수 · 검출 코드만 남긴다.
 *
 * 검사하는 것:
 *   ① 대상이 4명뿐인가 (P05 를 건드리지 않는가)
 *   ② 필드가 실제로 채워지는가
 *   ③ 위험 패턴이 섞이지 않았는가 — ③ 판정부를 그대로 재사용한다
 *   ④ 🔴 forbiddenReactionRoles 가 **분류기가 실제로 내는 값**인가
 *      (분류기에 없는 값을 넣으면 영원히 걸리지 않는다 — 조용히 무력해진다)
 *   ⑤ 🔴 No-Go 가 리터럴인가
 *      (판정부는 text.includes() 로 본다. 서술형 정책은 절대 걸리지 않는다)
 *   ⑥ Gate ⑦ 이 notRun 에서 실제 판정으로 바뀌는가
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { checkIdentifyingDetail } from './lib/persona-gate-234.mjs'
import { checkCommentCandidate, type CandidateInput } from './lib/persona-comment-candidate.mjs'

const INPUT = 'tmp/persona-identity-fill.json'
const CANDIDATES = 'tmp/persona-comment-candidates.json'
/** identity 보강 대상 */
const TARGETS = ['P07', 'P10', 'P15', 'P17'] as const
/**
 * 🔴 roles 정리만 허용하는 대상.
 *    P05 는 identity 가 이미 있다. 이번에 손대는 것은 무효 role 제거뿐이고,
 *    다른 키가 섞이면 중단한다 — "겸사겸사" 를 스크립트가 막는다.
 */
const ROLE_FIX_ONLY = ['P05'] as const

const fail = (m: string): never => { console.error(`\n🔴 ${m}\n`); process.exit(1) }
const ok = (m: string): void => { console.log(`   ✅ ${m}`) }
const warn = (m: string): void => { console.log(`   🟡 ${m}`) }

/**
 * 🔴 분류기가 실제로 내는 값 — voice-comment-signals.mts 의 ReactionType.
 *    pool 문서의 "금지" 에는 advice · caution · levity 도 나오지만
 *    classifyReaction 은 그 값을 반환하지 않는다. 넣어도 대조되지 않는다.
 */
const REACTION_TYPES = ['empathy', 'question', 'rebuttal', 'experience', 'information', 'other']

type FillEntry = {
  identity?: Record<string, unknown>
  voiceCore?: Record<string, unknown>
  noGoTopics?: string[]
  noGoExpressions?: string[]
  forbiddenReactionRoles?: string[]
}
type CandidateFile = { personaCode: string; text: string; sourceTexts?: string[] }

if (!existsSync(INPUT)) fail(`${INPUT} 이 없습니다.`)
const raw: unknown = JSON.parse(readFileSync(INPUT, 'utf-8'))
if (raw === null || typeof raw !== 'object') fail(`${INPUT} 이 객체가 아닙니다.`)
const fill = raw as Record<string, FillEntry>

console.log('\n══ 전제 확인 ══')

// ── ① 대상 ──
const codes = Object.keys(fill).filter((k) => !k.startsWith('_'))
const known = [...TARGETS, ...ROLE_FIX_ONLY] as readonly string[]
const extra = codes.filter((c) => !known.includes(c))
if (extra.length > 0) fail(`대상 밖 persona ${extra.length}종이 있습니다.`)
const missing = TARGETS.filter((t) => !codes.includes(t))
if (missing.length > 0) warn(`보강안 없는 대상 ${missing.length}종`)
// 🔴 roles 정리 대상에 다른 키가 섞이지 않았는가
for (const c of ROLE_FIX_ONLY) {
  const e = fill[c]
  if (e === undefined) continue
  const others = Object.keys(e).filter((k) => k !== 'forbiddenReactionRoles')
  if (others.length > 0) fail(`${c} 는 roles 정리만 허용합니다 — 키 ${others.length}개가 더 있습니다.`)
}
const fillTargets = codes.filter((c) => (TARGETS as readonly string[]).includes(c))
const fillRoleOnly = codes.filter((c) => (ROLE_FIX_ONLY as readonly string[]).includes(c))
ok(`identity 보강 ${fillTargets.length}종 · roles 정리만 ${fillRoleOnly.length}종`)

// 🔴 단독 실행에서도 DATABASE_URL 이 잡히게 한다 (--env-file 없이)
await loadEnvLocal()
const prisma = new PrismaClient()
const personas = await prisma.persona.findMany({
  select: {
    id: true, code: true, status: true, identity: true, voiceCore: true,
    noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
  },
  orderBy: { code: 'asc' },
})
const notDraft = personas.filter((p) => p.status !== 'draft')
if (notDraft.length > 0) { await prisma.$disconnect(); fail(`draft 가 아닌 persona ${notDraft.length}명 — 중단합니다.`) }
ok(`Persona ${personas.length}명 · 전부 draft`)

const byCode = new Map(personas.map((p) => [p.code, p]))

// ── ② 채움 여부 ──
console.log('\n══ 필드 채움 (🔴 값 미출력) ══')
for (const code of fillTargets) {
  const e = fill[code] ?? {}
  const cur = byCode.get(code)
  const idN = Object.keys(e.identity ?? {}).length
  const vcN = Object.keys(e.voiceCore ?? {}).length
  const before = cur?.identity === null ? 'null' : '있음'
  console.log(
    `  ${code}  identity ${before} → ${idN}필드 · voiceCore ${vcN}필드 · ` +
    `noGo ${(e.noGoTopics ?? []).length}+${(e.noGoExpressions ?? []).length} · ` +
    `roles ${(e.forbiddenReactionRoles ?? []).length}종`,
  )
}
for (const code of fillRoleOnly) {
  const cur = byCode.get(code)
  const after = fill[code]?.forbiddenReactionRoles ?? []
  console.log(
    `  ${code}  🔴 roles 정리만 — ${cur?.forbiddenReactionRoles.length ?? 0}종 → ${after.length}종 ` +
    `(identity · voiceCore · noGo 미변경)`,
  )
}

// ── ③ 위험 패턴 — 🔴 ③ 판정부를 그대로 재사용한다 ──
console.log('\n══ 위험 패턴 (③ 판정부 재사용) ══')
const risky: string[] = []
for (const code of fillTargets) {
  const e = fill[code] ?? {}
  const strings: string[] = []
  const collect = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(collect)
  }
  collect(e)
  for (const sv of strings) {
    const d = checkIdentifyingDetail(sv)
    // 🔴 걸린 값이 아니라 카테고리 코드만 남긴다
    if (d.status !== 'pass' || d.detail.includes('—')) {
      const cats = d.detail.split('—')[1]?.trim() ?? d.detail
      if (cats !== '' && !d.detail.startsWith('식별 디테일 없음')) risky.push(`${code}: ${cats}`)
    }
  }
}
if (risky.length > 0) console.log(`  🔴 검출 ${risky.length}건 — ${[...new Set(risky)].join(' / ')}`)
else ok('정확한 나이 · 지명 · 병명 · 금액 검출 0')

// ── ④ 🔴 forbiddenReactionRoles 가 분류기 값인가 ──
console.log('\n══ forbiddenReactionRoles 유효성 ══')
let deadRoles = 0
for (const code of codes) {
  const roles = fill[code]?.forbiddenReactionRoles ?? []
  const dead = roles.filter((r) => !REACTION_TYPES.includes(r))
  if (dead.length > 0) { console.log(`  🔴 ${code} 무효 ${dead.length}종: ${dead.join(' · ')}`); deadRoles += dead.length }
}
if (deadRoles === 0) ok(`보강안 전부 분류기 값 (${REACTION_TYPES.length}종 중)`)
// 🔴 기존 적재분도 함께 본다 — 이미 들어간 무효 값은 조용히 무력한 상태다
const existingDead: string[] = []
for (const p of personas) {
  const dead = p.forbiddenReactionRoles.filter((r) => !REACTION_TYPES.includes(r))
  if (dead.length > 0) existingDead.push(`${p.code} ${dead.length}종(${dead.join('·')})`)
}
if (existingDead.length > 0) {
  console.log(`  🔴 기존 적재분 무효: ${existingDead.join(' / ')} — 분류기가 내지 않아 걸리지 않는다`)
}
// 🔴 이번 보강안을 적용하면 무효가 남는가
let remainDead = 0
for (const p of personas) {
  const after = fill[p.code]?.forbiddenReactionRoles ?? p.forbiddenReactionRoles
  remainDead += after.filter((r) => !REACTION_TYPES.includes(r)).length
}
if (remainDead === 0) ok('적용 후 무효 role 0종 — DB 에 죽은 값이 남지 않는다')
else console.log(`  🔴 적용 후에도 무효 ${remainDead}종이 남는다`)

// ── ⑤ 🔴 No-Go 가 리터럴인가 ──
console.log('\n══ No-Go 형태 ══')
let literal = 0, descriptive = 0
for (const code of fillTargets) {
  const e = fill[code] ?? {}
  for (const v of [...(e.noGoTopics ?? []), ...(e.noGoExpressions ?? [])]) {
    // 🔴 판정부는 text.includes(v) 로 본다.
    //    "병원·약 언급" 같은 서술은 본문에 그대로 나올 리 없어 절대 걸리지 않는다.
    if (/[·,]|언급|단정|권유|금지|하기|화제/.test(v)) descriptive++
    else literal++
  }
}
if (descriptive > 0) console.log(`  🔴 서술형 ${descriptive}건 — text.includes() 로는 걸리지 않는다`)
ok(`리터럴 ${literal}건 · 서술형 ${descriptive}건`)

// ── ⑥ Gate ⑦ 변화 측정 ──
console.log('\n══ Gate ⑦ 변화 (후보 재판정) ══')
if (!existsSync(CANDIDATES)) {
  warn(`${CANDIDATES} 이 없어 ⑦ 변화를 측정하지 못했습니다`)
} else {
  const cands = JSON.parse(readFileSync(CANDIDATES, 'utf-8')) as CandidateFile[]
  const judge = (applyFill: boolean): Map<string, number> => {
    const dist = new Map<string, number>()
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
      const g = checkCommentCandidate(input).gates.find((x) => x.gate === '⑦')
      const k = g?.outcome ?? '?'
      dist.set(k, (dist.get(k) ?? 0) + 1)
    }
    return dist
  }
  const fmt = (m: Map<string, number>): string =>
    [...m.entries()].sort().map(([k, n]) => `${k} ${n}`).join(' · ')
  const before = judge(false)
  const after = judge(true)
  console.log(`  적용 전  ${fmt(before)}`)
  console.log(`  적용 후  ${fmt(after)}`)
  const bn = before.get('notRun') ?? 0
  const an = after.get('notRun') ?? 0
  if (an < bn) ok(`notRun ${bn} → ${an}건 (실제 판정 ${bn - an}건 증가)`)
  else warn(`notRun 이 줄지 않았습니다 (${bn} → ${an})`)
}

// ── ⑦ 🔴 "돈다" 와 "잡는다" 는 다르다 ──
//    후보가 전부 pass 여도 판정부가 무력한 것인지 알 수 없다.
//    보강안 설정과 어긋나는 **합성 문장**을 넣어 실제로 잡히는지 본다.
//    🔴 문장은 전부 합성이고, 출력은 검출 코드뿐이다.
console.log('\n══ ⑦ 모순 검출 (합성 문장) ══')
const PROBES: Array<{ code: string; text: string; expect: string }> = [
  { code: 'P15', text: '우리 애들은 다 컸어요', expect: 'CHILD_CONFLICT' },
  { code: 'P10', text: '남편이 요즘 자꾸 그래요', expect: 'SPOUSE_CONFLICT' },
  { code: 'P17', text: '우리 때는 다 그러고 살았죠', expect: 'NO_GO' },
  { code: 'P07', text: '우리 딸도 그 병원 다녀왔어요', expect: 'FAMILY_PROXY' },
]
let caught = 0
for (const probe of PROBES) {
  const e = fill[probe.code] ?? {}
  const v = checkCommentCandidate({
    personaCode: probe.code,
    text: probe.text,
    sourceTexts: ['합성 원문입니다'],
    identity: (e.identity ?? null) as CandidateInput['identity'],
    noGoTopics: e.noGoTopics ?? [],
    noGoExpressions: e.noGoExpressions ?? [],
  })
  const g = v.gates.find((x) => x.gate === '⑦')
  const hit = g?.outcome === 'regenerate' && (g.detail.includes(probe.expect))
  if (hit) caught++
  console.log(`  ${hit ? '✅' : '🔴'} ${probe.code}  ${probe.expect.padEnd(17)} → ${g?.outcome}`)
}
if (caught === PROBES.length) ok(`합성 모순 ${caught}/${PROBES.length}건 검출 — 판정부가 실제로 돈다`)
else console.log(`  🔴 ${PROBES.length - caught}건 미검출 — 채웠지만 잡지 못한다`)

await prisma.$disconnect()
console.log('\n🟡 dry-run 입니다. DB write 0 · --apply 없음 · status 변경 없음.\n')
