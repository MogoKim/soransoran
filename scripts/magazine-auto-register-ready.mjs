#!/usr/bin/env node
/**
 * 자동 발행 레인 — 후보 스캐너 · 일괄 실행 · 리포트.
 *
 * 🔴 등급으로 후보를 가르지 않는다 (M3-A). `validationProfile` 이 검증 강도를 정한다.
 *
 *   00:10 KST  magazine-producer-run.mjs        선정 · brief · 원고 회수 · 알림
 *   02:00 KST  이 스크립트 (auto-register-run)  변환 · QA · batch-qa · hero · register · PR
 *
 * 🔴 기본이 dry-run 이다. --write 없이는 **repo 파일 변경 0건**이다.
 *    회수·변환·hero·register 어느 것도 쓰지 않고, 리포트 JSON 도 쓰지 않는다.
 *
 * 🔴 Slack 은 --notify-send 를 줬을 때만 실제로 나간다.
 *    --notify 는 보낼 문구를 만들어 콘솔에 보여주기만 한다(발송 0).
 *    plist 는 인자 없이 부르므로 **새벽 dry-run 회차는 Slack 을 보내지 않는다.**
 *    → 그래서 새벽 감시 기준은 **launchd 로그**다:
 *       ~/Library/Logs/soransoran/magazine-auto-register.log
 *       (--write 회차만 _runs/{date}/auto-register.json 을 남긴다)
 *
 * 🔴 write 는 깨끗한 main 에서만 시작한다 (magazine-auto-git.mjs preflight).
 *    현재 브랜치 main · origin/main 과 동기 · 추적 변경 0건. 하나라도 아니면 BLOCKED.
 *    미추적 파일은 판단 대상이 아니지만 **stage 에는 절대 넣지 않는다**.
 *
 * 🔴 PR 브랜치를 register write **앞에** 만든다.
 *    나중에 만들면 articles.ts 가 먼저 바뀐 뒤 브랜치 생성에 실패했을 때
 *    그 변경이 main 에 남는다. 순서를 뒤집으면 실패가 "아무 일도 없음"으로 끝난다.
 *
 * 🔴 큐에 없거나 validationProfile 을 정할 수 없는 slug 만 gate 에서 끝난다 (magazine-auto-lane.mjs).
 * 🔴 사람 승인 손잡이는 없다 (M3-A 에서 제거).
 *
 * 사용법
 *   node scripts/magazine-auto-register-ready.mjs --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --dry-run --json
 *   node scripts/magazine-auto-register-ready.mjs --run YYYY-MM-DD --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --write --pr
 *   node scripts/magazine-auto-register-ready.mjs --write --pr --notify-send
 *
 * 종료 코드: BLOCKED 가 있으면 1, 아니면 0
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue, loadArticles, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { gate, progress, paths } from './lib/magazine-auto-lane.mjs'
import { branchName, writePreflight, createBranch, assertOnBranch, stageCheck, returnToMain } from './lib/magazine-auto-git.mjs'
import { acquireLock } from './lib/magazine-auto-lock.mjs'
import { readOutstanding, SEVERITY } from './lib/magazine-outstanding.mjs'
import {
  fingerprintOf, judgeQuarantine, readQuarantine, recordFailure, updateQuarantine,
} from './lib/magazine-quarantine.mjs'
import { drive } from './magazine-auto-register.mjs'
import { buildMessage, send, webhookStatus } from './lib/slack-notify.mjs'
import { readRunTargets, registerTargets } from './lib/magazine-run-targets.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 하루 1건. 첫 예약 후보일은 내일부터 본다 — 오늘 10:30 은 이미 지났을 수 있다 */
const SLOT_START_OFFSET_DAYS = 1

/** register 가 고치는 두 파일. stage 예상 목록의 고정 부분이다 */
const REGISTER_FILES = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts']

function kstDate(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10)
}

function exec(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, out: '', err: String(r.error.message ?? r.error) }
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/** 이미 잡힌 날짜. register.mjs 와 같은 규칙으로 읽는다 */
export function takenDates() {
  const taken = new Set()
  for (const a of loadArticles()) {
    const iso = a.publishAt ?? (a.publishedAt ? `${a.publishedAt}T10:30:00+09:00` : null)
    if (!iso) continue
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) taken.add(new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10))
    if (typeof a.publishedAt === 'string') taken.add(a.publishedAt)
  }
  return taken
}

function kstDateAfter(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400 * 1000).toISOString().slice(0, 10)
}

/**
 * 빈 슬롯을 앞에서부터 나눠 준다.
 *
 * 🔴 **고르는 것과 확정하는 것을 나눈다** (2026-09-16 실측 버그).
 *
 *    옛 판은 한 번 부를 때마다 날짜를 **소비**했다. 그래서 그 후보가 QA 에 막혀도
 *    그 날짜는 이미 쓴 것이 됐다. 실제로 이렇게 됐다:
 *
 *      1) dinner-change-two-weeks  QA_FAIL  → 9/18 소비 🔴
 *      2) after-menopause-body     DONE     → 9/19 배정
 *      3) cold-weather-joint-pain  QA_FAIL  → 9/20 소비 🔴
 *
 *    등록된 것은 하나인데 **빈 날짜 셋이 사라졌다.** 9/18 이 비어 있는데도
 *    성공한 글이 9/19 로 밀렸다 — 재고가 하루 더 비는 사고다.
 *
 *    `peek()` 은 "지금 비어 있는 첫 날" 을 **보기만** 한다.
 *    `commit()` 은 실제로 등록되는 후보에만 부른다. 막힌 후보는 날짜를 건드리지 않는다.
 *
 * 🔴 여기서 고른 날짜가 틀려도 안전하다 — register 가 슬롯을 다시 보고 BLOCKED 를 낸다.
 *    그러나 "안전하다" 와 "재고를 낭비하지 않는다" 는 다른 이야기다.
 *
 * 🔴 **점유 날짜를 주입할 수 있다** (2026-09-16 회귀 보정).
 *
 *    운영은 그대로 `takenDates()` 를 읽는다 — 기본값을 바꾸지 않는다.
 *    바뀐 것은 테스트가 **자기 fixture 를 넘길 수 있다**는 것뿐이다.
 *
 *    왜 필요한가: 회귀 테스트가 실제 `articles.ts` 를 읽으면서 기대값을 9/18 로
 *    하드코딩했다. #524 가 merge 되어 9/18 이 차는 순간 **13건이 무더기로 깨졌다.**
 *    로직은 멀쩡한데 테스트만 깨진 것이다 — 재고는 매일 바뀌므로 그 테스트는
 *    **내일도 모레도 깨진다.** 날짜를 시험하려면 날짜를 고정해야 한다.
 *
 * 🔴 넘겨받은 Set 을 **복사**한다. 그러지 않으면 한 테스트의 commit 이
 *    다음 테스트의 fixture 를 오염시킨다.
 *
 * @param {string} from  이 날짜부터 훑는다 (YYYY-MM-DD)
 * @param {{taken?: Set<string>|Iterable<string>|(() => Iterable<string>)}} [opts]
 */
export function slotAllocator(from, { taken: takenInput } = {}) {
  const source = typeof takenInput === 'function' ? takenInput() : takenInput
  const taken = new Set(source ?? takenDates())
  let cursor = from

  /** 지금 비어 있는 첫 날. **소비하지 않는다** — 몇 번을 불러도 같은 값이다 */
  const peek = () => {
    while (taken.has(cursor)) cursor = kstDateAfter(cursor)
    return cursor
  }

  return {
    peek,
    /**
     * 그 날짜를 실제로 쓴다. 🔴 **등록되는 후보에만 부른다.**
     * 인자를 받지 않는다 — peek 이 준 값 외의 날짜를 확정할 자리는 없다.
     */
    commit: () => {
      const picked = peek()
      taken.add(picked)
      cursor = kstDateAfter(picked)
      return picked
    },
  }
}

/**
 * 이 판정이 "실제로 예약 날짜를 쓴다" 는 뜻인가.
 *
 * 🔴 dry-run 의 `DRY_RUN_OK` 도 포함한다 — 그 회차가 write 였다면 등록됐을 후보다.
 *    포함하지 않으면 dry-run 과 실제 write 의 날짜 배정이 어긋나, 사람이 dry-run 을 보고
 *    "9/18 에 들어가겠군" 이라 판단한 뒤 실제로는 다른 날짜가 잡힌다.
 * 🔴 `DRY_RUN_INCOMPLETE` 는 포함하지 않는다 — 아직 등록 가능 여부를 모른다.
 */
export const CONSUMES_SLOT = new Set(['DONE', 'DRY_RUN_OK'])

/** producer 가 고른 것 (있으면) — 없으면 큐 전체를 훑는다 */
/**
 * 🔴 **`selected` 만 읽지 않는다** (2026-09-28 공급 0건 · Codex 재검토).
 *    `reusable`(재료가 이미 있는 주제)을 빼면, 재료 17건이 있는 날에도 후보 0건이 된다.
 *    회수 경로(`magazine-webui-runner --fetch-run`)와 **같은 계약**을 쓴다 —
 *    둘이 다른 목록을 보면 한쪽이 만든 것을 다른 쪽이 못 받는다.
 *
 * 🔴 여기서는 **원고가 있는 대상**만 받는다. brief 만 있는 것은 회수 경로의 몫이다.
 */
function slugsFromRun(date, draftsDir = DRAFTS_DIR) {
  const r = readRunTargets({ draftsDir, date })
  if (!r.ok) return null
  return registerTargets(r.targets).map((t) => t.slug)
}

/**
 * 원고가 바뀌었는지 보는 값 — 사람이 고치면 격리가 즉시 풀린다.
 *
 * 🔴 **`draft.md` 를 본다. `article-draft.ts` 가 아니다** (2026-09-17 실측).
 *    `article-draft.ts` 는 **회차마다 자동 변환이 다시 만드는 산출물**이다.
 *    그것을 지문으로 쓰면 내용이 그대로여도 매 회차 "바뀌었다" 가 되고,
 *    실패 횟수가 1 로 초기화돼 격리가 영원히 발동하지 않는다.
 *    실제로 그래서 같은 후보 둘이 이틀 연속 실패하고도 attempts=1 이었다.
 *
 *    `draft.md` 는 **사람이나 ChatGPT 가 쓴 입력**이다. 그것이 바뀌어야
 *    "고쳐졌다" 이고, 그때만 격리가 풀려야 한다.
 *
 * 🔴 stat 이 아니라 내용을 읽는다. 시각은 지문에 들어가지 않는다.
 */
function draftFingerprint(slug) {
  const p = paths(slug)
  // 입력 정본이 우선이다. 없을 때만 산출물로 물러선다.
  for (const file of [p.draftMd, p.articleTs]) {
    try {
      const fp = fingerprintOf(readFileSync(file, 'utf8'))
      if (fp) return fp
    } catch { /* 다음 후보 파일 */ }
  }
  return null
}

/**
 * 한 회차의 처리 예산.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **실패 후보가 정상 후보를 굶겼다** (2026-09-17 실측).
 *
 *    옛 판은 `eligible.slice(0, 3)` 이었다. 앞의 3건이 전부 막히면 그 회차는
 *    등록 0건으로 끝난다 — 뒤에 멀쩡한 후보가 6건 있어도 손대지 않는다.
 *    실제로 9/17 회차는 gate 통과 9건 중 3건만 보고 셋 다 막혀 0건으로 끝났다.
 *    격리 지문 결함까지 겹쳐 **같은 세 후보가 매일 앞자리를 차지했다.**
 *
 * 🔴 **그래서 예산을 둘로 나눈다.**
 *      등록 예산  `limit`    — 이만큼 **등록되면** 멈춘다 (하루 공급량)
 *      시도 상한  `ceiling`  — 이만큼 **시도하면** 멈춘다 (성공·실패 무관)
 *
 * 🔴 **상한은 반드시 유한하다.** 없으면 막힌 후보 수십 건을 매일 변환하며
 *    ChatGPT·파일 쓰기를 태운다. 그것은 무한 재시도와 같다.
 *    재시도가 아니라 **탐색**이라는 점이 중요하다 — 같은 후보를 다시 돌리지 않는다.
 *    한 번 막힌 후보는 격리가 세고, 두 번이면 7일 비켜 준다.
 *
 * @returns {{stop:boolean, code:string, message:string}}
 */
export function judgeBudget({ registered, attempted, limit, ceiling }) {
  if (registered >= limit) {
    return { stop: true, code: 'BUDGET_MET', message: `등록 ${registered}건 — 오늘 예산(${limit})을 채웠다` }
  }
  if (attempted >= ceiling) {
    return { stop: true, code: 'ATTEMPT_CEILING', message: `${attempted}건을 시도했다 — 상한(${ceiling})에서 멈춘다. 재시도하지 않는다` }
  }
  return { stop: false, code: 'CONTINUE', message: '' }
}

/**
 * 시도 상한의 기본값.
 * 🔴 등록 예산의 3배 · 최대 9. 하루에 후보 9건을 넘겨 보지 않는다.
 */
export const ATTEMPT_CEILING_MAX = 9
export const ceilingFor = (limit) => Math.min(ATTEMPT_CEILING_MAX, Math.max(limit, limit * 3))

/** 자동 레인 후보 — gate 를 통과하고 brief 가 이미 있는 것만 */
/**
 * @param {{runDate?:string|null, store?:object}} p
 *   🔴 `store` 는 **호출부가 한 번 읽어 넘긴다.** scan 이 따로 읽으면
 *      한 회차에 장부를 두 번 읽게 되고, 그 사이 값이 달라지면 판정이 엇갈린다.
 */
/**
 * 🔴 `draftsDir` 는 **시험이 실제 이 함수를 돌리기 위한** 최소 주입점이다.
 *    기본값은 운영 경로 그대로다.
 */
export function scan({ runDate = null, store = {}, draftsDir = DRAFTS_DIR } = {}) {
  const queue = loadQueue()
  const fromRun = runDate ? slugsFromRun(runDate, draftsDir) : null
  const pool = fromRun ?? queue.map((q) => q.slug)

  const now = Date.now()

  const eligible = []
  const skipped = []
  const quarantined = []
  for (const slug of pool) {
    const g = gate(slug, queue)
    if (!g.ok) {
      skipped.push({ slug, riskLevel: g.item?.riskLevel ?? null, blockedBy: g.blockedBy })
      continue
    }
    // 🔴 격리된 후보는 **건너뛴다.** 그래야 뒤의 멀쩡한 후보가 limit 안에 들어온다.
    //    막힌 것을 고쳐 주지 않는다 — 비켜 줄 뿐이다.
    const q = judgeQuarantine({ entry: store[slug], fingerprint: draftFingerprint(slug), now })
    if (q.skip) {
      quarantined.push({ slug, code: q.code, message: q.message })
      continue
    }
    eligible.push({ slug, item: g.item, progress: progress(slug) })
  }
  return { source: fromRun ? `run:${runDate}` : 'queue', pool: pool.length, eligible, skipped, quarantined }
}

/**
 * 🔴 **한 회차의 후보 처리 — 실제 운영 루프.**
 *
 *    `main()` 안에 있으면 시험이 닿지 못한다. 그래서 앞판은 `drive` 단독 fake 로만
 *    "재생성이 된다" 를 확인했고, **ready 가 장부를 덮어쓰는 결함**은 아무도 보지 못했다.
 *    여기로 꺼내 두면 실제 루프를 그대로 돌려 볼 수 있다.
 *
 * @param {object} p
 * @param {(slug:string, opts:object, deps?:object)=>object} [p.driveFn] 🔴 시험 주입용
 * @param {string} [p.quarantinePath] 🔴 시험 주입용 — 운영 장부를 건드리지 않는다
 */
export function processCandidates({
  write, wantPr, limit, runDate = null, report,
  driveFn = drive, quarantinePath = undefined, driveDeps = {},
  /**
   * 🔴 후보 스캔도 주입점이다 — **운영 큐가 0건이어도 orchestration 을 검증**하려면
   *    고정 fixture 후보를 넣을 자리가 필요하다. 기본값은 실제 scan 그대로다.
   */
  scanFn = scan,
}) {
  const upd = (fn) => updateQuarantine(fn, ...(quarantinePath ? [quarantinePath] : []))
  const ledger = readQuarantine(...(quarantinePath ? [quarantinePath] : []))
  if (!ledger.ok) {
    /**
     * 🔴 **깨진 장부는 예외 종료가 아니라 「전체 후보 HOLD」다.**
     *    예외로 끝내면 lock 도 안 풀리고 Slack 도 안 나가고 무엇이 문제인지도 안 남는다.
     */
    report.ledgerHold = { code: 'QUARANTINE_UNREADABLE', message: ledger.why }
    report.blocked.push({ slug: '(ledger)', blockedBy: [{ code: 'QUARANTINE_UNREADABLE', message: ledger.why }] })
  }
  const scanned = scanFn({ runDate, store: ledger.store })
  const slots = slotAllocator(kstDate(SLOT_START_OFFSET_DAYS))

  const done = []
  const blocked = []
  const results = []

  // 🔴 등록 예산과 시도 상한을 따로 센다 — 막힌 후보가 정상 후보를 굶기지 않는다
  const ceiling = ceilingFor(limit)
  let registered = 0
  let budgetStop = null
  // 🔴 장부를 못 읽었으면 한 건도 태우지 않는다 — 전부 HOLD 로 보고하고 끝낸다
  for (const cand of (ledger.ok ? scanned.eligible : [])) {
    const b = judgeBudget({ registered, attempted: results.length, limit, ceiling })
    if (b.stop) { budgetStop = b; break }
    // 🔴 **보기만 한다.** 이 후보가 QA 에 막히면 이 날짜는 다음 후보가 그대로 받는다.
    const publishAt = slots.peek()
    // 🔴 자동 레인이다 — alt 는 review.ts 또는 cluster 기본값에서 나온다 (사람 입력 없음)
    const r = driveFn(cand.slug,
      { write, pr: wantPr, publishAt, alt: null, allowOptional: false, autoLane: true },
      { ...driveDeps, ...(quarantinePath ? { quarantinePath } : {}) })
    r.publishAt = publishAt
    // 🔴 실제로 등록되는 후보만 날짜를 쓴다. 막힌 후보가 빈 예약일을 태우지 않는다.
    if (CONSUMES_SLOT.has(r.verdict)) { slots.commit(); registered += 1 }
    results.push(r)

    if (r.verdict === 'BLOCKED') {
      blocked.push(r)
      if (write) {
        /**
         * 🔴 **매번 최신 장부를 다시 읽어 갱신한다.**
         *    drive 가 방금 기록한 `regenCalls` 를 들고 있던 사본으로 덮으면
         *    2회 소진한 글이 0회로 되살아난다 (lost update).
         */
        const u = upd((cur) => ({
          ...cur,
          [r.slug]: {
            ...cur[r.slug],
            ...recordFailure({
              entry: cur[r.slug],
              fingerprint: draftFingerprint(r.slug),
              now: Date.now(),
              reasons: (r.blockedBy ?? []).map((x) => `${x.code}: ${x.message}`),
              // 🔴 drive 가 아는 전송 여부를 그대로 넘긴다 — 모르면 말하지 않는다(= false)
              ...(r.sent !== undefined ? { sent: r.sent } : {}),
            }),
            // 🔴 drive 가 센 재생성 횟수를 보존한다
            ...(cur[r.slug]?.regenCalls !== undefined ? { regenCalls: cur[r.slug].regenCalls } : {}),
            ...(cur[r.slug]?.lastPacketHash !== undefined ? { lastPacketHash: cur[r.slug].lastPacketHash } : {}),
          },
        }))
        if (!u.ok) report.blocked.push({ slug: r.slug, blockedBy: [{ code: 'QUARANTINE_UNREADABLE', message: u.why }] })
      }
    } else if (r.verdict === 'DONE') {
      done.push(r)
      // 🔴 등록에 성공하면 기록을 지운다. 옛 실패를 남겨 두면 다음에 오해한다.
      if (write) upd((cur) => { const n = { ...cur }; delete n[r.slug]; return n })
    }
  }
  return { ledger, scanned, done, blocked, results, registered, ceiling, budgetStop }
}

// ── PR ─────────────────────────────────────────────────────

/** 등록될 slug 들이 만들 파일 — stage 예상 목록. 이 밖의 것이 staged 면 커밋하지 않는다 */
function expectedFiles(slugs) {
  const files = [...REGISTER_FILES]
  for (const slug of slugs) {
    const p = paths(slug)
    for (const f of [p.draftMd, p.articleTs]) if (existsSync(f)) files.push(f.replace(`${ROOT}/`, ''))
    if (existsSync(join(ROOT, 'public/magazine', slug, 'hero.webp'))) files.push(`public/magazine/${slug}/hero.webp`)
  }
  return files
}

/**
 * register write 가 끝난 뒤 — 명시 stage · 검증 · commit · push · PR.
 * 🔴 `git add .` 을 쓰지 않는다. 파일 이름을 하나씩 넣고, staged 목록을 다시 확인한다.
 *
 * 🔴 **실행기를 주입받는다** (2026-09-15 복구). 회귀 테스트가 실제 git·gh 를 부르지 않고
 *    "push 는 됐는데 PR 이 실패" 같은 부분 실패를 시험할 수 있어야 한다.
 *    그 조합이 정확히 우리가 당한 모양이다.
 *
 * 🔴 `gh` 가 없어서 실패하는 경우는 **여기까지 오지 않는다.**
 *    `writePreflight` 가 파일을 건드리기 전에 막는다. 그래도 여기서 실패하면
 *    `made:false` 와 사유를 남기고, 호출부가 그것을 BLOCKED 로 올린다.
 */
export function finishPr(branch, doneSlugs, { exec: run = exec } = {}) {
  if (doneSlugs.length === 0) return { made: false, branch, reason: '등록된 건이 없다', pushed: false }

  const still = assertOnBranch(branch, { exec: run })
  if (!still.ok) return { made: false, branch, reason: still.blockedBy[0].message, pushed: false }

  const files = expectedFiles(doneSlugs).filter((f) => existsSync(join(ROOT, f)))
  const added = run('git', ['add', ...files])
  if (added.code !== 0) return { made: false, branch, reason: `stage 실패: ${added.err.split('\n').pop()}`, pushed: false }

  const staged = run('git', ['diff', '--cached', '--name-only'])
  const check = stageCheck(files, staged.out)
  if (!check.ok) {
    run('git', ['restore', '--staged', ...check.staged])
    return { made: false, branch, reason: check.blockedBy[0].message, staged: check.staged, pushed: false }
  }

  // 🔴 M3-A — 등급으로 가르지 않는다. merge 는 자동 관문이 판정한다 (사람 승인 없음)
  const title = `feat(magazine): 자동 등록 ${doneSlugs.length}건 (${kstDate()})`
  const body = [
    '자동 레인(`magazine-auto-register-ready.mjs`)이 만든 등록 PR 이다.',
    '',
    `등록: ${doneSlugs.join(', ')}`,
    '',
    '게이트: topic-queue 정본 · validationProfile 별 결정론적 QA ·',
    'magazine QA FAIL 0 · batch-qa READY(--strict-auto) · register 통과.',
    '🔴 등급(riskLevel·autoEligible)으로 거르지 않는다 — 검증 강도만 정한다.',
    '🔴 QA 실패는 실패 패킷과 함께 최대 2회 자동 재생성한다. 그래도 실패하면 그 글만 HOLD.',
    '',
    `staged 파일: ${check.staged.join(', ')}`,
    '',
    '🔴 merge 는 자동 병합 관문(magazine-merge-gate)이 판정한다 — 사람 승인 단계는 없다.',
  ].join('\n')

  const committed = run('git', ['commit', '-m', title, '-m', body])
  if (committed.code !== 0) return { made: false, branch, reason: `commit 실패: ${committed.err.split('\n').pop()}`, pushed: false }

  const pushed = run('git', ['push', '-u', 'origin', branch])
  if (pushed.code !== 0) return { made: false, branch, reason: `push 실패: ${pushed.err.split('\n').pop()}`, pushed: false }

  const pr = run('gh', ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch])
  if (pr.code !== 0) {
    // 🔴 **여기까지 오면 커밋은 이미 origin 에 있다.** 그 사실을 반드시 남긴다 —
    //    `pushed: true` 가 없으면 "PR 이 없다" 와 "아무 일도 없었다" 가 구분되지 않는다.
    return {
      made: false,
      branch,
      pushed: true,
      reason: `PR 생성 실패 (브랜치는 origin 에 올라가 있다 — 사람이 PR 을 연다): ${pr.err.split('\n').pop()}`,
    }
  }
  return { made: true, branch, pushed: true, url: pr.out.split('\n').pop(), staged: check.staged }
}

// ── 리포트 ─────────────────────────────────────────────────

function reportPath(date) {
  return join(DRAFTS_DIR, '_runs', date, 'auto-register.json')
}

/** 🔴 dry-run 은 리포트도 쓰지 않는다 — repo 파일 변경 0건이 원칙이다 */
function writeReport(report, { write }) {
  const date = kstDate()
  if (!write) return { written: false, path: reportPath(date), reason: 'dry-run — 쓰지 않는다' }
  const dir = join(DRAFTS_DIR, '_runs', date)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // 🔴 회차 식별자를 함께 남긴다 (2026-09-17). 결과 파일은 날짜별 한 칸이라,
  //    식별자가 없으면 부른 쪽이 **앞 회차가 쓴 파일**을 이번 실적으로 읽는다.
  const stamped = { ...report, runId: runIdFromArgv(), writtenAt: new Date().toISOString() }
  writeFileSync(reportPath(date), `${JSON.stringify(stamped, null, 2)}\n`, 'utf8')
  return { written: true, path: reportPath(date) }
}

/** 실행기가 넘긴 회차 식별자. 사람이 직접 돌리면 없다 — 그때는 연결을 시도하지 않는다 */
function runIdFromArgv() {
  const i = process.argv.indexOf('--run-id')
  return i === -1 ? null : process.argv[i + 1] ?? null
}

/**
 * Slack — 문구는 --notify 로 만들고, 실제 발송은 --notify-send 로만 연다.
 * 🔴 --notify 만 있으면 한 건도 보내지 않는다.
 */
async function notifySlack(report, { actuallySend, dryRunLane }) {
  const done = report.done.length
  const blocked = report.blocked.length

  // 🔴 **write 회차는 조용히 끝나지 않는다** (2026-09-15 복구).
  //    dry-run 은 예전처럼 알릴 것이 없으면 아무것도 보내지 않는다 — 매일 오는 알림은 안 읽힌다.
  //    그러나 write 회차는 성공도 알린다. 무인으로 articles.ts 를 고치고 PR 을 여는 회차가
  //    아무 흔적 없이 지나가면, 사고가 났을 때 "언제부터" 를 되짚을 수 없다.
  if (done === 0 && blocked === 0 && dryRunLane) return { composed: false, sent: false, reason: '알릴 것 없음' }

  // 🔴 **미해결 PR 로 HOLD 한 회차는 그 PR 을 지목한다** (2026-09-16 재검토).
  //    "막힘 1건" 만 보내면 창업자는 무엇을 merge 해야 하는지 모른다.
  //    로그에만 URL 이 있고 Slack 에 없으면, 그 알림은 읽히지 않는 알림이 된다.
  const holdPr = report.outstanding?.pr ?? null
  if (holdPr) {
    const msg = buildMessage({
      severity: 'INFO',
      title: `매거진 자동 레인 HOLD — 자동 PR #${holdPr.number} 이 열려 있다`,
      reason: `${report.outstanding.code} · merge 또는 명시적 폐기 전 다음 생산 HOLD`,
      next: holdPr.url,
      logPath: report.reportPath ?? null,
    })
    const r = await send(msg, { dryRun: !actuallySend })
    return { composed: true, sent: r.sent, reason: r.reason }
  }

  const severity = blocked > 0 ? 'WARN' : 'INFO'
  const reasons = []
  if (blocked) reasons.push(report.blocked.map((b) => `${b.slug}: ${b.blockedBy[0]?.code ?? '-'}`).join(' / '))
  if (report.outstanding && !report.outstanding.ok) reasons.push(report.outstanding.message)
  if (report.leftOnBranch) reasons.push(`남은 브랜치 ${report.leftOnBranch}`)

  const next = report.pr?.made
    ? report.pr.url
    : dryRunLane
      ? 'dry-run — 등록도 PR 도 하지 않았다'
      : (report.pr ? `PR 실패 — ${report.pr.reason}` : '등록 없음')

  const msg = buildMessage({
    severity,
    title: `매거진 자동 레인 — 등록 ${done}건 · 막힘 ${blocked}건${dryRunLane ? ' (dry-run)' : ''}`,
    reason: reasons.length ? reasons.join(' / ') : null,
    next,
    logPath: report.reportPath ?? null,
  })
  const r = await send(msg, { dryRun: !actuallySend })
  // 🔴 문구를 돌려주지 않는다. webhook·토큰이 섞일 자리를 애초에 만들지 않는다.
  return { composed: true, sent: r.sent, reason: r.reason }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`자동 발행 레인 — 후보 스캔 · 일괄 실행 (등급으로 가르지 않는다)

  node scripts/magazine-auto-register-ready.mjs --dry-run
  node scripts/magazine-auto-register-ready.mjs --dry-run --json
  node scripts/magazine-auto-register-ready.mjs --run YYYY-MM-DD --dry-run
  node scripts/magazine-auto-register-ready.mjs --write --pr
  node scripts/magazine-auto-register-ready.mjs --write --pr --notify-send

  --dry-run       repo 파일 변경 0건 (기본). 리포트 JSON 도 쓰지 않는다
  --write         회수·변환·hero·register 를 실제로 수행 (깨끗한 main 에서만)
  --pr            register write 앞에 PR 브랜치를 만들고, 끝나면 PR (merge 는 자동 관문이 판정)
  --notify        Slack 문구만 만들어 보여준다 (발송 0)
  --notify-send   Slack 실제 발송
  --limit N       한 번에 처리할 최대 건수 (기본 3)
  --run DATE      그날 producer 선정분만 (없으면 큐 전체)
  --json          리포트를 JSON 으로

🔴 gate 는 등급으로 거르지 않는다 — 큐에 없거나 프로필을 정할 수 없는 slug 만 제외된다.
🔴 새벽 dry-run 회차의 감시 기준은 launchd 로그다 (Slack 발송 없음).`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (n) => {
    const i = argv.indexOf(n)
    return i === -1 ? null : argv[i + 1]
  }
  const write = argv.includes('--write')
  if (!write && !argv.includes('--dry-run')) {
    console.error('  --dry-run 또는 --write 를 명시해야 한다')
    process.exit(2)
  }
  const limit = Number(arg('--limit') ?? 3)
  const wantPr = argv.includes('--pr')
  const asJson = argv.includes('--json')
  const wantNotify = argv.includes('--notify') || argv.includes('--notify-send')
  const notifySend = argv.includes('--notify-send')

  const report = {
    generatedAt: new Date().toISOString(),
    kstDate: kstDate(),
    mode: write ? 'write' : 'dry-run',
    lock: null,
    tools: null,
    outstanding: null,
    git: null,
    branch: null,
    done: [],
    blocked: [],
    pr: null,
    returned: null,
    leftOnBranch: null,
    /** 🔴 실제로 프로세스가 끝낸 코드. 복귀 판정 뒤에 채운다 */
    exitCode: null,
  }

  /**
   * 🔴 **회차를 끝내는 자리는 여기 하나다.**
   *    write 회차는 어떤 경로로 끝나든 ① main 복귀 ② lock 해제 ③ Slack ④ 종료코드
   *    를 같은 순서로 거친다. 중간에서 `process.exit` 하던 옛 판은 그 셋을 건너뛰었다.
   */
  let lock = { ok: true, release: () => {} }

  /**
   * 🔴 **우리가 만든 브랜치일 때만 복귀한다.**
   *    이 플래그가 없으면, `NOT_ON_MAIN` 으로 막힌 회차가 "복귀" 하겠다며
   *    사람이 체크아웃해 둔 브랜치를 main 으로 바꿔 버린다.
   *    자동화는 자기가 옮겨 놓은 것만 되돌린다.
   */
  let movedOffMain = false

  const finish = async (exitCode) => {
    if (write && movedOffMain) {
      const back = returnToMain({ exec })
      report.returned = { ok: back.ok, code: back.code, message: back.message }
      if (!back.ok) {
        report.leftOnBranch = back.leftOnBranch
        report.blocked.push({ slug: '(return)', blockedBy: [{ code: back.code, message: back.message }] })
        // 🔴 복귀에 실패하면 그 회차는 실패다. 다음 회차가 NOT_ON_MAIN 으로 멈출 것이기 때문이다.
        exitCode = 1
      }
    }
    lock.release()

    /**
     * 🔴 **report 는 복귀 판정 뒤에 쓴다** (2026-09-26 운영 사고).
     *    앞판은 `finish()` 앞에서 썼다. 그래서 `RETURN_DIRTY` 로 끝난 회차의
     *    report JSON 에 `returned: null · leftOnBranch: null · exitCode: null` 이
     *    남았다 — 로그는 빨간데 파일은 조용한, **서로 다른 두 진실**이 생겼다.
     *    이제 returned·leftOnBranch·최종 blocked·exitCode 가 전부 확정된 뒤에 쓴다.
     */
    report.exitCode = exitCode
    const saved = writeReport(report, { write })
    report.reportPath = saved.path

    if (wantNotify) report.slack = await notifySlack(report, { actuallySend: notifySend, dryRunLane: !write })
    if (asJson) console.log(JSON.stringify(report, null, 2))
    else printHuman(report, { write })
    process.exit(exitCode)
  }

  // ── write 전 안전장치 ────────────────────────────────────
  // 🔴 여기서 막히면 회수도 변환도 register 도 시작하지 않는다.
  let branch = null
  if (write) {
    // ① lock — 같은 레인의 두 회차가 겹치지 않게. producer lock 과는 다른 파일이다.
    lock = acquireLock({ label: 'auto-register' })
    report.lock = { ok: lock.ok, code: lock.code, message: lock.message }
    if (!lock.ok) {
      report.blocked.push({ slug: '(lock)', blockedBy: [{ code: lock.code, message: lock.message }] })
      // 🔴 lock 을 못 잡았으면 main 복귀도 하지 않는다 — 남의 회차가 쓰는 중일 수 있다.
      if (asJson) console.log(JSON.stringify(report, null, 2))
      else printHuman(report, { write })
      process.exit(1)
    }

    // ② 실행 의존성 · 인증 · push 자격 · git 상태 — 🔴 **파일을 하나도 건드리기 전에** 전부 본다.
    //    옛 판은 gh 가 없다는 사실을 commit·push 뒤에 알았다.
    const pf = writePreflight({ exec })
    report.tools = pf.tools
    report.git = pf.git ? { ok: pf.git.ok, branch: pf.git.branch, synced: pf.git.synced, fastForwarded: pf.git.fastForwarded } : null
    if (!pf.ok) {
      report.blocked.push({ slug: `(${pf.stage})`, blockedBy: pf.blockedBy })
      return finish(1)
    }

    // ③ 미해결 자동 작업 — 🔴 **브랜치 생성·원고 회수(AI 호출)보다 앞이다.**
    //
    //    PR 이 아직 merge 되지 않았는데 다음 회차가 돌면, main 의 articles.ts 에는
    //    그 등록이 없으므로 **같은 slug 를 같은 빈 슬롯으로 또 등록**한다.
    //    `register.mjs` 의 중복 가드는 main 만 보므로 이것을 막지 못한다.
    //    producer 와 **같은 함수**를 쓴다 (lib/magazine-outstanding.mjs).
    const out = readOutstanding({ exec })
    report.outstanding = { ok: out.ok, code: out.code, severity: out.severity, message: out.message, pr: out.pr }
    if (!out.ok) {
      report.blocked.push({ slug: '(outstanding)', blockedBy: [{ code: out.code, message: out.message }] })
      // 🔴 HOLD 는 정상이다 — 사람이 PR 을 처리하기를 기다릴 뿐이라 종료 코드 0.
      //    ORPHAN·조회 실패는 운영 이상이므로 non-zero 로 남긴다.
      return finish(out.severity === SEVERITY.HOLD ? 0 : 1)
    }

    // ④ register write 앞에 브랜치를 만든다. 실패하면 아무것도 쓰지 않고 끝난다.
    if (wantPr) {
      const made = createBranch(branchName(), { exec })
      report.branch = made.name
      if (!made.ok) {
        report.blocked.push({ slug: '(branch)', blockedBy: made.blockedBy })
        return finish(1)
      }
      branch = made.name
      movedOffMain = true // 🔴 여기서부터만 복귀가 우리 일이다
    }
  }

  /**
   * 🔴 **여기부터는 무슨 일이 나도 `finish()` 를 지난다.**
   *    앞판은 처리 중 예상 못 한 예외가 나면 그대로 프로세스가 죽었다 —
   *    lock 이 잠긴 채 남고, 작업 브랜치에 선 채로 끝나고, Slack 도 안 나갔다.
   *    다음 회차는 `LOCK_HELD` 와 `NOT_ON_MAIN` 으로 이어서 멈춘다.
   */
  try {
  // ── 처리 ─────────────────────────────────────────────────
  const { scanned, done, blocked, results, registered, ceiling, budgetStop } =
    processCandidates({ write, wantPr, limit, runDate: arg('--run'), report })
  Object.assign(report, {
    source: scanned.source,
    pool: scanned.pool,
    eligible: scanned.eligible.length,
    processed: results.length,
    budget: { limit, ceiling, registered, stoppedBy: budgetStop?.code ?? 'EXHAUSTED', stopMessage: budgetStop?.message ?? '후보를 전부 보았다' },
    done: done.map((r) => ({ slug: r.slug, publishAt: r.publishAt })),
    /**
     * 🔴 **덮어쓰지 않고 이어 붙인다.**
     *    옛 판은 `blocked` 를 후보 결과로 **통째로 교체**했다. 그래서
     *    `processCandidates` 가 넣어 둔 `(ledger) QUARANTINE_UNREADABLE` 가 사라지고,
     *    깨진 장부로 한 건도 못 돌린 회차가 **종료코드 0 (성공)** 으로 끝났다.
     *    "아무 일도 안 한 것" 과 "잘 끝난 것" 은 다르다.
     */
    blocked: [...(report.blocked ?? []), ...blocked.map((r) => ({ slug: r.slug, blockedBy: r.blockedBy }))],
    dryRunOk: results.filter((r) => r.verdict === 'DRY_RUN_OK').map((r) => r.slug),
    dryRunIncomplete: results.filter((r) => r.verdict === 'DRY_RUN_INCOMPLETE').map((r) => r.slug),
    gateSkipped: scanned.skipped.map((s) => ({ slug: s.slug, riskLevel: s.riskLevel, codes: s.blockedBy.map((b) => b.code) })),
    quarantined: scanned.quarantined ?? [],
    steps: results.map((r) => ({ slug: r.slug, verdict: r.verdict, steps: r.steps })),
  })

  if (write && wantPr && branch) {
    report.pr = finishPr(branch, done.map((r) => r.slug))
    // 🔴 **PR 을 못 만든 것은 실패다.** 옛 판은 `report.pr.made === false` 를
    //    조용히 흘려 종료 코드 0 으로 끝냈다 — push 는 됐는데 PR 이 없는 회차가
    //    아무 표시 없이 지나갔다. 등록된 건이 있는데 PR 이 없으면 반드시 시끄러워야 한다.
    if (!report.pr.made && done.length > 0) {
      report.blocked.push({ slug: '(pr)', blockedBy: [{ code: 'PR_NOT_CREATED', message: report.pr.reason }] })
      report.leftOnBranch = branch
    }
  }

  report.results = results

  // 🔴 report 쓰기는 finish() 가 한다 — 복귀 판정까지 담아야 로그와 파일이 같은 말을 한다
  // 🔴 장부를 못 읽은 회차는 반드시 실패다 — 후보가 0건이라 blocked 가 비어도 마찬가지
  return finish(report.blocked.length > 0 || report.ledgerHold ? 1 : 0)
  } catch (err) {
    // 🔴 예외를 삼키지 않는다. 남기고, 정리하고, 실패로 끝낸다.
    report.blocked.push({ slug: '(unexpected)', blockedBy: [{ code: 'UNEXPECTED_ERROR',
      message: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}` }] })
    report.unexpected = { name: err?.name ?? 'Error', message: String(err?.message ?? err),
      stack: String(err?.stack ?? '').split('\n').slice(0, 4).join(' | ') }
    return finish(1)
  }
}

/** 사람이 읽는 출력 — 🔴 로그가 새벽 감시의 유일한 기준이다. 빠뜨리면 안 보인다 */
function printHuman(report, { write }) {
  console.log('')
  console.log(`  매거진 자동 레인 — ${report.mode}${report.source ? ` · 출처 ${report.source}` : ''}`)
  if (report.lock && !report.lock.ok) console.log(`  🔒 ${report.lock.code}: ${report.lock.message}`)
  if (report.outstanding) {
    // 🔴 PR 번호·URL 을 로그에 남긴다. 사람이 그것을 처리해야 다음 회차가 돈다
    const o = report.outstanding
    console.log(`  미해결 자동 작업: ${o.ok ? '없음' : `${o.severity} ${o.code}`}${o.pr ? ` — PR #${o.pr.number} ${o.pr.url}` : ''}`)
    if (!o.ok) console.log(`     ${o.message}`)
  }
  if (report.tools) {
    const missing = Object.entries(report.tools).filter(([, v]) => v === null).map(([k]) => k)
    console.log(`  실행 의존성: ${missing.length === 0 ? '전부 확인' : `🔴 없음 — ${missing.join(', ')}`}`)
  }
  if (report.git) console.log(`  git: ${report.git.branch} · origin/main 동기 ${report.git.synced ? 'OK' : '아니오'}${report.git.fastForwarded ? ' (ff-only 로 따라붙음)' : ''}`)
  if (typeof report.pool === 'number') {
    console.log(`  후보 ${report.pool}건 중 gate 통과 ${report.eligible}건 · 처리 ${report.processed}건`)
    // 🔴 왜 거기서 멈췄는지 로그만 보고 알 수 있어야 한다 — 새벽 감시의 유일한 기준이다
    if (report.budget) {
      console.log(`  예산: 등록 ${report.budget.registered}/${report.budget.limit} · 시도 ${report.processed}/${report.budget.ceiling} — ${report.budget.stopMessage}`)
    }
  }
  if (report.branch) console.log(`  PR 브랜치: ${report.branch} (register write 앞에 생성)`)
  console.log('')
  for (const r of report.results ?? []) {
    const mark = r.verdict === 'BLOCKED' ? '⛔' : r.verdict === 'DONE' ? '✅' : '·'
    console.log(`  ${mark} ${r.slug} — ${r.verdict} (publishAt ${r.publishAt})`)
    for (const s of r.steps) {
      const m = s.status === 'ok' ? '✅' : s.status === 'skip' ? '·' : '⛔'
      console.log(`       ${m} ${s.stage.padEnd(9)} ${s.detail}`)
    }
  }
  if (report.results?.length) console.log('')
  if (report.gateSkipped) {
    const gradeSkipped = report.gateSkipped.filter((s) => s.codes.includes('RISK_LEVEL') || s.codes.includes('AUTO_INELIGIBLE'))
    console.log(`  gate 제외 ${report.gateSkipped.length}건 (등급·민감 사유 ${gradeSkipped.length}건)`)
  }
  if (report.quarantined?.length) {
    // 🔴 비켜 준 후보를 반드시 남긴다. 조용히 빠지면 왜 안 도는지 아무도 모른다
    console.log(`  격리 ${report.quarantined.length}건 (공급을 막지 않게 비켜 둔다)`)
    for (const q of report.quarantined) console.log(`     · ${q.slug} — ${q.message}`)
  }
  if (report.done?.length) console.log(`  등록: ${report.done.map((d) => `${d.slug}(${d.publishAt})`).join(' · ')}`)
  if (report.pr) console.log(`  PR: ${report.pr.made ? report.pr.url : `🔴 만들지 않음 — ${report.pr.reason}`}`)

  // 🔴 막힌 단계를 **이름으로** 남긴다. "BLOCKED 가 있었다" 만으로는 로그에서 원인을 못 찾는다.
  for (const b of report.blocked ?? []) {
    const first = b.blockedBy?.[0]
    console.log(`  ⛔ ${b.slug} — ${first?.code ?? '?'}: ${first?.message ?? ''}`)
  }
  if (write) {
    console.log(`  복귀: ${report.returned ? `${report.returned.code} — ${report.returned.message}` : '필요 없음 — main 을 떠나지 않았다'}`)
    if (report.leftOnBranch) console.log(`  🔴 남은 브랜치: ${report.leftOnBranch} — 사람이 확인한다`)
  }
  if (report.slack) console.log(`  Slack: ${report.slack.sent ? '발송' : `미발송 — ${report.slack.reason}`}`)
  // 🔴 dry-run 은 리포트도 쓰지 않는다. 경로만 찍으면 "썼다" 로 읽힌다
  if (report.reportPath) console.log(`  리포트: ${report.reportPath}${write ? '' : ' (dry-run — 쓰지 않는다)'}`)
  console.log(`  webhook: ${webhookStatus().hint}`)
  console.log('')
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-register-ready.mjs')) main()
