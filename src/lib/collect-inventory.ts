/**
 * 수집 능력 재고 — 🔴 **현재 · 준비를 한 숫자로 합치지 않는다** · 순수 함수
 *
 *      current   launchctl 에 실제로 올라와 있는 수집 job 과 그 `StartCalendarInterval` 슬롯 수 → 관측에서만
 *      prepared  저장소의 계획 — 바퀴 표(`CYCLES`) × 원천 목록(`collect-sources`)
 *
 * 🔴 수집 job 은 하나다(`COLLECT_JOB_LABEL`). 바퀴마다 원천을 차례로 돈다 — 카페를 늘려도 job 은 그대로다.
 * 🔴 여기 숫자는 **설정된 상한**이다(목록을 끝까지 읽어도 남는 본문 몫). 실제 산출은 회차 기록이 답한다.
 * 🔴 이 파일은 `launchctl` 도 파일도 읽지 않는다 — 관측은 호출부가 넣는다.
 */
import { CYCLES } from './cycle-schedule'
import { COLLECT_JOB_LABEL, COLLECT_SOURCES, detailCeilingPerDay, sourceIdOf, type SourceId } from './collect-sources'

/**
 * 🔴 **관측 한 건 = launchctl 에 올라와 있는 job 하나.**
 *    `label` 과 `slots` 둘 다 있어야 한다 — label 만 맞고 슬롯이 모자라면 계획한 바퀴가 아니다.
 */
export type ObservedJob = {
  label: string
  /** 실제 plist 의 `StartCalendarInterval` 항목들 */
  slots: readonly { hour: number; minute: number }[]
  /** 🔴 `launchctl list` 에 실제로 올라와 있는가. 파일만 있고 load 되지 않았을 수 있다 */
  loaded: boolean
}

export type CurrentSource = {
  id: SourceId
  /** 지금 올라와 있는 수집 job 의 label. 없으면 null = 미등록 */
  label: string | null
  /** 🔴 **실제 plist 슬롯 수**다. 계획의 바퀴 수가 아니다 */
  runsPerDay: number
  /** 등록된 슬롯 비율만큼의 하루 본문 상한 */
  effectivePerDay: number
  theoreticalPerDay: number
  registered: boolean
}

function loadedCollectJob(observed: readonly ObservedJob[]): ObservedJob | null {
  return observed.find((o) => o.loaded && o.label === COLLECT_JOB_LABEL) ?? null
}

/** 🔴 **지금 실제로 열리는 하루 본문 상한** — 슬롯 수는 관측값이다 */
export function currentCapacity(observed: readonly ObservedJob[]): {
  perSource: CurrentSource[]
  effectivePerDay: number
  theoreticalPerDay: number
} {
  const job = loadedCollectJob(observed)
  const runs = job?.slots.length ?? 0
  const perSource = COLLECT_SOURCES.map((s): CurrentSource => {
    const per = Math.floor((detailCeilingPerDay(s) * Math.min(runs, CYCLES.length)) / CYCLES.length)
    return {
      id: sourceIdOf(s.id), label: job?.label ?? null, runsPerDay: runs,
      theoreticalPerDay: per, effectivePerDay: per, registered: job !== null,
    }
  })
  const sum = perSource.reduce((n, s) => n + s.effectivePerDay, 0)
  return { perSource, effectivePerDay: sum, theoreticalPerDay: sum }
}

export type PreparedSource = {
  id: SourceId
  label: string
  runsPerDay: number
  effectivePerDay: number
  theoreticalPerDay: number
}

/** 🔴 저장소의 계획 — **돌고 있다는 뜻이 아니다** */
export function preparedCapacity(): {
  perSource: PreparedSource[]
  effectivePerDay: number
  theoreticalPerDay: number
} {
  const perSource = COLLECT_SOURCES.map((s): PreparedSource => ({
    id: sourceIdOf(s.id), label: COLLECT_JOB_LABEL, runsPerDay: CYCLES.length,
    theoreticalPerDay: detailCeilingPerDay(s), effectivePerDay: detailCeilingPerDay(s),
  }))
  const sum = perSource.reduce((n, s) => n + s.effectivePerDay, 0)
  return { perSource, effectivePerDay: sum, theoreticalPerDay: sum }
}

export type InventoryMismatch = {
  /** 어긋남이 원천 하나의 것이 아니면 null(모르는 수집 job) */
  id: SourceId | null
  code: 'NOT_REGISTERED' | 'SLOT_COUNT_DIFFERS' | 'UNKNOWN_LABEL'
  detail: string
}

/**
 * 🔴 **등록 상태와 계획이 어긋나는 지점.** "템플릿이 있다" 를 "돌고 있다" 로 읽는 순간 이 목록이 비어 보인다.
 *    옛 카페별 job(`…-multi`)이 남아 올라와 있으면 같은 카페를 두 번 연다 — 모르는 수집 job 으로 잡는다.
 */
export function inventoryMismatches(observed: readonly ObservedJob[]): InventoryMismatch[] {
  const out: InventoryMismatch[] = []
  const job = loadedCollectJob(observed)
  if (job === null) {
    out.push({ id: null, code: 'NOT_REGISTERED', detail: `${COLLECT_JOB_LABEL} 미등록 — 지금 열리는 건수 0` })
  } else if (job.slots.length !== CYCLES.length) {
    out.push({ id: null, code: 'SLOT_COUNT_DIFFERS', detail: `${job.label} 슬롯 ${job.slots.length}개 — 바퀴 ${CYCLES.length}개와 다르다` })
  }
  for (const o of observed) {
    if (!o.loaded || o.label === COLLECT_JOB_LABEL) continue
    if (!/^com\.soransoran\.(navercafe-collect|raw-collect|supply-collect)/.test(o.label)) continue
    out.push({ id: null, code: 'UNKNOWN_LABEL', detail: `${o.label} — 계획에 없는 수집 job 이 돌고 있다` })
  }
  return out
}

/** 🔴 수집 job 이 **바퀴 표대로** 올라와 있는가 — 슬롯 수까지 같아야 한다 */
export function runsPlannedSchedule(observed: readonly ObservedJob[]): boolean {
  const job = loadedCollectJob(observed)
  return job !== null && job.slots.length === CYCLES.length
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 값을 쓴다 */
export function describeInventory(observed: readonly ObservedJob[]): string {
  const cur = currentCapacity(observed)
  const prep = preparedCapacity()
  // 🔴 **`설정`이다.** 등록된 슬롯 × 상한일 뿐 실제로 나오는 양이 아니다
  return `설정 ${Math.round(cur.effectivePerDay)}건/day (수집 job ${cur.perSource[0]?.registered === true ? '등록' : '미등록'})`
    + ` · 준비 ${Math.round(prep.effectivePerDay)}건/day`
}
