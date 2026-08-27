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
  probe, fetchManuscript, isFatal, browserAvailable, profileExists, profileInUse, cdpAvailable,
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
  node scripts/magazine-webui-runner.mjs --fetch <slug>      한 건 회수
  node scripts/magazine-webui-runner.mjs --fetch-run --dry-run
                                                             오늘 selected 순회 계획만 (전송 0건)
  node scripts/magazine-webui-runner.mjs --fetch-run [--limit N]
                                                             오늘 selected 를 순회하며 회수
  node scripts/magazine-webui-runner.mjs --dry-run --json

🔴 --fetch 는 draft.md 까지만 만든다. md-to-draft·batch-qa·register 는 돌리지 않는다.
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
async function fetchSlug(slug, { quiet = false } = {}) {
  const dir = join(DRAFTS_DIR, slug)
  const briefPath = join(dir, 'brief.md')
  const outPath = join(dir, 'draft.md')

  if (existsSync(outPath)) return { slug, status: 'skipped', reason: 'draft_exists', sent: false }
  if (!existsSync(briefPath)) return { slug, status: 'skipped', reason: 'brief_missing', sent: false }

  // brief 의 "반드시 그대로 넣을 문장" 을 대조 기준으로 뽑는다
  const brief = readFileSync(briefPath, 'utf8')
  const markerBlock = brief.split('## 반드시 그대로 넣을 문장')[1]
  const markers = markerBlock
    ? [...markerBlock.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5)
    : []

  if (!quiet) console.log(`     전송 — 대조 문장 ${markers.length}개`)

  const prompt = [
    '첨부한 brief.md 의 지시를 그대로 따라 최종 원고를 작성하세요.',
    '설명·인사·요약·후기를 붙이지 말고 원고 전체만 출력합니다.',
    '출력은 마크다운 코드블록 안에 마크다운 원본 표기 그대로 넣어 주세요.',
    'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',
  ].join(' ')

  const r = await fetchManuscript({ briefPath, outPath, promptText: prompt, requiredMarkers: markers })
  if (r.ok) return { slug, status: 'ok', sent: r.sent, length: r.length }
  return { slug, status: 'failed', reason: r.reason, sent: r.sent, missingCount: r.missingCount }
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
async function fetchOne(slug) {
  console.log('')
  console.log(`  원고 요청 — ${slug}`)
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

  console.log('  2) 회수')
  const r = await fetchSlug(slug)
  if (r.status === 'skipped') {
    console.log(`     건너뜀 — ${r.reason === 'draft_exists' ? '이미 draft.md 가 있다 (덮어쓰지 않는다)' : 'brief.md 가 없다'}`)
    console.log('')
    process.exit(r.reason === 'brief_missing' ? 1 : 0)
  }
  if (r.status === 'failed') {
    console.error(`     ⛔ ${r.reason}${r.missingCount ? ` (지정 문장 ${r.missingCount}개 누락)` : ''} · 전송 ${r.sent ? '1건' : '0건'}`)
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
      console.log(`     ⛔ ${r.reason}`)
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

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  if (argv.includes('--login')) return await login()
  if (argv.includes('--fetch')) {
    const slug = argv[argv.indexOf('--fetch') + 1]
    if (!slug || slug.startsWith('--')) {
      console.error('  --fetch <slug> 가 필요하다')
      process.exit(2)
    }
    return await fetchOne(slug)
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
