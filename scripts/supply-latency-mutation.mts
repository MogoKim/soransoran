#!/usr/bin/env tsx
/**
 * 🔴 **밤 4 지연 묶음(2026-11-25) — 변이 시험 · 격리 Postgres 필요**
 *
 *   npm run supply:latency-mutation   (`supply:stock-parity-db-check` 뒤에 이어 돈다 — D100 격리 DB 사슬)
 *
 *   지점 셋을 하나씩 되돌리거나 바꾸면 그 계약을 재는 검사가 반드시 FAIL 해야 한다. 한 변이라도 살아남으면 exit 1.
 *     ① 지평 끝   — 지금 창 끝까지 + 다음 창 첫 자리 1칸(`upcomingSlots`) · 판정서 §2.1 반례 표
 *     ② 6시간     — 수집 뒤 6시간 만료(`judgeSlotRelease`) · 대기 결말 lost(`pendingFateOf`) · 칸 · 이월 기한
 *     ③ 읽기 범위 — 큐 `createdAt ≥ 지금 − 6h − 시계 오차` · 발행 이력 8일(`loadPublishableStock`)
 *        🔴 가짜 prisma 는 where 를 무시한다 — 이 지점은 **실제 DB 검사**(`supply-stock-parity-db-check` ⑥)만 잡을 수 있다.
 *
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 변이 지점은 정확히 한 곳이어야 한다 — 0 · 2 이상이면 멈춘다(지점이 사라진 죽은 변이를 통과로 세지 않는다).
 * 🔴 먼저 변이 없는 사본에서 쓰는 검사가 전부 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 * 🔴 격리 DB 가드는 DB 검사 자신이 한다(sentinel · localhost · soran_test) — 운영 DB 에 붙지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const STOCK = 'scripts/lib/publishable-stock.mts'
const RELEASE = 'src/lib/source-slot-release.ts'
const FATE = 'src/lib/ready-fate.ts'
const FILL = 'src/lib/supply-fill-retry.ts'

/** 검사 실행 인자 — npm 스크립트와 같은 길로 돈다 */
const CHECKS = {
  parity: ['tsx', 'scripts/supply-stock-parity-check.mts'],
  release: ['tsx', 'scripts/source-slot-release-check.mts'],
  jit: ['tsx', 'scripts/supply-jit-contract-check.mts'],
  fill: ['tsx', 'scripts/supply-fill-retry-check.mts'],
  db: ['tsx', 'scripts/supply-stock-parity-db-check.mts'],
} as const
type CheckName = keyof typeof CHECKS

type Mutation = { point: '지평 끝' | '6시간' | '읽기 범위'; name: string; file: string; from: string; to: string; caughtBy: CheckName }
const M = (point: Mutation['point'], name: string, file: string, from: string, to: string, caughtBy: CheckName): Mutation =>
  ({ point, name, file, from, to, caughtBy })
const MUTATIONS: Mutation[] = [
  // ① 지평 끝
  M('지평 끝', '지평을 옛 "오늘 운영 창 끝까지"로 되돌린다(창 끝 조건을 뺀다)', STOCK,
    'minute <= PUBLISH_WINDOW_END_MINUTE && minute < end && simulatedPublished', 'minute <= PUBLISH_WINDOW_END_MINUTE && simulatedPublished', 'parity'),
  M('지평 끝', '창 끝 틱까지 지금 창 몫으로 센다(열린 끝 [start, end) 을 닫는다)', STOCK,
    'minute <= PUBLISH_WINDOW_END_MINUTE && minute < end && simulatedPublished', 'minute <= PUBLISH_WINDOW_END_MINUTE && minute <= end && simulatedPublished', 'parity'),
  M('지평 끝', '00:00~00:59 의 창 끝을 전날 자정 기준 그대로 쓴다(검토 R1 — 지평이 하루 끝까지 열린다)', STOCK,
    'return nowMinute < CYCLES[0]!.minute ? w.end - DAY_MINUTES : w.end', 'return w.end', 'parity'),
  M('지평 끝', '다음 창 첫 자리 1칸을 사지 않는다', STOCK,
    '...(nextWindowFirst === undefined ? [] : [nextWindowFirst])]', ']', 'parity'),
  M('지평 끝', '자정을 넘는 창의 내일 몫(00:10 · 01:00)을 빼먹는다', STOCK,
    'const crossing = tomorrow.filter((d) => minuteOf(d) < end)', 'const crossing: Date[] = []', 'parity'),
  // ② 6시간
  M('6시간', '수집 뒤 6시간 판정을 지운다', RELEASE,
    "  if (!(i.slotAt.getTime() - captured.getTime() < CAPTURE_AGE_LIMIT_HOURS * HOUR_MS)) return out('ineligible', 'CAPTURED_TOO_OLD_AT_SLOT')\n", '', 'release'),
  M('6시간', '만료 시간을 24시간으로 늘린다', RELEASE,
    'export const CAPTURE_AGE_LIMIT_HOURS = 6', 'export const CAPTURE_AGE_LIMIT_HOURS = 24', 'release'),
  M('6시간', '6시간 경계를 닫힌 쪽으로 바꾼다(정확히 6시간을 통과시킨다)', RELEASE,
    'if (!(i.slotAt.getTime() - captured.getTime() < CAPTURE_AGE_LIMIT_HOURS * HOUR_MS))', 'if (!(i.slotAt.getTime() - captured.getTime() <= CAPTURE_AGE_LIMIT_HOURS * HOUR_MS))', 'release'),
  M('6시간', '6시간 사유를 만료 사유에서 뺀다(발행 트랜잭션 · 칸 해제가 그 행을 살린다)', RELEASE,
    "  'SOURCE_TOO_OLD_AT_SLOT', 'CAPTURED_TOO_OLD_AT_SLOT', 'POSTED_WITHIN_DAY_AT_SLOT', 'RESPONSE_UNOBSERVED',",
    "  'SOURCE_TOO_OLD_AT_SLOT', 'POSTED_WITHIN_DAY_AT_SLOT', 'RESPONSE_UNOBSERVED',", 'release'),
  M('6시간', '🔴 대기 결말이 6시간 사유를 lost 로 세지 않는다(수율이 부풀어 공급이 덜 산다 · 판정서 R12)', FATE,
    "export const AGE_LIMIT_LOSS_REASONS: readonly ReleaseReason[] = ['SOURCE_TOO_OLD_AT_SLOT', 'CAPTURED_TOO_OLD_AT_SLOT']",
    "export const AGE_LIMIT_LOSS_REASONS: readonly ReleaseReason[] = ['SOURCE_TOO_OLD_AT_SLOT']", 'jit'),
  M('6시간', '재고 칸이 6시간 사유를 "모름" 칸으로 보낸다', STOCK,
    "hold === 'SOURCE_TOO_OLD_AT_SLOT' || hold === 'CAPTURED_TOO_OLD_AT_SLOT' ? 'releaseIneligible'",
    "hold === 'SOURCE_TOO_OLD_AT_SLOT' ? 'releaseIneligible'", 'parity'),
  M('6시간', '이월 기한을 옛 24시간으로 되돌린다(값이 둘이 된다)', FILL,
    'export const CARRY_OVER_LOOKBACK_MS = CAPTURE_AGE_LIMIT_HOURS * 3_600_000', 'export const CARRY_OVER_LOOKBACK_MS = 24 * 3_600_000', 'fill'),
  // ③ 읽기 범위 — 실제 DB 만 잡는다
  M('읽기 범위', '큐 읽기 범위를 지운다(죽은 행을 매 틱 다시 읽는다)', STOCK,
    "where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null, createdAt: { gte: queueReadFromOf(now) } },",
    "where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },", 'db'),
  M('읽기 범위', '큐 읽기 범위에서 시계 오차를 뺀다(경계 행을 놓친다)', STOCK,
    '  new Date(now.getTime() - CAPTURE_AGE_LIMIT_HOURS * HOUR_MS - SOURCE_CLOCK_SKEW_MS)',
    '  new Date(now.getTime() - CAPTURE_AGE_LIMIT_HOURS * HOUR_MS)', 'db'),
  M('읽기 범위', '발행 이력 범위를 지운다(8일 밖 기록까지 읽는다)', STOCK,
    "where: { kind: 'post', createdAt: { gte: new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * DAY_MS) } },",
    "where: { kind: 'post' },", 'db'),
]

const dir = mkdtempSync(join(tmpdir(), 'supply-latency-mut-'))
const run = (c: CheckName): { ok: boolean; tail: string } => {
  const r = spawnSync('npx', [...CHECKS[c]], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 600_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const firstFail = out.split('\n').find((l) => /FAIL|❌/.test(l))?.trim().slice(0, 160) ?? ''
  return { ok: r.status === 0, tail: firstFail || (out.trim().split('\n').slice(-1)[0] ?? '') }
}
let survived = 0
const caughtByPoint = new Map<Mutation['point'], number>()
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ 밤 4 지연 묶음 변이 시험 (worktree 변경 0 · 격리 DB 검사 포함) ══')
  for (const c of new Set(MUTATIONS.map((m) => m.caughtBy))) {
    const base = run(c)
    console.log(`  ${base.ok ? '✅' : '🔴'} 변이 없는 사본 — ${c} ${base.ok ? 'PASS' : 'FAIL'} (${base.tail})`)
    if (!base.ok) throw new Error(`하네스 기준선 ${c} 가 FAIL 이다 — 변이 시험이 아무것도 증명하지 않는다`)
  }
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) throw new Error(`변이 대상이 정확히 한 곳이 아니다(${n}) — ${m.name}`)
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run(m.caughtBy)
      if (r.ok) { survived += 1; console.log(`  🔴 살아남음 [${m.point}] ${m.name} (${m.caughtBy})`) } else {
        caughtByPoint.set(m.point, (caughtByPoint.get(m.point) ?? 0) + 1)
        console.log(`  ✅ 잡힘 [${m.point}] ${m.name} (${m.caughtBy}) — ${r.tail}`)
      }
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const points: Mutation['point'][] = ['지평 끝', '6시간', '읽기 범위']
const deadPoint = points.filter((p) => (caughtByPoint.get(p) ?? 0) === 0)
console.log(`\n  지점별 잡힘 — ${points.map((p) => `${p} ${caughtByPoint.get(p) ?? 0}/${MUTATIONS.filter((m) => m.point === p).length}`).join(' · ')}`)
const ok = survived === 0 && deadPoint.length === 0
console.log(`${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length - survived}/${MUTATIONS.length} 잡힘${deadPoint.length > 0 ? ` · 🔴 잡힌 변이 0 인 지점: ${deadPoint.join(', ')}` : ''}`)
process.exit(ok ? 0 : 1)
