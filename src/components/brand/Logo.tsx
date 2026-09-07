import { cn } from '@/lib/utils'
import { BRAND_NAME, BRAND_NAME_HEAD, BRAND_NAME_TAIL } from '@/lib/brand-name'

/**
 * 소란소란 워드마크 — 🔴 브랜드 표시의 단일 진입점
 *
 * 로고를 페이지·컴포넌트에서 직접 마크업하지 않는다.
 * 나중에 이미지 로고로 교체할 때 이 파일 하나만 고치면 전 화면에 반영된다.
 *
 * 우나어 반례: <Image src="/logo-symbol.png"> 가 6개 파일에 하드코딩되어
 * 로고 교체가 사실상 불가능한 상태다.
 *
 * ── 두 색 워드마크 (정본 §3-2) ────────────────────────────────
 *   앞 조각  weight 800  --brand         #FA4601   원색
 *   뒤 조각  weight 500  --brand-strong  #C43300   한 단계 진한 주황
 *
 * 🔴 두 조각은 **한 단어**다. 사이에 공백을 두지 않고 줄바꿈도 하지 않는다.
 *    무게와 색만 갈라, 같은 음절이 두 번 반복되는 이름의 리듬을 드러낸다.
 *
 * 🔴 크기는 24px 고정이다. 본문 글자 크기(작게·기본·크게)를 따라가지 않는다.
 *    로고는 읽는 글이 아니라 **표식**이다 — 본문을 키웠다고 헤더의 브랜드가
 *    함께 커질 이유가 없다. 헤더 h-16(64px)·터치 52px 도 그대로 유지된다.
 *
 * 🔴 폰트를 새로 들이지 않는다. Pretendard Variable 을 전역에서 그대로 상속한다.
 */

/**
 * 🔴 이름도 분리 위치도 여기서 정하지 않는다. `brand-name.ts` 가 정본이다.
 *    화면·CSS 없는 fallback·OG 이미지가 같은 조각을 써야 하므로 자르는 곳은 한 곳뿐이다.
 */

type LogoProps = {
  /** 레이아웃 보정 전용 — 색·크기·무게는 여기서 바꾸지 않는다 */
  className?: string
}

export default function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap text-[24px] leading-none tracking-[-0.02em]',
        className,
      )}
    >
      {/* 🔴 두 조각이 보조기술에서 각각 읽히면 "소란" 을 두 번 듣게 된다.
          시각 조각은 aria-hidden 으로 빼고, 이름은 아래 sr-only 한 곳에서만 읽힌다.
          헤더처럼 조상 링크에 aria-label 이 있으면 그쪽이 이름을 이겨 중복도 없다. */}
      <span aria-hidden className="font-extrabold text-brand">
        {BRAND_NAME_HEAD}
      </span>
      <span aria-hidden className="font-medium text-brand-strong">
        {BRAND_NAME_TAIL}
      </span>
      <span className="sr-only">{BRAND_NAME}</span>
    </span>
  )
}
