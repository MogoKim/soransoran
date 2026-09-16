/**
 * 막힌 후보 격리 — **공급을 막지 않게 한다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 실측).
 *
 *    supervised 회차에서 3건 중 2건이 QA 에 막혔다.
 *      dinner-change-two-weeks   1인칭 경험담 · 제목이 검색 질의 형태가 아님
 *      cold-weather-joint-pain   description 57자
 *
 *    막힌 것 자체는 정상이다 — 관문이 일한 것이다. 문제는 **다음 날도 같은 후보를
 *    같은 자리에서 다시 시도한다**는 것이다. gate 는 brief·review 만 보므로
 *    매일 같은 두 건이 앞자리를 차지하고, 뒤의 멀쩡한 후보가 `--limit` 에 밀린다.
 *    재고가 비는데 레인은 매일 같은 실패를 반복한다.
 *
 * 🔴 **고쳐 주지 않는다.** 자동화가 원고를 고치면 무엇이 잘못됐는지 아무도 안 본다
 *    (원고 관문과 같은 원칙). 여기서 하는 것은 **세 가지뿐**이다 —
 *      ① 실패를 센다
 *      ② 정해진 횟수를 넘으면 그 후보를 잠시 빼 둔다
 *      ③ 그래서 **다음 후보가 진행된다**
 *
 * 🔴 **영원히 빼지 않는다.** 냉각 시간이 지나면 다시 후보가 된다 —
 *    사람이 원고를 고쳤을 수 있고, 판정 기준이 바뀌었을 수도 있다.
 *
 * 🔴 **저장소 밖에 쓴다.** runtime 작업 트리는 깨끗해야 한다(write preflight).
 *    격리 기록이 추적 파일이면 매 회차 `DIRTY_TREE` 로 레인이 멈춘다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 🔴 저장소 밖이다. runtime 을 더럽히지 않는다 */
export const QUARANTINE_PATH = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'magazine-quarantine.json',
)

/**
 * 몇 번 막히면 빼 두는가.
 *
 * 🔴 2 다. 1 이면 그날 한 번 튄 실패로 후보가 빠지고, 3 이면 사흘을 낭비한다.
 *    실측한 두 건은 **구조적 실패**였다 — 제목 형태·1인칭·description 길이는
 *    다시 돌린다고 달라지지 않는다. 한 번 더 확인하고 빼는 것으로 충분하다.
 */
export const MAX_ATTEMPTS = 2

/**
 * 빼 둔 뒤 다시 보기까지.
 *
 * 🔴 7일. 사람이 원고를 고치는 데 걸리는 현실적인 시간이고,
 *    그 안에 고쳐졌으면 `article-draft.ts` 가 바뀌므로 아래 `fingerprint` 가 달라져
 *    **냉각을 기다리지 않고 즉시** 다시 후보가 된다.
 */
export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 원고가 바뀌었는지 보는 값. 내용이 달라지면 격리를 푼다.
 * 🔴 해시를 쓰지 않는다 — 길이와 마지막 수정 시각이면 "사람이 손댔다" 를 알기에 충분하다.
 */
export const fingerprintOf = ({ size = 0, mtimeMs = 0 } = {}) => `${size}:${Math.round(mtimeMs)}`

// ─────────────────────────────────────────────────────────
// 판정 — 🔴 파일을 읽지 않는다
// ─────────────────────────────────────────────────────────

/**
 * 이 후보를 이번 회차에서 건너뛰는가.
 *
 * @param {object} p
 * @param {{attempts:number, lastAt:number, fingerprint?:string, reasons?:string[]}|null} p.entry
 * @param {string|null} p.fingerprint  지금 원고의 지문
 * @param {number} p.now
 * @returns {{skip:boolean, code:string, message:string}}
 */
export function judgeQuarantine({ entry, fingerprint = null, now, maxAttempts = MAX_ATTEMPTS, cooldownMs = COOLDOWN_MS }) {
  if (!entry || !Number.isFinite(entry.attempts)) {
    return { skip: false, code: 'CLEAR', message: '격리 기록 없음' }
  }
  if (entry.attempts < maxAttempts) {
    return { skip: false, code: 'RETRYING', message: `막힌 적 ${entry.attempts}회 — ${maxAttempts}회까지는 다시 시도한다` }
  }
  // 🔴 원고가 바뀌었으면 즉시 푼다. 사람이 고쳤다는 뜻이다.
  if (fingerprint && entry.fingerprint && fingerprint !== entry.fingerprint) {
    return { skip: false, code: 'CHANGED', message: '원고가 바뀌었다 — 격리를 풀고 다시 본다' }
  }
  const age = now - (entry.lastAt ?? 0)
  if (age >= cooldownMs) {
    return { skip: false, code: 'COOLED', message: `격리 ${Math.round(age / 86400000)}일 경과 — 다시 본다` }
  }
  const left = Math.ceil((cooldownMs - age) / 86400000)
  return {
    skip: true,
    code: 'QUARANTINED',
    message:
      `${entry.attempts}회 연속 막혔다 — ${left}일 뒤 다시 본다 (원고를 고치면 즉시 해제). ` +
      `사유: ${(entry.reasons ?? []).slice(0, 2).join(' · ') || '기록 없음'}`,
  }
}

/** 실패를 한 번 센 뒤의 새 기록. **기존 객체를 고치지 않는다** */
export function recordFailure({ entry, fingerprint = null, now, reasons = [] }) {
  const prev = entry && Number.isFinite(entry.attempts) ? entry : { attempts: 0 }
  // 🔴 원고가 바뀌었으면 횟수를 처음부터 센다 — 고친 원고에 옛 실패를 얹지 않는다
  const changed = fingerprint && prev.fingerprint && fingerprint !== prev.fingerprint
  return {
    attempts: (changed ? 0 : prev.attempts) + 1,
    lastAt: now,
    fingerprint,
    reasons: reasons.slice(0, 4),
  }
}

// ─────────────────────────────────────────────────────────
// 저장 — 🔴 원자적으로 쓴다
// ─────────────────────────────────────────────────────────

export function loadQuarantine(path = QUARANTINE_PATH) {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // 🔴 깨진 기록을 빈 것으로 본다. 격리는 **막는 장치가 아니라 비켜 주는 장치**라
    //    읽지 못했다고 회차를 멈출 이유가 없다 — 최악이라도 한 번 더 시도할 뿐이다.
    return {}
  }
}

export function saveQuarantine(store, path = QUARANTINE_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 격리에서 완전히 지운다 — 등록에 성공한 후보 */
export function clearEntry(store, slug) {
  const next = { ...store }
  delete next[slug]
  return next
}
