#!/usr/bin/env tsx
/**
 * 자동 발행 러너 fixture — 🔴 **아무거나 내보내지 않는다** (§4-AL)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  selectAutoTargets, judgeApply, verifyAfterPublish, splitTargets, queueOrderKey, compareAutoRow,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT, REJECT_LABEL,
  type AutoRow,
  profileOf, machineMarksOk,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_GATE_MARKS,
} from '../src/lib/original-post-auto-publish'
import { kstDayStart } from '../src/lib/original-post-publish'
import { planMatch } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
/** 통과하는 표본 — 여기서 한 가지씩 어긋뜨려 본다 */
const ok = (o: Partial<AutoRow> = {}): AutoRow => ({
  id: 'good1', status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
  promptVersion: AUTO_PROMPT_VERSION, model: AUTO_MODEL, matchedPersonaId: null,
  title: '집에 늘 두고 드시는 간식이 있으세요?', body: '떨어지면 허전해서…',
  sourceSite: `${AUTO_SITE_PREFIX}navercafe:remonterrace`,
  decidedAt: new Date('2026-09-06T00:00:00Z'), createdAt: new Date('2026-09-06T00:00:00Z'), ...o,
})
/** 실제 대기열에 사는 legacy 글 — 🔴 절대 대상이 아니다 */
const legacy = (o: Partial<AutoRow> = {}): AutoRow => ok({
  id: 'legacy1', promptVersion: '13~14판', model: 'gemini-3.7-flash',
  sourceSite: '82cook', title: '주기적으로 사람 잡는 친정아빠', ...o,
})
const allPass = (): string => 'pass'

console.log('\n자동 발행 러너 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 대상 조건 — 일곱 개를 모두 통과해야 한다')
{
  const r = selectAutoTargets([ok()], allPass)
  check('🟢 다 맞으면 후보가 된다', r.targets.length === 1)
  const cases: [string, Partial<AutoRow>, string][] = [
    ['status 가 PENDING', { status: 'PENDING' }, 'STATUS'],
    ['status 가 DECLINED', { status: 'DECLINED' }, 'STATUS'],
    ['이미 발행됨', { createdPostId: 'post1' }, 'ALREADY_PUBLISHED'],
    ['gate 가 HOLD', { gateVerdict: 'HOLD' }, 'GATE'],
    // 🔴 이제 셋을 따로 보지 않고 profile 로 통째로 본다
    ['legacy 판', { promptVersion: '13~14판' }, 'PROFILE'],
    ['LLM 모델', { model: 'gemini-3.7-flash' }, 'PROFILE'],
    ['출처가 synthetic 이 아님', { sourceSite: '82cook' }, 'PROFILE'],
    ['제목이 빔', { title: '  ' }, 'EMPTY'],
    ['본문이 빔', { body: '' }, 'EMPTY'],
  ]
  for (const [label, patch, code] of cases) {
    const x = selectAutoTargets([ok(patch)], allPass)
    check(`🔴 ${label} → 제외 (${code})`, x.targets.length === 0 && x.rejected[0]?.code === code)
  }
  check('🔴 safety 가 pass 가 아니면 제외',
    selectAutoTargets([ok()], () => 'hold').targets.length === 0)
  check('safety 는 저장값이 아니라 발행 문안으로 다시 잰다', (() => {
    let seen = ''
    selectAutoTargets([ok({ title: 'T', body: 'B' })], (t, b) => { seen = `${t}|${b}`; return 'pass' })
    return seen === 'T|B'
  })())
  check('EDITED 도 대상이다', selectAutoTargets([ok({ status: 'EDITED' })], allPass).targets.length === 1)
  check('제외 사유에 라벨이 있다', Object.keys(REJECT_LABEL).length === 9)
}

console.log('\n①-b 🔴 기계 profile — 통째로 맞아야 발행 후보다')
{
  const goodGate = { holds: [], blocks: [], autoDraft: { ...MACHINE_GATE_MARKS } }
  const m = (o: Partial<AutoRow> = {}): AutoRow => ok({
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
    gateResults: goodGate, ...o,
  })
  check('🟢 완전한 기계 profile 은 후보가 된다', selectAutoTargets([m()], allPass).targets.length === 1)
  check('🟢 사람 profile 은 그대로 후보 (회귀 0)', selectAutoTargets([ok()], allPass).targets.length === 1)
  check('profileOf 가 둘을 가른다', profileOf(m()) === 'machine' && profileOf(ok()) === 'human')

  // 🔴 일부만 섞인 행은 전부 제외
  const mixed: [string, Partial<AutoRow>][] = [
    ['판만 기계 · 모델은 사람', { promptVersion: MACHINE_PROMPT_VERSION }],
    ['모델만 기계', { model: MACHINE_MODEL }],
    ['출처만 기계', { sourceSite: `${MACHINE_SITE_PREFIX}x` }],
    ['판·모델 기계인데 출처가 사람', {
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
      sourceSite: 'publish-candidate:navercafe:x',
    }],
  ]
  for (const [label, patch] of mixed) {
    const r = selectAutoTargets([ok(patch)], allPass)
    check(`🔴 ${label} → 제외`, r.targets.length === 0 && r.rejected[0]?.code === 'PROFILE')
  }
  check('🔴 gateResults 표시가 없으면 기계가 아니다',
    selectAutoTargets([m({ gateResults: { holds: [], blocks: [] } })], allPass).targets.length === 0)
  check('🔴 gateResults 가 옛 판이면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, draftRuleVersion: 'auto-draft-v2' } },
  })], allPass).targets.length === 0)
  check('🔴 provenance 가 사람이면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, provenance: 'human-curated' } },
  })], allPass).targets.length === 0)
  check('🔴 sourceDecision 이 ADOPT 면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, sourceDecision: 'ADOPT' } },
  })], allPass).targets.length === 0)
  check('machineMarksOk 가 셋을 다 본다',
    machineMarksOk(goodGate) && !machineMarksOk({ autoDraft: {} }) && !machineMarksOk(null))
  check('🔴 기계 후보도 safety 를 다시 잰다',
    selectAutoTargets([m()], () => 'hold').targets.length === 0)
  check('🔴 기계 표시가 사람 것과 겹치지 않는다',
    (MACHINE_PROMPT_VERSION as string) !== (AUTO_PROMPT_VERSION as string)
    && (MACHINE_MODEL as string) !== (AUTO_MODEL as string))
}

console.log('\n② 🔴 legacy APPROVED 5건이 섞이지 않는다')
{
  // 실제 대기열을 닮은 표본 — legacy 5 + 우리 1
  const queue = [
    legacy({ id: 'L1', gateVerdict: 'PASS' }),
    legacy({ id: 'L2', gateVerdict: 'HOLD' }),
    legacy({ id: 'L3', gateVerdict: 'HOLD' }),
    legacy({ id: 'L4', gateVerdict: 'PASS' }),
    legacy({ id: 'L5', gateVerdict: 'HOLD' }),
    ok({ id: 'cmtprrfaq' }),
  ]
  const r = selectAutoTargets(queue, allPass)
  check('🔴 후보는 우리 1건뿐', r.targets.length === 1 && r.targets[0]!.id === 'cmtprrfaq')
  check('🔴 legacy 는 gate=PASS 여도 제외된다',
    !r.targets.some((t) => t.id === 'L1' || t.id === 'L4'))
  check('제외 5건 전부 사유가 남는다', r.rejected.length === 5)
  check('🔴 어느 것도 우연히 통과하지 않는다',
    r.rejected.every((x) => x.code === 'PROFILE' || x.code === 'GATE'))
}

console.log('\n③ 줄 세우기 — 오래 기다린 것이 먼저다')
{
  const D = (iso: string): Date => new Date(iso)
  const older = ok({ id: 'zzz', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') })
  const newer = ok({ id: 'aaa', decidedAt: D('2026-09-05T00:00:00Z'), createdAt: D('2026-09-05T00:00:00Z') })
  const r = selectAutoTargets([newer, older], allPass)
  check('🔴 오래된 것이 앞 — id 가 뒤여도 시각이 이긴다',
    r.targets.map((t) => t.id).join(',') === 'zzz,aaa')
  check('입력 순서를 바꿔도 같다',
    selectAutoTargets([older, newer], allPass).targets.map((t) => t.id).join(',') === 'zzz,aaa')
  // 🔴 후보 2건이면 오래된 1건만 나간다
  const g = judgeApply({ targets: r.targets, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false })
  check('🔴 후보 2건이면 오래된 1건을 고른다', g.ok && g.target.id === 'zzz')
  const g2 = judgeApply({ targets: selectAutoTargets([older, newer], allPass).targets, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false })
  check('🔴 입력 순서가 바뀌어도 같은 1건을 고른다', g2.ok && g2.target.id === 'zzz')

  check('decidedAt 이 없으면 createdAt 이 대신한다',
    queueOrderKey(ok({ decidedAt: null, createdAt: D('2026-01-01T00:00:00Z') })) === D('2026-01-01T00:00:00Z').getTime())
  check('시각이 같으면 id 로 가른다', compareAutoRow(
    ok({ id: 'a', decidedAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'b', decidedAt: D('2026-09-01T00:00:00Z') }),
  ) < 0)

  const sp = splitTargets(r.targets)
  check('선택 1건 + 대기 N건으로 나뉜다', sp.picked?.id === 'zzz' && sp.waiting.length === 1)
  check('후보 0건이면 선택도 없다', splitTargets([]).picked === null)
  check('🔴 대기분을 숨기지 않는다', sp.waiting[0]!.id === 'aaa')
}

console.log('\n③-2 KST 자정 — cap 을 세는 기준')
{
  const eq = (a: Date, iso: string): boolean => a.toISOString() === iso
  // 🔴 setUTCHours(-9) 는 UTC 15시 이후에 어제로 밀린다. 그래서 기존 함수를 쓴다
  check('2026-09-06T14:59Z (KST 9/6 23:59) → 9/6 자정',
    eq(kstDayStart(new Date('2026-09-06T14:59:00Z')), '2026-09-05T15:00:00.000Z'))
  check('2026-09-06T15:00Z (KST 9/7 00:00) → 9/7 자정',
    eq(kstDayStart(new Date('2026-09-06T15:00:00Z')), '2026-09-06T15:00:00.000Z'))
  check('2026-09-06T23:59Z (KST 9/7 08:59) → 9/7 자정',
    eq(kstDayStart(new Date('2026-09-06T23:59:00Z')), '2026-09-06T15:00:00.000Z'))
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 러너가 setUTCHours(-9) 를 쓰지 않는다',
    !/setUTCHours\(-9/.test(codeOf('scripts/original-post-auto-publish.mts'))
    && /kstDayStart\(/.test(codeOf('scripts/original-post-auto-publish.mts')))
  check('🔴 발행 스크립트 어디에도 setUTCHours(-9) 가 없다',
    ['scripts/original-post-auto-publish.mts', 'scripts/original-post-publish-live.mts']
      .every((f) => !/setUTCHours\(-9/.test(codeOf(f))))
}

console.log('\n④ 실행 게이트 — 하나라도 어긋나면 멈춘다')
{
  const one = [ok()]
  const base = { targets: one, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false }
  check('🟢 전부 맞으면 통과', judgeApply(base).ok)
  check('🔴 --apply 없으면 안 돈다', !judgeApply({ ...base, apply: false }).ok)
  check('🔴 --limit 없으면 안 돈다', !judgeApply({ ...base, limit: null }).ok)
  check('🔴 --limit 이 2면 안 돈다', !judgeApply({ ...base, limit: 2 }).ok)
  check('🔴 --limit 이 0이면 안 돈다', !judgeApply({ ...base, limit: 0 }).ok)
  check('🔴 후보 0건이면 안 돈다', !judgeApply({ ...base, targets: [] }).ok)
  // 🔴 여럿이어도 멈추지 않는다 — 줄 순서대로 맨 앞 하나가 나간다
  {
    const two = selectAutoTargets([
      ok({ id: 'b', decidedAt: new Date('2026-09-02T00:00:00Z') }),
      ok({ id: 'a', decidedAt: new Date('2026-09-01T00:00:00Z') }),
    ], allPass).targets
    const r = judgeApply({ ...base, targets: two })
    check('🔴 후보 2건이면 멈추지 않고 오래된 1건을 낸다', r.ok && r.target.id === 'a')
    check('한 번에 한 건이다 — 나머지는 다음 회차', splitTargets(two).waiting.length === 1)
  }
  check('🔴 오늘 cap 을 채웠으면 안 돈다', !judgeApply({ ...base, publishedToday: 1 }).ok)
  check('🔴 cap 을 넘겼어도 안 돈다', !judgeApply({ ...base, publishedToday: 3 }).ok)
  check('🔴 kill switch 가 켜지면 안 돈다', !judgeApply({ ...base, killSwitchEnabled: true }).ok)
  check('통과하면 대상 1건을 돌려준다', (() => {
    const r = judgeApply(base)
    return r.ok && r.target.id === 'good1'
  })())
}

console.log('\n⑤ 발행 뒤 정합 — 셋이 다 맞아야 한다')
{
  const good = { queueStatus: 'PUBLISHED', createdPostId: 'p1', postExists: true, activityLogCount: 1 }
  check('🟢 다 맞으면 통과', verifyAfterPublish(good).ok)
  check('🔴 Queue 가 PUBLISHED 가 아니면 이상',
    !verifyAfterPublish({ ...good, queueStatus: 'APPROVED' }).ok)
  check('🔴 createdPostId 가 비면 이상', !verifyAfterPublish({ ...good, createdPostId: null }).ok)
  check('🔴 Post 가 없으면 이상', !verifyAfterPublish({ ...good, postExists: false }).ok)
  // 🔴 ActivityLog 가 cap 의 정본이다
  check('🔴 ActivityLog 0건이면 이상 — 다음 발행에서 상한이 조용히 열린다',
    !verifyAfterPublish({ ...good, activityLogCount: 0 }).ok)
  check('🔴 ActivityLog 2건이어도 이상', !verifyAfterPublish({ ...good, activityLogCount: 2 }).ok)
  check('무엇이 틀렸는지 말한다',
    verifyAfterPublish({ ...good, activityLogCount: 0 }).problems.some((p) => p.includes('ActivityLog')))
}

console.log('\n⑥ 🔴 러너가 하지 않는 것')
{
  const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [label, re] of [
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|claude-|gpt-|gemini/i],
    ['네이버 접속', /cafe\.naver\.com|playwright|chromium|fetch\(/],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['마이그레이션', /ALTER TABLE|prisma migrate/i],
    ['status 를 APPROVED 로 바꾸기', /status:\s*'APPROVED'/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  // 🔴 발행 write 를 여기서 다시 짜지 않는다
  check('🔴 post.create 를 직접 부르지 않는다 — 기존 tx 를 쓴다',
    !/prisma\.post\.create|tx\.post\.create/.test(src) && /publishOriginalPostTx\(/.test(src))
  check('두 스위치를 요구한다', /--apply/.test(src) && /--limit=1/.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))

  const lib = readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')
  check('🔴 선정 lib 은 순수 함수만 — DB 도 await 도 없다',
    !/prisma|PrismaClient|await |async /.test(lib))
}

console.log('\n⑦ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  const p = readFileSync('src/lib/original-post-publish.ts', 'utf-8')
  check('POST_CAP_PER_WEEK = 1 그대로', /export const POST_CAP_PER_WEEK = 1\b/.test(m))
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', /export const MIN_DAYS_BETWEEN_POSTS = 5\b/.test(m))
  check('DAILY_PUBLISH_CAP = 1 그대로', /export const DAILY_PUBLISH_CAP = 1\b/.test(p))
  check('러너가 상수를 재정의하지 않는다', (() => {
    const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    return !/const (DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS)\s*=/.test(src)
  })())
}

// ══════════════════════════════════════════════════════════════════
// 🔴 persona mapping 누락 회귀 (2026-09-07 실측 사고)
//
// auto-publish 가 identity.childrenCount 를 넘기지 않아 **모든 persona 가 무자녀로
// 판정**됐다. hardFilter 는 `p.childrenCount ?? 0` 으로 읽기 때문이다.
// "아이랑 같이 갈 숙소, 뭐 보고 고르세요?" 글에서 자녀 있는 4명이 전부 NO_CHILDREN 으로
// 막혀 그 글은 영영 배정되지 못했다 — match-assign 은 넘기는데 여기만 빠져 있었다.
// ══════════════════════════════════════════════════════════════════
{
  // 🔴 CHILDREN_RE 가 실제로 잡는 낱말을 쓴다 — '아이랑' 은 패턴에 없다.
  //    fixture 가 트리거하지 못하면 통과해도 아무것도 검증하지 못한다.
  const KID_TITLE = '애들이랑 같이 갈 숙소, 뭐 보고 고르세요?'
  const KID_BODY = '이번에 애들이랑 같이 가려는데 숙소를 뭘 보고 골라야 할지 모르겠어요. 다들 어떻게 고르세요?'
  const base = {
    status: 'active', providerId: null, maritalStatus: 'married',
    parentCare: null, menopauseStatus: null, workStatus: null,
    economicStatus: null, region: null, noGoTopics: [],
    voiceLength: null, postsThisWeek: 0, daysSinceLastPost: null,
  }
  const withKids = [
    { ...base, code: 'P10', childrenCount: 1 },
    { ...base, code: 'P17', childrenCount: 2 },
    { ...base, code: 'P15', childrenCount: 0 },
  ] as never[]
  // 🔴 버그 재현 — childrenCount 를 아예 넘기지 않은 입력
  const withoutKids = [
    { ...base, code: 'P10' }, { ...base, code: 'P17' }, { ...base, code: 'P15' },
  ] as never[]

  const planWith = planMatch({ queueId: 'q', title: KID_TITLE, body: KID_BODY, personas: withKids })
  const planWithout = planMatch({ queueId: 'q', title: KID_TITLE, body: KID_BODY, personas: withoutKids })

  check('🔴 [회귀] childrenCount 를 넘기면 자녀 있는 persona 가 eligible 이다', (() => {
    const codes = planWith.eligible.map((c) => c.code).sort().join(' ')
    return codes === 'P10 P17'
  })())
  check('🔴 [회귀] 무자녀 persona 는 자녀 글에서 계속 차단된다',
    planWith.blocked.some((b) => b.code === 'P15' && b.reasons.some((r) => r.code === 'NO_CHILDREN')))
  check('🔴 [회귀] childrenCount 가 없으면 **전원** 무자녀로 막힌다 — 이것이 사고였다', (() => {
    const blockedAll = planWithout.blocked.filter(
      (b) => b.reasons.some((r) => r.code === 'NO_CHILDREN')).length
    return planWithout.eligible.length === 0 && blockedAll === 3
  })())
  check('🔴 [회귀] 두 입력의 결과가 실제로 다르다 — fixture 가 헛돌지 않는다',
    planWith.eligible.length !== planWithout.eligible.length)

  // 🔴 러너가 실제로 그 필드를 넘기는지 소스로 고정한다
  const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  check('🔴 [회귀] auto-publish 가 childrenCount 를 넘긴다',
    /childrenCount: typeof id\.childrenCount === 'number' \? id\.childrenCount : null/.test(src))
  check('🔴 [회귀] match-assign 과 같은 필드 집합을 넘긴다', (() => {
    const assign = readFileSync('scripts/original-post-match-assign.mts', 'utf-8')
    const fields = ['childrenCount', 'childrenAgeBands', 'maritalStatus', 'parentCare', 'menopauseStatus', 'noGoTopics']
    return fields.every((f) => src.includes(f) && assign.includes(f))
  })())
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
