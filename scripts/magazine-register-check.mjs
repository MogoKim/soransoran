#!/usr/bin/env node
/**
 * register 판정 회귀 테스트 — **M3-A 로 다시 썼다** (2026-09-24).
 *
 * 🔴 **옛 판은 `--founder-approved` 플래그가 주제였다.**
 *    "창업자가 건별로 켜면 HIGH 두 줄이 완화된다" 를 지키는 시험이었다.
 *    그 플래그는 M3-A 에서 **아무것도 열지 않는다** — 등급으로 막지 않으므로
 *    우회로가 필요했던 이유가 사라졌다. 그래서 다음 기대를 **폐기**했다:
 *      · 'BLOCKED' (HIGH 라서)
 *      · 'riskLevel 사유가 있다'
 *      · 'autoEligible 사유가 있다'
 *      · 'checks.founderApproved 는 false' · 'checks.approvalMode 는 manual-high'
 *      · 'notes 에 승인 흔적이 남는다'
 *
 * 🔴 대신 이것을 지킨다:
 *      ① 등급 사유가 **영영 나오지 않는다**
 *      ② 플래그를 켜도 결과가 **한 글자도 달라지지 않는다**
 *      ③ 슬롯·중복·큐·hero·삽입 위치 검사는 **그대로 막는다**
 *
 * 🔴 plan() 만 부른다. 파일을 쓰지 않는다.
 *
 * 실행: node scripts/magazine-register-check.mjs
 */

import { plan } from './magazine-register.mjs'
import { loadQueue } from './lib/magazine-load.mjs'
import { resolveValidationProfile } from './lib/magazine-validation-profile.mjs'

let failed = 0
let passed = 0
function expect(label, actual, want) {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}
const has = (p, frag) => p.reasons.some((r) => r.includes(frag))
const LEGACY = ['riskLevel=', 'autoEligible=false', '창업자 검수', '창업자 승인']

/** 🔴 slug 를 박지 않는다 — 등록되면 큐에서 빠진다 */
const queue = loadQueue()
const highInQueue = queue.find((i) => i.riskLevel === 'HIGH' && i.autoEligible !== true)
if (!highInQueue) { console.log('  🔴 큐에 HIGH 항목이 없다'); process.exit(1) }
const HIGH_SLUG = highInQueue.slug

console.log(`\n══════ ① 등급 사유는 영영 나오지 않는다 (${HIGH_SLUG})`)
{
  const p = plan({ slug: HIGH_SLUG, publishAtInput: '2027-01-05' })
  for (const frag of LEGACY) expect(`"${frag}" 사유가 없다`, has(p, frag), false)
  expect('프로필이 notes 에 남는다', p.notes.some((n) => n.startsWith('validationProfile=')), true)
  expect('  그 프로필은 어댑터 판정과 같다',
    p.notes.some((n) => n === `validationProfile=${resolveValidationProfile(highInQueue).profile}`), true)
  expect('checks.approvalMode 는 null', p.checks.approvalMode, null)
  expect('🔴 사람 승인 흔적이 없다', 'founderApproved' in p.checks, false)
}

console.log('\n══════ ② 플래그를 켜도 결과가 달라지지 않는다')
{
  const slugs = [HIGH_SLUG, ...queue.slice(0, 4).map((i) => i.slug)]
  for (const slug of [...new Set(slugs)]) {
    const off = plan({ slug, publishAtInput: '2027-01-05' })
    const on = plan({ slug, publishAtInput: '2027-01-05', founderApproved: true })
    expect(`${slug} — verdict 동일`, on.verdict, off.verdict)
    expect(`${slug} — 사유가 완전히 동일`, JSON.stringify(on.reasons), JSON.stringify(off.reasons))
    expect(`${slug} — notes 도 동일`, JSON.stringify(on.notes), JSON.stringify(off.notes))
  }
}

console.log('\n══════ ③ 나머지 관문은 그대로 막는다')
{
  const registered = plan({ slug: 'memory-worry-menopause', publishAtInput: '2027-01-06' })
  expect('이미 articles.ts 에 있으면 BLOCKED', registered.verdict, 'BLOCKED')
  expect('  사유가 중복이다', has(registered, '이미 articles.ts 에 있다'), true)
  expect('  큐에 없다는 사유도 함께', has(registered, 'topic-queue.ts 에 없다'), true)

  const nowhere = plan({ slug: 'no-such-slug-at-all', publishAtInput: '2027-01-07' })
  expect('큐에도 없고 원고도 없으면 BLOCKED', nowhere.verdict, 'BLOCKED')
  expect('  article-draft.ts 없음을 잡는다', has(nowhere, 'article-draft.ts 가 없다'), true)
  expect('  review.ts 없음도 잡는다', has(nowhere, 'review.ts 가 없다'), true)

  const badDate = plan({ slug: HIGH_SLUG, publishAtInput: '아무날' })
  expect('날짜가 이상하면 BLOCKED', badDate.verdict, 'BLOCKED')

  /** 🔴 이미 찬 날짜 — 슬롯 검사는 그대로 산다 */
  const { loadArticles } = await import('./lib/magazine-load.mjs')
  const takenDate = String(loadArticles()[0]?.publishAt ?? '').slice(0, 10)
  if (takenDate) {
    const slot = plan({ slug: HIGH_SLUG, publishAtInput: takenDate })
    expect('슬롯이 차 있으면 BLOCKED', slot.verdict, 'BLOCKED')
    expect('  사유가 슬롯이다', has(slot, '슬롯이 이미 차 있다'), true)
  }
}

console.log('\n══════ ④ 프로필을 못 정하면 막는다 (조용히 통과시키지 않는다)')
{
  const unresolved = queue.filter((i) => !resolveValidationProfile(i).profile)
  expect('🔴 실제 큐에는 판정 불가 행이 없다', unresolved.length, 0)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
