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
 *   ⑦ 두 호스트 가드 — cutover 조건 · rehearsal 거부 · 원 호스트 되살리기 · D100 이 두 Mac 에서 동시에 돌기 거부
 *   ⑧ 설치 실패 → 되돌리기 (가짜 effect)
 *   ⑨ 전원 — AC 에 꽂힌 MacBook 통과 · 배터리로 도는 MacBook 실패 (pmset 출력 fixture)
 *   ⑩ D100 만 내리기 · 되살리기 — 가짜 LaunchAgents 에서 매거진·개발 plist 는 제자리
 *   ⑪ CLI 끝에서 끝까지 — 가짜 홈에서 plan · export · verify · install dry-run · 변조 · 누출 ·
 *      매거진 plist 없음 / 손상(23바이트 JSON)이어도 D100 묶음은 된다
 *
 *   npm run host:migrate-check
 */
import { execFileSync } from 'node:child_process'
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BUNDLE_MANIFEST, classifyCanonEntry, foreignHomePaths, homePathKeys, isTransientFile, judgeBundleOut,
  judgeCutoverExport, judgeManifest, judgeTargetInstall, judgeUnquiesce, nodeBinsIn, parseLaunchctlList,
  busyLabels, redact, renderAndJudge, rewriteEnvHome, runInstall, scanForSecrets, secretValuesOf,
  templatizePlist, type BundleManifest, type InstallEffects,
  D100_LANE_LABELS, HANDOFF_FILE, LANE, OWNER_FILE, isLaneLabel, isLaneLog, judgeAutorestart, judgePower,
  lanePlistFiles, parsePmsetBatt, planQuiesce, runQuiesce, runUnquiesce, targetRollbackLabels,
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
check('🔴 매거진 레인 상태는 싣지 않는다(D100 범위 밖)', classifyCanonEntry('magazine-quarantine.json').kind === 'exclude'
  && classifyCanonEntry('magazine-fetch-results').kind === 'exclude' && classifyCanonEntry('magazine-supervised-run.json').kind === 'exclude')
check('🔴 매거진 임대(잠금)는 싣지 않는다', classifyCanonEntry('magazine-manuscript-leases').kind === 'exclude')
check('🔴 매거진 재생성 패킷은 싣지 않는다', classifyCanonEntry('regen-packets').kind === 'exclude')
check('러너 복구 표식은 D100 state', classifyCanonEntry('runner-recover').kind === 'state')
check('🔴 레인 handoff·소유 표식은 싣지 않는다', classifyCanonEntry(HANDOFF_FILE).kind === 'exclude' && classifyCanonEntry(OWNER_FILE).kind === 'exclude'
  && HANDOFF_FILE.includes(LANE) && OWNER_FILE.includes(LANE))
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
    <key>Label</key><string>com.soransoran.supply-process</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NB}/npx</string>
        <string>tsx</string>
        <string>${SRC_HOME}/Documents/soransoran-runtime/scripts/supply-process.mts</string>
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
check('🔴 runtime 경로는 __HOME__ 조각이 아니라 __REPO__ 로', tpl.includes('__REPO__/scripts/supply-process.mts'))
const TGT = { home: '/Users/bob', nodeBin: '/Users/bob/.nvm/versions/node/v24.9.0/bin' }
const r = renderAndJudge('com.soransoran.supply-process', tpl, TGT)
check('🔴 다른 사용자·홈으로 찍으면 /Users/alice 0', !r.xml.includes('/Users/alice'))
check('치환 문제 0', r.problems.length === 0, r.problems.join(' · '))
check('대상 runtime · 로그 · node 경로', r.xml.includes('/Users/bob/Documents/soransoran-runtime/scripts/supply-process.mts')
  && r.xml.includes('/Users/bob/Library/Logs/soransoran/x.log')
  && r.xml.includes('<string>/Users/bob/.nvm/versions/node/v24.9.0/bin/npx</string>'))
check('PATH 의 시스템 조각은 그대로', r.xml.includes('/Users/bob/.local/bin:/Users/bob/.nvm/versions/node/v24.9.0/bin:/opt/homebrew/bin:/usr/bin:/bin'))
const nonUsers = renderAndJudge('com.soransoran.supply-process', tpl, { home: '/private/tmp/fake-home', nodeBin: '/private/tmp/fake-home/n/bin' })
check('🔴 /Users 밖 홈으로도 /Users/<누구> 0', foreignHomePaths(nonUsers.xml, '/private/tmp/fake-home').length === 0 && nonUsers.problems.length === 0)
// 🔴 반례: 템플릿화를 건너뛰면 판정이 원 홈을 잡는다
const raw = renderAndJudge('com.soransoran.supply-process', srcPlist, TGT)
check('🔴 반례 — 템플릿화 안 한 plist 는 원 홈 경로로 실패', raw.problems.some((p) => p.includes('/Users/alice')))
check('🔴 반례 — Label 다르면 실패', renderAndJudge('com.soransoran.stage-controller', tpl, TGT).problems.length > 0)
check('🔴 반례 — 모르는 placeholder 가 남으면 실패', renderAndJudge('com.soransoran.supply-process', tpl.replace('tsx', '__NEW__'), TGT).problems.length > 0)
// 🔴 레인 반례 — 매거진 job 은 Label·경로가 멀쩡해도 D100 묶음에 들어가지 못한다
const magPlist = srcPlist.replace('com.soransoran.supply-process', 'com.soransoran.magazine-watch')
  .replace(`${SRC_HOME}/Documents/soransoran-runtime/scripts/supply-process.mts`, `${SRC_HOME}/Documents/soransoran-magazine-runtime/scripts/magazine-auto-merge.mjs`)
const magTpl = templatizePlist(magPlist, { home: SRC_HOME, nodeBin: NB })
check('매거진 runtime 경로는 __MAGAZINE_REPO__ 로 되돌린다', magTpl.includes('__MAGAZINE_REPO__/scripts/'))
const magR = renderAndJudge('com.soransoran.magazine-watch', magTpl, TGT)
check('🔴 반례 — 매거진 label 은 allowlist 밖으로 실패', magR.problems.some((p) => p.includes('allowlist 밖')))
check('🔴 반례 — 매거진 runtime 은 대상에 채우지 않는다(placeholder 남음)', magR.problems.some((p) => p.includes('__MAGAZINE_REPO__')))
const hijack = renderAndJudge('com.soransoran.supply-process', magTpl.replace('com.soransoran.magazine-watch', 'com.soransoran.supply-process'), TGT)
check('🔴 반례 — D100 label 이 매거진 runtime 을 가리키면 실패', hijack.problems.some((p) => p.includes('매거진 runtime')))

// ─────────────────────────────────────────────────────────
console.log('\n⑥ manifest 판정')
// ─────────────────────────────────────────────────────────
const man = (entries: BundleManifest['entries']): BundleManifest => ({
  formatVersion: 2, lane: LANE, bundleId: 'b', mode: 'rehearsal', createdAt: '', envKeys: [], envHomePathKeys: [], plists: [],
  laneMissing: [], excluded: [], quiesce: null,
  source: { home: SRC_HOME, user: 'alice', macos: null, arch: 'arm64', nodeBin: NB, nodeVersion: 'v24.14.0' },
  runtime: { pinnedSha: null }, entries,
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
check('🔴 다른 레인 묶음 → LANE', judgeManifest({ manifest: { ...man(E), lane: 'magazine' }, actual: good }).some((p) => p.code === 'LANE'))
check('🔴 옛 호스트 전체 묶음(v1) → FORMAT', judgeManifest({ manifest: { ...man(E), formatVersion: 1 }, actual: good }).some((p) => p.code === 'FORMAT'))
check('🔴 manifest 에 allowlist 밖 job(매거진) → LANE', judgeManifest({
  manifest: { ...man(E), plists: [{ label: 'com.soransoran.magazine-producer', file: 'launchd/x', loadedAtExport: true }] }, actual: good,
}).some((p) => p.code === 'LANE' && p.detail.includes('magazine-producer')))
check('🔴 비밀 0644 → PERM', judgeManifest({ manifest: man(E), actual: new Map([...good, ['state/env.local', { sha256: 'ee', size: 2, mode: 0o100644 }]]) }).some((p) => p.code === 'PERM'))

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 두 호스트 가드')
// ─────────────────────────────────────────────────────────
const cut = { loadedLabels: [] as string[], installedPlists: [] as string[], handoffPresent: true, handoffBundleId: null }
check('원 호스트 D100 완전히 내려감 → cutover 허용', judgeCutoverExport(cut).ok)
check('🔴 D100 loaded job 남음 → 거부', !judgeCutoverExport({ ...cut, loadedLabels: ['com.soransoran.supply-process'] }).ok)
check('🔴 D100 plist 파일 남음(재부팅 때 부활) → 거부', !judgeCutoverExport({ ...cut, installedPlists: ['com.soransoran.keep-awake.plist'] }).ok)
const MAG_LOADED = ['com.soransoran.magazine-producer', 'com.soransoran.magazine-watch', 'com.soransoran.magazine-graph-watch', 'com.soransoran.magazine-auto-register']
check('🔴 매거진·개발 job 이 원 호스트에 loaded 로 남아 있어도 cutover 허용(레인 단위)', judgeCutoverExport({
  ...cut, loadedLabels: [...MAG_LOADED, 'com.soransoran.dev-preview'], installedPlists: MAG_LOADED.map((l) => `${l}.plist`),
}).ok)
check('🔴 launchctl 못 읽음 → 거부', !judgeCutoverExport({ ...cut, loadedLabels: null }).ok)
check('🔴 handoff 없음 → 거부', !judgeCutoverExport({ ...cut, handoffPresent: false }).ok)
check('🔴 두 번째 cutover 묶음 → 거부', !judgeCutoverExport({ ...cut, handoffBundleId: 'x' }).ok)
const ti = {
  bundleMode: 'cutover' as const, bundleLane: LANE as string, verifyProblems: 0, targetPlists: [] as string[], targetLoaded: [] as string[],
  targetOwnerPresent: false, targetCanonCollisions: [] as string[],
  targetRuntimeExists: false, runningHome: '/Users/bob', targetHome: '/Users/bob', preflightFailures: 0,
}
check('d100 cutover 묶음 · 빈 대상 → 설치 허용', judgeTargetInstall(ti).ok)
check('🔴 rehearsal 묶음 → 설치 거부', !judgeTargetInstall({ ...ti, bundleMode: 'rehearsal' }).ok)
check('🔴 다른 레인 묶음 → 설치 거부', !judgeTargetInstall({ ...ti, bundleLane: 'magazine' }).ok)
check('🔴 대상에 이미 D100 plist → 거부', !judgeTargetInstall({ ...ti, targetPlists: ['com.soransoran.supply-process.plist'] }).ok)
check('🔴 대상에 이미 D100 loaded → 거부', !judgeTargetInstall({ ...ti, targetLoaded: ['com.soransoran.original-post-runner'] }).ok)
check('🔴 대상에 이미 d100 소유 표식 → 거부', !judgeTargetInstall({ ...ti, targetOwnerPresent: true }).ok)
check('🔴 대상 운영 디렉터리에 묶음이 쓸 항목 있음 → 거부', !judgeTargetInstall({ ...ti, targetCanonCollisions: ['env.local'] }).ok)
check('대상에 다른 레인 job 만 있음 → D100 설치를 막지 않는다', judgeTargetInstall({
  ...ti, targetPlists: ['com.soransoran.magazine-watch.plist'], targetLoaded: ['com.soransoran.magazine-watch'],
}).ok)
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

// 🔴 D100 이 두 Mac 에서 동시에 도는 모든 길이 막히는가 — 순서대로 한 번 걷는다
{
  // 원 호스트는 D100 이 돌고 있고(quiesce 전) 대상은 비어 있다
  const srcLoaded = [...D100_LANE_LABELS, ...MAG_LOADED]
  const stillRunning = judgeCutoverExport({ loadedLabels: srcLoaded, installedPlists: D100_LANE_LABELS.map((l) => `${l}.plist`), handoffPresent: false, handoffBundleId: null })
  check('🔴 두 호스트 ① 원 호스트 D100 이 도는 채로는 cutover 묶음이 없다', !stillRunning.ok)
  check('🔴 두 호스트 ② rehearsal 묶음으로는 대상에 올릴 수 없다', !judgeTargetInstall({ ...ti, bundleMode: 'rehearsal' }).ok)
  // 대상이 이미 D100 주인인데 같은(또는 다른) cutover 묶음을 또 올리려 한다
  check('🔴 두 호스트 ③ 대상이 이미 D100 주인이면 두 번째 설치 거부', !judgeTargetInstall({
    ...ti, targetOwnerPresent: true, targetLoaded: [...D100_LANE_LABELS],
  }).ok)
  check('🔴 두 호스트 ④ 같은 원 호스트에서 두 번째 cutover 묶음 거부', !judgeCutoverExport({ ...cut, handoffBundleId: 'b1' }).ok)
  check('🔴 두 호스트 ⑤ 대상이 올라간 뒤 원 호스트 D100 되살리기는 증거(bundleId) 없이 거부',
    !judgeUnquiesce({ handoffBundleId: 'b1', givenBundleId: null }).ok && !judgeUnquiesce({ handoffBundleId: 'b1', givenBundleId: 'b2' }).ok)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 설치 실패 → 되돌리기')
// ─────────────────────────────────────────────────────────
const trace: string[] = []
const fx = (over: Partial<InstallEffects>): InstallEffects => ({
  cloneRepo: () => { trace.push('clone'); return true },
  addRuntime: () => { trace.push('runtime'); return true },
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
const [A, B, C] = ['com.soransoran.supply-process', 'com.soransoran.original-post-runner', 'com.soransoran.keep-awake'] as const
const plists = [A, B, C].map((l) => ({ label: l as string, xml: '', problems: [] as string[] }))
const okRun = runInstall({ pinnedSha: 's', plists, loadLabels: [A, B, C] }, fx({}))
check('정상 설치 완료', okRun.ok)
check('🔴 소유 표식은 job 을 올리기 전에', trace.indexOf('owner') < trace.indexOf(`boot:${A}`))
check('🔴 매거진 runtime 은 만들지 않는다', !trace.includes('mag'))
trace.length = 0
const bad = runInstall({ pinnedSha: 's', plists, loadLabels: [A, B, C] },
  fx({ bootstrap: (l) => { trace.push(`boot:${l}`); return l !== B } }))
check('🔴 두 번째 bootstrap 실패 → 설치 실패', !bad.ok && bad.phase === `bootstrap ${B}`)
check('🔴 올린 job 만 내린다(A)', trace.includes(`bootout:${A}`) && !trace.includes(`bootout:${C}`))
check('🔴 쓴 plist 전부 치운다', [A, B, C].every((l) => trace.includes(`retire:${l}`)))
check('🔴 내리기가 치우기보다 먼저', trace.indexOf(`bootout:${A}`) < trace.indexOf(`retire:${A}`))
check('🔴 소유 표식 삭제 · 되돌림 완료', trace.includes('unowner') && bad.rollback?.complete === true)
trace.length = 0
const partial = runInstall({ pinnedSha: 's', plists, loadLabels: [A] },
  fx({ isolationCheck: () => false, bootout: () => false }))
check('🔴 되돌리다 실패해도 나머지를 계속하고 남은 것을 적는다', partial.rollback?.complete === false
  && partial.rollback.residual.some((x) => x.includes('bootout')) && trace.includes(`retire:${C}`))
trace.length = 0
const renderBad = runInstall({ pinnedSha: 's', plists: [{ label: A, xml: '', problems: ['x'] }], loadLabels: [] }, fx({}))
check('🔴 render 문제가 있으면 clone 도 하지 않는다', !renderBad.ok && trace.length === 0)
trace.length = 0
const laneBad = runInstall({ pinnedSha: 's', plists: [...plists, { label: 'com.soransoran.magazine-producer', xml: '', problems: [] }], loadLabels: [A] }, fx({}))
check('🔴 allowlist 밖 job 이 섞이면 clone 도 하지 않는다', !laneBad.ok && laneBad.phase === 'lane' && trace.length === 0)
check('🔴 대상 되돌리기는 D100 label 만', JSON.stringify(targetRollbackLabels([A, 'com.soransoran.magazine-watch', 'com.soransoran.dev-x'])) === JSON.stringify([A]))

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 전원 — 기종 무관 · AC 에 꽂혀 있는가')
// ─────────────────────────────────────────────────────────
const BAT_LINE = (tail: string): string => ` -InternalBattery-0 (id=21823587)\t${tail} present: true`
const PM = {
  acCharging: `Now drawing from 'AC Power'\n${BAT_LINE('85%; charging; 1:02 remaining')}\n`,
  acCharged: `Now drawing from 'AC Power'\n${BAT_LINE('100%; charged; 0:00 remaining')}\n`,
  acAttached: `Now drawing from 'AC Power'\n${BAT_LINE('80%; AC attached; not charging')}\n`,
  onBattery: `Now drawing from 'Battery Power'\n${BAT_LINE('23%; discharging; 3:10 remaining')}\n`,
  acButDraining: `Now drawing from 'AC Power'\n${BAT_LINE('41%; discharging; (no estimate)')}\n`,
  desktop: `Now drawing from 'AC Power'\n`,
  ups: `Now drawing from 'UPS Power'\n -CP1500 (id=1)\t90%; discharging; 0:40 remaining present: true\n`,
  empty: '',
}
const pAc = parsePmsetBatt(PM.acCharging)
check('pmset 읽기 — AC · 배터리 있음 · charging · 85%', pAc.source === 'ac' && pAc.hasBattery && pAc.batteryState === 'charging' && pAc.percent === 85)
check('🟢 AC 연결 MacBook(충전 중) → 통과', judgePower(pAc).ok)
check('🟢 AC 연결 MacBook(완충) → 통과', judgePower(parsePmsetBatt(PM.acCharged)).ok)
check('🟢 AC 연결 MacBook(AC attached · 충전 안 함) → 통과', judgePower(parsePmsetBatt(PM.acAttached)).ok)
check('🟢 배터리 없는 Mac(AC) → 통과', judgePower(parsePmsetBatt(PM.desktop)).ok)
const pBat = parsePmsetBatt(PM.onBattery)
check('🔴 배터리로 도는 MacBook(discharging) → 실패', pBat.source === 'battery' && !judgePower(pBat).ok)
check('🔴 AC 표시인데 방전 중 → 실패', !judgePower(parsePmsetBatt(PM.acButDraining)).ok)
check('🔴 UPS 전원으로 도는 중(정전) → 실패', !judgePower(parsePmsetBatt(PM.ups)).ok)
check('🔴 pmset 못 읽음 → 실패(관측 없음은 통과가 아니다)', !judgePower(parsePmsetBatt(PM.empty)).ok)
check('배터리 있는 Mac 은 autorestart 를 요구하지 않는다', judgeAutorestart(pAc, null).ok)
check('🔴 배터리 없는 Mac 은 autorestart 1 이어야 한다', !judgeAutorestart(parsePmsetBatt(PM.desktop), '0').ok
  && judgeAutorestart(parsePmsetBatt(PM.desktop), '1').ok)

// ─────────────────────────────────────────────────────────
console.log('\n⑩ D100 만 내리기 · 되살리기 (가짜 LaunchAgents · launchctl 0)')
// ─────────────────────────────────────────────────────────
{
  const qbox = realpathSync(mkdtempSync(join(tmpdir(), 'host-migrate-quiesce-')))
  const agents = join(qbox, 'LaunchAgents')
  const parked = join(qbox, 'quiesced')
  mkdirSync(agents, { recursive: true }); mkdirSync(parked, { recursive: true })
  const MAG = ['com.soransoran.magazine-producer', 'com.soransoran.magazine-watch', 'com.soransoran.magazine-graph-watch', 'com.soransoran.magazine-auto-register']
  const DEV = ['com.soransoran.dev-preview', 'com.example.unrelated']
  const others = [...MAG, ...DEV]
  const body = (l: string): string => `<plist><dict><key>Label</key><string>${l}</string></dict></plist>\n`
  for (const l of [...D100_LANE_LABELS, ...others]) writeFileSync(join(agents, `${l}.plist`), body(l))
  // 🔴 실측(2026-09-29) 모양 그대로 — 23바이트 JSON 으로 덮인 매거진 plist
  writeFileSync(join(agents, 'com.soransoran.magazine-auto-register.plist'), '[{"Hour":1,"Minute":0}]')
  const snapshot = (): string => others.map((l) => {
    const f = join(agents, `${l}.plist`); return `${l}:${existsSync(f) ? readFileSync(f, 'utf-8') : '없음'}`
  }).join('\n')
  const before = snapshot()
  const loaded = new Set<string>([...D100_LANE_LABELS, ...MAG, 'com.soransoran.dev-preview'])
  const rowsQ = [...loaded].map((l) => ({ label: l, pid: l === 'com.soransoran.keep-awake' ? 55182 : null }))
  const plan = planQuiesce({ rows: rowsQ, plistFiles: readdirSync(agents) })
  check('quiesce 계획 — D100 9개만 bootout · 9개만 이동', plan.bootout.length === D100_LANE_LABELS.length && plan.move.length === D100_LANE_LABELS.length
    && plan.bootout.every(isLaneLabel), JSON.stringify(plan.bootout))
  check('🔴 quiesce 계획 — 매거진·개발 job 은 그대로 둔다', MAG.every((l) => plan.untouchedLoaded.includes(l))
    && plan.untouchedPlists.length === others.length && !plan.bootout.some((l) => l.includes('magazine')))
  check('keep-awake 상주는 실행 중으로 보지 않는다', plan.busy.length === 0)
  const busyPlan = planQuiesce({ rows: rowsQ.map((r) => (r.label === 'com.soransoran.supply-process' ? { ...r, pid: 7 } : r)), plistFiles: readdirSync(agents) })
  const qCalls: string[] = []
  const busyRun = runQuiesce(busyPlan, { bootout: (l) => { qCalls.push(l); return true }, movePlist: (f) => { qCalls.push(f); return true }, loadedAfter: () => [] })
  check('🔴 D100 회차가 실행 중이면 아무것도 내리지 않는다', !busyRun.ok && qCalls.length === 0)
  check('실행 중인 매거진 회차는 D100 내리기를 막지 않는다', planQuiesce({
    rows: rowsQ.map((r) => (r.label === 'com.soransoran.magazine-producer' ? { ...r, pid: 9 } : r)), plistFiles: [],
  }).busy.length === 0)

  const booted: string[] = []
  const q = runQuiesce(plan, {
    bootout: (l) => { booted.push(l); loaded.delete(l); return true },
    movePlist: (f) => { try { renameSync(join(agents, f), join(parked, f)); return true } catch { return false } },
    loadedAfter: () => [...loaded],
  })
  check('D100 내리기 완료', q.ok, q.residual.join(' · '))
  check('🔴 D100 plist 전부 LaunchAgents 밖으로', D100_LANE_LABELS.every((l) => !existsSync(join(agents, `${l}.plist`)) && existsSync(join(parked, `${l}.plist`))))
  check('🔴 매거진·개발 plist 는 제자리 · 바이트 그대로(손상 plist 포함)', snapshot() === before)
  check('🔴 매거진·개발 job 은 loaded 그대로', MAG.every((l) => loaded.has(l)) && loaded.has('com.soransoran.dev-preview'))
  check('🔴 bootout 은 D100 에만', booted.length === D100_LANE_LABELS.length && booted.every(isLaneLabel))
  check('🔴 D100 이 하나라도 남으면 실패로 적는다', !runQuiesce(planQuiesce({ rows: [{ label: 'com.soransoran.stage-controller', pid: null }], plistFiles: [] }), {
    bootout: () => true, movePlist: () => true, loadedAfter: () => ['com.soransoran.stage-controller', ...MAG],
  }).ok)
  check('매거진이 loaded 로 남은 것은 D100 내리기 실패가 아니다', runQuiesce(planQuiesce({ rows: [], plistFiles: [] }), {
    bootout: () => true, movePlist: () => true, loadedAfter: () => [...MAG],
  }).ok)

  // 되살리기 — 🔴 handoff 에 매거진 이름이 끼어 있어도(손으로 고친 경우) 거른다
  const restored: string[] = []
  const bootstrapped: string[] = []
  const u = runUnquiesce({ plists: [...q.moved, 'com.soransoran.magazine-watch.plist'], loadedBefore: [...plan.bootout, 'com.soransoran.magazine-watch'] }, {
    restorePlist: (f) => { restored.push(f); try { renameSync(join(parked, f), join(agents, f)); return true } catch { return false } },
    bootstrap: (l) => { bootstrapped.push(l); loaded.add(l); return true },
  })
  check('D100 되살리기 완료', u.ok, u.residual.join(' · '))
  check('🔴 D100 plist 제자리', D100_LANE_LABELS.every((l) => existsSync(join(agents, `${l}.plist`))))
  check('🔴 되살리기도 매거진은 건드리지 않는다', !restored.some((f) => f.includes('magazine')) && !bootstrapped.some((l) => l.includes('magazine')))
  check('🔴 되살린 뒤에도 매거진·개발 plist 바이트 그대로', snapshot() === before)
  check('D100 lane plist 거르기 — 모르는 파일 0', JSON.stringify(lanePlistFiles(['x.plist', 'com.soransoran.magazine-watch.plist', 'com.soransoran.keep-awake.plist']))
    === '["com.soransoran.keep-awake.plist"]')
  check('D100 로그만 싣는다', isLaneLog('supply-process.log') && isLaneLog('keep-awake-error.log') && !isLaneLog('magazine-watch.log')
    && !isLaneLog('raw-collect-82cook.log') && !isLaneLog('supply-autopilot.log'))
  rmSync(qbox, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ CLI 끝에서 끝까지 (가짜 홈 · launchctl 0 · 네트워크 0)')
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
check(`🔴 매거진 plist 가 아예 없어도 D100 묶음이 된다 · manifest lane ${LANE}`, manText.includes(`"lane": "${LANE}"`))
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

// 🔴 매거진·개발 job 이 원 호스트에 있다 — 하나는 23바이트 JSON 으로 손상. D100 묶음은 이것을 읽지도 싣지도 않는다
const AG = join(H, 'Library/LaunchAgents')
w(join(AG, 'com.soransoran.magazine-auto-register.plist'), '[{"Hour":1,"Minute":0}]')
w(join(AG, 'com.soransoran.magazine-watch.plist'), srcPlist.replaceAll(NB, nb).replaceAll(SRC_HOME, H)
  .replace('com.soransoran.supply-process', 'com.soransoran.magazine-watch')
  .replace(`${H}/Documents/soransoran-runtime/scripts/supply-process.mts`, `${H}/Documents/soransoran-magazine-runtime/scripts/m.mjs`))
w(join(AG, 'com.soransoran.dev-preview.plist'), 'not a plist at all')
w(join(canon, 'magazine-quarantine.json'), '{"q":[]}')
w(join(canon, 'magazine-manuscript-leases/lease.json'), '{}')
w(join(canon, 'regen-packets/p1.json'), '{}')
w(join(H, 'Library/Logs/soransoran/magazine-watch.log'), '매거진 회차\n')
w(join(H, 'Library/Logs/soransoran/raw-collect-82cook.log'), '82cook 회차\n')
const plan2 = keep(cli('plan'))
check('🔴 손상 매거진 plist 가 있어도 plan exit 0', plan2.code === 0, plan2.out.slice(-300))
check('plan 은 매거진·개발 job 을 "건드리지 않음" 으로 보여 준다', plan2.out.includes('⚪ com.soransoran.magazine-auto-register')
  && plan2.out.includes('⚪ com.soransoran.dev-preview'))
check('🔴 plan 은 매거진 job 을 다시 찍을 대상으로 보지 않는다', !/[🟢🔴] com\.soransoran\.magazine/u.test(plan2.out))
const out3 = join(sandbox, 'bundle-with-magazine')
const ex3 = keep(cli('export', `--out=${out3}`))
check('🔴 손상(23바이트) 매거진 plist 가 있어도 D100 export·verify 통과', ex3.code === 0, ex3.out.slice(-400))
const man3 = existsSync(join(out3, BUNDLE_MANIFEST)) ? JSON.parse(readFileSync(join(out3, BUNDLE_MANIFEST), 'utf-8')) as BundleManifest : null
check('🔴 묶음 plist 는 D100 만', man3 !== null && man3.plists.length === 1 && man3.plists.every((p) => isLaneLabel(p.label)),
  JSON.stringify(man3?.plists.map((p) => p.label)))
const paths3 = man3?.entries.map((e) => e.path) ?? []
check('🔴 묶음에 매거진 상태·재생성 패킷·임대 0', man3 !== null && !paths3.some((p) => p.includes('magazine') || p.includes('regen-packets')), paths3.filter((p) => p.includes('magazine')).join(' '))
check('🔴 묶음에 매거진·82cook 로그 0 · D100 로그는 있다', paths3.includes('logs/supply-process.log')
  && !paths3.some((p) => p.startsWith('logs/magazine') || p.includes('82cook')))
check('🔴 묶음 manifest 에 매거진 runtime SHA 없음', man3 !== null && !JSON.stringify(man3.runtime).includes('magazine'))
check('allowlist 에 있지만 설치 plist 없는 job 을 적는다', man3 !== null && man3.laneMissing.length === D100_LANE_LABELS.length - 1)
check('🔴 원 호스트 매거진·개발 plist 는 그대로', readFileSync(join(AG, 'com.soransoran.magazine-auto-register.plist'), 'utf-8') === '[{"Hour":1,"Minute":0}]'
  && existsSync(join(AG, 'com.soransoran.magazine-watch.plist')) && existsSync(join(AG, 'com.soransoran.dev-preview.plist')))
// 🔴 반례 — D100 plist 자체가 손상이면 그것은 잡는다(무시하는 것은 레인 밖뿐)
w(join(AG, 'com.soransoran.stage-controller.plist'), '[{"Hour":1,"Minute":0}]')
const out4 = join(sandbox, 'bundle-d100-broken')
const ex4 = keep(cli('export', `--out=${out4}`))
check('🔴 반례 — 손상된 D100 plist 는 verify 가 PLIST 로 잡는다', ex4.code !== 0 && ex4.out.includes('PLIST') && ex4.out.includes('stage-controller'), ex4.out.slice(-300))
rmSync(join(AG, 'com.soransoran.stage-controller.plist'))
const ins3 = keep(cli('install', `--bundle=${out3}`, `--target-home=${tHome}`, '--skip-network'))
check('🔴 설치 순서에 매거진 runtime 을 만들지 않는다', ins3.code === 0 && !ins3.out.includes('soransoran-magazine-runtime ') && ins3.out.includes('매거진 runtime 은 만들지 않는다'))

// 🔴 변조 — 같은 길이로 바꾼다(크기만 보는 검사는 여기서 뚫린다)
const ledgerFile = join(out, 'state/llm-ledger/2026-09-28.jsonl')
writeFileSync(ledgerFile, readFileSync(ledgerFile, 'utf-8').replace('0.01', '9.99'))
const tampered = keep(cli('verify', `--bundle=${out}`))
check('🔴 같은 길이 변조 → verify 실패(HASH)', tampered.code !== 0 && tampered.out.includes('HASH'))
appendFileSync(ledgerFile, 'x')
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
