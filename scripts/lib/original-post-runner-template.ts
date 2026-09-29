/**
 * 발행 러너 **단기 임시 bridge 트리거 템플릿** — 🔴 문자열만 만든다. **등록하지 않는다**
 *
 * 🔴 **이것은 최종 운영 스케줄러가 아니다.**
 *
 *    launchd 는 **이 맥이 깨어 있을 때만** 동작한다. 그것을 정시 보장으로 읽으면 안 된다 —
 *    아래 세 가지가 전부 사실이다.
 *
 *      ① **맥이 꺼져 있으면 아무것도 돌지 않는다.** 놓친 회차는 부팅 시에도 복구되지 않는다
 *         (`RunAtLoad` 를 false 로 두므로 부팅 직후 한 번 도는 것도 없다).
 *      ② **절전(sleep) 중에 지나간 회차는 wake 때 한 번으로 합쳐진다.**
 *         `man launchd.plist` 의 `StartCalendarInterval` 계약이다 — 여러 구간이 지나가도
 *         wake 시 **단일 이벤트**로 실행된다. 그리고 한 회차는 `PER_RUN_MAX=1` 건만 내므로
 *         **절전 3시간 = 발행 1건**이다. 밀린 3건이 한꺼번에 나가지 않는다(그게 맞는 동작이다).
 *      ③ 노트북이면 뚜껑을 닫는 순간 ②가 된다.
 *
 *    🔴 그래서 **"Mac OFF·sleep 상태에서 d10 10건을 보장한다" 고 쓰지 않는다.** 보장하지 못한다.
 *       launchd 가 하는 일은 **맥이 깨어 있는 동안 정시성을 주는 것** 하나이고,
 *       그 조건이 깨지면 GitHub 예약(늦지만 서버에서 도는 것)이 남는다.
 *
 * 🔴 **단기 임시 bridge 인 이유.** 지금 필요한 것은 "예약 시각 근처에 나가게 하는 것" 이고,
 *    그것을 새 vendor·요금제 없이 **오늘** 할 수 있는 유일한 수단이 이것이다.
 *    수집(`supply-collect-*`)·처리(`supply-process`)가 이미 같은 트리거 위에 있다.
 *    맥 전원과 무관한 정시성이 필요해지면 그때는 **다른 것으로 바꾼다** — 이 파일이 정답이 아니다.
 *
 * 🔴 **왜 catch-up 이 먼저 필요했나.** 트리거가 둘이 되면 겹친다. 겹쳐도 중복이 0 이어야 한다 —
 *      ① `judgeCatchUp` 이 **도래한 슬롯 − 오늘 발행 수**로 판정한다(같은 슬롯 두 번 → 0)
 *      ② `publishOriginalPostTx` 가 Serializable 안에서 오늘 발행 수를 다시 센다
 *    🔴 ①②는 **코드·static 검증까지** 마쳤다. 실제 동시 DB 부하 검증은 하지 않았다(§ PR 본문).
 *
 * 🔴 **이 파일은 파일을 쓰지 않는다.** 등록은 되돌리기 어려운 쪽이라 별도 승인으로 남긴다 —
 *    `~/Library/LaunchAgents` 에 plist 를 두면 로그인·재부팅 때 launchd 가 알아서 올린다.
 *    실제로 은퇴시킨 job 2개가 그렇게 되살아나 개발 작업트리를 가리켰다(2026-09-09).
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { allStageSlots } from '../../src/lib/scale-workflow-render'
import {
  slotLabel, resolveRuntimeStage, stageRank, RUNTIME_STAGES, CAPACITY_ENV, RELEASE_ENV, profileOf,
  type RuntimeStage, type Slot,
} from '../../src/lib/scale-profile'
import { PUBLISH_WINDOW_END_MINUTE, PUBLISH_WINDOW_START_MINUTE } from '../../src/lib/publish-slot-catchup'
import { releaseStageCeiling } from '../../src/lib/scale-runtime'
import {
  windowAuthorization, canaryAuthorization,
  WINDOW_STAGE_ENV, WINDOW_FROM_ENV, WINDOW_UNTIL_ENV, CANARY_STAGE_ENV, CANARY_DATE_ENV,
} from '../../src/lib/release-canary'

/**
 * 🔴 **PATH 정본은 `launchd-template-check.mts` 의 `PATH_VALUE` 하나다.**
 *    예약 job 5개의 plist 템플릿이 쓰는 값과 **같은 형태**여야 한다 —
 *    두 벌이면 한쪽만 고쳐지고, 고쳐지지 않은 쪽이 밤에 죽는다.
 */
export const RUNNER_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * 🔴 **launchd 가 줄 PATH.** 앞에 node 디렉터리, 뒤에 시스템 기본.
 *
 * 🔴 **왜 필요한가** (2026-09-15 실측 — 이 러너에서 재발).
 *    launchd 기본 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라 nvm 의 node 가 없다.
 *    `npx` 는 절대경로로 불러도 shebang 이 `#!/usr/bin/env node` 라
 *    **프로세스가 뜨기도 전에** `env: node: No such file or directory` 로 죽는다.
 *    실측: 08:10 · 09:30 두 슬롯 모두 **exit 127** · stdout 0 bytes · 발행 0건.
 *
 *    예약 job 5개의 템플릿은 이 값을 이미 담고 있었다. **이 러너만 빠져 있었다** —
 *    그 러너는 템플릿이 아니라 이 파일이 문자열로 만들기 때문이다.
 */
export function runnerPathValue(nodeBinDir: string): string {
  return `${nodeBinDir}:${RUNNER_SYSTEM_PATH}`
}

export const PUBLISH_RUNNER_LABEL = 'com.soransoran.original-post-runner'

/** 🔴 두 트리거 preflight 가 GitHub Variables 를 읽는 대상 저장소 — cwd 의 git remote 에 기대지 않는다 */
export const PUBLISH_REPO = 'MogoKim/soransoran'

/**
 * 🔴 **local 설정의 정본은 이 파일 하나다** (2026-09-14 정정).
 *
 *    앞선 판은 `loadEnvLocal()` → `process.cwd()/.env.local` → `process.env` 로 읽었다.
 *    그 경로는 **실행 위치에 따라 답이 달라진다** — PR 작업트리에는 `.env.local` 이 없으므로
 *    preflight 가 `local d1/d1` 로 읽고 **exit 0(거짓 통과)** 를 냈다.
 *    실제 정본은 `capacity=d3 · release=d1` 이었다(실측).
 *
 *    "어디서 실행하든 같은 답" 이어야 등록 게이트로 쓸 수 있다. 그래서 절대 경로 하나만 본다.
 */
export const CANONICAL_ENV_PATH = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'env.local',
)

/** 🔴 정본에서 읽는 키는 **이 둘뿐**이다. 다른 값은 메모리에도 올리지 않는다 */
export const CANONICAL_STAGE_KEYS: readonly string[] = [CAPACITY_ENV, RELEASE_ENV]


/** 🔴 러너는 runtime worktree 에서 돈다. 개발 작업트리를 가리키면 격리가 깨진다 */
export const PUBLISH_RUNNER_SCRIPT = 'scripts/original-post-auto-publish.mts'
export const STAGE_CONSUMER_SCRIPT = 'scripts/stage-consume-exec.mts'

/**
 * 🔴 **launchd 가 넘기는 인자.**
 *    `--trigger=local` 이 정본이다 — 예약 문자열이 없어도 **시각 자체가 근거**인 트리거라는 뜻이다.
 *    `--limit=1` 은 그대로 둔다. 한 회차가 여러 건을 쏟지 않는 계약은 트리거가 바뀌어도 같다.
 */
export const PUBLISH_RUNNER_ARGS: readonly string[] = ['--apply', '--limit=1', '--trigger=local']

/**
 * 🔴 **슬롯은 손으로 적지 않는다.** 모든 단계 슬롯의 합집합을 그대로 쓴다 —
 *    `allStageSlots()` 는 워크플로우 cron 이 쓰는 것과 **같은 함수**다.
 *    단계가 바뀌어도 plist 를 고칠 일이 없고, 어느 단계 것을 낼지는 러너가 정한다.
 *
 * 🔴 launchd 의 `StartCalendarInterval` 은 **로컬 시각**이다. 운영 맥은 KST 이므로
 *    슬롯 시각을 그대로 쓴다 — UTC 로 바꾸지 않는다(그것이 GitHub cron 쪽 계약이다).
 */
export function publishRunnerSlots(): Slot[] {
  return allStageSlots()
}

/** 🔴 모든 슬롯이 운영 창 안인가 — 창 밖 슬롯은 catch-up 이 버리므로 예약해도 헛돈다 */
export function verifyRunnerSlotsInWindow(slots: readonly Slot[]): string[] {
  const out: string[] = []
  for (const s of slots) {
    const m = s.hour * 60 + s.minute
    if (m < PUBLISH_WINDOW_START_MINUTE || m > PUBLISH_WINDOW_END_MINUTE) {
      out.push(`${slotLabel(s)} 가 운영 창 밖이다 — catch-up 이 버린다`)
    }
  }
  return out
}

export type RunnerPlistInput = {
  /** runtime worktree 절대 경로 */
  runtimeRoot: string
  /** npx 절대 경로 */
  npxPath: string
  logDir: string
  /**
   * 🔴 **지금 돌고 있는 node 의 bin 디렉터리** — `dirname(process.execPath)`.
   *    🔴 버전 문자열을 박지 않는다. nvm 을 올리면 그 순간 예약 실행이 죽는다.
   */
  nodeBinDir: string
}

/**
 * 🔴 **plist 뼈대는 하나다** (2026-09-26 heartbeat 후보). 정시판·heartbeat 판이 다른 것은
 *    **인자와 깨우는 시각** 둘뿐이다 — label · PATH · WorkingDirectory · 로그 · RunAtLoad 는 같다.
 *    뼈대를 두 벌 두면 PATH 를 한쪽만 고치는 2026-09-15 사고가 다시 난다.
 */
function renderRunnerPlistWith(input: RunnerPlistInput, runArgs: readonly string[], wakes: readonly Slot[]): string {
  const args = [
    `        <string>${input.npxPath}</string>`,
    '        <string>tsx</string>',
    `        <string>${input.runtimeRoot}/${STAGE_CONSUMER_SCRIPT}</string>`,
    '        <string>--by=publish</string>',
    '        <string>--</string>',
    `        <string>${input.npxPath}</string>`,
    '        <string>tsx</string>',
    `        <string>${input.runtimeRoot}/${PUBLISH_RUNNER_SCRIPT}</string>`,
    ...runArgs.map((a) => `        <string>${a}</string>`),
  ].join('\n')
  const slots = wakes.map((s) =>
    `        <dict><key>Hour</key><integer>${s.hour}</integer>`
    + `<key>Minute</key><integer>${s.minute}</integer></dict>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${PUBLISH_RUNNER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${runnerPathValue(input.nodeBinDir)}</string>
    </dict>
    <key>WorkingDirectory</key><string>${input.runtimeRoot}</string>
    <key>StartCalendarInterval</key>
    <array>
${slots}
    </array>
    <key>StandardOutPath</key><string>${input.logDir}/original-post-runner.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/original-post-runner-error.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
`
}

/**
 * 🔴 **정시판 — 지금 설치된 기본값이자 heartbeat 의 rollback 대상이다.**
 *    출력은 heartbeat 도입 전과 **바이트 단위로 같다**(검사가 설치본과 대조한다).
 */
export function renderPublishRunnerPlist(input: RunnerPlistInput): string {
  return renderRunnerPlistWith(input, PUBLISH_RUNNER_ARGS, publishRunnerSlots())
}

// ─────────────────────────────────────────────────────────
// 🔴 heartbeat 후보 (2026-09-26) — **설치하지 않는다. 명시적으로 고를 때만 렌더한다**
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **러너 트리거 모드.** `fixed` 가 지금 설치된 기본값이고 rollback 이다.
 *    `heartbeat` 는 후보다 — 이 PR 은 문자열을 만들 뿐 등록하지 않는다.
 */
export type RunnerTriggerMode = 'fixed' | 'heartbeat'
export const DEFAULT_RUNNER_TRIGGER_MODE: RunnerTriggerMode = 'fixed'

/**
 * 🔴 **깨우는 간격(분).** 이 값은 "몇 건 낼까" 와 무관하다 — 깨울 뿐이다.
 *    낼지·몇 건인지는 발행 트랜잭션이 **도래 슬롯 − 오늘 발행 수**(기존 catch-up 계약)로 정한다.
 *    한 번 깨우면 `--limit=1` · `PER_RUN_MAX=1` 이라 최대 1건이다.
 */
export const HEARTBEAT_INTERVAL_MINUTES = 10

/**
 * 🔴 **heartbeat 는 이 인자 하나만 더한다.** `--apply --limit=1 --trigger=local` 은 그대로다 —
 *    트랜잭션은 트리거 종류와 무관하게 `local` 계약(시각이 근거)으로 슬롯을 다시 센다.
 */
export const HEARTBEAT_FLAG = '--heartbeat'
export const PUBLISH_HEARTBEAT_ARGS: readonly string[] = [...PUBLISH_RUNNER_ARGS, HEARTBEAT_FLAG]

/**
 * 🔴 **깨우는 시각 — `StartInterval` 이 아니라 달력 항목이다.**
 *
 *    · `StartInterval=600` 은 위상이 **load 한 순간**에 묶인다. 16:03 에 올리면 09:33 에 깬다 —
 *      09:30 슬롯이 최대 10분 늦는다. 달력 항목은 슬롯 분(`:00 :10 … :50`)에 정확히 깬다.
 *    · 운영 창(08:00~22:00) 밖에는 **깨우지 않는다.** 밤에 144번 DB 에 붙을 이유가 없다.
 *    · 절전 중 지나간 항목은 wake 때 **1회로 합쳐진다**(man launchd.plist) — 그 1회는 1건만 내고,
 *      나머지 밀린 것은 다음 10분 틱들이 하나씩 메운다. 같은 KST 날짜 · 운영 창 안에서만이다.
 *
 * 🔴 숫자를 새로 만들지 않는다 — 창은 catch-up 정본(`PUBLISH_WINDOW_*`)에서 온다.
 */
export function heartbeatWakeTimes(): Slot[] {
  const out: Slot[] = []
  for (let m = PUBLISH_WINDOW_START_MINUTE; m <= PUBLISH_WINDOW_END_MINUTE; m += HEARTBEAT_INTERVAL_MINUTES) {
    out.push({ hour: Math.floor(m / 60), minute: m % 60, count: 0 })
  }
  return out
}

/**
 * 🔴 **heartbeat 격자가 정시판을 빠짐없이 덮는가** — 순수 판정.
 *    슬롯 하나라도 격자에 없으면 그 슬롯은 다음 틱까지 늦는다. 창 밖 틱은 트랜잭션이 버린다.
 */
export function verifyHeartbeatGrid(wakes: readonly Slot[]): string[] {
  const out: string[] = []
  const minutes = wakes.map((s) => s.hour * 60 + s.minute)
  for (let i = 1; i < minutes.length; i += 1) {
    if (minutes[i]! - minutes[i - 1]! !== HEARTBEAT_INTERVAL_MINUTES) {
      out.push(`${slotLabel(wakes[i - 1]!)} → ${slotLabel(wakes[i]!)} 간격이 ${HEARTBEAT_INTERVAL_MINUTES}분이 아니다`)
    }
  }
  for (const s of publishRunnerSlots()) {
    if (!minutes.includes(s.hour * 60 + s.minute)) out.push(`🔴 슬롯 ${slotLabel(s)} 가 heartbeat 격자에 없다 — 그 슬롯이 늦는다`)
  }
  out.push(...verifyRunnerSlotsInWindow(wakes))
  return out
}

/**
 * 🔴 **heartbeat 판 plist** — label 은 정시판과 **같다.** 둘이 동시에 등록되는 길을 없앤다 —
 *    설치는 교체(bootout → bootstrap)이고 rollback 은 정시판을 같은 자리에 다시 까는 것이다.
 */
export function renderPublishHeartbeatPlist(input: RunnerPlistInput): string {
  return renderRunnerPlistWith(input, PUBLISH_HEARTBEAT_ARGS, heartbeatWakeTimes())
}

/** 🔴 모드를 **명시해야** heartbeat 가 나온다. 모르는 값은 기본(정시판)이 아니라 오류다 */
export function renderRunnerPlistFor(mode: RunnerTriggerMode, input: RunnerPlistInput): string {
  if (mode === 'heartbeat') return renderPublishHeartbeatPlist(input)
  if (mode === 'fixed') return renderPublishRunnerPlist(input)
  throw new Error(`모르는 러너 트리거 모드 — ${String(mode)}`)
}

/**
 * 🔴 **로컬 러너가 본 단계 입력 — 값으로 남긴다** (2026-09-26).
 *
 *    GitHub 에는 기간형 변수(d3 · 2026-09-23~29)가 있고 로컬 정본 env 에는 없다(알려진 분기).
 *    그 사실을 문장이 아니라 **값**으로 남긴다 — 러너 로그 한 줄 · preflight 표 한 줄.
 *    🔴 천장은 `releaseStageCeiling` 정본 하나다. 발행 트랜잭션도 같은 함수로 단계를 누른다.
 */
export type StageInputs = {
  capacity: string | null
  release: string | null
  window: { stage: string | null; from: string | null; until: string | null; activeToday: boolean; note: string | null }
  canary: { stage: string | null; date: string | null; activeToday: boolean }
  /** 🔴 이 env 로 발행 트랜잭션이 허용하는 가장 높은 단계 */
  ceiling: RuntimeStage
  /** 그 천장의 하루 목표 — 이 트리거 혼자서는 이보다 많이 내지 못한다 */
  ceilingDailyTarget: number
}

const rawOf = (env: Readonly<Record<string, string | undefined>>, k: string): string | null => {
  const v = (env[k] ?? '').trim()
  return v === '' ? null : v
}

export function stageInputsOf(env: Readonly<Record<string, string | undefined>>, now: Date): StageInputs {
  const w = windowAuthorization(env, now, RUNTIME_STAGES)
  const c = canaryAuthorization(env, now, RUNTIME_STAGES)
  const ceiling = releaseStageCeiling(env, now)
  return {
    capacity: rawOf(env, CAPACITY_ENV), release: rawOf(env, RELEASE_ENV),
    window: {
      stage: rawOf(env, WINDOW_STAGE_ENV), from: rawOf(env, WINDOW_FROM_ENV), until: rawOf(env, WINDOW_UNTIL_ENV),
      activeToday: w.activeToday, note: w.note,
    },
    canary: { stage: rawOf(env, CANARY_STAGE_ENV), date: rawOf(env, CANARY_DATE_ENV), activeToday: c.activeToday },
    ceiling, ceilingDailyTarget: profileOf(ceiling).dailyTarget,
  }
}

/** 🔴 러너 로그 한 줄 — 비밀값은 없다(단계 키 일곱 개만 읽는다) */
export function describeStageInputs(s: StageInputs): string {
  const v = (x: string | null): string => x ?? '(없음)'
  return `capacity=${v(s.capacity)} · release=${v(s.release)}`
    + ` · window=${v(s.window.stage)}[${v(s.window.from)}~${v(s.window.until)}]${s.window.activeToday ? ' 오늘 유효' : ''}`
    + ` · canary=${v(s.canary.stage)}@${v(s.canary.date)}${s.canary.activeToday ? ' 오늘 유효' : ''}`
    + ` → 천장 ${s.ceiling} (하루 ${s.ceilingDailyTarget}건)`
}

/** 🔴 정본 env 에서 읽는 단계 키 — 비밀값 키는 읽지 않는다 */
export const STAGE_INPUT_KEYS: readonly string[] = [
  CAPACITY_ENV, RELEASE_ENV, WINDOW_STAGE_ENV, WINDOW_FROM_ENV, WINDOW_UNTIL_ENV, CANARY_STAGE_ENV, CANARY_DATE_ENV,
]

/** 🔴 `KEY=VALUE` 텍스트에서 **단계 키만** 뽑는다. 다른 줄은 메모리에도 올리지 않는다 */
export function pickStageInputKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m === null || !STAGE_INPUT_KEYS.includes(m[1]!)) continue
    let v = m[2] ?? ''
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]!] = v
  }
  return out
}

export type StageInputVerdict = {
  /** 🔴 heartbeat 를 등록해도 되는가 */
  ok: boolean
  local: StageInputs
  github: StageInputs | null
  /** 값으로 드러난 분기 — 막지 않는 것도 여기 적힌다 */
  divergences: readonly string[]
  blockers: readonly string[]
}

/**
 * 🔴 **로컬과 GitHub 의 단계 입력 — 설치하려면 두 트리거의 실효 천장이 같아야 한다** (2026-09-26 마스터 보정).
 *
 *    · GitHub 을 못 읽었다 → 막는다(모를 때 등록하지 않는다)
 *    · 로컬 천장 **≠** GitHub 천장 → 막는다. 어느 방향이든 막는다:
 *        - 로컬이 높다 — 새로 자주 깨는 쪽이 백업보다 넓으면 fail-open 이다
 *        - 로컬이 낮다 — 안전하지만 heartbeat 가 하루 첫 글 하나만 제때 내고 나머지는 늦은 GitHub 예약을
 *          기다린다. 설치해도 목적(제때 발행)을 이루지 못하므로 **설치 가능으로 세지 않는다**
 *          (실측 모양 2026-09-26: local d1 · GitHub d3)
 *    · 천장이 같다 → 통과. raw 문자열이 달라도(지난 canary · 끝난 기간) **분기로 적을 뿐** 그 이유로 막지 않는다
 *
 * 🔴 판정에 쓰는 천장은 `releaseStageCeiling` 하나다. 이 함수가 숫자를 새로 만들지 않고 env 도 바꾸지 않는다.
 */
export function judgeHeartbeatStageInputs(input: {
  local: Readonly<Record<string, string | undefined>>
  github: Readonly<Record<string, string | undefined>> | null
  now: Date
}): StageInputVerdict {
  const local = stageInputsOf(input.local, input.now)
  if (input.github === null) {
    return {
      ok: false, local, github: null, divergences: [],
      blockers: ['GitHub Variables 를 읽지 못했다 — 두 트리거의 천장을 대조할 수 없다(fail-closed)'],
    }
  }
  const github = stageInputsOf(input.github, input.now)
  const divergences: string[] = []
  for (const k of STAGE_INPUT_KEYS) {
    const a = rawOf(input.local, k)
    const b = rawOf(input.github, k)
    if (a !== b) divergences.push(`${k} — local ${a ?? '(없음)'} · GitHub ${b ?? '(없음)'}`)
  }
  const blockers: string[] = []
  if (local.ceiling !== github.ceiling) {
    const dir = stageRank(local.ceiling) > stageRank(github.ceiling)
      ? '자주 깨는 쪽이 더 넓다 — fail-open 이다'
      : 'heartbeat 가 로컬 천장까지만 제때 내고 나머지는 늦은 GitHub 예약을 기다린다 — 설치 목적을 이루지 못한다'
    blockers.push(`🔴 실효 천장 불일치 — local ${local.ceiling}(하루 ${local.ceilingDailyTarget}) ≠ GitHub ${github.ceiling}(하루 ${github.ceilingDailyTarget}) · ${dir}`)
  }
  return { ok: blockers.length === 0, local, github, divergences, blockers }
}

/**
 * 🔴 **설치본에서 렌더 입력을 되읽는다** — 순수 파싱. 새 plist 가 설치본과 **트리거만** 다르게 하려는 것이다.
 *    하나라도 못 읽으면 `null` — 추측으로 채우지 않는다(부르는 쪽이 기본값을 쓰고 그 사실을 적는다).
 */
export function parseInstalledRunnerPlist(xml: string): RunnerPlistInput | null {
  const one = (re: RegExp): string | null => re.exec(xml)?.[1] ?? null
  const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? ''
  const npxPath = /<string>([^<]+)<\/string>/.exec(args)?.[1] ?? null
  const runtimeRoot = one(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)
  const out = one(/<key>StandardOutPath<\/key>\s*<string>([^<]+)\/original-post-runner\.log<\/string>/)
  const path = one(/<key>PATH<\/key>\s*<string>([^<]+)<\/string>/)
  const nodeBinDir = path === null ? null : (path.split(':')[0] ?? null)
  if (npxPath === null || runtimeRoot === null || out === null || nodeBinDir === null || nodeBinDir === '') return null
  return { npxPath, runtimeRoot, logDir: out, nodeBinDir }
}

/**
 * 🔴 **설치·rollback 명령 — 문자열만 만든다. 실행하지 않는다.**
 *    같은 label 을 교체한다. 설치 전에 지금 설치본을 백업하고, rollback 은 그 백업을 되돌려 까는 것이다.
 */
export function heartbeatCommands(input: {
  agentPlist: string
  renderedHeartbeat: string
  renderedFixed: string
  backupPlist: string
}): { install: string[]; rollback: string[] } {
  const q = (p: string): string => `"${p}"`
  const target = `gui/$(id -u)/${PUBLISH_RUNNER_LABEL}`
  return {
    install: [
      `mkdir -p ${q(input.backupPlist.replace(/\/[^/]+$/, ''))}`,
      `cp -p ${q(input.agentPlist)} ${q(input.backupPlist)}`,
      `launchctl bootout ${target}`,
      `cp ${q(input.renderedHeartbeat)} ${q(input.agentPlist)}`,
      `plutil -lint ${q(input.agentPlist)}`,
      `launchctl bootstrap gui/$(id -u) ${q(input.agentPlist)}`,
      `launchctl print ${target} | grep -E 'state|program|--heartbeat|path'`,
    ],
    rollback: [
      `launchctl bootout ${target}`,
      `cp ${q(input.backupPlist)} ${q(input.agentPlist)}    # 백업이 없으면: cp ${q(input.renderedFixed)} ${q(input.agentPlist)}`,
      `plutil -lint ${q(input.agentPlist)}`,
      `launchctl bootstrap gui/$(id -u) ${q(input.agentPlist)}`,
      `launchctl print ${target} | grep -E 'state|program|path'`,
    ],
  }
}

/** 🔴 heartbeat 등록 절차 — **이 PR 은 실행하지 않는다.** 사람이 읽는 순서다 */
export const HEARTBEAT_INSTALL_STEPS: readonly string[] = [
  '① 이 PR 은 등록하지 않는다 — 아래는 별도 승인 뒤의 순서다',
  '🔴 ② runtime 을 이 커밋 이상으로 배포한다 — 옛 러너는 --heartbeat 를 **조용히 무시하고** 틱 잠금·창 밖 생략 없이 돈다(트랜잭션 게이트는 그대로지만 매 틱 DB 에 붙는다)',
  '🔴 ③ npm run publish:heartbeat-preflight -- --check-runtime — runtime 인지 · plutil lint(임시 파일) · 설치본 대조 · 단계 입력 분기 · 명령 출력',
  '🔴 ④ **exit 0 일 때만** 출력된 설치 명령을 사람이 실행한다. 먼저 설치본을 백업한다',
  '⑤ 같은 label 을 교체한다 — 정시판과 heartbeat 가 동시에 등록되는 길이 없다',
  '🔴 ⑥ GitHub 예약은 **끄지 않는다** — 맥이 꺼져 있으면 남는 것은 그것뿐이다',
  '⑦ rollback 은 백업한 정시판을 같은 자리에 다시 까는 것이다(출력된 rollback 명령)',
]

/**
 * 🔴 **등록한 러너가 실제로 돌 수 있는 상태인가** — 순수 판정.
 *
 *    관측(파일 읽기 · launchctl · node 존재 확인)은 부르는 쪽이 해서 넘긴다.
 *    🔴 "등록됐다" 를 "돈다" 로 읽지 않는다 — 2026-09-15 에 그렇게 이틀치 슬롯을 잃었다.
 */
export type RunnerEnvVerdict = { ok: boolean; problems: string[] }

export function judgeRunnerEnv(input: {
  /** 설치된 plist 의 `EnvironmentVariables.PATH`. 없으면 null */
  installedPath: string | null
  /** launchctl 이 **실제로 물고 있는** PATH. 관측 못 했으면 null */
  loadedPath?: string | null
  /** 지금 돌고 있는 node 의 bin 디렉터리 */
  nodeBinDir: string
  /** 그 PATH 안에서 `node` 실행 파일을 찾았는가 — 부르는 쪽이 실측 */
  nodeFound: boolean
  /** 절대 npx 를 그 PATH 로 실행해 봤는가 (shebang `#!/usr/bin/env node` 가 뜨는가) */
  npxRunnable?: boolean | null
}): RunnerEnvVerdict {
  const problems: string[] = []
  const want = runnerPathValue(input.nodeBinDir)
  if (input.installedPath === null || input.installedPath.trim() === '') {
    problems.push(
      '🔴 설치된 plist 에 EnvironmentVariables.PATH 가 없다'
      + ' — npx shebang(#!/usr/bin/env node)이 뜨기도 전에 exit 127 로 죽는다',
    )
  } else {
    if (!input.installedPath.split(':').includes(input.nodeBinDir)) {
      problems.push(`🔴 PATH 에 지금 node 의 bin 이 없다 — ${input.installedPath}`)
    }
    for (const sys of RUNNER_SYSTEM_PATH.split(':')) {
      if (!input.installedPath.split(':').includes(sys)) {
        problems.push(`🔴 표준 시스템 경로가 빠졌다 — ${sys}`)
      }
    }
    if (input.installedPath !== want) {
      problems.push(`🟡 PATH 가 렌더 결과와 다르다 — 설치 ${input.installedPath} · 렌더 ${want}`)
    }
  }
  if (!input.nodeFound) {
    problems.push('🔴 그 PATH 안에서 node 실행 파일을 찾지 못했다')
  }
  // 🔴 못 본 것은 통과시키지 않는다. 다만 "실행해 보지 않았다" 와 "실패했다" 는 다르게 적는다
  if (input.npxRunnable === false) {
    problems.push('🔴 절대 npx 를 그 PATH 로 실행하지 못했다 — shebang 이 node 를 못 찾는다')
  }
  if (input.loadedPath !== undefined) {
    if (input.loadedPath === null || input.loadedPath.trim() === '') {
      problems.push('🔴 launchctl 에 등록된 PATH 를 확인하지 못했다(fail-closed)')
    } else if (input.installedPath !== null && input.loadedPath !== input.installedPath) {
      problems.push(
        `🔴 실제 등록된 PATH 가 설치본과 다르다 — load ${input.loadedPath} · 파일 ${input.installedPath}`,
      )
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 **비밀값을 plist 에 담지 않는다.** launchd plist 는 평문이고 백업에도 남는다.
 *    DATABASE_URL · API key 는 runtime `.env.local` 에서 프로세스가 직접 읽는다.
 */
export const RUNNER_FORBIDDEN_ENV_KEYS: readonly string[] = [
  'DATABASE_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
  'NEXTAUTH_SECRET', 'KAKAO_CLIENT_SECRET', 'R2_SECRET_ACCESS_KEY',
]

/** plist 원문에 비밀 키 이름이 등장하면 실패다 */
export function judgeRunnerSecrets(xml: string): RunnerEnvVerdict {
  const problems = RUNNER_FORBIDDEN_ENV_KEYS
    .filter((k) => xml.includes(k))
    .map((k) => `🔴 plist 에 비밀값 키가 있다 — ${k}`)
  return { ok: problems.length === 0, problems }
}

/** 🔴 등록 절차를 코드가 아니라 **사람이 읽는 순서**로 남긴다 */
export const PUBLISH_RUNNER_INSTALL_STEPS: readonly string[] = [
  '① 이 PR 은 등록하지 않는다 — 아래는 별도 승인 뒤의 순서다',
  '② runtime 을 배포하고 SHA 를 확인한다 — npm run runtime:isolation-check -- --require-runtime',
  '      🔴 정본 env 를 읽는 것도 runtime 배포가 끝난 뒤여야 한다. 순서를 바꾸지 않는다',
  '🔴 ③ npm run publish:trigger-preflight — 정본 env(절대 경로)와 GitHub Variables 를 대조한다.',
  `      정본은 ${CANONICAL_ENV_PATH} 하나다 — cwd 도 process.env 도 보지 않는다`,
  '      다르거나 정본을 읽지 못하면 exit 1 이다. 두 트리거가 다른 단계로 발행하면 상한이 두 벌이 된다',
  '🔴 ④ **exit 0 일 때만** 아래로 내려간다',
  `⑤ plist 를 ~/Library/LaunchAgents/${PUBLISH_RUNNER_LABEL}.plist 로 쓴다`,
  '⑥ plutil -lint 로 문법을 확인한다',
  '⑦ launchctl load 로 올리고 launchctl print 로 실제 경로가 runtime 인지 대조한다',
  '🔴 ⑦-b **PATH 를 대조한다** — 설치본·launchctl·렌더 결과가 같고,'
  + ' 그 PATH 에서 node 가 보이고, 절대 npx 가 실제로 실행되는지까지 본다(`judgeRunnerEnv`).'
  + ' 2026-09-15: 이 검사가 없어 08:10·09:30 두 슬롯이 exit 127 로 죽었다',
  '🔴 ⑧ GitHub 예약은 **끄지 않는다.** 맥이 꺼져 있으면 launchd 는 아무것도 하지 않는다 —',
  '      그때 남는 것은 GitHub 예약뿐이다. 둘이 겹쳐도 catch-up + Serializable 이 막는다',
  '🔴 ⑨ 이것은 **단기 임시 bridge** 다. 맥 전원과 무관한 정시성이 필요해지면 다른 것으로 바꾼다',
]

// ─────────────────────────────────────────────────────────
// 🔴 설정 분리 preflight — **두 트리거가 같은 단계를 봐야 한다**
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **왜 필요한가** (2026-09-14 실측).
 *
 *    GitHub Actions 는 Repository Variables 를, launchd 는 runtime `env.local` 을 읽는다.
 *    **두 곳이 달랐다** —
 *      · runtime env.local     `SORAN_CAPACITY_STAGE=d3` · `SORAN_RELEASE_STAGE=d1`
 *      · GitHub Variables      **비어 있음** → 러너가 `d1` 로 fail-closed
 *
 *    지금은 두 effective release 가 우연히 같아서(d1) 사고가 나지 않았을 뿐이다.
 *    한쪽만 d3 로 올리면 **같은 날 두 트리거가 서로 다른 하루 상한을 본다** —
 *    launchd 는 3건까지 열려 있다고 보고, GitHub 은 1건까지라고 본다.
 *    발행 트랜잭션이 상한을 지키지만, **어느 상한을 지키는지가 트리거마다 달라진다.**
 *
 * 🔴 **새 중앙 설정을 만들지 않는다.** 값을 한 곳으로 옮기는 대신 **다르면 멈춘다**.
 *    설정이 둘인 것은 인프라의 사실이고, 그 사실을 감추는 추상화가 더 위험하다.
 */
export type StageSetting = {
  capacity: string | undefined
  release: string | undefined
}

export type CanonicalRead =
  | { ok: true; setting: StageSetting; path: string }
  | { ok: false; reason: string; path: string }

/**
 * 🔴 **두 키만 뽑는다.** 파일 전체를 파싱해 들고 다니지 않는다 —
 *    이 파일에는 DATABASE_URL · API key 가 함께 산다. 필요 없는 것을 읽지 않는 것이
 *    "출력하지 않는다" 보다 확실하다.
 *
 * 🔴 **fail-closed 두 가지.**
 *    · `KEY=VALUE` 로 읽히는 줄이 하나도 없다 → 파싱 실패
 *    · 두 단계 키가 **둘 다** 없다 → 정본이 단계를 말하지 않는다
 *      (조용히 d1 로 떨어뜨리면 위에서 고친 거짓 통과가 그대로 돌아온다)
 */
export function parseCanonicalStages(text: string, path = CANONICAL_ENV_PATH): CanonicalRead {
  let parsedAnyLine = false
  let capacity: string | undefined
  let release: string | undefined
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m === null) continue
    parsedAnyLine = true
    const key = m[1]!
    if (key !== CAPACITY_ENV && key !== RELEASE_ENV) continue
    let v = m[2] ?? ''
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (key === CAPACITY_ENV) capacity = v
    else release = v
  }
  if (!parsedAnyLine) {
    return { ok: false, path, reason: `정본을 파싱하지 못했다 — KEY=VALUE 줄이 없다 (${path})` }
  }
  if (capacity === undefined && release === undefined) {
    return {
      ok: false, path,
      reason: `정본에 ${CAPACITY_ENV} · ${RELEASE_ENV} 가 둘 다 없다`
        + ' — 단계를 말하지 않는 정본으로 등록하지 않는다(fail-closed)',
    }
  }
  return { ok: true, path, setting: { capacity, release } }
}

/**
 * 🔴 **정본 파일을 직접 읽는다.** cwd 도 `process.env` 도 보지 않는다.
 *    `read` 는 시험용 주입구다 — 없으면 실제 파일을 읽는다.
 */
export function readCanonicalStages(input?: {
  path?: string
  read?: (p: string) => string
}): CanonicalRead {
  const path = input?.path ?? CANONICAL_ENV_PATH
  let text: string
  try {
    text = (input?.read ?? ((p: string) => readFileSync(p, 'utf-8')))(path)
  } catch (e) {
    const code = (e as { code?: string }).code
    return {
      ok: false, path,
      reason: code === 'ENOENT'
        ? `정본 파일이 없다 — ${path}`
        : `정본 파일을 읽지 못했다 (${code ?? 'UNKNOWN'}) — ${path}`,
    }
  }
  return parseCanonicalStages(text, path)
}

export type ParitySide = {
  capacity: RuntimeStage
  release: RuntimeStage
  /** capacity 가 release 를 누른 뒤의 실제 공개 단계 */
  effectiveRelease: RuntimeStage
  /** 값이 비어 있거나 허용 밖이라 안전 단계로 떨어졌는가 */
  fellBack: boolean
}

export type ParityVerdict = {
  /** 🔴 local runner 를 등록해도 되는가 */
  ok: boolean
  local: ParitySide
  github: ParitySide | null
  blockers: readonly string[]
  reason: string
}

/**
 * 🔴 capacity 가 release 를 누른다 — `resolveScale` ① 과 같은 규칙이다.
 *    러너 단계(d1~d50)로 읽는다 — `resolveScale` 과 같은 해석이어야 두 트리거 비교가 러너가 볼 값과 같다.
 */
function sideOf(s: StageSetting): ParitySide {
  const cap = resolveRuntimeStage(s.capacity, 'capacity')
  const rel = resolveRuntimeStage(s.release, 'release')
  const effectiveRelease = stageRank(rel.stage) > stageRank(cap.stage) ? cap.stage : rel.stage
  return {
    capacity: cap.stage, release: rel.stage, effectiveRelease,
    fellBack: !cap.fromEnv || !rel.fromEnv,
  }
}

/**
 * 🔴 **두 트리거가 같은 단계를 보는가.** 다르면 local runner 를 등록하지 않는다.
 *    GitHub 쪽을 읽지 못했으면(`null`) 그것도 막는다 — 모를 때 등록하지 않는다(fail-closed).
 */
export function judgeTriggerParity(input: {
  local: StageSetting
  /** 🔴 읽지 못했으면 `null`. `{}` 로 보정하지 않는다 */
  github: StageSetting | null
}): ParityVerdict {
  const local = sideOf(input.local)
  if (input.github === null) {
    return {
      ok: false, local, github: null,
      blockers: ['GitHub Variables 를 읽지 못했다 — 두 트리거가 같은 단계를 보는지 확인할 수 없다(fail-closed)'],
      reason: 'GitHub Variables 를 읽지 못했다',
    }
  }
  const github = sideOf(input.github)
  const blockers: string[] = []
  if (local.capacity !== github.capacity) {
    blockers.push(`capacity 가 다르다 — local ${local.capacity} · GitHub ${github.capacity}`)
  }
  if (local.release !== github.release) {
    blockers.push(`release 가 다르다 — local ${local.release} · GitHub ${github.release}`)
  }
  if (local.effectiveRelease !== github.effectiveRelease) {
    blockers.push(
      `🔴 실제 공개 단계가 다르다 — local ${local.effectiveRelease} · GitHub ${github.effectiveRelease}.`
      + ' 두 트리거가 서로 다른 하루 상한을 본다',
    )
  }
  return {
    ok: blockers.length === 0,
    local, github, blockers,
    reason: blockers.length === 0
      ? `두 트리거가 같은 단계를 본다 — capacity ${local.capacity} · release ${local.release}`
        + ` → 공개 ${local.effectiveRelease}`
      : blockers[0]!,
  }
}

/** 🔴 허용 단계 목록 — 화면이 사람에게 보여 줄 때 쓴다(러너 단계 d1~d50) */
export const PARITY_STAGES: readonly RuntimeStage[] = RUNTIME_STAGES

export type TriggerPlan = {
  /** 정시 트리거가 담당하는 슬롯 수 */
  slots: number
  /** 🔴 launchd 가 **보장하는 것과 보장하지 못하는 것** */
  localNote: string
  localLimits: readonly string[]
  /** GitHub 예약만 있을 때의 실측 지연 */
  scheduleNote: string
}

/**
 * 🔴 **두 트리거의 역할과 한계를 값으로 적는다.** 문서에만 적으면 갈린다.
 *    지연 수치는 2026-09-13 실측이다 — 추정이 아니다.
 */
export function describeTriggers(): TriggerPlan {
  return {
    slots: publishRunnerSlots().length,
    localNote: 'launchd StartCalendarInterval — 🔴 **맥이 깨어 있는 동안에만** 분 단위 정시',
    localLimits: [
      '맥이 꺼져 있으면 돌지 않는다 — 놓친 회차는 부팅 시에도 복구되지 않는다(RunAtLoad=false)',
      '절전 중 지나간 여러 회차는 wake 때 **1회로 합쳐진다**(man launchd.plist) — 한 회차는 1건만 낸다',
      '따라서 Mac OFF·sleep 상태에서 d10 10건을 **보장하지 못한다**',
    ],
    scheduleNote: 'GitHub Actions 예약 — 2026-09-13 실측 지연 108~331분 · 2026-09-14 `30 0 * * *` 미도착',
  }
}
