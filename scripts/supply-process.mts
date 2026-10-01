#!/usr/bin/env tsx
/**
 * 공급 처리(drain) 러너 — 🔴 **수집하지 않는다. 이미 생긴 입력만 비운다** (§4-AU)
 *
 * 수집은 source 마다 **독립 job** 이 한다.
 *
 *   82cook                  `com.soransoran.supply-collect-82cook-thin` (얇은 상세)
 *   navercafe:remonterrace  `com.soransoran.navercafe-collect-remonterrace-multi`
 *   navercafe:wgang         `com.soransoran.navercafe-collect-wgang-multi`
 *
 * 이 러너는 그중 **누가 성공했는지 묻지 않는다.** 디스크에 남은 미처리 입력을
 * source 별로 훑어 변환 → 판정 → 초안 → 적재까지 흘려보낼 뿐이다.
 *
 * 🔴 **이 러너는 발행하지 않는다.** Post · persona 배정 · ActivityLog 를 만들지 않는다.
 *    발행은 auto-publish 가 그 단계의 예약 슬롯에 한다 (`PROFILES` 가 정본).
 *
 * 🔴 **새 판정도 새 생성도 여기 없다.** 기존 스크립트를 순서대로 부를 뿐이다 —
 *    저장 계약 · 안전성 게이트 · dedup 은 그 안에 이미 있다.
 *
 *   인자 없음   무엇이 밀려 있는지 읽고 계획만 찍는다 — 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0
 *   --live      실제 실행. 🔴 SORAN_SUPPLY_PROCESS_ENABLED=true 가 함께 있어야 한다
 *
 *   미처리 입력이 없으면 --live 라도 아무것도 하지 않는다 (정상 no-op).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'


import type { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  PROCESS_KILL_SWITCH_ENV, LOCK_FILE, LOCK_TTL_MS, SUPPLY_SOURCES,
  fmtCount, hasWork, judgeJitDemand, judgeProcessRun,
  mayWriteRunState, planBoundedCommonPhase, planCarryOverFill, planCommonPhase, planPending, planSourcePhase,
  ledgerRunIdOf, type WorksetGate,
  runCommonPhase, runSourcePhase, runFileName, runStatusOf, verifyRun,
  type LockView, type ProcessRun, type ProcessStage, type StagePlan, type StageGate,
} from '../src/lib/supply-process'
/**
 * 🔴 **잠금은 검증된 계약 하나만 쓴다** (2026-09-11).
 *    `wx` 획득 · token 대조 해제 · 자동 회수 없음. 여기서 새 프로토콜을 만들지 않는다.
 */
import { acquireLock, lockAnomaly, releaseLock, type LockHandle } from './lib/collect-lock.mjs'
/**
 * 🔴 **생성 전 큐 스냅샷** (2026-09-17) — 판정 규칙은 여기서 만들지 않는다.
 *    정본은 `micro-seed-supply-autofill.hasPendingSibling` · `baseArticleId` 이고,
 *    스냅샷은 그 정본이 만든 집합을 파일로 옮기기만 한다.
 */
import { buildQueueSnapshot, pendingSourceKeysOf, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
/** 🔴 작업 묶음 정본 — 모양·상한·선택 규칙은 전부 저기 하나에 있다 */
import {
  attemptedOutcomes, concludedSourceKeys, humanDecisionIndexOf, judgeStageBudget, queuedSourceKeysOf, resolveWorksetLimit,
  sourceIdentityOf, sourceKeyOf, type HumanDecisionIndex,
  selectWorkset, worksetAxisOf, worksetEligibility, worksetFileName,
  WORKSET_DROP_LABEL, type PriorOutcome, type SourceKeySet, type WorksetRow,
  OPPORTUNITY_KIND, OPPORTUNITY_VERSION, opportunitiesFileName, preGenerationRelease,
} from '../src/lib/supply-workset'
/** 🔴 원천 기회 판정 정본 — 유료 생성 전 · 예정 슬롯 기준 */
import {
  buildSourceEvidence, judgeSlotRelease,
  type SlotReleaseVerdict, type SourceEvidenceRecord,
} from '../src/lib/source-slot-release'
import { evidenceMaterialFor, readListObservations, type ListObservationIndex } from './lib/source-list-observations.mjs'
import {
  inputHashOf, mergeJudgeRows, PROMPT_VERSION, RULE_VERSION,
} from '../src/lib/micro-seed-auto-judge'
import { ARTIFACT_VERSION } from '../src/lib/content-core/artifact'
/** 🔴 생성 계약 정본 — 생성 러너와 **같은 함수**를 쓴다 */
import { currentContractBase } from './lib/generation-contract.mjs'
import { readPriorOutcomes } from './lib/prior-outcomes.mjs'
import { RUN_AT_ENV, runClockFrom } from './lib/run-clock.mjs'
/**
 * 🔴 **적재 재시도 · 이월** (2026-09-27) — 판정은 lib 하나, 읽기는 scripts/lib 하나다.
 *    2026-09-27 14:15 회차의 `fill` 이 `Can't reach database server` 로 죽고 채택 2건이 버려졌다.
 */
import {
  CARRY_REJECT_LABEL, buildFillRecord, describeSkips, resolveFillArgs, runFillWithRetry,
  type CarryRejectCode,
} from '../src/lib/supply-fill-retry'
import { planCarryOver } from './lib/fill-carry-over.mjs'

/**
 * 🔴 **이 회차의 시각 하나** (2026-09-23 마스터 지적). 여기서 만들고,
 *    계약·묶음·자식 프로세스가 **전부 이 값**을 쓴다. 두 번 만들지 않는다.
 * 🔴 **회차 id · 재고 판정 · 화자 여력 파일(`writtenAt`) · 자식의 여력 검증 시각까지 이 값이다** (2026-09-26).
 *    앞판은 `main` 이 `new Date()` 를 다시 만들고, 화자 여력도 제 시계로 적었다 —
 *    KST 자정을 사이에 두면 회차 id 의 날짜 · 지평 첫날 · 자식의 날짜가 서로 달랐다.
 * 🔴 읽는 규칙은 자식과 **같은 함수**(`runClockFrom`)다 — 비어 있으면 자기 시계(launchd 정기 회차),
 *    모양이 틀리면 던진다. 검사는 이 값을 넣어 KST 자정 · 생일 경계를 실제로 재현한다.
 */
export const RUN_CLOCK = runClockFrom(process.env)
export const RUN_AT = RUN_CLOCK.at
import {
  SPEAKER_LOAD_FILE, draftSpeakerOf, type SpeakerLoadFile,
} from '../src/lib/content-core/speaker-load-file'
import { planOpenDays, wipCountsBySpeaker } from '../src/lib/content-core/speaker-availability'
/** 🔴 말투 근거가 선 화자 — 생성 러너와 **같은 함수**로 읽는다(파일까지 · DB 0) */
import { loadVoice } from './lib/voice-runtime.mjs'
import { kstDateString } from '../src/lib/release-canary'
import { availablePersonasAt } from '../src/lib/supply-capacity-forecast'
import { horizonStart, nextSlotAnchor, type ScaleProfile } from '../src/lib/scale-profile'
import type { ResolvedScale } from '../src/lib/scale-runtime'
/** 🔴 재고 분류 정본 — 발행 러너와 **같은 조립 · 같은 판정**을 나눠 읽는다 */
import {
  loadStockClassification, describeStockClassification, jitCoverageOf, upcomingSlots, type StockClassification,
} from './lib/publishable-stock.mjs'

/**
 * 🔴 **화자 여력을 며칠 앞까지 보는가.** 발행 쪽 최소 간격(d3 은 2일)보다 넉넉해야
 *    "이 화자는 이 지평에서 몇 편까지 받을 수 있나" 가 성립한다.
 */
const SPEAKER_LOAD_HORIZON_DAYS = 7
import type { ContractBase } from '../src/lib/content-core/pipeline'
/** 🔴 판정 모델 이름 — 판정 러너가 쓰는 그 값이다 */
import { JUDGE_MODEL as JUDGE_MODEL_NAME } from './micro-seed-auto-judge.mjs'
import { readStock } from '../src/lib/micro-seed-supply-autofill'
import { installFromEnv, describeScale } from '../src/lib/scale-runtime'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'

/** 🔴 정본은 lib 하나다 — 여기서 문자열을 다시 쓰지 않는다 */
const DATA_DIR = DATA_DIR_NAME
const argv = process.argv.slice(2)
/**
 * 🔴 **이번 회차가 끝까지 보낼 원천 수.** 기본은 정본 값(10)이다 —
 *    올리면 유료 요청도 그만큼 는다(judge N · draft 3N · 전체 4N).
 * 🔴 천장(`WORKSET_MAX_LIMIT`)을 넘기면 `-1` 이고 `judgeStageBudget` 이 실행 전에 멈춘다 — 무제한 호출 없음.
 */
const WORKSET_LIMIT = resolveWorksetLimit(process.argv.slice(2))

/**
 * 🔴 상세 파일을 **판정기와 같은 정규화**로 읽는다 (`mergeJudgeRows`).
 *    `detail` 의 `access` 와 `raw-detail` 의 `accessStatus` 를 정본이 맞춘다 —
 *    여기서 손으로 파싱하면 raw 행이 정상 원천을 덮어쓴다.
 * 🔴 **파싱에 실패하면 `null`** — 부르는 쪽이 fail-closed 한다.
 */
export function worksetRows(
  paths: readonly string[],
  /** 🔴 목록 관측(반복 관측 · 원천 상대 표본) — 없으면 증거 재료 없음(모름) */
  listIndex: ListObservationIndex | null = null,
  at: Date = RUN_AT,
): WorksetRow[] | null {
  const entries: { kind: 'detail' | 'raw-detail'; row: Record<string, unknown> }[] = []
  /**
   * 증거 칸 — 🔴 판정 입력에는 없는 값이라 따로 모은다. **시각만** 모은다(2026-09-30 Lane B) —
   *    반응(댓글 · 조회 · 자리)은 목록 관측이 정본이다(`evidenceMaterialFor` 가 `sourceListedAt` 으로 찾는다).
   *    앞판은 상세 행의 복사본(`commentCount` · `sourceViewCount` …)을 여기서 읽었다 — 두 번째 권위를 지웠다.
   */
  /** 🔴 원천 열쇠(사이트, id) → 시각 — 같은 번호 다른 사이트의 시각이 섞이지 않는다(P0-B · 앞판은 id 하나로 모았다) */
  const meta = new Map<string, { site: string; posted: string; listed: string; captured: string }>()
  const S2 = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  for (const f of paths) {
    const kind: 'detail' | 'raw-detail' = f.endsWith('.raw-detail.jsonl') ? 'raw-detail' : 'detail'
    let raw: string
    try { raw = readFileSync(f, 'utf-8') } catch { return null }
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t === '') continue
      let r: Record<string, unknown>
      // 🔴 한 줄이라도 깨져 있으면 조용히 건너뛰지 않는다 — 고를 대상이 달라진다
      try { r = JSON.parse(t) as Record<string, unknown> } catch { return null }
      entries.push({ kind, row: r })
      const key = sourceIdentityOf(r.sourceSite, r.sourceArticleId)
      // 🔴 사이트 · id 를 모르는 행은 어느 원천의 시각도 아니다 — 판정 병합(`mergeJudgeRows`)도 같은 행을 버린다
      if (key === null) continue
      const prev = meta.get(key)
      meta.set(key, {
        site: S2(r.sourceSite),
        posted: S2(r.sourcePostedAt) !== '' ? S2(r.sourcePostedAt) : prev?.posted ?? '',
        listed: S2(r.sourceListedAt) !== '' ? S2(r.sourceListedAt) : prev?.listed ?? '',
        captured: S2(r.sourceCapturedAt) !== '' ? S2(r.sourceCapturedAt) : prev?.captured ?? '',
      })
    }
  }
  return mergeJudgeRows(entries).map((input): WorksetRow => {
    const id = String(input.sourceArticleId ?? '')
    const site = String(input.sourceSite ?? '')
    // 🔴 `mergeJudgeRows` 는 사이트 · id 가 둘 다 있는 행만 낸다 — 같은 열쇠로 찾는다
    const m = meta.get(sourceKeyOf(site, id))
    const material = listIndex === null || site === '' ? null : evidenceMaterialFor(listIndex, {
      sourceKey: site, articleId: id, postedAt: m?.posted === '' ? null : m?.posted ?? null,
      listedAt: m?.listed === '' ? null : m?.listed ?? null,
      at,
    })
    /**
     * 🔴 **생성 전 원천 증거** — 판정기가 아직 돌지 않아 참여 동력은 없다(판정이 `pending` 으로 본다).
     *    게시 · 목록 · 수집 시각을 서로 메우지 않는다 · 반응이 없으면 null.
     */
    const evidence: SourceEvidenceRecord | null = m === undefined ? null : buildSourceEvidence({
      postedAt: m.posted, listedAt: m.listed, capturedAt: m.captured,
      sourceSite: site, sourceArticleId: id, dedupKey: `${site}|${id}`,
      // 🔴 목록 관측이 없으면(파일 없음 · 열쇠 불일치) 반응을 모른다 — 상세 행 수로 메우지 않는다
      response: material?.response ?? null,
      observations: material?.observations ?? [],
      sourceStats: material?.sourceStats ?? null,
      participationDriver: null,
    })
    return {
      sourceArticleId: id, sourceSite: site,
      commentCount: Number(input.commentCount ?? 0),
      sourcePostedAt: m?.posted ?? '', sourceListedAt: m?.listed ?? '',
      input, evidence,
    }
  })
}



/**
 * 🔴 **앞 회차가 끝낸 원천** — 판정 파일과 artifact 에서 모은다. 새 파일을 만들지 않는다.
 *
 * 🔴 **합집합이 아니다.** 지금 입력 지문·지금 판에 해당하는 것만 보고, 원천마다
 *    **가장 최신** 결과 하나로 판정한다. 파일 이름(회차 시각)이 곧 순서다.
 */
/** 🔴 지난 결과를 한 번만 읽어 **끝난 것**과 **이미 본 것**을 함께 낸다 */
function priorState(rows: readonly WorksetRow[], base: ContractBase): {
  concluded: Set<string>; attempted: Map<string, PriorOutcome>
} {
  const outcomes = readPriorOutcomes({
    dataDir: DATA_DIR,
    // 🔴 원천 열쇠 → 지금 입력 지문. 사이트 칸이 없는 옛 기록은 `resolveSourceOutcome` 이 지문으로만 붙인다
    hashOf: new Map(rows.map((r) => [sourceKeyOf(r.sourceSite, r.sourceArticleId), inputHashOf(r.input)])),
    canon: {
      ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION, judgeModel: JUDGE_MODEL_NAME,
    },
    base, artifactVersion: ARTIFACT_VERSION,
  })
  return { concluded: concludedSourceKeys(outcomes), attempted: attemptedOutcomes(outcomes) }
}

/** 🔴 사람이 이미 판정한 원천 — 판정기와 **같은 파일들 · 같은 색인**(`humanDecisionIndexOf`)을 쓴다 */
function humanDecided(): HumanDecisionIndex {
  const rows: Record<string, unknown>[] = []
  for (const pre of ['seed-originality-source-approvals-', 'srn-approvals', 'raw-originality-approvals-']) {
    for (const f of readdirSync(DATA_DIR).filter((x) => x.startsWith(pre) && x.endsWith('.json'))) {
      try {
        const j = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as Record<string, unknown>
        for (const r of Array.isArray(j.decisions) ? j.decisions : []) {
          if (r !== null && typeof r === 'object') rows.push(r as Record<string, unknown>)
        }
      } catch { /* 못 읽는 파일은 건너뛴다 — 판정기와 같은 태도다 */ }
    }
  }
  return humanDecisionIndexOf(rows)
}

const LIVE = argv.includes('--live')
/**
 * 🔴 **dry-run 전용 모의 재고.** 재고가 차 있는 날에도 "부족하면 무엇을 할지" 를 볼 수 있어야 한다.
 *    --live 와 함께 쓰면 거부한다 — 모의한 수를 근거로 DB 에 쓰지 않는다.
 */
const SIM = ((): number | null => {
  const hit = argv.find((a) => a.startsWith('--simulate-stock='))
  if (hit === undefined) return null
  const n = Number(hit.slice('--simulate-stock='.length))
  return Number.isInteger(n) && n >= 0 ? n : null
})()
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

/** 단계 → 실제 스크립트. 🔴 여기 없는 것은 이 러너가 부르지 않는다 — **수집 스크립트는 없다** */
export const STAGE_SCRIPT: Record<ProcessStage, string> = {
  cafeThin: 'scripts/micro-seed-navercafe-thin.mts',
  adapt: 'scripts/micro-seed-82cook-thin-adapt.mts',
  judge: 'scripts/micro-seed-auto-judge.mts',
  draft: 'scripts/micro-seed-auto-draft.mts',
  fill: 'scripts/micro-seed-supply-autofill.mts',
}

/**
 * 🔴 **화자 여력을 DB 에서 읽어 파일로 적는다** — 생성 러너가 읽는 유일한 통로다.
 *
 *    `openDays`  지평 안에서 그 화자가 **배정 가능한 날 수**.
 *                발행 정본(`availablePersonasAt`)이 판정한다 — 여기서 규칙을 다시 적지 않는다.
 *    `readyCount` 그 화자가 **들고 있는 글(WIP)** 수 — 공용 분류 `personaWipIds` 다.
 *                🔴 이미 들고 있으면 더 만들어도 같은 날 못 나간다.
 *
 * 🔴 **값을 만드는 곳과 적는 곳을 나눈다** (2026-09-22).
 *    적는 함수 안에만 있으면 read-only 로 확인할 방법이 없다 — 값을 돌려주는 함수를 따로 둔다.
 */
/**
 * 🔴 **공급은 capacity 로 준비하고, 발행은 release 로 제한한다** (2026-09-26).
 *
 *    앞판은 지평의 하루하루를 **release** 프로필로 채웠다. release=d1 이면 7일에 자리가 7개뿐이고,
 *    사람 검토를 기다리는 기계 초안 8건이 그중 6자리를 차지해 **여력 있는 화자 1명** 이 남았다 —
 *    SEED 6건이 초안 시도 2건으로 줄었다(실측 2026-09-26). 발행이 d1 이어도 공급이 d1 로
 *    맞춰지면 d1 을 넘는 단계는 **재고가 영영 차지 않아** 준비도 판정을 받을 수 없다.
 *    🔴 이제 **capacity** 프로필로 센다. 발행 러너 · 슬롯 게이트는 그대로 release 다 — 여기서 건드리지 않는다.
 *    🔴 canary · window 는 **발행 허가**다. 공급 지평에는 쓰지 않는다 — release 천장은 capacity 를 넘지 않는다.
 *
 * 🔴 **WIP 는 공용 분류에서 받는다** (2026-09-26). 앞판은 여기서 selector 를 따로 불러
 *    `HUMAN_REVIEW_REQUIRED` 를 직접 세었다 — 발행 러너와 다른 조립(editDiff 없음 · 자동 READY 닫힘 가정)이었다.
 *    🔴 검토 대기는 **WIP 에 남는다**(같은 화자로 또 만들지 않는다). 발행 가능 재고로는 세지 않는다.
 *    🔴 **WIP 여부는 칸마다 정해져 있다**(`STOCK_BUCKET_META`) — TTL 만료 · 영구 배정 예외 · 깨진 복구 ·
 *       스스로 풀리지 않는 신선도 실패는 화자를 **영구 점유하지 않는다**. 시간성 유예(WEEKLY_CAP · TOO_SOON)는 점유한다.
 *    🔴 **옛 품질 계약의 기계 초안(`qualityContractMismatch`)도 점유하지 않는다** (2026-09-28) — 자동 경로가
 *       영영 없는 글이 지금 계약의 생산 자리를 막으면 계약을 올린 날 새 계약은 몇 자리로만 만든다.
 *       그 수는 따로 적는다(`wip.qualityContractMismatch` — WIP 합계에는 들어가지 않는다).
 */
export async function buildSpeakerLoad(
  prisma: PrismaClient, runId: string,
  opts: {
    env: Readonly<Record<string, string | undefined>>; now: Date; scale: ResolvedScale
    /**
     * 🔴 **하루 자리를 받을 수 있는 화자(말투 근거가 선 사람)** — PR2 KEEP. `null`·생략이면 전원(앞판과 같다).
     *    정기 경로(`writeSpeakerLoad`)는 생성 러너와 같은 `loadVoice` 로 채운다.
     */
    slotEligible?: ReadonlySet<string> | null
  },
): Promise<SpeakerLoadFile & {
  stageByDate: readonly { date: string; stage: string }[]
  planningStage: string
  releaseStage: string
  wip: { total: number; humanReviewPending: number; publishableNow: number; qualityContractMismatch: number }
  /** 🔴 원천 가치가 사라진 WIP(정본 판정 만료 사유) — 화자 칸을 막지 않는다 · 화자 미상 · 말투 필터 */
  slots: { releasedExpired: number; unattributed: number; voiceFiltered: boolean; slotEligibleCount: number | null }
}> {
  const { loaded, classification } = await loadStockClassification(prisma, opts.env, opts.now)
  const planning = supplyPlanningProfile(opts.scale)
  const wip = new Set(classification.personaWipIds)
  const byId = new Map(loaded.allRows.map((r) => [r.id, r]))
  const speakerOf = (id: string): string | null => {
    const r = byId.get(id)
    if (r === undefined) return null
    return (r.matchedPersonaId === null ? null : loaded.codeOfPersonaId.get(r.matchedPersonaId) ?? null)
      ?? draftSpeakerOf(r.gateResults)
  }
  /**
   * 🔴 **칸에서 뺄 행 — 원천 가치가 이미 사라진 WIP** (2026-09-30). 정본 `judgeSlotRelease` 가 지금 시각에
   *    만료 사유(나이 · 증거 모름)를 낸 행은 자동으로는 영영 못 나간다 — 그 화자의 칸을 막지 않는다.
   */
  const expiresNow = (id: string): boolean => {
    const r = byId.get(id)
    if (r === undefined) return false
    return judgeSlotRelease({
      gateResults: r.gateResults, slotAt: opts.now, now: opts.now,
      hardGates: { ok: true, codes: [] }, assignment: 'pending', tieBreak: id,
    }).expires
  }
  const wipBy = wipCountsBySpeaker({ wip: [...wip].map((id) => ({ id, code: speakerOf(id) })), releasesSlot: expiresNow })
  const eligible = opts.slotEligible ?? null
  /**
   * 🔴 **이력은 배정기(`personaForMatchOf`)가 보는 것과 같다** — 큐의 `matchedAt`.
   *    발행 트랜잭션이 배정할 때 쓰는 근거다. 여기서 다른 표(ActivityLog)를 보면 두 계산이 갈린다.
   */
  const logs = await prisma.originalPostApprovalQueue.findMany({
    where: { matchedAt: { not: null } },
    select: { matchedAt: true, matchedPersona: { select: { code: true } } },
  })
  const history = loaded.personas.map((p) => ({
    code: String(p.code),
    matchedAts: logs.filter((l) => l.matchedPersona?.code === p.code && l.matchedAt !== null)
      .map((l) => l.matchedAt as Date),
  }))
  const horizonDays = SPEAKER_LOAD_HORIZON_DAYS
  const start = horizonStart(opts.now)
  const days = Array.from({ length: horizonDays }, (_, i) => new Date(start.getTime() + i * 86_400_000))
  /** 🔴 **정본 하나가 하루하루를 채워 본다.** 고른 날을 이력에 쌓아 다음 날 판정이 그 사람을 뺀다 */
  const plan = planOpenDays({
    days,
    profileOf: () => ({
      dailyTarget: planning.profile.dailyTarget,
      postsPerWeek: planning.profile.postsPerWeek,
      minDaysBetween: planning.profile.minDaysBetween,
    }),
    history,
    availableAt: (h, at, caps) => availablePersonasAt(
      h.map((x) => ({ code: x.code, matchedAts: [...x.matchedAts] })), at, caps),
    dateLabel: (at) => kstDateString(at),
    // 🔴 말투 없는 화자는 기계 초안을 받지 못한다 — 하루 자리를 차지하지 않게 뺀다
    ...(eligible === null ? {} : { canTakeSlot: (code: string) => eligible.has(code) }),
  })
  const byCode: Record<string, { openDays: number; readyCount: number }> = {}
  for (const p of loaded.personas) {
    const code = String(p.code)
    byCode[code] = {
      openDays: plan.openDays.get(code) ?? 0,
      readyCount: wipBy.byCode.get(code) ?? 0,
    }
  }
  return {
    // 🔴 회차 시각으로 적는다 — 자식이 같은 시각으로 검증한다
    writtenAt: opts.now.toISOString(), runId, horizonDays, byCode,
    byDate: plan.byDate,
    /** 🔴 어느 눈금으로 셌는지 남긴다 — 사람이 "이 계획은 capacity d5 기준이다" 를 알 수 있게 */
    stageByDate: days.map((at) => ({ date: kstDateString(at), stage: planning.stage })),
    planningStage: planning.stage,
    releaseStage: opts.scale.releaseStage,
    wip: {
      total: wip.size,
      humanReviewPending: classification.counts.humanReviewPending,
      publishableNow: classification.counts.publishableNow,
      /** 🔴 WIP 가 **아니다** — 옛 품질 계약이라 WIP 에서 빠진 수를 보이려고 적는다 */
      qualityContractMismatch: classification.counts.qualityContractMismatch,
    },
    slots: {
      releasedExpired: wipBy.released.length, unattributed: wipBy.unattributed,
      voiceFiltered: eligible !== null, slotEligibleCount: eligible === null ? null : eligible.size,
    },
  }
}

/**
 * 🔴 **공급 계획의 눈금은 capacity 다** — 이 한 곳에서 정한다. release 는 발행 쪽 눈금이다.
 *    새 단계·새 숫자를 만들지 않는다 — scale 정본(`resolveScale`)이 낸 값을 그대로 읽는다.
 */
export function supplyPlanningProfile(scale: ResolvedScale): { stage: string; profile: ScaleProfile } {
  return { stage: scale.capacityStage, profile: scale.capacityProfile }
}

/** 🔴 값을 만들어 파일로 적는다 — 만드는 것은 위 함수 하나다 */
export async function writeSpeakerLoad(
  prisma: PrismaClient, runId: string, scale: ResolvedScale,
): Promise<Awaited<ReturnType<typeof buildSpeakerLoad>>> {
  /**
   * 🔴 말투 근거가 선 화자 — 생성 러너가 후보로 쓰는 그 집합(`loadVoice().candidates`). 정본을 못 읽으면 좁히지 않는다
   *    (그 회차는 생성 러너가 provider 호출 전에 멈춘다).
   */
  const voice = loadVoice(RUN_AT)
  const slotEligible = voice.blockAllCode === null && voice.candidates.length > 0
    ? new Set(voice.candidates.map((c) => c.code)) : null
  const payload = await buildSpeakerLoad(prisma, runId, { env: process.env, now: RUN_AT, scale, slotEligible })
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(join(DATA_DIR, SPEAKER_LOAD_FILE), JSON.stringify(payload, null, 2))
  return payload
}

const runIdOf = (d: Date): string =>
  `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`

/** 🔴 임시로 쓰고 rename 한다 — 반쯤 쓰인 기록을 관제가 읽지 않게 */
function writeAtomic(path: string, body: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, body, 'utf-8')
  renameSync(tmp, path)
}

/**
 * 하위 스크립트를 그대로 돌린다 — stdout 은 감추지 않는다.
 *
 * 🔴 **error 를 받지 않으면 Promise 가 영원히 안 끝난다.** 실행 파일이 없거나
 *    프로세스가 뜨지 못하면 close 가 오지 않는다 — 그러면 lock 을 쥔 채 매달린다.
 */
export function run(
  script: string, args: readonly string[], env?: Readonly<Record<string, string>>,
): Promise<{ code: number | null; out: string; spawnError: string }> {
  /**
   * 🔴 **회차 시각 하나를 자식에게 넘긴다** (2026-09-23 마스터 지적).
   *    앞판은 부모와 자식이 각자 `new Date()` 를 만들었다 — KST 자정·생일 경계에서
   *    **다른 날**을 보고 계약이 갈렸다.
   */
  const withClock = { ...(env ?? {}), [RUN_AT_ENV]: RUN_AT.toISOString() }
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { code: number | null; out: string; spawnError: string }): void => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let out = ''
    try {
      const p = spawn('npx', ['tsx', script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        // 🔴 단계 env 는 **이 자식에게만** 실린다 — 운영 env 파일은 바뀌지 않는다
        env: { ...process.env, ...withClock },
      })
      p.stdout.on('data', (b: Buffer) => { const t = b.toString(); out += t; process.stdout.write(t) })
      p.stderr.on('data', (b: Buffer) => { const t = b.toString(); out += t; process.stderr.write(t) })
      p.on('error', (e: Error) => {
        const msg = `프로세스를 시작하지 못했다 — ${e.message}`
        console.error(`   🔴 ${msg}`)
        done({ code: null, out, spawnError: msg })
      })
      p.on('close', (code) => { done({ code, out, spawnError: '' }) })
    } catch (e) {
      const msg = `spawn 이 던졌다 — ${e instanceof Error ? e.message : String(e)}`
      console.error(`   🔴 ${msg}`)
      done({ code: null, out, spawnError: msg })
    }
  })
}

function dataFiles(): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).sort()
}

/** 🔴 화면에 찍힌 수를 되읽는다. 못 찾으면 0 이 아니라 null 이다 — 모르는 것을 안다고 하지 않는다 */
function num(out: string, re: RegExp): number | null {
  const m = re.exec(out)
  return m === null ? null : Number(m[1])
}

type QueueRow = {
  status: string; createdPostId: string | null
  promptVersion: string; model: string; gateResults: unknown
  rawContent: { sourceSite: string } | null
}

/**
 * 🔴 **두 수를 섞지 않는다** (2026-09-26).
 *
 *    `profiled`  형식(profile)이 맞는 미발행 행 — **버퍼 천장과 적재 정합**에만 쓴다.
 *                사람 검토를 기다리는 기계 초안도 여기 들어간다. 발행 가능 재고가 **아니다**.
 *    `classification` 발행 러너와 같은 분류 — `publishableNow` 가 지금 낼 수 있는 재고다.
 *
 *    앞판은 `profiled` 를 "발행 러너가 먹을 수 있는 것" 이라 찍었다. 같은 DB 에서 발행 러너는
 *    0건이었다(실측 2026-09-26: 공급 9 · 발행 0). 그 문구가 거짓 지표였다.
 *    🔴 분류를 읽지 못하면 `null` 이다 — 0 으로 적지 않는다.
 */
export type SupplySnapshot = {
  profiled: number; human: number; machine: number; post: number; legacy: number
  classification: StockClassification | null
  classifyError: string | null
  /**
   * 🔴 **JIT 수요 재료** — 다가오는 슬롯 수와 그 슬롯에 eligible 로 남을 READY 가 덮은 수(정본 판정 · 슬롯 시각).
   *    분류를 못 읽으면 `null` 이다(모름 → 파일 단계만).
   */
  jit: { slots: number; readyFilled: number; publishedToday: number } | null
}

export async function snapshot(
  prisma: PrismaClient,
  opts: { env: Readonly<Record<string, string | undefined>>; now: Date },
): Promise<SupplySnapshot> {
  const rows: QueueRow[] = await prisma.originalPostApprovalQueue.findMany({
    select: {
      status: true, createdPostId: true, promptVersion: true, model: true,
      gateResults: true, rawContent: { select: { sourceSite: true } },
    },
  })
  const mapped = rows.map((r) => ({
    status: r.status, createdPostId: r.createdPostId,
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
  }))
  const st = readStock(mapped)
  const liveRows = mapped.filter((r) =>
    (r.status === 'APPROVED' || r.status === 'EDITED')
    && (r.createdPostId === null || r.createdPostId === ''))
  let classification: StockClassification | null = null
  let classifyError: string | null = null
  let jit: SupplySnapshot['jit'] = null
  try {
    const view = await loadStockClassification(prisma, opts.env, opts.now)
    classification = view.classification
    // 🔴 관제(`supply:health`)와 같은 함수 — 수요를 두 곳에서 따로 세지 않는다
    jit = { ...jitCoverageOf(view, opts.now), publishedToday: view.loaded.publishedToday }
  } catch (e) {
    classifyError = e instanceof Error ? e.message : String(e)
  }
  return {
    profiled: st.usable, human: st.human, machine: st.machine,
    post: await prisma.post.count(),
    // 🔴 legacy 는 세기만 한다. 후보에도 재고에도 발행 대상에도 넣지 않는다
    legacy: liveRows.length - st.usable,
    classification, classifyError, jit,
  }
}

/**
 * 🔴 **내 lock 은 내가 푼다 — 모든 경로에서.**
 *    `finally` 로 풀고, 그래도 빠져나가는 경로(신호·예외 밖)를 위해 `exit` 훅도 건다.
 *    `releaseLock` 은 **내 token 일 때만** 지우므로 두 번 불려도 남의 락을 건드리지 않는다.
 */
let lockHandle: LockHandle | null = null
/** 🔴 prisma 는 ③에서 만들어진다 — 만들어졌을 때만 끊는다 */
const teardown: { disconnect: (() => Promise<void>) | null } = { disconnect: null }
function releaseHeldLock(): void {
  if (lockHandle === null) return
  const r = releaseLock(lockHandle)
  lockHandle = null
  // 🔴 내 것이 아니거나 이미 없으면 **지우지 않는다.** 그 사실을 화면에 남긴다
  if (r !== 'RELEASED') console.error(`   🟡 lock 해제 — ${r} (남의 락은 건드리지 않는다)`)
}
process.on('exit', releaseHeldLock)

async function main(): Promise<number> {
  await loadEnvLocal()
  // 🔴 `loadEnvLocal()` **뒤에** 설치한다 — import 시점에 읽으면 .env.local 이 반영되지 않는다
  const scale = installFromEnv(process.env)

  const killOpen = S(process.env[PROCESS_KILL_SWITCH_ENV]) === 'true'
  // 🔴 회차 시각은 하나다 — 여기서 다시 만들지 않는다
  const now = RUN_AT
  const runId = runIdOf(now)

  console.log(`\n══ 공급 처리(drain) — ${LIVE ? '🔴 live' : 'dry-run (네트워크 0 · LLM 0 · DB write 0)'} ══\n`)
  console.log(`  runId ${runId}`)
  console.log(`  규모 설정 ${describeScale(scale)}`)
  for (const n of scale.notes) console.log(`     · ${n}`)
  console.log('  🔴 이 러너는 **수집하지 않는다** — 수집은 source 마다 독립 job 이 한다')
  console.log('  🔴 공급 수요 = 다가오는 슬롯(오늘 남은 + 다음 증명일 전체) − 그 슬롯에 eligible 로 남을 READY (JIT)'
    + ' · 700 · ×14 재고 목표 없음')
  console.log('  순서 source 별 (얇은 변환 → 검수용 변환) → 공통 (판정 → 초안 → 보충)')
  console.log('  🔴 발행 0 — Post · persona 배정 · ActivityLog 를 만들지 않는다')
  console.log(`  스위치  ${PROCESS_KILL_SWITCH_ENV}=${killOpen ? 'true' : '없음'}\n`)

  const canWrite = mayWriteRunState({ live: LIVE, killOpen })
  if (canWrite && !existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const lockPath = join(DATA_DIR, LOCK_FILE)

  /**
   * ── ① lock — 🔴 **획득은 `wx` 한 번, 해제는 내 token 대조 삭제 하나뿐** ──
   *
   *    자동 stale 회수를 하지 않는다. 뺏는 순간 관측→조작 창이 열리고
   *    그 창이 두 회차를 동시에 들여보낸다(2026-09-09 PR #483 결론).
   *
   * 🔴 **dry-run 은 잡지 않고 관측만 한다.** 계획만 보는 실행이 잠금 파일을 만들면
   *    "파일 write 0" 이 거짓말이 된다.
   */
  let lockView: LockView = 'free'
  if (!canWrite) {
    const anomaly = lockAnomaly(lockPath, now.getTime(), LOCK_TTL_MS)
    lockView = anomaly !== null ? 'stale-held' : existsSync(lockPath) ? 'held' : 'free'
    console.log(`① lock  🟡 관측만 한다 (게이트가 닫혀 있다) — ${lockView}`)
  } else {
    const acq = acquireLock(lockPath, now.getTime(), LOCK_TTL_MS)
    if (acq.ok) {
      lockHandle = acq.handle
      console.log('① lock  🟢 잡았다')
    } else {
      lockView = acq.kind === 'HELD' ? 'held' : acq.kind === 'STALE_HELD' ? 'stale-held' : 'unreadable'
      console.log(`① lock  🔴 잡지 못했다 — ${acq.reason}`)
    }
  }

  // ── ② 미처리 입력 ──
  const pending = planPending(dataFiles())
  console.log('\n② 미처리 입력')
  for (const s of SUPPLY_SOURCES) {
    const raw = pending.rawCafe[s] ?? []
    const thin = pending.thin[s] ?? []
    console.log(`   ${s.padEnd(24)} 카페 수집물 ${String(raw.length).padStart(3)}개`
      + ` · 얇은 파일 ${String(thin.length).padStart(3)}개`)
    for (const f of thin) console.log(`      · ${f}`)
  }
  console.log(`   공통 입력  검수용 ${pending.detail.length}개`
    + ` · 판정 ${pending.shadow.length}개 · 후보 ${pending.candidates.length}개`)

  /**
   * 🔴 **적재 이월** (2026-09-27) — 앞 회차 중 적재를 끝내지 못했다고 **기록된** 후보 파일.
   *    읽기만 한다(dry-run 에서도 같다). 적재 상한은 늘지 않는다 · 품질 계약이 다르면 얹지 않는다.
   */
  const carry = planCarryOver({ dataDir: DATA_DIR, currentRunId: runId, nowMs: now.getTime() })
  const carryPaths = carry.picked.map((x) => join(DATA_DIR, x.name))
  console.log(`   적재 이월  ${carry.picked.length}개 파일`
    + ` (후보 ${carry.picked.reduce((n, x) => n + x.candidateCount, 0)}건)`
    + ` · 기한 밖 ${carry.staleCount}개는 열지 않았다`)
  for (const x of carry.picked) console.log(`      · ${x.name} — 후보 ${x.candidateCount}건`)
  {
    const byCode = new Map<CarryRejectCode, string[]>()
    for (const r of carry.rejected) {
      if (r.code === 'COMPLETED' || r.code === 'CURRENT') continue
      byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.name])
    }
    for (const [code, names] of byCode) {
      console.log(`      🟡 얹지 않음 ${code} ${names.length}개 — ${CARRY_REJECT_LABEL[code]}`)
      for (const n of names.slice(0, 5)) console.log(`         · ${n}`)
    }
  }

  // ── ③ 재고 → 버퍼 정책 (🔴 회차를 막는 게이트가 아니다) ──
  if (SIM !== null && LIVE) {
    // 🔴 `process.exit` 을 쓰지 않는다 — finally 를 건너뛰면 잡은 lock 이 남는다
    throw new Error('--simulate-stock 은 dry-run 전용이다 — 모의 재고로 DB 에 쓰지 않는다')
  }
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  teardown.disconnect = async (): Promise<void> => { await prisma.$disconnect() }
  let before: Awaited<ReturnType<typeof snapshot>> | null = null
  if (SIM === null) {
    try {
      before = await snapshot(prisma, { env: process.env, now })
    } catch (e) {
      console.log(`\n③ 재고  🔴 읽지 못했다 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  /**
   * 🔴 **공급 수요 — JIT** (2026-09-30). `--simulate-stock=N` 은 "다가오는 슬롯 중 eligible READY 가 덮은 수 = N" 모의다
   *    (dry-run 전용 · 슬롯 수는 지금 결정의 단계에서 센다).
   */
  const jitIn = SIM !== null
    ? { slots: upcomingSlots({ now, publishedToday: 0, release: scale.releaseProfile, capacity: scale.capacityProfile }).length, readyFilled: SIM }
    : before?.jit ?? null
  const policy = judgeJitDemand(jitIn)
  console.log('\n③ 다가오는 슬롯 · READY')
  if (SIM !== null) console.log(`   🟡 모의 — eligible READY ${SIM}건으로 계획만 본다 (DB 를 읽지 않았다)`)
  else if (before !== null) {
    console.log(`   형식이 맞는 미발행 행 ${before.profiled}건 (사람 ${before.human} · 기계 ${before.machine})`
      + ' — 🔴 형식 행 수일 뿐 · 발행 가능 재고가 아니다')
    if (before.classification !== null) {
      console.log(`   🔴 발행 러너 기준 — 지금 발행 가능 ${before.classification.counts.publishableNow}건`
        + ` (분류 정본 · release 상한)`)
      for (const line of describeStockClassification(before.classification)) console.log(`      ${line}`)
    } else {
      console.log(`   🔴 발행 가능 재고를 분류하지 못했다 — ${before.classifyError ?? 'unknown'} (0 으로 적지 않는다)`)
    }
    console.log(`   legacy ${before.legacy}건 — 🔴 재고에도 후보에도 넣지 않는다`)
    console.log(`   Post ${before.post}건`)
  }
  if (jitIn !== null) console.log(`   슬롯 ${jitIn.slots}개 · eligible READY 가 덮은 슬롯 ${jitIn.readyFilled}개`)
  console.log(`   수요 ${policy.reason}`)

  // ── ④ 판정 ──
  const verdict = judgeProcessRun({ live: LIVE, killOpen, lock: lockView, hasWork: hasWork(pending) })
  const sourcePlans = planSourcePhase(pending)
  /**
   * 🔴 **미리보기다.** 아직 큐를 읽지 않았으므로 draft 를 계획에 넣지 않는다 —
   *    "돌았다면" 목록에 유료 단계를 적어 두면 실제와 다른 그림이 된다.
   */
  const commonPlan = planCommonPhase(pending, policy, {
    kind: 'hold', reason: '미리보기 — 큐 스냅샷은 실행 국면에서 만든다', runId,
  })

  if (!verdict.ok) {
    console.log(`\n④ 돌지 않는다 — ${verdict.reason}`)
    if (verdict.code === 'NO_INPUT') {
      console.log('   🟢 정상 no-op. 네트워크 0 · LLM 0 · DB write 0 · Post 0')
      console.log('   🔴 수집 job 은 이 판정과 무관하게 자기 스케줄로 돈다')
    } else {
      console.log('\n   돌았다면 —')
      for (const sp of sourcePlans) {
        for (const p of sp.stages) {
          console.log(`   ${sp.source.padEnd(24)} ${p.stage.padEnd(9)} npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
        }
      }
      for (const p of commonPlan) {
        console.log(`   ${'(공통)'.padEnd(24)} ${p.stage.padEnd(9)} npx tsx ${STAGE_SCRIPT[p.stage]} ${p.args.join(' ')}`)
      }
      if (!policy.llm) console.log('   🟡 모델 단계는 계획에 없다 — 버퍼 정책이 파일 단계까지만 허용한다')
      else if (commonPlan.length === 0 && sourcePlans.length > 0) {
        // 🔴 **없는 것이 아니라 아직 입력이 없는 것이다.** adapt 가 검수용 파일을 만든 뒤에 정해진다 —
        //    계획을 미리 굳혀 두면 방금 만든 입력을 놓친다. 실행 때는 국면 사이에 다시 센다.
        console.log('   🟡 공통 단계(판정→초안→보충)는 source 단계가 입력을 만든 뒤에 정해진다')
      }
      console.log('   🟡 네트워크 0 · LLM 0 · 파일 write 0 · DB write 0')
    }
    console.log()
    return 0
  }

  // ── ⑤ 실행 — 🔴 잠금은 ①에서 이미 잡았다. 여기서 다시 만들지 않는다 ──
  const runPath = join(DATA_DIR, runFileName(runId))
  const record: ProcessRun = {
    runId,
    runtimeSha: ((): string | undefined => {
      try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim() } catch { return undefined }
    })(),
    startedAt: now.toISOString(),
    status: 'running', completedAt: null,
    jit: { slots: jitIn?.slots ?? null, readyFilled: jitIn?.readyFilled ?? null, upTo: policy.upTo, reason: policy.reason },
    sources: [], stages: [],
  }
  const save = (): void => { writeAtomic(runPath, `${JSON.stringify(record, null, 2)}\n`) }
  save()

  const tally = {
    seeds: null as number | null, hold: null as number | null, drop: null as number | null,
    adopt: null as number | null, queued: null as number | null,
    llmCall: null as number | null, cacheHit: null as number | null,
  }
  const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })
  const exec = async (plan: StagePlan): Promise<{ ok: boolean; exitCode: number | null; spawnError: string }> => {
    /**
     * 🔴 **생성 앞에 화자 여력을 적어 둔다** (2026-09-22).
     *
     *    생성 러너는 설계상 DB 를 쓰지 않는다. 그런데 "누가 며칠 뒤에 쓸 수 있는가" 와
     *    "이미 그 화자 글이 재고에 몇 편 있는가" 는 DB 에만 있다 —
     *    그것을 안 보고 화자를 골라서 **한 회차가 같은 화자에게 두 편**을 몰아줬다(실측).
     *    여기서 읽어 파일로 넘긴다. 🔴 실패해도 생성을 멈추지 않는다(fail-safe) —
     *    그때 생성 러너는 "회차 안 중복만 막는다" 고 적는다.
     */
    /**
     * 🔴 **적지 못하면 그 회차의 생성을 시작하지 않는다** (2026-09-22 보정).
     *
     *    앞판은 실패를 삼켰다. 그러면 **6시간 안에 쓴 이전 파일**이 남아 있을 때
     *    생성 러너가 그것을 읽고 그대로 돈다 — 그 회차의 재고·배정은 빠진 채로.
     *    🔴 파일에 회차 id 를 적고, 여기서도 실패하면 단계를 건너뛴다(둘 다 막는다).
     */
    if (plan.stage === 'draft') {
      try {
        const load = await writeSpeakerLoad(prisma, runId, scale)
        console.log(`   🟢 화자 여력 — 공급 눈금 ${load.planningStage}(capacity) · 발행 눈금 ${load.releaseStage}(release)`
          + ` · WIP ${load.wip.total}건 (사람 검토 대기 ${load.wip.humanReviewPending} · 발행 가능 ${load.wip.publishableNow})`
          + ` · 옛 품질 계약 ${load.wip.qualityContractMismatch}건은 WIP 아님`
          + ` · 원천 가치 없음으로 칸 해제 ${load.slots.releasedExpired}건 · 화자 미상 ${load.slots.unattributed}건`
          + ` · 말투 ${load.slots.voiceFiltered ? `있는 ${load.slots.slotEligibleCount}명만 자리를 받는다` : '필터 없음(정본을 못 읽었다)'}`)
      } catch (e) {
        const why = e instanceof Error ? e.message : 'unknown'
        console.log(`   🔴 화자 여력을 적지 못했다 — ${why}`)
        console.log('   🔴 이 회차의 생성을 시작하지 않는다 (provider 호출 0 · 파일 write 0)')
        console.log('   🔴 이전 파일이 남아 있어도 쓰지 않는다 — 회차 id 가 다르다')
        return { ok: false, exitCode: null, spawnError: 'speakerLoadWriteFailed' }
      }
    }
    /**
     * 🔴 **적재는 일시적 DB 연결 오류일 때만 다시 부른다** (2026-09-27).
     *    같은 인자로 다시 부를 뿐이다 — 중복은 적재기가 막는다(시도마다 큐를 새로 읽고 `ALREADY` ·
     *    건별 트랜잭션). 논리·검증·게이트 실패는 재시도하지 않는다.
     */
    if (plan.stage === 'fill') {
      const resolved = resolveFillArgs(plan.args, (p) => existsSync(p))
      for (const m of resolved.missing) console.log(`   🟡 적재 입력이 없어 뺀다 — ${m}`)
      const outcome = await runFillWithRetry({
        runOnce: () => run(STAGE_SCRIPT.fill, resolved.args, plan.env),
        sleep, nowMs: () => Date.now(),
        onRetry: (a, waitMs) => {
          console.log(`   🟡 적재 ${a.attempt}회차가 일시적 DB 연결 오류(${a.code})로 끝났다`
            + ` — ${Math.round(waitMs / 1000)}초 뒤 같은 입력으로 다시 부른다 (이 시도 적재 ${a.loaded}건)`)
        },
      })
      record.fill = buildFillRecord({
        args: resolved.args, missing: resolved.missing,
        carryOverPaths: carryPaths, carryRejected: carry.rejected, outcome,
      })
      tally.queued = outcome.loadedAcrossAttempts
      if (!outcome.ok) console.log(`   🔴 적재 실패 — ${outcome.stopReason} · 다음 회차가 이 입력을 이월로 다시 집는다`)
      return { ok: outcome.ok, exitCode: outcome.final.code, spawnError: outcome.final.spawnError }
    }
    // 🔴 단계별 env 는 **자식 프로세스에만** 실린다. 운영 env 파일은 건드리지 않는다
    const r = await run(STAGE_SCRIPT[plan.stage], plan.args, plan.env)
    if (plan.stage === 'judge') {
      tally.seeds = num(r.out, /AUTO_SEED\s+(\d+)건/)
      tally.hold = num(r.out, /AUTO_HOLD\s+(\d+)건/)
      tally.drop = num(r.out, /AUTO_DROP\s+(\d+)건/)
      tally.cacheHit = num(r.out, /캐시\s+(\d+)건/)
      tally.llmCall = num(r.out, /호출\s+(\d+)건/)
    } else if (plan.stage === 'draft') {
      tally.adopt = num(r.out, /채택\s+(\d+)건/)
    }
    return { ok: r.code === 0 && r.spawnError === '', exitCode: r.code, spawnError: r.spawnError }
  }
  const onStage = (plan: StagePlan): void => {
    console.log(`\n──── ${plan.source ?? '공통'} · ${plan.stage} · ${plan.label} ────`)
    console.log(`   npx tsx ${STAGE_SCRIPT[plan.stage]} ${plan.args.join(' ')}`)
  }
  const nowIso = (): string => new Date().toISOString()

  console.log(`\n⑤ 실행 — 기록 ${runPath}`)

  // ⑤-a source 국면 — 🔴 한 source 가 실패해도 다음 source 는 돈다
  const phase1 = await runSourcePhase({ plans: sourcePlans, exec, now: nowIso, onStage })
  record.sources = phase1.sources
  record.stages = [...phase1.outcomes]
  save()

  // 🔴 **국면 사이에 다시 센다.** 방금 adapt 가 만든 검수용 파일이 공통 국면의 입력이다
  const after1 = planPending(dataFiles())
  /**
   * ── 🔴 **생성 전 큐 스냅샷** (2026-09-17) ──
   *
   *    12:15 회차 실측: 유료로 266건을 만들어 183건을 채택했는데 적재는 10건이었고,
   *    빠진 이유 1위가 `SIBLING` 161건 — *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 였다.
   *    그 판정은 **원문 id 와 큐 상태만 있으면 생성 전에 알 수 있다.**
   *
   * 🔴 생성기는 DB 를 읽지 않는다(레인 계약). 그래서 **러너가 읽어 파일로 건넨다.**
   * 🔴 못 읽으면 **draft 를 보류한다.** 입력은 그대로 두고 다음 회차가 다시 집는다.
   */
  /**
   * ── 🔴 **생성 전 큐 스냅샷** (2026-09-17) ──
   *
   *    12:15 회차 실측: 유료로 266건을 만들어 183건을 채택했는데 적재는 10건이었고,
   *    빠진 이유 1위가 `SIBLING` 161건 — *"같은 원문의 형제가 아직 큐에서 안 나갔다"* 였다.
   *    그 판정은 **원문 id 와 큐 상태만 있으면 생성 전에 알 수 있다.**
   *
   * 🔴 생성기는 DB 를 읽지 않는다(레인 계약). 그래서 **러너가 읽어 파일로 건넨다.**
   * 🔴 **`draft` 를 돌리기 직전에** 뜬다. 계획 시점에 뜨면 그 사이 `judge` 가 도는 만큼
   *    낡는다 — 실측으로 `judge` 가 12분 걸린 회차가 있다. TTL 을 늘려 덮지 않는다.
   * 🔴 못 읽거나 못 쓰면 **draft 를 보류한다.** 입력은 그대로 두고 다음 회차가 다시 집는다.
   */
  const snapPath = join(DATA_DIR, queueSnapshotFileName(runId))

  /**
   * ── 🔴 **작업 묶음** — adapt 뒤, **AI 를 부르기 전에** 코드가 정한다 (2026-09-20) ──
   *
   *    2026-09-20 canary: adapt 가 3일치 backlog 를 609건으로 펼쳤고 judge 가
   *    공동 상한 15회를 전부 써 draft 는 0회였다. 후보 0건에 $0.029949.
   *    🔴 이제 N 건만 골라 **그 N 건만** 판정→생성→적재까지 세로로 보낸다.
   *    고르지 않은 것은 지우지도 판정하지도 않는다 — 다음 회차가 집는다.
   */
  const budget = judgeStageBudget(WORKSET_LIMIT)
  if (!budget.ok) {
    console.error(`\n🔴 중단: ${budget.reason}\n`)
    return 1
  }
  const wsPath = join(DATA_DIR, worksetFileName(runId))
  // 🔴 파일 이름은 **파이프라인 회차 id** 로 짓는다 — 세 단계가 같은 값으로 이어진다
  const shadowPath = join(DATA_DIR, `auto-judge-${runId}.shadow.jsonl`)
  const candPath = join(DATA_DIR, `auto-draft-${runId}.candidates.json`)

  /**
   * 🔴 큐 스냅샷을 **묶음을 고르기 전에** 뜬다 — 같은 원문의 미발행 형제를
   *    AI 호출 전에 빼야 한다. 생성 직전에도 다시 쓰이므로 한 번만 뜬다.
   */
  let queuePending = new Set<string>()  // 🔴 원천 열쇠(사이트, id) — `pendingSourceKeysOf`
  /**
   * 🔴 **큐 행(상태 무관) · 글에 이미 있는 원천** (2026-09-28). 발행된 원천을 다시 뽑아
   *    두 번째 글을 만들지 않는다. 못 읽으면 스냅샷 실패와 같다 — 묶음을 만들지 않는다(fail-closed).
   */
  let queuedSources: SourceKeySet | null = null
  let snapOk = false
  try {
    const qrows = await prisma.originalPostApprovalQueue.findMany({
      select: { createdPostId: true, rawContent: { select: { sourceArticleId: true, sourceSite: true } } },
    })
    // 🔴 글 쪽 원천 칸 — 큐를 거치지 않은 옛 글도 같은 원천이면 막는다. 제목·본문은 읽지 않는다
    const posts = await prisma.post.findMany({
      where: { sourceArticleId: { not: null } },
      select: { sourceSite: true, sourceArticleId: true },
    })
    queuedSources = queuedSourceKeysOf([
      ...qrows.map((r) => ({ sourceSite: r.rawContent?.sourceSite ?? '', sourceArticleId: r.rawContent?.sourceArticleId ?? '' })),
      ...posts,
    ])
    const snap = buildQueueSnapshot({
      runId, takenAt: new Date(),
      rows: qrows.map((r) => ({
        sourceArticleId: r.rawContent?.sourceArticleId ?? '',
        sourceSite: r.rawContent?.sourceSite ?? '',
        createdPostId: r.createdPostId,
      })),
    })
    // 🔴 이 파일은 **묶음을 고르는 데만** 쓴다 — 생성 직전에 다시 뜬다
    writeAtomic(snapPath, `${JSON.stringify(snap, null, 2)}\n`)
    queuePending = pendingSourceKeysOf(qrows.map((r) => ({
      sourceArticleId: r.rawContent?.sourceArticleId ?? '', sourceSite: r.rawContent?.sourceSite ?? '', createdPostId: r.createdPostId,
    })))
    snapOk = true
    console.log(`\n   🟢 큐 스냅샷(묶음 선택용) ${snap.pendingSources.length}건 미발행 원천`
      + ` · 큐·글에 이미 있는 원천 ${queuedSources.bySiteId.size}건 (발행 포함 — 다시 만들지 않는다)`)
  } catch (e) {
    console.log(`\n   🔴 큐 스냅샷 실패 — ${e instanceof Error ? e.message : String(e)}`)
  }

  let workset: WorksetGate | undefined
  /** 🔴 고를 원천이 0건이었는가 — "못 만들었다" 와 구분한다 */
  let worksetEmpty = false
  /**
   * 🔴 **예정 슬롯 — 다음 열린 공개 슬롯** (2026-09-30). 생성 전 판정은 이 시각에서 원천 나이를 잰다.
   */
  // 🔴 오늘 발행 수는 스냅샷(정본 적재 `loadStock`)에서 읽는다 — 러너가 발행 기록을 따로 세지 않는다.
  //    모르면(null) 모델 단계가 이미 닫혀 있다(`judgeJitDemand(null)`) — 여기 0 은 dry-run 모의 표시에만 쓰인다
  const nextSlotAt = nextSlotAnchor(scale.releaseProfile, {
    now: RUN_AT, publishedToday: before?.jit?.publishedToday ?? 0,
  })
  if (snapOk && queuedSources !== null) {
    let listIndex: ListObservationIndex | null = null
    try { listIndex = readListObservations(DATA_DIR, RUN_AT) } catch (e) {
      console.log(`   🟡 목록 관측을 읽지 못했다 — ${e instanceof Error ? e.message : String(e)} (원천 상대 표본 없음 = 모름)`)
    }
    const rows = worksetRows(after1.detail.map((f) => join(DATA_DIR, f)), listIndex, RUN_AT)
    if (rows === null) {
      console.error('\n🔴 중단: 상세 입력을 읽지 못해 작업 묶음을 만들 수 없다 — 유료 단계 0회\n')
      return 1
    }
    const releaseOf = (r: WorksetRow): SlotReleaseVerdict => preGenerationRelease(r, nextSlotAt, RUN_AT)
    // 🔴 회차 시각 하나 — 자식(auto-draft)이 env 로 **같은 값**을 받는다
    const runAt = RUN_AT
    const prior = priorState(rows, currentContractBase(runAt))
    /**
     * 🔴 **생성 가능 판정 입력 — 하나다** (2026-10-01 Lane B). 기회 스냅샷과 묶음 선택이 같은 값 · 같은 함수
     *    (`worksetEligibility`)를 쓴다. 앞판 스냅샷은 슬롯 판정만 거쳐 끝난 · 큐 · 이월 · 사람 판정 원천까지 셌다.
     */
    const eligibilityInput = {
      rows, humanDecided: humanDecided(), queuePending, queuedSources,
      // 🔴 이월로 적재될 후보의 원천 — 다시 만들지 않는다(#587 이 적재한다)
      carriedOver: queuedSourceKeysOf(carry.picked.flatMap((x) => x.sources)),
      concluded: prior.concluded,
      releaseOf,
    }
    /**
     * 🔴 **원천 기회 스냅샷** — 지금 실제로 생성 가능한(상한 전) 원천의 증거 기록(원문 없음). 다음 단계 preflight 가 읽는다.
     *    쓰기는 live 회차에서만(dry-run 파일 write 0).
     */
    if (canWrite) {
      const opp = worksetEligibility(eligibilityInput).eligible.flatMap((r) => (r.evidence === null ? [] : [r.evidence]))
      writeAtomic(join(DATA_DIR, opportunitiesFileName(runId)), `${JSON.stringify({
        kind: OPPORTUNITY_KIND, version: OPPORTUNITY_VERSION, runId, takenAt: RUN_AT.toISOString(),
        slotAt: nextSlotAt.toISOString(), evidence: opp,
      }, null, 2)}\n`)
      console.log(`   🟢 원천 기회 스냅샷 ${opp.length}건 (예정 슬롯 ${nextSlotAt.toISOString()})`)
    }
    if (policy.llm) {
    const plan = selectWorkset({
      ...eligibilityInput, attempted: prior.attempted,
      limit: WORKSET_LIMIT, runId, takenAt: runAt,
    })
    if (plan.picked.length === 0) {
      // 🔴 **manifest 를 쓰지 않는다** — 빈 묶음으로 단계를 돌릴 이유가 없다
      worksetEmpty = true
    } else {
      writeAtomic(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`)
      workset = {
        manifestPath: wsPath, shadowPath, candidatesPath: candPath,
        limit: WORKSET_LIMIT, perStage: budget.perStage,
        // 🔴 적재를 끝내지 못한 앞 회차 파일 — 상한(`--up-to`)은 늘지 않는다
        carryOverPaths: carryPaths,
      }
    }
    console.log(`   🔴 작업 묶음 ${plan.picked.length}건 / 상한 ${WORKSET_LIMIT} — ${wsPath}`)
    console.log(`      단계 상한  judge ${budget.perStage.judge}회 · draft ${budget.perStage.draft}회`
      + ` · 회차 전체 ${budget.total}회 (🔴 단계마다 따로 — 앞 단계가 뒤 단계를 굶기지 못한다)`)
    const dropNote = (Object.keys(plan.dropped) as (keyof typeof plan.dropped)[])
      .filter((k) => plan.dropped[k] > 0)
      .map((k) => `${WORKSET_DROP_LABEL[k]} ${plan.dropped[k]}`)
    console.log(`      제외 ${dropNote.length === 0 ? '없음' : dropNote.join(' · ')}`)
    console.log(`      🔴 이번에 안 고른 ${plan.deferred}건은 **그대로 남는다** — 다음 회차가 집는다`)
    // 🔴 축별 자리 (2026-09-28) — raw 는 초안이 없는 축이라 자리를 제한한다. 정본은 `worksetAxisQuota`
    console.log(`      축  seed 적격 ${plan.axis.eligible.seed} · 자리 ${plan.axis.quota.seed} · 고름 ${plan.axis.picked.seed}`
      + `  |  raw 적격 ${plan.axis.eligible.raw} · 자리 ${plan.axis.quota.raw} · 고름 ${plan.axis.picked.raw}`)
    for (const r of plan.picked) {
      console.log(`      · ${r.sourceArticleId} · ${r.sourceSite} · ${worksetAxisOf(r)} · 댓글 ${r.commentCount}`)
    }
    }
  }

  /**
   * 🔴 **묶음 없이 live 를 돌리지 않는다** (2026-09-20 보정).
   *    앞판은 `workset` 이 `undefined` 면 옛 전체 스캔으로 넘어갔다 —
   *    그것이 canary 에서 backlog 609건을 판정하게 만든 길이다.
   *
   * 🔴 **다만 "없는 것"과 "못 만든 것"은 다르다.**
   *    · 버퍼가 차서 모델 단계 자체가 없는 회차 → **정상 done** (파일 단계까지 끝)
   *    · 고를 원천이 0건인 회차 → **정상 no-op done** (judge·draft·fill 0회)
   *    · 스냅샷·입력을 못 읽어 만들지 못한 회차 → 🔴 **실패**
   */
  if (workset === undefined) {
    if (!policy.llm) {
      // 🔴 재고가 차 있다 — 모델을 부를 이유가 없다. 실패가 아니다
      console.log(`\n   🟢 모델 단계 없음 — ${policy.reason}. 파일 단계까지 끝냈다`)
    } else if (worksetEmpty) {
      console.log('\n   🟢 고를 원천이 0건이다 — judge · draft · fill 0회 (정상 no-op)')
    } else {
      console.error('\n🔴 중단: 작업 묶음을 만들지 못했다 — judge · draft · fill 0회\n')
      record.status = 'failed'
      record.completedAt = nowIso()
      save()
      return 1
    }
  }
  /**
   * 🔴 새 묶음이 없는 회차도 **이월 적재**는 한다 — 고를 원천이 0건이어도 앞 회차의 끝내지 못한
   *    후보는 남아 있다. 버퍼 정책이 적재를 허락할 때만 · 상한은 묶음 크기 그대로.
   */
  const common = workset === undefined
    ? (worksetEmpty ? planCarryOverFill(policy, carryPaths, WORKSET_LIMIT) : [])
    : planBoundedCommonPhase(after1, policy, {
      kind: 'ready', snapshotPath: snapPath, runId,
    }, workset)
  /**
   * 🔴 **스냅샷을 두 번 뜬다** (2026-09-20).
   *    ① 묶음을 고르기 전 — 같은 원문의 형제를 **AI 호출 전에** 빼려면 필요하다
   *    ② `draft` 직전 — 그 사이 `judge` 가 도는 만큼 ①이 낡는다. 실측으로 12분 걸린
   *       회차가 있었다. TTL 을 늘려 덮지 않는다. **생성이 보는 것은 ②다.**
   */
  const beforeStage = async (plan: StagePlan): Promise<StageGate> => {
    if (plan.stage !== 'draft') return { ok: true }
    try {
      const qrows = await prisma.originalPostApprovalQueue.findMany({
        // 🔴 적재의 queueForSibling 과 **같은 세 칸**만 읽는다. 제목도 본문도 가져오지 않는다
        select: {
          createdPostId: true,
          rawContent: { select: { sourceArticleId: true, sourceSite: true } },
        },
      })
      const snap = buildQueueSnapshot({
        runId, takenAt: new Date(),
        rows: qrows.map((r) => ({
          sourceArticleId: r.rawContent?.sourceArticleId ?? '',
          sourceSite: r.rawContent?.sourceSite ?? '',
          createdPostId: r.createdPostId,
        })),
      })
      writeAtomic(snapPath, `${JSON.stringify(snap, null, 2)}\n`)
      console.log(`   🟢 큐 스냅샷 ${snap.pendingSources.length}건 미발행 원천 — ${snapPath}`)
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`   🔴 큐 스냅샷 실패 — ${msg}`)
      return { ok: false, reason: `큐 스냅샷을 만들지 못해 초안 생성을 보류했다 (${msg})` }
    }
  }
  const phase2 = await runCommonPhase({ plan: common, exec, now: nowIso, onStage, beforeStage })
  record.stages = [...record.stages, ...phase2.outcomes]
  record.status = runStatusOf(record.stages)
  record.completedAt = nowIso()
  save()

  // ── ⑥ 정합 ──
  console.log('\n⑥ 관제')
  for (const s of record.sources) {
    console.log(`   ${s.status === 'ok' ? '✅' : '🔴'} ${s.source.padEnd(24)} ${s.note}`)
  }
  for (const s of record.stages) {
    const mark = s.status === 'ok' ? '✅' : s.status === 'skipped' ? '🟡' : '🔴'
    console.log(`   ${mark} ${(s.source ?? '공통').padEnd(24)} ${s.stage.padEnd(9)}`
      + ` exit ${String(s.exitCode)} ${s.note}`)
  }
  console.log(`   판정     SEED ${fmtCount(tally.seeds)} · HOLD ${fmtCount(tally.hold)} · DROP ${fmtCount(tally.drop)}`)
  console.log(`   생성     채택 ${fmtCount(tally.adopt)} · 적재 ${fmtCount(tally.queued)}`)
  if (record.fill !== undefined) {
    const f = record.fill
    console.log(`   적재 시도 ${f.attempts.length}회 · 재시도 ${f.retries}회`
      + `${f.attempts.length > 0 ? ` (${f.attempts.map((a) => `${a.attempt}:${a.kind}${a.code === '' ? '' : `/${a.code}`}`).join(' → ')})` : ''}`
      + `${f.stopReason === '' ? '' : ` — ${f.stopReason}`}`)
    const carriedN = f.report?.files.filter((x) => f.carriedOver.includes(x.name))
      .reduce((n, x) => n + x.candidates, 0)
    console.log(`   이월     파일 ${f.carriedOver.length}개 (후보 ${carriedN ?? '—'}건)`
      + `${f.carriedOver.length === 0 ? '' : ` — ${f.carriedOver.join(', ')}`}`)
    if (f.report === null) {
      console.log(`   적재 결과 보고 없음 — 커밋된 큐 행 ${f.loadedAcrossAttempts}건 (끝냈는지 모른다 · 다음 회차가 다시 집는다)`)
    } else {
      console.log(`   적재 결과 적재 ${f.loadedAcrossAttempts}건(시도 합) · 제외 ${describeSkips(f.report.skipped)}`
        + ` · 상한 컷 ${f.report.cut}건`)
      for (const x of f.report.files) {
        console.log(`      · ${x.name} 후보 ${x.candidates} · 적재 ${x.loaded} · 제외 ${describeSkips(x.skipped)} · 컷 ${x.cut}`)
      }
    }
  }
  console.log(`   LLM      호출 ${fmtCount(tally.llmCall)} · 캐시 ${fmtCount(tally.cacheHit)}`)

  let ok = record.status === 'done'
  if (before !== null) {
    const after = await snapshot(prisma, { env: process.env, now: RUN_AT })
    const queuedMachine = after.machine - before.machine
    const queuedNonMachine = (after.profiled - before.profiled) - queuedMachine
    const v = verifyRun({
      postBefore: before.post, postAfter: after.post,
      stockBefore: before.profiled, stockAfter: after.profiled,
      machineBefore: before.machine, machineAfter: after.machine,
      queuedMachine, queuedNonMachine,
    })
    console.log(`   형식 행  ${before.profiled} → ${after.profiled} (적재 정합용 수 — 재고 목표 없음)`)
    const pn = (x: SupplySnapshot): string => (x.classification === null ? '—' : String(x.classification.counts.publishableNow))
    const hr = (x: SupplySnapshot): string => (x.classification === null ? '—' : String(x.classification.counts.humanReviewPending))
    console.log(`   발행 가능 ${pn(before)} → ${pn(after)} · 사람 검토 대기 ${hr(before)} → ${hr(after)}`)
    console.log(`   Post     ${before.post} → ${after.post} ${after.post === before.post ? '✅ 불변' : '🔴 변했다'}`)
    console.log(`\n⑦ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
    for (const p of v.problems) console.log(`   ${p}`)
    ok = ok && v.ok
  }
  console.log('\n   🔴 발행하지 않았다. 발행은 auto-publish 가 예약 슬롯에 한다.\n')

  console.log(`   회차 ${record.status}${record.status === 'done' ? ' ✅' : ''}`)
  return ok ? 0 : 1
}

const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  let code = 1
  try {
    code = await main()
  } catch (e) {
    console.error(`\n🔴 중단: ${e instanceof Error ? e.message : String(e)}\n`)
    code = 1
  } finally {
    /**
     * 🔴 **성공·실패·예외 어느 경로로 나가든 여기를 지난다.**
     *    잡은 lock 을 풀지 않고 죽으면 다음 회차가 `STALE_HELD` 로 멈추고,
     *    자동 회수를 하지 않으므로 사람이 올 때까지 공급이 선다.
     */
    releaseHeldLock()
    if (teardown.disconnect !== null) await teardown.disconnect()
  }
  process.exit(code)
}
