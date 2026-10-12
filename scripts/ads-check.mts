#!/usr/bin/env tsx
/**
 * S-MON 광고 기반 검사 — gate 판정 · `/ads.txt` · 홈 슬롯 위치 · 경계 · 변이 증명.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §5 · §6 · §7 · §10 · §13.
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/ads-check.mts [--base <sha>]
 *
 * 🔴 네트워크·DB 에 연결하지 않는다. Google 에 요청하지 않는다.
 * 🔴 실제 publisher ID · 광고 단위 ID 를 쓰지 않는다. 형식만 맞는 가짜 값을 실행 중에 만든다.
 * 🔴 판정마다 일부러 망가뜨린 구현을 같은 행렬에 넣어 **실패하는지** 확인한다. 통과만 하는 검사는 검사가 아니다.
 * 🔴 `--base <sha>` 를 주면 그 commit 이후 바뀐 파일이 허용 목록 안에 있는지도 본다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AD_PAGES, AD_SLOTS, ADS_GLOBAL_ENV, ADSENSE_PUBLISHER_ENV } from '../src/lib/ads/config'
import { adSlotGate, adsTxtBody, type AdEnv, type AdSlotGate } from '../src/lib/ads/gate'
import { GET as adsTxtGet } from '../src/app/ads.txt/route'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

// 형식만 맞는 가짜 값 — 저장소에 숫자 열을 남기지 않으려고 실행 중에 만든다
const FAKE_PUBLISHER = `pub-${'7'.repeat(16)}`
const FAKE_UNIT = '3'.repeat(10)

const SLOT = 'home-bottom' as const
const slotConfig = AD_SLOTS[SLOT]
const ALL_ON: AdEnv = {
  VERCEL_ENV: 'production',
  [ADS_GLOBAL_ENV]: 'on',
  [AD_PAGES[slotConfig.page].switchEnv]: 'on',
  [slotConfig.switchEnv]: 'on',
  [ADSENSE_PUBLISHER_ENV]: FAKE_PUBLISHER,
  [slotConfig.unitEnv]: FAKE_UNIT,
}
const without = (key: string): AdEnv => {
  const env: Record<string, string | undefined> = { ...ALL_ON }
  delete env[key]
  return env
}
const withValue = (key: string, value: string): AdEnv => ({ ...ALL_ON, [key]: value })

type Case = { name: string; env: AdEnv; active: boolean }
const CASES: Case[] = [
  { name: '모든 조건 충족 → 열림', env: ALL_ON, active: true },
  { name: 'env 하나도 없음(기본) → 닫힘', env: {}, active: false },
  { name: 'Production 아님(preview) → 닫힘', env: withValue('VERCEL_ENV', 'preview'), active: false },
  { name: 'Production 아님(development) → 닫힘', env: withValue('VERCEL_ENV', 'development'), active: false },
  { name: 'VERCEL_ENV 없음(로컬) → 닫힘', env: without('VERCEL_ENV'), active: false },
  { name: '전체 스위치 없음 → 닫힘', env: without(ADS_GLOBAL_ENV), active: false },
  { name: '전체 스위치 off → 닫힘', env: withValue(ADS_GLOBAL_ENV, 'off'), active: false },
  { name: '전체 스위치 true(다른 표기) → 닫힘', env: withValue(ADS_GLOBAL_ENV, 'true'), active: false },
  { name: '전체 스위치 ON(대문자) → 닫힘', env: withValue(ADS_GLOBAL_ENV, 'ON'), active: false },
  { name: '페이지 스위치 없음 → 닫힘', env: without(AD_PAGES[slotConfig.page].switchEnv), active: false },
  { name: '슬롯 스위치 없음 → 닫힘', env: without(slotConfig.switchEnv), active: false },
  { name: 'publisher ID 없음 → 닫힘', env: without(ADSENSE_PUBLISHER_ENV), active: false },
  { name: 'publisher ID 가 ca-pub 형식 → 닫힘', env: withValue(ADSENSE_PUBLISHER_ENV, `ca-${FAKE_PUBLISHER}`), active: false },
  { name: 'publisher ID 자릿수 틀림 → 닫힘', env: withValue(ADSENSE_PUBLISHER_ENV, `pub-${'7'.repeat(15)}`), active: false },
  { name: '광고 단위 ID 없음 → 닫힘', env: without(slotConfig.unitEnv), active: false },
  { name: '광고 단위 ID 형식 틀림 → 닫힘', env: withValue(slotConfig.unitEnv, 'abc'), active: false },
]

type GateFn = (env: AdEnv) => AdSlotGate

function matrixFailures(gate: GateFn): string[] {
  const failures: string[] = []
  for (const c of CASES) {
    let result: AdSlotGate
    try {
      result = gate(c.env)
    } catch {
      failures.push(`${c.name}: throw`)
      continue
    }
    if (result.active !== c.active) failures.push(c.name)
  }
  return failures
}

// ─────────── 1. gate 판정 ───────────
console.log('\n■ 1. gate 판정 행렬')
const realGate: GateFn = (env) => adSlotGate(env, SLOT)
for (const c of CASES) {
  const r = realGate(c.env)
  check(c.name, r.active === c.active, `active=${r.active}`)
}
const opened = realGate(ALL_ON)
check('열렸을 때 client ID 는 ca-pub 형식이고 publisher ID 에서 만든다',
  opened.active && opened.clientId === `ca-${FAKE_PUBLISHER}`)
check('열렸을 때 광고 단위 ID 를 그대로 넘긴다', opened.active && opened.unitId === FAKE_UNIT)

// ─────────── 2. 변이 — 망가뜨린 gate 는 행렬에서 떨어져야 한다 ───────────
console.log('\n■ 2. 변이 증명')
const MUTANTS: Array<[string, GateFn]> = [
  ['Production 조건을 뺀 gate', (env) => realGate({ ...env, VERCEL_ENV: 'production' })],
  ['전체 스위치를 무시한 gate', (env) => realGate({ ...env, [ADS_GLOBAL_ENV]: 'on' })],
  ['페이지 스위치를 무시한 gate', (env) => realGate({ ...env, [AD_PAGES[slotConfig.page].switchEnv]: 'on' })],
  ['슬롯 스위치를 무시한 gate', (env) => realGate({ ...env, [slotConfig.switchEnv]: 'on' })],
  ['true 도 켬으로 받는 gate', (env) => realGate({
    ...env,
    [ADS_GLOBAL_ENV]: env[ADS_GLOBAL_ENV] === 'true' ? 'on' : env[ADS_GLOBAL_ENV],
  })],
  ['ID 검증을 뺀 gate', (env) => {
    const r = realGate({ ...env, [ADSENSE_PUBLISHER_ENV]: FAKE_PUBLISHER, [slotConfig.unitEnv]: FAKE_UNIT })
    return r
  }],
  ['기본값이 켬인 gate', (env) => (Object.keys(env).length === 0
    ? { active: true, clientId: 'x', unitId: 'y' }
    : realGate(env))],
]
check('실제 gate 는 행렬을 전부 통과한다', matrixFailures(realGate).length === 0,
  matrixFailures(realGate).join(', '))
for (const [name, mutant] of MUTANTS) {
  const failures = matrixFailures(mutant)
  check(`변이 "${name}" 를 행렬이 잡는다`, failures.length > 0)
}

// ─────────── 3. /ads.txt ───────────
console.log('\n■ 3. /ads.txt')
check('publisher ID 없음 → 본문 없음(404)', adsTxtBody({}) === null)
check('ca-pub 형식 → 본문 없음(404)', adsTxtBody({ [ADSENSE_PUBLISHER_ENV]: `ca-${FAKE_PUBLISHER}` }) === null)
check('공백이 섞인 값 → 본문 없음(404)', adsTxtBody({ [ADSENSE_PUBLISHER_ENV]: ` ${FAKE_PUBLISHER}` }) === null)
check('정상 값 → Google 형식 한 줄',
  adsTxtBody({ [ADSENSE_PUBLISHER_ENV]: FAKE_PUBLISHER }) === `google.com, ${FAKE_PUBLISHER}, DIRECT, f08c47fec0942fa0\n`)
check('광고 스위치가 모두 꺼져 있어도 응답한다(소유권 확인 분리)',
  adsTxtBody({ [ADSENSE_PUBLISHER_ENV]: FAKE_PUBLISHER, [ADS_GLOBAL_ENV]: 'off' }) !== null)

async function routeWith(value: string | undefined) {
  const saved = process.env[ADSENSE_PUBLISHER_ENV]
  if (value === undefined) delete process.env[ADSENSE_PUBLISHER_ENV]
  else process.env[ADSENSE_PUBLISHER_ENV] = value
  try {
    const res = adsTxtGet()
    return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: await res.text() }
  } finally {
    if (saved === undefined) delete process.env[ADSENSE_PUBLISHER_ENV]
    else process.env[ADSENSE_PUBLISHER_ENV] = saved
  }
}
const r404 = await routeWith(undefined)
check('route: env 없음 → 404 · no-store', r404.status === 404 && r404.cache === 'no-store')
const rBad = await routeWith('pub-123')
check('route: 잘못된 값 → 404', rBad.status === 404)
const rOk = await routeWith(FAKE_PUBLISHER)
check('route: 정상 값 → 200 · text/plain · 한 줄',
  rOk.status === 200 && rOk.type === 'text/plain; charset=utf-8'
  && rOk.body === `google.com, ${FAKE_PUBLISHER}, DIRECT, f08c47fec0942fa0\n`)
check('route: 캐시 정책을 명시한다', rOk.cache === 'public, max-age=3600, s-maxage=3600')
check('route: 요청마다 env 를 읽는다(force-dynamic)', /export const dynamic = 'force-dynamic'/.test(read('src/app/ads.txt/route.ts')))

// ─────────── 4. 홈 슬롯 위치 ───────────
console.log('\n■ 4. 홈 슬롯 위치')
const home = read('src/app/page.tsx')
const slotTags = home.match(/<AdSlot\b[^>]*\/>/g) ?? []
check('홈에 광고 슬롯이 정확히 1개', slotTags.length === 1, `${slotTags.length}개`)
check('그 슬롯은 home-bottom', slotTags[0] === '<AdSlot slot="home-bottom" />')
const joinAt = home.indexOf('<HomeJoinCta')
const slotAt = home.indexOf('<AdSlot')
const mainEndAt = home.lastIndexOf('</main>')
check('슬롯은 HomeJoinCta 뒤, </main> 안이다', joinAt > 0 && slotAt > joinAt && slotAt < mainEndAt)
check('HomeJoinCta 와 슬롯 사이에 다른 블록이 없다',
  !/<[A-Z]/.test(home.slice(home.indexOf('/>', joinAt) + 2, slotAt)))

// ─────────── 5. 코드 경계 ───────────
console.log('\n■ 5. 코드 경계')
// commit 전 새 파일도 본다 — 추적 중인 파일만 훑으면 막 만든 파일의 ID 하드코딩을 놓친다
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
const AD_FILES = [
  'src/lib/ads/config.ts',
  'src/lib/ads/gate.ts',
  'src/components/ads/AdSlot.tsx',
  'src/components/ads/AdSenseUnit.tsx',
  'src/app/ads.txt/route.ts',
]
const unit = read('src/components/ads/AdSenseUnit.tsx')
const adCode = AD_FILES.map(read).join('\n')

check('Auto Ads 를 켜는 설정이 없다',
  !/enable_page_level_ads|google_ad_client|page_level|autoads/i.test(adCode))
const npaAt = unit.indexOf('requestNonPersonalizedAds = 1')
const appendAt = unit.indexOf('document.head.appendChild(script)')
const pushAt = unit.indexOf('adsQueue().push(')
check('NPA 신호를 script 를 붙이기 전에 설정한다', npaAt > 0 && appendAt > npaAt)
check('NPA 신호를 광고 요청(push) 전에 설정한다', npaAt > 0 && pushAt > npaAt)
check('script 를 모듈 단위 Promise 하나로 한 번만 붙인다',
  /let scriptLoad: Promise<void> \| null = null/.test(unit) && /if \(scriptLoad\) return scriptLoad/.test(unit))
check('이미 처리된 칸에는 다시 요청하지 않는다', unit.includes("ins.hasAttribute('data-adsbygoogle-status')"))
check('미충전을 data-ad-status 로 보고 접는다',
  unit.includes("getAttribute('data-ad-status') === 'unfilled'") && unit.includes('if (collapsed) return null'))
check('script 실패·push 오류를 접기로 처리한다', /\.catch\(collapse\)/.test(unit) && /catch \{\s*collapse\(\)/.test(unit))
check('슬롯에 「광고」 표기가 있다', unit.includes('aria-label="광고"') && unit.includes('>광고</p>'))
check('예약 공간을 고정 높이로 잡는다', /\bh-\[\d+px\]/.test(unit))
check('화면 고정 위치·높은 레이어를 쓰지 않는다', !/\b(fixed|sticky)\b|\bz-\d/.test(unit))

const AD_IMPORT_BAN = /from ['"](@\/|\.\.?\/)[^'"]*(signup|funnel|analytics|prisma|queries|magazine|persona|supply|stage|original-post)/i
check('광고 코드가 회원가입 전환·분석·DB·D100·매거진 모듈을 import 하지 않는다', !AD_IMPORT_BAN.test(adCode))

const adImporters = tracked
  .filter((f) => /^src\/.*\.(ts|tsx)$/.test(f) && !AD_FILES.includes(f))
  .filter((f) => /@\/(components|lib)\/ads\//.test(read(f)))
check('광고 모듈을 쓰는 곳은 홈 하나다', JSON.stringify(adImporters) === JSON.stringify(['src/app/page.tsx']),
  adImporters.join(', '))

// 정확히 16자리에서 끝나는 것만 — R2 공개 bucket 주소(`pub-` + 32자리)는 publisher ID 가 아니다
const ID_LITERAL = /(?<![\w-])(ca-)?pub-\d{16}(?![\w])/
const idHits = tracked
  .filter((f) => /^(src|scripts|public)\//.test(f) && /\.(ts|tsx|mts|mjs|js|json|txt|html)$/.test(f))
  .filter((f) => ID_LITERAL.test(read(f)))
check('src · scripts · public 에 publisher ID 숫자열이 없다', idHits.length === 0, idHits.join(', '))
check('public/ads.txt 정적 파일이 없다(env 경로 하나)', !tracked.includes('public/ads.txt'))

// ─────────── 6. 변경 파일 허용 목록 ───────────
const baseAt = process.argv.indexOf('--base')
if (baseAt > 0 && process.argv[baseAt + 1]) {
  console.log('\n■ 6. 변경 파일 허용 목록')
  const base = process.argv[baseAt + 1]
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
  const working = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.slice(3))
  const ALLOWED = new Set([...AD_FILES, 'src/app/page.tsx', 'scripts/ads-check.mts'])
  const outside = [...new Set([...changed, ...working])].filter((f) => !ALLOWED.has(f))
  check('허용 목록 밖 변경이 없다', outside.length === 0, outside.join(', '))
}

console.log(`\n광고 기반 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
