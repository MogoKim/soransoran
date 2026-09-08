#!/usr/bin/env tsx
/**
 * Persona.identity.childrenAgeBands 반영 — 자녀 나이대만 다룬다
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §5 ·
 *       docs/operations/2026-08-30-persona-architecture-design.md §9
 *
 * 🔴 **왜 이 값이 필요한가**
 *    "과거에 30살 딸이 있다고 한 페르소나가 고3 딸 이야기를 쓰면 안 된다."
 *    매칭기(original-post-persona-match)가 이 값이 없으면 `CHILD_AGE_UNKNOWN` 으로 **막는다** —
 *    모르는 것을 통과시키지 않기 때문이다. 이 스크립트가 그 '모름' 을 없앤다.
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *      · status 전환 (draft → active) — 활성화는 그 페르소나가 실제로 글을 쓸 수 있게 되는 문이다.
 *        `PersonaAuditLog` · `PersonaGlobalSwitch`(kill switch) 확인이 선행되어야 하고,
 *        그건 이 스크립트의 일이 아니다. **status 를 data 에 넣지 않는다.**
 *      · Post 생성 · 발행 · migration · LLM 호출 · 크롤
 *      · identity 의 다른 필드 수정 — **덮어쓰지 않고 얹는다**
 *
 * 🔴 **write 대상은 Persona.identity 한 필드뿐이다.**
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=N` 이 **둘 다** 있어야 하고,
 *    `--limit` 은 대상 수와 **정확히 같아야** 한다.
 *
 * 🔴 **`[]` 와 미기재는 다르다.**
 *    `[]` = "무자녀임을 안다" · 미기재 = "모른다". P15 는 전자다 —
 *    빈 배열을 저장하지 않고 키를 빼면 매칭기가 계속 '모름' 으로 읽는다.
 *
 * 사용법
 *   npx tsx scripts/persona-children-age-bands.mts
 *       → dry-run. 계획만. DB write 0
 *   npx tsx scripts/persona-children-age-bands.mts --apply --limit=5
 *       → 🔴 실제 반영
 */

import { judgeRealMember } from '../src/lib/real-member-gate'
import { PrismaClient, type Prisma } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { isChildAgeBand, CHILD_AGE_BANDS, type ChildAgeBand } from '../src/lib/original-post-persona-match'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

// ─────────────────────────────────────────────────────────
// 확정값 — 🔴 창업자 결정 (2026-09-02)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 지어내지 않는다. 창업자가 정한 값만 여기 있다.
 *    값이 없는 페르소나를 이 목록에 임의로 넣지 마라 —
 *    아무도 정하지 않은 정체성이 코드에 굳는 순간 되돌리기 어렵다.
 */
export const PLANNED: readonly { code: string; bands: ChildAgeBand[] }[] = [
  { code: 'P05', bands: ['중고등', '대학·취준'] },
  { code: 'P07', bands: ['대학·취준'] },
  { code: 'P10', bands: ['성인'] },
  { code: 'P15', bands: [] },
  { code: 'P17', bands: ['성인', '성인'] },
]

export const TARGET_CODES: readonly string[] = PLANNED.map((p) => p.code)

// ─────────────────────────────────────────────────────────
// 순수 함수 — 🔴 DB 없이 fixture 가 전수 확인한다
// ─────────────────────────────────────────────────────────

export type IdentityLike = Record<string, unknown>

export type PlanIssue = { code: string; reason: string }

/** 🔴 밴드 목록이 허용값인가 */
export function validateBands(bands: readonly unknown[]): string | null {
  const bad = bands.filter((b) => !isChildAgeBand(b))
  if (bad.length > 0) return `알 수 없는 밴드: ${bad.map(String).join(' · ')} (허용 ${CHILD_AGE_BANDS.join(' · ')})`
  return null
}

/**
 * 🔴 자녀 수와 밴드 개수가 맞는가.
 *
 *    자녀가 둘인데 밴드가 하나면 나머지 한 명의 나이를 모르는 것이고,
 *    그 상태로 저장하면 매칭기는 "안다" 고 읽는다 — 모름이 앎으로 둔갑한다.
 *    0명 / [] 는 일치이므로 통과한다(P15).
 */
export function validateCount(childrenCount: number | null | undefined, bands: readonly unknown[]): string | null {
  const n = childrenCount ?? 0
  if (n !== bands.length) return `childrenCount=${n} 인데 밴드 ${bands.length}개 — 일치해야 한다`
  return null
}

/**
 * 🔴 기존 identity 를 보존한다. childrenAgeBands 만 얹는다.
 *    통째로 새 객체를 쓰면 coreWound · warmPoint 같은 값이 조용히 사라진다.
 */
export function mergeIdentity(existing: IdentityLike | null | undefined, bands: readonly ChildAgeBand[]): IdentityLike {
  return { ...(existing ?? {}), childrenAgeBands: [...bands] }
}

export type PersonaRow = {
  code: string
  status: string
  identity: IdentityLike | null
  providerId: string | null
  /** 🔴 실회원 판별 정본 — Account 행 수. 모르면 막는다 */
  accountCount: number | null
}

export type UpdatePlan = {
  apply: { code: string; before: readonly string[] | null; after: ChildAgeBand[]; nextIdentity: IdentityLike }[]
  issues: PlanIssue[]
}

/**
 * 무엇을 쓸지 정한다.
 *
 * 🔴 하나라도 문제가 있으면 부르는 쪽이 **아무것도 쓰지 않는다.**
 *    5명 중 4명만 반영되면 매칭 결과가 절반만 맞는 상태가 되고,
 *    그게 어느 절반인지 나중에 아무도 모른다.
 */
export function planUpdate(rows: readonly PersonaRow[]): UpdatePlan {
  const issues: PlanIssue[] = []
  const apply: UpdatePlan['apply'] = []

  // 🔴 대상 코드가 정확히 일치해야 한다. 모르는 페르소나를 건드리지 않는다
  const found = new Set(rows.map((r) => r.code))
  for (const code of TARGET_CODES) {
    if (!found.has(code)) issues.push({ code, reason: 'DB 에서 찾지 못했다' })
  }
  for (const r of rows) {
    if (!TARGET_CODES.includes(r.code)) issues.push({ code: r.code, reason: '🔴 대상 목록에 없는 페르소나다' })
  }

  for (const plan of PLANNED) {
    const row = rows.find((r) => r.code === plan.code)
    if (row === undefined) continue

    // 🔴 실회원 계정이면 손대지 않는다
    // 🔴 판정은 `judgeRealMember` 하나뿐이다 — 정본은 Account 다
    const real = judgeRealMember({ accountCount: row.accountCount, providerId: row.providerId })
    if (real.real) { issues.push({ code: plan.code, reason: `🔴 쓸 수 없는 User — ${real.reason}` }); continue }

    const bandErr = validateBands(plan.bands)
    if (bandErr !== null) { issues.push({ code: plan.code, reason: bandErr }); continue }

    const identity = row.identity ?? {}
    const countErr = validateCount(
      typeof identity.childrenCount === 'number' ? identity.childrenCount : null,
      plan.bands,
    )
    if (countErr !== null) { issues.push({ code: plan.code, reason: countErr }); continue }

    const before = Array.isArray(identity.childrenAgeBands)
      ? (identity.childrenAgeBands as unknown[]).map(String)
      : null
    apply.push({ code: plan.code, before, after: [...plan.bands], nextIdentity: mergeIdentity(identity, plan.bands) })
  }

  return { apply, issues }
}

/** 🔴 저장 직전 실측 방어 — status 가 data 에 섞이지 않았는가 */
export function assertNoStatusWrite(data: Record<string, unknown>): void {
  for (const key of ['status', 'activatedAt', 'pausedAt', 'retiredAt']) {
    if (key in data) {
      throw new Error(
        `쓰기 대상에 ${key} 가 있다. 이 스크립트는 자녀 나이대만 다룬다 —\n` +
          '  활성화는 PersonaAuditLog · PersonaGlobalSwitch 확인이 선행되어야 하는 별도 작업이다.',
      )
    }
  }
}

// ─────────────────────────────────────────────────────────
// 실행부 — 🔴 직접 부를 때만 돈다 (fixture 가 import 해도 DB 를 열지 않는다)
// ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const APPLY = argv.includes('--apply')
  const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
  const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

  await loadEnvLocal()
  const prisma = new PrismaClient()

  console.log(APPLY ? '\n══ 🔴 실제 반영 (--apply) ══\n' : '\n══ dry-run (DB write 0) ══\n')
  console.log(`  대상  ${TARGET_CODES.join(' · ')}`)
  console.log('  🔴 status 를 바꾸지 않습니다 · Post 를 만들지 않습니다 · 발행하지 않습니다\n')

  const rows = await prisma.persona.findMany({
    select: { code: true, status: true, identity: true, user: { select: { providerId: true, _count: { select: { accounts: true } } } } },
    orderBy: { code: 'asc' },
  })
  const mapped: PersonaRow[] = rows.map((r) => ({
    code: r.code,
    status: r.status,
    identity: (r.identity ?? null) as IdentityLike | null,
    providerId: r.user?.providerId ?? null,
    accountCount: r.user?._count.accounts ?? null,
  }))

  const plan = planUpdate(mapped)

  for (const a of plan.apply) {
    const row = mapped.find((r) => r.code === a.code)!
    const kids = (row.identity ?? {}).childrenCount
    const beforeTxt = a.before === null ? '🔴 미기재' : a.before.length === 0 ? '[]' : a.before.join('·')
    const afterTxt = a.after.length === 0 ? '[] (무자녀를 앎)' : a.after.join('·')
    console.log(`  ✅ ${a.code}  status=${row.status}(불변)  자녀 ${kids ?? '—'}명`)
    console.log(`       ${beforeTxt}  →  ${afterTxt}`)
    // 🔴 다른 필드가 사라지지 않는지 눈으로도 본다
    const keptKeys = Object.keys(row.identity ?? {}).filter((k) => k !== 'childrenAgeBands')
    const lost = keptKeys.filter((k) => !(k in a.nextIdentity))
    console.log(`       identity 보존 ${keptKeys.length}개${lost.length === 0 ? '' : ` · 🔴 유실 ${lost.join(',')}`}`)
  }

  if (plan.issues.length > 0) {
    console.log('\n  🔴 문제')
    for (const i of plan.issues) console.log(`     · ${i.code}  ${i.reason}`)
    await prisma.$disconnect()
    fail(`문제 ${plan.issues.length}건 — 아무것도 쓰지 않았습니다. 일부만 반영하면 어느 절반이 맞는지 모르게 됩니다.`)
  }

  console.log(`\n  반영 예정 ${plan.apply.length}건`)

  if (!APPLY) {
    await prisma.$disconnect()
    console.log('\n🟡 dry-run 입니다. DB write 0 · 반영하려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
    return
  }

  const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
  if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
    await prisma.$disconnect(); fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
  }
  // 🔴 개수가 어긋나면 목록이 의도와 다른 것이다. 잘라내지 않고 멈춘다
  if (LIMIT !== plan.apply.length) {
    await prisma.$disconnect(); fail(`--limit ${LIMIT} 이 대상 ${plan.apply.length} 과 다릅니다. 잘라내지 않고 멈춥니다.`)
  }

  console.log(`\n══ 반영 ${plan.apply.length}건 ══`)
  let done = 0
  for (const a of plan.apply) {
    // 🔴 저장 직전 한 번 더 본다. status 가 섞이면 여기서 던진다
    const data: Record<string, unknown> = { identity: a.nextIdentity }
    assertNoStatusWrite(data)
    // 🔴 Json 컬럼이라 캐스트가 필요하다. 캐스트는 **assert 뒤**에 온다 —
    //    먼저 캐스트하면 방어가 타입에 가려 무력해진다
    await prisma.persona.update({
      where: { code: a.code },
      data: { identity: a.nextIdentity as Prisma.InputJsonValue },
    })

    // 🔴 read-back — 쓴 대로 들어갔는지 다시 본다
    const after = await prisma.persona.findUniqueOrThrow({
      where: { code: a.code },
      select: { status: true, identity: true },
    })
    const ai = (after.identity ?? {}) as IdentityLike
    const problems: string[] = []
    const got = ai.childrenAgeBands
    if (!Array.isArray(got)) problems.push('childrenAgeBands 가 배열이 아니다')
    else if (got.length !== a.after.length || !a.after.every((b, i) => got[i] === b)) {
      problems.push(`값 불일치: ${got.map(String).join('·')}`)
    }
    const row = mapped.find((r) => r.code === a.code)!
    for (const k of Object.keys(row.identity ?? {})) {
      if (k !== 'childrenAgeBands' && !(k in ai)) problems.push(`🔴 ${k} 가 사라졌다`)
    }
    if (after.status !== row.status) problems.push(`🔴 status 가 바뀌었다: ${row.status} → ${after.status}`)

    if (problems.length > 0) { console.log(`  🔴 ${a.code} — ${problems.join(' · ')}`); continue }
    done += 1
    console.log(`  ✅ ${a.code}  [${a.after.join('·') || '(무자녀)'}]  status=${after.status}(불변)`)
  }

  await prisma.$disconnect()
  console.log(`\n  반영 ${done} / ${plan.apply.length}건`)
  console.log('  🔴 status 는 그대로입니다. 활성화는 별도 작업입니다.\n')
  if (done !== plan.apply.length) process.exit(1)
}

// 🔴 fixture 가 import 해도 DB 를 열지 않는다
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
