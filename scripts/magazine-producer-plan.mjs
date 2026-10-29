#!/usr/bin/env node
/**
 * 매거진 producer — 준비 단계
 *
 * 01:00 KST 에 무인으로 돌며 "오늘 무엇을 만들지" 를 정하고,
 * 세션이 이어받을 **작업 패키지**를 _runs 아래에 놓는다.
 *
 * 🔴 이 스크립트가 하지 않는 것 (전략 §13.1 역할 분리 · §13.5 안전장치)
 *    원고를 쓰지 않는다 · LLM/AI API 를 호출하지 않는다 · 네트워크를 쓰지 않는다
 *    ChatGPT·MCP Playwright 를 실행하지 않는다 · hero 를 만들지 않는다
 *    articles.ts · topic-queue.ts 를 수정하지 않는다 (읽기만)
 *    commit·push·공개를 하지 않는다
 *
 * 🔴 정본 파일을 만들지 않는다
 *    drafts/magazine/{slug}/brief.md · review.ts 는 **만들지 않는다.**
 *    빈 summary/riskSentences 가 든 review.ts 가 정본 자리에 놓이면
 *    packet 생성기와 QA 가 그것을 완성본으로 취급한다.
 *    대신 _runs/{date}/selected/{slug}/*.todo.md 에 초안 재료만 놓는다.
 *    정본은 세션이 TODO 를 채운 뒤에 만든다.
 *
 * 🔴 예외는 하나 — DIRECT_SPEC_V1 행 (2026-10-15).
 *    승인 source(`magazine-direct-spec-source.mjs`)가 현재 제품 graphVersion 과 정확히 맞을 때만
 *    결정적으로 컴파일한 `drafts/magazine/{slug}/article-spec.json` 을 덮어쓰지 않고 쓴다.
 *    source 가 없거나 낡았으면 그 행은 선정에서 빠지고 run.json `held` 에 구조화 사유가 남는다.
 *    direct 행에는 todo 재료를 놓지 않는다 — legacy brief 생성기가 그 폴더를 대상으로 읽기 때문이다.
 *
 * 🔴 HIGH 도 초안까지는 만든다 (전략 §5.1)
 *    🔴 M3-A — 등급은 검증 강도다. 만들지 않는 주제도, 사람이 읽는 주제도 없다.
 *    초안을 만들지 않으면 검수할 것이 없어 큐가 그 자리에서 멈춘다.
 *    🔴 M3-A 이후 레인은 **하나다.** 등급으로 가르지 않는다 —
 *    `validationProfile` 을 정할 수 있는 주제가 produceCount 만큼 들어온다.
 *    등록 판정은 magazine-register.mjs 가, 자동 승인 판정은 magazine-batch-qa.mjs 가
 *    프로필별 결정론적 규칙으로 한다.
 *
 *    🔴 사람이 보는 중간 게이트는 없앴다 (M3-A). 프로필 검사가 FAIL 이면 그 slug 만
 *       최대 2회 자동 재생성하고, 계속 실패하면 그 slug 만 HOLD 된다.
 *
 * 사용법
 *   node scripts/magazine-producer-plan.mjs              실행 (파일 생성)
 *   node scripts/magazine-producer-plan.mjs --dry-run    선정만 하고 아무것도 쓰지 않는다
 *   node scripts/magazine-producer-plan.mjs --json       run.json 을 stdout 으로
 *   node scripts/magazine-producer-plan.mjs --now <ISO>  기준 시각 고정 (테스트용)
 *   node scripts/magazine-producer-plan.mjs --help
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadArticles, loadQueue, DRAFTS_DIR } from './lib/magazine-load.mjs'
import {
  RUN_SCHEMA_VERSION, classifyExistingRun, writeFileAtomic, preserveRunFiles, acquireRunLock,
} from './lib/magazine-run-file.mjs'
import { materialState } from './lib/magazine-run-targets.mjs'
import { acquireManuscriptLease, readQuarantine, QUARANTINE_PATH } from './lib/magazine-quarantine.mjs'
import { deliveryGate } from './lib/magazine-delivery-gate.mjs'
import { heroFilePath } from './lib/magazine-hero.mjs'
import { calculateInventory } from './magazine-inventory.mjs'
import { MEDICAL_REQUIRED, MEDICAL_SUGGESTED } from './magazine-qa.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { DIRECT_SPEC_MODE, resolveMagazineAutoMode } from './lib/magazine-direct-spec.mjs'
import { ctaRepairPendingState } from './lib/magazine-draft-cta-repair.mjs'
import {
  DIRECT_SPEC_SUPERSEDE_REQUIRED, persistDirectSpecNoClobber, readProductGraphVersion, recoverSupersession, supersedeDirectSpec, supersedeLeftovers,
  verifyDirectSpecIdentity,
} from './lib/magazine-direct-spec-source.mjs'

const RUNS_DIR = join(DRAFTS_DIR, '_runs')
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT_GRAPH_CURRENT = join(REPO_ROOT, 'src/content/magazine/graph/current.ts')

// 재고 정책 — 운영 전략서 §5. inventory 와 같은 값을 쓴다.
const TARGET_DAYS = 14
const MIN_DAYS = 7

/** 하루 최대 5건. 몰아 만들면 검수도 QA 도 감당이 안 된다. */
function produceCountFor(inventoryDays) {
  if (inventoryDays >= TARGET_DAYS) return 0
  if (inventoryDays >= MIN_DAYS) return 3
  return 5
}

/**
 * HIGH 는 하루 1건까지만 만든다.
 *
 * 🔴 (역사 · SUPERSEDED) 이 값은 사람이 본문 전문을 읽던 시절의 상한이었다.
 *    M3-A 로 사람이 읽는 단계가 없어져 상한의 근거도 사라졌다.
 *
 * 지금 이 값이 하는 일은 하나다 — 재고가 목표(14일) 이상이면 0 이다.
 * 만들 이유가 없을 때 대기만 쌓으면 그것도 병목이다.
 */
function reviewCountFor(produceCount) {
  return produceCount > 0 ? 1 : 0
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
function kstDate(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

// ── 선정 ───────────────────────────────────────────────────

/**
 * 오늘 만들 항목을 고른다.
 * 제외 사유를 전건 기록한다 — "producer 가 일을 안 한다" 와 "뽑을 게 없다" 는 다르다.
 *
 * 🔴 레인이 둘이다.
 *
 *    auto    validationProfile 을 정할 수 있는 주제. produceCount 만큼 뽑는다.
 *    🔴 review 레인은 없다 (M3-A · SUPERSEDED). reviewCount 는 호환 인자다.
 *
 *    HIGH 를 auto 레인에 섞지 않는 이유는 예산 때문이다. 큐 정렬이 day 순이라
 *    HIGH 가 앞자리(day 10·18·22)를 차지하면 produceCount 를 다 먹고
 *    뒤 후보가 밀려난다 — 고치려던 병목이 옆으로 옮겨갈 뿐이다.
 *    🔴 M3-A 이후 레인은 하나다 (검수 레인 SUPERSEDED).
 *
 * 🔴 HIGH 를 skip 하지 않는 이유 (전략 §5.1)
 *    🔴 M3-A — 등급은 검증 강도다. 만들지 않는 주제도, 사람이 읽는 주제도 없다.
 *    초안을 만들지 않으면 읽을 것이 없어 큐가 그 자리에서 영구히 막힌다.
 *    지금 자동화된 것은 **초안까지**이고, 등록은 magazine-register.mjs 의
 *    🔴 M3-A 이후 등급은 막지 않는다. 막는 것은 결정론적 QA 실패뿐이며, 그것도
 *    붙기 전까지의 임시 위치다 — 제작 전략 §13.7.
 */
export function selectItems({ queue, articles, today, produceCount, reviewCount = 0, draftExists }) {
  const skipped = []
  const skip = (item, reason) => skipped.push({ day: item.day, slug: item.slug, reason })

  // 중복 판정은 상태를 가리지 않는다 — SCHEDULED·BLOCKED 도 이미 쓴 slug 다
  const takenSlugs = new Set(articles.map((a) => a.slug))

  // 시리즈별 다음 order. articles.ts 에 있는 최대 order 다음이 후보다.
  const seriesMax = new Map()
  for (const a of articles) {
    if (!a.seriesId || a.seriesOrder === undefined) continue
    seriesMax.set(a.seriesId, Math.max(seriesMax.get(a.seriesId) ?? 0, a.seriesOrder))
  }

  const eligible = []
  /** 🔴 새로 만들 필요는 없지만 **내보낼 수 있는** 후보 */
  const reusable = []
  for (const item of queue) {
    // 🔴 등급으로 레인을 가르지 않는다. 프로필을 정할 수 있으면 자동 레인이다.
    /**
     * 🔴 **riskLevel·autoEligible 로 주제를 버리지 않는다.**
     *    등급은 검증 강도이지 발행 차단이 아니다 (M3-A).
     *    못 고르는 유일한 이유는 **프로필을 정할 근거가 없을 때**다.
     */
    const lane = isAutoLaneEligible(item)
    const needsFullReview = false   // 🔴 호환 필드 — 더 이상 레인을 가르지 않는다
    if (!lane.ok) {
      skip(item, `${lane.code} — ${lane.why}`)
      continue
    }
    if (takenSlugs.has(item.slug)) {
      skip(item, '이미 articles.ts 에 있다 (공개·예약·차단 포함)')
      continue
    }
    if (draftExists(item.slug)) {
      /**
       * 🔴 **"만들 필요 없음" 과 "후보 아님" 은 다르다** (2026-09-28 공급 0건).
       *
       *    앞판은 draft 폴더가 있으면 `skipped` 로 버렸다. 그런데 그 폴더에는
       *    **이미 만들어 둔 brief·review·draft** 가 들어 있다 — 공급할 재료가 있는데
       *    "후보가 없다" 고 보고한 것이다. 그날 25건 중 대부분이 이 사유로 빠져
       *    selected 0 · 재고 0 이 됐고, producer 는 실패로 끝났다.
       *
       *    이제 **재사용 후보**로 따로 모아 handoff 에 실어 보낸다.
       *    새로 만들 것이 없다는 뜻이지, 내보낼 것이 없다는 뜻이 아니다.
       */
      reusable.push({ ...item, validationProfile: lane.profile, why: '재료가 이미 있다 — 새로 만들 필요 없음' })
      skip(item, 'drafts/magazine/' + item.slug + ' 가 이미 있다 (재사용 후보)')
      continue
    }
    if (item.publishWindow) {
      const { after, before } = item.publishWindow
      if (today < after) { skip(item, 'publishWindow 이전 (after ' + after + ')'); continue }
      if (today > before) { skip(item, 'publishWindow 경과 (before ' + before + ') — 철 지난 주제'); continue }
    }
    if (item.seriesId) {
      const next = (seriesMax.get(item.seriesId) ?? 0) + 1
      if (item.seriesOrder !== next) {
        skip(item, item.seriesId + ' 다음 회차는 ' + next + ' 인데 이 항목은 ' + item.seriesOrder)
        continue
      }
    }
    // 🔴 프로필이 정해진 주제는 전부 자동 레인으로 간다
    eligible.push({ ...item, validationProfile: lane.profile })
  }

  // 정렬 — SEASONAL 은 마감이 가까운 순. day 는 큐 고유번호일 뿐 우선순위가 아니다.
  const daysLeft = (i) =>
    i.publishWindow
      ? Math.round((new Date(i.publishWindow.before + 'T00:00:00+09:00') - new Date(today + 'T00:00:00+09:00')) / 86400000)
      : Number.POSITIVE_INFINITY
  const byUrgency = (a, b) => {
    const sa = a.contentType === 'SEASONAL' ? 0 : 1
    const sb = b.contentType === 'SEASONAL' ? 0 : 1
    if (sa !== sb) return sa - sb
    if (sa === 0) {
      const d = daysLeft(a) - daysLeft(b)
      if (d !== 0) return d
    }
    return a.day - b.day
  }
  eligible.sort(byUrgency)

  // 같은 시리즈는 하루 1건. 5편을 3편보다 먼저 만들면 시리즈가 깨진다.
  const selected = []
  const seriesUsed = new Set()
  for (const item of eligible) {
    if (selected.length >= produceCount) {
      skip(item, '오늘 생산 ' + produceCount + '건 초과')
      continue
    }
    if (item.seriesId && seriesUsed.has(item.seriesId)) {
      skip(item, item.seriesId + ' 는 오늘 이미 1건 선정됐다')
      continue
    }
    if (item.seriesId) seriesUsed.add(item.seriesId)
    selected.push(item)
  }

  /**
   * 🔴 **검수 레인을 없앴다** (M3-A · SUPERSEDED).
   *    등급으로 주제를 가르지 않으므로 `reviewEligible` 에 아무것도 들어오지 않았고,
   *    이 블록은 빈 배열을 도는 죽은 코드였다. 호출부 호환을 위해 `review: []` 만 남긴다.
   */
  return { selected, review: [], skipped, reusable }
}

export const QUEUE_IDENTITY_DUPLICATE = 'QUEUE_IDENTITY_DUPLICATE'

/**
 * 🔴 **큐 신원 중복 관문 — producer 공용** (2026-10-22 · PR C).
 *    같은 slug 또는 같은 non-empty intentId 가 큐 **전체**에서 2번 이상 나오면, 그 값을 가진 행을 첫 행까지 **전부** HOLD 한다.
 *    선정 범위 · day · publishWindow · produceCount 와 무관하게 전체 큐로 본다 — 한 글을 두 경로(DIRECT·LEGACY)나 두 행이
 *    동시에 만드는 것을 등록 gate 까지 미루지 않는다. 사람이 큐를 고치기 전 자동 재시도 · legacy 강등은 없다.
 *    HOLD 는 신원 순서로 정렬한다 — 큐 입력 순서에 따라 결과가 달라지지 않는다.
 * @returns {{ unique: object[], held: object[] }} unique = 신원이 고유한 행(큐 순서 유지)
 */
export function splitQueueIdentityDuplicates(queue) {
  const key = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  const count = (field) => {
    const m = new Map()
    for (const item of queue) { const k = key(item?.[field]); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const slugs = count('slug')
  const intents = count('intentId')
  const duplicated = (item) => (slugs.get(key(item?.slug)) ?? 0) > 1 || (intents.get(key(item?.intentId)) ?? 0) > 1
  const held = queue.filter(duplicated).map((item) => ({
    day: item.day, slug: item.slug ?? null, intentId: item.intentId ?? null, code: QUEUE_IDENTITY_DUPLICATE,
    why: `큐 신원 중복 — slug ${item.slug} ×${slugs.get(key(item.slug)) ?? 0}${key(item.intentId) ? ` · intentId ${item.intentId} ×${intents.get(key(item.intentId))}` : ''}. 사람이 topic-queue 를 고치기 전 선정 · 생산 0`,
  })).sort((x, y) => String(x.slug).localeCompare(String(y.slug)) || String(x.intentId).localeCompare(String(y.intentId)) || (x.day ?? 0) - (y.day ?? 0))
  return { unique: queue.filter((item) => !duplicated(item)), held }
}

/**
 * 🔴 **DIRECT_SPEC_V1 행은 승인 source 가 준비됐을 때만 선정에 남는다** (2026-10-15 상류 관문).
 *
 *    opt-in 행이 source 없이 선정되면 legacy brief 생성기가 그 행에도 Claude 를 불렀고,
 *    하류는 spec 이 없어 멈췄다 — 두 경로가 한 회차에 섞인다.
 *    이제 선정된 direct 행마다 `judgeDirectSpecSource` 로 판정하고, 준비되지 않은 행은
 *    slug HOLD 로 빼낸 뒤 **그 행을 뺀 큐로 다시 선정한다** — legacy 후보가 그 자리를 잃지 않는다.
 *    모르는 directSpecMode 도 같은 방식으로 뺀다 (legacy brief 로 묻어 보내지 않는다).
 *
 *    🔴 legacy 만 선정되면 판정 함수를 한 번도 부르지 않는다 — 제품 graph 도 source 도 읽지 않는다.
 */
export function selectWithDirectGate({ queue, articles, today, produceCount, reviewCount, draftExists, judgeDirect }) {
  // 🔴 가장 앞 — 신원 중복 행은 선정 · 재사용 · DIRECT 판정 · spec · TODO · 회수의 후보가 되지 않는다
  const identity = splitQueueIdentityDuplicates(queue)
  let pool = identity.unique
  let pass = selectItems({ queue: pool, articles, today, produceCount, reviewCount, draftExists })
  const held = []
  const ready = new Map()
  for (;;) {
    const drop = []
    for (const item of pass.selected) {
      const mode = resolveMagazineAutoMode(item)
      if (!mode.ok) { drop.push({ day: item.day, slug: item.slug, code: mode.code, why: mode.why }); continue }
      if (mode.mode !== DIRECT_SPEC_MODE || ready.has(item.slug)) continue
      const j = judgeDirect(item)
      if (j.ok) ready.set(item.slug, j)
      else drop.push({ day: item.day, slug: item.slug, code: j.code, why: j.why, directSpec: j.evidence })
    }
    if (!drop.length) break
    held.push(...drop)
    const gone = new Set(drop.map((d) => d.slug))
    pool = pool.filter((item) => !gone.has(item.slug))
    pass = selectItems({ queue: pool, articles, today, produceCount, reviewCount, draftExists })
  }
  return { ...pass, directHeld: held, directReady: ready, identityHeld: identity.held, uniqueQueue: identity.unique }
}

/** run.json selected 행에 남기는 direct 신원 — 원문 없이 식별자·해시만 */
function directSpecRow(j, persisted) {
  const s = j.spec
  return {
    mode: s.mode,
    slug: s.identity.slug,
    intentId: s.identity.intentId,
    graphVersion: s.identity.graphVersion,
    sourcePath: j.evidence.sourcePath,
    sourceHash: j.evidence.sourceHash,
    g8ManifestHash: s.identity.admissionManifestHash,
    schemaVersion: s.schemaVersion,
    specHash: s.specHash,
    written: Boolean(persisted?.written),
    // 🔴 명시적 개정으로 옛 spec 을 교체했으면 old/new specHash · 보존 파일을 남긴다 (교체 없으면 키 없음)
    ...(persisted?.supersession ? { supersession: persisted.supersession } : {}),
  }
}

// ── 작업 패키지 ────────────────────────────────────────────

/** 전략 §5.1 의 "목표 소요". FULL_REVIEW 는 본문 전문을 읽는 시간이다 */
const REVIEW_BUDGET = {
  SUMMARY_ONLY: '30초',
  RISK_SENTENCES: '2분',
  FULL_REVIEW: '10~15분',
}

const BOARD_LABEL = {
  '/community/menopause': '갱년기톡에 이야기 남기기',
  '/community/free': '자유게시판에 이야기 남기기',
}

const TODO = (what) => '<!-- TODO(세션): ' + what + ' -->'

/**
 * HIGH 패키지 머리에 붙는 표지.
 *
 * 이 문구가 파일에 남아 있어야 세션·창업자 어느 쪽이 열어도 등급을 안다.
 * run.json 의 needsFullReview 만으로는 파일을 직접 연 사람이 알 수 없다.
 *
 * 🔴 "사람이 읽는다" 를 최종 상태로 적지 않는다 (제작 전략 §13.7).
 *    사람이 게이트에 서 있는 것은 자동 고강도 검수가 아직 없기 때문이지
 *    HIGH 가 영원히 손으로 검수할 등급이어서가 아니다. 표지가 그렇게 읽히면
 *    임시 게이트가 영구 운영으로 굳는다.
 */
function fullReviewBanner() {
  // 🔴 수동 검수 게이트를 없앴다 (M3-A · SUPERSEDED). 붙일 표지가 없다.
  return ''
}

/**
 * ChatGPT 에 바로 넣을 수 있는 완성 brief 가 아니다.
 * 고정 규칙과 큐에서 나온 사실만 채우고, 해석이 필요한 자리는 TODO 로 비운다.
 */
/** 🔴 입력 수리 단계도 같은 todo 를 쓴다 — 큐 항목으로 brief.todo 후보를 다시 구성한다 (2026-10-10) */
export function briefTodo(item) {
  const label = BOARD_LABEL[item.ctaBoard] ?? '이야기 남기기'
  return `# [작업 패키지] 원고 지시서 초안 — ${item.title}

${fullReviewBanner(item)}> ⚠️ **이것은 완성된 brief 가 아니다.** ChatGPT 에 그대로 넣지 마라.
> producer 가 고정 규칙과 큐 사실만 채운 초안이다.
> 아래 TODO 를 세션이 채운 뒤 \`drafts/magazine/${item.slug}/brief.md\` 로 옮긴다.
> producer 는 원고도, 구조도, 위험 문장도 만들지 않는다 (전략 §13.1).

## 큐에서 온 사실

| 항목 | 값 |
|---|---|
| slug | \`${item.slug}\` |
| day | ${item.day} |
| contentType | ${item.contentType} |
| cluster | ${item.cluster} |
| intent | ${item.intent} |
| target | ${item.target} |
| riskLevel | ${item.riskLevel} |
| reviewMode | ${item.reviewMode} |
| imageMode | ${item.imageMode} |
| ctaBoard | \`${item.ctaBoard}\` |
${item.seriesId ? `| series | ${item.seriesId} #${item.seriesOrder} |\n` : ''}${item.season ? `| season | ${item.season} |\n` : ''}${item.calendarEvent ? `| calendarEvent | ${item.calendarEvent} |\n` : ''}${item.publishWindow ? `| publishWindow | ${item.publishWindow.after} ~ ${item.publishWindow.before} |\n` : ''}| internalLinks | ${item.internalLinks?.length ? item.internalLinks.join(' · ') : '없음'} |

**whyNow**: ${item.whyNow}

**notes(반드시 지킬 것)**: ${item.notes}

---

## 채워야 할 것 (producer 가 만들지 않는다)

### 검색 의도
${TODO('실제 검색어 4~6개를 나열하고, 이 글이 답할 한 가지를 한 문장으로 적는다')}

### 대상 독자
${item.target} 여성.
${TODO('이 주제에서 그 사람이 겪는 장면 4개를 불릿으로 적는다')}

### 도입에서 해야 할 것
${TODO('설명이 아니라 장면으로 시작하는 도입 지침 2~3문장')}

### 글 구조 (h2 5개)
${TODO('h2 제목 5개와 각각에서 다룰 범위·금지선을 적는다. 이 글의 논리 전개다')}

### 반드시 그대로 넣을 문장 5개
${TODO('원고에 토씨 그대로 들어갈 문장 5개. review 의 riskSentences 와 같은 문장이어야 한다')}

### 절대 쓰지 말 것 (주제별)
${TODO('이 주제에서 특히 위험한 표현·진단명·제품군을 적는다. 아래 공통 금지에 더한다')}

---

## 공통 규칙 (producer 가 채웠다 — 그대로 쓴다)

### 출력 형식

\`\`\`
---
title: ${item.title}
description: (90~120자. 직접 쓴 요약)
cluster: ${item.cluster}
medical: ${medicalForCluster(item.cluster)}
${item.seriesId ? `seriesId: ${item.seriesId}\nseriesOrder: ${item.seriesOrder}\n` : ''}---

첫 문단입니다. 한 문단은 2~3문장으로 씁니다.

## 소제목

문단.

> 짚어둘 문장은 인용 표시로 씁니다.

- 목록 항목

[CTA] ${item.ctaBoard} | ${label} | CTA 앞에 붙일 한 문장
\`\`\`

### 쓸 수 있는 표기가 전부다

| 표기 | 쓰임 |
|---|---|
| \`## \` | h2 |
| \`### \` | h3 |
| \`> \` | 인용 |
| \`- \` | 목록 |
| \`[CTA] href \\| 문구 \\| 앞 문장\` | 마지막에 정확히 1개 |
| 그 외 줄 | 문단 |

### 공통 금지

\`\`\`
🚫 표 · 코드블록 · 외부 링크 · 마크다운 이미지 · h1 · h4 이하 · HTML · 번호 목록
🚫 **굵게** · *기울임*
🚫 "반드시" "치료됩니다" "낫습니다" "원인입니다" "효과적입니다"
🚫 "시니어" "어르신" "노인" "실버"
🚫 출처 없는 통계
🚫 "~에 대해 알아보겠습니다" "결론적으로" 같은 AI 문형
\`\`\`

### 톤

- 존댓말. 상담이 아니라 옆에서 같이 이야기하는 톤
- 문단은 2~3문장. 길이를 들쭉날쭉하게
- 목록은 3곳을 넘기지 않는다
- 전문 용어는 바로 풀어쓴다

### 분량

본문 1,200~2,000자.
`
}

/**
 * 이 글이 `medical: true` 로 나가야 하는가.
 *
 * 🔴 **riskLevel 로 정하지 않는다. cluster 로 정한다.** 두 값은 다른 축이다.
 *      riskLevel  자동 등록을 열어도 되는가 (운영 위험)
 *      medical    의료 안내문과 의료 QA 를 걸어야 하는가 (내용 성격)
 *
 *    한동안 `riskLevel === 'LOW' ? false : true` 였다. 결함이 양방향으로 났다.
 *      누락  LOW + menopause-symptom 이 medical:false 로 생성된다 → QA 가 FAIL 을 낸다
 *            (`hardest-part-of-menopause` day 41 · `moment-body-changed` day 63)
 *      과잉  money-work 가 MEDIUM/HIGH 라는 이유로 medical:true 가 된다
 *            (`irp-tax-benefit` · `year-end-tax-medical` 등 4건)
 *    과잉은 실제로 터졌다 — `health-insurance-after-retire` 가 medical:true 로 나갔고
 *    PR #193 에서 걷어냈다. 세제 글에 진료 권고를 요구하는 것은 맞지 않는다.
 *
 * 집합은 `magazine-qa.mjs` 에서 가져온다. **정의를 두 벌로 두지 않는다** —
 * 갈라지면 producer 가 만든 frontmatter 를 QA 가 거부하는 상태가 다시 생긴다.
 *
 * SUGGESTED(daily·emotion)를 true 로 두는 근거는 등록분 실측이다.
 * 해당 cluster 8건이 **전부** medical:true 다. 기본을 false 로 두면 매번 WARN 이 뜨고
 * 세션이 매번 손으로 올리게 된다.
 *
 * 그 외(money-work·relationship·family)는 false 다. 등록분에서 money-work 0/4 ·
 * relationship 0/3 이고, family 는 1/3 이라 다수를 따른다. 필요하면 세션이 올린다 —
 * **기본값을 넓게 잡는 쪽이 위험하다.**
 */
function medicalForCluster(cluster) {
  return MEDICAL_REQUIRED.has(cluster) || MEDICAL_SUGGESTED.has(cluster)
}

/**
 * review.ts 가 아니다. 패킷 생성 대상이 아니다.
 * 위험도 골격만 정리하고 판단이 필요한 자리는 비운다.
 */
function reviewTodo(item) {
  const medical = medicalForCluster(item.cluster)
  const money = item.cluster === 'money-work'
  return `# [작업 패키지] 검수 데이터 초안 — ${item.title}

${fullReviewBanner(item)}> ⚠️ **이것은 review.ts 가 아니다.** 패킷 생성 대상이 아니다.
> 세션이 TODO 를 채운 뒤 \`drafts/magazine/${item.slug}/review.ts\` 로 만든다.
> riskSentences 는 **원고가 나온 뒤 실제 본문과 대조해 확정**한다.

## producer 가 채운 것

| 항목 | 값 |
|---|---|
| slug | \`${item.slug}\` |
| riskLevel | ${item.riskLevel} |
| reviewMode | ${item.reviewMode} |
| medical | ${medical ? (item.riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM') : item.riskLevel === 'LOW' ? 'NONE' : 'LOW'} (후보) |
| money | ${money ? (item.riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM') : 'NONE'} (후보) |
| legal | NONE (후보) |
| preparedBy | Claude Code (후보) |

**큐 notes**: ${item.notes}

## 채워야 할 것

### summary (5줄)
${TODO('원고가 무엇을 어떤 순서로 다루는지 5줄. 원고를 받은 뒤에 적는다')}

### riskSentences (5줄)
${TODO('brief 의 "반드시 그대로 넣을 문장 5개" 와 동일해야 한다. 원고 본문과 문자열이 정확히 일치해야 packet 이 통과한다')}

### factsToVerify
${TODO('창업자가 ' + REVIEW_BUDGET[item.reviewMode] + ' 안에 판단할 확인 항목 4~5개')}

### notes
${TODO('이 글에서 특히 볼 지점. 시리즈 톤 일관성, 계절 창 등')}
`
}

// ── lock ───────────────────────────────────────────────────

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM 은 "프로세스가 있는데 신호를 보낼 권한이 없다" 는 뜻이다 — 살아 있다.
    // 이걸 죽었다고 보면 lock 을 풀어 동시 실행이 난다.
    if (err.code === 'EPERM') return true
    return false // ESRCH = 없다
  }
}

// ── 실행 ───────────────────────────────────────────────────

function help() {
  console.log(`매거진 producer — 준비 단계

  node scripts/magazine-producer-plan.mjs              실행
  node scripts/magazine-producer-plan.mjs --dry-run    선정만. 파일을 쓰지 않는다
  node scripts/magazine-producer-plan.mjs --json       run.json 을 stdout 으로
  node scripts/magazine-producer-plan.mjs --now <ISO>  기준 시각 고정 (테스트)

이 스크립트는 원고를 쓰지 않는다. LLM 을 호출하지 않는다.
brief.md / review.ts 정본을 만들지 않는다 — _runs 에 작업 패키지만 놓는다.

🔴 레인은 **하나다** (M3-A). 등급으로 가르지 않는다.
  auto    validationProfile 을 정할 수 있는 모든 주제   하루 produceCount 건

검증 강도는 프로필이 정하고, QA 실패는 자동 재생성으로 되살린다 (최대 2회).
두 번 실패하면 그 글만 HOLD 되고 다른 글은 계속 간다. 사람 승인 단계는 없다.
등록 판정은 magazine-register.mjs 가 한다 — 여기서 풀지 않는다.`)
}

/**
 * 🔴 **재사용 후보의 slug 별 멱등성 판정** (2026-09-28 · legacy 빈 계획 재계산).
 *
 *    같은 날 이미 후속 작업(전송·이미지·처리)이 있었어도 회차 전체를 막지 않는다.
 *    대신 slug 마다 "지금 다시 다뤄도 같은 글을 두 번 보내지 않는가" 를 본다:
 *      ① articles.ts 에 있거나 큐에서 빠진 slug        → selectItems 가 이미 제외한다
 *      ② 같은 메시지 지문의 전송불명(sent=true/null)    → HOLD (DELIVERY_UNCERTAIN_HOLD · 재전송 0)
 *      ③ draft.md 가 있다                              → 재사용 (회수 대상이 아니다 — 전송 0)
 *      ④ 유효한 hero 가 있다                           → hero runner 가 검증 후 재사용한다 (이미지 0)
 *      ⑤ 전송 전에 실패했고 draft 가 없다              → 다시 처리 가능 (NEEDS_DRAFT)
 *      ⑥ 증거가 깨졌거나 판정할 수 없다                → **그 slug 만** HOLD · 다른 slug 는 계속
 *    판정은 전송 경계와 **같은 함수**(`deliveryGate`)로 한다 — 조건을 다시 쓰지 않는다.
 *
 * @returns {{ok:true, stage:string, draft:boolean, hero:boolean}|{ok:false, code:string, why:string}}
 */
export function reuseVerdict(slug, { draftsDir, ledger, gate, heroExists }) {
  const dir = join(draftsDir, slug)
  const m = materialState(dir)
  if (m.draftMd) {
    let text = null
    try { text = readFileSync(join(dir, 'draft.md'), 'utf8') } catch (e) {
      return { ok: false, code: 'EVIDENCE_BROKEN', why: `draft.md 를 읽지 못했다: ${e.message}` }
    }
    if (!text.trim()) return { ok: false, code: 'EVIDENCE_BROKEN', why: 'draft.md 가 비어 있다 — 재사용도 재전송도 판단할 수 없다' }
  }
  if (!ledger.ok) return { ok: false, code: 'LEDGER_UNREADABLE', why: ledger.why }
  const d = ledger.store?.[slug]?.delivery
  if (d !== undefined) {
    const fpOk = d && typeof d.messageFingerprint === 'string' && d.messageFingerprint.startsWith('sha256:')
    const sentOk = d && (d.sent === true || d.sent === false || d.sent === null)
    if (!d || typeof d !== 'object' || !sentOk || (d.kind === 'DELIVERY_UNCERTAIN' && !fpOk)) {
      return { ok: false, code: 'EVIDENCE_BROKEN', why: `전송 기록이 깨졌다: ${JSON.stringify(d).slice(0, 120)}` }
    }
  }
  if (m.stage === 'NEEDS_DRAFT') {
    const g = gate({ slug, draftsDir })
    if (!g.ok) return { ok: false, code: g.code ?? 'LEDGER_UNREADABLE', why: g.why }
    if (g.hold) return { ok: false, code: 'DELIVERY_UNCERTAIN_HOLD', why: g.hold.why }
  }
  return { ok: true, stage: m.stage, draft: m.draftMd, hero: Boolean(heroExists(slug)) }
}

/**
 * 🔴 **회차 계산 — 판정·보존·새 run 생성을 한 잠금 안에서** (production 진입점 `main` 이 부른다).
 *    시험은 이 함수를 그대로 부른다(여러 프로세스에서 동시에 부르는 반례 포함).
 *
 * @returns {{code:number, outcome:string, run?:object, preserved?:string[], why?:string}}
 *   code 0 정상(새 계산 · 이미 완료 · 실행 중) · 3 모르는 판(fail-closed — producer 흐름이 회수를 건너뛴다)
 */
export function planRun({
  today, now, dryRun = false, runsDir = RUNS_DIR, draftsDir = DRAFTS_DIR,
  loadArticlesFn = loadArticles, loadQueueFn = loadQueue, inventoryFn = calculateInventory,
  quarantinePath = QUARANTINE_PATH, gateFn = deliveryGate,
  heroExists = (slug) => existsSync(heroFilePath(slug)),
  log = (m) => console.log(m),
  /** 🔴 direct 행이 선정됐을 때만 부른다 — legacy 회차는 제품 graph 도 source 도 읽지 않는다 */
  productGraphVersionFn = () => readProductGraphVersion(PRODUCT_GRAPH_CURRENT),
  directSourceFn = verifyDirectSpecIdentity,
  persistSpecFn = persistDirectSpecNoClobber,
  /** 🔴 명시적 개정(supersedes)의 교체 — lease 안에서만 부른다. 시험은 경쟁 writer hook 을 단 판을 준다 */
  supersedeFn = supersedeDirectSpec,
  /** 🔴 앞 교체가 남긴 조각(급사 · 실패)의 복구 판정 — lease 안에서만 */
  recoverFn = recoverSupersession,
  leaseFn = acquireManuscriptLease,
}) {
  const runDir = join(runsDir, today)
  const lockFile = join(runDir, '.lock')

  // 🔴 잠금 밖의 빠른 길 — 지금 판 COMPLETED 는 잠금 없이도 확정이다 (죽은 lock 이 COMPLETED 를 덮지 않게)
  if (!dryRun) {
    const pre = classifyExistingRun({ runDir, today })
    if (pre.kind === 'CURRENT_COMPLETED') { log(`  ${pre.why} — 종료`); return { code: 0, outcome: 'ALREADY_COMPLETED' } }
    if (pre.kind === 'LEGACY_COMPLETED') { log(`  ${pre.why} — 종료`); return { code: 0, outcome: 'LEGACY_COMPLETED' } }
    if (pre.kind === 'UNKNOWN_SCHEMA') {
      log(`  🔴 RUN_SCHEMA_UNKNOWN — ${pre.why}. 다시 계산하지도, 이어 쓰지도 않는다 (fail-closed · 전송 0)`)
      return { code: 3, outcome: 'UNKNOWN_SCHEMA', why: pre.why }
    }
  }

  let lock = null
  if (!dryRun) {
    mkdirSync(runDir, { recursive: true })
    lock = acquireRunLock(lockFile, { pidAlive })
    if (!lock.ok) {
      if (lock.alive) { log(`  실행 중(pid ${lock.holder?.pid ?? '?'}) — 종료`); return { code: 0, outcome: 'RUNNING' } }
      // 죽은 lock = 이전 실행이 도중에 끊겼다. 기록만 남기고 재시도하지 않는다. (옛 동작 · 원자적 쓰기)
      preserveRunFiles(runDir, 'before-abort')
      writeFileAtomic(join(runDir, 'run.json'), JSON.stringify({
        schemaVersion: RUN_SCHEMA_VERSION, date: today, status: 'ABORTED',
        abortReason: '이전 실행이 비정상 종료됐다(lock 잔존). 재시도하지 않는다.', previousLock: lock.holder,
      }, null, 2) + '\n')
      rmSync(lockFile, { force: true })
      log('  이전 실행이 비정상 종료됨 — ABORTED 기록 후 종료 (재시도하지 않는다)')
      return { code: 0, outcome: 'ABORTED' }
    }
  }

  try {
    // 🔴 잠금 안에서 **다시** 판정한다 — 잠금 밖에서 본 뒤 다른 producer 가 끝냈을 수 있다
    let supersedes = null
    if (!dryRun) {
      const cur = classifyExistingRun({ runDir, today })
      if (cur.kind === 'CURRENT_COMPLETED' || cur.kind === 'LEGACY_COMPLETED') {
        log(`  ${cur.why} — 종료`)
        return { code: 0, outcome: cur.kind === 'CURRENT_COMPLETED' ? 'ALREADY_COMPLETED' : 'LEGACY_COMPLETED' }
      }
      if (cur.kind === 'UNKNOWN_SCHEMA') {
        log(`  🔴 RUN_SCHEMA_UNKNOWN — ${cur.why}. 다시 계산하지도, 이어 쓰지도 않는다 (fail-closed · 전송 0)`)
        return { code: 3, outcome: 'UNKNOWN_SCHEMA', why: cur.why }
      }
      if (cur.kind === 'LEGACY_EMPTY' || cur.kind === 'BROKEN') {
        // 🔴 지우지 않는다 — 고유 이름으로 보존한 뒤 새 run 을 원자적으로 쓴다
        const kept = preserveRunFiles(runDir, cur.kind === 'LEGACY_EMPTY' ? 'legacy-empty' : 'broken')
        supersedes = { kind: cur.kind, why: cur.why, preservedAs: kept }
        log(`  🔴 ${cur.kind} — ${cur.why}. 보존: ${kept.join(', ')} — 새 판으로 다시 계산한다`)
      }
    }

    const articles = loadArticlesFn()
    const queue = loadQueueFn()
    const inventory = inventoryFn(now)
    const produceCount = produceCountFor(inventory.inventoryDays)
    const reviewCount = reviewCountFor(produceCount)

    const draftExists = (slug) => existsSync(join(draftsDir, slug))
    let expectedGraphVersion
    const judgeDirect = (queueItem) => {
      if (expectedGraphVersion === undefined) expectedGraphVersion = productGraphVersionFn()
      return directSourceFn({ queueItem, draftsDir, expectedGraphVersion, repoRoot: REPO_ROOT, productRoot: REPO_ROOT })
    }
    const gated = selectWithDirectGate({
      queue, articles, today, produceCount, reviewCount, draftExists, judgeDirect,
    })
    const { review, skipped, reusable: reusableRaw, directReady } = gated
    let selected = gated.selected
    const directHeld = [...gated.directHeld]
    for (const h of gated.identityHeld) log(`  ⏸ ${h.code} — ${h.slug} (day ${h.day}${h.intentId ? ` · ${h.intentId}` : ''}) — 사람이 큐를 고치기 전 선정 0`)

    // 🔴 준비된 direct 행만 spec 을 쓴다 — 덮어쓰지 않는다. 충돌이면 그 행만 HOLD 로 뺀다.
    const directPersisted = new Map()
    if (!dryRun) {
      for (const item of selected) {
        const j = directReady.get(item.slug)
        if (!j) continue
        const p = persistSpecFn({ spec: j.spec, draftsDir })
        if (p.ok) directPersisted.set(item.slug, p)
        else directHeld.push({ day: item.day, slug: item.slug, code: p.code, why: p.why, directSpec: j.evidence })
      }
      const conflicted = new Set(directHeld.map((h) => h.slug))
      selected = selected.filter((item) => !conflicted.has(item.slug))
    }
    for (const h of directHeld) {
      const e = h.directSpec
      log(`  ⏸ ${h.code} — ${h.slug}${e ? ` · expected ${e.expectedGraphVersion ?? '-'} · observed ${e.observedGraphVersion ?? '-'} · blockers ${e.blockers.join(',') || '-'} · missing ${e.missingFields.length}` : ''}`)
    }

    // 🔴 slug 별 멱등성 — 판정 불가·전송불명은 그 slug 만 HOLD 로 뺀다
    const ledger = readQuarantine(quarantinePath)
    // 🔴 신원이 고유한 행만 — 중복 slug 가 입력 순서대로 덮어써지지 않는다
    const queueBySlug = new Map(gated.uniqueQueue.map((item) => [item.slug, item]))
    const gate = ({ slug, draftsDir: dd }) => gateFn({ slug, draftsDir: dd, quarantinePath,
      queueItem: queueBySlug.get(slug) ?? null })
    const reusable = []
    const held = [...gated.identityHeld, ...directHeld]
    for (const item of reusableRaw) {
      /**
       * 🔴 **재사용 direct 행도 지금 승인 source 를 다시 지난다** (2026-10-15 Codex P0).
       *    폴더가 있다는 것은 예전에 spec 을 썼다는 뜻일 뿐이다. 그 사이 source 가 사라지거나 바뀌었으면
       *    (승인 취소·stale·hash drift) 또는 디스크 spec 이 지금 컴파일 결과와 다르면 HOLD 다 — 회수·등록 0.
       *    spec 저장 직후 run.json 전에 죽은 회차도 다음 회차에서 여기로 온다.
       *    🔴 재사용 폴더에 spec 이 없으면 **새로 쓰지 않는다** (Codex P1) — 기존 legacy draft·article-draft 가 든
       *       폴더를 direct 로 승격시키는 길이 된다. 최초 spec 저장은 신규 selected 행에만 있다.
       */
      /**
       * 🔴 **CTA 수리 transaction 이 남은 slug** (2026-10-29 Codex P1). 떼어 낸 뒤 급사하면 draft.md 가 없어
       *    아래 판정이 NEEDS_DRAFT(회수 필요)로 읽는다 — 그 slug 만 HOLD 한다. direct 판정 · spec 교체 · 회수 · 등록 0.
       *    조각은 지우지도 복구하지도 않는다 (CTA repair `--write` 만 끝낸다).
       */
      const cta = ctaRepairPendingState({ draftsDir, slug: item.slug })
      if (cta.pending) {
        held.push({ day: item.day, slug: item.slug, code: cta.code, why: cta.why, ctaRepair: { fragments: cta.fragments } })
        continue
      }
      const mode = resolveMagazineAutoMode(item)
      let directRow = null
      if (!mode.ok) {
        held.push({ day: item.day, slug: item.slug, code: mode.code, why: mode.why })
        continue
      }
      if (mode.mode === DIRECT_SPEC_MODE) {
        let j = judgeDirect(item)
        let supersession = null
        /**
         * 🔴 **앞 교체의 조각 복구** (2026-10-26 · 급사 · 설치 실패). 소유 사본 · tmp 가 남았으면 lease 안에서 먼저 판정한다 —
         *    옛 spec 복구(→ 아래에서 다시 교체) · 새 spec 확인(→ recovered 기록) · 그 밖은 아무것도 지우지 않고 HOLD.
         */
        if (!dryRun && supersedeLeftovers({ draftsDir, slug: item.slug }).length) {
          const lease = leaseFn({ slug: item.slug, work: 'supersede-recover', path: quarantinePath })
          if (!lease.ok) {
            held.push({ day: item.day, slug: item.slug, code: lease.code, why: lease.why, directSpec: j.evidence ?? null })
            continue
          }
          let rec
          try { rec = recoverFn({ draftsDir, slug: item.slug, lease, newSpec: j.judged?.spec ?? j.spec ?? null, safety: j.judged?.evidence?.safetyRevision ?? j.evidence?.safetyRevision ?? null }) } finally { lease.release() }
          if (!rec.ok) {
            held.push({ day: item.day, slug: item.slug, code: rec.code, why: rec.why, directSpec: { ...(j.evidence ?? {}), supersede: { problems: rec.problems, recovery: rec.recovery } } })
            continue
          }
          if (rec.record) supersession = rec.record
          log(`  ♻ ${item.slug} — 앞 교체 조각 복구: ${rec.state}`)
          j = judgeDirect(item)
        }
        /**
         * 🔴 **명시적 개정** (2026-10-26). 승인이 supersedes.specHash 로 디스크 spec 을 정확히 가리킨다.
         *    같은 slug 의 원고 lease 를 쥔 채로만 교체하고, 교체 뒤 같은 관문을 처음부터 다시 지난다.
         *    dry-run 은 쓰지 않는다 — 교체 필요 상태 그대로 HOLD 로 보고한다.
         */
        if (!j.ok && j.code === DIRECT_SPEC_SUPERSEDE_REQUIRED && !dryRun) {
          // 🔴 전송 흔적을 확인할 수 없으면 교체하지 않는다 — 모름을 「흔적 없음」으로 읽지 않는다
          if (!ledger.ok) {
            held.push({ day: item.day, slug: item.slug, code: ledger.code ?? 'LEDGER_UNREADABLE', why: `격리 장부를 읽지 못해 개정 조건을 확인할 수 없다: ${ledger.why}`, directSpec: j.evidence })
            continue
          }
          const lease = leaseFn({ slug: item.slug, work: 'supersede', path: quarantinePath })
          if (!lease.ok) {
            held.push({ day: item.day, slug: item.slug, code: lease.code, why: lease.why, directSpec: j.evidence })
            continue
          }
          let s
          try {
            s = supersedeFn({ judged: j.judged, draftsDir, slug: item.slug, deliveryEntry: ledger.store[item.slug] ?? null, lease })
          } finally { lease.release() }
          if (!s.ok) {
            held.push({ day: item.day, slug: item.slug, code: s.code, why: s.why, directSpec: { ...j.evidence, supersede: { ...j.supersede, problems: s.problems, ...(s.recovery ? { recovery: s.recovery } : {}) } } })
            continue
          }
          supersession = s.record
          log(`  ♻ ${item.slug} — 명시적 개정${s.record.topicSafetyRevision ? '(원고 보존 · 안전 개정)' : ''}: spec ${s.record.oldSpecHash.slice(0, 15)}… → ${s.record.newSpecHash.slice(0, 15)}… (보존 ${s.record.archive})`)
          j = judgeDirect(item)
        }
        if (!j.ok) {
          held.push({ day: item.day, slug: item.slug, code: j.code, why: j.why, directSpec: j.evidence })
          continue
        }
        if (j.existing !== 'IDENTICAL') {
          held.push({ day: item.day, slug: item.slug, code: 'DIRECT_SPEC_MISSING',
            why: '재사용 폴더에 article-spec.json 이 없다 — 재사용 단계는 spec 을 새로 쓰지 않는다', directSpec: j.evidence })
          continue
        }
        directRow = directSpecRow(j, { written: false, supersession })
      }
      const v = reuseVerdict(item.slug, { draftsDir, ledger, gate, heroExists })
      if (v.ok) reusable.push({ ...item, ...(directRow ? { directSpec: directRow } : {}), stage: v.stage, reuse: { draft: v.draft, hero: v.hero } })
      else held.push({ day: item.day, slug: item.slug, code: v.code, why: v.why })
    }
    for (const h of held.slice(gated.identityHeld.length + directHeld.length)) {
      if (!h.directSpec && !h.ctaRepair && h.code !== 'UNKNOWN_MAGAZINE_AUTO_MODE' && h.code !== 'G8_ROW_NOT_DIRECT') continue
      const e = h.directSpec
      log(`  ⏸ ${h.code} — ${h.slug} (재사용)${e ? ` · expected ${e.expectedGraphVersion ?? '-'} · observed ${e.observedGraphVersion ?? '-'} · blockers ${e.blockers.join(',') || '-'}` : ''}`)
    }

    const all = [...selected, ...review]
    const run = {
      schemaVersion: RUN_SCHEMA_VERSION,
      date: today,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
      status: 'PARTIAL',
      dryRun,
      inventoryDays: inventory.inventoryDays,
      produceCount,
      reviewCount,
      counts: inventory.counts,
      selected: all.map((i) => ({
        day: i.day, slug: i.slug, title: i.title,
        contentType: i.contentType, riskLevel: i.riskLevel,
        publishWindow: i.publishWindow ?? null,
        ...(i.directSpecMode ? { directSpecMode: i.directSpecMode } : {}),
        ...(i.intentId ? { intentId: i.intentId } : {}),
        ...(i.g8ManifestHash ? { g8ManifestHash: i.g8ManifestHash } : {}),
        // 🔴 G8 행은 두 해시를 같이 운반한다 — 하나만 실리면 하류 resolveMagazineAutoMode 가 G8_ROW_NOT_DIRECT 로 막는다
        ...(i.articlePlanHash ? { articlePlanHash: i.articlePlanHash } : {}),
        ...(directReady.has(i.slug) ? { directSpec: directSpecRow(directReady.get(i.slug), directPersisted.get(i.slug)) } : {}),
        // 🔴 호환 필드 — 자동 진행을 가르지 않는다
        needsFullReview: false,
        packageWritten: false,
      })),
      skipped,
      /**
       * 🔴 **재사용 후보.** 새로 만들 필요는 없지만 내보낼 재료가 있는 주제다.
       *    auto-register 가 이것을 보고 "할 일이 없다" 와 "이미 있다" 를 구분한다.
       */
      reusable,
      /** 🔴 slug 별 HOLD — 전송불명·깨진 증거. 소비자는 이 목록을 대상으로 읽지 않는다 */
      held,
      supersedes,
      abortReason: null,
    }

    if (!dryRun) {
      for (const item of all) {
        // 🔴 direct 행에는 legacy brief 재료를 놓지 않는다 — brief 생성기가 이 폴더를 대상으로 읽는다
        if (directReady.has(item.slug)) continue
        const dir = join(runDir, 'selected', item.slug)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'brief.todo.md'), briefTodo(item))
        writeFileSync(join(dir, 'review.todo.md'), reviewTodo(item))
        const row = run.selected.find((s) => s.slug === item.slug)
        if (row) row.packageWritten = true
      }
      run.status = 'COMPLETED'
      run.finishedAt = new Date().toISOString()
      writeFileAtomic(join(runDir, 'run.json'), JSON.stringify(run, null, 2) + '\n')
      writeFileAtomic(join(runDir, 'report.md'), report(run))
    } else {
      run.status = 'COMPLETED'
      run.finishedAt = new Date().toISOString()
    }
    return { code: 0, outcome: supersedes ? 'RECOMPUTED_LEGACY' : 'COMPUTED', run, preserved: supersedes?.preservedAs ?? [] }
  } finally {
    lock?.release?.()
  }
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) return help()

  const dryRun = argv.includes('--dry-run')
  const asJson = argv.includes('--json')
  const nowArg = argv[argv.indexOf('--now') + 1]
  const now = argv.includes('--now') && nowArg ? new Date(nowArg).getTime() : Date.now()
  const today = kstDate(now)

  const r = planRun({ today, now, dryRun })
  if (r.run) {
    if (asJson) console.log(JSON.stringify(r.run, null, 2))
    else console.log(report(r.run))
  }
  // 🔴 모르는 판은 non-zero — producer 흐름이 brief·원고 회수를 건너뛴다 (전송 0)
  if (r.code) process.exitCode = r.code
}

export function report(run) {
  const L = []
  L.push(`# producer 준비 리포트 — ${run.date}${run.dryRun ? ' (dry-run)' : ''}`)
  L.push('')
  const highs = 0   // 🔴 등급으로 따로 세는 칸이 없다
  L.push(
    `재고 ${run.inventoryDays}일 · 오늘 생산 ${run.produceCount}건` +
      ` · HIGH ${run.reviewCount ?? 0}건 · 선정 ${run.selected.length}건`,
  )
  L.push(`매거진 공개 ${run.counts.live} · 예약 ${run.counts.scheduled} · 차단 ${run.counts.blocked}`)
  L.push('')
  if (run.produceCount === 0) {
    L.push('재고가 목표(14일) 이상이다. 오늘은 만들지 않는다.')
    L.push('')
  }
  if (run.supersedes) {
    L.push(`> 🔴 ${run.supersedes.kind} — ${run.supersedes.why}`)
    L.push(`> 보존: ${(run.supersedes.preservedAs ?? []).join(', ') || '(없음)'} · 새 판 ${run.schemaVersion ?? '-'} 으로 다시 계산했다`)
    L.push('')
  }
  L.push(`## 재사용 후보 ${(run.reusable ?? []).length}건 · slug HOLD ${(run.held ?? []).length}건`)
  L.push('')
  for (const r of run.reusable ?? []) {
    L.push(`- \`${r.slug}\` — ${r.stage ?? '-'}${r.reuse?.draft ? ' · draft 재사용(전송 0)' : ''}${r.reuse?.hero ? ' · hero 재사용(이미지 0)' : ''}`)
  }
  for (const h of run.held ?? []) L.push(`- ⏸ \`${h.slug}\` — ${h.code}: ${h.why}`)
  L.push('')
  L.push('## 선정')
  L.push('')
  if (!run.selected.length) {
    L.push('없음. 아래 제외 사유를 본다.')
  } else {
    for (const s of run.selected) {
      const win = s.publishWindow ? ` · 창 ${s.publishWindow.after}~${s.publishWindow.before}` : ''
      const gate = ''   // 🔴 붙일 표지가 없다
      L.push(`- day ${s.day} \`${s.slug}\` — ${s.title}`)
      // 🔴 DIRECT_SPEC 행은 todo 재료가 없는 것이 정상이다 — "패키지 미생성" 으로 적지 않는다
      const pkg = s.directSpec ? ` · DIRECT_SPEC ${s.directSpec.specHash.slice(0, 19)} (brief 불필요)` : (s.packageWritten ? '' : ' · 패키지 미생성')
      L.push(`  ${s.contentType} · ${s.riskLevel}${win}${pkg}${gate}`)
    }
  }
  if (highs) {
    L.push('')
    L.push(
      `> HIGH ${highs}건은 지금 초안까지만 만든다. 창업자가 본문 전문을 읽고 승인하기`,
    )
    L.push('> 전에는 `magazine-register.mjs` 가 `articles.ts` 등록을 막는다.')
    L.push('>')
    L.push('> 이것은 최종 상태가 아니다. **최종 목표는 고강도 자동 검수 PASS 시 자동 등록**이고,')
    L.push('> 지금 사람이 서 있는 이유는 자동 검수가 사실관계·배치·톤을 아직 판정하지')
    L.push('> 못해서다 — 제작 전략 §13.7.')
  }
  L.push('')
  L.push('## 제외 (상위 12건)')
  L.push('')
  for (const s of run.skipped.slice(0, 12)) L.push(`- day ${s.day} \`${s.slug}\` — ${s.reason}`)
  if (run.skipped.length > 12) L.push(`- … 외 ${run.skipped.length - 12}건`)
  L.push('')
  L.push('## 다음')
  L.push('')
  /**
   * 🔴 brief 안내는 legacy 선정 행에만 해당한다 (2026-10-15 Codex P2).
   *    legacy-only 회차는 예전 두 줄 그대로 · direct-only 는 brief 안내 0 · mixed 는 legacy slug 로 범위를 적는다.
   */
  //    🔴 direct 는 selected 와 reusable 을 함께 본다 (reusable-only direct 회차도 direct 회차다) — slug 는 한 번만 센다.
  const directSel = [...new Set([...run.selected, ...(run.reusable ?? [])].filter((s) => s?.directSpec).map((s) => s.slug))]
  const legacySel = run.selected.filter((s) => !s.directSpec).map((s) => s.slug)
  if (!directSel.length) {
    L.push('세션에서 `_runs/' + run.date + '/selected/*/brief.todo.md` 의 TODO 를 채운 뒤')
    L.push('`drafts/magazine/{slug}/brief.md` 로 옮기고 원고 제작을 이어간다.')
  } else {
    L.push(`DIRECT_SPEC ${directSel.length}건(${directSel.join(', ')})은 brief 를 만들지 않는다 — \`drafts/magazine/{slug}/article-spec.json\` 으로 \`--fetch-run\` 이 원고를 회수하거나 재사용한다.`)
    if (legacySel.length) {
      L.push(`legacy 선정 ${legacySel.length}건(${legacySel.join(', ')})에만 해당: \`_runs/${run.date}/selected/{slug}/brief.todo.md\` 의 TODO 를 채운 뒤`)
      L.push('`drafts/magazine/{slug}/brief.md` 로 옮기고 원고 제작을 이어간다. DIRECT_SPEC 행(선정·재사용)에는 적용하지 않는다.')
    }
  }
  L.push('')
  L.push('🚫 producer 는 원고·hero·등록·공개·commit·push 를 하지 않는다.')
  return L.join('\n') + '\n'
}

/**
 * 🔴 **직접 실행할 때만 돈다.**
 *
 *    2026-09-15 진단에서 드러났다 — 이 파일은 `selectItems` 를 export 하는데
 *    `main()` 이 무방비로 최상단에 있었다. 그래서 **선정 결과만 계산하려고
 *    import 한 쪽이 실제 회차를 돌려 버렸다.** `_runs/{date}/` 가 통째로 생기고
 *    lock 까지 잡혔다. 판정 함수를 빌려 쓰는 것과 회차를 실행하는 것은 다른 일이다.
 *
 *    같은 저장소의 다른 스크립트들이 이미 쓰는 형태를 그대로 따른다
 *    (`magazine-auto-register.mjs` · `magazine-auto-register-ready.mjs`).
 */
if (process.argv[1] && process.argv[1].endsWith('magazine-producer-plan.mjs')) main()
