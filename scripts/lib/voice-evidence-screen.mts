/**
 * Public-comment screening for supplemental Persona voice evidence.
 *
 * This lane is intentionally stricter than member posting. Losing a comment is
 * harmless; retaining identifying or lived-experience text is not.
 */
import { checkContent } from '../../src/lib/content-guard'
import { REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS } from '../../src/lib/persona-voice-reference'
import { checkNameCollision, normalizeN2 } from './persona-gate-name-collision.mjs'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import { carriesExperience, identityLeakCheck, type LocalComment } from './persona-reference-store.mjs'

export type PublicCommentRow = {
  source: string
  articleId: string
  author: string | null
  text: string
}

export const COMMENT_DROP_CODES = [
  'UNATTRIBUTED',
  'OUT_OF_BAND',
  'PII',
  'UNSAFE',
  'IDENTITY_LEAK',
  'NICKNAME_LEAK',
  'EXPERIENCE',
  'REAL_MEMBER_SPEAKER',
  'REAL_MEMBER_UNMEASURED',
] as const
export type CommentDropCode = (typeof COMMENT_DROP_CODES)[number]

const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const KO_DIGIT: Record<string, string> = {
  '공': '0', '영': '0', '일': '1', '이': '2', '삼': '3', '사': '4', '오': '5',
  '육': '6', '륙': '6', '칠': '7', '팔': '8', '구': '9',
}
const LONG_DIGIT_RUN = /\d(?:[\s.\-]{0,2}\d){8,}/
const VOICE_PII_PATTERNS: readonly RegExp[] = [
  /https?:\/\/|www\.|open\.kakao|\b[a-z0-9-]{2,}\.(?:com|net|org|kr|co|me|ly|io|us|gl|to)\b/i,
  /골뱅이|[([]\s*at\s*[)\]]|\s@\s|(?:naver|daum|hanmail|gmail|nate|kakao)\s*(?:[.·]|dot|닷|점)\s*(?:com|net)/i,
  /@\S/,
  /아이디(?!어)|\bid\s*[:：]|카\s+톡|ㅋㅌ|오픈\s*톡|인스타|instagram|라인\s*(?:아이디|id)|밴드\s*주소|블로그\s*주소/i,
  /\d{1,4}\s*동\s*\d{1,4}\s*호|\d+\s*번지/,
  /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s+[가-힣]{1,5}(?:시|군|구)\s+[가-힣]{1,6}(?:구|동|읍|면|로|길)/,
  /01[016789]\s*[-.]\s*[0-9lIoO]{3,4}\s*[-.]\s*[0-9lIoO]{4}/,
]

const foldDigits = (text: string): string => text.normalize('NFKC').replace(/[️⃣]/g, '')

export function voiceEvidencePii(text: string): boolean {
  const folded = foldDigits(text)
  if (LONG_DIGIT_RUN.test(folded)) return true
  if (/[공영0]\s*[일1]\s*[공영0]/.test(folded)
    && LONG_DIGIT_RUN.test(folded.replace(/[공영일이삼사오육륙칠팔구]/g, (c) => KO_DIGIT[c] ?? c))) return true
  return VOICE_PII_PATTERNS.some((re) => re.test(folded) || re.test(text))
}

export function piiOrUnsafe(text: string): CommentDropCode | null {
  if (EMAIL_LIKE.test(text) || voiceEvidencePii(text)) return 'PII'
  const content = checkContent(text, { audience: 'bot' })
  if (!content.ok) {
    const code = content.issue?.code
    return code === 'CONTACT_PHONE' || code === 'CONTACT_EXTERNAL_ID' ? 'PII' : 'UNSAFE'
  }
  const safety = safetyFilter({ title: '', body: text })
  if (safety.reasons.some((reason) => reason.code === 'personalIdentity')) return 'PII'
  return safety.verdict === 'pass' ? null : 'UNSAFE'
}

export type ScreenResult = {
  kept: LocalComment[]
  dropped: Record<CommentDropCode, number>
  identityLeak: { ran: boolean; hits: number }
  input: number
}

const emptyDrops = (): Record<CommentDropCode, number> =>
  Object.fromEntries(COMMENT_DROP_CODES.map((code) => [code, 0])) as Record<CommentDropCode, number>

export function screenPublicComments(
  rows: readonly PublicCommentRow[],
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null,
  idOf: (source: string, author: string) => string,
): ScreenResult {
  const dropped = emptyDrops()
  const kept: LocalComment[] = []
  const authorsBySource = new Map<string, Set<string>>()
  for (const row of rows) {
    const author = (row.author ?? '').trim()
    if (author === '') continue
    const authors = authorsBySource.get(row.source) ?? new Set<string>()
    authors.add(author)
    authorsBySource.set(row.source, authors)
  }
  const allAuthors = [...authorsBySource.values()].flatMap((authors) => [...authors])
  const memberNames = (members?.memberNames ?? []).map((name) => name.trim()).filter((name) => [...name].length >= 2)
  const personaNames = members?.personaNames ?? []
  const realCache = new Map<string, boolean>()

  for (const row of rows) {
    const author = (row.author ?? '').trim()
    const text = row.text.trim()
    const drop = (code: CommentDropCode): void => { dropped[code] += 1 }
    if (author === '') { drop('UNATTRIBUTED'); continue }
    if (members === null) { drop('REAL_MEMBER_UNMEASURED'); continue }
    const length = [...text].length
    if (length < REFERENCE_MIN_CHARS || length > REFERENCE_MAX_CHARS) { drop('OUT_OF_BAND'); continue }

    const authorKey = `${row.source}\u0000${author}`
    let real = realCache.get(authorKey)
    if (real === undefined) {
      const collision = checkNameCollision(author, { memberNames, personaNames })
      real = collision.hits.some((hit) => hit.kind === 'B1_MEMBER' || hit.kind === 'B3_PERSONA')
      realCache.set(authorKey, real)
    }
    if (real) { drop('REAL_MEMBER_SPEAKER'); continue }
    if (allAuthors.includes(text)) { drop('IDENTITY_LEAK'); continue }

    const sourceNames = [...(authorsBySource.get(row.source) ?? [])].filter((name) => [...name].length >= 2)
    if (sourceNames.some((name) => text.includes(name)) || memberNames.some((name) => text.includes(name))) {
      drop('NICKNAME_LEAK'); continue
    }
    const unsafe = piiOrUnsafe(text)
    if (unsafe !== null) { drop(unsafe); continue }
    if (carriesExperience(text)) { drop('EXPERIENCE'); continue }
    kept.push({ speakerId: idOf(row.source, author), text })
  }

  const leak = identityLeakCheck({ texts: kept.map((row) => row.text), authors: allAuthors })
  return { kept, dropped, identityLeak: { ran: leak.ran, hits: leak.hits }, input: rows.length }
}

export const normalizedMemberName = (name: string): string => normalizeN2(name)
