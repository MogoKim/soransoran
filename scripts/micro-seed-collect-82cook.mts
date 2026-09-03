#!/usr/bin/env tsx
/**
 * 82cook Micro Seed 후보 수집 — 목록 + 지정 상세
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §6-9-F · §6-10 · §12-2
 *
 * 🔴 이 스크립트는 DB 도 Sheet 도 건드리지 않는다
 *    prisma 를 import 하지 않고, Sheet API 를 부르지 않는다. 산출물은 로컬 JSONL 뿐이다.
 *    DB · Sheet 적재는 **다음 PR** 의 일이고, 그 경계를 파일로 나눈 것이 이 설계의 핵심이다.
 *
 * 🔴 목록에서 상세를 전부 긁지 않는다
 *    목록은 URL · 제목 · 댓글수만 본다. 상세는 고른 것만 연다.
 *    "일단 다 받아두고 나중에 고른다" 는 부하도 리스크도 우리가 정하지 않은 것이 된다.
 *
 *      --fetch=<id,id>   사람이 지정한다 (기존)
 *      --auto            선별 점수 상위 N건을 자동으로 연다 (PR-S2)
 *
 * 🔴 --auto 가 여는 문은 좁다 (scripts/lib/micro-seed-supply.mts)
 *    상한 30건 · 하한 점수 20 · 정치·실명 / 의료·광고성 플래그는 **자동으로 열지 않는다.**
 *
 *    이것은 Q-1("품질 플래그로 거부하지 않는다")의 예외가 아니다.
 *    거부가 아니라 **자동 경로에서만 빼는 것**이다 — 목록 JSONL 에는 전부 남고
 *    `--fetch=<id>` 로 지정하면 언제든 열린다.
 *    구분이 중요한 이유: 자동 경로에는 사람이 없다. 사람이 고를 때는 보고 넘기면 되지만
 *    자동은 넘길 눈이 없고, 그 글이 그대로 생성기의 재료가 된다.
 *
 * 🔴 댓글 본문을 수집하지 않는다
 *    목록의 댓글 **수**만 신호로 쓴다 (정책 3). 상세에서 댓글 영역을 파싱하지 않는다.
 *
 * 🔴 이미지를 가져오지 않는다
 *    htmlToText 가 <img> 를 흔적 없이 지운다. URL 조차 남기지 않는다 —
 *    이미지 포함 원문 재발행은 롤백 사고 이력이 있는 금지 사항이다.
 *
 * 🔴 품질 플래그는 **거부하지 않는다** (Q-1)
 *    산출물에 qualityFlags 가 붙지만 그것으로 후보를 버리지 않는다.
 *    정치성 · 실명 · 낮은 댓글수 · 낚시성 제목 · 짧은 본문은 플래그로만 보여준다 —
 *    조용히 버려진 글은 아무도 모른다. 거부는 rawBody 가 빈 글 하나뿐이다.
 *
 * 안전장치
 *   dry-run 기본   --live 가 없으면 네트워크를 타지 않는다. 계획만 출력한다
 *   kill switch    SORAN_82COOK_COLLECT_ENABLED=true 가 아니면 --live 가 무시된다
 *   robots         매 실행마다 robots.txt 를 읽어 대상 경로가 허용되는지 확인한다
 *   고정 지연      요청 사이 2초. 랜덤 jitter 없음
 *   cron 없음      §6-9-F — M1 은 수동 실행이다
 *
 * 사용법
 *   npm run micro-seed:collect-82cook -- --list --pages=2              계획만
 *   npm run micro-seed:collect-82cook -- --list --pages=2 --live       실제 수집
 *   npm run micro-seed:collect-82cook -- --fetch=4231986,4231985 --live
 *   npm run micro-seed:collect-82cook -- --list --pages=3 --auto --live         🔴 자동 선별 수집
 *   npm run micro-seed:collect-82cook -- --list --pages=3 --auto --auto-max=10  상한을 줄여서
 *   npm run micro-seed:collect-82cook -- --list --pages=1 --live --out=./.microseed-data/list.jsonl
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ARTICLE_URL, BOARD_NAME, BOARD_NO, DELAY_MS, LIST_URL, ROBOTS_URL, SOURCE_SITE, USER_AGENT,
  buildCollected, extractArticleBodyHtml, htmlToText, isPathAllowed,
  parseArticleTitle, parseListHtml, parseRobotsTxt, toRobotsPath,
  type CollectedCandidate, type ListItem, type RobotsRules,
} from './lib/micro-seed-82cook.mjs'
import { selectionScore, type QualityAssessment } from './lib/micro-seed-quality.mjs'
import {
  planAutoFetch, judgeAutoHold,
  AUTO_FETCH_MAX, AUTO_MIN_SCORE, AUTO_SKIP_LIST_FLAGS, AUTO_HOLD_DETAIL_FLAGS,
} from './lib/micro-seed-supply.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'

const KILL_SWITCH = 'SORAN_82COOK_COLLECT_ENABLED'
const LIVE = process.argv.includes('--live')
const WANT_LIST = process.argv.includes('--list')
const AUTO = process.argv.includes('--auto')
const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const PAGES = Number(arg('pages') ?? '1')
const FETCH_IDS = (arg('fetch') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = arg('out') ?? './.microseed-data/82cook.jsonl'
const FROM = arg('from')
const AUTO_MAX = Number(arg('auto-max') ?? String(AUTO_FETCH_MAX))

// 🔴 --auto 는 목록이 있어야 고를 수 있다. 조합이 안 맞으면 조용히 0건이 아니라 중단한다
if (AUTO && !WANT_LIST) {
  console.error('\n🛑 --auto 는 --list 와 함께 쓴다. 고를 목록이 없으면 자동 선별이 성립하지 않는다.\n')
  process.exit(1)
}
if (AUTO && FETCH_IDS.length) {
  console.error('\n🛑 --auto 와 --fetch 를 함께 주지 않는다. 자동으로 고를지 사람이 고를지 하나만 정한다.\n')
  process.exit(1)
}
if (AUTO && (!Number.isInteger(AUTO_MAX) || AUTO_MAX < 1 || AUTO_MAX > AUTO_FETCH_MAX)) {
  console.error(`\n🛑 --auto-max 는 1~${AUTO_FETCH_MAX} 의 정수다 (받은 값: ${arg('auto-max') ?? '없음'})\n`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return await res.text()
}

function writeJsonl(path: string, rows: object[]) {
  mkdirSync(dirname(path), { recursive: true })
  for (const r of rows) appendFileSync(path, `${JSON.stringify(r)}\n`, 'utf-8')
}

// ─────────────────────────────────────────────────────────
// 선별 보조 출력 (Q-1)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 플래그는 사람이 읽고 판단하라고 있는 것이다.
 *    기호를 쓰되 뜻을 같이 적는다 — 나중에 이 출력만 보고도 근거를 알 수 있어야 한다.
 */
const FLAG_LABEL: Record<string, string> = {
  targetLikely: '🎯우리또래',
  personalExperienceLikely: '🗣경험담',
  practicalConcernLikely: '🧩생활고민',
  highEngagement: '💬반응많음',
  lowEngagement: '🕓반응없음',
  politicalOrPublicFigure: '🟠정치·실명',
  clickbaitTitle: '🎣낚시성',
  shortTitle: '✂️짧은제목',
  titleTruncated: '✂️제목잘림',
  shortBody: '📄짧은본문',
  linkHeavyBody: '🔗링크위주',
  imageLikelyBody: '🖼이미지의존',
  // Q-1 보강 — 본문 위험 신호. 🔴 표시일 뿐 거부가 아니다
  medicalOrAdLikely: '🏥의료·광고성',
  quotedOrMediaLikely: '📰전언·방송',
  publicFigureMention: '🟠본문실명',
}

function describeFlags(flags: readonly string[]): string {
  if (!flags.length) return '(플래그 없음)'
  return flags.map((f) => FLAG_LABEL[f] ?? f).join(' ')
}

/**
 * 목록을 **선별 점수 순**으로 세운다.
 *
 * 🔴 예전에는 댓글 많은 순이었다. 그 정렬의 1순위가 `제주도관광 망하겠어요`(댓글 9) 였는데
 *    상세까지 열고 **발행하지 않은 글**이다 — 본문 62자에 URL 이 65% 였다.
 *    댓글수는 좋은 후보의 신호 중 하나일 뿐 순서를 정할 근거는 못 된다.
 *
 * 🔴 점수가 낮다고 버리지 않는다. 전부 파일에 저장돼 있고 여기서는 순서만 바꾼다.
 */
function printSelectionTable(rows: CollectedCandidate[]) {
  const scored = rows
    .map((r) => ({
      row: r,
      score: selectionScore({
        stage: r.qualitySignals.stage,
        flags: r.qualityFlags,
        signals: r.qualitySignals,
      } as QualityAssessment),
    }))
    .sort((a, b) => b.score - a.score || b.row.sourceCommentCount - a.row.sourceCommentCount)

  const top = scored.slice(0, 10)
  console.log('  선별 점수 순 상위 10건 (상세는 --fetch 로 골라서 연다):')
  console.log('  🔴 점수는 순서일 뿐이다. 낮다고 버려진 것이 아니라 전부 파일에 있다.\n')
  for (const { row, score } of top) {
    console.log(
      `     ${String(score).padStart(4)}  댓글${String(row.sourceCommentCount).padStart(3)}  ` +
        `${row.sourceArticleId}  ${row.originalTitle.slice(0, 34)}`,
    )
    console.log(`           ${describeFlags(row.qualityFlags)}`)
  }

  const flagged = rows.filter((r) => r.qualityFlags.includes('politicalOrPublicFigure')).length
  const target = rows.filter(
    (r) => r.qualityFlags.includes('targetLikely') && !r.qualityFlags.includes('politicalOrPublicFigure'),
  ).length
  console.log('')
  console.log(`  전체 ${rows.length}건 · 🎯우리또래(정치·실명 제외) ${target}건 · 🟠정치·실명 ${flagged}건`)
  console.log('  🔴 정치·실명은 걸러진 것이 아니라 표시만 했다. 고르는 것은 사람이 한다.\n')
}

async function main() {
  await loadEnvLocal()
  const enabled = process.env[KILL_SWITCH] === 'true'
  const live = LIVE && enabled
  const now = new Date()

  console.log('\n82cook Micro Seed 후보 수집')
  console.log(`  sourceSite=${SOURCE_SITE} · 게시판 bn=${BOARD_NO}(${BOARD_NAME}) · ${kstString(now)} KST`)
  console.log(`  User-Agent: ${USER_AGENT}`)
  console.log(`  요청 간격: ${DELAY_MS}ms 고정 (랜덤 jitter 없음)`)
  console.log(`  kill switch ${KILL_SWITCH}=${enabled ? 'ON' : 'OFF'} · --live ${LIVE ? '있음' : '없음'}`)
  console.log(
    live
      ? `  🔴 실제 수집 · 출력 ${OUT}\n`
      : `  🔍 dry-run — 네트워크를 타지 않는다. 실제 수집은 --live 와 ${KILL_SWITCH}=true 둘 다 필요하다\n`,
  )
  console.log('  🔴 DB write 없음 · Sheet write 없음 · Post 생성 없음 · 댓글 본문 미수집 · 이미지 미수집\n')

  // ── 계획 출력 (dry-run 이든 아니든 무엇을 할지 먼저 말한다) ──
  const plannedList = WANT_LIST ? Array.from({ length: PAGES }, (_, i) => LIST_URL(i + 1)) : []
  const plannedArticles = FETCH_IDS.map(ARTICLE_URL)
  if (plannedList.length) console.log(`  목록 ${plannedList.length}페이지:\n${plannedList.map((u) => `     ${u}`).join('\n')}`)
  if (plannedArticles.length) console.log(`  상세 ${plannedArticles.length}건:\n${plannedArticles.map((u) => `     ${u}`).join('\n')}`)
  if (AUTO) {
    console.log(`  상세: 🔴 자동 선별 — 목록에서 최대 ${AUTO_MAX}건 (점수 ${AUTO_MIN_SCORE} 이상)`)
    console.log(`        ① 목록 단계 제외 (열기 전) : ${AUTO_SKIP_LIST_FLAGS.join(' · ')}`)
    console.log(`        ② 상세 단계 보류 (연 뒤)   : ${AUTO_HOLD_DETAIL_FLAGS.join(' · ')}`)
    console.log('        🔴 ②는 제목만으로 판정되지 않아 목록 단계에서 못 거른다 (2026-09-03 실측)')
    console.log('        🔴 제외·보류 전부 거부가 아니다 — 파일에 남고 --fetch 로 지정하면 열린다')
  }
  if (!plannedList.length && !plannedArticles.length) {
    console.log('  할 일이 없다. --list --pages=N 또는 --fetch=<num,num> 을 준다.\n')
    return
  }

  if (!live) {
    console.log(`\n  🔍 dry-run 종료. 네트워크 요청 0건 · 파일 쓰기 0건.`)
    if (LIVE && !enabled) console.log(`     (--live 를 줬지만 ${KILL_SWITCH} 가 true 가 아니라 무시했다)`)
    console.log('')
    return
  }

  // ── robots.txt — 실행마다 확인한다 ────────────────────
  const robotsText = await get(ROBOTS_URL)
  const rules: RobotsRules = parseRobotsTxt(robotsText)
  console.log(`\n  robots.txt · User-agent:* Disallow ${rules.disallow.length}건`)
  for (const d of rules.disallow) console.log(`     ${d}`)

  const blocked = [...plannedList, ...plannedArticles].filter((u) => !isPathAllowed(toRobotsPath(u), rules))
  if (blocked.length) {
    console.error(`\n  🛑 robots 가 막는 URL 이 있다 — 수집하지 않는다:\n${blocked.map((u) => `     ${u}`).join('\n')}\n`)
    process.exit(1)
  }
  console.log('  ✅ 대상 URL 전부 robots 허용\n')

  // ── ① 목록 ────────────────────────────────────────────
  const items: ListItem[] = []
  for (let p = 1; p <= (WANT_LIST ? PAGES : 0); p += 1) {
    const html = await get(LIST_URL(p))
    const parsed = parseListHtml(html)
    items.push(...parsed)
    console.log(`  목록 ${p}p → ${parsed.length}건`)
    if (p < PAGES) await sleep(DELAY_MS)
  }
  // 🔴 --auto 가 이 배열을 읽는다. 블록 밖에 둬야 선별이 목록과 같은 정규화를 본다
  let listRows: CollectedCandidate[] = []
  if (items.length) {
    const listPath = OUT.replace(/\.jsonl$/, '.list.jsonl')
    // 🔴 목록도 buildCollected 를 거친다 (2026-08-26 실측 결함).
    //    예전에는 여기서 객체를 직접 만들어 sourceBoardName · sourceCapturedAt 이 빠졌다.
    //    상세 산출물은 9필드인데 목록은 6필드라, 목록을 importer 에 넘기면 두 칸이 빈다.
    //    정규화 경로를 하나로 두면 같은 종류의 누락이 다시 생기지 않는다 (C-2).
    //
    //    rawBody 는 **빈 문자열**이다 — 목록은 본문을 읽지 않는다.
    //    importer 는 rawBody 가 빈 행을 거부하므로 목록 파일이 잘못 들어와도 적재되지 않는다.
    const rows = items.map((i) => buildCollected(i, '', now.toISOString()))
    listRows = rows
    writeJsonl(listPath, rows)
    console.log(`  → ${listPath} (${rows.length}건)\n`)
    printSelectionTable(rows)
  }

  // ── ② 상세 대상 결정 — 사람이 지정(--fetch) 또는 자동 선별(--auto) ──
  let targets: string[] = FETCH_IDS
  if (AUTO) {
    if (!listRows.length) {
      console.log('  목록이 비어 자동 선별할 것이 없다.\n')
      return
    }
    const plan = planAutoFetch(
      listRows.map((r) => ({
        sourceArticleId: r.sourceArticleId,
        score: selectionScore({ stage: r.qualitySignals.stage, flags: r.qualityFlags, signals: r.qualitySignals } as QualityAssessment),
        flags: r.qualityFlags,
        // 🔴 Vault 대조는 여기서 하지 않는다 — 이 스크립트는 DB 를 붙이지 않는다(파일 상단 계약).
        //    이미 있는 원문은 importer 가 @@unique 로 SKIP 하므로 중복 적재는 생기지 않는다.
        //    여기서 걸러지지 않아 생기는 비용은 82cook 요청 몇 건이다.
        alreadyInVault: false,
      })),
      { max: AUTO_MAX },
    )
    targets = plan.picked
    const byReason = new Map<string, number>()
    for (const s of plan.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
    console.log(`  자동 선별: ${targets.length}건 선택 · ${plan.skipped.length}건 제외`)
    for (const [reason, n] of byReason) console.log(`     ${reason} ${n}건`)
    console.log('  🔴 제외는 파일에서 지운 것이 아니다. 목록 JSONL 에 전부 남아 있다.\n')
  }

  if (!targets.length) {
    console.log(`  상세 요청 없음 (${AUTO ? '자동 선별 결과 0건' : '--fetch 미지정'}). 목록만 저장했다.\n`)
    return
  }

  // 🔴 자동 선별 대상은 위 robots 사전 검사에 없었다 — 목록을 받은 뒤에 정해지기 때문이다.
  //    여기서 다시 본다. 검사를 건너뛰면 --auto 만 robots 밖으로 나가는 구멍이 생긴다.
  if (AUTO) {
    const autoBlocked = targets.map(ARTICLE_URL).filter((u) => !isPathAllowed(toRobotsPath(u), rules))
    if (autoBlocked.length) {
      console.error(`\n  🛑 robots 가 막는 URL 이 자동 선별에 들어왔다 — 수집하지 않는다:\n${autoBlocked.map((u) => `     ${u}`).join('\n')}\n`)
      process.exit(1)
    }
    console.log(`  ✅ 자동 선별 ${targets.length}건 robots 허용\n`)
  }
  // 목록 정보가 있으면 그것을, 없으면 파일에서 찾는다 — 댓글수를 상세에서 세지 않기 위해서다.
  const known = new Map(items.map((i) => [i.sourceArticleId, i]))
  if (FROM && existsSync(FROM)) {
    for (const line of readFileSync(FROM, 'utf-8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as ListItem
      if (row?.sourceArticleId) known.set(row.sourceArticleId, row)
    }
  }

  const collected: CollectedCandidate[] = []
  for (const [idx, id] of targets.entries()) {
    if (idx > 0) await sleep(DELAY_MS)
    const html = await get(ARTICLE_URL(id))
    const bodyHtml = extractArticleBodyHtml(html)
    if (!bodyHtml) {
      console.error(`  ⚠️ ${id} — 본문(div#articleBody)을 찾지 못했다. 건너뛴다`)
      continue
    }
    const rawBody = htmlToText(bodyHtml)
    if (!rawBody) {
      console.error(`  ⚠️ ${id} — 본문이 비었다(이미지만 있는 글일 수 있다). 건너뛴다`)
      continue
    }
    // 🔴 상세 제목을 목록 제목보다 **우선**한다 (2026-08-26 실측 결함).
    //    목록 제목은 37자에서 잘린다 — 실측 25건 중 5건(20%)이 `..` · `…` · `&q` 로 끝났다.
    //    importer 는 originalTitle 을 founderTitle 초기값으로 그대로 쓰므로,
    //    잘린 제목이 그대로 발행된다. 상세를 여는 순간 온전한 제목을 얻을 수 있는데
    //    그것을 버리고 있었다.
    //    ⚠️ 이미 발행된 글은 소급 수정하지 않는다 — 발행은 비가역이다(§6-4).
    const detailTitle = parseArticleTitle(html)
    const listed = known.get(id)
    const base: ListItem = listed
      ? { ...listed, originalTitle: detailTitle ?? listed.originalTitle }
      : {
          sourceArticleId: id,
          sourceUrl: ARTICLE_URL(id),
          originalTitle: detailTitle ?? '',
          sourceCommentCount: 0,
        }
    if (!base.originalTitle) {
      console.error(`  ⚠️ ${id} — 제목을 얻지 못했다. 건너뛴다`)
      continue
    }
    if (!listed) {
      console.log(`  ℹ️ ${id} — 목록 정보가 없어 sourceCommentCount=0 으로 둔다 (상세에서 세지 않는다)`)
    } else if (detailTitle && detailTitle !== listed.originalTitle) {
      console.log(`  ✏️ ${id} — 상세 제목으로 교체 (목록 제목이 잘려 있었다)`)
      console.log(`       목록: ${listed.originalTitle}`)
      console.log(`       상세: ${detailTitle}`)
    }
    const row = buildCollected(base, rawBody, now.toISOString())
    collected.push(row)
    console.log(`  ✅ ${id} · ${rawBody.length}자 · 댓글 ${base.sourceCommentCount} · ${base.originalTitle.slice(0, 30)}`)
    console.log(`       ${describeFlags(row.qualityFlags)}`)
  }

  if (collected.length) {
    // 🔴 원자료를 그대로 쓴다. 보류 대상도 파일에 남는다 —
    //    조용히 버려진 글은 아무도 모른다(Q-1). 보류는 **적재 단계**에서 일어난다.
    writeJsonl(OUT, collected)
    console.log(`\n  → ${OUT} (${collected.length}건)`)
  }

  // ── 자동 보류 예고 — 사람이 지금 알아야 다음 명령을 정할 수 있다 ──
  if (AUTO && collected.length) {
    const heldRows = collected.filter((r) => judgeAutoHold({ sourceArticleId: r.sourceArticleId, flags: r.qualityFlags }).hold)
    if (heldRows.length) {
      console.log(`\n  🟡 자동 적재 보류 예정 ${heldRows.length}건 — 상세를 열어야 붙는 플래그다`)
      for (const r of heldRows) {
        const hit = AUTO_HOLD_DETAIL_FLAGS.filter((f) => r.qualityFlags.includes(f))
        console.log(`     ${r.sourceArticleId}  ${hit.join('·')}  ${r.originalTitle.slice(0, 30)}`)
      }
      console.log('     🔴 파일에는 남아 있다. raw-only 자동 적재에서만 빠진다.')
      console.log('     넣으려면: import --raw-only --sourceArticleId=<id> --apply --batch=1')
    } else {
      console.log('\n  🟢 자동 적재 보류 예정 0건')
    }
  }

  console.log('\n  🔴 DB · Sheet 에 아무것도 쓰지 않았다. 적재는 importer 가 한다.\n')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
