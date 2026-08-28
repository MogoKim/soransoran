import Link from 'next/link'
import { SITE } from '@/lib/brand'
import FontSizeToggle from '@/components/layouts/FontSizeToggle'
import { cn } from '@/lib/utils'

/** 화면이 늘어도 이 배열에 한 줄만 늘어난다.
 *  emphasis 는 개인정보처리방침을 다른 링크와 구분해 표시하기 위한 것이다. */
const LINKS: { href: string; label: string; emphasis?: boolean }[] = [
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침', emphasis: true },
  { href: '/rules', label: '커뮤니티 규칙' },
  { href: '/contact', label: '문의' },
  { href: '/faq', label: '자주 묻는 질문' },
]

/**
 * 사업자 정보 — 표기는 사업자등록증과 한 글자도 다르지 않아야 한다.
 *
 * 🔴 줄여 쓰거나 순서를 바꾸지 않는다.
 *    이 값은 결제·계약 화면의 장식이 아니라 사업자를 특정하는 법정 표기다.
 *    상호를 "케이에이지랩" 으로만 적거나 주소에서 괄호를 빼면
 *    등록증·외부 심사 기록과 대조했을 때 다른 사업자로 읽힌다.
 *
 * 🔴 등록증 이미지는 두지 않는다. 텍스트로만 밝힌다.
 */
const BUSINESS = {
  name: '케이에이지랩(K-Agelab)',
  owner: '김용석',
  registrationNumber: '457-24-01157',
  /** 이어 붙이면 등록증 표기 그대로다. 좁은 화면에서 동·호수가 갈라지지 않도록 둘로 나눠 둔다 */
  addressRoad: '서울특별시 노원구 월계로55길 15,',
  addressDetail: '302동 912호(월계동, 사슴아파트)',
} as const

/**
 * 하단 영역 — 약관·규칙·문의·사업자 정보. 터치 타겟 52px 유지
 *
 * avoidFloatingAction 은 FAB 이 있는 화면에서만 모바일 하단 여백을 늘려
 * 마지막 문구가 가리는 것을 막는다. 넓은 화면은 원래 여백으로 돌아간다.
 */
export default function Footer({ avoidFloatingAction = false }: { avoidFloatingAction?: boolean }) {
  return (
    <footer className="mt-16 border-t border-subtle bg-surface-card">
      <div
        className={cn(
          'mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-8',
          avoidFloatingAction ? 'pb-28 lg:pb-8' : 'pb-8',
        )}
      >
        <nav className="flex flex-wrap items-center gap-x-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`inline-flex min-h-[52px] items-center text-sm text-content-muted no-underline ${
                link.emphasis ? 'font-bold' : ''
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <FontSizeToggle />

        {/* 🔴 접지 않는다. 펼치는 동작 없이 그 자리에서 읽혀야 한다.
              🔴 동·호수는 whitespace-nowrap 으로 묶는다.
                 break-keep 은 낱말 안에서 끊는 것만 막고 공백에서는 넘어간다.
                 320px 에서 실제로 "302동" 과 "912호" 가 갈라져 다른 주소처럼 읽혔다. */}
        <address className="flex flex-col gap-0.5 not-italic text-xs leading-[1.7] text-content-muted">
          <span className="break-keep">
            {SITE.name} · {BUSINESS.name} · 대표 {BUSINESS.owner}
          </span>
          <span className="break-keep">사업자등록번호 {BUSINESS.registrationNumber}</span>
          <span className="break-keep">
            {BUSINESS.addressRoad}{' '}
            <span className="whitespace-nowrap">{BUSINESS.addressDetail}</span>
          </span>
          <span className="break-keep">문의 soransoran.community@gmail.com</span>
        </address>

        <p className="text-xs text-content-muted">
          이곳의 글은 회원들의 경험과 의견이며 의료·법률·금융 조언이 아닙니다.
        </p>
      </div>
    </footer>
  )
}
