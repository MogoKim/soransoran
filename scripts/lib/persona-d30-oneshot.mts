/**
 * D30 Persona cohort(wave7-d30 · P44~P63) **1회 투입 판정** — 🔴 순수 함수. DB·git·launchctl·파일을 건드리지 않는다
 *
 * 실행기(`scripts/persona-d30-oneshot.mts`)는 관측만 모아 여기에 넘기고, 여기서 나온 판정대로만 움직인다.
 * 쓰기는 오직 정본 경로 `persona-cohort-run`(create → seed → check → activate)이 한다 — 여기에는 쓰기 경로가 없다.
 *
 * 🔴 두 digest 는 **다른 계약**이다. 섞지 않는다.
 *    · 승인 digest(source) — 보충 말투 v2 의 **의미 배정** digest. 시각·사유를 뺀 plan digest 와 같은 공식이다.
 *      "무엇을 승인했나" 에 답한다. 승인 당시 dry-run 4회·독립 검사 18/18 과 같은 값이어야 한다.
 *    · runtime 자산 식별자 — runtime 코드가 **실제로 읽는 파일 바이트** 결속 digest. 배포 manifest 가 적은 값이다.
 *      "지금 무엇이 돌고 있나" 에 답한다. 같은 의미라도 파일 바이트(generatedAt·사유)가 바뀌면 달라진다.
 */
import { createHash } from 'node:crypto'

export const ONESHOT_COHORT = 'wave7-d30' as const
export const ONESHOT_LABEL = 'com.soransoran.persona-d30-oneshot'
/**
 * 🔴 실행 창 두 개 (2026-11-16 창업자 결정 — 11-17 07:00 D30 개방).
 *    · 결정 전 창 03:45~06:05 — 그날 controller 결정 **전**에 투입해, 07:00 결정이 60명을 보고 시험을 열 수 있게 한다.
 *      권위는 **전날** controller 행(PREPARE·d20·d30 · 비증명일)이고 그날 행은 아직 없어야 한다.
 *      정본이 고정하는 cohort 는 TRIAL/REPROVE 기록 **이후**뿐이다(goal canon §6 증명일 계약) — 결정 전 투입은 그 밖이다.
 *      03:45 는 마지막 배포 시도(03:01) 뒤, 06:05 는 06:15 공급 회차 전이다.
 *    · 결정 뒤 창 07:05~07:19 — 그날 controller 행이 PREPARE 일 때(결정 전 창이 NO-GO 였을 때의 두 번째 기회).
 *      결정 전 창이 끝냈으면 표식 `done` 이라 이 창은 아무것도 하지 않는다.
 */
export const PRE_DECISION_WINDOW = { startMinute: 3 * 60 + 45, endMinute: 6 * 60 + 5 } as const
export const ONESHOT_WINDOW = { startMinute: 7 * 60 + 5, endMinute: 7 * 60 + 19 } as const
export type OneShotMode = 'pre-decision' | 'post-decision'
export const REQUIRED_STAGE = { state: 'PREPARE', release: 'd20', capacity: 'd30', decidedBy: 'controller' } as const

/** 지금 분(0~1439)이 어느 실행 창인가 — 창 밖이면 null */
export function oneShotWindowOf(minute: number): { mode: OneShotMode; startMinute: number; endMinute: number } | null {
  if (minute >= PRE_DECISION_WINDOW.startMinute && minute <= PRE_DECISION_WINDOW.endMinute) return { mode: 'pre-decision', ...PRE_DECISION_WINDOW }
  if (minute >= ONESHOT_WINDOW.startMinute && minute <= ONESHOT_WINDOW.endMinute) return { mode: 'post-decision', ...ONESHOT_WINDOW }
  return null
}

/** KST 날짜 문자열의 전날 — 모양이 틀리면 null */
export function previousKstDateOf(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const t = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== date) return null
  return new Date(t - 86_400_000).toISOString().slice(0, 10)
}

/** 🔴 승인 digest — 2026-11-14 22:44 · 11-15 00:00 dry-run 4회 동일 · 독립 검사 18/18 (기존 40 diff 0 · 동결 10 · 신규 20) */
export const APPROVED_SUPPLEMENT_PLAN_DIGEST = 'be47bb887a879706e47dd0cd86017d50dbe9f6cd87ff2e1aa55b8765cfda8ad5'
/** 🔴 runtime 자산 식별자 — 6410be6a manifest 와 실측이 같은 값(2026-11-15 02:00) */
export const EXPECTED_RUNTIME_ASSET_IDENTITY = {
  referenceDigest: '1428007f0fa325a7046eba693b7eb83f63b19e1e7eef9588fe110f73083ae643',
  supplementDigest: 'b27b03056388733d371959e470b84eb1e20ef3494e962740b565d2eafb8978ee',
} as const

export const COHORT_CODES: readonly string[] = Array.from({ length: 20 }, (_, i) => `P${44 + i}`)
export const OLD_COUNT = 40
export const FINAL_ACTIVE = 60

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex')

/**
 * 🔴 승인 digest 공식 — `planSupplementSnapshot().planDigest` 와 **같은 공식**을 기록된 파일에 적용한다.
 *    검사(`persona-d30-oneshot-check`)가 두 공식이 같은 값을 내는지 고정한다(공식 drift 차단).
 */
export function supplementApprovalDigestOf(asset: {
  version: unknown; baseSourceDigest: unknown; baseCodes: unknown; bundles: unknown
}, manifest: { version: unknown; baseSourceDigest: unknown; baseAssignmentDigest: unknown; saltId: unknown }): string {
  return sha256(JSON.stringify({
    asset: {
      version: asset.version, baseSourceDigest: asset.baseSourceDigest, baseCodes: asset.baseCodes, bundles: asset.bundles,
    },
    manifest: {
      version: manifest.version, baseSourceDigest: manifest.baseSourceDigest,
      baseAssignmentDigest: manifest.baseAssignmentDigest, saltId: manifest.saltId,
    },
  }))
}

export type Identity = { referenceDigest: string; supplementDigest: string | null }
export type StageRow = { kstDate: string; state: string; release: string; capacity: string; decidedBy: string }
export type MarkerState = null | { state: 'started' | 'done' | 'failed' | 'held' | 'paused'; date: string }

export type OneShotFacts = {
  /** 실행기의 `--date` — 🔴 고정 날짜. 다른 날 깨어나면 아무것도 하지 않는다 */
  targetDate: string
  /** 지금 KST 날짜와 분(0~1439) */
  kstDate: string
  kstMinute: number
  /** 그날 StageDecision. 못 읽었으면 `undefined`, 없으면 `null` */
  stage: StageRow | null | undefined
  /** 🔴 전날 StageDecision — 결정 전 창의 권위. 못 읽었으면 `undefined`, 없으면 `null` */
  previousStage: StageRow | null | undefined
  /** git · pin · manifest — 못 읽은 칸은 null */
  originMain: string | null
  head: string | null
  pin: string | null
  manifestSha: string | null
  manifestIdentity: Identity | null
  deployLock: boolean | null
  /** 정본 job 의 실행 관측 — 못 본 것은 unknown 에 */
  runningJobs: readonly string[]
  unknownJobs: readonly string[]
  /** 기록된 v2 파일로 계산한 승인 digest · runtime 코드로 잰 자산 식별자 */
  approvalDigest: string | null
  runtimeIdentity: Identity | null
  /** 기존 40명 — 동결 v1 배정과 현재 배정이 같은가(말투) · DB 에서 정확히 active 40 인가 */
  old40VoiceSame: boolean | null
  old40ActiveCodes: readonly string[] | null
  expectedOld40: readonly string[]
  /** DB 에 있는 P44~P63 코드 · 같은 코드의 중복 행 수 */
  cohortExisting: readonly string[] | null
  /** 활성화 감사 행위자 — 관리자 계정 수 */
  adminCount: number | null
  marker: MarkerState | undefined
  /** 🔴 정본 `readPersonaCapacity` 한 번의 판독 — 투입 전 기준선. 판독 실패는 null */
  capacity: { contractValid: number | null; stageActive: number | null } | null
}

export type OneShotVerdict =
  | { go: true; code: 'GO'; problems: []; mode: OneShotMode }
  | { go: false; code: string; problems: string[]; noop?: boolean }

const KST_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 🔴 하나라도 어긋나면 write 0. 판정 순서는 "아무것도 하지 않아도 되는 이유" → "멈춰야 하는 이유" 다 */
export function judgeOneShot(f: OneShotFacts): OneShotVerdict {
  const no = (code: string, ...problems: string[]): OneShotVerdict => ({ go: false, code, problems })
  if (!KST_DATE.test(f.targetDate)) return no('BAD_TARGET_DATE', `--date 모양 오류: ${f.targetDate}`)
  if (f.kstDate !== f.targetDate) {
    return { go: false, code: 'STALE_DAY', problems: [`오늘 ${f.kstDate} ≠ 예정일 ${f.targetDate} — 다른 날에는 실행하지 않는다`], noop: true }
  }
  if (f.marker === undefined) return no('MARKER_UNREADABLE', '실행 표식을 읽지 못했다(fail-closed)')
  if (f.marker !== null) {
    if (f.marker.state === 'done') return { go: false, code: 'ALREADY_DONE', problems: ['이미 완료된 회차다 — 다시 하지 않는다'], noop: true }
    return no('MARKER_PRESENT', `이전 실행 표식 ${f.marker.state} — 사람이 확인하기 전에는 다시 하지 않는다`)
  }
  const win = oneShotWindowOf(f.kstMinute)
  if (win === null) {
    return no('OUTSIDE_WINDOW', `실행 창(03:45~06:05 · 07:05~07:19) 밖이다 — 지금 ${String(Math.floor(f.kstMinute / 60)).padStart(2, '0')}:${String(f.kstMinute % 60).padStart(2, '0')}`)
  }
  if (f.stage === undefined) return no('STAGE_UNKNOWN', '그날 StageDecision 을 읽지 못했다(UNKNOWN · fail-closed)')
  // 🔴 권위 행 고르기 — 결정 전 창은 전날 controller 행, 결정 뒤 창은 그날 controller 행. 그 뒤 검사는 같다
  let s: StageRow
  let authorityDate: string
  if (win.mode === 'pre-decision') {
    if (f.stage !== null) return no('STAGE_ALREADY_DECIDED', '그날 결정이 이미 있다 — 결정 전 창에서는 투입하지 않는다(07:05 창이 그 결정으로 판정한다)')
    const prev = previousKstDateOf(f.targetDate)
    if (f.previousStage === undefined) return no('PREV_STAGE_UNKNOWN', '전날 StageDecision 을 읽지 못했다(UNKNOWN · fail-closed)')
    if (f.previousStage === null) return no('PREV_STAGE_MISSING', '전날 StageDecision 행이 없다 — 이어 갈 controller 권위가 없다')
    s = f.previousStage
    authorityDate = prev ?? ''
  } else {
    if (f.stage === null) return no('STAGE_MISSING', '그날 StageDecision 행이 없다 — controller 확정 전에는 하지 않는다')
    s = f.stage
    authorityDate = f.targetDate
  }
  if (s.kstDate !== authorityDate) return no('STAGE_STALE', `StageDecision 날짜 ${s.kstDate} ≠ ${authorityDate}`)
  if (s.decidedBy !== REQUIRED_STAGE.decidedBy) return no('STAGE_NOT_CONTROLLER', `decidedBy=${s.decidedBy}`)
  if (s.state === 'TRIAL' || s.state === 'REPROVE') return no('PROOF_DAY', `${s.state} — 증명일에는 cohort 를 바꾸지 않는다`)
  if (s.state !== REQUIRED_STAGE.state) return no('STAGE_NOT_PREPARE', `state=${s.state} (PREPARE 만)`)
  if (s.release !== REQUIRED_STAGE.release) return no('STAGE_RELEASE', `release=${s.release} (d20 만)`)
  if (s.capacity !== REQUIRED_STAGE.capacity) return no('STAGE_CAPACITY', `capacity=${s.capacity} (d30 만)`)

  const shas = [f.originMain, f.head, f.pin, f.manifestSha]
  if (shas.some((x) => x === null || !/^[0-9a-f]{40}$/.test(x))) return no('RUNTIME_UNKNOWN', 'origin/main · HEAD · pin · manifest 중 읽지 못한 것이 있다')
  if (new Set(shas).size !== 1) {
    return no('RUNTIME_MISMATCH', `origin/main ${f.originMain!.slice(0, 8)} · HEAD ${f.head!.slice(0, 8)} · pin ${f.pin!.slice(0, 8)} · manifest ${f.manifestSha!.slice(0, 8)}`)
  }
  if (f.deployLock !== false) return no('DEPLOY_LOCK', f.deployLock === null ? '배포 잠금 상태를 모른다' : '배포가 진행 중이다')
  if (f.unknownJobs.length > 0) return no('JOB_UNKNOWN', `실행 여부를 모르는 job: ${f.unknownJobs.join(' · ')}`)
  if (f.runningJobs.length > 0) return no('JOB_RUNNING', `돌고 있는 job: ${f.runningJobs.join(' · ')}`)

  if (f.approvalDigest !== APPROVED_SUPPLEMENT_PLAN_DIGEST) {
    return no('SUPPLEMENT_APPROVAL_DIGEST', `승인 digest 불일치 — ${f.approvalDigest?.slice(0, 12) ?? '계산 실패'} ≠ ${APPROVED_SUPPLEMENT_PLAN_DIGEST.slice(0, 12)}`)
  }
  const e = EXPECTED_RUNTIME_ASSET_IDENTITY
  const same = (x: Identity | null): boolean => x !== null && x.referenceDigest === e.referenceDigest && x.supplementDigest === e.supplementDigest
  if (!same(f.runtimeIdentity)) return no('RUNTIME_ASSET_IDENTITY', 'runtime 코드가 읽는 말투 자산 식별자가 기대값과 다르다')
  if (!same(f.manifestIdentity)) return no('MANIFEST_ASSET_IDENTITY', 'manifest 의 말투 자산 식별자가 기대값과 다르다')

  if (f.old40VoiceSame !== true) return no('OLD40_VOICE_DRIFT', f.old40VoiceSame === null ? '기존 40 말투 배정을 재지 못했다' : '기존 40 말투 배정이 동결 v1 과 다르다')
  if (f.old40ActiveCodes === null) return no('DB_UNREADABLE', '기존 40 상태를 읽지 못했다')
  const want = [...f.expectedOld40].sort()
  const got = [...f.old40ActiveCodes].sort()
  if (want.length !== OLD_COUNT || JSON.stringify(want) !== JSON.stringify(got)) {
    return no('OLD40_STATE', `기존 active ${got.length}/${OLD_COUNT} — 정확히 기존 40명이 active 여야 한다`)
  }
  if (f.cohortExisting === null) return no('DB_UNREADABLE', 'P44~P63 존재 여부를 읽지 못했다')
  if (f.cohortExisting.length > 0) {
    const dup = f.cohortExisting.filter((c, i) => f.cohortExisting!.indexOf(c) !== i)
    if (dup.length > 0) return no('COHORT_DUPLICATE', `같은 코드 중복 행: ${[...new Set(dup)].join(',')}`)
    return no(f.cohortExisting.length === COHORT_CODES.length ? 'COHORT_PRESENT' : 'COHORT_PARTIAL',
      `P44~P63 중 ${f.cohortExisting.length}명이 이미 있다 — 전원 미존재일 때만 한다`)
  }
  if (f.adminCount !== 1) return no('ACTOR', f.adminCount === null ? '관리자 계정을 읽지 못했다' : `관리자 계정 ${f.adminCount}개 — 정확히 1개여야 한다`)
  // 🔴 **마지막 게이트** — 이 코드가 나오면 다른 게이트는 전부 통과한 것이다(교정 1회 허용 판정이 그것을 전제한다)
  const c = f.capacity
  if (c === null || c.contractValid !== OLD_COUNT || c.stageActive !== OLD_COUNT) {
    return no('CAPACITY_BASELINE', `정본 계약 유효 ${c?.contractValid ?? '판독 실패'} · stage-active ${c?.stageActive ?? '판독 실패'} — 투입 전 ${OLD_COUNT}/${OLD_COUNT} 이어야 한다`)
  }
  return { go: true, code: 'GO', problems: [], mode: win.mode }
}

export type OutcomeFacts = {
  /** 마지막으로 성공한 정본 단계 */
  activated: boolean
  /**
   * 🔴 정본 `readPersonaCapacity` 한 번의 판독 — 계약 유효 수 · stage-active 수. 판독 실패는 둘 다 null(모름).
   *    단계 preflight 가 받는 값이 이것이다. 활성 행 수(totalActive)로 대신하지 않는다.
   */
  contractValid: number | null
  stageActive: number | null
  totalActive: number | null
  cohortActive: number | null
  /** 기존 40 행 지문(code·status·updatedAt) 전후 동일 */
  old40Same: boolean | null
  /** `cohort-run --step=check` exit 0 */
  checkOk: boolean
}

/** 🔴 결과 판정 — PASS 가 아니면 **새 cohort 만** 되돌린다. 기존 40 은 건드리지 않는다 */
export function judgeOutcome(o: OutcomeFacts): { code: 'PASS' | 'PAUSE_NEW_COHORT' | 'HOLD_DRAFT'; problems: string[] } {
  const problems: string[] = []
  if (o.contractValid !== FINAL_ACTIVE) problems.push(`contract-valid ${o.contractValid ?? '판독 실패'} ≠ ${FINAL_ACTIVE}`)
  if (o.stageActive !== FINAL_ACTIVE) problems.push(`stage-active ${o.stageActive ?? '판독 실패'} ≠ ${FINAL_ACTIVE}`)
  if (o.totalActive !== FINAL_ACTIVE) problems.push(`active ${o.totalActive ?? '?'} ≠ ${FINAL_ACTIVE}`)
  if (o.cohortActive !== COHORT_CODES.length) problems.push(`새 cohort active ${o.cohortActive ?? '?'} ≠ ${COHORT_CODES.length}`)
  if (o.old40Same !== true) problems.push('기존 40 행이 바뀌었거나 읽지 못했다')
  if (!o.checkOk) problems.push('cohort check 위반')
  if (problems.length === 0 && o.activated) return { code: 'PASS', problems }
  // 🔴 하나라도 켜졌을 수 있으면 새 cohort 를 멈춘다. 켜기 전이면 draft 는 운영에 나가지 않는다 — 그대로 둔다
  return { code: o.activated || (o.cohortActive ?? 1) > 0 ? 'PAUSE_NEW_COHORT' : 'HOLD_DRAFT', problems }
}

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 🔴 1회 실행 plist — 고정 날짜를 인자로 박는다. 다른 날 깨어나면 실행기가 STALE_DAY 로 아무것도 하지 않는다.
 *    시작 시각은 두 창의 시작(03:45 · 07:05)이다 — 창 상수에서 만든다(시각을 두 곳에 적지 않는다).
 */
export function renderOneShotPlist(v: { npx: string; nodebin: string; runtimeRoot: string; logdir: string; date: string }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('date 모양 오류')
  const args = [v.npx, 'tsx', `${v.runtimeRoot}/scripts/persona-d30-oneshot.mts`, '--apply', `--date=${v.date}`]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ONESHOT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(v.runtimeRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xmlEscape(v.nodebin)}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartCalendarInterval</key>
  <array>
${[PRE_DECISION_WINDOW, ONESHOT_WINDOW].map((w) => `    <dict><key>Hour</key><integer>${Math.floor(w.startMinute / 60)}</integer><key>Minute</key><integer>${w.startMinute % 60}</integer></dict>`).join('\n')}
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${xmlEscape(v.logdir)}/persona-d30-oneshot.log</string>
  <key>StandardErrorPath</key><string>${xmlEscape(v.logdir)}/persona-d30-oneshot-error.log</string>
</dict>
</plist>
`
}

/**
 * 🔴 P15 정본 교정 1회를 먼저 해도 되는가 — 다른 게이트가 전부 통과했고(=`CAPACITY_BASELINE`) 기준선이 **정확히 39/39** 일 때만.
 *    그 밖(38 · 41 · 판독 실패 · stage 만 39 등)은 교정으로 풀리는 문제가 아니다 — 아무것도 하지 않는다.
 */
export function remediationEligible(v: OneShotVerdict, f: Pick<OneShotFacts, 'capacity'>): boolean {
  return !v.go && v.code === 'CAPACITY_BASELINE' && f.capacity !== null
    && f.capacity.contractValid === OLD_COUNT - 1 && f.capacity.stageActive === OLD_COUNT - 1
}
