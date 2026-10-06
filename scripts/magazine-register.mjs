#!/usr/bin/env node
/**
 * 매거진 예약 등록 — article-draft.ts 를 articles.ts 에 SCHEDULED 로 올리고 큐에서 뺀다.
 *
 * 사람이 articles.ts 와 topic-queue.ts 를 손으로 고치지 않게 하는 것이 목적이다.
 * 지금까지는 세션이 매번 두 파일을 직접 편집했다 — 가장 손이 많이 가고 가장 틀리기 쉬운 자리다.
 *
 * 🔴 기본이 dry-run 이다. --write 를 명시해야만 파일을 고친다.
 *    실수로 articles.ts 가 바뀌는 쪽보다 아무 일도 안 일어나는 쪽이 낫다.
 *
 * 🔴 부분 수정을 하지 않는다.
 *    두 파일(articles.ts · topic-queue.ts)을 메모리에서 모두 만든 뒤 한꺼번에 쓴다.
 *    중간에 실패하면 아무것도 쓰지 않는다 — 한쪽만 바뀐 상태가 가장 고치기 어렵다.
 *
 * 🔴 판정이 애매하면 BLOCKED 로 끝낸다.
 *    삽입 위치를 못 찾거나 큐에서 제거 대상이 1개가 아니면 추측하지 않는다.
 *
 * 사용법
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02 --write
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at ... --json
 *
 * 🔴 **두 파일 쓰기는 durable transaction 이다** (2026-10-06 · Codex P0).
 *    articles.ts 를 쓴 직후 프로세스가 SIGKILL 되면 글은 들어갔는데 큐에는 행이 남고, 다음 회차는
 *    중복으로 BLOCKED 되어 영영 풀리지 않았다. 이제 큐 writer 잠금 안에서
 *      복구 → 재판정 → journal(원자 기록) → articles → queue → 사후 검증 → journal 삭제
 *    순서로 쓰고, 다음 --write 는 plan 의 중복 판정보다 **먼저** 남은 journal 을 복구한다.
 *    journal: `drafts/magazine/_runs/.register-journal.json` (gitignore · 큐와 같은 worktree).
 *
 * 종료 코드: BLOCKED 면 1, 아니면 0
 */
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, renameSync, unlinkSync, openSync, writeSync, fsyncSync, closeSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadArticles, loadQueue, sliceLiteral, evalLiteral, ROOT, ARTICLES_TS, QUEUE_TS, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { withQueueWriteLock, removeQueueDay, queueTestPause, QUEUE_LOCKED_CODE } from './lib/magazine-queue-lock.mjs'

/**
 * 🔴 큐 writer 잠금을 기다리는 최대 시간. G8 편입기 apply 의 임계구역은 짧다(ms) —
 *    그보다 오래 쥐고 있으면 기다리지 않고 이번 등록을 INFRA 실패(`queue_writer_locked`)로 넘긴다.
 */
export const REGISTER_QUEUE_LOCK_WAIT_MS = 2000

/** 운영 전략서 §4. 공개 시각은 하나로 고정한다 */
const KST_TIME = 'T10:30:00+09:00'
// 🔴 AUTO_RISK 제거 (M3-A · SUPERSEDED) — 등급으로 등록을 막지 않는다

/**
 * 🔴 **사람 승인 손잡이는 M3-A 에서 없앴다.**
 *    등급으로 등록을 막지 않으므로 "창업자가 건별로 여는 문" 이 필요 없다.
 *    `--founder-approved` 인자는 옛 호출부 호환을 위해 받기만 하고 **아무것도 열지 않는다.**
 */
/** 이 앵커 앞에 레코드를 넣는다. 없으면 파일 구조가 바뀐 것이므로 멈춘다 */
const ANCHOR = '} satisfies Record<string, MagazineArticleBody>'

// ── publishAt ──────────────────────────────────────────────

/**
 * 날짜만 오면 10:30 KST 로 보정한다. ISO 가 오면 KST 기준 시각을 검증한다.
 * 하루 1건 원칙이라 "몇 시인가"보다 "무슨 날인가"가 중요하다.
 */
export function normalizePublishAt(input) {
  if (!input) return { ok: false, why: '--publish-at 이 필요하다' }

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: true, date: input, publishAt: `${input}${KST_TIME}` }
  }

  const t = Date.parse(input)
  if (Number.isNaN(t)) return { ok: false, why: `날짜를 해석하지 못했다: ${input}` }

  // KST 로 환산해 날짜와 시각을 본다
  const kst = new Date(t + 9 * 60 * 60 * 1000).toISOString()
  const date = kst.slice(0, 10)
  const hhmm = kst.slice(11, 16)
  if (hhmm !== '10:30') {
    return { ok: false, why: `공개 시각은 10:30 KST 여야 한다 (받은 값: ${hhmm} KST)` }
  }
  return { ok: true, date, publishAt: input }
}

/** 이미 잡힌 날짜를 모은다. publishAt 이 없으면 publishedAt 이 그날 10:30 이다 */
function takenDates(articles) {
  const m = new Map()
  for (const a of articles) {
    const d = a.publishAt ? new Date(a.publishAt) : null
    const date = d && !Number.isNaN(+d)
      ? new Date(+d + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : a.publishedAt
    if (date) m.set(date, a.slug)
  }
  return m
}

/**
 * 삽입 위치(`ANCHOR`)가 닫는 레코드 리터럴을 읽는다 — 변수 이름이 아니라 **실제로 글이 들어갈 그 객체**다.
 * 🔴 읽지 못하면 추정하지 않는다 — 호출부가 쓰기 0 으로 멈춘다.
 */
function recordAtAnchor(src) {
  const at = src.lastIndexOf(ANCHOR)
  if (at === -1) return { ok: false, why: '삽입 위치가 없다' }
  // 🔴 실제 articles.ts 는 `const MAGAZINE_ARTICLE_RECORD = {` (export 없음)다 — 선언 모양을 가정하지 않고,
  //    삽입 위치 앞의 `const X = {` 후보 중 리터럴이 정확히 ANCHOR 에서 닫히는 것을 고른다
  const decls = [...src.slice(0, at).matchAll(/\bconst\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*\{/g)].reverse()
  for (const d of decls) {
    const literal = sliceLiteral(src, d.index + d[0].length - 1, '{', '}')
    if (!literal || d.index + d[0].length - 1 + literal.length !== at + 1) continue
    try {
      return { ok: true, articles: Object.entries(evalLiteral(literal, 'articles.ts')).map(([slug, a]) => ({ slug, ...a })) }
    } catch (e) { return { ok: false, why: e.message } }
  }
  return { ok: false, why: '삽입 위치에서 닫히는 레코드 리터럴을 찾지 못했다' }
}

// ── draft ──────────────────────────────────────────────────

function loadDraftLiteral(dir) {
  const file = join(dir, 'article-draft.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const anchor = src.indexOf('export const DRAFT')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  if (!literal) return null
  return { literal, value: evalLiteral(literal, 'article-draft.ts') }
}

/**
 * draft 리터럴을 articles.ts 레코드로 바꾼다.
 * 문장은 손대지 않는다 — publishedAt 확정과 status·publishAt 주입만 한다.
 */
export function buildRecord(slug, literal, date, publishAt) {
  let body = literal.replace(/\n\s*\/\/ 발행일은 창업자가 확정한다\n/, '\n')

  if (!/publishedAt:\s*''/.test(body)) {
    return { ok: false, why: "article-draft.ts 에서 publishedAt: '' 를 찾지 못했다" }
  }
  body = body.replace(
    /publishedAt:\s*'',/,
    `publishedAt: '${date}',\n    status: 'SCHEDULED',\n    publishAt: '${publishAt}',`,
  )
  // 레코드 안으로 한 단계 들여쓴다
  body = body.split('\n').map((l, i) => (i === 0 ? l : l.trim() ? '  ' + l : l)).join('\n')
  return { ok: true, text: `  '${slug}': ${body},\n` }
}

// ── 판정 ───────────────────────────────────────────────────

/**
  * 🔴 **`founderApproved` 우회로를 없앴다** (M3-A).
  *    등급으로 막지 않으므로 "창업자가 건별로 열어 주는 문" 이 필요 없다.
  *    인자는 호환을 위해 받되 **판정에 쓰지 않는다.**
  */
export function plan({ slug, publishAtInput, founderApproved = false }) {
  void founderApproved   // 🔴 읽기만 한다 — 등록 여부를 바꾸지 않는다
  const reasons = []
  const notes = []

  const norm = normalizePublishAt(publishAtInput)
  if (!norm.ok) reasons.push(norm.why)

  const dir = join(DRAFTS_DIR, slug)
  if (!existsSync(join(dir, 'article-draft.ts'))) reasons.push(`article-draft.ts 가 없다: drafts/magazine/${slug}/`)
  if (!existsSync(join(dir, 'review.ts'))) reasons.push(`review.ts 가 없다: drafts/magazine/${slug}/`)

  let articles = []
  let queue = []
  try {
    articles = loadArticles()
    queue = loadQueue()
  } catch (err) {
    reasons.push(`파일 파싱 실패: ${err.message}`)
    return { slug, verdict: 'BLOCKED', reasons, notes, checks: { approvalMode: null } }
  }

  // 중복 — 상태를 가리지 않는다. 예약분도 이미 쓴 slug 다
  if (articles.some((a) => a.slug === slug)) {
    reasons.push('이미 articles.ts 에 있다 (공개·예약·차단 포함)')
  }

  // 큐 — 정확히 1개여야 한다
  const inQueue = queue.filter((i) => i.slug === slug)
  if (inQueue.length === 0) reasons.push('topic-queue.ts 에 없다')
  else if (inQueue.length > 1) reasons.push(`topic-queue.ts 에 ${inQueue.length}개 있다 — 1개여야 제거할 수 있다`)

  const item = inQueue[0]
  if (item) {

    /**
     * 🔴 **등록을 등급으로 막지 않는다** (M3-A).
     *    `founderApproved` 우회로도 함께 없앤다 — 우회로가 필요했던 이유가 사라졌다.
     */
    const lane = isAutoLaneEligible(item)
    if (!lane.ok) reasons.push(`${lane.code} — ${lane.why}`)
    else notes.push(`validationProfile=${lane.profile}`)
    if (item.publishWindow && norm.ok) {
      const { after, before } = item.publishWindow
      if (norm.date < after) reasons.push(`publishWindow 이전 (after ${after})`)
      if (norm.date > before) reasons.push(`publishWindow 경과 (before ${before}) — 철 지난 주제`)
    }
  }

  // 슬롯 충돌 — 하루 1건
  const taken = takenDates(articles)
  if (norm.ok && taken.has(norm.date)) {
    reasons.push(`${norm.date} 슬롯이 이미 차 있다 (${taken.get(norm.date)}) — 하루 1건`)
  }

  // hero
  const draft = existsSync(dir) ? loadDraftLiteral(dir) : null
  if (existsSync(join(dir, 'article-draft.ts')) && !draft) {
    reasons.push('article-draft.ts 에서 DRAFT 를 읽지 못했다')
  }
  if (item?.imageMode === 'REQUIRED') {
    const src = draft?.value?.heroImage?.src
    const ok = Boolean(src) && existsSync(join(ROOT, 'public', src.replace(/^\//, '')))
    if (!ok) reasons.push(`imageMode=REQUIRED 인데 hero 가 없다${src ? ` (public${src})` : ''}`)
  }

  // 삽입 위치
  const articlesSrc = existsSync(ARTICLES_TS) ? readFileSync(ARTICLES_TS, 'utf8') : ''
  if (!articlesSrc.includes(ANCHOR)) reasons.push('articles.ts 에서 삽입 위치를 찾지 못했다 — 구조가 바뀌었다')

  return {
    slug,
    verdict: reasons.length ? 'BLOCKED' : 'READY',
    reasons,
    notes,
    checks: {
      date: norm.ok ? norm.date : null,
      publishAt: norm.ok ? norm.publishAt : null,
      riskLevel: item?.riskLevel ?? null,
      autoEligible: item?.autoEligible ?? null,
      imageMode: item?.imageMode ?? null,
      queueDay: item?.day ?? null,
      slotFree: norm.ok ? !taken.has(norm.date) : null,
      approvalMode: null,
    },
    _internal: { dir, draft, norm, item, articlesSrc },
  }
}

// ── transaction journal ────────────────────────────────────

export const REGISTER_JOURNAL_SCHEMA = 'register-journal/1'
export const RECOVERY_CONFLICT = 'RECOVERY_CONFLICT'
export const RECOVERY_IDENTITY = 'RECOVERY_IDENTITY'
/** 큐와 같은 worktree 의 `_runs` — gitignore 대상이라 운영 트리를 더럽히지 않는다 */
export const registerJournalPath = (queuePath) => join(dirname(queuePath), '_runs', '.register-journal.json')

const sha = (t) => (t === null ? 'ABSENT' : createHash('sha256').update(t).digest('hex'))
const readText = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null)
/** 폴더만 realpath 로 푼 절대 경로 — /var 와 /private/var 처럼 같은 파일의 다른 표기를 하나로 */
function canonical(f) {
  try { return join(realpathSync(dirname(f)), basename(f)) } catch { return null }
}

/** 임시 파일 → fsync → rename. 🔴 임시 파일은 journal 폴더(`_runs`)에 둔다 — 소스 폴더에 잔여를 남기지 않는다 */
function atomicWrite(file, text, tmpDir) {
  mkdirSync(tmpDir, { recursive: true })
  const tmp = join(tmpDir, `.${basename(file)}.reg-tmp-${process.pid}`)
  const fd = openSync(tmp, 'w')
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, file)
}

/**
 * 🔴 **journal 신원 검증** — 이 journal 이 지금 이 등록의 그 두 파일만 가리키는가.
 *    schema · transaction id · 역할(articles·queue) 정확히 하나씩 · 절대 경로 · 중복 0 ·
 *    현재 articlesPath/queuePath 와 정확히 일치. 어긋나면 어떤 파일도 쓰거나 지우지 않는다.
 */
export function checkRegisterJournalIdentity(j, { articlesPath, queuePath }) {
  const fail = (why) => ({ ok: false, code: RECOVERY_IDENTITY, why })
  if (!j || typeof j !== 'object') return fail('journal 이 객체가 아니다')
  if (j.schema !== REGISTER_JOURNAL_SCHEMA) return fail(`schema 가 ${REGISTER_JOURNAL_SCHEMA} 가 아니다 (${String(j.schema)})`)
  if (typeof j.txId !== 'string' || !j.txId) return fail('transaction id 가 없다')
  if (typeof j.slug !== 'string' || !j.slug) return fail('slug 가 없다')
  if (!Array.isArray(j.files) || j.files.length !== 2) return fail(`파일이 정확히 2개가 아니다 (${Array.isArray(j.files) ? j.files.length : '배열 아님'})`)
  const paths = j.files.map((f) => f?.path)
  if (paths.some((x) => typeof x !== 'string' || !isAbsolute(x))) return fail('절대 경로가 아닌 항목이 있다')
  if (new Set(paths).size !== 2) return fail('같은 경로가 두 번 있다')
  const want = { articles: canonical(articlesPath), queue: canonical(queuePath) }
  const roles = j.files.map((f) => f.role).sort()
  if (roles.join(',') !== 'articles,queue') return fail(`역할이 articles·queue 하나씩이 아니다 (${roles.join(',')})`)
  for (const f of j.files) {
    if (f.path !== want[f.role]) return fail(`${f.role} 경로가 현재 등록 대상과 다르다 (${f.path})`)
    if (!(f.before === null || typeof f.before === 'string')) return fail(`${f.role} 의 before 가 원문 또는 null 이 아니다`)
    if (typeof f.afterSha !== 'string' || !f.afterSha) return fail(`${f.role} 의 afterSha 가 없다`)
  }
  return { ok: true }
}

/**
 * 🔴 **미완료 등록 복구.** 큐 writer 잠금 안에서만 부른다.
 *    두 파일이 각각 journal 의 before · after 중 어디에 있는가로 판정한다.
 *      before·before   아무것도 안 썼다             → journal 만 지운다 (NOTHING_WRITTEN)
 *      after ·before   articles 만 쓰고 죽었다       → articles 를 before 로 되돌린다 (ROLLED_BACK)
 *      after ·after    다 쓰고 journal 지우기 전 죽었다 → 완주로 인정 (COMPLETED)
 *      그 밖          다른 writer 가 바꿨다          → RECOVERY_CONFLICT · 쓰기 0 · journal 유지
 *
 * @returns {{ok:true, action:'NONE'|'NOTHING_WRITTEN'|'ROLLED_BACK'|'COMPLETED', txId?:string, slug?:string}
 *          |{ok:false, code:string, why:string}}
 */
export function recoverRegisterJournal({ articlesPath = ARTICLES_TS, queuePath = QUEUE_TS } = {}) {
  const jp = registerJournalPath(queuePath)
  if (!existsSync(jp)) return { ok: true, action: 'NONE' }
  let j
  try { j = JSON.parse(readFileSync(jp, 'utf8')) } catch (e) {
    return { ok: false, code: RECOVERY_IDENTITY, why: `journal 을 읽지 못했다: ${e.message}` }
  }
  const id = checkRegisterJournalIdentity(j, { articlesPath, queuePath })
  if (!id.ok) return id
  const a = j.files.find((f) => f.role === 'articles')
  const q = j.files.find((f) => f.role === 'queue')
  const where = (f) => {
    const cur = sha(readText(f.path))
    return cur === f.afterSha ? 'after' : cur === sha(f.before) ? 'before' : 'other'
  }
  const sa = where(a)
  const sq = where(q)
  const tx = { txId: j.txId, slug: j.slug }
  if (sa === 'after' && sq === 'after') {
    unlinkSync(jp)
    return { ok: true, action: 'COMPLETED', ...tx }
  }
  if (sa === 'before' && sq === 'before') {
    unlinkSync(jp)
    return { ok: true, action: 'NOTHING_WRITTEN', ...tx }
  }
  if (sa === 'after' && sq === 'before') {
    if (a.before === null) rmSync(a.path, { force: true })
    else atomicWrite(a.path, a.before, dirname(jp))
    if (sha(readText(a.path)) !== sha(a.before)) {
      return { ok: false, code: RECOVERY_CONFLICT, why: 'articles.ts 를 before 로 되돌린 뒤 바이트가 다르다 — journal 을 남긴다' }
    }
    unlinkSync(jp)
    return { ok: true, action: 'ROLLED_BACK', ...tx }
  }
  return { ok: false, code: RECOVERY_CONFLICT,
    why: `급사 뒤 다른 writer 가 바꿨다 (articles ${sa} · queue ${sq}) — 어떤 파일도 덮지 않는다 · journal ${jp} 를 남긴다` }
}

// ── 쓰기 ───────────────────────────────────────────────────

/**
 * 두 파일을 메모리에서 다 만든 뒤 쓴다.
 *
 * 🔴 **"한꺼번에" 는 말뿐이었다** (Codex 재검토 2026-09-26).
 *    앞판은 계산 실패만 막았다. `articles.ts` 를 쓴 **뒤** `topic-queue.ts` 쓰기가
 *    터지면(디스크·권한·EIO) `articles.ts` 만 바뀐 채 남는다 — 글은 등록됐는데
 *    큐에는 그대로 있는, 가장 고치기 어려운 상태다.
 *    이제 쓰기 전에 두 파일의 **바이트를 떠 두고**, 어느 쪽이 터지든 둘 다 되돌린다.
 *
 * @param {object} p
 * @param {{write?:Function}} [deps] 🔴 시험이 **두 번째 쓰기 실패**를 주입하기 위한 자리
 */
export function applyWrite(p, {
  /** 🔴 기본은 원자 쓰기(임시 파일 → fsync → rename). 시험만 바꾼다 */
  write = null,
  /**
   * 🔴 두 파일 경로도 주입점이다. 시험이 **실제 topic-queue 의 특정 day 블록**에
   *    기대면, 그 글이 등록돼 큐에서 빠지는 순간 시험이 깨진다 — 자동화가 성공할수록
   *    CI 가 빨개지는 구조다 (2026-09-27). 기본값은 실제 경로 그대로다.
   */
  articlesPath = ARTICLES_TS,
  queuePath = QUEUE_TS,
} = {}) {
  /**
   * 🔴 `articlesSrc` 는 **계획 시점의 사본**이다 — 쓰기에 쓰지 않는다 (G8 3차 · 2026-10-06).
   *    다른 worktree 의 등록이 그 사이 articles.ts 에 글을 넣었으면, 옛 사본 위에 쓰는 순간 그 글이 사라진다.
   *    아래 잠금 안에서 현재 바이트를 다시 읽고 중복·슬롯·삽입 위치를 다시 본 뒤에 만든다.
   */
  const { draft, norm, item, articlesSrc } = p._internal
  void articlesSrc

  const rec = buildRecord(p.slug, draft.literal, norm.date, norm.publishAt)
  if (!rec.ok) return { ok: false, why: rec.why }

  /**
   * 🔴 **큐 읽기부터 두 파일 쓰기까지 공용 큐 writer 잠금 안에서 한다** (G8 편입기와 같은 잠금).
   *    잠금 밖에서 읽고 안에서 쓰면, 그 사이 G8 이 넣은 행을 옛 바이트로 덮는다.
   */
  const locked = withQueueWriteLock(queuePath, () => writeLocked(), { waitMs: REGISTER_QUEUE_LOCK_WAIT_MS })
  if (!locked.ok) return { ok: false, code: locked.code ?? QUEUE_LOCKED_CODE, why: `${locked.code ?? QUEUE_LOCKED_CODE} — topic-queue.ts 쓰기 잠금을 얻지 못했다 (${locked.why})` }
  return locked.value

  function writeLocked() {
    queueTestPause('register:locked')
    // ① 복구 — 남은 journal 이 있으면 재판정보다 먼저 정리한다
    const recovered = recoverRegisterJournal({ articlesPath, queuePath })
    if (!recovered.ok) return { ok: false, code: recovered.code, why: `${recovered.code} — ${recovered.why}` }
    if (recovered.action === 'COMPLETED' && recovered.slug === p.slug) {
      return { ok: true, alreadyCompleted: true, recovered }
    }
    // ② 재판정
    const articlesNow = existsSync(articlesPath) ? readFileSync(articlesPath, 'utf8') : ''
    if (!articlesNow.includes(ANCHOR)) return { ok: false, why: '잠금 안 재검사 — articles.ts 에서 삽입 위치를 찾지 못했다' }
    const current = recordAtAnchor(articlesNow)
    if (!current.ok) return { ok: false, why: `잠금 안 재검사 — articles.ts 를 읽지 못했다: ${current.why}` }
    if (current.articles.some((a) => a.slug === p.slug)) return { ok: false, why: '잠금 안 재검사 — 이미 articles.ts 에 있다 (다른 등록이 먼저 넣었다)' }
    const taken = takenDates(current.articles)
    if (taken.has(norm.date)) return { ok: false, why: `잠금 안 재검사 — ${norm.date} 슬롯이 이미 차 있다 (${taken.get(norm.date)}) — 하루 1건` }
    const nextArticles = articlesNow.replace(ANCHOR, rec.text + ANCHOR)
    if (nextArticles === articlesNow) return { ok: false, why: 'articles.ts 삽입에 실패했다' }

    const queueSrc = readFileSync(queuePath, 'utf8')
    const nextQueue = removeQueueDay(queueSrc, item.day)
    if (nextQueue === null) return { ok: false, why: `topic-queue.ts 에서 day ${item.day} 블록을 찾지 못했다` }

    // ③ journal — 쓰기 전에 원자적으로 남긴다. 적지 못하면 한 글자도 쓰지 않는다
    const jp = registerJournalPath(queuePath)
    const journal = {
      schema: REGISTER_JOURNAL_SCHEMA, txId: randomUUID(), slug: p.slug, day: item.day,
      createdAt: new Date().toISOString(), pid: process.pid,
      files: [
        { role: 'articles', path: canonical(articlesPath), before: articlesNow, afterSha: sha(nextArticles) },
        { role: 'queue', path: canonical(queuePath), before: queueSrc, afterSha: sha(nextQueue) },
      ],
    }
    try { atomicWrite(jp, JSON.stringify(journal), dirname(jp)) } catch (e) {
      return { ok: false, why: `등록 journal 을 기록하지 못했다 — 쓰기 0: ${e.message}` }
    }
    const doWrite = write ?? ((f, text) => atomicWrite(f, text, dirname(jp)))

    // 여기까지 오면 계산은 둘 다 성공. 이제 쓴다 — **되돌릴 수 있는 상태로**.
    const before = [
      { path: articlesPath, bytes: existsSync(articlesPath) ? readFileSync(articlesPath) : null },
      { path: queuePath, bytes: existsSync(queuePath) ? readFileSync(queuePath) : null },
    ]
    const rollback = () => {
      const failed = []
      for (const f of before) {
        try {
          if (f.bytes === null) rmSync(f.path, { force: true })
          else writeFileSync(f.path, f.bytes)
        } catch (e) { failed.push(`${f.path}: ${e.message}`) }
      }
      return failed
    }
    try {
      doWrite(articlesPath, nextArticles)
      queueTestPause('register:after-articles')
      doWrite(queuePath, nextQueue)
      queueTestPause('register:after-queue')
    } catch (e) {
      const failed = rollback()
      // 🔴 원복이 바이트 그대로일 때만 journal 을 지운다 — 아니면 다음 실행이 journal 로 복구한다
      if (!failed.length) { try { unlinkSync(jp) } catch { /* 이미 없다 */ } }
      return { ok: false, rolledBack: true,
        why: failed.length
          ? `🔴 쓰기 실패 후 원복도 실패했다 — ${e.message} · 원복 실패: ${failed.join(' / ')} · journal 을 남겼다(다음 --write 가 복구)`
          : `쓰기 실패 — ${e.message} (두 파일을 바이트 단위로 되돌렸다)` }
    }
    // ⑤ 사후 검증 → ⑥ journal 삭제. 검증이 어긋나면 journal 을 남긴다
    if (sha(readText(articlesPath)) !== journal.files[0].afterSha || sha(readText(queuePath)) !== journal.files[1].afterSha) {
      return { ok: false, why: `쓰기 뒤 검증 실패 — 두 파일이 의도한 바이트가 아니다 · journal 을 남겼다 (${jp})` }
    }
    rmSync(jp, { force: true })
    return { ok: true, txId: journal.txId }
  }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`매거진 예약 등록 — article-draft.ts → articles.ts (SCHEDULED)

  node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02
  node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02 --write
  node scripts/magazine-register.mjs --slug <slug> --publish-at ... --json

🔴 기본은 dry-run. --write 를 명시해야만 파일을 고친다.
🔴 하루 1건. 슬롯이 차 있으면 BLOCKED.
🔴 공개 시각은 10:30 KST 고정. 날짜만 주면 자동 보정한다.
🔴 등급으로 막지 않는다 (M3-A). 막는 것은 프로필 미정 · 슬롯 · 중복 · 큐 부재 ·
   REQUIRED hero 없음 · 삽입 위치 부재다.
🔴 사람 승인 손잡이는 없다. --founder-approved 는 아무것도 열지 않는다.`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (k) => {
    const i = argv.indexOf(k)
    return i === -1 ? undefined : argv[i + 1]
  }
  const slug = arg('--slug')
  const write = argv.includes('--write')
  const asJson = argv.includes('--json')
  // 🔴 `--founder-approved` 는 더 이상 아무것도 열지 않는다
  const founderApproved = false

  if (!slug) {
    console.error('  --slug 가 필요하다')
    process.exit(2)
  }

  /**
   * 🔴 **--write 는 plan 의 중복 판정보다 먼저 미완료 journal 을 복구한다.**
   *    급사한 앞 회차가 articles 만 썼다면 그 글 때문에 plan 이 「이미 있다」로 막혀 영영 풀리지 않는다.
   */
  let recovered = null
  if (write) {
    const lockedRecovery = withQueueWriteLock(QUEUE_TS, () => recoverRegisterJournal(), { waitMs: REGISTER_QUEUE_LOCK_WAIT_MS })
    recovered = lockedRecovery.ok ? lockedRecovery.value : { ok: false, code: lockedRecovery.code, why: lockedRecovery.why }
    if (!recovered.ok || (recovered.action === 'COMPLETED' && recovered.slug === slug)) {
      const done = recovered.ok
      const out = { slug, verdict: done ? 'READY' : 'BLOCKED', mode: 'write', approvalMode: null, approvalNote: null,
        applied: done, recovered,
        reasons: done ? [] : [`${recovered.code} — ${recovered.why}`],
        notes: done ? [`이미 완주한 등록이다 (transaction ${recovered.txId}) — 다시 쓰지 않는다`] : [], checks: {} }
      if (asJson) console.log(JSON.stringify(out, null, 2))
      else console.log(done ? `\n  ✅ 이미 완주한 등록 — ${slug} (transaction ${recovered.txId})\n` : `\n  ⛔ BLOCKED — ${out.reasons[0]}\n`)
      process.exit(done ? 0 : 1)
    }
  }

  const p = plan({ slug, publishAtInput: arg('--publish-at'), founderApproved })
  let applied = null

  if (write && p.verdict === 'READY') {
    const r = applyWrite(p)
    applied = r.ok
    if (r.recovered) recovered = r.recovered
    if (!r.ok) {
      p.verdict = 'BLOCKED'
      p.reasons.push(r.why)
    }
  }

  const out = {
    slug: p.slug,
    verdict: p.verdict,
    mode: write ? 'write' : 'dry-run',
    approvalMode: null,
    approvalNote: null,
    applied,
    recovered,
    reasons: p.reasons,
    notes: p.notes,
    checks: p.checks,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log('')
    console.log(`  매거진 예약 등록 — ${p.slug}`)
    console.log(`  모드     : ${write ? 'write' : 'dry-run (파일 수정 0건)'}`)
    // 🔴 사람 승인 표기 없음 (M3-A)
    const c = p.checks
    console.log(`  publishAt: ${c.publishAt ?? '-'}`)
    // 🔴 상태 출력도 프로필 기준이다. riskLevel·autoEligible 은 호환 표기로만 남긴다
    console.log(`  큐        : day ${c.queueDay ?? '-'} · image ${c.imageMode ?? '-'}`)
    console.log(`  프로필    : ${(p.notes ?? []).find((n) => n.startsWith('validationProfile=')) ?? '-'}`)
    console.log(`  슬롯      : ${c.slotFree === null ? '-' : c.slotFree ? '비어 있음' : '🔴 차 있음'}`)
    console.log('')
    if (p.verdict === 'READY') {
      if (write && applied) {
        console.log('  ✅ 등록 완료')
        console.log('     articles.ts 에 SCHEDULED 로 추가 · topic-queue.ts 에서 제거')
        // 🔴 사람 승인 경로 없음 (M3-A)
      } else {
        console.log('  ✅ READY — 등록 가능')
        console.log('     변경 예정:')
        console.log(`       src/content/magazine/articles.ts   '${p.slug}' 추가 (status: SCHEDULED)`)
        console.log(`       drafts/magazine/topic-queue.ts     day ${c.queueDay} 제거`)
        console.log('     실제로 쓰려면 --write')
      }
    } else {
      console.log('  ⛔ BLOCKED')
      for (const r of p.reasons) console.log(`     ⛔ ${r}`)
      console.log('')
      console.log('     등록하지 않는다. 파일은 그대로다.')
    }
    console.log('')
  }

  process.exit(p.verdict === 'BLOCKED' ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-register.mjs')) main()
