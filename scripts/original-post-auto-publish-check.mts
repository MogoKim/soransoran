#!/usr/bin/env tsx
/**
 * 자동 발행 러너 fixture — 🔴 **아무거나 내보내지 않는다** (§4-AL)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  selectAutoTargets, judgeApply, verifyAfterPublish,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT, REJECT_LABEL,
  type AutoRow,
} from '../src/lib/original-post-auto-publish'

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
  sourceSite: `${AUTO_SITE_PREFIX}navercafe:remonterrace`, ...o,
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
    ['legacy 판', { promptVersion: '13~14판' }, 'PROMPT_VERSION'],
    ['LLM 모델', { model: 'gemini-3.7-flash' }, 'MODEL'],
    ['출처가 synthetic 이 아님', { sourceSite: '82cook' }, 'SITE'],
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
  check('제외 사유에 라벨이 있다', Object.keys(REJECT_LABEL).length === 8)
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
    r.rejected.every((x) => x.code === 'PROMPT_VERSION' || x.code === 'GATE'))
}

console.log('\n③ 순서 · 재현성')
{
  const a = selectAutoTargets([ok({ id: 'b' }), ok({ id: 'a' }), ok({ id: 'c' })], allPass)
  check('id 순으로 고정된다 — 같은 재고면 같은 것이 뽑힌다',
    a.targets.map((t) => t.id).join(',') === 'a,b,c')
  const b = selectAutoTargets([ok({ id: 'c' }), ok({ id: 'a' }), ok({ id: 'b' })], allPass)
  check('입력 순서가 달라도 결과가 같다',
    b.targets.map((t) => t.id).join(',') === a.targets.map((t) => t.id).join(','))
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
  // 🔴 이것이 이 러너의 핵심 안전장치다
  check('🔴 후보 2건이면 안 돈다 — 어느 것을 낼지 정해지지 않았다',
    !judgeApply({ ...base, targets: [ok({ id: 'a' }), ok({ id: 'b' })] }).ok)
  check('후보 2건일 때 이유를 말한다', (() => {
    const r = judgeApply({ ...base, targets: [ok({ id: 'a' }), ok({ id: 'b' })] })
    return !r.ok && r.reason.includes('정확히 1건일 때만')
  })())
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

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
