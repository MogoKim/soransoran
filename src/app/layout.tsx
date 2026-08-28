import type { Metadata, Viewport } from 'next'
import { BRAND, SITE } from '@/lib/brand'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: SITE.title,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  metadataBase: new URL(SITE.url),
  // canonical — 배포별 vercel.app URL 이 새지 않도록 SITE.url 기준으로 고정한다
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.tagline,
  },
  // 검색엔진 소유권 확인 값은 D+1 에 등록한다.
  // 우나어의 verification 값을 복사하지 않는다.
  manifest: '/manifest.webmanifest',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: BRAND.color,
}

/**
 * 글자 크기 3단계 — 작게 / 기본 / 크게
 * 기본값은 "기본"이므로 저장된 값이 없으면 속성을 붙이지 않는다.
 * 저장키는 soran-font-size 단일 키다. (우나어의 unao-* 키를 쓰지 않는다)
 */
const FONT_SIZE_SCRIPT = `try{
var v=null;try{v=localStorage.getItem('soran-font-size')}catch(e){}
if(v==='SMALL'||v==='LARGE'){document.documentElement.setAttribute('data-font-size',v)}
}catch(e){}`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <meta
          name="naver-site-verification"
          content="5fb6a5b550994c0658f1dd81543e86f5a211ce29"
        />
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_SCRIPT }} />
        {/* Pretendard — scaffold 단계에서는 CDN.
            self-host 전환 절차는 public/fonts/pretendard/README.md 참조. */}
        {/*
          🔴 stylesheet 는 렌더를 막는다. 그 앞에 연결을 미리 열어 둔다.
             실측(2026-08-26): 같은 CSS 를 5회 받았는데 41ms ~ 383ms 로 9배 갈렸고,
             느린 회차의 비용은 거의 전부 connect(139ms) + tls(275ms) 였다.
             파일이 큰 게 아니라 새 도메인에 붙는 값이다.
             preconnect 가 그 왕복을 HTML 파싱과 겹쳐 숨긴다.

             crossOrigin 을 붙인다 — 폰트는 CORS 로 받으므로,
             빼면 연결이 재사용되지 않고 두 번 열린다.
             dns-prefetch 는 preconnect 를 지원하지 않는 구형 브라우저용 폴백이다.
        */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          as="style"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
