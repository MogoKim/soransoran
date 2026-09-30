#!/usr/bin/env tsx
/**
 * 🔴 **원천 기회 → 공개 글 결정론적 전체 E2E (격리 Postgres 전용)** (2026-09-30 Lane B)
 *
 *   실제 list artifact → sourceEvidence → 슬롯 순위 → JIT 생성(가짜 provider · 유료 0) → READY →
 *   발행 직전 재검사 → 첫 후보 만료 → 같은 회차 다음 후보 → 공개 글 → release 도장 · 감사 증거.
 *
 *   🔴 **시계는 주입이다** — 공급 러너 · 생성 · 적재 · 발행 러너가 같은 `SORAN_RUN_AT` 규칙을 쓴다.
 *      "실제 시각이라 흔들린다" 로 생략하지 않는다(앞판 러너 사슬 검사는 벽시계에 묶여 CI 밖이었다).
 *   🔴 **판정을 복제하지 않는다** — 수집기 · 얇은 러너가 부르는 함수로 artifact 를 만들고, 공급 러너
 *      (`supply-process.mts --live`) · 발행 러너(`original-post-auto-publish.mts --apply`)를 **프로세스로** 돌린다.
 *   🔴 운영 DB 에 절대 붙이지 않는다(sentinel · localhost · soran_test). provider 는 가짜(`fake-provider-hook`) —
 *      네트워크 0 · 유료 0 · 운영 장부 0. 임시 cwd · 임시 HOME · 합성 말투 자산(실제 댓글 0) · 합성 원문(실제 글 0).
 *
 *   시나리오 ①~⑩ 은 아래 `SCENARIOS` 머리말에 적었다. `publish:slot-db-check` 가 이 파일을 실행한다(CI 연결).
 */
import { createHash } from 'node:crypto'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markedStageEnv } from './lib/stage-decision-fixture'

// ── 🔴 격리 가드 — 주소를 찍지 않는다 ──
const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

const REPO = process.cwd()
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
const K = (s: string): Date => new Date(`${s}+09:00`)
const H = 3_600_000

/** 🔴 고정 시각 — 2026-10-01(목) KST. d3 슬롯 09:30 · 13:30 · 19:00 */
const LIST_NC = K('2026-10-01T07:00:00') // 네이버 카페 목록 회차
const LIST_82 = K('2026-10-01T07:05:00') // 82cook 목록 회차
const SUPPLY_AT = K('2026-10-01T08:00:00') // 공급 러너(JIT 생성) 회차
const PUBLISH_AT = K('2026-10-01T09:31:00') // 첫 슬롯(09:30) 발행 러너 회차
const iso = (d: Date): string => d.toISOString()
const utcRun = (d: Date): string => iso(d).replace(/[-:]/g, '').slice(0, 15).replace('T', '-')

// ── 🔴 임시 cwd · 임시 HOME — import 전에 세운다(말투 자산 · 장부 경로가 import 때 굳는다) ──
const T = realpathSync(mkdtempSync(join(tmpdir(), 'soran-lb-e2e-cwd-')))
const HM = realpathSync(mkdtempSync(join(tmpdir(), 'soran-lb-e2e-home-')))
for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T, x), { recursive: true })
mkdirSync(join(T, 'docs', 'operations'), { recursive: true })
cpSync(join(REPO, POOL_DOC), join(T, POOL_DOC))
symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T, 'node_modules'))
const DATA = join(T, '.microseed-data')
mkdirSync(DATA, { recursive: true })
/** 🔴 합성 말투 자산 — 실제 댓글이 아니다. 화자 30명 × 4건 */
{
  const refDir = join(HM, 'Library', 'Application Support', 'soransoran', 'persona-reference')
  mkdirSync(refDir, { recursive: true })
  chmodSync(refDir, 0o700)
  const comments: { speakerId: string; content: string }[] = []
  for (let i = 0; i < 30; i += 1) {
    const sid = createHash('sha256').update(`fixture-speaker-${i}`).digest('hex').slice(0, 12)
    for (let k = 0; k < 4; k += 1) comments.push({ speakerId: sid, content: `그렇죠 맞는 말씀이에요 ${i}-${k}` })
  }
  const corpusRaw = JSON.stringify({ version: 1, comments })
  writeFileSync(join(refDir, 'corpus.json'), corpusRaw, { mode: 0o600 })
  writeFileSync(join(refDir, 'manifest.json'), JSON.stringify({
    sourceDigest: createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16),
  }), { mode: 0o600 })
}
process.env.HOME = HM
process.chdir(T)

const { PrismaClient } = await import('@prisma/client')
const { loadVoice } = await import('./lib/voice-runtime.mjs')
const { PROVIDER_KEY_ENV } = await import('./lib/voice-m3-provider.mjs')
const { LAST_SLOT_SCHEDULED_ENV } = await import('./lib/fake-scheduled-slot-env.mjs')
const { parseListHtml, buildListRow } = await import('./lib/micro-seed-82cook.mjs')
const { fixture82cookListHtml } = await import('./lib/fixture-82cook-list.mjs')
const { classifyDetail } = await import('./lib/micro-seed-detail-classify.mjs')
const { maskSensitive, BODY_HEAD_CHARS } = await import('./lib/micro-seed-raw-originality.mjs')
const { toThinRow } = await import('../src/lib/micro-seed-82cook-thin')
const { sourceTimesOf, thinRowFromCollected } = await import('../src/lib/micro-seed-navercafe-thin')
const { SOURCE_EVIDENCE_KEY, RELEASE_STAMP_KEY, RELEASE_CONTRACT, releaseStampStatusOf, publishEventAtOf, parseEvidence } = await import('../src/lib/source-slot-release')
const { MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE } = await import('../src/lib/micro-seed-supply-autofill')
const { HUMAN_DECIDER, AUTO_DECIDER } = await import('../src/lib/auto-ready-v2')
const { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf, digestOf: evDigest } = await import('../src/lib/auto-ready-evidence')
const { currentQualityContract, QUALITY_CONTRACT_KEY } = await import('../src/lib/quality-contract')

const prisma = new PrismaClient()
const fakeKeys = Object.fromEntries([...new Set(Object.values(PROVIDER_KEY_ENV as Record<string, string>))].map((k) => [k, 'fixture-not-a-key']))

// ─────────────────────────────────────────────────────────
// 🔴 합성 원문 — 생활 이야기 · 안전 판정을 지나는 문장 · 실제 글 0
// ─────────────────────────────────────────────────────────
type Src = { id: string; title: string; body: string; postedAt: Date; comments: number; views: number }
const BODY = (topic: string): string => `${topic} 이야기예요. 요즘 아침저녁으로 선선해져서 산책을 나가는데 무릎이 조금 시큰해요. `
  + '동네 친구들은 다들 어떻게 지내는지 궁금해서 적어 봅니다. 저는 요즘 저녁을 가볍게 먹고 일찍 자려고 하는데 잠이 잘 안 와요. '
  + '비슷한 분 계시면 어떻게 하시는지 이야기 나눠요. 다들 어떠세요?'

/** 네이버 카페 — 후보 넷(댓글 순위가 갈리게) + 같은 카페의 다른 글 여덟(비교 표본) */
const NC: Src[] = [
  { id: 'nc901', title: '요즘 잠이 안 와서 고민이에요', body: BODY('잠'), postedAt: K('2026-10-01T05:10:00'), comments: 42, views: 900 },
  { id: 'nc902', title: '김장 준비 벌써 하시나요', body: BODY('김장'), postedAt: K('2026-10-01T05:40:00'), comments: 25, views: 600 },
  { id: 'nc903', title: '가을 산책길 추천해 주세요', body: BODY('산책'), postedAt: K('2026-10-01T06:10:00'), comments: 12, views: 300 },
  { id: 'nc904', title: '저녁 메뉴 뭐 하세요', body: BODY('저녁'), postedAt: K('2026-10-01T06:20:00'), comments: 4, views: 120 },
]
/** 🔴 같은 카페 표본 — 댓글 60 인 글이 있어 네이버 후보는 백분위 1 이 아니다(82cook 9300001 이 유일한 선두) */
const NC_POP = [0, 1, 2, 3, 5, 8, 13, 60].map((c, k) => ({ id: `ncp${k}`, comments: c, views: c * 20 + 10, postedAt: K('2026-10-01T05:30:00') }))

function writeNavercafe(): void {
  const listed = iso(LIST_NC)
  const rows = [...NC, ...NC_POP.map((p) => ({ ...p, title: `다른 글 ${p.id}`, body: '' }))].map((s, k) => ({
    // 🔴 네이버 카페 수집기(`buildCollected`)가 쓰는 목록 줄 칸 그대로 — 제목 · 본문은 합성
    sourceSite: 'navercafe:wgang', sourceArticleId: s.id, sourceUrl: `https://example.invalid/nc/${s.id}`,
    sourceBoardName: '자유게시판', sourceCommentCount: s.comments, originalTitle: s.title, rawBody: '',
    sourceCapturedAt: listed, dedupKey: `navercafe:wgang|${s.id}`, qualityFlags: [], qualitySignals: {},
    sourceListedAt: listed, sourcePostedLabel: '05:10', sourcePostedAt: iso(s.postedAt), sourcePage: 1, sourceRankOnPage: k + 1,
    sourceViewCount: s.views, sourceCommentCountRead: true, sourceRunId: 'lb-nc', sourceRowLabel: null, sourcePinned: false,
    sourceMenuId: '1', sourceBoardKey: 'free', sourcePoliticsExcluded: false, sourceExcludeReason: null,
  }))
  writeFileSync(join(DATA, `navercafe-wgang-${utcRun(LIST_NC)}.list.jsonl`), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
  // 🔴 수집기가 같은 회차에 쓰는 얇은 행 — 정본 조립 함수(`thinRowFromCollected`) · 정본 판정(`classifyDetail`)
  const thin = NC.map((s) => {
    const r = rows.find((x) => x.sourceArticleId === s.id)!
    const masked = maskSensitive(s.body)
    const v = classifyDetail({ title: s.title, body: masked, comments: [], imageCount: 0, boardName: '자유게시판', qualityFlags: [], access: 'ok' })
    return thinRowFromCollected({
      collected: { ...r, rawBody: s.body }, maskedBody: masked, bodyHeadChars: BODY_HEAD_CHARS,
      axis: String(v.axis), safetyVerdict: String(v.safety.verdict), safetyReasons: v.safety.reasons.map(String),
      reason: String(v.reason), runId: 'lb-nc', fetchedAt: listed,
    })
  })
  writeFileSync(join(DATA, `navercafe-thin-wgang-${utcRun(LIST_NC)}.thin-detail.jsonl`), `${thin.map((r) => JSON.stringify(r)).join('\n')}\n`)
}

/** 82cook — 실제 페이지 구조 fixture → 수집기 조립(parseListHtml → buildListRow) · 얇은 러너 조립(toThinRow + sourceTimesOf) */
const C82 = [
  { id: '9300001', kst: '2026-10-01 06:31:00', label: '06:31:00', comments: 31, views: 820, title: '갱년기 열감 어떻게 버티세요' },
  { id: '9300002', kst: '2026-10-01 06:12:00', label: '06:12:00', comments: 9, views: 240, title: '아침 운동 시작했어요' },
  { id: '9300003', kst: '2026-10-01 05:58:00', label: '05:58:00', comments: 0, views: 35, title: '다른 글 하나' },
  { id: '9300004', kst: '2026-10-01 05:40:00', label: '05:40:00', comments: 2, views: 60, title: '다른 글 둘' },
  { id: '9300005', kst: '2026-10-01 05:20:00', label: '05:20:00', comments: 5, views: 90, title: '다른 글 셋' },
  { id: '9300006', kst: '2026-10-01 05:02:00', label: '05:02:00', comments: 1, views: 44, title: '다른 글 넷' },
]
function write82cook(): void {
  const listed = iso(LIST_82)
  const items = parseListHtml(fixture82cookListHtml(C82.map((c) => ({ id: c.id, kst: c.kst, label: c.label, comments: c.comments, views: c.views }))))
  const rows = items.map((i) => buildListRow({ ...i, sourcePage: 1 }, listed) as unknown as Record<string, unknown>)
  // 🔴 손상된 목록 줄 — 공급 러너가 죽지 않고 세기만 해야 한다(④ 공급 쪽)
  const junk = ['null', '[1]', JSON.stringify({ sourceSite: '82cook', sourceArticleId: 'x1', sourceListedAt: '어제' }), '{"sourceSite":']
  writeFileSync(join(DATA, '82cook.list.jsonl'), `${[...rows.map((r) => JSON.stringify(r)), ...junk].join('\n')}\n`)
  const thin = C82.slice(0, 2).map((c) => {
    const r = rows.find((x) => x.sourceArticleId === c.id)!
    const body = BODY(c.title)
    const masked = maskSensitive(body)
    const v = classifyDetail({ title: c.title, body: masked, comments: [], imageCount: 0, boardName: '자유게시판', qualityFlags: [], access: 'ok' })
    return toThinRow({
      id: c.id, url: String(r.sourceUrl), title: c.title, commentCount: Number(r.sourceCommentCount), score: 0,
      maskedBody: masked, bodyHeadChars: BODY_HEAD_CHARS, axis: String(v.axis), safetyVerdict: String(v.safety.verdict),
      safetyReasons: v.safety.reasons.map(String), reason: String(v.reason), runId: 'lb-82', fetchedAt: iso(new Date(LIST_82.getTime() + 40 * 60_000)),
      times: sourceTimesOf(r),
    })
  })
  writeFileSync(join(DATA, `82cook-thin-${utcRun(LIST_82)}.thin-detail.jsonl`), `${thin.map((r) => JSON.stringify(r)).join('\n')}\n`)
}

// ─────────────────────────────────────────────────────────
// DB 시드
// ─────────────────────────────────────────────────────────
const wipe = (): Promise<unknown> => prisma.$executeRawUnsafe(
  'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User","PersonaGlobalSwitch" CASCADE',
)
let seq = 0
async function seedPersonas(): Promise<string[]> {
  const codes = loadVoice(SUPPLY_AT).candidates.map((c) => c.code)
  for (const code of codes) {
    const u = await prisma.user.create({ data: { nickname: `lb${code}` }, select: { id: true } })
    await prisma.persona.create({ data: { code, userId: u.id, status: 'active' } })
  }
  return codes
}
/** 🔴 자동 READY 증거 30건 — 사람이 검토해 발행한 행(`auto-ready:runner-check` 와 같은 모양) */
async function seedAutoReadyEvidence(): Promise<void> {
  const author = (await prisma.user.create({ data: { nickname: '증거' }, select: { id: true } })).id
  const SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }
  for (let i = 0; i < 30; i += 1) {
    seq += 1
    const raw = await prisma.microSeedRawContent.create({
      data: { origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:t`, sourceUrl: `https://example.invalid/ev${seq}`, sourceArticleId: `ev${seq}-r`, sourceCapturedAt: new Date(SUPPLY_AT.getTime() - 40 * 864e5), rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}` },
      select: { id: true },
    })
    const p = await prisma.post.create({ data: { boardType: 'FREE', title: `사람이 본 글 ${i}`, content: `사람이 본 본문 ${i}`, authorId: author }, select: { id: true } })
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: raw.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
        gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: HUMAN_DECIDER, createdPostId: p.id, dedupKey: `ev-${seq}`,
        gateResults: { holds: [], blocks: [], semanticReview: SR, [QUALITY_CONTRACT_KEY]: currentQualityContract(), autoDraft: {
          provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision, draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
        } } as never,
        createdAt: new Date(SUPPLY_AT.getTime() - 60 * 864e5 + i * 60_000),
        editDiff: { [EVIDENCE_REVIEW_KEY]: [{
          contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'fixture-founder',
          ...bindingOf({ status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`, editedTitle: null, editedBody: null, declineReason: null }),
          hardDefect: 'no', reasons: [], bundleDigest: evDigest('fixture-bundle'), reviewedAt: '2026-09-25T00:00:00Z',
        }] } as never,
      },
    })
  }
}

// ─────────────────────────────────────────────────────────
// 러너 — 🔴 격리 DB 주소 · 주입 시각 · 가짜 provider 만 담은 env
// ─────────────────────────────────────────────────────────
const baseEnv = (): Record<string, string> => ({
  PATH: process.env.PATH ?? '', HOME: HM, DATABASE_URL: URL, DIRECT_URL: URL, SORAN_ISOLATED_DB: 'yes-throwaway',
  // 🔴 운영과 같은 경로 — 단계 칸은 StageDecision consumer 가 표식과 함께 넣은 값만 읽힌다(표식 없으면 d1)
  ...markedStageEnv({ SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd3' }, '2026-10-01'),
})
function runSupply(at: Date, extra: Record<string, string> = {}): { code: number; out: string } {
  const r = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), [join(T, 'scripts', 'supply-process.mts'), '--live'], {
    cwd: T, encoding: 'utf-8', timeout: 900_000,
    env: {
      ...baseEnv(), ...fakeKeys, SORAN_RUN_AT: iso(at), SORAN_SUPPLY_PROCESS_ENABLED: 'true',
      SORAN_LLM_DAILY_BUDGET_USD: '1000', SORAN_LLM_RESERVE_HEADROOM: '1.5', SORAN_LLM_RUN_REQUEST_CAP: '20',
      FAKE_PROVIDER_JUDGE_DECISION: 'AUTO_SEED', FAKE_PROVIDER_VARY_TITLE: '1',
      NODE_OPTIONS: `--import=${join(REPO, 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
      ...LAST_SLOT_SCHEDULED_ENV, ...extra,
    },
  })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const { judgeSlotRelease, compareReleaseRank } = await import('../src/lib/source-slot-release')
const { publishOriginalPostTx } = await import('../src/lib/original-post-publish-tx')
const { safetyFilter } = await import('./lib/micro-seed-safety-filter.mjs')

function runPublish(at: Date, extra: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const c = spawn(join(REPO, 'node_modules', '.bin', 'tsx'), [join(T, 'scripts', 'original-post-auto-publish.mts'), '--apply', '--limit=1', '--trigger=local'], {
      cwd: T, env: { ...baseEnv(), SORAN_RUN_AT: iso(at), SORAN_AUTO_READY_ENABLED: 'on', ...extra },
    })
    let out = ''
    c.stdout.on('data', (d: Buffer) => { out += d.toString() })
    c.stderr.on('data', (d: Buffer) => { out += d.toString() })
    c.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

type Row = {
  id: string; status: string; decidedBy: string | null; createdPostId: string | null; gateVerdict: string; draftTitle: string
  gateResults: Record<string, unknown>; declineReason: string | null; matchedPersonaId: string | null; matchedAt: Date | null; updatedAt: Date
  rawContent: { sourceSite: string; sourceArticleId: string } | null
}
/** 🔴 공급 러너가 적재한 행만(증거 cohort 30건 제외) */
const generated = async (): Promise<Row[]> => (await prisma.originalPostApprovalQueue.findMany({
  // 🔴 증거 cohort(사람 검토 30건 · dedupKey `ev-`)만 뺀다 — 결정자로 거르면 founder 로 바꾼 행이 사라진다
  where: { NOT: { dedupKey: { startsWith: 'ev-' } } },
  select: {
    id: true, status: true, decidedBy: true, createdPostId: true, gateVerdict: true, draftTitle: true, gateResults: true,
    declineReason: true, matchedPersonaId: true, matchedAt: true, updatedAt: true, rawContent: { select: { sourceSite: true, sourceArticleId: true } },
  },
  orderBy: { createdAt: 'asc' },
})) as unknown as Row[]
const srcId = (r: Row): string => (r.rawContent?.sourceArticleId ?? '').replace(/-[0-9a-f]{8}$/, '')
const evOf = (r: Row): Record<string, unknown> | null => {
  const e = r.gateResults?.[SOURCE_EVIDENCE_KEY]
  return e !== null && typeof e === 'object' ? e as Record<string, unknown> : null
}
/** 🔴 정본 판정으로 그 시각의 순위를 낸다 — 기대값 계산일 뿐 러너 대신 고르지 않는다 */
const rankAt = (rows: readonly Row[], at: Date): Row[] => rows
  .map((r) => ({ r, v: judgeSlotRelease({ gateResults: r.gateResults, slotAt: at, now: at, hardGates: { ok: true, codes: [] }, assignment: 'pending', tieBreak: r.id }) }))
  .filter((x) => x.v.verdict === 'eligible')
  .sort((a, b) => compareReleaseRank(a.v.rank, b.v.rank))
  .map((x) => x.r)
const patchGate = async (id: string, f: (g: Record<string, unknown>) => Record<string, unknown>): Promise<void> => {
  const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { gateResults: true } })
  await prisma.originalPostApprovalQueue.update({ where: { id }, data: { gateResults: f(r.gateResults as Record<string, unknown>) as never } })
}
const postsNow = (): Promise<number> => prisma.post.count({ where: { title: { not: { startsWith: '사람이 본 글' } } } })
const logsNow = (): Promise<number> => prisma.personaActivityLog.count({ where: { kind: 'post' } })
const LEDGER = join(HM, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
const dump = (name: string, out: string): void => { if (process.env.E2E_VERBOSE === '1') writeFileSync(join(tmpdir(), `lb-${name}.txt`), out) }

/** 🔴 시나리오마다 새 세계 — DB 비움 · 데이터 디렉터리 · 장부 새로 · 같은 artifact */
async function world(label: string, supplyEnv: Record<string, string> = {}): Promise<{ sup: { code: number; out: string } }> {
  console.log(`\n── ${label} ──`)
  await wipe()
  rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  rmSync(LEDGER, { recursive: true, force: true })
  await seedPersonas()
  await seedAutoReadyEvidence()
  writeNavercafe()
  write82cook()
  writeFileSync(join(DATA, 'held-candidates.json'), '{"held":[]}\n')
  const sup = runSupply(SUPPLY_AT, supplyEnv)
  dump(`supply-${label.slice(0, 1)}`, sup.out)
  return { sup }
}

/** 🔴 발행된 행 하나의 정합 — 공개 글 · 큐 · ActivityLog · release 도장이 같은 한 사건을 가리킨다 */
/**
 * `presetMatchedAt` — 이미 배정된 복구 행이면 그 배정 시각(트랜잭션이 바꾸지 않는다). 없으면 트랜잭션이 그 시각에 배정했다.
 */
async function consistent(queueId: string, tag: string, presetMatchedAt: Date | null = null): Promise<void> {
  const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: queueId }, select: { status: true, createdPostId: true, matchedPersonaId: true, matchedAt: true, gateResults: true } })
  const post = q.createdPostId === null ? null : await prisma.post.findUnique({ where: { id: q.createdPostId }, select: { id: true, authorId: true, content: true, title: true } })
  const persona = q.matchedPersonaId === null ? null : await prisma.persona.findUnique({ where: { id: q.matchedPersonaId }, select: { id: true, userId: true } })
  const logs = post === null ? [] : await prisma.personaActivityLog.findMany({ where: { kind: 'post', targetId: post.id }, select: { personaId: true, createdAt: true, publishedAt: true } })
  const g = q.gateResults as Record<string, unknown>
  const stamp = g[RELEASE_STAMP_KEY] as Record<string, unknown> | undefined
  check(`🔴 🔴 **[${tag}] ⑩ 정합 — Queue PUBLISHED · Post 1 · 작성자 = 배정 Persona · ActivityLog 1(같은 Persona · 같은 글)**`,
    q.status === 'PUBLISHED' && post !== null && persona !== null && post.authorId === persona.userId
    && logs.length === 1 && logs[0]!.personaId === persona.id, JSON.stringify({ s: q.status, p: post?.id, logs: logs.length }))
  check(`🔴 🔴 **[${tag}] ⑩ release 도장 — source-slot-v1 · eligible · 판정 시각 = 공개 시각(ActivityLog publishedAt · createdAt) = 배정 시각(복구 행은 기존 배정 그대로)**`,
    stamp?.contract === RELEASE_CONTRACT && stamp?.verdict === 'eligible' && stamp?.issue === null
    && releaseStampStatusOf(g, publishEventAtOf(logs)) === 'STAMPED_ELIGIBLE'
    && logs[0]?.publishedAt?.toISOString() === stamp?.evaluatedAt && logs[0]?.createdAt.toISOString() === stamp?.evaluatedAt
    && q.matchedAt?.toISOString() === (presetMatchedAt === null ? stamp?.evaluatedAt : presetMatchedAt.toISOString()) && stamp?.slotAt === stamp?.evaluatedAt,
    JSON.stringify({ stamp, pub: logs[0]?.publishedAt, log: logs[0]?.createdAt, m: q.matchedAt }))
  const ev = JSON.stringify(g[SOURCE_EVIDENCE_KEY])
  check(`🔴 [${tag}] 공개 글 · 증거에 원문 제목 · 원문 id · URL 이 없다`,
    post !== null && ![...NC, ...C82].some((s) => post.title.includes(s.title) || post.content.includes(s.title))
    && !ev.includes('example.invalid') && !ev.includes('82cook.com')
    && ![...NC.map((s) => s.id), ...C82.map((c) => c.id)].some((id) => ev.includes(`"${id}"`)))
}

async function main(): Promise<void> {
  console.log('\n══ 원천 기회 → 공개 글 결정론적 E2E (격리 DB · 주입 시계 · 가짜 provider · 유료 0) ══')
  console.log(`   목록 네이버 ${iso(LIST_NC)} · 82cook ${iso(LIST_82)} · 공급 ${iso(SUPPLY_AT)} · 발행 ${iso(PUBLISH_AT)} (d3 슬롯 09:30 KST)`)

  // ── ① ⑤ ⑩ 정상 — JIT 생성 후 같은 슬롯 발행 ──
  {
    const { sup } = await world('① ⑤ ⑩ 정상 후보 — 목록 artifact → 증거 → 슬롯 순위 → JIT 생성 → READY → 같은 슬롯 발행')
    check('공급 러너 정상 종료(exit 0)', sup.code === 0, sup.out.split('\n').slice(-20).join('\n'))
    check('🔴 JIT — 공급 러너가 다가오는 슬롯 수요로 생성했다(READY 0 → 수요 > 0)', /생성 수요 [1-9]\d*건/.test(sup.out), (/수요 .*/.exec(sup.out) ?? [''])[0])
    const opp = readdirSync(DATA).find((f) => /^supply-opportunities-.*\.json$/.test(f))
    const oppJson = opp === undefined ? null : JSON.parse(readFileSync(join(DATA, opp), 'utf-8')) as { slotAt: string; evidence: unknown[] }
    check('🔴 원천 기회 스냅샷의 예정 슬롯 = 09:30 KST(다음 열린 슬롯) · 원문 없는 증거 기록만',
      oppJson?.slotAt === iso(K('2026-10-01T09:30:00')) && (oppJson?.evidence.length ?? 0) >= 4
      && !JSON.stringify(oppJson).includes('example.invalid'), JSON.stringify({ slot: oppJson?.slotAt, n: oppJson?.evidence.length }))
    check('🔴 손상된 목록 줄(null · 배열 · 모양 틀림)이 있어도 공급 러너가 죽지 않고 센다(④ 공급 쪽)', sup.code === 0 && /못 읽음 [1-9]/.test(sup.out))
    const rows = await generated()
    const c82 = rows.filter((r) => r.rawContent?.sourceSite.endsWith('82cook'))
    const ncs = rows.filter((r) => r.rawContent?.sourceSite.endsWith('navercafe:wgang'))
    check('🔴 두 원천 모두 생성 · 적재됐다(82cook · 네이버 카페) — 기계 초안 APPROVED', c82.length >= 1 && ncs.length >= 1 && rows.every((r) => r.status === 'APPROVED'), rows.map((r) => `${r.rawContent?.sourceSite}:${srcId(r)}`).join(','))
    check('🔴 모든 적재 행의 sourceEvidence 가 모양 확인을 지난다', rows.every((r) => parseEvidence(evOf(r)).ok))
    const e82 = c82.map(evOf)
    check('🔴 🔴 **⑤ 82cook 증거 — 반응은 82cook 목록 관측(07:05)에서 · 원천 상대 표본은 82cook 줄만(자기 제외 5) · 목록 = 수집 = 목록 회차**',
      e82.length > 0 && e82.every((e) => (e?.response as Record<string, unknown>)?.observedAt === iso(LIST_82)
        && (e?.sourceStats as Record<string, unknown>)?.sourceKey === '82cook' && (e?.sourceStats as Record<string, unknown>)?.n === C82.length - 1
        && e?.listedAt === iso(LIST_82) && e?.capturedAt === iso(LIST_82)),
      JSON.stringify(e82.map((e) => [e?.postedAt, e?.response, e?.sourceStats])))
    const t = e82.find((e) => (e?.response as Record<string, unknown>)?.comments === 31)
    check('🔴 82cook 게시 시각 = 목록 title 06:31:00 KST — 수집 · 초안 시각으로 메우지 않았다', t?.postedAt === iso(K('2026-10-01T06:31:00')), String(t?.postedAt))
    check('🔴 네이버 증거 — 반응은 네이버 목록 관측(07:00) · 표본은 같은 카페 다른 글', ncs.every((r) => (evOf(r)?.response as Record<string, unknown>)?.observedAt === iso(LIST_NC)
      && (evOf(r)?.sourceStats as Record<string, unknown>)?.sourceKey === 'navercafe:wgang'))
    const expected = rankAt(rows, PUBLISH_AT)
    check('발행 시각에 적재 행 전부 eligible(원천 나이 < 72h · 반응 · 동력)', expected.length === rows.length, `${expected.length}/${rows.length}`)

    const pub = await runPublish(PUBLISH_AT)
    dump('pub-1', pub.out)
    check('발행 러너 정상 종료(exit 0) · 자동 READY 도장이 찍혔다', pub.code === 0 && /도장 stamped [1-9]/.test(pub.out), pub.out.split('\n').filter((l) => /중단|도장|발행하지/.test(l)).join(' | '))
    const after = await generated()
    const published = after.filter((r) => r.status === 'PUBLISHED')
    check('🔴 🔴 **① 같은 슬롯(09:30)에 정확히 1건 발행** — Post 1 · ActivityLog 1', published.length === 1 && (await postsNow()) === 1 && (await logsNow()) === 1,
      `${published.length} · ${await postsNow()} · ${await logsNow()}`)
    check('🔴 🔴 **발행된 행 = 정본 순위 1위** (댓글 백분위 → 조회 백분위 → 슬롯 나이)', published[0]?.id === expected[0]?.id,
      `발행 ${published[0] === undefined ? '-' : srcId(published[0])} · 기대 ${expected[0] === undefined ? '-' : srcId(expected[0])}`)
    check('🔴 🔴 **⑤ 82cook artifact 가 정상 후보로 발행까지 갔다**', published[0]?.rawContent?.sourceSite.endsWith('82cook') === true && srcId(published[0]!) === '9300001')
    if (published[0] !== undefined) await consistent(published[0].id, '①')
    check('나머지 행은 그대로 기다린다(만료 0)', after.filter((r) => r.status === 'APPROVED').length === rows.length - 1 && after.every((r) => r.status !== 'EXPIRED'))
  }

  // ── ② 첫 후보 발행 직전 만료 → 같은 회차 다음 후보 ──
  {
    const { sup } = await world('② 첫 후보가 발행 직전(트랜잭션 시각)에 만료 → 같은 회차 다음 후보')
    check('공급 러너 정상 종료', sup.code === 0)
    const order = rankAt(await generated(), PUBLISH_AT)
    const first = order[0]!
    /**
     * 🔴 계획 시각(09:31:00.000)에는 원문 나이 72h − 20ms(eligible) · 트랜잭션 시각(주입 시각 + 실제 경과 ≫ 20ms)에는 72h 이상.
     *    중첩 시각은 게시 뒤로 옮긴다(모양 · 순서는 정상) — 바뀌는 것은 "시간이 흘렀다" 하나다.
     */
    const posted = new Date(PUBLISH_AT.getTime() - 72 * H + 20)
    const after1 = iso(new Date(posted.getTime() + 1))
    await patchGate(first.id, (g) => {
      const e = g[SOURCE_EVIDENCE_KEY] as Record<string, unknown>
      return { ...g, [SOURCE_EVIDENCE_KEY]: { ...e, postedAt: iso(posted), listedAt: after1, capturedAt: after1,
        response: { ...(e.response as Record<string, unknown>), observedAt: after1 },
        observations: [{ observedAt: after1, views: 1, comments: 1 }] } }
    })
    const planOrder = rankAt(await generated(), PUBLISH_AT)
    check('전제 — 계획 시각에는 그 행이 여전히 eligible 이고 1위다(댓글 백분위 유일 선두)', planOrder[0]?.id === first.id)
    const pub = await runPublish(PUBLISH_AT)
    dump('pub-2', pub.out)
    const after = await generated()
    const f = after.find((r) => r.id === first.id)!
    const published = after.filter((r) => r.status === 'PUBLISHED')
    check('🔴 🔴 **② 첫 후보 — 트랜잭션이 EXPIRED 로 옮겼다(SOURCE_TOO_OLD_AT_SLOT) · Post 0 · 배정 풀림**',
      f.status === 'EXPIRED' && f.createdPostId === null && f.declineReason === 'RELEASE_EXPIRED:SOURCE_TOO_OLD_AT_SLOT' && f.matchedPersonaId === null,
      JSON.stringify({ s: f.status, d: f.declineReason }))
    const st = f.gateResults[RELEASE_STAMP_KEY] as Record<string, unknown> | undefined
    check('🔴 만료 행의 release 도장 — ineligible · 사유 · 판정 시각이 계획 시각보다 뒤(트랜잭션 시계)',
      st?.verdict === 'ineligible' && JSON.stringify(st?.reasons) === '["SOURCE_TOO_OLD_AT_SLOT"]' && Date.parse(String(st?.evaluatedAt)) > PUBLISH_AT.getTime()
      && releaseStampStatusOf(f.gateResults, null) === 'STALE', JSON.stringify(st))
    check('🔴 🔴 **같은 회차에 다음 후보(정본 순위 2위)가 발행됐다** — 러너 exit 0 · 교체 1건',
      pub.code === 0 && published.length === 1 && published[0]!.id === planOrder[1]?.id && /같은 회차 교체 1건/.test(pub.out),
      `${pub.code} · ${published.map(srcId).join(',')} · 기대 ${planOrder[1] === undefined ? '-' : srcId(planOrder[1])}`)
    check('🔴 슬롯은 한 번만 소비 — Post 1 · ActivityLog 1(만료 행은 로그 0)', (await postsNow()) === 1 && (await logsNow()) === 1)
    if (published[0] !== undefined) await consistent(published[0].id, '②')
  }

  // ── ③ 전원 탈락 → SLOT_UNFILLED ──
  {
    const { sup } = await world('③ 전원 탈락 — 슬롯 시각에 모든 원천이 72h 를 넘었다 → SLOT_UNFILLED')
    check('공급 러너 정상 종료', sup.code === 0)
    const late = K('2026-10-04T09:31:00')
    const pub = await runPublish(late)
    dump('pub-3', pub.out)
    const m = /SLOT_UNFILLED (\{.*\})/.exec(pub.out)
    const info = m === null ? null : JSON.parse(m[1]!) as { held: Record<string, number>; eligible: number; due: number }
    check('🔴 🔴 **③ SLOT_UNFILLED 원인 코드 · eligible 0 · 보류 전부 SOURCE_TOO_OLD_AT_SLOT · exit 0**',
      pub.code === 0 && info !== null && info.eligible === 0 && info.due === 1 && (info.held.SOURCE_TOO_OLD_AT_SLOT ?? 0) === (await generated()).length,
      m?.[1] ?? pub.out.split('\n').slice(-12).join(' | '))
    check('🔴 오래된 글로 채우지 않았다 — Post 0 · ActivityLog 0', (await postsNow()) === 0 && (await logsNow()) === 0)
  }

  // ── ④ malformed ──
  {
    const { sup } = await world('④ 손상된 sourceEvidence — 예외 없이 탈락 · 다음 후보 발행')
    check('공급 러너 정상 종료(손상 목록 줄 포함)', sup.code === 0)
    const order = rankAt(await generated(), PUBLISH_AT)
    await patchGate(order[0]!.id, (g) => ({ ...g, [SOURCE_EVIDENCE_KEY]: { ...(g[SOURCE_EVIDENCE_KEY] as object), observations: [null] } }))
    await patchGate(order[1]!.id, (g) => ({ ...g, [SOURCE_EVIDENCE_KEY]: { ...(g[SOURCE_EVIDENCE_KEY] as object), response: 'x' } }))
    const pub = await runPublish(PUBLISH_AT)
    dump('pub-4', pub.out)
    const published = (await generated()).filter((r) => r.status === 'PUBLISHED')
    check('🔴 🔴 **④ 러너가 죽지 않았다(exit 0 · TypeError 0) · 손상 두 행은 발행되지 않았다 · 3위가 발행됐다**',
      pub.code === 0 && !/TypeError|Cannot read properties/.test(pub.out) && published.length === 1 && published[0]!.id === order[2]?.id,
      `${pub.code} · ${published.map(srcId).join(',')}`)
    check('🔴 🔴 **운영 진단이 손상 위치를 식별한다** — 보류 줄 `EVIDENCE_INVALID @observations[0]:not-object` · `@response:not-object`',
      pub.out.includes(`${order[0]!.id}  [EVIDENCE_INVALID @observations[0]:not-object]`) && pub.out.includes(`${order[1]!.id}  [EVIDENCE_INVALID @response:not-object]`))
    check('🔴 러너 출력에 원문 제목 · 원문 id 가 없다', ![...NC, ...C82].some((s) => pub.out.includes(s.title) || pub.out.includes(`:${s.id}`)))
    if (published[0] !== undefined) await consistent(published[0].id, '④')
  }

  // ── ⑥ ⑦ 옛 READY · founder 표식 ──
  {
    const { sup } = await world('⑥ ⑦ 증거 없는 옛 READY · founder 표식 + 위조 도장 — release 계약을 우회하지 못한다')
    check('공급 러너 정상 종료', sup.code === 0)
    const order = rankAt(await generated(), PUBLISH_AT)
    const codeOfVoice = (r: Row): string => String(((r.gateResults.autoDraft as Record<string, unknown>)?.voice as Record<string, unknown>)?.personaCode ?? '')
    const personaOf = async (r: Row): Promise<string> => (await prisma.persona.findUniqueOrThrow({ where: { code: codeOfVoice(r) }, select: { id: true } })).id
    const legacy = order[order.length - 1]!
    const founder = order[order.length - 2]!
    // ⑥ 옛 READY — 사람 결정 · 배정까지 끝난 복구 행(줄 선두) · 증거 칸 없음(이 계약 이전 적재)
    await prisma.originalPostApprovalQueue.update({ where: { id: legacy.id }, data: {
      decidedBy: 'founder', matchedPersonaId: await personaOf(legacy), matchedAt: new Date(PUBLISH_AT.getTime() - 3 * 864e5),
      gateResults: Object.fromEntries(Object.entries(legacy.gateResults).filter(([k]) => k !== SOURCE_EVIDENCE_KEY)) as never,
    } })
    // ⑦ founder + 위조 release 도장(eligible) + 80시간 전 원문
    const old = new Date(PUBLISH_AT.getTime() - 80 * H)
    const oldAfter = iso(new Date(old.getTime() + 60_000))
    const fe = founder.gateResults[SOURCE_EVIDENCE_KEY] as Record<string, unknown>
    await prisma.originalPostApprovalQueue.update({ where: { id: founder.id }, data: {
      decidedBy: 'founder', matchedPersonaId: await personaOf(founder), matchedAt: new Date(PUBLISH_AT.getTime() - 3 * 864e5),
      gateResults: { ...founder.gateResults,
        [SOURCE_EVIDENCE_KEY]: { ...fe, postedAt: iso(old), listedAt: oldAfter, capturedAt: oldAfter,
          response: { ...(fe.response as Record<string, unknown>), observedAt: oldAfter }, observations: [] },
        [RELEASE_STAMP_KEY]: { contract: RELEASE_CONTRACT, verdict: 'eligible', slotAt: iso(PUBLISH_AT), evaluatedAt: iso(PUBLISH_AT), reasons: [], issue: null, evidenceVersion: 'source-evidence-v1' },
      } as never,
    } })
    const pub = await runPublish(PUBLISH_AT)
    dump('pub-6', pub.out)
    const after = await generated()
    const L = after.find((r) => r.id === legacy.id)!
    const F = after.find((r) => r.id === founder.id)!
    const published = after.filter((r) => r.status === 'PUBLISHED')
    check('🔴 🔴 **⑥ 증거 없는 옛 READY(사람 결정 · 배정 끝 · 복구 줄 선두)는 발행되지 않는다** — 보류 EVIDENCE_MISSING',
      L.createdPostId === null && L.status !== 'PUBLISHED' && pub.out.includes(`${legacy.id}  [EVIDENCE_MISSING]`), L.status)
    check('🔴 🔴 **⑦ founder 표식 + 위조 eligible 도장도 우회 못 한다** — 보류 SOURCE_TOO_OLD_AT_SLOT · 발행 0',
      F.createdPostId === null && F.status !== 'PUBLISHED' && pub.out.includes(`${founder.id}  [SOURCE_TOO_OLD_AT_SLOT]`), F.status)
    check('🔴 그 자리는 정본 순위 1위 기계 행이 채웠다(exit 0 · 1건)', pub.code === 0 && published.length === 1 && published[0]!.id === order[0]!.id)
    // 🔴 발행 트랜잭션을 사람 경로로 직접 불러도 — 13:31 (d3 도래 2 · 발행 1) · 계획 스냅샷 그대로
    const planOf = async (id: string) => {
      const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
      return { queueId: r.id, status: r.status, createdPostId: r.createdPostId, updatedAt: r.updatedAt, decidedBy: r.decidedBy }
    }
    const at1331 = K('2026-10-01T13:31:00')
    const env = markedStageEnv({ SORAN_RELEASE_STAGE: 'd3', SORAN_CAPACITY_STAGE: 'd3' }, '2026-10-01')
    const txF = await publishOriginalPostTx(prisma, { queueId: founder.id, publishedToday: 1, mode: { kind: 'scheduled', releaseStage: 'd3', planned: await planOf(founder.id), unattended: false }, autoReadyEnv: env }, { now: () => at1331 })
    const txL = await publishOriginalPostTx(prisma, { queueId: legacy.id, publishedToday: 1, mode: { kind: 'scheduled', releaseStage: 'd3', planned: await planOf(legacy.id), unattended: false }, autoReadyEnv: env }, { now: () => at1331 })
    check('🔴 🔴 **⑦ 사람 경로로 발행 트랜잭션을 직접 불러도 — founder 행 EXPIRED(SOURCE_TOO_OLD_AT_SLOT) · 옛 READY EXPIRED(EVIDENCE_MISSING)**',
      txF.kind === 'expired' && txF.reasons[0] === 'SOURCE_TOO_OLD_AT_SLOT' && txL.kind === 'expired' && txL.reasons[0] === 'EVIDENCE_MISSING',
      JSON.stringify([txF, txL]))
    const F2 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: founder.id }, select: { gateResults: true, status: true } })
    check('🔴 위조 도장은 트랜잭션의 진짜 판정으로 덮였다(ineligible) · 단계 증거는 STALE 로 읽는다',
      F2.status === 'EXPIRED' && ((F2.gateResults as Record<string, unknown>)[RELEASE_STAMP_KEY] as Record<string, unknown>)?.verdict === 'ineligible'
      && releaseStampStatusOf(F2.gateResults, null) === 'STALE')
    check('🔴 Post 는 러너가 낸 1건뿐', (await postsNow()) === 1 && (await logsNow()) === 1)
  }

  // ── ⑧ 동시 러너 ──
  {
    const { sup } = await world('⑧ 동시 러너 — 같은 도래 슬롯을 두 프로세스가 노린다')
    check('공급 러너 정상 종료', sup.code === 0)
    /**
     * 🔴 사람 결정 · 배정 끝(복구) 행으로 돈다 — 자동 READY 는 끈다. **이것은 시험 틀(harness)의 한계 때문이다.**
     *    (2026-09-30 야간 P1 격리 DB 재현) 기계 행 · 자동 READY 켬 · 러너 둘 동시로 돌리면 뒤 러너가 exit 1 이다:
     *      먼저 발행한 러너가 사후 감사를 고르면 `AutoReadyAudit.selectedAt` 은 **DB 기본값(DB 서버 벽시계)**이고,
     *      뒤 러너의 발행 트랜잭션은 **주입 시계**(`SORAN_RUN_AT` · 이 검사는 벽시계보다 몇 시간 뒤다)로
     *      `selectedAt < txNow − 6h` 를 본다 → "판정 없이 6시간 넘은 감사" → `AUTO_READY_RECHECK` → exit 1.
     *      (`Post.createdAt` · 발행 기록은 트랜잭션 시계로 쓴다 — 갈리는 칸은 감사 `selectedAt` 하나다.)
     *    🔴 운영에서는 생기지 않는다: 운영 러너는 시계를 주입받지 않고(launchd env 에 `SORAN_RUN_AT` 없음 · 트랜잭션 시계 = 벽시계),
     *       주입 시계 + `--apply` 는 격리 DB 가 아니면 DB 에 붙기 전에 멈춘다(아래 "주입 시계 가드" 절이 잠근다). 그래서 운영 코드를 고치지 않는다.
     *    여기서는 슬롯 경쟁만 본다 — 자동 READY 감사의 동시성은 벽시계로 도는 `auto-ready-runner-chain-check` 가 본다.
     */
    const order = rankAt(await generated(), PUBLISH_AT)
    for (const r of order.slice(0, 2)) {
      const code = String(((r.gateResults.autoDraft as Record<string, unknown>)?.voice as Record<string, unknown>)?.personaCode ?? '')
      const pid = (await prisma.persona.findUniqueOrThrow({ where: { code }, select: { id: true } })).id
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { decidedBy: 'founder', matchedPersonaId: pid, matchedAt: new Date(PUBLISH_AT.getTime() - 3 * 864e5) } })
    }
    const off = { SORAN_AUTO_READY_ENABLED: 'off' }
    const [a, b] = await Promise.all([runPublish(PUBLISH_AT, off), runPublish(PUBLISH_AT, off)])
    dump('pub-8a', a.out)
    dump('pub-8b', b.out)
    const published = (await generated()).filter((r) => r.status === 'PUBLISHED')
    const loser = [a, b].find((x) => !/✅ Post /.test(x.out))
    check('🔴 🔴 **⑧ 두 러너 동시 — 발행 정확히 1건 · Post 1 · ActivityLog 1 · 둘 다 exit 0 · 패자는 정상 무발행 코드**',
      published.length === 1 && (await postsNow()) === 1 && (await logsNow()) === 1 && a.code === 0 && b.code === 0
      && loser !== undefined && /정상 무발행 · (SLOT_CONSUMED|TARGET_RACE_LOST)|발행하지 않는다/.test(loser.out),
      `${published.length} · ${a.code}/${b.code} · ${loser?.out.split('\n').filter((l) => /⑤|무발행|중단/.test(l)).join(' ') ?? ''}`)
    if (published[0] !== undefined) await consistent(published[0].id, '⑧', new Date(PUBLISH_AT.getTime() - 3 * 864e5))
  }

  // ── ⑨ hard gate 가 반응 순위보다 먼저 ──
  {
    const { sup } = await world('⑨-a hard gate(안전 · gate 판정)가 반응 순위보다 먼저다')
    check('공급 러너 정상 종료', sup.code === 0)
    const order = rankAt(await generated(), PUBLISH_AT)
    const unsafe = '국회의원 선거 이야기 해 봐요'
    check('전제 — 그 제목은 정본 안전 판정에서 pass 가 아니다', safetyFilter({ title: unsafe }).verdict !== 'pass', safetyFilter({ title: unsafe }).verdict)
    await prisma.originalPostApprovalQueue.update({ where: { id: order[0]!.id }, data: { draftTitle: unsafe } })
    await prisma.originalPostApprovalQueue.update({ where: { id: order[1]!.id }, data: { gateVerdict: 'HOLD' } })
    const pub = await runPublish(PUBLISH_AT)
    dump('pub-9', pub.out)
    const published = (await generated()).filter((r) => r.status === 'PUBLISHED')
    check('🔴 🔴 **⑨ 반응 1위(안전 실패) · 2위(gate HOLD)는 나가지 않고 3위가 나간다** — 반응이 hard gate 를 넘지 못한다',
      pub.code === 0 && published.length === 1 && published[0]!.id === order[2]?.id,
      `${pub.code} · ${published.map(srcId).join(',')} · 기대 ${order[2] === undefined ? '-' : srcId(order[2])}`)
    const { sup: sup2 } = await world('⑨-b 비용 hard gate — 하루 예산이 바닥이면 반응 1위 원천도 생성하지 않는다',
      { SORAN_LLM_DAILY_BUDGET_USD: '0.000001' })
    const opp = readdirSync(DATA).find((f) => /^supply-opportunities-.*\.json$/.test(f))
    const oppN = opp === undefined ? 0 : (JSON.parse(readFileSync(join(DATA, opp), 'utf-8')) as { evidence: unknown[] }).evidence.length
    const rows2 = await generated()
    // 🔴 장부 — 정산된 유료 요청(사전 계산 제외) 0 · 보류 사유 DAILY_EXHAUSTED
    const ledgerRows = existsSync(LEDGER) ? readdirSync(LEDGER).filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => readFileSync(join(LEDGER, f), 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>)) : []
    const paid = ledgerRows.filter((r) => r.status === 'settled' && r.stage !== 'countTokens').length
    check('🔴 🔴 **⑨ 예산 hard gate — 원천 기회는 있다(eligible) · 적재 0 · 정산된 유료 요청 0 · 장부 보류 DAILY_EXHAUSTED**',
      oppN >= 4 && rows2.length === 0 && paid === 0 && /DAILY_EXHAUSTED/.test(sup2.out),
      `기회 ${oppN} · 적재 ${rows2.length} · 유료 ${paid} · exit ${sup2.code}`)
    const pub2 = await runPublish(PUBLISH_AT)
    dump('pub-9b', pub2.out)
    check('🔴 그 슬롯은 SLOT_UNFILLED — 예산 밖 생성 · 오래된 글로 채우지 않는다', pub2.code === 0 && /SLOT_UNFILLED/.test(pub2.out) && (await postsNow()) === 0)
  }

  // ── 주입 시계 안전 — 격리 표식 없이 가짜 시각으로 --apply 하지 않는다 ──
  {
    console.log('\n── 주입 시계 가드 — 격리 DB 표식이 없으면 가짜 시각으로 발행하지 않는다 ──')
    const r = await runPublish(PUBLISH_AT, { SORAN_ISOLATED_DB: '' })
    check('🔴 🔴 **SORAN_RUN_AT + --apply · 격리 표식 없음 → DB 에 붙기 전에 중단(exit 1)**',
      r.code === 1 && /주입 시각으로 --apply 는 격리 DB 에서만/.test(r.out) && !/① 대기열/.test(r.out), r.out.split('\n').slice(-4).join(' | '))
  }

  await wipe()
  await prisma.$disconnect()
  process.chdir(REPO)
  rmSync(T, { recursive: true, force: true })
  rmSync(HM, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 cwd · 임시 HOME · 합성 원문 · 합성 말투 · 가짜 provider — 운영 DB write 0 · 유료 0 · 운영 장부 0\n')
  if (fail > 0) process.exit(1)
}

await main()
