#!/usr/bin/env node
/**
 * 연구 저장소 옛 graph 도구 퇴역 CLI (lib 머리말 참조).
 *
 *   node scripts/magazine-research-legacy-fence.mjs status   --research <연구>
 *   node scripts/magazine-research-legacy-fence.mjs apply    --research <연구> [--write]
 *   node scripts/magazine-research-legacy-fence.mjs rollback --research <연구> [--write]
 *
 * 🔴 기본은 dry-run — 쓰기 0. 급사 뒤에는 같은 명령을 다시 돌리면 남은 파일만 마저 한다.
 * 종료 코드: 0 성공 · 1 거부 · 2 사용법 오류
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

import { fenceStatus, runFence } from './lib/magazine-research-legacy-fence.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const arg = (n) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }
if (!cmd || cmd === '--help') { process.stdout.write('옛 graph 도구 퇴역 — status · apply · rollback (머리말). 인자 없이는 아무것도 읽거나 쓰지 않는다.\n'); process.exit(0) }
const root = arg('--research') ? realpathSync(resolve(arg('--research'))) : usage('--research 가 필요하다')
if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(root)) usage('운영 runtime 은 받지 않는다')
const out = (v) => { process.stdout.write(`${JSON.stringify(v, null, 2)}\n`); process.exit(v.ok === false ? 1 : 0) }
if (cmd === 'status') out({ ok: true, ...fenceStatus(root) })
else if (cmd === 'apply' || cmd === 'rollback') out(runFence({ root, op: cmd, write: argv.includes('--write') }))
else usage(`모르는 명령 ${cmd}`)
