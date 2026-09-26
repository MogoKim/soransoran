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
 *    접근 판정(probe) · brief 첨부 · 전송 · 응답 대기 · 관문 통과 시 draft.md 저장.
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
import { join } from 'node:path'
import { ROOT, DRAFTS_DIR, loadQueue } from './lib/magazine-load.mjs'
import { validateManuscript, describeReasons } from './lib/magazine-manuscript-guard.mjs'
import {
  probe, fetchManuscript, isFatal, browserAvailable, profileExists, profileInUse, cdpAvailable,
  chromeArgs, CHROME_APP, CDP_PORT,
  STATUS, SEVERITY, MESSAGE, PROFILE_DIR, PROFILE_SETUP_GUIDE,
} from './lib/chatgpt-session.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'

const RUNS_DIR = join(DRAFTS_DIR, '_runs')

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** producer 산출물을 읽는다. 없으면 없다고만 한다 — 이 스크립트가 만들지 않는다 */
function loadRun(date) {
  const file = join(RUNS_DIR, date, 'run.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 대상별로 무엇이 준비됐는지 본다. 원고가 이미 있으면 다시 만들 필요가 없다 */
function inspectTargets(run) {
  const slugs = (run?.selected ?? []).map((s) => (typeof s === 'string' ? s : s?.slug)).filter(Boolean)
  return slugs.map((slug) => {
    const dir = join(DRAFTS_DIR, slug)
    return {
      slug,
      brief: existsSync(join(dir, 'brief.md')),
      review: existsSync(join(dir, 'review.ts')),
      draftMd: existsSync(join(dir, 'draft.md')),
      articleDraft: existsSync(join(dir, 'article-draft.ts')),
    }
  })
}

function nextActionFor(t) {
  if (t.articleDraft) return '완료 — 이미 변환됨'
  if (t.draftMd) return 'md-to-draft 대기'
  if (!t.brief || !t.review) return 'brief/review 미작성 — 세션이 채워야 한다'
  return 'ChatGPT 원고 필요 (다음 단계에서 구현)'
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
  node scripts/magazine-webui-runner.mjs --fetch <slug> --force --regen-packet <경로>
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
async function login() {
  if (!browserAvailable()) {
    console.error(`  ⛔ ${MESSAGE[STATUS.BROWSER_MISSING]}`)
    process.exit(1)
  }
  if (await cdpAvailable()) {
    console.log('')
    console.log(`  이미 전용 Chrome 이 CDP 포트 ${CDP_PORT} 로 떠 있습니다.`)
    console.log('  그 창에서 로그인하면 됩니다. 새로 띄우지 않습니다.')
    console.log('')
    return
  }
  if (profileInUse()) {
    console.error('')
    console.error('  ⛔ 전용 Chrome 이 CDP 포트 없이 떠 있습니다.')
    console.error('     그 창을 닫고 다시 --login 을 실행해야 probe 가 붙을 수 있습니다.')
    console.error('')
    process.exit(1)
  }

  // 쿠키가 들어갈 자리라 권한을 좁혀 둔다
  if (!profileExists()) mkdirSync(PROFILE_DIR, { recursive: true })
  try { chmodSync(PROFILE_DIR, 0o700) } catch { /* 이미 맞으면 그만 */ }

  console.log('')
  console.log(`  전용 Chrome 을 띄웁니다 (일반 Chrome · CDP 포트 ${CDP_PORT}).`)
  console.log(`  프로필: ${PROFILE_DIR}`)
  console.log('')
  console.log('  1. ChatGPT 에 로그인하세요')
  console.log('  2. "나만의 Chrome 만들기" 팝업이 뜨면 "계정 없이 Chrome 사용" 을 누르세요')
  console.log('  3. 🔴 창을 닫지 마세요 — probe 가 이 창에 붙습니다')
  console.log('  4. node scripts/magazine-webui-runner.mjs --dry-run --probe')
  console.log('')

  const child = spawn(CHROME_APP, chromeArgs(), { detached: true, stdio: 'ignore' })
  child.unref()

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
export const REGEN_PACKET_SCHEMA = 'regen-packet/2'

/**
 * 🔴 `--regen-packet` **인자 자체**를 검사한다.
 *    옵션을 쓰지 않았으면 `path: null` 로 정상. 썼는데 값이 없으면 실패다.
 *
 * @returns {{ok:true, path:string|null}|{ok:false, code:string, why:string}}
 */
export function readRegenPacketArg(argv) {
  const i = argv.indexOf('--regen-packet')
  if (i === -1) return { ok: true, path: null }
  const next = argv[i + 1]
  if (next === undefined || next === null || String(next).trim() === '') {
    return { ok: false, code: 'REGEN_PACKET_PATH_MISSING', why: '--regen-packet 뒤에 경로가 없다' }
  }
  if (String(next).startsWith('--')) {
    return { ok: false, code: 'REGEN_PACKET_PATH_MISSING',
      why: `--regen-packet 뒤가 경로가 아니라 다른 옵션이다: ${next}` }
  }
  return { ok: true, path: String(next) }
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
  return `${where}${r?.reason ?? 'unknown'}${detail ? ` — ${detail}` : ''}${extra} · 전송 ${r?.sent ? '1건' : '0건'}`
}

async function fetchSlug(slug, { quiet = false, force = false, regenPacket = null } = {}) {
  const dir = join(DRAFTS_DIR, slug)
  const briefPath = join(dir, 'brief.md')
  const outPath = join(dir, 'draft.md')

  // 🔴 기본은 덮어쓰지 않는다. --force 는 사람이 한 건씩 켜는 손잡이다 —
  //    일괄 회수(--fetch-run)에는 넘기지 않는다. 무인 경로가 원고를 갈아엎으면
  //    사람이 손본 문장이 조용히 사라진다.
  if (existsSync(outPath) && !force) {
    return { slug, status: 'skipped', reason: 'draft_exists', sent: false }
  }
  if (!existsSync(briefPath)) return { slug, status: 'skipped', reason: 'brief_missing', sent: false }

  // brief 의 "반드시 그대로 넣을 문장" 을 대조 기준으로 뽑는다
  const brief = readFileSync(briefPath, 'utf8')
  const markerBlock = brief.split('## 반드시 그대로 넣을 문장')[1]
  const markers = markerBlock
    ? [...markerBlock.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5)
    : []

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

  const prompt = [
    '첨부한 brief.md 의 지시를 그대로 따라 최종 원고를 작성하세요.',
    '설명·인사·요약·후기를 붙이지 말고 원고 전체만 출력합니다.',
    '출력은 마크다운 코드블록 안에 마크다운 원본 표기 그대로 넣어 주세요.',
    'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',
    // 🔴 관문이 막는 것을 프롬프트에서도 한 번 말한다. 막는 것보다 안 나오게 하는 편이 싸다.
    '웹 검색 인용 표기나 각주 마커를 본문에 남기지 마세요.',
    // 🔴 재생성이면 무엇이 걸렸는지 그대로 붙인다
    ...(packet ? ['', '--- 이전 원고가 자동 검사에 걸렸습니다 ---', packet.instruction] : []),
  ].join(' ')

  // 🔴 관문을 쓰기 직전에 건넨다. 막히면 파일이 생기지 않는다.
  const r = await fetchManuscript({
    briefPath,
    outPath,
    promptText: prompt,
    requiredMarkers: markers,
    validate: validateManuscript,
  })
  if (r.ok) return { slug, status: 'ok', sent: r.sent, length: r.length }
  return {
    slug,
    status: 'failed',
    reason: r.reason,
    sent: r.sent,
    missingCount: r.missingCount,
    invalid: r.invalid ?? null,
    // 🔴 여기서 버리면 운영 로그까지 `connect_failed` 한 단어로 도착한다 (2026-09-27)
    stage: r.stage ?? null,
    errorName: r.errorName ?? null,
    errorDetail: r.errorDetail ?? null,
  }
}

/** 저장된 원고를 기계 검사만 한다. 내용을 출력하지 않는다 */
function describeDraft(slug) {
  const t = readFileSync(join(DRAFTS_DIR, slug, 'draft.md'), 'utf8')
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

/** 단건 CLI — 사람이 부르는 경로 */
async function fetchOne(slug, { force = false, regenPacket = null } = {}) {
  console.log('')
  console.log(`  원고 요청 — ${slug}`)

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
      process.exit(1)
    }
    console.log(`  0) 재생성 패킷 확인 — 실패 ${pr.packet.failures.length}건`)
  }

  console.log('  1) 접근 확인')
  const p = await probe({ autoStart: true })
  console.log(`     status ${p.status}`)
  if (p.status !== STATUS.OK) {
    console.error('')
    console.error(`  ⛔ ${MESSAGE[p.status] ?? MESSAGE[STATUS.UNKNOWN]}`)
    // 상태 코드만 찍으면 무엇이 거부됐는지 로그에 남지 않는다
    if (p.errorDetail) console.error(`     ${p.errorDetail}`)
    console.error('     한 글자도 보내지 않았다.')
    console.error('')
    process.exit(1)
  }

  console.log(`  2) 회수${force ? ' (--force — 기존 draft.md 를 덮어쓴다)' : ''}`)
  const r = await fetchSlug(slug, { force, regenPacket })
  if (r.status === 'skipped') {
    console.log(`     건너뜀 — ${r.reason === 'draft_exists' ? '이미 draft.md 가 있다 (덮어쓰려면 --force)' : 'brief.md 가 없다'}`)
    console.log('')
    process.exit(r.reason === 'brief_missing' ? 1 : 0)
  }
  if (r.status === 'failed') {
    console.error(`     ⛔ ${describeFetchFailure(r)}`)
    // 🔴 관문에 막혔으면 무엇이 걸렸는지 한 줄씩 말한다. 코드만 찍으면 고칠 수가 없다.
    if (r.invalid?.length) {
      console.error('     관문에 막혔다 — 저장하지 않았다:')
      for (const x of r.invalid) console.error(`       · ${x.code}: ${x.why}`)
    }
    console.error('')
    process.exit(1)
  }

  const d = describeDraft(slug)
  console.log(`     ✅ 저장 · 전송 1건 · 본문 ${d.length}자`)
  console.log('')
  console.log(`     drafts/magazine/${slug}/draft.md`)
  console.log(`     frontmatter ${d.frontmatter ? '✅' : '🔴'} · h2 ${d.h2}개 · CTA ${d.cta}개`)
  console.log(`     금지 표기: 표 ${d.forbidden.table ? '🔴' : '0'} · http ${d.forbidden.http ? '🔴' : '0'}` +
    ` · 굵게 ${d.forbidden.bold ? '🔴' : '0'} · 번호목록 ${d.forbidden.numbered ? '🔴' : '0'}`)
  console.log('')
  console.log('  🔴 md-to-draft · batch-qa · register 는 실행하지 않았다.')
  console.log('')
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
async function fetchBatch({ date, dryRun, limit }) {
  const run = loadRun(date)
  const targets = inspectTargets(run)

  console.log('')
  console.log(`  원고 일괄 회수 — ${date}${dryRun ? ' (dry-run)' : ''}`)
  if (!run) {
    console.log('  producer 산출물이 없다 — 오늘 run.json 을 찾지 못했다')
    console.log('')
    return { planned: [], results: [], sentTotal: 0 }
  }
  console.log(`  producer ${run.status} · 재고 ${run.inventoryDays}일 · selected ${targets.length}건`)
  console.log('')

  // 무엇을 보낼지 먼저 확정한다. dry-run 은 여기까지만 한다
  const planned = targets.map((t) => ({
    slug: t.slug,
    action: t.draftMd ? 'skip:draft_exists' : !t.brief ? 'skip:brief_missing' : 'fetch',
  }))
  for (const p of planned) {
    const mark = p.action === 'fetch' ? '→ 전송' : `– 건너뜀 (${p.action.split(':')[1]})`
    console.log(`    ${p.slug.padEnd(34)}${mark}`)
  }
  const toFetch = planned.filter((p) => p.action === 'fetch')
  console.log('')
  console.log(`  전송 예정 ${toFetch.length}건 · 건너뜀 ${planned.length - toFetch.length}건`)

  if (dryRun) {
    console.log('')
    console.log('  🔴 dry-run — 한 글자도 보내지 않았다.')
    console.log('')
    return { planned, results: [], sentTotal: 0 }
  }

  const results = []
  let sentTotal = 0

  if (toFetch.length) {
    console.log('')
    console.log('  접근 확인')
    const p = await probe({ autoStart: true })
    console.log(`    status ${p.status}`)
    if (p.status !== STATUS.OK) {
      console.log('')
      console.log(`  ⛔ ${MESSAGE[p.status] ?? MESSAGE[STATUS.UNKNOWN]} — 한 글자도 보내지 않았다`)
      if (p.errorDetail) console.log(`     ${p.errorDetail}`)
      console.log('')
      return { planned, results: [{ slug: '-', status: 'failed', reason: p.status, sent: false }], sentTotal: 0, fatal: p.status }
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
    const r = await fetchSlug(p.slug)
    if (r.sent) sentTotal += 1
    results.push(r)

    if (r.status === 'ok') {
      const d = describeDraft(p.slug)
      console.log(`     ✅ ${d.length}자 · h2 ${d.h2} · CTA ${d.cta}`)
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
  console.log(`  결과: 저장 ${ok} · 실패 ${failed} · 건너뜀 ${results.filter((r) => r.status === 'skipped').length} · 전송 ${sentTotal}건`)
  console.log('')
  console.log('  🔴 md-to-draft · batch-qa · register 는 실행하지 않았다.')
  console.log('')
  return { planned, results, sentTotal, fatal }
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
  if (argv.includes('--login')) return await login()
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
    const rp = readRegenPacketArg(argv)
    if (!rp.ok) {
      console.error('')
      console.error(`  ⛔ ${rp.code} — ${rp.why}`)
      console.error('     한 글자도 보내지 않았다. (전송 0건)')
      console.error('')
      process.exit(1)
    }
    return await fetchOne(slug, { force: argv.includes('--force'), regenPacket: rp.path })
  }
  if (argv.includes('--fetch-run')) {
    const date = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : todayKst()
    const limitArg = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : null
    const r = await fetchBatch({ date, dryRun: argv.includes('--dry-run'), limit: limitArg })
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
  const targets = inspectTargets(run)

  let access = { status: null, severity: null, message: null }
  if (wantProbe) {
    const r = await probe({ autoStart })
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
    console.log('  🔴 원고 생성·첨부·전송·다운로드는 아직 구현되지 않았다.')
    console.log('')
  }

  const blocked = wantProbe && access.status !== STATUS.OK
  process.exit(blocked ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-webui-runner.mjs')) main()
