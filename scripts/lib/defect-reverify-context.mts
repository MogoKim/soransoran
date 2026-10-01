/**
 * 🔴 **결함 해소 재검증 문맥 — 저장된 초안에 지금 게이트를 다시 돌릴 입력** (2026-10-01 · Lane E)
 *
 *   큐 행이 가리키는 artifact 를 **정확히 한 장** 찾고(`restoreRow` — 열쇠 · 한 장 · 출처·Persona·계약 · 최초 초안 대조),
 *   그 한 장의 계획(`plan`)과 마스킹된 원문 근거, 생성 회차 시각(`generatedAt`), 후보 줄의 원천 사이트·시각을 꺼낸다.
 *   카드는 Pool 카드 정본 문서(`parsePoolDoc`)의 배정 Persona 카드다 — 감사 문맥과 같은 정본이다.
 *
 * 🔴 하나라도 어긋나거나 없으면 문맥을 만들지 않는다(재검증 안 함 → 해소 기록 없음). 추정 매칭을 하지 않는다.
 * 🔴 사진 수는 artifact · 후보 줄 어디에도 없다 — `null`(모른다)이다. 모르는 값은 확정 차단을 만들지 않는다
 *    (게이트가 사람 검토로 보낸다) — 재구성이 부정확하면 해소가 **덜** 일어나는 쪽이다.
 * 🔴 원문 · 초안 글자를 DB 로 옮기지 않는다 — 기록에는 입력 지문만 남는다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { restoreRow } from '../../src/lib/auto-ready-evidence'
import { readReviewArtifact, sourceEvidenceOf } from '../../src/lib/original-post-machine-review'
import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import type { ContextLoader } from '../../src/lib/auto-ready-defect-resolution-store'
import { DEFAULT_ARTIFACT_DIR, loadArtifactIndex } from './microseed-artifacts.mjs'
import { AUDIT_POOL_DOC } from './auto-ready-audit-context.mjs'

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const S = (v: unknown): string => (typeof v === 'string' ? v : '')
const dateOrNull = (v: unknown): Date | null => {
  if (typeof v !== 'string' || v.trim() === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function makeReverifyContextLoader(opts: { artifactDir?: string; poolDocPath?: string } = {}): ContextLoader {
  const dir = opts.artifactDir ?? DEFAULT_ARTIFACT_DIR
  return (row) => {
    let ix: ReturnType<typeof loadArtifactIndex>
    try { ix = loadArtifactIndex(dir) } catch { return { ok: false, code: 'ARTIFACT_INDEX_UNREADABLE', reason: 'artifact 정본 디렉터리를 읽지 못했다' } }
    const restored = restoreRow(row, ix.artifacts, ix.candidates)
    if (restored.klass !== 'clean' && restored.klass !== 'warning') {
      return { ok: false, code: `ARTIFACT_${restored.klass.toUpperCase()}`, reason: restored.reasons.join(' · ').slice(0, 300) }
    }
    const artifactId = S(rec(rec(row.gateResults).autoDraft).artifactId)
    const doc = ix.artifacts.get(artifactId)?.[0]
    const raw = doc === undefined ? undefined : ix.raw.get(`${doc.file}#${artifactId}`)
    const art = raw === undefined ? null : readReviewArtifact(raw)
    if (raw === undefined || art === null) return { ok: false, code: 'ARTIFACT_UNREADABLE', reason: `artifact ${artifactId} 를 읽지 못했다` }
    const plan = rec(raw.plan)
    if (Object.keys(plan).length === 0) return { ok: false, code: 'NO_PLAN', reason: 'artifact 에 계획이 없다' }
    const at = dateOrNull(raw.generatedAt)
    if (at === null) return { ok: false, code: 'NO_RUN_AT', reason: 'artifact 에 생성 시각이 없다' }
    const src = sourceEvidenceOf(art)
    if (src.rawTitle === '' && src.rawBody === '') return { ok: false, code: 'NO_SOURCE_EVIDENCE', reason: '원문 근거가 없다' }

    const cdoc = ix.candidates.get(artifactId)?.[0]
    if (cdoc === undefined) return { ok: false, code: 'NO_CANDIDATE', reason: '후보 줄이 없다' }
    let cand: Record<string, unknown> | undefined
    try {
      const env = rec(JSON.parse(readFileSync(join(dir, cdoc.file), 'utf8')))
      const list = (Array.isArray(env.candidates) ? env.candidates : []).map(rec).filter((c) => S(c.artifactId) === artifactId)
      cand = list.length === 1 ? list[0] : undefined
    } catch { cand = undefined }
    if (cand === undefined) return { ok: false, code: 'NO_CANDIDATE', reason: '후보 줄을 정확히 한 줄 읽지 못했다' }

    if (row.matchedPersonaCode === null) return { ok: false, code: 'NO_PERSONA', reason: '배정된 Persona 가 없다' }
    let cards: PoolCard[]
    try { cards = parsePoolDoc(readFileSync(opts.poolDocPath ?? AUDIT_POOL_DOC, 'utf-8')).cards } catch {
      return { ok: false, code: 'PERSONA_CANON_UNREADABLE', reason: 'Persona 정본 카드를 읽지 못했다' }
    }
    const card = cards.find((c) => c.code === row.matchedPersonaCode)
    if (card === undefined) return { ok: false, code: 'NO_PERSONA_CARD', reason: `Persona ${row.matchedPersonaCode} 의 정본 카드가 없다` }

    const warrants = (Array.isArray(plan.warrants) ? plan.warrants : []).map(rec).map((w) => ({
      fact: S(w.fact), ...(typeof w.evidenceText === 'string' ? { evidenceText: w.evidenceText } : {}),
    }))
    return {
      ok: true,
      ctx: {
        artifactId,
        plan: {
          selfBasis: typeof plan.selfBasis === 'string' ? plan.selfBasis : null,
          warrants,
          closingIntent: typeof plan.closingIntent === 'string' ? plan.closingIntent : null,
          contentRoles: Array.isArray(plan.contentRoles) ? plan.contentRoles.filter((x): x is string => typeof x === 'string') : [],
        },
        card,
        source: {
          title: src.rawTitle, body: src.rawBody, site: S(cand.sourceSite),
          postedAt: dateOrNull(cand.sourcePostedAt), capturedAt: dateOrNull(cand.sourceCapturedAt), imageCount: null,
        },
        at,
      },
    }
  }
}
