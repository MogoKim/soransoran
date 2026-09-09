/**
 * 닉네임 후보 자동 생성 — 🔴 **순수 함수. DB·네트워크·난수 0** (2026-09-08)
 *
 * 🔴 왜 자동인가.
 *    회차마다 창업자가 이름을 하나씩 고르면 16명(Wave3 11 + Wave4 5)에 16번 멈춘다.
 *    그리고 사람이 고른 이름은 **Gate ⑥-B 를 통과할지 모른 채** 고른 것이다.
 *
 * 🔴 그렇다고 코드에 "P21 = ○○" 같은 **배정표를 두지 않는다.**
 *    Pool 설계 §3-2 이유 ②가 그것을 금지한다 — 상수 배열이 되면 헌법 §9-6 위반이다.
 *    여기 있는 것은 **후보 공간**이다. 누구에게 갈지는 정해져 있지 않고,
 *    최종 결정은 **적용 시점의 Gate ⑥-B**(회원 닉네임·크롤 author·기존 persona 대조)가 한다.
 *
 * 🔴 정책(Pool §3-2)
 *      🟢 **두세 글자** 순우리말 · 일상 사물 · 계절/식물 계열
 *      🔴 AI 티(숫자 접미 · 영문 혼용 · 봇/AI 연상) · 운영자 티
 *      🔴 출처 커뮤니티 호칭 계열 · 실명형 · 지역명
 *      🔴 정확한 나이 · 지역 · 병명 · 가족상태가 드러나는 이름
 *
 * 🔴 **길이는 2~3자다.** 예전 판은 "조합형은 6자까지" 라며 `봄볕나무` 같은 네 글자를
 *    만들어 냈다 — 정본에 그런 예외가 없다. 정본이 "두세 글자" 라고 못박은 것은
 *    회원 닉네임이 그 길이대이기 때문이고, 네 글자 조합은 그 자체로 지어낸 티가 난다.
 *    그래서 후보 공간도 **2~3자만 나오도록** 다시 짰다 (한 글자 머리 + 두 글자 몸).
 */

/** 🔴 후보 **공간**이다. 특정 persona 에 배정된 이름이 아니다 */

/**
 * 🔴 한 글자 머리. 뒤에 두 글자를 붙여 **정확히 세 글자**를 만든다.
 *    (네 글자가 나오지 않도록 두 글자 머리를 두지 않는다)
 */
const HEAD1: readonly string[] = [
  '봄', '밤', '새', '들', '물', '달', '별', '산', '풀', '잎',
  '흙', '솔', '눈', '비', '꽃', '숲', '볕', '늘', '옹', '함',
]

/** 🔴 두 글자 몸. 단독으로도 쓰이고 `HEAD1` 뒤에 붙어 세 글자가 된다 */
const BODY2: readonly string[] = [
  '수국', '모과', '앵두', '자두', '냉이', '노을', '들녘', '뜨락', '숲길', '냇가',
  '골목', '무렵', '바람', '그늘', '마루', '창가', '자락', '갈피', '억새', '갈대',
]

/**
 * 🔴 단독으로 쓰는 두세 글자 — 조합보다 자연스러운 것들.
 *    🔴 `살`·`세` 가 든 말(`햇살`·`살구`)은 넣지 않는다. 정책의 나이·병명 표지에 걸려
 *       어차피 걸러지는데, 목록에 두면 "후보가 40개" 라는 숫자가 거짓이 된다.
 */
const SOLO: readonly string[] = [
  ...BODY2,
  '도라지', '봉숭아', '민들레', '기지개', '언저리', '무지개', '조약돌', '오솔길',
  '들국화', '산딸기', '제비꽃', '까치밥', '달맞이', '물봉선', '노루귀', '패랭이',
]

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

/** 🔴 정본 Pool §3-2 "두세 글자". 이 상수 하나가 생성기와 검사기를 함께 묶는다 */
export const NAME_LENGTH = { min: 2, max: 3 } as const

export type NamePolicyVerdict = { ok: boolean; problems: string[] }

/** 🔴 어떤 이름이든 받아서 정책을 본다. 생성기와 독립이다 */
export function verifyNamePolicy(raw: string): NamePolicyVerdict {
  const name = (raw ?? '').trim()
  const problems: string[] = []
  if (name === '') return { ok: false, problems: ['비어 있다'] }
  const lower = name.toLowerCase()

  // 🔴 길이 — 정본(Pool §3-2)이 **두세 글자**로 못박았다. 조합형 예외를 두지 않는다
  const len = [...name].length
  if (len < NAME_LENGTH.min) problems.push(`${len}자 — 너무 짧다 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)
  if (len > NAME_LENGTH.max) problems.push(`${len}자 — 정본은 두세 글자다 (${NAME_LENGTH.min}~${NAME_LENGTH.max}자)`)

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
 *    `SOLO` 를 먼저 놓고 그다음 조합을 편다 — 단독형이 더 자연스럽기 때문이다.
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
  for (let i = 0; i < SOLO.length && out.length < limit; i += 1) {
    push(SOLO[(seed + i) % SOLO.length]!)
  }
  // 🔴 한 글자 + 두 글자 = **세 글자**. 네 글자 조합을 만들지 않는다
  for (let i = 0; i < HEAD1.length * BODY2.length && out.length < limit; i += 1) {
    const h = HEAD1[(seed + i) % HEAD1.length]!
    const t = BODY2[(seed + i * 7 + 3) % BODY2.length]!
    push(`${h}${t}`)
  }
  return out
}

/**
 * 🔴 여러 코드에 **겹치지 않게** 후보를 뽑는다.
 *
 *    `isTaken` 은 호출부가 준다 — 거기서 Gate ⑥-B(회원 닉네임 · 크롤 authorHash ·
 *    기존 persona)를 본다. 이 파일은 DB 를 모른다.
 *
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
  for (const code of codes) {
    const cand = candidatesFor(code, limit)
    const found = cand.find((n) => !used.has(n) && !isTaken(n))
    if (found === undefined) {
      problems.push(`${code}: 후보 ${cand.length}개가 모두 막혔다 — 어휘를 넓혀야 한다`)
      continue
    }
    used.add(found)
    picked.set(code, found)
  }
  return { ok: problems.length === 0 && picked.size === codes.length, picked, problems }
}
