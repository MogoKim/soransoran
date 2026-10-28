/**
 * 운영 화면을 불러오는 동안.
 *
 * 🔴 셸(메뉴)은 layout 이 이미 그려 두므로 여기서는 본문 자리만 채운다.
 *    빈 화면이 길면 "눌렀는데 안 됐나" 하고 메뉴를 또 누른다 — 무엇을 하는 중인지 글로 말한다.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 pt-1">
      <p className="m-0 text-sm text-content-secondary">화면을 불러오는 중입니다…</p>
      {/* 🔴 상자 대신 표 모양 — 머리 한 줄 + 52px 행 셋. 선과 옅은 막대만 쓴다(Admin Golden Master) */}
      <div aria-hidden="true" className="flex flex-col">
        <div className="mb-6 h-8 w-48 animate-pulse rounded bg-surface-page" />
        <div className="h-11 w-full border-y border-[color:var(--admin-border)] bg-surface-page" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-[52px] items-center gap-4 border-b border-[color:var(--admin-divider)] px-4">
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-page" />
            <div className="h-3 w-1/6 animate-pulse rounded bg-surface-page" />
          </div>
        ))}
      </div>
    </div>
  )
}
