/**
 * 🔴 **매거진 마크다운 형식 판정의 정본** — 원고와 brief 가 같은 표기 규칙을 본다 (2026-10-08 자연 회차).
 *
 *    그날 `clinic-booking-app` 원고는 CTA 를 `[문장](/community/free)` 링크로 끝냈다. 원고 관문은
 *    `[CTA]` 를 **세기만** 했고, 변환기(md-to-draft)만 "정확히 1개" 를 요구했다. 그래서 원고는 저장됐고,
 *    다음 단계가 CONVERT_FAILED 로 멈췄으며, 결과에는 실제 위반 대신 사람용 안내문만 남았다.
 *    같은 회차의 `cold-weather-joint-pain`·`autumn-low-mood` 도 번호 목록으로 같은 자리에서 막혀 있었다.
 *
 *    그래서 판정을 이 파일 하나로 모은다.
 *      - md-to-draft CLI          → `parseFrontmatter` · `parseBody` (변환에 쓰는 블록까지)
 *      - 원고 관문(manuscript-guard) → `judgeManuscriptFormat` — draft.md 저장 **전**
 *      - auto-register            → `judgeManuscriptFormat` — 이미 저장된 draft.md 도 같은 판정
 *      - brief 생성(verifyBrief) · 일반 전송 직전(deliveryGate) → `judgeBriefFormatContract`
 *    규칙을 다른 파일에 다시 적지 않는다. 두 곳에 두면 한쪽만 고쳐지는 날이 온다.
 *
 *    🔴 원고를 고치지 않는다. 판정만 한다 — 추측해서 고치면 원고에 개입한 것이 된다.
 *    네트워크 · 파일 쓰기 0 (순수 함수).
 */

/** frontmatter 에서 받는 값. 그 외 키가 오면 FAIL */
export const ALLOWED_META = new Set([
  'title',
  'description',
  'cluster',
  'medical',
  'seriesId',
  'seriesOrder',
])
export const REQUIRED_META = ['title', 'description', 'cluster']

/** CTA href 가 시작해야 하는 경로 */
export const CTA_HREF_PREFIX = '/community/'

/** 규칙 밖 요소 — 발견 즉시 FAIL 한다 */
export const FORBIDDEN = [
  { re: /^\s*\|.*\|\s*$/, why: '표는 허용하지 않는다' },
  { re: /^\s*```/, why: '코드블록은 허용하지 않는다' },
  { re: /^#\s/, why: 'h1 은 페이지가 렌더한다. 본문에 두지 않는다' },
  { re: /^#{4,}\s/, why: 'h4 이하는 허용하지 않는다 (h2 · h3 만)' },
  { re: /!\[[^\]]*\]\([^)]*\)/, why: '마크다운 이미지는 허용하지 않는다' },
  { re: /https?:\/\//, why: '외부 링크는 허용하지 않는다' },
  { re: /<\/?[a-zA-Z][^>]*>/, why: 'HTML 태그는 허용하지 않는다' },
  { re: /^\s*\d+\.\s/, why: '번호 목록은 허용하지 않는다 (- 만 쓴다)' },
]

// ── frontmatter ────────────────────────────────────────────

export function parseFrontmatter(lines, errors) {
  if (lines[0]?.trim() !== '---') {
    errors.push({ line: 1, why: 'YAML frontmatter 가 없다. --- 로 시작해야 한다' })
    return { meta: {}, bodyStart: 0 }
  }

  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) {
    errors.push({ line: 1, why: 'frontmatter 가 닫히지 않았다' })
    return { meta: {}, bodyStart: 0 }
  }

  const meta = {}
  for (let i = 1; i < end; i += 1) {
    const raw = lines[i]
    if (!raw.trim()) continue

    const sep = raw.indexOf(':')
    if (sep === -1) {
      errors.push({ line: i + 1, why: `frontmatter 형식이 아니다: ${raw.trim()}` })
      continue
    }

    const key = raw.slice(0, sep).trim()
    const value = raw.slice(sep + 1).trim().replace(/^["']|["']$/g, '')

    if (!ALLOWED_META.has(key)) {
      errors.push({ line: i + 1, why: `허용되지 않은 frontmatter 키: ${key}` })
      continue
    }
    if (key === 'medical') meta[key] = value === 'true'
    else if (key === 'seriesOrder') meta[key] = Number(value)
    else meta[key] = value
  }

  for (const key of REQUIRED_META) {
    if (!meta[key]) errors.push({ line: 1, why: `frontmatter 에 ${key} 가 없다` })
  }
  if (meta.seriesId && meta.seriesOrder === undefined) {
    errors.push({ line: 1, why: 'seriesId 가 있으면 seriesOrder 도 필요하다' })
  }
  if (meta.seriesOrder !== undefined && Number.isNaN(meta.seriesOrder)) {
    errors.push({ line: 1, why: 'seriesOrder 가 숫자가 아니다' })
  }

  return { meta, bodyStart: end + 1 }
}

// ── 본문 ───────────────────────────────────────────────────

/**
 * 줄 단위로 읽어 블록을 만든다.
 * 판단이 갈리는 자리를 만들지 않는 것이 이 함수의 목표다 — 규칙에 없으면 FAIL.
 */
export function parseBody(lines, bodyStart, errors) {
  const blocks = []
  let paragraph = []
  let listItems = []
  let quoteLines = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push({ type: 'list', items: [...listItems] })
    listItems = []
  }
  const flushQuote = () => {
    if (quoteLines.length === 0) return
    blocks.push({ type: 'callout', text: quoteLines.join(' ') })
    quoteLines = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let i = bodyStart; i < lines.length; i += 1) {
    const raw = lines[i]
    const lineNo = i + 1
    const text = raw.trim()

    // CTA 는 대괄호 표기라 링크 검사보다 먼저 본다
    if (text.startsWith('[CTA]')) {
      flushAll()
      const parts = text.slice(5).split('|').map((s) => s.trim())
      if (parts.length < 2) {
        errors.push({ line: lineNo, why: '[CTA] 형식은 "href | label | text" 다' })
        continue
      }
      const [href, label, ctaText] = parts
      if (!href.startsWith(CTA_HREF_PREFIX)) {
        errors.push({ line: lineNo, why: `CTA href 는 ${CTA_HREF_PREFIX} 로 시작해야 한다: ${href}` })
        continue
      }
      const block = { type: 'cta', href, label }
      if (ctaText) block.text = ctaText
      blocks.push(block)
      continue
    }

    for (const rule of FORBIDDEN) {
      if (rule.re.test(raw)) {
        errors.push({ line: lineNo, why: `${rule.why} — "${text.slice(0, 40)}"` })
      }
    }

    if (!text) {
      flushAll()
      continue
    }

    if (text.startsWith('### ')) {
      flushAll()
      blocks.push({ type: 'h3', text: text.slice(4).trim() })
    } else if (text.startsWith('## ')) {
      flushAll()
      blocks.push({ type: 'h2', text: text.slice(3).trim() })
    } else if (text.startsWith('> ')) {
      flushParagraph()
      flushList()
      quoteLines.push(text.slice(2).trim())
    } else if (text.startsWith('- ')) {
      flushParagraph()
      flushQuote()
      listItems.push(text.slice(2).trim())
    } else {
      flushList()
      flushQuote()
      paragraph.push(text)
    }
  }
  flushAll()

  const ctaCount = blocks.filter((b) => b.type === 'cta').length
  if (ctaCount !== 1) {
    errors.push({ line: lines.length, why: `[CTA] 는 정확히 1개여야 한다 (현재 ${ctaCount}개)` })
  }

  return blocks
}

/** 위반 한 건을 사람이 읽는 한 줄로 — 결과·장부·재생성 패킷이 같은 문장을 쓴다 */
export const describeFormatViolation = (e) => `${e.line}행: ${e.why}`

/**
 * 🔴 **이 원고를 article 로 변환할 수 있는가** — md-to-draft 와 같은 판정 (원문 그대로 · 순수).
 * @returns {{ok:boolean, violations:{line:number, why:string}[], meta:object, blocks:object[]}}
 */
export function judgeManuscriptFormat(text) {
  const lines = String(text ?? '').split('\n')
  const violations = []
  const { meta, bodyStart } = parseFrontmatter(lines, violations)
  const blocks = parseBody(lines, bodyStart, violations)
  return { ok: violations.length === 0, violations, meta, blocks }
}

// ── brief 형식 계약 ──────────────────────────────────────────

/**
 * 🔴 **brief 가 원고 표기 규칙을 ChatGPT 에게 실제로 전하는가** (2026-10-08).
 *
 *    원고 표기 규칙은 brief 본문으로만 전달된다 — 전송 메시지(legacyManuscriptPromptText)는
 *    지문 호환 때문에 바꿀 수 없다. 그런데 2026-10-07 brief-auto 가 쓴 5건 중
 *    `clinic-booking-app` 은 `[CTA]` 지시 자체가 없었고, `gray-hair-leave-as-is` 는 허용 표기·금지 규칙이 없었다.
 *    섹션 6개 검사(G1)는 둘 다 통과시켰다. 규칙이 빠진 brief 를 보내면 원고가 규칙을 어기는 것은 정상이다.
 *
 *    세 가지를 본다. 기준은 **실제로 정상 원고를 받은 brief** 의 모양이다 — 정본 템플릿(`_template`)과
 *    그 이전 판(after-holiday-body-ache 등), 2026-10-07 brief-auto 판(job-credentials 등)이 모두 통과해야 한다.
 *      a. `[CTA] /community/… | 문구 | 앞 문장` 지시가 있다. `[CTA]` 로 시작하는 줄은 **전부** 유효하고
 *         **같은 게시판**을 가리킨다 (출력 예시와 CTA 지시에 두 번 적는 템플릿이 있다 — 뜻이 하나면 정상이다)
 *      b. 허용 표기 표 — `## ` · `> ` · `- ` · `[CTA]` 행을 가진 표 하나 (제목 문구는 판마다 달라 보지 않는다)
 *      c. 금지 규칙 — 표·코드블록·외부 링크·이미지·h1·h4(####)·HTML·번호 목록을 금지 목록이 모두 이름 댄다
 *         (한 줄 `🚫 표 · 코드블록 · …` 이든, `🚫` 여러 줄이든, `- 표 · 코드블록 · …` 목록 한 줄이든)
 * @returns {{ok:boolean, violations:{code:string, why:string}[]}}
 */
/** 허용 표기 블록 안에 있어야 하는 표기 (표의 행으로 적힌다) — `### ` 행은 옛 템플릿에 없어 요구하지 않는다 */
export const BRIEF_ALLOWED_NOTATIONS = ['`## `', '`> `', '`- `', '`[CTA]']
/** 금지 규칙이 이름을 대야 하는 요소 — md-to-draft FORBIDDEN 의 대상과 같다 */
export const BRIEF_FORBIDDEN_TERMS = [
  { name: '표', re: /(^|[\s·🚫-])표(?=$|[\s·(])/ },
  { name: '코드블록', re: /코드블록/ },
  { name: '외부 링크', re: /외부 링크/ },
  { name: '이미지', re: /이미지/ },
  { name: 'h1', re: /h1/ },
  { name: 'h4', re: /h4|####/ },
  { name: 'HTML', re: /HTML/ },
  { name: '번호 목록', re: /번호 목록/ },
]

const CTA_DIRECTIVE_RE = /^\[CTA\]\s*(\S+)\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*$/

export function judgeBriefFormatContract(briefText) {
  const lines = String(briefText ?? '').split('\n')
  const violations = []
  const add = (code, why) => violations.push({ code, why })

  // a. [CTA] 지시 — 줄 맨앞이 [CTA] 인 줄만 센다 (표 안의 `[CTA] href \| …` 설명은 세지 않는다)
  const ctaLines = lines.map((l, i) => ({ text: l.trim(), line: i + 1 })).filter((x) => x.text.startsWith('[CTA]'))
  if (ctaLines.length === 0) {
    add('BRIEF_CTA_DIRECTIVE', '[CTA] 지시 줄이 없다 — 원고가 CTA 를 어떤 표기로 쓸지 모른다')
  } else {
    const parsed = ctaLines.map((x) => ({ ...x, m: CTA_DIRECTIVE_RE.exec(x.text) }))
    const bad = parsed.filter((x) => !x.m || !x.m[1].startsWith(CTA_HREF_PREFIX) || !x.m[2] || !x.m[3])
    const hrefs = new Set(parsed.filter((x) => x.m).map((x) => x.m[1]))
    if (bad.length) {
      add('BRIEF_CTA_DIRECTIVE', `${bad.map((x) => `${x.line}행`).join(' · ')}: [CTA] 지시가 "${CTA_HREF_PREFIX}… | 문구 | 앞 문장" 형식이 아니다`)
    } else if (hrefs.size !== 1) {
      add('BRIEF_CTA_DIRECTIVE', `[CTA] 지시가 서로 다른 게시판을 가리킨다: ${[...hrefs].join(' · ')}`)
    }
  }

  // b. 허용 표기 표 — `|` 로 시작하는 연속 줄 하나가 필요한 표기를 모두 행으로 가진다 (제목 문구는 판마다 다르다)
  const tables = []
  let cur = []
  for (const l of lines) {
    if (l.trim().startsWith('|')) cur.push(l)
    else if (cur.length) { tables.push(cur.join('\n')); cur = [] }
  }
  if (cur.length) tables.push(cur.join('\n'))
  const notationTables = tables.filter((t) => t.includes('`[CTA]'))
  if (!notationTables.length) {
    add('BRIEF_ALLOWED_NOTATION', '허용 표기 표(`## ` · `> ` · `- ` · `[CTA]` 행)가 없다')
  } else {
    const best = notationTables.map((t) => BRIEF_ALLOWED_NOTATIONS.filter((n) => !t.includes(n)))
      .sort((x, y) => x.length - y.length)[0]
    if (best.length) add('BRIEF_ALLOWED_NOTATION', `허용 표기 표에 빠진 표기: ${best.join(' ')}`)
  }

  // c. 금지 규칙 — 🚫 줄 전부 + 금지 요소를 셋 이상 한꺼번에 적은 목록 줄
  const forbidText = lines
    .filter((l) => l.includes('🚫') || BRIEF_FORBIDDEN_TERMS.filter((t) => t.re.test(l)).length >= 3)
    .join('\n')
  const missingTerms = BRIEF_FORBIDDEN_TERMS.filter((t) => !forbidText.split('\n').some((l) => t.re.test(l)))
  if (missingTerms.length) {
    add('BRIEF_FORBIDDEN_RULES', `금지 규칙이 이름 대지 않는 요소: ${missingTerms.map((t) => t.name).join(' · ')}`)
  }

  return { ok: violations.length === 0, violations }
}

export const describeBriefViolations = (violations) => violations.map((v) => `${v.code}: ${v.why}`).join(' / ')
