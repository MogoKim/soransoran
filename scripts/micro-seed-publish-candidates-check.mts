#!/usr/bin/env tsx
/**
 * 발행 후보 파일 fixture — 🔴 **계약이 어긋나면 여기서 멈춘다** (§4-AH)
 *
 * 읽기만 한다. 네트워크·DB·파일 쓰기 0.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PUBLISH_COLUMNS, PUBLISH_NOTE, candidateKey, dedupe, toTsv,
  type PublishCandidate,
} from './lib/micro-seed-publish-candidates.mjs'
import {
  fromSeedReview, fromRawRewrite, safetyIndex, collect, isInsideDataDir, publishRunId,
} from './micro-seed-publish-candidates.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const seedRow = (o: Record<string, unknown>): Record<string, unknown> => ({
  decision: 'ADOPT', sourceArticleId: 'S1', sourceSite: 'site', title: '제목', body: '초안 본문',
  safetyVerdict: 'pass', maxOverlap: 2, leakedTokens: '', reviewedAt: '2026-09-06T00:00:00Z',
  generatedAt: '2026-09-05T00:00:00Z', ...o,
})
const rawRow = (o: Record<string, unknown>): Record<string, unknown> => ({
  decision: 'SAVE', sourceArticleId: 'R1', sourceSite: 'site', draftTitle: '새 제목',
  draftBody: '사람이 쓴 본문', overlapWithSource: 4, writtenBy: 'human',
  writtenAt: '2026-09-06T01:00:00Z', sourceTitle: '원문 제목', sourceBodyLength: 500, ...o,
})

console.log('\n발행 후보 파일 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① Seed — ADOPT 만 들어온다')
{
  const got = fromSeedReview([
    seedRow({ sourceArticleId: 'a' }),
    seedRow({ sourceArticleId: 'b', decision: 'REVISE' }),
    seedRow({ sourceArticleId: 'c', decision: 'DROP' }),
    seedRow({ sourceArticleId: 'd', decision: '' }),
  ], 'seed.json')
  check('🔴 ADOPT 만 후보다', got.length === 1 && got[0]!.sourceArticleId === 'a')
  check('🔴 REVISE 제외', !got.some((c) => c.sourceArticleId === 'b'))
  check('🔴 DROP 제외', !got.some((c) => c.sourceArticleId === 'c'))
  check('🔴 미선택 제외', !got.some((c) => c.sourceArticleId === 'd'))
  check('candidateType 이 seedOriginality', got[0]!.candidateType === 'seedOriginality')
  check('sourceDecision 에 ADOPT 가 남는다', got[0]!.sourceDecision === 'ADOPT')
  check('어느 파일에서 왔는지 남는다', got[0]!.sourceInput === 'seed.json')
  check('body 는 초안 본문이다', got[0]!.body === '초안 본문')
  check('출처 설명이 붙는다', /Seed Originality 초안/.test(got[0]!.provenanceNote))
}

console.log('\n② Raw — SAVE 만 들어온다')
{
  const got = fromRawRewrite([
    rawRow({ sourceArticleId: 'a' }),
    rawRow({ sourceArticleId: 'b', decision: 'HOLD' }),
    rawRow({ sourceArticleId: 'c', decision: 'DROP' }),
    rawRow({ sourceArticleId: 'd', decision: '' }),
  ], 'raw.json', new Map([['a', 'pass']]))
  check('🔴 SAVE 만 후보다', got.length === 1 && got[0]!.sourceArticleId === 'a')
  check('🔴 HOLD 제외', !got.some((c) => c.sourceArticleId === 'b'))
  check('🔴 DROP 제외', !got.some((c) => c.sourceArticleId === 'c'))
  check('🔴 미선택 제외', !got.some((c) => c.sourceArticleId === 'd'))
  check('candidateType 이 rawOriginality', got[0]!.candidateType === 'rawOriginality')
  check('title 은 draftTitle 이다', got[0]!.title === '새 제목')
  check('🔴 body 는 사람이 쓴 글이다 — 원문이 아니다', got[0]!.body === '사람이 쓴 본문')
  check('safety 를 승인 파일에서 끌어온다', got[0]!.safetyVerdict === 'pass')
  check('safety 를 못 찾으면 빈 값', fromRawRewrite([rawRow({})], 'raw.json')[0]!.safetyVerdict === '')
  check('겹침이 maxOverlap 으로 온다', got[0]!.maxOverlap === 4)
  check('누가 썼는지 출처에 남는다', /사람이 직접 씀\(human\)/.test(got[0]!.provenanceNote))
}

console.log('\n③ 🔴 원문이 새 파일에 들어가지 않는다')
{
  check('🔴 컬럼에 bodyHead 가 없다', !PUBLISH_COLUMNS.includes('bodyHead'))
  check('🔴 컬럼에 sourceBody 가 없다', !PUBLISH_COLUMNS.includes('sourceBody'))
  check('🔴 컬럼에 sourceTitle 이 없다 — 원문 제목도 넣지 않는다',
    !PUBLISH_COLUMNS.includes('sourceTitle'))
  // 🔴 입력에 원문이 섞여 있어도 산출로 새어 나가지 않아야 한다
  const got = fromRawRewrite([rawRow({ sourceTitle: '원문제목ABC', bodyHead: '원문본문XYZ' })], 'raw.json')
  const line = toTsv(got)
  check('🔴 입력의 원문 제목이 TSV 에 없다', !line.includes('원문제목ABC'))
  check('🔴 입력의 원문 본문이 TSV 에 없다', !line.includes('원문본문XYZ'))
  const seed = fromSeedReview([seedRow({ bodyHead: '원문조각QQQ' })], 'seed.json')
  check('🔴 Seed 쪽도 마찬가지', !toTsv(seed).includes('원문조각QQQ'))
}

console.log('\n④ 중복 — 같은 글은 최신 판단만 남는다')
{
  const c = (o: Partial<PublishCandidate>): PublishCandidate => ({
    candidateType: 'seedOriginality', sourceArticleId: 'X', sourceSite: 's',
    sourceInput: 'f1', sourceDecision: 'ADOPT', title: 'T', body: 'B',
    safetyVerdict: 'pass', maxOverlap: 0, leakedTokens: '',
    reviewedAt: '2026-09-05T00:00:00Z', writtenAt: '', provenanceNote: '', ...o,
  })
  const { kept, dropped } = dedupe([
    c({ sourceInput: 'r2', reviewedAt: '2026-09-05T00:00:00Z', body: '옛것' }),
    c({ sourceInput: 'r3', reviewedAt: '2026-09-06T00:00:00Z', body: '새것' }),
  ])
  check('🔴 같은 글은 하나만 남는다', kept.length === 1)
  check('🔴 최신 reviewedAt 이 이긴다', kept[0]!.body === '새것' && kept[0]!.sourceInput === 'r3')
  check('무엇을 버렸는지 남긴다', dropped.length === 1 && dropped[0]!.droppedFrom === 'r2')
  check('순서를 바꿔도 결과가 같다', dedupe([
    c({ sourceInput: 'r3', reviewedAt: '2026-09-06T00:00:00Z', body: '새것' }),
    c({ sourceInput: 'r2', reviewedAt: '2026-09-05T00:00:00Z', body: '옛것' }),
  ]).kept[0]!.body === '새것')

  // 🔴 이것이 이 파일의 핵심 판단이다 — id 로만 묶으면 서로 다른 글이 사라진다
  const twoDrafts = dedupe([
    c({ sourceArticleId: '34999239', title: '후라이팬 언제 바꾸세요?' }),
    c({ sourceArticleId: '34999239', title: '주방에서 제일 오래 쓴 물건이 뭐예요?' }),
  ])
  check('🔴 같은 원천의 서로 다른 초안 둘 다 남는다 — id 로만 묶지 않는다',
    twoDrafts.kept.length === 2)
  check('키는 id+제목이다', candidateKey('a', ' 제목  하나 ') === 'a 제목 하나')
  check('빈 reviewedAt 은 진다', dedupe([
    c({ sourceInput: 'has', reviewedAt: '2026-01-01T00:00:00Z' }),
    c({ sourceInput: 'none', reviewedAt: '' }),
  ]).kept[0]!.sourceInput === 'has')
}

console.log('\n⑤ TSV · JSON 키 일치')
{
  const got = fromSeedReview([seedRow({})], 'seed.json')
  const lines = toTsv(got).split('\n')
  check('첫 줄이 컬럼과 같다', lines[0] === PUBLISH_COLUMNS.join('\t'))
  check('열 수가 맞는다', lines[1]!.split('\t').length === PUBLISH_COLUMNS.length)
  const keys = Object.keys(got[0]!)
  check('🔴 JSON 키와 TSV 컬럼이 같은 집합이다',
    keys.length === PUBLISH_COLUMNS.length && keys.every((k) => PUBLISH_COLUMNS.includes(k)))
  {
    // 🔴 본문에 탭·줄바꿈이 있어도 행이 쪼개지면 안 된다 — 열 수와 본문 셀을 직접 본다
    const t = toTsv(fromSeedReview([seedRow({ body: 'a\tb\nc' })], 'f'))
    const body = t.split('\n')[1]!.split('\t')[PUBLISH_COLUMNS.indexOf('body')]
    check('탭·줄바꿈이 셀을 깨지 않는다',
      t.split('\n').filter((l) => l.trim() !== '').length === 2
      && t.split('\n')[1]!.split('\t').length === PUBLISH_COLUMNS.length
      && body === 'a b c')
  }
  check('발행이 아님을 문구에 박는다', /발행 아님/.test(PUBLISH_NOTE) && /발행 후보일 뿐/.test(PUBLISH_NOTE))
  check('회차 id 는 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(publishRunId(new Date())))
}

console.log('\n⑥ 경로 가드')
{
  check('🟢 정상 경로 허용', isInsideDataDir('.microseed-data/publish-candidates-1.tsv'))
  check('🟢 ./ 접두도 같은 경로', isInsideDataDir('./.microseed-data/x.json'))
  check('🔴 바깥 경로 거부', !isInsideDataDir('docs/x.tsv'))
  check('🔴 .. 탈출 거부', !isInsideDataDir('.microseed-data/../x.tsv'))
  check('🔴 비슷한 이름 거부', !isInsideDataDir('.microseed-data-other/x.tsv'))
}

console.log('\n⑦ 입력 모으기 · SRN 제외')
{
  const dir = mkdtempSync(join(tmpdir(), 'pub-cand-'))
  writeFileSync(join(dir, 'seed-review-r1.json'),
    JSON.stringify({ decisions: [seedRow({ sourceArticleId: 'S' })] }), 'utf-8')
  writeFileSync(join(dir, 'raw-rewrite-workbench-1.json'),
    JSON.stringify({ drafts: [rawRow({ sourceArticleId: 'R' })] }), 'utf-8')
  writeFileSync(join(dir, 'raw-originality-approvals-1.json'),
    JSON.stringify({ decisions: [{ sourceArticleId: 'R', safetyVerdict: 'pass' }] }), 'utf-8')
  // 🔴 SRN 승인 파일이 있어도 후보에 오면 안 된다 — noindex 정책이 다르다
  writeFileSync(join(dir, 'srn-approvals-1.json'),
    JSON.stringify({ decisions: [{ decision: 'APPROVE', sourceArticleId: 'SRN', title: 'srn제목', body: 'srn본문' }] }), 'utf-8')
  const { candidates, seedFiles, rawFiles } = collect(dir)
  check('Seed·Raw 파일을 찾는다', seedFiles.length === 1 && rawFiles.length === 1)
  check('두 레인이 모인다', candidates.length === 2)
  check('🔴 SRN(APPROVE)이 오지 않는다 — noindex 정책이 다르다',
    !candidates.some((c) => c.sourceArticleId === 'SRN'))
  check('🔴 SRN 본문이 산출에 없다', !toTsv(candidates).includes('srn본문'))
  check('Raw 의 safety 가 승인 파일에서 채워진다',
    candidates.find((c) => c.candidateType === 'rawOriginality')!.safetyVerdict === 'pass')
  check('safetyIndex 가 id→verdict 를 만든다', safetyIndex(dir).get('R') === 'pass')
  check('깨진 파일이 있어도 죽지 않는다', (() => {
    writeFileSync(join(dir, 'seed-review-broken.json'), '{깨짐', 'utf-8')
    return collect(dir).candidates.length === 2
  })())
  check('없는 디렉터리는 빈 결과', collect(join(dir, 'nope')).candidates.length === 0)
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n⑧ 금지 — 생성기 코드')
{
  const src = readFileSync('scripts/micro-seed-publish-candidates.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [label, re] of [
    ['prisma / DB write', /prisma|PrismaClient|\.upsert\(|\.create\(/i],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['LLM 호출', /openai|anthropic|claude-|gpt-/i],
    ['브라우저 · 네트워크', /playwright|puppeteer|chromium|fetch\(/],
    ['82cook adapter', /82cook/],
    ['네이버 접속', /cafe\.naver\.com|SESSION_PATH/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))
  check('🔴 SRN 승인 파일을 읽지 않는다', !/srn-approvals/.test(src))
  check('엔트리포인트 가드', /if \(isDirectRun\) main\(\)/.test(src))
  check('🔴 산출 경로를 가드한다', /assertInsideDataDir\(tsvPath\)/.test(src))
}

console.log('\n⑨ 실제 산출물이 있으면 함께 본다')
try {
  const { candidates, seedFiles, rawFiles } = collect('.microseed-data')
  if (seedFiles.length === 0 && rawFiles.length === 0) throw new Error('no files')
  const { kept } = dedupe(candidates)
  check(`실 파일 Seed ${seedFiles.length} · Raw ${rawFiles.length} → 후보 ${kept.length}건`, kept.length > 0)
  check('🔴 전부 ADOPT 또는 SAVE 다',
    kept.every((c) => c.sourceDecision === 'ADOPT' || c.sourceDecision === 'SAVE'))
  check('🔴 축이 둘뿐이다',
    kept.every((c) => c.candidateType === 'seedOriginality' || c.candidateType === 'rawOriginality'))
  check('🔴 제목·본문이 비어 있지 않다', kept.every((c) => c.title !== '' && c.body !== ''))
  check('🔴 겹침이 전부 6자 미만', kept.every((c) => c.maxOverlap < 6))
} catch {
  console.log('  🟡 .microseed-data 에 검수 결과 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
