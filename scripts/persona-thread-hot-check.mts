#!/usr/bin/env tsx
/**
 * 뜨거운 글(밤 4 · 2026-11-25) 검사 — 🔴 DB · provider · 네트워크 · env 파일 없음
 *
 *   npx tsx scripts/persona-thread-hot-check.mts
 *
 * 무엇을 잠그나
 *   ① 목표 줄 — `since` 와 `hot` 이 같은 소스 줄 · 구조 상한이 뜨거운 글 상한을 포함 · 목표 파일 import 0
 *   ② 계획 — 뜨거운 크기 = sizeMin + 이항(n, ½) · 보통 글과 같은 씨앗 · `hot` 없는 줄의 글은 승격 0 · 간격 하한
 *   ③ 판독 — commentsPct 가 문턱 이상일 때만 · null · 통계 없음 · 증거 없음 · 손상 · 옛 줄 · 시각 모름 → false
 *   ④ 연결 — 러너 · 발행 트랜잭션 · 증거가 같은 조회 · 같은 판독을 실제로 부른다
 *   ⑤ 증거 — counts(뜨거운 글 수 · 크기 하한 도달 수)만 · 판정 코드는 그대로(gate 없음)
 *
 * 🔴 변이 시험(`persona-thread-hot-mutation.mts`)이 `THREAD_TARGET_MODULE` · `THREAD_PLAN_MODULE` · `THREAD_HOT_MODULE` 로
 *    변이 사본을 주입한다. 그래서 세 모듈은 동적으로 읽는다.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type * as TargetModule from '../src/lib/persona-thread-target'
import type * as PlanModule from '../src/lib/persona-thread-plan'
import type * as HotModule from '../src/lib/persona-thread-hot'
import { judgeEvidenceForTarget, type EvidencePost, type StageEvidenceFacts } from '../src/lib/stage-evidence'
import { DECISION_WRITER } from '../src/lib/stage-decision-contract'
import { SOURCE_EVIDENCE_KEY } from '../src/lib/source-slot-release'
import { fakeSourceEvidence } from './lib/fake-source-evidence.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const lib = join(here, '../src/lib')
const targetPath = process.env.THREAD_TARGET_MODULE ?? join(lib, 'persona-thread-target.ts')
const T = (await import(targetPath)) as typeof TargetModule
const PL = (await import(process.env.THREAD_PLAN_MODULE ?? join(lib, 'persona-thread-plan.ts'))) as typeof PlanModule
const H = (await import(process.env.THREAD_HOT_MODULE ?? join(lib, 'persona-thread-hot.ts'))) as typeof HotModule

let failures = 0
const lines: string[] = []
const check = (name: string, cond: boolean, detail = ''): void => {
  if (!cond) failures++
  lines.push(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const MIN = 60_000

// ═════════ ① 목표 줄 ═════════
const hotLines = T.THREAD_TARGETS.filter((t) => t.hot !== undefined)
const hotLine = hotLines[hotLines.length - 1]
check('① 뜨거운 글 칸이 있는 목표 줄이 있다(지점 0곳 금지)', hotLine !== undefined && hotLines.length >= 1, `${hotLines.length}줄`)
const HOT_AT = hotLine === undefined ? Number.NaN : Date.parse(hotLine.since)
const OLD_AT = Date.parse(T.THREAD_TARGETS[0]!.since)
{
  const src = readFileSync(targetPath, 'utf-8').split('\n')
  check('① 🔴 `since` 와 `hot` 이 같은 소스 줄에 있다(배포 게이트가 그 줄을 grep 한다)',
    hotLines.length > 0 && hotLines.every((t) => src.some((l) => l.includes(`since: '${t.since}'`) && l.includes('hot:'))))
  check('① 🔴 목표 파일 import 0 — 고객·운영 화면 번들이 `persona-target-rules` 를 거쳐 읽는다',
    src.length > 10 && !src.some((l) => /^\s*import\s/.test(l) || /\brequire\(/.test(l)))
  const want = Math.max(...T.THREAD_TARGETS.map((t) => Math.max(Math.ceil(t.meanSize * 2), t.hot?.sizeMax ?? 0)))
  check('① 🔴 구조 상한 = 모든 줄의 max(평균 × 2, 뜨거운 글 상한) — 뜨거운 글 상한이 빠지면 13번째부터 감사 FAIL',
    T.THREAD_SIZE_CAP === want && hotLines.every((t) => T.THREAD_SIZE_CAP >= t.hot!.sizeMax), `상한 ${T.THREAD_SIZE_CAP} · 기대 ${want}`)
  check('① 뜨거운 글 범위가 보통 글보다 위다(하한 ≥ 2 · 상한 > 하한)',
    hotLines.every((t) => t.hot!.sizeMin >= T.THREAD_SIZE_MIN && t.hot!.sizeMax > t.hot!.sizeMin && t.hot!.commentsPctMin > 0 && t.hot!.commentsPctMin <= 1))
  check('① 칸 선택 — 효력 줄의 hot · 첫 줄보다 이른 글은 첫 줄(hot 없음)',
    T.threadHotAt(HOT_AT) !== null && T.threadHotAt(HOT_AT - 1) === (T.THREAD_TARGETS.filter((t) => Date.parse(t.since) <= HOT_AT - 1).at(-1)?.hot ?? null)
    && T.threadHotAt(0) === (T.THREAD_TARGETS[0]!.hot ?? null))
}

// ═════════ ② 계획 ═════════
if (hotLine !== undefined) {
  const h = hotLine.hot!
  const ids = Array.from({ length: 4000 }, (_, i) => `hot-plan-${i}`)
  const hot = ids.map((id) => PL.threadPlanOf(id, HOT_AT, true))
  const normal = ids.map((id) => PL.threadPlanOf(id, HOT_AT, false))
  const mean = hot.reduce((s, p) => s + p.size, 0) / hot.length
  const n = h.sizeMax - h.sizeMin
  // 이항(n, ½) 의 위 끝 몫 — 18 이상(12~20 이면 37/256)
  const upper = Math.max(h.sizeMin, h.sizeMax - 2)
  const tail = Array.from({ length: n + 1 }, (_, k) => k).filter((k) => h.sizeMin + k >= upper)
  const choose = (a: number, b: number): number => { let c = 1; for (let i = 1; i <= b; i++) c = (c * (a - b + i)) / i; return c }
  const wantTail = tail.reduce((s, k) => s + choose(n, k), 0) / 2 ** n
  const gotTail = hot.filter((p) => p.size >= upper).length / hot.length
  check('② 🔴 뜨거운 크기 — 범위 안 · 평균 = (하한 + 상한) ÷ 2 · 양 끝이 실제로 나온다 · 자리 = 크기 − 1',
    hot.every((p) => p.size >= h.sizeMin && p.size <= h.sizeMax && p.slots.length === p.size - 1)
    && Math.abs(mean - (h.sizeMin + h.sizeMax) / 2) < 0.15 && hot.some((p) => p.size === h.sizeMin) && hot.some((p) => p.size === h.sizeMax),
    `평균 ${mean.toFixed(2)} · 최소 ${Math.min(...hot.map((p) => p.size))} · 최대 ${Math.max(...hot.map((p) => p.size))}`)
  check(`② 🔴 뜨거운 크기 ${upper} 이상 몫 = 이항(${n}, ½) 의 몫 ±2%p`, Math.abs(gotTail - wantTail) < 0.02,
    `${(gotTail * 100).toFixed(1)}% · 기대 ${(wantTail * 100).toFixed(1)}%`)
  // 같은 씨앗 — `plan-size` 추첨값 순으로 세우면 보통 · 뜨거운 크기가 둘 다 줄지 않는다
  const order = ids.map((id, i) => ({ u: PL.unitOf('plan-size', id), hot: hot[i]!.size, normal: normal[i]!.size })).sort((a, b) => a.u - b.u)
  check('② 🔴 같은 씨앗 — 보통 글과 뜨거운 글이 같은 추첨값(`plan-size`) 하나로 크기를 정한다',
    order.every((x, i) => i === 0 || (x.hot >= order[i - 1]!.hot && x.normal >= order[i - 1]!.normal)))
  check('② 🔴 뜨거운 글 계획은 보통 글 계획과 다르다(인자가 실제로 효력이 있다)',
    hot.filter((p, i) => p.size !== normal[i]!.size).length > ids.length * 0.9)
  check('② 🔴 `hot` 칸이 없는 옛 줄의 글은 뜨거워도 보통 글 계획이다(옛 글 소급 0)',
    T.threadHotAt(OLD_AT) === null
    && ids.slice(0, 300).every((id) => JSON.stringify(PL.threadPlanOf(id, OLD_AT, true)) === JSON.stringify(PL.threadPlanOf(id, OLD_AT, false))))
  check('② 뜨거운 글 간격도 하한(10분) 이상 · 결정적',
    hot.every((p) => p.slots.every((x) => x.gapMs >= T.PLAN_MIN_GAP_MS))
    && JSON.stringify(PL.threadPlanOf('hot-plan-7', HOT_AT, true)) === JSON.stringify(hot[7]))
  check('② 크기 20 계획 — 간격이 전부 하한(마감에서 역산하면 4분 → 10분)',
    hot.filter((p) => p.size === h.sizeMax).every((p) => p.slots.every((x) => x.gapMs === T.PLAN_MIN_GAP_MS)))
}

// ═════════ ③ 판독 ═════════
if (hotLine !== undefined) {
  const h = hotLine.hot!
  const at = new Date(HOT_AT + 3 * 3_600_000)
  const gate = (over: Record<string, unknown> | null, pct = 0.9): Record<string, unknown> => {
    const rec = fakeSourceEvidence(at, { commentsPct: pct }) as unknown as Record<string, unknown>
    return { [SOURCE_EVIDENCE_KEY]: over === null ? rec : { ...rec, ...over } }
  }
  const rec = fakeSourceEvidence(at, { commentsPct: 0.9 })
  const statsWith = (over: Record<string, unknown>) => ({ sourceStats: { ...rec.sourceStats!, ...over } })
  const pub = at.getTime()
  check('③ 문턱 이상 → 뜨겁다 · 문턱 그 값도 뜨겁다(≥)',
    H.isHotThread(gate(null, 0.99), pub) && H.isHotThread(gate(statsWith({ commentsPct: h.commentsPctMin })), pub))
  check('③ 문턱 바로 아래 → 뜨겁지 않다', !H.isHotThread(gate(statsWith({ commentsPct: h.commentsPctMin - 0.001 })), pub))
  check('③ 🔴 commentsPct 가 null → 뜨겁지 않다(조회 백분위가 높아도 대신하지 않는다)',
    !H.isHotThread(gate(statsWith({ commentsPct: null, viewsPct: 0.99 })), pub))
  check('③ 🔴 원천 통계 없음 → 뜨겁지 않다', !H.isHotThread(gate({ sourceStats: null }), pub))
  check('③ 🔴 증거 없음 · gateResults 없음 · 배열 → 뜨겁지 않다',
    !H.isHotThread({}, pub) && !H.isHotThread(null, pub) && !H.isHotThread([], pub))
  check('③ 🔴 손상된 기록(판이 다르다 · 통계 칸 모양이 아니다) → 뜨겁지 않다',
    !H.isHotThread(gate({ version: 'broken' }), pub) && !H.isHotThread(gate(statsWith({ basis: 'broken' })), pub))
  check('③ 🔴 `hot` 칸 없는 옛 줄의 시각 → 뜨겁지 않다', !H.isHotThread(gate(null, 0.99), OLD_AT))
  check('③ 🔴 공개 시각 모름(null · NaN) → 뜨겁지 않다(마지막 줄로 추정하지 않는다)',
    !H.isHotThread(gate(null, 0.99), null) && !H.isHotThread(gate(null, 0.99), Number.NaN))
  const by = H.hotSourceByPost([
    { createdPostId: 'one', gateResults: gate(null, 0.99) },
    { createdPostId: 'dup', gateResults: gate(null, 0.99) }, { createdPostId: 'dup', gateResults: gate(null, 0.99) },
    { createdPostId: null, gateResults: gate(null, 0.99) },
  ])
  check('③ 큐 행 묶기 — 한 글 한 행만 · 같은 글에 두 행이면(유일성 깨짐) 모름 → 뜨겁지 않다 · 글 id 없는 행은 뺀다',
    H.isHotThread(by.get('one') ?? null, pub) && by.has('dup') && !H.isHotThread(by.get('dup') ?? null, pub) && by.size === 2)
  check('③ 조회 모양 — PUBLISHED 큐 행 · 글 id 목록 그대로', JSON.stringify(H.hotQueueWhereOf(['a', 'b'])) === JSON.stringify({ createdPostId: { in: ['a', 'b'] }, status: 'PUBLISHED' })
    && JSON.stringify(H.HOT_QUEUE_SELECT) === JSON.stringify({ createdPostId: true, gateResults: true }))
}

// ═════════ ④ 연결 — 만든 것이 소비자에서 실제로 쓰이는가 ═════════
{
  const run = readFileSync(join(here, 'lib/persona-comment-followup-run.mts'), 'utf-8')
  const tx = readFileSync(join(lib, 'persona-publish-tx.ts'), 'utf-8')
  const repo = readFileSync(join(lib, 'stage-evidence-repo.ts'), 'utf-8')
  const sameRead = (s: string) => s.includes('select: HOT_QUEUE_SELECT') && s.includes('hotQueueWhereOf(') && s.includes('hot: isHotThread(')
  check('④ 🔴 러너(생성 판정)와 발행 트랜잭션(재판정)이 같은 조회 모양 · 같은 판독을 부른다', sameRead(run) && sameRead(tx))
  check('④ 🔴 단계 증거도 같은 판독(PUBLISHED 큐 행)으로 잰다',
    repo.includes("hotSourceByPost(queue.filter((q) => q.status === 'PUBLISHED'))") && repo.includes('hot: isHotThread('))
}

// ═════════ ⑤ 증거 — counts 만(gate 없음) ═════════
if (hotLine !== undefined) {
  const day = new Date(HOT_AT + 9 * 3_600_000).toISOString().slice(0, 10)
  const pubAt = HOT_AT + 3 * 3_600_000
  const post = (id: string, size: number, hot: boolean | undefined): EvidencePost => ({
    postId: id, queueId: `q-${id}`, publishedAtMs: pubAt, capturedAtMs: pubAt - 3_600_000, unattended: true, queueRows: 1, publishLogs: 1,
    authorPersonaId: 'pA', decider: 'auto', release: 'STAMPED_ELIGIBLE',
    personaComments: Array.from({ length: size }, (_, i) => ({
      personaId: `p${i}`, createdAtMs: pubAt + (5 + i * 20) * MIN, topLevel: i === 0, provenance: i === 0 ? 'auto' as const : 'followup' as const,
    })),
    ...(hot === undefined ? {} : { hot }),
  })
  const facts = (posts: EvidencePost[]): StageEvidenceFacts => ({
    kstDate: day, stage: 'd50', decision: { kstDate: day, release: 'd50', decidedBy: DECISION_WRITER },
    readAtMs: pubAt + 9 * 3_600_000, posts, orphanPublishLogs: 0, unloggedPublishes: 0, audits: { rows: [] },
  })
  const withHot = judgeEvidenceForTarget(day, 'd50', 3, facts([post('a', h12(), true), post('b', h12() - 1, true), post('c', 7, false)]), null)
  const noHot = judgeEvidenceForTarget(day, 'd50', 3, facts([post('a', h12(), undefined), post('b', h12() - 1, undefined), post('c', 7, undefined)]), null)
  check('⑤ 🔴 증거 counts — 뜨거운 글 수 · 크기 하한에 닿은(대화 닫힘) 뜨거운 글 수',
    withHot.counts.hotPosts === 2 && withHot.counts.hotReachedSizeMin === 1 && noHot.counts.hotPosts === 0 && noHot.counts.hotReachedSizeMin === 0,
    JSON.stringify({ hot: [withHot.counts.hotPosts, withHot.counts.hotReachedSizeMin], none: [noHot.counts.hotPosts, noHot.counts.hotReachedSizeMin] }))
  check('⑤ 🔴 뜨거운 글은 판정을 바꾸지 않는다(gate 없음) — 같은 사실에 코드 · 판정이 같다',
    withHot.verdict === noHot.verdict && JSON.stringify([...withHot.codes].sort()) === JSON.stringify([...noHot.codes].sort())
    && withHot.counts.commentDepthAvg === noHot.counts.commentDepthAvg, `${withHot.verdict} · ${withHot.codes.join(',')}`)
}
function h12(): number { return hotLine?.hot?.sizeMin ?? 12 }

for (const l of lines) console.log(l)
console.log(`\n${failures === 0 ? '✅ PASS' : `❌ FAIL ${failures}건`} — 뜨거운 글 검사 ${lines.length}개`)
process.exit(failures === 0 ? 0 : 1)
