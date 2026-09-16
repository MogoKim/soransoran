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
 * 🔴 **LOW/MEDIUM 만이다.** HIGH·autoEligible=false 는 gate 에서 이미 막히지만,
 *    여기서 **다시** 본다 — 두 겹으로 막는 것은 register 와 같은 원칙이다.
 *    등급 정본은 언제나 `topic-queue.ts` 다.
 *
 * 🔴 파일도 네트워크도 만지지 않는다. 넘겨받은 사실만 판정한다.
 */

/** 자동 레인이 만드는 브랜치의 접두 — `magazine-outstanding.mjs` 와 같은 값이다 */
export const AUTO_BRANCH_PREFIX = 'feat/magazine-auto-register-'

/** 자동 병합이 허용하는 위험 등급 */
export const MERGE_RISK = new Set(['LOW', 'MEDIUM'])

/**
 * 자동 PR 이 바꿔도 되는 파일.
 *
 * 🔴 **목록이 아니라 모양으로 본다.** slug 는 회차마다 다르다.
 *    그러나 **경로의 모양**은 고정이다 — 그 밖의 파일이 하나라도 있으면 막는다.
 */
export const ALLOWED_FILE_PATTERNS = [
  /^src\/content\/magazine\/articles\.ts$/,
  /^drafts\/magazine\/topic-queue\.ts$/,
  /^drafts\/magazine\/[a-z0-9-]+\/(draft\.md|article-draft\.ts|brief\.md|review\.ts)$/,
  /^public\/magazine\/[a-z0-9-]+\/hero\.webp$/,
]

export const isAllowedFile = (path) => ALLOWED_FILE_PATTERNS.some((re) => re.test(path))

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
 * @param {Map<string,object>|object} p.queueBySlug   topic-queue 정본 (등급)
 * @param {Set<string>} p.mainSlugs       현재 main 의 slug
 * @param {Set<string>} p.mainDates       현재 main 의 예약 날짜
 * @param {number} p.now                  판정 시각 (ms)
 * @returns {{ok:boolean, blockedBy:{code:string,message:string}[], checked:string[]}}
 */
export function judgeAutoMerge({
  pr, expectedSha, files, ciState, checks = [],
  registered, queueBySlug, mainSlugs, mainDates, now,
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
  if (!String(pr.headRefName ?? '').startsWith(AUTO_BRANCH_PREFIX)) {
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

  // ── ③ 변경 파일 ──────────────────────────────────────────
  const unexpected = (files ?? []).filter((f) => !isAllowedFile(f))
  if ((files ?? []).length === 0) block('NO_FILES', '변경 파일이 없다')
  else if (unexpected.length > 0) {
    block('UNEXPECTED_FILES', `자동 레인이 건드릴 수 없는 파일이 있다: ${unexpected.join(', ')}`)
  } else pass(`변경 파일 ${files.length}개 전부 허용 모양`)

  // ── ④ CI ────────────────────────────────────────────────
  if (ciState !== 'success') block('CI_NOT_GREEN', `CI 상태가 ${ciState} 다`)
  else pass('CI success')

  const badChecks = checks.filter((c) => c.status === 'completed' && !['success', 'skipped', 'neutral'].includes(c.conclusion ?? ''))
  const pendingChecks = checks.filter((c) => c.status !== 'completed')
  if (badChecks.length > 0) block('CHECK_FAILED', `실패한 검사: ${badChecks.map((c) => c.name).join(', ')}`)
  else if (pendingChecks.length > 0) block('CHECK_PENDING', `아직 도는 검사: ${pendingChecks.map((c) => c.name).join(', ')}`)
  else if (checks.length > 0) pass(`검사 ${checks.length}개 완료`)

  // ── ⑤ 등록 내용 ──────────────────────────────────────────
  const rows = registered ?? []
  if (rows.length === 0) {
    block('NOTHING_REGISTERED', '이 PR 이 등록하는 글을 읽지 못했다')
    return { ok: blockedBy.length === 0, blockedBy, checked }
  }

  const lookup = (slug) => (queueBySlug instanceof Map ? queueBySlug.get(slug) : queueBySlug?.[slug])
  const seenSlug = new Set()
  const seenDate = new Set()

  for (const r of rows) {
    // 위험 등급 — 🔴 큐가 정본이다
    const item = lookup(r.slug)
    if (!item) {
      block('NOT_IN_QUEUE', `${r.slug} 가 topic-queue 에 없다 — 등급을 확인할 정본이 없다`)
    } else if (!MERGE_RISK.has(item.riskLevel)) {
      block('RISK_LEVEL', `${r.slug} 는 riskLevel=${item.riskLevel} — 자동 병합은 LOW/MEDIUM 만 한다`)
    } else if (item.autoEligible !== true) {
      block('AUTO_INELIGIBLE', `${r.slug} 는 autoEligible=false — 민감 주제다`)
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
  }
  if (blockedBy.length === 0) pass(`등록 ${rows.length}건 — 등급·중복·예약일 확인`)

  return { ok: blockedBy.length === 0, blockedBy, checked }
}
