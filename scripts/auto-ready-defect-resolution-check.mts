#!/usr/bin/env tsx
/**
 * 🔴 **확정 결함 해소 판정 — 순수 반례** (2026-10-01 · Lane E · DB 0 · 네트워크 0)
 *
 *   결함 축의 정본은 "지금 품질 계약에서 해소되지 않은 확정 결함" 하나다(`judgeDefectResolution` · `unresolvedDefectCount`).
 *   해소는 지금 계약 판·digest · 그 감사 행(지문) · 그 큐·글 · 저장 초안 · 지금 게이트 재검증 차단에 **모두** 묶인
 *   기록이 있을 때뿐이다. 하나라도 어긋나면 미해소다(fail-closed). 옛 전 기간 카운트(`confirmedDefectCount`)는 지웠다.
 *
 *   npm run auto-ready:defect-resolution-check
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFECT_RESOLUTION_KEY, DEFECT_RESOLUTION_RECORD_VERSION, DEFECT_RESOLVER,
  auditFingerprintOf, judgeDefectResolution,
  type AuditRowForResolution, type DefectResolutionRecord, type QueueRowForResolution,
} from '../src/lib/auto-ready-defect-resolution'
import { digestOf, judgeOpen } from '../src/lib/auto-ready-v2'
import { DRAFT_GATE_VERSION, judgeDraftLife } from '../src/lib/content-core/draft-life-gates'
import { SEMANTIC_AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-semantic-audit'
import { INTEGRITY_AUDITOR } from '../src/lib/auto-ready-repo'
import { ADMIN_DEFECT_AUDITOR } from '../src/lib/auto-ready-audit-store'
import { currentQualityContract, qualityContractComponents, QUALITY_CONTRACT_KEY, QUALITY_CONTRACT_VERSION } from '../src/lib/quality-contract'
import { LIFE_FIXTURES } from './lib/life-gate-fixtures.mjs'
import { gateContextOf, type GateFixture } from './lib/draft-gate-fixtures.mjs'

/** 🔴 fixture → 정본 게이트 입력 — `draft-life-gates-check` 와 같은 조립 */
const gateInputOf = (fx: GateFixture) => {
  const p = fx.plan as { selfBasis?: string | null; speakerWarrants?: { fact: string; evidenceText?: string }[]; closingIntent?: string | null; contentRoles?: string[] }
  return {
    title: fx.draft.title, body: fx.draft.body, card: fx.card ?? null, context: gateContextOf(fx),
    plan: {
      selfBasis: p.selfBasis ?? null, warrants: (p.speakerWarrants ?? []).map((w) => ({ fact: w.fact, evidenceText: w.evidenceText })),
      closingIntent: p.closingIntent ?? null, contentRoles: p.contentRoles ?? [],
    },
  }
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const ROOT = process.cwd()
const code = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
/** 🔴 주석을 뺀 코드 — 주석 속 낱말로 소스 검사가 통과하지 않게 한다 */
const codeOnly = (p: string): string => code(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('\n══ 확정 결함 해소 판정 — 순수 반례 ══\n')

const C = currentQualityContract()
const LEGACY_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
const BLOCKED = LIFE_FIXTURES.find((x) => x.queueId === 'counter-v6-peer-observation')!
const PASSING = LIFE_FIXTURES.find((x) => x.queueId === 'control-v6-peer-third-party')!

const audit = (o: Partial<AuditRowForResolution> = {}): AuditRowForResolution => ({
  queueId: 'q-a', postId: 'p-a', selectedAtN: 1, selectedTarget: 1, selectedAt: new Date('2026-10-01T00:30:26.718Z'),
  publishedTitleHash: digestOf(BLOCKED.draft.title), publishedBodyHash: digestOf(BLOCKED.draft.body),
  stampContractDigest: 'd61e74a9ad38cd40578dc317ae9a9d11', defect: 'yes', judgedAt: new Date('2026-10-01T01:10:05.650Z'),
  auditor: 'model:semantic-audit:runner', note: `[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=measured binding=x] 결함`,
  auditContractVersion: 'auto-ready-audit-v1', auditModel: 'rule+model', auditPromptVersion: 'p+q', ...o,
})
const recordFor = (a: AuditRowForResolution, o: Partial<DefectResolutionRecord> = {}): DefectResolutionRecord => ({
  recordVersion: DEFECT_RESOLUTION_RECORD_VERSION, qualityContract: C,
  audit: { queueId: a.queueId, postId: a.postId, fingerprint: auditFingerprintOf(a) },
  draft: { titleHash: digestOf(BLOCKED.draft.title), bodyHash: digestOf(BLOCKED.draft.body) },
  reverify: { gateVersion: DRAFT_GATE_VERSION, outcome: 'blocked', failureCodes: ['unwarrantedSelfClaim'], reviewCodes: [], inputDigest: 'a'.repeat(64), artifactId: 'art-a' },
  resolvedAt: '2026-10-01T12:00:00.000Z', resolvedBy: DEFECT_RESOLVER, ...o,
})
const queue = (entries: unknown[] | null, o: Partial<QueueRowForResolution> = {}): QueueRowForResolution => ({
  id: 'q-a', createdPostId: 'p-a', draftTitle: BLOCKED.draft.title, draftBody: BLOCKED.draft.body,
  gateResults: { [QUALITY_CONTRACT_KEY]: LEGACY_MARK, autoDraft: { artifactId: 'art-a' } },
  editDiff: entries === null ? { autoReady: { decidedBy: 'auto-ready:v1' } } : { autoReady: { decidedBy: 'auto-ready:v1' }, [DEFECT_RESOLUTION_KEY]: entries },
  ...o,
})
const judge = (a: AuditRowForResolution, q: QueueRowForResolution | null, c = C) => judgeDefectResolution(a, q, c)

console.log('A. 기준선 — 묶인 기록 하나면 해소, 없으면 미해소')
{
  const a = audit()
  check('🔴 기록 없음 → 미해소', !judge(a, queue(null)).resolved)
  check('🟢 지금 계약 · 이 감사 지문 · 이 큐·글 · 저장 초안 · 재검증 차단 → 해소', judge(a, queue([recordFor(a)])).resolved, judge(a, queue([recordFor(a)])).reason)
  check('🔴 큐 행이 없다 → 미해소', !judge(a, null).resolved)
}

console.log('\nB. 🔴 기록이 어긋나면 미해소 (fail-closed)')
{
  const a = audit()
  const cases: [string, DefectResolutionRecord | Record<string, unknown>][] = [
    ['다른 품질 계약 digest', recordFor(a, { qualityContract: { version: C.version, digest: 'b'.repeat(64) } })],
    ['다른 품질 계약 판', recordFor(a, { qualityContract: { version: 'quality-v5', digest: C.digest } })],
    ['옛 계약(v4) 기록', recordFor(a, { qualityContract: LEGACY_MARK })],
    ['다른 감사 행(queueId)', recordFor(a, { audit: { queueId: 'q-other', postId: 'p-a', fingerprint: auditFingerprintOf(a) } })],
    ['다른 글(postId)', recordFor(a, { audit: { queueId: 'q-a', postId: 'p-other', fingerprint: auditFingerprintOf(a) } })],
    ['다른 감사 지문', recordFor(a, { audit: { queueId: 'q-a', postId: 'p-a', fingerprint: auditFingerprintOf(audit({ note: '다른 note' })) } })],
    ['초안 hash 가 다르다', recordFor(a, { draft: { titleHash: digestOf('x'), bodyHash: digestOf(BLOCKED.draft.body) } })],
    ['재검증이 차단하지 않았다(failureCodes 0)', recordFor(a, { reverify: { ...recordFor(a).reverify, failureCodes: [] } })],
    ['재검증 코드가 지금 게이트 코드가 아니다', recordFor(a, { reverify: { ...recordFor(a).reverify, failureCodes: ['madeUpCode'] } })],
    ['재검증 게이트 판이 다르다', recordFor(a, { reverify: { ...recordFor(a).reverify, gateVersion: 'draft-gates-v5' } })],
    ['재검증 입력 지문 모양이 깨졌다', recordFor(a, { reverify: { ...recordFor(a).reverify, inputDigest: 'zz' } })],
    ['기록 판이 다르다', recordFor(a, { recordVersion: 'defect-resolution-v0' })],
    ['기록한 쪽이 사람이다', recordFor(a, { resolvedBy: 'human:founder' })],
  ]
  for (const [label, r] of cases) check(`🔴 ${label} → 미해소`, !judge(a, queue([r])).resolved)
  // 🔴 모양이 덜 찬 기록 — 칸 하나씩 지운다
  const full = recordFor(a) as unknown as Record<string, unknown>
  const holes = Object.keys(full).filter((k) => !judge(a, queue([{ ...full, [k]: undefined }])).resolved)
  check('🔴 🔴 **불완전한 기록(칸 하나라도 없음) → 전부 미해소**', holes.length === Object.keys(full).length, `미해소 ${holes.length}/${Object.keys(full).length}`)
  const rv = full.reverify as Record<string, unknown>
  const rvHoles = Object.keys(rv).filter((k) => !judge(a, queue([{ ...full, reverify: { ...rv, [k]: undefined } }])).resolved)
  check('🔴 재검증 칸 하나라도 없음 → 전부 미해소', rvHoles.length === Object.keys(rv).length, `미해소 ${rvHoles.length}/${Object.keys(rv).length}`)
  check('🔴 outcome 이 blocked 가 아니다 → 미해소', !judge(a, queue([{ ...full, reverify: { ...rv, outcome: 'passed' } }])).resolved)
  check('🔴 기록 칸이 배열이 아니다 → 미해소', !judge(a, queue(null, { editDiff: { [DEFECT_RESOLUTION_KEY]: recordFor(a) } })).resolved)
  check('🟢 옛 기록 + 지금 기록 → 해소(덧붙이기)', judge(a, queue([recordFor(a, { qualityContract: LEGACY_MARK }), recordFor(a)])).resolved)
  check('🔴 옛 기록만 → 미해소', !judge(a, queue([recordFor(a, { qualityContract: LEGACY_MARK })])).resolved)
  check('🔴 🔴 **기록 뒤 지금 계약이 바뀌면(새 digest) → 미해소**', !judge(a, queue([recordFor(a)]), { version: C.version, digest: 'c'.repeat(64) }).resolved)
  check('🔴 🔴 **기록 뒤 새 판이 나오면 → 미해소**', !judge(a, queue([recordFor(a)]), { version: 'quality-v7', digest: C.digest }).resolved)
}

console.log('\nC. 🔴 기록이 맞아도 해소 대상이 아닌 결함')
{
  const a = audit()
  const r = recordFor(a)
  const withAudit = (o: Partial<AuditRowForResolution>): boolean => {
    const b = audit(o)
    return judge(b, queue([recordFor(b)])).resolved
  }
  check('🔴 감사 행이 바뀌었다(note) → 옛 기록으로 미해소', !judge(audit({ note: `${a.note!} 덧붙임` }), queue([r])).resolved)
  check('🔴 감사 행이 바뀌었다(judgedAt) → 미해소', !judge(audit({ judgedAt: new Date('2026-10-02T00:00:00Z') }), queue([r])).resolved)
  check('🔴 무결성 결함(system:integrity) → 기록이 맞아도 미해소', !withAudit({ auditor: INTEGRITY_AUDITOR }))
  check('🔴 사람 신고(human:operator) → 기록이 맞아도 미해소', !withAudit({ auditor: ADMIN_DEFECT_AUDITOR }))
  check('🔴 의미 감사지만 측정되지 않은(outcome=integrity) 결함 → 미해소',
    !withAudit({ note: `[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=integrity binding=none] x` }))
  check('🔴 감사자 이름이 비슷한 다른 것(model:semantic-auditX) → 미해소', !withAudit({ auditor: 'model:semantic-auditX' }))
  check('🔴 defect=no 행 → 해소 대상 아님(미해소로 센다 · 부르는 쪽은 yes 만 넘긴다)', !withAudit({ defect: 'no' }))
  check('🔴 🔴 **지금 품질 계약 행의 결함 → 어떤 기록으로도 미해소**',
    !judge(a, queue([r], { gateResults: { [QUALITY_CONTRACT_KEY]: C, autoDraft: { artifactId: 'art-a' } } })).resolved)
  check('🔴 큐가 가리키는 글이 감사 대상 글이 아니다 → 미해소', !judge(a, queue([r], { createdPostId: 'p-other' })).resolved)
  check('🔴 큐 행 id 가 감사 행 큐가 아니다 → 미해소', !judge(a, queue([r], { id: 'q-other' })).resolved)
  check('🔴 저장 초안이 발행 글과 다르다 → 미해소', !judge(a, queue([r], { draftBody: `${BLOCKED.draft.body} ` })).resolved)
}

console.log('\nD. 감사 행 지문 — 한 칸이라도 바뀌면 달라진다')
{
  const a = audit()
  const fields: (keyof AuditRowForResolution)[] = ['queueId', 'postId', 'selectedAtN', 'selectedTarget', 'selectedAt', 'publishedTitleHash',
    'publishedBodyHash', 'stampContractDigest', 'defect', 'judgedAt', 'auditor', 'note', 'auditContractVersion', 'auditModel', 'auditPromptVersion']
  const bump = (k: keyof AuditRowForResolution): Partial<AuditRowForResolution> => {
    const v = a[k]
    return { [k]: v instanceof Date ? new Date(v.getTime() + 1) : typeof v === 'number' ? v + 1 : `${String(v)}x` } as Partial<AuditRowForResolution>
  }
  const same = fields.filter((k) => auditFingerprintOf(audit(bump(k))) === auditFingerprintOf(a))
  check('🔴 감사 행 15칸 전부 지문에 들어간다', same.length === 0 && fields.length === 15, same.join(','))
}

console.log('\nE. 재검증 대상 — 지금 게이트가 저장 초안을 실제로 막는가(정본 게이트를 그대로 돈다)')
{
  const blocked = judgeDraftLife(gateInputOf(BLOCKED))
  const passing = judgeDraftLife(gateInputOf(PASSING))
  check('🔴 운영 결함과 같은 모양(원문의 만남을 1인칭으로) → 지금 게이트 확정 차단 unwarrantedSelfClaim',
    blocked.failures.some((f) => f.code === 'unwarrantedSelfClaim'), blocked.failures.map((f) => f.code).join(','))
  check('🟢 대조(제3자 주어) → 확정 차단 없음 — 이 초안이면 해소 기록을 쓰지 않는다', passing.failures.length === 0, passing.failures.map((f) => f.code).join(','))
}

console.log('\nF. 열림 — 결함 축은 미해소 수 하나')
{
  const ev = { meetsContract: true, reasons: [] }
  check('🔴 미해소 1 → 닫힘', !judgeOpen({ enabled: true, evidence: ev, unresolvedDefects: 1, missingAutoPosts: 0 }).open)
  check('🟢 미해소 0 → 열림', judgeOpen({ enabled: true, evidence: ev, unresolvedDefects: 0, missingAutoPosts: 0 }).open)
}

console.log('\nG. 소스 — 옛 권위를 지웠고, 새 권위 하나가 연결됐다')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  const store = codeOnly('src/lib/auto-ready-defect-resolution-store.ts')
  const callers = ['src/lib/auto-ready-repo.ts', 'src/lib/stage-evidence-repo.ts', 'scripts/stage-controller.mts']
  check('🔴 🔴 **옛 전 기간 카운트(confirmedDefectCount)가 코드 어디에도 없다**',
    ['src/lib/auto-ready-repo.ts', 'src/lib/stage-evidence-repo.ts', 'scripts/stage-controller.mts', 'src/lib/auto-ready-audit-store.ts', 'src/lib/auto-ready-v2.ts']
      .every((p) => !/confirmedDefectCount|confirmedDefects/.test(codeOnly(p))))
  check('🔴 🔴 **defect=yes 를 그대로 세는 count 가 repo 에 없다**', !/autoReadyAudit\.count\(\{\s*where:\s*\{\s*defect:\s*'yes'/.test(repo))
  check('🔴 열림 · 단계 controller · 단계 증거가 같은 정본(unresolvedDefectCount)을 부른다',
    callers.every((p) => /unresolvedDefectCount\((db|prisma)\)/.test(codeOnly(p))))
  check('🔴 정본 카운트가 해소 판정 하나(judgeDefectResolution)를 부른다', /judgeDefectResolution\(/.test(repo))
  check('🔴 🔴 **해소 쓰기 경로는 감사 행에 쓰지 않는다**(update · create · delete · upsert 0)',
    !/autoReadyAudit\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(/.test(store))
  check('🔴 해소 쓰기는 큐 행 updatedAt CAS · Serializable · 덧붙이기',
    /updatedAt: e\.updatedAt!/.test(store) && /isolationLevel: 'Serializable'/.test(store) && /\.\.\.resolutionEntriesOf\(q\.editDiff\)/.test(store))
  check('🔴 해소 쓰기 전에 지금 초안 게이트(judgeDraftLife)를 저장 초안에 돈다',
    /judgeDraftLife\(\{\s*title: q!\.draftTitle, body: q!\.draftBody/.test(store))
  const runner = codeOnly('scripts/auto-ready-defect-resolve.mts')
  check('🔴 러너의 --apply 는 격리 DB 에서만(운영 적용 범위 밖)', /if \(apply\) \{\s*const bad = isolatedDbProblems\(\)/.test(runner))
  check('🔴 해소 기록 판이 품질 계약 digest 구성에 들어간다',
    JSON.stringify(qualityContractComponents()).includes(DEFECT_RESOLUTION_RECORD_VERSION) && QUALITY_CONTRACT_VERSION === 'quality-v6')
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패\n`)
process.exit(fail === 0 ? 0 : 1)
