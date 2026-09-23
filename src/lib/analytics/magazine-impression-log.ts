/**
 * 노출 중복 제거 — **세션당 항목별 1회**를 실제로 지킨다.
 *
 * 왜 컴포넌트 안의 변수로는 부족한가
 *   앞판은 `RelatedMagazineLink` 안의 `sent` 지역 변수로 막았다. 그것은
 *   **그 컴포넌트 인스턴스가 살아 있는 동안**만 유효하다. 다음 경우에 전부 뚫린다.
 *     · 목록이 다시 마운트된다 (라우팅·리렌더)
 *     · 뒤로 가기로 같은 글에 돌아온다
 *     · 한 세션 안에서 같은 글을 다시 방문한다
 *   그때마다 같은 추천이 새 노출로 세지고, **분모가 부풀어 클릭률이 실제보다 낮게** 나온다.
 *   분모가 틀리면 슬롯 구성을 바꿔 보든 개수를 늘려 보든 나아졌는지 알 수 없다.
 *
 * 🔴 **무엇을 한 항목으로 보는가.** 아래 다섯 값이 모두 같아야 같은 노출이다.
 *      graphVersion · fromSlug · targetSlug · source · slot
 *    그래서 그래프 버전이 올라가면 같은 조합도 **새 노출**로 센다 —
 *    버전이 다르면 다른 추천이기 때문이다. 같은 글에서 다른 추천이 뜨는 것도 당연히 새 노출이다.
 *
 * 🔴 **개인을 식별하지 않는다.** 저장하는 것은 위 다섯 값을 이어 붙인 키 목록뿐이다.
 *    userId·닉네임·시각 이력은 자리가 없다.
 *
 * 🔴 **sessionStorage 를 쓴다.** 탭을 닫으면 사라진다 — "세션당 1회" 의 세션이 그것이다.
 *    localStorage 를 쓰면 며칠 뒤 방문이 같은 세션으로 묶여 노출이 영영 다시 세지지 않는다.
 *
 * 🔴 **저장소 실패는 fail-open 이다.** 읽기·쓰기가 던지면 "아직 안 보냈다" 로 보고
 *    그냥 보낸다. 세는 쪽이 조금 헐거워지는 것이 렌더·이동이 막히는 것보다 낫다.
 */

const KEY = 'soran-magazine-impressions'

/** 한 세션에 쌓아 둘 최대 개수. 넘으면 오래된 것부터 버린다 */
export const MAX_KEYS = 500

export type ImpressionIdentity = {
  graphVersion: string
  fromSlug: string
  targetSlug: string
  source: string
  slot: string
}

/** 🔴 다섯 값을 모두 넣는다. 하나라도 빠지면 서로 다른 추천이 같은 것으로 묶인다 */
export function impressionKey(id: ImpressionIdentity): string {
  return [id.graphVersion, id.fromSlug, id.targetSlug, id.source, id.slot].join('|')
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // 🔴 접근 자체가 던지는 브라우저 설정이 있다
    return null
  }
}

function readKeys(store: Storage | null): string[] {
  if (!store) return []
  try {
    const raw = store.getItem(KEY)
    if (!raw) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    // 🔴 깨진 값. 사슬이 없는 것으로 본다 — 지우려 들지 않는다(그것도 던질 수 있다)
    return []
  }
}

/**
 * 이번에 보낼 노출인가.
 *
 * 🔴 **묻는 즉시 표시한다.** "물어보기" 와 "표시하기" 를 나누면 그 사이에
 *    같은 항목이 두 번 물어볼 수 있다(관측자가 두 번 발화하는 경우).
 *
 * @returns 보내야 하면 true. 이미 보냈으면 false
 */
export function shouldSendImpression(
  id: ImpressionIdentity,
  store: Storage | null = storage(),
): boolean {
  const key = impressionKey(id)
  const keys = readKeys(store)
  if (keys.includes(key)) return false

  // 🔴 저장에 실패해도 **보낸다.** 세는 쪽이 헐거워질 뿐 화면은 멀쩡하다.
  if (store) {
    try {
      const next = [...keys, key]
      // 오래된 것부터 버린다. 한 세션에 500개를 넘길 일은 사실상 없지만,
      // 저장소 한도를 넘겨 예외가 나는 쪽이 더 나쁘다.
      store.setItem(KEY, JSON.stringify(next.slice(-MAX_KEYS)))
    } catch {
      /* 🔴 삼킨다 */
    }
  }
  return true
}

/** 시험과 진단용 */
export function clearImpressions(store: Storage | null = storage()): void {
  if (!store) return
  try {
    store.removeItem(KEY)
  } catch {
    /* 삼킨다 */
  }
}
