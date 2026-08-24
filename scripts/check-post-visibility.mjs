#!/usr/bin/env node
/**
 * Micro Seed 노출 게이트 가드
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §3 C-2 · §4-5 · §7
 *
 * C-2 단일 판정 계약:
 *   Post 를 화면·검색·추천에 내보내는 경로는 3축 판정 함수를 유일한 입력으로 쓴다.
 *   status · isMicroSeed · permanentNoindex 를 각 파일에서 직접 비교하지 않는다.
 *
 * 우나어 반례: 판정이 상세 metadata(하드코딩 비교) / sitemap(where 조각) /
 * 별도 모듈 세 곳으로 갈라졌고, 제외 조각 호출이 49곳 9파일로 확산됐다.
 * 한 곳을 고쳐도 나머지가 따라오지 않아 조용한 누수가 생겼다.
 *
 * 이 가드는 "표면 목록" 이 아니라 "판정 함수 미사용" 을 잡는다.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const GATE = 'src/lib/post-visibility.ts'

/** 게이트 자신은 당연히 필드를 직접 다룬다 — 유일한 예외다. */
const GATE_EXEMPT = new Set([GATE])

/** 각 표면이 반드시 참조해야 하는 심볼. 없으면 게이트를 우회한 것이다. */
const REQUIRED = [
  {
    file: 'src/app/sitemap.ts',
    needs: ['SEARCH_INDEXABLE_WHERE'],
    why: 'sitemap 은 색인 대상만 담는다 (§7-B)',
  },
  {
    file: 'src/app/community/[boardSlug]/[postId]/page.tsx',
    needs: ['robotsMetaFor', 'isSearchIndexable'],
    why: '상세는 접근 허용 + noindex 다. OG·canonical 도 색인 가부에 따른다 (§7-A)',
  },
  {
    file: 'src/lib/queries/posts.ts',
    needs: ['COMMUNITY_VISIBLE_WHERE'],
    why: '커뮤니티 목록·상세는 Micro Seed 가 보여야 하는 표면이다 (§7-A)',
  },
]

/** 게이트 밖에서 이 토큰을 직접 쓰면 판정이 갈라진다. */
const FORBIDDEN_DIRECT = [
  { token: 'isMicroSeed', hint: 'post-visibility 의 3축 함수 또는 WHERE 조각을 써라' },
  { token: 'permanentNoindex', hint: 'isSearchIndexable / SEARCH_INDEXABLE_WHERE 를 써라' },
  { token: 'indexPromotionBlocked', hint: 'write-path 차단은 게이트 함수를 경유한다 (C-4)' },
]

/**
 * 주석을 제거한다.
 * 게이트를 "쓰지 마라" 고 적은 주석까지 위반으로 잡으면 가드가 거짓말을 한다.
 * 문자열 리터럴 안의 // 는 이 단순 제거로 오탐할 수 있으나,
 * 이 가드가 보는 토큰(isMicroSeed 등)이 문자열로 등장할 일이 없어 실용상 충분하다.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const errors = []

// ── 1. 게이트 모듈이 존재하고 3축을 모두 내보내는가 ──────────────
if (!existsSync(join(ROOT, GATE))) {
  errors.push(`${GATE} 가 없다. 3축 판정의 단일 지점이 사라지면 계약이 성립하지 않는다.`)
} else {
  const gate = readFileSync(join(ROOT, GATE), 'utf-8')
  for (const fn of [
    'isCommunityVisible',
    'isSearchIndexable',
    'isDiscoveryEligible',
    'COMMUNITY_VISIBLE_WHERE',
    'SEARCH_INDEXABLE_WHERE',
    'DISCOVERY_ELIGIBLE_WHERE',
    'robotsMetaFor',
  ]) {
    if (!new RegExp(`export (function|const) ${fn}\\b`).test(gate)) {
      errors.push(`${GATE} 가 ${fn} 를 export 하지 않는다.`)
    }
  }
  // 축 1 은 isMicroSeed 를 보지 않아야 한다 — 보면 커뮤니티에서 숨겨진다.
  const axis1 = gate.slice(
    gate.indexOf('export function isCommunityVisible'),
    gate.indexOf('export const COMMUNITY_VISIBLE_WHERE'),
  )
  if (axis1.includes('isMicroSeed')) {
    errors.push(
      'isCommunityVisible 이 isMicroSeed 를 본다. ' +
        'Micro Seed 는 커뮤니티 목록·상세에 보여야 한다 (§2-0).',
    )
  }
  if (/COMMUNITY_VISIBLE_WHERE[\s\S]{0,200}isMicroSeed/.test(gate)) {
    errors.push('COMMUNITY_VISIBLE_WHERE 가 isMicroSeed 를 필터한다. 커뮤니티에서 숨기면 안 된다.')
  }
}

// ── 2. 표면이 게이트를 참조하는가 ────────────────────────────────
for (const { file, needs, why } of REQUIRED) {
  const abs = join(ROOT, file)
  if (!existsSync(abs)) continue // 미존재 표면은 도입 시 게이트 대상 — 여기서는 통과
  const src = readFileSync(abs, 'utf-8')
  for (const symbol of needs) {
    if (!src.includes(symbol)) {
      errors.push(`${file} 가 ${symbol} 를 쓰지 않는다. ${why}`)
    }
  }
}

// ── 3. 게이트 밖에서 플래그를 직접 비교하는가 ────────────────────
for (const abs of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, abs)
  if (GATE_EXEMPT.has(rel)) continue
  const code = stripComments(readFileSync(abs, 'utf-8'))
  for (const { token, hint } of FORBIDDEN_DIRECT) {
    if (code.includes(token)) {
      errors.push(`${rel} 가 ${token} 를 직접 다룬다. ${hint} (C-2)`)
    }
  }
}

if (errors.length) {
  console.error('\n❌ Micro Seed 노출 게이트 위반\n')
  for (const e of errors) console.error(`  · ${e}`)
  console.error(`\n총 ${errors.length}건. 정본 §3 C-2 · §4 · §7 을 확인하라.\n`)
  process.exit(1)
}

console.log('✅ Micro Seed 노출 게이트 통과 — 3축 판정이 단일 지점을 유지한다.')
