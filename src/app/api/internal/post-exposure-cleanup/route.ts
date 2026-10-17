import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  runPostExposureCleanup,
  validCleanupAuthorization,
} from '@/lib/post-exposure-cleanup'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!validCleanupAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401, headers: { 'cache-control': 'no-store' } })
  }

  try {
    const removed = await runPostExposureCleanup(prisma, new Date())
    return NextResponse.json({ ok: true, removed }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: { 'cache-control': 'no-store' } })
  }
}
