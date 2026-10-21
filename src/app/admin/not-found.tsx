import Link from 'next/link'
import { adminButtonClass } from '@/components/admin/AdminButton'

/**
 * 운영 화면에서 찾는 항목이 없을 때(상세 화면의 notFound()).
 *
 * 🔴 예전에는 고객용 not-found 로 빠져 메뉴가 사라졌다. 셸 안에 머물고 목록으로 돌아갈 길을 준다.
 * 🔴 "없다" 로 끝내지 않는다 — 지워졌거나 주소가 틀렸을 수 있다는 것까지 말한다.
 */
export default function AdminNotFound() {
  return (
    <div className="flex max-w-xl flex-col gap-3 pt-1">
      <h1 className="m-0 text-xl font-bold leading-snug text-content-primary">찾는 항목이 없습니다</h1>
      <p className="m-0 text-sm text-content-secondary">
        이미 지워졌거나 주소가 바뀌었을 수 있습니다. 메뉴에서 목록으로 돌아가 다시 찾아 주세요.
      </p>
      <div className="mt-2">
        <Link href="/admin" className={adminButtonClass('secondary')}>
          운영 홈으로
        </Link>
      </div>
    </div>
  )
}
