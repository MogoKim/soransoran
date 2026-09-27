#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 품질 계약 cohort — 순수 반례 검사** (2026-09-27 마스터 결정) · DB 0 · 네트워크 0 · LLM 0
 *
 *   A. 품질 계약 digest — 코드 상수에서만 · env/호출자/후보 파일이 정하지 못한다 · 봉투 대조 · CONTRACT
 *   B. cohort — legacy 제외 · 판 섞기 불가 · 선행 미검토 닫힘 · 창 안팎 결함 · 27/30 · 결속 · 동률 순서
 *   C. 전역 차단 — 발행 뒤 감사 결함 · 글 유실은 cohort 와 무관하게 닫는다
 *   D. CI 지문 가드 — 소스가 바뀌었는데 판·확인이 그대로면 실패
 *   E. 배선 — 도장·발행 재검증·증거가 지금 코드 상수로 다시 본다 · 생성 캐시 key 에 digest 없음
 *   F. 옛 계약 캐시 artifact + 게이트 위반 초안 → pickV2 AUTO_HOLD
 *
 *   npm run auto-ready:quality-check
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// 🔴 **import 보다 먼저** env 를 오염시킨다 — 구현이 env 를 읽으면 digest 가 이 값이 된다(변이 검사)
const FORGED = 'f'.repeat(64)
process.env.SORAN_QUALITY_CONTRACT_DIGEST = FORGED
process.env.QUALITY_CONTRACT_DIGEST = FORGED
process.env.SORAN_QUALITY_CONTRACT_VERSION = 'quality-forged'
process.env.QUALITY_CONTRACT_VERSION = 'quality-forged'

const qc = await import('../src/lib/quality-contract')
const {
  qualityContractDigest, qualityContractComponents, currentQualityContract, readQualityContract,
  isCurrentQualityContract, QUALITY_CONTRACT_VERSION, QUALITY_CONTRACT_KEY,
} = qc
const { qualityCohortOf, noEditNeed, humanDefectOf } = await import('../src/lib/auto-ready-quality-cohort')
type CohortRow = import('../src/lib/auto-ready-quality-cohort').CohortRow
const { bindingOf, digestOf, EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT } = await import('../src/lib/auto-ready-evidence')
const { judgeOpen, CONTRACT } = await import('../src/lib/auto-ready-v2')
const af = await import('../src/lib/micro-seed-supply-autofill')
const { STAGE_MODEL } = await import('../src/lib/content-core/pipeline')
const { judgeFingerprint, FINGERPRINT_FILES, FINGERPRINT_PATH, JUDGE_DEFINITIONS } = await import('./quality-contract-check.mjs')
const fxMod = await import('./lib/draft-gate-fixtures.mjs')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

console.log('\n══ 자동 READY 품질 계약 cohort — 순수 반례 (DB 0 · 네트워크 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('A. 🔴 품질 계약 digest — 코드 상수에서만')
// ─────────────────────────────────────────────────────────
const D = qualityContractDigest()
/** 🔴 구현과 **독립적으로** 다시 계산한 값 — 구현이 env 를 읽으면 여기와 달라진다 */
const INDEPENDENT = createHash('sha256').update(stableJson(qualityContractComponents()), 'utf8').digest('hex')
check('digest 는 sha256 hex 64', /^[0-9a-f]{64}$/.test(D))
check('🔴 🔴 **#9 env 에 가짜 digest·판을 넣어도 digest 는 코드 상수 그대로 (독립 재계산과 같다)**',
  D === INDEPENDENT && D !== FORGED && QUALITY_CONTRACT_VERSION === 'quality-v1', `${D.slice(0, 12)} vs ${INDEPENDENT.slice(0, 12)}`)
const comps = qualityContractComponents()
check('🔴 digest 구성 — 게이트·검수·판정 판이 들어 있다',
  ['version', 'pipelineVersion', 'promptVersion', 'reviewVersion', 'draftRuleVersion', 'draftGateVersion', 'draftGateCodes', 'judgeContractDigest', 'semanticHoldCodes']
    .every((k) => k in comps))
check('🔴 digest 구성 — 말투 자산·Persona 풀 지문은 없다 (Q3)',
  !('voiceAssetDigest' in comps) && !('personaPoolDigest' in comps))
const qcSrc = readFileSync('src/lib/quality-contract.ts', 'utf8')
check('🔴 🔴 **quality-contract.ts 는 env 를 읽지 않는다**', !/process\.env/.test(qcSrc))
check('🔴 digest 함수는 인자가 없다 — 바꿀 입력이 없다', /export function qualityContractDigest\(\): string/.test(qcSrc))

const mEnv = {
  provenance: af.MACHINE_PROFILE.envelopeProvenance, ruleVersion: af.MACHINE_PROFILE.envelopeRuleVersion,
  promptVersion: af.MACHINE_PROFILE.envelopePromptVersion, pipelineVersion: af.MACHINE_PROFILE.envelopePipelineVersion,
  stageModels: STAGE_MODEL, qualityContractDigest: D,
}
const CLEAN = { runWords: 3, runChars: 8, coverRatio: 0 }
const mc = {
  candidateType: 'seedOriginality', sourceArticleId: 'A1', sourceSite: 'navercafe:x', sourceInput: 'auto-judge',
  sourceDecision: 'AUTO_ADOPT', title: '오늘 산책 이야기', body: '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?',
  safetyVerdict: 'pass', originality: CLEAN, leakedTokens: '',
  voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' },
  // 🔴 호출자가 후보에 계약 표식을 실어 보낸다 — 저장되면 안 된다
  qualityContract: { version: 'quality-forged', digest: FORGED },
}
const aj = { ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h', provenance: 'machine-shadow' }
const measured = af.machineProfileMismatch(mEnv, mc as never)
check('fixture 후보는 기계 profile 을 통째로 만족한다', measured.length === 0, measured.join(' · '))
const p1 = af.buildQueuePayload({ envelope: mEnv, candidate: mc as never, autoJudge: { ...aj, qualityContract: FORGED } as never, review: { qualityContract: FORGED }, now: '2026-09-27T00:00:00Z' })
const stored = readQualityContract(p1?.gateResults)
check('🔴 🔴 **적재가 남기는 값은 코드 상수다 — 후보·autoJudge·review·env 에 실린 값이 아니다**',
  stored !== null && stored.digest === INDEPENDENT && stored.version === 'quality-v1', JSON.stringify(stored))
check('🔴 저장된 표식은 판정 때 지금 계약이다', isCurrentQualityContract(p1?.gateResults))
const forgedEnv = af.buildQueuePayload({ envelope: { ...mEnv, qualityContractDigest: FORGED }, candidate: mc as never, autoJudge: aj, now: 'x' })
check('🔴 🔴 **#9 봉투 digest 가 다르면(호출자 주입) payload 없음**', forgedEnv === null)
const noEnvDigest = af.buildQueuePayload({ envelope: { ...mEnv, qualityContractDigest: undefined }, candidate: mc as never, autoJudge: aj, now: 'x' })
check('🔴 🔴 **#10 봉투에 digest 가 없으면(수정 전 코드가 만든 파일) payload 없음**', noEnvDigest === null)
const plan = (env: Record<string, unknown>) => af.planRefill({ envelope: env as never, candidates: [mc as never], held: [], existing: new Set(), queue: [], usable: 0 })
check('🔴 🔴 **#10 수정 전 파일 → SkipCode CONTRACT (PROFILE 로 뭉개지 않는다)**',
  plan({ ...mEnv, qualityContractDigest: undefined }).skipped[0]?.code === 'CONTRACT')
check('🔴 🔴 **#9 다른 digest 파일 → SkipCode CONTRACT**', plan({ ...mEnv, qualityContractDigest: FORGED }).skipped[0]?.code === 'CONTRACT')
check('🟢 지금 digest 파일 → 적재 대상', plan(mEnv).targets.length === 1)
check('🔴 모양도 틀리면 여전히 PROFILE', plan({ ...mEnv, qualityContractDigest: undefined, pipelineVersion: 'x' }).skipped[0]?.code === 'PROFILE')
const human = af.buildQueuePayload({ envelope: {}, candidate: { ...mc, sourceDecision: 'ADOPT', voiceProvenance: undefined } as never, now: 'x' })
check('🔴 사람 경로 payload 에는 품질 계약 표식이 없다(사람이 고른 글이다)', human !== null && human.profile === 'human' && !(QUALITY_CONTRACT_KEY in human.gateResults))
check('🔴 표식 모양이 깨지면 없는 것이다(legacy)',
  readQualityContract({ qualityContract: { version: 'quality-v1', digest: 'abc' } }) === null
  && readQualityContract({ qualityContract: 'x' }) === null && readQualityContract(null) === null)
const bs = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf8')
const payloadSig = bs.split('export function buildQueuePayload(input: {')[1]?.split('}): QueuePayload | null')[0] ?? ''
check('🔴 buildQueuePayload 입력에 품질 계약 칸이 없다', payloadSig !== '' && !/quality/i.test(payloadSig))

// ─────────────────────────────────────────────────────────
console.log('\nB. 🔴 cohort — 지금 계약 · 생성 순서 · 첫 30건 · 선행 미검토 닫힘')
// ─────────────────────────────────────────────────────────
const GOOD_SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }
const T0 = Date.parse('2026-09-27T00:00:00.000Z')
const CAP = new Date(T0 - 864e5)
type Kind = 'noEdit' | 'edited' | 'declined' | 'pending' | 'unreviewed'
type Rev = { user?: string; hd: 'yes' | 'no' | 'unmeasured'; at?: string }
let n = 0
const row = (o: {
  kind?: Kind; hd?: 'yes' | 'no' | 'unmeasured'; mark?: 'current' | 'legacy' | 'otherDigest' | 'otherVersion'
  holds?: string[]; at?: number; id?: string; reviews?: Rev[]; machine?: boolean
} = {}): CohortRow => {
  n += 1
  const kind = o.kind ?? 'noEdit'
  const title = `평범한 하루 ${n}`
  const body = `아침에 산책을 다녀왔어요 ${n}. 다들 어떻게 지내세요?`
  const bound = {
    status: kind === 'declined' ? 'DECLINED' : kind === 'edited' ? 'EDITED' : 'APPROVED',
    draftTitle: title, draftBody: body,
    editedTitle: null, editedBody: kind === 'edited' ? `${body} (수정)` : null,
    declineReason: kind === 'declined' ? 'OTHER' : null,
  }
  const mark = o.mark ?? 'current'
  const qcm = mark === 'legacy' ? {}
    : mark === 'otherDigest' ? { [QUALITY_CONTRACT_KEY]: { version: QUALITY_CONTRACT_VERSION, digest: digestOf('다른 게이트 코드') } }
      : mark === 'otherVersion' ? { [QUALITY_CONTRACT_KEY]: { version: 'quality-v0', digest: digestOf('옛 판') } }
        : { [QUALITY_CONTRACT_KEY]: currentQualityContract() }
  const reviews: Rev[] = o.reviews ?? (kind === 'pending' || kind === 'unreviewed' ? [] : [{ hd: o.hd ?? 'no' }])
  const records = reviews.map((r, i) => ({
    contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:operator', reviewerUserId: r.user ?? 'u1', ...bindingOf(bound),
    hardDefect: r.hd, reasons: r.hd === 'yes' ? ['생활사 모순'] : [], bundleDigest: digestOf('bundle'),
    reviewedAt: r.at ?? new Date(T0 + i * 1000).toISOString(),
  }))
  return {
    id: o.id ?? `q${String(n).padStart(4, '0')}`,
    createdAt: new Date(o.at ?? T0 + n * 60_000),
    decidedBy: kind === 'pending' ? 'machine:auto-draft-v5' : 'founder',
    editDiff: records.length === 0 ? null : { [EVIDENCE_REVIEW_KEY]: records },
    ...bound, gateVerdict: 'PASS', sourceCapturedAt: CAP, machine: o.machine ?? true,
    gateResults: { holds: o.holds ?? [], blocks: [], semanticReview: GOOD_SR, ...qcm },
  }
}
const good = (k: number, o: Parameters<typeof row>[0] = {}) => Array.from({ length: k }, () => row(o))
const open = (rows: CohortRow[]) => qualityCohortOf(rows)

check('무수정 최소 = ceil(30×0.9) = 27 (정수 계산)', noEditNeed() === 27 && CONTRACT.reviewSampleMin === 30)
{
  const v = open([...good(27), ...good(3, { kind: 'edited' })])
  check('🔴 🔴 **#6 30건 · 무수정 27 · 결함 0 → 열림**', v.meetsContract && v.eligible === 30 && v.noEdit === 27, v.reasons.join(' · '))
  const v26 = open([...good(26), ...good(4, { kind: 'declined' })])
  check('🔴 🔴 **#6 26/30 → 닫힘 (폐기도 표본이다)**', !v26.meetsContract && v26.declined === 4 && v26.reasons.some((r) => r.includes('26/30')), v26.reasons.join(' · '))
  check('🔴 29건 → 닫힘', !open(good(29)).meetsContract)
}
{
  const legacy = good(30, { mark: 'legacy' })
  const v = open(legacy)
  check('🔴 🔴 **#1 legacy 30건(사람 no) → 표본 0 · 닫힘 · legacy 로만 보인다**', !v.meetsContract && v.sequence === 0 && v.legacyRows === 30, v.reasons.join(' · '))
  const old = good(30, { mark: 'otherVersion' })
  check('🔴 🔴 **#1 옛 판(표식 있음 · 다른 판) 30건 → 표본 0**', open(old).sequence === 0)
  const notMachine = good(30, { machine: false })
  check('🔴 기계 후보가 아닌 행은 표본이 아니다', open(notMachine).sequence === 0)
}
{
  // uili19gp 모양 — 옛 계약 · 사람 결정 · 폐기 · 결함 yes
  const uili = row({ kind: 'declined', hd: 'yes', mark: 'legacy', at: T0 - 864e5 })
  const before = stableJson(uili)
  const v = open([uili, ...good(27), ...good(3, { kind: 'edited' })])
  check('🔴 🔴 **#8 legacy 결함 yes(uili 모양)는 새 cohort 를 막지 않는다 → 열림**', v.meetsContract && v.cohortHardDefects === 0, v.reasons.join(' · '))
  check('🔴 🔴 **#8 그 기록은 그대로다 — 판정이 행을 바꾸지 않는다**', stableJson(uili) === before && humanDefectOf(uili))
}
{
  const cur = good(15)
  const other = good(15, { mark: 'otherDigest' })
  const v = open([...cur, ...other])
  check('🔴 🔴 **#3 지금 계약 15 + 같은 판 이름·다른 digest 15 → 합치지 않는다 · 닫힘**', !v.meetsContract && v.sequence === 15, `${v.sequence}`)
  const inter: CohortRow[] = []
  for (let i = 0; i < 30; i += 1) inter.push(row({ mark: i % 2 === 0 ? 'current' : 'otherVersion' }))
  check('🔴 🔴 **#3 판이 번갈아 섞여도 → 수열 15 · 닫힘**', open(inter).sequence === 15 && !open(inter).meetsContract)
}
{
  const first = row({ kind: 'pending' })
  const rest = good(30)
  const v = open([first, ...rest])
  check('🔴 🔴 **#4 1번 미검토 + 뒤 30건 좋음 → 닫힘 · 첫 차단 #1**',
    !v.meetsContract && v.firstBlocking?.index === 1 && v.firstBlocking.id === first.id && v.eligible === 29, v.reasons.join(' · '))
  check('🔴 #4 창은 1~30번이다 — 31번째는 창 밖', v.windowIds.length === 30 && v.windowIds[0] === first.id && !v.windowIds.includes(rest[29]!.id))
  const unrev = row({ kind: 'unreviewed', at: T0 })
  check('🔴 #4 사람 결정 표식만 있고 기록 없는 선행 행도 닫는다', !open([unrev, ...good(30)]).meetsContract)
  // 1번을 사람이 폐기(no) → 창 1~30 · 무수정 29 → 열림
  const decided = { ...first, decidedBy: 'founder' }
  const fixed = row({ kind: 'declined', hd: 'no', id: first.id, at: first.createdAt.getTime() })
  const v2 = open([fixed, ...rest])
  check('🔴 🔴 **#4 1번을 폐기로 결정·기록 → 1번은 declined 표본 · 창 1~30 · 열림**',
    v2.meetsContract && v2.declined === 1 && v2.noEdit === 29 && v2.windowIds[0] === first.id, v2.reasons.join(' · '))
  void decided
}
{
  const mid = good(30)
  mid[12] = { ...mid[12]!, editDiff: null }
  const v = open(mid)
  check('🔴 #4 창 중간(13번째) 미검토 → 닫힘 · 첫 차단 #13', !v.meetsContract && v.firstBlocking?.index === 13)
}
{
  const v = open([...good(29), row({ hd: 'yes', kind: 'declined' })])
  check('🔴 🔴 **#5 창 안 결함 yes 1건 → 닫힘**', !v.meetsContract && v.hardDefects === 1 && v.cohortHardDefects === 1)
  const out = [...good(27), ...good(3, { kind: 'edited' }), ...good(4), row({ kind: 'declined', hd: 'yes' })]
  const vo = open(out)
  check('🔴 🔴 **#5 창 밖(35번째) 결함 yes → 그 계약 실패 · 닫힘 (Q4)**', !vo.meetsContract && vo.hardDefects === 0 && vo.cohortHardDefects === 1, vo.reasons.join(' · '))
  const pend = [...good(27), ...good(3, { kind: 'edited' }), ...good(5, { kind: 'pending' })]
  check('🟢 창 밖 미검토 행은 열림을 막지 않는다', open(pend).meetsContract)
}
{
  const um = [...good(29), row({ hd: 'unmeasured' })]
  const v = open(um)
  check('🔴 🔴 **#7 창 안 hardDefect 미측정 → 닫힘 · null**', !v.meetsContract && v.hardDefects === null && v.firstBlocking?.why === 'hardDefectUnmeasured')
  const br = good(30)
  br[4] = { ...br[4]!, editedBody: '검토 뒤 바뀐 본문' }
  check('🔴 🔴 **#7 창 안 결속이 깨짐(검토 뒤 수정) → 닫힘 · bindingBroken**', !open(br).meetsContract && open(br).firstBlocking?.why === 'bindingBroken')
}
{
  const ws = [...good(4), row({ holds: ['SEMANTIC_UNSUPPORTED_ADDITION:1'], kind: 'pending' }), ...good(23), ...good(3, { kind: 'edited' })]
  const v = open(ws)
  check('🔴 🔴 **#8(Q2) 경고 행은 수열에 들지 않는다 — 미검토 경고 행이 끼어도 열림**', v.meetsContract && v.sequence === 30, v.reasons.join(' · '))
  const wd = [...good(27), ...good(3, { kind: 'edited' }), row({ holds: ['X'], kind: 'declined', hd: 'yes' })]
  check('🔴 경고 행(자동 대상 아님)의 사람 결함은 이 계약의 자동 표본 결함이 아니다', open(wd).meetsContract && open(wd).cohortHardDefects === 0)
}
{
  const base = [...good(27), ...good(3, { kind: 'edited' })]
  const same = base.map((r, i) => ({ ...r, createdAt: new Date(T0), id: `z${String(99 - i).padStart(3, '0')}` }))
  const a = open(same).windowIds.join(',')
  const b = open(same.slice().reverse()).windowIds.join(',')
  const sorted = same.map((r) => r.id).sort().join(',')
  check('🔴 🔴 **#17 createdAt 동률 → id 로 순서 · 입력 순서와 무관하게 같은 창**', a === b && a === sorted)
  const late = row({ kind: 'pending', at: T0 + 10 * 864e5 })
  const early = open([late, ...good(30)])
  check('🔴 생성 순서는 createdAt — 입력 배열 순서가 아니다(늦게 만든 미검토 행은 창 밖)', early.meetsContract && !early.windowIds.includes(late.id))
}
{
  // #15 사용자별 최신 · append 순서 · 누군가 yes 면 yes
  const corrected = row({ kind: 'declined', reviews: [{ hd: 'yes' }, { hd: 'no' }] })
  check('🔴 #15 같은 사람 yes → no 정정(append) → 결함 아님', !humanDefectOf(corrected))
  const twoUsers = row({ kind: 'declined', reviews: [{ user: 'a', hd: 'no' }, { user: 'b', hd: 'yes' }] })
  check('🔴 #15 다른 사람 yes → 결함', humanDefectOf(twoUsers))
  const skew = row({ kind: 'declined', reviews: [{ hd: 'no', at: '2026-09-27T05:00:00Z' }, { hd: 'yes', at: '2026-09-27T01:00:00Z' }] })
  check('🔴 #15 뒤에 붙은 기록의 시각이 더 과거여도 그 기록이 최신(append 순서)', humanDefectOf(skew))
  const brokenYes = { ...row({ kind: 'declined', hd: 'yes' }), declineReason: 'TOPIC_UNFIT' }
  const v = open([...good(27), ...good(3, { kind: 'edited' }), brokenYes])
  check('🔴 🔴 **결속이 깨져도 발견된 결함은 사라지지 않는다 (cohort 결함)**', !v.meetsContract && v.cohortHardDefects === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\nC. 🔴 전역 차단 — cohort 판과 무관')
// ─────────────────────────────────────────────────────────
{
  const ev = open([...good(27), ...good(3, { kind: 'edited' })])
  check('대조 — cohort 충족 · 결함 0 · 유실 0 → 열림', judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('🔴 🔴 **#14 cohort 충족이어도 발행 뒤 감사 결함 1 → 닫힘**', !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 1, missingAutoPosts: 0 }).open)
  check('🔴 🔴 **#14 cohort 충족이어도 글 유실 1 → 닫힘**', !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: 1 }).open)
}

// ─────────────────────────────────────────────────────────
console.log('\nD. 🔴 CI 지문 가드')
// ─────────────────────────────────────────────────────────
{
  const files = Object.fromEntries(FINGERPRINT_FILES.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]))
  const now = { version: QUALITY_CONTRACT_VERSION, digest: D, files }
  const rec = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf8'))
  check('🔴 저장소의 기록이 지금 코드와 같다', judgeFingerprint(rec, now).length === 0, judgeFingerprint(rec, now).join(' · '))
  const changed = { ...now, files: { ...files, 'src/lib/content-core/draft-life-gates.ts': digestOf('바뀐 게이트') } }
  check('🔴 🔴 **게이트 소스가 바뀌었는데 기록 그대로 → 실패**', judgeFingerprint(rec, changed).length > 0)
  check('🔴 🔴 **digest 구성이 바뀌었는데 판·기록 그대로 → 실패**', judgeFingerprint(rec, { ...now, digest: digestOf('다른 구성') }).length > 0)
  check('🔴 판만 올리고 기록 갱신 안 함 → 실패', judgeFingerprint(rec, { ...now, version: 'quality-v2' }).length > 0)
  check('🔴 기록 없음 → 실패', judgeFingerprint(null, now).length > 0)
  check('🔴 지문 대상에 게이트·검수·판정 파일이 있다',
    ['src/lib/content-core/draft-life-gates.ts', 'src/lib/content-core/review.ts', 'src/lib/auto-ready-v2.ts', 'scripts/lib/content-core-run.mts', 'src/lib/quality-contract.ts']
      .every((f) => (FINGERPRINT_FILES as readonly string[]).includes(f)))
  // 🔴 P1 — 표본·cohort·의미 요약 판정도 지문 대상이다. 게이트만 보면 30건 판정을 판 없이 바꿀 수 있다
  const watched = FINGERPRINT_FILES as readonly string[]
  check('🔴 🔴 **지문 대상에 cohort · repo · evidence · 사람 출처 · 의미 요약 파서가 있다**',
    ['src/lib/auto-ready-quality-cohort.ts', 'src/lib/auto-ready-repo.ts', 'src/lib/auto-ready-evidence.ts', 'src/lib/review-provenance.ts', 'src/lib/semantic-summary-codes.ts']
      .every((f) => watched.includes(f)))
  // 🔴 정의 위치 — 저장소 src/·scripts/ 전체에서 `function <이름>` 정의를 찾는다. 딱 한 곳 · 표의 파일 · 지문 대상
  const defs = Object.entries(JUDGE_DEFINITIONS as Record<string, string>)
  const misplaced = defs.flatMap(([name, file]) => {
    let out = ''
    try {
      out = execFileSync('git', ['grep', '-lE', `^export (async )?function ${name}[(<]`, '--', 'src', 'scripts'], { encoding: 'utf8' })
    } catch { out = '' } // 🔴 git grep 은 못 찾으면 exit 1 — 정의 없음으로 센다(통과가 아니다)
    const found = out.split('\n').filter(Boolean)
    return found.length === 1 && found[0] === file && watched.includes(file) ? [] : [`${name}→${found.join('|') || '없음'}`]
  })
  check('🔴 🔴 **판정 함수가 전부 지문 대상 파일 한 곳에 정의돼 있다** (지문 밖으로 옮기면 실패)', misplaced.length === 0, misplaced.join(' · '))
  check('🔴 의미 요약 파서는 의존 없는 파일이다 (공급 적재기 전체를 지문에 넣지 않는다)',
    !/^import /m.test(readFileSync('src/lib/semantic-summary-codes.ts', 'utf8'))
      && !watched.includes('src/lib/micro-seed-supply-autofill.ts'))
}

// ─────────────────────────────────────────────────────────
console.log('\nE. 🔴 배선 — 판정 시점 재검증 · 생성 캐시 key')
// ─────────────────────────────────────────────────────────
{
  const repo = readFileSync('src/lib/auto-ready-repo.ts', 'utf8')
  const stampRow = repo.split('async function stampRowInTx(')[1]?.split('export const STAMP_BATCH_SIZE')[0] ?? ''
  check('🔴 🔴 **#13 도장은 지금 품질 계약 행만 (코드 상수로 재검증)**',
    /isCurrentQualityContract\(row\.gateResults\)/.test(stampRow) && stampRow.indexOf('isCurrentQualityContract') < stampRow.indexOf('updateMany('))
  const recheck = repo.split('export async function recheckAutoReadyInTx(')[1]?.split('export async function selectAudits')[0] ?? ''
  check('🔴 🔴 **#13 발행 재검증도 지금 품질 계약 행만**', /isCurrentQualityContract\(i\.gateResults\)/.test(recheck))
  const ev = repo.split('export async function evidenceFromDb(')[1]?.split('export async function authoritativeGate')[0] ?? ''
  check('🔴 증거는 정본 qualityCohortOf 하나', /return qualityCohortOf\(/.test(ev))
  const gate = repo.split('export async function authoritativeGate(')[1]?.split('export type StampOutcome')[0] ?? ''
  check('🔴 전역 차단(감사 결함 · 글 유실)은 그대로 게이트에 있다', /confirmedDefectCount\(db\)/.test(gate) && /missingAutoPostCount\(db\)/.test(gate))
  const coh = readFileSync('src/lib/auto-ready-quality-cohort.ts', 'utf8')
  check('🔴 cohort 는 행마다 isCurrentQualityContract 로 다시 본다(저장된 표식을 믿지 않는다)', /isCurrentQualityContract\(r\.gateResults\)/.test(coh))
  const gen = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf8')
  const key = gen.split('const v2Key = ')[1]?.split('\n')[0] ?? ''
  check('🔴 (Q3) 생성 캐시 key 에 품질 계약 digest 가 없다 — 유료 재생성 0', key !== '' && !/quality/i.test(key))
  check('🔴 legacy 행도 운영 재고 profile 은 그대로 machine 이다(표식을 요구하지 않는다)',
    af.queueProfileOf({ promptVersion: af.MACHINE_PROMPT_VERSION, model: af.MACHINE_MODEL, sourceSite: `${af.MACHINE_SITE_PREFIX}x`, gateResults: { autoDraft: { provenance: af.MACHINE_PROFILE.envelopeProvenance, sourceDecision: af.MACHINE_PROFILE.sourceDecision, draftRuleVersion: af.MACHINE_PROFILE.envelopeRuleVersion } } }) === 'machine')
}

// ─────────────────────────────────────────────────────────
console.log('\nF. 🔴 (Q3) 옛 계약 캐시 artifact + 게이트 위반 초안 → pickV2 AUTO_HOLD')
// ─────────────────────────────────────────────────────────
{
  for (const fx of fxMod.FIXTURES.filter((f) => f.expect.length > 0)) {
    const r = await fxMod.runFixturePath(fx, { cachedAdopt: true })
    const got = (r.pick?.rejected ?? []).map((x) => x.reason as string)
    check(`🔴 ${fx.label} — 캐시(adopt 로 저장된 옛 artifact)여도 AUTO_HOLD · ${fx.expect.join('+')}`,
      r.pick?.decision === 'AUTO_HOLD' && fx.expect.every((c) => got.includes(c)), `${r.pick?.decision} · ${got.join(',')}`)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 유료 호출 0\n')
if (fail > 0) process.exit(1)
