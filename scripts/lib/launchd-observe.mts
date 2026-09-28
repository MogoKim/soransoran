/**
 * launchd 실측 — 🔴 **read-only. load · unload · 파일 write 0**
 *
 * 🔴 왜 필요한가.
 *    "지금 무엇이 돌고 있는가" 를 코드 상수(`loaded: true`)로 적어 두면, job 을 올리지도
 *    않고 능력이 늘어난 것처럼 계산된다 — 실제로 그랬다(카페 1회 job 을 다회 4회로 셌다).
 *    등록 상태의 정본은 `launchctl list` 와 **설치된 plist** 다.
 *
 * 🔴 이 파일은 관측만 만든다. 판정은 `src/lib/collect-inventory.ts`(순수 함수)가 한다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ObservedJob } from '../../src/lib/collect-inventory'

export const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')

/** 🔴 `launchctl list` 에 올라와 있는 label 들. 실패하면 **빈 집합이 아니라 예외**다 */
export function loadedLabels(): Set<string> {
  const out = execFileSync('launchctl', ['list'], { encoding: 'utf-8' })
  const set = new Set<string>()
  for (const line of out.split('\n')) {
    const label = line.trim().split(/\s+/)[2]
    if (label !== undefined && label.startsWith('com.soransoran.')) set.add(label)
  }
  return set
}

/** 설치된 plist 의 `StartCalendarInterval` 슬롯 — 🔴 계획이 아니라 **파일에 적힌 것**이다 */
export function slotsOfPlist(path: string): { hour: number; minute: number }[] {
  const xml = readFileSync(path, 'utf-8')
  const out: { hour: number; minute: number }[] = []
  const re = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push({ hour: Number(m[1]), minute: Number(m[2]) })
  return out
}

/**
 * 🔴 **지금 이 기계의 수집 job 관측.**
 *    · `launchctl list` 에 있는 label 만 `loaded: true`
 *    · 슬롯은 설치된 plist 에서 읽는다. 파일이 없으면 슬롯 0 — "돌고 있지만 시각을 모른다"
 */
export function observeJobs(): ObservedJob[] {
  const loaded = loadedLabels()
  const files = existsSync(AGENT_DIR)
    ? readdirSync(AGENT_DIR).filter((f) => f.startsWith('com.soransoran.') && f.endsWith('.plist'))
    : []
  const labels = new Set<string>([...loaded, ...files.map((f) => f.replace(/\.plist$/, ''))])
  return [...labels].sort().map((label) => {
    const path = join(AGENT_DIR, `${label}.plist`)
    return {
      label,
      slots: existsSync(path) ? slotsOfPlist(path) : [],
      loaded: loaded.has(label),
    }
  })
}

/** 🔴 관측에 실패하면 **모른다**로 남긴다 — "없다"로 읽으면 미등록을 정상으로 본다 */
export function observeJobsSafe(): { observed: ObservedJob[]; problem: string | null } {
  try {
    return { observed: observeJobs(), problem: null }
  } catch (e) {
    return { observed: [], problem: `launchctl 관측 실패: ${(e as Error).message}` }
  }
}
