/**
 * 공급 처리(drain) — 순수 판정 (§4-AU)
 *
 * 🔴 **이것은 수집기가 아니다.** 수집은 source 마다 **독립 job** 이 한다 —
 *    82cook 얇은 상세 job · remonterrace `-multi` job · wgang `-multi` job.
 *    이 파일이 정하는 것은 **이미 디스크에 있는 미처리 입력을 어떻게 비우는가** 하나다.
 *
 * 🔴 **왜 중앙 러너를 없앴나** (2026-09-11).
 *
 *    옛 `supply-autopilot` 은 수집 · 변환 · 판정 · 생성 · 적재를 한 회차에 묶었다.
 *    그래서 **82cook 하나가 `ECONNREFUSED` 면 회차 전체가 멈췄고**, 이미 받아 둔
 *    네이버 thin 이 Raw 로 가지 못해 이틀간 신규 공급이 0 이었다(09-10 실측).
 *    거기에 "재고가 목표면 no-op" 이라는 중앙 게이트까지 얹혀 있어서,
 *    한 source 의 사정과 한 숫자가 **세 source 의 공급을 통째로** 좌우했다.
 *
 *    고치는 방향은 재시도 로직을 더 얹는 것이 아니라 **묶음을 푸는 것**이다.
 *      · 수집은 source 마다 독립 job — 하나가 죽어도 나머지는 자기 스케줄로 돈다
 *      · 처리는 수집을 소유하지 않는다 — **이미 생긴 입력만** 비운다
 *      · 입력이 없으면 정상 no-op 이다
 *
 * 🔴 **checkpoint 로 재개하지 않는다.** 회복은 **입력에서 다시 읽는 것**이다.
 *    미처리 입력은 디스크에 그대로 남아 있고, 하위 단계는 저마다 dedup 을 갖고 있다
 *    (judge=사람 판정·LLM 캐시 · draft=publish-candidates · fill=DB provenance + 트랜잭션).
 *    그래서 "어디까지 했는지" 를 파일에 적어 둘 이유가 없다 — 다시 돌리면 남은 것만 처리된다.
 */

import { STOCK_BANDS } from './supply-stock-plan'
// 🔴 **사본 완료 판정은 어댑터와 같은 함수를 쓴다.** 여기서 정규식을 다시 쓰면
//    한쪽만 고쳐진다 — 실제로 그랬다 (2026-09-11 Codex 리뷰).
import { completedAdaptKeys } from './micro-seed-82cook-thin-adapt'

/** 🔴 처리기 kill switch. plist 를 지우지 않고도 멈출 수 있어야 한다 */
export const PROCESS_KILL_SWITCH_ENV = 'SORAN_SUPPLY_PROCESS_ENABLED'

/**
 * lock 이 이보다 오래되면 죽은 것으로 본다 — 45분.
 * 🔴 처리기는 밖으로 나가지 않는다(네트워크 0). 한 회차가 90분씩 걸릴 이유가 없다.
 */
export const LOCK_TTL_MS = 45 * 60 * 1000

export const LOCK_FILE = 'supply-process.lock'

/** 회차 기록 — 🔴 **재개 근거가 아니라 관제 근거**다. 이 파일을 읽고 무엇을 돌릴지 정하지 않는다 */
export const RUN_FILE_RE = /^supply-process-.*\.run\.json$/
export const runFileName = (runId: string): string => `supply-process-${runId}.run.json`

// ─────────────────────────────────────────────────────────
// source — 🔴 확정 수집원 셋. 늘리려면 여기부터 고친다
// ─────────────────────────────────────────────────────────

export type SupplySourceId = '82cook' | 'navercafe:remonterrace' | 'navercafe:wgang'

export const SUPPLY_SOURCES: readonly SupplySourceId[] = [
  '82cook', 'navercafe:remonterrace', 'navercafe:wgang',
]

/** 네이버 카페 source → 수집기가 쓰는 카페 id. 🔴 82cook 은 카페가 아니다 */
export const CAFE_OF: Readonly<Partial<Record<SupplySourceId, string>>> = {
  'navercafe:remonterrace': 'remonterrace',
  'navercafe:wgang': 'wgang',
}

// ─────────────────────────────────────────────────────────
// 단계
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **수집 단계가 없다.** `cafeThin` 은 이미 받아 둔 카페 수집물의 형태를 바꿀 뿐이고,
 *    네트워크에도 모델에도 나가지 않는다.
 */
export const PROCESS_STAGES = ['cafeThin', 'adapt', 'judge', 'draft', 'fill'] as const
export type ProcessStage = (typeof PROCESS_STAGES)[number]

export const STAGE_LABEL: Record<ProcessStage, string> = {
  cafeThin: '네이버 카페 수집물 얇은 변환',
  adapt: '검수용 변환',
  judge: 'AI 자동 판정',
  draft: 'AI 초안 생성 · 품질 게이트',
  fill: 'Queue 재고 보충',
}

/** 🔴 **비어 있다.** 처리기는 남의 서버를 두드리지 않는다 — 그것이 수집 job 과의 경계다 */
export const NETWORK_STAGES: readonly ProcessStage[] = []
/** 🔴 모델을 부르는 단계 */
export const LLM_STAGES: readonly ProcessStage[] = ['judge', 'draft']
/** 🔴 DB 에 쓰는 단계 — 하나뿐이다. 나머지는 전부 파일까지다 */
export const DB_WRITE_STAGES: readonly ProcessStage[] = ['fill']

/** source 마다 따로 도는 단계 — 🔴 한 source 가 실패해도 다음 source 는 계속한다 */
export const PER_SOURCE_STAGES: readonly ProcessStage[] = ['cafeThin', 'adapt']
/** 모든 source 의 산출을 함께 먹는 단계 */
export const COMMON_STAGES: readonly ProcessStage[] = ['judge', 'draft', 'fill']

// ─────────────────────────────────────────────────────────
// 파일 identity
// ─────────────────────────────────────────────────────────

/**
 * 🔴 얇은 파일 하나의 **처리 identity**. runId 단독으로는 안 된다.
 *
 * remonterrace 와 wgang 회차가 같은 runId 를 가질 수 있다.
 * runId 로만 판단하면 한쪽이 다른 쪽을 "이미 했다" 로 막고 산출물 이름도 겹쳐 덮어쓴다.
 *
 *   82cook-thin-<runId>.thin-detail.jsonl           → <runId>
 *   navercafe-thin-<cafe>-<runId>.thin-detail.jsonl → <cafe>-<runId>
 *
 * 🔴 러너 · adapt · 관제 · fixture 가 **이 하나**를 쓴다. 복제하면 한쪽만 고쳐진다.
 */
export function adaptKeyOf(path: string): string {
  const base = (path.split('/').pop() ?? path).replace(/\.thin-detail\.jsonl$/, '')
  return base.replace(/^82cook-thin-/, '').replace(/^navercafe-thin-/, '')
}

/**
 * 이 파일은 어느 source 의 것인가 — 🔴 모르면 `null` 이다.
 *    추측해서 아무 source 에 붙이면, 그 source 가 실패했을 때 남의 입력까지 같이 버려진다.
 */
export function sourceOfDataFile(name: string): SupplySourceId | null {
  const base = name.split('/').pop() ?? name
  if (base.startsWith('82cook-')) return '82cook'
  const m = /^navercafe-(?:thin-)?([a-z0-9]+)[-.]/i.exec(base)
  if (m === null) return null
  const cafe = m[1]!.toLowerCase()
  for (const id of SUPPLY_SOURCES) if (CAFE_OF[id] === cafe) return id
  return null
}

// ─────────────────────────────────────────────────────────
// 미처리 입력
// ─────────────────────────────────────────────────────────

export type Pending = {
  /** `cafeThin` 이 처리할 카페 수집물 (source 별) */
  rawCafe: Partial<Record<SupplySourceId, string[]>>
  /** `adapt` 가 처리할 얇은 파일 (source 별) */
  thin: Partial<Record<SupplySourceId, string[]>>
  /** `judge` 가 먹을 검수용 파일이 하나라도 있는가 */
  detail: string[]
  /** `draft` 가 먹을 판정 파일이 하나라도 있는가 */
  shadow: string[]
  /** `fill` 이 먹을 후보 파일이 하나라도 있는가 */
  candidates: string[]
}

const bySource = (m: Partial<Record<SupplySourceId, string[]>>, s: SupplySourceId, f: string): void => {
  const cur = m[s]
  if (cur === undefined) m[s] = [f]
  else cur.push(f)
}

/**
 * 무엇이 남아 있는가 — 🔴 **디렉터리 목록 하나에서** 전부 유도한다.
 *
 * 🔴 `.state.json` 시절처럼 "어디까지 했는지" 를 따로 적어 두지 않는다.
 *    산출물이 있으면 그 단계는 끝난 것이고, 없으면 남은 것이다. 기록과 실제가 어긋날 자리가 없다.
 */
export function planPending(files: readonly string[]): Pending {
  const names = files.map((f) => f.split('/').pop() ?? f)
  const out: Pending = { rawCafe: {}, thin: {}, detail: [], shadow: [], candidates: [] }

  /**
   * adapt 가 이미 사본을 낸 키 — 🔴 **detail 과 raw-detail 이 둘 다 있어야 완료다.**
   *
   *    옛 판은 `^82cook-adapt-(.+?)\.` 하나로 셌다. detail 만 나고 raw-detail 이
   *    없어도 "끝" 이 되어 그 얇은 파일이 다시는 계획되지 않았고,
   *    raw-review 화면은 그 회차를 영영 보지 못했다.
   *    한쪽만 난 회차는 pending 으로 남겨 다음 회차가 다시 만들게 한다.
   */
  const adapted = completedAdaptKeys(names)
  // cafeThin 이 이미 얇게 바꾼 키
  const thinned = new Set<string>()
  for (const f of names) {
    if (/^navercafe-thin-.*\.thin-detail\.jsonl$/.test(f)) thinned.add(adaptKeyOf(f))
  }

  for (const f of names) {
    // ① 카페 raw 수집물 — 🔴 목록(.list.)과 이미 얇아진 것(-thin-)은 제외한다
    const raw = /^navercafe-([a-z0-9]+)-(.+)\.jsonl$/i.exec(f)
    if (raw !== null && !f.includes('.list.') && !f.includes('-thin-')) {
      const src = sourceOfDataFile(f)
      // 🔴 소스까지 붙여 본다 — 같은 runId 의 다른 카페가 서로를 막지 않는다
      if (src !== null && !thinned.has(`${raw[1]!}-${raw[2]!}`)) bySource(out.rawCafe, src, f)
      continue
    }
    // ② 얇은 파일 중 아직 adapt 되지 않은 것
    if (f.endsWith('.thin-detail.jsonl')) {
      const src = sourceOfDataFile(f)
      if (src !== null && !adapted.has(adaptKeyOf(f))) bySource(out.thin, src, f)
      continue
    }
    // ③ 공통 단계의 입력 — 🔴 "있는가" 만 본다. 무엇을 먹을지는 하위 스크립트가 자기 dedup 으로 정한다
    if (f.endsWith('.detail.jsonl') || f.endsWith('.raw-detail.jsonl')) { out.detail.push(f); continue }
    if (f.endsWith('.shadow.jsonl')) { out.shadow.push(f); continue }
    if (/^auto-draft-.*\.candidates\.json$/.test(f)) { out.candidates.push(f) }
  }
  for (const m of [out.rawCafe, out.thin]) {
    for (const k of Object.keys(m) as SupplySourceId[]) m[k]!.sort()
  }
  out.detail.sort(); out.shadow.sort(); out.candidates.sort()
  return out
}

/** 처리할 것이 하나라도 있는가 — 🔴 없으면 **정상 no-op** 이다 (실패가 아니다) */
export function hasWork(p: Pending): boolean {
  return SUPPLY_SOURCES.some((s) => (p.rawCafe[s]?.length ?? 0) > 0 || (p.thin[s]?.length ?? 0) > 0)
    || p.detail.length > 0 || p.shadow.length > 0 || p.candidates.length > 0
}

// ─────────────────────────────────────────────────────────
// 버퍼 정책 — 🔴 **중앙 게이트가 아니다**
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **재고 700 은 APPROVED 버퍼 목표이지 수집 스위치가 아니다.**
 *
 *    옛 판은 재고가 목표에 닿으면 회차 전체를 no-op 으로 만들었다 —
 *    그래서 한 숫자가 세 source 의 수집까지 멈췄다. 지금은 이렇게 나눈다.
 *
 *      재고 < 700   파일 단계 + 모델 단계 + 적재. 적재 상한은 `700 − 재고`
 *      재고 ≥ 700   **파일 단계만** — 수집물을 방치하지 않되 모델도 DB 도 쓰지 않는다
 *
 *    어느 쪽이든 **수집 job 은 이 판정을 보지 않는다.** 저마다 자기 스케줄로 돈다.
 *
 * 🔴 재고를 못 읽으면(`null`) 파일 단계까지만 한다 — 모르는 수를 근거로 DB 에 쓰지 않는다.
 */
export type BufferPolicy = {
  /** 모델 단계(judge · draft)를 돌리는가 */
  llm: boolean
  /** 적재 단계(fill)를 돌리는가 */
  fill: boolean
  /** `--up-to` 로 넘길 상한 */
  upTo: number
  reason: string
}

export function judgeBuffer(usable: number | null, target: number = STOCK_BANDS.target): BufferPolicy {
  if (usable === null || !Number.isInteger(usable) || usable < 0) {
    return {
      llm: false, fill: false, upTo: 0,
      reason: '🔴 재고를 읽지 못했다 — 파일 단계만 돈다 (모델 0 · DB write 0)',
    }
  }
  if (usable >= target) {
    return {
      llm: false, fill: false, upTo: 0,
      reason: `재고 ${usable}건 ≥ 버퍼 목표 ${target}건 — 파일 단계만 돈다 (수집 job 은 영향받지 않는다)`,
    }
  }
  const upTo = target - usable
  return { llm: true, fill: true, upTo, reason: `재고 ${usable}건 < 버퍼 목표 ${target}건 — 적재 상한 ${upTo}건` }
}

// ─────────────────────────────────────────────────────────
// 계획
// ─────────────────────────────────────────────────────────

export type StagePlan = {
  stage: ProcessStage
  label: string
  /** 🔴 인자를 여기서 정한다 — 러너가 즉흥으로 플래그를 붙일 수 없다 */
  args: readonly string[]
  /** 이 단계가 어느 source 의 몫인가. 공통 단계는 `null` */
  source: SupplySourceId | null
  llm: boolean
  dbWrite: boolean
  /**
   * 🔴 **이 단계에만 주는 env** (2026-09-20). 장부 회차 id 와 요청 상한을
   *    단계마다 따로 준다 — 한 상한을 나눠 쓰면 먼저 오는 단계가 전부 가져가고
   *    뒤 단계가 굶는다. canary 가 그 모양이었다(judge 15 · draft 0).
   * 🔴 운영 env 파일은 건드리지 않는다. 자식 프로세스에만 실린다.
   */
  env?: Readonly<Record<string, string>>
}

const mk = (
  stage: ProcessStage, args: readonly string[], source: SupplySourceId | null,
  env?: Readonly<Record<string, string>>,
): StagePlan => ({
  stage, label: STAGE_LABEL[stage], args, source,
  llm: LLM_STAGES.includes(stage),
  dbWrite: DB_WRITE_STAGES.includes(stage),
  ...(env === undefined ? {} : { env }),
})

export type SourcePlan = { source: SupplySourceId; stages: StagePlan[] }

/**
 * source 마다 자기 입력만 처리한다 — 🔴 **다른 source 의 파일을 인자에 섞지 않는다.**
 *
 *    섞으면 한 source 의 깨진 파일 하나가 다른 source 의 수집물까지 같이 떨어뜨린다.
 *    실제로 옛 러너는 adapt 에 전 source 의 얇은 파일을 한 번에 넘겼다.
 */
export function planSourcePhase(pending: Pending): SourcePlan[] {
  const out: SourcePlan[] = []
  for (const source of SUPPLY_SOURCES) {
    const stages: StagePlan[] = []
    const cafe = CAFE_OF[source]
    const raw = pending.rawCafe[source] ?? []
    const thin = pending.thin[source] ?? []
    // 🔴 82cook 에는 cafeThin 이 없다 — 수집 job 이 이미 얇은 파일을 낸다
    if (cafe !== undefined && raw.length > 0) stages.push(mk('cafeThin', ['--apply', `--cafe=${cafe}`], source))
    if (thin.length > 0) stages.push(mk('adapt', ['--apply', `--input=${thin.join(',')}`], source))
    if (stages.length > 0) out.push({ source, stages })
  }
  return out
}

/**
 * 공통 단계 — 🔴 **입력이 있을 때만** 넣는다.
 *
 *    없는데 부르면 하위 스크립트가 "판정할 행이 없다" 로 exit 1 을 낸다.
 *    조용한 날의 정상 no-op 이 매번 실패로 보이면, 진짜 실패가 그 안에 묻힌다.
 *
 * 🔴 `--input` 을 주지 않는다. 무엇을 이미 처리했는지는 각 스크립트의 dedup 이 안다
 *    (judge=사람 판정·LLM 캐시 · draft=publish-candidates · fill=DB provenance).
 *    러너가 파일 목록을 들고 다니면 그 목록이 곧 두 번째 정본이 된다.
 */
/**
 * 🔴 **생성 전 큐 스냅샷 게이트** (2026-09-17).
 *
 *    `ready` 면 draft 에 스냅샷 경로와 회차를 넘긴다.
 *    `hold` 면 **draft 를 계획하지 않는다** — 큐를 못 읽었는데 유료로 만들지 않는다.
 *
 * 🔴 **선택 인자로 두지 않는다.** 기본값을 "그냥 돈다" 로 두면 부르는 쪽이 잊었을 때
 *    조용히 옛 동작으로 돌아가고, 그것을 아무도 모른다. 모든 호출부가 명시하게 한다.
 */
/**
 * 🔴 **회차 id 를 여기 하나에만 둔다** (2026-09-17 보정).
 *
 *    `runId` 는 큐 스냅샷뿐 아니라 **비용 장부의 회차 상한**에도 쓰인다.
 *    판정과 생성이 서로 다른 id 를 쓰면 상한이 단계마다 따로 걸려
 *    회차 전체로는 두 배가 나간다. 그래서 보류할 때도 id 를 들고 다닌다 —
 *    두 곳에 따로 적으면 언젠가 한쪽만 바뀐다.
 */
export type DraftQueueGate =
  | { kind: 'ready'; snapshotPath: string; runId: string }
  | { kind: 'hold'; reason: string; runId: string }

/**
 * 🔴 **이번 회차가 끝까지 보낼 묶음** (2026-09-20). 세 단계가 **같은 N 건**을 본다.
 *    파일 경로를 계획이 정한다 — 하위 스크립트가 디렉터리 전체를 다시 훑지 않게.
 */
export type WorksetGate = {
  /** manifest 경로 — `judge` 가 이 목록의 원천만 판정한다 */
  manifestPath: string
  /** 그 회차 판정 파일 — `draft` 가 **이것만** 읽는다 */
  shadowPath: string
  /** 그 회차 후보 파일 — `fill` 이 **이것만** 읽는다 */
  candidatesPath: string
  limit: number
  /** 단계별 요청 상한 — 🔴 `judgeStageBudget` 이 낸 값을 그대로 받는다 */
  perStage: Readonly<Record<'judge' | 'draft', number>>
}

/**
 * 🔴 **비용 장부 회차 id 는 따로 쓴다** (2026-09-20 보정).
 *
 *    `--run-id` 하나에 provenance(묶음·큐 스냅샷·산출물 연결)와 장부 책임을 겹치면
 *    생성기가 큐 스냅샷을 **다른 회차 파일**로 읽고 거절한다(`RUN_MISMATCH`).
 *    파이프라인 id 는 세 단계가 **같은 값**을 쓰고, 장부 id 만 단계별로 가른다.
 */
export const ledgerRunIdOf = (runId: string, stage: 'judge' | 'draft'): string =>
  `${runId}-${stage === 'judge' ? 'j' : 'd'}`

const LEDGER_CAP_ENV = 'SORAN_LLM_RUN_REQUEST_CAP'

/**
 * 🔴 **손으로 부르는 경로** — 디렉터리 전체를 본다. 묶음 계약이 없다.
 *    live 공급은 이 함수를 쓰지 않는다 (`planBoundedCommonPhase` 를 쓴다).
 */
export function planCommonPhase(
  pending: Pending, policy: BufferPolicy, gate: DraftQueueGate,
): StagePlan[] {
  const out: StagePlan[] = []
  if (!policy.llm) return out
  if (pending.detail.length > 0) {
    out.push(mk('judge', ['--call', '--apply', `--run-id=${gate.runId}`], null))
  }
  if (pending.shadow.length > 0 || pending.detail.length > 0) {
    /**
     * 🔴 **보류는 건너뜀이 아니다.** 입력 파일을 지우지도, 처리 완료로 적지도 않는다 —
     *    다음 정상 회차가 같은 입력을 그대로 다시 집는다(`planPending` 은 파일만 본다).
     */
    if (gate.kind === 'ready') {
      out.push(mk('draft', [
        '--call', '--apply',
        `--queue-snapshot=${gate.snapshotPath}`,
        `--run-id=${gate.runId}`,
        // 🔴 파일이 없으면 만들지 말라는 뜻 — 생성기가 스스로 fail-closed 한다
        '--require-queue-snapshot',
      ], null))
    }
  }
  if (policy.fill && policy.upTo > 0 && (pending.candidates.length > 0 || pending.detail.length > 0)) {
    out.push(mk('fill', ['--apply', `--up-to=${policy.upTo}`], null))
  }
  return out
}

/**
 * 🔴 **live 공급 경로** — 묶음이 **반드시** 있어야 한다. 타입이 그것을 강제한다.
 *
 *    묶음을 못 만들면 부르는 쪽이 회차를 멈춘다. `undefined` 를 넘겨 옛 전체 스캔으로
 *    새는 길이 없다 — 그것이 2026-09-20 canary 를 만든 구조다.
 */
export function planBoundedCommonPhase(
  pending: Pending, policy: BufferPolicy, gate: DraftQueueGate, workset: WorksetGate,
): StagePlan[] {
  const out: StagePlan[] = []
  if (!policy.llm) return out
  if (pending.detail.length > 0) {
    out.push(mk('judge', [
      '--call', '--apply',
      // 🔴 파이프라인 id 는 세 단계가 같다 — 묶음·스냅샷·산출물이 이 값으로 이어진다
      `--run-id=${gate.runId}`,
      // 🔴 장부 id 만 단계별로 가른다 — 상한이 섞이지 않는다
      `--ledger-run-id=${ledgerRunIdOf(gate.runId, 'judge')}`,
      `--workset=${workset.manifestPath}`,
      `--shadow-out=${workset.shadowPath}`,
    ], null, { [LEDGER_CAP_ENV]: String(workset.perStage.judge) }))
  }
  if ((pending.shadow.length > 0 || pending.detail.length > 0) && gate.kind === 'ready') {
    out.push(mk('draft', [
      '--call', '--apply',
      `--queue-snapshot=${gate.snapshotPath}`,
      `--run-id=${gate.runId}`,
      `--ledger-run-id=${ledgerRunIdOf(gate.runId, 'draft')}`,
      '--require-queue-snapshot',
      // 🔴 **그 회차가 만든 판정 파일만** 읽는다 — 과거 shadow 를 다시 훑지 않는다
      `--input=${workset.shadowPath}`,
    ], null, { [LEDGER_CAP_ENV]: String(workset.perStage.draft) }))
  }
  if (policy.fill && policy.upTo > 0 && (pending.candidates.length > 0 || pending.detail.length > 0)) {
    // 🔴 **그 회차 후보 파일만** · 정확히 묶음 크기까지. 과거 후보 파일은 대상이 아니다
    out.push(mk('fill', [
      '--apply', `--input=${workset.candidatesPath}`,
      `--up-to=${Math.min(policy.upTo, workset.limit)}`,
    ], null))
  }
  return out
}

// ─────────────────────────────────────────────────────────
// lock — 🔴 **한 기계 안에서 두 처리기가 겹치지 않게** 하는 것이 전부다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **이 lock 이 막는 것과 막지 못하는 것을 분명히 한다.**
 *
 *    막는다    같은 기계에서 두 처리기가 겹쳐 도는 것
 *    못 막는다 다른 기계(GHA 러너)와의 겹침 — 파일 잠금은 기계마다 따로 있다
 *
 *    기계 사이의 중복 적재는 lock 이 아니라 **DB 쪽 dedup** 이 막는다
 *    (`provenanceKeyOf` + `$transaction`, `micro-seed-supply-autofill`).
 *    그래서 두 처리기가 정말 겹쳐도 같은 후보가 두 번 APPROVED 로 들어가지 않는다.
 */
/**
 * 🔴 **잠금 프로토콜을 여기서 다시 만들지 않는다** (2026-09-11 정정).
 *
 *    앞선 판은 `read → stale 판정 → 삭제 → rename` 으로 획득하고 `rm` 으로 풀었다.
 *    이 저장소는 **이미 2026-09-09(PR #483)에 그 길이 안 된다는 결론**을 내고
 *    `scripts/lib/collect-lock.mts` 에 적어 두었다:
 *
 *      "A 와 B 가 같은 stale 을 읽는다 → A 가 교체하고 확인을 통과한다 →
 *       B 가 **과거 관측을 근거로** 다시 교체한다. A 의 확인은 이미 지나갔다."
 *
 *    같은 결함을 공급 처리기에 다시 들여왔던 것이다. 지금은 **그 검증된 계약을 그대로 쓴다**:
 *      · 획득은 `wx` 한 번 — 관측→조작 쌍이 없다
 *      · 해제는 **내 token 대조 삭제** 하나뿐
 *      · 자동 stale takeover/delete/rename **없음**
 *      · 남은 죽은 락은 `STALE_HELD` 로 **사람이 봐야 할 운영 이상**이 된다
 *
 * 🔴 획득·해제 구현은 `scripts/lib/collect-lock.mts` 정본 하나다.
 *    `src/lib` 이 `scripts/lib` 을 import 하는 방향은 두지 않으므로,
 *    러너가 그 결과(`kind`)를 아래 `LockView` 로 옮겨 판정부에 넘긴다.
 */
export type LockView = 'free' | 'held' | 'stale-held' | 'unreadable'

/**
 * 파일을 바꿔도 되는가.
 *
 * dry-run 과 kill switch 가 닫힌 실행은 관찰만 한다 — 🔴 **잠금조차 만들지 않는다.**
 * 계획만 보는 실행이 잠금 파일을 만들면 "파일 write 0" 이 거짓말이 된다.
 */
export function mayWriteRunState(input: { live: boolean; killOpen: boolean }): boolean {
  return input.live && input.killOpen
}

export type RunBlock =
  | { code: 'DRY_RUN'; reason: string }
  | { code: 'NO_KILL_SWITCH'; reason: string }
  | { code: 'LOCKED'; reason: string }
  | { code: 'NO_INPUT'; reason: string }

export type RunVerdict = { ok: true; reason: string } | ({ ok: false } & RunBlock)

/**
 * 돌 것인가 — 🔴 **재고는 여기 없다.**
 *
 *    재고는 `judgeBuffer` 가 **적재 상한**으로만 쓴다. 회차 자체를 막지 않는다 —
 *    막으면 그것이 곧 중앙 게이트이고, 우리가 없앤 것이 바로 그것이다.
 */
export function judgeProcessRun(input: {
  live: boolean
  killOpen: boolean
  lock: LockView
  hasWork: boolean
}): RunVerdict {
  // ① 할 일이 없으면 정상 no-op — 스위치를 묻기 전에 끝난다
  if (!input.hasWork) {
    return { ok: false, code: 'NO_INPUT', reason: '미처리 입력이 없다 — 정상 no-op' }
  }
  // ② lock — 같은 기계에서 두 처리기가 겹치지 않는다
  if (input.lock === 'held') {
    return { ok: false, code: 'LOCKED', reason: '앞 회차가 아직 돈다' }
  }
  /**
   * 🔴 **죽어 보이는 락도 뺏지 않는다.** 뺏는 순간 관측→조작 창이 열리고,
   *    그 창이 두 회차를 동시에 들여보낸다. 멈추고 사람을 부른다(fail-closed).
   */
  if (input.lock === 'stale-held') {
    return {
      ok: false, code: 'LOCKED',
      reason: '🔴 죽은 것으로 보이는 락이 남아 있다 — 자동으로 뺏지 않는다. 사람이 치운다'
        + ' (관제: npm run supply:health)',
    }
  }
  if (input.lock === 'unreadable') {
    return { ok: false, code: 'LOCKED', reason: '락 상태를 읽지 못했다 — 통과시키지 않는다(fail-closed)' }
  }
  // ③ dry-run 이 기본이다
  if (!input.live) {
    return {
      ok: false, code: 'DRY_RUN',
      reason: `dry-run — 실행하려면 --live 와 ${PROCESS_KILL_SWITCH_ENV}=true 가 둘 다 필요하다`,
    }
  }
  // ④ 스위치 — --live 하나로는 열지 않는다
  if (!input.killOpen) {
    return {
      ok: false, code: 'NO_KILL_SWITCH',
      reason: `${PROCESS_KILL_SWITCH_ENV}=true 가 없다 — --live 하나로는 열지 않는다`,
    }
  }
  return { ok: true, reason: '돈다' }
}

// ─────────────────────────────────────────────────────────
// 집행
// ─────────────────────────────────────────────────────────

export type ExecResult = {
  ok: boolean
  exitCode: number | null
  spawnError: string
}

export type ExecFn = (plan: StagePlan) => Promise<ExecResult>

export type StageOutcome = {
  stage: ProcessStage
  source: SupplySourceId | null
  status: 'ok' | 'failed' | 'skipped'
  exitCode: number | null
  startedAt: string
  endedAt: string
  note: string
}

export type SourceOutcome = { source: SupplySourceId; status: 'ok' | 'failed'; note: string }

export type PhaseResult = {
  /** 🔴 무엇을 어떤 순서로 불렀는가 — 실패 격리의 증거다 */
  calls: { stage: ProcessStage; source: SupplySourceId | null; args: string[] }[]
  outcomes: StageOutcome[]
}

export type SourcePhaseResult = PhaseResult & { sources: SourceOutcome[] }

/**
 * ① source 국면 — 🔴 **한 source 가 실패해도 다음 source 로 넘어간다.**
 *
 *    82cook 이 막힌 날에도 네이버 입력은 처리돼야 하고, remonterrace 가 막힌 날에도
 *    wgang 은 처리돼야 한다. 실패를 감추지는 않는다 — 그 source 만 `failed` 로 남는다.
 *
 * 🔴 한 source 안에서는 순서대로다. `cafeThin` 이 실패하면 그 source 의 `adapt` 는
 *    돌리지 않는다 — 변환되지 않은 것을 변환된 것처럼 다루게 된다.
 */
export async function runSourcePhase(input: {
  plans: readonly SourcePlan[]
  exec: ExecFn
  now: () => string
  onStage?: (plan: StagePlan) => void
}): Promise<SourcePhaseResult> {
  const calls: PhaseResult['calls'] = []
  const outcomes: StageOutcome[] = []
  const sources: SourceOutcome[] = []

  for (const sp of input.plans) {
    let failedAt: ProcessStage | null = null
    for (const stage of sp.stages) {
      if (failedAt !== null) {
        outcomes.push({
          stage: stage.stage, source: sp.source, status: 'skipped', exitCode: null,
          startedAt: input.now(), endedAt: input.now(),
          note: `🟡 앞 단계(${failedAt})가 실패해 이 source 의 남은 단계를 건너뛴다`,
        })
        continue
      }
      input.onStage?.(stage)
      const startedAt = input.now()
      const r = await input.exec(stage)
      calls.push({ stage: stage.stage, source: sp.source, args: [...stage.args] })
      if (!r.ok) failedAt = stage.stage
      outcomes.push({
        stage: stage.stage, source: sp.source,
        status: r.ok ? 'ok' : 'failed', exitCode: r.exitCode,
        startedAt, endedAt: input.now(),
        note: r.ok ? '' : (r.spawnError !== '' ? `🔴 ${r.spawnError}` : '🔴 실패'),
      })
    }
    sources.push(failedAt === null
      ? { source: sp.source, status: 'ok', note: '' }
      : {
        source: sp.source, status: 'failed',
        note: `🔴 ${failedAt} 실패 — 다른 source 는 계속한다 · 다음 회차가 다시 시도한다`,
      })
  }
  return { calls, outcomes, sources }
}

/**
 * ② 공통 국면 — 🔴 앞 단계가 실패하면 뒤 단계로 가지 않는다.
 *
 *    판정이 실패했는데 초안을 만들면 무엇을 근거로 만든 것인지 알 수 없고,
 *    초안이 실패했는데 적재하면 앞 회차의 후보를 이번 회차 것으로 읽게 된다.
 *
 * 🔴 **source 국면이 전부 실패해도 이 국면은 돈다.** 지난 회차가 남긴 미처리 입력은
 *    이번 수집과 무관하게 존재하고, 그것을 비우는 것이 이 러너의 일이다.
 */
/**
 * 🔴 **단계 하나를 돌리기 **직전**에 묻는다** (2026-09-17).
 *
 *    큐 스냅샷은 계획 시점이 아니라 **`draft` 를 돌리기 직전**에 떠야 한다.
 *    계획 시점에 뜨면 그 사이 `judge` 가 도는 시간만큼 낡는다 — 실측으로 `judge` 가
 *    12분 걸린 회차가 있다. 낡은 스냅샷은 **없는 세상**을 근거로 거르는 것이다.
 *
 * 🔴 `ok: false` 면 **그 단계만 건너뛴다.** 뒤 단계를 멈추지 않는다 —
 *    `draft` 를 보류해도 `fill` 은 사람 후보를 적재할 수 있다.
 */
export type StageGate = { ok: true } | { ok: false; reason: string }

export async function runCommonPhase(input: {
  plan: readonly StagePlan[]
  exec: ExecFn
  now: () => string
  onStage?: (plan: StagePlan) => void
  /** 🔴 단계 직전 준비. 실패하면 그 단계를 보류한다 */
  beforeStage?: (plan: StagePlan) => Promise<StageGate>
}): Promise<PhaseResult> {
  const calls: PhaseResult['calls'] = []
  const outcomes: StageOutcome[] = []
  let stopped = false
  for (const stage of input.plan) {
    if (stopped) {
      outcomes.push({
        stage: stage.stage, source: null, status: 'skipped', exitCode: null,
        startedAt: input.now(), endedAt: input.now(),
        note: '🟡 앞 단계가 실패해 돌리지 않는다 — 다음 회차가 처음부터 다시 시도한다',
      })
      continue
    }
    input.onStage?.(stage)
    const gate = input.beforeStage === undefined
      ? ({ ok: true } as StageGate)
      : await input.beforeStage(stage)
    if (!gate.ok) {
      /**
       * 🔴 **보류다. 건너뜀이 아니다.** 입력 파일을 지우지도 완료로 적지도 않으므로
       *    다음 정상 회차가 같은 입력을 그대로 다시 집는다(`planPending` 은 파일만 본다).
       */
      outcomes.push({
        stage: stage.stage, source: null, status: 'skipped', exitCode: null,
        startedAt: input.now(), endedAt: input.now(),
        note: `🟡 ${gate.reason} — 입력을 그대로 두고 다음 회차가 다시 집는다`,
      })
      continue
    }
    const startedAt = input.now()
    const r = await input.exec(stage)
    calls.push({ stage: stage.stage, source: null, args: [...stage.args] })
    if (!r.ok) stopped = true
    outcomes.push({
      stage: stage.stage, source: null,
      status: r.ok ? 'ok' : 'failed', exitCode: r.exitCode,
      startedAt, endedAt: input.now(),
      note: r.ok ? '' : (r.spawnError !== '' ? `🔴 ${r.spawnError}` : '🔴 실패 — 뒤 단계로 가지 않는다'),
    })
  }
  return { calls, outcomes }
}

export type RunStatus = 'running' | 'done' | 'failed'

/** 회차 하나의 기록 — 🔴 관제(`supply:health`)가 읽는다. 재개에는 쓰지 않는다 */
export type ProcessRun = {
  runId: string
  /** 🔴 어느 코드로 돈 회차인가. 읽지 못하면 남기지 않는다 — 없는 것과 틀린 것은 다르다 */
  runtimeSha?: string
  startedAt: string
  status: RunStatus
  completedAt: string | null
  buffer: { usable: number | null; upTo: number; reason: string }
  sources: SourceOutcome[]
  stages: StageOutcome[]
}

/** 🔴 하나라도 실패하면 실패다. 격리는 "다른 것을 계속 돌린다" 이지 "없던 일로 한다" 가 아니다 */
export function runStatusOf(outcomes: readonly StageOutcome[]): RunStatus {
  return outcomes.some((o) => o.status === 'failed') ? 'failed' : 'done'
}

// ─────────────────────────────────────────────────────────
// 정합
// ─────────────────────────────────────────────────────────

export type RunProblem = string

/**
 * 끝나고 무엇이 어긋났는가 — 🔴 **Post 가 늘었으면 그것만으로 사고다.**
 * 이 러너는 발행하지 않는다. 발행은 auto-publish 의 일이다.
 */
export function verifyRun(input: {
  postBefore: number
  postAfter: number
  stockBefore: number
  stockAfter: number
  target?: number
  queuedMachine: number
  queuedNonMachine: number
  machineBefore: number
  machineAfter: number
}): { ok: boolean; problems: RunProblem[] } {
  const target = input.target ?? STOCK_BANDS.target
  const problems: RunProblem[] = []

  if (input.postAfter !== input.postBefore) {
    problems.push(`🔴 Post 가 ${input.postBefore} → ${input.postAfter} 로 변했다 — 이 러너는 발행하지 않는다`)
  }
  if (input.stockAfter < input.stockBefore) {
    problems.push(`🔴 재고가 줄었다 ${input.stockBefore} → ${input.stockAfter}`)
  }
  if (input.stockAfter > target) {
    problems.push(`🔴 버퍼 목표 ${target}건을 넘겨 적재했다 (${input.stockAfter}건)`)
  }
  if (input.queuedNonMachine > 0) {
    problems.push(`🔴 기계가 아닌 행이 ${input.queuedNonMachine}건 적재됐다`)
  }
  const grew = input.machineAfter - input.machineBefore
  if (grew !== input.queuedMachine) {
    problems.push(`🔴 적재했다는 수(${input.queuedMachine})와 늘어난 기계 재고(${grew})가 다르다`)
  }
  return { ok: problems.length === 0, problems }
}

/** 화면 한 줄 요약 — 🔴 못 센 값은 0 이 아니라 null 로 두고 '—' 로 찍는다 */
export function fmtCount(n: number | null): string {
  return n === null ? '—' : String(n)
}
