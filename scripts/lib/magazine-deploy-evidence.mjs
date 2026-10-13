/**
 * 매거진 자동 병합의 **Production 배포 증거 수집** — 읽기 전용.
 *
 * ── 🔴 왜 따로 있나 (2026-10-13 #701) ──
 *   cold-weather-joint-pain 복구 PR #701 은 02:00 에 자동 병합됐고(afe70b6),
 *   Vercel 은 그 SHA 로 Production READY 배포를 만들었고, soransoran.com 이 그 배포를 서빙했다.
 *   그런데 결과는 MERGED_UNVERIFIED 였다 — 증거원이 GitHub Deployments API **하나**뿐이었고,
 *   그 SHA 에 대해 GitHub 은 빈 배열(커밋 status 도 0건)을 돌려줬다.
 *   (Vercel 배포 meta 의 githubDeployment="1" — Vercel 은 GitHub 에 남기려 했으나 GitHub 에 없다.)
 *   10분 동안 같은 빈 증거만 다시 읽고 끝났다.
 *
 *   판정(judgeDeploy)의 fail-closed 는 옳았다. 고친 것은 **증거를 모으는 쪽**이다.
 *
 * ── 🔴 계약 ──
 *   ① GitHub Deployments 가 1차 증거원이다. 그것이 **완전하면**(found · success · 같은 SHA · dpl_ id)
 *      Vercel 은 부르지 않는다 (호출 0).
 *   ①' 🔴 **GitHub 의 명시적 결론은 덮지 않는다** (2026-10-13 Codex 재검토 P1-1) — Vercel 호출 0 · GitHub 그대로:
 *        state 가 failure · error            → 관찰이 FAILED 로 끝난다 (Vercel 성공으로 바꾸지 않는다)
 *        기대와 다른 SHA 를 명시적으로 돌려줌 → 충돌 · judgeDeploy 가 DEPLOY_SHA_MISMATCH 로 막는다
 *        그 밖의 모르는 state(inactive 등)   → 허용 목록 밖 · fallback 하지 않는다
 *   ② fallback 은 이때만 — 배포 없음 · 조회 실패 · state 가 pending/queued/in_progress/null ·
 *      success 인데 배포 id 없음. 반드시 이 순서로:
 *        `vercel inspect soransoran.com` → 도메인이 **지금 서빙 중인** 배포 id
 *        `vercel api /v13/deployments/<그 id>` → 그 배포의 원문
 *   ③ 성공 증거는 네 가지가 **모두** 참일 때만:
 *        gitSource.sha === 기대 merge SHA · target === 'production' · readyState === 'READY' ·
 *        API 응답 id === inspect 에서 찾은 id
 *   🔴 "가장 최근 배포" 를 인정하지 않는다 — 도메인이 가리키는 배포만 본다.
 *   🔴 HTTP 200 은 배포 증거가 아니다 — 여기서 HTTP 를 보지 않는다.
 *   🔴 SHA 불일치 · preview · 준비 중 · id 불일치 · 실행 파일 없음 · 프로젝트 미확정 ·
 *      명령 실패 · JSON 파싱 실패는 전부 **증거 없음**이다 (fail-closed).
 *   결과에 `evidenceSource` 를 구조적으로 남긴다 — 'github-deployments' | 'vercel-direct' | null.
 *
 * ── 🔴 M-GRAPH 와 섞지 않는다 ──
 *   `mgraph-vercel.mts` 는 차단(env add · redeploy)까지 하는 쓰기 도구다. 여기는 읽기 둘뿐이다.
 *   프로젝트를 `--cwd` 로 명시하는 **방식**만 같게 했다. 실측 2026-10-13: inspect 출력은 전부 stderr
 *   (CLI 59.26 · 50.35 둘 다 같은 모양).
 *
 * ── 🔴 실행 파일 (Codex 재검토 P1-2) ──
 *   해시가 든 npx 캐시 경로에 기대지 않는다 — 캐시가 지워지면 조용히 사라진다.
 *   ① SORAN_MAGAZINE_VERCEL_BIN  ② 지금 node 옆(`dirname(process.execPath)/vercel`)  ③ PATH 의 vercel.
 *   실행할 수 있는 것만 고른다. 하나도 없으면 VERCEL_UNAVAILABLE 로 막는다.
 *   운영 launchd 의 node 는 nvm bin 이고, 그 옆에 vercel 이 있다 — plist·env 를 바꾸지 않는다.
 *
 * ── 🔴 로그 ──
 *   CLI 원문(stdout·stderr)과 자격 정보는 결과·로그에 남기지 않는다. 실패는 코드와 종료 코드만.
 *
 * ── 🔴 실행은 주입받는다 ──
 *   `exec(cmd, args, opts)` 하나로만 명령을 부른다. 검사는 가짜 exec 로 실제 네트워크 0 이다.
 */
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export const EVIDENCE_GITHUB = 'github-deployments'
export const EVIDENCE_VERCEL = 'vercel-direct'
/** 운영 도메인 — 이 도메인이 가리키는 배포가 곧 "지금 Production" 이다 */
export const PRODUCTION_HOST = 'soransoran.com'
/** Vercel CLI 한 번의 상한 — 멈춘 CLI 가 배포 관찰을 붙잡지 않게 */
export const VERCEL_CALL_TIMEOUT_MS = 60 * 1000

const MISS = Object.freeze({ found: false, state: null, sha: null, deploymentId: null })
const DPL = /^dpl_[A-Za-z0-9]+$/

/** GitHub deployment state 중 "아직 모름" — 이때만 Vercel 로 넘어간다 */
export const GITHUB_FALLBACK_STATES = Object.freeze([null, 'pending', 'queued', 'in_progress'])
/** GitHub 이 명시적으로 실패를 말한 state — 덮지 않는다 */
export const GITHUB_TERMINAL_FAILURES = Object.freeze(['failure', 'error'])

const isExecutable = (p) => { try { accessSync(p, constants.X_OK); return true } catch { return false } }

/**
 * 실행 파일 후보 — 순서가 우선순위다. ① 명시 ② node 옆 ③ PATH 의 각 디렉터리.
 * 🔴 해시가 든 캐시 경로는 넣지 않는다.
 */
export function defaultVercelBinCandidates(env = process.env, execPath = process.execPath) {
  const fromPath = String(env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'vercel'))
  return [env.SORAN_MAGAZINE_VERCEL_BIN ?? '', execPath ? join(dirname(execPath), 'vercel') : '', ...fromPath]
}

export function defaultVercelProjectDirs(env = process.env) {
  if (env.SORAN_MAGAZINE_VERCEL_PROJECT_DIR) return [env.SORAN_MAGAZINE_VERCEL_PROJECT_DIR]
  if (!env.HOME) return []
  return [join(env.HOME, 'Documents/soransoran-product'), join(env.HOME, 'Documents/soransoran')]
}

/** 실행 파일을 찾는다 — 🔴 절대 경로이고 **실행할 수 있는** 첫 후보만. 이름만 있는 후보는 받지 않는다 */
export function resolveVercelBin(candidates, executable = isExecutable) {
  for (const c of candidates) {
    if (!c || !c.startsWith('/')) continue
    if (executable(c)) return { ok: true, value: c }
  }
  return { ok: false, why: `실행할 수 있는 vercel 을 찾지 못했다 (후보 ${candidates.filter(Boolean).length}개)` }
}

/**
 * 연결된 Vercel 프로젝트 디렉터리 — `--cwd` 로 넘긴다 (runtime 에는 `.vercel/project.json` 이 없다).
 * 🔴 서로 다른 projectId 가 보이면 실패다 — 짐작하지 않는다.
 */
export function resolveVercelProjectDir(dirs, exists = existsSync, readFile = (p) => readFileSync(p, 'utf8')) {
  const found = []
  for (const dir of dirs) {
    const f = join(dir, '.vercel/project.json')
    if (!exists(f)) continue
    try {
      const j = JSON.parse(readFile(f))
      if (j?.projectId && j?.orgId) found.push({ dir, projectId: j.projectId })
    } catch { /* 깨진 링크 파일은 없는 것으로 본다 */ }
  }
  if (found.length === 0) return { ok: false, why: `연결된 Vercel 프로젝트를 찾지 못했다 (${dirs.join(' · ') || '후보 없음'})` }
  const ids = [...new Set(found.map((f) => f.projectId))]
  if (ids.length > 1) return { ok: false, why: `서로 다른 Vercel 프로젝트가 ${ids.length}개 보인다 — 확정할 수 없다` }
  return { ok: true, value: found[0].dir }
}

/** 실제 회차의 Vercel 실행 맥락 — 부를 때마다 다시 찾는다 (회차 중 설치·링크 변화를 짐작하지 않는다) */
export function resolveVercelContext({ env = process.env, execPath = process.execPath, executable = isExecutable, exists = existsSync, readFile } = {}) {
  const bin = resolveVercelBin(defaultVercelBinCandidates(env, execPath), executable)
  if (!bin.ok) return bin
  const dir = resolveVercelProjectDir(defaultVercelProjectDirs(env), exists, readFile)
  if (!dir.ok) return dir
  return { ok: true, value: { bin: bin.value, projectDir: dir.value } }
}

/** GitHub 증거가 그 자체로 완전한가 — 이때만 Vercel 을 부르지 않는다 */
export function isCompleteGithubEvidence(d, sha) {
  return Boolean(d && d.found === true && d.state === 'success' && sha && d.sha === sha && DPL.test(d.deploymentId ?? ''))
}

/** `vercel inspect <도메인>` 사람용 출력(stderr)에서 배포 id 만 */
export function parseInspectId(text) {
  const m = /^\s*id\s+(dpl_[A-Za-z0-9]+)\s*$/m.exec(String(text ?? ''))
  return m ? m[1] : null
}

/**
 * 배포 원문이 기대 merge SHA 의 Production READY 이고 도메인이 가리키는 그 배포인가.
 * 🔴 넷 다 참이어야 null(통과). 하나라도 아니면 그 코드를 돌려준다.
 */
export function vercelDeploymentVerdict({ json, liveId, sha }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { code: 'VERCEL_API_BAD_JSON', why: '배포 원문이 객체가 아니다' }
  if (json.id !== liveId) return { code: 'VERCEL_ID_MISMATCH', why: `API 응답 id(${json.id ?? '없음'})가 도메인 배포 id(${liveId})와 다르다` }
  if (json.gitSource?.sha !== sha) return { code: 'VERCEL_SHA_MISMATCH', why: `도메인 배포의 SHA(${String(json.gitSource?.sha ?? '없음').slice(0, 7)})가 merge SHA(${String(sha).slice(0, 7)})가 아니다` }
  if (json.target !== 'production') return { code: 'VERCEL_NOT_PRODUCTION', why: `target 이 ${json.target ?? '없음'} 다 — production 이 아니다` }
  if (json.readyState !== 'READY') return { code: 'VERCEL_NOT_READY', why: `readyState 가 ${json.readyState ?? '없음'} 다 — READY 가 아니다` }
  return null
}

/**
 * Vercel 직접 확인 — inspect(도메인) → api(그 id). 실패는 전부 `{ ok:false, code, why }`.
 * @param {{ sha:string, exec:Function, context:{ok:boolean, value?:{bin:string, projectDir:string}, why?:string} }} p
 */
export function verifyVercelDirect({ sha, exec, context }) {
  const no = (code, why) => ({ ok: false, code, why })
  if (!sha) return no('NO_SHA', 'merge SHA 가 없다')
  if (!context?.ok) return no('VERCEL_UNAVAILABLE', context?.why ?? 'Vercel 실행 맥락이 없다')
  const { bin, projectDir } = context.value
  const opts = { timeoutMs: VERCEL_CALL_TIMEOUT_MS }

  // 🔴 실행 자체가 던져도(가드·권한) 증거 없음으로 끝낸다. 실패 사유에 CLI 원문을 싣지 않는다 — 종료 코드만
  const run = (args) => { try { return exec(bin, args, opts) } catch { return { code: -1, out: '', err: '' } } }

  const ins = run(['inspect', PRODUCTION_HOST, '--cwd', projectDir])
  if (ins.code !== 0) return no('VERCEL_INSPECT_FAILED', `${PRODUCTION_HOST} inspect 실패 (종료 ${ins.code})`)
  const liveId = parseInspectId(`${ins.out}\n${ins.err}`)
  if (!liveId) return no('VERCEL_INSPECT_NO_ID', `${PRODUCTION_HOST} inspect 에서 배포 id 를 읽지 못했다`)

  const api = run(['api', `/v13/deployments/${liveId}`, '--cwd', projectDir])
  if (api.code !== 0) return no('VERCEL_API_FAILED', `배포 원문 조회 실패 (종료 ${api.code})`)
  let json
  try { json = JSON.parse(api.out) } catch { return no('VERCEL_API_BAD_JSON', '배포 원문을 JSON 으로 읽지 못했다') }

  const bad = vercelDeploymentVerdict({ json, liveId, sha })
  if (bad) return no(bad.code, bad.why)
  return { ok: true, deployment: { found: true, state: 'success', sha: json.gitSource.sha, deploymentId: liveId, evidenceSource: EVIDENCE_VERCEL } }
}

/**
 * GitHub 증거가 불완전할 때 Vercel 로 넘어가도 되는가.
 * 🔴 GitHub 의 **명시적 결론**(failure·error · 다른 SHA · 허용 목록 밖 state)은 넘어가지 않는다 — 덮지 않는다.
 */
export function githubFallbackGate(gh, sha) {
  if (!gh?.found) return { allowed: true, miss: 'NOT_FOUND' }
  if (GITHUB_TERMINAL_FAILURES.includes(gh.state)) return { allowed: false, miss: `TERMINAL_${gh.state}` }
  if (gh.sha && gh.sha !== sha) return { allowed: false, miss: 'SHA_CONFLICT' }
  if (gh.state === 'success') return { allowed: true, miss: DPL.test(gh.deploymentId ?? '') ? 'NO_SHA' : 'NO_DEPLOYMENT_ID' }
  if (GITHUB_FALLBACK_STATES.includes(gh.state ?? null)) return { allowed: true, miss: `STATE_${gh.state ?? 'null'}` }
  return { allowed: false, miss: `STATE_${gh.state}` }
}

/**
 * GitHub 1차 → (불완전하고 결론이 없을 때만) Vercel 직접.
 * GitHub 이 결론을 냈거나 Vercel 도 실패하면 GitHub 이 준 것을 그대로 돌려준다 —
 * 관찰·판정은 예전과 같다 (FAILED · DEPLOY_SHA_MISMATCH · DEPLOY_NOT_FOUND · NOT_READY …).
 */
export function collectProductionDeployment({ sha, github, vercelDirect }) {
  const gh = github(sha) ?? MISS
  if (isCompleteGithubEvidence(gh, sha)) return { ...gh, evidenceSource: EVIDENCE_GITHUB }
  const gate = githubFallbackGate(gh, sha)
  if (!gate.allowed) return { ...gh, evidenceSource: EVIDENCE_GITHUB, githubMiss: gate.miss, fallback: null }
  const v = vercelDirect(sha)
  if (v.ok) return { ...v.deployment, githubMiss: gate.miss }
  return { ...gh, evidenceSource: gh.found ? EVIDENCE_GITHUB : null, githubMiss: gate.miss, fallback: { code: v.code, why: v.why } }
}
