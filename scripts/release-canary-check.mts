#!/usr/bin/env tsx
/**
 * 하루 보호장치 · canary 퇴역 **행동 검사** — 🔴 DB 0 · 네트워크 0 · 파일 write 0
 *
 * 🔴 **2026-09-30 (source-slot-v1) — 하루짜리 canary · 기간(window) 경로를 지웠다.**
 *    앞판은 `SORAN_RELEASE_CANARY_*` · `SORAN_RELEASE_WINDOW_*` env 와 14일 준비도(`judgeReadiness`)
 *    · 하루 시뮬레이션(`judgeOneDayCanary`)으로 공개 단계를 **따로** 올렸다 — StageDecision 밖의 두 번째 · 세 번째
 *    단계 정본이었다. 이제 단계는 StageDecision(TRIAL · REPROVE → consumer env) 하나에서만 나온다.
 *
 *    이 검사가 잠그는 것:
 *      ① KST 날짜 · 남은 슬롯(보고용)은 그대로다
 *      ② 하루 보호장치(`judgeDayGuard`) — 재고 부족은 "그만 내기", 결함은 "전면 중단"
 *      ③ 🔴 옛 canary · window env 를 넣어도 `resolveScale` 이 단계를 바꾸지 않는다(죽은 입력)
 *      ④ 🔴 canary 함수 · 상수가 다시 생기지 않는다 · 러너가 그것을 읽지 않는다
 */
import { readFileSync } from 'node:fs'

import * as canaryLib from '../src/lib/release-canary'
import { judgeDayGuard, kstDateString, slotsLeftToday } from '../src/lib/release-canary'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES } from '../src/lib/scale-profile'
import { markedStageEnv } from './lib/stage-decision-fixture'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 하루 보호장치 · canary 퇴역 검사 (🔴 DB 0 · 네트워크 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① KST 날짜 · 남은 슬롯(보고용)')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **날짜는 KST 로 센다 (UTC 아님)**',
    kstDateString(new Date('2026-09-21T15:30:00.000Z')) === '2026-09-22'
    && kstDateString(new Date('2026-09-21T14:30:00.000Z')) === '2026-09-21')
  const at = (h: number, m: number): Date => new Date(Date.UTC(2026, 8, 22, h - 9, m, 0))
  check('09:29 · d3 — 남은 슬롯 3', slotsLeftToday('d3', at(9, 29)) === 3)
  check('🔴 09:40 · d3 — 남은 슬롯 2 (판정에 쓰지 않는다 · 목표 − 발행 수와 다를 수 있다)',
    slotsLeftToday('d3', at(9, 40)) === 2 && PROFILES.d3.dailyTarget === 3)
  check('23:59 · d3 — 남은 슬롯 0', slotsLeftToday('d3', at(23, 59)) === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 하루 보호장치 — 재고 부족과 결함을 같은 무게로 다루지 않는다')
// ─────────────────────────────────────────────────────────
{
  const base = { publishedToday: 1, dailyTarget: 3, publishable: 2, hardDefects: [] as string[] }
  const ok = judgeDayGuard(base)
  check('🟢 남은 편수 · 낼 것이 있으면 더 낸다', ok.allow && !ok.halt)
  const empty = judgeDayGuard({ ...base, publishable: 0 })
  check('🟡 낼 것이 없으면 그만 낸다 — 전면 중단이 아니다', !empty.allow && !empty.halt && empty.reason.includes('낸 것은 그대로'))
  const done = judgeDayGuard({ ...base, publishedToday: 3 })
  check('🟢 목표를 다 냈으면 더 내지 않는다', !done.allow && !done.halt)
  const bad = judgeDayGuard({ ...base, hardDefects: ['중복 발행 흔적'] })
  check('🔴 🔴 **결함은 전면 중단 — 낼 것이 있어도**', !bad.allow && bad.halt && bad.reason.includes('중복 발행 흔적'))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 옛 canary · window env 는 죽은 입력이다')
// ─────────────────────────────────────────────────────────
{
  const baseEnv = markedStageEnv({ SORAN_CAPACITY_STAGE: 'd1', SORAN_RELEASE_STAGE: 'd1' })
  const legacy = {
    ...baseEnv,
    SORAN_RELEASE_CANARY_STAGE: 'd3', SORAN_RELEASE_CANARY_DATE: '2026-09-22',
    SORAN_RELEASE_WINDOW_STAGE: 'd10', SORAN_RELEASE_WINDOW_FROM: '2026-09-01', SORAN_RELEASE_WINDOW_UNTIL: '2026-12-31',
  }
  const a = resolveScale(baseEnv as NodeJS.ProcessEnv)
  const b = resolveScale(legacy as NodeJS.ProcessEnv)
  check('🔴 🔴 **canary d3 · window d10 을 실어도 공개 단계는 d1 그대로**',
    a.releaseStage === 'd1' && b.releaseStage === 'd1' && b.releaseProfile.dailyTarget === PROFILES.d1.dailyTarget,
    `${a.releaseStage} / ${b.releaseStage}`)
  check('🔴 결과 모양에 canary · readiness 칸이 없다',
    !('canary' in b) && !('readinessApplied' in b) && !('chosenReady' in b) && !('throttledByReadiness' in b))
  const d3 = resolveScale(markedStageEnv({ SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd3' }) as NodeJS.ProcessEnv)
  check('🟢 단계는 결정(consumer env) 값 그대로 — d3 이면 d3', d3.releaseStage === 'd3')
  const hand = resolveScale({ SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd3' } as NodeJS.ProcessEnv)
  check('🔴 🔴 **표식 없는 손 env d3 → d1 (GitHub Variables · .env.local 단계는 결정이 아니다)**', hand.releaseStage === 'd1')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 canary 경로가 돌아오지 않는다')
// ─────────────────────────────────────────────────────────
{
  const names = Object.keys(canaryLib).filter((n) => n !== 'default' && n !== 'module.exports')
  check('🔴 🔴 **release-canary 는 날짜 · 슬롯 · 하루 보호장치만 export 한다**',
    names.sort().join(',') === ['judgeDayGuard', 'kstDateString', 'slotsLeftToday'].sort().join(','), names.join(','))
  const strip = (f: string): string => readFileSync(f, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const files = [
    'src/lib/scale-runtime.ts', 'scripts/original-post-auto-publish.mts', 'scripts/stage-controller.mts',
    'src/lib/stage-controller.ts', 'scripts/supply-process.mts', 'scripts/supply-health.mts',
  ]
  const hits = files.filter((f) => /CANARY_STAGE_ENV|CANARY_DATE_ENV|judgeOneDayCanary|canaryAuthorization|RELEASE_WINDOW|judgeReadiness/.test(strip(f)))
  check('🔴 🔴 **러너 · 관제 · 컨트롤러 · 규모 해석이 canary · window · 준비도를 읽지 않는다**', hits.length === 0, hits.join(','))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
