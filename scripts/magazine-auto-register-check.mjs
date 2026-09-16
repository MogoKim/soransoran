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

console.log('\n══════ P0-1 슬롯 — 고정 fixture 로 시험한다 (실제 재고와 무관)')
/**
 * 🔴 **왜 fixture 인가** (2026-09-16 회귀 보정).
 *
 *    옛 판은 실제 `articles.ts` 를 읽으면서 기대값을 `2026-09-18` 로 하드코딩했다.
 *    #524 가 merge 되어 9/18 이 차는 순간 **13건이 무더기로 깨졌다** — 로직은 멀쩡한데.
 *    재고는 매일 바뀐다. 그 테스트는 내일도 모레도 깨진다.
 *
 *    날짜 규칙을 시험하려면 **날짜를 고정**해야 한다. 점유 Set 을 주입한다.
 *    실제 재고를 쓰는 검사는 아래 `integration` 묶음에서 **동적으로** 계산한다.
 */
const { slotAllocator, CONSUMES_SLOT, takenDates } = await import('./magazine-auto-register-ready.mjs')

/** 🔴 9/16·9/17 이 차 있는 고정 상황. 실제 저장소 내용과 무관하다 */
const TAKEN = ['2026-09-16', '2026-09-17']
const FROM = '2026-09-16'
const slots = (taken = TAKEN) => slotAllocator(FROM, { taken })
/** 판정 나열을 날짜 배정으로 바꾼다 — 호출부와 같은 규칙이다 */
const assignAll = (verdicts, taken = TAKEN) => {
  const s = slots(taken)
  return verdicts.map((v) => { const d = s.peek(); if (CONSUMES_SLOT.has(v)) s.commit(); return d })
}

expect('점유 상태에서 최초 빈 날짜는 9/18', slots().peek(), '2026-09-18')
expect('주입한 Set 을 복사한다 (원본 불변)', (() => { const t = new Set(TAKEN); const s = slotAllocator(FROM, { taken: t }); s.commit(); return t.size })(), 2)
expect('공급자 함수로도 넘길 수 있다', slotAllocator(FROM, { taken: () => TAKEN }).peek(), '2026-09-18')

console.log('\n══════ 🔴 슬롯 버그 — 막힌 후보가 빈 예약일을 태우지 않는다')
/**
 * 🔴 **실측 버그** (2026-09-16). 옛 판은 부를 때마다 날짜를 **소비**했다.
 *      BLOCKED → 9/18 소비 · DONE → 9/19 · BLOCKED → 9/20 소비
 *    등록은 하나인데 빈 날짜 셋이 사라졌다.
 */
expect('peek 은 소비하지 않는다', (() => { const s = slots(); return [s.peek(), s.peek(), s.peek()] })(), ['2026-09-18', '2026-09-18', '2026-09-18'])
// 실제 사고 재현 — 첫 BLOCKED 뒤 DONE 이 같은 최초 빈 날짜를 받는다
expect('🔴 첫 BLOCKED 뒤 DONE 이 9/18 을 받는다', assignAll(['BLOCKED', 'DONE', 'BLOCKED']), ['2026-09-18', '2026-09-18', '2026-09-19'])
expect('🔴 BLOCKED 가 연속돼도 같은 날짜다', assignAll(['BLOCKED', 'BLOCKED', 'BLOCKED', 'DONE']), ['2026-09-18', '2026-09-18', '2026-09-18', '2026-09-18'])
expect('DONE 연속은 9/18·9/19·9/20', assignAll(['DONE', 'DONE', 'DONE']), ['2026-09-18', '2026-09-19', '2026-09-20'])
expect('DONE 연속에 중복이 없다', new Set(assignAll(['DONE', 'DONE', 'DONE'])).size, 3)
expect('이미 찬 날짜는 건너뛴다', assignAll(['DONE'], ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']), ['2026-09-20'])
// 🔴 from 이 9/16 이므로 9/16·9/17 을 먼저 채우고 그다음 찬 9/18 을 건너뛴다
expect('띄엄띄엄 찬 날짜도 건너뛴다', assignAll(['DONE', 'DONE', 'DONE'], ['2026-09-18', '2026-09-20']), ['2026-09-16', '2026-09-17', '2026-09-19'])
expect('항상 10:30 KST 로 굳는다', assignAll(['DONE', 'DONE']).map((d) => normalizePublishAt(d).publishAt), ['2026-09-18T10:30:00+09:00', '2026-09-19T10:30:00+09:00'])

// dry-run / write 배정 일치
expect('DONE 은 슬롯을 쓴다', CONSUMES_SLOT.has('DONE'), true)
expect('DRY_RUN_OK 도 슬롯을 쓴다', CONSUMES_SLOT.has('DRY_RUN_OK'), true)
expect('🔴 BLOCKED 는 슬롯을 쓰지 않는다', CONSUMES_SLOT.has('BLOCKED'), false)
expect('🔴 DRY_RUN_INCOMPLETE 도 쓰지 않는다', CONSUMES_SLOT.has('DRY_RUN_INCOMPLETE'), false)
expect(
  'dry-run 배정과 write 배정이 일치한다',
  assignAll(['BLOCKED', 'DRY_RUN_OK', 'DRY_RUN_INCOMPLETE', 'DRY_RUN_OK']),
  assignAll(['BLOCKED', 'DONE', 'BLOCKED', 'DONE']),
)

console.log('\n══════ 슬롯 integration — 실제 재고로 보되 날짜를 하드코딩하지 않는다')
/**
 * 🔴 기대값을 **동적으로** 만든다. 재고가 매일 바뀌어도 이 검사는 깨지지 않는다.
 *    시험하는 것은 "그 날짜가 며칠인가" 가 아니라 **"규칙이 지켜지는가"** 다.
 */
const liveTaken = takenDates()
const liveFrom = '2026-09-16'
const firstFree = (() => { let d = liveFrom; while (liveTaken.has(d)) d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10); return d })()
expect('기본 동작이 실제 재고를 읽는다', slotAllocator(liveFrom).peek(), firstFree)
expect('최초 빈 날짜는 점유 목록에 없다', liveTaken.has(firstFree), false)
expect('그 하루 전은 점유돼 있거나 시작일 이전이다', firstFree === liveFrom || liveTaken.has(new Date(new Date(`${firstFree}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)), true)
expect('실제 재고에서도 BLOCKED 는 날짜를 태우지 않는다', (() => { const s = slotAllocator(liveFrom); const a = s.peek(); const b = s.peek(); return a === b })(), true)
expect('실제 재고에서도 10:30 KST 다', normalizePublishAt(slotAllocator(liveFrom).peek()).publishAt.endsWith('T10:30:00+09:00'), true)

// 🔴 호출부가 정말 peek/commit 을 쓰는가 — 옛 소비형 호출이 되살아나면 버그가 돌아온다
expect('호출부가 peek 으로 고른다', /const publishAt = slots\.peek\(\)/.test(readySrc), true)
expect('등록되는 후보만 commit 한다', /if \(CONSUMES_SLOT\.has\(r\.verdict\)\) slots\.commit\(\)/.test(readySrc), true)
expect('옛 소비형 호출이 없다', /nextSlot\(\)/.test(readySrc), false)
// 🔴 운영은 주입 없이 실제 재고를 쓴다 — 기본값이 바뀌면 안 된다
expect('운영 호출부는 taken 을 주입하지 않는다', /slotAllocator\(kstDate\(SLOT_START_OFFSET_DAYS\)\)/.test(readySrc), true)

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

// ─────────────────────────────────────────────────────────
console.log('\n══════ 무인 ① 인계 — producer 완료 신호와 잠금')
/**
 * 🔴 등록이 02:00 → 01:00 으로 당겨졌다. 간격이 50분이라 **시간에 기대지 않는다.**
 *    제한된 대기 · 재시도 없음 · producer 실패가 공급을 멈추지 않는다.
 */
const { judgeHandoff, waitForProducer, MAX_WAIT_MS } = await import('./lib/magazine-handoff.mjs')
const H = (over) => judgeHandoff({ handoff: null, producerLockHeld: false, waitedMs: 0, ...over })

expect('producer 가 돌면 기다린다', H({ producerLockHeld: true }).wait, true)
expect('제한 시간 전에는 기다린다', H({ waitedMs: MAX_WAIT_MS - 1 }).wait, true)
expect('🔴 제한 시간이 지나면 기다리지 않는다', H({ waitedMs: MAX_WAIT_MS }).wait, false)
expect('🔴 producer 가 갇혀 있으면 이번 회차를 건너뛴다', H({ producerLockHeld: true, waitedMs: MAX_WAIT_MS }).code, 'PRODUCER_STUCK')
expect('갇힌 producer 에게서 뺏지 않는다 (ready=false)', H({ producerLockHeld: true, waitedMs: MAX_WAIT_MS }).ready, false)
expect('🔴 신호가 없어도 준비된 후보로 진행한다', H({ waitedMs: MAX_WAIT_MS }).ready, true)
expect('그 사유를 남긴다', H({ waitedMs: MAX_WAIT_MS }).code, 'HANDOFF_ABSENT_PROCEED')
expect('정상 신호면 바로 진행', H({ handoff: { verdict: 'OK', finishedAt: 'x' } }).code, 'HANDOFF_OK')
expect('🔴 producer 가 실패해도 진행한다 (공급이 목적)', H({ handoff: { verdict: 'SYSTEM', finishedAt: 'x' } }).ready, true)
expect('그 사실을 구분해 남긴다', H({ handoff: { verdict: 'SYSTEM', finishedAt: 'x' } }).code, 'PRODUCER_FAILED_PROCEED')
expect('깨진 신호도 진행한다', H({ handoff: {} }).code, 'HANDOFF_CORRUPT_PROCEED')

// 🔴 실제로 기다리지 않는다 — 시계를 민다
{
  let t0 = 0
  let polls = 0
  let running = true
  const r = await waitForProducer({
    getHandoff: () => (running ? null : { verdict: 'OK', finishedAt: 'x' }),
    isProducerLockHeld: () => running,
    sleep: async () => { t0 += 60_000; polls += 1; if (polls === 3) running = false },
    now: () => t0,
    log: () => {},
  })
  expect('producer 가 끝나면 대기를 멈춘다', r.ready, true)
  expect('무한 대기하지 않는다 (폴링 횟수 유한)', polls < 10, true)
}
{
  // 영원히 안 끝나면 제한 시간에서 포기한다
  let t0 = 0
  const r = await waitForProducer({
    getHandoff: () => null,
    isProducerLockHeld: () => true,
    sleep: async () => { t0 += 5 * 60_000 },
    now: () => t0,
    log: () => {},
  })
  expect('🔴 제한 시간에서 포기한다', r.code, 'PRODUCER_STUCK')
  expect('포기해도 재시도하지 않는다 (ready=false 로 끝)', r.ready, false)
}

console.log('\n══════ 무인 ② 격리 — 막힌 후보가 공급을 막지 않는다')
/**
 * 🔴 실측: 3건 중 2건이 QA 에 막혔다. 막힌 것은 정상이지만 **다음 날도 같은 후보가
 *    앞자리를 차지**하면 뒤의 멀쩡한 후보가 limit 에 밀린다. 비켜 주되 고치지 않는다.
 */
const QT = await import('./lib/magazine-quarantine.mjs')
const QNOW = 1_800_000_000_000
const jq = (over) => QT.judgeQuarantine({ entry: null, fingerprint: null, now: QNOW, ...over })

expect('기록이 없으면 진행', jq().skip, false)
expect('1회 실패는 다시 시도한다', jq({ entry: { attempts: 1, lastAt: QNOW } }).code, 'RETRYING')
expect('🔴 2회 막히면 비켜 준다', jq({ entry: { attempts: 2, lastAt: QNOW } }).skip, true)
expect('사유를 남긴다', /다시 본다/.test(jq({ entry: { attempts: 2, lastAt: QNOW, reasons: ['QA_FAIL: x'] } }).message), true)
expect('냉각이 지나면 다시 본다', jq({ entry: { attempts: 2, lastAt: QNOW - QT.COOLDOWN_MS } }).code, 'COOLED')
expect('🔴 원고가 바뀌면 즉시 푼다', jq({ entry: { attempts: 9, lastAt: QNOW, fingerprint: 'a' }, fingerprint: 'b' }).skip, false)
expect('그 사유가 CHANGED', jq({ entry: { attempts: 9, lastAt: QNOW, fingerprint: 'a' }, fingerprint: 'b' }).code, 'CHANGED')

const rec = QT.recordFailure({ entry: { attempts: 1, fingerprint: 'a' }, fingerprint: 'a', now: QNOW, reasons: ['QA_FAIL'] })
expect('실패를 센다', rec.attempts, 2)
expect('사유를 보관한다', rec.reasons, ['QA_FAIL'])
expect('🔴 원고가 바뀌면 횟수를 처음부터 센다', QT.recordFailure({ entry: { attempts: 5, fingerprint: 'a' }, fingerprint: 'b', now: QNOW }).attempts, 1)
expect('성공하면 기록을 지운다', QT.clearEntry({ a: 1, b: 2 }, 'a'), { b: 2 })
expect('깨진 저장소는 빈 것으로 본다 (회차를 막지 않는다)', typeof QT.loadQuarantine('/nonexistent/path.json'), 'object')
// 🔴 저장소는 repo 밖이어야 한다 — 추적 파일이면 DIRTY_TREE 로 레인이 멈춘다
expect('🔴 격리 기록은 저장소 밖에 쓴다', QT.QUARANTINE_PATH.includes('/Documents/soransoran'), false)
expect('scan 이 격리를 건너뛴다', /judgeQuarantine\(\{ entry: store\[slug\]/.test(readySrc), true)
expect('write 회차만 기록을 고친다', /if \(write && storeChanged\) saveQuarantine\(store\)/.test(readySrc), true)
expect('등록 성공 시 기록을 지운다', /clearEntry\(store, r\.slug\)/.test(readySrc), true)

console.log('\n══════ 무인 ③ 제목 ↔ 본문 일치')
const { checkTitleBodyMatch } = await import('./lib/magazine-editorial.mjs')
expect('제목 핵심어가 본문에 있으면 통과', checkTitleBodyMatch('갱년기 관절이 아픈데 운동해도 되나요', '갱년기에는 관절이 아플 수 있습니다. 운동은 …').level, null)
expect('🔴 핵심어가 하나도 없으면 FAIL', checkTitleBodyMatch('국민연금 조기수령 유리한가요', '오늘은 잠에 대해 이야기합니다. 수면 위생과 낮잠.').level, 'FAIL')
expect('절반 이상 없으면 WARN', checkTitleBodyMatch('잠자리 습관 2주 바꾸기 기록', '기록은 남겼습니다.').level, 'WARN')
expect('조사·어미가 달라도 같은 말로 본다', checkTitleBodyMatch('50대 걷기 하루 몇 분이 적당할까요', '50대에 걷는 시간은 하루 몇 분이 적당한지 사람마다 다릅니다').level, null)
expect('QA 가 이 검사를 부른다', readFileSync(join('scripts', 'magazine-qa.mjs'), 'utf8').includes('checkTitleBodyMatch('), true)

console.log('\n══════ 무인 ④ 자동 병합 관문')
/**
 * 🔴 경계가 바뀌었다 — merge 도 자동이다. 그러나 **자동 공개는 아니다.**
 *    사람이 PR 에서 보던 것을 이 관문이 하나씩 다시 본다. 모르면 막는다.
 */
const M = await import('./lib/magazine-merge-gate.mjs')
const SHA = 'a'.repeat(40)
const okPr = { number: 9, url: 'u', headRefName: `${M.AUTO_BRANCH_PREFIX}2026-09-17-010000`, headRefOid: SHA, state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
const okFiles = ['src/content/magazine/articles.ts', 'drafts/magazine/x-slug/draft.md', 'public/magazine/x-slug/hero.webp']
const okReg = [{ slug: 'x-slug', publishAt: '2026-09-20T10:30:00+09:00', publishedAt: '2026-09-20', status: 'SCHEDULED' }]
const okQueue = { 'x-slug': { riskLevel: 'LOW', autoEligible: true } }
const base = {
  pr: okPr, expectedSha: SHA, files: okFiles, ciState: 'success',
  checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }],
  registered: okReg, queueBySlug: okQueue, mainSlugs: new Set(), mainDates: new Set(), now: Date.parse('2026-09-17T00:00:00+09:00'),
}
const jm = (over) => M.judgeAutoMerge({ ...base, ...over })
const codesOf = (v) => v.blockedBy.map((b) => b.code)

expect('전부 맞으면 통과', jm().ok, true)
expect('무엇을 확인했는지 남긴다', jm().checked.length > 4, true)
expect('🔴 사람 PR 은 자동 merge 하지 않는다', codesOf(jm({ pr: { ...okPr, headRefName: 'fix/human' } })).includes('NOT_AUTO_BRANCH'), true)
expect('🔴 SHA 가 바뀌면 막는다', codesOf(jm({ expectedSha: 'b'.repeat(40) })).includes('SHA_DRIFTED'), true)
expect('🔴 예상 밖 파일이 있으면 막는다', codesOf(jm({ files: [...okFiles, 'src/app/page.tsx'] })).includes('UNEXPECTED_FILES'), true)
expect('🔴 CI 가 초록이 아니면 막는다', codesOf(jm({ ciState: 'pending' })).includes('CI_NOT_GREEN'), true)
expect('🔴 검사가 실패하면 막는다', codesOf(jm({ checks: [{ name: 'x', status: 'completed', conclusion: 'failure' }] })).includes('CHECK_FAILED'), true)
expect('아직 도는 검사가 있으면 막는다', codesOf(jm({ checks: [{ name: 'x', status: 'in_progress', conclusion: null }] })).includes('CHECK_PENDING'), true)
expect('🔴 HIGH 는 막는다', codesOf(jm({ queueBySlug: { 'x-slug': { riskLevel: 'HIGH', autoEligible: true } } })).includes('RISK_LEVEL'), true)
expect('🔴 autoEligible=false 는 막는다', codesOf(jm({ queueBySlug: { 'x-slug': { riskLevel: 'LOW', autoEligible: false } } })).includes('AUTO_INELIGIBLE'), true)
expect('🔴 큐에 없으면 막는다 (등급 정본이 없다)', codesOf(jm({ queueBySlug: {} })).includes('NOT_IN_QUEUE'), true)
expect('🔴 중복 slug 를 막는다', codesOf(jm({ mainSlugs: new Set(['x-slug']) })).includes('DUPLICATE_SLUG_IN_MAIN'), true)
expect('🔴 중복 예약일을 막는다', codesOf(jm({ mainDates: new Set(['2026-09-20']) })).includes('DUPLICATE_DATE_IN_MAIN'), true)
expect('🔴 10:30 이 아니면 막는다', codesOf(jm({ registered: [{ ...okReg[0], publishAt: '2026-09-20T09:00:00+09:00' }] })).includes('PUBLISH_AT_SHAPE'), true)
expect('publishedAt 과 어긋나면 막는다', codesOf(jm({ registered: [{ ...okReg[0], publishedAt: '2026-09-21' }] })).includes('DATE_MISMATCH'), true)
// 🔴 이것이 "merge 했는데 즉시 공개" 를 막는 자리다
expect('🔴 이미 지난 예약일은 막는다 (merge 즉시 공개)', codesOf(jm({ now: Date.parse('2026-09-25T00:00:00+09:00') })).includes('PUBLISH_AT_PAST'), true)
expect('draft PR 은 막는다', codesOf(jm({ pr: { ...okPr, isDraft: true } })).includes('IS_DRAFT'), true)
expect('충돌이 있으면 막는다', codesOf(jm({ pr: { ...okPr, mergeable: 'CONFLICTING' } })).includes('NOT_MERGEABLE'), true)
expect('PR 이 없으면 막는다', codesOf(jm({ pr: null })).includes('NO_PR'), true)
expect('허용 파일 모양 — 본문/큐/원고/hero', okFiles.every((f) => M.isAllowedFile(f)), true)
expect('🔴 소스 코드 변경은 허용하지 않는다', M.isAllowedFile('scripts/magazine-auto-merge.mjs'), false)
expect('🔴 워크플로 변경은 허용하지 않는다', M.isAllowedFile('.github/workflows/visibility-guard.yml'), false)
expect('MERGE_RISK 는 LOW/MEDIUM 뿐', [...M.MERGE_RISK].sort(), ['LOW', 'MEDIUM'])

console.log('\n══════ 무인 ⑤ 시각 일치 — 템플릿 · 문서 · 테스트')
const regTpl = readFileSync(join('docs', 'operations', 'launchd', 'magazine', 'com.soransoran.magazine-auto-register.plist.template'), 'utf8')
const prodTpl2 = readFileSync(join('docs', 'operations', 'launchd', 'magazine', 'com.soransoran.magazine-producer.plist.template'), 'utf8')
const hourOf = (x) => (x.match(/<key>Hour<\/key><integer>(\d+)<\/integer>/) ?? [])[1]
expect('producer 는 00:10 그대로', hourOf(prodTpl2), '0')
expect('🔴 등록은 01:00 이다', hourOf(regTpl), '1')
expect('템플릿 설명도 01:00 이다', /01:00 KST/.test(regTpl), true)
// 🔴 **실행 시각**만 본다. 주석의 변경 이력("02:00 → 01:00")은 남아 있어야 한다 —
//    무엇이 언제 왜 바뀌었는지가 지워지면 다음 사람이 같은 자리를 다시 판다.
expect('예약 블록에 옛 시각이 없다', /<key>Hour<\/key><integer>2<\/integer>/.test(regTpl), false)
expect('변경 이력은 주석에 남아 있다', /02:00 → 01:00/.test(regTpl), true)
expect('🔴 --merge 가 켜져 있다', /<string>--merge<\/string>/.test(regTpl), true)
expect('자동 공개가 아님을 명시한다', /merge 해도 공개는 아니다|publishAt.*전까지 안 나간다/.test(regTpl), true)
const runbook = readFileSync(join('docs', 'operations', 'magazine-automation-runbook.md'), 'utf8')
expect('runbook 도 01:00 이다', /01:00/.test(runbook), true)
expect('runbook 에 02:00 이 남아 있지 않다', /02:00/.test(runbook), false)

// ─────────────────────────────────────────────────────────
console.log('\n══════ 운영연결 ① 등록 후 삭제된 큐 — 등급은 등록 전 main 에서 본다')
/**
 * 🔴 **실측 재현** (2026-09-16). `register.mjs` 는 등록하면서 그 slug 를 큐에서 **뺀다.**
 *    #524 의 diff 가 그것을 보여준다 — `-slug: 'after-menopause-body'` (19줄 삭제).
 *    그래서 PR 브랜치의 큐에서 등급을 찾으면 **언제나 NOT_IN_QUEUE** 로 막힌다.
 *    더 나쁜 것은, 찾을 수 있게 만들면 **PR 이 자기 등급을 낮춰 통과**할 수 있다는 점이다.
 */
const MG = await import('./lib/magazine-merge-gate.mjs')
const MSHA = 'a'.repeat(40)
const mPr = { number: 9, url: 'u', headRefName: `${MG.AUTO_BRANCH_PREFIX}2026-09-17-010000`, headRefOid: MSHA, state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
const mFiles = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/x-slug/draft.md']
const mReg = [{ slug: 'x-slug', publishAt: '2026-09-25T10:30:00+09:00', publishedAt: '2026-09-25', status: 'SCHEDULED' }]
const okChecks = [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }]
// 🔴 등록 전 큐(main): slug 가 **있다** · 등록 후 큐(PR): slug 가 **없다**
const MAIN_QUEUE = { 'x-slug': { riskLevel: 'MEDIUM', autoEligible: true }, 'other': { riskLevel: 'LOW', autoEligible: true } }
const BRANCH_QUEUE = { 'other': { riskLevel: 'LOW', autoEligible: true } }
const mBase = {
  pr: mPr, expectedSha: MSHA, files: mFiles, ciState: 'success', checks: okChecks,
  registered: mReg, queueBySlug: MAIN_QUEUE, branchQueueBySlug: BRANCH_QUEUE,
  mainSlugs: new Set(['other-live']), mainDates: new Set(['2026-09-24']),
  now: Date.parse('2026-09-17T00:00:00+09:00'),
}
const jmg = (over) => MG.judgeAutoMerge({ ...mBase, ...over })
const mCodes = (v) => v.blockedBy.map((b) => b.code)

expect('🔴 등록으로 큐에서 빠져도 통과한다 (등급은 main 에서)', jmg().ok, true)
expect('큐 무결성을 확인했다고 남긴다', jmg().checked.some((c) => c.includes('큐 무결성')), true)
// 🔴 옛 방식(PR 큐에서 등급 조회)이었다면 막혔을 것 — 그 회귀를 고정한다
expect('🔴 PR 큐를 정본으로 쓰면 막힌다 (옛 결함 재현)', mCodes(MG.judgeAutoMerge({ ...mBase, queueBySlug: BRANCH_QUEUE })).includes('NOT_IN_QUEUE'), true)
// 🔴 PR 이 등급을 낮춰 통과할 수 없다
expect(
  '🔴 PR 이 등급을 낮추면 막는다',
  mCodes(jmg({ branchQueueBySlug: { other: { riskLevel: 'LOW', autoEligible: true }, 'y': { riskLevel: 'LOW', autoEligible: true } } })).includes('QUEUE_ADDED'),
  true,
)
expect(
  '🔴 남은 항목의 등급을 바꾸면 막는다',
  mCodes(jmg({ branchQueueBySlug: { other: { riskLevel: 'HIGH', autoEligible: true } } })).includes('QUEUE_GRADE_CHANGED'),
  true,
)
expect(
  '🔴 자격을 바꿔도 막는다',
  mCodes(jmg({ branchQueueBySlug: { other: { riskLevel: 'LOW', autoEligible: false } } })).includes('QUEUE_GRADE_CHANGED'),
  true,
)
expect(
  '🔴 등록하지 않은 항목을 큐에서 빼면 막는다',
  mCodes(jmg({ branchQueueBySlug: {} })).includes('QUEUE_UNEXPECTED_REMOVAL'),
  true,
)
// 등급 자체는 여전히 main 기준으로 막힌다
expect('main 큐가 HIGH 면 막는다', mCodes(jmg({ queueBySlug: { ...MAIN_QUEUE, 'x-slug': { riskLevel: 'HIGH', autoEligible: true } } })).includes('RISK_LEVEL'), true)

console.log('\n══════ 운영연결 ② CI 조회 실패 · 빈 목록 · 필수 검사 누락')
expect('🔴 빈 검사 목록은 막는다', mCodes(jmg({ checks: [] })).includes('CHECKS_EMPTY'), true)
expect('🔴 조회 실패(unknown)도 막는다', mCodes(jmg({ ciState: 'unknown' })).includes('CI_NOT_GREEN'), true)
expect(
  '🔴 필수 검사가 없으면 막는다',
  mCodes(jmg({ checks: [{ name: '엉뚱한 검사', status: 'completed', conclusion: 'success' }] })).includes('REQUIRED_CHECK_MISSING'),
  true,
)
expect(
  '필수 검사가 실패면 막는다',
  mCodes(jmg({ checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'failure' }] })).includes('CHECK_FAILED'),
  true,
)
expect(
  '필수 검사가 아직 돌면 막는다',
  mCodes(jmg({ checks: [{ name: 'Micro Seed 3축 게이트', status: 'in_progress', conclusion: null }] })).includes('CHECK_PENDING'),
  true,
)
expect('필수 검사 목록이 비어 있지 않다', MG.REQUIRED_CHECKS.length > 0, true)

console.log('\n══════ 운영연결 ③ 부분 실패와 병합 가능 여부는 다르다')
/**
 * 🔴 실측: 3건 중 2건 QA_FAIL · 1건 DONE → 회차 종료 코드 1.
 *    옛 판은 그 1 때문에 **멀쩡한 PR 의 병합을 건너뛰었다.**
 */
const runSrc = readFileSync(join('scripts', 'magazine-auto-register-run.mjs'), 'utf8')
expect('🔴 회차가 실패해도 병합을 건너뛰지 않는다', /if \(code !== 0\) line\(`회차에 막힌 후보가 있다/.test(runSrc), true)
expect('옛 건너뛰기 코드가 없다', /등록 회차가 실패해 자동 병합을 건너뛴다/.test(runSrc), false)
expect('🔴 부분 실패를 숨기지 않는다', /회차 판정은 그대로 \$\{code\} 다/.test(runSrc), true)
expect('병합 성공이 회차 실패를 덮지 않는다 (Math.max)', /finalCode = Math\.max\(finalCode/.test(runSrc), true)
// 정상 PR 은 독립으로 검증된다 — 회차 결과가 판정에 들어가지 않는다
expect('병합 관문 입력에 회차 결과가 없다', Object.keys(mBase).includes('runVerdict'), false)

console.log('\n══════ 운영연결 ④ producer 회차 전체 잠금')
const lockMod = await import('./lib/magazine-auto-lock.mjs')
expect('producer 회차 lock 경로가 따로 있다', typeof lockMod.PRODUCER_LOCK_PATH, 'string')
expect('auto-register lock 과 다른 파일이다', lockMod.PRODUCER_LOCK_PATH === lockMod.LOCK_PATH, false)
expect('날짜가 들어가지 않는다 (자정 넘김)', /\d{4}-\d{2}-\d{2}/.test(lockMod.PRODUCER_LOCK_PATH), false)
const prodSrc = readFileSync(join('scripts', 'magazine-producer-run.mjs'), 'utf8')
expect('🔴 producer 가 회차 전체를 잠근다', /checkLock: \(\) => \{ producerLock = acquireLock\(\{ path: PRODUCER_LOCK_PATH/.test(prodSrc), true)
expect('🔴 잠금 실패도 단일 finalizer 를 지난다 (Slack 이 나간다)', /checkLock/.test(readFileSync(join('scripts','lib','magazine-producer-flow.mjs'),'utf8')), true)
expect('🔴 신호를 먼저 쓰고 그다음 잠금을 푼다', prodSrc.indexOf('writeHandoff({') < prodSrc.indexOf('producerLock.release()'), true)
expect('dry-run 은 잠그지 않는다 (flow 가 !dryRun 에서만 checkLock 을 부른다)', /if \(!dryRun\) \{/.test(readFileSync(join('scripts','lib','magazine-producer-flow.mjs'),'utf8')), true)
expect('🔴 등록이 회차 전체 lock 을 본다', /readLock\(PRODUCER_LOCK_PATH\)/.test(runSrc), true)
expect('죽은 pid 에 붙잡히지 않는다', /defaultPidAlive\(l\.pid\)/.test(runSrc), true)
// 선정 완료 후에도 brief·회수가 계속되는 상황 = lock 이 살아 있다
expect(
  '선정 뒤에도 잠금이 유지된다 (release 가 flow 뒤에 있다)',
  prodSrc.indexOf('runProducerFlow({') < prodSrc.indexOf('producerLock.release()'),
  true,
)

console.log('\n══════ 운영연결 ⑤ 배포 — 커밋 status 가 아니라 실제 Production 을 본다')
const AM = await import('./magazine-auto-merge.mjs')
const DNOW = Date.parse('2026-09-17T12:00:00+09:00')
const DPL = 'dpl_LIVE0000000000000000000000'
const OLD_DPL = 'dpl_OLD00000000000000000000000'
const DSHA = 'm'.repeat(40)
const READY = { found: true, state: 'success', sha: DSHA, deploymentId: DPL }
const jd = (over) => AM.judgeDeploy({
  deployment: READY, liveDeploymentId: DPL, expectedSha: DSHA, slugStatuses: [], now: DNOW, ...over,
})

expect('배포 READY + 도메인 일치 + 확인할 글 없음 → 통과', jd().ok, true)

/**
 * 🔴 **이것이 ⑤ 의 핵심이다** (2026-09-16 재검토).
 *
 *    직전 판은 `commits/{sha}/status` 를 배포 상태로 썼다. 그것은 CI 판정에 쓰는
 *    바로 그 값이라, 검사가 전부 초록이면 success 가 된다 —
 *    **운영 도메인이 아직 옛 빌드를 서빙하고 있어도 success 다.**
 *    "배포를 확인했다" 고 적어 두고 실제로는 CI 를 한 번 더 본 것이었다.
 */
expect(
  '🔴 커밋 status=success 여도 운영 도메인이 구버전이면 막는다',
  jd({ liveDeploymentId: OLD_DPL }).blockedBy[0].code,
  'PRODUCTION_STALE',
)
expect(
  '🔴 도메인 표식을 못 읽으면 성공이 아니다 (fail closed)',
  jd({ liveDeploymentId: null }).blockedBy[0].code,
  'PRODUCTION_UNVERIFIED',
)
expect(
  '🔴 배포 id 를 못 읽으면 대조할 수 없다 — 막는다',
  jd({ deployment: { ...READY, deploymentId: null } }).blockedBy[0].code,
  'DEPLOY_ID_UNKNOWN',
)
expect(
  '🔴 그 SHA 의 Production 배포가 없으면 막는다',
  jd({ deployment: { found: false, state: null, sha: null, deploymentId: null } }).blockedBy.map((b) => b.code).includes('DEPLOY_NOT_FOUND'),
  true,
)
expect(
  '🔴 배포의 SHA 가 다르면 막는다 — 남의 커밋 배포를 우리 것으로 보지 않는다',
  jd({ deployment: { ...READY, sha: 'z'.repeat(40) } }).blockedBy[0].code,
  'DEPLOY_SHA_MISMATCH',
)
expect(
  '🔴 READY 가 아니면 막는다',
  jd({ deployment: { ...READY, state: 'in_progress' } }).blockedBy.map((b) => b.code).includes('DEPLOY_NOT_READY'),
  true,
)
expect('🔴 배포가 실패로 끝나도 막는다', jd({ deployment: { ...READY, state: 'failure' } }).ok, false)

// ── 예약 비공개 — 🔴 404 만이 확인이다 ────────────────────
const slug = (over) => ({ slugStatuses: [{ slug: 'x', publishAt: '2026-09-25T10:30:00+09:00', ...over }] })
expect('예약 전에는 404 가 정상이다', jd(slug({ httpStatus: 404 })).ok, true)
expect('🔴 예약 글이 미리 공개되면 막는다', jd(slug({ httpStatus: 200 })).blockedBy[0].code, 'PUBLISHED_EARLY')
/**
 * 🔴 옛 판은 `!== 200` 이면 전부 "숨겨졌다" 로 봤다. 그러면 사이트가 500 이거나
 *    인증 리다이렉트가 걸린 순간에도 성공으로 끝난다 —
 *    배포가 망가진 날 가장 자신 있게 초록을 보고하게 된다.
 */
expect('🔴 500 을 비공개로 오인하지 않는다', jd(slug({ httpStatus: 500 })).blockedBy[0].code, 'HIDDEN_UNCONFIRMED')
expect('🔴 인증 리다이렉트(302)도 비공개 확인이 아니다', jd(slug({ httpStatus: 302 })).blockedBy[0].code, 'HIDDEN_UNCONFIRMED')
expect('🔴 네트워크 실패(status 없음)는 성공이 아니다', jd(slug({ httpStatus: null })).blockedBy[0].code, 'CHECK_UNREACHABLE')
expect(
  '🔴 예약일이 지났는데 안 보이면 막는다',
  AM.judgeDeploy({ deployment: READY, liveDeploymentId: DPL, expectedSha: DSHA, now: DNOW, slugStatuses: [{ slug: 'x', publishAt: '2026-09-16T10:30:00+09:00', httpStatus: 404 }] }).blockedBy[0].code,
  'NOT_PUBLISHED',
)
expect(
  '예약일이 지나 200 이면 통과',
  AM.judgeDeploy({ deployment: READY, liveDeploymentId: DPL, expectedSha: DSHA, now: DNOW, slugStatuses: [{ slug: 'x', publishAt: '2026-09-16T10:30:00+09:00', httpStatus: 200 }] }).ok,
  true,
)

// ── publishAt 이후 감시 — 본문·이미지·목록 세 곳 ───────────
// 🔴 상세만 200 이면 모자라다. 목록에 없으면 독자가 찾아오지 못한다.
const wRow = (over) => [{ slug: 'x', publishAt: '2026-09-16T10:30:00+09:00', article: 200, image: 200, inList: true, ...over }]
const jw = (over) => AM.judgeWatch({ rows: wRow(over), now: DNOW })
expect('공개 뒤 본문·이미지·목록이 다 있으면 통과', jw({}).ok, true)
expect('🔴 본문이 없으면 막는다', jw({ article: 404 }).blockedBy[0].code, 'ARTICLE_MISSING')
expect('🔴 대표 이미지가 깨지면 막는다', jw({ image: 404 }).blockedBy[0].code, 'IMAGE_MISSING')
expect('🔴 목록에 없으면 막는다 — 독자가 찾아오지 못한다', jw({ inList: false }).blockedBy[0].code, 'LIST_MISSING')
expect(
  '아직 예약 전인 글은 감시 대상이 아니다',
  AM.judgeWatch({ rows: [{ slug: 'later', publishAt: '2026-09-25T10:30:00+09:00', article: 404, image: 404, inList: false }], now: DNOW }).ok,
  true,
)
expect('🔴 CI 관찰에 제한 시간이 있다', Number.isFinite(AM.CI_OBSERVE_MS) && AM.CI_OBSERVE_MS > 0, true)
expect('🔴 배포 관찰에 제한 시간이 있다', Number.isFinite(AM.DEPLOY_OBSERVE_MS) && AM.DEPLOY_OBSERVE_MS > 0, true)
expect('🔴 mergeable 관찰에 제한 시간이 있다', Number.isFinite(AM.MERGEABLE_OBSERVE_MS) && AM.MERGEABLE_OBSERVE_MS > 0, true)

console.log('\n══════ 운영연결 ⑥ 이미지 생성의 CDP 제한')
const heroSrc = readFileSync(join('scripts', 'magazine-hero-runner.mjs'), 'utf8')
expect('🔴 15초 제한이 남아 있지 않다', /timeout: 15000/.test(heroSrc), false)
expect('공통 정책 상수를 쓴다', /timeout: CDP_CONNECT_TIMEOUT_MS/.test(heroSrc), true)
expect('두 곳 모두 바뀌었다', (heroSrc.match(/timeout: CDP_CONNECT_TIMEOUT_MS/g) ?? []).length, 2)
const sessSrc = readFileSync(join('scripts', 'lib', 'chatgpt-session.mjs'), 'utf8')
expect('저장소 전체에 15초 CDP 제한이 없다', /connectOverCDP\([^)]*timeout: 15000/.test(sessSrc + heroSrc), false)

console.log('\n══════ 운영연결 ⑦ 파싱은 한 벌이다 — 실제 큐 전체를 공용 로더와 대조')
/**
 * 🔴 **왜 생겼나** (2026-09-16 Codex 재검토).
 *
 *    자동 병합이 등급을 "slug 문자열 뒤 900자" 라는 창에서 정규식으로 긁고 있었다.
 *    항목 하나가 900자를 넘거나 인접 항목이 가까우면 **옆 항목의 등급을 집어 온다.**
 *    `autoEligible: false` 바로 뒤에 `true` 항목이 오면 false 가 true 로 읽힌다 —
 *    즉 **민감 주제를 자동으로 병합**하게 된다. 창 기반 파싱은 여기서 없앴다.
 *
 *    그래서 두 가지를 본다. ① 실제 큐 **전체**가 공용 로더와 한 글자도 다르지 않은가.
 *    ② 인접한 false/true 항목이 서로 섞이지 않는가.
 */
const L = await import('./lib/magazine-load.mjs')

// ── ① 실제 재고 전체 대조 ────────────────────────────────
const realQueueSrc = readFileSync(join('drafts', 'magazine', 'topic-queue.ts'), 'utf8')
const realArticlesSrc = readFileSync(join('src', 'content', 'magazine', 'articles.ts'), 'utf8')
const viaSource = L.parseQueueSource(realQueueSrc, 'topic-queue.ts')
const viaLoader = L.loadQueue()
expect('실제 큐를 읽었다 (비어 있지 않다)', viaSource.length > 0, true)
expect('🔴 실제 큐 전체가 공용 로더와 같다', JSON.stringify(viaSource), JSON.stringify(viaLoader))
expect(
  '🔴 실제 articles 전체가 공용 로더와 같다',
  JSON.stringify(L.parseArticlesSource(realArticlesSrc, 'articles.ts')),
  JSON.stringify(L.loadArticles()),
)
// 🔴 등급 필드가 전 항목에 실제로 있는가 — 없으면 관문이 NOT_IN_QUEUE 로 막는다
expect(
  '실제 큐 전 항목이 riskLevel 을 갖는다',
  viaSource.every((q) => typeof q.riskLevel === 'string' && q.riskLevel.length > 0),
  true,
)

// ── ② 인접 false/true — 옛 900자 창 결함의 재현 ───────────
/**
 * 🔴 **창 방식이 왜 틀리는가.** 창은 "slug 문자열이 나온 자리에서 앞으로 900자" 다.
 *    그런데 객체 안의 필드 순서는 정해져 있지 않다. `slug` 가 뒤쪽에 오면
 *    그 창 안에서 **가장 먼저 만나는 `autoEligible`** 은 자기 것이 아니라
 *    **다음 항목의 것**이다. 아래 모양에서 창은 `false` 를 `true` 로 읽는다 —
 *    즉 **민감 주제가 자동 병합 대상이 된다.**
 */
const ADJACENT = [
  'export const TOPIC_QUEUE: TopicQueueItem[] = [',
  '  {',
  "    riskLevel: 'HIGH',",
  '    autoEligible: false,',
  `    note: '${'긴설명 '.repeat(120)}',`,
  "    slug: 'sensitive-one',",
  '  },',
  "  { slug: 'safe-one', riskLevel: 'LOW', autoEligible: true },",
  ']',
].join('\n')
const adj = Object.fromEntries(L.parseQueueSource(ADJACENT, 'adj').map((q) => [q.slug, q]))
expect('🔴 경계 파서는 인접 항목의 값을 집어 오지 않는다', adj['sensitive-one'].autoEligible, false)
expect('🔴 등급도 자기 것을 지킨다', adj['sensitive-one'].riskLevel, 'HIGH')
expect('뒤 항목도 정확히 읽는다', adj['safe-one'].autoEligible, true)
expect('뒤 항목의 등급도 정확하다', adj['safe-one'].riskLevel, 'LOW')

// 옛 결함 재현 — 같은 소스를 "slug 뒤 900자" 창으로 읽으면 옆 값을 집어 온다
const windowRead = (src, slug) => {
  const at = src.indexOf(`'${slug}'`)
  const win = src.slice(at, at + 900)
  return {
    riskLevel: (win.match(/riskLevel:\s*'([A-Z]+)'/) ?? [, null])[1],
    autoEligible: (win.match(/autoEligible:\s*(true|false)/) ?? [, null])[1],
  }
}
expect(
  '🔴 옛 900자 창은 민감 항목을 자동 가능으로 읽었다 (재현)',
  windowRead(ADJACENT, 'sensitive-one').autoEligible,
  'true',
)
expect(
  '🔴 등급도 옆 항목 것을 집어 왔다 (재현)',
  windowRead(ADJACENT, 'sensitive-one').riskLevel,
  'LOW',
)
expect(
  '🔴 그래서 관문이 HIGH 를 막지 못했을 것이다',
  MG.judgeAutoMerge({
    ...mBase,
    registered: [{ slug: 'sensitive-one', publishAt: '2026-09-25T10:30:00+09:00', publishedAt: '2026-09-25', status: 'SCHEDULED' }],
    queueBySlug: { 'sensitive-one': { riskLevel: 'LOW', autoEligible: true } },
    branchQueueBySlug: null,
  }).blockedBy.map((b) => b.code).includes('RISK_LEVEL'),
  false,
)
expect(
  '🔴 경계 파서로 읽으면 관문이 막는다',
  MG.judgeAutoMerge({
    ...mBase,
    registered: [{ slug: 'sensitive-one', publishAt: '2026-09-25T10:30:00+09:00', publishedAt: '2026-09-25', status: 'SCHEDULED' }],
    queueBySlug: { 'sensitive-one': adj['sensitive-one'] },
    branchQueueBySlug: null,
  }).blockedBy.map((b) => b.code).includes('RISK_LEVEL'),
  true,
)

console.log('\n══════ 운영연결 ⑧ 자동 병합 실행 함수 — 가짜 git·gh·배포·HTTP 로 통째 실행')
/**
 * 🔴 **파서→판정 조합을 시험하는 것으로는 "실제로 이어지는가" 를 못 본다** (2026-09-16 검토).
 *    여기서는 `runAutoMerge` **전체**를 돌린다. git·gh·배포·HTTP 는 전부 가짜다 —
 *    네트워크도, 실제 저장소도 건드리지 않는다. 시각과 sleep 도 주입이라 즉시 끝난다.
 */
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const MERGED = 'c'.repeat(40)
const NOW8 = Date.parse('2026-09-17T12:00:00+09:00')

const ART = (rows) => [
  'export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = {',
  ...rows.map((r) => `  '${r.slug}': { title: ${JSON.stringify(r.title ?? r.slug)}, publishedAt: '${r.publishAt.slice(0, 10)}', status: 'SCHEDULED', publishAt: '${r.publishAt}' },`),
  '}',
].join('\n')
const QUE = (rows) => [
  'export const TOPIC_QUEUE: TopicQueueItem[] = [',
  ...rows.map((r) => `  { slug: '${r.slug}', riskLevel: '${r.riskLevel}', autoEligible: ${r.autoEligible} },`),
  ']',
].join('\n')

const MAIN_ART = [{ slug: 'old-one', publishAt: '2026-09-20T10:30:00+09:00' }]
const BRANCH_ART = [...MAIN_ART, { slug: 'new-one', publishAt: '2026-09-19T10:30:00+09:00' }]
const MAIN_Q = [{ slug: 'new-one', riskLevel: 'LOW', autoEligible: true }, { slug: 'keep-one', riskLevel: 'MEDIUM', autoEligible: true }]
const BRANCH_Q = [{ slug: 'keep-one', riskLevel: 'MEDIUM', autoEligible: true }]
const PR8 = { number: 77, url: 'https://example/77', headRefName: `${MG.AUTO_BRANCH_PREFIX}2026-09-17-010000`, headRefOid: HEAD, baseRefName: 'main', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
const FILES8 = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/new-one/draft.md', 'public/magazine/new-one/hero.webp']
const CHECKS8 = [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }]
const LIVE_DPL = 'dpl_INTEGRATION00000000000000'
/** 🔴 필수 검사보다 **먼저 붙는** 빠른 검사 — 종료 조건을 흐리는 주범이다 */
const FAST_CHECK = [{ name: 'Vercel Preview Comments', status: 'completed', conclusion: 'success' }]

const mergeDeps = (over = {}) => {
  let t = NOW8
  const calls = []
  return {
    calls,
    log: () => {},
    now: () => t,
    sleep: async (ms) => { t += ms },
    fetchMain: () => { calls.push('fetchMain'); return true },
    readBaseSha: () => BASE,
    showFile: (sha, path) => {
      calls.push(`show:${sha === BASE ? 'main' : 'pr'}:${path}`)
      const main = sha === BASE
      if (path.endsWith('articles.ts')) return ART(main ? MAIN_ART : BRANCH_ART)
      return QUE(main ? MAIN_Q : BRANCH_Q)
    },
    listAutoPrs: () => ({ ok: true, prs: [{ ...PR8 }] }),
    getPr: () => ({ ...PR8 }),
    listPrFiles: () => FILES8,
    getChecks: () => ({ ok: true, ciState: 'success', checks: CHECKS8 }),
    mergePr: (n, sha) => { calls.push(`merge:${n}:${sha.slice(0, 4)}`); return { ok: true, mergeCommit: MERGED } },
    // 🔴 커밋 합산 status 가 아니라 **실제 Production 배포**를 읽는다
    getProductionDeployment: (sha) => { calls.push('deployment'); return { found: true, state: 'success', sha, deploymentId: LIVE_DPL } },
    liveDeploymentId: () => LIVE_DPL,
    httpStatus: () => 404,
    httpBody: () => '',
    ...over,
  }
}
const codes8 = (r) => r.blockedBy.map((b) => b.code)

// ── 검증만 (--apply 없음) ────────────────────────────────
const dryDeps = mergeDeps()
const dry = await AM.runAutoMerge({ apply: false, deps: dryDeps })
expect('검증 회차가 막힘 없이 끝난다', codes8(dry), [])
expect('🔴 --apply 없이는 merge 를 부르지 않는다', dryDeps.calls.some((c) => c.startsWith('merge:')), false)
expect('기준 origin/main SHA 를 기록한다', dry.baseSha, BASE)
expect('대상 PR 을 기록한다', dry.pr.number, 77)
expect('🔴 지정 SHA 로 소스를 읽는다 (main·PR 양쪽)', dryDeps.calls.filter((c) => c.startsWith('show:')).length, 4)
expect('등록분만 뽑는다', dry.registered.map((r) => r.slug), ['new-one'])

// ── 실제 merge → 배포 → 예약 비공개 ──────────────────────
const applyDeps = mergeDeps()
const applied = await AM.runAutoMerge({ apply: true, deps: applyDeps })
expect('merge 했다', applied.merged, true)
expect('🔴 검증한 그 SHA 로만 merge 한다', applyDeps.calls.includes(`merge:77:${HEAD.slice(0, 4)}`), true)
expect('배포까지 확인하고 끝난다', applied.deploy.state, 'success')
expect('막힌 항목 없음', codes8(applied), [])

// ── 🔴 배포 조회 실패 → 성공으로 끝내지 않는다 ────────────
const noDeploy = await AM.runAutoMerge({ apply: true, deps: mergeDeps({ getProductionDeployment: () => ({ found: false, state: null, sha: null, deploymentId: null }) }) })
expect('merge 는 됐다', noDeploy.merged, true)
expect('🔴 배포를 확인하지 못하면 성공 종료가 아니다', codes8(noDeploy).includes('DEPLOY_NOT_FOUND'), true)
expect('🔴 그래서 종료 코드가 0 이 아니다', noDeploy.blockedBy.length > 0, true)

/**
 * 🔴 **요구 ① 의 상황** — 커밋 status 는 success 인데 운영 도메인은 구버전이다.
 *    옛 판(`commits/{sha}/status`)은 이 회차를 **초록으로 보고했다.**
 */
const staleRun = await AM.runAutoMerge({ apply: true, deps: mergeDeps({ liveDeploymentId: () => 'dpl_OLDBUILD0000000000000000' }) })
expect('🔴 운영 도메인이 구버전이면 성공으로 끝내지 않는다', codes8(staleRun).includes('PRODUCTION_STALE'), true)
expect('그래도 merge 자체는 일어났다는 사실을 숨기지 않는다', staleRun.merged, true)
expect('배포 관찰이 시간 초과로 끝났다고 기록한다', staleRun.deploy.outcome, 'TIMEOUT')
expect(
  '🔴 도메인 표식을 못 읽어도 성공이 아니다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ liveDeploymentId: () => null }) })).includes('PRODUCTION_UNVERIFIED'),
  true,
)
expect(
  '🔴 배포 SHA 가 merge 커밋과 다르면 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ getProductionDeployment: () => ({ found: true, state: 'success', sha: 'z'.repeat(40), deploymentId: LIVE_DPL }) }) })).includes('DEPLOY_SHA_MISMATCH'),
  true,
)
// 배포가 늦게 붙는 정상 상황 — 기다렸다가 통과한다
let dcount = 0
const slowDeploy = await AM.runAutoMerge({
  apply: true,
  deps: mergeDeps({
    getProductionDeployment: (sha) => { dcount += 1; return dcount < 3 ? { found: false, state: null, sha: null, deploymentId: null } : { found: true, state: 'success', sha, deploymentId: LIVE_DPL } },
  }),
})
expect('배포가 늦게 붙어도 기다렸다가 통과한다', codes8(slowDeploy), [])
expect('실제로 여러 번 관찰했다', dcount >= 3, true)
expect('배포 관찰 결과를 SERVED 로 기록한다', slowDeploy.deploy.outcome, 'SERVED')

// ── 🔴 공개 여부 조회 실패 → 성공으로 끝내지 않는다 ───────
const noHttp = await AM.runAutoMerge({ apply: true, deps: mergeDeps({ httpStatus: () => null }) })
expect('🔴 사이트에 닿지 못하면 비공개 성공이 아니다', codes8(noHttp).includes('CHECK_UNREACHABLE'), true)

// ── 🔴 예약 글이 미리 나갔다 → 사고로 보고한다 ────────────
const early = await AM.runAutoMerge({ apply: true, deps: mergeDeps({ httpStatus: () => 200 }) })
expect('🔴 merge 직후 공개돼 있으면 사고다', codes8(early).includes('PUBLISHED_EARLY'), true)

// ── CI 가 안 끝났다 → merge 하지 않는다 ───────────────────
const pendingDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'pending', checks: [{ name: 'Micro Seed 3축 게이트', status: 'in_progress', conclusion: null }] }) })
const pending = await AM.runAutoMerge({ apply: true, deps: pendingDeps })
expect('🔴 CI 가 안 끝나면 막는다', codes8(pending).includes('CI_NOT_GREEN'), true)
expect('🔴 그리고 merge 를 부르지 않는다', pendingDeps.calls.some((c) => c.startsWith('merge:')), false)
expect('🔴 무한 대기하지 않는다 — 제한 시간에서 끊는다', pending.merged, false)

// ── 필수 검사 **등록이 늦다** → 제한 시간 안에서 기다린다 ──
/**
 * 🔴 **요구 ② 의 상황** (2026-09-16 재검토).
 *
 *    GitHub 은 검사를 한꺼번에 등록하지 않는다. 빠른 검사가 먼저 붙어 완료되면
 *    그 순간 목록은 "비어 있지 않고 전부 completed" 다.
 *    옛 종료 조건은 거기서 관찰을 끝냈고, 관문이 `REQUIRED_CHECK_MISSING` 으로
 *    막았다 — **정상 회차가 매번 실패한다.**
 *    첫 조회에 다른 검사만 완료 · 두 번째에 필수 검사가 나타나는 상황을
 *    `runAutoMerge` 전체 실행으로 시험한다.
 */
let late = 0
const lateDeps = mergeDeps({
  getChecks: () => {
    late += 1
    // 1회차: 빠른 검사만 붙었고 **완료**다. 필수 검사는 아직 등록 전.
    return late === 1
      ? { ok: true, ciState: 'success', checks: FAST_CHECK }
      : { ok: true, ciState: 'success', checks: [...FAST_CHECK, ...CHECKS8] }
  },
})
const lateRun = await AM.runAutoMerge({ apply: true, deps: lateDeps })
expect('🔴 다른 검사만 완료된 상태에서 관찰을 끝내지 않는다', codes8(lateRun), [])
expect('🔴 두 번째 조회에서 필수 검사를 보고 진행했다', late >= 2, true)
expect('CI 관찰 결과를 SETTLED 로 기록한다', lateRun.ci.outcome, 'SETTLED')
expect('그래도 merge 는 한 번뿐이다', lateDeps.calls.filter((c) => c.startsWith('merge:')).length, 1)

// 🔴 **실패와 시간 초과를 구분한다** — 둘 다 merge 안 함이지만 사람이 할 일이 다르다
const failedDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'failure', checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'failure' }] }) })
const failedRun = await AM.runAutoMerge({ apply: true, deps: failedDeps })
expect('🔴 검사 실패는 FAILED 다', failedRun.ci.outcome, 'FAILED')
expect('🔴 실패를 시간 초과로 보고하지 않는다', codes8(failedRun).includes('CI_OBSERVE_TIMEOUT'), false)
expect('🔴 실패 사유가 그대로 남는다', codes8(failedRun).includes('CHECK_FAILED'), true)
expect('🔴 실패는 기다리지 않는다 — 곧장 끝낸다', failedRun.ci.waitedMs, 0)
expect('🔴 merge 하지 않는다', failedDeps.calls.some((c) => c.startsWith('merge:')), false)

/**
 * 🔴 **필수 검사는 completed + success 하나뿐이다** (2026-09-16 재검토).
 *
 *    워크플로에 경로 필터(`paths:`)나 조건(`if:`)이 붙으면 검사는 **돌지 않고
 *    skipped 로 완료**된다. 그것을 통과로 세면 "필수 검사를 확인했다" 는 말이
 *    **한 번도 돌지 않은 검사**를 가리킨다 — 필수로 정해 둔 이유가 통째로 사라진다.
 */
const skippedDeps = mergeDeps({
  getChecks: () => ({ ok: true, ciState: 'success', checks: [...FAST_CHECK, { name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'skipped' }] }),
})
const skippedRun = await AM.runAutoMerge({ apply: true, deps: skippedDeps })
expect('🔴 필수 검사가 skipped 면 막는다', codes8(skippedRun).includes('REQUIRED_CHECK_MISSING'), true)
expect('🔴 merge 하지 않는다', skippedDeps.calls.some((c) => c.startsWith('merge:')), false)
expect('🔴 결론까지 적는다 (skipped)', skippedRun.blockedBy.find((b) => b.code === 'REQUIRED_CHECK_MISSING').message.includes('skipped'), true)
expect('🔴 기다리지 않는다 — 결론이 났다', skippedRun.ci.outcome, 'FAILED')

const neutralDeps = mergeDeps({
  getChecks: () => ({ ok: true, ciState: 'success', checks: [...FAST_CHECK, { name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'neutral' }] }),
})
expect(
  '🔴 필수 검사가 neutral 이어도 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: neutralDeps })).includes('REQUIRED_CHECK_MISSING'),
  true,
)
expect('🔴 merge 하지 않는다', neutralDeps.calls.some((c) => c.startsWith('merge:')), false)
// 🔴 부수 검사의 skipped 는 그대로 통과한다 — 막을 이유가 없고, 막으면 매 회차 시끄럽다
expect(
  '부수 검사가 skipped 인 것은 통과한다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ getChecks: () => ({ ok: true, ciState: 'success', checks: [{ name: 'Vercel Preview Comments', status: 'completed', conclusion: 'skipped' }, ...CHECKS8] }) }) })),
  [],
)

/**
 * 🔴 **check-run 이 다 끝나도 합산 status 가 pending 일 수 있다** (2026-09-16 재검토).
 *    두 값은 다른 곳에서 온다 — check-run 은 Actions 가, 합산은 Commit Status API 를
 *    쓰는 것들(Vercel 등)이 올린다. 그 순간 관찰을 끝내면 관문이 `CI_NOT_GREEN` 으로
 *    막는다. **정상 회차가 실패한다.**
 */
let ciq = 0
const pendingThenGreen = mergeDeps({
  getChecks: () => {
    ciq += 1
    // 1회차: check-run 은 전부 completed·success 인데 합산만 아직 pending
    return { ok: true, ciState: ciq === 1 ? 'pending' : 'success', checks: [...FAST_CHECK, ...CHECKS8] }
  },
})
const ptg = await AM.runAutoMerge({ apply: true, deps: pendingThenGreen })
expect('🔴 검사가 다 끝나도 합산이 pending 이면 기다린다', codes8(ptg), [])
expect('🔴 두 번째 조회까지 기다렸다', ciq >= 2, true)
expect('그리고 SETTLED 로 끝난다', ptg.ci.outcome, 'SETTLED')
expect('실제로 merge 한다', ptg.merged, true)

const ciFailDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'failure', checks: [...FAST_CHECK, ...CHECKS8] }) })
const ciFail = await AM.runAutoMerge({ apply: true, deps: ciFailDeps })
expect('🔴 합산 status 가 failure 면 실패다', ciFail.ci.outcome, 'FAILED')
expect('🔴 기다리지 않는다', ciFail.ci.waitedMs, 0)
expect('🔴 merge 하지 않는다', ciFailDeps.calls.some((c) => c.startsWith('merge:')), false)
expect(
  '🔴 error 도 실패다',
  (await AM.runAutoMerge({ apply: true, deps: mergeDeps({ getChecks: () => ({ ok: true, ciState: 'error', checks: [...FAST_CHECK, ...CHECKS8] }) }) })).ci.outcome,
  'FAILED',
)

// 🔴 unknown · 조회 실패를 성공으로 취급하지 않는다
const unknownDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'unknown', checks: [...FAST_CHECK, ...CHECKS8] }) })
const unknownRun = await AM.runAutoMerge({ apply: true, deps: unknownDeps })
expect('🔴 합산 status 가 unknown 이면 성공이 아니다', unknownRun.ci.outcome, 'TIMEOUT')
expect('🔴 merge 하지 않는다', unknownDeps.calls.some((c) => c.startsWith('merge:')), false)
expect(
  '🔴 검사는 끝났는데 합산이 안 붙었다고 적는다',
  unknownRun.blockedBy.find((b) => b.code === 'CI_OBSERVE_TIMEOUT').message.includes('합산 status 가 success 가 아니다'),
  true,
)
const queryFailDeps = mergeDeps({ getChecks: () => ({ ok: false, ciState: 'unknown', checks: [] }) })
const queryFail = await AM.runAutoMerge({ apply: true, deps: queryFailDeps })
expect('🔴 조회 실패도 성공이 아니다', queryFail.ci.outcome, 'TIMEOUT')
expect('🔴 merge 하지 않는다', queryFailDeps.calls.some((c) => c.startsWith('merge:')), false)

const timeoutDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'pending', checks: FAST_CHECK }) })
const timeoutRun = await AM.runAutoMerge({ apply: true, deps: timeoutDeps })
expect('🔴 필수 검사가 끝내 안 붙으면 TIMEOUT 이다', timeoutRun.ci.outcome, 'TIMEOUT')
expect('🔴 시간 초과를 따로 보고한다', codes8(timeoutRun).includes('CI_OBSERVE_TIMEOUT'), true)
expect(
  '🔴 무엇이 없었는지 이름으로 적는다',
  timeoutRun.blockedBy.find((b) => b.code === 'CI_OBSERVE_TIMEOUT').message.includes('Micro Seed 3축 게이트'),
  true,
)
expect('🔴 제한 시간에서 끊는다 — 무한 대기 없음', timeoutRun.ci.waitedMs >= AM.CI_OBSERVE_MS, true)
expect('🔴 merge 하지 않는다', timeoutDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── 검사가 끝내 안 붙는다 → 빈 목록을 통과시키지 않는다 ────
const neverDeps = mergeDeps({ getChecks: () => ({ ok: true, ciState: 'pending', checks: [] }) })
const never = await AM.runAutoMerge({ apply: true, deps: neverDeps })
expect('🔴 검사 목록이 끝내 비면 막는다', codes8(never).includes('CHECKS_EMPTY'), true)
expect('🔴 merge 하지 않는다', neverDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── mergeable UNKNOWN → 정해질 때까지 유한하게 본다 ────────
let mq = 0
const unknownThenOk = await AM.runAutoMerge({
  apply: true,
  deps: mergeDeps({ getPr: () => { mq += 1; return { ...PR8, mergeable: mq < 3 ? 'UNKNOWN' : 'MERGEABLE' } } }),
})
expect('🔴 UNKNOWN 을 그대로 막지 않고 관찰한다', codes8(unknownThenOk), [])
expect('실제로 다시 조회했다', mq >= 3, true)

const alwaysUnknownDeps = mergeDeps({ getPr: () => ({ ...PR8, mergeable: 'UNKNOWN' }) })
const alwaysUnknown = await AM.runAutoMerge({ apply: true, deps: alwaysUnknownDeps })
expect('🔴 끝내 UNKNOWN 이면 막는다', codes8(alwaysUnknown).includes('NOT_MERGEABLE'), true)
expect('🔴 merge 하지 않는다', alwaysUnknownDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── 🔴 마지막 재조회에서 HEAD 가 움직였다 → merge 하지 않는다 ──
let seen = 0
const driftDeps = mergeDeps({
  getPr: () => { seen += 1; return { ...PR8, headRefOid: seen >= 2 ? 'd'.repeat(40) : HEAD } },
})
const drift = await AM.runAutoMerge({ apply: true, deps: driftDeps })
expect('🔴 검증 뒤에 커밋이 붙으면 막는다', codes8(drift).some((c) => c === 'SHA_DRIFTED' || c === 'SHA_DRIFTED_LATE'), true)
expect('🔴 merge 하지 않는다', driftDeps.calls.some((c) => c.startsWith('merge:')), false)

const baseDeps = mergeDeps({ getPr: () => ({ ...PR8, baseRefName: 'develop' }) })
const wrongBase = await AM.runAutoMerge({ apply: true, deps: baseDeps })
expect('🔴 base 가 main 이 아니면 막는다', codes8(wrongBase).includes('BASE_NOT_MAIN'), true)

// ── 🔴 기존 글을 건드렸다 → 막는다 (더하기만 한다) ────────
const editedDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) {
      return sha === BASE ? ART(MAIN_ART) : ART([{ slug: 'old-one', publishAt: '2026-09-20T10:30:00+09:00', title: '제목을 몰래 바꿨다' }, BRANCH_ART[1]])
    }
    return QUE(sha === BASE ? MAIN_Q : BRANCH_Q)
  },
})
const edited = await AM.runAutoMerge({ apply: true, deps: editedDeps })
expect('🔴 기존 글 수정은 자동 레인의 일이 아니다', codes8(edited).includes('EXISTING_ARTICLE_TOUCHED'), true)
expect('🔴 merge 하지 않는다', editedDeps.calls.some((c) => c.startsWith('merge:')), false)

const deletedDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return sha === BASE ? ART(MAIN_ART) : ART([BRANCH_ART[1]])
    return QUE(sha === BASE ? MAIN_Q : BRANCH_Q)
  },
})
const deleted = await AM.runAutoMerge({ apply: true, deps: deletedDeps })
expect('🔴 기존 글 삭제는 더 위험하다 — 막는다', codes8(deleted).includes('EXISTING_ARTICLE_TOUCHED'), true)
expect('🔴 merge 하지 않는다', deletedDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── 🔴 큐를 건드렸다 → 막는다 ────────────────────────────
const queueEditDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return ART(sha === BASE ? MAIN_ART : BRANCH_ART)
    return sha === BASE ? QUE(MAIN_Q) : QUE([{ slug: 'keep-one', riskLevel: 'LOW', autoEligible: true }])
  },
})
expect(
  '🔴 PR 이 남은 항목의 등급을 낮추면 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: queueEditDeps })).includes('QUEUE_GRADE_CHANGED'),
  true,
)
const queueDropDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return ART(sha === BASE ? MAIN_ART : BRANCH_ART)
    return sha === BASE ? QUE(MAIN_Q) : QUE([])
  },
})
expect(
  '🔴 등록하지 않은 항목이 큐에서 빠지면 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: queueDropDeps })).includes('QUEUE_UNEXPECTED_REMOVAL'),
  true,
)

// ── 🔴 무관한 파일이 섞였다 → 막는다 ─────────────────────
const strayDeps = mergeDeps({ listPrFiles: () => [...FILES8, 'scripts/magazine-auto-merge.mjs'] })
expect(
  '🔴 소스 코드가 섞이면 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: strayDeps })).includes('UNEXPECTED_FILES'),
  true,
)

/**
 * 🔴 **요구 ③ 의 상황** (2026-09-16 재검토).
 *
 *    `drafts/magazine/<아무 slug>/draft.md` 는 **모양이 맞다.** 그래서 이 회차가
 *    등록하지도 않는 **다른 글의 원고나 hero 를 고치거나 지워도** 통과했다.
 *    자동 레인이 건드려도 되는 것은 **이번에 등록하는 slug 의 파일뿐**이다.
 */
const foreignHero = mergeDeps({ listPrFiles: () => [...FILES8, 'public/magazine/old-one/hero.webp'] })
const fh = await AM.runAutoMerge({ apply: true, deps: foreignHero })
expect('🔴 등록분이 아닌 글의 hero 변경을 막는다', codes8(fh).includes('FOREIGN_SLUG_FILE'), true)
expect('🔴 어느 slug 인지 적는다', fh.blockedBy.find((b) => b.code === 'FOREIGN_SLUG_FILE').message.includes('old-one'), true)
expect('🔴 merge 하지 않는다', foreignHero.calls.some((c) => c.startsWith('merge:')), false)

const foreignDraft = mergeDeps({ listPrFiles: () => [...FILES8, 'drafts/magazine/some-other-post/draft.md'] })
expect(
  '🔴 등록분이 아닌 글의 원고 변경·삭제를 막는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: foreignDraft })).includes('FOREIGN_SLUG_FILE'),
  true,
)
expect(
  '🔴 review.ts 도 마찬가지다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ listPrFiles: () => [...FILES8, 'drafts/magazine/old-one/review.ts'] }) })).includes('FOREIGN_SLUG_FILE'),
  true,
)

// 🔴 **정상 신규 등록 파일만 있으면 통과한다** — 막기만 하는 관문은 쓸모가 없다
const exactDeps = mergeDeps({
  listPrFiles: () => [
    'src/content/magazine/articles.ts',
    'drafts/magazine/topic-queue.ts',
    'drafts/magazine/new-one/draft.md',
    'drafts/magazine/new-one/article-draft.ts',
    'drafts/magazine/new-one/brief.md',
    'drafts/magazine/new-one/review.ts',
    'public/magazine/new-one/hero.webp',
  ],
})
const exact = await AM.runAutoMerge({ apply: true, deps: exactDeps })
expect('🔴 등록분 slug 의 파일만 있으면 통과한다', codes8(exact), [])
expect('그리고 실제로 merge 한다', exact.merged, true)

// 🔴 큐의 남은 항목 — 등급뿐 아니라 **다른 필드도** 불변이어야 한다
const queueFieldDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return ART(sha === BASE ? MAIN_ART : BRANCH_ART)
    return sha === BASE
      ? QUE(MAIN_Q)
      : "export const TOPIC_QUEUE: TopicQueueItem[] = [\n  { slug: 'keep-one', riskLevel: 'MEDIUM', autoEligible: true, title: '제목을 몰래 바꿨다' },\n]"
  },
})
const qf = await AM.runAutoMerge({ apply: true, deps: queueFieldDeps })
expect('🔴 등급이 같아도 다른 필드가 바뀌면 막는다', codes8(qf).includes('QUEUE_ITEM_CHANGED'), true)
expect('🔴 merge 하지 않는다', queueFieldDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── 조회 자체가 실패했다 → 조용히 성공하지 않는다 ─────────
expect('🔴 fetch 실패는 막는다', codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ fetchMain: () => false }) })), ['FETCH_FAILED'])
expect('🔴 기준 SHA 를 못 읽으면 막는다', codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ readBaseSha: () => null }) })), ['BASE_SHA_UNKNOWN'])
expect('🔴 PR 조회 실패는 막는다', codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ listAutoPrs: () => ({ ok: false, reason: 'gh 실패' }) })})), ['PR_LOOKUP_FAILED'])
expect('🔴 소스를 못 읽으면 막는다', codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ showFile: () => { throw new Error('없다') } }) })), ['SOURCE_PARSE_FAILED'])
expect(
  '🔴 자동 PR 이 둘이면 고르지 않는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ listAutoPrs: () => ({ ok: true, prs: [{ ...PR8 }, { ...PR8, number: 78 }] }) }) })),
  ['MULTIPLE_AUTO_PRS'],
)
const emptyDeps = mergeDeps({ listAutoPrs: () => ({ ok: true, prs: [] }) })
const empty = await AM.runAutoMerge({ apply: true, deps: emptyDeps })
expect('자동 PR 이 없으면 조용히 끝난다', codes8(empty), [])
expect('🔴 그때도 merge 는 없다', emptyDeps.calls.some((c) => c.startsWith('merge:')), false)

// ── merge 자체가 실패했다 ────────────────────────────────
expect(
  '🔴 merge 실패를 성공으로 보고하지 않는다',
  codes8(await AM.runAutoMerge({ apply: true, deps: mergeDeps({ mergePr: () => ({ ok: false, reason: '보호 규칙' }) }) })),
  ['MERGE_FAILED'],
)

// ── 🔴 HIGH·비자격 주제는 실행 경로에서도 막힌다 ──────────
const highDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return ART(sha === BASE ? MAIN_ART : BRANCH_ART)
    return sha === BASE
      ? QUE([{ slug: 'new-one', riskLevel: 'HIGH', autoEligible: true }, ...BRANCH_Q])
      : QUE(BRANCH_Q)
  },
})
const high = await AM.runAutoMerge({ apply: true, deps: highDeps })
expect('🔴 HIGH 는 실행 경로에서도 막힌다', codes8(high).includes('RISK_LEVEL'), true)
expect('🔴 merge 하지 않는다', highDeps.calls.some((c) => c.startsWith('merge:')), false)
const ineligibleDeps = mergeDeps({
  showFile: (sha, path) => {
    if (path.endsWith('articles.ts')) return ART(sha === BASE ? MAIN_ART : BRANCH_ART)
    return sha === BASE
      ? QUE([{ slug: 'new-one', riskLevel: 'LOW', autoEligible: false }, ...BRANCH_Q])
      : QUE(BRANCH_Q)
  },
})
expect(
  '🔴 autoEligible=false 는 실행 경로에서도 막힌다',
  codes8(await AM.runAutoMerge({ apply: true, deps: ineligibleDeps })).includes('AUTO_INELIGIBLE'),
  true,
)

// ── 감시 작업도 통째로 돈다 ──────────────────────────────
const watchOk = await AM.runWatch({
  deps: {
    now: () => Date.parse('2026-09-21T12:00:00+09:00'),
    fetchMain: () => true,
    readBaseSha: () => BASE,
    showFile: () => ART([{ slug: 'old-one', publishAt: '2026-09-20T10:30:00+09:00' }]),
    httpStatus: () => 200,
    httpBody: () => '<a href="/magazine/old-one">old-one</a>',
  },
})
expect('공개 뒤 본문·목록이 확인되면 통과', watchOk.ok, true)
const watchBad = await AM.runWatch({
  deps: {
    now: () => Date.parse('2026-09-21T12:00:00+09:00'),
    fetchMain: () => true,
    readBaseSha: () => BASE,
    showFile: () => ART([{ slug: 'old-one', publishAt: '2026-09-20T10:30:00+09:00' }]),
    httpStatus: () => 200,
    httpBody: () => '<p>목록이 비었다</p>',
  },
})
expect('🔴 목록에서 빠지면 감시가 잡는다', watchBad.blockedBy.map((b) => b.code), ['LIST_MISSING'])
expect(
  '🔴 감시도 fetch 실패를 성공으로 보지 않는다',
  (await AM.runWatch({ deps: { now: () => NOW8, fetchMain: () => false, readBaseSha: () => BASE, showFile: () => '', httpStatus: () => 200, httpBody: () => '' } })).ok,
  false,
)


const GIT = await import('./lib/magazine-auto-git.mjs')
const OUT = await import('./lib/magazine-outstanding.mjs')
console.log('\n══════ 복귀 — 🔴 빈 자동 브랜치가 다음 회차를 막지 않는다')
/**
 * 🔴 **2026-09-16 supervised 실측에서 나온 결함.**
 *
 *    후보가 전부 QA 에 막히면 register 가 아무것도 쓰지 않는다. 그런데 PR 브랜치는
 *    register **앞에서** 만들어지므로 커밋 0건 브랜치가 남고, 다음 회차의
 *    `judgeOutstanding` 이 그것을 `ORPHAN_LOCAL_BRANCH`(FAILURE)로 본다 —
 *    **"오늘 통과한 후보가 없다" 는 정상 결과가 다음 날 회차를 막는다.**
 */
const AUTO_B = `${MG.AUTO_BRANCH_PREFIX}2026-09-16-205620`
const gitFake = ({ branch, ahead, delOk = true }) => {
  const seen = []
  const exec = (cmd, args) => {
    seen.push([cmd, ...args].join(' '))
    const a = args.join(' ')
    if (a === 'rev-parse --abbrev-ref HEAD') return { code: 0, out: seen.filter((s) => s === 'git switch main').length > 0 ? 'main' : branch, err: '' }
    if (a.startsWith('status --porcelain')) return { code: 0, out: '', err: '' }
    if (a === 'switch main') return { code: 0, out: '', err: '' }
    if (a.startsWith('rev-list --count')) return { code: 0, out: String(ahead), err: '' }
    if (a.startsWith('branch -D')) return { code: delOk ? 0 : 1, out: '', err: delOk ? '' : '실패' }
    return { code: 0, out: '', err: '' }
  }
  return { exec, seen }
}

const g1 = gitFake({ branch: AUTO_B, ahead: 0 })
const r1 = GIT.returnToMain({ exec: g1.exec })
expect('🔴 커밋 0건인 자동 브랜치는 지운다', r1.code, 'RETURNED_EMPTY_CLEANED')
expect('🔴 실제로 지우는 명령을 부른다', g1.seen.some((s) => s === `git branch -D ${AUTO_B}`), true)
expect('회차 판정은 성공 그대로다', r1.ok, true)

const g2 = gitFake({ branch: AUTO_B, ahead: 2 })
const r2 = GIT.returnToMain({ exec: g2.exec })
expect('🔴 커밋이 있으면 남긴다 — 원고가 그 안에 있을 수 있다', r2.code, 'RETURNED')
expect('🔴 지우지 않는다', g2.seen.some((s) => s.startsWith('git branch -D')), false)

const g3 = gitFake({ branch: 'feat/사람이-만든-브랜치', ahead: 0 })
const r3 = GIT.returnToMain({ exec: g3.exec })
expect('🔴 자동 레인 브랜치가 아니면 건드리지 않는다', g3.seen.some((s) => s.startsWith('git branch -D')), false)
expect('그래도 복귀는 한다', r3.ok, true)

const g4 = gitFake({ branch: AUTO_B, ahead: 0, delOk: false })
const r4 = GIT.returnToMain({ exec: g4.exec })
expect('🔴 못 지워도 회차를 실패로 만들지 않는다', r4.ok, true)
expect('🔴 다음 회차가 막힐 수 있다고 적는다', r4.message.includes('막힐 수 있다'), true)

// 🔴 접두가 한 벌인가 — 갈라지면 자기가 만든 브랜치를 자기가 못 알아본다
expect('branchName 이 자동 레인 접두를 쓴다', GIT.branchName(Date.parse('2026-09-17T01:00:00+09:00')).startsWith(MG.AUTO_BRANCH_PREFIX), true)
expect('그 이름을 isAutoBranch 가 알아본다', OUT.isAutoBranch(GIT.branchName(Date.now())), true)

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
// 🔴 경계가 바뀌었다 (2026-09-16 · 완전 무인 운영) — `--merge` 는 이제 정상이다.
//    그러나 **자동 공개는 아니다.** merge 해도 publishAt(10:30) 전까지 글이 안 나간다.
//    `--admin` 은 여전히 금지다 — 보호 규칙과 CI 를 우회하는 손잡이다.
expect('🔴 CI·보호규칙 우회 인자는 없다', /--admin|--auto/.test(regArgs), false)
expect('--founder-approved 를 넘기지 않는다', regArgs.includes('--founder-approved'), false)
expect('auto-register PATH 가 통째로 치환된다', (regTplText.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/) ?? [, ''])[1], '__PATH__')
expect('producer 도 runtime worktree 를 쓴다', prodTplText.includes('__REPO__/scripts/magazine-producer-run.mjs'), true)
expect(
  'producer 주석이 4단계를 적는다',
  /magazine-webui-runner/.test(prodTplText) && /magazine-brief-auto/.test(prodTplText),
  true,
)
expect('KeepAlive 를 쓰지 않는다', /<key>KeepAlive<\/key>/.test(regTplText + prodTplText), false)

/**
 * 🔴 **공개 확인 job — 읽기만 한다** (2026-09-16 · 완전 무인 운영).
 *    01:00 병합은 "아직 안 나왔는가"(404)까지만 본다. **10:30 에 실제로 나왔는가**
 *    를 보는 자리가 비어 있으면, 안 나온 사실을 제일 먼저 아는 사람이 독자가 된다.
 */
const watchTpl = join(TPL_DIR, 'com.soransoran.magazine-watch.plist.template')
expect('공개 확인 템플릿이 있다', existsSync(watchTpl), true)
const watchTplText = readFileSync(watchTpl, 'utf8')
const watchArgs = (watchTplText.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/) ?? [, ''])[1]
expect('감시 인자를 넘긴다 (--watch)', watchArgs.includes('--watch'), true)
expect('🔴 감시 경로에 --apply 가 없다 — merge 하지 않는다', watchArgs.includes('--apply'), false)
expect('🔴 감시 경로에 --write·--pr 이 없다', /--write|--pr\b/.test(watchArgs), false)
expect('실패를 알린다 (--notify-send)', watchArgs.includes('--notify-send'), true)
expect('🔴 공개(10:30) 뒤에 본다 — 11:00', /<key>Hour<\/key><integer>11<\/integer>/.test(watchTplText), true)
expect('🔴 감시도 KeepAlive 를 쓰지 않는다', /<key>KeepAlive<\/key>/.test(watchTplText), false)
expect('감시 로그도 Documents 밖이다 (TCC)', /__LOGDIR__\/magazine-watch\.log/.test(watchTplText), true)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
console.log('  상태: 자동 PR 경로 구현됨 · launchd 설치는 supervised 1회 성공 뒤에만 열린다\n')
process.exit(fail === 0 ? 0 : 1)
