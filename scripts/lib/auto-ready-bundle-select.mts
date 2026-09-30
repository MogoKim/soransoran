/**
 * 🔴 **자동 READY 증거 — 검토 묶음에 넣을 행 고르기 (DB read-only)** (2026-09-27)
 *
 *   ① **지금 품질 계약 창** — 열림 판정(`evidenceFromDb`)이 보는 첫 30건을 **생성 순서 그대로** 넣는다.
 *      재고 분류(`HUMAN_REVIEW_REQUIRED`)와 무관하다 — TTL 이 지났거나 배정이 막혀 다른 분류가 된
 *      창 안의 행도 열림을 막으므로 **반드시** 검토할 수 있어야 한다. 첫 차단 행을 표시한다.
 *   ② legacy 사람 결정 행 · ③ legacy 결정 전 그림자 — 앞판 그대로(창에 든 행은 빼고).
 * 🔴 DB write 0. 묶음 스크립트와 격리 DB 검사가 이 함수 하나를 부른다.
 */
import type { PrismaClient } from '@prisma/client'

import { EVIDENCE_ROW_SELECT, type EvidenceRow } from '../../src/lib/auto-ready-evidence-store'
import { HUMAN_DECIDER, eligibilityOf } from '../../src/lib/auto-ready-v2'
import { evidenceFromDb } from '../../src/lib/auto-ready-repo'
import { profileOf } from '../../src/lib/original-post-auto-publish'
import type { QualityCohortVerdict } from '../../src/lib/auto-ready-quality-cohort'
import { loadPublishableStock } from './publishable-stock.mjs'

export const BUNDLE_ROW_SELECT = {
  ...EVIDENCE_ROW_SELECT,
  matchedPersona: { select: { code: true, status: true, identity: true } },
  rawContent: { select: { ...EVIDENCE_ROW_SELECT.rawContent.select, rawTitle: true, rawBody: true } },
} as const

export type BundleRow = EvidenceRow & {
  matchedPersona: { code: string; status: string; identity: unknown } | null
  rawContent: EvidenceRow['rawContent'] & { rawTitle: string; rawBody: string }
}

/** 🔴 창 안 행의 자리 — 몇 번째이고, 첫 차단 행인가 */
export type CohortSlot = { index: number; firstBlocking: boolean; contractVersion: string }

export type BundleSelection = {
  cohort: QualityCohortVerdict
  window: { row: BundleRow; slot: CohortSlot }[]
  decided: BundleRow[]
  shadow: BundleRow[]
}

export async function selectBundleRows(prisma: PrismaClient, now: Date): Promise<BundleSelection> {
  const machine = (r: BundleRow) => profileOf({ promptVersion: r.promptVersion, model: r.model, sourceSite: r.rawContent.sourceSite, gateResults: r.gateResults } as never) === 'machine'
  const cohort = await evidenceFromDb(prisma)
  const winRows = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: cohort.windowIds } }, select: BUNDLE_ROW_SELECT }) as BundleRow[]
  const byId = new Map(winRows.map((r) => [r.id, r]))
  const window = cohort.windowIds.flatMap((id, i) => {
    const row = byId.get(id)
    return row === undefined ? [] : [{
      row, slot: { index: i + 1, firstBlocking: cohort.firstBlocking?.id === id, contractVersion: cohort.contractVersion },
    }]
  })
  const inWindow = new Set(cohort.windowIds)
  /** ② 사람 결정 표식이 있는 기계 후보 — 결과(무수정/수정/폐기)가 이미 있다 */
  const decided = (await prisma.originalPostApprovalQueue.findMany({ where: { decidedBy: HUMAN_DECIDER }, select: BUNDLE_ROW_SELECT, orderBy: { createdAt: 'asc' } }) as BundleRow[])
    .filter(machine).filter((r) => !inWindow.has(r.id))
  /** ③ 현재 그림자 — 사람 검토를 기다리는 기계 후보 중 경고 없는 것. 🔴 결정이 없으므로 기록해도 아직 표본이 아니다 */
  const stock = await loadPublishableStock(prisma, now)
  const waitIds = stock.rejected.filter((r) => r.code === 'HUMAN_REVIEW_REQUIRED').map((r) => r.id)
  const shadow = (await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: waitIds } }, select: BUNDLE_ROW_SELECT, orderBy: { createdAt: 'asc' } }) as BundleRow[])
    .filter((r) => !inWindow.has(r.id))
    .filter((r) => eligibilityOf({
      gateVerdict: r.gateVerdict, gateResults: r.gateResults, title: r.editedTitle ?? r.draftTitle,
      body: r.editedBody ?? r.draftBody,
    }).auto)
  return { cohort, window, decided, shadow }
}
