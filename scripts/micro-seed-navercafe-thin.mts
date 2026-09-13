/**
 * 네이버 카페 수집물 → 얇은 저장 (§4-AV)
 *
 * 🔴 **네트워크에 나가지 않는다.** 이미 수집된 `navercafe-*.jsonl` 을 읽어 형태만 바꾼다.
 *    수집은 launchd `-multi` job 이 하고(두 카페 각 하루 4회), 이 도구는 그 산출물을 받는다.
 *
 * 왜 필요한가 — 2026-09-07 실측:
 *   · `auto-judge` 는 `.detail.jsonl` · `.raw-detail.jsonl` 만 읽는다.
 *     네이버 수집물은 `navercafe-<cafe>-<runId>.jsonl` 이라 **판정에 닿지 못했다**
 *   · 그 파일에 `rawBody` **전문**이 들어 있었다 (최대 2,899자).
 *     82cook 은 마스킹 후 300자만 남기는데 네이버만 전문을 들고 있었다
 *
 * 산출물은 `*.thin-detail.jsonl` 이다 — 기존 `82cook-thin-adapt` 가 그대로 집어
 * `.detail.jsonl` 로 바꾸고, 거기서부터는 82cook 과 **같은 레일**을 탄다.
 *
 *   인자 없음   계획만 — 파일 write 0 · DB 0 · 네트워크 0
 *   --apply     `*.thin-detail.jsonl` 생성
 *   --cafe=<id> 특정 카페만 (기본: 전부)
 *   --input=<p> 특정 파일만 (기본: `.microseed-data` 의 navercafe 수집물 전부)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { classifyDetail } from './lib/micro-seed-detail-classify.mjs'
import { maskSensitive, BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { toThinRow, violatesStorage } from '../src/lib/micro-seed-82cook-thin'
import {
  SKIP_LABEL, CAFE_BODY_HEAD_CHARS, planCafeThin, keepAfterClassify, outPathOf,
  statsOf, verifyThinRun, dedupKeyOf, uniqueSourceCount, type CafeRow, type SkipCode,
} from '../src/lib/micro-seed-navercafe-thin'

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? null : hit.slice(n.length + 3)
}
const APPLY = argv.includes('--apply')
const CAFE = arg('cafe')
const INPUT = arg('input')
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/** 🔴 `.microseed-data` 밖으로는 쓰지 않는다 */
function isInsideDataDir(p: string): boolean {
  const rel = relative(resolve('.'), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${DATA_DIR}/`)
}

function jsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown> } catch { return {} } })
}

/**
 * 수집물 — 🔴 상세 파일만 본다.
 * `.list.jsonl` 은 목록이라 본문이 없다. 섞어 읽으면 "본문 없음" 으로 전부 걸러진다.
 */
function cafeFiles(): string[] {
  if (INPUT !== null) return [INPUT]
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR)
    .filter((f) => /^navercafe-[a-z0-9]+-[0-9-]+\.jsonl$/i.test(f))
    .filter((f) => CAFE === null || f.startsWith(`navercafe-${CAFE}-`))
    .sort().map((f) => join(DATA_DIR, f))
}

/**
 * 이미 본문을 가진 것 — 🔴 **`sourceSite|articleId` 로 본다.**
 *
 * 세 접미를 다 본다(하나만 보면 재탕이 샌다). 그리고 **소스를 붙여** 센다 —
 * 82cook 의 447520 과 레몬테라스의 447520 은 다른 글이고,
 * id 만으로 막으면 한쪽을 먹었다는 이유로 다른 쪽을 영영 건너뛴다.
 */
function seenKeys(): Set<string> {
  const seen = new Set<string>()
  if (!existsSync(DATA_DIR)) return seen
  for (const suffix of ['.thin-detail.jsonl', '.detail.jsonl', '.raw-detail.jsonl']) {
    for (const f of readdirSync(DATA_DIR).filter((x) => x.endsWith(suffix))) {
      for (const r of jsonl(join(DATA_DIR, f))) {
        const id = S(r.sourceArticleId)
        if (id !== '') seen.add(dedupKeyOf(r.sourceSite, id))
      }
    }
  }
  return seen
}

const runIdOf = (d: Date): string =>
  `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`

async function main(): Promise<void> {
  console.log(`\n══ 네이버 카페 얇은 저장 — ${APPLY ? '🔴 파일 생성' : '계획만 (파일 write 0)'} ══\n`)
  console.log(`  🔴 네트워크 0 · LLM 0 · DB 0 · Sheet 0 · 발행 0 — 이미 수집된 파일만 읽는다`)
  console.log(`  🔴 본문 전문을 저장하지 않는다 — 마스킹 후 앞 ${BODY_HEAD_CHARS}자만 남긴다`)

  // 🔴 두 상수가 어긋나면 한쪽만 전문에 가까워진다
  if (CAFE_BODY_HEAD_CHARS !== BODY_HEAD_CHARS) {
    fail(`본문 길이 계약이 어긋난다: lib ${CAFE_BODY_HEAD_CHARS} vs 정본 ${BODY_HEAD_CHARS}`)
  }

  const files = cafeFiles()
  if (files.length === 0) fail(`${DATA_DIR} 에 navercafe 상세 수집물이 없다`)
  console.log(`\n① 수집물 ${files.length}개`)
  for (const f of files) console.log(`   · ${f}`)

  // 🔴 파일 하나가 깨져도 나머지를 버리지 않는다 — remonterrace 가 터진 날
  //    wgang 과 82cook 까지 멈추면 공급이 통째로 끊긴다
  const rows: CafeRow[] = []
  const badFiles: string[] = []
  for (const f of files) {
    try {
      for (const r of jsonl(f)) rows.push(r as CafeRow)
    } catch (e) {
      badFiles.push(`${f} — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (badFiles.length > 0) {
    console.log(`\n   🟡 읽지 못한 파일 ${badFiles.length}개 (나머지는 그대로 처리한다)`)
    for (const b of badFiles) console.log(`      · ${b}`)
  }

  const seen = seenKeys()
  const plan = planCafeThin({
    rows, seen,
    // 🔴 수집 당시 플래그가 안 붙은 정치·안전 소재를 여기서 한 번 더 거른다
    judge: {
      isPolitics: (title) => safetyFilter({ title }).reasons
        .map((x) => String(x)).includes('politicalOrPublicFigure'),
      isBlocked: (title) => {
        const v = safetyFilter({ title }).verdict
        return v === 'hardExclude' || v === 'drop'
      },
    },
  })
  /**
   * 🔴 **네 갈래를 섞지 않는다** (2026-09-13).
   *    "제외" 한 덩어리로 찍으면 버린 것과 미룬 것이 같아 보인다 —
   *    실제로 2026-09-11~12 관측에서 1,384건이 "제외" 로 보였는데 대부분 **이월**이었다.
   */
  console.log(`\n② 행 ${rows.length}건 (고유 원천 ${uniqueSourceCount(rows)}건)`)
  console.log(`   🟢 이번 회차 처리   ${plan.targets.length}건`)
  console.log(`   🟡 다음 회차로 이월 ${plan.deferred.length}건  — 회차 상한 때문이다. 버린 것이 아니다`)
  console.log(`   ⚪ 이미 읽음        ${plan.alreadyRead.length}건`)
  console.log(`   🔴 안 가져옴        ${plan.rejected.length}건`)
  if (plan.rejected.length > 0) {
    const byCode = new Map<string, number>()
    for (const s of plan.rejected) byCode.set(s.code, (byCode.get(s.code) ?? 0) + 1)
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${String(n).padStart(4)}건  ${SKIP_LABEL[code as SkipCode]}`)
    }
  }

  // ── ③ 변환 — 🔴 마스킹을 **자르기 전에** 한다 ──
  const runId = runIdOf(new Date())
  const out: Record<string, unknown>[] = []
  const dropped = new Map<string, number>()
  for (const r of plan.targets) {
    const title = S(r.originalTitle)
    // 🔴 순서를 바꾸면 경계에 걸친 연락처가 절반만 지워진다
    const masked = maskSensitive(S(r.rawBody))
    const v = classifyDetail({
      title, body: masked, comments: [], imageCount: 0,
      boardName: S(r.sourceBoardName) || '자유게시판',
      qualityFlags: Array.isArray(r.qualityFlags) ? r.qualityFlags.map(String) : [],
      access: 'ok',
    })
    const axis = String(v.axis)
    const safetyVerdict = String(v.safety.verdict)
    const keep = keepAfterClassify({ axis, safetyVerdict })
    if (!keep.keep) {
      const c = keep.code ?? 'DROP'
      dropped.set(c, (dropped.get(c) ?? 0) + 1)
      continue
    }
    const row = toThinRow({
      id: S(r.sourceArticleId), url: S(r.sourceUrl), title,
      commentCount: Number(r.sourceCommentCount ?? 0), score: 0,
      maskedBody: masked, bodyHeadChars: BODY_HEAD_CHARS,
      axis, safetyVerdict,
      safetyReasons: v.safety.reasons.map((x) => String(x)),
      reason: String(v.reason), runId, fetchedAt: new Date().toISOString(),
      // 🔴 여기가 82cook 과 다른 유일한 값이다
      sourceSite: S(r.sourceSite),
    })
    // 🔴 저장 직전 마지막 관문 — 전문 컬럼이 섞였으면 통째로 멈춘다
    const bad = violatesStorage(row as unknown as Record<string, unknown>, BODY_HEAD_CHARS)
    if (bad.length > 0) fail(`저장 계약 위반\n${bad.map((b) => `     ${b}`).join('\n')}`)
    out.push(row as unknown as Record<string, unknown>)
  }

  const st = statsOf(out)
  console.log(`\n③ 변환 ${out.length}건`)
  for (const [axis, n] of Object.entries(st.byAxis).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}건  ${axis}`)
  }
  if (dropped.size > 0) {
    console.log(`   🔴 저장하지 않음 ${[...dropped.values()].reduce((a, b) => a + b, 0)}건`)
    for (const [c, n] of dropped) console.log(`     ${String(n).padStart(4)}건  ${SKIP_LABEL[c as SkipCode]}`)
  }

  if (!APPLY) {
    console.log('\n④ 쓰지 않는다 — 계획만이다.')
    console.log('   🟡 파일 write 0 · 네트워크 0 · LLM 0 · DB 0. 실행하려면 --apply 를 붙이세요.\n')
    return
  }
  if (out.length === 0) {
    console.log('\n④ 쓸 것이 없다 — 대상 0건.\n')
    return
  }

  // ── ④ 저장 — 카페별로 나눈다 ──
  const byCafe = new Map<string, Record<string, unknown>[]>()
  for (const row of out) {
    const site = S(row.sourceSite)
    const cafe = site.startsWith('navercafe:') ? site.slice('navercafe:'.length) : 'unknown'
    const list = byCafe.get(cafe) ?? []
    list.push(row)
    byCafe.set(cafe, list)
  }
  console.log(`\n④ 🔴 저장 (runId ${runId})`)
  let written = 0
  for (const [cafe, list] of byCafe) {
    const path = outPathOf(DATA_DIR, cafe, runId)
    if (!isInsideDataDir(path)) fail(`${path} 은 ${DATA_DIR}/ 밖이다 — 거부한다`)
    writeFileSync(path, `${list.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8')
    written += list.length
    console.log(`   ✅ ${path}  ${list.length}행`)
  }

  const v = verifyThinRun({
    planned: plan.targets.length, written, networkRequests: 0, dbWrites: 0,
  })
  console.log(`\n⑤ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
  for (const p of v.problems) console.log(`   ${p}`)
  console.log('\n   다음: micro-seed:82cook-thin-adapt 가 이 파일을 검수용으로 바꾼다')
  console.log('   🔴 큐에 넣지 않았다 · 발행하지 않았다.\n')
  if (!v.ok) process.exit(1)
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
