/**
 * launchd 템플릿 검사 (§4-AU ④-b)
 *
 * 🔴 이 검사가 있는 이유는 하나다. **템플릿이 틀리면 조용히 아무 일도 안 일어난다.**
 *
 * 2026-09-07 supply-autopilot 첫 등록에서 실측한 것:
 *   · launchd 기본 PATH 에 nvm 의 node 가 없어 npx shebang 이 exit 78 로 죽는다
 *   · 로그를 ~/Documents 아래 두면 TCC 때문에 파일을 열지 못해 역시 exit 78 이다
 *   · 둘 다 **프로세스가 뜨기도 전에** 죽어서 stdout·stderr 어디에도 원인이 없다
 *
 * "등록은 됐는데 아무 일도 안 일어나는" 상태를 사람이 알아채려면 며칠이 걸린다.
 * 그동안 공급은 멈춰 있고 큐는 비어간다. 그래서 CI 가 본다.
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · launchctl 0. 파일만 읽는다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  planSlots, verifySchedule, verifyNoCrossOverlap, isolationOf,
} from '../src/lib/collect-schedule'

const DIR = 'docs/operations/launchd'

/** 🔴 설치 스크립트가 반드시 치환해야 하는 것들 */
export const PLACEHOLDERS = ['__NPX__', '__NODE__', '__REPO__', '__NODEBIN__', '__LOGDIR__'] as const

/** 🔴 PATH 는 이 형태여야 한다 — 앞에 node 디렉터리, 뒤에 시스템 기본 */
export const PATH_VALUE = '__NODEBIN__:/usr/bin:/bin:/usr/sbin:/sbin'

/** 🔴 로그는 Documents 밖이어야 한다 */
export const FORBIDDEN_LOG_ROOTS = ['__REPO__/logs', '/Users/', '~/Documents', '$HOME'] as const

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

/** plist 한 벌에서 키의 값을 읽는다 — 🔴 파서를 쓰지 않는다. 문자열 그대로 본다 */
export function valueOf(xml: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)
  const m = re.exec(xml)
  return m === null ? null : m[1]
}

/** `<key>PATH</key>` 아래 문자열 — dict 안에 있어 valueOf 로도 잡힌다 */
export function pathValue(xml: string): string | null {
  if (!/<key>EnvironmentVariables<\/key>/.test(xml)) return null
  return valueOf(xml, 'PATH')
}

export function programArguments(xml: string): string[] {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)
  if (m === null) return []
  return [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1])
}

export function calendarSlots(xml: string): { hour: number; minute: number }[] {
  const m = /<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)
  if (m === null) return []
  return [...m[1].matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/g)]
    .map((x) => ({ hour: Number(x[1]), minute: Number(x[2]) }))
}

/** 🔴 렌더링 — 설치 절차와 **같은 치환**이어야 의미가 있다 */
export function render(xml: string, v: {
  npx: string; node: string; repo: string; nodebin: string; logdir: string
}): string {
  return xml
    .replaceAll('__NPX__', v.npx)
    .replaceAll('__NODE__', v.node)
    .replaceAll('__REPO__', v.repo)
    .replaceAll('__NODEBIN__', v.nodebin)
    .replaceAll('__LOGDIR__', v.logdir)
}

/** 치환하고도 남은 placeholder — 🔴 하나라도 남으면 launchd 가 그 경로를 찾지 못한다 */
export function leftoverPlaceholders(rendered: string): string[] {
  return [...new Set([...rendered.matchAll(/__[A-Z_]+__/g)].map((m) => m[0]))]
}

console.log('\n══ launchd 템플릿 검사 ══\n')

const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.plist.template')).sort()
  : []

check('🔴 템플릿이 7개다 — 하나라도 빠지면 검사 밖에 있는 job 이 생긴다', files.length === 7)

/**
 * 🔴 **등록될 job 의 전부**를 적는다. 슬롯 개수만 세면 시각이 틀려도 통과한다 —
 *    remonterrace 와 wgang 이 같은 시각에 돌면 한 세션으로 두 카페를 연속으로 긁는다.
 *
 * 확정 수집원은 셋뿐이다: 82cook · navercafe:remonterrace · navercafe:wgang.
 * dlxogns01 · masanmam 등은 미활성 장래 후보이며 실행 템플릿을 두지 않는다.
 */
const EXPECTED: Record<string, {
  label: string
  args: string[]
  slots: { hour: number; minute: number }[]
  out: string
  err: string
}> = {
  'com.soransoran.navercafe-collect-remonterrace.plist.template': {
    label: 'com.soransoran.navercafe-collect-remonterrace',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-navercafe.mts',
      '--cafe=remonterrace', '--pages=1', '--max=10', '--thin', '--live'],
    slots: [{ hour: 9, minute: 20 }],
    out: '__LOGDIR__/navercafe-collect-remonterrace.log',
    err: '__LOGDIR__/navercafe-collect-remonterrace-error.log',
  },
  'com.soransoran.navercafe-collect-wgang.plist.template': {
    label: 'com.soransoran.navercafe-collect-wgang',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-navercafe.mts',
      '--cafe=wgang', '--pages=1', '--max=10', '--thin', '--live'],
    slots: [{ hour: 13, minute: 20 }],
    out: '__LOGDIR__/navercafe-collect-wgang.log',
    err: '__LOGDIR__/navercafe-collect-wgang-error.log',
  },
  'com.soransoran.raw-collect-82cook.plist.template': {
    label: 'com.soransoran.raw-collect-82cook',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-82cook.mts',
      '--list', '--pages=3', '--auto', '--auto-max=30', '--live'],
    slots: [7, 9, 11, 13, 15, 17, 19, 21, 23, 1].map((h) => ({ hour: h, minute: 10 })),
    out: '__LOGDIR__/raw-collect-82cook.log',
    err: '__LOGDIR__/raw-collect-82cook-error.log',
  },
  'com.soransoran.raw-import.plist.template': {
    label: 'com.soransoran.raw-import',
    args: [],
    slots: [8, 14, 20, 2].map((h) => ({ hour: h, minute: 0 })),
    out: '__LOGDIR__/raw-import.log',
    err: '__LOGDIR__/raw-import-error.log',
  },
  'com.soransoran.supply-autopilot.plist.template': {
    label: 'com.soransoran.supply-autopilot',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/supply-autopilot.mts', '--live'],
    slots: [{ hour: 21, minute: 10 }],
    out: '__LOGDIR__/supply-autopilot.log',
    err: '__LOGDIR__/supply-autopilot-error.log',
  },
  /**
   * 🔴 **다회 운영 준비판** (2026-09-08). 등록하지 않았다 —
   *    지금 도는 것은 위의 1회짜리이고, 그 템플릿은 건드리지 않았다.
   *    시각은 `collect-schedule.planSlots(id, 'start')` 가 정한다 (fixture 가 대조).
   */
  'com.soransoran.navercafe-collect-remonterrace-multi.plist.template': {
    label: 'com.soransoran.navercafe-collect-remonterrace-multi',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-navercafe.mts',
      '--cafe=remonterrace', '--pages=1', '--max=10', '--thin', '--live'],
    slots: planSlots('navercafe:remonterrace', 'start'),
    out: '__LOGDIR__/navercafe-collect-remonterrace-multi.log',
    err: '__LOGDIR__/navercafe-collect-remonterrace-multi-error.log',
  },
  'com.soransoran.navercafe-collect-wgang-multi.plist.template': {
    label: 'com.soransoran.navercafe-collect-wgang-multi',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-navercafe.mts',
      '--cafe=wgang', '--pages=1', '--max=10', '--thin', '--live'],
    slots: planSlots('navercafe:wgang', 'start'),
    out: '__LOGDIR__/navercafe-collect-wgang-multi.log',
    err: '__LOGDIR__/navercafe-collect-wgang-multi-error.log',
  },
}

check('🔴 검사표가 템플릿 전부를 덮는다 — 표에 없는 템플릿이 있으면 무검사로 새어나간다',
  files.every((f) => EXPECTED[f] !== undefined) && Object.keys(EXPECTED).length === files.length)

// 🔴 정기 수집이 전문을 남기지 않는지 — 인자 하나가 빠지면 rawBody 전문 파일이 생긴다
for (const cafe of ['remonterrace', 'wgang']) {
  const f = `com.soransoran.navercafe-collect-${cafe}.plist.template`
  if (!files.includes(f)) continue
  check(`🔴 [${cafe}] --thin 이 있다 — 없으면 전문이 디스크에 남는다 (§4-AV ②)`,
    programArguments(readFileSync(join(DIR, f), 'utf-8')).includes('--thin'))
}

// 🔴 확정 수집원 셋. 늘리려면 여기부터 고쳐야 한다
// 🔴 카페는 둘뿐이다. 각각 1회판 + 다회 준비판 = 4개
check('🔴 네이버 카페 템플릿은 remonterrace · wgang 둘뿐이다 (각 1회판 + 다회판)',
  files.filter((f) => f.includes('navercafe')).length === 4
  && files.filter((f) => f.includes('remonterrace')).length === 2
  && files.filter((f) => f.includes('wgang')).length === 2)
// 🔴 **지금 도는 1회판은 건드리지 않았다** — 다회는 별도 Label·별도 로그다
for (const cafe of ['remonterrace', 'wgang'] as const) {
  const one = EXPECTED[`com.soransoran.navercafe-collect-${cafe}.plist.template`]!
  const many = EXPECTED[`com.soransoran.navercafe-collect-${cafe}-multi.plist.template`]!
  check(`🔴 [${cafe}] 1회판은 여전히 1슬롯이다`, one.slots.length === 1)
  check(`🔴 [${cafe}] 다회판이 더 자주 돈다`, many.slots.length > one.slots.length)
  check(`🔴 [${cafe}] Label 이 다르다 — 같은 job 을 덮어쓰지 않는다`, one.label !== many.label)
  check(`🔴 [${cafe}] 로그 파일이 다르다`, one.out !== many.out && one.err !== many.err)
  check(`🔴 [${cafe}] 인자는 같다 — 회차만 늘린다`, one.args.join() === many.args.join())
}
// 🔴 다회판 시각이 계획과 **정확히** 같은가 — 손으로 고치면 여기서 걸린다
for (const id of ['navercafe:remonterrace', 'navercafe:wgang'] as const) {
  const name = `com.soransoran.navercafe-collect-${id.split(':')[1]}-multi.plist.template`
  const want = planSlots(id, 'start').map((s) => `${s.hour}:${s.minute}`).join()
  const got = calendarSlots(readFileSync(join(DIR, name), 'utf-8')).map((s) => `${s.hour}:${s.minute}`).join()
  check(`🔴 [${id}] 다회판 시각이 planSlots(start) 와 같다`, want === got)
  check(`🔴 [${id}] 계획 자체가 성립한다 (간격·부하·겹침)`, verifySchedule(id, 'start').length === 0)
  check(`🔴 [${id}] 안정 단계도 성립한다`, verifySchedule(id, 'stable').length === 0)
}
check('🔴 세 수집원이 같은 시각에 겹치지 않는다',
  verifyNoCrossOverlap('start').length === 0 && verifyNoCrossOverlap('stable').length === 0)
// 🔴 한 소스가 죽어도 나머지는 돈다
for (const down of ['82cook', 'navercafe:remonterrace', 'navercafe:wgang'] as const) {
  const iso = isolationOf([down])
  check(`🔴 [${down}] 가 죽어도 나머지 ${iso.alive.length}개는 돈다`, iso.isolated && iso.aliveDetailPerDay > 0)
}
check('🔴 셋이 다 죽으면 격리가 아니다 — 전면 중단이다',
  !isolationOf(['82cook', 'navercafe:remonterrace', 'navercafe:wgang']).isolated)
for (const gone of ['dlxogns01', 'masanmam', 'goondae', 'yeowooya']) {
  check(`🔴 ${gone} 실행 템플릿이 없다 — 미활성 장래 후보를 스케줄로 두지 않는다`,
    !files.some((f) => f.includes(gone)))
}

for (const f of files) {
  const xml = readFileSync(join(DIR, f), 'utf-8')
  const name = f.replace('.plist.template', '')
  const args = programArguments(xml)
  const isNodeJob = args.some((a) => a.includes('__NPX__') || a.includes('__NODE__'))

  // ── ① PATH ──
  if (isNodeJob) {
    check(`🔴 [${name}] EnvironmentVariables.PATH 가 있다 — 없으면 npx shebang 이 exit 78 이다`,
      pathValue(xml) !== null)
    check(`🔴 [${name}] PATH 형태가 계약과 같다`, pathValue(xml) === PATH_VALUE)
  }

  // ── ② 정확한 값 전수 ──
  const want = EXPECTED[f]
  if (want !== undefined) {
    // 🔴 파일명과 Label 이 같아야 README 명령 하나로 render·lint·load·print 가 같은 것을 가리킨다
    check(`🔴 [${name}] 파일명과 Label 이 같다`, name === want.label)
    check(`🔴 [${name}] Label 이 계약과 같다`, valueOf(xml, 'Label') === want.label)
    if (want.args.length > 0) {
      check(`🔴 [${name}] ProgramArguments 가 통째로 같다 (인자 하나가 달라도 다른 일을 한다)`,
        args.join(' ') === want.args.join(' '))
    }
    const slots = calendarSlots(xml)
    check(`🔴 [${name}] 실행 시각이 통째로 같다 — 슬롯 수만 보면 시각이 틀려도 통과한다`,
      slots.length === want.slots.length
      && slots.every((s2, i) => s2.hour === want.slots[i].hour && s2.minute === want.slots[i].minute))
    check(`🔴 [${name}] stdout 경로가 계약과 같다`, valueOf(xml, 'StandardOutPath') === want.out)
    check(`🔴 [${name}] stderr 경로가 계약과 같다`, valueOf(xml, 'StandardErrorPath') === want.err)
    check(`🔴 [${name}] WorkingDirectory 가 __REPO__ 다`, valueOf(xml, 'WorkingDirectory') === '__REPO__')
    // 🔴 load 하는 순간 도는 것은 의도가 아니다
    check(`🔴 [${name}] RunAtLoad 가 false 다`, /<key>RunAtLoad<\/key>\s*<false\/>/.test(xml))
  }

  // ── ③ 로그가 Documents 밖 ──
  const out = valueOf(xml, 'StandardOutPath') ?? ''
  const err = valueOf(xml, 'StandardErrorPath') ?? ''
  check(`🔴 [${name}] 로그가 __LOGDIR__ 아래다`,
    out.startsWith('__LOGDIR__/') && err.startsWith('__LOGDIR__/'))
  for (const bad of FORBIDDEN_LOG_ROOTS) {
    check(`🔴 [${name}] 로그 경로에 ${bad} 가 없다 — Documents 아래면 TCC 로 막힌다`,
      !out.includes(bad) && !err.includes(bad))
  }
  check(`🔴 [${name}] 로그 경로에 ~ 를 쓰지 않는다 — plist 안에서 확장되지 않는다`,
    !out.includes('~') && !err.includes('~'))

  // ── ④ 렌더링하면 placeholder 가 남지 않는다 ──
  const rendered = render(xml, {
    npx: '/nvm/bin/npx', node: '/nvm/bin/node', repo: '/repo',
    nodebin: '/nvm/bin', logdir: '/Users/x/Library/Logs/soransoran',
  })
  check(`🔴 [${name}] 치환 후 남은 placeholder 가 없다`, leftoverPlaceholders(rendered).length === 0)
  check(`🔴 [${name}] 치환 후 로그가 Documents 밖이다`,
    !/<string>[^<]*\/Documents\/[^<]*\.log<\/string>/.test(rendered))
}

// ── ④-b 카페별 값이 서로 어긋나지 않는다 ──
for (const cafe of ['remonterrace', 'wgang']) {
  const f = `com.soransoran.navercafe-collect-${cafe}.plist.template`
  if (!files.includes(f)) continue
  const xml = readFileSync(join(DIR, f), 'utf-8')
  const args = programArguments(xml)
  check(`🔴 [${cafe}] Label · --cafe · 로그 파일명이 서로 같은 카페를 가리킨다`, (() => (
    (valueOf(xml, 'Label') ?? '').endsWith(cafe)
    && args.includes(`--cafe=${cafe}`)
    && (valueOf(xml, 'StandardOutPath') ?? '').includes(cafe)
    && (valueOf(xml, 'StandardErrorPath') ?? '').includes(cafe)
  ))())
  check(`🔴 [${cafe}] 다른 카페 이름이 섞여 있지 않다`, (() => {
    const other = cafe === 'remonterrace' ? 'wgang' : 'remonterrace'
    return !args.some((a) => a.includes(other))
      && !(valueOf(xml, 'StandardOutPath') ?? '').includes(other)
      && valueOf(xml, 'Label') !== `com.soransoran.navercafe-collect-${other}`
  })())
}
// 🔴 두 카페가 같은 시각에 돌면 한 세션으로 연속해 긁는 꼴이 된다
check('🔴 remonterrace 와 wgang 의 실행 시각이 다르다', (() => {
  const a = calendarSlots(readFileSync(join(DIR, 'com.soransoran.navercafe-collect-remonterrace.plist.template'), 'utf-8'))
  const b = calendarSlots(readFileSync(join(DIR, 'com.soransoran.navercafe-collect-wgang.plist.template'), 'utf-8'))
  return a.length === 1 && b.length === 1 && (a[0].hour !== b[0].hour || a[0].minute !== b[0].minute)
})())

// ── ⑤ 문서가 절차를 담고 있다 ──
{
  const readme = readFileSync(join(DIR, 'README.md'), 'utf-8')
  check('🔴 README 가 NODEBIN 계산을 적어 둔다', /dirname .*which node/.test(readme))
  check('🔴 README 가 LOGDIR 기본값을 적어 둔다', /Library\/Logs\/soransoran/.test(readme))
  check('🔴 README 가 설치 전에 로그 디렉터리를 만든다', /mkdir -p .*LOGDIR/.test(readme))
  check('🔴 README 가 plutil -lint 를 요구한다', /plutil -lint/.test(readme))
  check('🔴 README 가 unload 후 load 로 멱등을 지킨다', /launchctl unload[\s\S]{0,200}launchctl load/.test(readme))
  check('🔴 README 가 launchctl print 확인을 적어 둔다', /launchctl print/.test(readme))
  check('🔴 README 가 exit 78 의 원인을 적어 둔다', /78/.test(readme))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
