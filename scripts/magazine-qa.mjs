#!/usr/bin/env node
/**
 * 매거진 자동 QA
 *
 * 매거진 전략 원칙 5 · §5.1 의 "위험 기반 검수"를 성립시키는 앞단이다.
 * 기계가 잡을 수 있는 것을 먼저 걸러야 창업자가 위험 판단에만 집중할 수 있다.
 *
 * 이 스크립트가 하지 않는 것 (전략 §3.0 역할 분리):
 *   글을 쓰지 않는다 · 파일을 고치지 않는다 · LLM 을 호출하지 않는다 · 네트워크를 쓰지 않는다.
 *   순수 정적 검사만 한다.
 *
 * 사용법
 *   node scripts/magazine-qa.mjs                     발행 글 + 전체 draft
 *   node scripts/magazine-qa.mjs --published         지금 공개된 글만
 *   node scripts/magazine-qa.mjs --scheduled         예약·차단된 글만 (아직 안 나간 글)
 *   node scripts/magazine-qa.mjs --draft <path>      특정 draft 만
 *   node scripts/magazine-qa.mjs --json              결과를 JSON 으로 (다른 도구가 읽는 용도)
 *
 * 종료 코드: FAIL 1건 이상이면 1, 아니면 0 (WARN 은 0)
 *
 * 검사 로직은 runQa() 로 분리돼 있어 다른 스크립트가 import 해서 쓸 수 있다.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, isAbsolute, basename, dirname } from 'node:path'
import { runInNewContext } from 'node:vm'
import { isPublic, statusLabel, assertGateInSync } from './lib/magazine-gate.mjs'
import {
  checkFirstPerson,
  checkTitleForm,
  checkCareAdvice,
  checkDepartmentDirective,
  checkTreatmentDirective,
  checkCostClaim,
} from './lib/magazine-editorial.mjs'

const ROOT = process.cwd()
const ARTICLES_TS = join(ROOT, 'src/content/magazine/articles.ts')
const QUEUE_TS = join(ROOT, 'drafts/magazine/topic-queue.ts')
const DRAFTS_DIR = join(ROOT, 'drafts/magazine')
const PUBLIC_DIR = join(ROOT, 'public')

// ── 검사 상수 ──────────────────────────────────────────────

/**
 * 제품·브랜드 금지어. 대체 표현은 "우리 나이" 계열.
 *
 * 🔴 **정본은 여기 하나다.** hero alt 검사(`lib/magazine-hero-brief.mjs`)도 이것을 읽는다 —
 *    본문에서 막는 호칭이 대체 텍스트로 새어 나가면 막은 의미가 없다.
 *    목록을 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 */
export const BANNED_WORDS = ['시니어', '어르신', '노인', '실버']

/** 의료 단정 — 진단·효과를 확정하는 표현 (전략 원칙 8). 문맥과 무관하게 FAIL */
const MEDICAL_ASSERTIONS = ['반드시', '치료됩니다', '원인입니다', '완치', '효과적입니다']

/**
 * "낫습니다" 는 두 뜻이 겹친다 — 병이 낫다(의료 단정) vs ~보다 낫다(비교).
 * 문맥 없이 잡으면 "~하는 편이 낫습니다" 같은 소란소란 톤의 자연스러운 문장이 걸린다.
 * 그래서 문장 단위로 보고, 비교 표현일 때만 통과시킨다.
 *   통과: "…보다 … 낫습니다" · "…편이 낫습니다" · "…쪽이 낫습니다"
 *   FAIL: "병이 낫습니다" · "치료하면 낫습니다" · "약을 먹으면 낫습니다"
 */
const HEAL_WORD = '낫습니다'
const COMPARISON_PATTERNS = [/편이\s*낫습니다/, /쪽이\s*낫습니다/, /보다[^.!?]*낫습니다/]

/** 약·치료 인접어. 금지 맥락일 수 있어 WARN 으로 사람에게 넘긴다 */
const TREATMENT_TERMS = ['복용', '처방', '영양제', '호르몬제', '건강기능식품']

/** 위 단어가 아래 표현과 같은 문장에 있으면 "권하지 않는다"는 맥락이다 */
const NEGATION_HINTS = ['권하지', '추천하지', '않습니다', '금지', '말고', '아닙니다']

/** 낚시성 제목 패턴 */
const CLICKBAIT_WORDS = ['충격', '놀라운', '비밀', '이것만', '꿀팁', '대박', '역대급']

/** 출처 없는 수치 후보 */
const STAT_PATTERNS = [/\d+\s*%/, /\d+\s*명\s*중/, /\d+\s*배\s*(높|낮|증가|감소)/]

/** 무의미한 alt */
const MEANINGLESS_ALT = ['이미지', '사진', 'image', 'photo', '썸네일']

const ALLOWED_BLOCK_TYPES = new Set(['p', 'h2', 'h3', 'list', 'callout', 'image', 'cta'])

/** medical: true 가 없으면 FAIL — 핵심 건강 클러스터 */
export const MEDICAL_REQUIRED = new Set(['menopause-symptom', 'sleep', 'clinic'])
/** 경계 클러스터 — 없으면 WARN */
export const MEDICAL_SUGGESTED = new Set(['daily', 'emotion'])

/**
 * description 길이 기준이 둘인 이유
 *   HARD  검색 스니펫이 확실히 깨지는 구간 → FAIL
 *   SOFT  권장 범위 → WARN
 * 첫 발행 글이 78자로 SOFT 밖·HARD 안이다. 이미 승인된 글을 FAIL 로 만들지 않는다.
 */
const DESC_HARD_MIN = 60
const DESC_HARD_MAX = 160
const DESC_SOFT_MIN = 90
const DESC_SOFT_MAX = 120

const H2_MIN = 4
const H2_MAX = 6
const BODY_MIN = 1200
const BODY_MAX = 2500

export const HERO_WIDTH = 1200
export const HERO_HEIGHT = 675

/**
 * 공개 판정은 scripts/lib/magazine-gate.mjs 하나만 쓴다.
 * 그 모듈이 src/lib/magazine.ts 와 어긋나지 않는지도 함께 검사한다 (drift guard).
 */

// ── TS 데이터 파일에서 리터럴 꺼내기 ────────────────────────

/**
 * 균형 잡힌 리터럴 한 덩어리를 잘라낸다.
 * 문자열·주석 안의 괄호는 세지 않는다.
 */
function sliceLiteral(source, fromIndex, open, close) {
  const start = source.indexOf(open, fromIndex)
  if (start === -1) return null

  let depth = 0
  let quote = null
  let i = start

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '/' && next === '/') {
      i = source.indexOf('\n', i)
      if (i === -1) break
    } else if (ch === '/' && next === '*') {
      i = source.indexOf('*/', i + 2) + 1
      if (i === 0) break
    } else if (ch === open) {
      depth += 1
    } else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
    i += 1
  }
  return null
}

/**
 * 잘라낸 리터럴을 값으로 만든다.
 *
 * vm.runInNewContext 를 쓰는 이유와 안전한 이유:
 *   대상은 우리 repo 의 순수 데이터 리터럴이고, 새 컨텍스트에는 전역이 하나도 없다.
 *   require · process · fetch · fs 가 없으므로 파일 접근도 네트워크 호출도 불가능하다.
 *   TS 를 JS 로 바꾸려고 빌드 도구를 새로 들이는 것보다 이쪽이 의존성이 적다.
 */
function evalLiteral(literal, label) {
  try {
    return runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })
  } catch (err) {
    throw new Error(`${label} 파싱 실패: ${err.message}`)
  }
}

function loadPublished() {
  const src = readFileSync(ARTICLES_TS, 'utf8')
  const anchor = src.indexOf('MAGAZINE_ARTICLE_RECORD')
  if (anchor === -1) throw new Error('articles.ts 에서 MAGAZINE_ARTICLE_RECORD 를 찾지 못했다')
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  const record = evalLiteral(literal, 'articles.ts')
  return Object.entries(record).map(([slug, article]) => ({ slug, ...article }))
}

function loadDraft(path) {
  const src = readFileSync(path, 'utf8')
  const anchor = src.indexOf('export const DRAFT')
  if (anchor === -1) throw new Error(`${path} 에서 DRAFT 를 찾지 못했다`)
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  const article = evalLiteral(literal, path)
  // draft 는 slug 필드를 두지 않는다. 디렉터리명이 slug 다.
  const rel = relative(DRAFTS_DIR, path)
  const slug = rel.startsWith('..') ? basename(dirname(path)) : rel.split('/')[0]
  return { slug, ...article, __path: relative(ROOT, path) }
}

function findDraftPaths() {
  if (!existsSync(DRAFTS_DIR)) return []
  return readdirSync(DRAFTS_DIR)
    .map((name) => join(DRAFTS_DIR, name, 'article-draft.ts'))
    .filter((p) => existsSync(p))
}

function loadQueue() {
  if (!existsSync(QUEUE_TS)) return []
  const src = readFileSync(QUEUE_TS, 'utf8')
  const anchor = src.indexOf('export const TOPIC_QUEUE')
  if (anchor === -1) return []
  // 타입 주석의 대괄호(TopicQueueItem[])를 잡지 않도록 대입 기호 뒤에서 찾는다.
  const assign = src.indexOf('=', anchor)
  const literal = assign === -1 ? null : sliceLiteral(src, assign, '[', ']')
  return literal ? evalLiteral(literal, 'topic-queue.ts') : []
}

// ── webp 크기 ──────────────────────────────────────────────

/** RIFF/WEBP 헤더에서 크기를 읽는다. 알 수 없으면 null */
export function readWebpSize(path) {
  const buf = readFileSync(path)
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null

  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  }
  if (fourcc === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

// ── 결과 수집 ──────────────────────────────────────────────

function createReport() {
  const rows = []
  return {
    rows,
    fail: (id, msg) => rows.push({ level: 'FAIL', id, msg }),
    warn: (id, msg) => rows.push({ level: 'WARN', id, msg }),
  }
}

/** 한국어 문장 단위로 쪼갠다. 마침표·물음표·느낌표와 줄바꿈이 경계다 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 본문에서 사람이 읽는 텍스트만 모은다 */
function collectText(body) {
  const parts = []
  for (const block of body ?? []) {
    if (typeof block.text === 'string') parts.push(block.text)
    if (Array.isArray(block.items)) parts.push(...block.items)
    if (block.type === 'cta' && typeof block.label === 'string') parts.push(block.label)
  }
  return parts
}

// ── 글 단위 검사 ───────────────────────────────────────────

function checkArticle(article, context, report) {
  // 아직 안 나간 글은 리포트에서 구분한다 — 공개분 FAIL 과 섞이면 판단이 흐려진다
  const label = statusLabel(article)
  const id = label === 'PUBLIC' ? article.slug : `${article.slug} · ${label}`
  const texts = collectText(article.body)
  const fullText = texts.join('\n')
  const searchable = `${article.title}\n${article.description}\n${fullText}`

  // 1 · 금지어
  for (const word of BANNED_WORDS) {
    if (searchable.includes(word)) report.fail(id, `금지어 "${word}" 사용 — 대체 표현을 쓴다`)
  }

  // 2 · 의료 단정
  for (const word of MEDICAL_ASSERTIONS) {
    if (searchable.includes(word)) report.fail(id, `의료 단정 표현 "${word}" (전략 원칙 8)`)
  }

  // 2-1 · "낫습니다" 는 문장 단위로 본다 (비교 표현은 통과)
  for (const sentence of splitSentences(searchable)) {
    if (!sentence.includes(HEAL_WORD)) continue
    if (COMPARISON_PATTERNS.some((re) => re.test(sentence))) continue
    report.fail(id, `의료 단정 표현 "${HEAL_WORD}" — "${sentence.trim().slice(0, 50)}"`)
  }

  // 3 · 약·치료 인접어
  for (const term of TREATMENT_TERMS) {
    if (!searchable.includes(term)) continue
    const sentence = texts.find((t) => t.includes(term)) ?? ''
    const negated = NEGATION_HINTS.some((h) => sentence.includes(h))
    report.warn(id, `약·치료 인접어 "${term}"${negated ? ' (금지 맥락으로 보임)' : ''} — 사람 확인 필요`)
  }

  // 4 · description 길이
  const descLen = (article.description ?? '').length
  if (descLen < DESC_HARD_MIN || descLen > DESC_HARD_MAX) {
    report.fail(id, `description ${descLen}자 — 허용 ${DESC_HARD_MIN}~${DESC_HARD_MAX}자 밖`)
  } else if (descLen < DESC_SOFT_MIN || descLen > DESC_SOFT_MAX) {
    report.warn(id, `description ${descLen}자 — 권장 ${DESC_SOFT_MIN}~${DESC_SOFT_MAX}자 밖`)
  }

  // 5 · h2 개수
  const h2Count = (article.body ?? []).filter((b) => b.type === 'h2').length
  if (h2Count < H2_MIN || h2Count > H2_MAX) {
    report.warn(id, `h2 ${h2Count}개 — 권장 ${H2_MIN}~${H2_MAX}개`)
  }

  // 6 · CTA
  const ctas = (article.body ?? []).filter((b) => b.type === 'cta')
  if (ctas.length !== 1) {
    report.fail(id, `cta 블록 ${ctas.length}개 — 정확히 1개여야 한다 (전략 원칙 9)`)
  }
  for (const cta of ctas) {
    if (!String(cta.href ?? '').startsWith('/community/')) {
      report.fail(id, `cta href "${cta.href}" — /community/ 로 시작해야 한다`)
    }
  }

  // 7 · hero alt
  if (article.heroImage) {
    const alt = String(article.heroImage.alt ?? '').trim()
    if (!alt) report.fail(id, 'heroImage 에 alt 가 없다')
    else if (MEANINGLESS_ALT.includes(alt)) report.fail(id, `alt "${alt}" 는 무의미하다`)
  }

  // 12 · body 에 h1 금지
  if ((article.body ?? []).some((b) => b.type === 'h1')) {
    report.fail(id, 'body 에 h1 이 있다 — h1 은 페이지가 렌더한다')
  }

  // 13 · 외부 링크
  if (/https?:\/\//.test(fullText)) {
    report.fail(id, '본문에 외부 링크가 있다 — 내부 CTA 만 둔다')
  }

  // 14 · 출처 없는 통계
  for (const pattern of STAT_PATTERNS) {
    const hit = texts.find((t) => pattern.test(t))
    if (hit) {
      report.warn(id, `수치 표현 발견 — 출처 확인 필요: "${hit.slice(0, 40)}…"`)
      break
    }
  }

  // 낚시성 제목
  for (const word of CLICKBAIT_WORDS) {
    if (String(article.title ?? '').includes(word)) {
      report.warn(id, `제목에 낚시성 표현 "${word}"`)
    }
  }

  // 15 · 분량
  const bodyLen = fullText.replace(/\s/g, '').length
  if (bodyLen < BODY_MIN || bodyLen > BODY_MAX) {
    report.warn(id, `본문 ${bodyLen}자 — 권장 ${BODY_MIN}~${BODY_MAX}자`)
  }

  // 16 · block type
  for (const block of article.body ?? []) {
    if (!ALLOWED_BLOCK_TYPES.has(block.type)) {
      report.fail(id, `허용되지 않은 block type "${block.type}"`)
    }
  }

  // 17 · medical 플래그
  if (!article.medical) {
    if (MEDICAL_REQUIRED.has(article.cluster)) {
      report.fail(id, `cluster "${article.cluster}" 는 medical: true 가 필요하다 (전략 §4.4)`)
    } else if (MEDICAL_SUGGESTED.has(article.cluster)) {
      report.warn(id, `cluster "${article.cluster}" — medical: true 가 필요한지 확인`)
    }
  }

  // 18 · hero 파일
  if (article.heroImage?.src) {
    const src = String(article.heroImage.src)
    const filePath = join(PUBLIC_DIR, src.replace(/^\//, ''))
    if (!existsSync(filePath)) {
      report.fail(id, `hero 파일이 없다: public${src}`)
    } else if (!src.endsWith('.webp')) {
      report.warn(id, `hero 확장자가 webp 가 아니다: ${src}`)
    } else {
      const size = readWebpSize(filePath)
      if (!size) {
        report.warn(id, 'hero webp 헤더를 읽지 못했다 — 크기 확인 불가')
      } else if (size.width !== HERO_WIDTH || size.height !== HERO_HEIGHT) {
        report.warn(id, `hero ${size.width}×${size.height} — 기준 ${HERO_WIDTH}×${HERO_HEIGHT}`)
      }
      const declared = article.heroImage
      if (size && (declared.width !== size.width || declared.height !== size.height)) {
        report.fail(id, `heroImage 선언(${declared.width}×${declared.height})이 실제 파일과 다르다`)
      }
    }
  }

  // 10·11 · 발행분과의 제목/description 중복
  for (const other of context.published) {
    // id 에는 상태 표기가 붙으므로 slug 로 비교한다 (자기 자신을 중복으로 잡지 않게)
    if (other.slug === article.slug) continue
    if (other.title === article.title) report.fail(id, `제목이 발행 글 "${other.slug}" 와 정확히 같다`)
    if (other.description === article.description) {
      report.fail(id, `description 이 발행 글 "${other.slug}" 와 정확히 같다`)
    }
  }
  // 19 · 1인칭 화자 (M-AUTO-2 · D1)
  //     제목·description 은 넣지 않는다 — 화자는 본문에서 드러난다
  const firstPerson = checkFirstPerson(fullText)
  if (firstPerson.level === 'FAIL') report.fail(id, firstPerson.reason)
  else if (firstPerson.level === 'WARN') report.warn(id, firstPerson.reason)

  // 20 · 제목 형태 (M-AUTO-2 · D2)
  const titleForm = checkTitleForm(article.title)
  if (titleForm.level === 'FAIL') report.fail(id, titleForm.reason)

  // 21 · 진료 권고 문장 (M-AUTO-2 · D4-A) — §4.4 의 필수 조건이라 FAIL 이다
  const care = checkCareAdvice(fullText, article.medical)
  if (care.level === 'FAIL') report.fail(id, care.reason)

  // 22 · 진료과 단정 (M-AUTO-2 · D5)
  //      과를 말하는 것은 정보다. 독자 대신 고르는 것이 판단이다
  const department = checkDepartmentDirective(fullText)
  if (department.level === 'FAIL') report.fail(id, department.reason)

  // 23 · 치료 권유·만류 (M-AUTO-2 · D7)
  const treatment = checkTreatmentDirective(fullText)
  if (treatment.level === 'FAIL') report.fail(id, treatment.reason)

  // 24 · 비용 단정 (M-AUTO-2 · D8) — clinic·medical 에만 건다. 돈 글에서 금액은 정보다
  const cost = checkCostClaim(fullText, article)
  if (cost.level === 'FAIL') report.fail(id, cost.reason)
}

// ── 집합 단위 검사 ─────────────────────────────────────────

function checkCollisions(published, drafts, queue, report) {
  const id = '(전체)'

  // 8 · slug 중복 — 발행분끼리
  const seen = new Set()
  for (const a of published) {
    if (seen.has(a.slug)) report.fail(id, `발행 글 slug 중복: ${a.slug}`)
    seen.add(a.slug)
  }

  // 8 · draft ↔ 발행분
  for (const d of drafts) {
    if (seen.has(d.slug)) {
      report.warn(id, `draft "${d.slug}" 는 이미 발행됐다 — 발행 후 남은 draft 인지 확인`)
    }
  }

  // 8 · queue ↔ 발행분
  for (const item of queue) {
    if (seen.has(item.slug)) {
      report.fail(id, `queue day ${item.day} slug "${item.slug}" 가 이미 발행됐다`)
    }
  }

  // queue 내부 slug 중복
  const queueSeen = new Set()
  for (const item of queue) {
    if (queueSeen.has(item.slug)) report.fail(id, `queue slug 중복: ${item.slug}`)
    queueSeen.add(item.slug)
  }

  // 9 · seriesOrder 충돌 — 발행분 + queue 를 같은 시리즈 축에서 본다
  const orders = new Map()
  const track = (sid, order, label) => {
    if (!sid || order === undefined) return
    const key = `${sid}#${order}`
    if (orders.has(key)) report.fail(id, `seriesOrder 충돌 ${key}: ${orders.get(key)} ↔ ${label}`)
    else orders.set(key, label)
  }
  for (const a of published) track(a.seriesId, a.seriesOrder, a.slug)
  for (const item of queue) track(item.seriesId, item.seriesOrder, `queue:${item.slug}`)
}

// ── 출력 ───────────────────────────────────────────────────

function printHuman(result) {
  console.log('')
  console.log(
    `매거진 QA — 공개 ${result.counts.live}건 · 예약·차단 ${result.counts.pending}건 · ` +
      `draft ${result.counts.drafts}건 · queue ${result.counts.queue}건`,
  )
  console.log('')

  for (const row of result.rows) {
    const mark = row.level === 'FAIL' ? '✗ FAIL' : '! WARN'
    console.log(`  ${mark}  [${row.id}] ${row.msg}`)
  }
  if (result.rows.length === 0) console.log('  ✓ 지적 사항 없음')

  console.log('')
  console.log(`  검사 ${result.counts.checked}건 · FAIL ${result.fail} · WARN ${result.warn}`)
  console.log('')
}

// ── CLI ────────────────────────────────────────────────────

/**
 * 검사를 실행하고 결과 객체를 돌려준다. 출력도 종료도 하지 않는다.
 * 다른 스크립트(패킷 생성기 등)가 import 해서 쓰는 진입점이다.
 *
 * @param {{ draftPath?: string, publishedOnly?: boolean }} options
 */
export function runQa(options = {}) {
  const { draftPath, publishedOnly = false, scheduledOnly = false } = options

  const published = loadPublished()
  const queue = loadQueue()
  const report = createReport()

  let drafts = []
  if (draftPath) {
    drafts = [loadDraft(isAbsolute(draftPath) ? draftPath : join(ROOT, draftPath))]
  } else if (!publishedOnly) {
    drafts = findDraftPaths().map(loadDraft)
  }

  // 이미 발행된 slug 의 draft 는 stale 이다. 정본은 articles.ts 이므로 두 번 검사하지 않는다.
  const publishedSlugs = new Set(published.map((a) => a.slug))
  const freshDrafts = drafts.filter((d) => !publishedSlugs.has(d.slug))

  // articles.ts 안에서 공개분과 미공개분을 가른다.
  // 미공개분도 검사한다 — 공개 전에 잡는 것이 목적이다.
  const live = published.filter((a) => isPublic(a))
  const pending = published.filter((a) => !isPublic(a))

  const targets = draftPath
    ? drafts
    : publishedOnly
      ? live
      : scheduledOnly
        ? pending
        : [...published, ...freshDrafts]

  for (const article of targets) {
    checkArticle(article, { published }, report)
  }
  if (!draftPath) {
    checkCollisions(published, drafts, queue, report)
  } else {
    // 단독 검사에서도 "이미 발행된 글의 낡은 draft"는 알려준다.
    for (const d of drafts) {
      if (publishedSlugs.has(d.slug)) {
        report.warn(d.slug, 'draft 이지만 이미 발행됐다 — articles.ts 가 정본이다')
      }
    }
  }

  // 공개 판정 드리프트 — 어떤 모드에서든 항상 검사한다.
  // 이게 어긋나면 아래 모든 판정의 전제가 무너진다.
  const gate = assertGateInSync()
  for (const why of gate.problems) {
    report.fail('(공개 판정)', `런타임(src/lib/magazine.ts)과 어긋난다 — ${why}`)
  }

  const fail = report.rows.filter((r) => r.level === 'FAIL').length
  const warn = report.rows.filter((r) => r.level === 'WARN').length

  return {
    ok: fail === 0,
    fail,
    warn,
    counts: {
      published: published.length,
      live: live.length,
      pending: pending.length,
      drafts: drafts.length,
      queue: queue.length,
      checked: targets.length,
    },
    checked: targets.map((a) => a.slug),
    rows: report.rows,
  }
}

function main() {
  const args = process.argv.slice(2)
  const draftFlag = args.indexOf('--draft')
  const asJson = args.includes('--json')

  let draftPath
  if (draftFlag !== -1) {
    draftPath = args[draftFlag + 1]
    if (!draftPath || draftPath.startsWith('--')) {
      console.error('--draft 뒤에 파일 경로가 필요하다')
      process.exit(2)
    }
  }

  const result = runQa({
    draftPath,
    publishedOnly: args.includes('--published'),
    scheduledOnly: args.includes('--scheduled'),
  })

  // --json 일 때는 JSON 외의 문자를 stdout 에 섞지 않는다.
  if (asJson) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)

  process.exit(result.ok ? 0 : 1)
}

// import 해서 쓸 때는 CLI 를 돌리지 않는다.
if (process.argv[1] && process.argv[1].endsWith('magazine-qa.mjs')) main()
