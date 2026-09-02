#!/usr/bin/env tsx
/**
 * 오리지널 초안 결정 규칙 fixture — 🔴 DB · 세션 · 네트워크 · LLM 없음
 *
 * 🔴 규칙을 스크립트 안에 두면 DB 없이는 검증할 수 없다.
 *    순수 함수로 빼 두었기 때문에 전이표를 **전수로** 확인할 수 있다.
 *
 * 실행: npx tsx scripts/original-post-decision-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planDecision, canDecide, buildEditDiff,
  isDeclineReasonCode, isDecidedBy,
  DECLINE_REASONS, DECIDED_BY_VALUES, MAX_EDIT_NOTE_CHARS,
  ORIGINAL_POST_STATUSES, ORIGINAL_POST_DECISIONS,
  type OriginalPostStatus, type OriginalPostDecision, type EditedDraft,
} from '../src/lib/original-post-decision'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'original-post-decide.mts')
const RULES = join(HERE, '..', 'src', 'lib', 'original-post-decision.ts')

let passed = 0
let failed = 0
const ok = (name: string, detail: string): void => {
  passed += 1
  console.log(`  ✅ ${name} — ${detail}`)
}
const bad = (name: string, detail: string): void => {
  failed += 1
  console.log(`  🔴 ${name} — ${detail}`)
}

const ALL = [...ORIGINAL_POST_STATUSES] as OriginalPostStatus[]
const DECISIONS = [...ORIGINAL_POST_DECISIONS] as OriginalPostDecision[]

const DRAFT_TITLE = '초안 제목입니다'
const DRAFT_BODY = '초안 본문입니다. 두 문장쯤 됩니다.'
const EDITED: EditedDraft = { title: '고친 제목입니다', body: '고친 본문입니다. 조금 늘렸습니다.', note: '제목이 밋밋해서' }

/** 결정별로 필요한 인자만 붙인다 — 섞어 넣으면 규칙 ③ 에 걸려 시험이 무의미해진다 */
const mk = (
  status: OriginalPostStatus,
  decision: OriginalPostDecision,
  createdPostId: string | null = null,
) => planDecision({
  status, createdPostId, draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY, decision,
  ...(decision === 'decline' ? { declineReason: 'OTHER' } : {}),
  ...(decision === 'edit' ? { edited: EDITED } : {}),
})

console.log('\n══ 오리지널 초안 결정 규칙 fixture ══\n')

// ── ① 🔴 PENDING 만 결정할 수 있다 (전수) ──
{
  const offenders: string[] = []
  for (const st of ALL) {
    const expected = st === 'PENDING'
    if (canDecide(st) !== expected) offenders.push(`canDecide(${st})=${canDecide(st)}`)
    for (const d of DECISIONS) {
      const plan = mk(st, d)
      if (expected && !plan.ok) offenders.push(`${st}/${d} 거부됨 (${plan.error})`)
      if (!expected && plan.ok) offenders.push(`🔴 ${st}/${d} 통과됨`)
    }
  }
  if (offenders.length) bad('PENDING 만 결정 가능', offenders.join(' / '))
  else ok('PENDING 만 결정 가능', `${ALL.length}개 상태 × ${DECISIONS.length}개 결정 = ${ALL.length * DECISIONS.length}종 전수`)
}

// ── ② 🔴 createdPostId 가 있으면 status 와 무관하게 거부 ──
{
  const offenders: string[] = []
  for (const st of ALL) {
    for (const d of DECISIONS) {
      const plan = mk(st, d, 'post_abc123')
      if (plan.ok) offenders.push(`🔴 ${st}/${d} 통과됨`)
    }
  }
  // 🔴 공백만 든 값은 "없음" 으로 본다 — 있는 척하는 빈 문자열에 막히면 정상 건이 멈춘다
  const blank = planDecision({
    status: 'PENDING', createdPostId: '   ', draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY,
    decision: 'approve',
  })
  if (!blank.ok) offenders.push('공백 createdPostId 에 막힘')
  if (offenders.length) bad('발행된 것은 건드리지 않는다', offenders.join(' / '))
  else ok('발행된 것은 건드리지 않는다', `${ALL.length}개 상태 × ${DECISIONS.length}개 결정 전수 거부 · PENDING 도 거부`)
}

// ── ③ 전이 결과 ──
{
  const offenders: string[] = []
  const a = mk('PENDING', 'approve')
  if (!a.ok || a.nextStatus !== 'APPROVED') offenders.push(`승인=${a.ok ? a.nextStatus : a.error}`)
  if (a.ok && a.declineReason !== null) offenders.push('승인인데 사유가 남음')
  if (a.ok && a.edited !== null) offenders.push('승인인데 수정본이 남음')

  const d = mk('PENDING', 'decline')
  if (!d.ok || d.nextStatus !== 'DECLINED') offenders.push(`폐기=${d.ok ? d.nextStatus : d.error}`)
  if (d.ok && d.declineReason !== 'OTHER') offenders.push('폐기 사유 미기록')

  const e = mk('PENDING', 'edit')
  if (!e.ok || e.nextStatus !== 'EDITED') offenders.push(`수정=${e.ok ? e.nextStatus : e.error}`)
  if (e.ok && (e.edited === null || e.editDiff === null)) offenders.push('수정본 · editDiff 미기록')
  if (e.ok && e.declineReason !== null) offenders.push('수정인데 사유가 남음')

  if (offenders.length) bad('전이 결과', offenders.join(' / '))
  else ok('전이 결과', 'approve → APPROVED · decline → DECLINED · edit → EDITED')
}

// ── ④ 🔴 PUBLISHED · EXPIRED 로 가는 경로가 없다 ──
{
  const reachable = new Set<string>()
  for (const st of ALL) {
    for (const d of DECISIONS) {
      const plan = mk(st, d)
      if (plan.ok) reachable.add(plan.nextStatus)
    }
  }
  const forbidden = [...reachable].filter((s) => !['APPROVED', 'DECLINED', 'EDITED'].includes(s))
  if (forbidden.length > 0) bad('PUBLISHED · EXPIRED 도달 불가', `🔴 도달 가능: ${forbidden.join(' · ')}`)
  else ok('PUBLISHED · EXPIRED 도달 불가', `도달 가능한 상태는 ${[...reachable].sort().join(' · ')} 뿐`)
}

// ── ⑤ 🔴 폐기 사유는 코드여야 한다 ──
{
  const offenders: string[] = []
  const base = { status: 'PENDING' as const, createdPostId: null, draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY, decision: 'decline' as const }
  if (planDecision({ ...base }).ok) offenders.push('🔴 사유 없이 폐기됨')
  if (planDecision({ ...base, declineReason: '   ' }).ok) offenders.push('🔴 공백 사유로 폐기됨')
  // 🔴 자유 텍스트를 허용하면 집계가 무너진다
  if (planDecision({ ...base, declineReason: '그냥 별로여서' }).ok) offenders.push('🔴 자유 텍스트가 통과됨')
  // 🔴 persona 전용 코드가 흘러들어오면 안 된다 — 저쪽은 댓글용이다
  if (planDecision({ ...base, declineReason: 'CONTEXT_MISMATCH' }).ok) offenders.push('🔴 persona 코드가 통과됨')
  for (const r of DECLINE_REASONS) {
    if (!planDecision({ ...base, declineReason: r.code }).ok) offenders.push(`${r.code} 거부됨`)
  }
  if (isDeclineReasonCode('NOPE') || !isDeclineReasonCode('OTHER')) offenders.push('코드 판별이 잘못됨')
  if (new Set(DECLINE_REASONS.map((r) => r.code)).size !== DECLINE_REASONS.length) offenders.push('코드 중복')

  if (offenders.length) bad('폐기 사유는 코드', offenders.join(' / '))
  else ok('폐기 사유는 코드', `${DECLINE_REASONS.length}종 허용 · 자유 텍스트 · persona 코드 거부`)
}

// ── ⑥ 🔴 결정자는 목록 안의 값이어야 한다 ──
{
  const offenders: string[] = []
  for (const v of DECIDED_BY_VALUES) if (!isDecidedBy(v)) offenders.push(`${v} 거부됨`)
  for (const v of ['Founder', 'founder ', '', 'operator', 'claude']) {
    if (isDecidedBy(v)) offenders.push(`🔴 "${v}" 통과됨`)
  }
  if (offenders.length) bad('결정자는 목록 값', offenders.join(' / '))
  else ok('결정자는 목록 값', `${DECIDED_BY_VALUES.join(' · ')} 만 허용 · 대소문자 · 공백 변형 거부`)
}

// ── ⑦ 수정본 검증 ──
{
  const offenders: string[] = []
  const base = { status: 'PENDING' as const, createdPostId: null, draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY, decision: 'edit' as const }
  const tryEdit = (edited: EditedDraft | null) => planDecision({ ...base, edited })

  if (tryEdit(null).ok) offenders.push('🔴 수정본 없이 통과')
  if (tryEdit({ ...EDITED, title: '  ' }).ok) offenders.push('🔴 빈 제목 통과')
  if (tryEdit({ ...EDITED, body: '' }).ok) offenders.push('🔴 빈 본문 통과')
  // 🔴 무엇을 왜 고쳤나가 수정 승인의 값어치다
  if (tryEdit({ ...EDITED, note: '   ' }).ok) offenders.push('🔴 note 없이 통과')
  if (tryEdit({ ...EDITED, note: 'ㅁ'.repeat(MAX_EDIT_NOTE_CHARS + 1) }).ok) offenders.push('🔴 상한 넘는 note 통과')
  if (!tryEdit({ ...EDITED, note: 'ㅁ'.repeat(MAX_EDIT_NOTE_CHARS) }).ok) offenders.push('상한 딱 맞는 note 거부됨')
  // 🔴 고치지 않았는데 EDITED 로 남기면 이력이 거짓이 된다
  if (tryEdit({ title: DRAFT_TITLE, body: DRAFT_BODY, note: '안 고쳤다' }).ok) offenders.push('🔴 초안과 같은데 통과')
  // 제목만 고친 것은 정상이다
  if (!tryEdit({ title: '다른 제목', body: DRAFT_BODY, note: '제목만' }).ok) offenders.push('제목만 고친 것이 거부됨')

  if (offenders.length) bad('수정본 검증', offenders.join(' / '))
  else ok('수정본 검증', '빈 제목 · 빈 본문 · note 없음 · note 초과 · 무변경 거부')
}

// ── ⑧ 인자가 결정과 섞이면 거부 ──
{
  const offenders: string[] = []
  const b = { status: 'PENDING' as const, createdPostId: null, draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY }
  if (planDecision({ ...b, decision: 'approve', declineReason: 'OTHER' }).ok) offenders.push('🔴 승인 + 폐기사유 통과')
  if (planDecision({ ...b, decision: 'approve', edited: EDITED }).ok) offenders.push('🔴 승인 + 수정본 통과')
  if (planDecision({ ...b, decision: 'decline', declineReason: 'OTHER', edited: EDITED }).ok) offenders.push('🔴 폐기 + 수정본 통과')
  if (planDecision({ ...b, decision: 'edit', edited: EDITED, declineReason: 'OTHER' }).ok) offenders.push('🔴 수정 + 폐기사유 통과')
  if (offenders.length) bad('인자 혼선 거부', offenders.join(' / '))
  else ok('인자 혼선 거부', '승인+사유 · 승인+수정본 · 폐기+수정본 · 수정+사유 모두 거부')
}

// ── ⑨ 🔴 editDiff 에 본문이 없다 ──
{
  const diff = buildEditDiff(DRAFT_TITLE, DRAFT_BODY, EDITED)
  const offenders: string[] = []
  const keys = Object.keys(diff).sort()
  const want = ['bodyChanged', 'charDelta', 'note', 'titleChanged']
  if (keys.join(',') !== want.join(',')) offenders.push(`키가 다르다: ${keys.join(' · ')}`)
  const serialized = JSON.stringify(diff)
  // 🔴 본문 · 초안 전문이 diff 에 실리면 원장이 두 벌이 된다
  if (serialized.includes(DRAFT_BODY)) offenders.push('🔴 초안 본문이 들어 있다')
  if (serialized.includes(EDITED.body)) offenders.push('🔴 수정본 본문이 들어 있다')
  if (serialized.includes(DRAFT_TITLE) || serialized.includes(EDITED.title)) offenders.push('🔴 제목이 들어 있다')
  if (diff.titleChanged !== true || diff.bodyChanged !== true) offenders.push('변경 감지 실패')
  const delta = [...EDITED.body].length - [...DRAFT_BODY].length
  if (diff.charDelta !== delta) offenders.push(`charDelta=${diff.charDelta} (기대 ${delta})`)
  // 안 고친 쪽은 false 여야 한다
  const same = buildEditDiff(DRAFT_TITLE, DRAFT_BODY, { title: DRAFT_TITLE, body: '다른 본문', note: 'x' })
  if (same.titleChanged !== false || same.bodyChanged !== true) offenders.push('부분 변경 감지 실패')

  if (offenders.length) bad('editDiff 에 본문 없음', offenders.join(' / '))
  else ok('editDiff 에 본문 없음', `${want.join(' · ')} 만 · charDelta ${diff.charDelta >= 0 ? '+' : ''}${diff.charDelta}자`)
}

// ── ⑩ 🔴 규칙 모듈이 순수한가 ──
{
  const src = readFileSync(RULES, 'utf-8')
  const code = src.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'))
    .join('\n')
  const offenders: string[] = []
  for (const key of ['PrismaClient', 'prisma.', 'fetch(', 'node:fs', 'anthropic', 'openai', 'process.env']) {
    if (code.includes(key)) offenders.push(`🔴 ${key} 가 있다`)
  }
  if (/^import /m.test(code)) offenders.push('🔴 import 가 있다 — 순수 모듈이 아니다')
  if (offenders.length) bad('규칙 모듈은 순수', offenders.join(' / '))
  else ok('규칙 모듈은 순수', 'import 0 · DB 0 · 네트워크 0 · env 0')
}

// ── ⑪ 🔴 소스 스캔 — CLI 가 무엇을 쓰는가 ──
{
  const code = readFileSync(CLI, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'))
    .join('\n')
  const offenders: string[] = []

  // 🔴 write 대상은 대기열 한 테이블뿐이다
  const QUEUE_ONLY = ['originalPostApprovalQueue']
  const writes = [...code.matchAll(
    /prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g,
  )].map((m) => m[1] ?? '')
  const badWrites = [...new Set(writes)].filter((m) => !QUEUE_ONLY.includes(m))
  if (badWrites.length > 0) offenders.push(`🔴 ${badWrites.join(' · ')} 에 쓴다`)
  if (writes.length === 0) offenders.push('write 가 하나도 없다 — 스캔이 헛돌고 있다')

  // 🔴 발행하지 않는다
  for (const key of ["'PUBLISHED'", 'publishCandidateTx', 'permanentNoindex']) {
    if (code.includes(key)) offenders.push(`🔴 ${key} 가 있다`)
  }
  // 🔴 createdPostId 는 읽기(select) · 조건(where) · 규칙 인자로만 쓴다.
  //    값을 넣는 순간 결정 경로가 발행 경로가 된다 — 그래서 **DB 에 쓰는 자리만** 본다.
  //    이름만 보고 막으면 planDecision 에 읽어 넘기는 것까지 걸린다(그건 write 가 아니다).
  const dataBlocks: string[] = []
  for (const m of code.matchAll(/data:\s*\{/g)) {
    let depth = 0
    let i = m.index! + m[0].length - 1
    const start = i
    for (; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1
      else if (code[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    dataBlocks.push(code.slice(start, i + 1))
  }
  if (dataBlocks.length === 0) offenders.push('data 블록이 없다 — 스캔이 헛돌고 있다')
  for (const key of ['createdPostId', 'status: \'PUBLISHED\'']) {
    if (dataBlocks.some((b) => b.includes(key))) offenders.push(`🔴 DB 에 쓰는 자리에 ${key} 가 있다`)
  }
  // 🔴 돈 쓰는 경로 · 바깥으로 나가는 경로가 없다
  for (const key of ['fetch(', 'anthropic', 'openai', 'googleapis', 'voice-m3-provider', 'sheets']) {
    if (code.toLowerCase().includes(key.toLowerCase())) offenders.push(`🔴 ${key} 가 있다`)
  }
  // 🔴 규칙을 여기서 다시 만들지 않는다
  if (!code.includes('planDecision(')) offenders.push('🔴 planDecision 을 부르지 않는다')
  // 🔴 읽은 뒤 쓰는 사이에 끼어들 수 있다 — WHERE 에 PENDING 과 createdPostId 가 있어야 한다
  if (!/status:\s*'PENDING'/.test(code)) offenders.push('🔴 조건부 UPDATE 가 아니다 (PENDING 없음)')
  if (!/createdPostId:\s*null/.test(code)) offenders.push('🔴 WHERE 에 createdPostId null 이 없다')
  // 🔴 dry-run 이 기본이다
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*IDS\.length/.test(code)) offenders.push('🔴 --limit 과 --id 개수를 대조하지 않는다')
  // 🔴 본문을 CLI 인자로 받지 않는다
  for (const key of ["arg('body')", "arg('title')", "arg('edited-body')"]) {
    if (code.includes(key)) offenders.push(`🔴 ${key} 로 본문을 받는다`)
  }
  if (!code.includes("arg('edited-file')")) offenders.push('🔴 수정본을 파일로 받지 않는다')
  // 🔴 수정본도 gate 를 다시 통과해야 한다
  if (!code.includes('gateDraft(')) offenders.push('🔴 수정본 gate 재판정이 없다')
  if (!code.includes('assertNoStoredSource(')) offenders.push('🔴 저장 금지 계약 재확인이 없다')
  // 🔴 write 후 다시 본다
  if (!code.includes('findUniqueOrThrow')) offenders.push('🔴 read-back 이 없다')

  if (offenders.length) bad('CLI 경계', offenders.join(' / '))
  else {
    ok('CLI 경계',
      'write 는 대기열만 · 발행 0 · 네트워크 0 · 조건부 UPDATE · dry-run 기본 · limit 대조 · 수정본 gate 재판정 · read-back')
  }
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
