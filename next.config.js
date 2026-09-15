/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    // 우나어의 remotePatterns 를 그대로 가져오지 않는다.
    //
    // 🔴 host 를 **하나하나 정확히** 적는다.
    //    와일드카드 호스트(*.r2.dev)를 쓰지 않는다 — 그것은 남의 bucket 까지 여는 문이다.
    //
    // 🔴 pathname 을 /hero-banners/** 로 좁힌다. 회원 사진(posts/**)은
    //    글 본문에서 sanitize 를 지나 <img> 로 나가고 next/image 를 타지 않는다 —
    //    여기서 함께 열면 쓰지 않는 문이 하나 더 생긴다.
    //
    // 🔴 전환기라 두 개다 (2026-09-15). 같은 R2 bucket 에 공개 주소가 둘 붙어 있다.
    //      · pub-a1dbda…r2.dev   지금까지 쓰던 개발용 주소
    //      · img.soransoran.com  앞으로 쓸 custom domain
    //    env 를 새 주소로 바꾸기 **전에** 두 호스트를 모두 열어 두어야
    //    배포 순간에 어드민 미리보기가 깨지지 않는다.
    //    🔴 이 목록은 src/lib/hero-banner-image.ts 의 HERO_BANNER_IMAGE_HOSTS 와
    //       같아야 한다. 빌드 설정이라 import 할 수 없어 check:hero-banner 가 대조한다.
    //
    // 🔴 안정화 뒤 r2.dev 항목을 뺀다. 그때 hero-banner-image.ts 도 같이 줄인다.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-a1dbda7462b84a98a36e29bd46ca7434.r2.dev',
        pathname: '/hero-banners/**',
      },
      {
        protocol: 'https',
        hostname: 'img.soransoran.com',
        pathname: '/hero-banners/**',
      },
    ],
  },
}

module.exports = nextConfig
