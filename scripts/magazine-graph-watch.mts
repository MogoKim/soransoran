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
 * ── 🔴 "공개 글" 의 기준은 **지금 서빙 중인 배포의 원문**이다 (2026-11-26 사고) ──
 *   앞판은 감시가 도는 checkout 의 `articles.ts` 를 기준으로 삼았다. 그 checkout 이 배포보다
 *   뒤처지자(#900 미반영) 정상 공개된 새 글을 향한 링크 10개를 전부 누출로 읽었다.
 *   이제 도메인이 가리키는 Production 배포의 commit 을 읽고, **그 commit 의 `articles.ts`**
 *   (git object · 없으면 gh 로 같은 SHA 읽기 — checkout·내려받기 0)를 데이터로만 판독해
 *   제품과 같은 `isPublicMagazineArticle` 로 공개 목록을 만든다. 감시 대상도 그 목록 전부다.
 *   · 기준을 못 세우면(배포 조회 실패 · 원문 없음 · 깨진 행 · 모르는 status · 공개 0편)
 *     `CHECK_UNREACHABLE` 이다 — 차단도 쓰기도 0.
 *   · 누출로 보이면 조치 전에 **같은 배포인지 · 그 사이 공개 시각이 지났는지** 다시 읽는다.
 *     배포가 바뀌었거나 공개 시각이 지났으면 차단하지 않고 non-zero 로 다음 관측에 넘긴다.
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
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readServingProduction, resolveVercelContext } from './lib/magazine-deploy-evidence.mjs'
import { ARTICLES_PATH, parseArticleRecordText } from './lib/magazine-release.mjs'
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
import { isPublicMagazineArticle, resolvePublishAt } from '../src/lib/magazine'
import type { MagazineArticle } from '../src/content/magazine/types'

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

/** 지금 서빙 중인 Production 배포와, 그 commit 의 `articles.ts` 원문 */
export type DeployedSource = { deploymentId: string; sha: string; articlesText: string }

export type GraphWatchDeps = {
  fetchPage: (url: string) => PageFetch
  now: () => Date
  /** 🔴 **읽기만 한다.** 실패는 전부 `CHECK_UNREACHABLE` 로 끝난다 — 차단 근거가 되지 않는다 */
  readDeployed: () => Resolved<DeployedSource>
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
  /** 판정 기준이 된 배포. 기준을 세우지 못했으면 null */
  catalog: { deploymentId: string; sha: string; registered: number; public: number } | null
}

const STATUSES: ReadonlySet<unknown> = new Set(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'BLOCKED'])
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 배포된 `articles.ts` 원문 → 그 시각의 공개 slug. 원문을 **실행하지 않는다**(데이터 판독).
 *
 * 🔴 공개 판정은 제품의 `isPublicMagazineArticle` 그대로다 — DRAFT·BLOCKED·공개 시각 전은 빠진다.
 * 🔴 한 행이라도 판정할 수 없으면 전체가 실패다. 읽히는 행만으로 목록을 만들면
 *    못 읽은 공개 글을 향한 링크가 누출로 둔갑한다.
 */
export function deployedCatalog(
  articlesText: string,
  nowMs: number,
): Resolved<{ registered: number; publicSlugs: Set<string> }> {
  let rec: ReturnType<typeof parseArticleRecordText>
  // 판독기가 모르는 모양에서 던져도 감시는 "못 봤다" 로 끝낸다
  try { rec = parseArticleRecordText(articlesText) } catch { return { ok: false, why: '배포된 등록부를 읽지 못했다 (판독 예외)' } }
  if (!rec.ok) return { ok: false, why: `배포된 등록부를 읽지 못했다 (${rec.code})` }
  const publicSlugs = new Set<string>()
  const rows = Object.entries(rec.record as Record<string, unknown>)
  for (const [slug, raw] of rows) {
    const row = raw as Partial<MagazineArticle> | null
    if (
      row === null || typeof row !== 'object' || Array.isArray(row) || !SLUG.test(slug) ||
      (row.slug !== undefined && row.slug !== slug) || typeof row.publishedAt !== 'string' ||
      (row.publishAt !== undefined && typeof row.publishAt !== 'string') ||
      (row.status !== undefined && !STATUSES.has(row.status))
    ) return { ok: false, why: `배포된 등록부의 행을 판정할 수 없다 (${slug})` }
    const article = { ...row, slug } as MagazineArticle
    if (!Number.isFinite(resolvePublishAt(article))) return { ok: false, why: `배포된 등록부의 공개 시각을 읽지 못했다 (${slug})` }
    if (isPublicMagazineArticle(article, nowMs)) publicSlugs.add(slug)
  }
  if (publicSlugs.size === 0) return { ok: false, why: `배포된 등록부에 공개 글이 0편이다 (등록 ${rows.length}편)` }
  return { ok: true, value: { registered: rows.length, publicSlugs } }
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

/** 기준(배포 등록부) 자체를 못 읽었을 때 finding 이 가리키는 자리 — 글 slug 가 아니다 */
const CATALOG_SLUG = '(배포 등록부)'

export async function runGraphWatch({
  deps,
  site = SITE,
  apply = false,
}: {
  deps: GraphWatchDeps
  site?: string
  apply?: boolean
}): Promise<GraphWatchReport> {
  /** 🔴 기준이 없으면 화면을 보지도, 차단하지도 않는다 — 못 본 것으로 끝낸다 */
  const unseen = (why: string): GraphWatchReport => ({
    ok: false,
    checked: 0,
    unreachable: 0,
    findings: [{ code: 'CHECK_UNREACHABLE', message: `${why} — 못 본 것이지 샌 것이 아니다`, slug: CATALOG_SLUG }],
    action: 'NONE',
    steps: [],
    automationFailed: false,
    catalog: null,
  })
  const src = deps.readDeployed()
  if (!src.ok) return unseen(src.why)
  const deployed = src.value
  // 🔴 공개 판정 시각은 한 번만 정한다 — 글마다 다시 읽으면 10:30 을 사이에 두고 답이 갈린다
  const cat = deployedCatalog(deployed.articlesText, deps.now().getTime())
  if (!cat.ok) return unseen(cat.why)
  const { publicSlugs, registered } = cat.value

  const findings: GraphWatchFinding[] = []
  const steps: { name: string; ok: boolean; detail: string }[] = []
  let checked = 0
  let unreachable = 0

  for (const slug of publicSlugs) {
    const article = { slug }
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
  const hasLeak = () => findings.some((f) => f.code === 'UNPUBLISHED_LEAK')
  /** 누출 판정을 "못 봤다" 로 물린다 — 차단은 걸지 않되 non-zero 로 다음 관측에 넘긴다 */
  const defer = (why: string, when: (f: GraphWatchFinding) => boolean = () => true) => {
    for (const f of findings) {
      if (f.code === 'UNPUBLISHED_LEAK' && when(f)) Object.assign(f, { code: 'CHECK_UNREACHABLE', message: why })
    }
  }
  const SWITCHED = '관측 중 Production 배포가 바뀌었거나 다시 읽지 못했다 — 차단하지 않는다 · 다음 관측에서 다시 본다'

  /**
   * 🔴 누출로 보일 때만, 조치 전에 기준을 **다시 읽는다.**
   *    화면을 읽는 동안 배포가 바뀌면 옛 등록부로 새 화면을 재는 꼴이고,
   *    그 사이 공개 시각이 지난 글은 이미 정상 공개다. 둘 다 누출이 아니다.
   */
  if (hasLeak()) {
    const again = deps.readDeployed()
    const live =
      again.ok && again.value.deploymentId === deployed.deploymentId && again.value.sha === deployed.sha
        ? deployedCatalog(again.value.articlesText, deps.now().getTime())
        : null
    if (!live?.ok) defer(SWITCHED)
    else {
      defer(
        '관측 중 공개 시각이 지나 정상 공개된 글이다 — 차단하지 않는다 · 다음 관측에서 다시 본다',
        (f) => live.value.publicSlugs.has(f.targetSlug ?? ''),
      )
    }
  }

  /**
   * 🔴 쓰기 대상(preflight 가 고른 배포)이 관측한 배포와 다르면 **아무것도 쓰지 않는다** —
   *    env·재배포·control.ts·PR 전부 0. 보지 않은 배포를 끄는 것은 차단이 아니다.
   */
  const pre = hasLeak() && apply ? deps.vercel.preflight() : null
  if (pre?.ok && pre.value.deployment.id !== deployed.deploymentId) defer(SWITCHED)

  const leaked = findings.filter((f) => f.code === 'UNPUBLISHED_LEAK')
  const action: 'NONE' | 'TRIP_GLOBAL' = leaked.length > 0 ? 'TRIP_GLOBAL' : 'NONE'
  let automationFailed = false

  if (action === 'TRIP_GLOBAL' && pre) {
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
    catalog: { deploymentId: deployed.deploymentId, sha: deployed.sha, registered, public: publicSlugs.size },
  }
}

/** 🔴 실행하지 않은 차단을 "차단함" 으로 알리지 않는다 — 읽기 전용 회차는 그렇게 적는다 */
export function alertTitle(report: Pick<GraphWatchReport, 'action' | 'automationFailed'>, apply: boolean): string {
  if (report.action !== 'TRIP_GLOBAL') return '매거진 연관 글 감시 — 확인하지 못한 항목이 있다'
  const did = !apply ? '읽기 전용 — 차단하지 않았다' : report.automationFailed ? '자동 차단 실패' : '자동 차단함'
  return `🔴 매거진 연관 글 — 미공개 글이 링크에 떴다 (${did})`
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

/**
 * 🔴 `spawnSync` 다 — `vercel inspect` 는 성공해도 배포 id 를 **stderr** 로 낸다.
 *    성공 때 stdout 만 주는 실행기로는 그 id 를 영영 못 읽는다.
 * 🔴 `maxBuffer` 를 넉넉히 둔다 — `articles.ts` 원문이 기본 상한(1MB)을 넘으면 읽기 실패로 끝난다.
 */
const exec = (
  cmd: string,
  args: string[],
  { timeoutMs = 60_000, cwd }: { timeoutMs?: number; cwd?: string } = {},
): { code: number; out: string; err: string } => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, ...(cwd ? { cwd } : {}) })
  if (r.error) return { code: 1, out: r.stdout ?? '', err: r.error.message }
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
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
  /**
   * 🔴 **읽기만 한다.** 도메인 배포의 commit → 그 commit 의 등록부 원문.
   *    git object 가 여기 없으면(뒤처진 checkout) gh 로 **같은 SHA** 를 읽는다 —
   *    checkout·내려받기·host 변경 0. 실패 사유에 CLI 원문을 싣지 않는다(종료 코드만).
   */
  readDeployed: () => {
    const live = readServingProduction({ exec, context: resolveVercelContext() }) as
      | { ok: true; deploymentId: string; sha: string }
      | { ok: false; code: string; why: string }
    if (!live.ok) return { ok: false, why: `서빙 중인 Production 배포를 확정하지 못했다 (${live.code}: ${live.why})` }
    const local = exec('git', ['-C', ROOT, 'show', `${live.sha}:${ARTICLES_PATH}`])
    const raw = local.code === 0
      ? local
      : exec('gh', ['api', `repos/{owner}/{repo}/contents/${ARTICLES_PATH}?ref=${live.sha}`, '-H', 'Accept: application/vnd.github.raw'], { cwd: ROOT })
    if (raw.code !== 0 || raw.out.trim() === '') {
      return { ok: false, why: `배포 commit ${live.sha.slice(0, 7)} 의 등록부 원문을 읽지 못했다 (git 종료 ${local.code} · 마지막 종료 ${raw.code})` }
    }
    return { ok: true, value: { deploymentId: live.deploymentId, sha: live.sha, articlesText: raw.out } }
  },
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

  console.log(
    report.catalog
      ? `  기준: 배포 ${report.catalog.deploymentId} · commit ${report.catalog.sha.slice(0, 7)} · 등록 ${report.catalog.registered}편 · 공개 ${report.catalog.public}편`
      : '  🔴 기준(서빙 중인 배포의 등록부)을 세우지 못했다 — 화면을 판정하지 않았다',
  )
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
          title: alertTitle(report, apply),
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
  console.log('🔴 등록된 글 총수를 이 감시의 성과로 읽지 않는다 — 본 것은 링크뿐이다.\n')
  process.exit(code)
}

if (process.argv[1]?.endsWith('magazine-graph-watch.mts')) void main()
