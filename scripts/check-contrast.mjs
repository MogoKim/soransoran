#!/usr/bin/env node
/**
 * 대비 검사 — 색을 바꿀 때 접근성이 조용히 무너지는 것을 막는다
 *
 * 🔴 리브랜딩에서 가장 위험한 실패는 "안 보이는 화면"이 아니라 "겨우 안 보이는 화면"이다.
 *    코랄을 조금 밝히면 화면은 그대로 뜨고 빌드도 통과하지만, 메타 글씨가 읽히지 않는다.
 *    사람 눈으로는 잘 안 잡히고, 잡힐 때는 이미 배포된 뒤다.
 *
 * 두 모드로 나눈다.
 *
 *   check:contrast          현재 디자인용. 이미 문서화된 예외를 명시적으로 안고 가되
 *                           **지금보다 나빠지면 실패**한다. CI 에 넣는 쪽이다.
 *
 *   check:contrast:rebrand  후보색 검증용. 예외를 하나도 인정하지 않고
 *                           아래 기준을 그대로 적용한다(WCAG + 내부 목표).
 *                           CI 에 넣지 않는다 — 새 색을 고를 때 사람이 돌려 보는 도구다.
 *
 * 🔴 예외는 좁게 적는다. "이 토큰은 봐준다"가 아니라 **이 조합만** 봐준다.
 *    조합을 넓게 적으면 다른 자리에서 같은 색이 미달인 것을 함께 놓친다.
 *
 * 🔴 요구 기준에는 두 종류가 있고 섞어 부르지 않는다.
 *      WCAG      본문 4.5:1 · 큰 글씨 3:1 · UI 경계 3:1 — 표준이 요구하는 값
 *      내부 목표 WCAG 가 요구하지 않지만 우리가 지키기로 한 값
 *                (로고·브랜드명은 WCAG 1.4.3 대비 요건에서 제외되지만 3:1 을 둔다)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { readCssTokens, resolve, contrast } from './lib/brand-color-tokens.mjs'

const ROOT = process.cwd()
const CSS = join(ROOT, 'src/app/globals.css')
const REBRAND = process.argv.includes('--rebrand')

/** WCAG 2.x 요구 기준 */
const REQ = {
  text: 4.5, // 본문
  large: 3.0, // 큰 글씨(18.66px+bold 또는 24px+)
  ui: 3.0, // UI 경계·포커스
}

/**
 * 검사 조합 — 실제 사용처를 확인해 만든 목록이다.
 *
 * bg 는 그 글자가 실제로 얹히는 면만 적는다. 쓰지 않는 조합을 넣으면
 * 통과시키려고 색을 흔들게 되고, 그건 화면과 무관한 제약이 된다.
 */
const COMBOS = [
  // ── 본문 계열 (4.5:1) ──
  { fg: '--text-primary', bgs: ['--surface-app', '--surface-card', '--surface-page', '--surface-soft'], req: 'text', why: '제목·본문' },
  { fg: '--text-secondary', bgs: ['--surface-app', '--surface-card', '--surface-page', '--surface-soft'], req: 'text', why: '미리보기·보조 문장' },
  { fg: '--text-muted', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: '메타(작성자·날짜)·disabled 라벨' },
  { fg: '--link', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: '본문 안 링크' },

  // ── 상태색 (4.5:1) — 오류·경고는 카드와 바탕 양쪽에서 뜬다 ──
  { fg: '--state-danger', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: 'role=alert 오류 문구·삭제 버튼' },
  { fg: '--state-warning', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: '글자수 임박 안내' },
  { fg: '--state-success', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: '완료 안내' },
  { fg: '--state-info', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'text', why: '정보 안내' },

  // ── 브랜드 텍스트 (4.5:1) — 배지가 연분홍 면 위에 앉는다 ──
  { fg: '--brand-strong', bgs: ['--surface-app', '--surface-card', '--surface-page', '--surface-soft'], req: 'text', why: '작은 글씨 브랜드 텍스트·매거진 배지' },

  // ── UI 경계 (3:1) ──
  { fg: '--border-interactive', bgs: ['--surface-card', '--surface-app', '--surface-page'], req: 'ui', why: '입력·선택 상태 테두리' },
  { fg: '--focus-ring', bgs: ['--surface-app', '--surface-card', '--surface-page'], req: 'ui', why: '키보드 포커스 링' },

  /**
   * ── 고객 primary CTA 내용 (3:1) ──
   *
   * 🔴 요구가 4.5 가 아니라 3.0 인 것은 낮춰 준 것이 아니라 **자리가 그렇기 때문**이다:
   *      아이콘   비텍스트 UI (WCAG 1.4.11)      요구 3.0
   *      라벨     큰 굵은 글씨 (18.66px + 700)   요구 3.0
   *    고객 CTA 는 text-lg(--text-title 20/24/28px) + font-bold 계약으로 고정해
   *    세 글자 크기 모드 전부 그 경계를 넘긴다. 크기가 조건을 만든다.
   *    그 계약은 아래 CTA_CONTRACT 검사가 지킨다 — 색만 검사하면 작은 CTA 가 빠져나간다.
   */
  { fg: '--cta-content', bgs: ['--cta'], req: 'large', why: '고객 primary CTA — 아이콘과 큰 굵은 라벨' },

  /**
   * ── admin compact CTA 글자 (4.5:1) ──
   *
   * 🔴 운영 콘솔 버튼은 13~14px 이라 큰 글씨가 아니다. 흰 글씨는 3.53 으로 미달하므로
   *    그쪽은 --text-primary 를 쓴다(4.65). 같은 면 위에서 기준이 갈리는 이유가 이것이다.
   */
  { fg: '--text-primary', bgs: ['--cta'], req: 'text', why: 'admin compact CTA 글자 — 작은 글씨라 본문 기준' },

  /**
   * ── 브랜드 원색 (3:1) — 아래 예외 참조 ──
   *
   * 🔴 standard: 'internal' — 이 3:1 은 WCAG 가 요구하는 값이 아니다.
   *    WCAG 1.4.3 은 로고·브랜드명(logotype)을 대비 요건에서 제외한다.
   *    그럼에도 3:1 을 두는 것은 **리브랜딩 때 지키기로 한 내부 품질 목표**다 —
   *    새 색을 고를 때 "로고니까 아무 색이나 된다"로 가지 않기 위한 하한선이다.
   */
  { fg: '--brand-ink', bgs: ['--surface-card', '--surface-app'], req: 'large', standard: 'internal', why: '브랜드 원색 — 워드마크 및 그 밖의 사용처' },

  /**
   * ── 워드마크 앞 조각 (3:1) ──
   *
   * 🔴 --brand-ink 만 검사하면 실제 로고 색을 놓친다.
   *    Logo.tsx 의 앞 조각은 `text-brand`(= --brand)를 쓴다. 지금은 --brand 와 --brand-ink 가
   *    같은 값이라 한쪽만 재도 결과가 같지만, **리브랜딩에서 둘이 갈라지는 순간**
   *    화면에 실제로 칠해지는 --brand 의 회귀를 아무도 잡지 못한다.
   *    같은 값일 때 미리 걸어 두는 것이 이 조합의 목적이다.
   *
   * 🔴 standard: 'internal' — WCAG 1.4.3 은 로고타입을 대비 요건에서 제외한다.
   *    그럼에도 3:1 을 두는 것은 --brand-ink 와 같은 이유의 내부 품질 목표다.
   */
  { fg: '--brand', bgs: ['--surface-card', '--surface-app'], req: 'large', standard: 'internal', why: '워드마크 앞 조각 — Logo.tsx 24px / weight 800' },
]

/**
 * 예외 — 조합 단위로만 적는다.
 *
 * 🔴 baseline 은 "지금 이 정도"라는 기록이다. 이 값보다 나빠지면 실패한다.
 *    통과시키려고 baseline 을 낮추지 않는다 — 낮추는 순간 이 목록은 의미가 없다.
 * 🔴 --rebrand 모드는 이 목록을 보지 않는다. 새 색은 예외 없이 기준을 넘어야 한다.
 *
 * 🔴 지금은 비어 있다. 웜 모노크롬 전환에서 세 예외가 모두 필요 없어졌다:
 *      --cta-text on --cta   2.72 → 5.49  (CTA 를 원색에서 진한 주황으로 바꿔 AA 통과)
 *      --brand-ink on card   2.72 → 3.53  (원색이 밝아져 큰 글씨 3:1 통과)
 *      --brand-ink on app    2.61 → 3.39  (같은 이유)
 *    기준을 낮춘 것이 아니라 색이 실제로 통과한다. 예외를 다시 늘리지 않는다.
 */
const EXCEPTIONS = []

/**
 * `text-brand-ink` 사용처 baseline — 어디에 원색을 쓰는지 이름으로 고정한다
 *
 * 🔴 토큰 값만 보면 "brand-ink 는 봐준다"가 되어, 앞으로 작은 글씨에
 *    text-brand-ink 를 새로 써도 CI 가 통과한다. 그래서 **사용처**를 고정한다.
 *
 *   LARGE_TEXT      WCAG 큰 글씨(18.66px+bold 또는 24px+)라 요구가 3:1 이고,
 *                   지금 원색이 카드 위 3.53:1 · 바탕 위 3.39:1 로 **실제로 통과한다.**
 *                   예외가 아니라 기준을 넘는 사용이다.
 *   BASELINE_DEBT   작은 글씨에 원색을 쓴 것. 4.5:1 을 넘지 못한다.
 *                   🔴 지금은 0 건이다 — 웜 모노크롬 전환에서 45 건을
 *                   --brand-strong(카드 위 5.49:1)으로 옮겼다.
 *
 * count 는 파일별 `text-brand-ink` 출현 횟수다(hover:·group-hover: 변형 포함).
 * 🔴 통과시키려고 count 를 올리지 않는다 — 올리는 순간 이 목록은 의미가 없다.
 * 🔴 새 사용을 추가할 때는 그 자리가 정말 큰 글씨인지 먼저 확인한다.
 *    작은 글씨라면 --brand-strong 을 쓴다.
 */
const BRAND_INK_USAGE = [
  /**
   * 🔴 워드마크는 2026-09-07 두 색 전환으로 이 목록에서 빠졌다.
   *    Logo.tsx 가 --brand-ink 대신 --brand(앞) · --brand-strong(뒤) 두 조각을 쓰고,
   *    error.tsx 는 직접 마크업을 버리고 Logo 를 쓴다.
   *    목록을 줄인 것이지 기준을 푼 것이 아니다 — 남은 두 자리는 그대로 큰 글씨다.
   */
  { file: 'src/components/features/CommentSection.tsx', count: 1, kind: 'LARGE_TEXT', note: 'text-lg(--text-title 20~28px) bold 안의 댓글 수' },
  { file: 'src/components/features/PostListItem.tsx', count: 1, kind: 'LARGE_TEXT', note: '고정 22px bold 순번. 읽는 글자가 아니라 자리표 장식이다' },
]

/**
 * `text-brand` 사용처 baseline — 원색을 **글자로** 쓰는 자리를 이름으로 고정한다
 *
 * 🔴 --brand 는 원래 비텍스트 전용이었다. 두 색 워드마크(2026-09-07 · 정본 §3-2-A)에서
 *    앞 조각이 처음 글자에 쓰였고, 그 자리는 24px / weight 800 이라 큰 글씨다.
 *    작은 글씨에 새로 쓰면 4.5:1 을 못 넘는다(3.53) — 그래서 여기 없는 파일은 실패한다.
 */
const BRAND_USAGE = [
  { file: 'src/components/brand/Logo.tsx', count: 1, kind: 'LARGE_TEXT', note: '두 색 워드마크 앞 조각. 24px 고정 / weight 800' },
]

/**
 * src 를 훑어 파일별 `text-brand-ink` 출현 횟수를 센다.
 *
 * 🔴 주석은 세지 않는다 — TypeScript 파서로 문자열·JSX 텍스트만 본다.
 *    (정규식으로 주석을 지우는 방식의 실패는 check-brand-literals.mjs 머리말 참조)
 * admin 은 리브랜딩 대상이 아니라 제외한다.
 */
const INK_CLASS = /text-brand-ink/g
/**
 * 🔴 `text-brand` 는 **정확히** 그 클래스만 센다.
 *
 *    /text-brand/ 로 두면 text-brand-ink · text-brand-strong · text-brand-soft 까지
 *    전부 걸려 숫자가 부풀고, 그러면 baseline 이 무슨 뜻인지 알 수 없게 된다.
 *    뒤에 [-\w] 가 오면 다른 클래스이므로 부정 전방탐색으로 끊는다.
 *    변형 접두사(hover: · group-hover:)는 앞에 붙으므로 그대로 잡힌다.
 */
const BRAND_CLASS = /text-brand(?![-\w])/g
const INK_EXCLUDED = ['src/app/admin/', 'src/components/admin/']

function walkSrc(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkSrc(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** 파일 하나에서 특정 클래스의 출현을 센다 — 주석은 파서가 알아서 뺀다 */
export function countClassInSource(rel, text, re) {
  if (INK_EXCLUDED.some((p) => rel.startsWith(p))) return 0
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let n = 0
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText:
        n += (node.text ?? '').match(re)?.length ?? 0
        break
      default:
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

export const countInkInSource = (rel, text) => countClassInSource(rel, text, INK_CLASS)
export const countBrandInSource = (rel, text) => countClassInSource(rel, text, BRAND_CLASS)

/**
 * 고객 primary CTA 계약 — 🔴 파일 단위가 아니라 **className 표현 단위**로 본다
 *
 * `--cta-content`(흰색)는 CTA 면 위 3.53:1 이라 **큰 굵은 글씨로만** 통과한다.
 * 그래서 색과 크기를 따로 두지 않고 한 덩어리로 검사한다:
 *
 *     bg-cta 가 있는 계약 단위에는 text-cta-content · text-lg · font-bold 가 함께 있어야 한다.
 *
 * 🔴 파일 단위로 세면 거짓 통과한다. 같은 파일에 온전한 CTA 가 하나 있으면
 *    그 파일의 다른 불완전한 CTA 를 가려 버린다:
 *
 *        const good = 'bg-cta text-cta-content text-lg font-bold'
 *        const bad  = 'bg-cta'                    ← 파일 단위 검사는 이걸 놓친다
 *
 *    그래서 className 표현 하나(=버튼 하나)를 계약 단위로 삼는다.
 *
 * 🔴 조건부 분기는 **공통 클래스와 합쳐서** 본다.
 *        cn('… text-lg font-bold', ready ? 'bg-cta text-cta-content' : 'bg-surface-page …')
 *    활성 분기만 떼어 보면 text-lg 가 없는 것처럼 보인다 — 실제로는 공통에 있다.
 *
 * 🔴 admin 은 제외한다. 운영 콘솔 버튼은 13~14px 이라 흰 글씨가 본문 4.5 에 미달하고
 *    --text-primary(4.65)를 쓴다. 고객 정책이 admin 으로 새지 않도록 경로로 가른다.
 * 🔴 ActionButton 은 여기서 보지 않는다 — compact 변형이 일부러 먹색이라
 *    이 계약과 다른 규칙을 쓴다. checkActionButton 이 따로 본다.
 */
const CTA_BG = /(^|\s)bg-cta(?![-\w])/
const HAS = (cls) => new RegExp(`(^|\\s)${cls}(?![-\\w])`)
const NEED = [
  { cls: 'text-cta-content', re: HAS('text-cta-content') },
  { cls: 'text-lg', re: HAS('text-lg') },
  { cls: 'font-bold', re: HAS('font-bold') },
]

/** ActionButton 은 자체 규칙으로 검사한다 — 아래 checkActionButton 참조 */
const CTA_CONTRACT_EXCLUDED = [...INK_EXCLUDED, 'src/components/ui/ActionButton.tsx']

/** size="compact" 를 쓸 수 있는 경로 — 좁은 운영 표 두 곳뿐이다 */
export const COMPACT_ALLOWED = [
  'src/components/admin/AdminPostEditForm.tsx',
  'src/components/admin/AdminCommentEditForm.tsx',
  // 운영자 직접 작성 — 좁은 운영 표와 같은 밀도다 (2026-09-17)
  'src/components/admin/OperatorComposeForm.tsx',
  'src/components/admin/OperatorComposedItemControls.tsx',
]

/**
 * className 표현 하나를 { common, branches } 로 푼다.
 *
 *   common    조건 없이 항상 붙는 클래스
 *   branches  조건부로 갈리는 클래스 (각각 common 과 합쳐 하나의 단위가 된다)
 *
 * 정적 const 를 참조하면(`className={CTA_CLASS}`) 그 initializer 를 따라간다.
 */
function resolveClasses(node, consts, depth = 0) {
  const empty = { common: '', branches: [] }
  if (!node || depth > 6) return empty
  const merge = (a, b) => ({
    common: `${a.common} ${b.common}`,
    branches: [...a.branches, ...b.branches],
  })
  switch (node.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return { common: node.text ?? '', branches: [] }
    case ts.SyntaxKind.JsxExpression:
      return resolveClasses(node.expression, consts, depth + 1)
    case ts.SyntaxKind.ParenthesizedExpression:
      return resolveClasses(node.expression, consts, depth + 1)
    case ts.SyntaxKind.TemplateExpression: {
      let out = { common: node.head.text ?? '', branches: [] }
      for (const span of node.templateSpans) {
        out = merge(out, resolveClasses(span.expression, consts, depth + 1))
        out = merge(out, { common: span.literal.text ?? '', branches: [] })
      }
      return out
    }
    case ts.SyntaxKind.BinaryExpression:
      if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return empty
      return merge(
        resolveClasses(node.left, consts, depth + 1),
        resolveClasses(node.right, consts, depth + 1),
      )
    case ts.SyntaxKind.ConditionalExpression: {
      // 두 분기를 각각 하나의 갈래로 남긴다 — 공통과는 나중에 합쳐진다
      const flat = (r) => (r.branches.length ? r.branches.map((b) => `${r.common} ${b}`) : [r.common])
      return {
        common: '',
        branches: [
          ...flat(resolveClasses(node.whenTrue, consts, depth + 1)),
          ...flat(resolveClasses(node.whenFalse, consts, depth + 1)),
        ],
      }
    }
    case ts.SyntaxKind.CallExpression: {
      const name = node.expression.getText?.() ?? ''
      if (!/^(cn|clsx|classNames|twMerge)$/.test(name)) return empty
      let out = empty
      for (const arg of node.arguments) out = merge(out, resolveClasses(arg, consts, depth + 1))
      return out
    }
    case ts.SyntaxKind.Identifier: {
      const init = consts.get(node.text)
      return init ? resolveClasses(init, consts, depth + 1) : empty
    }
    default:
      return empty
  }
}

/** { common, branches } 를 실제 검사 단위 문자열 배열로 편다 */
function toUnits(r) {
  return r.branches.length ? r.branches.map((b) => `${r.common} ${b}`) : [r.common]
}

function parse(rel, text) {
  return ts.createSourceFile(
    rel, text, ts.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

/**
 * 한 파일의 고객 CTA 계약 단위를 전부 검사한다.
 * 반환: null(대상 아님) 또는 { file, units, broken[] }
 */
export function checkCtaContract(rel, text) {
  if (CTA_CONTRACT_EXCLUDED.some((p) => rel.startsWith(p))) return null
  const sf = parse(rel, text)

  // 정적 const 사전 — className 이 참조할 수 있다
  const consts = new Map()
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      consts.set(n.name.text, n.initializer)
    }
    ts.forEachChild(n, collect)
  }
  collect(sf)

  /* 🔴 검사 단위는 **실제 JSX className 속성**이다. 화면에 버튼으로 나타나는 자리가 그것뿐이다.
        const 나 객체 속성 자체를 단위로 세면 같은 버튼이 두 번 잡히고,
        어디에도 쓰이지 않는 죽은 상수까지 화면인 것처럼 센다.
        className={CTA_CLASS} 처럼 상수를 참조하면 resolveClasses 가 initializer 를 따라간다.

     🔴 클래스 문자열이 같다고 접지 않는다. 같은 CTA_CLASS 를 버튼 두 개가 쓰면
        화면에 버튼이 둘 있는 것이고, 표현도 2개로 센다. */
  /* 🔴 단위는 className **속성 하나**(= 버튼 하나)다. 그 안의 조건 분기는 단위가 아니라
        같은 버튼의 상태이므로 variants 로 묶고, 계약은 분기마다 따로 본다.
        (FAB 은 접힘/펼침 두 분기를 갖지만 화면의 버튼은 하나다) */
  const units = []
  const visit = (n) => {
    if (ts.isJsxAttribute(n) && n.name.getText?.() === 'className' && n.initializer) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      const variants = toUnits(resolveClasses(n.initializer, consts))
        .map((u) => u.replace(/\s+/g, ' ').trim())
        .filter((u) => CTA_BG.test(` ${u} `))
      if (variants.length) units.push({ where: `className @ ${line}`, variants })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (!units.length) return null
  const broken = []
  for (const u of units) {
    for (const classes of u.variants) {
      const miss = NEED.filter((n) => !n.re.test(` ${classes} `)).map((n) => n.cls)
      if (miss.length) broken.push({ where: u.where, classes, miss })
    }
  }
  return { file: rel, units: units.length, broken }
}

/**
 * ActionButton 자체 검사 — 이 파일만 계약이 다르다
 *
 * 🔴 **있어야 할 것만 보면 거짓 통과한다.** 흰색과 먹색이 한 변형에 같이 있으면
 *    필수 클래스는 전부 갖췄지만 실제로 어느 색이 이기는지는 병합 순서에 달린다.
 *    그래서 **금지 클래스도 함께 본다.**
 *
 *   primary.default   ✅ bg-cta · text-cta-content · text-lg · font-bold  🚫 text-content-primary
 *   primary.compact   ✅ bg-cta · text-content-primary · font-bold        🚫 text-cta-content · text-lg
 *   danger.*          ✅ border-interactive · font-bold · text-state-danger  🚫 bg-cta · text-cta-content
 */
const ACTION_BUTTON_RULES = {
  'primary.default': {
    need: ['bg-cta', 'text-cta-content', 'text-lg', 'font-bold'],
    ban: ['text-content-primary'],
  },
  'primary.compact': {
    need: ['bg-cta', 'text-content-primary', 'font-bold'],
    ban: ['text-cta-content', 'text-lg'],
  },
  'danger.default': {
    need: ['border-interactive', 'font-bold', 'text-state-danger'],
    ban: ['bg-cta', 'text-cta-content'],
  },
  'danger.compact': {
    need: ['border-interactive', 'font-bold', 'text-state-danger'],
    ban: ['bg-cta', 'text-cta-content'],
  },
}

export function checkActionButton(text, rel = 'src/components/ui/ActionButton.tsx', rules = ACTION_BUTTON_RULES) {
  const sf = parse(rel, text)
  const consts = new Map()
  const found = {}
  const walk = (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      /^(primary|danger)$/.test(n.name.getText?.() ?? '') &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      const tone = n.name.getText()
      for (const prop of n.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        found[`${tone}.${prop.name.getText?.()}`] = toUnits(resolveClasses(prop.initializer, consts)).join(' ')
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  const fail = []
  for (const [key, rule] of Object.entries(rules)) {
    const got = found[key]
    if (got === undefined) {
      fail.push(`${key} 를 찾지 못했다`)
      continue
    }
    for (const c of rule.need) if (!HAS(c).test(` ${got} `)) fail.push(`${key} 에 ${c} 가 없다`)
    for (const c of rule.ban) if (HAS(c).test(` ${got} `)) fail.push(`🔴 ${key} 에 ${c} 가 있으면 안 된다`)
  }
  return fail
}

/**
 * **ActionButton** 의 `size="compact"` 사용처만 찾는다.
 *
 * 🔴 속성 이름만 보면 안 된다. `<Avatar size="compact">` 처럼 다른 컴포넌트도 같은 속성
 *    이름을 쓸 수 있고, 그건 CTA 대비와 아무 관계가 없다. 무관한 컴포넌트를 잡으면
 *    검사기가 남의 영역까지 막아 결국 꺼진다. **JSX 요소 이름이 ActionButton 인 것만** 센다.
 *
 * 반환: [{ line, tone }]
 */
export function findCompactUsage(rel, text) {
  const sf = parse(rel, text)
  const hits = []
  const attr = (attrs, name) => {
    for (const a of attrs.properties) {
      if (!ts.isJsxAttribute(a) || a.name.getText?.() !== name) continue
      const v = a.initializer
      if (v && ts.isStringLiteral(v)) return v.text
      if (v && ts.isJsxExpression(v) && v.expression && ts.isStringLiteral(v.expression)) return v.expression.text
      return null
    }
    return null
  }
  const visit = (n) => {
    if (
      (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
      n.tagName.getText?.() === 'ActionButton' &&
      attr(n.attributes, 'size') === 'compact'
    ) {
      hits.push({
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        tone: attr(n.attributes, 'tone'),
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/**
 * compact 사용처 전체를 허용 목록과 대조한다.
 *
 * 🔴 "허용 경로 밖이면 실패" 만으로는 반쪽이다. 허용 경로에서 사용이 **사라지거나 늘어도**
 *    목록이 현실과 어긋난 것이므로 실패한다 — 목록이 조용히 낡는 것을 막는다.
 * 🔴 허용된 두 자리는 tone="primary" 여야 한다. danger 는 면이 없어 밀도 예외가 필요 없다.
 *
 * found: Map<rel, hits[]>
 */
export function checkCompactUsage(found, { allowed = COMPACT_ALLOWED } = {}) {
  const fail = []
  for (const [rel, hits] of found) {
    if (allowed.includes(rel)) continue
    fail.push(`${rel}:${hits.map((h) => h.line).join(',')} — 허용되지 않은 경로의 ActionButton size="compact"`)
  }
  for (const rel of allowed) {
    const hits = found.get(rel) ?? []
    if (hits.length !== 1) {
      fail.push(`${rel} — compact 사용이 정확히 1건이어야 하는데 ${hits.length}건이다`)
      continue
    }
    if (hits[0].tone !== 'primary')
      fail.push(`${rel}:${hits[0].line} — tone 이 "primary" 여야 하는데 ${JSON.stringify(hits[0].tone)} 이다`)
  }
  return fail
}

/**
 * baseline 과 실제 사용을 대조한다.
 *
 *   미등록 파일에 사용   → 실패 (새 misuse)
 *   등록 파일이 증가     → 실패 (부채 증가)
 *   등록 파일이 감소·0   → 통과하되 baseline 정리를 요구 (알림)
 *   rebrand 모드         → BASELINE_DEBT 자체를 실패로 본다
 */
export function checkUsage(actual, { rebrand, usage = BRAND_INK_USAGE, className = 'text-brand-ink' } = {}) {
  const failures = []
  const cleanups = []
  const registered = new Map(usage.map((u) => [u.file, u]))

  for (const [file, count] of actual) {
    if (count === 0) continue
    const reg = registered.get(file)
    if (!reg) {
      failures.push({
        file,
        count,
        kind: 'NEW',
        msg: `등록되지 않은 새 ${className} 사용 ${count}건`,
      })
      continue
    }
    if (count > reg.count) {
      failures.push({
        file,
        count,
        kind: reg.kind,
        msg: `${className} 사용이 늘었습니다 (baseline ${reg.count} → ${count})`,
      })
    }
  }

  for (const u of usage) {
    const count = actual.get(u.file) ?? 0
    if (count < u.count) {
      cleanups.push({ ...u, actual: count })
    }
  }

  if (rebrand) {
    for (const u of usage) {
      if (u.kind !== 'BASELINE_DEBT') continue // LARGE_TEXT 는 기준을 실제로 통과한다
      const count = actual.get(u.file) ?? 0
      if (count > 0) {
        failures.push({
          file: u.file,
          count,
          kind: 'BASELINE_DEBT',
          msg: `비-로고 사용 ${count}건 — 새 색은 부채를 물려받지 않는다 (${u.note})`,
        })
      }
    }
  }

  return { failures, cleanups }
}

/** 기존 이름 유지 — 호출부와 self-test 가 그대로 쓴다 */
export const checkInkUsage = (actual, opts = {}) =>
  checkUsage(actual, { usage: BRAND_INK_USAGE, className: 'text-brand-ink', ...opts })

/** text-brand 전용 — 같은 규칙을 원색 글자 사용처에 적용한다 */
export const checkBrandUsage = (actual, opts = {}) =>
  checkUsage(actual, { usage: BRAND_USAGE, className: 'text-brand', ...opts })

function exceptionFor(fg, bg, list = EXCEPTIONS) {
  return list.find((e) => e.fg === fg && e.bg === bg)
}

/** 검사 본체. 토큰 Map 만 받으므로 self-test 가 그대로 쓴다 */
function run(tokens, { rebrand, exceptions = EXCEPTIONS, combos = COMBOS } = {}) {
  const rows = []
  const failures = []
  const missing = []

  for (const combo of combos) {
    const fgv = resolve(tokens, combo.fg)
    if (fgv === null) {
      missing.push(combo.fg)
      continue
    }
    for (const bg of combo.bgs) {
      const bgv = resolve(tokens, bg)
      if (bgv === null) {
        missing.push(bg)
        continue
      }
      const ratio = contrast(fgv, bgv)
      const required = REQ[combo.req]
      const ex = rebrand ? null : exceptionFor(combo.fg, bg, exceptions)

      let status
      if (ratio >= required) status = 'pass'
      else if (ex && ratio >= ex.baseline) status = 'exception'
      else status = 'fail'

      const row = { ...combo, bg, fgv, bgv, ratio, required, status, ex }
      rows.push(row)
      if (status === 'fail') failures.push(row)
    }
  }
  return { rows, failures, missing }
}

/** self-test — 파일을 만들지 않고 토큰 Map 만으로 검사기 자신을 확인한다 */
function selfTest() {
  /* 🔴 실제 ActionButton.tsx 를 읽지 않는다. 그 파일이 바뀌면 self-test 가 함께 흔들려
        검사기 고장과 소스 변경을 구분할 수 없다. 규칙을 지키는 가짜 소스를 여기서 만든다. */
  const OK_ACTION_BUTTON =
    "const T = { " +
    "primary: { default: 'bg-cta text-lg font-bold text-cta-content', compact: 'bg-cta font-bold text-content-primary' }, " +
    "danger: { default: 'border border-interactive font-bold text-state-danger', compact: 'border border-interactive font-bold text-state-danger' } }"

  const checks = [
    ['흰 배경 검정 글씨는 21:1', contrast('#000000', '#ffffff') === 21],
    ['같은 색은 1:1', contrast('#ff6f61', '#ff6f61') === 1],
    ['#abc 단축형도 계산된다', contrast('#fff', '#000') === 21],
    [
      '기준 미달을 잡는다',
      run(new Map([['--text-muted', '#cccccc'], ['--surface-card', '#ffffff'], ['--surface-app', '#ffffff'], ['--surface-page', '#ffffff']]), {
        rebrand: true,
      }).failures.length > 0,
    ],
    // 🔴 예외 로직은 **가짜 목록**으로 검증한다. 실제 EXCEPTIONS 에 의존하면
    //    예외가 0 이 되는 순간(=색이 실제로 통과) 검사기 자신의 테스트가 깨진다.
    (() => {
      const C = [{ fg: '--x', bgs: ['--bg'], req: 'text', why: 't' }]
      const E = [{ fg: '--x', bg: '--bg', baseline: 2.72, why: 't' }]
      const T = (fg) => new Map([['--x', fg], ['--bg', '#ffffff']])
      return [
        'rebrand 모드는 예외를 인정하지 않는다',
        run(T('#ff6f61'), { rebrand: true, exceptions: E, combos: C }).failures.length === 1,
      ]
    })(),
    (() => {
      const C = [{ fg: '--x', bgs: ['--bg'], req: 'text', why: 't' }]
      const E = [{ fg: '--x', bg: '--bg', baseline: 2.72, why: 't' }]
      const T = (fg) => new Map([['--x', fg], ['--bg', '#ffffff']])
      return [
        '기본 모드는 baseline 이상이면 예외로 통과',
        run(T('#ff6f61'), { rebrand: false, exceptions: E, combos: C }).rows.some((r) => r.status === 'exception'),
      ]
    })(),
    (() => {
      const C = [{ fg: '--x', bgs: ['--bg'], req: 'text', why: 't' }]
      const E = [{ fg: '--x', bg: '--bg', baseline: 2.72, why: 't' }]
      const T = (fg) => new Map([['--x', fg], ['--bg', '#ffffff']])
      return [
        '예외라도 baseline 보다 나빠지면 실패',
        run(T('#ff8f81'), { rebrand: false, exceptions: E, combos: C }).failures.length === 1,
      ]
    })(),
    ['지금 EXCEPTIONS 는 비어 있다 (색이 실제로 통과한다)', EXCEPTIONS.length === 0],

    // ── text-brand-ink 사용처 baseline ──
    [
      '주석의 text-brand-ink 는 세지 않는다',
      countInkInSource('src/x.tsx', '// text-brand-ink 는 브랜드 원색\n/* text-brand-ink */') === 0,
    ],
    [
      '문자열·JSX 의 text-brand-ink 를 센다',
      countInkInSource('src/x.tsx', "const a = 'text-brand-ink'; const b = <p className=\"hover:text-brand-ink\" />") === 2,
    ],
    ['admin 은 세지 않는다', countInkInSource('src/app/admin/x.tsx', "const a = 'text-brand-ink'") === 0],
    // 사용처 baseline 도 가짜 목록으로 검증한다
    (() => {
      const U = [
        { file: 'a/big.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' },
        { file: 'a/small.tsx', count: 2, kind: 'BASELINE_DEBT', note: 'n' },
      ]
      return ['등록되지 않은 새 사용을 잡는다',
        checkInkUsage(new Map([['a/new.tsx', 1]]), { rebrand: false, usage: U }).failures.some((f) => f.kind === 'NEW')]
    })(),
    (() => {
      const U = [{ file: 'a/big.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['등록 파일이라도 사용이 늘면 잡는다',
        checkInkUsage(new Map([['a/big.tsx', 2]]), { rebrand: false, usage: U }).failures.length === 1]
    })(),
    (() => {
      const U = [{ file: 'a/big.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['baseline 그대로면 통과',
        checkInkUsage(new Map([['a/big.tsx', 1]]), { rebrand: false, usage: U }).failures.length === 0]
    })(),
    (() => {
      const U = [{ file: 'a/big.tsx', count: 2, kind: 'LARGE_TEXT', note: 'n' }]
      const r = checkInkUsage(new Map([['a/big.tsx', 1]]), { rebrand: false, usage: U })
      return ['사용이 줄면 실패가 아니라 정리 요구', r.failures.length === 0 && r.cleanups.length > 0]
    })(),
    (() => {
      const U = [{ file: 'a/small.tsx', count: 2, kind: 'BASELINE_DEBT', note: 'n' }]
      return ['rebrand 모드는 BASELINE_DEBT 를 허용하지 않는다',
        checkInkUsage(new Map([['a/small.tsx', 2]]), { rebrand: true, usage: U }).failures.some((f) => f.kind === 'BASELINE_DEBT')]
    })(),
    (() => {
      const U = [{ file: 'a/big.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['rebrand 모드에서도 LARGE_TEXT 는 통과',
        checkInkUsage(new Map([['a/big.tsx', 1]]), { rebrand: true, usage: U }).failures.length === 0]
    })(),
    ['지금 BASELINE_DEBT 는 0 건이다', BRAND_INK_USAGE.every((u) => u.kind !== 'BASELINE_DEBT')],

    // ── text-brand 사용처 baseline (원색을 글자로 쓰는 자리) ──
    [
      'text-brand 를 정확히 센다',
      countBrandInSource('src/x.tsx', "const a = 'text-brand'; const b = <p className=\"group-hover:text-brand\" />") === 2,
    ],
    [
      '🔴 text-brand-ink · text-brand-strong 을 text-brand 로 오인하지 않는다',
      countBrandInSource('src/x.tsx', "const a = 'text-brand-ink text-brand-strong text-brand-soft text-brand-muted'") === 0,
    ],
    [
      'bg-brand · border-brand 는 text-brand 가 아니다',
      countBrandInSource('src/x.tsx', "const a = 'bg-brand border-brand shadow-brand'") === 0,
    ],
    ['주석의 text-brand 는 세지 않는다', countBrandInSource('src/x.tsx', '// text-brand 는 원색\n/* text-brand */') === 0],
    ['admin 의 text-brand 는 세지 않는다', countBrandInSource('src/app/admin/x.tsx', "const a = 'text-brand'") === 0],
    (() => {
      const U = [{ file: 'a/logo.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['등록되지 않은 새 text-brand 사용을 잡는다',
        checkBrandUsage(new Map([['a/other.tsx', 1]]), { rebrand: false, usage: U }).failures.some((f) => f.kind === 'NEW')]
    })(),
    (() => {
      const U = [{ file: 'a/logo.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['등록 파일이라도 text-brand 사용이 늘면 잡는다',
        checkBrandUsage(new Map([['a/logo.tsx', 2]]), { rebrand: false, usage: U }).failures.length === 1]
    })(),
    (() => {
      const U = [{ file: 'a/logo.tsx', count: 1, kind: 'LARGE_TEXT', note: 'n' }]
      return ['rebrand 모드에서도 LARGE_TEXT 는 통과',
        checkBrandUsage(new Map([['a/logo.tsx', 1]]), { rebrand: true, usage: U }).failures.length === 0]
    })(),
    (() => {
      const U = [{ file: 'a/logo.tsx', count: 2, kind: 'LARGE_TEXT', note: 'n' }]
      const r = checkBrandUsage(new Map([['a/logo.tsx', 1]]), { rebrand: false, usage: U })
      return ['text-brand 사용이 줄면 실패가 아니라 정리 요구', r.failures.length === 0 && r.cleanups.length > 0]
    })(),
    ['지금 BRAND_USAGE 는 LARGE_TEXT 뿐이다', BRAND_USAGE.every((u) => u.kind === 'LARGE_TEXT')],

    // ── 고객 primary CTA 계약 (className 표현 단위) ──
    (() => {
      const src = "const a = <p className='bg-cta text-cta-content text-lg font-bold' />"
      return ['계약을 다 갖춘 단위는 통과', checkCtaContract('src/x.tsx', src).broken.length === 0]
    })(),
    (() => {
      // 🔴 파일 단위 검사가 놓치던 반례
      const src = "const a = <a className='bg-cta text-cta-content text-lg font-bold' />\nconst b = <b className='bg-cta' />"
      const r = checkCtaContract('src/x.tsx', src)
      return [
        '🔴 같은 파일의 온전한 CTA 가 불완전한 CTA 를 가리지 못한다',
        r.units === 2 && r.broken.length === 1 && r.broken[0].miss.length === 3,
      ]
    })(),
    (() => {
      // 🔴 같은 상수를 쓰는 버튼 둘은 버튼 둘이다 — 문자열이 같다고 접지 않는다
      const src =
        "const CTA = 'bg-cta text-cta-content text-lg font-bold'\n" +
        'const a = <button className={CTA} />\nconst b = <button className={CTA} />'
      const r = checkCtaContract('src/x.tsx', src)
      return ['🔴 같은 CTA_CLASS 를 쓰는 JSX 두 개는 2단위로 센다', r.units === 2 && r.broken.length === 0]
    })(),
    (() => {
      // 🔴 한 버튼의 조건 분기는 단위가 아니라 같은 버튼의 상태다 (FAB 형)
      const src =
        "const a = <a className={cn('bg-cta text-lg font-bold text-cta-content', open ? 'px-6' : 'px-0')} />"
      const r = checkCtaContract('src/x.tsx', src)
      return ['🔴 한 className 의 조건 분기는 1단위로 센다', r.units === 1 && r.broken.length === 0]
    })(),
    (() => {
      // 분기 중 하나만 계약을 어겨도 잡는다
      const src =
        "const a = <a className={cn('text-lg font-bold', on ? 'bg-cta text-cta-content' : 'bg-cta')} />"
      const r = checkCtaContract('src/x.tsx', src)
      return ['🔴 분기 하나만 어겨도 잡는다', r.units === 1 && r.broken.length === 1]
    })(),
    (() => {
      // 🔴 JSX 가 아닌 const·객체 속성은 단위가 아니다 (ActionButton tone map 이 그 예)
      const src = "const T = { primary: { default: 'bg-cta text-cta-content text-lg font-bold' } }"
      return ['🔴 JSX className 이 아닌 const·객체 속성은 세지 않는다', checkCtaContract('src/x.tsx', src) === null]
    })(),
    (() => {
      // 다른 요소의 text-lg/font-bold 가 구제하면 안 된다
      const src = "const a = <div className='text-lg font-bold' />\nconst b = <button className='bg-cta text-cta-content' />"
      const r = checkCtaContract('src/x.tsx', src)
      return [
        '🔴 다른 요소의 text-lg·font-bold 는 CTA 를 구제하지 못한다',
        r.broken.length === 1 && r.broken[0].miss.join() === 'text-lg,font-bold',
      ]
    })(),
    (() => {
      // cn 공통 + 조건부 활성 분기
      const src = "const a = <span className={cn('h-[52px] text-lg font-bold', ready ? 'bg-cta text-cta-content' : 'bg-surface-page text-content-muted')} />"
      return ['cn 공통 클래스 + 조건부 활성 분기는 통과', checkCtaContract('src/x.tsx', src).broken.length === 0]
    })(),
    (() => {
      const src = "const CTA = 'bg-cta text-cta-content text-lg font-bold'\nconst a = <a className={CTA} />"
      return ['정적 const 를 참조하는 className 도 해석한다', checkCtaContract('src/x.tsx', src).broken.length === 0]
    })(),
    (() => {
      const src = "const a = <a className={`${TOUCH_MIN} bg-cta px-6 text-lg font-bold text-cta-content`} />"
      return ['템플릿 리터럴 단위도 해석한다', checkCtaContract('src/x.tsx', src).broken.length === 0]
    })(),
    [
      'bg-cta 가 없으면 검사 대상이 아니다',
      checkCtaContract('src/x.tsx', "const a = <a className='text-lg font-bold' />") === null,
    ],
    [
      '🔴 bg-cta-edge 를 bg-cta 로 오인하지 않는다',
      checkCtaContract('src/x.tsx', "const a = <a className='bg-cta-edge' />") === null,
    ],
    [
      '주석의 bg-cta 는 세지 않는다',
      checkCtaContract('src/x.tsx', '// bg-cta 는 CTA 면이다\n/* bg-cta text-lg */') === null,
    ],
    [
      'admin 직접 CTA 는 계약에서 제외한다',
      checkCtaContract('src/components/admin/x.tsx', "const a = <a className='bg-cta' />") === null,
    ],
    [
      'ActionButton 은 자체 규칙으로 보므로 이 계약에서 제외한다',
      checkCtaContract('src/components/ui/ActionButton.tsx', "const a = <a className='bg-cta' />") === null,
    ],

    // ── ActionButton 자체 계약 (필수 + 금지) ──
    (() => {
      const src = OK_ACTION_BUTTON
      return ['ActionButton 4변형이 규칙을 지키면 통과', checkActionButton(src).length === 0]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace(' text-lg', '')
      return ['🔴 primary.default 에 text-lg 가 없으면 잡는다', checkActionButton(src).some((f) => /primary\.default 에 text-lg/.test(f))]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace("compact: 'bg-cta font-bold text-content-primary'", "compact: 'bg-cta font-bold text-cta-content'")
      return ['🔴 primary.compact 가 흰색을 쓰면 잡는다', checkActionButton(src).length > 0]
    })(),
    (() => {
      // 🔴 필수만 보던 시절의 거짓 통과 — 흰색과 먹색이 같이 있어도 통과했다
      const src = OK_ACTION_BUTTON.replace(
        "default: 'bg-cta text-lg font-bold text-cta-content'",
        "default: 'bg-cta text-lg font-bold text-cta-content text-content-primary'",
      )
      return [
        '🔴 primary.default 에 흰색+먹색이 함께 있으면 잡는다',
        checkActionButton(src).some((f) => /primary\.default 에 text-content-primary 가 있으면/.test(f)),
      ]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace(
        "compact: 'bg-cta font-bold text-content-primary'",
        "compact: 'bg-cta text-lg font-bold text-content-primary'",
      )
      return ['🔴 primary.compact 에 text-lg 가 붙으면 잡는다', checkActionButton(src).some((f) => /primary\.compact 에 text-lg 가 있으면/.test(f))]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace(
        "default: 'border border-interactive font-bold text-state-danger'",
        "default: 'bg-cta border border-interactive font-bold text-state-danger'",
      )
      return ['🔴 danger 에 bg-cta 가 들어오면 잡는다', checkActionButton(src).some((f) => /danger\.default 에 bg-cta 가 있으면/.test(f))]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace(
        "compact: 'border border-interactive font-bold text-state-danger'",
        "compact: 'border border-interactive font-bold text-state-danger text-cta-content'",
      )
      return ['🔴 danger.compact 에 흰색이 들어오면 잡는다', checkActionButton(src).some((f) => /danger\.compact 에 text-cta-content 가 있으면/.test(f))]
    })(),
    (() => {
      const src = OK_ACTION_BUTTON.replace("border border-interactive font-bold text-state-danger'", "border border-interactive font-bold'")
      return ['🔴 danger 에서 text-state-danger 가 빠지면 잡는다', checkActionButton(src).some((f) => /danger.*text-state-danger 가 없다/.test(f))]
    })(),

    // ── ActionButton size="compact" 사용처 ──
    [
      '🔴 다른 컴포넌트의 size="compact" 는 검사 대상이 아니다',
      findCompactUsage('src/x.tsx', '<Avatar size="compact" />').length === 0,
    ],
    [
      '🔴 일반 요소의 size="compact" 도 검사 대상이 아니다',
      findCompactUsage('src/x.tsx', '<div size="compact" />').length === 0,
    ],
    [
      'ActionButton 의 compact 만 잡는다 (tone 도 함께 읽는다)',
      (() => {
        const h = findCompactUsage('src/x.tsx', '<ActionButton tone="primary" size="compact" />')
        return h.length === 1 && h[0].tone === 'primary'
      })(),
    ],
    [
      'size 가 compact 가 아니면 잡지 않는다',
      findCompactUsage('src/x.tsx', '<ActionButton tone="primary" size="default" />').length === 0,
    ],
    [
      '허용 경로는 전부 운영 컴포넌트다',
      // 🔴 개수를 못박지 않는다. 운영 화면이 하나 늘 때마다 self-test 가 깨지면
      //    사람이 검사기를 고치는 대신 숫자를 올리게 된다 — 지켜야 할 것은
      //    "몇 개인가" 가 아니라 **"고객 경로가 섞이지 않았는가"** 다.
      COMPACT_ALLOWED.length > 0 && COMPACT_ALLOWED.every((f) => f.startsWith('src/components/admin/')),
    ],
    [
      '허용된 운영 경로가 각 1건 primary 면 통과',
      checkCompactUsage(new Map(COMPACT_ALLOWED.map((f) => [f, [{ line: 1, tone: 'primary' }]]))).length === 0,
    ],
    [
      '🔴 고객 경로의 ActionButton compact 는 실패한다',
      (() => {
        const m = new Map(COMPACT_ALLOWED.map((f) => [f, [{ line: 1, tone: 'primary' }]]))
        m.set('src/components/features/X.tsx', [{ line: 9, tone: 'primary' }])
        return checkCompactUsage(m).some((f) => /features\/X\.tsx/.test(f))
      })(),
    ],
    [
      '🔴 허용 경로에서 사용이 사라지면 실패한다',
      (() => {
        const m = new Map([[COMPACT_ALLOWED[0], [{ line: 1, tone: 'primary' }]]])
        return checkCompactUsage(m).some((f) => f.includes(COMPACT_ALLOWED[1]) && /0건/.test(f))
      })(),
    ],
    [
      '🔴 허용 경로에서 사용이 늘어도 실패한다',
      (() => {
        const m = new Map(COMPACT_ALLOWED.map((f) => [f, [{ line: 1, tone: 'primary' }]]))
        m.set(COMPACT_ALLOWED[0], [{ line: 1, tone: 'primary' }, { line: 2, tone: 'primary' }])
        return checkCompactUsage(m).some((f) => /2건/.test(f))
      })(),
    ],
    [
      '🔴 허용 경로의 tone 이 바뀌면 실패한다',
      (() => {
        const m = new Map(COMPACT_ALLOWED.map((f) => [f, [{ line: 1, tone: 'primary' }]]))
        m.set(COMPACT_ALLOWED[0], [{ line: 1, tone: 'danger' }])
        return checkCompactUsage(m).some((f) => /tone 이/.test(f))
      })(),
    ],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([why]) => why)
  if (failed.length) {
    console.error('🔴 대비 검사 self-test 실패 — 검사기 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  return checks.length
}

const selfTestCount = selfTest()
const tokens = readCssTokens(readFileSync(CSS, 'utf8'))
const { rows, failures, missing } = run(tokens, { rebrand: REBRAND })

if (missing.length) {
  console.error('대비 검사: 토큰을 찾지 못했습니다 (이름이 바뀌었을 수 있습니다):\n')
  for (const m of [...new Set(missing)]) console.error(`  ${m}`)
  process.exit(1)
}

const mode = REBRAND ? '리브랜딩 후보색' : '현재 디자인'

// 🔴 대비 실패에서 바로 끝내지 않는다. 사용처 문제까지 한 번에 보여줘야
//    후보색을 고치고 다시 돌렸다가 또 다른 실패를 만나는 왕복이 없다.
let failed = false

if (failures.length) {
  console.error(`대비 미달 (${mode} 기준):\n`)
  for (const f of failures) {
    const std = f.standard === 'internal' ? '내부 품질 목표' : 'WCAG'
    console.error(`  ${f.fg} on ${f.bg}   ${f.ratio}:1   요구 ${f.required}:1 (${std})   (${f.why})`)
    console.error(`    ${f.fgv} on ${f.bgv}`)
    if (f.ex) console.error(`    ⚠️ 예외로 등록돼 있으나 baseline ${f.ex.baseline}:1 보다 나빠졌습니다`)
    console.error('')
  }
  console.error(`총 ${failures.length}건.`)
  failed = true
}

// ── text-brand-ink 사용처 baseline 대조 ──
const actualInk = new Map()
for (const file of walkSrc(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file)
  const n = countInkInSource(rel, readFileSync(file, 'utf8'))
  if (n) actualInk.set(rel, n)
}
const ink = checkInkUsage(actualInk, { rebrand: REBRAND })

// ── 고객 primary CTA 계약 검사 (className 표현 단위) ──
const ctaRows = []
const compactFound = new Map()
let actionButtonFail = []
for (const file of walkSrc(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file)
  const text = readFileSync(file, 'utf8')
  const r = checkCtaContract(rel, text)
  if (r) ctaRows.push(r)
  if (rel === 'src/components/ui/ActionButton.tsx') actionButtonFail = checkActionButton(text, rel)
  const hits = findCompactUsage(rel, text)
  if (hits.length) compactFound.set(rel, hits)
}
const compactFail = checkCompactUsage(compactFound)
const ctaUnits = ctaRows.reduce((a, r) => a + r.units, 0)
const ctaBroken = ctaRows.filter((r) => r.broken.length)
if (ctaBroken.length) {
  console.error('고객 primary CTA 계약을 어긴 자리가 있습니다:\n')
  for (const r of ctaBroken)
    for (const b of r.broken)
      console.error(`  ${r.file}  [${b.where}]  빠진 것: ${b.miss.join(' · ')}\n    ${b.classes}`)
  console.error('')
  console.error('🔴 bg-cta 위 흰 글씨(--cta-content)는 3.53:1 이라 큰 굵은 글씨로만 통과한다.')
  console.error('   같은 className 표현 안에 text-cta-content · text-lg · font-bold 를 함께 쓴다.')
  console.error('   좁은 운영 표의 작은 버튼이라면 --text-primary 를 쓰세요.')
  failed = true
}
if (actionButtonFail.length) {
  console.error('ActionButton 의 primary 변형이 계약과 어긋납니다:\n')
  for (const f of actionButtonFail) console.error(`  ${f}`)
  console.error('')
  failed = true
}
if (compactFail.length) {
  console.error('ActionButton size="compact" 사용이 허용 목록과 어긋납니다:\n')
  for (const f of compactFail) console.error(`  ${f}`)
  console.error('')
  console.error('🔴 compact 는 라벨을 키우지 않아 흰 글씨를 쓸 수 없다 — 고객 CTA 는 전부 흰색이다.')
  console.error(`   허용 경로: ${COMPACT_ALLOWED.join(' · ')} (각 1건 · tone="primary")`)
  failed = true
}

// ── text-brand 사용처 baseline 대조 ──
const actualBrand = new Map()
for (const file of walkSrc(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file)
  const n = countBrandInSource(rel, readFileSync(file, 'utf8'))
  if (n) actualBrand.set(rel, n)
}
const brandUse = checkBrandUsage(actualBrand, { rebrand: REBRAND })

if (brandUse.failures.length) {
  console.error('text-brand 사용처가 baseline 과 어긋납니다:\n')
  for (const f of brandUse.failures) console.error(`  ${f.file}   [${f.kind}] ${f.msg}`)
  console.error('')
  console.error('🔴 --brand 를 글자로 쓸 수 있는 자리는 큰 글씨(24px / weight 800)뿐이다.')
  console.error('   작은 글씨에는 --brand-strong 을 쓴다 (흰 카드 5.49:1).')
  console.error('   기존 사용을 정리했다면 check-contrast.mjs 의 BRAND_USAGE 를 함께 줄이세요.')
  failed = true
}

if (ink.failures.length) {
  console.error('text-brand-ink 사용처가 baseline 과 어긋납니다:\n')
  for (const f of ink.failures) console.error(`  ${f.file}   [${f.kind}] ${f.msg}`)
  console.error('')
  console.error('🔴 --brand-ink 는 로고(logotype)에서만 대비 예외가 성립한다.')
  console.error('   작은 글씨에는 --brand-strong 을 쓴다 (흰 카드 5.49:1).')
  console.error('   기존 사용을 정리했다면 check-contrast.mjs 의 BRAND_INK_USAGE 를 함께 줄이세요.')
  failed = true
}

if (failed) process.exit(1)

const exceptions = rows.filter((r) => r.status === 'exception')
console.log(
  `대비 검사 통과 (${mode}) — ${rows.length}조합 · 예외 ${exceptions.length}건 (self-test ${selfTestCount}건 통과)`,
)

if (exceptions.length) {
  console.log('')
  console.log('명시적 예외 (기준 미달이지만 근거가 기록된 조합):')
  for (const e of exceptions) {
    const std = e.standard === 'internal' ? '내부 목표' : 'WCAG'
    console.log(`  ${e.fg} on ${e.bg}   ${e.ratio}:1  (요구 ${e.required}:1 ${std} · baseline ${e.ex.baseline}:1)`)
  }
}

const inkTotal = [...actualInk.values()].reduce((a, b) => a + b, 0)
const inkLarge = BRAND_INK_USAGE.filter((u) => u.kind === 'LARGE_TEXT')
const inkDebt = BRAND_INK_USAGE.filter((u) => u.kind === 'BASELINE_DEBT')
console.log('')
console.log(
  `text-brand-ink 사용처 ${actualInk.size}파일 · ${inkTotal}건 — ` +
    `LARGE_TEXT ${inkLarge.length}파일 · BASELINE_DEBT ${inkDebt.length}파일`,
)
if (inkDebt.length === 0) {
  console.log('  전부 WCAG 큰 글씨(3:1)를 실제로 통과하는 자리다. 작은 글씨 부채 0건.')
} else {
  console.log('  BASELINE_DEBT 는 작은 글씨에 원색을 쓴 것이다 — --brand-strong 으로 옮긴다.')
}
console.log('  🔴 새 사용·증가는 실패한다. 큰 글씨가 아니면 --brand-strong 을 쓴다.')

const brandTotal = [...actualBrand.values()].reduce((a, b) => a + b, 0)
console.log('')
console.log(
  `text-brand 사용처 ${actualBrand.size}파일 · ${brandTotal}건 — ` +
    `LARGE_TEXT ${BRAND_USAGE.filter((u) => u.kind === 'LARGE_TEXT').length}파일`,
)
console.log('  워드마크 앞 조각(24px / weight 800)뿐이다. 작은 글씨의 새 사용은 실패한다.')

console.log('')
console.log(
  `고객 primary CTA 계약 — ${ctaRows.length}파일의 ${ctaUnits}개 className 표현을 각각 검증했다 ` +
    '(전부 text-cta-content · text-lg · font-bold)',
)
console.log('  ActionButton 의 tone×size 변형 4종은 필수·금지 클래스를 함께 검사했다.')
console.log(
  `  ActionButton size="compact" 는 ${COMPACT_ALLOWED.length}곳(운영 표)에서 각 1건 · tone="primary" 로만 허용된다 ` +
    '— 다른 컴포넌트의 size="compact" 는 검사 대상이 아니다.',
)
console.log('  🔴 같은 파일에 온전한 CTA 가 있어도 불완전한 CTA 는 따로 실패한다 (admin 경로는 제외).')

if (brandUse.cleanups.length) {
  console.log('')
  console.log('ℹ️  사용이 줄었습니다 — BRAND_USAGE 를 함께 정리하세요:')
  for (const c of brandUse.cleanups) console.log(`  ${c.file}   baseline ${c.count} → 실제 ${c.actual}`)
}

if (ink.cleanups.length) {
  console.log('')
  console.log('ℹ️  사용이 줄었습니다 — BRAND_INK_USAGE 를 함께 정리하세요:')
  for (const c of ink.cleanups) {
    console.log(`  ${c.file}   baseline ${c.count} → 실제 ${c.actual}`)
  }
}

if (process.argv.includes('--verbose')) {
  console.log('')
  for (const r of rows) {
    const mark = r.status === 'pass' ? '✅' : r.status === 'exception' ? '⚠️ ' : '❌'
    console.log(`  ${mark} ${(r.fg + ' on ' + r.bg).padEnd(46)} ${String(r.ratio).padStart(6)}:1  요구 ${r.required}`)
  }
}
