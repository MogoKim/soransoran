#!/usr/bin/env node
/**
 * 제품 **readback** — 자산 상태를 우리 장부가 아니라 **제품에서 읽는다.**
 *
 * 🔴 앞판의 결함: `m3-state.jsonl` 에 `assetState: 'LIVE'` 한 줄을 적으면
 *    그래프가 그 글을 공개 글로 취급했다. **우리가 우리에게 공개됐다고 말한 것**이다.
 *    실제로는 `articles.ts` 에 등록도 안 됐고 공개 시각도 지나지 않았을 수 있다.
 *    그 상태로 edge 를 활성화하면 **미공개 누출**이 된다.
 *
 * 🔴 그래서 상태는 여기서 정한다.
 *      ① `drafts/magazine/topic-queue.ts` 에 있나        → QUEUED
 *      ② `src/content/magazine/articles.ts` 에 등록됐나  → 등록 자산
 *      ③ 제품의 `isPublicMagazineArticle()` 이 참인가    → LIVE
 *         ②이면서 ③이 거짓이면                          → SCHEDULED_NOT_YET_PUBLIC
 *      ④ 어디에도 없으면                                → NOT_IN_PRODUCT (LIVE 로 만들지 않는다)
 *
 * 🔴 ③ 은 **제품 함수를 실제로 실행해** 얻는다. 여기서 공개 규칙을 다시 구현하면
 *    사본이 둘이 되고, 제품이 규칙을 바꾼 날 사본은 그대로 남는다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const PRODUCT_READBACK_CONTRACT = {
  states: ['QUEUED', 'SCHEDULED_NOT_YET_PUBLIC', 'LIVE', 'NOT_IN_PRODUCT'],
  liveRequires: 'articles.ts 등록 + 제품 isPublicMagazineArticle() === true',
  neverFromLedger: '🔴 장부 한 줄로 LIVE 를 만들지 않는다',
  visibilityFn: 'src/lib/magazine.ts → isPublicMagazineArticle',
  queueSource: 'drafts/magazine/topic-queue.ts → TOPIC_QUEUE (모듈 평가)',
  noRegex: '🔴 큐·등록 목록을 정규식으로 읽지 않는다 — 표기가 바뀌면 조용히 빈 집합이 된다',
  readFailure: '🔴 읽기 실패는 추정하지 않고 fail-closed 한다',
}

/**
 * 🔴 **큐도 정규식으로 읽지 않는다.**
 *    앞판은 `/slug: '…'/` 로 훑었다. 따옴표가 바뀌거나(`"..."`, 백틱),
 *    값이 변수로 빠지거나(`slug: S`), 줄바꿈이 끼거나, 배열을 spread 하면
 *    한 건도 못 읽고 **조용히 빈 집합**을 돌려준다 — 그러면 "큐에 없다" 가 되고
 *    상태 판정이 통째로 틀린다. 실제로 그렇게 틀렸다.
 *
 *    제품의 `TOPIC_QUEUE` 모듈을 **실제로 평가해** 읽는다.
 *    읽지 못하면 **QUEUED 로 추정하지 않고 실패**한다.
 */
export function probeQueue({ productRoot, queueModule }) {
  if (!fs.existsSync(queueModule)) {
    return { ok: false, why: `🔴 큐 모듈이 없다: ${queueModule}` }
  }
  const probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm3-qprobe-')), 'probe.mts')
  fs.writeFileSync(probe, [
    `import { TOPIC_QUEUE } from ${JSON.stringify(queueModule)}`,
    'if (!Array.isArray(TOPIC_QUEUE)) { throw new Error("TOPIC_QUEUE 가 배열이 아니다") }',
    'console.log(JSON.stringify({ slugs: TOPIC_QUEUE.map((q: { slug: string }) => q.slug).filter(Boolean) }))',
  ].join('\n'))
  const r = spawnSync('npx', ['tsx', probe], { cwd: productRoot, encoding: 'utf8', maxBuffer: 1e8 })
  try { fs.rmSync(path.dirname(probe), { recursive: true, force: true }) } catch { /* 무시 */ }
  if (r.status !== 0) {
    return { ok: false, why: `🔴 큐 모듈 실행 실패 (${r.status}): ${String(r.stderr ?? '').slice(-300)}` }
  }
  try {
    const parsed = JSON.parse(String(r.stdout).trim().split('\n').at(-1))
    return { ok: true, slugs: parsed.slugs, module: queueModule }
  } catch (e) { return { ok: false, why: `🔴 큐 응답을 읽지 못했다: ${e.message}` } }
}

/**
 * 🔴 **등록 여부도 정규식으로 읽지 않는다.**
 *    앞판은 `articles.ts` 를 정규식으로 훑어 key 를 셌다. 그러면 파일 모양이 조금만
 *    달라져도 "등록 안 됨" 으로 잘못 읽는다 — 실제로 그렇게 잘못 읽었다.
 *    등록 목록은 `probeVisibility` 가 **모듈을 평가해** 돌려주는 `allSlugs` 를 쓴다.
 */

/**
 * 🔴 **제품의 공개 판정 함수를 실제로 실행한다.**
 *
 * @param {{productRoot:string, articlesModule:string, nowIso:string}} p
 * @returns {{ok:boolean, why?:string, publicSlugs?:string[], allSlugs?:string[], fn?:string}}
 */
export function probeVisibility({ productRoot, articlesModule, nowIso }) {
  const magazineLib = path.join(productRoot, 'src/lib/magazine.ts')
  if (!fs.existsSync(magazineLib)) {
    return { ok: false, why: `🔴 제품의 공개 판정 파일이 없다: ${magazineLib}` }
  }
  const probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm3-probe-')), 'probe.mts')
  fs.writeFileSync(probe, [
    `import { isPublicMagazineArticle } from ${JSON.stringify(magazineLib)}`,
    `import { MAGAZINE_ARTICLES } from ${JSON.stringify(articlesModule)}`,
    `const now = new Date(${JSON.stringify(nowIso)}).getTime()`,
    'const all = MAGAZINE_ARTICLES.map((a: { slug: string }) => a.slug)',
    'const pub = MAGAZINE_ARTICLES.filter((a: never) => isPublicMagazineArticle(a, now)).map((a: { slug: string }) => a.slug)',
    'console.log(JSON.stringify({ all, pub }))',
  ].join('\n'))
  // 🔴 stderr 를 버리지 않는다 — 실패를 성공으로 읽지 않기 위해
  const r = spawnSync('npx', ['tsx', probe], { cwd: productRoot, encoding: 'utf8', maxBuffer: 1e8 })
  try { fs.rmSync(path.dirname(probe), { recursive: true, force: true }) } catch { /* 무시 */ }
  if (r.status !== 0) {
    return { ok: false, why: `🔴 제품 공개 함수 실행 실패 (${r.status}): ${String(r.stderr ?? '').slice(-300)}` }
  }
  let parsed
  try { parsed = JSON.parse(String(r.stdout).trim().split('\n').at(-1)) }
  catch (e) { return { ok: false, why: `🔴 제품 응답을 읽지 못했다: ${e.message}` } }
  return { ok: true, fn: `${magazineLib} → isPublicMagazineArticle`,
    allSlugs: parsed.all, publicSlugs: parsed.pub }
}

/**
 * 🔴 **자산 상태를 제품에서 정한다.** 장부는 "어떤 intent 의 어떤 slug 인가" 만 준다.
 *
 * @param {{ledger:Map, product:{queueFile:string, articlesFile:string, productRoot:string, articlesModule:string}, nowIso:string}} p
 */
export function resolveAssetStates({ ledger, product, nowIso }) {
  const q = probeQueue({ productRoot: product.productRoot,
    queueModule: product.queueModule ?? product.queueFile })
  if (!q.ok) {
    // 🔴 큐를 읽지 못했으면 **QUEUED 로 추정하지 않는다.** 모르면 막는다.
    return { ok: false, why: q.why, states: new Map(), readback: q }
  }
  const queued = new Set(q.slugs)
  const vis = probeVisibility({ productRoot: product.productRoot,
    articlesModule: product.articlesModule ?? product.articlesFile, nowIso })
  if (!vis.ok) {
    // 🔴 제품을 읽지 못했으면 **아무것도 공개로 보지 않는다.** 모르면 막는다.
    return { ok: false, why: vis.why, states: new Map(), readback: vis }
  }
  const registered = new Set(vis.allSlugs ?? [])
  const publicSet = new Set(vis.publicSlugs ?? [])
  const states = new Map()
  for (const [slug, row] of ledger) {
    let state
    if (registered.has(slug) && publicSet.has(slug)) state = 'LIVE'
    else if (registered.has(slug)) state = 'SCHEDULED_NOT_YET_PUBLIC'
    else if (queued.has(slug)) state = 'QUEUED'
    else state = 'NOT_IN_PRODUCT'
    states.set(slug, {
      intentId: row.intentId, slug, assetState: state,
      inQueue: queued.has(slug), inArticles: registered.has(slug), isPublic: publicSet.has(slug),
      why: `queue=${queued.has(slug)} · articles=${registered.has(slug)} · public=${publicSet.has(slug)}`,
    })
  }
  return { ok: true, states,
    readback: { fn: vis.fn, queueModule: q.module, registered: registered.size,
      public: publicSet.size, queued: queued.size } }
}
