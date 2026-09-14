import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'
import { getActiveHeroBanners, getArchivedHeroBanners } from '@/lib/queries/hero-banners'
import {
  HERO_BANNER_MAX_CONCURRENT,
  canActivateHeroBanner,
  isHeroBannerLive,
} from '@/lib/hero-banner-rules'
import HeroBannerCreateForm from '@/components/admin/HeroBannerCreateForm'
import HeroBannerRowControls from '@/components/admin/HeroBannerRowControls'
import { AdminPageHeader, AdminSection, AdminBadge, AdminEmptyState } from '@/components/admin/AdminUi'

/**
 * 배너 관리 — 지금 무엇이 나가는지 보고, 순서를 바꾸고, 보관한다.
 *
 * 🔴 /admin/home 과 섞지 않는다. 저쪽은 **이미 있는 글**을 홈에 올리고 내리는 일이고,
 *    여기는 운영자가 만든 이미지를 새로 올리는 일이다. 한 화면에 두면
 *    "글을 고정했다" 와 "배너를 켰다" 가 구분되지 않는다.
 *
 * 🔴 홈(/)은 아직 이 배너를 읽지 않는다. 켜도 고객 화면은 그대로다 —
 *    그 사실을 화면에 적는다. 적지 않으면 운영자가 "켰는데 왜 안 나오지" 로 헤맨다.
 *    홈 동적 노출은 PR 3 이다.
 *
 * 🔴 목록에서 켜지 않는다. 켤 수 없는 이유(이미지 없음·5장 초과)를 설명할 자리가
 *    목록 한 줄에는 없다. 켜고 끄는 것은 편집 화면에서만 한다.
 *
 * 🔴 보관함을 빈 메뉴로 만들지 않는다. 보관한 배너가 없으면 구역 자체를 숨긴다.
 */
export const metadata: Metadata = { title: '배너 관리' }
export const dynamic = 'force-dynamic'

/** 데스크탑 열 폭. 머리줄과 각 줄이 같은 값을 써야 칸이 맞는다. */
const COLS = 'lg:grid-cols-[2rem_minmax(0,1fr)_7rem_9rem_13rem_auto]'

function scheduleLabel(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt && !endsAt) return '기간 제한 없음'
  if (startsAt && endsAt) return `${formatKst(startsAt)} → ${formatKst(endsAt)}`
  if (startsAt) return `${formatKst(startsAt)} 부터`
  return `${formatKst(endsAt)} 까지`
}

export default async function AdminHeroBannersPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const now = new Date()
  const [banners, archived] = await Promise.all([
    getActiveHeroBanners(),
    getArchivedHeroBanners(),
  ])

  const liveCount = banners.filter((b) => isHeroBannerLive(b, now)).length
  const activeCount = banners.filter((b) => b.isActive).length
  const incomplete = banners.filter((b) => !b.isActive && canActivateHeroBanner(b) !== null).length

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader title="배너 관리" />

      {/* 상단 요약 — 상태와 범위를 한 줄로. 큰 박스를 두지 않는다. */}
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-content-primary">
          지금 나갈 배너 <strong>{liveCount}</strong> / {HERO_BANNER_MAX_CONCURRENT} · 켜 둠{' '}
          <strong>{activeCount}</strong>
        </span>
        {incomplete > 0 ? (
          <AdminBadge tone="warning">준비 중 {incomplete}</AdminBadge>
        ) : (
          <span className="text-content-muted">준비 중인 초안 없음</span>
        )}
        <span className="text-content-muted">
          아직 홈 화면에는 반영되지 않습니다 · 홈 노출은 다음 단계에서 켭니다
        </span>
      </p>

      {/* ── 새 배너 ──────────────────────────────────── */}
      <AdminSection
        title="새 배너 만들기"
        description="이름만 정하면 꺼진 초안이 만들어집니다. 이미지는 다음 화면에서 올립니다."
        className="mt-5"
      >
        <HeroBannerCreateForm />
      </AdminSection>

      {/* ── 배너 목록 ────────────────────────────────── */}
      <AdminSection
        title={`배너 ${banners.length}장`}
        description={`위에 있을수록 앞에 보입니다. 같은 시간에 나갈 수 있는 배너는 ${HERO_BANNER_MAX_CONCURRENT}장까지입니다.`}
        className="mt-6"
      >
        {banners.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>
              아직 만든 배너가 없습니다. 위에서 이름을 적어 첫 배너를 만들어 주세요.
            </AdminEmptyState>
          </div>
        ) : (
          <div className="mt-2">
            <div
              className={`hidden border-b border-subtle px-2 pb-1.5 text-xs text-content-muted lg:grid lg:gap-3 ${COLS}`}
            >
              <span>#</span>
              <span>이름</span>
              <span>상태</span>
              <span>이미지</span>
              <span>예약</span>
              <span className="text-right">순서 · 보관</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 lg:gap-0">
              {banners.map((banner, index) => {
                const live = isHeroBannerLive(banner, now)
                const blocked = canActivateHeroBanner(banner)
                return (
                  <li
                    key={banner.id}
                    className={`rounded-lg border border-subtle bg-surface-card p-3 lg:grid lg:min-h-[44px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5 ${COLS}`}
                  >
                    <span className="text-xs font-bold text-content-muted">{index + 1}</span>

                    <Link
                      href={`/admin/banners/${banner.id}`}
                      className="mt-1 block min-w-0 truncate text-sm font-bold text-content-primary no-underline lg:mt-0"
                    >
                      {banner.name}
                    </Link>

                    <span className="mt-1 block lg:mt-0">
                      {live ? (
                        <AdminBadge tone="success">나가는 중</AdminBadge>
                      ) : banner.isActive ? (
                        <AdminBadge tone="neutral">켬 · 기간 밖</AdminBadge>
                      ) : (
                        <AdminBadge tone="neutral">꺼짐</AdminBadge>
                      )}
                    </span>

                    <span className="mt-1 flex flex-wrap gap-1 lg:mt-0">
                      {banner.mobileImageKey ? (
                        <AdminBadge tone="neutral">모바일</AdminBadge>
                      ) : (
                        <AdminBadge tone="warning">모바일 없음</AdminBadge>
                      )}
                      {banner.desktopImageKey ? (
                        <AdminBadge tone="neutral">데스크탑</AdminBadge>
                      ) : (
                        <AdminBadge tone="warning">데스크탑 없음</AdminBadge>
                      )}
                    </span>

                    <span className="mt-1 block text-xs text-content-muted lg:mt-0">
                      {scheduleLabel(banner.startsAt, banner.endsAt)}
                      {!banner.isActive && blocked ? (
                        <span className="mt-0.5 block text-state-warning">아직 켤 수 없습니다</span>
                      ) : null}
                    </span>

                    <div className="mt-2 lg:mt-0">
                      <HeroBannerRowControls
                        bannerId={banner.id}
                        archived={false}
                        canMoveUp={index > 0}
                        canMoveDown={index < banners.length - 1}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </AdminSection>

      {/* ── 보관함 — 있을 때만 ───────────────────────── */}
      {archived.length > 0 ? (
        <AdminSection
          title={`보관함 ${archived.length}장`}
          description="보관한 배너입니다. 지워지지 않았고, 복원하면 꺼진 상태로 목록에 돌아옵니다."
          className="mt-6 border-t border-subtle pt-4"
        >
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 lg:gap-0">
            {archived.map((banner) => (
              <li
                key={banner.id}
                className="rounded-lg border border-subtle bg-surface-card p-3 lg:flex lg:min-h-[44px] lg:items-center lg:justify-between lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-1.5"
              >
                <Link
                  href={`/admin/banners/${banner.id}`}
                  className="block min-w-0 truncate text-sm font-bold text-content-primary no-underline"
                >
                  {banner.name}
                  <span className="ml-2 text-xs font-normal text-content-muted">
                    {formatKst(banner.archivedAt)} 보관
                  </span>
                </Link>
                <div className="mt-2 shrink-0 lg:mt-0">
                  <HeroBannerRowControls
                    bannerId={banner.id}
                    archived
                    canMoveUp={false}
                    canMoveDown={false}
                  />
                </div>
              </li>
            ))}
          </ul>
        </AdminSection>
      ) : null}
    </main>
  )
}
