import { timingSafeEqual } from 'node:crypto'

import { POST_EXPOSURE_RETENTION_DAYS } from '@/lib/post-exposure'
import { cleanupPostExposureEvents } from '@/lib/post-exposure-store'

export const POST_EXPOSURE_CLEANUP_BATCH = 1_000
export const POST_EXPOSURE_CLEANUP_MAX_BATCHES = 10

export function validCleanupAuthorization(header: string | null, secret: string | undefined): boolean {
  if (typeof secret !== 'string' || secret.length < 32) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header ?? '')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function postExposureCleanupCutoff(now: Date): Date {
  return new Date(now.getTime() - POST_EXPOSURE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

export async function runPostExposureCleanup(
  db: Parameters<typeof cleanupPostExposureEvents>[0],
  now: Date,
): Promise<number> {
  const cutoff = postExposureCleanupCutoff(now)
  let removed = 0
  for (let batch = 0; batch < POST_EXPOSURE_CLEANUP_MAX_BATCHES; batch += 1) {
    const count = await cleanupPostExposureEvents(db, cutoff, POST_EXPOSURE_CLEANUP_BATCH)
    removed += count
    if (count < POST_EXPOSURE_CLEANUP_BATCH) break
  }
  return removed
}
