import { cn } from '@/lib/utils'

/**
 * 운영 콘솔 버튼 — 모양 하나를 이 파일이 정한다.
 *
 * 🔴 primary 는 관리자 전용 action 토큰(--admin-action-*)만 쓴다.
 *    --cta 를 쓰지 않는다 — 그것은 고객 CTA 와 ui/ActionButton 의 계약이다(globals.css .admin-shell).
 *
 * 🔴 danger 는 채우지 않는다. 흰 면 + 빨간 2px 테두리 + 빨간 글씨다.
 *    채운 빨강은 "누르라" 로 읽힌다. 위험 조치는 확인 절차를 동반한다(호출부 몫).
 *
 * 🔴 못 누르는 버튼은 흐린 색이 아니라 회색 면이다. opacity 로 흐리면
 *    "누를 수 있는데 흐린 것" 으로 읽힌다. hover·active 는 enabled: 로 잠근다.
 *
 * 🔴 높이 — 모바일 52px · 데스크탑 44px. 위험 버튼도 같다(44 아래로 내리지 않는다).
 *
 * 요소를 바꿀 수 없는 자리(서버 액션 폼 · D100 컴포넌트의 기존 <button>)는
 * adminButtonClass() 로 className 만 받아 쓴다. 동작·문구·속성은 호출부가 그대로 갖는다.
 */
export type AdminButtonTone = 'primary' | 'secondary' | 'danger'

const BASE =
  'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg px-5 text-base font-bold no-underline transition-colors duration-150 lg:min-h-[44px] ' +
  'disabled:cursor-not-allowed disabled:border disabled:border-subtle disabled:bg-surface-page disabled:text-content-muted'

const TONE: Record<AdminButtonTone, string> = {
  primary:
    /* 🔴 color: 접두를 붙인다. var() 만 쓰면 tailwind-merge 가 크기인지 색인지 몰라
          text-base 와 같은 그룹으로 묶어 한쪽을 지울 수 있다(src/lib/utils.ts 주석). */
    'bg-[color:var(--admin-action-bg)] text-[color:var(--admin-action-content)] enabled:hover:bg-[color:var(--admin-action-hover)]',
  secondary:
    'border border-interactive bg-surface-card text-content-primary enabled:hover:bg-surface-page',
  danger:
    'border-2 border-state-danger bg-surface-card text-state-danger enabled:hover:bg-[color:var(--admin-danger-soft)]',
}

export function adminButtonClass(tone: AdminButtonTone = 'secondary', className?: string): string {
  return cn(BASE, TONE[tone], className)
}

export default function AdminButton({
  tone = 'secondary',
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: AdminButtonTone }) {
  return <button type={type} className={adminButtonClass(tone, className)} {...rest} />
}
