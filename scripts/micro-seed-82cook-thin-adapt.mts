#!/usr/bin/env tsx
/**
 * 82cook thin → 검수 화면 어댑터 — 🔴 **원본을 고치지 않고 읽을 수 있는 사본을 낸다** (§4-AQ)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AQ
 *
 * 🔴 **왜.** `thin-detail` 로 82cook 50건을 읽었는데 하류가 그 파일을 보지 못했다 —
 *    `'….thin-detail.jsonl'.endsWith('.detail.jsonl')` 이 `false` 다.
 *    데이터는 온전한데 안 보였다.
 *
 * 🔴 **thin 원본을 건드리지 않는다.** 접미를 바꾸면 하류가 바로 읽지만,
 *    저장 정책이 다른 두 종류가 같은 접미를 갖게 된다 —
 *    "어느 줄이 어떤 규칙으로 저장됐는지 파일만 보고는 알 수 없다" 가 되는 것이
 *    `raw-detail` 이 접미를 나눈 이유다.
 *
 * 🔴 **전문 저장 금지는 그대로다.** thin 이 안 가진 것을 여기서 만들 수 없다 —
 *    입력에 없으니 출력에도 없다. 그래도 출력 직전에 한 번 더 검사한다.
 *
 * 🔴 **하지 않는 것**
 *    네트워크 · DB · Prisma · Sheet · LLM · Raw Vault · 발행. 파일만 읽고 파일만 쓴다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-82cook-thin-adapt.mts            # 계획만 · 파일 0
 *   npx tsx scripts/micro-seed-82cook-thin-adapt.mts --apply    # 사본 생성
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import {
  toDetailRecord, toRawDetailRecord, statsOf, violatesAdapt, accessOf,
  DETAIL_KEYS, RAW_DETAIL_KEYS, SOURCE_AXIS, RAW_AXIS, SRN_AXIS,
  type ThinRow,
} from '../src/lib/micro-seed-82cook-thin-adapt'

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === null || hit === undefined ? null : hit.slice(n.length + 3)
}
const APPLY = argv.includes('--apply')
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

export function isInsideDataDir(p: string): boolean {
  const rel = relative(resolve(process.cwd()), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${DATA_DIR}/`)
}

function jsonl(path: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return out }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try { out.push(JSON.parse(t) as Record<string, unknown>) } catch { /* 건너뛴다 */ }
  }
  return out
}

/** thin 산출물 — 지정이 없으면 전부 */
function thinFiles(): string[] {
  const only = arg('input')
  if (only !== null) return [only]
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.thin-detail.jsonl')).sort().map((f) => join(DATA_DIR, f))
}

/** 이미 사본을 낸 회차 — 두 번 내지 않는다 */
function adaptedRunIds(): Set<string> {
  const out = new Set<string>()
  if (!existsSync(DATA_DIR)) return out
  for (const f of readdirSync(DATA_DIR).filter((x) => x.startsWith('82cook-adapt-'))) {
    const m = /^82cook-adapt-(.+?)\./.exec(f)
    if (m !== null) out.add(m[1]!)
  }
  return out
}

function writeRows(path: string, rows: readonly Record<string, unknown>[]): void {
  if (!isInsideDataDir(path)) fail(`${path} 은 ${DATA_DIR}/ 밖이다 — 거부한다`)
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8')
}

function main(): void {
  console.log(APPLY ? '\n══ 🔴 사본 생성 (--apply) ══\n' : '\n══ 계획만 (파일 0) ══\n')
  console.log('  🔴 thin 원본을 고치지 않는다 · 전문 저장 금지 그대로')
  console.log('  🔴 네트워크 0 · DB 0 · Sheet 0 · LLM 0 · Raw Vault 0 · 발행 0\n')

  const files = thinFiles()
  if (files.length === 0) fail(`${DATA_DIR} 에 *.thin-detail.jsonl 이 없다`)

  const done = adaptedRunIds()
  let total = 0
  const plans: { runId: string; rows: ThinRow[]; from: string; already: boolean }[] = []
  for (const f of files) {
    const rows = jsonl(f) as ThinRow[]
    total += rows.length
    const runId = String(rows[0]?.runId ?? f.split('/').pop() ?? '')
    plans.push({ runId, rows, from: f, already: done.has(runId) })
  }

  console.log(`① 입력 ${files.length}개 파일 · ${total}행`)
  for (const p of plans) {
    const s = statsOf(p.rows)
    console.log(`   · ${p.from}  ${s.total}행${p.already ? '  🟡 이미 사본이 있다' : ''}`)
    console.log(`       ${SOURCE_AXIS} ${s.sourceCandidates}건 · ${RAW_AXIS} ${s.rawCandidates}건`
      + `  → 검수 화면 후보`)
    console.log(`       ${SRN_AXIS} ${s.srn}건 — 🔴 별도 경로다. 발행 후보화하지 않는다`)
    console.log(`       🔴 어느 화면에도 안 오름: drop·hardExclude ${s.dropped}건`
      + ` · 읽지 못함 ${s.unreadable}건`)
  }

  const fresh = plans.filter((p) => !p.already)
  if (fresh.length === 0) {
    console.log('\n② 낼 사본이 없다 — 전부 이미 변환했다.\n')
    return
  }

  if (!APPLY) {
    console.log('\n② 만들지 않는다 — 계획만이다.')
    console.log('   🟡 파일 0. 실행하려면 --apply 를 붙이세요.\n')
    return
  }

  console.log(`\n② 🔴 사본 ${fresh.length}회차`)
  for (const p of fresh) {
    const detail = p.rows.map(toDetailRecord)
    const rawDetail = p.rows.map(toRawDetailRecord)
    // 🔴 출력 직전 마지막 관문 — 전문이나 계약 밖 키가 있으면 여기서 멈춘다
    for (const [rows, keys, name] of [
      [detail, DETAIL_KEYS, 'detail'], [rawDetail, RAW_DETAIL_KEYS, 'raw-detail'],
    ] as const) {
      for (const r of rows) {
        const bad = violatesAdapt(r, keys, BODY_HEAD_CHARS)
        if (bad.length > 0) fail(`${name} 계약 위반\n${bad.map((b) => `     ${b}`).join('\n')}`)
      }
    }
    const base = join(DATA_DIR, `82cook-adapt-${p.runId}`)
    const dPath = `${base}.detail.jsonl`
    const rPath = `${base}.raw-detail.jsonl`
    writeRows(dPath, detail)
    writeRows(rPath, rawDetail)
    const okCount = p.rows.filter((r) => accessOf(r) === 'ok').length
    console.log(`   ✅ ${dPath}  ${detail.length}행 (access ok ${okCount})`)
    console.log(`   ✅ ${rPath}  ${rawDetail.length}행`)
  }
  console.log('\n   🔴 thin 원본은 그대로다. 전문은 어느 파일에도 없다.')
  console.log('   다음: micro-seed:seed-source-review · micro-seed:raw-review 로 화면을 다시 만든다\n')
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
