/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    // 우나어의 remotePatterns 를 그대로 가져오지 않는다.
    //
    // 🔴 지금 production 이 쓰는 R2 공개 host 하나만 연다.
    //    와일드카드 호스트(*.r2.dev)를 쓰지 않는다 — 그것은 남의 bucket 까지 여는 문이다.
    //
    // 🔴 pathname 을 /hero-banners/** 로 좁힌다. 회원 사진(posts/**)은
    //    글 본문에서 sanitize 를 지나 <img> 로 나가고 next/image 를 타지 않는다 —
    //    여기서 함께 열면 쓰지 않는 문이 하나 더 생긴다.
    //
    // 🔴 부채: r2.dev 는 Cloudflare 개발용 주소다. PR 3 (홈 동적 노출) 전에
    //    img.soransoran.com 커스텀 도메인으로 바꾼다. 그때 이 값과
    //    NEXT_PUBLIC_R2_PUBLIC_URL 을 함께 옮긴다 — 한쪽만 바꾸면 이미지가 통째로 깨진다.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev',
        pathname: '/hero-banners/**',
      },
    ],
  },
}

module.exports = nextConfig
