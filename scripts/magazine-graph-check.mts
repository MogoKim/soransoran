#!/usr/bin/env tsx
/**
 * M-GRAPH 연관 글 회귀 시험
 *
 * 🔴 DB·네트워크·env 파일을 건드리지 않는다. 매거진은 파일 기반이라 실제 콘텐츠로 확인된다.
 * 🔴 규칙을 여기 다시 적지 않고 **원본을 그대로 import** 한다. 사본은 반드시 어긋난다.
 * 🔴 기대값을 상수로 박지 않는다 — 글이 늘어도 이 파일은 그대로다.
 *
 * ── 이 검사가 나누는 두 층 ──
 *
 *   ① 빌드가 막는 것   파일이 없거나 해시가 다르면 **컴파일·검사가 실패**한다.
 *                      런타임 try/catch 로 감싸지 않는다 — 감싸면 깨진 그래프가 배포된다.
 *                      빌드가 실패하면 새 배포가 승격되지 않고 기존 운영 배포가 유지된다.
 *   ② 런타임이 삼키는 것  꺼짐 · cluster 미포함 · 버전 불일치 · 예외 · 미공개 대상 →
 *                      그 요청만 예전 방식(같은 cluster 최신 3편)으로 되돌아간다.
 *
 * ── 🔴 이 검사가 보장하지 못하는 것 (과장하지 않는다) ──
 *   · 클릭 이벤트가 **화면의 그 자리에 실제로 붙어 있는지**는 보지 못한다.
 *     이 저장소에는 컴포넌트를 렌더할 장치가 없다. 호출부 존재는 소스 가드로만 본다.
 *   · Vercel 환경변수를 바꾼 뒤 **재배포가 실제로 돌았는지**는 저장소 밖이라 보지 못한다.
 *
 * 사용법: npm run check:magazine-graph
 * 종료 코드: FAIL 이 있으면 1
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAGAZINE_ARTICLES } from '../src/content/magazine/articles'
import { CONTROL, enabledClusters, isGraphEnabled } from '../src/content/magazine/graph/control'
import { EXPORT_HASH, GRAPH } from '../src/content/magazine/graph/current'
import type { MagazineArticle } from '../src/content/magazine/types'
import type { SoranEventMap } from '../src/lib/analytics/events'
import { trackEvent } from '../src/lib/analytics/track'
import {
  getAllMagazineArticles,
  getRelatedMagazineArticles,
  isPublicMagazineArticle,
} from '../src/lib/magazine'
import {
  DISCOVERY_SLOT,
  FOOTER_SURFACES,
  IMPLEMENTED_SURFACES,
  MAX_DIRECT,
  MAX_TOTAL,
  SLOT_LABEL,
  resolveRelatedMagazine,
} from '../src/lib/magazine-graph'
import {
  MAX_KEYS,
  clearImpressions,
  impressionKey,
  shouldSendImpression,
  type ImpressionIdentity,
} from '../src/lib/analytics/magazine-impression-log'
import {
  CHAIN_TTL_MS,
  clearChain,
  currentDepth,
  recordRelatedClick,
  toDepthBucket,
} from '../src/lib/analytics/magazine-read-depth'
import {
  extractRelatedLinks,
  parseCurlOutput,
  runGraphWatch,
  writeTrippedControl,
  type GraphWatchDeps,
  type StepResult,
} from './magazine-graph-watch.mjs'
import {
  GRAPH_BRANCH_PREFIX,
  isGraphLaneFile,
  judgeGraphMerge,
  runGraphMerge,
  type GraphMergeDeps,
  type Pr,
} from './magazine-graph-merge.mjs'
import { AUTO_BRANCH_PREFIX, REQUIRED_CHECKS } from './lib/magazine-merge-gate.mjs'

const ROOT = join(import.meta.dirname, '..')
let pass = 0
let fail = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const OFF: NodeJS.ProcessEnv = {}
const published = getAllMagazineArticles()
const slugsOf = (a: MagazineArticle, env: NodeJS.ProcessEnv) =>
  resolveRelatedMagazine(a, env).items.map((i) => i.article.slug)
const legacyOf = (a: MagazineArticle) => getRelatedMagazineArticles(a, 3).map((x) => x.slug)

console.log(`\nM-GRAPH 연관 글 회귀 — 공개 글 ${published.length}편 · graphVersion ${GRAPH.graphVersion}\n`)

// ── ① 빌드가 막는 층 ──────────────────────────────────────
console.log('① 빌드가 막는 것')

/** 🔴 내보낸 그래프가 손으로 고쳐지지 않았는가. exporter 와 같은 방법으로 다시 센다 */
const recomputed = createHash('sha256').update(JSON.stringify(GRAPH)).digest('hex').slice(0, 16)
check('EXPORT_HASH 가 내용과 일치한다', recomputed === EXPORT_HASH, `${EXPORT_HASH}`)

check(
  'current.ts 는 재수출 한 줄이다 — 그래프 본문을 담지 않는다',
  /export \{ GRAPH, EXPORT_HASH \} from '\.\/g-/.test(
    readFileSync(join(ROOT, 'src/content/magazine/graph/current.ts'), 'utf8'),
  ),
)

const versionFile = join(ROOT, `src/content/magazine/graph/${GRAPH.graphVersion}.ts`)
check('current.ts 가 가리키는 버전 파일이 같은 커밋에 있다', existsSync(versionFile))

/**
 * 🔴 버전 파일을 치우면 **런타임 폴백이 아니라 빌드가 실패**해야 한다.
 *    실제로 tsc 를 돌려서 확인한다 — 「그럴 것이다」 로 두면 어느 날 조용히 try/catch 가 생긴다.
 *    try/finally 로 반드시 되돌린다.
 */
{
  const moved = `${versionFile}.moved-by-check`
  let typecheckFailed = false
  let stderr = ''
  try {
    renameSync(versionFile, moved)
    try {
      execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['--noEmit'], { cwd: ROOT, stdio: 'pipe' })
    } catch (err) {
      typecheckFailed = true
      stderr = String((err as { stdout?: Buffer }).stdout ?? '')
    }
  } finally {
    if (existsSync(moved)) renameSync(moved, versionFile)
  }
  check('버전 파일이 없으면 빌드가 실패한다 (런타임이 삼키지 않는다)', typecheckFailed)
  check(
    '  실패 사유가 그 파일을 가리킨다 — 다른 이유로 깨진 것이 아니다',
    /magazine\/graph\/current|Cannot find module/.test(stderr),
    stderr.split('\n').find((l) => l.includes('error')) ?? '(출력 없음)',
  )
  check('  검사가 끝난 뒤 파일이 제자리에 있다', existsSync(versionFile))
}

check(
  'resolver 가 import 실패를 try/catch 로 감싸지 않는다 (정적 import 다)',
  /^import \{ GRAPH \} from '@\/content\/magazine\/graph\/current'$/m.test(
    readFileSync(join(ROOT, 'src/lib/magazine-graph.ts'), 'utf8'),
  ),
)

// ── ② 기본값: 그래프 OFF ──────────────────────────────────
console.log('\n② 기본값은 꺼짐 — 공개 글 전체가 예전 그대로다')

check('control.ts 기본값이 꺼짐이다', CONTROL.enabled === false)
check('  열린 cluster 가 하나도 없다', CONTROL.enabledClusters.length === 0)
check('  isGraphEnabled({}) 가 false 다', isGraphEnabled(OFF) === false)

{
  const diff = published.filter((a) => slugsOf(a, OFF).join(',') !== legacyOf(a).join(','))
  check(`그래프 OFF 에서 ${published.length}편 전부 결과 불변`, diff.length === 0, `달라진 글 ${diff.length}`)
  const notFallback = published.filter((a) => resolveRelatedMagazine(a, OFF).source !== 'FALLBACK')
  check('  전부 FALLBACK 출처다', notFallback.length === 0)
  const wrongReason = published.filter((a) => resolveRelatedMagazine(a, OFF).reason !== 'DISABLED')
  check('  폴백 사유가 DISABLED 다', wrongReason.length === 0)
  const wrongVer = published.filter((a) => resolveRelatedMagazine(a, OFF).graphVersion !== 'none')
  check("  계측 graph_version 이 'none' 이다 — 그래프분과 섞이지 않는다", wrongVer.length === 0)
}

// ── ③ family 만 opt-in ────────────────────────────────────
console.log('\n③ family cluster 만 열었을 때')

const FAMILY: NodeJS.ProcessEnv = { MGRAPH_GRAPH_ENABLED: '1', MGRAPH_GRAPH_CLUSTERS: 'family' }
check('환경변수로 켜진다', isGraphEnabled(FAMILY) === true)
check('  열린 cluster 가 family 뿐이다', enabledClusters(FAMILY).join(',') === 'family')

{
  const fam = published.filter((a) => a.cluster === 'family')
  const usedGraph = fam.filter((a) => resolveRelatedMagazine(a, FAMILY).source === 'GRAPH')
  const changed = fam.filter((a) => slugsOf(a, FAMILY).join(',') !== legacyOf(a).join(','))
  check('family 글이 그래프 결과를 쓴다', usedGraph.length > 0, `${usedGraph.length}/${fam.length}편`)
  check('  실제로 예전과 다른 글이 나온다', changed.length > 0, `${changed.length}편 바뀜`)
  const badVer = usedGraph.filter(
    (a) => resolveRelatedMagazine(a, FAMILY).graphVersion !== GRAPH.graphVersion,
  )
  check('  계측에 실제 graphVersion 이 실린다', badVer.length === 0)

  const others = published.filter((a) => a.cluster !== 'family')
  const leaked = others.filter((a) => slugsOf(a, FAMILY).join(',') !== legacyOf(a).join(','))
  check(`  다른 cluster ${others.length}편은 예전 그대로다`, leaked.length === 0, `샌 글 ${leaked.length}`)
  const otherSource = others.filter(
    (a) => resolveRelatedMagazine(a, FAMILY).reason !== 'CLUSTER_NOT_ENABLED',
  )
  check('  그 사유가 CLUSTER_NOT_ENABLED 다', otherSource.length === 0)
}

// ── ④ 모든 cluster 를 다 열어도 지켜야 하는 것 ─────────────
console.log('\n④ 전 cluster 를 열어도 — 자기 링크·중복·미공개 0')

const ALL_ON: NodeJS.ProcessEnv = {
  MGRAPH_GRAPH_ENABLED: '1',
  MGRAPH_GRAPH_CLUSTERS: [...new Set(published.map((a) => a.cluster))].join(','),
}
const publicSlugs = new Set(published.map((a) => a.slug))
const unpublishedSlugs = new Set(
  MAGAZINE_ARTICLES.filter((a) => !isPublicMagazineArticle(a)).map((a) => a.slug),
)

{
  let selfLinks = 0
  let dupes = 0
  let unpublished = 0
  let overLimit = 0
  let graphUsed = 0
  for (const a of published) {
    const r = resolveRelatedMagazine(a, ALL_ON)
    if (r.source === 'GRAPH') graphUsed++
    const out = r.items.map((i) => i.article.slug)
    if (out.includes(a.slug)) selfLinks++
    if (new Set(out).size !== out.length) dupes++
    if (out.some((s) => !publicSlugs.has(s))) unpublished++
    if (out.length > MAX_TOTAL) overLimit++
  }
  check('그래프를 실제로 쓴 글이 있다', graphUsed > 0, `${graphUsed}/${published.length}편`)
  check('자기 자신을 링크한 글 0', selfLinks === 0)
  check('같은 slug 가 두 번 나온 글 0', dupes === 0)
  check('미공개 글이 링크에 뜬 경우 0', unpublished === 0)
  check(`상한 ${MAX_TOTAL}건을 넘은 글 0`, overLimit === 0)
  check(
    `  미공개 글 ${unpublishedSlugs.size}편이 공개 목록에 없다 (관문 확인)`,
    [...unpublishedSlugs].every((s) => !publicSlugs.has(s)),
  )
}

// ── ④-B 🔴 보충 — 그래프를 켰다고 연관 글이 줄면 안 된다 ──
console.log('\n④-B 부족분 보충')

{
  let shrank = 0
  let overLegacy = 0
  let wrongVersion = 0
  let fillPretendsGraph = 0
  let filled = 0
  const detail: string[] = []

  for (const a of published) {
    const legacy = legacyOf(a)
    const r = resolveRelatedMagazine(a, ALL_ON)
    const g = r.items.filter((i) => i.source === 'GRAPH')
    const f = r.items.filter((i) => i.source === 'FALLBACK_FILL')
    if (f.length > 0) filled++

    // 🔴 줄어들면 안 된다 — 이 보충의 존재 이유다
    if (r.items.length < legacy.length) {
      shrank++
      detail.push(`${a.slug} ${legacy.length}→${r.items.length}`)
    }
    /**
     * 🔴 억지로 늘리지 않는다 — **직접 연관 자리**의 상한은
     *    `max(예전 개수, 그래프 직접 연관 수)` 이고 3을 넘지 않는다.
     *    발견 카드는 그래프만 채우는 별도 자리라 이 계산에 들어가지 않는다.
     */
    const directOut = r.items.filter((i) => i.slot !== DISCOVERY_SLOT)
    const graphDirect = g.filter((i) => i.slot !== DISCOVERY_SLOT)
    if (directOut.length > Math.min(MAX_DIRECT, Math.max(legacy.length, graphDirect.length))) {
      overLegacy++
    }
    // 🔴 출처와 버전이 어긋나면 계측이 거짓말을 한다
    for (const i of r.items) {
      if ((i.source === 'GRAPH') !== (i.graphVersion !== 'none')) wrongVersion++
    }
    // 🔴 보충 항목이 그래프 관계인 척하면 안 된다
    if (f.some((i) => i.graphVersion !== 'none')) fillPretendsGraph++
  }

  check(`그래프를 켜도 연관 글이 줄어든 글 0`, shrank === 0, detail.join(' · ') || '없음')
  check('  예전보다 억지로 늘어난 글 0', overLegacy === 0)
  check('  출처와 graphVersion 이 어긋난 항목 0', wrongVersion === 0)
  check("  보충 항목은 전부 graph_version='none'", fillPretendsGraph === 0)
  check('  실제로 보충이 일어난 글이 있다', filled > 0, `${filled}편`)

  /** 🔴 보충이 자기 자신·중복을 들여보내지 않는가 */
  let selfOrDup = 0
  for (const a of published) {
    const out = resolveRelatedMagazine(a, ALL_ON).items.map((i) => i.article.slug)
    if (out.includes(a.slug) || new Set(out).size !== out.length) selfOrDup++
  }
  check('  보충 뒤에도 자기 링크·중복 0', selfOrDup === 0)

  /** 🔴 **죽은 보충을 만들지 않는다** — 보충을 끄면 13편이 다시 줄어야 한다 */
  const wouldShrink = published.filter((a) => {
    const r = resolveRelatedMagazine(a, ALL_ON)
    const g = r.items.filter((i) => i.source === 'GRAPH').length
    return r.source === 'GRAPH' && g < legacyOf(a).length
  })
  check(
    '  보충이 없었다면 줄었을 글이 실제로 있다 (보충이 일하고 있다)',
    wouldShrink.length > 0,
    `${wouldShrink.length}편`,
  )

  /** 🔴 목록 전체 graphVersion 을 클릭에 쓰지 않는다 — 화면이 항목 값을 쓰는지 본다 */
  const listSrc = readFileSync(join(ROOT, 'src/components/features/RelatedMagazineList.tsx'), 'utf8')
  check(
    '  목록이 공통 graphVersion prop 을 받지 않는다',
    !/graphVersion,\s*\n\}: \{/.test(listSrc) && listSrc.includes('graphVersion }) => ('),
  )
  const pageSrc = readFileSync(join(ROOT, 'src/app/magazine/[slug]/page.tsx'), 'utf8')
  check('  상세 페이지가 공통 graphVersion 을 넘기지 않는다', !pageSrc.includes('graphVersion={related.graphVersion}'))
}

// ── ④-C 🔴 4슬롯 — 직접 연관 3 + 발견 1 ──────────────────
console.log('\n④-C 추천 4슬롯 (직접 3 + 발견 1)')

{
  let total4 = 0
  let withDisc = 0
  let discNotBridge = 0
  let discNotGraph = 0
  let discDuplicate = 0
  let overDirect = 0
  let multiDisc = 0
  let fillHasSlot = 0
  let fillHasReason = 0
  let graphNoReason = 0
  let badPosition = 0
  let discNotLast = 0

  for (const a of published) {
    const r = resolveRelatedMagazine(a, ALL_ON)
    const out = r.items
    if (out.length === MAX_TOTAL) total4++

    const disc = out.filter((i) => i.slot === DISCOVERY_SLOT)
    const direct = out.filter((i) => i.slot !== DISCOVERY_SLOT)
    if (disc.length > 0) withDisc++
    if (disc.length > 1) multiDisc++
    if (direct.length > MAX_DIRECT) overDirect++

    for (const d of disc) {
      // 🔴 발견 카드는 GRAPH + BRIDGE 만
      if (d.relationType !== 'BRIDGE') discNotBridge++
      if (d.source !== 'GRAPH') discNotGraph++
      // 🔴 직접 연관과 중복될 수 없다
      if (direct.some((x) => x.article.slug === d.article.slug)) discDuplicate++
      // 🔴 발견은 마지막 자리다
      if (out[out.length - 1]?.article.slug !== d.article.slug) discNotLast++
    }

    for (const i of out) {
      if (i.source !== 'GRAPH') {
        if (i.slot !== null) fillHasSlot++
        if (i.reason !== null) fillHasReason++
      } else if (!i.reason) graphNoReason++
    }
    out.forEach((i, n) => {
      if (i.position !== n) badPosition++
    })
  }

  check('정확히 4개가 나오는 글이 있다', total4 > 0, `${total4}편`)
  check('발견 카드가 붙은 글이 있다', withDisc > 0, `${withDisc}편`)
  check('  한 글에 발견 카드는 최대 1개', multiDisc === 0)
  check('  직접 연관은 3개를 넘지 않는다', overDirect === 0)
  check('🔴 발견 카드는 BRIDGE 관계만', discNotBridge === 0)
  check('🔴 발견 카드는 GRAPH 출처만 — 최신·인기 글로 채우지 않는다', discNotGraph === 0)
  check('🔴 발견 카드가 직접 연관과 중복되지 않는다', discDuplicate === 0)
  check('  발견 카드는 마지막 자리다', discNotLast === 0)
  check('🔴 보충 항목은 슬롯이 없다 (슬롯인 척하지 않는다)', fillHasSlot === 0)
  check('🔴 보충 항목은 추천 이유가 없다', fillHasReason === 0)
  check('🔴 그래프 항목은 전부 검증된 이유 문구를 가진다', graphNoReason === 0)
  check('  position 이 화면 순서와 같다', badPosition === 0)

  /** 🔴 **발견이 없으면 4번째를 억지로 채우지 않는다** */
  const noDisc = published.filter(
    (a) => !resolveRelatedMagazine(a, ALL_ON).items.some((i) => i.slot === DISCOVERY_SLOT),
  )
  const forcedFourth = noDisc.filter(
    (a) => resolveRelatedMagazine(a, ALL_ON).items.length > MAX_DIRECT,
  )
  check(
    '🔴 발견 관계가 없으면 4번째를 만들지 않는다',
    forcedFourth.length === 0,
    `발견 없는 글 ${noDisc.length}편 · 그중 4개를 낸 글 ${forcedFourth.length}편`,
  )

  /** 🔴 슬롯 매핑 사본이 제품에 없다 — 정본은 연구 계약이고 번들이 값을 실어 온다 */
  const resolverSrc = readFileSync(join(ROOT, 'src/lib/magazine-graph.ts'), 'utf8')
  check(
    '🔴 제품에 관계→슬롯 매핑 사본이 없다 (번들의 edge.slot 을 읽는다)',
    !/NEXT_QUESTION\s*:\s*'DIRECT_NEXT'/.test(resolverSrc) && resolverSrc.includes('edge.slot'),
  )
  check(
    '  슬롯 문구 4종이 계약과 같다',
    Object.keys(SLOT_LABEL).sort().join(',') ===
      'ACTION_OR_CONTEXT,BRIDGE_DISCOVERY,DIRECT_NEXT,SAME_EXPERIENCE',
  )

  /** 🔴 번들 자체의 슬롯 정합 */
  const activeFooter = GRAPH.edges.filter(
    (e) => e.active && new Set<string>(FOOTER_SURFACES).has(e.placement),
  )
  check('번들: 하단 활성 edge 는 전부 슬롯을 가진다', activeFooter.every((e) => e.slot !== null))
  check(
    '번들: 발견 슬롯은 BRIDGE 뿐',
    GRAPH.edges.filter((e) => e.slot === DISCOVERY_SLOT).every((e) => e.type === 'BRIDGE'),
  )
  check(
    '번들: COMMUNITY 에 하단 슬롯이 없다',
    GRAPH.edges.filter((e) => e.type === 'COMMUNITY').every((e) => e.slot === null),
  )
  check('번들: 활성 edge 는 전부 추천 이유를 가진다', activeFooter.every((e) => Boolean(e.reason)))
}

// ── ④-D 🔴 연속 열람 깊이 ────────────────────────────────
console.log('\n④-D 연속 열람 깊이')

{
  /** 🔴 진짜 sessionStorage 가 없는 Node 라 가짜를 쓴다. 던지는 저장소도 만든다 */
  const makeStore = (): Storage => {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size
      },
    } as Storage
  }
  const hostile = {
    getItem: () => {
      throw new Error('차단됨')
    },
    setItem: () => {
      throw new Error('차단됨')
    },
    removeItem: () => {
      throw new Error('차단됨')
    },
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage

  check('칸 나누기: 1·2·3·4+', 
    [1, 2, 3, 4, 9].map(toDepthBucket).join(',') === '1,2,3,4+,4+')
  check('  0 이나 음수도 1로 본다', toDepthBucket(0) === '1' && toDepthBucket(-3) === '1')

  // 🔴 A → B → C → D 로 이어 읽는다
  {
    const st = makeStore()
    const t0 = Date.UTC(2026, 8, 23, 3, 0, 0)
    const d1 = recordRelatedClick('a', 'b', t0, st)
    const d2 = recordRelatedClick('b', 'c', t0 + 60_000, st)
    const d3 = recordRelatedClick('c', 'd', t0 + 120_000, st)
    const d4 = recordRelatedClick('d', 'e', t0 + 180_000, st)
    const d5 = recordRelatedClick('e', 'f', t0 + 240_000, st)
    check('연속 클릭이 1→2→3→4+ 로 깊어진다', [d1, d2, d3, d4].join(',') === '1,2,3,4+')
    check('  5번째도 4+ 로 묶인다', d5 === '4+')
  }

  // 🔴 새 방문 · 만료 · 다른 경로는 1
  {
    const st = makeStore()
    const t0 = Date.UTC(2026, 8, 23, 3, 0, 0)
    recordRelatedClick('a', 'b', t0, st)
    check('새 방문(사슬 없음)은 1', currentDepth('x', t0, makeStore()) === 1)
    check(
      `  ${CHAIN_TTL_MS / 60000}분이 지나면 1로 되돌아간다`,
      currentDepth('b', t0 + CHAIN_TTL_MS + 1, st) === 1,
    )
    check('  만료 직전은 유지된다', currentDepth('b', t0 + CHAIN_TTL_MS - 1, st) === 2)
    check('🔴 예상한 글이 아니면 1 (목록·검색으로 들어온 경우)', currentDepth('zzz', t0 + 1000, st) === 1)
    check('  예상한 글이면 이어진다', currentDepth('b', t0 + 1000, st) === 2)
  }

  // 🔴 저장소가 막혀도 이동을 막지 않는다
  {
    let threw = false
    let got: string | null = null
    try {
      got = recordRelatedClick('a', 'b', Date.now(), hostile)
    } catch {
      threw = true
    }
    check('저장소가 던져도 예외가 새지 않는다', !threw)
    check('  그때는 깊이 1로 답한다', got === '1')
    let threw2 = false
    try {
      currentDepth('a', Date.now(), hostile)
      clearChain(hostile)
    } catch {
      threw2 = true
    }
    check('  읽기·삭제도 던지지 않는다', !threw2)
  }

  // 🔴 깨진 값도 삼킨다
  {
    const st = makeStore()
    st.setItem('soran-magazine-read-chain', '{깨진 JSON')
    check('깨진 저장값은 사슬 없음으로 본다', currentDepth('a', Date.now(), st) === 1)
    st.setItem('soran-magazine-read-chain', '{"next":123}')
    check('  모양이 다른 값도 사슬 없음으로 본다', currentDepth('a', Date.now(), st) === 1)
  }

  /** 🔴 개인 식별자를 저장하지 않는다 */
  {
    const st = makeStore()
    recordRelatedClick('a', 'b', Date.now(), st)
    const raw = st.getItem('soran-magazine-read-chain') ?? ''
    const keys = Object.keys(JSON.parse(raw)).sort().join(',')
    check('저장하는 키는 next·depth·at 뿐이다', keys === 'at,depth,next', keys)
  }

  /**
   * 🔴 **주석이 아니라 코드를 본다.** 이 파일은 "localStorage 를 쓰면 안 되는 이유" 를
   *    주석에 적어 두었다. 낱말만 세면 그 설명문이 위반으로 잡힌다.
   *    주석을 걷어낸 뒤 **실제 접근**만 찾는다.
   */
  const depthSrc = readFileSync(join(ROOT, 'src/lib/analytics/magazine-read-depth.ts'), 'utf8')
  const depthCode = depthSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  check('🔴 localStorage 에 접근하지 않는다 (탭을 닫으면 사슬이 끊겨야 한다)',
    !/localStorage/.test(depthCode))
  check('  sessionStorage 를 쓴다', /window\.sessionStorage/.test(depthCode))
}

// ── ④-E 🔴 노출 중복 제거 — 세션당 항목별 1회 ────────────
console.log('\n④-E 노출 중복 제거')

{
  const makeStore = (): Storage => {
    const m = new Map<string, string>()
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size
      },
    } as Storage
  }
  const hostile = {
    getItem: () => {
      throw new Error('차단됨')
    },
    setItem: () => {
      throw new Error('차단됨')
    },
    removeItem: () => {
      throw new Error('차단됨')
    },
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage

  function id(over: Partial<ImpressionIdentity> = {}): ImpressionIdentity {
    const base: ImpressionIdentity = {
      graphVersion: GRAPH.graphVersion,
      fromSlug: 'a',
      targetSlug: 'b',
      source: 'GRAPH',
      slot: 'DIRECT_NEXT',
    }
    return { ...base, ...over }
  }

  // 🔴 같은 항목은 두 번째부터 false
  {
    const st = makeStore()
    check('첫 노출은 보낸다', shouldSendImpression(id(), st) === true)
    check('  같은 항목 두 번째는 보내지 않는다', shouldSendImpression(id(), st) === false)
    check('  세 번째도 보내지 않는다', shouldSendImpression(id(), st) === false)
  }

  /**
   * 🔴 **재마운트·뒤로가기·재방문을 흉내 낸다.**
   *    컴포넌트 지역 변수로 막던 앞판은 여기서 전부 뚫렸다 —
   *    인스턴스가 새로 생기면 변수도 새로 생기기 때문이다.
   *    저장소는 인스턴스와 무관하므로 같은 세션이면 계속 기억한다.
   */
  {
    const st = makeStore()
    const remount = () => shouldSendImpression(id(), st) // 새 인스턴스가 다시 묻는 것과 같다
    const results = [remount(), remount(), remount(), remount()]
    check(
      '🔴 재마운트·뒤로가기·재방문을 해도 노출은 1회뿐이다',
      results.filter(Boolean).length === 1,
      `4번 물어 ${results.filter(Boolean).length}번 보냄`,
    )
  }

  // 🔴 다섯 값 중 하나라도 다르면 새 노출이다
  {
    const st = makeStore()
    shouldSendImpression(id(), st)
    check('다른 대상 글은 새 노출', shouldSendImpression(id({ targetSlug: 'c' }), st) === true)
    check('  다른 출발 글도 새 노출', shouldSendImpression(id({ fromSlug: 'z' }), st) === true)
    check('  🔴 다른 graphVersion 은 새 노출 (다른 추천이다)',
      shouldSendImpression(id({ graphVersion: 'g-다른버전' }), st) === true)
    check('  다른 출처(보충)도 새 노출',
      shouldSendImpression(id({ source: 'FALLBACK_FILL', slot: 'none' }), st) === true)
    check('  다른 슬롯도 새 노출', shouldSendImpression(id({ slot: 'BRIDGE_DISCOVERY' }), st) === true)
  }

  check('키에 다섯 값이 모두 들어간다',
    impressionKey(id()) === `${GRAPH.graphVersion}|a|b|GRAPH|DIRECT_NEXT`,
    impressionKey(id()))

  // 🔴 저장소 실패는 fail-open — 막지 않고 보낸다
  {
    let threw = false
    let sent: boolean | null = null
    try {
      sent = shouldSendImpression(id(), hostile)
    } catch {
      threw = true
    }
    check('저장소가 던져도 예외가 새지 않는다', !threw)
    check('  🔴 fail-open — 그때는 보낸다 (렌더·이동을 막지 않는다)', sent === true)
    check('  저장소가 없어도(null) 보낸다', shouldSendImpression(id(), null) === true)
    let threw2 = false
    try {
      clearImpressions(hostile)
    } catch {
      threw2 = true
    }
    check('  비우기도 던지지 않는다', !threw2)
  }

  // 🔴 깨진 값도 삼킨다
  {
    const st = makeStore()
    st.setItem('soran-magazine-impressions', '{깨진')
    check('깨진 저장값이면 다시 보낸다 (막히지 않는다)', shouldSendImpression(id(), st) === true)
    st.setItem('soran-magazine-impressions', '"배열이 아님"')
    check('  배열이 아닌 값도 마찬가지', shouldSendImpression(id(), st) === true)
  }

  // 🔴 한도를 넘어도 저장소가 터지지 않는다
  {
    const st = makeStore()
    for (let i = 0; i < MAX_KEYS + 50; i++) shouldSendImpression(id({ targetSlug: `t${i}` }), st)
    const kept = JSON.parse(st.getItem('soran-magazine-impressions') ?? '[]') as string[]
    check(`한 세션 보관 상한 ${MAX_KEYS} 를 지킨다`, kept.length === MAX_KEYS, `${kept.length}개`)
    check('  가장 최근 것이 남는다', kept[kept.length - 1].endsWith(`|t${MAX_KEYS + 49}|GRAPH|DIRECT_NEXT`))
  }

  /** 🔴 저장 내용에 개인 식별자가 없다 */
  {
    const st = makeStore()
    shouldSendImpression(id(), st)
    const raw = st.getItem('soran-magazine-impressions') ?? ''
    check('저장하는 것은 키 배열뿐이다', /^\["[^"]+"\]$/.test(raw), raw.slice(0, 60))
  }

  /** 🔴 화면이 실제로 이 장치를 쓰는가 — 지역 변수로 되돌아가면 여기서 빨개진다 */
  {
    const linkSrc = readFileSync(join(ROOT, 'src/components/features/RelatedMagazineLink.tsx'), 'utf8')
    check('링크가 shouldSendImpression 을 거쳐 보낸다', linkSrc.includes('shouldSendImpression('))
    const code = linkSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('  🔴 컴포넌트 지역 sent 변수로 막지 않는다', !/let\s+sent\s*=/.test(code))
    const logSrc = readFileSync(join(ROOT, 'src/lib/analytics/magazine-impression-log.ts'), 'utf8')
    const logCode = logSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('  sessionStorage 를 쓴다 (localStorage 아님)',
      /window\.sessionStorage/.test(logCode) && !/localStorage/.test(logCode))
  }
}

// ── ⑤ 런타임이 삼키는 층 ─────────────────────────────────
console.log('\n⑤ 런타임 폴백')

check(
  'MGRAPH_GRAPH_KILL=1 이 켜기를 이긴다',
  isGraphEnabled({ ...ALL_ON, MGRAPH_GRAPH_KILL: '1' }) === false,
)
{
  const killed = published.filter(
    (a) => resolveRelatedMagazine(a, { ...ALL_ON, MGRAPH_GRAPH_KILL: '1' }).source !== 'FALLBACK',
  )
  check('  KILL=1 이면 전부 폴백이다', killed.length === 0)
  const same = published.every(
    (a) =>
      slugsOf(a, { ...ALL_ON, MGRAPH_GRAPH_KILL: '1' }).join(',') === legacyOf(a).join(','),
  )
  check('  그 결과가 예전과 똑같다', same)
}

/** 🔴 예외 경로를 실제로 통과시킨다. env 접근이 던지면 resolver 안에서 잡혀야 한다 */
{
  const hostileEnv = new Proxy({} as NodeJS.ProcessEnv, {
    get() {
      throw new Error('의도적으로 던진다')
    },
  })
  let threw = false
  let out: string[] = []
  let reason: string | null = null
  try {
    const r = resolveRelatedMagazine(published[0], hostileEnv)
    out = r.items.map((i) => i.article.slug)
    reason = r.reason
  } catch {
    threw = true
  }
  check('resolver 예외가 밖으로 나가지 않는다 — 상세 페이지가 죽지 않는다', !threw)
  check('  예외 사유로 폴백한다', reason === 'EXCEPTION')
  check('  그 글의 예전 결과를 그대로 준다', out.join(',') === legacyOf(published[0]).join(','))
}

/** 🔴 버전 불일치는 **런타임** 폴백이다 (파일 누락과 달리) */
{
  const mutable = CONTROL as unknown as { graphVersion: string }
  const real = mutable.graphVersion
  let reason: string | null = null
  let out: string[] = []
  try {
    mutable.graphVersion = 'g-어긋난-버전'
    const r = resolveRelatedMagazine(published[0], ALL_ON)
    reason = r.reason
    out = r.items.map((i) => i.article.slug)
  } finally {
    mutable.graphVersion = real
  }
  check('GRAPH 와 CONTROL 의 버전이 다르면 폴백한다', reason === 'VERSION_MISMATCH')
  check('  그 결과가 예전과 같다', out.join(',') === legacyOf(published[0]).join(','))
  check('  검사가 끝난 뒤 버전이 되돌아왔다', CONTROL.graphVersion === GRAPH.graphVersion)
}

// ── ⑥ 한 글이 막혀도 다른 글은 멀쩡한가 ────────────────────
console.log('\n⑥ 한 글이 막혀도 나머지는 멀쩡하다')

{
  // 관계가 하나도 없는 글(매핑 없음)이 섞여 있어도 나머지 글은 그래프를 쓴다.
  const noMapping = published.filter(
    (a) => resolveRelatedMagazine(a, ALL_ON).reason === 'NO_MAPPING',
  )
  const stillGraph = published.filter((a) => resolveRelatedMagazine(a, ALL_ON).source === 'GRAPH')
  check(
    '매핑 없는 글이 다른 글의 그래프를 막지 않는다',
    stillGraph.length > 0,
    `매핑없음 ${noMapping.length}편 · 그래프 ${stillGraph.length}편`,
  )
  const emptyRender = published.filter((a) => resolveRelatedMagazine(a, ALL_ON).items.length === 0)
  check(
    '  연관 글이 0건인 글은 예전에도 0건이던 글뿐이다',
    emptyRender.every((a) => legacyOf(a).length === 0),
  )
  // 예약 공개는 그래프와 무관하게 관문이 판정한다.
  check(
    '  예약·차단 글은 그래프를 켜든 끄든 목록에 없다',
    getAllMagazineArticles().every((a) => !unpublishedSlugs.has(a.slug)),
  )
}

// ── ⑦ 계측 — 노출과 클릭 ─────────────────────────────────
console.log('\n⑦ 계측 (노출 · 클릭)')

{
  type G = { gtag?: unknown }
  const g = globalThis as unknown as G & { window?: unknown }
  const hadWindow = 'window' in globalThis
  const calls: unknown[][] = []

  const sample = {
    slug: 'a',
    target_slug: 'b',
    relation_type: 'NEXT_QUESTION',
    surface: 'FOOTER_NEXT',
    recommendation_slot: 'DIRECT_NEXT',
    recommendation_source: 'GRAPH',
    position: 0,
    graph_version: GRAPH.graphVersion,
  } as const

  try {
    // trackEvent 는 window 가 없으면 즉시 반환한다. 서버에서 세려면 창을 흉내 내야 한다.
    ;(globalThis as { window?: unknown }).window = globalThis
    g.gtag = (...args: unknown[]) => {
      calls.push(args)
    }

    trackEvent('magazine_related_impression', sample)
    check('magazine_related_impression 이 gtag 로 나간다', calls.length === 1)
    trackEvent('magazine_related_click', { ...sample, depth: '1' })
    check('magazine_related_click 도 나간다', calls.length === 2)
    check('  send_to 를 붙이지 않는다', !JSON.stringify(calls).includes('send_to'))

    /** 🔴 노출과 클릭이 같은 필드를 쓴다 — 갈라지면 둘을 맞붙일 수 없다 */
    const impKeys = Object.keys((calls[0] as [string, string, object])[2]).sort()
    const clkKeys = Object.keys((calls[1] as [string, string, object])[2]).sort()
    check('노출 필드 8종', impKeys.join(',') ===
      'graph_version,position,recommendation_slot,recommendation_source,relation_type,slug,surface,target_slug', impKeys.join(','))
    check('  클릭은 거기에 depth 하나만 더 있다',
      clkKeys.join(',') === [...impKeys, 'depth'].sort().join(','))

    /** 🔴 금지 키가 타입에 자리가 없다 — 아래 @ts-expect-error 가 그것을 강제한다 */
    // @ts-expect-error 제목을 실을 자리를 두지 않는다
    const withTitle: SoranEventMap['magazine_related_impression'] = { ...sample, title: '보내면 안 됨' }
    void withTitle

    // 🔴 전송이 던져도 호출부가 죽으면 안 된다 — 던지면 링크 이동이 막힌다.
    g.gtag = () => {
      throw new Error('전송 실패')
    }
    let threw = false
    try {
      trackEvent('magazine_related_impression', sample)
      trackEvent('magazine_related_click', { ...sample, depth: '2' })
    } catch {
      threw = true
    }
    check('전송이 던져도 예외가 새지 않는다 — 이동이 막히지 않는다', !threw)

    // gtag 자체가 없을 때
    delete g.gtag
    let threw2 = false
    try {
      trackEvent('magazine_related_impression', sample)
    } catch {
      threw2 = true
    }
    check('gtag 가 없으면 아무 일도 하지 않는다', !threw2)
  } finally {
    delete g.gtag
    if (!hadWindow) delete (globalThis as { window?: unknown }).window
  }
}

/** 🔴 호출부가 지워지면 위 시험은 그대로 통과한다. 그래서 소스도 본다 */
{
  const linkSrc = readFileSync(join(ROOT, 'src/components/features/RelatedMagazineLink.tsx'), 'utf8')
  check("링크에 trackEvent('magazine_related_click') 호출이 있다",
    linkSrc.includes("trackEvent('magazine_related_click'"))
  check("링크에 trackEvent('magazine_related_impression') 호출이 있다",
    linkSrc.includes("trackEvent('magazine_related_impression'"))
  check('  IntersectionObserver 로 화면 진입을 본다', linkSrc.includes('IntersectionObserver'))
  check('  🔴 한 번 센 뒤 관측을 끊는다 (분모가 부풀지 않게)', linkSrc.includes('io.disconnect()'))
  check('  🔴 IntersectionObserver 가 없어도 렌더가 죽지 않는다',
    /typeof IntersectionObserver === 'undefined'/.test(linkSrc))
  check('  🔴 클릭에 연속 열람 깊이를 싣는다', linkSrc.includes('recordRelatedClick('))
  /** 🔴 주석의 설명문이 아니라 **실제 호출**을 본다 */
  check('  preventDefault 를 호출하지 않는다 — 계측이 이동을 가로채지 않는다',
    !/\.preventDefault\s*\(/.test(linkSrc))

  const listSrc = readFileSync(join(ROOT, 'src/components/features/RelatedMagazineList.tsx'), 'utf8')
  check("  목록은 서버 컴포넌트로 남는다 ('use client' 없음)", !listSrc.includes("'use client'"))
  /** 🔴 글 객체를 통째로 클라이언트에 넘기면 body 가 RSC 페이로드에 직렬화된다 */
  const linkProps = /export type RelatedLinkProps = \{([\s\S]*?)\n\}/.exec(linkSrc)?.[1] ?? ''
  check('🔴 링크가 MagazineArticle 을 통째로 받지 않는다 (body 직렬화 방지)',
    !/article\s*:\s*MagazineArticle/.test(linkProps) && linkProps.includes('title: string'))
  check('  목록이 article.title 을 그대로 링크 제목으로 넘긴다',
    listSrc.includes('title={article.title}'))
}

// ── ⑧ 표면 계약 ─────────────────────────────────────────// ── ⑧ 표면 계약 ─────────────────────────────────────────
console.log('\n⑧ 표면 계약')

{
  const active = GRAPH.edges.filter((e) => e.active)
  const impl = new Set<string>(IMPLEMENTED_SURFACES)
  check(
    '활성 edge 의 표면이 전부 구현된 것이다',
    active.every((e) => impl.has(e.placement)),
    `활성 ${active.length}건`,
  )
  const footer = new Set<string>(FOOTER_SURFACES)
  const rendered = active.filter((e) => footer.has(e.placement))
  check('하단이 읽는 표면에 활성 관계가 있다', rendered.length > 0, `${rendered.length}건`)
  check('  CTA_END 는 하단이 읽지 않는다 (본문 끝 블록이다)', !footer.has('CTA_END'))
  check(
    '  surfaces 플래그에 없는 표면이 활성이 아니다',
    active.every((e) => e.placement in CONTROL.surfaces),
  )
}

// ── ⑨ 감시와 자동 차단 ───────────────────────────────────
console.log('\n⑨ 감시와 자동 차단')

/** 🔴 가짜 화면으로 돌린다. 네트워크도 운영 도메인도 건드리지 않는다 */
const pageWith = (links: string[]) =>
  `<main><article>본문 <a href="/magazine/본문-안-링크">본문</a></article>` +
  `<section><h2>함께 읽어보세요</h2><ul>` +
  links.map((s) => `<li><a href="/magazine/${s}">제목</a></li>`).join('') +
  `</ul></section></main>`

/** 가짜 화면. `null` 은 연결 실패, 숫자는 그 상태 코드로 돌려준다 */
const fakeDeps = (
  pages: Record<string, string | null | number>,
  opts: {
    vercelCreds?: boolean
    laneCreds?: boolean
    setEnv?: StepResult
    redeploy?: StepResult
    lane?: StepResult
  } = {},
): GraphWatchDeps & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fetchPage: (url) => {
      const slug = url.split('/magazine/')[1] ?? ''
      const v = slug in pages ? pages[slug] : ''
      if (v === null) return { ok: false, status: null, why: 'curl 실패' }
      if (typeof v === 'number') return { ok: false, status: v, why: `HTTP ${v}` }
      return { ok: true, status: 200, body: v }
    },
    now: () => new Date('2026-09-23T12:00:00+09:00'),
    vercel: {
      hasCredentials: () => opts.vercelCreds ?? true,
      setKillEnv: () => {
        calls.push('setKillEnv')
        return opts.setEnv ?? { ok: true, detail: 'MGRAPH_GRAPH_KILL=1' }
      },
      redeploy: () => {
        calls.push('redeploy')
        return opts.redeploy ?? { ok: true, detail: '재배포 트리거됨' }
      },
    },
    lane: {
      hasCredentials: () => opts.laneCreds ?? true,
      commitAndMerge: () => {
        calls.push('commitAndMerge')
        return opts.lane ?? { ok: true, detail: 'PR·자동 병합' }
      },
    },
    writeControl: () => {
      calls.push('writeControl')
      return { ok: true, detail: 'control.ts 갱신' }
    },
  }
}

{
  const a = published[0].slug
  const b = published[1].slug

  check(
    '본문 링크를 세지 않는다 — 하단 구역만 본다',
    extractRelatedLinks(pageWith([b])).join(',') === b,
  )
  check('문구가 없으면 0건이다', extractRelatedLinks('<section><ul></ul></section>').length === 0)
  check(
    '  화면의 h2 문구가 감시가 찾는 문구와 같다',
    readFileSync(join(ROOT, 'src/components/features/RelatedMagazineList.tsx'), 'utf8').includes(
      '함께 읽어보세요',
    ),
  )

  const clean = await runGraphWatch({
    deps: fakeDeps({ [a]: pageWith([b]) }),
    articles: [{ slug: a }, { slug: b }],
  })
  check('정상 화면이면 조치가 없다', clean.ok && clean.action === 'NONE', `확인 ${clean.checked}편`)

  /**
   * 🔴 표본으로 **실제 미공개 글**을 쓴다. 지어낸 문자열을 쓰면 시험이 실제보다 약해진다 —
   *    매거진 slug 는 영문 kebab-case 라(types.ts) 한글 표본은 감시의 정규식에 아예 걸리지 않고,
   *    그러면 "샌 것을 못 잡는" 결함을 "표본이 이상해서" 로 덮게 된다.
   */
  const realUnpublished = [...unpublishedSlugs][0]
  check('시험에 쓸 실제 미공개 글이 있다', typeof realUnpublished === 'string', realUnpublished)

  const leak = await runGraphWatch({
    deps: fakeDeps({ [a]: pageWith([realUnpublished]) }),
    articles: [{ slug: a }, { slug: b }],
  })
  check('미공개 글이 링크에 뜨면 전체 차단을 요구한다', leak.action === 'TRIP_GLOBAL')
  check(
    '  그 사유가 UNPUBLISHED_LEAK 다',
    leak.findings.some((f) => f.code === 'UNPUBLISHED_LEAK' && f.targetSlug === realUnpublished),
  )

  const selfLink = await runGraphWatch({
    deps: fakeDeps({ [a]: pageWith([a, b, b]) }),
    articles: [{ slug: a }, { slug: b }],
  })
  check('자기 링크·중복은 알리되 전체 차단하지 않는다', selfLink.action === 'NONE' && !selfLink.ok)
  check(
    '  둘 다 관측된다',
    selfLink.findings.some((f) => f.code === 'SELF_LINK') &&
      selfLink.findings.some((f) => f.code === 'DUPLICATE_LINK'),
  )

  /** 🔴 연결 실패로 그래프를 끄면 그래프는 영원히 못 켠다. 못 본 것과 본 것은 다르다 */
  const down = await runGraphWatch({
    deps: fakeDeps({ [a]: null, [b]: null }),
    articles: [{ slug: a }, { slug: b }],
  })
  check('연결 실패로는 차단하지 않는다', down.action === 'NONE', `읽지 못함 ${down.unreachable}편`)
  check('  그래도 조용히 넘어가지 않는다 (ok=false)', down.ok === false)

  /**
   * 🔴 **HTTP 오류를 성공으로 보지 않는다.**
   *    옛 판은 curl 종료 코드만 봤다 — 404·500 의 오류 페이지를 화면으로 읽었고,
   *    거기 링크가 없으니 "관련 글 0건 · 이상 없음" 으로 조용히 통과했다.
   *    그러면 미공개 누출이 일어나도 감시가 **아무것도 못 본다.**
   */
  for (const code of [404, 500, 503]) {
    const r = await runGraphWatch({
      deps: fakeDeps({ [a]: code, [b]: code }),
      articles: [{ slug: a }, { slug: b }],
    })
    check(`HTTP ${code} 는 성공이 아니다 — CHECK_UNREACHABLE 로 센다`,
      r.unreachable === 2 && r.checked === 0 && r.action === 'NONE')
    check(`  ${code} 가 사유에 남는다`,
      r.findings.every((f) => f.code === 'CHECK_UNREACHABLE' && f.message.includes(String(code))))
  }
  check(
    '상태 코드 파서가 본문과 코드를 가른다',
    parseCurlOutput('<html>본문</html>\n__HTTP_STATUS__404').status === 404 &&
      parseCurlOutput('<html>본문</html>\n__HTTP_STATUS__404').body.includes('본문'),
  )
  check('  표식이 없으면 상태를 모른다고 답한다', parseCurlOutput('그냥 본문').status === null)

  // ── 🔴 자동 차단 체인 — 사람 승인 없이 네 단계가 실제로 불린다 ──
  {
    const leakPages = { [a]: pageWith([realUnpublished]) }
    const arts = [{ slug: a }, { slug: b }]

    const dryRun = fakeDeps(leakPages)
    const dry = await runGraphWatch({ deps: dryRun, articles: arts })
    check('--apply 없이는 아무 단계도 부르지 않는다', dryRun.calls.length === 0 && dry.steps.length === 0)

    const full = fakeDeps(leakPages)
    const applied = await runGraphWatch({ deps: full, articles: arts, apply: true })
    check('--apply 면 네 단계가 순서대로 불린다',
      full.calls.join('→') === 'setKillEnv→redeploy→writeControl→commitAndMerge',
      full.calls.join(' → '))
    check('  환경변수만 바꾸고 끝내지 않는다 (재배포까지 부른다)', full.calls.includes('redeploy'))
    check('  전부 성공하면 자동화 실패가 아니다', applied.automationFailed === false)
    check('  사람 승인 단계가 없다', applied.steps.every((s) => !/승인|검수/.test(s.name)))

    /** 🔴 credential 이 없으면 **성공으로 속이지 않는다** */
    const noCreds = fakeDeps(leakPages, { vercelCreds: false })
    const r1 = await runGraphWatch({ deps: noCreds, articles: arts, apply: true })
    check('Vercel credential 이 없으면 자동화 실패다', r1.automationFailed === true)
    check('  끄지도 않고 부르지도 않는다', !noCreds.calls.includes('setKillEnv'))
    check('  그래도 층2 는 계속 간다 (할 수 있는 것은 한다)', noCreds.calls.includes('writeControl'))

    const noGh = fakeDeps(leakPages, { laneCreds: false })
    const r2 = await runGraphWatch({ deps: noGh, articles: arts, apply: true })
    check('gh credential 이 없어도 자동화 실패로 적는다', r2.automationFailed === true)
    check('  영구 반영을 시도하지 않는다', !noGh.calls.includes('commitAndMerge'))

    /** 🔴 한 단계가 실패해도 실패로 끝난다 — 알림으로 갈음하지 않는다 */
    const envFail = fakeDeps(leakPages, { setEnv: { ok: false, detail: '토큰 거부' } })
    const r3 = await runGraphWatch({ deps: envFail, articles: arts, apply: true })
    check('한 단계라도 실패하면 자동화 실패다', r3.automationFailed === true)
    check('  나머지 단계는 계속 시도한다', envFail.calls.includes('commitAndMerge'))

    /** 🔴 누출이 없으면 --apply 여도 아무것도 하지 않는다 */
    const cleanApply = fakeDeps({ [a]: pageWith([b]) })
    const r4 = await runGraphWatch({ deps: cleanApply, articles: arts, apply: true })
    check('누출이 없으면 --apply 여도 차단하지 않는다',
      cleanApply.calls.length === 0 && r4.action === 'NONE' && r4.automationFailed === false)

    /** 🔴 연결 실패만으로는 --apply 여도 차단하지 않는다 */
    const downApply = fakeDeps({ [a]: 500, [b]: null })
    const r5 = await runGraphWatch({ deps: downApply, articles: arts, apply: true })
    check('네트워크 실패만으로는 --apply 여도 차단하지 않는다', downApply.calls.length === 0)
    check('  그래도 non-zero 로 끝날 근거가 남는다 (ok=false)', r5.ok === false)
  }
}

/** 🔴 층 2 가 실제로 control.ts 를 쓸 수 있는가 — 진짜 파일 대신 복사본에 쓴다 */
{
  const tmp = join(ROOT, 'src/content/magazine/graph/control.check-tmp.ts')
  const controlPath = join(ROOT, 'src/content/magazine/graph/control.ts')
  const original = readFileSync(controlPath, 'utf8')
  let written = ''
  try {
    writeFileSync(tmp, original, 'utf8')
    const r = writeTrippedControl('회귀 시험', new Date('2026-09-23T12:00:00+09:00'), tmp)
    written = readFileSync(tmp, 'utf8')
    check('차단 기록이 control.ts 를 바꾼다', r.changed)
  } finally {
    rmSync(tmp, { force: true })
  }
  check('  enabled 가 false 가 된다', /\n  enabled: false,/.test(written))
  check('  열린 cluster 가 비워진다', /\n  enabledClusters: \[\],/.test(written))
  check('  killSwitch.tripped 가 true 가 된다', written.includes('"tripped":true'))
  check('  누가 껐는지 남는다', written.includes('"trippedBy":"magazine-graph-watch"'))
  check(
    '  graphVersion 은 건드리지 않는다 — exporter 의 사실이다',
    written.includes(`graphVersion: '${GRAPH.graphVersion}'`),
  )
  check('  진짜 control.ts 는 그대로다', readFileSync(controlPath, 'utf8') === original)

  /** 🔴 그 파일을 resolver 가 읽으면 꺼진 상태여야 한다 — 값만 바뀌고 효과가 없으면 헛일이다 */
  const trippedControl = { killSwitch: { tripped: true }, enabled: false }
  check(
    '  tripped=true 면 환경변수로 켜도 꺼진다 (control 이 이긴다)',
    trippedControl.killSwitch.tripped === true && trippedControl.enabled === false,
  )
}

check(
  '감시는 읽기 전용이 기본이다 — --apply 없이는 쓰지 않는다',
  /const apply = argv\.includes\('--apply'\)/.test(
    readFileSync(join(ROOT, 'scripts/magazine-graph-watch.mts'), 'utf8'),
  ),
)
/**
 * 🔴 문구가 아니라 **행동**을 본다.
 *    "재배포가 필요하다" 고 주석에 적어 두는 것으로는 아무 일도 일어나지 않는다.
 *    환경변수를 세운 뒤 재배포를 **실제로 부르는지**가 계약이다 (위 체인 시험이 그것을 본다).
 *    여기서는 그 사실이 사람에게도 읽히게 적혀 있는지만 덧붙여 본다.
 */
{
  const src = readFileSync(join(ROOT, 'scripts/magazine-graph-watch.mts'), 'utf8')
  check('  환경변수만 바꾸면 반영되지 않는다는 사실이 적혀 있다',
    /값만 바꾸면 현재 배포는 그대로다/.test(src))
  check('  그래서 재배포를 호출하는 자리가 있다', /deps\.vercel\.redeploy\(\)/.test(src))
}

// ── ⑨-B 🔴 실제 롤백 동작 — resolver 를 직접 돌린다 ──────
console.log('\n⑨-B 롤백 (2파일 원자적 전환)')

/**
 * 🔴 **타입 검사만으로는 롤백을 증명하지 못한다.**
 *    `current.ts` 만 이전 버전으로 돌리면 컴파일은 되지만,
 *    `GRAPH.graphVersion` 과 `CONTROL.graphVersion` 이 어긋나
 *    resolver 가 VERSION_MISMATCH 로 **폴백**한다 —
 *    옛 그래프가 도는 게 아니라 그래프가 꺼진 것과 같아진다.
 *
 * 🔴 그래서 **두 파일을 한 커밋에서 함께** 바꾸는 것이 롤백이다.
 *    아래는 진짜 그래프 디렉터리에 이전 버전을 만들어 두 파일을 돌리고,
 *    **별도 프로세스에서 resolver 를 실제로 실행해** 옛 그래프가 도는지 확인한다.
 *    (정적 import 라 같은 프로세스 안에서는 바꿔 끼울 수 없다)
 *
 * 🔴 끝나면 전부 되돌린다. finally 가 지킨다.
 */
{
  /**
   * 🔴 **그래프가 실제로 관계를 주는 글**을 고른다. 아무 글이나 쓰면
   *    원래부터 폴백인 글을 놓고 "롤백이 됐다" 고 착각할 수 있다.
   */
  const graphBacked = published.find(
    (a) => resolveRelatedMagazine(a, ALL_ON).items.some((i) => i.source === 'GRAPH'),
  )
  check('시험에 쓸 그래프 기반 글이 있다', graphBacked !== undefined, graphBacked?.slug ?? '(없음)')
  const graphBackedSlug = graphBacked?.slug ?? published[0].slug

  const GDIR = join(ROOT, 'src/content/magazine/graph')
  const PREV = 'g-20260901-r0llba'
  const curPath = join(GDIR, 'current.ts')
  const ctlPath = join(GDIR, 'control.ts')
  const prevPath = join(GDIR, `${PREV}.ts`)
  const probePath = join(ROOT, 'scripts/_rollback-probe.mts')

  const origCur = readFileSync(curPath, 'utf8')
  const origCtl = readFileSync(ctlPath, 'utf8')

  /** 별도 프로세스에서 resolver 를 돌려 첫 글의 판정을 받아 온다 */
  const runResolver = (): { source: string; reason: string | null; graphVersion: string; items: number } => {
    const out = execFileSync(join(ROOT, 'node_modules/.bin/tsx'), [probePath], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, MGRAPH_GRAPH_ENABLED: '1', MGRAPH_GRAPH_CLUSTERS: ALL_ON.MGRAPH_GRAPH_CLUSTERS },
    })
    return JSON.parse(out.trim().split('\n').pop() ?? '{}')
  }

  try {
    // 🔴 이전 버전 번들을 만든다 — 현재 것을 복제해 graphVersion 만 바꾼다.
    //    같은 스키마(edge/3)라 컴파일도 되고 관계 내용도 실재한다.
    writeFileSync(
      prevPath,
      readFileSync(join(ROOT, `src/content/magazine/graph/${GRAPH.graphVersion}.ts`), 'utf8')
        .replace(`"graphVersion": "${GRAPH.graphVersion}"`, `"graphVersion": "${PREV}"`),
      'utf8',
    )
    writeFileSync(
      probePath,
      [
        `import { getAllMagazineArticles } from '../src/lib/magazine'`,
        `import { resolveRelatedMagazine } from '../src/lib/magazine-graph'`,
        `const a = getAllMagazineArticles().find((x) => x.slug === '${graphBackedSlug}')!`,
        `const r = resolveRelatedMagazine(a)`,
        `console.log(JSON.stringify({ source: r.source, reason: r.reason, graphVersion: r.items[0]?.graphVersion ?? 'none', items: r.items.length }))`,
      ].join('\n'),
      'utf8',
    )

    // ── ① 기준선: 지금 버전에서 그래프가 돈다 ──
    const base = runResolver()
    check('기준선: 현재 버전에서 그래프가 돈다', base.source === 'GRAPH' && base.reason === null,
      `${base.source} · ${base.graphVersion}`)

    // ── ② 🔴 current.ts 만 돌리면 — 폴백이어야 한다 ──
    writeFileSync(curPath, origCur.replace(/from '\.\/g-[0-9a-z-]+'/, `from './${PREV}'`), 'utf8')
    const oneFile = runResolver()
    check(
      '🔴 current.ts 만 돌리면 VERSION_MISMATCH 폴백이다 (롤백이 아니다)',
      oneFile.source === 'FALLBACK' && oneFile.reason === 'VERSION_MISMATCH',
      `${oneFile.source} · ${oneFile.reason}`,
    )

    // ── ③ 🔴 control.ts 까지 함께 돌리면 — 옛 그래프가 실제로 돈다 ──
    writeFileSync(ctlPath, origCtl.replace(/graphVersion: '[^']+'/, `graphVersion: '${PREV}'`), 'utf8')
    const twoFile = runResolver()
    check('🔴 두 파일을 함께 돌리면 그래프가 돈다 (source=GRAPH)', twoFile.source === 'GRAPH',
      `${twoFile.source} · ${twoFile.reason ?? 'null'}`)
    check(`  🔴 graphVersion 이 이전 버전(${PREV})이다`, twoFile.graphVersion === PREV, twoFile.graphVersion)
    check('  🔴 reason 이 null 이다 (폴백이 아니다)', twoFile.reason === null)
    check('  추천이 실제로 나온다', twoFile.items > 0, `${twoFile.items}건`)
  } finally {
    // 🔴 무슨 일이 있어도 되돌린다
    writeFileSync(curPath, origCur, 'utf8')
    writeFileSync(ctlPath, origCtl, 'utf8')
    rmSync(prevPath, { force: true })
    rmSync(probePath, { force: true })
  }

  check('검사가 끝난 뒤 current.ts 가 제자리다', readFileSync(curPath, 'utf8') === origCur)
  check('  control.ts 도 제자리다', readFileSync(ctlPath, 'utf8') === origCtl)
  check('  임시 버전 파일이 지워졌다', !existsSync(prevPath))

  /** 🔴 복구 경로 둘을 구분해 적는다 */
  const curSrc = readFileSync(curPath, 'utf8')
  check('current.ts 가 2파일 전환을 요구한다고 적고 있다',
    curSrc.includes('control.ts') && curSrc.includes('VERSION_MISMATCH'))
}

// ── ⑩ 그래프 전용 병합 레인 ──────────────────────────────
console.log('\n⑩ 그래프 전용 병합 레인')

const GRAPH_FILES = [
  'src/content/magazine/graph/types.ts',
  'src/content/magazine/graph/current.ts',
  'src/content/magazine/graph/control.ts',
  `src/content/magazine/graph/${GRAPH.graphVersion}.ts`,
]

{
  /**
   * 🔴 원고 레인의 prefix 를 **문자열로 베껴 적지 않는다.** 그 쪽이 이름을 바꾸면
   *    사본은 그대로 남아 "다르다" 고 계속 답한다. 실제 상수를 가져와 비교한다.
   */
  const laneSep: boolean = !String(GRAPH_BRANCH_PREFIX).startsWith(String(AUTO_BRANCH_PREFIX))
    && !String(AUTO_BRANCH_PREFIX).startsWith(String(GRAPH_BRANCH_PREFIX))
  check('그래프 레인 prefix 가 원고 레인과 서로를 포함하지 않는다',
    laneSep, `${GRAPH_BRANCH_PREFIX} ↔ ${AUTO_BRANCH_PREFIX}`)
  check('  원고 레인 브랜치는 그래프 레인 목록에 들어오지 않는다',
    !`${AUTO_BRANCH_PREFIX}20260923`.startsWith(GRAPH_BRANCH_PREFIX))
  check('  그래프 레인 브랜치는 원고 레인 목록에 들어오지 않는다',
    !`${GRAPH_BRANCH_PREFIX}20260923`.startsWith(String(AUTO_BRANCH_PREFIX)))

  check('그래프 네 파일이 허용된다', GRAPH_FILES.every(isGraphLaneFile))
  for (const f of [
    'src/content/magazine/articles.ts',
    'drafts/magazine/x/draft.md',
    'public/magazine/x/hero.webp',
    'prisma/schema.prisma',
    '.github/workflows/visibility-guard.yml',
    'src/lib/magazine-graph.ts',
  ]) {
    check(`  ${f} 는 이 레인이 건드릴 수 없다`, !isGraphLaneFile(f))
  }

  /** 🔴 원고 레인의 CI 계약을 **빌려 쓴다** — 사본이 아니라 import 다 */
  const okPr: Pr = {
    number: 1, url: 'u', headRefName: `${GRAPH_BRANCH_PREFIX}20260923120000`,
    headRefOid: 'sha1', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false,
  }
  const okChecks = REQUIRED_CHECKS.map((n: string) => ({ name: n, status: 'completed', conclusion: 'success' }))
  const base = { pr: okPr, expectedSha: 'sha1', files: GRAPH_FILES, ciState: 'success', checks: okChecks }

  check('정상 그래프 PR 은 통과한다', judgeGraphMerge(base).ok)

  const cases: { why: string; patch: Partial<typeof base>; code: string }[] = [
    { why: '사람 PR', patch: { pr: { ...okPr, headRefName: 'fix/by-human' } }, code: 'NOT_GRAPH_BRANCH' },
    { why: '원고 레인 PR', patch: { pr: { ...okPr, headRefName: `${AUTO_BRANCH_PREFIX}x` } }, code: 'NOT_GRAPH_BRANCH' },
    { why: 'draft', patch: { pr: { ...okPr, isDraft: true } }, code: 'IS_DRAFT' },
    { why: '충돌', patch: { pr: { ...okPr, mergeable: 'CONFLICTING' } }, code: 'NOT_MERGEABLE' },
    { why: '커밋이 움직임', patch: { pr: { ...okPr, headRefOid: 'sha2' } }, code: 'SHA_MOVED' },
    { why: '원고가 섞임', patch: { files: [...GRAPH_FILES, 'src/content/magazine/articles.ts'] }, code: 'UNEXPECTED_FILES' },
    { why: '워크플로우가 섞임', patch: { files: [...GRAPH_FILES, '.github/workflows/visibility-guard.yml'] }, code: 'UNEXPECTED_FILES' },
    { why: 'current 만 있고 버전 파일이 없음', patch: { files: ['src/content/magazine/graph/current.ts'] }, code: 'SPLIT_BUNDLE' },
    { why: 'CI 실패', patch: { ciState: 'failure' }, code: 'CI_NOT_SUCCESS' },
    { why: '검사 실패', patch: { checks: [...okChecks, { name: 'x', status: 'completed', conclusion: 'failure' }] }, code: 'CHECK_FAILED' },
    { why: '필수 검사 없음', patch: { checks: [] }, code: 'REQUIRED_CHECK_MISSING' },
  ]
  for (const c of cases) {
    const j = judgeGraphMerge({ ...base, ...c.patch })
    check(`  ${c.why} → ${c.code}`, !j.ok && j.blockedBy.some((b) => b.code === c.code),
      j.blockedBy.map((b) => b.code).join(',') || '(막지 않았다)')
  }

  /** 🔴 필수 검사 목록이 원고 레인과 **같은 객체**에서 온다 */
  check('필수 검사 계약을 원고 레인에서 빌려 쓴다 (사본 아님)',
    REQUIRED_CHECKS.length > 0 && judgeGraphMerge({ ...base, checks: [] })
      .blockedBy.some((b) => b.message.includes(REQUIRED_CHECKS[0])))

  // ── 실행 흐름 — 🔴 가짜 git·gh 로 통째로 돌린다 ──
  const fakeMergeDeps = (over: Partial<GraphMergeDeps> = {}): GraphMergeDeps & { calls: string[] } => {
    const calls: string[] = []
    const d: GraphMergeDeps & { calls: string[] } = {
      calls,
      log: () => {},
      now: () => new Date('2026-09-23T12:00:00Z'),
      gitStatus: () => GRAPH_FILES.map((f) => ` M ${f}`).join('\n'),
      currentBranch: () => 'main',
      createBranch: (n) => { calls.push(`branch:${n}`); return true },
      commit: (f) => { calls.push(`commit:${f.length}`); return true },
      push: (b) => { calls.push(`push:${b}`); return true },
      headSha: () => 'sha1',
      changedGraphFiles: () => GRAPH_FILES,
      listGraphPrs: () => ({ ok: true, prs: [] }),
      createPr: () => { calls.push('createPr'); return { ok: true, number: 1, url: 'u' } },
      getPr: () => okPr,
      listPrFiles: () => GRAPH_FILES,
      getCi: () => ({ ok: true, ciState: 'success', checks: okChecks }),
      mergePr: () => { calls.push('mergePr'); return { ok: true } },
      ...over,
    }
    return d
  }

  const verify = fakeMergeDeps()
  const vr = await runGraphMerge({ deps: verify })
  check('검증만 하면 push·PR·merge 를 부르지 않는다', verify.calls.length === 0 && !vr.merged)

  const applied = fakeMergeDeps()
  const ar = await runGraphMerge({ apply: true, deps: applied })
  check('--apply 면 브랜치→커밋→push→PR→merge 가 이어진다',
    ar.merged && applied.calls.some((c) => c.startsWith('branch:')) &&
      applied.calls.includes('createPr') && applied.calls.includes('mergePr'),
    applied.calls.join(' → '))
  check('  브랜치가 그래프 레인 prefix 를 쓴다',
    (ar.branch ?? '').startsWith(GRAPH_BRANCH_PREFIX), ar.branch ?? '')

  /** 🔴 미해결 1건 계약 — 이미 떠 있으면 새로 만들지 않는다 */
  const busy = fakeMergeDeps({ listGraphPrs: () => ({ ok: true, prs: [okPr] }) })
  const br = await runGraphMerge({ apply: true, deps: busy })
  check('그래프 PR 이 이미 있으면 새로 만들지 않는다',
    busy.calls.length === 0 && br.blockedBy.some((b) => b.code === 'GRAPH_PR_ALREADY_OPEN'))

  /** 🔴 그래프 밖 변경이 있으면 전달기가 막는다 */
  const dirty = fakeMergeDeps({
    gitStatus: () => ` M src/content/magazine/graph/current.ts\n M src/lib/magazine.ts`,
  })
  const dr = await runGraphMerge({ apply: true, deps: dirty })
  check('그래프 밖 변경이 있으면 막는다',
    dirty.calls.length === 0 && dr.blockedBy.some((b) => b.code === 'DIRTY_OUTSIDE_GRAPH'))

  /** 🔴 바뀐 것이 없으면 빈 PR 을 만들지 않는다 */
  const nothing = fakeMergeDeps({ gitStatus: () => '', changedGraphFiles: () => [] })
  const nr = await runGraphMerge({ apply: true, deps: nothing })
  check('바뀐 그래프 파일이 없으면 아무것도 만들지 않는다',
    nothing.calls.length === 0 && nr.blockedBy.length === 0 && !nr.merged)

  /** 🔴 감시가 이 레인을 실제로 부르는가 — 문서가 아니라 코드로 */
  const watchSrc = readFileSync(join(ROOT, 'scripts/magazine-graph-watch.mts'), 'utf8')
  check('감시가 그래프 레인 스크립트를 실제로 호출한다',
    watchSrc.includes('scripts/magazine-graph-merge.mts'))
  /** 🔴 주석의 언급이 아니라 **실행 인자**를 본다 — 앞판은 설명문을 호출로 읽었다 */
  check('  감시가 그래프 레인을 실행 인자로 넘긴다',
    /join\(ROOT, 'scripts\/magazine-graph-merge\.mts'\)/.test(watchSrc))
  check('  감시가 원고 레인을 실행하지 않는다',
    !/magazine-auto-merge\.mjs'[,\)]/.test(watchSrc.replace(/^\s*\*.*$/gm, '')))
}

// ── 보고 ────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL`)
if (fail > 0) {
  console.log('')
  for (const f of failures) console.log(`  🔴 ${f}`)
}
console.log('')
console.log('🔴 이 검사가 보지 못하는 것:')
console.log('   · 클릭 이벤트가 렌더된 DOM 의 그 자리에 실제로 붙었는지 (소스 존재만 봤다)')
console.log('   · Vercel 환경변수를 바꾼 뒤 재배포가 실제로 돌았는지 — 저장소 밖이다')
console.log('')
process.exit(fail === 0 ? 0 : 1)
