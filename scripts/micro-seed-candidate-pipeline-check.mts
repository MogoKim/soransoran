#!/usr/bin/env tsx
/**
 * 후보 생성 파이프라인 fixture — 🔴 **기계가 사람 판정을 넘지 않는다** (§4-AO)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  findBottleneck, planSteps, diagnose, checkCandidateShape, readLayer, candidateKeyOf,
  LAYERS, LAYER_ACTOR, LAYER_LABEL, LAYER_ACTION,
  type PipelineInput,
} from '../src/lib/micro-seed-candidate-pipeline'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

/** 전부 비어 있는 상태 — 여기서 한 층씩 채워 본다 */
const empty = (): PipelineInput => ({
  seedApproval: { total: 0, passed: 0 },
  draft: { total: 0, passed: 0 },
  adopt: { total: 0, passed: 0 },
  candidate: { total: 0, passed: 0 },
})

console.log('\n후보 생성 파이프라인 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 기계는 사람 판정 층을 넘지 않는다')
{
  check('판정(draft) 층은 사람 몫이다', LAYER_ACTOR.draft === 'human')
  check('나머지 셋은 기계 몫이다',
    LAYER_ACTOR.seedApproval === 'machine' && LAYER_ACTOR.adopt === 'machine'
    && LAYER_ACTOR.candidate === 'machine')

  const i = empty()
  i.draft = { total: 5, passed: 0 }
  const steps = planSteps(i)
  const draftStep = steps.find((s) => s.layer === 'draft')!
  check('🔴 판정 대기가 있어도 기계가 돌리지 않는다', !draftStep.runnable)
  check('멈춘 이유를 말한다', draftStep.reason.includes('사람이 판정해야 한다'))
  check('🔴 어떤 입력에도 draft 는 runnable 이 되지 않는다', (() => {
    for (const n of [1, 10, 999]) {
      const x = empty()
      x.draft = { total: n, passed: 0 }
      if (planSteps(x).find((s) => s.layer === 'draft')!.runnable) return false
    }
    return true
  })())
  check('사람 층 안내에 화면 이름이 있다', LAYER_ACTION.draft.includes('seed-originality-review'))
}

console.log('\n② 막힌 곳은 가장 앞에서 찾는다')
{
  const i = empty()
  i.seedApproval = { total: 3, passed: 1 }
  i.adopt = { total: 9, passed: 2 }
  const { next } = findBottleneck(i)
  check('🔴 뒤에 일감이 많아도 앞이 먼저다', next?.layer === 'seedApproval')
  check('앞 층 일감 수가 맞다', next?.pending === 2)

  const j = empty()
  j.adopt = { total: 9, passed: 2 }
  check('앞이 비면 뒤에서 찾는다', findBottleneck(j).next?.layer === 'adopt')
  check('전부 비면 next 가 없다', findBottleneck(empty()).next === null)
}

console.log('\n③ 🔴 "마름" 과 "사람 대기" 를 구분한다')
{
  const starved = diagnose(empty())
  check('🔴 전 구간 0 이면 starved', starved.signal === 'starved')
  check('starved 는 새 원천이 필요하다고 말한다', starved.message.includes('새 원천'))

  const h = empty()
  h.draft = { total: 4, passed: 1 }
  const blocked = diagnose(h)
  check('🔴 사람 대기는 starved 가 아니다', blocked.signal === 'human-blocked')
  check('사람 대기는 대기 건수를 말한다', blocked.message.includes('3건'))

  const r = empty()
  r.adopt = { total: 5, passed: 0 }
  check('기계가 할 수 있으면 runnable', diagnose(r).signal === 'runnable')

  // 🔴 둘을 뭉뚱그리면 판정만 하다가 원천이 없는 걸 뒤늦게 안다
  check('🔴 세 신호가 서로 다르다', new Set([
    diagnose(empty()).signal, diagnose(h).signal, diagnose(r).signal,
  ]).size === 3)
}

console.log('\n④ 층 계산')
{
  check('일감 = 들어온 것 − 넘어간 것',
    readLayer('adopt', { total: 10, passed: 3 }).pending === 7)
  check('🔴 넘어간 것이 더 많아도 음수가 안 된다',
    readLayer('adopt', { total: 2, passed: 5 }).pending === 0)
  check('전부 넘어가면 일감 0', readLayer('draft', { total: 4, passed: 4 }).pending === 0)
  check('층은 넷이다', LAYERS.length === 4)
  check('층마다 이름과 명령이 있다',
    LAYERS.every((l) => LAYER_LABEL[l] !== '' && LAYER_ACTION[l] !== ''))
}

console.log('\n⑤ 🔴 생성기와 소비기의 계약 — 어긋나면 조용히 0건이 된다')
{
  const good = { candidateType: 'seedOriginality', sourceArticleId: '1', title: 't', safetyVerdict: 'pass' }
  check('🟢 온전한 후보는 통과', checkCandidateShape([good]).ok)
  check('빈 목록은 통과 (문제가 아니라 재고 0)', checkCandidateShape([]).ok)

  for (const f of ['candidateType', 'sourceArticleId', 'title', 'safetyVerdict'] as const) {
    const bad = { ...good, [f]: '' }
    const r = checkCandidateShape([bad])
    check(`🔴 ${f} 가 비면 잡는다`, !r.ok && r.problems.some((p) => p.includes(f)))
  }
  check('🔴 빠지면 소비기가 전부 거른다고 말한다',
    checkCandidateShape([{ ...good, safetyVerdict: '' }]).problems[0]!.includes('supply-autofill'))
  check('🔴 같은 (출처+제목) 중복을 잡는다', (() => {
    const r = checkCandidateShape([good, { ...good }])
    return !r.ok && r.problems.some((p) => p.includes('겹친다'))
  })())
  check('같은 출처라도 제목이 다르면 다른 후보',
    checkCandidateShape([good, { ...good, title: 'u' }]).ok)
  check('제목 공백 차이는 같은 것으로 본다',
    candidateKeyOf('1', 'a  b') === candidateKeyOf('1', 'a b'))
}

console.log('\n⑥ 🔴 하지 않는 것 — 스캔')
{
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-candidate-pipeline.mts')
  const lib = codeOf('src/lib/micro-seed-candidate-pipeline.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['네이버 · 브라우저', /naver\.com|playwright|chromium|puppeteer/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(|from\s+'[^']*(?:publish-live|auto-publish)'/],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }

  check('🔴 lib 은 순수 함수만이다', !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 임의 셸 문자열을 실행하지 않는다 — npm run 이름만 받는다',
    /\^npm run \(\[a-z0-9:-\]\+\)\$/.test(runner))
  check('🔴 execFileSync 를 쓴다 (execSync 아님)',
    /execFileSync/.test(runner) && !/\bexecSync\b/.test(runner))
  check('진단이 기본이고 --apply 가 있어야 실행한다',
    /const APPLY = argv\.includes\('--apply'\)/.test(runner))
  check('🔴 --apply 도 파일까지다 — 그렇게 화면에 적는다',
    /--apply 도 파일만 만든다/.test(readFileSync('scripts/micro-seed-candidate-pipeline.mts', 'utf-8')))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑦ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  check('POST_CAP_PER_WEEK = 1 그대로', /export const POST_CAP_PER_WEEK = 1\b/.test(m))
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', /export const MIN_DAYS_BETWEEN_POSTS = 5\b/.test(m))
  check('DAILY_PUBLISH_CAP = 1 그대로',
    /export const DAILY_PUBLISH_CAP = 1\b/.test(readFileSync('src/lib/original-post-publish.ts', 'utf-8')))
  check('🔴 파이프라인 lib 이 발행 상수를 모른다',
    !/DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS/
      .test(readFileSync('src/lib/micro-seed-candidate-pipeline.ts', 'utf-8')))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
