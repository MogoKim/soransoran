#!/usr/bin/env node
/**
 * M3 공용 계약 모듈 — **편입기와 시험이 같은 함수를 쓴다.**
 *
 * 🔴 앞판의 결함: `writeMapping` 이 임시 jsonl 에 한 줄 쓰고 끝났고,
 *    **그 파일을 builder 가 읽지 않았다.** 시험은 "썼다" 와 "그래프에 들어왔다" 를
 *    각각 따로 확인했을 뿐, 둘이 **이어져 있는지**는 한 번도 보지 않았다.
 *    그래서 E2E 가 통과해도 실제 편입 경로가 끊겨 있을 수 있었다.
 *
 * 🔴 이 판에서는 **상태 정본을 하나로 정한다.**
 *
 *      contract/m3-state.jsonl   (append-only 사건 기록)
 *          ↓  materializeBuildInput()   ← 🔴 builder 입력을 만드는 **유일한 자리**
 *      build 입력 5파일
 *          ↓  build-graph.mjs --in <그 디렉터리>
 *      intents · edges · mappings · manifest
 *
 *    편입기도 시험도 이 함수만 쓴다. 시험이 입력을 손으로 조립하면
 *    "시험만 아는 경로" 가 생기고, 그 경로는 운영에서 돌지 않는다.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveAssetStates } from './m3-product.mjs'

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/**
 * 🔴 **m3-state.jsonl 은 「사건 장부」다. 「상태 정본」이 아니다.**
 *
 *    앞판은 여기에 `assetState: 'LIVE'` 를 적었고, 그래프가 그 한 줄을 믿었다.
 *    **우리가 우리에게 공개됐다고 말한 것**이다 — 제품에 등록도 안 된 글이
 *    그래프에서 공개 글로 취급될 수 있었다.
 *
 *    그래서 장부에는 **상태를 적지 않는다.** 적을 수 있는 것은 사건뿐이다.
 *    QUEUED·SCHEDULED·LIVE 판정은 `m3-product.mjs` 가 제품에서 읽는다.
 */
export const M3_LEDGER_CONTRACT = {
  file: 'contract/m3-state.jsonl',
  schemaVersion: 'm3ledger/2',
  appendOnly: true,
  isStateAuthority: false,
  stateAuthority: 'contract/m3-product.mjs → resolveAssetStates() (제품 queue·articles.ts·isPublicMagazineArticle)',
  /**
   * 🔴 장부가 적을 수 있는 사건. **바로 다음 것만** 올 수 있다.
   *    건너뛰기도 되돌리기도 없다 — 앞판은 `ADMITTED → REGISTERED` 를 허용했고,
   *    같은 사건을 다시 적어 행이 늘어나게 두었다. 그러면 "원고도 안 쓰고 큐에도 안 넣은 글"
   *    이 등록된 것처럼 장부에 남는다.
   */
  events: ['ADMITTED', 'DRAFT_PASSED', 'ENQUEUED', 'REGISTERED', 'PUBLISH_REQUESTED'],
  transitionRule: '🔴 정확히 바로 다음 사건만. 같은 사건은 idempotent(행 추가 없음)',
  forbiddenFields: ['assetState'],
  forbiddenWhy: '🔴 상태를 장부에 적으면 제품과 어긋난 채 그래프를 움직일 수 있다',
  binding: '🔴 intentId ↔ slug 는 영구 1:1. 한 번 정하면 어느 쪽도 바꾸지 않는다',
}
const EVENT_RANK = Object.fromEntries(M3_LEDGER_CONTRACT.events.map((e, i) => [e, i]))
/** 🔴 `validateLedger` 와 `recordProgress` 가 **같은 함수**를 쓴다 — 규칙 사본을 두지 않는다 */
export function nextEvent(from) {
  const i = EVENT_RANK[from]
  return i === undefined ? null : (M3_LEDGER_CONTRACT.events[i + 1] ?? null)
}
export function checkEventStep(from, to) {
  if (!(to in EVENT_RANK)) return { ok: false, why: `모르는 사건이다: ${to}` }
  if (from === undefined || from === null) {
    return to === 'ADMITTED' ? { ok: true, same: false }
      : { ok: false, why: `🔴 ADMITTED 없이 ${to} 가 먼저 올 수 없다` }
  }
  if (from === to) return { ok: true, same: true }
  const want = nextEvent(from)
  if (to !== want) {
    return { ok: false,
      why: EVENT_RANK[to] < EVENT_RANK[from]
        ? `🔴 사건을 되돌릴 수 없다 (${from} → ${to})`
        : `🔴 사건을 건너뛸 수 없다 (${from} 다음은 ${want ?? '없다'} 인데 ${to} 가 왔다)` }
  }
  return { ok: true, same: false }
}

/** brief 재료 — 큐 항목에서 원고 생성에 필요한 것만 뽑는다 */
export function buildBrief(item) {
  if (!item?.intentId) return { ok: false, why: 'intentId 가 없다' }
  if (!item?.slug) return { ok: false, why: 'slug 가 없다' }
  if (!item?.answerScope) return { ok: false, why: 'answerScope 가 없다' }
  if (!Array.isArray(item.exclusions)) return { ok: false, why: 'exclusions 가 배열이 아니다' }
  if (!Array.isArray(item.directRelations)) return { ok: false, why: 'directRelations 가 배열이 아니다' }
  return {
    ok: true,
    brief: {
      intentId: item.intentId,
      slug: item.slug,
      title: item.title,
      question: item.primaryQuery,
      readerSituation: item.audienceSituation,
      mustAnswer: item.answerScope,
      mustNotCover: item.exclusions,
      validationProfile: item.validationProfile,
      /**
       * 🔴 **관계를 brief 까지 가져간다.**
       *    앞판은 `internalLinks` 만 넘겼다. 그러면 원고는 자기가 어디로 이어지는지 모른 채
       *    쓰이고, 발견 카드(`discoveryRelation`)는 아무 데도 도달하지 못한다.
       */
      directRelations: item.directRelations,
      discoveryRelation: item.discoveryRelation ?? null,
      internalLinks: item.internalLinks ?? [],
      communityQuestion: item.communityQuestion,
    },
  }
}

const readJsonl = (f) => fs.existsSync(f)
  ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []

/**
 * 🔴 **장부 무결성 검사.** 스키마 · 순서 · 1:1 결속을 본다.
 *    하나라도 어긋나면 그 장부로는 아무것도 짓지 않는다.
 */
export function validateLedger(rows) {
  const problems = []
  const bySlug = new Map(), byIntent = new Map()
  let i = 0
  for (const r of rows) {
    i++
    const at = `${i}행`
    if (r.schemaVersion !== M3_LEDGER_CONTRACT.schemaVersion) {
      problems.push(`🔴 ${at}: schemaVersion 이 다르다 (${r.schemaVersion})`); continue
    }
    for (const k of ['event', 'intentId', 'slug', 'at']) {
      if (!r[k]) problems.push(`🔴 ${at}: ${k} 가 없다`)
    }
    for (const k of M3_LEDGER_CONTRACT.forbiddenFields) {
      if (k in r) problems.push(`🔴 ${at}: 장부에 ${k} 를 적을 수 없다 — ${M3_LEDGER_CONTRACT.forbiddenWhy}`)
    }
    if (!(r.event in EVENT_RANK)) { problems.push(`🔴 ${at}: 모르는 사건이다 (${r.event})`); continue }
    if (Number.isNaN(new Date(r.at).getTime())) problems.push(`🔴 ${at}: at 이 날짜가 아니다 (${r.at})`)

    // 🔴 intentId ↔ slug 영구 1:1
    const prevIntent = bySlug.get(r.slug)?.intentId
    if (prevIntent && prevIntent !== r.intentId) {
      problems.push(`🔴 ${at}: 같은 slug 에 다른 intent 다 (${r.slug}: ${prevIntent} ≠ ${r.intentId})`)
    }
    const prevSlug = byIntent.get(r.intentId)
    if (prevSlug && prevSlug !== r.slug) {
      problems.push(`🔴 ${at}: 같은 intent 에 다른 slug 다 (${r.intentId}: ${prevSlug} ≠ ${r.slug})`)
    }

    const prev = bySlug.get(r.slug)
    /** 🔴 기록 함수와 **같은 규칙**으로 본다 — 손으로 고친 장부에도 그대로 적용된다 */
    const step = checkEventStep(prev?.event, r.event)
    if (!step.ok) problems.push(`🔴 ${at}: ${step.why} (${r.slug})`)
    else if (step.same) problems.push(`🔴 ${at}: 같은 사건이 두 줄이다 (${r.slug}: ${r.event}) — 재실행은 행을 늘리지 않는다`)
    if (prev && new Date(r.at) < new Date(prev.at)) {
      problems.push(`🔴 ${at}: 시각이 뒤로 간다 (${r.slug}: ${prev.at} → ${r.at})`)
    }
    bySlug.set(r.slug, { ...prev, ...r, event: step.ok && !step.same ? r.event : (prev?.event ?? r.event) })
    byIntent.set(r.intentId, r.slug)
  }
  return { ok: problems.length === 0, problems, bySlug }
}

/** 장부를 읽고 검사한다 — slug 별 최신 사건 */
export function readLedger(stateFile) {
  const rows = readJsonl(stateFile)
  const v = validateLedger(rows)
  return { ...v, rows }
}

/**
 * 🔴 **편입을 장부에 적는다.**
 *    · 같은 편입을 다시 실행해도 장부가 늘지 않는다 (idempotent)
 *    · 같은 slug 에 다른 intent, 같은 intent 에 다른 slug 는 거부한다
 *    · 상태를 적지 않는다 — 상태는 제품이 정한다
 */
export function recordAdmission({ stateFile, item, at = new Date().toISOString() }) {
  for (const k of ['intentId', 'slug']) {
    if (!item?.[k]) return { ok: false, why: `필수 필드 누락: ${k}` }
  }
  const cur = readLedger(stateFile)
  if (!cur.ok) return { ok: false, why: `장부가 이미 깨져 있다: ${cur.problems[0]}` }

  const bySlug = cur.bySlug.get(item.slug)
  if (bySlug && bySlug.intentId !== item.intentId) {
    return { ok: false, why: `🔴 이 slug 는 이미 다른 intent 의 것이다 (${item.slug}: ${bySlug.intentId})` }
  }
  const otherSlug = [...cur.bySlug.values()].find((r) => r.intentId === item.intentId && r.slug !== item.slug)
  if (otherSlug) {
    return { ok: false, why: `🔴 이 intent 는 이미 다른 slug 를 가졌다 (${item.intentId}: ${otherSlug.slug})` }
  }
  if (bySlug) {
    // 🔴 같은 편입을 다시 실행했다. 장부를 늘리지 않는다.
    return { ok: true, file: stateFile, appended: false, idempotent: true,
      row: cur.rows.find((r) => r.slug === item.slug && r.event === 'ADMITTED') }
  }

  /**
   * 🔴 **관계를 빠짐없이 적는다.**
   *    `directRelations` 최대 3 · `discoveryRelation` 1. 하나라도 빠지면
   *    화면이 약속한 칸을 채우지 못하고, 발견 카드는 아예 사라진다.
   */
  /** 🔴 관계에 슬롯이 없으면 받지 않는다 — 기본값을 채워 넣으면 누락이 조용히 지나간다 */
  const relAll = [...(item.directRelations ?? []), ...(item.discoveryRelation ? [item.discoveryRelation] : [])]
  const noSlot = relAll.filter((r) => !r?.slot)
  if (noSlot.length) {
    return { ok: false, why: `🔴 슬롯 없는 관계가 ${noSlot.length}건이다 (${item.intentId}) — 어느 칸에 놓을지 모르는 관계는 받지 않는다` }
  }

  const row = {
    schemaVersion: M3_LEDGER_CONTRACT.schemaVersion,
    event: 'ADMITTED',
    intentId: item.intentId,
    slug: item.slug,
    title: item.title ?? null,
    cluster: item.cluster ?? null,
    directRelations: (item.directRelations ?? []).map((r) => ({
      slot: r.slot, toIntentId: r.toIntentId, anchorLabel: r.anchorLabel, readerReason: r.readerReason,
    })),
    discoveryRelation: item.discoveryRelation
      ? { slot: item.discoveryRelation.slot, toIntentId: item.discoveryRelation.toIntentId,
          anchorLabel: item.discoveryRelation.anchorLabel, readerReason: item.discoveryRelation.readerReason }
      : null,
    internalLinks: item.internalLinks ?? [],
    at,
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.appendFileSync(stateFile, `${JSON.stringify(row)}\n`)
  return { ok: true, file: stateFile, appended: true, idempotent: false, row }
}

/** 🔴 진행 사건을 적는다. **상태 선언이 아니다** — 무엇을 했는지만 적는다 */
export function recordProgress({ stateFile, slug, event, at = new Date().toISOString() }) {
  if (event === 'ADMITTED') return { ok: false, why: '편입은 recordAdmission 이 적는다' }
  const cur = readLedger(stateFile)
  if (!cur.ok) return { ok: false, why: `장부가 깨져 있다: ${cur.problems[0]}` }
  const prev = cur.bySlug.get(slug)
  if (!prev) return { ok: false, why: `편입 기록이 없는 slug 다: ${slug}` }
  const step = checkEventStep(prev.event, event)
  if (!step.ok) return { ok: false, why: step.why, from: prev.event }
  if (step.same) {
    // 🔴 같은 사건을 다시 실행했다. 행을 늘리지 않는다.
    return { ok: true, from: prev.event, to: event, appended: false, idempotent: true }
  }
  const row = { schemaVersion: M3_LEDGER_CONTRACT.schemaVersion, event,
    intentId: prev.intentId, slug, at }
  fs.appendFileSync(stateFile, `${JSON.stringify(row)}\n`)
  return { ok: true, from: prev.event, to: event, appended: true, idempotent: false }
}

const BASE_FILES = ['g4-intents-canonical.jsonl', 'g4-automation-2026-09-23.jsonl',
  'g5-graph-2026-09-23.jsonl', 'assets-published.jsonl', 'assets-queue.jsonl']

/** 슬롯 → 관계 유형. 🔴 graph-contract.ts 의 RELATION_TO_SLOT 을 뒤집은 것이다 */
const SLOT_TO_RELATION = {
  DIRECT_NEXT: ['NEXT_QUESTION'],
  SAME_EXPERIENCE: ['SIBLING'],
  ACTION_OR_CONTEXT: ['ACTION', 'PREREQUISITE', 'SERIES'],
  BRIDGE_DISCOVERY: ['BRIDGE'],
}

/**
 * 🔴 **builder 입력을 만드는 유일한 자리.**
 *
 *    장부(누구의 어떤 slug 인가) + **제품 readback**(지금 실제로 어떤 상태인가)
 *    → build-graph 가 읽는 5파일.
 *
 * 🔴 **장부의 말로 LIVE 를 만들지 않는다.** `resolveAssetStates` 가 제품에서 읽은
 *    상태만 쓴다. 제품에 없으면 `NOT_IN_PRODUCT` 이고, 그 slug 는 어느 자산 파일에도
 *    들어가지 않는다 — 그래프는 그런 글을 모른다.
 */
export function materializeBuildInput({ stateFile, srcRoot = HERE, outDir, product, nowIso }) {
  const led = readLedger(stateFile)
  if (!led.ok) return { ok: false, outDir, applied: [], problems: led.problems }

  const resolved = resolveAssetStates({ ledger: led.bySlug, product, nowIso })
  if (!resolved.ok) {
    return { ok: false, outDir, applied: [], problems: [`🔴 제품 readback 실패 — ${resolved.why}`] }
  }

  const base = Object.fromEntries(BASE_FILES.map((f) => [f, readJsonl(path.join(srcRoot, f))]))
  const intents = base['g4-intents-canonical.jsonl'].map((x) => ({ ...x }))
  const edges = base['g5-graph-2026-09-23.jsonl']
  const published = [...base['assets-published.jsonl']]
  const queued = [...base['assets-queue.jsonl']]
  const byIntent = Object.fromEntries(intents.map((x) => [x.intentId, x]))

  const applied = []
  const problems = []
  for (const [slug, st] of resolved.states) {
    const led2 = led.bySlug.get(slug)
    const intent = byIntent[st.intentId]
    if (!intent) { problems.push(`🔴 장부의 intent 가 원자료에 없다: ${st.intentId}`); continue }

    if (st.assetState === 'NOT_IN_PRODUCT') {
      // 🔴 제품이 모르는 글이다. 그래프에도 넣지 않는다.
      applied.push({ slug, intentId: st.intentId, assetState: st.assetState, why: st.why, injected: false })
      continue
    }

    if (!(intent.existingSlugs ?? []).some((s) => s.slug === slug)) {
      intent.existingSlugs = [...(intent.existingSlugs ?? []), {
        slug, cluster: led2?.cluster ?? null, coverage: 'PRIMARY',
        publishedAt: st.assetState === 'LIVE' ? (nowIso ?? '').slice(0, 10) : null,
      }]
    }
    if (st.assetState === 'QUEUED') {
      queued.push({ day: 999, slug, title: led2?.title ?? slug, state: 'QUEUE', source: 'product-readback' })
    } else {
      published.push({ slug, title: led2?.title ?? slug, cluster: led2?.cluster ?? null,
        assetState: st.assetState,
        publishedAt: st.assetState === 'LIVE' ? (nowIso ?? '').slice(0, 10) : null,
        publishAt: st.assetState === 'LIVE' ? null : (nowIso ?? '').slice(0, 10),
        source: 'product-readback' })
    }

    /** 🔴 약속한 관계가 설계 파일에 실제로 있는가 — 발견 관계도 같이 본다 */
    const promised = [...(led2?.directRelations ?? []),
      ...(led2?.discoveryRelation ? [led2.discoveryRelation] : [])]
    for (const r of promised) {
      const want = SLOT_TO_RELATION[r.slot]
      if (!want) { problems.push(`🔴 모르는 슬롯이다: ${slug} ${r.slot}`); continue }
      const hit = edges.some((e) => e.fromIntentId === st.intentId
        && e.toIntentId === r.toIntentId && want.includes(e.relationType))
      if (!hit) problems.push(`🔴 약속한 관계가 설계 파일에 없다: ${st.intentId} --${r.slot}--> ${r.toIntentId}`)
    }

    applied.push({ slug, intentId: st.intentId, assetState: st.assetState, why: st.why, injected: true,
      relationsChecked: promised.length,
      directRelations: (led2?.directRelations ?? []).length,
      discoveryRelation: led2?.discoveryRelation ? 1 : 0 })
  }

  fs.mkdirSync(outDir, { recursive: true })
  const out = {
    'g4-intents-canonical.jsonl': intents,
    'g4-automation-2026-09-23.jsonl': base['g4-automation-2026-09-23.jsonl'],
    'g5-graph-2026-09-23.jsonl': edges,
    'assets-published.jsonl': published,
    'assets-queue.jsonl': queued,
  }
  for (const [f, rows] of Object.entries(out)) {
    fs.writeFileSync(path.join(outDir, f), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
  }
  return { ok: problems.length === 0, outDir, applied, problems, readback: resolved.readback, files: Object.keys(out) }
}

/**
 * 🔴 **원자적 manifest 저장.**
 *    임시 파일에 쓰고 → rename → 다시 읽어 → hash 대조.
 *    중간에 죽어도 반쪽 파일이 남지 않고, 썼다고 말한 것이 실제로 읽히는지 확인한다.
 */
export function writeManifestAtomic(file, slugs, asOf) {
  const payload = {
    _note: '🔴 intentId ↔ slug 영구 대응. 한 번 정하면 바꾸지 않는다 — slug 는 독자가 보는 주소다',
    asOf,
    slugs,
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const hash = crypto.createHash('sha256').update(text).digest('hex')
  const tmp = `${file}.tmp-${process.pid}`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)                       // 🔴 원자적 교체
    const back = fs.readFileSync(file, 'utf8')     // 🔴 readback
    const backHash = crypto.createHash('sha256').update(back).digest('hex')
    if (backHash !== hash) {
      return { ok: false, why: `🔴 써 넣은 내용과 읽은 내용이 다르다 (${hash.slice(0, 8)} ≠ ${backHash.slice(0, 8)})` }
    }
    const parsed = JSON.parse(back)
    const keys = Object.keys(parsed.slugs ?? {})
    if (keys.length !== Object.keys(slugs).length) {
      return { ok: false, why: '🔴 읽어 온 slug 수가 다르다' }
    }
    return { ok: true, hash, count: keys.length }
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* 무시 */ }
    return { ok: false, why: `manifest 저장 실패: ${e.message}` }
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* 무시 */ }
  }
}
