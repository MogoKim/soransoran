#!/usr/bin/env tsx
/**
 * Persona **4상태 판정** fixture — 🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0 (2026-09-30)
 *
 *   npx tsx scripts/persona-reserve-check.mts
 *   (CI 는 `persona:autogen-check` 가 ⑦ 절로 이 검사를 함께 돈다)
 *
 * 🔴 반례는 한 칸씩만 비튼다 — 다른 이유로 막혀 우연히 통과하지 않게, **그 축** 의 결과를 본다.
 * 🔴 자격 충돌 재현은 정본 카드 문서(P07·P10·P15·P17)와 운영 seed 결손 모양(lifeStage null ·
 *    noGoTopics 비어 있음)을 그대로 넣어 운영 검증기(`verifySeedCard`)가 실제로 잡는지 본다.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { LIFE_CONTRACT_FIELDS } from '../src/lib/content-core/speaker'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { verifySeedCard } from '../src/lib/persona-card-verify'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import {
  contractAxes, historyFromEvents, judgePersonaReserve, judgePersonaState, reserveFloorGap, roleShareOf,
  SHARE_MIN_EVENTS,
  type ActivityHistory, type PersonaReserveInput, type QualificationEvidence,
} from '../src/lib/persona-reserve'
import { ROLE_SHARE_CAP } from '../src/lib/d100-persona-scale'
import {
  autogenCodeOf, distinctSubjectOfCard, judgeDistinctness,
  type AutogenCandidate, type Cadence, type LifeSkeleton, type PersonaCreative,
} from '../src/lib/persona-autogen'
import { judgeAutogenBatch } from './lib/persona-autogen.mjs'
import { readPersonaReserve, type PersonaReserveRow } from './lib/d100-persona-tiers.mjs'
import { seedCompleteOf, seedOfRow } from './lib/persona-reserve-facts.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

type Check = (name: string, ok: boolean) => void

export async function runPersonaReserveChecks(check: Check): Promise<void> {
  // ── 재료 ──
  const ALL = [...LIFE_CONTRACT_FIELDS]
  const QUAL_OK: QualificationEvidence = {
    seedProblems: [], realMember: { accountCount: 0, providerId: null }, nameGate: 'pass', seedComplete: true,
  }
  const H0: ActivityHistory = {
    recentEvents: 0, roleCounts: {}, unresolvedRoleEvents: 0, consecutiveExposures: 0,
    postsSinceLastPairing: 'never', daysSinceActive: null, activityToday: 0,
  }
  const P = (o: Partial<PersonaReserveInput> = {}): PersonaReserveInput => ({
    code: 'P90', stored: true, status: 'draft',
    card: { filledAxes: ALL, ageBand: '50대 초반', voiceComments: 3 },
    qualification: QUAL_OK, history: H0, ...o,
  })
  const state = (o: Partial<PersonaReserveInput>) => judgePersonaState(P(o))

  console.log('⑦-1 4상태')
  check('계약 통과 · draft → reserve', state({}).state === 'reserve')
  check('계약 통과 · paused → reserve', state({ status: 'paused' }).state === 'reserve')
  check('계약 통과 · active → stage-active', state({ status: 'active' }).state === 'stage-active')
  check('retired → 네 상태 밖(null)', state({ status: 'retired' }).state === null)
  check('DB 행 없음 → designed (계약을 재지 않는다)',
    state({ stored: false, status: null }).state === 'designed' && state({ stored: false, status: null }).contract === null)

  console.log('⑦-2 반례 — 한 칸씩')
  {
    // 🔴 (2026-10-01 · C8) 개인 말버릇은 없어도 되는 칸 — 전원 공통 금지는 `persona-no-go` 가 강제한다
    const noExpr = state({ card: { filledAxes: ALL.filter((a) => a !== 'noGoExpressions'), ageBand: '50대 초반', voiceComments: 3 } })
    check('🔴 개인 noGo 표현 없음 → 계약 통과 (C8)', noExpr.contract?.valid === true && noExpr.contract.blocked.lifeAxes === undefined)
    const noTopic = state({ card: { filledAxes: ALL.filter((a) => a !== 'noGoTopics'), ageBand: '50대 초반', voiceComments: 3 } })
    check('🔴 noGo 소재 없음 → 여전히 lifeAxes 막힘 (소재 경계는 약화하지 않는다)',
      noTopic.state === 'qualification-pending' && noTopic.contract?.blocked.lifeAxes?.includes('noGoTopics') === true)
    const thin = state({ card: { filledAxes: ALL, ageBand: '50대 초반', voiceComments: 2 } })
    check('말투 근거 2건(<3) → qualification-pending · voiceEvidence 막힘',
      thin.state === 'qualification-pending' && thin.contract?.blocked.voiceEvidence !== undefined)
    const noAge = state({ card: { filledAxes: ALL, ageBand: null, voiceComments: 3 } })
    check('나이대 없음 → pending · ageBand', noAge.contract?.blocked.ageBand !== undefined)
  }
  {
    const dormantActive = state({ status: 'active', history: { ...H0, daysSinceActive: 45 } })
    check('휴면(active · 45일 전 활동) → 계약은 통과(stage-active) · observations.dormantActive',
      dormantActive.state === 'stage-active' && dormantActive.observations.dormantActive)
    const neverUsed = state({})
    check('이력 0 draft → 휴면 아님 · reserve · cadence 근거 없음으로 표시',
      neverUsed.state === 'reserve' && !neverUsed.observations.dormantActive && neverUsed.observations.noCadenceEvidence)
    // 🔴 변이 방지 — dormant 가 계약에 새면 이 줄이 깨진다
    check('휴면은 계약 축 어디에도 없다', Object.keys(dormantActive.contract?.blocked ?? {}).length === 0)
  }
  {
    const h0 = contractAxes(P())
    check('이력 0 → 역할 0 · 연속 0 · 짝 never → 통과(근거 none)',
      h0.valid && h0.evidence.roleShare === 'none' && h0.evidence.consecutiveExposures === 'none')
    // 🔴 (2026-10-01 · C9) 라벨 없는 소재 쏠림 축은 지웠다 — 활동이 쌓여도 지속 자격은 그대로다(P02 반례)
    const at = (n: number) => contractAxes(P({ history: { ...H0, recentEvents: n, daysSinceActive: 1 } }))
    check('🔴 활동 1 · 4 · 5 · 50건 → 전부 contract-valid · 회차 모름 0 (쓰일수록 빠지지 않는다)',
      [1, 4, 5, 50].every((n) => at(n).valid && at(n).roundUnknown.length === 0))
    check('🔴 소재 축이 판정에 없다 — 옛 `topicShareOf` · `topicConcentrated` 0',
      !('topicShare' in at(5).evidence) && !('topicShare' in at(5).unknown) && !('topicShare' in at(5).blocked))
    check('이력을 못 읽음(null) → 연속·짝 계약 모름 · 역할 회차 모름',
      ['consecutiveExposures', 'postsSinceLastPairing']
        .every((a) => contractAxes(P({ history: null })).unknown[a as 'consecutiveExposures'] !== undefined)
      && contractAxes(P({ history: null })).roundUnknown.includes('roleShare'))
    check('자격 재료 못 읽음(null) → 자격 충돌 모름 → pending',
      state({ qualification: null }).state === 'qualification-pending'
      && state({ qualification: null }).contract?.unknown.qualificationConflict !== undefined)
    check('Gate ⑥-B 미측정(salt 없음) → 모름',
      contractAxes(P({ qualification: { ...QUAL_OK, nameGate: null, nameGateUnknown: 'salt 없음' } })).unknown.qualificationConflict?.includes('salt') === true)
    check('실회원(Account 1) → 자격 충돌 막힘',
      contractAxes(P({ qualification: { ...QUAL_OK, realMember: { accountCount: 1, providerId: null } } })).blocked.qualificationConflict !== undefined)
    check('seed 불완전 → 자격 충돌 막힘(planner PERSONA_SEED_INCOMPLETE 와 같은 뜻)',
      contractAxes(P({ qualification: { ...QUAL_OK, seedComplete: false } })).blocked.qualificationConflict !== undefined)
  }
  {
    const hr = (roleCounts: Record<string, number>, unresolved = 0): ActivityHistory =>
      ({ ...H0, roleCounts, unresolvedRoleEvents: unresolved, recentEvents: 0, daysSinceActive: 1 })
    check(`역할 표본 < ${SHARE_MIN_EVENTS} → 비율을 재지 않는다(0 · thin)`, (() => {
      const r = roleShareOf(hr({ empathy: 2 }))
      return !('unknown' in r) && r.value === 0 && r.evidence.startsWith('thin')
    })())
    // 🔴 (2026-10-01 · C9) 역할 쏠림도 같은 혼동이었다 — 최근 창 비율이 지속 자격을 빼앗았다. 회차에서만 막는다
    const role5 = contractAxes(P({ history: hr({ empathy: 5 }) }))
    check('🔴 역할 5건 전부 empathy → 이번 회차 막힘 · contract-valid 유지', role5.valid && role5.roundBlocked.includes('roleShare'))
    check('역할 5건 3:2 → 0.6 > 0.5 회차 막힘 · 5건 2:2:1 → 회차 통과 (문턱 0.5 · 하한 5 불변)',
      contractAxes(P({ history: hr({ empathy: 3, question: 2 }) })).roundBlocked.includes('roleShare')
      && !contractAxes(P({ history: hr({ empathy: 2, question: 2, experience: 1 }) })).roundBlocked.includes('roleShare'))
    check('역할 모르는 댓글 1건 → 이번 회차 모름 · 계약 유지', (() => {
      const v = contractAxes(P({ history: hr({ empathy: 1 }, 1) }))
      return v.valid && v.roundUnknown.includes('roleShare')
    })())
    check('🔴 역할 표본 하한 5 · 문턱 0.5 불변 (임계 완화 0)', SHARE_MIN_EVENTS === 5 && ROLE_SHARE_CAP === 0.5)
    const streak = contractAxes(P({ history: { ...H0, consecutiveExposures: 2 } }))
    check('연속 노출 2 → 이번 회차만 막힘(roundBlocked) · 계약은 통과',
      streak.valid && streak.roundBlocked.includes('consecutiveExposures'))
    const pair = contractAxes(P({ history: { ...H0, postsSinceLastPairing: 2 } }))
    check('짝 간격 2(<5) → 이번 회차만 막힘 · 계약은 통과', pair.valid && pair.roundBlocked.includes('postsSinceLastPairing'))
  }

  console.log('⑦-3 이력 계산 (Post/Comment.personaId)')
  {
    const now = new Date('2026-09-30T03:00:00Z')
    const at = (hAgo: number): Date => new Date(now.getTime() - hAgo * 3_600_000)
    const posts = [
      { id: 'a', personaId: 'X', at: at(100) },
      { id: 'b', personaId: null, at: at(90) },   // 회원 글
      { id: 'c', personaId: 'Y', at: at(80) },
      { id: 'd', personaId: 'X', at: at(3) },
      { id: 'e', personaId: 'X', at: at(2) },
    ]
    const comments = [
      { id: 'k1', postId: 'c', personaId: 'X', at: at(79) },   // X·Y 가 c 에서 짝
      { id: 'k2', postId: 'b', personaId: 'Z', at: at(89) },
      { id: 'k3', postId: 'a', personaId: 'Z', at: at(24 * 40) }, // 40일 전 — 창 밖
    ]
    const h = historyFromEvents({
      personaIds: ['X', 'Y', 'Z', 'W'], posts, comments, roleOf: new Map([['k1', 'empathy']]), now,
    })
    const X = h.get('X')!
    const Y = h.get('Y')!
    const Z = h.get('Z')!
    const W = h.get('W')!
    check('연속 노출 — 맨 끝 두 글이 X → 2 · Y 는 0', X.consecutiveExposures === 2 && Y.consecutiveExposures === 0)
    check('짝 간격 — X·Y 가 c(3번째)에서 짝 · 뒤로 2글 → 2', X.postsSinceLastPairing === 2 && Y.postsSinceLastPairing === 2)
    check('짝 간격 — X·Z 가 a 에서 짝 · 뒤로 4글 · 가장 최근 짝(c)이 이긴다', X.postsSinceLastPairing === 2)
    check('Z 는 a(X 글)에 댓글 → 짝 4 · 회원 글 b 의 댓글은 짝이 아니다', Z.postsSinceLastPairing === 4)
    check('W(이력 0) → recent 0 · 연속 0 · 짝 never · daysSinceActive null',
      W.recentEvents === 0 && W.consecutiveExposures === 0 && W.postsSinceLastPairing === 'never' && W.daysSinceActive === null)
    check('최근 창(30일) 밖 댓글은 recentEvents 에 없다 — Z: b 댓글 1건만', Z.recentEvents === 1)
    check('역할 — X 의 k1 은 empathy · Z 의 k2 는 역할 모름(1)',
      X.roleCounts.empathy === 1 && X.unresolvedRoleEvents === 0 && Z.unresolvedRoleEvents === 1)
  }

  console.log('⑦-4 자격 충돌 4명 재현 (정본 카드 + 운영 seed 결손 모양)')
  const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  const cardOf = (code: string): PoolCard => pool.cards.find((c) => c.code === code)!
  {
    // 🔴 운영 실측 모양 — lifeStage=null · noGoTopics=[] (카드엔 3~4개). 나머지는 카드 그대로
    const drifted = ['P07', 'P10', 'P15', 'P17'].map((code) => {
      const c = cardOf(code)
      const row = {
        identity: {
          maritalStatus: c.maritalStatus, spouseRelationship: c.spouseRelationship ?? '해당없음',
          childrenCount: c.childrenCount, childrenAgeBands: c.childrenAgeBands, parentCare: c.parentCare,
          menopauseStatus: c.menopauseStatus, workStatus: c.workStatus, economicStatus: c.economicStatus,
          housing: c.housing, personality: c.personality,
        },
        voiceCore: { length: c.voiceLength, register: '존댓말', ending: '~요', emoji: '없음' },
        voiceVariations: ['1', '2', '3', '4', '5'],
        activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
        ageBand: c.ageBand, region: c.region, lifeStage: null,
        noGoTopics: [], noGoExpressions: c.noGoExpressions, forbiddenReactionRoles: c.forbiddenReactionRoles,
        dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
      }
      const seedProblems = verifySeedCard(code, seedOfRow(row), c)
      return P({ code, status: 'active', qualification: { ...QUAL_OK, seedProblems, seedComplete: seedCompleteOf(row) } })
    })
    const r = judgePersonaReserve({ ok: true, personas: drifted })
    check('운영 verifySeedCard + seedComplete 가 4명 전원 자격 충돌로 잡는다',
      r.gapsByAxis.qualificationConflict.blocked.join(',') === 'P07,P10,P15,P17')
    check('4명 전원 active 인데 stage-active 0 · activeNotContractValid 4',
      r.byState['stage-active'].length === 0 && r.activeNotContractValid.length === 4 && r.activeRows === 4)
  }

  console.log('⑦-5 용량 — active 행은 용량이 아니다')
  {
    const forty = Array.from({ length: 40 }, (_, i) => P({
      code: `Q${String(i).padStart(2, '0')}`, status: 'active',
      history: { ...H0, recentEvents: SHARE_MIN_EVENTS, daysSinceActive: 1 }, // 활동 5건 — 앞판은 소재 모름으로 전원 탈락
    }))
    const r = judgePersonaReserve({ ok: true, personas: forty })
    const g = reserveFloorGap(r.contractValid, 'd20')
    // 🔴 (2026-10-01 · C9) 앞판은 활동 5건인 40명이 소재 모름으로 전원 탈락했다 — 이제 40 이다
    check('active 40 · 활동 5건 → contract-valid 40', r.activeRows === 40 && r.contractValid === 40)
    check('D20 canary 40 충족 · 지속 60 부족 20', g.canaryMet === true && g.canaryShortfall === 0 && g.sustainedShortfall === 20)
    const fail = judgePersonaReserve({ ok: false, detail: 'db down' })
    check('읽기 실패 → contractValid null (0 아님) · 하한 판정 null',
      fail.contractValid === null && reserveFloorGap(fail.contractValid, 'd10').canaryMet === null)
    const mixed = judgePersonaReserve({ ok: true, personas: [P({ code: 'A' }), P({ code: 'B', status: 'active' }), P({ code: 'C', stored: false, status: null }), P({ code: 'D', status: 'retired' })] })
    check('contractValid = reserve + stage-active (designed·retired 제외)',
      mixed.contractValid === 2 && mixed.byState.designed.join() === 'C' && mixed.retired.join() === 'D')
  }

  console.log('⑦-6 운영 어댑터 경로 (readPersonaReserve)')
  {
    const row = (code: string, status: string, o: Partial<PersonaReserveRow> = {}): PersonaReserveRow => ({
      code, status, identity: { maritalStatus: '기혼', spouseRelationship: '원만', childrenCount: 0, childrenAgeBands: [],
        workStatus: '직장', economicStatus: '보통', menopauseStatus: '진행중', parentCare: '없음', personality: ['차분'] },
      ageBand: '50대 초반', region: '수도권', noGoTopics: ['돈'], noGoExpressions: ['"~해라"'],
      activityToday: 0, daysSinceActive: null, voiceComments: 3, qualification: QUAL_OK, history: H0, ...o,
    })
    const r = await readPersonaReserve({ reserveFacts: async () => ({ rows: [row('P01', 'draft'), row('P02', 'active')], designedOnly: ['P09', 'P02'] }) })
    check('draft → reserve · active → stage-active · 카드만 → designed(이미 행이 있으면 제외)',
      r.byState.reserve.join() === 'P01' && r.byState['stage-active'].join() === 'P02' && r.byState.designed.join() === 'P09')
    const bad = await readPersonaReserve({ reserveFacts: async () => ({ rows: [row('P01', 'weird')], designedOnly: [] }) })
    check('모르는 status → draft 로 읽지 않는다 · 읽기 실패(null)', bad.contractValid === null)
    const thrown = await readPersonaReserve({ reserveFacts: async () => { throw new Error('x') } })
    check('어댑터 예외 → contractValid null', thrown.contractValid === null)
  }

  console.log('⑦-7 자동 생성 — 이름만 다른 사람을 막는다')
  {
    const bundle = (code: string, texts: string[]): VoiceReferenceBundle => {
      const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: texts.length })
      if (!v.ok) throw new Error('fixture 묶음')
      return v.bundle
    }
    // 🔴 운영 묶음 — 서로 가까운 쌍(P01·P02)이 있어 기준이 작다(실제 18묶음도 가장 가까운 쌍이 기준)
    const PROD = [
      bundle('P01', ['그 마음 알 것 같아요', '저도 요즘 그래요', '천천히 하셔도 돼요']),
      bundle('P02', ['그 마음 알겠어요', '저도 그래요 요즘', '천천히 하셔요']),
      bundle('P03', ['아이고 고생 많았네', '그거 참 어렵지', '밥은 챙겨 먹고']),
    ]
    const LIFE: LifeSkeleton = {
      ageBand: '50대 초반', birthDate: '1973-03-08', region: '광역시', maritalStatus: '이혼',
      spouseRelationship: '해당없음', childrenCount: 1, childrenAgeBands: ['대학·취준'], childrenLiving: '동거',
      workStatus: '파트타임', economicStatus: '빠듯', housing: '월세', menopauseStatus: '진행중', parentCare: '간헐',
    }
    const CR: PersonaCreative = {
      title: '혼자 대학생 아이 뒷바라지하며', personality: ['담담함', '말 짧음', '남 얘기 잘 들음'],
      noGoTopics: ['이혼 권유', '금액 언급'], noGoExpressions: ['"그래도 ~하니 다행" 류'],
      variations: ['짧게 툭', '담백한 경험', '되묻기', '무호칭', '한 줄'],
    }
    const CAD: Cadence = { dailyCap: 3, weeklyCap: 12, silenceRate: 0.3, activityRhythm: { activeHours: [[10, 13]], burstiness: 0.3, weekdayBias: 0.5 } }
    const vA = bundle('P26', ['정말 그렇죠?? 어떻게 하셨어요?', '저는 좀 달랐어요... 왜 그럴까요?', '혹시 그거 어디서 들으셨어요?'])
    const vB = bundle('P27', ['음 그건 모르겠다 ㅋㅋ', '헐 대박 ㅋㅋㅋ', '아 진짜 웃기다 ㅎㅎ'])
    const cand = (code: string, o: Partial<AutogenCandidate> = {}): AutogenCandidate => ({
      code, life: LIFE, creative: CR, voice: { bundle: vA, seedShareCount: 1 }, cadence: CAD,
      binding: { accountCount: 0, providerId: null }, displayName: { name: '해솔', gate: 'pass' }, ...o,
    })
    const run = (cs: AutogenCandidate[], prod = PROD) =>
      judgeAutogenBatch(cs, { takenCodes: new Set(), existingCards: pool.cards, productionBundles: prod })
    const solo = run([cand('P26')])
    check('온전한 후보 하나 → valid (겹침 0 · 문체 거리 ≥ 운영 기준)', solo.verdicts[0]!.status === 'valid')
    check('judgeVoiceSeparation 기준이 실제로 나온다(운영 묶음 최소 거리)', solo.voiceBaseline !== null && solo.voiceBaseline > 0)

    const twins = run([cand('P26'), cand('P27', { voice: { bundle: vB, seedShareCount: 1 } })])
    check('이름(코드)만 다른 후보 → 뒤 코드 NEAR_DUPLICATE_PERSONA · 앞 코드는 valid',
      twins.verdicts[0]!.status === 'valid' && twins.verdicts[1]!.blocks.includes('NEAR_DUPLICATE_PERSONA')
      && twins.verdicts[1]!.status === 'quarantined')
    const sameVoice = run([cand('P26'), cand('P27', {
      creative: { ...CR, title: '딴 사람', personality: ['수다', '밝음', '오지랖'], noGoTopics: ['정치'], noGoExpressions: ['"라떼는" 류'] },
      life: { ...LIFE, ageBand: '60대 초반', birthDate: '1963-03-08', menopauseStatus: '후', maritalStatus: '사별', workStatus: '은퇴', housing: '자가', economicStatus: '여유', childrenAgeBands: ['성인'], childrenLiving: '분가', parentCare: '없음' },
      voice: { bundle: { ...vA, personaCode: 'P27' }, seedShareCount: 1 },
    })])
    check('성격·생활사가 달라도 말투가 같으면 → VOICE_TOO_CLOSE', sameVoice.verdicts[1]!.blocks.includes('VOICE_TOO_CLOSE'))

    const me = { ...distinctSubjectOfCard(cardOf('P07')), code: 'P30' }
    const oneOff = { ...me, life: { ...me.life, housing: me.life.housing === '자가' ? '월세' : '자가' } }
    check('생활사 1칸 차이 + 성격·noGo·관점까지 같음 → 막는다',
      judgeDistinctness({ ...oneOff, title: '다른 제목' }, [distinctSubjectOfCard(cardOf('P07'))]).length > 0)
    check('생활사 1칸 차이여도 성격·noGo·관점이 다르면 → 통과(같은 또래는 생활사가 겹친다)',
      judgeDistinctness({ ...oneOff, title: '다른 제목', personality: ['수다', '밝음'], noGoTopics: ['정치'], noGoExpressions: [] },
        [distinctSubjectOfCard(cardOf('P07'))]).length === 0)
    /**
     * 🔴 **정본 카드 25장에 기준을 대 본다** — 기준이 실제 사람을 무더기로 막으면 기준이 틀린 것이다.
     *    실측 결과 겹침은 **P12 ↔ P23 한 쌍뿐**이다(성격 4/6 · noGo 4/5 공유, 둘 다 "친정 어머니 곁에").
     *    이것은 기준의 오류가 아니라 정본에 실제로 있는 근접 쌍이다 — 보고 대상이고, 여기서 고정해
     *    다른 카드가 새로 걸리면(기준이 느슨해지거나 조여지면) 알 수 있게 한다.
     */
    const canonPairs = [...new Set(pool.cards.flatMap((c) =>
      judgeDistinctness(distinctSubjectOfCard(c), pool.cards.map(distinctSubjectOfCard))
        .map((h) => [c.code, h.slice(0, 3)].sort().join('↔'))))]
    check(`정본 카드끼리 겹침은 P12↔P23 한 쌍뿐이다 — ${canonPairs.join(',') || '0'}`, canonPairs.join(',') === 'P12↔P23')
    const noBase = run([cand('P26')], [PROD[0]!])
    check('운영 묶음 1개(기준 못 잼) → VOICE_SEPARATION_UNMEASURED · valid 아님',
      noBase.verdicts[0]!.blocks.includes('VOICE_SEPARATION_UNMEASURED') && noBase.verdicts[0]!.status !== 'valid')
    const noName = run([cand('P26', { displayName: null })])
    check('표시명 미측정 → 4상태 계약도 자격 모름(QUALIFICATION_CONFLICT)',
      noName.verdicts[0]!.blocks.includes('QUALIFICATION_CONFLICT'))
    check('이름만 있는 후보는 여전히 rejected',
      run([cand('P26', { life: null, voice: null, creative: null })]).verdicts[0]!.status === 'rejected')
    check('코드 번호는 P26~ (autogenCodeOf)', autogenCodeOf(26) === 'P26')
  }

  console.log('⑦-8 연결 — 같은 결정을 두 곳에서 하지 않는다')
  {
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const lib = strip(readFileSync('scripts/lib/persona-autogen.mts', 'utf-8'))
    const tiers = strip(readFileSync('scripts/lib/d100-persona-tiers.mts', 'utf-8'))
    const cli = strip(readFileSync('scripts/persona-autogen.mts', 'utf-8'))
    check('autogen 은 personaTiers 를 직접 부르지 않는다(옛 별도 기준 삭제)', !/personaTiers\(/.test(lib))
    check('autogen 은 contractAxes 로 계약을 판정한다', /contractAxes\(/.test(lib))
    check('autogen 은 status: \'active\' · daysSinceActive: 0 거짓 입력을 쓰지 않는다',
      !/status: 'active', identity: idn/.test(lib) && !/daysSinceActive: 0/.test(lib))
    check('계기판 readPersonaReserve 는 judgePersonaReserve 를 부른다', /judgePersonaReserve\(/.test(tiers))
    check('CLI 는 judgeAutogenBatch(겹침·문체 거리)로 판정한다', /judgeAutogenBatch\(candsWith\(cr\),/.test(cli) && /const batch = judgeAll\(creative\)/.test(cli))
    check('autogen 은 judgeVoiceSeparation 을 실제로 부른다', /judgeVoiceSeparation\(/.test(lib))
  }
}

// ── 단독 실행 ──
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let pass = 0
  let failN = 0
  const check: Check = (name, ok) => {
    if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
  }
  console.log('\n══ Persona 4상태 판정 fixture ══\n')
  await runPersonaReserveChecks(check)
  console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
  process.exit(failN === 0 ? 0 : 1)
}
