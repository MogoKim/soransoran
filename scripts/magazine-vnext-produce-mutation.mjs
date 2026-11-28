#!/usr/bin/env node
/**
 * vNext S4 생산기 검사의 변이 하네스 — 방어를 하나씩 끊은 사본으로 `magazine-vnext-produce-check.mjs` 를 돌려 **FAIL 해야** 한다.
 *
 *   node scripts/magazine-vnext-produce-mutation.mjs
 *
 * 🔴 변이 지점이 정확히 1곳이 아니면(하네스 결함 · exit 2) 그 변이는 실패로 센다 — 겨냥 문자열이 바뀌어 지점 0곳이 된 변이는 죽은 방어다.
 * 사본은 OS 임시 폴더에만 만든다(작업 트리 · 운영 경로 쓰기 0).
 * 마지막 줄: `vNext 생산기 변이: <n> killed, <n> survived`
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHECK = join(HERE, 'magazine-vnext-produce-check.mjs')
const ids = spawnSync(process.execPath, [CHECK, '--list'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
// 다른 검사에서 난 실패로 변이가 검출됐다고 판정하지 않는다.
const expectedCase = {
  'request-key-not-exclusive': 'E11', 'budget-removed': 'E19',
  'send-scan-removed': 'E20', 'unknown-resend-early': 'E5',
  'delete-skipped': 'E9', 'hero-ratio-unchecked': 'E13',
  'qa-backstop-removed': 'E18', 'zdr-restart-trusted': 'E23',
  'regen-cap-raised': 'E16', 'produce-lane-removed': 'E26',
  'live-default-on': 'E25', 'image-failure-regenerates': 'E12',
  'local-final-ignored': 'E10',
  'native-key-failure-ambiguous': 'E35', 'native-sent-failure-not-created': 'E36',
}
let killed = 0, survived = 0
for (const id of ids) {
  const r = spawnSync(process.execPath, [CHECK, '--mutate', id, '--only', expectedCase[id] ?? 'UNMAPPED'], { encoding: 'utf8', timeout: 300_000 })
  const out = `${r.stdout}${r.stderr}`
  const applied = out.includes(`MUTATION APPLIED ${id}`)
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.split(' ')[1])
  const ok = applied && r.status === 1 && fails.includes(expectedCase[id])
  if (ok) killed++; else survived++
  console.log(`${ok ? 'KILLED  ' : 'SURVIVED'} ${id}${ok ? ` — ${fails.join(',')}` : ` — status ${r.status} · applied ${applied} · ${out.split('\n').filter((l) => /HARNESS|예외/.test(l)).join(' ').slice(0, 300)}`}`)
}
console.log(`\nvNext 생산기 변이: ${killed} killed, ${survived} survived`)
process.exit(survived || !ids.length ? 1 : 0)
