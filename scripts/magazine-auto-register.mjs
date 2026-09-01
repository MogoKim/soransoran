#!/usr/bin/env node
/**
 * LOW/MEDIUM 단일 slug 자동 후속 처리 — 원고 회수부터 등록 PR 까지.
 *
 *   producer(00:10 KST) 가 brief.md 를 만들어 두면 그 다음을 이 스크립트가 잇는다.
 *
 *   gate → draft.md 회수 → article-draft.ts → magazine QA → batch-qa
 *        → hero(REQUIRED) → register → PR
 *
 * 🔴 기본이 dry-run 이다. --write 없이는 파일을 하나도 만들지 않는다.
 *    register 뿐 아니라 회수·변환·hero 까지 전부 --write 아래에서만 쓴다.
 *
 * 🔴 HIGH 는 첫 단계에서 끝난다.
 *    `magazine-auto-lane.mjs` 의 gate 가 topic-queue 를 정본으로 등급을 본다.
 *    batch-qa 의 READY 를 그대로 믿지 않는다 — 큐에 없는 slug 는 batch-qa 가
 *    등급을 검사하지 않기 때문이다(모듈 주석 참조).
 *
 * 🔴 --founder-approved 를 register 에 넘기지 않는다.
 *    그 손잡이는 사람이 직접 register 를 부를 때만 쓴다. 자동 레인에는 자리가 없다.
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
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue } from './lib/magazine-load.mjs'
import { gate, progress, heroPlan, paths } from './lib/magazine-auto-lane.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath

const WEBUI = join(ROOT, 'scripts/magazine-webui-runner.mjs')
const MD2DRAFT = join(ROOT, 'scripts/magazine-md-to-draft.mjs')
const QA = join(ROOT, 'scripts/magazine-qa.mjs')
const BATCH_QA = join(ROOT, 'scripts/magazine-batch-qa.mjs')
const HERO = join(ROOT, 'scripts/magazine-hero-runner.mjs')
const REGISTER = join(ROOT, 'scripts/magazine-register.mjs')

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
export function drive(slug, opts) {
  const { write = false, pr = false, publishAt = null, alt = null, allowOptional = false } = opts
  const steps = []
  const blockedBy = []
  const add = (stage, status, detail) => steps.push({ stage, status, detail })
  const stop = (stage, code, message) => {
    blockedBy.push({ code, message })
    add(stage, 'blocked', message)
    return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write }
  }

  // ── ① gate — 등급·큐·brief ────────────────────────────────
  const g = gate(slug, loadQueue())
  if (!g.ok) {
    for (const b of g.blockedBy) blockedBy.push(b)
    add('gate', 'blocked', g.blockedBy.map((b) => b.message).join(' · '))
    return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item: g.item }
  }
  const item = g.item
  add('gate', 'ok', `${item.riskLevel} · auto=true · image=${item.imageMode ?? '-'}`)

  const p = paths(slug)

  // ── ② draft.md 회수 ───────────────────────────────────────
  if (progress(slug).hasDraftMd) {
    add('draft', 'skip', 'draft.md 가 이미 있다 — 덮어쓰지 않는다')
  } else if (!write) {
    add('draft', 'skip', 'dry-run — 회수하지 않는다 (draft.md 없음)')
  } else {
    const r = run(WEBUI, ['--fetch', slug])
    if (r.code !== 0) {
      const why = /login_required/i.test(r.stdout + r.stderr) ? 'ChatGPT login_required' : '회수 실패'
      return stop('draft', 'FETCH_FAILED', `${why} — ${(r.stderr || r.stdout).trim().split('\n').pop()}`)
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
    const r = run(MD2DRAFT, args)
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

  // ── ④ magazine QA ─────────────────────────────────────────
  {
    const r = run(QA, ['--draft', p.articleTs])
    if (r.code !== 0) {
      return stop('qa', 'QA_FAIL', 'magazine QA FAIL — register 로 가지 않는다')
    }
    add('qa', 'ok', 'QA FAIL 0')
  }

  // ── ⑤ hero (REQUIRED) ─────────────────────────────────────
  // batch-qa 앞에 둔다. hero 가 없으면 batch-qa 가 HERO_MISSING 으로 막기 때문이다.
  const hp = heroPlan(item, { alt, allowOptional })
  if (!hp.need) {
    add('hero', 'skip', hp.reason)
  } else if (hp.blocked) {
    return stop('hero', hp.blocked.code, hp.blocked.message)
  } else if (!write) {
    add('hero', 'skip', 'dry-run — hero 를 만들지 않는다')
  } else {
    const args = ['--slug', slug, '--alt', hp.alt, '--write']
    if (hp.mode === 'OPTIONAL') args.push('--allow-optional')
    const r = run(HERO, args)
    if (r.code !== 0) {
      return stop('hero', 'HERO_FAILED', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '))
    }
    add('hero', 'ok', `hero 생성 (${hp.mode})`)
  }

  // ── ⑥ batch-qa ────────────────────────────────────────────
  {
    const r = run(BATCH_QA, [slug, '--strict-auto', '--json'], { json: true })
    const rows = Array.isArray(r.json) ? r.json : r.json?.results ?? []
    const row = rows.find((x) => x.slug === slug) ?? null
    if (!row) return stop('batch', 'BATCH_QA_UNREADABLE', 'batch-qa 결과를 읽지 못했다')
    if (row.verdict !== 'READY_TO_SCHEDULE') {
      for (const b of row.blockedBy ?? []) blockedBy.push(b)
      add('batch', 'blocked', (row.reasons ?? []).join(' · '))
      return { slug, verdict: 'BLOCKED', steps, blockedBy, write, dryRun: !write, item, batch: row.checks }
    }
    add('batch', 'ok', `READY · ${row.checks.riskLevel} · hero=${row.checks.heroOk ?? '-'}`)
  }

  // ── ⑦ register ────────────────────────────────────────────
  if (!publishAt) {
    return stop('register', 'PUBLISH_AT_REQUIRED', '--publish-at 이 없다')
  }
  {
    // 🔴 --founder-approved 를 넘기지 않는다. dry-run 은 --write 를 빼는 것으로 만든다.
    const args = ['--slug', slug, '--publish-at', publishAt, '--json']
    if (write) args.push('--write')
    const r = run(REGISTER, args, { json: true })
    const verdict = r.json?.verdict ?? (r.code === 0 ? 'READY' : 'BLOCKED')
    if (verdict === 'BLOCKED' || r.code !== 0) {
      const reasons = r.json?.reasons ?? [(r.stderr || r.stdout).trim().split('\n').pop()]
      blockedBy.push({ code: 'REGISTER_BLOCKED', message: reasons.join(' · ') })
      add('register', 'blocked', reasons.join(' · '))
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

  return { slug, verdict: write ? 'DONE' : 'DRY_RUN_OK', steps, blockedBy, write, dryRun: !write, item }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`LOW/MEDIUM 단일 slug 자동 후속 처리

  node scripts/magazine-auto-register.mjs --slug <slug> --dry-run
  node scripts/magazine-auto-register.mjs --slug <slug> --publish-at YYYY-MM-DD --write
  node scripts/magazine-auto-register.mjs --slug <slug> --publish-at ... --write --pr
  node scripts/magazine-auto-register.mjs --slug <slug> --alt "…여성" --write

  --dry-run   파일 변경 0건 (기본)
  --write     회수·변환·hero·register 를 실제로 수행
  --pr        register write 후 PR 대상으로 표시 (-ready 가 실제 PR 을 만든다)
  --alt       imageMode=REQUIRED 일 때 hero alt (사람이 적는다)
  --allow-optional  OPTIONAL 도 hero 를 만든다 (기본 스킵)
  --json      결과를 JSON 으로

🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 끝난다.
🔴 --founder-approved 는 이 경로에 없다.`)
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
