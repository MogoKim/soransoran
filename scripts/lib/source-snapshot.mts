/**
 * 🔴 **source(runtime) 결함 snapshot — source 판정은 source 코드가 한다** (2026-10-13 · #710 뒤 P0 hotfix)
 *
 *   왜 있나 — 전환 판정이 source(v7) 미해소 집합을 **target(v8) 코드의 판정기**로 다시 셌다. 해소 기록은 그 기록을 쓴
 *   계약 · 게이트 판에 묶이므로(`recordProblem` 의 gateVersion 대조), v7 기록(`draft-gates-v6.1`)을 v8 판정기
 *   (`draft-gates-v8`)가 읽으면 무효다 → live v7 에서 해소된 옛 계약 행 결함(cmunjakqf…)이 `NOT_OWN_CONTRACT` 로 부활했다.
 *
 *   정본 원칙: source 상태는 source runtime 의 계약 · digest · 게이트 판으로, target 상태는 target 의 것으로 센다.
 *   target 판정기가 source 기록을 target 게이트로 재해석하지 않는다.
 *
 *   그래서 source 집합은 **runtime 트리(지금 돌고 있는 SHA)에서** `SOURCE_SNAPSHOT_SNIPPET` 을 `tsx -e` 로 돌려 얻는다.
 *   그 스니펫은 runtime 커밋에 **원래 있는 모듈만** 부른다(`quality-contract` · `draft-life-gates` · `auto-ready-defect-resolution`
 *   · `ops-signals`) — 옛 트리에 이 파일이 없어도 된다. 결과는 봉인(`sealSnapshot` · sha256)해 파일로 넘기고,
 *   전환 검사가 봉인 · 계약 · 게이트 판 · 지금 DB 의 결함 집합을 대조한다. 하나라도 어긋나면 BLOCK(fail-closed).
 *
 * 🔴 DB 는 읽기만 한다. 출력은 판 · digest · 큐 id · 감사 지문 · 해소 여부뿐이다(글자 0 · DB 주소 0).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const SOURCE_SNAPSHOT_VERSION = 'source-snapshot-v1'
export const SOURCE_SNAPSHOT_MARK = 'SOURCE_SNAPSHOT '

/**
 * 🔴 **runtime 트리에서 도는 스니펫** — 그 트리의 코드로 확정 결함 전부의 해소 여부를 센다.
 *    `judgeDefectResolution(a, q, currentQualityContract())` 는 그 트리의 정본 판정이다(계약 · 게이트 판 · 기록 판 전부 그 트리 상수).
 *    🔴 이 문자열은 옛 runtime 커밋에서도 돌아야 한다 — 그 커밋에 있는 export 만 쓴다.
 */
/**
 * 🔴 Node 판마다 `.ts`(CJS 로 옮겨진) 모듈의 동적 import 모양이 다르다 — Node 20 은 `{ default }` 하나, Node 22+ 는 named export.
 *    두 모양을 하나로 편다. 이름이 없으면 그 자리에서 `TypeError` → 오류 줄 → BLOCK(fail-closed).
 */
const UNWRAP = 'const u = (m) => Object.assign({}, m && typeof m.default === \'object\' ? m.default : {}, m)'
export const SOURCE_SNAPSHOT_SNIPPET = [
  '(async () => {',
  `  ${UNWRAP}`,
  "  const ops = u(await import('./scripts/lib/ops-signals.mts'))",
  "  if (!ops.fillDbConnection()) { console.log('SOURCE_SNAPSHOT_ERROR no-db'); process.exit(2) }",
  "  const { PrismaClient } = await import('@prisma/client')",
  "  const qc = u(await import('./src/lib/quality-contract.ts'))",
  "  const g = u(await import('./src/lib/content-core/draft-life-gates.ts'))",
  "  const dr = u(await import('./src/lib/auto-ready-defect-resolution.ts'))",
  '  const p = new PrismaClient()',
  '  try {',
  '    const contract = qc.currentQualityContract()',
  "    const audits = await p.autoReadyAudit.findMany({ where: { defect: 'yes' } })",
  '    const qs = await p.originalPostApprovalQueue.findMany({ where: { id: { in: audits.map((a) => a.queueId) } },',
  '      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true } })',
  '    const by = new Map(qs.map((q) => [q.id, q]))',
  '    const defects = audits.map((a) => ({ queueId: a.queueId, auditFingerprint: dr.auditFingerprintOf(a),',
  '      resolved: dr.judgeDefectResolution(a, by.get(a.queueId) ?? null, contract).resolved }))',
  '      .sort((x, y) => (x.queueId < y.queueId ? -1 : x.queueId > y.queueId ? 1 : 0))',
  "    console.log('SOURCE_SNAPSHOT ' + JSON.stringify({ v: 'source-snapshot-v1', contract: { version: contract.version, digest: contract.digest },",
  '      gateVersion: g.DRAFT_GATE_VERSION, recordVersion: dr.DEFECT_RESOLUTION_RECORD_VERSION, defects, takenAt: new Date().toISOString() }))',
  '  } finally { await p.$disconnect() }',
  "})().catch((e) => { console.log('SOURCE_SNAPSHOT_ERROR ' + (e && e.name ? e.name : 'error') + ' ' + String(e && e.message ? e.message : '').replace(/postgres(?:ql)?:\\/\\/\\S+/g, '<db>').slice(0, 200)); process.exit(2) })",
].join('\n')

export type SourceDefect = { queueId: string; auditFingerprint: string; resolved: boolean }
export type SourceSnapshot = {
  v: string
  contract: { version: string; digest: string }
  gateVersion: string
  recordVersion: string
  defects: SourceDefect[]
  takenAt: string
}

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))
const HEX64 = /^[0-9a-f]{64}$/
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** 🔴 모양 — 하나라도 어긋나면 `null` */
export function readSnapshotShape(v: unknown): SourceSnapshot | null {
  const r = rec(v)
  const c = rec(r.contract)
  const str = (x: unknown): x is string => typeof x === 'string' && x !== ''
  if (r.v !== SOURCE_SNAPSHOT_VERSION || !str(c.version) || !str(c.digest) || !HEX64.test(c.digest)
    || !str(r.gateVersion) || !str(r.recordVersion) || !str(r.takenAt) || !Array.isArray(r.defects)) return null
  const defects: SourceDefect[] = []
  for (const d of r.defects) {
    const x = rec(d)
    if (!str(x.queueId) || !str(x.auditFingerprint) || !HEX64.test(x.auditFingerprint) || typeof x.resolved !== 'boolean') return null
    defects.push({ queueId: x.queueId, auditFingerprint: x.auditFingerprint, resolved: x.resolved })
  }
  if (new Set(defects.map((d) => d.queueId)).size !== defects.length) return null
  return { v: r.v, contract: { version: c.version, digest: c.digest }, gateVersion: r.gateVersion, recordVersion: r.recordVersion, defects, takenAt: r.takenAt }
}

/** 🔴 스니펫 출력 → snapshot. 마지막 `SOURCE_SNAPSHOT ` 줄만 읽는다. 오류 줄이거나 모양이 어긋나면 `null` */
export function parseSnapshotOutput(stdout: string): SourceSnapshot | null {
  const line = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(SOURCE_SNAPSHOT_MARK)).pop()
  if (line === undefined) return null
  try { return readSnapshotShape(JSON.parse(line.slice(SOURCE_SNAPSHOT_MARK.length))) } catch { return null }
}

export const snapshotDigestOf = (s: SourceSnapshot): string => createHash('sha256').update(stableJson(s), 'utf8').digest('hex')

/** 🔴 봉인 — 파일에 snapshot 과 그 digest 를 함께 쓴다. 읽을 때 다시 재서 같아야 한다(손상 · 편집 → BLOCK) */
export function sealSnapshot(s: SourceSnapshot): string {
  return `${JSON.stringify({ snapshot: s, digest: snapshotDigestOf(s) }, null, 2)}\n`
}

export type SealedRead = { ok: true; snapshot: SourceSnapshot; digest: string } | { ok: false; reason: string }
export function readSealedSnapshot(text: string | null): SealedRead {
  if (text === null) return { ok: false, reason: 'source snapshot 파일이 없다' }
  let j: unknown
  try { j = JSON.parse(text) } catch { return { ok: false, reason: 'source snapshot 이 JSON 이 아니다(손상)' } }
  const s = readSnapshotShape(rec(j).snapshot)
  if (s === null) return { ok: false, reason: 'source snapshot 모양이 깨졌다(손상)' }
  const d = rec(j).digest
  if (typeof d !== 'string' || d !== snapshotDigestOf(s)) return { ok: false, reason: 'source snapshot 봉인이 맞지 않는다(손상 · 편집)' }
  return { ok: true, snapshot: s, digest: d }
}

/**
 * 🔴 **이 snapshot 을 source 상태로 써도 되는가** — 계약 · 게이트 판이 runtime 트리에서 따로 읽은 값과 같고,
 *    지금 DB 의 확정 결함 집합(큐 id · 감사 지문)이 snapshot 과 같아야 한다. 어긋난 것을 문장으로 돌려준다.
 */
export function snapshotProblems(s: SourceSnapshot, expect: {
  contract: { version: string; digest: string }
  gateVersion: string
  /** 지금 DB 의 확정 결함 — 큐 id → 감사 지문 */
  defects: ReadonlyMap<string, string>
}): string[] {
  const out: string[] = []
  if (s.contract.version !== expect.contract.version || s.contract.digest !== expect.contract.digest) {
    out.push(`source 계약 불일치 — snapshot ${s.contract.version}:${s.contract.digest.slice(0, 12)} ≠ runtime ${expect.contract.version}:${expect.contract.digest.slice(0, 12)}`)
  }
  if (s.gateVersion !== expect.gateVersion) out.push(`source 게이트 판 불일치 — snapshot ${s.gateVersion} ≠ runtime ${expect.gateVersion}`)
  const snap = new Map(s.defects.map((d) => [d.queueId, d.auditFingerprint]))
  const missing = [...expect.defects.keys()].filter((id) => !snap.has(id))
  const gone = [...snap.keys()].filter((id) => !expect.defects.has(id))
  const changed = [...snap.entries()].filter(([id, fp]) => expect.defects.has(id) && expect.defects.get(id) !== fp).map(([id]) => id)
  if (missing.length > 0 || gone.length > 0 || changed.length > 0) {
    out.push(`source snapshot 뒤 결함 집합이 바뀌었다 — 새 ${missing.length} · 사라짐 ${gone.length} · 감사 행 바뀜 ${changed.length}`)
  }
  return out
}

/** 🔴 runtime 트리에서 스니펫을 돌린다 — 실패 · 모양 오류는 `null`(부르는 쪽이 BLOCK) */
export function takeSourceSnapshot(runtimeRoot: string, env: NodeJS.ProcessEnv = process.env): SourceSnapshot | null {
  try {
    const out = execFileSync('npx', ['tsx', '-e', SOURCE_SNAPSHOT_SNIPPET], {
      cwd: runtimeRoot, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000,
    })
    return parseSnapshotOutput(out)
  } catch { return null }
}

/** 🔴 runtime 트리의 게이트 판 — snapshot 과 따로 읽어 대조한다 */
export const RUNTIME_GATE_SNIPPET =
  `${UNWRAP}; import('./src/lib/content-core/draft-life-gates.ts').then((m) => { console.log('RUNTIME_GATE ' + u(m).DRAFT_GATE_VERSION) })`
export function readRuntimeGate(runtimeRoot: string): string | null {
  try {
    const out = execFileSync('npx', ['tsx', '-e', RUNTIME_GATE_SNIPPET], { cwd: runtimeRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 })
    const line = out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('RUNTIME_GATE ')).pop()
    const v = line?.slice('RUNTIME_GATE '.length).trim() ?? ''
    // 🔴 이름을 못 찾은 판(`undefined`)은 판이 아니다
    return /^[A-Za-z0-9._-]+$/.test(v) && v !== 'undefined' && v !== 'null' ? v : null
  } catch { return null }
}
