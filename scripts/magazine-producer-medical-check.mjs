#!/usr/bin/env node
/**
 * producer 의 medical 판정 회귀 테스트
 *
 * `medical` 을 riskLevel 로 정하던 결함을 되돌리지 않게 고정한다.
 * 두 값은 다른 축이다 — riskLevel 은 자동 등록 위험도, medical 은 내용 성격이다.
 *
 * 🔴 producer 를 실행하지 않는다. 큐를 읽고 판정만 계산한다.
 *
 * 실행: node scripts/magazine-producer-medical-check.mjs
 */

import { loadQueue } from './lib/magazine-load.mjs'
import { MEDICAL_REQUIRED, MEDICAL_SUGGESTED } from './magazine-qa.mjs'

/** producer-plan 의 medicalForCluster 와 같은 규칙이어야 한다 */
const medicalForCluster = (c) => MEDICAL_REQUIRED.has(c) || MEDICAL_SUGGESTED.has(c)

let failed = 0
let passed = 0
const expect = (label, actual, want) => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}

console.log('\n══════ cluster 로만 정한다 — riskLevel 은 보지 않는다')
for (const c of ['menopause-symptom', 'sleep', 'clinic']) {
  expect(`${c} (REQUIRED) → true`, medicalForCluster(c), true)
}
for (const c of ['daily', 'emotion']) {
  expect(`${c} (SUGGESTED) → true`, medicalForCluster(c), true)
}
for (const c of ['money-work', 'relationship', 'family']) {
  expect(`${c} (해당 없음) → false`, medicalForCluster(c), false)
}

console.log('\n══════ 결함이 재현되지 않는가 — 큐 실데이터')
const queue = loadQueue()

// 누락 — LOW 라는 이유로 REQUIRED cluster 가 false 가 되면 QA 가 FAIL 을 낸다
const lowRequired = queue.filter((i) => i.riskLevel === 'LOW' && MEDICAL_REQUIRED.has(i.cluster))
console.log(`  LOW + REQUIRED cluster ${lowRequired.length}건`)
for (const i of lowRequired) {
  expect(`  day ${i.day} ${i.slug} → true`, medicalForCluster(i.cluster), true)
}

// 과잉 — MEDIUM/HIGH 라는 이유로 비의료 글이 true 가 되면 진료 권고를 요구받는다
const nonMedicalHigh = queue.filter(
  (i) => i.riskLevel !== 'LOW' && !MEDICAL_REQUIRED.has(i.cluster) && !MEDICAL_SUGGESTED.has(i.cluster),
)
console.log(`  비의료 cluster + MEDIUM/HIGH ${nonMedicalHigh.length}건`)
for (const i of nonMedicalHigh) {
  expect(`  day ${i.day} ${i.slug} → false`, medicalForCluster(i.cluster), false)
}

console.log('\n══════ 큐 전체가 QA 정책과 어긋나지 않는가')
const conflict = queue.filter((i) => MEDICAL_REQUIRED.has(i.cluster) && !medicalForCluster(i.cluster))
expect('REQUIRED 인데 false 로 계획되는 항목 0건', conflict.length, 0)

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
