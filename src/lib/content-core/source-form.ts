/**
 * 원문 꼴 재기 — 🔴 **글의 꼴은 원문에서, 자격은 Persona 에서**
 *
 * 🔴 왜 있는가: 지시문이 "새로 · 감상 · 질문 · 요약하지 않기" 를 시키자 초안은 원문보다 두 배 긴 줄 ·
 *    마침표로 끝나는 반듯한 문장 · "…궁금합니다" 맺음으로 수렴했다. 원문의 길이 · 줄 수 · 줄 끝 모양을
 *    코드가 재서 생성 요청에 건네면 같은 모델이 원문의 꼴로 쓴다.
 * 🔴 순수 함수다 — DB · 파일 · 시각을 읽지 않는다. 같은 본문이면 같은 값이다.
 * 🔴 판정이 아니다. 아무것도 막지 않는다 — 생성에 건네는 재료다.
 */

export type SourceForm = {
  /** 빈 줄·공백 줄을 뺀 줄들의 글자 수 합(줄 앞뒤 공백 제외) */
  글자수: number
  줄수: number
  /** 한글 뒤 마침표 하나로 끝나는 줄 수 */
  마침표로끝나는줄: number
  /** 한글로 끝나되 요/다/죠/까 로 끝나지 않는 줄 수 */
  어미없이끊긴줄: number
  /** .. 이상 · … 의 횟수(이어진 덩어리 하나를 한 번으로) */
  말줄임: number
  /** ㅠ ㅜ ㅋㅋ ㅎㅎ 덩어리 수 */
  울음웃음: number
  물음표: number
  느낌표: number
  /** 줄마다 마지막 4글자(공백 제외) — 앞에서부터 최대 12줄까지 */
  줄끝모양: string[]
  /** 마지막 줄의 마지막 12글자 */
  끝맺음: string
}

/** 줄끝모양을 담는 줄 수 상한 — 긴 글이 요청을 키우지 않게 */
export const SOURCE_FORM_LINE_SHAPES_MAX = 12
const LINE_END_CHARS = 4
const CLOSING_CHARS = 12

const ZERO_WIDTH_RE = /[​-‍﻿]/g
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length
const lastChars = (s: string, n: number): string => [...s].slice(-n).join('')

export function sourceFormOf(body: string): SourceForm {
  const lines = body.replace(ZERO_WIDTH_RE, '').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const text = lines.join('\n')
  return {
    글자수: lines.reduce((n, l) => n + [...l].length, 0),
    줄수: lines.length,
    마침표로끝나는줄: lines.filter((l) => /[가-힣]\.$/.test(l)).length,
    어미없이끊긴줄: lines.filter((l) => /[가-힣]$/.test(l) && !/[요다죠까]$/.test(l)).length,
    말줄임: count(text, /(?:\.{2,}|…)[.…]*/g),
    울음웃음: count(text, /[ㅠㅜ]+|ㅋ{2,}|ㅎ{2,}/g),
    물음표: count(text, /[?？]/g),
    느낌표: count(text, /[!！]/g),
    줄끝모양: lines.slice(0, SOURCE_FORM_LINE_SHAPES_MAX).map((l) => lastChars(l.replace(/\s+/g, ''), LINE_END_CHARS)),
    끝맺음: lines.length === 0 ? '' : lastChars(lines[lines.length - 1]!, CLOSING_CHARS),
  }
}
