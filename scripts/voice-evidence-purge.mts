#!/usr/bin/env tsx
/**
 * 말투 근거 삭제 — 🔴 계획만이 기본 · `--execute` 일 때만 지운다 · 예약하지 않는다
 *
 * 정본: `scripts/lib/voice-evidence-retention.mts` (규칙) · `scripts/lib/voice-evidence-capture.mts` (저장 계약)
 *
 * 사용법
 *   npm run persona:voice-evidence-purge                              계획만 (write 0)
 *   npm run persona:voice-evidence-purge -- --execute                 🔴 90일 지난 줄을 지운다
 *   npm run persona:voice-evidence-purge -- --speaker-hash=vs1:… --execute   🔴 삭제 요청 화자의 줄을 지운다
 *
 * 🔴 줄 내용 · 화자 해시를 출력하지 않는다 — 파일 이름과 개수만.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { purgeVoiceEvidence } from './lib/voice-evidence-retention.mjs'

const argv = process.argv.slice(2)
const arg = (n: string): string[] => argv.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3))
const EXECUTE = argv.includes('--execute')
const DATA_DIR = arg('data-dir')[0]
  ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data')
const SPEAKERS = arg('speaker-hash')
const bad = SPEAKERS.filter((s) => !/^vs1:[0-9a-f]{64}$/.test(s))
if (bad.length > 0) {
  console.error(`\n🛑 --speaker-hash 는 vs1:<64 hex> 여야 한다 (잘못된 값 ${bad.length}개)\n`)
  process.exit(1)
}

const r = purgeVoiceEvidence({ dataDir: DATA_DIR, now: new Date(), execute: EXECUTE, speakerHashes: SPEAKERS })
console.log(`\n══ 말투 근거 삭제 — ${EXECUTE ? '🔴 실행' : '계획만 (write 0)'} ══`)
console.log(`  디렉터리 ${DATA_DIR}`)
console.log(`  파일 ${r.totals.files} · 줄 ${r.totals.lines} · 기한 지남 ${r.totals.expired} · 삭제 요청 ${r.totals.requested}`)
for (const f of r.files.filter((x) => x.action !== 'keep')) {
  console.log(`  ${f.action === 'delete' ? '🗑' : '✂️'} ${f.file} — 기한 ${f.expired} · 요청 ${f.requested} · 남김 ${f.keep}`)
}
console.log(EXECUTE
  ? `  → 파일 삭제 ${r.totals.deletedFiles} · 다시 씀 ${r.totals.rewrittenFiles}\n`
  : '  → 지우려면 --execute 를 붙인다\n')
