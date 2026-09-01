#!/usr/bin/env node
/**
 * 자동 레인 회귀 테스트 — 게이트가 정말 막는가.
 *
 * 🔴 이 테스트가 지키는 것은 하나다: **HIGH 가 자동 레인에 흘러들지 않는다.**
 *    특히 batch-qa 는 topic-queue 에 없는 slug 의 등급을 검사하지 않고
 *    READY_TO_SCHEDULE 을 낼 수 있다. 그 구멍을 gate 가 막는지 확인한다.
 *
 * 사용법: node scripts/magazine-auto-register-check.mjs
 * 종료 코드: FAIL 이 있으면 1
 */
import { gate, heroPlan, LANE_RISK } from './lib/magazine-auto-lane.mjs'
import { branchName, preflight, createBranch, assertOnBranch, stageCheck } from './lib/magazine-auto-git.mjs'
import { loadQueue } from './lib/magazine-load.mjs'

let pass = 0
let fail = 0
function expect(label, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}
const codes = (g) => g.blockedBy.map((b) => b.code).sort()

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
// 파일이 없는 slug 라 BRIEF_MISSING·REVIEW_MISSING 이 함께 나온다
expect('LOW 라도 brief 없으면 막힌다', codes(gate('low-ok', Q)).includes('BRIEF_MISSING'), true)
expect('LOW 라도 review 없으면 막힌다', codes(gate('low-ok', Q)).includes('REVIEW_MISSING'), true)
expect('막힌 이유에 RISK_LEVEL 은 없다 (LOW 니까)', codes(gate('low-ok', Q)).includes('RISK_LEVEL'), false)

console.log('\n══════ hero — REQUIRED 만 만든다')
const req = Q[1]
const opt = Q[0]
expect('REQUIRED 는 필요하다', heroPlan(req, { alt: '창가에 앉은 50대 여성' }).need, true)
expect('REQUIRED 인데 alt 없으면 막힌다', heroPlan(req).blocked?.code, 'HERO_ALT_REQUIRED')
expect('OPTIONAL 은 기본 스킵', heroPlan(opt, { alt: '창가에 앉은 50대 여성' }).need, false)
expect('OPTIONAL 은 --allow-optional 로만 만든다', heroPlan(opt, { alt: '창가에 앉은 50대 여성', allowOptional: true }).need, true)

console.log('\n══════ 실제 큐 — HIGH 가 하나도 통과하지 않는다')
const real = loadQueue()
const leaked = real.filter((i) => {
  const g = gate(i.slug, real)
  return g.ok && !LANE_RISK.has(i.riskLevel)
})
expect('실제 큐에서 자동 레인을 통과한 HIGH 0건', leaked.length, 0)
const ineligibleLeak = real.filter((i) => gate(i.slug, real).ok && i.autoEligible !== true)
expect('실제 큐에서 통과한 autoEligible=false 0건', ineligibleLeak.length, 0)

console.log('\n══════ git 안전장치 — write 는 깨끗한 main 에서만')
/** exec 를 흉내 낸다. 실제 git 을 부르지 않는다 */
function fakeExec(map) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`
    for (const [pattern, res] of Object.entries(map)) {
      if (key.startsWith(pattern)) return { code: 0, out: '', err: '', ...res }
    }
    return { code: 0, out: '', err: '' }
  }
}
const CLEAN_MAIN = {
  'git rev-parse --abbrev-ref HEAD': { out: 'main' },
  'git fetch origin main': { out: '' },
  'git rev-parse HEAD': { out: 'abc1234' },
  'git rev-parse origin/main': { out: 'abc1234' },
  'git status --porcelain --untracked-files=no': { out: '' },
}
expect('깨끗한 main 은 통과', preflight({ exec: fakeExec(CLEAN_MAIN) }).ok, true)

const onFeature = { ...CLEAN_MAIN, 'git rev-parse --abbrev-ref HEAD': { out: 'feat/something' } }
expect('main 이 아니면 BLOCKED', preflight({ exec: fakeExec(onFeature) }).blockedBy.map((b) => b.code), ['NOT_ON_MAIN'])

const behind = { ...CLEAN_MAIN, 'git rev-parse origin/main': { out: 'zzz9999' } }
expect('origin/main 과 다르면 BLOCKED', preflight({ exec: fakeExec(behind) }).blockedBy.map((b) => b.code), ['NOT_IN_SYNC'])

const dirty = { ...CLEAN_MAIN, 'git status --porcelain --untracked-files=no': { out: ' M src/content/magazine/articles.ts' } }
expect('추적 변경이 있으면 BLOCKED', preflight({ exec: fakeExec(dirty) }).blockedBy.map((b) => b.code), ['DIRTY_TREE'])

// 미추적은 --untracked-files=no 로 애초에 목록에 오지 않는다. 그 인자를 정말 쓰는지 본다
let sawFlag = false
preflight({
  exec: (cmd, args) => {
    if (args.join(' ').startsWith('status')) sawFlag = args.includes('--untracked-files=no')
    return { code: 0, out: cmd === 'git' && args[0] === 'rev-parse' ? 'main' : '', err: '' }
  },
})
expect('status 는 미추적을 보지 않는다', sawFlag, true)

console.log('\n══════ PR 브랜치 — 충돌하면 현재 브랜치에 커밋하지 않는다')
expect('브랜치 이름에 초가 들어간다', /^feat\/magazine-auto-register-\d{4}-\d{2}-\d{2}-\d{6}$/.test(branchName()), true)
expect('1초 뒤 이름이 다르다', branchName(0) === branchName(1000), false)

const exists = fakeExec({ 'git switch -c': { code: 128, err: "fatal: a branch named 'x' already exists" } })
const dup = createBranch('feat/dup', { exec: exists })
expect('이미 있으면 실패한다', dup.ok, false)
expect('사유가 BRANCH_CREATE_FAILED', dup.blockedBy[0].code, 'BRANCH_CREATE_FAILED')
expect('현재 브랜치에 커밋하지 않는다는 문구', /현재 브랜치에 커밋하지 않는다/.test(dup.blockedBy[0].message), true)

const silentFail = fakeExec({ 'git switch -c': { code: 0 }, 'git rev-parse --abbrev-ref HEAD': { out: 'main' } })
expect('switch 가 조용히 실패해도 잡는다', createBranch('feat/x', { exec: silentFail }).blockedBy[0].code, 'BRANCH_MISMATCH')

const okSwitch = fakeExec({ 'git switch -c': { code: 0 }, 'git rev-parse --abbrev-ref HEAD': { out: 'feat/x' } })
expect('정상 전환은 통과', createBranch('feat/x', { exec: okSwitch }).ok, true)
expect('commit 직전 브랜치가 바뀌면 잡는다', assertOnBranch('feat/x', { exec: fakeExec({ 'git rev-parse': { out: 'main' } }) }).blockedBy[0].code, 'BRANCH_DRIFTED')

console.log('\n══════ stage — 예상 파일만')
const want = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts']
expect('예상대로면 통과', stageCheck(want, want.join('\n')).ok, true)
expect('빈 staged 는 막는다', stageCheck(want, '').blockedBy[0].code, 'NOTHING_STAGED')
const extra = stageCheck(want, [...want, 'SoranSoran_Logo.png'].join('\n'))
expect('미추적이 섞이면 막는다', extra.blockedBy[0].code, 'UNEXPECTED_STAGED')
expect('무엇이 섞였는지 알려준다', extra.unexpected, ['SoranSoran_Logo.png'])

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
