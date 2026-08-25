#!/usr/bin/env node
/**
 * ChatGPT web UI runner — 구조와 접근 판정까지. **이번 단계에서는 원고를 만들지 않는다.**
 *
 * 파이프라인에서 이 스크립트가 채울 자리
 *   producer ──▶ [webui runner] ──▶ md-to-draft ──▶ batch-qa ──▶ register ──▶ PR
 *                 ↑ 여기
 *
 * 🔴 지금 하지 않는 것 — 코드가 아예 없다
 *    brief 첨부 · 메시지 전송 · 응답 대기 · 원고 다운로드 · 파일 쓰기 · Slack 발송
 *    "비활성 플래그"로 막아 두지 않았다. 실수로 켜질 경로 자체를 두지 않는다.
 *
 * 🔴 지금 하는 것
 *    오늘 producer 가 고른 대상을 보여주고, ChatGPT 에 닿는지 상태만 판정한다.
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
import { ROOT, DRAFTS_DIR } from './lib/magazine-load.mjs'
import {
  probe, browserAvailable, profileExists, profileInUse, cdpAvailable,
  chromeArgs, CHROME_APP, CDP_PORT,
  STATUS, SEVERITY, MESSAGE, PROFILE_DIR, PROFILE_SETUP_GUIDE,
} from './lib/chatgpt-session.mjs'

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
  node scripts/magazine-webui-runner.mjs --dry-run --json

🔴 원고를 만들지 않는다. 첨부·전송·다운로드 코드가 아직 없다.
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

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  if (argv.includes('--login')) return await login()

  const dryRun = argv.includes('--dry-run')
  if (!dryRun) {
    console.error('  이 단계에서는 --dry-run 만 쓸 수 있다. 원고 생성은 아직 구현되지 않았다.')
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
