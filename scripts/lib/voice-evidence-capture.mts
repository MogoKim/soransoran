/**
 * Supplemental Persona voice evidence captured from public comments.
 * Author labels are immediately replaced with secret-salt HMAC values.
 */
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS } from '../../src/lib/persona-voice-reference'
import {
  COMMENT_DROP_CODES, normalizedMemberName, piiOrUnsafe, screenPublicComments,
  type CommentDropCode, type PublicCommentRow,
} from './voice-evidence-screen.mjs'

export const VOICE_EVIDENCE_SALT_ENV = 'SORAN_VOICE_EVIDENCE_SALT'
export const VOICE_EVIDENCE_SALT_MIN_CHARS = 32
export const VOICE_EVIDENCE_VERSION = 1
export const VOICE_EVIDENCE_RETENTION_DAYS = 90
export const VOICE_EVIDENCE_SUFFIX = '.voice-evidence.jsonl'
export const voiceEvidenceDataDir = (home = homedir()): string => join(
  home, 'Library', 'Application Support', 'soransoran', 'microseed-data', 'voice-evidence',
)

export type EvidenceSalt =
  | { ok: true; salt: string; saltId: string }
  | { ok: false; code: 'SALT_MISSING' | 'SALT_TOO_SHORT' }

export function readEvidenceSalt(env: Readonly<Record<string, string | undefined>>): EvidenceSalt {
  const raw = (env[VOICE_EVIDENCE_SALT_ENV] ?? '').trim()
  if (raw === '') return { ok: false, code: 'SALT_MISSING' }
  if ([...raw].length < VOICE_EVIDENCE_SALT_MIN_CHARS) return { ok: false, code: 'SALT_TOO_SHORT' }
  return {
    ok: true,
    salt: raw,
    saltId: createHash('sha256').update(`voice-evidence-salt-id\u0000${raw}`).digest('hex').slice(0, 12),
  }
}

const hmac = (salt: string, value: string): string => createHmac('sha256', salt).update(value, 'utf8').digest('hex')

export const speakerHashOf = (salt: string, source: string, author: string): string =>
  `vs1:${hmac(salt, `speaker\u0000${source}\u0000${author.trim()}`)}`

export const memberKeyOf = (salt: string, name: string): string =>
  `vm1:${hmac(salt, `member\u0000${normalizedMemberName(name)}`)}`

export type VoiceEvidenceRow = {
  v: typeof VOICE_EVIDENCE_VERSION
  kind: 'voice-evidence'
  source: string
  articleId: string
  speakerHash: string
  memberKey: string
  saltId: string
  text: string
  capturedAt: string
  runId: string
}

const ROW_KEYS = ['v', 'kind', 'source', 'articleId', 'speakerHash', 'memberKey', 'saltId', 'text', 'capturedAt', 'runId'] as const

export function evidenceRowProblems(row: unknown, authors: readonly string[] = []): string[] {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['not-object']
  const object = row as Record<string, unknown>
  const problems: string[] = []
  if (Object.keys(object).sort().join() !== [...ROW_KEYS].sort().join()) problems.push('shape')
  if (object.v !== VOICE_EVIDENCE_VERSION || object.kind !== 'voice-evidence') problems.push('version')
  if (typeof object.speakerHash !== 'string' || !/^vs1:[0-9a-f]{64}$/.test(object.speakerHash)) problems.push('speakerHash')
  if (typeof object.memberKey !== 'string' || !/^vm1:[0-9a-f]{64}$/.test(object.memberKey)) problems.push('memberKey')
  if (typeof object.saltId !== 'string' || !/^[0-9a-f]{12}$/.test(object.saltId)) problems.push('saltId')
  for (const key of ['source', 'articleId', 'capturedAt', 'runId'] as const) {
    if (typeof object[key] !== 'string' || object[key] === '') problems.push(key)
  }
  if (typeof object.capturedAt === 'string' && Number.isNaN(Date.parse(object.capturedAt))) problems.push('capturedAt')
  if (typeof object.text !== 'string') problems.push('text')
  else {
    const length = [...object.text.trim()].length
    if (length < REFERENCE_MIN_CHARS || length > REFERENCE_MAX_CHARS) problems.push('text-band')
    if (piiOrUnsafe(object.text) !== null) problems.push('text-safety')
  }
  const authorNames = authors.map((author) => author.trim()).filter((author) => [...author].length >= 2)
  const serialized = JSON.stringify(object)
  if (authorNames.some((author) => serialized.includes(author))) problems.push('author-leak')
  return problems
}

export type CapturedComment = { author: string | null; text: string }
export const PLACEHOLDER_COMMENT = /^(?:삭제된|비밀|숨김 처리된|신고(?:로|에 의해)? 숨겨진)\s*댓글입니다\.?$|^작성자(?:가|에 의해)\s*삭제된\s*댓글입니다\.?$|^비밀\s*댓글$/

export type CaptureResult = {
  stored: boolean
  code: 'OK' | 'SALT_MISSING' | 'SALT_TOO_SHORT' | 'CONTRACT_VIOLATION'
  rows: VoiceEvidenceRow[]
  seen: number
  dropped: Record<CommentDropCode, number>
}

const zeroDrops = (): Record<CommentDropCode, number> =>
  Object.fromEntries(COMMENT_DROP_CODES.map((code) => [code, 0])) as Record<CommentDropCode, number>

export function captureVoiceEvidence(input: {
  source: string
  articleId: string
  comments: readonly CapturedComment[]
  runId: string
  now: Date
}, salt: EvidenceSalt): CaptureResult {
  if (!salt.ok) return { stored: false, code: salt.code, rows: [], seen: input.comments.length, dropped: zeroDrops() }
  const publicRows: PublicCommentRow[] = input.comments
    .filter((comment) => !PLACEHOLDER_COMMENT.test(comment.text.trim()))
    .map((comment) => ({
      source: input.source,
      articleId: input.articleId,
      author: comment.author,
      text: comment.text,
    }))
  const memberKeys = new Map<string, string>()
  const screened = screenPublicComments(publicRows, { memberNames: [] }, (source, author) => {
    const id = speakerHashOf(salt.salt, source, author)
    memberKeys.set(id, memberKeyOf(salt.salt, author))
    return id
  })
  const capturedAt = input.now.toISOString()
  const rows: VoiceEvidenceRow[] = screened.kept.map((comment) => ({
    v: VOICE_EVIDENCE_VERSION,
    kind: 'voice-evidence',
    source: input.source,
    articleId: input.articleId,
    speakerHash: comment.speakerId,
    memberKey: memberKeys.get(comment.speakerId) ?? '',
    saltId: salt.saltId,
    text: comment.text.trim(),
    capturedAt,
    runId: input.runId,
  }))
  const authors = input.comments.map((comment) => comment.author ?? '')
  if (screened.identityLeak.hits > 0 || rows.some((row) => evidenceRowProblems(row, authors).length > 0)) {
    return {
      stored: false,
      code: 'CONTRACT_VIOLATION',
      rows: [],
      seen: input.comments.length,
      dropped: screened.dropped,
    }
  }
  return { stored: true, code: 'OK', rows, seen: input.comments.length, dropped: screened.dropped }
}

export const voiceEvidencePathOf = (dataDir: string, cafeId: string, runId: string): string =>
  join(dataDir, `navercafe-voice-${cafeId}-${runId}${VOICE_EVIDENCE_SUFFIX}`)

export const EVIDENCE_READ_DROP_CODES = [
  'SALT_MISSING',
  'SALT_ROTATED',
  'EXPIRED',
  'AFTER_EVIDENCE_UNTIL',
  'MALFORMED',
  'REAL_MEMBER_UNMEASURED',
  'REAL_MEMBER_SPEAKER',
] as const
export type EvidenceReadDropCode = (typeof EVIDENCE_READ_DROP_CODES)[number]

const EVIDENCE_UNTIL_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * 🔴 **증거 시각 상한** `--evidence-until=<ISO>` — 계획 도구(`persona:expansion`)와 기록 도구
 *    (`persona:reference-supplement-build`)가 이 함수 하나로 같은 뜻으로 읽는다: `capturedAt` 이 상한 이하인 근거만 쓴다.
 *    수집기는 하루 내내 근거를 더하므로, 낮에 카드 말투를 렌더한 묶음과 밤 apply 묶음이 같으려면 두 실행이
 *    같은 상한을 받아야 한다. 시간대가 적힌 ISO 만 받는다(지역 시각 모호성 0) · 지금보다 뒤는 상한이 아니다.
 *    값은 정규형(`toISOString`)으로 바꿔 돌려준다 — 승인 digest 와 manifest 사유에 그 글자를 쓴다.
 */
export function parseEvidenceUntil(raw: string | null, now: Date):
  | { ok: true; until: Date | null; iso: string | null }
  | { ok: false; reason: string } {
  if (raw === null) return { ok: true, until: null, iso: null }
  const value = raw.trim()
  if (!EVIDENCE_UNTIL_FORM.test(value) || Number.isNaN(Date.parse(value))) {
    return { ok: false, reason: `--evidence-until 은 시간대가 적힌 ISO 시각이어야 한다 (예: 2026-11-23T03:00:00Z) — 받은 값 "${value}"` }
  }
  const until = new Date(value)
  if (until.getTime() > now.getTime()) {
    return { ok: false, reason: `--evidence-until ${until.toISOString()} 이 지금(${now.toISOString()})보다 뒤다 — 미래 시각은 상한이 아니다` }
  }
  return { ok: true, until, iso: until.toISOString() }
}

export function rowsFromVoiceEvidence(lines: readonly unknown[], context: {
  salt: EvidenceSalt
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null
  now: Date
  /** 🔴 증거 시각 상한 — 이 시각 뒤에 수집된 근거는 읽지 않는다(`parseEvidenceUntil`). 없으면 상한 없음 */
  until?: Date | null
}): { rows: PublicCommentRow[]; read: number; dropped: Record<EvidenceReadDropCode, number> } {
  const dropped = Object.fromEntries(EVIDENCE_READ_DROP_CODES.map((code) => [code, 0])) as Record<EvidenceReadDropCode, number>
  const valid: VoiceEvidenceRow[] = []
  for (const line of lines) {
    if (evidenceRowProblems(line).length > 0) { dropped.MALFORMED += 1; continue }
    valid.push(line as VoiceEvidenceRow)
  }
  if (!context.salt.ok) { dropped.SALT_MISSING += valid.length; return { rows: [], read: lines.length, dropped } }
  if (context.members === null) { dropped.REAL_MEMBER_UNMEASURED += valid.length; return { rows: [], read: lines.length, dropped } }
  const validSalt = context.salt
  const memberKeys = new Set(
    [...context.members.memberNames, ...(context.members.personaNames ?? [])]
      .filter((name) => normalizedMemberName(name) !== '')
      .map((name) => memberKeyOf(validSalt.salt, name)),
  )
  const cutoff = context.now.getTime() - VOICE_EVIDENCE_RETENTION_DAYS * 86_400_000
  const ceiling = context.until === undefined || context.until === null ? null : context.until.getTime()
  const realSpeakers = new Set(valid
    .filter((row) => row.saltId === validSalt.saltId && memberKeys.has(row.memberKey))
    .map((row) => row.speakerHash))
  const rows: PublicCommentRow[] = []
  for (const row of valid) {
    if (row.saltId !== validSalt.saltId) { dropped.SALT_ROTATED += 1; continue }
    if (Date.parse(row.capturedAt) < cutoff) { dropped.EXPIRED += 1; continue }
    if (ceiling !== null && Date.parse(row.capturedAt) > ceiling) { dropped.AFTER_EVIDENCE_UNTIL += 1; continue }
    if (realSpeakers.has(row.speakerHash)) { dropped.REAL_MEMBER_SPEAKER += 1; continue }
    rows.push({ source: row.source, articleId: row.articleId, author: row.speakerHash, text: row.text })
  }
  return { rows, read: lines.length, dropped }
}
