import AdSenseUnit from '@/components/ads/AdSenseUnit'
import type { AdSlotKey } from '@/lib/ads/config'
import { adSlotGate } from '@/lib/ads/gate'

/**
 * 명시적 광고 슬롯 하나 — 서버에서 켬/끔을 판정한다.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §5 · §6.
 *
 * 🔴 gate 가 닫혀 있으면 null 이다. 감싸는 DOM · 예약 공간 · client 조각 · Google script 모두 나가지 않는다.
 * 🔴 publisher ID 와 광고 단위 ID 는 gate 가 열렸을 때만 client 로 넘어간다.
 */
export default function AdSlot({ slot }: { slot: AdSlotKey }) {
  const gate = adSlotGate(process.env, slot)
  if (!gate.active) return null
  return <AdSenseUnit clientId={gate.clientId} unitId={gate.unitId} />
}
