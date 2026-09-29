#!/usr/bin/env tsx
/**
 * Persona 말투 근거 공급 fixture — 🔴 **DB 0 · 네트워크 0 · 유료 호출 0 · 운영 파일 0** (2026-09-29, Lane 3)
 *
 * 🔴 **fixture 가 실제보다 강하면 안 된다.** 합성 댓글이지만 거르기(`checkContent` · `safetyFilter` ·
 *    Gate ⑥-B · `identityLeakCheck` · `carriesExperience`) · 묶기(`planBundles`) · seed 공유
 *    (`referenceSeedShareCount`) · 후보 판정(`judgeAutogenCandidate`)은 **운영 함수 그대로**다.
 *    반례는 한 칸씩만 비틀어, 정확히 그 칸의 코드가 나오는지 본다.
 *
 * 🔴 실제 `$HOME` 을 쓰지 않는다 — 임시 HOME 에 합성 정본 자산을 두고 모든 모듈을 **그 뒤에** 부른다
 *    (자산 경로는 import 시점에 정해진다). 장부도 임시 디렉터리만 읽는다.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'voice-supply-check-'))
process.env.HOME = HOME

const { writeFakePersonaAsset } = await import('./lib/fake-persona-asset.mjs')
writeFakePersonaAsset({ home: HOME, speakers: 18, perSpeaker: 6 })

const { judgeReferenceBundle } = await import('../src/lib/persona-voice-reference')
const { PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
const { judgeAutogenCandidate } = await import('./lib/persona-autogen.mjs')
const { carriesExperience, loadCanonCorpusTexts, stableAssignment } = await import('./lib/persona-reference-store.mjs')
const {
  assignmentBytes, bytesDrift, dropDuplicateSpeakers, planSupplyBundles, planVoiceSupply, rekeyByContent,
  rowsFromCollectLine, rowsFromRawContent, screenPublicComments, supplyTargetCodes, voiceEvidencePii,
} = await import('./lib/persona-voice-supply.mjs')
const {
  FixtureCreativeProvider, LiveCreativeProvider, creativeProblems, readCreativeBudget, runCreativeStep,
} = await import('./lib/persona-voice-creative.mjs')
const { draftGate, runVoiceSupply } = await import('./lib/persona-voice-supply-run.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')
const { tallyOf } = await import('../src/lib/llm-ledger')
type PublicCommentRow = import('./lib/persona-voice-supply.mjs').PublicCommentRow
type VoiceReferenceBundle = import('../src/lib/persona-voice-reference').VoiceReferenceBundle
type CreativeProvider = import('./lib/persona-voice-creative.mjs').CreativeProvider
type CreativeBudget = import('./lib/persona-voice-creative.mjs').CreativeBudget
type PersonaCreative = import('../src/lib/persona-autogen').PersonaCreative

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

console.log('\n══ Persona 말투 근거 공급 fixture ══\n')

// ─────────────────────────────────────────────────────────
// 합성 재료 — 🔴 경험을 주장하지 않는 짧은 반응 · 화자마다 다른 문장
// ─────────────────────────────────────────────────────────
const STEMS = [
  '그러게요 그 말씀 맞네요', '아이고 그건 좀 그렇네요', '음 그럴 수도 있겠네요',
  '맞아요 같은 생각이에요', '흠 잘 되셨으면 좋겠네요', '그래요 천천히 하셔도 돼요',
]
const SOURCE = 'test:cafe'
const AUTHORS = ['봄바람', '달빛정원', '초록우산', '가을하늘', '산들바다', '노을빛길', '은행나무', '푸른언덕', '솔향기']
const MEMBER = '해솔맘' // 🔴 회원 표시명 — 이 이름을 쓰는 공개 화자는 실회원일 수 있다
/** 화자 s 의 댓글 i — 화자·순번마다 다른 문장 */
const line = (s: number, i: number): string => `${STEMS[(s + i) % STEMS.length]!} (${s}-${i})`
const speakerRows = (s: number, n = 4, author = AUTHORS[s]!): PublicCommentRow[] =>
  Array.from({ length: n }, (_, i) => ({ source: SOURCE, articleId: `a${s}`, author, text: line(s, i) }))
const MEMBERS = { memberNames: [MEMBER] }
const canon = loadCanonCorpusTexts()
const base = stableAssignment({ repoRoot: process.cwd() })

console.log('⓪ 재료 자체')
check('합성 정본 자산이 임시 HOME 에서 읽힌다 (18칸 배정)', canon.ok && base.byCode.size === 18)
check('정본 배정은 P20~P25 를 비워 둔다', ['P20', 'P21', 'P22', 'P23', 'P24', 'P25'].every((c) => !base.byCode.has(c)))
check('합성 공개 댓글은 경험형이 아니다', AUTHORS.every((_, s) => speakerRows(s).every((r) => !carriesExperience(r.text))))

// ─────────────────────────────────────────────────────────
// ① 거르기 · 익명화
// ─────────────────────────────────────────────────────────
console.log('① 거르기 · 익명화')
{
  const rows = [0, 1].flatMap((s) => speakerRows(s))
  const r = screenPublicComments(rows, MEMBERS, 'salt-a')
  check('깨끗한 화자 두 명 — 8건 전부 남는다', r.kept.length === 8)
  check('speakerId 는 불투명 12자 hex 다', r.kept.every((k) => /^[0-9a-f]{12}$/.test(k.speakerId)))
  const out = JSON.stringify(r)
  check('🔴 결과 어디에도 작성자 표시가 없다', AUTHORS.every((a) => !out.includes(a)))
  check('식별자 유출 검사가 돌았고 0건이다', r.identityLeak.ran && r.identityLeak.hits === 0)
  const r2 = screenPublicComments(rows, MEMBERS, 'salt-b')
  check('salt 가 다르면 speakerId 도 다르다(되돌릴 수 없다)', r.kept[0]!.speakerId !== r2.kept[0]!.speakerId)
  check('내용 digest 로 다시 이름 붙이면 salt 와 무관하게 같다',
    JSON.stringify(rekeyByContent(r.kept)) === JSON.stringify(rekeyByContent(r2.kept)))
}
{
  const drops = (text: string, author = AUTHORS[0]!): string[] => {
    const r = screenPublicComments([{ source: SOURCE, articleId: 'x', author, text }], MEMBERS, 's')
    return Object.entries(r.dropped).filter(([, n]) => n > 0).map(([k]) => k)
  }
  check('개인정보 — 전화번호 → PII', drops('연락 주세요 010-1234-5678 이에요').join() === 'PII')
  check('개인정보 — 이메일 → PII', drops('여기로 보내요 abc.def@example.com 입니다').join() === 'PII')
  check('개인정보 — 계좌번호 요청 → PII', drops('계좌번호 알려 주시면 보낼게요').join() === 'PII')
  check('개인정보 — 메신저 ID → PII', drops('카톡 아이디 sunny_77 로 연락 주세요').join() === 'PII')
  check('안전 — 욕설 → UNSAFE', drops('그 사람 진짜 병신 같네요 정말').join() === 'UNSAFE')
  /**
   * 🔴 **가린 개인정보 변형** (#624 합성 실측 — 보정 전 전부 통과했다). 말투 근거는 90일 저장되므로 넓게 버린다.
   *    반대쪽(평범한 문장이 걸리지 않는다)도 함께 본다 — 다 버리는 필터는 필터가 아니다.
   */
  const PII_VARIANTS: [string, string][] = [
    ['전각 숫자', '０１０－１２３４－５６７８ 로 주세요'],
    ['원문자 숫자', '⓪①⓪-①②③④-⑤⑥⑦⑧ 로 연락'],
    ['이모지 숫자', '0️⃣1️⃣0️⃣ 1️⃣2️⃣3️⃣4️⃣ 5️⃣6️⃣7️⃣8️⃣ 연락주세요'],
    ['한글 숫자', '공일공 일이삼사 오육칠팔 로 문자 주세요'],
    ['한글 앞자리', '공일공-1234-5678 로 주세요'],
    ['띄어 쓴 숫자', '0 1 0 1 2 3 4 5 6 7 8 로 연락주세요'],
    ['유선 번호', '02-123-4567 로 전화주세요'],
    ['국제 번호', '+82 10-1234-5678 로 연락주세요'],
    ['글자로 가린 번호', '010-l234-5678 카톡주세요'],
    ['계좌 숫자만', '농협 3021234567891 로 보내주세요'],
    ['토스 계좌', '토스 1000-1234-5678 로 보내요'],
    ['한글 메신저 ID', '카톡 아이디 햇살언니 로 찾아주세요'],
    ['띄어 쓴 카톡', '카 톡 sunny77 로 연락해요'],
    ['초성 카톡', 'ㅋㅌ sunny77 로 연락주세요'],
    ['오픈채팅 링크', 'https://open.kakao.com/o/gAbCdEf 들어오세요'],
    ['스킴 없는 링크', 'open.kakao.com/o/gAbCdEf 여기로 오세요'],
    ['블로그 주소', 'blog.naver.com/sunny77 제 블로그예요'],
    ['골뱅이 이메일', 'sunny77 골뱅이 naver.com 으로 메일'],
    ['(at) 이메일', 'sunny77(at)naver(dot)com 으로 보내주세요'],
    ['띄어 쓴 이메일', 'sunny77 @ naver . com 으로 보내요'],
    ['아파트 동호', '느티마을 301동 1502호 살아요'],
    ['행정 구역 주소', '경기도 성남시 분당구 정자일로 95 에 살아요'],
    ['@멘션', '@햇살언니 님 말씀이 맞아요 저도 그래요'],
    ['인스타 ID', '인스타 sunny_77 팔로우해 주세요'],
    ['라인 ID', '라인 아이디 sunny77 이에요'],
  ]
  const missed = PII_VARIANTS.filter(([, t]) => drops(t).join() !== 'PII').map(([k]) => k)
  check(`개인정보 — 가린 변형 ${PII_VARIANTS.length}종 전부 PII (놓침: ${missed.join(' · ') || '없음'})`, missed.length === 0)
  const SAFE_LOOKALIKES = [
    '좋은 아이디어네요 저도 해볼게요', '2026.09.29 에 다녀왔는데 좋았어요', '1,000,000원이나 들었대요 비싸네요',
    '다시 친구랑 앞으로 3번은 가보려고요', '오이 사이사이 구일 오후에 일이 있어요', '요즘 10시에 자고 6시에 일어나요',
    '서울 강남구 병원 다녀왔는데 좋았어요', '그 길로 3년을 버텼어요 대단하네요',
  ]
  const over = SAFE_LOOKALIKES.filter((t) => voiceEvidencePii(t))
  check(`개인정보 — 닮은 평범한 문장 ${SAFE_LOOKALIKES.length}건은 걸지 않는다 (오탐 ${over.length})`, over.length === 0)
  check('닉네임 혼입 — 다른 작성자 표시가 본문에 → NICKNAME_LEAK', (() => {
    const r = screenPublicComments([
      ...speakerRows(1),
      { source: SOURCE, articleId: 'x', author: AUTHORS[0]!, text: `${AUTHORS[1]!}님 말이 맞아요 정말로` },
    ], MEMBERS, 's')
    return r.dropped.NICKNAME_LEAK === 1 && r.kept.length === 4
  })())
  check('닉네임 혼입 — 회원 표시명이 본문에 → NICKNAME_LEAK', drops(`${MEMBER}님 글 보고 왔어요 반가워요`).join() === 'NICKNAME_LEAK')
  check('식별자 유출 — 본문이 작성자 표시 그 자체 → IDENTITY_LEAK', (() => {
    const r = screenPublicComments([
      ...speakerRows(1, 4, '달빛정원의하루'),
      { source: SOURCE, articleId: 'x', author: AUTHORS[0]!, text: '달빛정원의하루' },
    ], MEMBERS, 's')
    return r.dropped.IDENTITY_LEAK === 1
  })())
  check('작성자 없음 → UNATTRIBUTED', drops('그러게요 그 말씀 맞네요 정말', '').join() === 'UNATTRIBUTED')
  check('길이 밴드 밖 → OUT_OF_BAND', drops('네네').join() === 'OUT_OF_BAND')
  const exp = '저도 작년에 병원 다녀오고 나서 한결 나아졌어요'
  check('경험형 → EXPERIENCE (운영 carriesExperience 가 경험으로 본다)', carriesExperience(exp) && drops(exp).join() === 'EXPERIENCE')
}
{
  const real = screenPublicComments([...speakerRows(0, 4, MEMBER), ...speakerRows(1)], MEMBERS, 's')
  check('실회원 사칭 — 작성자 표시가 회원 표시명과 같다 → 그 화자 전부 REAL_MEMBER_SPEAKER',
    real.dropped.REAL_MEMBER_SPEAKER === 4 && real.realMemberSpeakers === 1 && real.kept.length === 4)
  const near = screenPublicComments(speakerRows(0, 4, `${MEMBER}.`), MEMBERS, 's')
  check('실회원 사칭 — 기호만 다른 표시(N2 정규화 일치)도 막는다', near.dropped.REAL_MEMBER_SPEAKER === 4)
  const unknown = screenPublicComments(speakerRows(0), null, 's')
  check('회원 표시명을 못 읽었으면(null) 전부 REAL_MEMBER_UNMEASURED — 모르면 통과가 아니다',
    unknown.kept.length === 0 && unknown.dropped.REAL_MEMBER_UNMEASURED === 4)
  const empty = screenPublicComments(speakerRows(0), { memberNames: [] }, 's')
  check('회원이 0명인 것(빈 배열)은 잰 것이다 — 통과', empty.kept.length === 4)
}

// ─────────────────────────────────────────────────────────
// ② 중복 화자
// ─────────────────────────────────────────────────────────
console.log('② 중복 화자')
{
  const kept = rekeyByContent(screenPublicComments([0, 1].flatMap((s) => speakerRows(s)), MEMBERS, 's').kept)
  // 정본 코퍼스 문장과 기호·띄어쓰기만 다른 댓글을 가진 화자
  const canonLine = canon.texts.find((t) => !carriesExperience(t))!
  const twin = rekeyByContent(screenPublicComments([
    ...speakerRows(2, 3),
    { source: SOURCE, articleId: 'x', author: AUTHORS[2]!, text: `${canonLine.replace(/\s+/g, '  ')}!!` },
  ], MEMBERS, 's').kept)
  const d1 = dropDuplicateSpeakers([...kept, ...twin], canon.texts)
  check('정본 코퍼스와 (정규화해서) 겹치는 화자 → 뺀다', d1.duplicateSpeakers === 1
    && !d1.rows.some((r) => twin.some((t) => t.speakerId === r.speakerId)))
  // 두 공급 화자가 띄어쓰기만 다른 같은 댓글을 가짐
  const a = speakerRows(3)
  const b = [...speakerRows(4, 3), { source: SOURCE, articleId: 'y', author: AUTHORS[4]!, text: a[0]!.text.replace(' ', '   ') }]
  const d2 = dropDuplicateSpeakers(rekeyByContent(screenPublicComments([...a, ...b], MEMBERS, 's').kept), [])
  check('공급 화자끼리 겹치면 먼저 선 화자만 남긴다', d2.duplicateSpeakers === 1 && new Set(d2.rows.map((r) => r.speakerId)).size === 1)
  check('겹치지 않으면 모두 남는다', dropDuplicateSpeakers(kept, canon.texts).duplicateSpeakers === 0)
}

// ─────────────────────────────────────────────────────────
// ③ 대상 순서 · 배정 · seed 공유
// ─────────────────────────────────────────────────────────
console.log('③ 대상 · 배정 · seed 공유')
const NEW = ['P26', 'P27', 'P28']
{
  const t = supplyTargetCodes({ productionCodes: PRODUCTION_PERSONA_CODES, baseAssigned: new Set(base.byCode.keys()), newCodes: NEW })
  check('대상 순서 — P20~P25 먼저, 그다음 새 코드', t.join(',') === 'P20,P21,P22,P23,P24,P25,P26,P27,P28')
  check('대상에 정본 배정 코드(P01~P19)가 없다', t.every((c) => !base.byCode.has(c)))
}
const ALL8 = AUTHORS.slice(0, 8).flatMap((_, s) => speakerRows(s, 4 + (s % 3)))
const planOf = (rows: readonly PublicCommentRow[], baseAfter?: () => ReadonlyMap<string, VoiceReferenceBundle>) => planVoiceSupply({
  rows, members: MEMBERS, canonTexts: canon.texts, base: base.byCode,
  baseAfter: baseAfter ?? (() => stableAssignment({ repoRoot: process.cwd() }).byCode),
  productionCodes: PRODUCTION_PERSONA_CODES, newCodes: NEW, salt: 'fixed',
})
const plan = planOf(ALL8)
{
  check('3건↑ 안전 화자 8명', plan.availableSpeakers === 8)
  check('배정 8칸 — P20~P25 여섯 + P26·P27', plan.slots.map((s) => s.code).join(',') === 'P20,P21,P22,P23,P24,P25,P26,P27')
  check('모든 칸의 seed 공유 수가 1 이다', plan.slots.every((s) => s.seedShareCount === 1 && s.blocks.length === 0))
  check('묶음은 운영 judgeReferenceBundle 을 다시 통과한다',
    plan.slots.every((s) => judgeReferenceBundle({ personaCode: s.code, texts: s.bundle.comments.map((c) => c.text) }).ok))
  check('한 묶음은 한 화자 — anchor 비율 1', plan.slots.every((s) => s.bundle.anchorRatio === 1))
  check('🔴 운영 배정 바이트 drift 0', plan.drift.length === 0 && plan.ok)
  const again = planOf([...ALL8].reverse())
  check('입력 순서가 달라도 같은 배정 (결정론)',
    JSON.stringify(again.slots.map((s) => [s.code, s.bundle.comments])) === JSON.stringify(plan.slots.map((s) => [s.code, s.bundle.comments])))
}
{
  // 🔴 중복 제거를 건너뛰고 정본 P01 묶음 문장을 그대로 가진 화자를 배정에 넣는다 — seed 공유 게이트만 남는다
  const p01 = base.byCode.get('P01')!
  const rows = [
    ...p01.comments.slice(0, 1).map((c) => ({ speakerId: 'sharedsp0001', text: c.text })),
    ...[0, 1, 2].map((i) => ({ speakerId: 'sharedsp0001', text: line(8, i) })),
  ]
  const r = planSupplyBundles({ rows, targets: ['P20'], base: base.byCode })
  check('정본 묶음과 같은 문장을 가진 칸 → SHARED_SEED · 공유 수 2',
    r.slots.length === 1 && r.slots[0]!.blocks.includes('SHARED_SEED') && r.slots[0]!.seedShareCount === 2)
  const r2 = planSupplyBundles({ rows, targets: ['P26'], base: base.byCode })
  const v = judgeAutogenCandidate({
    code: 'P26', life: null, creative: null, cadence: null, displayName: null,
    voice: { bundle: r2.slots[0]!.bundle, seedShareCount: r2.slots[0]!.seedShareCount },
    binding: { accountCount: 0, providerId: null },
  }, { takenCodes: new Set() })
  check('공유 seed 칸으로 만든 후보 → #623 판정이 VOICE_SPEAKER_DUPLICATE 로 격리', v.status === 'quarantined' && v.blocks.includes('VOICE_SPEAKER_DUPLICATE'))
  check('정본 배정이 있는 코드는 공급이 덮지 않는다', planSupplyBundles({ rows, targets: ['P01'], base: base.byCode }).slots.length === 0)
}
{
  // 🔴 drift — 정본 배정이 한 바이트라도 바뀌면 잡는다
  const mutated = new Map(base.byCode)
  const p01 = mutated.get('P01')!
  mutated.set('P01', { ...p01, lengths: { ...p01.lengths, max: p01.lengths.max + 1 } })
  const bad = planOf(ALL8, () => mutated)
  check('P01 묶음 길이 분포 1 바뀜 → drift P01', bad.drift.join() === 'P01' && !bad.ok)
  const codes = [...base.byCode.keys()]
  check('assignmentBytes 는 같은 배정에 같은 값', bytesDrift(assignmentBytes(base.byCode, codes), assignmentBytes(stableAssignment({ repoRoot: process.cwd() }).byCode, codes)).length === 0)
  check('묶음을 잃어도 drift 다', bytesDrift(assignmentBytes(base.byCode, codes), assignmentBytes(new Map(), codes)).length === codes.length)
}

// ─────────────────────────────────────────────────────────
// ④ creative — 예산 게이트 · 유료 호출 0
// ─────────────────────────────────────────────────────────
console.log('④ creative 예산 게이트')
class SpyLive implements CreativeProvider {
  readonly kind = 'live' as const
  readonly model = 'gemini-3.7-flash'
  calls = 0
  private readonly inner = new FixtureCreativeProvider()
  async generate(req: Parameters<CreativeProvider['generate']>[0]): Promise<PersonaCreative> {
    this.calls += 1
    return this.inner.generate(req)
  }
}
const REQ = {
  code: 'P26',
  life: {
    ageBand: '50대 초반', birthDate: '1973-03-08', region: '광역시', maritalStatus: '이혼',
    spouseRelationship: '해당없음', childrenCount: 1, childrenAgeBands: ['대학·취준' as const], childrenLiving: '동거' as const,
    workStatus: '파트타임', economicStatus: '빠듯', housing: '월세', menopauseStatus: '진행중', parentCare: '간헐',
  },
  voiceCore: { length: '짧은 문장', register: '존댓말', ending: '~요', emoji: '없음' },
}
const OK_BUDGET: CreativeBudget = {
  limits: { dailyUsd: 1, runRequestCap: 10, headroomMultiplier: 1.2 },
  tally: tallyOf([]), runPaid: 0, ledgerOk: true, settleHold: null, unresolved: [],
  countedInputTokens: 1_000, maxOutputTokens: 1_200,
}
{
  const spy = new SpyLive()
  const o = await runCreativeStep(spy, REQ, { budget: null, liveEnabled: true })
  check('🔴 예산 없이 유료 호출 시도 → CREATIVE_BUDGET_BLOCKED(NO_BUDGET) · provider 호출 0',
    !o.ok && o.code === 'CREATIVE_BUDGET_BLOCKED' && o.blockCode === 'NO_BUDGET' && spy.calls === 0)
  const noEnv = await runCreativeStep(spy, REQ, { budget: { ...OK_BUDGET, limits: { dailyUsd: null, runRequestCap: null, headroomMultiplier: null } }, liveEnabled: true })
  check('예산 env 미설정 → NO_BUDGET · 호출 0', !noEnv.ok && noEnv.blockCode === 'NO_BUDGET' && spy.calls === 0)
  const noCount = await runCreativeStep(spy, REQ, { budget: { ...OK_BUDGET, countedInputTokens: null }, liveEnabled: true })
  check('사전 계산 없음 → NO_COUNT · 호출 0', !noCount.ok && noCount.blockCode === 'NO_COUNT' && spy.calls === 0)
  const broke = await runCreativeStep(spy, REQ, { budget: { ...OK_BUDGET, limits: { ...OK_BUDGET.limits, dailyUsd: 0.000001 } }, liveEnabled: true })
  check('일일 여력 부족 → DAILY_EXHAUSTED · 호출 0', !broke.ok && broke.blockCode === 'DAILY_EXHAUSTED' && spy.calls === 0)
  const hold = await runCreativeStep(spy, REQ, { budget: { ...OK_BUDGET, settleHold: '정산 미기록' }, liveEnabled: true })
  check('정산 보류 표식 → SETTLE_ERROR · 호출 0', !hold.ok && hold.blockCode === 'SETTLE_ERROR' && spy.calls === 0)
  const off = await runCreativeStep(spy, REQ, { budget: OK_BUDGET, liveEnabled: false })
  check('🔴 예산이 열려도 liveEnabled=false 면 LIVE_CALL_NOT_EXECUTED · 호출 0', !off.ok && off.code === 'LIVE_CALL_NOT_EXECUTED' && spy.calls === 0)
  const on = await runCreativeStep(spy, REQ, { budget: OK_BUDGET, liveEnabled: true })
  check('예산 · liveEnabled 둘 다 열리면 그때만 부른다(게이트가 유일한 차단임을 확인)', on.ok && on.origin === 'live' && spy.calls === 1)
  const real = await runCreativeStep(new LiveCreativeProvider('gemini-3.7-flash'), REQ, { budget: OK_BUDGET, liveEnabled: true })
  check('실제 live provider 는 구현되지 않았다 — 불러도 LIVE_CALL_NOT_EXECUTED', !real.ok && real.code === 'LIVE_CALL_NOT_EXECUTED')
  const fx = new FixtureCreativeProvider()
  const f = await runCreativeStep(fx, REQ, { budget: null, liveEnabled: false })
  check('fixture 는 비용 0 — 예산 없이 서고 origin=fixture', f.ok && f.origin === 'fixture' && fx.calls === 1)
  check('creative 계약 — 성격이 비면 막는다', creativeProblems({ ...(f.ok ? f.creative : ({} as PersonaCreative)), personality: [] }).length > 0)
  const bad: CreativeProvider = {
    kind: 'fixture', model: 'fixture',
    generate: async (req) => ({ ...(await new FixtureCreativeProvider().generate(req)), noGoExpressions: ['따옴표 없는 표현'] }),
  }
  const badOut = await runCreativeStep(bad, REQ, { budget: null, liveEnabled: false })
  check('계약을 어긴 creative 는 쓰지 않는다 → CREATIVE_INVALID', !badOut.ok && badOut.code === 'CREATIVE_INVALID')
  const bud = readCreativeBudget({
    limits: { dailyUsd: null, runRequestCap: null, headroomMultiplier: null },
    runId: 'check', now: new Date('2026-09-29T00:00:00Z'), dir: mkdtempSync(join(tmpdir(), 'voice-supply-ledger-')),
  })
  check('장부 읽기(빈 임시 장부) — ledgerOk · 사전 계산 없음 · 쓰지 않는다', bud.ledgerOk && bud.countedInputTokens === null)
}

// ─────────────────────────────────────────────────────────
// ⑤ 후보 — 운영 검증기 · draft 게이트
// ─────────────────────────────────────────────────────────
console.log('⑤ 후보')
const POOL = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards
const CADENCE = { dailyCap: 3, weeklyCap: 12, silenceRate: 0.3, activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 } }
const NAMES = new Map([['P26', '해솔'], ['P27', '다온'], ['P28', '새봄']])
const runWith = (over: Partial<Parameters<typeof runVoiceSupply>[0]> = {}) => runVoiceSupply({
  plan, productionCodes: PRODUCTION_PERSONA_CODES, pool: POOL, takenCodes: new Set(POOL.map((c) => c.code)),
  provider: new FixtureCreativeProvider(), budget: null, liveEnabled: false,
  cadence: CADENCE, names: NAMES, gateOf: () => 'pass', allowFixture: true, ...over,
})
{
  const r = await runWith()
  check('P20~P25 말투 보충 6칸 — 각 묶음 · seed 공유 1', r.topUps.length === 6 && r.topUps.every((t) => t.comments >= 3 && t.seedShareCount === 1))
  const p26 = r.candidates.find((c) => c.code === 'P26')!
  check('P26 — 공급 말투 + 골격 + fixture creative → 운영 검증기 valid', p26.verdict.status === 'valid' && p26.verdict.blocks.length === 0)
  check('P26 — 글·댓글 자격 둘 다 참', p26.verdict.postEligible && p26.verdict.commentEligible)
  check('격리 DB 에서는 fixture 도 draft 가능', p26.draftable)
  const p28 = r.candidates.find((c) => c.code === 'P28')!
  check('P28 — 화자가 모자라 말투 없음 → NO_VOICE_EVIDENCE 격리 · creative 부르지 않음',
    p28.verdict.status === 'quarantined' && p28.verdict.blocks.includes('NO_VOICE_EVIDENCE') && p28.creativeOrigin === null)
  check('creative 는 말투 있는 후보에만 불렀다 (2회)', r.creativeCalls === 2)
  const prod = await runWith({ allowFixture: false })
  check('🔴 운영(격리 아님)에서는 fixture creative 후보를 draft 로 보내지 않는다',
    prod.candidates.every((c) => !c.draftable) && prod.candidates.find((c) => c.code === 'P26')!.draftBlock!.includes('fixture'))
  const live = await runWith({ provider: new LiveCreativeProvider('gemini-3.7-flash'), allowFixture: false })
  check('live provider · 예산 없음 → CREATIVE_BUDGET_BLOCKED · LLM_STEP_UNIMPLEMENTED 격리 · draft 0',
    live.candidates.filter((c) => c.creativeCode === 'CREATIVE_BUDGET_BLOCKED').length === 2
    && live.candidates.every((c) => !c.draftable && c.verdict.blocks.includes('LLM_STEP_UNIMPLEMENTED')))
  const drifted = await runWith({ plan: planOf(ALL8, () => new Map()) })
  check('운영 배정 drift 가 있으면 전원 VOICE_ASSIGNMENT_DRIFT 격리 · draft 0',
    drifted.candidates.every((c) => c.verdict.blocks.includes('VOICE_ASSIGNMENT_DRIFT') && !c.draftable))
  const real = await runWith({ gateOf: () => 'reject' })
  check('표시명 Gate ⑥-B reject → REAL_MEMBER_COLLISION 격리 · draft 0',
    real.candidates.every((c) => !c.draftable) && real.candidates.find((c) => c.code === 'P26')!.verdict.blocks.includes('REAL_MEMBER_COLLISION'))
  const taken = await runWith({ takenCodes: new Set([...POOL.map((c) => c.code), 'P26']) })
  check('이미 있는 코드 → CODE_TAKEN 격리 (재적재 방지)', taken.candidates.find((c) => c.code === 'P26')!.verdict.blocks.includes('CODE_TAKEN'))
}
{
  const nameOnly = judgeAutogenCandidate({
    code: 'P29', life: null, voice: null, creative: null, cadence: CADENCE,
    binding: { accountCount: 0, providerId: null }, displayName: { name: '새봄', gate: 'pass' },
  }, { takenCodes: new Set() })
  check('🔴 이름만 있는 후보 → rejected · draft 게이트가 막는다',
    nameOnly.status === 'rejected' && draftGate({ status: nameOnly.status, origin: 'live', allowFixture: true }) !== null)
  check('quarantined 도 draft 게이트가 막는다', draftGate({ status: 'quarantined', origin: 'live', allowFixture: true }) !== null)
  check('valid · live 는 통과', draftGate({ status: 'valid', origin: 'live', allowFixture: false }) === null)
  check('valid · creative 없음은 막는다', draftGate({ status: 'valid', origin: null, allowFixture: true }) !== null)
}

// ─────────────────────────────────────────────────────────
// ⑥ 입력 어댑터
// ─────────────────────────────────────────────────────────
console.log('⑥ 입력 어댑터')
{
  const raw = rowsFromRawContent([
    { sourceSite: 's1', sourceArticleId: 'a', rawComments: [{ body: '그러게요 정말로요', author: '봄바람' }, { body: '작성자 없는 댓글이에요' }] },
    { sourceSite: 's1', sourceArticleId: 'b', rawComments: null },
  ])
  check('rawComments — body 를 읽고 author 가 없으면 null', raw.length === 2 && raw[0]!.author === '봄바람' && raw[1]!.author === null)
  check('rawComments null 행은 0건', rowsFromRawContent([{ sourceSite: 's', sourceArticleId: 'x', rawComments: null }]).length === 0)
  const c = rowsFromCollectLine({ sourceSite: 's2', sourceArticleId: 'q', comments: [{ author: '달빛', content: '맞아요 저도 같은 생각' }, '맨 문자열 댓글이에요'] })
  check('수집 산출물 — {author,content} 는 화자, 맨 문자열은 작성자 없음', c.length === 2 && c[0]!.author === '달빛' && c[1]!.author === null)
  check('수집 산출물 — 댓글 칸이 없으면(현재 운영 모양) 0건', rowsFromCollectLine({ sourceSite: 's', commentCount: 12 }).length === 0)
}

// ─────────────────────────────────────────────────────────
// ⑦ CLI 연결
// ─────────────────────────────────────────────────────────
console.log('⑦ CLI 연결')
{
  const cli = readFileSync('scripts/persona-voice-supply.mts', 'utf-8')
  check('CLI 가 planVoiceSupply 로 계획한다', /planVoiceSupply\(\{/.test(cli))
  check('🔴 CLI 는 liveEnabled: false 만 넘긴다', /liveEnabled: false/.test(cli) && !/liveEnabled: true/.test(cli))
  const gate = cli.indexOf('if (!APPLY) {')
  const call = cli.indexOf('await applyAutogenDrafts(')
  check('적재는 --apply 게이트 뒤에서만 부른다', gate > 0 && call > gate)
  check('적재 대상은 draftable 만이다', /const plans = draftable\.map\(/.test(cli))
  check('fixture creative 적재는 격리 DB 에서만', /APPLY && CREATIVE === 'fixture' && !ISOLATED/.test(cli))
  check('대상 코드가 이미 있으면 다시 적재하지 않는다', /배정 보존 없이 다시 적재하지 않는다/.test(cli))
  check('정본 자산이 없으면 멈춘다', /if \(!canon\.ok\) fail\(/.test(cli))
  check('CLI 는 provider 호출 모듈·fetch 를 쓰지 않는다', !/voice-m3-provider|callProvider|fetch\(/.test(cli))
  const creative = readFileSync('scripts/lib/persona-voice-creative.mts', 'utf-8')
  check('creative 모듈은 provider 호출 모듈·장부 쓰기를 import 하지 않는다',
    !/voice-m3-provider|callProvider|appendLedgerLine|addOpenReservation|writeSettleHold/.test(creative))
}

// ─────────────────────────────────────────────────────────
// ⑧ 수집 시점 말투 근거 — salt 해시 · fail-closed · 공급까지 (Track C)
// ─────────────────────────────────────────────────────────
console.log('⑧ 수집 시점 말투 근거')
{
  const {
    captureVoiceEvidence, evidenceRowProblems, memberKeyOf, readEvidenceSalt, rowsFromVoiceEvidence,
    speakerHashOf, VOICE_EVIDENCE_RETENTION_DAYS, VOICE_EVIDENCE_SALT_ENV,
  } = await import('./lib/voice-evidence-capture.mjs')
  const SALT = readEvidenceSalt({ [VOICE_EVIDENCE_SALT_ENV]: 'check-salt-0123456789abcdef0123456789abcdef' })
  const OTHER = readEvidenceSalt({ [VOICE_EVIDENCE_SALT_ENV]: 'other-salt-0123456789abcdef0123456789abcdef' })
  const NOW = new Date('2026-09-29T00:00:00Z')
  const SRC = 'navercafe:testcafe'
  /** 수집기가 상세 화면에서 꺼내는 모양 그대로 — 작성자 표시 · 본문 문자열 둘 */
  const thread = (articleId: string, list: { author: string | null; text: string }[]) =>
    ({ source: SRC, articleId, comments: list, runId: 'r1', now: NOW })

  check('salt 없음 → SALT_MISSING', !readEvidenceSalt({}).ok)
  check('salt 32자 미만 → SALT_TOO_SHORT', (() => { const s = readEvidenceSalt({ [VOICE_EVIDENCE_SALT_ENV]: 'short' }); return !s.ok && s.code === 'SALT_TOO_SHORT' })())
  const clean = thread('t1', [0, 1, 2, 3].map((i) => ({ author: AUTHORS[0]!, text: line(0, i) })))
  const none = captureVoiceEvidence(clean, readEvidenceSalt({}))
  check('🔴 salt 없음 → 저장 0 (fail-closed)', !none.stored && none.rows.length === 0 && none.code === 'SALT_MISSING')
  const short = captureVoiceEvidence(clean, readEvidenceSalt({ [VOICE_EVIDENCE_SALT_ENV]: 'x'.repeat(10) }))
  check('🔴 짧은 salt → 저장 0', !short.stored && short.rows.length === 0)

  const cap = captureVoiceEvidence(thread('t2', [
    ...[0, 1, 2, 3].map((i) => ({ author: AUTHORS[0]!, text: line(0, i) })),
    { author: AUTHORS[1]!, text: '연락 주세요 010-1234-5678 이에요' },
    { author: AUTHORS[1]!, text: '메일 주세요 abc.def@example.com 이요' },
    { author: AUTHORS[1]!, text: `${AUTHORS[0]!}님 말이 맞아요 정말로` },
    { author: null, text: '작성자 없는 댓글이에요 정말' },
  ]), SALT)
  const flat = JSON.stringify(cap.rows)
  const ph = captureVoiceEvidence(thread('t2p', [
    ...[0, 1, 2, 3].map((i) => ({ author: AUTHORS[0]!, text: line(0, i) })),
    { author: AUTHORS[2]!, text: '삭제된 댓글입니다.' },
    { author: AUTHORS[2]!, text: '비밀 댓글입니다.' },
    { author: AUTHORS[3]!, text: '작성자에 의해 삭제된 댓글입니다' },
  ]), SALT)
  check('🔴 삭제·비밀 댓글 자리표시는 말투 근거로 남지 않는다', ph.stored && ph.rows.length === 4
    && ph.rows.every((r) => !/댓글입니다/.test(r.text)))
  check('깨끗한 댓글 4건만 남는다', cap.stored && cap.rows.length === 4)
  check('🔴 저장 행 어디에도 작성자 표시가 없다', AUTHORS.every((a) => !flat.includes(a)))
  check('🔴 개인정보 댓글은 저장되지 않는다(전화 · 이메일)', !/010-1234|example\.com/.test(flat) && cap.dropped.PII === 2)
  check('닉네임 혼입 · 작성자 없음은 버린다', cap.dropped.NICKNAME_LEAK === 1 && cap.dropped.UNATTRIBUTED === 1)
  check('speakerHash = salt HMAC (vs1:64hex) · memberKey = vm1:64hex',
    cap.rows.every((r) => r.speakerHash === speakerHashOf(SALT.ok ? SALT.salt : '', SRC, AUTHORS[0]!)
      && r.memberKey === memberKeyOf(SALT.ok ? SALT.salt : '', AUTHORS[0]!)))
  check('저장 행은 계약을 지킨다', cap.rows.every((r) => evidenceRowProblems(r, AUTHORS).length === 0))
  const other = captureVoiceEvidence(clean, OTHER)
  check('salt 가 다르면 같은 사람도 다른 해시다', other.rows[0]!.speakerHash !== cap.rows[0]!.speakerHash)
  check('🔴 작성자 칸이 끼어든 행은 계약 위반', evidenceRowProblems({ ...cap.rows[0]!, author: AUTHORS[0]! }).length > 0)
  check('🔴 모양은 맞아도 어느 칸에든 작성자 표시가 들어 있으면 계약 위반(수집기가 가진 이름으로 대조)',
    evidenceRowProblems({ ...cap.rows[0]!, runId: `r-${AUTHORS[0]!}` }, AUTHORS).some((p) => p.includes('작성자'))
    && evidenceRowProblems({ ...cap.rows[0]!, runId: `r-${AUTHORS[0]!}` }).length === 0)
  check('🔴 해시 대신 이름이 든 행은 계약 위반', evidenceRowProblems({ ...cap.rows[0]!, speakerHash: AUTHORS[0]! }).length > 0)
  check('🔴 개인정보 본문 행은 계약 위반', evidenceRowProblems({ ...cap.rows[0]!, text: '연락 주세요 010-1234-5678 이에요' }).length > 0)

  // ── 공급 시점 ──
  const members = { memberNames: [MEMBER], personaNames: ['새봄이'] }
  const real = captureVoiceEvidence(thread('t3', [0, 1, 2, 3].map((i) => ({ author: `${MEMBER}.`, text: line(7, i) }))), SALT)
  const store = JSON.parse(JSON.stringify([...cap.rows, ...real.rows])) as unknown[]
  const read = rowsFromVoiceEvidence(store, { salt: SALT, members, now: NOW })
  check('🔴 회원 표시명과 (N2) 같은 화자 → REAL_MEMBER_SPEAKER 로 전부 버린다', read.dropped.REAL_MEMBER_SPEAKER === 4 && read.rows.length === 4)
  check('🔴 공급 입력의 author 는 해시다', read.rows.every((r) => /^vs1:/.test(r.author ?? '')))
  const unm = rowsFromVoiceEvidence(store, { salt: SALT, members: null, now: NOW })
  check('🔴 회원 표시명을 못 읽었으면 전부 버린다', unm.rows.length === 0 && unm.dropped.REAL_MEMBER_UNMEASURED === 8)
  const noSalt = rowsFromVoiceEvidence(store, { salt: readEvidenceSalt({}), members, now: NOW })
  check('🔴 공급 쪽 salt 없음 → 전부 버린다', noSalt.rows.length === 0 && noSalt.dropped.SALT_MISSING === 8)
  const rotated = rowsFromVoiceEvidence(store, { salt: OTHER, members, now: NOW })
  check('🔴 salt 회전 → 전부 버린다(대조 불가)', rotated.rows.length === 0 && rotated.dropped.SALT_ROTATED === 8)
  const late = new Date(NOW.getTime() + (VOICE_EVIDENCE_RETENTION_DAYS + 1) * 86_400_000)
  check('보존 기한이 지나면 읽지 않는다', rowsFromVoiceEvidence(store, { salt: SALT, members, now: late }).dropped.EXPIRED === 8)
  const bad = rowsFromVoiceEvidence([{ ...cap.rows[0]!, author: AUTHORS[0]! }, null, 'x'], { salt: SALT, members, now: NOW })
  check('계약을 어긴 줄은 MALFORMED', bad.rows.length === 0 && bad.dropped.MALFORMED === 3)

  // ── 실제 삭제: 90일이 지나면 **파일에서** 지운다 (읽지 않는 것만으로는 보존 기한이 아니다) ──
  {
    const { purgeVoiceEvidence } = await import('./lib/voice-evidence-retention.mjs')
    const dir = join(HOME, 'purge-data')
    mkdirSync(dir, { recursive: true })
    const old = new Date(NOW.getTime() - (VOICE_EVIDENCE_RETENTION_DAYS + 1) * 86_400_000)
    const jl = (rows: object[]): string => rows.map((r) => `${JSON.stringify(r)}\n`).join('')
    const oldRows = captureVoiceEvidence({ ...clean, articleId: 'o1', now: old }, SALT).rows
    const newRows = cap.rows
    writeFileSync(join(dir, 'navercafe-voice-testcafe-old.voice-evidence.jsonl'), jl(oldRows))
    writeFileSync(join(dir, 'navercafe-voice-testcafe-new.voice-evidence.jsonl'), jl(newRows))
    writeFileSync(join(dir, 'navercafe-voice-testcafe-mix.voice-evidence.jsonl'), jl([...oldRows, ...newRows]))
    // 깨진 줄 — 나이는 파일 시각으로 잰다
    const brokenPath = join(dir, 'navercafe-voice-testcafe-broken.voice-evidence.jsonl')
    writeFileSync(brokenPath, '{not json\n')
    utimesSync(brokenPath, old, old)
    // 🔴 다른 산출물은 건드리지 않는다
    writeFileSync(join(dir, 'navercafe-thin-testcafe-old.thin-detail.jsonl'), jl(oldRows))
    const listing = (): string => readdirSync(dir).sort().join()
    const before = listing()
    const dry = purgeVoiceEvidence({ dataDir: dir, now: NOW, execute: false })
    check('삭제 계획만 — 파일 write 0', listing() === before && dry.totals.deletedFiles === 0 && dry.totals.rewrittenFiles === 0)
    check('계획이 기한 지난 줄을 센다(old 4 · mix 4 · 깨진 줄 1)', dry.totals.expired === oldRows.length * 2 + 1)
    const done = purgeVoiceEvidence({ dataDir: dir, now: NOW, execute: true })
    check('🔴 --execute — 전부 지난 파일은 지운다', !existsSync(join(dir, 'navercafe-voice-testcafe-old.voice-evidence.jsonl')) && !existsSync(brokenPath))
    const mix = readFileSync(join(dir, 'navercafe-voice-testcafe-mix.voice-evidence.jsonl'), 'utf-8').trim().split('\n')
    check('🔴 섞인 파일은 지난 줄만 빼고 다시 쓴다', mix.length === newRows.length && done.totals.rewrittenFiles === 1)
    check('기한 안 파일은 그대로', readFileSync(join(dir, 'navercafe-voice-testcafe-new.voice-evidence.jsonl'), 'utf-8') === jl(newRows))
    check('🔴 말투 근거가 아닌 파일은 건드리지 않는다', existsSync(join(dir, 'navercafe-thin-testcafe-old.thin-detail.jsonl')))
    check('다시 돌리면 할 일 0 (멱등)', purgeVoiceEvidence({ dataDir: dir, now: NOW, execute: true }).totals.expired === 0)
    // 삭제 요청 — salt 를 가진 사람만 화자를 특정할 수 있다
    const target = speakerHashOf(SALT.ok ? SALT.salt : '', SRC, AUTHORS[0]!)
    const req = purgeVoiceEvidence({ dataDir: dir, now: NOW, execute: true, speakerHashes: [target] })
    check('🔴 삭제 요청 화자의 줄을 지운다(남은 줄 0 → 파일도 삭제)',
      req.totals.requested === newRows.length * 2 && readdirSync(dir).filter((n) => n.endsWith('.voice-evidence.jsonl')).length === 0)
  }

  // ── 끝까지: 여러 글에 흩어진 댓글 → 저장 → 공급 → P20~P25 먼저 → P26·P27 valid ──
  const threads = [0, 1, 2].map((t) => thread(`e${t}`, AUTHORS.slice(0, 8).flatMap((a, s) =>
    Array.from({ length: 4 + (s % 3) }, (_, i) => i).filter((i) => i % 3 === t).map((i) => ({ author: a, text: line(s, i) })))))
  const saved = threads.flatMap((th) => captureVoiceEvidence(th, SALT).rows)
  check('글 3건에 흩어진 화자 8명 — 저장 행에 작성자 표시 0', saved.length === ALL8.length && AUTHORS.every((a) => !JSON.stringify(saved).includes(a)))
  const input = rowsFromVoiceEvidence(JSON.parse(JSON.stringify(saved)) as unknown[], { salt: SALT, members, now: NOW })
  const evPlan = planOf(input.rows)
  check('저장된 근거만으로 3건↑ 화자 8 · drift 0', evPlan.availableSpeakers === 8 && evPlan.drift.length === 0 && evPlan.ok)
  check('P20~P25 먼저 채운다', evPlan.slots.slice(0, 6).map((s) => s.code).join() === 'P20,P21,P22,P23,P24,P25')
  check('수집 시점 결과 = 직접 넣은 결과 (같은 배정)',
    JSON.stringify(evPlan.slots.map((s) => [s.code, s.bundle.comments])) === JSON.stringify(plan.slots.map((s) => [s.code, s.bundle.comments])))
  const evRun = await runWith({ plan: evPlan })
  const p26 = evRun.candidates.find((c) => c.code === 'P26')!
  check('P26 — 수집 근거 경로로도 운영 검증기 valid · draft 가능', p26.verdict.status === 'valid' && p26.draftable)
}

rmSync(HOME, { recursive: true, force: true })
console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
