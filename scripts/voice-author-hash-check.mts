#!/usr/bin/env tsx
/**
 * 작가 해시 v2 계약 fixture — 🔴 DB 0 · 네트워크 0 · 파일 write 0(임시 env 파일 제외) (2026-10-01 author-hash v2)
 *
 *   npm run voice:author-hash-check
 *
 * 정본: scripts/lib/voice-author-hash.mts · scripts/lib/voice-author-hash-migration.mts
 *
 * 보는 것
 *   ① key 없음 · 빈 값 · 짧은 key · env 파일 없음 → 전부 거절(공개 기본값으로 대신하지 않는다)
 *   ② 세대 판정 — v1 만 · v2 만 · 섞임 · 손상(접두 · kid · hex · 덧붙은 칸) · 다른 key · 빈 집합
 *   ③ 같은 작가 → 같은 v2 · 다른 작가 → 다른 v2 · key 가 다르면 kid 도 다르다
 *   ④ v1 사슬 보존 — wrapV1(v1(x)) = authorHashV2Of(x). 원문 없이 옮겨도 같은 사람이 같은 값이다
 *   ⑤ 알려진 충돌 parity — 감싸기 전 v1 사슬 일치 = 감싼 뒤 v2 일치
 *   ⑥ 이중 HMAC 없음 — v2 · 손상 값은 감싸지 않는다(null)
 *   ⑦ Gate ⑥-B 는 v2-ready 일 때만 hashOf 를 받는다 — 빈 집합 · v1 만 · 섞임 · 손상 · 다른 key 는 PASS 가 아니다
 *   ⑧ 정적 잠금 — v1 사슬 문자열 · key env 이름 · 인라인 `sha256(salt::…)` 이 정본 helper 밖(검사 파일 제외)에 없다.
 *      #624(persona-voice-supply) 가 rebase 되면 그 CLI 의 공개 fallback 도 여기서 걸린다.
 *   ⑨ 노출 없음 — 계획 출력에 해시 · 이름 · key 가 없고, 도구 출력 줄이 작가 해시 · key 를 찍지 않는다
 *
 * 🔴 이름은 전부 지어낸 합성 문자열이다. key 도 시험 전용이다.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  authorGateOf, authorHashKeyOf, authorHashV2Of, censusOf, generationOf, legacyDomainProbe, legacyDomainSampleProof, readAuthorHashKey,
  LEGACY_PROOF_MIN_SAMPLE,
  setStateOf, writableStateOf, wrapV1, V1_PREFIX, V2_PREFIX, type AuthorHashKey,
} from './lib/voice-author-hash.mjs'
import { describePlan, type MigrationPlan } from './lib/voice-author-hash-migration.mjs'
import { normalizeN2 } from './lib/persona-gate-name-collision.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
let pass = 0
const failures: string[] = []
const check = (name: string, ok: boolean): void => {
  if (ok) pass += 1
  else { failures.push(name); console.log(`  🔴 FAIL  ${name}`) }
}

// 🔴 시험 전용 key — 운영 key 가 아니다(합성 32자 이상)
const KEY_A_SECRET = 'author-hash-check-key-A-0123456789abcdef'
const KEY_B_SECRET = 'author-hash-check-key-B-fedcba9876543210'
const keyOf = (s: string): AuthorHashKey => {
  const r = authorHashKeyOf(s)
  if (!r.ok) throw new Error('test key')
  return r.key
}
const A = keyOf(KEY_A_SECRET)
const B = keyOf(KEY_B_SECRET)
const KEY_A_READ = authorHashKeyOf(KEY_A_SECRET)

/**
 * 🔴 v1 을 **검사 쪽에서 독립으로** 계산한다 — helper 의 사슬이 옛 저장값 계산식과 같은지 보려면 helper 를 쓰면 안 된다.
 *    이 문자열이 검사 파일에 있는 것은 정적 잠금(⑧)의 예외다(검사 파일은 운영 경로가 아니다).
 */
const v1Of = (value: string): string =>
  `${V1_PREFIX}${createHash('sha256').update(`soransoran-voice-v1::${value}`, 'utf8').digest('hex')}`

// 🔴 합성 이름
const AUTHORS = ['봄뜰하나', '겨울 숲 둘', '가을바다셋']
const OTHER = '여름길넷'

console.log('\n① key 없음 → 거절(공개 기본값 없음)')
for (const [label, v] of [['undefined', undefined], ['빈 문자열', ''], ['공백', '   '], ['숫자', 42]] as const) {
  const r = authorHashKeyOf(v)
  check(`key ${label} → KEY_MISSING`, !r.ok && r.code === 'KEY_MISSING')
}
{
  const r = authorHashKeyOf('short-key-0123')
  check('짧은 key → KEY_TOO_SHORT', !r.ok && r.code === 'KEY_TOO_SHORT')
  const g = authorGateOf(r, { authorHashes: new Set([authorHashV2Of('x', A)]), authorHashNorms: new Set() })
  check('짧은 key → Gate 거절', !g.ok && g.code === 'KEY_TOO_SHORT')
  const gm = authorGateOf(authorHashKeyOf(undefined), { authorHashes: new Set([v1Of('x')]), authorHashNorms: new Set() })
  check('key 없음 → Gate 거절(v1 집합이 있어도 v1 사슬로 대조하지 않는다)', !gm.ok && gm.code === 'KEY_MISSING')
}
{
  const dir = mkdtempSync(join(tmpdir(), 'author-hash-check-'))
  try {
    const none = join(dir, 'none.env')
    const miss = readAuthorHashKey(none)
    check('env 파일 없음 → 거절(ENV_UNREADABLE 또는 KEY_MISSING)', !miss.ok && (miss.code === 'ENV_UNREADABLE' || miss.code === 'KEY_MISSING'))
    const noKey = join(dir, 'no-key.env')
    writeFileSync(noKey, 'OTHER_VAR=1\n', { mode: 0o600 })
    const nk = readAuthorHashKey(noKey)
    check('env 에 key 줄 없음 → KEY_MISSING', !nk.ok && nk.code === 'KEY_MISSING')
    const withKey = join(dir, 'with-key.env')
    writeFileSync(withKey, `VOICE_AUTHOR_HASH_SALT=${KEY_A_SECRET}\n`, { mode: 0o600 })
    const wk = readAuthorHashKey(withKey)
    check('env 에 key 있음 → ok · kid 가 같은 key 의 kid', wk.ok && wk.key.kid === A.kid)
    const prev = process.env.VOICE_AUTHOR_HASH_SALT
    process.env.VOICE_AUTHOR_HASH_SALT = KEY_B_SECRET
    const pe = readAuthorHashKey(noKey)
    check('process.env 에 key 가 있어도 정본 env 파일만 본다', !pe.ok)
    if (prev === undefined) delete process.env.VOICE_AUTHOR_HASH_SALT
    else process.env.VOICE_AUTHOR_HASH_SALT = prev
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
check('key 객체에 key 값이 실리지 않는다', !JSON.stringify(A).includes(KEY_A_SECRET) && Object.keys(A).sort().join(',') === 'kid,mac')

console.log('\n② 세대 판정')
const v1Set = AUTHORS.map(v1Of)
const v2Set = AUTHORS.map((a) => authorHashV2Of(a, A))
const v2OtherKey = AUTHORS.map((a) => authorHashV2Of(a, B))
check('v1 모양 → v1', v1Set.every((v) => generationOf(v).gen === 'v1'))
check('v2 모양 → v2 · kid', v2Set.every((v) => { const g = generationOf(v); return g.gen === 'v2' && g.kid === A.kid }))
const CORRUPT = [
  'md5:abc', '', `${V1_PREFIX}xyz`, `${V1_PREFIX}${'A'.repeat(64)}`, `${V2_PREFIX}short:${'a'.repeat(64)}`,
  `${V2_PREFIX}${A.kid}:${'a'.repeat(63)}`, `${V2_PREFIX}${A.kid}:${'a'.repeat(64)}:extra`, `${V2_PREFIX}${'a'.repeat(64)}`,
]
check('손상 모양(접두 · kid · hex · 덧붙은 칸) → corrupt', CORRUPT.every((v) => generationOf(v).gen === 'corrupt'))
const st = (vals: string[], key: AuthorHashKey | null = A): string => setStateOf(censusOf(vals, key))
check('v1 만 → needs-migration', st(v1Set) === 'needs-migration')
check('v2 만(지금 key) → v2-ready', st(v2Set) === 'v2-ready')
check('v1 + v2 섞임 → mixed', st([...v1Set, v2Set[0]!]) === 'mixed')
check('손상 1건 → corrupt', st([...v2Set, CORRUPT[2]!]) === 'corrupt')
check('다른 key 의 v2 → key-mismatch', st(v2OtherKey) === 'key-mismatch')
check('지금 key v2 + 다른 key v2 → key-mismatch', st([...v2Set, v2OtherKey[0]!]) === 'key-mismatch')
check('key 없이 센 v2 → key-mismatch(지금 key 것인지 모른다)', st(v2Set, null) === 'key-mismatch')
check('빈 집합 → empty', st([]) === 'empty')
check('적재 쓰기 허용은 v2-ready · empty 뿐', writableStateOf(censusOf(v2Set, A)).ok && writableStateOf(censusOf([], A)).ok
  && !writableStateOf(censusOf(v1Set, A)).ok && !writableStateOf(censusOf([...v1Set, v2Set[0]!], A)).ok
  && !writableStateOf(censusOf(v2OtherKey, A)).ok)

console.log('\n③ 동일성')
check('같은 작가 → 같은 v2', authorHashV2Of(AUTHORS[0]!, A) === authorHashV2Of(AUTHORS[0]!, A))
check('다른 작가 → 다른 v2', new Set(v2Set).size === AUTHORS.length)
check('key 가 다르면 kid · 값이 다르다', A.kid !== B.kid && v2Set.every((v, i) => v !== v2OtherKey[i]))
check('v2 는 원문 · v1 hex 를 담지 않는다', v2Set.every((v, i) => !v.includes(AUTHORS[i]!) && !v.includes(v1Set[i]!.slice(V1_PREFIX.length))))

console.log('\n④ v1 사슬 보존 — 원문 없이 옮겨도 같은 사람')
check('wrapV1(v1(x)) = authorHashV2Of(x) — 원본', AUTHORS.every((a) => wrapV1(v1Of(a), A) === authorHashV2Of(a, A)))
check('wrapV1(v1(N2(x))) = authorHashV2Of(N2(x)) — 정규화', AUTHORS.every((a) => wrapV1(v1Of(normalizeN2(a)), A) === authorHashV2Of(normalizeN2(a), A)))

console.log('\n⑤ 알려진 충돌 parity')
{
  const storedV1 = new Set([...AUTHORS.map(v1Of), ...AUTHORS.map((a) => v1Of(normalizeN2(a)))])
  const probeNames = [...AUTHORS, OTHER, '겨울숲둘']
  const before = legacyDomainProbe(probeNames, storedV1, normalizeN2)
  const wrapped = new Set([...storedV1].map((v) => wrapV1(v, A)!))
  const after = probeNames.filter((n) => wrapped.has(authorHashV2Of(n, A)) || wrapped.has(authorHashV2Of(normalizeN2(n), A))).length
  check('전환 전 v1 사슬 일치 4(원본 3 + N2 1) · 무관 이름 0', before.hits === 4 && before.probeNames === 5)
  check('전환 후 v2 일치 수 = 전환 전', after === before.hits)
  check('probe 가 다른 salt 로 만든 v1 에 0 — 미증명이지 증명이 아니다',
    legacyDomainProbe(AUTHORS, new Set(AUTHORS.map((a) => `${V1_PREFIX}${createHash('sha256').update(`other-salt::${a}`).digest('hex')}`)), normalizeN2).hits === 0)
  const g = authorGateOf(KEY_A_READ, { authorHashes: new Set(AUTHORS.map((a) => wrapV1(v1Of(a), A)!)), authorHashNorms: new Set(AUTHORS.map((a) => wrapV1(v1Of(normalizeN2(a)), A)!)) })
  check('감싼 집합 → Gate ok · 알려진 이름은 걸리고 무관 이름은 안 걸린다',
    g.ok && AUTHORS.every((a) => wrapped.has(g.hashOf(a))) && !wrapped.has(g.hashOf(OTHER)))
}

console.log('\n⑤-b v1 사슬 원본 대조 증명 — 그 행을 만든 원본 작가명으로 다시 계산')
{
  const names = Array.from({ length: LEGACY_PROOF_MIN_SAMPLE }, (_, i) => `합성 작가 ${i}`)
  const rowOf = (a: string, hash: (v: string) => string = v1Of) => ({ author: a, storedHash: hash(a), storedNorm: hash(normalizeN2(a)) })
  const ok = legacyDomainSampleProof(names.map((a) => rowOf(a)), normalizeN2)
  check(`대조 ${LEGACY_PROOF_MIN_SAMPLE} · 전부 일치 → PROVEN`, ok.status === 'PROVEN' && ok.compared === 100 && ok.matched === 100 && ok.normMatched === 100)
  const thin = legacyDomainSampleProof(names.slice(1).map((a) => rowOf(a)), normalizeN2)
  check('대조 99 → UNKNOWN(표본 하한)', thin.status === 'UNKNOWN' && thin.compared === 99)
  const oneOff = legacyDomainSampleProof([...names.slice(1).map((a) => rowOf(a)), { ...rowOf(names[0]!), storedHash: v1Of('다른 사람') }], normalizeN2)
  check('한 행 어긋남 → UNKNOWN(부분 일치는 증명이 아니다)', oneOff.status === 'UNKNOWN' && oneOff.matched === 99)
  const otherSalt = legacyDomainSampleProof(names.map((a) => rowOf(a, (v) => `${V1_PREFIX}${createHash('sha256').update(`other-salt::${v}`).digest('hex')}`)), normalizeN2)
  check('다른 salt 로 만든 저장값 → UNKNOWN · 일치 0', otherSalt.status === 'UNKNOWN' && otherSalt.matched === 0)
  const normOff = legacyDomainSampleProof([...names.slice(1).map((a) => rowOf(a)), { ...rowOf(names[0]!), storedNorm: v1Of('다른 사람') }], normalizeN2)
  check('정규화 해시만 어긋남 → UNKNOWN', normOff.status === 'UNKNOWN' && normOff.matched === 100 && normOff.normMatched === 99)
  const missing = legacyDomainSampleProof([...names.map((a) => rowOf(a)), { author: null, storedHash: v1Of('x'), storedNorm: null }, { author: '  ', storedHash: v1Of('y'), storedNorm: null }], normalizeN2)
  check('원본 작가명이 없는 행은 대조하지 않는다(표본에는 센다)', missing.status === 'PROVEN' && missing.sample === 102 && missing.compared === 100)
  const v2Rows = legacyDomainSampleProof(names.map((a) => ({ author: a, storedHash: authorHashV2Of(a, A), storedNorm: null })), normalizeN2)
  check('저장값이 v2 면 v1 대조 대상이 아니다 → UNKNOWN', v2Rows.status === 'UNKNOWN' && v2Rows.compared === 0)
  const empty = legacyDomainSampleProof([], normalizeN2)
  check('빈 표본 → UNKNOWN', empty.status === 'UNKNOWN' && empty.sample === 0)
  const dump = JSON.stringify([ok, oneOff, otherSalt])
  check('증명 결과에 이름 · 해시가 없다', !dump.includes('합성 작가') && !/[0-9a-f]{12,}/.test(dump))
  const mig = readFileSync(join(ROOT, 'scripts/voice-author-hash-migrate.mts'), 'utf-8')
  const migLib = readFileSync(join(ROOT, 'scripts/lib/voice-author-hash-migration.mts'), 'utf-8')
  check('전환 적용은 원본 대조 PROVEN 을 요구한다 · 사람 확인 우회 옵션이 없다',
    /legacyProof\?\.status !== 'PROVEN'/.test(migLib) && !/attest/i.test(mig.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')) && !/attest/i.test(migLib)
      && /readLegacyDomainProof\(/.test(mig))
}

console.log('\n⑥ 이중 HMAC 없음')
check('v2 는 감싸지 않는다(null)', v2Set.every((v) => wrapV1(v, A) === null))
check('손상 값은 감싸지 않는다(null)', CORRUPT.every((v) => wrapV1(v, A) === null))

console.log('\n⑦ Gate ⑥-B — v2-ready 에서만 hashOf')
{
  const S = (h: string[], n: string[] = []) => ({ authorHashes: new Set(h), authorHashNorms: new Set(n) })
  const empty = authorGateOf(KEY_A_READ, S([]))
  check('빈 집합 → 거절(empty) — PASS 가 아니다', !empty.ok && empty.code === 'empty')
  const onlyV1 = authorGateOf(KEY_A_READ, S(v1Set))
  check('v1 만(새 key 만 넣고 저장값 그대로) → 거절(needs-migration)', !onlyV1.ok && onlyV1.code === 'needs-migration')
  const mixed = authorGateOf(KEY_A_READ, S(v2Set, v1Set))
  check('원본 v2 · N2 v1(표 사이 섞임) → 거절(mixed)', !mixed.ok && mixed.code === 'mixed')
  const other = authorGateOf(KEY_A_READ, S(v2OtherKey))
  check('다른 key 의 v2 → 거절(key-mismatch)', !other.ok && other.code === 'key-mismatch')
  const corrupt = authorGateOf(KEY_A_READ, S([...v2Set, CORRUPT[0]!]))
  check('손상 → 거절(corrupt)', !corrupt.ok && corrupt.code === 'corrupt')
  const ready = authorGateOf(KEY_A_READ, S(v2Set))
  check('v2-ready → hashOf = authorHashV2Of', ready.ok && ready.hashOf(AUTHORS[1]!) === authorHashV2Of(AUTHORS[1]!, A))
}

console.log('\n⑧ 정적 잠금 — 정본 helper 하나')
const HELPER = 'scripts/lib/voice-author-hash.mts'
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', '.claude', '.omc', '.bkit', '.playwright-mcp'])
const walk = (dir: string, out: string[]): string[] => {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIR.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(mts|mjs|ts|tsx|js|cjs)$/.test(e)) out.push(relative(ROOT, p))
  }
  return out
}
const FILES = [...walk(join(ROOT, 'scripts'), []), ...walk(join(ROOT, 'src'), [])]
/** 🔴 검사 파일은 운영 경로가 아니다 — v1 을 독립 계산하거나 금지어를 문자열로 들고 있다 */
const isCheck = (f: string): boolean => /-check\.(mts|mjs|ts)$/.test(f) || /(^|\/)__tests__\//.test(f)
const ACTIVE = FILES.filter((f) => f !== HELPER && !isCheck(f))
check('정적 잠금 대상 파일이 있다(스캔이 비지 않았다)', ACTIVE.length > 100 && FILES.includes(HELPER))
/** 🔴 주석은 코드가 아니다 — runbook 안내 주석이 key env 이름을 적는 것은 읽기가 아니다(v1 사슬 문자열은 주석도 금지) */
const stripComments = (raw: string): string => raw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')
const offenders = (re: RegExp, code = false): string[] =>
  ACTIVE.filter((f) => { const raw = readFileSync(join(ROOT, f), 'utf-8'); return re.test(code ? stripComments(raw) : raw) })
const legacyLiteral = offenders(/soransoran-voice-v1/)
check(`v1 사슬 문자열이 helper 밖 운영 코드에 없다${legacyLiteral.length ? ` — ${legacyLiteral.join(', ')}` : ''}`, legacyLiteral.length === 0)
const keyEnv = offenders(/VOICE_AUTHOR_HASH_SALT/, true)
check(`key env 이름을 helper 밖 운영 코드가 읽지 않는다${keyEnv.length ? ` — ${keyEnv.join(', ')}` : ''}`, keyEnv.length === 0)
/** salt · key 를 앞에 붙인 인라인 해시 — 원천 id · 본문 digest(`${site}::${id}`)는 작가 해시가 아니다 */
const inlineSalt = offenders(/createHash\(\s*['"]sha256['"]\s*\)\s*\.update\(\s*`\$\{[^}]*(salt|Salt|SALT|key|Key|KEY)[^}]*\}::/)
check(`인라인 sha256(salt::값) 이 helper 밖에 없다${inlineSalt.length ? ` — ${inlineSalt.join(', ')}` : ''}`, inlineSalt.length === 0)
/** 작가 해시를 새로 만드는 곳은 helper 를 import 해야 한다 — 새 수집 경로가 자기 해시를 만들지 못하게 */
const writers = ACTIVE.filter((f) => {
  const src = readFileSync(join(ROOT, f), 'utf-8')
  return /authorHash(Norm)?\s*:/.test(src) && /createH(ash|mac)\(/.test(src)
})
const writersWithoutHelper = writers.filter((f) => !/from '\.\/(lib\/)?voice-author-hash\.mjs'/.test(readFileSync(join(ROOT, f), 'utf-8')))
check(`작가 해시를 싣는 곳이 직접 해시하면 helper 를 거친다${writersWithoutHelper.length ? ` — ${writersWithoutHelper.join(', ')}` : ''}`, writersWithoutHelper.length === 0)
{
  const gate = readFileSync(join(ROOT, 'scripts/lib/persona-gate-name-collision.mts'), 'utf-8')
  check('Gate ⑥-B 판정부 — hashOf 생략 시 조용히 건너뛰지 않는다', !/hashOf\s*===\s*undefined/.test(gate) && !/hashOf\?\s*:/.test(gate))
  const facts = readFileSync(join(ROOT, 'scripts/lib/persona-reserve-facts.mts'), 'utf-8')
  check('계약 계기판 — authorGateOf 로만 hashOf 를 얻는다', /authorGateOf\(/.test(facts) && !/createHash\(/.test(facts))
}

console.log('\n⑨ 노출 없음')
{
  const plan: MigrationPlan = {
    key: { ok: true, kid: A.kid },
    tables: {
      voiceSource: { rows: 3, census: censusOf(v1Set, A) },
      voiceCommentSignal: { rows: 3, census: censusOf(v1Set, A) },
    },
    state: 'needs-migration', action: 'migrate', refuseReason: null,
    legacyDomain: { probeNames: 5, hits: 4, status: 'proven' }, rowsToWrap: 6, updateStatements: 4,
  }
  const out = describePlan(plan).join('\n')
  check('계획 출력에 kid · 해시 · 이름 · key 가 없다',
    !out.includes(A.kid) && !/[0-9a-f]{12,}/.test(out) && !AUTHORS.some((a) => out.includes(a)) && !out.includes(KEY_A_SECRET))
  check('계획 출력에 수와 상태는 있다', /needs-migration/.test(out) && /감쌀 행 6 · 갱신 문장 4/.test(out) && /proven/.test(out))
  const RUNNERS = [
    'scripts/voice-author-hash-migrate.mts', 'scripts/lib/voice-author-hash-migration.mts', 'scripts/voice-unao-import-live.mts',
    'scripts/voice-unao-batch-live.mts', 'scripts/voice-derive-live.mts', 'scripts/author-hash-norm-backfill.mts',
    'scripts/voice-m3-dry-run.mts', 'scripts/voice-m3-run.mts', 'scripts/persona-cohort-run.mts', 'scripts/persona-seed-apply.mts',
    'scripts/persona-mvp-assign.mts', 'scripts/persona-wave2-assign.mts', 'scripts/persona-autogen.mts',
    'scripts/voice-author-hash-legacy-proof.mts', 'scripts/lib/voice-author-hash-unao.mts',
  ]
  const leaks = RUNNERS.filter((f) => readFileSync(join(ROOT, f), 'utf-8').split('\n')
    .some((l) => /console\.(log|error|warn|info)\(/.test(l)
      // 🔴 값을 끼워 넣는 자리(`${…}`) · 인자로 직접 넘기는 자리만 본다 — 문구 속 "authorHash" 라는 낱말은 값이 아니다
      && (/\$\{[^}]*(authorHash(Norm)?\b|\.kid\b|\bsecret\b|hashOf\()[^}]*\}/.test(l) || /console\.\w+\([^)`'"]*\b(authorHash(Norm)?|kid|secret)\b/.test(l))
      && !/(v2 \(값 비출력\)|kid 지문만)/.test(l)))
  check(`도구 출력 줄이 작가 해시 · kid · key 를 찍지 않는다${leaks.length ? ` — ${leaks.join(', ')}` : ''}`, leaks.length === 0)
}

console.log(`\n작가 해시 v2 계약: ${pass} PASS · ${failures.length} FAIL`)
process.exit(failures.length === 0 ? 0 : 1)
