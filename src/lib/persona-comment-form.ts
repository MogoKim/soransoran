/**
 * 댓글 꼴 재기 · 본보기 추첨 — 🔴 **댓글의 꼴은 실제 댓글에서, 자격은 Persona 에서**
 *
 * 🔴 왜 있는가: 길이를 "한 줄 · 한두 문장 · 서너 문장" 셋으로 말하고 끝 모양 · 문장부호를 모델 기본값에 맡기자
 *    댓글이 반듯한 "~요." 로 수렴했다(11-20 운영 219개 대 실제 879개 — 20자 이하 6% 대 15% · 마침표 끝 35% 대 18%).
 *    자리마다 실제 댓글 하나를 본보기로 뽑아 그 꼴(길이 · 끝 · 끝부호 · 웃음 울음)을 재서 건네면 같은 모델이 그 꼴로 쓴다.
 *    길이는 뽑힌 본보기의 실제 길이가 정한다 — 그래서 길이 분포가 풀의 분포를 따른다.
 * 🔴 글 쪽 `content-core/source-form.ts` 와 같은 생각이다 — 겹치는 계산(글자 수 · 줄 수 · 물음표 · 말줄임)은 그 함수를 쓴다.
 * 🔴 순수 함수다 — DB · 파일 · 시각을 읽지 않는다. 풀은 부르는 쪽이 참고 댓글 자산에서 걸러 넘긴다
 *    (`commentFormPool` · scripts/lib/persona-reference-store.mts). 풀은 경험담을 **빼지 않는다** — 빼면 긴 댓글이 빠져
 *    풀이 실제보다 짧아진다(879건 실측: 빼면 20자 이하 21.0% · 실제 15.5%). 대신 경험담이 뽑히면 꼴 값만 건네고
 *    본문은 건네지 않는다(남의 경험이 내용으로 새지 않게).
 * 🔴 판정이 아니다. 아무것도 막지 않는다 — 생성에 건네는 재료다.
 */
import { sourceFormOf } from './content-core/source-form'
import { unitOf } from './persona-thread-plan'

export type CommentEndMark = '.' | '..' | '?' | '!' | 'ㅋㅎ류' | 'ㅠㅜ류' | '~' | '없음'

export type CommentForm = {
  /** 빈 줄을 뺀 줄들의 글자 수 합 — `sourceFormOf` 와 같은 값 */
  글자수: number
  줄수: number
  /** 마지막 어절의 끝 3자(어절이 짧으면 그만큼) — 끝의 부호 · ㅋㅎ · ㅠㅜ 는 떼고 잰다 */
  끝: string
  /** 마지막 글자 뒤에 붙은 것의 종류 */
  끝부호: CommentEndMark
  물음표수: number
  /** .. 이상 · … 의 덩어리 수 */
  말줄임수: number
  /** ㅋ · ㅎ · ㅠ · ㅜ · ^^ · 그림 이모지 중 하나라도 있는가 */
  이모티콘: boolean
}

/** 본보기 풀의 글자 수 범위 — 이보다 짧으면 꼴이 없고, 길면 글 본문에 가깝다 */
export const FORM_EXAMPLE_MIN_CHARS = 5
export const FORM_EXAMPLE_MAX_CHARS = 160
/** 경험으로 답하는 자리 — 한 토막을 말할 자리가 있어야 해서 이 길이 이상에서만 뽑는다 */
export const FORM_EXPERIENCE_MIN_CHARS = 41

const END_CHARS = 3
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

export function commentFormOf(text: string): CommentForm {
  const sf = sourceFormOf(text)
  const chars = [...text.trim()]
  let cut = chars.length
  while (cut > 0 && !WORD_CHAR.test(chars[cut - 1]!)) cut -= 1
  const tail = chars.slice(cut).join('')
  const lastWord = chars.slice(0, cut).join('').split(/\s+/).at(-1) ?? ''
  return {
    글자수: sf.글자수,
    줄수: sf.줄수,
    끝: [...lastWord].slice(-END_CHARS).join(''),
    끝부호: endMarkOf(tail),
    물음표수: sf.물음표,
    말줄임수: sf.말줄임,
    이모티콘: EMOTICON_RE.test(text),
  }
}

/** 풀 한 칸 — 실제 댓글과 그것이 남의 경험을 담았는가(`carriesExperience`) */
export type FormPoolEntry = { text: string; experience: boolean }

/** 🔴 `본보기` 는 경험담이 뽑혔으면 null 이다 — 꼴 값만 건넨다 */
export type FormExample = { 꼴: CommentForm; 본보기: string | null }

/**
 * 🔴 **자리마다 본보기 하나 — 결정적이다.** 같은 글 · 같은 순번(첫 댓글은 1)은 언제나 같은 본보기다.
 *    풀은 중복을 지우고 글자 순으로 세운 뒤 `unitOf('form', postId, ordinal)` 로 집는다 — 자산의 행 순서와 무관하다.
 *    경험으로 답하는 자리는 `FORM_EXPERIENCE_MIN_CHARS` 이상에서만 뽑는다. 풀이 비면 null(부르는 쪽이 막는다).
 *    뽑힌 댓글이 경험담이면 꼴만 돌려주고 `본보기` 는 null 이다.
 */
export function pickFormExample(input: {
  pool: readonly FormPoolEntry[]
  postId: string
  ordinal: number
  experience: boolean
}): FormExample | null {
  // 같은 글자의 칸이 여럿이면 하나라도 경험담이면 경험담으로 본다(안전한 쪽)
  const byText = new Map<string, boolean>()
  for (const e of input.pool) byText.set(e.text, (byText.get(e.text) ?? false) || e.experience)
  const sorted = [...byText.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const usable = input.experience ? sorted.filter((t) => [...t].length >= FORM_EXPERIENCE_MIN_CHARS) : sorted
  if (usable.length === 0) return null
  const text = usable[Math.floor(unitOf('form', input.postId, String(input.ordinal)) * usable.length)]!
  return { 꼴: commentFormOf(text), 본보기: byText.get(text) === true ? null : text }
}
