#!/usr/bin/env node
/**
 * 원고 CTA 앞 문장 무전송 수리 CLI — 사람이 승인한 문장 하나로 마지막 `[CTA]` 줄의 셋째 칸만 바꾼다.
 *
 *   node scripts/magazine-draft-cta-repair.mjs --drafts-dir <…/drafts/magazine> --slug <slug> \
 *     --expect-draft-hash <sha256:…> --expect-old-text "<옛 문장>" --text "<새 문장>" \
 *     --approver <이름> --at <KST> [--write]
 *
 * 🔴 기본은 미리보기다(쓰기 0) — `--write` 가 있어야 원고와 영수증을 쓴다. 계약은 `lib/magazine-draft-cta-repair.mjs`.
 * 🔴 `--drafts-dir` 는 명시해야 한다 — 그 위 두 단계(…/drafts/magazine → 저장소 루트)의 큐 · 제품 판 · 승인 source 로 정본을 다시 맞춘다.
 * 🔴 ChatGPT · Chrome · CDP · 네트워크 · 재생성 0.
 *
 * 종료 코드: 0 성공(미리보기 포함) · 1 거부(구조화 코드) · 2 사용법 오류
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { readProductGraphVersion } from './lib/magazine-direct-spec-source.mjs'
import { repairDraftCta } from './lib/magazine-draft-cta-repair.mjs'
import { parseQueueSource } from './lib/magazine-load.mjs'

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
}
const usage = (why) => { console.error(`  사용법 오류: ${why}`); process.exit(2) }
const out = (o, code) => { console.log(JSON.stringify(o, null, 2)); process.exit(code) }

const REQUIRED = ['--drafts-dir', '--slug', '--expect-draft-hash', '--expect-old-text', '--text', '--approver', '--at']
const missing = REQUIRED.filter((k) => arg(k) === null)
if (missing.length) usage(`${missing.join(' · ')} 를 모두 명시해야 한다`)
const draftsDir = resolve(arg('--drafts-dir'))
if (basename(draftsDir) !== 'magazine' || basename(resolve(draftsDir, '..')) !== 'drafts') usage('--drafts-dir 는 <저장소>/drafts/magazine 이어야 한다')
const repoRoot = resolve(draftsDir, '..', '..')
const currentTs = join(repoRoot, 'src/content/magazine/graph/current.ts')
const queueTs = join(draftsDir, 'topic-queue.ts')
if (!existsSync(currentTs) || !existsSync(queueTs)) usage('--drafts-dir 의 저장소에 제품 판(current.ts) · topic-queue.ts 가 없다')

const r = repairDraftCta({
  slug: arg('--slug'), draftsDir, expectDraftHash: arg('--expect-draft-hash'), expectOldText: arg('--expect-old-text'),
  text: arg('--text'), approver: arg('--approver'), at: arg('--at'),
  queue: parseQueueSource(readFileSync(queueTs, 'utf8')), expectedGraphVersion: readProductGraphVersion(currentTs), productRoot: repoRoot,
  write: argv.includes('--write'),
})
out(r.ok ? { ok: true, written: r.written, ...(r.preview ? { preview: true } : {}), ...(r.idempotent ? { idempotent: true } : {}),
  oldDraftHash: r.oldDraftHash, newDraftHash: r.newDraftHash, receiptPath: r.receiptPath, receipt: r.receipt } : r, r.ok ? 0 : 1)
