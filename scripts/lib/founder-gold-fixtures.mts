/**
 * 창업자 gold 30건 → 러너 경로 fixture (quality-v4) — 🔴 순수 데이터 변환. DB · 네트워크 · provider 0.
 *
 *   gold 행의 원천 · 계획 · 원본 초안 · 회차 시각을 **그대로** 러너 fixture(`GateFixture`)로 옮긴다.
 *   가짜 provider 는 운영에서 실제로 돌아온 계획과 초안, 의미 검수 `clean`(30건 모두 holds 0 이었다)을 돌려준다.
 *   🔴 카드는 정본 문서를 파서로 읽은 값이다 — gold 의 카드 스냅샷과 게이트 칸이 같은지 검사가 먼저 본다.
 */
import { FOUNDER_GOLD_V1_ROWS } from '../../src/lib/founder-gold-v1.data'
import type { FounderGoldRow } from '../../src/lib/founder-gold'
import { realCard } from './life-gate-fixtures.mjs'
import type { GateFixture } from './draft-gate-fixtures.mjs'

export const GOLD_CARD_KEYS = [
  'ageBand', 'maritalStatus', 'spouseRelationship', 'childrenCount', 'childrenAgeBands',
  'parentCare', 'menopauseStatus', 'noGoTopics', 'household',
] as const

export function goldFixtureOf(r: FounderGoldRow): GateFixture {
  const p = r.plan
  return {
    queueId: r.queueId,
    label: `gold #${r.n} ${p.personaCode} · 창업자 ${r.verdict}${r.hardDefect ? ' · 중대 결함' : ''}`,
    source: { id: `gold-${r.n}`, title: r.source.title, body: r.source.body },
    draft: { title: r.draft.title, body: r.draft.body },
    plan: {
      decision: 'ok', personaCode: p.personaCode, stance: p.stance, selfBasis: p.selfBasis,
      closingIntent: p.closingIntent, contentRoles: [...p.contentRoles], universalReason: p.universalReason,
      protectedFacts: [...p.protectedFacts],
      speakerWarrants: p.warrants.map((w) => ({ ...w })),
    },
    card: realCard(p.personaCode),
    expect: [],
    sourceMeta: {
      site: r.source.site, imageCount: r.source.imageCount,
      postedAt: r.source.postedAt === null ? null : new Date(r.source.postedAt),
      capturedAt: r.source.capturedAt === null ? null : new Date(r.source.capturedAt),
    },
    at: new Date(r.runAt),
  }
}

export const GOLD_FIXTURES: readonly { row: FounderGoldRow; fx: GateFixture }[] =
  FOUNDER_GOLD_V1_ROWS.map((row) => ({ row, fx: goldFixtureOf(row) }))
