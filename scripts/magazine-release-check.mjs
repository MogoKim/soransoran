#!/usr/bin/env node
/**
 * Magazine vNext S3-P2 — release writer · release gate · merge freeze 검사.
 *
 *   FZ  merge freeze 판정 경계 + legacy 01:00(runAutoMerge) · 02:00(runRecovery) 실제 함수 · vNext merge 직전
 *   RB  runtime 결속 생성 파일 = 실제 Bundle 재컴파일(저장소) · admission 이 같은 결속으로 출처를 대상으로 센다
 *   RA  조립(순수) — 고정점 · 층 순서 날짜 · stable slug · slot · 상한 · ProviderPlan 관문(실제 I-T6-03 INTERNAL_MARKER 포함)
 *   RG  PR 내용 관문(순수) — 무변조 통과 · 변조 반례 하나씩 · PR 관문(Draft · SHA · CI)
 *   RJ  journal + CAS (실제 파일 시스템) — 중간 사망 재실행 · CAS 경쟁 · 충돌 · hero 해시 · slug 기록 · writer 잠금
 *   RE  끝에서 끝 — 임시 bare origin + 실제 git(fetch · show · worktree · commit · push · merge) + 가짜 GitHub(PR · CI · merge 만)
 *       dry-run 쓰기 0 · Draft PR 1 · auto merge · 단계별 사망 재실행 · freeze · CI 실패 · 날짜 놓침 · 변조 PR · 낡은 base
 *   RS  재개 결속(순수) — 원본 commit · 바이트 · 검증된 원고 · hero · ProviderPlan 반례 하나씩
 *   RR  01:00 release ↔ 02:00 복구 — 같은 journal · 같은 PR · 새 PR 0 · 날짜 변경 · CI 지연 · freeze · 닫기 실패 · 중복 · 서빙 분리
 *   RB2 vNext 진입점의 legacy 모듈 도달 0 · legacy 상수와 같은 값
 *
 * 🔴 운영 runtime · 운영 장부 · 실제 GitHub · 네트워크 · Slack 0. HOME 은 시작하자마자 임시 폴더다. 외부 효과(GitHub)만 대역이다.
 * 마지막 줄: `release 검사: <pass> pass, <fail> fail`
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TMP = mkdtempSync(join(tmpdir(), 'release-check-'))
process.env.HOME = join(TMP, 'home') // 🔴 운영 상태 경로(Application Support)에 닿지 않는다
mkdirSync(process.env.HOME, { recursive: true })

const { makeWorld, articlesText, controlText, queueText } = await import('./__fixtures__/magazine/content-plan/world.mjs')
const { bootWorld, cleanupFixtureBootstrap } = await import('./__fixtures__/magazine/content-plan/bootstrap-fixture.mjs')
const { planInputRel } = await import('./lib/magazine-content-plan-input.mjs')
const CP = await import('./lib/magazine-content-plan.mjs')
const R = await import('./lib/magazine-release.mjs')
const J = await import('./lib/magazine-release-journal.mjs')
const RUN = await import('./lib/magazine-release-run.mjs')
const FZ = await import('./lib/magazine-merge-freeze.mjs')
const CAND = await import('./lib/magazine-release-candidates.mjs')
const { provenanceOverlay } = await import('../src/lib/magazine-provenance-rule.mjs')

// 변이는 전체 무변이 검사를 먼저 통과한 뒤, 각 결함을 검출해야 하는 사례를 실행한다.
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--case')) throw new Error('사용법: [--case ID]')
const selectedCase = args[1]
let selectedCount = 0
let pass = 0, fail = 0
const check = async (id, name, fn) => {
  if (selectedCase && id !== selectedCase && !(selectedCase === 'RE11' && id === 'RE3')) return
  if (id === selectedCase) selectedCount++
  try { await fn(); pass++; console.log(`PASS ${id} ${name}`) } catch (e) { fail++; console.log(`FAIL ${id} ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 400)}`) }
}
const assert = (ok, why) => { if (!ok) throw new Error(why) }
const codeOf = (fn) => { try { fn(); return 'OK' } catch (e) { return e.code ?? e.message } }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const KST = (s) => Date.parse(`${s}+09:00`)
const NOW = KST('2026-11-20T09:00:00')
const codes = (r) => (r.blockedBy ?? []).map((b) => b.code)

/** 합성 WebP — VP8X 머리말(크기만 정확하다). salt 로 바이트를 다르게 한다 */
const webp = (w = 1200, h = 675, salt = 'hero') => {
  const b = Buffer.alloc(30 + salt.length)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22 + salt.length, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii')
  b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); b.write(salt, 30, 'ascii')
  return b
}
const articleFor = (plan, over = {}) => ({
  schemaVersion: R.RELEASE_ARTICLE_SCHEMA, title: `합성 release 글 ${plan.intentId}`,
  description: '합성 설명 — release 검사가 쓰는 스무 글자가 넘는 요약 문장입니다.', heroAlt: '합성 hero 대체 문구', medical: false,
  body: [{ type: 'p', text: '합성 첫 문단' }, { type: 'h2', text: '합성 소제목' }, { type: 'p', text: '합성 둘째 문단' },
    { type: 'cta', href: plan.cta.communityDestination, label: '합성 이야기 나누기', text: '합성 CTA 문장' }],
  ...over,
})

// ── fixture world → Bundle ──────────────────────────────────
let wn = 0
async function fresh(mutate = () => {}) {
  const w = makeWorld(mkdtempSync(join(TMP, `w${wn++}-`)), mutate)
  const r = await bootWorld(w, { write: true })
  if (!r.ok) throw new Error(`fixture bootstrap 실패 ${r.code} ${r.why}`)
  const text = readFileSync(join(w.productRoot, planInputRel(w.graphVersion)), 'utf8')
  const compiled = CP.compileContentPlans({ bundle: text })
  const plan = (intentId) => compiled.plans.find((p) => p.intentId === intentId)
  return { w, text, compiled, plan, pid: (i) => `${w.graphVersion}:${i}` }
}
const mainOf = (F, over = {}) => ({
  bundle: over.bundle ?? F.text,
  controlText: over.controlText ?? controlText(F.w.graphVersion, over.control ?? F.w.seed.control),
  articlesText: over.articlesText ?? articlesText(over.articles ?? F.w.seed.articles),
  legacyQueue: over.legacyQueue ?? { active: true, text: queueText(over.queue ?? F.w.seed.queue) },
})
const providerHash = (F, plan, main = mainOf(F), nowMs = NOW) => CP.projectProviderPlan({ admission: { ...main, nowMs, inFlightIntentIds: [] }, planId: plan.planId, planHash: plan.planHash }).providerPlanHash
const candidateOf = (F, intentId, over = {}) => {
  const plan = F.plan(intentId)
  return { planId: plan.planId, planHash: plan.planHash, providerPlanHash: providerHash(F, plan), slugProposal: `fx-rel-${intentId.toLowerCase()}`,
    manuscriptSha256: sha256(Buffer.from(JSON.stringify(over.article ?? articleFor(plan)))), article: articleFor(plan), hero: { sha256: sha256(webp(1200, 675, intentId)), width: 1200, height: 675 }, ...over }
}
const assemble = (F, cands, over = {}) => R.assembleRelease({
  ...mainOf(F, over), nowMs: over.nowMs ?? NOW, candidates: cands, slugRecords: over.slugRecords ?? {}, occupied: over.occupied ?? { dates: [], slugs: [] },
  existingHeroSlugs: over.existingHeroSlugs ?? [], targetCandidates: over.targetCandidates ?? 5, baseSha: over.baseSha ?? null,
})
/** 조립 결과 → PR head 사실(순수 gate 입력) */
const headOf = (rel, mutate = (h) => h) => mutate({
  articlesText: rel.articles.afterText,
  planTexts: Object.fromEntries(rel.files.filter((f) => typeof f.text === 'string').map((f) => [f.path, f.text])),
  heroPresent: Object.fromEntries(rel.files.filter((f) => f.heroSha256).map((f) => [f.path, true])),
})
const gate = (F, rel, { head = headOf(rel), changedFiles = [R.ARTICLES_PATH, ...rel.files.map((f) => f.path)], occupied = { dates: [], slugs: [] }, nowMs = NOW, main = {} } = {}) => {
  const m = mainOf(F, main)
  return R.judgeReleaseContent({ main: { ...m, bindingText: main.bindingText ?? R.renderBindingFile(CP.releaseBindingOf(CP.compileContentPlans({ bundle: m.bundle }))) },
    head, changedFiles, occupied, nowMs })
}

let F = null
try {
  F = await fresh()
  const ALL = ['I-F1-01', 'I-F2-01', 'I-F2-02']

  // ════ FZ — merge freeze ════════════════════════════════════
  await check('FZ1', 'freeze 창 경계 — [20:00, 02:30) KST 두 밤만 막고 그 밖은 연다 · 시각 불명 · 표 손상은 막는다', () => {
    const at = (s) => FZ.judgeMergeFreeze(KST(s))
    // 두 창 각각의 네 경계 — 19:59:59 열림 · 20:00:00 막힘 · 다음 날 02:29:59 막힘 · 02:30:00 열림
    const open = ['2026-11-24T19:59:59', '2026-11-24T19:59:59.999', '2026-11-25T02:30:00', '2026-11-25T12:00:00', '2026-11-25T19:59:59', '2026-11-25T19:59:59.999', '2026-11-26T02:30:00',
      '2026-11-27T01:00:00', '2026-11-26T20:00:00', '2026-11-23T23:00:00']
    const shut = ['2026-11-24T20:00:00', '2026-11-24T21:00:00', '2026-11-24T22:00:00', '2026-11-25T01:00:00', '2026-11-25T02:00:00', '2026-11-25T02:29:59', '2026-11-25T02:29:59.999',
      '2026-11-25T20:00:00', '2026-11-25T21:59:59', '2026-11-26T01:00:00', '2026-11-26T02:29:59', '2026-11-26T02:29:59.999']
    for (const s of open) assert(!at(s).frozen, `${s} 를 막았다`)
    for (const s of shut) assert(at(s).frozen && at(s).code === 'MERGE_FREEZE_WINDOW', `${s} 를 열었다`)
    assert(at('2026-11-24T20:00:00').window.id === 'freeze-2026-11-24-night' && at('2026-11-25T20:00:00').window.id === 'freeze-2026-11-25-night', '창 id')
    assert(FZ.judgeMergeFreeze(NaN).code === 'MERGE_FREEZE_CLOCK_INVALID' && FZ.judgeMergeFreeze(undefined).frozen, '시각 불명을 열었다')
    assert(FZ.judgeMergeFreeze(KST('2026-12-01T01:00:00'), [{ id: 'x', startAt: '2026-02-30T22:00:00+09:00', endAt: '2026-03-01T02:30:00+09:00' }]).code === 'MERGE_FREEZE_TABLE_INVALID', '깨진 창 표를 열었다')
    assert(FZ.judgeMergeFreeze(KST('2026-12-01T01:00:00'), [{ id: 'x', startAt: '2026-12-02T02:30:00+09:00', endAt: '2026-12-02T02:30:00+09:00' }]).code === 'MERGE_FREEZE_TABLE_INVALID', '끝 ≤ 시작 창을 받았다')
    // 한시 제약 — 창은 두 밤뿐이다(영구 야간 제한이 아니다)
    assert(FZ.MAGAZINE_MERGE_FREEZE_WINDOWS.map((w) => `${w.startAt}~${w.endAt}`).join() === '2026-11-24T20:00:00+09:00~2026-11-25T02:30:00+09:00,2026-11-25T20:00:00+09:00~2026-11-26T02:30:00+09:00', '창 표가 창업자 승인 값과 다르다')
  })

  // legacy 01:00 · 02:00 — 실제 runAutoMerge · runRecovery (가짜 git · gh · 배포만)
  {
    const AM = await import('./magazine-auto-merge.mjs')
    const MG = await import('./lib/magazine-merge-gate.mjs')
    const BASE = 'a'.repeat(40), HEAD = 'b'.repeat(40), MERGED = 'c'.repeat(40), LIVE = 'dpl_FREEZE00000000000000000'
    const ART = (rows) => ['export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = {',
      ...rows.map((r) => `  '${r.slug}': { title: ${JSON.stringify(r.slug)}, publishedAt: '${r.publishAt.slice(0, 10)}', status: 'SCHEDULED', publishAt: '${r.publishAt}', heroImage: { src: '/magazine/${r.slug}/hero.webp' } },`), '}'].join('\n')
    const QUE = (rows) => ['export const TOPIC_QUEUE: TopicQueueItem[] = [',
      ...rows.map((r) => `  { slug: '${r.slug}', title: '시험 글은 왜 그런가요', cluster: 'daily', validationProfile: 'STANDARD', riskLevel: 'LOW', autoEligible: true },`), ']'].join('\n')
    const MAIN_ART = [{ slug: 'old-one', publishAt: '2026-11-20T10:30:00+09:00' }]
    const BRANCH_ART = [...MAIN_ART, { slug: 'new-fz', publishAt: '2026-11-28T10:30:00+09:00' }]
    const PR = { number: 900, url: 'https://example.invalid/900', headRefName: `${MG.AUTO_BRANCH_PREFIX}2026-11-25-010012`, headRefOid: HEAD, baseRefName: 'main', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
    const deps = (startAt) => {
      let t = startAt
      const calls = []
      return { calls, log: () => {}, now: () => t, sleep: async (ms) => { t += ms }, fetchMain: () => true, readBaseSha: () => BASE,
        showFile: (sha, p) => (p.endsWith('articles.ts') ? ART(sha === BASE ? MAIN_ART : BRANCH_ART) : QUE(sha === BASE ? [{ slug: 'new-fz' }, { slug: 'keep' }] : [{ slug: 'keep' }])),
        listAutoPrs: () => ({ ok: true, prs: [{ ...PR }] }), getPr: () => ({ ...PR }),
        listPrFiles: () => ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/new-fz/draft.md', 'public/magazine/new-fz/hero.webp'],
        getChecks: () => ({ ok: true, ciState: 'success', checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }] }),
        mergePr: (n, sha) => { calls.push(`merge:${n}:${sha.slice(0, 4)}`); return { ok: true, mergeCommit: MERGED } },
        getProductionDeployment: (sha) => ({ found: true, state: 'success', sha, deploymentId: LIVE }), liveDeploymentId: () => LIVE, httpStatus: () => 404, httpBody: () => '' }
    }
    const merges = (d) => d.calls.filter((c) => c.startsWith('merge:')).length
    await check('FZ2', 'legacy 01:00 --apply(runAutoMerge) — 창 안이면 모든 관문을 통과해도 merge 0 · MERGE_FREEZE_WINDOW · 창 밖은 그대로 merge', async () => {
      for (const s of ['2026-11-24T20:00:00', '2026-11-24T21:00:00', '2026-11-25T01:00:00', '2026-11-25T02:29:59', '2026-11-25T20:00:00', '2026-11-26T01:00:00', '2026-11-26T02:29:59']) {
        const d = deps(KST(s)); const r = await AM.runAutoMerge({ apply: true, deps: d })
        assert(merges(d) === 0 && codes(r).join() === 'MERGE_FREEZE_WINDOW' && r.merged !== true, `${s}: merge ${merges(d)} · ${codes(r)}`)
      }
      for (const s of ['2026-11-24T19:59:59', '2026-11-25T02:30:00', '2026-11-25T19:59:59', '2026-11-26T02:30:00', '2026-11-27T01:00:00']) {
        const d = deps(KST(s)); const r = await AM.runAutoMerge({ apply: true, deps: d })
        assert(merges(d) === 1 && r.merged === true && codes(r).length === 0, `${s}: 창 밖인데 막았다 ${codes(r)}`)
      }
    })
    await check('FZ3', 'legacy 02:00 --recover(runRecovery) — 창 안 merge 0 · 창 밖 merge 1 (같은 관문)', async () => {
      const lock = () => ({ ok: true, code: 'FREE', message: '', release: () => {} })
      const d1 = deps(KST('2026-11-25T02:00:00')); const r1 = await AM.runRecovery({ deps: d1, initial: null, acquire: lock })
      const d2 = deps(KST('2026-11-27T02:00:00')); const r2 = await AM.runRecovery({ deps: d2, initial: null, acquire: lock })
      assert(merges(d1) === 0 && JSON.stringify(r1).includes('MERGE_FREEZE_WINDOW'), `창 안 복구 merge ${merges(d1)}`)
      assert(merges(d2) === 1, `창 밖 복구 merge ${merges(d2)} ${JSON.stringify(r2.blockedBy)}`)
    })
    await check('FZ4', 'freeze 판정은 merge 호출 바로 앞 한 곳 — legacy · vNext 모두 그 뒤에 다른 관문이 없다', () => {
      const am = readFileSync(join(ROOT, 'scripts/magazine-auto-merge.mjs'), 'utf8')
      const i = am.indexOf('const freeze = judgeMergeFreeze(now())'), j = am.indexOf('const merged = deps.mergePr(pr0.number, sha)')
      assert(i > 0 && j > i && am.slice(i, j).split('\n').length <= 3 && am.split('judgeMergeFreeze(').length - 1 === 1, 'legacy: freeze 가 merge 바로 앞이 아니다')
      const rr = readFileSync(join(ROOT, 'scripts/lib/magazine-release-run.mjs'), 'utf8')
      const a = rr.indexOf('const freeze = judgeMergeFreeze(deps.now())'), b = rr.indexOf('const merged = deps.mergePr(pr0.number, pr0.headRefOid)')
      assert(a > 0 && b > a && rr.slice(a, b).split('\n').length <= 3 && rr.split('deps.mergePr(').length - 1 === 1, 'vNext: freeze 가 merge 바로 앞이 아니다')
    })
    await check('FZ5', '🔴 main 을 바꾸는 매거진 경로 전수 — `gh pr merge` 를 조립하는 파일마다 merge 호출이 정확히 한 곳이고 그 바로 앞이 freeze 판정이다(새 경로가 freeze 없이 생기지 않는다)', () => {
      const files = [...readdirSync(join(ROOT, 'scripts')).filter((f) => /^magazine-.*\.(mjs|mts)$/.test(f)).map((f) => `scripts/${f}`),
        ...readdirSync(join(ROOT, 'scripts/lib')).filter((f) => /^(magazine|mgraph)-.*\.mjs$/.test(f)).map((f) => `scripts/lib/${f}`)]
      const isCheck = (f) => /-(check|mutation|rehearsal)[.-]|rehearsal/.test(f)
      // 실제 병합 명령을 조립하는 운영 파일 — 검사 · 변이 · 리허설 하네스는 뺀다
      const merging = files.filter((f) => !isCheck(f) && /\['pr', 'merge'/.test(readFileSync(join(ROOT, f), 'utf8')))
      assert(JSON.stringify(merging.sort()) === JSON.stringify(['scripts/lib/magazine-release-run.mjs', 'scripts/magazine-auto-merge.mjs', 'scripts/magazine-graph-merge.mts']),
        `병합 명령을 조립하는 파일이 바뀌었다 — freeze 를 붙였는지 확인하고 이 목록에 더한다: ${merging}`)
      for (const f of merging) {
        const src = readFileSync(join(ROOT, f), 'utf8')
        const calls = [...src.matchAll(/^.*\bdeps\.mergePr\(.*$/gm)]
        assert(calls.length === 1 && src.split("['pr', 'merge'").length - 1 === 1, `${f}: merge 호출 · 명령 조립이 한 곳이 아니다(${calls.length})`)
        const before = src.slice(0, calls[0].index).trimEnd().split('\n').slice(-2).join('\n')
        assert(/const freeze = judgeMergeFreeze\(/.test(before) && /if \(freeze\.frozen\)/.test(before), `${f}: merge 호출 바로 앞 두 줄이 freeze 판정이 아니다 — ${before}`)
        assert(/from '\.\/(lib\/)?magazine-merge-freeze\.mjs'/.test(src), `${f}: freeze 판정을 한 곳(magazine-merge-freeze)에서 가져오지 않는다`)
      }
    })
  }

  // ════ RB — 결속 ════════════════════════════════════════════
  await check('RB1', '저장소 runtime 결속 파일 = 지금 graph 판 Bundle 재컴파일 결과(바이트) · 판 = control', async () => {
    const { expectedBindingText } = await import('./magazine-release-binding.mjs')
    const r = expectedBindingText(ROOT)
    assert(r.ok && r.current === r.expected, `결속 파일이 낡았다(${r.code ?? 'STALE'}) — node scripts/magazine-release-binding.mjs --write`)
    const ctrl = CP.strictControlGraphVersion(readFileSync(join(ROOT, 'src/content/magazine/graph/control.ts'), 'utf8'))
    assert(r.graphVersion === ctrl && r.expected.includes(`"graphVersion": "${ctrl}"`), '결속 판이 control 과 다르다')
  })
  await check('RB2', 'admission 이 정확한 결속으로 공개된 vNext 출처를 대상으로 센다 · 위조 출처는 0 (두 층 같은 결속)', () => {
    const rel = assemble(F, [candidateOf(F, 'I-F1-01')], { targetCandidates: 1 })
    assert(rel.ok && rel.members.length === 1, `전제 ${rel.code}`)
    const slug = rel.members[0].slug
    // 공개 시각이 지난 뒤 — 출처 slug 가 I-F1-01 의 공개 글로 센다(같은 공유 규칙 · 같은 결속)
    const after = rel.articles.afterText
    const later = KST('2026-12-01T09:00:00')
    const ids = CP.parseArticleIdentityText(after)
    const B = JSON.parse(F.text)
    const ov = provenanceOverlay({ canonical: B.mappings.map((m) => ({ intent: m.intentId, slug: m.slug })), graphIntentIds: B.intents.map((x) => x.intentId),
      rows: ids.rows.filter((r) => r.release).map((r) => ({ slug: r.slug, release: r.release })), binding: CP.releaseBindingOf(F.compiled) })
    assert(JSON.stringify(ov) === JSON.stringify([{ intent: 'I-F1-01', slug }]), `overlay ${JSON.stringify(ov)}`)
    const a = CP.admitContentPlans({ ...mainOf(F, { articlesText: after }), nowMs: later })
    assert(a.held.find((h) => h.intentId === 'I-F1-01')?.reasons.join() === 'DUPLICATE_RELEASED_INTENT', '출시된 intent 를 다시 받았다')
    const forged = after.replace(rel.members[0].planHash, 'f'.repeat(64))
    const ov2 = provenanceOverlay({ canonical: B.mappings.map((m) => ({ intent: m.intentId, slug: m.slug })), graphIntentIds: B.intents.map((x) => x.intentId),
      rows: CP.parseArticleIdentityText(forged).rows.filter((r) => r.release).map((r) => ({ slug: r.slug, release: r.release })), binding: CP.releaseBindingOf(F.compiled) })
    assert(ov2.length === 0, '위조 planHash 출처를 썼다')
  })

  // ════ RA — 조립 ════════════════════════════════════════════
  await check('RA1', '조립 — 1층 둘(I-F1-01 · I-F2-02) · 2층 하나(I-F2-01, 같은 release 대상 I-F2-02 가 먼저) · 내일부터 빈 날 · canonical/제안 slug · 결정적', () => {
    const cands = ALL.map((i) => candidateOf(F, i))
    const rel = assemble(F, cands)
    assert(rel.ok, `${rel.code} ${JSON.stringify(rel.withdrawn)}`)
    const by = Object.fromEntries(rel.members.map((m) => [m.intentId, m]))
    assert(rel.members.map((m) => m.intentId).join() === 'I-F1-01,I-F2-02,I-F2-01', `순서 ${rel.members.map((m) => m.intentId)}`)
    assert(by['I-F2-01'].layer === 2 && by['I-F2-02'].layer === 1 && by['I-F2-01'].groundedBy.some((g) => g.target === 'SAME_RELEASE'), '층')
    assert(rel.members.map((m) => m.publishAt).join() === '2026-11-21T10:30:00+09:00,2026-11-22T10:30:00+09:00,2026-11-23T10:30:00+09:00', `날짜 ${rel.members.map((m) => m.publishAt)}`)
    assert(by['I-F2-02'].slug === 'fx-queued' && by['I-F2-02'].slugSource === 'CANONICAL' && by['I-F1-01'].slugSource === 'PROPOSAL', 'slug 출처')
    const again = assemble(F, [...cands].reverse())
    assert(again.articles.afterText === rel.articles.afterText && again.releaseId === rel.releaseId && JSON.stringify(again.files) === JSON.stringify(rel.files), '입력 순서에 따라 바이트가 바뀐다')
    const before = articlesText(F.w.seed.articles)
    const close = R.parseArticleRecordText(before).span.end - 1
    assert(rel.articles.afterText.startsWith(before.slice(0, close).trimEnd()) && rel.articles.afterText.endsWith(before.slice(close)), '레코드 밖 바이트가 바뀌었다')
    for (const m of rel.members) assert(rel.files.find((f) => f.path === R.planFilePath(m.slug))?.text === R.renderPlanFile(F.plan(m.intentId)), `${m.slug} plan 파일`)
    assert(!/publishAt|slug/.test(Object.keys(F.plan('I-F1-01')).join()), 'ContentPlan 에 날짜 · slug 가 들어갔다')
  })
  await check('RA2', '출판 최소 고정점 — 같은 release 대상(I-F2-02)이 빠지면 I-F2-01 도 빠진다 · 다른 후보는 그대로 · 빠진 것은 검증됨(재조립 대상)', () => {
    const bad = candidateOf(F, 'I-F2-02', { article: articleFor(F.plan('I-F2-02'), { body: [{ type: 'p', text: '짧다' }] }) })
    const rel = assemble(F, [candidateOf(F, 'I-F1-01'), bad, candidateOf(F, 'I-F2-01')])
    assert(rel.ok && rel.members.map((m) => m.intentId).join() === 'I-F1-01', `members ${rel.members.map((m) => m.intentId)}`)
    const w = Object.fromEntries(rel.withdrawn.map((x) => [x.planId.split(':')[1], x.reasons.join()]))
    assert(/^ARTICLE_INVALID/.test(w['I-F2-02']) && /^ADMISSION_HELD:(SAME_RELEASE_UNGROUNDED|RELATION_TARGET_UNAVAILABLE)/.test(w['I-F2-01']), JSON.stringify(w))
  })
  await check('RA3', 'targetCandidates 상한 — 낮은 층부터 · 상한으로 빠진 후보는 TARGET_CANDIDATES_CAP(다음 release) · 2층은 대상이 남을 때만', () => {
    const cands = ALL.map((i) => candidateOf(F, i))
    const one = assemble(F, cands, { targetCandidates: 1 })
    const two = assemble(F, cands, { targetCandidates: 2 })
    assert(one.members.map((m) => m.intentId).join() === 'I-F1-01' && two.members.map((m) => m.intentId).join() === 'I-F1-01,I-F2-02', `${one.members.map((m) => m.intentId)} / ${two.members.map((m) => m.intentId)}`)
    assert(two.withdrawn.find((x) => x.planId.endsWith('I-F2-01'))?.reasons.some((r) => r === 'TARGET_CANDIDATES_CAP'), JSON.stringify(two.withdrawn))
  })
  await check('RA4', 'stable slug — 기록된 slug 가 이긴다(제안이 바뀌어도) · canonical 과 다른 기록은 멈춘다 · 이미 쓰인 slug 는 접미사 없이 그 후보만 뺀다', () => {
    const c = candidateOf(F, 'I-F1-01', { slugProposal: 'fx-rel-other-name' })
    const rec = assemble(F, [c], { slugRecords: { 'I-F1-01': { intentId: 'I-F1-01', slug: 'fx-rel-stable' } } })
    assert(rec.members[0]?.slug === 'fx-rel-stable' && rec.members[0].slugSource === 'RECORDED', `기록 ${rec.members[0]?.slug}`)
    const conflict = assemble(F, [candidateOf(F, 'I-F2-02')], { slugRecords: { 'I-F2-02': { intentId: 'I-F2-02', slug: 'fx-not-canonical' } } })
    assert(!conflict.ok && conflict.withdrawn[0].reasons.join() === 'SLUG_RECORD_CANONICAL_CONFLICT', JSON.stringify(conflict.withdrawn))
    for (const [label, over, want] of [
      ['main 글', { articles: [...F.w.seed.articles, { slug: 'fx-rel-i-f1-01', title: '합성 다른 글', cluster: 'money-work', publishAt: '2026-11-02T10:30:00+09:00' }] }, 'SLUG_TAKEN:MAIN_ARTICLE'],
      ['legacy queue', { queue: [...F.w.seed.queue, { slug: 'fx-rel-i-f1-01', title: '합성 다른 큐 주제', cluster: 'family' }] }, 'SLUG_TAKEN:LEGACY_QUEUE'],
      ['열린 PR', { occupied: { dates: [], slugs: ['fx-rel-i-f1-01'] } }, 'SLUG_TAKEN:OPEN_PR'],
      ['main hero 폴더', { existingHeroSlugs: ['fx-rel-i-f1-01'] }, 'SLUG_TAKEN:MAIN_HERO'],
      ['다른 intent 의 canonical', { slugProposal: 'fx-next' }, 'SLUG_TAKEN:CANONICAL_OTHER_INTENT'],
    ]) {
      const cand = over.slugProposal ? candidateOf(F, 'I-F1-01', { slugProposal: over.slugProposal }) : candidateOf(F, 'I-F1-01')
      const r = assemble(F, [cand], over)
      assert(!r.ok && r.withdrawn[0]?.reasons.join() === want, `${label}: ${JSON.stringify(r.withdrawn)}`)
    }
    const dup = assemble(F, [candidateOf(F, 'I-F1-01', { slugProposal: 'fx-rel-same' }), candidateOf(F, 'I-F2-01', { slugProposal: 'fx-rel-same' }), candidateOf(F, 'I-F2-02')])
    assert(dup.withdrawn.some((x) => x.reasons.includes('SLUG_TAKEN:SAME_RELEASE')), JSON.stringify(dup.withdrawn))
    assert(R.bindReleaseSlug({ intentId: 'I', canonicalSlugs: ['a-one', 'b-two'], recorded: null, proposal: 'c-three' }).code === 'SLUG_CANONICAL_AMBIGUOUS', 'canonical 둘을 골랐다')
    for (const bad of ['UPPER', 'a', 'a--b', '-a', 'a_b', 'ok-slug-'.repeat(12)]) assert(!R.isValidSlug(bad), `${bad} 를 받았다`)
  })
  await check('RA5', '날짜 slot — main · 열린 PR 이 쓴 날을 건너뛴다 · 날짜를 놓쳐 다시 조립해도 planHash 불변(날짜만 바뀐다)', () => {
    const cands = ALL.map((i) => candidateOf(F, i))
    const r = assemble(F, cands, { occupied: { dates: ['2026-11-21', '2026-11-23'], slugs: [] },
      articles: [...F.w.seed.articles, { slug: 'fx-other-sched', title: '합성 예약 글', cluster: 'family', publishAt: '2026-11-22T10:30:00+09:00' }] })
    assert(r.members.map((m) => m.publishAt.slice(0, 10)).join() === '2026-11-24,2026-11-25,2026-11-26', r.members.map((m) => m.publishAt).join())
    const later = assemble(F, cands, { nowMs: KST('2026-11-24T12:00:00') })
    assert(later.members.map((m) => m.planHash).join() === assemble(F, cands).members.map((m) => m.planHash).join() && later.members[0].publishAt === '2026-11-25T10:30:00+09:00', '날짜를 놓쳐 다시 조립했더니 planHash 가 바뀌었다')
  })
  await check('RA6', '후보 반례 — 낡은 planHash · 컴파일 안 되는 plan · 원고 모양 · CTA 목적지 · 금지어 · image 블록 · hero 크기 · 같은 plan 두 번', () => {
    const p = F.plan('I-F1-01')
    const cases = [
      ['PLAN_STALE', candidateOf(F, 'I-F1-01', { planHash: 'e'.repeat(64) })],
      ['PLAN_NOT_COMPILED', candidateOf(F, 'I-F1-01', { planId: `${F.w.graphVersion}:I-F5-01` })],
      ['ARTICLE_INVALID:ARTICLE_SCHEMA', candidateOf(F, 'I-F1-01', { article: { ...articleFor(p), slug: 'x' } })],
      ['ARTICLE_INVALID:ARTICLE_CTA_DESTINATION', candidateOf(F, 'I-F1-01', { article: articleFor(p, { body: [...articleFor(p).body.slice(0, 3), { type: 'cta', href: '/community/menopause', label: '다른 곳' }] }) })],
      ['ARTICLE_INVALID:ARTICLE_TEXT_FORBIDDEN', candidateOf(F, 'I-F1-01', { article: articleFor(p, { title: '합성 시니어 이야기' }) })],
      ['ARTICLE_INVALID:ARTICLE_BLOCK_TYPE', candidateOf(F, 'I-F1-01', { article: articleFor(p, { body: [...articleFor(p).body, { type: 'image', image: {} }] }) })],
      ['HERO_INVALID', candidateOf(F, 'I-F1-01', { hero: { sha256: 'a'.repeat(64), width: 1200, height: 800 } })],
    ]
    for (const [want, c] of cases) {
      const r = assemble(F, [c])
      assert(!r.ok && r.withdrawn[0]?.reasons.join().startsWith(want), `${want}: ${JSON.stringify(r.withdrawn)}`)
    }
    const twice = assemble(F, [candidateOf(F, 'I-F1-01'), candidateOf(F, 'I-F1-01')])
    assert(twice.members.length === 1 && twice.withdrawn.some((x) => x.reasons.includes('CANDIDATE_DUPLICATE')), '같은 plan 을 두 번 냈다')
  })
  await check('RA7', '🔴 ProviderPlan 관문을 완화하지 않는다 — fixture 내부 표식 · 실제 저장소 I-T6-03(INTERNAL_MARKER) 모두 release 0', async () => {
    const G = await fresh((s) => { s.intents.find((x) => x.intentId === 'I-F1-01').exclusions.push('🔴 합성 내부 표식') })
    const p = G.plan('I-F1-01')
    const r = R.assembleRelease({ ...mainOf(G), nowMs: NOW, candidates: [{ planId: p.planId, planHash: p.planHash, providerPlanHash: null, slugProposal: 'fx-rel-marker', article: articleFor(p), hero: { sha256: 'a'.repeat(64), width: 1200, height: 675 } }],
      slugRecords: {}, occupied: { dates: [], slugs: [] }, existingHeroSlugs: [], targetCandidates: 1 })
    assert(!r.ok && r.withdrawn[0].reasons.join() === 'PROVIDER_PLAN_HOLD:INTERNAL_MARKER', JSON.stringify(r.withdrawn))
    // 11/02 입력의 내부 표식 회귀를 고정한다. 현재 배포 판은 RB1에서 독립적으로 검증한다.
    const real = {
      bundle: readFileSync(join(ROOT, 'src/content/magazine/plan-input/g-20261102-427d4d.json'), 'utf8'),
      controlText: controlText('g-20261102-427d4d', { ...F.w.seed.control, enabledClusters: ['sleep', 'family', 'money-work'] }),
      articlesText: articlesText([{ slug: 'certificate-in-50s', title: '자격증 시험을 준비할 때', cluster: 'money-work', publishAt: '2026-10-01T10:30:00+09:00' }]),
      legacyQueue: { active: true, text: queueText([]) },
    }
    const rc = CP.compileContentPlans({ bundle: real.bundle })
    const t603 = rc.plans.find((x) => x.intentId === 'I-T6-03')
    assert(t603, '전제 — I-T6-03 이 컴파일된다')
    const rr = R.assembleRelease({ ...real, nowMs: NOW, candidates: [{ planId: t603.planId, planHash: t603.planHash, providerPlanHash: null, slugProposal: 'resume-at-this-age', article: articleFor(t603), hero: { sha256: 'a'.repeat(64), width: 1200, height: 675 } }],
      slugRecords: {}, occupied: { dates: [], slugs: [] }, existingHeroSlugs: [], targetCandidates: 1 })
    assert(!rr.ok && rr.withdrawn[0].reasons.join() === 'PROVIDER_PLAN_HOLD:INTERNAL_MARKER', `실제 I-T6-03: ${JSON.stringify(rr.withdrawn)}`)
  })

  // ════ RG — PR 내용 관문 · PR 관문 ═══════════════════════════
  const REL3 = assemble(F, ALL.map((i) => candidateOf(F, i)))
  await check('RG1', '무변조 release PR — main 재컴파일 · 결속 · admission 재판정 · 날짜 · 파일 모양 통과', () => {
    const g = gate(F, REL3)
    assert(g.ok && g.members.length === 3, JSON.stringify(g.blockedBy))
  })
  const swap = (text, a, b) => text.split(a).join('\u0000').split(b).join(a).split('\u0000').join(b)
  const m0 = REL3.members[0], m1 = REL3.members[1], m2 = REL3.members[2]
  const TAMPER = [
    ['PLAN_HASH_MISMATCH', 'PR 행의 planHash 를 바꾼다', { head: headOf(REL3, (h) => ({ ...h, articlesText: h.articlesText.replace(m0.planHash, 'f'.repeat(64)) })) }],
    ['PLAN_FILE_MISMATCH', 'PR 의 ContentPlan 파일을 고친다(관계 이유)', { head: headOf(REL3, (h) => ({ ...h, planTexts: { ...h.planTexts, [R.planFilePath(m0.slug)]: h.planTexts[R.planFilePath(m0.slug)].replace('합성 이력서 자격 칸', '합성 고친 이유') } })) }],
    ['EXISTING_ARTICLE_TOUCHED', '기존 글 제목을 바꾼다', { head: headOf(REL3, (h) => ({ ...h, articlesText: h.articlesText.replace('합성 공개 글 — 자격증', '합성 공개 글 — 고침') })) }],
    ['UNEXPECTED_FILES', '허용 밖 파일을 더한다', { changedFiles: [R.ARTICLES_PATH, ...REL3.files.map((f) => f.path), 'scripts/lib/magazine-release.mjs'] }],
    ['MISSING_FILES', 'hero 를 바꾸지 않는다', { changedFiles: [R.ARTICLES_PATH, ...REL3.files.filter((f) => !f.heroSha256).map((f) => f.path)] }],
    ['HERO_FILE_ABSENT', 'head 에 hero 가 없다', { head: headOf(REL3, (h) => ({ ...h, heroPresent: {} })) }],
    ['DUPLICATE_DATE_IN_MAIN', 'main 에 같은 날 예약 글이 생겼다(PR 이 그 main 위에 있어도)', (() => {
      const arts = [...F.w.seed.articles, { slug: 'fx-x', title: '합성 겹친 날', cluster: 'family', publishAt: '2026-11-22T10:30:00+09:00' }]
      const rec = R.parseArticleRecordText(REL3.articles.afterText)
      const rows = rec.slugs.slice(F.w.seed.articles.length).map((slug) => ({ slug, body: rec.record[slug] }))
      return { main: { articles: arts }, head: headOf(REL3, (h) => ({ ...h, articlesText: R.insertArticleRows(articlesText(arts), rows) })) }
    })()],
    ['DUPLICATE_DATE_OPEN_PR', '다른 열린 PR 이 같은 날', { occupied: { dates: ['2026-11-21'], slugs: [] } }],
    ['PUBLISH_AT_PAST', 'merge 시각이 공개 시각을 지났다', { nowMs: KST('2026-11-21T11:00:00') }],
    ['SAME_RELEASE_ORDER', '같은 release 대상보다 먼저 공개되게 날짜를 바꾼다', { head: headOf(REL3, (h) => ({ ...h, articlesText: swap(h.articlesText, m1.publishAt.slice(0, 10), m2.publishAt.slice(0, 10)) })) }],
    ['PUBLIC_BINDING_MISMATCH', 'main 의 runtime 결속 파일이 낡았다', { main: { bindingText: R.renderBindingFile(null) } }],
    ['PUBLIC_BINDING_MISMATCH', 'control 판이 Bundle 판과 다르다', { main: { controlText: controlText('g-20990101-abcdef', F.w.seed.control) } }],
    ['ADMISSION_HELD', 'merge 직전 main 상태에서 admission 이 막는다(queue 에 같은 intent)', { main: { queue: [...F.w.seed.queue, { slug: 'fx-q-dup', title: '합성 다른 제목', cluster: 'money-work', intentId: 'I-F1-01' }] } }],
    ['ADMISSION_HELD', 'kill switch', { main: { control: { ...F.w.seed.control, killSwitch: { tripped: true, trippedAt: '2026-11-20T00:00:00Z', trippedBy: 'x', reason: 'x' } } } }],
    ['CLUSTER_MISMATCH', '행의 cluster 를 바꾼다', { head: headOf(REL3, (h) => ({ ...h, articlesText: h.articlesText.replace(`"cluster": "money-work",\n    "publishedAt": "${m0.publishAt.slice(0, 10)}"`, `"cluster": "family",\n    "publishedAt": "${m0.publishAt.slice(0, 10)}"`) })) }],
    ['STATUS_UNEXPECTED', '행을 PUBLISHED 로 바꾼다', { head: headOf(REL3, (h) => ({ ...h, articlesText: h.articlesText.replace('"status": "SCHEDULED"', '"status": "PUBLISHED"') })) }],
    ['RELEASE_PROVENANCE_MISSING', '출처 없는 행을 더한다', { head: headOf(REL3, (h) => ({ ...h, articlesText: R.insertArticleRows(articlesText(F.w.seed.articles), [{ slug: 'fx-no-rel', body: { title: '합성', description: '합성', cluster: 'money-work', publishedAt: '2026-11-21', status: 'SCHEDULED', publishAt: '2026-11-21T10:30:00+09:00', body: [] } }]) })), changedFiles: [R.ARTICLES_PATH] }],
    ['PR_BASE_STALE', 'PR 을 만든 뒤 main 이 움직였다', { head: headOf(REL3, (h) => ({ ...h, baseArticlesText: articlesText(F.w.seed.articles.slice(1)) })) }],
  ]
  for (const [want, label, over] of TAMPER) {
    await check(`RG2-${want}`, `변조 · 낡음 반례 — ${label} → ${want} · 통과 0`, () => {
      const g = gate(F, REL3, over)
      assert(!g.ok && codes(g).includes(want), `${codes(g).join(',') || '통과'}`)
    })
  }
  await check('RG3', '🔴 ProviderPlan HOLD plan 을 손으로 만든 PR(정확한 planHash · 결속)도 merge gate 가 막는다', async () => {
    const G = await fresh((s) => { s.intents.find((x) => x.intentId === 'I-F1-01').exclusions.push('🔴 합성 내부 표식') })
    const p = G.plan('I-F1-01')
    const a = articleFor(p)
    const body = { title: a.title, description: a.description, cluster: p.cluster, publishedAt: '2026-11-21', status: 'SCHEDULED', publishAt: '2026-11-21T10:30:00+09:00',
      heroImage: { src: R.heroSrcOf('fx-hand'), alt: a.heroAlt, width: 1200, height: 675 }, body: a.body,
      release: { schemaVersion: CP.ARTICLE_RELEASE_SCHEMA, intentId: p.intentId, graphVersion: p.graphVersion, bundleHash: p.bundleHash, planHash: p.planHash, policyBoard: p.policyBoard } }
    const head = { articlesText: R.insertArticleRows(articlesText(G.w.seed.articles), [{ slug: 'fx-hand', body }]), planTexts: { [R.planFilePath('fx-hand')]: R.renderPlanFile(p) }, heroPresent: { [R.heroFilePath('fx-hand')]: true } }
    const g = R.judgeReleaseContent({ main: { ...mainOf(G), bindingText: R.renderBindingFile(CP.releaseBindingOf(G.compiled)) }, head,
      changedFiles: [R.ARTICLES_PATH, R.planFilePath('fx-hand'), R.heroFilePath('fx-hand')], occupied: { dates: [], slugs: [] }, nowMs: NOW })
    assert(!g.ok && codes(g).join() === 'PROVIDER_PLAN_HOLD' && g.blockedBy[0].message.includes('INTERNAL_MARKER'), codes(g).join())
  })
  await check('RG4', 'PR 관문 — Draft 모드 · Draft PR · SHA 이동 · CI pending · 필수 검사 skipped · 사람 브랜치는 막고 정상만 통과', () => {
    const pr = { number: 1, headRefName: `${R.RELEASE_BRANCH_PREFIX}x`, headRefOid: 'h'.repeat(40), baseRefName: 'main', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
    const ok = [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }]
    const j = (over = {}) => RUN.judgeReleasePr({ pr: { ...pr, ...(over.pr ?? {}) }, expectedSha: over.sha ?? pr.headRefOid, ciState: over.ci ?? 'success', checks: over.checks ?? ok, rollout: { release: over.release ?? 'auto' } })
    assert(j().ok, JSON.stringify(j().blockedBy))
    const want = [['RELEASE_DRAFT_MODE', { release: 'draft' }], ['IS_DRAFT', { pr: { isDraft: true } }], ['SHA_DRIFTED', { sha: 'z'.repeat(40) }], ['CI_NOT_GREEN', { ci: 'pending' }],
      ['REQUIRED_CHECK_MISSING', { checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'skipped' }] }], ['CHECKS_EMPTY', { checks: [] }],
      ['NOT_RELEASE_BRANCH', { pr: { headRefName: 'feat/someone' } }], ['NOT_MERGEABLE', { pr: { mergeable: 'CONFLICTING' } }]]
    for (const [code, over] of want) assert(codes(j(over)).includes(code), `${code}: ${codes(j(over))}`)
  })

  // ════ RJ — journal + CAS ═══════════════════════════════════
  const heroBytes = (m) => webp(1200, 675, m.intentId)
  const wtOf = (rel) => {
    const d = mkdtempSync(join(TMP, 'wt-'))
    mkdirSync(join(d, 'src/content/magazine'), { recursive: true })
    writeFileSync(join(d, R.ARTICLES_PATH), articlesText(F.w.seed.articles))
    return { d, jp: join(mkdtempSync(join(TMP, 'st-')), 'journal.json'), rel: { ...rel, baseSha: 'b'.repeat(40) } }
  }
  const listAll = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : [])
  await check('RJ1', 'journal + CAS 쓰기 — plan · hero · articles 를 after 해시로 · journal APPLIED · temp 잔여 0', () => {
    const { d, jp, rel } = wtOf(REL3)
    const r = J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T' })
    assert(r.journal.state === 'APPLIED' && !r.resumed, r.journal.state)
    assert(sha256(readFileSync(join(d, R.ARTICLES_PATH))) === rel.articles.afterSha256, 'articles after')
    for (const f of rel.files) assert(existsSync(join(d, f.path)), `${f.path} 없음`)
    assert(!listAll(d).some((p) => p.includes('release-tmp')), 'temp 잔여')
  })
  await check('RJ2', '중간 사망 재실행 — articles 직전에 죽어도 다음 실행이 이어 쓴다 · 같은 바이트 · 이미 APPLIED 면 사실만 확인', () => {
    const { d, jp, rel } = wtOf(REL3)
    assert(codeOf(() => J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T', beforeArticlesRename: () => { throw Object.assign(new Error('죽음'), { code: 'KILLED' }) } })) === 'KILLED', '주입 사망')
    assert(J.readJournal(jp).state === 'PREPARED' && sha256(readFileSync(join(d, R.ARTICLES_PATH))) === rel.articles.beforeSha256, '사망 뒤 상태')
    const r = J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T2' })
    assert(r.resumed && r.journal.state === 'APPLIED' && sha256(readFileSync(join(d, R.ARTICLES_PATH))) === rel.articles.afterSha256, '이어 쓰기')
    const again = J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T3' })
    assert(again.journal.state === 'APPLIED', '재실행')
    writeFileSync(join(d, R.planFilePath(rel.members[0].slug)), '{}\n')
    assert(codeOf(() => J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T4' })) === 'FILE_CONFLICT', 'APPLIED 뒤 바뀐 파일을 못 봤다')
  })
  await check('RJ3', 'CAS 경쟁 — 쓰기 직전에 articles.ts 가 바뀌면 ARTICLES_CAS_MISMATCH · 이번 실행이 만든 파일 되돌림 · 남의 변경 보존 · ABORTED', () => {
    const { d, jp, rel } = wtOf(REL3)
    const theirs = `${articlesText(F.w.seed.articles)}// 다른 writer\n`
    assert(codeOf(() => J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T', beforeArticlesRename: () => writeFileSync(join(d, R.ARTICLES_PATH), theirs) })) === 'ARTICLES_CAS_MISMATCH', 'CAS')
    assert(readFileSync(join(d, R.ARTICLES_PATH), 'utf8') === theirs && rel.files.every((f) => !existsSync(join(d, f.path))) && J.readJournal(jp).state === 'ABORTED', JSON.stringify(listAll(d)))
    const { d: d2, jp: jp2 } = wtOf(REL3)
    writeFileSync(join(d2, R.ARTICLES_PATH), theirs)
    assert(codeOf(() => J.applyReleaseFiles({ worktree: d2, journalPath: jp2, release: rel, heroBytesOf: heroBytes, nowIso: 'T' })) === 'ARTICLES_CAS_MISMATCH' && !existsSync(jp2), '조립 뒤 바뀐 articles 를 덮었다')
  })
  await check('RJ4', '충돌 · hero 해시 · 깨진 journal · 다른 release journal → 쓰기 0', () => {
    const { d, jp, rel } = wtOf(REL3)
    mkdirSync(dirname(join(d, rel.files[0].path)), { recursive: true }); writeFileSync(join(d, rel.files[0].path), 'someone else\n')
    assert(codeOf(() => J.applyReleaseFiles({ worktree: d, journalPath: jp, release: rel, heroBytesOf: heroBytes, nowIso: 'T' })) === 'FILE_CONFLICT' && readFileSync(join(d, rel.files[0].path), 'utf8') === 'someone else\n', '남의 파일을 덮었다')
    const w2 = wtOf(REL3)
    assert(codeOf(() => J.applyReleaseFiles({ worktree: w2.d, journalPath: w2.jp, release: w2.rel, heroBytesOf: () => webp(1200, 675, 'other'), nowIso: 'T' })) === 'HERO_BYTES_MISMATCH' && !existsSync(w2.jp), 'hero 해시')
    const w3 = wtOf(REL3); writeFileSync(w3.jp, '{ broken')
    assert(codeOf(() => J.applyReleaseFiles({ worktree: w3.d, journalPath: w3.jp, release: w3.rel, heroBytesOf: heroBytes, nowIso: 'T' })) === 'JOURNAL_BROKEN' && readFileSync(w3.jp, 'utf8') === '{ broken', '깨진 journal')
    const w4 = wtOf(REL3); writeFileSync(w4.jp, JSON.stringify({ schemaVersion: J.JOURNAL_SCHEMA, releaseId: '20261120-0000000000', state: 'PREPARED', entries: [] }))
    assert(codeOf(() => J.applyReleaseFiles({ worktree: w4.d, journalPath: w4.jp, release: w4.rel, heroBytesOf: heroBytes, nowIso: 'T' })) === 'JOURNAL_FOREIGN', '다른 release journal')
  })
  await check('RJ5', 'slug 기록 — 한 번만 묶는다(같은 값 재실행 통과 · 다른 값 SLUG_RECORD_CONFLICT) · writer 잠금 하나 · 죽은 잠금만 회수', () => {
    const st = mkdtempSync(join(TMP, 'slug-'))
    assert(J.recordSlug({ stateRoot: st, intentId: 'I-F1-01', slug: 'fx-a', planHash: 'a'.repeat(64), nowIso: 'T' }).created, '첫 기록')
    assert(!J.recordSlug({ stateRoot: st, intentId: 'I-F1-01', slug: 'fx-a', planHash: 'b'.repeat(64), nowIso: 'T' }).created, '같은 값')
    assert(codeOf(() => J.recordSlug({ stateRoot: st, intentId: 'I-F1-01', slug: 'fx-b', planHash: 'a'.repeat(64), nowIso: 'T' })) === 'SLUG_RECORD_CONFLICT', '다른 값')
    assert(J.readSlugRecords(st)['I-F1-01'].slug === 'fx-a' && !listAll(join(st, 'slugs')).some((p) => p.includes('.tmp-')), '기록 · temp')
    writeFileSync(join(st, 'slugs', 'I-F2-01.json'), '')
    assert(codeOf(() => J.readSlugRecords(st)) === 'SLUG_RECORD_BROKEN', '빈 기록을 무시했다')
    const ls = mkdtempSync(join(TMP, 'lock-'))
    const a = J.acquireReleaseLock({ stateRoot: ls, nowIso: 'T', pidAlive: () => true })
    const b = J.acquireReleaseLock({ stateRoot: ls, nowIso: 'T', pid: 4242, pidAlive: () => true })
    assert(a.ok && !b.ok && b.code === 'RELEASE_LOCK_HELD', '두 writer')
    const c = J.acquireReleaseLock({ stateRoot: ls, nowIso: 'T', pid: 4243, pidAlive: () => false })
    assert(c.ok, '죽은 잠금 회수'); c.release()
    assert(!existsSync(join(ls, 'release.lock')), '잠금 잔여')
  })

  // ════ RE — 끝에서 끝 (실제 git · 가짜 GitHub) ═════════════════
  const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
  const gitOk = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0
  const GIT_ENV = ['-c', 'user.email=release-check@example.invalid', '-c', 'user.name=release-check', '-c', 'commit.gpgsign=false']

  /** 가짜 GitHub — PR · CI · merge 만 대역이다. 브랜치 · commit · merge 결과는 실제 bare origin 에 있다 */
  class FakeGitHub {
    constructor(origin, helper) { this.origin = origin; this.helper = helper; this.prs = []; this.n = 100; this.merges = 0; this.mergeCalls = 0; this.created = 0; this.ci = () => 'success'; this.fault = {}
      this.serving = () => true; this.servingCalls = []; this.afterCreate = null }
    headOf(branch) { const r = spawnSync('git', ['ls-remote', this.origin, `refs/heads/${branch}`], { encoding: 'utf8' }); return r.stdout.split(/\s/)[0] || null }
    refresh() { for (const p of this.prs) if (p.state === 'OPEN') { const h = this.headOf(p.headRefName); if (h) p.headRefOid = h } }
    view(p) { return p ? { ...p } : null }
    deps() {
      const take = (k) => { if (this.fault[k] > 0) { this.fault[k]--; return true } return false }
      return {
        listOpenMagazinePrs: () => { this.refresh(); return { ok: true, prs: this.prs.filter((p) => p.state === 'OPEN').map((p) => this.view(p)) } },
        getPr: (n) => { this.refresh(); return this.view(this.prs.find((p) => p.number === n)) },
        findPrByBranch: (b) => { this.refresh(); return this.view(this.prs.find((p) => p.state === 'OPEN' && p.headRefName === b)) },
        listPrFiles: (n) => {
          const p = this.prs.find((x) => x.number === n)
          git(this.helper, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
          const base = git(this.helper, 'merge-base', 'origin/main', p.headRefOid)
          return git(this.helper, 'diff', '--name-only', base, p.headRefOid).split('\n').filter(Boolean)
        },
        getChecks: (sha) => { const s = this.ci(sha); return { ok: true, ciState: s, checks: [{ name: 'Micro Seed 3축 게이트', status: s === 'pending' ? 'in_progress' : 'completed', conclusion: s === 'pending' ? null : s === 'success' ? 'success' : 'failure' }] } },
        createPr: ({ branch, draft }) => {
          if (take('createPr')) throw Object.assign(new Error('주입 사망 — PR 생성 직전'), { code: 'KILLED' })
          const h = this.headOf(branch); if (!h) return { reason: '원격 브랜치 없음' }
          const p = { number: ++this.n, url: `https://example.invalid/pull/${this.n}`, headRefName: branch, headRefOid: h, baseRefName: 'main', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: draft }
          this.prs.push(p); this.created++
          this.afterCreate?.(p)
          return { number: p.number, url: p.url }
        },
        closePr: (n) => { if (take('closePr')) return { ok: false }; const p = this.prs.find((x) => x.number === n); if (p) p.state = 'CLOSED'; return { ok: Boolean(p) } },
        // 서빙 관측 대역 — 실제 Vercel 호출 0. 부른 SHA 를 센다(같은 SHA 재관측 0 을 본다)
        observeServing: (sha) => { this.servingCalls.push(sha); return this.serving(sha) ? { served: true, code: null, deploymentId: 'dpl_RELEASECHECK0000000000' } : { served: false, code: 'VERCEL_SHA_MISMATCH', deploymentId: null } },
        getMergeCommit: (n) => this.prs.find((x) => x.number === n)?.mergeCommit ?? null,
        mergePr: (n, sha) => {
          this.refresh()
          this.mergeCalls++
          const p = this.prs.find((x) => x.number === n)
          if (take('mergePr')) return { ok: false, reason: '주입 merge 실패' }
          // 응답만 성공인 가짜 merge — main 은 그대로다(MERGED 확인이 잡아야 한다)
          if (take('mergeHollow')) { p.state = 'MERGED'; p.mergeCommit = 'd'.repeat(40); return { ok: true, mergeCommit: p.mergeCommit } }
          if (!p || p.state !== 'OPEN' || p.headRefOid !== sha || p.isDraft) return { ok: false, reason: 'head 불일치 · 닫힘 · Draft' }
          git(this.helper, 'fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*')
          git(this.helper, 'checkout', '-q', '-B', 'main', 'origin/main')
          git(this.helper, 'merge', '-q', '--squash', sha)
          git(this.helper, ...GIT_ENV, 'commit', '-q', '-m', `squash #${n}`)
          git(this.helper, 'push', '-q', 'origin', 'main')
          p.state = 'MERGED'; this.merges++
          p.mergeCommit = git(this.helper, 'rev-parse', 'HEAD')
          // merge 는 됐는데 응답을 잃었다 — 다음 회차가 다시 merge 하면 안 된다
          if (take('mergeLost')) return { ok: false, reason: '주입 — merge 응답 유실' }
          return { ok: true, mergeCommit: p.mergeCommit }
        },
      }
    }
  }

  /** 실제 저장소 모양 sandbox — origin(bare) · runtime clone · 상태 루트 · Job 저장소 */
  function sandbox(G, { release = 'auto', target = 5, start = NOW } = {}) {
    const T = mkdtempSync(join(TMP, 'e2e-'))
    const ORIGIN = join(T, 'origin.git'), SEED = join(T, 'seed'), RT = join(T, 'runtime'), HELP = join(T, 'gh-helper')
    git(T, 'init', '-q', '--bare', '-b', 'main', ORIGIN)
    git(T, 'init', '-q', '-b', 'main', SEED)
    const put = (rel, data) => { mkdirSync(dirname(join(SEED, rel)), { recursive: true }); writeFileSync(join(SEED, rel), data) }
    put(R.ARTICLES_PATH, articlesText(G.w.seed.articles))
    put('src/content/magazine/graph/control.ts', controlText(G.w.graphVersion, G.w.seed.control))
    put(R.bundleFilePath(G.w.graphVersion), G.text)
    put(R.BINDING_PATH, R.renderBindingFile(CP.releaseBindingOf(G.compiled)))
    put('drafts/magazine/topic-queue.ts', queueText(G.w.seed.queue))
    put('public/magazine/fx-next/hero.webp', webp(1200, 675, 'fx-next'))
    git(SEED, 'add', '-A'); git(SEED, ...GIT_ENV, 'commit', '-q', '-m', 'seed'); git(SEED, 'remote', 'add', 'origin', ORIGIN); git(SEED, 'push', '-q', 'origin', 'main')
    git(T, 'clone', '-q', ORIGIN, RT); git(T, 'clone', '-q', ORIGIN, HELP)
    for (const d of [RT, HELP]) { git(d, 'config', 'user.email', 'release-check@example.invalid'); git(d, 'config', 'user.name', 'release-check'); git(d, 'config', 'commit.gpgsign', 'false') }
    const stateRoot = join(T, 'state'), jobsRoot = join(T, 'jobs')
    const gh = new FakeGitHub(ORIGIN, HELP)
    const clock = { t: start }
    const rollout = { code: 'VALID', effective: { path: 'vnext', release, targetCandidates: target } }
    const fault = {}
    const real = RUN.makeReleaseDeps({ root: RT, stateRoot, jobsRoot, readRollout: () => rollout, readCandidates: () => CAND.readReleaseCandidates({ jobsRoot }), now: () => clock.t, sleep: async (ms) => { clock.t += ms },
      vercelContext: () => ({ ok: false, why: '검사 — 실제 Vercel 호출 0' }) })
    const deps = { ...real, ...gh.deps(),
      commit: (a) => { if (fault.commit > 0) { fault.commit--; throw Object.assign(new Error('주입 사망 — commit 직전'), { code: 'KILLED' }) } return real.commit(a) },
      push: (a) => { if (fault.push > 0) { fault.push--; throw Object.assign(new Error('주입 사망 — push 직전'), { code: 'KILLED' }) } return real.push(a) } }
    const putJob = (intentId, over = {}) => {
      const plan = G.plan(intentId)
      const art = Buffer.from(JSON.stringify(over.article ?? articleFor(plan))), hero = webp(1200, 675, over.heroSalt ?? intentId)
      const dir = join(jobsRoot, plan.planHash); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'article.json'), art); writeFileSync(join(dir, 'hero.webp'), hero)
      writeFileSync(join(dir, 'job.json'), JSON.stringify({ schemaVersion: CAND.JOB_SCHEMA, planId: plan.planId, planHash: plan.planHash,
        providerPlanHash: 'providerPlanHash' in over ? over.providerPlanHash : providerHash(G, plan),
        slugProposal: over.slugProposal ?? `fx-rel-${intentId.toLowerCase()}`, manuscript: { file: 'article.json', sha256: sha256(art) }, validation: { verdict: 'VALID' },
        hero: { file: 'hero.webp', sha256: sha256(hero) }, hold: over.hold ?? null }))
      return dir
    }
    const run = (apply = true) => RUN.runRelease({ deps, apply })
    /** 02:00 복구 회차 — 같은 deps · 같은 상태 루트 */
    const recover = () => RUN.runRelease({ deps, apply: true, recover: true })
    const journals = () => J.listReleaseJournals(stateRoot).map((x) => x.journal)
    const mainArticles = () => { git(HELP, 'fetch', '-q', 'origin'); return git(HELP, 'show', 'origin/main:src/content/magazine/articles.ts') }
    const remoteBranches = () => spawnSync('git', ['ls-remote', '--heads', ORIGIN], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(R.RELEASE_BRANCH_PREFIX))
    return { T, ORIGIN, RT, HELP, stateRoot, jobsRoot, gh, clock, rollout, fault, deps, putJob, run, recover, journals, mainArticles, remoteBranches }
  }
  const releasedRows = (text) => CP.parseArticleIdentityText(text).rows.filter((r) => r.release)

  await check('RE1', 'dry-run — 조립 결과만 · 상태 루트 · 원격 브랜치 · PR · worktree 0', async () => {
    const s = sandbox(F); for (const i of ALL) s.putJob(i)
    const r = await s.run(false)
    assert(r.outcome === 'DRY_RUN_ASSEMBLED' && r.release.members.length === 3, `${r.outcome} ${JSON.stringify(r.blockedBy)}`)
    assert(!existsSync(s.stateRoot) && s.remoteBranches().length === 0 && s.gh.prs.length === 0 && git(s.RT, 'worktree', 'list').split('\n').length === 1, '쓰기가 있었다')
  })
  await check('RE2', 'Draft release(vnext/draft/1) — Draft PR 1 · merge 0 · 재실행은 대기(두 번째 PR 0) · 실제 원격 브랜치에 release commit', async () => {
    const s = sandbox(F, { release: 'draft', target: 1 }); for (const i of ALL) s.putJob(i)
    const r1 = await s.run(true)
    assert(r1.outcome === 'DRAFT_RELEASE_OPEN' && s.gh.prs.length === 1 && s.gh.prs[0].isDraft && s.gh.merges === 0, `${r1.outcome} ${JSON.stringify(r1.blockedBy)}`)
    const files = s.gh.deps().listPrFiles(s.gh.prs[0].number).sort()
    const m = r1.release.members[0]
    assert(JSON.stringify(files) === JSON.stringify([R.heroFilePath(m.slug), R.ARTICLES_PATH, R.planFilePath(m.slug)].sort()), `파일 ${files}`)
    const r2 = await s.run(true)
    assert(r2.outcome === 'WAITING_FOUNDER_DRAFT' && s.gh.created === 1 && s.gh.merges === 0, `${r2.outcome}`)
  })
  let autoSandbox = null
  await check('RE3', 'auto release — PR · CI · 내용/PR 관문 · freeze 밖 → squash merge · main 에 출처 행 3 · plan · hero · journal MERGED · 잔존물 0 · 재실행은 중복 0', async () => {
    const s = autoSandbox = sandbox(F); for (const i of ALL) s.putJob(i)
    const r = await s.run(true)
    assert(r.outcome === 'MERGED_SERVED' && r.merge.verified && r.serving?.state === 'SERVED' && s.gh.merges === 1 && s.gh.created === 1, `${r.outcome} ${JSON.stringify(r.blockedBy)}`)
    const rows = releasedRows(s.mainArticles())
    assert(rows.map((x) => `${x.release.intentId}@${x.publishAt.slice(0, 10)}`).join() === 'I-F2-02@2026-11-22,I-F1-01@2026-11-21,I-F2-01@2026-11-23',
      `main 행 ${rows.map((x) => `${x.release.intentId}@${x.publishAt}`)}`)
    for (const x of rows) {
      assert(git(s.HELP, 'show', `origin/main:${R.planFilePath(x.slug)}`) === R.renderPlanFile(F.plan(x.release.intentId)).trimEnd(), `${x.slug} plan`)
      assert(gitOk(s.HELP, 'cat-file', '-e', `origin/main:${R.heroFilePath(x.slug)}`), `${x.slug} hero`)
    }
    const j = J.readJournal(J.journalPathOf(s.stateRoot, r.release.releaseId))
    assert(j.state === 'MERGED' && !existsSync(J.worktreePathOf(s.stateRoot, r.release.releaseId)) && s.remoteBranches().length === 0, `journal ${j.state} · 잔존 ${s.remoteBranches()}`)
    const again = await s.run(true)
    assert(again.outcome === 'NO_RELEASABLE_CANDIDATE' && again.release.withdrawn.every((w) => w.reasons.join().includes('DUPLICATE_RELEASED_INTENT')) && s.gh.created === 1, `${again.outcome} ${JSON.stringify(again.release?.withdrawn)}`)
  })
  await check('RE4', '단계별 사망 재실행 — push 직전 · PR 생성 직전 · merge 실패 · 각 재실행이 이어 간다 · PR 1 · merge 1 · 같은 releaseId', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.fault.push = 1
    await assertRejects(() => s.run(true), 'KILLED')
    const id = readdirSync(join(s.stateRoot, 'releases'))[0]
    assert(J.readJournal(J.journalPathOf(s.stateRoot, id)).state === 'COMMITTED' && s.remoteBranches().length === 0, 'push 전 상태')
    s.gh.fault.createPr = 1
    await assertRejects(() => s.run(true), 'KILLED')
    assert(J.readJournal(J.journalPathOf(s.stateRoot, id)).state === 'PUSHED' && s.remoteBranches().length === 1 && s.gh.prs.length === 0, 'PR 전 상태')
    s.gh.fault.mergePr = 1
    const r3 = await s.run(true)
    assert(r3.outcome === 'MERGE_BLOCKED' && codes(r3).join() === 'MERGE_FAILED' && s.gh.created === 1, `${r3.outcome} ${codes(r3)}`)
    const r4 = await s.run(true)
    assert(r4.outcome === 'MERGED_SERVED' && s.gh.created === 1 && s.gh.merges === 1 && readdirSync(join(s.stateRoot, 'releases')).join() === id, `${r4.outcome} ${codes(r4)} · PR ${s.gh.created} · merge ${s.gh.merges}`)
  })
  await check('RE5', 'freeze — 11/24 20:00 KST 의 auto release 는 PR 까지 · merge 0 · MERGE_FROZEN · 11/25 02:30 재실행이 같은 PR 을 merge', async () => {
    const s = sandbox(F, { target: 1, start: KST('2026-11-24T20:00:00') }); s.putJob('I-F1-01')
    const r1 = await s.run(true)
    assert(r1.outcome === 'MERGE_FROZEN' && codes(r1).join() === 'MERGE_FREEZE_WINDOW' && s.gh.merges === 0 && s.gh.created === 1, `${r1.outcome} ${codes(r1)}`)
    s.clock.t = KST('2026-11-25T02:00:00')
    const r2 = await s.run(true)
    assert(r2.outcome === 'MERGE_FROZEN' && s.gh.merges === 0, `02:00 ${r2.outcome}`)
    s.clock.t = KST('2026-11-25T02:30:00')
    const r3 = await s.run(true)
    assert(r3.outcome === 'MERGED_SERVED' && s.gh.merges === 1 && s.gh.created === 1, `${r3.outcome} ${codes(r3)}`)
  })
  await check('RE6', 'release CI 실패 — 그 PR 만 닫고(브랜치 · worktree 정리) journal CLOSED · 같은 main 재실행은 같은 release 를 다시 만들지 않는다(WAITING_MAIN_CHANGE)', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.gh.ci = () => 'failure'
    const r1 = await s.run(true)
    assert(r1.outcome === 'RELEASE_CI_FAILED_CLOSED' && s.gh.prs[0].state === 'CLOSED' && s.gh.merges === 0 && s.remoteBranches().length === 0, `${r1.outcome}`)
    const id = readdirSync(join(s.stateRoot, 'releases'))[0]
    assert(J.readJournal(J.journalPathOf(s.stateRoot, id)).state === 'CLOSED', 'journal')
    const r2 = await s.run(true)
    assert(r2.outcome === 'WAITING_MAIN_CHANGE' && s.gh.created === 1, `${r2.outcome} ${codes(r2)}`)
    // 다시 만들지 않는다는 것은 worktree · 브랜치도 만들지 않는다는 뜻이다(잔존물 0)
    assert(!existsSync(J.worktreePathOf(s.stateRoot, id)) && git(s.RT, 'worktree', 'list').split('\n').length === 1
      && !gitOk(s.RT, 'rev-parse', '--verify', '--quiet', `refs/heads/${R.RELEASE_BRANCH_PREFIX}${id}`), `잔존물: ${git(s.RT, 'worktree', 'list')}`)
  })
  await check('RE7', '날짜 놓침 — 열린 Draft PR 의 공개 시각이 지나면 닫고 새 날짜로 다시 조립(새 Draft PR) · planHash 불변', async () => {
    const s = sandbox(F, { release: 'draft', target: 1 }); s.putJob('I-F1-01')
    const r1 = await s.run(true)
    const old = r1.release.members[0]
    s.clock.t = KST('2026-11-21T11:00:00')
    const r2 = await s.run(true)
    const neu = r2.release.members[0]
    assert(r2.outcome === 'DRAFT_RELEASE_OPEN' && s.gh.prs.filter((p) => p.state === 'OPEN').length === 1 && s.gh.prs[0].state === 'CLOSED' && s.gh.created === 2, `${r2.outcome} ${s.gh.prs.map((p) => p.state)}`)
    assert(neu.planId === old.planId && r2.release.releaseId !== r1.release.releaseId && neu.publishAt === '2026-11-22T10:30:00+09:00' && neu.slug === old.slug, `${neu.publishAt} ${neu.slug}`)
    assert(J.readJournal(J.journalPathOf(s.stateRoot, r1.release.releaseId)).state === 'CLOSED', '옛 journal')
  })
  await check('RE8', '변조 PR — CI 대기 중 누가 PR 브랜치에 planHash 를 바꾼 commit 을 올리면 merge 0 (PLAN_HASH_MISMATCH)', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    let pushedTamper = false
    s.gh.ci = (sha) => {
      if (!pushedTamper) {
        pushedTamper = true
        const branch = s.gh.prs[0].headRefName
        git(s.HELP, 'fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`)
        git(s.HELP, 'checkout', '-q', '-B', 'tamper', `origin/${branch}`)
        const p = join(s.HELP, R.ARTICLES_PATH)
        const t = readFileSync(p, 'utf8'); const ph = F.plan('I-F1-01').planHash
        writeFileSync(p, t.replace(ph, 'f'.repeat(64)))
        git(s.HELP, ...GIT_ENV, 'commit', '-q', '-am', 'tamper'); git(s.HELP, 'push', '-q', 'origin', `tamper:refs/heads/${branch}`)
        return 'pending'
      }
      return 'success'
    }
    const r1 = await s.run(true)
    // 첫 관찰의 head 가 움직였다 — 같은 회차는 SHA 이동으로, 다음 회차는 새 head 의 내용으로 막는다
    const r2 = await s.run(true)
    assert(s.gh.merges === 0 && (codes(r1).includes('SHA_DRIFTED') || codes(r1).includes('PR_MOVED_LATE') || codes(r1).includes('PLAN_HASH_MISMATCH')) && codes(r2).includes('PLAN_HASH_MISMATCH'), `${codes(r1)} / ${codes(r2)}`)
  })
  await check('RE9', '낡은 base — release PR 이 열린 뒤 main 에 다른 글이 들어오면 닫고 같은 회차에 지금 main 으로 다시 조립 · merge 1', async () => {
    const s = sandbox(F, { release: 'draft', target: 1 }); s.putJob('I-F1-01')
    await s.run(true)
    // 사람 · 다른 경로가 main 에 글 하나를 더했다(11-21 예약)
    git(s.HELP, 'fetch', '-q', 'origin'); git(s.HELP, 'checkout', '-q', '-B', 'main', 'origin/main')
    const p = join(s.HELP, R.ARTICLES_PATH)
    writeFileSync(p, R.insertArticleRows(readFileSync(p, 'utf8'), [{ slug: 'fx-human', body: { title: '합성 사람 글', description: '합성', cluster: 'family', publishedAt: '2026-11-21', status: 'SCHEDULED', publishAt: '2026-11-21T10:30:00+09:00', body: [] } }]))
    git(s.HELP, ...GIT_ENV, 'commit', '-q', '-am', 'human'); git(s.HELP, 'push', '-q', 'origin', 'main')
    s.rollout.effective.release = 'auto'
    const r = await s.run(true)
    const rows = releasedRows(s.mainArticles())
    assert(r.outcome === 'MERGED_SERVED' && s.gh.created === 2 && s.gh.merges === 1 && rows.length === 1 && rows[0].publishAt === '2026-11-22T10:30:00+09:00', `${r.outcome} ${codes(r)} · ${r.notes} · ${rows.map((x) => x.publishAt)}`)
  })
  await check('RE10', 'rollout 이 legacy · 없음이면 NOT_VNEXT — 상태 루트 · git · PR 0', async () => {
    const s = sandbox(F); s.putJob('I-F1-01')
    s.rollout.code = 'MISSING'; s.rollout.effective = { path: 'legacy', release: 'draft', targetCandidates: 1 }
    const r = await s.run(true)
    assert(r.outcome === 'NOT_VNEXT' && !existsSync(s.stateRoot) && s.gh.prs.length === 0, r.outcome)
  })
  await check('RE11', 'runtime 결속 — merge 된 main 의 결속 파일로 공개 시각 뒤 출처 행이 overlay 된다(공개 graph 가 실제로 그린다)', () => {
    const s = autoSandbox
    assert(s, '전제 — RE3')
    const binding = git(s.HELP, 'show', `origin/main:${R.BINDING_PATH}`)
    assert(`${binding}\n` === R.renderBindingFile(CP.releaseBindingOf(F.compiled)), 'main 결속 파일')
    const B = JSON.parse(F.text)
    const rows = releasedRows(s.mainArticles())
    const ov = provenanceOverlay({ canonical: B.mappings.map((m) => ({ intent: m.intentId, slug: m.slug })), graphIntentIds: B.intents.map((x) => x.intentId),
      rows: rows.map((r) => ({ slug: r.slug, release: r.release })), binding: CP.releaseBindingOf(F.compiled) })
    // I-F2-02 는 canonical slug(fx-queued) 그대로라 overlay 가 아니라 canonical mapping 으로 그려진다
    assert(JSON.stringify(ov.map((o) => o.intent).sort()) === JSON.stringify(['I-F1-01', 'I-F2-01']), JSON.stringify(ov))
  })

  await check('RE13', 'Draft PR 을 창업자가 닫으면(아니오) — 다음 회차는 journal CLOSED · 정리 · 같은 main 에서 새 PR 0 (WAITING_MAIN_CHANGE)', async () => {
    const s = sandbox(F, { release: 'draft', target: 1 }); s.putJob('I-F1-01')
    const r1 = await s.run(true)
    s.gh.prs[0].state = 'CLOSED' // 사람이 닫았다(브랜치는 남아 있다)
    const r2 = await s.run(true)
    const id = r1.release.releaseId
    // 진행 중 journal 정리가 PR 의 CLOSED 를 사실로 적고, 같은 main 의 같은 release 는 다시 만들지 않는다
    assert(r2.outcome === 'WAITING_MAIN_CHANGE' && codes(r2).join() === 'JOURNAL_TERMINAL' && r2.notes.some((n) => n.includes('밖에서 닫혔다')) && s.gh.created === 1, `${r2.outcome} ${codes(r2)} ${r2.notes}`)
    assert(J.readJournal(J.journalPathOf(s.stateRoot, id)).state === 'CLOSED' && s.remoteBranches().length === 0 && !existsSync(J.worktreePathOf(s.stateRoot, id)), '정리')
    const r3 = await s.run(true)
    assert(r3.outcome === 'WAITING_MAIN_CHANGE' && s.gh.created === 1, `${r3.outcome}`)
  })
  await check('RE13b', 'PR 을 연 직후(같은 회차) 밖에서 닫히면 — merge 단계로 가지 않는다 · journal CLOSED · RELEASE_PR_CLOSED_EXTERNALLY', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.gh.afterCreate = (p) => { p.state = 'CLOSED' }
    const r = await s.run(true)
    assert(r.outcome === 'WAITING_MAIN_CHANGE' && codes(r).join() === 'RELEASE_PR_CLOSED_EXTERNALLY' && s.gh.mergeCalls === 0 && s.journals()[0].state === 'CLOSED', `${r.outcome} ${codes(r)} · merge ${s.gh.mergeCalls}`)
  })
  await check('RE12','legacy queue 신원 adapter 는 실행기에서도 켜져 있다 — queue 에 같은 intent 가 있으면 release 0(DUPLICATE_QUEUE_INTENT)', async () => {
    const G = await fresh((s) => { s.queue.push({ slug: 'fx-legacy-same', title: '합성 legacy 같은 주제 다른 제목', cluster: 'money-work', intentId: 'I-F1-01' }) })
    const s = sandbox(G, { target: 1 }); s.putJob('I-F1-01')
    const r = await s.run(false)
    assert(r.outcome === 'NO_RELEASABLE_CANDIDATE' && r.release.withdrawn[0]?.reasons.join().includes('DUPLICATE_QUEUE_INTENT'), `${r.outcome} ${JSON.stringify(r.release?.withdrawn)}`)
  })

  // ════ RS — 재개 결속 (순수) ══════════════════════════════════
  await check('RS1', '재개 결속 — journal 의 원본 commit · 바이트 · 검증된 원고 · hero · ProviderPlan 이 전부 같을 때만 통과 · 반례 하나씩 · 통과 0', () => {
    const H = (c) => c.repeat(64)
    const slug = 'fx-rs', branch = `${R.RELEASE_BRANCH_PREFIX}20261120-aaaaaaaaaa`
    const journal = { state: 'PR_OPEN', branch, prNumber: 7, commitSha: 'c'.repeat(40),
      entries: [{ path: R.planFilePath(slug), afterSha256: H('1') }, { path: R.heroFilePath(slug), afterSha256: H('2') }, { path: R.ARTICLES_PATH, afterSha256: H('3') }],
      members: [{ planId: 'g:I', planHash: H('4'), slug, providerPlanHash: H('5'), heroSha256: H('2'), manuscriptSha256: H('6') }] }
    const head = { [R.planFilePath(slug)]: H('1'), [R.heroFilePath(slug)]: H('2'), [R.ARTICLES_PATH]: H('3') }
    const job = { manuscriptSha256: H('6'), heroSha256: H('2'), providerPlanHash: H('5') }
    const j = (over = {}) => RUN.judgeResumeBinding({ journal: 'journal' in over ? over.journal : { ...journal, ...(over.j ?? {}) }, pr: { number: 7, headRefName: branch, headRefOid: 'c'.repeat(40), ...(over.pr ?? {}) },
      headSha256Of: (p) => ({ ...head, ...(over.head ?? {}) })[p] ?? null, jobOf: () => ('job' in over ? over.job : job), providerPlanHashOf: () => ('pp' in over ? over.pp : H('5')) })
    assert(j().ok && j().checked.length === 1, JSON.stringify(j().blockedBy))
    const cases = [
      ['RESUME_JOURNAL_MISSING', { journal: null }], ['RESUME_JOURNAL_BROKEN', { journal: { broken: true, why: 'JSON' } }],
      // 🔴 이미 MERGED · CLOSED 인 release 의 PR 은 다시 merge 하지 않는다(중복 merge 0) · PR 전 단계도 아니다
      ['RESUME_JOURNAL_STATE', { j: { state: 'MERGED' } }], ['RESUME_JOURNAL_STATE', { j: { state: 'CLOSED' } }], ['RESUME_JOURNAL_STATE', { j: { state: 'PUSHED' } }],
      ['RESUME_PR_MISMATCH', { pr: { number: 8 } }], ['RESUME_PR_MISMATCH', { pr: { headRefName: `${R.RELEASE_BRANCH_PREFIX}20261120-bbbbbbbbbb` } }],
      ['RESUME_COMMIT_MISMATCH', { pr: { headRefOid: 'd'.repeat(40) } }], ['RESUME_COMMIT_MISMATCH', { j: { commitSha: undefined } }],
      ['RESUME_BYTES_MISMATCH', { head: { [R.heroFilePath(slug)]: H('9') } }], ['RESUME_BYTES_MISMATCH', { head: { [R.ARTICLES_PATH]: H('9') } }],
      ['RESUME_BYTES_MISMATCH', { head: { [R.planFilePath(slug)]: null } }], ['RESUME_BYTES_MISMATCH', { j: { entries: [] } }],
      ['RESUME_BYTES_MISMATCH', { j: { members: [{ ...journal.members[0], heroSha256: H('8') }] }, job: { ...job, heroSha256: H('8') } }],
      ['RESUME_BINDING_ABSENT', { j: { members: [{ ...journal.members[0], manuscriptSha256: null }] } }], ['RESUME_BINDING_ABSENT', { j: { members: [{ ...journal.members[0], providerPlanHash: null }] } }],
      ['RESUME_BINDING_ABSENT', { j: { members: [] } }],
      ['RESUME_JOB_MISSING', { job: null }],
      ['RESUME_JOB_MISMATCH', { job: { ...job, manuscriptSha256: H('7') } }], ['RESUME_JOB_MISMATCH', { job: { ...job, heroSha256: H('7') } }], ['RESUME_JOB_MISMATCH', { job: { ...job, providerPlanHash: H('7') } }],
      ['RESUME_PROVIDER_PLAN_DRIFT', { pp: H('7') }], ['RESUME_PROVIDER_PLAN_DRIFT', { pp: null }],
    ]
    for (const [want, over] of cases) { const r = j(over); assert(!r.ok && codes(r).includes(want), `${want}: ${codes(r).join(',') || '통과'}`) }
  })
  await check('RA8', '조립 — Job 이 묶은 ProviderPlan 이 지금 main 에서 다시 만든 값과 다르면 그 후보만 보류(DRIFT) · 기록 없음(UNBOUND) · 원고 해시 없음 · 다른 후보는 그대로', () => {
    const drift = assemble(F, [candidateOf(F, 'I-F1-01', { providerPlanHash: 'e'.repeat(64) }), candidateOf(F, 'I-F2-02')])
    assert(drift.ok && drift.members.map((m) => m.intentId).join() === 'I-F2-02' && drift.withdrawn.find((w) => w.planId.endsWith('I-F1-01'))?.reasons.join() === 'PROVIDER_PLAN_DRIFT', JSON.stringify(drift.withdrawn))
    const unbound = assemble(F, [candidateOf(F, 'I-F1-01', { providerPlanHash: null })])
    assert(!unbound.ok && unbound.withdrawn[0].reasons.join() === 'PROVIDER_PLAN_UNBOUND', JSON.stringify(unbound.withdrawn))
    const noMs = assemble(F, [candidateOf(F, 'I-F1-01', { manuscriptSha256: undefined })])
    assert(!noMs.ok && noMs.withdrawn[0].reasons.join() === 'MANUSCRIPT_UNBOUND', JSON.stringify(noMs.withdrawn))
    // 조립 결과는 Job 이 묶은 값을 그대로 싣는다(다시 만든 값으로 바꿔 치지 않는다) — journal 이 이것을 재개 결속으로 남긴다
    const ok = assemble(F, [candidateOf(F, 'I-F1-01')])
    const c = candidateOf(F, 'I-F1-01')
    assert(ok.members[0].providerPlanHash === c.providerPlanHash && ok.members[0].manuscriptSha256 === c.manuscriptSha256 && ok.members[0].heroSha256 === c.hero.sha256, '조립이 결속 해시를 싣지 않는다')
  })

  // ════ RR — 01:00 release ↔ 02:00 복구 ═══════════════════════
  const oneJournal = (s) => { const js = s.journals(); assert(js.length === 1, `journal ${js.length}개`); return js[0] }
  const prStates = (s) => s.gh.prs.map((p) => p.state).join()
  /** 01:00 회차가 PR 을 열고 CI 를 기다리다 넘긴 상태 */
  const pendingAt0100 = async (opts = {}) => {
    const s = sandbox(F, { target: 1, ...opts }); s.putJob('I-F1-01')
    s.gh.ci = () => 'pending'
    const r = await s.run(true)
    assert(r.outcome === 'CI_PENDING' && codes(r).join() === 'CI_OBSERVE_TIMEOUT' && s.gh.created === 1 && oneJournal(s).state === 'PR_OPEN', `전제 ${r.outcome} ${codes(r)}`)
    return { s, r }
  }
  await check('RR1', 'CI 지연 — 01:00 이 CI 를 기다리다 넘긴 release PR 을 02:00 복구가 같은 journal · 같은 PR 로 이어 merge 한다 · 새 PR 0 · 조립 0', async () => {
    const { s, r } = await pendingAt0100()
    const id = r.release.releaseId, head = s.gh.prs[0].headRefOid
    s.gh.ci = () => 'success'
    const r2 = await s.recover()
    assert(r2.mode === 'recover' && r2.outcome === 'MERGED_SERVED' && r2.release === null && s.gh.created === 1 && s.gh.merges === 1 && r2.merge.number === s.gh.prs[0].number, `${r2.outcome} ${codes(r2)} · PR ${s.gh.created}`)
    const j = oneJournal(s)
    assert(j.releaseId === id && j.state === 'MERGED' && j.commitSha === head && j.mainVerified === true && j.serving.state === 'SERVED', `journal ${j.releaseId} ${j.state}`)
    assert(releasedRows(s.mainArticles()).length === 1 && s.remoteBranches().length === 0, 'main 행 · 잔존물')
    // 복구가 계속 CI 를 못 보면 같은 PR 이 그대로 남는다(닫지 않는다)
    const again = await pendingAt0100()
    const r3 = await again.s.recover()
    assert(r3.outcome === 'CI_PENDING' && prStates(again.s) === 'OPEN' && again.s.gh.created === 1 && r3.closed.length === 0, `${r3.outcome} ${prStates(again.s)}`)
  })
  await check('RR2', '🔴 복구는 새 PR · 재조립 0 — 열린 release PR 이 없으면 후보가 있어도 아무것도 만들지 않는다 · PR 전에 멈춘 release 도 복구가 열지 않는다(01:00 이 같은 journal 로 잇는다)', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    const r = await s.recover()
    assert(r.outcome === 'RECOVER_NOTHING_OPEN' && r.release === null && s.gh.created === 0 && s.remoteBranches().length === 0 && s.journals().length === 0
      && git(s.RT, 'worktree', 'list').split('\n').length === 1, `${r.outcome} · PR ${s.gh.created} · journal ${s.journals().length}`)
    s.gh.fault.createPr = 1
    await assertRejects(() => s.run(true), 'KILLED')
    const id = oneJournal(s).releaseId
    assert(oneJournal(s).state === 'PUSHED' && s.gh.created === 0, '전제 — PUSHED')
    const r2 = await s.recover()
    assert(r2.outcome === 'RECOVER_NOTHING_OPEN' && s.gh.created === 0 && oneJournal(s).state === 'PUSHED' && r2.notes.some((n) => n.includes('복구 회차는 PR 을 만들지 않는다')), `${r2.outcome} ${r2.notes}`)
    const r3 = await s.run(true)
    assert(r3.outcome === 'MERGED_SERVED' && s.gh.created === 1 && s.gh.merges === 1 && oneJournal(s).releaseId === id, `${r3.outcome} ${codes(r3)} · PR ${s.gh.created}`)
  })
  await check('RR3', '복구 보류 — 날짜를 놓친 PR · 낡은 base 의 PR 을 복구는 닫지 않는다(RECOVER_DEFERRED · 새 PR 0) · 다음 01:00 이 닫고 다시 조립한다', async () => {
    const a = await pendingAt0100()
    a.s.clock.t = KST('2026-11-21T11:00:00')
    const ra = await a.s.recover()
    assert(ra.outcome === 'RECOVER_DEFERRED' && codes(ra).join() === 'RELEASE_DATE_MISSED' && prStates(a.s) === 'OPEN' && ra.closed.length === 0 && a.s.gh.created === 1, `${ra.outcome} ${codes(ra)} ${prStates(a.s)}`)
    const b = await pendingAt0100()
    git(b.s.HELP, 'fetch', '-q', 'origin'); git(b.s.HELP, 'checkout', '-q', '-B', 'main', 'origin/main')
    const p = join(b.s.HELP, R.ARTICLES_PATH)
    writeFileSync(p, R.insertArticleRows(readFileSync(p, 'utf8'), [{ slug: 'fx-human', body: { title: '합성 사람 글', description: '합성', cluster: 'family', publishedAt: '2026-11-25', status: 'SCHEDULED', publishAt: '2026-11-25T10:30:00+09:00', body: [] } }]))
    git(b.s.HELP, ...GIT_ENV, 'commit', '-q', '-am', 'human'); git(b.s.HELP, 'push', '-q', 'origin', 'main')
    b.s.gh.ci = () => 'success'
    const rb = await b.s.recover()
    assert(rb.outcome === 'RECOVER_DEFERRED' && codes(rb).includes('PR_BASE_STALE') && prStates(b.s) === 'OPEN' && rb.closed.length === 0 && b.s.gh.created === 1 && b.s.gh.mergeCalls === 0, `${rb.outcome} ${codes(rb)} ${prStates(b.s)}`)
    const rb2 = await b.s.run(true)
    assert(rb2.outcome === 'MERGED_SERVED' && b.s.gh.created === 2 && b.s.gh.merges === 1 && prStates(b.s) === 'CLOSED,MERGED', `${rb2.outcome} ${codes(rb2)} ${prStates(b.s)}`)
  })
  await check('RR4', '날짜 변경 — 어제 PR 전에 멈춘 release 를 오늘 01:00 이 **같은 journal · 같은 브랜치 · 같은 commit** 으로 잇는다(새 releaseId 0 · 고아 브랜치 0)', async () => {
    for (const [stage, arm] of [['PUSHED', (s) => { s.gh.fault.createPr = 1 }], ['COMMITTED', (s) => { s.fault.push = 1 }]]) {
      const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
      arm(s)
      await assertRejects(() => s.run(true), 'KILLED')
      const j0 = oneJournal(s)
      assert(j0.state === stage && j0.releaseId.startsWith('20261120-') && j0.members[0].publishAt === '2026-11-21T10:30:00+09:00', `전제 ${stage}: ${j0.state} ${j0.releaseId}`)
      s.clock.t = KST('2026-11-21T01:00:00') // 날짜가 바뀌었다 — 공개 시각(10:30)은 아직 남았다
      const r = await s.run(true)
      const j = oneJournal(s)
      assert(r.outcome === 'MERGED_SERVED' && s.gh.created === 1 && s.gh.merges === 1 && j.releaseId === j0.releaseId && j.commitSha === j0.commitSha && s.gh.prs[0].headRefName === j0.branch,
        `${stage}: ${r.outcome} ${codes(r)} · journal ${s.journals().map((x) => `${x.releaseId}:${x.state}`)} · PR ${s.gh.created}`)
      assert(releasedRows(s.mainArticles())[0].publishAt === '2026-11-21T10:30:00+09:00' && s.remoteBranches().length === 0 && r.release === null, `${stage}: 날짜 · 잔존물 · 재조립`)
    }
  })
  await check('RR5', '날짜 변경 — 공개 시각까지 놓친 release 는 ABANDONED 로 정리하고 같은 plan · 같은 원고로 다시 조립한다(Job 바이트 불변 · 재생성 0 · 열린 PR 1)', async () => {
    const s = sandbox(F, { target: 1 }); const dir = s.putJob('I-F1-01')
    const jobBytes = () => ['job.json', 'article.json', 'hero.webp'].map((f) => sha256(readFileSync(join(dir, f)))).join()
    const before = jobBytes()
    s.gh.fault.createPr = 1
    await assertRejects(() => s.run(true), 'KILLED')
    const j0 = oneJournal(s)
    s.clock.t = KST('2026-11-21T11:00:00')
    const r = await s.run(true)
    const [a, b] = s.journals()
    assert(r.outcome === 'MERGED_SERVED' && s.journals().length === 2 && a.releaseId === j0.releaseId && a.state === 'ABANDONED' && a.abandonedBy === 'PUBLISH_AT_PAST' && b.state === 'MERGED', `${r.outcome} ${codes(r)} · ${s.journals().map((x) => `${x.releaseId}:${x.state}`)}`)
    assert(b.members[0].planHash === j0.members[0].planHash && b.members[0].manuscriptSha256 === j0.members[0].manuscriptSha256 && b.members[0].slug === j0.members[0].slug
      && b.members[0].publishAt === '2026-11-22T10:30:00+09:00' && jobBytes() === before, '다시 조립한 release 의 plan · 원고 · slug · Job 바이트')
    assert(s.gh.created === 1 && s.gh.merges === 1 && s.remoteBranches().length === 0, `PR ${s.gh.created} · 잔존 ${s.remoteBranches()}`)
    // commit 전에 멈춘 release — 다음 날 조립이 다른 id 면 ABANDONED(SUPERSEDED)로 적고 새 release 로 간다
    const t = sandbox(F, { target: 1 }); t.putJob('I-F1-01')
    t.fault.commit = 1
    await assertRejects(() => t.run(true), 'KILLED')
    assert(oneJournal(t).state === 'APPLIED', '전제 — APPLIED')
    t.clock.t = KST('2026-11-21T01:00:00')
    const rt = await t.run(true)
    const [ta, tb] = t.journals()
    assert(rt.outcome === 'MERGED_SERVED' && ta.state === 'ABANDONED' && ta.abandonedBy === 'SUPERSEDED' && ta.supersededBy === tb.releaseId && tb.state === 'MERGED' && t.gh.created === 1, `${rt.outcome} ${codes(rt)} · ${t.journals().map((x) => `${x.releaseId}:${x.state}`)}`)
  })
  await check('RR6', '닫기 실패 — CI 실패 · 날짜 놓침 · 낡은 base 에서 PR 을 닫지 못하면 RELEASE_CLOSE_FAILED · 닫았다고 적지 않는다 · 다시 조립하지 않는다 · 다음 회차가 같은 PR 을 닫는다', async () => {
    const a = sandbox(F, { target: 1 }); a.putJob('I-F1-01')
    a.gh.ci = () => 'failure'; a.gh.fault.closePr = 1
    const r1 = await a.run(true)
    assert(r1.outcome === 'RELEASE_CLOSE_FAILED' && codes(r1).join() === 'RELEASE_CI_FAILED,RELEASE_CLOSE_FAILED' && prStates(a) === 'OPEN' && oneJournal(a).state === 'PR_OPEN'
      && a.remoteBranches().length === 1 && r1.closed[0].ok === false, `${r1.outcome} ${codes(r1)} ${prStates(a)} ${oneJournal(a).state}`)
    const r2 = await a.run(true)
    assert(r2.outcome === 'RELEASE_CI_FAILED_CLOSED' && prStates(a) === 'CLOSED' && oneJournal(a).state === 'CLOSED' && a.gh.created === 1 && a.remoteBranches().length === 0, `${r2.outcome} ${prStates(a)}`)
    const b = sandbox(F, { release: 'draft', target: 1 }); b.putJob('I-F1-01')
    await b.run(true)
    b.clock.t = KST('2026-11-21T11:00:00'); b.gh.fault.closePr = 1
    const rb = await b.run(true)
    assert(rb.outcome === 'RELEASE_CLOSE_FAILED' && codes(rb).join() === 'RELEASE_CLOSE_FAILED' && prStates(b) === 'OPEN' && b.gh.created === 1 && oneJournal(b).state === 'PR_OPEN', `${rb.outcome} ${codes(rb)} · PR ${b.gh.created}`)
    const c = await pendingAt0100()
    git(c.s.HELP, 'fetch', '-q', 'origin'); git(c.s.HELP, 'checkout', '-q', '-B', 'main', 'origin/main')
    const p = join(c.s.HELP, R.ARTICLES_PATH)
    writeFileSync(p, R.insertArticleRows(readFileSync(p, 'utf8'), [{ slug: 'fx-human', body: { title: '합성 사람 글', description: '합성', cluster: 'family', publishedAt: '2026-11-25', status: 'SCHEDULED', publishAt: '2026-11-25T10:30:00+09:00', body: [] } }]))
    git(c.s.HELP, ...GIT_ENV, 'commit', '-q', '-am', 'human'); git(c.s.HELP, 'push', '-q', 'origin', 'main')
    c.s.gh.ci = () => 'success'; c.s.gh.fault.closePr = 1
    const rc = await c.s.run(true)
    assert(rc.outcome === 'RELEASE_CLOSE_FAILED' && codes(rc).includes('RELEASE_CLOSE_FAILED') && prStates(c.s) === 'OPEN' && c.s.gh.created === 1 && c.s.gh.mergeCalls === 0, `${rc.outcome} ${codes(rc)} · PR ${c.s.gh.created}`)
  })
  await check('RR7', 'freeze 와 복구 — 창 안의 01:00 · 02:00 복구는 같은 PR 을 두고 merge 0(MERGE_FROZEN) · 02:30 복구가 그 PR 을 merge · 20:00 경계', async () => {
    const s = sandbox(F, { target: 1, start: KST('2026-11-25T01:00:00') }); s.putJob('I-F1-01')
    const r1 = await s.run(true)
    assert(r1.outcome === 'MERGE_FROZEN' && s.gh.mergeCalls === 0 && s.gh.created === 1, `01:00 ${r1.outcome} ${codes(r1)}`)
    s.clock.t = KST('2026-11-25T02:00:00')
    const r2 = await s.recover()
    assert(r2.outcome === 'MERGE_FROZEN' && codes(r2).join() === 'MERGE_FREEZE_WINDOW' && s.gh.mergeCalls === 0 && prStates(s) === 'OPEN' && oneJournal(s).state === 'PR_OPEN', `02:00 ${r2.outcome} ${codes(r2)}`)
    s.clock.t = KST('2026-11-25T02:30:00')
    const r3 = await s.recover()
    assert(r3.outcome === 'MERGED_SERVED' && s.gh.merges === 1 && s.gh.created === 1, `02:30 ${r3.outcome} ${codes(r3)}`)
    for (const [at, frozen] of [['2026-11-25T19:59:59', false], ['2026-11-25T20:00:00', true]]) {
      const t = sandbox(F, { target: 1, start: KST(at) }); t.putJob('I-F1-01')
      const r = await t.run(true)
      assert(frozen ? r.outcome === 'MERGE_FROZEN' && t.gh.mergeCalls === 0 : r.outcome === 'MERGED_SERVED' && t.gh.merges === 1, `${at}: ${r.outcome} ${codes(r)}`)
    }
  })
  await check('RR8', '🔴 중복 merge 0 — merge 응답을 잃어도 다음 회차는 다시 merge 하지 않고 사실(MERGED)만 적는다 · MERGED 뒤 복구 · 재실행은 merge 호출 0', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.gh.fault.mergeLost = 1
    const r1 = await s.run(true)
    assert(r1.outcome === 'MERGE_BLOCKED' && codes(r1).join() === 'MERGE_FAILED' && s.gh.merges === 1 && s.gh.mergeCalls === 1 && oneJournal(s).state === 'PR_OPEN', `전제 ${r1.outcome} ${codes(r1)}`)
    const r2 = await s.recover()
    const j = oneJournal(s)
    assert(r2.outcome === 'RECOVER_NOTHING_OPEN' && s.gh.mergeCalls === 1 && j.state === 'MERGED' && j.mainVerified === true && j.mergeCommit === s.gh.prs[0].mergeCommit && j.serving.state === 'SERVED'
      && r2.settled[0]?.state === 'SERVED' && s.remoteBranches().length === 0, `${r2.outcome} ${codes(r2)} · merge 호출 ${s.gh.mergeCalls} · ${j.state}`)
    const r3 = await s.recover(), r4 = await s.run(true)
    assert(s.gh.mergeCalls === 1 && s.gh.created === 1 && r3.outcome === 'RECOVER_NOTHING_OPEN' && r4.outcome === 'NO_RELEASABLE_CANDIDATE' && releasedRows(s.mainArticles()).length === 1, `${r3.outcome} ${r4.outcome} · merge 호출 ${s.gh.mergeCalls}`)
  })
  await check('RR9', '재개 결속(끝에서 끝) — 01:00 이 PR 을 연 뒤 Job 의 hero · HOLD · PR head commit · journal 이 바뀌면 복구는 merge 0 · RESUME_HOLD · PR 을 닫지 않는다 · 무변경은 merge', async () => {
    const hold = async (label, mutate, want) => {
      const { s } = await pendingAt0100()
      await mutate(s)
      s.gh.ci = () => 'success'
      const r = await s.recover()
      assert(r.outcome === 'RESUME_HOLD' && codes(r).includes(want) && s.gh.mergeCalls === 0 && prStates(s) === 'OPEN' && r.closed.length === 0 && s.gh.created === 1, `${label}: ${r.outcome} ${codes(r)} · merge ${s.gh.mergeCalls} · ${prStates(s)}`)
      return { s, r }
    }
    await hold('검증 뒤 hero 가 바뀐 Job', (s) => { s.putJob('I-F1-01', { heroSalt: 'other-hero' }) }, 'RESUME_JOB_MISMATCH')
    await hold('검증 뒤 원고가 바뀐 Job', (s) => { s.putJob('I-F1-01', { article: articleFor(F.plan('I-F1-01'), { title: '합성 바뀐 제목 I-F1-01' }) }) }, 'RESUME_JOB_MISMATCH')
    await hold('ProviderPlan 기록이 바뀐 Job', (s) => { s.putJob('I-F1-01', { providerPlanHash: 'e'.repeat(64) }) }, 'RESUME_JOB_MISMATCH')
    await hold('HOLD 가 된 Job', (s) => { s.putJob('I-F1-01', { hold: { reason: '합성 HOLD' } }) }, 'RESUME_JOB_MISSING')
    await hold('journal 이 없는 release PR', (s) => { rmSync(J.journalPathOf(s.stateRoot, s.journals()[0].releaseId)) }, 'RESUME_JOURNAL_MISSING')
    // PR 브랜치의 commit 이 바뀌었다 — 트리가 같아도(메시지만 다른 commit) 원본 commit 이 아니면 보류다
    const amend = (edit) => (s) => {
      const branch = s.gh.prs[0].headRefName
      git(s.HELP, 'fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`); git(s.HELP, 'checkout', '-q', '-B', 'rewrite', `origin/${branch}`)
      edit(s)
      git(s.HELP, ...GIT_ENV, 'commit', '-q', '--amend', '--allow-empty', '-a', '-m', 'rewritten'); git(s.HELP, 'push', '-q', '-f', 'origin', `rewrite:refs/heads/${branch}`)
    }
    const same = await hold('같은 트리 · 다른 commit', amend(() => {}), 'RESUME_COMMIT_MISMATCH')
    assert(!codes(same.r).includes('RESUME_BYTES_MISMATCH'), `트리가 같은데 바이트 불일치: ${codes(same.r)}`)
    const swapped = await hold('hero 바이트만 바꾼 commit', amend((s) => { writeFileSync(join(s.HELP, R.heroFilePath(s.journals()[0].members[0].slug)), webp(1200, 675, 'swapped-hero')) }), 'RESUME_BYTES_MISMATCH')
    assert(codes(swapped.r).includes('RESUME_COMMIT_MISMATCH'), `${codes(swapped.r)}`)
    const ok = await pendingAt0100()
    ok.s.gh.ci = () => 'success'
    const r = await ok.s.recover()
    assert(r.outcome === 'MERGED_SERVED' && r.merge.checked.some((c) => c.startsWith('재개 결속')), `대조군 ${r.outcome} ${codes(r)}`)
  })
  await check('RR10', 'merge ≠ 서빙 — merge 뒤 그 SHA 가 아직 서빙되지 않으면 MERGED_SERVING_PENDING(journal MERGED · serving PENDING) · 다음 회차가 한 번 다시 관측 · SERVED 뒤 같은 SHA 재관측 0 · 재 merge 0', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.gh.serving = () => false
    const r1 = await s.run(true)
    const j1 = oneJournal(s), sha = s.gh.prs[0].mergeCommit
    assert(r1.outcome === 'MERGED_SERVING_PENDING' && r1.merge.merged && r1.merge.verified && r1.serving.state === 'PENDING' && r1.serving.code === 'VERCEL_SHA_MISMATCH' && codes(r1).length === 0, `${r1.outcome} ${codes(r1)}`)
    assert(j1.state === 'MERGED' && j1.mainVerified === true && j1.serving.state === 'PENDING' && j1.serving.sha === sha && s.gh.servingCalls.every((x) => x === sha) && s.gh.servingCalls.length === j1.serving.attempts, `journal ${JSON.stringify(j1.serving)}`)
    const n1 = s.gh.servingCalls.length
    const r2 = await s.recover() // 아직 서빙 전 — 한 번만 다시 본다(기다리지 않는다)
    assert(r2.outcome === 'RECOVER_NOTHING_OPEN' && s.gh.servingCalls.length === n1 + 1 && r2.settled[0].state === 'PENDING' && oneJournal(s).serving.attempts === n1 + 1, `${r2.outcome} 관측 ${s.gh.servingCalls.length - n1}`)
    s.gh.serving = () => true
    const r3 = await s.recover()
    assert(s.gh.servingCalls.length === n1 + 2 && r3.settled[0].state === 'SERVED' && oneJournal(s).serving.state === 'SERVED' && oneJournal(s).serving.deploymentId, `${JSON.stringify(r3.settled)}`)
    const r4 = await s.recover(), r5 = await s.run(true)
    assert(s.gh.servingCalls.length === n1 + 2 && r4.settled.length === 0 && r5.settled.length === 0 && s.gh.mergeCalls === 1 && s.gh.merges === 1, `SERVED 뒤 재관측 ${s.gh.servingCalls.length - n1 - 2} · merge 호출 ${s.gh.mergeCalls}`)
    // 관측 상한 — 끝없이 다시 보지 않는다. 넘으면 UNRESOLVED 로 한 번 막고(사람이 본다) 그 뒤로는 관측 0
    const t = sandbox(F, { target: 1 }); t.putJob('I-F1-01')
    t.gh.serving = () => false
    await t.run(true)
    const jp = J.journalPathOf(t.stateRoot, oneJournal(t).releaseId)
    J.noteJournal(jp, J.readJournal(jp), { serving: { ...J.readJournal(jp).serving, attempts: RUN.RELEASE_SERVING_MAX_ATTEMPTS - 1 } })
    const m0 = t.gh.servingCalls.length
    const u1 = await t.recover(), u2 = await t.recover()
    assert(u1.outcome === 'MERGED_SERVING_UNRESOLVED' && codes(u1).join() === 'SERVING_UNRESOLVED' && oneJournal(t).serving.state === 'UNRESOLVED' && t.gh.servingCalls.length === m0 + 1
      && u2.outcome === 'RECOVER_NOTHING_OPEN' && u2.settled.length === 0, `${u1.outcome} ${codes(u1)} / ${u2.outcome} · 관측 ${t.gh.servingCalls.length - m0}`)
  })
  await check('RR11', 'merge 응답만 성공이고 main 에 행이 없으면 MERGED_UNVERIFIED — 서빙을 관측하지 않는다(확인 못 한 merge 를 서빙됐다고 적지 않는다) · 다음 회차도 새 release 0', async () => {
    const s = sandbox(F, { target: 1 }); s.putJob('I-F1-01')
    s.gh.fault.mergeHollow = 1
    const r1 = await s.run(true)
    assert(r1.outcome === 'MERGED_UNVERIFIED' && codes(r1).join() === 'MERGE_UNVERIFIED' && r1.merge.verified === false && s.gh.servingCalls.length === 0 && oneJournal(s).mainVerified === false, `${r1.outcome} ${codes(r1)} · 관측 ${s.gh.servingCalls.length}`)
    const r2 = await s.run(true)
    assert(r2.outcome === 'MERGED_UNVERIFIED' && s.gh.created === 1 && s.gh.servingCalls.length === 0 && s.journals().length === 1, `${r2.outcome} · PR ${s.gh.created}`)
  })
  await check('RR12', 'CLI · 02:00 배선 — `magazine-release --recover` 는 legacy rollout 에서 NOT_VNEXT · --apply 와 함께는 사용법 오류 · 실제 `magazine-auto-merge --recover` 가 vnext 에서 release 복구만 부른다(legacy 복구 0)', () => {
    const home = mkdtempSync(join(TMP, 'cli-rec-'))
    const cli = (args) => spawnSync(process.execPath, [join(ROOT, 'scripts/magazine-release.mjs'), ...args], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH }, timeout: 60000 })
    const a = cli(['--recover']), b = cli(['--recover', '--apply'])
    assert(a.status === 0 && JSON.parse(a.stdout.trim().split('\n').pop()).outcome === 'NOT_VNEXT' && JSON.parse(a.stdout.trim().split('\n').pop()).mode === 'recover' && !existsSync(join(home, 'Library')) && b.status === 2, `${a.status} ${a.stdout.slice(-160)} · ${b.status}`)
    // 실제 진입점 파일을 임시 트리에 복사하고 release CLI 만 대역으로 바꾼다 — git · gh 는 PATH 에 없다(외부 호출 0)
    const tree = mkdtempSync(join(TMP, 'recover-wire-'))
    mkdirSync(join(tree, 'scripts/lib'), { recursive: true })
    for (const f of readdirSync(join(ROOT, 'scripts/lib')).filter((x) => x.endsWith('.mjs'))) writeFileSync(join(tree, 'scripts/lib', f), readFileSync(join(ROOT, 'scripts/lib', f)))
    writeFileSync(join(tree, 'scripts/magazine-auto-merge.mjs'), readFileSync(join(ROOT, 'scripts/magazine-auto-merge.mjs')))
    writeFileSync(join(tree, 'scripts/magazine-release.mjs'), "import { appendFileSync } from 'node:fs'\nappendFileSync(process.env.STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')\nprocess.exit(Number(process.env.STUB_EXIT ?? 0))\n")
    const emptyBin = mkdtempSync(join(TMP, 'empty-bin-'))
    const wire = (rollout, exit) => {
      const h = mkdtempSync(join(TMP, 'wire-home-')), log = join(h, 'stub.log')
      if (rollout) {
        const rp = join(h, 'Library', 'Application Support', 'soransoran'); mkdirSync(rp, { recursive: true })
        writeFileSync(join(rp, 'magazine-rollout.json'), JSON.stringify({ schemaVersion: 'magazine-rollout/1', path: rollout, release: 'auto', targetCandidates: 1, changedBy: 'release-check',
          changedAt: '2026-11-24T00:00:00.000Z', previous: { path: 'legacy', release: 'draft', targetCandidates: 1 } }))
      }
      const r = spawnSync(process.execPath, [join(tree, 'scripts/magazine-auto-merge.mjs'), '--recover'], { encoding: 'utf8', cwd: tree, timeout: 120000,
        env: { HOME: h, PATH: emptyBin, STUB_LOG: log, STUB_EXIT: String(exit) } })
      return { status: r.status, out: `${r.stdout}${r.stderr}`, calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] }
    }
    const v0 = wire('vnext', 0), v1 = wire('vnext', 1)
    assert(v0.status === 0 && v1.status === 1 && JSON.stringify(v0.calls) === JSON.stringify(['["--recover"]']) && JSON.stringify(v1.calls) === JSON.stringify(['["--recover"]'])
      && !v0.out.includes('자동 병합 복구 (') && !v1.out.includes('자동 병합 복구 ('), `vnext: ${v0.status}/${v1.status} ${v0.calls} ${v0.out.slice(-200)}`)
    for (const mode of ['legacy', null]) {
      const l = wire(mode, 0)
      assert(l.calls.length === 0 && l.out.includes('자동 병합 복구 ('), `${mode ?? '없음'}: release 복구를 불렀다 ${l.calls} ${l.out.slice(-200)}`)
    }
  })

  // ════ RB2 — 경계 ═══════════════════════════════════════════
  await check('RB5', '실제 git · gh 명령 인자 — merge 는 --squash --match-head-commit <검증 head> · --admin 0 · push 강제 0 · Draft 만 --draft · add 는 파일 이름 · 브랜치 삭제는 release 접두만', () => {
    const calls = []
    const exec = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { code: 0, out: cmd === 'gh' && args[1] === 'create' ? 'https://example.invalid/pull/7\n' : '', err: '' } }
    const d = RUN.makeReleaseDeps({ root: TMP, stateRoot: TMP, jobsRoot: TMP, readRollout: () => null, readCandidates: () => null, exec })
    d.mergePr(7, 'h'.repeat(40))
    d.push({ dir: TMP, branch: `${R.RELEASE_BRANCH_PREFIX}x`, sha: 's'.repeat(40) })
    d.createPr({ branch: `${R.RELEASE_BRANCH_PREFIX}x`, title: 't', body: 'b', draft: true }); d.createPr({ branch: `${R.RELEASE_BRANCH_PREFIX}y`, title: 't', body: 'b', draft: false })
    d.commit({ dir: TMP, paths: [R.ARTICLES_PATH], message: 'm' })
    const before = calls.length
    const del = d.deleteBranch('main')
    const all = calls.join('\n')
    assert(all.includes(`gh pr merge 7 --squash --match-head-commit ${'h'.repeat(40)}`) && !/--admin|--force|-f\b/.test(all), all)
    assert(calls.filter((c) => c.startsWith('gh pr create')).map((c) => c.includes('--draft')).join() === 'true,false', 'Draft 인자')
    assert(calls.some((c) => c === `git add -- ${R.ARTICLES_PATH}`) && !calls.some((c) => /git add (\.|-A)/.test(c)), 'add')
    assert(del === false && calls.length === before, 'release 접두가 아닌 브랜치를 지우려 했다')
  })
  await check('RB3', 'vNext release 진입점의 import 폐포에 legacy 모듈 0 · legacy 상수와 같은 값(필수 검사 · 결론 · 자동 브랜치 접두)', async () => {
    const LEGACY = ['scripts/magazine-auto-merge.mjs', 'scripts/lib/magazine-merge-gate.mjs', 'scripts/magazine-register.mjs', 'scripts/lib/magazine-load.mjs',
      'scripts/lib/magazine-queue-lock.mjs', 'scripts/lib/magazine-auto-lock.mjs', 'scripts/lib/magazine-g8-promoter.mjs', 'scripts/lib/magazine-quarantine.mjs',
      'scripts/lib/magazine-direct-spec.mjs', 'scripts/lib/magazine-direct-spec-source.mjs', 'scripts/lib/magazine-validation-profile.mjs', 'scripts/lib/slack-notify.mjs']
    // 정본 lexer(R17 과 같은 codeTokens) — 주석 · 문자열 안의 가짜 import 를 세지 않는다
    const { codeTokens } = await import('./lib/magazine-graph-control.mjs')
    const seen = new Set(), queue = ['scripts/magazine-release.mjs']
    while (queue.length) {
      const f = queue.shift(); if (seen.has(f)) continue; seen.add(f)
      const src = readFileSync(join(ROOT, f), 'utf8')
      const toks = codeTokens(src)
      for (let i = 0; i < toks.length - 1; i++) {
        const t = toks[i], n = toks[i + 1]
        if (t.type === 'word' && (t.value === 'from' || t.value === 'import') && n.type === 'string') {
          const spec = src.slice(n.start + 1, n.end - 1)
          if (spec.startsWith('.')) queue.push(posix.normalize(posix.join(posix.dirname(f), spec)))
        }
      }
    }
    assert(seen.has('scripts/lib/magazine-release-run.mjs') && seen.has('scripts/lib/magazine-content-plan.mjs') && seen.has('scripts/lib/magazine-deploy-evidence.mjs'), `폐포 추적이 비었다 ${[...seen]}`)
    const hit = [...seen].filter((f) => LEGACY.includes(f))
    assert(hit.length === 0, `legacy 도달: ${hit.join(', ')}`)
    const MG = await import('./lib/magazine-merge-gate.mjs')
    assert(JSON.stringify(RUN.RELEASE_REQUIRED_CHECKS) === JSON.stringify(MG.REQUIRED_CHECKS) && JSON.stringify(RUN.RELEASE_OK_CONCLUSIONS) === JSON.stringify(MG.OK_CONCLUSIONS)
      && JSON.stringify(RUN.RELEASE_REQUIRED_CONCLUSIONS) === JSON.stringify(MG.REQUIRED_CONCLUSIONS) && RUN.LEGACY_AUTO_PREFIX === MG.AUTO_BRANCH_PREFIX, 'legacy 상수와 다르다')
    assert(!R.RELEASE_BRANCH_PREFIX.startsWith(MG.AUTO_BRANCH_PREFIX) && !MG.AUTO_BRANCH_PREFIX.startsWith(R.RELEASE_BRANCH_PREFIX), '접두가 겹친다(legacy 병합기가 release PR 을 집는다)')
  })
  await check('RB4', 'CLI — legacy rollout(임시 HOME)이면 NOT_VNEXT · exit 0 · 상태 폴더 0 · 모르는 인자 exit 2', () => {
    const home = mkdtempSync(join(TMP, 'cli-'))
    const run = (args) => spawnSync(process.execPath, [join(ROOT, 'scripts/magazine-release.mjs'), ...args], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH }, timeout: 60000 })
    const a = run([]), b = run(['--bogus'])
    assert(a.status === 0 && JSON.parse(a.stdout.trim().split('\n').pop()).outcome === 'NOT_VNEXT' && !existsSync(join(home, 'Library')) && b.status === 2, `${a.status} ${a.stdout.slice(-200)} ${a.stderr.slice(-200)} · ${b.status}`)
  })
} finally {
  cleanupFixtureBootstrap()
  rmSync(TMP, { recursive: true, force: true })
}

async function assertRejects(fn, code) {
  let got = null
  try { await fn() } catch (e) { got = e.code ?? e.message }
  if (got !== code) throw new Error(`기대한 ${code} 가 아니다: ${got}`)
}

console.log(`\nrelease 검사: ${pass} pass, ${fail} fail`)
process.exit(selectedCase && selectedCount === 0 ? 2 : fail ? 1 : 0)
