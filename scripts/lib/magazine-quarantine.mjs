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
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync,
  writeFileSync, writeSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
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
import { classifyFailure, consumesAttempt, cooldownFor, sentOf, normalizeSent } from './magazine-failure-kind.mjs'

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
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **size:mtime 이었다. 그래서 격리가 한 번도 작동하지 않았다** (2026-09-17 실측).
 *
 *    지문의 대상이 `article-draft.ts` 인데, 그 파일은 **회차마다 자동 변환이
 *    다시 만든다.** 내용이 한 글자도 안 바뀌어도 mtime 이 바뀐다.
 *    그러면 `recordFailure` 가 "원고가 바뀌었다" 로 보고 **attempts 를 1 로 되돌린다.**
 *
 *    실측: dinner-change-two-weeks 와 cold-weather-joint-pain 이 9/16·9/17
 *    연속 실패했는데 attempts 가 둘 다 1 이었다. size 는 6282 로 같고 mtime 만 달랐다.
 *    MAX_ATTEMPTS=2 에 **영원히 닿지 않는다** — 격리가 없는 것과 같다.
 *    그 결과 같은 실패 후보가 매일 처리 예산을 먹고 새 후보를 밀어냈다.
 *
 * 🔴 **그래서 내용을 해시한다.** 시각도 경로도 넣지 않는다 —
 *    같은 내용을 다시 변환하면 같은 값이어야 한다.
 * 🔴 **줄 끝과 앞뒤 공백을 지운다.** 변환기가 개행을 다르게 쓰는 것으로
 *    "사람이 고쳤다" 가 되면 같은 결함이 다시 생긴다.
 */
export function fingerprintOf(input) {
  // 옛 호출 모양({size, mtimeMs})으로 들어오면 지문을 만들지 않는다.
  // 🔴 조용히 옛 값을 돌려주면 그 자리만 결함이 살아남는다.
  if (input === null || input === undefined) return null
  if (typeof input === 'object') {
    throw new TypeError('fingerprintOf 는 원고 **내용 문자열**을 받는다 (size/mtime 은 회차마다 바뀌어 격리를 무력화했다)')
  }
  const normalized = String(input).replace(/\r\n/g, '\n').trim()
  if (normalized === '') return null
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32)}`
}

// ─────────────────────────────────────────────────────────
// 전송 사실 — 🔴 **slug 와 보낸 글자**에 붙는다. 회차·날짜에 붙지 않는다.
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **왜 회차 지문으로는 못 막는가** (2026-09-28 · 재검토 P0-1).
 *
 *    앞판은 회수 결과 파일을 `runId`(그 회차 목록의 지문)로 검증했다.
 *    그런데 `runId` 는 **목록 전체**의 지문이다 — 아무 상관 없는 후보 하나가
 *    `run.json` 에 추가되기만 해도 값이 바뀐다. 그러면 이미 보낸 `h-b` 의 HOLD 가
 *    같이 풀리고 **같은 brief 가 두 번째로 전송된다.**
 *
 *    보낸 사실은 회차의 성질이 아니라 **그 글의 성질**이다.
 *    그래서 `slug` + **실제로 보낸 메시지의 지문**에 붙인다.
 *    날짜가 바뀌어도, 목록이 바뀌어도, 다른 후보가 늘어도 그대로 남는다.
 *    brief 나 프롬프트가 바뀌어 **보낼 글자가 달라질 때만** 다시 보낸다.
 *
 * 🔴 장부는 하나다. 새 파일을 만들지 않는다 — 두 장부는 반드시 어긋난다.
 */
export function deliveryFingerprintOf(message) {
  if (message === null || message === undefined) return null
  if (typeof message === 'object') {
    throw new TypeError('deliveryFingerprintOf 는 **보낼 메시지 문자열**을 받는다')
  }
  const text = String(message).replace(/\r\n/g, '\n')
  if (text === '') return null
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/**
 * 전송 사실을 한 줄 적는다. **`attempts` 도 `regenCalls` 도 건드리지 않는다** —
 * 보낸 것은 원고가 틀린 횟수가 아니다.
 *
 * @param {object|null} entry 기존 행 (건드리지 않는다)
 */
export function recordDelivery(entry, { sent, messageFingerprint, kind = null, reason = null, stage = null, now, runId = null, date = null, reservationId = null }) {
  return {
    ...(entry ?? {}),
    delivery: {
      sent: normalizeSent(sent),
      messageFingerprint: messageFingerprint ?? null,
      kind: kind ?? null,
      reason: reason ?? null,
      stage: stage ?? null,
      at: now,
      // 🔴 출처 기록용이다. **판정에 쓰지 않는다.**
      runId: runId ?? null,
      date: date ?? null,
      // 🔴 send 권한을 얻은 프로세스의 예약 ID — 성공 뒤 **내 예약만** 지우기 위한 표식
      reservationId: reservationId ?? null,
    },
  }
}

/** 받아냈으면 전송 기록을 지운다 — 다음에 고쳐서 다시 부를 수 있어야 한다 */
export function clearDelivery(entry) {
  if (!entry || entry.delivery === undefined) return entry ?? null
  const { delivery, ...rest } = entry
  void delivery
  return rest
}

/**
 * 지금 보내려는 메시지를 **다시 보내면 안 되는가.**
 *
 * 🔴 막는 조건은 셋이 **모두** 맞을 때뿐이다:
 *    ① 전송 기록이 있고 ② 지문이 **같고** ③ 그 결말이 DELIVERY_UNCERTAIN 이다.
 *
 *    지문이 다르면(=brief 나 프롬프트가 바뀌었으면) 다른 글이므로 보낸다.
 *    결말이 INFRA·CONTENT 면 여기서 막지 않는다 — 각자 다른 장치가 센다.
 */
/**
 * 🔴 **전송 경계가 HOLD 로 멈췄다는 사유 코드 — 정본은 여기 하나다.**
 *    전송 경계(`fetchSlug`)가 적고, 재생성(`attemptRegeneration`)이 읽는다.
 *    이번 실행은 한 글자도 보내지 않았으므로 **재생성 횟수도 전송 기록도 바꾸지 않는다.**
 */
export const DELIVERY_HOLD_REASON = 'DELIVERY_UNCERTAIN_HOLD'

export function deliveryHoldsFetch(entry, messageFingerprint) {
  const d = entry?.delivery
  if (!d || !d.messageFingerprint || !messageFingerprint) return null
  if (d.messageFingerprint !== messageFingerprint) return null
  if (d.kind !== 'DELIVERY_UNCERTAIN') return null
  return {
    why: `이미 보낸 글이다 (${d.date ?? '날짜 미상'} · ${d.stage ?? '-'} ${d.reason ?? '-'}) — 다시 보내지 않는다`,
    delivery: d,
  }
}

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
  /**
   * 🔴 **인프라 실패는 긴 격리의 근거가 아니다** (2026-09-28).
   *    `[attach] upload_timeout` 같은 실패로 5~7일을 묶으면, 브라우저를 고쳐도
   *    공급이 돌아오지 않는다. 원고가 틀린 것이 아니므로 **짧은 backoff** 만 둔다.
   *    🔴 과거 장부 행을 고치지 않는다 — **읽어서 유효 상태를 파생**할 뿐이다.
   */
  const kind = entryKind(entry)
  if (kind !== 'CONTENT') {
    const age = now - (entry.lastAt ?? 0)
    const wait = cooldownFor(kind, cooldownMs)
    if (age >= wait) {
      return { skip: false, code: 'INFRA_COOLED', message: `인프라 실패 — backoff 지나 다시 본다 (${kind})` }
    }
    return {
      skip: true, code: 'INFRA_BACKOFF',
      message: `인프라 실패라 짧게 쉰다 (${kind}) — ${Math.ceil((wait - age) / 60000)}분 뒤 다시 본다`,
    }
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

/**
 * 🔴 **기록된 사유에서 종류를 파생한다.** 옛 행에는 `kind` 가 없다 —
 *    그래도 사유 문장으로 판정한다. 장부를 손으로 고치지 않기 위해서다.
 */
export function entryKind(entry) {
  if (!entry) return 'CONTENT'
  if (entry.kind) return entry.kind
  const text = (entry.reasons ?? []).join(' | ')
  return classifyFailure({ message: text, sent: sentOf(entry) }).kind
}

/** 실패를 한 번 센 뒤의 새 기록. **기존 객체를 고치지 않는다** */
export function recordFailure({ entry, fingerprint = null, now, reasons = [], kind = null, sent = false }) {
  // 🔴 모름(null)을 false 로 굳히지 않는다 — 굳히면 다시 보낸다
  const sentValue = normalizeSent(sent)
  const prev = entry && Number.isFinite(entry.attempts) ? entry : { attempts: 0 }
  // 🔴 원고가 바뀌었으면 횟수를 처음부터 센다 — 고친 원고에 옛 실패를 얹지 않는다
  const changed = fingerprint && prev.fingerprint && fingerprint !== prev.fingerprint
  /**
   * 🔴 **인프라 실패는 attempts 를 올리지 않는다.** 원고가 틀린 횟수를 세는 칸이기 때문이다.
   *    대신 종류와 시각을 남겨 backoff 가 그것을 읽게 한다.
   */
  const resolved = kind ?? classifyFailure({ message: reasons.join(' | '), sent: sentValue }).kind
  const bump = consumesAttempt(resolved) ? 1 : 0
  return {
    kind: resolved,
    sent: sentValue,
    attempts: (changed ? 0 : prev.attempts) + bump,
    lastAt: now,
    fingerprint,
    reasons: reasons.slice(0, 4),
  }
}

// ─────────────────────────────────────────────────────────
// 저장 — 🔴 원자적으로 쓴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **깨진 장부를 빈 장부로 초기화하지 않는다.**
 *
 *    옛 판은 파싱 실패를 `{}` 로 돌려줬다. 그러면 모든 slug 의 시도 횟수가 0 이 되고,
 *    **영원히 실패하는 글이 매 회차 재생성 예산을 다시 먹는다** — 격리가 사라진다.
 *    장부를 읽지 못하는 것은 "아무 일도 없었다" 가 아니라 **모른다**는 뜻이다.
 *
 *    그래서 읽기 실패는 `{ ok:false }` 로 알린다. 호출부는 그 회차의 후보를
 *    **전부 HOLD** 로 두고 다음 회차를 기다린다 — 새 글을 태우지도, 옛 실패를 지우지도 않는다.
 */
export function readQuarantine(path = QUARANTINE_PATH) {
  if (!existsSync(path)) return { ok: true, store: {}, why: '장부 없음 — 처음이다' }
  let raw
  try { raw = readFileSync(path, 'utf8') }
  catch (e) { return { ok: false, store: {}, why: `🔴 장부를 읽지 못했다: ${e.message}` } }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, store: {}, why: '🔴 장부가 객체가 아니다' }
    }
    return { ok: true, store: parsed, why: null }
  } catch (e) {
    return { ok: false, store: {}, why: `🔴 장부가 깨졌다: ${e.message}` }
  }
}

/** 옛 호출부 호환 — 🔴 깨졌을 때 빈 것으로 보지 않도록 던진다 */
export function loadQuarantine(path = QUARANTINE_PATH) {
  const r = readQuarantine(path)
  if (!r.ok) {
    const err = new Error(r.why)
    err.code = 'QUARANTINE_UNREADABLE'
    throw err
  }
  return r.store
}

export function saveQuarantine(store, path = QUARANTINE_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const text = `${JSON.stringify(store, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
  // 🔴 썼다고 말한 것이 실제로 읽히는지 확인한다 — 반쪽 파일은 격리를 지운다
  if (readFileSync(path, 'utf8') !== text) {
    throw new Error('🔴 장부 저장 확인 실패 — 쓴 내용과 읽은 내용이 다르다')
  }
  return path
}

/**
 * 🔴 **재생성 시도도 같은 장부에 센다.** 장부를 둘로 나누지 않는다 —
 *    두 장부가 따로 돌면 한쪽은 HOLD, 다른 쪽은 재시도가 되어 무엇이 참인지 알 수 없다.
 */
export const MAX_REGEN_CALLS = MAX_ATTEMPTS

/** 이 slug 를 이번 회차에 몇 번 더 재생성할 수 있나 */
export function regenBudget({ entry, maxCalls = MAX_REGEN_CALLS }) {
  const used = Number.isFinite(entry?.regenCalls) ? entry.regenCalls : 0
  return { used, left: Math.max(0, maxCalls - used), exhausted: used >= maxCalls }
}

/** 재생성 호출 1회를 기록한 새 entry */
export function recordRegenCall({ entry, now, packetHash = null }) {
  const prev = entry && typeof entry === 'object' ? entry : {}
  return {
    ...prev,
    attempts: Number.isFinite(prev.attempts) ? prev.attempts : 0,
    regenCalls: (Number.isFinite(prev.regenCalls) ? prev.regenCalls : 0) + 1,
    lastRegenAt: now,
    lastPacketHash: packetHash,
  }
}

/**
 * 🔴 **읽기-수정-쓰기를 한 번에.** 장부를 고치는 자리는 전부 이것을 쓴다.
 *
 *    앞판은 `ready` 가 회차 시작에 store 를 통째로 읽어 두고 끝에 그대로 저장했다.
 *    그 사이 `drive` 가 같은 장부에 `regenCalls` 를 기록하면 **덮여서 사라진다**
 *    (lost update). 그러면 2회 소진한 글이 다음 회차에 0회로 되살아난다.
 *
 *    그래서 **매 변경마다 최신 장부를 다시 읽는다.** 들고 있던 사본을 쓰지 않는다.
 */
export function updateQuarantine(mutate, path = QUARANTINE_PATH) {
  /**
   * 🔴 **읽기·판정·쓰기 전체가 하나의 프로세스 간 임계구역이다** (2026-09-28 · Codex P0).
   *    앞판은 read → mutate → save 였을 뿐 잠금이 없었다. 두 프로세스가 같은 slug·같은 지문을
   *    동시에 처리하면 **둘 다 "HOLD 없음" 을 읽고 둘 다 send 권한을 얻었다.**
   *    tmp → rename 은 파일이 반쪽이 되는 것만 막을 뿐 이 경합은 막지 못한다.
   *    다른 slug 끼리도 마찬가지다 — 나중에 쓴 쪽이 먼저 쓴 쪽의 행을 지웠다 (lost update).
   */
  const locked = withQuarantineLock(path, () => {
    const read = readQuarantine(path)
    if (!read.ok) return { ok: false, code: 'QUARANTINE_UNREADABLE', why: read.why }
    const next = mutate({ ...read.store })
    if (!next || typeof next !== 'object') return { ok: false, why: '🔴 갱신 함수가 장부를 돌려주지 않았다' }
    saveQuarantine(next, path)
    return { ok: true, store: next }
  })
  if (!locked.ok) return { ok: false, code: locked.code, why: locked.why }
  return locked.value
}

// ─────────────────────────────────────────────────────────
// 잠금 — 🔴 `llm-ledger-store.mts` 의 `withLedgerLock` 과 같은 규약이다.
//    (그 파일은 TS 라 Node 20 의 .mjs 가 직접 부르지 못한다 — 규약을 그대로 옮긴다)
//    ① `openSync(…, 'wx')` 로 만든 쪽만 쥔다  ② 잠금 파일에 owner 토큰을 적는다
//    ③ 정해진 시간만 기다리고, 못 잡으면 **던지지 않고 실패를 돌려준다** (fail-closed)
//    ④ 풀 때는 **내 토큰일 때만** 지운다  ⑤ 살아 있는 잠금은 오래됐어도 빼앗지 않는다
// ─────────────────────────────────────────────────────────

export const QUARANTINE_LOCK_WAIT_MS = 10_000
const LOCK_POLL_MS = 20

export const quarantineLockPath = (path = QUARANTINE_PATH) => `${path}.lock`

/** 🔴 동기 대기 — 임계구역을 async 로 쪼개면 그 사이에 다른 프로세스가 끼어든다 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 잠금 파일의 주인이 **확실히 죽었는가.**
 *
 * 🔴 확실할 때만 `DEAD` 다. 내용을 못 읽거나(막 만들어져 아직 비었거나 깨졌거나),
 *    다른 호스트이거나, `kill(pid, 0)` 이 ESRCH 가 아니면 전부 `LIVE`/`UNKNOWN` —
 *    **빼앗지 않는다.** PID 가 재사용됐으면 살아 있는 것으로 보이므로 틀려도 안전한 쪽이다.
 *
 * @returns {{state:'LIVE'|'DEAD'|'UNKNOWN', owner:object|null, why:string}}
 */
export function inspectQuarantineLock(lock) {
  let owner
  try { owner = JSON.parse(readFileSync(lock, 'utf8')) }
  catch (e) {
    if (e?.code === 'ENOENT') return { state: 'UNKNOWN', owner: null, why: '잠금이 방금 풀렸다' }
    return { state: 'UNKNOWN', owner: null, why: `잠금 내용을 읽지 못했다: ${e?.message ?? e}` }
  }
  if (!owner || typeof owner.token !== 'string' || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    return { state: 'UNKNOWN', owner, why: '잠금 내용이 규약과 다르다' }
  }
  if (owner.host !== hostname()) return { state: 'UNKNOWN', owner, why: `다른 호스트의 잠금이다 (${owner.host})` }
  try { process.kill(owner.pid, 0); return { state: 'LIVE', owner, why: `pid ${owner.pid} 가 살아 있다` } }
  catch (e) {
    if (e?.code === 'ESRCH') return { state: 'DEAD', owner, why: `pid ${owner.pid} 가 없다` }
    return { state: 'LIVE', owner, why: `pid ${owner.pid} 확인 불가(${e?.code}) — 살아 있는 것으로 본다` }
  }
}

/** 내 토큰일 때만 지운다 — 🔴 남이 쥔 잠금은 절대 지우지 않는다 */
function releaseIfMine(lock, token) {
  try {
    const cur = JSON.parse(readFileSync(lock, 'utf8'))
    if (cur?.token === token) unlinkSync(lock)
  } catch { /* 이미 없거나 읽을 수 없다 — 건드리지 않는다 */ }
}

function createLock(lock) {
  const owner = { token: randomUUID(), pid: process.pid, host: hostname(), at: new Date().toISOString() }
  const fd = openSync(lock, 'wx', 0o600)
  try { writeSync(fd, JSON.stringify(owner)); fsyncSync(fd) }
  finally { closeSync(fd) }
  return owner
}

/**
 * 🔴 **죽은 주인의 잠금만 거둔다 — 그것도 거두는 사람을 한 명으로 줄인 뒤에.**
 *    둘이 동시에 "죽었다" 고 보고 각자 지우면, 먼저 지우고 새로 잡은 쪽의 **살아 있는**
 *    잠금을 늦은 쪽이 지운다. 그래서 거두기 자체를 `.reclaim` 잠금(wx) 안에서 하고,
 *    그 안에서 **같은 토큰·여전히 죽음**을 다시 확인한 뒤에만 지운다.
 *    `.reclaim` 이 남아 있으면(거두던 쪽이 급사) 기다리다 시간 초과로 끝난다 — 전송 금지.
 */
function reclaimDeadLock(lock, seenToken) {
  const rlock = `${lock}.reclaim`
  let mine
  try { mine = createLock(rlock) } catch { return false }
  try {
    const again = inspectQuarantineLock(lock)
    if (again.state !== 'DEAD' || again.owner?.token !== seenToken) return false
    unlinkSync(lock)
    return true
  } catch { return false }
  finally { releaseIfMine(rlock, mine.token) }
}

/**
 * 잠금을 잡고 `fn` 을 돌린다. **`fn` 은 동기여야 한다.**
 *
 * @returns {{ok:true, value:any}|{ok:false, code:string, why:string}}
 *   🔴 실패는 던지지 않고 돌려준다. 호출부가 `ok:false` 를 "적었다" 로 읽으면 안 된다.
 *   `fn` 이 던지면 잠금을 푼 뒤 그대로 던진다.
 */
export function withQuarantineLock(path, fn, { waitMs = QUARANTINE_LOCK_WAIT_MS } = {}) {
  const lock = quarantineLockPath(path)
  try { mkdirSync(dirname(path), { recursive: true }) }
  catch (e) { return { ok: false, code: 'QUARANTINE_LOCK_ERROR', why: `장부 폴더를 만들지 못했다: ${e.message}` } }
  const until = Date.now() + waitMs
  let owner = null
  let last = null
  for (;;) {
    try { owner = createLock(lock); break }
    catch (e) {
      if (e?.code !== 'EEXIST') {
        // 🔴 권한·디스크 같은 오류는 기다려도 풀리지 않는다 — 판정 불가, 전송 금지
        return { ok: false, code: 'QUARANTINE_LOCK_ERROR', why: `장부 잠금을 만들지 못했다: ${e?.message ?? e}` }
      }
      last = inspectQuarantineLock(lock)
      if (last.state === 'DEAD' && reclaimDeadLock(lock, last.owner.token)) continue
      if (Date.now() > until) {
        let age = null
        try { age = Math.round((Date.now() - statSync(lock).mtimeMs) / 1000) } catch { /* 방금 풀렸다 */ }
        return {
          ok: false, code: 'QUARANTINE_LOCK_TIMEOUT',
          why: `장부 잠금을 ${waitMs}ms 안에 잡지 못했다 (${last?.state}: ${last?.why}${age !== null ? ` · ${age}초째` : ''})`
            + ' — 🔴 살아 있는 잠금은 지우지 않는다. 전송하지 않는다.',
        }
      }
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return { ok: true, value: fn() }
  } finally {
    releaseIfMine(lock, owner.token)
  }
}

/** 격리에서 완전히 지운다 — 등록에 성공한 후보 */
export function clearEntry(store, slug) {
  const next = { ...store }
  delete next[slug]
  return next
}
