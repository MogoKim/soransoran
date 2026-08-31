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
import pg from 'pg'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadUnaoReadonlyUrl } from './lib/voice-unao-readonly.mjs'
import { normalizeN2 } from './lib/persona-gate-name-collision.mjs'
import type { FrequencyLookup } from './lib/persona-gate-234.mjs'
import {
  checkCommentCandidate, summarizeCandidates,
  type CandidateInput, type CandidateVerdict,
} from './lib/persona-comment-candidate.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WRITE_OUT = process.argv.includes('--out')
/**
 * 🔴 --enqueue 없이는 DB write 가 0 이다. 기본은 지금까지와 같은 read-only dry-run.
 */
const ENQUEUE = process.argv.includes('--enqueue')
const INPUT_PATH = 'tmp/persona-comment-candidates.json'
const OUTPUT_PATH = 'tmp/persona-comment-verdicts.json'

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string) => console.log(`   ✅ ${m}`)

/** 입력 한 건 — 🔴 sourceRef · sourceUrl 을 받지 않는다 */
type CandidateFile = {
  personaCode: string
  text: string
  sourceTexts?: string[]
  /**
   * 🔴 ⑧ seed 재사용 축의 식별자. 원댓글 seed 하나를 가리킨다.
   *    없으면 그 축은 notRun 이다 — sourceTexts 로 대신 세지 않는다(아래 이유).
   */
  seedRef?: string
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
    id: true, code: true, status: true, forbiddenReactionRoles: true,
    // 🔴 ⑦ 대조 근거 — 없으면 설정 모순은 notRun 이다
    identity: true, noGoTopics: true, noGoExpressions: true,
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

// ── ② 댓글 코퍼스 빈도 조회 ──
//    🔴 댓글 생성물은 **댓글 코퍼스**로 잰다(§3-②).
//       본문 코퍼스로 재면 "고생하셨어요"(댓글 69건 · 본문 0건)가 고유 표현이 된다.
//    🔴 원문을 저장하지 않는다. 조회할 때만 읽고, 빈도 표만 메모리에 남긴다.
const unaoUrl = (() => {
  try { return loadUnaoReadonlyUrl() } catch { return null }
})()

let lookup: FrequencyLookup | undefined
let corpusName = 'comment'
let corpusSize = 0

if (unaoUrl === null) {
  console.log('   🟡 우나어 read-only 접속 정보 없음 — ② 는 notRun 이 된다')
} else {
  const unao = new pg.Client({ connectionString: unaoUrl, ssl: { rejectUnauthorized: false } })
  await unao.connect()
  const { rows } = await unao.query<{ topComments: unknown }>(
    'SELECT "topComments" FROM "CafePost" WHERE "topComments" IS NOT NULL LIMIT 3000',
  )
  await unao.end()

  // 🔴 본문만 모은다. author 는 읽지 않는다 (학습 추출과 같은 원칙)
  const bodies: string[] = []
  for (const r of rows) {
    let arr: unknown = r.topComments
    if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { continue } }
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (item === null || typeof item !== 'object') continue
      const body = (item as Record<string, unknown>).content
      if (typeof body === 'string' && body.trim() !== '') bodies.push(body.replace(/\s+/g, ''))
    }
  }
  corpusSize = bodies.length
  // 🔴 substring 카운트다. 사전을 미리 만들지 않는다 —
  //    후보마다 검사할 n-gram 이 수십 개뿐이라 그때 세는 편이 싸다
  lookup = (ngram: string): number => {
    let n = 0
    for (const b of bodies) if (b.includes(ngram)) { n++; if (n > 6) break }
    return n
  }
  ok(`② 댓글 코퍼스 ${corpusSize}건 (원문 미저장 · 빈도 조회만)`)
}

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

// 🔴 sourceTexts 없이는 ① 20자 유출 검사가 성립하지 않는다.
//    비워 두면 "검사 불가" 인데 통과처럼 보인다 — 입력 단계에서 막는다.
const noSource = candidates
  .map((c, i) => ({ i, has: (c.sourceTexts ?? []).some((t) => t.trim() !== '') }))
  .filter((x) => !x.has)
if (noSource.length > 0) {
  await prisma.$disconnect()
  fail(
    `sourceTexts 가 비어 있는 후보 ${noSource.length}건 (#${noSource.map((x) => x.i + 1).join(', #')}).\n` +
    `   🔴 ① 20자 유출 검사가 성립하지 않습니다. 후보마다 원문/원댓글을 1개 이상 넣으세요.`,
  )
}
ok(`후보 ${candidates.length}건 · 전부 sourceTexts 보유`)

// ── ⑦ 대조 집합 — 🔴 값이 아니라 보유 여부만 센다 ──
const withIdentity = personas.filter((p) => p.identity !== null).length
const withNoGo = personas.filter((p) => p.noGoTopics.length + p.noGoExpressions.length > 0).length
if (withIdentity === personas.length) ok(`⑦ identity ${withIdentity}/${personas.length}명`)
else console.log(`   🟡 ⑦ identity ${withIdentity}/${personas.length}명 — 나머지는 설정 모순 notRun`)
if (withNoGo > 0) ok(`⑦ No-Go 보유 ${withNoGo}/${personas.length}명`)
else console.log(`   🟡 ⑦ No-Go 0명 — No-Go 축 미실행`)

// ── ⑧ 대조 발화 — 발행물 + 같은 배치의 앞선 후보 ──
//    🔴 발행물은 지금 0건이다. 조회를 넣어 두는 것은 통계를 부풀리려는 게 아니라,
//    발행이 시작되면 그 즉시 대조 집합이 되기 때문이다.
const idToCode = new Map(personas.map((p) => [p.id, p.code]))
const priorByCode = new Map<string, string[]>(personas.map((p) => [p.code, []]))
const priorRows = await prisma.comment.findMany({
  where: { personaId: { not: null } },
  select: { personaId: true, content: true },
  orderBy: { createdAt: 'desc' },
  take: 200,
})
for (const c of priorRows) {
  const code = idToCode.get(c.personaId ?? '')
  if (code !== undefined) priorByCode.get(code)?.push(c.content)
}
ok(`⑧ 대조 발화 ${priorRows.length}건 (발행물) + 같은 배치의 앞선 후보`)

// ── ⑧ seed 사용 이력 — 🔴 persona 단위가 아니라 전체 단위 (§3-⑧) ──
//    🔴 sourceTexts 를 seed 식별자로 쓰지 않는다.
//       sourceTexts 는 "원문 본문 · 원댓글" 이라 **같은 글에 달린 댓글이면 원래 같다.**
//       그것을 재사용으로 세면 한 글에 여러 페르소나가 댓글 다는 정상 동작이
//       전부 regenerate 가 된다 — 실제로 그렇게 만들었다가 8건 중 7건이 걸렸다.
//    §3-⑧ 이 말하는 것은 "같은 source **comment** seed 의 반복 배분" 이다.
//    후보 파일이 seedRef 를 주면 그때 센다. 없으면 그 축은 notRun 이다.
const seedUse = new Map<string, number>()
for (const c of candidates) {
  const ref = (c.seedRef ?? '').trim()
  if (ref === '') continue
  seedUse.set(ref, (seedUse.get(ref) ?? 0) + 1)
}
const withSeedRef = candidates.filter((c) => (c.seedRef ?? '').trim() !== '').length
if (withSeedRef === 0) {
  console.log('   🟡 ⑧ seed 재사용 축 미실행 — 후보에 seedRef 가 없다')
} else {
  const reused = [...seedUse.values()].filter((n) => n >= 2).length
  ok(`⑧ seedRef ${withSeedRef}/${candidates.length}건 · seed ${seedUse.size}종 · 2회 이상 ${reused}종`)
}

// ── 판정 ──
const byCode = new Map(personas.map((p) => [p.code, p]))
// 🔴 map 이 아니라 순차 루프다 — 같은 배치의 앞선 후보가 다음 후보의 대조 집합이 된다.
//    "세 페르소나가 나란히 같은 맞장구를 쓰면 기계다"(§3-⑧) 를 보려면 순서가 있어야 한다.
const verdicts: CandidateVerdict[] = []
for (const c of candidates) {
  const persona = byCode.get(c.personaCode)
  const prior = priorByCode.get(c.personaCode) ?? []
  const input: CandidateInput = {
    personaCode: c.personaCode,
    text: c.text,
    sourceTexts: c.sourceTexts ?? [],
    knownNames,
    forbiddenRoles: persona?.forbiddenReactionRoles ?? [],
    identity: (persona?.identity ?? null) as CandidateInput['identity'],
    noGoTopics: persona?.noGoTopics ?? [],
    noGoExpressions: persona?.noGoExpressions ?? [],
    priorTexts: [...prior],
    ...((c.seedRef ?? '').trim() !== ''
      ? { seedUseCount: seedUse.get((c.seedRef ?? '').trim()) ?? 1 }
      : {}),
    ...(c.adviceForbidden !== undefined ? { adviceForbidden: c.adviceForbidden } : {}),
    ...(c.sourceIsCafeOperational !== undefined
      ? { sourceIsCafeOperational: c.sourceIsCafeOperational }
      : {}),
    ...(lookup !== undefined ? { frequencyLookup: lookup, corpusName } : {}),
  }
  verdicts.push(checkCommentCandidate(input))
  prior.push(c.text)
}

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

// 🔴 첫 후보만 보고 판단하지 않는다 — 후보마다 대조 집합이 달라 notRun 도 다르다.
//    (identity 가 있는 persona 와 없는 persona 가 한 배치에 섞인다)
const notRunCount = new Map<string, number>()
for (const v of verdicts) {
  for (const g of v.gates) {
    if (g.outcome === 'notRun') notRunCount.set(g.gate, (notRunCount.get(g.gate) ?? 0) + 1)
  }
}
const notRunLine = [...notRunCount.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([gate, n]) => `${gate} ${n}/${verdicts.length}건`)
  .join(' · ')
console.log(`\n  🔴 미실행 관문: ${notRunLine === '' ? '없음' : notRunLine}`)
console.log('     판정부는 있고 대조 집합이 없다 — "돌지 않았다" 를 pass 로 보고하지 않는다')

// ══ 승인 대기열 적재 (--enqueue) ═══════════════════
//
// 🔴 **정책 — 무엇을 대기열에 넣는가**
//    pass · review 만 넣는다. regenerate · reject 는 넣지 않는다.
//
//    대기열은 "사람이 읽고 결정할 것" 의 집합이다(Architecture §13).
//    regenerate 는 "다시 만들어라" 이지 "사람이 판단하라" 가 아니다.
//    그것까지 PENDING 으로 넣으면 대기열이 재생성 대상으로 오염되고,
//    PENDING 수가 실제 검토 부담을 나타내지 못한다 —
//    🔴 대기열은 계측 장치다(§15). 분모가 틀리면 계측이 무의미하다.
//
//    regenerate 통계는 이 dry-run 의 집계로 이미 남는다. DB 에 쌓을 이유가 없다.
if (ENQUEUE) {
  console.log('\n══ 승인 대기열 적재 (--enqueue) ══')

  // 🔴 테이블이 없으면 조용히 넘어가지 않는다
  const tableRows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'PersonaApprovalQueue'`
  if (Number(tableRows[0]?.n ?? 0) === 0) {
    await prisma.$disconnect()
    fail('PersonaApprovalQueue 테이블이 없습니다. 0018 migration 을 먼저 적용하세요.')
  }

  const personaIdByCode = new Map(personas.map((p) => [p.code, p.id]))
  // 🔴 중복 적재 방지 — persona + 정규화 본문. 같은 후보를 두 번 넣지 않는다
  const dedupKeyOf = (personaId: string, text: string): string =>
    createHash('sha256').update(`${personaId}::${normalizeN2(text)}`).digest('hex').slice(0, 32)

  let queued = 0
  let skippedGate = 0
  let skippedDup = 0
  for (const [i, v] of verdicts.entries()) {
    const c = candidates[i]
    if (c === undefined) continue
    // 🔴 대기열에 들어가는 것은 pass · review 뿐이다
    if (v.status !== 'pass' && v.status !== 'review') { skippedGate++; continue }
    const personaId = personaIdByCode.get(v.personaCode)
    if (personaId === undefined) { skippedGate++; continue }
    const dedupKey = dedupKeyOf(personaId, c.text)
    const exists = await prisma.personaApprovalQueue.findUnique({ where: { dedupKey }, select: { id: true } })
    if (exists !== null) { skippedDup++; continue }
    await prisma.personaApprovalQueue.create({
      data: {
        personaId,
        status: 'PENDING',
        candidateText: c.text,
        reactionType: v.reactionType,
        gateStatus: v.status,
        // 🔴 관문 코드 · 결과 · 근거 문구만. 원문 조각은 판정부가 이미 걸러 둔다
        gateResults: v.gates as unknown as object,
        aiToneTags: [...v.aiToneTags],
        // 🔴 sourceTexts 는 저장하지 않는다. storyRefs 참조만 둔다
        storyRefs: [],
        topicTags: [],
        ...((c.seedRef ?? '').trim() !== '' ? { seedRef: (c.seedRef ?? '').trim() } : {}),
        dedupKey,
      },
    })
    queued++
  }
  ok(`적재 ${queued}건 · Gate 미통과 제외 ${skippedGate}건 · 중복 ${skippedDup}건`)
  const total = await prisma.personaApprovalQueue.count()
  const pending = await prisma.personaApprovalQueue.count({ where: { status: 'PENDING' } })
  ok(`대기열 총 ${total}건 · PENDING ${pending}건`)
}

if (WRITE_OUT) {
  mkdirSync('tmp', { recursive: true })
  // 🔴 저장본에도 본문을 넣지 않는다
  writeFileSync(OUTPUT_PATH, JSON.stringify(verdicts, null, 2) + '\n', 'utf-8')
  console.log(`\n  판정 결과 저장: ${OUTPUT_PATH} (gitignored · 본문 미포함)`)
}

console.log(
  ENQUEUE
    ? '\n🟡 대기열 적재만 했습니다. 발행 0 · LLM 0 · active 전환 0 · Post/Comment 변경 0.\n'
    : '\n🟡 dry-run 입니다. DB write 0 · 발행 없음 · 적재하려면 --enqueue 를 붙이세요.\n',
)
await prisma.$disconnect()
