/**
 * 합성 연구·제품 루트 생성기 — content-plan · plan-input 검사 전용 (실제 연구·회원·운영 데이터 0).
 *
 * seed.json 을 복제해 `mutate(seed)` 로 고친 뒤, 임시 폴더에 다음을 만든다.
 *   research/  contract/build/<판>/{manifest.json, intents.jsonl, edges.jsonl, mappings.jsonl, readiness.json, bundle/<판>.ts}
 *              contract/build/current → <판> (symlink) · contract/build/control.json · evidence/serpapi/*.json
 *              reconciled/fx/ (exact canonical snapshot 다섯 파일 — g4 에 intent 별 evidenceRefs(실제 canonical 모양) ·
 *              g5 에 basis · 구조화 evidence 가 있다). seed intent 의 `sourceRefs`(파일 이름 · 경로 · 객체)가 없으면 fx-a.json 하나다
 *   product/   src/content/magazine/graph/{current.ts, control.ts, <판>.ts} · src/content/magazine/articles.ts ·
 *              drafts/magazine/topic-queue.ts
 * 🔴 manifest 해시 · 판 이름은 만든 바이트에서 계산한다(제품 builder 의 sha16 · combined 규칙과 같은 식).
 *    그래서 snapshot · current 를 고친 world 도 자기 일관이고, 대조 실패는 검사가 일부러 만든 drift 에서만 난다.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const loadSeed = () => JSON.parse(readFileSync(join(HERE, 'seed.json'), 'utf8'))
const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const sha16 = (s) => sha256(s).slice(0, 16)
const put = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text) }
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`

export const SNAPSHOT_NAMES = Object.freeze({
  canonical: 'g4-intents-canonical.jsonl',
  automation: 'g4-automation-2026-09-23.jsonl',
  graph: 'g5-graph-2026-09-23.jsonl',
  published: 'assets-published.jsonl',
  queued: 'assets-queue.jsonl',
})

export const evidenceDoc = (d) => ({
  schema: 'mgraph.search-evidence.v1', query: d.query, providerQuery: d.query, queryEchoMismatch: false, provider: 'serpapi', engine: 'google',
  observedAt: '2026-11-01 06:30:13 UTC', savedAt: '2026-11-01T06:59:21.556Z', language: 'ko', location: 'kr', device: 'desktop',
  status: 'OK', error: null, cacheSignal: 'unknown', relatedSearches: [], peopleAlsoAsk: [], autocomplete: [],
  organicResults: [{ position: 1, title: d.organicTitle, snippet: d.snippet ?? `${d.organicTitle} 의 합성 snippet`, ...(d.domain ? { domain: d.domain } : {}), ...(d.url ? { url: d.url } : {}) }],
  counts: { related: 0, paa: 0, autocomplete: 0, organic: 1 }, rawPayloadKept: false, note: '합성',
})

/** articles.ts 텍스트 — 제품 파일과 같은 앵커(MAGAZINE_ARTICLE_RECORD) */
export const articlesText = (rows) => `import type { MagazineArticleBody } from './types'

const MAGAZINE_ARTICLE_RECORD = {
${rows.map((a) => `  ${JSON.stringify(a.slug)}: ${JSON.stringify({ title: a.title, description: '합성 설명', cluster: a.cluster, status: a.status ?? 'SCHEDULED', publishAt: a.publishAt, publishedAt: a.publishAt.slice(0, 10), body: [] })},`).join('\n')}
}

export const MAGAZINE_ARTICLES = MAGAZINE_ARTICLE_RECORD as Record<string, MagazineArticleBody>
`
/** topic-queue.ts 텍스트 — 제품 파일과 같은 앵커(export const TOPIC_QUEUE) */
export const queueText = (rows) => `export type TopicQueueItem = { slug: string; title: string }

export const TOPIC_QUEUE: TopicQueueItem[] = [
${rows.map((r, i) => `  ${JSON.stringify({ day: i + 1, ...r })},`).join('\n')}
]
`
/** control.ts 텍스트 — 제품 파일과 같은 모양(엄격 판독 대상) */
export const controlText = (graphVersion, c) => `import type { MagazineGraphControl } from './types'

export const CONTROL: MagazineGraphControl = {
  graphVersion: ${JSON.stringify(graphVersion)},
  enabled: ${JSON.stringify(c.enabled)},
  enabledClusters: ${JSON.stringify(c.enabledClusters)},
  surfaces: ${JSON.stringify(c.surfaces)},
  killSwitch: ${JSON.stringify(c.killSwitch)},
  previousGraphVersion: null,
} as const
`

/**
 * @param {string} base 빈 임시 폴더
 * @param {(seed: object) => void} [mutate]
 * @returns {{ base, researchDir, snapshotDir, productRoot, graphVersion, seed, texts }}
 */
export function makeWorld(base, mutate = () => {}) {
  const seed = loadSeed()
  mutate(seed)
  const P = seed.privateIntentFields, E = seed.privateEdgeFields
  const intents = seed.intents.map((x) => ({
    schemaVersion: 'intent/2', intentId: x.intentId, primaryQuery: x.primaryQuery, territoryId: x.territoryId, magazineCluster: x.magazineCluster,
    audienceSituation: x.audienceSituation, answerScope: x.answerScope, exclusions: x.exclusions,
    policyScope: x.policyScope ?? 'ALLOWED', policyScopeWhy: P.policyScopeWhy, verificationProfile: x.verificationProfile,
    profileSpec: { sourceLevel: 'MIXED', forbiddenClaims: x.forbiddenClaims, implementationNote: P.implementationNote },
    automationDecision: x.automationDecision ?? 'PASS', topicVerdict: 'AUTO_READY_TOPIC', verdictWhy: P.verdictWhy,
    retryPolicy: { note: P.retryPolicyNote }, runtimeState: x.runtimeState ?? 'UNPUBLISHED',
    evidence: { refs: 1, grade: 'OBSERVED' }, communityDestination: x.communityDestination, existingAssetRelation: '없음', duplicateReason: null,
    founderApproval: P.founderApproval,
  }))
  const builtEdges = seed.edges.map((e) => ({
    schemaVersion: 'edge/3', edgeId: e.edgeId, recommendationSlot: e.slot, fromIntentId: e.from, toIntentId: e.to, relationType: e.type,
    readerReason: e.reason, anchorLabel: e.anchor, placement: e.placement, priority: e.priority,
    runtimeWhy: '🔴 합성 runtime 사유', layers: { DESIGN: true, AUTOMATION_READY: e.automationReady ?? true, RUNTIME_ACTIVE: false },
    generatedBy: e.generatedBy ?? null,
  }))
  const g5 = seed.edges.filter((e) => !e.generatedBy).map((e) => ({
    edgeId: e.edgeId, fromIntentId: e.canonical?.from ?? e.from, toIntentId: e.to, relationType: e.type,
    readerReason: e.canonical?.reason ?? e.reason, anchorLabel: e.anchor, placement: e.placement, priority: e.priority,
    notes: E.notes, round: 'FX',
    ...(e.basis === null ? {} : { basis: e.basis ?? E.basis }),
    ...(e.evidence ? { evidence: e.evidenceObject ?? { serp: e.evidence.map((f) => `evidence/serpapi/${f} (${E.evidenceQuote})`).join(' / '), toIntent: `${e.to} 합성 대상` } } : {}),
  }))
  const mappings = seed.mappings.map((m) => ({ schemaVersion: 'mapping/2', intentId: m.intentId, slug: m.slug, assetState: 'LIVE', publishedAt: null, publishAt: null, cluster: null, coverage: 'ANSWERS' }))
  const order = seed.rowOrder ?? ((rows) => rows)
  const texts = {
    'intents.jsonl': jsonl(order(intents, 'intents')),
    'edges.jsonl': jsonl(order(builtEdges, 'edges')),
    'mappings.jsonl': jsonl(order(mappings, 'mappings')),
  }
  const snapshot = {
    [SNAPSHOT_NAMES.canonical]: jsonl(seed.intents.map((x) => ({
      intentId: x.intentId, answerScope: x.answerScope,
      evidenceRefs: (x.sourceRefs ?? ['fx-a.json']).map((r) => (typeof r === 'string'
        ? { seedQuery: '합성 질의', evidencePath: r.includes('/') ? r : `evidence/serpapi/${r}`, sourceKind: 'serpapi', invalidVerdict: null }
        : r)),
    }))),
    [SNAPSHOT_NAMES.automation]: jsonl(seed.intents.map((x) => ({ intentId: x.intentId, primaryQuery: x.primaryQuery }))),
    [SNAPSHOT_NAMES.graph]: jsonl(order(g5, 'g5')),
    [SNAPSHOT_NAMES.published]: jsonl(seed.articles.map((a) => ({ slug: a.slug }))),
    [SNAPSHOT_NAMES.queued]: jsonl(seed.queue.map((q) => ({ slug: q.slug }))),
  }
  const hI = sha16(texts['intents.jsonl']), hE = sha16(texts['edges.jsonl']), hM = sha16(texts['mappings.jsonl'])
  const combined = sha16(hI + hE + hM)
  const graphVersion = `g-${seed.effectiveDate}-${combined.slice(0, 6)}`
  const exportHash = sha16(`fx-export-${graphVersion}`)
  const graphFile = `// 합성 graph 판\nexport const GRAPH = { graphVersion: ${JSON.stringify(graphVersion)} } as const\n\n/** 런타임 대조 */\nexport const EXPORT_HASH = '${exportHash}'\n`
  const manifest = {
    schemaVersion: 'mgraph-build/1', graphVersion, effectiveAt: '2026-11-10T11:00:00+09:00', generatedAt: '2026-11-10T02:00:00.000Z',
    contentHash: { intents: hI, edges: hE, mappings: hM, combined }, semanticHash: sha16(`fx-semantic-${graphVersion}`), exportHash,
    inputHashes: Object.fromEntries(Object.entries(snapshot).map(([n, t]) => [n, sha256(t)])),
  }

  const researchDir = join(base, 'research'), productRoot = join(base, 'product'), snapshotDir = join(researchDir, 'reconciled', 'fx')
  const verDir = join(researchDir, 'contract', 'build', graphVersion)
  for (const [n, t] of Object.entries(texts)) put(join(verDir, n), t)
  put(join(verDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  put(join(verDir, 'readiness.json'), '{"derived":true,"note":"PRIVATE-READINESS"}\n')
  put(join(verDir, 'bundle', `${graphVersion}.ts`), graphFile)
  symlinkSync(graphVersion, join(researchDir, 'contract', 'build', 'current'))
  put(join(researchDir, 'contract', 'build', 'control.json'), `${JSON.stringify({ schemaVersion: 'control/1', graphVersion }, null, 2)}\n`)
  for (const [n, t] of Object.entries(snapshot)) put(join(snapshotDir, n), t)
  for (const [f, d] of Object.entries(seed.evidenceDocs)) put(join(researchDir, 'evidence', 'serpapi', f), `${JSON.stringify(evidenceDoc(d), null, 2)}\n`)

  const g = join(productRoot, 'src', 'content', 'magazine', 'graph')
  put(join(g, 'current.ts'), `// 합성 current\nexport { GRAPH, EXPORT_HASH } from './${graphVersion}'\n`)
  put(join(g, 'control.ts'), controlText(graphVersion, seed.control))
  put(join(g, `${graphVersion}.ts`), graphFile)
  put(join(productRoot, 'src', 'content', 'magazine', 'articles.ts'), articlesText(seed.articles))
  put(join(productRoot, 'drafts', 'magazine', 'topic-queue.ts'), queueText(seed.queue))
  return { base, researchDir, snapshotDir, productRoot, graphVersion, seed, texts }
}
