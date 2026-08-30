#!/usr/bin/env node
/**
 * 편집 검사 회귀 테스트 (M-AUTO-2)
 *
 * `scripts/lib/magazine-editorial.mjs` 의 D5 · D7 · D8 이 살아 있는지 본다.
 *
 * 🔴 **왜 합성 샘플인가.**
 *    등록 29건에 진료과 단정·치료 권유·비용 단정이 **하나도 없다.** 코퍼스가
 *    선을 지키고 있다는 뜻이라 반가운 일이지만, 규칙이 실제로 잡는지는
 *    확인할 수 없다. 양성 샘플이 없으면 규칙이 죽어도 아무도 모른다.
 *
 *    그래서 양성은 손으로 쓰고, **음성은 등록분 실문장을 그대로 가져온다.**
 *    음성 쪽이 코퍼스에서 오는 것이 중요하다 — 지어낸 문장으로 오탐을
 *    확인하면 실제 원고에서 나는 오탐을 놓친다.
 *
 * 실행: node scripts/magazine-editorial-check.mjs
 *      파일을 읽지도 쓰지도 않는다. 순수 함수만 부른다.
 */

import {
  checkDepartmentDirective,
  checkTreatmentDirective,
  checkCostClaim,
  checkCareAdvice,
} from './lib/magazine-editorial.mjs'

let failed = 0
let passed = 0

function expect(label, actual, want) {
  const ok = actual === want
  if (ok) passed += 1
  else failed += 1
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}

const section = (title) => console.log(`\n══════ ${title}`)

// ── D5 진료과 단정 ─────────────────────────────────────────

section('D5 양성 — 전부 FAIL 이어야')
for (const sentence of [
  '갱년기 증상이 있다면 산부인과에 가야 합니다.',
  '이런 경우에는 내분비내과가 정답입니다.',
  '먼저 가정의학과부터 가세요.',
  '증상이 여러 개라면 산부인과를 추천합니다.',
  '열감이 심하면 산부인과로 가시는 편이 낫습니다.',
  '우선 내과에 가시는 게 맞습니다.',
]) {
  expect(sentence, checkDepartmentDirective(sentence).level, 'FAIL')
}

section('D5 음성 — 등록분 실문장이다. 오탐 0 이어야')
for (const sentence of [
  // when-does-menopause-start — `가야 할지` 가 `가야 합니다` 로 뭉뚱그려지면 여기서 걸린다
  '무슨 과에 가야 할지 막막하다면 산부인과에서 먼저 상담하는 경우가 많습니다.',
  // memory-worry-menopause — which-clinic 이 따라야 할 형태다
  '어느 진료과로 가야 할지 모르겠다면 가까운 내과나 가정의학과에서 먼저 현재 겪는 변화를 이야기하고 안내를 받아도 됩니다.',
  '여성 탈모는 피부과나 가정의학과에서 먼저 이야기해보시면 방향을 잡을 수 있다고 이야기됩니다.',
  '무기력이 2주 이상 이어지고 잠·식욕·감정에 함께 변화가 있다면 정신건강의학과 진료를 받아보는 편이 좋습니다.',
  '몇 달이 지나도 잠이 오지 않고 마음이 무겁게 가라앉는다면, 한 번쯤 정신건강의학과 진료를 받아보는 것도 도움이 됩니다.',
  // walking-minutes-50s — "동안과" 의 '안과'. 어절 경계가 빠지면 여기서 걸린다
  '그래서 한 번에 몇 분을 채웠는가보다 걷는 동안과 걷고 난 뒤 몸이 어떤지를 함께 살펴보는 편이 자연스럽습니다.',
  // 우리가 쓰고 싶은 바로 그 문장. `정답` 을 단독으로 걸면 여기서 걸린다
  '어느 과가 정답이라고 말하기는 어렵습니다.',
  '어느 과를 고를지는 증상과 상황에 따라 다릅니다.',
]) {
  expect(sentence.slice(0, 52), checkDepartmentDirective(sentence).level, null)
}

// ── D7 치료 권유·만류 ──────────────────────────────────────

section('D7 양성 — 권유·만류 둘 다 FAIL 이어야')
for (const sentence of [
  '증상이 심하다면 호르몬 치료를 받으세요.',
  '갱년기에는 영양제를 드세요.',
  '호르몬 치료는 위험합니다.',
  '수면제는 피하세요.',
  '한약은 권하지 않습니다.',
  '이럴 때는 시술을 추천합니다.',
]) {
  expect(sentence, checkTreatmentDirective(sentence).level, 'FAIL')
}

section('D7 음성 — 상담으로 연결하는 서술은 통과해야')
for (const sentence of [
  '호르몬 치료를 받는 분들도 있고 그렇지 않은 분들도 있습니다.',
  '호르몬 치료가 어떤 경우에 쓰이는지는 진료에서 확인해 보시는 편이 좋습니다.',
  '영양제를 챙기는 분들이 늘었다고 이야기됩니다.',
  '수면제에 대해서는 의료진과 상담해 보세요.',
]) {
  expect(sentence.slice(0, 52), checkTreatmentDirective(sentence).level, null)
}

// ── D8 비용 단정 ───────────────────────────────────────────

const CLINIC = { cluster: 'clinic', medical: true }
const MONEY = { cluster: 'money-work', medical: false }

section('D8 양성 — clinic·medical 글에서 FAIL 이어야')
for (const sentence of [
  '검사 비용은 보통 3만 원 정도입니다.',
  '진료비는 1만 5천 원입니다.',
  '검사비가 10만 원 정도 듭니다.',
  '초진 진료비는 2만원입니다.',
]) {
  expect(sentence, checkCostClaim(sentence, CLINIC).level, 'FAIL')
}

section('D8 미발동 — money 축에는 걸지 않는다')
for (const sentence of [
  '퇴직금 3천만 원을 IRP에 넣으면 세액공제를 받을 수 있습니다.',
  '월 9만 원 정도를 납부하는 경우가 많습니다.',
  '건강보험료가 20만 원 나왔다는 이야기도 있습니다.',
]) {
  expect(sentence.slice(0, 52), checkCostClaim(sentence, MONEY).level, null)
}

section('D8 음성 — 숫자가 금액이 아니면 통과해야')
for (const sentence of [
  '증상이 6개월 이상 이어지는 경우도 있습니다.',
  '40대 후반부터 나타나는 변화입니다.',
  '원인을 하나로 말하기는 어렵습니다.',
  '비용이 부담된다고 이야기하는 분들도 있습니다.',
]) {
  expect(sentence.slice(0, 52), checkCostClaim(sentence, CLINIC).level, null)
}

// ── D4-A 불변 ──────────────────────────────────────────────

section('D4-A 기존 동작 불변 — sentencesWith 로 바꿨어도 같아야')
expect(
  'medical=false 면 검사하지 않는다',
  checkCareAdvice('아무 문장이나 있습니다.', false).level,
  null,
)
expect(
  '권고 문장이 있으면 통과',
  checkCareAdvice('증상이 오래가면 병원에서 확인해 보시는 편이 좋습니다.', true).level,
  null,
)
expect(
  '권고 문장이 없으면 FAIL',
  checkCareAdvice('갱년기에는 여러 변화가 함께 나타납니다.', true).level,
  'FAIL',
)
expect(
  '주체와 동사가 다른 문장에 흩어져 있으면 FAIL',
  checkCareAdvice('병원에 갈 정도는 아닙니다.\n혼자 확인해 보세요.', true).level,
  'FAIL',
)

// ── 결과 ───────────────────────────────────────────────────

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
