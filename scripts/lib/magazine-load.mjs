/**
 * 매거진 정적 로더 (공용)
 *
 * articles.ts · topic-queue.ts 는 런타임 import 없이 텍스트로 읽어 파싱한다.
 * 같은 로더가 qa.mjs · packet.mjs 에 각각 있었다. producer 까지 3벌이 되면
 * 하나만 고쳐지는 사고가 나므로 여기로 모은다.
 *
 * 🔴 이 파일은 읽기만 한다. 어떤 파일도 쓰지 않는다.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

export const ROOT = process.cwd()
export const ARTICLES_TS = join(ROOT, 'src/content/magazine/articles.ts')
export const QUEUE_TS = join(ROOT, 'drafts/magazine/topic-queue.ts')
export const DRAFTS_DIR = join(ROOT, 'drafts/magazine')

/**
 * 객체·배열 리터럴을 문자열에서 통째로 떼어낸다.
 * 문자열 안의 괄호와 주석 안의 괄호를 세지 않는다 — 그래서 정규식이 아니라 스캐너다.
 */
export function sliceLiteral(source, fromIndex, open, close) {
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

/** 격리된 컨텍스트에서 평가한다. 전역을 주지 않아 파일이 코드를 실행할 수 없다. */
export function evalLiteral(literal, label) {
  try {
    return runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })
  } catch (err) {
    throw new Error(`${label} 파싱 실패: ${err.message}`)
  }
}

/**
 * articles.ts 전량. 공개·예약(SCHEDULED)·차단(BLOCKED)·초안(DRAFT)을 **가리지 않는다**.
 * 🔴 상태로 거르면 이미 예약한 글을 다시 뽑는다. 중복 판정은 항상 전량 기준이다.
 */
export function loadArticles() {
  const src = readFileSync(ARTICLES_TS, 'utf8')
  const anchor = src.indexOf('MAGAZINE_ARTICLE_RECORD')
  if (anchor === -1) throw new Error('articles.ts 에서 MAGAZINE_ARTICLE_RECORD 를 찾지 못했다')
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  const record = evalLiteral(literal, 'articles.ts')
  return Object.entries(record).map(([slug, article]) => ({ slug, ...article }))
}

export function loadQueue() {
  if (!existsSync(QUEUE_TS)) return []
  const src = readFileSync(QUEUE_TS, 'utf8')
  const anchor = src.indexOf('export const TOPIC_QUEUE')
  if (anchor === -1) return []
  // 타입 주석의 대괄호(TopicQueueItem[])를 잡지 않도록 대입 기호 뒤에서 찾는다.
  const assign = src.indexOf('=', anchor)
  const literal = assign === -1 ? null : sliceLiteral(src, assign, '[', ']')
  return literal ? evalLiteral(literal, 'topic-queue.ts') : []
}
