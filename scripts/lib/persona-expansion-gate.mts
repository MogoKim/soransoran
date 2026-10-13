/**
 * Persona 확장 **후보 게이트** — 🔴 운영 검증기를 그대로 부르고, 확장에만 있는 충돌을 얹는다 (2026-10-13)
 *
 * 🔴 새 판정을 만들지 않는 곳과 만드는 곳을 가른다.
 *
 *      그대로 부른다   `judgeAutogenBatch`      카드 형식 · seed · 4상태 계약 축 · 글/댓글 자격 · 겹침 · 문체 거리
 *                      `judgeCreativeQuality`   creative 묶음 품질(제목 · 변주 · 자기모순 · 생활사 사실)
 *                      `verifyNamePolicy`       닉네임 정책(Pool §3-2)
 *                      `checkNameCollision`     Gate ⑥-B — 회원 · 다른 Persona · 규칙
 *      여기서 더한다   관심사 · 게시판 · 금칙어 · 연령 대상 범위 — 운영 Persona 행에 칸이 없어
 *                      확장 후보 fixture 에만 있는 메타데이터다(스키마는 바꾸지 않는다)
 *                      집단 다양성 — `persona-expansion.judgePopulationDiversity`
 *
 * 🔴 DB · 네트워크 · LLM 없음. 대조 집합(회원 이름 · 기존 Persona 이름 · cadence)은 부르는 쪽이 준다 —
 *    주지 않으면 **모른다**(통과가 아니다).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BRAND_BANNED_WORDS } from '../../src/lib/content-guard'
import { CHILD_AGE_BANDS } from '../../src/lib/original-post-persona-match'
import {
  AUTOGEN_AGE_BANDS, lifeProblems, voiceCoreFromBundle, type AutogenCandidate, type Cadence, type LifeSkeleton, type PersonaCreative,
} from '../../src/lib/persona-autogen'
import { judgeCreativeQuality } from '../../src/lib/persona-creative'
import {
  diversitySubjectOf, diversitySubjectOfCard, judgePopulationDiversity, type DiversityVerdict,
} from '../../src/lib/persona-expansion'
import { candidatesFor, verifyNamePolicy } from '../../src/lib/persona-nickname-candidates'
import { COMMON_NO_GO_PHRASES } from '../../src/lib/persona-no-go'
import { readLengthBand } from '../../src/lib/original-post-persona-match'
import type { PoolCard } from '../../src/lib/persona-pool-card'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { judgeAutogenBatch, type AutogenVerdict } from './persona-autogen.mjs'
import { checkNameCollision, type NameCollisionSets } from './persona-gate-name-collision.mjs'

// ─────────────────────────────────────────────────────────
// fixture — 후보 원자료
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **게시판 — 게시판인 것만.** IA 정본: 갱년기톡 · 자유게시판 = 게시판, 매거진 = 콘텐츠 영역(게시판 아님).
 *    Persona 가 매거진에 "활동" 한다고 적히면 매거진 글이 커뮤니티 활동처럼 읽힌다.
 */
export const PERSONA_BOARDS = ['MENOPAUSE', 'FREE'] as const
export type PersonaBoard = (typeof PERSONA_BOARDS)[number]
const NOT_A_BOARD = ['MAGAZINE', 'BEST'] as const

export const INTEREST_MIN = 2
export const INTEREST_MAX = 5

export type ExpansionCandidateFixture = {
  code: string
  life: LifeSkeleton
  creative: PersonaCreative
  displayName: string
  /** 🔴 관심사 — 운영 행에 칸이 없다. 확장 게이트와 creative 설계만 쓴다 */
  interests: string[]
  boards: string[]
}

export type ExpansionFixture = {
  cohort: string
  /** 🔴 사람이 읽을 근거 — 어떻게 골랐는가 */
  note: string
  candidates: ExpansionCandidateFixture[]
}

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** 🔴 엄격 파서 — 모양이 틀리면 칸을 기본값으로 메우지 않고 문제로 올린다 */
export function parseExpansionFixture(raw: string): { ok: true; fixture: ExpansionFixture } | { ok: false; problems: string[] } {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return { ok: false, problems: ['JSON 이 아니다'] } }
  const problems: string[] = []
  if (obj === null || typeof obj !== 'object') return { ok: false, problems: ['객체가 아니다'] }
  const o = obj as Record<string, unknown>
  if (typeof o.cohort !== 'string' || o.cohort.trim() === '') problems.push('cohort 가 없다')
  if (typeof o.note !== 'string') problems.push('note 가 없다')
  if (!Array.isArray(o.candidates) || o.candidates.length === 0) problems.push('candidates 가 비었다')
  const out: ExpansionCandidateFixture[] = []
  for (const [i, c] of (Array.isArray(o.candidates) ? o.candidates : []).entries()) {
    const at = `candidates[${i}]`
    if (c === null || typeof c !== 'object') { problems.push(`${at}: 객체가 아니다`); continue }
    const x = c as Record<string, unknown>
    const code = typeof x.code === 'string' ? x.code : ''
    if (!/^P\d+$/.test(code)) problems.push(`${at}: code 형식이 아니다`)
    if (typeof x.displayName !== 'string') problems.push(`${code || at}: displayName 이 없다`)
    if (!isStrArr(x.interests)) problems.push(`${code || at}: interests 가 문자열 배열이 아니다`)
    if (!isStrArr(x.boards)) problems.push(`${code || at}: boards 가 문자열 배열이 아니다`)
    const cr = x.creative as Record<string, unknown> | undefined
    if (cr === undefined || typeof cr.title !== 'string' || !isStrArr(cr.personality) || !isStrArr(cr.noGoTopics)
      || !isStrArr(cr.noGoExpressions) || !isStrArr(cr.variations)) {
      problems.push(`${code || at}: creative 모양이 틀렸다`)
    }
    const l = x.life as Record<string, unknown> | undefined
    const lifeStr = ['ageBand', 'birthDate', 'region', 'maritalStatus', 'spouseRelationship', 'workStatus',
      'economicStatus', 'housing', 'menopauseStatus', 'parentCare'] as const
    if (l === undefined || lifeStr.some((k) => typeof l[k] !== 'string') || typeof l.childrenCount !== 'number'
      || !isStrArr(l.childrenAgeBands) || !(l.childrenLiving === null || l.childrenLiving === '동거' || l.childrenLiving === '분가')) {
      problems.push(`${code || at}: life 모양이 틀렸다`)
    } else if (l.childrenAgeBands.some((b) => !(CHILD_AGE_BANDS as readonly string[]).includes(b))) {
      problems.push(`${code}: 모르는 자녀 나이대`)
    }
    if (problems.some((p) => p.startsWith(code || at))) continue
    out.push({
      code, life: x.life as LifeSkeleton, creative: x.creative as PersonaCreative,
      displayName: x.displayName as string, interests: x.interests as string[], boards: x.boards as string[],
    })
  }
  const dupes = out.map((c) => c.code).filter((c, i, a) => a.indexOf(c) !== i)
  if (dupes.length > 0) problems.push(`중복 코드: ${[...new Set(dupes)].join(',')}`)
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, fixture: { cohort: o.cohort as string, note: o.note as string, candidates: out } }
}

export function loadExpansionFixture(repoRoot: string, path: string): ReturnType<typeof parseExpansionFixture> {
  try {
    return parseExpansionFixture(readFileSync(join(repoRoot, path), 'utf-8'))
  } catch (e) {
    return { ok: false, problems: [`읽지 못했다: ${e instanceof Error ? e.message : String(e)}`] }
  }
}

// ─────────────────────────────────────────────────────────
// 충돌 — 닉네임 · 연령 · 관심사 · 게시판 · 금칙
// ─────────────────────────────────────────────────────────

export const CONFLICT_CODES = [
  'NAME_POLICY', 'NAME_COLLISION', 'NAME_BATCH_CONFUSABLE', 'NAME_MEMBERS_UNMEASURED',
  'AGE_OUT_OF_AUDIENCE', 'AGE_LIFE_CONFLICT',
  'INTEREST_COUNT', 'INTEREST_NOGO_CONFLICT', 'INTEREST_LIFE_CONFLICT',
  'BOARD_EMPTY', 'BOARD_NOT_A_BOARD', 'BOARD_UNKNOWN',
  'BRAND_BANNED_WORD', 'COMMON_NOGO_IN_VARIATION',
] as const
export type ConflictCode = (typeof CONFLICT_CODES)[number]

/**
 * 🔴 **관심사가 그 사람의 생활사로 성립하는가.** 관심사 글자에 아래 낱말이 있으면 생활사가 그것을 받쳐야 한다.
 *    없는 손주를 보는 사람, 남편 없는 사람의 "남편 퇴직" 은 첫 글에서 모순이 드러난다.
 *    🔴 표는 짧게 둔다 — 낱말이 없으면 판정하지 않는다(뜻을 추측하지 않는다).
 */
export const INTEREST_LIFE_RULES: readonly { words: readonly string[]; need: string; ok: (l: LifeSkeleton) => boolean }[] = [
  { words: ['손주'], need: '성인 자녀', ok: (l) => l.childrenAgeBands.includes('성인') },
  { words: ['육아', '초등'], need: '영유아·초등 자녀', ok: (l) => l.childrenAgeBands.some((b) => b === '영유아' || b === '초등') },
  { words: ['입시', '수능', '학원'], need: '초등·중고등 자녀', ok: (l) => l.childrenAgeBands.some((b) => b === '초등' || b === '중고등') },
  { words: ['자녀 취업', '취준'], need: '대학·취준 자녀', ok: (l) => l.childrenAgeBands.includes('대학·취준') },
  { words: ['남편', '부부', '시댁', '시어머니'], need: '기혼·별거', ok: (l) => l.maritalStatus === '기혼' || l.maritalStatus === '별거' },
  { words: ['간병', '부모 돌봄', '요양'], need: '부모 돌봄 있음', ok: (l) => l.parentCare !== '없음' },
  { words: ['가게', '장사'], need: '자영업', ok: (l) => l.workStatus === '자영업' },
  { words: ['직장', '출근'], need: '직장·파트타임', ok: (l) => l.workStatus === '직장' || l.workStatus === '파트타임' },
]

const textsOf = (c: ExpansionCandidateFixture): string[] => [
  c.creative.title, ...c.creative.personality, ...c.creative.variations, ...c.interests, ...c.creative.noGoTopics,
]

export type ConflictContext = {
  /** 🔴 Gate ⑥-B 대조 집합 — `null` 이면 회원 이름을 모른다(NAME_MEMBERS_UNMEASURED) */
  nameSets: NameCollisionSets | null
  /** 이번 묶음의 다른 후보 이름 — 서로 헷갈리면 안 된다 */
  batchNames: ReadonlyMap<string, string>
}

export function judgeCandidateConflicts(c: ExpansionCandidateFixture, ctx: ConflictContext): { code: ConflictCode; detail: string }[] {
  const out: { code: ConflictCode; detail: string }[] = []
  const add = (code: ConflictCode, detail: string): void => { out.push({ code, detail }) }

  // ── 닉네임 ──
  const pol = verifyNamePolicy(c.displayName)
  if (!pol.ok) add('NAME_POLICY', pol.problems.join(' / '))
  const others = [...ctx.batchNames.entries()].filter(([code]) => code !== c.code).map(([, n]) => n)
  const inBatch = checkNameCollision(c.displayName, { personaNames: others })
  if (inBatch.status !== 'pass') add('NAME_BATCH_CONFUSABLE', `묶음 안 Gate ⑥-B ${inBatch.status}`)
  if (ctx.nameSets === null) add('NAME_MEMBERS_UNMEASURED', '회원 · 기존 Persona 이름 대조 집합이 없다 (--db 필요)')
  else {
    const g = checkNameCollision(c.displayName, ctx.nameSets)
    if (g.status !== 'pass') add('NAME_COLLISION', `Gate ⑥-B ${g.status}`)
  }

  // ── 연령 ──
  if (!AUTOGEN_AGE_BANDS.includes(c.life.ageBand)) add('AGE_OUT_OF_AUDIENCE', `${c.life.ageBand} — 대상 ${AUTOGEN_AGE_BANDS.join('·')}`)
  const lp = lifeProblems(c.life)
  if (lp.length > 0) add('AGE_LIFE_CONFLICT', lp.join(' / '))

  // ── 관심사 ──
  if (c.interests.length < INTEREST_MIN || c.interests.length > INTEREST_MAX) {
    add('INTEREST_COUNT', `${c.interests.length}개 — ${INTEREST_MIN}~${INTEREST_MAX}개`)
  }
  for (const it of c.interests) {
    for (const t of c.creative.noGoTopics) {
      if (it.includes(t) || t.includes(it)) add('INTEREST_NOGO_CONFLICT', `관심사 "${it}" ↔ noGo "${t}"`)
    }
    for (const r of INTEREST_LIFE_RULES) {
      if (r.words.some((w) => it.includes(w)) && !r.ok(c.life)) add('INTEREST_LIFE_CONFLICT', `관심사 "${it}" — 생활사에 ${r.need} 가 없다`)
    }
  }

  // ── 게시판 ──
  if (c.boards.length === 0) add('BOARD_EMPTY', '활동 게시판이 없다')
  for (const b of c.boards) {
    if ((NOT_A_BOARD as readonly string[]).includes(b)) add('BOARD_NOT_A_BOARD', `${b} 는 게시판이 아니다 (IA 정본)`)
    else if (!(PERSONA_BOARDS as readonly string[]).includes(b)) add('BOARD_UNKNOWN', b)
  }

  // ── 금칙 ──
  for (const t of textsOf(c)) {
    for (const w of BRAND_BANNED_WORDS) if (t.includes(w)) add('BRAND_BANNED_WORD', `"${w}" in "${t}"`)
  }
  for (const v of c.creative.variations) {
    for (const p of COMMON_NO_GO_PHRASES) if (v.includes(p)) add('COMMON_NOGO_IN_VARIATION', `"${p}" in "${v}"`)
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 이름 공간 — 300 명이 서로 헷갈리지 않을 이름이 남았는가
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **후보 이름 공간 — 코드마다 다른 조합이 나온다.** `candidatesFor(code)` 는 코드 seed 로 조합을 펴서
 *    한 코드가 보는 것은 공간의 일부다. 확장 전체가 쓸 수 있는 공간은 **발급 가능한 코드 전부의 합집합**이다.
 */
export const NAME_SPACE_PROBE_CODES = 999

export function nameSpaceUnion(probe = NAME_SPACE_PROBE_CODES): string[] {
  const u = new Set<string>()
  for (let n = 1; n <= probe; n += 1) for (const x of candidatesFor(`P${String(n).padStart(2, '0')}`, 10_000)) u.add(x)
  return [...u].sort()
}

/**
 * 🔴 **서로 · 기존 이름과 Gate ⑥-B 로 부딪히지 않는 후보 이름 수.**
 *    공간(합집합)을 사전순으로 하나씩 보며, 이미 고른 이름 + 기존 이름(+ 회원 이름)과 `pass` 인 것만 남긴다 —
 *    추정이 아니라 **이 순서로 실제로 고를 수 있는 수**다(최대 독립 집합보다 작을 수 있다 — 하한 쪽 값이다).
 *
 *    `bound`  memberNames 를 받았으면 exact, 아니면 upper(회원 이름이 더 막을 수 있다)
 *
 * 🔴 실측(2026-10-13 · 오프라인): 합집합 236개 중 서로 헷갈리지 않는 이름 약 55개 —
 *    세 글자 이름이 같은 두 글자 몸통(`BODY2`)을 나눠 써 편집 거리 1 로 부딪힌다. 300 명은 이 공간으로 서지 않는다.
 */
export function nameSpaceCapacity(input: {
  takenNames: readonly string[]
  memberNames: readonly string[] | null
  space?: readonly string[]
}): { space: number; free: number; bound: 'exact' | 'upper'; picked: string[] } {
  const space = input.space ?? nameSpaceUnion()
  const picked: string[] = []
  for (const n of space) {
    const sets: NameCollisionSets = {
      personaNames: [...input.takenNames, ...picked],
      ...(input.memberNames === null ? {} : { memberNames: input.memberNames }),
    }
    if (checkNameCollision(n, sets).status === 'pass') picked.push(n)
  }
  return { space: space.length, free: picked.length, bound: input.memberNames === null ? 'upper' : 'exact', picked }
}

// ─────────────────────────────────────────────────────────
// 묶음 판정
// ─────────────────────────────────────────────────────────

export type ExpansionCandidateVerdict = {
  code: string
  /** 🔴 ready = 모든 판정 통과 · blocked = 막힘 하나 이상 · unmeasured = 막힘은 없고 모름만 있다 */
  status: 'ready' | 'blocked' | 'unmeasured'
  autogen: AutogenVerdict
  conflicts: { code: ConflictCode; detail: string }[]
  /** 이 후보 쪽 사유 코드 전부 — autogen 차단 코드 + 충돌 코드 */
  reasons: string[]
}

export type ExpansionBatchVerdict = {
  candidates: ExpansionCandidateVerdict[]
  creativeQuality: ReturnType<typeof judgeCreativeQuality>
  diversity: DiversityVerdict
  /** 운영 고정 배정 묶음 최소 문체 거리 — `judgeAutogenBatch` 가 쓰는 기준 */
  voiceBaseline: number | null
  /** 🔴 묶음 전체가 서는가 — 후보 전원 ready + creative PASS + 다양성 OK */
  ok: boolean
}

/** 🔴 "모른다" 계열 — 막힘이 아니라 재지 못한 것. 둘을 섞어 세지 않는다 */
const UNKNOWN_REASONS = new Set<string>([
  'REAL_MEMBER_UNMEASURED', 'CADENCE_UNMEASURED', 'VOICE_SEPARATION_UNMEASURED', 'NAME_MEMBERS_UNMEASURED',
])

/**
 * 🔴 **계약 축의 "모름" 을 막힘과 가른다.** autogen 은 4상태 계약의 blocked 와 unknown 을 같은 사유 코드로 낸다
 *    (`계약 ${axis}: …` / `계약 ${axis} 모름: …`). 그 코드의 사유 줄이 **전부** 모름이면 재지 못한 것이다.
 *    🔴 사유 줄 형식은 `persona-expansion-check` 가 autogen 소스와 대조한다 — 형식이 바뀌면 검사가 실패한다.
 */
export const CONTRACT_UNKNOWN_DETAIL = / 모름: /
function onlyUnknownContract(v: AutogenVerdict, code: string): boolean {
  const lines = v.details.filter((d) => d.startsWith(`${code}: `))
  return lines.length > 0 && lines.every((d) => d.startsWith(`${code}: 계약 `) && CONTRACT_UNKNOWN_DETAIL.test(d))
}

export function judgeExpansionBatch(input: {
  fixture: ExpansionFixture
  existingCards: readonly PoolCard[]
  /** 🔴 기존 집단 — 운영 universe 코드의 카드만 */
  productionCodes: readonly string[]
  takenCodes: ReadonlySet<string>
  voiceByCode: ReadonlyMap<string, { bundle: VoiceReferenceBundle; seedShareCount: number | null }>
  productionBundles: readonly VoiceReferenceBundle[]
  /** 운영 cadence 최빈값 — `null` 이면 모른다 */
  cadence: Cadence | null
  nameSets: NameCollisionSets | null
}): ExpansionBatchVerdict {
  const cands = input.fixture.candidates
  const batchNames = new Map(cands.map((c) => [c.code, c.displayName]))

  const autogenCands: AutogenCandidate[] = cands.map((c) => {
    const nameGate = input.nameSets === null ? null : checkNameCollision(c.displayName, input.nameSets).status
    return {
      code: c.code, life: c.life, creative: c.creative,
      voice: input.voiceByCode.get(c.code) ?? null,
      cadence: input.cadence,
      // 🔴 확장 후보도 언제나 **새 User** 를 만든다 — 계정 0 · providerId 없음이 사실이다(autogen 과 같은 뜻)
      binding: { accountCount: 0, providerId: null },
      displayName: nameGate === null ? null : { name: c.displayName, gate: nameGate },
    }
  })
  const auto = judgeAutogenBatch(autogenCands, {
    takenCodes: input.takenCodes, existingCards: input.existingCards, productionBundles: input.productionBundles,
  })
  const autoBy = new Map(auto.verdicts.map((v) => [v.code, v]))

  const creativeQuality = judgeCreativeQuality({
    candidates: cands.map((c) => ({ code: c.code, creative: c.creative, life: c.life })),
    existingTitles: input.existingCards.map((c) => c.title),
    expected: cands.map((c) => c.code),
  })

  const prodSet = new Set(input.productionCodes)
  const diversity = judgePopulationDiversity({
    existing: input.existingCards.filter((c) => prodSet.has(c.code)).map(diversitySubjectOfCard),
    batch: cands.map((c) => {
      const v = input.voiceByCode.get(c.code)
      // 🔴 말투 근거가 없으면 문체 밴드도 없다 — 지어내지 않는다
      const band = v === undefined ? null : readLengthBand(voiceCoreFromBundle(v.bundle).length)
      return diversitySubjectOf(c.code, c.life, c.creative, band)
    }),
  })

  const candidates: ExpansionCandidateVerdict[] = cands.map((c) => {
    const a = autoBy.get(c.code)!
    const conflicts = judgeCandidateConflicts(c, { nameSets: input.nameSets, batchNames })
    const reasons = [...new Set([...a.blocks, ...conflicts.map((x) => x.code)])]
    const hard = reasons.filter((r) => !UNKNOWN_REASONS.has(r) && !onlyUnknownContract(a, r))
    const status: ExpansionCandidateVerdict['status'] = reasons.length === 0 ? 'ready' : hard.length > 0 ? 'blocked' : 'unmeasured'
    return { code: c.code, status, autogen: a, conflicts, reasons }
  })

  return {
    candidates, creativeQuality, diversity, voiceBaseline: auto.voiceBaseline,
    ok: candidates.every((c) => c.status === 'ready') && creativeQuality.ok && diversity.ok,
  }
}
