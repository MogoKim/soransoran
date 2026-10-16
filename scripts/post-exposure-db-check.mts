#!/usr/bin/env tsx
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { cleanupPostExposureEvents, recordPostExposure, recordPostExposureBatch } from '../src/lib/post-exposure-store'

const url = process.env.DATABASE_URL ?? ''
if (process.env.SORAN_ISOLATED_DB !== 'yes-throwaway'
  || !/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url)
  || !/\/soran_test(\?|$)/.test(url)) {
  throw new Error('격리 localhost soran_test DB만 허용한다')
}

const db = new PrismaClient()
const secret = '0123456789abcdef0123456789abcdef'
const now = new Date('2026-10-17T03:00:00.000Z')
let pass = 0

async function user(id: string, extra: { admin?: boolean; persona?: boolean; operator?: boolean } = {}) {
  await db.user.create({ data: { id, name: id, isAdmin: extra.admin ?? false } })
  if (extra.persona) await db.persona.create({ data: { id: `persona-${id}`, code: `P-${id}`, userId: id } })
  if (extra.operator) await db.operatorWriter.create({ data: { id: `operator-${id}`, code: `OP-${id}`, userId: id } })
}

async function expose(postId: string, userId: string | null, token: string | null, at = now, kind: 'DETAIL_OPEN' | 'LIST_EXPOSURE' = 'DETAIL_OPEN') {
  return recordPostExposure(db, {
    postId,
    kind,
    surface: kind === 'DETAIL_OPEN' ? 'DETAIL' : 'HOME',
    userId,
    anonymousToken: token,
    secret,
    now: at,
  })
}

try {
  await db.postExposureEvent.deleteMany()
  await db.post.deleteMany()
  await db.operatorWriter.deleteMany()
  await db.persona.deleteMany()
  await db.user.deleteMany()

  for (const id of ['author', 'member']) await user(id)
  await user('admin', { admin: true })
  await user('persona', { persona: true })
  await user('operator', { operator: true })

  await db.post.createMany({ data: [
    { id: 'visible', boardType: 'FREE', title: 'visible', content: 'body', authorId: 'author', status: 'PUBLISHED' },
    { id: 'hidden', boardType: 'FREE', title: 'hidden', content: 'body', authorId: 'author', status: 'HIDDEN' },
  ] })

  assert.equal(await expose('visible', 'member', null), 'accepted')
  assert.equal(await expose('visible', 'member', null), 'duplicate')
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'visible' } })).viewCount, 1)
  assert.equal(await db.postExposureEvent.count({ where: { postId: 'visible' } }), 1)
  pass += 1

  assert.equal(await expose('visible', 'member', null, new Date(now.getTime() + 30 * 60 * 1000)), 'accepted')
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'visible' } })).viewCount, 2)
  pass += 1

  assert.equal(await expose('visible', null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now, 'LIST_EXPOSURE'), 'accepted')
  assert.equal(await expose('visible', null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now, 'LIST_EXPOSURE'), 'duplicate')
  assert.equal(await expose('visible', null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now, 'DETAIL_OPEN'), 'accepted')
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'visible' } })).viewCount, 4)
  pass += 1

  await db.post.createMany({ data: ['list-a', 'list-b', 'list-c'].map((id) => ({
    id, boardType: 'FREE' as const, title: id, content: 'body', authorId: 'author', status: 'PUBLISHED' as const,
  })) })
  const batchInput = {
    postIds: ['list-a', 'list-b', 'list-c', 'hidden'],
    kind: 'LIST_EXPOSURE' as const,
    surface: 'BOARD' as const,
    userId: null,
    anonymousToken: 'cccccccccccccccccccccccccccccccc',
    secret,
    now,
  }
  const firstBatch = await recordPostExposureBatch(db, batchInput)
  assert.deepEqual(firstBatch.acceptedIds.sort(), ['list-a', 'list-b', 'list-c'])
  assert.deepEqual(firstBatch.absentIds, ['hidden'])
  assert.deepEqual(firstBatch.duplicateIds, [])
  const secondBatch = await recordPostExposureBatch(db, batchInput)
  assert.deepEqual(secondBatch.duplicateIds.sort(), ['list-a', 'list-b', 'list-c'])
  assert.equal(await db.postExposureEvent.count({ where: { postId: { in: ['list-a', 'list-b', 'list-c'] } } }), 3)
  assert.equal(await db.post.count({ where: { id: { in: ['list-a', 'list-b', 'list-c'] }, viewCount: 1 } }), 3)
  assert.equal((await recordPostExposureBatch(db, { ...batchInput, userId: 'admin', anonymousToken: null })).excluded, true)
  pass += 1

  for (const actor of ['admin', 'persona', 'operator']) {
    assert.equal(await expose('visible', actor, null), 'excluded')
  }
  assert.equal(await expose('hidden', 'member', null), 'absent')
  assert.equal(await expose('missing', 'member', null), 'absent')
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'hidden' } })).viewCount, 0)
  pass += 1

  await db.post.create({ data: { id: 'race', boardType: 'FREE', title: 'race', content: 'body', authorId: 'author' } })
  const race = await Promise.all(Array.from({ length: 8 }, () => expose('race', null, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')))
  assert.equal(race.filter((x) => x === 'accepted').length, 1)
  assert.equal(race.filter((x) => x === 'duplicate').length, 7)
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'race' } })).viewCount, 1)
  assert.equal(await db.postExposureEvent.count({ where: { postId: 'race' } }), 1)
  pass += 1

  const historicalCount = (await db.post.findUniqueOrThrow({ where: { id: 'visible' } })).viewCount
  const deleted = await cleanupPostExposureEvents(db, new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000))
  assert.ok(deleted >= 1)
  assert.equal((await db.post.findUniqueOrThrow({ where: { id: 'visible' } })).viewCount, historicalCount)
  pass += 1

  console.log(`PASS ${pass} · FAIL 0 (격리 DB)`)
} finally {
  await db.$disconnect()
}
