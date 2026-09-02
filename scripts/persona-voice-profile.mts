#!/usr/bin/env tsx
/**
 * 페르소나 카드 → DB 이관 — 말투 변주 · 활동 리듬 · noGo
 *
 * 정본: docs/operations/2026-08-30-persona-pool-design.md §5 (카드 20명)
 *
 * 🔴 **이것은 설계가 아니라 이관이다.**
 *    P07 · P10 · P15 · P17 의 variation · noGo · 금지 역할은 **카드에 이미 있다.**
 *    여기서 값을 새로 지어내면 문서와 DB 에 두 개의 진실이 생긴다 —
 *    아래 PLANNED 는 전부 카드에서 옮긴 것이고, 옮긴 자리를 주석으로 남긴다.
 *
 * 🔴 **activityRhythm 만 예외다.** 카드에 없어 창업자가 따로 정했다(2026-09-02).
 *
 * 🔴 **왜 이 값이 필요한가**
 *      voiceVariations null  → 매번 같은 톤. 헌법 §9-7 "같은 사람이 쓴 티" 의 직접 원인
 *      noGoExpressions 0종   → 금지 표현이 정의되지 않는다
 *      activityRhythm null   → 활동 시간대를 판정할 수 없다
 *    셋이 빈 채로 active 로 켜면, 켜는 것 자체는 안전해도 글이 서로 닮는다.
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *      · status 전환 · active 화 — 활성화는 별도 승인 대상이다
 *      · identity 수정 — childrenAgeBands 는 #311 에서 이미 끝났다
 *      · dailyCap · weeklyCap · userId · Post · Queue — 어느 것도 건드리지 않는다
 *      · migration · 발행 · LLM · 크롤
 *
 * 🔴 **write 대상은 Persona 4행의 지정 4필드뿐이다.**
 *      voiceVariations · activityRhythm · noGoExpressions · forbiddenReactionRoles
 *
 * 🔴 **noGoTopics 는 보류다 — 쓰지 않는다.**
 *    카드 값은 PLANNED 에 그대로 보관하고(`--nogo-scan` 이 읽는다), DB 에는 넣지 않는다.
 *    형식이 정해지기 전에 넣으면 가드가 작동하는 것처럼만 보인다(FORBIDDEN_WRITE_KEYS 주석).
 *
 * 🔴 dry-run 이 기본이다. `--apply` **와** `--limit=N` 이 **둘 다** 있어야 하고,
 *    `--limit` 은 대상 수와 **정확히 같아야** 한다.
 *
 * 사용법
 *   npx tsx scripts/persona-voice-profile.mts                  dry-run
 *   npx tsx scripts/persona-voice-profile.mts --apply --limit=4  🔴 실제 반영
 *   npx tsx scripts/persona-voice-profile.mts --nogo-scan       noGo 오탐 실측(읽기 전용 · 보류 판단 근거)
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

// ─────────────────────────────────────────────────────────
// 카드 값 — 🔴 docs/operations/2026-08-30-persona-pool-design.md §5
// ─────────────────────────────────────────────────────────

export type ActivityRhythm = {
  /** [시작시, 끝시) 구간들 */
  activeHours: [number, number][]
  weekdayBias: number
  burstiness: number
}

export type VoiceProfile = {
  code: string
  /** 카드의 `variation` 줄. 🔴 P05 와 같은 문자열 배열 형식 */
  voiceVariations: string[]
  /** 🔴 카드에 없다. 창업자 결정 (2026-09-02) */
  activityRhythm: ActivityRhythm
  /** 카드의 `noGo` 줄 */
  noGoTopics: string[]
  /** 카드가 따로 짚은 표현 */
  noGoExpressions: string[]
  /** 카드의 `금지` 줄 */
  forbiddenReactionRoles: string[]
}

export const PLANNED: readonly VoiceProfile[] = [
  {
    // 카드 P07 — 대학생 하나, 요양원 오가며
    code: 'P07',
    voiceVariations: ['경험 나누기', '조심스러운 되묻기', '짧은 공감', '무호칭', '두 문장', '말끝 흐리기'],
    activityRhythm: { activeHours: [[10, 13], [21, 23]], weekdayBias: 0.5, burstiness: 0.3 },
    noGoTopics: ['병원·약 언급', '치료 결과 단정', '검사 권유'],
    noGoExpressions: [],
    forbiddenReactionRoles: ['advice', 'information', 'caution'],
  },
  {
    // 카드 P10 — 다시 일자리 찾는 중
    code: 'P10',
    voiceVariations: ['웃으며 넘기기', '솔직하게 털기', '짧은 공감', '되묻기', '무호칭', '한숨 섞기', '응원 한 줄'],
    activityRhythm: { activeHours: [[13, 17], [22, 24]], weekdayBias: 0.4, burstiness: 0.5 },
    noGoTopics: ['금액 언급', '자녀 소원 관계를 화제로', '비교'],
    noGoExpressions: [],
    forbiddenReactionRoles: ['advice', 'caution', 'information'],
  },
  {
    // 카드 P15 — 혼자 살며 부모를 돌보는
    code: 'P15',
    voiceVariations: ['조용한 공감', '짧은 질문', '담담한 경험', '무호칭', '한 줄', '말없이 동의 표시'],
    activityRhythm: { activeHours: [[7, 9], [21, 23]], weekdayBias: 0.7, burstiness: 0.2 },
    noGoTopics: ['배우자·자녀 있는 척', '비혼을 화제로 만들기', '결혼 평가'],
    noGoExpressions: [],
    forbiddenReactionRoles: ['advice', 'caution', 'levity'],
  },
  {
    // 카드 P17 — 손주 보는 재미로  ⚠️ 카드가 Gate ⑧ 주의를 달았다(이모티콘·감탄사 반복)
    code: 'P17',
    voiceVariations: ['길게 반가워하기', '짧은 응원', '손주 얘기', '되묻기', '무호칭', '감탄사 시작', '두 줄로 끊기'],
    activityRhythm: { activeHours: [[8, 11], [14, 17]], weekdayBias: 0.5, burstiness: 0.6 },
    noGoTopics: ['훈계', '손주 자랑 반복', '결혼/출산 권유'],
    noGoExpressions: ['우리 때는'],
    forbiddenReactionRoles: ['advice', 'caution', 'information', 'rebuttal'],
  },
]

export const TARGET_CODES: readonly string[] = PLANNED.map((p) => p.code)

/** 🔴 P05 는 대상이 아니다. 이미 채워져 있고, 건드릴 이유가 없다 */
export const EXCLUDED_CODES: readonly string[] = ['P05']

/** 아키텍처 §10-2 반응 유형 + 금지 역할 어휘 */
export const REACTION_ROLES: readonly string[] = [
  'empathy', 'experience', 'advice', 'question', 'levity', 'information', 'caution', 'rebuttal',
]

// ─────────────────────────────────────────────────────────
// 순수 함수 — 🔴 DB 없이 fixture 가 전수 확인한다
// ─────────────────────────────────────────────────────────

export type PersonaRow = { code: string; status: string; providerId: string | null }
export type PlanIssue = { code: string; reason: string }

/** 🔴 활동 시간대가 말이 되는가 */
export function validateRhythm(r: ActivityRhythm): string | null {
  if (r.activeHours.length === 0) return 'activeHours 가 비어 있다'
  for (const [a, b] of r.activeHours) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) return `시각이 정수가 아니다: [${a},${b}]`
    if (a < 0 || b > 24) return `0~24 범위를 벗어난다: [${a},${b}]`
    if (a >= b) return `시작이 끝보다 크거나 같다: [${a},${b}]`
  }
  // 🔴 구간이 겹치면 "언제 활동하나" 에 두 답이 생긴다
  const sorted = [...r.activeHours].sort((x, y) => x[0] - y[0])
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]![0] < sorted[i - 1]![1]) return `구간이 겹친다: ${JSON.stringify(sorted)}`
  }
  for (const [k, v] of [['weekdayBias', r.weekdayBias], ['burstiness', r.burstiness]] as const) {
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) return `${k} 는 0~1 이어야 한다: ${v}`
  }
  return null
}

export function validateProfile(p: VoiceProfile): string | null {
  // 아키텍처 §5 — 페르소나당 5~8개
  if (p.voiceVariations.length < 5 || p.voiceVariations.length > 8) {
    return `voiceVariations ${p.voiceVariations.length}개 — 5~8개여야 한다 (아키텍처 §5)`
  }
  if (new Set(p.voiceVariations).size !== p.voiceVariations.length) return 'voiceVariations 에 중복이 있다'
  if (p.voiceVariations.some((v) => v.trim() === '')) return 'voiceVariations 에 빈 문자열이 있다'
  // 🔴 빈 문자열 noGo 는 모든 글에 걸린다
  for (const [k, arr] of [['noGoTopics', p.noGoTopics], ['noGoExpressions', p.noGoExpressions]] as const) {
    if (arr.some((v) => v.trim() === '')) return `${k} 에 빈 문자열이 있다 — 모든 글에 걸린다`
  }
  if (p.noGoTopics.length === 0) return 'noGoTopics 가 비어 있다 — 카드에 있는 값을 옮기지 않았다'
  const badRole = p.forbiddenReactionRoles.filter((r) => !REACTION_ROLES.includes(r))
  if (badRole.length > 0) return `알 수 없는 반응 역할: ${badRole.join(' · ')}`
  return validateRhythm(p.activityRhythm)
}

export type UpdatePlan = {
  apply: { code: string; profile: VoiceProfile }[]
  issues: PlanIssue[]
}

/**
 * 🔴 하나라도 문제가 있으면 부르는 쪽이 **아무것도 쓰지 않는다.**
 *    4명 중 3명만 반영되면 어느 셋이 맞는지 나중에 아무도 모른다.
 */
export function planUpdate(rows: readonly PersonaRow[]): UpdatePlan {
  const issues: PlanIssue[] = []
  const apply: UpdatePlan['apply'] = []
  const found = new Set(rows.map((r) => r.code))

  for (const code of TARGET_CODES) {
    if (!found.has(code)) issues.push({ code, reason: 'DB 에서 찾지 못했다' })
  }
  // 🔴 P05 를 비롯해 대상 밖 페르소나는 건드리지 않는다
  for (const r of rows) {
    if (!TARGET_CODES.includes(r.code)) issues.push({ code: r.code, reason: '🔴 대상 목록에 없는 페르소나다' })
  }

  for (const profile of PLANNED) {
    const row = rows.find((r) => r.code === profile.code)
    if (row === undefined) continue
    // 🔴 실회원 계정이면 손대지 않는다
    if (row.providerId !== null) { issues.push({ code: profile.code, reason: '🔴 실회원 User 다' }); continue }
    const err = validateProfile(profile)
    if (err !== null) { issues.push({ code: profile.code, reason: err }); continue }
    apply.push({ code: profile.code, profile })
  }
  return { apply, issues }
}

/**
 * 🔴 저장 직전 실측 방어 — 건드리면 안 되는 것이 data 에 섞이지 않았는가.
 *
 * 🔴 noGoTopics 가 여기 있는 이유는 다르다. 위험해서가 아니라 **아직 형식이 정해지지 않아서**다.
 *    카드의 noGo 는 행동 서술("병원·약 언급")이지 매칭할 문자열이 아니다 —
 *    실측: 초안에 `병원` 은 2/7 건 있지만 `"병원·약 언급"` 은 0/7 건이다.
 *    넣으면 NOGO_TOPIC 가드가 **작동하지 않는데 작동하는 것처럼 보인다.** 그게 비어 있는 것보다 위험하다.
 *    낱말 목록으로 갈지 생성 프롬프트 제약으로만 쓸지 정해진 뒤에 여기서 뺀다.
 */
export const FORBIDDEN_WRITE_KEYS: readonly string[] = [
  'status', 'activatedAt', 'pausedAt', 'retiredAt',
  'identity', 'dailyCap', 'weeklyCap', 'silenceRate', 'userId', 'code', 'voiceCore',
  'noGoTopics',
]

export function assertSafeWrite(data: Record<string, unknown>): void {
  for (const key of FORBIDDEN_WRITE_KEYS) {
    if (key in data) {
      throw new Error(
        `쓰기 대상에 ${key} 가 있다. 이 스크립트는 말투 변주 · 활동 리듬 · noGo 만 다룬다 —\n` +
          '  활성화 · identity · cap 은 각각 별도 승인 대상이다.',
      )
    }
  }
}

/** noGo 문자열이 글에 걸리는가 — 🔴 부분 문자열 일치다 */
export function nogoHits(text: string, topics: readonly string[]): string[] {
  return topics.filter((t) => t.trim() !== '' && text.includes(t))
}

// ─────────────────────────────────────────────────────────
// 실행부 — 🔴 직접 부를 때만 돈다 (fixture 가 import 해도 DB 를 열지 않는다)
// ─────────────────────────────────────────────────────────

const brief = (v: readonly string[]): string => (v.length === 0 ? '[]' : v.join(' · '))

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const APPLY = argv.includes('--apply')
  const NOGO_SCAN = argv.includes('--nogo-scan')
  const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
  const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

  await loadEnvLocal()
  const prisma = new PrismaClient()

  // ── noGo 오탐 실측 — 🔴 읽기만 한다 ──
  if (NOGO_SCAN) {
    console.log('\n══ noGo 오탐 실측 (읽기 전용) ══\n')
    const drafts = await prisma.originalPostApprovalQueue.findMany({
      where: { status: { in: ['APPROVED', 'EDITED'] } },
      select: { id: true, draftTitle: true, draftBody: true, editedTitle: true, editedBody: true },
      orderBy: { createdAt: 'asc' },
    })
    let total = 0
    for (const prof of PLANNED) {
      const hitDrafts = drafts.filter((d) =>
        nogoHits(`${d.editedTitle ?? d.draftTitle}\n${d.editedBody ?? d.draftBody}`, prof.noGoTopics).length > 0)
      total += hitDrafts.length
      console.log(`  ${prof.code}  noGo ${prof.noGoTopics.length}종  →  ${hitDrafts.length}/${drafts.length}건 걸림`)
      for (const d of hitDrafts) {
        const hits = nogoHits(`${d.editedTitle ?? d.draftTitle}\n${d.editedBody ?? d.draftBody}`, prof.noGoTopics)
        console.log(`      ⚠️ ${d.id.slice(0, 10)}…  ${hits.join(' · ')}`)
      }
    }
    console.log(`\n  총 ${total}건 (초안 ${drafts.length}건 × 페르소나 ${PLANNED.length}명 = ${drafts.length * PLANNED.length} 조합)`)
    console.log('  🔴 DB write 0\n')
    await prisma.$disconnect()
    return
  }

  console.log(APPLY ? '\n══ 🔴 실제 반영 (--apply) ══\n' : '\n══ dry-run (DB write 0) ══\n')
  console.log(`  대상  ${TARGET_CODES.join(' · ')}   (제외 ${EXCLUDED_CODES.join(' · ')})`)
  console.log('  🔴 status 를 바꾸지 않습니다 · 활성화하지 않습니다 · identity 를 건드리지 않습니다')
  console.log('  🟡 noGoTopics 는 보류입니다 — 카드 값만 보관하고 DB 에 쓰지 않습니다 (--nogo-scan 참조)\n')

  const rows = await prisma.persona.findMany({
    select: {
      code: true, status: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      user: { select: { providerId: true } },
    },
    orderBy: { code: 'asc' },
  })
  // 🔴 대상 4명만 계획에 넣는다. P05 는 목록 밖이라 issue 가 되므로 미리 거른다
  const targets: PersonaRow[] = rows
    .filter((r) => TARGET_CODES.includes(r.code))
    .map((r) => ({ code: r.code, status: r.status, providerId: r.user?.providerId ?? null }))

  const plan = planUpdate(targets)

  for (const a of plan.apply) {
    const cur = rows.find((r) => r.code === a.code)!
    const curVar = Array.isArray(cur.voiceVariations) ? (cur.voiceVariations as unknown[]).length : null
    console.log(`  ✅ ${a.code}  status=${cur.status}(불변)`)
    console.log(`       voiceVariations  ${curVar === null ? '🔴 null' : `${curVar}개`}  →  ${a.profile.voiceVariations.length}개  [${brief(a.profile.voiceVariations)}]`)
    console.log(`       activityRhythm   ${cur.activityRhythm === null ? '🔴 null' : '있음'}  →  ${JSON.stringify(a.profile.activityRhythm.activeHours)} w${a.profile.activityRhythm.weekdayBias} b${a.profile.activityRhythm.burstiness}`)
    console.log(`       noGoTopics       ${cur.noGoTopics.length}종  →  🟡 보류 (쓰지 않음) · 카드 ${a.profile.noGoTopics.length}종 보관`)
    console.log(`       noGoExpressions  ${cur.noGoExpressions.length}종  →  ${a.profile.noGoExpressions.length}종  [${brief(a.profile.noGoExpressions)}]`)
    console.log(`       forbiddenRoles   ${cur.forbiddenReactionRoles.length}종  →  ${a.profile.forbiddenReactionRoles.length}종  [${brief(a.profile.forbiddenReactionRoles)}]`)
  }

  if (plan.issues.length > 0) {
    console.log('\n  🔴 문제')
    for (const i of plan.issues) console.log(`     · ${i.code}  ${i.reason}`)
    await prisma.$disconnect()
    fail(`문제 ${plan.issues.length}건 — 아무것도 쓰지 않았습니다.`)
  }

  console.log(`\n  반영 예정 ${plan.apply.length}건 · 4필드 (voiceVariations · activityRhythm · noGoExpressions · forbiddenReactionRoles)`)

  if (!APPLY) {
    await prisma.$disconnect()
    console.log('\n🟡 dry-run 입니다. DB write 0 · 반영하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
    return
  }

  const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
  if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
    await prisma.$disconnect(); fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
  }
  if (LIMIT !== plan.apply.length) {
    await prisma.$disconnect(); fail(`--limit ${LIMIT} 이 대상 ${plan.apply.length} 과 다릅니다. 잘라내지 않고 멈춥니다.`)
  }

  console.log(`\n══ 반영 ${plan.apply.length}건 ══`)
  let done = 0
  for (const a of plan.apply) {
    const before = rows.find((r) => r.code === a.code)!
    // 🔴 저장 직전 한 번 더 본다. status · identity · noGoTopics 가 섞이면 여기서 던진다
    const data: Record<string, unknown> = {
      voiceVariations: a.profile.voiceVariations,
      activityRhythm: a.profile.activityRhythm,
      noGoExpressions: a.profile.noGoExpressions,
      forbiddenReactionRoles: a.profile.forbiddenReactionRoles,
    }
    assertSafeWrite(data)
    await prisma.persona.update({
      where: { code: a.code },
      data: {
        voiceVariations: a.profile.voiceVariations as unknown as Prisma.InputJsonValue,
        activityRhythm: a.profile.activityRhythm as unknown as Prisma.InputJsonValue,
        noGoExpressions: a.profile.noGoExpressions,
        forbiddenReactionRoles: a.profile.forbiddenReactionRoles,
      },
    })

    // 🔴 read-back
    const after = await prisma.persona.findUniqueOrThrow({
      where: { code: a.code },
      select: {
        status: true, identity: true, dailyCap: true, weeklyCap: true,
        voiceVariations: true, activityRhythm: true,
        noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      },
    })
    const problems: string[] = []
    const gotVar = after.voiceVariations
    if (!Array.isArray(gotVar) || gotVar.length !== a.profile.voiceVariations.length) problems.push('voiceVariations 불일치')
    if (after.activityRhythm === null) problems.push('activityRhythm 이 비었다')
    if (after.noGoExpressions.length !== a.profile.noGoExpressions.length) problems.push('noGoExpressions 불일치')
    if (after.forbiddenReactionRoles.length !== a.profile.forbiddenReactionRoles.length) problems.push('forbiddenRoles 불일치')
    // 🔴 건드리면 안 되는 것이 그대로인가
    if (after.status !== before.status) problems.push(`🔴 status 가 바뀌었다: ${before.status} → ${after.status}`)
    if (after.identity === null) problems.push('🔴 identity 가 사라졌다')
    // 🔴 noGoTopics 는 쓰지 않았으니 그대로여야 한다. 늘어났으면 어딘가에서 샌 것이다
    if (after.noGoTopics.length !== before.noGoTopics.length) {
      problems.push(`🔴 noGoTopics 가 변했다: ${before.noGoTopics.length} → ${after.noGoTopics.length}`)
    }

    if (problems.length > 0) { console.log(`  🔴 ${a.code} — ${problems.join(' · ')}`); continue }
    done += 1
    console.log(`  ✅ ${a.code}  변주 ${a.profile.voiceVariations.length} · 표현 ${a.profile.noGoExpressions.length} · 금지역할 ${a.profile.forbiddenReactionRoles.length}  status=${after.status}(불변) · noGoTopics ${after.noGoTopics.length}종(보류)`)
  }

  await prisma.$disconnect()
  console.log(`\n  반영 ${done} / ${plan.apply.length}건`)
  console.log('  🔴 status 는 그대로입니다. 활성화는 별도 승인 대상입니다.\n')
  if (done !== plan.apply.length) process.exit(1)
}

// 🔴 fixture 가 import 해도 DB 를 열지 않는다
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
