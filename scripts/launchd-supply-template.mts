#!/usr/bin/env tsx
/**
 * 공급 job 템플릿 쓰기 — `--write` 면 파일을 다시 만들고, 없으면 같은지만 본다(exit 1 = 다르다)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { SUPPLY_TEMPLATE_PATH, renderSupplyTemplate } from './lib/supply-process-template.mjs'

const want = renderSupplyTemplate()
const got = existsSync(SUPPLY_TEMPLATE_PATH) ? readFileSync(SUPPLY_TEMPLATE_PATH, 'utf-8') : null
if (process.argv.includes('--write')) {
  writeFileSync(SUPPLY_TEMPLATE_PATH, want, 'utf-8')
  console.log(`▸ ${SUPPLY_TEMPLATE_PATH} 를 다시 만들었다${got === want ? ' (바뀐 것 없음)' : ''}`)
  process.exit(0)
}
console.log(got === want ? `🟢 ${SUPPLY_TEMPLATE_PATH} 가 생성 결과와 같다` : `🔴 ${SUPPLY_TEMPLATE_PATH} 가 생성 결과와 다르다 — --write 로 다시 만든다`)
process.exit(got === want ? 0 : 1)
