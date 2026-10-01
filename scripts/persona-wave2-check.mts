#!/usr/bin/env tsx
/**
 * Persona 2차 확장 도구 fixture — 🔴 **DB 0 · 네트워크 0 · 파일 write 0**
 *
 * 🔴 순서(생성 → seed → 검증 → 활성화)를 어기면 fail-closed 인지,
 *    대상이 P01·P02·P11 로 못박혀 있는지, 실행 게이트가 하나로 열리지 않는지를 고정한다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'


import {
  WAVE2_CODES, MVP_CODES, ACTIVATABLE_FROM, WAVE2_SEED_PATH, WAVE2_DISPLAYNAME_PATH,
  isWave2Code, checkWave2Keys, stageOf, judgeCreate, judgeSeed, judgeActivate, judgeActivateArgs,
  type Wave2State,
} from '../src/lib/persona-wave2'
import { preflightPersona, verifyPersonaSeed, verifyActivationAudit, type PersonaDbRow } from '../src/lib/persona-wave2-verify'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { checkNameCollision } from './lib/persona-gate-name-collision.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}
const S = (o: Partial<Wave2State> = {}): Wave2State => ({
  code: 'P01', exists: true, status: 'draft', hasNickname: true, seeded: true,
  accountCount: 0, providerId: null, ...o,
})
/** 세 명 전부 같은 상태 */
const all = (o: Partial<Wave2State> = {}): Wave2State[] => WAVE2_CODES.map((code) => S({ code, ...o }))

console.log('\n══ Persona 2차 확장 도구 fixture ══\n')

console.log('① 대상이 못박혀 있다')
{
  check('대상은 P01 · P02 · P11 3명이다', WAVE2_CODES.join(',') === 'P01,P02,P11')
  check('🔴 MVP 5명은 대상이 아니다', MVP_CODES.every((c) => !isWave2Code(c)))
  check('🔴 임의 코드를 받지 않는다', !isWave2Code('P03') && !isWave2Code('P20') && !isWave2Code('N01'))
  check('입력 키가 정확히 세 명이어야 한다', checkWave2Keys([...WAVE2_CODES]).length === 0)
  check('🔴 모자라면 거부', checkWave2Keys(['P01', 'P02']).some((p) => p.includes('없는 코드')))
  check('🔴 대상 밖 코드가 섞이면 거부', checkWave2Keys([...WAVE2_CODES, 'P05']).some((p) => p.includes('대상 밖')))
  check('🔴 중복 키를 거부', checkWave2Keys(['P01', 'P01', 'P02', 'P11']).some((p) => p.includes('중복')))
  // 🔴 전용 입력 파일 — MVP 파일을 덮어쓰지 않는다
  check('🔴 전용 입력 파일을 쓴다', WAVE2_SEED_PATH.includes('wave2') && WAVE2_DISPLAYNAME_PATH.includes('wave2'))
  check('🔴 MVP 입력 파일과 경로가 다르다',
    String(WAVE2_SEED_PATH) !== 'tmp/persona-seed.json'
    && String(WAVE2_DISPLAYNAME_PATH) !== 'tmp/persona-displayname-selected.json')
}

console.log('\n② 단계 판정')
{
  check('없으면 absent', stageOf(S({ exists: false, status: null, hasNickname: false, seeded: false })) === 'absent')
  check('draft 인데 seed 가 없으면 draft-no-seed', stageOf(S({ seeded: false })) === 'draft-no-seed')
  check('닉네임이 없어도 draft-no-seed', stageOf(S({ hasNickname: false })) === 'draft-no-seed')
  check('draft + seed + 닉네임이면 draft-seeded', stageOf(S()) === 'draft-seeded')
  check('active 면 active', stageOf(S({ status: 'active' })) === 'active')
}

console.log('\n③ 🔴 순서를 어기면 막는다 (fail-closed)')
{
  // 생성
  check('🟢 없으면 생성 가능', judgeCreate(all({ exists: false, status: null, hasNickname: false, seeded: false })).ok)
  check('🔴 이미 있으면 생성 거부', !judgeCreate(all()).ok)
  check('🔴 대상이 빠지면 거부', !judgeCreate([S({ exists: false })]).ok)

  // seed — 생성이 먼저다
  check('🔴 만들지 않았는데 seed 하면 거부',
    !judgeSeed(all({ exists: false, status: null })).ok)
  check('🟢 draft 면 seed 가능', judgeSeed(all({ seeded: false })).ok)
  check('🔴 이미 active 면 seed 거부 — 켜진 사람의 seed 를 바꾸지 않는다',
    !judgeSeed(all({ status: 'active' })).ok)

  // 활성화 — 생성 · seed · 닉네임이 전부 끝나야 한다
  check('🟢 전부 갖췄으면 활성화 가능', judgeActivate(all()).ok)
  check('🔴 없으면 활성화 거부', !judgeActivate(all({ exists: false, status: null })).ok)
  check('🔴 seed 가 비면 활성화 거부', !judgeActivate(all({ seeded: false })).ok)
  check('🔴 닉네임이 없으면 활성화 거부', !judgeActivate(all({ hasNickname: false })).ok)
  check('🔴 이미 active 면 거부', !judgeActivate(all({ status: 'active' })).ok)
  check('🔴 draft 가 아닌 상태에서 켜지 않는다', !judgeActivate(all({ status: 'paused' })).ok)
  // 🔴 한 명만 어긋나도 전부 막는다 — 일부 활성화 금지
  check('🔴 한 명만 seed 가 비어도 전부 막는다', (() => {
    const mixed = [S({ code: 'P01' }), S({ code: 'P02' }), S({ code: 'P11', seeded: false })]
    return !judgeActivate(mixed).ok
  })())
  check('🔴 대상이 빠지면 활성화 거부', !judgeActivate([S({ code: 'P01' }), S({ code: 'P02' })]).ok)
}

console.log('\n④ 🔴 실행 게이트 — 하나로 열리지 않는다')
{
  const base = { apply: true, limit: 3, actorUserId: 'u_1', reason: '확장' }
  check('🟢 넷을 다 주면 통과', judgeActivateArgs(base).ok)
  check('🔴 --apply 없으면 안 돈다', !judgeActivateArgs({ ...base, apply: false }).ok)
  check('🔴 --limit 없으면 안 돈다', !judgeActivateArgs({ ...base, limit: null }).ok)
  check('🔴 --limit 이 1이면 안 돈다 — 일부만 켜지 않는다', !judgeActivateArgs({ ...base, limit: 1 }).ok)
  check('🔴 --limit 이 5면 안 돈다', !judgeActivateArgs({ ...base, limit: 5 }).ok)
  check('🔴 ACTOR_USER_ID 없으면 안 돈다', !judgeActivateArgs({ ...base, actorUserId: null }).ok)
  check('🔴 공백 actor 도 거부', !judgeActivateArgs({ ...base, actorUserId: '   ' }).ok)
  check('🔴 --reason 없으면 안 돈다', !judgeActivateArgs({ ...base, reason: null }).ok)
  check('🔴 공백 reason 도 거부', !judgeActivateArgs({ ...base, reason: '  ' }).ok)
  check('활성화 출발 상태는 draft 뿐이다', ACTIVATABLE_FROM === 'draft')
}

console.log('\n⑤ 🔴 스크립트 계약 (소스)')
{
  const src = (f: string): string => readFileSync(join(HERE, '..', f), 'utf-8')
  const code = (f: string): string => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const assign = code('scripts/persona-wave2-assign.mts')
  const seed = code('scripts/persona-wave2-seed-apply.mts')
  const act = code('scripts/persona-wave2-activate.mts')

  // 🔴 대상을 인자로 받지 않는다
  for (const [name, c] of [['assign', assign], ['seed', seed], ['activate', act]] as const) {
    check(`🔴 ${name}: --code 인자를 받지 않는다`, !/--code/.test(c))
    check(`🔴 ${name}: WAVE2_CODES 정본을 쓴다`, /WAVE2_CODES/.test(c))
    check(`🔴 ${name}: 단일 트랜잭션이다`, /\$transaction/.test(c) || name === 'seed' || /\$transaction/.test(c))
    // 🔴 activate 는 `--apply` 하나가 아니라 **네 개**를 요구하므로 게이트 함수로 막는다
    check(`🔴 ${name}: 기본이 dry-run 이다 — --apply 없이 write 하지 않는다`,
      /if \(!APPLY\)/.test(c) || /judgeActivateArgs\(/.test(c))
  }
  // 🔴 생성은 draft 로만
  check('🔴 assign: status 를 active 로 올리지 않는다', !/status:\s*'active'/.test(assign))
  check('🔴 assign: Post · Comment 를 만들지 않는다', !/\.post\.create|\.comment\.create/.test(assign))
  check('🔴 assign: 기존 User 를 재사용하지 않는다', !/user\.upsert|user\.findFirst/.test(assign))
  check('🔴 assign: Gate ⑥-B 를 적용 직전에 다시 본다', /checkNameCollision\(/.test(assign))
  check('🔴 assign: 하나라도 막히면 전부 중단', /일부만 만들지 않습니다/.test(src('scripts/persona-wave2-assign.mts')))
  check('🔴 assign: 사후에 Post·Comment·Queue 불변을 대조한다', /drift/.test(assign))

  // 🔴 seed 는 status 를 건드리지 않는다
  check('🔴 seed: status 를 바꾸지 않는다', !/status:\s*'active'/.test(seed))
  check('🔴 seed: 정본 Pool 문서와 대조한다', /parsePoolDoc\(/.test(seed) && /verifySeedCard\(/.test(seed))
  check('🔴 seed: 순서 게이트를 부른다', /judgeSeed\(/.test(seed))
  check('🔴 seed: 적용 후 draft 유지를 확인한다', /status=draft 유지|!== 'draft'/.test(seed))

  // 🔴 활성화
  check('🔴 activate: 네 개를 모두 요구한다', /judgeActivateArgs\(/.test(act))
  check('🔴 activate: ACTOR_USER_ID 를 환경변수로 받는다', /process\.env\.ACTOR_USER_ID/.test(act))
  check('🔴 activate: 실회원 판정 정본을 부른다', /judgeRealMember\(/.test(act))
  check('🔴 activate: 발행하지 않는다', !/publishOriginalPostTx|\.post\.create/.test(act))
  check('🔴 activate: 순서 게이트를 부른다', /judgeActivate\(/.test(act))

  // 🔴 MVP 5명 도구·입력을 건드리지 않는다
  for (const [name, c] of [['assign', assign], ['seed', seed], ['activate', act]] as const) {
    // 🔴 **읽거나 쓰지** 않으면 된다. 안내 문구에서 "그 파일을 덮어쓰지 마세요" 라고
    //    언급하는 것은 오히려 필요하다 — 그것까지 위반으로 잡으면 경고를 못 적는다
    check(`🔴 ${name}: MVP 입력 파일을 읽거나 쓰지 않는다`,
      !/(readFileSync|existsSync|writeFileSync)\([^)]*persona-(displayname-selected|seed)\.json/.test(c))
  }
}

// ── ⑥ 🔴 Gate ⑥-B — 이미 있는 이름(회원 · Persona)은 막는다 · 크롤 작가 대조는 없다(2026-10-01 · #641) ──
console.log('\n⑥ Gate ⑥-B · 회원 · Persona 충돌')
{
  const NAME = '도토리'
  check('🔴 회원 이름과 겹치면 pass 가 아니다 (B1)',
    checkNameCollision(NAME, { memberNames: [NAME], personaNames: [] }).status !== 'pass')
  check('🔴 다른 Persona 이름과 겹치면 pass 가 아니다 (B3)',
    checkNameCollision(NAME, { memberNames: [], personaNames: [NAME] }).hits.some((h) => h.kind === 'B3_PERSONA'))

  // 🔴 생산 경로가 정본 조회 계층(B1 · B3)을 쓰고, 작가 해시 · salt 를 다시 들이지 않는가
  const assignSrc = readFileSync(join(HERE, '..', 'scripts/persona-wave2-assign.mts'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 assign 이 loadNameCollisionSets 로 대조 집합을 받는다', /loadNameCollisionSets\(/.test(assignSrc))
  check('🔴 assign 이 작가 해시 · salt · 공개 사슬을 쓰지 않는다',
    !/hashOf|authorHash|soransoran-voice-v1|VOICE_AUTHOR_HASH_SALT|createHash/.test(assignSrc))
}

// ── ⑦ 🔴 seed 완전성 — 생활사 5축만으로 판정하지 않는다 ──
console.log('\n⑦ seed 완전성 (DB 값 · 정본 대조)')
{
  const pool = parsePoolDoc(readFileSync(join(HERE, '..', 'docs/operations/2026-08-30-persona-pool-design.md'), 'utf-8'))
  const p01 = pool.cards.find((c) => c.code === 'P01')!

  /** 🔴 정본 P01 에서 만든 **완전한** DB 행 */
  const fullRow = (over: Partial<PersonaDbRow> = {}): PersonaDbRow => ({
    code: 'P01', status: 'draft', nickname: '도토리', accountCount: 0, providerId: null,
    ageBand: p01.ageBand, region: p01.region, lifeStage: '양육기',
    identity: {
      housing: p01.housing, parentCare: p01.parentCare, workStatus: p01.workStatus,
      childrenCount: p01.childrenCount, maritalStatus: p01.maritalStatus,
      economicStatus: p01.economicStatus, menopauseStatus: p01.menopauseStatus,
      childrenAgeBands: [...p01.childrenAgeBands],
      spouseRelationship: p01.spouseRelationship ?? '해당없음',
      personality: [...p01.personality],
    },
    voiceCore: { emoji: '가끔', ending: '~해요', length: p01.voiceLength, register: '존댓말' },
    voiceVariations: ['a', 'b', 'c', 'd', 'e', 'f'],
    activityRhythm: { burstiness: 0.3, activeHours: [[10, 13]], weekdayBias: 0.5 },
    noGoTopics: [...p01.noGoTopics], noGoExpressions: [...p01.noGoExpressions],
    forbiddenReactionRoles: [...p01.forbiddenReactionRoles],
    dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    auditCreated: 1, auditNameAssigned: 1,
    // 🔴 draft 기대일 때는 켜진 흔적이 없는 것이 정상이다
    auditStatusChanged: [], ...over,
  })

  check('🟢 완전한 seed 는 통과', verifyPersonaSeed(fullRow(), p01).complete)

  // 🔴 **생활사 5축 + length 만 있는 seed** — 예전 판정은 이것을 "완료" 로 봤다
  const partial = fullRow({
    voiceVariations: [], activityRhythm: {}, noGoTopics: [], forbiddenReactionRoles: [],
    lifeStage: null, dailyCap: null, weeklyCap: null, silenceRate: null,
  })
  check('🔴 생활사 5축만 있는 seed 는 미완이다', !verifyPersonaSeed(partial, p01).complete)
  check('🔴 그 seed 로는 활성화되지 않는다',
    !preflightPersona({ row: partial, poolCard: p01, expectStatus: 'draft' }).ok)

  // 🔴 개별 필드만 빠져도 미완
  for (const [label, over] of [
    ['voiceVariations 부족', { voiceVariations: ['a', 'b'] }],
    ['activityRhythm 없음', { activityRhythm: {} }],
    ['noGoTopics 빈 배열', { noGoTopics: [] }],
    ['forbiddenReactionRoles 빈 배열', { forbiddenReactionRoles: [] }],
    ['lifeStage 없음', { lifeStage: null }],
    ['silenceRate 없음', { silenceRate: null }],
    ['정본과 다른 길이', { voiceCore: { emoji: '가끔', ending: '~해요', length: '길게', register: '존댓말' } }],
  ] as const) {
    check(`🔴 ${label} 이면 미완`, !verifyPersonaSeed(fullRow(over as never), p01).complete)
  }
  check('🔴 정본 카드를 못 찾으면 미완', !verifyPersonaSeed(fullRow(), null).complete)

  // 🔴 preflight — 네 가지를 전부 본다
  check('🟢 전부 갖추면 preflight 통과', preflightPersona({ row: fullRow(), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 닉네임이 없으면 거부', !preflightPersona({ row: fullRow({ nickname: null }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 Account 1건이면 거부', !preflightPersona({ row: fullRow({ accountCount: 1 }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 Account 를 모르면 거부 (fail-closed)', !preflightPersona({ row: fullRow({ accountCount: null }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 providerId 가 있으면 거부', !preflightPersona({ row: fullRow({ providerId: 'kakao:1' }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 audit created 가 0이면 거부', !preflightPersona({ row: fullRow({ auditCreated: 0 }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 audit 가 2건이면 거부 (두 번 센 것)', !preflightPersona({ row: fullRow({ auditCreated: 2 }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 display_name_assigned 가 없으면 거부', !preflightPersona({ row: fullRow({ auditNameAssigned: 0 }), poolCard: p01, expectStatus: 'draft' }).ok)

  // 🔴 **TOCTOU** — 읽은 뒤 status 가 바뀌면 거부한다
  for (const st of ['active', 'paused', 'retired'] as const) {
    check(`🔴 읽은 뒤 status 가 ${st} 로 바뀌면 거부`,
      !preflightPersona({ row: fullRow({ status: st }), poolCard: p01, expectStatus: 'draft' }).ok)
  }
}

// ── ⑧ 🔴 seed 는 draft 에만 — paused · retired · active 전부 거부 ──
console.log('\n⑧ seed 대상 상태')
{
  const st = (status: string): Wave2State[] => WAVE2_CODES.map((code) => S({ code, status, seeded: false }))
  check('🟢 draft 면 허용', judgeSeed(st('draft')).ok)
  for (const bad of ['active', 'paused', 'retired'] as const) {
    check(`🔴 ${bad} 는 거부`, !judgeSeed(st(bad)).ok)
  }
  check('🔴 한 명만 paused 여도 전부 거부', (() => {
    const mixed = [S({ code: 'P01' }), S({ code: 'P02' }), S({ code: 'P11', status: 'paused' })]
    return !judgeSeed(mixed).ok
  })())
  check('🔴 대상이 빠지면 거부', !judgeSeed([S({ code: 'P01' })]).ok)
}

// ── ⑨ 🔴 audit 은 **persona 한 명씩** 센다 ──
//
//    총합만 보면 한 명에 두 번 남고 다른 한 명은 0건이어도 3건이라 통과한다.
console.log('\n⑨ audit 분포 · 활성화 흔적')
{
  const pool = parsePoolDoc(readFileSync(join(HERE, '..', 'docs/operations/2026-08-30-persona-pool-design.md'), 'utf-8'))
  const p01 = pool.cards.find((c) => c.code === 'P01')!
  const row = (over: Partial<PersonaDbRow> = {}): PersonaDbRow => ({
    code: 'P01', status: 'active', nickname: '도토리', accountCount: 0, providerId: null,
    ageBand: p01.ageBand, region: p01.region, lifeStage: '양육기',
    identity: {
      housing: p01.housing, parentCare: p01.parentCare, workStatus: p01.workStatus,
      childrenCount: p01.childrenCount, maritalStatus: p01.maritalStatus,
      economicStatus: p01.economicStatus, menopauseStatus: p01.menopauseStatus,
      childrenAgeBands: [...p01.childrenAgeBands],
      spouseRelationship: p01.spouseRelationship ?? '해당없음',
      personality: [...p01.personality],
    },
    voiceCore: { emoji: '가끔', ending: '~해요', length: p01.voiceLength, register: '존댓말' },
    voiceVariations: ['a', 'b', 'c', 'd', 'e', 'f'],
    activityRhythm: { burstiness: 0.3, activeHours: [[10, 13]], weekdayBias: 0.5 },
    noGoTopics: [...p01.noGoTopics], noGoExpressions: [...p01.noGoExpressions],
    forbiddenReactionRoles: [...p01.forbiddenReactionRoles],
    dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    auditCreated: 1, auditNameAssigned: 1,
    auditStatusChanged: [{ fromStatus: 'draft', toStatus: 'active', actorUserId: 'u_1', reason: '2차 확장' }],
    ...over,
  })
  const okAt = (r: PersonaDbRow): boolean => preflightPersona({ row: r, poolCard: p01, expectStatus: 'active' }).ok

  check('🟢 완전한 active 행은 통과', okAt(row()))
  // 🔴 **status 만 손으로 바꾼 행** — 켠 흔적이 없다
  check('🔴 status 만 active 로 바꾼 행은 --check 가 실패한다', !okAt(row({ auditStatusChanged: [] })))
  check('🔴 status_changed 가 2건이면 거부', !okAt(row({
    auditStatusChanged: [
      { fromStatus: 'draft', toStatus: 'active', actorUserId: 'u_1', reason: 'a' },
      { fromStatus: 'draft', toStatus: 'active', actorUserId: 'u_1', reason: 'b' },
    ],
  })))
  for (const [label, l] of [
    ['fromStatus 가 draft 가 아니면', { fromStatus: 'paused', toStatus: 'active', actorUserId: 'u_1', reason: 'a' }],
    ['toStatus 가 active 가 아니면', { fromStatus: 'draft', toStatus: 'paused', actorUserId: 'u_1', reason: 'a' }],
    ['actorUserId 가 비면', { fromStatus: 'draft', toStatus: 'active', actorUserId: null, reason: 'a' }],
    ['actorUserId 가 공백이면', { fromStatus: 'draft', toStatus: 'active', actorUserId: '   ', reason: 'a' }],
    ['reason 이 비면', { fromStatus: 'draft', toStatus: 'active', actorUserId: 'u_1', reason: null }],
    ['reason 이 공백이면', { fromStatus: 'draft', toStatus: 'active', actorUserId: 'u_1', reason: '  ' }],
  ] as const) {
    check(`🔴 ${label} 거부`, !okAt(row({ auditStatusChanged: [l] })))
  }
  // 🔴 draft 를 기대할 때는 켠 흔적이 없는 것이 정상이다
  check('🟢 draft 기대일 때는 status_changed 가 없어도 된다',
    preflightPersona({ row: row({ status: 'draft', auditStatusChanged: [] }), poolCard: p01, expectStatus: 'draft' }).ok)
  check('🔴 활성화 흔적 판정을 단독으로도 부를 수 있다', verifyActivationAudit(row({ auditStatusChanged: [] })).length > 0)

  // ── 🔴 **불균등 분포** — 총합 3건이지만 한 명에 몰린 경우 ──
  //    persona 단위 판정이면 P02·P11 이 0건이라 잡힌다
  const dist = [
    { code: 'P01', created: 2, named: 2 },
    { code: 'P02', created: 1, named: 1 },
    { code: 'P11', created: 0, named: 0 },
  ]
  const totalCreated = dist.reduce((n, d) => n + d.created, 0)
  check('🔴 총합은 3건이라 옛 판정은 통과했다 (그것이 결함이었다)', totalCreated === WAVE2_CODES.length)
  const perPersonaBad = dist.filter((d) => d.created !== 1 || d.named !== 1)
  check('🔴 persona 단위로 보면 2명이 잡힌다', perPersonaBad.length === 2)
  for (const d of dist) {
    const r = row({ code: d.code, auditCreated: d.created, auditNameAssigned: d.named })
    check(`🔴 ${d.code} (created ${d.created}) 판정이 맞다`, okAt(r) === (d.created === 1 && d.named === 1))
  }
}

// ── ⑩ 🔴 write 조건이 **생산 경로에 연결됐는가** ──
//
//    "바뀐 객체를 함수에 넣는" 시험은 순수 판정만 본다. 실제로 DB 에 쓰는 문장이
//    조건을 걸었는지는 소스의 **write 구문**을 봐야 안다.
console.log('\n⑩ write 조건 · 트랜잭션 계약')
{
  const code = (f: string): string => readFileSync(join(HERE, '..', f), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const seed = code('scripts/persona-wave2-seed-apply.mts')
  const act = code('scripts/persona-wave2-activate.mts')

  for (const [name, c, cond] of [
    ['seed', seed, "status: 'draft'"],
    ['activate', act, 'status: ACTIVATABLE_FROM'],
  ] as const) {
    // 🔴 조건부 updateMany 여야 한다 — `update({ where: { code } })` 는 그 사이 변경을 덮어쓴다
    check(`🔴 ${name}: 조건부 updateMany 를 쓴다 (code + status)`,
      new RegExp(`updateMany\\(\\{[\\s\\S]{0,120}?where:\\s*\\{\\s*code,\\s*${cond.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(c))
    check(`🔴 ${name}: count 가 1 이 아니면 throw 한다`, /u\.count !== 1/.test(c) && /throw new Error/.test(c))
    // 🔴 조건 없는 update 로 되돌아가지 않았는가
    check(`🔴 ${name}: 조건 없는 persona.update 를 쓰지 않는다`,
      !/\.persona\.update\(\{\s*where:\s*\{\s*code\s*\}/.test(c))
    // 🔴 Serializable — Account 경합까지 막는다
    check(`🔴 ${name}: Serializable 트랜잭션이다`, /isolationLevel:\s*'Serializable'/.test(c))
    // 🔴 트랜잭션 안에서 다시 읽고 preflight 를 부른다
    check(`🔴 ${name}: 트랜잭션 안에서 재확인한다`, /readDbRows\(tx\)/.test(c) && /preflightAll\(/.test(c))
    check(`🔴 ${name}: 재확인 실패면 throw 한다 — 3명 전부 롤백`, /throw new Error\(`트랜잭션 안 재확인 실패/.test(c))
  }
  // 🔴 assign --check 가 persona 단위로 센다
  const assign = code('scripts/persona-wave2-assign.mts')
  check('🔴 assign --check: personaId 단위로 groupBy 한다', /by:\s*\['personaId',\s*'action'\]/.test(assign))
  check('🔴 assign --check: 한 명씩 1건인지 본다', /n === 1/.test(assign))
  // 🔴 activate --check 가 status_changed 를 본다
  check('🔴 activate --check: status_changed 를 조회한다',
    /fromStatus:\s*true/.test(act) && /actorUserId:\s*true/.test(act) && /reason:\s*true/.test(act))
  check('🔴 activate --check: active 를 기대해 preflight 를 부른다', /expectStatus:\s*'active'/.test(act))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
