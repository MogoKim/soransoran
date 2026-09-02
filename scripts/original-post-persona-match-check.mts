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
  readPostRequirements, hardFilter, scoreMatch, planMatch, lengthBandOf,
  isChildAgeBand, CHILD_AGE_BANDS, BLOCK_CODES, BLOCK_LABEL, SCORE_WEIGHTS,
  POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS, TOP_CANDIDATES,
  type PersonaForMatch, type ChildAgeBand, type BlockCode,
} from '../src/lib/original-post-persona-match'

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
  maritalStatus: '기혼', childrenCount: 2, childrenAgeBands: ['중고등'],
  parentCare: '상시', menopauseStatus: '진행중', workStatus: '전업',
  economicStatus: '보통', region: null, noGoTopics: [], voiceLength: 'medium',
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
  if (lengthBandOf(100) !== 'short' || lengthBandOf(300) !== 'medium' || lengthBandOf(900) !== 'long') offenders.push('길이 밴드 오류')
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
  if (/^import /m.test(code)) offenders.push('🔴 import 가 있다 — 순수 모듈이 아니다')
  if (offenders.length) bad('규칙 모듈은 순수', offenders.join(' / '))
  else ok('규칙 모듈은 순수', 'import 0 · DB 0 · 네트워크 0 · env 0 · Math.random 0(seed 고정)')
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
  if (!code.includes('planMatch(')) offenders.push('🔴 planMatch 를 부르지 않는다 — 규칙을 다시 만들었나')
  if (!code.includes('writeFileSync')) { /* 정상 — 파일도 쓰지 않는다 */ } else offenders.push('🔴 파일을 쓴다')
  if (offenders.length) bad('dry-run 경계', offenders.join(' / '))
  else ok('dry-run 경계', 'DB write 0 · 트랜잭션 0 · --apply 없음 · 네트워크 0 · 파일 write 0')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
