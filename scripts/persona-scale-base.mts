#!/usr/bin/env tsx
/**
 * Persona 300+ **기반 측정** — 🔴 read-only. DB write 0 · 파일 write 0 · LLM 0 · 유료 호출 0 (2026-10-13)
 *
 *   npx tsx scripts/persona-scale-base.mts                       # 오프라인 — 정본 말투 자산 · 이름 공간 · 코드
 *   npx tsx scripts/persona-scale-base.mts --db                  # + 운영 DB read-only (회원 · 기존 Persona 이름)
 *   npx tsx scripts/persona-scale-base.mts --extra=<file> --new=10
 *                                                                # 보충 코퍼스 dry-run — 메모리에서만 화자를 세고 붙여 본다
 *
 * 🔴 `--extra` 파일은 `[{ author, content }]` (JSON 배열) 이다. 작성자는 읽는 줄에서 곧바로 불투명 값으로 바뀌고
 *    (`opaqueRowsFrom`), 원문 · 작성자 · 화자 id 는 출력 · 파일 · DB 어디에도 남지 않는다. 개수만 찍는다.
 * 🔴 승인된 코퍼스만 넣는다. 이 도구는 출처를 판정하지 않는다.
 */
import { readFileSync } from 'node:fs'

import { nextAutogenCodes, RETIRED_AUTOGEN_CODES } from '../src/lib/persona-autogen'
import { comparePersonaCodes, isPersonaCode, PERSONA_CODE_MAX, sortPersonaCodes } from '../src/lib/persona-code'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { nicknameSpace } from '../src/lib/persona-nickname-space'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { PERSONA_SUSTAINED_TARGET } from '../src/lib/d100-capacity'
import type { NameCollisionSets } from './lib/persona-gate-name-collision.mjs'
import { selectDistinctNames } from './lib/persona-name-space.mjs'
import {
  loadCanonAsset, opaqueRowsFrom, planAppendOnlyBundles, speakerSupply, stableAssignment,
} from './lib/persona-reference-store.mjs'
import { compareVoiceDigests, loadVoiceDigestFixture } from './lib/persona-voice-digest.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const fail = (m: string): never => { console.error(`❌ ${m}`); process.exit(1) }
if (argv.some((a) => a === '--apply' || a.startsWith('--apply=') || a === '--write')) fail('이 도구는 쓰지 않는다 — 측정만 한다')
const USE_DB = argv.includes('--db')
const EXTRA = arg('extra')
const NEW = Number(arg('new') ?? '10')
if (!Number.isInteger(NEW) || NEW < 1 || NEW > PERSONA_CODE_MAX) fail(`--new 는 1~${PERSONA_CODE_MAX} 정수다`)
const repoRoot = process.cwd()
const target = PERSONA_SUSTAINED_TARGET.d100

console.log(`══ Persona 300+ 기반 — read-only · ${USE_DB ? '운영 DB read-only' : '오프라인'} ══\n`)

// ── ① 코드 ──
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
if (pool.problems.length > 0) fail(`정본 카드를 읽지 못했다: ${pool.problems.join(' / ')}`)
const used = [...pool.cards.map((c) => c.code)]
let sets: NameCollisionSets = { personaNames: [] }
if (USE_DB) {
  await loadEnvLocal()
  const { PrismaClient } = await import('@prisma/client')
  const { loadNameCollisionSets } = await import('./lib/persona-name-collision-sets.mjs')
  const prisma = new PrismaClient()
  try {
    sets = await loadNameCollisionSets(prisma)
    for (const p of await prisma.persona.findMany({ select: { code: true } })) used.push(p.code)
  } finally {
    await prisma.$disconnect()
  }
}
const sample = ['P100', 'P2', 'P99', 'P10']
const issued = nextAutogenCodes({ usedCodes: used, count: target })
console.log('── ① Persona 코드')
console.log(`  상한 P${PERSONA_CODE_MAX} · 정렬 ${sample.join(' ')} → ${sortPersonaCodes(sample).join(' ')}`)
console.log(`  운영 universe ${PRODUCTION_PERSONA_CODES.length} · 숫자순 = 저장 순서 ${PRODUCTION_PERSONA_CODES.every((c, i, a) => i === 0 || comparePersonaCodes(a[i - 1]!, c) < 0) ? '예' : '아니오'}`
  + ` · 정본 표기 ${PRODUCTION_PERSONA_CODES.every(isPersonaCode) ? '예' : '아니오'}`)
console.log(`  발급 가능 ${issued.codes.length}/${target} (high-water P${issued.highWater} · 폐기 ${Object.keys(RETIRED_AUTOGEN_CODES).join('·')} 재사용 0)`
  + ` · 첫 ${issued.codes[0] ?? '—'} · 마지막 ${issued.codes.at(-1) ?? '—'}`)
console.log('')

// ── ② 말투 ──
const canon = loadCanonAsset()
const base = stableAssignment({ repoRoot })
const fixture = loadVoiceDigestFixture(repoRoot)
const same = compareVoiceDigests({ fixture, sourceDigest: canon.ok ? canon.sourceDigest : null, order: PRODUCTION_PERSONA_CODES, byCode: base.byCode })
const supply = speakerSupply(canon.rows)
console.log('── ② 말투 근거')
console.log(`  정본 자산 ${canon.ok ? 'OK' : canon.code} · 화자 ${supply.speakers} · 기준 통과 ${supply.eligible} · 운영 배정 ${base.byCode.size}`
  + ` · 남음 ${Math.max(0, supply.eligible - base.byCode.size)} · 관측 하나 모자람 ${supply.nearMiss}`)
console.log(`  운영 ${fixture.order.length}명 배정 digest ${same.status === 'same' ? `✅ 고정값과 같다 ${fixture.order.length}/${fixture.order.length}`
  : same.status === 'changed' ? `🔴 바뀌었다 ${same.changed.join(',')}` : `⏸ 미실행 — ${same.reason}`}`)
const newCodes = nextAutogenCodes({ usedCodes: used, count: NEW }).codes
if (EXTRA !== null) {
  let records: unknown[]
  try { records = JSON.parse(readFileSync(EXTRA, 'utf-8')) as unknown[] } catch { records = fail(`--extra 를 읽지 못했다: ${EXTRA}`) }
  if (!Array.isArray(records)) fail('--extra 는 JSON 배열이어야 한다')
  const extra = opaqueRowsFrom(records)
  const xs = speakerSupply(extra.rows)
  const plan = planAppendOnlyBundles({ canonRows: canon.rows, extraRows: extra.rows, productionCodes: PRODUCTION_PERSONA_CODES, newCodes })
  console.log(`  보충 dry-run  행 ${extra.rows.length} (밴드 밖 ${extra.skipped}) · 화자 ${xs.speakers} · 기준 통과 ${xs.eligible}`
    + ` · 정본과 겹쳐 뺀 화자 ${plan.excludedExtraSpeakers}`)
  console.log(`  새 코드 ${newCodes.length} → 정본 남은 화자 ${plan.fromCanon.length} · 보충 화자 ${plan.fromExtra.length}`
    + ` · 말투 없음 ${newCodes.length - plan.fromCanon.length - plan.fromExtra.length}`
    + ` · 운영 배정 변동 ${plan.productionDrift.length === 0 ? '0' : `🔴 ${plan.productionDrift.join(',')}`}`)
}
console.log('')

// ── ③ 이름 ──
const space = nicknameSpace()
const names = selectDistinctNames({ sets, space })
console.log('── ③ 표시명 공간')
console.log(`  합성 공간 ${space.length} · 회원·기존 Persona 와도 서로도 Gate ⑥-B pass ${names.picked.length}`
  + ` (${names.bound === 'exact' ? '회원 이름 대조' : '상한 — 회원 이름 미대조, --db 로 정확히'})`
  + ` · ${target}명 ${names.picked.length >= target ? '✅ 가능' : '❌ 모자람'}`)
console.log('')
console.log('🟡 read-only — DB write 0 · 파일 write 0')
