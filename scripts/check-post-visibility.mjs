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
    needs: ['COMMUNITY_VISIBLE_WHERE', 'DISCOVERY_ELIGIBLE_WHERE'],
    why: '게시판 목록·상세는 노출(§7-A), 홈 최신글은 discovery 제외(§7-C) 다',
  },
  {
    file: 'src/app/community/[boardSlug]/page.tsx',
    needs: ['robots'],
    why: 'board list 는 목록 카드에 Micro Seed 발췌가 실리므로 noindex 다',
  },
]

/**
 * 홈 "지금 올라온 이야기" 는 community list 가 아니라 discovery 표면이다.
 * 게시판을 열어 보는 것과, 서비스가 대표로 골라 첫 화면에 올리는 것은 다르다.
 * 홈이 커뮤니티 목록용 쿼리를 쓰면 Micro Seed 가 첫 화면으로 샌다.
 */
const HOME = {
  file: 'src/app/page.tsx',
  // 홈이 써야 하는 것 — discovery 게이트를 지나는 쿼리.
  //
  // getHomePopularPosts 는 순수 인기 목록(getPopularDiscoveryPosts) 위에
  // 홈 노출 예외를 한 겹 얹는 홈 전용 진입점이라 이름에 Discovery 가 없다.
  // 게이트를 우회하는 것이 아니다 — 아래 REQUIRED 가 posts.ts 에서
  // DISCOVERY_ELIGIBLE_WHERE 유지를 따로 강제하고, 1-d 가 그 예외를
  // getHomePopularPosts 안에서만 얹게 묶는다.
  mustMatch: /getHomePopularPosts\b|Discovery|DISCOVERY_ELIGIBLE_WHERE/,
  // 홈이 쓰면 안 되는 것 — 커뮤니티 노출용 쿼리
  mustNotMatch: /getRecentPosts\b|getPostsByBoard\b|COMMUNITY_VISIBLE_WHERE/,
}

/**
 * /best 는 순수 인기글 모아보기다.
 *
 * 홈 운영 큐레이션(PIN·HIDE)이 여기까지 따라오면 "베스트" 가 점수가 아니라
 * 운영자 선택이 된다. 실제로 그런 회귀가 났다 — 순수 점수 꼴찌 글을 홈에
 * 고정했더니 /best 2 번에 올라왔다. 두 화면은 같은 점수를 쓰되
 * 노출 예외 한 겹에서만 갈라진다.
 */
const BEST = {
  file: 'src/app/best/page.tsx',
  mustMatch: /getPopularDiscoveryPosts\b/,
  mustNotMatch: /getHomePopularPosts\b|applyHomeExposure\b|HomeExposureOverride\b|homeExposureOverride\b/,
}

/**
 * 홈 노출 예외를 얹는 유일한 지점.
 *
 * 규칙 함수(applyHomeExposure)는 여러 곳에서 부를 수 있으면 의미가 없다.
 * 부르는 곳이 늘어나는 순간 어떤 표면이 예외를 먹는지 이름으로 알 수 없게 된다.
 */
const HOME_EXPOSURE = {
  symbol: 'applyHomeExposure',
  rulesFile: 'src/lib/home-exposure-rules.ts',
  callerFile: 'src/lib/queries/posts.ts',
  callerFn: 'getHomePopularPosts',
}

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

  // 축 3 은 indexPromotionBlocked 를 반드시 반영해야 한다 (C-4).
  // 빠지면 "차단 플래그가 켜졌는데 추천에는 올라가는" 상태가 된다.
  const axis3 = gate.slice(
    gate.indexOf('export function isDiscoveryEligible'),
    gate.indexOf('export const DISCOVERY_ELIGIBLE_WHERE'),
  )
  if (!axis3.includes('indexPromotionBlocked')) {
    errors.push(
      'isDiscoveryEligible 이 indexPromotionBlocked 를 보지 않는다. ' +
        'write-path 차단 플래그가 추천 표면에서 무시된다 (C-4).',
    )
  }
  const whereBlock = gate.slice(gate.indexOf('export const DISCOVERY_ELIGIBLE_WHERE'))
  const whereBody = whereBlock.slice(0, whereBlock.indexOf('}') + 1)
  if (!whereBody.includes('indexPromotionBlocked')) {
    errors.push('DISCOVERY_ELIGIBLE_WHERE 가 indexPromotionBlocked: false 를 포함하지 않는다 (C-4).')
  }
  if (!/POST_VISIBILITY_SELECT[\s\S]{0,300}indexPromotionBlocked/.test(gate)) {
    errors.push(
      'POST_VISIBILITY_SELECT 가 indexPromotionBlocked 를 select 하지 않는다. ' +
        '판정 입력이 비어 런타임에서 조용히 false 로 취급된다.',
    )
  }
}

// ── 1-b. 홈이 discovery 게이트를 쓰는가 ──────────────────────────
{
  const abs = join(ROOT, HOME.file)
  if (existsSync(abs)) {
    const code = stripComments(readFileSync(abs, 'utf-8'))
    if (!HOME.mustMatch.test(code)) {
      errors.push(
        `${HOME.file} 가 discovery 게이트를 쓰지 않는다. ` +
          '홈 최신글은 community list 가 아니라 discovery 표면이다 (§7-C).',
      )
    }
    const leak = code.match(HOME.mustNotMatch)
    if (leak) {
      errors.push(
        `${HOME.file} 가 커뮤니티 노출용 ${leak[0]} 를 쓴다. ` +
          'Micro Seed 가 첫 화면으로 샌다.',
      )
    }
  }
}

// ── 1-c. /best 가 홈 큐레이션과 격리돼 있는가 ────────────────────
{
  const abs = join(ROOT, BEST.file)
  if (existsSync(abs)) {
    const code = stripComments(readFileSync(abs, 'utf-8'))
    if (!BEST.mustMatch.test(code)) {
      errors.push(
        `${BEST.file} 가 getPopularDiscoveryPosts 를 쓰지 않는다. ` +
          '베스트는 순수 인기 점수 목록이다.',
      )
    }
    const leak = code.match(BEST.mustNotMatch)
    if (leak) {
      errors.push(
        `${BEST.file} 가 홈 큐레이션용 ${leak[0]} 를 쓴다. ` +
          '홈 고정·숨김이 베스트 순서까지 바꾼다.',
      )
    }
  }
}

// ── 1-d. 홈 노출 예외를 얹는 곳이 하나뿐인가 ─────────────────────
{
  const { symbol, rulesFile, callerFile, callerFn } = HOME_EXPOSURE

  for (const abs of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, abs)
    if (rel === rulesFile || rel === callerFile) continue
    if (stripComments(readFileSync(abs, 'utf-8')).includes(symbol)) {
      errors.push(
        `${rel} 가 ${symbol} 를 쓴다. ` +
          `홈 노출 예외는 ${callerFile} 의 ${callerFn} 만 얹는다.`,
      )
    }
  }

  const abs = join(ROOT, callerFile)
  if (existsSync(abs)) {
    const code = stripComments(readFileSync(abs, 'utf-8'))
    const start = code.indexOf(`export async function ${callerFn}(`)
    if (start < 0) {
      errors.push(
        `${callerFile} 에 ${callerFn} 가 없다. ` +
          '홈 노출 예외의 단일 적용 지점이 사라졌다.',
      )
    } else {
      // 최상위 닫는 중괄호 = 함수 끝. 안쪽 블록은 들여쓰기돼 걸리지 않는다.
      const end = code.indexOf('\n}', start)
      for (let i = code.indexOf(`${symbol}(`); i >= 0; i = code.indexOf(`${symbol}(`, i + 1)) {
        if (i < start || (end >= 0 && i > end)) {
          errors.push(
            `${callerFile} 가 ${callerFn} 밖에서 ${symbol} 를 부른다. ` +
              '/best 같은 순수 목록이 홈 예외를 따라간다.',
          )
        }
      }
    }
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
