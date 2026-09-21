import Image from 'next/image'
import { cn } from '@/lib/utils'
import { BRAND_NAME } from '@/lib/brand-name'
import { BRAND_LOGO } from '@/lib/brand-logo'

/**
 * 소란소란 로고 — 🔴 브랜드 표시의 단일 진입점
 *
 * 로고를 페이지·컴포넌트에서 직접 마크업하지 않는다.
 * 여기 한 곳을 고치면 전 화면에 반영된다.
 *
 * 우나어 반례: <Image src="/logo-symbol.png"> 가 6개 파일에 하드코딩되어
 * 로고 교체가 사실상 불가능한 상태다.
 *
 * ── 🔴 가로형 이미지 로고 (정본 §3-2-A · 2026-09-21 현행) ──────────
 *   두 사람이 손을 맞대는 심볼 + 이름이 한 덩어리인 가로형 lockup 이다.
 *   **표시 상자** 96 × 48 고정(상자 가로/세로 2.000) · 주소와 크기는 `brand-logo.ts` 가 정본이다.
 *   상자 안에서 이름 글자는 27px 을 쓴다(상자 높이의 57.3% · 실측) —
 *   심볼과 이름이 한 덩어리라서다.
 *
 * 🕘 **이전에는 두 색 텍스트 워드마크였다**(2026-09-07 ~ 2026-09-21).
 *    앞 조각 800 `--brand` · 뒤 조각 500 `--brand-strong` 을 24px 로 그렸다.
 *    신규 브랜드 자산 도입으로 대체됐다 — 글자 조각을 자르던
 *    `BRAND_NAME_SPLIT_AT` · `HEAD` · `TAIL` 도 함께 사라졌다.
 *
 * 🔴 크기는 48px 고정이다. 본문 글자 크기(작게·기본·크게)를 따라가지 않는다.
 *    로고는 읽는 글이 아니라 **표식**이다. 헤더 h-16(64px)·터치 52px 도 그대로다.
 *
 * 🔴 next/image 에 표시 상자를 그대로 넘긴다. 고유 크기가 박혀 있어
 *    이미지가 늦게 와도 자리가 흔들리지 않는다(레이아웃 이동 0).
 *
 * 🔴 **`unoptimized` 인 이유 — 실측으로 48px 이 깨졌다.**
 *    기본값으로 두면 next/image 가 `srcset` 에 1x·2x 두 후보를 만드는데, 축소본을
 *    만들 때 세로를 반올림해 고유비가 흔들린다. Tailwind preflight 이
 *    `img { height: auto }` 를 걸어 두므로 높이는 **로드된 후보의 고유비**가 정하고,
 *    그 결과 실제 높이가 48 이 아니게 렌더된다 — 이전 자산(186×96)에서 390px 뷰포트
 *    실측 **48.44px**, 1x·2x 중 무엇을 고르느냐에 따라 0.44px 흔들림까지 났다.
 *
 *    파일을 그대로 내보내면 고유비가 언제나 파일 상자 그대로라 높이가 정확히 48 이다.
 *    16.8KB 한 장이고 헤더에서 늘 같은 파일이라 캐시도 잘 듣는다 —
 *    반올림을 감수하고 몇 KB 를 아끼는 것보다, 48px 계약을 지키는 쪽을 고른다.
 *    🔴 크기 계약을 맞추려고 검사나 기준을 낮추지 않는다. 원인을 없앴다.
 */

type LogoProps = {
  /** 레이아웃 보정 전용 — 크기는 여기서 바꾸지 않는다 */
  className?: string
}

export default function Logo({ className }: LogoProps) {
  return (
    <Image
      src={BRAND_LOGO.src}
      /* 🔴 접근 가능한 이름은 여기 하나다. 헤더처럼 조상 링크에 aria-label 이 있으면
         링크 이름은 그쪽이 이기므로 "소란소란" 이 두 번 읽히지 않는다.
         오류 화면에서는 이 로고가 홀로 서므로 이 alt 가 이름이 된다. */
      alt={BRAND_NAME}
      width={BRAND_LOGO.width}
      height={BRAND_LOGO.height}
      /* 헤더는 첫 화면 최상단이라 지연 로딩 대상이 아니다 */
      priority
      unoptimized
      className={cn('block', className)}
    />
  )
}
