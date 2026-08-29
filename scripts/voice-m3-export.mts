#!/usr/bin/env tsx
/**
 * VE-M3-6 전량 분석 결과 export (읽기 전용)
 *
 * 정본: docs/operations/2026-08-29-voice-m3-export-design.md
 *
 * 🔴 **이 파일에는 유료 경로가 없다.**
 *    `--apply` 도 `--confirm-paid-call` 도 받지 않는다. provider 를 import 하지 않는다.
 *    DB 는 **읽기만** 한다 — create · update · upsert · delete 가 한 줄도 없다.
 *
 * 🔴 왜 export 가 따로 필요한가
 *    9,411건은 사람이 DB 로 읽을 수 없는 양이다. 그렇다고 원문을 붙여 내보내면
 *    **분석 결과를 읽으려다 원문을 유출한다.** 이 파일의 일은 "보여주는 것" 이 아니라
 *    **"원문 없이 판단 가능하게 만드는 것"** 이다.
 *
 * 🔴 원문 유출 방지 4중 (설계 §4)
 *    ① 조회 차단 — 우나어 DB 는 §유출 재검사 블록에서만 열고 즉시 닫는다.
 *       content · topComments 는 대조에만 쓰고 어떤 변수 · 파일에도 남기지 않는다.
 *    ② 컬럼 화이트리스트 — SIGNAL_COLUMNS · SKIPPED_COLUMNS 밖의 필드는 접근하지 않는다.
 *       sourceUrl(§10-5-A 노출 금지) · errorMessage · cacheKey · contentHash · legacyLabels 제외.
 *    ③ export 직전 20자 전수 재검사 — 저장 시점에 통과했어도 다시 본다.
 *       원문이 그 뒤 수정됐을 수 있고, 파일은 나가면 통제를 벗어난다.
 *    ④ 금지 호칭 재검사 — "시니어 · 어르신 · 노인 · 실버".
 *    🔴 ③ · ④ 는 1건이라도 걸리면 **파일을 쓰지 않고 중단한다.**
 *       위반 행만 빼고 내보내면 "검사를 통과한 export" 라는 잘못된 신뢰가 생긴다.
 *
 * 사용법
 *   npm run voice:m3-export                  전량 export
 *   npm run voice:m3-export -- --verify-only  유출 재검사만 (파일 생성 0)
 *   npm run voice:m3-export -- --report-only  report.md 만 재생성
 */
import { PrismaClient } from '@prisma/client'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  M3_ANALYSIS_MODEL, M3_SIGNAL_KEYS, M3_LEAK_RUN_MIN, M3_TERMINAL_SKIP_CODES,
  M3_FORBIDDEN_ADDRESS_TERMS, M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION,
  assertNoSourceLeak,
} from './lib/voice-m3-contract.mjs'
import { loadUnaoReadonlyUrl, topCommentsToText } from './lib/voice-unao-readonly.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv
const has = (n: string): boolean => argv.includes(`--${n}`)

/** 🔴 전량 대상 — 잘린 글(contentLength = 3000) 230건을 뺀 수. run · plan 과 같은 기준이다 */
const ELIGIBLE = 9444
/** 상위 · 하위 사례 건수 (설계 §6 확정) */
const TOP_N = 30
/** CSV 는 사람이 Excel 로 연다 → BOM 포함. JSONL · manifest 는 기계가 읽는다 → BOM 없음 */
const BOM = '﻿'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = join(HERE, '..', 'tmp', 'voice-m3-export')

/**
 * 🔴 컬럼 화이트리스트 — 내보낼 것을 **여기서만** 정한다.
 *    스키마에 새 필드가 생겨도 이 배열에 없으면 자동으로 새지 않는다.
 *    fixture 가 이 배열에 금지 컬럼이 섞였는지 검사한다.
 */
const SIGNAL_COLUMNS = [
  'sourceRef', 'sourceSite', 'bodyLength', 'commentCount',
  ...M3_SIGNAL_KEYS,
  'notes', 'status', 'errorCode',
  'inputTokens', 'outputTokens', 'totalTokens', 'costUsd',
] as const

const SKIPPED_COLUMNS = [
  'sourceRef', 'sourceSite', 'bodyLength', 'commentCount',
  'errorCode', 'status', 'costUsd', 'outputIsNull',
] as const

/**
 * 🔴 어떤 산출물에도 나가면 안 되는 컬럼 · 문자열.
 *    export 후 생성된 파일을 이 목록으로 다시 훑는다(PASS 6).
 */
export const FORBIDDEN_EXPORT_KEYS = [
  'sourceUrl', 'content', 'topComments', 'errorMessage', 'cacheKey', 'contentHash',
  'legacyLabels', 'authorHash', 'title',
] as const

type SignalRow = Record<(typeof SIGNAL_COLUMNS)[number], string | number>
type SkippedRow = Record<(typeof SKIPPED_COLUMNS)[number], string | number | boolean>

// ── CSV · 통계 헬퍼 ─────────────────────────────────────

/** 🔴 notes 에는 쉼표 · 줄바꿈 · 따옴표가 들어온다. RFC4180 으로 감싼다 */
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (headers: readonly string[], rows: Array<Record<string, unknown>>): string =>
  BOM + [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n'

const pct = (sorted: readonly number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]

type Stat = { n: number; mean: number; median: number; p10: number; p90: number; min: number; max: number; sd: number }
const statOf = (values: readonly number[]): Stat => {
  const s = [...values].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1)
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length || 1))
  return { n: s.length, mean, median: pct(s, 0.5), p10: pct(s, 0.1), p90: pct(s, 0.9), min: s[0] ?? 0, max: s[s.length - 1] ?? 0, sd }
}
const f1 = (n: number): string => n.toFixed(1)

const sha256Of = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

// ── 본체 ────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadEnvLocal()
  const verifyOnly = has('verify-only')
  const reportOnly = has('report-only')

  console.log('\nVE-M3-6 전량 분석 결과 export (읽기 전용)')
  console.log(`  모델 ${M3_ANALYSIS_MODEL} · 유출 임계값 ${M3_LEAK_RUN_MIN}자 연속`)
  console.log(`  🔴 유료 경로 0 · DB write 0 · provider import 0`)
  console.log(`  모드 ${verifyOnly ? '--verify-only (파일 생성 0)' : reportOnly ? '--report-only' : '전량 export'}\n`)

  const prisma = new PrismaClient()
  try {
    // ── 1. 대상 조회 (읽기만) ────────────────────────────
    const cache = await prisma.voiceM3Cache.findMany({
      where: { model: M3_ANALYSIS_MODEL },
      select: {
        sourceRef: true, status: true, errorCode: true, output: true,
        inputTokens: true, outputTokens: true, totalTokens: true, estimatedCostUsd: true,
      },
    })
    const succeeded = cache.filter((c) => c.status === 'succeeded')
    const skipped = cache.filter((c) => c.status === 'skipped')
    const failed = cache.filter((c) => c.status === 'failed')
    console.log(`  대상 succeeded ${succeeded.length} · terminal skipped ${skipped.length} · failed ${failed.length}`)

    if (failed.length > 0) throw new Error(`failed 가 ${failed.length}건 남아 있다 — 전량 완료 후에 export 한다`)

    // 🔴 메타데이터는 VoiceSource 에서만 온다. 원문 테이블을 보지 않는다
    const sources = await prisma.voiceSource.findMany({
      where: { sourceRef: { in: cache.map((c) => c.sourceRef) } },
      select: { sourceRef: true, sourceSite: true, contentLength: true, commentCount: true },
    })
    const metaOf = new Map(sources.map((s) => [s.sourceRef, s]))
    const siteOf = (ref: string): string => (metaOf.get(ref)?.sourceSite ?? 'unknown').replace('navercafe:', '')

    // ── 2. 🔴 export 직전 전수 유출 재검사 ────────────────
    //    저장 시점에 통과했어도 다시 본다. 원문이 그 뒤 수정됐을 수 있다.
    console.log(`\n  🔴 전수 유출 재검사 — succeeded ${succeeded.length}건의 notes 를 원문과 ${M3_LEAK_RUN_MIN}자 대조`)
    const unao = new pg.Client({ connectionString: loadUnaoReadonlyUrl(), ssl: { rejectUnauthorized: false } })
    await unao.connect()
    const leaked: string[] = []
    const forbidden: string[] = []
    let checked = 0
    try {
      for (const c of succeeded) {
        const notes = String((c.output as Record<string, unknown> | null)?.notes ?? '')
        // 🔴 원문은 이 블록 밖으로 나가지 않는다. 대조에만 쓰고 버린다
        const q = await unao.query<{ content: string | null; topComments: unknown }>(
          'SELECT content, "topComments" FROM "CafePost" WHERE id = $1', [c.sourceRef],
        )
        const verdict = assertNoSourceLeak(notes, [String(q.rows[0]?.content ?? ''), topCommentsToText(q.rows[0]?.topComments)])
        if (verdict.leaked) leaked.push(c.sourceRef)
        if (M3_FORBIDDEN_ADDRESS_TERMS.some((t) => notes.includes(t))) forbidden.push(c.sourceRef)
        checked += 1
        if (checked % 2000 === 0) console.log(`     … ${checked}/${succeeded.length}`)
      }
    } finally {
      await unao.end()
    }
    console.log(`     검사 ${checked}건 · 20자 유출 ${leaked.length} · 금지 호칭 ${forbidden.length}`)

    // 🔴 1건이라도 걸리면 파일을 쓰지 않는다. 부분 export 도 하지 않는다
    if (leaked.length > 0 || forbidden.length > 0) {
      console.error('\n🔴 유출 재검사 실패 — 파일을 생성하지 않는다')
      for (const r of leaked.slice(0, 10)) console.error(`   20자 유출 ${r}`)
      for (const r of forbidden.slice(0, 10)) console.error(`   금지 호칭 ${r}`)
      process.exitCode = 1
      return
    }
    console.log('     ✅ 통과')

    // terminal skip 은 output 이 null 이어야 한다
    const skipWithOutput = skipped.filter((c) => c.output !== null)
    if (skipWithOutput.length > 0) throw new Error(`terminal skip ${skipWithOutput.length}건에 output 이 저장돼 있다`)
    console.log(`     ✅ terminal skipped ${skipped.length}건 전부 output null`)

    if (verifyOnly) {
      console.log('\n✅ --verify-only — 검사만 하고 끝낸다. 생성된 파일 0\n')
      return
    }

    // ── 3. 행 만들기 (화이트리스트 밖은 만지지 않는다) ────
    const signalRows: SignalRow[] = succeeded.map((c) => {
      const o = c.output as Record<string, number | string>
      const m = metaOf.get(c.sourceRef)
      return {
        sourceRef: c.sourceRef,
        sourceSite: siteOf(c.sourceRef),
        bodyLength: m?.contentLength ?? 0,
        commentCount: m?.commentCount ?? 0,
        ...Object.fromEntries(M3_SIGNAL_KEYS.map((k) => [k, Number(o[k])])),
        notes: String(o.notes ?? ''),
        status: c.status,
        errorCode: c.errorCode ?? '',
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        totalTokens: c.totalTokens,
        costUsd: Number(c.estimatedCostUsd),
      } as SignalRow
    })

    const skippedRows: SkippedRow[] = skipped.map((c) => {
      const m = metaOf.get(c.sourceRef)
      return {
        sourceRef: c.sourceRef,
        sourceSite: siteOf(c.sourceRef),
        bodyLength: m?.contentLength ?? 0,
        commentCount: m?.commentCount ?? 0,
        errorCode: c.errorCode ?? '',
        status: c.status,
        costUsd: Number(c.estimatedCostUsd),
        outputIsNull: c.output === null,
      }
    })

    // ── 4. 리포트 ────────────────────────────────────────
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const outDir = join(OUT_ROOT, stamp)
    mkdirSync(outDir, { recursive: true })

    /**
     * 🔴 총비용은 **CostEvent 합계**다. Cache 합계가 아니다.
     *    Cache 는 건별 최종 1행만 남지만 CostEvent 는 재시도 호출까지 기록한다.
     *    Cache 로 세면 실제 지출보다 적게 나온다(실측 차 $0.1678 = 재시도분).
     *    "얼마 썼나" 를 묻는 자리에 적게 나오는 수를 두면 안 된다.
     */
    const spent = await prisma.voiceM3CostEvent.aggregate({
      where: { model: M3_ANALYSIS_MODEL }, _sum: { estimatedCostUsd: true },
    })
    const totalCost = Number(spent._sum.estimatedCostUsd ?? 0)
    const storedCost = signalRows.reduce((a, r) => a + Number(r.costUsd), 0)
      + skippedRows.reduce((a, r) => a + Number(r.costUsd), 0)
    const report = buildReport(signalRows, skippedRows, stamp, totalCost, storedCost)

    // ── 5. 파일 쓰기 ─────────────────────────────────────
    const files: Record<string, string> = {}
    const write = (name: string, body: string): void => {
      const p = join(outDir, name)
      writeFileSync(p, body, 'utf-8')
      files[name] = p
    }

    write('report.md', report)
    if (!reportOnly) {
      write('signals.csv', toCsv(SIGNAL_COLUMNS, signalRows))
      write('skipped.csv', toCsv(SKIPPED_COLUMNS, skippedRows))
      // 🔴 JSONL 은 BOM 없이 — 기계가 읽는다
      write('signals.jsonl', signalRows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    }

    const manifest = {
      exportedAt: new Date().toISOString(),
      model: M3_ANALYSIS_MODEL,
      taskVersion: M3_TASK_VERSION,
      promptVersion: M3_PROMPT_VERSION,
      outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
      rows: { signals: signalRows.length, skipped: skippedRows.length },
      population: {
        eligible: ELIGIBLE,
        processed: signalRows.length + skippedRows.length,
        remaining: ELIGIBLE - signalRows.length - skippedRows.length,
      },
      cost: {
        // 🔴 실제 지출 = CostEvent 합계 (재시도 포함)
        totalUsd: Number(totalCost.toFixed(4)),
        // 캐시에 저장된 최종 1행 기준 합계 — 재시도분이 빠진다
        storedUsd: Number(storedCost.toFixed(4)),
        retryUsd: Number((totalCost - storedCost).toFixed(4)),
        perItemUsd: Number((totalCost / (signalRows.length + skippedRows.length)).toFixed(5)),
      },
      leakRecheck: { checked, violations: leaked.length, forbiddenAddress: forbidden.length, minRun: M3_LEAK_RUN_MIN },
      columns: { signals: [...SIGNAL_COLUMNS], skipped: [...SKIPPED_COLUMNS] },
      sha256: Object.fromEntries(Object.entries(files).map(([n, p]) => [n, sha256Of(p)])),
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

    // ── 6. 🔴 생성 후 금지 문자열 재검사 (PASS 6) ────────
    const offenders: string[] = []
    for (const [name, p] of Object.entries(files)) {
      const body = readFileSync(p, 'utf-8')
      for (const key of FORBIDDEN_EXPORT_KEYS) {
        if (body.includes(`"${key}"`) || body.includes(`,${key},`) || body.startsWith(`${key},`)) {
          offenders.push(`${name} 에 금지 컬럼 ${key}`)
        }
      }
    }
    if (offenders.length > 0) {
      console.error(`\n🔴 금지 컬럼 검사 실패 — ${offenders.join(' / ')}`)
      process.exitCode = 1
      return
    }

    console.log(`\n  생성 위치 tmp/voice-m3-export/${stamp}/`)
    for (const n of [...Object.keys(files), 'manifest.json']) console.log(`     ${n}`)
    console.log(`\n  signals ${signalRows.length}행 · skipped ${skippedRows.length}행 · 금지 컬럼 0건`)
    console.log('\n  🔴 다음은 사람이 읽는다. 점수로 발행을 자동화하지 않는다.\n')
  } finally {
    await prisma.$disconnect()
  }
}

// ── 리포트 작성 ─────────────────────────────────────────

function buildReport(
  rows: readonly SignalRow[], skippedRows: readonly SkippedRow[], stamp: string,
  totalCost: number, storedCost: number,
): string {
  const L: string[] = []
  const num = (r: SignalRow, k: string): number => Number(r[k as keyof SignalRow])
  const processed = rows.length + skippedRows.length

  L.push(`# VE-M3 전량 분석 리포트`, ``)
  L.push(`생성 ${stamp} · 모델 \`${M3_ANALYSIS_MODEL}\` · schema \`${M3_OUTPUT_SCHEMA_VERSION}\``, ``)

  // §1 개요
  L.push(`## §1 개요`, ``)
  L.push(`| 항목 | 값 |`, `|---|---|`)
  L.push(`| 대상(eligible) | ${ELIGIBLE.toLocaleString()} |`)
  L.push(`| processed | ${processed.toLocaleString()} (${(processed / ELIGIBLE * 100).toFixed(1)}%) |`)
  L.push(`| succeeded | **${rows.length.toLocaleString()}** |`)
  L.push(`| terminal skipped | ${skippedRows.length} (${(skippedRows.length / processed * 100).toFixed(2)}%) |`)
  L.push(`| failed | 0 |`)
  L.push(`| 총비용(실지출) | **$${totalCost.toFixed(4)}** (건당 $${(totalCost / processed).toFixed(5)}) |`)
  L.push(`| ├ 캐시 저장 기준 | $${storedCost.toFixed(4)} |`)
  L.push(`| └ 재시도분 | $${(totalCost - storedCost).toFixed(4)} — 같은 건을 다시 부른 비용. CostEvent 에만 남는다 |`)
  L.push(`| 원문 20자 유출 | **0건** (export 직전 ${rows.length.toLocaleString()}건 전수 재검사) |`)
  L.push(``)

  // §2 신호 분포
  L.push(`## §2 7종 신호 분포`, ``)
  L.push(`🟢 높을수록 좋다 · 🔴 높을수록 위험`, ``)
  L.push(`| 신호 | 평균 | 중앙값 | p10 | p90 | 최소 | 최대 | 표준편차 |`, `|---|---|---|---|---|---|---|---|`)
  for (const k of M3_SIGNAL_KEYS) {
    const s = statOf(rows.map((r) => num(r, k)))
    const mark = ['naturalnessScore', 'voiceRetention', 'originalityDelta'].includes(k) ? '🟢' : '🔴'
    L.push(`| ${mark} \`${k}\` | ${f1(s.mean)} | ${s.median} | ${s.p10} | ${s.p90} | ${s.min} | ${s.max} | ${f1(s.sd)} |`)
  }
  L.push(``)

  // §3 출처별 평균
  const sites = [...new Set(rows.map((r) => String(r.sourceSite)))].sort()
  L.push(`## §3 출처별 평균`, ``)
  L.push(`| 출처 | 건수 | ${M3_SIGNAL_KEYS.map((k) => `\`${k}\``).join(' | ')} |`)
  L.push(`|---|---|${M3_SIGNAL_KEYS.map(() => '---').join('|')}|`)
  for (const site of sites) {
    const sub = rows.filter((r) => r.sourceSite === site)
    L.push(`| ${site} | ${sub.length} | ${M3_SIGNAL_KEYS.map((k) => f1(statOf(sub.map((r) => num(r, k))).mean)).join(' | ')} |`)
  }
  L.push(``)

  // §4 출처별 skip율 — 🔴 절대 건수가 아니라 비율로 본다
  L.push(`## §4 출처별 terminal skip율`, ``)
  L.push(`🔴 **절대 건수가 아니라 처리 건수 대비 비율로 읽는다.** 모집단이 큰 출처는 건수도 자연히 많다.`, ``)
  L.push(`| 출처 | 처리 | skip | skip율 | SOURCE_LEAK | FORBIDDEN_ADDRESS |`, `|---|---|---|---|---|---|`)
  for (const site of sites) {
    const ok = rows.filter((r) => r.sourceSite === site).length
    const sk = skippedRows.filter((r) => r.sourceSite === site)
    const sl = sk.filter((r) => r.errorCode === 'SOURCE_LEAK').length
    const fa = sk.filter((r) => r.errorCode === 'FORBIDDEN_ADDRESS').length
    L.push(`| ${site} | ${ok + sk.length} | ${sk.length} | ${((sk.length / (ok + sk.length)) * 100).toFixed(2)}% | ${sl} | ${fa} |`)
  }
  L.push(``)

  // §5 · §6 상위 · 하위
  const table = (title: string, key: string, desc: boolean): void => {
    const sorted = [...rows].sort((a, b) => (desc ? num(b, key) - num(a, key) : num(a, key) - num(b, key))).slice(0, TOP_N)
    L.push(`### ${title}`, ``)
    L.push(`| # | sourceRef | 출처 | 본문 | 댓글 | ${key} | 나머지 6종 |`, `|---|---|---|---|---|---|---|`)
    sorted.forEach((r, i) => {
      const rest = M3_SIGNAL_KEYS.filter((k) => k !== key).map((k) => `${k.slice(0, 4)}:${num(r, k)}`).join(' ')
      L.push(`| ${i + 1} | \`${r.sourceRef}\` | ${r.sourceSite} | ${r.bodyLength} | ${r.commentCount} | **${num(r, key)}** | ${rest} |`)
    })
    L.push(``)
  }

  L.push(`## §5 좋은 신호 상위 · 하위 ${TOP_N}건`, ``)
  for (const k of ['naturalnessScore', 'voiceRetention', 'originalityDelta']) {
    table(`${k} 상위 ${TOP_N}`, k, true)
    table(`${k} 하위 ${TOP_N}`, k, false)
  }

  L.push(`## §6 위험 신호 상위 ${TOP_N}건`, ``)
  for (const k of ['overSanitizedRisk', 'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk']) {
    table(`${k} 상위 ${TOP_N}`, k, true)
  }

  // §7 위험 조합
  L.push(`## §7 위험 조합 사례`, ``)
  L.push(`단일 지표로는 보이지 않는 사례다.`, ``)
  const combos: Array<[string, string, (r: SignalRow) => boolean]> = [
    ['판정 불안정', 'overSanitized ≥ 70 **AND** overMimicry ≥ 70 — 서로 반대 방향인데 둘 다 높다',
      (r) => num(r, 'overSanitizedRisk') >= 70 && num(r, 'overMimicryRisk') >= 70],
    ['자연스럽지만 따라 씀', 'naturalness ≥ 80 **AND** sequenceSimilarity ≥ 70 — 가장 위험하다',
      (r) => num(r, 'naturalnessScore') >= 80 && num(r, 'sequenceSimilarityRisk') >= 70],
    ['목소리 상실', 'voiceRetention ≤ 30 **AND** overSanitized ≥ 70',
      (r) => num(r, 'voiceRetention') <= 30 && num(r, 'overSanitizedRisk') >= 70],
    ['표현 위험 단독', 'expressionRisk ≥ 80',
      (r) => num(r, 'expressionRisk') >= 80],
  ]
  for (const [name, cond, fn] of combos) {
    const hit = rows.filter(fn)
    L.push(`### ${name} — ${hit.length}건`, ``, cond, ``)
    if (hit.length > 0) {
      L.push(`| # | sourceRef | 출처 | ${M3_SIGNAL_KEYS.map((k) => k.slice(0, 4)).join(' | ')} |`,
        `|---|---|---|${M3_SIGNAL_KEYS.map(() => '---').join('|')}|`)
      hit.slice(0, TOP_N).forEach((r, i) => {
        L.push(`| ${i + 1} | \`${r.sourceRef}\` | ${r.sourceSite} | ${M3_SIGNAL_KEYS.map((k) => num(r, k)).join(' | ')} |`)
      })
      if (hit.length > TOP_N) L.push(``, `… 외 ${hit.length - TOP_N}건 (signals.csv 참조)`)
    }
    L.push(``)
  }

  // §8 · §9 학습 후보 — 🔴 초안 기준임을 명시
  const good = rows.filter((r) =>
    num(r, 'naturalnessScore') >= 70 && num(r, 'voiceRetention') >= 70 && num(r, 'originalityDelta') >= 60
    && ['overSanitizedRisk', 'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk'].every((k) => num(r, k) <= 30))
  const bad = rows.filter((r) =>
    ['overSanitizedRisk', 'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk'].some((k) => num(r, k) >= 80)
    || num(r, 'sequenceSimilarityRisk') >= 60)

  L.push(`## §8 좋은 학습 후보 — ${good.length}건`, ``)
  L.push(`> 🔴 **초안 기준이다. 확정 기준이 아니다.**`)
  L.push(`> 아래 임계값은 분포를 보기 전에 정한 것이라 근거가 약하다.`)
  L.push(`> §2 의 p10 · p90 을 먼저 읽고 임계값을 다시 정하는 것을 전제로 한다.`, ``)
  L.push(`초안 조건 — naturalness ≥ 70 AND voiceRetention ≥ 70 AND originalityDelta ≥ 60 AND 위험 4종 전부 ≤ 30`, ``)
  if (good.length > 0) {
    L.push(`| # | sourceRef | 출처 | ${M3_SIGNAL_KEYS.map((k) => k.slice(0, 4)).join(' | ')} |`,
      `|---|---|---|${M3_SIGNAL_KEYS.map(() => '---').join('|')}|`)
    good.slice(0, TOP_N).forEach((r, i) => {
      L.push(`| ${i + 1} | \`${r.sourceRef}\` | ${r.sourceSite} | ${M3_SIGNAL_KEYS.map((k) => num(r, k)).join(' | ')} |`)
    })
    if (good.length > TOP_N) L.push(``, `… 외 ${good.length - TOP_N}건`)
  }
  L.push(``)

  L.push(`## §9 학습 제외 후보 — ${bad.length}건`, ``)
  L.push(`> 🔴 **초안 기준이다. 확정 기준이 아니다.**`, ``)
  L.push(`초안 조건 — 위험 4종 중 하나라도 ≥ 80, 또는 sequenceSimilarityRisk ≥ 60 (원문 모방은 더 엄격히 본다)`, ``)
  const byCode = ['overSanitizedRisk', 'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk']
    .map((k) => `${k} ≥ 80: ${rows.filter((r) => num(r, k) >= 80).length}건`)
  L.push(`내역 — ${byCode.join(' · ')} · sequenceSimilarity ≥ 60: ${rows.filter((r) => num(r, 'sequenceSimilarityRisk') >= 60).length}건`, ``)

  // §10 terminal skip
  L.push(`## §10 terminal skip ${skippedRows.length}건`, ``)
  L.push(`🔴 이 ${skippedRows.length}건은 **"나쁜 글"이 아니다.** 가드가 LLM 출력을 막은 것이고, 원문 품질과는 무관하다.`)
  L.push(`output 은 전부 null 이며 원문 조각은 저장되지 않았다.`, ``)
  const codes = [...M3_TERMINAL_SKIP_CODES]
  L.push(`| errorCode | 건수 | 본문 길이 중앙값 | 댓글 수 중앙값 |`, `|---|---|---|---|`)
  for (const code of codes) {
    const sub = skippedRows.filter((r) => r.errorCode === code)
    if (sub.length === 0) continue
    const bl = statOf(sub.map((r) => Number(r.bodyLength)))
    const cc = statOf(sub.map((r) => Number(r.commentCount)))
    L.push(`| \`${code}\` | ${sub.length} | ${bl.median} | ${cc.median} |`)
  }
  L.push(``)

  // §11 한계
  L.push(`## §11 한계와 주의`, ``)
  L.push(`1. 점수는 \`${M3_ANALYSIS_MODEL}\` **단일 모델의 1회 판정**이다. 교차 검증하지 않았다.`)
  L.push(`2. 절대 척도가 아니다. 같은 기준으로 매겨진 값끼리의 **상대 비교**에만 쓴다.`)
  L.push(`3. §5 · §6 의 ${TOP_N}건은 ${rows.length.toLocaleString()}건의 ${(TOP_N / rows.length * 100).toFixed(2)}% 다. 극단값이지 대표값이 아니다.`)
  L.push(`4. §8 · §9 의 임계값은 **초안**이다. 확정 기준으로 쓰지 않는다.`)
  L.push(`5. 원문 · 댓글 · 제목은 이 리포트 어디에도 없다. 사례 확인이 필요하면 \`sourceRef\` 로 역추적한다.`, ``)

  return L.join('\n')
}

main().catch((e: unknown) => {
  console.error(`\n🔴 export 실패 — ${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
})
