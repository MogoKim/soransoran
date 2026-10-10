#!/usr/bin/env node
/**
 * 🔴 **매거진 M-AUTO rehearsal — 실제 엔트리포인트 전체를 격리된 임시 사본에서 같은 날 반복 실행한다** (2026-10-10).
 *
 *   npm run magazine:rehearsal                          시나리오 S1~S7 + S1 반복성
 *   node scripts/magazine-rehearsal.mjs --scenario S1,S4 고른 시나리오만
 *   node scripts/magazine-rehearsal.mjs --date 2026-10-11 --keep --out <report.json>
 *
 * 🔴 **왜 생겼나.** 자연 회차(하루 한 번)를 버그 발견에 쓰면 결함 하나에 하루가 간다.
 *    10/10 입력 수리 ENOTDIR 은 단위 검사 115/115 를 통과하고도 실제 producer wrapper 에서 매 회차 실패했다 —
 *    rehearsal 첫 실행이 그것을 잡았다. 자연 회차는 지속 운영 확인에만 쓴다.
 *
 * 🔴 **무엇이 진짜이고 무엇이 fixture 인가**
 *    진짜: producer-run · auto-register-run · auto-merge(--apply/--recover/--watch) 와 그 아래 전부
 *          (brief 정책 · 입력 수리 · 원고 관문 · QA · 변환 · hero 재사용 · 등록 · 잠금 · journal · PR/병합/배포/공개 판정 · 장부)
 *    fixture: Claude CLI · ChatGPT 브라우저 · gh/GitHub · git remote · curl/Vercel · Slack · 시계
 *    경계: 임시 루트 밖 쓰기 · TCP · DNS · fetch · 허용 목록 밖 명령은 guard 가 막고 **기록한다** (래퍼가 예외를 삼켜도 FAIL)
 *
 * 🔴 운영 runtime 은 읽어서 복사만 한다. 운영 HOME·장부·Chrome·GitHub·Vercel·Slack 접근 0.
 * 🔴 이 결과는 OPERATING_PASS 가 아니다 — 코드 경로가 끝까지 이어진다는 증거일 뿐이다.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSandbox, readGuard, stageEnv } from './lib/magazine-rehearsal-sandbox.mjs'
import { pathToFileURL } from 'node:url'
import net from 'node:net'
import { KST, SPEED, addDays, collect, curate, leftovers, pickTargets, placeHero, runStage, templatePair, writeSlugFiles } from './lib/magazine-rehearsal-scenarios.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(HERE, '..')
export const DEFAULT_RUNTIME = '/Users/yanadoo/Documents/soransoran-magazine-runtime'
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

// ─────────────────────────────────────────────────────────
// 운영 불변 증거 — runtime 자료의 해시 (읽기만)
// ─────────────────────────────────────────────────────────
export function runtimeFingerprint(runtime) {
  const h = createHash('sha256')
  const files = []
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n)
      const st = statSync(f, { throwIfNoEntry: false })
      if (!st) continue
      if (st.isDirectory()) walk(f)
      else { files.push(relative(runtime, f)); h.update(relative(runtime, f)); h.update(readFileSync(f)) }
    }
  }
  for (const rel of ['drafts/magazine', 'src/content/magazine/articles.ts', 'public/magazine']) {
    const p = join(runtime, rel)
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) walk(p)
    else { files.push(rel); h.update(rel); h.update(readFileSync(p)) }
  }
  const head = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: runtime, encoding: 'utf8' }).stdout.trim()
  const status = spawnSync('/usr/bin/git', ['status', '--porcelain'], { cwd: runtime, encoding: 'utf8' }).stdout
  h.update(head); h.update(status)
  return { sha256: h.digest('hex'), files: files.length, head }
}

// ─────────────────────────────────────────────────────────
// 시나리오
// ─────────────────────────────────────────────────────────

const exp = (id, ok, detail = '') => ({ id, ok: Boolean(ok), detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }
const runFile = (sb, date, re) => { const d = join(sb.repo, 'drafts', 'magazine', '_runs', date); return existsSync(d) ? readdirSync(d).filter((n) => re.test(n)).sort().map((n) => join(d, n)) : [] }

/** 공통 — 모든 시나리오의 경계·잔여물 단언 */
function boundaryChecks(ev) {
  const b = ev.boundary
  return [
    exp('경계 — 임시 루트 밖 쓰기·TCP·DNS·fetch·CDP·허용 밖 명령 위반 0', b.violations.length === 0, b.violations.slice(0, 5)),
    exp('경계 — 네트워크 시도 0 (Slack 은 fixture 가 받았다)', b.networkAttempts === 0, `${b.networkAttempts}`),
    exp('경계 — 허용 목록 밖 외부 명령 0', b.spawnsRefused === 0, `${b.spawnsRefused}`),
    exp('경계 — fixture 가 모르는 명령·API·jq 0 (관대하게 흉내 내지 않는다)', b.fixtureRefusals.length === 0, b.fixtureRefusals.slice(0, 5)),
    exp('경계 — 모든 node 자식이 guard 아래에서 돌았다', b.guardedProcesses > 0, `${b.guardedProcesses}`),
    exp('잔여 — lock·lease·journal·reclaim·packet·임시 쓰기 0', ev.leftovers.length === 0, ev.leftovers.slice(0, 8)),
  ]
}

const stageOk = (stages, name, want = 0) => { const s = stages.find((x) => x.name === name); return Boolean(s) && s.exit === want }

/** 정상 하루 — producer → register(+apply) → recover → watch */
async function normalDay(ctx) {
  const { sb, date, stages } = ctx
  stages.push(runStage(sb, { name: 'producer', entry: 'producer', kst: KST(date, '00:10') }))
  stages.push(runStage(sb, { name: 'register', entry: 'register', kst: KST(date, '01:00') }))
  // 🔴 결과 파일은 날짜별 한 칸이다 — 재실행이 덮기 전에 이 단계의 결과를 붙잡는다
  ctx.applyResult = readJson(runFile(sb, date, /^auto-merge\.json$/)[0] ?? '')
  ctx.registerResult = readJson(runFile(sb, date, /^auto-register\.json$/)[0] ?? '')
  stages.push(runStage(sb, { name: 'recover', entry: 'recover', kst: KST(date, '02:00') }))
  ctx.recoveryFiles = runFile(sb, date, /^auto-merge-recovery-/).map((f) => readJson(f))
}

const imp = (repo, rel) => import(pathToFileURL(join(repo, rel)).href)
const ledgerPath = (sb) => join(sb.root, 'home', 'Library', 'Application Support', 'soransoran', 'magazine-quarantine.json')
const logOf = (ctx, name) => { const s = ctx.stages.find((x) => x.name === name); return s ? readFileSync(join(ctx.sb.root, s.log), 'utf8') : '' }
const kstDateOf = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10)

/** 사이트 fixture 를 고정 시각에 직접 본다 — 실제 공개 관문(magazine-gate) 이 판정한다 */
function siteProbe(ctx, { kst, paths }) {
  const env = stageEnv({ root: ctx.sb.root, clock: { fakeMs: Date.parse(`${kst.replace(' ', 'T')}+09:00`), realMs: Date.now(), speed: SPEED } })
  const out = {}
  for (const p of paths) {
    const code = spawnSync(join(ctx.sb.root, 'bin', 'curl'), ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', `https://soransoran.com${p}`], { env, encoding: 'utf8' }).stdout.trim()
    const body = spawnSync(join(ctx.sb.root, 'bin', 'curl'), ['-s', '-L', '--max-time', '25', `https://soransoran.com${p}`], { env, encoding: 'utf8' }).stdout
    out[p] = { status: Number(code), body }
  }
  return out
}

/**
 * 운영 모드 차단 — 시험 모드 표식 없이 fixture 설정만 보이는 hero runner 는 큐·파일·Chrome 전에 멈춰야 한다.
 *    (guard 는 그대로 — 차단이 빠지면 실제 Chrome 경로로 가서 위반이 기록된다)
 */
function heroProdBlock(ctx) {
  const env = { ...stageEnv({ root: ctx.sb.root, clock: { fakeMs: Date.parse(`${ctx.date}T04:00:00+09:00`), realMs: Date.now(), speed: SPEED } }) }
  delete env.SORAN_MAGAZINE_TEST_MODE
  const r = spawnSync(process.execPath, [join(ctx.sb.repo, 'scripts', 'magazine-hero-runner.mjs'), '--slug', ctx.prepared.target, '--alt', '창가에서 차를 마시는 50대 한국 여성', '--write', '--allow-optional'],
    { cwd: ctx.sb.repo, env, encoding: 'utf8' })
  const calls = readFileSync(join(ctx.sb.root, 'fixture', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { exit: r.status, stderr: String(r.stderr).slice(0, 300), generateAfter: calls.filter((c) => c.op === 'hero-image').length }
}

/** S4·S5·S6·S7 공통 준비 — 의료 필수가 아닌 자동 레인 대상 1건 · 검증된 hero 재사용 (그 시나리오의 주제를 격리) */
async function oneTarget(repo, date) {
  const [t] = await pickTargets({ repo, date, selectable: 1 })
  await curate({ repo, keep: [t.slug] })
  placeHero({ repo, slug: t.slug })
  return { target: t.slug }
}

export const SCENARIOS = {
  S1: {
    title: '정상 전체 완주 — 대상 1건 · 최초 전송 1 · QA · hero 신규 생성(sharp 변환) · 등록 · PR 1 · exact head 병합 · 배포 · 예약 404 → 공개 200 · watch',
    // 🔴 hero 를 미리 두지 않는다 — 실제 hero runner 가 신규 생성 경로(생성 fixture 1 · sharp 변환 · 검증 · 주입)를 돈다
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      return { target: t.slug }
    },
    scenario: { ci: {}, deploy: {} },
    async run(ctx) {
      await normalDay(ctx)
      const reg = ctx.ev0 = await collect(ctx.sb, { date: ctx.date })
      const pub = reg.registered[0]?.publishAt ?? null
      ctx.publishDate = pub ? new Date(Date.parse(pub) + 9 * 3600 * 1000).toISOString().slice(0, 10) : addDays(ctx.date, 3)
      ctx.sb.extraDates = [ctx.publishDate]
      ctx.stages.push(runStage(ctx.sb, { name: 'watch-after-publish', entry: 'watch', kst: KST(ctx.publishDate, '11:00') }))
      // 🔴 성공 뒤 재실행 — 중복 전송·PR·등록 0
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-producer', entry: 'producer', kst: KST(ctx.date, '03:00') }))
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-register', entry: 'register', kst: KST(ctx.date, '03:30') }))
      ctx.heroProdBlock = heroProdBlock(ctx)
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const s = ctx.stages
      const merge = ctx.applyResult
      const watchLog = readFileSync(join(ctx.sb.root, s.find((x) => x.name === 'watch-after-publish')?.log ?? 'missing'), 'utf8').toString()
      return [
        exp('S1 producer · register · recover · watch 종료 0', ['producer', 'register', 'recover', 'watch-after-publish'].every((n) => stageOk(s, n)), s.map((x) => `${x.name}:${x.exit}`)),
        exp('S1 대상 1건 정확히 한 번 brief 생성 (Claude fixture 1회)', ev.claude.length === 1 && ev.claude[0].slug === t, ev.claude),
        exp('S1 ChatGPT 최초 전송 1회 · 재생성·수리 0', ev.sends.initial === 1 && ev.sends.bySlug[`${t}:initial`] === 1 && ev.sends.regen === 0 && ev.sends.repair === 0, ev.sends),
        exp('S1 등록 1건 = 대상 · 미래 publishAt · hero 연결', ev.registered.length === 1 && ev.registered[0].slug === t && Date.parse(ev.registered[0].publishAt) > Date.parse(`${ctx.date}T01:00:00+09:00`) && Boolean(ev.registered[0].heroSrc), ev.registered),
        exp('S1 PR 1개 · MERGED', ev.prs.length === 1 && ev.prs[0].state === 'MERGED', ev.prs),
        exp('S1 merge 호출 1회 · --match-head-commit', ev.mergeCalls.length === 1 && ev.mergeCalls[0].args.includes('--match-head-commit') && Boolean(ev.mergeCalls[0].merged), ev.mergeCalls),
        exp('S1 Production fixture 배포 1 · merge SHA', ev.deployments.length === 1 && ev.deployments[0].sha === ev.prs[0]?.merge && ev.deployments[0].state === 'success', ev.deployments),
        exp('S1 병합 직후 예약 글은 404 (실제 judgeDeploy)', (merge?.deploy?.checked ?? []).some((c) => String(c).includes(t) && String(c).includes('404')) && merge?.deploy?.state === 'success', merge?.deploy ?? merge),
        exp('S1 publishAt 뒤 watch — 대상 본문·이미지·목록 확인', watchLog.includes(t) && /✅/.test(watchLog) && !/⛔/.test(watchLog), watchLog.split('\n').filter((l) => l.includes(t)).slice(0, 3)),
        exp('S1 hero 신규 생성 — 생성 경로 1 · 이미지 fixture 1 · 변환 1 · 재사용 0', ev.hero.generate === 1 && ev.hero.image === 1 && ev.hero.convert === 1 && ev.hero.reuse === 0, ev.hero),
        exp('S1 hero.webp 가 병합 tree 에 있다 — RIFF/WEBP', ev.registered[0]?.heroFile?.riff === 'RIFF' && ev.registered[0]?.heroFile?.webp === 'WEBP', ev.registered[0]?.heroFile),
        exp('S1 heroImage 4필드 — src · alt(…여성) · 1200 · 675', ev.registered[0]?.heroImage?.src === `/magazine/${t}/hero.webp` && /여성$/.test(ev.registered[0]?.heroImage?.alt ?? '') && ev.registered[0]?.heroImage?.width === 1200 && ev.registered[0]?.heroImage?.height === 675, ev.registered[0]?.heroImage),
        exp('S1 운영 모드 + fixture 설정 → hero runner 종료 2 · TEST_INJECTION_BLOCKED · 추가 생성 0', ctx.heroProdBlock?.exit === 2 && /TEST_INJECTION_BLOCKED/.test(ctx.heroProdBlock?.stderr ?? '') && ctx.heroProdBlock?.generateAfter === ev.hero.image, ctx.heroProdBlock),
        exp('S1 성공 뒤 재실행 — 추가 전송·PR·등록·merge·이미지 생성 0', ev.hero.image === 1 && ev.hero.generate === 1 && stageOk(s, 'rerun-producer') && ev.sends.initial === 1 && ev.prs.length === 1 && ev.registered.length === 1 && ev.mergeCalls.length === 1, s.filter((x) => x.name.startsWith('rerun')).map((x) => `${x.name}:${x.exit}`)),
      ]
    },
  },

  S2: {
    title: '입력 수리 실제 경로 — runtime 모양 원고 폴더 · gray(형식 불완전) · cold/autumn(brief echo) · 수리 실패 1건이 PARTIAL·알림·handoff 로 일치',
    async prepare(repo, date) {
      const [d, a, b, c] = await pickTargets({ repo, date, selectable: 1, others: 3 })
      await curate({ repo, keep: [a.slug, b.slug, c.slug, d.slug] })
      const pa = await templatePair({ repo, item: a, broken: true })
      writeSlugFiles({ repo, slug: a.slug, files: { 'brief.md': pa.brief, 'review.ts': pa.review } })
      for (const it of [b, c]) {
        const pr = await templatePair({ repo, item: it })
        writeSlugFiles({ repo, slug: it.slug, files: { 'brief.md': pr.brief, 'review.ts': pr.review, 'draft.md': pr.brief } })
      }
      // runtime 과 같은 모양: topic-queue.ts(일반 파일) · _runs · _template 은 이미 있다 + 숨김 일반 파일
      writeFileSync(join(repo, 'drafts', 'magazine', '.DS_Store'), 'rehearsal\n')
      return { gray: a.slug, cold: b.slug, autumn: c.slug, normal: d.slug }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.autumn}:repair`]: ['brief-echo'] } }),
    async afterBuild(sb, p, date) {
      // 🔴 급사 journal — 앞 회차의 brief 교체가 실제 SIGKILL 로 중간에 죽은 상태 (guard 아래 자식)
      const lib = pathToFileURL(join(sb.repo, 'scripts', 'lib', 'magazine-input-repair.mjs')).href
      const child = join(sb.root, 'tmp', 'kill-journal.mjs')
      writeFileSync(child, `const IR = await import(${JSON.stringify(lib)})
IR.commitFiles({ draftsDir: ${JSON.stringify(join(sb.repo, 'drafts', 'magazine'))}, slug: ${JSON.stringify(p.gray)}, kind: 'BRIEF',
  files: { brief: 'HALF-WRITTEN BRIEF\\n', review: 'HALF-WRITTEN REVIEW\\n' },
  phaseHook: (ph) => { if (ph === 'committing-1') process.kill(process.pid, 'SIGKILL') } })
`)
      const env = stageEnv({ root: sb.root, clock: { fakeMs: Date.parse(`${addDays(date, -1)}T23:50:00+09:00`), realMs: Date.now(), speed: SPEED } })
      const k = spawnSync(process.execPath, [child], { env, encoding: 'utf8' })
      const journal = join(sb.repo, 'drafts', 'magazine', p.gray, '.input-repair-journal.json')
      return { journalKilled: k.signal === 'SIGKILL' && existsSync(journal), grayBriefHalf: readFileSync(join(sb.repo, 'drafts', 'magazine', p.gray, 'brief.md'), 'utf8').startsWith('HALF-WRITTEN') }
    },
    async run(ctx) {
      ctx.stages.push(runStage(ctx.sb, { name: 'producer', entry: 'producer', kst: KST(ctx.date, '00:10') }))
      ctx.handoff = readJson(join(ctx.sb.repo, 'drafts', 'magazine', '_runs', ctx.date, 'producer-handoff.json'))
      ctx.repairResult = readJson(ctx.handoff?.repair?.resultFile ?? '')
    },
    expect(ev, ctx) {
      const p = ctx.prepared
      const log = logOf(ctx, 'producer')
      const out = Object.fromEntries((ctx.repairResult?.results ?? []).map((r) => [r.slug, r.outcome]))
      const led = ev.ledger ?? {}
      const fails = ctx.handoff?.repair?.failures ?? []
      const slack = ev.slack.find((m) => m.text.includes('입력 수리 미해결'))
      return [
        exp('S2 runtime 모양 — topic-queue.ts · .DS_Store 일반 파일 · _runs · _template 이 있었다', existsSync(join(ctx.sb.repo, 'drafts', 'magazine', '.DS_Store')) && existsSync(join(ctx.sb.repo, 'drafts', 'magazine', '_template'))),
        exp('S2 급사 journal(실제 SIGKILL)을 producer wrapper 가 먼저 복구했다', p.journalKilled && p.grayBriefHalf && (ctx.repairResult?.recovered ?? []).some((r) => r.slug === p.gray && r.recovered === true && r.rolledBack === true) && !existsSync(join(ctx.sb.repo, 'drafts', 'magazine', p.gray, '.input-repair-journal.json')),
          { killed: p.journalKilled, half: p.grayBriefHalf, recovered: ctx.repairResult?.recovered }),
        exp('S2 REPAIR_STAGE_FAILED · ENOTDIR 0', !/REPAIR_STAGE_FAILED|ENOTDIR/.test(log), log.split('\n').filter((l) => /REPAIR_STAGE|ENOTDIR/.test(l)).slice(0, 2)),
        exp('S2 gray(BRIEF) APPLIED · cold(DRAFT_ECHO) APPLIED · autumn FAILED(수리 응답도 brief echo — 전송 관문 invalid_manuscript) — 세 대상 판정 도달',
          out[p.gray] === 'APPLIED' && out[p.cold] === 'APPLIED' && out[p.autumn] === 'FAILED' && /invalid_manuscript/.test((ctx.repairResult?.results ?? []).find((r) => r.slug === p.autumn)?.reason ?? ''), ctx.repairResult?.results?.map((r) => `${r.slug}:${r.outcome}:${String(r.reason).slice(0, 40)}`)),
        exp('S2 provider 실행권 — gray Claude 호출 1~2회(정책 상한) · 실행권 기록 1', ev.claude.filter((c) => c.slug === p.gray).length >= 1 && ev.claude.filter((c) => c.slug === p.gray).length <= 2 && (led[p.gray]?.briefRepairs ?? []).length === 1, { claude: ev.claude, briefRepairs: led[p.gray]?.briefRepairs }),
        exp('S2 수리 전송 — cold·autumn 각 1회 (같은 지문 최대 1) · attempts·regenCalls 불변', ev.sends.bySlug[`${p.cold}:repair`] === 1 && ev.sends.bySlug[`${p.autumn}:repair`] === 1 && led[p.cold]?.inputRepairCalls === 1 && led[p.autumn]?.inputRepairCalls === 1 && !led[p.autumn]?.regenCalls && !(led[p.autumn]?.attempts > 0), ev.sends.bySlug),
        exp('S2 수리 실패가 있어도 다른 회수 후보(normal)는 최초 전송까지 간다', ev.sends.bySlug[`${p.normal}:initial`] === 1, ev.sends.bySlug),
        exp('S2 producer 종료 3 · handoff PARTIAL · 실패 = autumn FAILED 하나', stageOk(ctx.stages, 'producer', 3) && ctx.handoff?.verdict === 'PARTIAL' && ctx.handoff?.code === 3 && fails.length === 1 && fails[0].slug === p.autumn && fails[0].outcome === 'FAILED', { exit: ctx.stages[0]?.exit, handoff: ctx.handoff }),
        exp('S2 구조화 알림 1건 — slug · 결과 코드 · 결과 파일 (handoff 와 같은 파일)', ev.slack.filter((m) => m.text.includes('입력 수리 미해결')).length === 1 && slack.text.includes(p.autumn) && slack.text.includes('FAILED') && slack.text.includes(String(ctx.handoff?.repair?.resultFile ?? '@@')), slack?.text),
      ]
    },
  },

  S3: {
    title: '실패 격리·중복 방지 — 전송불명 HOLD 1건 · 정상 1건 · 같은 날 재실행 · 장부 손상 fail-closed',
    async prepare(repo, date) {
      const [n, h] = await pickTargets({ repo, date, selectable: 1, others: 1 })
      await curate({ repo, keep: [h.slug, n.slug] })
      const ph = await templatePair({ repo, item: h })
      writeSlugFiles({ repo, slug: h.slug, files: { 'brief.md': ph.brief, 'review.ts': ph.review } })
      placeHero({ repo, slug: n.slug })
      return { hold: h.slug, normal: n.slug }
    },
    async afterBuild(sb, p) {
      // 🔴 HOLD 는 실제 정본으로 만든다 — 실제 전송 문장의 지문 + recordDelivery(전송불명)
      const DG = await imp(sb.repo, 'scripts/lib/magazine-delivery-gate.mjs')
      const Q = await imp(sb.repo, 'scripts/lib/magazine-quarantine.mjs')
      const fp = Q.deliveryFingerprintOf(DG.plannedMessageFor(p.hold, join(sb.repo, 'drafts', 'magazine')))
      const entry = Q.recordDelivery(null, { sent: null, messageFingerprint: fp, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', now: Date.parse('2026-09-28T00:00:00Z'), date: '2026-09-28', reservationId: 'rehearsal-hold' })
      mkdirSync(dirname(ledgerPath(sb)), { recursive: true })
      Q.saveQuarantine({ [p.hold]: entry }, ledgerPath(sb))
      return { holdFingerprint: fp }
    },
    async run(ctx) {
      const before = readFileSync(ledgerPath(ctx.sb), 'utf8')
      ctx.holdEntryBefore = JSON.stringify(JSON.parse(before)[ctx.prepared.hold])
      await normalDay(ctx)
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-producer', entry: 'producer', kst: KST(ctx.date, '04:00') }))
      ctx.holdEntryAfter = JSON.stringify(readJson(ledgerPath(ctx.sb))?.[ctx.prepared.hold])
      ctx.sendsBeforeCorrupt = (await collect(ctx.sb, { date: ctx.date })).sends
      // 🔴 장부 손상 — 다음 날 producer 는 HOLD 를 모른다고 다시 보내면 안 된다
      writeFileSync(ledgerPath(ctx.sb), '{ broken json')
      const next = addDays(ctx.date, 1)
      ctx.sb.extraDates = [next]
      ctx.stages.push(runStage(ctx.sb, { name: 'producer-ledger-broken', entry: 'producer', kst: KST(next, '00:10') }))
    },
    expect(ev, ctx) {
      const p = ctx.prepared
      const reg = ctx.registerResult ?? {}
      const brokenLog = logOf(ctx, 'producer-ledger-broken')
      return [
        exp('S3 HOLD 글 — runner 0 · 전송 0 (세 번의 producer 전부)', !Object.keys(ev.sends.bySlug).some((k) => k.startsWith(`${p.hold}:`)), ev.sends.bySlug),
        exp('S3 HOLD 장부 행 바이트 불변 (손상 전까지)', ctx.holdEntryBefore === ctx.holdEntryAfter, { before: ctx.holdEntryBefore, after: ctx.holdEntryAfter }),
        exp('S3 HOLD 는 등록 자리를 쓰지 않는다 — held 에 있고 attempted 는 정상 글 1건뿐 · DONE 아님',
          (reg.held ?? []).some((r) => r.slug === p.hold) && reg.attempted === 1 && !(reg.done ?? []).some((r) => r.slug === p.hold) && (reg.done ?? []).some((r) => r.slug === p.normal),
          { held: (reg.held ?? []).map((r) => r.slug), attempted: reg.attempted, done: (reg.done ?? []).map((r) => r.slug) }),
        exp('S3 정상 글은 계속 완주 — 전송 1 · 등록 · PR MERGED', ev.sends.bySlug[`${p.normal}:initial`] === 1 && ev.registered.some((a) => a.slug === p.normal) && ev.prs.length === 1 && ev.prs[0].state === 'MERGED', { sends: ev.sends.bySlug, prs: ev.prs }),
        exp('S3 같은 날 재실행 — 추가 전송 0', JSON.stringify(ctx.sendsBeforeCorrupt) === JSON.stringify(ev.sends), { before: ctx.sendsBeforeCorrupt, after: ev.sends }),
        exp('S3 장부 손상 — 전송 0 · fail-closed 기록', JSON.stringify(ctx.sendsBeforeCorrupt) === JSON.stringify(ev.sends) && /QUARANTINE_UNREADABLE|장부를 읽지 못했다|장부/.test(brokenLog), brokenLog.split('\n').filter((l) => /장부|QUARANTINE/.test(l)).slice(0, 3)),
      ]
    },
  },

  S4: {
    title: '느린 CI 와 02:00 복구 — 01:00 관찰 시간 초과 · 같은 exact head 의 필수 CI 성공 뒤 --recover 가 기존 관문으로 병합',
    prepare: oneTarget,
    scenarioFor: (p, date) => ({ ci: { pendingUntil: `${date}T01:45:00+09:00` }, deploy: {} }),
    async run(ctx) { await normalDay(ctx) },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const ok = ev.mergeCalls.filter((m) => m.merged)
      const rec = ctx.recoveryFiles ?? []
      return [
        exp('S4 01:00 병합 관찰은 CI 를 기다리다 병합하지 않았다 (관찰 시간 초과)', !ctx.applyResult?.merged && /TIMEOUT|CI/.test(JSON.stringify(ctx.applyResult ?? {})), ctx.applyResult?.blockedBy ?? ctx.applyResult),
        exp('S4 02:00 --recover 가 병합 · 종료 0', stageOk(ctx.stages, 'recover') && ok.length === 1 && ev.prs[0]?.state === 'MERGED', { recover: ctx.stages.find((s) => s.name === 'recover')?.exit, merges: ev.mergeCalls }),
        exp('S4 merge 호출 1회 · --match-head-commit · PR 1', ev.mergeCalls.length === 1 && ev.mergeCalls[0].args.includes('--match-head-commit') && ev.prs.length === 1, ev.mergeCalls),
        exp('S4 재전송·재생성·재등록 0', ev.sends.initial === 1 && ev.sends.regen === 0 && ev.registered.length === 1 && ev.registered[0].slug === t, { sends: ev.sends, registered: ev.registered }),
        exp('S4 복구 결과는 최초 결과와 다른 파일', rec.length === 1 && Boolean(ctx.applyResult) && rec[0]?.mode !== ctx.applyResult?.mode, { files: ev.runFiles[ctx.date]?.filter((f) => /merge/.test(f)) }),
        exp('S4 Production 배포 1 · merge SHA', ev.deployments.length === 1 && ev.deployments[0].sha === ev.prs[0]?.merge, ev.deployments),
      ]
    },
  },

  S5: {
    title: '명시적 실패 안전 정지 — 필수 CI 실패 → merge 0 · 배포 0 · non-zero · 정확한 이유 · 인프라 실패는 원고 실패에 넣지 않음',
    prepare: oneTarget,
    scenarioFor: () => ({ ci: { conclusion: 'failure' }, deploy: {} }),
    async run(ctx) { await normalDay(ctx) },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const reg = ctx.stages.find((s) => s.name === 'register')
      const why = JSON.stringify(ctx.applyResult ?? {})
      const led = ev.ledger?.[t] ?? null
      return [
        exp('S5 merge 0 · Production 배포 0', ev.mergeCalls.length === 0 && ev.deployments.length === 0, { merges: ev.mergeCalls, deployments: ev.deployments }),
        exp('S5 01:00 회차 종료 코드 non-zero', reg && reg.exit !== 0, reg?.exit),
        exp('S5 BLOCKED 와 정확한 이유 (CI 실패) 기록', /CI_FAILED|CI_NOT_GREEN|failure|FAILED/.test(why), ctx.applyResult?.blockedBy ?? why.slice(0, 300)),
        exp('S5 02:00 복구도 우회 병합하지 않는다', ev.prs.length === 1 && ev.prs[0].state === 'OPEN' && ev.mergeCalls.length === 0, ev.prs),
        exp('S5 원고 실패 횟수(CONTENT attempts)에 인프라 실패를 넣지 않는다', !led || !(led.attempts > 0), led),
        exp('S5 원고는 한 번만 보냈다 (재실행·재생성 0)', ev.sends.initial === 1 && ev.sends.regen === 0, ev.sends),
      ]
    },
  },

  S6: {
    title: '예약 공개와 watch — 공개 전 목록·상세·sitemap 누출 0 · publishAt 전 404 · 뒤 200 · watch 는 공개된 글만',
    prepare: oneTarget,
    scenario: { ci: {}, deploy: {} },
    async run(ctx) {
      await normalDay(ctx)
      const ev0 = await collect(ctx.sb, { date: ctx.date })
      const pub = ev0.registered[0]?.publishAt
      ctx.publishAt = pub ?? null
      if (!pub) return
      const pubDate = kstDateOf(pub)
      ctx.sb.extraDates = [pubDate]
      const t = ctx.prepared.target
      const paths = [`/magazine/${t}`, '/magazine', '/sitemap.xml', `/magazine/${t}/hero.webp`]
      const ms = Date.parse(pub)
      const iso = (x) => new Date(x + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)
      ctx.before = siteProbe(ctx, { kst: `${iso(ms - 60 * 1000)}`, paths })
      ctx.stages.push(runStage(ctx.sb, { name: 'watch-before-publish', entry: 'watch', kst: KST(ctx.date, '11:00') }))
      ctx.after = siteProbe(ctx, { kst: `${iso(ms + 60 * 1000)}`, paths })
      ctx.stages.push(runStage(ctx.sb, { name: 'watch-after-publish', entry: 'watch', kst: KST(pubDate, '11:00') }))
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const b = ctx.before ?? {}
      const a = ctx.after ?? {}
      const wb = logOf(ctx, 'watch-before-publish')
      const wa = logOf(ctx, 'watch-after-publish')
      return [
        exp('S6 미래 publishAt 으로 등록됐다', Boolean(ctx.publishAt) && Date.parse(ctx.publishAt) > Date.parse(`${ctx.date}T02:00:00+09:00`), ctx.publishAt),
        exp('S6 publishAt 1분 전 — 상세 404 · 목록·sitemap 누출 0', b[`/magazine/${t}`]?.status === 404 && !b['/magazine']?.body.includes(t) && !b['/sitemap.xml']?.body.includes(t), { detail: b[`/magazine/${t}`]?.status }),
        exp('S6 publishAt 1분 뒤 — 상세 200 · 목록·sitemap 노출 · hero 200', a[`/magazine/${t}`]?.status === 200 && a['/magazine']?.body.includes(t) && a['/sitemap.xml']?.body.includes(t) && a[`/magazine/${t}/hero.webp`]?.status === 200, { detail: a[`/magazine/${t}`]?.status, hero: a[`/magazine/${t}/hero.webp`]?.status }),
        exp('S6 공개 전 watch 는 이 글을 보지 않는다 (공개된 글만 확인)', stageOk(ctx.stages, 'watch-before-publish') && !wb.includes(t), wb.split('\n').filter((l) => /✅|⛔/.test(l)).slice(0, 4)),
        exp('S6 공개 뒤 watch — 이 글 본문·이미지·목록 확인 · 종료 0', stageOk(ctx.stages, 'watch-after-publish') && wa.split('\n').some((l) => l.includes(t) && l.includes('✅')), wa.split('\n').filter((l) => l.includes(t)).slice(0, 2)),
        exp('S6 예약 공개 확인을 공급 성공·OPERATING_PASS 로 적지 않는다', !/OPERATING_PASS|완전 자동화/.test(wa + wb), ''),
      ]
    },
  },

  S7: {
    title: 'QA 실패 → 재생성 — 첫 원고는 형식 관문 통과 · 실제 QA 결정적 실패 → 실제 실패 패킷으로 재생성 → QA 통과 · 등록·PR·병합·배포',
    // 🔴 QA 재생성만 격리한다 — 검증된 hero 재사용을 허용한다 (hero 신규 생성은 S1 이 본다)
    prepare: oneTarget,
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:initial`]: ['qa-fail'] } }),
    async run(ctx) { await normalDay(ctx) },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const reg = logOf(ctx, 'register')
      const typed = ev.regenTyped.find((r) => r.slug === t)?.typed ?? ''
      const led = ev.ledger?.[t] ?? null
      const QA_REASON = '진료 권고 문장'
      return [
        exp('S7 최초 전송 1 · 재생성 1 · 최초 요청 재전송 0', ev.sends.bySlug[`${t}:initial`] === 1 && ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 1 && ev.sends.regen === 1, ev.sends.bySlug),
        exp('S7 첫 원고는 형식 관문을 지나 실제 QA 에서 막혔다 (medical 진료 권고 없음)', /QA FAIL|qa/.test(reg) && reg.includes('재생성 1/2'), reg.split('\n').filter((l) => /qa|QA/.test(l)).slice(0, 4)),
        exp('S7 실패 패킷(보낸 재생성 요청)에 최초 QA 실패 사유가 실려 있다', typed.includes('[QA_FAIL]') && typed.includes(QA_REASON), typed.split('\n').filter((l) => /QA_FAIL|진료/.test(l)).slice(0, 3)),
        exp('S7 재생성 원고가 검증·변환 뒤 원자 교체됐고 최종 QA PASS', reg.includes('검증·변환 통과 뒤 원고 교체') && reg.includes('QA FAIL 0 (재생성 1회 뒤)'), reg.split('\n').filter((l) => /재생성|QA FAIL 0/.test(l)).slice(0, 4)),
        exp('S7 장부 — 등록 성공 뒤 그 글의 격리 행이 지워졌다 (재생성 표식 잔여 0)', led === null, led),
        exp('S7 등록 = 재생성 원고 (medical 아님) · PR 1 MERGED · merge 1 · 배포 1', ev.registered.length === 1 && ev.registered[0].slug === t && ev.registered[0].medical !== true &&
          ev.prs.length === 1 && ev.prs[0].state === 'MERGED' && ev.mergeCalls.length === 1 && ev.mergeCalls[0].args.includes('--match-head-commit') && ev.deployments.length === 1, { registered: ev.registered, prs: ev.prs }),
      ]
    },
  },
}

// ─────────────────────────────────────────────────────────
// 경계 자체 시험 — guard·잔여물 검사기가 정말 막고 정말 보는가 (변이가 이 단언을 깬다)
// ─────────────────────────────────────────────────────────

export async function boundarySelfTest({ runtime, base }) {
  const sb = await buildSandbox({ source: SOURCE, runtime, label: 'canary', base, prepare: async (repo) => { await curate({ repo, keep: [] }); return {} } })
  const outside = join(base, `canary-outside-${process.pid}.txt`)
  let accepted = 0
  const server = net.createServer((sock) => { accepted += 1; sock.destroy() })
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  const port = server.address().port
  const canary = join(sb.root, 'tmp', 'canary.mjs')
  writeFileSync(canary, `import fs from 'node:fs'; import net from 'node:net'; import { spawnSync } from 'node:child_process'
const r = {}
const t = async (k, f) => { try { await f(); r[k] = 'ALLOWED' } catch (e) { r[k] = e.code === 'REHEARSAL_GUARD' ? 'BLOCKED' : 'ERROR:' + e.code } }
await t('write', () => fs.writeFileSync(${JSON.stringify(outside)}, 'x'))
await t('tcp', () => new Promise((res, rej) => { const s = net.connect(${port}, '127.0.0.1'); s.on('connect', () => { s.destroy(); res() }); s.on('error', rej) }))
await t('fetch', () => fetch('https://api.github.com/'))
await t('spawn', () => { const x = spawnSync('launchctl', ['list']); if (x.error) throw x.error })
await t('date', () => { if (new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) !== '2026-01-02') throw Object.assign(new Error('clock'), { code: 'CLOCK' }) })
console.log(JSON.stringify(r))
`)
  const env = stageEnv({ root: sb.root, clock: { fakeMs: Date.parse('2026-01-02T03:00:00+09:00'), realMs: Date.now(), speed: SPEED } })
  const r = spawnSync(process.execPath, [canary], { env, encoding: 'utf8' })
  await new Promise((res) => server.close(res))
  let probe = {}
  try { probe = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { probe = { parseError: r.stdout + r.stderr } }
  const guard = readGuard(sb.root)
  const outsideExists = existsSync(outside)
  rmSync(outside, { force: true })
  // 잔여물 검사기 — 일부러 남긴 잠금·lease 를 실제로 찾는가
  const plant = [join(sb.root, 'repo', 'drafts', 'magazine', '_runs', '.producer.lock'), join(sb.root, 'home', 'Library', 'Application Support', 'soransoran', 'magazine-manuscript-leases', 'x.lease')]
  for (const f of plant) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, '{}') }
  const found = leftovers(sb.root)
  const checks = [
    exp('경계 시험 — 임시 루트 밖 쓰기를 막고 파일이 생기지 않았다', probe.write === 'BLOCKED' && !outsideExists, probe),
    exp('경계 시험 — TCP 연결을 막았다 (상대 서버가 받은 연결 0)', probe.tcp === 'BLOCKED' && accepted === 0, { probe: probe.tcp, accepted }),
    exp('경계 시험 — 실제 fetch 를 막았다', probe.fetch === 'BLOCKED', probe.fetch),
    exp('경계 시험 — 허용 밖 외부 명령(launchctl)을 막았다', probe.spawn === 'BLOCKED', probe.spawn),
    exp('경계 시험 — 고정 시각이 자식에 걸렸다', probe.date === 'ALLOWED', probe.date),
    exp('경계 시험 — 막은 것을 위반으로 기록했다 (래퍼가 삼켜도 남는다)', ['WRITE_OUTSIDE_ROOT', 'NETWORK_CONNECT', 'NETWORK_FETCH', 'SPAWN_NOT_ALLOWED'].every((v) => guard.some((e) => e.kind === 'VIOLATION' && e.violation === v)), guard.filter((e) => e.kind === 'VIOLATION').map((e) => e.violation)),
    exp('잔여물 검사기 — 심어 둔 lock·lease 를 찾는다', plant.every((f) => found.includes(relative(sb.root, f))), found),
  ]
  rmSync(sb.root, { recursive: true, force: true })
  return { ok: checks.every((c) => c.ok), checks }
}

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────

export async function runScenario(id, { date, runtime, base, keep = false }) {
  const def = SCENARIOS[id]
  let sb
  try { sb = await buildSandbox({ source: SOURCE, runtime, label: id.toLowerCase(), base, prepare: (repo) => def.prepare(repo, date) }) } catch (e) {
    // 🔴 준비 실패도 그 시나리오의 FAIL 이다 — 다른 시나리오를 멈추지 않는다
    const checks = [exp(`${id} 자료 준비`, false, String(e?.message ?? e))]
    return { id, title: def.title, ok: false, date, root: null, stages: [], checks,
      evidence: { sends: {}, claude: [], prs: [], mergeCalls: [], deployments: [], registered: [], slack: [], leftovers: [], boundary: { violations: [], networkAttempts: 0, spawnsRefused: 0, fixtureRefusals: [], guardedProcesses: 0 } } }
  }
  const scenario = def.scenarioFor ? def.scenarioFor(sb.prepared, date) : def.scenario
  writeFileSync(join(sb.root, 'fixture', 'scenario.json'), `${JSON.stringify({ id, ...scenario }, null, 2)}\n`)
  const after = def.afterBuild ? await def.afterBuild(sb, sb.prepared, date) : null
  const ctx = { id, sb, date, stages: [], prepared: { ...sb.prepared, ...(after ?? {}) } }
  let error = null
  try { await def.run(ctx) } catch (e) { error = String(e?.stack ?? e) }
  const ev = await collect(sb, { date })
  let checks
  try { checks = [...def.expect(ev, ctx), ...boundaryChecks(ev)] } catch (e) { checks = [exp(`${id} 기대값 판정 예외`, false, String(e?.message ?? e))] }
  if (error) checks.unshift(exp(`${id} 실행 예외 없음`, false, error))
  const ok = checks.every((c) => c.ok)
  const pick = (o, ks) => (o ? Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]])) : null)
  const probe = (p) => (p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { status: v.status, lists: (ctx.prepared?.target && v.body.includes(ctx.prepared.target)) || false }])) : null)
  const extras = {
    handoff: ctx.handoff ?? null,
    repair: ctx.repairResult ? { results: ctx.repairResult.results?.map((r) => pick(r, ['slug', 'type', 'outcome', 'reason'])), recovered: ctx.repairResult.recovered } : null,
    apply: pick(ctx.applyResult, ['mode', 'pr', 'merged', 'mergeCommit', 'blockedBy', 'checked', 'deploy', 'runId']),
    register: ctx.registerResult ? { attempted: ctx.registerResult.attempted, held: (ctx.registerResult.held ?? []).map((r) => r.slug), done: (ctx.registerResult.done ?? []).map((r) => r.slug), exitCode: ctx.registerResult.exitCode } : null,
    recovery: (ctx.recoveryFiles ?? []).map((r) => pick(r, ['mode', 'outcome', 'code', 'merged', 'runId'])),
    site: { before: probe(ctx.before), after: probe(ctx.after) },
    publishAt: ctx.publishAt ?? null,
    hold: ctx.holdEntryBefore ? { before: ctx.holdEntryBefore, after: ctx.holdEntryAfter } : null,
  }
  const report = { id, title: def.title, ok, date, root: sb.root, kept: keep || !ok, prepared: ctx.prepared, baseline: sb.baseline,
    stages: ctx.stages, evidence: ev, extras, checks }
  if (ok && !keep) rmSync(sb.root, { recursive: true, force: true })
  return report
}

/** 반복성 비교에서 빼는 필드 — PID·임시 경로·실제 시각 */
export function deterministicView(r) {
  return {
    ok: r.ok,
    stages: r.stages.map((s) => ({ name: s.name, kst: s.kst, exit: s.exit })),
    sends: r.evidence.sends,
    claude: r.evidence.claude,
    prs: r.evidence.prs.map((p) => ({ state: p.state })),
    mergeCalls: r.evidence.mergeCalls.length,
    deployments: r.evidence.deployments.map((d) => d.state),
    registered: r.evidence.registered.map((a) => ({ slug: a.slug, publishAt: a.publishAt })),
    checks: r.checks.map((c) => ({ id: c.id, ok: c.ok })),
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] ?? null : null)
  const ids = (arg('--scenario') ?? Object.keys(SCENARIOS).join(',')).split(',').filter(Boolean)
  const unknown = ids.filter((i) => !SCENARIOS[i])
  if (unknown.length) { console.error(`모르는 시나리오: ${unknown.join(',')}`); process.exit(2) }
  const runtime = arg('--runtime') ?? DEFAULT_RUNTIME
  const date = arg('--date') ?? addDays(kstToday(), 1)
  const repeat = argv.includes('--no-repeat') ? false : ids.includes('S1')
  const base = join(tmpdir(), `magazine-rehearsal-${Date.now().toString(36)}`)
  mkdirSync(base, { recursive: true })
  const out = arg('--out') ?? join(base, 'rehearsal-report.json')
  const keep = argv.includes('--keep')
  console.log(`\n매거진 rehearsal — 회차 ${date} (KST 고정 · 배속 ${SPEED}) · 시나리오 ${ids.join(',')}${repeat ? ' + S1 반복' : ''}`)
  console.log(`  runtime(읽기 전용): ${runtime}`)
  const before = runtimeFingerprint(runtime)
  const selfTest = await boundarySelfTest({ runtime, base })
  console.log(`  ${selfTest.ok ? '✅' : '❌'} 경계 자체 시험 — ${selfTest.checks.filter((c) => c.ok).length}/${selfTest.checks.length}`)
  for (const c of selfTest.checks.filter((x) => !x.ok)) console.log(`     ❌ ${c.id} — ${c.detail.slice(0, 300)}`)
  const scenarios = []
  for (const id of ids) {
    const t0 = Date.now()
    const r = await runScenario(id, { date, runtime, base, keep })
    scenarios.push(r)
    console.log(`  ${r.ok ? '✅' : '❌'} ${id} — ${r.checks.filter((c) => c.ok).length}/${r.checks.length} (${Math.round((Date.now() - t0) / 1000)}초)${r.ok ? '' : ` · 보존: ${r.root}`}`)
    for (const c of r.checks.filter((x) => !x.ok)) console.log(`     ❌ ${c.id} — ${c.detail.slice(0, 300)}`)
  }
  let repeatability = null
  if (repeat) {
    const again = await runScenario('S1', { date, runtime, base, keep })
    const a = JSON.stringify(deterministicView(scenarios.find((s) => s.id === 'S1')))
    const b = JSON.stringify(deterministicView(again))
    repeatability = { ok: a === b && again.ok, first: JSON.parse(a), second: JSON.parse(b), excluded: ['pid', 'root', 'realMs', 'log', 'tail', 'merge SHA', 'PR 번호', 'runId'], secondRoot: again.ok ? null : again.root }
    // 🔴 두 번째 실행은 결정적 필드만 쓴다 — 통과했으면 루트를 남기지 않는다
    if (again.ok && again.root) rmSync(again.root, { recursive: true, force: true })
    console.log(`  ${repeatability.ok ? '✅' : '❌'} S1 반복성 — 결정적 필드·판정 ${a === b ? '같다' : '다르다'}`)
  }
  const after = runtimeFingerprint(runtime)
  const runtimeUnchanged = before.sha256 === after.sha256
  console.log(`  ${runtimeUnchanged ? '✅' : '❌'} 운영 runtime 자료 불변 (${before.files}개 파일 · HEAD ${before.head.slice(0, 7)})`)
  const totals = {
    violations: scenarios.reduce((n, s) => n + s.evidence.boundary.violations.length, 0),
    networkAttempts: scenarios.reduce((n, s) => n + s.evidence.boundary.networkAttempts, 0),
    spawnsRefused: scenarios.reduce((n, s) => n + s.evidence.boundary.spawnsRefused, 0),
    fixtureRefusals: scenarios.reduce((n, s) => n + s.evidence.boundary.fixtureRefusals.length, 0),
    leftovers: scenarios.reduce((n, s) => n + s.evidence.leftovers.length, 0),
  }
  const ok = selfTest.ok && scenarios.every((s) => s.ok) && (!repeat || repeatability.ok) && runtimeUnchanged && Object.values(totals).every((v) => v === 0)
  const report = { schema: 'magazine-rehearsal/1', ok, verdict: ok ? 'REHEARSAL_PASS' : 'REHEARSAL_FAIL',
    note: 'REHEARSAL_PASS 는 코드 경로 증거다 — OPERATING_PASS 가 아니다', date, speed: SPEED, runtime: { path: runtime, before, after, unchanged: runtimeUnchanged },
    totals, selfTest, scenarios, repeatability, generatedAt: new Date().toISOString() }
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\n${ok ? '✅ REHEARSAL_PASS' : '🔴 REHEARSAL_FAIL'} — 보고서: ${out}\n`)
  // 🔴 통과한 시나리오 루트는 이미 지웠다 — 빈 상위 폴더도 남기지 않는다 (보고서가 그 안에 있으면 둔다)
  try { if (readdirSync(base).length === 0) rmSync(base, { recursive: true, force: true }) } catch { /* 없다 */ }
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-rehearsal.mjs')) main()
