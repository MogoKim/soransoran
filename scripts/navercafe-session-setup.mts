#!/usr/bin/env tsx
/**
 * 소란소란 전용 네이버 세션 발급 — 🔴 로컬 Mac 전용 · 사람이 직접 로그인한다
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §5 · PR-S2-b-3
 *
 * 🔴 **이 코드는 비밀번호를 만지지 않는다.**
 *    아이디·비밀번호·2단계 인증을 전부 **사람이 브라우저 창에서 직접** 입력한다.
 *    스크립트가 하는 일은 창을 띄우고, 사람이 끝났다고 하면 storageState 를 저장하는 것뿐이다.
 *    자동 로그인을 넣지 않는 이유: 자격증명이 코드·로그·셸 히스토리에 남으면 그때부터
 *    유출 경로가 생긴다. 사람이 한 번 치는 비용이 그것보다 싸다.
 *
 * 🔴 **쿠키 값을 출력하지 않는다.**
 *    요약은 개수와 만료일뿐이다(summarizeCookies). 그 함수의 입력 타입에는 `value` 가 아예 없다 —
 *    타입에 없으면 실수로도 찍을 수 없다.
 *
 * 🔴 **우나어 세션을 재사용하지 않는다.**
 *    경로에 `unao` 또는 `agents/cafe/storage-state.json` 이 들어가면 저장을 거부한다.
 *    한쪽 계정이 막히면 둘 다 멈추고, 우나어 운영 계정을 이 실험에 노출시키는 셈이다.
 *
 * 🔴 **gitignore 로 막히지 않은 경로에는 저장하지 않는다.**
 *    저장하고 나서 확인하면 이미 워킹트리에 쿠키가 놓인 뒤다. 저장 **전에** 본다.
 *
 * 🔴 **DB · Sheet · Candidate · Post 를 건드리지 않는다.** prisma 를 import 하지 않는다.
 *    네이버 카페 글도 읽지 않는다 — 로그인 페이지와, 저장 직전 **카페 홈**(회원 확인)만 연다.
 *
 * 🔴 **로그인과 카페 회원은 다르다** (2026-10-04~07 실측).
 *    10/3 밤 재발급 세션은 인증 쿠키 2종이 유효했지만 두 카페가 회원으로 인정하지 않았고,
 *    수집기는 3일 넘게 본문 대신 가입 안내를 저장했다. 그래서 저장 **전에** 활성 카페마다
 *    홈을 열어 회원인지 본다(회원 = "카페 글쓰기" · 비회원 = "카페 가입하기", 2026-10-07 실측).
 *
 * 사용법
 *   npx tsx scripts/navercafe-session-setup.mts            계획만 (브라우저를 열지 않는다)
 *   npx tsx scripts/navercafe-session-setup.mts --open     🔴 창을 띄운다 (사람이 직접 로그인)
 *   npx tsx scripts/navercafe-session-setup.mts --open --path=<경로>
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import {
  DEFAULT_SESSION_PATH, SESSION_PATH_ENV, KILL_SWITCH_ENV,
  PLAYWRIGHT_SPECS, BROWSER_CHANNEL_ENV, browserLaunchOptions,
  isUnaoSessionPath, isSessionPathIgnored, summarizeCookies, activeCafes,
  type CookieMeta,
} from './lib/micro-seed-navercafe.mjs'
import { judgeCafeMembership } from '../src/lib/naver-member-gate'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
import {
  judgeSessionLocation, judgeStorageStateShape, SESSION_DIR_MODE, SESSION_FILE_MODE,
} from '../src/lib/naver-session-canon'
import { judgeAuthCookies } from '../src/lib/collect-run-record'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const has = (n: string) => argv.includes(`--${n}`)

const fail = (m: string): never => {
  console.error(`\n❌ ${m}\n`)
  process.exit(1)
}

/** 🔴 로그인 페이지와 카페 홈만 연다. 카페 글은 이 스크립트가 읽지 않는다 */
const LOGIN_URL = 'https://nid.naver.com/nidlogin.login'
const CAFE_HOME_URL = (cafeId: string) => `https://cafe.naver.com/${cafeId}`

// 브라우저 타입 — 동적 import 라 최소 형태만 선언한다
type SessionCookieDump = { cookies: CookieMeta[] }
type SessionPage = {
  goto: (url: string, o: object) => Promise<unknown>
  waitForTimeout: (ms: number) => Promise<void>
  frames: () => { evaluate: (fn: () => string) => Promise<string> }[]
  close: () => Promise<void>
}
type SessionContext = {
  newPage: () => Promise<SessionPage>
  storageState: (o: { path: string }) => Promise<SessionCookieDump>
}
type SessionBrowser = { close: () => Promise<void>; newContext: (o: object) => Promise<SessionContext> }
type Chromium = { launch: (o: object) => Promise<SessionBrowser> }

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
      '     npm i -D playwright-core',
  )
}

/** 사람이 "다 됐다" 고 말할 때까지 기다린다 — 🔴 자동 판정하지 않는다 */
function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve() }))
}

async function main(): Promise<void> {
  // 🔴 await 를 빠뜨리면 .env.local 의 SORAN_NAVERCAFE_SESSION_PATH 가 조용히 무시되고
  //    기본 경로로 저장된다 — 실패가 아니라 "다른 곳에 저장" 이라 알아채기 어렵다
  await loadEnvLocal()
  const now = new Date()

  console.log('\n소란소란 전용 네이버 세션 발급')
  console.log('─────────────────────────────────────────────')
  console.log(`  ${kstString(now)} KST\n`)

  // ── ① 저장 경로 판정 (🔴 브라우저를 열기 전에 전부 본다) ──
  const target = arg('path') ?? process.env[SESSION_PATH_ENV] ?? DEFAULT_SESSION_PATH
  const rel = isAbsolute(target) ? relative(process.cwd(), target) : target.replace(/^\.\//, '')

  console.log(`  저장 경로  ${target}`)

  /**
   * 🔴 **운영과 같은 경로 계약을 setup 에도 적용한다** (2026-09-10).
   *    한쪽만 엄격하면 사람이 느슨한 쪽으로 파일을 만들고, 그것이 운영에서 막힌다.
   */
  const loc = judgeSessionLocation(target, true)
  if (!loc.ok) fail(`🔴 ${loc.code} — ${loc.reason}`)
  console.log(`  ✅ ${loc.reason}`)

  if (isUnaoSessionPath(target)) {
    fail(
      '🔴 우나어 세션 경로다 — 저장을 거부한다.\n' +
        '   우나어 세션을 재사용하면 한쪽이 막힐 때 둘 다 멈추고,\n' +
        '   우나어 운영 계정을 이 실험에 노출시키는 셈이다.\n' +
        `   소란소란 전용 계정으로 따로 발급한다: ${DEFAULT_SESSION_PATH}`,
    )
  }
  console.log('  ✅ 우나어 경로 아님')

  // 🔴 repo 밖이면 gitignore 와 무관하다. repo 안이면 반드시 막혀 있어야 한다
  const insideRepo = !rel.startsWith('..') && !isAbsolute(rel)
  if (insideRepo) {
    const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf-8') : ''
    if (!isSessionPathIgnored(rel, gi)) {
      fail(
        `🔴 ${rel} 은 .gitignore 로 막혀 있지 않다 — 저장을 거부한다.\n` +
          '   쿠키가 워킹트리에 놓이면 다음 커밋에 딸려 들어갈 수 있고,\n' +
          '   히스토리에 한 번 들어가면 지워도 남는다.\n' +
          '   .gitignore 에 `.naver-session/` 를 추가하고 다시 실행한다.',
      )
    }
    console.log('  ✅ .gitignore 로 막혀 있음')
  } else {
    console.log('  ✅ repo 밖 경로 (git 이 볼 수 없다)')
  }

  if (existsSync(target)) {
    console.log(`  🟡 이미 파일이 있다 — 계속하면 덮어쓴다 (${statSync(target).size} B)`)
  }

  // ── ② 계획만 ──
  if (!has('open')) {
    console.log('\n  계획만 출력했다. 브라우저를 열지 않았다.')
    console.log('\n  창을 띄우려면:')
    console.log('     npx tsx scripts/navercafe-session-setup.mts --open')
    console.log('\n  🔴 창이 뜨면 아이디·비밀번호·2단계 인증을 **직접** 입력한다.')
    console.log('     이 스크립트는 자격증명을 만지지 않는다.\n')
    console.log(`  발급 후 .env.local 에 넣을 키 (값은 사람이 직접 적는다):`)
    console.log(`     ${SESSION_PATH_ENV}=${DEFAULT_SESSION_PATH}`)
    console.log(`     ${KILL_SWITCH_ENV}=false      🔴 수집 개시는 별도 승인이다\n`)
    return
  }

  // ── ③ 창을 띄우고 사람을 기다린다 ──
  const chromium = await loadChromium()
  // 🔴 headed 다. 로그인은 사람이 한다 — headless 로는 2단계 인증을 통과할 수 없다
  const launchOpts = browserLaunchOptions({ channel: process.env[BROWSER_CHANNEL_ENV], headless: false })
  console.log(`\n  브라우저: ${launchOpts.channel ?? '번들 chromium'} (headed)`)

  let browser: SessionBrowser | null = null
  try {
    browser = await chromium.launch(launchOpts)
    const context = await browser.newContext({ locale: 'ko-KR' })
    const page = await context.newPage()
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    console.log('\n  🔴 열린 창에서 직접 로그인하십시오.')
    console.log('     · 소란소란 전용 계정을 씁니다 (우나어 계정 아님)')
    console.log('     · 2단계 인증 · 기기 등록까지 끝냅니다')
    console.log('     · 카페에 한 번 들어가 로그인이 유지되는지 확인합니다\n')
    await waitForEnter('  로그인이 끝났으면 Enter ▶ ')

    /**
     * 🔴 **target 에 직접 쓰지 않는다** (2026-09-10 정정).
     *
     *    옛 판은 `storageState({ path: target })` 로 정본 자리에 곧바로 썼다.
     *    로그인이 안 잡힌 채 Enter 를 누르면 **인증 쿠키가 없는 파일이
     *    멀쩡하던 정본을 덮어썼다.** 되돌릴 방법이 없다.
     *
     *    같은 디렉터리의 staging 에 쓰고 → 모양·인증·만료를 보고 →
     *    600 으로 맞춘 뒤 → atomic rename 한다.
     */
    mkdirSync(dirname(target), { recursive: true, mode: SESSION_DIR_MODE })
    chmodSync(dirname(target), SESSION_DIR_MODE)
    const staging = join(dirname(target), `.staging-${process.pid}.json`)
    const state = await context.storageState({ path: staging })
    chmodSync(staging, SESSION_FILE_MODE)

    // ── ④ 요약 — 🔴 값이 아니라 개수와 만료일만 ──
    const sum = summarizeCookies(state.cookies ?? [])
    console.log(`\n     쿠키 ${sum.total}개 (naver.com ${sum.naverDomain}개)`)
    for (const c of sum.auth) console.log(`     ${c.name} 만료 ${c.expiresAt ?? '세션(브라우저 종료 시 사라짐)'}`)

    // 🔴 staging 을 검사한다 — 모양 · 인증 쿠키 · 만료
    const shape = judgeStorageStateShape(readFileSync(staging, 'utf-8'))
    const auth = judgeAuthCookies(state.cookies ?? [], Date.now())
    if (shape !== 'ok' || !auth.ok) {
      rmSync(staging, { force: true })
      const why = shape !== 'ok' ? 'storageState 모양이 아니다' : auth.reason
      console.log(`\n  🔴 저장하지 않았다 — ${why}`)
      console.log(`     기존 정본은 그대로다${existsSync(target) ? ' (덮어쓰지 않았다)' : ' (아직 없다)'}.`)
      console.log('     다시 실행해 로그인을 끝낸 뒤 Enter 를 누른다.')
      fail('🔴 인증이 확인되지 않아 정본을 갱신하지 않았다')
    }
    /**
     * 🔴 **카페 회원인지 저장 전에 본다** — 인증 쿠키가 유효해도 회원이 아닐 수 있다.
     *    같은 창(같은 로그인)으로 활성 카페의 홈만 연다. 못 읽었으면(unknown) 회원으로 치지 않는다.
     */
    console.log('\n  카페 회원 확인 (카페 홈만 연다 · 글은 열지 않는다)')
    const notMember: string[] = []
    for (const c of activeCafes()) {
      const p = await context.newPage()
      let text = ''
      try {
        await p.goto(CAFE_HOME_URL(c.cafeId), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await p.waitForTimeout(4_000)
        for (const f of p.frames()) {
          try { text += `\n${await f.evaluate(() => document.body?.innerText ?? '')}` } catch { /* 다른 출처 프레임 */ }
        }
      } catch { /* 못 열었다 — 아래에서 unknown 으로 본다 */ }
      await p.close().catch(() => {})
      const m = judgeCafeMembership(text)
      console.log(`     ${m === 'member' ? '🟢' : '🔴'} ${c.label} — ${m === 'member' ? '회원' : m === 'nonMember' ? '회원 아님(카페 가입하기 버튼)' : '확인 불가'}`)
      if (m !== 'member') notMember.push(c.label)
    }
    if (notMember.length > 0) {
      rmSync(staging, { force: true })
      console.log(`\n  🔴 저장하지 않았다 — ${notMember.join(' · ')} 회원으로 확인되지 않았다`)
      console.log(`     기존 정본은 그대로다${existsSync(target) ? ' (덮어쓰지 않았다)' : ' (아직 없다)'}.`)
      console.log('     두 카페에 가입된 계정으로 다시 로그인하거나, 창에서 카페에 가입한 뒤 다시 실행한다.')
      fail('🔴 카페 회원으로 확인되지 않아 정본을 갱신하지 않았다')
    }
    // 🔴 여기까지 왔으면 유효하다. 한 번의 rename 으로 들여놓는다
    renameSync(staging, target)
    chmodSync(target, SESSION_FILE_MODE)
    console.log(`\n  ✅ 저장 완료 · 권한 600 · ${auth.reason}`)
    console.log('\n  🔴 쿠키 값은 출력하지 않았다. 이 파일을 열어보거나 공유하지 마십시오.\n')
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  console.log('  다음:')
  console.log(`     ① .env.local 에 ${SESSION_PATH_ENV} · ${KILL_SWITCH_ENV} 추가`)
  console.log('     ② 첫 live 수집은 별도 승인 후:')
  console.log('        npx tsx scripts/micro-seed-collect-navercafe.mts --cafe=remonterrace --pages=1 --max=3 --live\n')
}

main().catch((e) => fail(String(e)))
