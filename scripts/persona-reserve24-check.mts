#!/usr/bin/env tsx
/**
 * Persona 계약 24 — **순수 반례** (DB · 네트워크 · LLM 0) · 2026-10-01 Phase F
 *
 *   ① 말투 근거 — `judgeVoiceEvidence` 하나: 관측 3건 이상 + 안전 원문 2건 이상 · 경험형은 style-only
 *   ② provider payload — 경험형 원문 · 화자 식별자 0 · 안전 예시만 · 원글 본문은 묶음에 없다
 *   ③ 배정 — 한 화자 = 한 Persona · 옛 판(안전 3건 이상)에서 서 있던 배정은 그대로
 *   ④ 말끝 — 필수 칸이 아니다 · 카드가 명시하면 정확히 대조 · variation 수는 카드와 같아야 한다
 *   ⑤ 이름 — 완전/정규화 일치 · 실제 혼동은 막고, 한 음절만 같은 이름은 통과(코드별 예외 0)
 *   ⑥ 정본 자산이 있으면(로컬) 실물 24 묶음으로 같은 것을 다시 본다 — 없으면(CI) 건너뛴다고 말한다
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { explicitEndingsOf, verifySeedCard } from '../src/lib/persona-card-verify'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { noGoExpressionKey } from '../src/lib/persona-no-go'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import {
  bundlesAreDistinct, judgeReferenceBundle, judgeVoiceEvidence, type VoiceReferenceBundle,
} from '../src/lib/persona-voice-reference'
import { checkNameCollision, nameConfusion } from './lib/persona-gate-name-collision.mjs'
import { buildPrompt } from './lib/persona-prompt'
import {
  BUNDLE_MAX, carriesExperience, loadCanonAsset, planBundles, referenceSeedShareCount, stableAssignment,
  type LocalComment,
} from './lib/persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const cards = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards
const card = (code: string): PoolCard => cards.find((c) => c.code === code)!

/** 🔴 경험형 · 안전 댓글 — `carriesExperience` 가 실제로 그렇게 가르는지 먼저 확인한다(가짜 fixture 금지) */
const EXP = ['저도 작년에 그거 겪었어요 정말 힘들었어요', '저는 남편이랑 지난달에 다녀왔는데 좋았어요', '제가 예전에 병원에서 들은 얘기예요']
const SAFE = ['그러게요 정말 그렇네요', '맞아요 그 마음 알 것 같아요', '천천히 하시면 돼요', '오늘은 좀 쉬세요', '그 말이 딱 맞네요']

console.log('\n① 말투 근거 판정 — 하나의 정본 함수')
{
  check('fixture: 경험형 문장은 경험형이다', EXP.every(carriesExperience), EXP.filter((t) => !carriesExperience(t)).join(' / '))
  check('fixture: 안전 문장은 경험형이 아니다', SAFE.every((t) => !carriesExperience(t)))
  check('관측 3 · 안전 2 → 선다', judgeVoiceEvidence({ observed: 3, safeTexts: 2 }).ok)
  check('관측 2 · 안전 2 → 서지 않는다(관측 하한 3 유지)', !judgeVoiceEvidence({ observed: 2, safeTexts: 2 }).ok)
  check('관측 4 · 안전 1 → 서지 않는다(안전 원문 2 하한)', !judgeVoiceEvidence({ observed: 4, safeTexts: 1 }).ok)
  const b = judgeReferenceBundle({ personaCode: 'PX', texts: SAFE.slice(0, 2), styleOnlyTexts: [EXP[0]!] })
  check('묶음: 안전 2 + style-only 1 → 선다', b.ok)
  if (b.ok) {
    check('🔴 묶음 원문은 안전 2건뿐 — 경험형 원문 0', b.bundle.comments.length === 2 && !b.bundle.comments.some((c) => carriesExperience(c.text)))
    check('관측 총수 3 · style-only 1 · 길이 분포는 관측 3건', b.bundle.observedCount === 3 && b.bundle.styleOnlyCount === 1 && b.bundle.lengths.count === 3)
  }
  check('묶음: 안전 2 만(관측 2) → REFERENCE_TOO_FEW', !judgeReferenceBundle({ personaCode: 'PX', texts: SAFE.slice(0, 2) }).ok)
  check('🔴 style-only 가 원문과 같은 문장이면 관측에 두 번 세지 않는다',
    !judgeReferenceBundle({ personaCode: 'PX', texts: SAFE.slice(0, 2), styleOnlyTexts: [SAFE[0]!] }).ok)
}

// 화자 fixture — A 안전 3 · B 안전 2 + 경험 1 · C 안전 2 + 경험 2 · D 안전 2(관측 2) · E 안전 1 + 경험 3
const sp = (id: string, safe: readonly string[], exp: readonly string[]): LocalComment[] =>
  [...safe, ...exp].map((text) => ({ speakerId: id, text }))
const uniq = (id: string, xs: readonly string[]): string[] => xs.map((x) => `${x} ${id}`)
const ROWS: LocalComment[] = [
  ...sp('aaaa', uniq('a', SAFE.slice(0, 3)), []),
  ...sp('bbbb', uniq('b', SAFE.slice(0, 2)), uniq('b', EXP.slice(0, 1))),
  ...sp('cccc', uniq('c', SAFE.slice(1, 3)), uniq('c', EXP.slice(0, 2))),
  ...sp('dddd', uniq('d', SAFE.slice(0, 2)), []),
  ...sp('eeee', uniq('e', SAFE.slice(0, 1)), uniq('e', EXP)),
]

console.log('\n② provider payload — 안전 예시만')
{
  const plan = planBundles({ rows: ROWS, personaCodes: ['P01', 'P02', 'P03', 'P04', 'P05'] })
  const codes = plan.bundles.map((b) => b.personaCode)
  check(`선 화자 3명(A·B·C) → P01~P03 · D(관측 2) · E(안전 1) 탈락 [${codes.join(',')}]`, codes.join(',') === 'P01,P02,P03')
  check('blocker 를 숨기지 않는다(5명 중 3명)', plan.blocks.some((b) => b.includes('화자가 3명뿐')))
  const expTexts = ROWS.filter((r) => carriesExperience(r.text)).map((r) => r.text)
  check('🔴 모든 묶음 원문에 경험형 0', plan.bundles.every((b) => !b.comments.some((c) => expTexts.includes(c.text))))
  check('관측 ≥ 3 · 안전 원문 ≥ 2 (전 묶음)', plan.bundles.every((b) => b.observedCount >= 3 && b.comments.length >= 2))
  check('표의 말투 근거 수 = 관측 총수', plan.table.every((t) => t.anchorComments === t.safeTexts + t.styleOnly && t.anchorComments >= 3))
  const persona = (code: string) => ({
    code, ageBand: '50대 초반', region: '수도권', lifeStage: '자녀 독립기', identity: { maritalStatus: '기혼' },
    voiceCore: { length: '짧은 문장', register: '존댓말', emoji: '없음' }, voiceVariations: ['a'],
    noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  })
  const post = { title: '요즘 잠이 안 와요', content: '밤마다 깨요', boardLabel: '갱년기톡' }
  for (const b of plan.bundles) {
    const pr = buildPrompt({ persona: persona(b.personaCode), post, reactionType: 'empathy', reference: b })
    check(`${b.personaCode} payload 가 선다`, pr.ok)
    if (!pr.ok) continue
    const payload = `${pr.prompt.systemPrompt}\n${pr.prompt.userPayload}`
    check(`🔴 ${b.personaCode} payload — 경험형 원문 0 · 화자 id 0 · 안전 예시 ${b.comments.length}건 전부`,
      !expTexts.some((t) => payload.includes(t)) && !['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'].some((id) => payload.includes(id))
      && b.comments.every((c) => payload.includes(c.text)))
  }
  check('🔴 묶음 타입에 화자 · 원글 자리가 없다(텍스트 · 숫자만)', plan.bundles.every((b) =>
    Object.keys(b).sort().join(',') === 'anchorCount,anchorRatio,comments,lengths,observedCount,personaCode,style,styleOnlyCount,supplementCount'
    && b.comments.every((c) => Object.keys(c).join(',') === 'text')))
  // 🔴 경험형 원문을 싣는 escape hatch 가 없다 — 옵션 · 분기 자체가 소스에 없다
  const storeSrc = readFileSync('scripts/lib/persona-reference-store.mts', 'utf-8')
  check('🔴 escape hatch 0 — reference-store 에 allowExperience 가 없다', !/allowExperience/.test(storeSrc))
  check('🔴 경험형 분기는 무조건 style-only — `const exp = carriesExperience(r.text)`', /const exp = carriesExperience\(r\.text\)\n/.test(storeSrc))
}

/** 🔴 옛 판(경험형을 먼저 지우고 안전 3건 이상만 후보) 그대로 — 같은 키로 정렬 */
const oldAssign = (rows: readonly LocalComment[], codes: readonly string[]): Map<string, string[]> => {
  const by = new Map<string, string[]>()
  for (const r of rows.filter((x) => !carriesExperience(x.text))) {
    const cur = by.get(r.speakerId) ?? []
    if (!cur.includes(r.text)) cur.push(r.text)
    by.set(r.speakerId, cur)
  }
  const sps = [...by.entries()].filter(([, t]) => t.length >= 3).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const out = new Map<string, string[]>()
  const cs = [...new Set(codes)].sort()
  for (let i = 0; i < Math.min(cs.length, sps.length); i += 1) {
    const own = sps[i]![1].slice().sort((a, b) => [...a].length - [...b].length || a.localeCompare(b))
    out.set(cs[i]!, own.length <= BUNDLE_MAX ? own : Array.from({ length: BUNDLE_MAX }, (_, k) => own[Math.floor(k * (own.length / BUNDLE_MAX))]!))
  }
  return out
}

console.log('\n③ 배정 — 한 화자 한 Persona · 옛 배정 보존')
{
  const codes = ['P01', 'P02', 'P03', 'P04', 'P05']
  const before = oldAssign(ROWS, codes)
  const now = planBundles({ rows: ROWS, personaCodes: codes })
  check(`옛 판에서 서 있던 ${before.size}명의 원문이 그대로`, [...before].every(([c, t]) =>
    JSON.stringify(now.bundles.find((b) => b.personaCode === c)?.comments.map((x) => x.text)) === JSON.stringify(t)))
  check('한 화자를 두 Persona 에 쓰지 않는다(원문 중복 0)', bundlesAreDistinct(now.bundles).distinct)
  const byCode = new Map(now.bundles.map((b) => [b.personaCode, b] as const))
  check('seed 재사용 1(전 묶음)', now.bundles.every((b) => referenceSeedShareCount(byCode, b.personaCode) === 1))
}

console.log('\n④ 말끝 — 옛 필수 권위 삭제 · 명시된 말끝은 정확히 대조')
{
  const seed = (code: string, voice: Record<string, unknown>, vv?: number): Record<string, unknown> => {
    const c = card(code)
    return {
      identity: {
        maritalStatus: c.maritalStatus, spouseRelationship: c.maritalStatus === '기혼' ? (c.spouseRelationship ?? '원만') : '해당없음',
        childrenCount: c.childrenCount, childrenAgeBands: [...c.childrenAgeBands], parentCare: c.parentCare,
        menopauseStatus: c.menopauseStatus, workStatus: c.workStatus, economicStatus: c.economicStatus,
        housing: c.housing, personality: [...c.personality],
      },
      voiceCore: { length: c.voiceLength, register: '존댓말', emoji: '없음', ...voice },
      voiceVariations: Array.from({ length: vv ?? c.variationCount }, (_, i) => `v${i}`),
      activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
      ageBand: c.ageBand, region: c.region, lifeStage: c.title,
      noGoTopics: [...c.noGoTopics], noGoExpressions: c.noGoExpressions.map(noGoExpressionKey), forbiddenReactionRoles: [...c.forbiddenReactionRoles],
      dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    }
  }
  check('카드 명시 말끝 읽기: P01 ["~해요"] · P02 둘 · P15 · P17 · P10(따옴표 없음) 없음',
    JSON.stringify(explicitEndingsOf(card('P01').voiceTokens)) === '["~해요"]' && explicitEndingsOf(card('P02').voiceTokens).length === 2
    && explicitEndingsOf(card('P15').voiceTokens).length === 0 && explicitEndingsOf(card('P17').voiceTokens).length === 0
    && explicitEndingsOf(card('P10').voiceTokens).length === 0 && explicitEndingsOf(card('P03').voiceTokens).length === 0)
  check('🔴 카드가 말끝을 적지 않은 P15 · P17 — 말끝 없이 통과', verifySeedCard('P15', seed('P15', {}), card('P15')).length === 0
    && verifySeedCard('P17', seed('P17', {}), card('P17')).length === 0, verifySeedCard('P15', seed('P15', {}), card('P15')).join(' / '))
  check('🔴 명시된 말끝(P01) — 없으면 막힌다', verifySeedCard('P01', seed('P01', {}), card('P01')).some((p) => p.includes('voiceCore.ending 이 없다')))
  check('🔴 명시된 말끝(P01) — 다르면 막힌다', verifySeedCard('P01', seed('P01', { ending: '~네요' }), card('P01')).some((p) => p.includes('voiceCore.ending 이 정본과 다르다')))
  check('명시된 말끝(P01) — 같으면 통과', verifySeedCard('P01', seed('P01', { ending: '~해요' }), card('P01')).length === 0)
  check('명시 둘(P02) — 둘 중 하나면 통과', verifySeedCard('P02', seed('P02', { ending: '~더라고요' }), card('P02')).length === 0)
  check('🔴 variation 수가 카드와 다르면 막힌다', verifySeedCard('P17', seed('P17', {}, card('P17').variationCount - 1), card('P17')).some((p) => p.includes('정본 variation')))
  check('🔴 말투 기본 칸(register)이 비면 여전히 막힌다', verifySeedCard('P15', seed('P15', { register: '' }), card('P15')).includes('voiceCore.register'))
}

console.log('\n⑤ 이름 혼동 — 일반 판정 하나')
{
  const vs = (a: string, b: string): string => checkNameCollision(a, { personaNames: [b] }).status
  check('🔴 달맞이 ↔ 패랭이 (한 음절만 같다) → pass', vs('달맞이', '패랭이') === 'pass' && vs('패랭이', '달맞이') === 'pass',
    JSON.stringify(nameConfusion('달맞이', '패랭이')))
  check('🔴 완전 일치 → reject', vs('달맞이', '달맞이') === 'reject')
  check('🔴 정규화 일치(공백·기호) → reject', vs('달 맞이', '달맞이') === 'reject' && vs('달맞이~', '달맞이') === 'reject')
  check('🔴 3음절 한 음절 차이(달맞이 ↔ 달맞기) → review', vs('달맞이', '달맞기') === 'review')
  check('🔴 자모 거리 2(물봉선 ↔ 물방석) → review', vs('물봉선', '물방석') === 'review', JSON.stringify(nameConfusion('물봉선', '물방석')))
  check('🔴 5음절 한 음절 차이 → reject', vs('봄날의햇살', '봄날의햇빛') === 'reject')
  check('🔴 6음절 두 음절 차이 → review', vs('바람부는언덕', '바람부는들판') === 'review')
  check('🔴 4음절 절반 공유(솔잎바다 ↔ 솔잎하늘) → review', vs('솔잎바다', '솔잎하늘') === 'review')
  check('4음절 한 음절만 공유(솔잎바다 ↔ 들꽃하늘) → pass', vs('솔잎바다', '들꽃하늘') === 'pass')
  check('3음절 두 음절 차이 · 자모도 멀다(민들레 ↔ 봉숭아) → pass', vs('민들레', '봉숭아') === 'pass')
  check('🔴 반복 축약 일치 → reject', vs('하하하하늘', '하늘') === 'reject')
  const src = readFileSync('scripts/lib/persona-gate-name-collision.mts', 'utf-8')
  check('🔴 코드별 예외 0 — 판정부에 Persona 코드 · 특정 이름이 없다', !/P\d{2}|달맞이|패랭이/.test(src))
}

console.log('\n⑥ 정본 자산 실물 (로컬만)')
{
  const canon = loadCanonAsset()
  if (!canon.ok) {
    console.log(`   🟡 정본 자산 없음(${canon.code}) — 실물 검사는 건너뛴다. ①~③ 이 같은 계약을 fixture 로 본다`)
  } else {
    const st = stableAssignment({ repoRoot: process.cwd() })
    const bundles = PRODUCTION_PERSONA_CODES.map((c) => st.byCode.get(c)).filter((b): b is VoiceReferenceBundle => b !== undefined)
    check(`실물: 정본 universe 전부 묶음 (${bundles.length}/${PRODUCTION_PERSONA_CODES.length})`, bundles.length === PRODUCTION_PERSONA_CODES.length)
    check('실물: 24 묶음 distinct(원문 겹침 0)', bundlesAreDistinct(bundles).distinct, bundlesAreDistinct(bundles).detail)
    const digests = new Set(bundles.map((b) => createHash('sha256').update(JSON.stringify(b.comments.map((c) => c.text))).digest('hex')))
    check('실물: 정본 universe 묶음 digest 서로 다름', digests.size === PRODUCTION_PERSONA_CODES.length)
    check('실물: 관측 ≥ 3 · 안전 원문 ≥ 2 (전 묶음)', bundles.every((b) => b.observedCount >= 3 && b.comments.length >= 2))
    const expTexts = new Set(canon.rows.filter((r) => carriesExperience(r.text)).map((r) => r.text))
    const speakers = [...new Set(canon.rows.map((r) => r.speakerId))].filter((s) => s !== '')
    let leak = 0
    for (const b of bundles) {
      const pr = buildPrompt({
        persona: { code: b.personaCode, ageBand: '50대', region: '수도권', lifeStage: 'x', identity: {}, voiceCore: { length: '짧은 문장' },
          voiceVariations: [], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [] },
        post: { title: '제목', content: '본문', boardLabel: '자유게시판' }, reactionType: 'empathy', reference: b,
      })
      if (!pr.ok) { leak += 1; continue }
      const payload = `${pr.prompt.systemPrompt}\n${pr.prompt.userPayload}`
      if ([...expTexts].some((t) => payload.includes(t)) || speakers.some((s) => payload.includes(s))) leak += 1
      if (!b.comments.every((c) => payload.includes(c.text))) leak += 1
    }
    check(`🔴 실물 payload 24건 — 경험형 원문 0 · 화자 id 0 · 안전 예시만 (문제 ${leak})`, leak === 0)
    const byCode = st.byCode
    check('실물: seed 재사용 1(전 묶음)', bundles.every((b) => referenceSeedShareCount(byCode, b.personaCode) === 1))
    const old = oldAssign(canon.rows, PRODUCTION_PERSONA_CODES)
    const moved = [...old].filter(([c, t]) => JSON.stringify(st.byCode.get(c)?.comments.map((x) => x.text)) !== JSON.stringify(t))
    check(`🔴 실물: 옛 판에서 서 있던 ${old.size}명의 원문 그대로 (바뀐 것 ${moved.length})`, old.size === 18 && moved.length === 0)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail — DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
