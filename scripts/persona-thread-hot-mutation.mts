#!/usr/bin/env tsx
/**
 * 뜨거운 글(밤 4) **변이 시험** — 막는 줄 하나를 바꾸면 `persona-thread-hot-check` 가 반드시 FAIL 해야 한다
 *
 *   npx tsx scripts/persona-thread-hot-mutation.mts
 *
 * 🔴 worktree 를 고치지 않는다. 세 모듈(목표 숫자 · 계획 · 판독)의 사본을 OS 임시 디렉터리에 쓰고, 서로의 import 는 사본으로 ·
 *    나머지 상대 import 는 절대 경로로 바꿔 검사에 `THREAD_TARGET_MODULE` · `THREAD_PLAN_MODULE` · `THREAD_HOT_MODULE` 로 주입한다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 하네스가 늘 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 * 🔴 판정이 hot 을 계획에 넘기는지 · 회차 순서(진척률)는 `persona-comment-followup-mutation` 이 잰다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '../src/lib')
type Mod = 'target' | 'plan' | 'hot'
const FILES: Record<Mod, string> = { target: 'persona-thread-target', plan: 'persona-thread-plan', hot: 'persona-thread-hot' }
const ENV: Record<Mod, string> = { target: 'THREAD_TARGET_MODULE', plan: 'THREAD_PLAN_MODULE', hot: 'THREAD_HOT_MODULE' }

type Mutation = { name: string; mod: Mod; from: string; to: string }
const MUTATIONS: Mutation[] = [
  // ── 목표 숫자 ──
  { name: '🔴 구조 상한에서 뜨거운 글 상한을 뺌(13번째부터 감사 FAIL)', mod: 'target',
    from: 'export const THREAD_SIZE_CAP = Math.max(...THREAD_TARGETS.map(threadLineSizeMaxOf))',
    to: 'export const THREAD_SIZE_CAP = Math.max(...THREAD_TARGETS.map((t) => threadSizeMaxOf(t.meanSize)))' },
  { name: '🔴 옛 줄의 글에도 뜨거운 글 칸을 소급', mod: 'target',
    from: '  return threadTargetAt(publishedAtMs).hot ?? null', to: '  return THREAD_TARGETS[THREAD_TARGETS.length - 1]!.hot ?? null' },
  // ── 계획 ──
  { name: '🔴 뜨거운 글 무시(계획이 hot 을 안 본다)', mod: 'plan',
    from: '  const hotLine = hot ? threadHotAt(publishedAtMs) : null', to: '  const hotLine = null as ThreadHot | null' },
  { name: '🔴 뜨거운 글 크기를 다른 씨앗으로', mod: 'plan',
    from: "const size = pick(cdf, unitOf('plan-size', postId))", to: "const size = pick(cdf, unitOf(hotLine === null ? 'plan-size' : 'plan-size-hot', postId))" },
  { name: '뜨거운 크기 확률이 ½ 이 아님', mod: 'plan',
    from: 'return binomialSizeCdf(hot.sizeMin, hot.sizeMax - hot.sizeMin, 0.5)', to: 'return binomialSizeCdf(hot.sizeMin, hot.sizeMax - hot.sizeMin, 0.7)' },
  // ── 판독 ──
  { name: '🔴 commentsPct 가 null 이면 뜨겁다(null → true)', mod: 'hot',
    from: "return typeof pct === 'number' && Number.isFinite(pct) && pct >= hot.commentsPctMin",
    to: "return pct === null || (typeof pct === 'number' && pct >= hot.commentsPctMin)" },
  { name: '🔴 원천 통계가 없으면 뜨겁다', mod: 'hot',
    from: '  if (!read.ok || read.record.sourceStats === null) return false',
    to: '  if (!read.ok) return false\n  if (read.record.sourceStats === null) return true' },
  { name: '🔴 조회 백분위로 대신한다', mod: 'hot',
    from: '  const pct = read.record.sourceStats.commentsPct', to: '  const pct = read.record.sourceStats.commentsPct ?? read.record.sourceStats.viewsPct' },
  { name: '문턱 그 값을 뺀다(≥ → >)', mod: 'hot', from: 'pct >= hot.commentsPctMin', to: 'pct > hot.commentsPctMin' },
  { name: '🔴 공개 시각 모름을 마지막 줄로 추정', mod: 'hot',
    from: '  if (publishedAtMs === null || !Number.isFinite(publishedAtMs)) return false\n', to: '' },
  { name: '같은 글 두 행(유일성 깨짐)을 모름으로 두지 않음', mod: 'hot', from: '  for (const id of dup) seen.set(id, null)\n', to: '' },
  { name: '🔴 PUBLISHED 아닌 큐 행도 읽음', mod: 'hot', from: "status: 'PUBLISHED' as const", to: 'status: undefined' },
]

const dir = mkdtempSync(join(tmpdir(), 'thread-hot-mut-'))
const pathOf = (m: Mod, tag: string): string => join(dir, `${FILES[m]}-${tag}.ts`)
const sources: Record<Mod, string> = {
  target: readFileSync(join(libDir, `${FILES.target}.ts`), 'utf-8'),
  plan: readFileSync(join(libDir, `${FILES.plan}.ts`), 'utf-8'),
  hot: readFileSync(join(libDir, `${FILES.hot}.ts`), 'utf-8'),
}
const run = (code: Record<Mod, string>, tag: string): number => {
  const rewire = (src: string): string => src.replace(/from '\.\/([^']+)'/g, (_m, p: string) => {
    const mod = (Object.keys(FILES) as Mod[]).find((k) => FILES[k] === p)
    return `from '${mod === undefined ? join(libDir, p) : pathOf(mod, tag)}'`
  })
  const env: Record<string, string> = {}
  for (const m of Object.keys(FILES) as Mod[]) {
    writeFileSync(pathOf(m, tag), rewire(code[m]))
    env[ENV[m]] = pathOf(m, tag)
  }
  const r = spawnSync('npx', ['tsx', join(here, 'persona-thread-hot-check.mts')], { env: { ...process.env, ...env }, encoding: 'utf-8' })
  return r.status ?? 99
}

let bad = 0
try {
  const base = run(sources, 'base')
  console.log(`${base === 0 ? '✅' : '❌'} 변이 없는 사본 → PASS (exit ${base})`)
  if (base !== 0) bad++
  MUTATIONS.forEach((m, i) => {
    const n = sources[m.mod].split(m.from).length - 1
    if (n !== 1) {
      bad++
      console.log(`❌ [${m.name}] 변이 자리가 ${n}곳이다(1곳이어야 한다) — 하네스가 낡았다`)
      return
    }
    const code = run({ ...sources, [m.mod]: sources[m.mod].replace(m.from, m.to) }, String(i))
    const killed = code !== 0
    if (!killed) bad++
    console.log(`${killed ? '✅' : '❌'} [${m.name}] → ${killed ? '검사가 잡았다' : '🔴 살아남았다(죽은 게이트)'} (exit ${code})`)
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad === 0 ? '✅ PASS' : `❌ FAIL ${bad}건`} — 변이 ${MUTATIONS.length}개 · worktree 변경 0`)
process.exit(bad === 0 ? 0 : 1)
