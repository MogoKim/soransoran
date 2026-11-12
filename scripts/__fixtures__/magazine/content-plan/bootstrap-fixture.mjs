/**
 * 시험 전용 bootstrap helper — 합성 world 의 판으로 bootstrap 을 돌린다 (S2 P1-F · 운영 코드 밖).
 *
 * 왜 있나
 *   운영 `runBootstrap` 은 허용 판(BOOTSTRAP_GRAPH_VERSION) 상수 하나만 받고, 판을 바꾸는 손잡이가 없다.
 *   합성 world 의 판 이름은 내용 해시에서 나오므로(g-<날짜>-<combined 6>) 실제 허용 판과 같을 수 없다.
 *   그래서 이 helper 는 **운영 파일의 사본**을 임시 폴더에 쓰고, 상수 선언 한 줄만 world 의 판으로 바꿔 import 한다.
 *   나머지 로직(대조 · 조립 · 쓰기 · 출력 경로 안전)은 운영 파일 바이트 그대로다 — 운영 API 에는 아무것도 열지 않는다.
 * 🔴 선언이 정확히 1곳이 아니면 던진다(사본이 운영 로직과 갈라졌는지 모르는 채 시험하지 않는다).
 * 🔴 상대 import(`./lib/…`)는 운영 파일 옆 lib 의 절대 URL 로 바꾼다 — 변이 하네스의 사본 루트에서도 그 사본의 lib 를 쓴다.
 * 🔴 경합 시험(P1-7 · P1-8)을 위해 사본의 writer 호출 한 줄에만 단계 hook(globalThis.__planInputBootstrapStep)을 끼운다.
 *    운영 파일 · 운영 API 에는 hook 이 없다. 그 줄도 정확히 1곳이 아니면 던진다.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', '..', '..', 'magazine-plan-input-bootstrap.mjs')
const LIB_DIR = join(dirname(CLI), 'lib')
export const BOOTSTRAP_DECL_RE = /^export const BOOTSTRAP_GRAPH_VERSION = '(g-\d{8}-[0-9a-f]{6})'$/m
const VERSION_RE = /^g-\d{8}-[0-9a-f]{6}$/
const WRITER_CALL = 'writeBundleNoClobber({ rootReal: productRoot, outRel, text: built.text }, { beforePublish })'

const cache = new Map()
const files = new Map()
let tmp = null

/** world 의 판을 허용 판으로 둔 bootstrap 사본의 runBootstrap */
export async function fixtureBootstrap(graphVersion) {
  if (!VERSION_RE.test(graphVersion)) throw new Error(`fixture helper: 판 이름 형식 오류 ${graphVersion}`)
  if (cache.has(graphVersion)) return cache.get(graphVersion)
  const text = readFileSync(CLI, 'utf8')
  const hits = text.match(new RegExp(BOOTSTRAP_DECL_RE.source, 'gm')) ?? []
  if (hits.length !== 1) throw new Error(`fixture helper: 허용 판 선언이 ${hits.length}곳이다(정확히 1곳이어야 한다)`)
  const hits2 = text.split(WRITER_CALL).length - 1
  if (hits2 !== 1) throw new Error(`fixture helper: writer 호출이 ${hits2}곳이다(정확히 1곳이어야 한다)`)
  const copy = text
    .replace(WRITER_CALL, () => WRITER_CALL.replace('{ beforePublish }', '{ beforePublish, step: (n, i) => globalThis.__planInputBootstrapStep?.(n, i) }'))
    .replace(BOOTSTRAP_DECL_RE, `export const BOOTSTRAP_GRAPH_VERSION = '${graphVersion}'`)
    .replace(/from '\.\/lib\/([^']+)'/g, (_, f) => `from '${pathToFileURL(join(LIB_DIR, f)).href}'`)
  tmp ??= mkdtempSync(join(tmpdir(), 'plan-input-fixture-boot-'))
  const file = join(tmp, `boot-${graphVersion}.mjs`)
  writeFileSync(file, copy)
  const run = (await import(pathToFileURL(file).href)).runBootstrap
  cache.set(graphVersion, run)
  files.set(graphVersion, file)
  return run
}

/** 같은 사본 파일 경로 — CLI 로 띄우는 시험(실제 프로세스 fault)이 쓴다 */
export async function fixtureBootstrapFile(graphVersion) {
  await fixtureBootstrap(graphVersion)
  return files.get(graphVersion)
}

/** world 하나로 bootstrap — 운영 옵션 그대로(판 손잡이 없음) */
export async function bootWorld(w, extra = {}) {
  const run = await fixtureBootstrap(w.graphVersion)
  return run({ productRoot: w.productRoot, researchDir: w.researchDir, snapshotDir: w.snapshotDir, ...extra })
}

/** 임시 사본 폴더 정리 — 검사 끝에서 부른다 */
export function cleanupFixtureBootstrap() {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
  cache.clear()
  files.clear()
}
