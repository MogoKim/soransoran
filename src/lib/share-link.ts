/**
 * 링크 공유 — 외부 SDK 없이 브라우저 기능만 쓴다.
 *
 * 🔴 두 갈래를 구분해서 돌려준다. 공유 시트를 띄운 것과 링크를 복사한 것은
 *    사용자에게 다른 일이고, 안내 문구도 달라야 한다.
 *
 * 🔴 취소는 실패가 아니다. 공유 시트를 열었다가 닫은 사람에게
 *    "실패했어요" 를 띄우면 하지 않은 일을 잘못했다고 말하는 화면이 된다.
 */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

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
