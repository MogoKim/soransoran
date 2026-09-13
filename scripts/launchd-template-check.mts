/**
 * launchd 템플릿 검사 (§4-AU ④-b)
 *
 * 🔴 이 검사가 있는 이유는 하나다. **템플릿이 틀리면 조용히 아무 일도 안 일어난다.**
 *
 * 2026-09-07 첫 예약 job 등록에서 실측한 것:
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

/**
 * 🔴 **render·parse 정본은 하나다** (2026-09-11).
 *    배포기(`runtime:deploy`)가 설치할 때 쓰는 바로 그 함수로 검사한다 —
 *    검사와 설치가 다른 파서를 쓰면 "검사는 통과했는데 설치가 다른 것" 이 된다.
 */
import {
  PLACEHOLDERS, calendarSlots, leftoverPlaceholders, programArguments, render, valueOf,
} from './lib/launchd-install.mjs'

import {
  planSlots, verifySchedule, verifyNoCrossOverlap, isolationOf, factsOf,
  MAX_REQUESTS_PER_DAY, RUNS_PER_DAY, SUPPLY_PROCESS_SLOTS,
  THIN_82COOK_RUNS_PER_DAY, THIN_82COOK_SLOTS, requests82cookPerDay, thin82cookCapPerRun,
} from '../src/lib/collect-schedule'

const DIR = 'docs/operations/launchd'

/** 🔴 PATH 는 이 형태여야 한다 — 앞에 node 디렉터리, 뒤에 시스템 기본 */
export { PLACEHOLDERS }

/** 🔴 PATH 는 이 형태여야 한다 */
export const PATH_VALUE = '__NODEBIN__:/usr/bin:/bin:/usr/sbin:/sbin'

/** 🔴 로그는 Documents 밖이어야 한다 */
export const FORBIDDEN_LOG_ROOTS = ['__REPO__/logs', '/Users/', '~/Documents', '$HOME'] as const

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

/** `<key>PATH</key>` 아래 문자열 — dict 안에 있어 valueOf 로도 잡힌다 */
export function pathValue(xml: string): string | null {
  if (!/<key>EnvironmentVariables<\/key>/.test(xml)) return null
  return valueOf(xml, 'PATH')
}

console.log('\n══ launchd 템플릿 검사 ══\n')

const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.plist.template')).sort()
  : []

check('🔴 템플릿이 6개다 — 하나라도 빠지면 검사 밖에 있는 job 이 생긴다', files.length === 6)

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
  'com.soransoran.raw-collect-82cook.plist.template': {
    label: 'com.soransoran.raw-collect-82cook',
    // 🔴 **목록 전용이다** (2026-09-13). `--auto --auto-max=30` 을 뺐다 —
    //    그 30건은 `82cook.jsonl` 로 떨어지고 D100 처리기는 그 파일을 읽지 않는다.
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-collect-82cook.mts',
      '--list', '--pages=3', '--live'],
    slots: [...planSlots('82cook', 'start')],
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
  /**
   * 🔴 **82cook 얇은 상세는 독립 job 이다** (2026-09-11).
   *    옛 `supply-autopilot` 안의 조건부 수집이던 몫을 예약 job 으로 꺼냈다 —
   *    82cook 이 막혀도 네이버 수집·처리가 멈추지 않게 하려면 묶음을 푸는 수밖에 없다.
   *    🔴 `--cap` 숫자는 `collect-schedule` 이 상한에서 역산한다. 여기서 손으로 적지 않는다.
   */
  'com.soransoran.supply-collect-82cook-thin.plist.template': {
    label: 'com.soransoran.supply-collect-82cook-thin',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-82cook-thin-detail.mts',
      `--cap=${thin82cookCapPerRun()}`, '--live'],
    slots: [...THIN_82COOK_SLOTS],
    out: '__LOGDIR__/supply-collect-82cook-thin.log',
    err: '__LOGDIR__/supply-collect-82cook-thin-error.log',
  },
  /**
   * 🔴 **처리기는 수집하지 않는다** (2026-09-11). 이미 생긴 입력만 비운다.
   *    하루 6회다 — 수집이 하루 4~10회 들어오는데 처리가 1회면 입력이 반나절씩 묵는다.
   */
  'com.soransoran.supply-process.plist.template': {
    label: 'com.soransoran.supply-process',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/supply-process.mts', '--live'],
    slots: [...SUPPLY_PROCESS_SLOTS],
    out: '__LOGDIR__/supply-process.log',
    err: '__LOGDIR__/supply-process-error.log',
  },
  /**
   * 🔴 **다회 운영 준비판** (2026-09-08). 등록하지 않았다 —
   *    지금 도는 것은 위의 1회짜리이고, 그 템플릿은 건드리지 않았다.
   *    시각은 `collect-schedule.planSlots(id, 'start')` 가 정한다 (fixture 가 대조).
   */
  'com.soransoran.navercafe-collect-remonterrace-multi.plist.template': {
    label: 'com.soransoran.navercafe-collect-remonterrace-multi',
    /**
     * 🔴 **runner 가 BOARD_TARGETS 를 소비한다** (2026-09-11).
     *    옛 인자 `--pages=1 --max=10` 은 게시판·상세 수를 여기 손으로 적는 방식이었고,
     *    그래서 `BOARD_TARGETS` 의 2~16p 가 한 번도 열리지 않았다.
     *    이제 숫자는 정본(`BOARD_TARGETS`·`collect-schedule`)에만 있고 인자에는 없다.
     */
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-navercafe-run.mts',
      '--cafe=remonterrace', '--phase=start', '--thin', '--live'],
    slots: planSlots('navercafe:remonterrace', 'start'),
    out: '__LOGDIR__/navercafe-collect-remonterrace-multi.log',
    err: '__LOGDIR__/navercafe-collect-remonterrace-multi-error.log',
  },
  'com.soransoran.navercafe-collect-wgang-multi.plist.template': {
    label: 'com.soransoran.navercafe-collect-wgang-multi',
    /**
     * 🔴 **runner 가 BOARD_TARGETS 를 소비한다** (2026-09-11).
     *    옛 인자 `--pages=1 --max=10` 은 게시판·상세 수를 여기 손으로 적는 방식이었고,
     *    그래서 `BOARD_TARGETS` 의 2~16p 가 한 번도 열리지 않았다.
     *    이제 숫자는 정본(`BOARD_TARGETS`·`collect-schedule`)에만 있고 인자에는 없다.
     */
    args: ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-navercafe-run.mts',
      '--cafe=wgang', '--phase=start', '--thin', '--live'],
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
// 🔴 카페는 둘뿐이고, 각각 템플릿 하나씩이다 — 운영 정본인 `-multi` 만 남는다
check('🔴 네이버 카페 템플릿은 remonterrace · wgang 의 -multi 둘뿐이다',
  files.filter((f) => f.includes('navercafe')).length === 2
  && files.filter((f) => f.includes('remonterrace')).length === 1
  && files.filter((f) => f.includes('wgang')).length === 1
  && files.filter((f) => f.includes('navercafe')).every((f) => f.includes('-multi')))
/**
 * 🔴 **지금 도는 것은 다회판이다** (2026-09-11 `launchctl list` 실측: `-multi` 둘만 등록).
 *    🔴 옛 1회판은 job 도 템플릿도 **없다.** 실행 가능한 옛 경로를 남기면 누군가 그것을 load 한다.
 *    `JOB_LABELS[].single` 만 남겨 둔다 — 혹시 올라와 있으면 "1회판이 돌고 있다" 고
 *    **부를 수 있게 하는 이름**이지 실행 경로가 아니다.
 */
for (const cafe of ['remonterrace', 'wgang'] as const) {
  const many = EXPECTED[`com.soransoran.navercafe-collect-${cafe}-multi.plist.template`]!
  // 🔴 회차 수의 정본은 `RUNS_PER_DAY` 다 — 여기 숫자를 다시 적지 않는다
  check(`🔴 [${cafe}] 다회판 회차가 정본과 같다`,
    many.slots.length === RUNS_PER_DAY[`navercafe:${cafe}` as 'navercafe:remonterrace'].start)
  check(`🔴 [${cafe}] 다회판이 운영 경로다 — runner 를 부른다`,
    many.args.some((a) => a.includes('micro-seed-navercafe-run.mts')))
  check(`🔴 [${cafe}] 다회판에 --pages·--max 를 손으로 적지 않는다`,
    !many.args.some((a) => a.startsWith('--pages') || a.startsWith('--max')))
  check(`🔴 [${cafe}] 옛 수집기를 직접 부르는 템플릿이 없다`,
    !Object.values(EXPECTED).some((e) => e.label.includes(`navercafe-collect-${cafe}`)
      && e.args.some((a) => a.includes('micro-seed-collect-navercafe.mts'))))
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
/**
 * 🔴 **82cook 은 두 job 이 같은 서버를 두드린다.** raw 와 thin 이 상한을 나눠 쓴다 —
 *    합이 상한을 넘으면 계획이 성립하지 않는다.
 */
{
  const thin = EXPECTED['com.soransoran.supply-collect-82cook-thin.plist.template']!
  const raw = EXPECTED['com.soransoran.raw-collect-82cook.plist.template']!
  check('🔴 82cook 목록 회차가 5회다', raw.slots.length === 5
    && raw.slots.length === RUNS_PER_DAY['82cook'].start)
  check('🔴 82cook 본문 회차가 5회다', thin.slots.length === 5
    && thin.slots.length === THIN_82COOK_RUNS_PER_DAY)
  check('🔴 82cook 두 job 의 시각이 겹치지 않는다',
    thin.slots.every((t) => !raw.slots.some((r) => r.hour === t.hour && r.minute === t.minute)))
  /**
   * 🔴 **본문은 목록 40분 뒤다.** 목록이 먼저 쌓여야 열 대상이 생긴다 —
   *    같은 분에 두면 빈 목록을 보고 0건으로 끝난다.
   */
  check('🔴 82cook 본문 슬롯이 목록 슬롯의 40분 뒤다',
    thin.slots.every((t, i) => t.hour === raw.slots[i]!.hour && t.minute === raw.slots[i]!.minute + 40))
  /**
   * 🔴 **목록 job 이 본문을 열지 않는다** (2026-09-13).
   *    열면 아래 요청량 계산이 거짓이 된다 — 실제로 거짓이었다(세지 않은 30×5 = 150).
   */
  check('🔴 82cook 목록 job 이 본문을 열지 않는다',
    !raw.args.includes('--auto') && !raw.args.some((a) => a.startsWith('--auto-max')))
  /** 🔴 확정 요청량 — 33×5 + 17×5 = 250 / 상한 400 */
  check('🔴 82cook 하루 요청이 33×5 + 17×5 = 250 이다', (() => {
    const rawPerDay = factsOf('82cook').requestsPerRun * raw.slots.length
    const thinPerDay = thin82cookCapPerRun() * thin.slots.length
    return rawPerDay === 165 && thinPerDay === 85
      && requests82cookPerDay() === 250 && 250 <= MAX_REQUESTS_PER_DAY['82cook']
  })())
}

/**
 * 🔴 **확정 운영 일정** (2026-09-11) — 노트북을 켜 두는 07:00~22:30 안에 둔다.
 *    돌지 않는 슬롯은 능력이 아니다. 새벽 슬롯을 두면 예약만 있고 회차는 없다.
 */
{
  const want: Record<string, string> = {
    'com.soransoran.raw-collect-82cook.plist.template': '07:00 10:00 13:00 16:00 19:00',
    'com.soransoran.supply-collect-82cook-thin.plist.template': '07:40 10:40 13:40 16:40 19:40',
    'com.soransoran.navercafe-collect-remonterrace-multi.plist.template': '07:30 10:30 13:30 16:30 21:30',
    'com.soransoran.navercafe-collect-wgang-multi.plist.template': '09:30 11:30 15:30 20:30',
    'com.soransoran.supply-process.plist.template': '08:15 12:15 14:15 17:15 21:15 22:15',
  }
  const fmt = (a: readonly { hour: number; minute: number }[]): string =>
    a.map((s2) => `${String(s2.hour).padStart(2, '0')}:${String(s2.minute).padStart(2, '0')}`).join(' ')
  for (const [f, times] of Object.entries(want)) {
    // 🔴 **render 한 실제 plist** 에서 읽는다 — 검사표가 아니라 설치될 파일을 본다
    const got = fmt(calendarSlots(readFileSync(join(DIR, f), 'utf-8')))
    check(`🔴 [${f.replace('com.soransoran.', '').replace('.plist.template', '')}] 시각이 확정 일정과 같다 (KST)`,
      got === times)
    // 🔴 같은 job 안에 같은 시각이 두 번 있으면 안 된다
    const arr = calendarSlots(readFileSync(join(DIR, f), 'utf-8')).map((s2) => s2.hour * 60 + s2.minute)
    check(`🔴 [${f.replace('com.soransoran.', '').replace('.plist.template', '')}] 중복 시각이 없다`,
      new Set(arr).size === arr.length)
  }
  /** 🔴 노트북이 꺼져 있는 시간에 슬롯을 두지 않는다 */
  for (const [f] of Object.entries(want)) {
    const hs = calendarSlots(readFileSync(join(DIR, f), 'utf-8')).map((s2) => s2.hour)
    check(`🔴 [${f.replace('com.soransoran.', '').replace('.plist.template', '')}] 전부 07~22시 안이다`,
      hs.every((h) => h >= 7 && h <= 22))
  }
}
/**
 * 🔴 **수집 job 과 처리 job 이 서로를 부르지 않는다** (2026-09-11).
 *    한쪽이 다른 쪽을 소유하면 옛 `supply-autopilot` 로 되돌아간 것이다 —
 *    그때는 82cook 하나가 막혀도 네이버 공급까지 멈췄다.
 */
{
  const proc = EXPECTED['com.soransoran.supply-process.plist.template']!
  check('🔴 처리 job 이 수집기를 부르지 않는다',
    !proc.args.some((a) => /collect|navercafe-run|thin-detail/.test(a)))
  for (const [f, e] of Object.entries(EXPECTED)) {
    if (!f.includes('collect')) continue
    check(`🔴 [${e.label}] 수집 job 이 처리기를 부르지 않는다`,
      !e.args.some((a) => a.includes('supply-process')))
  }
  check('🔴 옛 autopilot 템플릿이 없다',
    !existsSync(join(DIR, 'com.soransoran.supply-autopilot.plist.template')))
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
/**
 * 🔴 두 카페가 같은 시각에 돌면 한 세션으로 연속해 긁는 꼴이 되고, 차단은 그 모양을 본다.
 *    🔴 **운영 정본인 `-multi` 로 본다.** 옛 1회판(09:20 · 13:20)은 job 도 템플릿도 없다.
 */
check('🔴 remonterrace 와 wgang 의 실행 시각이 겹치지 않는다', (() => {
  const slots = (cafe: string): { hour: number; minute: number }[] => calendarSlots(
    readFileSync(join(DIR, `com.soransoran.navercafe-collect-${cafe}-multi.plist.template`), 'utf-8'))
  const a = slots('remonterrace')
  const b = slots('wgang')
  const key = (x: { hour: number; minute: number }): string => `${x.hour}:${x.minute}`
  // 🔴 회차 수는 카페마다 다르다(remonterrace 5 · wgang 4) — 겹침만 본다
  return a.length > 0 && b.length > 0
    && a.every((x) => !b.some((y) => key(x) === key(y)))
})())
// 🔴 실행 가능한 옛 1회판 템플릿을 저장소에 남기지 않는다 — 남으면 누군가 load 한다
for (const cafe of ['remonterrace', 'wgang'] as const) {
  check(`🔴 [${cafe}] 옛 1회판 템플릿이 없다`,
    !existsSync(join(DIR, `com.soransoran.navercafe-collect-${cafe}.plist.template`)))
}

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
