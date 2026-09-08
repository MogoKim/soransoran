#!/usr/bin/env tsx
/**
 * Persona 매칭 규칙 fixture — 🔴 DB · 세션 · 네트워크 · LLM 없음
 *
 * 🔴 규칙을 스크립트 안에 두면 DB 없이는 검증할 수 없다.
 *    순수 함수로 빼 두었기 때문에 정체성 충돌을 **전수로** 확인할 수 있다.
 *
 * 실행: npx tsx scripts/original-post-persona-match-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readPostRequirements, hardFilter, scoreMatch, planMatch, planBatch, batchOrder,
  lengthBandOf, readLengthBand, isLengthBand, LENGTH_BANDS,
  isChildAgeBand, CHILD_AGE_BANDS, BLOCK_CODES, BLOCK_LABEL, SCORE_WEIGHTS,
  CARE_FIT, MENOPAUSE_FIT,
  POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS, TOP_CANDIDATES,
  type PersonaForMatch, type ChildAgeBand, type BlockCode, type BatchDraft,
} from '../src/lib/original-post-persona-match'
import { judgeRealMember } from '../src/lib/real-member-gate'

const HERE = dirname(fileURLToPath(import.meta.url))
const RULES = join(HERE, '..', 'src', 'lib', 'original-post-persona-match.ts')
const CLI = join(HERE, 'original-post-persona-match-dry-run.mts')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

/** 기본 페르소나 — 아무 조건도 막지 않는 상태 */
const base: PersonaForMatch = {
  code: 'PXX', status: 'active', providerId: null,
  // 🔴 운영 persona 는 로그인하지 않으므로 Account 0 이 정상이다
  accountCount: 0,
  maritalStatus: '기혼', childrenCount: 2, childrenAgeBands: ['중고등'],
  parentCare: '상시', menopauseStatus: '진행중', workStatus: '전업',
  economicStatus: '보통', region: null, noGoTopics: [], voiceLength: '보통',
  postsThisWeek: 0, daysSinceLastPost: null,
}
const P = (o: Partial<PersonaForMatch>): PersonaForMatch => ({ ...base, ...o })
const codesOf = (p: PersonaForMatch, title: string, body: string): BlockCode[] =>
  hardFilter(p, readPostRequirements(title, body), title, body).map((x) => x.code)

console.log('\n══ Persona 매칭 규칙 fixture ══\n')

// ── ① 요구 조건 추출 ──
{
  const offenders: string[] = []
  const r1 = readPostRequirements('고3 딸 때문에', '수능이 코앞인데 애가 공부를 안 해요')
  if (!r1.needsChildren) offenders.push('자녀 미검출')
  if (!r1.needsChildAgeBands.includes('중고등')) offenders.push(`나이대=${r1.needsChildAgeBands.join(',')}`)

  const r2 = readPostRequirements('남편이 또', '남편이 어제도 늦게 들어왔어요')
  if (!r2.needsCurrentSpouse) offenders.push('현재형 배우자 미검출')

  // 🔴 전남편은 현재형이 아니다 — 과차단도 사고다
  const r3 = readPostRequirements('전남편 이야기', '전남편이 연락을 해왔어요. 헤어진 남편인데')
  if (r3.needsCurrentSpouse) offenders.push('🔴 전남편이 현재형으로 잡힘')

  const r4 = readPostRequirements('친정엄마', '친정엄마 병간호를 하고 있어요')
  if (!r4.needsParentCare) offenders.push('돌봄 미검출')

  const r5 = readPostRequirements('요즘', '갱년기가 와서 열이 확 올라요')
  if (!r5.needsMenopauseExperience) offenders.push('갱년기 미검출')

  const r6 = readPostRequirements('오늘 점심', '국수를 삶았는데 맛있었어요')
  if (r6.labels.length !== 0) offenders.push(`조건 없는 글에 조건이 붙음: ${r6.labels.join(',')}`)

  if (offenders.length) bad('요구 조건 추출', offenders.join(' / '))
  else ok('요구 조건 추출', '자녀·나이대·배우자·전남편 구분·돌봄·갱년기·무조건 글')
}

// ── ② 🔴 자녀 나이대 충돌 (창업자 예시) ──
{
  const title = '고3 딸 때문에 속이 타네요'
  const body = '수능이 얼마 안 남았는데 딸이 공부를 놓았어요.'
  const offenders: string[] = []

  // 🔴 30살 딸(성인) 페르소나가 고3(중고등) 글을 쓰면 안 된다
  const grown = codesOf(P({ childrenAgeBands: ['성인'] }), title, body)
  if (!grown.includes('CHILD_AGE_CONFLICT')) offenders.push('🔴 성인 자녀 페르소나가 고3 글을 통과함')

  // 맞는 사람은 통과
  const fit = codesOf(P({ childrenAgeBands: ['중고등'] }), title, body)
  if (fit.length !== 0) offenders.push(`맞는 페르소나가 막힘: ${fit.join(',')}`)

  // 여러 밴드 중 하나만 맞아도 통과 — 자녀가 둘이면 나이가 다르다
  const multi = codesOf(P({ childrenCount: 2, childrenAgeBands: ['성인', '중고등'] }), title, body)
  if (multi.length !== 0) offenders.push(`복수 밴드가 막힘: ${multi.join(',')}`)

  // 🔴 미기재는 통과가 아니다 — 모르면 막는다
  const unknown = codesOf(P({ childrenAgeBands: undefined }), title, body)
  if (!unknown.includes('CHILD_AGE_UNKNOWN')) offenders.push('🔴 미기재가 통과됨')
  if (unknown.includes('CHILD_AGE_CONFLICT')) offenders.push('미기재가 충돌로 잘못 분류됨')

  // 무자녀는 나이대 이전에 NO_CHILDREN
  const none = codesOf(P({ childrenCount: 0, childrenAgeBands: [] }), title, body)
  if (!none.includes('NO_CHILDREN')) offenders.push('🔴 무자녀가 자녀 글을 통과함')

  if (offenders.length) bad('🔴 자녀 나이대 충돌', offenders.join(' / '))
  else ok('🔴 자녀 나이대 충돌', '성인↔고3 차단 · 일치 통과 · 복수 밴드 통과 · 미기재 차단 · 무자녀 차단')
}

// ── ③ 결혼 상태 충돌 ──
{
  const t = '남편 흉 좀 볼게요'; const b = '남편이 요즘 말을 안 들어요.'
  const offenders: string[] = []
  for (const st of ['비혼', '이혼', '사별']) {
    if (!codesOf(P({ maritalStatus: st }), t, b).includes('MARITAL_CONFLICT')) offenders.push(`🔴 ${st} 통과`)
  }
  if (codesOf(P({ maritalStatus: '기혼' }), t, b).length !== 0) offenders.push('기혼이 막힘')
  // 🔴 이혼 페르소나가 전남편 글을 쓰는 것은 정상이다
  const ex = codesOf(P({ maritalStatus: '이혼' }), '전남편 연락', '전남편이 갑자기 연락을 했어요.')
  if (ex.includes('MARITAL_CONFLICT')) offenders.push('🔴 이혼 페르소나가 전남편 글에서 막힘 (과차단)')
  if (offenders.length) bad('결혼 상태 충돌', offenders.join(' / '))
  else ok('결혼 상태 충돌', '비혼·이혼·사별 차단 · 기혼 통과 · 전남편 글은 이혼도 가능')
}

// ── ④ 돌봄 · 갱년기 ──
{
  const offenders: string[] = []
  const care = ['친정엄마 병간호 중이에요', '친정']
  if (!codesOf(P({ parentCare: '없음' }), care[1]!, care[0]!).includes('NO_PARENT_CARE')) offenders.push('🔴 돌봄없음 통과')
  if (!codesOf(P({ parentCare: null }), care[1]!, care[0]!).includes('NO_PARENT_CARE')) offenders.push('🔴 돌봄 null 통과')
  if (codesOf(P({ parentCare: '간헐' }), care[1]!, care[0]!).length !== 0) offenders.push('간헐이 막힘')

  const men = ['갱년기가 와서 힘드네요', '갱년기']
  if (!codesOf(P({ menopauseStatus: '전' }), men[1]!, men[0]!).includes('MENOPAUSE_NOT_YET')) offenders.push('🔴 갱년기 전 통과')
  // 🔴 '후' 는 경험이 있다. 막으면 안 된다
  for (const st of ['진행중', '후']) {
    if (codesOf(P({ menopauseStatus: st }), men[1]!, men[0]!).length !== 0) offenders.push(`${st} 가 막힘`)
  }
  if (offenders.length) bad('돌봄 · 갱년기', offenders.join(' / '))
  else ok('돌봄 · 갱년기', '돌봄없음·null 차단 · 간헐 통과 · 갱년기 전 차단 · 진행중/후 통과')
}

// ── ⑤ 운영 조건 · noGo · 리듬 ──
{
  const t = '오늘'; const b = '국수를 삶았어요.'
  const offenders: string[] = []
  for (const st of ['draft', 'paused', 'retired']) {
    if (!codesOf(P({ status: st }), t, b).includes('NOT_ACTIVE')) offenders.push(`🔴 ${st} 통과`)
  }
  if (codesOf(P({ status: 'active' }), t, b).length !== 0) offenders.push('active 가 막힘')
  // 🔴 실회원 이름으로 발행되면 신뢰 사고다
  if (!codesOf(P({ providerId: 'kakao_123' }), t, b).includes('REAL_MEMBER')) offenders.push('🔴 실회원 통과')

  const nogo = codesOf(P({ noGoTopics: ['시어머니 험담'] }), '오늘', '시어머니 험담 좀 할게요.')
  if (!nogo.includes('NOGO_TOPIC')) offenders.push('🔴 noGo 통과')
  // 🔴 빈 문자열이 모든 글에 걸리면 안 된다
  if (codesOf(P({ noGoTopics: ['', '  '] }), t, b).includes('NOGO_TOPIC')) offenders.push('🔴 빈 noGo 가 걸림')

  if (!codesOf(P({ postsThisWeek: POST_CAP_PER_WEEK }), t, b).includes('WEEKLY_CAP')) offenders.push('🔴 주 상한 통과')
  if (!codesOf(P({ daysSinceLastPost: MIN_DAYS_BETWEEN_POSTS - 1 }), t, b).includes('TOO_SOON')) offenders.push('🔴 간격 미달 통과')
  if (codesOf(P({ daysSinceLastPost: MIN_DAYS_BETWEEN_POSTS }), t, b).includes('TOO_SOON')) offenders.push('간격 딱 맞는데 막힘')
  if (codesOf(P({ daysSinceLastPost: null }), t, b).length !== 0) offenders.push('첫 글이 막힘')

  if (offenders.length) bad('운영 조건 · noGo · 리듬', offenders.join(' / '))
  else ok('운영 조건 · noGo · 리듬', `draft/paused/retired · 실회원 · noGo · 주 ${POST_CAP_PER_WEEK}건 · ${MIN_DAYS_BETWEEN_POSTS}일 간격`)
}

// ── ⑥ 🔴 매칭 실패 시 발행하지 않는다 ──
{
  const offenders: string[] = []
  const none = planMatch({
    queueId: 'q1', title: '고3 딸', body: '수능이 코앞이에요.',
    personas: [P({ code: 'A', childrenCount: 0, childrenAgeBands: [] }), P({ code: 'B', status: 'draft' })],
  })
  if (none.publishable) offenders.push('🔴 후보가 없는데 발행 가능')
  if (none.recommended !== null) offenders.push('🔴 후보가 없는데 추천이 나옴')
  if (none.eligible.length !== 0) offenders.push('후보가 잘못 잡힘')
  if (none.blocked.length !== 2) offenders.push(`차단 기록 ${none.blocked.length} (기대 2)`)

  const empty = planMatch({ queueId: 'q2', title: 'x', body: 'y', personas: [] })
  if (empty.publishable || empty.recommended !== null) offenders.push('🔴 페르소나 0명인데 발행 가능')

  if (offenders.length) bad('🔴 실패 시 발행 불가', offenders.join(' / '))
  else ok('🔴 실패 시 발행 불가', '후보 0 → publishable=false · recommended=null · 차단 사유 보존')
}

// ── ⑦ 🔴 최고점 고정이 아니다 · 상위 3명 ──
{
  const offenders: string[] = []
  const many = Array.from({ length: 6 }, (_, i) => P({ code: `P${i}`, daysSinceLastPost: i * 3 }))
  const plan = planMatch({ queueId: 'seed-a', title: '오늘', body: '국수를 삶았어요.', personas: many })
  if (plan.top.length !== TOP_CANDIDATES) offenders.push(`top ${plan.top.length} (기대 ${TOP_CANDIDATES})`)
  if (plan.recommended === null || !plan.top.some((c) => c.code === plan.recommended)) offenders.push('🔴 추천이 상위 밖')
  // 점수 내림차순인가
  for (let i = 1; i < plan.eligible.length; i += 1) {
    if (plan.eligible[i - 1]!.score.total < plan.eligible[i]!.score.total) offenders.push('정렬 깨짐')
  }
  // 🔴 재현성 — 같은 queueId 는 같은 답
  const again = planMatch({ queueId: 'seed-a', title: '오늘', body: '국수를 삶았어요.', personas: many })
  if (again.recommended !== plan.recommended) offenders.push('🔴 같은 seed 인데 답이 달라짐')
  // 🔴 최고점 고정이 아님 — seed 를 바꾸면 다른 답이 나올 수 있어야 한다
  const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']
    .map((s) => planMatch({ queueId: s, title: '오늘', body: '국수를 삶았어요.', personas: many }).recommended)
  if (new Set(seeds).size < 2) offenders.push('🔴 seed 를 바꿔도 항상 같은 1명 — 최고점 고정이다')

  if (offenders.length) bad('상위 3명 · 가중 무작위', offenders.join(' / '))
  else ok('상위 3명 · 가중 무작위', `top ${TOP_CANDIDATES} · 재현 가능 · seed 8종에서 ${new Set(seeds).size}명 분산`)
}

// ── ⑧ 점수 ──
{
  const offenders: string[] = []
  const MAX = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)
  if (MAX !== 100) offenders.push(`가중 합 ${MAX} (기대 100)`)
  const req = readPostRequirements('고3 딸', '수능이 코앞이에요.')
  const s = scoreMatch(P({ daysSinceLastPost: 30, voiceLength: lengthBandOf(11) }), req, 11)
  if (s.total > MAX) offenders.push(`총점 ${s.total} > ${MAX}`)
  if (s.breakdown.lifeConsistency !== SCORE_WEIGHTS.lifeConsistency) offenders.push('통과자 생활사 만점 아님')
  // 🔴 최근에 쓴 사람이 감점되는가
  const fresh = scoreMatch(P({ daysSinceLastPost: 30 }), req, 300)
  const recent = scoreMatch(P({ daysSinceLastPost: 6 }), req, 300)
  if (!(fresh.total > recent.total)) offenders.push('🔴 활동 분산이 감점으로 작동하지 않음')
  if (lengthBandOf(100) !== '짧게' || lengthBandOf(300) !== '보통' || lengthBandOf(900) !== '길게') offenders.push('길이 밴드 오류')
  if (offenders.length) bad('점수', offenders.join(' / '))
  else ok('점수', `가중 합 100 · 활동 분산 감점 동작 (${fresh.total} > ${recent.total})`)
}

// ── ⑨ 상수 · 라벨 정합 ──
{
  const offenders: string[] = []
  for (const c of BLOCK_CODES) if (!BLOCK_LABEL[c]) offenders.push(`${c} 라벨 없음`)
  if (Object.keys(BLOCK_LABEL).length !== BLOCK_CODES.length) offenders.push('라벨 수 불일치')
  if (new Set(CHILD_AGE_BANDS).size !== CHILD_AGE_BANDS.length) offenders.push('밴드 중복')
  for (const b of CHILD_AGE_BANDS) if (!isChildAgeBand(b)) offenders.push(`${b} 판별 실패`)
  for (const v of ['고3', '초등학교', '', 'adult']) if (isChildAgeBand(v)) offenders.push(`🔴 "${v}" 가 밴드로 통과`)
  if (offenders.length) bad('상수 · 라벨 정합', offenders.join(' / '))
  else ok('상수 · 라벨 정합', `차단 ${BLOCK_CODES.length}종 전부 라벨 · 밴드 ${CHILD_AGE_BANDS.length}종`)
}

// ── ⑩ 🔴 규칙 모듈이 순수한가 ──
{
  const code = readFileSync(RULES, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []
  for (const k of ['PrismaClient', 'prisma.', 'fetch(', 'node:fs', 'process.env', 'Math.random']) {
    if (code.includes(k)) offenders.push(`🔴 ${k} 가 있다`)
  }
  /**
   * 🔴 **순수 lib 만 허용한다** (2026-09-08).
   *    이 검사의 의도는 "DB · 네트워크 · 시각 · 난수에 의존하지 않는다" 이지
   *    "아무것도 부르지 않는다" 가 아니다. 실회원 판정을 단일 정본으로 두려면
   *    그 lib 을 불러야 하는데, import 를 전부 막으면 **판정을 복붙하게 된다** —
   *    그쪽이 훨씬 나쁘다. 허용 목록을 좁게 두고, 새 import 는 여기서 걸린다.
   */
  const ALLOWED_IMPORTS = ['./real-member-gate'] as const
  for (const line of code.split('\n')) {
    const m = /^import .*from '([^']+)'/.exec(line.trim())
    if (m === null) continue
    if (!(ALLOWED_IMPORTS as readonly string[]).includes(m[1]!)) {
      offenders.push(`🔴 허용되지 않은 import: ${m[1]}`)
    }
  }
  if (offenders.length) bad('규칙 모듈은 순수', offenders.join(' / '))
  else ok('규칙 모듈은 순수', `순수 lib ${ALLOWED_IMPORTS.length}종만 · DB 0 · 네트워크 0 · env 0 · Math.random 0(seed 고정)`)
}

// ── ⑪ 🔴 소스 스캔 — dry-run 이 정말 읽기만 하는가 ──
{
  const code = readFileSync(CLI, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []
  const writes = [...code.matchAll(/prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)]
  if (writes.length > 0) offenders.push(`🔴 DB write 가 있다: ${writes.map((m) => m[0]).join(' · ')}`)
  if (code.includes('$transaction')) offenders.push('🔴 트랜잭션이 있다')
  // 🔴 이 파일에는 --apply 가 없다.
  //    "--apply 가 없습니다" 라고 **출력하는 문구**까지 막으면 안 된다 —
  //    플래그를 **읽는 코드**만 본다.
  if (/argv\.includes\(\s*['"]--apply['"]\s*\)/.test(code)) offenders.push('🔴 --apply 를 읽는다')
  if (/\barg\(\s*['"]apply['"]\s*\)/.test(code)) offenders.push('🔴 --apply 를 읽는다')
  for (const k of ['fetch(', 'anthropic', 'openai', 'googleapis', 'voice-m3-provider']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  // 🔴 규칙을 다시 만들지 않는다. planBatch · planMatch 중 하나는 반드시 부른다
  if (!code.includes('planBatch(') && !code.includes('planMatch(')) {
    offenders.push('🔴 planBatch · planMatch 를 부르지 않는다 — 규칙을 다시 만들었나')
  }
  // 🔴 점수를 CLI 에서 다시 계산하지 않는다 — 두 개의 진실이 생긴다
  if (code.includes('scoreMatch(')) offenders.push('🔴 CLI 가 점수를 다시 계산한다')
  if (!code.includes('writeFileSync')) { /* 정상 — 파일도 쓰지 않는다 */ } else offenders.push('🔴 파일을 쓴다')
  if (offenders.length) bad('dry-run 경계', offenders.join(' / '))
  else ok('dry-run 경계', 'DB write 0 · 트랜잭션 0 · --apply 없음 · 네트워크 0 · 파일 write 0')
}


// ── ⑫ 🔴 점수 3단 보정 — all-or-nothing 을 쓰지 않는다 ──
{
  const offenders: string[] = []
  const careReq = readPostRequirements('친정엄마', '친정엄마 병간호를 하고 있어요')
  const always = scoreMatch(P({ parentCare: '상시' }), careReq, 300)
  const sometimes = scoreMatch(P({ parentCare: '간헐' }), careReq, 300)
  // 🔴 간헐은 0 이 아니다 — 하드 필터를 통과했다는 것은 경험이 있다는 뜻이다
  if (sometimes.breakdown.topicFit === 0) offenders.push('🔴 간헐이 여전히 0점')
  if (!(always.breakdown.topicFit > sometimes.breakdown.topicFit)) offenders.push('상시 > 간헐 이 아니다')
  const wantCare = Math.round(CARE_FIT['간헐']! * SCORE_WEIGHTS.topicFit)
  if (sometimes.breakdown.topicFit !== wantCare) offenders.push(`간헐 ${sometimes.breakdown.topicFit} (기대 ${wantCare})`)

  const menoReq = readPostRequirements('요즘', '갱년기가 와서 열이 확 올라요')
  const now = scoreMatch(P({ menopauseStatus: '진행중' }), menoReq, 300)
  const after = scoreMatch(P({ menopauseStatus: '후' }), menoReq, 300)
  if (after.breakdown.topicFit === 0) offenders.push('🔴 갱년기 후가 여전히 0점')
  if (!(now.breakdown.topicFit > after.breakdown.topicFit)) offenders.push('진행중 > 후 가 아니다')
  const wantMeno = Math.round(MENOPAUSE_FIT['후']! * SCORE_WEIGHTS.topicFit)
  if (after.breakdown.topicFit !== wantMeno) offenders.push(`후 ${after.breakdown.topicFit} (기대 ${wantMeno})`)

  if (offenders.length) bad('🔴 점수 3단 보정', offenders.join(' / '))
  else ok('🔴 점수 3단 보정', `간헐 ${sometimes.breakdown.topicFit}점 · 갱년기 후 ${after.breakdown.topicFit}점 — 0점 아님`)
}

// ── ⑬ 🔴 죽은 축 제거 — 하드 필터가 보장하는 것은 점수로 세지 않는다 ──
{
  const offenders: string[] = []
  // 기혼·자녀만 요구하는 글: 통과자는 전원 만점이어야 한다(변별 없음)
  const req = readPostRequirements('남편이랑 딸', '남편이랑 딸 이야기예요')
  if (!req.needsCurrentSpouse || !req.needsChildren) offenders.push('요구 추출 실패')
  const s = scoreMatch(P({}), req, 300)
  if (s.breakdown.topicFit !== SCORE_WEIGHTS.topicFit) {
    offenders.push(`죽은 축이 점수에 남아 있다: topicFit ${s.breakdown.topicFit}`)
  }
  // 🔴 돌봄이 섞이면 그 축만으로 갈려야 한다 — 죽은 축이 평균을 희석하면 안 된다
  const mixed = readPostRequirements('남편이랑 딸', '남편이랑 딸 이야기인데 친정엄마 병간호도 해요')
  const a = scoreMatch(P({ parentCare: '상시' }), mixed, 300)
  const b2 = scoreMatch(P({ parentCare: '간헐' }), mixed, 300)
  if (a.breakdown.topicFit - b2.breakdown.topicFit !== always0Diff()) {
    offenders.push(`희석됨: 상시 ${a.breakdown.topicFit} · 간헐 ${b2.breakdown.topicFit}`)
  }
  if (offenders.length) bad('🔴 죽은 축 제거', offenders.join(' / '))
  else ok('🔴 죽은 축 제거', '배우자·자녀는 점수에서 빠짐 · 돌봄 축이 희석되지 않음')
}
function always0Diff(): number {
  return Math.round(SCORE_WEIGHTS.topicFit) - Math.round(CARE_FIT['간헐']! * SCORE_WEIGHTS.topicFit)
}

// ── ⑭ 🔴 처리 순서 — 후보 적은 초안 먼저 ──
{
  const offenders: string[] = []
  const mk = (id: string, n: number, g: string, t: number): { eligibleCount: number; gateVerdict: string; createdAt: number; queueId: string } =>
    ({ queueId: id, eligibleCount: n, gateVerdict: g, createdAt: t })
  if (batchOrder(mk('a', 1, 'HOLD', 100), mk('b', 5, 'PASS', 0)) >= 0) offenders.push('🔴 후보 적은 쪽이 뒤로 감')
  if (batchOrder(mk('a', 3, 'PASS', 100), mk('b', 3, 'HOLD', 0)) >= 0) offenders.push('동수일 때 PASS 가 뒤로 감')
  if (batchOrder(mk('a', 3, 'PASS', 0), mk('b', 3, 'PASS', 100)) >= 0) offenders.push('동수·동등급에서 createdAt 정렬 실패')
  if (batchOrder(mk('a', 3, 'PASS', 0), mk('b', 3, 'PASS', 0)) >= 0) offenders.push('완전 동률에서 queueId 정렬 실패')
  // 🔴 결정적이어야 한다 — 같은 입력이면 같은 순서
  if (batchOrder(mk('x', 2, 'PASS', 5), mk('x', 2, 'PASS', 5)) !== 0) offenders.push('자기 자신과 비교가 0 이 아니다')
  if (offenders.length) bad('🔴 처리 순서', offenders.join(' / '))
  else ok('🔴 처리 순서', '후보 적은 순 → PASS 우선 → createdAt → queueId')
}

// ── ⑮ 🔴 주간 여력 차감 — 쏠림이 반복되지 않는다 ──
{
  const offenders: string[] = []
  // 조건 없는 글 5건 · 페르소나 3명 → 주 1건이면 3건만 배정되어야 한다
  const ds: BatchDraft[] = Array.from({ length: 5 }, (_, i) =>
    ({ queueId: `q${i}`, title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: i }))
  const ps = ['A', 'B', 'C'].map((c) => P({ code: c }))
  const plan = planBatch(ds, ps)
  const assigned = plan.assignments.filter((a) => a.assigned !== null)
  if (assigned.length !== 3) offenders.push(`배정 ${assigned.length} (기대 3 — 3명 × 주 ${POST_CAP_PER_WEEK}건)`)
  // 🔴 아무도 두 번 배정되지 않는다
  for (const [code, n] of Object.entries(plan.load)) {
    if (n > POST_CAP_PER_WEEK) offenders.push(`🔴 ${code} 가 ${n}건 — 상한 ${POST_CAP_PER_WEEK}`)
  }
  if (new Set(assigned.map((a) => a.assigned)).size !== assigned.length) offenders.push('🔴 같은 사람이 두 번 배정됨')
  // 밀린 건은 '불가' 가 아니라 '밀림' 이다
  const deferred = plan.assignments.filter((a) => a.assigned === null && a.eligible.length > 0)
  if (deferred.length !== 2) offenders.push(`밀림 ${deferred.length} (기대 2)`)
  if (deferred.some((a) => a.deferredBy.length === 0)) offenders.push('밀린 사유가 비어 있다')
  // 🔴 이미 이번 주에 쓴 사람은 처음부터 여력 0
  const used = planBatch(ds.slice(0, 1), [P({ code: 'A', postsThisWeek: POST_CAP_PER_WEEK })])
  if (used.assignments[0]!.assigned !== null) offenders.push('🔴 여력 소진자가 배정됨')

  if (offenders.length) bad('🔴 주간 여력 차감', offenders.join(' / '))
  else ok('🔴 주간 여력 차감', `5건 × 3명 → 배정 3 · 밀림 2 · 중복 0 · 소진자 제외`)
}

// ── ⑯ 🔴 희소한 글이 먼저 보호된다 ──
{
  const offenders: string[] = []
  // 고3 글은 A 만 가능 · 조건 없는 글은 누구나
  const ds: BatchDraft[] = [
    { queueId: 'open1', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0 },
    { queueId: 'open2', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 1 },
    { queueId: 'rare', title: '고3 딸', body: '수능이 코앞이에요.', gateVerdict: 'HOLD', createdAt: 2 },
  ]
  const ps = [
    P({ code: 'A', childrenAgeBands: ['중고등'] }),
    P({ code: 'B', childrenAgeBands: ['성인'] }),
  ]
  const plan = planBatch(ds, ps)
  const rare = plan.assignments.find((a) => a.queueId === 'rare')!
  // 🔴 입력 순서로는 마지막이지만, 후보가 1명뿐이라 먼저 배정되어야 한다
  if (rare.assigned !== 'A') offenders.push(`🔴 희소 글이 배정되지 않음: ${rare.assigned ?? '없음'}`)
  if (rare.eligible.length !== 1) offenders.push(`희소 글 후보 ${rare.eligible.length} (기대 1)`)
  // 입력 순서가 보존되는가
  if (plan.assignments.map((a) => a.queueId).join(',') !== 'open1,open2,rare') offenders.push('출력이 입력 순서가 아니다')
  if (offenders.length) bad('🔴 희소한 글 우선', offenders.join(' / '))
  else ok('🔴 희소한 글 우선', '후보 1명뿐인 글이 먼저 배정됨 · 출력은 입력 순서 유지')
}


// ── ⑰ 🔴 말투 길이 밴드 — 자유 문장을 읽는다 ──
{
  const offenders: string[] = []
  // 초안 길이 → 밴드
  if (lengthBandOf(100) !== '짧게' || lengthBandOf(300) !== '보통' || lengthBandOf(900) !== '길게') {
    offenders.push('초안 길이 밴드 오류')
  }
  if (lengthBandOf(249) !== '짧게' || lengthBandOf(250) !== '보통') offenders.push('짧게/보통 경계 오류')
  if (lengthBandOf(500) !== '보통' || lengthBandOf(501) !== '길게') offenders.push('보통/길게 경계 오류')

  // 🔴 실측 DB 값이 전부 읽혀야 한다 (2026-09-02)
  const REAL: [string, string][] = [
    ['짧고 툭툭', '짧게'],   // P05
    ['중간', '보통'],        // P07 · P10
    ['짧고 정확', '짧게'],   // P15
    ['길게', '길게'],        // P17
  ]
  for (const [raw, want] of REAL) {
    const got = readLengthBand(raw)
    if (got !== want) offenders.push(`🔴 "${raw}" → ${got ?? 'null'} (기대 ${want})`)
  }
  // 지시된 별칭
  for (const [raw, want] of [['짧음', '짧게'], ['중간 길이', '보통'], ['보통', '보통'], ['길게 씀', '길게']] as [string, string][]) {
    const got = readLengthBand(raw)
    if (got !== want) offenders.push(`🔴 "${raw}" → ${got ?? 'null'} (기대 ${want})`)
  }
  // 🔴 "중간 길이" 는 '길' 을 품는다 — 순서가 틀리면 길게로 샌다
  if (readLengthBand('중간 길이') === '길게') offenders.push('🔴 "중간 길이" 가 길게로 샜다 — 별칭 순서')
  // 밴드 그대로도 통과
  for (const b of LENGTH_BANDS) if (readLengthBand(b) !== b) offenders.push(`밴드 "${b}" 가 안 읽힘`)
  // 🔴 못 읽으면 null — 하드 차단하지 않는다
  for (const v of [null, undefined, '', '   ', '알 수 없음']) {
    if (readLengthBand(v) !== null) offenders.push(`🔴 "${String(v)}" 가 밴드로 읽힘`)
  }
  // 🔴 영어 어휘는 남기지 않았다 — 호환 경로를 두면 죽은 축이 되살아난다
  for (const v of ['short', 'medium', 'long']) {
    if (readLengthBand(v) !== null) offenders.push(`🔴 영어 "${v}" 가 읽힘 — 어휘가 남아 있다`)
    if (isLengthBand(v)) offenders.push(`🔴 영어 "${v}" 가 밴드로 판별됨`)
  }
  if (offenders.length) bad('🔴 말투 길이 밴드', offenders.join(' / '))
  else ok('🔴 말투 길이 밴드', `실측 4종 · 별칭 4종 · 경계 · "중간 길이" 순서 · 미상 null · 영어 거부`)
}

// ── ⑱ 🔴 voiceFit 이 더 이상 5점 고정이 아니다 ──
{
  const offenders: string[] = []
  const req = readPostRequirements('오늘', '국수를 삶았어요.')
  const CHARS = 300  // 보통 밴드
  const fit = (voiceLength: string | null) => scoreMatch(P({ voiceLength }), req, CHARS).breakdown.voiceFit

  const full = fit('중간')        // 보통 ↔ 보통 → 만점
  const miss = fit('짧고 툭툭')    // 짧게 ↔ 보통 → 감점
  const neutral = fit(null)       // 모름 → 중립
  if (full !== SCORE_WEIGHTS.voiceFit) offenders.push(`🔴 일치가 만점이 아니다: ${full}`)
  if (!(full > neutral && neutral > miss)) offenders.push(`순서가 만점>중립>불일치 가 아니다: ${full}/${neutral}/${miss}`)
  // 🔴 세 값이 서로 달라야 축이 살아 있다
  if (new Set([full, miss, neutral]).size !== 3) offenders.push(`🔴 값이 뭉쳤다: ${full}/${miss}/${neutral}`)
  // 🔴 회귀 방지 — 예전 버그는 자유 문장이 언제나 불일치로 떨어지는 것이었다
  if (fit('중간') === fit('짧고 툭툭')) offenders.push('🔴 자유 문장이 구분되지 않는다 (E-1 버그 재발)')

  if (offenders.length) bad('🔴 voiceFit 5점 고정 해소', offenders.join(' / '))
  else ok('🔴 voiceFit 5점 고정 해소', `일치 ${full} · 중립 ${neutral} · 불일치 ${miss} — 세 값이 갈린다`)
}

// ── ⑱ 🔴 단조성 — persona 를 늘렸는데 배정이 줄어들면 안 된다 (2026-09-07 사고) ──
//
//    실측 사고: 현재 5명 + N01 N02 N03 은 14일 13건이었는데, 무자녀 persona N04 를
//    **더했더니** 10건으로 줄었다. N04 가 나쁜 것이 아니라 탐욕법이 순서에 의존했기 때문이다.
//    최대 매칭은 그래프에 정점·간선만 늘어나므로 크기가 줄어들 수 없다.
{
  const offenders: string[] = []
  // 자녀 중고등 글 1건(A 만 가능) + 조건 없는 글 3건
  const ds: BatchDraft[] = [
    { queueId: 'kid', title: '중학생 딸', body: '딸이 사춘기라 힘들어요.', gateVerdict: 'PASS', createdAt: 0 },
    { queueId: 'open1', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 1 },
    { queueId: 'open2', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 2 },
    { queueId: 'open3', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 3 },
  ]
  const A = P({ code: 'A', childrenCount: 1, childrenAgeBands: ['중고등'] })
  const B = P({ code: 'B', childrenCount: 0, childrenAgeBands: [] })
  const C = P({ code: 'C', childrenCount: 1, childrenAgeBands: ['성인'] })
  // 🔴 D 가 사고를 낸 N04 역할 — 무자녀 · 조건 없는 글만 맡을 수 있다
  const D = P({ code: 'D', childrenCount: 0, childrenAgeBands: [] })

  const nOf = (ps: PersonaForMatch[]): number =>
    planBatch(ds, ps).assignments.filter((a) => a.assigned !== null).length

  const n3 = nOf([A, B, C])
  const n4 = nOf([A, B, C, D])
  if (n4 < n3) offenders.push(`🔴 persona 를 늘렸는데 배정이 줄었다: ${n3} → ${n4}`)
  if (n3 !== 3) offenders.push(`3명일 때 배정 ${n3} (기대 3)`)
  if (n4 !== 4) offenders.push(`4명일 때 배정 ${n4} (기대 4 — D 가 조건 없는 글을 하나 더 맡는다)`)

  // 🔴 무자녀 persona 를 넣어도 자녀 글이 희생되지 않는다
  const with4 = planBatch(ds, [A, B, C, D])
  if (with4.assignments.find((a) => a.queueId === 'kid')?.assigned !== 'A') {
    offenders.push('🔴 무자녀 persona 추가 후 자녀 글이 A 를 잃었다')
  }
  // 🔴 어떤 부분집합을 더해도 줄지 않는다 — 전수로 본다
  const all = [A, B, C, D]
  for (let mask = 0; mask < 16; mask += 1) {
    const subset = all.filter((_, i) => (mask & (1 << i)) !== 0)
    const here = nOf(subset)
    for (let i = 0; i < 4; i += 1) {
      if ((mask & (1 << i)) !== 0) continue
      const bigger = nOf([...subset, all[i]!])
      if (bigger < here) offenders.push(`🔴 ${all[i]!.code} 추가로 감소: ${here} → ${bigger}`)
    }
  }
  if (offenders.length) bad('🔴 단조성 (persona 추가 ⇒ 감소 없음)', offenders.join(' / '))
  else ok('🔴 단조성 (persona 추가 ⇒ 감소 없음)', `3명 ${n3}건 → 4명 ${n4}건 · 16개 부분집합 전수에서 감소 0`)
}

// ── ⑲ 🔴 최대 매칭 — 탐욕법이 놓치던 배정을 찾는다 ──
{
  const offenders: string[] = []
  // 고전적 함정: 조건 없는 글이 먼저 처리되면 희소 persona 를 먹어 희소 글이 굶는다
  const ds: BatchDraft[] = [
    { queueId: 'open', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0 },
    { queueId: 'kid', title: '중학생 딸', body: '딸이 사춘기라 힘들어요.', gateVerdict: 'PASS', createdAt: 1 },
  ]
  // A 만 자녀 중고등 · B 는 무자녀(조건 없는 글만)
  const ps = [P({ code: 'A', childrenCount: 1, childrenAgeBands: ['중고등'] }), P({ code: 'B', childrenCount: 0, childrenAgeBands: [] })]
  const plan = planBatch(ds, ps)
  const got = plan.assignments.filter((a) => a.assigned !== null).length
  if (got !== 2) offenders.push(`🔴 배정 ${got} (기대 2 — 최대 매칭이면 둘 다 나간다)`)
  if (plan.assignments.find((a) => a.queueId === 'kid')?.assigned !== 'A') offenders.push('희소 글이 A 를 못 받았다')
  if (plan.assignments.find((a) => a.queueId === 'open')?.assigned !== 'B') offenders.push('조건 없는 글이 B 를 못 받았다')

  // 🔴 입력 순서를 뒤집어도 같은 결과여야 한다
  const rev = planBatch([...ds].reverse(), ps)
  const keyOf = (pl: ReturnType<typeof planBatch>): string =>
    [...pl.assignments].sort((x, y) => x.queueId.localeCompare(y.queueId)).map((a) => `${a.queueId}:${a.assigned}`).join(',')
  if (keyOf(plan) !== keyOf(rev)) offenders.push(`🔴 입력 순서로 결과가 달라진다: ${keyOf(plan)} vs ${keyOf(rev)}`)
  // 🔴 persona 입력 순서도 무관해야 한다
  if (keyOf(planBatch(ds, [...ps].reverse())) !== keyOf(plan)) offenders.push('🔴 persona 순서로 결과가 달라진다')
  // 🔴 같은 입력이면 몇 번을 불러도 같다
  if (keyOf(planBatch(ds, ps)) !== keyOf(plan)) offenders.push('🔴 결정적이지 않다')

  if (offenders.length) bad('🔴 최대 매칭 · 입력 순서 무관', offenders.join(' / '))
  else ok('🔴 최대 매칭 · 입력 순서 무관', '탐욕법이 1건 놓치던 배치에서 2건 · 초안/persona 순서 뒤집어도 동일')
}

// ── ⑳ 🔴 최대 매칭이 hardFilter · cap · 최소 간격을 우회하지 않는다 ──
{
  const offenders: string[] = []
  const ds: BatchDraft[] = Array.from({ length: 4 }, (_, i) =>
    ({ queueId: `q${i}`, title: '중학생 딸', body: '딸이 사춘기라 힘들어요.', gateVerdict: 'PASS', createdAt: i }))

  // 🔴 생활사: 무자녀 persona 밖에 없으면 배정 0 — 매칭이 급해도 뚫지 않는다
  const noKid = planBatch(ds, [P({ code: 'A', childrenCount: 0, childrenAgeBands: [] })])
  if (noKid.assignments.some((a) => a.assigned !== null)) offenders.push('🔴 무자녀 persona 에게 자녀 글이 배정됨')

  // 🔴 실계정이 붙은 persona 는 쓰지 않는다
  const real = planBatch(ds, [P({ code: 'A', providerId: 'x', childrenCount: 1, childrenAgeBands: ['중고등'] })])
  if (real.assignments.some((a) => a.assigned !== null)) offenders.push('🔴 실계정 persona 가 배정됨')

  // 🔴 active 아닌 persona 도 쓰지 않는다
  const inactive = planBatch(ds, [P({ code: 'A', status: 'draft', childrenCount: 1, childrenAgeBands: ['중고등'] })])
  if (inactive.assignments.some((a) => a.assigned !== null)) offenders.push('🔴 비활성 persona 가 배정됨')

  // 🔴 주간 cap: 3명이면 3건까지. 매칭이 4건을 만들려고 cap 을 넘기지 않는다
  const capped = planBatch(ds, ['A', 'B', 'C'].map((c) => P({ code: c, childrenCount: 1, childrenAgeBands: ['중고등'] })))
  const n = capped.assignments.filter((a) => a.assigned !== null).length
  if (n !== 3) offenders.push(`cap 아래 배정 ${n} (기대 3)`)
  for (const [code, cnt] of Object.entries(capped.load)) {
    if (cnt > POST_CAP_PER_WEEK) offenders.push(`🔴 ${code} 가 ${cnt}건 — 주간 상한 ${POST_CAP_PER_WEEK} 초과`)
  }
  // 🔴 최소 간격: 최근에 쓴 사람은 매칭 대상에서 빠진다
  const tooSoon = planBatch(ds.slice(0, 1),
    [P({ code: 'A', childrenCount: 1, childrenAgeBands: ['중고등'], daysSinceLastPost: MIN_DAYS_BETWEEN_POSTS - 1 })])
  if (tooSoon.assignments[0]!.assigned !== null) offenders.push(`🔴 ${MIN_DAYS_BETWEEN_POSTS}일 간격을 우회했다`)
  if (!tooSoon.assignments[0]!.blocked.some((b) => b.reasons.some((r) => r.code === 'TOO_SOON'))) {
    offenders.push('TOO_SOON 사유가 남지 않았다')
  }
  // 🔴 배정된 코드는 반드시 eligible 안에 있다 — planStore 가 이것을 믿는다
  for (const a of capped.assignments) {
    if (a.assigned !== null && !a.eligible.some((e) => e.code === a.assigned)) {
      offenders.push(`🔴 ${a.queueId} 배정 ${a.assigned} 이 eligible 밖이다`)
    }
  }
  if (offenders.length) bad('🔴 매칭이 게이트를 우회하지 않는다', offenders.join(' / '))
  else ok('🔴 매칭이 게이트를 우회하지 않는다', `생활사·실계정·비활성·주 ${POST_CAP_PER_WEEK}건·${MIN_DAYS_BETWEEN_POSTS}일 간격 모두 유지 · 배정은 전부 eligible 안`)
}

// ── ㉑ 🔴 복구 — 배정만 하고 발행하지 못한 행은 재배정하지 않는다 (2026-09-07) ──
//
//    사고 상태: status APPROVED/EDITED · createdPostId null · matchedPersonaId 있음 · matchedAt 있음.
//    이 행을 새 매칭에 넣으면 다른 사람에게 넘어가고, 화면이 보여준 사람과 실제 필자가 달라진다.
{
  const offenders: string[] = []
  // A 는 그 행 때문에 이미 이번 주를 다 썼다 (matchedAt 이 postsThisWeek 에 세어졌다)
  const A = P({ code: 'A', postsThisWeek: POST_CAP_PER_WEEK })
  const B = P({ code: 'B' })
  const ds: BatchDraft[] = [
    { queueId: 'stuck', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: 'A' },
    { queueId: 'fresh', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 1 },
  ]
  const plan = planBatch(ds, [A, B])
  const stuck = plan.assignments.find((a) => a.queueId === 'stuck')!
  const fresh = plan.assignments.find((a) => a.queueId === 'fresh')!

  // 🔴 기존 배정이 정본이다 — WEEKLY_CAP 상태여도 그대로 A 다
  if (stuck.assigned !== 'A') offenders.push(`🔴 기존 배정이 바뀌었다: ${stuck.assigned ?? '없음'}`)
  if (!stuck.recovery) offenders.push('복구 행으로 표시되지 않았다')
  if (stuck.recoveryProblem !== null) offenders.push(`복구 문제 오탐: ${stuck.recoveryProblem}`)
  // 🔴 새 자리를 받을 수 없는 상태인데도 배정이 살아 있어야 한다
  if (planBatch([{ ...ds[0]!, assignedPersonaCode: null }], [A, B]).assignments[0]!.assigned === 'A') {
    offenders.push('🔴 A 는 여력이 없어야 하는데 새 배정을 받았다 — 시나리오가 성립하지 않는다')
  }
  // 🔴 신규 행은 정상적으로 매칭된다
  if (fresh.assigned !== 'B') offenders.push(`신규 행 배정 ${fresh.assigned ?? '없음'} (기대 B)`)
  if (fresh.recovery) offenders.push('신규 행이 복구로 표시됐다')
  // 🔴 여력을 두 번 빼지 않는다 — A 의 부하는 1 이다 (기존 배정 1건, 새 배정 0건)
  if (plan.load.A !== 1) offenders.push(`A 부하 ${plan.load.A ?? 0} (기대 1 — 두 번 세지 않는다)`)

  // 🔴 fail-closed ① 없는 persona
  const gone = planBatch([{ ...ds[0]!, assignedPersonaCode: 'ZZZ' }], [A, B]).assignments[0]!
  if (gone.assigned !== null) offenders.push('🔴 없는 persona 배정인데 발행 대상이 됐다')
  if (gone.recoveryProblem === null) offenders.push('없는 persona 인데 문제로 잡히지 않았다')

  // 🔴 fail-closed ② 비활성 persona
  const off = planBatch([{ ...ds[0]!, assignedPersonaCode: 'C' }], [P({ code: 'C', status: 'draft' })]).assignments[0]!
  if (off.assigned !== null) offenders.push('🔴 비활성 persona 배정인데 발행 대상이 됐다')
  if (off.recoveryProblem === null) offenders.push('비활성인데 문제로 잡히지 않았다')

  // 🔴 fail-closed ③ 실계정이 붙은 persona
  const real = planBatch([{ ...ds[0]!, assignedPersonaCode: 'D' }], [P({ code: 'D', providerId: 'kakao:1' })]).assignments[0]!
  if (real.assigned !== null) offenders.push('🔴 실회원 persona 배정인데 발행 대상이 됐다')
  if (real.recoveryProblem === null) offenders.push('실회원인데 문제로 잡히지 않았다')

  // 🔴 조용히 다른 사람으로 바뀌지 않는다 — 문제가 있으면 null 이지 대체가 아니다
  for (const [name, a] of [['없는 persona', gone], ['비활성', off], ['실회원', real]] as const) {
    if (a.assigned !== null) offenders.push(`🔴 ${name} 인데 대체 persona 가 들어갔다: ${a.assigned}`)
  }

  // 🔴 기존 배정 행은 생활사 조건과 무관하게 그대로다 — 재판정하지 않는다
  const kidStuck = planBatch(
    [{ queueId: 'k', title: '중학생 딸', body: '딸이 사춘기라 힘들어요.', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: 'E' }],
    [P({ code: 'E', childrenCount: 0, childrenAgeBands: [] })],
  ).assignments[0]!
  if (kidStuck.assigned !== 'E') offenders.push('🔴 기존 배정 행이 재판정으로 뒤집혔다')

  if (offenders.length) bad('🔴 복구 — 기존 배정이 정본', offenders.join(' / '))
  else ok('🔴 복구 — 기존 배정이 정본', 'WEEKLY_CAP 이어도 유지 · 여력 이중차감 0 · 없는/비활성/실회원 배정은 fail-closed · 대체 0')
}

// ── ㉒ 🔴 top 3 정책 정합 — 단건 추천과 배치 배정은 규칙이 다르다 ──
{
  const offenders: string[] = []
  // 조건 없는 글 4건 · persona 4명 → 자리가 겹치므로 누군가는 상위 3명 밖으로 내려가야 한다
  const ds: BatchDraft[] = Array.from({ length: 4 }, (_, i) =>
    ({ queueId: `q${i}`, title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: i }))
  const ps = ['A', 'B', 'C', 'D'].map((c) => P({ code: c }))
  const plan = planBatch(ds, ps)
  const assigned = plan.assignments.filter((a) => a.assigned !== null)

  // 🔴 4건 모두 나간다 — top 3 로 잘라냈다면 불가능하다
  if (assigned.length !== 4) offenders.push(`배정 ${assigned.length} (기대 4 — top 3 밖까지 확장되어야 한다)`)

  // 🔴 실제로 top 밖 배정이 일어났는가 — 안 일어났으면 이 fixture 는 헛돈다
  const outsideTop = assigned.filter((a) => !a.top.some((t) => t.code === a.assigned))
  if (outsideTop.length === 0) offenders.push('🔴 top 밖 배정이 하나도 없다 — fixture 가 상황을 못 만들었다')

  // 🔴 top 밖 배정도 반드시 eligible 안이다 — 게이트를 연 것이 아니라 선호를 낮춘 것이다
  for (const a of outsideTop) {
    if (!a.eligible.some((e) => e.code === a.assigned)) {
      offenders.push(`🔴 ${a.queueId} 배정 ${a.assigned} 이 eligible 밖이다 — 게이트가 열렸다`)
    }
  }
  // 🔴 단건 추천은 여전히 상위 3명 안에서만 뽑는다
  const single = planMatch({ queueId: 'q0', title: '오늘', body: '국수를 삶았어요.', personas: ps })
  if (single.recommended !== null && !single.top.some((t) => t.code === single.recommended)) {
    offenders.push('🔴 단건 추천이 상위 3명 밖으로 나갔다')
  }
  if (single.top.length !== TOP_CANDIDATES) offenders.push(`단건 top ${single.top.length} (기대 ${TOP_CANDIDATES})`)

  // 🔴 자리 경쟁이 없으면 배치 1순위 = 단건 추천과 같은 사람
  const alone = planBatch([ds[0]!], ps)
  if (alone.assignments[0]!.assigned !== single.recommended) {
    offenders.push(`경쟁이 없는데 배치(${alone.assignments[0]!.assigned}) 와 단건(${single.recommended}) 이 다르다`)
  }
  // 🔴 문서가 코드와 같은 말을 하는가
  const arch = readFileSync(join(HERE, '..', 'docs', 'operations', '2026-08-30-persona-architecture-design.md'), 'utf-8')
  if (!arch.includes('단건 추천과 배치 배정은 규칙이 다르다')) offenders.push('🔴 아키텍처 정본에 배치 규칙이 없다')
  if (!arch.includes('전체 `eligible`')) offenders.push('🔴 아키텍처 정본이 eligible 확장을 말하지 않는다')
  const lane = readFileSync(join(HERE, '..', 'docs', 'operations', '2026-09-03-raw-supply-chain-design.md'), 'utf-8')
  if (!lane.includes('배정은 최대 매칭이다')) offenders.push('🔴 lane 정본에 최대 매칭 절이 없다')
  if (!lane.includes('복구가 먼저다')) offenders.push('🔴 lane 정본에 복구 계약이 없다')
  // 🔴 dry-run 화면이 배치 규칙을 말하는가
  const dry = readFileSync(CLI, 'utf-8')
  if (!dry.includes('자리가 겹치면 eligible 전체까지')) offenders.push('🔴 dry-run 출력이 배치 규칙을 말하지 않는다')

  if (offenders.length) bad('🔴 top 3 정책 정합', offenders.join(' / '))
  else ok('🔴 top 3 정책 정합', `배치 4/4 배정 · top 밖 ${outsideTop.length}건 전부 eligible 안 · 단건은 top 3 유지 · 문서 3종 일치`)
}

// ── ㉓ 🔴 실회원 판별 — 정본은 Account 다 (2026-09-08) ──
//
//    `User.providerId` 는 NextAuth adapter 가 채우지 않는다 (src/lib/auth.ts §signIn).
//    실측(2026-09-08): User 9명 전원 providerId=null 인데 Account 는 3건 있었다 —
//    즉 실회원 3명이 있는데 가드는 아무도 막지 못하는 상태였다.
{
  const offenders: string[] = []
  const q: BatchDraft[] = [{ queueId: 'q0', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null }]
  const assignedOf = (p: PersonaForMatch): string | null => planBatch(q, [p]).assignments[0]!.assigned
  const blockedOf = (p: PersonaForMatch): string[] =>
    planBatch(q, [p]).assignments[0]!.blocked.flatMap((b) => b.reasons.map((r) => r.code))

  // 🟢 운영 persona — Account 0 · providerId null. 기존 5명이 이 상태다
  if (assignedOf(P({ accountCount: 0, providerId: null })) !== 'PXX') offenders.push('🔴 운영 persona(Account 0)가 막혔다')

  // 🔴 Account 가 하나라도 있으면 실회원이다
  for (const n of [1, 2, 5]) {
    const p = P({ accountCount: n, providerId: null })
    if (assignedOf(p) !== null) offenders.push(`🔴 Account ${n}건인데 배정됐다`)
    if (!blockedOf(p).includes('REAL_MEMBER')) offenders.push(`Account ${n}건이 REAL_MEMBER 로 잡히지 않았다`)
  }

  // 🔴 **fail-closed** — 모르면 막는다. 생산 경로가 필드를 빠뜨리면 여기로 온다
  const unknown = P({ accountCount: null, providerId: null })
  if (assignedOf(unknown) !== null) offenders.push('🔴 Account 를 모르는데 배정됐다 (fail-closed 실패)')
  if (!blockedOf(unknown).includes('REAL_MEMBER')) offenders.push('모름이 REAL_MEMBER 로 잡히지 않았다')

  // 🔴 providerId 검사는 방어적으로 남는다 — 수동으로 채워 둔 값도 막는다
  const legacy = P({ accountCount: 0, providerId: 'kakao:1' })
  if (assignedOf(legacy) !== null) offenders.push('🔴 providerId 가 있는데 배정됐다')

  // 🔴 실회원 User 에 Persona 가 잘못 연결된 경우 — 이것이 막아야 할 사고다
  const misLinked = P({ accountCount: 1, providerId: 'kakao:999' })
  if (assignedOf(misLinked) !== null) offenders.push('🔴 실회원 계정에 연결된 persona 가 배정됐다')

  // 🔴 배정이 여럿 있을 때 실회원만 빠지고 나머지는 정상 동작한다
  const mixed = planBatch(q, [P({ code: 'REAL', accountCount: 2 }), P({ code: 'BOT', accountCount: 0 })])
  if (mixed.assignments[0]!.assigned !== 'BOT') offenders.push(`혼재 시 배정 ${mixed.assignments[0]!.assigned ?? '없음'} (기대 BOT)`)

  // 🔴 **복구 경로도 같은 판정을 쓴다** — 배정 때 통과했어도 그 사이에 계정이 붙을 수 있다
  {
    const stuck: BatchDraft = { queueId: 'stuck', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: 'PXX' }
    const fresh: BatchDraft = { queueId: 'fresh', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 1, assignedPersonaCode: null }
    const recOf = (acc: number | null, prov: string | null = null) =>
      planBatch([stuck, fresh], [P({ accountCount: acc, providerId: prov }), P({ code: 'OK', accountCount: 0 })])
        .assignments.find((a) => a.queueId === 'stuck')!

    // 🟢 Account 0 — 정상 복구
    const good = recOf(0)
    if (good.assigned !== 'PXX') offenders.push(`🔴 Account 0 복구가 막혔다 (${good.assigned ?? '없음'})`)
    if (good.recoveryProblem !== null) offenders.push(`Account 0 인데 복구 문제: ${good.recoveryProblem}`)

    // 🔴 Account 1 — 복구 차단
    const acc1 = recOf(1)
    if (acc1.assigned !== null) offenders.push('🔴 Account 1건인데 복구 배정됐다')
    if (acc1.recoveryProblem === null) offenders.push('Account 1건이 recoveryProblem 으로 잡히지 않았다')

    // 🔴 모름 — fail-closed
    const unk = recOf(null)
    if (unk.assigned !== null) offenders.push('🔴 Account 를 모르는데 복구 배정됐다')
    if (unk.recoveryProblem === null) offenders.push('모름이 recoveryProblem 으로 잡히지 않았다')

    // 🔴 providerId 방어도 복구에서 유지된다
    if (recOf(0, 'kakao:1').assigned !== null) offenders.push('🔴 providerId 가 있는데 복구 배정됐다')

    // 🔴 우회 금지 — 뒤에 정상 후보가 있어도 복구가 깨졌으면 그 사실이 남아야 한다
    if (recOf(1).recoveryProblem === null) offenders.push('🔴 깨진 복구가 조용히 넘어갔다')
  }

  if (offenders.length) bad('🔴 실회원 판별 (Account 정본 · fail-closed)', offenders.join(' / '))
  else ok('🔴 실회원 판별 (Account 정본 · fail-closed)', '배정·복구 양쪽 — Account 0 통과 · 1건 이상 차단 · 모름 차단 · providerId 방어 · 혼재 시 정상')
}

// ── ㉔ 🔴 생산 경로 전수 — 한 곳이라도 Account 를 안 넘기면 실패한다 ──
//
//    타입이 1차로 잡지만(필수 필드), 새 경로가 `as never` 로 캐스팅하면 빠져나간다.
//    그래서 소스를 읽어 **모든 생산 경로**가 select 와 매핑을 둘 다 갖는지 본다.
{
  const offenders: string[] = []
  /** 🔴 `PersonaForMatch` 를 DB 에서 만드는 곳 전부. 늘어나면 여기 추가한다 */
  const PRODUCERS = [
    'scripts/original-post-auto-publish.mts',
    'scripts/original-post-match-assign.mts',
    'scripts/original-post-persona-match-dry-run.mts',
    'scripts/supply-health.mts',
    'scripts/persona-capacity-planner.mts',
  ] as const
  for (const f of PRODUCERS) {
    const src = readFileSync(join(HERE, '..', f), 'utf-8')
    if (!/_count:\s*\{\s*select:\s*\{\s*accounts:\s*true/.test(src)) offenders.push(`${f}: Account 를 select 하지 않는다`)
    if (!/accountCount:\s*r\.user\?\._count\.accounts/.test(src)) offenders.push(`${f}: accountCount 를 넘기지 않는다`)
  }
  // 🔴 발행 직전 게이트 두 곳도 같은 계약이다
  for (const f of ['src/lib/original-post-publish-tx.ts', 'scripts/original-post-publish-live.mts'] as const) {
    const src = readFileSync(join(HERE, '..', f), 'utf-8')
    if (!/personaAccountCount:/.test(src)) offenders.push(`${f}: personaAccountCount 를 넘기지 않는다`)
    if (!/_count:\s*\{\s*select:\s*\{\s*accounts:\s*true/.test(src)) offenders.push(`${f}: Account 를 select 하지 않는다`)
  }
  // 🔴 micro-seed 발행 경로 — 실제로 Post 를 만드는 곳이다
  for (const f of ['scripts/lib/micro-seed-db.mjs', 'scripts/micro-seed-publish-live.mts'] as const) {
    const src = readFileSync(join(HERE, '..', f), 'utf-8')
    if (!/_count:\s*\{\s*select:\s*\{\s*accounts:\s*true/.test(src)) offenders.push(`${f}: Account 를 select 하지 않는다`)
    if (!/accountCount:/.test(src)) offenders.push(`${f}: accountCount 를 넘기지 않는다`)
  }
  // 🔴 Persona 를 고치는 경로 — 실회원 User 를 수정하면 안 된다
  for (const f of ['scripts/persona-children-age-bands.mts', 'scripts/persona-voice-profile.mts'] as const) {
    const src = readFileSync(join(HERE, '..', f), 'utf-8')
    if (!/_count:\s*\{\s*select:\s*\{\s*accounts:\s*true/.test(src)) offenders.push(`${f}: Account 를 select 하지 않는다`)
    if (!/judgeRealMember\(/.test(src)) offenders.push(`${f}: 판정을 정본(judgeRealMember)으로 하지 않는다`)
  }
  // 🔴 **복붙 금지** — 판정을 다시 쓴 곳이 없어야 한다
  for (const f of [
    'src/lib/original-post-persona-match.ts', 'src/lib/micro-seed-write-guard.ts',
    // 🔴 발행 직전 게이트도 같은 계약이다 — 여기서 다시 쓰면 배정과 발행이 다른 말을 한다
    'src/lib/original-post-publish.ts',
    'scripts/persona-children-age-bands.mts', 'scripts/persona-voice-profile.mts',
  ] as const) {
    const src = readFileSync(join(HERE, '..', f), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (!/judgeRealMember\(/.test(src)) offenders.push(`${f}: judgeRealMember 를 부르지 않는다`)
    // 🔴 `accountCount` 로 조건을 직접 쓰면 복붙이다.
    //    ① 이름은 `accountCount` · `personaAccountCount` 둘 다 — 대소문자를 가리지 않는다
    //    ② 연산자가 **앞에 오는** 형태(`0 < c.personaAccountCount`)도 잡는다
    //    ③ `>=` `<=` 를 `>` `<` 보다 먼저 놓아 부분 매칭으로 놓치지 않는다
    if (hasDirectAccountCompare(src)) {
      offenders.push(`${f}: 🔴 판정을 복붙했다 (accountCount 조건을 직접 쓴다)`)
    }
  }
  // 🔴 아직 DB 에 없는 카드는 Account 0 이다
  const card = readFileSync(join(HERE, '..', 'src/lib/persona-pool-card.ts'), 'utf-8')
  if (!/accountCount:\s*0/.test(card)) offenders.push('persona-pool-card: cardToPersona 가 accountCount 를 넘기지 않는다')
  // 🔴 schema 주석이 실제 계약과 같은가
  const schema = readFileSync(join(HERE, '..', 'prisma/schema.prisma'), 'utf-8')
  if (!/실회원 판별 정본이 아니다/.test(schema)) offenders.push('schema 의 providerId 주석이 옛 계약을 말한다')

  if (offenders.length) bad('🔴 생산 경로 전수 (Account 전달)', offenders.join(' / '))
  else ok('🔴 생산 경로 전수 (Account 전달)', '배정 5 · 발행 게이트 2 · micro-seed 2 · persona write 2 + 카드 + schema · 복붙 0')
}

/**
 * 🔴 `accountCount` 를 직접 비교하는가 — **복붙 탐지기**.
 *
 *    `judgeRealMember({ accountCount: ... })` 같은 **호출**은 오탐하지 않는다:
 *    거기서 뒤따르는 것은 `:` 이지 비교 연산자가 아니다.
 */
export function hasDirectAccountCompare(src: string): boolean {
  // 🔴 상수를 함수 안에 둔다 — 파일 위쪽에서 부르면 TDZ 로 죽는다 (실측으로 잡았다)
  const CMP = '(?:===|!==|==|!=|>=|<=|>|<)'
  const NAME = '(?:persona)?[Aa]ccountCount'
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 이름 → 연산자  ·  연산자 → 이름 **양방향**.
  // 🔴 역방향은 연산자와 이름 사이에 괄호·공백이 낄 수 있다 — `0 < (c.personaAccountCount ?? 0)`.
  //    실측으로 잡았다: 괄호를 허용하지 않은 판은 이 형태를 놓쳤다
  return new RegExp(`${NAME}\\s*${CMP}`).test(code)
    || new RegExp(`${CMP}\\s*[(\\s]*(?:[A-Za-z_$][\\w$]*\\.)*${NAME}`).test(code)
}

// ── ㉕ 🔴 실회원 판정 정본 — 유효하지 않은 count 를 통과시키지 않는다 (2026-09-08) ──
//
//    🔴 `NaN > 0` 은 **false** 다. 검사 없이 두면 조회가 어긋난 값이 조용히 통과하고,
//    실회원 여부를 모르는 채로 남의 이름으로 글이 나간다.
{
  const offenders: string[] = []
  const real = (acc: unknown, prov: string | null = null): boolean =>
    judgeRealMember({ accountCount: acc as never, providerId: prov }).real

  // 🟢 운영 persona
  if (real(0)) offenders.push('🔴 Account 0 · providerId null 인데 막혔다')
  // 🔴 실회원
  for (const n of [1, 2, 7]) if (!real(n)) offenders.push(`🔴 Account ${n}건인데 통과했다`)
  // 🔴 모름 · 미조회
  if (!real(null)) offenders.push('🔴 null 이 통과했다')
  if (!real(undefined)) offenders.push('🔴 undefined 가 통과했다')
  // 🔴 DB count 가 될 수 없는 값
  for (const [label, v] of [
    ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['-Infinity', Number.NEGATIVE_INFINITY],
    ['음수', -1], ['소수', 0.5], ['소수(1.5)', 1.5], ['문자열', '0'], ['불리언', false],
  ] as const) {
    if (!real(v)) offenders.push(`🔴 ${label} 이 통과했다`)
  }
  // 🔴 providerId 방어 — Account 가 0 이어도 막는다
  if (!real(0, 'kakao:1')) offenders.push('🔴 providerId 가 있는데 통과했다')
  // 🔴 providerId 미조회도 막는다
  if (!judgeRealMember({ accountCount: 0, providerId: undefined }).real) offenders.push('🔴 providerId 미조회가 통과했다')
  // 🔴 사유를 말한다 — 사람이 어느 쪽인지 알아야 한다
  const nan = judgeRealMember({ accountCount: Number.NaN, providerId: null })
  if (!nan.real || !nan.unknown) offenders.push('NaN 이 unknown 으로 표시되지 않았다')
  const one = judgeRealMember({ accountCount: 1, providerId: null })
  if (!one.real || one.unknown) offenders.push('Account 1건이 unknown 으로 잘못 표시됐다')

  // 🔴 **배정과 발행이 같은 답을 내는가** — 두 게이트가 갈라지면 그날 사고가 난다
  const q: BatchDraft[] = [{ queueId: 'q0', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null }]
  for (const [label, acc] of [
    ['0', 0], ['1', 1], ['null', null], ['NaN', Number.NaN], ['음수', -1], ['소수', 0.5],
  ] as const) {
    const assignBlocked = planBatch(q, [P({ accountCount: acc as never })]).assignments[0]!.assigned === null
    const publishBlocked = real(acc)
    if (assignBlocked !== publishBlocked) offenders.push(`🔴 ${label}: 배정(${assignBlocked}) 과 정본(${publishBlocked}) 이 다르다`)
  }

  // 🔴 **검사기 자체를 시험한다** — 탐지기가 헛돌면 복붙이 조용히 들어온다
  {
    const MUST_CATCH = [
      'accountCount > 0',
      'c.personaAccountCount > 0',
      'c.personaAccountCount === null',
      '0 < c.personaAccountCount',
      'if (p.accountCount !== null) {}',
      'return accountCount >= 1',
      'x <= personaAccountCount',
      // 🔴 연산자와 이름 사이에 괄호가 끼는 형태 — 실측으로 놓쳤던 것이다
      '0 < (c.personaAccountCount ?? 0)',
      'if (0 !== p.accountCount) {}',
    ]
    for (const line of MUST_CATCH) {
      if (!hasDirectAccountCompare(line)) offenders.push(`🔴 탐지기가 놓친다: ${line}`)
    }
    // 🔴 정본 호출과 필드 전달은 **오탐하지 않아야 한다** — 오탐하면 정본을 못 쓰게 된다
    const MUST_PASS = [
      'judgeRealMember({ accountCount: p.accountCount, providerId: p.providerId })',
      'accountCount: r.user?._count.accounts ?? null,',
      'accountCount: number | null',
      'const real = judgeRealMember({ accountCount: c.personaAccountCount, providerId: c.personaProviderId })',
      'personaAccountCount: row.matchedPersona?.user?._count.accounts ?? null,',
      '// accountCount > 0 은 주석이라 잡히지 않는다',
      '/* accountCount === null */',
    ]
    for (const line of MUST_PASS) {
      if (hasDirectAccountCompare(line)) offenders.push(`🔴 탐지기가 오탐한다: ${line}`)
    }
  }

  if (offenders.length) bad('🔴 실회원 정본 — 유효하지 않은 count', offenders.join(' / '))
  else ok('🔴 실회원 정본 — 유효하지 않은 count', 'NaN·±Infinity·음수·소수·문자열·불리언 차단 · 배정=발행 · 복붙 탐지기 7종 검출 · 7종 오탐 0')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
