/**
 * **말투 근거 수집** — 공개 댓글을 수집 시점에 거르고, 작성자를 곧바로 비밀 salt 해시로 바꾼다 (2026-09-29, Track C)
 *
 * 🔴 **왜 있는가.** 실측(2026-09-29): 네이버 카페 상세를 연 글 1,706건에 댓글 22,262건이 달려 있었지만
 *    수집기는 댓글 **수**만 남겼다. 수집 산출물 jsonl 1,192개 · Raw Vault `rawComments` 390행 전부에
 *    댓글 원문 0 · 작성자 0 이다. 그래서 "한 화자 3건↑" 을 셀 재료가 처음부터 없다 —
 *    공급 파이프라인(`persona-voice-supply`)이 아무리 맞아도 사용 가능 화자는 0 이다.
 *    이 파일은 **앞으로** 근거가 쌓이게 하는 최소 변경이다. 지난 회차는 되살리지 않는다.
 *
 * 🔴 **저장하는 것 / 저장하지 않는 것**
 *    저장  · 거르기를 통과한 댓글 본문(길이 밴드 안)
 *          · `speakerHash` = HMAC-SHA256(salt, 출처 + 작성자 표시) — 같은 사람을 묶는 데만 쓴다
 *          · `memberKey`   = HMAC-SHA256(salt, N2 정규화 작성자 표시) — 공급 시점 실회원 대조에만 쓴다
 *          · `saltId`      = salt 의 지문(salt 자체가 아니다) · 출처 · 글 번호(공개 URL 의 일부) · 시각 · runId
 *    안 함 · 작성자 표시(닉네임) · 회원 ID · 프로필 링크 · 댓글 시각 · 개인정보가 걸린 댓글 · 걸러진 댓글
 *
 * 🔴 **salt 가 없으면 아무것도 저장하지 않는다 (fail-closed).**
 *    salt 는 `SORAN_VOICE_EVIDENCE_SALT` 에서만 읽는다. 기본값이 없다 — 기본값이 있으면 그 값은 곧 공개 값이고,
 *    닉네임 공간은 작아(정본 자산 729명) 사전 대입으로 되돌릴 수 있다. 32자 미만도 없는 것으로 본다.
 *    salt 를 Git · 산출물 · 로그에 남기지 않는다. 산출물에는 지문(`saltId`)만 남는다.
 *
 * 🔴 **실회원 대조는 두 번이다.**
 *    ① 수집 시점 — 수집기는 DB 를 import 하지 않는다(수집 레일 계약). 그래서 회원 표시명을 모른다.
 *       대신 같은 글의 다른 작성자 표시가 본문에 섞인 댓글(`NICKNAME_LEAK`)과 본문 = 작성자 표시
 *       (`IDENTITY_LEAK`)를 여기서 버린다.
 *    ② 공급 시점 — `rowsFromVoiceEvidence` 가 회원·Persona 표시명을 같은 salt 로 해시해 `memberKey` 와
 *       대조한다. 🔴 회원 표시명을 못 읽었으면(null) 전부 버린다. salt 가 다르면(회전) 대조할 수 없으니 전부 버린다.
 *    ⚠️ 해시 대조는 N0~N2 **완전 일치**만 잡는다. 글자 하나 다른 근접 이름(Gate ⑥-B 의 거리 1)은 못 잡는다 —
 *       공급 시점에 원래 이름이 없기 때문이다. 그 약점은 Persona 표시명 쪽 Gate ⑥-B(원문 대조)가 따로 막는다.
 *
 * 🔴 **보존 · 삭제**
 *    · 보존 기한 `VOICE_EVIDENCE_RETENTION_DAYS`(90일). 공급은 기한이 지난 줄을 **읽지 않는다**(`EXPIRED`).
 *      🔴 읽지 않는 것은 삭제가 아니다 — 실제 삭제는 `voice-evidence-retention.mts`
 *      (`npm run persona:voice-evidence-purge -- --execute`)가 한다. 🔴 예약되어 있지 않다 —
 *      launchd 를 바꾸지 않았다. 켜기 전에 삭제 주기(사람 · 예약)를 정해야 한다.
 *    · **삭제 요청**도 같은 경로다 — salt 를 가진 사람이 `speakerHashOf(salt, 출처, 작성자 표시)` 를 계산해
 *      `--speaker-hash=` 로 넘긴다. salt 가 없으면 누구의 줄인지 특정할 수 없다.
 *    · 🔴 **이것은 익명화가 아니라 가명화다.** salt 를 가진 사람은 공개 화면의 작성자 표시를 다시 해시해
 *      어느 줄이 누구의 것인지 되짚을 수 있다(공개 출처 + salt = 재식별). salt 는 비밀로 두고,
 *      저장 행은 개인정보로 다룬다.
 *    · **salt 회전 = 전체 연결 끊기.** salt 를 바꾸면 이전 줄의 `speakerHash` 끼리는 여전히 묶이지만
 *      새 줄과는 묶이지 않고, 실회원 대조가 불가능해 공급이 전부 버린다(`SALT_ROTATED`).
 *      salt 를 버리면 어떤 해시도 누구의 것인지 다시 계산할 수 없다.
 *    · 원문 댓글·작성자 표시는 메모리에만 있다. 수집기는 거르기가 끝난 행만 파일 한 번으로 쓴다.
 *
 * 🔴 **새 판정을 만들지 않는다.** 거르기는 `screenPublicComments`(개인정보 · 안전 · 닉네임 혼입 ·
 *    식별자 유출 · 경험형 · 길이 밴드) 그대로다. 여기서 더하는 것은 salt 게이트와 저장 모양 검사뿐이다.
 *
 * 🔴 DB · 네트워크 · 파일 쓰기 없음 — 순수 함수다. 파일은 수집기가 쓴다.
 */
import { createHash, createHmac } from 'node:crypto'

import { REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS } from '../../src/lib/persona-voice-reference'
import { normalizeN2 } from './persona-gate-name-collision.mjs'
import {
  COMMENT_DROP_CODES, piiOrUnsafe, screenPublicComments,
  type CommentDropCode, type PublicCommentRow,
} from './persona-voice-supply.mjs'

// ─────────────────────────────────────────────────────────
// salt
// ─────────────────────────────────────────────────────────

/** 🔴 salt 를 읽는 유일한 env — 기본값 없음 */
export const VOICE_EVIDENCE_SALT_ENV = 'SORAN_VOICE_EVIDENCE_SALT'
/** 🔴 이보다 짧으면 없는 것으로 본다 — 짧은 salt 는 salt 가 아니다 */
export const VOICE_EVIDENCE_SALT_MIN_CHARS = 32
export const VOICE_EVIDENCE_VERSION = 1
/** 🔴 보존 기한 — 공급은 이보다 오래된 줄을 읽지 않는다 */
export const VOICE_EVIDENCE_RETENTION_DAYS = 90
/** 산출물 이름 끝 — 🔴 `thin` 을 넣지 않는다(`readSeenArticleIds` 가 thin 파일을 "본 글" 로 읽는다) */
export const VOICE_EVIDENCE_SUFFIX = '.voice-evidence.jsonl'

export type EvidenceSalt =
  | { ok: true; salt: string; saltId: string }
  | { ok: false; code: 'SALT_MISSING' | 'SALT_TOO_SHORT' }

/** 🔴 값을 돌려주지만 출력하지 않는다. 부르는 쪽도 `saltId` 만 보여 준다 */
export function readEvidenceSalt(env: Readonly<Record<string, string | undefined>>): EvidenceSalt {
  const raw = (env[VOICE_EVIDENCE_SALT_ENV] ?? '').trim()
  if (raw === '') return { ok: false, code: 'SALT_MISSING' }
  if ([...raw].length < VOICE_EVIDENCE_SALT_MIN_CHARS) return { ok: false, code: 'SALT_TOO_SHORT' }
  return { ok: true, salt: raw, saltId: createHash('sha256').update(`voice-evidence-salt-id\u0000${raw}`).digest('hex').slice(0, 12) }
}

const hmac = (salt: string, v: string): string => createHmac('sha256', salt).update(v, 'utf8').digest('hex')

/** 🔴 출처가 다르면 같은 이름도 다른 사람이다 */
export const speakerHashOf = (salt: string, source: string, author: string): string =>
  `vs1:${hmac(salt, `speaker\u0000${source}\u0000${author.trim()}`)}`

/** 🔴 출처와 무관 — 회원 표시명과 대조하는 키. Gate ⑥-B 의 N2 정규화 그대로 */
export const memberKeyOf = (salt: string, name: string): string =>
  `vm1:${hmac(salt, `member\u0000${normalizeN2(name)}`)}`

// ─────────────────────────────────────────────────────────
// 저장 모양
// ─────────────────────────────────────────────────────────

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

/**
 * 🔴 **저장 계약 검사** — 쓰기 직전(수집기)과 읽은 직후(공급) 둘 다 부른다.
 *    · 칸은 정확히 `ROW_KEYS` — 작성자 칸이 끼어들 자리가 없다
 *    · 해시 모양 · 밴드 · 개인정보/안전 재검사
 *    · `authors` 를 주면 어떤 칸에도 작성자 표시가 들어 있지 않은지 본다(수집기만 가진 값)
 */
export function evidenceRowProblems(row: unknown, authors: readonly string[] = []): string[] {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return ['객체가 아니다']
  const o = row as Record<string, unknown>
  const p: string[] = []
  const keys = Object.keys(o).sort()
  if (keys.join() !== [...ROW_KEYS].sort().join()) p.push(`칸이 계약과 다르다(${keys.length}칸)`)
  if (o.v !== VOICE_EVIDENCE_VERSION || o.kind !== 'voice-evidence') p.push('버전·종류가 다르다')
  if (typeof o.speakerHash !== 'string' || !/^vs1:[0-9a-f]{64}$/.test(o.speakerHash)) p.push('speakerHash 모양')
  if (typeof o.memberKey !== 'string' || !/^vm1:[0-9a-f]{64}$/.test(o.memberKey)) p.push('memberKey 모양')
  if (typeof o.saltId !== 'string' || !/^[0-9a-f]{12}$/.test(o.saltId)) p.push('saltId 모양')
  for (const k of ['source', 'articleId', 'capturedAt', 'runId'] as const) {
    if (typeof o[k] !== 'string' || o[k] === '') p.push(`${k} 없음`)
  }
  if (typeof o.capturedAt === 'string' && Number.isNaN(Date.parse(o.capturedAt))) p.push('capturedAt 시각 아님')
  if (typeof o.text !== 'string') p.push('text 없음')
  else {
    const n = [...o.text.trim()].length
    if (n < REFERENCE_MIN_CHARS || n > REFERENCE_MAX_CHARS) p.push('text 밴드 밖')
    if (piiOrUnsafe(o.text) !== null) p.push('text 개인정보·안전')
  }
  const names = authors.map((a) => a.trim()).filter((a) => [...a].length >= 2)
  if (names.length > 0) {
    const flat = JSON.stringify(o)
    if (names.some((a) => flat.includes(a))) p.push('🔴 작성자 표시가 저장 행에 있다')
  }
  return p
}

// ─────────────────────────────────────────────────────────
// ① 수집 시점 — 거르고 · 해시하고 · 저장할 행만 돌려준다
// ─────────────────────────────────────────────────────────

export type CapturedComment = { author: string | null; text: string }

/**
 * 🔴 **자리표시 댓글** — 삭제·비밀 댓글은 작성자 표시가 남은 채 본문이 안내 문구로 바뀐다.
 *    그 문구는 말투가 아니고, 여러 화자에게 같은 줄로 붙어 중복 화자 판정을 흔든다. 거르기 전에 뺀다.
 *    (셀렉터 실측 전이라 마크업이 아니라 문구로 본다 — 마크업이 바뀌어도 문구는 남는다.)
 */
export const PLACEHOLDER_COMMENT = /^(?:삭제된|비밀|숨김 처리된|신고(?:로|에 의해)? 숨겨진)\s*댓글입니다\.?$|^작성자(?:가|에 의해)\s*삭제된\s*댓글입니다\.?$|^비밀\s*댓글$/

export type CaptureResult = {
  /** 🔴 salt 가 없으면 false — rows 는 언제나 비어 있다 */
  stored: boolean
  code: 'OK' | 'SALT_MISSING' | 'SALT_TOO_SHORT' | 'CONTRACT_VIOLATION'
  rows: VoiceEvidenceRow[]
  seen: number
  dropped: Record<CommentDropCode, number>
}

const zeroDrops = (): Record<CommentDropCode, number> =>
  Object.fromEntries(COMMENT_DROP_CODES.map((c) => [c, 0])) as Record<CommentDropCode, number>

/**
 * 🔴 **글 한 건의 댓글 → 저장해도 되는 행.** 작성자 표시는 이 함수 밖으로 나가지 않는다.
 *
 *    · salt 없음 → 아무것도 보지 않고 빈 결과(`stored: false`)
 *    · 거르기는 `screenPublicComments` 그대로 — 회원 표시명은 수집 시점에 모르므로 빈 배열로 넘기고,
 *      실회원 대조는 공급 시점 `rowsFromVoiceEvidence` 가 `memberKey` 로 한다
 *    · 만든 행 하나라도 저장 계약을 어기면 **그 글 전체를 버린다**(`CONTRACT_VIOLATION`)
 */
export function captureVoiceEvidence(input: {
  source: string
  articleId: string
  comments: readonly CapturedComment[]
  runId: string
  now: Date
}, salt: EvidenceSalt): CaptureResult {
  const dropped = zeroDrops()
  if (!salt.ok) return { stored: false, code: salt.code, rows: [], seen: input.comments.length, dropped }
  const rows: PublicCommentRow[] = input.comments
    .filter((c) => !PLACEHOLDER_COMMENT.test(c.text.trim()))
    .map((c) => ({ source: input.source, articleId: input.articleId, author: c.author, text: c.text }))
  const memberKeyBySpeaker = new Map<string, string>()
  const screen = screenPublicComments(rows, { memberNames: [] }, undefined, (source, author) => {
    const id = speakerHashOf(salt.salt, source, author)
    memberKeyBySpeaker.set(id, memberKeyOf(salt.salt, author))
    return id
  })
  const at = input.now.toISOString()
  const out: VoiceEvidenceRow[] = screen.kept.map((k) => ({
    v: VOICE_EVIDENCE_VERSION,
    kind: 'voice-evidence',
    source: input.source,
    articleId: input.articleId,
    speakerHash: k.speakerId,
    memberKey: memberKeyBySpeaker.get(k.speakerId) ?? '',
    saltId: salt.saltId,
    text: k.text.trim(),
    capturedAt: at,
    runId: input.runId,
  }))
  const authors = input.comments.map((c) => c.author ?? '')
  if (screen.identityLeak.hits > 0 || out.some((r) => evidenceRowProblems(r, authors).length > 0)) {
    return { stored: false, code: 'CONTRACT_VIOLATION', rows: [], seen: input.comments.length, dropped: screen.dropped }
  }
  return { stored: true, code: 'OK', rows: out, seen: input.comments.length, dropped: screen.dropped }
}

/** 수집기 산출물 경로 — 🔴 thin 과 같은 디렉터리 · 회차별 파일 */
export const voiceEvidencePathOf = (dataDir: string, cafeId: string, runId: string): string =>
  `${dataDir}/navercafe-voice-${cafeId}-${runId}${VOICE_EVIDENCE_SUFFIX}`

// ─────────────────────────────────────────────────────────
// ② 공급 시점 — 저장된 행 → 공급 입력
// ─────────────────────────────────────────────────────────

export const EVIDENCE_READ_DROP_CODES = [
  'SALT_MISSING',            // 공급 쪽 salt 가 없다 — 실회원 대조를 못 한다
  'SALT_ROTATED',            // 수집 때와 salt 가 다르다 — 대조할 수 없다
  'EXPIRED',                 // 보존 기한이 지났다
  'MALFORMED',               // 저장 계약 위반(칸 · 해시 모양 · 개인정보 재검사)
  'REAL_MEMBER_UNMEASURED',  // 회원 표시명을 못 읽었다 — 🔴 모르면 통과가 아니다
  'REAL_MEMBER_SPEAKER',     // memberKey 가 회원·Persona 표시명 해시와 같다 — 그 화자 전부
] as const
export type EvidenceReadDropCode = (typeof EVIDENCE_READ_DROP_CODES)[number]

/**
 * 🔴 **저장된 말투 근거 → 공급 입력(`PublicCommentRow`).**
 *    `author` 자리에는 `speakerHash` 가 들어간다 — 원래 이름은 어디에도 없다.
 *    이후 `planVoiceSupply` 가 같은 거르기를 한 번 더 한다(두 겹).
 */
export function rowsFromVoiceEvidence(lines: readonly unknown[], ctx: {
  salt: EvidenceSalt
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null
  now: Date
}): { rows: PublicCommentRow[]; read: number; dropped: Record<EvidenceReadDropCode, number> } {
  const dropped = Object.fromEntries(EVIDENCE_READ_DROP_CODES.map((c) => [c, 0])) as Record<EvidenceReadDropCode, number>
  const valid: VoiceEvidenceRow[] = []
  for (const l of lines) {
    if (evidenceRowProblems(l).length > 0) { dropped.MALFORMED += 1; continue }
    valid.push(l as VoiceEvidenceRow)
  }
  const salt = ctx.salt
  if (!salt.ok) { dropped.SALT_MISSING += valid.length; return { rows: [], read: lines.length, dropped } }
  if (ctx.members === null) { dropped.REAL_MEMBER_UNMEASURED += valid.length; return { rows: [], read: lines.length, dropped } }
  const memberKeys = new Set(
    [...ctx.members.memberNames, ...(ctx.members.personaNames ?? [])]
      .filter((n) => normalizeN2(n) !== '')
      .map((n) => memberKeyOf(salt.salt, n)),
  )
  const cutoff = ctx.now.getTime() - VOICE_EVIDENCE_RETENTION_DAYS * 86_400_000
  const realSpeakers = new Set(valid.filter((r) => r.saltId === salt.saltId && memberKeys.has(r.memberKey)).map((r) => r.speakerHash))
  const rows: PublicCommentRow[] = []
  for (const r of valid) {
    if (r.saltId !== salt.saltId) { dropped.SALT_ROTATED += 1; continue }
    if (Date.parse(r.capturedAt) < cutoff) { dropped.EXPIRED += 1; continue }
    if (realSpeakers.has(r.speakerHash)) { dropped.REAL_MEMBER_SPEAKER += 1; continue }
    rows.push({ source: r.source, articleId: r.articleId, author: r.speakerHash, text: r.text })
  }
  return { rows, read: lines.length, dropped }
}
