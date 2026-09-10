#!/usr/bin/env tsx
/**
 * 익명 정본 자산 **1회 생성** — 🔴 AI 0 · DB 0 · 네트워크 0
 *
 *   npx tsx scripts/persona-reference-build-asset.mts          # dry-run
 *   npx tsx scripts/persona-reference-build-asset.mts --apply  # 실제 생성
 *
 * 🔴 **실제 작성자명을 저장하지 않는다** (2026-09-10, P0-4).
 *    개발 자산을 **한 번 읽는 이 단계에서만** author 를 쓰고, 즉시 불투명
 *    `speakerId` 로 바꾼다. 대응표는 어디에도 남기지 않는다 —
 *    남기면 그 표가 곧 복원 열쇠가 된다.
 *
 * 🔴 salt 는 이 프로세스 안에서만 살고 파일에 쓰이지 않는다.
 *    salt 없이 해시만 하면 닉네임 사전으로 전수 대입할 수 있다(공간이 작다).
 *
 * 🔴 원글 `body` · `url` · `sourceRef` 는 **읽지도 않는다.**
 * 🔴 기존 정본이 있으면 덮어쓰지 않는다. 내용이 다르면 멈춘다.
 */
import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  ASSET_VERSION, isTooOpen, judgeAssetShape, REFERENCE_CORPUS_FILE, REFERENCE_DIR,
  REFERENCE_DIR_MODE, REFERENCE_FILE_MODE, REFERENCE_MANIFEST_FILE, SPEAKER_ID_PATTERN,
  type AssetComment,
} from '../src/lib/persona-reference-asset'
import { REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS } from '../src/lib/persona-voice-reference'
import { REFERENCE_SOURCES } from './lib/persona-reference-store.mjs'
import { SANITIZER_VERSION } from '../src/lib/persona-eval-invalidation'

const APPLY = process.argv.includes('--apply')
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

console.log('\n══ 익명 정본 자산 생성 (🔴 AI 0 · DB 0) ══\n')
console.log(`  정본 디렉터리  ${REFERENCE_DIR}`)
console.log(`  모드           ${APPLY ? '🔴 --apply (실제 생성)' : 'dry-run (변경 0)'}`)

/** 🔴 저장하지 않는 salt — 이 프로세스에서만 산다 */
const SALT = randomUUID()
const speakerIdOf = (author: string): string =>
  createHash('sha256').update(`${SALT}|${author.trim()}`).digest('hex').slice(0, 12)

// ── 개발 자산을 한 번 읽는다 — 🔴 comments[].{author,content} 만 ──
const comments: AssetComment[] = []
const seen = new Set<string>()
const authorsSeen = new Set<string>()
for (const rel of REFERENCE_SOURCES) {
  if (!existsSync(rel)) fail(`개발 자산이 없다 — ${rel}`)
  const rows = JSON.parse(readFileSync(rel, 'utf-8')) as { comments?: unknown }[]
  for (const row of Array.isArray(rows) ? rows : []) {
    // 🔴 row.body · row.url · row.sourceRef 는 건드리지 않는다
    const cs = row.comments
    if (!Array.isArray(cs)) continue
    for (const c of cs) {
      if (c === null || typeof c !== 'object') continue
      const o = c as { author?: unknown; content?: unknown }
      if (typeof o.content !== 'string') continue
      const text = o.content.trim()
      if (text === '' || seen.has(text)) continue
      const n = [...text].length
      if (n < REFERENCE_MIN_CHARS || n > REFERENCE_MAX_CHARS) continue
      const author = typeof o.author === 'string' ? o.author.trim() : ''
      if (author === '') continue
      authorsSeen.add(author)
      seen.add(text)
      comments.push({ speakerId: speakerIdOf(author), content: text })
    }
  }
}
console.log(`\n  읽은 댓글      ${comments.length}건 · 화자 ${new Set(comments.map((c) => c.speakerId)).size}명`)
console.log('  🔴 실제 작성자명은 이 줄을 넘어가지 않는다 (대응표 미저장)')

if (comments.length === 0) fail('쓸 댓글이 없다')

// ── 🔴 만들어진 자산을 스스로 검사한다 ──
const asset = { version: ASSET_VERSION, generatedAt: new Date().toISOString(), comments }
const shape = judgeAssetShape(asset)
if (!shape.ok) fail(`모양이 계약을 어긴다 — ${shape.reason}`)
const badId = comments.filter((c) => !SPEAKER_ID_PATTERN.test(c.speakerId)).length
if (badId > 0) fail(`speakerId 모양이 아닌 항목 ${badId}건`)

/** 🔴 원 작성자명이 한 건이라도 자산에 남았는가 — 전수 대조 */
const serialized = JSON.stringify(asset, null, 2)
const leaked = [...authorsSeen].filter((a) => a.length >= 2 && serialized.includes(`"${a}"`))
if (leaked.length > 0) fail(`자산에 원 작성자명이 남았다 — ${leaked.length}건 (값은 출력하지 않는다)`)
console.log(`  🔴 원 작성자명 잔존 검사  ${authorsSeen.size}명 대조 → 0건`)

/** 🔴 salt 없는 해시로 speakerId 가 복원되는가 — 되면 사전 대입이 가능하다 */
const probe = [...authorsSeen].slice(0, 100).filter((a) => {
  const bare = createHash('sha256').update(a).digest('hex').slice(0, 12)
  return comments.some((c) => c.speakerId === bare)
})
if (probe.length > 0) fail('salt 없는 해시로 speakerId 가 복원된다')
console.log(`  🔴 salt 없는 해시로 복원 시도  ${Math.min(100, authorsSeen.size)}명 → 0건`)

const corpusJson = `${serialized}\n`
const corpusDigest = sha16(corpusJson)
console.log(`\n  corpus digest  ${corpusDigest}`)

if (!APPLY) {
  console.log('\n🟡 dry-run 이다. 파일 변경 0.')
  console.log('   할 일: 디렉터리 700 → temp write → atomic rename → 파일 600')
  console.log('          → manifest 기록 → 다시 읽어 digest·권한·식별자 확인\n')
  process.exit(0)
}

// ── 🔴 기존 정본이 있으면 덮어쓰지 않는다 ──
if (existsSync(REFERENCE_CORPUS_FILE)) {
  const cur = readFileSync(REFERENCE_CORPUS_FILE, 'utf-8')
  if (sha16(cur) === corpusDigest) {
    console.log('\n✅ 이미 같은 정본이 있다 — 바꿀 것이 없다.\n')
    process.exit(0)
  }
  fail(`정본이 이미 있고 내용이 다르다 — 덮어쓰지 않는다\n   ${REFERENCE_CORPUS_FILE}`)
}

mkdirSync(REFERENCE_DIR, { recursive: true, mode: REFERENCE_DIR_MODE })
chmodSync(REFERENCE_DIR, REFERENCE_DIR_MODE)

const tmp = `${REFERENCE_CORPUS_FILE}.staging-${process.pid}`
try {
  writeFileSync(tmp, corpusJson, { encoding: 'utf-8', mode: REFERENCE_FILE_MODE })
  renameSync(tmp, REFERENCE_CORPUS_FILE)
  chmodSync(REFERENCE_CORPUS_FILE, REFERENCE_FILE_MODE)
} catch (e) {
  try { rmSync(tmp, { force: true }) } catch { /* 이미 없다 */ }
  fail(`corpus 기록 실패 — ${(e as Error).message}`)
}

/**
 * 🔴 자산 manifest — 회차 manifest 와 **다른 것**이다.
 *    `personaBundleDigest` 는 회차마다 묶음이 달라지므로 여기서 정하지 않는다.
 */
const manifest = {
  sanitizerVersion: SANITIZER_VERSION,
  sourceDigest: corpusDigest,
  sanitizedCorpusDigest: sha16(JSON.stringify(comments.map((c) => c.content).sort())),
  commentCount: comments.length,
  identityLeakCheck: {
    ran: true,
    hits: 0,
    detail: `작성자 ${authorsSeen.size}명 대조 · 자산 잔존 0건 · salt 없는 복원 0건`,
  },
}
const mtmp = `${REFERENCE_MANIFEST_FILE}.staging-${process.pid}`
try {
  writeFileSync(mtmp, `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf-8', mode: REFERENCE_FILE_MODE })
  renameSync(mtmp, REFERENCE_MANIFEST_FILE)
  chmodSync(REFERENCE_MANIFEST_FILE, REFERENCE_FILE_MODE)
} catch (e) {
  try { rmSync(mtmp, { force: true }) } catch { /* 이미 없다 */ }
  fail(`manifest 기록 실패 — ${(e as Error).message}`)
}

// ── 🔴 다시 읽어 확인한다 ──
const back = readFileSync(REFERENCE_CORPUS_FILE, 'utf-8')
if (sha16(back) !== corpusDigest) fail('기록된 자산의 digest 가 다르다')
const mode = statSync(REFERENCE_CORPUS_FILE).mode
if (isTooOpen(mode)) fail(`권한이 느슨하다 — ${(mode & 0o777).toString(8)}`)
const reread = judgeAssetShape(JSON.parse(back))
if (!reread.ok) fail(`다시 읽은 자산이 계약을 어긴다 — ${reread.reason}`)

console.log('\n✅ 정본 생성 완료')
console.log(`   corpus    ${REFERENCE_CORPUS_FILE} · ${(mode & 0o777).toString(8)} · ${corpusDigest}`)
console.log(`   manifest  ${REFERENCE_MANIFEST_FILE}`)
console.log(`   댓글 ${comments.length}건 · 화자 ${new Set(comments.map((c) => c.speakerId)).size}명`)
console.log('   🔴 원 작성자명 0건 · 대응표 미저장 · 원글 body·url·sourceRef 미수록\n')
