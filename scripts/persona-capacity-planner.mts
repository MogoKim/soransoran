#!/usr/bin/env tsx
/**
 * Persona 확장 planner — 🔴 **퇴역 (2026-09-30 · source-slot-v1)**. 아무것도 계산하지 않는다.
 *
 * 🔴 **왜 지웠나.** 이 명령은 "M1 1/day 를 14일 지속하려면 설계 문서 카드 중 누구를 켜야 하는가" 를
 *    14일 발행 예측(`forecastPublishing`) · 14일 준비도(`simulateAllStages`) · 재고 목표(×14)로 계산했다.
 *    정본(Sep 30)은 세 가지를 금지한다:
 *      · 14일치 완성 글 재고를 지속 준비도로 쓰기
 *      · 활성 행 수(카드를 켠 수)를 Persona 용량으로 쓰기 — `designed · qualification-pending ·
 *        contract-valid reserve · stage-active` 를 나눠야 한다
 *      · 창업자가 routine Persona 를 손으로 계획 · 생성하게 만들기
 *    같은 질문(Persona 가 다음 단계를 감당하는가)의 정본은 **하나**다 — Persona 레인이 제공하는
 *    `contractValidPersonas` 를 다음 단계 preflight(`judgeNextPreflight`)가 읽는다.
 *
 * 🔴 **남긴 것** — 설계 카드 읽기 · 검증(`persona-pool-card` · `persona-card-verify`)은 Persona 레인의 정본이고
 *    `persona:planner-check` 가 그 규칙을 계속 본다. 이 파일은 그 위에 계획을 얹지 않는다.
 *
 *   npx tsx scripts/persona-capacity-planner.mts   → 퇴역 안내만 찍고 exit 0 (DB 0 · 네트워크 0 · 파일 write 0)
 */
console.log('\n══ Persona 확장 planner — 🔴 퇴역 (2026-09-30) ══\n')
console.log('  이 명령은 더 이상 계산하지 않는다 — 14일 예측 · 카드 수동 계획 경로를 지웠다.')
console.log('  Persona 가 다음 단계를 감당하는가: `npm run stage:controller`(dry-run) 의 preflight 가')
console.log('    Persona 레인이 제공하는 계약 유효 Persona 수(`contractValidPersonas`)로 본다. 읽지 못하면 UNKNOWN, 하한 미달이면 FAIL 이다(2026-09-30 실측 0 → D1→D3 부터 막힌다).')
console.log('  🔴 DB 0 · 네트워크 0 · 파일 write 0\n')
