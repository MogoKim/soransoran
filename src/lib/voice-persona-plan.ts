/**
 * 생성 전 말투 Persona 선택 — 🔴 순수 판정. DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 **왜 생겼나** (2026-09-13).
 *
 *    옛 판은 `voiceSlotOf(sourceArticleId, live)` — **원천 ID 해시**로 골랐다.
 *    원문이 무엇을 요구하는지, 그 Persona 가 누구인지 보지 않았다.
 *    실측(외부 source 8건 · 정본 카드 25장):
 *      · 생성 **전** 생활사 충돌 3/8 — 비혼 Persona 에게 남편 글, 부모 없는 Persona 에게 돌봄 글
 *      · P03 혼자 3건 — 18명 중 6명만 쓰임
 *      · 그 결과 발행 단계 배정 3/8, 보류 5/8
 *
 *    쓸 수 없는 사람의 목소리로 **AI 생성부터 한 것**이 구조적 낭비다.
 *    막는 것이 아니라 **순서를 바꾸는 것**이 고치는 방향이다.
 *
 * 🔴 **판정 함수를 복제하지 않는다.** 생활사 판단은 발행 matcher 의
 *    `readPostRequirements` · `judgeLifeHistory` 정본을 **그대로** 부른다.
 *    여기서 조건을 새로 적으면 생성과 발행이 서로 다른 사람을 고르게 된다.
 *
 * 🔴 **`hardFilter` 전체를 부르지 않는다** (2026-09-13). active · 실회원 · 주간 cap ·
 *    최소 간격은 **발행 자리**의 조건이지 생성 시점의 생활사 적합성이 아니다.
 *    전체를 부르면 "이번 주에 이미 한 편 썼다" 는 이유로 그 사람의 목소리로
 *    **글을 쓰는 것 자체**가 막힌다. 초안은 다음 주에 나가면 된다.
 *
 * 🔴 **새 registry 도 새 정책표도 만들지 않는다.** Persona 정체성의 정본은
 *    Pool 카드 문서(`persona-pool-card.parsePoolDoc` → `cardToPersona`)이고,
 *    말투 근거의 정본은 `persona-reference-store.planBundles` 다. 이 파일은 둘을 맞춰 볼 뿐이다.
 *
 * 🔴 **발행 자리를 잡지 않는다.** 여기서 고르는 것은 "누구 목소리로 쓸까" 뿐이다.
 *    주간 cap · 최소 간격 · 활성 · 실회원 검사는 발행 시 `planBatch` 가 **다시** 한다.
 *
 * 🔴 **생활사 판정은 고확신 보조일 뿐 관문이 아니다** (2026-09-13).
 *    `readPostRequirements` 는 한국어의 1인칭 생략 때문에 반드시 샌다
 *    (`어제 남편이 늦게 들어왔어요` 에는 임자가 없다). 그러므로 이것으로
 *    **소재를 막지 않는다.** 맞으면 우선권을 줄 뿐이고, 실제 어긋남은
 *    다 쓴 글을 보고 판정한다(`micro-seed-auto-draft` 의 `lifeConflict`).
 */

import { readPostRequirements, judgeLifeHistory, type PersonaForMatch } from './original-post-persona-match'

/** 한 원천의 선택 결과 — 🔴 쓸 사람이 없으면 `personaCode` 가 `null` 이다 */
export type VoicePick = {
  sourceArticleId: string
  personaCode: string | null
  /**
   * 왜 이렇게 골랐는지 — 🔴 조용한 `null` 을 만들지 않는다.
   *    `noLifeFit` 은 **멈춘 것이 아니다.** 생활사가 맞는 사람이 없어
   *    가장 적게 맡은 사람에게 준 것이고, 생성 프롬프트가 관점을 바꿔 쓰게 한다.
   */
  reason: 'ok' | 'noLifeFit' | 'noVoiceBundle'
  /** 이 소재를 쓸 수 있었던 사람 수 — 관측값이다 */
  eligibleCount: number
}

export type VoicePlanInput = {
  /** 원천 — 🔴 제목과 본문 머리. 생활사 요구는 이것으로 읽는다 */
  sources: readonly { sourceArticleId: string; title: string; body: string }[]
  /**
   * 말투 근거가 선 Persona — 🔴 **정본 카드에서 온 것**이어야 한다.
   *    `cardToPersona(card)` 의 결과를 그대로 넘긴다. 여기서 만들지 않는다.
   */
  personas: readonly PersonaForMatch[]
}

export type VoicePlan = {
  picks: VoicePick[]
  /** Persona 별 생성 배정 수 — 🔴 편중을 눈으로 본다 */
  load: Record<string, number>
}

/**
 * 🔴 **생활사가 맞는 사람 중에서, 가장 적게 맡은 사람이 쓴다.**
 *
 *    ① 이 소재를 쓸 수 있는 사람을 `judgeLifeHistory` 정본으로 고른다
 *       (배우자 · 자녀 나이대 · 부모 돌봄 · 갱년기 · noGo 가 전부 여기 있다)
 *    ② 그중 **이번 batch 에서 가장 적게 맡은 사람**을 고른다
 *    ③ 동수면 **code 순** — 입력 순서가 달라도 같은 답이 나온다
 *
 * 🔴 **후보가 적은 소재를 먼저 처리한다.** 그래야 희소한 Persona 를 지킨다 —
 *    발행 matcher 의 `batchOrder` 와 같은 이유다(거기서 배운 것을 여기 옮겼다).
 *
 * 🔴 **순서가 결과를 바꾸지 않는다.** 처리 순서를 `(후보 수, sourceArticleId)` 로 고정하므로
 *    입력 배열을 뒤집어도 같은 배정이 나온다.
 */
export function planVoicePersonas(input: VoicePlanInput): VoicePlan {
  const personas = [...input.personas].sort((a, b) => a.code.localeCompare(b.code))
  if (personas.length === 0) {
    return {
      picks: input.sources.map((s) => ({
        sourceArticleId: s.sourceArticleId, personaCode: null,
        reason: 'noVoiceBundle', eligibleCount: 0,
      })),
      load: {},
    }
  }

  // ── ① 소재마다 쓸 수 있는 사람을 먼저 구한다 (배정 전) ──
  const eligibleOf = new Map<string, string[]>()
  for (const s of input.sources) {
    const req = readPostRequirements(s.title, s.body)
    const ok = personas
      // 🔴 **정본 그대로다.** 조건을 여기서 다시 적지 않는다 — 생활사·noGo 만 본다
      .filter((p) => judgeLifeHistory(p, req, s.title, s.body).length === 0)
      .map((p) => p.code)
    eligibleOf.set(s.sourceArticleId, ok)
  }

  // ── ② 희소한 소재부터 — 동수면 id 순(결정적) ──
  const ordered = [...input.sources].sort((a, b) => {
    const d = (eligibleOf.get(a.sourceArticleId)?.length ?? 0)
      - (eligibleOf.get(b.sourceArticleId)?.length ?? 0)
    return d !== 0 ? d : a.sourceArticleId.localeCompare(b.sourceArticleId)
  })

  // ── ③ 가장 적게 맡은 사람에게 — 동수면 code 순 ──
  const load: Record<string, number> = {}
  for (const p of personas) load[p.code] = 0
  const picked = new Map<string, VoicePick>()
  for (const s of ordered) {
    const fit = eligibleOf.get(s.sourceArticleId) ?? []
    /**
     * 🔴 **소재를 이유로 멈추지 않는다** (2026-09-13).
     *
     *    생활사가 맞는 사람이 없다는 것은 "그 사람이 그 사연의 주인공이 아니다" 일 뿐이다.
     *    곁에서 본 이야기 · 궁금해서 묻는 글로 얼마든지 쓸 수 있다.
     *    옛 판은 여기서 원천을 통째로 HOLD 했다 — 가족 · 자녀 · 돌봄처럼
     *    이 커뮤니티가 가장 많이 이야기하는 소재가 그렇게 사라졌다.
     *
     *    생활사 판정은 **고확신 보조**다. 맞으면 그 사람에게 우선 주고,
     *    없으면 가장 적게 맡은 사람에게 준다. 어긋남은 **다 쓴 글**에서 본다.
     */
    const ok = fit.length > 0 ? fit : personas.map((x) => x.code)
    let best = ok[0]!
    for (const code of ok) {
      const less = (load[code] ?? 0) < (load[best] ?? 0)
      if (less) best = code
    }
    load[best] = (load[best] ?? 0) + 1
    picked.set(s.sourceArticleId, {
      sourceArticleId: s.sourceArticleId, personaCode: best,
      reason: fit.length > 0 ? 'ok' : 'noLifeFit', eligibleCount: fit.length,
    })
  }

  // 🔴 입력 순서로 돌려준다 — 처리 순서는 내부 사정이다
  return { picks: input.sources.map((s) => picked.get(s.sourceArticleId)!), load }
}

/** 🔴 편중을 재는 값 — 가장 많이 맡은 수 − 가장 적게 맡은 수 (**쓰인 사람 기준**) */
export function loadSpread(load: Readonly<Record<string, number>>): number {
  const used = Object.values(load).filter((n) => n > 0)
  if (used.length === 0) return 0
  return Math.max(...used) - Math.min(...used)
}
