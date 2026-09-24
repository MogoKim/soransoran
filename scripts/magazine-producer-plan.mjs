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
import { join } from 'node:path'
import { loadArticles, loadQueue, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { calculateInventory } from './magazine-inventory.mjs'
import { MEDICAL_REQUIRED, MEDICAL_SUGGESTED } from './magazine-qa.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'

const RUNS_DIR = join(DRAFTS_DIR, '_runs')

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
      skip(item, 'drafts/magazine/' + item.slug + ' 가 이미 있다')
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
  return { selected, review: [], skipped }
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
function briefTodo(item) {
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

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) return help()

  const dryRun = argv.includes('--dry-run')
  const asJson = argv.includes('--json')
  const nowArg = argv[argv.indexOf('--now') + 1]
  const now = argv.includes('--now') && nowArg ? new Date(nowArg).getTime() : Date.now()
  const today = kstDate(now)

  const runDir = join(RUNS_DIR, today)
  const runJson = join(runDir, 'run.json')
  const lockFile = join(runDir, '.lock')

  // 이미 오늘 끝냈으면 다시 돌지 않는다.
  // dry-run 은 아무것도 쓰지 않으므로 중복 위험이 없다 — 진단용으로 항상 돈다.
  if (!dryRun && existsSync(runJson)) {
    try {
      const prev = JSON.parse(readFileSync(runJson, 'utf8'))
      if (prev.status === 'COMPLETED') {
        console.log(`  오늘(${today}) run 은 이미 COMPLETED — 종료`)
        return
      }
    } catch {
      // 깨진 run.json 은 무시하고 이어간다 (아래에서 덮어쓴다)
    }
  }

  // lock
  if (existsSync(lockFile) && !dryRun) {
    let lock = null
    try { lock = JSON.parse(readFileSync(lockFile, 'utf8')) } catch { lock = null }
    if (lock && pidAlive(lock.pid)) {
      console.log(`  실행 중(pid ${lock.pid}) — 종료`)
      return
    }
    // 죽은 lock = 이전 실행이 도중에 끊겼다. 기록만 남기고 재시도하지 않는다.
    if (!dryRun) {
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        runJson,
        JSON.stringify(
          { date: today, status: 'ABORTED', abortReason: '이전 실행이 비정상 종료됐다(lock 잔존). 재시도하지 않는다.', previousLock: lock },
          null, 2,
        ) + '\n',
      )
      rmSync(lockFile, { force: true })
    }
    console.log('  이전 실행이 비정상 종료됨 — ABORTED 기록 후 종료 (재시도하지 않는다)')
    return
  }

  const articles = loadArticles()
  const queue = loadQueue()
  const inventory = calculateInventory(now)
  const produceCount = produceCountFor(inventory.inventoryDays)

  const reviewCount = reviewCountFor(produceCount)

  const draftExists = (slug) => existsSync(join(DRAFTS_DIR, slug))
  const { selected, review, skipped } = selectItems({
    queue, articles, today, produceCount, reviewCount, draftExists,
  })

  // 패키지 생성·run.json 은 두 레인을 한 목록으로 다룬다.
  // 하류(notify · webui-runner · batch-qa)가 run.selected 와 _runs/{date}/selected/
  // 하나만 보기 때문이다. 등급은 needsFullReview 로 구분한다 —
  // 디렉터리를 나누면 HIGH 초안이 기존 도구에 아예 안 보여 병목이 그대로 남는다.
  const all = [...selected, ...review]

  const run = {
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
      /**
       * true 면 지금은 창업자가 본문 전문을 읽기 전까지 등록되지 않는다.
       * 임시 수동 게이트다 — 최종 목표는 고강도 자동 검수 PASS 시 자동 등록(§13.7).
       */
      // 🔴 호환 필드 — 자동 진행을 가르지 않는다
      needsFullReview: false,
      packageWritten: false,
    })),
    skipped,
    abortReason: null,
  }

  if (!dryRun) {
    mkdirSync(runDir, { recursive: true })
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: run.startedAt }) + '\n')
    for (const item of all) {
      const dir = join(runDir, 'selected', item.slug)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'brief.todo.md'), briefTodo(item))
      writeFileSync(join(dir, 'review.todo.md'), reviewTodo(item))
      const row = run.selected.find((s) => s.slug === item.slug)
      if (row) row.packageWritten = true
    }
    run.status = 'COMPLETED'
    run.finishedAt = new Date().toISOString()
    writeFileSync(runJson, JSON.stringify(run, null, 2) + '\n')
    writeFileSync(join(runDir, 'report.md'), report(run))
    rmSync(lockFile, { force: true })
  } else {
    run.status = 'COMPLETED'
    run.finishedAt = new Date().toISOString()
  }

  if (asJson) console.log(JSON.stringify(run, null, 2))
  else console.log(report(run))
}

function report(run) {
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
  L.push('## 선정')
  L.push('')
  if (!run.selected.length) {
    L.push('없음. 아래 제외 사유를 본다.')
  } else {
    for (const s of run.selected) {
      const win = s.publishWindow ? ` · 창 ${s.publishWindow.after}~${s.publishWindow.before}` : ''
      const gate = ''   // 🔴 붙일 표지가 없다
      L.push(`- day ${s.day} \`${s.slug}\` — ${s.title}`)
      L.push(`  ${s.contentType} · ${s.riskLevel}${win}${s.packageWritten ? '' : ' · 패키지 미생성'}${gate}`)
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
  L.push('세션에서 `_runs/' + run.date + '/selected/*/brief.todo.md` 의 TODO 를 채운 뒤')
  L.push('`drafts/magazine/{slug}/brief.md` 로 옮기고 원고 제작을 이어간다.')
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
