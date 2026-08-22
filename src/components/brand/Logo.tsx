import { cn } from '@/lib/utils'

/**
 * 소란소란 워드마크 — 🔴 브랜드 표시의 단일 진입점
 *
 * 로고를 페이지·컴포넌트에서 직접 마크업하지 않는다.
 * 나중에 이미지 로고로 교체할 때 이 파일 하나만 고치면 전 화면에 반영된다.
 *
 * 우나어 반례: <Image src="/logo-symbol.png"> 가 6개 파일에 하드코딩되어
 * 로고 교체가 사실상 불가능한 상태다.
 *
 * 색상 정본 (soransoran-brand-design-spec.md §3-1 · §9)
 *   기본값 ink  = --brand-ink (#9A3A31) · 배경 위 6.62:1 — 판독성 안전
 *   brand       = --brand (#FF6F61) · 배경 위 2.60:1 — 로고 예외로만 성립
 *                 weight 900 + 충분한 크기/여백 + 실기기 판독성 확인을 통과해야 쓴다
 *
 * 🔴 "브랜드 컬러니까"를 이유로 안 읽히는 워드마크를 유지하지 않는다.
 */
type LogoProps = {
  /** ink = 판독 우선(기본) · brand = 브랜드 우선(조건부) */
  tone?: 'ink' | 'brand'
  className?: string
}

export default function Logo({ tone = 'ink', className }: LogoProps) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap font-extrabold tracking-[-0.02em]',
        tone === 'ink' ? 'text-brand-ink' : 'text-brand',
        className,
      )}
    >
      소란소란
    </span>
  )
}
