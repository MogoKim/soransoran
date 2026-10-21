/**
 * 운영 화면을 불러오는 동안.
 *
 * 🔴 셸(메뉴)은 layout 이 이미 그려 두므로 여기서는 본문 자리만 채운다.
 *    빈 화면이 길면 "눌렀는데 안 됐나" 하고 메뉴를 또 누른다 — 무엇을 하는 중인지 글로 말한다.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 pt-1">
      <p className="m-0 text-sm text-content-muted">화면을 불러오는 중입니다…</p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-page" />
        <div className="h-14 w-full animate-pulse rounded-[10px] bg-surface-page" />
        <div className="h-14 w-full animate-pulse rounded-[10px] bg-surface-page" />
        <div className="h-14 w-full animate-pulse rounded-[10px] bg-surface-page" />
      </div>
    </div>
  )
}
