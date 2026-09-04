#!/usr/bin/env tsx
/**
 * Raw 공급망 규칙 fixture — 🔴 DB · 네트워크 · 파일 없음
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md
 *
 * 🔴 **여기서 막는 사고**
 *    ① `--batch=50` 이 Micro Seed 레인으로 새어 Sheet 에 50행이 꽂히는 것
 *    ② raw-only 가 Candidate 를 만들어 승인 게이트를 우회하는 것
 *    ③ 스위치 하나(`--apply`)만으로 write 가 일어나는 것
 *    ④ 자동 선별이 정치·실명 글을 열어 생성기 재료로 넣는 것
 *
 * 사용법: npx tsx scripts/micro-seed-supply-check.mts
 */
import { readFileSync } from 'node:fs'
import {
  planSupplyMode, violatesSupplyInvariant, planAutoFetch, judgeAutoHold,
  judgeSourceSite, isNaverCafeSource, cafeIdOf, slotQuotaOf,
  AUTO_FETCH_MAX, AUTO_MIN_SCORE, AUTO_SKIP_LIST_FLAGS, AUTO_HOLD_DETAIL_FLAGS,
  RAW_ONLY_BATCH_MAX, SHEET_LANE_LIMIT, SHEET_LANE_SOURCE_SITE, NAVERCAFE_PREFIX, SLOT_QUOTA,
  type SupplyModeInput,
} from './lib/micro-seed-supply.mjs'
import { computeDedupKey } from './lib/micro-seed-82cook.mjs'
import { assessCandidate, DETAIL_ONLY_FLAGS } from './lib/micro-seed-quality.mjs'

let failed = 0
const ok = (label: string) => console.log(`  ✅ ${label}`)
const bad = (label: string, detail: string) => {
  console.error(`  ❌ ${label}\n     ${detail}`)
  failed += 1
}
const check = (label: string, cond: boolean, detail = '') => (cond ? ok(label) : bad(label, detail))

const mode = (o: Partial<SupplyModeInput>) =>
  planSupplyMode({ apply: false, limit: null, rawOnly: false, batch: null, ...o })

console.log('\nRaw 공급망 규칙 fixture\n')

// ─────────────────────────────────────────────────────────
console.log('① 스위치 두 개 원칙 — 하나로는 아무것도 쓰이지 않는다')
// ─────────────────────────────────────────────────────────
check('인자 없음 → dry-run', mode({}).mode === 'dry-run')
check('--apply 만 → dry-run', mode({ apply: true }).mode === 'dry-run')
check('--limit=1 만 → dry-run', mode({ limit: 1 }).mode === 'dry-run')
check('--raw-only 만 → dry-run', mode({ rawOnly: true }).mode === 'dry-run')
check('--raw-only --batch=10 (apply 없음) → dry-run', mode({ rawOnly: true, batch: 10 }).mode === 'dry-run')
check(
  '--apply --raw-only (batch 없음) → dry-run',
  mode({ apply: true, rawOnly: true }).mode === 'dry-run',
)
for (const m of [mode({}), mode({ apply: true }), mode({ limit: 1 }), mode({ rawOnly: true })]) {
  check(
    `dry-run 은 write 가 전부 false (${m.mode})`,
    !m.writes.rawContent && !m.writes.candidate && !m.writes.sheet && m.take === 0,
    JSON.stringify(m.writes),
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n② Micro Seed 레인 — Sheet 승인 게이트는 여전히 1건이다')
// ─────────────────────────────────────────────────────────
const ms = mode({ apply: true, limit: 1 })
check('--apply --limit=1 → micro-seed', ms.mode === 'micro-seed')
check(`take === ${SHEET_LANE_LIMIT}`, ms.take === SHEET_LANE_LIMIT, String(ms.take))
check('RawContent + Candidate + Sheet 셋 다 쓴다', ms.writes.rawContent && ms.writes.candidate && ms.writes.sheet)
check('--apply --limit=5 → dry-run (상향 불가)', mode({ apply: true, limit: 5 }).mode === 'dry-run')
check('--apply --limit=50 → dry-run', mode({ apply: true, limit: 50 }).mode === 'dry-run')
check(
  '🔴 --batch 는 Micro Seed 레인으로 새지 않는다 (fatal)',
  mode({ apply: true, batch: 50 }).fatal !== null,
  '배치가 Sheet 레인에서 허용되면 승인 게이트에 50행이 꽂힌다',
)

// ─────────────────────────────────────────────────────────
console.log('\n③ raw-only 레인 — Candidate 도 Sheet 도 만들지 않는다')
// ─────────────────────────────────────────────────────────
const ro = mode({ apply: true, rawOnly: true, batch: 30 })
check('--apply --raw-only --batch=30 → raw-only', ro.mode === 'raw-only')
check('take === 30', ro.take === 30, String(ro.take))
check('RawContent 만 쓴다', ro.writes.rawContent)
check('🔴 Candidate 를 만들지 않는다', !ro.writes.candidate)
check('🔴 Sheet 를 쓰지 않는다', !ro.writes.sheet)
check(
  `--batch=${RAW_ONLY_BATCH_MAX + 1} → fatal (상한 초과)`,
  mode({ apply: true, rawOnly: true, batch: RAW_ONLY_BATCH_MAX + 1 }).fatal !== null,
)
check('--batch=0 → fatal', mode({ apply: true, rawOnly: true, batch: 0 }).fatal !== null)
check('--batch=1.5 → fatal', mode({ apply: true, rawOnly: true, batch: 1.5 }).fatal !== null)
check(
  '🔴 --raw-only --limit 섞으면 fatal',
  mode({ apply: true, rawOnly: true, limit: 1 }).fatal !== null,
  '두 레인의 상한을 같은 이름으로 부르면 어느 문이 열리는지 모호해진다',
)

// ─────────────────────────────────────────────────────────
console.log('\n④ 불변식 — 어떤 조합에서도 깨지지 않는다')
// ─────────────────────────────────────────────────────────
{
  const bools = [false, true]
  const limits = [null, 1, 5, 50]
  const batches = [null, 0, 1, 30, 50, 51]
  let n = 0
  let violated = 0
  for (const apply of bools) for (const rawOnly of bools) for (const limit of limits) for (const batch of batches) {
    const p = planSupplyMode({ apply, limit, rawOnly, batch })
    n += 1
    if (p.fatal !== null) continue // fatal 은 실행되지 않으므로 불변식 대상 밖이다
    if (violatesSupplyInvariant(p)) {
      violated += 1
      bad('불변식 위반', JSON.stringify({ apply, limit, rawOnly, batch, plan: p }))
    }
  }
  check(`전 조합 ${n}가지에서 불변식 위반 0`, violated === 0, `${violated}건 위반`)
}
check(
  '🔴 Sheet 를 쓰면서 Candidate 를 안 만드는 계획은 불변식 위반으로 잡힌다',
  violatesSupplyInvariant({ mode: 'raw-only', take: 1, writes: { rawContent: true, candidate: false, sheet: true }, notes: [], fatal: null }),
)
check(
  '🔴 dry-run 인데 write 가 있으면 불변식 위반으로 잡힌다',
  violatesSupplyInvariant({ mode: 'dry-run', take: 0, writes: { rawContent: true, candidate: false, sheet: false }, notes: [], fatal: null }),
)

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 자동 선별 — 자동 경로에는 사람이 없다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    { sourceArticleId: 'a1', score: 90, flags: ['targetLikely'] },
    { sourceArticleId: 'a2', score: 80, flags: ['targetLikely', 'politicalOrPublicFigure'] },
    { sourceArticleId: 'a3', score: 70, flags: ['personalExperienceLikely'] },
    { sourceArticleId: 'a4', score: 10, flags: [] },
    { sourceArticleId: 'a5', score: 60, flags: ['politicalTopicLikely'] },
    { sourceArticleId: 'a6', score: 50, flags: [], alreadyInVault: true },
  ]
  const p = planAutoFetch(rows)
  check('🔴 정치·실명은 자동으로 열지 않는다', !p.picked.includes('a2'))
  check('🔴 정치 주제도 자동으로 열지 않는다', !p.picked.includes('a5'))
  check(`점수 ${AUTO_MIN_SCORE} 미만은 열지 않는다`, !p.picked.includes('a4'))
  check('이미 Vault 에 있으면 열지 않는다', !p.picked.includes('a6'))
  check('나머지는 점수 순으로 열린다', p.picked.join(',') === 'a1,a3', p.picked.join(','))
  check(
    '🔴 제외는 버려지지 않고 사유와 함께 남는다',
    p.skipped.length === 4 && p.skipped.every((s) => s.detail.length > 0),
    JSON.stringify(p.skipped),
  )
  // a2·a5 가 둘 다 SKIP_FLAG 라 제외 4건의 사유는 3종이다
  check(
    '제외 사유가 전부 코드로 분류된다',
    [...new Set(p.skipped.map((s) => s.reason))].sort().join(',') === 'ALREADY_IN_VAULT,BELOW_MIN_SCORE,SKIP_FLAG',
    JSON.stringify(p.skipped.map((s) => s.reason)),
  )
  check(
    '🔴 상세 플래그(medicalOrAdLikely)로는 목록 단계에서 거르지 않는다',
    planAutoFetch([{ sourceArticleId: 'm1', score: 90, flags: ['medicalOrAdLikely'] }]).picked.includes('m1'),
    '목록 단계에 없는 플래그를 여기서 막는 척하면 가드가 무력해진다 — 보류는 적재 단계가 한다',
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-B 🔴 구조 가드 — 목록 단계에 없는 플래그에 의존하지 않는다 (PR-S2-a)')
// ─────────────────────────────────────────────────────────
//
// 🔴 2026-09-03 실측 결함의 재발 방지다.
//    AUTO_SKIP_LIST_FLAGS 에 이름을 적는 것만으로는 가드가 되지 않는다.
//    **제목 하나로 실제 발화하는지**를 fixture 가 증명해야 한다.
{
  for (const f of AUTO_SKIP_LIST_FLAGS) {
    check(
      `[구조] ${f} 는 DETAIL_ONLY_FLAGS 가 아니다`,
      !DETAIL_ONLY_FLAGS.includes(f as never),
      '본문을 읽어야 붙는 플래그를 목록 단계 제외 목록에 두면 아무것도 막지 못한다',
    )
  }
  // 🔴 이름만이 아니라 **발화 증명**을 요구한다. 제목만 주고 실제로 붙는지 본다
  const titleOnly = (title: string) =>
    assessCandidate({ originalTitle: title, rawBody: '', sourceCommentCount: 3 }).flags as readonly string[]

  check(
    '[구조·증명] politicalOrPublicFigure 는 제목만으로 발화한다',
    titleOnly('이재명 대통령 발언 어떻게 보세요').includes('politicalOrPublicFigure'),
  )
  check(
    '[구조·증명] politicalTopicLikely 는 제목만으로 발화한다',
    titleOnly('나라별 극우의 특징').includes('politicalTopicLikely'),
  )
  check(
    '🔴 [구조] medicalOrAdLikely 는 목록 단계 제외 목록에 없다',
    !(AUTO_SKIP_LIST_FLAGS as readonly string[]).includes('medicalOrAdLikely'),
    '제목만으로 (시설|시술)+가격 조합이 성립하는 일은 사실상 없다 — 무력한 가드가 된다',
  )
  check(
    '🔴 [구조] 두 목록이 겹치지 않는다',
    (AUTO_SKIP_LIST_FLAGS as readonly string[]).every((f) => !(AUTO_HOLD_DETAIL_FLAGS as readonly string[]).includes(f)),
    '같은 플래그가 두 단계에 있으면 어느 쪽이 막았는지 알 수 없다',
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-C 자동 보류 — 상세를 연 뒤, 적재 전에 (PR-S2-a)')
// ─────────────────────────────────────────────────────────
{
  check(
    '🔴 의료·광고성은 자동 적재에서 보류된다',
    judgeAutoHold({ sourceArticleId: 'h1', flags: ['medicalOrAdLikely', 'highEngagement'] }).hold,
  )
  check(
    '🔴 본문 실명도 보류된다',
    judgeAutoHold({ sourceArticleId: 'h2', flags: ['publicFigureMention'] }).hold,
  )
  check(
    '깨끗한 글은 보류하지 않는다',
    !judgeAutoHold({ sourceArticleId: 'h3', flags: ['targetLikely', 'personalExperienceLikely'] }).hold,
  )
  check(
    '🔴 사람이 지목하면 보류하지 않는다 (자동 경로 한정)',
    !judgeAutoHold({ sourceArticleId: 'h4', flags: ['medicalOrAdLikely'], humanDesignated: true }).hold,
    '--sourceArticleId 는 사람의 명시적 판단이다. 코드가 뒤집지 않는다',
  )
  const v = judgeAutoHold({ sourceArticleId: 'h5', flags: ['medicalOrAdLikely'] })
  check(
    '보류 사유와 플래그가 남는다',
    v.hold && v.flags.join(',') === 'medicalOrAdLikely' && v.detail.includes('원자료는 남는다'),
    JSON.stringify(v),
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-D 실측 회귀 — 2026-09-03 live 수집 3건')
// ─────────────────────────────────────────────────────────
{
  const assess = (title: string, body: string) =>
    assessCandidate({ originalTitle: title, rawBody: body, sourceCommentCount: 8 })

  // ① 4234890 — 정신과약. 제목만으로는 안 잡히고, 본문을 읽으면 보류돼야 한다
  const t1 = assess('불안으로 정신과약 드셔본 분 계신가요', '')
  check(
    '4234890 정신과약 — 목록 단계에서는 자동 제외 대상이 아니다 (실측 재현)',
    !AUTO_SKIP_LIST_FLAGS.some((f) => (t1.flags as readonly string[]).includes(f)),
    JSON.stringify(t1.flags),
  )
  check(
    '🔴 4234890 — 상세 플래그가 붙으면 자동 적재에서 보류된다',
    judgeAutoHold({ sourceArticleId: '4234890', flags: ['medicalOrAdLikely', 'highEngagement'] }).hold,
  )

  // ② 4234897 — 뇌MRI. 같은 구조
  check(
    '🔴 4234897 뇌MRI — 자동 적재에서 보류된다',
    judgeAutoHold({ sourceArticleId: '4234897', flags: ['medicalOrAdLikely'] }).hold,
  )

  // ③ 4234894 — 나라별 극우의 특징. 🔴 이번엔 목록 단계에서 잡혀야 한다
  const t3 = assess('나라별 극우의 특징', '')
  check(
    '🔴 4234894 극우 — politicalTopicLikely 가 붙는다',
    (t3.flags as readonly string[]).includes('politicalTopicLikely'),
    JSON.stringify(t3.flags),
  )
  check(
    '🔴 4234894 — 공인·실명 플래그와 분리돼 있다',
    !(t3.flags as readonly string[]).includes('politicalOrPublicFigure'),
    '실명이 없는데 공인 플래그가 붙으면 두 축이 섞인 것이다',
  )
  check(
    '🔴 4234894 — 목록 단계 자동 선별에서 빠진다',
    !planAutoFetch([{ sourceArticleId: '4234894', score: 90, flags: [...t3.flags] }]).picked.includes('4234894'),
  )

  // 과차단 회귀 — 정상 생활글이 걸리면 안 된다
  const safe = [
    '작년 은퇴한 남편 건보료 궁금해요',
    '기미 어째야 하나요',
    '서울 나이들어 살 동네 추천해주세요.',
    '고2딸',
    '아파트 외벽 보수공사 하는데 시끄럽네요',
    '요즘 애들 진보한 게 눈에 보여요',
  ]
  for (const s of safe) {
    check(
      `[과차단] "${s.slice(0, 18)}" 에 정치 주제 플래그가 안 붙는다`,
      !(assess(s, '').flags as readonly string[]).includes('politicalTopicLikely'),
    )
  }

  const expandedPolitics = [
    '비상계엄 포고령 봤어요',
    '김건희특검 채상병특검 뉴스',
    '김용현 노상원 여인형 곽종근',
    '한덕수 우원식 오세훈 홍준표',
    '좌빨 수꼴 국짐 대깨문',
    '친문 비명 팬덤정치',
    '도이치모터스 주가조작 명품백',
    '필리버스터 패스트트랙 법사위',
    '지방선거 리얼미터 NBS',
    '더불어민주연합 국민의미래',
    '방송3법 노란봉투법 의료대란',
    '한미동맹 사드 대북전단',
    '선관위 방통위 뉴스공장',
    '광화문집회 단식농성',
  ]
  for (const s of expandedPolitics) {
    check(
      `[정치 확장] "${s.slice(0, 18)}" 에 politicalTopicLikely 가 붙는다`,
      (assess(s, '').flags as readonly string[]).includes('politicalTopicLikely'),
    )
  }

  const politicalOverblockSafe = [
    '미리 감사드립니다',
    '어머니께 옷 사드릴까요',
    '반장 선거 준비물',
    '동대표 선거 안내',
  ]
  for (const s of politicalOverblockSafe) {
    check(
      `[정치 과차단] "${s}" 는 통과한다`,
      !(assess(s, '').flags as readonly string[]).includes('politicalTopicLikely'),
    )
  }
}
{
  const many = Array.from({ length: AUTO_FETCH_MAX + 15 }, (_, i) => ({
    sourceArticleId: `b${String(i).padStart(3, '0')}`,
    score: 100 - i,
    flags: ['targetLikely'],
  }))
  const p = planAutoFetch(many)
  check(`한 실행 상한 ${AUTO_FETCH_MAX}건을 넘지 않는다`, p.picked.length === AUTO_FETCH_MAX, String(p.picked.length))
  check('상한 초과분은 OVER_MAX 로 남는다', p.skipped.every((s) => s.reason === 'OVER_MAX'))
  const p10 = planAutoFetch(many, { max: 10 })
  check('--auto-max 로 더 줄일 수 있다', p10.picked.length === 10, String(p10.picked.length))
}
check('같은 입력이면 같은 결과다 (재현성)', (() => {
  const rows = [
    { sourceArticleId: 'z2', score: 50, flags: [] },
    { sourceArticleId: 'z1', score: 50, flags: [] },
  ]
  return planAutoFetch(rows).picked.join(',') === planAutoFetch(rows).picked.join(',')
})())

// ─────────────────────────────────────────────────────────
console.log('\n⑤-E sourceSite 계약 — 82cook 과 네이버는 양대 주요 공급망 (PR-S2-b-1)')
// ─────────────────────────────────────────────────────────
{
  // ── 형태 판정 ──
  check('navercafe:remonterrace 는 네이버 소스다', isNaverCafeSource('navercafe:remonterrace'))
  check('navercafe:wgang 도 마찬가지', isNaverCafeSource('navercafe:wgang'))
  check('cafeId 를 뽑아낸다', cafeIdOf('navercafe:remonterrace') === 'remonterrace')
  check('82cook 은 네이버가 아니다', !isNaverCafeSource('82cook'))
  check('prefix 만 있으면 안 된다', !isNaverCafeSource('navercafe:'))
  check('🔴 경로가 붙은 형태는 거부한다', !isNaverCafeSource('navercafe:a/b'))
  check('🔴 공백이 든 형태는 거부한다', !isNaverCafeSource('navercafe:a b'))
  check('cafeIdOf 는 형태가 아니면 null', cafeIdOf('82cook') === null && cafeIdOf('navercafe:') === null)

  // ── 🔴 레인별 허용 — 양방향 고정 ──
  check('raw-only 는 82cook 을 받는다', judgeSourceSite('82cook', 'raw-only').ok)
  check('🔴 raw-only 는 navercafe:* 를 받는다', judgeSourceSite('navercafe:remonterrace', 'raw-only').ok)
  check('Micro Seed 레인은 82cook 을 받는다', judgeSourceSite('82cook', 'micro-seed').ok)
  {
    const v = judgeSourceSite('navercafe:remonterrace', 'micro-seed')
    check(
      '🔴 Micro Seed 레인은 navercafe:* 를 거부한다',
      !v.ok,
      '네이버가 Sheet 승인 게이트를 거쳐 원문 그대로 발행되면 안 된다 (헌법 §10-5)',
    )
    check(
      '거부 사유가 대안을 알려준다',
      !v.ok && v.reason.includes('raw-only'),
      !v.ok ? v.reason : '',
    )
  }
  for (const lane of ['raw-only', 'micro-seed'] as const) {
    check(
      `[${lane}] 🔴 모르는 소스는 거부한다`,
      !judgeSourceSite('dcinside', lane).ok && !judgeSourceSite('', lane).ok,
    )
    check(
      `[${lane}] 🔴 82cook 을 흉내낸 소스도 거부한다`,
      !judgeSourceSite('82cook.com', lane).ok && !judgeSourceSite('navercafe', lane).ok,
    )
  }

  // ── dedupKey 계약 — 카페가 다르면 키가 다르다 ──
  {
    const a = computeDedupKey('navercafe:remonterrace', '34783204')
    const b = computeDedupKey('navercafe:wgang', '34783204')
    check('dedupKey 는 sha256:{hex} 형태다', /^sha256:[0-9a-f]{64}$/.test(a), a.slice(0, 20))
    check(
      '🔴 같은 articleId 라도 카페가 다르면 dedupKey 가 다르다',
      a !== b,
      'cafeId 가 sourceSite 에 없으면 다른 카페 글이 조용히 SKIP 된다',
    )
    check(
      '같은 (카페, articleId) 는 항상 같은 키다',
      computeDedupKey('navercafe:remonterrace', '34783204') === a,
    )
    // 실측 행과의 정합 — Raw Vault 에 이미 있는 형태다
    check(
      '실측 행 형태와 계약이 맞는다 (navercafe:remonterrace · 34783204)',
      isNaverCafeSource('navercafe:remonterrace') && judgeSourceSite('navercafe:remonterrace', 'raw-only').ok,
    )
  }

  // ── 소스별 슬롯 quota ──
  check(`82cook 슬롯 quota ${SLOT_QUOTA['82cook']}`, slotQuotaOf('82cook') === SLOT_QUOTA['82cook'])
  check(`navercafe 슬롯 quota ${SLOT_QUOTA.navercafe}`, slotQuotaOf('navercafe:wgang') === SLOT_QUOTA.navercafe)
  check(
    '🔴 네이버 quota 가 82cook 보다 작다',
    SLOT_QUOTA.navercafe < SLOT_QUOTA['82cook'],
    '네이버는 계정이 막히고 그건 되돌릴 수 없다',
  )
  check(
    '🔴 모르는 소스는 가장 보수적인 quota 를 받는다',
    slotQuotaOf('dcinside') === Math.min(...Object.values(SLOT_QUOTA)),
  )
  check(
    '🔴 우나어의 카페당 80건을 그대로 쓰지 않는다',
    SLOT_QUOTA.navercafe <= 10,
    '한 소스를 세게 긁지 않는다 — 여러 카페·시간대에 얇게 분산한다',
  )

  // ── 🔴 sourceSite 는 운영 단위이지 주제 라벨이 아니다 ──
  {
    const src = readFileSync('scripts/lib/micro-seed-supply.mts', 'utf-8')
    check(
      '🔴 카페별 주제 고정 라벨이 코드에 없다',
      !/(갱년기|뷰티|은퇴|노후|미용|성형)\s*[:=]/.test(src),
      'sourceSite 로 주제를 고정하면 그 카페의 다른 글을 잘못 읽는다 — 주제 판정은 글 단위다',
    )
    check(
      '🔴 popular-sync 를 네이버로 이식하지 않았다',
      !/popular[-_]?sync/i.test(src),
      '우나어의 인기글 슬롯 개념은 82cook 수집 슬롯이 대신한다',
    )
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 소스 스캔 — 발행 경로가 이 레일에 없다')
// ─────────────────────────────────────────────────────────
{
  const importer = readFileSync('scripts/micro-seed-import-82cook-live.mts', 'utf-8')
  const collector = readFileSync('scripts/micro-seed-collect-82cook.mts', 'utf-8')

  // 🔴 Prisma data 블록만 본다. 읽기(findFirst)나 문구까지 잡으면 fixture 가 무뎌진다
  const dataBlocks = (src: string): string[] => {
    const out: string[] = []
    const re = /prisma\.(\w+)\.create|tx\.(\w+)\.create/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2] ?? '')
    return out
  }
  const created = dataBlocks(importer)
  check(
    '🔴 importer 가 만드는 테이블은 RawContent · Candidate 둘뿐이다',
    created.every((t) => t === 'microSeedRawContent' || t === 'microSeedCandidate'),
    created.join(','),
  )
  check('🔴 importer 에 post.create 가 없다', !/\.post\.create/.test(importer))
  check('🔴 importer 에 PENDING · PUBLISHED 전환이 없다', !/status:\s*'(PENDING|PUBLISHED)'/.test(importer))
  check('🔴 collector 는 prisma 를 import 하지 않는다', !/from '@prisma\/client'/.test(collector))
  check('collector 에 --auto 가 있다', /argv\.includes\('--auto'\)/.test(collector))
  check(
    '🔴 collector 가 자동 선별분도 robots 로 다시 본다',
    /autoBlocked/.test(collector) && /isPathAllowed/.test(collector),
  )
  check(
    '🔴 importer 가 모드 판정을 직접 다시 쓰지 않는다 (planSupplyMode 경유)',
    /planSupplyMode\(/.test(importer) && !/APPLY && LIMIT === 1/.test(importer),
  )
  check(
    '🔴 raw-only 경로가 Sheet 를 부르지 않는다',
    /if \(RAW_ONLY\) \{[\s\S]{0,900}?microSeedRawContent\.create/.test(importer)
      && !/if \(RAW_ONLY\) \{[\s\S]{0,900}?updateCandidateRow/.test(importer),
  )
  // ── PR-S2-a ──
  check(
    '🔴 importer 가 자동 보류를 raw-only 경로에서만 본다',
    /if \(RAW_ONLY\) \{[\s\S]{0,400}?judgeAutoHold\(/.test(importer),
    '자동 보류가 Micro Seed 레인까지 막으면 사람의 승인 경로를 코드가 대신 판단하는 것이 된다',
  )
  check(
    '🔴 importer 가 사람 지목을 자동 보류에서 제외한다',
    /humanDesignated: ONLY_ID === id/.test(importer),
  )
  check(
    '🔴 collector 가 목록 단계 제외에 상세 플래그를 쓰지 않는다',
    /AUTO_SKIP_LIST_FLAGS/.test(collector) && !/AUTO_SKIP_FLAGS\b/.test(collector),
  )
  check(
    '🔴 collector 가 보류 대상도 파일에 남긴다 (Q-1)',
    // writeJsonl(OUT, collected) 가 보류 필터 **앞**에 있어야 한다
    collector.indexOf('writeJsonl(OUT, collected)') < collector.indexOf('judgeAutoHold('),
    '보류를 파일에서 지우면 조용히 버려진 글이 된다',
  )
  // ── PR-S2-b-1 ──
  check(
    '🔴 importer 가 sourceSite 를 직접 비교하지 않는다 (judgeSourceSite 경유)',
    /judgeSourceSite\(/.test(importer) && !/row\.sourceSite !== SOURCE_SITE/.test(importer),
    '판정을 두 곳에 쓰면 갈라지고, 갈라지는 쪽이 네이버를 Sheet 레인에 넣는다',
  )
  check(
    '🔴 importer 가 의도한 레인으로 판정한다 (dry-run 이 거짓말하지 않는다)',
    /const INTENDED_LANE: SupplyMode = RAW_ONLY \? 'raw-only' : 'micro-seed'/.test(importer)
      && /judgeSourceSite\(row\.sourceSite, INTENDED_LANE\)/.test(importer),
    'PLAN.mode 로 판정하면 dry-run 에서 네이버가 통과한 것처럼 보인다',
  )
  check(
    '🔴 importer 에 82cook 하드 결합이 남아 있지 않다',
    // 🔴 주석이 아니라 **코드**만 본다. 앞선 fixture 들이 같은 실수를 반복했다 —
    //    "SOURCE_SITE 를 더 이상 쓰지 않는다" 는 주석 문장이 스캔에 걸렸다.
    !/^import \{[^}]*\bSOURCE_SITE\b/m.test(importer)
      && !/!==\s*SOURCE_SITE\b/.test(importer),
    '82cook lib 의 SOURCE_SITE 를 import 하지도, 직접 비교하지도 않는다',
  )
}

// ─────────────────────────────────────────────────────────
console.log(
  failed === 0
    ? `\n✅ 전부 통과 — 두 레인의 문이 서로 열리지 않는다.\n`
    : `\n❌ ${failed}건 실패\n`,
)
process.exit(failed === 0 ? 0 : 1)
