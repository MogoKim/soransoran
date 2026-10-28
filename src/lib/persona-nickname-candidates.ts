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
 * 🔴 정책(D100 canon §4.2 · runbook §2.1 2026-10-16 — Pool §3-2 는 역사 문서)
 *      🟢 합성 이름 — 길이·리듬·일상 구어체가 커뮤니티 실분포를 따른다.
 *         짧은 일상어(2~3자) · 반복 리듬(도란도란 류) · 덜 끝난 듯한 구어체(어쩌다보니 류)를 섞는다.
 *      🔴 AI 티(숫자 접미 · 영문 혼용 · 봇/AI 연상) · 운영자 티
 *      🔴 출처 커뮤니티 호칭 계열 · 실명형(소담 · 다솜 · 가온 · 단비 류 사람 이름) · 지역명
 *      🔴 정확한 나이 · 지역 · 병명 · 가족상태가 드러나는 이름
 *
 * 🔴 **길이는 2~5자다.** 짧은 순우리말 단일 문화에서 벗어나 반복 리듬(4자)·구어체(4~5자)를
 *    포함해 커뮤니티 실분포를 따른다(2026-10-19).
 *    🔴 `살`이 든 말은 IDENTITY_MARKERS(나이·가족 표지)에 걸려
 *       어차피 걸러지므로 pool 에 두지 않는다.
 *
 * 🔴 **한 묶음이 기계적으로 보이지 않게 한다**(2026-10-28).
 *    후보는 갈래(2자 · 3자 · 반복 리듬 · 구어체)를 번갈아 펴고, 배정은 묶음 단위 상한을 지킨다 —
 *    한 길이 ≤ 절반 · 반복 리듬 ≤ 30% · 뜻이 거의 같은 말(`NEAR_SYNONYMS`)은 하나만.
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
  '도란도란', '따끈따끈', '조용조용', '나풀나풀', '소곤소곤', '토닥토닥',
  '두근두근', '오손도손', '반짝반짝', '이것저것', '요리조리',
]

/** 🔴 일상 구어체 4~5자 — 반복 리듬이 아닌 말 · 덜 끝난 듯한 말투 */
const TALK: readonly string[] = [
  '수다쟁이', '소소하게', '이따금씩', '어쩌다보니', '천천히가자', '오늘은맑음',
]

/** 🔴 뜻이 거의 같은 말 — 한 묶음에 둘 이상 들어가면 같은 손이 지은 티가 난다 */
const NEAR_SYNONYMS: readonly (readonly string[])[] = [
  ['도란도란', '오손도손', '소곤소곤', '조용조용'],
  ['이것저것', '요리조리'],
]

/** 🔴 반복 리듬 — 네 글자이고 둘째·넷째 음절이 같다(도란도란 · 오손도손 · 이것저것) */
export function isRepeatedRhythm(name: string): boolean {
  const c = [...name]
  return c.length === 4 && c[1] === c[3]
}

function synonymGroupOf(name: string): number {
  return NEAR_SYNONYMS.findIndex((g) => g.includes(name))
}

// ─────────────────────────────────────────────────────────
// 🔴 정책 검사 — 생성물이 아니라 **아무 이름이나** 받아서 본다
// ─────────────────────────────────────────────────────────

/** 🔴 봇/AI·운영자 연상 — 소재가 아니라 **어감**이다 */
const BOT_MARKERS = ['봇', 'bot', 'ai', '에이아이', '지피티', 'gpt', '로봇', '자동', '시스템']
const OPERATOR_MARKERS = ['운영', '관리자', 'admin', '매니저', '스탭', '스태프', '공식', '고객센터']
/** 🔴 출처 커뮤니티 호칭 계열 */
const SOURCE_MARKERS = ['82', '쿡', '레몬', '테라스', '우아한', '갱년기카페', '카페지기', '님들']
/** 🔴 지역명 — 시·도 단위만으로도 식별이 좁아진다 */
const REGION_MARKERS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  '강남', '분당', '일산', '수원', '용인', '창원', '청주', '전주',
]
/** 🔴 가족상태·나이·병명이 드러나는 말 */
const IDENTITY_MARKERS = [
  '엄마', '아빠', '아내', '남편', '며느리', '시어머니', '장모', '할머니', '할매', '외할',
  '이혼', '사별', '비혼', '재혼', '별거', '독신',
  '살', '세', '년생', '띠',
  '암', '당뇨', '고혈압', '갑상선', '관절염', '우울증', '치매',
]
/** 🔴 브랜드 금지어 (CLAUDE.md · Gate ⑤) */
const BRAND_BANNED = ['시니어', '어르신', '노인', '실버']

/**
 * 🔴 D100 canon §4.2 · runbook §2.1 (2026-10-16). 이 상수 하나가 생성기와 검사기를 함께 묶는다.
 *    옛 Pool §3-2 의 "두세 글자" 상한은 커뮤니티 실분포를 반영한 2~5자로 대체됐다.
 */
export const NAME_LENGTH = { min: 2, max: 5 } as const

export type NamePolicyVerdict = { ok: boolean; problems: string[] }

/** 🔴 어떤 이름이든 받아서 정책을 본다. 생성기와 독립이다 */
export function verifyNamePolicy(raw: string): NamePolicyVerdict {
  const name = (raw ?? '').trim()
  const problems: string[] = []
  if (name === '') return { ok: false, problems: ['비어 있다'] }
  const lower = name.toLowerCase()

  // 🔴 길이 — canon §4.2 · runbook §2.1: 커뮤니티 실분포 2~5자. 조합형 예외 없음.
  const len = [...name].length
  if (len < NAME_LENGTH.min) problems.push(`${len}자 — 너무 짧다 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)
  if (len > NAME_LENGTH.max) problems.push(`${len}자 — 범위 초과 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)

  if (/[0-9]/.test(name)) problems.push('숫자가 들어 있다 (AI 티)')
  if (/[A-Za-z]/.test(name)) problems.push('영문이 섞여 있다 (AI 티)')
  if (/[^가-힣]/.test(name)) problems.push('한글 외 문자가 있다')

  const hit = (list: readonly string[]): string[] => list.filter((m) => lower.includes(m.toLowerCase()))
  const bot = hit(BOT_MARKERS)
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
 *    갈래(2자 · 3자 · 반복 리듬 · 구어체)를 **번갈아** 편다. 시작 갈래와 갈래 안 순서는 코드에서 나온다.
 *    한 갈래를 통째로 앞에 두면(옛 PHRASE 먼저) 묶음 전체가 같은 길이·리듬으로 쏠린다.
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
  const lanes = [rotated(BODY2), [...rotated(SOLO3), ...combos], rotated(RHYTHM), rotated(TALK)]
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
 *       반복 리듬 30% 초과를 막는다. live 충돌로 앞 후보가 빠져도 묶음이 한쪽으로 쏠리지 않는다.
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
  const lengthCap = Math.max(1, Math.floor(codes.length / 2))
  const rhythmCap = Math.max(1, Math.floor((codes.length * 3) / 10))
  const byLength = new Map<number, number>()
  let rhythm = 0
  const fitsBatch = (n: string): boolean => {
    if (used.has(n)) return false
    if ((byLength.get([...n].length) ?? 0) >= lengthCap) return false
    if (isRepeatedRhythm(n) && rhythm >= rhythmCap) return false
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
    picked.set(code, found)
  }
  return { ok: problems.length === 0 && picked.size === codes.length, picked, problems }
}
