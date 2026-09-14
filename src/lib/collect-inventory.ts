/**
 * 수집 능력 재고 — 🔴 **현재 · 준비 · 필요를 절대 한 숫자로 합치지 않는다** (2026-09-08)
 *
 * 🔴 왜 이 파일이 필요한가.
 *
 *    `SOURCE_FACTS[].loaded` 라는 **정적 boolean** 이 "지금 돌고 있다" 의 정본 노릇을 했다.
 *    거기에 `RUNS_PER_DAY[id].start` 를 곱한 값이 **실제 능력**으로 세어졌다.
 *    그런데 그때 `launchctl` 에 올라와 있던 것은 1회짜리 job 두 개뿐이었다 —
 *    템플릿이 저장소에 있다는 사실과 job 이 등록돼 있다는 사실이 섞인 것이다.
 *    (📜 그 1회판은 지금 없다. 2026-09-11 실측 기준 `-multi` 둘이 돈다.
 *     🔴 그래도 이 파일은 **그 숫자를 알지 못한다** — 관측은 호출부가 넣는다.)
 *
 * 🔴 그래서 세 가지를 **다른 타입**으로 나눈다.
 *
 *      current   실제 등록된 label 과 실제 `StartCalendarInterval` 슬롯 수
 *                → 관측(`ObservedJob[]`)에서만 나온다. 코드 상수에서 나오지 않는다
 *      prepared  저장소에 템플릿이 있고 계획이 성립하는 것
 *      required  그 capacity 단계가 요구하는 처리량
 *
 * 🔴 이 파일은 계산만 한다. `launchctl` 도 파일도 읽지 않는다 —
 *    관측은 호출부가 넣는다(운영은 실측, CI fixture 는 synthetic).
 */

import {
  RUNS_PER_DAY, SOURCE_FACTS, detailPerDayOf,
  type Phase, type SourceFacts, type SourceId,
} from './collect-schedule'

/**
 * 🔴 **관측 한 건 = launchctl 에 올라와 있는 job 하나.**
 *    `label` 과 `slots` 둘 다 있어야 한다 — label 만 맞고 슬롯이 1개면 그것은 1회 job 이다.
 */
export type ObservedJob = {
  label: string
  /** 실제 plist 의 `StartCalendarInterval` 항목들 */
  slots: readonly { hour: number; minute: number }[]
  /** 🔴 `launchctl list` 에 실제로 올라와 있는가. 파일만 있고 load 되지 않았을 수 있다 */
  loaded: boolean
}

/**
 * 🔴 소스마다 **1회판 label 과 다회판 label 이 다르다.**
 *    다회 전환은 "같은 job 을 고치는 것" 이 아니라 **다른 job 을 올리고 1회판을 내리는 것**이다.
 *    그래서 label 로 무엇이 도는지 구분할 수 있다.
 *
 * 🔴 **`single` 은 실행 경로가 아니라 판정용 이름이다** (2026-09-11).
 *    1회판 job 도 그 plist 템플릿도 저장소에 없다. 이 이름을 남기는 이유는 하나다 —
 *    어떤 기계에 옛 job 이 남아 있으면 `currentCapacity` 가 그것을 **`kind: 'single'` 로
 *    알아보고 "계획한 다회판이 아니다" 라고 말해야** 하기 때문이다.
 *    이름을 지우면 그 job 은 미등록으로 보이고, 실제로는 돌면서 아무도 모르게 된다.
 */
export const JOB_LABELS: Readonly<Record<SourceId, { single: string | null; multi: string }>> = {
  '82cook': {
    // 🔴 82cook 은 1회판이 없다. Raw Vault 레인과 공급 레인이 각자 예약 job 을 갖는다
    single: null,
    multi: 'com.soransoran.raw-collect-82cook',
  },
  'navercafe:remonterrace': {
    single: 'com.soransoran.navercafe-collect-remonterrace',
    multi: 'com.soransoran.navercafe-collect-remonterrace-multi',
  },
  'navercafe:wgang': {
    single: 'com.soransoran.navercafe-collect-wgang',
    multi: 'com.soransoran.navercafe-collect-wgang-multi',
  },
}

export type JobKind = 'single' | 'multi'

/** label → (소스, 판) */
export function sourceOfLabel(label: string): { id: SourceId; kind: JobKind } | null {
  for (const id of Object.keys(JOB_LABELS) as SourceId[]) {
    const l = JOB_LABELS[id]
    if (l.multi === label) return { id, kind: 'multi' }
    if (l.single === label) return { id, kind: 'single' }
  }
  return null
}

// ─────────────────────────────────────────────────────────
// ① current — 🔴 관측에서만 나온다
// ─────────────────────────────────────────────────────────

export type CurrentSource = {
  id: SourceId
  /** 지금 올라와 있는 job 의 label. 없으면 null = 미등록 */
  label: string | null
  kind: JobKind | null
  /** 🔴 **실제 plist 슬롯 수**다. 계획의 회차 수가 아니다 */
  runsPerDay: number
  /** 성공률을 곱한 실제 하루 상세 처리량 */
  effectivePerDay: number
  /** 성공률을 곱하지 않은 값 — 비교용 */
  theoreticalPerDay: number
  registered: boolean
}

/**
 * 🔴 **지금 실제로 열리는 하루 상세 건수.**
 *
 *    · 관측된 label 이 그 소스의 것이 아니면 세지 않는다
 *    · **슬롯 수는 관측값**이다 — 1회 job 을 다회 계획(4·8회)으로 세지 않는다
 *    · `loaded === false`(파일만 있고 load 안 됨)는 등록으로 세지 않는다
 */
export function currentCapacity(observed: readonly ObservedJob[]): {
  perSource: CurrentSource[]
  effectivePerDay: number
  theoreticalPerDay: number
} {
  const byLabel = new Map(observed.filter((o) => o.loaded).map((o) => [o.label, o]))
  const perSource = SOURCE_FACTS.map((f): CurrentSource => {
    const labels = JOB_LABELS[f.id]
    // 🔴 다회판이 올라와 있으면 그것이 정본이다. 없으면 1회판을 본다
    const multi = byLabel.get(labels.multi)
    const single = labels.single === null ? undefined : byLabel.get(labels.single)
    const hit = multi ?? single
    const kind: JobKind | null = multi !== undefined ? 'multi' : single !== undefined ? 'single' : null
    const runsPerDay = hit?.slots.length ?? 0
    const theoretical = f.detailPerRun * runsPerDay
    return {
      id: f.id,
      label: hit?.label ?? null,
      kind,
      runsPerDay,
      theoreticalPerDay: theoretical,
      effectivePerDay: theoretical * f.detailSuccessRate.value,
      registered: hit !== undefined,
    }
  })
  return {
    perSource,
    effectivePerDay: perSource.reduce((n, s) => n + s.effectivePerDay, 0),
    theoreticalPerDay: perSource.reduce((n, s) => n + s.theoreticalPerDay, 0),
  }
}

// ─────────────────────────────────────────────────────────
// ② prepared — 🔴 저장소에 있는 계획. **돌고 있다는 뜻이 아니다**
// ─────────────────────────────────────────────────────────

export type PreparedSource = {
  id: SourceId
  label: string
  runsPerDay: number
  effectivePerDay: number
  theoreticalPerDay: number
}

export function preparedCapacity(phase: Phase): {
  perSource: PreparedSource[]
  effectivePerDay: number
  theoreticalPerDay: number
} {
  const perSource = SOURCE_FACTS.map((f: SourceFacts): PreparedSource => {
    const runs = RUNS_PER_DAY[f.id][phase]
    // 🔴 산식 정본은 `detailPerDayOf` 하나다 — 여기서 다시 적으면 82cook thin 경로를 놓친다
    const theoretical = detailPerDayOf(f, phase)
    return {
      id: f.id, label: JOB_LABELS[f.id].multi, runsPerDay: runs,
      theoreticalPerDay: theoretical,
      effectivePerDay: theoretical * f.detailSuccessRate.value,
    }
  })
  return {
    perSource,
    effectivePerDay: perSource.reduce((n, s) => n + s.effectivePerDay, 0),
    theoreticalPerDay: perSource.reduce((n, s) => n + s.theoreticalPerDay, 0),
  }
}

// ─────────────────────────────────────────────────────────
// ③ 어긋남 — 🔴 화면과 JSON 이 **같은 문장**을 낸다
// ─────────────────────────────────────────────────────────

export type InventoryMismatch = {
  id: SourceId
  code: 'NOT_REGISTERED' | 'SINGLE_WHILE_MULTI_PLANNED' | 'SLOT_COUNT_DIFFERS' | 'UNKNOWN_LABEL'
  detail: string
}

/**
 * 🔴 **등록 상태와 준비 계획이 어긋나는 지점.**
 *    "템플릿이 있다" 를 "돌고 있다" 로 읽는 순간 이 목록이 비어 보인다.
 */
export function inventoryMismatches(observed: readonly ObservedJob[], phase: Phase): InventoryMismatch[] {
  const cur = currentCapacity(observed)
  const out: InventoryMismatch[] = []
  for (const s of cur.perSource) {
    const want = RUNS_PER_DAY[s.id][phase]
    const multiLabel = JOB_LABELS[s.id].multi
    if (!s.registered) {
      out.push({ id: s.id, code: 'NOT_REGISTERED', detail: `${multiLabel} 미등록 — 지금 열리는 건수 0` })
      continue
    }
    if (s.kind === 'single') {
      out.push({
        id: s.id, code: 'SINGLE_WHILE_MULTI_PLANNED',
        detail: `1회판(${s.label})이 돌고 있다 — 계획은 ${multiLabel} ${want}회/day`
          + ` (지금 ${s.runsPerDay}회 · ${s.theoreticalPerDay}건)`,
      })
      continue
    }
    if (s.runsPerDay !== want) {
      out.push({
        id: s.id, code: 'SLOT_COUNT_DIFFERS',
        detail: `${s.label} 슬롯 ${s.runsPerDay}개 — 계획 ${want}개와 다르다`,
      })
    }
  }
  // 🔴 우리가 모르는 수집 job 이 올라와 있으면 그것도 어긋남이다
  for (const o of observed) {
    if (!o.loaded) continue
    if (!/^com\.soransoran\.(navercafe-collect|raw-collect)/.test(o.label)) continue
    if (sourceOfLabel(o.label) === null) {
      out.push({ id: '82cook', code: 'UNKNOWN_LABEL', detail: `${o.label} — 계획에 없는 수집 job 이 돌고 있다` })
    }
  }
  return out
}

/**
 * 🔴 그 소스가 **계획한 다회판으로** 돌고 있는가.
 *    승격 준비도는 이것을 요구한다 — 1회판이 도는 것은 준비 완료가 아니다.
 */
export function runsPlannedMulti(observed: readonly ObservedJob[], id: SourceId, phase: Phase): boolean {
  const hit = observed.find((o) => o.loaded && o.label === JOB_LABELS[id].multi)
  return hit !== undefined && hit.slots.length === RUNS_PER_DAY[id][phase]
}

/** 사람이 읽을 한 줄 — 화면과 JSON 이 같은 값을 쓴다 */
export function describeInventory(observed: readonly ObservedJob[], phase: Phase): string {
  const cur = currentCapacity(observed)
  const prep = preparedCapacity(phase)
  // 🔴 **`설정`이다.** 등록된 슬롯 × 상한일 뿐 실제로 나오는 양이 아니다
  return `설정 ${Math.round(cur.effectivePerDay)}건/day (등록 ${cur.perSource.filter((s) => s.registered).length}/${SOURCE_FACTS.length})`
    + ` · 준비 ${Math.round(prep.effectivePerDay)}건/day`
}
