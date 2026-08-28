import Link from 'next/link'

/**
 * 직접 인증 CTA 아래에 붙는 약관 안내.
 * 두 화면이 같은 문장을 각자 들지 않도록 한곳에 둔다 — 정본은 약관·개인정보처리방침 화면이다.
 */
export default function KakaoStartNotice() {
  return (
    <p className="mt-2 break-keep text-center text-xs leading-[1.6] text-content-muted">
      시작하시면{' '}
      <Link href="/terms" className="text-link underline underline-offset-2">
        이용약관
      </Link>
      과{' '}
      <Link href="/privacy" className="text-link underline underline-offset-2">
        개인정보처리방침
      </Link>
      에 동의하는 것으로 봅니다.
    </p>
  )
}
