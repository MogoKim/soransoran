#!/usr/bin/env tsx
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  exposureWindowStart,
  newAnonymousViewerToken,
  postExposureSecret,
  POST_EXPOSURE_RETENTION_DAYS,
  POST_EXPOSURE_VISITOR_COOKIE,
  POST_EXPOSURE_VISITOR_MAX_AGE,
  shouldRejectExposureRequest,
  validAnonymousViewerToken,
  viewerKeyHash,
} from '../src/lib/post-exposure'
import { schemaCompatibleForBorrowedClient } from './lib/source-snapshot-fixture.mjs'

let pass = 0
const check = (label: string, fn: () => void): void => {
  fn()
  pass += 1
  console.log(`  PASS ${label}`)
}

const request = (headers: Record<string, string> = {}, url = 'https://soransoran.com/api/view/p1') =>
  new Request(url, { method: 'POST', headers: { origin: 'https://soransoran.com', ...headers } })

console.log('\n══ 실제 조회 노출 계약 — 순수 검사 ══')

check('30분 UTC 창', () => {
  assert.equal(exposureWindowStart(new Date('2026-10-17T00:29:59.999Z')).toISOString(), '2026-10-17T00:00:00.000Z')
  assert.equal(exposureWindowStart(new Date('2026-10-17T00:30:00.000Z')).toISOString(), '2026-10-17T00:30:00.000Z')
})

check('익명 토큰은 불투명 24-byte base64url', () => {
  const a = newAnonymousViewerToken()
  const b = newAnonymousViewerToken()
  assert.equal(validAnonymousViewerToken(a), true)
  assert.equal(validAnonymousViewerToken(b), true)
  assert.notEqual(a, b)
  assert.equal(validAnonymousViewerToken('member-123'), false)
})

check('HMAC은 domain-separated이고 원문을 노출하지 않음', () => {
  const secret = '0123456789abcdef0123456789abcdef'
  const member = viewerKeyHash(secret, 'member:u1')
  const anonymous = viewerKeyHash(secret, 'anonymous:u1')
  assert.match(member, /^[a-f0-9]{64}$/)
  assert.notEqual(member, anonymous)
  assert.equal(member.includes('u1'), false)
  assert.throws(() => viewerKeyHash('short', 'member:u1'), /POST_EXPOSURE_SECRET_MISSING/)
})

check('기존 Auth secret을 별도 domain으로 사용하고 없으면 fail-closed', () => {
  assert.equal(postExposureSecret({ NEXTAUTH_SECRET: '0123456789abcdef' }), '0123456789abcdef')
  assert.equal(postExposureSecret({ AUTH_SECRET: 'fedcba9876543210', NEXTAUTH_SECRET: '0123456789abcdef' }), 'fedcba9876543210')
  assert.equal(postExposureSecret({ NEXTAUTH_SECRET: 'short' }), null)
})

check('same-origin hydrated POST만 허용', () => {
  assert.equal(shouldRejectExposureRequest(request()), false)
  assert.equal(shouldRejectExposureRequest(request({ 'sec-fetch-site': 'same-origin' })), false)
  assert.equal(shouldRejectExposureRequest(new Request('https://soransoran.com/api/view/p1', { method: 'POST' })), true)
  assert.equal(shouldRejectExposureRequest(request({ origin: 'https://example.com' })), true)
  assert.equal(shouldRejectExposureRequest(request({ 'sec-fetch-site': 'cross-site' })), true)
  assert.equal(shouldRejectExposureRequest(request({ purpose: 'prefetch' })), true)
  assert.equal(shouldRejectExposureRequest(request({ 'x-bot-type': 'internal' })), true)
  assert.equal(shouldRejectExposureRequest(request({ 'user-agent': 'Mozilla/5.0' })), false)
  assert.equal(shouldRejectExposureRequest(request({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })), true)
  assert.equal(shouldRejectExposureRequest(request({ 'user-agent': 'facebookexternalhit/1.1' })), true)
})

check('보관·쿠키 계약', () => {
  assert.equal(POST_EXPOSURE_RETENTION_DAYS, 30)
  assert.equal(POST_EXPOSURE_VISITOR_COOKIE, 'soran-viewer-v1')
  assert.equal(POST_EXPOSURE_VISITOR_MAX_AGE, 30 * 24 * 60 * 60)
})

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const migration = readFileSync('prisma/migrations/0032_post_exposure_event/migration.sql', 'utf8')
const route = readFileSync('src/app/api/view/[postId]/route.ts', 'utf8')
const store = readFileSync('src/lib/post-exposure-store.ts', 'utf8')
const beacon = readFileSync('src/components/features/PostViewBeacon.tsx', 'utf8')
const ranking = [
  readFileSync('src/lib/popularity.ts', 'utf8'),
  readFileSync('src/lib/best-ranking.ts', 'utf8'),
  readFileSync('src/lib/best-ranking-db.ts', 'utf8'),
].join('\n')

check('원장은 source split과 30분 unique를 가짐', () => {
  for (const value of ['DETAIL_OPEN', 'LIST_EXPOSURE', 'DETAIL', 'HOME', 'BOARD', 'BEST', 'NEXT_TO_READ']) {
    assert.match(schema, new RegExp(`\\b${value}\\b`))
    assert.match(migration, new RegExp(`\\b${value}\\b`))
  }
  assert.match(schema, /@@unique\(\[postId, kind, viewerKeyHash, windowStart\]\)/)
  assert.match(migration, /UNIQUE INDEX[\s\S]*"postId", "kind", "viewerKeyHash", "windowStart"/)
})

check('수락 경계 하나가 actor·공개 글·unique·증가를 소유', () => {
  assert.match(route, /recordPostExposure\(prisma/)
  assert.doesNotMatch(route, /viewCount:\s*\{\s*increment:/)
  assert.match(store, /isAdmin/)
  assert.match(store, /persona:\s*\{\s*select:/)
  assert.match(store, /operatorWriter:\s*\{\s*select:/)
  assert.match(store, /COMMUNITY_VISIBLE_WHERE/)
  assert.match(store, /postExposureEvent\.create/)
  assert.match(store, /viewCount:\s*\{\s*increment:\s*1/)
  assert.match(store, /error\.code === 'P2002'/)
})

check('옛 per-post cookie·직접 증가 제거', () => {
  assert.doesNotMatch(route, /soran-viewed-|viewedCookie|cookies\(\)\.get\(name\)/)
  assert.match(route, /POST_EXPOSURE_VISITOR_COOKIE/)
  assert.match(beacon, /sessionStorage/)
})

check('조회수는 홈·베스트 점수 입력으로 들어가지 않음', () => {
  assert.doesNotMatch(ranking, /postExposure|PostExposureEvent/)
})

const cleanupRoute = readFileSync('src/app/api/internal/post-exposure-cleanup/route.ts', 'utf8')
const cleanup = readFileSync('src/lib/post-exposure-cleanup.ts', 'utf8')
const vercel = readFileSync('vercel.json', 'utf8')

check('원장 정리는 cron secret과 30일·1만 행 상한 안에서만 실행', () => {
  assert.match(cleanupRoute, /validCleanupAuthorization/)
  assert.match(cleanupRoute, /process\.env\.CRON_SECRET/)
  assert.match(cleanup, /POST_EXPOSURE_RETENTION_DAYS/)
  assert.match(cleanup, /POST_EXPOSURE_CLEANUP_BATCH = 1_000/)
  assert.match(cleanup, /POST_EXPOSURE_CLEANUP_MAX_BATCHES = 10/)
  assert.match(vercel, /\/api\/internal\/post-exposure-cleanup/)
  assert.match(vercel, /"schedule": "0 18 \* \* \*"/)
})

check('runtime fixture는 additive 원장만 허용하고 기존 Prisma 계약 변경은 차단', () => {
  const parent = readFileSync('prisma/schema.prisma', 'utf8')
    .replace(/\n\s*\/\/\/ 실제 고객 열람·목록 노출의 30일 중복 제거 원장\. 공개 누적값은 viewCount 다\.\n\s*exposureEvents\s+PostExposureEvent\[\]\n/, '\n')
    .replace(/\n\/\/\/ 실제 브라우저 노출만 기록하는 단기 원장\.[\s\S]*?\nmodel PostExposureEvent \{[\s\S]*?\n\}\n/, '\n')
    .replace(/\nenum PostExposureKind \{[\s\S]*?\n\}\n\nenum PostExposureSurface \{[\s\S]*?\n\}\n/, '\n')
  const changedField = schema.replace(/^(\s*title\s+)String$/m, '$1Int')
  assert.notEqual(changedField, schema)
  assert.equal(schemaCompatibleForBorrowedClient(parent, schema), true)
  assert.equal(schemaCompatibleForBorrowedClient(parent, changedField), false)
  assert.equal(schemaCompatibleForBorrowedClient(parent, schema.replace('model User {', 'model User {\n  unsafeRequired String')), false)
  assert.equal(schemaCompatibleForBorrowedClient(parent, schema.replace('enum PostStatus {', 'enum PostStatus {\n  UNSAFE')), false)
})

console.log(`\nPASS ${pass} · FAIL 0`)
