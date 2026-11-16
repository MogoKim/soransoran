/**
 * 운영자 이름 명단 — OP 행 대조 · 배치 없음 (2026-11-16)
 *
 * 🔴 **D100 자동 Persona(P01~) 확장이 아니다.** 이 파일은 `/admin/compose` 에서 창업자가
 *    직접 고르는 이름(`OperatorWriter`)만 다룬다. Persona · 공급 · 발행 · 댓글 · stage ·
 *    runtime 은 import 하지 않고 한 줄도 쓰지 않는다.
 *
 * 🔴 **만드는 것은 사람마다 두 행뿐이다** — `User`(닉네임만) + `OperatorWriter`(code·note).
 *    `Account` 를 붙이지 않는다. `Persona` 를 연결하지 않는다.
 *
 * 🔴 **공개 닉네임 불변(P3).** DB 에 이미 있는 OP 행의 닉네임이 명단과 다르면 멈춤.
 *    바꾸려면 retired + 새 code.
 *
 * 🔴 **PV 행 무시(P6).** `^PV` code 는 Persona 목소리 행이다. 도구는 `^OP\d+$` code 만 본다.
 *
 * 🔴 출력에 회원 닉네임·이름·DB 주소를 찍지 않는다. 충돌은 종류·단계·거리만.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import type { Prisma, PrismaClient } from '@prisma/client'

import { validateNicknameFormat } from '../../src/lib/nickname'
import { verifyNamePolicy } from '../../src/lib/persona-nickname-candidates'
import { OPERATOR_ROSTER_QUIET_WINDOW, judgeKstQuietWindow } from '../../src/lib/kst-write-quiet-window'
import { checkNameCollision, type NameCollisionSets } from './persona-gate-name-collision.mjs'
import { loadNameCollisionSets } from './persona-name-collision-sets.mjs'
import { readEnvKeys } from './ops-signals.mjs'

// ─────────────────────────────────────────────────────────
// ① 타입 · 상수
// ─────────────────────────────────────────────────────────

export type RosterEntry = { code: string; nickname: string; note: string; status: 'active' | 'retired' }
export type RosterData = { kind: string; version: number; writers: RosterEntry[] }

export type WriterFact = {
  id: string
  code: string
  status: string
  userId: string
  nickname: string | null
  note: string | null
  accountCount: number
  hasPersona: boolean
}

export type IgnoredFact = {
  id: string
  code: string
  status: string
  userId: string
}

export type RosterFacts = {
  /** `^OP\d+$` code 인 행만. `readRosterFacts` 에서 미리 걸러진다 */
  writers: readonly WriterFact[]
  /** OP 가 아닌 행 — PV 등 */
  ignoredRows: readonly IgnoredFact[]
  ignoredPv: number
  ignoredOther: number
  collisionSets: NameCollisionSets
  /** N2 정규화된 비회원 댓글 이름 */
  guestNames: ReadonlySet<string>
  userIds: ReadonlySet<string>
  /** 🔴 진단용 — 판정에 쓰지 않는다 */
  totals: { users: number; accounts: number; personas: number }
}

export type Change =
  | { op: 'create'; code: string; nickname: string; note: string }
  | { op: 'note'; code: string }
  | { op: 'retire'; code: string }

export type Verdict =
  | { kind: 'same' }
  | { kind: 'applicable'; changes: readonly Change[]; planDigest: string }
  | { kind: 'stop'; problems: string[] }

export type AfterVerdict = {
  problems: string[]
  diagnostics: { usersDelta: number; accountsDelta: number; personasDelta: number }
}

export type ApplyResult =
  | { ok: true; created: number; noted: number; retired: number; before: RosterFacts }
  | { ok: false; reason: string; problems: readonly string[] }

export type Mode =
  | { kind: 'dry-run' }
  | { kind: 'dry-run-show-db-notes' }
  | { kind: 'apply-isolated'; approvedPlanDigest: string; reason: string }
  | { kind: 'apply-production'; target: string; approvedPlanDigest: string; reason: string }
  | { kind: 'refuse'; problems: string[] }

export type ProductionFacts = {
  isolatedFlag: string
  env: { ok: boolean; reason: string | null; databaseUrl: string; directUrl: string }
  fetched: boolean
  originMain: string | null
  head: string | null
  trackedChanges: string | null
  toolFilesCommitted: readonly { path: string; tracked: boolean }[]
}

/** 🔴 브랜드 금지 표현 (CLAUDE.md). note 검사에도 쓰인다 */
export const BRAND_FORBIDDEN = ['시니어', '어르신', '노인', '실버'] as const

/** note 나이대 패턴 — 40대 중반~60대 중반 */
const NOTE_AGE_RE = /^(40대 (중반|후반)|50대 (초반|중반|후반)|60대 (초반|중반))/

// ─────────────────────────────────────────────────────────
// ② 명단 로드 (순수 · 🔴 JSON type guard · any 금지)
// ─────────────────────────────────────────────────────────

function isRosterEntry(x: unknown): x is RosterEntry {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o['code'] === 'string' && typeof o['nickname'] === 'string'
    && typeof o['note'] === 'string' && (o['status'] === 'active' || o['status'] === 'retired')
}

function isRosterData(x: unknown): x is RosterData {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o['kind'] === 'string' && typeof o['version'] === 'number'
    && Array.isArray(o['writers']) && (o['writers'] as unknown[]).every(isRosterEntry)
}

/** 명단 JSON 을 읽는다. `import.meta.url` 기준 — lib 와 JSON 이 같은 디렉터리에 있다 */
export function loadRoster(): RosterData {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./operator-writer-roster.json', import.meta.url), 'utf-8'),
  )
  if (!isRosterData(raw)) throw new Error('operator-writer-roster.json 형식이 잘못됐다')
  return raw
}

// ─────────────────────────────────────────────────────────
// ③ 명단 검증 (순수)
// ─────────────────────────────────────────────────────────

/** 🔴 N2 정규화 — trim + NFC + 소문자 + 비 알파벳·숫자·한글 제거 */
export function normalizeName(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}

export function isOpCode(code: string): boolean {
  return /^OP\d+$/.test(code)
}

function isPvCode(code: string): boolean {
  return /^PV/.test(code)
}

/**
 * 명단 전체 결함. 비어 있으면 통과.
 * 🔴 `TO_FILL_FROM_DB` 가 있으면 FAIL — CI 가 의도적으로 막는다(§7-1 완료 전).
 */
export function validateRoster(r: RosterData): string[] {
  const problems: string[] = []
  if (r.kind !== 'operator-writer-roster') problems.push(`kind 가 "operator-writer-roster" 가 아니다: "${r.kind}"`)
  if (r.version !== 1) problems.push(`version 이 1 이 아니다: ${r.version}`)
  if (!Array.isArray(r.writers) || r.writers.length === 0) {
    problems.push('writers 가 없거나 배열이 아니다')
    return problems
  }

  const seenNick = new Map<string, string>()   // normalized → code
  const noteTriples = new Map<string, string[]>()  // "age|region|third" → codes

  r.writers.forEach((e, i) => {
    const expectedCode = `OP${String(i + 1).padStart(2, '0')}`
    if (!/^OP\d{2,}$/.test(e.code)) problems.push(`[${i}] code 형식이 잘못됐다: "${e.code}"`)
    else if (e.code !== expectedCode) problems.push(`[${i}] code=${e.code} — ${expectedCode} 여야 한다(연속·순서)`)

    // nickname 검사
    const nickNfc = e.nickname.trim().normalize('NFC')
    if (e.nickname !== nickNfc) problems.push(`${e.code}: 닉네임이 NFC 정규형이 아니다`)
    const fmtErr = validateNicknameFormat(e.nickname)
    if (fmtErr !== null) problems.push(`${e.code}: 닉네임 형식 — ${fmtErr}`)
    const n = normalizeName(e.nickname)
    for (const w of BRAND_FORBIDDEN) {
      if (n.includes(normalizeName(w))) problems.push(`${e.code}: 닉네임에 금지 표현 "${w}"`)
    }
    const prev = seenNick.get(n)
    if (prev !== undefined) problems.push(`${e.code}: 명단 안에서 ${prev} 와 이름이 겹친다(N2)`)
    seenNick.set(n, e.code)

    // note 검사
    if (!e.note || e.note.trim() === '') {
      problems.push(`${e.code}: note 가 비어 있다`)
    } else if (e.note.trim() === 'TO_FILL_FROM_DB') {
      problems.push(`${e.code}: note 에 TO_FILL_FROM_DB 가 남아 있다 — 운영 DB 에서 채워야 한다(§7-1)`)
    } else {
      if (!NOTE_AGE_RE.test(e.note)) {
        problems.push(`${e.code}: note 나이대가 "40대 중반~60대 중반" 으로 시작하지 않는다: "${e.note.slice(0, 20)}"`)
      }
      for (const w of BRAND_FORBIDDEN) {
        if (e.note.includes(w)) problems.push(`${e.code}: note 에 금지 표현 "${w}"`)
      }
      // 3중 일치: (나이, 지역, 셋째 토막)
      const tokens = e.note.split(' · ')
      const age = tokens[0] ?? ''
      const region = tokens[1] ?? ''
      const third = tokens[2] ?? ''
      if (age && region && third) {
        const key = `${age}|${region}|${third}`
        const existing = noteTriples.get(key) ?? []
        existing.push(e.code)
        noteTriples.set(key, existing)
      }
    }
  })

  for (const [key, codes] of noteTriples) {
    if (codes.length > 1) problems.push(`note 3중 일치 (${key}): ${codes.join(', ')}`)
  }

  return problems
}

// ─────────────────────────────────────────────────────────
// ④ 지문 (순수)
// ─────────────────────────────────────────────────────────

/**
 * 명단 지문 — canonical JSON 의 SHA-256.
 * 🔴 키 순서 고정 `code · nickname · note · status` · code 오름차순.
 */
export function rosterDigest(r: RosterData): string {
  const writers = [...r.writers]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((e) => ({ code: e.code, nickname: e.nickname, note: e.note, status: e.status }))
  return createHash('sha256')
    .update(JSON.stringify({ kind: 'operator-writer-roster', version: 1, writers }), 'utf8')
    .digest('hex')
}

/**
 * 계획 지문 — sha256(명단지문 + 정렬된 변경 목록 JSON).
 * 🔴 이 함수를 변이 시험이 직접 겨냥한다(변이: hash 를 상수로 → 순수 검사에서 FAIL).
 */
export function planDigestOf(rDigest: string, changes: readonly Change[]): string {
  const sorted = [...changes].sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    return a.op < b.op ? -1 : a.op > b.op ? 1 : 0
  })
  return createHash('sha256')
    .update(rDigest + JSON.stringify(sorted), 'utf8')
    .digest('hex')
}

// ─────────────────────────────────────────────────────────
// ⑤ 새 이름 판정 (순수 · P8)
// ─────────────────────────────────────────────────────────

export type NameCheckResult = { ok: boolean; problems: string[] }

/**
 * 새 이름 4축 판정(P8) — DB 에 아직 없는 행에만 적용(소급 안 함 · P9).
 * 🔴 Gate ⑥-B status==='pass' 만 허용. review 도 막는다.
 * 🔴 충돌 보고는 종류·단계·거리만 — 상대 이름 원문은 담지 않는다(P14).
 */
export function judgeNewName(
  nickname: string,
  sets: NameCollisionSets,
  guestNames?: ReadonlySet<string>,
): NameCheckResult {
  const problems: string[] = []
  const fmtErr = validateNicknameFormat(nickname)
  if (fmtErr !== null) problems.push(`닉네임 형식 — ${fmtErr}`)
  const n = normalizeName(nickname)
  for (const w of BRAND_FORBIDDEN) {
    if (n.includes(normalizeName(w))) problems.push(`금지 표현 "${w}"`)
  }
  const policy = verifyNamePolicy(nickname)
  if (!policy.ok) problems.push(...policy.problems)
  const collision = checkNameCollision(nickname, sets)
  if (collision.status !== 'pass') {
    const kind = collision.status  // 'review' | 'reject' | 'regenerate'
    const details = 'detail' in collision ? String(collision.detail) : kind
    problems.push(`Gate ⑥-B: ${kind} — ${details}`)
  }
  if (guestNames !== undefined && guestNames.has(n)) {
    problems.push('비회원 댓글 이름과 겹친다')
  }
  return { ok: problems.length === 0, problems }
}

// ─────────────────────────────────────────────────────────
// ⑥ DB 사실 (read-only · findMany 만)
// ─────────────────────────────────────────────────────────

type Reader = PrismaClient | Prisma.TransactionClient

export async function readRosterFacts(db: Reader): Promise<RosterFacts> {
  const [rows, guests, users, accounts, personas] = await Promise.all([
    db.operatorWriter.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true, code: true, status: true, userId: true, note: true,
        user: {
          select: {
            nickname: true,
            _count: { select: { accounts: true } },
            persona: { select: { id: true } },
          },
        },
      },
    }),
    db.comment.findMany({
      where: { guestNickname: { not: null } },
      distinct: ['guestNickname'],
      select: { guestNickname: true },
    }),
    db.user.findMany({ select: { id: true } }),
    db.account.count(),
    db.persona.count(),
  ])
  const [collisionSets] = await Promise.all([loadNameCollisionSets(db)])

  const writers: WriterFact[] = []
  const ignoredRows: IgnoredFact[] = []
  let ignoredPv = 0
  let ignoredOther = 0

  for (const r of rows) {
    if (isOpCode(r.code)) {
      writers.push({
        id: r.id,
        code: r.code,
        status: r.status,
        userId: r.userId,
        nickname: r.user.nickname,
        note: r.note,
        accountCount: r.user._count.accounts,
        hasPersona: r.user.persona !== null,
      })
    } else {
      ignoredRows.push({ id: r.id, code: r.code, status: r.status, userId: r.userId })
      if (isPvCode(r.code)) ignoredPv += 1
      else ignoredOther += 1
    }
  }

  const guestNames = new Set<string>()
  for (const g of guests) if (g.guestNickname !== null) guestNames.add(normalizeName(g.guestNickname))

  return {
    writers,
    ignoredRows,
    ignoredPv,
    ignoredOther,
    collisionSets,
    guestNames,
    userIds: new Set(users.map((u) => u.id)),
    totals: { users: users.length, accounts, personas },
  }
}

// ─────────────────────────────────────────────────────────
// ⑦ 판정 (순수 · 🔴 행 단위)
// ─────────────────────────────────────────────────────────

/**
 * 명단과 DB 를 행 단위로 대조해 같음 / 적용 가능 / 멈춤 중 하나를 반환한다.
 *
 * 🔴 `overrideSets` — 순수 시험용. DB collisionSets 대신 직접 집합을 주입한다.
 *    변이 시험의 P5 루프: `if (!isOpCode(w.code)) continue` 를 겨냥한다.
 *    수동으로 PV code 를 `facts.writers` 에 넣어도 `isOpCode` 가 무시한다.
 */
export function judgeRoster(
  roster: RosterData,
  facts: RosterFacts,
  overrideSets?: NameCollisionSets,
): Verdict {
  // 명단 자체 결함
  const rosterProblems = validateRoster(roster)
  if (rosterProblems.length > 0) return { kind: 'stop', problems: rosterProblems }

  const rosterCodes = new Set(roster.writers.map((e) => e.code))
  const dbByCode = new Map(facts.writers.map((w) => [w.code, w]))
  const collisionSets = overrideSets ?? facts.collisionSets
  const problems: string[] = []
  const changes: Change[] = []

  // P5: DB 에만 있는 OP 행 → 멈춤
  for (const w of facts.writers) {
    if (!isOpCode(w.code)) continue  // P6 · 변이 시험 겨냥
    if (!rosterCodes.has(w.code)) {
      problems.push(`DB 에만 있는 code ${w.code} — 명단에서 삭제됐거나 도구가 모른다(P5)`)
    }
  }
  if (problems.length > 0) return { kind: 'stop', problems }

  // 명단 각 행 대조
  for (const entry of roster.writers) {
    const dbRow = dbByCode.get(entry.code)

    if (dbRow === undefined) {
      // DB 에 없음
      if (entry.status === 'retired') {
        problems.push(`${entry.code}: 명단이 retired 인데 DB 에 없다 — code 를 쓰지 말 것(P2)`)
        continue
      }
      // create (active) — P8 이름 판정
      const nameCheck = judgeNewName(entry.nickname, collisionSets, facts.guestNames)
      if (!nameCheck.ok) {
        problems.push(`${entry.code}: 새 이름 판정 실패 — ${nameCheck.problems.join(' · ')}`)
      } else {
        changes.push({ op: 'create', code: entry.code, nickname: entry.nickname, note: entry.note })
      }
      continue
    }

    // DB 에 있음
    // P3: 닉네임 불변 — null 도 불일치
    if (dbRow.nickname !== entry.nickname) {
      problems.push(
        `${entry.code}: 공개 닉네임 불변(P3) — DB "${dbRow.nickname ?? 'null'}" ≠ 명단 "${entry.nickname}". `
          + '바꾸려면 retired + 새 code',
      )
      continue
    }
    // P7: Account > 0 또는 Persona 연결 → 멈춤
    if (dbRow.accountCount > 0) {
      problems.push(`${entry.code}: Account ${dbRow.accountCount}개 — 실회원·자동 레인 혼입(P7)`)
      continue
    }
    if (dbRow.hasPersona) {
      problems.push(`${entry.code}: Persona 연결 — 실회원·자동 레인 혼입(P7)`)
      continue
    }
    // P4: DB retired → 명단 active 되살리기 금지
    if (dbRow.status === 'retired' && entry.status === 'active') {
      problems.push(`${entry.code}: DB retired → active 되살리기는 멈춤(P4) — 한 방향만`)
      continue
    }

    // 변경 판정
    const noteChanged = (dbRow.note ?? '') !== entry.note
    const retiring = dbRow.status === 'active' && entry.status === 'retired'

    if (retiring) {
      changes.push({ op: 'retire', code: entry.code })
    } else if (noteChanged) {
      changes.push({ op: 'note', code: entry.code })
    }
    // 같음 → 아무것도 추가 안 함
  }

  if (problems.length > 0) return { kind: 'stop', problems }
  if (changes.length === 0) return { kind: 'same' }

  const planDigest = planDigestOf(rosterDigest(roster), changes)
  return { kind: 'applicable', changes, planDigest }
}

// ─────────────────────────────────────────────────────────
// ⑧ 적용 뒤 검증 (순수 · 🔴 행 단위가 정본)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 판정의 정본은 이 도구가 만든·바꾼 행과 건드리면 안 되는 행뿐이다.
 *    전체 User·Account·Persona 수는 판정에 쓰지 않는다(동시 가입이 움직임).
 */
export function verifyAfter(before: RosterFacts, after: RosterFacts, roster: RosterData): AfterVerdict {
  const problems: string[] = []
  const rosterByCode = new Map(roster.writers.map((e) => [e.code, e]))
  const beforeByCode = new Map(before.writers.map((w) => [w.code, w]))
  const afterByCode = new Map(after.writers.map((w) => [w.code, w]))

  // 명단 모든 code 가 DB 에 있어야 한다
  for (const entry of roster.writers) {
    const afterRow = afterByCode.get(entry.code)
    if (afterRow === undefined) {
      problems.push(`${entry.code}: 적용 뒤에도 DB 에 없다`)
      continue
    }
    // 닉네임·note·status 가 명단과 같아야 한다
    if (afterRow.nickname !== entry.nickname) {
      problems.push(`${entry.code}: 닉네임이 명단과 다르다 — 닉네임 변경 쿼리가 돌았을 가능성`)
    }
    if ((afterRow.note ?? '') !== entry.note) problems.push(`${entry.code}: note 가 명단과 다르다`)
    if (afterRow.status !== entry.status) problems.push(`${entry.code}: status 가 명단(${entry.status})과 다르다`)
  }

  // DB 에만 있는 OP 행이 없어야 한다
  for (const w of after.writers) {
    if (!isOpCode(w.code)) continue
    if (!rosterByCode.has(w.code)) problems.push(`DB 에만 있는 code ${w.code}`)
  }

  // 새로 만든 행 — 새 User · 서로 다른 User · Account 0 · Persona 0
  const newUserIds = new Set<string>()
  for (const entry of roster.writers) {
    const beforeRow = beforeByCode.get(entry.code)
    const afterRow = afterByCode.get(entry.code)
    if (beforeRow !== undefined || afterRow === undefined) continue  // 기존 행은 아래에서
    // 신규 행
    if (before.userIds.has(afterRow.userId)) {
      problems.push(`${entry.code}: 적용 전부터 있던 User 다`)
    }
    if (newUserIds.has(afterRow.userId)) {
      problems.push(`${entry.code}: 다른 새 code 와 같은 User 를 쓴다`)
    }
    newUserIds.add(afterRow.userId)
    if (afterRow.accountCount !== 0) problems.push(`${entry.code}: Account ${afterRow.accountCount}`)
    if (afterRow.hasPersona) problems.push(`${entry.code}: Persona 연결`)
  }

  // 기존 행 — User id 불변
  for (const entry of roster.writers) {
    const beforeRow = beforeByCode.get(entry.code)
    const afterRow = afterByCode.get(entry.code)
    if (beforeRow === undefined || afterRow === undefined) continue
    if (afterRow.userId !== beforeRow.userId) {
      problems.push(`${entry.code}: User 가 바뀌었다`)
    }
  }

  // 무시 행(PV 등) — id·code·status·userId 불변
  const beforeIgnored = new Map(before.ignoredRows.map((r) => [r.code, r]))
  const afterIgnored = new Map(after.ignoredRows.map((r) => [r.code, r]))
  for (const [code, bRow] of beforeIgnored) {
    const aRow = afterIgnored.get(code)
    if (aRow === undefined) {
      problems.push(`무시 행 ${code} 가 적용 뒤에 사라졌다`)
    } else if (aRow.id !== bRow.id || aRow.userId !== bRow.userId || aRow.status !== bRow.status) {
      problems.push(`무시 행 ${code} 가 바뀌었다`)
    }
  }

  return {
    problems,
    diagnostics: {
      usersDelta: after.totals.users - before.totals.users,
      accountsDelta: after.totals.accounts - before.totals.accounts,
      personasDelta: after.totals.personas - before.totals.personas,
    },
  }
}

// ─────────────────────────────────────────────────────────
// ⑨ 적용 — 🔴 단일 $transaction · 안에서 다시 읽고 다시 판정
// ─────────────────────────────────────────────────────────

class Abort extends Error {
  constructor(message: string, readonly problems: readonly string[]) { super(message) }
}

export async function applyRoster(
  prisma: PrismaClient,
  opts: { approvedPlanDigest: string; roster: RosterData; reason: string },
): Promise<ApplyResult> {
  try {
    const r = await prisma.$transaction(async (tx) => {
      const before = await readRosterFacts(tx)
      const verdict = judgeRoster(opts.roster, before)
      if (verdict.kind === 'stop') throw new Abort('판정이 멈춤이다', verdict.problems)
      if (verdict.kind === 'same') {
        return { created: 0, noted: 0, retired: 0, before, noop: true }
      }
      // applicable
      if (verdict.planDigest !== opts.approvedPlanDigest) {
        throw new Abort('계획 지문이 승인된 값과 다르다 — 새 미리보기·승인이 필요하다', [
          `승인 ${opts.approvedPlanDigest.slice(0, 12)}… · 지금 ${verdict.planDigest.slice(0, 12)}…`,
        ])
      }

      let created = 0, noted = 0, retired = 0
      const rosterByCode = new Map(opts.roster.writers.map((e) => [e.code, e]))

      for (const change of verdict.changes) {
        const entry = rosterByCode.get(change.code)
        if (entry === undefined) throw new Abort(`명단에서 ${change.code} 를 찾지 못했다`, [])
        if (change.op === 'create') {
          // 🔴 nested create 하나 — User 와 OperatorWriter 가 같이 생기거나 같이 없다
          await tx.user.create({
            data: {
              nickname: change.nickname,
              operatorWriter: { create: { code: change.code, note: change.note, status: 'active' } },
            },
            select: { id: true },
          })
          created += 1
        } else if (change.op === 'note') {
          await tx.operatorWriter.update({
            where: { code: change.code },
            data: { note: entry.note },
          })
          noted += 1
        } else if (change.op === 'retire') {
          await tx.operatorWriter.update({
            where: { code: change.code },
            data: { status: 'retired' },
          })
          retired += 1
        }
      }

      const after = await readRosterFacts(tx)
      const v = verifyAfter(before, after, opts.roster)
      if (v.problems.length > 0) throw new Abort('적용 뒤 검증 실패 — rollback', v.problems)
      return { created, noted, retired, before, noop: false }
    }, { timeout: 60_000, maxWait: 10_000 })

    return { ok: true, created: r.created, noted: r.noted, retired: r.retired, before: r.before }
  } catch (e) {
    if (e instanceof Abort) return { ok: false, reason: e.message, problems: e.problems }
    return {
      ok: false,
      reason: `트랜잭션 오류 — rollback (${(e as Error).name})`,
      problems: [String((e as Error).message).split('\n')[0] ?? ''],
    }
  }
}

// ─────────────────────────────────────────────────────────
// ⑩ 실행 모드 (순수 · 🔴 DB 에 붙기 전에 정한다)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 옛 `--digest` · `--expect=N:N` 은 모르는 인자로 거절한다(시험으로 잠근다).
 *    새 `--expect=<64hex>` 가 계획 지문이다.
 */
export function decideMode(argv: readonly string[], shellDbUrl: string): Mode {
  const has = (k: string): boolean => argv.includes(k)
  const val = (k: string): string | null => {
    const a = argv.find((x) => x.startsWith(`${k}=`))
    return a === undefined ? null : a.slice(k.length + 1)
  }
  const flags = new Set(['--apply', '--production', '--json', '--show-db-notes'])
  const valued = ['--expect', '--reason', '--target']
  const unknownArgs = argv.filter(
    (a) => !flags.has(a) && !valued.some((k) => a.startsWith(`${k}=`)),
  )
  if (unknownArgs.length > 0) return { kind: 'refuse', problems: [`모르는 인자: ${unknownArgs.join(' ')}`] }

  if (!has('--apply')) {
    if (has('--production') || valued.some((k) => val(k) !== null)) {
      return { kind: 'refuse', problems: ['--apply 없이 적용 인자를 받았다 — 미리보기는 인자 없이 돈다'] }
    }
    if (has('--show-db-notes')) return { kind: 'dry-run-show-db-notes' }
    return { kind: 'dry-run' }
  }

  if (has('--show-db-notes')) {
    return { kind: 'refuse', problems: ['--show-db-notes 는 --apply 와 함께 쓸 수 없다'] }
  }

  const problems: string[] = []
  const expectRaw = val('--expect') ?? ''
  if (!/^[0-9a-f]{64}$/.test(expectRaw)) {
    problems.push('--expect=<미리보기의 계획 지문 64자리 hex> 가 필요하다')
  }
  const reason = (val('--reason') ?? '').trim()
  if (reason === '') problems.push('--reason=<비어 있지 않은 사유> 가 필요하다')
  const target = val('--target')

  if (has('--production')) {
    if (target === null || !/^[0-9a-f]{40}$/.test(target)) {
      problems.push('--target=<40자리 commit SHA> 가 필요하다')
    }
  } else {
    if (target !== null) problems.push('--target 은 --production 과 함께만 쓴다')
    if (!isIsolatedUrl(shellDbUrl)) {
      problems.push('운영 DB 적용은 --production 이 필요하다 (아니면 격리 DB 주소만 연다)')
    }
  }

  if (problems.length > 0) return { kind: 'refuse', problems }

  return has('--production')
    ? { kind: 'apply-production', target: target!, approvedPlanDigest: expectRaw, reason }
    : { kind: 'apply-isolated', approvedPlanDigest: expectRaw, reason }
}

/**
 * 운영 적용 시간 가드(P11) — 06:00~09:00 KST 에는 거절.
 * 미리보기·격리 적용은 호출하지 않는다(시간에 무관).
 */
export function decideProductionTime(now: Date): { ok: true } | { ok: false; reason: string } {
  return judgeKstQuietWindow(now, OPERATOR_ROSTER_QUIET_WINDOW)
}

// ─────────────────────────────────────────────────────────
// ⑪ 운영 가드 (사실 수집은 불순 · 판정은 순수)
// ─────────────────────────────────────────────────────────

export function isIsolatedUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test(\?|$)/.test(url)
}

export function isLocalUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/([^@/]*@)?(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?\//.test(url)
}

export function judgeProduction(f: ProductionFacts, target: string): string[] {
  const problems: string[] = []
  if (f.isolatedFlag.trim() !== '') problems.push('SORAN_ISOLATED_DB 가 설정돼 있다 — 운영 적용을 열지 않는다')
  if (!f.env.ok) problems.push(`canonical env 를 읽지 못했다 — ${f.env.reason ?? '이유 모름'}`)
  if (f.env.databaseUrl === '') problems.push('canonical env 에 DATABASE_URL 이 없다')
  if (f.env.directUrl === '') problems.push('canonical env 에 DIRECT_URL 이 없다')
  for (const [k, u] of [['DATABASE_URL', f.env.databaseUrl], ['DIRECT_URL', f.env.directUrl]] as const) {
    if (u !== '' && (isIsolatedUrl(u) || isLocalUrl(u))) problems.push(`canonical ${k} 가 로컬·격리 DB 모양이다`)
  }
  if (!f.fetched || f.originMain === null) problems.push('origin/main 을 fetch 하지 못했다')
  if (f.head === null) problems.push('HEAD 를 읽지 못했다')
  if (f.originMain !== null && f.head !== null && f.originMain !== f.head) {
    problems.push(`HEAD ${f.head.slice(0, 12)} ≠ origin/main ${f.originMain.slice(0, 12)}`)
  }
  if (f.head !== null && f.head !== target) {
    problems.push(`HEAD ${f.head.slice(0, 12)} ≠ --target ${target.slice(0, 12)}`)
  }
  if (f.trackedChanges === null) problems.push('작업 트리 상태를 읽지 못했다')
  else if (f.trackedChanges.trim() !== '') {
    problems.push(`tracked 변경이 있다 (${f.trackedChanges.trim().split('\n').length}건)`)
  }
  if (f.toolFilesCommitted.length === 0) problems.push('도구 파일 확인 결과가 비어 있다')
  for (const t of f.toolFilesCommitted) {
    if (!t.tracked) problems.push(`${t.path} 가 HEAD 에 커밋돼 있지 않다 — 미커밋 코드로 운영을 열지 않는다`)
  }
  return problems
}

/** 🔴 이 도구를 이루는 파일 — 운영 apply 는 이 파일들이 HEAD 에 커밋돼 있어야 열린다 */
export const TOOL_FILES: readonly string[] = [
  'scripts/operator-writer-roster.mts',
  'scripts/lib/operator-writer-roster.mts',
  'scripts/lib/operator-writer-roster.json',
]

function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function collectProductionFacts(
  scriptDir: string,
  env: NodeJS.ProcessEnv,
  envFile?: string,
): ProductionFacts {
  const repoRoot = git(scriptDir, ['rev-parse', '--show-toplevel'])
  const keys = ['DATABASE_URL', 'DIRECT_URL'] as const
  const r = envFile === undefined ? readEnvKeys(keys) : readEnvKeys(keys, envFile)
  const fetched = repoRoot !== null && git(repoRoot, ['fetch', '-q', 'origin', 'main']) !== null
  const toolFilesCommitted = TOOL_FILES.map((path) => {
    if (repoRoot === null) return { path, tracked: false }
    const inHead = git(repoRoot, ['cat-file', '-e', `HEAD:${path}`]) !== null
    const dirty = git(repoRoot, ['status', '--porcelain', '--', path])
    return { path, tracked: inHead && dirty === '' }
  })
  return {
    isolatedFlag: env.SORAN_ISOLATED_DB ?? '',
    env: { ok: r.ok, reason: r.reason, databaseUrl: r.values.DATABASE_URL ?? '', directUrl: r.values.DIRECT_URL ?? '' },
    fetched,
    originMain: fetched && repoRoot !== null ? git(repoRoot, ['rev-parse', 'refs/remotes/origin/main']) : null,
    head: repoRoot === null ? null : git(repoRoot, ['rev-parse', 'HEAD']),
    trackedChanges: repoRoot === null ? null : git(repoRoot, ['status', '--porcelain', '--untracked-files=no']),
    toolFilesCommitted,
  }
}
