#!/usr/bin/env tsx
/**
 * 대기열 exact id 타깃팅 fixture — 🔴 **지정한 것 외에는 절대 처리하지 않는다** (§4-AK)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  parseIdArgs, filterByIds, missingIds, checkLimitAgainstIds, describeIdTargeting,
} from '../src/lib/original-post-id-target'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const row = (id: string): { id: string } => ({ id })
// 실제 대기열을 닮은 표본 — 우리 2건 + 내용 모르는 5건
const QUEUE = [
  row('cmtjq9fpd'), row('cmtjq9frc'), row('cmtjq9fti'), row('cmtjq9fw0'), row('cmtjq9fyk'),
  row('cmtprrf7v'), row('cmtprrfaq'),
]
const OURS = ['cmtprrf7v', 'cmtprrfaq']

console.log('\n대기열 exact id 타깃팅 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 인자 읽기')
{
  check('--id=<v> 를 읽는다', parseIdArgs(['--id=a']).join(',') === 'a')
  check('--id <v> 도 읽는다', parseIdArgs(['--id', 'a']).join(',') === 'a')
  check('여러 개를 읽는다', parseIdArgs(['--id=a', '--id', 'b']).join(',') === 'a,b')
  check('🔴 중복은 한 번만', parseIdArgs(['--id=a', '--id=a']).join(',') === 'a')
  check('다른 플래그와 섞여도 읽는다',
    parseIdArgs(['--apply', '--id=a', '--limit=1', '--id=b']).join(',') === 'a,b')
  check('🔴 --id 뒤가 플래그면 값이 아니다', parseIdArgs(['--id', '--apply']).length === 0)
  check('🔴 빈 값은 무시', parseIdArgs(['--id=', '--id=  ']).length === 0)
  check('없으면 빈 배열', parseIdArgs(['--apply', '--limit=2']).length === 0)
  check('공백을 다듬는다', parseIdArgs(['--id= a ']).join(',') === 'a')
}

console.log('\n② 🔴 지정한 것 외에는 대상이 되지 않는다')
{
  const one = filterByIds(QUEUE, ['cmtprrf7v'])
  check('id 1개 → 정확히 1건', one.length === 1 && one[0]!.id === 'cmtprrf7v')
  const two = filterByIds(QUEUE, OURS)
  check('id 2개 → 정확히 2건', two.length === 2)
  check('🔴 우리 2건만 남는다', two.map((r) => r.id).sort().join(',') === 'cmtprrf7v,cmtprrfaq')
  check('🔴 내용 모르는 5건이 섞이지 않는다',
    !two.some((r) => r.id.startsWith('cmtjq9')))
  check('🔴 대기열에 7건이 있어도 그대로다 — 자르는 것이 아니라 고르는 것이다',
    QUEUE.length === 7 && two.length === 2)
}

console.log('\n③ 기존 배치 동작은 그대로')
{
  const all = filterByIds(QUEUE, [])
  check('🔴 --id 가 없으면 전부 돌려준다', all.length === QUEUE.length)
  check('순서를 바꾸지 않는다 — dry-run 재현성의 근거다',
    all.map((r) => r.id).join(',') === QUEUE.map((r) => r.id).join(','))
  check('id 를 줘도 원본 순서를 지킨다',
    filterByIds(QUEUE, ['cmtprrfaq', 'cmtjq9fpd']).map((r) => r.id).join(',') === 'cmtjq9fpd,cmtprrfaq')
  check('원본 배열을 건드리지 않는다', (() => {
    const src = [...QUEUE]
    filterByIds(src, OURS)
    return src.length === QUEUE.length
  })())
}

console.log('\n④ 없는 id 를 조용히 넘기지 않는다')
{
  check('대상에 없는 id 를 알려준다',
    missingIds(QUEUE, ['cmtprrf7v', '없는id']).join(',') === '없는id')
  check('전부 있으면 빈 배열', missingIds(QUEUE, OURS).length === 0)
  check('--id 가 없으면 빈 배열', missingIds(QUEUE, []).length === 0)
}

console.log('\n⑤ --limit 은 id 개수와 정확히 같아야 한다')
{
  check('🟢 id 2개 · limit 2 · 대상 2 → 통과', checkLimitAgainstIds(2, OURS, 2).ok)
  check('🔴 limit 이 id 개수와 다르면 멈춘다', !checkLimitAgainstIds(1, OURS, 2).ok)
  check('🔴 limit 이 없으면 멈춘다', !checkLimitAgainstIds(null, OURS, 2).ok)
  // 🔴 이것이 이 검사의 핵심이다 — 하나라도 빠지면 나머지만 처리하지 않는다
  check('🔴 id 2개인데 처리 가능이 1건이면 멈춘다 — 잘라내지 않는다',
    !checkLimitAgainstIds(2, OURS, 1).ok)
  check('멈출 때 이유를 말한다', (() => {
    const r = checkLimitAgainstIds(2, OURS, 1)
    return !r.ok && r.message.includes('잘라내지 않고 멈춥니다')
  })())
  check('🟢 --id 가 없으면 이 검사를 하지 않는다 (배치 동작 유지)',
    checkLimitAgainstIds(null, [], 99).ok && checkLimitAgainstIds(3, [], 5).ok)
}

console.log('\n⑥ 화면 문구')
{
  check('id 없으면 배치라고 말한다', describeIdTargeting([]).includes('배치 전체'))
  check('id 있으면 개수와 함께 말한다', describeIdTargeting(OURS).includes('지정한 2건만'))
  check('🔴 "그 외에는 손대지 않는다" 를 화면에 박는다',
    describeIdTargeting(OURS).includes('그 외에는 손대지 않는다'))
}

console.log('\n⑦ 두 스크립트가 실제로 연결됐는가')
{
  for (const [name, path] of [
    ['match-assign', 'scripts/original-post-match-assign.mts'],
    ['publish-live', 'scripts/original-post-publish-live.mts'],
  ] as const) {
    const src = readFileSync(path, 'utf-8')
    check(`${name} 이 parseIdArgs 를 쓴다`, /const IDS = parseIdArgs\(argv\)/.test(src))
    check(`${name} 이 filterByIds 로 좁힌다`, /filterByIds\(allRows, IDS\)/.test(src))
    check(`${name} 이 없는 id 를 알린다`, /missingIds\(allRows, IDS\)/.test(src))
    check(`${name} 이 limit 을 id 개수와 대조한다`, /checkLimitAgainstIds\(LIMIT, IDS,/.test(src))
    // 🔴 두 스위치는 그대로여야 한다
    check(`${name} 이 --apply 를 여전히 요구한다`, /argv\.includes\('--apply'\)/.test(src))
    check(`${name} 이 --limit 을 여전히 요구한다`, /--limit=N/.test(src))
  }
}

console.log('\n⑧ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 리터럴이 사라졌다.
  //    원래 의도가 "값이 그대로인가" 였으므로 값으로 묻는 편이 더 강하다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  const t = readFileSync('src/lib/original-post-id-target.ts', 'utf-8')
  for (const [label, re] of [
    ['prisma / DB write', /prisma|PrismaClient|\.create\(|\.update/i],
    ['Raw SQL', /\$executeRaw|\$queryRaw|SELECT |UPDATE /],
    ['네트워크', /fetch\(|axios|playwright/],
    ['LLM', /openai|anthropic|gpt-/i],
  ] as const) check(`🔴 타깃팅 lib 에 ${label} 없음`, !re.test(t))
  check('🔴 타깃팅 lib 은 순수 함수만이다', !/await |async /.test(t))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
