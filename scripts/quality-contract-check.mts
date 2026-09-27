#!/usr/bin/env tsx
/**
 * 🔴 **품질 계약 CI 가드** (2026-09-27 마스터 Q7) — DB 0 · 네트워크 0 · LLM 0
 *
 * 왜 있나 — 2026-09-26 초안 게이트 3종(d750b72)은 게이트 판정을 바꿨는데 판 값을 하나도 올리지 않았다.
 * 그래서 저장값으로 수정 전·후 세대를 가를 수 없었다. 판을 올리는 것은 사람의 기억에 기대면 또 빠진다.
 *
 * 🔴 **규칙** — 게이트·검수·판정 소스(`FINGERPRINT_FILES`)의 지문이 기록과 다르면 실패한다.
 *    통과하려면 기록을 새로 써야 하고, 새로 쓰려면 둘 중 하나를 **명시**해야 한다:
 *      · `--bump`                         `QUALITY_CONTRACT_VERSION` 을 올렸다(기록의 판과 달라야 한다)
 *      · `--behavior-unchanged="사유"`     판정 행동이 바뀌지 않았다(주석·이름 정리 등) — 사유가 기록에 남는다
 *    기록의 판·digest 가 지금 코드와 다르면(digest 구성을 바꾸고 판을 안 올림) 역시 실패한다.
 *
 *   npm run check:quality-contract                         검사(CI)
 *   npm run check:quality-contract -- --bump               판을 올린 뒤 기록 갱신
 *   npm run check:quality-contract -- --behavior-unchanged="주석 정리"   행동 불변 확인 후 기록 갱신
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { QUALITY_CONTRACT_VERSION, qualityContractDigest } from '../src/lib/quality-contract'

/** 🔴 판정 행동을 정하는 소스 — 하나라도 바뀌면 판을 올리거나 행동 불변을 확인해야 한다 */
export const FINGERPRINT_FILES = [
  'src/lib/quality-contract.ts',
  'src/lib/semantic-summary-codes.ts',
  'src/lib/content-core/draft-life-gates.ts',
  'src/lib/content-core/review.ts',
  'src/lib/content-core/pipeline.ts',
  'src/lib/content-core/evidence.ts',
  'src/lib/content-core/load-bearing.ts',
  'src/lib/micro-seed-auto-draft.ts',
  'src/lib/auto-ready-v2.ts',
  'src/lib/draft-originality.ts',
  'src/lib/persona-self-age.ts',
  'src/lib/original-post-persona-match.ts',
  'scripts/lib/content-core-run.mts',
  'scripts/lib/content-core-prompts.mts',
] as const

export const FINGERPRINT_PATH = 'src/lib/quality-contract.fingerprint.json'

type Record_ = {
  version: string
  digest: string
  files: Record<string, string>
  acknowledgement: { kind: 'bump' | 'behaviorUnchanged' | 'initial'; reason: string; changedFiles: string[] }
}

const ROOT = process.cwd()
const hashOf = (p: string): string => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex')

function currentFiles(): Record<string, string> {
  return Object.fromEntries(FINGERPRINT_FILES.map((f) => [f, existsSync(join(ROOT, f)) ? hashOf(f) : 'missing']))
}

function readRecord(): Record_ | null {
  const p = join(ROOT, FINGERPRINT_PATH)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) as Record_ } catch { return null }
}

/** 🔴 판정 — 순수. 검사 스크립트(auto-ready:quality-check)가 같은 함수를 부른다 */
export function judgeFingerprint(rec: Record_ | null, now: { version: string; digest: string; files: Record<string, string> }): string[] {
  if (rec === null) return [`${FINGERPRINT_PATH} 가 없거나 읽을 수 없다`]
  const bad: string[] = []
  if (rec.version !== now.version) bad.push(`기록의 판 ${rec.version} ≠ 코드 ${now.version} — 기록을 --bump 로 갱신한다`)
  if (rec.digest !== now.digest) {
    bad.push(`기록의 digest ${rec.digest.slice(0, 12)}… ≠ 코드 ${now.digest.slice(0, 12)}… — digest 구성이 바뀌었으면 판을 올린다(--bump)`)
  }
  const changed = Object.keys(now.files).filter((f) => rec.files?.[f] !== now.files[f])
  const extra = Object.keys(rec.files ?? {}).filter((f) => !(f in now.files))
  if (changed.length > 0) {
    bad.push(`게이트·검수 소스 지문이 바뀌었다 — ${changed.join(', ')} · QUALITY_CONTRACT_VERSION 을 올리고 --bump, 또는 행동 불변이면 --behavior-unchanged="사유"`)
  }
  if (extra.length > 0) bad.push(`기록에만 있는 파일 ${extra.join(', ')}`)
  return bad
}

function main(): void {
  const argv = process.argv.slice(2)
  const bump = argv.includes('--bump')
  const unchangedArg = argv.find((a) => a.startsWith('--behavior-unchanged='))
  const reason = unchangedArg === undefined ? '' : unchangedArg.slice('--behavior-unchanged='.length).trim()
  const now = { version: QUALITY_CONTRACT_VERSION, digest: qualityContractDigest(), files: currentFiles() }
  const rec = readRecord()
  if (!bump && unchangedArg === undefined) {
    const bad = judgeFingerprint(rec, now)
    console.log('\n══ 품질 계약 CI 가드 (DB 0 · 네트워크 0) ══')
    console.log(`   판 ${now.version} · digest ${now.digest.slice(0, 16)}… · 지문 파일 ${FINGERPRINT_FILES.length}개`)
    if (bad.length > 0) {
      for (const b of bad) console.log(`  ❌ ${b}`)
      process.exit(1)
    }
    console.log('  ✅ 기록과 코드가 같다\n')
    return
  }
  if (bump && unchangedArg !== undefined) { console.error('🔴 --bump 와 --behavior-unchanged 를 함께 주지 않는다'); process.exit(2) }
  const changedFiles = Object.keys(now.files).filter((f) => rec?.files?.[f] !== now.files[f])
  if (bump) {
    if (rec !== null && rec.version === now.version) {
      console.error(`🔴 --bump 인데 QUALITY_CONTRACT_VERSION 이 기록(${rec.version})과 같다 — 코드의 판을 먼저 올린다`)
      process.exit(2)
    }
  } else {
    if (reason === '') { console.error('🔴 --behavior-unchanged 에는 사유가 필요하다'); process.exit(2) }
    if (rec !== null && (rec.version !== now.version || rec.digest !== now.digest)) {
      console.error('🔴 판 또는 digest 가 바뀌었다 — 행동 불변 확인이 아니라 --bump 다')
      process.exit(2)
    }
  }
  const next: Record_ = {
    version: now.version, digest: now.digest, files: now.files,
    acknowledgement: rec === null
      ? { kind: 'initial', reason: `첫 기록 — ${now.version}`, changedFiles }
      : bump
      ? { kind: 'bump', reason: `판 ${rec.version} → ${now.version}`, changedFiles }
      : { kind: 'behaviorUnchanged', reason, changedFiles },
  }
  writeFileSync(join(ROOT, FINGERPRINT_PATH), `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✅ ${FINGERPRINT_PATH} 갱신 — ${next.acknowledgement.kind} · 바뀐 파일 ${changedFiles.length}개`)
}

if (process.argv[1]?.endsWith('quality-contract-check.mts')) main()
