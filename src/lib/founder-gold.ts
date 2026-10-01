/**
 * 🔴 **창업자 gold 재생 — 후속 품질 계약(quality-v4)의 증거** (2026-09-28 창업자 결정)
 *
 * 🔴 **왜 있나.** quality-v3 는 "새 계약마다 사람이 첫 30건을 다시 검토해야 연다" 였다. v3 첫 30건은 창업자가
 *    전부 검토했고(무수정 22 · 수정 2 · 폐기 6 · 중대 결함 3) **v3 는 실패**다 — 그 기록은 지우거나 바꾸지 않는다.
 *    창업자는 앞으로 새 30건을 다시 검토하지 않는다. 그래서 v4 의 열림 근거를 바꾼다:
 *      ① **창업자 gold 정확도** — 지금 코드의 초안 게이트가 이 30건에서 창업자 판정을 그대로 재현한다
 *         (통과 22 과차단 0 · 수정 2 · 폐기 6 자동 READY 0 · 중대 결함 3 확정 차단)
 *      ② **운영 감사 안전 사슬** — 발행 뒤 독립 감사 결함 · 재시도 가능 실패 · 판정 대기 시한 · 글 유실이면 닫힘
 *         (정본 `judgeOpen` · `auto-ready-audit-store` 그대로)
 *      ③ 지금 계약 행에 사람이 중대 결함을 적으면 닫힘(`cohortHardDefects`)
 *    🔴 기준을 낮추지 않는다 — 30건·90%·결함 0 을 통과한 척하지 않고, 근거가 다른 **새 판**이다.
 *
 * 🔴 순수하다. DB · 네트워크 · 파일 IO 없음(데이터는 import 한 상수다). 도장·발행 트랜잭션 안에서도 부른다.
 */
import { createHash } from 'node:crypto'
import { judgeDraftLife, type DraftGateCard } from './content-core/draft-life-gates'
import { FOUNDER_GOLD_V1_ROWS } from './founder-gold-v1.data'

export const FOUNDER_GOLD_VERSION = 'founder-gold-v1'

export type FounderGoldVerdict = 'pass' | 'edit' | 'decline'
export type FounderGoldRow = {
  n: number
  queueId: string
  verdict: FounderGoldVerdict
  hardDefect: boolean
  reason: string | null
  runAt: string
  source: {
    title: string; body: string; site: string
    postedAt: string | null; capturedAt: string | null; imageCount: number | null
  }
  draft: { title: string; body: string }
  plan: {
    personaCode: string; stance: string | null; selfBasis: string | null
    closingIntent: string | null; contentRoles: readonly string[]
    universalReason: string
    protectedFacts: readonly { kind: string; text: string; evidenceRef: string }[]
    warrants: readonly { fact: string; requiredValue?: string; evidenceRef?: string; evidenceText?: string }[]
  }
  card: DraftGateCard & { code: string }
}

/** 🔴 창업자가 확정한 모양 — 데이터가 이것과 다르면 gold 가 아니다(좋은 행만 골라 바꾸지 못한다) */
export const FOUNDER_GOLD_SHAPE = {
  size: 30,
  pass: [2, 3, 6, 7, 8, 9, 11, 12, 13, 14, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 29, 30],
  edit: [15, 16],
  decline: [1, 4, 5, 10, 22, 28],
  hardDefect: [4, 10, 28],
  queueIds: [
    'cmuku6r9r00032yeiq5eybf0b', 'cmuku6rbp00052yeimjryc8g2', 'cmuku6rdk00072yei9clknzpw', 'cmuku9ahb00032ywkv02ohyqi',
    'cmuku9aj900052ywk34j35ts1', 'cmuku9al500072ywkrx2pmvmo', 'cmuku9and00092ywk96vvnr44', 'cmukubgca00032yu4aewfkndk',
    'cmukubgea00052yu4w5tj50ax', 'cmukubggb00072yu4yhg9xoeo', 'cmukubgi700092yu4nbtx3eeu', 'cmukubgk2000b2yu40sppjgyj',
    'cmukud83100032ycgjgcdutba', 'cmukud84r00052ycg4b7d567z', 'cmukud86h00072ycgr4p1a7pl', 'cmukuf4v600012y59yo154b1a',
    'cmukuf4wv00032y591g7x3tjb', 'cmukuf4yk00052y595hx7osy0', 'cmukuh13900012ynceqb1f99h', 'cmukuh15f00032yncl0ah2xt9',
    'cmukuh17e00052yncnqt5mgjh', 'cmukuh1b200092ynccj15pmvx', 'cmukuh1cv000b2ynczvnc6ig9', 'cmukuj0jw00032yujutmu6diy',
    'cmukuj0lj00052yujbb7ninxk', 'cmukuj0n700072yujcoh2yt1d', 'cmukuj0ov00092yuje7pngj69', 'cmukuktu400012ym8grtkqddv',
    'cmukuktvt00032ym8yna5v5ad', 'cmukuktxl00052ym8uuex129k',
  ],
} as const

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

export function founderGoldDigestOf(rows: readonly FounderGoldRow[]): string {
  return createHash('sha256').update(stableJson(rows), 'utf8').digest('hex')
}
/**
 * 🔴 **고정 digest** — 데이터 파일을 한 글자라도 바꾸면 여기와 달라져 재생이 실패한다(닫힘).
 *    이 값을 고치려면 판을 올려야 한다 — 품질 계약 digest 에 이 값이 들어간다.
 */
export const FOUNDER_GOLD_PINNED_DIGEST = '18124b3d4e9873bf2f015df0f8f173958e94c8d04640a1aebf5e271b014c2df5'

export type GoldClass = 'pass' | 'review' | 'hold'
export type GoldRowResult = { n: number; queueId: string; want: 'pass' | 'hold' | 'notAuto'; got: GoldClass; ok: boolean; codes: string[] }
export type FounderGoldReplay = {
  version: string
  digest: string
  pass: boolean
  results: GoldRowResult[]
  counts: { ok: number; overBlockedPass: number; leakedHard: number; autoReadyNonPass: number }
  reasons: string[]
}

/** 🔴 창업자 판정 → 자동 경로의 기대. 통과는 통과 · 중대 결함은 확정 차단 · 나머지(수정·폐기)는 자동 READY 가 아님 */
export const goldWant = (r: Pick<FounderGoldRow, 'verdict' | 'hardDefect'>): GoldRowResult['want'] =>
  r.hardDefect ? 'hold' : r.verdict === 'pass' ? 'pass' : 'notAuto'

/** 🔴 한 행 — 운영 채택 판정과 같은 입력(원본 초안 · 계획 · 그날 카드 · 원천 · 회차 시각) */
export function judgeGoldRow(r: FounderGoldRow): { cls: GoldClass; codes: string[] } {
  const s = r.source
  const out = judgeDraftLife({
    title: r.draft.title, body: r.draft.body,
    plan: { selfBasis: r.plan.selfBasis, warrants: r.plan.warrants, closingIntent: r.plan.closingIntent, contentRoles: r.plan.contentRoles },
    card: r.card,
    context: {
      at: new Date(r.runAt),
      source: {
        title: s.title, body: s.body, site: s.site, imageCount: s.imageCount,
        postedAt: s.postedAt === null ? null : new Date(s.postedAt),
        capturedAt: s.capturedAt === null ? null : new Date(s.capturedAt),
      },
    },
  })
  const cls: GoldClass = out.failures.length > 0 ? 'hold' : out.reviews.length > 0 ? 'review' : 'pass'
  return { cls, codes: [...out.failures.map((f) => `hold:${f.code}`), ...out.reviews.map((f) => `review:${f.code}`)] }
}

/** 🔴 모양 검사 — 순서 · id · 판정 · 결함이 창업자 확정값과 같은가 */
export function founderGoldShapeProblems(rows: readonly FounderGoldRow[]): string[] {
  const bad: string[] = []
  const S = FOUNDER_GOLD_SHAPE
  if (rows.length !== S.size) bad.push(`행 수 ${rows.length} ≠ ${S.size}`)
  rows.forEach((r, i) => {
    if (r.n !== i + 1) bad.push(`#${i + 1} 순서가 ${r.n}`)
    if (r.queueId !== S.queueIds[i]) bad.push(`#${i + 1} queueId 가 다르다`)
    const v: FounderGoldVerdict = (S.pass as readonly number[]).includes(r.n) ? 'pass' : (S.edit as readonly number[]).includes(r.n) ? 'edit' : 'decline'
    if (r.verdict !== v) bad.push(`#${r.n} 판정 ${r.verdict} ≠ 창업자 ${v}`)
    if (r.hardDefect !== (S.hardDefect as readonly number[]).includes(r.n)) bad.push(`#${r.n} 중대 결함 표시가 다르다`)
  })
  return bad
}

/**
 * 🔴 **재생** — 모양 · 고정 digest · 30행 기대를 전부 본다. 하나라도 어긋나면 `pass=false`(닫힘).
 *    `rows` 는 검사가 변조 반례를 넣을 때만 준다 — 운영은 늘 정본 데이터다.
 */
export function replayFounderGold(rows: readonly FounderGoldRow[] = FOUNDER_GOLD_V1_ROWS): FounderGoldReplay {
  const reasons: string[] = []
  const digest = founderGoldDigestOf(rows)
  if (digest !== FOUNDER_GOLD_PINNED_DIGEST) reasons.push(`창업자 gold digest ${digest.slice(0, 12)}… ≠ 고정값 ${FOUNDER_GOLD_PINNED_DIGEST.slice(0, 12)}… — gold 가 바뀌었다`)
  reasons.push(...founderGoldShapeProblems(rows))
  const results: GoldRowResult[] = rows.map((r) => {
    const want = goldWant(r)
    const { cls, codes } = judgeGoldRow(r)
    const ok = want === 'pass' ? cls === 'pass' : want === 'hold' ? cls === 'hold' : cls !== 'pass'
    return { n: r.n, queueId: r.queueId, want, got: cls, ok, codes }
  })
  const counts = {
    ok: results.filter((x) => x.ok).length,
    overBlockedPass: results.filter((x) => x.want === 'pass' && x.got !== 'pass').length,
    leakedHard: results.filter((x) => x.want === 'hold' && x.got !== 'hold').length,
    autoReadyNonPass: results.filter((x) => x.want !== 'pass' && x.got === 'pass').length,
  }
  for (const x of results.filter((y) => !y.ok)) reasons.push(`#${x.n} 기대 ${x.want} · 지금 ${x.got} ${x.codes.join(',')}`)
  return { version: FOUNDER_GOLD_VERSION, digest, pass: reasons.length === 0, results, counts, reasons }
}

/** 한 줄 요약 — 화면·로그용 */
export function describeFounderGold(g: FounderGoldReplay): string {
  return `${g.version} · ${g.counts.ok}/${g.results.length} · 통과 과차단 ${g.counts.overBlockedPass} · 결함 누출 ${g.counts.leakedHard}`
    + ` · 수정·폐기 자동 READY ${g.counts.autoReadyNonPass} · ${g.pass ? '재현' : '불일치'}`
}
