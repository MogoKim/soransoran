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

  // ── CTA (4.5:1) — 아래 예외 참조 ──
  { fg: '--cta-text', bgs: ['--cta'], req: 'text', why: 'CTA 버튼 위 글자' },

  /**
   * ── 브랜드 원색 (3:1) — 아래 예외 참조 ──
   *
   * 🔴 standard: 'internal' — 이 3:1 은 WCAG 가 요구하는 값이 아니다.
   *    WCAG 1.4.3 은 로고·브랜드명(logotype)을 대비 요건에서 제외한다.
   *    그럼에도 3:1 을 두는 것은 **리브랜딩 때 지키기로 한 내부 품질 목표**다 —
   *    새 색을 고를 때 "로고니까 아무 색이나 된다"로 가지 않기 위한 하한선이다.
   */
  { fg: '--brand-ink', bgs: ['--surface-card', '--surface-app'], req: 'large', standard: 'internal', why: '브랜드 원색 — 워드마크 및 그 밖의 사용처' },
]

/**
 * 예외 — 조합 단위로만 적는다.
 *
 * 🔴 baseline 은 "지금 이 정도"라는 기록이다. 이 값보다 나빠지면 실패한다.
 *    통과시키려고 baseline 을 낮추지 않는다 — 낮추는 순간 이 목록은 의미가 없다.
 * 🔴 --rebrand 모드는 이 목록을 보지 않는다. 새 색은 예외 없이 기준을 넘어야 한다.
 */
const EXCEPTIONS = [
  {
    fg: '--cta-text',
    bg: '--cta',
    baseline: 2.72,
    why:
      '정본 §3-1-B 코랄 전환. 코랄 fill + 흰 글씨는 2.72:1 로 AA 미달이지만 ' +
      '실기기 판독성 결정으로 채택했다(먹색 글씨 5.41:1 은 버튼으로 읽히지 않았다). ' +
      '큰 버튼과 FAB 에만 쓰고 본문·라벨에는 쓰지 않는다. ' +
      '흰 글씨가 필요한 다른 자리는 --cta-edge(5.49:1)를 쓴다.',
  },
  {
    fg: '--brand-ink',
    bg: '--surface-card',
    baseline: 2.72,
    why:
      '🔴 이 예외는 "이 토큰은 봐준다"가 아니다. logotype 사용에만 근거가 있다. ' +
      'WCAG 1.4.3 은 로고·브랜드명(logotype)을 대비 요건에서 제외하고, ' +
      'Logo.tsx 의 워드마크가 그 예외에 해당한다(원색이 브랜드 인상을 진다 — §2-1-A). ' +
      '🔴 aria-label 은 접근 가능한 이름을 제공할 뿐 시각 대비 예외의 근거가 아니다. ' +
      '🔴 나머지 사용처(text-sm 버튼 라벨·11px 배지 등)는 logotype 이 아니라 ' +
      '**현재 접근성 부채**다. 아래 BRAND_INK_USAGE 가 그 목록을 고정하고, ' +
      '새 사용과 증가를 막는다 — 값만 예외 처리하면 부채가 조용히 늘어난다.',
  },
  {
    fg: '--brand-ink',
    bg: '--surface-app',
    baseline: 2.61,
    why: '위와 같다. 바탕 위에 놓이는 경우.',
  },
]

/**
 * `text-brand-ink` 사용처 baseline — 대비 부채를 이름으로 고정한다
 *
 * 🔴 토큰 값만 예외로 두면 "brand-ink 는 봐준다"가 되어, 앞으로 작은 글씨에
 *    text-brand-ink 를 새로 써도 CI 가 통과한다. 부채가 조용히 늘어나는 통로다.
 *    그래서 값이 아니라 **사용처**를 고정한다.
 *
 *   LOGOTYPE        워드마크. WCAG logotype 예외에 해당한다 — 부채가 아니다.
 *   BASELINE_DEBT   지금 존재하는 비-로고 사용. 일반 글자 대비 기준을 넘지 못한다.
 *                   지우는 것은 환영이고, 늘리는 것은 막는다.
 *
 * count 는 파일별 `text-brand-ink` 출현 횟수다(hover:·group-hover: 변형 포함).
 * 🔴 통과시키려고 count 를 올리지 않는다 — 올리는 순간 이 목록은 의미가 없다.
 */
const BRAND_INK_USAGE = [
  { file: 'src/components/brand/Logo.tsx', count: 1, kind: 'LOGOTYPE', note: '워드마크 자체. WCAG 1.4.3 logotype 예외에 해당한다' },
  { file: 'src/app/error.tsx', count: 2, kind: 'BASELINE_DEBT', note: '워드마크 표기 + 버튼 라벨. 워드마크는 Logo 를 거치지 않는다' },
  { file: 'src/app/my/comments/page.tsx', count: 2, kind: 'BASELINE_DEBT', note: '본문 미리보기 hover·active 색' },
  { file: 'src/app/my/posts/page.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/app/my/scraps/page.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/app/my/withdrawal/page.tsx', count: 1, kind: 'BASELINE_DEBT', note: '버튼 라벨' },
  { file: 'src/components/features/CommentLikeButton.tsx', count: 2, kind: 'BASELINE_DEBT', note: '공감 상태 라벨 · hover' },
  { file: 'src/components/features/CommentSection.tsx', count: 1, kind: 'BASELINE_DEBT', note: '댓글 수 강조' },
  { file: 'src/components/features/HomeMagazineRail.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/components/features/MagazineCard.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/components/features/MagazineList.tsx', count: 1, kind: 'BASELINE_DEBT', note: '선택된 필터 라벨(연분홍 면 위)' },
  { file: 'src/components/features/PostActionBar.tsx', count: 5, kind: 'BASELINE_DEBT', note: 'text-sm 액션 라벨 · hover 색' },
  { file: 'src/components/features/PostCard.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/components/features/PostEditor.tsx', count: 1, kind: 'BASELINE_DEBT', note: '선택된 게시판 라벨(연분홍 면 위)' },
  { file: 'src/components/features/PostListItem.tsx', count: 3, kind: 'BASELINE_DEBT', note: '22px 순번(큰 글씨) · 제목 hover' },
  { file: 'src/components/features/RelatedMagazineList.tsx', count: 2, kind: 'BASELINE_DEBT', note: '제목 hover·active 색' },
  { file: 'src/components/features/ReplyForm.tsx', count: 1, kind: 'BASELINE_DEBT', note: '취소 버튼 hover 색' },
  { file: 'src/components/features/SortableCommentList.tsx', count: 2, kind: 'BASELINE_DEBT', note: '정렬 탭 선택 상태 · hover' },
  { file: 'src/components/features/greeting/newcomer-greetings.tsx', count: 3, kind: 'BASELINE_DEBT', note: '닉네임 강조 · hover 색' },
  { file: 'src/components/features/login/LoginOnboarding.tsx', count: 1, kind: 'BASELINE_DEBT', note: '뒤로가기 hover 색' },
  { file: 'src/components/features/login/SignupBlockedNotice.tsx', count: 2, kind: 'BASELINE_DEBT', note: '버튼 라벨 · hover 색' },
  { file: 'src/components/features/my/NicknameForm.tsx', count: 1, kind: 'BASELINE_DEBT', note: '버튼 라벨' },
  { file: 'src/components/features/my/shell.tsx', count: 2, kind: 'BASELINE_DEBT', note: '메뉴 hover·active 색' },
  { file: 'src/components/features/onboarding/agreement-check.tsx', count: 1, kind: 'BASELINE_DEBT', note: '필수 표시 라벨' },
  { file: 'src/components/layouts/FontSizeToggle.tsx', count: 3, kind: 'BASELINE_DEBT', note: '11px 배지 · 선택 상태 라벨' },
  { file: 'src/components/layouts/HeaderAuth.tsx', count: 2, kind: 'BASELINE_DEBT', note: 'text-sm 버튼 라벨' },
]

/**
 * src 를 훑어 파일별 `text-brand-ink` 출현 횟수를 센다.
 *
 * 🔴 주석은 세지 않는다 — TypeScript 파서로 문자열·JSX 텍스트만 본다.
 *    (정규식으로 주석을 지우는 방식의 실패는 check-brand-literals.mjs 머리말 참조)
 * admin 은 리브랜딩 대상이 아니라 제외한다.
 */
const INK_CLASS = /text-brand-ink/g
const INK_EXCLUDED = ['src/app/admin/', 'src/components/admin/']

function walkSrc(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkSrc(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

export function countInkInSource(rel, text) {
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
        n += (node.text ?? '').match(INK_CLASS)?.length ?? 0
        break
      default:
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}

/**
 * baseline 과 실제 사용을 대조한다.
 *
 *   미등록 파일에 사용   → 실패 (새 misuse)
 *   등록 파일이 증가     → 실패 (부채 증가)
 *   등록 파일이 감소·0   → 통과하되 baseline 정리를 요구 (알림)
 *   rebrand 모드         → BASELINE_DEBT 자체를 실패로 본다
 */
export function checkInkUsage(actual, { rebrand }) {
  const failures = []
  const cleanups = []
  const registered = new Map(BRAND_INK_USAGE.map((u) => [u.file, u]))

  for (const [file, count] of actual) {
    if (count === 0) continue
    const reg = registered.get(file)
    if (!reg) {
      failures.push({
        file,
        count,
        kind: 'NEW',
        msg: `등록되지 않은 새 text-brand-ink 사용 ${count}건`,
      })
      continue
    }
    if (count > reg.count) {
      failures.push({
        file,
        count,
        kind: reg.kind,
        msg: `text-brand-ink 사용이 늘었습니다 (baseline ${reg.count} → ${count})`,
      })
    }
  }

  for (const u of BRAND_INK_USAGE) {
    const count = actual.get(u.file) ?? 0
    if (count < u.count) {
      cleanups.push({ ...u, actual: count })
    }
  }

  if (rebrand) {
    for (const u of BRAND_INK_USAGE) {
      if (u.kind !== 'BASELINE_DEBT') continue
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

function exceptionFor(fg, bg) {
  return EXCEPTIONS.find((e) => e.fg === fg && e.bg === bg)
}

/** 검사 본체. 토큰 Map 만 받으므로 self-test 가 그대로 쓴다 */
function run(tokens, { rebrand }) {
  const rows = []
  const failures = []
  const missing = []

  for (const combo of COMBOS) {
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
      const ex = rebrand ? null : exceptionFor(combo.fg, bg)

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
    [
      'rebrand 모드는 예외를 인정하지 않는다',
      run(new Map([['--cta-text', '#ffffff'], ['--cta', '#ff6f61']]), { rebrand: true }).failures.some(
        (f) => f.fg === '--cta-text',
      ),
    ],
    [
      '기본 모드는 baseline 이상이면 예외로 통과',
      run(new Map([['--cta-text', '#ffffff'], ['--cta', '#ff6f61']]), { rebrand: false }).rows.some(
        (r) => r.fg === '--cta-text' && r.status === 'exception',
      ),
    ],
    [
      '예외라도 baseline 보다 나빠지면 실패',
      run(new Map([['--cta-text', '#ffffff'], ['--cta', '#ff8f81']]), { rebrand: false }).failures.some(
        (f) => f.fg === '--cta-text',
      ),
    ],

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
    [
      '등록되지 않은 새 사용을 잡는다',
      checkInkUsage(new Map([['src/components/features/New.tsx', 1]]), { rebrand: false }).failures.some(
        (f) => f.kind === 'NEW',
      ),
    ],
    [
      '등록 파일이라도 사용이 늘면 잡는다',
      checkInkUsage(new Map([['src/components/brand/Logo.tsx', 2]]), { rebrand: false }).failures.length === 1,
    ],
    [
      'logotype 사용은 baseline 그대로면 통과',
      checkInkUsage(new Map([['src/components/brand/Logo.tsx', 1]]), { rebrand: false }).failures.length === 0,
    ],
    [
      '사용이 줄면 실패가 아니라 정리 요구',
      (() => {
        const r = checkInkUsage(new Map([['src/components/brand/Logo.tsx', 1]]), { rebrand: false })
        return r.failures.length === 0 && r.cleanups.length > 0
      })(),
    ],
    [
      'rebrand 모드는 BASELINE_DEBT 를 허용하지 않는다',
      checkInkUsage(new Map([['src/components/layouts/HeaderAuth.tsx', 2]]), { rebrand: true }).failures.some(
        (f) => f.kind === 'BASELINE_DEBT',
      ),
    ],
    [
      'rebrand 모드에서도 LOGOTYPE 은 통과',
      !checkInkUsage(new Map([['src/components/brand/Logo.tsx', 1]]), { rebrand: true }).failures.some(
        (f) => f.file === 'src/components/brand/Logo.tsx',
      ),
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
const inkLogotype = BRAND_INK_USAGE.filter((u) => u.kind === 'LOGOTYPE')
const inkDebt = BRAND_INK_USAGE.filter((u) => u.kind === 'BASELINE_DEBT')
console.log('')
console.log(
  `text-brand-ink 사용처 ${actualInk.size}파일 · ${inkTotal}건 — ` +
    `LOGOTYPE ${inkLogotype.length}파일 · BASELINE_DEBT ${inkDebt.length}파일`,
)
console.log('  logotype 만 WCAG 예외다. 나머지는 접근성 부채이며 새 사용·증가는 실패한다.')

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
