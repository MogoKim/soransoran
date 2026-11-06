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
  // getHomePopularPosts 는 홈 인기 편성(composeHomePopularViews)의 모바일 결과를 돌려주는
  // 홈 전용 진입점이라 이름에 Discovery 가 없다.
  // 게이트를 우회하는 것이 아니다 — 아래 REQUIRED 가 posts.ts 에서
  // DISCOVERY_ELIGIBLE_WHERE 유지를 따로 강제하고, 1-d 가 그 예외를
  // home-popular-views.ts 의 composeHomePopularViews 안에서만 얹게 묶는다.
  mustMatch: /getHomePopularPosts\b|Discovery|DISCOVERY_ELIGIBLE_WHERE/,
  // 홈이 쓰면 안 되는 것 — 커뮤니티 노출용 쿼리
  mustNotMatch: /getRecentPosts\b|getPostsByBoard\b|COMMUNITY_VISIBLE_WHERE/,
}

/**
 * /best 는 입성 기준(W ≥ 2)을 처음 넘은 글을 최초 입성 최신순으로 쌓는 모아보기다.
 *
 * 홈 운영 큐레이션(PIN·HIDE)이 여기까지 따라오면 "베스트" 가 점수가 아니라
 * 운영자 선택이 된다. 실제로 그런 회귀가 났다 — 순수 점수 꼴찌 글을 홈에
 * 고정했더니 /best 2 번에 올라왔다.
 * 지금은 기준도 갈라졌다 — /best 는 queries/best.ts loadBestPage(best-ranking.ts 입성 기준)를,
 * 홈은 popularity.ts 점수를 쓴다. 홈 점수 함수가 여기로 새면 두 화면이 다시 섞인다.
 */
const BEST = {
  file: 'src/app/best/page.tsx',
  mustMatch: /loadBestPage\b/,
  // 🔴 페이지만 보면 queries/best.ts 를 거친 간접 우회를 놓친다 — 읽기 함수 파일도 같이 본다.
  isolatedFiles: ['src/app/best/page.tsx', 'src/lib/queries/best.ts'],
  // 🔴 모듈 경로(home-popular-views)도 막는다 — `import { x as y } from` 별칭이면 함수 이름이 코드에 남지 않는다.
  mustNotMatch:
    /getHomePopularPosts\b|getHomePopularViews\b|composeHomePopularViews\b|loadHomePopularInputs\b|applyHomeExposure\b|HomeExposureOverride\b|homeExposureOverride\b|pickHomePopular\b|pickBoardPopular\b|pickPopularByScore\b|home-popular-views\b/,
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
  callerFile: 'src/lib/home-popular-views.ts',
  // 모바일 한 줄 · 데스크톱 게시판별 열을 한 함수가 함께 만든다 — 호출은 여러 번이어도 자리는 하나다.
  callerFn: 'composeHomePopularViews',
  // 홈 후보 조회. 자동 후보와 PIN 글이 같은 discovery where 를 지나야 한다.
  loaderFn: 'loadHomePopularInputs',
}

/**
 * 홈 편성 모듈이 끌어오면 안 되는 것.
 * 🔴 검사·replay 가 이 모듈을 직접 import 한다. auth·next-auth·Next 가 들어오면 Next 전역 타입이
 *    ops 타입검사 전체로 번져 상관없는 스크립트가 깨지고, prisma 싱글톤이 들어오면 검사가 조회 수를 셀 수 없다.
 *    @prisma/client 는 `import type` 만 — 값 import 는 클라이언트를 새로 만들 길을 연다.
 */
const HOME_POPULAR_MODULE_BANNED = [
  { test: (spec) => /(^|\/)lib\/auth$|^\.{1,2}\/(\.\.\/)*auth$/.test(spec), why: 'auth(세션)' },
  { test: (spec) => /^next-auth(\/|$)/.test(spec), why: 'next-auth' },
  { test: (spec) => /^next(\/|$)/.test(spec), why: 'Next.js' },
  { test: (spec) => /(^|\/)lib\/prisma$|^\.{1,2}\/(\.\.\/)*prisma$/.test(spec), why: 'prisma 싱글톤' },
]

/**
 * 최상위 함수 선언의 본문 범위를 찾는다 — sync·async · 이름 뒤 TS 제네릭(`<T extends X>`)을 받는다.
 * 줄 머리의 선언만 센다 — 주석은 미리 지우고, 문장 중간의 같은 글자는 선언이 아니다.
 * 끝은 들여쓰기 없는 단독 `}` 줄이다. 인자 구조 분해의 `}: {` 는 끝이 아니다.
 * 선언이 없거나 둘 이상이면 null 범위와 개수를 돌려준다.
 */
function topLevelFunctionRange(code, name) {
  const decl = new RegExp(`^export (?:async )?function ${name}(?:<[^(]*>)?\\(`, 'gm')
  const starts = [...code.matchAll(decl)].map((m) => m.index)
  if (starts.length !== 1) return { count: starts.length, start: -1, end: -1 }
  const tail = /\n\}[ \t]*(?:\n|$)/.exec(code.slice(starts[0]))
  return { count: 1, start: starts[0], end: tail ? starts[0] + tail.index + 2 : code.length }
}

/**
 * 문자열 내용을 비운다 — 선언·호출을 셀 때 '…applyHomeExposure(…' 같은 글자를 코드로 오인하지 않게.
 * 모듈 경로를 봐야 하는 검사(import 경계 · /best 모듈 경로)에는 쓰지 않는다.
 */
function stripStrings(code) {
  return code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''")
}

function indicesOf(code, needle) {
  const out = []
  for (let i = code.indexOf(needle); i >= 0; i = code.indexOf(needle, i + 1)) out.push(i)
  return out
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
        `${BEST.file} 가 loadBestPage 를 쓰지 않는다. ` +
          '베스트는 입성 기록을 최초 입성 최신순으로 보여주는 목록이다.',
      )
    }
  }
  for (const file of BEST.isolatedFiles) {
    const path = join(ROOT, file)
    if (!existsSync(path)) continue
    const leak = stripComments(readFileSync(path, 'utf-8')).match(BEST.mustNotMatch)
    if (leak) {
      errors.push(
        `${file} 가 홈 큐레이션용 ${leak[0]} 를 쓴다. ` +
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
    if (stripStrings(stripComments(readFileSync(abs, 'utf-8'))).includes(symbol)) {
      errors.push(
        `${rel} 가 ${symbol} 를 쓴다. ` +
          `홈 노출 예외는 ${callerFile} 의 ${callerFn} 만 얹는다.`,
      )
    }
  }

  const abs = join(ROOT, callerFile)
  if (existsSync(abs)) {
    const code = stripComments(readFileSync(abs, 'utf-8'))
    const bare = stripStrings(code)
    const { count, start, end } = topLevelFunctionRange(bare, callerFn)
    if (count !== 1) {
      errors.push(
        `${callerFile} 에 ${callerFn} 선언이 ${count}개다(1개여야 한다). ` +
          '홈 노출 예외의 단일 적용 지점이 사라졌다.',
      )
    } else {
      const calls = indicesOf(bare, `${symbol}(`)
      const inside = calls.filter((i) => i > start && i < end)
      // 🔴 호출이 0개여도 "밖 호출 0" 은 참이다 — 안쪽 호출 ≥ 1 을 함께 요구해야 죽은 가드가 아니다.
      if (inside.length === 0) {
        errors.push(
          `${callerFile} 의 ${callerFn} 안에 ${symbol} 호출이 없다. ` +
            '홈 고정·숨김이 어느 결과에도 걸리지 않는다.',
        )
      }
      for (let n = calls.length - inside.length; n > 0; n -= 1) {
        errors.push(
          `${callerFile} 가 ${callerFn} 밖에서 ${symbol} 를 부른다. ` +
            '/best 같은 순수 목록이 홈 예외를 따라간다.',
        )
      }
    }

    // 모듈 경계 — import · export from · import() · require() 의 경로를 모두 본다
    const specs = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const spec of specs) {
      const hit = HOME_POPULAR_MODULE_BANNED.find((b) => b.test(spec))
      if (hit) errors.push(`${callerFile} 가 ${hit.why} 를 import 한다('${spec}'). 편성 모듈은 DB 를 인자로 받고 세션·Next 를 모른다.`)
    }
    // import 문을 하나씩 뗀다 — 세미콜론이 없는 코드라 한 정규식으로 훑으면 앞 import 부터 다음 줄까지 이어 붙는다
    for (const m of code.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm)) {
      if (m[2] === '@prisma/client' && !m[1]) {
        errors.push(`${callerFile} 가 @prisma/client 를 값으로 import 한다. 타입(import type)만 허용된다.`)
      }
    }

    // 홈 후보 조회 — 자동 후보와 PIN 글 두 where 모두 discovery 게이트를 지나야 한다.
    const loader = topLevelFunctionRange(bare, HOME_EXPOSURE.loaderFn)
    const gates = loader.count === 1
      ? indicesOf(bare.slice(loader.start, loader.end), '...DISCOVERY_ELIGIBLE_WHERE').length
      : 0
    if (gates < 2) {
      errors.push(
        `${callerFile} 의 ${HOME_EXPOSURE.loaderFn} 가 DISCOVERY_ELIGIBLE_WHERE 를 ${gates}곳에서만 쓴다(자동 후보·PIN 2곳). ` +
          'Micro Seed·비공개 글이 홈 인기로 샌다 (§7-C).',
      )
    }
  }
}

// ── 2. 표면이 게이트를 참조하는가 ────────────────────────────────
for (const { file, needs, why } of REQUIRED) {
  const abs = join(ROOT, file)
  if (!existsSync(abs)) continue // 미존재 표면은 도입 시 게이트 대상 — 여기서는 통과
  // 🔴 주석을 지우고 본다 — "이 게이트를 쓴다" 는 주석만 남기고 코드에서 빼도 통과하면 죽은 가드다.
  const src = stripComments(readFileSync(abs, 'utf-8'))
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
