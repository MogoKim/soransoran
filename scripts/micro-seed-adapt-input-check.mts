#!/usr/bin/env tsx
/**
 * adapt 입력 경로 · 읽기 실패 fixture — 🔴 **조용한 0행을 다시는 만들지 않는다**
 *
 * 🔴 **왜 이 파일이 있나.** 2026-09-11, 새 공급 runtime 의 첫 실 drain 에서
 *    17행짜리 thin 파일이 0행으로 처리됐다. 러너(`supply-process`)는 `readdirSync` 가 준
 *    **맨 이름**을 `--input=` 으로 넘겼는데, 어댑터는 그 문자열을 cwd 기준으로 열었다.
 *    ENOENT 가 났고 `catch { return out }` 이 그것을 빈 배열로 삼켰다.
 *    exit 0 · 산출물 1바이트 · 관제 조용. 26개 파일이 그렇게 만들어졌다.
 *
 * 🔴 **가짜가 아니라 진짜를 돌린다.** 임시 디렉터리에 실제 파일을 만들고
 *    실제 러너를 spawn 한다 — 경로 결합은 프로세스의 cwd 가 결정하므로
 *    함수 단위 mock 으로는 이 결함을 잡을 수 없었다.
 *
 * 네트워크 0 · DB 0 · LLM 0 · 발행 0. 임시 디렉터리 밖에는 아무것도 쓰지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DATA_DIR_NAME, ADAPT_PREFIX, DETAIL_SUFFIX, RAW_DETAIL_SUFFIX,
  resolveThinInput, parseJsonl, completedAdaptKeys, partialAdaptKeys, adaptArtifactsOf,
  SOURCE_AXIS,
} from '../src/lib/micro-seed-82cook-thin-adapt'
import {
  planPending, planSourcePhase, planCommonPhase, runSourcePhase, judgeJitDemand, adaptKeyOf,
  type Pending,
} from '../src/lib/supply-process'

/** 🔴 큐 스냅샷이 준비된 상태 — 기존 기대(draft 계획됨)를 그대로 본다 */
const GATE_READY = { kind: 'ready', snapshotPath: '.microseed-data/snap.json', runId: 'R1' } as const

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const REPO = process.cwd()
const RUNNER = join(REPO, 'scripts/micro-seed-82cook-thin-adapt.mts')

/** 유효한 thin 한 줄 */
const row = (id: string): string => JSON.stringify({
  sourceArticleId: id, sourceSite: '82cook',
  url: `https://www.82cook.com/entiz/read.php?bn=15&num=${id}`,
  title: `제목 ${id}`, commentCount: 7, score: 0,
  bodyLength: 120, bodyHead: '가'.repeat(120),
  axis: SOURCE_AXIS, safetyVerdict: 'pass', safetyReasons: '',
  reason: '', runId: '20260911-205919', fetchedAt: '2026-09-11T11:59:19.000Z',
})

type Run = { code: number; out: string; made: string[] }

/** 임시 저장소를 만들고 거기서 진짜 러너를 돌린다 */
function runIn(files: Record<string, string>, args: readonly string[]): Run {
  const root = mkdtempSync(join(tmpdir(), 'adaptfix-'))
  try {
    const data = join(root, DATA_DIR_NAME)
    mkdirSync(data, { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(join(data, name), body, 'utf-8')
    const r = spawnSync('npx', ['tsx', RUNNER, ...args], {
      cwd: root, encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    })
    const made = existsSync(data)
      ? readdirSync(data).filter((f) => f.startsWith(ADAPT_PREFIX)).sort()
      : []
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, made }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log('\nadapt 입력 경로 · 읽기 실패 — 행동 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 재현 — 러너처럼 맨 이름을 넘긴다')
{
  const name = '82cook-thin-20260911-205919.thin-detail.jsonl'
  const r = runIn({ [name]: `${row('4238081')}\n${row('4238082')}\n` }, ['--apply', `--input=${name}`])
  check('exit 0', r.code === 0)
  check('🔴 2행이 실제로 변환된다 (옛 판은 0행이었다)', /2행/.test(r.out))
  check('detail · raw-detail 두 벌이 난다', r.made.length === 2)
  const key = adaptKeyOf(name)
  check('사본 이름이 회차 키를 쓴다',
    r.made.includes(`${ADAPT_PREFIX}${key}${DETAIL_SUFFIX}`)
    && r.made.includes(`${ADAPT_PREFIX}${key}${RAW_DETAIL_SUFFIX}`))
}

console.log('\n② `.microseed-data/…` 경로도 그대로 받는다 — 중복 결합 없음')
{
  const name = '82cook-thin-20260911-205919.thin-detail.jsonl'
  const r = runIn({ [name]: `${row('4238081')}\n` }, ['--apply', `--input=${DATA_DIR_NAME}/${name}`])
  check('exit 0', r.code === 0)
  check('1행이 변환된다', /1행/.test(r.out))
  check(`🔴 ${DATA_DIR_NAME}/${DATA_DIR_NAME} 을 만들지 않았다`, !new RegExp(`${DATA_DIR_NAME}/${DATA_DIR_NAME}`).test(r.out))
}

console.log('\n③ 🔴 없는 파일 — exit 1 · 산출물 0')
{
  const r = runIn({}, ['--apply', '--input=없는파일.thin-detail.jsonl'])
  check('exit 1', r.code === 1)
  check('산출물 0', r.made.length === 0)
  check('"파일이 없다" 로 말한다 — 0행이 아니다', /파일이 없다/.test(r.out))
}

console.log('\n④ 🔴 깨진 JSON — exit 1 · 산출물 0')
{
  const name = '82cook-thin-깨짐.thin-detail.jsonl'
  const r = runIn({ [name]: `${row('4238081')}\n{ 이건 JSON 이 아니다\n` }, ['--apply', `--input=${name}`])
  check('exit 1', r.code === 1)
  check('산출물 0', r.made.length === 0)
  check('몇 번째 줄인지 말한다', /2번째 줄/.test(r.out))
}

console.log('\n⑤ 정상 0행은 읽기 실패와 다르다')
{
  const name = '82cook-thin-빈것.thin-detail.jsonl'
  const r = runIn({ [name]: '' }, ['--apply', `--input=${name}`])
  check('exit 0 — 조용한 날은 실패가 아니다', r.code === 0)
  check('0행으로 보고한다', /0행/.test(r.out))
  check('🔴 "못 읽었다" 라고 하지 않는다', !/읽지 못했다|파일이 없다/.test(r.out))
  // 순수 함수 쪽에서도 같은 구분
  const empty = parseJsonl('')
  check('parseJsonl("") 은 ok · 0행', empty.ok && empty.rows.length === 0)
  const broken = parseJsonl('{nope\n')
  check('parseJsonl(깨진 것) 은 not ok', !broken.ok)
}

console.log('\n⑥ 🔴 데이터 디렉터리 밖은 거부한다')
{
  for (const [bad, why] of [
    ['/etc/passwd', '절대경로'],
    ['../secret.thin-detail.jsonl', '상위 탈출'],
    [`${DATA_DIR_NAME}/../secret.jsonl`, '중간 탈출'],
  ] as const) {
    const r = resolveThinInput(bad)
    check(`${why} 거부 — ${bad}`, !r.ok)
  }
  const good = resolveThinInput('x.thin-detail.jsonl')
  check('맨 이름은 붙인다', good.ok && good.path === `${DATA_DIR_NAME}/x.thin-detail.jsonl`)
  const already = resolveThinInput(`${DATA_DIR_NAME}/x.thin-detail.jsonl`)
  check('이미 붙은 것은 그대로', already.ok && already.path === `${DATA_DIR_NAME}/x.thin-detail.jsonl`)
  const dotted = resolveThinInput(`./${DATA_DIR_NAME}/x.thin-detail.jsonl`)
  check('./ 접두는 정규화한다', dotted.ok && dotted.path === `${DATA_DIR_NAME}/x.thin-detail.jsonl`)
  const r = runIn({}, ['--apply', '--input=/etc/passwd'])
  check('러너도 거부한다 — exit 1 · 산출물 0', r.code === 1 && r.made.length === 0)
}

console.log('\n⑦ 🔴 두 벌이 다 있어야 완료다')
{
  const key = 'remonterrace-20260911-210444'
  const both = [`${ADAPT_PREFIX}${key}${DETAIL_SUFFIX}`, `${ADAPT_PREFIX}${key}${RAW_DETAIL_SUFFIX}`]
  check('둘 다 있으면 완료', completedAdaptKeys(both).has(key))
  check('detail 만 있으면 미완료', !completedAdaptKeys([both[0]!]).has(key))
  check('raw-detail 만 있으면 미완료', !completedAdaptKeys([both[1]!]).has(key))
  check('한쪽만 있으면 partial 로 잡힌다', partialAdaptKeys([both[0]!]).has(key))
  const a = adaptArtifactsOf(both).get(key)
  check('raw-detail 이 detail 로 잘못 세지 않는다', a?.detail === true && a?.rawDetail === true)
  // 한쪽만 남아 있으면 러너가 다시 만든다
  const name = '82cook-thin-20260911-205919.thin-detail.jsonl'
  const k2 = adaptKeyOf(name)
  const r = runIn({
    [name]: `${row('4238081')}\n`,
    [`${ADAPT_PREFIX}${k2}${DETAIL_SUFFIX}`]: '\n',
  }, ['--apply', `--input=${name}`])
  check('한쪽만 있던 회차를 다시 만든다', r.code === 0 && r.made.length === 2)
  check('다시 만든다고 말한다', /한쪽만 있다/.test(r.out))
}

console.log('\n⑦-b 🔴 **실제 오케스트레이터 경로** — planPending → planSourcePhase')
{
  // 🔴 어댑터를 직접 spawn 하는 ⑦ 은 예약 실행이 지나가는 길이 아니다.
  //    실제 회차는 planPending 이 완료를 판정하고 planSourcePhase 가 adapt 를 건다.
  //    2026-09-11 Codex 리뷰: 그 길에는 옛 정규식이 그대로 남아 있었다.
  const THIN = '82cook-thin-20260911-205919.thin-detail.jsonl'
  const key = adaptKeyOf(THIN)
  const D = `${ADAPT_PREFIX}${key}${DETAIL_SUFFIX}`
  const R = `${ADAPT_PREFIX}${key}${RAW_DETAIL_SUFFIX}`
  const thinOf = (files: readonly string[]): string[] => planPending(files).thin['82cook'] ?? []
  const adaptPlanned = (files: readonly string[]): boolean =>
    planSourcePhase(planPending(files))
      .some((sp) => sp.source === '82cook' && sp.stages.some((st) => st.stage === 'adapt'))

  check('thin + detail 만 → pending thin 1건', thinOf([THIN, D]).length === 1)
  check('thin + detail 만 → adapt 가 계획된다', adaptPlanned([THIN, D]))
  check('thin + raw-detail 만 → pending thin 1건', thinOf([THIN, R]).length === 1)
  check('thin + raw-detail 만 → adapt 가 계획된다', adaptPlanned([THIN, R]))
  check('thin + 두 산출물 → pending thin 0건', thinOf([THIN, D, R]).length === 0)
  check('thin + 두 산출물 → adapt 를 다시 걸지 않는다', !adaptPlanned([THIN, D, R]))
  check('🔴 두 산출물이 있으면 공통 judge·draft·fill 이 실제로 선다', (() => {
    const stages = planCommonPhase(planPending([THIN, D, R]), judgeJitDemand({ slots: 12, readyFilled: 0 }), GATE_READY).map((x) => x.stage)
    return stages.includes('judge') && stages.includes('draft') && stages.includes('fill')
  })())
  check('🔴 planPending 이 옛 한쪽 기준 정규식을 쓰지 않는다', (() => {
    const lib = readFileSync('src/lib/supply-process.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
    return /completedAdaptKeys\(/.test(lib) && !/82cook-adapt-\(\.\+\?\)/.test(lib)
  })())
}

console.log('\n⑧ 🔴 한 source 실패가 다른 source 를 막지 않는다')
{
  const seen: string[] = []
  const pending: Pending = {
    rawCafe: {},
    thin: {
      '82cook': ['82cook-thin-A.thin-detail.jsonl'],
      'navercafe:remonterrace': ['navercafe-thin-remonterrace-B.thin-detail.jsonl'],
      'navercafe:wgang': ['navercafe-thin-wgang-C.thin-detail.jsonl'],
    },
    detail: [], shadow: [], candidates: [],
  }
  const plans = planSourcePhase(pending)
  const r = await runSourcePhase({
    plans,
    now: () => '2026-09-11T12:00:00.000Z',
    exec: async (stage) => {
      seen.push(`${stage.source}:${stage.stage}`)
      // 🔴 첫 source 만 떨어뜨린다
      return stage.source === '82cook'
        ? { ok: false, exitCode: 1, spawnError: '' }
        : { ok: true, exitCode: 0, spawnError: '' }
    },
  })
  check('82cook 이 실패해도 나머지 두 source 가 돈다',
    seen.some((x) => x.startsWith('navercafe:remonterrace'))
    && seen.some((x) => x.startsWith('navercafe:wgang')))
  check('실패한 source 만 failed 로 남는다',
    r.sources.filter((x) => x.status === 'failed').map((x) => x.source).join(',') === '82cook')
  check('나머지는 ok', r.sources.filter((x) => x.status === 'ok').length === 2)
}

console.log('\n⑨ adapt 가 끝나면 공통 judge·draft·fill 계획이 선다')
{
  const pending: Pending = {
    rawCafe: {}, thin: {},
    detail: ['82cook-adapt-A.detail.jsonl'],
    shadow: ['auto-judge-A.shadow.jsonl'],
    candidates: ['auto-draft-A.candidates.json'],
  }
  // 🔴 재고가 버퍼 목표보다 적을 때만 모델·적재가 돈다 — 그 정본을 그대로 쓴다
  const plan = planCommonPhase(pending, judgeJitDemand({ slots: 12, readyFilled: 0 }), GATE_READY)
  const stages = plan.map((p) => p.stage)
  check('judge · draft · fill 순서로 선다',
    stages.includes('judge') && stages.includes('draft') && stages.includes('fill')
    && stages.indexOf('judge') < stages.indexOf('draft')
    && stages.indexOf('draft') < stages.indexOf('fill'))
  check('🔴 이 단계들은 --input 을 들고 다니지 않는다',
    plan.every((p) => !p.args.some((a) => a.startsWith('--input='))))
}

console.log('\n⑩ 🔴 옛 결함을 되돌리면 잡힌다 (소스 대조)')
{
  const runner = readFileSync('scripts/micro-seed-82cook-thin-adapt.mts', 'utf-8')
  // 🔴 **주석이 아니라 코드를 본다.** 이 파일의 주석은 옛 결함을 일부러 원문으로 적어 둔다 —
  //    그 설명이 검사를 통과시켜 버리면, 실제로 옛 코드가 돌아와도 초록불이 뜬다.
  const code = runner
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  check('🔴 catch 로 빈 배열을 돌려주지 않는다', !/catch\s*\{\s*return out\s*\}/.test(code))
  check('🔴 --input 을 그대로 열지 않는다 — resolveThinInput 을 쓴다',
    /resolveThinInput\(/.test(code))
  check('🔴 읽기 실패를 exit 1 로 낸다', /산출물 0/.test(code))
  check('🔴 temp 에 쓰고 rename 한다', /renameSync\(/.test(code))
  check('🔴 완료 판정은 두 벌을 본다', /completedAdaptKeys\(/.test(code))
  check('🔴 DATA_DIR 문자열을 여기서 다시 쓰지 않는다',
    !/const DATA_DIR = '\.microseed-data'/.test(code))
  check('🔴 별도 checkpoint 파일을 만들지 않는다',
    !/checkpoint/i.test(code))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
