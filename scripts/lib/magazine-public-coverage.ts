import type { MagazineArticle } from '../../src/content/magazine/types'
import type { MagazineGraph } from '../../src/content/magazine/graph/types'
import { approvedOutgoingEdges, effectiveGraphMappings, runtimeReleaseBinding } from '../../src/lib/magazine-graph'
import { analyzeGraphCoverage } from './magazine-graph-coverage.mjs'

/** 독자 화면과 같은 출처·관계 판정을 적용한 뒤 해당 시각의 공개 글을 집계한다. */
export function analyzePublicGraphCoverage(publicArticles: MagazineArticle[], allArticles: MagazineArticle[], graph: MagazineGraph) {
  const binding = runtimeReleaseBinding(graph.graphVersion)
  const mappings = effectiveGraphMappings(graph, publicArticles, binding)
  const approved = approvedOutgoingEdges(graph.mappings, mappings, binding)
  const edges = approved.size === 0 ? graph.edges : graph.edges.map((edge) =>
    !edge.active && approved.get(edge.id) === edge.from ? { ...edge, active: true } : edge)
  return analyzeGraphCoverage({ publicArticles, allArticles, graph: { ...graph, mappings, edges } })
}
