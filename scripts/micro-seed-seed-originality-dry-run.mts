#!/usr/bin/env tsx
/**
 * Seed Originality dry-run — 🔴 **초안만 만든다. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-U · §4-X · §4-AA
 *
 * 🔴 **이 도구가 무엇이 아닌지부터.**
 *    발행이 아니다. noindex 배포가 아니다. Raw Vault 적재가 아니다. Post 생성이 아니다.
 *    SRN 승인 파일에서 `decision=SEED` 행을 읽어 **초안 텍스트 두 파일**을 쓸 뿐이다.
 *    그 초안을 쓸지 말지는 사람이 고른다 — 고르는 화면도 아직 없다.
 *
 * 🔴 **LLM 을 부르지 않는다.** 소재 사전 + 템플릿으로만 만든다(lib 참조).
 *    분류하지 못한 행은 초안 0건으로 두고 `needsHuman` 을 남긴다 — 지어내지 않는다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · Prisma · Google Sheet · LLM · 자동 발행 · noindex 배포 ·
 *    Raw Vault 적재 · 네이버 재접속 · live 크롤 · 브라우저 · 82cook adapter.
 *    입력도 출력도 `.microseed-data/` 안 파일뿐이다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-seed-originality-dry-run.mts
 *   npx tsx scripts/micro-seed-seed-originality-dry-run.mts --in=.microseed-data/srn-approvals-20260905.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  expandSeed, DRY_RUN_COLUMNS, DRY_RUN_NOTE, TOPIC_LABEL,
  type Expansion,
} from './lib/micro-seed-seed-originality.mjs'

export const SEED_DATA_DIR = '.microseed-data'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 gitignore 된 `.microseed-data/` 밖으로 읽지도 쓰지도 않는다 */
export function assertInsideDataDir(p: string): void {
  const rel = relative(process.cwd(), resolve(p))
  if (!rel.startsWith(`${SEED_DATA_DIR}/`)) {
    fail(`🔴 ${rel} 은 ${SEED_DATA_DIR}/ 밖이다 — 거부한다.\n   원문 제목이 들어가는 파일이라 gitignore 된 곳에만 둔다.`)
  }
}

export type ApprovalRow = {
  decision?: string; sourceArticleId?: string; sourceSite?: string; title?: string; memo?: string
}

/** 🔴 SEED 행만 — APPROVE · HOLD · DROP · 미선택은 입력이 아니다 */
export function seedRowsOf(rows: readonly ApprovalRow[]): ApprovalRow[] {
  return rows.filter((r) => String(r.decision ?? '') === 'SEED')
}

/** 승인 파일 읽기 — JSON 과 TSV 둘 다 받는다 */
export function readApprovals(path: string): ApprovalRow[] {
  const raw = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) {
    const j = JSON.parse(raw) as { decisions?: ApprovalRow[] }
    return Array.isArray(j.decisions) ? j.decisions : []
  }
  const lines = raw.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const cols = lines[0]!.split('\t')
  return lines.slice(1).map((l) => {
    const cells = l.split('\t')
    const o: Record<string, string> = {}
    cols.forEach((c, i) => { o[c] = cells[i] ?? '' })
    return o as ApprovalRow
  })
}

/** 최신 SRN 승인 파일 — 🔴 이름으로 고른다. 네트워크가 아니다 */
export function latestApprovalFile(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => /^srn-approvals-.*\.(json|tsv)$/.test(f))
    .sort()
  return files.length ? `${dir}/${files[files.length - 1]}` : null
}

/** 최신 **소스 승인** 파일 — §4-AD ⑧ 로 늘어난 두 번째 입력 */
export function latestSourceApprovalFile(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => /^seed-originality-source-approvals-.*\.(json|tsv)$/.test(f))
    .sort()
  return files.length ? `${dir}/${files[files.length - 1]}` : null
}

/** 어느 입력에서 온 SEED 인가 */
export type SeedInput = { row: ApprovalRow; from: string }

/**
 * 두 입력의 SEED 를 합친다 — 🔴 **sourceArticleId 로 중복을 제거한다** (§4-AD ⑧).
 *
 * 🔴 **먼저 읽은 쪽이 이긴다.** 순서는 SRN → 소스로 고정한다.
 *    한 글은 한 축이라 지금은 겹치지 않지만(실측 0건),
 *    재수집으로 본문이 바뀌면 축이 달라질 수 있다. 그때 **둘 다 초안을 만들면
 *    같은 원천에서 두 벌이 나온다** — 어느 쪽이 맞는지 아무도 모르는 채로.
 *    무작위나 "나중 것" 이 아니라 **정해진 순서**로 하나만 남긴다.
 */
export function mergeSeedInputs(
  groups: readonly { rows: readonly ApprovalRow[]; from: string }[],
): { picked: SeedInput[]; duplicates: { articleId: string; kept: string; dropped: string }[] } {
  const picked: SeedInput[] = []
  const duplicates: { articleId: string; kept: string; dropped: string }[] = []
  const seen = new Map<string, string>()
  for (const g of groups) {
    for (const row of g.rows) {
      const id = String(row.sourceArticleId ?? '')
      if (!id) continue
      const kept = seen.get(id)
      if (kept !== undefined) { duplicates.push({ articleId: id, kept, dropped: g.from }); continue }
      seen.set(id, g.from)
      picked.push({ row, from: g.from })
    }
  }
  return { picked, duplicates }
}

/**
 * 산출물 이름에 쓰는 회차 id — `YYYYMMDD-HHMMSS`.
 *
 * 🔴 detail-fetch 의 runId 와 같은 모양이다. 같은 날 여러 번 돌려도 파일이 공존한다.
 *    이름이 시간순으로 정렬되므로 "가장 최근" 을 이름만으로 고를 수 있다.
 */
export function dryRunId(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function toTsv(exps: readonly Expansion[]): string {
  const lines = [DRY_RUN_COLUMNS.join('\t')]
  for (const e of exps) {
    for (const d of e.drafts) {
      lines.push(DRY_RUN_COLUMNS.map((c) => cell(({
        sourceArticleId: e.sourceArticleId, sourceTitle: e.sourceTitle,
        topic: e.topic ?? '', material: e.material ?? '', matched: e.matched ?? '',
        generalized: e.generalized, direction: e.direction,
        draftNo: d.draftNo, title: d.title, body: d.body, bodyLength: d.bodyLength,
        safetyVerdict: d.safety.verdict,
        safetyReasons: d.safety.reasons.map((r) => r.code).join('/'),
        maxOverlapWithSourceTitle: d.overlap,
        leakedTokens: d.leakedTokens.join('/'),
        ok: d.ok ? 'ok' : 'check',
        note: DRY_RUN_NOTE,
        // 🔴 §4-AC ③ — 행마다 출처와 시각을 남긴다
        sourceSite: e.sourceSite,
        generatedAt: d.generatedAt,
        // 🔴 §4-AD ⑧ — 어느 승인 파일의 어떤 판정에서 왔는지
        sourceInput: e.sourceInput,
        sourceDecision: e.sourceDecision,
      } as Record<string, unknown>)[c])).join('\t'))
    }
  }
  return lines.join('\n') + '\n'
}

function main(): void {
  // 🔴 입력이 둘이다 (§4-AD ⑧). --in 을 주면 그 파일 하나만 쓴다.
  const only = arg('in')
  const srnPath = only ?? latestApprovalFile(SEED_DATA_DIR)
  const srcPath = only ? null : latestSourceApprovalFile(SEED_DATA_DIR)
  if (!srnPath && !srcPath) {
    fail(`${SEED_DATA_DIR} 에서 승인 파일을 찾지 못했다 —\n`
      + '   SRN 승인 화면 또는 소스 검수 화면에서 먼저 export 한다')
  }

  const read = (path: string | null): { rows: ApprovalRow[]; from: string } => {
    if (!path) return { rows: [], from: '' }
    assertInsideDataDir(path)
    try { return { rows: seedRowsOf(readApprovals(path)), from: path.split('/').pop() ?? path } }
    catch { return fail(`${path} 를 읽지 못했다`) }
  }
  // 🔴 순서 고정: SRN → 소스. 겹치면 먼저 읽은 쪽이 남는다.
  const srn = read(srnPath)
  const src = read(srcPath)
  const { picked, duplicates } = mergeSeedInputs([srn, src])
  const seeds = picked

  console.log('\nSeed Originality dry-run — 🔴 발행하지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${DRY_RUN_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 자동 발행 0 · noindex 0 · Raw Vault 0 · 네이버 0')
  console.log('  🟢 원문 문장을 쓰지 않는다 — 소재 사전에 걸린 낱말만 쓰고 나머지는 버린다\n')
  console.log('  입력  🔴 두 곳에서 SEED 만 가져온다 (§4-AD ⑧)')
  console.log(`        SRN 승인   ${srnPath ?? '(없음)'}  → SEED ${srn.rows.length}행`)
  console.log(`        소스 승인  ${srcPath ?? '(없음)'}  → SEED ${src.rows.length}행`)
  if (duplicates.length > 0) {
    console.log(`        🟡 중복 ${duplicates.length}건 제거 — 먼저 읽은 쪽을 남긴다`)
    for (const d of duplicates) console.log(`           ${d.articleId}  남김 ${d.kept} · 버림 ${d.dropped}`)
  }
  console.log(`        합계 ${seeds.length}건 (APPROVE·HOLD·DROP·미선택은 애초에 오지 않는다)`)

  if (seeds.length === 0) fail('SEED 행이 없다 — 승인 화면에서 SEED 로 판정한 뒤 export 한다')

  // 🔴 한 회차는 하나의 시각을 공유한다 — 행마다 몇 밀리초씩 다르면 같은 회차인지 알기 어렵다
  const generatedAt = new Date().toISOString()
  // 🔴 **memo 를 넘기지 않는다.** 승인 파일에는 남아 있지만 소재 입력이 아니다 —
  //    검수 메모의 낱말이 소재 사전에 걸려 엉뚱한 초안이 나온 적이 있다(2026-09-05).
  const exps = seeds.map(({ row: r, from }) => expandSeed({
    sourceArticleId: String(r.sourceArticleId ?? ''),
    sourceSite: String(r.sourceSite ?? ''),
    title: String(r.title ?? ''),
    // 🟡 기록용 — 분류에는 쓰이지 않는다
    sourceInput: from,
    sourceDecision: String(r.decision ?? ''),
  }, generatedAt))

  let drafts = 0
  let flagged = 0
  for (const e of exps) {
    console.log(`\n── ${e.sourceArticleId}${e.sourceSite ? ` · ${e.sourceSite}` : ''}  ${e.needsHuman ? '🔴 분류 못 함' : `[${e.topicLabel}]`}`)
    console.log(`   소재    ${e.material ?? '(없음)'}${e.matched && e.matched !== e.material ? `  ← 원문 "${e.matched}"` : ''}`)
    console.log(`   일반화  ${e.generalized}`)
    console.log(`   방향    ${e.direction}`)
    for (const d of e.drafts) {
      drafts++
      if (!d.ok) flagged++
      console.log(`   [${d.draftNo}] ${d.title}`)
      console.log(`       본문 ${d.bodyLength}자 · safety ${d.safety.verdict} · 원문 최대겹침 ${d.overlap}자` +
        `${d.leakedTokens.length ? ` · 🔴 원문 낱말 ${d.leakedTokens.join('/')}` : ''}${d.ok ? '' : '  🔴 확인 필요'}`)
    }
  }

  // 🔴 **날짜만 쓰지 않는다.** 같은 날 두 번 돌리면 앞 회차를 덮어쓴다 —
  //    2026-09-05 에 1회차 초안 9건이 그렇게 사라졌다. 시각까지 넣어 두 파일이 공존하게 한다.
  const runId = dryRunId(new Date())
  const tsvPath = `${SEED_DATA_DIR}/seed-originality-dry-run-${runId}.tsv`
  const jsonPath = `${SEED_DATA_DIR}/seed-originality-dry-run-${runId}.json`
  assertInsideDataDir(tsvPath)
  assertInsideDataDir(jsonPath)
  writeFileSync(tsvPath, toTsv(exps), 'utf-8')
  writeFileSync(jsonPath, JSON.stringify({
    note: DRY_RUN_NOTE,
    // 🔴 행에 박은 값과 같아야 한다 — 다르면 어느 쪽이 맞는지 알 수 없다
    generatedAt,
    sources: { srn: srnPath, source: srcPath },
    topics: Object.entries(TOPIC_LABEL).map(([k, v]) => ({ key: k, label: v })),
    expansions: exps,
  }, null, 2), 'utf-8')

  console.log('\n─────────────────────────────────────────────────────────')
  console.log(`  SEED ${seeds.length}건 → 초안 ${drafts}건` +
    `${flagged ? ` · 🔴 확인 필요 ${flagged}건` : ' · 전부 통과'}`)
  const human = exps.filter((e) => e.needsHuman).length
  if (human) console.log(`  🔴 분류 못 한 ${human}건은 초안을 만들지 않았다 — 사람이 써야 한다`)
  console.log(`  ✅ ${tsvPath}`)
  console.log(`  ✅ ${jsonPath}`)
  console.log(`\n  🔴 ${DRY_RUN_NOTE}\n`)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 파일을 쓰지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
