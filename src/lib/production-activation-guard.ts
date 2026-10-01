/**
 * 🔴 **운영 적용 열림 판정 — 순수 함수** (2026-10-02 · Phase G)
 *
 *   배포된 코드가 아닌 것으로 운영 DB 에 쓰지 않는다. 운영 apply 는 아래가 **전부** 참일 때만 열린다.
 *
 *   ① 명시 플래그   `--apply --production --target=<40자리 SHA>` 셋 다 — 하나라도 없으면 운영이 아니다
 *   ② 같은 코드     실행 직전 fetch 한 origin/main · 지금 repo HEAD · runtime HEAD · runtime pin · runtime manifest
 *                   다섯이 모두 target 과 같다(모르면 같지 않다)
 *   ③ 깨끗한 트리   runtime 작업 트리 변경 0
 *   ④ 쓰는 job 0    D100 writer job 이 하나라도 **실행 중**이거나 상태를 모르면 거부한다 — unload 하지 않는다
 *   ⑤ 정본 env      canonical env 에서 DB 주소를 읽었고, 격리 DB 모양이 아니다(값은 판정에만 쓰고 찍지 않는다)
 *   ⑥ 승인          fresh dry-run digest · 정확한 expect(지금:적용 뒤) · 비어 있지 않은 reason
 *
 * 🔴 DB · 파일 · 네트워크 · 프로세스 없음. 사실은 `scripts/lib/production-activation.mts` 가 모아 넘긴다.
 * 🔴 기존 격리 DB `--apply`(플래그 `--production` 없음)는 이 판정과 무관하게 그대로다.
 */

export const SHA40 = /^[0-9a-f]{40}$/
/** 🔴 dry-run 이 내는 계획 지문 — Persona(24 hex) · 감사 해소(64 hex) */
export const PLAN_DIGEST = /^[0-9a-f]{16,64}$/
export const EXPECT_PAIR = /^(\d+):(\d+)$/

export type ActivationFlags = { apply: boolean; production: boolean; target: string | null }
export type ActivationMode =
  | { mode: 'dry-run' }
  | { mode: 'isolated' }
  | { mode: 'production'; target: string }
  | { mode: 'refuse'; problems: string[] }

/** 🔴 플래그 조합 — 운영은 셋 다 명시해야만 열린다. 애매한 조합은 거부한다 */
export function activationModeOf(f: ActivationFlags): ActivationMode {
  if (!f.apply) {
    return f.production || f.target !== null
      ? { mode: 'refuse', problems: ['--production · --target 은 --apply 와 함께만 쓴다'] }
      : { mode: 'dry-run' }
  }
  if (!f.production) {
    return f.target !== null ? { mode: 'refuse', problems: ['--target 은 --production 과 함께만 쓴다'] } : { mode: 'isolated' }
  }
  if (f.target === null || !SHA40.test(f.target)) return { mode: 'refuse', problems: ['--target=<40자리 소문자 SHA> 가 필요하다'] }
  return { mode: 'production', target: f.target }
}

/** `launchctl print` 한 번의 결과 */
export type WriterProbe = { label: string; exitCode: number | null; stdout: string; stderr: string }
export type WriterState = 'running' | 'idle' | 'unknown'

/**
 * 🔴 **writer job 이 지금 돌고 있는가.** `state = running` 이면 running, 도메인에 없거나(`Could not find service`)
 *    `state = not running` 이면 idle. 나머지는 모른다 — 모르면 거부한다.
 */
export function writerStateOf(p: WriterProbe): WriterState {
  if (p.exitCode === 0) {
    if (/^\s*state = running\s*$/m.test(p.stdout)) return 'running'
    if (/^\s*state = not running\s*$/m.test(p.stdout)) return 'idle'
    return 'unknown'
  }
  if (p.exitCode !== null && /Could not find service/.test(`${p.stderr}\n${p.stdout}`)) return 'idle'
  return 'unknown'
}

export type ProductionFacts = {
  /** 실행 직전 `git fetch origin main` 뒤의 origin/main — fetch 실패면 null */
  originMain: string | null
  repoHead: string | null
  runtimeHead: string | null
  runtimePin: string | null
  /** `runtime-manifest.json` 의 `sha` */
  runtimeManifestSha: string | null
  /** `git status --porcelain` 이 비었는가. 못 봤으면 null */
  runtimeClean: boolean | null
  writers: readonly { label: string; state: WriterState }[]
  /** 🔴 값이 아니라 판정 결과만 — 주소를 담지 않는다 */
  canonicalEnv: { read: boolean; hasDatabaseUrl: boolean; looksIsolated: boolean }
}

/** 🔴 운영 열림의 사실 판정 — 비어 있으면 열린다. 문구에 SHA 앞 12자리 · label 만 담는다(값 · secret 없음) */
export function productionGuardProblems(target: string, f: ProductionFacts): string[] {
  const out: string[] = []
  if (!SHA40.test(target)) out.push('target 이 40자리 SHA 가 아니다')
  const same = (label: string, v: string | null): void => {
    if (v === null || v === '') out.push(`${label} 를 읽지 못했다 — 같다고 보지 않는다`)
    else if (v !== target) out.push(`${label} ${v.slice(0, 12)} ≠ target ${target.slice(0, 12)}`)
  }
  same('origin/main(fetch 직후)', f.originMain)
  same('repo HEAD', f.repoHead)
  same('runtime HEAD', f.runtimeHead)
  same('runtime pin', f.runtimePin)
  same('runtime manifest', f.runtimeManifestSha)
  if (f.runtimeClean !== true) out.push(f.runtimeClean === null ? 'runtime 작업 트리 상태를 읽지 못했다' : 'runtime 작업 트리에 변경이 있다')
  if (f.writers.length === 0) out.push('D100 writer job 상태를 하나도 재지 못했다')
  for (const w of f.writers) {
    if (w.state === 'running') out.push(`writer job 실행 중 — ${w.label} (unload 하지 않는다 · 끝난 뒤 다시)`)
    else if (w.state === 'unknown') out.push(`writer job 상태 모름 — ${w.label}`)
  }
  if (!f.canonicalEnv.read) out.push('canonical env 를 읽지 못했다')
  else if (!f.canonicalEnv.hasDatabaseUrl) out.push('canonical env 에 DB 주소가 없다')
  else if (f.canonicalEnv.looksIsolated) out.push('canonical env 의 DB 가 격리 DB 모양이다 — 운영이 아니다')
  return out
}

export type ApprovalInput = { digest: string | null; expect: string | null; reason: string | null }
export type Approval = { digest: string; expected: { before: number; after: number }; reason: string }

/** 🔴 운영 승인 — digest · expect · reason 셋 다. 하나라도 비거나 모양이 틀리면 거부 */
export function approvalOf(a: ApprovalInput): { ok: true; approval: Approval } | { ok: false; problems: string[] } {
  const problems: string[] = []
  if (a.digest === null || !PLAN_DIGEST.test(a.digest)) problems.push('--digest=<fresh dry-run digest> 가 필요하다')
  const m = EXPECT_PAIR.exec(a.expect ?? '')
  if (m === null) problems.push('--expect=<지금>:<적용 뒤> 가 필요하다')
  if ((a.reason ?? '').trim() === '') problems.push('--reason 이 비었다')
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, approval: { digest: a.digest!, expected: { before: Number(m![1]), after: Number(m![2]) }, reason: a.reason!.trim() } }
}

/** 🔴 격리 DB 주소 모양 — 운영 canonical env 가 이 모양이면 운영이 아니다 */
export function looksIsolatedDb(url: string): boolean {
  return /^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url) || /\/soran_test(\?|$)/.test(url)
}
