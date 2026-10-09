#!/usr/bin/env tsx
/**
 * 매거진 launchd 설치기 회귀 — 🔴 **파일을 쓰지 않고 launchctl 도 부르지 않는다.**
 *
 * `magazine-auto-register-check.mjs` 는 node 로 도는 .mjs 라 .mts 설치기를 import 할 수 없다.
 * 설치기의 판정 함수(순수 함수)는 여기서 본다.
 *
 * 사용법: npm run magazine:launchd-check
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { leftoverPlaceholders, render, templatePathOf } from './lib/launchd-install.mjs'
import {
  FORBIDDEN_ROOTS, MAGAZINE_JOBS, MAGAZINE_RUNTIME, MAGAZINE_TEMPLATE_DIR, judgeReceipt, judgeRuntime, launchdPath,
} from './magazine-launchd-install.mjs'

let pass = 0
let fail = 0
function expect(label: string, actual: unknown, want: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}

console.log('\n══════ PATH — launchd 는 셸 프로필을 읽지 않는다')
const p = launchdPath('/Users/x/.nvm/versions/node/v24.14.0/bin', '/Users/x')
// 🔴 이 두 줄이 2026-09-15 장애의 절반이다
expect('gh 를 찾을 수 있다 (/opt/homebrew/bin)', p.includes('/opt/homebrew/bin'), true)
expect('claude 를 찾을 수 있다 (~/.local/bin)', p.includes('/Users/x/.local/bin'), true)
expect('node 를 찾을 수 있다', p.includes('/Users/x/.nvm/versions/node/v24.14.0/bin'), true)
expect('시스템 경로가 남아 있다', p.endsWith('/usr/bin:/bin:/usr/sbin:/sbin'), true)

console.log('\n══════ runtime worktree — 개발 작업트리를 물지 않는다')
expect(
  '개발 작업트리는 거부한다',
  judgeRuntime({ exists: true, branch: 'main', dirty: false, root: FORBIDDEN_ROOTS[0]! }).blockedBy[0]!.code,
  'RUNTIME_IS_DEV_TREE',
)
expect(
  'D100 runtime 도 거부한다 (매거진 전용이 따로 있다)',
  judgeRuntime({ exists: true, branch: 'main', dirty: false, root: FORBIDDEN_ROOTS[2]! }).blockedBy[0]!.code,
  'RUNTIME_IS_DEV_TREE',
)
expect('없으면 막는다', judgeRuntime({ exists: false, branch: null, dirty: false, root: MAGAZINE_RUNTIME }).blockedBy[0]!.code, 'RUNTIME_MISSING')
expect('main 이 아니면 막는다', judgeRuntime({ exists: true, branch: 'feat/x', dirty: false, root: MAGAZINE_RUNTIME }).blockedBy[0]!.code, 'RUNTIME_NOT_ON_MAIN')
expect('더러우면 막는다', judgeRuntime({ exists: true, branch: 'main', dirty: true, root: MAGAZINE_RUNTIME }).blockedBy[0]!.code, 'RUNTIME_DIRTY')
expect('깨끗한 main 이면 통과', judgeRuntime({ exists: true, branch: 'main', dirty: false, root: MAGAZINE_RUNTIME }).ok, true)

console.log('\n══════ 활성화 게이트 — supervised 1회 성공 영수증')
/**
 * 🔴 경영 결정(2026-09-15)으로 "5일 관찰" 은 폐기됐다.
 *    대신 supervised end-to-end 1회 성공이 게이트다. 증거 없이 설치되지 않는다.
 */
expect('영수증이 없으면 막는다', judgeReceipt(null).ok, false)
expect('객체가 아니면 막는다', judgeReceipt('SUCCESS').ok, false)
expect('result 가 SUCCESS 가 아니면 막는다', judgeReceipt({ result: 'FAILED', prUrl: 'https://github.com/a/b/pull/1', ranAt: 'x' }).ok, false)
expect('PR URL 이 없으면 막는다', judgeReceipt({ result: 'SUCCESS', ranAt: 'x' }).ok, false)
expect('PR URL 이 GitHub 이 아니면 막는다', judgeReceipt({ result: 'SUCCESS', prUrl: 'http://evil/x', ranAt: 'x' }).ok, false)
expect('ranAt 이 없으면 막는다', judgeReceipt({ result: 'SUCCESS', prUrl: 'https://github.com/a/b/pull/1' }).ok, false)
expect(
  '갖춰지면 통과',
  judgeReceipt({ result: 'SUCCESS', prUrl: 'https://github.com/MogoKim/soransoran/pull/1', ranAt: '2026-09-15T02:00:00+09:00' }).ok,
  true,
)

console.log('\n══════ 템플릿 렌더 — placeholder 가 하나도 남지 않는다')
const vars = {
  npx: '/n/npx',
  node: '/n/node',
  nodebin: '/n',
  repo: MAGAZINE_RUNTIME,
  logdir: '/Users/x/Library/Logs/soransoran',
  extra: { __PATH__: launchdPath('/n', '/Users/x'), __HOME__: '/Users/x' },
}
for (const label of MAGAZINE_JOBS) {
  const tpl = templatePathOf(label, MAGAZINE_TEMPLATE_DIR)
  expect(`${label}: 템플릿이 있다`, existsSync(tpl), true)
  if (!existsSync(tpl)) continue
  const xml = render(readFileSync(tpl, 'utf-8'), vars)
  expect(`${label}: 치환되지 않은 placeholder 0`, leftoverPlaceholders(xml), [])
  expect(`${label}: 로그가 Documents 밖이다 (TCC)`, xml.includes('/Documents/') ? !/<key>Standard(Out|Error)Path<\/key>\s*<string>[^<]*\/Documents\//.test(xml) : true, true)
  expect(`${label}: WorkingDirectory 가 매거진 runtime 이다`, xml.includes(`<string>${MAGAZINE_RUNTIME}</string>`), true)
}

console.log('\n══════ 02:00 자동 병합 복구 job — 01:00 이 못 끝낸 자동 PR 을 같은 관문으로 (2026-10-09 #675)')
{
  const RECOVERY = 'com.soransoran.magazine-auto-merge-recovery'
  expect('복구 job 이 설치 목록에 있다', (MAGAZINE_JOBS as readonly string[]).includes(RECOVERY), true)
  const rtpl = templatePathOf(RECOVERY, MAGAZINE_TEMPLATE_DIR)
  const rxml = existsSync(rtpl) ? readFileSync(rtpl, 'utf-8').replace(/<!--[\s\S]*?-->/g, '') : ''
  const args = [...(rxml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1])
  expect('복구 job 은 auto-merge 를 --recover 로 부른다', args.slice(1), ['__REPO__/scripts/magazine-auto-merge.mjs', '--recover', '--notify-send'])
  expect('🔴 복구 job 에 --watch · --apply 가 없다 (같은 관문은 --recover 안에서 재사용)', args.some((a) => a === '--watch' || a === '--apply'), false)
  expect('복구 job 은 02:00 KST 다', /<key>Hour<\/key><integer>2<\/integer><key>Minute<\/key><integer>0<\/integer>/.test(rxml), true)
  expect('🔴 복구 job 에 KeepAlive 가 없다 (재시도 신호가 아니다)', /KeepAlive/.test(rxml), false)
  expect('복구 job 은 로드 시 바로 돌지 않는다', /<key>RunAtLoad<\/key>\s*<false\/>/.test(rxml), true)
  const wxml = readFileSync(templatePathOf('com.soransoran.magazine-watch', MAGAZINE_TEMPLATE_DIR), 'utf-8').replace(/<!--[\s\S]*?-->/g, '')
  const wargs = [...(wxml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1])
  expect('🔴 11:00 watch 는 공개 확인 전용 — --watch 만 · --apply/--recover 없음', `${wargs.includes('--watch')}·${wargs.some((a) => a === '--apply' || a === '--recover')}`, 'true·false')
  expect('11:00 watch 시각 불변', /<key>Hour<\/key><integer>11<\/integer><key>Minute<\/key><integer>0<\/integer>/.test(wxml), true)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
