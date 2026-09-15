/**
 * brief 정책 — auto-brief 의 정본
 *
 * 왜 이 파일이 있는가
 *   brief 규칙이 지금까지 runbook 산문과 사람 기억에만 있었다.
 *   7-D-13-C 사고("절대 쓰지 말 것"에 넣은 단어를 "반드시 넣을 문장"에도 씀)는
 *   사람이 봐야 걸리는 상태였다. runbook 이 직접 그렇게 적어 뒀다 —
 *   "지금은 사람이 봐야 걸린다".
 *
 *   무인으로 돌리려면 그 검사가 코드여야 한다. 이 파일이 규칙이고,
 *   verifyBrief() 가 그 규칙을 집행한다.
 *
 * 🔴 이 파일은 brief 를 만들지 않는다. 무엇이 통과인지만 정한다.
 *    생성은 magazine-brief-auto.mjs 가 하고, 그 결과도 여기를 통과해야 한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './magazine-load.mjs'

// ─────────────────────────────────────────────────────────
// 공통 금지어 — magazine-qa.mjs 의 거울
// ─────────────────────────────────────────────────────────

/**
 * 🔴 magazine-qa.mjs 의 BANNED_WORDS · MEDICAL_ASSERTIONS 와 같은 값이다.
 *    저쪽이 export 하지 않아 여기 옮겨 적었다. 옮겨 적은 값은 갈라진다 —
 *    그래서 assertQaWordsInSync() 가 저 파일을 읽어 대조한다.
 *    (magazine-gate.mjs 의 assertGateInSync 와 같은 방식이다)
 */
export const BANNED_WORDS = ['시니어', '어르신', '노인', '실버']
export const MEDICAL_ASSERTIONS = ['반드시', '치료됩니다', '원인입니다', '완치', '효과적입니다']

/** magazine-qa.mjs 와 갈라졌는지 본다. 갈라졌으면 던진다 */
export function assertQaWordsInSync(qaPath = join(ROOT, 'scripts/magazine-qa.mjs')) {
  const src = readFileSync(qaPath, 'utf8')
  const pick = (name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
    if (!m) throw new Error(`${name} 을 magazine-qa.mjs 에서 찾지 못했다`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  const pairs = [
    ['BANNED_WORDS', BANNED_WORDS, pick('BANNED_WORDS')],
    ['MEDICAL_ASSERTIONS', MEDICAL_ASSERTIONS, pick('MEDICAL_ASSERTIONS')],
  ]
  for (const [name, mine, theirs] of pairs) {
    if (mine.join('|') !== theirs.join('|')) {
      throw new Error(
        `${name} 이 magazine-qa.mjs 와 다르다.\n  policy: ${mine.join(', ')}\n  qa    : ${theirs.join(', ')}\n` +
          '  두 곳을 같이 고친다.',
      )
    }
  }
  return true
}

// ─────────────────────────────────────────────────────────
// brief.md 섹션 스펙
// ─────────────────────────────────────────────────────────

/**
 * brief.md 에 반드시 있어야 하는 h2.
 * 기존 15건이 쓰는 형태 그대로다 — 새 형식을 만들지 않는다.
 *
 * 🔴 "반드시 그대로 넣을 문장" 은 webui-runner 가 마커를 뽑는 자리다
 *    (magazine-webui-runner.mjs 의 brief.split). 이름을 바꾸면 회수가 조용히 깨진다.
 */
export const REQUIRED_SECTIONS = [
  '검색 의도',
  '대상 독자',
  '도입에서 해야 할 것',
  '글 구조',
  '반드시 그대로 넣을 문장',
  '절대 쓰지 말 것',
]

/** 마커를 뽑는 헤딩. runner 와 같은 문자열이어야 한다 */
export const MARKER_HEADING = '## 반드시 그대로 넣을 문장'

/** 채우지 않고 넘어간 흔적 */
export const TODO_MARKERS = ['TODO(세션)', '<!-- TODO', '(여기에', 'TODO:']

// ─────────────────────────────────────────────────────────
// 등급 정책
// ─────────────────────────────────────────────────────────

/**
 * 🔴 HIGH 는 자동 생성하지 않는다. 큐가 "창업자 검수 대상" 으로 표시한 등급이다.
 *
 * 허용 목록이 아니라 **차단 목록**으로 둔다.
 *    등급은 두 곳에서 온다 — 큐의 riskLevel(LOW/MEDIUM/HIGH)과
 *    review.risk.medical(NONE 도 있다). 허용 목록으로 두면 NONE 이 HIGH 와
 *    같이 걸린다. 실제로 회귀에서 그렇게 잘못 잡혔다.
 */
export const BLOCKED_RISK_LEVELS = ['HIGH']

/** 알려진 등급 값. 이 밖의 값은 "모른다" 로 본다 */
export const KNOWN_RISK_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH']

/** 이 등급부터 riskSentences 5개가 필수다 (magazine-batch-qa ⑤ 와 같은 기준) */
export const RISK_SENTENCE_REQUIRED_LEVELS = ['MEDIUM', 'HIGH']

export const RISK_SENTENCE_COUNT = 5

// ─────────────────────────────────────────────────────────
// 의료 · 재무 안전 문장
// ─────────────────────────────────────────────────────────

/**
 * 의료 주제에 반드시 하나 이상 있어야 하는 "확인 권고" 신호.
 * 실물 예: "다만 가려움이 심해 잠을 설치거나 오래간다면 병원에서 확인해 보시는 편이 좋습니다."
 */
export const MEDICAL_REFERRAL_HINTS = ['병원', '진료', '의사', '전문의', '진료과']

/**
 * 재무 주제의 "공식 기관 확인" 신호.
 * 실물 예: "실제 수령액은 국민연금공단에서 본인 기준으로 확인하는 것이 정확합니다."
 */
export const MONEY_REFERRAL_HINTS = ['공단', '공식', '기관', '센터', '문의', '상담']

/** 금액·수익률을 단정하는 표현. 재무 주제면 forbiddenPatterns 에 있어야 한다 */
export const MONEY_ASSERTION_SEEDS = ['무조건', '확정 수익', '보장됩니다', '이득입니다', '손해입니다']

// ─────────────────────────────────────────────────────────
// 게이트
// ─────────────────────────────────────────────────────────

/** 사람 승인 없이 fetch 로 넘어가려면 이 여섯을 전부 통과해야 한다 */
export const GATES = {
  G1: '필수 섹션 6개가 있고 TODO 가 남아 있지 않다',
  G2: 'brief 의 5문장이 review.riskSentences 와 문자열까지 같다',
  G3: '5문장에 공통 금지어·의료 단정·forbiddenPatterns 가 하나도 없다',
  G4: 'forbiddenPatterns 가 비어 있지 않다',
  G5: 'riskLevel 을 알 수 있고 HIGH 가 아니다 (HIGH 는 창업자 검수 → HOLD)',
  G6: '큐가 위험하다고 한 주제는 review.risk 도 위험하고, 확인 권고 문장이 있다',
  G7: 'review.ts 가 ReviewData 스키마를 만족한다 (필수 필드 · 스키마 외 필드 0)',
}

/**
 * ReviewData 스키마.
 *
 * 🔴 정본은 drafts/magazine/_template/review.ts 의 타입이다.
 *    여기 목록이 그것과 어긋나면 auto-brief 는 통과시키는데 tsc 는 막는다 —
 *    실제로 그 상태로 2026-08-27 회차 산출물 3건이 빌드를 깨뜨렸다.
 *    타입을 고치면 이 목록도 같이 고친다.
 */
const REVIEW_REQUIRED = ['slug', 'summary', 'risk', 'factsToVerify', 'preparedAt', 'preparedBy', 'notes']
const REVIEW_OPTIONAL = ['riskSentences', 'forbiddenPatterns', 'hero']

/**
 * review 객체가 ReviewData 로 쓸 수 있는 모양인가.
 *
 * 🔴 빈 배열·빈 문자열을 통과시키지 않는다. 형식만 맞추면 tsc 는 지나가지만
 *    창업자가 볼 것이 없는 review 가 남는다 — 검수 데이터의 존재 이유가 사라진다.
 */
export function verifyReviewShape(review) {
  const problems = []
  if (!review || typeof review !== 'object') return ['review 객체를 읽지 못했다']

  for (const key of REVIEW_REQUIRED) {
    if (!(key in review)) problems.push(`필수 필드가 없다: ${key}`)
  }

  const known = new Set([...REVIEW_REQUIRED, ...REVIEW_OPTIONAL])
  for (const key of Object.keys(review)) {
    if (!known.has(key)) problems.push(`스키마에 없는 필드다: ${key}`)
  }

  if ('summary' in review) {
    const v = review.summary
    if (!Array.isArray(v) || v.length !== RISK_SENTENCE_COUNT) {
      problems.push(`summary 는 ${RISK_SENTENCE_COUNT}줄이어야 한다 (지금 ${Array.isArray(v) ? v.length : typeof v})`)
    } else if (v.some((x) => typeof x !== 'string' || !x.trim())) {
      problems.push('summary 에 빈 줄이 있다')
    }
  }

  if ('factsToVerify' in review) {
    const v = review.factsToVerify
    if (!Array.isArray(v) || v.length === 0) problems.push('factsToVerify 가 비어 있다')
    else if (v.some((x) => typeof x !== 'string' || !x.trim())) problems.push('factsToVerify 에 빈 항목이 있다')
  }

  if ('preparedAt' in review && !/^\d{4}-\d{2}-\d{2}$/.test(String(review.preparedAt ?? ''))) {
    problems.push(`preparedAt 이 YYYY-MM-DD 가 아니다: ${review.preparedAt}`)
  }

  if ('preparedBy' in review && !['Claude 채팅', 'Claude Code'].includes(review.preparedBy)) {
    problems.push(`preparedBy 가 허용 값이 아니다: ${review.preparedBy}`)
  }

  if ('notes' in review && (typeof review.notes !== 'string' || !review.notes.trim())) {
    problems.push('notes 가 비어 있다')
  }

  // 🔴 hero 는 **모양만** 본다. alt 의 내용 규칙(길이·"…여성" 종결·금지 호칭)은
  //    `lib/magazine-hero-brief.mjs` 가 정본이다 — 여기에 다시 적으면 두 벌이 된다.
  //    (G7 은 "tsc 가 막을 모양인가" 를 보는 자리다)
  if ('hero' in review) {
    const h = review.hero
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
      problems.push('hero 가 객체가 아니다')
    } else {
      if (typeof h.alt !== 'string' || !h.alt.trim()) problems.push('hero.alt 가 비어 있다')
      if ('scene' in h && (typeof h.scene !== 'string' || !h.scene.trim())) problems.push('hero.scene 이 비어 있다')
      for (const key of Object.keys(h)) {
        if (!['alt', 'scene'].includes(key)) problems.push(`hero 에 스키마에 없는 필드다: ${key}`)
      }
    }
  }

  return problems
}

/** brief.md 본문에서 "반드시 그대로 넣을 문장" 5개를 뽑는다. runner 와 같은 방식이다 */
export function extractMarkers(briefText) {
  const block = String(briefText ?? '').split(MARKER_HEADING)[1]
  if (!block) return []
  return [...block.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, RISK_SENTENCE_COUNT)
}

/** brief.md 에 그 h2 가 있는가 */
function hasSection(briefText, name) {
  return new RegExp(`^##\\s+${name}`, 'm').test(briefText)
}

/**
 * brief + review 짝을 판정한다. **파일을 읽지 않는다** — 문자열만 받는다.
 * 생성기도 verifier 도 같은 함수를 쓴다. 판정이 두 벌이 되면 갈라진다.
 *
 * @param {object} p
 * @param {string} p.briefText          brief.md 전문
 * @param {object|null} p.review        review.ts 의 REVIEW 객체
 * @param {object|null} p.queueItem     topic-queue 항목 (riskLevel 정본)
 * @returns {{ok: boolean, results: Array<{gate: string, ok: boolean, detail: string}>}}
 */
export function verifyBrief({ briefText, review, queueItem }) {
  const results = []
  const add = (gate, ok, detail) => results.push({ gate, ok, detail })

  // G7 — 스키마부터 본다. 여기서 걸리면 파일로 써도 tsc 가 막는다
  const shapeProblems = verifyReviewShape(review)
  add('G7', shapeProblems.length === 0, shapeProblems.length ? shapeProblems.join(' · ') : 'ReviewData 스키마 만족')

  const text = String(briefText ?? '')
  const markers = extractMarkers(text)
  const riskSentences = Array.isArray(review?.riskSentences) ? review.riskSentences : []
  const patterns = Array.isArray(review?.forbiddenPatterns) ? review.forbiddenPatterns : []

  // 등급 정본은 큐다. 큐에 없으면 review.risk.medical 로 대체한다 (batch-qa 와 같은 규칙)
  const riskLevel = queueItem?.riskLevel ?? review?.risk?.medical ?? null
  const medical = review?.risk?.medical ?? 'NONE'
  const money = review?.risk?.money ?? 'NONE'

  // ── G5 먼저 본다. HIGH 면 나머지를 볼 이유가 없다 ──
  if (!riskLevel || !KNOWN_RISK_LEVELS.includes(riskLevel)) {
    add('G5', false, `등급을 알 수 없다 (${riskLevel ?? '없음'}) — 큐에도 review.risk 에도 쓸 값이 없다`)
  } else if (BLOCKED_RISK_LEVELS.includes(riskLevel)) {
    add('G5', false, `riskLevel=${riskLevel} — 창업자 검수 대상이다. auto-brief 하지 않는다 (HOLD)`)
  } else {
    add('G5', true, `riskLevel=${riskLevel}`)
  }

  // ── G1 섹션 · TODO ──
  const missingSections = REQUIRED_SECTIONS.filter((s) => !hasSection(text, s))
  const leftoverTodos = TODO_MARKERS.filter((m) => text.includes(m))
  add(
    'G1',
    missingSections.length === 0 && leftoverTodos.length === 0,
    missingSections.length
      ? `빠진 섹션: ${missingSections.join(', ')}`
      : leftoverTodos.length
        ? `TODO 가 남아 있다: ${leftoverTodos.join(', ')}`
        : `섹션 ${REQUIRED_SECTIONS.length}개 · TODO 0`,
  )

  // ── G2 brief 5문장 == review.riskSentences ──
  const needSentences = RISK_SENTENCE_REQUIRED_LEVELS.includes(riskLevel)
  if (!needSentences && markers.length === 0 && riskSentences.length === 0) {
    add('G2', true, `riskLevel=${riskLevel} — riskSentences 선택. 양쪽 다 없다`)
  } else if (markers.length !== RISK_SENTENCE_COUNT) {
    add('G2', false, `brief 마커 ${markers.length}개 (필요 ${RISK_SENTENCE_COUNT}개)`)
  } else if (riskSentences.length !== RISK_SENTENCE_COUNT) {
    add('G2', false, `review.riskSentences ${riskSentences.length}개 (필요 ${RISK_SENTENCE_COUNT}개)`)
  } else {
    const diff = markers.map((m, i) => (m === riskSentences[i] ? null : i + 1)).filter(Boolean)
    add('G2', diff.length === 0, diff.length ? `${diff.join(',')}번 문장이 다르다` : '5/5 일치')
  }

  // ── G3 교차검사 — 7-D-13-C 재발 방지 ──
  const crossHits = []
  for (const s of markers) {
    for (const w of [...BANNED_WORDS, ...MEDICAL_ASSERTIONS]) {
      if (s.includes(w)) crossHits.push(`"${w}" (공통 금지어)`)
    }
    for (const p of patterns) {
      if (p && s.includes(p)) crossHits.push(`"${p}" (forbiddenPatterns)`)
    }
  }
  add(
    'G3',
    crossHits.length === 0,
    crossHits.length ? `넣으라는 문장에 금지어가 있다: ${[...new Set(crossHits)].join(', ')}` : '충돌 0',
  )

  // ── G4 forbiddenPatterns ──
  add(
    'G4',
    patterns.length > 0,
    patterns.length ? `${patterns.length}개` : 'forbiddenPatterns 가 비었다 — batch-qa ⑩ 이 막는다',
  )

  // ── G6 의료 · 재무 확인 권고 ──
  //
  // 🔴 review.risk 만 보면 자기 채점이 된다.
  //    review.ts 는 auto-brief 가 만든 파일이다. 생성기가 risk 를 NONE 으로 적으면
  //    이 게이트가 통째로 비껴간다. 실제로 첫 dry-run 에서 큐가 MEDIUM 이라고 한
  //    항목의 review 가 medical=NONE·money=NONE 으로 나와 G6 를 그냥 통과했다.
  //
  //    그래서 **큐를 먼저 본다.** 큐가 MEDIUM 이상이라고 하면 review 의 축 중
  //    최소 하나가 MEDIUM 이상이어야 한다. 위험을 스스로 낮춰 적는 길을 막는다.
  const needMedical = medical === 'MEDIUM' || medical === 'HIGH'
  const needMoney = money === 'MEDIUM' || money === 'HIGH'
  const queueSaysRisky = RISK_SENTENCE_REQUIRED_LEVELS.includes(queueItem?.riskLevel)

  if (queueSaysRisky && !needMedical && !needMoney) {
    add(
      'G6',
      false,
      `큐는 riskLevel=${queueItem.riskLevel} 인데 review.risk 가 전부 낮다 ` +
        `(medical=${medical} · money=${money}) — 위험 축을 하나는 MEDIUM 이상으로 적는다`,
    )
  } else if (!needMedical && !needMoney) {
    add('G6', true, `medical=${medical} · money=${money} — 추가 요구 없음`)
  } else {
    const miss = []
    if (needMedical && !markers.some((s) => MEDICAL_REFERRAL_HINTS.some((h) => s.includes(h)))) {
      miss.push(`의료(${medical}): 진료 확인 권고 문장 없음`)
    }
    if (needMoney && !markers.some((s) => MONEY_REFERRAL_HINTS.some((h) => s.includes(h)))) {
      miss.push(`재무(${money}): 공식 기관 확인 권고 문장 없음`)
    }
    add('G6', miss.length === 0, miss.length ? miss.join(' · ') : `medical=${medical} · money=${money} 권고 문장 있음`)
  }

  return { ok: results.every((r) => r.ok), results }
}
