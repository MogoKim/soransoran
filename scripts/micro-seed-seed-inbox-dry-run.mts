#!/usr/bin/env tsx
/**
 * Seed Inbox read-only 리포트 — 🔴 **저장소가 아니다. 검수 도구다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-L · §4-M
 *
 * 🔴 **왜 만드는가**
 *    §4-L 이 `infoSeed` · `microSeedQuestion` · `participationSeed` 를
 *    **Seed Inbox 후보**로 계약했지만, **어디에 만들지는 정하지 않았다.**
 *    그릇(DB · Sheet · 파일)을 정하려면 **내용물을 먼저 봐야 한다.**
 *    이 도구는 그 내용물을 눈으로 보게 해줄 뿐, 그릇을 만들지 않는다.
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *    live 크롤 · 브라우저 · 상세 fetch · DB write · Prisma · importer ·
 *    Google Sheet read/write · LLM 호출 · 파일 생성 · scheduler 등록.
 *    `.microseed-data` 의 scout list JSONL 을 **읽기만** 한다.
 *
 * 🔴 **제목 원문을 기본으로 출력하지 않는다.** `--show-title` 을 켤 때만 나온다.
 *    🔴 본문(rawBody)은 **어떤 경우에도** 출력하지 않는다 — 이 도구는 본문을 읽지도 않는다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-seed-inbox-dry-run.mts
 *   npx tsx scripts/micro-seed-seed-inbox-dry-run.mts --top=30
 *   npx tsx scripts/micro-seed-seed-inbox-dry-run.mts --top=30 --lane-top=5
 *   npx tsx scripts/micro-seed-seed-inbox-dry-run.mts --run=20260903-204007
 *   npx tsx scripts/micro-seed-seed-inbox-dry-run.mts --show-title   🟡 로컬 검수용
 */
import { pathToFileURL } from 'node:url'
import {
  scoreRows, toArticles, topicHits, LANE_LABEL,
  type ScoredRow, type Lane,
} from './lib/micro-seed-scout-score.mjs'
import { loadScoutRows, SCOUT_DATA_DIR } from './lib/micro-seed-scout-load.mjs'

/**
 * 🔴 **Seed Inbox 대상은 이 세 레인뿐이다** (§4-L).
 *    `originalRaw` 는 Raw Vault 로 간다 — 저장 목적이 다르다.
 *    `growthIssue` 는 미구현 · 별도 승인 대상이다.
 *    `hold` · `exclude` 는 후보 집합에 들어오지도 않는다(gate-before-score).
 */
export const SEED_INBOX_LANES: readonly Lane[] = ['infoSeed', 'microSeedQuestion', 'participationSeed'] as const

/** 🔴 Seed Inbox 에 넣지 않는 레인 — 이유가 각각 다르다 */
export const NOT_SEED_INBOX: readonly Lane[] = ['originalRaw', 'growthIssue', 'hold', 'exclude'] as const

export function isSeedInboxLane(lane: Lane): boolean {
  return SEED_INBOX_LANES.includes(lane)
}

/**
 * 🔴 **Seed Inbox 는 triage 단계다 — 최종 채택이 아니다** (2026-09-04 창업자 2차 정정).
 *
 *    앞 커밋은 "Seed Inbox 세 레인이면 기본 Seed로 좋음" 으로 잡았다. **그 해석이 틀렸다.**
 *    Seed Inbox 후보는 "질문 소재 **후보**" 이지 "상세를 안 봐도 되는 최종 채택" 이 아니다.
 *
 * ```
 * 🟢 Seed로 좋음   제목만으로 바로 질문 아이디어로 쓸 수 있고, 본문·댓글을 열어볼 필요가 낮은
 *                 가벼운 소재. 단순 취향 질문 · 매우 일반적인 추천 질문.
 * 🔵 상세 읽기      제목 자체가 좋고 **본문 또는 댓글까지 자산일 가능성이 큰** 글.
 *                 Seed 인지 Raw 인지 확정하려면 본문을 봐야 하는 글.
 *                 🔴 상위권 Seed Inbox 후보는 기본적으로 이쪽이 맞다.
 * 🟡 Raw 후보      목록·제목 단계에서는 추천하지 않는다. DETAIL 이후 본문이 긴 사연 재료로
 *                 확인될 때 비로소 Raw Vault 후보가 된다.
 * ```
 *
 * 🔴 **DETAIL 은 비용 낭비가 아니다.** 좋은 소재의 본문·댓글 자산을 확인하는 단계다.
 *    아끼는 대상은 "전부 열어보기" 이지 "좋은 글을 열어보기" 가 아니다.
 *    40~60대 여성의 실제 경험 · 맥락 · 표현이 모이는 곳은 대개 **댓글**이고,
 *    그건 목록에서 보이지 않는다.
 */
export type SeedVerdict = 'seedOk' | 'needsDetail' | 'rawMaybe'

export const VERDICT_LABEL: Record<SeedVerdict, string> = {
  seedOk: 'Seed로 좋음',
  needsDetail: '상세 읽기',
  rawMaybe: 'Raw 후보',
}

/** 🔴 대표님이 버튼만 보고 뜻을 알 수 있어야 한다 */
export const VERDICT_MEANING: Record<SeedVerdict, string> = {
  seedOk: '제목만으로 충분 · 본문 열 필요 낮음',
  needsDetail: '본문·댓글이 자산일 가능성 — 확인 필요',
  rawMaybe: '긴 원문 재료 가능 · DETAIL 이후에만 판단',
}

/**
 * 🔴 민감하거나 제목이 말을 안 하면 본문을 봐야 한다.
 *    (이것은 DETAIL 사유의 **일부**일 뿐이다 — 좋은 글도 DETAIL 로 간다)
 */
export const DETAIL_FLAGS: readonly (readonly [string, string])[] = [
  ['politicalOrPublicFigure', '정치·공인 언급 가능성'],
  ['medicalOrAdLikely', '의료·광고 가능성'],
  ['quotedOrMediaLikely', '펌글·미디어 인용 가능성'],
  ['titleTruncated', '제목이 잘려 판단 불가'],
] as const

/**
 * 🔴 **댓글에 실제 경험·맥락·표현이 모이는 축.**
 *    이 축에 걸리면 본문보다 **댓글이 자산**일 가능성이 크다 — 그래서 DETAIL 이다.
 *    🟡 `살림·생활` 은 뺀다. "냉장고 추천해주세요" 류는 맥락 의존이 낮은
 *       일반 추천 질문이라 제목만으로 충분하다.
 */
export const ASSET_TOPICS: readonly string[] = ['가족', '자녀·교육', '돈·노후', '몸·건강', '관계·마음', '일'] as const

/** 🔴 화제가 붙은 글은 댓글이 이미 쌓이고 있다는 뜻이다 */
export const HOT_SCORE = 60

export type VerdictResult = { verdict: SeedVerdict; reason: string }

/**
 * 🔴 **레인만으로 판정하지 않는다.** infoSeed · microSeedQuestion · participationSeed 라고 해서
 *    자동으로 `Seed로 좋음` 이 되면, 정작 댓글이 자산인 좋은 글을 안 열게 된다.
 *    `Raw 후보` 는 이 함수가 Seed 레인에 대해 반환하지 않는다 — DETAIL 이후에만 판단한다.
 */
export function verdictOf(s: Pick<ScoredRow, 'row' | 'laneHint' | 'watch' | 'score'>): VerdictResult {
  const lane = s.laneHint.lane
  if (!isSeedInboxLane(lane)) {
    return { verdict: 'rawMaybe', reason: 'Seed Inbox 레인이 아니다 — DETAIL 이후에 판단한다' }
  }
  const r = s.row
  const flags = r.qualityFlags ?? []
  const why: string[] = []

  // ① 민감 · 판단 불가
  for (const [f, label] of DETAIL_FLAGS) if (flags.includes(f)) why.push(label)

  // ② 본문·댓글이 자산일 가능성이 큰 축
  const assets = topicHits(r.originalTitle, r.sourceBoardName).map((h) => h.label).filter((l) => ASSET_TOPICS.includes(l))
  if (assets.length > 0) why.push(`댓글이 자산일 축(${assets.join('/')})`)

  // ③ 화제 — 이미 댓글이 붙고 있다
  if (s.watch) why.push('watch — 다음 관측에서 더 붙을 글')
  if (flags.includes('highEngagement')) why.push('화제성 높음')
  if (s.score.total >= HOT_SCORE) why.push(`상위권 점수 ${s.score.total.toFixed(0)}`)

  if (why.length > 0) return { verdict: 'needsDetail', reason: why.join(' · ') }

  return { verdict: 'seedOk', reason: '맥락 의존이 낮은 일반 질문 — 제목만으로 충분하다' }
}

const ALL_LANES: readonly Lane[] = [
  'originalRaw', 'microSeedQuestion', 'infoSeed', 'participationSeed', 'growthIssue', 'hold', 'exclude',
]

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const TOP = Number(arg('top') ?? '20')
const LANE_TOP = Number(arg('lane-top') ?? '5')
const ONLY_RUN = arg('run') ?? null

/**
 * 🔴 **기본값 false.** 제목은 소스 원문이다.
 *    사람이 "이게 실제로 쓸만한 질문인가" 를 볼 때만 켠다.
 *    🔴 Seed Inbox 후보 제목만 나온다 — 제외 · 보류 글 제목은 옵션을 켜도 나오지 않는다.
 */
const SHOW_TITLE = argv.includes('--show-title')
const TITLE_MAX = 80

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n)

/** 🔴 제목은 80자에서 자른다. 코드포인트 단위로 세야 한글·이모지가 깨지지 않는다 */
function clampTitle(t: string): string {
  const cp = [...t]
  return cp.length > TITLE_MAX ? `${cp.slice(0, TITLE_MAX).join('')}…` : cp.join('')
}

function banner(): void {
  console.log('\nSeed Inbox read-only 리포트 — 🔴 저장소가 아니다')
  console.log('─────────────────────────────────────────────────────────')
  console.log('  🔴 Seed Inbox dry-run은 저장소가 아니다.')
  console.log('  🔴 DB write 0 · Sheet write 0 · LLM 0 · live 0.')
  console.log('  🔴 laneHint는 자동 라우팅이 아니다.')
  console.log('  🔴 이 결과로 DB/Sheet 저장 경로를 확정하지 않는다.')
  console.log('')
  console.log('  판단 기준 — 🔴 여기는 triage 다. 최종 채택이 아니다')
  console.log('     제목으로 1차 선별하고, 본문·댓글 자산 가능성이 큰 것은 DETAIL 로 보낸다.')
  for (const v of ['seedOk', 'needsDetail', 'rawMaybe'] as SeedVerdict[]) {
    console.log(`     ${pad(VERDICT_LABEL[v], 12)} = ${VERDICT_MEANING[v]}`)
  }
  console.log('  🔴 DETAIL 은 비용 낭비가 아니다 — 좋은 소재의 본문·댓글 자산을 확인하는 단계다.')
  console.log('     아끼는 대상은 "전부 열어보기" 이지 "좋은 글을 열어보기" 가 아니다.')
  console.log('  🔴 상위권 Seed Inbox 후보는 기본적으로 DETAIL 쪽이 맞다.')
  console.log('  🔴 Raw 후보는 목록·제목 단계에서 추천하지 않는다 — DETAIL 이후에만 판단한다.')
  console.log(
    SHOW_TITLE
      ? '  🟡 --show-title: Seed Inbox **후보** 제목만 출력한다. 제외·보류 글 제목과 본문은 출력하지 않는다.\n'
      : '  🔴 제목 원문을 출력하지 않는다 — 레인·신호 라벨만 찍는다 (--show-title 로 켠다).\n',
  )
}

function line(s: ScoredRow, i: number): void {
  const r = s.row
  const o = s.obs
  console.log(
    `   ${pad(i, 3)} ${pad(s.score.total.toFixed(1), 6)} ${pad(LANE_LABEL[s.laneHint.lane], 9)} ` +
      `${pad(s.watch ? 'watch' : '-', 6)} ${pad(`${o.seenCount}회`, 5)} ` +
      `${pad(`+${o.commentDelta}/${o.viewDelta === null ? '-' : `+${o.viewDelta}`}`, 10)} ` +
      `${pad(r.sourceSite.slice(0, 22), 24)} ${pad(r.sourceArticleId, 10)}`,
  )
  console.log(
    `       board ${r.sourceBoardKey ?? '-'} · ${(r.sourceBoardName ?? '-').slice(0, 16)} · ` +
      `p${r.sourcePage ?? '-'}/r${r.sourceRankOnPage ?? '-'} · ` +
      `댓글 ${r.sourceCommentCountRead ? r.sourceCommentCount : '읽지 못함'} · 조회 ${r.sourceViewCount ?? '-'} · ` +
      `lag ${s.lagMinutes === null ? '-' : `${s.lagMinutes.toFixed(0)}분`}`,
  )
  const v = verdictOf(s)
  console.log(`       추천   ${VERDICT_LABEL[v.verdict]} — ${v.reason}`)
  console.log(`       why    ${s.why}`)
  console.log(`       signal ${s.laneHint.signals.length ? s.laneHint.signals.join(' · ') : '-'} → ${s.laneHint.reason}`)
  // 🔴 seed 배열은 Seed Inbox 후보에서만 나온다 — 제외·보류 제목은 구조적으로 도달할 수 없다
  if (SHOW_TITLE) console.log(`       제목   ${clampTitle(r.originalTitle)}`)
}

function main(): void {
  banner()

  const { loaded, legacyRows, legacyFiles } = (() => {
    try {
      return loadScoutRows(SCOUT_DATA_DIR, ONLY_RUN)
    } catch {
      return fail(`${SCOUT_DATA_DIR} 를 읽지 못했다 — scout 산출물이 없다`)
    }
  })()
  if (loaded.length === 0) fail(ONLY_RUN ? `run ${ONLY_RUN} 을 가진 행이 없다` : '분석할 행이 없다')

  const rows = loaded.flatMap((l) => l.rows)
  const articles = toArticles(rows)

  // ── ① 입력 ──
  console.log('① 입력 — 🔴 기존 JSONL read-only')
  console.log(`   파일 ${loaded.length}개 · 관측 행 ${rows.length}건 → 🔴 고유 글 ${articles.length}건`)
  console.log('   🔴 판단 단위는 row 가 아니라 게시글 1개다 — row 를 세면 같은 글이 중복으로 올라온다')
  for (const l of loaded) console.log(`      ${l.file} · ${l.rows.length}행`)
  console.log(`   ⏭️  legacy 제외: ${legacyRows}행 · 파일 ${legacyFiles.length}개${legacyFiles.length ? ` (${legacyFiles.join(' · ')})` : ''}`)
  console.log('      🔴 sourceRunId 가 없다 — 제외 판정도 메타도 없어 섞으면 분포가 거짓이 된다')

  const { scored, excluded, held } = scoreRows(rows)

  // ── ② 전체 lane 분포 (Seed Inbox 밖도 센다) ──
  console.log('\n② 전체 lane 분포 — 🔴 Seed Inbox 밖도 보여준다')
  const laneAll = new Map<Lane, number>()
  for (const s of [...scored, ...excluded, ...held]) laneAll.set(s.laneHint.lane, (laneAll.get(s.laneHint.lane) ?? 0) + 1)
  console.log(`   ${pad('lane', 22)} ${pad('전체', 6)} 취급`)
  for (const l of ALL_LANES) {
    const note = isSeedInboxLane(l)
      ? '🟡 Seed Inbox 후보'
      : l === 'originalRaw' ? '🟢 Raw Vault (저장 목적이 다르다)'
      : l === 'growthIssue' ? '🔴 미구현 · 별도 승인'
      : l === 'hold' ? '🔴 보류 — 후보 집합 밖'
      : '🔴 제외 — 후보 집합 밖'
    console.log(`   ${pad(`${LANE_LABEL[l]} (${l})`, 22)} ${pad(laneAll.get(l) ?? 0, 6)} ${note}`)
  }

  // ── ③ Seed Inbox 후보만 ──
  // 🔴 scored 는 gate 를 통과한 후보뿐이다. hold · exclude 는 애초에 여기 없다.
  const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
  const seedWatch = seed.filter((s) => s.watch)
  const seedRepeat = seed.filter((s) => s.obs.seenCount > 1)
  const seedGrew = seedRepeat.filter((s) => s.obs.commentDelta > 0)

  console.log(`\n③ Seed Inbox 후보 ${seed.length}건 — 🔴 저장하지 않는다. 보기만 한다`)
  console.log(`   대상 레인   ${SEED_INBOX_LANES.map((l) => `${LANE_LABEL[l]}(${l})`).join(' · ')}`)
  console.log(`   제외 레인   ${NOT_SEED_INBOX.map((l) => `${LANE_LABEL[l]}(${l})`).join(' · ')}`)
  for (const l of SEED_INBOX_LANES) {
    console.log(`      ${pad(LANE_LABEL[l], 9)} ${seed.filter((s) => s.laneHint.lane === l).length}건`)
  }
  console.log(`   watch ${seedWatch.length}건 · 반복 관측 ${seedRepeat.length}건 · 그중 댓글 증가 ${seedGrew.length}건`)

  // 🔴 추천 분포 — "상세 읽기" 가 대부분이면 기준이 잘못된 것이다 (2026-09-04 정정)
  const verdicts = seed.map((x) => verdictOf(x))
  const vCount = (v: SeedVerdict): number => verdicts.filter((x) => x.verdict === v).length
  console.log('\n   추천 분포 — 🟢 창업자 승인 v1 기준 (§4-O) · 🔴 상위권은 DETAIL 이 정상이다')
  for (const v of ['seedOk', 'needsDetail', 'rawMaybe'] as SeedVerdict[]) {
    const n = vCount(v)
    const note = v === 'rawMaybe' ? '  🔴 이 화면에서는 자동 추천하지 않는다 (보조·예외)' : ''
    console.log(`      ${pad(VERDICT_LABEL[v], 12)} ${pad(n, 4)}건  ${VERDICT_MEANING[v]}${note}`)
  }
  if (vCount('seedOk') === 0) {
    console.log('      🔴 Seed로 좋음이 0건이다 — 전부 DETAIL 이면 triage 가 아니라 그냥 전수 열기다')
  }

  if (seed.length === 0) {
    console.log('\n   🟡 Seed Inbox 후보가 0건이다 — 표본이 없거나 게이트가 전부 걸렀다.\n')
    return
  }

  // ── ④ 점수순 top N ──
  const top = seed.slice(0, TOP)
  console.log(`\n④ 점수순 상위 ${top.length}건`)
  console.log(
    `   ${pad('#', 3)} ${pad('총점', 6)} ${pad('레인', 9)} ${pad('watch', 6)} ${pad('관측', 5)} ${pad('댓/조Δ', 10)} ${pad('sourceSite', 24)} articleId`,
  )
  top.forEach((s, i) => line(s, i + 1))

  // ── ⑤ 레인별 top N ──
  console.log(`\n⑤ 레인별 상위 ${LANE_TOP}건 — 🔴 레인끼리 우열을 매기지 않는다`)
  for (const l of SEED_INBOX_LANES) {
    const list = seed.filter((s) => s.laneHint.lane === l).slice(0, LANE_TOP)
    console.log(`\n   ── ${LANE_LABEL[l]} (${l}) · ${list.length}건 ──`)
    if (list.length === 0) { console.log('      (없음)'); continue }
    list.forEach((s, i) => line(s, i + 1))
  }

  // ── ⑥ 이 리포트가 정하지 않은 것 ──
  console.log('\n⑥ 이 리포트가 정하지 않은 것')
  console.log('   🔴 Seed Inbox 를 DB 에 둘지 Sheet 에 둘지 파일에 둘지 — 정하지 않았다')
  console.log('   🔴 Seed Inbox 스키마 · Raw Vault 승격 임계값 · 자동 상세 fetch 기준 · threshold 운영값')
  console.log('   🔴 네이버 → Google Sheet 자동 전송은 미구현이며 별도 승인 전까지 금지다')
  console.log('   🔴 이 결과로 DB/Sheet 저장 경로를 확정하지 않는다 — 눈으로 보는 단계다')
  console.log('   🟢 후보 선별에 LLM 을 쓰지 않았다 — laneHint·점수화는 cheap signal 이다')
  console.log('   🔴 자동 상세 fetch 기준을 확정하지 않았다 — "상세 읽기" 는 사람이 누르는 추천일 뿐이다')
  console.log('   🔴 Raw Vault 확정은 DETAIL 이후에만 가능하다 — 이 화면은 Raw 를 정하지 않는다')
  console.log('   🟢 v1 승인은 **추천 기준**에 대한 승인이지 자동화에 대한 승인이 아니다 — 버튼은 사람이 누른다\n')
}

/**
 * 🔴 **CLI 로 직접 실행할 때만 돈다.**
 *
 *    앞 커밋까지는 파일 끝에서 `main()` 을 그냥 불렀다. 그래서 다른 파일이
 *    `verdictOf` 하나만 가져다 쓰려고 import 해도 **리포트가 통째로 실행되고
 *    JSONL 을 읽었다.** read-only 라 안전 위반은 아니지만 모듈로 재사용할 수 없다.
 *
 *    🔴 더 나쁜 것: 데이터가 없으면 `fail()` 이 `process.exit(1)` 을 부른다 —
 *    **import 한 쪽 프로세스가 죽는다.** 화면에서 판정만 쓰려던 코드가 종료된다.
 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
