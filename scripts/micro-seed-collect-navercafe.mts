#!/usr/bin/env tsx
/**
 * 네이버 카페 Raw 수집 — 🔴 로컬 Mac 전용 · dry-run 기본
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-A · §5 · §5-A~D
 *
 * 🔴 **LOCAL ONLY.** 이 스크립트를 GHA 에서 돌리지 않는다.
 *    네이버 쿠키를 Secrets 에 올리는 순간 계정이 위험해지고, 계정 정지는 되돌릴 수 없다.
 *    82cook 은 로그인이 없어 GHA 후보지만 네이버는 아니다.
 *
 * 🔴 **여기가 종점이다.** Raw Vault 에 적재하지 않는다.
 *    prisma 를 import 하지 않고 Sheet 를 부르지 않는다. 산출물은 로컬 JSONL 뿐이다.
 *    적재는 importer 가 `--raw-only --batch=N` 으로 따로 한다 —
 *    수집과 적재를 파일로 나눈 것이 이 레일의 설계다.
 *
 * 🔴 **네이버는 raw-only 전용이다.** Micro Seed Sheet 레인으로 가는 경로가 없다.
 *    importer 의 judgeSourceSite 가 `navercafe:*` 를 micro-seed 레인에서 거부한다(PR-S2-b-1).
 *
 * 🔴 **댓글 본문을 수집하지 않는다.** 목록의 댓글 **수**만 신호로 쓴다.
 * 🔴 **이미지를 가져오지 않는다.** 텍스트만 남긴다.
 *
 * 🔴 **사람 속도로 읽는다.** randomDelay(base, 0.8, 1.5) — 82cook 의 고정 2초와 다르다.
 *    이것은 자연화이지 우회가 아니다. UA 위장 · IP 로테이션 · robots 무시는 하지 않는다.
 *
 * ⚠️ **브라우저는 `--live` 일 때만 뜬다.**
 *    dry-run · fixture · typecheck 는 브라우저 없이 전부 돈다.
 *    모듈은 `playwright` → `playwright-core` 순으로 동적 import 한다 —
 *    `playwright-core` 는 이미 이 저장소의 devDependency 다(PR-S2-b-3 정정).
 *    🔴 브라우저 바이너리는 받지 않는다. 기본값은 설치된 Google Chrome(`channel: 'chrome'`)이다.
 *
 * 안전장치
 *   dry-run 기본     --live 가 없으면 브라우저를 열지 않는다
 *   kill switch      SORAN_NAVERCAFE_COLLECT_ENABLED=true 가 아니면 --live 가 무시된다
 *   전용 세션        SORAN_NAVERCAFE_SESSION_PATH · 🔴 우나어 세션 재사용은 코드가 막는다
 *   락파일           /tmp/soransoran-navercafe.lock · TTL 30분 > 실행 timeout 15분
 *   quota            슬롯당 10건 (82cook 30 과 다르다 — 계정 정지는 비가역)
 *
 * 사용법
 *   npx tsx scripts/micro-seed-collect-navercafe.mts                      계획만
 *   npx tsx scripts/micro-seed-collect-navercafe.mts --cafe=wgang --pages=1 --max=3
 *   npx tsx scripts/micro-seed-collect-navercafe.mts --live               🔴 첫 live (승인 필요)
 */
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'

import { classifyDetail } from './lib/micro-seed-detail-classify.mjs'
import { maskSensitive, BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import { violatesStorage } from '../src/lib/micro-seed-82cook-thin'
import { keepAfterClassify, outPathOf, thinRowFromCollected } from '../src/lib/micro-seed-navercafe-thin'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  CAFES, findCafe, sourceSiteOf, slotQuota, buildCollected, assertNaverCandidate,
  judgeSession, judgeLock, randomDelay, parseArticleId, judgeStorageStateShape,
  LIST_URL, ARTICLE_URL, DELAY_LIST_MS, DELAY_ARTICLE_MS,
  LOCK_PATH, LOCK_MAX_AGE_MS, RUN_TIMEOUT_MS,
  SESSION_PATH_ENV, KILL_SWITCH_ENV, FIRST_LIVE_CAFE_ID, FIRST_LIVE_PAGES, FIRST_LIVE_ARTICLES,
  PLAYWRIGHT_SPECS, BROWSER_CHANNEL_ENV, browserLaunchOptions, normalizeCount,
  safeFrameLabel, diagnoseEmptyList, summarizeProbes, judgeLockRelease, type FrameProbe,
  LIST_SELECTORS, runIdOf, runOutputPath,
  BOARD_TARGETS, findBoard, boardListUrl, pagesOf, maxPagesFor,
  detectRowLabel, judgePoliticsTitle, activeCafes,
  dedupeListRows, THRESHOLD_CANDIDATES, passesThreshold, thresholdBasis,
  type CollectedCandidate, type NaverListItem,
} from './lib/micro-seed-navercafe.mjs'
import type { SessionShape } from '../src/lib/naver-session-canon'
import {
  judgeAuthCookies, judgeTrigger,
  type CollectFailureCode, type CollectRunRecord,
} from '../src/lib/collect-run-record'
import {
  appendDetailLedger, appendRunRecord, readDetailLedger, readSeenArticleIds,
  BODY_RETRY_MAX, RUN_RECORD_DIR,
} from './lib/collect-run-store.mjs'
import {
  alertDueToday, isMemberGateText, judgeSessionExpiry, SESSION_EXPIRY_WARN_DAYS, SESSION_REISSUE_COMMAND,
  CAFE_HOME_URL, SESSION_ALERT, concludeFailedRun, judgeCafeMembership, judgeCollectTerminal, membershipFailureCode,
  type CafeMembership, type SessionFailureCode,
} from '../src/lib/naver-member-gate'
import { buildMessage, send } from './lib/slack-notify.mjs'
import { acquireLock, releaseLock, type LockHandle } from './lib/collect-lock.mjs'
import { planAutoFetch, judgeAutoHold, AUTO_SKIP_LIST_FLAGS, AUTO_HOLD_DETAIL_FLAGS } from './lib/micro-seed-supply.mjs'
import { selectionScore, type QualityAssessment } from './lib/micro-seed-quality.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
import { guardedNavigate, readGuard, type NavigationResponse } from './lib/collect-guard-store.mjs'
import { budgetOf, describeGuard, type SourceId } from '../src/lib/collect-guard'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIVE = argv.includes('--live')
/**
 * 🔴 **scout = 목록만 본다. 상세를 열지 않는다** (PR-S2-b-7).
 *
 *    상세에 무조건 들어가지 않는 것이 이 레일의 원칙이다. 먼저 목록에서
 *    제목·댓글수·조회수·시각·라벨을 보고, 조건을 넘은 글만 상세 후보가 된다.
 *    scout 는 요청이 목록뿐이라 detail quota 와 별개로 더 깊이 볼 수 있다.
 */
const SCOUT = argv.includes('--scout')
/**
 * 🔴 **전문을 디스크에 남기지 않는다** (§4-AV ②).
 *
 * `--thin` 이면 상세 JSONL(`rawBody` 전문 포함)을 **쓰지 않고**, 메모리 안에서
 * 마스킹 → 300자 → 분류를 끝낸 `*.thin-detail.jsonl` 만 남긴다.
 * 전문이 파일로 존재하는 시간이 0 이 된다 — 지웠다가 아니라 **쓰지 않는다.**
 *
 * 정기 수집(launchd)은 이 모드로 돈다. `--thin` 없이 도는 것은 사람이
 * Raw Vault 적재용 원본이 필요할 때뿐이고, 그때는 화면이 그렇다고 말한다.
 */
const THIN = argv.includes('--thin')
const BOARD_KEY = arg('board')?.trim() ?? null
const BOARD = BOARD_KEY ? findBoard(BOARD_KEY) : null
if (BOARD_KEY && !BOARD) {
  console.error(`\n🛑 모르는 게시판: ${BOARD_KEY}\n   가능한 값: ${BOARD_TARGETS.map((b) => b.key).join(' · ')}\n`)
  process.exit(1)
}
const CAFE_ID = (BOARD?.cafeId ?? arg('cafe') ?? FIRST_LIVE_CAFE_ID).trim()
// 🔴 page range 는 board 기본값 → 인자 순으로 덮는다. --pages 는 하위호환.
const START_PAGE = Number(arg('start-page') ?? String(BOARD?.startPage ?? 1))
const END_PAGE = Number(
  arg('end-page') ?? String(BOARD ? BOARD.endPage : Number(arg('pages') ?? String(FIRST_LIVE_PAGES))),
)
const MAX = Number(arg('max') ?? String(FIRST_LIVE_ARTICLES))
/**
 * 🔴 **출력 경로는 실행 시각이 정해진 뒤에 만든다** (PR-S2-b-6).
 *
 *    앞 코드는 카페마다 고정 파일명이었고 writeJsonl 이 append 라,
 *    첫 live(22건)와 두 번째 live(22건)가 한 파일에 44행으로 섞였다.
 *    null 비율을 재다가 실제로 한 번 잘못 읽었다 — 분석이 성립하려면 실행이 갈려야 한다.
 *
 *    `--out` 을 주면 그것을 쓴다(수동 실행·재현용). 주지 않으면 실행별 파일이다.
 */
const OUT_OVERRIDE = arg('out') ?? null

/**
 * 🔴 **회차마다 구조적 기록을 남긴다** (2026-09-10).
 *
 *    관제가 append-only stderr 의 **글자**로 현재 상태를 판정했다 —
 *    옛 `SESSION_FILE_MISSING` 이 남아 있어 세션을 고친 뒤에도 "만료" 라고 말했다.
 *    로그를 지워서 통과시키는 것은 답이 아니다. 회차 기록으로 판정한다.
 */
/**
 * 🔴 이미 본 글을 기억하는 두 자리 — 실행 디렉터리의 산출물과 worktree 밖 정본.
 *    정본 쪽이 배포·checkout 과 무관하게 살아남는다.
 */
const DATA_DIR = './.microseed-data'
const CANON_DATA_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data',
)

const RUN_TRIGGER = judgeTrigger(process.env)
let runRecord: CollectRunRecord | null = null
/**
 * 🔴 **락은 소유 token 으로 다룬다** (2026-09-10).
 *    `unlinkSync(LOCK_PATH)` 는 누구의 락인지 묻지 않는다 —
 *    늦게 깨어난 옛 owner 가 후임의 락을 지운다.
 */
let lockHandle: LockHandle | null = null
/**
 * 🔴 **락을 쥐고 죽지 않는다.** 다만 **내 것일 때만** 놓는다.
 *    쥔 채로 exit 하면 다음 예약 회차가 TTL 을 기다린다.
 */
const releaseOwnLock = (): void => {
  if (lockHandle === null) return
  const h = lockHandle
  // 🔴 먼저 비운다 — 어느 경로로 두 번 불려도 실제 해제는 한 번뿐이다
  lockHandle = null
  const r = releaseLock(h)
  // 🔴 내 것이 아니었으면 그것도 사실이다 — 경고로 남기고 예외는 가리지 않는다
  const rel = judgeLockRelease(true, r === 'RELEASED' || r === 'ABSENT' ? null : new Error(`락 해제 ${r}`))
  if (rel.warning) console.warn(`  ⚠️ ${rel.warning}`)
}
const markRun = (patch: Partial<CollectRunRecord>): void => {
  if (runRecord === null) return
  runRecord = { ...runRecord, ...patch }
}
/**
 * 🔴 **종료 기록은 저장에 성공한 뒤에만 확정한다** (2026-09-10).
 *
 *    앞선 판은 `runFinished = true` 를 먼저 세우고 저장 결과를 버렸다.
 *    terminal 저장이 실패하면 그 회차는 **영원히 `started` 로 남는데**
 *    스크립트는 exit 0 으로 끝났다 — 성공이라고 말하면서 증거가 없었다.
 */
let runFinished = false
const finishRun = (status: 'ok' | 'failed', code: CollectFailureCode | null = null): boolean => {
  if (runRecord === null || runFinished) return true
  const okWrite = appendRunRecord({
    ...runRecord, status, code, endedAt: new Date().toISOString(),
  })
  // 🔴 저장에 성공했을 때만 "끝났다" 로 본다
  if (okWrite) runFinished = true
  return okWrite
}

const fail = (msg: string, code: CollectFailureCode = 'OTHER'): never => {
  finishRun('failed', code)
  // 🔴 락을 쥐고 죽지 않는다 — 다음 회차가 30분을 기다리게 된다
  releaseOwnLock()
  console.error(`\n🛑 ${msg}\n`)
  process.exit(1)
}

/**
 * 🔴 **세션 알림 — 같은 알림은 하루 한 번** (2026-10-07).
 *    10/4~10/7 가입 안내 사고는 3일 넘게 아무도 몰랐다. 회차가 전부 ok 로 끝났고 알림이 없었다.
 *    · 하루 기록은 회차 기록 디렉터리 안에 둔다 — 상시 호스트 이관 묶음이 그대로 옮긴다.
 *    · 🔴 Slack 실패가 수집을 죽이지 않는다(`send` 는 throw 하지 않는다). 기록을 못 읽으면 보낸다.
 */
const ALERT_STATE = join(RUN_RECORD_DIR, 'session-alerts.json')
async function notifySessionAlert(
  key: string,
  msg: { severity: 'WARN' | 'BLOCKED'; title: string; reason: string },
): Promise<void> {
  // 🔴 어떤 경우에도 던지지 않는다 — 알림 하나 때문에 실패 기록·종료가 흔들리면 안 된다
  try {
    const today = kstString(new Date()).slice(0, 10)
    let sent: Record<string, string> = {}
    try { sent = JSON.parse(readFileSync(ALERT_STATE, 'utf-8')) as Record<string, string> } catch { /* 처음이거나 못 읽음 — 보낸다 */ }
    if (!alertDueToday(sent, key, today)) {
      console.log(`  🔕 오늘 이미 보낸 알림이다 — ${key}`)
      return
    }
    const r = await send(buildMessage({ ...msg, next: SESSION_REISSUE_COMMAND, logPath: undefined }), { dryRun: false })
    console.log(`  📣 Slack ${r.sent ? '보냄' : `못 보냄(${r.reason})`} — ${key}`)
    if (!r.sent) return
    try {
      mkdirSync(RUN_RECORD_DIR, { recursive: true })
      writeFileSync(ALERT_STATE, `${JSON.stringify({ ...sent, [key]: today }, null, 2)}\n`, 'utf-8')
    } catch { /* 다음 회차가 한 번 더 보낼 뿐이다 */ }
  } catch {
    console.log(`  📣 Slack 알림 처리 중 오류 — ${key} (회차 결과는 바뀌지 않는다)`)
  }
}
/** 가입 안내를 만난 글 — 🔴 원장에 남기지 않는다. 회원 세션으로 바뀐 뒤 다음 회차가 다시 연다 */
let memberGateId: string | null = null
/** 🔴 회차 시작 전 카페 홈 판정이 실패하면 목록·상세를 열지 않고 이 코드로 끝낸다 */
class MembershipStop extends Error {
  constructor(readonly code: SessionFailureCode, readonly seen: CafeMembership) { super(code) }
}
/**
 * 🔴 **실패 종료 하나** — 기록(failed) → 알림 → exit 1. 순서와 보장은 `concludeFailedRun` 이 정한다.
 *    회원 확인 실패 · 가입 안내 · 본문 0 이 모두 이 길로 끝난다.
 */
async function endWithSessionFailure(code: SessionFailureCode, detail: string): Promise<never> {
  await concludeFailedRun(code, {
    finish: (c) => finishRun('failed', c),
    notify: (c) => notifySessionAlert(`${c}:${cafe!.cafeId}`, {
      severity: SESSION_ALERT[c].severity,
      title: `${SESSION_ALERT[c].title} · ${cafe!.label}`,
      reason: `${SESSION_ALERT[c].why} — ${detail}`,
    }),
    exit: () => {
      releaseOwnLock()
      console.error(`\n🛑 ${code} — ${detail}\n   다시 발급: ${SESSION_REISSUE_COMMAND}\n`)
      process.exit(1)
    },
  })
  // concludeFailedRun 이 exit 를 부른다 — 여기 닿지 않는다
  return process.exit(1)
}

const cafe = findCafe(CAFE_ID)
if (cafe === null) {
  fail(`모르는 카페: ${CAFE_ID}\n   알려진 카페: ${CAFES.map((c) => c.cafeId).join(' · ')}`)
}
/**
 * 🔴 **보호장치 source** — `SOURCE_FACTS` 의 id 와 같은 문자열이어야 한다.
 *    `sourceSiteOf` 가 `navercafe:<cafeId>` 를 준다. 모르는 값이면 아래에서 막힌다.
 */
const GUARD_SOURCE = sourceSiteOf(cafe!.cafeId) as SourceId

// 🔴 이번 라운드에서 빠진 카페는 여기서 막는다. 선택과 집중이 코드로 강제돼야
//    "설정에만 있고 아무도 안 지키는 결정" 이 되지 않는다 (PR-S2-b-7).
if (cafe!.stage === 'excluded') {
  fail(
    `${CAFE_ID} 는 이번 라운드 수집 대상이 아니다 — ${cafe!.note}\n` +
      `   지금 쓰는 카페: ${activeCafes().map((c) => c.cafeId).join(' · ')}`,
  )
}

const QUOTA = slotQuota(CAFE_ID)
/**
 * 🔴 **승인된 게시판 범위가 곧 페이지 상한이다** (2026-09-11).
 *
 *    옛 판은 `detail` 모드를 언제나 `DETAIL_MAX_PAGES`(5)장으로 잘랐다. 그런데
 *    `BOARD_TARGETS` 의 `remonterrace:jjong` 은 **2~16p(15장)** 이다 —
 *    그 게시판을 계획대로 열면 `fail()` 로 죽는다. 계획은 코드에 있고 실행은 막혀 있었다.
 *
 *    `--board=` 로 **승인된 범위**를 지목했으면 그 범위가 상한이다. 무제한이 아니다 —
 *    범위는 `BOARD_TARGETS` 가 정하고, 하루 총량은 `MAX_REQUESTS_PER_DAY` 가 막는다
 *    (`navercafe-run-plan` 이 그 예산 안에서 회차·상세를 나눈다).
 *
 * 🔴 board 없이 부르는 옛 경로(`--cafe`/`--pages`)는 그대로 얕게 유지한다 —
 *    그쪽은 임시 확인용이고 예산 계산을 거치지 않는다.
 */
const PAGE_CAP = BOARD !== null
  ? pagesOf(BOARD).length
  : maxPagesFor(SCOUT ? 'scout' : 'detail')
let PAGE_LIST: number[]
try {
  PAGE_LIST = pagesOf({ startPage: START_PAGE, endPage: END_PAGE })
} catch (e) {
  fail(`page range 가 잘못됐다 — ${e instanceof Error ? e.message : String(e)}`)
}
if (PAGE_LIST!.length > PAGE_CAP) {
  fail(
    `페이지가 ${PAGE_LIST!.length}장이다 — ${SCOUT ? 'scout' : 'detail'} 모드 상한 ${PAGE_CAP}장을 넘는다.\n` +
      '   🔴 상세를 여는 실행은 얕게 유지한다. 깊게 보려면 --scout 로 목록만 본다.',
  )
}
if (!SCOUT && (!Number.isInteger(MAX) || MAX < 1 || MAX > QUOTA)) {
  fail(`--max 는 1~${QUOTA} 이다 — ${CAFE_ID} 의 슬롯 quota (받은 값: ${arg('max') ?? '없음'})`)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 🔴 **append 하지 않는다** (PR-S2-b-6).
 *
 *    실행별 파일이라 섞일 일이 없고, 같은 파일에 두 번 쓰는 것은 `--out` 을 준
 *    수동 실행뿐이다. 그때도 "이번 실행의 결과" 가 파일 내용이어야 한다.
 *    append 였을 때 두 실행이 44행으로 섞여 분석을 한 번 망쳤다.
 */
function writeJsonl(path: string, rows: object[]) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rows.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf-8')
}

async function main() {
  await loadEnvLocal()
  const now = new Date()
  const enabled = process.env[KILL_SWITCH_ENV] === 'true'
  const sessionPath = process.env[SESSION_PATH_ENV] ?? null

  console.log('\n네이버 카페 Raw 수집 — 🔴 로컬 전용')
  console.log(`  카페   ${cafe!.cafeId} (${cafe!.label}) · stage=${cafe!.stage}`)
  console.log(`  메모   ${cafe!.note}`)
  console.log('         🔴 메모는 경향일 뿐 고정 라벨이 아니다 — 주제 판정은 글 단위로 한다')
  console.log(`  소스   ${sourceSiteOf(cafe!.cafeId)}`)
  // 🔴 보호장치 상태를 **먼저** 말한다 — 막혀 있으면 계획을 읽기 전에 알아야 한다
  {
    const g = readGuard(GUARD_SOURCE, new Date())
    console.log(`  보호장치 ${describeGuard(g, Date.now())} · 남은 예산 ${budgetOf(g).remaining}건`
      + ' (403·429·TCP 차단기 분리 · 82cook 과 같은 계약)')
  }
  console.log(`  게시판 ${BOARD ? `${BOARD.label} (menuId=${BOARD.menuId}) · ${BOARD.purpose}` : '전체글보기 (기본)'}`)
  console.log(
    SCOUT
      ? `  계획   🔍 scout — 목록 ${START_PAGE}~${END_PAGE}p (${PAGE_LIST!.length}장) · 🔴 상세를 열지 않는다`
      : `  계획   목록 ${START_PAGE}~${END_PAGE}p (${PAGE_LIST!.length}장) · 상세 최대 ${MAX}건 (quota ${QUOTA})`,
  )
  console.log(`  간격   목록 ${DELAY_LIST_MS}ms · 상세 ${DELAY_ARTICLE_MS}ms · 🔴 ±jitter (사람 속도)`)
  console.log(`  kill switch ${KILL_SWITCH_ENV}=${enabled ? 'ON' : 'OFF'} · --live ${LIVE ? '있음' : '없음'}`)
  console.log(`  세션   ${SESSION_PATH_ENV} ${sessionPath === null ? '🔴 없음' : '설정됨'}`)
  console.log('')
  console.log('  🔴 DB write 없음 · Sheet 접근 없음 · Candidate 없음 · Post 없음 · Queue 없음')
  console.log('  🔴 댓글 본문 미수집 · 이미지 미수집 · 적재는 importer 가 따로 한다')
  console.log(`  ① 목록 단계 제외 : ${AUTO_SKIP_LIST_FLAGS.join(' · ')}`)
  console.log(`  ② 상세 단계 보류 : ${AUTO_HOLD_DETAIL_FLAGS.join(' · ')} (적재 시점)`)
  console.log('')

  if (cafe!.stage === 'shadow') {
    console.log('  🟡 shadow 소스다 — 수집은 하되 Original Post 재료로 바로 쓰지 않는다\n')
  }

  // ── dry-run 종점 ────────────────────────────────────
  const live = LIVE && enabled
  if (!live) {
    const urls = PAGE_LIST!.map((p) => (BOARD ? boardListUrl(BOARD, p) : LIST_URL(cafe!.cafeId, p)))
    console.log(`  대상 목록 URL (${urls.length}장):`)
    // 🔴 전부 찍지 않는다. 16장을 다 찍으면 정작 봐야 할 경고가 스크롤 밖으로 밀린다
    for (const u of urls.slice(0, 4)) console.log(`     ${u}`)
    if (urls.length > 4) console.log(`     … 외 ${urls.length - 4}장`)
    console.log('\n  🔍 dry-run 종료. 브라우저 0 · 네트워크 0 · 파일 쓰기 0.')
    if (LIVE && !enabled) console.log(`     (--live 를 줬지만 ${KILL_SWITCH_ENV} 가 true 가 아니라 무시했다)`)
    console.log('')
    return
  }

  // ── 여기서부터 live ─────────────────────────────────
  /**
   * 🔴 **회차 기록을 여기서 연다** (2026-09-10 정정).
   *
   *    앞선 판은 브라우저를 띄운 뒤에야 기록을 만들었다. 그래서
   *    세션·인증·락·의존성 실패는 **terminal record 를 하나도 남기지 못했고**,
   *    관제는 그 회차가 있었다는 사실조차 알지 못했다 —
   *    8회 연속 실패가 조용했던 이유가 이것이다.
   *
   *    live 가 확정된 직후, **어떤 검사보다 먼저** 연다.
   */
  const OPEN_ISO = new Date().toISOString()
  runRecord = {
    runId: runIdOf(OPEN_ISO),
    source: sourceSiteOf(CAFE_ID),
    trigger: RUN_TRIGGER,
    mode: SCOUT ? 'scout' : 'detail',
    status: 'started',
    startedAt: OPEN_ISO,
    endedAt: null,
    code: null,
    listRows: 0, detailRequests: 0, bodyRows: 0, thinRows: 0,
    skippedSeen: 0, repeatedRows: 0, newUniqueThinRows: 0,
  }
  /**
   * 🔴 **기록을 남기지 못하면 외부 요청을 하지 않는다.**
   *    증거를 못 남기는 회차는 돌아도 관제가 볼 수 없다 — 조용한 실패가 다시 생긴다.
   */
  if (!appendRunRecord(runRecord)) {
    runRecord = null
    console.error('\n🛑 RECORD_WRITE_FAILED — 회차 기록을 남기지 못했다. 외부 요청 0으로 멈춘다.\n')
    process.exit(1)
  }

  /**
   * 🔴 **이미 본 글 목록** — 상세 요청 전에 거르고, 산출 뒤 신규를 세는 데 쓴다.
   *    한 번만 읽어 두 곳에서 같은 집합을 본다(두 벌이면 숫자가 갈린다).
   */
  /**
   * 🔴 **상세 조회 이력 원장** — thin 이 남지 않는 결과(drop·본문 실패)까지 기억한다.
   *    thin 만 보면 걸러진 글을 회차마다 다시 열게 된다.
   *    🔴 못 읽거나 손상됐으면 "중복 없음" 으로 보정하지 않고 **여기서 멈춘다.**
   */
  const ledger = readDetailLedger(GUARD_SOURCE)
  if (!ledger.ok) {
    fail(`상세 조회 원장을 신뢰할 수 없다 — ${ledger.reason}\n`
      + '   🔴 중복 없음으로 보정하지 않는다. 같은 글을 다시 열지 않기 위해 멈춘다.',
      'OTHER')
  }
  const ledgerEntries = ledger.ok ? ledger.entries : new Map()
  /**
   * 🔴 **원장 저장 실패는 회차 실패다** (2026-09-10).
   *
   *    남기지 못한 조회는 다음 회차가 또 연다. 같은 글에 두 번 요청하는 것을
   *    "조용히" 하지 않는다 — 여기서 멈추고 이후 상세 요청을 중단한다.
   */
  const recordDetail = (e: Parameters<typeof appendDetailLedger>[1]): void => {
    if (appendDetailLedger(GUARD_SOURCE, e)) return
    fail(`LEDGER_WRITE_FAILED — 상세 조회 이력을 남기지 못했다 (${e.articleId})\n`
      + '   🔴 남기지 못한 조회는 다음 회차가 또 연다. 이후 상세 요청을 중단한다.',
      'OTHER')
  }
  const seen = readSeenArticleIds(GUARD_SOURCE, [DATA_DIR, CANON_DATA_DIR])
  /**
   * 🔴 **다시 열지 않을 글** = thin 에 남은 글 ∪ 원장이 끝냈다고 말한 글.
   *    본문 실패는 재시도하되 `BODY_RETRY_MAX` 를 넘기면 포기한다(무한 반복 상한).
   */
  const doneIds = new Set<string>(seen)
  for (const [id, e] of ledgerEntries) {
    if (e.outcome === 'body_failed' && e.attempts < BODY_RETRY_MAX) continue
    doneIds.add(id)
  }

  // 🔴 세션 판정을 브라우저보다 **먼저** 한다. 우나어 세션 재사용은 파일이 실제로
  //    존재하므로, 존재 검사만 하면 통과해 버린다.
  /**
   * 🔴 **파일을 실제로 재어 넘긴다** (2026-09-10).
   *    존재만 보던 옛 판은 상대 경로·깨진 파일·느슨한 권한을 전부 통과시켰다.
   *    쿠키 값은 어디에도 담지 않는다 — 모양과 권한만 판정에 넘긴다.
   */
  const sessionStat = ((): { isFile: boolean; mode: number } | null => {
    if (sessionPath === null || sessionPath === '') return null
    try {
      const st = statSync(sessionPath)
      return { isFile: st.isFile(), mode: st.mode }
    } catch { return null }
  })()
  const sessionShape = ((): SessionShape | null => {
    if (sessionStat === null || !sessionStat.isFile) return null
    try { return judgeStorageStateShape(readFileSync(sessionPath!, 'utf-8')) } catch { return 'unreadable' }
  })()
  const sv = judgeSession({
    sessionPath,
    exists: sessionStat !== null,
    halted: existsSync(`${LOCK_PATH}.halted`),
    isFile: sessionStat?.isFile ?? false,
    mode: sessionStat?.mode ?? null,
    shape: sessionShape,
  })
  if (!sv.ok) {
    // 🔴 경로 없음과 인증 만료를 같은 코드로 뭉개지 않는다 — 조치가 다르다
    fail(`${sv.code} — ${sv.detail}`,
      sv.code === 'SESSION_FILE_MISSING' ? 'SESSION_FILE_MISSING' : 'OTHER')
  }
  /**
   * 🔴 **인증 쿠키를 브라우저 열기 전에 본다.** 이름과 만료 시각만 본다 —
   *    값은 어디에도 담지 않는다. 만료됐으면 자동 로그인하지 않고 멈춘다.
   */
  let authCookies: { name: string; expires?: number }[] = []
  const auth = ((): ReturnType<typeof judgeAuthCookies> => {
    try {
      const j = JSON.parse(readFileSync(sessionPath!, 'utf-8')) as {
        cookies?: { name: string; expires?: number }[]
      }
      // 🔴 이름과 만료 시각만 남긴다 — 값은 담지 않는다
      authCookies = (j.cookies ?? []).map((c) => ({ name: c.name, expires: c.expires }))
      return judgeAuthCookies(authCookies, Date.now())
    } catch { return { ok: false, code: 'AUTH_MISSING', reason: '세션을 읽지 못했다' } }
  })()
  console.log(`  인증   ${auth.ok ? '🟢' : '🔴'} ${auth.reason}`)
  if (!auth.ok) {
    // 🔴 멈추기 전에 알린다 — 10/3 오후 만료 4회 실패도 아무도 몰랐다
    await notifySessionAlert(auth.code, {
      severity: 'BLOCKED',
      title: '네이버 카페 수집 중단 — 로그인 세션 만료',
      reason: `${auth.reason} · ${cafe!.label} 회차부터 수집이 멈췄다`,
    })
    fail(`${auth.code} — ${auth.reason}\n   🔴 사람이 headed 로 재발급한다: ${SESSION_REISSUE_COMMAND}`,
      auth.code)
  }
  // 🔴 만료 예고 — 만료 전에 다시 발급하면 회차를 잃지 않는다
  const expiry = judgeSessionExpiry(authCookies, Date.now())
  if (expiry.warn && expiry.soonest !== null) {
    console.log(`  ⏳ 인증 쿠키 ${expiry.soonest.name} 가 ${expiry.soonest.daysLeft}일 뒤 만료된다 (${SESSION_EXPIRY_WARN_DAYS}일 안)`)
    await notifySessionAlert('SESSION_EXPIRY_SOON', {
      severity: 'WARN',
      title: `네이버 세션 만료 ${expiry.soonest.daysLeft}일 전`,
      reason: `${expiry.soonest.name} 만료 ${kstString(new Date(expiry.soonest.expiresAt))} KST — 만료되면 두 카페 수집이 멈춘다`,
    })
  }

  /**
   * 🔴 **원자적으로 잡는다.** TTL(30분) > 실행 timeout(15분) —
   *    짧으면 아직 도는 작업을 죽은 것으로 본다.
   *    `exists → stat → append` 방식은 셋 사이에 끼어들 틈이 있었다.
   */
  const lock = acquireLock(LOCK_PATH, now.getTime(), LOCK_MAX_AGE_MS)
  if (!lock.ok) {
    /**
     * 🔴 **일시적인 겹침과 남아 있는 죽은 락은 다른 사건이다** (2026-09-10 정정).
     *
     *    `HELD` 는 다음 회차에 저절로 풀린다. `STALE_HELD` 는 **저절로 풀리지 않는다** —
     *    자동 회수를 하지 않기로 했기 때문이다(그것이 두 회차를 동시에 들여보낸다).
     *    둘을 한 코드로 뭉개면 사람이 봐야 할 것이 "흔한 겹침" 에 묻힌다.
     */
    fail(`락이 잡혀 있다 — ${lock.reason}`,
      lock.kind === 'STALE_HELD' ? 'LOCK_STALE' : 'LOCK_BUSY')
  }
  else lockHandle = lock.handle

  // 🔴 의존성 실패도 terminal record 를 남긴다 (배포·설치 문제로 읽혀야 한다)
  const chromium = await (async (): Promise<Chromium> => {
    try { return await loadChromium() } catch (e) {
      return fail(`브라우저 모듈을 불러오지 못했다 — ${e instanceof Error ? e.message : String(e)}`,
        'RUNTIME_DEPENDENCY')
    }
  })()

  // 🔴 실행 식별자를 여기서 못 박는다. 이 뒤의 모든 행이 같은 runId 를 갖는다.
  const listedAtIso = new Date().toISOString()
  // 🔴 회차 id 는 위에서 이미 못 박았다 — 기록과 산출물이 같은 id 를 쓴다
  const RUN_ID = runRecord!.runId
  const OUT = OUT_OVERRIDE ?? runOutputPath(CAFE_ID, RUN_ID, 'detail')
  const OUT_LIST = OUT_OVERRIDE
    ? OUT_OVERRIDE.replace(/\.jsonl$/, '.list.jsonl')
    : runOutputPath(CAFE_ID, RUN_ID, 'list')

  console.log(`  🔴 실제 수집 · run ${RUN_ID}`)
  console.log(`     상세 ${OUT}`)
  console.log(`     목록 ${OUT_LIST}\n`)
  const started = Date.now()
  const collected: CollectedCandidate[] = []
  let browser: NaverBrowser | null = null
  let membershipStop: MembershipStop | null = null

  try {
    // 🔴 기본은 설치된 Chrome. 번들 chromium(rev 1234)이 로컬에 없어도 뜬다
    const launchOpts = browserLaunchOptions({ channel: process.env[BROWSER_CHANNEL_ENV], headless: true })
    console.log(`  브라우저: ${launchOpts.channel ?? '번들 chromium'}`)
    browser = await chromium.launch(launchOpts)
    const context = await browser.newContext({ storageState: sessionPath!, locale: 'ko-KR' })
    const page = await context.newPage()

    /**
     * ── ⓪ 카페 회원 확인 (2026-10-07) ──
     * 🔴 쿠키 만료일은 로그인 상태를 말해 주지 않는다 — 비밀번호 변경·회원 상태 변경은 만료일 전에도 세션을 끊는다.
     *    카페 홈을 **보호장치를 지나** 정확히 1회 연다(요청 예산·차단기·간격에 들어간다).
     *    회원이 아니거나 확인할 수 없으면 목록·상세를 열지 않는다 — 요청을 쓰지 않고 실패로 끝낸다.
     */
    if (!SCOUT) {
      await guardedNavigate({
        url: CAFE_HOME_URL(cafe!.cafeId), source: GUARD_SOURCE, now: () => new Date(),
        goto: async (u) => (await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20_000 })) as NavigationResponse,
      })
      await sleep(randomDelay(DELAY_LIST_MS))
      const seen = judgeCafeMembership(await readPageText(page))
      const stop = membershipFailureCode(seen)
      console.log(`  회원   ${stop === null ? '🟢 카페 회원' : `🔴 ${seen === 'nonMember' ? '회원 아님(카페 가입하기)' : '확인 불가'}`}`)
      if (stop !== null) throw new MembershipStop(stop, seen)
    }

    // ── ① 목록 ──
    const items: NaverListItem[] = []
    const allProbes: FrameProbe[] = []
    for (const [idx, p] of PAGE_LIST!.entries()) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      // 🔴 board 가 있으면 신형 menuId URL, 없으면 기존 전체글보기 URL (하위호환)
      const url = BOARD ? boardListUrl(BOARD, p) : LIST_URL(cafe!.cafeId, p)
      // 🔴 82cook 과 **같은 보호장치**를 지난다 — Playwright 라고 예외를 두지 않는다
      await guardedNavigate({
        url, source: GUARD_SOURCE, now: () => new Date(),
        goto: async (u) => (await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20_000 })) as NavigationResponse,
      })
      await sleep(randomDelay(DELAY_LIST_MS))
      const read = await readList(page, cafe!.cafeId, p)
      items.push(...read.items)
      allProbes.push(...read.probes)
      console.log(`  목록 ${p}p → 누적 ${items.length}건`)
      // 🔴 0건일 때는 프레임별로 무슨 일이 있었는지 즉시 보여준다.
      //    한 줄짜리 "0건" 만 보고는 다음에 무엇을 고칠지 정할 수 없다.
      if (read.items.length === 0) for (const line of summarizeProbes(read.probes)) console.log(`     · ${line}`)
      if (idx < PAGE_LIST!.length - 1) await sleep(randomDelay(DELAY_LIST_MS))
    }
    if (items.length === 0) {
      const d = diagnoseEmptyList(allProbes)
      throw new Error(`목록이 비었다 [${d.code}] — ${d.detail}`)
    }

    // ── ② 자동 선별 (목록 단계 제외) ──
    // listedAtIso 는 실행 시작 시점에 못 박았다 (runId 와 같은 시각).
    // 🔴 목록을 **본** 시각과 상세를 여는 시각은 다르다 — time lag 조사가 그 차이를 쓴다.
    const rawRows = items.map((i) => buildCollected(cafe!.cafeId, i, '', listedAtIso, listedAtIso))

    // 🔴 크롤 중 새 글이 올라오면 같은 글이 두 페이지에 걸린다 (실측: 225건 중 1건).
    //    threshold 를 백분율로 재는 순간 분모가 오염되므로 **분석 전에** 지운다.
    const dedup = dedupeListRows(rawRows)
    if (dedup.duplicates > 0) {
      console.log(`  ♻️ 페이지 간 중복 ${dedup.duplicates}건 제거 (${dedup.duplicateIds.slice(0, 5).join(' · ')})`)
      console.log('     🔴 크롤 중 새 글이 올라와 밀린 것이다 — 먼저 본 위치를 남긴다')
    }
    const listRows = dedup.rows
    writeJsonl(OUT_LIST, listRows)

    // 🔴 자동 상세 fetch 에서 빼는 이유는 **하나의 판정**이 정한다 (judgeExcludeReason).
    //    축이 갈라져 있으면 "어느 쪽이 최종 차단인가" 를 코드만 보고 답할 수 없다.
    //    **파일에서 지우는 것이 아니다** — 목록 JSONL 에는 전부 남는다.
    const byReason = { politics: 0, publicFigure: 0, pinned: 0 }
    for (const r of listRows) if (r.sourceExcludeReason) byReason[r.sourceExcludeReason] += 1
    if (byReason.politics) {
      console.log(`  🚫 정치·진영 ${byReason.politics}건 — 상세 대상 제외`)
      console.log('     🔴 public · growth · shadow 어디에도 가지 않는다 (설계 §4-C)')
    }
    if (byReason.publicFigure) {
      console.log(`  🟡 실명·공인 언급 ${byReason.publicFigure}건 — 생활 레인 상세 대상 제외`)
      console.log('     🔴 연예·방송·셀럽이 섞인다. Growth 레인이 열리면 여기서 갈라야 한다')
    }
    if (byReason.pinned) console.log(`  📌 고정 슬롯 ${byReason.pinned}건 — 상세 대상 제외 (공지·필독·추천)`)

    // 🔴 threshold 는 **제외 후 후보**에 건다 (PR-S2-b-9).
    //    전체 목록에 걸면 상세를 열 수도 없는 고정 슬롯이 통과율을 끌어올린다 —
    //    유머·연예 1p 실측에서 전체 35% vs 후보 7% 로 갈렸다.
    const basis = thresholdBasis(listRows)

    if (SCOUT) {
      // ── 🔍 scout 종료 — 상세를 열지 않는다 ──
      // 🔴 scout 는 상세를 열지 않는다 — 예약 경로의 성공 증거가 되지 못한다
      markRun({ listRows: basis.total, detailRequests: 0, thinRows: 0 })
      finishRun('ok')
      console.log(`\n  🔍 scout 종료 — 목록 ${basis.total}건 기록. 상세 요청 0.`)
      console.log('     🔴 이 회차는 상세를 열지 않았다 — 예약 수집 성공 증거가 아니다.')
      console.log(`     제외 ${basis.total - basis.eligible.length - basis.legacy}건 → 상세 후보 ${basis.eligible.length}건`)
      // 🔴 이 실행에서는 0 이어야 한다. 0 이 아니면 buildCollected 를 안 거친 행이 섞인 것이다
      if (basis.legacy > 0) console.log(`     ⚠️ 판정 없는 행 ${basis.legacy}건 — 제외가 아니라 "판정 자체가 없다"`)
      // 🔴 후보값으로 세어만 본다. 코드가 이 값으로 자동 판정하지 않는다
      for (const t of THRESHOLD_CANDIDATES) {
        const n = basis.eligible.filter((r) => passesThreshold(r, t)).length
        const pct = basis.eligible.length === 0 ? 0 : Math.round((n / basis.eligible.length) * 100)
        const whole = listRows.filter((r) => passesThreshold(r, t)).length
        console.log(
          `     후보 ${t.label} (댓글>=${t.minComments} AND 조회>=${t.minViews}) → ` +
            `${n}/${basis.eligible.length}건 (${pct}%)  · 전체 기준이면 ${whole}건 — 🔴 비교 축이 아니다`,
        )
      }
      console.log(`     → ${OUT_LIST}`)
      console.log(`\n  🔴 상세 JSONL 을 만들지 않았다. threshold 를 정하기 전에는 상세를 열지 않는다.`)
      console.log(`     (${kstString(now)} KST · run ${RUN_ID})\n`)
      return
    }

    const eligible = basis.eligible
    /**
     * 🔴 **이미 본 글은 상세를 열지 않는다** (2026-09-10 정정).
     *
     *    옛 판은 `alreadyInVault: false` 를 **고정**으로 넘겼다. 그래서 같은 글을
     *    회차마다 다시 열었고, `thinRows` 합은 늘었지만 **새 공급은 0** 이었다.
     *    관측 처리량이 실제보다 부풀고, 대상 카페에는 같은 요청이 반복됐다.
     *
     *    collector 는 DB 를 import 하지 않는다(계약 유지). 정본 경로와 기존 thin
     *    산출물에서 `sourceArticleId` 를 모아 요청 **전에** 거른다.
     */
    const skippedSeen = eligible.filter((r) => doneIds.has(r.sourceArticleId)).length
    const plan = planAutoFetch(
      eligible.map((r) => ({
        sourceArticleId: r.sourceArticleId,
        score: selectionScore({ stage: r.qualitySignals.stage, flags: r.qualityFlags, signals: r.qualitySignals } as QualityAssessment),
        flags: r.qualityFlags,
        alreadyInVault: doneIds.has(r.sourceArticleId),
      })),
      { max: MAX },
    )
    markRun({ listRows: listRows.length, skippedSeen })
    console.log(`  이미 본 글 ${skippedSeen}건 — 상세를 열지 않는다`
      + ` (thin ${seen.size}건 · 원장 ${ledgerEntries.size}건 기억)`)
    console.log(`\n  자동 선별 ${plan.picked.length}건 · 제외 ${plan.skipped.length}건 (후보 ${eligible.length}/${listRows.length})`)
    console.log('  🔴 제외는 파일에서 지운 것이 아니다 — 목록 JSONL 에 전부 남아 있다\n')

    // ── ③ 상세 ──
    let detailRequests = 0
    /** 🔴 **연 것과 읽은 것은 다르다** — 셀렉터가 터지면 열어도 0 이다 */
    let bodyRows = 0
    const known = new Map(items.map((i) => [i.sourceArticleId, i]))
    for (const [idx, id] of plan.picked.entries()) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      if (idx > 0) await sleep(randomDelay(DELAY_ARTICLE_MS))
      // 🔴 상세를 **실제로 연 횟수**를 센다 — scout 와 구별하는 유일한 값이다
      detailRequests += 1
      markRun({ detailRequests })
      await guardedNavigate({
        url: ARTICLE_URL(cafe!.cafeId, id), source: GUARD_SOURCE, now: () => new Date(),
        goto: async (u) => (await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20_000 })) as NavigationResponse,
      })
      await sleep(randomDelay(DELAY_ARTICLE_MS))
      const read = await readArticleBody(page)
      const body = read.body
      if (!body) {
        // 🔴 본문 실패도 조회는 끝났다 — 재시도 횟수와 함께 남긴다
        recordDetail({
          articleId: id, outcome: 'body_failed', at: new Date().toISOString(),
          runId: RUN_ID, attempts: (ledgerEntries.get(id)?.attempts ?? 0) + 1,
        })
        console.log(
          read.errors.length
            ? `  ⚠️ ${id} — 본문 셀렉터가 터졌다(건너뛴다): ${read.errors[0]}`
            : `  ⚠️ ${id} — 본문이 비었다. 셀렉터가 안 맞거나 접근이 막혔다(건너뛴다)`,
        )
        continue
      }
      /**
       * 🔴 **가입 안내는 본문이 아니다** (2026-10-04~07 실측).
       *    회원 세션이면 회원 전용 글도 열린다 — 하나라도 안내가 나오면 세션이 회원이 아니다.
       *    다음 글도 같으니 요청을 더 쓰지 않고 멈춘다. 원장에는 남기지 않는다 —
       *    회원 세션으로 바뀐 뒤 다음 회차가 이 글을 다시 연다.
       */
      if (isMemberGateText(body)) {
        memberGateId = id
        console.log(`  🛑 ${id} — 본문 대신 카페 가입 안내가 나왔다. 이 세션은 ${cafe!.label} 회원이 아니다 — 상세 요청을 멈춘다`)
        break
      }
      const row = buildCollected(cafe!.cafeId, known.get(id)!, body, new Date().toISOString(), listedAtIso)
      assertNaverCandidate(row)
      bodyRows += 1
      markRun({ bodyRows })
      /**
       * 🔴 **여기서 `kept` 를 확정하지 않는다** (2026-09-10 정정).
       *
       *    본문을 읽었을 뿐 아직 분류도 저장도 하지 않았다.
       *    여기서 `kept` 를 적으면, thin 저장이 실패했을 때
       *    **원장에는 있고 산출물은 없는** 영구 유실이 된다 —
       *    그 글은 다시 열리지 않으므로 영영 공급되지 않는다.
       *
       *    분류 뒤(`dropped`)와 저장 뒤(`kept`)에 나눠 적는다.
       */
      collected.push(row)
      console.log(`  ✅ ${id} · ${[...body].length}자 · 댓글 ${row.sourceCommentCount}`)
    }
  } catch (e) {
    // 🔴 회원 확인 실패만 여기서 잡는다 — 나머지 예외는 그대로 바깥(main().catch)으로 간다
    if (!(e instanceof MembershipStop)) throw e
    membershipStop = e
  } finally {
    /**
     * 🔴 **브라우저만 닫는다. 락은 여기서 풀지 않는다** (2026-09-10 정정).
     *
     *    앞선 판은 여기서 락을 놓았다. 그런데 분류·thin 저장·원장 확정은
     *    **이 뒤에** 온다 — 그 사이에 B 가 락을 얻으면
     *    A 가 이미 읽은 글을 **다시 상세 조회한다.**
     *    요청은 두 배로 나가고 원장에는 한 번만 남는다.
     *
     *    락은 최외곽(`main().then/catch`·`fail()`)에서 **결과가 확정된 뒤**
     *    정확히 한 번 풀린다(`releaseOwnLock` 이 `lockHandle` 을 먼저 비운다).
     */
    if (browser) await browser.close().catch(() => {})
  }

  // 🔴 회원이 아니거나 확인할 수 없었다 — 목록·상세를 열지 않았다(상세 요청 0)
  if (membershipStop !== null) {
    await endWithSessionFailure(membershipStop.code, `카페 홈 판정 ${membershipStop.seen} · 상세 요청 0`)
  }

  if (collected.length && THIN) {
    // 🔴 **전문을 쓰지 않는다.** 메모리에서 곧바로 얇은 행을 만든다.
    //    crash 나 부분 실패로 중간에 죽어도 전문 파일은 애초에 생기지 않는다 —
    //    수집 루프는 메모리에만 쌓고, 파일 write 는 이 지점 한 번뿐이기 때문이다.
    const thinRows: Record<string, unknown>[] = []
    let droppedThin = 0
    for (const r of collected) {
      const masked = maskSensitive(String(r.rawBody ?? ''))
      const v = classifyDetail({
        title: String(r.originalTitle ?? ''), body: masked, comments: [], imageCount: 0,
        boardName: String(r.sourceBoardName ?? '') || '자유게시판',
        qualityFlags: Array.isArray(r.qualityFlags) ? r.qualityFlags.map(String) : [],
        access: 'ok',
      })
      const axis = String(v.axis)
      const safetyVerdict = String(v.safety.verdict)
      // 🔴 drop · hardExclude 는 얇은 사본조차 만들지 않는다
      if (!keepAfterClassify({ axis, safetyVerdict }).keep) {
        droppedThin += 1
        /**
         * 🔴 **걸러진 글도 조회는 끝났다.** 여기 남기지 않으면 thin 이 없으므로
         *    다음 회차가 같은 글을 다시 연다 — 요청은 쓰이고 산출은 0 이다.
         */
        const dropId = String(r.sourceArticleId ?? '')
        if (dropId !== '') {
          recordDetail({
            articleId: dropId, outcome: 'dropped', at: new Date().toISOString(),
            runId: RUN_ID, attempts: (ledgerEntries.get(dropId)?.attempts ?? 0) + 1,
          })
        }
        continue
      }
      /**
       * 🔴 **정본 조립 함수를 부른다** (2026-09-17 보정).
       *
       *    앞판은 여기서 `toThinRow` 를 직접 불렀고 `times` 를 넘기지 않았다.
       *    얇은 변환기(`micro-seed-navercafe-thin.mts`)에만 배선이 있어서,
       *    **운영 수집 경로의 세 시각이 통째로 비어 나갔다.**
       *    이제 두 경로가 같은 함수를 쓰고, fixture 가 그 함수를 직접 시험한다.
       */
      const row = thinRowFromCollected({
        collected: r,
        maskedBody: masked, bodyHeadChars: BODY_HEAD_CHARS,
        axis, safetyVerdict, safetyReasons: v.safety.reasons.map((x) => String(x)),
        reason: String(v.reason), runId: RUN_ID, fetchedAt: new Date().toISOString(),
      }) as unknown as Record<string, unknown>
      const bad = violatesStorage(row, BODY_HEAD_CHARS)
      if (bad.length > 0) throw new Error(`저장 계약 위반: ${bad.join(' · ')}`)
      thinRows.push(row)
    }
    const thinPath = outPathOf(dirname(OUT), CAFE_ID, RUN_ID)
    /**
     * 🔴 **저장이 끝난 뒤에만 `kept` 를 확정한다.**
     *    저장이 실패하면 원장에 아무것도 남지 않고, 다음 회차가 그 글을 다시 연다 —
     *    되찾을 수 있는 상태로 남기는 것이 영구 유실보다 낫다.
     */
    writeJsonl(thinPath, thinRows)
    if (!existsSync(thinPath)) {
      fail(`THIN_WRITE_FAILED — 산출물을 저장하지 못했다 (${thinPath})\n`
        + '   🔴 kept 를 확정하지 않았다. 다음 회차가 그 글을 다시 연다.', 'OTHER')
    }
    for (const r of thinRows) {
      const keptId = typeof r.id === 'string' ? r.id
        : typeof r.sourceArticleId === 'string' ? r.sourceArticleId : ''
      if (keptId === '') continue
      recordDetail({
        articleId: keptId, outcome: 'kept', at: new Date().toISOString(),
        runId: RUN_ID, attempts: (ledgerEntries.get(keptId)?.attempts ?? 0) + 1,
      })
    }
    /**
     * 🔴 **공급은 신규 고유 행이다.**
     *    같은 글을 네 회차가 반복해 담으면 `thinRows` 합은 4 지만 공급은 1 건이다.
     *    관측 처리량은 이 값으로 센다.
     */
    const newUnique = thinRows.filter((r) => {
      const id = typeof r.id === 'string' ? r.id
        : typeof r.sourceArticleId === 'string' ? r.sourceArticleId : ''
      return id !== '' && !doneIds.has(id)
    }).length
    const repeated = thinRows.length - newUnique
    markRun({ thinRows: thinRows.length, newUniqueThinRows: newUnique, repeatedRows: repeated })
    console.log(`  신규 고유 ${newUnique}행 · 반복 ${repeated}행 (🔴 공급은 신규 고유 행이다)`)
    console.log(`\n  → ${thinPath} (${thinRows.length}건 · run ${RUN_ID})`)
    console.log(`  🔴 전문을 저장하지 않았다 — 마스킹 후 앞 ${BODY_HEAD_CHARS}자만 남겼다`)
    if (droppedThin > 0) console.log(`  🔴 drop·hardExclude ${droppedThin}건은 얇은 사본도 만들지 않았다`)
    console.log('  다음: micro-seed:82cook-thin-adapt 가 검수용으로 바꾼다')
  } else if (collected.length) {
    // 🔴 보류 대상도 파일에 남긴다 (Q-1). 보류는 **적재 단계**가 한다
    writeJsonl(OUT, collected)
    console.log(`\n  → ${OUT} (${collected.length}건 · run ${RUN_ID})`)
    console.log('  🟡 이 파일에는 **본문 전문**이 들어 있다 — Raw Vault 적재용이다.')
    console.log('     정기 수집은 --thin 으로 돌려 전문을 남기지 않는다.')
    const held = collected.filter((r) => judgeAutoHold({ sourceArticleId: r.sourceArticleId, flags: r.qualityFlags }).hold)
    console.log(held.length ? `  🟡 자동 적재 보류 예정 ${held.length}건 (상세 플래그)` : '  🟢 자동 적재 보류 예정 0건')
  }
  console.log(`\n  🔴 Raw Vault 에 적재하지 않았다. 적재는 importer 가 한다:`)
  console.log(`     npx tsx scripts/micro-seed-import-82cook-live.mts --raw-only --batch=10 --input=${OUT}`)
  console.log(`     (--apply 를 붙여야 실제로 적재된다 · ${kstString(now)} KST)\n`)

  /**
   * 🔴 **연 것과 읽은 것은 다르다 — 종료 판정 하나** (`judgeCollectTerminal`).
   *    · 가입 안내를 만났으면 MEMBER_GATE (10/4~10/7 실측 — 3일 넘게 ok 였다)
   *    · 상세를 열었는데 본문 0건이면 BODY_EMPTY (10/7 15:30 실측 — 로그아웃 세션, 상세 16 · 본문 0 이 ok 였다)
   *    안내 앞에서 읽은 본문은 위에서 그대로 남겼다. 본문 실패 글은 `body_failed` 로 남아 다음 회차가 다시 연다.
   */
  const terminal = judgeCollectTerminal({
    memberGateId,
    detailRequests: runRecord?.detailRequests ?? 0,
    bodyRows: runRecord?.bodyRows ?? 0,
  })
  if (terminal !== null) {
    await endWithSessionFailure(terminal, terminal === 'MEMBER_GATE'
      ? `글 ${memberGateId} 에서 본문 대신 가입 안내`
      : `상세 ${runRecord?.detailRequests ?? 0}건 · 본문 0건`)
  }
}

// ─────────────────────────────────────────────────────────
// DOM 읽기 — 🔴 셀렉터는 실측으로 확정한다
// ─────────────────────────────────────────────────────────

/** 브라우저에서 꺼내오는 원자료 — 🔴 문자열뿐. 해석은 밖에서 한다 */
type ListProbeRow = {
  href: string; title: string
  comments: string; date: string; views: string; board: string
  /** 🔴 공지·필독·추천 라벨 텍스트와 행 class — 둘 다 봐야 놓치지 않는다 */
  labelText: string; rowClass: string
  rowFound: boolean; metaError: string | null
}
type ListProbe = { linkHits: number; rows: ListProbeRow[] }

type NaverPage = {
  goto: (url: string, o: object) => Promise<unknown>
  // 🔴 arg 를 받는 오버로드가 필요하다. 셀렉터를 콜백 **밖에서** 넘겨야
  //    콜백 안에 이름 있는 상수를 만들지 않을 수 있다 (esbuild __name 회피).
  $$eval: {
    <T>(sel: string, fn: (els: Element[]) => T): Promise<T>
    <T, A>(sel: string, fn: (els: Element[], arg: A) => T, arg: A): Promise<T>
  }
  frames: () => { $$eval: NaverPage['$$eval']; url: () => string }[]
}
type NaverBrowser = {
  close: () => Promise<void>
  newContext: (o: object) => Promise<{ newPage: () => Promise<NaverPage> }>
}
type Chromium = { launch: (o: object) => Promise<NaverBrowser> }

/**
 * Playwright 모듈을 live 경로에서만 동적으로 부른다.
 *
 * 🔴 **`playwright` 만 찾지 않는다.** 이 저장소에는 `playwright-core` 가 이미 devDependency 로
 *    들어 있다(package.json). 앞 코드는 `playwright` 만 보고 "설치돼 있지 않다" 고 말했다 —
 *    있는 것을 없다고 한 셈이라 PR-S2-b-3 에서 고쳤다.
 *
 *    문자열 변수로 부르는 이유는 그대로다: 없는 모듈을 정적으로 import 하면 typecheck 가 깨진다.
 *    dry-run · fixture · typecheck 는 브라우저 없이 전부 돈다.
 */
async function loadChromium(): Promise<Chromium> {
  for (const spec of PLAYWRIGHT_SPECS) {
    try {
      const mod = (await import(spec)) as { chromium?: Chromium }
      if (mod.chromium) return mod.chromium
    } catch {
      // 다음 후보로 넘어간다
    }
  }
  return fail(
    `Playwright 를 찾지 못했다 (시도: ${PLAYWRIGHT_SPECS.join(', ')}).\n` +
      '     npm i -D playwright-core\n' +
      '   🔴 브라우저 바이너리는 받지 않아도 된다 — 기본은 설치된 Google Chrome 을 쓴다\n' +
      `      (${BROWSER_CHANNEL_ENV}=chromium 을 주면 번들 브라우저를 쓴다).`,
  )
}

/**
 * 🔴 목록 셀렉터는 **첫 live 에서 실측 후 확정**한다.
 *    네이버 카페는 iframe 구조이고 신형/구형 DOM 이 섞여 있어(우나어 실측),
 *    실제 페이지를 보지 않고 적은 셀렉터는 조용히 0건을 반환한다.
 *    지금은 구조만 두고 첫 live 에서 사람이 확인한다 — 0건이면 위에서 throw 한다.
 */
async function readList(
  page: NaverPage,
  cafeId: string,
  pageNo: number,
): Promise<{ items: NaverListItem[]; probes: FrameProbe[] }> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  const probes: FrameProbe[] = []
  const unknownLabels = new Set<string>()

  for (const [idx, f] of [page, ...frames].entries()) {
    const label = idx === 0 ? '(top)' : safeFrameLabel(frames[idx - 1].url())
    try {
      // 🔴 브라우저 안에서는 **문자열을 그대로 꺼내오기만** 한다.
      //    해석(숫자 변환 · 시각 파싱)은 밖의 순수 함수가 한다 —
      //    $$eval 안의 코드는 fixture 로 검증할 수 없기 때문이다.
      //
      // 🔴 **메타 추출이 링크 수집을 죽이지 않는다** (PR-S2-b-5).
      //    메타 셀렉터 하나가 터지면 콜백 전체가 터지고, 그 예외를 바깥
      //    catch 가 삼켜 "목록 0건" 으로 보였다 — 2026-09-03 실측 사고.
      //    그래서 메타는 콜백 **안에서** 각자 try 로 감싼다.
      // 🔴 명시 제네릭을 주지 않는다 — 주면 arg 없는 오버로드가 선택된다. 추론에 맡긴다.
      const probe: ListProbe = await f.$$eval(LIST_SELECTORS.link, (els: Element[], sel: typeof LIST_SELECTORS): ListProbe => {
        const rows = els.map((el) => {
          const a = el as HTMLAnchorElement
          const base = { href: a.href, title: (a.textContent ?? '').trim() }
          try {
            const near = a.closest(sel.row)
            // 🔴 여기서 `const pick = () => ...` 같은 **이름 있는 함수를 만들지 않는다.**
            //    esbuild(tsx) 의 keepNames 가 __name(...) 래퍼를 씌우는데
            //    브라우저에는 그 헬퍼가 없어 ReferenceError 가 난다 — 2026-09-03 실측 원인.
            return {
              ...base,
              comments: near?.querySelector(sel.comment)?.textContent?.trim() ?? '',
              date: near?.querySelector(sel.date)?.textContent?.trim() ?? '',
              views: near?.querySelector(sel.view)?.textContent?.trim() ?? '',
              board: near?.querySelector(sel.board)?.textContent?.trim() ?? '',
              labelText: near?.querySelector(sel.label)?.textContent?.trim() ?? '',
              rowClass: near === null ? '' : String((near as HTMLElement).className || ''),
              // 🔴 행을 찾았는가. 댓글 링크는 **댓글이 0 이면 아예 없다** —
              //    행을 찾았는데 링크가 없으면 "못 읽음" 이 아니라 "진짜 0" 이다.
              rowFound: near !== null,
              metaError: null as string | null,
            }
          } catch (e) {
            return {
              ...base, comments: '', date: '', views: '', board: '', labelText: '', rowClass: '', rowFound: false,
              metaError: e instanceof Error ? e.message : String(e),
            }
          }
        })
        return { linkHits: els.length, rows }
      }, LIST_SELECTORS)

      const items: NaverListItem[] = []
      for (const r of probe.rows) {
        const id = parseArticleId(r.href)
        if (id === null || r.title === '') continue
        if (items.some((i) => i.sourceArticleId === id)) continue
        const comments = normalizeCount(r.comments)
        const label = detectRowLabel(r.labelText, r.rowClass)
        items.push({
          sourceArticleId: id,
          sourceUrl: ARTICLE_URL(cafeId, id),
          originalTitle: r.title,
          // 🔴 댓글 수만 0 으로 떨어뜨린다 — assessCandidate 계약이 number 다.
          //    다만 "진짜 0" 과 구분되도록 read 플래그를 함께 남긴다.
          sourceCommentCount: comments ?? 0,
          // 🔴 행을 찾았으면 읽은 것이다. 네이버는 댓글이 0 이면 `a.cmt` 를 아예 렌더하지 않는다 —
          //    "링크가 없다" 를 "못 읽었다" 로 보면 진짜 0 인 글이 전부 미지값이 된다.
          sourceCommentCountRead: r.rowFound,
          // 나머지 메타는 못 읽으면 null 로 남긴다(추측하지 않는다)
          sourcePostedLabel: r.date || null,
          sourceViewCount: normalizeCount(r.views),
          // 🔴 개별 게시판 페이지에는 a.board_name 셀이 없다. 그때는 타깃의 label 을 쓴다 —
          //    앞 코드는 기본값 '전체글보기' 로 떨어져 쫑알쫑알 225건이 전부 잘못 기록됐다.
          sourceBoardName: r.board || BOARD?.label || null,
          sourcePage: pageNo,
          sourceRankOnPage: items.length + 1,
          // ── PR-S2-b-7 ──
          sourceRowLabel: label.label ?? label.unknown,
          sourcePinned: label.pinned,
          sourceMenuId: BOARD?.menuId ?? null,
          sourceBoardKey: BOARD?.key ?? null,
        })
        // 🔴 모르는 라벨은 조용히 넘기지 않는다. 네이버가 문구를 바꾸면 여기서 드러난다
        if (label.unknown !== null) unknownLabels.add(label.unknown)
      }
      const metaErr = probe.rows.find((r) => r.metaError !== null)?.metaError ?? null
      probes.push({ frame: label, linkHits: probe.linkHits, rows: probe.rows.length, items: items.length, error: metaErr })
      if (unknownLabels.size) {
        console.log(`     ⚠️ 모르는 행 라벨 ${unknownLabels.size}종 — 네이버가 문구를 바꿨을 수 있다: ${[...unknownLabels].slice(0, 5).join(' · ')}`)
      }
      if (items.length) return { items, probes }
    } catch (e) {
      // 🔴 삼키지 않는다. 이 프레임에 목록이 없는 것과 콜백이 터진 것은 다른 사건이다.
      //    HTML 전문은 담지 않는다 — message 만 남긴다.
      probes.push({
        frame: label,
        linkHits: 0,
        rows: 0,
        items: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { items: [], probes }
}

/**
 * 🔴 이미지·댓글을 읽지 않는다. 본문 텍스트만 가져온다.
 *
 * 🔴 **여기도 실패를 삼키지 않는다** (PR-S2-b-5). readList 와 같은 결함이 한 단계 뒤에 있었다 —
 *    콜백이 터져도 "본문을 읽지 못했다" 한 줄만 나와서, 셀렉터가 안 맞는 것인지
 *    코드가 터진 것인지 구분할 수 없었다.
 */
/**
 * 카페 홈 화면 글자 — 🔴 회원 판정(`judgeCafeMembership`) 입력으로만 쓴다. 저장·출력하지 않는다.
 *    프레임 하나가 터져도 나머지를 읽는다. 하나도 못 읽으면 빈 문자열 → unknown → 진행하지 않는다.
 */
async function readPageText(page: NaverPage): Promise<string> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  let text = ''
  for (const f of [page, ...frames]) {
    try {
      const parts = await f.$$eval<string[]>('body', (els) => els.map((el) => (el as HTMLElement).innerText ?? ''))
      text += `\n${parts.join('\n')}`
    } catch { /* 다른 출처·사라진 프레임 — 다음 프레임을 본다 */ }
  }
  return text
}

async function readArticleBody(page: NaverPage): Promise<{ body: string | null; errors: string[] }> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  const errors: string[] = []
  for (const f of [page, ...frames]) {
    try {
      const texts = await f.$$eval<string[]>('.se-main-container, #postViewArea, .article_viewer', (els) =>
        els.map((el) => (el as HTMLElement).innerText ?? ''),
      )
      const body = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (body) return { body, errors }
    } catch (e) {
      // 🔴 message 만 남긴다 — 본문 HTML 을 로그로 흘리지 않는다
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { body: null, errors }
}

main()
  .then(() => {
    // 🔴 여기 닿았으면 회차가 끝난 것이다. scout 는 이미 위에서 기록했다
    if (!finishRun('ok')) {
      // 🔴 성공했는데 종료 기록을 못 남겼다 — exit 0 으로 끝내지 않는다.
      //    그 회차는 `started` 로 남고, 관제는 그것을 STALE_STARTED 로 잡는다
      releaseOwnLock()
      console.error('\n🛑 RECORD_TERMINAL_WRITE_FAILED — 수집은 됐으나 종료 기록을 남기지 못했다.\n')
      process.exit(1)
    }
    releaseOwnLock()
  })
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    // 🔴 원인별로 코드를 남긴다 — "세션" 한 낱말로 뭉개지 않는다
    const code = /셀렉터|selector|목록이 비었다/i.test(msg) ? 'SELECTOR'
      : /net::|ECONN|timeout|타임아웃|네트워크/i.test(msg) ? 'NETWORK'
        : 'OTHER'
    finishRun('failed', code)
    releaseOwnLock()
    console.error(`\n❌ ${msg}\n`)
    process.exit(1)
  })
