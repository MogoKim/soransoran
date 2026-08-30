/**
 * Persona Safety Gate ⑨ — Source Community Marker (외부 커뮤니티 흔적)
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3-⑨
 *
 * 🔴 **20자 유출이 없어도 외부 커뮤니티 내부 호칭이 남으면 소란소란 글이 아니다.**
 *    ①이 잡는 것은 *문장의 복제*이고, ⑨가 잡는 것은 *출처의 흔적*이다.
 *    원문을 한 글자도 베끼지 않고도 출처 공동체의 말버릇은 그대로 따라온다.
 *    그건 표절이 아니라 **재맥락화 실패**다 — 읽는 사람은 여기서 쓴 글이 아님을 안다.
 *
 * 🔴 ⑤ 와 섞지 않는다
 *      ⑤ 브랜드 정책   원문에 없어도 **만들면 안 되는 말** (우리 또래분들 · 어르신)
 *      ⑨ 출처 세탁     원문에 있으니 **지워야 하는 말** (레테님들 · 우리 카페)
 *    실패했을 때 조치가 다르다 — ⑤는 표현 교체, ⑨는 **호칭이 필요한지부터 재검토**.
 *
 * 🔴 sourceSite 로 검사 범위를 좁히지 않는다
 *    wgang 에서 온 글에 '레테님들' 이 나올 수 있다 — 원문의 인용, 모델의 혼입,
 *    학습 anchor 오염 어느 쪽이든 가능하다. sourceSite 는 **로그의 맥락**일 뿐이고
 *    스캔은 항상 SOURCE_SPECIFIC_TERMS 전부로 한다.
 *
 * 🔴 단순 일괄 치환을 전제하지 않는다
 *    "82님들" → "소란소란님들" 로 바꾸면 문장은 통과하지만 말투가 죽고,
 *    모든 페르소나가 같은 호칭을 쓰면 그것 자체가 ⑧ Voice Fingerprint 에 걸린다.
 *    ⑨의 처방은 치환어 찾기가 아니라 **그 자리에 호칭이 필요한가**를 묻는 것이다.
 *
 * 🔴 이 파일이 하지 않는 것
 *      · 생성 파이프라인 연결 (판정부일 뿐이다)
 *      · DB 접근 · LLM/API 호출 · 파일 IO · 네트워크
 *      · ⑤ 판정 — persona-gate-forbidden-address.mts 가 따로 한다
 */
import { computeCommunityRegister, type CafeSense } from './voice-style-signals.mjs'

/**
 * ⑨ 는 ⑤ 와 달리 **중간(review)이 있다.**
 * '카페' 가 커피숍인지 커뮤니티인지는 기계가 늘 가릴 수 없고,
 * 애매한 것을 regenerate 로 보내면 정상 생성물이 3회 만에 폐기된다.
 */
export type SourceMarkerStatus = 'pass' | 'review' | 'regenerate' | 'reject'

export type SourceMarkerHit =
  /** 출처 호칭 — SOURCE_SPECIFIC_TERMS */
  | { kind: 'site'; term: string; site: string; count: number }
  /** 출처 맥락 — SOURCE_CONTEXT_TERMS */
  | { kind: 'context'; term: string; tier: 'strong' | 'ambiguous'; count: number }

export type SourceMarkerVerdict = {
  status: SourceMarkerStatus
  /** 🔴 term 은 전부 상수 목록에서 온 값이다. 원문에서 잘라내지 않는다 */
  hits: SourceMarkerHit[]
  /** ambiguous 판정 근거 — 운영자가 review 를 볼 때 필요하다 */
  cafeSense: CafeSense
  /** 로그 맥락. 🔴 검사 범위를 좁히는 데 쓰지 않는다 */
  sourceSite?: string
  /** 🔴 로그용 한 줄. **원문 조각을 담지 않는다** — 상수 term 만 적는다 */
  reason: string
}

export type SourceMarkerOptions = {
  /** 로그에만 쓴다. 없어도 스캔 범위는 동일하다 */
  sourceSite?: string
  /**
   * 🔴 출처 자체가 카페 운영 · 공지 · 광고 문맥인가.
   *    ⑨ 가 판정하지 않는다 — 후보 선별 단계에서 이미 걸러졌어야 하고,
   *    ⑨ 는 그 플래그를 받아 reject 로 올릴 뿐이다.
   */
  sourceIsCafeOperational?: boolean
}

/**
 * 생성물에 외부 커뮤니티의 흔적이 남았는지 판정한다.
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO 없이 문자열만 본다.
 */
export function checkSourceMarker(
  outputText: string,
  opts: SourceMarkerOptions = {},
): SourceMarkerVerdict {
  const reg = computeCommunityRegister(outputText ?? '')

  const hits: SourceMarkerHit[] = [
    // 🔴 sourceSite 로 거르지 않는다. 8개 전부 스캔한 결과를 그대로 쓴다
    ...reg.sourceSpecific.map((s): SourceMarkerHit => ({
      kind: 'site', term: s.term, site: s.site, count: s.count,
    })),
    ...reg.sourceContextRisk.map((c): SourceMarkerHit => ({
      kind: 'context', term: c.term, tier: c.tier, count: c.count,
    })),
  ]

  const site = hits.filter((h) => h.kind === 'site')
  const strong = hits.filter((h) => h.kind === 'context' && h.tier === 'strong')
  const ambiguous = hits.filter((h) => h.kind === 'context' && h.tier === 'ambiguous')

  const status = decide({
    hasSite: site.length > 0,
    hasStrong: strong.length > 0,
    hasAmbiguous: ambiguous.length > 0,
    cafeSense: reg.cafeSense,
    operational: opts.sourceIsCafeOperational === true,
  })

  const parts: string[] = []
  if (site.length > 0) parts.push(`출처 호칭 ${site.map((h) => h.term).join(' · ')}`)
  if (strong.length > 0) parts.push(`출처 맥락 ${strong.map((h) => h.term).join(' · ')}`)
  if (ambiguous.length > 0) {
    parts.push(`카페 표현 ${ambiguous.map((h) => h.term).join(' · ')} (${reg.cafeSense})`)
  }
  if (opts.sourceIsCafeOperational === true) parts.push('출처가 카페 운영/공지/광고 문맥')

  const verdict: SourceMarkerVerdict = {
    status,
    hits,
    cafeSense: reg.cafeSense,
    reason: parts.length > 0 ? parts.join(' / ') : '출처 흔적 없음',
  }
  if (opts.sourceSite !== undefined) verdict.sourceSite = opts.sourceSite
  return verdict
}

/**
 * 🔴 판정 순서가 곧 정책이다.
 *
 *    reject 가 가장 앞이다 — 출처가 카페 운영/공지/광고면 재생성해도 해결되지 않는다.
 *    strong · site 는 확정이다 — 커뮤니티 문맥에서만 성립하는 말이다.
 *    ambiguous 는 마지막이고, **단독으로 regenerate 하지 않는다.**
 */
function decide(f: {
  hasSite: boolean
  hasStrong: boolean
  hasAmbiguous: boolean
  cafeSense: CafeSense
  operational: boolean
}): SourceMarkerStatus {
  const anyMarker = f.hasSite || f.hasStrong || f.hasAmbiguous
  // 🔴 재생성으로 해결되지 않는다. 후보 자체를 버린다
  if (f.operational && anyMarker) return 'reject'
  // 출처 호칭 · strong 맥락은 단서와 무관하게 확정이다
  if (f.hasSite || f.hasStrong) return 'regenerate'
  if (!f.hasAmbiguous) return 'pass'
  // 🟡 '카페' 가 커피숍인지 커뮤니티인지에 달렸다
  if (f.cafeSense === 'community') return 'regenerate'
  if (f.cafeSense === 'shop') return 'pass'      // 🟢 커피숍 이야기는 정상 소재다
  return 'review'                                 // unknown — 사람이 본다
}
