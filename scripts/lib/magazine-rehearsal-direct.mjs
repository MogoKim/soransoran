/**
 * 🔴 **DIRECT_E2E rehearsal 자료** (2026-11-02 · I-T6-03 `resume-age` promote 전 release gate).
 *
 *    legacy 시나리오(S1~S14)는 brief·review 경로만 돈다. 신규 DIRECT 글이 실제 producer → fetch → 원고 →
 *    auto-register → register 로 끝까지 가는지는 아무 시나리오도 보지 않았다. 이 모듈은 그 한 묶음의 입력을 만든다.
 *
 *    입력은 전부 승인 후보와 같은 계약의 **고정 fixture** 다 (`scripts/__fixtures__/magazine/rehearsal-direct-e2e/`):
 *      g-20261102-427d4d.ts.txt                 실제 graph build CLI 산출 bundle (바이트 그대로)
 *      article-spec-source.g-20261102-427d4d.json 실제 ArticlePlan approve 산출 (scratch G8 receipt 위) — 손으로 만들지 않았다
 *      queue-row.ts.txt                         실제 materialize 산출 큐 행
 *      resume-age.draft.md                      승인 spec 을 지키는 고정 원고 (가짜 ChatGPT 가 돌려준다)
 *    `manifest.json` 이 각 파일의 sha256 과 기대 신원을 고정한다. 하나라도 어긋나면 쓰기 전에 throw (fail-closed).
 *
 * 🔴 sandbox 사본에만 쓴다 — 실제 runtime·제품 graph·source·queue 는 읽기만 한다 (runtime 불변 단언이 지킨다).
 * 🔴 판정을 흉내 내지 않는다. 등록 여부는 실제 래퍼가 정한다. 여기서는 자료를 놓고 사실을 모을 뿐이다.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DIRECT_E2E_DIR = join('scripts', '__fixtures__', 'magazine', 'rehearsal-direct-e2e')
export const DIRECT_E2E_SCHEMA = 'rehearsal-direct-e2e/1'

const imp = (repo, rel) => import(pathToFileURL(join(repo, rel)).href)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const read = (repo, name) => readFileSync(join(repo, DIRECT_E2E_DIR, name), 'utf8')

/** provenance fail-closed — 파일 sha256 · 신원 · 원고가 spec 계약(제목·CTA·주제 금지 패턴)을 지키는지 */
export function directFixture(repo) {
  const bad = (why) => { throw new Error(`rehearsal DIRECT_E2E fixture 거부 — ${why}`) }
  const m = JSON.parse(read(repo, 'manifest.json'))
  if (m?.schema !== DIRECT_E2E_SCHEMA) bad(`schema ${JSON.stringify(m?.schema)} ≠ ${DIRECT_E2E_SCHEMA}`)
  const files = {}
  for (const [name, want] of Object.entries(m.files ?? {})) {
    const text = read(repo, name)
    if (sha(text) !== want) bad(`${name} sha256 ${sha(text)} ≠ ${want}`)
    files[name] = text
  }
  for (const n of ['bundle', 'source', 'queueRow', 'draft']) if (!files[m.names?.[n]]) bad(`${n} 파일이 manifest 에 없다`)
  const source = JSON.parse(files[m.names.source])
  const entry = source.entries?.[0]
  const id = m.identity
  if (source.graphVersion !== id.graphVersion || source.entries?.length !== 1) bad('source 판 · entry 수가 기대와 다르다')
  if (entry?.node?.slug !== id.slug || entry?.node?.intentId !== id.intentId || entry?.admission?.g8ManifestHash !== id.g8ManifestHash) bad('source entry 신원이 기대와 다르다')
  if (entry?.sourceHash !== id.sourceHash || entry?.publication?.publishAt !== id.publishAt) bad('source sourceHash · publishAt 이 기대와 다르다')
  const row = files[m.names.queueRow]
  for (const s of [`slug: '${id.slug}',`, `g8ManifestHash: '${id.g8ManifestHash}',`, `articlePlanHash: '${id.sourceHash}',`, "directSpecMode: 'DIRECT_SPEC_V1',"]) {
    if (!row.includes(s)) bad(`큐 행에 ${s} 가 없다`)
  }
  const bundle = files[m.names.bundle]
  if (!bundle.includes(`"graphVersion": "${id.graphVersion}"`) || !bundle.includes(`EXPORT_HASH = '${id.exportHash}'`)) bad('bundle 판 · exportHash 가 기대와 다르다')
  const draft = files[m.names.draft]
  if (!draft.startsWith(`---\ntitle: ${entry.plan.title}\n`)) bad('원고 제목이 승인 plan 제목과 다르다')
  const hits = (entry.node.forbiddenPatterns ?? []).filter((p) => draft.includes(p))
  if (hits.length) bad(`원고에 승인 주제 금지 패턴이 있다: ${hits.join(' · ')}`)
  if (!draft.trimEnd().split('\n').pop().startsWith(`[CTA] ${entry.plan.ctaBoard} | ${entry.node.ctaLabel} | `)) bad('원고 마지막 줄이 승인 CTA 가 아니다')
  return { manifest: m, id, entry, source, files, names: m.names }
}

/**
 * 가짜 ChatGPT 의 DIRECT 원고 — 회차별 모양.
 *   good             fixture 원고 그대로
 *   topic-forbidden  승인 주제 금지 패턴 하나가 본문에 들어간 원고 (그 밖은 같다)
 */
export function directManuscriptFor({ repo, mode = 'good' }) {
  const fx = directFixture(repo)
  const draft = fx.files[fx.names.draft]
  if (mode === 'good') return draft
  if (mode === 'topic-forbidden') return draft.replace('충분합니다.', '충분합니다. 이렇게만 적으면 무조건 합격이라는 말도 있습니다.')
  // magazine QA 는 보지 않고 batch QA 만 보는 거절 정형구 — batch 단계 실패 반례
  if (mode === 'batch-refusal') return draft.replace('충분합니다.', '충분합니다. 다만 개별 회사의 채용 기준은 여기서 제공할 수 없습니다.')
  throw new Error(`DIRECT 원고 모드 ${mode} 를 모른다`)
}

/** sandbox 사본 articles.ts 에서 slug 하나를 뺀다 — 실제 runtime 에 그 글이 등록된 뒤에도 같은 "등록 전" 모양을 만든다 */
function withoutArticleIn(src, slug, parse) {
  if (!parse(src).some((a) => a.slug === slug)) return src
  const at = src.indexOf(`\n  '${slug}': {\n`)
  const end = at < 0 ? -1 : src.indexOf('\n  },\n', at + 1)
  if (at < 0 || end < 0) throw new Error(`articles.ts 에서 ${slug} 항목 경계를 찾지 못했다`)
  const next = src.slice(0, at) + src.slice(end + 5)
  if (parse(next).some((a) => a.slug === slug)) throw new Error(`articles.ts 에서 ${slug} 를 빼지 못했다`)
  return next
}

/**
 * sandbox 사본을 DIRECT_E2E 모양으로 — 큐는 resume-age 행 하나 · 승인 source · 승격된 판(current·control).
 *   variant  반례용 변조 (기본 없음). 변조는 자료 하나만 바꾼다 — 나머지는 정상과 같다.
 *     'graph-not-promoted'  current·control 을 승격하지 않는다 (제품 판 ≠ source 판)
 *     'manifest-mismatch'   큐 행 g8ManifestHash 한 글자 변조
 *     'source-hash-mismatch' source entry 의 plan.notes 한 글자 변조 (sourceHash 는 그대로)
 *     'queue-duplicate'     같은 행을 day 를 달리해 한 번 더
 *     'article-duplicate'   sandbox articles.ts 에 resume-age 가 이미 있다 (age-learning 항목을 slug 만 바꿔 복제)
 *     'review-present'      DIRECT 원고 폴더에 review.ts 가 이미 있다
 */
export async function prepareDirect(repo, { variant = null } = {}) {
  const fx = directFixture(repo)
  const { id } = fx
  const L = await imp(repo, 'scripts/lib/magazine-load.mjs')
  const parse = (src) => L.parseArticlesSource(src)
  // ① 큐 — 다른 행은 비우고(curate 가 실제 removeQueueDay 로) DIRECT 행 하나
  const qPath = join(repo, 'drafts', 'magazine', 'topic-queue.ts')
  let qsrc = readFileSync(qPath, 'utf8')
  const end = qsrc.lastIndexOf('\n]')
  if (end < 0) throw new Error('sandbox 큐 배열 끝을 찾지 못했다')
  let row = fx.files[fx.names.queueRow]
  if (variant === 'manifest-mismatch') row = row.replace(id.g8ManifestHash, `0${id.g8ManifestHash.slice(1)}`)
  const rows = variant === 'queue-duplicate' ? `${row}${row.replace(/day: \d+,/, 'day: 9062,')}` : row
  qsrc = `${qsrc.slice(0, end + 1)}${rows}${qsrc.slice(end + 1)}`
  const parsed = L.parseQueueSource(qsrc).filter((q) => q.slug === id.slug)
  if (parsed.length !== (variant === 'queue-duplicate' ? 2 : 1)) throw new Error(`sandbox 큐의 ${id.slug} 행 수가 다르다: ${parsed.length}`)
  writeFileSync(qPath, qsrc)
  // ② 승인 source — approve 산출 그대로 (반례만 한 글자)
  let sourceText = fx.files[fx.names.source]
  if (variant === 'source-hash-mismatch') sourceText = sourceText.replace('칸 표기 형식까지만.', '칸 표기 형식까지만!')
  const sdir = join(repo, 'drafts', 'magazine', 'article-spec-source')
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, `${id.graphVersion}.json`), sourceText)
  // ③ 승격된 판 — promote 가 바꾸는 세 파일 (bundle 추가 · current 가리킴 · control graphVersion·previous)
  //    🔴 (2026-11-02) 제품이 이미 이 판으로 승격됐으면 그대로 두고 bundle 바이트만 대조한다 (fixture 는 판이 바뀌어도 그대로다).
  //       'graph-not-promoted' 반례는 그때 control.previousGraphVersion 판으로 되돌려 "source 판 ≠ 제품 판" 을 만든다.
  const gdir = join(repo, 'src', 'content', 'magazine', 'graph')
  const cur = readFileSync(join(gdir, 'current.ts'), 'utf8')
  const ctl = readFileSync(join(gdir, 'control.ts'), 'utf8')
  const now = /from '\.\/(g-\d{8}-[0-9a-f]{6})'/.exec(cur)?.[1]
  if (!now) throw new Error('current.ts 에서 지금 판을 찾지 못했다')
  const bundlePath = join(gdir, `${id.graphVersion}.ts`)
  if (existsSync(bundlePath) && readFileSync(bundlePath, 'utf8') !== fx.files[fx.names.bundle]) throw new Error(`제품 ${id.graphVersion}.ts 가 DIRECT_E2E fixture bundle 과 바이트가 다르다`)
  writeFileSync(bundlePath, fx.files[fx.names.bundle])
  const promotedAlready = now === id.graphVersion
  const prev = promotedAlready ? /previousGraphVersion: '([^']*)',/.exec(ctl)?.[1] : now
  if (!prev) throw new Error('control.ts 에서 이전 판을 찾지 못했다')
  const setControl = (gv, pv) => {
    const next = ctl.replace(/\n  graphVersion: '[^']*',/, `\n  graphVersion: '${gv}',`).replace(/previousGraphVersion: '[^']*',/, `previousGraphVersion: '${pv}',`)
    if (!next.includes(`  graphVersion: '${gv}',`)) throw new Error('control.ts 판 신원을 바꾸지 못했다')
    writeFileSync(join(gdir, 'control.ts'), next)
  }
  if (variant === 'graph-not-promoted') {
    if (promotedAlready) {
      if (!existsSync(join(gdir, `${prev}.ts`))) throw new Error(`이전 판 ${prev}.ts 가 제품에 없다 — 미승격 반례를 만들 수 없다`)
      writeFileSync(join(gdir, 'current.ts'), cur.replace(`from './${now}'`, `from './${prev}'`))
      setControl(prev, 'g-00000000-000000')
    }
  } else if (!promotedAlready) {
    writeFileSync(join(gdir, 'current.ts'), cur.replace(`from './${now}'`, `from './${id.graphVersion}'`))
    setControl(id.graphVersion, now)
  }
  // ④ articles — 대상은 "등록 전" · 예약일이 비어 있어야 한다 (실제 runtime 이 그 날을 채웠다면 fixture 가 낡았다)
  const aPath = join(repo, 'src', 'content', 'magazine', 'articles.ts')
  let asrc = withoutArticleIn(readFileSync(aPath, 'utf8'), id.slug, parse)
  const day = id.publishAt.slice(0, 10)
  const taken = parse(asrc).filter((a) => (a.publishAt ?? '').startsWith(day) || a.publishedAt === day).map((a) => a.slug)
  if (taken.length) throw new Error(`sandbox articles 에 ${day} 예약이 이미 있다 (${taken.join(',')}) — DIRECT_E2E fixture 의 publishAt 이 낡았다`)
  if (variant === 'article-duplicate') {
    const at = asrc.indexOf("\n  'age-learning': {\n")
    const stop = asrc.indexOf('\n  },\n', at + 1)
    if (at < 0 || stop < 0) throw new Error('복제할 age-learning 항목을 찾지 못했다')
    asrc = asrc.slice(0, at) + asrc.slice(at, stop + 5).replace("'age-learning': {", `'${id.slug}': {`) + asrc.slice(at)
    if (parse(asrc).filter((a) => a.slug === id.slug).length !== 1) throw new Error('article-duplicate 반례 준비 실패')
  }
  writeFileSync(aPath, asrc)
  if (variant === 'stale-receipt') {
    // 앞 등록 시도의 영수증이 다른 spec 으로 남아 있다 — register 뒤 영수증 단계가 막혀야 한다
    mkdirSync(join(repo, 'drafts', 'magazine', id.slug), { recursive: true })
    writeFileSync(join(repo, 'drafts', 'magazine', id.slug, 'article-spec.registered.json'), `${JSON.stringify({
      schema: 'direct-spec-register/1', schemaVersion: 'magazine-article-spec/2', mode: 'DIRECT_SPEC_V1', specHash: `sha256:${'0'.repeat(64)}`,
      slug: id.slug, graphNodeId: id.intentId, intentId: id.intentId, publishAt: id.publishAt, registeredAt: '2026-11-02T01:00:00+09:00' }, null, 2)}\n`)
  }
  if (variant === 'review-present') {
    mkdirSync(join(repo, 'drafts', 'magazine', id.slug), { recursive: true })
    writeFileSync(join(repo, 'drafts', 'magazine', id.slug, 'review.ts'), readFileSync(join(repo, 'drafts', 'magazine', 'avoiding-gatherings', 'review.ts'), 'utf8'))
  }
  return { target: id.slug, identity: id, variant, previousGraphVersion: prev,
    untrack: [`drafts/magazine/${id.slug}`].filter((p) => existsSync(join(repo, p))) }
}

/**
 * 🔴 **DIRECT 고정 회차 격리** (2026-11-03 · S15 rehearsal 수리).
 *    sandbox 는 runtime 의 `drafts/magazine` 을 그대로 복사하므로 `_runs/` 도 따라온다. S15 계열은 고정 회차
 *    (`DIRECT_DATE`)를 쓰는데, runtime 에 그 날짜의 자연 회차(COMPLETED run.json)가 이미 있으면 producer 가
 *    "같은 날 지금 판 COMPLETED 는 다시 계산하지 않는다" 계약대로 새 S15 실행 전에 끝난다 — 시험이 runtime 날짜에 묶인다.
 *    그래서 **sandbox 사본에서만**, 기준 커밋 전에 S15 가 소유하는 그 한 날짜 폴더를 sandbox 루트의 `isolated-runs/` 로 옮긴다.
 *    다른 날짜 이력은 그대로 둔다. runtime 원본은 읽기만 한다(복사 뒤 사본만 움직인다).
 * @returns {{date:string, moved:boolean, files:string[], staleCompleted:boolean, dest:string|null, otherDates:string[]}}
 */
export function isolateDirectRunDay(repo, date) {
  const runs = join(repo, 'drafts', 'magazine', '_runs')
  const own = join(runs, date)
  const otherDates = existsSync(runs) ? readdirSync(runs).filter((n) => n !== date).sort() : []
  if (!existsSync(own)) return { date, moved: false, files: [], staleCompleted: false, dest: null, otherDates }
  const files = readdirSync(own).sort()
  let staleCompleted = false
  try { staleCompleted = JSON.parse(readFileSync(join(own, 'run.json'), 'utf8'))?.status === 'COMPLETED' } catch { staleCompleted = false }
  const dest = join(dirname(repo), 'isolated-runs', date)
  mkdirSync(dirname(dest), { recursive: true })
  renameSync(own, dest)
  return { date, moved: true, files, staleCompleted, dest, otherDates }
}

/** S15S 반례 — runtime 사본에 같은 고정 회차의 stale COMPLETED run.json 이 있는 모양을 결정적으로 만든다 (sandbox 사본만) */
export const STALE_RUN_MARKER = 'rehearsal-stale-direct-day'
export function plantStaleDirectRun(repo, date) {
  const own = join(repo, 'drafts', 'magazine', '_runs', date)
  mkdirSync(own, { recursive: true })
  writeFileSync(join(own, 'run.json'), `${JSON.stringify({ schemaVersion: 'producer-run/2', date, status: 'COMPLETED', selected: [], reusable: [], held: [], marker: STALE_RUN_MARKER }, null, 2)}\n`)
}

/** 등록 뒤 사실 — origin main 의 articles · queue · 영수증 (읽기만) */
export async function directFacts(sb, slug) {
  const { spawnSync } = await import('node:child_process')
  const show = (path) => { const r = spawnSync('/usr/bin/git', ['--git-dir', sb.origin, 'show', `main:${path}`], { encoding: 'utf8' }); return r.status === 0 ? r.stdout : null }
  const L = await imp(sb.repo, 'scripts/lib/magazine-load.mjs')
  const arts = show('src/content/magazine/articles.ts')
  const queue = show('drafts/magazine/topic-queue.ts')
  const receipt = show(`drafts/magazine/${slug}/article-spec.registered.json`)
  const review = show(`drafts/magazine/${slug}/review.ts`)
  const list = arts ? L.parseArticlesSource(arts).filter((a) => a.slug === slug) : []
  return {
    articles: list.map((a) => ({ slug: a.slug, status: a.status ?? null, publishAt: a.publishAt ?? null, publishedAt: a.publishedAt ?? null, heroImage: a.heroImage ?? null, title: a.title })),
    queueRows: queue ? L.parseQueueSource(queue).filter((q) => q.slug === slug).length : null,
    receipt: receipt ? JSON.parse(receipt) : null,
    reviewTs: review !== null,
    spec: existsSync(join(sb.repo, 'drafts', 'magazine', slug, 'article-spec.json')) ? JSON.parse(readFileSync(join(sb.repo, 'drafts', 'magazine', slug, 'article-spec.json'), 'utf8')) : null,
  }
}
