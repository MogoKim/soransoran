/**
 * launchd 설치 정본 — 🔴 **저장소 템플릿이 정본이다. 인자를 두 벌로 적지 않는다**
 *
 * 🔴 **왜 생겼나** (2026-09-11).
 *
 *    `runtime:deploy` 는 기존 설치 plist 를 `unload` 하고 그대로 다시 `load` 했다.
 *    그래서 **저장소의 새 템플릿이 설치본에 닿지 못했다** — 배포를 몇 번 해도
 *    네이버 job 은 옛 `micro-seed-collect-navercafe.mts --pages=1 --max=10` 을 계속 돌았고,
 *    새로 만든 `supply-process` · `supply-collect-82cook-thin` 은 **영영 등록되지 않았다.**
 *    창업자에게 `sed`·`plutil`·`launchctl` 을 손으로 치게 하는 절차만 README 에 남아 있었다.
 *
 * 🔴 **정본을 하나로 둔다.** 설치할 인자·시각·로그 경로는 `docs/operations/launchd/*.template`
 *    안에만 있다. 배포기도, 격리 검사도, 템플릿 검사도 **같은 파일을 읽는다.**
 *    여기에 인자를 다시 적으면 그 순간 두 벌이 되고, 언젠가 한쪽만 고쳐진다.
 *
 * 🔴 이 파일은 **파일만 다룬다.** `launchctl` 을 부르지 않는다 — 부르는 쪽의 일이다.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 저장소 안 템플릿 디렉터리 */
export const TEMPLATE_DIR = 'docs/operations/launchd'

/** 🔴 설치 스크립트가 반드시 치환해야 하는 것들 */
export const PLACEHOLDERS = ['__NPX__', '__NODE__', '__REPO__', '__NODEBIN__', '__LOGDIR__'] as const

export type RenderVars = {
  npx: string
  node: string
  repo: string
  nodebin: string
  logdir: string
  /**
   * 🔴 템플릿마다 더 필요한 치환 — 키는 `__NAME__` 형태 그대로 적는다.
   *
   *    매거진 레인이 `__PATH__` · `__HOME__` 을 쓴다. PATH 조각을 여러 placeholder 로
   *    쪼개지 않고 **완성된 한 줄**로 넘긴다 — 조각으로 두면 설치기마다 순서가 달라지고,
   *    `gh` 가 빠진 PATH 가 한 벌 더 생긴다(2026-09-15 장애의 한 축).
   *
   *    D100 배포기는 이 값을 쓰지 않는다. 비어 있으면 동작이 예전과 같다.
   */
  extra?: Readonly<Record<string, string>>
}

export const templateFileOf = (label: string): string => `${label}.plist.template`
export const templatePathOf = (label: string, dir: string = TEMPLATE_DIR): string =>
  join(dir, templateFileOf(label))
export const plistFileOf = (label: string): string => `${label}.plist`

/** 🔴 렌더링 — 설치 절차와 **같은 치환**이어야 의미가 있다 */
export function render(xml: string, v: RenderVars): string {
  let out = xml
    .replaceAll('__NPX__', v.npx)
    .replaceAll('__NODE__', v.node)
    .replaceAll('__REPO__', v.repo)
    .replaceAll('__NODEBIN__', v.nodebin)
    .replaceAll('__LOGDIR__', v.logdir)
  for (const [key, value] of Object.entries(v.extra ?? {})) out = out.replaceAll(key, value)
  return out
}

/** 치환하고도 남은 placeholder — 🔴 하나라도 남으면 launchd 가 그 경로를 찾지 못한다 */
export function leftoverPlaceholders(rendered: string): string[] {
  return [...new Set([...rendered.matchAll(/__[A-Z_]+__/g)].map((m) => m[0]))]
}

/** plist 한 벌에서 키의 값을 읽는다 — 🔴 파서를 쓰지 않는다. 문자열 그대로 본다 */
export function valueOf(xml: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)
  const m = re.exec(xml)
  return m === null ? null : m[1]!
}

export function programArguments(xml: string): string[] {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)
  if (m === null) return []
  return [...m[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]!)
}

export function calendarSlots(xml: string): { hour: number; minute: number }[] {
  const m = /<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)
  if (m === null) return []
  return [...m[1]!.matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/g)]
    .map((x) => ({ hour: Number(x[1]), minute: Number(x[2]) }))
}

/**
 * 🔴 **인자를 값으로 대조한다.** 이어 붙여 비교하지 않는다 —
 *    구분자로 쓸 문자를 고르는 순간 "그 문자가 인자에 들어 있으면?" 이 새 결함이 된다.
 *    (앞선 판은 `join('\u0000')` 을 썼고, 소스에 실제 NUL 이 박혀 Git 이 이 파일을
 *     binary 로 취급했다 — diff 가 보이지 않았다.)
 */
export function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

// ─────────────────────────────────────────────────────────
// 설치 — 🔴 원자적으로 쓰고, 되돌릴 수 있게 원본을 먼저 읽는다
// ─────────────────────────────────────────────────────────

/** 설치된 plist 원문. 없으면 `null` — 🔴 "없다" 와 "못 읽었다" 를 구분해 던진다 */
export function readInstalled(agentDir: string, label: string): string | null {
  const p = join(agentDir, plistFileOf(label))
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf-8')
}

/** 🔴 임시 파일 후 rename — 반쯤 쓰인 plist 를 launchd 가 읽지 않게 */
export function writeInstalled(agentDir: string, label: string, xml: string): boolean {
  const p = join(agentDir, plistFileOf(label))
  const tmp = `${p}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, xml, { encoding: 'utf-8', mode: 0o644 })
    renameSync(tmp, p)
    return true
  } catch {
    try { rmSync(tmp, { force: true }) } catch { /* 임시 파일 정리 실패는 삼킨다 */ }
    return false
  }
}

export function removeInstalled(agentDir: string, label: string): boolean {
  try { rmSync(join(agentDir, plistFileOf(label)), { force: true }); return true } catch { return false }
}

/**
 * 🔴 **퇴역 plist 보관소의 이름 — 정본은 여기 하나다** (2026-09-11).
 *
 *    PR #501 배포가 마지막 게이트에서 멈춘 원인이 이 이름이었다.
 *    배포기는 `launchagents-rollback` 에 옮겼고, 격리 검사는 `launchd-rollback` 을 봤다 —
 *    파일은 정상적으로 옮겨졌는데 검사가 **다른 폴더를 보고** "보관본이 없다" 고 판정했다
 *    (266 pass · 1 fail). 이름을 두 벌로 두면 언젠가 한쪽만 고쳐진다.
 *
 *    🔴 부르는 쪽은 이 상수를 쓴다. 문자열을 다시 적지 않는다.
 */
export const ROLLBACK_DIR_NAME = 'launchd-rollback'

/** 정본 디렉터리(`CANON_DIR`) 아래의 보관소 절대경로 */
export const rollbackDirOf = (canonDir: string): string => join(canonDir, ROLLBACK_DIR_NAME)

/**
 * 🔴 **퇴역 plist 는 지우지 않고 옮긴다.** 되돌릴 수 있어야 한다.
 *    `launchctl unload` 만으로는 로그인·재부팅 때 다시 등록된다 —
 *    그 자리에서 **파일이 없어야** 퇴역이다.
 */
export function retireInstalled(agentDir: string, rollbackDir: string, label: string): boolean {
  const from = join(agentDir, plistFileOf(label))
  if (!existsSync(from)) return true
  try {
    renameSync(from, join(rollbackDir, plistFileOf(label)))
    return true
  } catch { return false }
}

/**
 * 🔴 **퇴역을 되돌린다** — 보관소의 사본을 제자리로 옮긴다.
 *    배포가 실패하면 퇴역도 되돌려야 한다. 보관소에 남겨 두면
 *    "배포는 안 됐는데 옛 job 만 사라진" 상태가 된다.
 */
export function unretireInstalled(agentDir: string, rollbackDir: string, label: string): boolean {
  const from = join(rollbackDir, plistFileOf(label))
  if (!existsSync(from)) return true
  try {
    renameSync(from, join(agentDir, plistFileOf(label)))
    return true
  } catch { return false }
}
