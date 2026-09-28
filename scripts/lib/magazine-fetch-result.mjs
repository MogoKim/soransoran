/**
 * 회수 결과를 **프로세스 경계 너머로 사실대로** 넘긴다.
 *
 * 🔴 **왜 파일인가** (2026-09-28 · Codex 재검토 P0-2).
 *    회수는 자식 프로세스(`magazine-webui-runner`)가 한다. 앞판은 부모가 자식의
 *    **사람용 출력**을 정규식으로 긁었다 — `/전송\s*1건/`.
 *    출력 문구를 한 글자만 바꿔도 부모는 "안 보냈다" 로 읽고,
 *    그러면 **같은 brief 를 다시 보낸다.** 같은 대화에 요청이 두 번 쌓인다.
 *
 *    사람용 출력은 사람이 읽는 것이고, 기계는 기계용 값을 읽어야 한다.
 *    자식이 JSON 파일에 `{reason, stage, sent, errorName, errorDetail}` 을 적고
 *    부모가 그 파일을 읽는다. 문구가 바뀌어도 값은 그대로다.
 *
 * 🔴 **`sent` 는 되돌릴 수 없는 사실이다.** 보냈는지 여부를 잃으면 안전한 기본값이
 *    없다 — `false` 로 가정하면 중복 전송, `true` 로 가정하면 멀쩡한 재시도를 막는다.
 *    그래서 자식은 **모든 종료 경로에서** 적는다. 한 곳이라도 빠지면 그 경로는
 *    부모에게 아무 말도 하지 않은 것이고, 부모는 알 방법이 없다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizeSent, classifyFailure } from './magazine-failure-kind.mjs'
import { readRunTargets } from './magazine-run-targets.mjs'

export const RESULT_SCHEMA_VERSION = 1

/** 일괄 회수 결과의 표준 자리 — 저장소 밖이다 (운영 파일 수동 편집 금지 규칙) */
export const FETCH_RESULT_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'magazine-fetch-results',
)

/**
 * 🔴 **날짜 계산이 한 곳이다.** 회수 결과 파일은 날짜로 찾는다 — 쓰는 쪽과 읽는 쪽이
 *    각자 계산하면 자정 무렵 하루가 어긋나고, 읽는 쪽은 "결과가 없다" 를 본다.
 */
export function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function fetchResultPath(date, dir = FETCH_RESULT_DIR) {
  return join(dir, `${date}.json`)
}

/**
 * 🔴 **필드를 고정한다.** 호출부마다 다른 모양을 넘기면 부모는 다시 추측해야 한다.
 *    없는 값은 `null` 로 **있게** 적는다 — 키가 없는 것과 값이 없는 것은 다르다.
 */
export function normalizeFetchResult(r = {}) {
  return {
    slug: r.slug ?? null,
    status: r.status ?? (r.ok === true ? 'ok' : 'failed'),
    reason: r.reason ?? null,
    stage: r.stage ?? null,
    // 🔴 세 값을 그대로 적는다. `Boolean()` 은 모름(null)을 "안 보냄" 으로 바꾼다.
    sent: normalizeSent(r.sent),
    errorName: r.errorName ?? null,
    errorDetail: r.errorDetail ?? null,
    /**
     * 🔴 **보낸(보내려던) 글자의 지문과 앞선 전송 기록** (2026-09-28 · 재생성 HOLD).
     *    여기서 버리면 부모는 "왜 멈췄나 · 어느 글자 때문인가" 를 다시 추측해야 한다.
     *    HOLD 행의 `sent` 는 **이번 실행**의 값(false)이고, 앞선 모름은 `prior.sent` 다.
     */
    messageFingerprint: r.messageFingerprint ?? null,
    // 🔴 재생성 시도 표식 — 부모가 "자기 패킷을 읽은 자식" 인지 대조한다
    attemptId: r.attemptId ?? null,
    prior: r.prior
      ? {
        sent: normalizeSent(r.prior.sent), kind: r.prior.kind ?? null, reason: r.prior.reason ?? null,
        stage: r.prior.stage ?? null, date: r.prior.date ?? null, at: r.prior.at ?? null,
        messageFingerprint: r.prior.messageFingerprint ?? null,
      }
      : null,
  }
}

/**
 * 원자적으로 적고 **다시 읽어 확인한다.**
 * 반만 적힌 JSON 을 부모가 읽으면 파싱 실패 → 사실을 잃는다.
 */
export function writeFetchResults(path, payload) {
  const body = {
    version: RESULT_SCHEMA_VERSION,
    date: payload.date ?? null,
    // 🔴 회차 지문 — 같은 날 다시 돌면 목록이 달라진다. 날짜만으로는 못 가린다.
    runId: payload.runId ?? null,
    mode: payload.mode ?? null,
    sentTotal: payload.sentTotal ?? 0,
    fatal: payload.fatal ?? null,
    results: (payload.results ?? []).map(normalizeFetchResult),
    writtenAt: new Date().toISOString(),
  }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  const text = JSON.stringify(body, null, 2)
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
  // 🔴 읽어서 확인한다 — 적었다고 믿지 않는다
  const back = JSON.parse(readFileSync(path, 'utf8'))
  if (back.results.length !== body.results.length) {
    throw new Error(`FETCH_RESULT_WRITE_MISMATCH: ${back.results.length} ≠ ${body.results.length}`)
  }
  return body
}

export function readFetchResults(path, { expectDate = null, expectRunId = null } = {}) {
  if (!existsSync(path)) return { ok: false, why: '회수 결과 파일이 없다' }
  let body
  try {
    body = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { ok: false, why: `회수 결과 파싱 실패: ${e.message}` }
  }
  if (body.version !== RESULT_SCHEMA_VERSION) {
    return { ok: false, why: `모르는 스키마 판 ${body.version}` }
  }
  /**
   * 🔴 **신원이 맞아야 이번 회차 결과다.** 날짜 칸이 비어 있는 것도 불일치로 본다 —
   *    "언제 것인지 모르는 기록" 으로 후보를 멈추면 그 멈춤을 풀 방법이 없다.
   */
  if (expectDate && body.date !== expectDate) {
    return { ok: false, stale: true, body, why: `다른 날짜의 결과다 (${body.date ?? '날짜 없음'} ≠ ${expectDate})` }
  }
  if (expectRunId && body.runId !== expectRunId) {
    return { ok: false, stale: true, body, why: `다른 회차의 결과다 (${body.runId ?? '지문 없음'} ≠ ${expectRunId})` }
  }
  return { ok: true, body }
}

/**
 * 🔴 **다시 보내면 안 되는 후보** — 이전 결과가 "보냈는데 모른다" 인 것들.
 *
 *    2026-09-28 이후 구조: `sent=true` 뒤 `response_timeout` 은 **실패가 아니라 모름**이다.
 *    그 글의 brief 는 이미 ChatGPT 대화에 올라가 있다. 다시 보내면 같은 요청이 두 번 쌓인다.
 *
 *    🔴 **그 후보만 멈춘다.** 한 건이 모름이라고 회차 전체를 멈추지 않는다 —
 *       그렇게 하면 한 글의 사고가 그날 공급 전부를 없앤다.
 *
 * @returns {Map<string, {reason:string|null, stage:string|null, sent:boolean|null, why:string}>}
 */
export function deliveryHold(body) {
  const held = new Map()
  for (const r of body?.results ?? []) {
    if (!r.slug || r.slug === '-') continue
    if (r.status === 'ok') continue
    const k = classifyFailure({
      code: r.reason, stage: r.stage,
      message: [r.errorName, r.errorDetail].filter(Boolean).join(' · '),
      sent: r.sent,
    })
    if (k.kind === 'DELIVERY_UNCERTAIN') held.set(r.slug, { ...r, why: k.why })
  }
  return held
}

/**
 * 회차의 전송 상태를 **한 자리에서** 읽는다 — 회수 경로와 등록 경로가 같은 값을 본다.
 *
 * 🔴 낡은 파일을 이번 회차 결과로 읽지 않는다. 날짜와 회차 지문이 **둘 다** 맞아야 한다.
 *    안 맞으면 "기록 없음" 으로 둔다 — 낡은 기록으로 영구 HOLD 를 만드는 쪽이 더 나쁘다.
 *    (공급이 마르는 방향으로 틀리지 않는다. 대신 안 맞았다는 사실을 말한다.)
 */
export function readRunFetchState({ draftsDir, date, resultPath = null, dir = FETCH_RESULT_DIR }) {
  const r = readRunTargets({ draftsDir, date })
  const runId = r.ok ? r.runId : null
  const path = resultPath ?? fetchResultPath(date, dir)
  const prior = readFetchResults(path, { expectDate: date, expectRunId: runId })
  return { runId, path, prior, hold: prior.ok ? deliveryHold(prior.body) : new Map() }
}

/** 한 slug 의 결과 — 없으면 `null` (모름이지 성공이 아니다) */
export function fetchResultFor(body, slug) {
  return (body?.results ?? []).find((r) => r.slug === slug) ?? null
}

export function removeFetchResults(path) {
  try { if (existsSync(path)) unlinkSync(path) } catch { /* 지우기 실패는 회차를 막지 않는다 */ }
}
