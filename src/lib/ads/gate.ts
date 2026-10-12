import 'server-only'

import {
  AD_PAGES,
  AD_SLOTS,
  AD_SWITCH_ON,
  ADS_GLOBAL_ENV,
  ADSENSE_PUBLISHER_ENV,
  isAdSensePublisherId,
  isAdSenseUnitId,
  type AdSlotKey,
} from '@/lib/ads/config'

/**
 * 광고 gate — "이 슬롯을 지금 그려도 되는가" 와 "`/ads.txt` 에 무엇을 내보내는가" 를 판정한다.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §6 · §7 · §8.
 *
 * 🔴 다섯 조건이 **모두** 맞을 때만 연다.
 *      1. VERCEL_ENV === 'production'
 *      2. 전체 스위치 on
 *      3. 페이지 스위치 on
 *      4. 슬롯 스위치 on
 *      5. publisher ID · 광고 단위 ID 형식이 맞다
 *    하나라도 아니면 슬롯 DOM · 예약 공간 · script · 광고 요청이 모두 0 이다.
 * 🔴 env 가 없거나 틀려도 throw 하지 않는다 — 닫힌 것으로 판정한다. 광고 설정 오류가 화면을 깨면 안 된다.
 * 🔴 env 를 인자로 받는다. 이 파일이 `process.env` 를 직접 읽지 않아야 시험이 모든 조합을 재현할 수 있다.
 * 🔴 `/ads.txt` 는 광고 스위치와 분리한다. 광고가 꺼져 있어도 사이트 소유권 확인은 되어야 한다(정본 §8).
 */

export type AdEnv = Readonly<Record<string, string | undefined>>

export type AdSlotGate =
  | { active: true; clientId: string; unitId: string }
  | {
      active: false
      reason:
        | 'not_production'
        | 'global_off'
        | 'page_off'
        | 'slot_off'
        | 'publisher_invalid'
        | 'unit_invalid'
    }

export function adSlotGate(env: AdEnv, slot: AdSlotKey): AdSlotGate {
  const config = AD_SLOTS[slot]
  if (env.VERCEL_ENV !== 'production') return { active: false, reason: 'not_production' }
  if (env[ADS_GLOBAL_ENV] !== AD_SWITCH_ON) return { active: false, reason: 'global_off' }
  if (env[AD_PAGES[config.page].switchEnv] !== AD_SWITCH_ON) return { active: false, reason: 'page_off' }
  if (env[config.switchEnv] !== AD_SWITCH_ON) return { active: false, reason: 'slot_off' }

  const publisherId = env[ADSENSE_PUBLISHER_ENV]
  if (!isAdSensePublisherId(publisherId)) return { active: false, reason: 'publisher_invalid' }
  const unitId = env[config.unitEnv]
  if (!isAdSenseUnitId(unitId)) return { active: false, reason: 'unit_invalid' }

  return { active: true, clientId: `ca-${publisherId}`, unitId }
}

/** `/ads.txt` 본문 — publisher ID 가 없거나 형식이 틀리면 null(404) */
export function adsTxtBody(env: AdEnv): string | null {
  const publisherId = env[ADSENSE_PUBLISHER_ENV]
  if (!isAdSensePublisherId(publisherId)) return null
  // Google 이 정한 한 줄 형식. 마지막 값은 Google 의 인증 기관 ID 다(계정마다 같다).
  return `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`
}
