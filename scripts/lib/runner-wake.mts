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
 * 🔴 **켜는 곳은 하나다 — 정본 env**(`~/Library/Application Support/soransoran/env.local`)의 `SORAN_EVENT_WAKE=comment`.
 *    발행 러너 · 고아 표식 복구(`runner-recover`) · readiness 가 **같은 파일의 같은 키**를 `readEnvKeys` 로 읽는다.
 *    (2026-11-07) 옛 발행 러너는 `process.env`(runtime `.env.local`)를 읽어 복구기와 출처가 갈렸다 — 그래서 하나로 묶었다.
 * 🔴 **kill switch** — 같은 키를 `off` 로 바꾸거나 줄을 지운다. 미설정 · 빈 값 · 모르는 값은 `off` 다 — 표식도 kickstart 도 0.
 *    `all` 은 폐지했다(2026-11-07) — 이름과 달리 댓글만 열던 값이라 모르는 값(off)으로 읽는다. 켜는 값은 `comment` 하나다.
 *    공급 사건 깨움은 회차 실행시간 상한이 없어 자연 증명 슬롯과 충돌할 수 있으므로 열지 않는다. 공급은 정기 예약 회차만 돈다.
 */
import { execFileSync } from 'node:child_process'

import { requestFollowUp, type FollowUpRequest } from './runner-lease.mjs'
import { COMMENT_RUNNER_LABEL, commentLoopLockDir } from './persona-comment-runner-template'

export const EVENT_WAKE_ENV = 'SORAN_EVENT_WAKE'
export type EventWakeMode = 'off' | 'comment'
export type WakeTarget = 'comment' | 'supply'

/** 🔴 정본 env 값 → 모드. `comment` 만 켜진다 — 그 밖은 전부 off(fail-closed) */
export function eventWakeModeOf(env: Readonly<Record<string, string | undefined>>): { mode: EventWakeMode; note: string } {
  const raw = (env[EVENT_WAKE_ENV] ?? '').trim()
  if (raw === 'comment') return { mode: raw, note: `${EVENT_WAKE_ENV}=${raw}` }
  if (raw === '') return { mode: 'off', note: `${EVENT_WAKE_ENV} 미설정 → off` }
  if (raw === 'off') return { mode: 'off', note: `${EVENT_WAKE_ENV}=off` }
  return { mode: 'off', note: `${EVENT_WAKE_ENV} 모르는 값 → off` }
}

/** 🔴 댓글만 행동한다. 공급 사건 깨움은 실행시간 상한 계약이 생기기 전까지 닫힌다. */
export function wakeAllowed(mode: EventWakeMode, target: WakeTarget): boolean {
  return target === 'comment' && mode === 'comment'
}

/**
 * 🔴 **설치 상태 — readiness 가 읽는 한 줄** (2026-11-07). 관측(정본 env 읽기 · 댓글 러너 loaded)은 부르는 쪽이 해서 넘긴다.
 *    `ON` 은 정본 env 가 `comment` 이고 깨울 대상(댓글 러너)이 등록돼 있을 때뿐이다. 정본 env 를 못 읽으면 `UNREADABLE`.
 */
export type EventWakeInstall = { state: 'ON' | 'OFF' | 'TARGET_NOT_LOADED' | 'UNREADABLE'; mode: EventWakeMode; note: string }
export function judgeEventWakeInstall(i: {
  envReadable: boolean; env: Readonly<Record<string, string | undefined>>; commentRunnerLoaded: boolean
}): EventWakeInstall {
  if (!i.envReadable) return { state: 'UNREADABLE', mode: 'off', note: '정본 env 를 읽지 못했다 — 깨움은 off 로 돈다' }
  const m = eventWakeModeOf(i.env)
  if (m.mode === 'off') return { state: 'OFF', mode: 'off', note: `${m.note} — 첫 댓글은 정기 회차(20분)만 받는다` }
  if (!i.commentRunnerLoaded) return { state: 'TARGET_NOT_LOADED', mode: m.mode, note: `${m.note} · 댓글 러너가 등록돼 있지 않다 — kickstart 가 실패한다` }
  return { state: 'ON', mode: m.mode, note: `${m.note} · 댓글 러너 등록됨 — 공개 직후 깨움 1 + 정기 회차 fallback` }
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
  | { kind: 'SENT'; marker: FollowUpRequest; kick: 'OK' | 'FAILED'; detail: string }
  | { kind: 'ERROR'; why: string }

/**
 * 🔴 **깨움 하나 — 던지지 않는다.** `home` 은 시험이 잠금 디렉터리 자리를 고를 때만 준다.
 *    표식을 못 남겨도 정기 댓글 회차가 보완하므로 kickstart를 보낼 수 있다.
 */
export function wakeRunner(i: {
  target: WakeTarget; env: Readonly<Record<string, string | undefined>>; nowMs: number; home?: string
}): WakeOutcome {
  try {
    const m = eventWakeModeOf(i.env)
    if (m.mode === 'off') return { kind: 'OFF', why: m.note }
    if (!wakeAllowed(m.mode, i.target) || i.target !== 'comment') {
      return { kind: 'OFF', why: `${i.target} 사건 깨움 닫힘 — 정기 공급만 사용 · ${m.note}` }
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
      const detail = err.code ?? (err.status != null ? `exit ${err.status}` : err.signal ?? 'unknown')
      return { kind: 'SENT', marker, kick: 'FAILED', detail }
    }
  } catch (e) {
    return { kind: 'ERROR', why: e instanceof Error ? e.name : 'unknown' }
  }
}

/**
 * 🔴 **발행 러너의 깨움 문 — 최종 정합을 모두 통과했을 때만 열린다** (2026-10-12 C2 보정).
 *    commit 뒤라도 Queue/Post/ActivityLog 정합(`verifyOk`)이나 자동 발행 감사 무결성(`auditIntegrityOk`)이 실패한 회차는
 *    댓글을 재촉하지 않는다 — 사람이 볼 이상이 있는 회차다. 정기 회차는 원래 계약대로 따로 돈다.
 */
export function publishWakeGate(i: { verifyOk: boolean; auditIntegrityOk: boolean }): { ok: true } | { ok: false; why: string } {
  if (!i.verifyOk) return { ok: false, why: '발행 정합(Queue · Post · ActivityLog) 실패 — 깨우지 않는다' }
  if (!i.auditIntegrityOk) return { ok: false, why: '자동 발행 감사 무결성 실패 — 깨우지 않는다' }
  return { ok: true }
}

/** 🔴 사람이 읽는 한 줄 — 발행 결과와 섞이지 않게 "깨움" 이라고 먼저 적는다 */
export function describeWake(target: WakeTarget, o: WakeOutcome): string {
  switch (o.kind) {
    case 'OFF': return `깨움(${target}) 0 — ${o.why}`
    case 'ERROR': return `🟡 깨움(${target}) 실패(${o.why}) — 발행 결과와 무관 · 정기 회차가 받는다`
    case 'SENT': return `${o.kick === 'OK' ? '🔔' : '🟡'} 깨움(${target}) 표식 ${o.marker} · kickstart ${o.kick}${o.detail === '' ? '' : `(${o.detail})`}`
      + (o.kick === 'OK' && o.marker !== 'ERROR' ? '' : ' — 발행 결과와 무관 · 정기 회차 · 고아 표식 복구가 받는다')
  }
}
