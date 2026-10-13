/**
 * 운영용 작성자 풀 확장 OP01~OP10 → OP01~OP30 — 판정 · 읽기 · 적용 (2026-10-13)
 *
 * 🔴 **D100 자동 Persona(P01~) 확장이 아니다.** 이 파일은 `/admin/compose` 에서 창업자가
 *    직접 고르는 이름(`OperatorWriter`)만 다룬다. Persona · 공급 · 발행 · 댓글 · stage ·
 *    runtime 은 import 하지 않고 한 줄도 쓰지 않는다. 그래서 운영 가드에 runtime pin ·
 *    manifest · launchd 조건을 두지 않는다 — 이 도구는 D100 runtime 에 쓰지 않는다.
 *
 * 🔴 **만드는 것은 사람마다 두 행뿐이다** — `User`(닉네임만) + `OperatorWriter`(code·note).
 *    `Account` 를 붙이지 않는다 — 붙는 순간 실회원으로 판정돼 쓰기가 막히고 회원 수에 섞인다.
 *    `Persona` 를 연결하지 않는다 — 한 사람이 두 레인에서 말하면 자동 여력 계산이 어긋난다.
 *    (근거: `src/lib/operator-writer.ts` §① · `prisma/migrations/0027_operator_composer/APPLY.md` §5)
 *
 * 🔴 **전부 아니면 0.** 한 이름이라도 막히면 아무것도 만들지 않는다. 부분 적재 상태를
 *    발견해도 메우지 않고 멈춘다 — 그 상태는 이 도구가 만든 것이 아니므로 사람이 본다.
 *
 * 🔴 출력에 회원 닉네임·이름·DB 주소를 찍지 않는다. 충돌은 **어느 종류와 겹쳤는지**만 말한다.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import type { Prisma, PrismaClient } from '@prisma/client'

import { validateNicknameFormat } from '../../src/lib/nickname'
import { readEnvKeys } from './ops-signals.mjs'

// ─────────────────────────────────────────────────────────
// ① 확장 명단 — 🔴 한 글자라도 바뀌면 digest 가 바뀌고 새 승인이 필요하다
// ─────────────────────────────────────────────────────────

export type WriterSpec = { code: string; nickname: string; note: string }

export function opCode(n: number): string {
  return `OP${String(n).padStart(2, '0')}`
}

/** 이미 운영 중인 10명. 🔴 이 도구는 이 행들을 읽기만 한다 */
export const BASELINE_CODES: readonly string[] = Array.from({ length: 10 }, (_, i) => opCode(i + 1))

/**
 * 새 20명. note 는 운영자가 자기에게 남기는 메모이고 고객 화면에 나가지 않는다.
 *
 * 🔴 생활사·지역·가족·일·말투가 한쪽으로 쏠리지 않게 짰다. 지역은 note 에만 두고
 *    닉네임에는 넣지 않는다 — 이름만으로 사는 곳이 좁혀지지 않게.
 */
export const EXPANSION: readonly WriterSpec[] = [
  { code: 'OP11', nickname: '빈둥지신입생', note: '50대 초반 · 경기 신도시 · 막내 대학 기숙사 보냄 · 재취업 고민 · 다정한 수다' },
  { code: 'OP12', nickname: '새벽수영반장', note: '50대 중반 · 부산 · 방과후 강사 · 운동 예찬 · 씩씩하고 빠른 말투' },
  { code: 'OP13', nickname: '무릎이일기예보', note: '60대 초반 · 대구 · 공무원 퇴직 · 무릎·관절 · 담담한 농담' },
  { code: 'OP14', nickname: '손주등원담당', note: '60대 초반 · 서울 · 맞벌이 딸네 손주 돌봄 · 황혼육아 고충 · 푸근' },
  { code: 'OP15', nickname: '김장총사령관', note: '50대 후반 · 광주 · 큰며느리 · 명절·집안 행사 총괄 · 호탕' },
  { code: 'OP16', nickname: '사표는서랍속', note: '40대 후반 · 서울 · 회사 차장 · 직장 스트레스 · 시크한 단문' },
  { code: 'OP17', nickname: '텃밭상추부자', note: '50대 후반 · 충남 귀촌 · 남편과 텃밭 · 느긋하고 나눔 좋아함' },
  { code: 'OP18', nickname: '혼밥고수', note: '50대 중반 · 서울 · 비혼 1인 가구 · 프리랜서 번역 · 담백하고 짧게' },
  { code: 'OP19', nickname: '트로트직관러', note: '60대 초반 · 인천 · 동네 미용실 운영 · 공연 다니기 · 흥 많은 말투' },
  { code: 'OP20', nickname: '반찬가게사장', note: '50대 초반 · 창원 · 반찬가게 자영업 · 손님 이야기 · 바쁘고 시원시원' },
  { code: 'OP21', nickname: '잠못드는올빼미', note: '40대 후반 · 대전 · 교대 근무 직장인 · 불면·열감 · 조용한 존댓말' },
  { code: 'OP22', nickname: '코바늘중독', note: '50대 중반 · 강원 · 뜨개 공방 · 손으로 하는 취미 · 조곤조곤' },
  { code: 'OP23', nickname: '시댁가는길치', note: '40대 후반 · 경기 · 둘째 며느리 · 명절·시댁 투덜 · 유쾌한 반말체' },
  { code: 'OP24', nickname: '말티즈집사', note: '50대 초반 · 울산 · 자녀 독립 뒤 반려견 · 경리 사무직 · 다정' },
  { code: 'OP25', nickname: '노후자금계산기', note: '60대 초반 · 서울 · 연금·노후 준비 · 숫자 꼼꼼 · 질문 많은 말투' },
  { code: 'OP26', nickname: '드라마정주행', note: '50대 후반 · 전주 · 전업주부 · 드라마·연예 수다 · 감성적' },
  { code: 'OP27', nickname: '등산화두켤레', note: '50대 중반 · 수원 · 학원 수학강사 · 주말 산행 · 활발' },
  { code: 'OP28', nickname: '늦둥이초딩맘', note: '40대 중반 · 경기 · 늦둥이 초등생 · 워킹맘 · 바쁘고 솔직' },
  { code: 'OP29', nickname: '두번째스무살', note: '50대 초반 · 제주 · 이혼 뒤 혼자 서기 · 새 일 배우는 중 · 씩씩' },
  { code: 'OP30', nickname: '약봉투수집가', note: '60대 중반 · 부산 · 가족 돌봄 경험이 많음 · 병원 다니는 일상 · 자조적 유머' },
]

/** 적용 뒤 기대하는 active 수 — 기준 10 + 새 20 */
export const TARGET_ACTIVE = BASELINE_CODES.length + EXPANSION.length

/** 적용 뒤 존재해야 하는 code 전체 — OP01~OP30 */
export const TARGET_CODES: readonly string[] = Array.from({ length: TARGET_ACTIVE }, (_, i) => opCode(i + 1))

/**
 * 승인 지문 — canonical JSON 의 SHA-256 64자리.
 *
 * 🔴 canonical: 판 이름 + code 순 정렬 + 키 순서 고정(code · nickname · note).
 *    객체 키 순서나 배열 순서가 달라도 같은 명단이면 같은 값이고, 이름·note 가
 *    한 글자라도 바뀌면 다른 값이다. 비밀이 아니다 — 위조 방지가 아니라 "본 것을 적용한다" 의 증거다.
 */
export function canonicalSpecJson(specs: readonly WriterSpec[]): string {
  const writers = [...specs]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((s) => ({ code: s.code, nickname: s.nickname, note: s.note }))
  return JSON.stringify({ kind: 'operator-writer-expand', version: 1, writers })
}

export function specDigest(specs: readonly WriterSpec[]): string {
  return createHash('sha256').update(canonicalSpecJson(specs), 'utf8').digest('hex')
}

// ─────────────────────────────────────────────────────────
// ② 이름 판정 — 순수
// ─────────────────────────────────────────────────────────

/**
 * N2 정규화 — trim + NFC + 소문자 + 공백·기호 제거.
 * 🔴 Gate ⑥-B 와 같은 기준이다(`prisma/schema.prisma` 의 N2 주석). 원본 일치보다 넓게 본다.
 */
export function normalizeName(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}

/** 🔴 브랜드 금지 표현 (CLAUDE.md). `nickname.ts` 의 BANNED 는 사칭만 막으므로 여기서 더 본다 */
export const BRAND_FORBIDDEN = ['시니어', '어르신', '노인', '실버'] as const
/** 🔴 출처 커뮤니티 호칭 — 그쪽 회원으로 오인되지 않게 */
export const SOURCE_FORBIDDEN = ['82쿡', '레몬테라스', '우아한갱년기', '우나어'] as const

/** 명단 자체의 결함. 비어 있으면 통과 */
export function judgeSpecs(specs: readonly WriterSpec[]): string[] {
  const problems: string[] = []
  const expectedCodes = Array.from({ length: specs.length }, (_, i) => opCode(BASELINE_CODES.length + i + 1))
  specs.forEach((s, i) => {
    if (s.code !== expectedCodes[i]) problems.push(`${i + 1}번째 code=${s.code} — ${expectedCodes[i]} 여야 한다(연속·순서)`)
    const fmt = validateNicknameFormat(s.nickname)
    if (fmt !== null) problems.push(`${s.code}: 닉네임 형식 — ${fmt}`)
    if (s.nickname !== s.nickname.trim().normalize('NFC')) problems.push(`${s.code}: 닉네임이 정규형이 아니다`)
    const n = normalizeName(s.nickname)
    for (const w of [...BRAND_FORBIDDEN, ...SOURCE_FORBIDDEN]) {
      if (n.includes(normalizeName(w))) problems.push(`${s.code}: 금지 표현 "${w}"`)
    }
    if (s.note.trim() === '') problems.push(`${s.code}: note 가 비어 있다`)
    for (const w of BRAND_FORBIDDEN) if (s.note.includes(w)) problems.push(`${s.code}: note 에 금지 표현 "${w}"`)
  })
  const seen = new Map<string, string>()
  for (const s of specs) {
    const n = normalizeName(s.nickname)
    const prev = seen.get(n)
    if (prev !== undefined) problems.push(`${s.code}: 명단 안에서 ${prev} 와 이름이 겹친다`)
    seen.set(n, s.code)
  }
  return problems
}

// ─────────────────────────────────────────────────────────
// ③ DB 사실 → 계획 — 순수
// ─────────────────────────────────────────────────────────

export type WriterFact = {
  code: string
  status: string
  userId: string
  nickname: string | null
  note: string | null
  accountCount: number
  hasPersona: boolean
}

/** 🔴 이름이 겹친 상대의 **종류**만. 상대의 이름은 담지 않는다 */
export type NameOwnerKind = 'operator' | 'persona' | 'member-or-other' | 'guest-comment'

export type DbFacts = {
  writers: readonly WriterFact[]
  /** N2 정규화된 이름 → 그 이름을 쓰는 User 의 id 와 종류(User.nickname · User.name 둘 다) */
  userNames: ReadonlyMap<string, readonly { userId: string; kind: Exclude<NameOwnerKind, 'guest-comment'> }[]>
  /** N2 정규화된 비회원 댓글 이름 */
  guestNames: ReadonlySet<string>
  /** 읽은 시점의 User id 전체 — "새로 만든 User 인가" 를 행 단위로 증명하는 데 쓴다 */
  userIds: ReadonlySet<string>
  /** 🔴 진단용. 무관한 동시 가입이 바꾸므로 판정에 쓰지 않는다 */
  totals: { users: number; accounts: number; personas: number }
}

export type Expected = { before: number; after: number }

export type Plan =
  | { action: 'create'; activeBefore: number; activeAfter: number; creates: readonly WriterSpec[]; digest: string }
  | { action: 'noop'; activeBefore: number; activeAfter: number; digest: string }
  | { action: 'abort'; activeBefore: number; activeAfter: number; problems: readonly string[]; digest: string }

/**
 * 지금 DB 에 이 명단을 넣으면 무엇이 일어나는가.
 *
 * 🔴 판정은 세 갈래뿐이다 — 새 20명이 **하나도 없으면** create · **전부 정확히 같으면** noop ·
 *    그 밖은 전부 abort. "있는 것은 두고 없는 것만 만든다" 는 경로를 두지 않는다.
 */
export function planExpansion(facts: DbFacts, specs: readonly WriterSpec[] = EXPANSION): Plan {
  const digest = specDigest(specs)
  const problems: string[] = [...judgeSpecs(specs)]
  const byCode = new Map(facts.writers.map((w) => [w.code, w]))
  const activeBefore = facts.writers.filter((w) => w.status === 'active').length

  // 기준 10명 — 그대로 있어야 한다
  for (const code of BASELINE_CODES) {
    const w = byCode.get(code)
    if (w === undefined) { problems.push(`기준 ${code} 가 없다`); continue }
    if (w.status !== 'active') problems.push(`기준 ${code} status=${w.status}`)
    if (w.accountCount !== 0) problems.push(`기준 ${code} 에 Account ${w.accountCount}개`)
    if (w.hasPersona) problems.push(`기준 ${code} 에 Persona 가 붙어 있다`)
  }
  // 이 도구가 모르는 code — 손대지 않고 멈춘다
  const known = new Set(TARGET_CODES)
  const unknown = facts.writers.filter((w) => !known.has(w.code)).map((w) => w.code)
  if (unknown.length > 0) problems.push(`이 도구가 모르는 OperatorWriter code ${unknown.length}개 [${unknown.join(',')}]`)

  const present = specs.filter((s) => byCode.has(s.code))
  if (present.length > 0 && present.length < specs.length) {
    problems.push(`부분 상태 — 새 code ${specs.length}개 중 ${present.length}개만 있다. 메우지 않는다`)
  }

  if (present.length === specs.length && specs.length > 0) {
    // 재실행 — 정확히 같은 행만 허용
    for (const s of specs) {
      const w = byCode.get(s.code)!
      const diffs: string[] = []
      if (w.nickname !== s.nickname) diffs.push('nickname')
      if ((w.note ?? '') !== s.note) diffs.push('note')
      if (w.status !== 'active') diffs.push(`status=${w.status}`)
      if (w.accountCount !== 0) diffs.push(`Account ${w.accountCount}`)
      if (w.hasPersona) diffs.push('Persona 연결')
      if (diffs.length > 0) problems.push(`${s.code} 가 이미 있는데 다르다: ${diffs.join(' · ')}`)
    }
    return problems.length > 0
      ? { action: 'abort', activeBefore, activeAfter: activeBefore, problems, digest }
      : { action: 'noop', activeBefore, activeAfter: activeBefore, digest }
  }

  // 신규 — 이름이 누구와도 겹치지 않아야 한다
  for (const s of specs) {
    const n = normalizeName(s.nickname)
    const owners = facts.userNames.get(n) ?? []
    const kinds = [...new Set(owners.map((o) => o.kind))]
    if (kinds.length > 0) problems.push(`${s.code}: 이름이 이미 있다 (${kinds.join('·')})`)
    if (facts.guestNames.has(n)) problems.push(`${s.code}: 비회원 댓글 이름과 겹친다 (guest-comment)`)
  }
  return problems.length > 0
    ? { action: 'abort', activeBefore, activeAfter: activeBefore, problems, digest }
    : { action: 'create', activeBefore, activeAfter: activeBefore + specs.length, creates: specs, digest }
}

// ─────────────────────────────────────────────────────────
// ④ DB 읽기 — 🔴 findMany · count 만
// ─────────────────────────────────────────────────────────

type Reader = Pick<PrismaClient, 'operatorWriter' | 'user' | 'comment' | 'account' | 'persona'>
  | Prisma.TransactionClient

export async function readFacts(db: Reader): Promise<DbFacts> {
  const [writers, users, guests, accounts, personas] = await Promise.all([
    db.operatorWriter.findMany({
      orderBy: { code: 'asc' },
      select: {
        code: true, status: true, userId: true, note: true,
        user: { select: { nickname: true, _count: { select: { accounts: true } }, persona: { select: { id: true } } } },
      },
    }),
    db.user.findMany({
      select: { id: true, nickname: true, name: true, persona: { select: { id: true } }, operatorWriter: { select: { id: true } } },
    }),
    db.comment.findMany({
      where: { guestNickname: { not: null } },
      distinct: ['guestNickname'],
      select: { guestNickname: true },
    }),
    db.account.count(),
    db.persona.count(),
  ])
  const userNames = new Map<string, { userId: string; kind: Exclude<NameOwnerKind, 'guest-comment'> }[]>()
  for (const u of users) {
    const kind = u.operatorWriter !== null ? 'operator' : u.persona !== null ? 'persona' : 'member-or-other'
    for (const raw of new Set([u.nickname, u.name])) {
      if (raw === null || raw === undefined) continue
      const n = normalizeName(raw)
      if (n === '') continue
      const list = userNames.get(n) ?? []
      list.push({ userId: u.id, kind })
      userNames.set(n, list)
    }
  }
  const guestNames = new Set<string>()
  for (const g of guests) if (g.guestNickname !== null) guestNames.add(normalizeName(g.guestNickname))
  return {
    writers: writers.map((w) => ({
      code: w.code,
      status: w.status,
      userId: w.userId,
      nickname: w.user.nickname,
      note: w.note,
      accountCount: w.user._count.accounts,
      hasPersona: w.user.persona !== null,
    })),
    userNames,
    guestNames,
    userIds: new Set(users.map((u) => u.id)),
    totals: { users: users.length, accounts, personas },
  }
}

// ─────────────────────────────────────────────────────────
// ⑤ 적용 뒤 검증 — 순수 · 🔴 행 단위가 정본
// ─────────────────────────────────────────────────────────

export type AfterVerdict = {
  /** 🔴 판정. 비어 있어야 통과 */
  problems: string[]
  /** 진단. 무관한 동시 가입·로그인이 움직이므로 실패 사유가 아니다 */
  diagnostics: { usersDelta: number; accountsDelta: number; personasDelta: number }
}

/**
 * 🔴 판정의 정본은 **이 도구가 만든 행과 건드리면 안 되는 행**뿐이다.
 *    - 새 OP11~OP30: 각각 있고 · 값이 명단과 같고 · active · Account 0 · Persona 0 ·
 *      그 User 가 적용 전에 없던 새 User 이고 · 서로 다른 User 다.
 *    - 기준 OP01~OP10: 같은 User · 같은 닉네임 · 같은 note · active · Account 0 · Persona 0.
 *    - OperatorWriter 표: code 집합이 정확히 OP01~OP30 이고 전원 active.
 *
 * 🔴 전체 User·Account·Persona 수는 **판정에 쓰지 않는다.** 적용과 같은 순간에 누가 가입하면
 *    그 수가 움직이고, 그것을 실패로 보면 커밋된 적용을 거짓으로 "실패" 라 보고하게 된다.
 */
export function verifyAfter(before: DbFacts, after: DbFacts, specs: readonly WriterSpec[] = EXPANSION): AfterVerdict {
  const problems: string[] = []
  const codes = after.writers.map((w) => w.code).sort()
  if (JSON.stringify(codes) !== JSON.stringify([...TARGET_CODES])) problems.push(`code 집합이 OP01~OP${TARGET_ACTIVE} 가 아니다`)
  const inactive = after.writers.filter((w) => w.status !== 'active').map((w) => w.code)
  if (inactive.length > 0) problems.push(`active 가 아닌 code [${inactive.join(',')}]`)

  const byCode = new Map(after.writers.map((w) => [w.code, w]))
  const newUserIds = new Set<string>()
  for (const s of specs) {
    const w = byCode.get(s.code)
    if (w === undefined) { problems.push(`${s.code} 없음`); continue }
    if (w.nickname !== s.nickname || (w.note ?? '') !== s.note) problems.push(`${s.code} 값이 명단과 다르다`)
    if (w.status !== 'active') problems.push(`${s.code} status=${w.status}`)
    if (w.accountCount !== 0) problems.push(`${s.code} Account ${w.accountCount}`)
    if (w.hasPersona) problems.push(`${s.code} Persona 연결`)
    if (before.userIds.has(w.userId)) problems.push(`${s.code} 의 User 가 적용 전부터 있던 User 다`)
    if (newUserIds.has(w.userId)) problems.push(`${s.code} 가 다른 새 code 와 같은 User 를 쓴다`)
    newUserIds.add(w.userId)
  }
  const beforeBy = new Map(before.writers.map((w) => [w.code, w]))
  for (const code of BASELINE_CODES) {
    const a = byCode.get(code)
    const b = beforeBy.get(code)
    if (a === undefined || b === undefined) { problems.push(`기준 ${code} 가 없다`); continue }
    if (a.userId !== b.userId || a.nickname !== b.nickname || (a.note ?? '') !== (b.note ?? '') || a.status !== b.status
      || a.accountCount !== 0 || a.hasPersona) {
      problems.push(`기준 ${code} 가 바뀌었다`)
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
// ⑥ 적용 — 🔴 한 트랜잭션. 안에서 다시 읽고 다시 판정한다
// ─────────────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true; created: number; noop: boolean; activeBefore: number; activeAfter: number; before: DbFacts }
  | { ok: false; reason: string; problems: readonly string[] }

export async function applyExpansion(
  prisma: PrismaClient,
  opts: { expected: Expected; approvedDigest: string; specs?: readonly WriterSpec[] },
): Promise<ApplyResult> {
  const specs = opts.specs ?? EXPANSION
  try {
    const r = await prisma.$transaction(async (tx) => {
      const before = await readFacts(tx)
      const plan = planExpansion(before, specs)
      if (plan.digest !== opts.approvedDigest) {
        throw new Abort('명단이 승인된 digest 와 다르다 — 새 dry-run 승인이 필요하다', [`승인 ${opts.approvedDigest} · 지금 ${plan.digest}`])
      }
      if (plan.action === 'abort') throw new Abort('계획이 막혔다', plan.problems)
      if (plan.activeBefore !== opts.expected.before || plan.activeAfter !== opts.expected.after) {
        throw new Abort('active 수가 승인과 다르다', [
          `승인 ${opts.expected.before}:${opts.expected.after} · 지금 ${plan.activeBefore}:${plan.activeAfter}`,
        ])
      }
      if (plan.action === 'noop') {
        return { created: 0, noop: true, activeBefore: plan.activeBefore, activeAfter: plan.activeAfter, before }
      }

      for (const s of plan.creates) {
        // 🔴 nested create 하나 — User 와 OperatorWriter 가 같이 생기거나 같이 없다.
        //    accounts · persona 는 만들지 않는다
        await tx.user.create({
          data: {
            nickname: s.nickname,
            operatorWriter: { create: { code: s.code, note: s.note, status: 'active' } },
          },
          select: { id: true },
        })
      }
      const after = await readFacts(tx)
      const v = verifyAfter(before, after, specs)
      if (v.problems.length > 0) throw new Abort('적용 뒤 검증 실패 — rollback', v.problems)
      return {
        created: plan.creates.length,
        noop: false,
        activeBefore: plan.activeBefore,
        activeAfter: after.writers.filter((w) => w.status === 'active').length,
        before,
      }
    }, { timeout: 60_000, maxWait: 10_000 })
    return { ok: true, ...r }
  } catch (e) {
    if (e instanceof Abort) return { ok: false, reason: e.message, problems: e.problems }
    return { ok: false, reason: `트랜잭션 오류 — rollback (${(e as Error).name})`, problems: [String((e as Error).message).split('\n')[0] ?? ''] }
  }
}

class Abort extends Error {
  constructor(message: string, readonly problems: readonly string[]) { super(message) }
}

// ─────────────────────────────────────────────────────────
// ⑦ 실행 모드 — 🔴 DB 에 붙기 **전에** 정한다
// ─────────────────────────────────────────────────────────

export type ApplyArgs = { expected: Expected; digest: string; reason: string }

export type Mode =
  | { kind: 'dry-run' }
  | ({ kind: 'apply-isolated' } & ApplyArgs)
  | ({ kind: 'apply-production'; target: string } & ApplyArgs)
  | { kind: 'refuse'; problems: string[] }

/** 격리 DB 주소인가 — 127.0.0.1/localhost 의 soran_test 만 */
export function isIsolatedUrl(url: string): boolean {
  return /^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\/soran_test(\?|$)/.test(url)
}

/** 로컬 주소인가 — 운영 모드에서는 격리 DB 가 아니어도 로컬이면 거부한다 */
export function isLocalUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/([^@/]*@)?(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?\//.test(url)
}

/**
 * 인자만 본다(순수). 운영 사실(env·git)은 `judgeProduction` 이 따로 본다.
 *
 * 🔴 apply 는 `--expect=<지금>:<예측>` · `--digest=<SHA-256 64자리>` · `--reason=<비어 있지 않음>` 을 요구한다.
 *    운영은 여기에 `--production` · `--target=<40자리 SHA>` 가 더 필요하다.
 *    격리 apply 는 셸 주소가 격리 DB 모양일 때만 연다.
 */
export function decideMode(argv: readonly string[], shellDbUrl: string): Mode {
  const has = (k: string): boolean => argv.includes(k)
  const val = (k: string): string | null => {
    const a = argv.find((x) => x.startsWith(`${k}=`))
    return a === undefined ? null : a.slice(k.length + 1)
  }
  const flags = new Set(['--apply', '--production', '--json'])
  const valued = ['--expect', '--digest', '--reason', '--target']
  const unknownArgs = argv.filter((a) => !flags.has(a) && !valued.some((k) => a.startsWith(`${k}=`)))
  if (unknownArgs.length > 0) return { kind: 'refuse', problems: [`모르는 인자: ${unknownArgs.join(' ')}`] }

  if (!has('--apply')) {
    if (has('--production') || valued.some((k) => val(k) !== null)) {
      return { kind: 'refuse', problems: ['--apply 없이 적용 인자를 받았다 — dry-run 은 인자 없이 돈다'] }
    }
    return { kind: 'dry-run' }
  }

  const problems: string[] = []
  const m = /^(\d+):(\d+)$/.exec(val('--expect') ?? '')
  if (m === null) problems.push('--expect=<지금 active>:<예측 active> 가 필요하다 (dry-run 이 보고한 값 — 예: 10:30)')
  const digest = val('--digest')
  if (digest === null || !/^[0-9a-f]{64}$/.test(digest)) problems.push('--digest=<dry-run 의 SHA-256 64자리> 가 필요하다')
  const reason = (val('--reason') ?? '').trim()
  if (reason === '') problems.push('--reason=<비어 있지 않은 사유> 가 필요하다')
  const target = val('--target')

  if (has('--production')) {
    if (target === null || !/^[0-9a-f]{40}$/.test(target)) problems.push('--target=<40자리 commit SHA> 가 필요하다')
  } else {
    if (target !== null) problems.push('--target 은 --production 과 함께만 쓴다')
    if (!isIsolatedUrl(shellDbUrl)) problems.push('운영 DB 적용은 --production 이 필요하다 (아니면 격리 DB 주소만 연다)')
  }
  if (problems.length > 0) return { kind: 'refuse', problems }
  const args: ApplyArgs = { expected: { before: Number(m![1]), after: Number(m![2]) }, digest: digest!, reason }
  return has('--production')
    ? { kind: 'apply-production', target: target!, ...args }
    : { kind: 'apply-isolated', ...args }
}

// ─────────────────────────────────────────────────────────
// ⑧ 운영 가드 — 실행 직전 사실을 모으고(불순) 판정한다(순수)
// ─────────────────────────────────────────────────────────

export type ProductionFacts = {
  /** 셸의 SORAN_ISOLATED_DB — 비어 있지 않으면 거부 */
  isolatedFlag: string
  /** canonical env 읽기 결과 */
  env: { ok: boolean; reason: string | null; databaseUrl: string; directUrl: string }
  /** `git fetch origin main` 성공 여부 */
  fetched: boolean
  originMain: string | null
  head: string | null
  /** `git status --porcelain --untracked-files=no` 결과. git 실패면 null */
  trackedChanges: string | null
  /** 실행 중인 이 도구 파일들이 HEAD 에 추적되고 수정 없음인가 (파일별) */
  toolFilesCommitted: readonly { path: string; tracked: boolean }[]
}

/**
 * 🔴 운영 apply 를 여는 조건 전부. 하나라도 어긋나면 DB 에 붙지 않는다.
 *    - 셸의 DATABASE_URL 은 보지 않는다. canonical env 를 읽어 그 값으로 덮는다.
 *    - fetch 한 origin/main = 이 저장소 HEAD = --target.
 *    - tracked 변경 0 이고, 실행 중인 이 도구 파일이 HEAD 에 커밋돼 있다
 *      (HEAD 가 main 이어도 미커밋 스크립트를 얹어 돌리면 main 에 없는 코드가 운영에 쓴다).
 */
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
  if (f.originMain !== null && f.head !== null && f.originMain !== f.head) problems.push(`HEAD ${f.head.slice(0, 12)} ≠ origin/main ${f.originMain.slice(0, 12)}`)
  if (f.head !== null && f.head !== target) problems.push(`HEAD ${f.head.slice(0, 12)} ≠ --target ${target.slice(0, 12)}`)
  if (f.trackedChanges === null) problems.push('작업 트리 상태를 읽지 못했다')
  else if (f.trackedChanges.trim() !== '') problems.push(`tracked 변경이 있다 (${f.trackedChanges.trim().split('\n').length}건)`)
  if (f.toolFilesCommitted.length === 0) problems.push('도구 파일 확인 결과가 비어 있다')
  for (const t of f.toolFilesCommitted) if (!t.tracked) problems.push(`${t.path} 가 HEAD 에 커밋돼 있지 않다 — 미커밋 코드로 운영을 열지 않는다`)
  return problems
}

/** 이 도구를 이루는 파일 — 운영 apply 는 이 파일들이 HEAD 에 커밋돼 있어야 열린다 */
export const TOOL_FILES: readonly string[] = [
  'scripts/operator-writer-expand.mts',
  'scripts/lib/operator-writer-expand.mts',
]

function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/**
 * 🔴 실행 직전의 사실. `scriptDir` 은 **실행 중인 스크립트의 위치**다 — cwd 가 아니다.
 *    cwd 를 쓰면 깨끗한 main 에 서서 다른 worktree 의 미커밋 스크립트를 돌리는 길이 열린다.
 *    `git fetch origin main` 외에 아무것도 바꾸지 않는다.
 */
export function collectProductionFacts(scriptDir: string, env: NodeJS.ProcessEnv, envFile?: string): ProductionFacts {
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
