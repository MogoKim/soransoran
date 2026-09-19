#!/usr/bin/env tsx
/**
 * 운영 생성 경로 단일화 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **무엇이 틀렸었나** (2026-09-19 실측).
 *
 *    운영 자동 후보 생성은 원천 제목이 소재 사전에 걸리면 **고정 질문 템플릿**을
 *    먼저 썼다. 큐를 통과한 원천 61건 중 60건이 그 경로였고, 90행이 13개 제목으로
 *    돌아갔다(86% 중복). 원문의 상황·갈등·감정은 하나도 남지 않았다.
 *    그리고 그렇게 만든 글에도 품질·나이 검수 비용은 그대로 나갔다.
 *
 * 🔴 **이 검사가 증명하는 것과 못 하는 것.**
 *    증명한다  운영 경로가 LLM 하나인가 · 원천당 후보 초안이 1개인가 ·
 *              보내는 요청과 캐시 key 가 같은 정본에서 오는가 ·
 *              원천 하나가 뒤 원천의 기본 기회를 빼앗지 못하는가 ·
 *              완주하지 못한 검수가 채택되거나 완료로 캐시되지 않는가
 *    🔴 못 한다 **실제 모델이 더 좋은 글을 쓰는가.**
 *              가짜 provider 는 정해진 답을 돌려준다 — 글 품질의 증거가 아니다.
 *              그것은 유료 실측과 사람 평가로만 확인된다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as R from './micro-seed-auto-draft.mjs'
import {
  buildAgeCheckSystemPrompt, buildGenSystemPrompt, buildQualitySystemPrompt,
  CallBudget, callBudgetOf, parseGen,
  CALL_ALLOWANCE_PER_SOURCE, CALL_EXPECTED_PATH_PER_SOURCE,
} from './micro-seed-auto-draft.mjs'
import { expandSeed } from './lib/micro-seed-seed-originality.mjs'
import {
  DRAFT_PROMPT_VERSION, MACHINE_AGE_HUMAN_REVIEW_NOTE, MAX_DRAFTS_PER_SOURCE,
} from '../src/lib/micro-seed-auto-draft'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}`) }
}
const RUNNER = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')

console.log('\n══ 운영 생성 경로 단일화 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')

/** 🔴 창업자가 지목한 세 사례 — 옛 경로에서 전부 고정 질문으로 갔다 */
const STORIES = [
  '남편이 집안일 좀 도와주나요',
  '아들딸이 나를 어떻게 보는지 문득 궁금해요',
  '직장에서 여행 다녀와서 선물 돌리시나요',
] as const
/** 🔴 소재 사전이 분류하지 못하는 원천 — 옛 경로에서도 LLM 으로 갔다 */
const UNCLASSIFIED = '어제 그 일 말인데요'

// ─────────────────────────────────────────────────────────
console.log('① 운영 생성 경로가 하나다 — 🔴 템플릿 분기를 통째로 우회한다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 세 사례는 소재 사전이 **분류한다** — 그래서 옛 경로에서 고정 질문이 나갔다',
    STORIES.every((t) => {
      const e = expandSeed({ sourceArticleId: 'x', title: t })
      return e.topic !== null && (e.drafts ?? []).length > 0
    }))
  check('🔴 분류하지 못하는 원천도 있다 — 두 갈래가 실재했다',
    expandSeed({ sourceArticleId: 'y', title: UNCLASSIFIED }).topic === null)

  check('🔴 🔴 운영 러너가 템플릿 생성기를 **쓰지 않는다**',
    !/expandSeed\(/.test(RUNNER)
    && !/from '\.\/lib\/micro-seed-seed-originality\.mjs'/.test(RUNNER))
  check('🔴 topic 예외 목록을 만들지 않았다',
    !/mindTies|travelFood|TOPIC_RULES|TOPIC_LABEL/.test(RUNNER))
  check('🔴 새 분류 API·새 검수 축을 만들지 않았다',
    !/classifyTopic|judgeTopic|newAxis|DRAFT_QUALITY_AXES\s*=/.test(RUNNER))

  // 🔴 **지우지 않았다** — 검사·참고·정형 용도는 그대로다
  check('🟢 템플릿 정본은 그대로 있다 — 지우지 않았다',
    existsSync('scripts/lib/micro-seed-seed-originality.mts')
    && (expandSeed({ sourceArticleId: 'z', title: STORIES[0] }).drafts ?? []).length > 0)
  check('🟢 템플릿 전용 검사·정형 용도가 그대로 돈다',
    existsSync('scripts/micro-seed-seed-originality-check.mts')
    && /expandSeed\(/.test(readFileSync('scripts/micro-seed-seed-originality-dry-run.mts', 'utf-8')))
  check('🔴 후보 출처 표기가 llm 하나다 — 템플릿을 후보로 적지 않는다',
    /const from = 'llm'/.test(RUNNER) && !/=== 'template'/.test(RUNNER)
    && !/from: 'template'/.test(RUNNER))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 원천당 운영 초안 1개 — 🔴 여러 개를 만든 뒤 고르지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 원천당 초안 상한이 1이다', MAX_DRAFTS_PER_SOURCE === 1)
  const sys = buildGenSystemPrompt({ title: 't', bodyHead: 'b' })
  check('🔴 생성 프롬프트가 초안 **1개**만 요구한다',
    sys.includes(`초안 ${MAX_DRAFTS_PER_SOURCE}개를 JSON 으로만 답합니다.`)
    && sys.includes('초안 1개'))
  check('🔴 "두 초안" 을 서로 다르게 쓰라는 지시가 남아 있지 않다',
    !/두 초안/.test(sys) && !/두 초안/.test(RUNNER))
  check('🔴 여러 개가 와도 하나만 받는다', (() => {
    const raw = JSON.stringify({ drafts: [
      { title: '첫 글', body: '첫 본문입니다.' },
      { title: '둘째 글', body: '둘째 본문입니다.' },
      { title: '셋째 글', body: '셋째 본문입니다.' },
    ] })
    const g = parseGen(raw)
    return g !== null && g.length === 1 && g[0]!.title === '첫 글'
  })())
  check('🔴 **첫 유효** 초안을 받는다 — 앞이 비었다고 통째로 버리지 않는다', (() => {
    const raw = JSON.stringify({ drafts: [
      { title: '', body: '' },
      { title: '둘째 글', body: '둘째 본문입니다.' },
    ] })
    const g = parseGen(raw)
    return g !== null && g.length === 1 && g[0]!.title === '둘째 글'
  })())
  check('🔴 하나도 쓸 것이 없으면 null 이다 — 빈 초안을 만들지 않는다',
    parseGen(JSON.stringify({ drafts: [{ title: '', body: '' }] })) === null)
  check('🔴 초안 둘을 비교해 고른다고 주장하지 않는다',
    !/둘 중 나은|상대 비교|두 개를 비교/.test(RUNNER))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 생성 요청 정본 — 🔴 보내는 것과 캐시 key 가 같은 데서 온다')
// ─────────────────────────────────────────────────────────
{
  const base: Parameters<typeof R.buildGenRequest>[0] = {
    title: STORIES[0], bodyHead: '합성 본문입니다. 시험용으로 지어냈습니다.',
    communityAngle: '집안일 분담을 두고 쌓인 서운함',
    axis: 'sourceCandidate', lane: 'originalRaw',
    voiceSamples: ['그러게요 저도 비슷하게 느꼈어요'],
  }
  const req = R.buildGenRequest(base)
  check('🔴 정본이 system · payload · model · promptVersion 을 함께 낸다',
    typeof req.system === 'string' && req.system !== ''
    && typeof req.payload === 'string' && req.payload !== ''
    && req.model === R.DRAFT_MODEL && req.promptVersion === DRAFT_PROMPT_VERSION)
  check('🔴 payload 에 소재·판정 한 줄이 실린다', (() => {
    const p = JSON.parse(req.payload) as Record<string, unknown>
    return p.sourceTitle === base.title && p.communityAngle === base.communityAngle
      && String(p.sourceBodyHead).length > 0
  })())

  const keyOf = (o: Partial<typeof base>): string =>
    R.genCacheKeyOf('ID1', R.buildGenRequest({ ...base, ...o }))
  const k0 = keyOf({})
  check('🔴 같은 입력이면 같은 key — 불필요한 재생성을 만들지 않는다', k0 === keyOf({}))
  check('🔴 🔴 communityAngle 이 달라지면 key 가 달라진다 — 옛 글을 재사용하지 않는다',
    k0 !== keyOf({ communityAngle: '아주 다른 결로 바꾼 설명' }))
  check('🔴 제목·본문 머리가 달라지면 key 가 달라진다',
    k0 !== keyOf({ title: '다른 제목' }) && k0 !== keyOf({ bodyHead: '다른 본문 머리' }))
  check('🔴 축·레인이 달라지면 key 가 달라진다',
    k0 !== keyOf({ axis: 'other' }) && k0 !== keyOf({ lane: 'other' }))
  check('🔴 말투 근거가 달라지면 key 가 달라진다',
    k0 !== keyOf({ voiceSamples: ['말씀 잘 들었습니다.'] }))
  check('🔴 원천이 다르면 key 가 다르다',
    k0 !== R.genCacheKeyOf('ID2', R.buildGenRequest(base)))
  check('🔴 🔴 key 에 원문을 담지 않는다 — digest 만 남는다',
    !k0.includes(base.title) && !k0.includes(base.communityAngle)
    && !k0.includes('합성 본문'))
  check('🔴 key 가 model 과 promptVersion 을 담는다',
    k0.includes(R.DRAFT_MODEL) && k0.includes(DRAFT_PROMPT_VERSION))
  check('🔴 🔴 key 가 **실제 요청의** digest 로 만들어진다 — 따로 조립하지 않는다', (() => {
    const d = R.digest16
    return k0.includes(d(req.system)) && k0.includes(d(req.payload))
  })())
  check('🔴 러너가 정본이 만든 것을 그대로 보낸다',
    /genCacheKeyOf\(/.test(RUNNER) && /genReq\.system/.test(RUNNER) && /genReq\.payload/.test(RUNNER)
    && !/buildGenPayload\(\{[\s\S]{0,200}?\}\)/.test(RUNNER.slice(RUNNER.indexOf('async function main'))))
  check('🔴 옛 판의 별도 입력 해시를 더 쓰지 않는다 — 두 곳에 적지 않는다',
    !/inputHashOf\(/.test(RUNNER))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 예산 공정성 — 🔴 앞 원천이 뒤 원천 몫을 못 가져간다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 원천 하나의 hard cap 을 올리지 않았다', CALL_ALLOWANCE_PER_SOURCE === 4)
  check('🔴 정상 cold 경로는 생성1 + 품질1 + 나이1 = 3회다',
    CALL_EXPECTED_PATH_PER_SOURCE === 3
    && R.BASE_PATH_CALLS === 3 && R.QUALITY_PATH_CALLS === 2 && R.LIFE_RETRY_CALLS === 3)
  check('🔴 🔴 앞 원천이 몰아 써도 뒤 원천의 기본 기회가 남는다', (() => {
    const b = new CallBudget(callBudgetOf(2), CALL_ALLOWANCE_PER_SOURCE)
    b.enter('s1')
    let s1 = 0
    while (b.take()) s1 += 1
    b.enter('s2')
    let s2 = 0
    while (b.take()) s2 += 1
    return s1 === CALL_ALLOWANCE_PER_SOURCE && s2 === CALL_ALLOWANCE_PER_SOURCE
  })())
  check('🔴 공동 예산도 그대로 막는다 — 원천별 cap 이 총량을 늘리지 않는다', (() => {
    const b = new CallBudget(3, CALL_ALLOWANCE_PER_SOURCE)
    b.enter('s1'); b.take(); b.take()
    b.enter('s2')
    return b.take() && !b.take() && b.spent === 3
  })())
  check('🔴 원천별 남은 수를 볼 수 있다 — 완주할 여력을 묻는 자리', (() => {
    const b = new CallBudget(100, 4)
    b.enter('s1')
    const before = b.canAffordForSource(3)
    b.take(); b.take()
    return before && !b.canAffordForSource(3) && b.canAffordForSource(2)
      && b.leftForCurrentSource === 2
  })())
  check('🟢 옛 호출 모양이 그대로 돈다 — cap 을 안 주면 공동 예산만이다', (() => {
    const b = new CallBudget(2)
    return b.take() && b.take() && !b.take() && b.spent === 2 && b.left === 0
  })())
  /**
   * 🔴 **관측만 하고 막지 않으면 아무것도 바뀌지 않는다.**
   *    2026-09-13 판이 그랬다 — `perSource` 는 있었지만 `CallBudget` 은 총량만 셌다.
   */
  check('🔴 🔴 회차 예산이 원천별 cap 을 실제로 받는다',
    /new CallBudget\(callBudgetOf\(seeds\.length\), CALL_ALLOWANCE_PER_SOURCE\)/.test(RUNNER))
  check('🔴 재시도가 남은 검수를 먹을 수 있다고 코드가 **적어 둔다**',
    /통신 · JSON 재시도가 cap 을 쓰면 남은 검수가 부족할 수 있다/.test(RUNNER))
  check('🔴 상한을 새 회차 id 로 우회하지 않는다 — 회차 id 를 지어내지 않는다',
    /--run-id 가 없습니다/.test(RUNNER) && !/randomUUID|Date\.now\(\)\.toString\(36\)/.test(RUNNER))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 행동 — 🔴 **실제로 나간 요청**을 본다 (가짜 provider · 임시 HOME · 임시 장부)')
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'sd1-'))
  const dd = join(root, DATA_DIR_NAME)
  mkdirSync(dd, { recursive: true })
  symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { recursive: true })
  writeFakePersonaAsset({ home: fakeHome })

  const SOURCES = [...STORIES, UNCLASSIFIED]
  const idOf = (i: number): string => `SD${i + 1}`
  const ANGLE = (i: number): string => `합성 판정 ${i + 1} — 원문이 어떤 결이었는지 한 줄`
  const meta = (i: number): string => JSON.stringify({
    sourceArticleId: idOf(i), sourceSite: 'navercafe:wgang', title: SOURCES[i],
    bodyHead: `합성 본문 ${i + 1} 입니다. 시험용으로 지어냈습니다.`,
    axis: 'sourceCandidate', lane: 'originalRaw',
  })
  const shadow = (i: number, angle: string): string => JSON.stringify({
    sourceArticleId: idOf(i), decision: 'AUTO_SEED', semanticRisks: [], communityAngle: angle,
    ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h',
    provenance: 'machine-shadow',
  })
  const writeInputs = (angleOf: (i: number) => string): void => {
    writeFileSync(join(dd, 'x.detail.jsonl'), `${SOURCES.map((_, i) => meta(i)).join('\n')}\n`, 'utf-8')
    writeFileSync(join(dd, 'x.shadow.jsonl'),
      `${SOURCES.map((_, i) => shadow(i, angleOf(i))).join('\n')}\n`, 'utf-8')
  }
  writeInputs(ANGLE)

  const bodyLog = join(root, 'bodies.jsonl')
  type Run = { code: number | null; out: string; bodies: Record<string, unknown>[] }
  const run = (
    runIdArg: string,
    opts: { keepCache?: boolean; env?: Record<string, string>; cap?: string } = {},
  ): Run => {
    writeFileSync(bodyLog, '', 'utf-8')
    if (opts.keepCache !== true) writeFileSync(join(dd, 'auto-draft-cache.json'), '{}', 'utf-8')
    const snapPath = join(dd, queueSnapshotFileName(runIdArg))
    writeFileSync(snapPath, JSON.stringify(buildQueueSnapshot({ runId: runIdArg, takenAt: new Date(), rows: [] })), 'utf-8')
    const r = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [
        join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
        `--queue-snapshot=${snapPath}`, `--run-id=${runIdArg}`, '--require-queue-snapshot',
      ],
      {
        cwd: root, encoding: 'utf-8',
        env: {
          ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
          FAKE_PROVIDER_BODY_LOG: bodyLog,
          // 🔴 원천마다 다른 글을 받는다 — 같은 글이면 두 번째부터 중복으로 떨어져
          //    "원천마다 검수가 도는가" 를 재려던 검사가 아무것도 재지 못한다
          FAKE_PROVIDER_VARY_BY_SOURCE: '1',
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          // 🔴 시험용 임시 값이다. 운영 예산이 아니다
          SORAN_LLM_DAILY_BUDGET_USD: '1000',
          SORAN_LLM_RESERVE_HEADROOM: '1.5',
          SORAN_LLM_RUN_REQUEST_CAP: opts.cap ?? '10000',
          ...(opts.env ?? {}),
        },
      },
    )
    const bodies = readFileSync(bodyLog, 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, bodies }
  }
  const systemOf = (b: Record<string, unknown>): string => String(b.system ?? '')
  const payloadOf = (b: Record<string, unknown>): Record<string, unknown> => {
    const msgs = (b.messages ?? []) as { role?: string; content?: string }[]
    const u = msgs.find((m) => m.role === 'user')
    try { return JSON.parse(String(u?.content ?? '{}')) as Record<string, unknown> } catch { return {} }
  }
  // 🔴 표지를 여기 적지 않는다 — 정본 프롬프트의 첫 줄과 대조한다
  const GEN_MARK = buildGenSystemPrompt({ title: 't', bodyHead: 'b' }).split('\n')[0]!
  const QUALITY_MARK = buildQualitySystemPrompt().split('\n')[0]!
  const AGE_MARK = buildAgeCheckSystemPrompt('40대 후반').split('\n')[0]!
  const stageOf = (b: Record<string, unknown>): string => {
    const s = systemOf(b)
    if (s.startsWith(GEN_MARK)) return 'gen'
    if (s.startsWith(AGE_MARK)) return 'age'
    if (s.startsWith(QUALITY_MARK)) return 'quality'
    return 'other'
  }
  /** 🔴 원천별로 묶는다 — 생성 요청이 새 원천의 시작이다 */
  const groups = (bodies: Record<string, unknown>[]): string[][] => {
    const out: string[][] = []
    for (const b of bodies) {
      const st = stageOf(b)
      if (st === 'gen' || out.length === 0) out.push([])
      out[out.length - 1]!.push(st)
    }
    return out
  }
  const candidatesOf = (): Record<string, unknown>[] => {
    const f = readdirSync(dd).filter((x) => x.endsWith('.candidates.json')).sort()
    if (f.length === 0) return []
    const j = JSON.parse(readFileSync(join(dd, f[f.length - 1]!), 'utf-8')) as Record<string, unknown>
    return (j.candidates ?? []) as Record<string, unknown>[]
  }

  // ⓐ 정상 cold 회차
  const cold = run('SDA')
  const genReqs = cold.bodies.filter((b) => stageOf(b) === 'gen')
  check('🔴 [B] 러너가 끝까지 돌았다', cold.code === 0)
  check('🔴 [B] 🔴 **분류되는 원천도 분류 안 되는 원천도 전부** 생성 요청을 냈다', (() => {
    const titles = new Set(genReqs.map((b) => String(payloadOf(b).sourceTitle)))
    return SOURCES.every((t) => titles.has(t)) && titles.size === SOURCES.length
  })())
  check('🔴 [B] 🔴 세 사례가 고정 질문으로 가지 않았다', (() => {
    const fixed = new Set(STORIES.flatMap((t) =>
      (expandSeed({ sourceArticleId: 'x', title: t }).drafts ?? []).map((d) => d.title)))
    return candidatesOf().every((c) => !fixed.has(String(c.title)))
  })())
  check('🔴 [B] 생성 요청에 제목 · 본문 머리 · communityAngle 이 실린다',
    genReqs.every((b) => {
      const p = payloadOf(b)
      return String(p.sourceTitle) !== '' && String(p.sourceBodyHead) !== ''
        && /^합성 판정 \d+/.test(String(p.communityAngle))
    }))
  check('🔴 [B] 생성 요청에 Persona 생활사와 말투 근거가 실린다',
    genReqs.length > 0
    && genReqs.every((b) => /말투 참고/.test(systemOf(b)) && /당신은 이런 사람입니다/.test(systemOf(b))))
  check('🔴 [B] 🔴 정상 원천은 생성1 · 품질1 · 나이1 로 끝난다', (() => {
    const g = groups(cold.bodies)
    return g.length === SOURCES.length
      && g.every((x) => x.join('>') === 'gen>quality>age')
  })())
  check('🔴 [B] 회차 요청 수가 원천당 3회다',
    cold.bodies.length === SOURCES.length * CALL_EXPECTED_PATH_PER_SOURCE)
  check('🔴 [B] 🔴 운영 후보는 원천당 1개다', (() => {
    const c = candidatesOf()
    const ids = c.map((x) => String(x.sourceArticleId))
    return c.length > 0 && new Set(ids).size === ids.length
  })())
  check('🔴 [B] 후보 출처가 llm 으로 적힌다', candidatesOf().every((c) => c.draftFrom === 'llm'))
  check('🔴 [B] 화면이 템플릿 채택을 말하지 않는다', !/출처: 템플릿 [1-9]/.test(cold.out))

  // ⓑ 캐시 — 같은 요청이면 재사용, 입력이 달라지면 새로 만든다
  const again = run('SDB', { keepCache: true })
  check('🔴 [B] 🔴 같은 요청은 gen cache HIT — 다시 만들지 않는다',
    again.bodies.filter((b) => stageOf(b) === 'gen').length === 0)
  writeInputs((i) => (i === 0 ? '아주 다른 결로 바꾼 판정 한 줄' : ANGLE(i)))
  const angleChanged = run('SDC', { keepCache: true })
  check('🔴 [B] 🔴 communityAngle 이 달라진 원천만 다시 만든다', (() => {
    const g = angleChanged.bodies.filter((b) => stageOf(b) === 'gen')
    return g.length === 1 && String(payloadOf(g[0]!).sourceTitle) === SOURCES[0]
  })())
  writeInputs(ANGLE)
  // 말투 근거를 바꾼다 — 자산이 달라지면 생성 입력이 달라진다
  writeFakePersonaAsset({ home: fakeHome, perSpeaker: 9 })
  const voiceChanged = run('SDD', { keepCache: true })
  check('🔴 [B] 🔴 말투 근거가 달라지면 다시 만든다',
    voiceChanged.bodies.filter((b) => stageOf(b) === 'gen').length > 0)
  writeFakePersonaAsset({ home: fakeHome })

  // ⓒ 앞 원천의 재시도가 뒤 원천 기회를 빼앗지 않는다
  const noisy = run('SDE', {
    env: { FAKE_PROVIDER_BAD_JSON_STAGE: 'gen', FAKE_PROVIDER_BAD_JSON_FOR: SOURCES[0]! },
  })
  if (process.env.SD_DEBUG === '1') {
    console.log('DEBUG noisy groups', JSON.stringify(groups(noisy.bodies)))
    console.log('DEBUG noisy tail', noisy.out.split('\n').slice(-30).join('\n'))
  }
  check('🔴 [B] 🔴 첫 원천이 재시도를 써도 뒤 원천은 생성1 · 품질1 · 나이1 을 받는다', (() => {
    const g = groups(noisy.bodies)
    const full = g.filter((x) => x.join('>') === 'gen>quality>age')
    const partial = g.filter((x) => x.join('>') !== 'gen>quality>age')
    // 🔴 깨진 원천은 형식 재시도만 쓰고(생성만 두 번), 나머지는 전부 온전히 돈다
    return full.length === SOURCES.length - 1 && partial.every((x) => x.join('>') === 'gen')
  })())
  check('🔴 [B] 첫 원천은 형식 재시도까지만 쓰고 멈춘다 — cap 을 넘지 않았다',
    /원천별 사용: 최다 ([1-4])회/.test(noisy.out))
  check('🔴 [B] 답을 못 읽은 원천은 후보가 되지 않는다',
    !candidatesOf().some((c) => c.sourceArticleId === idOf(0)))

  // ⓓ fail-closed — 완주 못 한 검수는 채택도 캐시도 없다
  const badQuality = run('SDF', { env: { FAKE_PROVIDER_BAD_JSON_STAGE: 'quality' } })
  check('🔴 [B] 🔴 품질 판정을 못 읽으면 아무것도 채택하지 않는다', candidatesOf().length === 0)
  check('🔴 [B] 🔴 그 판정을 **완료 캐시로 적지 않는다**', (() => {
    const c = JSON.parse(readFileSync(join(dd, 'auto-draft-cache.json'), 'utf-8')) as Record<string, unknown>
    return Object.keys(c).filter((k) => k.startsWith('q|')).length === 0
  })())
  check('🔴 [B] 품질을 못 읽었으면 나이 검수를 부르지 않는다',
    badQuality.bodies.filter((b) => stageOf(b) === 'age').length === 0)

  const crisis = run('SDG', { env: { FAKE_PROVIDER_HARMS: JSON.stringify(['crisisSignal']) } })
  check('🔴 [B] 🔴 위기 신호가 오면 채택 0 이고 회차를 멈춘다',
    candidatesOf().length === 0 && /위기 신호로 회차를 멈췄다/.test(crisis.out))

  // ⓔ 생활사 충돌 — 완주할 여력이 없으면 시작하지 않는다
  const life = run('SDH', { env: { FAKE_PROVIDER_LIFE_CONFLICT: '1' } })
  check('🔴 [B] 🔴 생활사 충돌이면 채택하지 않는다', candidatesOf().length === 0)
  check('🔴 [B] 🔴 완주할 여력이 없으면 재생성을 **시작하지 않고** 사유를 남긴다',
    /생활사 재생성을 시작하지 않았다/.test(life.out))
  check('🔴 [B] 그때도 원천당 cap 을 넘지 않는다', (() => {
    const m = /원천별 사용: 최다 (\d+)회/.exec(life.out)
    return m !== null && Number(m[1]) <= CALL_ALLOWANCE_PER_SOURCE
  })())

  // ⓕ 회차 상한 — 부족하면 만들지도 채택하지도 않는다
  const capped = run('SDI', { cap: '2' })
  if (process.env.SD_DEBUG === '1') {
    console.log('DEBUG capped cands', JSON.stringify(candidatesOf().map((c) => c.sourceArticleId)))
    console.log('DEBUG capped tail', capped.out.split('\n').slice(-40).join('\n'))
  }
  check('🔴 [B] 🔴 회차 요청 상한에 걸리면 채택 0 이다', candidatesOf().length === 0)
  check('🔴 [B] 🔴 장부가 막은 나이 검수는 **하지 못한 검수**로 센다',
    /나이까지 완주 못 해 통과로 읽지 않은 초안 [1-9]/.test(capped.out))
  check('🔴 [B] 🔴 그 판정도 완료 캐시로 적지 않는다', (() => {
    const c = JSON.parse(readFileSync(join(dd, 'auto-draft-cache.json'), 'utf-8')) as Record<string, unknown>
    return Object.keys(c).filter((k) => k.startsWith('q|')).length === 0
  })())
  check('🔴 [B] 그때도 러너는 조용히 끝나지 않는다 — 장부를 찍는다',
    /장부 SDI/.test(capped.out))

  // ⓖ 기존 계약 유지
  check('🔴 [B] 사람 확인 문구가 그대로 찍힌다', cold.out.includes(MACHINE_AGE_HUMAN_REVIEW_NOTE))
  check('🔴 [B] 생성 전 큐 제외가 그대로 돈다', /생성 전 제외/.test(cold.out))
  check('🔴 [B] 위기 · 생활사 집계가 그대로 찍힌다',
    /위기 소재로 \*\*부르기 전에\*\* 멈춘 원천/.test(cold.out) && /생활사 충돌 재생성/.test(cold.out))
  check('🔴 [B] 장부가 그대로 돈다', /장부 SDA · 유료 \d+건/.test(cold.out))
  check('🔴 [B] 입력 파일을 지우지 않았다',
    existsSync(join(dd, 'x.shadow.jsonl')) && existsSync(join(dd, 'x.detail.jsonl')))
  if (fail > 0) {
    console.log(`\n  (마지막 회차 출력 꼬리)\n${cold.out.split('\n').slice(-16).map((l) => `    ${l}`).join('\n')}`)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 더 좋은 글을 쓰는지는 증명하지 않았다.')
if (fail > 0) process.exit(1)
