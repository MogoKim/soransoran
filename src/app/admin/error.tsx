'use client'

import Link from 'next/link'
import { adminButtonClass } from '@/components/admin/AdminButton'

/**
 * 운영 화면 오류.
 *
 * 🔴 예전에는 admin 아래에 error 경계가 없어 고객용 오류 화면(src/app/error.tsx)으로 빠졌다.
 *    운영자는 메뉴를 잃고 "고객 화면이 깨졌나" 를 의심하게 된다. 여기서 셸 안에 머문다.
 *
 * 🔴 오류 내용(error.message)을 화면에 내지 않는다. 서버 오류 문장에는 조회 조건이나
 *    내부 식별자가 섞일 수 있다. digest 만 보여 줘서 로그와 맞춰 볼 수 있게 한다.
 *
 * 🔴 다시 시도는 화면을 다시 그리는 것뿐이다 — 조치(숨김·차단·발행)를 다시 보내지 않는다.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div role="alert" className="flex max-w-xl flex-col gap-3 pt-1">
      <h1 className="m-0 text-xl font-bold leading-snug text-content-primary">화면을 불러오지 못했습니다</h1>
      <p className="m-0 text-sm text-content-secondary">
        잠시 뒤 다시 시도해 주세요. 방금 누른 조치가 있었다면, 다시 누르기 전에 목록에서 결과를 먼저 확인해 주세요.
      </p>
      {error.digest ? (
        <p className="m-0 text-xs text-content-muted">오류 번호 {error.digest}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={adminButtonClass('primary')}>
          다시 불러오기
        </button>
        <Link href="/admin" className={adminButtonClass('secondary')}>
          운영 홈으로
        </Link>
      </div>
    </div>
  )
}
