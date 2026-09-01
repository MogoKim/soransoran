#!/usr/bin/env node
/**
 * launchd 진입점 — producer(00:10 KST) 다음 자리. 자동 레인을 돌리고 리포트한다.
 *
 *   00:10 KST  magazine-producer-run.mjs      선정 · brief · 원고 회수 · 알림
 *   02:00 KST  이 스크립트                    변환 · QA · batch-qa · hero · register · PR
 *
 *   (00:10 은 producer plist 의 실제 StartCalendarInterval 이다.
 *    02:00 은 producer 가 끝난 뒤라는 순서만 지키면 된다.)
 *
 * 🔴 기본이 dry-run 이다.
 *    plist 는 이 스크립트를 인자 없이 부른다 — 그러면 dry-run 리포트만 나간다.
 *    등록 write 를 무인으로 여는 것은 창업자가 plist 에 --write 를 넣는 순간뿐이다.
 *    "연결은 해 두되 write 는 사람이 켠다" 가 오늘의 선이다.
 *
 * 🔴 새벽 dry-run 회차는 Slack 을 보내지 않는다.
 *    여기서 붙이는 것은 --notify 다 — 보낼 문구를 만들어 로그에 남기기만 한다.
 *    실제 발송은 --notify-send 를 창업자가 넣어야 열린다.
 *    → **새벽 감시 기준은 launchd 로그다**:
 *       ~/Library/Logs/soransoran/magazine-auto-register.log
 *       리포트 JSON(_runs/{date}/auto-register.json)은 --write 회차만 남긴다.
 *
 * 🔴 실패해도 launchd 를 실패로 만들지 않는다.
 *    리포트가 목적이다. 종료 코드는 항상 0 으로 넘긴다 —
 *    BLOCKED 가 있다는 사실은 로그가 전한다.
 *
 * 사용법
 *   node scripts/magazine-auto-register-run.mjs              dry-run + 로그 리포트 (발송 0)
 *   node scripts/magazine-auto-register-run.mjs --write --pr 실제 등록 + PR (사람이 켠다)
 *   node scripts/magazine-auto-register-run.mjs --notify-send  Slack 실제 발송까지
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath
const READY = join(ROOT, 'scripts/magazine-auto-register-ready.mjs')

function stamp() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST'
}
const line = (m) => console.log(`[${stamp()}] ${m}`)

const passthrough = process.argv.slice(2)
const write = passthrough.includes('--write')
const args = [READY, ...(write ? passthrough : ['--dry-run', ...passthrough]), '--notify']

line(`매거진 자동 레인 시작${write ? '' : ' (dry-run)'}`)
const r = spawnSync(NODE, args, { cwd: ROOT, stdio: 'inherit' })
if (r.error) line(`실행 실패 — ${r.error.code ?? r.error.name}`)
else line(r.status === 1 ? 'BLOCKED 가 있었다 (리포트 참조)' : '진행 완료')
line('종료 (코드 0)')
process.exit(0)
