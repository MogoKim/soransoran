import {
  SIGNUP_FUNNEL_CONTENT_TYPES,
  SIGNUP_FUNNEL_STEPS,
  type SignupFunnelContentType,
  type SignupFunnelRatio,
  type SignupFunnelStep,
} from '@/lib/signup-funnel'
import type { SignupFunnelGate } from '@/lib/signup-funnel-gate'

/**
 * 가입 전환 어드민 — 누계 표와 운영 비율 계산. 순수 함수.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-6 · §8-7 · §8-10 · §10.
 *
 * 🔴 전체는 저장하지 않는다. 커뮤니티 + 매거진의 합이다.
 * 🔴 비율은 SIGNUP_FUNNEL_RATIOS 세 개뿐이다. 늘 분자/분모와 함께 쓰고, 분모가 0 이면 산정 불가다.
 *    100% 로 자르지 않는다 — 날짜 경계·중복 방지 단위가 단계마다 달라 100% 를 넘을 수 있고, 넘으면 넘은 채로 보인다.
 * 🔴 signup_complete 는 비율에 쓰지 않는다. 확인 건수로만 보인다.
 */

export const SIGNUP_FUNNEL_STEP_LABELS: Record<SignupFunnelStep, string> = {
  logged_out_view: '콘텐츠 열람',
  prompt_reach: '가입 제안 기준 도달',
  prompt_impression: '가입 제안 노출',
  auth_start: '카카오 시작',
  signup_complete: '확인된 가입 완료',
}

export type ConversionScope = 'all' | SignupFunnelContentType
export const CONVERSION_SCOPES: readonly ConversionScope[] = ['all', ...SIGNUP_FUNNEL_CONTENT_TYPES]
export const CONVERSION_SCOPE_LABELS: Record<ConversionScope, string> = { all: '전체', community: '커뮤니티', magazine: '매거진' }

export type ConversionRow = { step: string; contentType: string; count: number }
export type ConversionCounts = Record<SignupFunnelStep, Record<ConversionScope, number>>

/** 집계 줄 → 다섯 단계 × 세 범위. 없는 조합은 0, 허용값 밖 줄은 버린다 */
export function buildConversionCounts(rows: readonly ConversionRow[]): ConversionCounts {
  const counts = Object.fromEntries(
    SIGNUP_FUNNEL_STEPS.map((step) => [step, { all: 0, community: 0, magazine: 0 }]),
  ) as ConversionCounts
  for (const row of rows) {
    if (!(SIGNUP_FUNNEL_STEPS as readonly string[]).includes(row.step)) continue
    if (!(SIGNUP_FUNNEL_CONTENT_TYPES as readonly string[]).includes(row.contentType)) continue
    counts[row.step as SignupFunnelStep][row.contentType as SignupFunnelContentType] += row.count
  }
  for (const step of SIGNUP_FUNNEL_STEPS) counts[step].all = counts[step].community + counts[step].magazine
  return counts
}

/** '12 / 30 · 40.0%' — 분모 0 이면 '0 / 0 · 산정 불가'. 자르지 않는다 */
export function formatRatio(numerator: number, denominator: number): string {
  if (denominator === 0) return `${numerator} / 0 · 산정 불가`
  return `${numerator} / ${denominator} · ${((numerator / denominator) * 100).toFixed(1)}%`
}

export function ratioValue(ratio: SignupFunnelRatio, counts: ConversionCounts, scope: ConversionScope): string {
  return formatRatio(counts[ratio.numerator][scope], counts[ratio.denominator][scope])
}

/** gate 가 닫힌 이유 → 상태 낱말과 짧은 설명 */
export function conversionGateNotice(gate: SignupFunnelGate): { status: string; description: string } {
  if (gate.active) return { status: '수집 중', description: `${gate.startDay}부터 ${gate.today}(KST)까지의 누계입니다.` }
  switch (gate.reason) {
    case 'not_production':
      return { status: '비활성', description: 'Production 환경에서만 수집합니다. 이 환경의 숫자는 없습니다.' }
    case 'start_invalid':
      return { status: '수집 전', description: '수집 시작일이 정해지지 않았습니다. 시작 전 기간은 0 이 아니라 알 수 없음(UNKNOWN)입니다.' }
    case 'before_start':
      return { status: '수집 전', description: '수집 시작일이 아직 오지 않았습니다. 시작 전 기간은 0 이 아니라 알 수 없음(UNKNOWN)입니다.' }
  }
}
