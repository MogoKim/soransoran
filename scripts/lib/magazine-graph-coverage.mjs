const FOOTER = new Set(['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'])
const RELATION_TYPES = new Set(['PREREQUISITE', 'NEXT_QUESTION', 'SIBLING', 'SERIES', 'BRIDGE', 'ACTION', 'COMMUNITY'])

const group = (rows, key) => {
  const out = new Map()
  for (const row of rows) {
    const value = row[key]
    if (!out.has(value)) out.set(value, [])
    out.get(value).push(row)
  }
  return out
}

const eligibleEdge = (edge) => edge?.active === true
  && Boolean(edge.slot)
  && FOOTER.has(edge.placement)
  && RELATION_TYPES.has(edge.type)
  && (edge.slot !== 'BRIDGE_DISCOVERY' || edge.type === 'BRIDGE')

/**
 * 공개 글과 현재 product bundle 사이의 결손을 근거별로 분류한다.
 * 이 함수는 시계·파일·환경을 읽지 않는다. 호출자가 한 번 만든 공개 스냅샷을 넘긴다.
 */
export function analyzeGraphCoverage({ publicArticles, allArticles, graph }) {
  if (!Array.isArray(publicArticles) || !Array.isArray(allArticles)) throw new TypeError('article 배열이 필요하다')
  if (!graph || !Array.isArray(graph.mappings) || !Array.isArray(graph.edges)) throw new TypeError('graph bundle이 필요하다')

  const mappingsBySlug = group(graph.mappings, 'slug')
  const mappingsByIntent = group(graph.mappings, 'intent')
  const edgesByFrom = group(graph.edges.filter(eligibleEdge), 'from')
  const publicSlugs = new Set(publicArticles.map((article) => article.slug))
  const allSlugs = new Set(allArticles.map((article) => article.slug))

  const rows = publicArticles.map((article) => {
    const sourceMappings = mappingsBySlug.get(article.slug) ?? []
    const base = {
      slug: article.slug,
      cluster: article.cluster,
      intents: sourceMappings.map((mapping) => mapping.intent).sort(),
      graphVersion: graph.graphVersion,
    }
    if (sourceMappings.length === 0) return { ...base, status: 'UNMAPPED', evidence: ['mapping 0'] }
    // 한 글이 여러 검색 질문을 대표하는 것은 product resolver가 지원하는 정상 구조다.
    const edges = sourceMappings.flatMap((mapping) => edgesByFrom.get(mapping.intent) ?? [])
    if (edges.length === 0) return { ...base, status: 'NO_ACTIVE_EDGE', evidence: ['eligible active outgoing edge 0'] }

    const targetMappings = edges.flatMap((edge) => (mappingsByIntent.get(edge.to) ?? []).map((mapping) => ({ edge, mapping })))
    if (targetMappings.length === 0) {
      return { ...base, status: 'TARGET_UNMAPPED', evidence: [`eligible edges ${edges.length}`, 'target mapping 0'] }
    }

    const publicTargets = [...new Set(targetMappings
      .map(({ mapping }) => mapping.slug)
      .filter((slug) => slug !== article.slug && publicSlugs.has(slug)))]
    if (publicTargets.length > 0) {
      return { ...base, status: 'READY', targets: publicTargets.sort(), evidence: [`public targets ${publicTargets.length}`] }
    }

    const unpublished = [...new Set(targetMappings.map(({ mapping }) => mapping.slug).filter((slug) => allSlugs.has(slug) && !publicSlugs.has(slug)))]
    if (unpublished.length > 0) {
      return { ...base, status: 'TARGET_UNPUBLISHED', targets: unpublished.sort(), evidence: [`unpublished targets ${unpublished.length}`] }
    }

    const stale = [...new Set(targetMappings.map(({ mapping }) => mapping.slug).filter((slug) => !allSlugs.has(slug)))]
    if (stale.length > 0) {
      return { ...base, status: 'STALE_TARGET_MAPPING', targets: stale.sort(), evidence: [`unknown target slugs ${stale.length}`] }
    }
    return { ...base, status: 'NO_USABLE_RESULT', evidence: ['targets are self or duplicate only'] }
  }).sort((a, b) => a.slug.localeCompare(b.slug))

  const sharedIntentMappings = [...mappingsByIntent.entries()]
    .filter(([, mappings]) => new Set(mappings.map((mapping) => mapping.slug)).size > 1)
    .map(([intent, mappings]) => ({ intent, slugs: [...new Set(mappings.map((mapping) => mapping.slug))].sort() }))
    .sort((a, b) => a.intent.localeCompare(b.intent))
  const multiIntentSlugs = [...mappingsBySlug.entries()]
    .filter(([, mappings]) => new Set(mappings.map((mapping) => mapping.intent)).size > 1)
    .map(([slug, mappings]) => ({ slug, intents: [...new Set(mappings.map((mapping) => mapping.intent))].sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
  const staleMappings = graph.mappings
    .filter((mapping) => !allSlugs.has(mapping.slug))
    .map((mapping) => ({ intent: mapping.intent, slug: mapping.slug }))
    .sort((a, b) => `${a.slug}/${a.intent}`.localeCompare(`${b.slug}/${b.intent}`))

  const counts = Object.fromEntries(
    [...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length]),
  )
  return {
    schemaVersion: 'magazine-graph-coverage/1',
    graphVersion: graph.graphVersion,
    publicArticleCount: publicArticles.length,
    counts,
    rows,
    mappingMultiplicity: { sharedIntentMappings, multiIntentSlugs },
    integrity: { staleMappings },
  }
}
