#!/usr/bin/env node
/**
 * 자동 레인 회귀 테스트 — 게이트가 정말 막는가.
 *
 * 🔴 이 테스트가 지키는 것
 *    ① **HIGH 가 자동 레인에 흘러들지 않는다.**
 *       batch-qa 는 topic-queue 에 없는 slug 의 등급을 검사하지 않고
 *       READY_TO_SCHEDULE 을 낼 수 있다. 그 구멍을 gate 가 막는지 확인한다.
 *    ② **오염된 원고가 파일이 되지 않는다.**
 *       ChatGPT 인용 마커가 draft.md 를 지나 production 까지 간 적이 있다
 *       (after-holiday-body-ache).
 *    ③ **2026-09-15 장애가 다시 들어오지 않는다** — 아래 변이 10종.
 *
 * 🔴 **tracked fixture 만 쓴다.**
 *    옛 판은 `drafts/magazine/{avoiding-gatherings,…}/draft.md` 를 표본으로 삼았는데
 *    그 세 원고는 origin/main 에 커밋된 적이 없었다. clean checkout 에서 언제나
 *    1 FAIL 이 났다 — CI 도, 다른 기계도 통과할 수 없는 테스트였다.
 *    표본은 `scripts/__fixtures__/magazine/` 에 있다.
 *
 * 사용법: npm run magazine:auto-check
 * 종료 코드: FAIL 이 있으면 1
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gate, heroPlan, LANE_RISK } from './lib/magazine-auto-lane.mjs'
import { validateManuscript, MIN_BODY_LENGTH } from './lib/magazine-manuscript-guard.mjs'
import {
  assertOnBranch, branchName, createBranch, ghAuthReady, preflight, preflightTools,
  pushReady, returnToMain, stageCheck, writePreflight,
} from './lib/magazine-auto-git.mjs'
import { judgeLock, STALE_AFTER_MS } from './lib/magazine-auto-lock.mjs'
import { exitCodeFor } from './lib/magazine-auto-exit.mjs'
import { parseHeroBlock, validateHeroBrief } from './lib/magazine-hero-brief.mjs'
import { loadQueue } from './lib/magazine-load.mjs'
import { verifyReviewShape } from './lib/magazine-brief-policy.mjs'

let pass = 0
let fail = 0
function expect(label, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}
const codes = (g) => g.blockedBy.map((b) => b.code).sort()

const FIXTURES = join('scripts', '__fixtures__', 'magazine')

console.log('\n══════ gate — 등급')
const Q = [
  { slug: 'low-ok', riskLevel: 'LOW', autoEligible: true, imageMode: 'OPTIONAL' },
  { slug: 'med-ok', riskLevel: 'MEDIUM', autoEligible: true, imageMode: 'REQUIRED' },
  { slug: 'high-one', riskLevel: 'HIGH', autoEligible: false, imageMode: 'REQUIRED' },
  { slug: 'high-but-auto', riskLevel: 'HIGH', autoEligible: true, imageMode: 'OPTIONAL' },
  { slug: 'low-but-ineligible', riskLevel: 'LOW', autoEligible: false, imageMode: 'OPTIONAL' },
]
expect('HIGH 는 막힌다', codes(gate('high-one', Q)).includes('RISK_LEVEL'), true)
expect('autoEligible=true 여도 HIGH 면 막힌다', codes(gate('high-but-auto', Q)).includes('RISK_LEVEL'), true)
expect('LOW 여도 autoEligible=false 면 막힌다', codes(gate('low-but-ineligible', Q)).includes('AUTO_INELIGIBLE'), true)
expect('큐에 없으면 막힌다', codes(gate('nowhere', Q)), ['NOT_IN_QUEUE'])
expect('큐에 없을 때 등급을 추측하지 않는다', gate('nowhere', Q).item, null)
expect('AUTO_RISK 는 LOW/MEDIUM 뿐', [...LANE_RISK].sort(), ['LOW', 'MEDIUM'])

console.log('\n══════ gate — brief/review 가 없으면 진행하지 않는다')
expect('LOW 라도 brief 없으면 막힌다', codes(gate('low-ok', Q)).includes('BRIEF_MISSING'), true)
expect('LOW 라도 review 없으면 막힌다', codes(gate('low-ok', Q)).includes('REVIEW_MISSING'), true)
expect('막힌 이유에 RISK_LEVEL 은 없다 (LOW 니까)', codes(gate('low-ok', Q)).includes('RISK_LEVEL'), false)

console.log('\n══════ 실제 큐 — HIGH 가 하나도 통과하지 않는다')
const real = loadQueue()
const leaked = real.filter((i) => {
  const g = gate(i.slug, real)
  return g.ok && !LANE_RISK.has(i.riskLevel)
})
expect('실제 큐에서 자동 레인을 통과한 HIGH 0건', leaked.length, 0)
const ineligibleLeak = real.filter((i) => gate(i.slug, real).ok && i.autoEligible !== true)
expect('실제 큐에서 통과한 autoEligible=false 0건', ineligibleLeak.length, 0)

// ─────────────────────────────────────────────────────────
console.log('\n══════ 변이 ① REQUIRED hero — alt 를 review.ts 에서 읽는다')
/**
 * 🔴 옛 판은 호출부가 `alt: null` 을 고정으로 넘겨 REQUIRED 가 **구조적으로 언제나** 막혔다.
 *    이제 review.ts 에 적힌 alt 를 읽는다. 그렇다고 alt 를 지어내지는 않는다.
 */
const req = Q[1]
const opt = Q[0]
const heroFixture = parseHeroBlock(readFileSync(join(FIXTURES, 'review-hero.fixture.ts'), 'utf8'))
expect('fixture 에서 hero 블록을 읽는다', heroFixture.present, true)
expect('fixture alt 가 "…여성" 으로 끝난다', heroFixture.alt.endsWith('여성'), true)
expect('fixture hero 가 검사를 통과한다', validateHeroBrief(heroFixture).ok, true)
expect('review 의 alt 로 REQUIRED 가 진행된다', heroPlan(req, { alt: heroFixture.alt }).blocked ?? null, null)
expect('REQUIRED 는 여전히 필요하다', heroPlan(req, { alt: heroFixture.alt }).need, true)
expect('alt 가 없으면 REQUIRED 는 막힌다', heroPlan(req).blocked?.code, 'HERO_ALT_REQUIRED')
expect('hero 블록이 없으면 present=false', parseHeroBlock("export const REVIEW = { slug: 'x' }").present, false)
expect('alt 가 비면 HERO_ALT_MISSING', validateHeroBrief({ alt: '' }).reasons[0].code, 'HERO_ALT_MISSING')
expect(
  'alt 가 "여성" 으로 안 끝나면 막는다',
  validateHeroBrief({ alt: '창가에 앉아 바깥을 바라보는 사람' }).reasons.map((r) => r.code),
  ['HERO_ALT_SHAPE'],
)
expect(
  'alt 에 금지 호칭이 있으면 막는다',
  validateHeroBrief({ alt: '창가에 앉아 바깥을 바라보는 시니어 여성' }).reasons.map((r) => r.code),
  ['HERO_ALT_FORBIDDEN'],
)
expect(
  'scene 에 병원이 있으면 막는다',
  validateHeroBrief({ alt: heroFixture.alt, scene: '병원 진료실에서 순서를 기다리는 낮 시간' }).reasons.some((r) => r.code === 'HERO_SCENE_FORBIDDEN'),
  true,
)
// 🔴 alt 가 생겼다고 등급 게이트가 열리지 않는다 — 이것이 열리면 전부 무의미하다
expect('alt 가 있어도 HIGH 는 gate 에서 막힌다', codes(gate('high-one', Q)).includes('RISK_LEVEL'), true)
expect('alt 가 있어도 autoEligible=false 는 막힌다', codes(gate('low-but-ineligible', Q)).includes('AUTO_INELIGIBLE'), true)
// 🔴 OPTIONAL 을 넓히지 않는다
expect('OPTIONAL 은 alt 가 있어도 기본 스킵', heroPlan(opt, { alt: heroFixture.alt }).need, false)
expect('OPTIONAL 은 --allow-optional 로만 만든다', heroPlan(opt, { alt: heroFixture.alt, allowOptional: true }).need, true)

const baseReview = {
  slug: 'x',
  summary: ['1', '2', '3', '4', '5'],
  risk: { medical: 'LOW', money: 'NONE', legal: 'NONE' },
  factsToVerify: ['a'],
  preparedAt: '2026-09-15',
  preparedBy: 'Claude Code',
  notes: 'n',
}
expect('review 스키마가 hero 를 받는다', verifyReviewShape({ ...baseReview, hero: { alt: heroFixture.alt, scene: heroFixture.scene } }), [])
expect(
  'hero 에 모르는 필드가 있으면 막는다',
  verifyReviewShape({ ...baseReview, hero: { alt: heroFixture.alt, prompt: 'x' } }),
  ['hero 에 스키마에 없는 필드다: prompt'],
)
expect('hero.alt 가 비면 막는다', verifyReviewShape({ ...baseReview, hero: { alt: '  ' } }), ['hero.alt 가 비어 있다'])

// ─────────────────────────────────────────────────────────
console.log('\n══════ 변이 ② 실행 의존성 — gh 가 없으면 아무것도 쓰기 전에 막는다')
/** exec 를 흉내 낸다. 실제 git·gh 를 부르지 않는다 */
function fakeExec(map) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    for (const [pattern, res] of Object.entries(map)) {
      if (key.startsWith(pattern)) return { code: 0, out: '', err: '', ...res }
    }
    return { code: 0, out: '', err: '' }
  }
}
const ALL_TOOLS = {
  'git --version': { out: 'git version 2.39.0' },
  'gh --version': { out: 'gh version 2.92.0' },
  'node --version': { out: 'v24.14.0' },
  'claude --version': { out: '2.1.143 (Claude Code)' },
}
expect('도구가 전부 있으면 통과', preflightTools({ exec: fakeExec(ALL_TOOLS) }).ok, true)

const noGh = { ...ALL_TOOLS, 'gh --version': { code: 127, err: 'command not found: gh' } }
const ghMissing = preflightTools({ exec: fakeExec(noGh) })
expect('gh 가 없으면 막힌다', ghMissing.ok, false)
expect('사유가 TOOL_MISSING', ghMissing.blockedBy[0].code, 'TOOL_MISSING')
expect('무엇이 없는지 말한다', /gh/.test(ghMissing.blockedBy[0].message), true)
expect('claude 가 없어도 막힌다', preflightTools({ exec: fakeExec({ ...ALL_TOOLS, 'claude --version': { code: 127 } }) }).ok, false)

/**
 * 🔴 **핵심 회귀** — gh 가 없을 때 commit·push 에 닿지 않는다.
 *    옛 순서는 add → commit → push → gh 라, gh 부재를 push 뒤에 알았다.
 *    그 회차는 PR 없는 브랜치를 origin 에 남기고 exit 0 으로 끝났다.
 */
const calls = []
const recording = (map) => (cmd, args) => {
  calls.push(`${cmd} ${args.join(' ')}`)
  return fakeExec(map)(cmd, args)
}
const pfNoGh = writePreflight({ exec: recording(noGh) })
expect('gh 가 없으면 writePreflight 가 tools 에서 멈춘다', pfNoGh.stage, 'tools')
expect('gh 가 없으면 commit 을 부르지 않는다', calls.some((c) => c.startsWith('git commit')), false)
expect('gh 가 없으면 실제 push 를 부르지 않는다', calls.some((c) => c.startsWith('git push') && !c.includes('--dry-run')), false)
expect('gh 가 없으면 브랜치도 만들지 않는다', calls.some((c) => c.startsWith('git switch')), false)

console.log('\n══════ 변이 ③ gh 인증 · push 자격')
expect('gh 인증이 되어 있으면 통과', ghAuthReady({ exec: fakeExec({}) }).ok, true)
const authFail = ghAuthReady({ exec: fakeExec({ 'gh auth status': { code: 1, err: 'not logged in' } }) })
expect('gh 인증 실패를 잡는다', authFail.blockedBy[0].code, 'GH_AUTH_FAILED')
expect('인증 실패 문구에 토큰이 없다', /token|ghp_|gho_/.test(authFail.blockedBy[0].message), false)

expect('push 자격이 있으면 통과', pushReady({ exec: fakeExec({}) }).ok, true)
const pushFail = pushReady({ exec: fakeExec({ 'git push --dry-run': { code: 128, err: 'fatal: Authentication failed' } }) })
expect('push 실패를 미리 잡는다', pushFail.blockedBy[0].code, 'PUSH_NOT_READY')

let sawDryRun = false
pushReady({
  exec: (cmd, args) => {
    if (cmd === 'git' && args[0] === 'push') sawDryRun = args.includes('--dry-run')
    return { code: 0, out: '', err: '' }
  },
})
expect('push 자격 검사는 --dry-run 이다 (아무것도 올리지 않는다)', sawDryRun, true)

console.log('\n══════ git 안전장치 — write 는 깨끗한 main 에서만')
const CLEAN_MAIN = {
  'git rev-parse --abbrev-ref HEAD': { out: 'main' },
  'git fetch origin main': { out: '' },
  'git rev-parse HEAD': { out: 'abc1234' },
  'git rev-parse origin/main': { out: 'abc1234' },
  'git status --porcelain --untracked-files=no': { out: '' },
}
expect('깨끗한 main 은 통과', preflight({ exec: fakeExec(CLEAN_MAIN) }).ok, true)
expect(
  'main 이 아니면 BLOCKED',
  preflight({ exec: fakeExec({ ...CLEAN_MAIN, 'git rev-parse --abbrev-ref HEAD': { out: 'feat/something' } }) }).blockedBy.map((b) => b.code),
  ['NOT_ON_MAIN'],
)
expect(
  '추적 변경이 있으면 BLOCKED',
  preflight({ exec: fakeExec({ ...CLEAN_MAIN, 'git status --porcelain --untracked-files=no': { out: ' M src/content/magazine/articles.ts' } }) }).blockedBy.map((b) => b.code),
  ['DIRTY_TREE'],
)

// 미추적은 --untracked-files=no 로 애초에 목록에 오지 않는다. 그 인자를 정말 쓰는지 본다
let sawFlag = false
preflight({
  exec: (cmd, args) => {
    if (args.join(' ').startsWith('status')) sawFlag = args.includes('--untracked-files=no')
    return { code: 0, out: cmd === 'git' && args[0] === 'rev-parse' ? 'main' : '', err: '' }
  },
})
expect('status 는 미추적을 보지 않는다', sawFlag, true)

console.log('\n══════ 변이 ④ ff-only 동기화 — 하루 밀렸다고 멈추지 않는다')
/**
 * 🔴 옛 판은 HEAD ≠ origin/main 이면 그대로 BLOCKED 였다.
 *    main 이 하루만 앞서가도 runtime 이 영영 따라붙지 못한다.
 */
let ffCalled = false
let headSha = 'old1111'
const ffResult = preflight({
  exec: (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    if (key === 'git merge --ff-only origin/main') { ffCalled = true; headSha = 'new2222'; return { code: 0, out: '', err: '' } }
    if (key === 'git rev-parse HEAD') return { code: 0, out: headSha, err: '' }
    if (key === 'git rev-parse origin/main') return { code: 0, out: 'new2222', err: '' }
    if (key === 'git rev-parse --abbrev-ref HEAD') return { code: 0, out: 'main', err: '' }
    return { code: 0, out: '', err: '' }
  },
})
expect('뒤처졌으면 ff-only 를 시도한다', ffCalled, true)
expect('따라붙으면 통과한다', ffResult.ok, true)
expect('따라붙었다고 기록한다', ffResult.fastForwarded, true)

expect(
  '갈라졌으면 BLOCKED',
  preflight({
    exec: fakeExec({
      ...CLEAN_MAIN,
      'git rev-parse origin/main': { out: 'zzz9999' },
      'git merge --ff-only origin/main': { code: 128, err: 'fatal: Not possible to fast-forward' },
    }),
  }).blockedBy.map((b) => b.code),
  ['NOT_IN_SYNC'],
)

console.log('\n══════ PR 브랜치 — 충돌하면 현재 브랜치에 커밋하지 않는다')
expect('브랜치 이름에 초가 들어간다', /^feat\/magazine-auto-register-\d{4}-\d{2}-\d{2}-\d{6}$/.test(branchName()), true)
expect('1초 뒤 이름이 다르다', branchName(0) === branchName(1000), false)

const dup = createBranch('feat/dup', { exec: fakeExec({ 'git switch -c': { code: 128, err: "fatal: a branch named 'x' already exists" } }) })
expect('이미 있으면 실패한다', dup.ok, false)
expect('사유가 BRANCH_CREATE_FAILED', dup.blockedBy[0].code, 'BRANCH_CREATE_FAILED')
expect('현재 브랜치에 커밋하지 않는다는 문구', /현재 브랜치에 커밋하지 않는다/.test(dup.blockedBy[0].message), true)
expect(
  'switch 가 조용히 실패해도 잡는다',
  createBranch('feat/x', { exec: fakeExec({ 'git switch -c': { code: 0 }, 'git rev-parse --abbrev-ref HEAD': { out: 'main' } }) }).blockedBy[0].code,
  'BRANCH_MISMATCH',
)
expect('정상 전환은 통과', createBranch('feat/x', { exec: fakeExec({ 'git switch -c': { code: 0 }, 'git rev-parse --abbrev-ref HEAD': { out: 'feat/x' } }) }).ok, true)
expect('commit 직전 브랜치가 바뀌면 잡는다', assertOnBranch('feat/x', { exec: fakeExec({ 'git rev-parse': { out: 'main' } }) }).blockedBy[0].code, 'BRANCH_DRIFTED')

console.log('\n══════ 변이 ⑤ main 복귀 — 하루 만에 영구 정지하지 않는다')
/**
 * 🔴 복귀 코드가 없어서, 첫 성공 회차 이후 저장소가 자동 브랜치에 남고
 *    다음 날부터 매일 NOT_ON_MAIN 으로 멈추는 구조였다.
 */
const AUTO_BRANCH = 'feat/magazine-auto-register-2026-09-15-020000'
let switched = 0
const returnOk = returnToMain({
  exec: (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    if (key === 'git switch main') { switched += 1; return { code: 0, out: '', err: '' } }
    if (key === 'git rev-parse --abbrev-ref HEAD') return { code: 0, out: switched ? 'main' : AUTO_BRANCH, err: '' }
    return { code: 0, out: '', err: '' }
  },
})
expect('깨끗하면 main 으로 돌아온다', returnOk.ok, true)
expect('복귀 코드가 RETURNED', returnOk.code, 'RETURNED')
expect('작업 브랜치를 남겨 둔다고 말한다', /남겨 둔다/.test(returnOk.message), true)
expect('이미 main 이면 아무것도 하지 않는다', returnToMain({ exec: fakeExec({ 'git rev-parse --abbrev-ref HEAD': { out: 'main' } }) }).code, 'ALREADY_ON_MAIN')

// 🔴 미커밋 변경이 있으면 **지우지 않는다**
const dirtyCalls = []
const dirtyReturn = returnToMain({
  exec: (cmd, args) => {
    dirtyCalls.push(`${cmd} ${args.join(' ')}`)
    return fakeExec({
      'git rev-parse --abbrev-ref HEAD': { out: AUTO_BRANCH },
      'git status --porcelain --untracked-files=no': { out: ' M src/content/magazine/articles.ts' },
    })(cmd, args)
  },
})
expect('미커밋 변경이 있으면 복귀하지 않는다', dirtyReturn.ok, false)
expect('사유가 RETURN_DIRTY', dirtyReturn.code, 'RETURN_DIRTY')
expect('남은 브랜치를 알려준다', dirtyReturn.leftOnBranch, AUTO_BRANCH)
expect('아무것도 지우지 않았다고 말한다', /지우지 않았다/.test(dirtyReturn.message), true)
expect('reset 을 부르지 않는다', dirtyCalls.some((c) => c.includes('reset')), false)
expect('강제 switch 를 하지 않는다', dirtyCalls.some((c) => c.includes('switch -f') || c.includes('checkout -f')), false)
expect('브랜치를 지우지 않는다', dirtyCalls.some((c) => c.includes('branch -D') || c.includes('branch -d')), false)

expect(
  '복귀 실패도 브랜치를 보존한다',
  returnToMain({
    exec: fakeExec({
      'git rev-parse --abbrev-ref HEAD': { out: AUTO_BRANCH },
      'git status --porcelain --untracked-files=no': { out: '' },
      'git switch main': { code: 1, err: 'error: could not switch' },
    }),
  }).leftOnBranch,
  AUTO_BRANCH,
)

/**
 * 🔴 **우리가 만들지 않은 브랜치를 main 으로 바꾸지 않는다.**
 *    `returnToMain` 을 무조건 부르면, `NOT_ON_MAIN` 으로 막힌 회차가 "복귀" 하겠다며
 *    사람이 체크아웃해 둔 브랜치를 갈아엎는다. 자동화는 **자기가 옮긴 것만** 되돌린다.
 *    실행 흐름 안의 조건이라 소스로 고정한다.
 */
const readySrc = readFileSync(join('scripts', 'magazine-auto-register-ready.mjs'), 'utf8')
expect('복귀는 movedOffMain 일 때만 부른다', /if \(write && movedOffMain\)/.test(readySrc), true)
expect('브랜치를 만든 뒤에만 movedOffMain 을 켠다', /branch = made\.name\s*\n\s*movedOffMain = true/.test(readySrc), true)
expect('movedOffMain 은 false 로 시작한다', /let movedOffMain = false/.test(readySrc), true)

console.log('\n══════ 변이 ⑥ lock — 두 회차가 겹치지 않는다')
const NOW = 1_000_000_000_000
const alive = () => true
const dead = () => false
expect('lock 이 없으면 잡는다', judgeLock({ existing: null, now: NOW, pidAlive: alive }).ok, true)
const held = judgeLock({ existing: { pid: 42, startedAt: NOW - 60_000 }, now: NOW, pidAlive: alive })
expect('살아 있는 lock 은 못 잡는다', held.ok, false)
expect('사유가 LOCK_HELD', held.code, 'LOCK_HELD')
const stale = judgeLock({ existing: { pid: 42, startedAt: NOW - 60_000 }, now: NOW, pidAlive: dead })
expect('죽은 lock 은 걷어낸다', stale.ok, true)
expect('걷어낸 것을 기록한다', stale.takeover, true)
expect(
  '오래됐어도 살아 있으면 뺏지 않는다',
  judgeLock({ existing: { pid: 42, startedAt: NOW - STALE_AFTER_MS - 1 }, now: NOW, pidAlive: alive }).code,
  'LOCK_STUCK',
)
expect('손상된 lock 은 통과시키지 않는다', judgeLock({ existing: {}, now: NOW, pidAlive: dead }).code, 'LOCK_CORRUPT')
expect('손상된 lock 을 "없는 것" 으로 보지 않는다', judgeLock({ existing: {}, now: NOW, pidAlive: dead }).ok, false)

console.log('\n══════ stage — 예상 파일만')
const want = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts']
expect('예상대로면 통과', stageCheck(want, want.join('\n')).ok, true)
expect('빈 staged 는 막는다', stageCheck(want, '').blockedBy[0].code, 'NOTHING_STAGED')
const extra = stageCheck(want, [...want, 'SoranSoran_Logo.png'].join('\n'))
expect('미추적이 섞이면 막는다', extra.blockedBy[0].code, 'UNEXPECTED_STAGED')
expect('무엇이 섞였는지 알려준다', extra.unexpected, ['SoranSoran_Logo.png'])

console.log('\n══════ 변이 ⑦ 종료 코드 — write 실패가 0 으로 끝나지 않는다')
/**
 * 🔴 옛 진입점은 무조건 exit 0 이었다. launchd 의 last exit status 가 언제나 0 이라
 *    PR 을 못 만든 회차와 정상 회차가 구분되지 않았다.
 */
expect('write 성공은 0', exitCodeFor({ write: true, childStatus: 0 }).code, 0)
expect('🔴 write 실패는 0 이 아니다', exitCodeFor({ write: true, childStatus: 1 }).code, 1)
expect('write 자식 코드를 그대로 넘긴다', exitCodeFor({ write: true, childStatus: 2 }).code, 2)
expect('write spawn 실패도 0 이 아니다', exitCodeFor({ write: true, spawnError: new Error('ENOENT'), childStatus: null }).code, 1)
expect('dry-run BLOCKED 는 0 이다', exitCodeFor({ write: false, childStatus: 1 }).code, 0)
expect('dry-run spawn 실패도 0 이다', exitCodeFor({ write: false, spawnError: new Error('ENOENT'), childStatus: null }).code, 0)

console.log('\n══════ 변이 ⑧ PR 실패 — push 된 사실을 숨기지 않는다')
/**
 * 🔴 `gh pr create` 가 실패하는 시점에는 commit·push 가 이미 끝나 있다.
 *    옛 판은 그것을 `made:false` 로만 남기고 종료 코드 0 으로 끝냈다.
 */
const { finishPr } = await import('./magazine-auto-register-ready.mjs')
const prFail = finishPr('feat/x', ['some-slug'], {
  exec: fakeExec({
    'git rev-parse --abbrev-ref HEAD': { out: 'feat/x' },
    'git diff --cached --name-only': { out: 'src/content/magazine/articles.ts\ndrafts/magazine/topic-queue.ts' },
    'gh pr create': { code: 1, err: 'HTTP 403' },
  }),
})
expect('PR 실패를 made:false 로 남긴다', prFail.made, false)
expect('🔴 push 됐다는 사실을 남긴다', prFail.pushed, true)
expect('브랜치가 origin 에 있다고 말한다', /origin 에 올라가 있다/.test(prFail.reason), true)

const pushFailed = finishPr('feat/x', ['some-slug'], {
  exec: fakeExec({
    'git rev-parse --abbrev-ref HEAD': { out: 'feat/x' },
    'git diff --cached --name-only': { out: 'src/content/magazine/articles.ts\ndrafts/magazine/topic-queue.ts' },
    'git push': { code: 1, err: 'fatal: Authentication failed' },
  }),
})
expect('push 실패는 pushed:false', pushFailed.pushed, false)

// 🔴 예상 밖 파일이 staged 면 커밋하지 않는다
const stagedCalls = []
const unexpectedStaged = finishPr('feat/x', ['some-slug'], {
  exec: (cmd, args) => {
    stagedCalls.push(`${cmd} ${args.join(' ')}`)
    return fakeExec({
      'git rev-parse --abbrev-ref HEAD': { out: 'feat/x' },
      'git diff --cached --name-only': { out: 'src/content/magazine/articles.ts\n.env.local' },
    })(cmd, args)
  },
})
expect('예상 밖 staged 면 PR 을 만들지 않는다', unexpectedStaged.made, false)
expect('예상 밖 staged 면 commit 하지 않는다', stagedCalls.some((c) => c.startsWith('git commit')), false)
expect('예상 밖 staged 는 되돌린다', stagedCalls.some((c) => c.startsWith('git restore --staged')), true)
expect('등록된 건이 없으면 PR 을 만들지 않는다', finishPr('feat/x', [], { exec: fakeExec({}) }).made, false)

console.log('\n══════ 변이 ⑨ 원고 관문 — tracked fixture 로 시험한다')
const FIXTURE_DRAFT = join(FIXTURES, 'manuscript-pass.draft.md')
expect('fixture 가 추적돼 있다', existsSync(FIXTURE_DRAFT), true)
const GOOD = readFileSync(FIXTURE_DRAFT, 'utf8')

expect('정상 원고는 통과', validateManuscript(GOOD).ok, true)
expect(`정상 원고 본문이 ${MIN_BODY_LENGTH}자 이상`, validateManuscript(GOOD).stats.bodyLength >= MIN_BODY_LENGTH, true)

const reason = (t) => validateManuscript(t).reasons.map((r) => r.code).sort()

expect('빈 원고는 막는다', reason(''), ['EMPTY'])
expect('공백만 있어도 막는다', reason('   \n  '), ['EMPTY'])
expect('frontmatter 가 없으면 막는다', reason(GOOD.replace(/^---\n/, '')).includes('NO_FRONTMATTER'), true)
expect('title 이 없으면 막는다', reason(GOOD.replace(/^title:.*$\n/m, '')).includes('META_MISSING'), true)
expect('cluster 가 없으면 막는다', reason(GOOD.replace(/^cluster:.*$\n/m, '')).includes('META_MISSING'), true)
expect('frontmatter 가 안 닫히면 막는다', reason(GOOD.replace(/\n---\n/, '\n')).includes('FRONTMATTER_UNCLOSED'), true)
expect('짧은 원고는 막는다', reason(['---', 'title: 짧음', 'description: 짧다', 'cluster: sleep', '---', '', '## 소제목', '', '한 줄.'].join('\n')).includes('TOO_SHORT'), true)
expect('한국어가 아니면 막는다', reason(GOOD.replace(/[가-힣]/g, 'a')).includes('NOT_KOREAN'), true)
expect('contentReference 오염을 막는다', reason(`${GOOD} :contentReference[oaicite:0]{index=0}`).includes('CONTAMINATED'), true)
expect('oaicite 오염을 막는다', reason(`${GOOD}\n[oaicite:3]`).includes('CONTAMINATED'), true)
expect('각주 마커 오염을 막는다', reason(`${GOOD}\n【4†source】`).includes('CONTAMINATED'), true)
expect('도구 호출 흔적을 막는다', reason(`${GOOD}\nturn0search1`).includes('CONTAMINATED'), true)
expect('원고 앞에 인사가 붙으면 막는다', reason(`물론입니다. 아래 원고입니다.\n${GOOD}`).includes('NO_FRONTMATTER'), true)
expect('zero-width 문자를 막는다', reason(`${GOOD}​`).includes('CONTAMINATED'), true)
expect('## 소제목이 없으면 막는다', reason(GOOD.replace(/^## .*$/gm, '문단.')).includes('NO_SECTION'), true)

/**
 * 🔴 오탐이 나면 재고가 멈춘다. 저장소에 있는 **모든** 추적 원고로 확인한다.
 *
 * 🔴 **알려진 진짜 양성** — 오탐이 아니다. 목록에 적어 두고 그 사실을 시험한다.
 *
 *    `after-holiday-body-ache/draft.md` 에는 ChatGPT 인용 마커가 아직 남아 있다.
 *    이 원고가 관문이 생긴 이유다 — 마커가 production 까지 새어 나갔고,
 *    `dea1c7a` (#299) 가 **articles.ts 의 본문만** 고쳤다. 원본 draft.md 는 그대로다.
 *    관문이 이것을 통과시키면 관문이 고장 난 것이므로, "막는다" 를 시험한다.
 *    (원본을 지금 고치지 않는다 — 이 PR 은 자동화 복구이고 콘텐츠 수정은 범위 밖이다)
 */
const KNOWN_CONTAMINATED = ['after-holiday-body-ache']

const draftRoot = join('drafts', 'magazine')
const realDrafts = readdirSync(draftRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => ({ slug: d.name, path: join(draftRoot, d.name, 'draft.md') }))
  .filter((d) => existsSync(d.path))
expect('추적된 실제 원고가 있다', realDrafts.length > 0, true)

const clean = realDrafts.filter((d) => !KNOWN_CONTAMINATED.includes(d.slug))
expect(
  `쓸 만한 원고 ${clean.length}건 중 관문 오탐 0건`,
  clean.filter((d) => !validateManuscript(readFileSync(d.path, 'utf8')).ok).map((d) => d.slug),
  [],
)
for (const slug of KNOWN_CONTAMINATED) {
  const path = join(draftRoot, slug, 'draft.md')
  if (!existsSync(path)) continue
  expect(`알려진 오염 원고는 여전히 막힌다: ${slug}`, validateManuscript(readFileSync(path, 'utf8')).reasons.map((r) => r.code), ['CONTAMINATED', 'CONTAMINATED'])
}

console.log('\n══════ 변이 ⑩ producer import 부작용 — import 만으로 회차가 돌지 않는다')
/**
 * 🔴 `magazine-producer-plan.mjs` 는 `selectItems` 를 export 하는데 `main()` 이
 *    무방비로 최상단에 있었다. 판정만 빌리려고 import 한 쪽이 실제 회차를 돌려
 *    `_runs/{date}/` 가 통째로 생기고 lock 까지 잡혔다 (2026-09-15).
 */
const runsDir = join(draftRoot, '_runs')
const snapshot = () => ({
  runs: existsSync(runsDir) ? readdirSync(runsDir).sort() : [],
  drafts: readdirSync(draftRoot).sort(),
})
const before = snapshot()
const planModule = await import('./magazine-producer-plan.mjs')
expect('import 해도 _runs 에 아무것도 생기지 않는다', snapshot().runs, before.runs)
expect('selectItems 는 그대로 빌려 쓸 수 있다', typeof planModule.selectItems, 'function')

// 🔴 파일을 쓰는 다른 CLI 도 같은 가드를 둔다. 하나라도 빠지면 같은 사고가 다시 난다.
for (const name of ['magazine-brief-auto', 'magazine-md-to-draft', 'magazine-packet']) {
  await import(`./${name}.mjs`)
  const src = readFileSync(join('scripts', `${name}.mjs`), 'utf8')
  expect(`${name}: 직접 실행 가드가 있다`, src.includes(`process.argv[1].endsWith('${name}.mjs')`), true)
}
expect('import 해도 drafts 에 새 디렉터리가 생기지 않는다', snapshot().drafts, before.drafts)
expect('import 해도 _runs 는 그대로다', snapshot().runs, before.runs)

console.log('\n══════ launchd — 템플릿이 정본이고, symlink 를 쓰지 않는다')
/**
 * 🔴 `~/Library/LaunchAgents` 의 symlink 가 ~/Documents 를 가리키면 TCC 가
 *    `smd` 의 plist 읽기를 거부한다 — 서비스가 **등록조차 되지 않는다.**
 *    2026-09-03 이후 12일간 두 job 이 죽어 있던 이유다.
 */
const TPL_DIR = join('docs', 'operations', 'launchd', 'magazine')
const producerTpl = join(TPL_DIR, 'com.soransoran.magazine-producer.plist.template')
const registerTpl = join(TPL_DIR, 'com.soransoran.magazine-auto-register.plist.template')
expect('producer 템플릿이 있다', existsSync(producerTpl), true)
expect('auto-register 템플릿이 있다', existsSync(registerTpl), true)
expect('옛 symlink 원본을 저장소에서 없앴다', existsSync(join('launchd', 'com.soransoran.magazine-producer.plist')), false)

const regTplText = readFileSync(registerTpl, 'utf8')
const prodTplText = readFileSync(producerTpl, 'utf8')
const regArgs = (regTplText.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/) ?? [, ''])[1]
expect('자동 PR 이 켜져 있다 (--write)', regArgs.includes('--write'), true)
expect('자동 PR 이 켜져 있다 (--pr)', regArgs.includes('--pr'), true)
// 🔴 자동 merge 는 어디에도 없어야 한다 — 이 경계가 이 레인의 전부다
// 🔴 인자 배열만 본다. 주석에는 "--founder-approved 는 이 경로에 없다" 같은 설명이 있다
expect('자동 merge 인자가 없다', /--merge|--auto-merge|--admin|--squash/.test(regArgs), false)
expect('--founder-approved 를 넘기지 않는다', regArgs.includes('--founder-approved'), false)
expect('auto-register PATH 가 통째로 치환된다', (regTplText.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/) ?? [, ''])[1], '__PATH__')
expect('producer 도 runtime worktree 를 쓴다', prodTplText.includes('__REPO__/scripts/magazine-producer-run.mjs'), true)
expect(
  'producer 주석이 4단계를 적는다',
  /magazine-webui-runner/.test(prodTplText) && /magazine-brief-auto/.test(prodTplText),
  true,
)
expect('KeepAlive 를 쓰지 않는다', /<key>KeepAlive<\/key>/.test(regTplText + prodTplText), false)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
console.log('  상태: 자동 PR 경로 구현됨 · launchd 설치는 supervised 1회 성공 뒤에만 열린다\n')
process.exit(fail === 0 ? 0 : 1)
