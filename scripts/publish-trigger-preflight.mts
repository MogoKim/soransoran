#!/usr/bin/env tsx
/**
 * 발행 트리거 **설정 분리 preflight** — 🔴 read-only. DB 0 · write 0 · 발행 0
 *
 * 🔴 **무엇을 막는가** (2026-09-14 실측).
 *
 *    GitHub Actions 는 Repository Variables 를, launchd 는 runtime 정본 env 를 읽는다.
 *    두 곳이 달랐다 —
 *      · 정본 env          `SORAN_CAPACITY_STAGE=d3` · `SORAN_RELEASE_STAGE=d1`
 *      · GitHub Variables  **비어 있음** → 러너가 `d1` 로 fail-closed
 *
 *    지금은 두 effective release 가 우연히 같아서(d1) 사고가 나지 않았다.
 *    한쪽만 올리면 **같은 날 두 트리거가 서로 다른 하루 상한을 본다.**
 *
 * 🔴 **정본은 절대 경로 하나다** (2026-09-14 정정).
 *
 *    앞선 판은 `loadEnvLocal()` → `process.cwd()/.env.local` → `process.env` 로 읽었다.
 *    그 경로는 **실행 위치에 따라 답이 달라진다** — PR 작업트리에는 `.env.local` 이 없어서
 *    `local d1/d1` 로 읽고 **exit 0(거짓 통과)** 를 냈다. 실제 정본은 `d3/d1` 이었다.
 *    등록 게이트는 "어디서 실행하든 같은 답" 이어야 한다.
 *
 *    🔴 그래서 이 명령은 **cwd 도 `process.env` 도 local 정본으로 쓰지 않는다.**
 *
 * 🔴 **정본에서 읽는 것은 단계 키 둘뿐이다.** 그 파일에는 DATABASE_URL · API key 가 함께 산다 —
 *    필요 없는 것을 아예 읽지 않는 것이 "출력하지 않는다" 보다 확실하다.
 *
 * 🔴 **새 중앙 설정을 만들지 않는다.** 값을 한 곳으로 합치는 대신 **다르면 멈춘다** —
 *    설정이 둘인 것은 인프라의 사실이고, 그 사실을 감추는 추상화가 더 위험하다.
 *
 * 사용법
 *   npm run publish:trigger-preflight            사람이 읽는 표
 *   npm run publish:trigger-preflight -- --json  도구가 읽는 JSON
 *
 * 종료 코드
 *   0  두 트리거가 같은 단계를 본다
 *   1  다르다 · 정본을 못 읽었다 · GitHub Variables 를 못 읽었다 (전부 fail-closed)
 */
import { execFileSync } from 'node:child_process'

import {
  judgeTriggerParity, readCanonicalStages, CANONICAL_ENV_PATH, CANONICAL_STAGE_KEYS,
  PARITY_STAGES, PUBLISH_REPO, type StageSetting,
} from './lib/original-post-runner-template'
import { CAPACITY_ENV, RELEASE_ENV } from '../src/lib/scale-profile'

/** 🔴 대상 저장소 정본은 template 파일 하나다 — heartbeat preflight 와 같은 값을 쓴다 */
export { PUBLISH_REPO }

const WANT_JSON = process.argv.includes('--json')

// ── ① local 정본 — 🔴 절대 경로 파일 하나. cwd · process.env 를 보지 않는다 ──
const canonical = readCanonicalStages()

// ── ② GitHub Variables — 🔴 못 읽으면 null. `{}` 로 보정하지 않는다 ──
const github: StageSetting | null = ((): StageSetting | null => {
  try {
    const out = execFileSync(
      'gh',
      ['variable', 'list', '--repo', PUBLISH_REPO, '--json', 'name,value'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const rows = JSON.parse(out.trim() === '' ? '[]' : out) as { name: string; value: string }[]
    if (!Array.isArray(rows)) return null
    const pick = (n: string): string | undefined => rows.find((r) => r.name === n)?.value
    return { capacity: pick(CAPACITY_ENV), release: pick(RELEASE_ENV) }
  } catch {
    return null
  }
})()

// ── ③ 정본을 못 읽었으면 대조 자체가 성립하지 않는다 ──
if (!canonical.ok) {
  if (WANT_JSON) {
    console.log(JSON.stringify({
      ranAt: new Date().toISOString(), ok: false,
      canonicalPath: canonical.path, canonicalError: canonical.reason,
      local: null, github: null,
      blockers: [canonical.reason], reason: canonical.reason,
    }, null, 2))
  } else {
    console.log('\n══ 발행 트리거 설정 분리 preflight (read-only) ══\n')
    console.log(`  정본 경로  ${canonical.path}`)
    console.log(`\n  🔴 ${canonical.reason}`)
    console.log('\n  🔴 local runner(launchd)를 등록하지 않는다 — 정본을 읽지 못하면 대조할 수 없다.')
    console.log('     runtime 을 먼저 배포하고 SHA 를 확인한 뒤 다시 실행한다.')
    console.log('\n  🔴 이 명령은 아무것도 바꾸지 않았다 — DB 0 · write 0 · 발행 0\n')
  }
  process.exit(1)
}

const local: StageSetting = canonical.setting
const verdict = judgeTriggerParity({ local, github })

if (WANT_JSON) {
  console.log(JSON.stringify({
    ranAt: new Date().toISOString(),
    ok: verdict.ok,
    canonicalPath: canonical.path,
    repo: PUBLISH_REPO,
    // 🔴 단계 키 둘만 싣는다. 정본의 다른 값은 읽지도 않았다
    local: { raw: local, ...verdict.local },
    github: github === null ? null : { raw: github, ...verdict.github },
    blockers: verdict.blockers,
    reason: verdict.reason,
  }, null, 2))
} else {
  console.log('\n══ 발행 트리거 설정 분리 preflight (read-only) ══\n')
  console.log(`  허용 단계  ${PARITY_STAGES.join(' · ')}`)
  console.log(`  정본 경로  ${CANONICAL_ENV_PATH}`)
  console.log(`  읽은 키    ${CANONICAL_STAGE_KEYS.join(' · ')} (🔴 이 둘만 읽는다)`)
  console.log(`  대상 repo  ${PUBLISH_REPO}`)
  const line = (label: string, s: typeof verdict.local | null, raw: StageSetting | null): void => {
    if (s === null || raw === null) { console.log(`  ${label.padEnd(10)} 🔴 읽지 못했다`); return }
    console.log(`  ${label.padEnd(10)} capacity ${String(raw.capacity ?? '(없음)').padEnd(8)} → ${s.capacity}`
      + ` · release ${String(raw.release ?? '(없음)').padEnd(8)} → ${s.release}`
      + ` · 🔴 실제 공개 ${s.effectiveRelease}${s.fellBack ? '  (fail-closed 로 떨어짐)' : ''}`)
  }
  console.log('')
  line('정본 env', verdict.local, local)
  line('GitHub', verdict.github, github)
  console.log(`\n  ${verdict.ok ? '🟢' : '🔴'} ${verdict.reason}`)
  for (const b of verdict.blockers) console.log(`     · ${b}`)
  if (!verdict.ok) {
    console.log('\n  🔴 local runner(launchd)를 등록하지 않는다 —'
      + ' 두 트리거가 서로 다른 하루 상한을 보게 된다.')
    console.log('     고치는 곳은 둘 중 **틀린 쪽 하나**다. 값을 한 곳으로 합치지 않는다.')
  }
  console.log('\n  🔴 이 명령은 아무것도 바꾸지 않았다 — DB 0 · write 0 · 발행 0\n')
}

process.exit(verdict.ok ? 0 : 1)
