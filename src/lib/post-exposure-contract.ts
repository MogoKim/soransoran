export const POST_EXPOSURE_WINDOW_MS = 30 * 60 * 1000
export const POST_EXPOSURE_RETENTION_DAYS = 30
export const POST_EXPOSURE_VISITOR_COOKIE = 'soran-viewer-v1'
export const POST_EXPOSURE_VISITOR_MAX_AGE = POST_EXPOSURE_RETENTION_DAYS * 24 * 60 * 60

export const POST_EXPOSURE_KINDS = ['DETAIL_OPEN', 'LIST_EXPOSURE'] as const
export type PostExposureKind = (typeof POST_EXPOSURE_KINDS)[number]

export const POST_EXPOSURE_SURFACES = ['DETAIL', 'HOME', 'BOARD', 'BEST', 'NEXT_TO_READ'] as const
export type PostExposureSurface = (typeof POST_EXPOSURE_SURFACES)[number]

export const POST_EXPOSURE_LIST_SURFACES = ['HOME', 'BOARD', 'BEST', 'NEXT_TO_READ'] as const
export type PostExposureListSurface = (typeof POST_EXPOSURE_LIST_SURFACES)[number]
export const POST_EXPOSURE_BATCH_MAX = 20

export type ListExposurePayload = {
  surface: PostExposureListSurface
  postIds: string[]
}

export function validListExposurePayload(value: unknown): ListExposurePayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!POST_EXPOSURE_LIST_SURFACES.includes(row.surface as PostExposureListSurface)) return null
  if (!Array.isArray(row.postIds) || row.postIds.length < 1 || row.postIds.length > POST_EXPOSURE_BATCH_MAX) return null

  const postIds = [...new Set(row.postIds.map((id) => typeof id === 'string' ? id.trim() : ''))]
  if (postIds.some((id) => id.length < 1 || id.length > 128)) return null
  return { surface: row.surface as PostExposureListSurface, postIds }
}
