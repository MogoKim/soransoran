#!/usr/bin/env tsx
/**
 * P07 · P10 · P15 · P17 을 draft → active — 🔴 기본은 dry-run
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md §5 · §7-2 ·
 *       docs/operations/2026-09-02-original-post-lane-strategy.md §4
 *
 * 🔴 **왜 P05 스크립트를 재사용하지 않는가**
 *    persona-activate-p05.mts 는 `TARGET_CODE = 'P05'` 로 못박혀 있고, 그 주석이 이유를 적어 뒀다 —
 *    *"인자로 code 를 받으면 그때그때 다른 페르소나를 켜는 도구가 된다."*
 *    그 의도를 지키려면 인자를 받게 고칠 것이 아니라 **대상을 다시 못박은 스크립트를 따로 만들어야** 한다.
 *    이 파일도 같다. 🔴 인자로 code 를 받지 않는다.
 *
 * 🔴 **왜 지금 네 명인가**
 *    매칭 차단 사유 집계에서 `NOT_ACTIVE` 가 28회다. active 가 P05 하나뿐이라
 *    승인 7건이 전부 한 사람에게 간다 — 헌법 §12 M4 가 반대하는
 *    *"같은 작성자의 글이 반복 노출된다"* 가 계정 이름만 페르소나로 바뀐 채 재현된다.
 *
 * 🔴 **켠다고 말이 나가지 않는다.** 3층 분리(§7-2)의 요점이다.
 *      전체 kill switch  모든 페르소나를 한 번에
 *      status            그 페르소나만          ← 이 스크립트가 만지는 층
 *      dailyCap          그날만
 *    이 스크립트는 가운데 층 하나만 만진다. 발행은 여전히 사람이 따로 부른다.
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *      · 발행 · Post 생성 · Queue 변경
 *      · cap 설정 — dailyCap · weeklyCap 을 건드리지 않는다
 *      · kill switch 조작 — 다른 층이다. 읽기만 한다
 *      · identity · voiceCore · voiceVariations · activityRhythm · noGo* · userId 수정
 *      · migration · LLM · 크롤
 *
 * 🔴 **write 는 두 곳뿐이고 한 트랜잭션이다.**
 *      Persona          status: draft → active · activatedAt
 *      PersonaAuditLog  action: status_changed (누가 · 언제 · 왜)
 *    감사 로그 없이 상태만 바꾸지 않는다. "왜 켰나" 가 없으면 되돌릴 근거가 사라진다.
 *
 * 🔴 dry-run 이 기본이다. 실제 write 는 `--apply` **와** `--limit=N` 이 **둘 다** 있어야 하고,
 *    `--limit` 은 켤 대상 수와 **정확히 같아야** 한다.
 *
 * 사용법
 *   npx tsx scripts/persona-activate.mts                                   dry-run
 *   ACTOR_USER_ID=<id> npx tsx scripts/persona-activate.mts --apply --limit=4 --reason "오리지널 글 분산"
 *   npx tsx scripts/persona-activate.mts --check                           현재 상태 대조
 *
 * 🔴 ACTOR_USER_ID 는 환경변수로 받는다. 셸 히스토리에 남기지 않기 위해서다.
 *
 * 종료 코드: 조건 미충족이거나 --check 실패면 1
 */
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

// ─────────────────────────────────────────────────────────
// 대상 — 🔴 코드에 못박는다. 인자로 받지 않는다
// ─────────────────────────────────────────────────────────

export const TARGET_CODES: readonly string[] = ['P07', 'P10', 'P15', 'P17']

/** 🔴 P05 는 이미 active 다. 이 스크립트의 대상이 아니다 */
export const EXCLUDED_CODES: readonly string[] = ['P05']

/** 🔴 켤 수 있는 출발 상태는 draft 뿐이다 */
export const ACTIVATABLE_FROM = 'draft'

// ─────────────────────────────────────────────────────────
// 순수 함수 — 🔴 DB 없이 fixture 가 전수 확인한다
// ─────────────────────────────────────────────────────────

export type PersonaRow = {
  code: string
  status: string
  dailyCap: number | null
  weeklyCap: number | null
}

/** 한 명을 어떻게 할 것인가 */
export type Verdict =
  /** 켠다 */
  | { kind: 'ACTIVATE' }
  /** 이미 켜져 있다 — 🔴 건드리지 않는다 */
  | { kind: 'ALREADY_ACTIVE' }
  /** 켤 수 없다 */
  | { kind: 'BLOCKED'; reason: string }

/**
 * 🔴 `retired → active` 는 막는다 (§5).
 *    은퇴한 이름이 다시 나타나면 회원이 혼동한다. 되살리려면 새 code 로 새로 만든다.
 *
 * 🔴 `paused` 도 막는다. 왜 멈췄는지를 모르는 채 되켜면 멈춘 이유가 사라진다 —
 *    되돌리기가 필요하면 그건 별도 판단이지 이 스크립트가 아니다.
 *
 * 🔴 이미 active 면 **아무것도 하지 않는다.** 임의로 다시 쓰면 activatedAt 이 덮어써져
 *    "언제 켰나" 가 사라진다.
 */
export function judge(row: PersonaRow): Verdict {
  if (!TARGET_CODES.includes(row.code)) {
    return { kind: 'BLOCKED', reason: '🔴 대상 목록에 없는 페르소나다' }
  }
  if (row.status === 'active') return { kind: 'ALREADY_ACTIVE' }
  if (row.status === 'retired') {
    return { kind: 'BLOCKED', reason: '🔴 retired → active 는 막는다 — 새 code 로 새로 만든다' }
  }
  if (row.status !== ACTIVATABLE_FROM) {
    return { kind: 'BLOCKED', reason: `status=${row.status} — ${ACTIVATABLE_FROM} 에서만 켠다` }
  }
  return { kind: 'ACTIVATE' }
}

export type ActivationPlan = {
  activate: PersonaRow[]
  alreadyActive: PersonaRow[]
  blocked: { code: string; reason: string }[]
  /** 🔴 cap 이 비면 켜도 발행되지 않는다. 막지는 않되 알린다 */
  capWarnings: string[]
}

export function planActivation(rows: readonly PersonaRow[]): ActivationPlan {
  const plan: ActivationPlan = { activate: [], alreadyActive: [], blocked: [], capWarnings: [] }
  const found = new Set(rows.map((r) => r.code))
  for (const code of TARGET_CODES) {
    if (!found.has(code)) plan.blocked.push({ code, reason: 'DB 에서 찾지 못했다' })
  }
  for (const row of rows) {
    const v = judge(row)
    if (v.kind === 'BLOCKED') { plan.blocked.push({ code: row.code, reason: v.reason }); continue }
    if (v.kind === 'ALREADY_ACTIVE') { plan.alreadyActive.push(row); continue }
    // 🔴 cap 이 없어도 켜는 것 자체는 막지 않는다 — 3층이 서로 다른 층이기 때문이다.
    //    다만 "켰는데 말이 안 나간다" 를 모르고 넘어가지 않게 알린다
    if (row.dailyCap === null || row.weeklyCap === null) {
      plan.capWarnings.push(`${row.code} — cap 미설정 (켜도 발행은 막힌다)`)
    }
    plan.activate.push(row)
  }
  return plan
}

/**
 * 🔴 kill switch 는 **행이 없으면 중지 꺼짐**이다 (schema 주석).
 *    `default false` 인 이유가 "만들자마자 전체가 멈추면 안 된다" 이고,
 *    운영 시작 시 행을 만든다. 0행을 이상 상태로 읽으면 정상 운영을 막는다.
 */
export function isKillSwitchOn(row: { enabled: boolean } | null): boolean {
  return row?.enabled === true
}

/** 🔴 저장 직전 실측 방어 — 켜는 것 말고 다른 것이 data 에 섞이지 않았는가 */
export const FORBIDDEN_WRITE_KEYS: readonly string[] = [
  'identity', 'voiceCore', 'voiceVariations', 'activityRhythm',
  'noGoTopics', 'noGoExpressions', 'forbiddenReactionRoles',
  'dailyCap', 'weeklyCap', 'silenceRate', 'userId', 'code',
  'pausedAt', 'retiredAt',
]

/** 🔴 켤 때 쓰는 것은 이 둘뿐이다 */
export const ALLOWED_WRITE_KEYS: readonly string[] = ['status', 'activatedAt']

export function assertActivationWrite(data: Record<string, unknown>): void {
  for (const key of FORBIDDEN_WRITE_KEYS) {
    if (key in data) {
      throw new Error(
        `쓰기 대상에 ${key} 가 있다. 이 스크립트는 status 층 하나만 만진다 —\n` +
          '  cap · identity · 말투는 각각 별도 작업이고, 켜는 것과 말하는 것은 다른 층이다(§7-2).',
      )
    }
  }
  for (const key of Object.keys(data)) {
    if (!ALLOWED_WRITE_KEYS.includes(key)) {
      throw new Error(`쓰기 대상에 허용되지 않은 필드가 있다: ${key} (허용 ${ALLOWED_WRITE_KEYS.join(' · ')})`)
    }
  }
}

// ─────────────────────────────────────────────────────────
// 실행부 — 🔴 직접 부를 때만 돈다 (fixture 가 import 해도 DB 를 열지 않는다)
// ─────────────────────────────────────────────────────────

const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const APPLY = argv.includes('--apply')
  const CHECK = argv.includes('--check')
  const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    if (i !== -1 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) return argv[i + 1]
    const eq = argv.find((a) => a.startsWith(`--${k}=`))
    return eq === undefined ? undefined : eq.slice(k.length + 3)
  }
  const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

  await loadEnvLocal()
  const prisma = new PrismaClient()

  console.log(`\n══ ${CHECK ? '검증 (--check)' : APPLY ? '🔴 적용 (--apply)' : 'dry-run (DB write 0)'} ══\n`)
  console.log(`  대상  ${TARGET_CODES.join(' · ')}   (제외 ${EXCLUDED_CODES.join(' · ')})`)
  console.log('  🔴 cap · identity · 말투를 바꾸지 않습니다 · 발행하지 않습니다 · kill switch 를 건드리지 않습니다\n')

  // ── kill switch — 🔴 읽기만 한다 ──
  const sw = await prisma.personaGlobalSwitch.findUnique({
    where: { id: 'global' },
    select: { enabled: true, reason: true },
  })
  const killed = isKillSwitchOn(sw)
  console.log(`  전체 중지(kill switch)  ${killed ? `🔴 켜짐 — ${sw?.reason ?? '사유 없음'}` : `꺼짐${sw === null ? ' (행 없음 = 기본 상태)' : ''}`}`)

  const rows = await prisma.persona.findMany({
    where: { code: { in: [...TARGET_CODES] } },
    select: { id: true, code: true, status: true, dailyCap: true, weeklyCap: true, activatedAt: true },
    orderBy: { code: 'asc' },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const plan = planActivation(rows.map((r) => ({
    code: r.code, status: r.status, dailyCap: r.dailyCap, weeklyCap: r.weeklyCap,
  })))

  // ── --check — 현재 상태 대조 ──
  if (CHECK) {
    const notActive = rows.filter((r) => r.status !== 'active')
    await prisma.$disconnect()
    for (const r of rows) console.log(`  ${r.code}  ${r.status}`)
    console.log(notActive.length === 0 ? '\n✅ 4명 전부 active 입니다\n' : `\n🔴 아직 ${notActive.map((r) => `${r.code}=${r.status}`).join(' · ')}\n`)
    process.exit(notActive.length === 0 ? 0 : 1)
  }

  console.log('\n  code  현재      →  적용 후    cap        판정')
  for (const code of TARGET_CODES) {
    const r = byCode.get(code)
    if (r === undefined) { console.log(`  ${code}  🔴 없음`); continue }
    const v = judge({ code: r.code, status: r.status, dailyCap: r.dailyCap, weeklyCap: r.weeklyCap })
    const after = v.kind === 'ACTIVATE' ? 'active' : r.status
    const mark = v.kind === 'ACTIVATE' ? '✅ 켠다' : v.kind === 'ALREADY_ACTIVE' ? '🟢 이미 active (불변)' : `⛔ ${v.reason}`
    console.log(
      `  ${code}  ${r.status.padEnd(8)} →  ${after.padEnd(8)} ` +
      `${String(r.dailyCap ?? '—')}/${String(r.weeklyCap ?? '—')}`.padEnd(10) + ` ${mark}`,
    )
  }

  if (plan.capWarnings.length > 0) {
    console.log('\n  🟡 cap 알림 — 켜도 발행은 막힙니다 (켜는 것과 말하는 것은 다른 층입니다)')
    for (const w of plan.capWarnings) console.log(`     · ${w}`)
  }
  if (plan.blocked.length > 0) {
    console.log('\n  🔴 막힘')
    for (const b of plan.blocked) console.log(`     · ${b.code}  ${b.reason}`)
  }

  console.log(`\n  켤 대상 ${plan.activate.length}명 · 이미 active ${plan.alreadyActive.length}명 · 막힘 ${plan.blocked.length}명`)

  // 🔴 하나라도 막히면 아무것도 켜지 않는다. 네 명 중 셋만 켜지면 분산이 반쪽이 된다
  if (plan.blocked.length > 0) {
    await prisma.$disconnect()
    fail(`막힌 대상이 ${plan.blocked.length}명 있습니다 — 아무것도 켜지 않았습니다.`)
  }

  if (!APPLY) {
    await prisma.$disconnect()
    console.log('\n🟡 dry-run 입니다. DB write 0 · 켜려면 --apply 와 --limit=N 을 둘 다 붙이세요.\n')
    return
  }

  // ── 🔴 kill switch 가 켜져 있으면 켜지 않는다 ──
  if (killed) {
    await prisma.$disconnect()
    fail('전체 중지가 켜져 있습니다. 멈춰 있는 동안 새 페르소나를 켜지 않습니다.')
  }

  const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
  if (LIMIT === null || !Number.isInteger(LIMIT) || LIMIT < 1) {
    await prisma.$disconnect(); fail('--apply 에는 --limit=N (1 이상) 이 함께 있어야 합니다')
  }
  if (LIMIT !== plan.activate.length) {
    await prisma.$disconnect()
    fail(`--limit ${LIMIT} 이 켤 대상 ${plan.activate.length} 과 다릅니다. 잘라내지 않고 멈춥니다.`)
  }

  const actorUserId = (process.env.ACTOR_USER_ID ?? '').trim()
  if (actorUserId === '') {
    await prisma.$disconnect()
    fail('ACTOR_USER_ID 환경변수가 필요합니다 — 누가 켰는지가 감사 로그에 남아야 합니다.')
  }
  const reason = (arg('reason') ?? '').trim()
  if (reason === '') {
    await prisma.$disconnect()
    fail('--reason 이 필요합니다 — 왜 켰는지가 없으면 되돌릴 근거가 사라집니다.')
  }

  console.log(`\n══ 적용 ${plan.activate.length}명 (--limit ${LIMIT}) ══`)
  const now = new Date()
  let done = 0
  let failedCount = 0

  for (const t of plan.activate) {
    const row = byCode.get(t.code)!
    // 🔴 저장 직전 한 번 더 본다. cap · identity 가 섞이면 여기서 던진다
    const data: Record<string, unknown> = { status: 'active', activatedAt: now }
    assertActivationWrite(data)

    const changed = await prisma.$transaction(async (tx) => {
      // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 누가 바꿨으면 0건이 되어 아무 일도 없다
      const updated = await tx.persona.updateMany({
        where: { id: row.id, status: ACTIVATABLE_FROM },
        data: { status: 'active', activatedAt: now },
      })
      if (updated.count === 0) return 0
      // 🔴 같은 트랜잭션이다. 상태만 바뀌고 로그가 없는 순간이 생기면 안 된다
      await tx.personaAuditLog.create({
        data: {
          personaId: row.id,
          action: 'status_changed',
          fromStatus: ACTIVATABLE_FROM,
          toStatus: 'active',
          actorUserId,
          reason,
          changedFields: [...ALLOWED_WRITE_KEYS],
        },
      })
      return updated.count
    })

    if (changed === 0) {
      failedCount += 1
      console.log(`  🔴 ${t.code} — 그 사이에 상태가 바뀌었습니다 (0건 갱신)`)
      continue
    }

    // 🔴 read-back — 켜졌는지, 그리고 **다른 것이 안 바뀌었는지**
    const after = await prisma.persona.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        status: true, activatedAt: true, pausedAt: true, retiredAt: true,
        dailyCap: true, weeklyCap: true, identity: true, voiceVariations: true,
      },
    })
    const problems: string[] = []
    if (after.status !== 'active') problems.push(`status=${after.status}`)
    if (after.activatedAt === null) problems.push('activatedAt 이 비었다')
    if (after.pausedAt !== null || after.retiredAt !== null) problems.push('🔴 paused/retired 가 생겼다')
    if (after.dailyCap !== row.dailyCap || after.weeklyCap !== row.weeklyCap) problems.push('🔴 cap 이 바뀌었다')
    if (after.identity === null) problems.push('🔴 identity 가 사라졌다')
    if (after.voiceVariations === null) problems.push('🔴 voiceVariations 가 사라졌다')
    const logs = await prisma.personaAuditLog.count({
      where: { personaId: row.id, action: 'status_changed', createdAt: { gte: now } },
    })
    if (logs !== 1) problems.push(`감사 로그 ${logs}건 (1이어야 한다)`)

    if (problems.length > 0) { failedCount += 1; console.log(`  🔴 ${t.code} — ${problems.join(' · ')}`); continue }
    done += 1
    console.log(`  ✅ ${t.code}  ${mask(row.id)}  draft → active · 감사 로그 1건 · cap ${after.dailyCap}/${after.weeklyCap}(불변)`)
  }

  const all = await prisma.persona.groupBy({ by: ['status'], _count: { _all: true } })
  await prisma.$disconnect()
  console.log(`\n  적용 ${done} / ${plan.activate.length}명 · 실패 ${failedCount}명`)
  console.log(`  Persona status: ${all.map((s) => `${s.status}=${s._count._all}`).join(' · ')}`)
  console.log('  🔴 켰을 뿐입니다. 발행은 사람이 따로 부릅니다 — --check 로 검증하세요.\n')
  if (failedCount > 0) process.exit(1)
}

// 🔴 fixture 가 import 해도 DB 를 열지 않는다
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
