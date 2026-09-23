// 🔴 자동 생성 — kill switch 기본값.
//    환경변수가 이 파일보다 강하다: MGRAPH_GRAPH_KILL=1
//    🔴 다만 환경변수 변경은 현재 배포에 반영되지 않는다.
//       Vercel 환경변수를 바꾼 뒤 **재배포**해야 새 값이 적용된다.
import type { MagazineGraphControl } from './types'

export const CONTROL: MagazineGraphControl = {
  graphVersion: 'g-20260923-ad8e89',
  enabled: false,
  enabledClusters: [],
  surfaces: {"CTA_END":true,"FOOTER_NEXT":false,"FOOTER_SIBLING":false,"FOOTER_BRIDGE":false,"SERIES_NAV":false,"BODY_INLINE_OR_TOP":false,"BODY_CALLOUT":false},
  killSwitch: {"tripped":false,"trippedAt":null,"trippedBy":null,"reason":null},
  /**
   * 🔴 **제품에 실제 파일이 있는 버전만 적는다.** null 이면 롤백이 불가능하다.
   *    그때 되돌리는 길은 두 가지뿐이다 —
   *      ① MGRAPH_GRAPH_KILL=1 또는 enabled=false 로 **끄기** (기존 최신 3편으로 복귀)
   *      ② 연구 저장소에서 옛 버전을 다시 export 하고 배포
   *    스키마 경계(edge/2 → edge/3 처럼)에서는 ① 만 즉시 가능하다.
   */
  previousGraphVersion: null,
} as const

/**
 * 🔴 런타임 판정 — 환경변수가 파일보다 강하다.
 *    🔴 환경변수 변경은 현재 배포에 반영되지 않는다. 값 변경 + **재배포**가 필요하다.
 *       재배포가 끝나기 전까지는 요청 단위 폴백(resolver 예외·미공개 대상 제외)만 작동한다.
 *    어느 쪽이든 꺼지면 기존 getRelatedMagazineArticles 로 폴백한다.
 */
export function isGraphEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MGRAPH_GRAPH_KILL === '1') return false
  if (CONTROL.killSwitch.tripped) return false
  if (env.MGRAPH_GRAPH_ENABLED === '1') return true
  return CONTROL.enabled
}

export function enabledClusters(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = env.MGRAPH_GRAPH_CLUSTERS
  if (fromEnv) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean)
  return [...CONTROL.enabledClusters]
}
