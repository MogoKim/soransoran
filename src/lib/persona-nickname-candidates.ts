/**
 * 닉네임 후보 자동 생성 — 🔴 **순수 함수. DB·네트워크·난수 0** (2026-10-19)
 *
 * 🔴 왜 자동인가.
 *    회차마다 창업자가 이름을 하나씩 고르면 16명(Wave3 11 + Wave4 5)에 16번 멈춘다.
 *    그리고 사람이 고른 이름은 **Gate ⑥-B 를 통과할지 모른 채** 고른 것이다.
 *
 * 🔴 그렇다고 코드에 "P21 = ○○" 같은 **배정표를 두지 않는다.**
 *    Pool 설계 §3-2 이유 ②가 그것을 금지한다 — 상수 배열이 되면 헌법 §9-6 위반이다.
 *    여기 있는 것은 **후보 공간**이다. 누구에게 갈지는 정해져 있지 않고,
 *    최종 결정은 **적용 시점의 Gate ⑥-B**(회원 닉네임·기존 persona 대조 · 규칙)가 한다. 원천 작가명은 입력이 아니다(2026-10-01 · #641).
 *
 * 🔴 정책(D100 canon §4.2 · runbook §2.1 — Pool §3-2 는 역사 문서)
 *      🟢 합성 이름 — 한글·영문·숫자가 섞인 커뮤니티 실분포를 따른다. 네 갈래(`NameLane`):
 *         H 한글만(구어체·반복 리듬·일상 명사) · HD 한글+숫자 · L 영문만 · LD 영문+숫자.
 *         한글과 영문은 한 이름에 섞지 않는다(숫자는 어느 쪽과도 섞인다).
 *      🟢 허용 문자는 완성형 한글·ASCII 영문·숫자뿐이다. 2~10자. 숫자 5연속 · 같은 글자 4연속은 막는다.
 *      🔴 명시적 AI/봇 제품어 · 운영자 티 — 영문·숫자 자체는 AI 티가 아니다
 *      🔴 출처 커뮤니티 호칭 계열 · 실명형(소담 · 다솜 · 가온 · 단비 류 사람 이름) · 지역명
 *      🔴 정확한 나이 · 지역 · 병명 · 가족상태가 드러나는 이름
 *
 * 🔴 읽기 쉬움은 발음 점수가 아니라 **닫힌 합성 어휘**가 보장한다. 난수로 문자열을 만들지 않는다.
 *    `살`이 든 말은 IDENTITY_MARKERS(나이·가족 표지)에 걸려 어차피 걸러지므로 pool 에 두지 않는다.
 *
 * 🔴 **한 묶음이 기계적으로 보이지 않게 한다**(2026-10-28).
 *    후보는 갈래를 번갈아 펴고, 배정은 묶음 단위 **상한만** 지킨다(하한 쿼터는 두지 않는다 — live 충돌이
 *    무효한 이름을 강제로 고르게 하면 안 된다. 하한 증거는 fixture 검사가 본다):
 *    한 길이 ≤ 절반 · 반복 리듬 ≤ 30% · 한 갈래 ≤ 40% · 영문 포함 ≤ 40% · 숫자 포함 ≤ 40% ·
 *    시적 명사 ≤ 20% · 뜻이 거의 같은 말(`NEAR_SYNONYMS`)은 하나만.
 */

/** 🔴 후보 **공간**이다. 특정 persona 에 배정된 이름이 아니다 */

/**
 * 🔴 한 글자 머리. 뒤에 두 글자를 붙여 **정확히 세 글자**를 만든다.
 *    자연어·일상어·활동어를 섞는다 — 자연어 단일 문화가 되지 않도록 한다.
 */
const HEAD1: readonly string[] = [
  '봄', '달', '별', '글', '책', '차', '뜰', '집', '밥', '길',
  '빛', '품', '꿈', '솔', '물', '들', '참', '눈', '비', '밤',
]

/** 🔴 두 글자 몸. 단독 두 글자 갈래이고, `HEAD1` 뒤에 붙어 세 글자가 된다 */
const BODY2: readonly string[] = [
  '텃밭', '뜨개', '산책', '마당', '골목', '단추', '편지', '화분', '찻잔', '장터',
  '공원', '책상', '일기', '모과', '앵두', '홍시', '더덕', '참새', '봄비', '안개',
]

/** 🔴 단독 세 글자 — 음식·살림·활동 일상어. 사람 이름처럼 들리는 말은 넣지 않는다 */
const SOLO3: readonly string[] = [
  '인절미', '누룽지', '부침개', '바구니', '책갈피', '앞치마', '도라지', '취나물',
  '보자기', '손수건', '민들레', '봉숭아', '오솔길', '무지개', '조약돌',
]

/** 🔴 반복 리듬 4자 — `isRepeatedRhythm` 이 잡는 꼴. 한 묶음에 30% 를 넘기지 않는다 */
const RHYTHM: readonly string[] = [
  '도란도란', '따끈따끈', '조용조용', '나풀나풀', '소곤소곤', '토닥토닥', '두근두근', '오손도손',
  '반짝반짝', '들쑥날쑥', '이것저것', '요리조리', '티격태격', '어영부영',
]

/** 🔴 짧은 구어체·덜 끝난 말투(한글만) — 반복 리듬이 아닌 말. 3~6자 */
const TALK: readonly string[] = [
  '수다쟁이', '이만총총', '소소하게', '이따금씩', '어쩌다보니', '천천히가자', '아무거나', '오늘은맑음',
  '그냥저냥', '일단출발', '그러려니', '글쎄요', '아닌데요', '그랬구나', '뭐어때', '별거없음',
  '걍그럼', '그냥요', '걍좋아', '아님말고', '어쩌죠', '그러게요', '모르겠네', '일단패스',
  '하여튼', '맞는듯',
]

/**
 * 🔴 한글+숫자(HD) — 가벼운 말투에 숫자 하나. 직업·가족·병·장소 같은 사실을 내세우지 않고,
 *    나이·연도·전화번호처럼 읽히는 숫자는 쓰지 않는다
 */
const HD: readonly string[] = [
  '커피만3잔', '괜찮아8', '하루만더2', '일단3번', '별거아냐4', '아무튼9', '오늘은패스2', '맞아요3',
  '이따봐2', '그럴수도9', '어쩌다3', '낮잠한번6', '나중에7', '그정도5', '한번만더3', '이번만4',
]

/** 🔴 섞인 짧은 닉 — 한글+숫자와 영문 한 단어가 한 목록에 있다(한 형식으로 줄 세우지 않는다) */
const MIXED: readonly string[] = [
  '난괜찮2', 'idk', '그저그래9', 'maybe', '몰라요3', 'nvm', '오늘도9', '별일없음7',
  'whatever', 'weekend', '다음에3', 'dunno', '응그래4', 'someday', 'hmm', '안되면말지6',
]

/**
 * 🔴 영문 닉(L·LD) — 평범한 영단어와 덜 다듬은 영문+숫자(중간 숫자 포함). 한글을 섞지 않는다.
 *    사람 이름·브랜드·지명을 넣지 않는다
 */
const LATIN: readonly string[] = [
  'okay', 'anyway', 'nono', 'sleepy', 'moody', 'random', 'soso', 'lazyday',
  'almost', 'always', 'again', 'h3llo', 'n0pe', 'so2so', 'kk77', 'hmm2',
  'zzz7', 'm7ood', 'no1else', 'whynot3', 'lazy88', 'justme9', 'mm9',
]

/** 🔴 뜻이 거의 같은 말 — 한 묶음에 둘 이상 들어가면 같은 손이 지은 티가 난다 */
const NEAR_SYNONYMS: readonly (readonly string[])[] = [
  ['도란도란', '오손도손', '소곤소곤', '조용조용'],
  ['이것저것', '요리조리'],
]

/** 🔴 반복 리듬 — 한글 네 음절이고 둘째·넷째 음절이 같다(도란도란 · 오손도손 · 이것저것). 영문 `nono` · `soso` 는 리듬이 아니다 */
export function isRepeatedRhythm(name: string): boolean {
  const c = [...name]
  return c.length === 4 && c.every((ch) => /[가-힣]/.test(ch)) && c[1] === c[3]
}

function synonymGroupOf(name: string): number {
  return NEAR_SYNONYMS.findIndex((g) => g.includes(name))
}

/** 🔴 이름 형식 갈래 — H 한글만 · HD 한글+숫자 · L 영문만 · LD 영문+숫자. 정책을 통과한 이름은 항상 갈래가 있다. 한글·영문 혼합 · 숫자만은 null(정책이 거른다) */
export type NameLane = 'H' | 'HD' | 'L' | 'LD'
export function nameLaneOf(name: string): NameLane | null {
  const hangul = /[가-힣]/.test(name)
  const latin = /[A-Za-z]/.test(name)
  const digit = /[0-9]/.test(name)
  if (hangul && latin) return null
  if (hangul) return digit ? 'HD' : 'H'
  if (latin) return digit ? 'LD' : 'L'
  return null
}

/** 🔴 시적·살림 명사 — 몸(BODY2) · 단독 3자 · 머리+몸 조합. 한 묶음에 20% 를 넘기지 않는다 */
const POETIC: ReadonlySet<string> = new Set([
  ...BODY2,
  ...SOLO3,
  ...HEAD1.flatMap((h) => BODY2.map((b) => `${h}${b}`)),
])
export function isPoeticName(name: string): boolean {
  return POETIC.has(name)
}

// ─────────────────────────────────────────────────────────
// 🔴 정책 검사 — 생성물이 아니라 **아무 이름이나** 받아서 본다
// ─────────────────────────────────────────────────────────

/** 🔴 봇/AI 연상(한글) — 소재가 아니라 **어감**이다. 영문은 아래 `AI_LATIN` 이 토큰 단위로 본다 */
const BOT_MARKERS = ['봇', '에이아이', '지피티', '로봇', '자동', '시스템']
/**
 * 🔴 명시적 AI/봇 제품어(영문). `ai`·`bot` 은 **독립 토큰**일 때만 막는다 —
 *    `rain` · `mailbox` 처럼 글자 일부가 겹치는 평범한 단어는 AI 표지가 아니다.
 */
const AI_LATIN = /(?<![a-z])(?:ai|bot)(?![a-z])|bot$|gpt|openai|claude|gemini|copilot|chatbot/
const OPERATOR_MARKERS = [
  '운영', '관리자', 'admin', '매니저', '스탭', '스태프', '공식', '고객센터',
  'manager', 'staff', 'operator', 'official', 'moderator',
]
/** 🔴 출처 커뮤니티 호칭 계열 */
const SOURCE_MARKERS = ['82', '쿡', '레몬', '테라스', '우아한', '갱년기카페', '카페지기', '님들']
/** 🔴 지역명 — 시·도 단위만으로도 식별이 좁아진다 */
const REGION_MARKERS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '강남', '분당', '일산', '수원', '용인', '창원', '청주', '전주',
  'seoul', 'busan', 'incheon', 'daegu', 'jeju',
]
/** 🔴 가족상태·나이·병명이 드러나는 말 */
const IDENTITY_MARKERS = [
  '엄마', '아빠', '아내', '남편', '며느리', '시어머니', '장모', '할머니', '할매', '외할',
  '이혼', '사별', '비혼', '재혼', '별거', '독신',
  '살', '세', '년생', '띠',
  '암', '당뇨', '고혈압', '갑상선', '관절염', '우울증', '치매',
]
/** 🔴 브랜드 금지어 (CLAUDE.md · Gate ⑤) */
const BRAND_BANNED = ['시니어', '어르신', '노인', '실버', 'senior', 'silver']

/**
 * 🔴 D100 canon §4.2 · runbook §2.1. 이 상수 하나가 생성기와 검사기를 함께 묶는다.
 *    멤버 UI 상한(10)과 같다. 한 묶음 안의 길이 쏠림은 `assignCandidates` 의 길이 상한이 따로 막는다.
 */
export const NAME_LENGTH = { min: 2, max: 10 } as const

/** 🔴 허용 문자 — 완성형 한글 · ASCII 영문 · ASCII 숫자만 */
const ALLOWED_CHARS = /^[가-힣A-Za-z0-9]+$/u

export type NamePolicyVerdict = { ok: boolean; problems: string[] }

/** 🔴 어떤 이름이든 받아서 정책을 본다. 생성기와 독립이다 */
export function verifyNamePolicy(raw: string): NamePolicyVerdict {
  const name = (raw ?? '').trim()
  const problems: string[] = []
  if (name === '') return { ok: false, problems: ['비어 있다'] }
  const lower = name.toLowerCase()

  // 🔴 길이 — canon §4.2 · runbook §2.1: 2~10자(코드 포인트). 조합형 예외 없음.
  const len = [...name].length
  if (len < NAME_LENGTH.min) problems.push(`${len}자 — 너무 짧다 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)
  if (len > NAME_LENGTH.max) problems.push(`${len}자 — 범위 초과 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)

  if (!ALLOWED_CHARS.test(name)) problems.push('허용 문자 밖이다 (완성형 한글·영문·숫자만)')
  else if (!/[가-힣A-Za-z]/.test(name)) problems.push('한글·영문이 하나도 없다 (숫자만)')
  // 🔴 네 갈래(H·HD·L·LD)에 들지 않는 꼴 — 한글과 영문을 한 이름에 섞지 않는다. 숫자는 어느 쪽과도 섞인다
  if (/[가-힣]/.test(name) && /[A-Za-z]/.test(name)) problems.push('한글과 영문이 섞였다 (네 갈래 밖)')
  if (/[0-9]{5,}/.test(name)) problems.push('숫자 5연속 (전화번호·연도처럼 읽힌다)')
  if (/(.)\1{3,}/u.test(lower)) problems.push('같은 글자 4연속')

  const hit = (list: readonly string[]): string[] => list.filter((m) => lower.includes(m.toLowerCase()))
  const bot = [...hit(BOT_MARKERS), ...(AI_LATIN.test(lower) ? ['AI/bot 제품어'] : [])]
  if (bot.length > 0) problems.push(`봇/AI 연상: ${bot.join(', ')}`)
  const op = hit(OPERATOR_MARKERS)
  if (op.length > 0) problems.push(`운영자 연상: ${op.join(', ')}`)
  const src = hit(SOURCE_MARKERS)
  if (src.length > 0) problems.push(`출처 커뮤니티 호칭 계열: ${src.join(', ')}`)
  const reg = hit(REGION_MARKERS)
  if (reg.length > 0) problems.push(`지역명: ${reg.join(', ')}`)
  const ident = hit(IDENTITY_MARKERS)
  if (ident.length > 0) problems.push(`나이·가족상태·병명 연상: ${ident.join(', ')}`)
  const brand = hit(BRAND_BANNED)
  if (brand.length > 0) problems.push(`브랜드 금지어: ${brand.join(', ')}`)

  return { ok: problems.length === 0, problems }
}

// ─────────────────────────────────────────────────────────
// 🔴 후보 생성 — **결정적**이다. 같은 입력이면 같은 순서
// ─────────────────────────────────────────────────────────

/** 코드에서 만든 정수 — 난수를 쓰지 않는다 (재현 가능해야 dry-run 이 의미를 가진다) */
function seedOf(code: string): number {
  let h = 2166136261
  for (const ch of code) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * 🔴 한 코드에 대한 후보 목록.
 *
 *    갈래(2자 · 3자 · 반복 리듬 · 구어체 · 한글+숫자 · 섞인 짧은 닉 · 영문)를 **번갈아** 편다. 시작 갈래와 갈래 안 순서는 코드에서 나온다.
 *    한 갈래를 통째로 앞에 두면(옛 PHRASE 먼저) 묶음 전체가 같은 길이·리듬·형식으로 쏠린다.
 *    **정책을 통과한 것만** 돌려준다. Gate ⑥-B 는 호출부가 DB 를 보고 따로 한다.
 */
export function candidatesFor(code: string, limit = 40): string[] {
  const seed = seedOf(code)
  const out: string[] = []
  const push = (n: string): void => {
    if (out.length >= limit) return
    if (out.includes(n)) return
    if (!verifyNamePolicy(n).ok) return
    out.push(n)
  }
  const rotated = (list: readonly string[]): string[] => list.map((_, i) => list[(seed + i) % list.length]!)
  // 🔴 한 글자 + 두 글자 = **세 글자**. 머리가 한 글자라 네 글자 조합은 생기지 않는다
  const combos: string[] = []
  for (let i = 0; i < HEAD1.length * BODY2.length; i += 1) {
    combos.push(`${HEAD1[(seed + i) % HEAD1.length]!}${BODY2[(seed + i * 7 + 3) % BODY2.length]!}`)
  }
  const lanes = [
    rotated(BODY2), rotated(TALK), rotated(RHYTHM),
    rotated(HD), rotated(MIXED), [...rotated(SOLO3), ...combos], rotated(LATIN),
  ]
  const start = seed % lanes.length
  const longest = Math.max(...lanes.map((l) => l.length))
  for (let i = 0; i < longest && out.length < limit; i += 1) {
    for (let k = 0; k < lanes.length; k += 1) {
      const n = lanes[(start + k) % lanes.length]![i]
      if (n !== undefined) push(n)
    }
  }
  return out
}

/**
 * 🔴 여러 코드에 **겹치지 않게** 후보를 뽑는다.
 *
 *    `isTaken` 은 호출부가 준다 — 거기서 Gate ⑥-B(회원 닉네임 ·
 *    기존 persona · 규칙)를 본다. 이 파일은 DB 를 모른다.
 *
 *    🔴 묶음 안에서는 여기서 직접 본다 — 같은 이름 · 뜻이 거의 같은 말 · 한 길이 절반 초과 ·
 *       반복 리듬 30% 초과 · 한 형식 갈래 40% 초과 · 영문 포함 40% 초과 · 숫자 포함 40% 초과 ·
 *       시적 명사 20% 초과를 막는다. **상한만** 본다 — live 충돌로 앞 후보가 빠져도 묶음이 한쪽으로
 *       쏠리지 않고, 하한 쿼터가 없으니 무효한 이름을 억지로 고르지도 않는다(모자라면 아래처럼 전원 실패).
 *    🔴 한 명이라도 못 고르면 **전원 실패**로 돌려준다. 일부만 만들지 않는다.
 */
export function assignCandidates(
  codes: readonly string[],
  isTaken: (name: string) => boolean,
  limit = 40,
): { ok: boolean; picked: Map<string, string>; problems: string[] } {
  const picked = new Map<string, string>()
  const problems: string[] = []
  const used = new Set<string>()
  const capOf = (ratio: number): number => Math.max(1, Math.floor(codes.length * ratio))
  const lengthCap = capOf(0.5)
  const rhythmCap = capOf(0.3)
  const laneCap = capOf(0.4)
  const latinCap = capOf(0.4)
  const digitCap = capOf(0.4)
  const poeticCap = capOf(0.2)
  const byLength = new Map<number, number>()
  const byLane = new Map<NameLane, number>()
  let rhythm = 0
  let latin = 0
  let digit = 0
  let poetic = 0
  const fitsBatch = (n: string): boolean => {
    if (used.has(n)) return false
    if ((byLength.get([...n].length) ?? 0) >= lengthCap) return false
    if (isRepeatedRhythm(n) && rhythm >= rhythmCap) return false
    const lane = nameLaneOf(n)
    if (lane !== null && (byLane.get(lane) ?? 0) >= laneCap) return false
    if (/[A-Za-z]/.test(n) && latin >= latinCap) return false
    if (/[0-9]/.test(n) && digit >= digitCap) return false
    if (isPoeticName(n) && poetic >= poeticCap) return false
    const g = synonymGroupOf(n)
    return g < 0 || ![...used].some((u) => synonymGroupOf(u) === g)
  }
  for (const code of codes) {
    const cand = candidatesFor(code, limit)
    const found = cand.find((n) => fitsBatch(n) && !isTaken(n))
    if (found === undefined) {
      problems.push(`${code}: 후보 ${cand.length}개가 모두 막혔다 — 어휘를 넓혀야 한다`)
      continue
    }
    used.add(found)
    byLength.set([...found].length, (byLength.get([...found].length) ?? 0) + 1)
    if (isRepeatedRhythm(found)) rhythm += 1
    const foundLane = nameLaneOf(found)
    if (foundLane !== null) byLane.set(foundLane, (byLane.get(foundLane) ?? 0) + 1)
    if (/[A-Za-z]/.test(found)) latin += 1
    if (/[0-9]/.test(found)) digit += 1
    if (isPoeticName(found)) poetic += 1
    picked.set(code, found)
  }
  return { ok: problems.length === 0 && picked.size === codes.length, picked, problems }
}
