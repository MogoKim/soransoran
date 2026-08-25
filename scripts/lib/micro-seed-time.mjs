/**
 * Micro Seed 시각·환경 유틸
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-7-A · §6-8 R4·R5
 *
 * 🔴 시간대 규약이 두 벌이 되는 것을 막는다
 *    Sheet 는 **KST 벽시계 문자열**(`YYYY-MM-DD HH:mm`)이고,
 *    DB 는 `timestamp(3) without time zone` 에 **UTC 벽시계**로 저장된다(Prisma 규약).
 *    변환을 스크립트마다 새로 적으면 한 곳만 틀려도 "같은 순간" 이 아니게 된다.
 *
 * 🔴 파싱은 여기 두지 않는다
 *    Sheet 문자열 → Date 는 micro-seed-validate.mjs 의 parseKst 가 유일한 지점이다.
 *    validator 가 통과시킨 시각과 동기화가 쓰는 시각이 갈라지면 안 된다 (C-2).
 *    이 파일은 **Date → 문자열** 방향과 반올림만 담당한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')

/** Date → `YYYY-MM-DD HH:mm` (KST). Sheet 에 적는 형식이며 parseKst 가 되읽을 수 있다 */
export function kstString(date) {
  const k = new Date(date.getTime() + KST_OFFSET_MS)
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`
}

/** Date → `YYYY-MM-DD HH:mm:ss` (UTC 벽시계). DB 저장값과 대조할 때 쓴다 */
export function utcWallClock(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * 5분 단위로 올림하고 초를 버린다.
 *
 * 🔴 내림하지 않는다. 내림하면 "지금보다 앞" 이 될 수 있고, 그 값은 R5 로 곧바로 HOLD 다.
 */
export function roundUpToFiveMinutes(date) {
  const d = new Date(date.getTime())
  d.setUTCSeconds(0, 0)
  const rem = d.getUTCMinutes() % 5
  if (rem !== 0) d.setTime(d.getTime() + (5 - rem) * 60_000)
  return d
}

/**
 * `.env.local` 을 읽어 process.env 에 채운다. 이미 있는 값은 덮지 않는다.
 *
 * 🔴 dotenv 를 더하지 않는다 — 스크립트 몇 개 때문에 공용 package.json 을 늘리지 않는다.
 *    dry-run-live 가 쓰는 것과 같은 규칙이다.
 * 🔴 값을 출력하지 않는다. 이 함수는 아무것도 console 에 쓰지 않는다.
 */
export async function loadEnvLocal() {
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
