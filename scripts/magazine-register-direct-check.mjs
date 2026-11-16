#!/usr/bin/env node
/**
 * register 의 DIRECT · legacy 재료 판정 — **실제 `magazine-register.mjs` CLI** 로 본다 (2026-10-31).
 *
 * 🔴 왜 생겼나. 10/31 01:00 age-learning(첫 DIRECT 등록)이 QA · hero · batch-qa 를 다 지나고
 *    register 에서 `review.ts 가 없다` 로 막혔다. register 는 mode 를 보지 않고 review.ts 를 요구했고,
 *    DIRECT 시험(`magazine-direct-spec-wire-check`)은 register 를 `{ verdict: 'READY' }` 대역으로 바꿔 한 번도 실제로 돌지 않았다.
 *    대역이 실제보다 강했다 — 그래서 이 검사는 register 를 **대역 없이** 임시 루트에서 자식 프로세스로 띄운다.
 *
 *   D01  DIRECT · 유효 spec/2 · article-draft · hero · review.ts 없음 → dry-run READY · 판정 근거는 그 spec · 쓰기 0
 *   D02  같은 조건 --write → 임시 articles 에 SCHEDULED 1건 · 큐 행 제거 · journal 0 · review.ts 를 만들지 않는다
 *   D03  legacy · review.ts 없음 → 기존대로 BLOCKED (review.ts 있으면 READY — 대조군)
 *   D04  DIRECT spec 없음 → DIRECT_SPEC_MISSING
 *   D05  DIRECT spec 손상 · 다른 바이트 → DIRECT_SPEC_SPEC_CONFLICT
 *   D06  승인 source drift (sourceHash 불일치) → DIRECT_SPEC_SOURCE_NOT_READY
 *   D07  정본 큐 행 drift → DIRECT_SPEC_SOURCE_NOT_READY
 *   D08  모르는 directSpecMode → UNKNOWN_MAGAZINE_AUTO_MODE (review.ts 가 있어도 legacy 로 내리지 않는다)
 *   D09  G8 신원 불일치 — manifest drift · G8 행의 opt-in 철회 → BLOCKED (review.ts 가 있어도)
 *   D10  이미 articles 에 있는 slug → 기존대로 BLOCKED
 *   D11  슬롯 충돌 → 기존대로 BLOCKED
 *   D12  큐 중복 행 → 기존대로 BLOCKED
 *   D13  imageMode=REQUIRED 인데 hero 없음 → 기존대로 BLOCKED
 *   D14  auto-register drive 의 실제 register 호출 → DONE · articles 반영 · DIRECT 등록 영수증 (register 만은 대역 0)
 *
 * 🔴 fixture 는 `magazine-direct-topic-forbidden-check` 의 임시 루트 · DIRECT/legacy 세계를 그대로 쓴다.
 * 🔴 HOME 은 임시 루트다 — 큐 writer 잠금 · 장부가 운영 자리를 건드리지 않는다.
 *
 * 실행: node scripts/magazine-register-direct-check.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { directWorld, legacyWorld, makeRoot } from './magazine-direct-topic-forbidden-check.mjs'
import { renderQueueRow } from './lib/magazine-g8-promoter.mjs'
import { parseQueueSource } from './lib/magazine-load.mjs'

const DATE = '2026-10-30'

/** 실제 register CLI — 임시 루트의 사본을 그 루트에서 돌린다 */
export function runRegister(root, slug, { date = DATE, write = false } = {}) {
  const r = spawnSync(process.execPath, ['scripts/magazine-register.mjs', '--slug', slug, '--publish-at', date, '--json', ...(write ? ['--write'] : [])],
    { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root } })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* 아래에서 단언 */ }
  assert.ok(json && typeof json.verdict === 'string', `register 출력을 읽지 못했다 (rc ${r.status}): ${(r.stderr || r.stdout).slice(0, 300)}`)
  return { rc: r.status, json }
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8')
const ARTICLES = 'src/content/magazine/articles.ts'
const QUEUE = 'drafts/magazine/topic-queue.ts'
const has = (r, re) => r.json.reasons.some((x) => re.test(x))
const blocked = (r, re, label) => {
  assert.equal(r.json.verdict, 'BLOCKED', `${label} 인데 막지 않았다: ${JSON.stringify(r.json.reasons)}`)
  assert.notEqual(r.rc, 0)
  assert.ok(has(r, re), `${label} 사유가 없다: ${JSON.stringify(r.json.reasons)}`)
}
/** 큐 파일 text 에서 그 slug 행만 고친다 */
const editQueueRow = (root, slug, fn) => {
  const p = join(root, QUEUE)
  const text = readFileSync(p, 'utf8')
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.includes(`"slug":"${slug}"`))
  assert.ok(i >= 0, `큐에서 ${slug} 행을 찾지 못했다`)
  lines[i] = fn(lines[i])
  writeFileSync(p, lines.join('\n'))
}
const appendQueueLine = (root, line) => {
  const p = join(root, QUEUE)
  const text = readFileSync(p, 'utf8')
  const end = text.lastIndexOf('\n]')
  writeFileSync(p, `${text.slice(0, end)}\n${line}${text.slice(end)}`)
}
const queueLineOf = (root, slug) => read(root, QUEUE).split('\n').find((l) => l.includes(`"slug":"${slug}"`))
const queueCount = (root, slug) => parseQueueSource(read(root, QUEUE)).filter((q) => q.slug === slug).length
/**
 * 🔴 세계 fixture 는 큐 행을 JSON 한 줄로 붙인다 — 실제 큐(G8 편입기 · materialize)는 `renderQueueRow` 블록이다.
 *    register 의 큐 행 제거(`removeQueueDay`)는 실제 블록 모양만 안다 — 쓰기 반례는 실제 모양으로 바꾼 뒤 본다.
 */
const realQueueRow = (root, slug) => {
  const line = queueLineOf(root, slug)
  assert.ok(line, `큐에서 ${slug} 행을 찾지 못했다`)
  const p = join(root, QUEUE)
  writeFileSync(p, read(root, QUEUE).replace(`${line}\n`, renderQueueRow(JSON.parse(line.trim().replace(/,$/, '')))))
  assert.equal(queueCount(root, slug), 1)
}

export function registerDirectCases({ root = () => makeRoot() } = {}) {
  return [
    ['D01 DIRECT · 유효 spec/2 · hero · review.ts 없음 → 실제 register dry-run READY · 근거는 그 spec · 쓰기 0', async () => {
      const r0 = root(); const w = await directWorld(r0)
      const before = [read(r0, ARTICLES), read(r0, QUEUE)]
      const r = runRegister(r0, w.row.slug)
      assert.equal(r.json.verdict, 'READY', JSON.stringify(r.json.reasons))
      assert.equal(r.rc, 0)
      assert.ok(r.json.notes.includes(`directSpec=${w.judged.spec.specHash}`), `판정 근거가 디스크 spec 이 아니다: ${JSON.stringify(r.json.notes)}`)
      assert.deepEqual([read(r0, ARTICLES), read(r0, QUEUE)], before, 'dry-run 이 파일을 바꿨다')
      assert.equal(existsSync(join(w.dir, 'review.ts')), false)
    }],
    ['D02 DIRECT --write → 임시 articles 에 SCHEDULED 1건 · 큐 행 제거 · journal 0 · review.ts 0', async () => {
      const r0 = root(); const w = await directWorld(r0); realQueueRow(r0, w.row.slug)
      const r = runRegister(r0, w.row.slug, { write: true })
      assert.equal(r.json.verdict, 'READY', JSON.stringify(r.json.reasons))
      assert.equal(r.rc, 0)
      const articles = read(r0, ARTICLES)
      assert.equal(articles.split(`'${w.row.slug}': {`).length - 1, 1, 'articles 에 정확히 1건이 아니다')
      const rec = articles.slice(articles.indexOf(`'${w.row.slug}': {`))
      assert.match(rec.slice(0, 4000), /status: 'SCHEDULED'/)
      assert.match(rec.slice(0, 4000), new RegExp(`publishAt: '${DATE}T10:30:00\\+09:00'`))
      assert.equal(queueCount(r0, w.row.slug), 0, '큐 행이 남았다')
      assert.equal(existsSync(join(r0, 'drafts/magazine/_runs/.register-journal.json')), false, 'journal 이 남았다')
      assert.equal(existsSync(join(w.dir, 'review.ts')), false, 'DIRECT 등록이 review.ts 를 만들었다')
    }],
    ['D03 legacy · review.ts 없음 → 기존대로 BLOCKED · review.ts 있으면 READY (대조군)', async () => {
      const r0 = root(); const w = await legacyWorld(r0, { review: null })
      blocked(runRegister(r0, basename(w.dir)), /review\.ts 가 없다/, 'legacy review.ts 없음')
      const r1 = root(); const w1 = await legacyWorld(r1)
      const ok = runRegister(r1, basename(w1.dir))
      assert.equal(ok.json.verdict, 'READY', JSON.stringify(ok.json.reasons))
    }],
    ['D04 DIRECT spec 없음 → DIRECT_SPEC_MISSING', async () => {
      const r0 = root(); const w = await directWorld(r0, { spec: 'none' })
      blocked(runRegister(r0, w.row.slug), /DIRECT_SPEC_MISSING/, 'spec 없음')
    }],
    ['D05 DIRECT spec 손상 · 다른 바이트 → DIRECT_SPEC_SPEC_CONFLICT', async () => {
      for (const spec of ['corrupt', 'conflict']) {
        const r0 = root(); const w = await directWorld(r0, { spec })
        blocked(runRegister(r0, w.row.slug), /DIRECT_SPEC_SPEC_CONFLICT/, `spec ${spec}`)
      }
    }],
    ['D06 승인 source drift → DIRECT_SPEC_SOURCE_NOT_READY', async () => {
      const r0 = root(); const w = await directWorld(r0)
      const sp = join(r0, 'drafts/magazine/article-spec-source', `${w.entry.node.graphVersion}.json`)
      const doc = JSON.parse(readFileSync(sp, 'utf8'))
      doc.entries[0].plan.notes = `${doc.entries[0].plan.notes} (승인 뒤 손편집)`
      writeFileSync(sp, `${JSON.stringify(doc, null, 2)}\n`)
      blocked(runRegister(r0, w.row.slug), /DIRECT_SPEC_SOURCE_NOT_READY/, 'source drift')
    }],
    ['D07 정본 큐 행 drift → DIRECT_SPEC_SOURCE_NOT_READY', async () => {
      const r0 = root(); const w = await directWorld(r0, { queueEdit: (row) => ({ ...row, title: `${row.title} (큐만 바뀜)` }) })
      blocked(runRegister(r0, w.row.slug), /DIRECT_SPEC_SOURCE_NOT_READY/, 'queue drift')
    }],
    ['D08 모르는 directSpecMode → UNKNOWN_MAGAZINE_AUTO_MODE · review.ts 가 있어도 legacy 로 내리지 않는다', async () => {
      const r0 = root(); const w = await legacyWorld(r0)
      const slug = basename(w.dir)
      editQueueRow(r0, slug, (l) => l.replace(`"slug":"${slug}"`, `"slug":"${slug}","directSpecMode":"DIRECT_SPEC_V9"`))
      blocked(runRegister(r0, slug), /UNKNOWN_MAGAZINE_AUTO_MODE/, '모르는 mode')
    }],
    ['D09 G8 신원 불일치 — manifest drift · G8 행 opt-in 철회 → BLOCKED (review.ts 가 있어도)', async () => {
      const r0 = root(); const w = await directWorld(r0, { queueEdit: (row) => ({ ...row, g8ManifestHash: 'sha256:dtf-manifest-OTHER' }) })
      blocked(runRegister(r0, w.row.slug), /DIRECT_SPEC_SOURCE_NOT_READY/, 'manifest drift')
      const r1 = root(); const w1 = await directWorld(r1, { review: { forbiddenPatterns: ['x'] }, queueEdit: ({ directSpecMode: _d, ...row }) => row })
      blocked(runRegister(r1, w1.row.slug), /G8_ROW_NOT_DIRECT/, 'G8 행 opt-in 철회')
    }],
    ['D10 이미 articles 에 있는 slug → 기존대로 BLOCKED', async () => {
      const r0 = root(); const w = await directWorld(r0)
      const line = queueLineOf(r0, w.row.slug)
      realQueueRow(r0, w.row.slug)
      assert.equal(runRegister(r0, w.row.slug, { write: true }).json.verdict, 'READY')
      appendQueueLine(r0, line)
      blocked(runRegister(r0, w.row.slug, { date: '2026-12-30' }), /이미 articles\.ts 에 있다/, '중복 article')
    }],
    ['D11 슬롯 충돌 → 기존대로 BLOCKED', async () => {
      const r0 = root(); const w = await directWorld(r0)
      const taken = read(r0, ARTICLES).match(/publishedAt: '(\d{4}-\d{2}-\d{2})'/)[1]
      blocked(runRegister(r0, w.row.slug, { date: taken }), /슬롯이 이미 차 있다/, '슬롯 충돌')
    }],
    ['D12 큐 중복 행 → 기존대로 BLOCKED', async () => {
      const r0 = root(); const w = await directWorld(r0)
      appendQueueLine(r0, queueLineOf(r0, w.row.slug))
      blocked(runRegister(r0, w.row.slug), /topic-queue\.ts 에 2개 있다/, '큐 중복')
    }],
    ['D13 imageMode=REQUIRED 인데 hero 없음 → 기존대로 BLOCKED', async () => {
      const r0 = root(); const w = await legacyWorld(r0)
      const slug = basename(w.dir)
      editQueueRow(r0, slug, (l) => l.replace('"imageMode":"OPTIONAL"', '"imageMode":"REQUIRED"'))
      rmSync(join(r0, 'public/magazine', slug, 'hero.webp'))
      blocked(runRegister(r0, slug), /imageMode=REQUIRED 인데 hero 가 없다/, 'hero 없음')
    }],
    ['D14 auto-register drive 의 실제 register 호출 → DONE · articles 반영 · DIRECT 등록 영수증 (register 대역 0)', async () => {
      const r0 = realpathSync(root()); const w = await directWorld(r0); realQueueRow(r0, w.row.slug)
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', DRIVE_PROBE, w.row.slug, DATE], { cwd: r0, encoding: 'utf8', env: { ...process.env, HOME: r0 } })
      const line = r.stdout.split('\n').find((l) => l.startsWith('DRIVE '))
      assert.ok(line, `drive 결과가 없다 (rc ${r.status}): ${(r.stderr || r.stdout).slice(-400)}`)
      const out = JSON.parse(line.slice(6))
      assert.deepEqual(out.registerCalls, [join(r0, 'scripts/magazine-register.mjs')], `drive 가 실제 register 를 부르지 않았다: ${JSON.stringify(out.registerCalls)}`)
      assert.equal(out.verdict, 'DONE', JSON.stringify(out.blockedBy))
      assert.equal(read(r0, ARTICLES).split(`'${w.row.slug}': {`).length - 1, 1)
      assert.equal(queueCount(r0, w.row.slug), 0)
      assert.equal(out.receipt, true, 'DIRECT 등록 영수증이 없다')
      assert.equal(existsSync(join(w.dir, 'review.ts')), false)
    }],
  ]
}

/**
 * 🔴 drive 를 임시 루트의 **실제 모듈**로 부른다. register 만은 auto-register 의 실제 spawn 과 같은 모양으로 그 파일을 띄운다.
 *    QA · hero · batch-qa 는 이 검사의 대상이 아니다(각자의 검사가 있다) — 통과로 고정한다. 브라우저 · 전송 0.
 */
const DRIVE_PROBE = `
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
const { drive } = await import(join(process.cwd(), 'scripts/magazine-auto-register.mjs'))
const { ARTICLE_SPEC_REGISTER_LEDGER } = await import(join(process.cwd(), 'scripts/lib/magazine-direct-spec.mjs'))
const [slug, date] = process.argv.slice(1)
const registerCalls = []
const real = (file, args, { json = false } = {}) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: process.cwd(), encoding: 'utf8' })
  const out = { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
  if (json) { try { out.json = JSON.parse(out.stdout) } catch { out.json = null } }
  return out
}
const run = (file, args, opts) => {
  const name = basename(String(file))
  if (name === 'magazine-register.mjs') { registerCalls.push(file); return real(file, args, opts) }
  if (name === 'magazine-md-to-draft.mjs') return real(file, args, opts)
  if (name === 'magazine-batch-qa.mjs') return { code: 0, stdout: '', stderr: '', json: { results: [{ slug, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [] }] } }
  return { code: 0, stdout: '', stderr: '', json: null }
}
const r = drive(slug, { write: true, publishAt: date, autoLane: true }, { run, progress: () => ({ hasDraftMd: true }) })
const receipt = existsSync(join(process.cwd(), 'drafts/magazine', slug, ARTICLE_SPEC_REGISTER_LEDGER))
console.log('DRIVE ' + JSON.stringify({ verdict: r.verdict, blockedBy: r.blockedBy, registerCalls, receipt }))
`

let pass = 0, fail = 0
export async function runCases(cases) {
  for (const [name, fn] of cases) {
    try { await fn(); pass += 1; console.log(`PASS ${name}`) }
    catch (e) { fail += 1; console.log(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`) }
  }
  return { pass, fail }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  await runCases(registerDirectCases())
  console.log(`\nregister DIRECT · legacy 재료 판정: ${pass} pass, ${fail} fail`)
  if (fail) process.exitCode = 1
}
