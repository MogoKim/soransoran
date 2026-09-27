#!/usr/bin/env tsx
/**
 * 적재(fill) 재시도 · 이월 — 순수 검사 (🔴 네트워크 0 · LLM 0 · DB 0 · 쓰기는 mkdtemp 안에서만)
 *
 *   `npm run supply:process-check` 가 이 모듈을 부른다(새 step · 새 npm 명령 없음).
 *   단독으로도 돈다: `npx tsx scripts/supply-fill-retry-check.mts`
 *
 *   ① 오류 분류 — 2026-09-27 실측 stderr(Can't reach · errorCode undefined)는 재시도,
 *      논리·검증·게이트 실패는 재시도하지 않는다. 섞여 있으면 재시도하지 않는다.
 *   ② 재시도 루프 — 횟수 · 대기 · 시간 상한 · 시도별 적재 합
 *   ③ 이월 선택 — 기한 · 개수 상한 · 끝낸 파일 제외 · 품질 계약 거절 · 초안 실패 회차 거절
 *   ④ 계획 — 이월이 있어도 `--up-to` 는 그대로 · 이월만 있는 회차 · 없는 파일 빼기
 *   ⑤ 연결 — 러너가 실제로 이 함수들을 부른다(만든 것과 연결된 것은 다르다)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CARRY_OVER_LOOKBACK_MS, CARRY_OVER_MAX_FILES, FILL_REPORT_PREFIX, FILL_RETRY_POLICY,
  buildFillRecord, classifyFillAttempt, completedCandidateFiles, fillInputsOf, parseFillReport,
  resolveFillArgs, runFillWithRetry, selectCarryOver,
  type CarryCandidateFile, type CarryRunRecord, type FillAttemptResult, type FillReport,
} from '../src/lib/supply-fill-retry'
import { planBoundedCommonPhase, planCarryOverFill, runFileName, type Pending } from '../src/lib/supply-process'
import { qualityContractDigest } from '../src/lib/quality-contract'
import { planCarryOver } from './lib/fill-carry-over.mjs'

type Check = (label: string, ok: boolean, detail?: string) => void

/** 2026-09-27 14:15 KST 회차의 실제 stderr 모양 (경로·주소만 줄였다) */
export const OBSERVED_0927_STDERR = [
  'PrismaClientInitializationError: ',
  'Invalid `prisma.originalPostApprovalQueue.findMany()` invocation in',
  '/x/scripts/micro-seed-supply-autofill.mts:234:60',
  '→ 234 const queueRows = await prisma.originalPostApprovalQueue.findMany(',
  "Can't reach database server at `db.example:6543`",
  'Please make sure your database server is running at `db.example:6543`.',
  '{', "  clientVersion: '6.19.3',", '  errorCode: undefined,', '  retryable: undefined', '}',
].join('\n')

const R = (code: number | null, out: string, spawnError = ''): FillAttemptResult => ({ code, out, spawnError })

export async function runFillRetryChecks(check: Check): Promise<void> {
  console.log('\n[FR] ① 적재 오류 분류 — 일시적 연결만 재시도한다')
  const k = (r: FillAttemptResult): string => {
    const x = classifyFillAttempt(r)
    return x.kind === 'ok' ? 'ok' : `${x.kind}/${x.code}`
  }
  check('[FR] 🔴 09-27 실측 stderr(errorCode undefined) → transient/P1001', k(R(1, OBSERVED_0927_STDERR)) === 'transient/P1001', k(R(1, OBSERVED_0927_STDERR)))
  check('[FR] P1001 코드만 있어도 transient', k(R(1, 'PrismaClientKnownRequestError code P1001')) === 'transient/P1001')
  check('[FR] P1002 서버 응답 시간 초과 → transient',
    k(R(1, 'The database server at `h`:`5432` was reached but timed out.')) === 'transient/P1002')
  check('[FR] P1017 연결이 닫혔다 → transient', k(R(1, 'Error: Server has closed the connection.')) === 'transient/P1017')
  check('[FR] P2024 풀 연결 대기 초과 → transient',
    k(R(1, 'Timed out fetching a new connection from the connection pool.')) === 'transient/P2024')
  check('[FR] exit 0 → ok', k(R(0, '✅ queue=abc')) === 'ok')
  check('[FR] 🔴 적재기 논리 실패(🔴 중단:) → fatal', k(R(1, '🔴 중단: 후보 파일을 찾지 못했습니다: x')) === 'fatal/LOADER_ABORT')
  check('[FR] 🔴 정합 이상 → fatal (다시 돌리면 가려진다)',
    k(R(1, `⑥ 정합 🔴 이상\n${FILL_REPORT_PREFIX}{"applied":true,"loaded":1,"cut":0,"skipped":{},"files":[]}`)) === 'fatal/VERIFY_MISMATCH')
  check('[FR] 🔴 적재기가 끝까지 돌았다(FILL_REPORT) → fatal',
    k(R(1, `${FILL_REPORT_PREFIX}{"applied":true,"loaded":0,"cut":0,"skipped":{},"files":[]}`)) === 'fatal/REPORTED')
  check('[FR] 🔴 유일키 충돌(P2002) → fatal', k(R(1, 'Unique constraint failed on the fields: (`dedupKey`) P2002')) === 'fatal/PRISMA_REQUEST')
  check('[FR] 🔴 PrismaClientValidationError → fatal', k(R(1, 'PrismaClientValidationError: Argument x is missing')) === 'fatal/PRISMA_VALIDATION')
  check('[FR] 🔴 보류 목록 없음(문구 없음) → fatal/UNKNOWN — 모르면 재시도하지 않는다',
    k(R(1, '  🔴 보류 목록 파일이 없습니다: .microseed-data/held-candidates.json')) === 'fatal/UNKNOWN')
  check('[FR] 🔴 연결 문구 + 논리 실패가 섞이면 fatal — 재시도 금지가 이긴다',
    k(R(1, `${OBSERVED_0927_STDERR}\n🔴 중단: 후보 파일을 찾지 못했습니다`)) === 'fatal/LOADER_ABORT')
  check('[FR] 🔴 프로세스가 뜨지 못했다 → fatal/SPAWN', k(R(null, '', 'spawn npx ENOENT')) === 'fatal/SPAWN')
  check('[FR] 🔴 신호로 죽었다 → fatal/SIGNAL', k(R(null, OBSERVED_0927_STDERR)) === 'fatal/SIGNAL')

  console.log('\n[FR] ② 재시도 루프 — 횟수 · 대기 · 시간 상한')
  const scripted = (seq: FillAttemptResult[]) => {
    const waits: number[] = []
    let t = 0
    let calls = 0
    return {
      waits, calls: () => calls,
      opts: {
        runOnce: async (): Promise<FillAttemptResult> => { calls += 1; return seq[Math.min(calls - 1, seq.length - 1)]! },
        sleep: async (ms: number): Promise<void> => { waits.push(ms); t += ms },
        nowMs: () => t,
      },
    }
  }
  {
    const s = scripted([R(1, `   ✅ queue=q1 · APPROVED  a\n${OBSERVED_0927_STDERR}`), R(0, '   ✅ queue=q2 · APPROVED  b')])
    const o = await runFillWithRetry(s.opts)
    check('[FR] 🔴 transient → 다시 부른다 → ok (2회)', o.ok && s.calls() === 2 && o.retries === 1, JSON.stringify(o.attempts))
    check('[FR] 첫 대기는 30초', s.waits.join(',') === '30000')
    check('[FR] 시도별 커밋 합을 센다 (1 + 1)', o.loadedAcrossAttempts === 2)
  }
  {
    const s = scripted([R(1, '🔴 중단: 후보 파일을 찾지 못했습니다')])
    const o = await runFillWithRetry(s.opts)
    check('[FR] 🔴 fatal 은 한 번만 — 다시 부르지 않는다', !o.ok && s.calls() === 1 && s.waits.length === 0)
  }
  {
    const s = scripted([R(1, OBSERVED_0927_STDERR)])
    const o = await runFillWithRetry(s.opts)
    check(`[FR] 🔴 끊김이 계속되면 ${FILL_RETRY_POLICY.maxAttempts}회에서 멈춘다`, !o.ok && s.calls() === FILL_RETRY_POLICY.maxAttempts)
    check('[FR] 대기 30초 → 90초', s.waits.join(',') === '30000,90000')
    check('[FR] 멈춘 이유를 남긴다', /재시도 상한/.test(o.stopReason))
  }
  {
    const s = scripted([R(1, OBSERVED_0927_STDERR)])
    const o = await runFillWithRetry({ ...s.opts, policy: { maxAttempts: 5, delaysMs: [100_000], budgetMs: 250_000 } })
    check('[FR] 🔴 시간 상한을 넘기는 대기는 하지 않는다', s.waits.join(',') === '100000,100000' && s.calls() === 3 && /시간 상한/.test(o.stopReason),
      `${s.waits.join(',')} · ${s.calls()} · ${o.stopReason}`)
  }
  check('[FR] 🔴 정책 상한 — 3회 이하 · 대기 합 ≤ 2분 · 적재 단계 5분 ≤ lock TTL 45분',
    FILL_RETRY_POLICY.maxAttempts <= 3
    && FILL_RETRY_POLICY.delaysMs.reduce((a, b) => a + b, 0) <= 120_000
    && FILL_RETRY_POLICY.budgetMs <= 5 * 60_000)

  console.log('\n[FR] ③ 이월 선택 — 기한 · 상한 · 끝낸 파일 · 품질 계약')
  const NOW_MS = Date.parse('2026-09-27T12:15:00Z')
  const cur = '20260927-121500'
  const rid = (hoursAgo: number): string => {
    const d = new Date(NOW_MS - hoursAgo * 3_600_000).toISOString()
    return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 19).replace(/:/g, '')}`
  }
  const good = { qualityContractDigest: qualityContractDigest(), provenance: 'x' }
  const cf = (runId: string, env: CarryCandidateFile['envelope'] = good, n = 2): CarryCandidateFile =>
    ({ name: `auto-draft-${runId}.candidates.json`, envelope: env, candidateCount: n })
  const st = (fill: string, draft = 'ok'): CarryRunRecord['stages'] =>
    [{ stage: 'judge', status: 'ok' }, { stage: 'draft', status: draft }, ...(fill === '' ? [] : [{ stage: 'fill', status: fill }])]
  const rep = (files: { name: string; cut: number }[]): FillReport => ({
    applied: true, loaded: 0, cut: 0, skipped: {},
    files: files.map((f) => ({ name: f.name, candidates: 2, loaded: 2 - f.cut, skipped: {}, cut: f.cut })),
  })
  const A = rid(7) /* 09-27 05:15 UTC — 실측 회차 모양 */; const B = rid(30); const C = rid(5); const D = rid(4)
  const E = rid(3.5); const F = rid(3); const G = rid(2.5); const H = rid(2); const I = rid(1.5); const J = rid(1)
  const K = rid(6); const L = rid(6.5)
  const runs: CarryRunRecord[] = [
    { runId: A, stages: st('failed') },                  // 옛 기록 · fill 실패 → 이월
    { runId: B, stages: st('failed') },                  // 기한 밖
    { runId: C, stages: st('ok') },                      // 옛 기록 · fill ok → 끝냄
    { runId: D, stages: st('failed') },                  // fill 실패 — 뒤 회차 E 가 이월로 끝냈다
    { runId: E, stages: st('ok'), fill: { ok: true, inputs: [cf(E).name, cf(D).name], report: rep([{ name: cf(E).name, cut: 0 }, { name: cf(D).name, cut: 0 }]) } },
    { runId: F, stages: st('ok'), fill: { ok: true, inputs: [cf(F).name], report: rep([{ name: cf(F).name, cut: 1 }]) } }, // 상한 컷 → 안 끝남
    { runId: G, stages: st('failed') },                  // 계약 다름
    { runId: H, stages: st('failed') },                  // 계약 없음 (b7d90c4 이전)
    { runId: I, stages: st('skipped', 'failed') },       // 초안 실패 회차
    { runId: K, stages: st('failed'), fill: { ok: false, inputs: [cf(K).name], report: null } }, // 새 기록 · 실패
    { runId: L, stages: st('ok'), fill: { ok: true, inputs: [cf(L).name], report: null } },   // 성공했지만 보고 없음 → 모른다
    { runId: cur, stages: st('') },
  ]
  const files: CarryCandidateFile[] = [
    cf(A), cf(B), cf(C), cf(D), cf(E), cf(F),
    cf(G, { ...good, qualityContractDigest: 'f'.repeat(64) }),
    cf(H, { provenance: 'x' }),
    cf(I), cf(J), cf(K), cf(L), cf(cur),
    { name: `auto-draft-${rid(0.5)}.candidates.json`, envelope: null, candidateCount: 0 },
    cf(rid(0.25), good, 0),
    { name: 'publish-candidates-x.json', envelope: good, candidateCount: 1 },
  ]
  // 끝난 파일 · 초안 실패 파일은 회차 기록이 없어 NO_RUN 이 되지 않게 기록을 붙인다
  runs.push({ runId: rid(0.5), stages: st('failed') }, { runId: rid(0.25), stages: st('failed') })
  const sel = selectCarryOver({ files, runs, currentRunId: cur, nowMs: NOW_MS, maxFiles: 10 })
  const codeOf = (runId: string): string =>
    sel.picked.some((p) => p.runId === runId) ? 'PICK'
      : sel.rejected.find((r) => r.name === `auto-draft-${runId}.candidates.json`)?.code ?? '?'
  check('[FR] 🔴 fill 실패한 앞 회차 파일(옛 기록)을 이월한다', codeOf(A) === 'PICK', codeOf(A))
  check('[FR] 🔴 24h 기한 밖은 얹지 않는다 (STALE)', codeOf(B) === 'STALE', codeOf(B))
  check('[FR] 🔴 fill 이 끝난 옛 기록 파일은 얹지 않는다 (COMPLETED)', codeOf(C) === 'COMPLETED', codeOf(C))
  check('[FR] 🔴 뒤 회차가 이월로 끝낸 파일은 다시 얹지 않는다 (COMPLETED)', codeOf(D) === 'COMPLETED', codeOf(D))
  check('[FR] 새 기록 · 컷 0 → 끝냄', codeOf(E) === 'COMPLETED', codeOf(E))
  check('[FR] 🔴 상한 컷이 남은 파일은 안 끝났다 → 이월', codeOf(F) === 'PICK', codeOf(F))
  check('[FR] 🔴 품질 계약이 다른 파일은 얹지 않는다 (CONTRACT)', codeOf(G) === 'CONTRACT', codeOf(G))
  check('[FR] 🔴 품질 계약이 없는 파일(b7d90c4 이전)도 얹지 않는다 (CONTRACT)', codeOf(H) === 'CONTRACT', codeOf(H))
  check('[FR] 🔴 초안이 실패한 회차의 파일은 얹지 않는다 (DRAFT_NOT_OK)', codeOf(I) === 'DRAFT_NOT_OK', codeOf(I))
  check('[FR] 회차 기록이 없는 파일은 얹지 않는다 (NO_RUN)', codeOf(J) === 'NO_RUN', codeOf(J))
  check('[FR] 새 기록 · 적재 실패 → 이월', codeOf(K) === 'PICK', codeOf(K))
  check('[FR] 🔴 성공했지만 보고가 없으면 "끝냈다" 로 보지 않는다 → 이월', codeOf(L) === 'PICK', codeOf(L))
  check('[FR] 이번 회차 파일은 이월이 아니다 (CURRENT)', codeOf(cur) === 'CURRENT', codeOf(cur))
  check('[FR] 못 읽은 파일 · 0건 파일 · 다른 이름은 얹지 않는다',
    codeOf(rid(0.5)) === 'UNREADABLE' && codeOf(rid(0.25)) === 'EMPTY'
    && sel.rejected.some((r) => r.name === 'publish-candidates-x.json' && r.code === 'NAME'))
  check('[FR] 오래된 것부터 고른다', sel.picked.map((p) => p.runId).join(',') === [A, L, K, F].join(','), sel.picked.map((p) => p.runId).join(','))
  const capped = selectCarryOver({ files, runs, currentRunId: cur, nowMs: NOW_MS })
  check(`[FR] 🔴 한 회차 이월은 ${CARRY_OVER_MAX_FILES}개까지 — 넘친 것은 OVER_MAX(다음 회차)`,
    capped.picked.length === CARRY_OVER_MAX_FILES && capped.rejected.filter((r) => r.code === 'OVER_MAX').length === 1)
  check('[FR] 기한 기본값은 24h', CARRY_OVER_LOOKBACK_MS === 24 * 3_600_000)
  check('[FR] 🔴 옛 기록의 fill ok 는 자기 파일만 끝낸다 — 남의 파일을 끝냈다고 하지 않는다',
    !completedCandidateFiles([{ runId: C, stages: st('ok') }]).has(cf(A).name))

  console.log('\n[FR] ④ 계획 — 이월이 있어도 상한은 그대로')
  const pending: Pending = { rawCafe: {}, thin: {}, detail: ['a.detail.jsonl'], shadow: [], candidates: ['auto-draft-x.candidates.json'] }
  const policy = { llm: true, fill: true, upTo: 688, reason: '' }
  const gate = { kind: 'ready' as const, snapshotPath: '/d/s.json', runId: 'R' }
  const ws = { manifestPath: '/d/w.json', shadowPath: '/d/s.shadow.jsonl', candidatesPath: '/d/cur.candidates.json', limit: 5, perStage: { judge: 5, draft: 15 } }
  const fillOf = (carry: string[]): readonly string[] =>
    planBoundedCommonPhase(pending, policy, gate, { ...ws, carryOverPaths: carry }).find((p) => p.stage === 'fill')!.args
  const noCarry = planBoundedCommonPhase(pending, policy, gate, ws).find((p) => p.stage === 'fill')!.args
  check('[FR] 이월이 없으면 인자가 이 PR 전과 같다', noCarry.join(' ') === '--apply --input=/d/cur.candidates.json --up-to=5', noCarry.join(' '))
  const withCarry = fillOf(['/d/a.candidates.json', '/d/b.candidates.json'])
  check('[FR] 🔴 이월 파일이 이번 회차 파일 뒤에 얹힌다',
    fillInputsOf(withCarry).join(',') === '/d/cur.candidates.json,/d/a.candidates.json,/d/b.candidates.json')
  check('[FR] 🔴 🔴 **이월이 있어도 --up-to 는 묶음 크기 그대로** (5)', withCarry.includes('--up-to=5') && withCarry.filter((a) => a.startsWith('--up-to=')).length === 1, withCarry.join(' '))
  check('[FR] 🔴 이월만 있는 회차 — fill 하나 · 상한 min(버퍼, 묶음)',
    planCarryOverFill(policy, ['/d/a.candidates.json'], 5).map((p) => `${p.stage} ${p.args.join(' ')}`).join('|')
      === 'fill --apply --input=/d/a.candidates.json --up-to=5')
  check('[FR] 🔴 버퍼가 적재를 막으면 이월도 없다', planCarryOverFill({ llm: false, fill: false, upTo: 0, reason: '' }, ['/d/a.json'], 5).length === 0)
  check('[FR] 버퍼 여력이 묶음보다 작으면 여력까지', planCarryOverFill({ ...policy, upTo: 2 }, ['/d/a.json'], 5)[0]!.args.includes('--up-to=2'))
  check('[FR] 이월이 0개면 이월 fill 도 없다', planCarryOverFill(policy, [], 5).length === 0)
  {
    const r = resolveFillArgs(withCarry, (p) => p !== '/d/cur.candidates.json')
    check('[FR] 🔴 이번 회차 파일이 없으면(초안 보류) 빼고 이월만 먹인다',
      fillInputsOf(r.args).join(',') === '/d/a.candidates.json,/d/b.candidates.json' && r.missing.join(',') === '/d/cur.candidates.json'
      && r.args.includes('--up-to=5'))
    const none = resolveFillArgs(noCarry, () => false)
    check('[FR] 전부 없으면 계획 그대로 — 적재기가 "파일 없음" 으로 멈춘다(이 PR 전과 같다)', none.args.join(' ') === noCarry.join(' '))
  }

  console.log('\n[FR] ⑤ 보고 · 기록 · 실제 파일 읽기')
  {
    const rp: FillReport = { applied: true, loaded: 1, cut: 1, skipped: { ALREADY: 1, CONTRACT: 2 }, files: [{ name: 'auto-draft-x.candidates.json', candidates: 5, loaded: 1, skipped: { ALREADY: 1 }, cut: 1 }] }
    check('[FR] FILL_REPORT 를 되읽는다 (마지막 줄)', parseFillReport(`a\n${FILL_REPORT_PREFIX}{"files":"bad"}\n${FILL_REPORT_PREFIX}${JSON.stringify(rp)}\n`)?.cut === 1)
    check('[FR] 🔴 모양이 틀린 보고는 null — 끝냈다고 보지 않는다', parseFillReport(`${FILL_REPORT_PREFIX}{"files":"bad"}`) === null)
    const rec = buildFillRecord({
      args: ['--apply', '--input=/d/cur.candidates.json,/d/a.candidates.json', '--up-to=5'], missing: [],
      carryOverPaths: ['/d/a.candidates.json'], carryRejected: [{ name: 'g', code: 'CONTRACT' }, { name: 'c', code: 'COMPLETED' }],
      outcome: await runFillWithRetry({ runOnce: async () => R(0, `${FILL_REPORT_PREFIX}${JSON.stringify(rp)}`), sleep: async () => undefined, nowMs: () => 0 }),
    })
    check('[FR] 기록 — 이월 파일 · 거절 사유(끝낸 것 제외) · 보고',
      rec.carriedOver.join(',') === 'a.candidates.json' && rec.inputs.length === 2
      && rec.carryRejected.map((x) => x.code).join(',') === 'CONTRACT' && rec.report?.cut === 1)
  }
  {
    // 🔴 실제 파일 읽기 — 러너가 쓰는 `planCarryOver` 를 임시 디렉터리로 부른다
    const T = mkdtempSync(join(tmpdir(), 'soran-fillretry-'))
    try {
      mkdirSync(T, { recursive: true })
      const w = (n: string, j: unknown): void => { writeFileSync(join(T, n), JSON.stringify(j)) }
      const cand = (d: string | undefined): unknown => ({ ...(d === undefined ? {} : { qualityContractDigest: d }), candidates: [{}, {}] })
      w(`auto-draft-${A}.candidates.json`, cand(qualityContractDigest()))
      w(runFileName(A), { runId: A, stages: st('failed') })
      w(`auto-draft-${H}.candidates.json`, cand(undefined))
      w(runFileName(H), { runId: H, stages: st('failed') })
      w(`auto-draft-${B}.candidates.json`, cand(qualityContractDigest()))
      w(runFileName(B), { runId: B, stages: st('failed') })
      writeFileSync(join(T, `auto-draft-${C}.candidates.json`), '{ 깨진')
      w(runFileName(C), { runId: C, stages: st('failed') })
      const p = planCarryOver({ dataDir: T, currentRunId: cur, nowMs: NOW_MS })
      check('[FR] 실제 파일 — 계약 맞는 실패 회차만 고른다',
        p.picked.map((x) => x.runId).join(',') === A
        && p.rejected.some((r) => r.code === 'CONTRACT') && p.rejected.some((r) => r.code === 'UNREADABLE')
        && p.staleCount === 1, JSON.stringify(p))
      // 그 회차를 이월로 끝낸 기록이 생기면 다음 회차는 다시 얹지 않는다
      w(runFileName(J), {
        runId: J, stages: st('ok'),
        fill: buildFillRecord({
          args: [`--input=${join(T, `auto-draft-${J}.candidates.json`)},${join(T, `auto-draft-${A}.candidates.json`)}`],
          missing: [], carryOverPaths: [join(T, `auto-draft-${A}.candidates.json`)], carryRejected: [],
          outcome: await runFillWithRetry({
            runOnce: async () => R(0, `${FILL_REPORT_PREFIX}${JSON.stringify(rep([{ name: `auto-draft-${A}.candidates.json`, cut: 0 }]))}`),
            sleep: async () => undefined, nowMs: () => 0,
          }),
        }),
      })
      const p2 = planCarryOver({ dataDir: T, currentRunId: cur, nowMs: NOW_MS })
      check('[FR] 🔴 이월로 끝낸 뒤에는 다시 얹지 않는다 — 러너가 쓰는 기록 모양 그대로',
        p2.picked.length === 0 && p2.rejected.some((r) => r.code === 'COMPLETED'), JSON.stringify(p2.picked))
    } finally { rmSync(T, { recursive: true, force: true }) }
  }

  console.log('\n[FR] ⑥ 연결 — 러너가 실제로 부른다')
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('[FR] 🔴 러너의 fill 이 runFillWithRetry 로 돈다', /plan\.stage === 'fill'[\s\S]{0,400}runFillWithRetry\(/.test(runner))
  check('[FR] 🔴 러너가 이월 파일을 묶음 계획에 넘긴다', /carryOverPaths: carryPaths/.test(runner))
  check('[FR] 🔴 러너가 묶음 없는 회차에 이월 fill 을 세운다', /worksetEmpty \? planCarryOverFill\(policy, carryPaths, WORKSET_LIMIT\)/.test(runner))
  check('[FR] 🔴 러너가 기록을 공용 함수로 만든다', /record\.fill = buildFillRecord\(/.test(runner))
  const loader = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
  check('[FR] 🔴 적재기가 FILL_REPORT 를 찍는다 (두 출구 모두)', (loader.match(/\$\{FILL_REPORT_PREFIX\}\$\{JSON\.stringify\(fillReport\(/g) ?? []).length === 2)
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  let pass = 0
  let fail = 0
  await runFillRetryChecks((n, ok, d = '') => {
    if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${d === '' ? '' : ` — ${d}`}`) }
  })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
  process.exit(fail === 0 ? 0 : 1)
}
