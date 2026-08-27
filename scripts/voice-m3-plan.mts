#!/usr/bin/env tsx
/**
 * VE-M3-5 전량 확대 계획 리포트 (읽기 전용)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-full-scale-plan.md
 *
 * 🔴 **이 파일에는 유료 경로가 없다.**
 *    `--apply` 도 `--confirm-paid-call` 도 받지 않는다. provider 를 import 하지 않는다.
 *    DB 는 **읽기만** 한다. 넘겨도 아무 일이 일어나지 않는 것이 아니라,
 *    **받을 수 있는 플래그 자체가 없다** — 그것이 이 명령의 안전 근거다.
 *
 * 🔴 왜 별도 명령인가
 *    `voice-m3-run` 은 "한 실행" 을 본다. 전량은 **194회의 실행**이고,
 *    거기서 물어야 할 것은 다른 질문이다 — 몇 번 돌아야 하는가 · 예산이 언제 바닥나는가 ·
 *    cap 에 걸리는 batch 가 있는가. 그 질문을 실행기에 섞으면 실행기가 위험해진다.
 *
 * 사용법
 *   npm run voice:m3-plan
 *   npm run voice:m3-plan -- --batch=50 --budget=54.84
 */
import { PrismaClient } from '@prisma/client'
import {
  M3_ANALYSIS_MODEL, M3_CAPS, M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION,
  pricingFor, outputTokenPolicyFor,
} from './lib/voice-m3-contract.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

/**
 * 🔴 입력 토큰 환산 계수 — **실측이다.**
 *
 * haiku 30건 실측: 입력 91,258 tok / (본문 17,976자 + 댓글 461개 × 60자) = 1.9997.
 * 계약 §E 의 `TOKENS_PER_CHAR = 1.3` 은 본문만 본 **가정**이었고,
 * payload 에는 instruction · schema · derivedSignals · legacyLabels 가 함께 들어간다.
 * 전량 추정에는 가정이 아니라 이 실측을 쓴다.
 */
const INPUT_TOK_PER_UNIT = 2.0
/** 댓글 1개의 글자 수 환산 (계약 §E) */
const CHARS_PER_COMMENT = 60

/** 출력 토큰 — haiku 30건 실측 평균. 상한 1,500 의 22% 였다 */
const MEASURED_OUTPUT_PER_ITEM = 333

/**
 * 🔴 수집 상한. 이 길이로 끝난 글은 **3,000자에서 잘린 것**이다.
 *    층화 표본 · 전량 모드가 똑같이 제외하며, 계획도 같은 기준을 쓴다.
 */
const TRUNCATED_LENGTH = 3000

async function main(): Promise<void> {
  await loadEnvLocal()

  const BATCH = Number(arg('batch') ?? M3_CAPS.itemLimit)
  const BUDGET = arg('budget') === undefined ? null : Number(arg('budget'))
  if (!Number.isInteger(BATCH) || BATCH < 1 || BATCH > M3_CAPS.itemLimit) {
    throw new Error(`--batch 는 1~${M3_CAPS.itemLimit} 정수여야 한다: ${arg('batch')}`)
  }

  const model = M3_ANALYSIS_MODEL
  const pricing = pricingFor(model)
  const policy = outputTokenPolicyFor(model)
  const prisma = new PrismaClient()

  console.log('\nVoice — VE-M3-5 전량 확대 계획 (읽기 전용)')
  console.log(`  모델 ${model} · 단가 $${pricing.inputPerMTok}/$${pricing.outputPerMTok} per MTok · 출처 ${pricing.source} (${pricing.checkedAt})`)
  console.log(`  🔴 이 명령에는 유료 경로가 없다. LLM 호출 0 · DB write 0`)
  console.log(`  ⚠️ 단가는 바뀐다. **실행 직전 공식 페이지와 다시 대조한다**\n`)

  try {
    // ── ① 전량 대상 산정 ───────────────────────────────
    const total = await prisma.voiceSource.count()
    // 🔴 수집 상한(3,000자)에서 잘린 글은 제외한다. 끝이 끊겨 흐름 · 구조 판정이 오염된다 —
    //    층화 표본(`isExcluded`)과 전량 모드(`selectFullModeBatch`)가 똑같이 제외하므로
    //    계획도 같은 모집단을 봐야 한다. 한쪽만 다르면 batch 경계가 어긋난다.
    const truncated = await prisma.voiceSource.count({ where: { contentLength: TRUNCATED_LENGTH } })
    const eligible = total - truncated
    const cached = await prisma.voiceM3Cache.groupBy({
      by: ['status'], where: { model }, _count: true,
    })
    const reusable = cached.find((c) => c.status === 'succeeded')?._count ?? 0
    const retryable = cached.filter((c) => c.status !== 'succeeded').reduce((a, c) => a + c._count, 0)
    const fresh = eligible - reusable - retryable
    const toCall = fresh + retryable

    console.log('  ① 전량 대상')
    console.log(`     VoiceSource 전체            ${total.toLocaleString()}건`)
    console.log(`     🔴 수집 상한 잘림 제외       ${truncated.toLocaleString()}건 (3,000자에서 끊긴 글)`)
    console.log(`     ── 분석 대상                ${eligible.toLocaleString()}건`)
    console.log(`     ✅ 재사용 (succeeded)        ${reusable.toLocaleString()}건 — 부르지 않는다`)
    console.log(`     🔁 재시도 (failed·skipped)   ${retryable.toLocaleString()}건`)
    console.log(`     🆕 신규                      ${fresh.toLocaleString()}건`)
    console.log(`     ── 실제 호출 대상            ${toCall.toLocaleString()}건`)

    // ── ② 토큰 · 비용 추정 (실측 환산) ─────────────────
    //    🔴 이미 성공한 건은 제외하고 센다 — 재사용분에 돈을 계상하면 예산이 부풀려진다
    const doneRefs = new Set(
      (await prisma.voiceM3Cache.findMany({
        where: { model, status: 'succeeded' }, select: { sourceRef: true },
      })).map((c) => c.sourceRef),
    )
    type Row = { sourceRef: string; contentLength: number | null; commentCount: number | null }
    const rows: Row[] = []
    for (let skip = 0; ; skip += 2000) {
      const b = await prisma.voiceSource.findMany({
        skip, take: 2000, orderBy: { id: 'asc' },
        select: { sourceRef: true, contentLength: true, commentCount: true },
      })
      if (b.length === 0) break
      rows.push(...b)
    }
    const pending = rows
      .filter((r) => r.contentLength !== TRUNCATED_LENGTH)
      .filter((r) => !doneRefs.has(r.sourceRef))
    const inTokOf = (r: Row): number =>
      Math.round(((r.contentLength ?? 0) + (r.commentCount ?? 0) * CHARS_PER_COMMENT) * INPUT_TOK_PER_UNIT)
    const inToks = pending.map(inTokOf)
    const inTotal = inToks.reduce((a, b) => a + b, 0)
    const sorted = [...inToks].sort((a, b) => b - a)
    const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0

    console.log('\n  ② 입력 토큰 (실측 환산 ×2.0)')
    console.log(`     합계 ${inTotal.toLocaleString()} tok · 평균 ${Math.round(inTotal / (pending.length || 1)).toLocaleString()}/건`)
    console.log(`     최대 ${(sorted[0] ?? 0).toLocaleString()} · p99 ${at(0.01).toLocaleString()} · p95 ${at(0.05).toLocaleString()} · 중앙 ${at(0.5).toLocaleString()}`)

    const scenarios: Array<[string, number]> = [
      ['실측 기준', MEASURED_OUTPUT_PER_ITEM],
      ['실측 ×2', MEASURED_OUTPUT_PER_ITEM * 2],
      ['보수 상한(출력 상한 전부)', policy.maxOutputTokens],
    ]
    console.log('\n  ③ 비용 시나리오')
    console.log(`     ${'시나리오'.padEnd(24)} ${'출력/건'.padStart(8)} ${'출력 합'.padStart(12)} ${'비용'.padStart(9)}${BUDGET === null ? '' : '   예산 대비'}`)
    for (const [label, per] of scenarios) {
      const outTotal = pending.length * per
      const usd = inTotal / 1e6 * pricing.inputPerMTok + outTotal / 1e6 * pricing.outputPerMTok
      const ratio = BUDGET === null ? '' : `   ${(usd / BUDGET * 100).toFixed(0)}%${usd > BUDGET ? ' 🔴 초과' : ''}`
      console.log(`     ${label.padEnd(24)} ${String(per).padStart(8)} ${outTotal.toLocaleString().padStart(12)} ${('$' + usd.toFixed(2)).padStart(9)}${ratio}`)
    }
    if (BUDGET !== null) console.log(`     예산 $${BUDGET.toFixed(2)}`)

    // ── ④ batch 분할 계획 ─────────────────────────────
    //    🔴 id 오름차순으로 자른다. 실행 순서가 재현 가능해야 재개할 수 있다.
    console.log(`\n  ④ batch 분할 (batch=${BATCH} · id 오름차순 · 잘린 글과 성공분 제외 후)`)
    const batches: Array<{ idx: number; n: number; inTok: number; totTok: number; usd: number }> = []
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH)
      const bin = slice.reduce((a, r) => a + inTokOf(r), 0)
      const bout = slice.length * policy.maxOutputTokens // 🔴 cap 판정은 최악값으로 한다
      batches.push({
        idx: batches.length + 1, n: slice.length, inTok: bin, totTok: bin + bout,
        usd: bin / 1e6 * pricing.inputPerMTok + (slice.length * MEASURED_OUTPUT_PER_ITEM) / 1e6 * pricing.outputPerMTok,
      })
    }
    const overCap = batches.filter((b) => b.totTok > M3_CAPS.tokenCap)
    const overDollar = batches.filter((b) => b.usd > M3_CAPS.dollarCap)
    const maxTot = Math.max(0, ...batches.map((b) => b.totTok))
    console.log(`     총 ${batches.length}회 · 최대 batch ${maxTot.toLocaleString()} tok (tokenCap ${M3_CAPS.tokenCap.toLocaleString()} 의 ${(maxTot / M3_CAPS.tokenCap * 100).toFixed(0)}%)`)
    console.log(`     🔴 tokenCap 초과 batch  ${overCap.length}개 ${overCap.length === 0 ? '✅' : `— #${overCap.slice(0, 5).map((b) => b.idx).join(',')}…`}`)
    console.log(`     🔴 dollarCap 초과 batch ${overDollar.length}개 ${overDollar.length === 0 ? '✅' : ''}`)
    console.log(`     batch 1건 평균 비용 $${(batches.reduce((a, b) => a + b.usd, 0) / (batches.length || 1)).toFixed(4)}`)

    if (BUDGET !== null) {
      let acc = 0, stopAt = 0
      for (const b of batches) { acc += b.usd; if (acc > BUDGET) { stopAt = b.idx; break } }
      console.log(`     예산 소진 예상: ${stopAt === 0 ? `없음 — 전량 완주 가능 (총 $${acc.toFixed(2)})` : `🔴 batch #${stopAt} 에서 $${BUDGET} 초과`}`)
    }

    // ── ⑤ cacheKey 중복 점검 ──────────────────────────
    const dupRefs = await prisma.voiceM3Cache.groupBy({
      by: ['sourceRef'], where: { model }, _count: true, having: { sourceRef: { _count: { gt: 1 } } },
    })
    console.log('\n  ⑤ cache 정합')
    console.log(`     cacheKey 8요소 · model=${model}(내부 라벨) · task=${M3_TASK_VERSION} · prompt=${M3_PROMPT_VERSION} · schema=${M3_OUTPUT_SCHEMA_VERSION}`)
    console.log(`     같은 sourceRef 중복 캐시   ${dupRefs.length}건 ${dupRefs.length === 0 ? '✅ (한 원문 한 번)' : '🔴'}`)
    console.log(`     재사용 대상 ${reusable}건은 호출 계산에서 제외됐다`)

    // ── ⑥ 🔴 실행 경로 점검 ───────────────────────────
    console.log('\n  ⑥ 실행 경로')
    console.log('     ✅ voice-m3-run --mode=full 이 전량 경로다 (VE-M3-5)')
    console.log('        selectStratifiedSample(매 실행 같은 N건)이 아니라')
    console.log('        "succeeded 제외 + id 오름차순 다음 N건" 으로 고른다.')
    console.log('        🔴 기본값은 여전히 --mode=sample 이다 — 전량은 명시해야 들어간다.')
    console.log('        🔴 유료 게이트 10중 · cap 3종 · 저장 전 유출 대조는 그대로다.')
    console.log(`        실행: npm run voice:m3-run -- --stage=stage1 --model=${model} --limit=${BATCH} --mode=full \\`)
    console.log('                 --apply --confirm-paid-call     ← 🔴 창업자 승인 후')

    console.log('\n  🔍 읽기만 했다. LLM 호출 0 · DB write 0 · 비용 0원\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e: unknown) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
