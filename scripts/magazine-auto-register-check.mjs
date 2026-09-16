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
import {
  AUTO_BRANCH_PREFIX, isAutoBranch, judgeOutstanding, readOutstanding, SEVERITY,
} from './lib/magazine-outstanding.mjs'
import { judgeProducerRun, stage } from './lib/magazine-producer-exit.mjs'
import { composeProducerMessage, runProducerFlow } from './lib/magazine-producer-flow.mjs'
import { exitCodeFor } from './lib/magazine-auto-exit.mjs'
import { parseHeroBlock, validateHeroBrief } from './lib/magazine-hero-brief.mjs'
import { loadQueue } from './lib/magazine-load.mjs'
import { verifyReviewShape } from './lib/magazine-brief-policy.mjs'
import { normalizePublishAt } from './magazine-register.mjs'

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

// ─────────────────────────────────────────────────────────
console.log('\n══════ P0-1 미해결 자동 작업 — 동시에 최대 1개')
/**
 * 🔴 **Day 1 에 PR 을 만들고 main 으로 복귀하면, Day 2 는 main 의 articles.ts 를 읽는다.**
 *    그 글은 아직 PR 안에만 있으므로 **같은 slug 를 같은 빈 슬롯으로 또 등록**한다.
 *    `register.mjs` 의 중복 가드는 main 만 보므로 이것을 막지 못한다 (Codex P0-1).
 */
const PRE = AUTO_BRANCH_PREFIX
const B1 = `${PRE}2026-09-16-020000`
const B2 = `${PRE}2026-09-17-020000`

// ① Day 1 — 미해결 0건이면 진행한다
const day1 = judgeOutstanding({ queryOk: true, prs: [], remoteBranches: [], localBranches: [] })
expect('Day1: 미해결이 없으면 진행', day1.ok, true)
expect('Day1: 코드가 CLEAR', day1.code, 'CLEAR')

// ② Day 2 — 그 PR 이 OPEN 이면 HOLD (정상)
const openPr = { number: 521, url: 'https://github.com/MogoKim/soransoran/pull/521', headRefName: B1, state: 'OPEN' }
const day2 = judgeOutstanding({ queryOk: true, prs: [openPr], remoteBranches: [B1], localBranches: [B1] })
expect('Day2: OPEN PR 이 있으면 진행하지 않는다', day2.ok, false)
expect('Day2: 코드가 OUTSTANDING_PR', day2.code, 'OUTSTANDING_PR')
expect('Day2: 정상 HOLD 로 구분한다', day2.severity, SEVERITY.HOLD)
expect('Day2: PR 번호를 남긴다', day2.pr.number, 521)
expect('Day2: PR URL 을 메시지에 남긴다', day2.message.includes(openPr.url), true)

// ③ 그 PR 이 MERGED 되면 다음 회차가 진행된다 — 🔴 squash merge 여도
//    (commit ancestry 가 아니라 GitHub 의 state 를 본다. 로컬 브랜치가 남아 있어도 해소다)
const day3 = judgeOutstanding({
  queryOk: true,
  prs: [{ ...openPr, state: 'MERGED' }],
  remoteBranches: [],
  localBranches: [B1], // squash merge 후에도 로컬 브랜치는 남는다 — 우리는 지우지 않는다
})
expect('Day3: MERGED 면 진행한다', day3.ok, true)
expect('Day3: 로컬 잔존 브랜치를 오판하지 않는다', day3.code, 'CLEAR')
expect('Day3: merge 건수를 말한다', day3.message.includes('1건'), true)

// ④ push 성공 · PR 생성 실패 → 다음 날 차단 (운영 실패)
const orphanRemote = judgeOutstanding({ queryOk: true, prs: [], remoteBranches: [B1], localBranches: [B1] })
expect('push 됐는데 PR 이 없으면 차단', orphanRemote.ok, false)
expect('사유가 ORPHAN_REMOTE_BRANCH', orphanRemote.code, 'ORPHAN_REMOTE_BRANCH')
expect('🔴 운영 실패로 본다 (non-zero)', orphanRemote.severity, SEVERITY.FAILURE)
expect('어떤 브랜치인지 말한다', orphanRemote.branches, [B1])

// ⑤ push 조차 실패해 로컬에만 남은 브랜치
const orphanLocal = judgeOutstanding({ queryOk: true, prs: [], remoteBranches: [], localBranches: [B1] })
expect('로컬에만 남은 자동 브랜치도 차단', orphanLocal.code, 'ORPHAN_LOCAL_BRANCH')
expect('로컬 orphan 도 운영 실패', orphanLocal.severity, SEVERITY.FAILURE)

// ⑥ GitHub 을 못 읽으면 fail closed
const blind = judgeOutstanding({ queryOk: false })
expect('조회 실패면 진행하지 않는다 (fail closed)', blind.ok, false)
expect('사유가 GITHUB_QUERY_FAILED', blind.code, 'GITHUB_QUERY_FAILED')
expect('조회 실패는 운영 실패', blind.severity, SEVERITY.FAILURE)
expect('🔴 "미해결 없음" 으로 넘기지 않는다', blind.code === 'CLEAR', false)

// ⑦ CLOSED(미merge) 정책 — 브랜치가 남아 있으면 HOLD, 지우면 해소
const closedWithBranch = judgeOutstanding({
  queryOk: true,
  prs: [{ ...openPr, state: 'CLOSED' }],
  remoteBranches: [B1],
  localBranches: [],
})
expect('CLOSED 인데 브랜치가 남으면 HOLD', closedWithBranch.code, 'ABANDONED_PR_BRANCH')
expect('CLOSED 잔존은 정상 HOLD', closedWithBranch.severity, SEVERITY.HOLD)
expect('브랜치를 지우라고 말한다', /브랜치를 지운다/.test(closedWithBranch.message), true)
const closedNoBranch = judgeOutstanding({
  queryOk: true,
  prs: [{ ...openPr, state: 'CLOSED' }],
  remoteBranches: [],
  localBranches: [],
})
expect('CLOSED + 브랜치 삭제 = 명시적 폐기로 해소', closedNoBranch.ok, true)

// ⑧ 자동 레인 브랜치만 본다 — 사람 브랜치는 무시
const humanBranch = judgeOutstanding({
  queryOk: true,
  prs: [{ number: 9, url: 'u', headRefName: 'fix/something-else', state: 'OPEN' }],
  remoteBranches: ['fix/something-else'],
  localBranches: ['main', 'fix/something-else'],
})
expect('사람 브랜치·PR 은 레인을 막지 않는다', humanBranch.ok, true)
expect('접두 판정이 정확하다', isAutoBranch(B2) && !isAutoBranch('feat/other'), true)

// ⑨ 여러 자동 PR 중 OPEN 이 하나라도 있으면 HOLD
const mixed = judgeOutstanding({
  queryOk: true,
  prs: [{ ...openPr, state: 'MERGED' }, { number: 522, url: 'u2', headRefName: B2, state: 'OPEN' }],
  remoteBranches: [B2],
  localBranches: [B1, B2],
})
expect('MERGED 가 있어도 OPEN 하나면 HOLD', mixed.code, 'OUTSTANDING_PR')
expect('그 OPEN PR 을 지목한다', mixed.pr.number, 522)

console.log('\n══════ P0-1 reader — gh 조회 실패는 fail closed')
/** 🔴 실제 gh·git 을 부르지 않는다 */
const ghList = 'gh pr list'
expect(
  'gh 가 실패하면 조회 실패로 넘긴다',
  readOutstanding({ exec: fakeExec({ [ghList]: { code: 1, err: 'HTTP 503' } }) }).code,
  'GITHUB_QUERY_FAILED',
)
expect(
  'gh 출력이 JSON 이 아니면 조회 실패',
  readOutstanding({ exec: fakeExec({ [ghList]: { out: 'not json' } }) }).code,
  'GITHUB_QUERY_FAILED',
)
expect(
  'ls-remote 실패도 조회 실패',
  readOutstanding({ exec: fakeExec({ [ghList]: { out: '[]' }, 'git ls-remote': { code: 128 } }) }).code,
  'GITHUB_QUERY_FAILED',
)
expect(
  'git branch --list 실패도 조회 실패',
  readOutstanding({ exec: fakeExec({ [ghList]: { out: '[]' }, 'git branch --list': { code: 128 } }) }).code,
  'GITHUB_QUERY_FAILED',
)
const readOk = readOutstanding({
  exec: fakeExec({ [ghList]: { out: JSON.stringify([{ ...openPr, state: 'MERGED' }]) } }),
})
expect('전부 읽히면 판정이 나온다', readOk.code, 'CLEAR')
const readOpen = readOutstanding({
  exec: fakeExec({
    [ghList]: { out: JSON.stringify([openPr]) },
    'git ls-remote': { out: `abc123\trefs/heads/${B1}` },
    'git branch --list': { out: B1 },
  }),
})
expect('열린 PR 을 실제로 잡는다', readOpen.code, 'OUTSTANDING_PR')
// 🔴 --state all 이어야 MERGED 를 해소로 볼 수 있다
let ghArgs = []
readOutstanding({ exec: (cmd, args) => { if (cmd === 'gh') ghArgs = args; return { code: 0, out: '[]', err: '' } } })
expect('gh 를 --state all 로 부른다', ghArgs.includes('--state') && ghArgs[ghArgs.indexOf('--state') + 1] === 'all', true)
expect('PR state 를 받아온다', ghArgs.join(' ').includes('state'), true)

console.log('\n══════ P0-1 배선 — 쓰기·AI 호출·브랜치보다 앞이다')
expect('auto-register 가 같은 판정을 쓴다', readySrc.includes("from './lib/magazine-outstanding.mjs'"), true)
// 🔴 outstanding 검사가 createBranch 보다 **앞**이어야 한다
expect(
  'outstanding 이 브랜치 생성보다 앞이다',
  readySrc.indexOf('readOutstanding({ exec })') < readySrc.indexOf('createBranch(branchName()'),
  true,
)
expect(
  'outstanding 이 drive() 호출보다 앞이다',
  readySrc.indexOf('readOutstanding({ exec })') < readySrc.indexOf('drive(cand.slug'),
  true,
)
expect('HOLD 는 종료 코드 0 으로 낸다', /finish\(out\.severity === SEVERITY\.HOLD \? 0 : 1\)/.test(readySrc), true)
// 🔴 **슬롯 계산이 열린 PR 을 무시한 채 돌 수 없어야 한다.**
//    HOLD 면 slotAllocator 에 닿기 전에 회차가 끝난다.
expect(
  'outstanding 이 슬롯 계산보다 앞이다',
  readySrc.indexOf('readOutstanding({ exec })') < readySrc.indexOf('slotAllocator(kstDate('),
  true,
)

console.log('\n══════ P0-1 슬롯 — merge 된 뒤에는 다음 빈 10:30 KST 로 간다')
/**
 * 🔴 Day 1 PR 이 merge 되면 main 의 articles.ts 에 그 날짜가 들어간다.
 *    그러면 다음 회차의 슬롯 계산이 **그 날을 건너뛴다.** merge 전에는 건너뛰지 못하고,
 *    그래서 HOLD 로 아예 시작하지 않는 것이다.
 */
const { slotAllocator, CONSUMES_SLOT } = await import('./magazine-auto-register-ready.mjs')

// 연속으로 등록되면 하루씩 증가한다 (commit 한 만큼만)
{
  const s = slotAllocator('2026-09-18')
  const picked = [s.commit(), s.commit(), s.commit()]
  expect('등록되면 하루씩 증가한다', picked, ['2026-09-18', '2026-09-19', '2026-09-20'])
  expect('같은 날짜를 두 번 주지 않는다', new Set(picked).size, picked.length)
  expect('날짜는 10:30 KST 로 굳는다', normalizePublishAt(picked[0]).publishAt, '2026-09-18T10:30:00+09:00')
}
// 실제 재고와 겹치지 않는다 — 9/17 까지 차 있으므로 9/18 부터가 맞다
expect('이미 찬 날짜는 건너뛴다', slotAllocator('2026-09-10').peek(), '2026-09-18')

console.log('\n══════ 🔴 슬롯 버그 — 막힌 후보가 빈 예약일을 태우지 않는다')
/**
 * 🔴 **실측 버그** (2026-09-16). 옛 판은 부를 때마다 날짜를 **소비**했다.
 *
 *      1) dinner-change-two-weeks  QA_FAIL  → 9/18 소비 🔴
 *      2) after-menopause-body     DONE     → 9/19 배정
 *      3) cold-weather-joint-pain  QA_FAIL  → 9/20 소비 🔴
 *
 *    등록은 하나인데 빈 날짜 셋이 사라졌다. 9/18 이 비어 있는데 성공한 글이 9/19 로 밀렸다.
 */
// ① peek 은 소비하지 않는다 — 몇 번을 불러도 같은 값
{
  const s = slotAllocator('2026-09-18')
  expect('peek 은 소비하지 않는다', [s.peek(), s.peek(), s.peek()], ['2026-09-18', '2026-09-18', '2026-09-18'])
}
// ② 실제 사고 재현 — 첫 후보가 BLOCKED 면 두 번째가 **같은 최초 빈 날짜**를 받는다
{
  const s = slotAllocator('2026-09-18')
  const assign = (verdict) => { const d = s.peek(); if (CONSUMES_SLOT.has(verdict)) s.commit(); return d }
  const a = assign('BLOCKED')   // dinner-change-two-weeks
  const b = assign('DONE')      // after-menopause-body
  const c = assign('BLOCKED')   // cold-weather-joint-pain
  expect('🔴 BLOCKED 가 날짜를 태우지 않는다', a, '2026-09-18')
  expect('🔴 다음 DONE 이 같은 최초 빈 날짜를 받는다', b, '2026-09-18')
  expect('그 뒤 BLOCKED 도 날짜를 태우지 않는다', c, '2026-09-19')
  expect('실제로 확정된 날짜는 하나뿐이다', s.peek(), '2026-09-19')
}
// ③ BLOCKED 가 연속돼도 날짜가 소모되지 않는다
{
  const s = slotAllocator('2026-09-18')
  const assign = (v) => { const d = s.peek(); if (CONSUMES_SLOT.has(v)) s.commit(); return d }
  const picked = [assign('BLOCKED'), assign('BLOCKED'), assign('BLOCKED'), assign('DONE')]
  expect('BLOCKED 가 연속돼도 날짜가 그대로다', picked, ['2026-09-18', '2026-09-18', '2026-09-18', '2026-09-18'])
  expect('그 다음 빈 날짜는 하루만 전진한다', s.peek(), '2026-09-19')
}
// ④ DONE 이 연속되면 중복 없이 하루씩
{
  const s = slotAllocator('2026-09-18')
  const assign = (v) => { const d = s.peek(); if (CONSUMES_SLOT.has(v)) s.commit(); return d }
  const picked = [assign('DONE'), assign('DONE'), assign('DONE')]
  expect('DONE 연속은 하루씩 증가', picked, ['2026-09-18', '2026-09-19', '2026-09-20'])
  expect('중복 0', new Set(picked).size, 3)
}
// ⑤ dry-run 과 write 의 배정이 같아야 한다
expect('DONE 은 슬롯을 쓴다', CONSUMES_SLOT.has('DONE'), true)
expect('DRY_RUN_OK 도 슬롯을 쓴다 (dry-run 이 write 와 같은 날짜를 보여야 한다)', CONSUMES_SLOT.has('DRY_RUN_OK'), true)
expect('🔴 BLOCKED 는 슬롯을 쓰지 않는다', CONSUMES_SLOT.has('BLOCKED'), false)
expect('DRY_RUN_INCOMPLETE 는 쓰지 않는다 (등록 가능 여부를 아직 모른다)', CONSUMES_SLOT.has('DRY_RUN_INCOMPLETE'), false)
{
  // 같은 판정 나열이면 dry-run 과 write 가 **같은 날짜**를 낸다
  const run = (verdicts) => {
    const s = slotAllocator('2026-09-18')
    return verdicts.map((v) => { const d = s.peek(); if (CONSUMES_SLOT.has(v)) s.commit(); return d })
  }
  expect('dry-run 배정과 write 배정이 일치한다', run(['BLOCKED', 'DRY_RUN_OK', 'BLOCKED']), run(['BLOCKED', 'DONE', 'BLOCKED']))
}
// ⑥ 이미 찬 날짜는 계속 건너뛴다
{
  const s = slotAllocator('2026-09-10')
  expect('과거 빈 날짜를 요구해도 찬 날은 건너뛴다', s.commit(), '2026-09-18')
  expect('그 다음도 이어서 전진한다', s.commit(), '2026-09-19')
}
// 🔴 호출부가 정말 peek/commit 을 쓰는가 — 옛 소비형 호출이 되살아나면 버그가 돌아온다
expect('호출부가 peek 으로 고른다', /const publishAt = slots\.peek\(\)/.test(readySrc), true)
expect('등록되는 후보만 commit 한다', /if \(CONSUMES_SLOT\.has\(r\.verdict\)\) slots\.commit\(\)/.test(readySrc), true)
expect('옛 소비형 호출이 없다', /nextSlot\(\)/.test(readySrc), false)

/**
 * 🔴 **순서는 소스 위치가 아니라 흐름으로 시험한다** (2026-09-16 재검토에서 배운 것).
 *
 *    옛 판은 `indexOf('readOutstanding') < indexOf('spawnSync(NODE, [PLAN]')` 같은
 *    문자열 위치 비교로 "앞이다" 를 확인했다. 그 방식은 **도달 여부를 보지 못한다** —
 *    실제로 `runNotify()` 는 소스상 앞에 있었는데 두 경로가 그 줄에 닿지 못했다.
 *
 *    그래서 "무엇이 앞이다" 는 위의 `P0-3 알림 계약` 묶음이 **주입한 흐름을 돌려서**
 *    증명한다 — HOLD·NOT_ON_MAIN·TOOL_MISSING 에서 `calls.plan/brief/fetch` 가 0 이다.
 *    여기서는 **배선만** 본다: producer-run 이 그 흐름에 실제로 연결돼 있는가.
 */
const producerSrc = readFileSync(join('scripts', 'magazine-producer-run.mjs'), 'utf8')
expect('producer 가 같은 미해결 판정을 쓴다', producerSrc.includes("from './lib/magazine-outstanding.mjs'"), true)
expect('producer 가 단일 finalizer 흐름에 연결돼 있다', producerSrc.includes('runProducerFlow({'), true)
expect('producer 가 흐름에 checkTools 를 준다', /checkTools: \(\) => preflightTools/.test(producerSrc), true)
expect('producer 가 흐름에 checkGit 을 준다', /checkGit: \(\) => preflight\(/.test(producerSrc), true)
expect('producer 가 흐름에 checkOutstanding 을 준다', /checkOutstanding: \(\) => readOutstanding/.test(producerSrc), true)
expect('producer 가 흐름에 notify 를 준다', /notify: notifyOnce/.test(producerSrc), true)
// 🔴 옛 결함의 화석 — 시작 전 검사의 중간 exit 가 되살아나면 알림 계약이 다시 깨진다
expect('시작 전 검사에 중간 process.exit 가 없다', /process\.exit\(1\)/.test(producerSrc), false)

// ─────────────────────────────────────────────────────────
console.log('\n══════ P0-2 producer 종료 코드 — 실패를 성공으로 숨기지 않는다')
/**
 * 🔴 옛 판은 brief·fetch 실패를 삼키고 planCode 만 돌려줬다.
 *    ChatGPT 로그인이 만료돼 원고를 한 건도 못 받아도 exit 0 이었다 (Codex P0-2).
 */
const okStage = (name) => stage(name, { status: 0 })
const allOk = { plan: okStage('plan'), brief: okStage('brief'), fetch: okStage('fetch') }
expect('전부 정상이면 0', judgeProducerRun(allOk).code, 0)
expect('판정이 OK', judgeProducerRun(allOk).verdict, 'OK')

// 원고 회수 전역 실패 = ChatGPT 접근 실패 · 브라우저 시작 실패
const fetchFatal = judgeProducerRun({ ...allOk, fetch: stage('fetch', { status: 1 }) })
expect('🔴 원고 회수 전역 실패는 exit 1', fetchFatal.code, 1)
expect('SYSTEM 으로 분류한다', fetchFatal.verdict, 'SYSTEM')
expect('ChatGPT·브라우저를 지목한다', /ChatGPT|브라우저/.test(fetchFatal.reason), true)

expect(
  '🔴 회수기를 띄우지 못해도 exit 1',
  judgeProducerRun({ ...allOk, fetch: stage('fetch', { spawnError: 'ENOENT' }) }).code,
  1,
)
expect(
  '🔴 brief 생성을 실행하지 못하면 exit 1 (claude 부재)',
  judgeProducerRun({ ...allOk, brief: stage('brief', { spawnError: 'ENOENT' }) }).code,
  1,
)
expect(
  'brief 사용법/시스템 오류(2)도 exit 1',
  judgeProducerRun({ ...allOk, brief: stage('brief', { status: 2 }) }).code,
  1,
)
expect('plan 실패는 exit 1', judgeProducerRun({ ...allOk, plan: stage('plan', { status: 1 }) }).code, 1)
// 🔴 dry-run 은 세 단계를 전부 건너뛴다 — status 가 null 이지만 실패가 아니다.
//    이 가드가 없으면 dry-run 이 매 회차 SYSTEM 으로 붉게 뜬다 (실제로 그랬다).
const allSkipped = { plan: stage('plan', { skipped: true }), brief: stage('brief', { skipped: true }), fetch: stage('fetch', { skipped: true }) }
expect('dry-run(전부 skip)은 0', judgeProducerRun(allSkipped).code, 0)
expect('dry-run 은 OK 로 본다', judgeProducerRun(allSkipped).verdict, 'OK')
expect('skip 을 실패로 세지 않는다', judgeProducerRun(allSkipped).failures, [])
expect(
  'plan 을 띄우지 못해도 exit 1',
  judgeProducerRun({ ...allOk, plan: stage('plan', { spawnError: 'ENOENT' }) }).code,
  1,
)

// 🔴 일부 slug 만 게이트에 막힌 것은 **실패가 아니다** — 매일 붉은 불이 켜지면 의미가 사라진다
const contentOnly = judgeProducerRun({ ...allOk, brief: stage('brief', { status: 1 }) })
expect('일부 건이 게이트에 막힌 것은 0', contentOnly.code, 0)
expect('CONTENT 로 구분한다', contentOnly.verdict, 'CONTENT')
expect('시스템 실패와 섞지 않는다', contentOnly.failures, [])

// 미해결 판정이 먼저다
expect(
  'HOLD 는 실패가 아니다 (exit 0)',
  judgeProducerRun({ ...allOk, outstanding: { code: 'OUTSTANDING_PR', severity: SEVERITY.HOLD } }).code,
  0,
)
expect(
  'HOLD 판정을 그대로 남긴다',
  judgeProducerRun({ ...allOk, outstanding: { code: 'OUTSTANDING_PR', severity: SEVERITY.HOLD } }).verdict,
  'HOLD',
)
expect(
  '조회 실패·orphan 은 exit 1',
  judgeProducerRun({ ...allOk, outstanding: { code: 'GITHUB_QUERY_FAILED', severity: SEVERITY.FAILURE } }).code,
  1,
)

// 🔴 Slack 은 판정에 없다 — 알림 실패가 원래 실패를 성공으로 바꾸지 못한다
expect('판정 입력에 slack 이 없다', Object.keys(allOk).includes('slack'), false)
// 🔴 "알림을 반드시 시도한다 · 알림이 판정을 바꾸지 않는다" 는 아래 `P0-3` 묶음이
//    주입한 흐름을 돌려서 증명한다 (calls.notify === 1 · Slack 실패에도 exit 유지).
//    여기서는 종료가 판정 결과로 이뤄지는지만 본다.
expect('판정 결과로 종료한다 (planCode 가 아니다)', /process\.exit\(result\.code\)/.test(producerSrc), true)
expect('planCode 를 그대로 반환하던 코드가 없다', /process\.exit\(planCode\)/.test(producerSrc), false)
expect('종료 경로가 하나다', (producerSrc.match(/process\.exit\(/g) ?? []).length, 1)

// ─────────────────────────────────────────────────────────
console.log('\n══════ P0-3 알림 계약 — 흐름을 실제로 돌려서 시험한다')
/**
 * 🔴 **왜 이 묶음이 생겼나** (2026-09-16 Codex 재검토).
 *
 *    직전 판은 "실패 회차에서도 Slack 을 반드시 시도한다" 고 적고, 정작
 *    `preflightTools` 실패와 `git preflight` 실패가 그 앞에서 `process.exit(1)` 했다.
 *    회귀 테스트는 있었지만 **소스에서 `runNotify()` 의 위치만** 봤다 —
 *    그 줄에 **도달하지 못하는 경로**는 아무도 보지 않았다.
 *
 *    그래서 여기서는 위치를 보지 않는다. **주입한 흐름을 실제로 돌리고**
 *    무엇이 불렸는지·무엇이 안 불렸는지·종료 코드가 무엇인지를 본다.
 */
const OK_STAGE = { spawnError: null, status: 0 }

/** 호출을 기록하는 가짜 deps. 🔴 실제 git·gh·claude·브라우저·Slack 을 부르지 않는다 */
function makeDeps(over = {}) {
  const calls = { notify: 0, plan: 0, brief: 0, fetch: 0 }
  const sent = []
  const deps = {
    log: () => {},
    checkTools: () => ({ ok: true }),
    checkGit: () => ({ ok: true }),
    checkOutstanding: () => ({ ok: true, code: 'CLEAR', message: '없음' }),
    runPlan: () => { calls.plan += 1; return OK_STAGE },
    runBrief: () => { calls.brief += 1; return OK_STAGE },
    runFetch: () => { calls.fetch += 1; return OK_STAGE },
    notify: (ctx) => { calls.notify += 1; sent.push(ctx); return { ok: true } },
    ...over,
  }
  return { deps, calls, sent }
}

const TOOLS_FAIL = { ok: false, blockedBy: [{ code: 'TOOL_MISSING', message: 'claude 를 실행할 수 없다 (producer 의 brief 생성) — launchd PATH 에 없다' }] }
const NOT_ON_MAIN = { ok: false, blockedBy: [{ code: 'NOT_ON_MAIN', message: '현재 브랜치가 feat/x 다 — write 는 main 에서만 시작한다' }] }
const DIRTY = { ok: false, blockedBy: [{ code: 'DIRTY_TREE', message: '추적 파일 변경 3건 — write 는 깨끗한 트리에서만 시작한다' }] }

// ── ① claude·gh 누락 ────────────────────────────────────
{
  const { deps, calls } = makeDeps({ checkTools: () => TOOLS_FAIL })
  const r = await runProducerFlow({ deps })
  expect('도구 누락: exit 1', r.code, 1)
  expect('도구 누락: SYSTEM', r.verdict, 'SYSTEM')
  expect('🔴 도구 누락: Slack 을 한 번 시도한다', calls.notify, 1)
  expect('도구 누락: plan(파일 write) 0회', calls.plan, 0)
  expect('도구 누락: brief(AI 호출) 0회', calls.brief, 0)
  expect('도구 누락: fetch(브라우저) 0회', calls.fetch, 0)
  expect('도구 누락: 실행한 단계 0개', r.ran, [])
  expect('도구 누락: 사유를 보존한다', r.failures, ['TOOL_MISSING'])
}

// ── ② NOT_ON_MAIN ───────────────────────────────────────
{
  const { deps, calls, sent } = makeDeps({ checkGit: () => NOT_ON_MAIN })
  const r = await runProducerFlow({ deps })
  expect('NOT_ON_MAIN: exit 1', r.code, 1)
  expect('🔴 NOT_ON_MAIN: Slack 을 한 번 시도한다', calls.notify, 1)
  expect('NOT_ON_MAIN: write·AI 0회', [calls.plan, calls.brief, calls.fetch], [0, 0, 0])
  expect('NOT_ON_MAIN: 판정을 알림에 넘긴다', sent[0].verdict.code, 1)
  expect('NOT_ON_MAIN: preflight 단계를 알림에 넘긴다', sent[0].preflight.stage, 'git')
  expect('NOT_ON_MAIN: 사유를 보존한다', r.failures, ['NOT_ON_MAIN'])
}

// ── ③ DIRTY_TREE ────────────────────────────────────────
{
  const { deps, calls } = makeDeps({ checkGit: () => DIRTY })
  const r = await runProducerFlow({ deps })
  expect('DIRTY_TREE: exit 1', r.code, 1)
  expect('🔴 DIRTY_TREE: Slack 을 한 번 시도한다', calls.notify, 1)
  expect('DIRTY_TREE: write·AI 0회', [calls.plan, calls.brief, calls.fetch], [0, 0, 0])
  expect('DIRTY_TREE: 사유를 보존한다', r.failures, ['DIRTY_TREE'])
}

// ── ④ Slack 자체 실패 → 원래 exit code 유지 ──────────────
{
  const { deps, calls } = makeDeps({
    checkGit: () => NOT_ON_MAIN,
    notify: () => { calls0.notify += 1; return { ok: false, reason: 'webhook 500' } },
  })
  const calls0 = calls
  const r = await runProducerFlow({ deps })
  expect('🔴 Slack 실패해도 exit 1 그대로', r.code, 1)
  expect('Slack 실패를 기록한다', r.notify.ok, false)
  expect('Slack 실패가 판정을 바꾸지 않는다', r.verdict, 'SYSTEM')
}
{
  // 알림이 **던져도** 회차 판정은 그대로다
  const { deps } = makeDeps({ checkGit: () => NOT_ON_MAIN, notify: () => { throw new Error('ENOTFOUND') } })
  const r = await runProducerFlow({ deps })
  expect('🔴 Slack 이 예외를 던져도 exit 1 그대로', r.code, 1)
  expect('예외를 삼키고 사유를 남긴다', /ENOTFOUND/.test(r.notify.reason), true)
}
{
  // 반대 방향 — 알림 실패가 성공 회차를 실패로 만들지 않는다
  const { deps } = makeDeps({ notify: () => ({ ok: false, reason: 'webhook 500' }) })
  const r = await runProducerFlow({ deps })
  expect('🔴 Slack 실패가 성공 회차를 실패로 만들지 않는다', r.code, 0)
}

// ── ⑤ OUTSTANDING_PR → exit 0 HOLD · PR URL 포함 ─────────
const HOLD_PR = { number: 521, url: 'https://github.com/MogoKim/soransoran/pull/521', headRefName: `${PRE}2026-09-16-020000`, state: 'OPEN' }
const HOLD = { ok: false, code: 'OUTSTANDING_PR', severity: SEVERITY.HOLD, pr: HOLD_PR, message: `자동 PR #521 이 아직 열려 있다 (${HOLD_PR.url})` }
{
  const { deps, calls, sent } = makeDeps({ checkOutstanding: () => HOLD })
  const r = await runProducerFlow({ deps })
  expect('HOLD: exit 0 (정상)', r.code, 0)
  expect('HOLD: 판정이 HOLD', r.verdict, 'HOLD')
  expect('🔴 HOLD: Slack 을 한 번 시도한다', calls.notify, 1)
  expect('HOLD: write·AI 0회', [calls.plan, calls.brief, calls.fetch], [0, 0, 0])

  const msg = composeProducerMessage(sent[0])
  expect('🔴 HOLD 문구에 PR 번호가 있다', msg.title.includes('#521'), true)
  expect('🔴 HOLD 문구에 PR URL 이 있다', msg.next, HOLD_PR.url)
  expect('🔴 HOLD 문구에 "merge 또는 명시적 폐기" 가 있다', /merge 또는 명시적 폐기 전 다음 생산 HOLD/.test(msg.reason), true)
  expect('HOLD 는 ERROR 로 보내지 않는다', msg.severity, 'INFO')
}
{
  // orphan 은 HOLD 가 아니라 실패다
  const ORPHAN = { ok: false, code: 'ORPHAN_REMOTE_BRANCH', severity: SEVERITY.FAILURE, pr: null, message: 'origin 에 PR 없는 자동 브랜치가 있다' }
  const { deps, calls, sent } = makeDeps({ checkOutstanding: () => ORPHAN })
  const r = await runProducerFlow({ deps })
  expect('orphan: exit 1', r.code, 1)
  expect('orphan: Slack 을 한 번 시도한다', calls.notify, 1)
  expect('orphan 문구는 ERROR', composeProducerMessage(sent[0]).severity, 'ERROR')
}

// ── ⑥ 정상 회차 — 기존 동작 유지 ─────────────────────────
{
  const { deps, calls } = makeDeps()
  const r = await runProducerFlow({ deps })
  expect('정상: exit 0', r.code, 0)
  expect('정상: 판정 OK', r.verdict, 'OK')
  expect('정상: plan·brief·fetch 를 전부 돈다', [calls.plan, calls.brief, calls.fetch], [1, 1, 1])
  expect('정상: 알림도 한 번', calls.notify, 1)
  expect('정상: 실행 단계를 기록한다', r.ran, ['plan', 'brief', 'fetch'])
}
{
  // 회수기 전역 실패 — 단계는 돌았고, 실패는 실패다
  const { deps, calls } = makeDeps({ runFetch: () => ({ spawnError: null, status: 1 }) })
  const r = await runProducerFlow({ deps })
  expect('회수 전역 실패: exit 1', r.code, 1)
  expect('회수 전역 실패: 알림 한 번', calls.notify, 1)
  expect('ChatGPT·브라우저를 지목한다', /ChatGPT|브라우저/.test(r.reason), true)
}
{
  // 일부만 게이트에 막힘 — 실패가 아니다
  const { deps } = makeDeps({ runBrief: () => ({ spawnError: null, status: 1 }) })
  const r = await runProducerFlow({ deps })
  expect('일부 게이트 차단: exit 0', r.code, 0)
  expect('일부 게이트 차단: CONTENT', r.verdict, 'CONTENT')
}
{
  // plan 이 실패하면 brief·fetch 를 돌리지 않는다
  const { deps, calls } = makeDeps({ runPlan: () => ({ spawnError: null, status: 1 }) })
  const r = await runProducerFlow({ deps })
  expect('plan 실패: exit 1', r.code, 1)
  expect('plan 실패: brief·fetch 를 돌리지 않는다', [calls.brief, calls.fetch], [0, 0])
  expect('plan 실패: 알림 한 번', calls.notify, 1)
}

// ── ⑦ dry-run — 검사도 단계도 돌지 않고, 알림은 dry 로 넘어간다 ──
{
  const { deps, calls, sent } = makeDeps({
    checkTools: () => { throw new Error('dry-run 에서 불리면 안 된다') },
    checkGit: () => { throw new Error('dry-run 에서 불리면 안 된다') },
    checkOutstanding: () => { throw new Error('dry-run 에서 불리면 안 된다') },
  })
  const r = await runProducerFlow({ dryRun: true, deps })
  expect('dry-run: exit 0', r.code, 0)
  expect('dry-run: 단계를 하나도 돌지 않는다', [calls.plan, calls.brief, calls.fetch], [0, 0, 0])
  expect('dry-run: 알림은 한 번 시도', calls.notify, 1)
  expect('🔴 dry-run 임을 알림에 넘긴다 (실제 발송 금지)', sent[0].dryRun, true)
}

// ── ⑧ 종료 경로는 하나다 — 알림은 회차당 정확히 한 번 ────
{
  const { deps, calls } = makeDeps({ checkTools: () => TOOLS_FAIL })
  await runProducerFlow({ deps })
  expect('중단 회차에서도 알림은 정확히 1회', calls.notify, 1)
}

console.log('\n══════ P0-3 auto-register HOLD 알림 — PR URL 을 포함한다')
expect('HOLD 알림이 PR 을 지목한다', readySrc.includes('report.outstanding?.pr'), true)
expect('HOLD 알림 제목에 PR 번호가 들어간다', /자동 PR #\$\{holdPr\.number\}/.test(readySrc), true)
expect('HOLD 알림 next 가 PR URL 이다', /next: holdPr\.url/.test(readySrc), true)
expect('HOLD 알림에 "merge 또는 명시적 폐기" 문구', /merge 또는 명시적 폐기 전 다음 생산 HOLD/.test(readySrc), true)
expect('dry-run 은 실제로 보내지 않는다', /send\(msg, \{ dryRun: !actuallySend \}\)/.test(readySrc), true)

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
