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
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_SCRIPT }} />
        {/* Pretendard — scaffold 단계에서는 CDN.
            self-host 전환 절차는 public/fonts/pretendard/README.md 참조. */}
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
