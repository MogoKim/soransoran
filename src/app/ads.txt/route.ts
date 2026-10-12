import { adsTxtBody } from '@/lib/ads/gate'

/**
 * `/ads.txt` — AdSense 사이트 소유권 확인과 판매자 인증.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §7 · §8.
 *
 * 🔴 publisher ID 는 env 에서만 읽는다. 저장소에 정적 파일로 두지 않는다.
 * 🔴 광고 스위치와 분리한다 — 광고가 꺼져 있어도 값이 있으면 응답한다.
 * 🔴 요청마다 읽는다. 정적으로 굳히면 빌드 시점의 env 가 남는다.
 */
export const dynamic = 'force-dynamic'

const TEXT = 'text/plain; charset=utf-8'

export function GET(): Response {
  const body = adsTxtBody(process.env)
  if (body === null) {
    return new Response('Not Found\n', {
      status: 404,
      headers: { 'content-type': TEXT, 'cache-control': 'no-store' },
    })
  }
  return new Response(body, {
    status: 200,
    headers: { 'content-type': TEXT, 'cache-control': 'public, max-age=3600, s-maxage=3600' },
  })
}
