#!/usr/bin/env tsx

import { MAGAZINE_ARTICLES } from '../src/content/magazine/articles'
import { GRAPH } from '../src/content/magazine/graph/current'
import { getAllMagazineArticles } from '../src/lib/magazine'
import { analyzeGraphCoverage } from './lib/magazine-graph-coverage.mjs'

const nowArg = process.argv.find((arg) => arg.startsWith('--now='))?.slice('--now='.length)
const now = nowArg ? new Date(nowArg).getTime() : Date.now()
if (!Number.isFinite(now)) throw new TypeError(`--now가 유효한 ISO 시각이 아니다: ${nowArg}`)

const report = analyzeGraphCoverage({
  publicArticles: getAllMagazineArticles(now),
  allArticles: MAGAZINE_ARTICLES,
  graph: GRAPH,
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`M-GRAPH coverage · ${report.graphVersion} · public ${report.publicArticleCount}`)
  for (const [status, count] of Object.entries(report.counts)) console.log(`${status.padEnd(22)} ${count}`)
  console.log('')
  for (const row of report.rows.filter((item) => item.status !== 'READY')) {
    console.log(`${row.status.padEnd(22)} ${row.slug} · ${row.evidence.join(' · ')}`)
  }
  console.log('')
  console.log(`shared intent mappings ${report.mappingMultiplicity.sharedIntentMappings.length}`)
  console.log(`multi-intent slugs      ${report.mappingMultiplicity.multiIntentSlugs.length}`)
  console.log(`stale mappings          ${report.integrity.staleMappings.length}`)
}
