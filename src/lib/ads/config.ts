/**
 * 광고 설정표 — 어떤 페이지에 어떤 슬롯이 있고, 무엇이 그 슬롯을 켜는지만 적는다.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §5 · §6.
 *
 * 🔴 켬 값은 여기 두지 않는다. 전체 · 페이지 · 슬롯 스위치는 env 이고, 값이 정확히 `on` 이 아니면 꺼짐이다.
 *    그래서 env 를 하나도 넣지 않은 상태가 곧 기본 OFF 다.
 * 🔴 publisher ID · 광고 단위 ID 는 저장소에 적지 않는다. env 이름과 형식만 둔다.
 * 🔴 슬롯을 늘릴 때는 이 표에 한 줄을 더하고 그 페이지에 `<AdSlot>` 하나를 둔다.
 *    한 번에 노출 변수 하나만 바꾼다(정본 §12).
 */

/** 이 값만 켬이다. `true` · `1` · `ON` 같은 다른 표기는 꺼짐으로 본다 */
export const AD_SWITCH_ON = 'on'

/** 전체 kill switch */
export const ADS_GLOBAL_ENV = 'ADS_ENABLED'

/** publisher ID(`pub-` + 16자리). 광고 client ID 와 `/ads.txt` 가 같은 값 하나를 쓴다 */
export const ADSENSE_PUBLISHER_ENV = 'ADSENSE_PUBLISHER_ID'

const ADSENSE_PUBLISHER_RE = /^pub-\d{16}$/
const ADSENSE_UNIT_RE = /^\d{10}$/

export const AD_PAGES = {
  home: { switchEnv: 'ADS_PAGE_HOME' },
} as const

export type AdPage = keyof typeof AD_PAGES

type AdSlotConfig = {
  page: AdPage
  provider: 'adsense'
  /** 슬롯 스위치 */
  switchEnv: string
  /** AdSense 광고 단위 ID(10자리) */
  unitEnv: string
}

export const AD_SLOTS = {
  'home-bottom': {
    page: 'home',
    provider: 'adsense',
    switchEnv: 'ADS_SLOT_HOME_BOTTOM',
    unitEnv: 'ADSENSE_UNIT_HOME_BOTTOM',
  },
} as const satisfies Record<string, AdSlotConfig>

export type AdSlotKey = keyof typeof AD_SLOTS

export function isAdSensePublisherId(value: string | undefined): value is string {
  return typeof value === 'string' && ADSENSE_PUBLISHER_RE.test(value)
}

export function isAdSenseUnitId(value: string | undefined): value is string {
  return typeof value === 'string' && ADSENSE_UNIT_RE.test(value)
}
