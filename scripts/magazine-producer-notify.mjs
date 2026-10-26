#!/usr/bin/env node
/**
 * producer 실행 결과를 읽어 알릴 것이 있는지 판정한다.
 *
 * 🔴 producer 본체(magazine-producer-plan.mjs)를 수정하지 않는다.
 *    검증이 끝난 스크립트이고, exit code 구조를 건드리면 launchd 동작이 바뀐다.
 *    그래서 판정은 producer 가 남긴 run.json 을 **읽어서** 한다.
 *
 * 🔴 exit code 로는 실패를 알 수 없다.
 *    producer 는 process.exit 를 호출하지 않는다 —
 *    정상 완료 · "이미 COMPLETED" · ABORTED 가 전부 exit 0 이다.
 *    상태가 남는 곳은 run.json 의 status 뿐이다.
 *
 * 판정 규칙
 *   선정 > 0 && brief.md 없음                → ERROR    사람이 brief 를 써야 한다
 *   선정 > 0 && brief 있고 draft.md 없음     → ERROR    회수가 막혔다(ChatGPT 접근)
 *   status === 'ABORTED'                     → ERROR    이전 실행이 죽었다
 *   status === 'PARTIAL'                     → ERROR    도중에 끊겼다
 *   run.json 없음                            → ERROR    01:00 에 안 돌았다
 *   inventoryDays <= 3                       → WARN     재고 바닥
 *   held 에 DIRECT_SPEC 보류가 있다          → WARN     direct 보류 사실을 한 번에 1건으로 (legacy 는 계속)
 *   DIRECT_SPEC 선정 > 0 && draft.md 없음   → ERROR    direct 원고 회수 실패 (brief 와 무관 — legacy 문구와 분리)
 *   selected 0건 && inventoryDays < 7        → WARN     만들 게 없는데 재고도 얕다
 *   그 외 COMPLETED                          → 알림 없음
 *
 * 사용법
 *   node scripts/magazine-producer-notify.mjs --dry-run          판정만. 발송 0
 *   node scripts/magazine-producer-notify.mjs --send             실제 Slack 발송
 *   node scripts/magazine-producer-notify.mjs --dry-run --date 2026-08-25
 *   node scripts/magazine-producer-notify.mjs --dry-run --json
 *
 * 🔴 --dry-run 도 --send 도 없으면 거부한다.
 *    "아무 플래그 없이 실행했더니 Slack 이 나갔다"가 생기지 않게 한다.
 *
 * 🔴 알릴 것이 없으면 아무것도 보내지 않는다.
 *    정상 COMPLETED 는 조용하다 — 매일 오는 알림은 곧 읽히지 않는다.
 *
 * 종료 코드: 알림 대상이 있으면 1, 없으면 0 (launchd 연결 시 판단용)
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { buildMessage, send, webhookStatus, kstNow } from './lib/slack-notify.mjs'
import { composeRepairAlert } from './lib/magazine-producer-flow.mjs'

// repo 는 이 파일 위치로 잡는다 — cwd 를 쓰면 다른 worktree 를 읽는다
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const RUNS_DIR = join(ROOT, 'drafts/magazine/_runs')
const DRAFTS_DIR = join(ROOT, 'drafts/magazine')
const LOG_PATH = join(homedir(), 'Library/Logs/soransoran/magazine-producer.log')

const MIN_DAYS = 7

/** run.held 중 direct 경로 보류 — 조용히 묻히면 canary 가 왜 안 도는지 아무도 모른다 */
export const DIRECT_HOLD_CODES = new Set(['DIRECT_SPEC_SOURCE_NOT_READY', 'UNKNOWN_MAGAZINE_AUTO_MODE', 'G8_ROW_NOT_DIRECT', 'DIRECT_SPEC_SPEC_CONFLICT', 'DIRECT_SPEC_MISSING',
  // 🔴 명시적 개정(supersedes) — 교체 필요(dry-run) · 선언 hash 불일치 · 교체 조건 위반 (2026-10-26)
  'DIRECT_SPEC_SUPERSEDE_REQUIRED', 'DIRECT_SPEC_SUPERSEDE_MISMATCH', 'DIRECT_SPEC_SUPERSEDE_BLOCKED'])
/**
 * 큐 신원 중복 알림 — 몇 행이든 **1건**이다. DIRECT 보류와 섞지 않는다 (producer 공용 큐 계약 위반이다).
 * 🔴 사람이 topic-queue 를 고치기 전에는 그 행들을 만들지 않는다 — 자동 재시도 · legacy 강등 없음.
 */
export function composeQueueIdentityAlert(run) {
  const rows = (run?.held ?? []).filter((h) => h?.code === 'QUEUE_IDENTITY_DUPLICATE')
  if (!rows.length) return null
  const shown = rows.slice(0, 8).map((h) => `day ${h.day} ${h.slug}${h.intentId ? `(${h.intentId})` : ''}`).join(' / ')
  return {
    severity: 'ERROR',
    title: `매거진 queue 신원 중복 ${rows.length}행 — 해당 행 선정·생산 0`,
    reason: `${shown}${rows.length > 8 ? ` 외 ${rows.length - 8}행` : ''}`,
    next: 'drafts/magazine/topic-queue.ts 에서 같은 slug·intentId 행을 사람이 하나로 정리한다 — 자동 재시도·legacy 강등 없음',
  }
}
const isDirectRow = (x) => Boolean(x && typeof x === 'object' && (x.directSpec || x.directSpecMode === 'DIRECT_SPEC_V1'))

/**
 * direct 보류 알림 — **몇 건이든 알림 1건**이다. slug · 코드 · 차단 사유 · 기대/관측 판만 싣는다 (원문 0).
 * 🔴 legacy 대체 후보는 이미 처리됐다 — 이 알림은 회차를 실패로 바꾸지 않는다.
 */
export function composeDirectHoldAlert(run) {
  const holds = (run?.held ?? []).filter((h) => DIRECT_HOLD_CODES.has(h?.code))
  if (!holds.length) return null
  const shown = holds.slice(0, 6).map((h) => {
    const e = h.directSpec
    return `${h.slug} ${h.code}${e ? ` [${(e.blockers ?? []).join(',')}] expected ${e.expectedGraphVersion ?? '-'} · observed ${e.observedGraphVersion ?? '-'}${e.missingFields?.length ? ` · missing ${e.missingFields.length}` : ''}` : ''}`
  }).join(' / ')
  const codes = new Set(holds.map((h) => h.code))
  const next = []
  if (codes.has('DIRECT_SPEC_SOURCE_NOT_READY')) {
    const p = holds.find((h) => h.directSpec?.sourcePath)?.directSpec.sourcePath
    next.push(`승인 source 를 확인한다${p ? ` (${p})` : ''} — 현재 판 graphVersion · APPROVED · sourceHash · G8 manifest`)
  }
  if (codes.has('DIRECT_SPEC_MISSING')) next.push('재사용 폴더에 article-spec.json 이 없다 — 자동으로 만들지 않는다. 폴더의 출처(legacy 원고 여부)를 확인한다')
  if (codes.has('DIRECT_SPEC_SUPERSEDE_MISMATCH')) next.push('승인 entry 의 supersedes.specHash 가 디스크 article-spec.json 과 다르다 — 무엇을 대체하는지 사람이 확인한다 · 덮어쓰지 않았다')
  if (codes.has('DIRECT_SPEC_SUPERSEDE_BLOCKED')) {
    const p = holds.find((h) => h.code === 'DIRECT_SPEC_SUPERSEDE_BLOCKED')?.directSpec?.supersede?.problems ?? []
    next.push(`명시적 개정 조건 위반(${p.join(',') || '-'}) — 옛 spec 을 바꾸지 않았다. draft · 전송 · 등록 흔적과 신원을 확인한다`)
  }
  if (codes.has('DIRECT_SPEC_SPEC_CONFLICT')) next.push('drafts/magazine/{slug}/article-spec.json 과 승인 source 컴파일 결과를 대조한다 — 덮어쓰지 않았다')
  if (codes.has('UNKNOWN_MAGAZINE_AUTO_MODE')) next.push('topic-queue 의 directSpecMode 값을 고친다 (DIRECT_SPEC_V1 · LEGACY_BRIEF_V1 만 허용)')
  if (codes.has('G8_ROW_NOT_DIRECT')) next.push('G8 행(g8ManifestHash · articlePlanHash)은 ArticlePlan materialize 로만 만든다 — 손으로 고친 행이면 승인 source 와 대조한다')
  return {
    severity: 'WARN',
    title: `매거진 DIRECT_SPEC 보류 ${holds.length}건 — 전송·등록 0 · legacy 후보는 계속 처리했다`,
    reason: `${shown}${holds.length > 6 ? ` 외 ${holds.length - 6}건` : ''}`,
    next: next.join(' · '),
  }
}
const CRITICAL_DAYS = 3

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
function kstDate(ms = Date.now()) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 알릴 것을 고른다. 여러 개면 전부 돌려준다 — 재고 경고와 ABORTED 는 함께 날 수 있다.
 * 🔴 메시지에 큐 전문·원고·개인정보를 넣지 않는다. 숫자와 상태만 넣는다.
 */
export function judge({ date, run, runExists, repair = null, draftsDir = DRAFTS_DIR }) {
  const alerts = []
  // 🔴 입력 수리 미해결 — run.json 과 무관하게 같은 알림 회차에 싣는다 (producer 가 넘긴 요약)
  const repairAlert = composeRepairAlert(repair)
  if (repairAlert) alerts.push(repairAlert)

  if (!runExists) {
    alerts.push({
      severity: 'ERROR',
      title: '매거진 producer 가 실행되지 않았다',
      reason: `${date} run.json 이 없다`,
      next: 'launchctl print gui/$(id -u)/com.soransoran.magazine-producer 로 등록·마지막 종료코드를 본다',
    })
    return alerts
  }

  if (run.status === 'ABORTED') {
    alerts.push({
      severity: 'ERROR',
      title: '매거진 producer 비정상 종료',
      reason: run.abortReason ?? '이전 실행이 끊겼다(lock 잔존). 재시도하지 않는다',
      next: '오늘은 작업 패키지가 없다. 원인 확인 후 수동 실행하거나 다음 날을 기다린다',
    })
  } else if (run.status === 'PARTIAL') {
    const written = (run.selected ?? []).filter((s) => s.packageWritten).length
    alerts.push({
      severity: 'ERROR',
      title: '매거진 producer 가 도중에 끊겼다',
      reason: `선정 ${run.selected?.length ?? 0}건 중 ${written}건까지 패키지 생성`,
      next: '_runs 를 확인하고 이어서 처리할지 판단한다',
    })
  }

  const days = run.inventoryDays
  const selected = run.selected?.length ?? 0

  if (typeof days === 'number' && days <= CRITICAL_DAYS) {
    alerts.push({
      severity: 'WARN',
      title: '매거진 예약 재고 바닥',
      reason: `재고 ${days}일 (최소 ${MIN_DAYS}일 · 목표 14일)`,
      next: '오늘 작업 패키지로 제작을 진행한다',
    })
  }

  // 선정은 됐는데 원고가 안 만들어진 경우 — 회수 단계가 막혔다는 뜻이다.
  //
  // 🔴 원인을 둘로 나눈다. 조치가 완전히 다르기 때문이다.
  //    2026-08-26 첫 무인 실행에서 선정 3건이 전부 brief_missing 이었는데,
  //    알림은 "ChatGPT 접근 상태를 본다" 로 나갔다. probe 를 돌려도 원인이 안 나온다.
  //    brief 를 쓰는 것은 사람 몫이고(§13.1), ChatGPT 접근과는 무관한 단계다.
  //
  // 판정 기준은 runner 의 fetchSlug 와 같다(magazine-webui-runner.mjs):
  //    draft.md 있음        → 이미 끝난 건. 여기서 세지 않는다
  //    brief.md 없음        → brief_missing. 회수를 시도조차 하지 않았다
  //    brief 는 있는데 없음 → 회수가 시도됐으나 원고를 못 받았다
  //
  // 🔴 needsFullReview 는 HIGH review lane 이다. 이 레인은 brief.md/draft.md 정본을
  //    자동 회수하지 않고, _runs/{date}/selected/{slug}/*.todo.md 까지만 만든다.
  //    따라서 brief_missing/fetchFailed 에 섞으면 정상 HIGH 패킷을 ERROR 로 오판한다.
  const identityAlert = composeQueueIdentityAlert(run)
  if (identityAlert) alerts.push(identityAlert)
  const directHold = composeDirectHoldAlert(run)
  if (directHold) alerts.push(directHold)

  /**
   * 🔴 **direct 원고 미생성은 reusable 까지 본다** (2026-10-15 Codex P1).
   *    run.reusable 의 direct 행도 실제 회수(provider) 대상이다. selected 와 같은 slug 면 한 번만 센다.
   *    legacy 판정은 지금까지처럼 selected 만 본다 — legacy 알림 객체·문구 불변.
   */
  const toRow = (x) => (typeof x === 'string' ? { slug: x, needsFullReview: false } : x)
  const seenDirect = new Set()
  const directMissing = [...(run.selected ?? []), ...(run.reusable ?? [])]
    .map(toRow)
    .filter((x) => x?.slug && isDirectRow(x) && !seenDirect.has(x.slug) && seenDirect.add(x.slug))
    .filter((x) => !existsSync(join(draftsDir, x.slug, 'draft.md')))
    .map((x) => x.slug)
  if (directMissing.length) {
    const noSpec = directMissing.filter((slug) => !existsSync(join(draftsDir, slug, 'article-spec.json')))
    alerts.push({
      severity: 'ERROR',
      title: '매거진 DIRECT_SPEC 원고가 만들어지지 않았다',
      reason: `DIRECT_SPEC 대상 ${directMissing.length}건에 draft.md 가 없다${noSpec.length ? ` · article-spec.json 도 없다 ${noSpec.length}건` : ''} — brief 와 무관하다`,
      next: noSpec.length
        ? 'producer 의 source 관문·spec 저장을 본다 (run.json directSpec · held) — brief 를 쓰지 않는다'
        : 'ChatGPT 접근 상태를 본다 — node scripts/magazine-webui-runner.mjs --dry-run --probe (article-spec.json 은 있다)',
    })
  }

  if (selected > 0) {
    const rows = (run.selected ?? [])
      .map(toRow)
      // 🔴 needsFullReview 로 자동 진행 목록에서 빼지 않는다 (M3-A)
      .filter((x) => x?.slug)
      .filter((x) => !existsSync(join(draftsDir, x.slug, 'draft.md')))
    // 🔴 DIRECT_SPEC_V1 행에는 brief 가 없는 것이 정상이다 — "brief 를 채워라" 로 오보하지 않는다
    const missing = rows.filter((x) => !isDirectRow(x)).map((x) => x.slug)

    const briefMissing = missing.filter((slug) => !existsSync(join(draftsDir, slug, 'brief.md')))
    const fetchFailed = missing.filter((slug) => existsSync(join(draftsDir, slug, 'brief.md')))

    if (briefMissing.length) {
      alerts.push({
        severity: 'ERROR',
        title: '매거진 brief 가 아직 없다',
        reason: `선정 ${selected}건 중 ${briefMissing.length}건에 brief.md 가 없다 — 원고 회수를 시도하지 않았다`,
        next: `_runs/${date}/selected/{slug}/brief.todo.md 의 TODO 를 채워 drafts/magazine/{slug}/brief.md 로 저장한다`,
      })
    }

    if (fetchFailed.length) {
      alerts.push({
        severity: 'ERROR',
        title: '매거진 원고가 만들어지지 않았다',
        reason: `brief 는 있는데 ${fetchFailed.length}건에 draft.md 가 없다`,
        next: 'ChatGPT 접근 상태를 본다 — node scripts/magazine-webui-runner.mjs --dry-run --probe',
      })
    }
  }

  if (selected === 0 && typeof days === 'number' && days < MIN_DAYS) {
    alerts.push({
      severity: 'WARN',
      title: '만들 항목이 없는데 재고가 얕다',
      reason: `선정 0건 · 재고 ${days}일 · 제외 ${run.skipped?.length ?? 0}건`,
      next: 'topic-queue 에 autoEligible 항목이 남았는지, publishWindow 가 막고 있는지 본다',
    })
  }

  return alerts
}

function loadRun(date) {
  const p = join(RUNS_DIR, date, 'run.json')
  if (!existsSync(p)) return { runExists: false, run: null, path: p }
  try {
    return { runExists: true, run: JSON.parse(readFileSync(p, 'utf8')), path: p }
  } catch (err) {
    // 깨진 run.json 도 알릴 거리다 — 조용히 넘기지 않는다
    return { runExists: true, run: { status: 'PARTIAL', selected: [], skipped: [] }, path: p, broken: String(err.message).slice(0, 80) }
  }
}

function help() {
  console.log(`producer 결과 판정 → Slack 알림 (dry-run)

  node scripts/magazine-producer-notify.mjs --dry-run          판정만. 발송 0
  node scripts/magazine-producer-notify.mjs --send             실제 Slack 발송
  node scripts/magazine-producer-notify.mjs --dry-run --date YYYY-MM-DD
  node scripts/magazine-producer-notify.mjs --dry-run --json

판정
  ABORTED / PARTIAL / run.json 없음   → ERROR
  재고 <= ${CRITICAL_DAYS}일                       → WARN
  선정 0건 + 재고 < ${MIN_DAYS}일             → WARN
  그 외 COMPLETED                     → 알림 없음

🔴 producer 본체를 수정하지 않는다. run.json 을 읽기만 한다.
🔴 --dry-run 도 --send 도 없으면 거부한다.
🔴 알릴 것이 없으면 --send 여도 아무것도 보내지 않는다.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const wantSend = argv.includes('--send')
  const dryRun = argv.includes('--dry-run') || !wantSend
  if (!argv.includes('--dry-run') && !wantSend) {
    console.error('  --dry-run 또는 --send 가 필요하다.')
    process.exit(2)
  }

  const di = argv.indexOf('--date')
  const date = di !== -1 && argv[di + 1] ? argv[di + 1] : kstDate()
  const { run, runExists, path, broken } = loadRun(date)
  // 🔴 producer 가 넘긴 입력 수리 요약 (JSON). 깨졌으면 그 자체가 알릴 거리다
  const ri = argv.indexOf('--input-repair-summary')
  let repair = null
  if (ri !== -1) {
    try { repair = JSON.parse(argv[ri + 1] ?? '') } catch { repair = { failures: [{ slug: null, outcome: 'REPAIR_SUMMARY_UNREADABLE' }], resultFile: null } }
  }
  const alerts = judge({ date, run, runExists, repair })

  const messages = alerts.map((a) => buildMessage(a))

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ date, runExists, status: run?.status ?? null, alerts, broken: broken ?? null }, null, 2))
  } else {
    const s = webhookStatus()
    console.log('')
    console.log(`  producer 알림 판정 — ${date}`)
    console.log(`  run.json : ${runExists ? path.replace(ROOT + '/', '') : '없음'}${broken ? ` (파싱 실패: ${broken})` : ''}`)
    if (runExists && run) {
      console.log(`  상태     : ${run.status} · 재고 ${run.inventoryDays}일 · 선정 ${run.selected?.length ?? 0}건`)
    }
    console.log(`  webhook  : ${s.hint}`)
    console.log('')
    if (!messages.length) {
      console.log('  ✅ 알림 없음 — 알릴 만한 것이 없다')
    } else {
      console.log(`  ${dryRun ? '[dry-run] 발송하지 않는다. ' : ''}알림 ${messages.length}건:`)
      for (const m of messages) {
        console.log('  ───────────────────────────────')
        console.log(m.text.split('\n').map((l) => '  ' + l).join('\n'))
      }
      console.log('  ───────────────────────────────')
      console.log(`  로그: ${LOG_PATH}`)
    }
    console.log('')
  }

  // 🔴 알릴 것이 없으면 --send 여도 보내지 않는다. 정상 실행은 조용해야 한다.
  if (!dryRun && messages.length) {
    for (const m of messages) {
      // send() 는 throw 하지 않는다. Slack 이 안 되더라도 여기서 멈추지 않는다.
      const r = await send(m, { dryRun: false })
      console.log(`  전송: ${r.sent ? 'ok' : '실패(' + r.reason + ')'}`)
    }
  }

  process.exit(alerts.length ? 1 : 0)
}

// 모듈로 import 될 때는 CLI 를 돌리지 않는다.
// (judge 만 떼어 쓰려는 곳에서 process.exit 가 터지면 안 된다)
if (process.argv[1] && process.argv[1].endsWith('magazine-producer-notify.mjs')) main()
