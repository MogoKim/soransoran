#!/usr/bin/env node
/**
 * 매거진 자동 QA
 *
 * 매거진 전략 원칙 5 · §5.1 의 "위험 기반 검수"를 성립시키는 앞단이다.
 * 기계가 잡을 수 있는 것을 먼저 걸러야 창업자가 위험 판단에만 집중할 수 있다.
 *
 * 이 스크립트가 하지 않는 것 (전략 §3.0 역할 분리):
 *   글을 쓰지 않는다 · 파일을 고치지 않는다 · LLM 을 호출하지 않는다 · 네트워크를 쓰지 않는다.
 *   순수 정적 검사만 한다.
 *
 * 사용법
 *   node scripts/magazine-qa.mjs                     발행 글 + 전체 draft
 *   node scripts/magazine-qa.mjs --published         지금 공개된 글만
 *   node scripts/magazine-qa.mjs --scheduled         예약·차단된 글만 (아직 안 나간 글)
 *   node scripts/magazine-qa.mjs --draft <path>      특정 draft 만
 *   node scripts/magazine-qa.mjs --json              결과를 JSON 으로 (다른 도구가 읽는 용도)
 *
 * 종료 코드: FAIL 1건 이상이면 1, 아니면 0 (WARN 은 0)
 *
 * 검사 로직(runQa)은 lib/magazine-qa-core.mjs 에 있다(S1 C4). 이 파일은 argv · 출력 · 종료만 맡는다.
 * 다른 스크립트는 core 를 직접 import 한다 — 이 CLI 는 호환을 위해 같은 runQa 를 다시 내보낸다.
 */
// 🔴 판정은 core 한 곳 — 감싸거나 옮겨 적지 않고 같은 함수를 그대로 다시 내보낸다(경계 검사 R11 · R12)
import { runQa } from './lib/magazine-qa-core.mjs'
import {
  BANNED_WORDS,
  MEDICAL_REQUIRED,
  MEDICAL_SUGGESTED,
  HERO_WIDTH,
  HERO_HEIGHT,
} from './lib/magazine-qa-constants.mjs'
import { readWebpSize } from './lib/magazine-webp.mjs'

/**
 * 🔴 공용 상수는 `lib/magazine-qa-constants.mjs` 가 정본이다(S1 C2). 여기서는 같은 객체를 쓴다.
 *    이 CLI 가 내보내던 이름은 호환을 위해 그대로 다시 내보낸다 — lib 는 정본을 직접 import 한다.
 */
export { BANNED_WORDS, MEDICAL_REQUIRED, MEDICAL_SUGGESTED, HERO_WIDTH, HERO_HEIGHT }
/** readWebpSize 도 같은 이유로 그대로 다시 내보낸다 — 정의는 lib/magazine-webp.mjs */
export { readWebpSize }
/** runQa 도 그대로 다시 내보낸다 — 정의는 lib/magazine-qa-core.mjs */
export { runQa }

// ── 출력 ───────────────────────────────────────────────────

function printHuman(result) {
  console.log('')
  console.log(
    `매거진 QA — 공개 ${result.counts.live}건 · 예약·차단 ${result.counts.pending}건 · ` +
      `draft ${result.counts.drafts}건 · queue ${result.counts.queue}건`,
  )
  console.log('')

  for (const row of result.rows) {
    const mark = row.level === 'FAIL' ? '✗ FAIL' : '! WARN'
    console.log(`  ${mark}  [${row.id}] ${row.msg}`)
  }
  if (result.rows.length === 0) console.log('  ✓ 지적 사항 없음')

  console.log('')
  console.log(`  검사 ${result.counts.checked}건 · FAIL ${result.fail} · WARN ${result.warn}`)
  console.log('')
}

// ── CLI ────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const draftFlag = args.indexOf('--draft')
  const asJson = args.includes('--json')

  let draftPath
  if (draftFlag !== -1) {
    draftPath = args[draftFlag + 1]
    if (!draftPath || draftPath.startsWith('--')) {
      console.error('--draft 뒤에 파일 경로가 필요하다')
      process.exit(2)
    }
  }

  const result = runQa({
    draftPath,
    publishedOnly: args.includes('--published'),
    scheduledOnly: args.includes('--scheduled'),
  })

  // --json 일 때는 JSON 외의 문자를 stdout 에 섞지 않는다.
  if (asJson) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)

  process.exit(result.ok ? 0 : 1)
}

// import 해서 쓸 때는 CLI 를 돌리지 않는다.
if (process.argv[1] && process.argv[1].endsWith('magazine-qa.mjs')) main()
