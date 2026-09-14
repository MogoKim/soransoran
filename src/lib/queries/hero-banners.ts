import 'server-only'
import { prisma } from '@/lib/prisma'
import { sortHeroBanners, type HeroBannerLinkKind } from '@/lib/hero-banner-rules'

/**
 * 히어로 배너 조회 — 어드민 화면이 쓰는 읽기 전용 경로.
 *
 * 🔴 여기서 쓰지 않는다. write 는 actions/admin-hero-banner.ts 하나가 맡는다.
 *
 * 🔴 홈(/)은 아직 이 파일을 부르지 않는다. 홈 동적 노출은 PR 3 이다 —
 *    지금 홈을 건드리면 어드민이 준비되기도 전에 고객 화면이 흔들린다.
 *
 * 🔴 정렬을 SQL 에만 맡기지 않는다. sortOrder 에 unique 가 없어 동점이 생길 수 있고,
 *    동점일 때 순서가 흔들리면 "위로" 를 눌러도 화면이 그대로인 것처럼 보인다.
 *    최종 순서는 hero-banner-rules.sortHeroBanners 한 곳이 정한다.
 */

/** 어드민 화면이 쓰는 한 줄. 🔴 URL 이 아니라 key 를 그대로 들고 온다. */
export type AdminHeroBanner = {
  id: string
  name: string
  alt: string
  mobileImageKey: string | null
  desktopImageKey: string | null
  linkKind: HeroBannerLinkKind
  linkUrl: string | null
  sortOrder: number
  isActive: boolean
  startsAt: Date | null
  endsAt: Date | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; nickname: string | null } | null
  updatedBy: { id: string; nickname: string | null } | null
}

const SELECT = {
  id: true,
  name: true,
  alt: true,
  mobileImageKey: true,
  desktopImageKey: true,
  linkKind: true,
  linkUrl: true,
  sortOrder: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, nickname: true } },
  updatedBy: { select: { id: true, nickname: true } },
} as const

/**
 * 보관하지 않은 배너 전부 — 운영 순서대로.
 *
 * 🔴 isActive 로 좁히지 않는다. 꺼 둔 초안도 목록에 있어야 운영자가 이어서 만든다.
 */
export async function getActiveHeroBanners(): Promise<AdminHeroBanner[]> {
  const rows = await prisma.heroBanner.findMany({
    where: { archivedAt: null },
    select: SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  return sortHeroBanners(rows)
}

/**
 * 보관한 배너.
 *
 * 🔴 보관 시각 역순이다. 방금 보관한 것이 맨 위에 있어야 잘못 보관했을 때 바로 되돌린다.
 */
export async function getArchivedHeroBanners(): Promise<AdminHeroBanner[]> {
  return prisma.heroBanner.findMany({
    where: { archivedAt: { not: null } },
    select: SELECT,
    orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }],
  })
}

/** 배너 한 장. 없으면 null. 보관 여부와 상관없이 찾는다 — 편집 화면에서 복원해야 한다. */
export async function getHeroBannerById(id: string): Promise<AdminHeroBanner | null> {
  if (!id) return null
  return prisma.heroBanner.findUnique({ where: { id }, select: SELECT })
}
