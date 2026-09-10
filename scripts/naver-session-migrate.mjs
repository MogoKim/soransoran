#!/usr/bin/env node
/**
 * Naver 세션 **정본 이전** — 🔴 쿠키 값·자격증명을 출력하지 않는다
 *
 *   node scripts/naver-session-migrate.mjs           # dry-run (기본)
 *   node scripts/naver-session-migrate.mjs --apply   # 실제 이전
 *
 * 🔴 **왜 필요한가.**
 *    `SORAN_NAVERCAFE_SESSION_PATH` 가 상대 경로였고 세션 파일은 개발 트리에만 있었다.
 *    launchd 의 `WorkingDirectory` 는 runtime worktree 라 다회 수집 job 이
 *    8회 연속 `SESSION_FILE_MISSING` 으로 중단됐다.
 *
 * 🔴 **계약**
 *    · 정본은 `~/Library/Application Support/soransoran/naver-session/` 아래다
 *    · 디렉터리 700 · 파일 600 을 강제한다
 *    · temp copy → **내용 digest 대조** → atomic rename 으로 옮긴다
 *    · env 는 **그 한 항목만** 절대 경로로 바꾼다 (temp → rename)
 *    · 끝나면 worktree 안의 옛 파일은 남기지 않는다
 *
 * 🔴 이 스크립트는 로그인하지 않는다. 세션이 만료됐으면 사람이 headed 로 재발급한다.
 */
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = join(__dirname, '..')

const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const SESSION_DIR = join(CANON_DIR, 'naver-session')
const SESSION_FILE = join(SESSION_DIR, 'soransoran-storage-state.json')
const ENV_FILE = join(CANON_DIR, 'env.local')
const ENV_KEY = 'SORAN_NAVERCAFE_SESSION_PATH'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

const APPLY = process.argv.includes('--apply')
const fail = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m) => console.log(`   ✅ ${m}`)

/** 🔴 값은 절대 반환하지 않는다. 길이와 digest 만 본다 */
const digestOf = (path) => {
  const buf = readFileSync(path)
  return { sha: createHash('sha256').update(buf).digest('hex').slice(0, 16), bytes: buf.length }
}

console.log('\n══ Naver 세션 정본 이전 (🔴 쿠키 값 미출력) ══\n')
console.log(`  정본 디렉터리  ${SESSION_DIR}`)
console.log(`  정본 파일      ${SESSION_FILE}`)
console.log(`  공유 env       ${ENV_FILE}`)
console.log(`  모드           ${APPLY ? '🔴 --apply (실제 이전)' : 'dry-run (변경 0)'}`)

// ── ① 현재 env 값 ──
if (!existsSync(ENV_FILE)) fail(`공유 env 가 없다 — ${ENV_FILE}`)
const envText = readFileSync(ENV_FILE, 'utf-8')
const lines = envText.split('\n')
const idx = lines.findIndex((l) => l.startsWith(`${ENV_KEY}=`))
if (idx < 0) fail(`${ENV_KEY} 항목이 공유 env 에 없다`)
const currentValue = lines[idx].slice(`${ENV_KEY}=`.length).trim()
console.log(`\n  현재 env 값    ${currentValue}`)
console.log(`  바뀔 값        ${SESSION_FILE}`)

if (currentValue === SESSION_FILE && existsSync(SESSION_FILE)) {
  ok('이미 정본을 가리키고 있다 — 바꿀 것이 없다')
  process.exit(0)
}

// ── ② 원본 찾기 ──
const source = currentValue.startsWith('/') ? currentValue : join(REPO, currentValue)
if (!existsSync(source)) {
  fail(`옮길 세션 파일이 없다 — ${source}\n`
    + '   🔴 자동 로그인하지 않는다. 사람이 headed 로 재발급한다:\n'
    + '      npm run navercafe:session-setup');
}
const st = statSync(source)
if (!st.isFile()) fail(`원본이 일반 파일이 아니다 — ${source}`)
const src = digestOf(source)
console.log(`\n  원본           ${source}`)
console.log(`                 ${src.bytes} bytes · sha256:${src.sha} (🔴 내용은 찍지 않는다)`)

/** 🔴 모양이 아니면 옮기지 않는다 — 깨진 세션을 정본 자리에 놓지 않는다 */
const shapeOk = (() => {
  try {
    const j = JSON.parse(readFileSync(source, 'utf-8'))
    return j !== null && typeof j === 'object' && Array.isArray(j.cookies)
      && Array.isArray(j.origins) && j.cookies.length > 0
  } catch { return false }
})()
if (!shapeOk) {
  fail('원본이 storageState 모양이 아니다 — 옮기지 않는다\n'
    + '   🔴 사람이 headed 로 재발급한다: npm run navercafe:session-setup')
}
ok('원본이 storageState 모양이다 (cookies · origins 있음)')

if (!APPLY) {
  console.log('\n🟡 dry-run 이다. 파일·env 변경 0.\n')
  console.log('   할 일: 디렉터리 700 생성 → temp copy → digest 대조 → atomic rename')
  console.log(`          → env 의 ${ENV_KEY} 한 항목만 절대 경로로 교체 → 옛 파일 제거\n`)
  process.exit(0)
}

// ── ③ 디렉터리 700 ──
mkdirSync(SESSION_DIR, { recursive: true, mode: DIR_MODE })
chmodSync(SESSION_DIR, DIR_MODE)
ok(`디렉터리 준비 · 권한 ${DIR_MODE.toString(8)}`)

// ── ④ temp copy → digest 대조 → atomic rename ──
const tmp = join(SESSION_DIR, `.staging-${process.pid}.json`)
try {
  copyFileSync(source, tmp)
  chmodSync(tmp, FILE_MODE)
  const copied = digestOf(tmp)
  // 🔴 내용이 같은지 **digest 로** 확인한 뒤에만 들여놓는다
  if (copied.sha !== src.sha || copied.bytes !== src.bytes) {
    rmSync(tmp, { force: true })
    fail(`복사본이 원본과 다르다 — 옮기지 않았다 (${src.sha} ≠ ${copied.sha})`)
  }
  ok(`복사본 digest 일치 — sha256:${copied.sha}`)
  renameSync(tmp, SESSION_FILE)
  chmodSync(SESSION_FILE, FILE_MODE)
} catch (e) {
  try { rmSync(tmp, { force: true }) } catch { /* 이미 없다 */ }
  fail(`이전 실패 — ${e.message}`)
}
const moved = digestOf(SESSION_FILE)
if (moved.sha !== src.sha) fail(`정본 자리의 내용이 원본과 다르다 (${moved.sha})`)
ok(`정본 배치 완료 · 권한 ${(statSync(SESSION_FILE).mode & 0o777).toString(8)} · sha256:${moved.sha}`)

// ── ⑤ env 의 그 한 항목만 원자적으로 교체 ──
const before = lines.slice()
lines[idx] = `${ENV_KEY}=${SESSION_FILE}`
const changed = lines.filter((l, i) => l !== before[i]).length
if (changed !== 1) fail(`env 에서 바뀐 줄이 ${changed}개다 — 1개여야 한다`)
const envTmp = `${ENV_FILE}.staging-${process.pid}`
try {
  writeFileSync(envTmp, lines.join('\n'), { encoding: 'utf-8', mode: FILE_MODE })
  renameSync(envTmp, ENV_FILE)
  chmodSync(ENV_FILE, FILE_MODE)
} catch (e) {
  try { rmSync(envTmp, { force: true }) } catch { /* 이미 없다 */ }
  fail(`env 갱신 실패 — ${e.message}`)
}
ok(`env 한 항목 교체 — ${ENV_KEY}`)

// ── ⑥ worktree 안의 옛 파일 제거 ──
if (!source.startsWith(CANON_DIR)) {
  try {
    unlinkSync(source)
    ok(`옛 세션 파일 제거 — ${source}`)
  } catch (e) {
    console.log(`   🟡 옛 파일을 지우지 못했다 — ${e.message} (손으로 지운다)`)
  }
}

console.log('\n✅ 이전 완료. 개발 트리와 runtime 이 같은 정본을 읽는다.')
console.log('   🔴 쿠키 값·자격증명은 출력하지 않았다.\n')
