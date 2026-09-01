/**
 * 링크 공유 — 브라우저 기능(Web Share·클립보드)과 카카오 SDK 두 갈래를 함께 둔다.
 *
 * 🔴 결과를 갈래로 돌려준다. 공유 시트를 띄운 것과 링크를 복사한 것은
 *    사용자에게 다른 일이고, 안내 문구도 달라야 한다.
 *
 * 🔴 취소는 실패가 아니다. 공유 시트를 열었다가 닫은 사람에게
 *    "실패했어요" 를 띄우면 하지 않은 일을 잘못했다고 말하는 화면이 된다.
 *
 * 🔴 카카오가 안 되는 순간에도 사람은 링크를 얻어 나간다.
 *    키 미설정·도메인 미등록·SDK 로드 실패는 모두 같은 자리로 떨어진다 — 링크 복사.
 *    막다른 길을 만들지 않는 것이 이 파일의 성격이다.
 */
import { SITE } from '@/lib/brand'

interface KakaoShareOptions {
  objectType: 'feed'
  content: {
    title: string
    description: string
    imageUrl: string
    imageWidth: number
    imageHeight: number
    link: { mobileWebUrl: string; webUrl: string }
  }
  buttons: Array<{ title: string; link: { mobileWebUrl: string; webUrl: string } }>
}

declare global {
  interface Window {
    Kakao?: {
      init: (key: string) => void
      isInitialized: () => boolean
      Share?: { sendDefault: (options: KakaoShareOptions) => void }
    }
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/** 카카오 갈래의 결과. 'copied' 는 카카오를 못 써서 링크 복사로 대신한 경우다. */
export type KakaoShareOutcome = 'shared' | 'copied' | 'failed'

export function postShareUrl(path: string): string {
  return `${window.location.origin}${path}`
}

async function copyToClipboard(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/** 링크만 복사한다 — 공유 시트를 띄우지 않는다. */
export async function copyShareLink(path: string): Promise<boolean> {
  return copyToClipboard(postShareUrl(path))
}

/** 이 기기가 OS 공유 시트를 열 수 있는가. 버튼을 그릴지 정하는 데 쓴다. */
export function canWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

export async function shareOrCopy(title: string, path: string): Promise<ShareOutcome> {
  const url = postShareUrl(path)

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (error) {
      // 사용자가 닫은 것과 기기가 못 여는 것을 가른다
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  return (await copyToClipboard(url)) ? 'copied' : 'failed'
}

// ── 카카오톡 공유 ────────────────────────────────────────────

const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js'
const KAKAO_SDK_ELEMENT_ID = 'kakao-js-sdk'

/** 카드 아래 버튼. "자세히 보기" 는 설명서 말투다 — 읽으러 가는 걸음으로 적는다. */
const KAKAO_BUTTON_LABEL = '이야기 보러 가기'

let sdkLoadStarted = false

function initKakaoIfNeeded(): void {
  const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
  const kakao = window.Kakao
  if (!key || !kakao) return
  try {
    if (!kakao.isInitialized()) kakao.init(key)
  } catch {
    // init 실패는 삼킨다 — 클릭 시 미준비로 판정되어 링크 복사로 내려간다
  }
}

/**
 * 공유 버튼이 있는 화면이 마운트될 때 부른다 — 클릭 전에 SDK 를 미리 올려둔다.
 *
 * 🔴 전역 layout 에서 부르지 않는다. 홈·목록까지 매번 외부 스크립트를 받게 되고,
 *    정작 공유는 글 상세에서만 일어난다.
 */
export function preloadKakaoSdk(): void {
  if (typeof window === 'undefined') return
  if (!process.env.NEXT_PUBLIC_KAKAO_JS_KEY) return

  try {
    if (window.Kakao?.isInitialized?.()) return
  } catch {
    /* 판정 실패는 아래에서 로드/초기화를 다시 시도한다 */
  }

  if (document.getElementById(KAKAO_SDK_ELEMENT_ID)) {
    initKakaoIfNeeded()
    return
  }
  if (sdkLoadStarted) return
  sdkLoadStarted = true

  const script = document.createElement('script')
  script.id = KAKAO_SDK_ELEMENT_ID
  script.src = KAKAO_SDK_URL
  script.async = true
  script.crossOrigin = 'anonymous'
  script.onload = initKakaoIfNeeded
  script.onerror = () => {
    // 다음 방문에서 다시 받아볼 수 있게 흔적을 지운다.
    // 그 사이 클릭은 미준비로 판정되어 링크 복사로 내려간다.
    sdkLoadStarted = false
    script.remove()
  }
  document.head.appendChild(script)
}

/**
 * 카카오톡 공유창을 연다. 못 열면 링크를 복사해 돌려준다.
 *
 * 🔴 sendDefault() 앞에 await 를 두지 마라. async 함수는 첫 await 까지 동기로 흐르고,
 *    이 함수는 그 성질에 기대고 있다. 기다렸다 부르면 iOS Safari 가 사용자 조작으로
 *    보지 않아 공유창이 열리지 않는다.
 *
 * 🔴 description 에 본문을 넣지 않는다. 카드 문구는 브랜드 한 줄로 고정한다.
 *    imageUrl 이 가리키는 OG 라우트는 검색 비노출 글을 스스로 걸러 브랜드 카드를
 *    내보내는데, 여기서 본문을 실어 보내면 그 판정을 우회하게 된다.
 */
export async function shareToKakao(title: string, path: string): Promise<KakaoShareOutcome> {
  const url = postShareUrl(path)

  // ↓ 여기부터 sendDefault() 까지 await 없음 (iOS user gesture 보존)
  const kakao = window.Kakao
  const share = kakao?.Share
  let ready = false
  try {
    ready = Boolean(kakao?.isInitialized?.()) && typeof share?.sendDefault === 'function'
  } catch {
    ready = false
  }

  if (share && ready) {
    const link = { mobileWebUrl: url, webUrl: url }
    try {
      share.sendDefault({
        objectType: 'feed',
        content: {
          title,
          description: SITE.tagline,
          imageUrl: `${url}/opengraph-image`,
          // 가로형(1.91:1) 을 적어준다 — 안 적으면 카카오가 정사각으로 잘라낸다
          imageWidth: 1200,
          imageHeight: 630,
          link,
        },
        buttons: [{ title: KAKAO_BUTTON_LABEL, link }],
      })
      return 'shared'
    } catch {
      // 도메인 미등록 등으로 막힌 경우 — 아래 링크 복사로 내려간다
    }
  }

  return (await copyToClipboard(url)) ? 'copied' : 'failed'
}
