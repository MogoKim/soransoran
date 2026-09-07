#!/usr/bin/env node
/**
 * 리브랜딩 설정 가드
 *
 * 🔴 도메인·GA ID·검색 인증값이 정본 밖에 다시 흩어지는 것을 막는다.
 *    이 값들의 공통점은 **틀려도 에러가 나지 않는다**는 것이다 —
 *    GA host 가 옛 도메인이면 수집이 0 이 되고, 네이버 인증값이 옛것이면
 *    색인이 멈춘다. 둘 다 화면은 멀쩡해서 며칠 뒤 지표로 알아챈다.
 *    사람이 기억해서 막을 수 없는 종류라 CI 가 본다.
 *
 * 검사 범위는 좁게 유지한다:
 *   · 대상은 src 아래 .ts / .tsx 뿐이다. scripts · docs 는 보지 않는다.
 *   · admin(운영자 화면) · src/content(발행된 과거 콘텐츠)는 제외한다.
 *   · 주석은 보지 않는다 — TypeScript 파서로 문자열·JSX 만 훑는다.
 *
 * 🔴 비밀값은 검사 대상이 아니다. 이 스크립트는 값을 읽지도 출력하지도 않는다.
 *    manifest 의 secret 항목은 **이름만** 있는지 확인한다.
 *
 * ── 보장하지 못하는 것 ──
 *   · manifest 에 적지 않은 새 전환 대상은 찾지 못한다.
 *   · 외부 콘솔(카카오·GA·네이버·Vercel·DNS)의 실제 설정 상태를 읽지 못한다.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import {
  readManifest,
  readSymbolValues,
  resolveCurrentValues,
  valueTargets,
  validateLegacy,
  escapeRe,
} from './lib/rebrand-manifest-reader.mjs'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const CONFIG_FILE = 'src/lib/public-site-config.ts'
const MANIFEST_FILE = 'src/lib/rebrand-manifest.ts'

/**
 * 🔴 검사할 값을 **정본에서 읽는다.** 검사기 안에 현재 값을 복사해 두지 않는다.
 *
 *    복사해 두면 정본이 바뀐 뒤에도 가드는 옛 값만 찾는다 —
 *    새 도메인이 다시 흩어져도 조용히 통과한다.
 *
 * 🔴 그리고 **옛 값도 함께 검사한다.** 정본만 새 값으로 바꾸면 가드는
 *    새 값의 중복만 보고, 옛 도메인·옛 이름이 어딘가 남아 있어도 통과한다.
 *    옛 값 목록은 manifest 의 legacyValues 가 갖는다.
 */

/**
 * manifest 에서 검사 대상(현재 값 + 옛 값)을 만든다.
 *
 * current  정본(과 명시된 예외) 밖에 있으면 FAIL
 * legacy   legacyAllowed 밖 어디에 있어도 FAIL
 */
export function buildTargets(configs) {
  const out = []
  for (const c of configs) out.push(...valueTargets(c))
  return out.map((t) => ({ ...t, re: new RegExp(escapeRe(t.value), 'g') }))
}

/**
 * 형태 패턴 — 정본에도 legacy 에도 없는 **다른** 값이 새로 박히는 것을 잡는다.
 * (값이 아니라 모양을 보므로 정본이 바뀌어도 그대로 유효하다)
 */
export const SHAPE_PATTERNS = [
  {
    name: 'GA 측정 ID(형태)',
    re: /\bG-[A-Z0-9]{8,}\b/g,
    allowed: [CONFIG_FILE],
    fix: 'GA_MEASUREMENT_ID (src/lib/public-site-config.ts)',
  },
  {
    name: '검색 인증값(형태 · 40자 hex)',
    re: /\b[0-9a-f]{40}\b/g,
    allowed: [CONFIG_FILE],
    fix: 'NAVER_SITE_VERIFICATION (src/lib/public-site-config.ts)',
  },
]

const EXCLUDED_PREFIXES = ['src/app/admin/', 'src/components/admin/', 'src/content/']

function isExcluded(rel) {
  return EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))
}

/** .ts/.tsx 의 문자열·template·JSX 텍스트만 본다 (주석은 AST 노드가 아니라 자연히 빠진다) */
export function scanConfigLiterals(rel, text, targets, shapes = SHAPE_PATTERNS) {
  if (isExcluded(rel)) return []
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const hits = []
  const push = (node, name, hit, fix, kind) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    hits.push({ rel, line: line + 1, name, hit, fix, kind })
  }
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText: {
        const value = node.text ?? ''
        if (value) {
          for (const t of targets) {
            if (t.allowed.includes(rel)) continue
            for (const m of value.match(t.re) ?? []) {
              push(node, `${t.id} (${t.kind === 'legacy' ? '옛 값' : '현재 값'})`, m, t.fix, t.kind)
            }
          }
          for (const p of shapes) {
            if (p.allowed.includes(rel)) continue
            for (const m of value.match(p.re) ?? []) push(node, p.name, m, p.fix, 'shape')
          }
        }
        break
      }
      default:
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** ConfigOwner 는 노출 범위별로 나뉜다 — rebrand-manifest.ts 의 타입 주석 참조 */
const OWNERS = ['code', 'client-public-env', 'server-non-secret-env', 'public-identifier', 'secret-env', 'external-console']
const STEPS = ['decide', 'domain', 'external', 'code', 'cutover']
const POLICIES = ['change', 'review', 'keep']
const FIELDS = ['id', 'what', 'owner', 'policy', 'policyWhy', 'source', 'domainBound', 'secret', 'step', 'verify', 'rollback', 'risk']

/**
 * 필수 카테고리 — 하나라도 빠지면 전환 당일에 그 항목만 잊는다.
 * (실제로 잊기 쉬운 것들만 골랐다)
 */
const REQUIRED_IDS = [
  'primary-host',
  'tracked-hosts',
  'naver-site-verification',
  'next-public-app-url',
  'nextauth-url',
  'kakao-redirect-uri',
  'dns-vercel-domain',
  'old-domain-redirect',
  'contact-mailbox',
]

/** manifest 구조·중복·필수 항목 검사 */
export function validateManifest(configs) {
  const problems = []
  if (!configs.length) problems.push('REBRAND_CONFIGS 를 찾을 수 없거나 비어 있습니다')

  const seen = new Set()
  for (const c of configs) {
    for (const f of FIELDS) {
      if (c[f] === undefined) problems.push(`필드 누락: ${c.id ?? '(id 없음)'} 에 ${f} 가 없습니다`)
    }
    if (c.owner !== undefined && !OWNERS.includes(c.owner)) {
      problems.push(`알 수 없는 owner: ${c.id} → '${c.owner}'`)
    }
    if (c.step !== undefined && !STEPS.includes(c.step)) {
      problems.push(`알 수 없는 step: ${c.id} → '${c.step}'`)
    }
    if (c.policy !== undefined && !POLICIES.includes(c.policy)) {
      problems.push(`알 수 없는 policy: ${c.id} → '${c.policy}'`)
    }
    // 🔴 공개 식별자를 secret 으로 적지 않는다 — 분류가 흐려지면 취급 기준도 흐려진다
    if (c.owner === 'public-identifier' && c.secret === true) {
      problems.push(`public-identifier 는 secret 이 아니다: ${c.id}`)
    }
    if (seen.has(c.id)) problems.push(`id 중복: ${c.id}`)
    seen.add(c.id)
  }

  for (const id of REQUIRED_IDS) {
    if (!seen.has(id)) problems.push(`필수 설정 누락: ${id}`)
  }
  return problems
}

/**
 * manifest 의 source 가 실제와 맞는지 확인한다.
 *   owner=code        → 그 경로의 파일이 존재해야 한다
 *   owner=*-env       → 그 환경변수 이름이 .env.example 에 있어야 한다
 *   external-console  → 검사하지 않는다 (저장소 밖이다)
 *
 * 🔴 secret-env 도 **이름만** 본다. 값은 읽지 않는다.
 */
export function checkSources(configs, { fileExists, envNames }) {
  const problems = []
  for (const c of configs) {
    if (c.owner === 'code') {
      if (!fileExists(c.source)) problems.push(`코드 정본 없음: ${c.id} → ${c.source}`)
    } else if (
      c.owner === 'client-public-env' ||
      c.owner === 'server-non-secret-env' ||
      c.owner === 'public-identifier' ||
      c.owner === 'secret-env'
    ) {
      if (!envNames.has(c.source)) {
        problems.push(`.env.example 에 환경변수 이름이 없음: ${c.id} → ${c.source}`)
      }
    }
  }
  return problems
}

/** self-test — 파일을 만들지 않고 문자열만으로 검사기 자신을 확인한다 */
function selfTest() {
  const entry = (id) =>
    `{ id: '${id}', what: 'w', owner: 'code', policy: 'change', policyWhy: 'p', ` +
    `source: 'src/lib/public-site-config.ts', domainBound: true, secret: false, ` +
    `step: 'code', verify: 'v', rollback: 'r', risk: 'k' }`
  const wrap = (b) => `export const REBRAND_CONFIGS = [\n${b}\n] as const`
  const full = REQUIRED_IDS.map((i) => entry(i)).join(',\n')

  /**
   * 🔴 가짜 "리브랜딩 후" 상태를 만든다.
   *    정본은 새 값이고, 옛 값은 legacyValues 에 남아 있다.
   *    가드는 **둘 다** 잡아야 한다 — 새 값의 중복과 옛 값의 잔존.
   */
  const AFTER = [
    {
      id: 'primary-host',
      owner: 'code',
      source: 'src/lib/public-site-config.ts',
      symbol: 'PRIMARY_HOST',
      current: 'newbrand-future.test',
      legacyValues: ['oldbrand-past.test'],
      legacyAllowed: [{ path: 'src/lib/legacy-redirects.ts', why: '옛 링크 매핑' }],
      secret: false,
    },
    {
      id: 'brand-name',
      owner: 'code',
      source: 'src/lib/brand-name.ts',
      symbol: 'BRAND_NAME',
      current: '새이름',
      legacyValues: ['옛이름'],
      legacyAllowed: [],
      secret: false,
    },
    {
      id: 'contact-email',
      owner: 'code',
      source: 'src/lib/public-site-info.ts',
      symbol: 'CONTACT_EMAIL',
      current: 'new@example.test',
      legacyValues: ['old@example.test'],
      legacyAllowed: [],
      secret: false,
    },
  ]
  const AFTER_T = buildTargets(AFTER)
  const scanA = (rel, src) => scanConfigLiterals(rel, src, AFTER_T, [])

  // 지금(리브랜딩 전) 상태 — legacy 가 비어 있다
  const NOW = [
    {
      id: 'primary-host',
      owner: 'code',
      source: 'src/lib/public-site-config.ts',
      symbol: 'PRIMARY_HOST',
      current: 'example-now.test',
      legacyValues: [],
      legacyAllowed: [],
      secret: false,
    },
  ]
  const NOW_T = buildTargets(NOW)
  const scanN = (rel, src) => scanConfigLiterals(rel, src, NOW_T, [])

  const checks = [
    // ── 정본에서 값을 읽는가 ──
    ['정본에서 값을 읽는다', readSymbolValues("export const PRIMARY_HOST = 'x.test'").get('PRIMARY_HOST') === 'x.test'],
    ['현재 값 하드코딩을 잡는다', scanN('src/components/X.tsx', "const h = 'example-now.test'").length === 1],
    ['정본 파일은 허용', scanN(NOW[0].source, "export const PRIMARY_HOST = 'example-now.test'").length === 0],

    // ── 🔴 리브랜딩 후: 새 값 중복 + 옛 값 잔존을 모두 잡는가 ──
    ['정본 변경 후 새 도메인 중복을 잡는다', scanA('src/components/X.tsx', "const h = 'newbrand-future.test'").length === 1],
    ['정본 변경 후 옛 도메인 잔존을 잡는다', scanA('src/components/X.tsx', "const h = 'oldbrand-past.test'").length === 1],
    ['옛 서비스명 잔존을 잡는다', scanA('src/components/X.tsx', "const n = '옛이름'").length === 1],
    ['옛 이메일 잔존을 잡는다', scanA('src/app/x.tsx', "const c = 'old@example.test'").length === 1],
    ['새 서비스명 중복도 잡는다', scanA('src/components/X.tsx', "const n = '새이름'").length === 1],
    [
      '허용된 정확한 경로만 통과한다',
      scanA('src/lib/legacy-redirects.ts', "const old = 'oldbrand-past.test'").length === 0,
    ],
    [
      '허용 경로가 아니면 같은 옛 값도 잡는다',
      scanA('src/lib/other-file.ts', "const old = 'oldbrand-past.test'").length === 1,
    ],
    ['legacy 는 주석에서는 잡지 않는다', scanA('src/components/X.tsx', '// oldbrand-past.test 였다').length === 0],
    ['admin 은 제외', scanA('src/app/admin/x.tsx', "const h = 'oldbrand-past.test'").length === 0],

    // ── 형태 패턴은 정본과 무관하게 유효 ──
    [
      '형태 패턴은 다른 GA ID 도 잡는다',
      scanConfigLiterals('src/components/X.tsx', "const g = 'G-OTHER123'", []).length >= 1,
    ],

    // ── legacy 목록 무결성 ──
    ['정상 legacy 는 문제 0', validateLegacy(AFTER).length === 0],
    [
      'current 와 legacy 중복을 잡는다',
      validateLegacy([{ ...AFTER[0], legacyValues: ['newbrand-future.test'] }]).some((p) => p.includes('현재 값을 legacy')),
    ],
    [
      'legacy 안 중복을 잡는다',
      validateLegacy([{ ...AFTER[0], legacyValues: ['a.test', 'a.test'] }]).some((p) => p.includes('legacy 값 중복')),
    ],
    [
      '빈 legacy 값을 잡는다',
      validateLegacy([{ ...AFTER[0], legacyValues: ['  '] }]).some((p) => p.includes('빈 값')),
    ],
    [
      '비밀값 legacy 등록을 잡는다',
      validateLegacy([{ id: 'x', secret: true, legacyValues: ['whatever'], source: 'KAKAO_CLIENT_SECRET' }]).some((p) =>
        p.includes('비밀값은 legacy'),
      ),
    ],
    [
      '여러 항목에 같은 legacy 등록을 잡는다',
      validateLegacy([
        { id: 'a', legacyValues: ['dup.test'], secret: false },
        { id: 'b', legacyValues: ['dup.test'], secret: false },
      ]).some((p) => p.includes('여러 항목에 중복')),
    ],
    [
      'legacyAllowed 는 디렉터리를 열 수 없다',
      validateLegacy([{ ...AFTER[0], legacyAllowed: [{ path: 'src/lib/', why: 'w' }] }]).some((p) =>
        p.includes('디렉터리를 열지 않는다'),
      ),
    ],
    [
      'legacyAllowed 에 이유가 없으면 잡는다',
      validateLegacy([{ ...AFTER[0], legacyAllowed: [{ path: 'src/lib/x.ts' }] }]).some((p) =>
        p.includes('path 와 why'),
      ),
    ],

    // ── manifest 구조 ──
    ['필수 항목이 다 있으면 문제 0', validateManifest(readManifest(wrap(full))).length === 0],
    [
      '필수 항목 누락을 잡는다',
      validateManifest(readManifest(wrap(full.split(',\n').slice(1).join(',\n')))).some((p) => p.includes('필수 설정 누락')),
    ],
    ['id 중복을 잡는다', validateManifest(readManifest(wrap([full, entry('primary-host')].join(',\n')))).some((p) => p.includes('id 중복'))],
    [
      '알 수 없는 owner 를 잡는다',
      validateManifest(readManifest(wrap(`{ id: 'x', what: 'w', owner: 'nope', policy: 'change', policyWhy: 'p', source: 's', domainBound: true, secret: false, step: 'code', verify: 'v', rollback: 'r', risk: 'k' }`))).some((p) => p.includes('알 수 없는 owner')),
    ],
    [
      '알 수 없는 policy 를 잡는다',
      validateManifest(readManifest(wrap(`{ id: 'x', what: 'w', owner: 'code', policy: 'nope', policyWhy: 'p', source: 's', domainBound: true, secret: false, step: 'code', verify: 'v', rollback: 'r', risk: 'k' }`))).some((p) => p.includes('알 수 없는 policy')),
    ],
    [
      'public-identifier 를 secret 으로 적으면 잡는다',
      validateManifest(readManifest(wrap(`{ id: 'x', what: 'w', owner: 'public-identifier', policy: 'review', policyWhy: 'p', source: 'KAKAO_CLIENT_ID', domainBound: false, secret: true, step: 'external', verify: 'v', rollback: 'r', risk: 'k' }`))).some((p) => p.includes('public-identifier 는 secret 이 아니다')),
    ],
    ['필드 누락을 잡는다', validateManifest(readManifest(wrap(`{ id: 'x', what: 'w', owner: 'code' }`))).some((p) => p.includes('필드 누락'))],

    // ── source 대조 ──
    ['없는 코드 정본을 잡는다', checkSources([{ id: 'x', owner: 'code', source: 'src/lib/nope.ts' }], { fileExists: () => false, envNames: new Set() }).length === 1],
    ['없는 환경변수 이름을 잡는다', checkSources([{ id: 'x', owner: 'secret-env', source: 'NOPE_KEY' }], { fileExists: () => true, envNames: new Set(['OTHER']) }).length === 1],
    ['공개 식별자 env 도 이름을 확인한다', checkSources([{ id: 'x', owner: 'public-identifier', source: 'NOPE_KEY' }], { fileExists: () => true, envNames: new Set() }).length === 1],
    ['external-console 은 source 를 검사하지 않는다', checkSources([{ id: 'x', owner: 'external-console', source: '카카오 콘솔' }], { fileExists: () => false, envNames: new Set() }).length === 0],
  ]

  const failed = checks.filter(([, ok]) => !ok).map(([why]) => why)
  if (failed.length) {
    console.error('🔴 리브랜딩 설정 가드 self-test 실패 — 가드 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  return checks.length
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const selfTestCount = selfTest()

// ── manifest 읽기 ──
if (!existsSync(join(ROOT, MANIFEST_FILE))) {
  console.error(`리브랜딩 manifest 가 없습니다: ${MANIFEST_FILE}`)
  process.exit(1)
}
const rawConfigs = readManifest(readFileSync(join(ROOT, MANIFEST_FILE), 'utf8'))

// 🔴 "지금 값"은 정본 파일에서 읽는다. 검사기에 복사해 두지 않는다
const configs = resolveCurrentValues(rawConfigs, ROOT)

const structure = validateManifest(configs)
const legacyProblems = validateLegacy(configs)

// ── 1. 현재 값 중복 + 옛 값 잔존 ──
const targets = buildTargets(configs)
if (!configs.some((c) => c.id === 'primary-host' && c.current)) {
  console.error(`${CONFIG_FILE} 에서 PRIMARY_HOST 를 읽지 못했습니다`)
  process.exit(1)
}

const violations = []
for (const file of walk(SRC)) {
  violations.push(...scanConfigLiterals(relative(ROOT, file), readFileSync(file, 'utf8'), targets))
}

// ── 3. source 대조 (환경변수는 이름만) ──
const envNames = new Set(
  (existsSync(join(ROOT, '.env.example')) ? readFileSync(join(ROOT, '.env.example'), 'utf8') : '')
    .split('\n')
    .map((l) => /^([A-Z_0-9]+)=/.exec(l.trim())?.[1])
    .filter(Boolean),
)
const sources = checkSources(configs, {
  fileExists: (pth) => existsSync(join(ROOT, pth)),
  envNames,
})

let failed = false

if (violations.length) {
  console.error('도메인·분석·인증값이 정본 밖에서 발견되었습니다:\n')
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  [${v.name}] ${v.hit}  →  ${v.fix}`)
  console.error('')
  console.error('🔴 현재 값은 정본 밖에 복사되면 안 되고, 옛 값은 어디에도 남으면 안 됩니다.')
  console.error('   두 경우 다 에러를 내지 않습니다 — 수집이 0 이 되거나 옛 브랜드가 화면에 남습니다.')
  failed = true
}

if (legacyProblems.length) {
  console.error('\nlegacy 목록에 문제가 있습니다:\n')
  for (const p of legacyProblems) console.error(`  ${p}`)
  failed = true
}

if (structure.length) {
  console.error('\n리브랜딩 manifest 구조에 문제가 있습니다:\n')
  for (const p of structure) console.error(`  ${p}`)
  failed = true
}

if (sources.length) {
  console.error('\nmanifest 의 source 가 실제와 다릅니다:\n')
  for (const p of sources) console.error(`  ${p}`)
  failed = true
}

if (failed) process.exit(1)

const byOwner = new Map(OWNERS.map((o) => [o, 0]))
for (const c of configs) byOwner.set(c.owner, (byOwner.get(c.owner) ?? 0) + 1)
const byPolicy = new Map(POLICIES.map((x) => [x, 0]))
for (const c of configs) byPolicy.set(c.policy, (byPolicy.get(c.policy) ?? 0) + 1)

console.log(
  `리브랜딩 설정 가드 통과 — 정본 밖 하드코딩 0건 · manifest ${configs.length}건 (self-test ${selfTestCount}건 통과)`,
)
console.log('')
console.log('리브랜딩 정책별:')
for (const [x, n] of byPolicy) console.log(`  ${String(n).padStart(2)}  ${x}`)
console.log('')
console.log('소유·노출 범위별:')
for (const [o, n] of byOwner) console.log(`  ${String(n).padStart(2)}  ${o}`)
console.log(
  `  도메인 종속 ${configs.filter((c) => c.domainBound).length}건 · ` +
    `외부 콘솔 수동 ${configs.filter((c) => c.owner === 'external-console').length}건 · ` +
    `비밀(이름만 기록) ${configs.filter((c) => c.secret).length}건`,
)
const legacyTracked = configs.filter((c) => c.legacyValues !== undefined)
const legacyCount = legacyTracked.reduce((n, c) => n + (c.legacyValues?.length ?? 0), 0)
console.log('')
console.log(`옛 값 추적 — 추적 가능 ${legacyTracked.length}항목 · 등록된 옛 값 ${legacyCount}건`)
if (!legacyCount) {
  console.log('  아직 리브랜딩 전이라 비어 있다.')
  console.log('  🔴 정본을 바꾸기 **전에** 지금 값을 legacyValues 로 옮긴다 — 순서를 뒤집으면 옛 값이 남지 않는다.')
}
console.log('')
console.log('🔴 이 가드는 저장소 안만 본다 — 외부 콘솔의 실제 설정 상태는 사람이 확인해야 한다.')
