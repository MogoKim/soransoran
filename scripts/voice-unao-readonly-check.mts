#!/usr/bin/env tsx
/**
 * 우나어 read-only 커넥터 fixture — 네트워크 · DB 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1 · §5 · §7
 *
 * 🔴 이 fixture 가 검사하는 것은 "읽기가 되는가" 가 아니라
 *    **"쓰지 못하는가 · 원문을 흘리지 않는가"** 다.
 *    읽기 성공은 사람이 실제 접속으로 확인한다. 여기서 잠그는 것은 되돌리기 어려운 쪽이다.
 *
 * 🔴 가장 중요한 검사는 ① 과 ⑥ 이다.
 *    ① 커넥터가 write SQL 을 만들 수 있는가 — 우나어는 우리 운영 DB 다
 *    ⑥ VoiceSource 에 원문 컬럼이 생기는가 — 1차 전략 전체가 여기 걸려 있다
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UNAO_READONLY_URL_ENV, UNAO_READABLE_TABLES, USED_AT_DECISION,
  FORBIDDEN_VOICE_SOURCE_COLUMNS, READ_QUERIES, LEGACY_LABEL_KEYS,
  maskConnectionString, loadUnaoReadonlyUrl, contentHashOf, authorHashOf,
  toSourceRow, countTopComments, summarize,
} from './lib/voice-unao-readonly.mjs'
import { authorHashKeyOf, type AuthorHashKey } from './lib/voice-author-hash.mjs'

/** 🔴 (2026-10-01 author-hash v2) 시험 전용 key — 합성 문자열(32자 이상). 운영 key 가 아니다 */
const testKey = (label: string): AuthorHashKey => {
  const r = authorHashKeyOf(`test-key-${label}-0123456789abcdef0123456789`)
  if (!r.ok) throw new Error('test key')
  return r.key
}

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, 'lib/voice-unao-readonly.mts')
const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

/**
 * 주석을 걷어낸 실행 코드만 본다 — 주석의 단어를 위반으로 읽으면 정당한 설명을 막는다.
 *
 * 🔴 `/**` 로 시작하는 한 줄 JSDoc 도 걷어낸다. `*` 만 보면 그 줄이 통과해
 *    "approved 가 아니다" 같은 설명이 위반으로 잡힌다(실제로 잡혔다).
 */
const code = readFileSync(LIB, 'utf-8')
  .split('\n')
  .filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l))
  .join('\n')
const raw = readFileSync(LIB, 'utf-8')

// ── ① write SQL 을 만들지 않는다 ────────────────────────
//    🔴 우나어는 우리 운영 DB 다. 커넥터가 write 를 만들 수 있으면
//       role 권한과 read-only 트랜잭션이 뚫리는 날 막을 것이 없다.
{
  const offenders: string[] = []
  for (const kw of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'UPSERT', 'CREATE TABLE',
                    'CREATE INDEX', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE']) {
    if (code.includes(kw)) offenders.push(kw.trim())
  }
  // ON CONFLICT 는 upsert 의 신호다
  if (/ON CONFLICT/i.test(code)) offenders.push('ON CONFLICT')
  // 모든 쿼리 상수가 SELECT 로 시작하는가
  const nonSelect = Object.entries(READ_QUERIES)
    .filter(([, sql]) => !/^\s*SELECT/i.test(String(sql).trim()))
    .map(([k]) => k)
  if (nonSelect.length) offenders.push(`SELECT 아닌 쿼리: ${nonSelect.join(',')}`)

  if (offenders.length) bad('write SQL 을 만들지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('write SQL 을 만들지 않는다', 'guard', `쿼리 ${Object.keys(READ_QUERIES).length}종 전부 SELECT`)
}

// ── ② 소란소란 DB 를 참조하지 않는다 ────────────────────
//    🔴 한 파일에서 두 DB 를 다루면 실수로 반대쪽에 쓰는 순간이 온다.
{
  const offenders: string[] = []
  // 🔴 문자열 안의 언급이 아니라 **실제 참조**를 잡는다.
  //    에러 메시지에 "소란소란 DATABASE_URL 로 붙지 않는다" 라고 쓰는 것은
  //    오히려 사람에게 필요한 경고다 — 그걸 막으면 설명을 못 쓴다.
  const bare = code.replace(/UNAO_READONLY_DATABASE_URL/g, '')
  if (/process\.env\.DATABASE_URL|process\.env\[['"]DATABASE_URL/.test(bare)) offenders.push('DATABASE_URL 참조')
  if (/process\.env\.DIRECT_URL|process\.env\[['"]DIRECT_URL/.test(bare)) offenders.push('DIRECT_URL 참조')
  if (/@prisma\/client|PrismaClient/.test(code)) offenders.push('소란소란 Prisma 클라이언트')
  if (/micro-seed-time|loadEnvLocal\(/.test(code)) offenders.push('소란소란 env 로더')
  if (offenders.length) bad('소란소란 DB 를 참조하지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('소란소란 DB 를 참조하지 않는다', 'guard', `${UNAO_READONLY_URL_ENV} 만 쓴다`)
}

// ── ③ URL 이 없으면 즉시 실패한다 ───────────────────────
//    🔴 폴백이 있으면 "어느 DB 에 붙었는지" 를 알 수 없게 된다.
{
  const saved = process.env[UNAO_READONLY_URL_ENV]
  delete process.env[UNAO_READONLY_URL_ENV]
  let threw = false
  let msg = ''
  try {
    loadUnaoReadonlyUrl('__no_such_env_file__')
  } catch (e) {
    threw = true
    msg = e instanceof Error ? e.message : String(e)
  }
  if (saved !== undefined) process.env[UNAO_READONLY_URL_ENV] = saved
  // 기본값·폴백이 소스에 없는지도 본다
  const noFallback = !/\?\?\s*['"]postgres/i.test(code) && !/localhost/.test(code)
  if (threw && /read-only/.test(msg) && noFallback) {
    ok('URL 없으면 즉시 실패', 'guard', '기본값 · 폴백 없음')
  } else {
    bad('URL 없으면 즉시 실패', 'guard', `throw=${threw} noFallback=${noFallback}`)
  }
}

// ── ④ connection string 을 마스킹한다 ───────────────────
//    🔴 비밀번호는 길이조차 흘리지 않는다.
{
  const sample = 'postgresql://unao_voice_readonly.abcdefghijklmnop:SuperSecretPw123@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres'
  const masked = maskConnectionString(sample)
  const noPw = !masked.includes('SuperSecretPw123') && !/:[^:@*]{6,}@/.test(masked)
  const noFullHost = !masked.includes('aws-1-ap-southeast-2.pooler.supabase.com')
  const keepsShape = masked.includes('postgresql:') && masked.includes('6543')
  // 소스에 원본 URL 을 그대로 찍는 자리가 없는지
  const noRawLog = !/console\.log\([^)]*\b(url|connectionString)\b\s*\)/.test(code)
  if (noPw && noFullHost && keepsShape && noRawLog) {
    ok('connection string 마스킹', 'guard', masked)
  } else {
    bad('connection string 마스킹', 'guard', `pw=${noPw} host=${noFullHost} shape=${keepsShape} rawLog=${noRawLog}`)
  }
}

// ── ⑤ 원문을 로그로 흘리지 않는다 ───────────────────────
//    🔴 터미널 기록과 CI 로그는 우리가 통제하지 못하는 곳으로 남는다.
{
  const offenders: string[] = []
  // console 계열 호출 인자에 본문 필드가 들어가는지
  for (const m of code.matchAll(/console\.(log|info|warn|error|debug)\(([^\n]*)/g)) {
    const args = m[2]
    if (/\b(content|rawBody|body|topComments|author)\b/.test(args) && !/Length|Count|Hash|Name/.test(args)) {
      offenders.push(`console.${m[1]}(${args.slice(0, 40)}…)`)
    }
  }
  // 요약 타입에 본문이 없는지 — 실제 호출로 확인한다
  const s = summarize(
    toSourceRow({ id: 'x', cafeId: 'c', postUrl: 'u', author: '홍길동', content: '본문입니다'.repeat(20),
                  commentCount: 3, crawledAt: new Date(0) }, testKey('s')),
    5,
  )
  const summaryKeys = Object.keys(s)
  const leaks = summaryKeys.filter((k) => /^(content|body|rawBody|author|topComments)$/.test(k))
  if (leaks.length) offenders.push(`요약에 원문 필드: ${leaks.join(',')}`)
  if (JSON.stringify(s).includes('본문입니다')) offenders.push('요약에 본문 값이 실렸다')
  if (JSON.stringify(s).includes('홍길동')) offenders.push('요약에 닉네임 원문이 실렸다')

  if (offenders.length) bad('원문을 로그로 흘리지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('원문을 로그로 흘리지 않는다', 'guard', `요약 필드: ${summaryKeys.join(' · ')}`)
}

// ── ⑥ VoiceSource 에 원문 컬럼을 만들지 않는다 ──────────
//    🔴 1차 전략 전체가 여기 걸려 있다 —
//       "우나어 DB read-only 참조 + 소란소란 DB 에는 Derived 자산만".
//       원문 컬럼이 하나라도 생기면 33,031건 본문이 소란소란 DB 로 넘어온다.
{
  const offenders: string[] = []
  // 커넥터가 만드는 행 타입에 본문 필드가 없는가
  const row = toSourceRow({ id: 'x', cafeId: 'c', postUrl: 'u', author: 'a',
                            content: '본문', commentCount: 1, crawledAt: new Date(0) }, testKey('s'))
  for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
    if (f in (row as Record<string, unknown>)) offenders.push(`UnaoSourceRow.${f}`)
  }
  // schema.prisma 의 VoiceSource 모델에도 없는가 — 실제 파일을 읽는다
  const schema = readFileSync(join(HERE, '../prisma/schema.prisma'), 'utf-8')
  const m = schema.match(/model VoiceSource \{([\s\S]*?)\n\}/)
  if (!m) offenders.push('schema.prisma 에 VoiceSource 모델이 없다')
  else {
    const bodyLines = m[1].split('\n').filter((l) => !/^\s*(\/\/|\/\/\/)/.test(l))
    for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
      if (new RegExp(`^\\s*${f}\\s+`, 'm').test(bodyLines.join('\n'))) offenders.push(`schema VoiceSource.${f}`)
    }
    // 해시 · 길이는 있어야 한다 (원문 미복제의 대비책)
    for (const f of ['contentHash', 'contentLength']) {
      if (!new RegExp(`^\\s*${f}\\s+`, 'm').test(bodyLines.join('\n'))) offenders.push(`schema 에 ${f} 가 없다`)
    }
  }
  if (offenders.length) bad('VoiceSource 에 원문 컬럼이 없다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('VoiceSource 에 원문 컬럼이 없다', 'guard', '본문 0 · contentHash/Length 로 증거만')
}

// ── ⑦ usedAt 은 referenced 이지 approved 가 아니다 ──────
//    🔴 6,494건 중 발행으로 이어진 것은 13건(0.2%)뿐이다.
//       approved 로 넣으면 "사람이 승인했다" 는 거짓 정답지가 만들어진다.
{
  const offenders: string[] = []
  if (USED_AT_DECISION !== 'referenced') offenders.push(`USED_AT_DECISION=${USED_AT_DECISION}`)
  // 🔴 "usedAt 근처에 approved 라는 낱말이 있는가" 로 보지 않는다 —
  //    "approved 가 아니다" 라는 설명까지 위반으로 잡힌다(실제로 잡혔다).
  //    실제 매핑 코드만 본다.
  if (/referencedAt\s*:\s*[^\n]*approved/.test(code)) offenders.push('referencedAt 에 approved 를 넣는다')
  if (/approved[A-Za-z]*\s*:\s*raw\.usedAt/.test(code)) offenders.push('usedAt 을 approved 필드로 옮긴다')
  // 커넥터가 usedAt 을 referencedAt 으로 옮기는가
  const withUsed = toSourceRow({ id: 'x', cafeId: 'c', postUrl: 'u', content: '본문',
                                 crawledAt: new Date(0), usedAt: new Date('2026-05-14T00:00:00Z') }, testKey('s'))
  const withoutUsed = toSourceRow({ id: 'y', cafeId: 'c', postUrl: 'u', content: '본문',
                                    crawledAt: new Date(0) }, testKey('s'))
  if (withUsed.referencedAt === null) offenders.push('usedAt 이 referencedAt 으로 오지 않는다')
  if (withoutUsed.referencedAt !== null) offenders.push('usedAt 없는데 referencedAt 이 생겼다')
  if (!('approvedAt' in (withUsed as Record<string, unknown>))) {
    // approvedAt 필드가 아예 없어야 한다 — 있으면 혼동의 여지가 생긴다
  } else offenders.push('UnaoSourceRow 에 approvedAt 이 있다')

  if (offenders.length) bad('usedAt 은 referenced 다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('usedAt 은 referenced 다', 'policy', 'approved 아님 · referencedAt 으로만 옮긴다')
}

// ── ⑧ 읽는 테이블이 role 권한 범위 안이다 ───────────────
{
  const allowed = new Set<string>(UNAO_READABLE_TABLES)
  const tables = new Set<string>()
  for (const sql of Object.values(READ_QUERIES)) {
    for (const m of String(sql).matchAll(/FROM\s+"([A-Za-z]+)"/g)) tables.add(m[1])
  }
  const outside = [...tables].filter((t) => !allowed.has(t))
  if (outside.length) bad('권한 범위 안에서만 읽는다', 'guard', `🔴 범위 밖: ${outside.join(',')}`)
  else ok('권한 범위 안에서만 읽는다', 'guard', `${[...tables].join(' · ') || '(테이블 없음)'} ⊂ ${UNAO_READABLE_TABLES.join(' · ')}`)
}

// ── ⑨ 해시는 결정적이고 원문을 되돌릴 수 없다 ───────────
{
  const a = contentHashOf('같은 본문')
  const b = contentHashOf('같은 본문')
  const c = contentHashOf('다른 본문')
  const shape = /^sha256:[0-9a-f]{64}$/.test(a)
  const stable = a === b
  const distinct = a !== c
  const noPlain = !a.includes('본문')
  // 닉네임 해시는 salt 가 다르면 달라진다
  const h1 = authorHashOf('홍길동', testKey('1'))
  const h2 = authorHashOf('홍길동', testKey('2'))
  const h3 = authorHashOf('홍길동', testKey('1'))
  const saltMatters = h1 !== h2 && h1 === h3 && !h1.includes('홍길동')
  if (shape && stable && distinct && noPlain && saltMatters) {
    ok('해시 — 결정적 · 되돌릴 수 없음', 'policy', 'sha256:{64hex} · salt 반영')
  } else {
    bad('해시 — 결정적 · 되돌릴 수 없음', 'policy',
      `shape=${shape} stable=${stable} distinct=${distinct} plain=${noPlain} salt=${saltMatters}`)
  }
}

// ── ⑩ 댓글은 개수만 센다 ────────────────────────────────
//    🔴 댓글 본문 154,872개를 소란소란 DB 로 옮기지 않는다.
{
  const n = countTopComments([{ author: 'a', content: '댓글 본문', likeCount: 1 }, { author: 'b', content: 'x' }])
  const zero = countTopComments(null)
  const notArray = countTopComments('문자열')
  const returnsNumber = typeof n === 'number' && n === 2 && zero === 0 && notArray === 0
  // 커넥터가 댓글 본문을 담는 타입을 만들지 않는가
  const noCommentBody = !/topComments\s*:\s*(string|Array|unknown\[\])/.test(code)
  if (returnsNumber && noCommentBody) {
    ok('댓글은 개수만 센다', 'guard', '본문 미보관 · null/비배열 → 0')
  } else {
    bad('댓글은 개수만 센다', 'guard', `count=${returnsNumber} noBody=${noCommentBody}`)
  }
}

// ── ⑪ legacy 라벨을 그대로 보존한다 ─────────────────────
{
  const row = toSourceRow({
    id: 'x', cafeId: 'c', postUrl: 'u', content: '본문', crawledAt: new Date(0),
    desireCategory: 'HEALTH', ageSignal: '50s', urgencyLevel: 3, emotionTags: ['ANXIOUS'],
  }, testKey('s'))
  const kept = row.legacyLabels && row.legacyLabels.desireCategory === 'HEALTH'
    && row.legacyLabels.ageSignal === '50s' && row.legacyLabels.urgencyLevel === 3
  const versioned = row.legacyLabelVersion !== null
  // 라벨이 하나도 없으면 null 이어야 한다 — 빈 객체를 만들지 않는다
  const empty = toSourceRow({ id: 'y', cafeId: 'c', postUrl: 'u', content: '본문', crawledAt: new Date(0) }, testKey('s'))
  const nullWhenEmpty = empty.legacyLabels === null && empty.legacyLabelVersion === null
  // 라벨 키 목록에 본문 필드가 섞이지 않았는가
  // 🔴 부분 일치로 보면 `commentSplit` 의 `commentS` 가 `comments` 와 걸린다(실제로 걸렸다).
  //    라벨 키에 **원문 필드가 그대로** 섞였는지만 본다.
  const BODY_FIELDS = new Set(['content', 'body', 'rawBody', 'topComments', 'rawComments'])
  const noBodyInLabels = !(LEGACY_LABEL_KEYS as readonly string[]).some((k) => BODY_FIELDS.has(k))
  if (kept && versioned && nullWhenEmpty && noBodyInLabels) {
    ok('legacy 라벨 보존', 'policy', `${LEGACY_LABEL_KEYS.length}종 · 버전 기록 · 빈 값이면 null`)
  } else {
    bad('legacy 라벨 보존', 'policy', `kept=${kept} ver=${versioned} null=${nullWhenEmpty} noBody=${noBodyInLabels}`)
  }
}

// ── ⑫ 이 커넥터는 적재하지 않는다 ───────────────────────
//    🔴 VE-R1 의 범위는 "읽는 법" 까지다. 적재는 VE-R2 다.
{
  const offenders: string[] = []
  if (/voiceSource\.(create|createMany|upsert)/.test(code)) offenders.push('VoiceSource 적재')
  if (/voiceJudgment\.(create|createMany|upsert)/.test(code)) offenders.push('VoiceJudgment 적재')
  if (/\$transaction/.test(code)) offenders.push('트랜잭션 — 쓰기 신호')
  if (offenders.length) bad('적재하지 않는다 (VE-R2 의 일)', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('적재하지 않는다 (VE-R2 의 일)', 'guard', 'create · upsert · transaction 0')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\n우나어 read-only 커넥터 — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB 를 타지 않는다')
console.log('  🔴 검사하는 것은 "읽히는가" 가 아니라 "쓰지 못하는가 · 원문을 흘리지 않는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(34)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 커넥터가 선을 넘지 않는다\n`)
void raw
