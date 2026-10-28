#!/usr/bin/env tsx
/**
 * Persona 300+ 기반 fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0** (2026-10-13)
 *
 *   ① 코드   숫자순 · 정본 표기 · 단일 상한 — 두 자리 코드에서는 옛 사전순과 **한 쌍도 다르지 않다**
 *   ② 말투   보충 화자는 뒤에만 붙는다 — 운영 코드의 묶음은 보충 코퍼스와 무관하다
 *   ③ 이름   합성 공간 350개 이상 · 300명 서로 구분 가능 · 실사용자 입력 0
 *
 * 🔴 정본 말투 자산이 있는 기기에서만 운영 30명 digest 를 실제로 대조한다. 없으면 **미실행**으로 따로 센다(통과가 아니다).
 */
import { readFileSync } from 'node:fs'

import { nextAutogenCodes, AUTOGEN_CODE_LAST } from '../src/lib/persona-autogen'
import { isPoolCode } from '../src/lib/persona-card-verify'
import { comparePersonaCodes, isPersonaCode, PERSONA_CODE_MAX, personaCodeOf, sortPersonaCodes } from '../src/lib/persona-code'
import { PRODUCTION_PERSONA_CODES, verifyManifest, type CohortManifest } from '../src/lib/persona-cohort'
import { parseCreativeFile } from '../src/lib/persona-creative'
import { candidatesFor, NAME_LENGTH, verifyNamePolicy } from '../src/lib/persona-nickname-candidates'
import { nicknameCategoryOf, nicknameSpace, NICKNAME_LEXICON } from '../src/lib/persona-nickname-space'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { checkNameCollision } from './lib/persona-gate-name-collision.mjs'
import { assignDistinctNames, selectDistinctNames } from './lib/persona-name-space.mjs'
import {
  loadCanonAsset, opaqueRowsFrom, planAppendOnlyBundles, planBundles, speakerSupply, stableAssignment, type LocalComment,
} from './lib/persona-reference-store.mjs'
import { bundleDigest, compareVoiceDigests, loadVoiceDigestFixture } from './lib/persona-voice-digest.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let failN = 0
let notRun = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const src = (p: string): string => readFileSync(p, 'utf-8')
const repoRoot = process.cwd()

console.log('\n══ Persona 300+ 기반 fixture ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 코드 — 숫자순 · 정본 표기 · 단일 상한')
// ─────────────────────────────────────────────────────────
check('P2 · P10 · P99 · P100 은 숫자순이다', sortPersonaCodes(['P100', 'P2', 'P99', 'P10']).join(',') === 'P2,P10,P99,P100')
const two = Array.from({ length: 99 }, (_, i) => personaCodeOf(i + 1))
let pairDiff = 0
for (const a of two) for (const b of two) if (Math.sign(comparePersonaCodes(a, b)) !== Math.sign(a.localeCompare(b))) pairDiff += 1
check(`🔴 P01~P99 모든 쌍(${99 * 99})에서 숫자순 = 옛 사전순 — 지금 운영 순서는 바뀔 수 없다`, pairDiff === 0, `${pairDiff}쌍 다름`)
check('🔴 운영 universe 순서 = 옛 사전순 그대로', PRODUCTION_PERSONA_CODES.join(',') === [...PRODUCTION_PERSONA_CODES].sort().join(','))
check('반례 — 옛 사전순은 P100 을 P10 과 P11 사이에 둔다(고친 결함)', [...two, 'P100'].sort().indexOf('P100') === 10 && sortPersonaCodes([...two, 'P100']).at(-1) === 'P100')
check('정본 표기 — P01 · P99 · P100 · P999 는 코드', ['P01', 'P99', 'P100', 'P999'].every(isPersonaCode))
check('반례 — P1 · P001 · P00 · p01 은 코드가 아니다 (표기)', !['P1', 'P001', 'P00', 'p01', 'P01a'].some(isPersonaCode))
check(`🔴 반례 — 상한 다음 번호(P${PERSONA_CODE_MAX + 1})는 코드가 아니다 — 상한은 PERSONA_CODE_MAX 한 곳`, !isPersonaCode(personaCodeOf(PERSONA_CODE_MAX + 1)))
check('상한은 한 상수 — autogen · isPoolCode · verifyManifest 가 같은 값', AUTOGEN_CODE_LAST === PERSONA_CODE_MAX && isPoolCode(personaCodeOf(PERSONA_CODE_MAX)) && !isPoolCode(`P${PERSONA_CODE_MAX + 1}`))
const m = (codes: string[]): CohortManifest => ({ id: 'wave5-d10', purpose: 't', codes, requires: [] })
check('verifyManifest — 세 자리 코드를 받는다', verifyManifest(m(['P98', 'P99', 'P100', 'P120'])).length === 0, verifyManifest(m(['P98', 'P99', 'P100', 'P120'])).join(' / '))
check('반례 — verifyManifest 가 숫자순이 아닌 목록을 잡는다 (P100 이 P99 앞)', verifyManifest(m(['P100', 'P99'])).some((p) => p.includes('코드순')))
check('반례 — verifyManifest 가 비정본 표기를 잡는다', verifyManifest(m(['P1'])).some((p) => p.includes('정본 형식')))
const issued = nextAutogenCodes({ usedCodes: ['P01', 'P32'], count: 300 })
check('🔴 자동 발급이 P50 을 넘는다 — high-water P33 뒤로 300개 (P34 ~ P333)', issued.codes.length === 300 && issued.codes[0] === 'P34' && issued.codes.at(-1) === 'P333' && issued.problem === null)
const pool = parsePoolDoc(src(PERSONA_POOL_DOC))
const p05 = src(PERSONA_POOL_DOC).split('\n### P05 — ')[1]!.split('\n### ')[0]!
const asCard = (code: string): string => `### ${code} — 시험 카드\n${p05.slice(p05.indexOf('\n'))}`
const three = parsePoolDoc(asCard('P120'))
check('parsePoolDoc 가 세 자리 카드(P120)를 읽는다', three.cards.length === 1 && three.cards[0]!.code === 'P120' && three.problems.length === 0, three.problems.join(' / '))
check('반례 — parsePoolDoc 가 비정본 표기(P001)를 조용히 버리지 않고 문제로 올린다', parsePoolDoc(asCard('P001')).problems.some((p) => p.startsWith('P001')))
check('정본 Pool 문서는 그대로 읽힌다 (문제 0)', pool.problems.length === 0 && pool.cards.length >= 31)
const cr = { title: '시험', personality: ['차분함', '꼼꼼함', '다정함'], noGoTopics: ['연봉 액수'], noGoExpressions: ['"다 그렇지"'], variations: ['한 줄', '되묻기', '예시', '맞장구', '정리'] }
check('parseCreativeFile 가 세 자리 코드를 받는다', parseCreativeFile(JSON.stringify({ P120: cr })).ok)
check('반례 — parseCreativeFile 가 비정본 표기를 거부한다', !parseCreativeFile(JSON.stringify({ P1: cr })).ok)
const SORT_SITES = [
  'src/lib/persona-cohort.ts', 'src/lib/original-post-persona-match.ts', 'src/lib/persona-comment-planner.ts',
  'src/lib/content-core/speaker.ts', 'src/lib/content-core/speaker-availability.ts', 'src/lib/persona-contract-remediation.ts',
  'src/lib/persona-reserve.ts', 'src/lib/persona-creative.ts', 'scripts/lib/persona-autogen.mts', 'scripts/lib/persona-reference-store.mts',
]
for (const f of SORT_SITES) {
  const s = src(f)
  check(`🔴 ${f} — 코드를 문자열로 정렬하지 않는다`, !/\.code\.localeCompare\(|codes\)\]\.sort\(\)|personaCodes\)\]\.sort\(\)|\.codes\)\)\]\.sort\(\)/.test(s) && /comparePersonaCodes|sortPersonaCodes/.test(s))
}
const FORMAT_SITES: [string, RegExp][] = [
  ['src/lib/persona-card-verify.ts', /\[1-4\]\[0-9\]\|50/], ['src/lib/persona-cohort.ts', /\[1-4\]\[0-9\]\|50/],
  ['src/lib/persona-pool-card.ts', /\(P\\d\{2\}\)/], ['src/lib/persona-creative.ts', /\^P\\d\\d\$/], ['src/lib/persona-autogen.ts', /AUTOGEN_CODE_LAST = 50/],
]
for (const [f, re] of FORMAT_SITES) check(`🔴 ${f} — P50 · P99 하드코딩 상한이 없다`, !re.test(src(f)))

// ─────────────────────────────────────────────────────────
console.log('② 말투 — 보충 화자는 뒤에만 붙는다')
// ─────────────────────────────────────────────────────────
const say = (sp: string, n: number, tag: string): LocalComment[] => Array.from({ length: n }, (_, i) => ({
  speakerId: sp, text: `${tag} 그 마음 알 것 같아요 ${'정말 '.repeat(i + 1)}그렇네요`,
}))
// 정본 — 화자 4명(운영 3 + 남는 1) · 기준 통과
const canonRows = [...say('aaaaaaaaaaa1', 6, '가'), ...say('aaaaaaaaaaa2', 5, '나'), ...say('aaaaaaaaaaa3', 4, '다'), ...say('aaaaaaaaaaa4', 3, '라')]
const extraRows = [...say('bbbbbbbbbbb1', 9, '마'), ...say('bbbbbbbbbbb2', 8, '바'), ...say('bbbbbbbbbbb3', 3, '사')]
const PROD = ['P01', 'P02', 'P03']
const NEWC = ['P34', 'P35', 'P36']
const plan = planAppendOnlyBundles({ canonRows, extraRows, productionCodes: PROD, newCodes: NEWC })
const ref = planBundles({ rows: canonRows, personaCodes: PROD })
check('운영 코드 묶음 = 정본만으로 나눈 묶음 (보충이 더 많아도)',
  PROD.every((c) => bundleDigest(plan.byCode.get(c)) === bundleDigest(ref.bundles.find((b) => b.personaCode === c))) && plan.productionDrift.length === 0)
check('새 코드는 정본에 남은 화자를 먼저 받고(1) 나머지를 보충에서 받는다(2)', plan.fromCanon.join(',') === 'P34' && plan.fromExtra.join(',') === 'P35,P36')
check('보충 공급 수는 정본 중복을 뺀 뒤 같은 최소 근거 계약으로 센다',
  plan.extraSpeakers === 3 && plan.extraEligibleSpeakers === 3)
const noExtra = planAppendOnlyBundles({ canonRows, extraRows: [], productionCodes: PROD, newCodes: NEWC })
check('보충이 없으면 지금과 같다 — 새 코드 1명만 말투를 받는다', noExtra.fromCanon.length === 1 && noExtra.fromExtra.length === 0)
const tainted = planAppendOnlyBundles({
  canonRows, extraRows: [...extraRows, { speakerId: 'bbbbbbbbbbb1', text: canonRows[0]!.text }], productionCodes: PROD, newCodes: NEWC,
})
check('🔴 반례 — 정본 댓글과 같은 글자를 가진 보충 화자는 통째로 뺀다 (같은 말투 복제 금지)',
  tainted.excludedExtraSpeakers === 1
  && tainted.extraSpeakers === 2 && tainted.extraEligibleSpeakers === 2
  && NEWC.every((c) => !(tainted.byCode.get(c)?.comments ?? []).some((x) => x.text.startsWith('마 ')))
  && tainted.fromExtra.length === 2)
const big = planAppendOnlyBundles({ canonRows, extraRows: [...say('ccccccccccc1', 30, '아'), ...extraRows], productionCodes: PROD, newCodes: NEWC })
check('🔴 반례 — 보충 화자가 정본 화자보다 근거가 많아도 운영 묶음은 그대로', big.productionDrift.length === 0
  && PROD.every((c) => bundleDigest(big.byCode.get(c)) === bundleDigest(plan.byCode.get(c))))
check('🔴 세 자리 새 코드(P100)를 붙여도 운영 묶음은 그대로 — 옛 사전순이면 밀렸다',
  planAppendOnlyBundles({ canonRows, extraRows, productionCodes: ['P01', 'P02', 'P11'], newCodes: ['P100'] }).productionDrift.length === 0)
const opaque = opaqueRowsFrom([
  { author: '봄뜰하나', content: '저도 요즘 그래요 정말 그렇네요' }, { author: '봄뜰하나', content: '천천히 하셔도 돼요 괜찮아요' },
  { author: '겨울숲둘', content: '날이 많이 추워졌네요 감기 조심' }, { author: '겨울숲둘', body: '본문 자리는 읽지 않는다 정말로' },
])
check('보충 원자료 — 작성자는 남지 않고 12자 불투명 값 · 같은 사람은 같은 값',
  !JSON.stringify(opaque.rows).includes('봄뜰하나') && opaque.rows.every((r) => /^[0-9a-f]{12}$/.test(r.speakerId))
  && opaque.rows[0]!.speakerId === opaque.rows[1]!.speakerId && opaque.rows[0]!.speakerId !== opaque.rows[2]!.speakerId)
check('보충 원자료 — `content` 밖 자리(body)는 읽지 않는다', opaque.rows.length === 3 && opaque.skipped === 1)
const sup = speakerSupply(canonRows)
check('화자 공급 — 기준(관측 3 · 안전 2)을 넘는 화자 수를 센다', sup.speakers === 4 && sup.eligible === 4)
check('반례 — 관측 2 화자는 기준 통과가 아니라 "하나 모자람" 이다 (기준을 낮추지 않는다)',
  speakerSupply(say('ddddddddddd1', 2, '자')).eligible === 0 && speakerSupply(say('ddddddddddd1', 2, '자')).nearMiss === 1)
const store = src('scripts/lib/persona-reference-store.mts')
check('🔴 planAppendOnlyBundles · opaqueRowsFrom 은 파일 · DB 에 쓰지 않는다',
  !/writeFileSync|renameSync|prisma|\$executeRaw/.test(store.slice(store.indexOf('export function opaqueRowsFrom'), store.indexOf('export function stableAssignment'))))
// 🔴 정본 자산이 있으면 운영 30명 digest 를 실제로 대조한다
const canon = loadCanonAsset()
const voiceFixture = loadVoiceDigestFixture(repoRoot)
const cmp = compareVoiceDigests({
  fixture: voiceFixture, sourceDigest: canon.ok ? canon.sourceDigest : null,
  // The fixture freezes the original 30. Appended production codes are
  // covered by the immutable supplement and must not rewrite this baseline.
  order: voiceFixture.order, byCode: stableAssignment({ repoRoot }).byCode,
})
// 🔴 대조기 자체 — 자산이 없거나 다르면 미실행, 묶음이 바뀌면 changed (합성)
const fx = { sourceDigest: 'aaaa', order: ['P01'], digests: { P01: bundleDigest(plan.byCode.get('P01')) } }
const one = new Map([['P01', plan.byCode.get('P01')!]])
check('🔴 반례 — 자산이 없으면 대조는 미실행이다 (통과 아님)', compareVoiceDigests({ fixture: fx, sourceDigest: null, order: ['P01'], byCode: one }).status === 'notRun')
check('🔴 반례 — 다른 자산이면 미실행이다 (같음으로 세지 않는다)', compareVoiceDigests({ fixture: fx, sourceDigest: 'bbbb', order: ['P01'], byCode: one }).status === 'notRun')
check('같은 자산 · 같은 묶음 → same', compareVoiceDigests({ fixture: fx, sourceDigest: 'aaaa', order: ['P01'], byCode: one }).status === 'same')
check('🔴 반례 — 묶음이 바뀌면 changed', compareVoiceDigests({ fixture: fx, sourceDigest: 'aaaa', order: ['P01'], byCode: new Map([['P01', plan.byCode.get('P02')!]]) }).status === 'changed')
if (cmp.status === 'notRun') { notRun += 1; console.log(`  ⏸ 미실행  운영 30명 digest 대조 — ${cmp.reason}`) }
else check('🔴 운영 30명 말투 배정 digest = 고정값 (P01~P32)', cmp.status === 'same', cmp.changed.join(','))
if (canon.ok) {
  const real = planAppendOnlyBundles({ canonRows: canon.rows, extraRows: [], productionCodes: PRODUCTION_PERSONA_CODES, newCodes: ['P44', 'P100'] })
  check('🔴 실제 자산 — 세 자리 새 코드를 붙여도 운영 배정 변동 0', real.productionDrift.length === 0, real.productionDrift.join(','))
} else { notRun += 1; console.log('  ⏸ 미실행  실제 자산 세 자리 코드 drift — 정본 말투 자산이 없다') }

// ─────────────────────────────────────────────────────────
console.log('③ 이름 — 합성 공간 350+ · 300명 서로 구분')
// ─────────────────────────────────────────────────────────
const space = nicknameSpace()
check(`합성 공간 ${space.length} ≥ 350`, space.length >= 350)
// 🔴 길이 정본은 2~5자다(D100 canon §4.2 · runbook §2.1). 값을 박아 두어 상수가 2~3 으로 돌아가면 여기서 걸린다
check('🔴 길이 정본이 2~5자다', NAME_LENGTH.min === 2 && NAME_LENGTH.max === 5)
check('공간 전부 정본 정책 통과 · 2~5자 · 중복 0',
  space.every((n) => verifyNamePolicy(n).ok) && space.every((n) => [...n].length >= 2 && [...n].length <= 5) && new Set(space).size === space.length)
check('결정적이다 — 두 번 불러도 같은 순서', nicknameSpace().join() === space.join())
const old = new Set<string>()
for (let n = 1; n <= 999; n += 1) for (const x of candidatesFor(personaCodeOf(n), 10_000)) old.add(x)
const worst = selectDistinctNames({ sets: { personaNames: [...old] }, space })
check(`🔴 옛 후보 ${old.size}개가 전부 이미 쓰였다고 해도 서로 구분되는 이름 ${worst.picked.length} ≥ 300`, worst.picked.length >= 300)
const first300 = worst.picked.slice(0, 300)
let confusable = 0
for (let i = 0; i < first300.length; i += 1) {
  if (checkNameCollision(first300[i]!, { personaNames: first300.filter((_, j) => j !== i) }).status !== 'pass') confusable += 1
}
check('🔴 고른 300개는 서로 Gate ⑥-B pass 다 (쌍마다 다시 확인)', confusable === 0, `${confusable}개 혼동`)
const share = new Map<string, number>()
for (const n of first300) { const c = nicknameCategoryOf(n) ?? '?'; share.set(c, (share.get(c) ?? 0) + 1) }
const maxShare = Math.max(...share.values()) / first300.length
check(`300개가 한 갈래로 쏠리지 않는다 — 최대 갈래 ${(maxShare * 100).toFixed(0)}% ≤ 35% · 갈래 ${share.size}개`, maxShare <= 0.35 && share.size === Object.keys(NICKNAME_LEXICON).length)
const codes300 = nextAutogenCodes({ usedCodes: ['P33'], count: 300 }).codes
const a300 = assignDistinctNames(codes300, { personaNames: [...old], memberNames: [] })
check('300개 코드 전원에게 서로 다른 이름을 배정한다', a300.ok && new Set(a300.picked.values()).size === 300)
const tiny = assignDistinctNames(['P34', 'P35', 'P36'], { personaNames: [], memberNames: [] }, ['봄수국', '밤수국', '노을'])
check('🔴 반례 — 묶음 안에서 헷갈리는 이름(봄수국 · 밤수국)을 함께 고르지 않는다 → 전원 실패', !tiny.ok && tiny.picked.size === 2)
check('🔴 반례 — 회원 이름과 같은 후보는 고르지 않는다', !selectDistinctNames({ sets: { personaNames: [], memberNames: ['노을'] }, space: ['노을', '모과'] }).picked.includes('노을'))
check('회원 이름을 받지 않으면 상한(upper)이다', selectDistinctNames({ sets: { personaNames: [] }, space: ['모과'] }).bound === 'upper')
const gen = src('src/lib/persona-nickname-space.ts')
check('🔴 생성 규칙은 회원 · 원천 작가 · 크롤 원문을 읽지 않는다', !/prisma|\.author\b|authorOf|memberNames|readFileSync|fetch\(|voiceSource|CafePost/.test(gen))
check('🔴 생성 공간에 Persona 코드별 배정표가 없다', !/P\d{2}/.test(gen))
const autogen = src('scripts/persona-autogen.mts')
check('autogen 은 합성 공간 배정(assignDistinctNames)을 쓴다', /assignDistinctNames\(codes, db\.sets\)/.test(autogen) && !/assignCandidates\(/.test(autogen))
const cli = src('scripts/persona-scale-base.mts')
check('🔴 측정 CLI 는 쓰지 않는다 — --apply · --write 거부 · write 호출 0',
  /fail\('이 도구는 쓰지 않는다/.test(cli) && !/writeFileSync|\.create\(|\.update\(|\.upsert\(|\.delete\(/.test(cli))

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail · ⏸ ${notRun} 미실행\n`)
process.exit(failN === 0 ? 0 : 1)
