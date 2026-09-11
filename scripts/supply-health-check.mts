/**
 * 콘텐츠 공급 관제 fixture (§4-AW)
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0. 순수 판정만 검사한다.
 */

import { readFileSync } from 'node:fs'

import {
  FORBIDDEN_BODY_KEYS, buildReport, judgePublish, judgeSource, judgeSupply,
  logHintOf, perItemSkipCount, rollUpSources, worstOf, PUBLISH_GRACE_MS,
  type Finding, type SourceInput,
} from '../src/lib/supply-health'
import { STOCK_MIN, STOCK_TARGET } from '../src/lib/micro-seed-supply-autofill'
import { verifyPublishedRow } from '../src/lib/original-post-publish-verify'
import { judgeCapacity } from '../src/lib/supply-capacity-forecast'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const NOW = new Date('2026-09-08T12:00:00.000Z')
const HOUR = 3_600_000
const STALE = 30 * HOUR
const ago = (h: number): Date => new Date(NOW.getTime() - h * HOUR)

const src = (over: Partial<SourceInput> = {}): SourceInput => ({
  sourceId: '82cook', lastArtifactAt: ago(2), lastArtifactRows: 50, leakedKeys: [],
  firstScheduledAt: null, logs: [], now: NOW, staleAfterMs: STALE,
  ...over,
})
const codes = (fs: readonly Finding[]): string[] => fs.map((x) => x.code)

/** 🔴 정합이 완전한 한 행 — 여기서 하나씩 어긋뜨려 본다 */
const OK_POST = {
  status: 'PUBLISHED', source: 'SYSTEM', boardType: 'FREE', personaId: 'p1',
  // 🔴 3축 판정 결과만 받는다 — 플래그를 직접 다루면 노출 규칙이 두 곳에 생긴다
  searchIndexable: true, discoveryEligible: true,
  sourceUrl: null, sourceArticleId: null, sheetCandidateId: null,
}
const OK_ROW = {
  queueId: 'q1', queueStatus: 'PUBLISHED', createdPostId: 'post1',
  queuePersonaId: 'p1', post: OK_POST, activityLogCount: 1,
}

console.log('\n══ 콘텐츠 공급 관제 fixture ══\n')

// ── A. 수집원 ──
check('🟢 최근 산출물이 있으면 HEALTHY', (() => {
  const r = judgeSource(src())
  return r.length === 1 && r[0].level === 'HEALTHY' && r[0].code === 'SOURCE_OK'
})())
check('🟡 오래되면 WARNING', (() => {
  const r = judgeSource(src({ lastArtifactAt: ago(40) }))
  return r[0].code === 'SOURCE_STALE' && r[0].level === 'WARNING'
})())
check('🔴 전문 필드가 있으면 CRITICAL — 다른 무엇보다 먼저다', (() => {
  const r = judgeSource(src({ leakedKeys: ['rawBody'] }))
  return r[0].code === 'SOURCE_LEAKED_BODY' && r[0].level === 'CRITICAL'
})())
const LOG = (name: string, hint: 'none'|'session'|'selector'|'other', fresh: boolean) =>
  ({ name, hint, newerThanArtifact: fresh })

check('🔴 세션 만료는 selector 실패와 다른 코드다', (() => {
  const a = judgeSource(src({ logs: [LOG('stderr', 'session', true)] }))
  const b = judgeSource(src({ logs: [LOG('stderr', 'selector', true)] }))
  const set = new Set<string>([a[0].code, b[0].code])
  return a[0].code === 'SOURCE_SESSION_EXPIRED' && b[0].code === 'SOURCE_SELECTOR_FAIL' && set.size === 2
})())
check('🟡 최신 로그의 그 밖의 오류는 WARNING 이다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', 'other', true)] }))
  return r.some((x) => x.code === 'SOURCE_JOB_FAILED' && x.level === 'WARNING')
})())
// 🔴 [8] 옛 error 로그가 최신 성공을 덮지 않는다
check('🔴 [8] 옛 error 로그 + 그 뒤 산출물 → 현재 실패로 오판하지 않는다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', 'session', false)] }))
  return !r.some((x) => x.level === 'CRITICAL') && r.some((x) => x.level === 'HEALTHY')
})())
check('🔴 [8] 산출물보다 **최신인** 오류 로그는 그대로 CRITICAL 이다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', 'session', true)] }))
  return r.some((x) => x.code === 'SOURCE_SESSION_EXPIRED' && x.level === 'CRITICAL')
})())
check('🔴 exit status 를 읽는다고 말하지 않는다 — 필드가 아예 없다',
  !Object.keys(src()).includes('lastExit'))

// ══ 🔴 로그 파일별 독립 판정 — 내용과 시각을 섞지 않는다 ══
check('🔴 [로그] 오래된 stderr 오류 + 최신 stdout 정상 → 장애가 아니다', (() => {
  const r = judgeSource(src({
    logs: [LOG('stderr', 'session', false), LOG('stdout', 'none', true)],
  }))
  return !r.some((x) => x.level === 'CRITICAL') && r.some((x) => x.level === 'HEALTHY')
})())
check('🔴 [로그] 최신 stderr session 오류 → session 장애', (() => {
  const r = judgeSource(src({
    logs: [LOG('stderr', 'session', true), LOG('stdout', 'none', false)],
  }))
  return r.some((x) => x.code === 'SOURCE_SESSION_EXPIRED' && x.level === 'CRITICAL')
})())
check('🔴 [로그] 최신 stdout selector 오류 → selector 장애', (() => {
  const r = judgeSource(src({
    logs: [LOG('stdout', 'selector', true), LOG('stderr', 'none', false)],
  }))
  return r.some((x) => x.code === 'SOURCE_SELECTOR_FAIL' && x.level === 'CRITICAL')
})())
check('🔴 [로그] 오류 이후 더 최신 산출물이 나오면 INFO 로 내린다', (() => {
  const r = judgeSource(src({
    logs: [LOG('stderr', 'session', false), LOG('stdout', 'selector', false)],
  }))
  return r.some((x) => x.level === 'INFO' && x.message.includes('지난 일이다'))
    && !r.some((x) => x.level === 'CRITICAL')
})())
check('🟢 [로그] 둘 다 정상이면 SOURCE_OK', (() => {
  const r = judgeSource(src({ logs: [LOG('stdout', 'none', true), LOG('stderr', 'none', true)] }))
  return r.length === 1 && r[0].code === 'SOURCE_OK'
})())
check('🔴 [로그] 러너가 파일별로 판정한다 — 내용을 합치지 않는다', (() => {
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  return /function logFacts\(/.test(runner)
    && /newerThanArtifact: artifactAt === null \|\| at\.getTime\(\) > artifactAt\.getTime\(\)/.test(runner)
    && !/text \+=/.test(runner)
})())

// 🔴 시각 경계 — 오늘 등록한 job 을 죽었다고 하면 안 된다
check('🔴 [경계] 첫 예정 시각 **전**이면 산출물이 없어도 실패가 아니다', (() => {
  const r = judgeSource(src({ lastArtifactAt: null, firstScheduledAt: new Date(NOW.getTime() + HOUR) }))
  return r[0].code === 'SOURCE_PENDING_FIRST_RUN' && r[0].level === 'INFO'
})())
check('🟡 [경계] 첫 예정 시각이 **지났는데** 산출물이 없으면 WARNING', (() => {
  const r = judgeSource(src({ lastArtifactAt: null, firstScheduledAt: new Date(NOW.getTime() - HOUR) }))
  return r[0].code === 'SOURCE_NO_ARTIFACT' && r[0].level === 'WARNING'
})())
check('🟡 [경계] 예정 시각 정보가 없고 산출물도 없으면 WARNING', (() => {
  const r = judgeSource(src({ lastArtifactAt: null, firstScheduledAt: null }))
  return r[0].code === 'SOURCE_NO_ARTIFACT'
})())
check('🔴 [경계] 첫 실행 전이면 오래됨으로도 세지 않는다', (() => {
  const r = judgeSource(src({
    lastArtifactAt: ago(100), firstScheduledAt: new Date(NOW.getTime() + HOUR),
  }))
  return !codes(r).includes('SOURCE_STALE')
})())
check('🔴 [경계] staleAfterMs 직전은 정상, 직후는 경고', (() => {
  const okOne = judgeSource(src({ lastArtifactAt: new Date(NOW.getTime() - STALE + 1000) }))
  const badOne = judgeSource(src({ lastArtifactAt: new Date(NOW.getTime() - STALE - 1000) }))
  return okOne[0].code === 'SOURCE_OK' && badOne[0].code === 'SOURCE_STALE'
})())

// ── 🔴 세 소스 독립 실패 ──
const dead = (id: string): { sourceId: string; findings: Finding[] } => ({
  sourceId: id,
  findings: judgeSource(src({ sourceId: id, logs: [LOG('stderr', 'session', true)] })),
})
const alive = (id: string): { sourceId: string; findings: Finding[] } => ({
  sourceId: id, findings: judgeSource(src({ sourceId: id })),
})

check('🟡 [독립] 소스 하나가 죽어도 나머지가 살아 있으면 WARNING 이다', (() => {
  const r = rollUpSources([dead('navercafe:wgang'), alive('82cook'), alive('navercafe:remonterrace')])
  return r.length === 1 && r[0].level === 'WARNING'
})())
check('🟡 [독립] 둘이 죽어도 하나가 살아 있으면 WARNING', (() => {
  const r = rollUpSources([dead('navercafe:wgang'), dead('navercafe:remonterrace'), alive('82cook')])
  return r[0].level === 'WARNING'
})())
check('🔴 [독립] 셋이 다 죽으면 CRITICAL — 공급이 끊긴다', (() => {
  const r = rollUpSources([dead('a'), dead('b'), dead('c')])
  return r[0].level === 'CRITICAL'
})())
check('🟢 [독립] 다 살아 있으면 아무 말도 하지 않는다',
  rollUpSources([alive('a'), alive('b')]).length === 0)
check('🔴 [독립] 죽은 소스 이름이 메시지에 남는다', (() => {
  const r = rollUpSources([dead('navercafe:wgang'), alive('82cook')])
  return r[0].message.includes('navercafe:wgang')
})())

// ── B. 공급 ──
// 🔴 재고 기준선은 **주입값**이다 (2026-09-08). 기본은 지금 운영값(d1)과 같다
const sup = (over: Partial<Parameters<typeof judgeSupply>[0]> = {}): Finding[] => judgeSupply({
  usable: 14, human: 5, machine: 9, legacyExcluded: 5, pendingThin: 0, historicRawNoop: 0,
  runningCheckpoints: 0, failedCheckpoints: 0, lock: 'free',
  lastSupplyOkAt: ago(2), now: NOW, staleAfterMs: STALE,
  stockMin: 5, stockTarget: 14,
  ...over,
})
check('🟢 재고가 목표면 HEALTHY', sup()[0].code === 'STOCK_OK')
// 🔴 **기준선이 주입값을 따른다** — capacity=d10 이면 재고 14건은 부족이다
check('🔴 capacity 기준(50/140)에서 재고 14건은 STOCK_LOW',
  sup({ stockMin: 50, stockTarget: 140 })[0].code === 'STOCK_LOW'
  && sup({ stockMin: 50, stockTarget: 140 })[0].level === 'WARNING')
check('🔴 그 메시지에 주입한 최소값이 적힌다', sup({ stockMin: 50, stockTarget: 140 })[0].message.includes('50건'))
check('🟢 재고가 capacity 목표를 채우면 HEALTHY',
  sup({ usable: 140, stockMin: 50, stockTarget: 140 })[0].code === 'STOCK_OK')
check('🔴 정상 요약에도 주입한 목표가 적힌다',
  sup({ usable: 140, stockMin: 50, stockTarget: 140 })[0].message.includes('140/140건'))
check('🔴 재고 0 은 CRITICAL', sup({ usable: 0 })[0].level === 'CRITICAL')
check('🟡 재고가 최소 미만이면 WARNING', sup({ usable: STOCK_MIN - 1 })[0].level === 'WARNING')
check('🟢 재고 최소 경계는 정상', sup({ usable: STOCK_MIN })[0].code === 'STOCK_OK')
check('🟡 실패한 회차는 WARNING', codes(sup({ failedCheckpoints: 1 })).includes('CHECKPOINT_FAILED'))
check('🟡 미완료 회차는 WARNING', codes(sup({ runningCheckpoints: 1 })).includes('CHECKPOINT_RUNNING'))
check('🟡 죽은 lock 은 WARNING', (() => {
  const r = sup({ lock: 'stale' })
  return r.some((x) => x.code === 'LOCK_STALE' && x.level === 'WARNING')
})())
check('· 도는 중인 lock 은 INFO — 장애가 아니다', (() => {
  const r = sup({ lock: 'busy' })
  return r.some((x) => x.code === 'LOCK_BUSY' && x.level === 'INFO')
})())
check('🔴 [역사 raw] 반복 no-op 은 INFO 이고 등급을 올리지 않는다', (() => {
  const r = sup({ historicRawNoop: 2 })
  const hit = r.find((x) => x.code === 'HISTORIC_RAW_NOOP')
  return hit?.level === 'INFO' && worstOf(r) === 'HEALTHY'
})())
check('· 미처리 얇은 파일도 INFO 다', (() => {
  const r = sup({ pendingThin: 3 })
  return r.find((x) => x.code === 'PENDING_THIN')?.level === 'INFO' && worstOf(r) === 'HEALTHY'
})())
check('🟡 마지막 공급 성공이 오래되면 WARNING',
  codes(sup({ lastSupplyOkAt: ago(40) })).includes('SUPPLY_STALE'))
check('· 성공 기록이 아직 없으면 INFO — 새로 붙인 레인이 그렇다', (() => {
  const r = sup({ lastSupplyOkAt: null })
  return r.find((x) => x.code === 'SUPPLY_STALE')?.level === 'INFO'
})())

// ── C. 발행 ──
const pub = (over: Partial<Parameters<typeof judgePublish>[0]> = {}): Finding[] => judgePublish({
  todayCount: 1, dailyCap: 1, afterPublishGrace: true, mismatched: 0,
  legacyPublishedToday: 0, historicUnknownProfile: 0, candidates: 14, now: NOW,
  ...over,
})
check('🟢 상한 안이면 HEALTHY', pub()[0].code === 'PUBLISH_OK')
check('🔴 상한을 넘으면 CRITICAL', (() => {
  const r = pub({ todayCount: 2 })
  return r.some((x) => x.code === 'PUBLISH_OVER_CAP' && x.level === 'CRITICAL')
})())
check('🟢 상한 경계(=cap)는 정상', pub({ todayCount: 1 })[0].code === 'PUBLISH_OK')
check('🔴 오늘 legacy 가 나갔으면 CRITICAL', (() => {
  const r = pub({ legacyPublishedToday: 1 })
  return r.some((x) => x.code === 'PUBLISH_LEGACY' && x.level === 'CRITICAL')
})())
check('🔴 [역사] 과거 발행 기록은 INFO 다 — 매일 CRITICAL 이 뜨면 사람이 화면을 믿지 않는다', (() => {
  const r = pub({ historicUnknownProfile: 2 })
  const hit = r.find((x) => x.code === 'PUBLISH_HISTORIC_UNKNOWN')
  return hit?.level === 'INFO' && worstOf(r) === 'HEALTHY'
})())
check('🔴 Queue↔Post 정합이 깨지면 CRITICAL', (() => {
  const r = pub({ mismatched: 1 })
  return r.some((x) => x.code === 'PUBLISH_MISMATCH' && x.level === 'CRITICAL')
})())
check('🟡 후보 0 은 WARNING 이고 다른 코드다', (() => {
  const r = pub({ candidates: 0 })
  return r.some((x) => x.code === 'PUBLISH_NO_CANDIDATE' && x.level === 'WARNING')
})())
check('🔴 후보 0 · 세션 만료 · selector 실패 · stale checkpoint 가 서로 다른 코드다', (() => {
  const set = new Set([
    pub({ candidates: 0 }).find((x) => x.level === 'WARNING')?.code,
    judgeSource(src({ logs: [LOG('stderr', 'session', true)] }))[0].code,
    judgeSource(src({ logs: [LOG('stderr', 'selector', true)] }))[0].code,
    sup({ runningCheckpoints: 1 }).find((x) => x.code === 'CHECKPOINT_RUNNING')?.code,
  ])
  return set.size === 4
})())

// ── 전체 판정 ──
check('🟢 다 정상이면 HEALTHY · exit 0', (() => {
  const r = buildReport({ sources: [alive('82cook')], supply: sup(), publish: pub() })
  return r.level === 'HEALTHY' && r.exitCode === 0
})())
check('🟡 WARNING 은 exit 0 이다 — 종료 코드를 바꾸면 사람이 곧 무시한다', (() => {
  const r = buildReport({ sources: [alive('a')], supply: sup({ usable: 2 }), publish: pub() })
  return r.level === 'WARNING' && r.exitCode === 0
})())
check('🔴 CRITICAL 만 exit 1', (() => {
  const r = buildReport({ sources: [alive('a')], supply: sup({ usable: 0 }), publish: pub() })
  return r.level === 'CRITICAL' && r.exitCode === 1
})())
check('🟡 소스 하나만 죽으면 전체는 WARNING 이다 — 전면 중단과 구분한다', (() => {
  const r = buildReport({
    sources: [dead('navercafe:wgang'), alive('82cook')], supply: sup(), publish: pub(),
  })
  return r.level === 'WARNING' && r.exitCode === 0
})())
check('🔴 소스가 모두 죽으면 CRITICAL', (() => {
  const r = buildReport({ sources: [dead('a'), dead('b')], supply: sup(), publish: pub() })
  return r.level === 'CRITICAL' && r.exitCode === 1
})())
check('· INFO 만 있으면 등급을 올리지 않는다',
  worstOf([{ level: 'INFO', code: 'PENDING_THIN', message: '' }]) === 'HEALTHY')

// ══════════════════════════════════════════════════════════════════
// 🔴 로그 힌트 — **개별 글 실패와 소스 전체 실패는 다르다**
//
// 수집기는 글 하나를 못 읽으면 "⚠️ … (건너뛴다)" 를 찍고 다음 글로 넘어간다.
// 20건 중 1건을 건너뛰고 19건을 저장해도 그 줄은 남는다 —
// 그것을 소스 장애로 읽으면 정상 회차가 매번 CRITICAL 로 뜬다.
// ══════════════════════════════════════════════════════════════════

/** 🔴 수집기의 **실제 출력 문구**다 (micro-seed-collect-navercafe.mts 실측) */
const SKIP_SELECTOR = '  ⚠️ 447520 — 본문 셀렉터가 터졌다(건너뛴다): TimeoutError'
const SKIP_EMPTY = '  ⚠️ 447530 — 본문이 비었다. 셀렉터가 안 맞거나 접근이 막혔다(건너뛴다)'
const SAVED = '  ✅ 447521 · 735자 · 댓글 19\n  → ./.microseed-data/navercafe-thin-wgang-R.thin-detail.jsonl (1건)'
const LIST_EMPTY = 'Error: 목록이 비었다 [LIST_EMPTY] — 셀렉터가 하나도 안 맞는다'
const SESSION_FAIL = '\n🛑 SESSION_REUSE — 우나어 storage-state 재사용은 막는다\n'

check('🔴 [개별] selector skip + 정상 저장 → 소스 장애가 아니다',
  logHintOf(`${SKIP_SELECTOR}\n${SAVED}`) === 'none')
check('🔴 [개별] 본문 빈 값 skip + 다른 행 정상 → 소스 장애가 아니다',
  logHintOf(`${SKIP_EMPTY}\n${SAVED}`) === 'none')
check('🔴 [개별] 10건을 건너뛰어도 정상 종료면 장애가 아니다', (() => {
  const many = Array.from({ length: 10 }, (_, i) => `  ⚠️ 4475${i} — 본문 셀렉터가 터졌다(건너뛴다)`).join('\n')
  return logHintOf(`${many}\n${SAVED}`) === 'none'
})())
check('🟢 [개별] 건너뛴 수는 참고 수치로 셀 수 있다',
  perItemSkipCount(`${SKIP_SELECTOR}\n${SKIP_EMPTY}\n${SAVED}`) === 2)
check('🔴 [terminal] 목록 전체가 비면 selector 장애다', logHintOf(LIST_EMPTY) === 'selector')
check('🔴 [terminal] 세션 실패는 session 장애다', logHintOf(SESSION_FAIL) === 'session')
check('🔴 [terminal] 로그인 풀림도 session 이다',
  logHintOf('\n🛑 로그인이 풀렸다 — 세션을 다시 발급해야 한다\n') === 'session')
check('🟢 정상 로그는 none',
  logHintOf('  ✅ 447540 · 812자\n  🔴 전문을 저장하지 않았다') === 'none')
check('🔴 그 밖의 terminal 오류는 other', logHintOf('Error: connect ECONNREFUSED') === 'other')
check('🔴 [혼합] 개별 skip 이 terminal 오류를 가리지 않는다',
  logHintOf(`${SKIP_SELECTOR}\n${LIST_EMPTY}`) === 'selector')

// 🔴 최상위 catch 는 `❌ <message>` 다 (main().catch 실측).
//    이것을 놓치면 실행 timeout · 브라우저 실행 실패 · 권한 오류가 전부 "정상" 으로 읽힌다 —
//    소스가 며칠째 안 도는데 화면은 초록이다.
const CATCH_TIMEOUT = '\n❌ 실행 timeout\n'
const CATCH_BROWSER = '\n❌ browserType.launch: Executable does not exist at /path/chrome\n'
const CATCH_EACCES = "\n❌ EACCES: permission denied, open '/x/y.jsonl'\n"
const CATCH_LIST = '\n❌ 목록이 비었다 [LIST_EMPTY] — 셀렉터가 하나도 안 맞는다\n'
const CATCH_SESSION = '\n❌ 세션이 만료됐다 — 다시 발급해야 한다\n'

check('🔴 [❌ 1] 실행 timeout → other', logHintOf(CATCH_TIMEOUT) === 'other')
check('🔴 [❌ 2] browserType.launch 실패 → other', logHintOf(CATCH_BROWSER) === 'other')
check('🔴 [❌ 3] EACCES → other', logHintOf(CATCH_EACCES) === 'other')
check('🔴 [❌ 4] 목록이 비었다 → selector', logHintOf(CATCH_LIST) === 'selector')
check('🔴 [❌ 5] 세션 만료 → session', logHintOf(CATCH_SESSION) === 'session')
check('🟢 [❌ 6] 개별 skip 은 그대로 none', logHintOf(SKIP_SELECTOR) === 'none')
check('🔴 [❌ 7] 개별 skip 뒤의 ❌ terminal 이 이긴다',
  logHintOf(`${SKIP_SELECTOR}\n${CATCH_TIMEOUT}`) === 'other')
check('🟢 [❌ 8] 정상 안내(🔴 이모지)를 terminal 로 잡지 않는다',
  logHintOf('  ✅ 447540 · 812자\n  🔴 전문을 저장하지 않았다 — 마스킹 후 앞 300자만 남겼다') === 'none')
check('🔴 [❌] 러너가 ❌ 를 terminal 로 인식한다', (() => {
  const lib = readFileSync('src/lib/supply-health.ts', 'utf-8')
  const fn = /function isTerminal\([\s\S]*?\n\}/.exec(lib)
  return fn !== null && fn[0].includes('❌')
})())
check('🔴 [❌] 최신 ❌ 오류는 소스 장애로 올라간다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', logHintOf(CATCH_BROWSER), true)] }))
  return r.some((x) => x.code === 'SOURCE_JOB_FAILED' && x.level === 'WARNING')
})())
check('🔴 [❌] 최신 ❌ 세션 오류는 CRITICAL 이다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', logHintOf(CATCH_SESSION), true)] }))
  return r.some((x) => x.code === 'SOURCE_SESSION_EXPIRED' && x.level === 'CRITICAL')
})())

// ── 소스 등급까지 이어지는지 ──
check('🔴 [행동] 개별 skip 만 있는 최신 stdout → 소스 전체 CRITICAL 이 아니다', (() => {
  const r = judgeSource(src({
    logs: [LOG('stdout', logHintOf(`${SKIP_SELECTOR}\n${SAVED}`), true)],
  }))
  return !r.some((x) => x.level === 'CRITICAL') && r.some((x) => x.code === 'SOURCE_OK')
})())
check('🔴 [행동] 목록 전체 실패는 selector 장애로 올라간다', (() => {
  const r = judgeSource(src({ logs: [LOG('stderr', logHintOf(LIST_EMPTY), true)] }))
  return r.some((x) => x.code === 'SOURCE_SELECTOR_FAIL' && x.level === 'CRITICAL')
})())
check('🔴 [행동] 최신 stderr terminal selector + 새 산출물 없음 → selector 장애', (() => {
  const r = judgeSource(src({
    lastArtifactAt: ago(40), logs: [LOG('stderr', logHintOf(LIST_EMPTY), true)],
  }))
  return r.some((x) => x.code === 'SOURCE_SELECTOR_FAIL')
})())
check('🔴 [행동] 오래된 stderr 오류 + 최신 정상 산출물 → 장애 아님', (() => {
  const r = judgeSource(src({
    logs: [LOG('stderr', logHintOf(SESSION_FAIL), false), LOG('stdout', 'none', true)],
  }))
  return !r.some((x) => x.level === 'CRITICAL')
})())

// ══════════════════════════════════════════════════════════════════
// 🔴 마스터가 지정한 회귀 10건
// ══════════════════════════════════════════════════════════════════

// [1] 사용자 Post 5건 + ActivityLog post 1건 → todayCount=1
check('🔴 [1] cap 은 ActivityLog 로 센다 — 사용자 Post 5건이 있어도 1이다', (() => {
  // 러너가 personaActivityLog.count 를 쓰는지 코드로 고정한다
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  const usesLog = /personaActivityLog\.count\(\{[\s\S]{0,160}kind: 'post'/.test(runner)
  const notAllPosts = !/post\.count\(\{\s*where:\s*\{\s*createdAt/.test(runner)
  // 그렇게 센 1건은 cap 안이다
  return usesLog && notAllPosts && pub({ todayCount: 1 }).some((x) => x.code === 'PUBLISH_OK')
})())
check('🔴 [1] cap 초과는 여전히 CRITICAL', pub({ todayCount: 2 }).some((x) => x.level === 'CRITICAL'))

// [2] PUBLISHED + createdPostId null → CRITICAL
check('🔴 [2] PUBLISHED 인데 createdPostId 가 없으면 문제로 잡는다', (() => {
  const p = verifyPublishedRow({
    queueId: 'q1', queueStatus: 'PUBLISHED', createdPostId: null,
    queuePersonaId: 'p1', post: null, activityLogCount: 0,
  })
  return p.length === 1 && p[0].includes('createdPostId')
})())
check('🔴 [2] 그 결과가 health 에서 CRITICAL 이 된다',
  pub({ mismatched: 1 }).some((x) => x.code === 'PUBLISH_MISMATCH' && x.level === 'CRITICAL'))
check('🔴 [2] createdPostId 는 있는데 status 가 PUBLISHED 가 아니면 잡는다', (() => {
  const p = verifyPublishedRow({
    queueId: 'q', queueStatus: 'APPROVED', createdPostId: 'post1', queuePersonaId: 'p1',
    post: OK_POST, activityLogCount: 1,
  })
  return p.some((x) => x.includes('status=APPROVED'))
})())

// [3] Post 존재 + ActivityLog 0/2 → 문제
check('🔴 [3] ActivityLog 0건이면 잡는다', (() => {
  const p = verifyPublishedRow({ ...OK_ROW, activityLogCount: 0 })
  return p.some((x) => x.includes('ActivityLog 0건'))
})())
check('🔴 [3] ActivityLog 2건이면 잡는다', (() => {
  const p = verifyPublishedRow({ ...OK_ROW, activityLogCount: 2 })
  return p.some((x) => x.includes('ActivityLog 2건'))
})())
check('🟢 [3] 정확히 1건이면 통과', verifyPublishedRow(OK_ROW).length === 0)

// 나머지 정합 항목 — 🔴 publish-live --check 계약 전부
check('🔴 연결 Post 없음', verifyPublishedRow({ ...OK_ROW, post: null }).some((x) => x.includes('Post 가 없다')))
check('🔴 Post status≠PUBLISHED',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, status: 'HIDDEN' } }).some((x) => x.includes('status=HIDDEN')))
check('🔴 source≠SYSTEM',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, source: 'USER' } }).some((x) => x.includes('source=USER')))
check('🔴 boardType≠FREE',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, boardType: 'JOB' } }).some((x) => x.includes('boardType=JOB')))
check('🔴 persona 불일치',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, personaId: 'other' } }).some((x) => x.includes('persona 불일치')))
check('🔴 색인 대상이 아니면 잡는다 (isMicroSeed·permanentNoindex 를 정본이 판정)',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, searchIndexable: false } })
    .some((x) => x.includes('색인 대상이 아니다')))
check('🔴 추천 표면에 못 오르면 잡는다 (indexPromotionBlocked 를 정본이 판정)',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, discoveryEligible: false } })
    .some((x) => x.includes('추천 표면')))
check('🔴 3축 플래그를 이 lib 이 직접 다루지 않는다 — 노출 게이트(C-2·C-4) 계약', (() => {
  const lib = readFileSync('src/lib/original-post-publish-verify.ts', 'utf-8')
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  return !/\bp\.(isMicroSeed|permanentNoindex|indexPromotionBlocked)\b/.test(code)
})())
check('🔴 호출부가 post-visibility 정본 함수를 경유한다', (() => {
  const live = readFileSync('scripts/original-post-publish-live.mts', 'utf-8')
  const health = readFileSync('scripts/supply-health.mts', 'utf-8')
  return /isSearchIndexable\(post\)/.test(live) && /isDiscoveryEligible\(post\)/.test(live)
    && /isSearchIndexable\(post\)/.test(health) && /isDiscoveryEligible\(post\)/.test(health)
})())
check('🔴 sourceUrl 이 Post 에 남음',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, sourceUrl: 'x' } }).some((x) => x.includes('sourceUrl')))
check('🔴 sourceArticleId 가 남음',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, sourceArticleId: 'x' } }).some((x) => x.includes('sourceArticleId')))
check('🔴 sheetCandidateId 가 남음',
  verifyPublishedRow({ ...OK_ROW, post: { ...OK_POST, sheetCandidateId: 'x' } }).some((x) => x.includes('sheetCandidateId')))
check('🔴 [정본] publish-live --check 가 같은 함수를 쓴다', (() => {
  const live = readFileSync('scripts/original-post-publish-live.mts', 'utf-8')
  return /verifyPublishedRow\(/.test(live) && /original-post-publish-verify/.test(live)
})())

// [4] 한 소스 leaked + 나머지 정상 → 전체 CRITICAL
const leakedSrc = (id: string): { sourceId: string; findings: Finding[] } => ({
  sourceId: id, findings: judgeSource(src({ sourceId: id, leakedKeys: ['rawBody'] })),
})
check('🔴 [4] 소스 하나만 전문 유출이어도 전체 CRITICAL — 안전 불변이다', (() => {
  const r = buildReport({
    sources: [leakedSrc('navercafe:wgang'), alive('82cook'), alive('navercafe:remonterrace')],
    supply: sup(), publish: pub(),
  })
  return r.level === 'CRITICAL' && r.exitCode === 1
})())

// [5] 한 소스 stale WARNING → 전체 WARNING
check('🔴 [5] 소스 하나가 stale 이면 전체가 WARNING 이다 — 요약이 초록으로 남지 않는다', (() => {
  const staleSrc = {
    sourceId: '82cook', findings: judgeSource(src({ lastArtifactAt: ago(40) })),
  }
  const r = buildReport({ sources: [staleSrc, alive('a')], supply: sup(), publish: pub() })
  return r.level === 'WARNING' && r.exitCode === 0
})())

// [6] 한 소스 session 실패 + 둘 정상 → 전체 WARNING
check('🔴 [6] 가용성 실패 하나 + 둘 정상 → 전체 WARNING', (() => {
  const r = buildReport({
    sources: [dead('navercafe:wgang'), alive('82cook'), alive('navercafe:remonterrace')],
    supply: sup(), publish: pub(),
  })
  return r.level === 'WARNING' && r.exitCode === 0
})())

// [7] 세 소스 모두 실패 → CRITICAL
check('🔴 [7] 셋 다 가용성 실패 → 전체 CRITICAL', (() => {
  const r = buildReport({
    sources: [dead('a'), dead('b'), dead('c')], supply: sup(), publish: pub(),
  })
  return r.level === 'CRITICAL' && r.exitCode === 1
})())
check('🔴 [4·7] 안전과 가용성을 같은 규칙으로 굴리지 않는다', (() => {
  // 하나 유출(CRITICAL) vs 하나 가용성 실패(WARNING) 가 갈린다
  const a = buildReport({ sources: [leakedSrc('x'), alive('y')], supply: sup(), publish: pub() })
  const b = buildReport({ sources: [dead('x'), alive('y')], supply: sup(), publish: pub() })
  return a.level === 'CRITICAL' && b.level === 'WARNING'
})())

// [9] INFO 가 있어도 발행 정상 요약이 함께 있다
check('🔴 [9] 과거 INFO 가 있어도 오늘 N/cap · 후보 N 요약이 나온다', (() => {
  const r = pub({ historicUnknownProfile: 2 })
  return r.some((x) => x.code === 'PUBLISH_HISTORIC_UNKNOWN')
    && r.some((x) => x.code === 'PUBLISH_OK' && x.message.includes('오늘 1/1건'))
})())
check('🔴 [9] CRITICAL 이 있어도 숫자 요약은 남는다', (() => {
  const r = pub({ mismatched: 1 })
  return r.some((x) => x.level === 'CRITICAL') && r.some((x) => x.code === 'PUBLISH_OK')
})())
// ══ 🔴 발행 지연 유예 — cron 은 정시에 돌지 않는다 ══
const KST = 9 * HOUR
const DAY0 = new Date('2026-09-08T00:00:00.000Z').getTime() - KST  // KST 00:00
const atKst = (h: number, m: number, s2 = 0): boolean => {
  const t = DAY0 + h * HOUR + m * 60_000 + s2 * 1000
  const graceUntil = DAY0 + 5 * 60_000 + PUBLISH_GRACE_MS
  return t >= graceUntil
}
check('🟢 [경계] 00:04:59 → 유예 전, 경고 없음', (() => {
  const r = pub({ todayCount: 0, afterPublishGrace: atKst(0, 4, 59) })
  return !r.some((x) => x.code === 'PUBLISH_NONE_TODAY')
})())
check('🟢 [경계] 00:05 정각 → 지연 허용, 경고 없음', (() => {
  const r = pub({ todayCount: 0, afterPublishGrace: atKst(0, 5) })
  return !r.some((x) => x.code === 'PUBLISH_NONE_TODAY')
})())
check('🟢 [경계] 01:04:59 → 아직 유예 안, 경고 없음', (() => {
  const r = pub({ todayCount: 0, afterPublishGrace: atKst(1, 4, 59) })
  return !r.some((x) => x.code === 'PUBLISH_NONE_TODAY')
})())
check('🟡 [경계] 01:05 이후 0건 → WARNING', (() => {
  const r = pub({ todayCount: 0, afterPublishGrace: atKst(1, 5) })
  return r.some((x) => x.code === 'PUBLISH_NONE_TODAY' && x.level === 'WARNING')
})())
check('🟢 [경계] 유예가 지나도 이미 1건이면 정상', (() => {
  const r = pub({ todayCount: 1, afterPublishGrace: atKst(2, 0) })
  return !r.some((x) => x.code === 'PUBLISH_NONE_TODAY')
})())
check('🔴 유예가 상수로 있고 문구에 드러난다', (() => {
  const r = pub({ todayCount: 0, afterPublishGrace: true })
  const hit = r.find((x) => x.code === 'PUBLISH_NONE_TODAY')
  return PUBLISH_GRACE_MS === 60 * 60 * 1000 && hit !== undefined && hit.message.includes('유예')
})())
check('🔴 러너가 예정 시각과 경고 시각을 나눈다', (() => {
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  return /scheduledPublishAt/.test(runner) && /graceUntil/.test(runner)
    && /PUBLISH_GRACE_MS/.test(runner)
})())

// [10] default 와 --json 의 level/exitCode 가 같은 함수에서 나온다
check('🔴 [10] 화면과 --json 이 같은 report 를 쓴다 — 두 번 계산하지 않는다', (() => {
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  const built = (runner.match(/buildReport\(/g) ?? []).length
  const exits = (runner.match(/process\.exit\(report\.exitCode\)/g) ?? []).length
  return built === 1 && exits === 2
})())

/**
 * 82cook 슬롯 — 🔴 **배열이다.** 첫 슬롯 하나만 보면 "다음 실행" 을 내일로 잡아 헛기다린다.
 *
 * 🔴 보는 대상은 **공급 레인의 얇은 상세 job**(`supply-collect-82cook-thin`, 4회/day)이다.
 *    `82cook-thin-*` 파일을 만드는 것이 그 job 이고, 관제가 신선도를 묻는 것도 그 파일이다.
 *    Raw Vault 레인의 `raw-collect-82cook`(10회/day)은 다른 레인이다.
 */
check('🔴 82cook 슬롯을 배열로 계산한다 — 첫 슬롯 하나만 보면 헛기다린다', (() => {
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  const m = /id: '82cook'[\s\S]{0,200}?slots: \[([0-9, ]+)\]\.map/.exec(runner)
  return m !== null
    && m[1]!.split(',').length >= 4
    && /logName: 'supply-collect-82cook-thin'/.test(runner)
    && /nextScheduled\(slots: readonly \[number, number\]\[\]/.test(runner)
})())
// 🔴 전문 유출은 디스크 전체를 본다
check('🔴 전문 유출 검사가 마지막 파일 하나만 보지 않는다', (() => {
  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  // 🔴 hits 전체를 순회해야 한다 — 마지막 하나만 보면 어제 샌 전문이 가려진다
  return /for \(const h of hits\)/.test(runner) && /leaked\.add\(k\)/.test(runner)
})())

// ── 러너가 넘지 말아야 할 선 ──
const code = ((): string => {
  const raw = readFileSync('scripts/supply-health.mts', 'utf-8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
})()
check('🔴 DB 에 쓰지 않는다', !/\.(create|update|delete|upsert|createMany|updateMany)\s*\(/.test(code))
check('🔴 Raw SQL 을 쓰지 않는다', !/\$queryRaw|\$executeRaw/.test(code))
check('🔴 네트워크로 나가지 않는다', !/\bfetch\(|https?:\/\/|playwright/i.test(code))
// 🔴 import 는 정상이다(상수·판정 함수를 가져온다). 막아야 할 것은 **실행**이다
check('🔴 수집·적재·발행을 실행하지 않는다 — 자식 프로세스 0',
  !/child_process|execFileSync|execSync|spawnSync|spawn\(/.test(code))
check('🔴 스크립트 경로를 부르지 않는다',
  !/scripts\/micro-seed-collect|scripts\/micro-seed-supply-autofill|scripts\/original-post-auto-publish/.test(code))
/**
 * 🔴 **launchctl 은 `list` 만 허용한다** (2026-09-08).
 *
 *    등록 상태를 코드 상수(`loaded: true`)로 적어 두니 아무도 올리지 않은 job 이
 *    능력으로 세어졌다. 그래서 관제가 **실측**을 읽는다 — 다만 읽기뿐이다.
 *    바꾸는 하위 명령은 전부 금지하고, 관제 본문은 여전히 자식 프로세스를 만들지 않는다.
 */
check('🔴 관제 본문은 자식 프로세스를 만들지 않는다',
  !/child_process|execFileSync|execSync|spawnSync|spawn\(/.test(code))
{
  const observer = readFileSync('scripts/lib/launchd-observe.mts', 'utf-8')
  const bare = observer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const calls = [...bare.matchAll(/execFileSync\(\s*'launchctl'\s*,\s*\[([^\]]*)\]/g)]
    .map((m) => m[1]!.replace(/['"\s]/g, ''))
  check('🔴 관측기는 launchctl 을 정확히 한 번 부른다', calls.length === 1)
  check('🔴 그것은 read-only `list` 다', calls[0] === 'list')
  check('🔴 상태를 바꾸는 하위 명령이 없다',
    !/(load|unload|bootstrap|bootout|enable|disable|kickstart|remove|start|stop)['"]/.test(bare))
  check('🔴 관측기는 파일에 쓰지 않는다',
    !/writeFileSync|appendFileSync|rmSync|renameSync|mkdirSync/.test(bare))
  check('🔴 관측기는 네트워크·DB 를 타지 않는다', !/fetch\(|PrismaClient/.test(bare))
}
check('🔴 파일에 쓰지 않는다', !/writeFileSync|appendFileSync|rmSync|mkdirSync|renameSync/.test(code))
check('🔴 env 를 고치지 않는다', !/process\.env\[[^\]]+\]\s*=/.test(code))
check('🔴 본문·세션·키 값을 찍지 않는다', !/bodyHead|rawBody|storage-state|API_KEY|DATABASE_URL/.test(code))
/**
 * 🔴 잠금 판정 정본이 **러너와 같은 함수**여야 한다 (2026-09-11).
 *    관제가 따로 판정하면 러너는 멈춰 있는데 화면은 초록인 상태가 생긴다.
 *    처리기는 죽은 잠금을 **자동 회수하지 않으므로**, 관제가 내지 않으면 아무도 모른다.
 */
check('🔴 판정을 새로 만들지 않는다 — 기존 함수를 쓴다',
  /readStock/.test(code) && /queueProfileOf/.test(code) && /kstDayStart/.test(code)
  && /processLockAnomaly/.test(code) && /adaptKeyOf/.test(code))
check('🔴 관제가 잠금 정본(collect-lock)을 쓴다 — 사본을 만들지 않는다',
  /from '\.\/lib\/collect-lock\.mjs'/.test(readFileSync('scripts/supply-health.mts', 'utf-8')))
check('🔴 cap 을 자체 정의하지 않는다',
  /DAILY_PUBLISH_CAP/.test(code) && !/DAILY_PUBLISH_CAP\s*=/.test(code))
check('🔴 금지 키 목록을 lib 과 공유한다', /FORBIDDEN_BODY_KEYS/.test(code))
check('🟢 금지 키 목록에 rawBody 가 있다', FORBIDDEN_BODY_KEYS.includes('rawBody'))
check('🟢 목표 재고는 lib 상수를 쓴다', STOCK_TARGET === 14 && STOCK_MIN === 5)

// ── [11] 🔴 생산 경로 — supply-health 가 기존 배정을 forecast 에 넘기는가 (2026-09-07) ──
//
//    fixture 에서 assignedPersonaCode 를 직접 넣어 라이브러리만 시험하면,
//    **러너는 넘기는데 관제는 안 넘기는** 상태를 못 잡는다. 실제로 그랬다 —
//    러너와 forecast 라이브러리는 고쳤는데 supply-health 만 끊겨 있었다.
//    그래서 여기서는 **소스를 읽어** 생산 경로를 검사한다.
{
  const health = readFileSync('scripts/supply-health.mts', 'utf-8')
  const codeOnly = health.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  check('🔴 [11] persona id → code 매핑을 만든다',
    /const codeOfPersonaId = new Map\(personaRows\.map\(/.test(codeOnly))
  check('🔴 [11] forecast 큐에 assignedPersonaCode 를 넘긴다',
    /assignedPersonaCode:/.test(codeOnly))
  check('🔴 [11] matchedPersonaId 를 근거로 넘긴다',
    /t\.matchedPersonaId === null/.test(codeOnly))
  check('🔴 [11] 못 찾은 persona 는 빈 값이 아니라 모르는 코드로 넘긴다 — fail-closed 로 잡히게',
    /__unknown:/.test(codeOnly))
  check('🔴 [11] forecast 와 매칭률이 **같은 큐·같은 cap** 을 쓴다 — 두 수치가 갈리지 않는다',
    /forecastPublishing\(\{\s*queue: forecastQueue/.test(codeOnly)
    && /planBatch\(forecastQueue, personas as never, RELEASE_CAPS\)/.test(codeOnly)
    && /caps: RELEASE_CAPS/.test(codeOnly))
  check('🔴 [11] 깨진 복구를 관제 판정에 넘긴다',
    /recoveryBroken: fc\.recoveryBroken/.test(codeOnly))
  // 🔴 queueRows 가 matchedPersonaId 를 실제로 읽어 오는가 — 안 읽으면 위가 다 무의미하다
  check('🔴 [11] 큐를 읽을 때 matchedPersonaId 를 가져온다',
    /matchedPersonaId: true/.test(codeOnly))
  // 🔴 persona 를 읽을 때 id 가 있어야 매핑이 성립한다
  check('🔴 [11] persona 를 읽을 때 id 를 가져온다',
    /id: true, code: true, status: true/.test(codeOnly))
}

// ── [12] 🔴 RECOVERY_BROKEN 은 CRITICAL 이고 다른 판정을 덮는다 ──
{
  const broken = [{ queueId: 'q1', problem: '배정된 persona ZZZ 를 찾을 수 없다' }]
  // 🔴 나머지 입력이 전부 건강해도 CRITICAL 이다
  const healthy = {
    stockUsable: 14, in7: 7, nextWillPublish: true, nextCandidates: 5,
    shortfallMin: 0, dailyCap: 1,
  }
  const okCase = judgeCapacity(healthy)
  check('🔴 [12] 깨진 복구가 없으면 예전과 같다', okCase.every((f) => f.code !== 'RECOVERY_BROKEN'))

  const badCase = judgeCapacity({ ...healthy, recoveryBroken: broken })
  check('🔴 [12] 깨진 복구가 있으면 CRITICAL', badCase.some((f) => f.level === 'CRITICAL' && f.code === 'RECOVERY_BROKEN'))
  check('🔴 [12] 다른 판정을 섞지 않는다 — 발행이 돈다는 전제가 깨졌다', badCase.length === 1)
  check('🔴 [12] 어느 행인지 말한다', badCase[0]!.message.includes('q1'))
  check('🔴 [12] 왜인지 말한다', badCase[0]!.message.includes('찾을 수 없다'))

  // 🔴 CRITICAL 이므로 전체 등급이 CRITICAL 이 된다 = exit 1
  const rep = buildReport({ sources: [], supply: [], publish: badCase as Finding[] })
  check('🔴 [12] 레인 전체 등급이 CRITICAL 이 된다', rep.level === 'CRITICAL')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
