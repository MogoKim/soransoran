import { toR2Key, isOwnPublicUrl } from '@/lib/r2-public'

/**
 * 본문에 붙어 있는 사진을 세는 자리.
 *
 * 🔴 우나어는 글을 지울 때 thumbnailUrl 한 장만 R2 에서 지운다.
 *    본문 안의 나머지 사진·동영상은 남는다 — 지운 글의 사진이 주소만 알면
 *    계속 열리고, 용량도 계속 든다. 그 구조를 그대로 가져오지 않으려고
 *    "지금 쓰이는 사진이 무엇인가" 를 먼저 셀 수 있게 해 둔다.
 *
 * 🔴 이 파일은 세기만 한다. 지우지 않는다.
 *    무엇을 지울지 계산할 수 있는 것과 지워도 되는 것은 다른 문제다 —
 *    같은 사진 주소가 여러 글에 붙어 있을 수 있고(복붙·재게시) 참조를 세는 곳이 없다.
 *    판단 근거는 docs/decisions/post-media-orphan-files.md 에 적었다.
 */

/** src="…" 만 본다. sanitize 를 지난 HTML 이라 img 속성은 이 형태뿐이다. */
const IMG_SRC = /<img\b[^>]*?\bsrc="([^"]+)"/gi

/** 본문에 실제로 박혀 있는 이미지 주소 — 나온 순서대로, 중복 없이. */
export function extractImageUrls(html: string): string[] {
  const found: string[] = []
  for (const match of html.matchAll(IMG_SRC)) {
    const url = match[1]
    if (url && !found.includes(url)) found.push(url)
  }
  return found
}

/** 그중 우리 R2 것만 — 외부에서 붙여넣은 주소는 우리가 지울 수 있는 것이 아니다. */
export function extractOwnImageUrls(html: string): string[] {
  return extractImageUrls(html).filter(isOwnPublicUrl)
}

/** 본문에서 쓰이는 우리 bucket key 목록. */
export function extractOwnImageKeys(html: string): string[] {
  return extractOwnImageUrls(html)
    .map(toR2Key)
    .filter((key): key is string => key !== null)
}

/**
 * 대표 사진 — 목록·공유 카드에 쓴다. 없으면 null.
 *
 * 🔴 첫 장을 쓴다. 사람이 제일 먼저 보여주려고 올린 것이 대개 첫 장이다.
 *
 * 🔴 우리 R2 사진만 고른다. 남의 서버에 걸린 주소를 대표로 담으면
 *    그쪽이 지우는 순간 우리 목록·공유 카드가 깨지고, 바꿔치기하면
 *    우리 카드에 다른 그림이 실린다. 우리가 통제할 수 없는 것을 대표로 세우지 않는다.
 *
 *    sanitize 가 이미 외부 img 를 지우므로 저장 경로에서는 걸릴 일이 없지만,
 *    이 함수는 sanitize 를 지나지 않은 문자열로도 불릴 수 있다.
 *    "지나서 부르기로 했다" 는 약속은 코드가 아니다.
 */
export function firstImageUrl(html: string): string | null {
  return extractOwnImageUrls(html)[0] ?? null
}

/**
 * 고치기 전후를 견줘 "이 글에서 빠진 사진" 을 낸다.
 *
 * 🔴 실제 삭제에 바로 연결하지 않는다. 이 목록은 "이 글에서 빠졌다" 는 뜻이지
 *    "아무 데서도 안 쓴다" 는 뜻이 아니다. 지우려면 다른 글의 본문까지
 *    한 번 더 세야 하고, 그 조회는 아직 만들지 않았다.
 */
export function removedImageKeys(beforeHtml: string, afterHtml: string): string[] {
  const after = new Set(extractOwnImageKeys(afterHtml))
  return extractOwnImageKeys(beforeHtml).filter((key) => !after.has(key))
}
