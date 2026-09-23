/**
 * M-GRAPH 자동 차단이 쓰는 Vercel 조작 — **실제 CLI 계약**에 맞춘다.
 *
 * ── 🔴 왜 따로 있나 ──
 *   앞판은 watch 안에 이렇게 적혀 있었다.
 *     `vercel env add MGRAPH_GRAPH_KILL production --token ... --force`
 *     `vercel redeploy --token ... --yes`
 *   둘 다 **실제로는 작동하지 않는다.**
 *     · `env add` 는 값을 `--value` 로 주지 않으면 stdin 을 기다린다 → launchd 에서 멈춘다
 *     · `redeploy` 는 대상(url 또는 id)이 **위치 인자**다. 없으면 무엇을 다시 배포할지 모른다
 *     · `--token` 은 launchd 환경에 없다(plist 에 토큰을 두지 않는다)
 *   "차단했다" 고 보고하면서 아무것도 끄지 못하는 상태였다.
 *
 * ── 🔴 credential ──
 *   **토큰을 저장소·plist·로그에 두지 않는다.** 이미 로그인된 CLI 자격을 그대로 쓴다.
 *   자격은 `~/Library/Application Support/com.vercel.cli` 에 있고, launchd 가 주는
 *   `HOME` 만 있으면 CLI 가 찾는다. 실측(2026-09-23): `env -i HOME=... PATH=...` 로
 *   launchd 환경을 재현해 `whoami` 와 `inspect` 가 모두 성공했다.
 *
 * ── 🔴 프로젝트를 우연에 맡기지 않는다 ──
 *   CLI 는 기본적으로 **현재 작업 디렉터리**의 `.vercel/project.json` 으로 프로젝트를 정한다.
 *   watch 가 도는 magazine-runtime 에는 그 파일이 **없다**. 그대로 두면 프로젝트를 못 찾거나,
 *   더 나쁘게는 엉뚱한 프로젝트를 건드린다.
 *   그래서 연결된 디렉터리를 **명시적으로 찾아 `--cwd` 로 넘긴다.**
 *   여러 곳에서 서로 다른 projectId 가 나오면 **실패로 끝낸다** — 짐작하지 않는다.
 *
 * ── 🔴 어느 배포를 다시 배포하나 ──
 *   "가장 최근 Production" 이 아니라 **도메인이 실제로 가리키는 배포**다.
 *   `vercel inspect <도메인>` 이 alias 를 따라가 그 배포의 id·target·status 를 준다.
 *   `target=production` 이고 `status=Ready` 가 아니면 실패로 끝낸다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 운영 도메인 — 이 도메인이 가리키는 배포가 곧 "지금 Production" 이다 */
export const PRODUCTION_HOST = 'soransoran.com'

export type Run = (bin: string, args: string[]) => { code: number; out: string; err: string }

export type VercelDeps = {
  run: Run
  /** 후보 디렉터리들 — 이 중 `.vercel/project.json` 이 있는 곳을 찾는다 */
  projectDirs: string[]
  /** CLI 실행 파일 */
  bin: string
  exists: (p: string) => boolean
  readFile: (p: string) => string
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; why: string }

export type ProjectLink = { dir: string; projectId: string; orgId: string; projectName: string }

export type ProdDeployment = { id: string; target: string; status: string; url: string }

/**
 * 연결된 Vercel 프로젝트를 **명시적으로** 찾는다.
 *
 * 🔴 여러 디렉터리에 링크가 있어도 **같은 projectId 면 문제없다** — 같은 프로젝트다.
 *    projectId 가 갈리면 어느 쪽인지 알 수 없으므로 실패로 끝낸다.
 */
export function resolveProject(deps: VercelDeps): Resolved<ProjectLink> {
  const found: ProjectLink[] = []
  for (const dir of deps.projectDirs) {
    const f = join(dir, '.vercel/project.json')
    if (!deps.exists(f)) continue
    try {
      const j = JSON.parse(deps.readFile(f)) as Partial<ProjectLink>
      if (!j.projectId || !j.orgId) continue
      found.push({
        dir,
        projectId: j.projectId,
        orgId: j.orgId,
        projectName: j.projectName ?? '(이름 없음)',
      })
    } catch {
      // 깨진 링크 파일은 없는 것으로 본다
    }
  }
  if (found.length === 0) {
    return { ok: false, why: `🔴 연결된 Vercel 프로젝트를 찾지 못했다 (.vercel/project.json 없음: ${deps.projectDirs.join(' · ')})` }
  }
  const ids = [...new Set(found.map((f) => f.projectId))]
  if (ids.length > 1) {
    return { ok: false, why: `🔴 서로 다른 프로젝트가 ${ids.length}개 보인다 — 어느 것인지 확정할 수 없다 (${ids.join(' · ')})` }
  }
  return { ok: true, value: found[0] }
}

/** 로그인돼 있는가. 🔴 토큰을 읽지 않는다 — CLI 가 이미 가진 자격을 확인만 한다 */
export function checkAuth(deps: VercelDeps): Resolved<string> {
  const r = deps.run(deps.bin, ['whoami'])
  if (r.code !== 0) {
    return { ok: false, why: `🔴 Vercel CLI 에 로그인돼 있지 않다 (${(r.err || r.out).trim().split('\n').pop() ?? r.code})` }
  }
  const who = r.out.trim().split('\n').filter(Boolean).pop() ?? ''
  if (!who) return { ok: false, why: '🔴 whoami 가 사용자를 돌려주지 않았다' }
  return { ok: true, value: who }
}

/**
 * 운영 도메인이 **지금 가리키는** Production 배포.
 *
 * 🔴 "가장 최근 배포" 를 쓰지 않는다. 최근 배포가 alias 를 받지 못했을 수 있고,
 *    그러면 독자가 보는 것과 다른 배포를 다시 배포하게 된다.
 */
export function resolveProdDeployment(
  deps: VercelDeps,
  project: ProjectLink,
  host = PRODUCTION_HOST,
): Resolved<ProdDeployment> {
  const r = deps.run(deps.bin, ['inspect', host, '--cwd', project.dir])
  if (r.code !== 0) {
    return { ok: false, why: `🔴 ${host} 의 배포를 조회하지 못했다 (${(r.err || r.out).trim().split('\n').pop() ?? r.code})` }
  }
  const text = `${r.out}\n${r.err}`
  const pick = (key: string) => {
    const m = new RegExp(`^\\s*${key}\\s+(.+)$`, 'm').exec(text)
    return m ? m[1].trim().replace(/^●\s*/, '') : ''
  }
  const id = pick('id')
  const target = pick('target')
  const status = pick('status')
  const url = pick('url')
  if (!id) return { ok: false, why: `🔴 ${host} 의 배포 id 를 읽지 못했다` }
  if (target !== 'production') {
    return { ok: false, why: `🔴 ${host} 가 가리키는 배포의 target 이 production 이 아니다 (${target || '알 수 없음'})` }
  }
  if (status !== 'Ready') {
    return { ok: false, why: `🔴 ${host} 의 Production 배포가 Ready 가 아니다 (${status || '알 수 없음'}) — 확정될 때까지 건드리지 않는다` }
  }
  return { ok: true, value: { id, target, status, url } }
}

/**
 * `MGRAPH_GRAPH_KILL=1` 을 Production 에 **비대화식으로** 세운다.
 *
 * 🔴 `--value 1` 없으면 stdin 을 기다린다 — launchd 에서는 그대로 멈춘다.
 * 🔴 `--yes` 없으면 확인 프롬프트가 뜬다.
 * 🔴 `--force` 없으면 이미 있는 값에 대해 실패한다 (두 번째 차단이 안 된다).
 */
export function setKillEnv(deps: VercelDeps, project: ProjectLink): Resolved<string> {
  const args = [
    'env', 'add', 'MGRAPH_GRAPH_KILL', 'production',
    '--value', '1',
    '--yes',
    '--force',
    '--cwd', project.dir,
  ]
  const r = deps.run(deps.bin, args)
  if (r.code !== 0) {
    return { ok: false, why: `🔴 MGRAPH_GRAPH_KILL 설정 실패 (${(r.err || r.out).trim().split('\n').slice(-2).join(' / ')})` }
  }
  return { ok: true, value: `MGRAPH_GRAPH_KILL=1 (production)` }
}

/**
 * 그 배포를 **대상을 명시해서** 다시 배포한다.
 *
 * 🔴 환경변수만 바꾸면 현재 배포는 그대로다. 재배포까지가 한 조치다.
 * 🔴 대상 없는 `vercel redeploy` 는 무엇을 다시 배포할지 모른다 — 반드시 id 를 준다.
 */
export function redeployProduction(
  deps: VercelDeps,
  project: ProjectLink,
  deployment: ProdDeployment,
): Resolved<string> {
  const args = ['redeploy', deployment.id, '--target', 'production', '--cwd', project.dir]
  const r = deps.run(deps.bin, args)
  if (r.code !== 0) {
    return { ok: false, why: `🔴 재배포 실패 (${(r.err || r.out).trim().split('\n').slice(-2).join(' / ')})` }
  }
  return { ok: true, value: `${deployment.id} 재배포 트리거됨` }
}

/**
 * 실행 파일을 찾는다.
 *
 * 🔴 PATH 에 없을 수 있다(이 기계에서는 npx 캐시에만 있다). 찾지 못하면
 *    **명확히 실패**한다 — 조용히 넘어가면 차단이 안 된 채 초록불이 켜진다.
 */
export function resolveBin(
  candidates: string[],
  exists: (p: string) => boolean = existsSync,
): Resolved<string> {
  for (const c of candidates) {
    if (!c) continue
    // PATH 로 찾는 이름은 존재 확인 없이 그대로 쓴다 (실행할 때 판가름난다)
    if (!c.includes('/')) return { ok: true, value: c }
    if (exists(c)) return { ok: true, value: c }
  }
  return { ok: false, why: `🔴 vercel 실행 파일을 찾지 못했다 (${candidates.filter(Boolean).join(' · ')})` }
}

/**
 * 실제 회차가 쓰는 실행기.
 *
 * 🔴 **`execFileSync` 를 쓰지 않는다.** 그것은 성공했을 때 **stdout 만** 돌려준다.
 *    그런데 `vercel inspect` 는 사람이 읽는 출력을 **전부 stderr 로** 보낸다(실측) —
 *    stdout 은 비어 있다. execFileSync 로 받으면 배포 id 를 영영 못 읽고
 *    "배포를 확정하지 못했다" 로 끝난다. 실제로 그 결함을 이 자리에서 겪었다.
 *    `spawnSync` 는 성공·실패 모두 둘 다 준다.
 */
export const realRun: Run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 180_000 })
  if (r.error) return { code: 1, out: '', err: r.error.message }
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

/** 🔴 기본 후보. 이 기계의 실제 배치에서 왔다 — 없으면 실패하지, 짐작하지 않는다 */
export function defaultProjectDirs(home = process.env.HOME ?? ''): string[] {
  const fromEnv = process.env.MGRAPH_VERCEL_PROJECT_DIR
  if (fromEnv) return [fromEnv]
  return [
    join(home, 'Documents/soransoran-product'),
    join(home, 'Documents/soransoran'),
  ]
}

export function defaultBinCandidates(home = process.env.HOME ?? ''): string[] {
  return [
    process.env.MGRAPH_VERCEL_BIN ?? '',
    join(home, '.npm/_npx/67eb4586ca667318/node_modules/.bin/vercel'),
    'vercel',
  ]
}

export function makeRealDeps(): Resolved<VercelDeps> {
  const bin = resolveBin(defaultBinCandidates())
  if (!bin.ok) return bin
  return {
    ok: true,
    value: {
      run: realRun,
      bin: bin.value,
      projectDirs: defaultProjectDirs(),
      exists: existsSync,
      readFile: (p) => readFileSync(p, 'utf8'),
    },
  }
}
