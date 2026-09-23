#!/usr/bin/env tsx
/**
 * M-GRAPH 연관 글 감시 — 하단 링크에 **미공개 글이 뜨는지**를 실제 화면에서 본다.
 *
 * 정본: docs/operations/magazine-automation-runbook.md
 * 형태는 scripts/magazine-auto-merge.mjs 의 `--watch` 를 그대로 따른다 —
 * 주입 가능한 deps · `ok`/`findings` · Slack 알림 · 종료 코드.
 *
 * ── 🔴 언제 · 어디서 도는가 ──
 *   launchd `com.soransoran.magazine-graph-watch` · **매일 11:05 KST** · 창업자 Mac.
 *   기존 `com.soransoran.magazine-watch`(11:00)가 "예약한 글이 나왔는가" 를 본 **직후**다.
 *   순서에 이유가 있다 — 공개가 끝난 뒤라야 "아직 안 나온 글이 링크에 떴다" 가 참이 된다.
 *   설치: `npm run magazine:launchd-install -- --apply` (MAGAZINE_JOBS 에 등록돼 있다)
 *
 * ── 🔴 왜 따로 보는가 ──
 *   기존 watch 는 "예약한 글이 10:30 에 실제로 나왔는가" 를 본다.
 *   그래프가 붙으면 반대 방향의 사고가 생긴다 — **아직 나오면 안 되는 글이
 *   다른 글의 하단에 링크로 뜨는 것**이다. 목록에도 sitemap 에도 없는 글의
 *   주소가 그렇게 새어 나가면 검색엔진이 미완성 글을 먼저 본다.
 *
 * ── 🔴 세 층의 차단. 사람 승인 단계가 없다 ──
 *
 *   층 0  요청 단위 폴백      배포도 커밋도 필요 없다. resolver 가 이미 한다 —
 *                            `getAllMagazineArticles()` 에 없는 slug 는 애초에
 *                            후보가 되지 못한다. **유일하게 지연이 없는 층이다.**
 *   층 1  환경변수 + 재배포    MGRAPH_GRAPH_KILL=1 을 Vercel 에 세우고 **재배포를 건다.**
 *                            🔴 값만 바꾸면 현재 배포는 그대로다. 그래서 이 감시는
 *                            설정과 재배포를 **둘 다** 호출한다. 하나만 하면 아무 일도 안 난다.
 *   층 2  control.ts 커밋     영구 차단. 그래프 전용 레인으로 PR → 자동 병합 → 배포.
 *
 * ── 🔴 이 감시가 하지 않는 것 ──
 *   · 원고를 고치지 않는다. 글을 내리지 않는다.
 *   · 🔴 **감시 실패가 매거진 렌더·예약 공개를 막지 않는다.** 제품은 그대로 돈다.
 *   · 🔴 **네트워크 실패로 차단하지 않는다.** 404·500·타임아웃·연결 불가는 전부
 *     `CHECK_UNREACHABLE` 이다 — **못 본 것**이지 샌 것이 아니다. 끊김으로 끄면
 *     그래프를 영영 못 켠다. 다만 조용히 넘어가지도 않는다: 경고 + non-zero.
 *   · 🔴 **credential 이 없을 때 성공으로 속이지 않는다.** 차단이 필요한데 토큰이
 *     없으면 `AUTOMATION_FAILED` 로 **실패**한다. "알렸으니 됐다" 로 끝내면
 *     아무도 안 끈 채로 초록불이 켜진다.
 *
 * 사용법
 *   npx tsx scripts/magazine-graph-watch.mts              읽기만 (변경 0)
 *   npx tsx scripts/magazine-graph-watch.mts --apply      🔴 차단을 실제로 실행한다
 *   npx tsx scripts/magazine-graph-watch.mts --notify-send  Slack 실제 발송
 *
 * 종료 코드: 관측된 문제가 없으면 0 · 있으면 1
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkAuth,
  makeRealDeps,
  redeployProduction,
  resolveProdDeployment,
  resolveProject,
  setKillEnv,
  type ProdDeployment,
  type ProjectLink,
  type VercelDeps,
} from './lib/mgraph-vercel.mjs'
import { getAllMagazineArticles } from '../src/lib/magazine'
import { MAGAZINE_ARTICLES } from '../src/content/magazine/articles'

export const SITE = 'https://soransoran.com'
const ROOT = join(import.meta.dirname, '..')
const CONTROL_FILE = join(ROOT, 'src/content/magazine/graph/control.ts')

/** 🔴 상태 코드를 **반드시** 본다. 200 이 아닌 응답의 본문은 화면이 아니다 */
export type PageFetch =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number | null; why: string }

export type StepResult = { ok: boolean; detail: string }

/** 준비 단계의 결과 — 실패면 이유를 그대로 로그와 Slack 에 싣는다 */
export type Resolved<T> = { ok: true; value: T } | { ok: false; why: string }

export type GraphWatchDeps = {
  fetchPage: (url: string) => PageFetch
  now: () => Date
  /**
   * 층 1 — 환경변수와 재배포. 🔴 **둘 다** 해야 반영된다.
   *
   * 🔴 준비(`preflight`)와 실행을 나눈다. 로그인·프로젝트·Production 배포가
   *    하나로 확정되지 않으면 **아무것도 건드리지 않고** 실패로 끝낸다 —
   *    반쯤 끄다 마는 것이 안 끄는 것보다 나쁘다.
   */
  vercel: {
    preflight: () => Resolved<{ who: string; project: ProjectLink; deployment: ProdDeployment }>
    setKillEnv: (ctx: { project: ProjectLink }) => StepResult
    redeploy: (ctx: { project: ProjectLink; deployment: ProdDeployment }) => StepResult
  }
  /** 층 2 — control.ts 를 그래프 전용 레인으로 내보낸다 */
  lane: {
    hasCredentials: () => boolean
    commitAndMerge: (reason: string) => StepResult
  }
  writeControl: (reason: string, at: Date) => StepResult
}

export type GraphWatchFinding = {
  code: 'UNPUBLISHED_LEAK' | 'SELF_LINK' | 'DUPLICATE_LINK' | 'CHECK_UNREACHABLE'
  message: string
  slug: string
  targetSlug?: string
}

export type GraphWatchReport = {
  ok: boolean
  checked: number
  unreachable: number
  findings: GraphWatchFinding[]
  /** 🔴 관측 결과가 요구하는 조치. 사람 승인 없이 그대로 실행된다 */
  action: 'NONE' | 'TRIP_GLOBAL'
  /** --apply 로 실제 실행한 차단 단계들 */
  steps: { name: string; ok: boolean; detail: string }[]
  /** 🔴 차단이 필요했는데 끝까지 가지 못했다 — 알림으로 갈음하지 않는다 */
  automationFailed: boolean
}

/**
 * 하단 「함께 읽어보세요」 안의 매거진 링크만 뽑는다.
 *
 * 🔴 본문 전체에서 `/magazine/` 을 긁지 않는다 — 본문 cta 와 빵부스러기까지 섞여
 *    있지도 않은 사고를 만들어낸다. 제목 문구부터 그 `</section>` 까지만 본다.
 * 🔴 문구는 RelatedMagazineList 의 h2 와 같아야 한다. 화면을 고치면서 이 문구를
 *    바꾸면 감시가 조용히 0건을 보게 되므로, 회귀가 그 문구의 존재를 따로 확인한다.
 */
export function extractRelatedLinks(html: string): string[] {
  const start = html.indexOf('함께 읽어보세요')
  if (start === -1) return []
  const end = html.indexOf('</section>', start)
  const section = html.slice(start, end === -1 ? html.length : end)
  return [...section.matchAll(/href="\/magazine\/([a-z0-9-]+)"/g)].map((m) => m[1])
}

export async function runGraphWatch({
  deps,
  articles = getAllMagazineArticles(),
  site = SITE,
  apply = false,
}: {
  deps: GraphWatchDeps
  articles?: { slug: string }[]
  site?: string
  apply?: boolean
}): Promise<GraphWatchReport> {
  const publicSlugs = new Set(articles.map((a) => a.slug))
  const findings: GraphWatchFinding[] = []
  const steps: { name: string; ok: boolean; detail: string }[] = []
  let checked = 0
  let unreachable = 0

  for (const article of articles) {
    const res = deps.fetchPage(`${site}/magazine/${article.slug}`)
    if (!res.ok) {
      unreachable++
      findings.push({
        code: 'CHECK_UNREACHABLE',
        // 🔴 404·500·타임아웃을 한 코드로 묶되 **무엇이었는지는 남긴다**
        message: `페이지를 읽지 못했다 (${res.status ?? '응답 없음'}: ${res.why}) — 못 본 것이지 샌 것이 아니다`,
        slug: article.slug,
      })
      continue
    }
    checked++

    const links = extractRelatedLinks(res.body)
    const seen = new Set<string>()
    for (const target of links) {
      if (target === article.slug) {
        findings.push({ code: 'SELF_LINK', message: '자기 자신을 링크했다', slug: article.slug, targetSlug: target })
      }
      if (seen.has(target)) {
        findings.push({ code: 'DUPLICATE_LINK', message: '같은 글이 두 번 나왔다', slug: article.slug, targetSlug: target })
      }
      seen.add(target)
      if (!publicSlugs.has(target)) {
        findings.push({
          code: 'UNPUBLISHED_LEAK',
          message: '🔴 공개되지 않은 글이 링크에 떴다',
          slug: article.slug,
          targetSlug: target,
        })
      }
    }
  }

  /**
   * 🔴 전체 차단은 **실제로 관측한 미공개 누출 1건**에서만 건다.
   *    자기 링크·중복은 보기 싫은 것이지 새는 것이 아니다 — 알리고 끝낸다.
   *    연결 실패는 관측이 아니다 — 차단하지 않는다.
   */
  const leaked = findings.filter((f) => f.code === 'UNPUBLISHED_LEAK')
  const action: 'NONE' | 'TRIP_GLOBAL' = leaked.length > 0 ? 'TRIP_GLOBAL' : 'NONE'
  let automationFailed = false

  if (action === 'TRIP_GLOBAL' && apply) {
    const reason = `미공개 누출 ${leaked.length}건 (${leaked[0].slug} → ${leaked[0].targetSlug})`
    const step = (name: string, r: StepResult) => {
      steps.push({ name, ...r })
      if (!r.ok) automationFailed = true
    }

    /**
     * 🔴 **준비가 확정되지 않으면 아무것도 건드리지 않는다.**
     *    로그인 · 연결된 프로젝트 하나 · Ready 인 Production 배포 하나 —
     *    셋이 다 서야 실행한다. 반쯤 끄다 마는 것이 안 끄는 것보다 나쁘다.
     *
     * 🔴 건너뛰고 "알림 발송" 으로 끝내지 않는다. 그러면 차단되지 않은 상태가
     *    초록불로 보고된다.
     */
    const pre = deps.vercel.preflight()
    if (!pre.ok) {
      step('층1 준비 (로그인·프로젝트·Production 배포)', { ok: false, detail: pre.why })
      step('층1 환경변수 MGRAPH_GRAPH_KILL=1', { ok: false, detail: '🔴 준비가 서지 않아 실행하지 않았다' })
      step('층1 재배포', { ok: false, detail: '🔴 준비가 서지 않아 실행하지 않았다' })
    } else {
      const { who, project, deployment } = pre.value
      step('층1 준비', {
        ok: true,
        detail: `${who} · ${project.projectName}(${project.projectId.slice(0, 12)}…) · ${deployment.id}`,
      })

      // 🔴 env 성공과 재배포 성공을 **각각** 본다. 하나라도 실패하면 자동 차단 성공이 아니다.
      const envStep = deps.vercel.setKillEnv({ project })
      step('층1 환경변수 MGRAPH_GRAPH_KILL=1', envStep)

      if (!envStep.ok) {
        // 🔴 값이 안 들어갔는데 재배포하면 **끄지 않은 채 다시 배포**하는 꼴이다
        step('층1 재배포', { ok: false, detail: '🔴 환경변수가 서지 않아 재배포하지 않았다' })
      } else {
        // 🔴 값만 바꾸면 현재 배포는 그대로다. 재배포까지가 한 조치다.
        step('층1 재배포 트리거', deps.vercel.redeploy({ project, deployment }))
      }
    }

    step('층2 control.ts 영구 차단', deps.writeControl(reason, deps.now()))

    if (!deps.lane.hasCredentials()) {
      step('층2 커밋·PR·자동 병합', { ok: false, detail: '🔴 git/gh credential 이 없다 — 영구 반영하지 못했다' })
    } else {
      step('층2 커밋·PR·자동 병합', deps.lane.commitAndMerge(reason))
    }
  }

  return {
    ok: findings.length === 0,
    checked,
    unreachable,
    findings,
    action,
    steps,
    automationFailed,
  }
}

/**
 * 층 2 — control.ts 에 영구 차단을 쓴다.
 *
 * 🔴 파일을 새로 만들지 않고 **세 값만** 바꾼다. graphVersion·surfaces 를 건드리면
 *    exporter 가 만든 사실과 감시가 쓴 판단이 한 파일에서 섞인다.
 * 🔴 창업자 승인 단계가 없다.
 */
export function writeTrippedControl(
  reason: string,
  at: Date,
  file = CONTROL_FILE,
): { changed: boolean; path: string } {
  const before = readFileSync(file, 'utf8')
  const after = before
    .replace(/(\n  enabled: )(?:true|false)(,)/, '$1false$2')
    .replace(/(\n  enabledClusters: )\[[^\]]*\](,)/, '$1[]$2')
    .replace(
      /(\n  killSwitch: )\{[^}]*\}(,)/,
      `$1{"tripped":true,"trippedAt":${JSON.stringify(at.toISOString())},"trippedBy":"magazine-graph-watch","reason":${JSON.stringify(reason)}}$2`,
    )
  if (after === before) return { changed: false, path: file }
  writeFileSync(file, after, 'utf8')
  return { changed: true, path: file }
}

const exec = (cmd: string, args: string[]): { code: number; out: string; err: string } => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 60_000 }), err: '' }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string; message?: string }
    return { code: x.status ?? 1, out: x.stdout ?? '', err: x.stderr ?? x.message ?? '' }
  }
}

/**
 * 🔴 **상태 코드를 본다.** 옛 판은 `curl -s -L` 의 종료 코드만 봤다 —
 *    404·500 은 curl 에게 성공이라 그 본문(오류 페이지)을 화면으로 읽었고,
 *    거기 링크가 없으니 **"관련 글 0건 · 이상 없음"** 으로 조용히 통과했다.
 */
const STATUS_MARK = '__HTTP_STATUS__'
export function parseCurlOutput(raw: string): { status: number | null; body: string } {
  const i = raw.lastIndexOf(STATUS_MARK)
  if (i === -1) return { status: null, body: raw }
  const status = Number(raw.slice(i + STATUS_MARK.length).trim())
  return { status: Number.isFinite(status) && status > 0 ? status : null, body: raw.slice(0, i) }
}

export const realDeps: GraphWatchDeps = {
  fetchPage: (url) => {
    const r = exec('curl', [
      '-sS', '-L', '--max-time', '25',
      // 🔴 본문과 상태 코드를 함께 받는다. -f 는 본문을 버려 진단을 잃는다.
      '-w', `\n${STATUS_MARK}%{http_code}`,
      url,
    ])
    if (r.code !== 0) return { ok: false, status: null, why: `curl 실패: ${r.err.trim().split('\n').pop() ?? r.code}` }
    const { status, body } = parseCurlOutput(r.out)
    if (status === null) return { ok: false, status: null, why: '상태 코드를 읽지 못했다' }
    if (status !== 200) return { ok: false, status, why: `HTTP ${status}` }
    return { ok: true, status, body }
  },
  now: () => new Date(),
  vercel: {
    /**
     * 🔴 **읽기만 한다.** 로그인·프로젝트·Production 배포를 확인할 뿐 아무것도 바꾸지 않는다.
     *    셋 중 하나라도 확정되지 않으면 실패를 돌려주고, 호출부가 실행을 멈춘다.
     */
    preflight: () => {
      const d = makeRealDeps()
      if (!d.ok) return d
      const who = checkAuth(d.value)
      if (!who.ok) return who
      const project = resolveProject(d.value)
      if (!project.ok) return project
      const deployment = resolveProdDeployment(d.value, project.value)
      if (!deployment.ok) return deployment
      return { ok: true, value: { who: who.value, project: project.value, deployment: deployment.value } }
    },
    setKillEnv: ({ project }) => {
      const d = makeRealDeps()
      if (!d.ok) return { ok: false, detail: d.why }
      const r = setKillEnv(d.value, project)
      return r.ok ? { ok: true, detail: r.value } : { ok: false, detail: r.why }
    },
    redeploy: ({ project, deployment }) => {
      const d = makeRealDeps()
      if (!d.ok) return { ok: false, detail: d.why }
      const r = redeployProduction(d.value, project, deployment)
      return r.ok ? { ok: true, detail: r.value } : { ok: false, detail: r.why }
    },
  },
  lane: {
    hasCredentials: () => exec('gh', ['auth', 'status']).code === 0,
    commitAndMerge: (reason) => {
      // 🔴 그래프 전용 레인을 그대로 부른다. 원고 레인을 건드리지 않는다.
      const r = exec('npx', [
        'tsx', join(ROOT, 'scripts/magazine-graph-merge.mts'),
        '--apply', '--reason', reason,
      ])
      return { ok: r.code === 0, detail: r.code === 0 ? '전용 레인으로 PR·자동 병합' : `실패: ${(r.err || r.out).trim().slice(0, 300)}` }
    },
  },
  writeControl: (reason, at) => {
    const w = writeTrippedControl(reason, at)
    return { ok: true, detail: w.changed ? `control.ts 갱신 (${w.path})` : '이미 차단 상태다' }
  },
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const notifySend = argv.includes('--notify-send')

  console.log(`\nM-GRAPH 연관 글 감시 ${apply ? '(🔴 차단을 실행한다)' : '(읽기만)'}\n`)
  const report = await runGraphWatch({ deps: realDeps, apply })

  console.log(`  확인 ${report.checked}편 · 읽지 못함 ${report.unreachable}편 · 관측 ${report.findings.length}건`)
  for (const f of report.findings) {
    console.log(`  ${f.code === 'UNPUBLISHED_LEAK' ? '🔴' : '  '} ${f.code} ${f.slug}${f.targetSlug ? ` → ${f.targetSlug}` : ''} — ${f.message}`)
  }

  if (report.action === 'TRIP_GLOBAL') {
    console.log(`\n🔴 전체 차단 필요`)
    if (!apply) {
      console.log('  --apply 를 주면 환경변수·재배포·control.ts·PR 까지 자동으로 간다')
      console.log('  지금은 아무것도 바꾸지 않았다')
    }
    for (const s of report.steps) console.log(`  ${s.ok ? '✅' : '🔴'} ${s.name} — ${s.detail}`)
    if (report.automationFailed) {
      console.log('\n  🔴 자동 차단이 끝까지 가지 못했다. 알림으로 갈음하지 않는다 — 실패로 끝낸다.')
    }
    console.log('\n  🔴 재배포가 끝나기 전 구간은 요청 단위 폴백(층 0)이 이미 메우고 있다 —')
    console.log('     공개 관문에 없는 글은 애초에 연관 글 후보가 되지 못한다.')
  }

  if (!report.ok) {
    try {
      const { buildMessage, send } = await import('./lib/slack-notify.mjs')
      const r = await send(
        buildMessage({
          severity: report.action === 'TRIP_GLOBAL' ? 'ERROR' : 'WARN',
          title:
            report.action === 'TRIP_GLOBAL'
              ? `🔴 매거진 연관 글 — 미공개 글이 링크에 떴다${report.automationFailed ? ' (자동 차단 실패)' : ' (자동 차단함)'}`
              : '매거진 연관 글 감시 — 확인하지 못한 항목이 있다',
          reason: report.findings.map((f) => `${f.code}: ${f.slug}${f.targetSlug ? `→${f.targetSlug}` : ''}`).join(' / '),
          next: `${SITE}/magazine`,
          logPath: null,
        }),
        { dryRun: !notifySend },
      )
      console.log(`\n  Slack: ${r.sent ? '발송' : `미발송 — ${r.reason}`}`)
    } catch (e) {
      // 🔴 알림 실패가 감시 판정을 바꾸지 않는다. 못 알린 사실만 적는다.
      console.log(`\n  Slack 실패 (${(e as Error)?.message ?? e}) — 판정은 그대로다`)
    }
  }

  const code = report.ok && !report.automationFailed ? 0 : 1
  console.log(`\n${code === 0 ? '✅' : '🔴'} 종료 (코드 ${code})`)
  console.log('🔴 등록된 글 총수를 이 감시의 성과로 읽지 않는다 — 본 것은 링크뿐이다.')
  console.log(`   (참고: articles.ts 등록 ${MAGAZINE_ARTICLES.length}편 · 지금 공개 ${getAllMagazineArticles().length}편)\n`)
  process.exit(code)
}

if (process.argv[1]?.endsWith('magazine-graph-watch.mts')) void main()
