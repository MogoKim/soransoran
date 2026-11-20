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

import { SUPPLY_PROCESS_SLOTS } from '../src/lib/collect-schedule'
import { COLLECT_JOB_LABEL, COLLECT_SLOTS } from '../src/lib/collect-sources'
import { CYCLE_MINUTES } from '../src/lib/cycle-schedule'
import { RETIRED_JOBS } from '../src/lib/runtime-isolation'
import { COLLECT_ARGS, COLLECT_LOG_NAME, COLLECT_TEMPLATE_PATH, renderCollectTemplate } from './lib/navercafe-collect-template.mjs'
import {
  AUDIT_RUNNER_LABEL, AUDIT_RUNNER_SCRIPT, auditRunnerSlots, renderAuditRunnerPlist, verifyAuditSlots,
} from './lib/auto-ready-audit-template'
import {
  COMMENT_RUNNER_ARGS, COMMENT_RUNNER_LABEL, COMMENT_RUNNER_SCRIPT, COMMENT_RUNNER_SLOTS, FIRST_COMMENT_MAX_MINUTES,
  renderCommentRunnerPlist,
} from './lib/persona-comment-runner-template'

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

/**
 * 🔴 **등록될 job 의 전부**를 적는다. 슬롯 개수만 세면 시각이 틀려도 통과한다.
 *    수집 job 은 하나다 — 바퀴마다 원천 목록(`collect-sources`)을 차례로 돈다.
 */
const EXPECTED: Record<string, {
  label: string
  args: string[]
  slots: { hour: number; minute: number }[]
  out: string
  err: string
}> = {
  /**
   * 🔴 **처리기는 수집하지 않는다** (2026-09-11). 이미 생긴 입력만 비운다.
   *    하루 7회다 — 06:15는 07:00 controller 전 복구, 나머지는 수집 뒤 drain이다.
   */
  'com.soransoran.supply-process.plist.template': {
    label: 'com.soransoran.supply-process',
    args: ['__NPX__', 'tsx', '__REPO__/scripts/stage-consume-exec.mts', '--by=supply', '--',
      '__NPX__', 'tsx', '__REPO__/scripts/supply-process.mts', '--live'],
    slots: [...SUPPLY_PROCESS_SLOTS],
    out: '__LOGDIR__/supply-process.log',
    err: '__LOGDIR__/supply-process-error.log',
  },
  [`${COLLECT_JOB_LABEL}.plist.template`]: {
    label: COLLECT_JOB_LABEL,
    args: [...COLLECT_ARGS],
    slots: [...COLLECT_SLOTS],
    out: `__LOGDIR__/${COLLECT_LOG_NAME}.log`,
    err: `__LOGDIR__/${COLLECT_LOG_NAME}-error.log`,
  },
}

check('🔴 검사표가 템플릿 전부를 덮는다 — 표에 없는 템플릿이 있으면 무검사로 새어나간다',
  files.every((f) => EXPECTED[f] !== undefined) && Object.keys(EXPECTED).length === files.length)

/**
 * 🔴 **수집 job 템플릿은 생성된다** — 바퀴 시각을 손으로 13개 적지 않는다.
 *    파일이 생성 결과와 다르면 누군가 손으로 고친 것이다(`npm run launchd:collect-template -- --write`).
 */
{
  const xml = existsSync(COLLECT_TEMPLATE_PATH) ? readFileSync(COLLECT_TEMPLATE_PATH, 'utf-8') : ''
  check('🔴 [navercafe-collect] 템플릿이 생성 결과와 글자까지 같다', xml === renderCollectTemplate())
  const got = calendarSlots(xml).map((x) => x.hour * 60 + x.minute)
  check('🔴 [navercafe-collect] 예약 시각이 바퀴 표(CYCLE_MINUTES)와 같다',
    got.length === CYCLE_MINUTES.length && got.every((m, i) => m === CYCLE_MINUTES[i]))
  check('🔴 [navercafe-collect] 원천을 차례로 도는 runner 를 부른다 — 카페 · 쪽 · 상한을 인자로 적지 않는다',
    programArguments(xml).some((a) => a.endsWith('/scripts/micro-seed-navercafe-run.mts'))
    && !programArguments(xml).some((a) => /^--(cafe|source|pages|max|board)/.test(a)))
  // 🔴 퇴역한 job 의 템플릿이 남으면 누군가 그것을 load 한다 — 같은 카페를 두 번 연다
  for (const l of RETIRED_JOBS) {
    check(`🔴 퇴역 job 템플릿이 없다 — ${l}`, !files.includes(`${l}.plist.template`))
  }
  check('🔴 수집 job 템플릿은 하나다', files.filter((f) => f.includes('collect')).length === 1)
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

// ── ④-c 🔴 자동 READY 독립 감사 러너 — 코드가 렌더한다(파일 템플릿 아님 · 설치하지 않는다) ──
{
  const xml = renderAuditRunnerPlist({
    runtimeRoot: '/Users/x/Documents/soransoran-runtime', npxPath: '/nvm/bin/npx',
    logDir: '/Users/x/Library/Logs/soransoran', nodeBinDir: '/nvm/bin',
  })
  const want = auditRunnerSlots()
  const got = calendarSlots(xml)
  check('🔴 [auto-ready-audit] 예약 시각이 있다 — 비면 감사가 영원히 돌지 않는다', got.length > 0 && verifyAuditSlots(got).length === 0)
  check('🔴 [auto-ready-audit] 렌더한 예약 시각이 슬롯 정본과 통째로 같다',
    got.length === want.length && got.every((x, i) => x.hour === want[i]!.hour && x.minute === want[i]!.minute))
  check('🔴 [auto-ready-audit] Label 이 정본이다', valueOf(xml, 'Label') === AUDIT_RUNNER_LABEL)
  const args = programArguments(xml)
  check('🔴 [auto-ready-audit] 감사 러너를 --apply 로 부른다', args.some((a2) => a2.endsWith(`/${AUDIT_RUNNER_SCRIPT}`)) && args.includes('--apply'))
  check('🔴 [auto-ready-audit] PATH 앞에 node 디렉터리', pathValue(xml) === '/nvm/bin:/usr/bin:/bin:/usr/sbin:/sbin')
  check('🔴 [auto-ready-audit] 로그가 Documents 밖이다', !/<string>[^<]*\/Documents\/[^<]*\.log<\/string>/.test(xml))
  check('🔴 [auto-ready-audit] RunAtLoad 가 false 다', /<key>RunAtLoad<\/key><false\/>/.test(xml))
  check('🔴 [auto-ready-audit] 남은 placeholder 가 없다', leftoverPlaceholders(xml).length === 0)
}

// ── ④-d 🔴 무인 Persona 댓글 루프 — 코드가 렌더한다(파일 템플릿 아님 · 설치하지 않는다) (2026-09-28) ──
{
  const xml = renderCommentRunnerPlist({
    runtimeRoot: '/Users/x/Documents/soransoran-runtime', npxPath: '/nvm/bin/npx',
    logDir: '/Users/x/Library/Logs/soransoran', nodeBinDir: '/nvm/bin',
  })
  const got = calendarSlots(xml)
  check('🔴 [comment-loop] 렌더한 예약 시각이 슬롯 정본과 통째로 같다',
    got.length > 0 && got.length === COMMENT_RUNNER_SLOTS.length
    && got.every((x, i) => x.hour === COMMENT_RUNNER_SLOTS[i]!.hour && x.minute === COMMENT_RUNNER_SLOTS[i]!.minute))
  const mins = got.map((x) => x.hour * 60 + x.minute)
  check(`🔴 [comment-loop] 회차 간격이 첫 댓글 시한(${FIRST_COMMENT_MAX_MINUTES}분) 안이다`,
    mins.length > 1 && mins.slice(1).every((m, i) => m - mins[i]! <= FIRST_COMMENT_MAX_MINUTES))
  check('🔴 [comment-loop] Label 이 정본이다', valueOf(xml, 'Label') === COMMENT_RUNNER_LABEL)
  const args = programArguments(xml)
  check('🔴 [comment-loop] 무인 루프를 --live 로 부른다',
    args.some((a2) => a2.endsWith(`/${COMMENT_RUNNER_SCRIPT}`)) && COMMENT_RUNNER_ARGS.every((a2) => args.includes(a2)) && args.includes('--live'))
  check('🔴 [comment-loop] PATH 앞에 node 디렉터리', pathValue(xml) === '/nvm/bin:/usr/bin:/bin:/usr/sbin:/sbin')
  check('🔴 [comment-loop] 로그가 Documents 밖이다', !/<string>[^<]*\/Documents\/[^<]*\.log<\/string>/.test(xml))
  check('🔴 [comment-loop] RunAtLoad 가 false 다', /<key>RunAtLoad<\/key><false\/>/.test(xml))
  check('🔴 [comment-loop] 남은 placeholder 가 없다', leftoverPlaceholders(xml).length === 0)
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
