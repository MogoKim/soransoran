#!/usr/bin/env tsx
/**
 * 운영용 작성자 OP 확장 — 전용 검사
 *
 *   npx tsx scripts/operator-writer-expand-check.mts            # 순수 판정만 (DB 없음)
 *   DATABASE_URL=postgresql://soran@127.0.0.1:54329/soran_test \
 *     npx tsx scripts/operator-writer-expand-check.mts --db     # + 격리 DB 실제 트랜잭션
 *
 * 🔴 `--db` 는 격리 주소(127.0.0.1/localhost 의 soran_test)가 아니면 즉시 멈춘다.
 *    격리 Postgres 세우는 법은 `scripts/operator-compose-db-check.mts` 머리에 있다.
 * 🔴 운영 가드(§④)는 사실을 바꿔 끼운 순수 판정만 본다 — 이 검사는 git fetch 도 운영 env 도 읽지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import {
  BASELINE_CODES, EXPANSION, TARGET_ACTIVE, TARGET_CODES,
  applyExpansion, canonicalSpecJson, decideMode, isIsolatedUrl, judgeProduction, judgeSpecs, normalizeName,
  planExpansion, readFacts, specDigest, verifyAfter,
  type DbFacts, type ProductionFacts, type WriterFact, type WriterSpec,
} from './lib/operator-writer-expand.mjs'

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}
const truthy = (label: string, v: boolean): void => expect(label, v, true)

// ─────────────────────────────────────────────────────────
// ① 명단 · 지문
// ─────────────────────────────────────────────────────────
console.log('\n① 명단 · 지문')
expect('새 이름 20명', EXPANSION.length, 20)
expect('목표 active 50', TARGET_ACTIVE, 50)
expect('code OP31~OP50 연속', EXPANSION.map((s) => s.code), TARGET_CODES.slice(30))
expect('명단 결함 0', judgeSpecs(EXPANSION), [])
truthy('기존 OP01~OP30 이름과 N2 충돌 0', EXPANSION.every((s) => ![
  '갱년기화끈이', '명품상자속편지', '남의편퇴치제', '찬장속빌보', '갱년기폭주기관차',
  '당근마켓만렙', '방풍나물무침', '아들놈밥상파업', '샤넬녀', '짠돌이남편',
  '빈둥지신입생', '새벽수영반장', '무릎이일기예보', '손주등원담당', '김장총사령관',
  '사표는서랍속', '텃밭상추부자', '혼밥고수', '트로트직관러', '반찬가게사장',
  '잠못드는올빼미', '코바늘중독', '시댁가는길치', '말티즈집사', '노후자금계산기',
  '드라마정주행', '등산화두켤레', '늦둥이초딩맘', '두번째스무살', '약봉투수집가',
].map(normalizeName).includes(normalizeName(s.nickname))))
expect('OP38 note(부모 돌봄 병행)', EXPANSION.find((s) => s.code === 'OP38')?.note.includes('부모 돌봄 병행'), true)
expect('OP48 note(교대 근무)', EXPANSION.find((s) => s.code === 'OP48')?.note.includes('교대 근무'), true)
truthy('직업 특정어 제거(간호사·요양보호사)', EXPANSION.every((s) => !s.note.includes('간호사') && !s.note.includes('요양보호사')))
const mut = (f: (s: WriterSpec[]) => void): string[] => { const c = EXPANSION.map((s) => ({ ...s })); f(c); return judgeSpecs(c) }
truthy('변이: 금지 표현(시니어) → 막힘', mut((c) => { c[0]!.nickname = '시니어수다' }).length > 0)
truthy('변이: 금지 표현(실버) note → 막힘', mut((c) => { c[0]!.note = '실버 세대' }).length > 0)
truthy('변이: 사칭(운영자) → 막힘', mut((c) => { c[1]!.nickname = '운영자언니' }).length > 0)
truthy('변이: 11자 → 막힘', mut((c) => { c[2]!.nickname = '가나다라마바사아자차카' }).length > 0)
truthy('변이: 공백 → 막힘', mut((c) => { c[3]!.nickname = '혼밥 고수' }).length > 0)
truthy('변이: 명단 안 중복 → 막힘', mut((c) => { c[4]!.nickname = c[5]!.nickname }).length > 0)
truthy('변이: code 순서 뒤바뀜 → 막힘', mut((c) => { c[6]!.code = 'OP51' }).length > 0)
truthy('변이: 출처 커뮤니티 이름 → 막힘', mut((c) => { c[7]!.nickname = '82쿡단골' }).length > 0)
const D = specDigest(EXPANSION)
truthy('digest 는 SHA-256 64자리', /^[0-9a-f]{64}$/.test(D))
expect('digest 결정적', specDigest(EXPANSION.map((s) => ({ ...s }))), D)
expect('canonical — 배열 순서·키 순서가 달라도 같은 값', specDigest([...EXPANSION].reverse().map((s) => ({ note: s.note, nickname: s.nickname, code: s.code }))), D)
const touched = (f: (s: WriterSpec[]) => void): string => { const c = EXPANSION.map((s) => ({ ...s })); f(c); return specDigest(c) }
truthy('digest 는 note 한 글자에도 바뀜', touched((c) => { c[19]!.note += '.' }) !== D)
truthy('digest 는 닉네임 한 글자에도 바뀜', touched((c) => { c[0]!.nickname = '빈둥지신입샘' }) !== D)
truthy('canonical JSON 에 판 이름 포함', canonicalSpecJson(EXPANSION).startsWith('{"kind":"operator-writer-expand","version":1,'))

// ─────────────────────────────────────────────────────────
// ② 계획 — 가짜 사실(🔴 실제 DB 가 만들 수 있는 모양만)
// ─────────────────────────────────────────────────────────
console.log('\n② 계획')
const baseW = (code: string, over: Partial<WriterFact> = {}): WriterFact => ({
  code, status: 'active', userId: `u-${code}`, nickname: `기준${code}`, note: null, accountCount: 0, hasPersona: false, ...over,
})
const facts = (writers: WriterFact[], names: [string, 'operator' | 'persona' | 'member-or-other'][] = [], guests: string[] = [], extraUsers = 0): DbFacts => {
  const m = new Map<string, { userId: string; kind: 'operator' | 'persona' | 'member-or-other' }[]>()
  for (const w of writers) if (w.nickname !== null) m.set(normalizeName(w.nickname), [{ userId: w.userId, kind: 'operator' }])
  names.forEach(([n, kind], i) => m.set(normalizeName(n), [...(m.get(normalizeName(n)) ?? []), { userId: `x${i}`, kind }]))
  const ids = new Set([...writers.map((w) => w.userId), ...names.map((_, i) => `x${i}`), ...Array.from({ length: extraUsers }, (_, i) => `extra${i}`)])
  return { writers, userNames: m, guestNames: new Set(guests.map(normalizeName)), userIds: ids, totals: { users: ids.size, accounts: 0, personas: 0 } }
}
const base = BASELINE_CODES.map((c) => baseW(c))
const full = [...base, ...EXPANSION.map((s) => baseW(s.code, { nickname: s.nickname, note: s.note, userId: `n-${s.code}` }))]

expect('기준 30 · 충돌 0 → create 20 · expect 30:50', (() => { const p = planExpansion(facts(base)); return [p.action, p.action === 'create' ? p.creates.length : 0, `${p.activeBefore}:${p.activeAfter}`] })(), ['create', 20, '30:50'])
expect('같은 20명 이미 있음 → noop · expect 50:50', (() => { const p = planExpansion(facts(full)); return [p.action, `${p.activeBefore}:${p.activeAfter}`] })(), ['noop', '50:50'])
expect('20명 중 1명 note 다름 → abort', planExpansion(facts(full.map((w) => (w.code === 'OP37' ? { ...w, note: '다름' } : w)))).action, 'abort')
expect('20명 중 1명 nickname 다름 → abort', planExpansion(facts(full.map((w) => (w.code === 'OP50' ? { ...w, nickname: '다른이름' } : w)))).action, 'abort')
expect('20명 중 1명 Account 붙음 → abort', planExpansion(facts(full.map((w) => (w.code === 'OP31' ? { ...w, accountCount: 1 } : w)))).action, 'abort')
expect('부분 상태(5명만) → abort', planExpansion(facts(full.slice(0, 35))).action, 'abort')
const partialOnly = planExpansion(facts([...base, baseW('OP31', { nickname: '전혀다른이름' })]))
truthy('부분 상태(이름 충돌 없음) → 부분 상태 사유로 abort', partialOnly.action === 'abort' && partialOnly.problems.some((p) => p.startsWith('부분 상태')))
expect('기준 OP03 없음 → abort', planExpansion(facts(base.filter((w) => w.code !== 'OP03'))).action, 'abort')
expect('기준 OP05 retired → abort', planExpansion(facts(base.map((w) => (w.code === 'OP05' ? { ...w, status: 'retired' } : w)))).action, 'abort')
expect('기준 OP02 Account 1 → abort', planExpansion(facts(base.map((w) => (w.code === 'OP02' ? { ...w, accountCount: 1 } : w)))).action, 'abort')
expect('기준 OP09 Persona 연결 → abort', planExpansion(facts(base.map((w) => (w.code === 'OP09' ? { ...w, hasPersona: true } : w)))).action, 'abort')
expect('모르는 code OP99 → abort', planExpansion(facts([...base, baseW('OP99')])).action, 'abort')
const memberHit = planExpansion(facts(base, [[EXPANSION[3]!.nickname, 'member-or-other']]))
expect('회원 이름 충돌 → abort', memberHit.action, 'abort')
truthy('회원 충돌 보고에 종류만 (이름 원문 없음)', memberHit.action === 'abort'
  && memberHit.problems.some((p) => p.includes('member-or-other')) && !memberHit.problems.some((p) => p.includes(EXPANSION[3]!.nickname)))
expect('Persona 이름 충돌(N2: 기호·공백) → abort', planExpansion(facts(base, [[` ${EXPANSION[0]!.nickname}!`, 'persona']])).action, 'abort')
expect('비회원 댓글 이름 충돌 → abort', planExpansion(facts(base, [], [EXPANSION[9]!.nickname])).action, 'abort')
expect('명단 결함이면 DB 가 깨끗해도 abort', planExpansion(facts(base), EXPANSION.map((s, i) => (i === 0 ? { ...s, nickname: '노인정' } : s))).action, 'abort')

// ─────────────────────────────────────────────────────────
// ③ 적용 뒤 검증 — 행 단위가 정본 · 전체 수는 진단
// ─────────────────────────────────────────────────────────
console.log('\n③ 적용 뒤 검증')
const before = facts(base, [['어느회원', 'member-or-other']])
const afterOk = facts(full, [['어느회원', 'member-or-other']])
expect('정상 → 문제 0', verifyAfter(before, afterOk).problems, [])
const concurrent = facts(full, [['어느회원', 'member-or-other'], ['동시가입', 'member-or-other']], [], 3)
concurrent.totals.accounts = 4
const vc = verifyAfter(before, concurrent)
expect('무관한 동시 가입(User +24 · Account +4) → 문제 0', vc.problems, [])
expect('…진단에는 보인다', [vc.diagnostics.usersDelta, vc.diagnostics.accountsDelta], [24, 4])
truthy('새 code 가 기존 User 를 쓰면 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP32' ? { ...w, userId: 'x0' } : w)), [['어느회원', 'member-or-other']])).problems.some((p) => p.includes('OP32')))
truthy('새 code 두 개가 같은 User 면 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP33' ? { ...w, userId: 'n-OP34' } : w)))).problems.some((p) => p.includes('OP34') || p.includes('OP33')))
truthy('새 code 에 Account 1 → 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP40' ? { ...w, accountCount: 1 } : w)))).problems.some((p) => p.includes('OP40')))
truthy('새 code 에 Persona → 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP41' ? { ...w, hasPersona: true } : w)))).problems.some((p) => p.includes('OP41')))
truthy('기준 OP04 닉네임 바뀜 → 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP04' ? { ...w, nickname: '바뀜' } : w)))).problems.some((p) => p.includes('OP04')))
truthy('기준 OP06 User 바뀜 → 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP06' ? { ...w, userId: 'u-other' } : w)))).problems.some((p) => p.includes('OP06')))
truthy('기준 OP07 retired → 실패', verifyAfter(before, facts(full.map((w) => (w.code === 'OP07' ? { ...w, status: 'retired' } : w)))).problems.length > 0)
truthy('새 code 하나 빠짐 → 실패', verifyAfter(before, facts(full.filter((w) => w.code !== 'OP45'))).problems.some((p) => p.includes('OP45')))

// ─────────────────────────────────────────────────────────
// ④ 실행 모드 · 운영 가드
// ─────────────────────────────────────────────────────────
console.log('\n④ 실행 모드 · 운영 가드')
const PROD = 'postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres'
const ISO = 'postgresql://soran@127.0.0.1:54329/soran_test'
const SHA = 'a'.repeat(40)
const OK_ARGS = ['--expect=30:50', `--digest=${D}`, '--reason=창업자 승인']
expect('인자 없음 → dry-run', decideMode([], PROD).kind, 'dry-run')
expect('--json → dry-run', decideMode(['--json'], PROD).kind, 'dry-run')
expect('--production 만 → 거부', decideMode(['--production'], PROD).kind, 'refuse')
expect('--apply 만 → 거부', decideMode(['--apply'], PROD).kind, 'refuse')
expect('운영: target 없음 → 거부', decideMode(['--apply', '--production', ...OK_ARGS], PROD).kind, 'refuse')
expect('운영: target 39자리 → 거부', decideMode(['--apply', '--production', `--target=${'a'.repeat(39)}`, ...OK_ARGS], PROD).kind, 'refuse')
expect('운영: expect 없음 → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, `--digest=${D}`, '--reason=x'], PROD).kind, 'refuse')
expect('운영: expect=10 (한쪽만) → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, '--expect=10', `--digest=${D}`, '--reason=x'], PROD).kind, 'refuse')
expect('운영: 옛 8자리 digest → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, '--expect=30:50', '--digest=313041d8', '--reason=x'], PROD).kind, 'refuse')
expect('운영: reason 빈칸 → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, '--expect=30:50', `--digest=${D}`, '--reason=  '], PROD).kind, 'refuse')
expect('운영: reason 없음 → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, '--expect=30:50', `--digest=${D}`], PROD).kind, 'refuse')
expect('옛 --expect-active 인자 → 거부', decideMode(['--apply', '--production', `--target=${SHA}`, '--expect-active=10', `--digest=${D}`, '--reason=x'], PROD).kind, 'refuse')
expect('운영 인자 완비 → apply-production', decideMode(['--apply', '--production', `--target=${SHA}`, ...OK_ARGS], PROD),
  { kind: 'apply-production', target: SHA, expected: { before: 30, after: 50 }, digest: D, reason: '창업자 승인' })
expect('운영 모드는 셸 주소를 보지 않는다(셸이 격리여도 인자 단계는 통과 → 가드가 판정)', decideMode(['--apply', '--production', `--target=${SHA}`, ...OK_ARGS], ISO).kind, 'apply-production')
expect('--production 없이 운영 주소 → 거부', decideMode(['--apply', ...OK_ARGS], PROD).kind, 'refuse')
expect('--production 없이 --target → 거부', decideMode(['--apply', `--target=${SHA}`, ...OK_ARGS], ISO).kind, 'refuse')
expect('격리 apply → apply-isolated', decideMode(['--apply', ...OK_ARGS], ISO).kind, 'apply-isolated')
expect('오타 인자 → 거부', decideMode(['--aply'], PROD).kind, 'refuse')
expect('격리 주소 판정', [isIsolatedUrl(ISO), isIsolatedUrl(PROD), isIsolatedUrl('postgresql://a@127.0.0.1:5432/postgres')], [true, false, false])

const goodFacts: ProductionFacts = {
  isolatedFlag: '',
  env: { ok: true, reason: null, databaseUrl: PROD, directUrl: 'postgresql://u:p@db.x.supabase.co:5432/postgres' },
  fetched: true, originMain: SHA, head: SHA, trackedChanges: '',
  toolFilesCommitted: [{ path: 'scripts/operator-writer-expand.mts', tracked: true }, { path: 'scripts/lib/operator-writer-expand.mts', tracked: true }],
}
const pj = (over: Partial<ProductionFacts>, target = SHA): string[] => judgeProduction({ ...goodFacts, ...over }, target)
expect('가드: 모두 맞음 → 통과', pj({}), [])
truthy('가드: SORAN_ISOLATED_DB 설정 → 거부', pj({ isolatedFlag: 'yes-throwaway' }).length > 0)
truthy('가드: canonical env 읽기 실패 → 거부', pj({ env: { ok: false, reason: '정본 env 가 없다', databaseUrl: '', directUrl: '' } }).length > 0)
truthy('가드: DATABASE_URL 없음 → 거부', pj({ env: { ...goodFacts.env, databaseUrl: '' } }).length > 0)
truthy('가드: DIRECT_URL 없음 → 거부', pj({ env: { ...goodFacts.env, directUrl: '' } }).length > 0)
truthy('가드: canonical 이 격리 DB 모양 → 거부', pj({ env: { ...goodFacts.env, databaseUrl: ISO } }).length > 0)
truthy('가드: canonical 이 로컬 postgres → 거부', pj({ env: { ...goodFacts.env, directUrl: 'postgresql://a@localhost:5432/postgres' } }).length > 0)
truthy('가드: fetch 실패 → 거부', pj({ fetched: false, originMain: null }).length > 0)
truthy('가드: HEAD ≠ origin/main (feature branch) → 거부', pj({ head: 'b'.repeat(40) }, 'b'.repeat(40)).length > 0)
truthy('가드: HEAD = origin/main ≠ target → 거부', pj({}, 'c'.repeat(40)).length > 0)
truthy('가드: tracked 변경 있음 → 거부', pj({ trackedChanges: ' M src/lib/nickname.ts' }).length > 0)
truthy('가드: 작업 트리 상태 모름 → 거부', pj({ trackedChanges: null }).length > 0)
truthy('가드: 도구 파일 미커밋(main 위 untracked 스크립트) → 거부', pj({ toolFilesCommitted: [{ path: 'scripts/operator-writer-expand.mts', tracked: false }, { path: 'scripts/lib/operator-writer-expand.mts', tracked: true }] }).length > 0)
truthy('가드: 도구 파일 확인 결과 비어 있음 → 거부', pj({ toolFilesCommitted: [] }).length > 0)
truthy('가드: 거부 사유에 DB 주소 원문 없음', pj({ env: { ...goodFacts.env, databaseUrl: ISO } }).every((p) => !p.includes('127.0.0.1')))

// ─────────────────────────────────────────────────────────
// ⑤ 격리 DB — 실제 트랜잭션
// ─────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  console.log('\n⑤ 격리 DB 실제 트랜잭션')
  const url = process.env.DATABASE_URL ?? ''
  if (!isIsolatedUrl(url)) { console.error('🔴 격리 DB 가 아니다. 멈춘다.'); process.exit(2) }
  const prisma = new PrismaClient()
  const E = { before: 30, after: 50 }
  try {
    // 🔴 시험 DB 만 비운다
    await prisma.operatorWriteLog.deleteMany({})
    await prisma.comment.deleteMany({})
    await prisma.post.deleteMany({})
    await prisma.operatorWriter.deleteMany({})
    await prisma.persona.deleteMany({})
    await prisma.account.deleteMany({})
    await prisma.user.deleteMany({})

    for (const code of BASELINE_CODES) {
      await prisma.user.create({ data: { nickname: `기준${code}`, operatorWriter: { create: { code } } } })
    }
    const member = await prisma.user.create({ data: { nickname: '진짜회원', name: '카카오이름' } })
    await prisma.account.create({ data: { userId: member.id, type: 'oauth', provider: 'kakao', providerAccountId: 'k-1' } })

    const counts = async (): Promise<number[]> => [await prisma.user.count(), await prisma.operatorWriter.count(), await prisma.account.count(), await prisma.persona.count()]
    const start = await counts()

    let r = await applyExpansion(prisma, { expected: { before: 31, after: 51 }, approvedDigest: D })
    expect('(a) expect 틀림 → 실패', r.ok, false)
    expect('(a) write 0', await counts(), start)
    r = await applyExpansion(prisma, { expected: { before: 30, after: 49 }, approvedDigest: D })
    expect('(a2) expect 뒤쪽만 틀림 → 실패', r.ok, false)
    expect('(a2) write 0', await counts(), start)

    r = await applyExpansion(prisma, { expected: E, approvedDigest: '0'.repeat(64) })
    expect('(b) digest 틀림 → 실패', r.ok, false)
    expect('(b) write 0', await counts(), start)

    await prisma.user.update({ where: { id: member.id }, data: { name: EXPANSION[19]!.nickname } })
    r = await applyExpansion(prisma, { expected: E, approvedDigest: D })
    expect('(c) 20번째 이름이 회원 이름과 겹침 → 실패', r.ok, false)
    expect('(c) write 0 (앞 19명도 안 생김)', await counts(), start)
    await prisma.user.update({ where: { id: member.id }, data: { name: '카카오이름' } })

    // (d) 적용 뒤 검증 실패 → 실제 생성 뒤 rollback (19명만 넣으면 code 집합이 OP01~OP50 이 아님)
    const nineteen = EXPANSION.slice(0, 19)
    r = await applyExpansion(prisma, { expected: { before: 30, after: 49 }, approvedDigest: specDigest(nineteen), specs: nineteen })
    expect('(d) 검증 실패 → 실패', r.ok ? 'ok' : r.reason, '적용 뒤 검증 실패 — rollback')
    expect('(d) rollback — write 0', await counts(), start)

    r = await applyExpansion(prisma, { expected: E, approvedDigest: D })
    expect('(e) 적용 성공', r.ok && !r.noop ? [r.created, r.activeBefore, r.activeAfter] : r, [20, 30, 50])
    expect('(e) User +20 · Writer +20 · Account +0 · Persona +0', await counts(), [start[0]! + 20, start[1]! + 20, start[2]!, start[3]!])
    const after = await readFacts(prisma)
    expect('(e) code OP01~OP50', after.writers.map((w) => w.code), [...TARGET_CODES])
    truthy('(e) 새 20명 Account 0 · Persona 0 · 값 일치', EXPANSION.every((s) => {
      const w = after.writers.find((x) => x.code === s.code)
      return w !== undefined && w.accountCount === 0 && !w.hasPersona && w.nickname === s.nickname && w.note === s.note && w.status === 'active'
    }))

    // (i) 커밋 뒤 무관한 동시 가입·로그인 — 커밋 뒤 검증이 거짓 실패하지 않는다
    if (r.ok) {
      const late = await prisma.user.create({ data: { nickname: '늦은가입자' } })
      await prisma.account.create({ data: { userId: late.id, type: 'oauth', provider: 'kakao', providerAccountId: 'k-2' } })
      const v = verifyAfter(r.before, await readFacts(prisma))
      expect('(i) 동시 가입 뒤 커밋 후 검증 → 문제 0', v.problems, [])
      expect('(i) 진단 User +21 · Account +1 · Persona 0', [v.diagnostics.usersDelta, v.diagnostics.accountsDelta, v.diagnostics.personasDelta], [21, 1, 0])
    }

    const before2 = await counts()
    r = await applyExpansion(prisma, { expected: { before: 50, after: 50 }, approvedDigest: D })
    expect('(f) 재실행 noop (expect 50:50)', r.ok ? r.noop : r, true)
    expect('(f) write 0', await counts(), before2)
    r = await applyExpansion(prisma, { expected: E, approvedDigest: D })
    expect('(f2) 재실행인데 expect 30:50 → 실패', r.ok, false)
    expect('(f) dry-run 계획도 noop', planExpansion(await readFacts(prisma)).action, 'noop')

    const op38 = await prisma.operatorWriter.findUniqueOrThrow({ where: { code: 'OP38' }, select: { id: true } })
    await prisma.operatorWriter.update({ where: { id: op38.id }, data: { note: '누가 바꿈' } })
    r = await applyExpansion(prisma, { expected: { before: 50, after: 50 }, approvedDigest: D })
    expect('(g) 값 다름 → 실패', r.ok, false)
    expect('(g) write 0', await counts(), before2)

    const op50 = await prisma.operatorWriter.findUniqueOrThrow({ where: { code: 'OP50' }, select: { id: true, userId: true } })
    await prisma.operatorWriter.delete({ where: { id: op50.id } })
    await prisma.user.delete({ where: { id: op50.userId } })
    r = await applyExpansion(prisma, { expected: { before: 49, after: 49 }, approvedDigest: D })
    expect('(h) 부분 상태 → 부분 상태 사유로 실패', !r.ok && r.problems.some((p) => p.startsWith('부분 상태')), true)
    expect('(h) OP50 을 메우지 않음', await prisma.operatorWriter.count({ where: { code: 'OP50' } }), 0)
  } finally {
    await prisma.$disconnect()
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} 통과 ${pass} · 실패 ${fail}\n`)
process.exit(fail === 0 ? 0 : 1)
