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
    // 🔴 `Boolean()` 으로 굳힌다. `undefined` 를 그대로 두면 JSON 에서 키가 사라진다.
    sent: Boolean(r.sent),
    errorName: r.errorName ?? null,
    errorDetail: r.errorDetail ?? null,
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

export function readFetchResults(path) {
  if (!existsSync(path)) return { ok: false, why: '회수 결과 파일이 없다' }
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'))
    if (body.version !== RESULT_SCHEMA_VERSION) {
      return { ok: false, why: `모르는 스키마 판 ${body.version}` }
    }
    return { ok: true, body }
  } catch (e) {
    return { ok: false, why: `회수 결과 파싱 실패: ${e.message}` }
  }
}

/** 한 slug 의 결과 — 없으면 `null` (모름이지 성공이 아니다) */
export function fetchResultFor(body, slug) {
  return (body?.results ?? []).find((r) => r.slug === slug) ?? null
}

export function removeFetchResults(path) {
  try { if (existsSync(path)) unlinkSync(path) } catch { /* 지우기 실패는 회차를 막지 않는다 */ }
}
