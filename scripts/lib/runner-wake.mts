/**
 * 🔴 **사건 깨움 — 표식 하나 + launchd kickstart 하나** (2026-10-12 Batch C2)
 *
 *   발행 트랜잭션 commit 뒤 → wakeRunner({ target: 'comment' })
 *     ① 대상 러너의 잠금 디렉터리에 follow-up 표식(`wx` · trigger=event)을 남긴다 — 이미 있으면 합쳐진다
 *     ② `launchctl kickstart gui/<uid>/<label>` (`-k` 없음) — 러너가 이미 돌면 launchd 가 아무것도 하지 않는다
 *   러너(`leaseEntry`)는 시작할 때 · 회차가 끝날 때 표식을 거둔다 — 겹친 깨움은 follow-up 한 번으로 합쳐진다(상한 1).
 *
 * 🔴 **고정 시계를 없애지 않는다.** 정기 댓글 회차(launchd 슬롯)는 그대로 돈다. 이 깨움은 공개 직후 한 번 더 물으러 가는 보조 경로다.
 *    같은 진입점 · 같은 커널 lease · 같은 하루 장부 · 같은 멱등(글당 1건 · 조건부 UPDATE)을 지난다 — 회차 종류로 갈리는 길이 없다.
 *
 * 🔴 **failure-open** — 이 함수는 던지지 않는다. 표식 · kickstart 가 실패해도 발행 결과(이미 commit 됐다) · 종료 코드는 바뀌지 않는다.
 *    놓친 깨움은 정기 회차(≤ 20분)와 `runner-recover` 의 고아 표식 복구(표식당 1회)가 받는다.
 *
 * 🔴 **kill switch** — `SORAN_EVENT_WAKE=off|comment|all` (정본 env). 미설정 · 빈 값 · 모르는 값은 `off` 다 — 표식도 kickstart 도 0.
 *    C2 는 `comment` 까지만 행동한다. `all` 이어도 공급 깨움은 C3 전까지 행동하지 않는다(`NOT_IMPLEMENTED`).
 */
import { execFileSync } from 'node:child_process'

import { requestFollowUp, type FollowUpRequest } from './runner-lease.mjs'
import { COMMENT_RUNNER_LABEL, commentLoopLockDir } from './persona-comment-runner-template'

export const EVENT_WAKE_ENV = 'SORAN_EVENT_WAKE'
export type EventWakeMode = 'off' | 'comment' | 'all'
export type WakeTarget = 'comment' | 'supply'

/** 🔴 env → 모드. `comment` · `all` 만 켜진다 — 그 밖은 전부 off(fail-closed) */
export function eventWakeModeOf(env: Readonly<Record<string, string | undefined>>): { mode: EventWakeMode; note: string } {
  const raw = (env[EVENT_WAKE_ENV] ?? '').trim()
  if (raw === 'comment' || raw === 'all') return { mode: raw, note: `${EVENT_WAKE_ENV}=${raw}` }
  if (raw === '') return { mode: 'off', note: `${EVENT_WAKE_ENV} 미설정 → off` }
  if (raw === 'off') return { mode: 'off', note: `${EVENT_WAKE_ENV}=off` }
  return { mode: 'off', note: `${EVENT_WAKE_ENV} 모르는 값 → off` }
}

/** 🔴 C2: 댓글만 행동한다. 공급 깨움(수집 완료 → 공급)은 C3 — `all` 이어도 false */
export function wakeAllowed(mode: EventWakeMode, target: WakeTarget): boolean {
  return target === 'comment' && (mode === 'comment' || mode === 'all')
}

/** 🔴 깨울 수 있는 대상 — label 과 잠금 디렉터리(follow-up 표식 자리)는 러너 정본에서 받는다 */
export const WAKE_TARGETS: Readonly<Record<'comment', { label: string; lockDir: (home?: string) => string }>> = {
  comment: { label: COMMENT_RUNNER_LABEL, lockDir: commentLoopLockDir },
}

export const LAUNCHCTL_PATH = '/bin/launchctl'
/** 🔴 kickstart 가 매달려도 발행 러너를 붙잡지 않는다 */
export const KICKSTART_TIMEOUT_MS = 5_000

/**
 * 🔴 **시험 전용 launchctl** — 가짜 provider 훅(`fake-provider-hook.mjs` · `NODE_OPTIONS=--import` 로만 들어간다)이
 *    `FAKE_LAUNCHCTL` 을 받아 전역 표식에 건 경로만 쓴다. 운영 경로는 env 를 보지 않고 언제나 `/bin/launchctl` 이다.
 *    시험이 운영 launchd job 을 깨우지 않게 하는 자리다.
 */
export const FAKE_LAUNCHCTL_MARK: unique symbol = Symbol.for('soransoran.test.fake-launchctl')
export function launchctlPath(): string {
  const v = (globalThis as unknown as Record<symbol, unknown>)[FAKE_LAUNCHCTL_MARK]
  return typeof v === 'string' && v !== '' ? v : LAUNCHCTL_PATH
}

export type WakeOutcome =
  | { kind: 'OFF'; why: string }
  | { kind: 'NOT_IMPLEMENTED'; why: string }
  | { kind: 'SENT'; marker: FollowUpRequest; kick: 'OK' | 'FAILED'; detail: string }
  | { kind: 'ERROR'; why: string }

/**
 * 🔴 **깨움 하나 — 던지지 않는다.** `home` 은 시험이 잠금 디렉터리 자리를 고를 때만 준다.
 *    표식을 못 남겨도(러너가 한 번도 돈 적 없어 디렉터리가 없다 등) kickstart 는 보낸다 — launchd 가 정기 회차와 같은 길로 띄운다.
 */
export function wakeRunner(i: {
  target: WakeTarget; env: Readonly<Record<string, string | undefined>>; nowMs: number; home?: string
}): WakeOutcome {
  try {
    const m = eventWakeModeOf(i.env)
    if (m.mode === 'off') return { kind: 'OFF', why: m.note }
    if (!wakeAllowed(m.mode, i.target) || i.target !== 'comment') {
      return { kind: 'NOT_IMPLEMENTED', why: `${i.target} 깨움은 아직 없다(C3) · ${m.note}` }
    }
    const t = WAKE_TARGETS.comment
    const marker = requestFollowUp(t.lockDir(i.home), i.nowMs, 'event')
    const uid = process.getuid?.()
    if (uid === undefined) return { kind: 'SENT', marker, kick: 'FAILED', detail: 'uid 를 모른다 — kickstart 하지 않았다' }
    try {
      execFileSync(launchctlPath(), ['kickstart', `gui/${uid}/${t.label}`], { stdio: 'ignore', timeout: KICKSTART_TIMEOUT_MS })
      return { kind: 'SENT', marker, kick: 'OK', detail: '' }
    } catch (e) {
      const err = e as { code?: string; status?: number | null; signal?: string | null }
      return { kind: 'SENT', marker, kick: 'FAILED', detail: err.code ?? (err.status != null ? `exit ${err.status}` : err.signal ?? 'unknown') }
    }
  } catch (e) {
    return { kind: 'ERROR', why: e instanceof Error ? e.name : 'unknown' }
  }
}

/** 🔴 사람이 읽는 한 줄 — 발행 결과와 섞이지 않게 "깨움" 이라고 먼저 적는다 */
export function describeWake(target: WakeTarget, o: WakeOutcome): string {
  switch (o.kind) {
    case 'OFF': return `깨움(${target}) 0 — ${o.why}`
    case 'NOT_IMPLEMENTED': return `깨움(${target}) 0 — ${o.why}`
    case 'ERROR': return `🟡 깨움(${target}) 실패(${o.why}) — 발행 결과와 무관 · 정기 회차가 받는다`
    case 'SENT': return `${o.kick === 'OK' ? '🔔' : '🟡'} 깨움(${target}) 표식 ${o.marker} · kickstart ${o.kick}${o.detail === '' ? '' : `(${o.detail})`}`
      + (o.kick === 'OK' && o.marker !== 'ERROR' ? '' : ' — 발행 결과와 무관 · 정기 회차 · 고아 표식 복구가 받는다')
  }
}
