#!/usr/bin/env node
/**
 * 단일 slug 자동 후속 처리 — 원고 회수부터 등록 PR 까지.
 *
 * 🔴 등급으로 거르지 않는다. validationProfile 이 QA 강도를 정하고,
 *    QA 실패는 **자동 재생성**으로 되살린다 (최대 2회, 그 뒤 이 slug 만 HOLD).
 *
 *   producer(00:10 KST) 가 brief.md 를 만들어 두면 그 다음을 이 스크립트가 잇는다.
 *
 *   gate → draft.md 회수 → article-draft.ts → magazine QA → batch-qa
 *        → hero(REQUIRED) → register → PR
 *
 * 🔴 기본이 dry-run 이다. --write 없이는 파일을 하나도 만들지 않는다.
 *    register 뿐 아니라 회수·변환·hero 까지 전부 --write 아래에서만 쓴다.
 *
 * 🔴 프로필을 정할 수 없는 항목만 첫 단계에서 끝난다.
 *    `magazine-auto-lane.mjs` 의 gate 가 topic-queue 를 정본으로 등급을 본다.
 *    batch-qa 의 READY 를 그대로 믿지 않는다 — 큐에 없는 slug 는 batch-qa 가
 *    등급을 검사하지 않기 때문이다(모듈 주석 참조).
 *
 * 🔴 사람 승인 손잡이는 없다 (M3-A 에서 제거).
 *
 * 🔴 앞 단계가 실패하면 뒤로 가지 않는다.
 *    QA FAIL 이면 batch-qa 를 부르지 않고, batch-qa BLOCKED 면 register 를 부르지 않는다.
 *
 * 사용법
 *   node scripts/magazine-auto-register.mjs --slug <slug> --dry-run
 *   node scripts/magazine-auto-register.mjs --slug <slug> --publish-at 2026-09-20 --write
 *   node scripts/magazine-auto-register.mjs --slug <slug> --publish-at ... --write --pr
 *   node scripts/magazine-auto-register.mjs --slug <slug> --alt "…여성" --write   REQUIRED hero
 *   node scripts/magazine-auto-register.mjs --slug <slug> --dry-run --json
 *
 * 종료 코드: BLOCKED 면 1, 아니면 0
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue, ARTICLES_TS, QUEUE_TS, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { gate, progress, heroPlan, paths } from './lib/magazine-auto-lane.mjs'
import { resolveHeroBrief } from './lib/magazine-hero-brief.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { attemptRegeneration, clearRegen, MAX_REGEN_CALLS } from './lib/magazine-regen.mjs'
import { PACKET_DIR } from './lib/magazine-regen.mjs'
import { readFetchResults, fetchResultFor, removeFetchResults, todayKst, readRunFetchState } from './lib/magazine-fetch-result.mjs'
import { classifyFailure } from './lib/magazine-failure-kind.mjs'
import { describeFetchFailure } from './magazine-webui-runner.mjs'
import { fingerprintOf } from './lib/magazine-quarantine.mjs'
import { deliveryGate } from './lib/magazine-delivery-gate.mjs'
import { heroFilePath, injectHeroImage, verifyHeroFile } from './lib/magazine-hero.mjs'
import { validateManuscript, describeReasons } from './lib/magazine-manuscript-guard.mjs'
import { restoreQueueSnapshot, restoreRegisterPair } from './lib/magazine-queue-lock.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath

const WEBUI = join(ROOT, 'scripts/magazine-webui-runner.mjs')
const MD2DRAFT = join(ROOT, 'scripts/magazine-md-to-draft.mjs')
const QA = join(ROOT, 'scripts/magazine-qa.mjs')
const BATCH_QA = join(ROOT, 'scripts/magazine-batch-qa.mjs')
const HERO = join(ROOT, 'scripts/magazine-hero-runner.mjs')
const REGISTER = join(ROOT, 'scripts/magazine-register.mjs')

/**
 * 🔴 **한 후보가 등록 전에 막히면, 그 후보가 만든 추적 파일 변경만 되돌린다**
 *    (2026-09-26 운영 사고).
 *
 *    그날 회차는 `article-draft.ts` 3건을 고쳐 놓고 hero 에서 막혔다. 되돌리는 코드가
 *    없어서 작업 브랜치에 미커밋 변경 3건이 남았고, 복귀가 `RETURN_DIRTY` 로 끝나
 *    **다음 회차까지 더러운 트리를 물려받는** 상태가 됐다.
 *
 *    되돌리는 대상은 **추적 파일뿐**이다. 미추적 원고(brief·review·draft.md)는
 *    사람이 만든 자산이고, 다른 후보의 변경도 건드리지 않는다 — 이 후보의 경로만 본다.
 */
function isTracked(path) {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0
}

export function trackedSnapshot(paths) {
  return paths.filter(Boolean).filter(isTracked).map((path) => ({
    path,
    existed: existsSync(path),
    bytes: existsSync(path) ? readFileSync(path) : null,
  }))
}

export function restoreSnapshot(snap, { writeFile = writeFileSync, remove = rmSync } = {}) {
  const restored = []
  const failures = []
  /**
   * 🔴 **등록 쌍은 함께 판정·원복한다** (G8 3차 · 2026-10-06). articles.ts 를 먼저 혼자 되돌리고 큐가 거부되면
   *    글이 양쪽에서 사라진다. 큐 writer 잠금 안에서 둘 다 되돌릴 수 있을 때만 둘 다 되돌린다.
   */
  const pairQueue = snap.find((f) => f.queueCas)
  const pairArticles = snap.find((f) => f.pairWithQueue)
  if (pairQueue && pairArticles) {
    const r = restoreRegisterPair({ articles: pairArticles, queue: pairQueue, slug: pairQueue.queueCas.slug }, { writeFile })
    restored.push(...r.restored)
    failures.push(...r.failures)
  }
  for (const f of snap) {
    if (pairQueue && pairArticles && (f === pairQueue || f === pairArticles)) continue
    /**
     * 🔴 **큐는 바이트로 덮지 않는다** (G8 편입기 공용 잠금 · 2026-10-06).
     *    회차 시작 뒤 G8 이 넣은 행이 있으면 옛 바이트가 그 행을 지운다(lost update).
     *    큐 writer 잠금 안에서 「이 회차 등록이 만든 바이트」일 때만 되돌린다.
     */
    if (f.queueCas) {
      const q = restoreQueueSnapshot(f, { writeFile })
      if (q.restored) restored.push(f.path)
      if (q.failure) failures.push(q.failure)
      continue
    }
    try {
      const now = existsSync(f.path) ? readFileSync(f.path) : null
      if (f.existed) {
        if (!now || !now.equals(f.bytes)) { writeFile(f.path, f.bytes); restored.push(f.path) }
      } else if (now && !f.keepIfCreated) {
        // 🔴 추적 파일인데 스냅샷 시점에 없었다 = 이 회차가 만들었다. 지운다.
        remove(f.path, { force: true }); restored.push(f.path)
      }
    } catch (error) {
      failures.push({ path: f.path, errorName: error?.name ?? 'Error', errorDetail: error?.message ?? String(error) })
    }
  }
  return { restored, failures }
}

/**
 * 🔴 **미추적 원고도 바이트 그대로 되돌린다** (2026-10-02 자연 회차).
 *
 *    위 스냅샷은 추적 파일만 담았다. 그래서 재생성이 draft.md 를 brief 로 덮은 채 막혔을 때
 *    **오염된 draft.md 가 남았고**, 다음 회차는 그 brief 를 원고로 변환하려다 CONVERT_FAILED 로 멈췄다.
 *    draft.md · article-draft.ts · hero 는 이 후보의 자산이다 — 막히면 **들어오기 전 바이트**로 돌린다.
 *
 *    `keepIfCreated` — 스냅샷 시점에 없던 파일을 이 회차가 만들었어도 지우지 않는다.
 *    새로 받은 hero 는 slug 에 묶인 재사용 자산이다(다음 회차 이미지 호출 0). 추적 파일이면
 *    위 `trackedSnapshot` 이 따로 지운다 — 트리를 더럽히지 않는다.
 */
export function fileSnapshot(paths, { keepIfCreated = false } = {}) {
  return paths.filter(Boolean).map((path) => ({
    path,
    existed: existsSync(path),
    bytes: existsSync(path) ? readFileSync(path) : null,
    keepIfCreated,
  }))
}

/** 🔴 같은 폴더의 임시 파일에 쓰고 이름을 바꾼다 — 반쯤 쓴 원고가 남지 않는다 */
export function atomicWrite(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}

const REGEN_TRANSACTION_VERSION = 1

function regenTransactionFiles({ slug, draftMd, articleTs, id = randomUUID() }) {
  const journalPath = join(dirname(draftMd), `.regen-apply-${slug}.json`)
  return {
    id,
    journalPath,
    draft: {
      path: draftMd,
      existed: existsSync(draftMd),
      backup: `${draftMd}.regen-backup-${id}`,
      staged: `${draftMd}.regen-staged-${id}`,
    },
    article: {
      path: articleTs,
      existed: existsSync(articleTs),
      backup: `${articleTs}.regen-backup-${id}`,
      staged: `${articleTs}.regen-staged-${id}`,
    },
  }
}

function cleanupTransactionFiles(tx, { keepJournal = false } = {}) {
  const failures = []
  for (const path of [tx?.draft?.backup, tx?.article?.backup, tx?.draft?.staged, tx?.article?.staged]) {
    if (!path) continue
    try { rmSync(path, { force: true }) } catch (error) { failures.push(`${path}: ${error.message}`) }
  }
  if (!keepJournal && failures.length === 0 && tx?.journalPath) {
    try { rmSync(tx.journalPath, { force: true }) } catch (error) { failures.push(`${tx.journalPath}: ${error.message}`) }
  }
  return failures
}

function writeRegenTransaction(tx) {
  atomicWrite(tx.journalPath, `${JSON.stringify(tx, null, 2)}\n`)
}

function prepareRegenTransaction({ slug, draftMd, articleTs, phaseHook = () => {} }) {
  const tx = { version: REGEN_TRANSACTION_VERSION, slug, phase: 'initializing',
    ...regenTransactionFiles({ slug, draftMd, articleTs }) }
  try {
    // 저널을 가장 먼저 남긴다. 사본 작성 중 급사해도 다음 실행이 고유 파일을 정리할 수 있다.
    writeRegenTransaction(tx)
    phaseHook(tx.phase, tx)
    if (tx.draft.existed) writeFileSync(tx.draft.backup, readFileSync(draftMd), { flag: 'wx' })
    if (tx.article.existed) writeFileSync(tx.article.backup, readFileSync(articleTs), { flag: 'wx' })
    tx.phase = 'converting'
    writeRegenTransaction(tx)
    phaseHook(tx.phase, tx)
    return { ok: true, tx }
  } catch (error) {
    const cleanupFailures = cleanupTransactionFiles(tx)
    return { ok: false, code: 'REGEN_TRANSACTION_PREPARE_FAILED',
      why: `재생성 교체 준비에 실패했다: ${error.message}${cleanupFailures.length ? ` · 정리 실패: ${cleanupFailures.join(' | ')}` : ''}` }
  }
}

/**
 * 재생성 원고·변환본 교체 중 프로세스가 죽었으면 다음 실행이 먼저 둘을 원복한다.
 * 저널을 읽거나 원복할 수 없으면 자동 진행하지 않는다.
 */
export function recoverRegenTransaction({ slug, draftMd, articleTs }) {
  const { journalPath } = regenTransactionFiles({ slug, draftMd, articleTs, id: 'lookup' })
  if (!existsSync(journalPath)) return { ok: true, recovered: false }

  let tx
  try {
    tx = JSON.parse(readFileSync(journalPath, 'utf8'))
  } catch (error) {
    return { ok: false, code: 'REGEN_TRANSACTION_CORRUPT', why: `재생성 교체 저널을 읽지 못했다: ${error.message}` }
  }
  if (tx?.version !== REGEN_TRANSACTION_VERSION || tx?.slug !== slug
    || resolve(tx?.draft?.path ?? '') !== resolve(draftMd)
    || resolve(tx?.article?.path ?? '') !== resolve(articleTs)) {
    return { ok: false, code: 'REGEN_TRANSACTION_IDENTITY', why: '재생성 교체 저널의 버전·slug·경로가 현재 작업과 다르다' }
  }
  if (!['initializing', 'converting', 'prepared', 'draft-committed', 'committed'].includes(tx.phase)) {
    return { ok: false, code: 'REGEN_TRANSACTION_PHASE', why: `재생성 교체 저널의 단계를 알 수 없다: ${tx.phase}` }
  }

  try {
    // initializing 단계에서는 아직 정본을 바꾸지 않았다. 사본이 덜 만들어졌을 수 있으므로 정리만 한다.
    if (tx.phase !== 'committed' && tx.phase !== 'initializing') {
      for (const file of [tx.draft, tx.article]) {
        if (file.existed) {
          if (!existsSync(file.backup)) throw new Error(`원복 사본이 없다: ${file.backup}`)
          const bytes = readFileSync(file.backup)
          atomicWrite(file.path, bytes)
          if (!readFileSync(file.path).equals(bytes)) throw new Error(`원복 후 바이트가 다르다: ${file.path}`)
        } else {
          rmSync(file.path, { force: true })
          if (existsSync(file.path)) throw new Error(`새 파일을 지우지 못했다: ${file.path}`)
        }
      }
    }
    const cleanupFailures = cleanupTransactionFiles(tx)
    if (cleanupFailures.length) throw new Error(cleanupFailures.join(' | '))
    return { ok: true, recovered: tx.phase !== 'committed', phase: tx.phase }
  } catch (error) {
    return { ok: false, code: 'REGEN_TRANSACTION_RECOVERY_FAILED', why: `재생성 교체 원복에 실패했다: ${error.message}` }
  }
}

function commitRegenPair({ tx, draftText, articleText,
  renameFn = renameSync, phaseHook = () => {} }) {
  const { slug } = tx
  const draftMd = tx.draft.path
  const articleTs = tx.article.path

  try {
    writeFileSync(tx.draft.staged, draftText, { flag: 'wx' })
    writeFileSync(tx.article.staged, articleText)
    tx.phase = 'prepared'
    writeRegenTransaction(tx)

    renameFn(tx.draft.staged, draftMd)
    tx.phase = 'draft-committed'
    writeRegenTransaction(tx)
    phaseHook(tx.phase, tx)

    renameFn(tx.article.staged, articleTs)
    tx.phase = 'committed'
    writeRegenTransaction(tx)
    phaseHook(tx.phase, tx)

    const cleanupFailures = cleanupTransactionFiles(tx)
    if (cleanupFailures.length) {
      return { ok: false, code: 'REGEN_TRANSACTION_CLEANUP_FAILED',
        why: `교체는 완료했지만 저널·사본을 정리하지 못했다: ${cleanupFailures.join(' | ')}` }
    }
    return { ok: true }
  } catch (error) {
    const recovered = recoverRegenTransaction({ slug, draftMd, articleTs })
    if (!existsSync(tx.journalPath)) cleanupTransactionFiles(tx)
    if (!recovered.ok) {
      return { ok: false, code: 'REGEN_TRANSACTION_RECOVERY_FAILED',
        why: `교체 실패(${error.message}) 후 원복도 실패했다: ${recovered.why}` }
    }
    return { ok: false, code: 'REGEN_COMMIT_FAILED',
      why: `재생성 원고·변환본 교체에 실패해 둘 다 원복했다: ${error.message}` }
  }
}

/** article-draft.ts 의 heroImage 연결 — 없으면 null */
export function heroLinkOf(src) {
  const m = /^\s*heroImage:\s*\{[\s\S]*?\balt:\s*'((?:[^'\\]|\\.)*)'/m.exec(String(src ?? ''))
  return m ? { alt: m[1].replace(/\\'/g, "'") } : null
}

/**
 * 🔴 **재생성 원고는 임시 경로에서 검증·변환하고, 성공한 경우에만 원본을 바꾼다** (2026-10-02).
 *
 *    ① 원고 관문(`validateManuscript`) — brief echo 를 포함해 저장 금지 원고를 거른다
 *    ② 임시 article 로 변환 — 실패하면 draft.md · article-draft.ts 는 **한 바이트도 바뀌지 않는다**
 *    ③ **hero 연결 승계** — 지금 article 에 유효한 hero 가 연결돼 있으면 새 article 에도 잇는다.
 *       md-to-draft 는 heroImage 를 자리표시자로 되돌린다. 2026-10-02 `hardest-part-of-menopause` 는
 *       hero 를 만든 뒤 batch 재생성으로 article 이 다시 쓰여 **시스템이 스스로 HERO_MISSING 을 만들었다.**
 *       이미지를 다시 만들지 않는다 — 있는 파일을 검증하고 연결만 잇는다.
 *    ④ draft.md → article-draft.ts 순서로 각각 원자적으로 바꾼다
 */
export function applyRegenCandidate({ slug, candidatePath, draftMd, articleTs, runFn = run,
  verifyHero = () => verifyHeroFile(slug), renameFn = renameSync, phaseHook = () => {} }) {
  const recovery = recoverRegenTransaction({ slug, draftMd, articleTs })
  if (!recovery.ok) return recovery
  if (!existsSync(candidatePath)) {
    return { ok: false, code: 'REGEN_CANDIDATE_MISSING', why: '재생성 원고 임시 파일이 없다 — 원본을 바꾸지 않는다' }
  }
  const text = readFileSync(candidatePath, 'utf8')
  const v = validateManuscript(text)
  if (!v.ok) {
    return { ok: false, code: 'REGEN_CANDIDATE_INVALID', reasons: v.reasons.map((r) => r.code),
      why: `재생성 원고를 받을 수 없다 — ${describeReasons(v.reasons)} (원본 유지)` }
  }
  const prepared = prepareRegenTransaction({ slug, draftMd, articleTs, phaseHook })
  if (!prepared.ok) return prepared
  const { tx } = prepared
  const abort = (result) => {
    const recovered = recoverRegenTransaction({ slug, draftMd, articleTs })
    if (!recovered.ok) return recovered
    return result
  }
  try {
    const c = runFn(MD2DRAFT, ['--in', candidatePath, '--out', tx.article.staged])
    if (c.code !== 0 || !existsSync(tx.article.staged)) {
      return abort({ ok: false, code: 'CONVERT_FAILED', why: `${meaningfulLine(c.stderr || c.stdout)} (재생성 원고 변환 실패 · 원본 유지)` })
    }
    let article = readFileSync(tx.article.staged, 'utf8')
    const link = existsSync(articleTs) ? heroLinkOf(readFileSync(articleTs, 'utf8')) : null
    let heroCarried = false
    if (link && verifyHero().ok) {
      const inj = injectHeroImage(article, slug, link.alt)
      if (!inj.ok) return abort({ ok: false, code: 'HERO_RELINK_FAILED', why: `${inj.why} (원본 유지)` })
      article = inj.text
      heroCarried = true
    }
    const committed = commitRegenPair({ tx, draftText: text, articleText: article,
      renameFn, phaseHook })
    if (!committed.ok) return committed
    return { ok: true, heroCarried, recovered: recovery.recovered }
  } finally {
    rmSync(tx.article.staged, { force: true })
  }
}

/** QA 출력에서 실제 FAIL 줄만 — 재생성 상한에 가려지지 않게 결과에 남긴다 */
export function qaFailLines(out) {
  return String(out ?? '').split('\n')
    .filter((x) => /✗\s*FAIL/.test(x))
    .map((x) => x.replace(/^.*?✗\s*FAIL\s*(\[[^\]]*\]\s*)?/, '').trim())
    .filter(Boolean)
}

/**
 * 🔴 **자식 프로세스 출력에서 뜻이 있는 줄을 고른다** (2026-09-27 사고).
 *
 *    앞판은 마지막 1~2줄을 그대로 썼다. 자식이 스택을 뱉고 죽으면 그 자리에
 *    `Node.js v24.14.0` 이 남는다 — `HERO_FAILED — Node.js v24.14.0` 이 실제로 남았고
 *    무엇이 왜 터졌는지 알 수 없었다.
 */
const NOISE = /^(Node\.js v[\d.]+|\s*at\s|\s*\^+\s*$|\s*$)/
export function meaningfulLine(out, max = 2) {
  const lines = String(out ?? '').split('\n').map((x) => x.trimEnd())
  const marked = lines.filter((x) => /⛔|Error:|error:/.test(x) && !NOISE.test(x))
  const pick = marked.length ? marked.slice(-max) : lines.filter((x) => !NOISE.test(x)).slice(-max)
  return pick.join(' ').trim().slice(0, 300) || '(출력 없음)'
}

function run(file, args, { json = false } = {}) {
  const r = spawnSync(NODE, [file, ...args], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, stdout: '', stderr: String(r.error.message ?? r.error), json: null }
  const out = { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
  if (json) {
    try {
      out.json = JSON.parse(out.stdout)
    } catch {
      out.json = null
    }
  }
  return out
}

/**
 * 한 slug 를 끝까지 몰고 간다.
 * 각 단계는 { stage, status, detail } 로 남는다 — status 는 ok · skip · blocked 셋뿐이다.
 */
/**
 * 🔴 **기존 ChatGPT 웹 UI 경로 어댑터.**
 *    새 API 를 부르지 않는다. 지금 쓰는 그 스크립트에 **실패 패킷 경로만** 더 준다.
 */
export function webuiRegenRunner({ slug, packetPath, draftOut }, { runFn = run, resultDir = PACKET_DIR } = {}) {
  /**
   * 🔴 **기계가 읽을 값은 기계용 파일로 받는다** (2026-09-28 · Codex P0-2).
   *    앞판은 자식의 **사람용 출력**을 `/전송\s*1건/` 로 긁었다. 문구를 한 글자만
   *    바꿔도 `sent` 가 `false` 로 뒤집히고, 그러면 **같은 brief 를 다시 보낸다.**
   *    자식이 JSON 에 적고 여기서 읽는다.
   */
  // 🔴 임시 경로가 없으면 자식을 띄우지 않는다 — 자식도 같은 이유로 거부하지만 전송 0 을 여기서 먼저 확정한다
  if (!draftOut) {
    return { ok: false, sent: false, resultSource: 'file', reason: 'REGEN_DRAFT_OUT_MISSING', stage: 'args',
      why: '재생성 원고 임시 경로가 없다 — draft.md 에 직접 쓰지 않는다 (전송 0건)' }
  }
  const resultPath = join(resultDir, `regen-result-${slug}-${process.pid}.json`)
  let r
  try {
    // 🔴 재생성 원고는 부모가 준 임시 경로에만 쓴다 — draft.md 는 부모가 검증한 뒤에만 바뀐다
    r = runFn(WEBUI, ['--fetch', slug, '--force', '--regen-packet', packetPath, '--result-json', resultPath, '--draft-out', draftOut])
  } finally { /* 읽기 전에는 지우지 않는다 */ }

  const structured = readFetchResults(resultPath)
  const row = structured.ok ? fetchResultFor(structured.body, slug) : null
  removeFetchResults(resultPath)

  /**
   * 🔴 **성공은 둘이 같이 있을 때만이다** (2026-09-28 · Codex 재검토).
   *    ① 자식이 정상 종료했고 ② **그 slug 의 행이 `status=ok`** 다.
   *
   *    앞판은 종료 코드 0 만 보고 `ok: true` 를 돌려줬다. 자식이 아무것도 안 하고
   *    0으로 끝나도 상위는 "재생성 성공" 으로 읽었고, 바뀌지 않은 옛 원고로 QA 를 돌렸다.
   *    **거짓 성공은 실패보다 나쁘다** — 실패는 다시 보지만 거짓 성공은 그냥 지나간다.
   */
  if (r.code === 0 && row?.status === 'ok') return {
    ok: true, sent: true, resultSource: 'file', attemptId: row.attemptId ?? null,
    conversationUrl: row.conversationUrl ?? null, assistantMessageId: row.assistantMessageId ?? null,
    responseForm: row.responseForm ?? null,
  }

  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const why = /login_required/i.test(out) ? 'ChatGPT login_required' : '재생성 회수 실패'
  const line = meaningfulLine(r.stderr || r.stdout)

  if (r.code === 0) {
    /**
     * 🔴 **종료 코드만 0인 경우** — 행이 없거나 `ok` 가 아니다.
     *    행이 있으면 그 사실(`sent` 포함)을 그대로 올리고,
     *    없으면 **보냈는지조차 모른다.** 모름은 `null` 이다 — 다시 보내지 않는다.
     */
    if (row) {
      return {
        ok: false, sent: row.sent, resultSource: 'file',
        reason: row.reason ?? 'REGEN_RESULT_NOT_OK', stage: row.stage,
        errorName: row.errorName, errorDetail: row.errorDetail,
        invalid: row.invalid ?? null, length: row.length ?? null,
        conversationUrl: row.conversationUrl ?? null, assistantMessageId: row.assistantMessageId ?? null,
        responseForm: row.responseForm ?? null,
        messageFingerprint: row.messageFingerprint ?? null, prior: row.prior ?? null, attemptId: row.attemptId ?? null,
        why: `${why} — ${describeFetchFailure(row)}`,
      }
    }
    return {
      ok: false, sent: null, resultSource: 'missing',
      reason: 'REGEN_RESULT_MISSING', stage: null,
      errorName: null, errorDetail: structured.why ?? null,
      why: `재생성이 조용히 끝났다 (종료 코드 0 · 결과 행 없음: ${structured.why}) — 보냈는지 알 수 없다`,
    }
  }

  if (row) {
    /**
     * 🔴 `reason`·`stage`·`errorName`·`errorDetail` 을 **그대로** 올린다.
     *    여기서 문장으로 뭉개면 상위 분류(`classifyFailure`)가 다시 추측해야 한다.
     */
    return {
      ok: false, sent: row.sent, resultSource: 'file',
      reason: row.reason, stage: row.stage,
      errorName: row.errorName, errorDetail: row.errorDetail,
      invalid: row.invalid ?? null, length: row.length ?? null,
      conversationUrl: row.conversationUrl ?? null, assistantMessageId: row.assistantMessageId ?? null,
      responseForm: row.responseForm ?? null,
      // 🔴 HOLD 면 어느 글자 때문인지 · 앞선 전송이 무엇이었는지를 같이 올린다
      messageFingerprint: row.messageFingerprint ?? null, prior: row.prior ?? null, attemptId: row.attemptId ?? null,
      why: `${why} — ${describeFetchFailure(row)}`,
    }
  }
  /**
   * 🔴 **파일이 없으면 `sent` 를 모른다.** 자식이 기록 전에 죽었다는 뜻이다.
   *    모름을 `false` 로 낮추면 재전송하고, `true` 로 올리면 멀쩡한 재시도를 막는다.
   *    그래서 **모름 그대로** 올린다 — 상위가 DELIVERY_UNCERTAIN 으로 다룬다.
   */
  return {
    ok: false, sent: null, resultSource: 'missing',
    reason: 'REGEN_RESULT_MISSING', stage: null,
    errorName: null, errorDetail: structured.why ?? null,
    why: `${why} — ${line} (회수 결과 없음: ${structured.why})`,
  }
}

/**
 * 한 slug 를 끝까지 몰고 간다.
 *
 * @param {object} [deps] 🔴 시험이 실제 orchestration 을 돌리기 위한 주입 지점.
 *        운영에서는 비워 둔다 — 그러면 진짜 스크립트가 돈다.
 */
export function drive(slug, opts, deps = {}) {
  const runStep = deps.run ?? run
  /**
   * 🔴 기본 runner 도 **주입된 run 을 탄다.** 앞판은 모듈 스코프 `run` 을 직접 써서
   *    `deps.run` 을 우회했다 — 그래서 실제 `webuiRegenRunner` 가 한 번도 시험되지 않았고,
   *    거기 남아 있던 `split('\\n').pop()` 이 `Node.js v…` 를 사유로 흘려보냈다.
   */
  const regenRunner = deps.regenRunner ?? ((ctx) => webuiRegenRunner(ctx, { runFn: runStep }))
  const regen = deps.attemptRegeneration ?? attemptRegeneration
  const quarantinePath = deps.quarantinePath
  /** 🔴 원고가 실제로 바뀌었는지 보는 값. 시험은 실제 draft 를 건드리지 않으므로 주입한다 */
  const draftFingerprint = deps.draftFingerprint
  const packetDir = deps.packetDir
  /**
   * 🔴 큐 읽기도 주입점이다. 시험이 **운영 큐 내용에 기대지 않게** 하기 위한 자리다.
   *    큐는 등록될 때마다 줄어든다 — 시험이 "큐에 후보가 있다" 에 기대면
   *    성공할수록 CI 가 깨진다. 기본값은 실제 loadQueue 그대로다.
   */
  const loadQueueFn = deps.loadQueue ?? loadQueue
  /**
   * 🔴 `autoLane` — 이 회차를 사람이 아니라 **자동 레인이** 돌리고 있는가.
   *    자동 레인에서는 대표 이미지가 선택이 아니라 필수다 (2026-09-21 사고).
   */
  const { write = false, pr = false, publishAt = null, alt = null, allowOptional = false, autoLane = false } = opts
  const steps = []
  const blockedBy = []
  const add = (stage, status, detail) => steps.push({ stage, status, detail })
  /**
   * 🔴 이 후보가 등록 전에 만든 **추적 파일** 변경을 되돌리기 위한 스냅샷.
   *    gate 를 지나 경로가 정해진 뒤에 채운다. dry-run 은 파일을 쓰지 않으니 비워 둔다.
   */
  let snapshot = []
  /** 🔴 미추적 자산(draft.md · article-draft.ts · hero) 스냅샷 — 추적 여부와 무관하게 바이트로 되돌린다 */
  let own = []
  /**
   * 🔴 **재생성마다 실제 실패를 남긴다** (2026-10-02). dinner 는 QA FAIL 이 제목 하나였는데
   *    최종 결과에는 `REGEN_EXHAUSTED` 만 남아, 무엇이 실패했는지 회차 기록으로는 알 수 없었다.
   *    🔴 `stop` 보다 먼저 선언한다 — gate 에서 멈춰도 같은 모양으로 돌려준다.
   */
  const regenHistory = []
  let lastQaFailures = []
  const evidence = () => ({
    ...(regenHistory.length ? { regenHistory } : {}),
    ...(lastQaFailures.length ? { qaFailures: lastQaFailures } : {}),
  })
  const rollback = () => {
    if (!write || (!snapshot.length && !own.length)) return { restored: [], failures: [] }
    const restore = deps.restoreSnapshot ?? restoreSnapshot
    const a = restore(snapshot)
    const b = restore(own)
    const restored = [...a.restored, ...b.restored]
    const failures = [...a.failures, ...b.failures]
    if (restored.length) add('rollback', 'ok', `등록 전 중간 변경 ${restored.length}건 원상복구: ${restored.map((x) => x.split('/').pop()).join(', ')}`)
    if (failures.length) add('rollback', 'blocked', `원상복구 ${failures.length}건 실패: ${failures.map((x) => `${x.path.split('/').pop()} ${x.errorName}: ${x.errorDetail}`).join(' | ')}`)
    return { restored, failures }
  }
  /**
   * 🔴 **`sent` 를 장부까지 들고 간다** (2026-09-28 · Codex 재검토 3번).
   *    막힌 이유가 "이미 보냈다" 인데 장부에 `sent:false` 가 남으면, 다음 회차는
   *    그 행을 보고 **안 보낸 글로 판단한다.** 세 값(true/false/null)을 그대로 올린다.
   */
  let lastSent
  /**
   * 🔴 **같은 메시지 지문 HOLD 는 처리 자리를 쓰지 않는다** (2026-09-29 · 01:00 실측).
   *    HOLD 8건이 시도 상한 9 중 8을 먹었고 등록·PR 0 으로 끝났다. HOLD 는 이 후보가
   *    **할 수 있는 일이 없다**는 뜻이지 시도한 것이 아니다 — `held` 로 표시해 ready 가 세지 않게 한다.
   *    `failClosed` 는 HOLD 여부를 판정할 수 없다(장부를 못 읽음)는 뜻이다 — ready 가 회차 전체를 멈춘다.
   */
  let held = false
  let failClosed = false
  const stop = (stage, code, message) => {
    blockedBy.push({ code, message })
    add(stage, 'blocked', message)
    const rolledBack = rollback()
    if (rolledBack.failures.length) {
      failClosed = true
      blockedBy.push({ code: 'ROLLBACK_FAILED',
        message: `[인프라] 등록 전 변경을 원상복구하지 못했다: ${rolledBack.failures.map((x) => `${x.path}: ${x.errorName}: ${x.errorDetail}`).join(' | ')}` })
    }
    return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, ...evidence(),
      ...(lastSent !== undefined ? { sent: lastSent } : {}),
      ...(held ? { held: true } : {}), ...(failClosed ? { failClosed: true } : {}) }
  }

  // ── ① gate — 등급·큐·brief ────────────────────────────────
  const g = gate(slug, loadQueueFn())
  if (!g.ok) {
    for (const b of g.blockedBy) blockedBy.push(b)
    add('gate', 'blocked', g.blockedBy.map((b) => b.message).join(' · '))
    return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item: g.item }
  }
  const item = g.item
  add('gate', 'ok', `${isAutoLaneEligible(item).profile ?? '-'} · image=${item.imageMode ?? '-'}`)

  // 🔴 경로도 주입점이다 — 시험이 실제 파일로 원복·교체를 확인하기 위한 자리 (운영은 저장소 경로 그대로)
  const p = (deps.paths ?? paths)(slug)
  const heroFile = (deps.heroFilePath ?? heroFilePath)(slug)
  if (write) {
    const recovered = recoverRegenTransaction({ slug, draftMd: p.draftMd, articleTs: p.articleTs })
    if (!recovered.ok) {
      failClosed = true
      return stop('recovery', recovered.code, `[INFRA] ${recovered.why}`)
    }
    if (recovered.recovered) add('recovery', 'ok', '급사한 재생성 교체를 원복한 뒤 진행')
  }
  /**
   * 🔴 **손대기 전에 찍는다.** 이 후보가 바꿀 수 있는 추적 파일을 전부 담는다 —
   *    변환 산출물 · hero 이미지 · 회수된 원고 · **등록 대상 두 파일**.
   *    다른 후보의 파일은 목록에 없다.
   *
   * 🔴 `articles.ts` · `topic-queue.ts` 를 넣는 이유는 **이중 방어**다
   *    (Codex 재검토 2026-09-26). register 안에서도 되돌리지만, 그 원복까지
   *    실패하면 회차가 두 파일이 어긋난 채로 끝난다. 그때 여기서 한 번 더 잡는다.
   *    🔴 등록에 **성공**하면 되돌리지 않는다 — rollback 은 BLOCKED 경로에서만 돈다.
   */
  if (write) {
    snapshot = trackedSnapshot([p.articleTs, heroFile, p.draftMd, ARTICLES_TS, QUEUE_TS])
      .map((f) => (f.path === QUEUE_TS ? { ...f, queueCas: { day: item.day, slug } }
        : f.path === ARTICLES_TS ? { ...f, pairWithQueue: true } : f))
    own = [...fileSnapshot([p.articleTs]), ...fileSnapshot([heroFile], { keepIfCreated: true })]
  }

  // ── ② draft.md 회수 ───────────────────────────────────────
  // 🔴 원고 존재 판정도 주입점이다 — 시험이 "원고 없음" 후보로 실제 회수 경로를 태우기 위한 자리 (운영은 실제 판정)
  if ((deps.progress ?? progress)(slug).hasDraftMd) {
    add('draft', 'skip', 'draft.md 가 이미 있다 — 덮어쓰지 않는다')
  } else if (!write) {
    add('draft', 'skip', 'dry-run — 회수하지 않는다 (draft.md 없음)')
  } else {
    /**
     * 🔴 **사람용 출력을 파싱하지 않는다 — 자식이 적은 구조화 결과가 정본이다** (2026-09-28 운영 실측).
     *    앞판은 stdout 한 줄("⏸ HOLD — 이미 보낸 글이다")을 사유로 넘겼다. 그 문장에 전송불명 표식이 없어
     *    분류기가 CONTENT 로 추정했고, 원고 잘못이 아닌 4건이 attempts +1 · 7일 격리에 걸렸다.
     *    이제 `--result-json` 의 행(`reason`·`sent`·`stage`)으로 분류한다. 파일이 없거나 깨졌으면
     *    **보냈는지 모른다** — CONTENT 로 추정하지 않고 전송불명으로 멈춘다(재전송 0).
     */
    /**
     * 🔴 **보낼 수 없는 글이면 runner 를 띄우지 않는다** (앞단 확인 · 2026-09-29).
     *    판정은 전송 경계와 **같은 함수**(`deliveryGate`)다 — 같은 brief → 같은 지문일 때만 HOLD 다.
     *    brief 가 바뀌어 지문이 달라지면 새 작업으로 연다. 정본 판정은 여전히 자식의 send 직전 예약이다.
     */
    const g0 = deliveryGate({ slug, ...(deps.draftsDir ? { draftsDir: deps.draftsDir } : {}), ...(quarantinePath ? { quarantinePath } : {}) })
    if (!g0.ok) {
      failClosed = true
      lastSent = null
      return stop('draft', 'QUARANTINE_UNREADABLE', `[INFRA] 장부를 읽지 못해 HOLD 여부를 모른다 — 보내지 않는다 (runner 0): ${g0.why}`)
    }
    if (g0.hold) {
      held = true
      lastSent = g0.hold.delivery?.sent ?? null
      return stop('draft', 'DELIVERY_UNCERTAIN_HOLD', `[DELIVERY_UNCERTAIN] ${g0.hold.why} (runner 0 · 전송 0건)`)
    }
    const resultPath = join(deps.fetchResultDir ?? PACKET_DIR, `fetch-result-${slug}-${process.pid}-${Date.now()}.json`)
    const r = runStep(WEBUI, ['--fetch', slug, '--result-json', resultPath])
    const structured = readFetchResults(resultPath)
    const row = structured.ok ? fetchResultFor(structured.body, slug) : null
    removeFetchResults(resultPath)
    if (!(r.code === 0 && row?.status === 'ok')) {
      if (!row) {
        lastSent = null
        return stop('draft', 'FETCH_RESULT_MISSING',
          `[DELIVERY_UNCERTAIN] 회수 결과를 읽지 못했다 (${structured.why ?? '행 없음'}) — 보냈는지 모른다 · 다시 보내지 않는다`)
      }
      const kind = classifyFailure({
        code: row.reason, stage: row.stage,
        message: [row.errorName, row.errorDetail].filter(Boolean).join(' · '),
        sent: row.sent,
      }).kind
      lastSent = row.sent
      // 🔴 앞단 확인과 자식 사이에 다른 회차가 예약했으면 자식이 HOLD 로 멈춘다 — 같은 HOLD 다
      if (row.reason === 'DELIVERY_UNCERTAIN_HOLD') held = true
      const tag = kind !== 'CONTENT' ? `[${kind}] ` : ''
      return stop('draft', 'FETCH_FAILED', `${tag}회수 실패 — ${describeFetchFailure(row)}`)
    }
    add('draft', 'ok', 'draft.md 회수')
  }
  /**
   * 🔴 draft.md 는 **회수 뒤** 찍는다. 이번 회차가 받은 첫 원고는 전송 비용을 치른 자산이다 —
   *    뒤에서 막혀도 지우지 않는다. 되돌리는 것은 **재생성이 바꾼 내용**이다.
   */
  if (write) own.push(...fileSnapshot([p.draftMd], { keepIfCreated: true }))

  // ── ③ article-draft.ts ────────────────────────────────────
  if (!existsSync(p.draftMd)) {
    return stop('article', 'DRAFT_MD_MISSING', 'draft.md 가 없어 변환할 수 없다')
  }
  {
    // --out 없이 부르면 검사만 한다. dry-run 은 그 모드를 쓴다.
    const args = write ? ['--in', p.draftMd, '--out', p.articleTs] : ['--in', p.draftMd]
    const r = runStep(MD2DRAFT, args)
    if (r.code !== 0) {
      return stop('article', 'CONVERT_FAILED', meaningfulLine(r.stderr || r.stdout))
    }
    add('article', write ? 'ok' : 'skip', write ? 'article-draft.ts 생성' : 'dry-run — 변환 검사만 통과')
  }

  if (!existsSync(p.articleTs)) {
    // dry-run 인데 아직 article-draft.ts 가 없으면 이후 단계는 판정할 수 없다.
    add('qa', 'skip', 'article-draft.ts 없음 — dry-run 에서는 여기까지')
    return { slug, verdict: 'DRY_RUN_INCOMPLETE', steps, blockedBy, write, dryRun: !write, item }
  }

  /**
   * 🔴 **QA 실패는 끝이 아니라 재생성 신호다** (M3-A).
   *    실패 패킷을 만들어 **기존 ChatGPT 웹 UI 경로**에 넘기고, 회수된 원고를
   *    다시 변환해 같은 QA 를 돌린다. 상한은 장부가 센다 (`MAX_REGEN_CALLS`).
   *    상한에 닿으면 **이 slug 만** HOLD 다 — 호출부는 다음 후보로 간다.
   */
  const laneProfile = isAutoLaneEligible(item).profile ?? 'STANDARD'
  let regenCalls = 0
  /**
   * 🔴 **첫 회수에서 이미 보낸 글은 다시 보내지 않는다** (2026-09-28 · P0-2).
   *    `--fetch-run` 이 `sent=true` 로 끝났는데 응답을 못 받은 경우가 있다
   *    (`response_timeout`). 그 글은 ChatGPT 대화에 **요청이 이미 쌓여 있다.**
   *    여기서 재생성을 걸면 같은 brief 가 두 번 올라간다.
   *
   *    그래서 재생성 **전에** 그날 회수 결과를 읽고, 전송불명이면 시도 자체를 0으로 둔다.
   *    이것은 횟수를 쓰지 않는다 — 원고가 틀린 것이 아니기 때문이다.
   */
  const firstFetch = (() => {
    if (deps.firstFetchResult !== undefined) return deps.firstFetchResult
    /**
     * 🔴 회수 경로와 **같은 진입점**으로 읽는다. 각자 읽으면 신원 검사가 한쪽에만 붙고,
     *    그 한쪽이 낡은 파일을 이번 회차 결과로 읽는다.
     */
    const date = deps.runDate ?? todayKst()
    const st = readRunFetchState({
      draftsDir: deps.draftsDir ?? DRAFTS_DIR, date,
      ...(deps.fetchResultPath ? { resultPath: deps.fetchResultPath } : {}),
    })
    return st.prior.ok ? fetchResultFor(st.prior.body, slug) : null
  })()
  const alreadySent = firstFetch
    ? classifyFailure({
      code: firstFetch.reason, stage: firstFetch.stage,
      message: [firstFetch.errorName, firstFetch.errorDetail].filter(Boolean).join(' · '),
      sent: firstFetch.sent,
    })
    : null

  const regenOnce = (stage, failures, actual = []) => {
    if (!write) return { ok: false, code: 'DRY_RUN', why: 'dry-run — 재생성하지 않는다' }
    if (firstFetch && firstFetch.status !== 'ok' && alreadySent?.kind === 'DELIVERY_UNCERTAIN') {
      const why = `첫 회수에서 이미 전송됐다 (${firstFetch.stage ?? '-'} ${firstFetch.reason ?? '-'}) — 다시 보내지 않는다`
      lastSent = firstFetch.sent
      add(stage, 'blocked', `[DELIVERY_UNCERTAIN] 재생성 건너뜀: ${why}`)
      return { ok: false, code: 'REGEN_SKIPPED_ALREADY_SENT', kind: 'DELIVERY_UNCERTAIN', why, sent: true }
    }
    const record = { call: regenHistory.length + 1, stage, failures: actual, outcome: null }
    regenHistory.push(record)
    /**
     * 🔴 **재생성 원고는 임시 경로로 받는다.** 자식은 draft.md 를 건드리지 않고,
     *    `applyRegenCandidate` 가 검증·변환·hero 승계에 성공했을 때만 원본을 바꾼다.
     */
    const candidate = join(deps.candidateDir ?? PACKET_DIR, `regen-draft-${slug}-${process.pid}-${randomUUID()}.md`)
    // 🔴 재생성 전후로 원고가 실제로 바뀌었는지 본다 — 전: 지금 draft.md · 후: 받은 임시 원고
    const fpOfFile = (path) => () => { try { return fingerprintOf(readFileSync(path, 'utf8')) } catch { return null } }
    const before = draftFingerprint ?? fpOfFile(p.draftMd)
    const after = draftFingerprint ?? fpOfFile(candidate)
    try {
      const rr = regen({ slug, profile: laneProfile, failures,
        runner: (ctx) => regenRunner({ ...ctx, draftOut: candidate }),
        previousFingerprint: before(), fingerprintOf: after,
        ...(quarantinePath ? { quarantinePath } : {}),
        ...(packetDir ? { packetDir } : {}),
        ...(deps.draftsDir ? { draftsDir: deps.draftsDir } : {}) })
      regenCalls = rr.regenCalls ?? regenCalls
      if (rr.reason) record.reason = rr.reason
      if (rr.invalid?.length) record.invalid = rr.invalid
      if (rr.conversationUrl) record.conversationUrl = rr.conversationUrl
      if (rr.assistantMessageId) record.assistantMessageId = rr.assistantMessageId
      if (rr.responseForm) record.responseForm = rr.responseForm
      /**
       * 🔴 **HOLD 는 이번 실행이 안 보낸 것일 뿐, 그 글의 전송 사실이 아니다.**
       *    `false` 를 올리면 장부가 앞 회차의 모름을 "안 보냄" 으로 덮는다 — 앞선 값을 올린다.
       */
      if (rr.held) lastSent = rr.priorSent ?? null
      else if (rr.sent !== undefined) lastSent = rr.sent
      if (!rr.ok) {
        record.outcome = rr.code
        /**
         * 🔴 인프라·전송불명은 **원고 문제가 아니다.** 사유에 그 사실을 적어
         *    장부와 다음 회차가 같은 판정을 하게 한다.
         */
        const tag = rr.kind && rr.kind !== 'CONTENT' ? `[${rr.kind}] ` : ''
        add(stage, 'blocked', `${tag}재생성 중단: ${rr.code} — ${rr.why}`)
        return rr
      }
      const applied = (deps.applyRegenCandidate ?? applyRegenCandidate)({
        slug, candidatePath: candidate, draftMd: p.draftMd, articleTs: p.articleTs, runFn: runStep,
        ...(deps.verifyHero ? { verifyHero: deps.verifyHero } : {}),
      })
      if (!applied.ok) {
        record.outcome = applied.code
        add(stage, 'blocked', `재생성 원고 거부: ${applied.code} — ${applied.why}`)
        return { ok: false, code: applied.code, why: applied.why, regenCalls }
      }
      record.outcome = 'APPLIED'
      add(stage, 'ok', `재생성 ${rr.regenCalls}/${MAX_REGEN_CALLS} — 검증·변환 통과 뒤 원고 교체${applied.heroCarried ? ' · hero 연결 유지 (이미지 호출 0)' : ''}`)
      return rr
    } finally {
      rmSync(candidate, { force: true })
    }
  }

  // ── ④ magazine QA ─────────────────────────────────────────
  {
    let r = runStep(QA, ['--draft', p.articleTs])
    while (r.code !== 0) {
      lastQaFailures = qaFailLines(r.stdout || r.stderr)
      // 🔴 패킷 내용은 바꾸지 않는다 — 전송 지문이 바뀌면 기존 HOLD 가 풀려 같은 요청이 다시 나간다
      const rr = regenOnce('qa', [{ code: 'QA_FAIL', label: 'magazine QA FAIL',
        sentence: (r.stdout || r.stderr).trim().split('\n').slice(-3).join(' ') }], lastQaFailures)
      /**
       * 🔴 **종류를 최종 사유에 싣는다.** 장부는 이 문장을 읽어 종류를 파생한다
       *    (`entryKind`). 여기서 떨어뜨리면 인프라·전송불명 실패가 **내용 실패로 기록되어**
       *    멀쩡한 원고가 긴 격리에 들어간다 — 2026-09-28 에 실제로 그랬다.
       */
      if (!rr.ok) {
        if (rr.code === 'REGEN_DELIVERY_HOLD') held = true
        if (rr.code === 'LEDGER_UNREADABLE') failClosed = true
        const kindTag = rr.kind && rr.kind !== 'CONTENT' ? `[${rr.kind}] ` : ''
        // 🔴 상한·HOLD 사유만 남기지 않는다 — 실제 QA 실패를 같은 문장에 싣는다
        const actual = lastQaFailures.length ? ` · 실제 QA FAIL: ${lastQaFailures.join(' / ').slice(0, 300)}` : ''
        return stop('qa', 'QA_FAIL', `${kindTag}magazine QA FAIL — ${rr.code}: ${rr.why}${actual}`)
      }
      r = runStep(QA, ['--draft', p.articleTs])
    }
    add('qa', 'ok', regenCalls ? `QA FAIL 0 (재생성 ${regenCalls}회 뒤)` : 'QA FAIL 0')
  }

  // ── ⑤ hero (REQUIRED) ─────────────────────────────────────
  // batch-qa 앞에 둔다. hero 가 없으면 batch-qa 가 HERO_MISSING 으로 막기 때문이다.
  //
  // 🔴 **alt 는 review.ts → cluster 기본값 순서로 온다** (M3-A).
  //    사람에게 입력을 요구하지 않는다. 지어내지도 않는다 —
  //    미리 정해 둔 표를 읽을 뿐이다 (lib/magazine-hero-brief.mjs).
  //    `--alt` 를 직접 준 경우에는 그쪽이 이긴다.
  let heroBrief = { ok: true, alt: null, scene: null, reasons: [] }
  if (!alt) heroBrief = resolveHeroBrief(slug, item)
  const heroAlt = alt ?? heroBrief.alt

  // 🔴 자동 레인이면 OPTIONAL 도 필수다 — 판단할 사람이 없는 자리에서 "선택" 은 "없음" 이 된다
  const hp = heroPlan(item, { alt: heroAlt, allowOptional, autoLane })
  if (!hp.need) {
    add('hero', 'skip', hp.reason)
  } else if (!heroAlt && !heroBrief.ok) {
    // 🔴 "alt 가 없다" 보다 **왜 못 읽었는지**를 말한다. 그래야 사람이 review.ts 를 고친다.
    return stop('hero', heroBrief.reasons[0]?.code ?? 'HERO_ALT_REQUIRED', heroBrief.reasons.map((r) => r.why).join(' · '))
  } else if (hp.blocked) {
    return stop('hero', hp.blocked.code, hp.blocked.message)
  } else if (!write) {
    add('hero', 'skip', `dry-run — hero 를 만들지 않는다 (alt 확보: ${alt ? '--alt' : 'review.ts'})`)
  } else {
    const args = ['--slug', slug, '--alt', hp.alt, '--write']
    // 🔴 scene 은 선택이다. 없으면 hero runner 가 cluster 기본 장면을 고른다.
    if (heroBrief.scene) args.push('--prompt', heroBrief.scene)
    // 🔴 자동 레인이 강제한 경우에도 runner 에게 OPTIONAL 을 허용한다고 알려야 만든다
    if (hp.mode !== 'REQUIRED') args.push('--allow-optional')
    const r = runStep(HERO, args)
    if (r.code !== 0) {
      return stop('hero', 'HERO_FAILED', meaningfulLine(r.stderr || r.stdout))
    }
    add('hero', 'ok', `hero 생성 (${hp.mode ?? '-'}${hp.enforcedByLane ? ' · 자동 레인 강제' : ''}${heroBrief.scene ? ' · review scene' : ' · 기본 장면'})`)
  }

  // ── ⑥ batch-qa ────────────────────────────────────────────
  {
    const runBatch = () => {
      const r = runStep(BATCH_QA, [slug, '--strict-auto', '--json', ...(autoLane ? ['--require-hero'] : [])], { json: true })
      const rows = Array.isArray(r.json) ? r.json : r.json?.results ?? []
      return rows.find((x) => x.slug === slug) ?? null
    }
    let row = runBatch()
    if (!row) return stop('batch', 'BATCH_QA_UNREADABLE', 'batch-qa 결과를 읽지 못했다')
    /** 🔴 원고 문장이 문제면 재생성한다. 재료(hero·큐)가 문제면 재생성해도 같다 */
    const CONTENT_CODES = /^(MED_|FIN_|SEN_|AGE_WORDING|BRAND_LEAK|DUPLICATE_SENTENCE|UNSUPPORTED_NUMERIC_CLAIM)/
    while (row.verdict !== 'READY_TO_SCHEDULE') {
      const content = (row.blockedBy ?? []).filter((b) => CONTENT_CODES.test(b.code))
      if (!content.length) break
      const rr = regenOnce('batch', content.map((b) => ({ code: b.code, label: b.message, sentence: '' })),
        content.map((b) => `${b.code}: ${b.message}`))
      if (!rr.ok) break
      row = runBatch()
      if (!row) return stop('batch', 'BATCH_QA_UNREADABLE', 'batch-qa 결과를 읽지 못했다')
    }
    if (row.verdict !== 'READY_TO_SCHEDULE') {
      for (const b of row.blockedBy ?? []) blockedBy.push(b)
      add('batch', 'blocked', (row.reasons ?? []).join(' · '))
      rollback()
      return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item, batch: row.checks, regenCalls, ...evidence() }
    }
    add('batch', 'ok', `READY · ${laneProfile}${regenCalls ? ` · 재생성 ${regenCalls}회` : ''} · hero=${row.checks.heroOk ?? '-'}`)
  }

  // ── ⑦ register ────────────────────────────────────────────
  if (!publishAt) {
    return stop('register', 'PUBLISH_AT_REQUIRED', '--publish-at 이 없다')
  }
  {
    // 🔴 dry-run 은 --write 를 빼는 것으로 만든다.
    const args = ['--slug', slug, '--publish-at', publishAt, '--json']
    if (write) args.push('--write')
    const r = runStep(REGISTER, args, { json: true })
    const verdict = r.json?.verdict ?? (r.code === 0 ? 'READY' : 'BLOCKED')
    if (verdict === 'BLOCKED' || r.code !== 0) {
      const reasons = r.json?.reasons ?? [meaningfulLine(r.stderr || r.stdout)]
      blockedBy.push({ code: 'REGISTER_BLOCKED', message: reasons.join(' · ') })
      add('register', 'blocked', reasons.join(' · '))
      // 🔴 register 가 스스로 막은 것이다 — articles.ts·큐는 건드리지 않았다.
      //    이 후보가 만든 중간 산출물만 되돌린다.
      rollback()
      return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item }
    }
    add('register', write ? 'ok' : 'skip', write ? `등록 (publishAt ${publishAt})` : `dry-run 통과 (publishAt ${publishAt})`)
  }

  // ── ⑧ PR ─────────────────────────────────────────────────
  if (!pr) {
    add('pr', 'skip', '--pr 없음')
  } else if (!write) {
    add('pr', 'skip', 'dry-run — PR 을 만들지 않는다')
  } else {
    add('pr', 'ok', 'PR 대상 (호출부가 만든다)')
  }

  // 🔴 등록까지 갔으면 재생성 기록을 지운다 — 옛 실패를 다음 회차가 이어받지 않는다
  if (write) { try { clearRegen(slug, quarantinePath) } catch { /* 장부 문제로 성공을 되돌리지 않는다 */ } }
  return { slug, verdict: write ? 'DONE' : 'DRY_RUN_OK', steps, blockedBy, write, dryRun: !write, item, regenCalls }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`단일 slug 자동 후속 처리 (등급으로 거르지 않는다)

  node scripts/magazine-auto-register.mjs --slug <slug> --dry-run
  node scripts/magazine-auto-register.mjs --slug <slug> --publish-at YYYY-MM-DD --write
  node scripts/magazine-auto-register.mjs --slug <slug> --publish-at ... --write --pr
  node scripts/magazine-auto-register.mjs --slug <slug> --alt "…여성" --write

  --dry-run   파일 변경 0건 (기본)
  --write     회수·변환·hero·register 를 실제로 수행
  --pr        register write 후 PR 대상으로 표시 (-ready 가 실제 PR 을 만든다)
  --alt       hero alt 를 직접 지정한다 (없으면 review.ts → cluster 기본값)
  --allow-optional  OPTIONAL 도 hero 를 만든다 (기본 스킵)
  --json      결과를 JSON 으로

🔴 큐에 없거나 validationProfile 을 정할 수 없는 slug 만 gate 에서 끝난다.
🔴 사람 승인 손잡이는 없다.`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (name) => {
    const i = argv.indexOf(name)
    return i === -1 ? null : argv[i + 1]
  }
  const slug = arg('--slug')
  if (!slug) {
    console.error('  --slug 가 필요하다')
    process.exit(2)
  }
  const write = argv.includes('--write')
  if (!write && !argv.includes('--dry-run')) {
    console.error('  --dry-run 또는 --write 를 명시해야 한다')
    process.exit(2)
  }

  const result = drive(slug, {
    write,
    pr: argv.includes('--pr'),
    publishAt: arg('--publish-at'),
    alt: arg('--alt'),
    allowOptional: argv.includes('--allow-optional'),
  })

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log('')
    console.log(`  ${slug} — ${result.verdict}${result.dryRun ? ' (dry-run)' : ''}`)
    for (const s of result.steps) {
      const mark = s.status === 'ok' ? '✅' : s.status === 'skip' ? '·' : '⛔'
      console.log(`    ${mark} ${s.stage.padEnd(9)} ${s.detail}`)
    }
    console.log('')
  }
  process.exit(result.verdict === 'BLOCKED' ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-register.mjs')) main()
