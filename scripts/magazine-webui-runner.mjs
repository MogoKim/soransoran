#!/usr/bin/env node
/**
 * ChatGPT web UI runner — brief.md 를 넘기고 원고(draft.md)를 받아 온다.
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   producer ──▶ [webui runner] ──▶ md-to-draft ──▶ batch-qa ──▶ register ──▶ PR
 *                 ↑ 여기
 *
 * ⚠️ 이 주석은 한 번 사실과 어긋난 적이 있다.
 *    원고 회수가 구현된 뒤에도 "이번 단계에서는 원고를 만들지 않는다 · 코드가 아예 없다" 가
 *    그대로 남아 있었다. 그 문장을 읽고 "미구현" 으로 판정한 감사가 실제로 나왔다.
 *    **동작을 바꾸면 이 머리말부터 고친다.**
 *
 * 🔴 여기서 하는 것
 *    전송 판정(장부 지문 HOLD) · 접근 판정(probe) · brief 본문 삽입 · 전송 · 응답 대기 ·
 *    관문 통과 시 draft.md 저장.
 *
 * 🔴 전송 판정은 `fetchSlug` 안의 `deliveryGate` 하나다 — 일괄 회수·단건·재생성이 모두 지난다.
 *    HOLD 면 probe 도 Chrome 기동도 send 도 하지 않는다 (2026-09-28).
 * 🔴 CLI 시험의 브라우저·spawn 주입은 `SORAN_MAGAZINE_TEST_MODE=1` 에서만 받는다
 *    (`lib/magazine-test-harness.mjs`). 운영에서 주입값이 보이면 exit 2.
 *
 * 🔴 여기서 하지 않는 것
 *    md-to-draft · batch-qa · hero · register · PR · Slack 발송.
 *    draft.md 까지가 종점이다. articles.ts 와 topic-queue.ts 를 건드리지 않는다.
 *
 * 🔴 관문을 통과하지 못한 원고는 저장하지 않는다 (lib/magazine-manuscript-guard.mjs).
 *    빈 원고 · 너무 짧은 원고 · 한국어가 아닌 원고 · 생성기 흔적이 남은 원고는
 *    파일이 되지 않는다. 실제로 ChatGPT 인용 마커가 새어 production 까지 간 적이 있다.
 *
 * 🔴 headed 로만 돈다.
 *    headless 는 Cloudflare 가 403 으로 막는다(7-D-12 시험 5조합에서 확인).
 *    창은 화면 밖으로 보내므로 보이지 않지만, 맥이 잠들면 실패한다.
 *
 * 사용법
 *   node scripts/magazine-webui-runner.mjs --dry-run            대상만 보여준다 (브라우저 안 띄움)
 *   node scripts/magazine-webui-runner.mjs --dry-run --probe    ChatGPT 접근 상태까지 확인
 *   node scripts/magazine-webui-runner.mjs --login              로그인용 창을 열어 둔다 (사람이 1회)
 *   node scripts/magazine-webui-runner.mjs --dry-run --json
 *
 * 종료 코드: 접근 불가면 1, 아니면 0
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** RFC 4122 형태의 UUID (버전·변형 자리까지 본다) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
import { ROOT, DRAFTS_DIR, loadQueue } from './lib/magazine-load.mjs'
import { validateManuscript, describeReasons } from './lib/magazine-manuscript-guard.mjs'
import {
  probe, fetchManuscript, recoverManuscript, isFatal, browserAvailable, profileExists, profileInUse, cdpAvailable,
  chromeArgs, CHROME_APP, CDP_PORT,
  STATUS, SEVERITY, MESSAGE, PROFILE_DIR, PROFILE_SETUP_GUIDE, buildManuscriptMessage,
  verifyAutomationProfile,
} from './lib/chatgpt-session.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { classifyFailure } from './lib/magazine-failure-kind.mjs'
import { ensureAutomationProfile, MARKER_FILE } from './lib/chatgpt-automation-profile.mjs'
import { readRunTargets, materialState, fetchTargets } from './lib/magazine-run-targets.mjs'
import {
  readQuarantine, updateQuarantine, deliveryFingerprintOf, deliveryHoldsFetch,
  recordDelivery, QUARANTINE_PATH, DELIVERY_HOLD_REASON,
  reserveDelivery, releaseDeliveryReservation, regenBudget, REGEN_EXHAUSTED_REASON,
  acquireManuscriptLease, MANUSCRIPT_IN_PROGRESS_REASON,
} from './lib/magazine-quarantine.mjs'
import { writeFetchResults, readFetchResults, fetchResultFor, fetchResultPath, todayKst, readRunFetchState } from './lib/magazine-fetch-result.mjs'
import { loadTestHarness } from './lib/magazine-test-harness.mjs'
import { manuscriptPromptText, plannedMessageFor, deliveryGate } from './lib/magazine-delivery-gate.mjs'
import { packetHashOf } from './lib/magazine-regen.mjs'

/** 🔴 정본은 `lib/magazine-delivery-gate.mjs` 다 — 기존 호출부·시험을 위해 그대로 내보낸다 */
export { manuscriptPromptText, plannedMessageFor, deliveryGate }

const RUNS_DIR = join(DRAFTS_DIR, '_runs')

/** producer 산출물을 읽는다. 없으면 없다고만 한다 — 이 스크립트가 만들지 않는다 */
function loadRun(date, draftsDir = DRAFTS_DIR) {
  const file = join(draftsDir, '_runs', date, 'run.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 대상별로 무엇이 준비됐는지 본다. 원고가 이미 있으면 다시 만들 필요가 없다.
 *
 * 🔴 **`selected` 만 보지 않는다** (2026-09-28 공급 0건).
 *    `reusable` 을 빼고 읽으면 재료 17건이 있는 날에도 회수 대상 0건이 된다.
 *    대상 계약은 `magazine-run-targets.mjs` 하나다 — 등록 경로와 같은 것을 쓴다.
 */
function inspectTargets(run, date, draftsDir = DRAFTS_DIR) {
  const r = readRunTargets({ draftsDir, date })
  // 🔴 모르는 판이면 옛 목록으로도 되돌아가지 않는다 — 대상 0 (fail-closed · 전송 0)
  if (r.failClosed) {
    console.log(`  ⛔ ${r.code} — ${r.why}`)
    return []
  }
  const rows = r.ok
    ? r.targets
    // 🔴 run.json 을 못 읽었으면 넘겨받은 객체로라도 본다 — 조용히 0건으로 끝내지 않는다
    : [...(run?.selected ?? []), ...(run?.reusable ?? [])]
      .map((x) => (typeof x === 'string' ? x : x?.slug)).filter(Boolean)
      .map((slug) => ({ slug, origin: 'selected', material: materialState(join(draftsDir, slug)) }))
  const seen = new Set()
  /**
   * 🔴 **`material` 을 펴서 버리지 않는다.** 계약 함수(`fetchTargets`)는 `t.material.stage`
   *    를 읽는다 — 평평하게 펴 버리면 조용히 0건이 된다. 표시용 필드만 덧붙인다.
   */
  return rows.filter((t) => !seen.has(t.slug) && seen.add(t.slug)).map((t) => ({
    slug: t.slug,
    origin: t.origin,
    material: t.material,
    brief: t.material.brief,
    review: t.material.review,
    draftMd: t.material.draftMd,
    articleDraft: t.material.articleTs,
    stage: t.material.stage,
  }))
}

function nextActionFor(t) {
  if (t.articleDraft) return '완료 — 이미 변환됨'
  if (t.draftMd) return 'md-to-draft 대기'
  if (!t.brief || !t.review) return 'brief/review 미작성 — 세션이 채워야 한다'
  return 'ChatGPT 원고 필요 — --fetch <slug> 또는 --fetch-run 이 회수한다'
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`ChatGPT web UI runner — 구조·접근 판정 단계

  node scripts/magazine-webui-runner.mjs --dry-run           대상만 보여준다
  node scripts/magazine-webui-runner.mjs --dry-run --probe   ChatGPT 접근 상태까지
  node scripts/magazine-webui-runner.mjs --dry-run --probe --auto-start
                                                             CDP 없으면 Chrome 을 직접 띄운다 (무인용)
  node scripts/magazine-webui-runner.mjs --login             전용 Chrome 을 띄운다 (닫지 말 것)
  node scripts/magazine-webui-runner.mjs --fetch <slug>      한 건 회수
  node scripts/magazine-webui-runner.mjs --fetch <slug> --force
  node scripts/magazine-webui-runner.mjs --fetch <slug> --force --regen-packet <경로> --draft-out <임시 경로>
                                                             🔴 QA 실패 패킷을 같이 보낸다 (자동 재생성)
                                                             이미 있는 draft.md 를 덮어쓴다 (사람이 켠다)
  node scripts/magazine-webui-runner.mjs --fetch-run --dry-run
                                                             오늘 selected 순회 계획만 (전송 0건)
  node scripts/magazine-webui-runner.mjs --fetch-run [--limit N]
                                                             오늘 selected 를 순회하며 회수
  node scripts/magazine-webui-runner.mjs --status            큐 전체의 단계별 상태 (전송 0건)
  node scripts/magazine-webui-runner.mjs --status --json
  node scripts/magazine-webui-runner.mjs --dry-run --json

🔴 --fetch 는 draft.md 까지만 만든다. md-to-draft·batch-qa·register 는 돌리지 않는다.
🔴 관문(lib/magazine-manuscript-guard.mjs)을 통과하지 못하면 저장하지 않는다.
🔴 --force 는 일괄 회수(--fetch-run)에 적용되지 않는다. 한 건씩만 덮어쓴다.
🔴 headed 로만 돈다 — headless 는 Cloudflare 가 막는다.
🔴 Slack 을 보내지 않는다. 알림 등급만 계산해 반환한다.
🔴 --login 은 Playwright 가 아니라 일반 Chrome 을 CDP 포트로 띄운다.
🔴 그 창을 닫지 마라 — probe 는 떠 있는 Chrome 에 붙기만 한다.
   Playwright 가 프로필을 직접 열면 세션 쿠키가 지워진다(실측 42개 → 8개).`)
}

/**
 * 전용 Chrome 을 띄운다 — **Playwright 를 쓰지 않는다.**
 *
 * 🔴 Playwright 가 프로필을 직접 열면 세션 쿠키가 지워진다.
 *    키체인(Chrome Safe Storage) 접근이 막혀 암호화 쿠키를 무효로 보고 정리한다.
 *    실측: 로그인 직후 42개 → probe 1회 후 8개.
 *    그래서 브라우저는 평범한 Chrome 으로 띄우고, probe 는 CDP 로 **붙기만** 한다.
 *
 * 🔴 이 창을 닫지 않는다. 닫으면 probe 가 붙을 대상이 없다.
 * 🔴 --no-sandbox 도 --enable-automation 도 넘기지 않는다.
 * 🔴 프로필을 복사하지 않는다. 창업자의 평소 Chrome 프로필은 건드리지 않는다.
 */
export async function login({
  /**
   * 🔴 주입점은 CLI 에서 `SORAN_MAGAZINE_TEST_MODE=1` 일 때만 채워진다.
   *    운영에서는 비어 있어 아래 기본값(실제 Chrome 경로·실제 CDP·실제 spawn)이 돈다.
   */
  browserAvailable: browserAvailableFn = browserAvailable,
  cdpAvailable: cdpAvailableFn = cdpAvailable,
  verifyProfileFn = verifyAutomationProfile,
  profileInUse: profileInUseFn = profileInUse,
  spawn: spawnFn = spawn,
} = {}) {
  if (!browserAvailableFn()) {
    console.error(`  ⛔ ${MESSAGE[STATUS.BROWSER_MISSING]}`)
    process.exit(1)
  }
  /**
   * 🔴 **표식을 만드는 곳은 여기 하나다** (2026-09-28 · P0-1).
   *    자동 실행이 표식을 만들어 주면 "확인했다" 가 아니라 "덮어썼다" 가 된다 —
   *    엉뚱한 폴더에 도장을 찍고 통과시키는 셈이다.
   *    사람이 명시적으로 `--login` 을 칠 때만 만든다.
   */
  const made = ensureAutomationProfile({ profileDir: PROFILE_DIR, port: CDP_PORT })
  if (!made.ok) {
    console.error('')
    console.error(`  ⛔ ${made.code} — ${made.why}`)
    console.error('')
    process.exit(1)
  }
  console.log('')
  console.log(`  자동화 전용 프로필 준비 — ${PROFILE_DIR}`)
  console.log(`    용도 표식 ${MARKER_FILE} (0600) · 폴더 0700 · 포트 ${CDP_PORT}`)

  if (await cdpAvailableFn()) {
    /**
     * 🔴 **이미 떠 있으면 주인을 확인한 뒤에만 쓴다.** 포트가 열려 있다는 것은
     *    누군가 쓰고 있다는 뜻일 뿐, 그게 우리 창이라는 뜻이 아니다.
     *    로그인 중에는 `auth.openai.com` 까지만 봐준다.
     */
    const id = await verifyProfileFn({ mode: 'login', requireRunning: true })
    if (!id.ok) {
      console.error('')
      console.error(`  ⛔ ${id.code} — ${id.why}`)
      console.error(`     포트 ${CDP_PORT} 를 쓰는 창이 자동화 전용 창이 아니다. 그 창은 건드리지 않는다.`)
      console.error('     다른 프로그램이 그 포트를 쓰고 있다면 그것을 먼저 정리해야 한다.')
      console.error('')
      process.exit(1)
    }
    console.log('')
    console.log(`  이미 전용 Chrome 이 CDP 포트 ${CDP_PORT} 로 떠 있습니다 (주인 확인됨).`)
    console.log('  그 창에서 로그인하면 됩니다. 새로 띄우지 않습니다.')
    console.log('')
    return
  }
  if (profileInUseFn()) {
    console.error('')
    console.error('  ⛔ 전용 Chrome 이 CDP 포트 없이 떠 있습니다.')
    console.error('     그 창을 닫고 다시 --login 을 실행해야 probe 가 붙을 수 있습니다.')
    console.error('')
    process.exit(1)
  }

  // 🔴 폴더·권한·표식은 위 ensureAutomationProfile 이 이미 맞춰 뒀다 (0700 · 0600)

  console.log('')
  console.log(`  전용 Chrome 을 띄웁니다 (일반 Chrome · CDP 포트 ${CDP_PORT}).`)
  console.log(`  프로필: ${PROFILE_DIR}`)
  console.log('')
  console.log('  1. ChatGPT 에 로그인하세요')
  console.log('  2. "나만의 Chrome 만들기" 팝업이 뜨면 "계정 없이 Chrome 사용" 을 누르세요')
  console.log('  3. 🔴 창을 닫지 마세요 — probe 가 이 창에 붙습니다')
  console.log('  4. node scripts/magazine-webui-runner.mjs --dry-run --probe')
  console.log('')

  const child = spawnFn(CHROME_APP, chromeArgs(), { detached: true, stdio: 'ignore' })
  child?.unref?.()

  console.log('  창을 띄웠습니다. 이 명령은 여기서 끝납니다.')
  console.log('')
}

/**
 * 한 건의 원고를 받아 draft.md 로 저장한다.
 *
 * 🔴 이미 draft.md 가 있으면 전송하지 않는다. 재실행이 원고를 날리면 안 된다.
 * 🔴 brief 가 없으면 만들지 않는다 — 지시서는 세션이 쓴다(§13.1).
 */
/** 🔴 패킷 계약 — 이 판만 받는다 */
export const REGEN_PACKET_SCHEMA = 'regen-packet/3'

/**
 * 🔴 `--regen-packet` **인자 자체**를 검사한다.
 *    옵션을 쓰지 않았으면 `path: null` 로 정상. 썼는데 값이 없으면 실패다.
 *
 * @returns {{ok:true, path:string|null}|{ok:false, code:string, why:string}}
 */
export function readPathArg(argv, flag, code = `${flag.replace(/^--/, '').toUpperCase().replace(/-/g, '_')}_PATH_MISSING`) {
  const i = argv.indexOf(flag)
  if (i === -1) return { ok: true, path: null }
  const next = argv[i + 1]
  if (next === undefined || next === null || String(next).trim() === '') {
    return { ok: false, code, why: `${flag} 뒤에 경로가 없다` }
  }
  if (String(next).startsWith('--')) {
    return { ok: false, code, why: `${flag} 뒤가 경로가 아니라 다른 옵션이다: ${next}` }
  }
  return { ok: true, path: String(next) }
}

export function readRegenPacketArg(argv) {
  return readPathArg(argv, '--regen-packet', 'REGEN_PACKET_PATH_MISSING')
}

/**
 * 🔴 **재생성 패킷** — QA 가 무엇에 걸렸는지 같은 프롬프트에 덧붙인다.
 *    새 경로도 새 API 도 만들지 않는다. 쓰던 ChatGPT 대화에 **한 문단 더** 넣을 뿐이다.
 *
 * 🔴 **fail-closed 다.** 옛 판은 읽지 못한 패킷을 `null` 로 바꿔 **일반 생성으로 그냥 진행**했다.
 *    그러면 "실패를 고쳐 다시 써라" 가 사라진 채 같은 원고가 다시 나오고,
 *    재생성 횟수만 한 번 줄어든다. 게다가 **다른 slug 의 패킷**도 그대로 실렸다.
 *    옵션을 명시했는데 패킷이 성하지 않으면 **한 글자도 보내지 않고 멈춘다.**
 *
 * @returns {{ok:true, packet:object}|{ok:false, code:string, why:string}}
 */
export function readRegenPacket(packetPath, slug) {
  if (!packetPath) return { ok: false, code: 'REGEN_PACKET_PATH_MISSING', why: '--regen-packet 경로가 비었다' }
  if (!existsSync(packetPath)) {
    return { ok: false, code: 'REGEN_PACKET_NOT_FOUND', why: `패킷 파일이 없다: ${packetPath}` }
  }
  let raw
  try { raw = readFileSync(packetPath, 'utf8') }
  catch (e) { return { ok: false, code: 'REGEN_PACKET_UNREADABLE', why: `패킷을 읽지 못했다: ${e.message}` } }
  let packet
  try { packet = JSON.parse(raw) }
  catch (e) { return { ok: false, code: 'REGEN_PACKET_BAD_JSON', why: `패킷이 JSON 이 아니다: ${e.message}` } }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { ok: false, code: 'REGEN_PACKET_BAD_JSON', why: '패킷이 객체가 아니다' }
  }
  if (packet.schemaVersion !== REGEN_PACKET_SCHEMA) {
    return { ok: false, code: 'REGEN_PACKET_SCHEMA',
      why: `패킷 판이 다르다 (${String(packet.schemaVersion)} ≠ ${REGEN_PACKET_SCHEMA})` }
  }
  if (typeof packet.instruction !== 'string' || !packet.instruction.trim()) {
    return { ok: false, code: 'REGEN_PACKET_NO_INSTRUCTION', why: '패킷에 instruction 이 없다' }
  }
  if (!Array.isArray(packet.failures) || packet.failures.length === 0) {
    return { ok: false, code: 'REGEN_PACKET_NO_FAILURES', why: '패킷에 failures 가 없다 — 고칠 대상이 없다' }
  }
  if (slug && packet.slug !== slug) {
    return { ok: false, code: 'REGEN_PACKET_SLUG_MISMATCH',
      why: `🔴 패킷의 slug 가 다르다 (${String(packet.slug)} ≠ ${slug}) — 남의 지적을 이 글에 보내지 않는다` }
  }
  /**
   * 🔴 **attemptId 는 필수 UUID 다** (regen-packet/3 · 2026-09-28 · Codex P1).
   *    이 값이 lease 소유권·regenCalls 의 자기 몫·패킷 파일 이름을 잇는다. 없거나 틀리면
   *    "누구의 시도인가" 를 가릴 수 없으므로 **아무것도 시작하지 않는다.**
   *    파일 이름(`<slug>.<attemptId>.json`)과 본문이 다르면 남의 패킷을 집은 것이다.
   */
  if (typeof packet.attemptId !== 'string' || !UUID_RE.test(packet.attemptId)) {
    return { ok: false, code: 'REGEN_PACKET_ATTEMPT_ID',
      why: `패킷의 attemptId 가 UUID 가 아니다 (${JSON.stringify(packet.attemptId ?? null)})` }
  }
  const expectedName = `${packet.slug}.${packet.attemptId}.json`
  if (basename(packetPath) !== expectedName) {
    return { ok: false, code: 'REGEN_PACKET_ATTEMPT_ID',
      why: `패킷 파일 이름과 본문 attemptId 가 다르다 (${basename(packetPath)} ≠ ${expectedName})` }
  }
  return { ok: true, packet }
}

/**
 * 🔴 **실패 한 줄의 정본.** 회수 결과를 사람이 읽을 한 문장으로 만든다.
 *
 *    2026-09-27 사고: `fetchManuscript` 는 `stage`·`errorName`·`errorDetail` 을 만들었는데
 *    `fetchSlug` 가 `reason`·`sent` 만 돌려주며 **세 필드를 버렸다.** 그래서 운영 로그에는
 *    끝까지 `connect_failed` 한 단어만 남았고, 실제 원인(composer 선택자)을 알 수 없었다.
 *    만들어 두고 전달하지 않으면 없는 것과 같다.
 *
 *    🔴 원문은 첫 줄·200자까지만 싣는다. 쿠키·토큰·본문은 기록하지 않는다.
 */
export function describeFetchFailure(r) {
  const where = r?.stage ? `[${r.stage}] ` : ''
  const detail = r?.detail
    ?? (r?.errorName && r?.errorDetail ? `${r.errorName}: ${r.errorDetail}`
      : r?.errorDetail ?? (r?.errorName ? String(r.errorName) : ''))
  const extra = r?.missingCount ? ` (지정 문장 ${r.missingCount}개 누락)` : ''
  const invalid = r?.invalid?.length ? ` — ${describeReasons(r.invalid)}` : ''
  return `${where}${r?.reason ?? 'unknown'}${detail ? ` — ${detail}` : ''}${extra}${invalid} · 전송 ${r?.sent ? '1건' : '0건'}`
}

/**
 * 응답을 특정해 원문까지 읽은 뒤 내용 관문에서 탈락했다면 전송 결말은 더 이상 UNKNOWN이 아니다.
 * 같은 요청을 다시 보내지 않는 책임은 재생성 예산·CONTENT 장부가 맡고, send 예약은 해소한다.
 */
export function settlesDeliveryReservation(r) {
  if (r?.ok) return true
  return r?.sent === true && r?.stage === 'validate'
    && (r?.reason === 'invalid_manuscript' || r?.reason === 'markers_missing')
    && Boolean(r?.conversationUrl && r?.assistantMessageId)
}

/** brief 의 "반드시 그대로 넣을 문장" — 회수·무전송 회수가 **같은 대조 기준**을 쓴다 */
function markersOf(brief) {
  const markerBlock = String(brief ?? '').split('## 반드시 그대로 넣을 문장')[1]
  return markerBlock
    ? [...markerBlock.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5)
    : []
}

/**
 * 🔴 **이미 온 응답을 다시 보내지 않고 회수한다** (2026-09-30 · Codex 승인 무전송 회수).
 *
 *    그날 원고는 온전히 왔는데 판독 결함(rich-block)으로 저장되지 못했다. 같은 brief 를 다시 보내면
 *    중복 전송이다. 그래서 **세 가지가 모두 맞을 때만** 기존 대화에서 원문을 읽어 저장한다.
 *      ① 지문 — 장부의 전송불명 기록 · 그날 회수 결과 행 · 지금 보낼 메시지가 **같은 지문**이다
 *      ② 대화 — 결과 행에 주소가 있으면 그 주소와 같다 (없으면 사람이 신원을 확인해 넘긴 주소)
 *      ③ 신원 — 그 대화의 사용자 메시지가 우리가 보낸 메시지와 같다 (`recoverManuscript`)
 *    하나라도 어긋나면 **저장 0 · 장부 불변** — 기존 HOLD 가 그대로 남는다.
 *
 *    🔴 send·composer·ChatGPT 호출 0. attempts·regenCalls 는 건드리지 않는다.
 *    🔴 성공하면 회수 성공 경로와 **같은 방식**(`releaseDeliveryReservation` · 그 예약 ID)으로만 기록을 푼다.
 *    🔴 `checkOnly` 는 신원·원문·관문까지만 보고 아무것도 쓰지 않는다.
 */
export async function recoverSlug(slug, { conversationUrl, checkOnly = false, date = todayKst(),
  resultPath = null, quarantinePath = QUARANTINE_PATH, draftsDir = DRAFTS_DIR, browserDeps = {},
  /** 🔴 전용 자동화 프로필 신원 관문(probe) — 회수와 같은 확인을 지난다. 시험은 주입한다 */
  accessFn = null } = {}) {
  const fail = (reason, errorDetail) => ({ slug, status: 'failed', reason, stage: 'recover', sent: false, errorDetail })
  const outPath = join(draftsDir, slug, 'draft.md')
  if (existsSync(outPath)) return fail('recover_draft_exists', 'draft.md 가 이미 있다 — 덮지 않는다')
  const gate = deliveryGate({ slug, draftsDir, quarantinePath })
  if (!gate.ok) return fail(gate.code, gate.why)
  const d = gate.entry?.delivery
  if (!d || d.kind !== 'DELIVERY_UNCERTAIN' || !gate.messageFingerprint || d.messageFingerprint !== gate.messageFingerprint) {
    return fail('recover_fingerprint_mismatch', '장부의 전송불명 기록과 지금 메시지의 지문이 같지 않다 — 회수하지 않는다')
  }
  const rp = resultPath ?? fetchResultPath(date)
  const res = readFetchResults(rp, { expectDate: date })
  const row = res.ok ? fetchResultFor(res.body, slug) : null
  if (!row || row.status === 'ok' || row.sent !== true || row.messageFingerprint !== gate.messageFingerprint) {
    return fail('recover_result_mismatch', `그날 회수 결과에 같은 지문으로 보낸 실패 행이 없다 (${res.ok ? (row ? row.status : '행 없음') : res.why})`)
  }
  if (row.conversationUrl && row.conversationUrl !== conversationUrl) {
    return fail('recover_identity_mismatch', '회수 결과에 적힌 대화 주소와 다르다')
  }
  const lease = acquireManuscriptLease({ slug, work: 'recover', attemptId: null, path: quarantinePath })
  if (!lease.ok) return fail(lease.code, lease.why)
  try {
    if (accessFn) {
      const p = await accessFn()
      if (p?.status !== STATUS.OK) {
        return fail(p?.status ?? STATUS.UNKNOWN, `자동화 프로필 접근 확인 실패 — 대화를 열지 않았다 (${p?.errorDetail ?? '-'})`)
      }
    }
    const r = await recoverManuscript({
      conversationUrl, expectedMessage: gate.message, outPath,
      requiredMarkers: markersOf(readFileSync(join(draftsDir, slug, 'brief.md'), 'utf8')),
      validate: validateManuscript, checkOnly, ...browserDeps,
    })
    if (!r.ok) {
      return { slug, status: 'failed', reason: r.reason, stage: r.stage ?? 'recover', sent: false,
        messageFingerprint: gate.messageFingerprint, conversationUrl: r.conversationUrl ?? conversationUrl,
        assistantMessageId: r.assistantMessageId ?? null, responseForm: r.responseForm ?? null,
        invalid: r.invalid ?? null, errorDetail: r.errorDetail ?? null }
    }
    const okRow = { slug, status: 'ok', sent: true, messageFingerprint: gate.messageFingerprint,
      conversationUrl: r.conversationUrl, assistantMessageId: r.assistantMessageId, responseForm: r.responseForm,
      length: r.length, checkOnly: r.checkOnly === true }
    if (checkOnly) return okRow
    // 🔴 회수 성공 경로와 같다 — **그 예약 ID** 의 전송불명 기록만 푼다 (잠금 안에서 대조)
    releaseDeliveryReservation({ slug, reservationId: d.reservationId, path: quarantinePath })
    const after = readQuarantine(quarantinePath)
    const released = after.ok && after.store[slug]?.delivery === undefined
    // 🔴 구조화 결과는 그 행만 ok 로 바꾼다 — 그날 전송 수(sentTotal)·회차(runId)는 그대로다
    writeFetchResults(rp, { ...res.body, results: res.body.results.map((x) => (x.slug === slug ? okRow : x)) })
    return { ...okRow, released }
  } finally {
    lease.release()
  }
}

/** HOLD 로 멈춘 한 건의 결과 — 🔴 이전 전송 사실을 그대로 싣는다. 새로 지어내지 않는다 */
function heldResult(slug, gate, stage) {
  return {
    slug, status: 'held', reason: DELIVERY_HOLD_REASON, stage,
    // 🔴 이번 실행은 한 글자도 보내지 않았다 — 앞선 전송의 모름은 `prior` 에 있다
    sent: false,
    messageFingerprint: gate.messageFingerprint,
    errorDetail: gate.hold.why,
    prior: gate.hold.delivery,
  }
}

/**
 * 🔴 **같은 slug 의 원고 작업은 하나만** (2026-09-28 · Codex P0).
 *
 *    일반 회수와 재생성 **모두** 같은 slug lease 를 실제로 잡는다 — brief 확인부터 응답 수신·검증·
 *    draft 저장까지 쥐고 끝에서 푼다. 못 잡으면 `MANUSCRIPT_IN_PROGRESS` 로 멈춘다 —
 *    probe·Chrome·send·draft write·regenCalls·attempts 전부 0.
 *
 *    앞판은 재생성만 lease 를 잡고 일반 회수는 **보기만** 했다. 본 직후 재생성이 lease 를 잡으면
 *    둘 다 보내고 같은 draft.md 를 썼다 (실측 send 2 · draft write 2).
 *    전역 장부 잠금은 네트워크 대기 동안 쥐지 않는다 (예약·기록 순간에만 짧게 잡는다).
 */
async function fetchSlug(slug, opts = {}) {
  const quarantinePath = opts.quarantinePath ?? QUARANTINE_PATH
  let attemptId = null
  if (opts.regenPacket) {
    // 🔴 패킷이 성하지 않으면 안쪽이 같은 사유로 **아무것도 시작하지 않고** 끝낸다 — lease 도 필요 없다
    const pr = readRegenPacket(opts.regenPacket, slug)
    if (!pr.ok) return fetchSlugUnderLease(slug, opts)
    attemptId = pr.packet.attemptId
  }
  const lease = acquireManuscriptLease({ slug, work: opts.regenPacket ? 'regen' : 'fetch', attemptId, path: quarantinePath })
  if (!lease.ok) {
    return {
      slug, status: lease.code === MANUSCRIPT_IN_PROGRESS_REASON ? 'held' : 'failed', reason: lease.code, stage: 'lease',
      sent: false, attemptId, errorDetail: `${lease.why} (브라우저를 열지 않았고 한 글자도 보내지 않았다)`,
    }
  }
  try {
    const r = await fetchSlugUnderLease(slug, opts)
    // 🔴 재생성이면 이 시도의 표식을 결과에 싣는다 — 부모는 **자기 패킷을 읽은 자식인지** 대조한다
    return attemptId ? { ...r, attemptId } : r
  } finally {
    lease.release()
  }
}

async function fetchSlugUnderLease(slug, { quiet = false, force = false, regenPacket = null,
  quarantinePath = QUARANTINE_PATH, runIdHint = null, dateHint = null,
  /**
   * 🔴 **시험이 실제 `fetchSlug` 를 태우기 위한 자리.** 여기가 없으면 시험은
   *    `fetchManuscript` 만 따로 부르게 되고, 그 사이의 장부 처리(선기록을
   *    덮어쓰지 않는 규칙)는 **한 번도 실행되지 않는다** — 죽은 게이트가 된다.
   *    운영에서는 비어 있어 실제 CDP 가 돈다.
   */
  browserDeps = {},
  /**
   * 🔴 **계획과 회수가 같은 폴더를 봐야 한다.** `fetchBatch` 는 주입된 폴더로 계획을 세우는데
   *    `fetchSlug` 는 모듈 상수를 쓰고 있었다 — 운영에서는 같은 값이라 드러나지 않지만,
   *    시험에서는 "계획은 했는데 brief 가 없다" 가 되고, 폴더가 갈라지는 날 조용히 틀린다.
   */
  draftsDir = DRAFTS_DIR,
  /**
   * 🔴 **브라우저 접근은 판정을 통과한 뒤에만.** `fetchOne` 은 여기로 probe 를 넘긴다.
   *    앞판은 probe 를 먼저 하고 나서 보낼지 말지를 봤다 — HOLD 인 글에도 Chrome 을
   *    깨우고 붙었다. 없으면(일괄 회수) 호출부가 이미 한 번 확인했다는 뜻이다.
   */
  accessFn = null,
  /**
   * 🔴 **재생성 원고는 draft.md 에 직접 쓰지 않는다** (2026-10-02 자연 회차).
   *    재생성 응답으로 brief 가 그대로 돌아와 draft.md 를 덮었고, 그 회차가 막혀도
   *    미추적 draft.md 는 되돌려지지 않았다. 이제 재생성은 **부모가 준 임시 경로**에만 쓰고,
   *    부모가 검증·변환에 성공했을 때만 draft.md 를 원자적으로 바꾼다 (magazine-auto-register.mjs).
   */
  draftOut = null } = {}) {
  const dir = join(draftsDir, slug)
  const briefPath = join(dir, 'brief.md')
  const draftPath = join(dir, 'draft.md')
  if (regenPacket && !draftOut) {
    return { slug, status: 'failed', reason: 'REGEN_DRAFT_OUT_MISSING', stage: 'args', sent: false,
      errorDetail: '재생성은 --draft-out 임시 경로가 필요하다 — draft.md 에 직접 쓰지 않는다 (한 글자도 보내지 않았다)' }
  }
  if (draftOut && resolve(draftOut) === resolve(draftPath)) {
    return { slug, status: 'failed', reason: 'REGEN_DRAFT_OUT_IS_DRAFT', stage: 'args', sent: false,
      errorDetail: '--draft-out 이 draft.md 자체다 — 임시 경로여야 한다 (한 글자도 보내지 않았다)' }
  }
  const outPath = draftOut ?? draftPath

  // 🔴 기본은 덮어쓰지 않는다. --force 는 사람이 한 건씩 켜는 손잡이다 —
  //    일괄 회수(--fetch-run)에는 넘기지 않는다. 무인 경로가 원고를 갈아엎으면
  //    사람이 손본 문장이 조용히 사라진다.
  if (existsSync(outPath) && !force) {
    return { slug, status: 'skipped', reason: 'draft_exists', sent: false }
  }
  if (!existsSync(briefPath)) return { slug, status: 'skipped', reason: 'brief_missing', sent: false }

  const markers = markersOf(readFileSync(briefPath, 'utf8'))

  if (!quiet) console.log(`     전송 — 대조 문장 ${markers.length}개`)

  /** 🔴 옵션을 명시했으면 패킷이 성해야 한다. 아니면 **보내지 않는다** */
  let packet = null
  if (regenPacket) {
    const pr = readRegenPacket(regenPacket, slug)
    if (!pr.ok) {
      return { slug, status: 'failed', reason: pr.code, detail: pr.why, sent: false }
    }
    packet = pr.packet
    if (!quiet) console.log(`     재생성 — 실패 ${packet.failures.length}건을 같이 보낸다`)
  }

  // 실제 전송 문자열은 아래 `deliveryGate()`가 현재 원고까지 포함해 한 번만 만든다.
  // `promptText`는 `message`가 없는 호출의 fallback일 뿐이므로 재생성에서는 조립하지 않는다.
  const prompt = packet ? null : manuscriptPromptText(null)

  /**
   * 🔴 **보내도 되는가 — 브라우저를 건드리기 전에 본다.** 판정은 `deliveryGate` 하나다.
   *    HOLD 면 접근 확인도, Chrome 기동도, send 클릭도 0이다.
   */
  const gate = deliveryGate({ slug, draftsDir, packet, quarantinePath })
  if (!gate.ok) {
    return { slug, status: 'failed', reason: gate.code, stage: 'ledger', sent: false,
      messageFingerprint: gate.messageFingerprint, errorDetail: `${gate.why} (한 글자도 보내지 않았다)` }
  }
  if (gate.hold) {
    if (!quiet) console.log(`     ⏸ HOLD — ${gate.hold.why}`)
    return heldResult(slug, gate, 'gate')
  }
  /**
   * 🔴 재생성인데 예산이 이미 소진됐으면 브라우저를 깨우지 않는다. (정본 판정은 아래 예약 임계구역이다 —
   *    이것은 그 전에 불필요한 probe 를 피하는 앞단 확인일 뿐이다)
   */
  const regen = packet ? { attemptId: packet.attemptId ?? null, packetHash: packetHashOf(packet) } : null
  if (regen && regenBudget({ entry: gate.entry }).exhausted) {
    return { slug, status: 'failed', reason: REGEN_EXHAUSTED_REASON, stage: 'gate', sent: false,
      messageFingerprint: gate.messageFingerprint,
      errorDetail: `재생성 ${regenBudget({ entry: gate.entry }).used}회를 이미 썼다 (한 글자도 보내지 않았다)` }
  }

  if (accessFn) {
    const p = await accessFn()
    if (p?.status !== STATUS.OK) {
      return { slug, status: 'failed', reason: p?.status ?? STATUS.UNKNOWN, stage: 'connect', sent: false,
        messageFingerprint: gate.messageFingerprint,
        errorName: p?.errorName ?? null, errorDetail: p?.errorDetail ?? null }
    }
  }

  // 🔴 관문을 쓰기 직전에 건넨다. 막히면 파일이 생기지 않는다.
  /**
   * 🔴 **누르기 전에 적는다** (P0-2). `fetchManuscript` 가 send 직전에 이 함수를 부른다.
   *    여기서 적지 못하면 그쪽이 **한 글자도 보내지 않고** 끝낸다.
   *    적는 값은 `DELIVERY_UNCERTAIN` 이다 — 누른 뒤 무슨 일이 생길지 모르기 때문이다.
   *    받아낸 뒤에야 지운다.
   *
   * 🔴 **적는 그 자리에서 한 번 더 판정한다.** 위 판정과 이 순간 사이에 다른 프로세스가
   *    같은 글자를 보냈을 수 있다. 같은 읽기-수정-쓰기 안에서 `deliveryHoldsFetch` 를
   *    다시 부르고, 걸리면 장부를 바꾸지 않고 **누르지 않는다.**
   */
  let lateHold = null
  let regenExhausted = null
  /**
   * 🔴 **send 권한의 유일한 정본은 이 예약 기록이다** (2026-09-28 · Codex P0).
   *    `reserveDelivery` 가 프로세스 간 잠금 안에서 HOLD → (재생성이면) 최신 예산 → 예약 →
   *    (재생성이면) regenCalls 증가를 **한 번에** 한다. 같은 slug·같은 지문을 두 프로세스가 동시에
   *    들고 와도 **먼저 적은 한쪽만** 권한과 횟수를 얻는다. 다른 쪽은 HOLD 로 끝난다 (send 0 · 횟수 0).
   *    예약 ID 는 "내 예약" 을 가려 성공 뒤 지울 때 남의 예약을 지우지 않게 한다.
   */
  const reservationId = randomUUID()
  let reserved = false
  const recordBeforeSend = async ({ messageFingerprint }) => {
    // 🔴 보내려는 글자가 판정한 글자와 다르면 판정이 무효다 — 누르지 않는다
    if (messageFingerprint !== gate.messageFingerprint) {
      return { ok: false, why: '보낼 글자가 판정한 글자와 다르다' }
    }
    try {
      const u = reserveDelivery({ slug, messageFingerprint, reservationId, regen,
        now: Date.now(), runId: runIdHint, date: dateHint, path: quarantinePath,
        compatibleMessageFingerprints: gate.legacyMessageFingerprint ? [gate.legacyMessageFingerprint] : [],
      })
      // 🔴 잠금 시간 초과·장부 손상·잠금 판정 불가도 `ok:false` 로 온다 — 전부 전송 금지
      if (u.held) { lateHold = u.held; return { ok: false, why: u.why } }
      if (u.exhausted) { regenExhausted = u.exhausted; return { ok: false, why: u.why } }
      if (!u.ok) return { ok: false, why: `장부 선기록 실패${u.code ? ` [${u.code}]` : ''}: ${u.why}` }
      reserved = true
      return { ok: true }
    } catch (e) {
      return { ok: false, why: `장부 선기록 실패: ${e.message}` }
    }
  }

  const r = await fetchManuscript({
    briefPath,
    outPath,
    promptText: prompt,
    // 🔴 판정한 바로 그 글자를 보낸다
    message: gate.message,
    requiredMarkers: markers,
    validate: validateManuscript,
    onBeforeSend: recordBeforeSend,
    ...browserDeps,
  })
  if (lateHold) return heldResult(slug, { ...gate, hold: lateHold }, 'send')
  if (regenExhausted) {
    // 🔴 그 사이 다른 재생성이 마지막 횟수를 가져갔다 — 보내지 않았고, 장부도 바꾸지 않았다
    return { slug, status: 'failed', reason: REGEN_EXHAUSTED_REASON, stage: 'send', sent: false,
      messageFingerprint: gate.messageFingerprint,
      errorDetail: `재생성 ${regenExhausted.used}회를 이미 썼다 (한 글자도 보내지 않았다)` }
  }

  /**
   * 🔴 **선기록을 함부로 지우지 않는다.**
   *    누르기 전에 적었다면, 그 뒤의 실패는 **보냈는지 확정할 수 없다** —
   *    클릭이 먹고 나서 터졌을 수도 있다. 그때 기록을 INFRA 로 덮으면 HOLD 가 풀리고
   *    다음 회차가 같은 brief 를 다시 보낸다.
   *
   *    ① 받아냈다        → 지운다 (고쳐서 다시 부를 수 있어야 한다)
   *    ② 선기록 뒤 실패  → 그대로 둔다 (DELIVERY_UNCERTAIN 유지)
   *    ③ 선기록 전 실패  → 그 실패의 성격대로 적는다 (보내지 않은 것이 확실하다)
   */
  {
    try {
      if (settlesDeliveryReservation(r)) {
        // 🔴 **내 예약일 때만** 지운다 — 그 사이 다른 프로세스가 적은 예약을 지우면 HOLD 가 풀린다
        releaseDeliveryReservation({ slug, reservationId, path: quarantinePath })
      } else if (!r.preRecorded && !reserved) {
        const kind = classifyFailure({
          code: r.reason, stage: r.stage,
          message: [r.errorName, r.errorDetail].filter(Boolean).join(' · '),
          sent: r.sent,
        }).kind
        /**
         * 🔴 **남의 예약을 덮지 않는다.** 선기록에 실패한 이유가 잠금 시간 초과라면
         *    그 사이 다른 프로세스가 같은 글자를 예약·전송했을 수 있다. 여기서 INFRA 로 덮으면
         *    그 HOLD 가 풀려 다음 회차가 다시 보낸다.
         */
        updateQuarantine((cur) => (deliveryHoldsFetch(cur[slug], r.messageFingerprint ?? null) ? cur : {
          ...cur,
          [slug]: recordDelivery(cur[slug], {
            sent: r.sent, messageFingerprint: r.messageFingerprint ?? null, kind,
            reason: r.reason ?? null, stage: r.stage ?? null, now: Date.now(),
            runId: runIdHint, date: dateHint,
          }),
        }), quarantinePath)
      }
      // ② 는 아무것도 하지 않는다 — 선기록이 사실이다
    } catch (e) {
      // 🔴 장부에 못 적었으면 **말한다.** 조용히 넘기면 다음 회차가 또 보낸다.
      console.error(`     🔴 전송 사실을 장부에 적지 못했다 — ${e.message}`)
    }
  }

  if (r.ok) {
    return { slug, status: 'ok', sent: r.sent, length: r.length, messageFingerprint: r.messageFingerprint ?? null,
      conversationUrl: r.conversationUrl ?? null, assistantMessageId: r.assistantMessageId ?? null, responseForm: r.responseForm ?? null }
  }
  return {
    slug,
    status: 'failed',
    reason: r.reason,
    sent: r.sent,
    missingCount: r.missingCount,
    invalid: r.invalid ?? null,
    messageFingerprint: r.messageFingerprint ?? null,
    preRecorded: r.preRecorded ?? false,
    // 🔴 여기서 버리면 운영 로그까지 `connect_failed` 한 단어로 도착한다 (2026-09-27)
    stage: r.stage ?? null,
    errorName: r.errorName ?? null,
    errorDetail: r.errorDetail ?? null,
    conversationUrl: r.conversationUrl ?? null,
    assistantMessageId: r.assistantMessageId ?? null,
    responseForm: r.responseForm ?? null,
  }
}
/** 저장된 원고를 기계 검사만 한다. 내용을 출력하지 않는다 */
function describeDraft(slug, draftsDir = DRAFTS_DIR, path = join(draftsDir, slug, 'draft.md')) {
  const t = readFileSync(path, 'utf8')
  return {
    length: t.length,
    frontmatter: t.trimStart().startsWith('---'),
    h2: (t.match(/^## /gm) ?? []).length,
    cta: (t.match(/\[CTA\]/g) ?? []).length,
    forbidden: {
      table: t.includes('|---'),
      http: /https?:\/\//.test(t),
      bold: /\*\*/.test(t),
      numbered: /^\d+\. /m.test(t),
    },
  }
}

/**
 * 단건 CLI — 사람이 부르는 경로이자 **재생성(`--regen-packet`)이 지나는 경로.**
 *
 * 🔴 주입점(`probeFn`·`browserDeps`·`quarantinePath`)은 CLI 에서
 *    `SORAN_MAGAZINE_TEST_MODE=1` 일 때만 채워진다 (`magazine-test-harness.mjs`).
 *    운영에서는 비어 있어 실제 probe·CDP·장부가 돈다.
 */
export async function fetchOne(slug, { force = false, regenPacket = null, resultPath = null, draftOut = null,
  quarantinePath = QUARANTINE_PATH, draftsDir = DRAFTS_DIR,
  probeFn = probe, browserDeps = {}, exit = (code) => process.exit(code) } = {}) {
  console.log('')
  console.log(`  원고 요청 — ${slug}`)

  /**
   * 🔴 **모든 종료 경로가 여기를 지난다.** 한 곳이라도 `process.exit` 를 직접 부르면
   *    그 경로는 부모에게 아무 말도 하지 않는다 — 부모는 `sent` 를 모른 채 재전송한다.
   *    기록 자체가 실패해도 회차는 멈추지 않되, **무엇을 못 적었는지는 말한다.**
   */
  const finishOne = (r, exitCode) => {
    if (resultPath) {
      try {
        // 🔴 HOLD 는 이번 실행이 보낸 것이 아니다 — `sent:false` 그대로, 앞선 전송은 `prior` 에 있다
        writeFetchResults(resultPath, { mode: 'fetch-one', results: [{ ...r, slug }], sentTotal: r.sent === true ? 1 : 0 })
      } catch (e) {
        console.error(`     🔴 회수 결과를 적지 못했다 — ${e.message}`)
      }
    }
    exit(exitCode)
    return { result: { ...r, slug }, exitCode }
  }

  /**
   * 🔴 **패킷 검사가 브라우저보다 앞이다.**
   *    접근 확인을 먼저 하면 세션을 열어 놓고 나서 멈춘다.
   *    성하지 않은 패킷이면 **아무것도 시작하지 않는다.**
   */
  if (regenPacket) {
    const pr = readRegenPacket(regenPacket, slug)
    if (!pr.ok) {
      console.error('')
      console.error(`  ⛔ ${pr.code} — ${pr.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      return finishOne({ status: 'failed', reason: pr.code, stage: 'packet', sent: false, errorDetail: pr.why }, 1)
    }
    console.log(`  0) 재생성 패킷 확인 — 실패 ${pr.packet.failures.length}건`)
  }

  /**
   * 🔴 **접근 확인은 전송 판정 뒤다.** 앞판은 여기서 probe 를 먼저 했다 —
   *    이미 보낸 글(HOLD)에도 Chrome 을 깨우고 붙었다. 이제 `fetchSlug` 가
   *    판정을 통과시킨 뒤에만 이 함수를 부른다.
   */
  const accessFn = async () => {
    console.log('  1) 접근 확인')
    const p = await probeFn({ autoStart: true })
    console.log(`     status ${p.status}`)
    if (p.status !== STATUS.OK) {
      console.error('')
      console.error(`  ⛔ ${MESSAGE[p.status] ?? MESSAGE[STATUS.UNKNOWN]}`)
      // 상태 코드만 찍으면 무엇이 거부됐는지 로그에 남지 않는다
      if (p.errorDetail) console.error(`     ${p.errorDetail}`)
      console.error('     한 글자도 보내지 않았다.')
      console.error('')
    }
    return p
  }

  console.log(`  2) 회수${force ? ' (--force — 기존 draft.md 를 덮어쓴다)' : ''}`)
  const r = await fetchSlug(slug, { force, regenPacket, quarantinePath, dateHint: todayKst(),
    draftsDir, browserDeps, accessFn, draftOut })
  if (r.status === 'skipped') {
    console.log(`     건너뜀 — ${r.reason === 'draft_exists' ? '이미 draft.md 가 있다 (덮어쓰려면 --force)' : 'brief.md 가 없다'}`)
    console.log('')
    return finishOne(r, r.reason === 'brief_missing' ? 1 : 0)
  }
  if (r.status === 'held') {
    /**
     * 🔴 **HOLD 는 성공이 아니다 — 종료 코드 1.** 0 으로 끝내면 재생성 경로가
     *    "원고를 받았다" 로 읽을 수 있다. 구조화 결과가 `held` 와 사유를 말한다.
     */
    console.error(`     ⏸ HOLD — ${r.errorDetail}`)
    console.error(`     지문 ${r.messageFingerprint} · 브라우저 접근 0 · 전송 0건`)
    console.error('')
    return finishOne(r, 1)
  }
  if (r.status === 'failed') {
    console.error(`     ⛔ ${describeFetchFailure(r)}`)
    // 🔴 관문에 막혔으면 무엇이 걸렸는지 한 줄씩 말한다. 코드만 찍으면 고칠 수가 없다.
    if (r.invalid?.length) {
      console.error('     관문에 막혔다 — 저장하지 않았다:')
      for (const x of r.invalid) console.error(`       · ${x.code}: ${x.why}`)
    }
    console.error('')
    return finishOne(r, 1)
  }

  // 🔴 재생성이면 원고는 임시 경로에 있다 — draft.md 는 부모가 검증한 뒤에만 바뀐다
  const d = describeDraft(slug, draftsDir, draftOut ?? undefined)
  console.log(`     ✅ 저장 · 전송 1건 · 본문 ${d.length}자`)
  console.log('')
  console.log(draftOut ? `     ${draftOut} (재생성 임시 원고 — 부모가 검증 뒤 교체한다)` : `     drafts/magazine/${slug}/draft.md`)
  console.log(`     frontmatter ${d.frontmatter ? '✅' : '🔴'} · h2 ${d.h2}개 · CTA ${d.cta}개`)
  console.log(`     금지 표기: 표 ${d.forbidden.table ? '🔴' : '0'} · http ${d.forbidden.http ? '🔴' : '0'}` +
    ` · 굵게 ${d.forbidden.bold ? '🔴' : '0'} · 번호목록 ${d.forbidden.numbered ? '🔴' : '0'}`)
  console.log('')
  console.log('  🔴 md-to-draft · batch-qa · register 는 실행하지 않았다.')
  console.log('')
  // 🔴 성공도 적는다. 성공을 안 적으면 부모는 "결과가 없다" 를 실패로 읽는다.
  return finishOne(r, 0)
}

/**
 * producer 가 고른 것들을 순회하며 원고를 받는다 — 01:00 무인 경로.
 *
 * 🔴 실패를 두 갈래로 나눈다.
 *    전역(Cloudflare · 로그인 만료 · Chrome 없음) → 즉시 중단. 다음 slug 도 어차피 실패한다
 *    개별(업로드 실패 · 응답 timeout · 문장 누락) → 다음 slug 로 계속. 재고 확보가 목적이다
 *
 * 🔴 register 를 부르지 않는다. articles.ts 도 topic-queue.ts 도 건드리지 않는다.
 *    draft.md 까지가 이 명령의 종점이다.
 */
/**
 * 🔴 `draftsDir` 는 **시험이 실제 이 함수를 돌리기 위한** 최소 주입점이다.
 *    기본값은 운영 경로 그대로다 — 소스 문자열 검사로 대신하지 않기 위해 연다.
 */
export async function fetchBatch({ date, dryRun, limit, draftsDir = DRAFTS_DIR, resultPath = null,
  /** 🔴 전송 사실의 정본. 시험은 임시 파일을 준다 — 운영 장부를 건드리지 않는다 */
  quarantinePath = QUARANTINE_PATH,
  /** 🔴 시험이 브라우저를 켜지 않고 실패 경로를 태우기 위한 자리. 운영은 실제 probe 다 */
  probeFn = probe,
  /** 🔴 실제 회수 경로를 가짜 브라우저로 태우기 위한 자리 (운영은 비어 있다) */
  browserDeps = {} }) {
  /**
   * 🔴 **일괄 회수도 같은 계약으로 끝난다.** 중간에 끊기든 전역 실패든,
   *    돌려주기 전에 무엇을 보냈는지 적는다. dry-run 은 한 글자도 안 보내므로
   *    기록도 남기지 않는다 — 안 보낸 회차를 "보낸 적 있음" 으로 오염시키지 않는다.
   */
  let runId = null
  const finishBatch = (out) => {
    if (resultPath && !dryRun) {
      try {
        writeFetchResults(resultPath, { date, runId, mode: 'fetch-run', ...out })
      } catch (e) {
        console.log(`  🔴 회수 결과를 적지 못했다 — ${e.message}`)
      }
    }
    return out
  }
  const run = loadRun(date, draftsDir)
  const targets = inspectTargets(run, date, draftsDir)

  console.log('')
  console.log(`  원고 일괄 회수 — ${date}${dryRun ? ' (dry-run)' : ''}`)
  if (!run) {
    console.log('  producer 산출물이 없다 — 오늘 run.json 을 찾지 못했다')
    console.log('')
    return finishBatch({ planned: [], results: [], sentTotal: 0 })
  }
  console.log(`  producer ${run.status} · 재고 ${run.inventoryDays}일 · 대상 ${targets.length}건`)
  console.log('')

  /**
   * 🔴 **조건을 다시 만들지 않는다** (Codex 재검토 2026-09-28).
   *
   *    앞판은 여기서 `t.draftMd ? … : !t.brief ? …` 로 자체 판정을 했다.
   *    `review` 를 보지 않아, **대조할 `riskSentences` 가 없는 주제에도 ChatGPT 를 불렀다.**
   *    회수 대상은 `fetchTargets()` 하나가 정한다 — 등록 경로와 같은 계약이다.
   */
  const fetchSet = new Set(fetchTargets(targets).map((t) => t.slug))

  /**
   * 🔴 **이미 보낸 글은 다시 보내지 않는다 — 판정 권한은 장부에 있다** (P0-1).
   *
   *    앞판은 회수 결과 파일을 `runId` 로 검증해 HOLD 를 유지했다. 그런데 `runId` 는
   *    **목록 전체**의 지문이라, 상관없는 후보 하나가 `run.json` 에 추가되면 값이 바뀌고
   *    **HOLD 가 통째로 풀렸다.** 보낸 사실은 회차가 아니라 그 글에 붙어야 한다.
   *
   *    이제 `slug` + **보낼 메시지의 지문**으로 단일 격리 장부에서 판정한다.
   *    날짜·회차·다른 후보가 아무리 바뀌어도 같은 글자면 그대로 막힌다.
   *    brief 나 프롬프트가 바뀌어 지문이 달라질 때만 다시 보낸다.
   */
  const state = readRunFetchState({ draftsDir, date, resultPath })
  runId = state.runId
  const ledger = readQuarantine(quarantinePath)
  if (!ledger.ok) {
    console.log('')
    console.log(`  ⛔ 격리 장부를 읽지 못했다 — ${ledger.why}`)
    console.log('     한 글자도 보내지 않는다. (전송 0건)')
    console.log('')
    return finishBatch({ planned: [], results: [], sentTotal: 0, fatal: 'QUARANTINE_UNREADABLE' })
  }
  /**
   * 🔴 **계획표도 `deliveryGate` 를 부른다 — 조건을 여기서 다시 쓰지 않는다.**
   *    실제 전송 경계(`fetchSlug`)가 같은 함수로 한 번 더 막으므로,
   *    이 계획표는 "몇 건이 HOLD 인가" 를 보여 주고 불필요한 probe 를 피하는 용도다.
   */
  const hold = new Map()
  for (const slug of fetchSet) {
    const g = deliveryGate({ slug, draftsDir, quarantinePath })
    if (g.ok && g.hold) hold.set(slug, g.hold)
  }
  if (hold.size) console.log(`  🔴 전송불명 ${hold.size}건은 다시 보내지 않는다 (장부 지문 일치)`)

  const planned = targets.map((t) => {
    const held = hold.get(t.slug)
    if (fetchSet.has(t.slug) && held) {
      return { slug: t.slug, stage: t.stage, action: 'hold:delivery_uncertain', why: held.why, prior: held.delivery }
    }
    return {
      slug: t.slug,
      stage: t.stage,
      action: fetchSet.has(t.slug) ? 'fetch' : `skip:${String(t.stage ?? 'UNKNOWN').toLowerCase()}`,
    }
  })
  for (const p of planned) {
    const mark = p.action === 'fetch' ? '→ 전송'
      : p.action === 'hold:delivery_uncertain' ? `⏸ HOLD (${p.why})`
        : `– 건너뜀 (${p.action.split(':')[1]})`
    console.log(`    ${p.slug.padEnd(34)}${mark}`)
  }
  const toFetch = planned.filter((p) => p.action === 'fetch')
  const heldPlans = planned.filter((p) => p.action === 'hold:delivery_uncertain')
  console.log('')
  console.log(`  전송 예정 ${toFetch.length}건 · HOLD ${heldPlans.length}건 · 건너뜀 ${planned.length - toFetch.length - heldPlans.length}건`)
  if (dryRun) {
    console.log('')
    console.log('  🔴 dry-run — 한 글자도 보내지 않았다.')
    console.log('')
    return finishBatch({ planned, results: [], sentTotal: 0 })
  }

  /**
   * 🔴 **HOLD 사실을 다음 회차로 넘긴다.** 이번 결과 파일에 안 적으면
   *    다음 실행은 "기록 없음" 으로 읽고 **그 글을 다시 보낸다.**
   *    앞 회차가 적어 둔 행을 그대로 이어 붙인다 — 새로 지어내지 않는다.
   */
  const results = heldPlans.map((p) => ({ ...p.prior, slug: p.slug, status: 'held' }))
  let sentTotal = 0

  if (toFetch.length) {
    console.log('')
    console.log('  접근 확인')
    const p = await probeFn({ autoStart: true })
    console.log(`    status ${p.status}`)
    if (p.status !== STATUS.OK) {
      console.log('')
      console.log(`  ⛔ ${MESSAGE[p.status] ?? MESSAGE[STATUS.UNKNOWN]} — 한 글자도 보내지 않았다`)
      if (p.errorDetail) console.log(`     ${p.errorDetail}`)
      console.log('')
      /**
       * 🔴 **접근에 실패해도 HOLD 사실은 같이 적는다.** 여기서 빠뜨리면 다음 실행이
       *    "기록 없음" 으로 읽고 **이미 보낸 글을 다시 보낸다.** 브라우저가 안 열린 것과
       *    앞서 보낸 사실은 아무 상관이 없다.
       */
      return finishBatch({
        planned,
        results: [...results, { slug: '-', status: 'failed', reason: p.status, stage: 'connect', sent: false, errorDetail: p.errorDetail ?? null }],
        sentTotal: 0, fatal: p.status,
      })
    }
  }

  let fatal = null
  for (const p of toFetch) {
    if (limit && sentTotal >= limit) {
      results.push({ slug: p.slug, status: 'skipped', reason: 'limit', sent: false })
      continue
    }
    console.log('')
    console.log(`  ${p.slug}`)
    const r = await fetchSlug(p.slug, { quarantinePath, runIdHint: runId, dateHint: date, browserDeps, draftsDir })
    if (r.sent) sentTotal += 1
    results.push(r)

    if (r.status === 'ok') {
      const d = describeDraft(p.slug, draftsDir)
      console.log(`     ✅ ${d.length}자 · h2 ${d.h2} · CTA ${d.cta}`)
    } else if (r.status === 'held') {
      // 🔴 계획 뒤에 다른 프로세스가 같은 글자를 보냈다 — 전송 경계가 막았다
      console.log(`     ⏸ HOLD — ${r.errorDetail}`)
    } else if (r.status === 'failed') {
      // 🔴 stage·원문을 여기서도 싣는다 — 일괄 회수 로그가 운영에서 제일 많이 읽힌다
      console.log(`     ⛔ ${describeFetchFailure(r)}${r.invalid?.length ? ` — ${describeReasons(r.invalid)}` : ''}`)
      // 전역 실패면 나머지를 시도하지 않는다
      if (isFatal(r.reason)) { fatal = r.reason; console.log('     전역 실패 — 나머지를 시도하지 않는다'); break }
      console.log('     다음 글로 넘어간다')
    }
  }

  console.log('')
  const ok = results.filter((r) => r.status === 'ok').length
  const failed = results.filter((r) => r.status === 'failed').length
  // 🔴 HOLD 는 실패가 아니다 — 따로 센다. 실패로 세면 회차가 빨갛게 보여 판단을 흐린다.
  console.log(`  결과: 저장 ${ok} · 실패 ${failed} · HOLD ${results.filter((r) => r.status === 'held').length}` +
    ` · 건너뜀 ${results.filter((r) => r.status === 'skipped').length} · 전송 ${sentTotal}건`)
  console.log('')
  console.log('  🔴 md-to-draft · batch-qa · register 는 실행하지 않았다.')
  console.log('')
  return finishBatch({ planned, results, sentTotal, fatal })
}

/**
 * 큐 전체가 어느 단계까지 왔는지 — 전송 0건, 파일만 본다.
 *
 * 🔴 실패한 다음 날 "무엇이 남아 있나" 를 답하는 자리다.
 *    brief 만 있고 draft 가 없으면 회수가 막힌 것이고,
 *    draft 는 있는데 article-draft 가 없으면 변환이 남은 것이다.
 *    로그를 뒤지지 않고 파일 상태만으로 판단할 수 있어야 한다.
 */
function status() {
  const queue = loadQueue()
  const rows = queue.map((q) => {
    const dir = join(DRAFTS_DIR, q.slug)
    const has = (f) => existsSync(join(dir, f))
    const brief = has('brief.md')
    const review = has('review.ts')
    const draft = has('draft.md')
    const article = has('article-draft.ts')
    let stage = 'brief 대기'
    if (article) stage = '변환 완료'
    else if (draft) stage = 'md-to-draft 대기'
    else if (brief && review) stage = '원고 회수 대기'
    else if (brief || review) stage = 'brief 불완전'
    return { slug: q.slug, queueItem: q, riskLevel: q.riskLevel, autoEligible: q.autoEligible === true, brief, review, draft, article, stage }
  })

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2))
    return
  }

  const count = (s) => rows.filter((r) => r.stage === s).length
  console.log('')
  console.log(`  매거진 원고 파이프라인 — 큐 ${rows.length}건 (전송 0건 · 파일만 본다)`)
  console.log('')
  console.log(`    변환 완료        ${count('변환 완료')}건`)
  console.log(`    md-to-draft 대기 ${count('md-to-draft 대기')}건`)
  console.log(`    원고 회수 대기   ${count('원고 회수 대기')}건`)
  console.log(`    brief 불완전     ${count('brief 불완전')}건`)
  console.log(`    brief 대기       ${count('brief 대기')}건`)
  console.log('')

  // 지금 회수할 수 있는 것만 따로 보여준다 — 자동 레인이 실제로 태울 대상이다
  /** 🔴 등급으로 가르지 않는다 (M3-A). 프로필을 정할 수 있으면 회수 대상이다 */
  const ready = rows.filter((r) => r.stage === '원고 회수 대기' && isAutoLaneEligible(r.queueItem ?? r).ok)
  console.log(`  지금 회수 가능(프로필 확정): ${ready.length}건`)
  for (const r of ready) console.log(`    ${r.slug.padEnd(34)}${isAutoLaneEligible(r.queueItem ?? r).profile ?? '-'}`)
  console.log('')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  /**
   * 🔴 **시험 주입은 브라우저·장부를 건드리기 전에 판정한다** (P0-2).
   *    운영 모드에서 fixture 가 보이면 여기서 끝난다 — 기본값으로 조용히 가지 않는다.
   */
  const harness = await loadTestHarness()
  if (!harness.ok) {
    console.error('')
    console.error(`  ⛔ ${harness.code} — ${harness.why}`)
    console.error('     브라우저를 열거나 파일을 쓰지 않았다. (전송 0건)')
    console.error('')
    process.exit(2)
  }
  const T = harness.deps
  if (argv.includes('--login')) return await login(T)
  if (argv.includes('--status')) return status()
  if (argv.includes('--fetch')) {
    const slug = argv[argv.indexOf('--fetch') + 1]
    if (!slug || slug.startsWith('--')) {
      console.error('  --fetch <slug> 가 필요하다')
      process.exit(2)
    }
    /**
     * 🔴 **옵션이 있는데 값이 없으면 그대로 멈춘다.**
     *    옛 판은 `--regen-packet` 이 마지막 인자면 `undefined` 가 나왔고,
     *    그 값이 falsy 라 **검사를 통째로 건너뛰고 일반 생성을 보냈다** —
     *    "재생성하라" 고 적은 명령이 조용히 새 원고를 덮어썼다.
     *    값이 다른 `--옵션` 인 경우도 경로가 아니다.
     */
    /**
     * 🔴 **`--result-json` 도 값이 없으면 멈춘다.** `--regen-packet` 과 같은 이유다.
     *    값이 빠진 채 `undefined` 로 흘러가면 기록이 **조용히 꺼진다** — 그러면
     *    부모는 `sent` 를 모르고, 모르는 채로 재전송한다.
     */
    const rj = readPathArg(argv, '--result-json')
    if (!rj.ok) {
      console.error('')
      console.error(`  ⛔ ${rj.code} — ${rj.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      process.exit(1)
    }
    const rp = readRegenPacketArg(argv)
    if (!rp.ok) {
      console.error('')
      console.error(`  ⛔ ${rp.code} — ${rp.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      process.exit(1)
    }
    const dout = readPathArg(argv, '--draft-out')
    if (!dout.ok) {
      console.error('')
      console.error(`  ⛔ ${dout.code} — ${dout.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      process.exit(1)
    }
    return await fetchOne(slug, {
      force: argv.includes('--force'), regenPacket: rp.path, resultPath: rj.path, draftOut: dout.path,
      ...(T.probe ? { probeFn: T.probe } : {}),
      ...(T.connect || T.ensureTab ? { browserDeps: { connect: T.connect, ensureTab: T.ensureTab, ...(T.fetchTiming ?? {}) } } : {}),
      ...(T.quarantinePath ? { quarantinePath: T.quarantinePath } : {}),
    })
  }
  if (argv.includes('--recover')) {
    const slug = argv[argv.indexOf('--recover') + 1]
    const url = argv.includes('--conversation') ? argv[argv.indexOf('--conversation') + 1] : null
    if (!slug || slug.startsWith('--') || !url || url.startsWith('--')) {
      console.error('  --recover <slug> --conversation <https://chatgpt.com/c/...> 가 필요하다')
      process.exit(2)
    }
    const r = await recoverSlug(slug, {
      conversationUrl: url, checkOnly: argv.includes('--check'),
      // 🔴 Chrome 을 새로 띄우지 않는다 — 이미 떠 있는 전용 자동화 프로필만 쓴다
      accessFn: () => (T.probe ?? probe)({ autoStart: false }),
      ...(argv.includes('--date') ? { date: argv[argv.indexOf('--date') + 1] } : {}),
      ...(T.connect || T.ensureTab ? { browserDeps: { connect: T.connect, ensureTab: T.ensureTab } } : {}),
      ...(T.quarantinePath ? { quarantinePath: T.quarantinePath } : {}),
    })
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.status === 'ok' ? 0 : 1)
  }
  if (argv.includes('--fetch-run')) {
    const date = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : todayKst()
    const limitArg = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : null
    const rj = readPathArg(argv, '--result-json')
    if (!rj.ok) {
      console.error('')
      console.error(`  ⛔ ${rj.code} — ${rj.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      process.exit(1)
    }
    /**
     * 🔴 옵션이 없으면 **표준 자리**에 적는다. 첫 회수의 `sent` 는 그날 하루 내내
     *    쓰이는 사실이다 — 자동 등록 경로가 "이미 보낸 글" 을 알아야 재전송하지 않는다.
     */
    const r = await fetchBatch({
      date, dryRun: argv.includes('--dry-run'), limit: limitArg,
      resultPath: rj.path ?? fetchResultPath(date),
      ...(T.probe ? { probeFn: T.probe } : {}),
      ...(T.connect || T.ensureTab ? { browserDeps: { connect: T.connect, ensureTab: T.ensureTab, ...(T.fetchTiming ?? {}) } } : {}),
      ...(T.quarantinePath ? { quarantinePath: T.quarantinePath } : {}),
    })
    // 전역 실패만 종료 코드 1 — 개별 실패는 나머지가 성공했을 수 있다
    process.exit(r.fatal ? 1 : 0)
  }

  const dryRun = argv.includes('--dry-run')
  if (!dryRun) {
    // 원고 회수는 --fetch · --fetch-run 이 한다. 그 밖의 호출은 판정만 하므로 dry-run 을 요구한다.
    console.error('  판정 모드는 --dry-run 을 명시해야 한다. 원고 회수는 --fetch <slug> 또는 --fetch-run 이다.')
    process.exit(2)
  }

  const wantProbe = argv.includes('--probe')
  // 무인 실행용 — CDP 가 없으면 일반 Chrome 을 직접 띄우고 기다린다
  const autoStart = argv.includes('--auto-start')
  const asJson = argv.includes('--json')
  const date = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : todayKst()

  const run = loadRun(date)
  const targets = inspectTargets(run, date)

  let access = { status: null, severity: null, message: null }
  if (wantProbe) {
    const r = await (T.probe ?? probe)({ autoStart })
    access = {
      status: r.status,
      // SEVERITY[ok] 는 null 이다 — ?? 로 fallback 하면 정상인데 ERROR 가 된다.
      // 모르는 상태만 ERROR 로 올린다
      severity: r.status in SEVERITY ? SEVERITY[r.status] : 'ERROR',
      message: MESSAGE[r.status] ?? MESSAGE[STATUS.UNKNOWN],
      connected: r.connected,
      httpStatus: r.httpStatus,
      profileExists: r.profileExists,
      // 판정 근거를 남긴다 — 전부 불리언이라 계정 정보가 실리지 않는다
      signals: r.signals ?? null,
      chromeStarted: r.chromeStarted ?? false,
    }
  }

  const out = {
    date,
    mode: 'dry-run',
    runFound: Boolean(run),
    runStatus: run?.status ?? null,
    inventoryDays: run?.inventoryDays ?? null,
    targets: targets.map((t) => ({ ...t, nextAction: nextActionFor(t) })),
    access,
    // Slack 은 보내지 않는다. 보낼 것이 있는지만 계산한다
    slack: access.severity ? { severity: access.severity, code: access.status, sent: false } : null,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log('')
    console.log(`  ChatGPT web UI runner — ${date} (dry-run)`)
    console.log('')
    if (!run) {
      console.log('  producer 산출물이 없다 — 오늘 run.json 을 찾지 못했다')
    } else {
      console.log(`  producer : ${run.status} · 재고 ${run.inventoryDays}일 · 선정 ${targets.length}건`)
      console.log('')
      for (const t of targets) {
        const mark = (b) => (b ? '✅' : '– ')
        console.log(`    ${t.slug}`)
        console.log(`      brief ${mark(t.brief)} review ${mark(t.review)} draft.md ${mark(t.draftMd)} article-draft ${mark(t.articleDraft)}`)
        console.log(`      → ${nextActionFor(t)}`)
      }
    }
    console.log('')
    if (wantProbe) {
      const icon = access.status === STATUS.OK ? '✅' : '⛔'
      console.log(`  ChatGPT 접근: ${icon} ${access.status}`)
      console.log(`    ${access.message}`)
      console.log(`    CDP 연결 ${access.connected ? '✅' : '🔴'} · HTTP ${access.httpStatus ?? '-'} · 프로필 ${access.profileExists ? '있음' : '없음'}${access.chromeStarted ? ' · Chrome 자동 기동' : ''}`)
      if (access.signals) {
        const on = Object.entries(access.signals).filter(([, v]) => v).map(([k]) => k)
        console.log(`    화면 신호: ${on.length ? on.join(' · ') : '없음 (판정 근거가 하나도 잡히지 않았다)'}`)
      }
      if (access.severity) {
        console.log(`    Slack 등급 ${access.severity} (이번 단계에서는 보내지 않는다)`)
      }
      if (access.status === STATUS.CHROME_NOT_RUNNING) {
        console.log('')
        console.log('    node scripts/magazine-webui-runner.mjs --login 으로 먼저 띄워라.')
        console.log('    그 창을 닫지 않아야 probe 가 붙을 수 있다.')
      } else if (access.status === STATUS.LOGIN_REQUIRED || !access.profileExists) {
        console.log('')
        console.log(PROFILE_SETUP_GUIDE.split('\n').map((l) => `    ${l}`).join('\n'))
      }
    } else {
      console.log('  ChatGPT 접근: 확인하지 않았다 (--probe 를 붙이면 확인한다)')
    }
    console.log('')
    // 🔴 앞판은 여기서 "아직 구현되지 않았다" 고 말했다 — 회수가 구현된 뒤에도 남아 감사를 오도했다
    console.log('  🔴 dry-run — 원고를 요청하지 않았다 (전송 0건). 회수는 --fetch / --fetch-run 이 한다.')
    console.log('')
  }

  const blocked = wantProbe && access.status !== STATUS.OK
  process.exit(blocked ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-webui-runner.mjs')) main()
