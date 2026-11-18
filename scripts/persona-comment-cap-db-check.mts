#!/usr/bin/env tsx
/**
 * Persona 댓글 상한 변경 — 🔴 격리 Postgres 실제 트랜잭션 검사 (SORAN_ISOLATED_DB=yes-throwaway · 127.0.0.1 · soran_test)
 *   운영 CLI 와 **같은 실행부**(`applyCapChange`)를 부른다.
 */
import { PrismaClient } from '@prisma/client'

import { requireIsolatedDb } from './lib/auto-ready-audit-fixtures.mjs'
import { applyCapChange, readCapRows } from './lib/persona-comment-cap.mjs'

requireIsolatedDb()
const db = new PrismaClient()
let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }

const PREFIX = 'CAPT'
const code = (n: number): string => `${PREFIX}${String(n).padStart(2, '0')}`
const ARGS = { from: { daily: 3, weekly: 12 }, to: { daily: 4, weekly: 18 }, keep: { daily: 2, weekly: 8 }, expect: 56, reason: '격리 시험' }

/**
 * 🔴 판정은 active Persona 전체를 본다 — 다른 검사가 남긴 active 행이 있으면 "모르는 조합"이 된다.
 *    그래서 이 검사는 격리 DB 사슬의 **맨 앞**(빈 DB)에서 돈다. 남의 행은 지우지 않고, 있으면 그 사실로 멈춘다.
 */
async function world(): Promise<void> {
  await db.personaAuditLog.deleteMany({ where: { persona: { code: { startsWith: PREFIX } } } })
  await db.persona.deleteMany({ where: { code: { startsWith: PREFIX } } })
  const others = await db.persona.count({ where: { status: 'active' } })
  if (others > 0) { console.error(`🔴 다른 검사의 active Persona ${others}행이 남아 있다 — 이 검사는 빈 격리 DB 에서 돈다`); process.exit(2) }
  for (let n = 1; n <= 60; n += 1) {
    const u = await db.user.create({ data: { nickname: `상한시험${n}_${Date.now()}` }, select: { id: true } })
    const quiet = n > 56
    await db.persona.create({ data: { code: code(n), userId: u.id, status: 'active', dailyCap: quiet ? 2 : 3, weeklyCap: quiet ? 8 : 12, identity: { k: n } } })
  }
}
const tally = async (): Promise<string> => {
  const m = new Map<string, number>()
  for (const r of await readCapRows(db)) { const k = `${String(r.dailyCap)}/${String(r.weeklyCap)}`; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].sort().map(([k, n]) => `${k}:${n}`).join(' ')
}
const audits = (): Promise<number> => db.personaAuditLog.count()

try {
  console.log('\n① 적용 · 멱등')
  {
    await world()
    const quietBefore = await db.persona.findUniqueOrThrow({ where: { code: code(57) } })
    const r = await applyCapChange(db, ARGS)
    check('APPLIED 56행', r.code === 'APPLIED' && r.changed === 56, JSON.stringify(r))
    check('값 — 2/8:4 · 4/18:56', (await tally()) === '2/8:4 4/18:56', await tally())
    check('감사 기록 56행 · changedFields 두 칸', (await audits()) === 56
      && (await db.personaAuditLog.findFirstOrThrow()).changedFields.join(',') === 'dailyCap,weeklyCap')
    const quietAfter = await db.persona.findUniqueOrThrow({ where: { code: code(57) } })
    check('그대로 둘 무리는 updatedAt 까지 불변', quietAfter.updatedAt.getTime() === quietBefore.updatedAt.getTime())
    const one = await db.persona.findUniqueOrThrow({ where: { code: code(1) } })
    check('다른 칸(identity · status) 불변', JSON.stringify(one.identity) === '{"k":1}' && one.status === 'active')
    const again = await applyCapChange(db, ARGS)
    check('두 번째 실행 → ALREADY_APPLIED · 감사 그대로 56', again.code === 'ALREADY_APPLIED' && (await audits()) === 56)
  }

  console.log('\n② 거절 — write 0')
  {
    await world()
    const r1 = await applyCapChange(db, { ...ARGS, expect: 55 })
    check('기대 수 불일치 → REFUSED · 값 그대로 · 감사 0', r1.code === 'REFUSED' && (await tally()) === '2/8:4 3/12:56' && (await audits()) === 0, JSON.stringify(r1))
    await db.persona.update({ where: { code: code(1) }, data: { dailyCap: 5, weeklyCap: 20 } })
    const r2 = await applyCapChange(db, ARGS)
    check('모르는 조합 한 행 → REFUSED · 나머지 55행도 안 바뀜', r2.code === 'REFUSED' && (await tally()) === '2/8:4 3/12:55 5/20:1' && (await audits()) === 0, JSON.stringify(r2))
    await world()
    const r3 = await applyCapChange(db, { ...ARGS, reason: '  ' })
    check('사유 없음 → REFUSED', r3.code === 'REFUSED' && (await tally()) === '2/8:4 3/12:56')
    await db.persona.update({ where: { code: code(2) }, data: { status: 'paused' } })
    const r4 = await applyCapChange(db, ARGS)
    check('대상 하나가 paused 로 빠지면 기대 수 불일치 → REFUSED', r4.code === 'REFUSED' && (await tally()) === '2/8:4 3/12:56', JSON.stringify(r4))
  }

  console.log('\n③ 되돌리기')
  {
    await world()
    await applyCapChange(db, ARGS)
    const back = await applyCapChange(db, { ...ARGS, from: ARGS.to, to: ARGS.from, reason: '되돌림 시험' })
    check('4/18 → 3/12 · 56행', back.code === 'APPLIED' && back.changed === 56 && (await tally()) === '2/8:4 3/12:56', JSON.stringify(back))
    check('감사 기록 112행(적용 56 + 되돌림 56)', (await audits()) === 112)
  }
} finally {
  await db.personaAuditLog.deleteMany({ where: { persona: { code: { startsWith: PREFIX } } } })
  await db.persona.deleteMany({ where: { code: { startsWith: PREFIX } } })
  await db.$disconnect()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
