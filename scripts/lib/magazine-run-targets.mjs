/**
 * 회차의 **대상 계약** — `run.json` 하나를 두 소비자가 같은 방식으로 읽는다.
 *
 * 🔴 **왜 하나로 묶는가** (2026-09-28 공급 0건 · Codex 재검토).
 *    `run.json` 에는 두 목록이 있다:
 *      `selected`  이번에 **새로 만들** 주제
 *      `reusable`  새로 만들 필요는 없지만 **재료가 이미 있는** 주제
 *
 *    그런데 소비자 둘이 각자 `selected` 만 읽었다:
 *      · `magazine-webui-runner --fetch-run` (원고 회수)
 *      · `magazine-auto-register-ready` 의 `scan({ runDate })` (등록 후보)
 *
 *    2026-09-28 실측은 `selected 0 · reusable 17` 이었다. 재료가 17건 있는데
 *    **둘 다 0건을 봤다.** `reusable` 을 만들어 두고 **연결하지 않으면 없는 것과 같다.**
 *
 * 🔴 **폴더 존재로 판정하지 않는다.** 폴더가 있어도 `brief.md` 가 없으면 회수할 수 없고,
 *    `draft.md` 가 없으면 변환할 수 없다. 단계별 상태를 나눠 소비자가 고르게 한다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 한 주제의 재료가 어디까지 있는가 */
export function materialState(dir) {
  const has = (f) => existsSync(join(dir, f))
  const brief = has('brief.md')
  const review = has('review.ts')
  const draftMd = has('draft.md')
  const articleTs = has('article-draft.ts')
  /**
   * 🔴 단계를 **뜻으로** 나눈다.
   *    NEEDS_BRIEF   재료가 없다 — brief 부터 만들어야 한다
   *    NEEDS_DRAFT   brief·review 는 있고 원고가 없다 — **회수 대상**
   *    NEEDS_CONVERT 원고는 있고 변환물이 없다 — 등록 경로가 변환부터 한다
   *    READY         변환까지 있다 — 등록 경로가 바로 받는다
   */
  let stage = 'NEEDS_BRIEF'
  if (brief && review && draftMd && articleTs) stage = 'READY'
  else if (brief && review && draftMd) stage = 'NEEDS_CONVERT'
  else if (brief && review) stage = 'NEEDS_DRAFT'
  return { brief, review, draftMd, articleTs, stage }
}

/**
 * `run.json` 을 읽어 **중복 없는** 대상 목록을 만든다.
 *
 * @param {object} p
 * @param {string} p.draftsDir            `drafts/magazine`
 * @param {string} p.date                 KST 날짜 (`_runs/<date>/run.json`)
 * @param {(f:string)=>boolean} [p.exists] 시험 주입용
 * @param {(f:string)=>string} [p.read]    시험 주입용
 * @returns {{ok:boolean, why?:string, targets:{slug:string, origin:'selected'|'reusable', material:object}[]}}
 */
export function readRunTargets({ draftsDir, date, exists = existsSync, read = readFileSync }) {
  const file = join(draftsDir, '_runs', date, 'run.json')
  if (!exists(file)) return { ok: false, why: 'run.json 이 없다', targets: [] }
  let run
  try { run = JSON.parse(read(file, 'utf8')) }
  catch (e) { return { ok: false, why: `run.json 파싱 실패: ${e.message}`, targets: [] } }

  const slugOf = (x) => (typeof x === 'string' ? x : x?.slug)
  const seen = new Set()
  const targets = []
  /**
   * 🔴 **순서가 뜻을 가진다.** `selected` 가 먼저다 — 오늘 새로 만들기로 한 주제이므로
   *    회차 예산을 먼저 쓴다. 같은 slug 가 두 목록에 있으면 `selected` 로 센다.
   */
  for (const [origin, list] of [['selected', run.selected], ['reusable', run.reusable]]) {
    for (const row of Array.isArray(list) ? list : []) {
      const slug = slugOf(row)
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      targets.push({ slug, origin, material: materialState(join(draftsDir, slug)) })
    }
  }
  return { ok: true, targets, status: run.status ?? null, inventoryDays: run.inventoryDays ?? null }
}

/**
 * 🔴 **단계 판정이 유일한 계약이다** (Codex 재검토 2026-09-28).
 *
 *    앞판은 여기서 `material.brief && !material.draftMd` 같은 **조건을 다시 만들었다.**
 *    그러면 `stage` 를 만들어 둔 뜻이 없어지고, 더 나쁘게는
 *    **`brief` 만 있고 `review` 가 없는 대상이 회수로 흘러간다** —
 *    대조할 `riskSentences` 가 없는 주제에 ChatGPT 를 부르는 것이다.
 *
 *    소비자는 조건을 다시 쓰지 않고 이 두 함수만 쓴다.
 */
export function fetchTargets(targets) {
  return targets.filter((t) => t.material.stage === 'NEEDS_DRAFT')
}

export function registerTargets(targets) {
  return targets.filter((t) => t.material.stage === 'NEEDS_CONVERT' || t.material.stage === 'READY')
}
