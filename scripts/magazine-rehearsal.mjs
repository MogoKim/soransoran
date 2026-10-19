#!/usr/bin/env node
/**
 * 🔴 **매거진 M-AUTO rehearsal — 실제 엔트리포인트 전체를 격리된 임시 사본에서 같은 날 반복 실행한다** (2026-10-10).
 *
 *   npm run magazine:rehearsal                          시나리오 S1~S14 · S8B · S14U · S14B + S1 반복성
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

/**
 * 🔴 **sandbox 사본 articles.ts 에서 slug 하나만 뺀다** — S12·S14·S14B 공통 계약 (2026-10-13).
 *    과거 사건을 재현하는 시나리오가 **운영이 성공할수록 실행 불가능해지지 않게** 한다
 *    (#690 뒤 gray · #701 뒤 cold 가 runtime articles.ts 에 이미 있다).
 *    순수 함수다 — 실제 runtime·제품 article 은 건드리지 않는다. 부른 쪽이 sandbox 사본에만 쓴다.
 *
 *    없으면 그대로(no-op). 있으면 여러 줄 항목 하나를 잘라 내고 **구조로** 확인한다:
 *      그 slug 가 남지 않았다 · 다른 글은 순서와 값이 그대로다. 하나라도 아니면 예외 (짐작 0).
 */
export function withoutArticle(src, slug, parse) {
  if (!parse(src).some((a) => a.slug === slug)) return { next: src, removed: false }
  const at = src.indexOf(`\n  '${slug}': {\n`)
  if (at < 0) throw new Error(`articles.ts 에서 ${slug} 항목 시작을 찾지 못했다 (여러 줄 항목이 아니다)`)
  const end = src.indexOf('\n  },\n', at + 1)
  if (end < 0) throw new Error(`articles.ts 에서 ${slug} 항목 끝을 찾지 못했다`)
  const next = src.slice(0, at) + src.slice(end + 5)
  const after = parse(next)
  if (after.some((a) => a.slug === slug)) throw new Error(`articles.ts 에서 ${slug} 를 빼지 못했다`)
  const before = parse(src).filter((a) => a.slug !== slug)
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`articles.ts 에서 ${slug} 말고 다른 글이 바뀌었다 (순서·값)`)
  return { next, removed: true }
}

/** 등록 모양을 만들 때만 — 항목 원문을 레코드 맨 앞에 넣는다 (sandbox 사본 전용) */
function withArticleEntry(src, entry) {
  const anchor = src.indexOf('MAGAZINE_ARTICLE_RECORD')
  const open = anchor < 0 ? -1 : src.indexOf('{\n', src.indexOf('=', anchor))
  if (open < 0) throw new Error('articles.ts 레코드 시작을 찾지 못했다')
  return src.slice(0, open + 2) + entry + src.slice(open + 2)
}

/**
 * 제거 계약 자기 시험 — 합성 소스 넷. 🔴 검증을 지우면 여기서 깨진다 (그냥 잘 지워지는 실제 소스만으로는 못 본다).
 *   ① 미등록 → no-op  ② 등록 1건 → 그것만 제거 · 이웃 순서 그대로
 *   ③ 닫는 줄 뒤에 한 줄 항목이 붙어 절단이 이웃 둘까지 지우는 모양 → 거부
 *   ④ 한 줄 항목(절단 불가) → 거부
 */
export function articleIsolationSelfTest(parse) {
  const slug = 'cold-weather-joint-pain'
  const SYN = (body) => `export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = {\n${body}}\n`
  const A = "  'a-one': {\n    title: 'A',\n  },\n"
  const C3 = "  'c-three': {\n    title: 'C3',\n  },\n"
  const throws = (src) => { try { withoutArticle(src, slug, parse); return false } catch { return true } }
  const absent = SYN(A + C3)
  const r0 = withoutArticle(absent, slug, parse)
  const r1 = withoutArticle(SYN(A + `  '${slug}': {\n    title: 'C',\n  },\n` + C3), slug, parse)
  return {
    absentNoop: r0.removed === false && r0.next === absent,
    removesOnlyIt: r1.removed === true && parse(r1.next).map((a) => a.slug).join(',') === 'a-one,c-three',
    rejectsNeighborLoss: throws(SYN(A + `  '${slug}': {\n    title: 'C',\n  }, 'b-two': { title: 'B' },\n` + C3)),
    rejectsOneLine: throws(SYN(A + `  '${slug}': { title: 'C' },\n` + C3)),
  }
}

/**
 * S14·S14B 공통 — cold 1회성 복구의 운영 모양 (원고 4파일 · 큐 행 · 장부 행은 2026-10-12 운영 값의 읽기 전용 사본).
 * 🔴 `registry` — runtime articles.ts 에 cold 가 있든 없든 같은 과거 사건(10/12 · 등록 전)을 재현한다:
 *    'registered'   등록된 모양을 강제(없으면 10/13 등록 항목 fixture 를 넣는다) → 격리가 1건 뺀다
 *    'unregistered' 미등록 모양을 강제(있으면 먼저 뺀다) → 격리는 no-op
 *    'as-is'        runtime 사본 그대로 → 격리
 */
function coldRecoveryScenario(regenMode, { rerun = false, registry = 'as-is' } = {}) {
  const slug = 'cold-weather-joint-pain'
  return {
    async prepare(repo) {
      const L = await imp(repo, 'scripts/lib/magazine-load.mjs')
      const QL = await imp(repo, 'scripts/lib/magazine-queue-lock.mjs')
      const RQ = await imp(repo, 'scripts/fixtures/magazine-format-contract/repair-queue-rows.mjs')
      const Q = await imp(repo, 'scripts/lib/magazine-quarantine.mjs')
      const qPath = join(repo, 'drafts', 'magazine', 'topic-queue.ts')
      let qsrc = readFileSync(qPath, 'utf8')
      const old = L.parseQueueSource(qsrc).find((q) => q.slug === slug)
      if (old) qsrc = QL.removeQueueDay(qsrc, old.day) ?? (() => { throw new Error(`sandbox 큐에서 ${slug} 행을 빼지 못했다`) })()
      writeFileSync(qPath, RQ.withFixtureRows(qsrc, [slug]).src)
      await curate({ repo, keep: [slug] })
      const fx = (n) => readFileSync(join(repo, 'scripts', 'fixtures', 'magazine-format-contract', n), 'utf8')
      // 🔴 article registry 격리 — sandbox 사본 articles.ts 에서만 (runtime·제품 article 은 읽기만)
      const aPath = join(repo, 'src', 'content', 'magazine', 'articles.ts')
      const parse = (src) => L.parseArticlesSource(src)
      const has = (src) => parse(src).some((a) => a.slug === slug)
      let asrc = readFileSync(aPath, 'utf8')
      if (registry === 'registered' && !has(asrc)) asrc = withArticleEntry(asrc, fx('cold-weather-joint-pain.registered-2026-10-13.articles-entry.ts.txt'))
      if (registry === 'unregistered' && has(asrc)) asrc = withoutArticle(asrc, slug, parse).next
      const shape = has(asrc) ? 'registered' : 'unregistered'
      const othersOf = (src) => JSON.stringify(parse(src).filter((a) => a.slug !== slug))
      const iso = withoutArticle(asrc, slug, parse)
      writeFileSync(aPath, iso.next)
      const isolation = { shape, removed: iso.removed, absentAfter: !has(readFileSync(aPath, 'utf8')), othersKept: othersOf(readFileSync(aPath, 'utf8')) === othersOf(asrc),
        selfTest: articleIsolationSelfTest(parse) }
      const files = { 'brief.md': fx('cold-weather-joint-pain.recovery-2026-10-12.brief.md'), 'review.ts': fx('cold-weather-joint-pain.recovery-2026-10-12.review.ts.txt'),
        'draft.md': fx('cold-weather-joint-pain.regen-source-2026-10-12.draft.md'), 'article-draft.ts': fx('cold-weather-joint-pain.recovery-2026-10-12.article-draft.ts.txt') }
      writeSlugFiles({ repo, slug, files })
      placeHero({ repo, slug })
      const h = (t) => createHash('sha256').update(t).digest('hex')
      const shas = { briefSha256: h(files['brief.md']), reviewSha256: h(files['review.ts']), draftSha256: h(files['draft.md']), articleSha256: h(files['article-draft.ts']) }
      const id = Q.ONE_TIME_RECOVERIES[0].identity
      return { target: slug, shas, identityOk: Object.entries(shas).every(([k, v]) => id[k] === v), untrack: [`drafts/magazine/${slug}`], isolation }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:regen`]: [regenMode, regenMode] } }),
    async afterBuild(sb, p) {
      // 🔴 2026-10-12 운영 장부 cold 행 그대로 (읽기 전용 조회값) — 시험이 복구 계보를 만들지 않는다
      const store = { [p.target]: { attempts: 2, lastAt: 1791734502311, fingerprint: 'sha256:dce6d087af6def7be9ee45c59fbff539', kind: 'CONTENT', sent: false,
        reasons: ['QA_FAIL: magazine QA FAIL — REGEN_EXHAUSTED: 🔴 등록 전 전체 재생성 4회를 이미 썼다 (상한 4) — 이 글만 HOLD'],
        regenCalls: 4, lastRegenAt: 1791734462875, lastPacketHash: '04f202aaa72705b3',
        regenAttemptIds: ['deca3155-ef16-46a3-bfec-a98ba39cdd38', '2b6af026-9829-4a0a-8bb0-c2128ad700b2', '961dc04a-c099-46b5-9fab-5cbfa8aee2a7', '6f3d381f-447e-471b-ad83-0e8dabdc1187'],
        inputRepairCalls: 1, inputRepairFingerprints: ['sha256:c5e87b4c60fdbce6e767f456c8935f1b0db6992b055e9aa37ee0601f1c40713f'], lastInputRepairAt: 1791645017805,
        regenLineage: { id: 'b542d44b-b6d2-4b8b-8a9b-e96f21768c23', origin: 'INPUT_REPAIR', evidenceKey: 'INPUT_REPAIR:c5e87b4c60fdbce6e767f456c8935f1b0db6992b055e9aa37ee0601f1c40713f', openedAt: 1791734413421, calls: 2,
          attemptIds: ['961dc04a-c099-46b5-9fab-5cbfa8aee2a7', '6f3d381f-447e-471b-ad83-0e8dabdc1187'] },
        regenLineageKeys: ['INPUT_REPAIR:c5e87b4c60fdbce6e767f456c8935f1b0db6992b055e9aa37ee0601f1c40713f'] } }
      mkdirSync(dirname(ledgerPath(sb)), { recursive: true })
      writeFileSync(ledgerPath(sb), `${JSON.stringify(store, null, 2)}\n`)
      return {}
    },
    async run(ctx) {
      await normalDay(ctx)
      if (rerun) {
        ctx.stages.push(runStage(ctx.sb, { name: 'rerun-register', entry: 'register', kst: KST(ctx.date, '03:30') }))
        ctx.rerunResult = readJson(runFile(ctx.sb, ctx.date, /^auto-register\.json$/)[0] ?? '')
      }
    },
  }
}

/** S14·S14U 공통 단언 — 🔴 제품 계약은 그대로 (OPENED 1 · regen 1 · 일반 0 · QA · 등록·PR·병합·배포). 등록 모양만 다르다 */
function coldRecoveryExpect(id, shape, ev, ctx) {
  const iso = ctx.prepared.isolation ?? {}
  const st = iso.selfTest ?? {}
  const t = ctx.prepared.target
  const row = (ctx.registerResult?.results ?? []).find((r) => r.slug === t) ?? null
  const typed = ev.regenTyped.filter((r) => r.slug === t).map((r) => r.typed)
  const rec = ctx.registerResult?.oneTimeRecoveries ?? []
  return [
    exp(`${id} 준비 — runtime ${shape === 'registered' ? '등록' : '미등록'} 모양 · sandbox 사본 articles.ts 에서 cold 만 ${shape === 'registered' ? '1건 제거' : '제거할 것 없음'} · 다른 글 순서·값 그대로`,
      iso.shape === shape && iso.removed === (shape === 'registered') && iso.absentAfter === true && iso.othersKept === true, { shape: iso.shape, removed: iso.removed, absentAfter: iso.absentAfter, othersKept: iso.othersKept }),
    exp(`${id} 격리 자기 시험 — 미등록 no-op · 1건만 제거 · 이웃까지 지우는 절단 거부 · 한 줄 항목 거부`,
      st.absentNoop === true && st.removesOnlyIt === true && st.rejectsNeighborLoss === true && st.rejectsOneLine === true, st),
    exp(`${id} 준비 — 운영 행·원고 4파일 신원 그대로 (attempts 2 · regenCalls 4 · 계보 b542d44b · 4 SHA 일치)`, ctx.prepared.identityOk, ctx.prepared.shas),
    exp(`${id} 1회성 복구 OPENED (정확한 사건)`, rec.filter((r) => r.slug === t && r.status === 'OPENED').length === 1, rec),
    exp(`${id} 재생성 요청 1 — description 57자 위반 · 길이 목표(최소 N자 줄인다) · 계산 기준 모두 실렸다`, typed.length === 1 && /description 57자 — 허용 60~160자 밖/.test(typed[0]) && /최소 \d+자를 줄인다/.test(typed[0]) && typed[0].includes('공백·줄바꿈 포함'),
      (typed[0] ?? '').split('\n').filter((l) => /QA_FAIL|BODY_LENGTH/.test(l)).slice(0, 4)),
    exp(`${id} provider 재생성 정확히 1 · 일반 요청 0 · 재생성 1회(APPLIED)로 QA 통과 · 판정 DONE`, ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 0 && (row?.regenHistory ?? []).length === 1 &&
      row.regenHistory[0].outcome === 'APPLIED' && row?.verdict === 'DONE', { bySlug: ev.sends.bySlug, verdict: row?.verdict, history: row?.regenHistory }),
    exp(`${id} 등록 1 · PR MERGED · 배포 · 장부 행 정리`, ev.registered.length === 1 && ev.registered[0].slug === t && ev.prs[0]?.state === 'MERGED' && ev.deployments.length === 1 && !ev.ledger?.[t], { registered: ev.registered }),
  ]
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
      // 🔴 역할 글의 원고는 runtime 처럼 미추적 — 날짜로 고른 글이 저장소에서 추적 원고를 가져도 같은 시나리오 (2026-10-12)
      return { gray: a.slug, cold: b.slug, autumn: c.slug, normal: d.slug, untrack: [a, b, c, d].map((it) => `drafts/magazine/${it.slug}`) }
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
        exp('S2 입력 수리 원자 교체 성공이 새 재생성 계보(INPUT_REPAIR)를 열었다 · 전체 regenCalls 보존', led[p.cold]?.regenLineage?.origin === 'INPUT_REPAIR' && led[p.cold].regenLineage.calls === 0 && !led[p.autumn]?.regenLineage?.origin?.startsWith('INPUT'), { cold: led[p.cold]?.regenLineage, autumn: led[p.autumn]?.regenLineage }),
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

  S8: {
    title: '최초 응답 형식 실패 → 교정 재생성 — 입력 수리로 고친 brief · 01:00 일반 요청 1회가 frontmatter 없는 응답 → 같은 요청 재전송 0 · 교정 1 → 등록·PR·병합·배포 (2026-10-11 gray-hair 모양)',
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      const pr = await templatePair({ repo, item: t, broken: true })
      writeSlugFiles({ repo, slug: t.slug, files: { 'brief.md': pr.brief, 'review.ts': pr.review } })
      placeHero({ repo, slug: t.slug })
      // 🔴 runtime 모양 — 진행 중인 글의 brief·review 는 미추적이다 (S2·S11 과 같은 선언 · 2026-10-19).
      //    선언이 없으면 새로 쓴 brief 가 기준 커밋에서 추적 파일이 되어, 입력 수리가 고치는 순간 DIRTY_TREE 로 멈춘다
      //    (대상이 runtime 에 미추적 brief 가 없는 글 — national-pension-voluntary — 로 바뀌면서 드러났다)
      return { target: t.slug, untrack: [`drafts/magazine/${t.slug}`] }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:initial`]: ['no-frontmatter'] } }),
    async run(ctx) {
      await normalDay(ctx)
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-register', entry: 'register', kst: KST(ctx.date, '03:30') }))
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const reg = logOf(ctx, 'register')
      const row = (ctx.registerResult?.results ?? []).find((r) => r.slug === t) ?? null
      const fr = row?.firstResponse ?? null
      const typed = ev.regenTyped.find((r) => r.slug === t)?.typed ?? ''
      return [
        exp('S8 입력 수리가 brief 를 고쳤고 producer 는 이 글을 보내지 않았다', ev.claude.some((c) => c.slug === t) && !reg.includes('입력 수리 필요'), ev.claude),
        exp('S8 일반 요청 1회 · 교정 재생성 1회 · 일반 요청 재전송 0 (재실행 포함)', ev.sends.bySlug[`${t}:initial`] === 1 && ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 1, ev.sends.bySlug),
        exp('S8 교정 요청에 실제 최초 위반(frontmatter 없음)이 실렸다', typed.includes('FIRST_RESPONSE_INVALID') && /frontmatter|---/.test(typed), typed.split('\n').filter((l) => /FIRST_RESPONSE|frontmatter/.test(l)).slice(0, 3)),
        exp('S8 최초 응답 증거가 회차 결과에 남는다 — reason·stage·sent·invalid·responseForm·대화·메시지·sha256·길이', fr && fr.reason === 'invalid_manuscript' && fr.stage === 'validate' && fr.sent === true && fr.invalid?.length > 0 &&
          fr.responseForm && /^https:\/\/chatgpt\.com\/c\//.test(fr.conversationUrl ?? '') && fr.assistantMessageId && /^[0-9a-f]{64}$/.test(fr.responseSha256 ?? '') && fr.length > 0, fr),
        exp('S8 원문 전체는 남지 않는다 — 앞부분은 정제된 200자 이하 · 모든 문자열 칸이 응답보다 짧다 · 장부에 앞부분 없음',
          fr && typeof fr.responseExcerpt === 'string' && fr.responseExcerpt.length <= 200 && fr.length > fr.responseExcerpt.length &&
          JSON.stringify(fr).length < fr.length && !JSON.stringify(ev.ledger ?? {}).includes(fr.responseExcerpt.slice(0, 40)), { excerpt: fr?.responseExcerpt?.length, length: fr?.length, json: JSON.stringify(fr ?? {}).length }),
        exp('S8 로그 — 최초 응답 형식 실패 → 교정 재생성으로 원고 확보', reg.includes('교정 재생성으로 원고 확보 · 일반 요청 재전송 0'), reg.split('\n').filter((l) => /draft|교정/.test(l)).slice(0, 3)),
        exp('S8 등록 1 · PR 1 MERGED · merge 1 · 배포 1', ev.registered.length === 1 && ev.registered[0].slug === t && ev.prs.length === 1 && ev.prs[0].state === 'MERGED' && ev.mergeCalls.length === 1 && ev.deployments.length === 1, { registered: ev.registered, prs: ev.prs }),
        exp('S8 장부 — 등록 성공 뒤 행이 지워졌다 (교정 계보·최초 응답 기록 잔여 0)', !ev.ledger?.[t], ev.ledger?.[t] ?? null),
      ]
    },
  },

  S8B: {
    title: '신원 없는 최초 invalid 응답 → fail-closed — 대화 주소를 특정할 수 없는 응답은 교정·재전송 0 · 같은 날 재실행도 HOLD',
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      const pr = await templatePair({ repo, item: t, broken: true })
      writeSlugFiles({ repo, slug: t.slug, files: { 'brief.md': pr.brief, 'review.ts': pr.review } })
      placeHero({ repo, slug: t.slug })
      // 🔴 runtime 모양 — 진행 중인 글의 brief·review 는 미추적이다 (S2·S11 과 같은 선언 · 2026-10-19).
      //    선언이 없으면 새로 쓴 brief 가 기준 커밋에서 추적 파일이 되어, 입력 수리가 고치는 순간 DIRTY_TREE 로 멈춘다
      //    (대상이 runtime 에 미추적 brief 가 없는 글 — national-pension-voluntary — 로 바뀌면서 드러났다)
      return { target: t.slug, untrack: [`drafts/magazine/${t.slug}`] }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:initial`]: ['no-identity'] } }),
    async run(ctx) {
      await normalDay(ctx)
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-register', entry: 'register', kst: KST(ctx.date, '03:30') }))
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const reg = logOf(ctx, 'register')
      const rerun = logOf(ctx, 'rerun-register')
      const led = ev.ledger?.[t] ?? null
      return [
        exp('S8B 일반 요청 1회 뒤 교정 0 · 재전송 0 (재실행 포함)', ev.sends.bySlug[`${t}:initial`] === 1 && !ev.sends.bySlug[`${t}:regen`] && ev.sends.initial === 1 && ev.sends.regen === 0, ev.sends.bySlug),
        exp('S8B FIRST_RESPONSE_UNIDENTIFIED — 신원 부족으로 교정·재전송 0', reg.includes('FIRST_RESPONSE_UNIDENTIFIED') || reg.includes('응답 신원이 모자라'), reg.split('\n').filter((l) => /draft|신원/.test(l)).slice(0, 3)),
        exp('S8B 전송 예약이 풀리지 않았다 (DELIVERY_UNCERTAIN HOLD) · 최초 응답 기록 없음', led?.delivery?.kind === 'DELIVERY_UNCERTAIN' && !led?.firstResponseInvalid, led),
        exp('S8B 같은 날 재실행은 HOLD — runner 0', /DELIVERY_UNCERTAIN|HOLD/.test(rerun), rerun.split('\n').filter((l) => l.includes(t)).slice(0, 2)),
        exp('S8B 등록·PR·병합 0', ev.registered.length === 0 && ev.prs.length === 0 && ev.mergeCalls.length === 0, { prs: ev.prs }),
      ]
    },
  },

  S10: {
    title: '00:10 producer 회수가 받은 invalid 응답 → 01:00 같은 일반 요청 재전송 0 · 장부의 최초 응답 기록으로 교정 1 → 등록',
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      placeHero({ repo, slug: t.slug })
      return { target: t.slug }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:initial`]: ['no-frontmatter'] } }),
    async run(ctx) {
      ctx.stages.push(runStage(ctx.sb, { name: 'producer', entry: 'producer', kst: KST(ctx.date, '00:10') }))
      ctx.afterProducerLedger = readJson(ledgerPath(ctx.sb))?.[ctx.prepared.target] ?? null
      ctx.stages.push(runStage(ctx.sb, { name: 'register', entry: 'register', kst: KST(ctx.date, '01:00') }))
      ctx.applyResult = readJson(runFile(ctx.sb, ctx.date, /^auto-merge\.json$/)[0] ?? '')
      ctx.registerResult = readJson(runFile(ctx.sb, ctx.date, /^auto-register\.json$/)[0] ?? '')
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const fri = ctx.afterProducerLedger?.firstResponseInvalid ?? null
      const reg = logOf(ctx, 'register')
      return [
        exp('S10 producer 가 응답을 특정했고 장부에 최초 응답 기록(지문·대화·메시지·sha · 앞부분 없음)을 남겼다', fri && /^sha256:/.test(fri.messageFingerprint ?? '') && fri.conversationUrl && fri.assistantMessageId && /^[0-9a-f]{64}$/.test(fri.responseSha256 ?? '') && !('responseExcerpt' in fri), fri),
        exp('S10 01:00 일반 요청 재전송 0 · 교정 1 (하루 일반 요청 1회)', ev.sends.bySlug[`${t}:initial`] === 1 && ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 1, ev.sends.bySlug),
        exp('S10 등록 · PR MERGED · 배포', reg.includes('교정 재생성으로 원고 확보') && ev.registered.length === 1 && ev.prs[0]?.state === 'MERGED' && ev.deployments.length === 1, { registered: ev.registered }),
      ]
    },
  },

  S9: {
    title: '과장 원고 → hero 전에 길이 실패 → 재생성 — 3000자 넘는 최초 원고가 QA 에서 BODY_TOO_LONG · hero 0 · 실제 길이를 실은 재생성 → 3000자 이하 등록·배포 (2026-10-11 autumn 모양)',
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      return { target: t.slug }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:initial`]: ['too-long'] } }),
    async run(ctx) { await normalDay(ctx) },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const reg = logOf(ctx, 'register')
      const typed = ev.regenTyped.find((r) => r.slug === t)?.typed ?? ''
      const calls = readFileSync(join(ctx.sb.root, 'fixture', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const iRegen = calls.findIndex((c) => c.tool === 'chatgpt' && c.kind === 'regen' && c.slug === t)
      const iHero = calls.findIndex((c) => c.op === 'hero-trace-generate' || c.op === 'hero-trace-reuse')
      const m = /BODY_TOO_LONG: 본문 (\d+)자/.exec(typed)
      const qaIdx = reg.indexOf('재생성 1/2')
      const heroIdx = reg.indexOf('hero 생성')
      return [
        exp('S9 최초 원고 1 · 재생성 1 · 최초 요청 재전송 0', ev.sends.bySlug[`${t}:initial`] === 1 && ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 1 && ev.sends.regen === 1, ev.sends.bySlug),
        exp('S9 재생성 요청에 실제 길이와 기준이 실렸다 (BODY_TOO_LONG · 3000 초과 · 800~3000)', Boolean(m) && Number(m[1]) > 3000 && typed.includes('800~3000'), typed.split('\n').filter((l) => /BODY_TOO/.test(l)).slice(0, 2)),
        exp('S9 길이 실패는 hero 전에 막혔다 — 재생성 뒤에 hero (호출 순서 · 로그 순서)', iRegen !== -1 && iHero !== -1 && iRegen < iHero && qaIdx !== -1 && heroIdx !== -1 && qaIdx < heroIdx, { iRegen, iHero, qaIdx, heroIdx }),
        exp('S9 hero 는 한 번만 (생성 1 · 재사용 0)', ev.hero.generate === 1 && ev.hero.reuse === 0, ev.hero),
        exp('S9 batch 통과 · 등록 1 · PR 1 MERGED · 배포 1', reg.includes('READY') && ev.registered.length === 1 && ev.registered[0].slug === t && ev.prs.length === 1 && ev.prs[0].state === 'MERGED' && ev.deployments.length === 1, { registered: ev.registered }),
      ]
    },
  },

  S11: {
    title: '10/11 운영 후 상태 → 다음 회차 — cold·autumn(입력 수리 APPLIED · regenCalls 2 · 계보 없음) 은 영수증 대조로 계보가 한 번 열려 재생성 1 → 등록 · 무관한 옛 행은 그대로 소진 · provider·일반 전송 0',
    async prepare(repo, date) {
      const [a, b, c] = await pickTargets({ repo, date, selectable: 1, others: 2 })
      await curate({ repo, keep: [a.slug, b.slug, c.slug] })
      const C = await imp(repo, 'scripts/lib/magazine-rehearsal-content.mjs')
      const draftsDir = join(repo, 'drafts', 'magazine')
      // a = cold 모양(description 57자 QA FAIL) · b = autumn 모양(3000자 초과) · c = 무관한 옛 행(cold 와 같은 원고 결함 · 수리 영수증 없음)
      for (const [it, mode] of [[a, 'short-description'], [b, 'too-long'], [c, 'short-description']]) {
        const pr = await templatePair({ repo, item: it })
        writeSlugFiles({ repo, slug: it.slug, files: { 'brief.md': pr.brief, 'review.ts': pr.review } })
        writeSlugFiles({ repo, slug: it.slug, files: { 'draft.md': C.manuscriptFor({ repo, draftsDir, slug: it.slug, item: it, mode }) } })
        placeHero({ repo, slug: it.slug })
      }
      return { cold: a.slug, autumn: b.slug, unrelated: c.slug }
    },
    scenarioFor: () => ({ ci: {}, deploy: {} }),
    async afterBuild(sb, p, date) {
      // 🔴 운영 장부·결과 파일 모양 그대로 (2026-10-11 읽기 전용 진단 값) — 계보는 시험이 만들지 않는다
      const DG = await imp(sb.repo, 'scripts/lib/magazine-delivery-gate.mjs')
      const Q = await imp(sb.repo, 'scripts/lib/magazine-quarantine.mjs')
      const draftsDir = join(sb.repo, 'drafts', 'magazine')
      const prev = addDays(date, -1)
      const fpOf = (slug) => Q.deliveryFingerprintOf(DG.plannedInputRepairMessageFor(slug, draftsDir))
      const at = (hms) => Date.parse(`${prev}T${hms}+09:00`)
      const repaired = (slug, hms, ids, reason) => ({ attempts: 1, lastAt: at('01:01:00'), fingerprint: 'sha256:dce6d087af6def7be9ee45c59fbff539', reasons: [reason],
        regenCalls: 2, lastRegenAt: at('01:00:16'), lastPacketHash: 'b1a0c2b8041cfe75', regenAttemptIds: ids, kind: 'CONTENT', sent: false,
        inputRepairCalls: 1, inputRepairFingerprints: [fpOf(slug)], lastInputRepairAt: at(hms) })
      const store = {
        [p.cold]: repaired(p.cold, '00:10:17', ['deca3155-ef16-46a3-bfec-a98ba39cdd38', '2b6af026-9829-4a0a-8bb0-c2128ad700b2'],
          'QA_FAIL: magazine QA FAIL — REGEN_EXHAUSTED: 🔴 재생성 2회를 이미 썼다 (상한 2) — 이 글만 HOLD · 실제 QA FAIL: description 57자 — 허용 60~160자 밖'),
        [p.autumn]: repaired(p.autumn, '00:11:28', ['d987cc88-0977-4f27-b2a8-ec7963af78b4', 'd4038785-7fb0-49a3-86bd-aea6084e5ac6'], 'BODY_TOO_LONG: 본문 3252자 — 3000자를 넘었다'),
        [p.unrelated]: { attempts: 1, lastAt: at('01:03:00'), fingerprint: 'sha256:0123456789abcdef0123456789abcdef', kind: 'CONTENT', sent: false,
          reasons: ['QA_FAIL: magazine QA FAIL — REGEN_EXHAUSTED: 🔴 재생성 2회를 이미 썼다 (상한 2)'], regenCalls: 2, regenAttemptIds: ['u1', 'u2'], lastRegenAt: at('01:02:00') },
      }
      mkdirSync(dirname(ledgerPath(sb)), { recursive: true })
      writeFileSync(ledgerPath(sb), `${JSON.stringify(store, null, 2)}\n`)
      const runs = join(draftsDir, '_runs', prev)
      mkdirSync(runs, { recursive: true })
      const echo = (slug) => ({ slug, type: 'DRAFT_INVALID_BRIEF_ECHO', violations: [{ code: 'BRIEF_ECHO', why: '## 검색 의도' }], sent: true, candidateApplied: true,
        conversationUrl: `https://chatgpt.com/c/receipt-${slug}`, repairFingerprint: fpOf(slug), outcome: 'APPLIED', reason: 'draft.md 원자 교체 — QA·hero·등록은 01:00 auto-register 가 기존 경로로' })
      writeFileSync(join(runs, 'input-repair-001543-1890-772d6aa2.json'), `${JSON.stringify({ date: prev, ok: true, results: [echo(p.cold), echo(p.autumn)], skipped: [], recovered: [], limit: 3, writtenAt: `${prev}T15:15:43.000Z` }, null, 2)}\n`)
      return { seeded: store }
    },
    async run(ctx) {
      await normalDay(ctx)
      ctx.afterFirstLedger = readJson(ledgerPath(ctx.sb))
      ctx.stages.push(runStage(ctx.sb, { name: 'rerun-register', entry: 'register', kst: KST(ctx.date, '03:30') }))
    },
    expect(ev, ctx) {
      const p = ctx.prepared
      const rows = Object.fromEntries((ctx.registerResult?.results ?? []).map((r) => [r.slug, r]))
      const typed = (slug) => ev.regenTyped.filter((r) => r.slug === slug).map((r) => r.typed).join('\n')
      const led = ev.ledger ?? {}
      const reg = logOf(ctx, 'register')
      const lenM = /BODY_TOO_LONG: 본문 (\d+)자/.exec(typed(p.autumn))
      return [
        exp('S11 준비 — 운영 모양 그대로 (attempts 1 · regenCalls 2 · inputRepairCalls 1 · 계보 없음 · APPLIED 결과 파일)', [p.cold, p.autumn].every((s) => p.seeded[s].attempts === 1 && p.seeded[s].regenCalls === 2 && p.seeded[s].inputRepairCalls === 1 && !p.seeded[s].regenLineage), p.seeded),
        exp('S11 입력 수리 재호출 0 · Claude 0 · 일반 요청 0 (producer · register · 재실행 전부)', ev.claude.length === 0 && ev.sends.initial === 0 && ![p.cold, p.autumn, p.unrelated].some((s) => ev.sends.bySlug[`${s}:repair`] || ev.sends.bySlug[`${s}:initial`]), { claude: ev.claude, bySlug: ev.sends.bySlug }),
        exp('S11 cold·autumn — 신뢰 증거(APPLIED 영수증 · 수리 지문 · 유효 draft)로 계보가 한 번 열렸다', rows[p.cold]?.lineageReconcile?.legacyInputRepair === 'OPENED' && rows[p.autumn]?.lineageReconcile?.legacyInputRepair === 'OPENED' &&
          (reg.match(/옛 입력 수리 대조 OPENED/g) ?? []).length === 2, { cold: rows[p.cold]?.lineageReconcile, autumn: rows[p.autumn]?.lineageReconcile }),
        exp('S11 재생성 — cold 1 (description) · autumn 1 (실제 길이 3000 초과 · 기준) · 무관한 행 0', ev.sends.bySlug[`${p.cold}:regen`] === 1 && ev.sends.bySlug[`${p.autumn}:regen`] === 1 && !ev.sends.bySlug[`${p.unrelated}:regen`] &&
          /description/.test(typed(p.cold)) && Boolean(lenM) && Number(lenM?.[1]) > 3000 && typed(p.autumn).includes('800~3000'), ev.sends.bySlug),
        exp('S11 cold·autumn 등록 2 · PR MERGED · 배포 · 장부 행 정리 (등록 성공 clearEntry)', ev.registered.length === 2 && ev.registered.every((r) => [p.cold, p.autumn].includes(r.slug)) && ev.prs.length >= 1 && ev.prs.every((x) => x.state === 'MERGED') && ev.deployments.length >= 1 && !led[p.cold] && !led[p.autumn], { registered: ev.registered, prs: ev.prs }),
        exp('S11 무관한 옛 행 — 대조 대상 아님 · REGEN_EXHAUSTED 로 멈춤 · 전송 0 · regenCalls 2 · 계보는 LEGACY 그대로', rows[p.unrelated]?.verdict === 'BLOCKED' && JSON.stringify(rows[p.unrelated]?.blockedBy ?? []).includes('REGEN_EXHAUSTED') &&
          led[p.unrelated]?.regenCalls === 2 && (!led[p.unrelated]?.regenLineage || led[p.unrelated].regenLineage.origin === 'LEGACY'), { row: rows[p.unrelated]?.blockedBy, led: led[p.unrelated] }),
        exp('S11 재실행 — 무관한 행은 여전히 소진 · 재생성 합계 그대로 2 (cold 1 · autumn 1)', ev.sends.regen === 2 && (ctx.afterFirstLedger?.[p.unrelated]?.regenCalls === 2) && led[p.unrelated]?.regenCalls === 2, { regen: ev.sends.regen }),
      ]
    },
  },

  S12: {
    title: '10/11 운영 후 상태 → 다음 회차 — gray(실제 slug · 수리 후 실제 brief · migration v1 한 사건) 는 00:10 producer 도 01:00 도 같은 일반 요청을 다시 보내지 않고, 장부 사유 대조로 교정 1 → 등록',
    async prepare(repo) {
      // 🔴 migration identity 는 정확히 한 사건이다 — 실제 slug · 수리 후 실제 brief 바이트(읽기 전용 복사 fixture) 그대로
      const L = await imp(repo, 'scripts/lib/magazine-load.mjs')
      const QL = await imp(repo, 'scripts/lib/magazine-queue-lock.mjs')
      const RQ = await imp(repo, 'scripts/fixtures/magazine-format-contract/repair-queue-rows.mjs')
      const slug = 'gray-hair-leave-as-is'
      /**
       * 🔴 큐 행은 고정 fixture 원문 — runtime 큐에서 gray 가 등록돼 빠져도(10/12 PR #690) 같은 시나리오다 (2026-10-12).
       *    sandbox 사본 큐에서만 그 행을 빼고 fixture 원문을 넣는다 — 실제 runtime 큐는 읽기만.
       */
      const qPath = join(repo, 'drafts', 'magazine', 'topic-queue.ts')
      let qsrc = readFileSync(qPath, 'utf8')
      const old = L.parseQueueSource(qsrc).find((q) => q.slug === slug)
      if (old) qsrc = QL.removeQueueDay(qsrc, old.day) ?? (() => { throw new Error(`sandbox 큐에서 ${slug} 행을 빼지 못했다`) })()
      writeFileSync(qPath, RQ.withFixtureRows(qsrc, [slug]).src)
      // 🔴 gray 가 이미 등록된 runtime(10/12 #690 뒤)에서도 같은 시나리오 — sandbox 사본 articles.ts 에서만 그 항목을 뺀다
      const aPath = join(repo, 'src', 'content', 'magazine', 'articles.ts')
      const iso = withoutArticle(readFileSync(aPath, 'utf8'), slug, (src) => L.parseArticlesSource(src))
      if (iso.removed) writeFileSync(aPath, iso.next)
      const item = L.parseQueueSource(readFileSync(qPath, 'utf8')).find((q) => q.slug === slug)
      if (JSON.stringify(item) !== JSON.stringify(RQ.fixtureQueue([slug])[0])) throw new Error(`sandbox 큐의 ${slug} 행이 fixture 와 다르다`)
      await curate({ repo, keep: [slug] })
      const fx = (n) => readFileSync(join(repo, 'scripts', 'fixtures', 'magazine-format-contract', `gray-hair-leave-as-is.repaired-2026-10-11.${n}`), 'utf8')
      writeSlugFiles({ repo, slug, files: { 'brief.md': fx('brief.md'), 'review.ts': fx('review.ts.txt') } })
      placeHero({ repo, slug })
      return { target: slug }
    },
    scenarioFor: () => ({ ci: {}, deploy: {} }),
    async afterBuild(sb, p, date) {
      // 🔴 운영 장부의 lastAt 그대로 — legacyLedgerKey 가 migration identity 와 정확히 같아야 한다 (시각을 회차 날짜에 맞추지 않는다)
      const prev = addDays(date, -1)
      const at = (hms) => Date.parse(`${prev}T${hms}+09:00`)
      // 🔴 운영 장부 gray 행 그대로 (2026-10-11 읽기 전용 진단 값)
      const store = { [p.target]: { kind: 'CONTENT', sent: true, attempts: 1, lastAt: 1791648177801, fingerprint: null,
        reasons: ['FETCH_FAILED: 회수 실패 — [validate] invalid_manuscript — FORMAT_VIOLATION: 1행: YAML frontmatter 가 없다. --- 로 시작해야 한다 · 전송 1건'],
        briefRepairs: [{ fingerprint: `sha256:${'9c3f20e6'.repeat(8)}`, outcome: 'APPLIED', providerCalls: 2, reservedAt: at('00:12:31'), settledAt: at('00:15:43') }], briefRepairCalls: 2 } }
      mkdirSync(dirname(ledgerPath(sb)), { recursive: true })
      writeFileSync(ledgerPath(sb), `${JSON.stringify(store, null, 2)}\n`)
      return { seeded: store }
    },
    async run(ctx) {
      ctx.stages.push(runStage(ctx.sb, { name: 'producer', entry: 'producer', kst: KST(ctx.date, '00:10') }))
      ctx.afterProducerLedger = readJson(ledgerPath(ctx.sb))?.[ctx.prepared.target] ?? null
      ctx.stages.push(runStage(ctx.sb, { name: 'register', entry: 'register', kst: KST(ctx.date, '01:00') }))
      ctx.applyResult = readJson(runFile(ctx.sb, ctx.date, /^auto-merge\.json$/)[0] ?? '')
      ctx.registerResult = readJson(runFile(ctx.sb, ctx.date, /^auto-register\.json$/)[0] ?? '')
    },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const prod = logOf(ctx, 'producer')
      const reg = logOf(ctx, 'register')
      const row = (ctx.registerResult?.results ?? []).find((r) => r.slug === t) ?? null
      const typed = ev.regenTyped.find((r) => r.slug === t)?.typed ?? ''
      return [
        exp('S12 00:10 producer — 일괄 계획이 교정 대기로 건너뛰었다 (전송·접근 확인 0 · 장부 쓰기 0)', !ev.sends.bySlug[`${t}:initial`] && prod.includes('건너뜀 (correction_pending)') &&
          JSON.stringify(ctx.afterProducerLedger) === JSON.stringify(ctx.prepared.seeded[t]), prod.split('\n').filter((l) => l.includes(t) || /교정 대기/.test(l)).slice(0, 3)),
        exp('S12 01:00 — 옛 장부 사유 대조 RECORDED(migration v1) → 교정 1 · 일반 요청 0 (하루 전체)', row?.lineageReconcile?.legacyInvalid === 'RECORDED' && ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 0 &&
          row?.lineageReconcile?.legacyInvalidMigration === 'legacy-invalid-first-response/gray-hair-leave-as-is/2026-10-11/v1' && reg.includes('legacy-invalid-first-response/gray-hair-leave-as-is/2026-10-11/v1'), { lr: row?.lineageReconcile, bySlug: ev.sends.bySlug }),
        exp('S12 교정 요청에 실제 위반 문장 그대로 (YAML frontmatter 가 없다 …)', typed.includes('[교정 요청]') && typed.includes('FORMAT_VIOLATION: 1행: YAML frontmatter 가 없다. --- 로 시작해야 한다'), typed.split('\n').filter((l) => /FIRST_RESPONSE|frontmatter/.test(l)).slice(0, 3)),
        exp('S12 등록 1 · PR MERGED · 배포 · 장부 행 정리', reg.includes('교정 재생성으로 원고 확보') && ev.registered.length === 1 && ev.registered[0].slug === t && ev.prs[0]?.state === 'MERGED' && ev.deployments.length === 1 && !ev.ledger?.[t], { registered: ev.registered }),
      ]
    },
  },

  S13: {
    title: 'cold 모양 QA 재생성 계약 — description 57자 + 발행 길이 초과 원고 · 지시받은 것만 고치는 응답 → 패킷이 두 위반과 목표치를 모두 실어 재생성 1회로 QA 통과 → 등록 (2026-10-12 cold-weather)',
    async prepare(repo, date) {
      const [t] = await pickTargets({ repo, date, selectable: 1 })
      await curate({ repo, keep: [t.slug] })
      const C = await imp(repo, 'scripts/lib/magazine-rehearsal-content.mjs')
      const pr = await templatePair({ repo, item: t })
      writeSlugFiles({ repo, slug: t.slug, files: { 'brief.md': pr.brief, 'review.ts': pr.review } })
      const draft = C.manuscriptFor({ repo, draftsDir: join(repo, 'drafts', 'magazine'), slug: t.slug, item: t, mode: 'cold-shape' })
      writeSlugFiles({ repo, slug: t.slug, files: { 'draft.md': draft } })
      placeHero({ repo, slug: t.slug })
      return { target: t.slug, draftSha: createHash('sha256').update(draft).digest('hex') }
    },
    scenarioFor: (p) => ({ ci: {}, deploy: {}, chatgpt: { [`${p.target}:regen`]: ['obedient', 'obedient'] } }),
    async run(ctx) { await normalDay(ctx) },
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const row = (ctx.registerResult?.results ?? []).find((r) => r.slug === t) ?? null
      const first = row?.regenHistory?.[0]?.failures ?? []
      const typed = ev.regenTyped.filter((r) => r.slug === t).map((r) => r.typed)
      return [
        exp('S13 최초 QA — description 57자 · 발행 길이 초과 두 위반 (cold 모양 재현)', first.some((x) => /description 57자 — 허용 60~160자 밖/.test(x)) && first.some((x) => /^BODY_TOO_LONG: 본문 \d+자/.test(x)), first),
        exp('S13 재생성 요청에 두 위반이 모두 실렸다 — description 줄 · 길이 목표("최소 N자를 줄인다") · 같은 계산법', typed.length >= 1 && /description 57자 — 허용 60~160자 밖/.test(typed[0]) && /최소 \d+자를 줄인다/.test(typed[0]) && typed[0].includes('공백·줄바꿈 포함'), (typed[0] ?? '').split('\n').filter((l) => /QA_FAIL|BODY_LENGTH/.test(l)).slice(0, 4)),
        exp('S13 재생성 1회로 QA 통과 (같은 실패 반복 0) · 일반 요청 0', ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 0 && (row?.regenHistory ?? []).length === 1, { bySlug: ev.sends.bySlug, history: row?.regenHistory }),
        exp('S13 등록 1 · PR MERGED · 배포 · 장부 행 정리', ev.registered.length === 1 && ev.registered[0].slug === t && ev.prs[0]?.state === 'MERGED' && ev.deployments.length === 1 && !ev.ledger?.[t], { registered: ev.registered }),
      ]
    },
  },

  S14: {
    title: 'cold 1회성 복구 — 10/12 운영 후 상태(attempts 2 · regenCalls 4 · 7일 격리) 그대로 · 원고 4파일 신원 일치 → 복구 개방 → #693 새 패킷(description · 길이 목표)으로 재생성 1회 → QA·등록·PR·병합·배포 (runtime 등록 모양)',
    ...coldRecoveryScenario('obedient', { registry: 'registered' }),
    expect: (ev, ctx) => coldRecoveryExpect('S14', 'registered', ev, ctx),
  },

  S14U: {
    title: 'S14 와 같은 과거 사건 — runtime articles.ts 에 cold 가 아직 없는 모양 (격리 no-op) 에서도 같은 결과',
    ...coldRecoveryScenario('obedient', { registry: 'unregistered' }),
    expect: (ev, ctx) => coldRecoveryExpect('S14U', 'unregistered', ev, ctx),
  },

  S14B: {
    title: 'cold 1회성 복구 — 후보가 다시 QA 실패 → 복구 1회만 쓰고 원본 draft·article 바이트 그대로 · 같은 날 재실행 provider 추가 0',
    ...coldRecoveryScenario('cold-shape', { rerun: true }),
    expect(ev, ctx) {
      const t = ctx.prepared.target
      const led = ev.ledger?.[t] ?? null
      const SD = join(ctx.sb.repo, 'drafts', 'magazine', t)
      const shaOf = (f) => (existsSync(join(SD, f)) ? createHash('sha256').update(readFileSync(join(SD, f))).digest('hex') : null)
      return [
        exp('S14B 준비 — sandbox 사본 articles.ts 에서 cold 격리 (runtime 사본 그대로 · 다른 글 순서·값 그대로)', ctx.prepared.isolation?.absentAfter === true && ctx.prepared.isolation?.othersKept === true,
          ctx.prepared.isolation && { shape: ctx.prepared.isolation.shape, removed: ctx.prepared.isolation.removed }),
        exp('S14B 복구 OPENED → 재생성 provider 정확히 1 (재실행 포함) · 일반 요청 0', ev.sends.bySlug[`${t}:regen`] === 1 && ev.sends.initial === 0, ev.sends.bySlug),
        exp('🔴 S14B 후보 QA 실패 → 원본 draft.md · article-draft.ts 바이트 그대로', shaOf('draft.md') === ctx.prepared.shas.draftSha256 && shaOf('article-draft.ts') === ctx.prepared.shas.articleSha256, { draft: shaOf('draft.md'), article: shaOf('article-draft.ts') }),
        exp('S14B 장부 — regenCalls 5 · 복구 계보 calls 1 · 다시 열리지 않음 · 등록 0', led?.regenCalls === 5 && led?.regenLineage?.origin === 'ONE_TIME_RECOVERY' && led.regenLineage.calls === 1 && ev.registered.length === 0 &&
          (ctx.rerunResult?.oneTimeRecoveries ?? []).every((r) => r.status !== 'OPENED'), { led: led && { regenCalls: led.regenCalls, lineage: led.regenLineage }, rerun: ctx.rerunResult?.oneTimeRecoveries }),
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
