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
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue, ARTICLES_TS, QUEUE_TS } from './lib/magazine-load.mjs'
import { gate, progress, heroPlan, paths } from './lib/magazine-auto-lane.mjs'
import { resolveHeroBrief } from './lib/magazine-hero-brief.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { attemptRegeneration, clearRegen, MAX_REGEN_CALLS } from './lib/magazine-regen.mjs'
import { fingerprintOf } from './lib/magazine-quarantine.mjs'
import { heroFilePath } from './lib/magazine-hero.mjs'

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

export function restoreSnapshot(snap) {
  const restored = []
  for (const f of snap) {
    try {
      const now = existsSync(f.path) ? readFileSync(f.path) : null
      if (f.existed) {
        if (!now || !now.equals(f.bytes)) { writeFileSync(f.path, f.bytes); restored.push(f.path) }
      } else if (now) {
        // 🔴 추적 파일인데 스냅샷 시점에 없었다 = 이 회차가 만들었다. 지운다.
        rmSync(f.path, { force: true }); restored.push(f.path)
      }
    } catch { /* 되돌리기 실패가 회차 판정을 뒤집지 않는다 — 아래에서 보고만 한다 */ }
  }
  return restored
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
function webuiRegenRunner({ slug, packetPath }) {
  const r = run(WEBUI, ['--fetch', slug, '--force', '--regen-packet', packetPath])
  if (r.code !== 0) {
    const why = /login_required/i.test(r.stdout + r.stderr) ? 'ChatGPT login_required' : '재생성 회수 실패'
    return { ok: false, why: `${why} — ${(r.stderr || r.stdout).trim().split('\n').pop()}` }
  }
  return { ok: true }
}

/**
 * 한 slug 를 끝까지 몰고 간다.
 *
 * @param {object} [deps] 🔴 시험이 실제 orchestration 을 돌리기 위한 주입 지점.
 *        운영에서는 비워 둔다 — 그러면 진짜 스크립트가 돈다.
 */
export function drive(slug, opts, deps = {}) {
  const runStep = deps.run ?? run
  const regenRunner = deps.regenRunner ?? webuiRegenRunner
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
  const rollback = () => {
    if (!write || !snapshot.length) return []
    const r = restoreSnapshot(snapshot)
    if (r.length) add('rollback', 'ok', `등록 전 중간 변경 ${r.length}건 원상복구: ${r.map((x) => x.split('/').pop()).join(', ')}`)
    return r
  }
  const stop = (stage, code, message) => {
    blockedBy.push({ code, message })
    add(stage, 'blocked', message)
    rollback()
    return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write }
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

  const p = paths(slug)
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
  if (write) snapshot = trackedSnapshot([p.articleTs, heroFilePath(slug), p.draftMd, ARTICLES_TS, QUEUE_TS])

  // ── ② draft.md 회수 ───────────────────────────────────────
  if (progress(slug).hasDraftMd) {
    add('draft', 'skip', 'draft.md 가 이미 있다 — 덮어쓰지 않는다')
  } else if (!write) {
    add('draft', 'skip', 'dry-run — 회수하지 않는다 (draft.md 없음)')
  } else {
    const r = runStep(WEBUI, ['--fetch', slug])
    if (r.code !== 0) {
      const why = /login_required/i.test(r.stdout + r.stderr) ? 'ChatGPT login_required' : '회수 실패'
      return stop('draft', 'FETCH_FAILED', `${why} — ${meaningfulLine(r.stderr || r.stdout)}`)
    }
    add('draft', 'ok', 'draft.md 회수')
  }

  // ── ③ article-draft.ts ────────────────────────────────────
  if (!existsSync(p.draftMd)) {
    return stop('article', 'DRAFT_MD_MISSING', 'draft.md 가 없어 변환할 수 없다')
  }
  {
    // --out 없이 부르면 검사만 한다. dry-run 은 그 모드를 쓴다.
    const args = write ? ['--in', p.draftMd, '--out', p.articleTs] : ['--in', p.draftMd]
    const r = runStep(MD2DRAFT, args)
    if (r.code !== 0) {
      return stop('article', 'CONVERT_FAILED', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '))
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
  const regenOnce = (stage, failures) => {
    if (!write) return { ok: false, code: 'DRY_RUN', why: 'dry-run — 재생성하지 않는다' }
    // 🔴 재생성 전후로 원고가 실제로 바뀌었는지 본다
    const fp = draftFingerprint ?? (() => {
      try { return fingerprintOf(readFileSync(p.draftMd, 'utf8')) } catch { return null }
    })
    const rr = regen({ slug, profile: laneProfile, failures, runner: regenRunner,
      previousFingerprint: fp(), fingerprintOf: fp,
      ...(quarantinePath ? { quarantinePath } : {}),
      ...(packetDir ? { packetDir } : {}) })
    regenCalls = rr.regenCalls ?? regenCalls
    if (!rr.ok) { add(stage, 'blocked', `재생성 중단: ${rr.code} — ${rr.why}`); return rr }
    add(stage, 'ok', `재생성 ${rr.regenCalls}/${MAX_REGEN_CALLS} — 실패 패킷 전달 후 원고 회수`)
    // 🔴 회수된 draft.md 를 다시 변환한다. 변환 없이 QA 를 돌리면 옛 원고를 본다.
    const c = runStep(MD2DRAFT, ['--in', p.draftMd, '--out', p.articleTs])
    if (c.code !== 0) return { ok: false, code: 'CONVERT_FAILED', why: (c.stderr || c.stdout).trim().split('\n').pop() }
    return rr
  }

  // ── ④ magazine QA ─────────────────────────────────────────
  {
    let r = runStep(QA, ['--draft', p.articleTs])
    while (r.code !== 0) {
      const rr = regenOnce('qa', [{ code: 'QA_FAIL', label: 'magazine QA FAIL',
        sentence: (r.stdout || r.stderr).trim().split('\n').slice(-3).join(' ') }])
      if (!rr.ok) return stop('qa', 'QA_FAIL', `magazine QA FAIL — ${rr.code}: ${rr.why}`)
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
      const rr = regenOnce('batch', content.map((b) => ({ code: b.code, label: b.message, sentence: '' })))
      if (!rr.ok) break
      row = runBatch()
      if (!row) return stop('batch', 'BATCH_QA_UNREADABLE', 'batch-qa 결과를 읽지 못했다')
    }
    if (row.verdict !== 'READY_TO_SCHEDULE') {
      for (const b of row.blockedBy ?? []) blockedBy.push(b)
      add('batch', 'blocked', (row.reasons ?? []).join(' · '))
      rollback()
      return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item, batch: row.checks, regenCalls }
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
      const reasons = r.json?.reasons ?? [(r.stderr || r.stdout).trim().split('\n').pop()]
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
