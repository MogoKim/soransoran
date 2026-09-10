/**
 * 수집 회차 기록 **저장소** — 🔴 append-only JSONL. 정본 경로에 쓴다
 *
 * 🔴 판정은 `src/lib/collect-run-record.ts` 가 한다. 여기는 읽고 쓰기만 한다.
 * 🔴 worktree 밖에 둔다 — 배포가 트리를 갈아 끼워도 회차 증거가 사라지면 안 된다.
 * 🔴 **로그를 지우거나 자르지 않는다.** 통과시키려고 증거를 없애는 길을 두지 않는다.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CollectRunRecord } from '../../src/lib/collect-run-record'

export const RUN_RECORD_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'collect-runs',
)

/** `navercafe:remonterrace` → `navercafe-remonterrace.jsonl` */
export function runRecordPath(source: string): string {
  return join(RUN_RECORD_DIR, `${source.replace(/[^a-z0-9]+/gi, '-')}.jsonl`)
}

/**
 * 🔴 **성공 여부를 돌려준다** (2026-09-10 정정).
 *
 *    옛 판은 실패를 삼켰다. 그러면 증거를 못 남기는 회차가 외부 요청까지 가고,
 *    관제는 그 회차가 있었다는 사실조차 모른다 — 조용한 실패가 다시 생긴다.
 *    첫 기록이 실패하면 호출부가 요청 전에 멈춘다.
 */
export function appendRunRecord(rec: CollectRunRecord): boolean {
  try {
    mkdirSync(RUN_RECORD_DIR, { recursive: true, mode: 0o700 })
    appendFileSync(runRecordPath(rec.source), `${JSON.stringify(rec)}\n`, { encoding: 'utf-8', mode: 0o600 })
    return true
  } catch { return false }
}

/**
 * 🔴 **이미 본 글** — 회차 간 중복을 상세 요청 **전에** 제외하기 위한 목록.
 *
 *    collector 는 DB 를 import 하지 않는다(계약). 그래서 정본 기록과
 *    기존 thin 산출물에서 `sourceArticleId` 를 모은다.
 */
export function readSeenArticleIds(source: string, thinDirs: readonly string[]): Set<string> {
  const seen = new Set<string>()
  for (const dir of thinDirs) {
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    const want = source.replace('navercafe:', '')
    for (const n of names) {
      if (!n.includes('thin') || !n.includes(want) || !n.endsWith('.jsonl')) continue
      try {
        for (const line of readFileSync(join(dir, n), 'utf-8').split('\n')) {
          if (line.trim() === '') continue
          const j = JSON.parse(line) as { sourceArticleId?: unknown; id?: unknown }
          const id = typeof j.sourceArticleId === 'string' ? j.sourceArticleId
            : typeof j.id === 'string' ? j.id : null
          if (id !== null && id !== '') seen.add(id)
        }
      } catch { /* 깨진 파일은 건너뛴다 */ }
    }
  }
  return seen
}

/** 🔴 깨진 줄은 버린다 — 한 줄이 상해도 나머지 증거는 살아 있어야 한다 */
export function readRunRecords(source: string): CollectRunRecord[] {
  const p = runRecordPath(source)
  if (!existsSync(p)) return []
  const out: CollectRunRecord[] = []
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const j = JSON.parse(line) as CollectRunRecord
      if (typeof j.runId === 'string' && typeof j.status === 'string') out.push(j)
    } catch { /* 깨진 줄은 버린다 */ }
  }
  return out
}

/**
 * 🔴 **상세 조회 이력 원장** — worktree 밖 정본 (2026-09-10).
 *
 *    `readSeenArticleIds` 는 **남아 있는 thin 산출물**만 본다. 그런데
 *    `drop`·`hardExclude` 된 글은 thin 을 만들지 않는다 — 그래서 회차마다
 *    같은 글을 다시 열었다. 상세 요청은 쓰였는데 흔적은 없다.
 *
 *    조회가 **끝났다는 사실 자체**를 남긴다. 결과가 무엇이든.
 */
export const DETAIL_LEDGER_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'collect-detail',
)

export type DetailOutcome = 'kept' | 'dropped' | 'body_failed'
const DETAIL_OUTCOMES: readonly DetailOutcome[] = ['kept', 'dropped', 'body_failed']

export type DetailLedgerEntry = {
  articleId: string
  outcome: DetailOutcome
  at: string
  runId: string
  /** 본문 실패 재시도 횟수 — 🔴 무한 반복 상한을 둔다 */
  attempts: number
}

/** 🔴 본문 실패는 재시도 가능하되 이 횟수를 넘기면 더 열지 않는다 */
export const BODY_RETRY_MAX = 3

export function detailLedgerPath(source: string): string {
  return join(DETAIL_LEDGER_DIR, `${source.replace(/[^a-z0-9]+/gi, '-')}.jsonl`)
}

export type LedgerRead =
  | { ok: true; entries: Map<string, DetailLedgerEntry> }
  /** 🔴 못 읽었으면 "중복 없음" 으로 보정하지 않는다 — 상세 요청 전에 멈춘다 */
  | { ok: false; reason: string }

export function readDetailLedger(source: string): LedgerRead {
  return readLedgerAt(detailLedgerPath(source))
}

/** 🔴 경로로 직접 읽는다 — 판정은 하나다. fixture 가 임시 파일로 시험한다 */
export function readLedgerAt(p: string): LedgerRead {
  if (!existsSync(p)) return { ok: true, entries: new Map() }
  const entries = new Map<string, DetailLedgerEntry>()
  let text: string
  try { text = readFileSync(p, 'utf-8') } catch (e) {
    return { ok: false, reason: `원장을 읽지 못했다 — ${(e as Error).message}` }
  }
  let total = 0
  /**
   * 🔴 **한 줄이라도 손상되면 fail-closed** (2026-09-10 정정).
   *
   *    앞선 판은 "절반 넘게 깨졌을 때만" 막았다. 한 줄이 깨졌다는 것은
   *    **그 글을 이미 봤는지 모른다**는 뜻이고, 모르면 다시 열게 된다.
   *    비율로 봐줄 문제가 아니다.
   */
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    total += 1
    let j: Partial<DetailLedgerEntry>
    try { j = JSON.parse(line) as Partial<DetailLedgerEntry> } catch {
      return { ok: false, reason: `원장 ${total}번째 줄이 JSON 이 아니다 — 이미 본 글을 알 수 없다` }
    }
    // 🔴 타입과 범위를 전부 본다 — 한 자리라도 모르면 판정에 쓸 수 없다
    if (typeof j.articleId !== 'string' || j.articleId.trim() === '') {
      return { ok: false, reason: `원장 ${total}번째 줄의 articleId 가 없다` }
    }
    if (typeof j.outcome !== 'string' || !DETAIL_OUTCOMES.includes(j.outcome as DetailOutcome)) {
      return { ok: false, reason: `원장 ${total}번째 줄의 outcome 이 알 수 없는 값이다 (${String(j.outcome)})` }
    }
    if (typeof j.at !== 'string' || Number.isNaN(Date.parse(j.at))) {
      return { ok: false, reason: `원장 ${total}번째 줄의 at 이 시각이 아니다` }
    }
    if (typeof j.runId !== 'string' || j.runId.trim() === '') {
      return { ok: false, reason: `원장 ${total}번째 줄의 runId 가 없다` }
    }
    if (typeof j.attempts !== 'number' || !Number.isInteger(j.attempts)
      || j.attempts < 1 || j.attempts > 1_000) {
      return { ok: false, reason: `원장 ${total}번째 줄의 attempts 가 범위를 벗어났다 (${String(j.attempts)})` }
    }
    entries.set(j.articleId, {
      articleId: j.articleId,
      outcome: j.outcome as DetailOutcome,
      at: j.at,
      runId: j.runId,
      attempts: j.attempts,
    })
  }
  return { ok: true, entries }
}

export function appendDetailLedger(source: string, e: DetailLedgerEntry): boolean {
  try {
    mkdirSync(DETAIL_LEDGER_DIR, { recursive: true, mode: 0o700 })
    appendFileSync(detailLedgerPath(source), `${JSON.stringify(e)}\n`, { encoding: 'utf-8', mode: 0o600 })
    return true
  } catch { return false }
}
