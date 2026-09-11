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
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import {
  toDetailRecord, toRawDetailRecord, statsOf, violatesAdapt, accessOf,
  DETAIL_KEYS, RAW_DETAIL_KEYS, SOURCE_AXIS, RAW_AXIS, SRN_AXIS,
  DATA_DIR_NAME, ADAPT_PREFIX, DETAIL_SUFFIX, RAW_DETAIL_SUFFIX,
  completedAdaptKeys, partialAdaptKeys, parseJsonl, resolveThinInput,
  type ThinRow,
} from '../src/lib/micro-seed-82cook-thin-adapt'
// 🔴 처리 identity 는 공급 처리기와 **같은 함수**를 쓴다 — 복제하면 한쪽만 고쳐진다
import { adaptKeyOf } from '../src/lib/supply-process'

/** 🔴 정본은 lib 하나다 — 여기서 문자열을 다시 쓰지 않는다 */
const DATA_DIR = DATA_DIR_NAME
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

/**
 * 🔴 **읽기 실패를 빈 배열로 삼키지 않는다.**
 *
 *    옛 판은 `catch { return out }` 이었다. 없는 파일도, 못 읽는 파일도, 깨진 줄도
 *    전부 "0행" 이 됐고 exit 0 으로 통과했다. 그래서 러너가 맨 이름을 넘기기 시작한 날부터
 *    새 수집분이 한 줄도 하류로 가지 않았는데 관제는 조용했다 (2026-09-11 실측).
 *
 *    정상 0행은 `{ ok: true, rows: [] }` 다 — 조용한 날과 끊긴 파이프는 다른 것이다.
 */
type ReadOutcome =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; reason: string }

function readRows(path: string): ReadOutcome {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    return { ok: false, reason: code === 'ENOENT' ? '파일이 없다' : `읽지 못했다 (${code !== '' ? code : String(e)})` }
  }
  const parsed = parseJsonl(raw)
  if (!parsed.ok) return { ok: false, reason: `${parsed.line}번째 줄 — ${parsed.reason}` }
  return { ok: true, rows: parsed.rows }
}

/**
 * thin 산출물 — 지정이 없으면 전부.
 *
 * 🔴 콤마로 여러 개를 받는다 — 한 회차에 82cook 과 네이버가 **둘 다** 얇은 파일을 만든다.
 *    하나만 받으면 그 회차에 수집한 다른 소스가 통째로 빠진다.
 * 🔴 **받은 문자열을 그대로 열지 않는다.** 러너는 `readdirSync` 가 준 맨 이름을 넘긴다 —
 *    그것은 cwd 기준 경로가 아니다. 정본 디렉터리 기준으로 풀고, 밖이면 거부한다.
 */
function thinFiles(): string[] {
  const only = arg('input')
  if (only !== null) {
    const bad: string[] = []
    const out: string[] = []
    for (const piece of only.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
      const r = resolveThinInput(piece, DATA_DIR)
      if (r.ok) out.push(r.path)
      else bad.push(`${piece} — ${r.reason}`)
    }
    if (bad.length > 0) fail(`--input 에 받아들일 수 없는 경로가 있다\n${bad.map((b) => `     ${b}`).join('\n')}`)
    return out
  }
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.thin-detail.jsonl')).sort().map((f) => join(DATA_DIR, f))
}

/** 디렉터리에 있는 이름들 (없으면 빈 목록) */
function dataDirNames(): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR)
}

/**
 * 이미 사본을 낸 것 — 두 번 내지 않는다.
 *
 * 🔴 **detail 과 raw-detail 이 둘 다 있어야 완료다.** 옛 판은 접두만 보고 한쪽만 있어도
 *    완료로 셌다. 그러면 raw-review 화면이 그 회차를 영영 보지 못한다.
 *    한쪽만 난 회차는 다음 회차가 다시 만든다 — 산출물 자체가 진행 상태다.
 */
function adaptedRunIds(): Set<string> {
  return completedAdaptKeys(dataDirNames())
}

/**
 * 🔴 **temp 에 쓰고 rename 한다.** 쓰다 죽으면 반쪽짜리 파일이 남고,
 *    하류는 그것을 "있다" 로 읽는다. rename 은 같은 파일시스템 안에서 원자적이다.
 */
function writeRows(path: string, rows: readonly Record<string, unknown>[]): void {
  if (!isInsideDataDir(path)) fail(`${path} 은 ${DATA_DIR}/ 밖이다 — 거부한다`)
  const tmp = `${path}.tmp-${process.pid}`
  if (!isInsideDataDir(tmp)) fail(`${tmp} 은 ${DATA_DIR}/ 밖이다 — 거부한다`)
  try {
    writeFileSync(tmp, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8')
    renameSync(tmp, path)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* 이미 없으면 그만이다 */ }
    fail(`${path} 를 쓰지 못했다 — ${String(e)}`)
  }
}

function main(): void {
  console.log(APPLY ? '\n══ 🔴 사본 생성 (--apply) ══\n' : '\n══ 계획만 (파일 0) ══\n')
  console.log('  🔴 thin 원본을 고치지 않는다 · 전문 저장 금지 그대로')
  console.log('  🔴 네트워크 0 · DB 0 · Sheet 0 · LLM 0 · Raw Vault 0 · 발행 0\n')

  const files = thinFiles()
  if (files.length === 0) fail(`${DATA_DIR} 에 *.thin-detail.jsonl 이 없다`)

  const names = dataDirNames()
  const done = adaptedRunIds()
  const half = partialAdaptKeys(names)
  let total = 0
  const plans: { runId: string; rows: ThinRow[]; from: string; already: boolean }[] = []
  // 🔴 **읽기 실패는 먼저 전부 모아서 한 번에 멈춘다** — 한 건이라도 못 읽었으면
  //    이 회차의 산출물은 0 이어야 한다. 반만 변환해 두면 나머지가 영영 안 온다.
  const unread: string[] = []
  for (const f of files) {
    const r = readRows(f)
    if (!r.ok) { unread.push(`${f} — ${r.reason}`); continue }
    const rows = r.rows as ThinRow[]
    total += rows.length
    // 🔴 행의 runId 가 아니라 **입력 파일**에서 키를 만든다 — 두 카페가 서로를 막지 않는다
    const runId = adaptKeyOf(f)
    plans.push({ runId, rows, from: f, already: done.has(runId) })
  }
  if (unread.length > 0) {
    fail(`입력 ${unread.length}개를 읽지 못했다 — 🔴 산출물 0\n${unread.map((u) => `     ${u}`).join('\n')}\n`
      + `     🔴 "행이 0" 이 아니라 "못 읽었다" 다. 다음 회차가 다시 시도한다.`)
  }

  console.log(`① 입력 ${files.length}개 파일 · ${total}행`)
  for (const p of plans) {
    const s = statsOf(p.rows)
    const mark = p.already ? '  🟡 이미 사본이 있다'
      : (half.has(p.runId) ? '  🟠 사본이 한쪽만 있다 — 다시 만든다' : '')
    console.log(`   · ${p.from}  ${s.total}행${mark}`)
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
    const base = join(DATA_DIR, `${ADAPT_PREFIX}${p.runId}`)
    const dPath = `${base}${DETAIL_SUFFIX}`
    const rPath = `${base}${RAW_DETAIL_SUFFIX}`
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
