/**
 * 댓글 꼴 재기 · 자리마다 꼴 추첨 — 🔴 **댓글의 꼴은 실제 댓글에서, 자격은 Persona 에서**
 *
 * 🔴 왜 있는가: 길이를 "한 줄 · 한두 문장 · 서너 문장" 셋으로 말하고 끝 모양 · 문장부호를 모델 기본값에 맡기자
 *    댓글이 반듯한 "~요." 로 수렴했다(11-20 운영 219개 대 실제 879개 — 20자 이하 6% 대 15% · 마침표 끝 35% 대 18%).
 *    자리마다 실제 댓글 하나를 뽑아 그 꼴(길이 · 줄 · 말끝 종류 · 끝부호 · 웃음 울음)을 재서 건네면 같은 모델이 그 꼴로 쓴다.
 *    길이는 뽑힌 댓글의 실제 길이가 정한다 — 그래서 길이 분포가 풀의 분포를 따른다.
 * 🔴 **꼴 값만 건넨다 — 그 댓글의 본문은 건네지 않는다** (2026-11-21 실측 48건). 본문을 함께 주자 낱말이 샜고("건행하세요"),
 *    끝 3글자 · 줄 수를 글자 그대로 맞추느라 어색한 문장("화를해" · 낱말마다 줄바꿈)이 나왔다. 그래서 끝은 글자가 아니라
 *    **종류**(`말끝`)로, 줄은 수가 아니라 **한 줄 / 여러 줄**로 잰다. 말버릇은 Persona 의 참고 댓글 묶음이 전한다.
 * 🔴 글 쪽 `content-core/source-form.ts` 와 같은 생각이다 — 겹치는 계산(글자 수 · 줄 수 · 물음표 · 말줄임)은 그 함수를 쓴다.
 *    그쪽 `어미없이끊긴줄`("요/다/죠/까 가 아닌 한글 끝")은 명사 끝 · 반말 종결까지 한데 묶어 `말끝` 의 넷을 가르지 못한다 — 쓰지 않는다.
 * 🔴 순수 함수다 — DB · 파일 · 시각을 읽지 않는다. 풀은 부르는 쪽이 참고 댓글 자산에서 걸러 넘긴다
 *    (`commentFormPool` · scripts/lib/persona-reference-store.mts — 5~160자 전체).
 * 🔴 판정이 아니다. 아무것도 막지 않는다 — 생성에 건네는 재료다.
 */
import { sourceFormOf } from './content-core/source-form'
import { unitOf } from './persona-thread-plan'

export type CommentEndMark = '.' | '..' | '?' | '!' | 'ㅋㅎ류' | 'ㅠㅜ류' | '~' | '없음'
/** 말끝 종류 — 요(…요 · …죠) · 다(평서 · 반말 종결) · 끊김(연결어미 · 조사로 끝) · 명사(낱말 · 감탄 한마디) */
export type CommentEnding = '요' | '다' | '끊김' | '명사'

export type CommentForm = {
  /** 빈 줄을 뺀 줄들의 글자 수 합 — `sourceFormOf` 와 같은 값 */
  글자수: number
  줄: '한 줄' | '여러 줄'
  말끝: CommentEnding
  /** 마지막 글자 뒤에 붙은 것의 종류 */
  끝부호: CommentEndMark
  물음표수: number
  /** .. 이상 · … 의 덩어리 수 */
  말줄임수: number
  /** ㅋ · ㅎ · ㅠ · ㅜ · ^^ · 그림 이모지 중 하나라도 있는가 */
  이모티콘: boolean
}

/** 꼴 풀의 글자 수 범위 — 이보다 짧으면 꼴이 없고, 길면 글 본문에 가깝다 */
export const FORM_POOL_MIN_CHARS = 5
export const FORM_POOL_MAX_CHARS = 160
/** 경험으로 답하는 자리 — 한 토막을 말할 자리가 있어야 해서 이 길이 이상의 꼴만 뽑는다 */
export const FORM_EXPERIENCE_MIN_CHARS = 41

/** 낱말 글자 — 이것이 아닌 것이 끝에 붙은 "끝부호" 다 */
const WORD_CHAR = /[가-힣A-Za-z0-9]/u
const EMOTICON_RE = /[ㅋㅎㅠㅜ]|\^\^|\p{Extended_Pictographic}/u

function endMarkOf(tail: string): CommentEndMark {
  if (/[ㅋㅎ]|\^\^/.test(tail)) return 'ㅋㅎ류'
  if (/[ㅠㅜ]/.test(tail)) return 'ㅠㅜ류'
  if (/[?？]/.test(tail)) return '?'
  if (/[!！]/.test(tail)) return '!'
  if (/[~～]/.test(tail)) return '~'
  if (/\.{2,}|…/.test(tail)) return '..'
  if (tail.includes('.')) return '.'
  return '없음'
}

/** 연결어미 · 조사 — 말을 맺지 않고 끊은 끝. 🔴 두 글자 이상이 먼저다(…니까 의 까 · …지만 의 만 이 종결로 읽히지 않게) */
const CUT_LONG = ['는데', '은데', '인데', '던데', '니까', '지만', '는지', '은지', '려고', '면서', '도록', '거나', '든지', '듯이', '해서', '어서', '아서', '여서', '라서', '하고', '랑은', '에서', '한테', '보다', '까지', '부터', '처럼', '만큼']
/** 평서 · 반말 종결 한 글자 — …다 · …네 · …음 · …임 · …지 · …야 · …해 · …까 … */
const END_DA = new Set(['다', '네', '음', '임', '함', '셈', '됨', '짐', '림', '지', '군', '걸', '래', '야', '어', '아', '해', '까', '자', '냐', '니', '나', '여'])
/** 한 글자 규칙에 걸리지만 낱말 한마디로 끝나는 흔한 말 — "최고" 의 고 · "진짜" 는 연결어미가 아니다 */
const NOUN_WORDS = new Set(['최고', '진짜', '정말', '대박', '화이팅', '파이팅', '감사', '축하', '최애', '인정'])
/** 연결어미 · 조사 한 글자 */
const CUT_ONE = new Set(['고', '며', '면', '서', '데', '듯', '도', '를', '을', '은', '는', '이', '가', '에', '랑', '와', '과', '로', '만', '든', '게', '께', '의', '엔'])

/**
 * 🔴 **말끝 종류 — 순수 분류.** 마지막 줄에서 끝의 한글 아닌 것(부호 · ㅋㅎ · ㅠ · 이모지)을 떼고 마지막 어절을 본다.
 *    ① 한글이 없다(ㅋㅋ 만 · 이모지만) · 흔한 한마디(`NOUN_WORDS`) → 명사
 *    ② …요 · …죠 → 요
 *    ③ 두 글자 이상 연결어미 · 조사(`CUT_LONG`) → 끊김
 *    ④ 평서 · 반말 종결 한 글자(`END_DA`) → 다
 *    ⑤ 연결어미 · 조사 한 글자(`CUT_ONE`) → 끊김
 *    ⑥ 그 밖(명사 · 감탄 · 형용사 어간으로 끝) → 명사
 */
export function endingKindOf(text: string): CommentEnding {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  const last = (lines.at(-1) ?? '').replace(/[^가-힣]+$/u, '')
  const word = last.split(/[^가-힣]+/).filter((w) => w !== '').at(-1) ?? ''
  if (word === '' || NOUN_WORDS.has(word)) return '명사'
  if (/[요죠]$/.test(word)) return '요'
  if (CUT_LONG.some((s) => word.length > s.length && word.endsWith(s))) return '끊김'
  const ch = [...word].at(-1)!
  if (END_DA.has(ch)) return '다'
  if (CUT_ONE.has(ch) && word.length > 1) return '끊김'
  return '명사'
}

export function commentFormOf(text: string): CommentForm {
  const sf = sourceFormOf(text)
  const chars = [...text.trim()]
  let cut = chars.length
  while (cut > 0 && !WORD_CHAR.test(chars[cut - 1]!)) cut -= 1
  return {
    글자수: sf.글자수,
    줄: sf.줄수 > 1 ? '여러 줄' : '한 줄',
    말끝: endingKindOf(text),
    끝부호: endMarkOf(chars.slice(cut).join('')),
    물음표수: sf.물음표,
    말줄임수: sf.말줄임,
    이모티콘: EMOTICON_RE.test(text),
  }
}

/**
 * 🔴 **자리마다 꼴 하나 — 결정적이다.** 같은 글 · 같은 순번(첫 댓글은 1)은 언제나 같은 꼴이다.
 *    풀은 중복을 지우고 글자 순으로 세운 뒤 `unitOf('form', postId, ordinal)` 로 집는다 — 자산의 행 순서와 무관하다.
 *    경험으로 답하는 자리는 `FORM_EXPERIENCE_MIN_CHARS` 이상에서만 뽑는다. 풀이 비면 null(부르는 쪽이 막는다).
 *    🔴 돌려주는 것은 꼴 값뿐이다 — 뽑힌 댓글의 본문은 이 함수 밖으로 나가지 않는다.
 */
export function pickCommentForm(input: {
  pool: readonly string[]
  postId: string
  ordinal: number
  experience: boolean
}): CommentForm | null {
  const sorted = [...new Set(input.pool)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const usable = input.experience ? sorted.filter((t) => [...t].length >= FORM_EXPERIENCE_MIN_CHARS) : sorted
  if (usable.length === 0) return null
  return commentFormOf(usable[Math.floor(unitOf('form', input.postId, String(input.ordinal)) * usable.length)]!)
}
