#!/usr/bin/env tsx
/**
 * 상시 실행 호스트 이전 묶음 **검사** — 🔴 운영 홈 0 · launchctl 0 · 네트워크 0 · DB 0
 *
 *   ① 운영 디렉터리 분류 — 모르는 항목은 옮기지 않는다 · 잠금은 빼고 heartbeat 틱 표식은 싣는다
 *   ② env — 비밀 값(비밀번호 조각 포함) · 홈 경로 키 · 홈만 바꿔 쓰기
 *   ③ 가림·누출 검사 — 비밀 값이 화면·파일에 있으면 잡는다
 *   ④ 묶음 위치 — git 작업트리·운영 경로 안 거부
 *   ⑤ plist 템플릿화 → 다른 홈·사용자로 다시 찍기 — 원 홈 경로 0 · placeholder 0
 *   ⑥ manifest 판정 — 해시·누락·끼워 넣기·권한
 *   ⑦ 두 호스트 가드 — cutover 조건 · rehearsal 거부 · 원 호스트 되살리기
 *   ⑧ 설치 실패 → 되돌리기 (가짜 effect)
 *   ⑨ CLI 끝에서 끝까지 — 가짜 홈에서 plan · export · verify · install dry-run · 변조 · 누출
 *
 *   npm run host:migrate-check
 */
import { execFileSync } from 'node:child_process'
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BUNDLE_MANIFEST, classifyCanonEntry, foreignHomePaths, homePathKeys, isTransientFile, judgeBundleOut,
  judgeCutoverExport, judgeManifest, judgeTargetInstall, judgeUnquiesce, nodeBinsIn, parseLaunchctlList,
  busyLabels, redact, renderAndJudge, rewriteEnvHome, runInstall, scanForSecrets, secretValuesOf,
  templatizePlist, type BundleManifest, type InstallEffects,
} from './lib/host-migrate.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 상시 실행 호스트 이전 묶음 검사 (🔴 운영 홈 0 · launchctl 0 · 네트워크 0) ══\n')

// 🔴 가짜 비밀 — 이 문자열이 어떤 출력에도 나오면 실패다
const PASS = 'ZZsentinelPASSzz9'
const GKEY = 'AIzaZZSENTINELKEYZZ0123456789abcdefghij'
const HOOK = 'https://hooks.slack.com/services/TZZSENT00/BZZSENT00/ZZsentinelWEBHOOKzz'
const COOKIE = 'ZZsentinelCOOKIEzz'
const SENTINELS = [PASS, GKEY, HOOK, COOKIE, 'ZZSENTINELKEYZZ', 'ZZsentinelWEBHOOKzz']
const leaked = (text: string): string[] => SENTINELS.filter((s) => text.includes(s))

// ─────────────────────────────────────────────────────────
console.log('① 운영 디렉터리 분류')
// ─────────────────────────────────────────────────────────
check('env.local 은 secret', classifyCanonEntry('env.local').kind === 'secret')
check('naver-session 은 secret', classifyCanonEntry('naver-session').kind === 'secret')
check('🔴 옛 env 사본은 싣지 않는다', classifyCanonEntry('env.local.bak-20260928').kind === 'exclude')
check('🔴 배포 잠금은 싣지 않는다', classifyCanonEntry('runtime-deploy.lock').kind === 'exclude')
check('🔴 모르는 항목은 unclassified (export 거부)', classifyCanonEntry('brand-new-thing').kind === 'unclassified')
check('매거진 레인 상태는 state', classifyCanonEntry('magazine-quarantine.json').kind === 'state')
check('🔴 매거진 임대(잠금)는 싣지 않는다', classifyCanonEntry('magazine-manuscript-leases').kind === 'exclude')
check('🔴 쥔 잠금 파일은 뺀다', isTransientFile('audit.lock', 'auto-ready-audit'))
check('heartbeat 지난 틱 표식은 싣는다', !isTransientFile('tick-2026-09-28T08-00.lock', 'publish-heartbeat'))
check('🔴 heartbeat 디렉터리라도 틱 이름이 아니면 뺀다', isTransientFile('other.lock', 'publish-heartbeat'))

// ─────────────────────────────────────────────────────────
console.log('\n② env')
// ─────────────────────────────────────────────────────────
const SRC_HOME = '/Users/alice'
const envText = [
  '# 주석은 그대로',
  `DATABASE_URL="postgresql://u:${PASS}@db.invalid:6543/postgres"`,
  `GEMINI_API_KEY=${GKEY}`,
  `SORAN_NAVERCAFE_SESSION_PATH=${SRC_HOME}/Library/Application Support/soransoran/naver-session/state.json`,
  'SORAN_SUPPLY_PROCESS_ENABLED=true',
  'SHORT_KEY=abc',
].join('\n')
const secrets = secretValuesOf(envText)
check('비밀 키 이름으로 고른다', secrets.some((s) => s.key === 'GEMINI_API_KEY') && secrets.some((s) => s.key === 'DATABASE_URL'))
check('🔴 DB 비밀번호 조각도 따로 가린다', secrets.some((s) => s.value === PASS))
check('스위치 값은 비밀로 보지 않는다', !secrets.some((s) => s.key === 'SORAN_SUPPLY_PROCESS_ENABLED'))
check('홈 경로 키를 이름으로 찾는다', JSON.stringify(homePathKeys(envText, SRC_HOME)) === '["SORAN_NAVERCAFE_SESSION_PATH"]')
const rewritten = rewriteEnvHome(envText, SRC_HOME, '/Users/bob')
check('홈 경로만 바뀐다', rewritten.includes('SORAN_NAVERCAFE_SESSION_PATH=/Users/bob/Library/') && !rewritten.includes(SRC_HOME))
check('다른 줄은 바이트 그대로', rewritten.split('\n').filter((l) => !l.startsWith('SORAN_NAVERCAFE')).join('\n')
  === envText.split('\n').filter((l) => !l.startsWith('SORAN_NAVERCAFE')).join('\n'))
check('따옴표를 지킨다', rewriteEnvHome(`X_PATH="${SRC_HOME}/a"`, SRC_HOME, '/Users/bob') === 'X_PATH="/Users/bob/a"')

// ─────────────────────────────────────────────────────────
console.log('\n③ 가림 · 누출 검사')
// ─────────────────────────────────────────────────────────
const red = redact(`연결 postgresql://u:${PASS}@db.invalid:6543/postgres 키 ${GKEY} 훅 ${HOOK}`, secrets)
check('🔴 가림 뒤 비밀 0', leaked(red).length === 0, leaked(red).join(','))
check('🔴 env 에 없는 비밀 모양도 가린다(Slack 훅)', !redact(HOOK, []).includes('ZZsentinelWEBHOOKzz'))
const hits = scanForSecrets('logs/x.log', `오류: ${PASS} 로 접속 실패`, secrets)
check('🔴 로그에 비밀번호 조각 → 누출로 잡는다', hits.length > 0)
check('🔴 누출 보고에는 값이 없다', leaked(JSON.stringify(hits)).length === 0)
check('깨끗한 텍스트는 통과', scanForSecrets('a', '평범한 로그 줄', secrets).length === 0)

// ─────────────────────────────────────────────────────────
console.log('\n④ 묶음 위치')
// ─────────────────────────────────────────────────────────
const base = { forbiddenRoots: ['/Users/alice/Library/Application Support/soransoran'], exists: false, empty: true }
check('🔴 git 작업트리 안 → 거부', !judgeBundleOut({ ...base, outAbs: '/Users/alice/Documents/soransoran/out', gitAncestor: '/Users/alice/Documents/soransoran' }).ok)
check('🔴 운영 디렉터리 안 → 거부', !judgeBundleOut({ ...base, outAbs: '/Users/alice/Library/Application Support/soransoran/b', gitAncestor: null }).ok)
check('🔴 비어 있지 않은 디렉터리 → 거부', !judgeBundleOut({ ...base, outAbs: '/private/tmp/x', gitAncestor: null, exists: true, empty: false }).ok)
check('🔴 상대경로 → 거부', !judgeBundleOut({ ...base, outAbs: 'out', gitAncestor: null }).ok)
check('/private/tmp 새 디렉터리 → 허용', judgeBundleOut({ ...base, outAbs: '/private/tmp/soran-bundle', gitAncestor: null }).ok)

// ─────────────────────────────────────────────────────────
console.log('\n⑤ plist 다시 찍기')
// ─────────────────────────────────────────────────────────
const NB = `${SRC_HOME}/.nvm/versions/node/v24.14.0/bin`
const srcPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key><string>com.soransoran.magazine-watch</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NB}/npx</string>
        <string>tsx</string>
        <string>${SRC_HOME}/Documents/soransoran-runtime/scripts/supply-process.mts</string>
        <string>${SRC_HOME}/Documents/soransoran-magazine-runtime/scripts/magazine-auto-merge.mjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${SRC_HOME}/.local/bin:${NB}:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>${SRC_HOME}</string>
    </dict>
    <key>WorkingDirectory</key><string>${SRC_HOME}/Documents/soransoran-runtime</string>
    <key>StandardOutPath</key><string>${SRC_HOME}/Library/Logs/soransoran/x.log</string>
    <!-- 설치 경로 예: /Users/…/Documents/soransoran/launchd -->
</dict>
</plist>
`
check('🔴 PATH 의 앞 조각을 node 경로로 붙여 읽지 않는다', JSON.stringify(nodeBinsIn(srcPlist)) === JSON.stringify([NB]))
const tpl = templatizePlist(srcPlist, { home: SRC_HOME, nodeBin: NB })
check('템플릿에 원 홈 경로 0', foreignHomePaths(tpl, '__HOME__').length === 0, foreignHomePaths(tpl, '__HOME__').join(' '))
check('🔴 runtime 경로는 __HOME__ 조각이 아니라 __REPO__ 로', tpl.includes('__REPO__/scripts/supply-process.mts') && tpl.includes('__MAGAZINE_REPO__/scripts/'))
const TGT = { home: '/Users/bob', nodeBin: '/Users/bob/.nvm/versions/node/v24.9.0/bin' }
const r = renderAndJudge('com.soransoran.magazine-watch', tpl, TGT)
check('🔴 다른 사용자·홈으로 찍으면 /Users/alice 0', !r.xml.includes('/Users/alice'))
check('치환 문제 0', r.problems.length === 0, r.problems.join(' · '))
check('대상 runtime · 매거진 runtime · 로그 · node 경로', r.xml.includes('/Users/bob/Documents/soransoran-runtime/scripts/supply-process.mts')
  && r.xml.includes('/Users/bob/Documents/soransoran-magazine-runtime/') && r.xml.includes('/Users/bob/Library/Logs/soransoran/x.log')
  && r.xml.includes('<string>/Users/bob/.nvm/versions/node/v24.9.0/bin/npx</string>'))
check('PATH 의 시스템 조각은 그대로', r.xml.includes('/Users/bob/.local/bin:/Users/bob/.nvm/versions/node/v24.9.0/bin:/opt/homebrew/bin:/usr/bin:/bin'))
const nonUsers = renderAndJudge('com.soransoran.magazine-watch', tpl, { home: '/private/tmp/fake-home', nodeBin: '/private/tmp/fake-home/n/bin' })
check('🔴 /Users 밖 홈으로도 /Users/<누구> 0', foreignHomePaths(nonUsers.xml, '/private/tmp/fake-home').length === 0 && nonUsers.problems.length === 0)
// 🔴 반례: 템플릿화를 건너뛰면 판정이 원 홈을 잡는다
const raw = renderAndJudge('com.soransoran.magazine-watch', srcPlist, TGT)
check('🔴 반례 — 템플릿화 안 한 plist 는 원 홈 경로로 실패', raw.problems.some((p) => p.includes('/Users/alice')))
check('🔴 반례 — Label 다르면 실패', renderAndJudge('com.soransoran.other', tpl, TGT).problems.length > 0)
check('🔴 반례 — 모르는 placeholder 가 남으면 실패', renderAndJudge('com.soransoran.magazine-watch', tpl.replace('tsx', '__NEW__'), TGT).problems.length > 0)

// ─────────────────────────────────────────────────────────
console.log('\n⑥ manifest 판정')
// ─────────────────────────────────────────────────────────
const man = (entries: BundleManifest['entries']): BundleManifest => ({
  formatVersion: 1, bundleId: 'b', mode: 'rehearsal', createdAt: '', envKeys: [], envHomePathKeys: [], plists: [], excluded: [], quiesce: null,
  source: { home: SRC_HOME, user: 'alice', macos: null, arch: 'arm64', nodeBin: NB, nodeVersion: 'v24.14.0' },
  runtime: { pinnedSha: null, magazineSha: null }, entries,
})
const E = [
  { path: 'state/a', sha256: 'aa', size: 1, mode: '644', kind: 'state' as const },
  { path: 'state/env.local', sha256: 'ee', size: 2, mode: '600', kind: 'secret' as const },
]
const good = new Map([['state/a', { sha256: 'aa', size: 1, mode: 0o100644 }], ['state/env.local', { sha256: 'ee', size: 2, mode: 0o100600 }]])
check('정상 → 문제 0', judgeManifest({ manifest: man(E), actual: good }).length === 0)
check('🔴 해시 다름 → HASH', judgeManifest({ manifest: man(E), actual: new Map([...good, ['state/a', { sha256: 'ab', size: 1, mode: 0o100644 }]]) }).some((p) => p.code === 'HASH'))
check('🔴 없음 → MISSING', judgeManifest({ manifest: man(E), actual: new Map([['state/env.local', good.get('state/env.local')!]]) }).some((p) => p.code === 'MISSING'))
check('🔴 끼워 넣음 → EXTRA', judgeManifest({ manifest: man(E), actual: new Map([...good, ['state/x', { sha256: 'x', size: 1, mode: 0o100644 }]]) }).some((p) => p.code === 'EXTRA'))
check('🔴 비밀 0644 → PERM', judgeManifest({ manifest: man(E), actual: new Map([...good, ['state/env.local', { sha256: 'ee', size: 2, mode: 0o100644 }]]) }).some((p) => p.code === 'PERM'))

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 두 호스트 가드')
// ─────────────────────────────────────────────────────────
const cut = { loadedLabels: [] as string[], installedPlists: [] as string[], handoffPresent: true, handoffBundleId: null }
check('원 호스트 완전히 내려감 → cutover 허용', judgeCutoverExport(cut).ok)
check('🔴 loaded job 남음 → 거부', !judgeCutoverExport({ ...cut, loadedLabels: ['com.soransoran.supply-process'] }).ok)
check('🔴 plist 파일 남음(재부팅 때 부활) → 거부', !judgeCutoverExport({ ...cut, installedPlists: ['com.soransoran.keep-awake.plist'] }).ok)
check('🔴 launchctl 못 읽음 → 거부', !judgeCutoverExport({ ...cut, loadedLabels: null }).ok)
check('🔴 handoff 없음 → 거부', !judgeCutoverExport({ ...cut, handoffPresent: false }).ok)
check('🔴 두 번째 cutover 묶음 → 거부', !judgeCutoverExport({ ...cut, handoffBundleId: 'x' }).ok)
const ti = {
  bundleMode: 'cutover' as const, verifyProblems: 0, targetPlists: [] as string[], targetLoaded: [] as string[],
  targetCanonNonEmpty: false, targetRuntimeExists: false, runningHome: '/Users/bob', targetHome: '/Users/bob', preflightFailures: 0,
}
check('cutover 묶음 · 빈 대상 → 설치 허용', judgeTargetInstall(ti).ok)
check('🔴 rehearsal 묶음 → 설치 거부', !judgeTargetInstall({ ...ti, bundleMode: 'rehearsal' }).ok)
check('🔴 대상에 이미 plist → 거부', !judgeTargetInstall({ ...ti, targetPlists: ['com.soransoran.x.plist'] }).ok)
check('🔴 대상에 이미 loaded → 거부', !judgeTargetInstall({ ...ti, targetLoaded: ['com.soransoran.x'] }).ok)
check('🔴 대상 launchctl 못 읽음 → 거부', !judgeTargetInstall({ ...ti, targetLoaded: null }).ok)
check('🔴 다른 사용자 셸 → 거부', !judgeTargetInstall({ ...ti, runningHome: '/Users/alice' }).ok)
check('🔴 verify 실패 → 거부', !judgeTargetInstall({ ...ti, verifyProblems: 1 }).ok)
check('🔴 사전 점검 미충족 → 거부', !judgeTargetInstall({ ...ti, preflightFailures: 1 }).ok)
check('🔴 원 호스트 되살리기 — bundleId 없이 거부', !judgeUnquiesce({ handoffBundleId: 'b1', givenBundleId: null }).ok)
check('원 호스트 되살리기 — 맞는 bundleId 면 허용', judgeUnquiesce({ handoffBundleId: 'b1', givenBundleId: 'b1' }).ok)
check('export 전 되살리기 — 허용', judgeUnquiesce({ handoffBundleId: null, givenBundleId: null }).ok)
const rows = parseLaunchctlList('PID\tStatus\tLabel\n55182\t0\tcom.soransoran.keep-awake\n-\t0\tcom.soransoran.supply-process\n901\t0\tcom.soransoran.original-post-runner\n12\t0\tcom.apple.x\n')
check('launchctl list — 우리 label 만', rows.length === 3)
check('🔴 실행 중 회차 — keep-awake 만 예외', JSON.stringify(busyLabels(rows)) === '["com.soransoran.original-post-runner"]')

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 설치 실패 → 되돌리기')
// ─────────────────────────────────────────────────────────
const trace: string[] = []
const fx = (over: Partial<InstallEffects>): InstallEffects => ({
  cloneRepo: () => { trace.push('clone'); return true },
  addRuntime: () => { trace.push('runtime'); return true },
  addMagazineRuntime: () => { trace.push('mag'); return true },
  installDeps: () => { trace.push('deps'); return true },
  restoreState: () => { trace.push('state'); return true },
  writeEnv: () => { trace.push('env'); return true },
  writePlist: (l) => { trace.push(`write:${l}`); return true },
  lintPlist: () => true,
  bootstrap: (l) => { trace.push(`boot:${l}`); return true },
  isolationCheck: () => { trace.push('iso'); return true },
  writeOwner: () => { trace.push('owner'); return true },
  bootout: (l) => { trace.push(`bootout:${l}`); return true },
  retirePlist: (l) => { trace.push(`retire:${l}`); return true },
  removeOwner: () => { trace.push('unowner'); return true },
  log: () => undefined,
  ...over,
})
const plists = ['a', 'b', 'c'].map((l) => ({ label: l, xml: '', problems: [] as string[] }))
const okRun = runInstall({ pinnedSha: 's', magazineSha: null, plists, loadLabels: ['a', 'b', 'c'] }, fx({}))
check('정상 설치 완료', okRun.ok)
check('🔴 소유 표식은 job 을 올리기 전에', trace.indexOf('owner') < trace.indexOf('boot:a'))
check('매거진 SHA 없으면 매거진 runtime 을 만들지 않는다', !trace.includes('mag'))
trace.length = 0
const bad = runInstall({ pinnedSha: 's', magazineSha: 'm', plists, loadLabels: ['a', 'b', 'c'] },
  fx({ bootstrap: (l) => { trace.push(`boot:${l}`); return l !== 'b' } }))
check('🔴 두 번째 bootstrap 실패 → 설치 실패', !bad.ok && bad.phase === 'bootstrap b')
check('🔴 올린 job 만 내린다(a)', trace.includes('bootout:a') && !trace.includes('bootout:c'))
check('🔴 쓴 plist 전부 치운다', ['a', 'b', 'c'].every((l) => trace.includes(`retire:${l}`)))
check('🔴 내리기가 치우기보다 먼저', trace.indexOf('bootout:a') < trace.indexOf('retire:a'))
check('🔴 소유 표식 삭제 · 되돌림 완료', trace.includes('unowner') && bad.rollback?.complete === true)
trace.length = 0
const partial = runInstall({ pinnedSha: 's', magazineSha: null, plists, loadLabels: ['a'] },
  fx({ isolationCheck: () => false, bootout: () => false }))
check('🔴 되돌리다 실패해도 나머지를 계속하고 남은 것을 적는다', partial.rollback?.complete === false
  && partial.rollback.residual.some((x) => x.includes('bootout')) && trace.includes('retire:c'))
trace.length = 0
const renderBad = runInstall({ pinnedSha: 's', magazineSha: null, plists: [{ label: 'a', xml: '', problems: ['x'] }], loadLabels: [] }, fx({}))
check('🔴 render 문제가 있으면 clone 도 하지 않는다', !renderBad.ok && trace.length === 0)

// ─────────────────────────────────────────────────────────
console.log('\n⑨ CLI 끝에서 끝까지 (가짜 홈 · launchctl 0 · 네트워크 0)')
// ─────────────────────────────────────────────────────────
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'host-migrate-check-')))
const H = join(sandbox, 'home-alice')
const canon = join(H, 'Library/Application Support/soransoran')
const nb = join(H, '.nvm/versions/node/v24.14.0/bin')
const w = (p: string, text: string, mode = 0o644): void => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text, { mode }) }
w(join(canon, 'env.local'), [
  `DATABASE_URL=postgresql://u:${PASS}@db.invalid:6543/postgres`,
  `GEMINI_API_KEY=${GKEY}`,
  `SORAN_NAVERCAFE_SESSION_PATH=${canon}/naver-session/state.json`,
  'SORAN_SUPPLY_PROCESS_ENABLED=true',
].join('\n'), 0o600)
w(join(canon, 'naver-session/state.json'), JSON.stringify({ cookies: [{ value: COOKIE }] }), 0o600)
w(join(canon, 'llm-ledger/2026-09-28.jsonl'), '{"usd":0.01}\n')
w(join(canon, 'publish-heartbeat/tick-2026-09-28T08-00.lock'), '')
w(join(canon, 'auto-ready-audit/audit.lock'), 'held')
w(join(canon, 'runtime-pinned-sha'), 'a'.repeat(40))
w(join(canon, 'env.local.bak-1'), `GEMINI_API_KEY=${GKEY}`, 0o600)
w(join(H, '.config/soransoran/slack.env'), `SLACK_WEBHOOK_URL=${HOOK}`, 0o600)
w(join(H, 'Library/Logs/soransoran/supply-process.log'), '회차 끝\n')
w(join(H, 'Library/LaunchAgents/com.soransoran.supply-process.plist'), srcPlist
  .replaceAll(NB, nb).replaceAll(SRC_HOME, H).replace('com.soransoran.magazine-watch', 'com.soransoran.supply-process'))

type Run = { code: number; out: string }
const cli = (...args: string[]): Run => {
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/host-migrate.mts', ...args, `--source-home=${H}`], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string }
    return { code: x.status ?? 1, out: `${x.stdout ?? ''}${x.stderr ?? ''}` }
  }
}
const all: string[] = []
const keep = (x: Run): Run => { all.push(x.out); return x }

const plan = keep(cli('plan'))
check('plan exit 0', plan.code === 0, plan.out.slice(-300))
check('plan 은 키 이름을 보여 준다', plan.out.includes('DATABASE_URL') && plan.out.includes('SORAN_NAVERCAFE_SESSION_PATH'))
check('plan 은 plist 를 다시 찍을 수 있다고 본다', plan.out.includes('🟢 com.soransoran.supply-process'))

const inRepo = join(process.cwd(), '.host-migrate-check-bundle')
const refused = keep(cli('export', `--out=${inRepo}`))
check('🔴 저장소 안 export → 거부', refused.code !== 0 && refused.out.includes('git 작업트리'), refused.out.slice(-200))
check('🔴 거부했으면 디렉터리를 만들지 않는다', !existsSync(inRepo))

const out = join(sandbox, 'bundle')
const ex = keep(cli('export', `--out=${out}`))
check('export exit 0 (verify 포함)', ex.code === 0, ex.out.slice(-400))
const manText = existsSync(join(out, BUNDLE_MANIFEST)) ? readFileSync(join(out, BUNDLE_MANIFEST), 'utf-8') : ''
check('🔴 manifest 에 비밀 0', manText !== '' && leaked(manText).length === 0, leaked(manText).join(','))
check('manifest 는 rehearsal', manText.includes('"mode": "rehearsal"'))
check('🔴 env.local 0600', existsSync(join(out, 'state/env.local')) && (statSync(join(out, 'state/env.local')).mode & 0o777) === 0o600)
check('🔴 네이버 세션 0600', existsSync(join(out, 'state/naver-session/state.json')) && (statSync(join(out, 'state/naver-session/state.json')).mode & 0o777) === 0o600)
check('🔴 묶음 디렉터리 0700', existsSync(out) && (statSync(out).mode & 0o777) === 0o700)
check('🔴 쥔 감사 잠금은 싣지 않았다', !existsSync(join(out, 'state/auto-ready-audit/audit.lock')))
check('heartbeat 틱 표식은 실었다', existsSync(join(out, 'state/publish-heartbeat/tick-2026-09-28T08-00.lock')))
check('🔴 옛 env 사본은 싣지 않았다', !existsSync(join(out, 'state/env.local.bak-1')))
check('slack.env 를 비밀로 실었다', existsSync(join(out, 'home/.config/soransoran/slack.env')))
const tplFile = join(out, 'launchd/com.soransoran.supply-process.plist.template')
check('🔴 plist 템플릿에 원 홈 경로 0', existsSync(tplFile) && !readFileSync(tplFile, 'utf-8').includes(H))

check('verify exit 0', keep(cli('verify', `--bundle=${out}`)).code === 0)

const rendered = join(sandbox, 'rendered')
const tHome = '/Users/bob-check'
const inst = keep(cli('install', `--bundle=${out}`, `--target-home=${tHome}`, '--skip-network', `--render-to=${rendered}`))
check('install dry-run exit 0', inst.code === 0, inst.out.slice(-300))
check('🔴 dry-run 은 rehearsal 적용 거부를 적는다', inst.out.includes('--apply 는 거부된다') && inst.out.includes('rehearsal 묶음'))
const rp = join(rendered, 'com.soransoran.supply-process.plist')
const rx = existsSync(rp) ? readFileSync(rp, 'utf-8') : ''
check('🔴 다시 찍은 plist 에 원 홈 0 · 대상 홈 있음', rx !== '' && !rx.includes(H) && rx.includes(`${tHome}/Documents/soransoran-runtime`))
const apply = keep(cli('install', `--bundle=${out}`, `--target-home=${tHome}`, '--skip-network', '--apply'))
check('🔴 --apply 거부(rehearsal · 가짜 홈)', apply.code !== 0)
check('🔴 거부했으면 대상에 아무것도 만들지 않는다', !existsSync(tHome))
const cutover = keep(cli('export', `--out=${join(sandbox, 'cut')}`, '--cutover'))
check('🔴 가짜 홈에서는 cutover 묶음을 만들지 않는다', cutover.code !== 0 && !existsSync(join(sandbox, 'cut', BUNDLE_MANIFEST)))

// 🔴 변조 — 한 바이트
appendFileSync(join(out, 'state/llm-ledger/2026-09-28.jsonl'), 'x')
const tampered = keep(cli('verify', `--bundle=${out}`))
check('🔴 파일 변조 → verify 실패(HASH)', tampered.code !== 0 && tampered.out.includes('HASH'))
chmodSync(join(out, 'state/env.local'), 0o644)
check('🔴 비밀 권한 풀림 → verify 실패(PERM)', keep(cli('verify', `--bundle=${out}`)).out.includes('PERM'))
writeFileSync(join(out, 'state/llm-ledger/extra.txt'), 'x')
check('🔴 끼워 넣은 파일 → verify 실패(EXTRA)', keep(cli('verify', `--bundle=${out}`)).out.includes('EXTRA'))

// 🔴 누출 — 로그에 비밀번호 조각이 찍혀 있으면 묶음이 실패한다(값은 화면에 나오지 않는다)
appendFileSync(join(H, 'Library/Logs/soransoran/supply-process.log'), `connect failed for ${PASS}\n`)
const out2 = join(sandbox, 'bundle2')
const leakRun = keep(cli('export', `--out=${out2}`))
check('🔴 로그 누출 → export 의 verify 실패(LEAK)', leakRun.code !== 0 && leakRun.out.includes('LEAK'), leakRun.out.slice(-300))
check('🔴 누출 보고는 파일·키 이름만', leakRun.out.includes('logs/supply-process.log'))

const joined = all.join('\n')
check(`🔴 CLI 출력 ${all.length}회 전체에 비밀 0`, leaked(joined).length === 0, leaked(joined).join(','))

rmSync(sandbox, { recursive: true, force: true })
check('가짜 홈 · 묶음 정리', !existsSync(sandbox) && readdirSync(tmpdir()).every((d) => !d.startsWith(sandbox.split('/').pop()!)))

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 운영 홈 0 · launchctl 0 · 네트워크 0 · DB 0\n')
process.exit(fail === 0 ? 0 : 1)
