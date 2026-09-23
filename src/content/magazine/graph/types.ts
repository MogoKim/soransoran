// 🔴 자동 생성 — 제품이 읽는 최소 타입
export type MagazineRecommendationSlot =
  | 'DIRECT_NEXT' | 'SAME_EXPERIENCE' | 'ACTION_OR_CONTEXT' | 'BRIDGE_DISCOVERY'

export type MagazineGraphEdge = {
  id: string; from: string; to: string; type: string
  /** 🔴 관계에서 파생된 슬롯. COMMUNITY 는 null — 하단 추천 대상이 아니다 */
  slot: MagazineRecommendationSlot | null
  anchor: string
  /** 🔴 검증된 추천 이유. 런타임에서 만들지 않는다 */
  reason: string
  placement: string; priority: number
  fromCluster: string | null; toCluster: string | null
  active: boolean
}
export type MagazineGraph = {
  graphVersion: string
  schemaVersion: { intent: string; edge: string; mapping: string; manifest: string }
  contentHash: { intents: string; edges: string; mappings: string; combined: string }
  generatedAt: string
  edges: readonly MagazineGraphEdge[]
  mappings: readonly { intent: string; slug: string; cluster: string | null }[]
  intents: readonly { id: string; cluster: string | null; board: string }[]
}
export type MagazineGraphControl = {
  graphVersion: string
  enabled: boolean
  enabledClusters: readonly string[]
  surfaces: Readonly<Record<string, boolean>>
  killSwitch: { tripped: boolean; trippedAt: string | null; trippedBy: string | null; reason: string | null }
  previousGraphVersion: string | null
}
