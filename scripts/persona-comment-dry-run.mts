#!/usr/bin/env tsx
/**
 * 페르소나 댓글 후보 dry-run — 🔴 DB write 0 · 발행 없음
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *       전략 §4-1 — 1단계는 자동화를 막는 것이 아니라 조건을 수집하는 구간이다
 *
 * 사용법
 *   npx tsx scripts/persona-comment-dry-run.mts            # tmp/persona-comment-candidates.json
 *   npx tsx scripts/persona-comment-dry-run.mts --out      # 결과를 tmp 파일로도 저장
 *
 * 🔴 --apply 가 없다. 이 도구는 발행 경로를 갖지 않는다.
 *    Gate 통과는 발행이 아니라 "승인 대기열에 갈 자격" 이다(Gate §1).
 *    지금은 대기열도 없으므로 결과를 보여주고 끝난다.
 *
 * 🔴 후보 텍스트를 이 파일에 하드코딩하지 않는다.
 *    tmp/persona-comment-candidates.json (gitignored) 에서 읽는다.
 *
 * 🔴 출력에 담지 않는 것
 *      후보 본문 전문 · source 원문 · 댓글 원문 ·
 *      닉네임 · author 원문 · sourceUrl · sourceRef
 *    판정 결과는 관문 코드 · 개수 · 태그로만 낸다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      LLM 호출 (생성) · DB write · 발행 · status 전환 · personaId 채우기
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import {
  checkCommentCandidate, summarizeCandidates,
  type CandidateInput, type CandidateVerdict,
} from './lib/persona-comment-candidate.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WRITE_OUT = process.argv.includes('--out')
const INPUT_PATH = 'tmp/persona-comment-candidates.json'
const OUTPUT_PATH = 'tmp/persona-comment-verdicts.json'

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string) => console.log(`   ✅ ${m}`)

/** 입력 한 건 — 🔴 sourceRef · sourceUrl 을 받지 않는다 */
type CandidateFile = {
  personaCode: string
  text: string
  sourceTexts?: string[]
  adviceForbidden?: boolean
  sourceIsCafeOperational?: boolean
}

/** 🔴 본문을 그대로 찍지 않는다 — 첫 글자 + 길이만 */
const maskText = (s: string): string => {
  const c = [...s.trim()]
  if (c.length === 0) return '(빈 후보)'
  return `${c[0]}… (${c.length}자)`
}

await loadEnvLocal()
const prisma = new PrismaClient()

// ── 전제 확인 — 🔴 이 도구는 draft 상태에서만 돈다 ──
console.log('══ 전제 확인 ══')
const personas = await prisma.persona.findMany({
  select: {
    code: true, status: true, forbiddenReactionRoles: true,
    user: { select: { nickname: true, name: true } },
  },
  orderBy: { code: 'asc' },
})
if (personas.length === 0) { await prisma.$disconnect(); fail('Persona 가 없습니다.') }
ok(`Persona ${personas.length}명`)

const notDraft = personas.filter((p) => p.status !== 'draft')
if (notDraft.length > 0) {
  // 🔴 active 가 섞여 있으면 이 도구를 쓰지 않는다 — 발행 경로가 열린 뒤의 검증은 다르다
  await prisma.$disconnect()
  fail(`draft 가 아닌 페르소나가 있습니다: ${notDraft.map((p) => p.code).join(', ')}`)
}
ok('전부 status=draft')

const killSwitch = await prisma.personaGlobalSwitch.findFirst({ orderBy: { changedAt: 'desc' } })
if (killSwitch?.enabled === true) { await prisma.$disconnect(); fail('전체 중지 스위치가 켜져 있습니다.') }
ok(`전체 중지 스위치 ${killSwitch === null ? '꺼짐 (미생성)' : '꺼짐'}`)

const linkedPosts = await prisma.post.count({ where: { personaId: { not: null } } })
const linkedComments = await prisma.comment.count({ where: { personaId: { not: null } } })
if (linkedPosts !== 0 || linkedComments !== 0) {
  await prisma.$disconnect()
  fail(`이미 발행물이 있습니다: Post ${linkedPosts} · Comment ${linkedComments}`)
}
ok('Post/Comment.personaId 전부 NULL')

// ── ⑥-A 대조 집합 — 회원 표시명. 🔴 값을 출력하지 않는다 ──
const users = await prisma.user.findMany({ select: { nickname: true, name: true } })
const knownNames = users
  .flatMap((u) => [u.nickname, u.name])
  .filter((v): v is string => v !== null && v.trim() !== '')
ok(`⑥-A 대조 집합 ${knownNames.length}건 (회원 표시명)`)

// ── 후보 파일 ──
if (!existsSync(INPUT_PATH)) {
  await prisma.$disconnect()
  fail(
    `${INPUT_PATH} 이 없습니다.\n` +
    `   [{"personaCode":"P05","text":"…","sourceTexts":["…"]}] 형식으로 두세요 (tmp/ 는 gitignored).`,
  )
}
function readInput(): CandidateFile[] | { error: string } {
  try {
    const parsed: unknown = JSON.parse(readFileSync(INPUT_PATH, 'utf-8'))
    if (!Array.isArray(parsed)) return { error: '배열이어야 합니다.' }
    return parsed as CandidateFile[]
  } catch (e) { return { error: (e as Error).message } }
}
const parsedInput = readInput()
let candidates: CandidateFile[] = []
if (Array.isArray(parsedInput)) {
  candidates = parsedInput
} else {
  await prisma.$disconnect()
  fail(`${INPUT_PATH} 을 읽을 수 없습니다: ${parsedInput.error}`)
}

const codes = new Set(personas.map((p) => p.code))
const unknown = candidates.filter((c) => !codes.has(c.personaCode))
if (unknown.length > 0) { await prisma.$disconnect(); fail(`알 수 없는 personaCode ${unknown.length}건`) }
ok(`후보 ${candidates.length}건`)

// ── 판정 ──
const roleByCode = new Map(personas.map((p) => [p.code, p.forbiddenReactionRoles]))
const verdicts: CandidateVerdict[] = candidates.map((c) => {
  const input: CandidateInput = {
    personaCode: c.personaCode,
    text: c.text,
    sourceTexts: c.sourceTexts ?? [],
    knownNames,
    forbiddenRoles: roleByCode.get(c.personaCode) ?? [],
    ...(c.adviceForbidden !== undefined ? { adviceForbidden: c.adviceForbidden } : {}),
    ...(c.sourceIsCafeOperational !== undefined
      ? { sourceIsCafeOperational: c.sourceIsCafeOperational }
      : {}),
  }
  return checkCommentCandidate(input)
})

// ── 출력 — 🔴 본문 전문 없음 ──
console.log('\n══ 후보별 판정 ══')
for (const [i, v] of verdicts.entries()) {
  const mark = v.status === 'pass' ? '✅' : v.status === 'review' ? '🟡' : '🔴'
  console.log(
    `  ${mark} #${String(i + 1).padStart(2)}  ${v.personaCode}  ${maskText(candidates[i].text)}` +
    `  ${v.reactionType.padEnd(11)} ${v.status}`,
  )
  const failedGates = v.gates.filter((g) => g.outcome !== 'pass' && g.outcome !== 'notRun')
  if (failedGates.length > 0) {
    for (const g of failedGates) console.log(`        ${g.gate} ${g.outcome} — ${g.detail}`)
  }
  if (v.aiToneTags.length > 0) console.log(`        AI 티: ${v.aiToneTags.join(' · ')}`)
}

const s = summarizeCandidates(verdicts)
console.log('\n══ 집계 ══')
console.log(`  총 ${s.total}건`)
for (const k of ['pass', 'review', 'regenerate', 'reject'] as const) {
  console.log(`    ${k.padEnd(11)} ${s.byStatus[k]}`)
}
console.log(`  🔴 source leak (①)  ${s.sourceLeak}건`)
console.log('  반응 유형:', Object.entries(s.byReaction).map(([k, n]) => `${k} ${n}`).join(' · ') || '—')
console.log('  AI 티 태그:', Object.entries(s.tagCounts).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음')

const notRunGates = verdicts[0]?.gates.filter((g) => g.outcome === 'notRun').map((g) => g.gate) ?? []
console.log(`\n  🔴 미실행 관문: ${notRunGates.join(' ')} — 코퍼스 · identity 판정부가 필요하다`)
console.log('     "돌지 않았다" 를 pass 로 보고하지 않는다')

if (WRITE_OUT) {
  mkdirSync('tmp', { recursive: true })
  // 🔴 저장본에도 본문을 넣지 않는다
  writeFileSync(OUTPUT_PATH, JSON.stringify(verdicts, null, 2) + '\n', 'utf-8')
  console.log(`\n  판정 결과 저장: ${OUTPUT_PATH} (gitignored · 본문 미포함)`)
}

console.log('\n🟡 dry-run 입니다. DB write 0 · 발행 없음 · 승인 대기열 없음.\n')
await prisma.$disconnect()
