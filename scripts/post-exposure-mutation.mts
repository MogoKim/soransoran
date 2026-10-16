#!/usr/bin/env tsx
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const original = readFileSync('src/lib/post-exposure-store.ts', 'utf8')
const exposure = readFileSync('src/lib/post-exposure.ts', 'utf8')
const cleanup = readFileSync('src/lib/post-exposure-cleanup.ts', 'utf8')
const tracker = readFileSync('src/components/features/PostExposureList.tsx', 'utf8')
const contract = readFileSync('src/lib/post-exposure-contract.ts', 'utf8')

function problems(source: string): string[] {
  const out: string[] = []
  if ((source.match(/actor\.isAdmin/g) ?? []).length < 2) out.push('admin')
  if ((source.match(/actor\.persona !== null/g) ?? []).length < 2) out.push('persona')
  if ((source.match(/actor\.operatorWriter !== null/g) ?? []).length < 2) out.push('operator')
  // import 1회 + 상세 선조회·재검사 2회 + batch 선조회·재검사 2회.
  if ((source.match(/COMMUNITY_VISIBLE_WHERE/g) ?? []).length < 5) out.push('visibility')
  if (!/postExposureEvent\.create\(/.test(source) || !/postExposureEvent\.createManyAndReturn/.test(source)) out.push('ledger')
  if (!/skipDuplicates:\s*true/.test(source)) out.push('batch-unique')
  if (!/isUniqueConflict\(error\)/.test(source)) out.push('unique')
  if ((source.match(/viewCount:\s*\{\s*increment:\s*1/g) ?? []).length < 2) out.push('counter')
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
  ['batch unique 제거', 'skipDuplicates: true,'],
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

function listProblems(trackerSource: string, contractSource: string): string[] {
  const out: string[] = []
  if (!/MIN_VISIBLE_RATIO = 0\.5/.test(trackerSource)) out.push('ratio')
  if (!/MIN_VISIBLE_MS = 1_000/.test(trackerSource)) out.push('dwell')
  if ((trackerSource.match(/document\.visibilityState !== 'visible'/g) ?? []).length < 2) out.push('foreground')
  if (!/POST_EXPOSURE_BATCH_MAX = 20(?:\s|$)/.test(contractSource)) out.push('batch')
  if (!/POST_EXPOSURE_LIST_SURFACES = \['HOME', 'BOARD', 'BEST', 'NEXT_TO_READ'\]/.test(contractSource)) out.push('surfaces')
  return out
}

assert.deepEqual(listProblems(tracker, contract), [])
const listMutations: Array<[string, string, string]> = [
  ['노출 비율 완화', tracker.replace('MIN_VISIBLE_RATIO = 0.5', 'MIN_VISIBLE_RATIO = 0.1'), contract],
  ['노출 시간 제거', tracker.replace('MIN_VISIBLE_MS = 1_000', 'MIN_VISIBLE_MS = 0'), contract],
  ['백그라운드 제외 제거', tracker.replace("document.visibilityState !== 'visible'", 'false'), contract],
  ['batch 상한 확대', tracker, contract.replace('POST_EXPOSURE_BATCH_MAX = 20', 'POST_EXPOSURE_BATCH_MAX = 200')],
  ['상세를 목록 표면에 혼입', tracker, contract.replace(
    "POST_EXPOSURE_LIST_SURFACES = ['HOME', 'BOARD', 'BEST', 'NEXT_TO_READ']",
    "POST_EXPOSURE_LIST_SURFACES = ['DETAIL', 'HOME', 'BOARD', 'BEST', 'NEXT_TO_READ']",
  )],
]
for (const [label, mutatedTracker, mutatedContract] of listMutations) {
  assert.ok(listProblems(mutatedTracker, mutatedContract).length > 0, `${label}: 유효 변이를 놓쳤다`)
  console.log(`  PASS ${label}`)
}
console.log(`PASS ${listMutations.length}/${listMutations.length} 목록 노출 mutation · 적재 실패 0`)
