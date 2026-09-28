/**
 * 🔴 **의미 감사 문맥 — 발행 글 · 도장 · artifact 원문 근거 · Persona 카드를 한 묶음으로** (2026-09-27)
 *
 *   큐 행이 가리키는 artifact 를 **정확히 한 장** 찾고(`restoreRow` — 증거 복원과 같은 대조: 열쇠 ·
 *   한 장 · 출처·Persona·계약 · 최초 초안), 그 한 장의 마스킹된 원문 근거를 꺼낸다(`sourceEvidenceOf`).
 *   글쓴이는 큐에 배정된 Persona 이고, 그 Persona 의 User 가 **실제 Post 작성자**여야 한다.
 *   카드는 Pool 카드 정본 문서에서 읽는다(`parsePoolDoc`) — DB 의 identity 가 아니다.
 *
 * 🔴 하나라도 어긋나면 문맥을 만들지 않는다 → 무결성 yes. 정본 파일을 못 읽은 것만 재시도 가능 실패다.
 *    추정 매칭을 하지 않는다.
 * 🔴 원문 근거를 DB 로 복사하지 않는다 — 로컬 정본에서 읽어 요청에만 싣는다.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER, readStamp } from '../../src/lib/auto-ready-v2'
import { restoreRow } from '../../src/lib/auto-ready-evidence'
import { readReviewArtifact, sourceEvidenceOf } from '../../src/lib/original-post-machine-review'
import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import type { SemanticContextResult } from '../../src/lib/auto-ready-semantic-audit'
import type { AuditContextLoader } from '../../src/lib/auto-ready-audit-store'
import { DEFAULT_ARTIFACT_DIR, loadArtifactIndex, type ArtifactIndex } from './microseed-artifacts.mjs'

/** 🔴 생성 러너가 읽는 그 문서다 — cwd 가 아니라 저장소 기준으로 푼다(launchd 가 어디서 띄워도 같다) */
export const AUDIT_POOL_DOC = fileURLToPath(new URL('../../docs/operations/2026-08-30-persona-pool-design.md', import.meta.url))

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** 🔴 환경(정본 파일 읽기) 실패 코드 — 이것만 재시도 가능이다. 나머지 문맥 실패는 무결성이다 */
export const ENV_READ_CODES: readonly string[] = ['ARTIFACT_INDEX_UNREADABLE', 'PERSONA_CANON_UNREADABLE']

export function makeAuditContextLoader(prisma: PrismaClient, opts: { artifactDir?: string; poolDocPath?: string } = {}): AuditContextLoader {
  let index: ArtifactIndex | null = null
  let indexError: string | null = null
  let cards: PoolCard[] | null = null
  let cardError: string | null = null
  const idx = (): ArtifactIndex | null => {
    if (index === null && indexError === null) {
      try { index = loadArtifactIndex(opts.artifactDir ?? DEFAULT_ARTIFACT_DIR) } catch (e) {
        indexError = e instanceof Error ? (e as { code?: string }).code ?? e.name : 'unknown'
      }
    }
    return index
  }
  const pool = (): PoolCard[] | null => {
    if (cards === null && cardError === null) {
      try { cards = parsePoolDoc(readFileSync(opts.poolDocPath ?? AUDIT_POOL_DOC, 'utf-8')).cards } catch (e) {
        cardError = e instanceof Error ? (e as { code?: string }).code ?? e.name : 'unknown'
      }
    }
    return cards
  }
  /**
   * 🔴 **데이터가 없거나 결속이 깨졌다 → 무결성**(`integrity: true`). **정본 파일을 못 읽었다 → 재시도 가능**
   *    (`ENV_READ_CODES` — 디렉터리·문서 읽기 실패는 글의 결함이 아니다. 고쳐지면 다음 회차가 판정한다).
   */
  const fail = (code: string, reason: string): SemanticContextResult =>
    ({ ok: false, code, reason, integrity: !ENV_READ_CODES.includes(code) })

  return async ({ queueId, postId }): Promise<SemanticContextResult> => {
    const q = await prisma.originalPostApprovalQueue.findUnique({
      where: { id: queueId },
      select: {
        id: true, decidedBy: true, createdPostId: true, draftTitle: true, draftBody: true, gateVerdict: true,
        gateResults: true, editDiff: true, declineReason: true,
        matchedPersona: { select: { code: true, userId: true } },
        rawContent: { select: { sourceSite: true, sourceArticleId: true, sourceCapturedAt: true } },
      },
    })
    if (q === null) return fail('NO_QUEUE', '감사 대상 큐 행이 없다')
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, title: true, content: true, authorId: true } })
    if (post === null) return fail('NO_POST', '감사 대상 Post 가 없다')
    if (q.createdPostId !== post.id) return fail('POST_MISMATCH', '큐 행이 가리키는 글이 감사 대상 글이 아니다')
    if ((q.decidedBy ?? '').trim() !== AUTO_DECIDER) return fail('NOT_AUTO', `decidedBy=${q.decidedBy ?? '(없음)'}`)
    // 🔴 글쓴이 — 배정된 Persona 이고, 그 Persona 의 계정이 실제 작성자여야 한다
    if (q.matchedPersona === null) return fail('NO_PERSONA', '배정된 Persona 가 없다')
    if (q.matchedPersona.userId !== post.authorId) return fail('AUTHOR_MISMATCH', 'Post 작성자가 배정된 Persona 계정이 아니다')

    const ix = idx()
    if (ix === null) return fail('ARTIFACT_INDEX_UNREADABLE', `artifact 정본 디렉터리를 읽지 못했다 (${indexError ?? '?'})`)
    const restored = restoreRow({
      id: q.id, decidedBy: q.decidedBy, draftTitle: q.draftTitle, draftBody: q.draftBody,
      gateVerdict: q.gateVerdict, gateResults: q.gateResults, editDiff: q.editDiff, declineReason: q.declineReason,
      rawSourceSite: q.rawContent.sourceSite, rawSourceArticleId: q.rawContent.sourceArticleId,
      sourceCapturedAt: q.rawContent.sourceCapturedAt, matchedPersonaCode: q.matchedPersona.code,
    }, ix.artifacts, ix.candidates)
    // 🔴 결속(열쇠·한 장·출처·Persona·계약·최초 초안)이 선 것만 — 의미 검수 경고 유무(warning)는 결속과 무관하다
    if (restored.klass !== 'clean' && restored.klass !== 'warning') {
      return fail(`ARTIFACT_${restored.klass.toUpperCase()}`, restored.reasons.join(' · ').slice(0, 300))
    }
    const artifactId = String(rec(rec(q.gateResults).autoDraft).artifactId)
    const doc = ix.artifacts.get(artifactId)?.[0]
    const raw = doc === undefined ? undefined : ix.raw.get(`${doc.file}#${artifactId}`)
    const art = raw === undefined ? null : readReviewArtifact(raw)
    if (art === null) return fail('ARTIFACT_UNREADABLE', `artifact ${artifactId} 를 읽지 못했다`)
    const src = sourceEvidenceOf(art)
    if (src.rawTitle === '' && src.rawBody === '') return fail('NO_SOURCE_EVIDENCE', `artifact ${artifactId} 에 원문 근거가 없다`)

    const cs = pool()
    if (cs === null) return fail('PERSONA_CANON_UNREADABLE', `Persona 정본 카드를 읽지 못했다 (${cardError ?? '?'})`)
    const card = cs.find((c) => c.code === q.matchedPersona!.code)
    if (card === undefined) return fail('NO_PERSONA_CARD', `Persona ${q.matchedPersona.code} 의 정본 카드가 없다`)

    return {
      ok: true,
      ctx: {
        post: { id: post.id, title: post.title, body: post.content },
        stamp: readStamp(q.editDiff),
        artifact: { artifactId, sourceArticleId: art.sourceArticleId, sourceTitle: src.rawTitle, sourceBody: src.rawBody },
        persona: { code: card.code, card },
      },
    }
  }
}
