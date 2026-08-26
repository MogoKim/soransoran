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
import {
  USED_AT_DECISION, FORBIDDEN_VOICE_SOURCE_COLUMNS, toSourceRow,
  MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE,
  LEAK_RUN_MIN, LEGACY_LABEL_VERSION, hasLeakingRun, isFreeTextLabelValue,
} from './lib/voice-unao-readonly.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const IMPORTER = join(HERE, 'voice-unao-import-live.mts')
const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

const BATCH = join(HERE, 'voice-unao-batch-live.mts')
const rawSrc = readFileSync(IMPORTER, 'utf-8')
const rawBatch = readFileSync(BATCH, 'utf-8')
/** 배치 스크립트의 실행 코드 (주석 제외) */
const batchCode = rawBatch.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')
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

// ══════════════════════════════════════════════════════════
// VE-R3 배치 적재 계약
//
// 🔴 배치는 1건 적재와 위험의 크기가 다르다. 9,674건은 되돌리기 어렵다.
// ══════════════════════════════════════════════════════════

// ── ⑪ 배치도 원문을 쓰지 않는다 ─────────────────────────
{
  const offenders: string[] = []
  const i = batchCode.indexOf('voiceSource.create(')
  const block = i === -1 ? '' : batchCode.slice(i, batchCode.indexOf('select:', i))
  if (!block) offenders.push('배치에 voiceSource.create 가 없다')
  for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
    if (new RegExp(`\\b${f}\\s*:`).test(block)) offenders.push(`배치 create data 에 ${f}`)
  }
  if (/:\s*raw(Row)?\.content\b/.test(block)) offenders.push('배치 create data 에 본문')
  if (offenders.length) bad('배치도 원문을 쓰지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('배치도 원문을 쓰지 않는다', 'guard', 'create data 에 본문 컬럼 0')
}

// ── ⑫ --apply 는 --limit 을 요구한다 ────────────────────
//    🔴 "전부 넣기" 를 한 번에 할 수 없게 한다.
{
  const offenders: string[] = []
  if (!/if \(APPLY && LIMIT === null\)/.test(batchCode)) offenders.push('--limit 없는 apply 를 막지 않는다')
  if (!/--apply 는 --limit 을 요구한다/.test(rawBatch)) offenders.push('거부 사유 안내 없음')
  // write 가 APPLY 분기 안에 있는가
  const gate = batchCode.indexOf('if (!APPLY) {')
  const write = batchCode.indexOf('voiceSource.create(')
  if (gate === -1 || write < gate) offenders.push('write 가 APPLY 게이트 앞에 있다')
  // 배치 크기 상한이 있는가 — --batch=100000 으로 본문을 통째로 끌어오지 못하게
  if (!/MAX_BATCH_SIZE/.test(batchCode)) offenders.push('배치 크기 상한 없음')
  if (offenders.length) bad('--apply 는 --limit 을 요구한다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else bad === bad && ok('--apply 는 --limit 을 요구한다', 'guard', `상한 ${MAX_BATCH_SIZE} · 기본 ${DEFAULT_BATCH_SIZE}`)
}

// ── ⑬ 중단 후 재개된다 ──────────────────────────────────
//    🔴 상태 파일 없이 UNIQUE(origin, sourceRef) 와 id 커서만으로 성립한다.
{
  const offenders: string[] = []
  // 🔴 구현 세부(findUnique)가 아니라 **계약**을 본다.
  //    배치는 왕복을 줄이려 findMany + in 으로 묶는다 — 그것도 중복 조회다.
  //    API 이름으로 잠그면 정당한 최적화가 막힌다. (실제로 막혔다)
  const lookupsExisting = /voiceSource\.(findUnique|findMany)\(/.test(batchCode)
  const usesOriginAndRef = /origin:\s*'unao_cafe'|origin_sourceRef/.test(batchCode)
    && /sourceRef/.test(batchCode)
  if (!lookupsExisting) offenders.push('중복 조회 없음')
  if (!usesOriginAndRef) offenders.push('origin + sourceRef 로 조회하지 않는다')
  if (!/skipped \+= 1/.test(batchCode)) offenders.push('SKIP 집계 없음')
  // 조회 결과로 실제 건너뛰는가
  if (!/existingRefs\.has\(|if \(existing\)/.test(batchCode)) offenders.push('조회 결과로 건너뛰지 않는다')
  // 커서가 id 오름차순인가 — 순서가 흔들리면 재개가 깨진다
  const lib = readFileSync(join(HERE, 'lib/voice-unao-readonly.mts'), 'utf-8')
  if (!/ORDER BY id ASC/.test(lib)) offenders.push('커서가 id ASC 가 아니다')
  if (!/id > \$1/.test(lib)) offenders.push('커서 조건(id > $1) 없음')
  // 조회가 create 앞인가
  const lookupAt = Math.min(
    ...[batchCode.indexOf('voiceSource.findUnique('), batchCode.indexOf('voiceSource.findMany(')]
      .filter((i) => i !== -1),
  )
  const createAt = batchCode.indexOf('voiceSource.create(')
  if (!Number.isFinite(lookupAt) || createAt === -1 || lookupAt > createAt) {
    offenders.push('중복 조회가 create 뒤')
  }
  if (offenders.length) bad('중단 후 재개된다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('중단 후 재개된다', 'guard', 'id ASC 커서 + UNIQUE SKIP · 상태 파일 없음')
}

// ── ⑭ 고품질 조건이 코드에 있다 ─────────────────────────
//    🔴 전체 33,031건이 아니라 9,674건이 대상이다.
{
  const lib = readFileSync(join(HERE, 'lib/voice-unao-readonly.mts'), 'utf-8')
  const has = [
    ['isUsable', /"isUsable"\s*=\s*true/],
    ['ageSignal 50s/60s', /"ageSignal"\s+IN\s+\('50s','60s'\)/],
    ['150자+', /length\(content\)\s*>=\s*150/],
    ['aiAnalyzed', /"aiAnalyzed"\s*=\s*true/],
    ['댓글 有', /jsonb_array_length\("topComments"::jsonb\)\s*>\s*0/],
  ] as const
  const missing = has.filter(([, re]) => !re.test(lib)).map(([n]) => n)
  // referenced 는 usedAt 이 있을 때만.
  // 🔴 문자열이 "어딘가에" 있는지가 아니라 **judgment 생성부 바로 앞**에 있는지를 본다.
  //    다른 자리(집계 카운터)에 같은 조건이 있어서, 생성부 조건을 지워도 통과했다.
  //    (역검증에서 실제로 뚫렸다)
  const refOnly = (() => {
    const at = batchCode.indexOf('voiceJudgment.create(')
    if (at === -1) return false
    const before = batchCode.slice(Math.max(0, at - 200), at)
    return /if \(row\.referencedAt\)\s*\{/.test(before)
  })()
  // 🔴 where(읽기) 와 data(쓰기) 를 구분한다.
  //    `count({ where: { decision: 'approved' } })` 는 approved 가 생겼는지 **확인하는 방어**다.
  //    그걸 위반으로 읽으면 방어 코드를 못 쓴다. (실제로 잡혔다)
  const writeApprove = /data:\s*\{[\s\S]{0,200}?decision:\s*['"]approved['"]/.test(batchCode)
  const guardsApprove = /decision:\s*['"]approved['"]/.test(batchCode) && /approved > 0/.test(batchCode)
  const noAutoApprove = !writeApprove && guardsApprove
  if (!missing.length && refOnly && noAutoApprove) {
    ok('고품질 조건 5종 · referenced 조건부', 'policy', '9,674건 대상 · approved 쓰기 0 · 사후 방어 있음')
  } else {
    bad('고품질 조건 5종 · referenced 조건부', 'policy',
      `missing=${missing.join(',')} refOnly=${refOnly} writeApprove=${writeApprove} guards=${guardsApprove}`)
  }
}

// ══════════════════════════════════════════════════════════
// VE-R3.1 — legacyLabels 경유 원문 누출
//
// 🔴 우리가 본문을 옮기지 않아도 **우나어가 만든 파생물이 본문을 물고 온다.**
//    100건 검증에서 실제로 나왔다: emotionalPeak 39자 중 30자가 본문과 연속 일치.
// ══════════════════════════════════════════════════════════

/** 검사용 원문 — 라벨이 여기서 문장을 떠 오는 상황을 만든다 */
const LEAK_BODY =
  '작년 가을에 시어머니가 갑자기 쓰러지셔서 병원에 모시고 다녔는데 그때 남편이 한 말이 아직도 잊히지 않습니다. ' +
  '형제들은 아무도 나서지 않았고 결국 저 혼자 병간호를 떠맡았어요.'
/** 본문에서 그대로 떠 온 30자 — 실측 사례와 같은 길이다 */
const LEAK_QUOTE = '형제들은 아무도 나서지 않았고 결국 저 혼자 병간호를 떠맡았어요'
/** 분석자가 쓴 요약. 낱말은 겹쳐도 문장이 통째로 겹치지는 않는다 */
const CLEAN_INSIGHT = '병간호 부담이 며느리에게 쏠린 구조에 대한 체념과 분노가 교차한다'

function leakRow(labels: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return toSourceRow({
    id: 'leak-1', cafeId: 'wgang', boardName: '자유게시판', postUrl: 'https://cafe.naver.com/x/9',
    author: '아무개', content: LEAK_BODY, commentCount: 7,
    crawledAt: new Date('2026-08-01T00:00:00Z'), postedAt: new Date('2021-01-01T00:00:00Z'),
    ...labels, ...extra,
  }, 'salt-x')
}

// ── ⑮ 본문을 물고 온 자유서술 라벨은 버려진다 ───────────
{
  const row = leakRow({ emotionalPeak: LEAK_QUOTE, psychInsight: CLEAN_INSIGHT, ageSignal: '50s' })
  const keys = Object.keys(row.legacyLabels ?? {})
  const offenders: string[] = []
  if (keys.includes('emotionalPeak')) offenders.push('본문 30자 인용이 남았다')
  if (!row.droppedLabelKeys.includes('emotionalPeak')) offenders.push('drop 보고가 없다')
  if (JSON.stringify(row).includes(LEAK_QUOTE)) offenders.push('반환값에 원문 조각이 남았다')
  if (offenders.length) bad(`본문 ${LEAK_RUN_MIN}자+ 인용 라벨 drop`, 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok(`본문 ${LEAK_RUN_MIN}자+ 인용 라벨 drop`, 'policy', `emotionalPeak 제거 · 남은 라벨 ${keys.length}종`)
}

// ── ⑯ 댓글을 물고 와도 버려진다 ─────────────────────────
//    🔴 본문만 보면 절반만 막는 것이다. topComments 도 원문이다.
{
  const commentQuote = '저도 똑같은 일을 겪어서 그 마음이 어떤지 너무 잘 알겠습니다'
  const row = toSourceRow({
    id: 'leak-2', cafeId: 'wgang', postUrl: 'u', author: 'a',
    content: '짧은 본문이라 여기엔 없다.', commentCount: 3,
    crawledAt: new Date('2026-08-01T00:00:00Z'),
    topComments: [{ author: 'x', content: commentQuote }],
    betrayalFactor: commentQuote, qualityScore: 7,
  }, 'salt-x')
  const keys = Object.keys(row.legacyLabels ?? {})
  const offenders: string[] = []
  if (keys.includes('betrayalFactor')) offenders.push('댓글 인용이 남았다')
  if (!row.droppedLabelKeys.includes('betrayalFactor')) offenders.push('drop 보고가 없다')
  if (JSON.stringify(row).includes(commentQuote)) offenders.push('반환값에 댓글 원문이 남았다')
  if (!keys.includes('qualityScore')) offenders.push('무관한 라벨까지 잃었다')
  if (offenders.length) bad('댓글 인용 라벨도 drop', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('댓글 인용 라벨도 drop', 'policy', 'topComments 대조 · qualityScore 보존')
}

// ── ⑰ 전체가 아니라 문제 key 만 버린다 ──────────────────
//    🔴 한 키가 오염됐다고 우나어가 계산해 둔 자산을 통째로 잃으면 안 된다.
//       실측에서도 오염은 179개 값 중 1개였다.
{
  const row = leakRow({
    emotionalPeak: LEAK_QUOTE, psychInsight: CLEAN_INSIGHT,
    ageSignal: '50s', desireCategory: 'FAMILY', qualityScore: 8, killerScore: 6,
    emotionTags: ['분노', '체념'], commentSplit: 3,
  })
  const keys = Object.keys(row.legacyLabels ?? {})
  const survivors = ['psychInsight', 'ageSignal', 'desireCategory', 'qualityScore', 'killerScore', 'emotionTags', 'commentSplit']
  const lost = survivors.filter((k) => !keys.includes(k))
  const offenders: string[] = []
  if (row.legacyLabels === null) offenders.push('legacyLabels 를 통째로 버렸다')
  if (lost.length) offenders.push(`무관한 라벨 손실: ${lost.join(',')}`)
  if (row.droppedLabelKeys.length !== 1) offenders.push(`drop 이 ${row.droppedLabelKeys.length}개 (1개여야 한다)`)
  if (row.legacyLabelVersion !== LEGACY_LABEL_VERSION) offenders.push('버전이 사라졌다')
  if (offenders.length) bad('key 단위 drop (전체 삭제 아님)', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('key 단위 drop (전체 삭제 아님)', 'policy', `8종 중 1종만 제거 · ${keys.length}종 보존`)
}

// ── ⑱ 숫자형 · 분류형은 검사하지 않는다 ─────────────────
//    🔴 `commentSplit` 은 **숫자 0~8** 이다. 이름에 comment 가 있다고 버리면
//       정당한 자산을 잃는다. 이 프로젝트에서 실제로 두 번 오인된 이름이다.
{
  const offenders: string[] = []
  if (isFreeTextLabelValue(3)) offenders.push('숫자를 자유서술로 판정')
  if (isFreeTextLabelValue(true)) offenders.push('불리언을 자유서술로 판정')
  if (isFreeTextLabelValue('50s')) offenders.push('ageSignal 을 자유서술로 판정')
  if (isFreeTextLabelValue('FAMILY')) offenders.push('desireCategory 를 자유서술로 판정')
  if (isFreeTextLabelValue(['분노', '체념'])) offenders.push('짧은 태그 배열을 자유서술로 판정')
  if (!isFreeTextLabelValue(LEAK_QUOTE)) offenders.push('30자 문장을 자유서술로 보지 않았다')
  // 숫자 라벨의 값이 본문에 들어 있어도 살아남아야 한다
  const row = toSourceRow({
    id: 'n-1', cafeId: 'w', postUrl: 'u', author: 'a',
    content: '숫자 3 이 본문에 있다.'.repeat(20), crawledAt: new Date('2026-08-01T00:00:00Z'),
    commentSplit: 3, urgencyLevel: 4, ageSignal: '50s',
  }, 's')
  const keys = Object.keys(row.legacyLabels ?? {})
  for (const k of ['commentSplit', 'urgencyLevel', 'ageSignal']) {
    if (!keys.includes(k)) offenders.push(`${k} 가 버려졌다`)
  }
  if (offenders.length) bad('숫자 · 분류형은 검사 제외', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('숫자 · 분류형은 검사 제외', 'guard', 'commentSplit(number) · ageSignal · 짧은 태그 보존')
}

// ── ⑲ 경계 — 19자는 남고 20자는 버린다 ──────────────────
//    🔴 임계값을 **리터럴로 못박는다.** 상수를 참조해 상대 비교만 하면
//       LEAK_RUN_MIN 을 5 로 바꿔도 fixture 가 통과한다(같은 함정에 이미 걸린 적이 있다).
{
  const base = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허'
  const body = `앞말 ${base} 뒷말`
  const under = base.slice(0, 19)
  const over = base.slice(0, 20)
  const offenders: string[] = []
  if (hasLeakingRun(under, body)) offenders.push('19자에서 이미 걸린다')
  if (!hasLeakingRun(over, body)) offenders.push('20자를 놓친다')
  if (LEAK_RUN_MIN !== 20) offenders.push(`LEAK_RUN_MIN 이 ${LEAK_RUN_MIN} (1차값은 20)`)
  // 공백을 넣어 피해 가지 못한다
  if (!hasLeakingRun(over.split('').join(' '), body)) offenders.push('공백을 끼우면 빠져나간다')
  if (offenders.length) bad('경계 19 / 20자 · 공백 우회', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('경계 19 / 20자 · 공백 우회', 'guard', '19자 통과 · 20자 차단 · 공백 정규화')
}

// ── ⑳ 정화 스크립트는 dry-run 이 기본이고 범위를 넘지 않는다 ──
{
  const SAN = join(HERE, 'voice-legacy-label-sanitize.mts')
  const sanRaw = readFileSync(SAN, 'utf-8')
  const sanCode = sanRaw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')
  const offenders: string[] = []
  if (!/const APPLY = process\.argv\.includes\('--apply'\)/.test(sanCode)) offenders.push('--apply 게이트 없음')
  // update 는 APPLY 뒤에 있어야 한다
  const at = sanCode.indexOf('voiceSource.update(')
  if (at === -1) offenders.push('update 를 찾지 못했다')
  else if (!/if \(!APPLY\) continue/.test(sanCode.slice(Math.max(0, at - 200), at))) {
    offenders.push('update 앞에 APPLY 게이트가 없다')
  }
  // 🔴 Micro Seed 원장과 Sheet 를 건드리지 않는다
  for (const t of ['microSeedCandidate', 'microSeedRawContent', 'microSeedCandidateHistory', 'planSheetWrite', 'appendRow']) {
    if (new RegExp(`\\b${t}\\b`).test(sanCode)) offenders.push(`Micro Seed 접근: ${t}`)
  }
  // 🔴 legacyLabels 외의 컬럼을 쓰지 않는다
  const dataAt = sanCode.indexOf('data: {', at === -1 ? 0 : at)
  const dataBlock = dataAt === -1 ? '' : sanCode.slice(dataAt, dataAt + 300)
  for (const f of FORBIDDEN_VOICE_SOURCE_COLUMNS) {
    if (new RegExp(`\\b${f}\\s*:`).test(dataBlock)) offenders.push(`update data 에 ${f}`)
  }
  for (const f of ['contentHash', 'authorHash', 'sourceRef', 'origin']) {
    if (new RegExp(`\\b${f}\\s*:`).test(dataBlock)) offenders.push(`update data 에 ${f} (건드리면 안 된다)`)
  }
  if (/\bdelete\s*\(|deleteMany/.test(sanCode)) offenders.push('행 삭제 경로')
  if (/openai|anthropic|claude|gpt-/i.test(sanCode)) offenders.push('LLM 참조')
  if (/\bfetch\s*\(|axios/.test(sanCode)) offenders.push('외부 네트워크')
  if (offenders.length) bad('정화 스크립트 dry-run 기본 · 범위 고정', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('정화 스크립트 dry-run 기본 · 범위 고정', 'guard', 'APPLY 게이트 · legacyLabels 만 update · 삭제 0 · Micro Seed 0')
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
