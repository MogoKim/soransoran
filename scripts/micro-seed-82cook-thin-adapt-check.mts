#!/usr/bin/env tsx
/**
 * thin → 검수 어댑터 fixture — 🔴 **전문이 사본으로도 새지 않는다** (§4-AQ)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  toDetailRecord, toRawDetailRecord, statsOf, violatesAdapt, accessOf,
  DETAIL_KEYS, RAW_DETAIL_KEYS, FORBIDDEN_KEYS,
  SOURCE_AXIS, RAW_AXIS, SRN_AXIS,
  DEFAULT_IMAGE_COUNT, DEFAULT_LENGTH_BASIS,
  type ThinRow,
} from '../src/lib/micro-seed-82cook-thin-adapt'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const ok = (o: Partial<ThinRow> = {}): ThinRow => ({
  sourceArticleId: '4234470', sourceSite: '82cook',
  url: 'https://www.82cook.com/entiz/read.php?bn=15&num=4234470',
  title: '당근에서 집안일 도와주실 분', commentCount: 10, score: 0,
  bodyLength: 816, bodyHead: '가'.repeat(300),
  axis: SOURCE_AXIS, safetyVerdict: 'pass', safetyReasons: '',
  reason: '', runId: '20260907-113234', fetchedAt: '2026-09-07T02:32:34.000Z', ...o,
})

console.log('\nthin → 검수 어댑터 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 전문이 사본으로도 새지 않는다')
{
  const d = toDetailRecord(ok())
  const r = toRawDetailRecord(ok())
  check('🔴 detail 사본에 전문 키 없음', FORBIDDEN_KEYS.every((k) => !(k in d)))
  check('🔴 raw-detail 사본에 전문 키 없음', FORBIDDEN_KEYS.every((k) => !(k in r)))
  check('detail 키가 계약과 같다',
    Object.keys(d).sort().join(',') === [...DETAIL_KEYS].sort().join(','))
  check('raw-detail 키가 계약과 같다',
    Object.keys(r).sort().join(',') === [...RAW_DETAIL_KEYS].sort().join(','))
  check(`bodyHead 가 ${BODY_HEAD_CHARS}자 이하`, String(d.bodyHead).length <= BODY_HEAD_CHARS)
  check('🔴 입력에 없는 것은 출력에도 없다 — 지어내지 않는다', (() => {
    const src = ok()
    return !('rawBody' in src) && !('rawBody' in d) && !('rawBody' in r)
  })())

  // 🔴 출력 직전 관문
  check('🟢 온전한 행은 통과', violatesAdapt(d, DETAIL_KEYS, BODY_HEAD_CHARS).length === 0)
  for (const k of FORBIDDEN_KEYS) {
    check(`🔴 ${k} 가 섞이면 잡는다`,
      violatesAdapt({ ...d, [k]: '원문' }, DETAIL_KEYS, BODY_HEAD_CHARS).some((m) => m.includes(k)))
  }
  check('🔴 계약 밖 키도 잡는다',
    violatesAdapt({ ...d, memo: 'x' }, DETAIL_KEYS, BODY_HEAD_CHARS).some((m) => m.includes('memo')))
  check(`🔴 bodyHead 초과를 잡는다`, violatesAdapt(
    { ...d, bodyHead: '가'.repeat(BODY_HEAD_CHARS + 1) }, DETAIL_KEYS, BODY_HEAD_CHARS,
  ).some((m) => m.includes('넘는다')))
}

console.log('\n② 🔴 읽지 못한 글을 ok 로 적지 않는다')
{
  check('본문이 있으면 ok', accessOf(ok({ bodyLength: 100 })) === 'ok')
  check('🔴 404 로 0자면 failed — 판단 대상이 아니다', accessOf(ok({ bodyLength: 0 })) === 'failed')
  check('길이가 없으면 failed', accessOf({}) === 'failed')
  check('detail 사본이 access 를 그대로 옮긴다',
    toDetailRecord(ok({ bodyLength: 0 })).access === 'failed')
  check('🔴 raw 사본은 키 이름이 accessStatus 다 — 화면이 그걸 본다',
    'accessStatus' in toRawDetailRecord(ok()) && !('access' in toRawDetailRecord(ok())))
  check('🔴 두 사본의 판정이 같다', (() => {
    const t = ok({ bodyLength: 0 })
    return toDetailRecord(t).access === toRawDetailRecord(t).accessStatus
  })())
}

console.log('\n③ 없는 값은 안전한 기본값으로')
{
  const d = toDetailRecord(ok())
  check(`imageCount = ${DEFAULT_IMAGE_COUNT}`, d.imageCount === DEFAULT_IMAGE_COUNT)
  check(`lengthBasis = ${DEFAULT_LENGTH_BASIS}`, d.lengthBasis === DEFAULT_LENGTH_BASIS)
  check('🔴 assetAxes 를 지어내지 않는다 — thin 은 사연 축을 안 쟀다', d.assetAxes === '')
  check('빈 입력도 터지지 않는다', (() => {
    const e = toDetailRecord({})
    return e.access === 'failed' && e.bodyLength === 0 && e.title === ''
  })())
  check('숫자가 아닌 값은 0 으로', toDetailRecord({ score: NaN }).score === 0)
  check('유지 필드가 그대로 온다', (() => {
    const t = ok()
    const x = toDetailRecord(t)
    return x.sourceArticleId === t.sourceArticleId && x.url === t.url
      && x.title === t.title && x.runId === t.runId && x.commentCount === t.commentCount
  })())
  check('fetchedAt 은 raw 사본에 남는다', toRawDetailRecord(ok()).fetchedAt === ok().fetchedAt)
}

console.log('\n④ 🔴 drop · hardExclude 는 어느 화면에도 오르지 않는다')
{
  const rows = [
    ok({ sourceArticleId: 'a1', axis: SOURCE_AXIS }),
    ok({ sourceArticleId: 'a2', axis: RAW_AXIS }),
    ok({ sourceArticleId: 'a3', axis: SRN_AXIS }),
    ok({ sourceArticleId: 'a4', axis: 'drop', safetyVerdict: 'hardExclude' }),
    ok({ sourceArticleId: 'a5', axis: SOURCE_AXIS, safetyVerdict: 'hardExclude' }),
    ok({ sourceArticleId: 'a6', axis: SOURCE_AXIS, bodyLength: 0 }),
  ]
  const s = statsOf(rows)
  check('소스 후보 1건', s.sourceCandidates === 1)
  check('raw 후보 1건', s.rawCandidates === 1)
  check(`${SRN_AXIS} 는 따로 센다 — 발행 후보화하지 않는다`, s.srn === 1)
  check('🔴 drop·hardExclude 2건이 후보에서 빠진다', s.dropped === 2)
  check('🔴 safety 가 pass 가 아니면 축이 맞아도 안 오른다',
    !rows.filter((r) => r.sourceArticleId === 'a5')
      .every(() => statsOf([rows[4]!]).sourceCandidates === 1))
  check('🔴 읽지 못한 글도 안 오른다', statsOf([rows[5]!]).sourceCandidates === 0)
  check('읽지 못한 것을 따로 센다', s.unreadable === 1)
  check('전체 수는 그대로', s.total === 6)
}

console.log('\n⑤ 🔴 하지 않는 것 — 스캔')
{
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-82cook-thin-adapt.mts')
  const lib = codeOf('src/lib/micro-seed-82cook-thin-adapt.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['네트워크', /fetch\(|axios|playwright|chromium/i],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['Raw Vault', /microSeedRawContent/],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(/],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }
  check('🔴 lib 은 순수 함수만이다',
    !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 thin 원본을 쓰지 않는다 — 읽기만 한다',
    !/writeFileSync\([^)]*thin-detail/.test(runner))
  check('🔴 사본 파일명이 원본과 다르다', /82cook-adapt-/.test(runner))
  check('계획이 기본이고 --apply 가 있어야 쓴다',
    /const APPLY = argv\.includes\('--apply'\)/.test(runner))
  check('🔴 산출물은 데이터 디렉터리 안에만', /isInsideDataDir/.test(runner))
  check('🔴 같은 회차를 두 번 내지 않는다', /adaptedRunIds/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑥ 🔴 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  check('POST_CAP_PER_WEEK = 1 그대로', /export const POST_CAP_PER_WEEK = 1\b/.test(m))
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', /export const MIN_DAYS_BETWEEN_POSTS = 5\b/.test(m))
  check('DAILY_PUBLISH_CAP = 1 그대로',
    /export const DAILY_PUBLISH_CAP = 1\b/.test(readFileSync('src/lib/original-post-publish.ts', 'utf-8')))
  check(`BODY_HEAD_CHARS = ${BODY_HEAD_CHARS} 그대로`,
    /export const BODY_HEAD_CHARS = 300\b/.test(readFileSync('scripts/lib/micro-seed-raw-originality.mts', 'utf-8')))
  check('🔴 thin 저장 계약을 바꾸지 않았다',
    /export const PACE_MIN_MS = 3000\b/.test(readFileSync('src/lib/micro-seed-82cook-thin.ts', 'utf-8')))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
