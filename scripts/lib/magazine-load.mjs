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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

/**
 * repo 루트는 **이 파일의 위치**로 정한다. process.cwd() 를 쓰지 않는다.
 *
 * 🔴 이유: 같은 repo 의 worktree 가 여러 개 있다.
 *    /Users/yanadoo/Documents/soransoran      main
 *    /Users/yanadoo/Documents/soransoran-m0   feat/micro-seed-m0-gates
 *    cwd 기준이면 launchd 의 WorkingDirectory 를 한 줄 잘못 적는 순간
 *    다른 worktree 의 articles.ts 로 재고를 계산하고 그쪽 큐에서 주제를 뽑는다.
 *    (우나어 UNAO_WORKDIR 사고와 같은 유형)
 *    파일 위치 기준이면 어느 디렉터리에서 실행하든 자기 repo 를 본다.
 */
const HERE = dirname(fileURLToPath(import.meta.url)) // scripts/lib
export const ROOT = resolve(HERE, '..', '..')
export const ARTICLES_TS = join(ROOT, 'src/content/magazine/articles.ts')
export const QUEUE_TS = join(ROOT, 'drafts/magazine/topic-queue.ts')
/**
 * 🔴 **시험만 옮길 수 있는 자리.** 기본은 저장소의 실제 폴더다.
 *
 *    통합 시험이 임시 fixture 를 만들어도 최상위 CLI 가 운영 폴더를 보면
 *    시험은 **운영 상태**를 검사하는 셈이 된다 — 운영이 비면 초록, 차면 빨강.
 *    그건 코드 판정이 아니다. 그래서 하위 프로세스에 폴더를 넘길 길을 하나 둔다.
 *
 *    🔴 운영 경로에서는 이 변수를 **설정하지 않는다.** launchd 도 넘기지 않는다.
 */
/**
 * 🔴 **시험 주입은 시험 모드에서만 열린다** (2026-09-28 · P1).
 *    폴더를 갈아끼우는 손잡이가 운영에서 켜지면, 자동화가 **엉뚱한 폴더의 원고**를
 *    읽고 쓴다. 그건 조용히 잘못되는 종류다 — 로그만 보면 정상이다.
 *    그래서 `SORAN_MAGAZINE_TEST_MODE=1` 이 같이 있어야만 받아들이고,
 *    없이 설정돼 있으면 **첫 read/write 전에** 멈춘다. 무시하고 기본값으로 가지 않는다 —
 *    누군가 의도해서 설정한 값을 말없이 버리는 것도 사고다.
 */
export const MAGAZINE_TEST_MODE = process.env.SORAN_MAGAZINE_TEST_MODE === '1'

export function resolveDraftsDir(env = process.env) {
  const injected = env.SORAN_MAGAZINE_DRAFTS_DIR
  const testMode = env.SORAN_MAGAZINE_TEST_MODE === '1'
  if (!injected) return { ok: true, dir: join(ROOT, 'drafts/magazine'), injected: false }
  if (!testMode) {
    return {
      ok: false,
      code: 'DRAFTS_DIR_INJECTION_BLOCKED',
      why: 'SORAN_MAGAZINE_DRAFTS_DIR 는 SORAN_MAGAZINE_TEST_MODE=1 일 때만 쓴다 — 운영에서는 금지다',
    }
  }
  return { ok: true, dir: resolve(injected), injected: true }
}

const draftsResolved = resolveDraftsDir()
if (!draftsResolved.ok) {
  // 🔴 첫 read/write 전에 끝낸다. 모듈이 적재되는 순간이 가장 이르다.
  console.error('')
  console.error(`  ⛔ ${draftsResolved.code} — ${draftsResolved.why}`)
  console.error('     파일을 하나도 읽거나 쓰지 않았다.')
  console.error('')
  process.exit(2)
}
export const DRAFTS_DIR = draftsResolved.dir

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
/**
 * **소스 문자열**에서 글 목록을 읽는다 — 디스크가 아니라 넘겨받은 내용으로.
 *
 * 🔴 **왜 필요한가** (2026-09-16 검토).
 *    자동 병합은 `git show <sha>:...` 로 받은 **다른 커밋의 소스**를 읽어야 한다.
 *    그때 정규식으로 대충 훑으면 객체 경계를 놓친다 — 실제로 자동 병합의
 *    `parseQueue` 가 "slug 뒤 900자" 라는 창으로 등급을 읽고 있었고,
 *    항목이 900자를 넘거나 인접 항목이 가까우면 **옆 항목의 값을 집어 온다.**
 *
 *    파싱은 한 벌이어야 한다. `loadArticles`/`loadQueue` 와 **같은 함수**를 쓴다.
 */
export function parseArticlesSource(src, label = 'articles.ts') {
  const anchor = String(src ?? '').indexOf('MAGAZINE_ARTICLE_RECORD')
  if (anchor === -1) throw new Error(`${label} 에서 MAGAZINE_ARTICLE_RECORD 를 찾지 못했다`)
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  const record = evalLiteral(literal, label)
  return Object.entries(record).map(([slug, article]) => ({ slug, ...article }))
}

/** 소스 문자열에서 큐를 읽는다. `loadQueue` 와 같은 경계 판정이다 */
export function parseQueueSource(src, label = 'topic-queue.ts') {
  const text = String(src ?? '')
  const anchor = text.indexOf('export const TOPIC_QUEUE')
  if (anchor === -1) return []
  // 타입 주석의 대괄호(TopicQueueItem[])를 잡지 않도록 대입 기호 뒤에서 찾는다.
  const assign = text.indexOf('=', anchor)
  const literal = assign === -1 ? null : sliceLiteral(text, assign, '[', ']')
  return literal ? evalLiteral(literal, label) : []
}

export function loadArticles() {
  return parseArticlesSource(readFileSync(ARTICLES_TS, 'utf8'), 'articles.ts')
}

export function loadQueue() {
  if (!existsSync(QUEUE_TS)) return []
  return parseQueueSource(readFileSync(QUEUE_TS, 'utf8'), 'topic-queue.ts')
}
