#!/usr/bin/env tsx
/**
 * Raw Originality 재고 리포트 — 🔴 **읽지 않는다. 네트워크 요청 0건.**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AF
 *
 * 🔴 **이 명령은 계획 모드뿐이다.** `--live` 가 없다. 스위치도 없다.
 *    실제로 원문을 여는 것은 다음 PR 의 `raw-detail-fetch` 이고, 이 파일은
 *    "무엇을 얼마나 열게 되는가" 를 **열기 전에** 보여줄 뿐이다.
 *
 * 🔴 **하지 않는 것**
 *    목록 scout · 상세 fetch · 브라우저 · DB write · Prisma · Google Sheet · LLM ·
 *    자동 발행 · noindex 배포 · Raw Vault 적재 · 82cook adapter.
 *    읽는 것은 `.microseed-data/` 안 파일뿐이고, **아무것도 쓰지 않는다.**
 *
 * 사용법
 *   npx tsx scripts/micro-seed-raw-originality-plan.mts
 *   npx tsx scripts/micro-seed-raw-originality-plan.mts --cap=20
 */
import { loadScoutRows, SCOUT_DATA_DIR } from './lib/micro-seed-scout-load.mjs'
import { scoreRows } from './lib/micro-seed-scout-score.mjs'
import { seenArticleIds } from './micro-seed-detail-fetch.mjs'
import {
  RAW_LANE, RAW_AXIS, RAW_MIN_BODY, BODY_HEAD_CHARS, NOT_PUBLISH_NOTE,
  RAW_DECISIONS, RAW_COLUMNS, selectRawTargets, prescreen, blockedBeforeRead,
  type RawCandidate,
} from './lib/micro-seed-raw-originality.mjs'

export const DEFAULT_CAP = 10
export const ALLOWED_CAPS: readonly number[] = [10, 20] as const

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const CAP = Number(arg('cap') ?? DEFAULT_CAP)
const pad = (s: string | number, n: number): string => String(s).padEnd(n)
/** 🔴 제목 전문을 찍지 않는다 — 앞부분과 길이만 */
const head = (s: string, n = 18): string => {
  const c = [...s]
  return c.length <= n ? s : `${c.slice(0, n).join('')}…(${c.length}자)`
}

function main(): void {
  if (!ALLOWED_CAPS.includes(CAP)) {
    console.error(`\n🛑 cap 은 ${ALLOWED_CAPS.join(' 또는 ')} 만 허용한다 (받은 값 ${CAP})\n`)
    process.exit(1)
  }

  console.log('\nRaw Originality 재고 리포트 — 🔴 읽지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 네트워크 요청 0건 · 목록 scout 0 · 상세 fetch 0 · DB write 0 · Sheet 0 · LLM 0')
  console.log('  🔴 산출물을 쓰지 않는다 — 읽기만 한다\n')

  const { loaded } = loadScoutRows(SCOUT_DATA_DIR, null)
  const scored = scoreRows(loaded.flatMap((l) => l.rows)).scored
  const rows: RawCandidate[] = scored.map((s) => ({
    sourceArticleId: s.row.sourceArticleId,
    sourceSite: s.row.sourceSite,
    lane: s.laneHint.lane,
    score: s.score.total,
    title: s.row.originalTitle ?? '',
  }))
  const seen = seenArticleIds()
  const inLane = rows.filter((r) => r.lane === RAW_LANE)
  const fresh = inLane.filter((r) => !seen.has(r.sourceArticleId))

  console.log('① 재고')
  console.log(`   전체 스코어링 ${rows.length}건 · lane=${RAW_LANE} ${inLane.length}건`)
  console.log(`   이미 읽음 ${inLane.length - fresh.length}건 제외 → 아직 안 읽음 ${fresh.length}건`)

  // 🔴 읽기 전 안전 선별 — 제목만 보고 확실히 버릴 것은 열지 않는다
  const screened = fresh.map((r) => ({ r, s: prescreen(r) }))
  const blocked = screened.filter((x) => blockedBeforeRead(x.s))
  const openable = screened.filter((x) => !blockedBeforeRead(x.s))

  console.log('\n② 읽기 전 안전 선별 — 🔴 요청 하나가 곧 계정 위험이라, 제목만 봐도 버릴 것은 열지 않는다')
  console.log(`   차단 ${blocked.length}건 (정치·공인·광고·고정슬롯) · 열 수 있음 ${openable.length}건`)
  const byReason = new Map<string, number>()
  for (const b of blocked) for (const rn of b.s.reasons) byReason.set(rn.code, (byReason.get(rn.code) ?? 0) + 1)
  for (const [c, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`     ${pad(c, 22)} ${n}`)
  console.log('   🟡 생활 사연은 여기서 막지 않는다 — 가족·부부·돈·일은 이 레인의 재료다')

  const targets = selectRawTargets(openable.map((x) => x.r), CAP, seen)
  console.log(`\n③ 다음에 열 대상 — 점수순 상위 ${CAP}건 (cap 은 생산 목표가 아니라 요청 상한)`)
  console.log(`   ${pad('id', 10)} ${pad('site', 23)} ${pad('score', 6)} title`)
  for (const t of targets) {
    console.log(`   ${pad(t.sourceArticleId, 10)} ${pad(t.sourceSite, 23)} ${pad(t.score.toFixed(1), 6)} ${head(t.title)}`)
  }

  console.log('\n④ 읽은 뒤 무엇이 되는가 — 🔴 지금은 알 수 없다')
  console.log(`   lane=${RAW_LANE} 는 **목록 추정**이고, axis=${RAW_AXIS} 는 **본문을 읽은 뒤 판정**이다.`)
  console.log(`   축이 되려면 본문 ${RAW_MIN_BODY}자 이상 + 사연 축이 있어야 한다.`)
  console.log('   즉 위 대상이 전부 Raw 가 되지는 않는다 — 짧으면 SRN, 사연 축이 없으면 seedOriginality 로 간다.')

  console.log('\n⑤ 본문 저장 규칙')
  console.log(`   🔴 전문을 저장하지 않는다. 마스킹 후 앞 ${BODY_HEAD_CHARS}자 + 길이·문단수만 남긴다.`)
  console.log('   원문이 남으면 사람이 그 문장을 참고하게 된다 — 이 레인은 *다시 쓰는* 레인이다.')

  console.log('\n⑥ 사람이 고르는 것')
  for (const [d, why] of RAW_DECISIONS) console.log(`   ${pad(d, 6)} ${why}`)
  console.log('   🔴 ADOPT · APPROVE · SEED 는 여기 없다 — 다른 화면의 말이다')

  console.log(`\n⑦ 승인 파일 컬럼 ${RAW_COLUMNS.length}개 (body 전문 컬럼 없음)`)
  console.log(`   ${RAW_COLUMNS.join(' · ')}`)

  console.log('\n─────────────────────────────────────────────────────────')
  console.log(`  재고 ${inLane.length} → 안 읽음 ${fresh.length} → 열 수 있음 ${openable.length} → 이번 cap ${targets.length}건`)
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 아무것도 쓰지 않았다. 네트워크 요청 0건.\n')
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 아무 일도 하지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
