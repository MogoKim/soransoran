#!/usr/bin/env node
/**
 * register 승인 옵션 회귀 테스트 (§13.9)
 *
 * `--founder-approved` 가 **두 줄만** 완화하는지 본다. 이 테스트가 지키는 것은
 * "옵션을 켜도 나머지 검사는 그대로 돈다" 하나다. 여기가 무너지면 HIGH 가
 * hero 없이, 슬롯 충돌인 채로, 큐 밖에서 등록될 수 있다.
 *
 * 🔴 plan() 만 부른다. 파일을 쓰지 않는다 (--write 경로를 타지 않는다).
 *
 * 실행: node scripts/magazine-register-check.mjs
 */

import { plan } from './magazine-register.mjs'

let failed = 0
let passed = 0

function expect(label, actual, want) {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}

/** reasons 에 그 사유가 들어 있는가 */
const has = (p, frag) => p.reasons.some((r) => r.includes(frag))

console.log('\n══════ 플래그 없음 — 지금과 100% 같아야')
{
  const p = plan({ slug: 'which-clinic-menopause', publishAtInput: '2026-09-17' })
  expect('HIGH 는 BLOCKED', p.verdict, 'BLOCKED')
  expect('riskLevel 사유가 있다', has(p, 'riskLevel=HIGH'), true)
  expect('autoEligible 사유가 있다', has(p, 'autoEligible=false'), true)
  expect('checks.founderApproved 는 false', p.checks.founderApproved, false)
  expect('checks.approvalMode 는 null', p.checks.approvalMode, null)
}

console.log('\n══════ 플래그 있음 — 두 줄만 완화')
{
  const p = plan({ slug: 'which-clinic-menopause', publishAtInput: '2026-09-17', founderApproved: true })
  expect('READY', p.verdict, 'READY')
  expect('reasons 0건', p.reasons.length, 0)
  expect('riskLevel 사유가 사라졌다', has(p, 'riskLevel=HIGH'), false)
  expect('autoEligible 사유가 사라졌다', has(p, 'autoEligible=false'), false)
  expect('checks.approvalMode', p.checks.approvalMode, 'manual-high')
  expect('notes 에 승인 흔적이 남는다', p.notes.some((n) => n.includes('창업자 승인으로 통과')), true)
}

console.log('\n══════ 플래그가 있어도 막아야 하는 것')
{
  // 슬롯 — 2026-09-14 는 memory-worry-menopause 가 점유
  const slot = plan({ slug: 'which-clinic-menopause', publishAtInput: '2026-09-14', founderApproved: true })
  expect('슬롯 충돌은 BLOCKED', slot.verdict, 'BLOCKED')
  expect('  사유가 슬롯이다', has(slot, '슬롯이 이미 차 있다'), true)

  // 이미 등록됨 + 큐에 없음
  const dup = plan({ slug: 'memory-worry-menopause', publishAtInput: '2026-09-25', founderApproved: true })
  expect('이미 articles.ts 에 있으면 BLOCKED', dup.verdict, 'BLOCKED')
  expect('  사유가 중복이다', has(dup, '이미 articles.ts 에 있다'), true)
  expect('  큐에 없다는 사유도 함께', has(dup, 'topic-queue.ts 에 없다'), true)

  // hero 없음 + 패킷 없음
  const noHero = plan({ slug: 'checkup-items-50s', publishAtInput: '2026-09-22', founderApproved: true })
  expect('hero 없으면 BLOCKED', noHero.verdict, 'BLOCKED')
  expect('  사유가 hero 다', has(noHero, 'imageMode=REQUIRED 인데 hero 가 없다'), true)
  expect('  article-draft.ts 없음도 잡는다', has(noHero, 'article-draft.ts 가 없다'), true)
}

console.log('\n══════ LOW/MEDIUM 은 플래그 유무로 달라지지 않는다')
for (const slug of ['memory-worry-menopause', 'avoiding-gatherings', 'back-to-work-homemaker']) {
  const off = plan({ slug, publishAtInput: '2026-09-25' })
  const on = plan({ slug, publishAtInput: '2026-09-25', founderApproved: true })
  expect(`${slug} — verdict 동일`, off.verdict === on.verdict, true)
  expect(`${slug} — 사유 수 동일`, off.reasons.length === on.reasons.length, true)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
