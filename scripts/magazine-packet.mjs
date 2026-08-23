#!/usr/bin/env node
/**
 * 검수 패킷 생성기
 *
 * 창업자가 LOW 30초 · MEDIUM 2분 · HIGH 전문 검수로 판단할 수 있게
 * 흩어진 자료를 한 화면으로 조립한다 (매거진 전략 §5.1).
 *
 * ⚠️ 이 스크립트가 하지 않는 것 (전략 §3.0 역할 분리)
 *    요약을 만들지 않는다 · 위험 문장을 추론하지 않는다 · 원고를 고치지 않는다
 *    review.ts 를 쓰지 않는다 · 승인하지 않는다
 *    이미 저장된 값을 읽고, 서로 맞는지 검증하고, 붙여서 보여줄 뿐이다.
 *
 * 그 경계를 기계가 지키는 지점
 *    review.ts 의 riskSentences 가 article-draft.ts 본문에 그대로 있는지 대조한다.
 *    없으면 FAIL — 원고가 바뀌었거나 review 가 낡았다는 뜻이다.
 *
 * 사용법
 *   node scripts/magazine-packet.mjs --draft drafts/magazine/<slug>
 *   node scripts/magazine-packet.mjs --draft <dir> --out drafts/magazine/<slug>/packet.md
 *   node scripts/magazine-packet.mjs --fixture
 *
 * 종료 코드: 검증 오류가 있으면 1, 아니면 0
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, relative, basename, isAbsolute } from 'node:path'
import { runInNewContext } from 'node:vm'
import { runQa } from './magazine-qa.mjs'

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'drafts')
const MAGAZINE_DRAFTS = join(ROOT, 'drafts/magazine')
const QUEUE_TS = join(ROOT, 'drafts/magazine/topic-queue.ts')
const ARTICLES_TS = join(ROOT, 'src/content/magazine/articles.ts')
const PUBLIC_DIR = join(ROOT, 'public')
const FIXTURE_DIR = join(ROOT, 'scripts/__fixtures__/magazine-packet')

const HERO_WIDTH = 1200
const HERO_HEIGHT = 675

/**
 * review.ts 를 만들 수 있는 주체.
 * 최종 원고는 언제나 ChatGPT 가 쓴다 — 여기에 ChatGPT 가 들어오면 자기 검열이 된다.
 */
const PREPARED_BY_ALLOWED = new Set(['Claude 채팅', 'Claude Code'])

/** 등급별로 패킷에 무엇을 넣는가 (전략 §5.1) */
const SHOW_RISK_SENTENCES = new Set(['MEDIUM', 'HIGH'])
const SHOW_FULL_BODY = new Set(['HIGH'])

// ── TS 리터럴 읽기 ─────────────────────────────────────────
// magazine-qa.mjs 는 runQa() 만 내보낸다. 로더는 여기서 따로 갖는다.

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
 * vm.runInNewContext 로 데이터 리터럴만 평가한다.
 * 새 컨텍스트에 전역이 없어 require · process · fetch · fs 접근이 불가능하다.
 */
function evalLiteral(literal, label) {
  try {
    return runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })
  } catch (err) {
    throw new Error(`${label} 파싱 실패: ${err.message}`)
  }
}

function loadNamedLiteral(path, exportName, open, close) {
  const src = readFileSync(path, 'utf8')
  const anchor = src.indexOf(`export const ${exportName}`)
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), open, close)
  return literal ? evalLiteral(literal, path) : null
}

function loadQueue() {
  if (!existsSync(QUEUE_TS)) return []
  return loadNamedLiteral(QUEUE_TS, 'TOPIC_QUEUE', '[', ']') ?? []
}

function loadPublished() {
  if (!existsSync(ARTICLES_TS)) return []
  const src = readFileSync(ARTICLES_TS, 'utf8')
  const anchor = src.indexOf('MAGAZINE_ARTICLE_RECORD')
  if (anchor === -1) return []
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  const record = literal ? evalLiteral(literal, ARTICLES_TS) : {}
  return Object.entries(record).map(([slug, a]) => ({ slug, ...a }))
}

// ── 본문 텍스트 ────────────────────────────────────────────

function collectText(body) {
  const parts = []
  for (const block of body ?? []) {
    if (typeof block.text === 'string') parts.push(block.text)
    if (Array.isArray(block.items)) parts.push(...block.items)
  }
  return parts
}

function readWebpSize(path) {
  const buf = readFileSync(path)
  if (buf.length < 30) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
  if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  if (fourcc === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

// ── 검증 ───────────────────────────────────────────────────

/**
 * 패킷을 만들기 전에 자료가 서로 맞는지 본다.
 * 여기서 걸리면 패킷을 만들지 않는다 — 틀린 자료로 승인을 받는 것이 가장 나쁘다.
 */
function validate(draftDir, article, review, queueItem) {
  const errors = []

  if (!review) {
    errors.push('review.ts 가 없습니다. Claude 채팅 산출물로 먼저 생성해야 합니다.')
    return errors
  }

  if (!Array.isArray(review.summary) || review.summary.length !== 5) {
    errors.push(`review.summary 가 5개가 아닙니다 (현재 ${review.summary?.length ?? 0}개)`)
  }

  // 요건은 도구 이름이 아니라 분리다 — 최종 원고를 쓴 주체(ChatGPT)가 아니어야 한다.
  if (!PREPARED_BY_ALLOWED.has(review.preparedBy)) {
    errors.push(
      `review.preparedBy 가 허용값이 아닙니다 (현재 "${review.preparedBy}" · 허용 ${[...PREPARED_BY_ALLOWED].join(' | ')})`,
    )
  }

  const riskLevel = queueItem?.riskLevel ?? 'MEDIUM'
  const needsRiskSentences = SHOW_RISK_SENTENCES.has(riskLevel)

  if (needsRiskSentences) {
    if (!Array.isArray(review.riskSentences) || review.riskSentences.length !== 5) {
      errors.push(
        `${riskLevel} 은 riskSentences 5개가 필수입니다 (현재 ${review.riskSentences?.length ?? 0}개)`,
      )
    } else {
      // 핵심 검증 — 위험 문장이 원고에 실제로 있는가
      const bodyText = collectText(article.body).join('\n')
      review.riskSentences.forEach((sentence, i) => {
        if (!bodyText.includes(sentence)) {
          errors.push(
            `위험 문장 ${i + 1}이 원고에 없습니다. 원고가 바뀌었거나 review.ts 가 낡았습니다.`,
          )
        }
      })
    }
  }

  // slug 일치 — 실제 draft 디렉터리일 때만 디렉터리명과 대조한다(fixture 제외)
  const inMagazineDrafts = resolve(draftDir).startsWith(MAGAZINE_DRAFTS)
  if (inMagazineDrafts && review.slug !== basename(draftDir)) {
    errors.push(`review.slug "${review.slug}" 가 디렉터리명 "${basename(draftDir)}" 과 다릅니다`)
  }
  if (queueItem && queueItem.slug !== review.slug) {
    errors.push(`queue slug "${queueItem.slug}" 가 review.slug "${review.slug}" 와 다릅니다`)
  }

  return errors
}

/** 등급과 무관하게 전문 검수로 올리는 조건 (전략 §5.2 중 기계가 판정 가능한 것) */
function findEscalations(article, queueItem, qa, published) {
  const reasons = []
  if (queueItem?.riskLevel === 'HIGH') reasons.push('riskLevel = HIGH')
  if (qa.fail > 0) reasons.push(`자동 QA FAIL ${qa.fail}건`)
  if (article.seriesId && article.seriesOrder === 1) reasons.push('시리즈의 첫 편')
  if (article.cluster && !published.some((p) => p.cluster === article.cluster)) {
    reasons.push(`새 클러스터의 첫 글 (${article.cluster})`)
  }
  return reasons
}

// ── 패킷 조립 ──────────────────────────────────────────────

function buildPacket({ article, review, queueItem, qa, escalations, published }) {
  const riskLevel = queueItem?.riskLevel ?? 'MEDIUM'
  const effectiveMode = escalations.length > 0 ? 'FULL_REVIEW' : (queueItem?.reviewMode ?? 'RISK_SENTENCES')
  const showRisk = SHOW_RISK_SENTENCES.has(riskLevel) || effectiveMode === 'FULL_REVIEW'
  const showBody = SHOW_FULL_BODY.has(riskLevel) || effectiveMode === 'FULL_REVIEW'

  const L = []
  const line = (s = '') => L.push(s)

  // 1 · 헤더
  line(`# [${riskLevel}] ${queueItem ? `day ${queueItem.day} · ` : ''}${article.title}`)
  line()
  line(`\`${review.slug}\``)
  line()

  if (escalations.length > 0) {
    line(`> ⚠️ **FULL_REVIEW 로 승격됨** — ${escalations.join(' · ')}`)
    line()
  }

  // 2 · 맥락
  line('## 맥락')
  line()
  line('| | |')
  line('|---|---|')
  if (queueItem) {
    line(`| 검색 의도 | ${queueItem.searchIntent} |`)
    line(`| 대상 독자 | ${queueItem.targetReader} |`)
  }
  line(`| cluster | ${article.cluster} |`)
  line(
    `| 시리즈 | ${article.seriesId ? `${article.seriesId} #${article.seriesOrder}` : '단발 글'} |`,
  )
  line(`| 검수 깊이 | ${effectiveMode} (목표 ${riskLevel === 'LOW' ? '30초' : riskLevel === 'MEDIUM' ? '2분' : '10~15분'}) |`)
  line()

  // 3 · 요약
  line('## 요약')
  line()
  review.summary.forEach((s, i) => line(`${i + 1}. ${s}`))
  line()

  // 4 · 위험 문장
  if (showRisk && Array.isArray(review.riskSentences)) {
    line('## 위험 문장 — 원고에서 그대로 옮긴 것 (전부 대조 통과)')
    line()
    review.riskSentences.forEach((s, i) => line(`${i + 1}. "${s}"`))
    line()
  }

  // 5 · 리스크 3축
  line('## 리스크')
  line()
  line(`의료 **${review.risk.medical}** · 금전 **${review.risk.money}** · 법률 **${review.risk.legal}**`)
  line()

  // 6 · CTA
  const cta = (article.body ?? []).find((b) => b.type === 'cta')
  line('## CTA')
  line()
  line(cta ? `\`${cta.href}\` — ${cta.label}` : '⚠️ CTA 블록이 없다')
  line()

  // 7 · 이미지
  line('## 이미지')
  line()
  if (article.heroImage) {
    const filePath = join(PUBLIC_DIR, String(article.heroImage.src).replace(/^\//, ''))
    let sizeNote = '파일 없음'
    if (existsSync(filePath)) {
      const size = readWebpSize(filePath)
      sizeNote = size
        ? `${size.width}×${size.height}${size.width === HERO_WIDTH && size.height === HERO_HEIGHT ? ' ✅' : ' ⚠️ 기준과 다름'}`
        : '크기 확인 불가'
    }
    line(`- 경로: \`public${article.heroImage.src}\` (${sizeNote})`)
    line(`- alt: ${article.heroImage.alt}`)
    line('- 인물이 40대 후반으로 보이는가? ☐ 예   ☐ 아니오(재생성)')
  } else {
    const need = queueItem?.imageNeeded ?? 'OPTIONAL'
    line(need === 'REQUIRED' ? '⚠️ hero 가 없다 — 큐가 REQUIRED 로 지정한 글이다' : 'hero 없음 (큐 지정: OPTIONAL)')
  }
  line()

  // 8 · 자동 QA
  line('## 자동 QA')
  line()
  line(`FAIL ${qa.fail} · WARN ${qa.warn}`)
  if (qa.rows.length > 0) {
    line()
    for (const row of qa.rows) line(`- **${row.level}** [${row.id}] ${row.msg}`)
  }
  line()

  // 9 · 사실관계 (HIGH 만)
  if (showBody && review.factsToVerify?.length) {
    line('## 창업자가 확인해야 할 사실관계')
    line()
    for (const f of review.factsToVerify) line(`- ☐ ${f}`)
    line()
  }

  // 10 · 권장 판단
  const recommend =
    qa.fail > 0 ? '수정 요청' : escalations.length > 0 ? '전문 검수 후 판단' : '승인'
  const because =
    qa.fail > 0
      ? `자동 QA FAIL ${qa.fail}건`
      : escalations.length > 0
        ? escalations.join(' · ')
        : 'QA FAIL 0 · 승격 조건 미해당'
  line('## 권장 판단')
  line()
  line(`**${recommend}** — ${because}`)
  line()

  // 11 · 창업자 체크박스
  line('## 창업자 확인')
  line()
  line('- ☐ 제목이 실제로 검색할 문장인가')
  if (article.heroImage) line('- ☐ 이미지 인물 나이가 적합한가')
  if (showRisk) line('- ☐ 위험 문장 5개를 확인했는가')
  line('- ☐ CTA 톤이 광고처럼 읽히지 않는가')
  line('- ☐ **공개 승인**   ☐ 수정 요청   ☐ 폐기')
  line()

  // 12 · 본문 전문 (HIGH)
  if (showBody) {
    line('---')
    line()
    line('## 본문 전문')
    line()
    for (const block of article.body ?? []) {
      if (block.type === 'h2') line(`### ${block.text}`)
      else if (block.type === 'h3') line(`#### ${block.text}`)
      else if (block.type === 'p') line(block.text)
      else if (block.type === 'callout') line(`> ${block.text}`)
      else if (block.type === 'list') for (const item of block.items) line(`- ${item}`)
      else if (block.type === 'cta') line(`**[CTA]** ${block.text ?? ''} → ${block.label} (${block.href})`)
      line()
    }
  }

  line('---')
  line()
  line(`review 작성: ${review.preparedBy} · ${review.preparedAt}`)
  if (review.notes) line(`비고: ${review.notes}`)

  return L.join('\n')
}

// ── 실행 ───────────────────────────────────────────────────

function generate(draftDir) {
  const dir = isAbsolute(draftDir) ? draftDir : join(ROOT, draftDir)
  const articlePath = join(dir, 'article-draft.ts')
  const reviewPath = join(dir, 'review.ts')

  if (!existsSync(articlePath)) {
    return { errors: [`article-draft.ts 가 없습니다: ${relative(ROOT, articlePath)}`] }
  }

  const article = loadNamedLiteral(articlePath, 'DRAFT', '{', '}')
  if (!article) return { errors: [`${relative(ROOT, articlePath)} 에서 DRAFT 를 찾지 못했습니다`] }

  const review = existsSync(reviewPath) ? loadNamedLiteral(reviewPath, 'REVIEW', '{', '}') : null
  const queue = loadQueue()
  const published = loadPublished()
  const queueItem = review ? queue.find((q) => q.slug === review.slug) : undefined

  const errors = validate(dir, article, review, queueItem)
  if (errors.length > 0) return { errors }

  const qa = runQa({ draftPath: articlePath })
  const escalations = findEscalations(article, queueItem, qa, published)

  return { packet: buildPacket({ article, review, queueItem, qa, escalations, published }) }
}

/** --out 은 drafts/ 안으로만 쓴다. 원고나 src 를 덮어쓸 여지를 남기지 않는다. */
function assertSafeOut(outPath) {
  const abs = isAbsolute(outPath) ? outPath : join(ROOT, outPath)
  if (!resolve(abs).startsWith(DRAFTS_DIR)) {
    console.error('--out 은 drafts/ 하위 경로만 허용한다')
    process.exit(2)
  }
  return abs
}

function runFixtures() {
  const cases = [
    { name: 'medium', expectOk: true, expectBody: false },
    { name: 'high', expectOk: true, expectBody: true },
  ]
  let failed = 0

  for (const c of cases) {
    const dir = join(FIXTURE_DIR, c.name)
    const result = generate(dir)
    const ok = !result.errors
    const hasBody = Boolean(result.packet?.includes('## 본문 전문'))
    const hasRisk = Boolean(result.packet?.includes('## 위험 문장'))

    const pass = ok === c.expectOk && hasBody === c.expectBody && hasRisk
    if (!pass) failed += 1
    console.log(
      `  ${pass ? '✓' : '✗'} ${c.name}: 생성 ${ok ? 'OK' : 'ERR'} · 본문전문 ${hasBody} (기대 ${c.expectBody}) · 위험문장 ${hasRisk}`,
    )
    if (result.errors) for (const e of result.errors) console.log(`      ${e}`)
  }

  // review.ts 누락 검증 — 존재하지 않는 디렉터리로 확인
  const missing = generate(join(FIXTURE_DIR, 'medium-no-review'))
  const missingOk = Boolean(missing.errors?.[0]?.includes('article-draft.ts 가 없습니다'))
  console.log(`  ${missingOk ? '✓' : '✗'} 없는 draft 디렉터리 → 오류 반환`)
  if (!missingOk) failed += 1

  // 위험 문장 대조 실패 검증 — 원고에 없는 문장을 끼워 넣어 본다
  const dir = join(FIXTURE_DIR, 'medium')
  const article = loadNamedLiteral(join(dir, 'article-draft.ts'), 'DRAFT', '{', '}')
  const review = loadNamedLiteral(join(dir, 'review.ts'), 'REVIEW', '{', '}')
  const queueItem = loadQueue().find((q) => q.slug === review.slug)
  const tampered = { ...review, riskSentences: [...review.riskSentences] }
  tampered.riskSentences[2] = '원고에 존재하지 않는 문장이다'
  const mismatch = validate(dir, article, tampered, queueItem)
  const mismatchOk = mismatch.some((e) => e.includes('위험 문장 3이 원고에 없습니다'))
  console.log(`  ${mismatchOk ? '✓' : '✗'} 위험 문장 대조 실패 → FAIL 검출`)
  if (!mismatchOk) failed += 1

  // preparedBy 검증 — 원고를 쓴 주체(ChatGPT)가 들어오면 자기 검열이라 FAIL 이어야 한다
  const wrongBy = validate(dir, article, { ...review, preparedBy: 'ChatGPT' }, queueItem)
  const wrongByOk = wrongBy.some((e) => e.includes('preparedBy'))
  console.log(`  ${wrongByOk ? '✓' : '✗'} preparedBy 위반 → FAIL 검출`)
  if (!wrongByOk) failed += 1

  // summary 개수 검증
  const shortSummary = validate(dir, article, { ...review, summary: review.summary.slice(0, 4) }, queueItem)
  const shortOk = shortSummary.some((e) => e.includes('summary 가 5개가 아닙니다'))
  console.log(`  ${shortOk ? '✓' : '✗'} summary 4개 → FAIL 검출`)
  if (!shortOk) failed += 1

  return failed
}

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--fixture')) {
    console.log('')
    console.log('패킷 생성기 자체 검증')
    console.log('')
    const failed = runFixtures()
    console.log('')
    console.log(failed === 0 ? '  전부 통과' : `  ${failed}건 실패`)
    console.log('')
    process.exit(failed === 0 ? 0 : 1)
  }

  const draftFlag = args.indexOf('--draft')
  if (draftFlag === -1 || !args[draftFlag + 1]) {
    console.error('사용법: node scripts/magazine-packet.mjs --draft <draft 디렉터리> [--out <경로>]')
    process.exit(2)
  }

  const result = generate(args[draftFlag + 1])

  if (result.errors) {
    console.error('')
    console.error('패킷을 만들지 않았다 — 자료가 서로 맞지 않는다')
    console.error('')
    for (const e of result.errors) console.error(`  ✗ ${e}`)
    console.error('')
    process.exit(1)
  }

  const outFlag = args.indexOf('--out')
  if (outFlag !== -1 && args[outFlag + 1]) {
    const outPath = assertSafeOut(args[outFlag + 1])
    writeFileSync(outPath, `${result.packet}\n`, 'utf8')
    console.log(`패킷을 썼다: ${relative(ROOT, outPath)}`)
  } else {
    console.log(result.packet)
  }
  process.exit(0)
}

main()
