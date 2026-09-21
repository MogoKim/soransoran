/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    /**
     * OG 이미지가 읽는 로고 파일을 서버 번들에 함께 올린다.
     *
     * 🔴 적지 않으면 **배포에서만 깨진다.** OG 두 곳은 공유 카드를 그릴 때
     *    `public/brand/soransoran-logo.png` 를 읽는데(src/lib/brand-logo-image.ts),
     *    파일 추적기는 `process.cwd()` 로 조립한 경로를 따라가지 못한다 —
     *    실측: 이 항목 없이 빌드하면 두 route 의 `.nft.json` 에 로고가 **없다.**
     *    로컬에는 public/ 이 그대로 있어 통과하고, 서버리스 함수에만 파일이 빠진다.
     *
     * 🔴 절대 URL 로 자기 자신에게 요청하는 방식을 쓰지 않기로 한 대가다(§3-2-A).
     *    네트워크 실패로 로고 없는 카드가 나가는 것보다, 번들에 파일을 넣는 편이 낫다.
     *
     * 🔴 경로가 맞는지는 눈이 아니라 `.nft.json` 으로 확인한다 —
     *    키가 어긋나면 이 설정은 **조용히 아무것도 하지 않는다.**
     */
    outputFileTracingIncludes: {
      '/opengraph-image': ['./public/brand/soransoran-logo.png'],
      '/community/[boardSlug]/[postId]/opengraph-image': ['./public/brand/soransoran-logo.png'],
    },
  },
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
