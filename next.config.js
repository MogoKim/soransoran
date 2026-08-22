/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    // 이미지 호스트는 실제 스토리지 확정 후 추가한다.
    // 우나어의 remotePatterns 를 그대로 가져오지 않는다.
    remotePatterns: [],
  },
}

module.exports = nextConfig
