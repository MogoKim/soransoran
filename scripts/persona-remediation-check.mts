#!/usr/bin/env tsx
/**
 * Persona 계약 복구 — **순수 반례** (DB · 네트워크 · LLM 0) · 2026-10-01 Phase 2A
 *
 *   ① 카드와 DB 가 정확히 일치 → 변경 0
 *   ② 카드 정본 칸만 카드 값으로 · 카드에 없는 칸(생활 단계 · 말끝)은 채우지 않는다
 *   ③ 말버릇 표기(따옴표 · 류) · 자녀 나이대(한 명당 한 칸)는 같은 값이다 — 쓰지 않는다
 *   ④ 같은 입력 → 같은 계획 · digest · 행이 바뀌면 precondition · digest 가 바뀐다
 *   ⑤ 회귀 판정 — 유효 감소 · 유효하던 사람 이탈 · 축 악화 · 예측 불일치를 잡는다
 *   ⑥ 말투 근거 묶음 — 한 화자 · 한 댓글이 두 묶음에 들어가지 않는다 · 모자라면 채우지 않는다
 *   ⑦ 소재/역할 이력 0 → 측정된 0 (활동을 만들 이유가 없다)
 *   ⑧ 원본 작가 · 옛 작가 해시 · 표시명 입력 0 · apply 는 격리 DB 밖에서 열리지 않는다
 */
import { readFileSync } from 'node:fs'

import { verifySeedCard, noGoExpressionKey } from '../src/lib/persona-card-verify'
import {
  fingerprintOf, patchedRow, planRemediation, type RemediationRow,
} from '../src/lib/persona-contract-remediation'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { judgePersonaReserve, topicShareOf, roleShareOf, type PersonaReserveResult } from '../src/lib/persona-reserve'
import { regressionOf } from './lib/persona-contract-remediation.mjs'
import { planBundles } from './lib/persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const cards = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards
const card = (code: string): PoolCard => cards.find((c) => c.code === code)!
const rowOf = (code: string, over: Partial<RemediationRow> = {}): RemediationRow => {
  const c = card(code)
  return {
    code, status: 'active', updatedAt: '2026-10-01T00:00:00.000Z',
    ageBand: c.ageBand, region: c.region, lifeStage: '자녀 독립기',
    identity: {
      maritalStatus: c.maritalStatus, spouseRelationship: c.maritalStatus === '기혼' ? (c.spouseRelationship ?? '원만') : '해당없음',
      childrenCount: c.childrenCount, childrenAgeBands: [...c.childrenAgeBands], parentCare: c.parentCare,
      menopauseStatus: c.menopauseStatus, workStatus: c.workStatus, economicStatus: c.economicStatus,
      housing: c.housing, personality: [...c.personality],
    },
    voiceCore: { length: c.voiceLength ?? '중간', register: '존댓말', ending: '~요', emoji: '없음' },
    noGoTopics: [...c.noGoTopics], noGoExpressions: [...c.noGoExpressions], forbiddenReactionRoles: [...c.forbiddenReactionRoles],
    ...over,
  }
}

console.log('\n① 카드와 DB 가 정확히 일치')
{
  const p = planRemediation(['P01', 'P14', 'P17'].map((c) => rowOf(c)), cards)
  check('변경 0 · 근거 필요 0', p.personas.length === 0 && p.evidenceRequired.length === 0, JSON.stringify(p.personas))
  check('카드를 못 읽으면 아무것도 계획하지 않는다', planRemediation([rowOf('P05')], null).personas.length === 0
    && planRemediation([rowOf('P05')], null).skipped.length === 1)
  check('retired 는 대상이 아니다', planRemediation([rowOf('P05', { status: 'retired', noGoTopics: [] })], cards).personas.length === 0)
}

console.log('\n② 카드 정본 칸만 · 근거 없는 칸은 채우지 않는다')
{
  const drift = rowOf('P17', { noGoTopics: [], lifeStage: null, voiceCore: { length: '길게', register: '구어체', emoji: '자주' } })
  const p = planRemediation([drift], cards)
  const fields = p.personas[0]?.changes.map((c) => c.field) ?? []
  check('비어 있는 noGoTopics → 카드 값', fields.includes('noGoTopics')
    && JSON.stringify(p.personas[0]!.changes.find((c) => c.field === 'noGoTopics')!.after) === JSON.stringify(card('P17').noGoTopics))
  check('🔴 lifeStage · voiceCore.ending 은 채우지 않는다 — 근거 필요로 낸다',
    !fields.some((f) => /lifeStage|ending/.test(f))
    && p.evidenceRequired.some((g) => g.field === 'lifeStage') && p.evidenceRequired.some((g) => g.field === 'voiceCore.ending'))
  const fixed = patchedRow(drift, p.personas[0]!.changes)
  check('고친 행도 lifeStage 는 비어 있다(기본값 0)', fixed.lifeStage === null && !('ending' in (fixed.voiceCore ?? {})))
  const roles = planRemediation([rowOf('P05', { forbiddenReactionRoles: ['information'] })], cards)
  check('금지 역할이 카드와 다르면 카드 값(더 넓은 금지)', roles.personas[0]?.changes[0]?.field === 'forbiddenReactionRoles'
    && JSON.stringify(roles.personas[0]!.changes[0]!.after) === JSON.stringify(card('P05').forbiddenReactionRoles))
  const single = planRemediation([rowOf('P15', { identity: { ...rowOf('P15').identity, spouseRelationship: '해당 없음' } })], cards)
  check('비혼의 배우자 관계 `해당 없음` → 유일해 `해당없음`', single.personas[0]?.changes.some((c) => c.field === 'identity.spouseRelationship' && c.after === '해당없음') === true)
  const married = cards.find((c) => c.maritalStatus === '기혼' && c.spouseRelationship === null)
  if (married !== undefined) {
    const m = planRemediation([rowOf(married.code, { identity: { ...rowOf(married.code).identity, spouseRelationship: '' } })], cards)
    check('기혼인데 카드에 관계가 없으면 채우지 않고 근거 필요', !m.personas.some((x) => x.changes.some((c) => c.field === 'identity.spouseRelationship'))
      && m.evidenceRequired.some((g) => g.field === 'identity.spouseRelationship'))
  }
  check('🔴 자녀 나이대는 쓰지 않는다(카드는 고유 집합)', !planRemediation([rowOf('P17', { identity: { ...rowOf('P17').identity, childrenAgeBands: [] } })], cards)
    .personas.some((x) => x.changes.some((c) => c.field.includes('childrenAgeBands'))))
}

console.log('\n③ 같은 값의 다른 표기 — 쓰지 않는다')
{
  const p17 = card('P17')
  const unquoted = p17.noGoExpressions.map(noGoExpressionKey)
  check('카드 `"…"` · `… 류` 와 DB 따옴표 없는 표기는 같은 표현', planRemediation([rowOf('P17', { noGoExpressions: unquoted })], cards).personas.length === 0
    && planRemediation([rowOf('P05', { noGoExpressions: card('P05').noGoExpressions.map(noGoExpressionKey) })], cards).personas.length === 0)
  check('다른 표현이면 여전히 다르다', planRemediation([rowOf('P17', { noGoExpressions: ['전혀 다른 말'] })], cards).personas.length === 1)
  const seed = (code: string, bands: string[]) => ({
    identity: { ...rowOf(code).identity, childrenAgeBands: bands }, voiceCore: rowOf(code).voiceCore,
    voiceVariations: ['a', 'b', 'c', 'd', 'e'], activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
    ageBand: card(code).ageBand, region: card(code).region, lifeStage: 'x',
    noGoTopics: card(code).noGoTopics, noGoExpressions: card(code).noGoExpressions.map(noGoExpressionKey),
    forbiddenReactionRoles: card(code).forbiddenReactionRoles, dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
  })
  const twins = Array.from({ length: card('P17').childrenCount }, () => card('P17').childrenAgeBands[0]!)
  check('🔴 verifySeedCard — 자녀 한 명당 한 칸(`성인,성인`)은 정본 `성인` 과 같다',
    !verifySeedCard('P17', seed('P17', twins), card('P17')).some((x) => x.includes('childrenAgeBands')),
    verifySeedCard('P17', seed('P17', twins), card('P17')).join(' / '))
  check('verifySeedCard — 다른 밴드는 여전히 다르다', verifySeedCard('P17', seed('P17', ['미취학']), card('P17')).some((x) => x.includes('childrenAgeBands 가 정본과 다르다')))
  check('verifySeedCard — 따옴표 없는 말버릇은 정본과 같다', !verifySeedCard('P17', seed('P17', twins), card('P17')).some((x) => x.includes('noGoExpressions')))
}

console.log('\n④ 결정성 · precondition')
{
  const rows = ['P05', 'P07', 'P17'].map((c) => rowOf(c, { noGoTopics: [] }))
  const a = planRemediation(rows, cards)
  const b = planRemediation([...rows].reverse(), cards)
  check('같은 입력 → 같은 digest (순서 무관)', a.digest === b.digest)
  const moved = planRemediation(rows.map((r) => (r.code === 'P07' ? { ...r, updatedAt: '2026-10-02T00:00:00.000Z' } : r)), cards)
  check('🔴 행이 바뀌면(updatedAt 만이라도) precondition · digest 가 바뀐다', moved.digest !== a.digest
    && moved.personas.find((p) => p.code === 'P07')!.precondition !== a.personas.find((p) => p.code === 'P07')!.precondition)
  check('지문은 jsonb 키 순서에 기대지 않는다', fingerprintOf(rowOf('P05')) === fingerprintOf({ ...rowOf('P05'), identity: Object.fromEntries(Object.entries(rowOf('P05').identity!).reverse()) }))
  const after = rows.map((r) => { const p = a.personas.find((x) => x.code === r.code); return p ? patchedRow(r, p.changes) : r })
  check('🔴 두 번째 계획은 변경 0 (멱등)', planRemediation(after, cards).personas.length === 0)
}

console.log('\n⑤ 회귀 판정')
{
  const res = (valid: string[], gaps: Record<string, string[]> = {}): PersonaReserveResult => {
    const base = judgePersonaReserve({ ok: true, personas: [] })
    return {
      ...base, contractValid: valid.length,
      byState: { ...base.byState, 'stage-active': valid, reserve: [] },
      gapsByAxis: Object.fromEntries(Object.entries(base.gapsByAxis).map(([a, g]) => [a, { ...g, blocked: gaps[a] ?? [] }])) as PersonaReserveResult['gapsByAxis'],
    }
  }
  const seven = ['P01', 'P04', 'P08', 'P11', 'P14', 'P18', 'P19']
  check('정상 — 7 → 8 · 예측과 같음', regressionOf(res(seven), res([...seven, 'P05']), res([...seven, 'P05'])).length === 0)
  check('🔴 유효하던 사람이 빠지면 롤백 사유', regressionOf(res(seven), res([...seven.slice(1), 'P05']), res([...seven.slice(1), 'P05'])).some((x) => x.includes('빠졌다')))
  check('🔴 축이 악화되면 롤백 사유', regressionOf(res(seven, { lifeAxes: ['P02'] }), res(seven, { lifeAxes: ['P02', 'P03'] }), res(seven, { lifeAxes: ['P02', 'P03'] })).some((x) => x.includes('악화')))
  check('🔴 예측과 다르면 롤백 사유', regressionOf(res(seven), res(seven), res([...seven, 'P05'])).some((x) => x.includes('예측')))
}

console.log('\n⑥ 말투 근거 묶음 — 중복 배정 · 부족')
{
  const rows = [
    ...Array.from({ length: 4 }, (_, i) => ({ speakerId: 's-a', text: `그러게요 정말 그래요 ${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ speakerId: 's-b', text: `맞아요 그 말이 맞네요 ${i}` })),
    ...Array.from({ length: 2 }, (_, i) => ({ speakerId: 's-c', text: `음 그건 좀 아닌 것 같아요 ${i}` })),
  ]
  const plan = planBundles({ rows, personaCodes: ['P20', 'P21', 'P22'] })
  const texts = plan.bundles.flatMap((b) => b.comments.map((c) => c.text))
  check('한 댓글이 두 묶음에 들어가지 않는다', new Set(texts).size === texts.length)
  check('🔴 기준 미만 화자로 채우지 않는다 — 3명 중 2명만 묶음', plan.bundles.length === 2 && plan.blocks.some((b) => b.includes('화자가 2명뿐')))
}

console.log('\n⑦ 소재 · 역할 이력 0 → 측정된 0')
{
  const h = { recentEvents: 0, roleCounts: {}, unresolvedRoleEvents: 0, consecutiveExposures: 0, postsSinceLastPairing: 'never' as const, daysSinceActive: null, activityToday: 0 }
  const t = topicShareOf(h)
  const r = roleShareOf(h)
  check('이력 0 → 소재 0 · 역할 0 (모름 아님 — 활동을 만들 이유가 없다)', !('unknown' in t) && t.value === 0 && !('unknown' in r) && r.value === 0)
}

console.log('\n⑧ 입력 경계 · apply 경계')
{
  const src = ['src/lib/persona-contract-remediation.ts', 'scripts/lib/persona-contract-remediation.mts', 'scripts/persona-contract-remediation.mts']
    .map((f) => readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join('\n'))
    .join('\n')
  check('🔴 원본 작가 · 옛 작가 해시 · 원문 입력 0', !/author|voiceSource|microSeedRawContent\.(find|create)|sourceAuthor/i.test(src.replace(/microSeedRawContent\.count/g, '')))
  check('🔴 표시명 · User 를 쓰지 않는다', !/user\.(update|create|upsert)|nickname\s*:/.test(src))
  check('🔴 Post · Comment · Queue · 활동 행을 만들지 않는다', !/\.(post|comment|personaApprovalQueue|originalPostApprovalQueue|personaActivityLog)\.(create|createMany|update|upsert|delete)/.test(src))
  const cli = readFileSync('scripts/persona-contract-remediation.mts', 'utf-8')
  check('🔴 CLI apply 는 격리 DB 판정이 먼저다', /if \(APPLY && !isolatedDb\(process\.env\)\)/.test(cli) && cli.indexOf('isolatedDb(process.env)') < cli.indexOf('new PrismaClient()'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail — DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
