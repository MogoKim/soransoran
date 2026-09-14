import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { formatKst, orDash } from '@/lib/admin-format'
import { getHeroBannerById } from '@/lib/queries/hero-banners'
import { heroBannerImageUrl } from '@/lib/hero-banner-image'
import {
  HERO_BANNER_MAX_CONCURRENT,
  canActivateHeroBanner,
  formatKstDateTimeLocal,
  isHeroBannerLive,
  validateHeroBannerCapacity,
} from '@/lib/hero-banner-rules'
import HeroBannerEditForm from '@/components/admin/HeroBannerEditForm'
import HeroBannerImageSlot from '@/components/admin/HeroBannerImageSlot'
import HeroBannerActivation from '@/components/admin/HeroBannerActivation'
import HeroBannerRowControls from '@/components/admin/HeroBannerRowControls'
import {
  AdminPageHeader,
  AdminSection,
  AdminBadge,
  AdminFieldList,
  AdminField,
} from '@/components/admin/AdminUi'

/**
 * 배너 한 장 — 값 고치기 · 이미지 올리기 · 켜기.
 *
 * 🔴 화면이 계산한 "켤 수 없는 이유" 는 **안내**다. 서버가 같은 함수로 다시 본다 —
 *    이 화면을 열어 둔 사이 다른 운영자가 배너를 켜면 5장 판정이 달라진다.
 *
 * 🔴 미리보기 주소는 key 에서 조립한다. DB 에는 key 만 있다 —
 *    URL 을 저장하면 도메인을 바꾸는 날 전부 깨진다.
 *
 * 🔴 보관한 배너는 값도 이미지도 고칠 수 없다. 먼저 복원해야 한다.
 *    "보관했는데 내용이 바뀌어 있다" 는 상태를 만들지 않는다.
 */
export const metadata: Metadata = { title: '배너' }
export const dynamic = 'force-dynamic'

export default async function AdminHeroBannerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const { id } = await params
  const banner = await getHeroBannerById(id)
  if (!banner) notFound()

  const now = new Date()
  const archived = banner.archivedAt !== null
  const live = isHeroBannerLive(banner, now)

  /**
   * 켤 수 없는 이유.
   *
   * 🔴 상태 검사(이미지·설명·링크·예약)를 먼저 하고, 통과했을 때만 5장을 센다.
   *    순서를 뒤집으면 이미지도 없는 초안에 "5장까지입니다" 가 뜬다.
   */
  let blockedReason: string | null = canActivateHeroBanner(banner)?.error ?? null
  if (!blockedReason && !banner.isActive) {
    const others = await prisma.heroBanner.findMany({
      where: { id: { not: banner.id }, archivedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        alt: true,
        mobileImageKey: true,
        desktopImageKey: true,
        linkKind: true,
        linkUrl: true,
        isActive: true,
        startsAt: true,
        endsAt: true,
        archivedAt: true,
      },
    })
    blockedReason =
      validateHeroBannerCapacity({
        candidate: { ...banner, isActive: true },
        others,
      })?.error ?? null
  }

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        title={banner.name}
        backHref="/admin/banners"
        backLabel="← 배너 목록으로"
        badges={
          <>
            {archived ? (
              <AdminBadge tone="neutral">보관됨</AdminBadge>
            ) : live ? (
              <AdminBadge tone="success">켬 · 구간 안</AdminBadge>
            ) : banner.isActive ? (
              <AdminBadge tone="neutral">켬 · 구간 밖</AdminBadge>
            ) : (
              <AdminBadge tone="neutral">꺼짐</AdminBadge>
            )}
            <AdminBadge tone="neutral">순서 {banner.sortOrder + 1}</AdminBadge>
          </>
        }
        description="여기서 켜도 지금은 홈 화면이 바뀌지 않습니다. 홈 화면 연결은 다음 단계입니다."
      />

      {/* ── 켜기 · 끄기 ─────────────────────────────── */}
      {archived ? (
        <AdminSection title="보관 중" description="복원하면 꺼진 상태로 목록에 돌아옵니다." className="mt-5">
          <div className="mt-2">
            <HeroBannerRowControls
              bannerId={banner.id}
              archived
              canMoveUp={false}
              canMoveDown={false}
            />
          </div>
        </AdminSection>
      ) : (
        <AdminSection
          title="켜기 · 끄기"
          description={`예약 구간이 겹치는 배너는 ${HERO_BANNER_MAX_CONCURRENT}장까지 켤 수 있습니다.`}
          className="mt-5"
        >
          <div className="mt-2">
            <HeroBannerActivation
              bannerId={banner.id}
              isActive={banner.isActive}
              blockedReason={blockedReason}
            />
          </div>
        </AdminSection>
      )}

      {/* ── 이미지 ──────────────────────────────────── */}
      <AdminSection
        title="이미지"
        description="모바일과 데스크탑을 각각 올립니다. 한 장을 잘라 쓰면 이미지 안의 글자가 잘립니다."
        className="mt-6"
      >
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <HeroBannerImageSlot
            bannerId={banner.id}
            slot="mobile"
            storedKey={banner.mobileImageKey}
            storedUrl={heroBannerImageUrl(banner.mobileImageKey)}
            disabled={archived}
            disabledReason="보관한 배너에는 이미지를 올릴 수 없습니다."
          />
          <HeroBannerImageSlot
            bannerId={banner.id}
            slot="desktop"
            storedKey={banner.desktopImageKey}
            storedUrl={heroBannerImageUrl(banner.desktopImageKey)}
            disabled={archived}
            disabledReason="보관한 배너에는 이미지를 올릴 수 없습니다."
          />
        </div>
        <p className="m-0 mt-2 text-xs text-content-muted">
          사진을 바꿔도 예전 파일은 지워지지 않습니다. 되돌릴 수 있게 남겨 둡니다.
        </p>
      </AdminSection>

      {/* ── 값 고치기 ───────────────────────────────── */}
      <AdminSection title="내용" className="mt-6">
        <HeroBannerEditForm
          bannerId={banner.id}
          disabled={archived}
          defaults={{
            name: banner.name,
            alt: banner.alt,
            linkKind: banner.linkKind,
            linkUrl: banner.linkUrl ?? '',
            startsAt: formatKstDateTimeLocal(banner.startsAt),
            endsAt: formatKstDateTimeLocal(banner.endsAt),
          }}
        />
      </AdminSection>

      {/* ── 기록 ────────────────────────────────────── */}
      <AdminSection title="기록" className="mt-6 border-t border-subtle pt-4">
        <AdminFieldList>
          <AdminField label="만든 사람" value={orDash(banner.createdBy?.nickname)} />
          <AdminField label="만든 때" value={formatKst(banner.createdAt)} />
          <AdminField label="마지막 수정" value={orDash(banner.updatedBy?.nickname)} />
          <AdminField label="수정한 때" value={formatKst(banner.updatedAt)} />
          {archived ? <AdminField label="보관한 때" value={formatKst(banner.archivedAt)} /> : null}
        </AdminFieldList>
      </AdminSection>

      {/* ── 순서 — 보관하지 않은 배너만 ────────────────── */}
      {archived ? null : (
        <AdminSection
          title="순서 · 보관"
          description="순서는 목록에서 위아래로 옮깁니다. 보관하면 꺼진 뒤 보관함으로 갑니다."
          className="mt-6"
        >
          <div className="mt-2">
            <HeroBannerRowControls
              bannerId={banner.id}
              archived={false}
              canMoveUp
              canMoveDown
            />
          </div>
        </AdminSection>
      )}
    </main>
  )
}
