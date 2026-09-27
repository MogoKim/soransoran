/**
 * 자동 병합 관문 — **무엇을 확인하고서야 merge 하는가.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **경계가 바뀌었다** (2026-09-16 경영 결정).
 *
 *    지금까지는 "자동화는 PR 까지, merge 는 사람" 이었다.
 *    목표가 **완전 무인 운영**으로 바뀌면서 merge 도 자동이 된다.
 *
 *    그러나 **자동 공개가 된 것은 아니다.** merge 해도 글은 `publishAt` 전까지 안 나간다.
 *    사람이 사라진 자리는 "PR 을 읽는 눈" 이고, 그 자리를 이 관문이 대신한다.
 *    그래서 이 파일은 **사람이 PR 에서 보던 것을 하나씩 다시 본다.**
 *
 * 🔴 **모르면 막는다.** 확인하지 못한 항목이 하나라도 있으면 merge 하지 않는다.
 *    "아마 괜찮을 것" 으로 main 을 고치는 자리는 만들지 않는다.
 *
 * 🔴 **등급으로 막지 않는다** (M3-A). 프로필을 정할 수 없는 항목만 멈춘다.
 *    여기서 **다시** 본다 — 두 겹으로 막는 것은 register 와 같은 원칙이다.
 *    등급 정본은 언제나 `topic-queue.ts` 다.
 *
 * 🔴 파일도 네트워크도 만지지 않는다. 넘겨받은 사실만 판정한다.
 */

/**
 * 관문이 PR 에 대해 **실제로 보는 필드.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 한 곳에 모으나** (2026-09-17 실측).
 *
 *    목록 조회(`gh pr list`)와 상세 조회(`gh pr view`)가 **서로 다른 필드**를
 *    가져오고 있었다. 목록에는 `headRefName` 이 있고 상세에는 없었다.
 *    `mergeable` 을 다시 보려고 상세 조회 결과를 관문에 넘긴 순간,
 *    `pr.headRefName` 이 `undefined` 가 되어 **정상 자동 PR 이 "사람 PR" 로 막혔다.**
 *
 *      ⛔ NOT_AUTO_BRANCH: undefined 는 자동 레인 브랜치가 아니다
 *
 *    등록 3건이 끝난 회차가 마지막 한 걸음에서 멈췄다.
 *    fail-closed 라 사고는 아니었지만, **막지 말아야 할 것을 막았다.**
 *
 * 🔴 **그래서 목록과 상세가 같은 목록을 쓴다.** 조회하는 쪽이 각자 필드를
 *    적으면 언젠가 또 갈라진다. 관문이 보는 것을 관문 옆에 적어 둔다.
 */
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'
export const PR_FIELDS = [
  'number',
  'url',
  'headRefName',
  'headRefOid',
  'baseRefName',
  'state',
  'mergeable',
  'isDraft',
]

/** `gh --json` 에 그대로 넘기는 모양 */
export const PR_FIELDS_ARG = PR_FIELDS.join(',')

/** 자동 레인이 만드는 브랜치의 접두 — `magazine-outstanding.mjs` 와 같은 값이다 */
export const AUTO_BRANCH_PREFIX = 'feat/magazine-auto-register-'

/** 자동 병합이 허용하는 위험 등급 */
// 🔴 MERGE_RISK 제거 (M3-A · SUPERSEDED) — 등급으로 병합을 가르지 않는다

/**
 * 🔴 **이 검사가 초록이 아니면 merge 하지 않는다.**
 *
 *    "실패한 검사가 없다" 로는 부족하다 — 검사가 **아예 안 돌았을 때도** 그 조건은 참이다.
 *    2026-09-16 검토에서 빈 목록이 통과하는 구멍이 확인됐다.
 *    이름으로 **있어야 할 것**을 적어 두고, 그것이 완료·성공인지 본다.
 */
export const REQUIRED_CHECKS = ['Micro Seed 3축 게이트']

/**
 * **그 밖의** 검사가 "끝났고 괜찮다" 로 인정되는 결론.
 *
 * 🔴 여기에 `skipped`·`neutral` 이 있는 것은 부수 검사에 한해서다.
 *    필수 검사에는 쓰지 않는다 — 아래 `REQUIRED_CONCLUSIONS` 를 본다.
 */
export const OK_CONCLUSIONS = ['success', 'skipped', 'neutral']

/**
 * 🔴 **필수 검사는 `success` 하나뿐이다** (2026-09-16 재검토).
 *
 *    직전 판은 필수 검사에도 `skipped`·`neutral` 을 인정했다. 그런데 워크플로에
 *    경로 필터(`paths:`)나 조건(`if:`)이 붙으면 검사는 **돌지 않고 skipped 로 완료**된다.
 *    그 상태를 통과로 세면 "필수 검사를 확인했다" 는 말이 **한 번도 돌지 않은 검사**를
 *    가리키게 된다. 필수로 정해 둔 이유가 통째로 사라진다.
 *
 *    부수 검사의 skipped 는 그대로 둔다 — 막을 이유가 없고, 막으면 매 회차 시끄럽다.
 */
export const REQUIRED_CONCLUSIONS = ['success']

/**
 * 자동 PR 이 바꿔도 되는 파일.
 *
 * 🔴 **목록이 아니라 모양으로 본다.** slug 는 회차마다 다르다.
 *    그러나 **경로의 모양**은 고정이다 — 그 밖의 파일이 하나라도 있으면 막는다.
 */
/**
 * 🔴 **모양만으로는 모자라다** (2026-09-16 재검토).
 *
 *    `drafts/magazine/<아무 slug>/draft.md` 는 모양이 맞다. 그래서 이 회차가
 *    등록하지도 않은 **다른 글의 원고나 hero 를 고치거나 지워도** 통과했다.
 *    자동 레인이 건드려도 되는 것은 **이번에 등록하는 slug 의 파일뿐**이다.
 *
 *    그래서 slug 를 잡아내고, 등록분 목록과 대조한다.
 */
export const ALLOWED_FILE_RULES = [
  { re: /^src\/content\/magazine\/articles\.ts$/, slugGroup: 0 },
  { re: /^drafts\/magazine\/topic-queue\.ts$/, slugGroup: 0 },
  { re: /^drafts\/magazine\/([a-z0-9-]+)\/(draft\.md|article-draft\.ts|brief\.md|review\.ts)$/, slugGroup: 1 },
  { re: /^public\/magazine\/([a-z0-9-]+)\/hero\.webp$/, slugGroup: 1 },
]

/** 옛 이름 — 모양만 본다. 실제 판정은 `judgeFile` 을 쓴다 */
export const ALLOWED_FILE_PATTERNS = ALLOWED_FILE_RULES.map((r) => r.re)

/**
 * 이 파일을 자동 레인이 건드려도 되는가.
 *
 * @param {string} path
 * @param {Set<string>|null} slugs  이번 회차가 등록하는 slug. null 이면 모양만 본다
 * @returns {{ok:boolean, code?:string, slug?:string}}
 */
export function judgeFile(path, slugs = null) {
  for (const rule of ALLOWED_FILE_RULES) {
    const m = rule.re.exec(path)
    if (!m) continue
    if (rule.slugGroup === 0) return { ok: true }
    const slug = m[rule.slugGroup]
    // 🔴 등록분이 아니면 막는다 — 남의 글을 고치거나 지우는 통로를 열지 않는다
    // 🔴 Set 일 때만 대조한다. `files.every(isAllowedFile)` 처럼 인덱스가 딸려 들어오는
    //    호출에서 엉뚱한 값을 slug 목록으로 오인하지 않는다.
    if (slugs instanceof Set && !slugs.has(slug)) return { ok: false, code: 'FOREIGN_SLUG_FILE', slug }
    return { ok: true }
  }
  return { ok: false, code: 'UNEXPECTED_FILES' }
}

export const isAllowedFile = (path, slugs = null) => judgeFile(path, slugs).ok

/**
 * 이 PR 을 자동으로 merge 해도 되는가.
 *
 * @param {object} p
 * @param {{number:number, url:string, headRefName:string, headRefOid:string, state:string, mergeable:string, isDraft:boolean}} p.pr
 * @param {string} p.expectedSha          우리가 확인한 SHA (여기서 벗어나면 다른 커밋이 끼어든 것이다)
 * @param {string[]} p.files              PR 이 바꾼 파일
 * @param {string} p.ciState              GitHub combined status (success/pending/failure)
 * @param {{name:string, conclusion:string|null, status:string}[]} p.checks
 * @param {{slug:string, publishAt:string, publishedAt:string, status:string}[]} p.registered  이 PR 이 등록하는 글
 * @param {object} p.queueBySlug        🔴 **등록 전 큐(최신 main)** — 등급 정본
 * @param {object} p.branchQueueBySlug  PR 브랜치의 큐 — 등급을 낮췄는지 대조용
 * @param {Set<string>} p.mainSlugs       현재 main 의 slug
 * @param {Set<string>} p.mainDates       현재 main 의 예약 날짜
 * @param {number} p.now                  판정 시각 (ms)
 * @returns {{ok:boolean, blockedBy:{code:string,message:string}[], checked:string[]}}
 */
/**
 * 키 순서에 흔들리지 않는 비교용 직렬화.
 * 🔴 사람이 필드 순서만 바꿔 적은 것을 "내용이 바뀌었다" 로 보고하면 알림이 시끄러워지고,
 *    시끄러운 알림은 곧 읽히지 않는 알림이 된다.
 */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export function judgeAutoMerge({
  pr, expectedSha, files, ciState, checks = [],
  /**
   * 🔴 PR **head tree** 에 그 경로의 파일이 실제로 있는가. 변경 파일 목록과 다른 질문이다.
   *    주입되지 않으면 `null` 판정 → 변경 파일 목록으로 되돌아간다(모르면 막는다).
   * @type {((path: string) => boolean) | undefined}
   */
  headHasFile,
  registered, queueBySlug, branchQueueBySlug = null, mainSlugs, mainDates, now,
}) {
  const blockedBy = []
  const checked = []
  const block = (code, message) => blockedBy.push({ code, message })
  const pass = (name) => checked.push(name)

  // ── ① PR 자체 ────────────────────────────────────────────
  if (!pr) {
    block('NO_PR', '자동 PR 을 찾지 못했다')
    return { ok: false, blockedBy, checked }
  }
  // 🔴 **필드를 못 받은 것과 사람 PR 인 것을 구분한다** (2026-09-17).
  //    둘 다 막지만 사람이 할 일이 다르다. 옛 판은 필드 누락을
  //    "undefined 는 자동 레인 브랜치가 아니다" 로 적어 사람 PR 처럼 보이게 했다.
  if (typeof pr.headRefName !== 'string' || pr.headRefName === '') {
    block('PR_FIELDS_INCOMPLETE', `PR 조회에 headRefName 이 없다 — 조회 필드가 PR_FIELDS(${PR_FIELDS.join(', ')})와 어긋났다`)
  } else if (!pr.headRefName.startsWith(AUTO_BRANCH_PREFIX)) {
    block('NOT_AUTO_BRANCH', `${pr.headRefName} 는 자동 레인 브랜치가 아니다 — 사람 PR 을 자동으로 merge 하지 않는다`)
  } else pass('자동 레인 브랜치')

  if (pr.state !== 'OPEN') block('NOT_OPEN', `PR 상태가 ${pr.state} 다`)
  else pass('OPEN')

  if (pr.isDraft) block('IS_DRAFT', 'draft PR 이다')
  else pass('draft 아님')

  if (pr.mergeable !== 'MERGEABLE') block('NOT_MERGEABLE', `mergeable=${pr.mergeable} — 충돌이 있거나 아직 판정되지 않았다`)
  else pass('충돌 없음')

  // ── ② SHA 고정 ───────────────────────────────────────────
  // 🔴 우리가 검증한 그 커밋만 merge 한다. 검증 뒤에 커밋이 하나 더 붙었으면
  //    그것은 우리가 본 PR 이 아니다.
  if (pr.headRefOid !== expectedSha) {
    block('SHA_DRIFTED', `HEAD 가 ${String(pr.headRefOid).slice(0, 7)} 로 바뀌었다 — 검증한 것은 ${String(expectedSha).slice(0, 7)} 다`)
  } else pass('SHA 일치')

  // ── ③ 변경 파일 — 🔴 **이번 등록분 slug 와 연결해서** 본다 ──
  const registeredSlugSet = new Set((registered ?? []).map((r) => r.slug))
  const verdicts = (files ?? []).map((f) => ({ path: f, v: judgeFile(f, registeredSlugSet) }))
  const foreign = verdicts.filter((x) => x.v.code === 'FOREIGN_SLUG_FILE')
  const unexpected = verdicts.filter((x) => x.v.code === 'UNEXPECTED_FILES')
  if ((files ?? []).length === 0) block('NO_FILES', '변경 파일이 없다')
  else {
    if (unexpected.length > 0) {
      block('UNEXPECTED_FILES', `자동 레인이 건드릴 수 없는 파일이 있다: ${unexpected.map((x) => x.path).join(', ')}`)
    }
    // 🔴 등록하지도 않은 글의 원고·hero 를 고치거나 지우는 것은 자동 레인의 일이 아니다
    if (foreign.length > 0) {
      block('FOREIGN_SLUG_FILE', `이번에 등록하지 않는 글의 파일을 건드렸다: ${foreign.map((x) => `${x.path}(${x.v.slug})`).join(', ')}`)
    }
    if (unexpected.length === 0 && foreign.length === 0) {
      pass(`변경 파일 ${files.length}개 — 전부 허용 모양이고 등록분 ${registeredSlugSet.size}건에 대응`)
    }
  }

  // ── ④ CI ────────────────────────────────────────────────
  if (ciState !== 'success') block('CI_NOT_GREEN', `CI 상태가 ${ciState} 다`)
  else pass('CI success')

  // 🔴 **빈 목록을 통과시키지 않는다** (2026-09-16 검토).
  //    "실패한 검사가 없다" 는 검사가 아예 안 돌았을 때도 참이다.
  //    조회에 실패했는지, 정말 없는지 구분할 수 없으면 막는다 — fail closed.
  if (!Array.isArray(checks) || checks.length === 0) {
    block('CHECKS_EMPTY', '검사 목록이 비었다 — 조회에 실패했거나 아직 등록되지 않았다 (확정할 수 없으면 막는다)')
  } else {
    const badChecks = checks.filter((c) => c.status === 'completed' && !OK_CONCLUSIONS.includes(c.conclusion ?? ''))
    const pendingChecks = checks.filter((c) => c.status !== 'completed')
    if (badChecks.length > 0) block('CHECK_FAILED', `실패한 검사: ${badChecks.map((c) => c.name).join(', ')}`)
    else if (pendingChecks.length > 0) block('CHECK_PENDING', `아직 도는 검사: ${pendingChecks.map((c) => c.name).join(', ')}`)

    // 🔴 **있어야 할 검사가 실제로 있었는가.** 이름으로 확인한다.
    const byName = new Map(checks.map((c) => [c.name, c]))
    // 🔴 필수 검사는 **completed + success** 만이다. skipped·neutral 은 인정하지 않는다.
    const missing = REQUIRED_CHECKS.filter((n) => {
      const c = byName.get(n)
      return !c || c.status !== 'completed' || !REQUIRED_CONCLUSIONS.includes(c.conclusion ?? '')
    })
    if (missing.length > 0) {
      block('REQUIRED_CHECK_MISSING', `필수 검사가 완료·성공이 아니다: ${missing.map((n) => {
        const c = byName.get(n)
        if (!c) return `${n}(등록 안 됨)`
        if (c.status !== 'completed') return `${n}(${c.status})`
        return `${n}(${c.conclusion ?? '결론 없음'})`
      }).join(', ')}`)
    }
    else pass(`검사 ${checks.length}개 완료 (필수 ${REQUIRED_CHECKS.length}개 포함)`)
  }

  // ── ⑤ 등록 내용 ──────────────────────────────────────────
  const rows = registered ?? []
  if (rows.length === 0) {
    block('NOTHING_REGISTERED', '이 PR 이 등록하는 글을 읽지 못했다')
    return { ok: blockedBy.length === 0, blockedBy, checked }
  }

  // ── ⑤-0 큐 무결성 — 🔴 **PR 이 자기 등급을 고쳐 통과할 수 없다**
  //
  //    등급 정본은 **등록 전 큐(최신 main)** 다. PR 브랜치의 큐는 등록하면서
  //    그 slug 가 **삭제된** 상태라 애초에 등급을 찾을 수 없고(2026-09-16 실측),
  //    남아 있는 항목의 등급이 바뀌었다면 그것은 자동 레인이 할 일이 아니다.
  if (branchQueueBySlug) {
    const registeredSlugs = new Set(rows.map((r) => r.slug))
    for (const [slug, item] of Object.entries(branchQueueBySlug)) {
      const base = queueBySlug?.[slug]
      if (!base) { block('QUEUE_ADDED', `PR 이 큐에 ${slug} 를 더했다 — 자동 레인은 큐에 항목을 추가하지 않는다`); continue }
      if (item.riskLevel !== base.riskLevel || item.autoEligible !== base.autoEligible) {
        block('QUEUE_GRADE_CHANGED', `PR 이 ${slug} 의 등급·자격을 바꿨다 (${base.riskLevel}/${base.autoEligible} → ${item.riskLevel}/${item.autoEligible})`)
      } else if (stableJson(item) !== stableJson(base)) {
        // 🔴 **등급만 보는 것으로는 모자라다** (2026-09-16 재검토).
        //    제목·imageMode·메모 같은 다른 필드가 바뀌어도 자동 레인이 할 일이 아니다.
        //    남은 항목은 **한 글자도** 그대로여야 한다.
        block('QUEUE_ITEM_CHANGED', `PR 이 ${slug} 의 다른 필드를 바꿨다 — 남은 큐 항목은 그대로여야 한다`)
      }
    }
    const removed = Object.keys(queueBySlug ?? {}).filter((s) => !(s in branchQueueBySlug))
    const unexpectedRemoval = removed.filter((s) => !registeredSlugs.has(s))
    if (unexpectedRemoval.length > 0) {
      block('QUEUE_UNEXPECTED_REMOVAL', `등록하지 않은 항목이 큐에서 빠졌다: ${unexpectedRemoval.join(', ')}`)
    }
    if (blockedBy.length === 0) pass('큐 무결성 — 등급 변경 0 · 삭제는 등록분뿐')
  }

  // 🔴 등급은 **등록 전 큐**에서 본다. PR 의 큐에는 그 slug 가 없다.
  const lookup = (slug) => (queueBySlug instanceof Map ? queueBySlug.get(slug) : queueBySlug?.[slug])
  const seenSlug = new Set()
  const seenDate = new Set()

  for (const r of rows) {
    // 위험 등급 — 🔴 큐가 정본이다
    const item = lookup(r.slug)
    if (!item) {
      block('NOT_IN_QUEUE', `${r.slug} 가 **등록 전 큐(main)** 에 없다 — 등급을 확인할 정본이 없다`)
    } else {
      /**
       * 🔴 **병합을 등급으로 막지 않는다** (M3-A).
       *    프로필을 정할 수 없을 때만 멈춘다. 등급·자격 **변조** 검사(QUEUE_GRADE_CHANGED)는
       *    그대로 둔다 — 그건 "PR 이 큐를 몰래 고쳤나" 를 보는 다른 검사다.
       */
      const lane = isAutoLaneEligible(item)
      if (!lane.ok) block(lane.code, `${r.slug} — ${lane.why}`)
    }

    // 중복 slug — PR 안에서도, main 과도
    if (seenSlug.has(r.slug)) block('DUPLICATE_SLUG_IN_PR', `${r.slug} 가 PR 안에 두 번 있다`)
    seenSlug.add(r.slug)
    if (mainSlugs?.has(r.slug)) block('DUPLICATE_SLUG_IN_MAIN', `${r.slug} 가 이미 main 에 있다`)

    // 예약일
    const at = String(r.publishAt ?? '')
    if (!/^\d{4}-\d{2}-\d{2}T10:30:00\+09:00$/.test(at)) {
      block('PUBLISH_AT_SHAPE', `${r.slug} 의 publishAt 이 10:30 KST 형태가 아니다: ${at || '없음'}`)
    }
    const date = at.slice(0, 10)
    if (date && r.publishedAt && date !== r.publishedAt) {
      block('DATE_MISMATCH', `${r.slug} 의 publishedAt(${r.publishedAt})과 publishAt(${date})이 다르다`)
    }
    if (seenDate.has(date)) block('DUPLICATE_DATE_IN_PR', `${date} 가 PR 안에 두 번 있다`)
    seenDate.add(date)
    if (mainDates?.has(date)) block('DUPLICATE_DATE_IN_MAIN', `${date} 가 이미 main 에서 차 있다`)

    // 🔴 과거 날짜로 등록하면 merge 되는 순간 공개된다 — 예약이 아니다
    const ts = Date.parse(at)
    if (Number.isFinite(ts) && ts <= now) {
      block('PUBLISH_AT_PAST', `${r.slug} 의 publishAt 이 이미 지났다 (${at}) — merge 하면 즉시 공개된다`)
    }

    if (r.status && !['SCHEDULED', 'PUBLISHED'].includes(r.status)) {
      block('STATUS_UNEXPECTED', `${r.slug} 의 status 가 ${r.status} 다`)
    }

    /**
     * 🔴 **대표 이미지가 없으면 병합하지 않는다** (2026-09-21 사고).
     *
     *    9/19~9/26 등록 8건이 전부 hero 없이 main 에 들어갔다.
     *    생성 단계(OPTIONAL 스킵)와 QA 단계(REQUIRED 만 검사)가 둘 다 놓쳤고,
     *    **여기에도 검사가 없어서** 마지막 문까지 그대로 통과했다.
     *
     *    자동 레인이 내보내는 글에는 예외 없이 대표 이미지가 있어야 한다.
     *    파일이 PR 안에 실제로 들어 있는지도 함께 본다 — articles.ts 의
     *    경로만 맞고 파일이 없으면 독자에게는 깨진 이미지다.
     */
    const heroSrc = r.heroImage?.src ?? null
    if (!heroSrc) {
      block('HERO_MISSING', `${r.slug} 에 대표 이미지가 없다 — 자동 등록 글은 예외 없이 필요하다`)
    } else {
      // heroImage.src 는 `/magazine/<slug>/hero.webp` · 저장소 경로는 `public` 이 앞에 붙는다
      const expected = `public${heroSrc.startsWith('/') ? '' : '/'}${heroSrc}`
      /**
       * 🔴 **"PR 이 바꾼 파일" 과 "PR head 에 있는 파일" 은 다르다** (2026-09-27 사고).
       *
       *    앞판은 변경 파일 목록(`files`)만 봤다. 그래서 **이미 저장소에 있던 hero 를
       *    재사용**한 글이 `HERO_FILE_ABSENT` 로 막혔다 — 파일은 head tree 에 멀쩡히
       *    있는데 "이번 PR 이 건드리지 않았다" 는 이유로 막은 것이다.
       *    실측: PR #580 의 `checkup-items-50s` hero 는 base·head 양쪽에 같은 blob 이 있었다.
       *
       *    막아야 하는 것은 **head 에 그림이 없는 경우** 하나다.
       *    🔴 판정 수단이 없으면(주입 안 됨) 옛 기준으로 되돌아간다 — 모르면 막는다.
       */
      const inChangedFiles = (files ?? []).includes(expected)
      const inHead = typeof headHasFile === 'function' ? headHasFile(expected) : null
      const heroPresent = inHead === null ? inChangedFiles : inHead
      if (!heroPresent) {
        block('HERO_FILE_ABSENT', `${r.slug} 의 대표 이미지 파일이 PR head 에 없다 (${expected}) — 경로만 있고 그림이 없다`)
      }
    }
  }
  if (blockedBy.length === 0) pass(`등록 ${rows.length}건 — 등급·중복·예약일 확인`)

  return { ok: blockedBy.length === 0, blockedBy, checked }
}
