#!/usr/bin/env tsx
/**
 * VoiceSource 적재 fixture — 네트워크 · DB 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1 · §6-2 · §7
 *
 * 🔴 이 fixture 가 검사하는 것은 "적재가 되는가" 가 아니라
 *    **"원문이 넘어오지 않는가 · 배치로 번지지 않는가"** 다.
 *    적재 성공은 사람이 --apply 로 확인한다. 여기서 잠그는 것은 되돌리기 어려운 쪽이다.
 *
 * 🔴 가장 중요한 검사는 ①②⑥ 이다.
 *    ① 원문을 DB 에 쓰는가 — 1차 전략 전체가 여기 걸려 있다
 *    ② usedAt 을 approved 로 쓰는가 — 학습 정답지가 거짓이 된다
 *    ⑥ 33,031건 배치로 번지는가 — 되돌리기 어렵다
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { USED_AT_DECISION, FORBIDDEN_VOICE_SOURCE_COLUMNS, toSourceRow } from './lib/voice-unao-readonly.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const IMPORTER = join(HERE, 'voice-unao-import-live.mts')
const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

const rawSrc = readFileSync(IMPORTER, 'utf-8')
/** 🔴 `/**` 로 시작하는 한 줄 JSDoc 도 걷어낸다 — 설명을 위반으로 읽으면 안 된다 */
const code = rawSrc.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')

/** `voiceSource.create` 의 data 블록만 잘라낸다 */
function createDataBlock(): string {
  const i = code.indexOf('voiceSource.create(')
  if (i === -1) return ''
  const j = code.indexOf('select:', i)
  return code.slice(i, j === -1 ? i + 1200 : j)
}

// ── ① 원문을 DB 에 쓰지 않는다 ──────────────────────────
//    🔴 1차 전략 전체가 여기 걸려 있다 —
//       "우나어 DB read-only 참조 + 소란소란 DB 에는 Derived 자산만".
{
  const offenders: string[] = []
  const block = createDataBlock()
  if (!block) offenders.push('voiceSource.create 를 찾지 못했다')
  for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
    if (new RegExp(`\\b${f}\\s*:`).test(block)) offenders.push(`create data 에 ${f}`)
  }
  // 원문을 담은 변수를 그대로 넘기지 않는가
  if (/:\s*raw\.content\b|:\s*content\b/.test(block)) offenders.push('create data 에 본문 변수')
  if (/:\s*raw\.author\b|:\s*author\b/.test(block)) offenders.push('create data 에 닉네임 원문')
  if (/:\s*raw\.topComments\b/.test(block)) offenders.push('create data 에 댓글 원문')
  // schema 쪽도 본다 — 컬럼 자체가 없어야 한다
  const schema = readFileSync(join(HERE, '../prisma/schema.prisma'), 'utf-8')
  const m = schema.match(/model VoiceSource \{([\s\S]*?)\n\}/)
  if (!m) offenders.push('schema 에 VoiceSource 가 없다')
  else {
    const body = m[1].split('\n').filter((l) => !/^\s*\/\/\/?/.test(l)).join('\n')
    for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
      if (new RegExp(`^\\s*${f}\\s+`, 'm').test(body)) offenders.push(`schema VoiceSource.${f}`)
    }
  }
  if (offenders.length) bad('원문을 DB 에 쓰지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('원문을 DB 에 쓰지 않는다', 'guard', 'create data · schema 양쪽에 본문 컬럼 0')
}

// ── ② usedAt 은 referenced 다 ───────────────────────────
//    🔴 6,494건 중 발행으로 이어진 것은 13건(0.2%)뿐이다.
{
  const offenders: string[] = []
  if (USED_AT_DECISION !== 'referenced') offenders.push(`USED_AT_DECISION=${USED_AT_DECISION}`)
  if (/decision\s*:\s*['"]approved['"]/.test(code)) offenders.push("decision: 'approved' 리터럴")
  // judgment 생성부가 상수를 쓰는가 (문자열을 새로 적으면 갈라진다)
  const ji = code.indexOf('voiceJudgment.create(')
  if (ji === -1) offenders.push('voiceJudgment.create 가 없다')
  else {
    const jblock = code.slice(ji, ji + 700)
    if (!/decision\s*:\s*USED_AT_DECISION/.test(jblock)) offenders.push('decision 이 USED_AT_DECISION 상수가 아니다')
    if (!/decidedBy\s*:\s*['"]unao-curation['"]/.test(jblock)) offenders.push("decidedBy 가 'unao-curation' 이 아니다")
  }
  // 적재 후 approved 가 생겼는지 확인하는 방어가 있는가
  if (!/decision === 'approved'/.test(code)) offenders.push('read-back 에서 approved 검사 없음')
  if (offenders.length) bad('usedAt 은 referenced 다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('usedAt 은 referenced 다', 'policy', 'approved 리터럴 0 · read-back 방어 있음')
}

// ── ③ --apply + --limit=1 게이트 ────────────────────────
//    🔴 write 는 전부 게이트 뒤에 있어야 한다.
{
  const applyOptIn = /const APPLY = process\.argv\.includes\('--apply'\)/.test(code)
  const gate = code.indexOf('if (!APPLY || LIMIT !== 1)')
  const srcWrite = code.indexOf('voiceSource.create(')
  const judgeWrite = code.indexOf('voiceJudgment.create(')
  const gated = gate !== -1 && srcWrite > gate && judgeWrite > gate
  // --apply 만 주고 limit 이 다르면 거부하는 안내가 있는가
  const explains = /--limit=1 이 아니라 거부/.test(rawSrc)
  if (applyOptIn && gated && explains) {
    ok('--apply + --limit=1 게이트', 'guard', 'write 는 전부 게이트 뒤')
  } else {
    bad('--apply + --limit=1 게이트', 'guard', `optIn=${applyOptIn} gated=${gated} explains=${explains}`)
  }
}

// ── ④ 소란소란 write 는 Voice 두 테이블뿐 ───────────────
{
  const offenders: string[] = []
  for (const m of code.matchAll(/(?:tx|prisma)\.([A-Za-z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)) {
    if (!['voiceSource', 'voiceJudgment'].includes(m[1])) offenders.push(`${m[1]}.${m[2]}`)
  }
  if (/microSeed|post\.(create|update)|\$executeRaw/.test(code)) {
    if (/microSeed[A-Za-z]*\.(create|update|delete)/.test(code)) offenders.push('Micro Seed 원장 write')
  }
  if (offenders.length) bad('소란소란 write 는 Voice 뿐', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('소란소란 write 는 Voice 뿐', 'guard', 'voiceSource · voiceJudgment 외 write 0')
}

// ── ⑤ 두 DB 의 역할이 갈려 있다 ─────────────────────────
//    🔴 한 커넥션으로 반대쪽을 건드리는 경로가 없어야 한다.
{
  const offenders: string[] = []
  // 우나어 읽기는 read-only URL 로만
  if (!/loadUnaoReadonlyUrl\(/.test(code)) offenders.push('우나어 URL 로더 미사용')
  const bare = code.replace(/UNAO_READONLY_DATABASE_URL/g, '')
  if (/process\.env\.DATABASE_URL|process\.env\[['"]DATABASE_URL/.test(bare)) offenders.push('DATABASE_URL 직접 참조')
  // pg 클라이언트에 소란소란 URL 을 물리지 않는가
  for (const m of code.matchAll(/new pg\.Client\(\{[^}]*connectionString:\s*([A-Za-z_$][\w$]*)/g)) {
    if (m[1] !== 'unaoUrl') offenders.push(`pg.Client 에 ${m[1]}`)
  }
  // 우나어 쪽에 write 를 하지 않는가
  if (/unao\.query\(['"`]\s*(INSERT|UPDATE|DELETE)/i.test(code)) offenders.push('우나어에 write 쿼리')
  if (offenders.length) bad('두 DB 역할 분리', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('두 DB 역할 분리', 'guard', '우나어=read-only URL · 소란소란=Prisma')
}

// ── ⑥ 배치로 번지지 않는다 ──────────────────────────────
//    🔴 33,031건을 한 번에 넣으면 되돌리기 어렵다. 이번 단계는 1건이다.
{
  const offenders: string[] = []
  if (/createMany/.test(code)) offenders.push('createMany')
  if (/for\s*\([^)]*of\s+rows\b|\.map\([^)]*=>\s*(?:tx|prisma)\./.test(code)) offenders.push('행 루프 안에서 write')
  // 쿼리가 LIMIT 1 인가
  const sample = readFileSync(join(HERE, 'lib/voice-unao-readonly.mts'), 'utf-8')
  if (!/LIMIT 1\b/.test(sample)) offenders.push('sampleOne 이 LIMIT 1 이 아니다')
  // limit 을 크게 줘도 apply 가 막히는가 — 게이트가 LIMIT !== 1 인지
  if (!/LIMIT !== 1/.test(code)) offenders.push('LIMIT !== 1 게이트 없음')
  if (offenders.length) bad('배치로 번지지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('배치로 번지지 않는다', 'guard', 'createMany 0 · 루프 write 0 · LIMIT 1')
}

// ── ⑦ 중복 sourceRef 는 SKIP ────────────────────────────
{
  const hasLookup = /voiceSource\.findUnique\(/.test(code)
  const usesUnique = /origin_sourceRef\s*:/.test(code)
  const skips = /SKIP/.test(rawSrc) && /if \(existing\)/.test(code)
  // 조회가 create 앞에 있는가 — 위치로 본다
  const lookupAt = code.indexOf('voiceSource.findUnique(')
  const createAt = code.indexOf('voiceSource.create(')
  const orderOk = lookupAt !== -1 && createAt !== -1 && lookupAt < createAt
  if (hasLookup && usesUnique && skips && orderOk) {
    ok('중복 sourceRef 는 SKIP', 'guard', 'UNIQUE(origin, sourceRef) 조회가 create 앞')
  } else {
    bad('중복 sourceRef 는 SKIP', 'guard',
      `lookup=${hasLookup} unique=${usesUnique} skip=${skips} order=${orderOk}`)
  }
}

// ── ⑧ 원문 · 댓글 전문을 로그로 흘리지 않는다 ───────────
{
  const offenders: string[] = []
  // 🔴 순수 문자열 리터럴이 아니라 **템플릿 표현식 안의 변수 참조**만 본다.
  //    "content 를 저장하지 않는다" 같은 안내 문구까지 막으면 설명을 못 쓴다.
  //    (실제로 그 문구가 위반으로 잡혔다)
  for (const m of code.matchAll(/console\.(log|info|warn|error)\(([^\n]*)/g)) {
    for (const expr of m[2].matchAll(/\$\{([^}]*)\}/g)) {
      const inner = expr[1]
      if (/\b(raw|row)\.(content|author|topComments|rawBody)\b/.test(inner) && !/Length|Hash|Count|slice/.test(inner)) {
        offenders.push(`console.${m[1]}(\${${inner.slice(0, 30)}})`)
      }
    }
  }
  // URL 전체를 찍지 않는가 — maskUrl 을 거치는가
  if (/\$\{row\.sourceUrl\}/.test(code)) offenders.push('sourceUrl 전체 출력')
  if (!/maskUrl\(row\.sourceUrl\)/.test(code)) offenders.push('sourceUrl 마스킹 미적용')
  // 해시는 앞부분만 남기는가 — 에러 메시지도 포함한다
  if (/\$\{(row|back)\.contentHash\}/.test(code)) offenders.push('contentHash 전체 출력')
  if (/\$\{row\.authorHash\}/.test(code)) offenders.push('authorHash 전체 출력')
  if (offenders.length) bad('원문을 로그로 흘리지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('원문을 로그로 흘리지 않는다', 'guard', '요약 · 마스킹 URL · 해시 앞 20자')
}

// ── ⑨ 변환이 본문을 버린다 (실제 호출) ──────────────────
{
  const row = toSourceRow({
    id: 'cafe-1', cafeId: 'wgang', boardName: '자유게시판', postUrl: 'https://cafe.naver.com/x/1',
    author: '홍길동', content: '이건 원문 본문입니다.'.repeat(30), commentCount: 12,
    crawledAt: new Date('2026-08-01T00:00:00Z'), postedAt: new Date('2020-03-01T00:00:00Z'),
    usedAt: new Date('2026-05-14T00:00:00Z'),
    desireCategory: 'HEALTH', ageSignal: '50s', urgencyLevel: 4,
  }, 'salt-x')
  const json = JSON.stringify(row)
  const offenders: string[] = []
  if (json.includes('이건 원문 본문입니다')) offenders.push('본문이 남았다')
  if (json.includes('홍길동')) offenders.push('닉네임 원문이 남았다')
  if (row.contentLength !== '이건 원문 본문입니다.'.repeat(30).length) offenders.push('길이가 틀리다')
  if (!row.contentHash?.startsWith('sha256:')) offenders.push('해시 형식')
  if (row.referencedAt === null) offenders.push('usedAt 이 referencedAt 으로 오지 않았다')
  if (!row.legacyLabels || Object.keys(row.legacyLabels).length !== 3) offenders.push('라벨 보존 실패')
  if (offenders.length) bad('변환이 본문을 버린다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('변환이 본문을 버린다', 'policy', `${row.contentLength}자 → 해시만 · 라벨 3종 · referenced`)
}

// ── ⑩ VoiceDerived · VoiceCommentSignal 을 만들지 않는다 ──
//    🔴 이번 단계 범위 밖이다. 테이블도 아직 없다.
{
  const offenders: string[] = []
  if (/voiceDerived/i.test(code)) offenders.push('VoiceDerived 참조')
  if (/voiceCommentSignal/i.test(code)) offenders.push('VoiceCommentSignal 참조')
  if (/openai|anthropic|claude|gpt-/i.test(code)) offenders.push('LLM 참조')
  if (/\bfetch\s*\(|axios/.test(code)) offenders.push('외부 네트워크')
  if (offenders.length) bad('범위 밖을 건드리지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('범위 밖을 건드리지 않는다', 'guard', 'Derived · CommentSignal · LLM · fetch 0')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nVoiceSource 적재 — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB 를 타지 않는다')
console.log('  🔴 검사하는 것은 "적재가 되는가" 가 아니라 "원문이 넘어오지 않는가 · 배치로 번지지 않는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(32)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 적재 경로가 선을 넘지 않는다\n`)
