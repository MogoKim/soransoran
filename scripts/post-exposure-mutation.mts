#!/usr/bin/env tsx
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const original = readFileSync('src/lib/post-exposure-store.ts', 'utf8')
const exposure = readFileSync('src/lib/post-exposure.ts', 'utf8')
const cleanup = readFileSync('src/lib/post-exposure-cleanup.ts', 'utf8')

function problems(source: string): string[] {
  const out: string[] = []
  if (!/actor\.isAdmin/.test(source)) out.push('admin')
  if (!/actor\.persona !== null/.test(source)) out.push('persona')
  if (!/actor\.operatorWriter !== null/.test(source)) out.push('operator')
  // import 1회 + 공개 글 선조회 1회 + 증가 직전 재검사 1회.
  if ((source.match(/COMMUNITY_VISIBLE_WHERE/g) ?? []).length < 3) out.push('visibility')
  if (!/postExposureEvent\.create/.test(source)) out.push('ledger')
  if (!/isUniqueConflict\(error\)/.test(source)) out.push('unique')
  if (!/viewCount:\s*\{\s*increment:\s*1/.test(source)) out.push('counter')
  return out
}

assert.deepEqual(problems(original), [])

const mutations: Array<[string, string]> = [
  ['admin 제외 제거', ' || actor.isAdmin'],
  ['Persona 제외 제거', ' || actor.persona !== null'],
  ['Operator 제외 제거', ' || actor.operatorWriter !== null'],
  ['공개 글 재검사 제거', 'where: { id: postId, ...COMMUNITY_VISIBLE_WHERE },'],
  ['원장 create 제거', 'await tx.postExposureEvent.create({'],
  ['unique 충돌 처리 제거', "if (isUniqueConflict(error)) return 'duplicate'"],
  ['누적 증가 제거', 'data: { viewCount: { increment: 1 } },'],
]

let caught = 0
for (const [label, needle] of mutations) {
  const mutated = original.replace(needle, '')
  assert.notEqual(mutated, original, `${label}: 변이가 적재되지 않았다`)
  assert.ok(problems(mutated).length > 0, `${label}: 유효 변이를 놓쳤다`)
  caught += 1
  console.log(`  PASS ${label}`)
}

console.log(`\nPASS ${caught}/${mutations.length} mutation · 적재 실패 0`)

function boundaryProblems(exposureSource: string, cleanupSource: string): string[] {
  const out: string[] = []
  if (!/isKnownBotUserAgent\(h\.get\('user-agent'\)\)/.test(exposureSource)) out.push('bot')
  if (!/validCleanupAuthorization/.test(cleanupSource)) out.push('cleanup-auth')
  if (!/POST_EXPOSURE_CLEANUP_MAX_BATCHES = 10(?:\s|$)/.test(cleanupSource)) out.push('cleanup-bound')
  return out
}

assert.deepEqual(boundaryProblems(exposure, cleanup), [])
const boundaryMutations: Array<[string, string, string]> = [
  ['검색봇 제외 제거', exposure.replace("if (isKnownBotUserAgent(h.get('user-agent'))) return true", ''), cleanup],
  ['cleanup 인증 제거', exposure, cleanup.replace('validCleanupAuthorization', 'authorizationWasRemoved')],
  ['cleanup 상한 확대', exposure, cleanup.replace('POST_EXPOSURE_CLEANUP_MAX_BATCHES = 10', 'POST_EXPOSURE_CLEANUP_MAX_BATCHES = 100')],
]
for (const [label, mutatedExposure, mutatedCleanup] of boundaryMutations) {
  assert.ok(boundaryProblems(mutatedExposure, mutatedCleanup).length > 0, `${label}: 유효 변이를 놓쳤다`)
  console.log(`  PASS ${label}`)
}
console.log(`PASS ${boundaryMutations.length}/${boundaryMutations.length} bot·cleanup mutation · 적재 실패 0`)
