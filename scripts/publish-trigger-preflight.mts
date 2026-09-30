#!/usr/bin/env tsx
/**
 * 발행 트리거 **단일 실행 authority preflight** — 🔴 read-only. DB 0 · write 0 · 발행 0 · 네트워크 0
 *
 * 🔴 **바뀐 것** (2026-09-30 · D100 정본 "single always-on runtime owner").
 *    앞판은 정본 env 의 단계 키와 **GitHub Variables** 를 `gh variable list` 로 읽어 같은지 대조했다.
 *    두 트리거(GitHub 예약 + launchd)가 각자 단계를 읽던 시절의 게이트다 — 대조가 같아도 **권위는 둘**이었다.
 *    이제 GitHub 예약 발행자는 없고, 단계는 StageDecision 하나만 정한다. 그래서 이 명령은
 *    **"발행자가 하나인가"** 를 본다 — `stage-authority-graph` 의 활성 호출 그래프 판정 그대로다.
 *      · 발행 엔트리에 닿는 workflow 예약 0 · 같은 작업의 schedule owner 둘 이상 0
 *      · 발행 · 공급 엔트리는 전부 `stage-consume-exec --by=<같은 종류>` 경유
 *      · workflow · plist · package.json · 셸에 옛 단계 변수 0 · 허용 밖 코드의 단계 칸 0
 *    🔴 GitHub Variables 도 정본 env 도 **읽지 않는다** — 읽을 이유가 없어졌다(값이 무엇이든 결정하지 못한다).
 *
 * 사용법
 *   npm run publish:trigger-preflight            사람이 읽는 표
 *   npm run publish:trigger-preflight -- --json  도구가 읽는 JSON
 *
 * 종료 코드  0 — 발행 authority 하나 · 1 — 위반(목록 출력)
 */
import { describeReach, entryKindOf } from './lib/stage-authority-graph'
import { judgeRepoAuthority } from './lib/stage-authority-repo'

const WANT_JSON = process.argv.includes('--json')
const v = judgeRepoAuthority()
const consumerReaches = v.reaches.filter((r) => entryKindOf(r.entry, v.publishEntries) !== null)

if (WANT_JSON) {
  console.log(JSON.stringify({
    ranAt: new Date().toISOString(), ok: v.ok,
    publishEntries: v.publishEntries,
    consumerReaches: consumerReaches.map((r) => ({ invoker: r.invoker, entry: r.entry, wrappedBy: r.wrappedBy, via: r.via })),
    scheduledWorkflows: v.workflows.filter((w) => w.scheduled).map((w) => w.file),
    violations: v.violations, pending: v.pending,
  }, null, 2))
} else {
  console.log('\n══ 발행 트리거 — 단일 실행 authority preflight (read-only) ══\n')
  console.log(`  발행 엔트리(발행 트랜잭션 호출 · import 그래프)  ${v.publishEntries.join(' · ')}`)
  console.log(`  예약 workflow  ${v.workflows.filter((w) => w.scheduled).map((w) => `${w.file}(${w.cronCount})`).join(' · ') || '없음'}`)
  console.log('\n  발행 · 공급 엔트리를 부르는 곳')
  for (const r of consumerReaches) console.log(`   ${r.wrappedBy === null ? '🔴' : '✅'} ${describeReach(r)}`)
  for (const p of v.pending) console.log(`\n  🟡 다른 레인 소유 · 남은 소비 지점 — ${p.file}: ${p.detail}`)
  console.log(`\n  ${v.ok ? '🟢 발행 authority 는 하나다 — StageDecision → consumer → launchd 러너' : `🔴 위반 ${v.violations.length}건`}`)
  for (const x of v.violations) console.log(`     · [${x.code}] ${x.where} — ${x.detail}`)
  console.log('\n  🔴 이 명령은 아무것도 바꾸지 않았다 — DB 0 · write 0 · 발행 0 · GitHub Variables 읽기 0\n')
}
process.exit(v.ok ? 0 : 1)
