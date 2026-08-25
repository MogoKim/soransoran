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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, DRAFTS_DIR } from './lib/magazine-load.mjs'
import {
  probe, browserAvailable, profileExists,
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
  node scripts/magazine-webui-runner.mjs --login             로그인용 창 (사람이 1회)
  node scripts/magazine-webui-runner.mjs --dry-run --json

🔴 원고를 만들지 않는다. 첨부·전송·다운로드 코드가 아직 없다.
🔴 headed 로만 돈다 — headless 는 Cloudflare 가 막는다.
🔴 Slack 을 보내지 않는다. 알림 등급만 계산해 반환한다.`)
}

async function login() {
  if (!browserAvailable()) {
    console.error(`  ⛔ ${MESSAGE[STATUS.BROWSER_MISSING]}`)
    process.exit(1)
  }
  const { chromium } = await import('playwright-core')
  console.log('')
  console.log('  로그인용 창을 엽니다. ChatGPT 에 로그인한 뒤 창을 닫으세요.')
  console.log(`  프로필: ${PROFILE_DIR}`)
  console.log('')
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, channel: 'chrome' })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' })
  // 사람이 닫을 때까지 기다린다
  await new Promise((resolve) => ctx.on('close', resolve))
  console.log('  창이 닫혔습니다. --dry-run --probe 로 상태를 확인하세요.')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  if (argv.includes('--login')) return login()

  const dryRun = argv.includes('--dry-run')
  if (!dryRun) {
    console.error('  이 단계에서는 --dry-run 만 쓸 수 있다. 원고 생성은 아직 구현되지 않았다.')
    process.exit(2)
  }

  const wantProbe = argv.includes('--probe')
  const asJson = argv.includes('--json')
  const date = argv.includes('--date') ? argv[argv.indexOf('--date') + 1] : todayKst()

  const run = loadRun(date)
  const targets = inspectTargets(run)

  let access = { status: null, severity: null, message: null }
  if (wantProbe) {
    const r = await probe()
    access = {
      status: r.status,
      severity: SEVERITY[r.status] ?? 'ERROR',
      message: MESSAGE[r.status] ?? MESSAGE[STATUS.UNKNOWN],
      launched: r.launched,
      httpStatus: r.httpStatus,
      profileExists: r.profileExists,
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
      console.log(`    브라우저 실행 ${access.launched ? '✅' : '🔴'} · HTTP ${access.httpStatus ?? '-'} · 프로필 ${access.profileExists ? '있음' : '없음'}`)
      if (access.severity) {
        console.log(`    Slack 등급 ${access.severity} (이번 단계에서는 보내지 않는다)`)
      }
      if (access.status === STATUS.LOGIN_REQUIRED || !access.profileExists) {
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
