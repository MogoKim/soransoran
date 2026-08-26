#!/usr/bin/env tsx
/**
 * 승인 레일 fixture — 네트워크 · DB · Sheet 없이 계약을 검증한다
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2 · §6-7-A · §6-8 · §6-10
 *
 * 🔴 이 fixture 가 검사하는 것은 "승인이 되는가" 가 아니라
 *    **"승인해서는 안 될 것을 승인하지 않는가"** 다.
 *    승인 성공은 사람이 --apply 로 확인한다. 여기서 잠그는 것은 되돌리기 어려운 쪽이다.
 *
 * 🔴 가장 중요한 검사는 ⑨ 다 — approve-live 가 단일 후보만 건드리는가.
 *    sync-approval-live 를 통째로 부르면 Sheet 의 다른 PENDING 행까지 승격된다.
 *    그 회귀는 조용하다: 명령은 성공하고, 엉뚱한 후보가 발행 대기로 올라간다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePromotion, NON_PROMOTABLE_STATUSES } from './lib/micro-seed-approve-lib.mjs'
import { parseKst } from './micro-seed-validate.mjs'
import { kstString } from './lib/micro-seed-time.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

const NOW = new Date('2026-08-26T00:00:00.000Z') // 2026-08-26 09:00 KST
const FUTURE = new Date('2026-08-27T00:00:00.000Z')
const PAST = new Date('2026-08-25T00:00:00.000Z')
const KEY = 'sha256:' + 'a'.repeat(64)

const baseDb = {
  status: 'HOLD',
  dedupKey: KEY,
  createdPostId: null as string | null,
  founderTitle: '저도 작년에 사위 봤는데 많이 해맑아요',
  targetBoardType: 'FREE' as string | null,
  scheduledPublishAt: null as Date | null,
  declineReason: null as string | null,
}
const baseSheet = {
  status: 'HOLD',
  dedupKey: KEY,
  founderTitle: '저도 작년에 사위 봤는데 많이 해맑아요',
  board: 'free',
  scheduledPublishAt: '',
  declineReason: '',
  postUrl: '',
  updatedBySystemAt: '',
}
const approve = (over: Record<string, unknown> = {}, dbOver: Record<string, unknown> = {}, at: Date | null = FUTURE) =>
  evaluatePromotion({
    mode: 'approve',
    candidateId: 'cand-1',
    sheet: { ...baseSheet, ...over },
    db: { ...baseDb, ...dbOver },
    now: NOW,
    overrideScheduledPublishAt: at,
    parseKst,
    kstString,
  })

// ── ① 정상 승인 경로 ────────────────────────────────────
{
  const v = approve()
  const setsPending = v.data.status === 'PENDING'
  const setsSchedule = (v.data.scheduledPublishAt as Date | undefined)?.getTime() === FUTURE.getTime()
  if (v.promote && !v.blockedBy && setsPending && setsSchedule) {
    ok('정상 승인 — HOLD + 미래 예약', 'policy', `status=PENDING · ${v.fieldsUpdated.join(' · ')}`)
  } else {
    bad('정상 승인 — HOLD + 미래 예약', 'policy',
      `promote=${v.promote} blocked=${v.blockedBy} pending=${setsPending} sched=${setsSchedule}`)
  }
}

// ── ② 승격 불가 상태 7종을 전부 거부한다 ────────────────
//    🔴 PUBLISHED · PROCESSING · FAILED · SKIPPED · DECLINED · TAKEDOWN · PENDING
//       HOLD 만 승격 대상이다. 되돌리기 어려운 쪽으로 가는 문을 전부 닫는다.
{
  const survivors = NON_PROMOTABLE_STATUSES.filter((st) => approve({}, { status: st }).promote)
  const covers = ['PUBLISHED', 'PROCESSING', 'FAILED', 'SKIPPED', 'DECLINED', 'TAKEDOWN', 'PENDING']
    .every((st) => NON_PROMOTABLE_STATUSES.includes(st))
  if (!survivors.length && covers) {
    ok('승격 불가 상태 7종 거부', 'guard', NON_PROMOTABLE_STATUSES.join(' · '))
  } else {
    bad('승격 불가 상태 7종 거부', 'guard', `통과해버린 상태=${survivors.join(',')} covers=${covers}`)
  }
}

// ── ③ 발행 이력이 있으면 승인하지 않는다 (R9) ───────────
{
  const v = approve({}, { createdPostId: 'post-1' })
  const byPost = !v.promote && /createdPostId/.test(v.blockedBy ?? '')
  // Sheet 쪽 발행 흔적도 막는다 (§6-1)
  const byUrl = !approve({ postUrl: 'https://soransoran.com/community/free/x' }).promote
  const byStamp = !approve({ updatedBySystemAt: '2026-08-26 09:00' }).promote
  if (byPost && byUrl && byStamp) {
    ok('발행 이력 · 발행 흔적 거부 (R9 · §6-1)', 'guard', 'createdPostId · postUrl · updatedBySystemAt')
  } else {
    bad('발행 이력 · 발행 흔적 거부 (R9 · §6-1)', 'guard', `post=${byPost} url=${byUrl} stamp=${byStamp}`)
  }
}

// ── ④ 과거 시각은 승격하지 않고, 시각을 밀지도 않는다 ───
//    🔴 정책 21 · R5. 시스템이 과거를 미래로 밀면 규칙이 무의미해진다.
{
  const v = approve({}, {}, PAST)
  const blockedByPast = !v.promote && /과거/.test(v.blockedBy ?? '')
  // 값 자체는 반영한다 — 창업자가 적은 것이 원장의 사실이다
  const keepsValue = (v.data.scheduledPublishAt as Date | undefined)?.getTime() === PAST.getTime()
  const notPushed = !v.promote
  if (blockedByPast && keepsValue && notPushed) {
    ok('과거 예약 거부 — 시각을 밀지 않는다', 'policy', `${kstString(PAST)} KST < ${kstString(NOW)} KST`)
  } else {
    bad('과거 예약 거부 — 시각을 밀지 않는다', 'policy',
      `past=${blockedByPast} keeps=${keepsValue} notPushed=${notPushed}`)
  }
}

// ── ⑤ dedupKey 불일치 거부 (R11) ────────────────────────
{
  const v = approve({ dedupKey: 'sha256:' + 'b'.repeat(64) })
  if (!v.promote && /dedupKey/.test(v.blockedBy ?? '')) {
    ok('dedupKey 불일치 거부 (R11)', 'guard', 'Sheet ≠ 원장이면 다른 원문일 수 있다')
  } else {
    bad('dedupKey 불일치 거부 (R11)', 'guard', `promote=${v.promote} blocked=${v.blockedBy}`)
  }
}

// ── ⑥ Sheet 가 HOLD 가 아니면 approve 대상이 아니다 ─────
//    🔴 PENDING 복귀 금지 — 이미 승인된 행을 다시 쓰는 것은 의도를 알 수 없다.
{
  const fromPending = !approve({ status: 'PENDING' }).promote
  const fromDeclined = !approve({ status: 'DECLINED' }).promote
  const fromBlank = !approve({ status: '' }).promote
  // sync 모드는 반대로 Sheet=PENDING 을 받는다 — 두 경로가 섞이지 않는지 확인
  const syncTakesPending = evaluatePromotion({
    mode: 'sync', candidateId: 'c', sheet: { ...baseSheet, status: 'PENDING', scheduledPublishAt: '2026-08-27 09:00' },
    db: baseDb, now: NOW, parseKst, kstString,
  }).promote
  if (fromPending && fromDeclined && fromBlank && syncTakesPending) {
    ok('approve 는 HOLD 만 · PENDING 복귀 금지', 'policy', 'approve=HOLD · sync=PENDING 로 경로가 갈린다')
  } else {
    bad('approve 는 HOLD 만 · PENDING 복귀 금지', 'policy',
      `pending=${fromPending} declined=${fromDeclined} blank=${fromBlank} sync=${syncTakesPending}`)
  }
}

// ── ⑦ 편집칸이 유효하지 않으면 승격하지 않는다 ──────────
{
  const emptyTitle = !approve({ founderTitle: '' }).promote
  const longTitle = !approve({ founderTitle: '가'.repeat(500) }).promote
  const badBoard = !approve({ board: 'magazine' }).promote
  const noSchedule = !approve({}, {}, null).promote
  if (emptyTitle && longTitle && badBoard && noSchedule) {
    ok('편집칸 검증 (R3 · R2 · R4)', 'policy', '빈 제목 · 초과 제목 · 화이트리스트 밖 board · 예약 없음')
  } else {
    bad('편집칸 검증 (R3 · R2 · R4)', 'policy',
      `title=${emptyTitle} long=${longTitle} board=${badBoard} sched=${noSchedule}`)
  }
}

// ── ⑧ Sheet 편집칸이 조용히 덮이지 않는다 ───────────────
//    🔴 bootstrap 은 17열을 다시 쓴다. DB 값 기준으로 쓰면 창업자가 Sheet 에서 고친
//       founderTitle 이 사라진다. 판정은 Sheet 값을 받아 DB 에 반영하는 방향이어야 한다.
{
  const edited = '창업자가 다듬은 제목입니다'
  const v = approve({ founderTitle: edited })
  const takesSheetValue = v.data.founderTitle === edited && v.fieldsUpdated.includes('founderTitle')
  // approve-live 소스가 Sheet 실측값을 bootstrap 에 넣는지 본다
  const code = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const readsSheetFirst = /const finalTitle = String\(sheetCells\.founderTitle/.test(code)
  const usesFinal = /founderTitle: finalTitle/.test(code)
  const notDbTitle = !/founderTitle: db\.founderTitle/.test(code)
  if (takesSheetValue && readsSheetFirst && usesFinal && notDbTitle) {
    ok('Sheet 편집칸이 덮이지 않는다', 'guard', 'Sheet 실측 → DB 반영 → bootstrap 순서')
  } else {
    bad('Sheet 편집칸이 덮이지 않는다', 'guard',
      `takes=${takesSheetValue} readsFirst=${readsSheetFirst} uses=${usesFinal} notDb=${notDbTitle}`)
  }
}

// ── ⑨ 단일 candidate 만 건드린다 ────────────────────────
//    🔴 이 fixture 의 핵심. sync-approval-live 를 통째로 부르면 다른 PENDING 행까지 승격된다.
{
  const code = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const offenders: string[] = []
  // 🔴 호출 형태만 보면 안 된다 — `import { readCandidates }` 는 괄호가 없어 빠져나간다.
  //    (역검증에서 실제로 뚫렸다) 이름이 등장하는 것 자체를 막는다.
  //    approve-live 는 단건 조회만 하므로 Sheet 전체 읽기 함수가 필요할 이유가 없다.
  if (/readCandidates/.test(code)) offenders.push('Sheet 전체 읽기 함수 참조')
  if (/sync-approval-live|syncApproval/.test(code)) offenders.push('Sheet 전체 승격 경로 참조')
  if (/findMany\(/.test(code)) offenders.push('후보 다건 조회')
  if (/updateMany\(|deleteMany\(/.test(code)) offenders.push('다건 write')
  if (!/findUnique\(\s*\{/.test(code)) offenders.push('단건 조회(findUnique)가 없다')
  if (!/--candidate=<uuid> 가 필요하다/.test(readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8'))) {
    offenders.push('--candidate 필수 검사 없음')
  }
  if (offenders.length) bad('단일 candidate 만 승격', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('단일 candidate 만 승격', 'guard', 'findUnique 단건 · Sheet 전체 훑기 없음')
}

// ── ⑩ publisher 를 부르지 않는다 · PUBLISHED 를 쓰지 않는다 ──
//    🔴 "참조" 가 아니라 **실행과 기록**을 본다.
//       마지막 안내 문구에 `publish-live` 가 나오는 것은 정상이다 — 사람에게 다음 단계를
//       알려주는 것이지 부르는 게 아니다. publishedToday 카운트의 where 절에
//       'PUBLISHED' 가 나오는 것도 읽기이지 기록이 아니다.
//       금지선을 문자열로 잡으면 정당한 코드를 막고, 막힌 사람은 가드를 우회한다.
{
  const files = ['micro-seed-approve-live.mts', 'lib/micro-seed-approve-lib.mts']
  const offenders: string[] = []
  for (const rel of files) {
    const raw = readFileSync(join(HERE, rel), 'utf-8')
    const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
    // publisher 를 실제로 부르는 경로
    if (/from '[^']*publish-live|from '[^']*publish-lib|import\([^)]*publish-/.test(code)) {
      offenders.push(`${rel}: publisher import`)
    }
    if (/execSync|spawnSync|child_process/.test(code)) offenders.push(`${rel}: 외부 명령 실행`)
    if (/ACQUIRE_CANDIDATE_SQL|\$executeRaw|\$queryRaw/.test(code)) offenders.push(`${rel}: 획득 SQL`)
    if (/post\.(create|update|upsert)/.test(code)) offenders.push(`${rel}: Post write`)
    if (/microSeedCandidateHistory\.create/.test(code)) offenders.push(`${rel}: History 기록`)
    // 기록 문맥의 PUBLISHED — where(읽기)는 허용, data(쓰기)는 금지
    if (/data:[\s\S]{0,120}'PUBLISHED'/.test(code)) offenders.push(`${rel}: data 에 PUBLISHED`)
    if (/status\s*=\s*'PUBLISHED'/.test(code)) offenders.push(`${rel}: status 를 PUBLISHED 로`)
  }
  // DB update 는 lib 판정 결과만 넘긴다 — 임의 payload 를 만들지 않는다
  const app = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
  const onlyVerdictData = /microSeedCandidate\.update\(\{ where: \{ id: candidateId \}, data: verdict\.data \}\)/.test(app)
  if (!onlyVerdictData) offenders.push('DB update 가 verdict.data 이외의 payload 를 쓴다')
  // lib 이 넣는 status 는 PENDING 뿐이다
  const lib = readFileSync(join(HERE, 'lib/micro-seed-approve-lib.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const statusWrites = [...lib.matchAll(/data\.status = '([A-Z]+)'/g)].map((m) => m[1])
  if (statusWrites.length !== 1 || statusWrites[0] !== 'PENDING') {
    offenders.push(`lib 이 쓰는 status=${statusWrites.join(',') || '(없음)'} (기대 PENDING 하나)`)
  }
  if (offenders.length) bad('publisher 실행 0 · PUBLISHED 기록 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('publisher 실행 0 · PUBLISHED 기록 0', 'guard', 'import 0 · Post 0 · History 0 · status 는 PENDING 뿐')
}

// ── ⑪ dry-run 기본 — --apply 없으면 write 0 ─────────────
{
  const raw = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
  const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const applyOptIn = /const APPLY = process\.argv\.includes\('--apply'\)/.test(code)
  // write 호출부가 APPLY 게이트 뒤에 있는지 — 위치로 확인한다
  const gate = code.indexOf('if (!APPLY)')
  const sheetWrite = code.indexOf('updateCandidateRow(')
  const dbWrite = code.indexOf('microSeedCandidate.update(')
  const gated = gate !== -1 && sheetWrite > gate && dbWrite > gate
  const argsRequired = /--at 과 --in 을 함께 쓸 수 없다/.test(raw) && /중 하나가 필요하다/.test(raw)
  if (applyOptIn && gated && argsRequired) {
    ok('dry-run 기본 · --at/--in 정확히 하나', 'guard', 'write 는 전부 --apply 게이트 뒤')
  } else {
    bad('dry-run 기본 · --at/--in 정확히 하나', 'guard',
      `optIn=${applyOptIn} gated=${gated} args=${argsRequired}`)
  }
}

// ── ⑫ P/Q 에 쓰지 않는다 ────────────────────────────────
{
  const code = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
  const emptyPostUrl = /postUrl: '',/.test(code)
  const emptyStamp = /updatedBySystemAt: '',/.test(code)
  const noColumnsMode = !/mode: 'columns'/.test(code)
  const usesBootstrap = /mode: 'bootstrap'/.test(code)
  if (emptyPostUrl && emptyStamp && noColumnsMode && usesBootstrap) {
    ok('P/Q 는 공란으로 둔다 (§6-1)', 'guard', '발행 흔적은 publisher 만 쓴다')
  } else {
    bad('P/Q 는 공란으로 둔다 (§6-1)', 'guard',
      `url=${emptyPostUrl} stamp=${emptyStamp} noColumns=${noColumnsMode} bootstrap=${usesBootstrap}`)
  }
}

// ── ⑬ sync-approval 과 같은 lib 을 쓴다 (C-2) ───────────
//    🔴 판정이 갈라지면 "한쪽은 승격, 한쪽은 보류" 가 되고 그게 가장 늦게 발견된다.
{
  const sync = readFileSync(join(HERE, 'micro-seed-sync-approval-live.mts'), 'utf-8')
  const app = readFileSync(join(HERE, 'micro-seed-approve-live.mts'), 'utf-8')
  const bothImport = /from '\.\/lib\/micro-seed-approve-lib\.mjs'/.test(sync)
    && /from '\.\/lib\/micro-seed-approve-lib\.mjs'/.test(app)
  // sync 가 판정을 자기 안에 다시 구현하고 있지 않은지 (복제 회귀)
  const syncCode = sync.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const noDuplicate = !/MIN_POST_TITLE_LENGTH/.test(syncCode) && !/resolvePublishableBoard/.test(syncCode)
  const bothCall = /evaluatePromotion\(/.test(sync) && /evaluatePromotion\(/.test(app)
  if (bothImport && noDuplicate && bothCall) {
    ok('승격 판정은 한 곳에만 있다 (C-2)', 'guard', 'sync-approval · approve-live 가 같은 lib')
  } else {
    bad('승격 판정은 한 곳에만 있다 (C-2)', 'guard',
      `import=${bothImport} noDup=${noDuplicate} call=${bothCall}`)
  }
}

// ── ⑭ lib 은 DB · Sheet · 네트워크를 모른다 ─────────────
{
  const code = readFileSync(join(HERE, 'lib/micro-seed-approve-lib.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const offenders: string[] = []
  if (/@prisma\/client|PrismaClient|prisma\./.test(code)) offenders.push('prisma')
  if (/googleapis|GoogleAuth|updateCandidateRow/.test(code)) offenders.push('Sheet')
  if (/\bfetch\s*\(|axios/.test(code)) offenders.push('네트워크')
  if (/Math\.random|Date\.now|new Date\(\)/.test(code)) offenders.push('비결정성')
  if (offenders.length) bad('판정 lib 은 순수하다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('판정 lib 은 순수하다', 'guard', '값을 받아 판정만 돌려준다 — fixture 가 전부 검증한다')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nMicro Seed 승인 레일 — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB · Sheet 를 타지 않는다')
console.log('  🔴 검사하는 것은 "승인이 되는가" 가 아니라 "승인해서는 안 될 것을 막는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(36)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 승인 레일이 선을 넘지 않는다\n`)
