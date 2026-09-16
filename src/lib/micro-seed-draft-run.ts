/**
 * 생성 · 복제 재생성 한 묶음 — 🔴 **효과를 주입받는 orchestrator. I/O 를 하지 않는다**
 *
 * 정본: `docs/operations/2026-08-30-persona-safety-originality-gate-design.md` §4 · §8
 *
 * 🔴 **왜 여기 따로 있는가.** `micro-seed-auto-draft.ts` 는 `await` 조차 없는
 *    순수 동기 판정만 두기로 한 파일이다(fixture 가 그것을 지킨다).
 *    이 함수는 생성 호출 **순서**를 갖는 orchestrator라 비동기다 —
 *    대신 provider · 캐시 · 복제 판정을 **전부 주입받아** 스스로는 아무것도 하지 않는다.
 *    `runtime-deploy.ts` 의 `runDeploy` 와 같은 모양이다.
 *
 * 🔴 **새 정책을 만들지 않는다.** 위기 판정은 `judgeDraftGate` 하나가 한다.
 */
import { judgeDraftGate } from './micro-seed-auto-draft'

/**
 * 🔴 **생성 · 복제 재생성 한 묶음** — 러너가 실제로 쓰는 실행 경로다 (2026-09-16).
 *
 *    옛 판은 복제 재생성 루프가 러너 안에 인라인으로 있었고, 위기 판정은 그 **뒤**에
 *    있었다. 그래서 *"위기 초안이 복제 조건까지 만족하면 다시 생성을 부른다"* 는
 *    결함이 그대로 남아 있었다 — 위기 소재로 토큰을 한 번 더 쓰는 길이다.
 *
 *    🔴 여기서 새 정책을 만들지 않는다. 판정은 `judgeDraftGate` 하나가 한다.
 *    🔴 효과(생성 호출 · 복제 판정)는 주입받는다 — 그래야 가짜 provider 로
 *       **실제 이 경로**를 셀 수 있다.
 */
export type GenDraftText = { title: string; body: string }
export type DraftRunEffects<T extends GenDraftText> = {
  /** 생성 호출. `retryReason` 이 있으면 복제 재생성이다 */
  generate: (retryReason: string | null) => Promise<T[] | null>
  /** 🔴 초안이 **전부** 원문을 옮겼는가 — 복제 판정 정본은 부르는 쪽이 갖는다 */
  allCopied: (drafts: readonly T[]) => boolean
  /** 복제 사유 라벨 — 재생성 지시문에 쓴다 */
  copyReason: (drafts: readonly T[]) => string
}
export type DraftRunResult<T extends GenDraftText> = {
  drafts: T[] | null
  /** 🔴 **실제 생성 호출 수.** 캐시로 받았으면 0 이다 */
  generateCalls: number
  /** 🔴 위기로 멈췄으면 사유가 남는다. 한 번 서면 되돌리지 않는다 */
  crisisStop: 'crisisSignal' | null
  fromCache: boolean
}

export async function generateWithRetries<T extends GenDraftText>(input: {
  maxRetries: number
  /** 생성 캐시가 준 초안. 없으면 `null` */
  cached: T[] | null
}, fx: DraftRunEffects<T>): Promise<DraftRunResult<T>> {
  const stop = (drafts: readonly GenDraftText[]): 'crisisSignal' | null =>
    judgeDraftGate({ drafts, allLifeConflict: false }).reason

  if (input.cached !== null) {
    // 🔴 캐시로 받은 초안에도 같은 계약을 건다 — 옛 결과라고 통과시키지 않는다
    return { drafts: input.cached, generateCalls: 0, crisisStop: stop(input.cached), fromCache: true }
  }
  let calls = 0
  let drafts = await fx.generate(null)
  calls += 1
  for (let n = 0; n < input.maxRetries; n += 1) {
    if (drafts === null) break
    /**
     * 🔴 **복제 재생성보다 위기 판정이 먼저다.** 순서가 뒤집히면
     *    위기 소재로 생성을 한 번 더 부른다 — 실측 결함이 이 자리였다.
     */
    const why = stop(drafts)
    if (why !== null) return { drafts, generateCalls: calls, crisisStop: why, fromCache: false }
    if (!fx.allCopied(drafts)) break
    drafts = await fx.generate(fx.copyReason(drafts))
    calls += 1
  }
  return {
    drafts,
    generateCalls: calls,
    crisisStop: drafts === null ? null : stop(drafts),
    fromCache: false,
  }
}

