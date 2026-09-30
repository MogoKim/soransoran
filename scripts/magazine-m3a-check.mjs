#!/usr/bin/env node
/**
 * M3-A 행동 검증 — 🔴 **실제 orchestration `drive()` 를 통과시킨다.**
 *
 * 🔴 앞판은 helper 를 따로 불러 "되더라" 를 확인했다. 그건 배선을 보지 않는다.
 *    여기서는 `magazine-auto-register.mjs` 의 `drive()` 를 **그대로** 돌리고,
 *    바깥 프로세스(회수·변환·QA·hero·register)만 주입한다.
 *    재생성이 실제로 QA 실패 경로에서 불리는지, 몇 번 불리는지, 그 뒤 HOLD 인지를 본다.
 *
 * 🔴 실제 ChatGPT·Claude 를 부르지 않는다. 실제 draft 파일을 덮어쓰지 않는다.
 * 🔴 장부는 임시 경로를 주입한다 — 운영 장부를 건드리지 않는다.
 *
 * 사용: node scripts/magazine-m3a-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveValidationProfile, isAutoLaneEligible, LEGACY_PROFILE_MAP } from './lib/magazine-validation-profile.mjs'
import { runProfileQA } from './lib/magazine-profile-qa.mjs'
import { attemptRegeneration, MAX_REGEN_CALLS, packetPathFor, readPacket, packetHashOf, packetsLeftFor } from './lib/magazine-regen.mjs'
import {
  readQuarantine, saveQuarantine, reserveDelivery, releaseDeliveryReservation,
  DELIVERY_HOLD_REASON as HOLD_REASON, REGEN_EXHAUSTED_REASON,
} from './lib/magazine-quarantine.mjs'
import { drive } from './magazine-auto-register.mjs'
import { gate } from './lib/magazine-auto-lane.mjs'
import { loadQueue } from './lib/magazine-load.mjs'
import { spawnSync as nodeSpawnSync } from 'node:child_process'

/** 🔴 저장소가 **추적하는** 파일 목록을 읽는다 — 환경에 따라 달라지지 않는 유일한 기준 */
function spawnSyncTop(cmd, args) {
  const r = nodeSpawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1e8 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}: ${r.stderr}`)
  return (r.stdout ?? '').trim()
}

let pass = 0, fail = 0
const fails = []
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; fails.push(label); console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}


/**
 * 🔴 **가짜 page 를 새 응답 계약으로 옮긴다** (2026-09-28 · 응답 회수 재설계).
 *    새 판 `fetchManuscript` 는 `page.evaluate(readConversationDom)` 으로 대화 스냅숏을 본다.
 *    기존 가짜들은 "`waitForFunction` 이 통과하면 응답이 왔고 `evaluate()` 가 그 원문" 이라는 옛 뜻을 담고 있다.
 *    이 어댑터는 **그 뜻을 그대로** 새 계약으로 번역한다 — send 를 누르기 전에는 assistant 응답 0,
 *    누른 뒤에는 원래 `waitForFunction` 이 통과하면 새 응답 1(코드블록 = 옛 `evaluate()`), 던지면 0.
 *    실제 DOM 판독(`readConversationDom`)은 ㊶ 에서 실측 골격으로 따로 시험한다.
 *    🔴 자급식이다 — CLI 자식 fixture 에도 `toString()` 으로 그대로 들어간다.
 */
function adaptPage(pg) {
  if (!pg || pg.__adapted) return pg
  pg.__adapted = true
  const origLocator = pg.locator ? pg.locator.bind(pg) : null
  const origEval = pg.evaluate ? pg.evaluate.bind(pg) : null
  let sent = false
  let state = 'pending'
  let text = null
  if (origLocator) {
    pg.locator = (sel) => {
      const loc = origLocator(sel)
      if (!/send-button|보내기|Send/.test(String(sel ?? ''))) return loc
      const wrap = (l) => ({ ...l, async click(...a) { const r = await l.click(...a); sent = true; return r } })
      const one = () => wrap(loc.first ? loc.first() : loc)
      return { ...wrap(loc), first: one, async all() { return [one()] } }
    }
  }
  pg.evaluate = async (fn, ...args) => {
    if (!fn || fn.name !== 'readConversationDom') return origEval ? origEval(fn, ...args) : null
    if (!sent) return { readOk: true, stop: false, units: [] }
    if (state !== 'ready') {
      try { if (pg.waitForFunction) await pg.waitForFunction(); state = 'ready'; text = origEval ? await origEval() : '' }
      catch { state = 'none' }
    }
    return state === 'ready'
      ? { readOk: true, stop: false, units: [{ id: 'fake-assistant-1', role: 'assistant', source: 'new', candidates: [{ form: 'code-block', text: String(text ?? '') }], text: '', hasActions: true }] }
      : { readOk: true, stop: false, units: [] }
  }
  return pg
}
/** 시험용 짧은 응답 관찰 타이밍 — 전체 한도는 시험 안에서만 짧다 */
const FAST_FETCH = { pollMs: 5, stablePolls: 2, timeoutMs: 300 }

console.log('\nM3-A 행동 검증 — 🔴 실제 drive() orchestration\n')

// ─────────────────────────────────────────────────────────
// ① validationProfile 정본
// ─────────────────────────────────────────────────────────
console.log('① validationProfile 정본')
{
  const r = resolveValidationProfile({ slug: 'checkup-items-50s', cluster: 'clinic',
    notes: '진단명을 붙이지 않는다', validationProfile: 'STANDARD' })
  check('🔴 항목이 선언한 프로필이 무조건 정본이다', r.profile === 'STANDARD' && r.source === 'item', r.why)
  const bad = resolveValidationProfile({ slug: 'x', validationProfile: 'WHATEVER' })
  check('  모르는 값은 추정하지 않고 막는다', bad.profile === null, bad.why)
  const none = resolveValidationProfile({ slug: 'brand-new-m3-topic', cluster: 'clinic', notes: '진단' })
  check('🔴 신규 항목을 cluster·notes 로 재추정하지 않는다', none.profile === null, none.why)

  /** 🔴 오분류 3건 회귀 */
  for (const [slug, want] of [['certificate-in-50s', 'STANDARD'], ['year-end-loneliness', 'STANDARD'],
    ['dinner-change-two-weeks', 'STANDARD']]) {
    const got = resolveValidationProfile({ slug })
    check(`🔴 ${slug} 는 ${want} 다 (정규식 오분류 회귀)`, got.profile === want, `${got.profile} · ${got.why}`)
  }
  const src = fs.readFileSync(new URL('./lib/magazine-validation-profile.mjs', import.meta.url), 'utf8')
  check('🔴 자유문장 정규식으로 프로필을 정하지 않는다',
    !/NOTE_SIGNALS|CLUSTER_PROFILE/.test(src) && !/notes.*test\(/.test(src))

  const q = loadQueue()
  const unresolved = q.filter((i) => !resolveValidationProfile(i).profile)
  const dist = {}
  for (const i of q) { const p = resolveValidationProfile(i).profile; dist[p] = (dist[p] ?? 0) + 1 }
  /**
   * 🔴 **고정 재고를 검사하지 않는다.** 앞판은 `q.length === 26` 과
   *    `LEGACY_PROFILE_MAP === 26` 을 요구했다. 그러면 **등록에 성공해 큐가 25가 되는 순간
   *    CI 가 스스로 막는다** — 잘한 일이 실패로 보고된다.
   *    지금 큐에 있는 항목이 전부 해석되는지만 본다.
   */
  check('🔴 지금 큐의 모든 항목이 프로필을 받는다', unresolved.length === 0,
    `${q.length}행 · ${JSON.stringify(dist)}`)
  check('  큐의 legacy 항목이 전부 호환 표에 있다',
    q.filter((i) => !i.validationProfile && !LEGACY_PROFILE_MAP[i.slug]).length === 0,
    q.filter((i) => !i.validationProfile && !LEGACY_PROFILE_MAP[i.slug]).map((i) => i.slug).join(','))
  /** 🔴 큐가 한 건 줄어도(등록 성공) 같은 검사가 통과한다 */
  const shrunk = q.slice(0, Math.max(0, q.length - 1))
  check('🔴 큐가 한 건 줄어도 통과한다 (등록 성공 PR 에서 CI 가 막히지 않는다)',
    shrunk.every((i) => Boolean(resolveValidationProfile(i).profile)), `${shrunk.length}행`)
}

// ─────────────────────────────────────────────────────────
// ② 프로필별 결정론적 QA
// ─────────────────────────────────────────────────────────
console.log('\n② 프로필별 결정론적 QA')
{
  const G = '\n사람마다 다를 수 있습니다.\n증상이 오래 지속되면 진료를 받아보세요.'
  const codes = (p, b) => runProfileQA({ profile: p, bodyText: b }).failures.map((f) => f.code)
  check('🔴 진단 확정 MEDICAL 은 실패', codes('MEDICAL', '이는 갱년기로 진단할 수 있습니다.' + G).includes('MED_DIAGNOSIS'))
  check('🔴 수익 보장 FINANCIAL 은 실패',
    codes('FINANCIAL', '연금 수익을 보장합니다.\n조건에 따라 다릅니다.\n국세청에 문의해 보세요.').includes('FIN_RETURN_GUARANTEE'))
  check('🔴 SENSITIVE 노골 묘사는 실패',
    codes('SENSITIVE', '체위를 바꿔 보세요.\n사람마다 다를 수 있습니다.\n강요하지 않습니다.').includes('SEN_EXPLICIT'))
  check('🔴 SENSITIVE 정상 판정은 실패',
    codes('SENSITIVE', '그 정도면 정상입니다.\n사람마다 다를 수 있습니다.\n강요하지 않습니다.').includes('SEN_NORMALITY'))
  check('  정상 MEDICAL 은 통과', codes('MEDICAL', '결과가 오는 과정을 적습니다.' + G).length === 0)

  /** 🔴 sources 모순 제거 회귀 */
  check('🔴 SOURCE_REQUIRED 를 더 이상 내지 않는다 (스키마에 sources 가 없다)',
    !/add\('SOURCE_REQUIRED'/.test(fs.readFileSync(new URL('./lib/magazine-profile-qa.mjs', import.meta.url), 'utf8')))
  check('🔴 근거 없는 수치 단정은 재생성 대상이다',
    codes('MEDICAL', '검사는 40세부터 2년마다 권고합니다.' + G).includes('UNSUPPORTED_NUMERIC_CLAIM'))
  check('  가변성을 밝힌 수치는 통과한다',
    codes('MEDICAL', '검사 주기는 기관마다 다르며 2년 정도로 알려져 있습니다.' + G).length === 0)

  /**
   * 🔴 **진료 권유가 수치 단정을 숨기지 못한다.**
   *    앞판은 "병원에 가 보세요" 가 붙은 문장을 **통째로** 빼 줬다. 그래서
   *    뒤에 한 줄만 붙이면 어떤 기준도 단정할 수 있었다 (실측 2건).
   *    면제되는 것은 문장이 아니라 **그 숫자**다 —
   *    증상이 얼마나 이어지면 진료를 보라는 **기간 조건**만 허용한다.
   */
  const numCodes = (p, b) => codes(p, b).filter((c) => c === 'UNSUPPORTED_NUMERIC_CLAIM')
  for (const [want, body] of [
    ['FAIL', '사람마다 다를 수 있습니다. 50세부터 2년마다 검사를 받아야 하므로 병원에서 진료를 받아보세요.'],
    ['FAIL', '사람마다 다를 수 있습니다. 검사는 50세부터 2년마다 권고되니 의료진에게 확인해 보세요.'],
    ['PASS', '사람마다 다를 수 있습니다. 증상이 3주 넘게 이어지면 병원에서 진료를 받아보시길 권합니다.'],
  ]) {
    const got = numCodes('MEDICAL', body).length ? 'FAIL' : 'PASS'
    check(`🔴 [${want}] ${body.slice(14, 44)}…`, got === want, `실제 ${got}`)
  }
  check('  증상 기간 조건은 허용한다 (실제 원고 문장)',
    numCodes('MEDICAL', '3주 넘게 이어지거나 관절 통증과 함께 온다면, 가까운 병원에서 진료를 받아보시길 권합니다.').length === 0)
  check('  복용량·횟수 기준은 진료 권유가 붙어도 막는다',
    numCodes('MEDICAL', '하루 2회 500mg 복용하시고 증상이 지속되면 진료를 받아보세요.').length > 0)
  check('🔴 "확인해·문의" 는 완충이 아니다 (수치를 가리지 못한다)',
    numCodes('MEDICAL', '검사는 50세부터 2년마다 권고되니 의료진에게 확인해 보세요.').length > 0)
  check('  소관 기관 안내 + 가변성은 여전히 통과',
    numCodes('FINANCIAL', '공제 한도는 조건에 따라 다르니 국세청에 문의해 보세요.').length === 0)
  /**
   * 🔴 **저장소에 커밋된 원고**가 이 규칙에 막히지 않는다.
   *
   *    앞판은 큐 전체를 돌며 `drafts/magazine/<slug>/article-draft.ts` 가 **있으면** 검사했다.
   *    그 파일이 있는지는 환경마다 다르다 — runtime 에는 미추적 원고가 더 있어서
   *    CI 초록 / runtime 빨강이 됐다(2026-09-26 실측 3건). 필수 시험은 추적본만 본다.
   *    🔴 **실제 운영 원고의 상태는 여기서 판정하지 않는다** — 운영 dry-run 보고가 본다
   *    (`magazine-auto-register-ready.mjs --dry-run --json` 의 blocked 목록).
   */
  {
    const { resolveValidationProfile: rvp } = await import('./lib/magazine-validation-profile.mjs')
    /**
     * 🔴 **큐 ∩ 추적 원고** 만 본다. 둘 다 저장소 안의 값이라 환경에 흔들리지 않는다.
     *    🔴 이미 발행돼 큐에서 빠진 글은 제외한다 — 후보가 아니고 프로필도 없는 것이 정상이다
     *       (그걸 섞었더니 37건이 `PROFILE_UNKNOWN` 으로 떴다. 시험 쪽 잘못이었다).
     */
    const trackedDrafts = new Set(
      spawnSyncTop('git', ['ls-files', '--', 'drafts/magazine']).split('\n')
        .filter((f) => f.endsWith('/article-draft.ts')).map((f) => f.split('/')[2]),
    )
    const subjects = loadQueue().filter((it) => trackedDrafts.has(it.slug))
    const blocked = subjects.filter((it) => {
      const f = `drafts/magazine/${it.slug}/article-draft.ts`
      const body = [...fs.readFileSync(f, 'utf8').matchAll(/text:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('\n')
      return !runProfileQA({ profile: rvp(it).profile, title: '', bodyText: body }).ok
    }).map((it) => it.slug)
    check('🔴 큐에 있고 추적되는 원고가 이 규칙에 막히지 않는다', blocked.length === 0,
      blocked.join(',') || `${subjects.length}건 검사 (큐 ∩ 추적본)`)
  }
}

// ─────────────────────────────────────────────────────────
// ③ 🔴 실제 drive() orchestration — QA 실패 → 재생성 → PASS
// ─────────────────────────────────────────────────────────
console.log('\n③ 실제 drive() — QA 실패 → 실패 패킷 → ChatGPT 경로 → 재QA')

/**
 * 🔴 **운영 큐 내용에 기대지 않는다.**
 *    큐는 등록될 때마다 줄어든다. "큐에 후보가 1건 이상 있다" 를 전제로 삼으면
 *    자동화가 성공할수록 CI 가 깨진다. 그래서 후보는 **저장소에 커밋된 draft 폴더**에서
 *    고르고, 큐 항목은 **고정 fixture 로 주입**한다 (`deps.loadQueue`).
 *    파일은 실제 파일이고 gate·progress·존재 검사도 실제로 돈다 — 약해지지 않는다.
 */
const DRAFT_ROOT = 'drafts/magazine'
/**
 * 🔴 **추적되는 파일만 본다** (2026-09-26 운영 사고).
 *
 *    앞판은 `drafts/magazine/*` 를 디렉터리로 훑었다. 그런데 운영 runtime 에는
 *    **미추적 원고**(사람이 만든 brief·review·draft)가 수십 건 더 있다. 그래서
 *    같은 코드가 CI 에서는 초록, runtime 에서는 빨강이 됐다 — 시험이 **환경을**
 *    읽고 있었던 것이다. 필수 시험은 저장소에 커밋된 것만 본다.
 */
const TRACKED = new Set(
  spawnSyncTop('git', ['ls-files', '--', DRAFT_ROOT]).split('\n').filter(Boolean),
)
const hasTracked = (slug, f) => TRACKED.has(`${DRAFT_ROOT}/${slug}/${f}`)
const FIXTURE_SLUGS = [...new Set([...TRACKED].map((f) => f.split('/')[2]))]
  .filter((name) => name && !name.startsWith('_')).sort()
  .filter((name) => ['brief.md', 'review.ts', 'draft.md', 'article-draft.ts'].every((f) => hasTracked(name, f)))
  .slice(0, 3)
check('🔴 시험 후보 3건을 **추적 파일**에서만 골랐다 (환경 독립)',
  FIXTURE_SLUGS.length === 3, FIXTURE_SLUGS.join(' · ') || '(없음)')
const SLUG = FIXTURE_SLUGS[0]

/** 🔴 실제 큐 행과 같은 모양이다 — fixture 가 실제보다 헐거우면 시험이 결함을 덮는다 */
const FIXTURE_QUEUE = FIXTURE_SLUGS.map((slug, i) => ({
  day: i + 1, slug, title: `시험 고정 후보 ${i + 1}`, contentType: 'EVERGREEN', intent: '상황',
  cluster: 'clinic', target: '50대 전반', riskLevel: 'HIGH', reviewMode: 'FULL_REVIEW',
  imageMode: 'REQUIRED', autoEligible: false, validationProfile: 'MEDICAL',
  ctaBoard: '/community/menopause', internalLinks: [], whyNow: '시험', notes: '시험',
}))
check('  fixture 후보가 전부 실제 gate 를 통과한다',
  FIXTURE_SLUGS.every((sl) => gate(sl, FIXTURE_QUEUE).ok),
  FIXTURE_SLUGS.map((sl) => `${sl}:${gate(sl, FIXTURE_QUEUE).blockedBy.map((b) => b.code).join('/') || 'ok'}`).join(' · '))

/** 🔴 바깥 프로세스만 주입한다. drive 의 판단 로직은 그대로 돈다 */
/**
 * 🔴 **가짜 runner 도 실제 자식의 장부 계약을 따른다** (2026-09-28 · Codex P0).
 *    실제 자식(`fetchSlug`)은 send 직전에 `reserveDelivery` **한 번으로** 예약과 regenCalls 증가를 같이 한다.
 *    부모는 이제 횟수를 올리지 않으므로, 이 계약을 흉내 내지 않는 가짜는 **실제보다 헐거워진다** —
 *    횟수가 영영 오르지 않아 소진 판정이 죽는다. 그래서 가짜도 **같은 production 함수**를 부른다.
 *    `outcome` 이 던지면 예약·횟수는 남는다 (실제 자식이 send 뒤 급사한 것과 같다).
 */
function asChild(ctx, ledgerPath, outcome) {
  const reservationId = `fake-${ctx.packet.attemptId}`
  const u = reserveDelivery({ slug: ctx.slug, messageFingerprint: `fake:${ctx.packet.attemptId}`, reservationId,
    regen: { attemptId: ctx.packet.attemptId, packetHash: packetHashOf(ctx.packet) }, path: ledgerPath })
  if (u.held) return { ok: false, sent: false, reason: HOLD_REASON, why: u.why }
  if (u.exhausted) return { ok: false, sent: false, reason: REGEN_EXHAUSTED_REASON, why: u.why }
  if (!u.ok) return { ok: false, sent: false, reason: 'predelivery_record_failed', why: u.why }
  const r = outcome()
  if (r?.ok) releaseDeliveryReservation({ slug: ctx.slug, reservationId, path: ledgerPath })
  return r
}

function makeDeps({ qaFailsUntil = 0, ledgerPath, packetDir, calls, draftChanges = true,
  packetsSeen = [], runnerThrows = false, runnerFails = false }) {
  let qaRuns = 0
  let fpN = 0
  return {
    quarantinePath: ledgerPath,
    /** 🔴 큐는 고정 fixture 다 — 운영 큐가 비어도 이 시험은 그대로 돈다 */
    loadQueue: () => FIXTURE_QUEUE,
    /** 🔴 패킷도 임시 디렉터리에 쓴다 — 운영 공유 폴더를 건드리지 않는다 */
    packetDir,
    /** 🔴 실제 draft 를 건드리지 않는다. 재생성마다 원고가 바뀌었다고 알려 준다 */
    draftFingerprint: () => (draftChanges ? `fp-${fpN}` : 'fp-fixed'),
    onRegen: () => { fpN += 1 },
    run(file, args, opts) {
      const name = path.basename(String(file))
      calls.push(name)
      if (name === 'magazine-webui-runner.mjs') return { code: 0, stdout: '회수', stderr: '', json: null }
      if (name === 'magazine-md-to-draft.mjs') return { code: 0, stdout: '변환', stderr: '', json: null }
      if (name === 'magazine-qa.mjs') {
        qaRuns += 1
        return qaRuns <= qaFailsUntil
          ? { code: 1, stdout: 'FAIL 진단 확정', stderr: '', json: null }
          : { code: 0, stdout: 'PASS', stderr: '', json: null }
      }
      if (name === 'magazine-hero-runner.mjs') return { code: 0, stdout: 'hero', stderr: '', json: null }
      if (name === 'magazine-batch-qa.mjs') {
        return { code: 0, stdout: '', stderr: '',
          json: [{ slug: SLUG, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
      }
      if (name === 'magazine-register.mjs') {
        return { code: 0, stdout: '', stderr: '', json: { verdict: 'READY', slug: SLUG } }
      }
      return { code: 0, stdout: '', stderr: '', json: null }
    },
    /**
     * 🔴 **전달된 패킷은 `ctx.packet` 으로 잡는다.** 전달이 끝난 파일을 나중에 다시
     *    읽어 증거로 쓰지 않는다 — 그 파일은 `finally` 에서 지워지는 것이 정상이다.
     *    파일이 남아 있어야 PASS 하는 시험은 누수를 요구하는 시험이다.
     */
    regenRunner({ slug, packet, packetPath }) {
      calls.push(`REGEN:${slug}`)
      // 🔴 runner 가 읽는 시점에는 **파일이 있어야 한다** — 읽기 전에 지우면 전달이 깨진다
      packetsSeen.push({ packet, existedDuringCall: fs.existsSync(packetPath), packetPath })
      return asChild({ slug, packet }, ledgerPath, () => {
        if (runnerThrows) throw new Error('재생성 경로 폭발')
        fpN += 1
        if (runnerFails) return { ok: false, why: '재생성 경로 실패(시험)' }
        return { ok: true }
      })
    },
  }
}

{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-e2e-'))
  const ledgerPath = path.join(T, 'q.json')
  try {
    const calls = []
    const packetsSeen = []
    const packetDir = path.join(T, 'packets')
    const deps = makeDeps({ qaFailsUntil: 1, ledgerPath, packetDir, calls, packetsSeen })
    const r = drive(SLUG, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트 여성', allowOptional: true, autoLane: false }, deps)
    check('🔴 drive() 가 QA 실패 뒤 재생성을 부른다', calls.includes(`REGEN:${SLUG}`), calls.join(' → '))
    check('🔴 재생성 뒤 QA 를 다시 돌린다',
      calls.filter((c) => c === 'magazine-qa.mjs').length === 2,
      `QA ${calls.filter((c) => c === 'magazine-qa.mjs').length}회`)
    check('  재생성 뒤 변환도 다시 돈다',
      calls.filter((c) => c === 'magazine-md-to-draft.mjs').length === 2)
    check('🔴 결국 DONE 으로 끝난다', r.verdict === 'DONE', `${r.verdict} · regen ${r.regenCalls}`)
    const ledger = readQuarantine(ledgerPath)
    check('  성공하면 재생성 횟수를 지운다', ledger.store[SLUG]?.regenCalls === undefined,
      JSON.stringify(ledger.store[SLUG] ?? '(기록 없음)'))
    check('🔴 실패 패킷이 실제로 전달됐다', Boolean(packetsSeen[0]?.packet?.instruction),
      packetsSeen[0]?.packet?.failures?.[0]?.code)
    check('🔴 runner 가 읽는 동안에는 패킷 파일이 있었다', packetsSeen[0]?.existedDuringCall === true)
    check('🔴 정상 반환 뒤 패킷 파일이 남지 않는다',
      packetsLeftFor(SLUG, packetDir).length === 0, packetsLeftFor(SLUG, packetDir).join(',') || '0건')
    check('  패킷 폴더에 잔여 파일 0',
      (fs.existsSync(packetDir) ? fs.readdirSync(packetDir) : []).length === 0,
      (fs.existsSync(packetDir) ? fs.readdirSync(packetDir) : []).join(','))
    check('  성공 반환에 packetPath 를 담지 않는다', !/packetPath: packetPath|regenCalls: bumped\.regenCalls, packetPath/.test(
      fs.readFileSync('scripts/lib/magazine-regen.mjs', 'utf8')))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ③-B 🔴 패킷 수명주기 — 전달이 끝나면 성공·실패·예외 모두 지운다
// ─────────────────────────────────────────────────────────
console.log('\n③-B 패킷 수명주기 — 전달 후 0건')
{
  /**
   * 🔴 패킷은 **전달용 임시 파일**이지 증거가 아니다.
   *    세 경로(정상 반환 · 실패 반환 · 예외) 전부에서 남지 않아야 한다.
   *    남으면 다음 회차가 옛 지시를 주워 읽고, 저장소 밖 폴더가 slug 마다 쌓인다.
   */
  const scenarios = [
    { name: '정상 반환', runner: () => ({ ok: true }) },
    { name: '실패 반환', runner: () => ({ ok: false, why: '시험 실패' }) },
    { name: '예외', runner: () => { throw new Error('시험 예외') } },
  ]
  for (const sc of scenarios) {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-pkt-'))
    const packetDir = path.join(T, 'packets')
    const ledgerPath = path.join(T, 'q.json')
    try {
      let sawFile = null
      let sawPacket = null
      const r = attemptRegeneration({
        slug: 'pkt-slug', profile: 'MEDICAL', failures: [{ code: 'MED_DIAGNOSIS', label: '단정' }],
        runner: (ctx) => {
          // 🔴 읽는 시점에는 반드시 있어야 한다 — 읽기 전에 지우면 전달 자체가 깨진다
          sawFile = fs.existsSync(ctx.packetPath)
          sawPacket = ctx.packet
          return asChild(ctx, ledgerPath, sc.runner)
        },
        quarantinePath: ledgerPath, packetDir,
      })
      check(`  [${sc.name}] runner 가 읽을 때 패킷 파일이 있었다`, sawFile === true)
      check(`  [${sc.name}] runner 가 패킷 내용을 받았다`,
        sawPacket?.slug === 'pkt-slug' && sawPacket?.failures?.[0]?.code === 'MED_DIAGNOSIS')
      check(`🔴 [${sc.name}] 반환 뒤 패킷 파일 0`,
        packetsLeftFor('pkt-slug', packetDir).length === 0, packetsLeftFor('pkt-slug', packetDir).join(','))
      check(`🔴 [${sc.name}] 패킷 폴더 잔여 0`,
        (fs.existsSync(packetDir) ? fs.readdirSync(packetDir) : []).length === 0,
        (fs.existsSync(packetDir) ? fs.readdirSync(packetDir) : []).join(','))
      /** 🔴 정리는 판정이 아니다 — HOLD·재시도 횟수는 장부에 그대로 남는다 */
      const led = readQuarantine(ledgerPath)
      check(`  [${sc.name}] 장부에 재시도 1회가 남는다`, led.store['pkt-slug']?.regenCalls === 1,
        JSON.stringify(led.store['pkt-slug'] ?? null))
      check(`  [${sc.name}] 판정은 패킷 삭제에 흔들리지 않는다`,
        sc.name === '정상 반환' ? r.ok === true : r.ok === false, `${r.code}`)
    } finally { fs.rmSync(T, { recursive: true, force: true }) }
  }

  /** 🔴 변이 시험 — finally 를 빼면 이 검사가 실제로 깨지는가 */
  const regenSrc = fs.readFileSync('scripts/lib/magazine-regen.mjs', 'utf8')
  check('🔴 삭제가 finally 에 있다 (실패·예외 경로도 덮는다)',
    /catch \(e\) \{ r = \{ ok: false, why: `재생성 경로 예외[^`]*` \} \}\n\s*finally \{ removePacket\(packetPath\) \}/.test(regenSrc))
  check('  removePacket 이 실패해도 던지지 않는다',
    /export function removePacket[\s\S]{0,200}try \{ rmSync/.test(regenSrc))
}

// ─────────────────────────────────────────────────────────
// ④ 🔴 영구 실패 — runner 2회 뒤 그 slug 만 HOLD
// ─────────────────────────────────────────────────────────
console.log('\n④ 영구 실패 — runner 2회 뒤 HOLD')
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-hold-'))
  const ledgerPath = path.join(T, 'q.json')
  try {
    const calls = []
    const deps = makeDeps({ qaFailsUntil: 99, ledgerPath, packetDir: path.join(T, 'packets'), calls })
    /** 🔴 매번 다른 실패를 내는 경로 — 같은 패킷 반복 차단에 걸리지 않게 한다 */
    let n = 0
    const baseRun = deps.run
    deps.run = (file, args, opts) => {
      const name = path.basename(String(file))
      if (name === 'magazine-qa.mjs') { n += 1; calls.push(name); return { code: 1, stdout: `FAIL 유형${n}`, stderr: '', json: null } }
      return baseRun(file, args, opts)
    }
    const r = drive(SLUG, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트 여성', allowOptional: true, autoLane: false }, deps)
    const runnerCalls = calls.filter((c) => c.startsWith('REGEN:')).length
    check(`🔴 runner 가 정확히 ${MAX_REGEN_CALLS}회 불린다`, runnerCalls === MAX_REGEN_CALLS, `${runnerCalls}회`)
    check('🔴 그 뒤 BLOCKED 로 끝난다', r.verdict === 'BLOCKED', r.verdict)
    check('  사유가 재생성 소진이다',
      (r.blockedBy ?? []).some((b) => /REGEN_EXHAUSTED|REGEN_NO_CHANGE/.test(b.message ?? '')),
      (r.blockedBy ?? []).map((b) => b.message).join(' | ').slice(0, 110))
    const ledger = readQuarantine(ledgerPath)
    check('  장부에 소진이 남는다', ledger.store[SLUG]?.regenCalls === MAX_REGEN_CALLS,
      JSON.stringify(ledger.store[SLUG]))

    /** 🔴 재시작 — 추가 호출이 없어야 한다 */
    const calls2 = []
    const deps2 = makeDeps({ qaFailsUntil: 99, ledgerPath, packetDir: path.join(T, 'packets'), calls: calls2 })
    const r2 = drive(SLUG, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트 여성', allowOptional: true, autoLane: false }, deps2)
    check('🔴 재시작해도 runner 를 다시 부르지 않는다',
      calls2.filter((c) => c.startsWith('REGEN:')).length === 0, `${calls2.filter((c) => c.startsWith('REGEN:')).length}회`)
    check('  여전히 BLOCKED 다', r2.verdict === 'BLOCKED')
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑤ 한 slug 실패가 같은 batch 를 막지 않는다
// ─────────────────────────────────────────────────────────
console.log('\n⑤ 한 건 실패가 묶음을 막지 않는다')
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-batch-'))
  const ledgerPath = path.join(T, 'q.json')
  try {
    /**
     * 🔴 gate 재료가 준비된 고정 후보 3건 — 없는 원고로 "묶음이 돈다" 를 증명할 수 없다.
     *    운영 큐가 아니라 저장소에 커밋된 draft 폴더에서 고른다.
     */
    const candidates = FIXTURE_SLUGS
    check('  묶음 시험에 후보 3건이 있다', candidates.length === 3, candidates.join(','))
    const results = []
    for (const [i, slug] of candidates.entries()) {
      const calls = []
      const deps = makeDeps({ qaFailsUntil: i === 0 ? 99 : 0, ledgerPath, packetDir: path.join(T, 'packets'), calls })
      // 첫 건은 매번 다른 실패를 내 소진까지 간다
      if (i === 0) {
        let n = 0
        const base = deps.run
        deps.run = (f, a, o) => {
          const name = path.basename(String(f))
          if (name === 'magazine-qa.mjs') { n += 1; calls.push(name); return { code: 1, stdout: `FAIL 유형${n}`, stderr: '', json: null } }
          return base(f, a, o)
        }
      }
      deps.run = ((orig) => (f, a, o) => {
        const name = path.basename(String(f))
        const r = orig(f, a, o)
        if (name === 'magazine-batch-qa.mjs') return { ...r, json: [{ slug, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
        if (name === 'magazine-register.mjs') return { ...r, json: { verdict: 'READY', slug } }
        return r
      })(deps.run)
      results.push(drive(slug, { write: true, pr: false, publishAt: `2027-01-0${i + 5}`, alt: '테스트 여성', allowOptional: true, autoLane: false }, deps))
    }
    check('🔴 첫 건은 BLOCKED', results[0].verdict === 'BLOCKED', results[0].verdict)
    check('🔴 나머지는 계속 진행한다', results.slice(1).every((r) => r.verdict === 'DONE'),
      results.map((r) => `${r.slug}:${r.verdict}`).join(' · '))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑥ 장부 — 하나 · 저장소 밖 · 깨지면 그 slug HOLD
// ─────────────────────────────────────────────────────────
console.log('\n⑥ 장부 무결성')
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-led-'))
  try {
    const broken = path.join(T, 'broken.json')
    fs.writeFileSync(broken, '{ 깨진 ')
    const read = readQuarantine(broken)
    check('🔴 깨진 장부를 빈 장부로 보지 않는다', read.ok === false, read.why)
    const r = attemptRegeneration({ slug: 'x', profile: 'MEDICAL',
      failures: [{ code: 'MED_DIAGNOSIS' }], runner: () => ({ ok: true }), quarantinePath: broken })
    check('🔴 깨졌으면 그 slug 를 HOLD 한다 (runner 를 부르지 않는다)',
      r.ok === false && r.code === 'LEDGER_UNREADABLE', r.code)

    const good = path.join(T, 'ok.json')
    saveQuarantine({ a: { attempts: 1 } }, good)
    check('  원자 저장 뒤 읽으면 같다', readQuarantine(good).store.a.attempts === 1)

    check('🔴 장부가 저장소 밖이다',
      !readQuarantine.toString().includes('drafts/magazine') , '')
    const regenSrc = fs.readFileSync(new URL('./lib/magazine-regen.mjs', import.meta.url), 'utf8')
    check('🔴 별도 retry ledger 가 없다 (장부는 하나다)',
      !/magazine-retry-ledger/.test(regenSrc) && !fs.existsSync(new URL('./lib/magazine-retry-ledger.mjs', import.meta.url)))
    check('  패킷도 저장소 밖이다', /Application Support/.test(regenSrc))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑦ 활성 경로에 외부 AI 의존 없음 · 모순 문구 없음
// ─────────────────────────────────────────────────────────
console.log('\n⑦ 활성 경로')
{
  const files = ['scripts/lib/magazine-validation-profile.mjs', 'scripts/lib/magazine-profile-qa.mjs',
    'scripts/lib/magazine-regen.mjs', 'scripts/lib/magazine-quarantine.mjs',
    'scripts/lib/magazine-auto-lane.mjs', 'scripts/magazine-batch-qa.mjs',
    'scripts/magazine-register.mjs', 'scripts/magazine-auto-register.mjs']
  const ai = files.filter((f) => /semanticVerifier|factClassifier|openai|anthropic|API_KEY/i.test(fs.readFileSync(f, 'utf8')))
  check('🔴 새 AI API·제3 모델 의존 0', ai.length === 0, ai.join(','))
  /**
   * 🔴 **운영 HOME 을 읽지 않는다.**
   *    앞판은 실제 `~/Library/Application Support/soransoran/regen-packets` 가
   *    비어 있기를 요구했다. 그건 시험이 아니라 **운영 상태에 대한 기대**다 —
   *    다른 회차가 남긴 파일 하나로 CI 가 빨개지고, 반대로 운영이 깨끗하면
   *    시험이 잘못돼도 초록으로 지나간다.
   *    이제 격리는 **이 파일 자체가 운영 경로를 안 쓴다**는 것으로 증명한다.
   */
  const selfSrc = fs.readFileSync('scripts/magazine-m3a-check.mjs', 'utf8')
  check('🔴 시험 파일이 운영 HOME 을 읽지 않는다',
    !/os\.homedir\(\)/.test(selfSrc) && !/process\.env\.HOME(?!:)/.test(selfSrc))
  check('🔴 하위 프로세스에 전부 임시 HOME 을 넘긴다',
    (selfSrc.match(/spawnSync\(/g) ?? []).length === (selfSrc.match(/HOME: /g) ?? []).length,
    `spawnSync ${(selfSrc.match(/spawnSync\(/g) ?? []).length} · HOME 주입 ${(selfSrc.match(/HOME: /g) ?? []).length}`)
  const ready = fs.readFileSync('scripts/magazine-auto-register-ready.mjs', 'utf8')
  check('🔴 "[merge 금지]" PR 제목이 없다', !/\[merge 금지\] feat\(magazine\)/.test(ready))
  check('🔴 "창업자 승인 후 merge" 문구가 없다', !/merge 는 창업자 승인 후/.test(ready))
  check('🔴 "LOW/MEDIUM 자동 등록" 문구가 없다', !/LOW\/MEDIUM 자동 등록/.test(ready))
  check('  자동 병합 안전 관문은 그대로다',
    /QUEUE_GRADE_CHANGED/.test(fs.readFileSync('scripts/lib/magazine-merge-gate.mjs', 'utf8')))
}

// ─────────────────────────────────────────────────────────
// ⑧ 🔴 실제 ready orchestration — 장부 lost update
// ─────────────────────────────────────────────────────────
console.log('\n⑧ 실제 ready orchestration — 장부 lost update')
{
  const { processCandidates } = await import('./magazine-auto-register-ready.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-ready-'))
  const ledgerPath = path.join(T, 'q.json')
  try {
    /**
     * 🔴 **drive 를 진짜처럼 흉내 내되, 장부에는 실제로 쓴다.**
     *    ready 가 그 값을 덮는지가 이 시험의 전부다.
     */
    const seen = []
    const fakeDrive = (slug, opts, deps) => {
      seen.push(slug)
      const qp = deps?.quarantinePath
      const read = readQuarantine(qp)
      const used = read.store[slug]?.regenCalls ?? 0
      if (used >= MAX_REGEN_CALLS) {
        // 🔴 이미 소진 — runner 를 부르지 않는다
        return { slug, verdict: 'BLOCKED', steps: [], regenCalls: used,
          blockedBy: [{ code: 'QA_FAIL', message: `REGEN_EXHAUSTED — ${used}회` }] }
      }
      // 실제 재생성 경로를 두 번 태운다
      let calls = 0
      for (let i = used; i < MAX_REGEN_CALLS; i++) {
        const rr = attemptRegeneration({ slug, profile: 'MEDICAL',
          failures: [{ code: 'QA_FAIL', label: `유형${i}` }],
          runner: (ctx) => asChild(ctx, qp, () => { calls += 1; return { ok: true } }),
          quarantinePath: qp, packetDir: path.join(T, 'packets'),
          previousFingerprint: `fp-${i}`, fingerprintOf: () => `fp-${i + 1}` })
        if (!rr.ok) break
      }
      return { slug, verdict: 'BLOCKED', steps: [], regenCalls: MAX_REGEN_CALLS, runnerCalls: calls,
        blockedBy: [{ code: 'QA_FAIL', message: 'REGEN_EXHAUSTED' }] }
    }

    /**
     * 🔴 **후보를 고정한다.** 운영 큐가 0건이어도 이 orchestration 검증은 그대로 돈다.
     *    `scan()` 이 돌려주는 모양 그대로다 — fixture 가 실제보다 헐거우면 결함을 덮는다.
     */
    const FIX = 'fixture-candidate'
    const fixtureScan = () => ({
      source: 'fixture', pool: 1,
      eligible: [{ slug: FIX, item: FIXTURE_QUEUE[0], progress: { hasBrief: true, hasReview: true, hasDraftMd: true } }],
      skipped: [], quarantined: [],
    })

    const report1 = { blocked: [], done: [] }
    const r1 = processCandidates({ write: true, wantPr: false, limit: 1, report: report1,
      driveFn: fakeDrive, quarantinePath: ledgerPath, scanFn: fixtureScan })
    const slug = r1.results[0]?.slug
    check('  실제 ready 루프가 고정 후보를 돌렸다', slug === FIX, slug)
    const after1 = readQuarantine(ledgerPath).store[slug]
    check(`🔴 drive 가 기록한 regenCalls ${MAX_REGEN_CALLS} 가 ready 의 BLOCKED 기록 뒤에도 남는다`,
      after1?.regenCalls === MAX_REGEN_CALLS, JSON.stringify(after1))
    check('  실패도 함께 기록된다 (attempts)', Number.isFinite(after1?.attempts) && after1.attempts >= 1,
      `attempts ${after1?.attempts}`)

    /** 🔴 재시작 — runner 호출 0 이어야 한다 */
    let runnerCalls2 = 0
    const countingDrive = (s2, opts, deps) => {
      const qp = deps?.quarantinePath
      const rr = attemptRegeneration({ slug: s2, profile: 'MEDICAL', failures: [{ code: 'QA_FAIL' }],
        runner: (ctx) => asChild(ctx, qp, () => { runnerCalls2 += 1; return { ok: true } }),
        quarantinePath: qp, packetDir: path.join(T, 'packets') })
      return { slug: s2, verdict: 'BLOCKED', steps: [], regenCalls: rr.regenCalls,
        blockedBy: [{ code: 'QA_FAIL', message: `${rr.code}: ${rr.why}` }] }
    }
    const report2 = { blocked: [], done: [] }
    processCandidates({ write: true, wantPr: false, limit: 1, report: report2,
      driveFn: countingDrive, quarantinePath: ledgerPath, scanFn: fixtureScan })
    check('🔴 재시작해도 runner 호출 0', runnerCalls2 === 0, `${runnerCalls2}회`)
    const after2 = readQuarantine(ledgerPath).store[slug]
    check('  장부의 regenCalls 가 그대로다', after2?.regenCalls === MAX_REGEN_CALLS, JSON.stringify(after2))

    /** 🔴 깨진 장부 — 예외가 아니라 전체 HOLD */
    const brokenPath = path.join(T, 'broken.json')
    fs.writeFileSync(brokenPath, '{ 깨짐')
    const report3 = { blocked: [], done: [] }
    const r3 = processCandidates({ write: true, wantPr: false, limit: 3, report: report3,
      driveFn: () => { throw new Error('불려서는 안 된다') }, quarantinePath: brokenPath,
      scanFn: fixtureScan })
    check('🔴 깨진 장부면 한 건도 돌리지 않는다', r3.results.length === 0)
    check('  전체 HOLD 로 보고한다', report3.ledgerHold?.code === 'QUARANTINE_UNREADABLE',
      report3.ledgerHold?.message?.slice(0, 50))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑨ 🔴 실제 최상위 dry-run 명령
// ─────────────────────────────────────────────────────────
console.log('\n⑨ 실제 최상위 dry-run')
{
  const { spawnSync } = await import('node:child_process')
  /**
   * 🔴 **최상위 명령도 임시 HOME 으로 돌린다.** 운영 격리 장부를 읽지도 쓰지도 않는다.
   *    앞판은 실제 HOME 으로 spawn 해서, 운영 장부에 격리된 글이 많아지면
   *    후보가 0이 되어 시험이 빨개졌다 — 코드가 아니라 운영 상태가 판정을 흔들었다.
   */
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-top-'))
  try {
    const r = spawnSync(process.execPath, ['scripts/magazine-auto-register-ready.mjs', '--dry-run', '--json'],
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T } })
    check('🔴 ReferenceError 없이 끝까지 돈다', !/ReferenceError|is not defined/.test(r.stderr ?? ''),
      String(r.stderr ?? '').split('\n')[0].slice(0, 80))
    let j = null
    try { j = JSON.parse(r.stdout) } catch { /* 아래에서 잡는다 */ }
    check('  JSON 보고서를 낸다', Boolean(j), `exit ${r.status}`)
    if (j) {
      /**
       * 🔴 **후보 0건도 정상이다.** 큐가 비면 할 일이 없는 것이지 고장이 아니다.
       *    orchestration 자체는 ⑧의 고정 fixture 가 증명한다. 여기서는
       *    "돌긴 돌았고, 후보가 있었다면 hero 기본값이 막지 않았다" 만 본다.
       */
      check('  processed 를 숫자로 보고한다', Number.isFinite(j.processed ?? 0), `processed ${j.processed}`)
      check('🔴 hero 기본값으로 HERO_BRIEF_MISSING 0건',
        !(j.blocked ?? []).some((b) => (b.blockedBy ?? []).some((x) => /HERO_BRIEF_MISSING|HERO_ALT_REQUIRED/.test(x.code))),
        (j.processed ?? 0) === 0
          ? '후보 0건 — 막힌 것도 0건 (정상 no-work)'
          : (j.blocked ?? []).map((b) => (b.blockedBy ?? []).map((x) => x.code).join('/')).join(' · '))
      check('  dry-run 은 리포트를 쓰지 않는다', j.mode === 'dry-run')
    }
    /** 🔴 임시 HOME 밖(운영 장부 폴더)을 만들지 않았다 */
    check('🔴 운영 장부를 건드리지 않았다 (임시 HOME)',
      !fs.existsSync(path.join(T, 'Library', 'Application Support', 'soransoran', 'regen-packets')))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑩ 🔴 M3-B 연결 경계 — 신규는 validationProfile 필수
// ─────────────────────────────────────────────────────────
console.log('\n⑩ M3-B 연결 경계')
{
  const queueSrc = fs.readFileSync('drafts/magazine/topic-queue.ts', 'utf8')
  check('🔴 TopicQueueItem 에 validationProfile 타입이 있다',
    /validationProfile\?: 'STANDARD' \| 'MEDICAL' \| 'FINANCIAL' \| 'SENSITIVE'/.test(queueSrc))

  /** 기존 = 호환 표로 해석 */
  const legacySlug = Object.keys(LEGACY_PROFILE_MAP)[0]
  const legacy = resolveValidationProfile({ slug: legacySlug })
  check('  기존 항목은 호환 표로 해석된다', legacy.source === 'legacy', `${legacySlug} → ${legacy.profile}`)

  /** 신규 = validationProfile 없으면 거부 */
  const newNoProfile = resolveValidationProfile({ slug: 'm3b-new-topic', cluster: 'clinic', notes: '진단' })
  check('🔴 신규 항목은 validationProfile 없이 통과하지 못한다', newNoProfile.profile === null, newNoProfile.why)
  const newWithProfile = resolveValidationProfile({ slug: 'm3b-new-topic', validationProfile: 'MEDICAL' })
  check('  신규 항목이 프로필을 달고 오면 통과한다',
    newWithProfile.profile === 'MEDICAL' && newWithProfile.source === 'item')

  /**
   * 🔴 **정확한 문구 목록만 찾는 약한 검사를 보강했다.**
   *    앞판은 발견한 문장을 그대로 적어 두고 그것만 찾았다 — 같은 뜻의 다른 문장은
   *    전부 빠져나갔다(실측 30건). 이제 **개념 조합**으로 찾는다:
   *      등급으로 제외 · LOW/MEDIUM 전용 · alt 는 사람이 · 사람 승인 뒤 발행 · 검수 레인
   */
const FILES = [
    'scripts/magazine-auto-register-ready.mjs','scripts/magazine-auto-register.mjs',
    'scripts/magazine-batch-qa.mjs','scripts/magazine-producer-plan.mjs',
    'scripts/magazine-hero-runner.mjs','scripts/lib/magazine-hero.mjs',
    'scripts/lib/magazine-hero-brief.mjs','scripts/lib/magazine-brief-policy.mjs',
    'scripts/lib/magazine-auto-lane.mjs','scripts/lib/magazine-merge-gate.mjs',
    'scripts/lib/magazine-editorial.mjs','scripts/magazine-webui-runner.mjs',
    'scripts/magazine-register.mjs','scripts/magazine-brief-auto.mjs','scripts/magazine-pr.mjs',
    'drafts/magazine/topic-queue.ts','docs/operations/M-GRAPH-PROJECT-CHARTER.md',
  ]
  /** 🔴 뜻으로 찾는다 — 정확한 문구 목록이 아니라 개념 조합 */
  const RULES = [
    { id: 'EXCLUDE_BY_GRADE', re: /(HIGH|autoEligible\s*=?\s*false)[^\n]{0,60}(제외|막|차단|건너뛰|않는다|불가|대상이 아니)/ },
    { id: 'ONLY_LOW_MEDIUM', re: /(LOW[·/]MEDIUM|LOW\/MEDIUM|LOW·MEDIUM)[^\n]{0,40}(만|뿐|전용|자동)/ },
    { id: 'ALT_BY_HUMAN', re: /alt[^\n]{0,40}(사람이 적|사람이 작성|검수 단계에서 사람)/ },
    { id: 'HUMAN_APPROVAL', re: /(창업자|사람)[^\n]{0,30}(승인|검수)[^\n]{0,30}(뒤|후|하면|해야|대상)/ },
    { id: 'REVIEW_LANE', re: /(review\s*레인|검수 레인|수동 검수|사람 판단으로)/ },
    /**
     * 🔴 "gate 에서 끝난다" 류는 EXCLUDE_BY_GRADE 의 (제외|막|차단…) 목록에 없어서
     *    통째로 빠져나갔다(실측 2건). 문장을 늘리지 말고 **개념을 하나 더** 넣는다.
     */
    { id: 'GATE_ENDS_BY_GRADE', re: /(HIGH|autoEligible)[^\n]{0,60}(gate|게이트)[^\n]{0,24}(끝난다|끝낸다|탈락|걸러|제외|막힌다)/ },
  ]
  /**
   * 🔴 역사 기록은 **같은 줄에 명시적 표기**가 있을 때만 허용한다.
   *    `M3-A` 라는 단어만으로는 예외가 되지 않는다.
   */
  const HISTORY = /SUPERSEDED|\(역사[^)]*\)|역사 기록|옛 판(은|이|에)|앞판(은|이|에)|없앴다|제거했다|폐기했다/

  /**
   * 🔴 **범위 밖** — 정책 서술이 아닌 것.
   *    ① topic-queue 의 `notes`·`whyNow` 는 운영자가 적은 **큐 데이터**다.
   *       이번 회차에 큐 26행을 고치지 않기로 했으므로 손대지 않는다.
   *       (그 값은 프로필 판정에 더 이상 쓰이지 않는다 — 고정 표가 대신한다)
   *    ② CHARTER 의 검색 영토·조사 범위 승인은 **원고 발행 게이트가 아니다.**
   *       창업자가 남기기로 한 판단 영역이다.
   */
  const OUT_OF_SCOPE = [
    { file: 'drafts/magazine/topic-queue.ts', re: /^\s*(notes|whyNow):/ },
    { file: 'docs/operations/M-GRAPH-PROJECT-CHARTER.md', re: /검색 영토|조사 범위|브랜드 경계/ },
  ]

  /**
   * 🔴 **여러 줄로 나뉜 문맥도 본다.**
   *    주석은 한 줄에 다 적히지 않는다. `HIGH 는 …` 이 한 줄, `자동 경로에서 제외된다` 가
   *    다음 줄이면 줄 단위 검사는 통째로 놓친다. 그래서 **3줄 창**으로 겹쳐 읽는다.
   *    역사 기록 예외도 그 창 안에 표기가 있어야 인정한다.
   */
  const WINDOW = 3
  const found = []
  for (const f of FILES) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const win = lines.slice(i, i + WINDOW)
      // 🔴 주석 기호를 지워 이어 붙인다 — 줄바꿈이 문장을 자르지 못하게
      const joined = win.map((l) => l.replace(/^\s*(\*|\/\/|#)\s?/, '')).join(' ')
      if (HISTORY.test(joined)) continue
      if (OUT_OF_SCOPE.some((o) => o.file === f && win.some((l) => o.re.test(l)))) continue
      for (const r of RULES) {
        if (!r.re.test(joined)) continue
        // 첫 줄에서만 잡히는 것은 그 줄 기준으로 한 번만 센다
        if (i > 0) {
          const prevJoined = lines.slice(i - 1, i - 1 + WINDOW)
            .map((l) => l.replace(/^\s*(\*|\/\/|#)\s?/, '')).join(' ')
          if (r.re.test(prevJoined) && !HISTORY.test(prevJoined)) continue
        }
        found.push(`${r.id} ${f}:${i + 1} "${joined.trim().slice(0, 70)}"`)
      }
    }
  }
  check('🔴 폐기 정책 문구가 현행 서술로 남아 있지 않다', found.length === 0,
    found.slice(0, 3).join(' · ') || `${RULES.length}개 규칙 · ${FILES.length}개 파일`)
  check('  역사 기록은 명시 표기가 있을 때만 예외다',
    !HISTORY.test('🔴 M3-A 이후 HIGH 는 막힌다'), 'M3-A 단어만으로는 예외가 아니다')

  /**
   * 🔴 **죽은 정책 상수도 잡는다.**
   *    선언만 남고 아무도 판정에 쓰지 않는 등급 상수는, 읽는 사람에게 "아직 등급이 막는다"고
   *    말한다. 문구보다 더 강하게 오해시킨다. 그래서 **이름 자체**를 금지하고,
   *    같은 줄에 제거·SUPERSEDED 표기가 있을 때만 남기도록 한다.
   */
  const DEAD_CONSTS = /\b(AUTO_RISK|LANE_RISK|MERGE_RISK|BLOCKED_RISK_LEVELS|RISK_SENTENCES_REQUIRED|RISK_SENTENCE_REQUIRED_LEVELS)\b/
  const REMOVAL_MARK = /SUPERSEDED|제거|폐기|없앴다/
  const SELF = 'scripts/magazine-m3a-check.mjs'
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir}/${e.name}`
    if (e.isDirectory()) return walk(full)
    return /\.(mjs|mts|ts)$/.test(e.name) ? [full] : []
  })
  const deadHits = []
  for (const f of walk('scripts')) {
    if (f === SELF) continue
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!DEAD_CONSTS.test(line)) return
      if (REMOVAL_MARK.test(line)) return
      deadHits.push(`${f}:${i + 1} "${line.trim().slice(0, 60)}"`)
    })
  }
  check('🔴 죽은 등급 정책 상수가 남아 있지 않다', deadHits.length === 0,
    deadHits.slice(0, 3).join(' · ') || '선언·참조 0')

  /** 🔴 변이 시험 — 규칙이 실제로 잡는지 확인한다 (죽은 검사 방지) */
  const gateRule = RULES.find((r) => r.id === 'GATE_ENDS_BY_GRADE')
  check('  GATE_ENDS_BY_GRADE 가 "gate 에서 끝난다"를 잡는다',
    gateRule.re.test('🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 끝난다.'))
  check('  GATE_ENDS_BY_GRADE 가 지금 문구는 잡지 않는다',
    !gateRule.re.test('🔴 큐에 없거나 validationProfile 을 정할 수 없는 slug 만 gate 에서 끝난다.'))
  check('  DEAD_CONSTS 가 선언을 잡는다',
    DEAD_CONSTS.test("const AUTO_RISK = ['LOW', 'MEDIUM']") &&
    !REMOVAL_MARK.test("const AUTO_RISK = ['LOW', 'MEDIUM']"))
  check('  DEAD_CONSTS 가 제거 표기 줄은 봐준다',
    REMOVAL_MARK.test('// 🔴 AUTO_RISK 제거 (M3-A · SUPERSEDED) — validationProfile 이 대신한다'))

  check('  PR 본문에 등급 게이트 문구가 없다',
    !/riskLevel LOW\/MEDIUM · autoEligible=true/.test(fs.readFileSync('scripts/magazine-auto-register-ready.mjs', 'utf8')))

  /** batch-qa 위험 문장 요구가 프로필 기준 */
  const bq = fs.readFileSync('scripts/magazine-batch-qa.mjs', 'utf8')
  /** 🔴 정본이 실연 결과를 사실대로 적었는가 */
  const charter = fs.readFileSync('docs/operations/M-GRAPH-PROJECT-CHARTER.md', 'utf8')
  check('🔴 정본이 실연 ①(자동 재생성)을 기록한다',
    /실연 ① 자동 재생성/.test(charter) && /MED_CARE_LINE/.test(charter) && /1회 호출/.test(charter))
  check('🔴 정본이 실연 ①에서 hero·register 가 stub 이었음을 밝힌다',
    /hero-runner` 와 `magazine-register` 는 \*\*stub\*\*/.test(charter))
  /**
   * 🔴 실연 ②는 **격리 복제본에서 실제로 돌린 것**이다. 정본이 그 수치를 그대로 적어야
   *    나중에 "말로만 했다" 와 구별된다. 숫자 하나라도 빠지면 FAIL 이다.
   */
  check('🔴 정본이 실연 ②(hero 생성 + 실제 등록)를 수치로 기록한다',
    /실연 ② hero 생성 \+ 실제 등록/.test(charter) &&
    /1200×675/.test(charter) &&
    /2026-09-27T10:30:00\+09:00/.test(charter) &&
    /26 → 25/.test(charter) &&
    /\*\*DONE\*\*/.test(charter))
  check('🔴 정본이 텍스트 원고 ChatGPT 호출 0회를 명시한다',
    /텍스트 원고 ChatGPT 호출 0회/.test(charter))
  check('🔴 정본이 운영 흔적 0 을 바이트 대조로 적는다',
    /운영에 남긴 흔적 0/.test(charter) && /바이트 해시로 대조/.test(charter) &&
    /regen-packets` 없음/.test(charter))
  check('🔴 정본이 아직 하지 않은 것(push·PR·병합·배포)을 적는다',
    /push · PR · 병합 · 배포 · 운영 등록은 하지 않았다/.test(charter) &&
    /Codex 재검토/.test(charter))

  check('🔴 batch-qa riskSentences 요구가 프로필 기준이다',
    /needRisk = laneForRisk\.ok && laneForRisk\.profile !== 'STANDARD'/.test(bq))
}

// ─────────────────────────────────────────────────────────
// ⑪ 🔴 깨진 장부 — 최상위 CLI 가 실패로 끝나는가
// ─────────────────────────────────────────────────────────
console.log('\n⑪ 깨진 장부 · 최상위 CLI')
{
  const { spawnSync } = await import('node:child_process')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-home-'))
  try {
    /** 🔴 임시 HOME 에 **실제 파일**을 깨뜨려 둔다 — 함수 단위 시험으로 대신하지 않는다 */
    const dir = path.join(T, 'Library', 'Application Support', 'soransoran')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'magazine-quarantine.json'), '{ 깨짐')
    const r = spawnSync(process.execPath, ['scripts/magazine-auto-register-ready.mjs', '--dry-run', '--json'],
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T } })
    check('🔴 종료코드가 0이 아니다 (거짓 성공 금지)', r.status !== 0, `exit ${r.status}`)
    let j = null
    try { j = JSON.parse(r.stdout) } catch { /* 아래에서 잡는다 */ }
    check('  JSON 보고서는 나온다', Boolean(j))
    const codes = (j?.blocked ?? []).flatMap((b) => (b.blockedBy ?? []).map((x) => x.code))
    check('🔴 report.blocked 에 QUARANTINE_UNREADABLE 가 남는다',
      codes.includes('QUARANTINE_UNREADABLE'), JSON.stringify(codes))
    check('  한 건도 처리하지 않는다', (j?.processed ?? -1) === 0, `processed ${j?.processed}`)
    check('  운영 장부를 건드리지 않았다 (임시 HOME)', fs.existsSync(path.join(dir, 'magazine-quarantine.json')))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑫ 🔴 --regen-packet fail-closed
// ─────────────────────────────────────────────────────────
console.log('\n⑫ --regen-packet fail-closed')
{
  const { spawnSync } = await import('node:child_process')
  const { readRegenPacket, REGEN_PACKET_SCHEMA } = await import('./magazine-webui-runner.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-pkt-'))
  try {
    // 🔴 regen-packet/3 — attemptId(UUID)는 필수이고 파일 이름과 같아야 한다
    const GOOD_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
    const good = { schemaVersion: REGEN_PACKET_SCHEMA, slug: 'sample-slug', profile: 'MEDICAL',
      attempt: 1, attemptId: GOOD_ID, failures: [{ code: 'MED_DIAGNOSIS', label: '진단 확정', sentence: 'x' }],
      instruction: '그 문장만 고쳐 다시 써라' }
    const w = (name, body) => { const f = path.join(T, name); fs.writeFileSync(f, body); return f }
    const cases = [
      ['없는 파일', path.join(T, 'nope.json'), 'REGEN_PACKET_NOT_FOUND'],
      ['JSON 오류', w('bad.json', '{ 깨진'), 'REGEN_PACKET_BAD_JSON'],
      ['schemaVersion 불일치', w('v1.json', JSON.stringify({ ...good, schemaVersion: 'regen-packet/1' })), 'REGEN_PACKET_SCHEMA'],
      ['instruction 누락', w('noi.json', JSON.stringify({ ...good, instruction: '' })), 'REGEN_PACKET_NO_INSTRUCTION'],
      ['failures 누락', w('nof.json', JSON.stringify({ ...good, failures: [] })), 'REGEN_PACKET_NO_FAILURES'],
      ['slug 불일치', w('mis.json', JSON.stringify({ ...good, slug: 'other-slug' })), 'REGEN_PACKET_SLUG_MISMATCH'],
    ]
    for (const [name, file, code] of cases) {
      const r = readRegenPacket(file, 'sample-slug')
      check(`🔴 ${name} → ${code}`, r.ok === false && r.code === code, r.code ?? 'ok')
    }
    const okRead = readRegenPacket(w(`sample-slug.${GOOD_ID}.json`, JSON.stringify(good)), 'sample-slug')
    check('  정상 패킷만 통과한다', okRead.ok === true && okRead.packet.failures.length === 1)

    /** 🔴 실제 CLI — 잘못된 패킷이면 브라우저를 열지도 않는다 */
    const bad = spawnSync(process.execPath,
      ['scripts/magazine-webui-runner.mjs', '--fetch', 'checkup-items-50s', '--force', '--regen-packet', path.join(T, 'bad.json')],
      { encoding: 'utf8', maxBuffer: 1e8 })
    check('🔴 실제 CLI 가 non-zero 로 끝난다', bad.status !== 0, `exit ${bad.status}`)
    check('🔴 전송 0건이라고 말한다', /전송 0건/.test(bad.stderr + bad.stdout))
    check('🔴 접근 확인(브라우저)도 하지 않는다', !/1\) 접근 확인/.test(bad.stdout))
    const src = fs.readFileSync('scripts/magazine-webui-runner.mjs', 'utf8')
    check('  잘못된 패킷을 null 로 바꿔 진행하지 않는다', !/function regenBlock/.test(src))

    /**
     * 🔴 **옵션은 있는데 값이 없는 경우** — 옛 판은 `undefined` 가 falsy 라
     *    검사를 통째로 건너뛰고 **실제로 원고를 보내 draft.md 를 덮어썼다.**
     */
    const { readRegenPacketArg } = await import('./magazine-webui-runner.mjs')
    for (const [name, argv, want] of [
      ['마지막 인자', ['--fetch', 'x', '--force', '--regen-packet'], 'REGEN_PACKET_PATH_MISSING'],
      ['다음이 다른 옵션', ['--fetch', 'x', '--regen-packet', '--force'], 'REGEN_PACKET_PATH_MISSING'],
      ['빈 문자열', ['--fetch', 'x', '--regen-packet', ''], 'REGEN_PACKET_PATH_MISSING'],
    ]) {
      const r = readRegenPacketArg(argv)
      check(`🔴 ${name} → ${want}`, r.ok === false && r.code === want, r.code ?? 'ok')
    }
    check('  옵션을 안 쓰면 정상이다', readRegenPacketArg(['--fetch', 'x']).path === null)

    /** 🔴 실제 CLI spawn — 접근 확인 0회 · 전송 0건 */
    const before = fs.readFileSync('drafts/magazine/checkup-items-50s/draft.md')
    for (const [name, argv] of [
      ['마지막 인자', ['--fetch', 'checkup-items-50s', '--force', '--regen-packet']],
      ['다음이 다른 옵션', ['--fetch', 'checkup-items-50s', '--regen-packet', '--force']],
    ]) {
      const r = spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', ...argv],
        { encoding: 'utf8', maxBuffer: 1e8 })
      check(`🔴 [CLI] ${name} — exit != 0`, r.status !== 0, `exit ${r.status}`)
      check(`  [CLI] ${name} — 접근 확인 0회`, !/1\) 접근 확인/.test(r.stdout))
      check(`  [CLI] ${name} — 전송 0건`, /전송 0건/.test(r.stderr + r.stdout))
      check(`  [CLI] ${name} — REGEN_PACKET_PATH_MISSING`, /REGEN_PACKET_PATH_MISSING/.test(r.stderr + r.stdout))
    }
    check('🔴 [CLI] draft.md 가 바뀌지 않았다',
      Buffer.compare(before, fs.readFileSync('drafts/magazine/checkup-items-50s/draft.md')) === 0)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

// ─────────────────────────────────────────────────────────
// ⑬ 🔴 2026-09-26 운영 사고 — 필수 반례
// ─────────────────────────────────────────────────────────
console.log('\n⑬ 2026-09-26 운영 사고 반례')
{
  const HERO_LIB = await import('./lib/magazine-hero.mjs')
  const SESSION = await import('./lib/chatgpt-session.mjs')

  // ── 반례 1 · 기존 유효 hero + 변환기 자리표시자 → 이미지 호출 0 · 재주입 ──
  {
    const fx = `_m3a-reuse-${process.pid}`
    const draftDir = path.join('drafts/magazine', fx)
    const heroDir = path.join('public/magazine', fx)
    try {
      fs.mkdirSync(draftDir, { recursive: true }); fs.mkdirSync(heroDir, { recursive: true })
      /** 🔴 진짜 1200×675 webp 를 만든다 — 가짜 헤더로는 verifyHeroFile 을 속일 뿐이다 */
      const src = 'public/magazine/checkup-items-50s/hero.webp'
      check('  반례1 재료: 저장소에 유효한 hero 가 있다', fs.existsSync(src), src)
      fs.copyFileSync(src, path.join(heroDir, 'hero.webp'))
      fs.writeFileSync(path.join(draftDir, 'article-draft.ts'),
        "export const DRAFT = {\n  title: '시험',\n  cluster: 'clinic',\n  // heroImage 는 이미지 회수 후 채운다\n  body: [],\n}\n")

      const plan = HERO_LIB.planHero({ slug: fx, alt: '창가에서 서류를 보는 50대 여성', queueItem: { imageMode: 'REQUIRED' } })
      check('🔴 반례1 유효한 기존 hero 는 BLOCKED 가 아니다', plan.verdict === 'READY', `${plan.verdict} · ${plan.reasons.join('/')}`)
      check('🔴 반례1 재사용으로 표시된다 (이미지 생성 안 함)', plan.checks.reuseExisting === true)
      check('  반례1 크기를 확인했다', plan.checks.heroSize?.width === 1200 && plan.checks.heroSize?.height === 675)
      check('  반례1 주입 대상이다 (draft 가 자리표시자)', plan.checks.willInject === true)

      /** 🔴 실제 CLI 를 --write 로 돌린다. Chrome 이 없어도 통과해야 한다 */
      const { spawnSync } = await import('node:child_process')
      const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-reuse-home-'))
      const r = spawnSync(process.execPath,
        ['scripts/magazine-hero-runner.mjs', '--slug', fx, '--alt', '창가에서 서류를 보는 50대 여성', '--write', '--json'],
        { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T } })
      fs.rmSync(T, { recursive: true, force: true })
      let j = null; try { j = JSON.parse(r.stdout) } catch { /* 아래에서 잡는다 */ }
      check('🔴 반례1 CLI 가 성공으로 끝난다 (exit 0)', r.status === 0, `exit ${r.status} · ${String(r.stderr).slice(0, 80)}`)
      check('🔴 반례1 applied=true', j?.applied === true, JSON.stringify(j?.reasons ?? []))
      const after = fs.readFileSync(path.join(draftDir, 'article-draft.ts'), 'utf8')
      check('🔴 반례1 heroImage 4필드가 다시 주입됐다',
        /heroImage: \{/.test(after) && /width: 1200/.test(after) && /height: 675/.test(after))
      check('🔴 반례1 hero 파일 바이트가 그대로다 (새로 만들지 않았다)',
        fs.readFileSync(path.join(heroDir, 'hero.webp')).equals(fs.readFileSync(src)))
    } finally {
      fs.rmSync(draftDir, { recursive: true, force: true })
      fs.rmSync(heroDir, { recursive: true, force: true })
    }
  }

  // ── 반례 1-B · 손상된 hero 만 실패한다 ──
  {
    const fx = `_m3a-broken-${process.pid}`
    const draftDir = path.join('drafts/magazine', fx)
    const heroDir = path.join('public/magazine', fx)
    try {
      fs.mkdirSync(draftDir, { recursive: true }); fs.mkdirSync(heroDir, { recursive: true })
      fs.writeFileSync(path.join(heroDir, 'hero.webp'), Buffer.from('not a webp at all'))
      fs.writeFileSync(path.join(draftDir, 'article-draft.ts'),
        "export const DRAFT = {\n  title: '시험',\n  cluster: 'clinic',\n  // heroImage 는 이미지 회수 후 채운다\n  body: [],\n}\n")
      const plan = HERO_LIB.planHero({ slug: fx, alt: '창가에서 서류를 보는 50대 여성', queueItem: { imageMode: 'REQUIRED' } })
      check('🔴 반례1-B 손상된 hero 는 BLOCKED 다', plan.verdict === 'BLOCKED', plan.reasons.join('/'))
      check('  반례1-B 사유가 "손상" 이다', plan.reasons.some((x) => /손상/.test(x)))
    } finally {
      fs.rmSync(draftDir, { recursive: true, force: true })
      fs.rmSync(heroDir, { recursive: true, force: true })
    }
  }

  // ── 반례 2 · Chrome 없음 + 죽은 잠금 → 자동 기동한다 ──
  {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-lock-'))
    try {
      /**
       * 🔴 **실제 `profileLockState` 를 돌린다.** 앞 판은 시험 안에서 판정 규칙을
       *    복제한 `judge()` 를 썼다 — 제품 코드가 틀려도 복제본이 맞으면 초록이 뜬다.
       *    이제 임시 프로필과 가짜 프로세스 목록을 **주입해** 그 함수를 그대로 돌린다.
       */
      const mk = (name, lockPid) => {
        const dir = path.join(T, name)
        fs.mkdirSync(dir, { recursive: true })
        if (lockPid !== null) fs.symlinkSync(`host-${lockPid}`, path.join(dir, 'SingletonLock'))
        return dir
      }
      const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      const procs = (rows) => () => rows

      /** ① 잠금 PID 가 아예 없다 → STALE */
      const dead = mk('dead', 999001)
      const r1 = SESSION.profileLockState({ profileDir: dead, processes: procs([{ pid: 4242, command: '/bin/zsh' }]) })
      check('🔴 반례2-① 죽은 PID 잠금 → STALE', r1.state === 'STALE', `${r1.state} · ${r1.why}`)

      /** ② 이 프로필을 쓰는 Chrome 이 실재 → LIVE (죽이지 않는다) */
      const live = mk('live', 999002)
      const r2 = SESSION.profileLockState({ profileDir: live,
        processes: procs([{ pid: 999002, command: `${CHROME} --user-data-dir=${live} --remote-debugging-port=9333` }]) })
      check('🔴 반례2-② 이 프로필의 Chrome 이 돌면 → LIVE', r2.state === 'LIVE', `${r2.state} · ${r2.why}`)

      /** ③ 🔴 **PID 재사용** — 번호는 살아 있지만 Chrome 이 아니다 → STALE 이어야 한다 */
      const reused = mk('reused', 999003)
      const r3 = SESSION.profileLockState({ profileDir: reused,
        processes: procs([{ pid: 999003, command: '/usr/bin/python3 some-unrelated-script.py' }]) })
      check('🔴 반례2-③ PID 재사용(다른 프로그램) → STALE', r3.state === 'STALE', `${r3.state} · ${r3.why}`)
      check('  반례2-③ 사유가 재사용임을 밝힌다', /재사용/.test(r3.why), r3.why)

      /** ④ Chrome 이긴 한데 **다른 프로필** → 우리 것이 아니다 → STALE */
      const other = mk('other', 999004)
      const r4 = SESSION.profileLockState({ profileDir: other,
        processes: procs([{ pid: 999004, command: `${CHROME} --user-data-dir=/somewhere/else` }]) })
      check('🔴 반례2-④ 다른 프로필의 Chrome → STALE', r4.state === 'STALE', `${r4.state} · ${r4.why}`)

      /** ⑤ 목록을 못 얻으면 **모른다** → 보수적으로 LIVE */
      const unknown = mk('unknown', 999005)
      const r5 = SESSION.profileLockState({ profileDir: unknown, processes: () => null })
      check('🔴 반례2-⑤ 프로세스 조회 실패 → 보수적으로 LIVE', r5.state === 'LIVE', `${r5.state} · ${r5.why}`)

      /** ⑥ 잠금 파일이 없으면 NONE */
      const none = mk('none', null)
      check('  반례2-⑥ 잠금 파일이 없으면 NONE',
        SESSION.profileLockState({ profileDir: none, processes: procs([]) }).state === 'NONE')

      /**
       * 🔴 ensureChrome 이 실제로 **띄우려 드는지** (진짜 Chrome 은 띄우지 않는다).
       *
       *    🔴 `browserCheck` 까지 주입한다. 앞판은 실제 `browserAvailable()` 을 썼고,
       *       그건 macOS Chrome 경로를 본다 — CI 러너(Linux)에는 없으니 `BROWSER_MISSING`
       *       으로 먼저 빠져 `spawn 0회 · lock undefined` 가 됐다. 로컬 초록 / CI 빨강.
       *       시험이 환경을 읽으면 안 된다.
       */
      /**
       * 🔴 **신원 판정은 여기 시험의 대상이 아니다.** `ensureChrome` 은 이제 프로필 신원의
       *    정본이라, 임시 fixture 폴더를 주면 당연히 막힌다. 이 구간은 **잠금·기동**을 보므로
       *    신원은 통과로 고정한다. 신원이 실제로 막는지는 ㉕ 가 따로 증명한다.
       */
      const idOk = async () => ({ ok: true })
      let spawned = 0
      const spawnFn = () => { spawned += 1; return { unref() {} } }
      // 🔴 프로필도 임시 fixture 다 — 실제 프로필이 살아 있든 죽었든 결과가 같아야 한다
      const rs = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, spawnFn, cdpCheck: async () => false, browserCheck: () => true,
        profileDir: dead, verifyProfileFn: idOk,
      })
      check('🔴 반례2 죽은 잠금이면 기동을 시도한다', spawned === 1, `spawn ${spawned}회 · lock ${rs.lock?.state}`)

      /** 🔴 브라우저가 아예 없으면 띄우려 들지 않는다 — 그 판정은 그대로 살아 있다 */
      let spawned2 = 0
      const rNoBrowser = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => false, browserCheck: () => false, profileDir: dead, verifyProfileFn: idOk,
        spawnFn: () => { spawned2 += 1; return { unref() {} } },
      })
      check('🔴 반례2 브라우저가 없으면 BROWSER_MISSING · spawn 0회',
        rNoBrowser.ok === false && rNoBrowser.reason === SESSION.STATUS.BROWSER_MISSING && spawned2 === 0,
        `${rNoBrowser.reason} · spawn ${spawned2}회`)

      /** 🔴 CDP 가 이미 살아 있으면 띄우지 않는다 */
      let spawned3 = 0
      const rAlive = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => true, browserCheck: () => true, profileDir: dead, verifyProfileFn: idOk,
        spawnFn: () => { spawned3 += 1; return { unref() {} } },
      })
      check('  반례2 CDP 가 살아 있으면 기동하지 않는다',
        rAlive.ok === true && rAlive.started === false && spawned3 === 0, `spawn ${spawned3}회`)

      /** 🔴 살아 있는 프로필이면 띄우지 않는다 — 남의 창을 빼앗지 않는다 */
      let spawned4 = 0
      const rLive = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => false, browserCheck: () => true, profileDir: live, verifyProfileFn: idOk,
        processes: procs([{ pid: 999002, command: `${CHROME} --user-data-dir=${live}` }]),
        spawnFn: () => { spawned4 += 1; return { unref() {} } },
      })
      check('🔴 반례2 LIVE 프로필이면 기동 0회 · 죽이지 않는다',
        spawned4 === 0 && rLive.ok === false && rLive.lock?.state === 'LIVE',
        `spawn ${spawned4}회 · lock ${rLive.lock?.state} · ${rLive.reason}`)

      /**
       * 🔴 **소스 정규식 대신 행동으로 본다.** 호출 인자가 하나 늘면 곧바로 깨지는 검사였다 —
       *    코드는 멀쩡한데 시험만 빨개지는 종류다. 위 두 반례가 같은 것을 실제 실행으로 증명한다.
       */
      const srcTxt = fs.readFileSync('scripts/lib/chatgpt-session.mjs', 'utf8')
      check('  반례2 STALE 과 LIVE 가 서로 다른 결과를 낸다 (행동으로 확인)',
        spawned === 1 && spawned4 === 0, `STALE spawn ${spawned}회 · LIVE spawn ${spawned4}회`)
      /**
       * 🔴 **죽이는 "호출"만 본다.** `kill` 이라는 글자는 주석에도 있다.
       *    `process.kill(pid, 0)` 은 신호를 보내지 않는 생존 확인이다 — 이제 그것도 없다.
       */
      const killCalls = [...srcTxt.matchAll(/process\.kill\(([^)]*)\)/g)].map((m) => m[1])
        .filter((a) => !/,\s*0\s*$/.test(a))
      check('🔴 반례2 살아 있는 Chrome 을 죽이는 코드가 없다',
        killCalls.length === 0 && !/pkill|killall|SIGKILL|SIGTERM/.test(srcTxt),
        killCalls.join(' · ') || '신호를 보내는 호출 0건')
    } finally { fs.rmSync(T, { recursive: true, force: true }) }
  }

  // ── 반례 3 · 로그인 만료 → 자동 우회 없음 · 전송 0 ──
  {
    check('🔴 반례3 login_required 는 치명으로 분류된다', SESSION.isFatal(SESSION.STATUS.LOGIN_REQUIRED))
    const wsrc = fs.readFileSync('scripts/magazine-webui-runner.mjs', 'utf8')
    check('🔴 반례3 로그인 만료를 자동 우회하지 않는다 (재시도·자동 로그인 없음)',
      !/auto.?login|자동 로그인|credentials|password/i.test(wsrc))
    check('  반례3 치명이면 전송 0건이라고 말한다', /한 글자도 보내지 않았다/.test(wsrc))
  }

  // ── 반례 4 · hero 실패 → article-draft 원상복구 ──
  // ── 반례 5 · 후보 1 실패 → 후보 2 계속 ──
  {
    const AR = await import('./magazine-auto-register.mjs')
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-atomic-'))
    const ledgerPath = path.join(T, 'q.json')
    try {
      const target = `drafts/magazine/${SLUG}/article-draft.ts`
      const before = fs.readFileSync(target)
      const calls = []
      const deps = makeDeps({ qaFailsUntil: 0, ledgerPath, packetDir: path.join(T, 'packets'), calls })
      /** 🔴 변환기가 실제로 하듯 heroImage 를 지운다 — 그 뒤 hero 가 실패한다 */
      const baseRun = deps.run
      deps.run = (f, a, o) => {
        const name = path.basename(String(f))
        if (name === 'magazine-md-to-draft.mjs') {
          calls.push(name)
          /**
           * 🔴 **반드시 바뀌게 쓴다.** 앞 판은 heroImage 블록을 정규식으로 지우려 했는데
           *    그 블록이 없는 원고에서는 아무것도 바뀌지 않아, "원상복구됐다" 가
           *    **저절로** 통과하는 죽은 시험이 됐다. 실제 변환기도 머리말을 바꾼다.
           */
          fs.writeFileSync(target, `// 변환기가 다시 쓴 흔적 (시험)\n${String(before)}`)
          return { code: 0, stdout: '변환', stderr: '', json: null }
        }
        if (name === 'magazine-hero-runner.mjs') { calls.push(name); return { code: 1, stdout: '', stderr: 'hero 실패(시험)', json: null } }
        return baseRun(f, a, o)
      }
      const r = drive(SLUG, { write: true, pr: false, publishAt: '2027-02-01', alt: '시험 여성', allowOptional: true, autoLane: false }, deps)
      check('  반례4 변환기가 실제로 파일을 바꿨다 (죽은 시험 아님)',
        calls.includes('magazine-md-to-draft.mjs'), calls.join('>'))
      check('🔴 반례4 hero 실패면 BLOCKED 다', r.verdict === 'BLOCKED', r.verdict)
      check('🔴 반례4 article-draft.ts 가 원상복구됐다', fs.readFileSync(target).equals(before),
        '중간 변경이 남았다 — RETURN_DIRTY 재발')
      check('  반례4 되돌렸다고 보고한다', r.steps.some((x) => x.stage === 'rollback'),
        r.steps.map((x) => x.stage).join('>'))

      /** 🔴 반례5 — 첫 후보가 막혀도 다음 후보는 계속 간다 */
      const results = []
      for (const [i, sl] of FIXTURE_SLUGS.entries()) {
        const c2 = []
        const d2 = makeDeps({ qaFailsUntil: 0, ledgerPath, packetDir: path.join(T, 'packets'), calls: c2 })
        const b2 = d2.run
        d2.run = (f, a, o) => {
          const name = path.basename(String(f))
          if (i === 0 && name === 'magazine-hero-runner.mjs') return { code: 1, stdout: '', stderr: '첫 후보만 실패', json: null }
          const rr = b2(f, a, o)
          if (name === 'magazine-batch-qa.mjs') return { ...rr, json: [{ slug: sl, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
          if (name === 'magazine-register.mjs') return { ...rr, json: { verdict: 'READY', slug: sl } }
          return rr
        }
        results.push(drive(sl, { write: true, pr: false, publishAt: `2027-02-0${i + 2}`, alt: '시험 여성', allowOptional: true, autoLane: false }, d2))
      }
      check('🔴 반례5 첫 후보는 BLOCKED', results[0].verdict === 'BLOCKED', results[0].verdict)
      check('🔴 반례5 나머지 후보는 계속 진행했다', results.slice(1).every((x) => x.verdict === 'DONE'),
        results.map((x) => `${x.slug}:${x.verdict}`).join(' · '))
      /** 🔴 회차가 건드릴 수 있는 곳만 본다 — 개발 중인 scripts/ 변경과 섞으면 뜻이 흐려진다 */
      const dirty = spawnSyncTop('git', ['status', '--porcelain', '--untracked-files=no', '--', 'drafts', 'public', 'src'])
      check('🔴 반례5 회차 뒤 원고·이미지·콘텐츠에 추적 변경 0건', dirty === '', dirty.slice(0, 160))
    } finally {
      /**
       * 🔴 **시험이 실패해도 작업 트리를 더럽히지 않는다.**
       *    되돌리기가 고장 난 상태로 이 시험을 돌리면 추적 파일이 바뀐 채 남는다.
       *    그건 이 시험이 잡으려는 바로 그 사고다 — 시험이 그 사고를 일으키면 안 된다.
       */
      for (const sl of FIXTURE_SLUGS) {
        const f = `drafts/magazine/${sl}/article-draft.ts`
        try { fs.writeFileSync(f, spawnSyncTop('git', ['show', `HEAD:${f}`]) + '\n') } catch { /* 없으면 그만 */ }
      }
      fs.rmSync(T, { recursive: true, force: true })
    }
  }

  // ── 반례 8 · register 두 파일 부분 쓰기 → 바이트 단위 원복 (환경 독립) ──
  {
    /**
     * 🔴 **운영 큐에 기대지 않는다** (2026-09-27).
     *    앞판은 `item: { day: 18 }` 을 쓰고 **실제 topic-queue** 에서 그 블록을 찾았다.
     *    day 18(`checkup-items-50s`)이 등록돼 큐에서 빠지자 시험이 깨졌다 —
     *    자동화가 성공할수록 CI 가 빨개지는 구조다.
     *    이제 임시 articles/queue fixture 를 **실제 `applyWrite`** 에 주입한다.
     */
    const REG = await import('./magazine-register.mjs')
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-reg2-'))
    try {
      const aPath = path.join(T, 'articles.ts')
      const qPath = path.join(T, 'topic-queue.ts')
      /** 🔴 실제 삽입 앵커와 같은 문자열을 쓴다 — 다르면 삽입이 조용히 실패한다 */
      const articlesFixture =
        'export const MAGAZINE_ARTICLES = {\n} satisfies Record<string, MagazineArticleBody>\n'
      const queueFixture = [
        'export const TOPIC_QUEUE = [',
        '  {', '    day: 777,', "    slug: 'fixture-slug',", '  },',
        '  {', '    day: 778,', "    slug: 'other-slug',", '  },',
        ']', '',
      ].join('\n')
      fs.writeFileSync(aPath, articlesFixture)
      fs.writeFileSync(qPath, queueFixture)
      const before = { a: fs.readFileSync(aPath), q: fs.readFileSync(qPath) }

      const mkFake = () => ({
        slug: 'fixture-slug',
        _internal: {
          draft: { literal: "{ title: '시', description: '설', cluster: 'clinic', publishedAt: '', body: [] }" },
          norm: { date: '2027-03-01', publishAt: '2027-03-01T10:30:00+09:00' },
          item: { day: 777 },
          articlesSrc: String(before.a),
        },
      })

      /** ① 정상 경로가 실제로 두 파일을 바꾼다 — 죽은 시험이 아님을 먼저 못 박는다 */
      const okRes = REG.applyWrite(mkFake(), { articlesPath: aPath, queuePath: qPath })
      check('  반례8 정상 경로는 두 파일을 쓴다', okRes.ok === true, JSON.stringify(okRes).slice(0, 120))
      check('  반례8 articles 에 글이 들어갔다', /fixture-slug/.test(fs.readFileSync(aPath, 'utf8')))
      check('  반례8 queue 에서 그 항목이 빠졌다', !/fixture-slug/.test(fs.readFileSync(qPath, 'utf8')))
      fs.writeFileSync(aPath, before.a); fs.writeFileSync(qPath, before.q)

      /** ② 첫 쓰기 성공 → 두 번째 쓰기 실패 → 두 파일 바이트 원복 */
      let writes = 0
      const flaky = (target, data) => {
        writes += 1
        if (writes === 2) throw new Error('EIO: 시험 주입 — 두 번째 쓰기 실패')
        fs.writeFileSync(target, data)
      }
      const r = REG.applyWrite(mkFake(), { write: flaky, articlesPath: aPath, queuePath: qPath })
      check('🔴 반례8 두 번째 쓰기가 실패하면 ok=false', r.ok === false, JSON.stringify(r).slice(0, 140))
      check('🔴 반례8 되돌렸다고 말한다', r.rolledBack === true, r.why)
      check('🔴 반례8 첫 쓰기는 실제로 일어났다 (죽은 시험 아님)', writes === 2, `write ${writes}회`)
      check('🔴 반례8 articles fixture 가 BEFORE 와 바이트 동일', fs.readFileSync(aPath).equals(before.a))
      check('🔴 반례8 queue fixture 가 BEFORE 와 바이트 동일', fs.readFileSync(qPath).equals(before.q))

      /** ③ 🔴 운영 큐가 몇 건이든 같은 시험이 통과한다 */
      for (const [name, rows] of [['0건', 0], ['1건', 1]]) {
        const q2 = path.join(T, `queue-${name}.ts`)
        fs.writeFileSync(q2, rows
          ? "export const TOPIC_QUEUE = [\n  {\n    day: 777,\n    slug: 'fixture-slug',\n  },\n]\n"
          : 'export const TOPIC_QUEUE = [\n]\n')
        fs.writeFileSync(aPath, before.a)
        const rr = REG.applyWrite(mkFake(), { articlesPath: aPath, queuePath: q2 })
        if (rows) check(`  반례8 큐 ${name} 이어도 정상 동작`, rr.ok === true, JSON.stringify(rr).slice(0, 100))
        else check(`🔴 반례8 큐 ${name} 이면 추측하지 않고 막는다`,
          rr.ok === false && /찾지 못했다/.test(rr.why ?? ''), rr.why)
        fs.writeFileSync(aPath, before.a)
      }
    } finally { fs.rmSync(T, { recursive: true, force: true }) }
  }

  // ── 반례 9 · 등록이 막혀도 네 산출물이 BEFORE 그대로 · 다음 후보 계속 ──
  {
    const LOAD = await import('./lib/magazine-load.mjs')
    const HERO = await import('./lib/magazine-hero.mjs')
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-reg-atomic-'))
    const ledgerPath = path.join(T, 'q.json')
    const sl0 = FIXTURE_SLUGS[0]
    const target = `drafts/magazine/${sl0}/article-draft.ts`
    const heroPath = HERO.heroFilePath(sl0)
    const before = {
      articles: fs.readFileSync(LOAD.ARTICLES_TS),
      queue: fs.readFileSync(LOAD.QUEUE_TS),
      draft: fs.readFileSync(target),
      hero: fs.existsSync(heroPath) ? fs.readFileSync(heroPath) : null,
    }
    /** 🔴 어느 후보를 register 에서 막을지 — 시나리오별로 바꾼다 */
    let blockAt = (i) => i === 0
    const runRound = () => {
      const results = []
      for (const [i, sl] of FIXTURE_SLUGS.entries()) {
        const calls = []
        const deps = makeDeps({ qaFailsUntil: 0, ledgerPath, packetDir: path.join(T, 'packets'), calls })
        const base = deps.run
        deps.run = (f, a, o) => {
          const name = path.basename(String(f))
          if (name === 'magazine-md-to-draft.mjs') {
            calls.push(name)
            fs.writeFileSync(`drafts/magazine/${sl}/article-draft.ts`, `// 변환 흔적 (시험)\n${fs.readFileSync(`drafts/magazine/${sl}/article-draft.ts`, 'utf8')}`)
            return { code: 0, stdout: '변환', stderr: '', json: null }
          }
          // 🔴 막을 후보는 바깥에서 정한다 — 섞인 회차와 전부 막힌 회차를 둘 다 본다
          if (blockAt(i) && name === 'magazine-register.mjs') {
            calls.push(name)
            return { code: 1, stdout: '', stderr: '', json: { verdict: 'BLOCKED', slug: sl, reasons: ['시험 주입: 등록 실패'] } }
          }
          const rr = base(f, a, o)
          if (name === 'magazine-batch-qa.mjs') return { ...rr, json: [{ slug: sl, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
          if (name === 'magazine-register.mjs') return { ...rr, json: { verdict: 'READY', slug: sl } }
          return rr
        }
        results.push(drive(sl, { write: true, pr: false, publishAt: `2027-03-0${i + 1}`, alt: '시험 여성', allowOptional: true, autoLane: false }, deps))
      }
      return results
    }
    const restoreAll = () => {
      fs.writeFileSync(LOAD.ARTICLES_TS, before.articles)
      fs.writeFileSync(LOAD.QUEUE_TS, before.queue)
      for (const sl of FIXTURE_SLUGS) {
        const f = `drafts/magazine/${sl}/article-draft.ts`
        try { fs.writeFileSync(f, spawnSyncTop('git', ['show', `HEAD:${f}`]) + '\n') } catch { /* 없으면 그만 */ }
      }
    }
    try {
      /** 9-A · 섞인 회차 — 첫 후보만 막힌다. **막힌 후보**가 아무것도 남기지 않아야 한다 */
      blockAt = (i) => i === 0
      const mixed = runRound()
      check('🔴 반례9-A register 가 막으면 BLOCKED 다', mixed[0].verdict === 'BLOCKED', mixed[0].verdict)
      check('🔴 반례9-A 다음 후보는 계속 진행한다', mixed.slice(1).every((x) => x.verdict === 'DONE'),
        mixed.map((x) => `${x.slug}:${x.verdict}`).join(' · '))
      check('🔴 반례9-A articles.ts 가 BEFORE 와 동일', fs.readFileSync(LOAD.ARTICLES_TS).equals(before.articles))
      check('🔴 반례9-A topic-queue.ts 가 BEFORE 와 동일', fs.readFileSync(LOAD.QUEUE_TS).equals(before.queue))
      check('🔴 반례9-A 막힌 후보의 article-draft.ts 가 BEFORE 와 동일', fs.readFileSync(target).equals(before.draft))
      check('🔴 반례9-A 막힌 후보의 hero 가 BEFORE 와 동일',
        before.hero === null ? !fs.existsSync(heroPath) : fs.readFileSync(heroPath).equals(before.hero))
      /**
       * 🔴 **성공한 후보의 변경은 남는 것이 정상이다.** 그 파일은 PR 에 실려 나간다.
       *    남으면 안 되는 것은 **막힌 후보**가 만든 중간 변경뿐이다.
       */
      const dirtyMixed = spawnSyncTop('git', ['status', '--porcelain', '--untracked-files=no', '--', 'drafts', 'public', 'src'])
        .split('\n').filter(Boolean).map((x) => x.trim().split(/\s+/).pop())
      check('🔴 반례9-A 막힌 후보의 파일은 남지 않았다', !dirtyMixed.includes(target), dirtyMixed.join(' · ') || '(없음)')
      check('  반례9-A 남은 것은 성공한 후보의 것뿐이다',
        dirtyMixed.every((f) => FIXTURE_SLUGS.slice(1).some((sl) => f.includes(`/${sl}/`))), dirtyMixed.join(' · ') || '(없음)')
      restoreAll()

      /** 9-B · 전부 막힌 회차 — **최종 tracked diff 0** 이어야 한다 */
      blockAt = () => true
      const allBlocked = runRound()
      check('🔴 반례9-B 전부 BLOCKED', allBlocked.every((x) => x.verdict === 'BLOCKED'),
        allBlocked.map((x) => x.verdict).join(','))
      const dirty = spawnSyncTop('git', ['status', '--porcelain', '--untracked-files=no', '--', 'drafts', 'public', 'src'])
      check('🔴 반례9-B 최종 tracked diff 0', dirty === '', dirty.slice(0, 200))
      restoreAll()

      /**
       * 9-C · 🔴 **이중 방어가 실제로 잡는가.**
       *    register 안의 원복까지 실패해서 `articles.ts` 가 바뀐 채 BLOCKED 로 돌아오는
       *    최악의 경우를 만든다. 그때 drive 의 스냅샷이 한 번 더 잡아야 한다.
       *    (이 반례가 없으면 drive 쪽 스냅샷은 **시험되지 않는 죽은 게이트**다 —
       *     실제로 ARTICLES_TS·QUEUE_TS 를 빼 봐도 아무 시험이 깨지지 않았다.)
       */
      const sl = FIXTURE_SLUGS[0]
      const calls = []
      const deps = makeDeps({ qaFailsUntil: 0, ledgerPath, packetDir: path.join(T, 'packets2'), calls })
      const base = deps.run
      deps.run = (f, a, o) => {
        const name = path.basename(String(f))
        if (name === 'magazine-register.mjs') {
          calls.push(name)
          // 🔴 부분 쓰기를 남긴 채 실패한다 (register 내부 원복까지 실패한 상황)
          fs.writeFileSync(LOAD.ARTICLES_TS, `${String(before.articles)}\n// 부분 쓰기 잔여 (시험)\n`)
          fs.writeFileSync(LOAD.QUEUE_TS, String(before.queue).replace(/\n$/, '\n// 부분 쓰기 잔여 (시험)\n'))
          return { code: 1, stdout: '', stderr: '', json: { verdict: 'BLOCKED', slug: sl, reasons: ['시험 주입: 부분 쓰기 후 실패'] } }
        }
        const rr = base(f, a, o)
        if (name === 'magazine-batch-qa.mjs') return { ...rr, json: [{ slug: sl, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
        return rr
      }
      const rc = drive(sl, { write: true, pr: false, publishAt: '2027-03-09', alt: '시험 여성', allowOptional: true, autoLane: false }, deps)
      check('  반례9-C 부분 쓰기가 실제로 일어났다 (죽은 시험 아님)', calls.includes('magazine-register.mjs'), calls.join('>'))
      check('🔴 반례9-C BLOCKED 로 끝난다', rc.verdict === 'BLOCKED', rc.verdict)
      check('🔴 반례9-C drive 스냅샷이 articles.ts 를 되돌린다',
        fs.readFileSync(LOAD.ARTICLES_TS).equals(before.articles))
      check('🔴 반례9-C drive 스냅샷이 topic-queue.ts 를 되돌린다',
        fs.readFileSync(LOAD.QUEUE_TS).equals(before.queue))
      check('  반례9-C 되돌렸다고 보고한다', rc.steps.some((x) => x.stage === 'rollback'),
        rc.steps.map((x) => x.stage).join('>'))
    } finally {
      /** 🔴 시험이 실패해도 트리를 더럽히지 않는다 */
      restoreAll()
      fs.rmSync(T, { recursive: true, force: true })
    }
  }

  // ── 반례 6 · 복귀 실패도 report JSON 에 남는다 ──
  {
    const rsrc = fs.readFileSync('scripts/magazine-auto-register-ready.mjs', 'utf8')
    const finishBody = rsrc.slice(rsrc.indexOf('const finish = async'), rsrc.indexOf('// ── write 전 안전장치'))
    check('🔴 반례6 report 를 finish() 안에서 쓴다', /writeReport\(report, \{ write \}\)/.test(finishBody))
    check('🔴 반례6 returned 를 정한 뒤에 쓴다',
      finishBody.indexOf('report.returned =') < finishBody.indexOf('writeReport(report'))
    check('🔴 반례6 leftOnBranch 를 정한 뒤에 쓴다',
      finishBody.indexOf('report.leftOnBranch =') < finishBody.indexOf('writeReport(report'))
    check('🔴 반례6 exitCode 를 담는다',
      finishBody.indexOf('report.exitCode = exitCode') < finishBody.indexOf('writeReport(report'))
    // 🔴 `function writeReport(report, …)` 선언부는 호출이 아니다 — 세지 않는다
    check('🔴 반례6 finish() 밖에서 report 를 쓰지 않는다',
      (rsrc.match(/(?<!function )writeReport\(report/g) ?? []).length === 1,
      `호출 ${(rsrc.match(/(?<!function )writeReport\(report/g) ?? []).length}회`)
    check('  반례6 report 뼈대에 세 칸이 있다',
      /returned: null,/.test(rsrc) && /leftOnBranch: null,/.test(rsrc) && /exitCode: null,/.test(rsrc))
  }

  // ── 반례 7 · CI 와 runtime 의 파일 유무가 달라도 결과가 같다 ──
  {
    check('🔴 반례7 후보 선택이 git 추적본만 본다',
      /spawnSyncTop\('git', \['ls-files'/.test(fs.readFileSync('scripts/magazine-m3a-check.mjs', 'utf8')))
    const probe = `drafts/magazine/_m3a-env-probe-${process.pid}`
    try {
      fs.mkdirSync(probe, { recursive: true })
      for (const f of ['brief.md', 'review.ts', 'draft.md', 'article-draft.ts']) fs.writeFileSync(path.join(probe, f), '// probe\n')
      const tracked = new Set(spawnSyncTop('git', ['ls-files', '--', 'drafts/magazine']).split('\n').filter(Boolean))
      const pickedAgain = [...new Set([...tracked].map((f) => f.split('/')[2]))]
        .filter((n) => n && !n.startsWith('_')).sort()
        .filter((n) => ['brief.md', 'review.ts', 'draft.md', 'article-draft.ts'].every((f) => tracked.has(`drafts/magazine/${n}/${f}`)))
        .slice(0, 3)
      check('🔴 반례7 미추적 draft 를 더해도 후보가 같다',
        pickedAgain.join(',') === FIXTURE_SLUGS.join(','), `${pickedAgain.join(',')} vs ${FIXTURE_SLUGS.join(',')}`)
    } finally { fs.rmSync(probe, { recursive: true, force: true }) }
  }
}

// ─────────────────────────────────────────────────────────
// ⑭ 🔴 2026-09-27 운영 실패 — composer 계약 · 탭 · 진단 · merge gate
// ─────────────────────────────────────────────────────────
console.log('\n⑭ 2026-09-27 운영 실패 반례')
{
  const SESSION2 = await import('./lib/chatgpt-session.mjs')
  const WEBUI = await import('./magazine-webui-runner.mjs')

  // ── 반례 10 · composer 선택자 정본을 세 경로가 공유한다 ──
  {
    /**
     * 🔴 2026-09-27: probe 는 통과했는데 원고 회수 5건과 hero 2건이 전부 죽었다.
     *    probe 만 새 선택자를 알고 나머지는 `#prompt-textarea` 만 봤기 때문이다.
     *    실측: `#prompt-textarea` 0개 · `[contenteditable="true"][role="textbox"]` 1개.
     */
    const SEL = SESSION2.COMPOSER_SELECTOR
    check('🔴 반례10 정본 선택자가 옛 선택자를 포함한다', SEL.includes('#prompt-textarea'), SEL)
    check('🔴 반례10 정본 선택자가 새 선택자를 포함한다',
      SEL.includes('[contenteditable="true"][role="textbox"]'), SEL)
    check('🔴 반례10 광범위한 contenteditable 단독은 쓰지 않는다',
      !/(^|,)\s*\[contenteditable="true"\]\s*(,|$)/.test(SEL), SEL)

    /** 🔴 세 경로가 **하나의 상수**를 쓴다 — 하드코딩이 남아 있으면 다시 갈라진다 */
    const hard = []
    for (const f of ['scripts/lib/chatgpt-session.mjs', 'scripts/magazine-hero-runner.mjs']) {
      const src = fs.readFileSync(f, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        // 진단 신호(querySelector)는 계약이 아니다 — 옛/새 선택자를 나눠 보려는 용도다
        if (/waitForSelector\('#prompt-textarea'|locator\('#prompt-textarea'\)|click\('#prompt-textarea'\)/.test(line)) {
          hard.push(`${f}:${i + 1}`)
        }
      }
    }
    check('🔴 반례10 조작 경로에 선택자 하드코딩 0', hard.length === 0, hard.join(' · ') || '정본 상수만 쓴다')

    /** 🔴 양쪽 fixture 로 실제 매칭을 확인한다 — 문자열만 보면 오타를 못 잡는다 */
    const matches = (html) => SEL.split(',').map((x) => x.trim()).some((sel) => {
      if (sel === '#prompt-textarea') return /id="prompt-textarea"/.test(html)
      if (sel === '[contenteditable="true"][role="textbox"]') {
        return /contenteditable="true"/.test(html) && /role="textbox"/.test(html)
      }
      return false
    })
    check('🔴 반례10 옛 DOM(fixture) 을 잡는다',
      matches('<div id="prompt-textarea" contenteditable="true"></div>'))
    check('🔴 반례10 새 DOM(fixture) 을 잡는다',
      matches('<div contenteditable="true" role="textbox" class="ProseMirror"></div>'))
    check('  반례10 관련 없는 입력칸은 잡지 않는다',
      !matches('<div contenteditable="true" aria-label="제목"></div>'))
  }

  // ── 반례 11 · 실패해도 탭을 남기지 않는다 · 진단이 살아 있다 ──
  {
    /**
     * 🔴 2026-09-27: 실패한 회차마다 `chatgpt.com/` 루트 탭이 쌓여 8개가 남았다.
     *    원고 회수는 예외가 나면 `page.close()` 앞에서 죽었고, probe 는 자기가 연 탭을
     *    아예 닫지 않았다. 그리고 실패는 전부 `connect_failed` 한 단어로 뭉개졌다.
     */
    const sessSrc = fs.readFileSync('scripts/lib/chatgpt-session.mjs', 'utf8')
    const heroSrc = fs.readFileSync('scripts/magazine-hero-runner.mjs', 'utf8')

    check('🔴 반례11 probe 가 자기가 연 탭만 닫는다',
      /openedPage = page/.test(sessSrc) && /await openedPage\?\.close\(\)/.test(sessSrc))
    check('🔴 반례11 원고 회수가 finally 에서 탭을 닫는다',
      /finally \{[\s\S]{0,240}await page\?\.close\(\)/.test(sessSrc))
    check('🔴 반례11 중간 page.close() 가 남아 있지 않다',
      !/^\s*await page\.close\(\)\s*$/m.test(sessSrc))
    check('🔴 반례11 hero 경로도 finally 에서 자기 탭을 닫는다',
      (heroSrc.match(/await page\?\.close\(\)\.catch/g) ?? []).length >= 2)
    check('🔴 반례11 전용 Chrome 자체는 닫지 않는다 (연결만 끊는다)', /연결만 끊는다/.test(sessSrc))

    check('🔴 반례11 회수 실패가 stage 를 싣는다', /reason: 'connect_failed',\n\s*stage,/.test(sessSrc))
    check('🔴 반례11 회수 실패가 원문 첫 줄을 싣는다', /errorDetail: String\(err\?\.message/.test(sessSrc))
    check('🔴 반례11 hero 실패도 stage 를 싣는다',
      /stage: 'webp'/.test(heroSrc) && /\$\{stage\}: \$\{err\?\.name/.test(heroSrc))

    /** 🔴 `Node.js v…` 만 남기던 문제 — 실제 문자열로 확인한다 */
    const AR = await import('./magazine-auto-register.mjs')
    const crash = [
      '/x/scripts/magazine-hero-runner.mjs:84',
      "    await page.waitForSelector('#prompt-textarea')",
      '          ^', '',
      'Error: page.waitForSelector: Timeout 60000ms exceeded.',
      '    at Object.<anonymous> (/x/y.mjs:1:1)', '',
      'Node.js v24.14.0',
    ].join('\n')
    const picked = AR.meaningfulLine(crash)
    check('🔴 반례11 크래시 출력에서 Node.js 꼬리를 고르지 않는다', !/^Node\.js v/.test(picked), picked)
    check('🔴 반례11 실제 오류 줄을 고른다', /Timeout 60000ms exceeded/.test(picked), picked)
    const marked = '머리말\n     ⛔ [composer] connect_failed — TimeoutError · 전송 0건\nNode.js v24.14.0'
    check('🔴 반례11 ⛔ 표식이 있으면 그 줄을 고른다',
      /\[composer\] connect_failed/.test(AR.meaningfulLine(marked)), AR.meaningfulLine(marked))
    check('  반례11 출력이 비어도 죽지 않는다', AR.meaningfulLine('') === '(출력 없음)')

    /**
     * 🔴 **실제 `fetchManuscript` 를 돌린다** (Codex 재검토 2026-09-27).
     *    앞판은 시험 안에서 만든 `runWithFailure` 를 검사했다 — 계약을 흉내 낸 함수라
     *    제품이 틀려도 초록이 떴다. 이제 가짜 browser/page 를 **실제 함수에 주입**한다.
     */
    const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-fetch-'))
    try {
      const briefPath = path.join(TMP, 'brief.md')
      fs.writeFileSync(briefPath, '# brief\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n')
      const outPath = path.join(TMP, 'draft.md')

      /** 기존 탭 — 이 탭은 **절대** 닫히면 안 된다 */
      const makeWorld = (throwAt) => {
        const existing = { closes: 0, url: () => 'https://chatgpt.com/', close: async () => { existing.closes += 1 } }
        const opened = []
        const world = { existing, opened, browserCloses: 0, killed: 0, setInputFilesCalls: 0 }
        const newPage = () => {
          const pg = {
            closes: 0,
            waits: 0,
            typed: '',
            async close() { pg.closes += 1 },
            async goto() {},
            /**
             * 🔴 **첨부 계약은 사라졌다** (2026-09-28 · P1).
             *    brief 는 본문에 들어간다. 그래서 이 가짜 page 에는 file input 도,
             *    업로드 chip 도 없다 — **제품이 그것을 찾으면 그대로 터진다.**
             *    `setInputFiles` 는 세어서 **0 인지 본다.**
             */
            async evaluate() { return '---\n본문\n[CTA]' },
            async evaluateHandle() {
              return {
                asElement: () => ({
                  async setInputFiles() { world.setInputFilesCalls += 1 },
                }),
              }
            },
            async waitForSelector() { if (throwAt === 'composer') throw new Error('page.waitForSelector: Timeout 60000ms exceeded.') },
            /**
             * 🔴 **composer 와 send 버튼은 다른 selector 다.** 하나로 뭉뚱그리면
             *    본문 작성 실패와 전송 실패를 구분하지 못한다 — 실제 DOM 과 다른
             *    fixture 는 제품이 맞아도 틀렸다고 말한다.
             */
            locator(sel) {
              const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
              const composer = {
                async click() {
                  if (isSend && throwAt === 'send') throw new Error('click: element is not visible')
                },
                /**
                 * 🔴 **넣은 글을 그대로 돌려준다** — 실제 composer 와 같다.
                 *    변이 케이스는 일부러 다르게 돌려준다.
                 */
                async innerText() {
                  /**
                   * 🔴 **제일 흔한 잘림은 "앞은 들어가고 뒤가 없는" 것**이다.
                   *    앞부분만 40자 남기면 시작 구분자조차 없어 다른 코드로 끝난다 —
                   *    그건 이 시험이 보려던 상황이 아니다.
                   */
                  if (throwAt === 'readback-truncated') {
                    const cut = pg.typed.indexOf('===== BRIEF 끝')
                    return cut > 0 ? pg.typed.slice(0, cut) : pg.typed
                  }
                  if (throwAt === 'readback-empty') return ''
                  if (throwAt === 'readback-dirty') return `앞 대화 잔여 ${'가'.repeat(400)}\n${pg.typed}`
                  return pg.typed
                },
                async setInputFiles() { world.setInputFilesCalls += 1 },
              }
              return {
                first: () => composer,
                async all() { return [composer] },
                ...composer,
              }
            },
            keyboard: {
              async insertText(t) { pg.typed += String(t ?? '') },
              async press() {},
            },
            async waitForTimeout() {},
            /** 🔴 이제 응답 완료 대기에만 쓰인다 (업로드 대기가 없어졌다) */
            async waitForFunction() {
              pg.waits += 1
              if (throwAt === 'await-response') throw new Error('waitForFunction: Timeout')
            },
          }
          opened.push(pg)
          return pg
        }
        world.browser = {
          contexts: () => [{ pages: () => [existing], newPage: async () => adaptPage(newPage()) }],
          async close() { world.browserCloses += 1 },
        }
        return world
      }

      /**
       * 🔴 **stage 가 셋에서 넷으로 바뀌었다** — `attach` 가 사라지고 `compose` 가 왔다.
       *    본문이 안 들어간 경우는 **보내기 전**이므로 전송 0건이어야 한다.
       */
      for (const at of ['composer', 'compose', 'send', 'await-response']) {
        const throwAt = at === 'compose' ? 'readback-truncated' : at
        const w = makeWorld(throwAt)
        const r = await SESSION2.fetchManuscript({ ...FAST_FETCH,
          briefPath, outPath, promptText: '시험', requiredMarkers: ['문장 하나'],
          timeoutMs: 200, connectTimeoutMs: 200,
          ensureTab: async () => ({ ok: true }),
          connect: async () => w.browser,
        })
        check(`🔴 반례11 [${at}] 실패로 끝난다`, r.ok === false, `${r.reason} · stage ${r.stage}`)
        check(`🔴 반례11 [${at}] stage 가 그 단계를 가리킨다`, r.stage === at, `${r.stage}`)
        check(`🔴 반례11 [${at}] 자기가 연 탭을 정확히 1회 닫는다`,
          w.opened.length === 1 && w.opened[0].closes === 1,
          `연 탭 ${w.opened.length}개 · close ${w.opened.map((x) => x.closes).join(',')}`)
        check(`🔴 반례11 [${at}] 기존 탭은 닫지 않는다`, w.existing.closes === 0, `close ${w.existing.closes}회`)
        check(`  반례11 [${at}] Chrome 종료 0회 (연결만 끊는다)`, w.killed === 0)
        /** 🔴 **어느 경로로 끝나든 파일은 0번 올린다** */
        check(`🔴 반례11 [${at}] setInputFiles 0회`, w.setInputFilesCalls === 0, `${w.setInputFilesCalls}회`)

        /** 🔴 최상위 출력까지 stage·원문이 남는가 — fetchSlug 가 버리면 여기서 깨진다 */
        const line = WEBUI.describeFetchFailure({
          reason: r.reason, stage: r.stage, errorName: r.errorName, errorDetail: r.errorDetail, sent: r.sent,
        })
        check(`🔴 반례11 [${at}] 최상위 한 줄에 stage 가 있다`, line.includes(`[${at}]`), line)
        if (at === 'composer' || at === 'send') {
          check(`🔴 반례11 [${at}] 최상위 한 줄에 실제 오류가 있다`,
            /Timeout 60000ms exceeded|not visible/.test(line), line)
        }
        if (at === 'compose') {
          check('🔴 반례11 [compose] 잘린 본문은 composer_truncated 다',
            r.reason === 'composer_truncated', String(r.reason))
          check('🔴 반례11 [compose] 사유에 "한 글자도 보내지 않았다" 가 있다',
            /한 글자도 보내지 않았다/.test(r.errorDetail ?? ''), String(r.errorDetail))
        }
        /**
         * 🔴 **전송 여부는 단계에 따라 다르다.** `await-response` 는 이미 보낸 뒤 터진 것이라
         *    `전송 1건` 이 사실이다. 그걸 0건으로 적으면 "보냈는데 안 보냈다" 는 거짓말이 된다.
         */
        const sentBefore = at === 'await-response'
        check(`🔴 반례11 [${at}] 전송 여부를 사실대로 적는다`,
          line.includes(sentBefore ? '전송 1건' : '전송 0건'), line)
      }

      /** 🔴 readback 이 다른 이유로 깨지는 경우도 **보내지 않는다** */
      for (const [mut, want] of [['readback-empty', 'composer_empty'], ['readback-dirty', 'composer_dirty']]) {
        const w = makeWorld(mut)
        const r = await SESSION2.fetchManuscript({ ...FAST_FETCH,
          briefPath, outPath, promptText: '시험', requiredMarkers: ['문장 하나'],
          timeoutMs: 200, connectTimeoutMs: 200,
          ensureTab: async () => ({ ok: true }),
          connect: async () => w.browser,
        })
        check(`🔴 반례11 [${mut}] ${want} 로 끝난다`, r.reason === want, `${r.reason}`)
        check(`🔴 반례11 [${mut}] 전송 0건`, r.sent === false, `sent=${r.sent}`)
        check(`  반례11 [${mut}] setInputFiles 0회`, w.setInputFilesCalls === 0, `${w.setInputFilesCalls}회`)
      }

      /** 🔴 **brief 본문이 실제로 메시지에 들어갔는가** — 넣은 척이 아니라 글자를 본다 */
      {
        const w = makeWorld(null)
        await SESSION2.fetchManuscript({ ...FAST_FETCH,
          briefPath, outPath, promptText: '시험', requiredMarkers: ['문장 하나'],
          timeoutMs: 200, connectTimeoutMs: 200,
          ensureTab: async () => ({ ok: true }),
          connect: async () => w.browser,
        })
        const typed = w.opened[0]?.typed ?? ''
        check('🔴 반례11 보낸 본문에 brief 전문이 있다', typed.includes('문장 하나'), `${typed.length}자`)
        check('🔴 반례11 보낸 본문에 시작·끝 구분자가 있다',
          typed.includes(SESSION2.BRIEF_BEGIN) && typed.includes(SESSION2.BRIEF_END), `${typed.length}자`)
        check('🔴 반례11 정상 경로도 setInputFiles 0회', w.setInputFilesCalls === 0, `${w.setInputFilesCalls}회`)
      }

      /** 🔴 정상 경로도 자기 탭을 닫는다 — 실패 경로만 닫으면 성공할 때마다 샌다 */
      const wOk = makeWorld(null)
      await SESSION2.fetchManuscript({ ...FAST_FETCH,
        briefPath, outPath, promptText: '시험', requiredMarkers: [],
        timeoutMs: 200, connectTimeoutMs: 200,
        ensureTab: async () => ({ ok: true }),
        connect: async () => wOk.browser,
      })
      check('🔴 반례11 [정상] 자기가 연 탭을 정확히 1회 닫는다',
        wOk.opened.length === 1 && wOk.opened[0].closes === 1,
        `close ${wOk.opened.map((x) => x.closes).join(',')}`)
      check('🔴 반례11 [정상] 기존 탭은 닫지 않는다', wOk.existing.closes === 0)

      /** 🔴 **fetchSlug 가 필드를 버리면 깨진다** — 보존 계약을 실제 소스로 확인한다 */
      const webuiSrc = fs.readFileSync('scripts/magazine-webui-runner.mjs', 'utf8')
      const slugBody = webuiSrc.slice(webuiSrc.indexOf('async function fetchSlug'), webuiSrc.indexOf('/** 저장된 원고를 기계 검사만 한다'))
      for (const f of ['stage', 'errorName', 'errorDetail']) {
        check(`🔴 반례11 fetchSlug 가 ${f} 를 보존한다`,
          new RegExp(`${f}: r\\.${f}`).test(slugBody), f)
      }
      /** 🔴 그리고 그 보존이 **실제로 한 줄에 나타나는지**까지 본다 (문자열 검사로 끝내지 않는다) */
      const dropped = WEBUI.describeFetchFailure({ reason: 'connect_failed', sent: false })
      check('  반례11 stage 가 없으면 한 줄에도 없다 (대조군)', !dropped.includes('['), dropped)
    } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
  }

  // ── 반례 13 · 재생성 실패 사유에 Node.js 스택 꼬리가 남지 않는다 (실제 경로) ──
  {
    /**
     * 🔴 **실제 `webuiRegenRunner` 를 탄다** (Codex 재검토 2026-09-27).
     *    앞판은 그 함수가 모듈 스코프 `run` 을 직접 써서 `deps.run` 을 우회했다 —
     *    그래서 한 번도 시험되지 않았고, 거기 남아 있던 `split('\n').pop()` 이
     *    자식 크래시의 `Node.js v…` 를 그대로 사유로 흘려보냈다.
     *    이제 주입된 run 을 타므로, 크래시 출력을 넣어 **최종 사유**까지 확인할 수 있다.
     */
    const AR2 = await import('./magazine-auto-register.mjs')
    const READY = await import('./magazine-auto-register-ready.mjs')

    /** 자식이 스택을 뱉고 죽은 출력 — 마지막 줄은 `Node.js v24.14.0` 이다 */
    const CRASH_STDERR = [
      '/x/scripts/magazine-webui-runner.mjs:660',
      "    await page.waitForSelector(COMPOSER_SELECTOR)",
      '          ^', '',
      'Error: page.waitForSelector: Timeout 60000ms exceeded.',
      '    at fetchManuscript (/x/scripts/lib/chatgpt-session.mjs:660:5)', '',
      'Node.js v24.14.0',
    ].join('\n')

    /** ① 실제 runner 를 그대로 호출한다 — 주입은 `runFn` 하나뿐이다 */
    let sawArgs = null
    const rr = AR2.webuiRegenRunner(
      { slug: 'x-slug', packetPath: '/tmp/x.json' },
      { runFn: (file, args) => { sawArgs = args; return { code: 1, stdout: '', stderr: CRASH_STDERR, json: null } } },
    )
    check('  반례13 실제 runner 가 --regen-packet 으로 부른다', (sawArgs ?? []).includes('--regen-packet'), (sawArgs ?? []).join(' '))
    check('🔴 반례13 runner 사유에 Node.js 꼬리가 없다', !/Node\.js v/.test(rr.why ?? ''), rr.why)
    check('🔴 반례13 runner 사유에 실제 오류가 있다', /Timeout 60000ms exceeded/.test(rr.why ?? ''), rr.why)

    /** ② 🔴 drive 의 실제 재생성 경로로 같은 출력을 흘린다 — 최종 BLOCKED 사유를 본다 */
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-regen-crash-'))
    const ledgerPath = path.join(T, 'q.json')
    try {
      const calls = []
      const deps = makeDeps({ qaFailsUntil: 99, ledgerPath, packetDir: path.join(T, 'packets'), calls })
      // 🔴 `regenRunner` 를 주입하지 않는다 — **실제 webuiRegenRunner** 가 돌아야 한다
      delete deps.regenRunner
      const base = deps.run
      deps.run = (f, a, o) => {
        const name = path.basename(String(f))
        if (name === 'magazine-webui-runner.mjs') {
          calls.push('WEBUI')
          return { code: 1, stdout: '', stderr: CRASH_STDERR, json: null }
        }
        if (name === 'magazine-qa.mjs') { calls.push(name); return { code: 1, stdout: 'QA FAIL', stderr: '', json: null } }
        return base(f, a, o)
      }
      const r = drive(SLUG, { write: true, pr: false, publishAt: '2027-04-01', alt: '시험 여성', allowOptional: true, autoLane: false }, deps)
      check('  반례13 실제 runner 가 불렸다 (죽은 시험 아님)', calls.includes('WEBUI'), calls.join('>'))
      check('🔴 반례13 drive 가 BLOCKED 로 끝난다', r.verdict === 'BLOCKED', r.verdict)
      const msg = (r.blockedBy ?? []).map((b) => b.message).join(' | ')
      check('🔴 반례13 최종 사유에 Node.js 꼬리가 없다', !/Node\.js v/.test(msg), msg.slice(0, 160))
      check('🔴 반례13 최종 사유에 실제 오류가 남는다', /Timeout 60000ms exceeded/.test(msg), msg.slice(0, 160))

      /** ③ 🔴 장부 사유까지 같은 문장이 간다 */
      const report = { blocked: [], done: [] }
      READY.processCandidates({
        write: true, wantPr: false, limit: 1, report,
        quarantinePath: ledgerPath,
        scanFn: () => ({
          source: 'fixture', pool: 1,
          eligible: [{ slug: SLUG, item: FIXTURE_QUEUE[0], progress: { hasBrief: true, hasReview: true, hasDraftMd: true } }],
          skipped: [], quarantined: [],
        }),
        driveFn: (sl, opts) => drive(sl, opts, deps),
      })
      const entry = readQuarantine(ledgerPath).store[SLUG]
      const reasons = (entry?.reasons ?? []).join(' | ')
      check('  반례13 장부에 사유가 남는다', reasons.length > 0, reasons.slice(0, 120))
      check('🔴 반례13 장부 사유에도 Node.js 꼬리가 없다', !/Node\.js v/.test(reasons), reasons.slice(0, 160))
      check('🔴 반례13 장부 사유에 실제 오류가 남는다', /Timeout 60000ms exceeded/.test(reasons), reasons.slice(0, 160))
    } finally {
      for (const sl of FIXTURE_SLUGS) {
        const f = `drafts/magazine/${sl}/article-draft.ts`
        try { fs.writeFileSync(f, spawnSyncTop('git', ['show', `HEAD:${f}`]) + '\n') } catch { /* 없으면 그만 */ }
      }
      fs.rmSync(T, { recursive: true, force: true })
    }
  }

  // ── 반례 12 · merge gate 는 PR head tree 를 본다 (재사용 hero 통과) ──
  {
    const GATE = await import('./lib/magazine-merge-gate.mjs')
    const HERO_PATH = 'public/magazine/checkup-items-50s/hero.webp'
    const base = {
      pr: {
        number: 580, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
        headRefOid: 'abf9b3c710b3d3cef827abdb7d57f5a948e3b360',
        headRefName: 'feat/magazine-auto-register-2026-09-27-010009',
        baseRefName: 'main',
      },
      expectedSha: 'abf9b3c710b3d3cef827abdb7d57f5a948e3b360',
      files: [
        'drafts/magazine/checkup-items-50s/article-draft.ts',
        'drafts/magazine/topic-queue.ts',
        'src/content/magazine/articles.ts',
      ],
      ciState: 'success',
      checks: [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }],
      registered: [{
        slug: 'checkup-items-50s', status: 'SCHEDULED',
        publishAt: '2026-09-28T10:30:00+09:00',
        heroImage: { src: '/magazine/checkup-items-50s/hero.webp' },
      }],
    }
    const codesOf = (v) => (v.blockedBy ?? []).map((b) => b.code)

    /** ① 🔴 PR #580 의 실제 상황 — hero 가 base·head 양쪽에 같은 blob 으로 있다 */
    const reuse = GATE.judgeAutoMerge({ ...base, headHasFile: (x) => x === HERO_PATH })
    check('🔴 반례12 재사용 hero(head 에 존재) 는 HERO_FILE_ABSENT 아니다',
      !codesOf(reuse).includes('HERO_FILE_ABSENT'), codesOf(reuse).join(',') || '차단 0')

    /** ② 새로 만든 hero — 변경 목록에도 head 에도 있다 */
    const fresh = GATE.judgeAutoMerge({
      ...base, files: [...base.files, HERO_PATH], headHasFile: (x) => x === HERO_PATH,
    })
    check('🔴 반례12 새 hero(변경+head) 도 통과한다',
      !codesOf(fresh).includes('HERO_FILE_ABSENT'), codesOf(fresh).join(',') || '차단 0')

    /** ③ 🔴 head tree 에 파일이 없으면 여전히 막는다 */
    check('🔴 반례12 head 에 그림이 없으면 HERO_FILE_ABSENT 로 막는다',
      codesOf(GATE.judgeAutoMerge({ ...base, headHasFile: () => false })).includes('HERO_FILE_ABSENT'))

    /** ④ 🔴 판정 수단이 없으면 옛 기준으로 되돌아간다 — 모르면 막는다 */
    check('🔴 반례12 headHasFile 이 없으면 변경 목록 기준으로 막는다',
      codesOf(GATE.judgeAutoMerge({ ...base })).includes('HERO_FILE_ABSENT'))

    /** ⑤ heroImage 자체가 없으면 그대로 HERO_MISSING */
    check('  반례12 heroImage 가 아예 없으면 HERO_MISSING',
      codesOf(GATE.judgeAutoMerge({
        ...base, headHasFile: () => true,
        registered: [{ ...base.registered[0], heroImage: null }],
      })).includes('HERO_MISSING'))
  }
}

// ─────────────────────────────────────────────────────────
// ⑮ 🔴 2026-09-28 공급 0건 — 대상 계약 하나 (selected + reusable)
// ─────────────────────────────────────────────────────────
console.log('\n⑮ 대상 계약 — selected + reusable')
{
  /**
   * 🔴 2026-09-28: `selected 0 · reusable 17` 인데 회수·등록 후보가 **둘 다 0** 이었다.
   *    `reusable` 을 만들어 두고 소비자에 **연결하지 않았기** 때문이다.
   *    만들어만 두면 없는 것과 같다 — 실제 숫자로 고정한다.
   */
  const RT = await import('./lib/magazine-run-targets.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-targets-'))
  const D = path.join(T, 'drafts', 'magazine')
  const DATE = '2026-09-28'
  const mk = (slug, { brief = 1, review = 1, draft = 0, article = 0 } = {}) => {
    fs.mkdirSync(path.join(D, slug), { recursive: true })
    if (brief) fs.writeFileSync(path.join(D, slug, 'brief.md'), 'b')
    if (review) fs.writeFileSync(path.join(D, slug, 'review.ts'), 'r')
    if (draft) fs.writeFileSync(path.join(D, slug, 'draft.md'), 'd')
    if (article) fs.writeFileSync(path.join(D, slug, 'article-draft.ts'), 'a')
    return { slug }
  }
  const writeRun = (selected, reusable) => {
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', inventoryDays: 0, selected, reusable }))
  }
  try {
    // ── selected 0 / reusable 17 — 실측과 같은 구성 ──
    const reusable = []
    for (let i = 1; i <= 5; i++) reusable.push(mk(`need-${i}`))                          // NEEDS_DRAFT 5
    for (let i = 1; i <= 2; i++) reusable.push(mk(`conv-${i}`, { draft: 1 }))             // NEEDS_CONVERT 2
    for (let i = 1; i <= 10; i++) reusable.push(mk(`ready-${i}`, { draft: 1, article: 1 })) // READY 10
    writeRun([], reusable)

    const r = RT.readRunTargets({ draftsDir: D, date: DATE })
    check('🔴 ⑮ selected 0 · reusable 17 → 대상 17건', r.ok && r.targets.length === 17,
      `${r.targets.length}건 · ${r.why ?? ''}`)
    const dist = r.targets.reduce((a, t) => { a[t.material.stage] = (a[t.material.stage] ?? 0) + 1; return a }, {})
    check('  ⑮ 단계 분포가 맞다', dist.NEEDS_DRAFT === 5 && dist.NEEDS_CONVERT === 2 && dist.READY === 10,
      JSON.stringify(dist))
    check('🔴 ⑮ NEEDS_DRAFT 5 → 회수 대상 정확히 5', RT.fetchTargets(r.targets).length === 5,
      `${RT.fetchTargets(r.targets).length}건`)
    check('🔴 ⑮ NEEDS_CONVERT 2 + READY 10 → 등록 대상 정확히 12',
      RT.registerTargets(r.targets).length === 12, `${RT.registerTargets(r.targets).length}건`)

    // ── review 누락 1건 → 회수·등록 모두 0 (ChatGPT 호출 0) ──
    const nr = mk('no-review', { review: 0 })
    writeRun([], [nr])
    const r2 = RT.readRunTargets({ draftsDir: D, date: DATE })
    check('🔴 ⑮ review 누락은 NEEDS_BRIEF 다', r2.targets[0]?.material.stage === 'NEEDS_BRIEF',
      r2.targets[0]?.material.stage)
    check('🔴 ⑮ review 누락 → 회수 0 · 등록 0 (ChatGPT 호출 0)',
      RT.fetchTargets(r2.targets).length === 0 && RT.registerTargets(r2.targets).length === 0,
      `회수 ${RT.fetchTargets(r2.targets).length} · 등록 ${RT.registerTargets(r2.targets).length}`)

    // ── selected/reusable 중복 slug → 한 번만 ──
    writeRun([{ slug: 'ready-1' }], [{ slug: 'ready-1' }, { slug: 'ready-2' }])
    const r3 = RT.readRunTargets({ draftsDir: D, date: DATE })
    check('🔴 ⑮ 중복 slug 는 한 번만 처리한다', r3.targets.length === 2,
      r3.targets.map((t) => `${t.slug}:${t.origin}`).join(', '))
    check('  ⑮ 중복이면 selected 를 먼저 센다',
      r3.targets.find((t) => t.slug === 'ready-1')?.origin === 'selected')

    /**
     * 🔴 **소스 문자열 검사는 증거가 아니다** (Codex 재검토 2026-09-28).
     *    정규식은 코드를 조금만 바꿔도 통과하거나, 멀쩡한데 깨진다.
     *    **실제 production 함수**를 fixture 로 돌려 숫자를 본다.
     */
    writeRun([], reusable)
    const WEBUI = await import('./magazine-webui-runner.mjs')
    const READY = await import('./magazine-auto-register-ready.mjs')

    /** 🔴 실제 `fetchBatch` — dry-run 이라 한 글자도 보내지 않는다 */
    const batch = await WEBUI.fetchBatch({ date: DATE, dryRun: true, limit: 0, draftsDir: D })
    const plannedFetch = (batch.planned ?? []).filter((x) => x.action === 'fetch')
    check('🔴 ⑮ 실제 fetchBatch — planned fetch 정확히 5',
      plannedFetch.length === 5, `${plannedFetch.length}건 · ${(batch.planned ?? []).length}개 계획`)
    check('  ⑮ 실제 fetchBatch — 전송 0건 (dry-run)', (batch.sentTotal ?? 0) === 0, `${batch.sentTotal}`)
    check('  ⑮ 실제 fetchBatch — 고른 것이 전부 NEEDS_DRAFT 다',
      plannedFetch.every((x) => x.stage === 'NEEDS_DRAFT'),
      plannedFetch.map((x) => `${x.slug}:${x.stage}`).join(', '))

    /** 🔴 실제 `scan({ runDate })` — pool 이 등록 대상 수와 같아야 한다 */
    const scanned = READY.scan({ runDate: DATE, store: {}, draftsDir: D })
    check('🔴 ⑮ 실제 scan({runDate}) — pool 정확히 12', scanned.pool === 12, `pool ${scanned.pool}`)

    /** 🔴 review 누락 → 실제 fetchBatch 가 0건 (ChatGPT 호출 0) */
    writeRun([], [nr])
    const batch2 = await WEBUI.fetchBatch({ date: DATE, dryRun: true, limit: 0, draftsDir: D })
    const plannedFetch2 = (batch2.planned ?? []).filter((x) => x.action === 'fetch')
    check('🔴 ⑮ 실제 fetchBatch — review 누락이면 fetch 0',
      plannedFetch2.length === 0, `${plannedFetch2.length}건`)
    const scanned2 = READY.scan({ runDate: DATE, store: {}, draftsDir: D })
    check('🔴 ⑮ 실제 scan — review 누락이면 pool 0', scanned2.pool === 0, `pool ${scanned2.pool}`)

    /** 🔴 중복 slug → 실제 경로에서도 한 번만 */
    writeRun([{ slug: 'ready-1' }], [{ slug: 'ready-1' }, { slug: 'ready-2' }])
    const scanned3 = READY.scan({ runDate: DATE, store: {}, draftsDir: D })
    check('🔴 ⑮ 실제 scan — 중복 slug 는 한 번만', scanned3.pool === 2, `pool ${scanned3.pool}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n⑯ 전송 여부를 사실대로 넘긴다 — sent 3값 · 재전송 0')
{
  /**
   * 🔴 **사람용 출력을 정규식으로 긁지 않는다** (2026-09-28 · Codex P0-2).
   *    앞판은 자식 stdout 에서 `/전송\s*1건/` 을 찾았다. 문구가 바뀌면 `sent` 가
   *    뒤집히고 **같은 brief 를 다시 보낸다.**
   *
   * 🔴 그리고 **분류만 맞히는 시험은 죽은 시험이다.** 분류가 맞아도 `drive` 가
   *    그것을 안 읽으면 재전송은 그대로 일어난다. 여기서는 **실제 `drive()`** 를 돌려
   *    runner 호출 수와 장부 숫자를 본다.
   */
  const FR = await import('./lib/magazine-fetch-result.mjs')
  const AR = await import('./magazine-auto-register.mjs')
  const FK = await import('./lib/magazine-failure-kind.mjs')

  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-sent-'))
  try {
    /** ① 보냈는데 응답을 못 받았다 — 자식은 사람글에 "전송" 이라는 말조차 안 쓴다 */
    const r1 = AR.webuiRegenRunner({ slug: 'a-slug', packetPath: '/tmp/p.json' }, {
      resultDir: T,
      runFn: (_file, args) => {
        const rp = args[args.indexOf('--result-json') + 1]
        FR.writeFetchResults(rp, {
          mode: 'fetch-one', sentTotal: 1,
          results: [{ slug: 'a-slug', status: 'failed', reason: 'response_timeout',
            stage: 'await-response', sent: true, errorName: 'TimeoutError', errorDetail: '60000ms' }],
        })
        return { code: 1, stdout: '  ⛔ 실패했다', stderr: '', json: null }
      },
    })
    check('🔴 ⑯ 출력에 "전송" 이 없어도 sent 를 읽는다', r1.sent === true, `sent=${r1.sent} source=${r1.resultSource}`)
    check('  ⑯ reason·stage·errorDetail 을 그대로 올린다',
      r1.reason === 'response_timeout' && r1.stage === 'await-response' && r1.errorDetail === '60000ms',
      `${r1.reason}·${r1.stage}·${r1.errorDetail}`)
    const k1 = FK.classifyFailure({ code: r1.reason, stage: r1.stage, message: r1.errorDetail, sent: r1.sent })
    check('🔴 ⑯ 전송 뒤 timeout 은 DELIVERY_UNCERTAIN 이다', k1.kind === 'DELIVERY_UNCERTAIN', k1.kind)
    check('🔴 ⑯ 그래서 횟수를 소비하지 않는다', FK.consumesAttempt(k1.kind) === false, String(FK.consumesAttempt(k1.kind)))

    /** ② 🔴 **거짓 성공 금지** — 종료 코드 0 인데 결과 행이 없으면 성공이 아니다 */
    const r0 = AR.webuiRegenRunner({ slug: 'z-slug', packetPath: '/tmp/p.json' }, {
      resultDir: T, runFn: () => ({ code: 0, stdout: '끝', stderr: '', json: null }),
    })
    check('🔴 ⑯ exit 0 + 결과 행 없음 = 성공이 아니다', r0.ok === false, `ok=${r0.ok}`)
    check('🔴 ⑯ 그때 sent 는 null (모름)', r0.sent === null, String(r0.sent))
    const k0 = FK.classifyFailure({ code: r0.reason, stage: r0.stage, message: r0.errorDetail, sent: r0.sent })
    check('🔴 ⑯ 그래서 DELIVERY_UNCERTAIN 이다', k0.kind === 'DELIVERY_UNCERTAIN', k0.kind)

    /** ③ exit 0 인데 행이 ok 가 아니면 그 사실을 그대로 올린다 */
    const rNotOk = AR.webuiRegenRunner({ slug: 'y-slug', packetPath: '/tmp/p.json' }, {
      resultDir: T,
      runFn: (_file, args) => {
        const rp = args[args.indexOf('--result-json') + 1]
        FR.writeFetchResults(rp, { mode: 'fetch-one', sentTotal: 0,
          results: [{ slug: 'y-slug', status: 'skipped', reason: 'draft_exists', stage: null, sent: false }] })
        return { code: 0, stdout: '', stderr: '', json: null }
      },
    })
    check('🔴 ⑯ exit 0 + status≠ok 도 성공이 아니다', rNotOk.ok === false, `ok=${rNotOk.ok} reason=${rNotOk.reason}`)
    check('  ⑯ 그 행의 sent(false)를 그대로 올린다', rNotOk.sent === false, String(rNotOk.sent))

    /** ④ 실제로 안 보낸 인프라 실패는 INFRA 다 — 모름과 섞이지 않는다 */
    const r3 = AR.webuiRegenRunner({ slug: 'c-slug', packetPath: '/tmp/p.json' }, {
      resultDir: T,
      runFn: (_file, args) => {
        const rp = args[args.indexOf('--result-json') + 1]
        FR.writeFetchResults(rp, { mode: 'fetch-one', sentTotal: 0,
          results: [{ slug: 'c-slug', status: 'failed', reason: 'connect_failed',
            stage: 'connect', sent: false, errorName: 'TimeoutError', errorDetail: 'cdp' }] })
        return { code: 1, stdout: '', stderr: '', json: null }
      },
    })
    const k3 = FK.classifyFailure({ code: r3.reason, stage: r3.stage, message: r3.errorDetail, sent: r3.sent })
    check('🔴 ⑯ 안 보낸 인프라 실패는 INFRA 다', k3.kind === 'INFRA' && r3.sent === false, `${k3.kind} sent=${r3.sent}`)
    check('🔴 ⑯ 임시 결과 파일을 치운다',
      fs.readdirSync(T).filter((f) => f.startsWith('regen-result-')).length === 0,
      fs.readdirSync(T).join(', ') || '(비어 있다)')

    /**
     * ⑤ 🔴 **실제 `drive()` 로 확인한다** — 첫 회수가 `sent=true` 로 끝난 글은
     *    regenRunner 를 **한 번도** 부르지 않고, regenCalls·attempts 도 0이어야 한다.
     */
    const ledgerPath = path.join(T, 'q.json')
    const calls = []
    const deps = makeDeps({ qaFailsUntil: 99, ledgerPath, packetDir: path.join(T, 'packets'), calls })
    // 🔴 실제 재생성 경로를 쓴다. 불리면 세어서 0이 아님이 드러난다.
    let runnerCalls = 0
    deps.regenRunner = () => { runnerCalls += 1; return { ok: true, sent: true } }
    // 🔴 첫 회수 결과를 **주입이 아니라 파일로** 넣는다 — 읽는 경로까지 함께 본다
    const DATE = FR.todayKst()
    const resultPath = path.join(T, `${DATE}.json`)
    FR.writeFetchResults(resultPath, {
      date: DATE, runId: null, mode: 'fetch-run', sentTotal: 1,
      results: [{ slug: SLUG, status: 'failed', reason: 'response_timeout',
        stage: 'await-response', sent: true, errorName: 'TimeoutError', errorDetail: '60000ms' }],
    })
    deps.fetchResultPath = resultPath
    deps.runDate = DATE
    const rd = drive(SLUG, { write: true, pr: false, publishAt: '2027-04-01', alt: '시험 여성', allowOptional: true, autoLane: false }, deps)
    check('🔴 ⑯ 실제 drive — 첫 회수가 보낸 글이면 regenRunner 호출 0', runnerCalls === 0, `${runnerCalls}회`)
    check('🔴 ⑯ 실제 drive — regenCalls 0', (rd.regenCalls ?? 0) === 0, String(rd.regenCalls))
    const msg = (rd.blockedBy ?? []).map((b) => b.message).join(' | ')
    check('🔴 ⑯ 실제 drive — 사유가 DELIVERY_UNCERTAIN 이다', /DELIVERY_UNCERTAIN/.test(msg), msg.slice(0, 140))
    /**
     * 🔴 **"기록이 없다" 는 증거가 약하다.** 실제 등록 루프를 태워 장부에 **쓰게** 한 뒤,
     *    그 행이 내용 실패로 세어지지 않는지 본다.
     */
    const READY16 = await import('./magazine-auto-register-ready.mjs')
    READY16.processCandidates({
      write: true, wantPr: false, limit: 1, report: { blocked: [], done: [] },
      quarantinePath: ledgerPath,
      scanFn: () => ({ source: 'fixture', pool: 1,
        eligible: [{ slug: SLUG, item: FIXTURE_QUEUE[0], progress: { hasBrief: true, hasReview: true, hasDraftMd: true } }],
        skipped: [], quarantined: [] }),
      driveFn: (sl, o) => drive(sl, o, deps),
    })
    const entry = readQuarantine(ledgerPath).store[SLUG]
    check('🔴 ⑯ 실제 장부 — 행이 실제로 쓰였다', !!entry, JSON.stringify(entry ?? null))
    check('🔴 ⑯ 실제 장부 — 내용 실패로 세지 않는다 (attempts 0)',
      entry?.attempts === 0, `attempts ${entry?.attempts}`)
    check('🔴 ⑯ 실제 장부 — 종류가 DELIVERY_UNCERTAIN 이다',
      entry?.kind === 'DELIVERY_UNCERTAIN', String(entry?.kind))

    /**
     * ⑥ 🔴 **2026-09-28 실측 반례** — 전용 Chrome 이 새 탭을 거부했다.
     *    `Target.createTarget: Failed to open a new tab` (8회 연속).
     *    사람이 그 브라우저를 쓰고 있으면 실제로 일어난다.
     *    이것은 **원고 결함이 아니다.** 내용 실패로 세면 멀쩡한 글이 격리된다.
     */
    const kTab = FK.classifyFailure({
      code: 'connect_failed', stage: 'open-tab',
      message: 'browserContext.newPage: Protocol error (Target.createTarget): Failed to open a new tab',
      sent: false,
    })
    check('🔴 ⑯ 새 탭 거부는 INFRA 다 (실측 2026-09-28)', kTab.kind === 'INFRA', kTab.kind)
    check('🔴 ⑯ 그래서 내용 재시도 횟수를 쓰지 않는다', FK.consumesAttempt(kTab.kind) === false, String(FK.consumesAttempt(kTab.kind)))

    /** ⑦ 🔴 죽은 게이트가 아니다 — 첫 회수 기록이 없으면 **재생성이 실제로 돈다** */
    const calls2 = []
    const deps2 = makeDeps({ qaFailsUntil: 99, ledgerPath: path.join(T, 'q2.json'), packetDir: path.join(T, 'p2'), calls: calls2 })
    let runnerCalls2 = 0
    deps2.regenRunner = () => { runnerCalls2 += 1; return { ok: true, sent: true } }
    deps2.fetchResultPath = path.join(T, 'none.json')
    deps2.runDate = DATE
    drive(SLUG, { write: true, pr: false, publishAt: '2027-04-01', alt: '시험 여성', allowOptional: true, autoLane: false }, deps2)
    check('🔴 ⑯ 기록이 없으면 재생성이 실제로 돈다 (죽은 게이트 아님)', runnerCalls2 > 0, `${runnerCalls2}회`)

    /**
     * ⑧ 🔴 **재생성이 전송 경계에서 HOLD 로 멈추면** (2026-09-28 · 재생성 중복 전송)
     *    이번 실행의 `sent:false` 를 그 글의 전송 사실로 올리지 않는다. 실제 drive → 실제 ready 가
     *    장부에 **앞선 모름(null)** 을 그대로 적고, 횟수를 하나도 쓰지 않아야 한다.
     */
    const QN16 = await import('./lib/magazine-quarantine.mjs')
    const L3 = path.join(T, 'q3.json')
    // 🔴 앞선 전송 사실(모름)이 이미 적혀 있다 — HOLD 뒤에도 그대로여야 한다 (㊸: HOLD 는 장부를 쓰지 않는다)
    const seeded3 = { delivery: { sent: null, messageFingerprint: 'sha256:earlier-attempt', kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: DATE, reservationId: 'r0' } }
    saveQuarantine({ [SLUG]: seeded3 }, L3)
    const deps3 = makeDeps({ qaFailsUntil: 99, ledgerPath: L3, packetDir: path.join(T, 'p3'), calls: [] })
    deps3.regenRunner = () => ({ ok: false, sent: false, reason: QN16.DELIVERY_HOLD_REASON, stage: 'gate',
      prior: { sent: null, kind: 'DELIVERY_UNCERTAIN' }, why: '이미 보낸 글이다' })
    deps3.fetchResultPath = path.join(T, 'none3.json')
    deps3.runDate = DATE
    READY16.processCandidates({
      write: true, wantPr: false, limit: 1, report: { blocked: [], done: [] },
      quarantinePath: L3,
      scanFn: () => ({ source: 'fixture', pool: 1,
        eligible: [{ slug: SLUG, item: FIXTURE_QUEUE[0], progress: { hasBrief: true, hasReview: true, hasDraftMd: true } }],
        skipped: [], quarantined: [] }),
      driveFn: (sl, o) => drive(sl, o, deps3),
    })
    const e3 = readQuarantine(L3).store[SLUG] ?? {}
    check('🔴 ⑯ HOLD 뒤 장부는 앞선 전송 사실(모름) 그대로 — "안 보냄" 으로 덮지 않는다 · 행 불변',
      JSON.stringify(e3) === JSON.stringify(seeded3) && e3.sent !== false, JSON.stringify({ sent: e3.sent, kind: e3.kind, delivery: e3.delivery?.sent }))
    check('🔴 ⑯ HOLD 는 attempts·regenCalls 를 쓰지 않는다',
      (e3.attempts ?? 0) === 0 && (e3.regenCalls ?? 0) === 0, `attempts ${e3.attempts} · regen ${e3.regenCalls}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n⑰ 긴 brief 를 본문으로 보낸다 — 첨부 없음')
{
  /**
   * 🔴 **실제 최대 길이에서 돌린다** (2026-09-28 · Codex P1).
   *    2026-09-28 기준 실제 brief 최대는 `checkup-items-50s` 의 **11,694 bytes** 다.
   *    짧은 fixture 로만 시험하면 "긴 글이 잘린다" 는 바로 그 결함을 못 본다 —
   *    가짜가 실제보다 약하면 시험이 결함을 덮는다.
   */
  const SESSION3 = await import('./lib/chatgpt-session.mjs')
  const WEBUI3 = await import('./magazine-webui-runner.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-long-'))
  try {
    const REAL_MAX = 11694
    const marker = '이 문장은 반드시 그대로 들어간다'
    const makeBrief = (bytes) => {
      const head = `# brief\n\n## 반드시 그대로 넣을 문장\n1. ${marker}\n\n## 본문\n`
      const tailMark = '\n<<끝표지>>\n'
      const fill = '가'.repeat(Math.max(0, bytes - Buffer.byteLength(head + tailMark, 'utf8')) / 3 | 0)
      return head + fill + tailMark
    }

    const makeWorld = () => {
      const opened = []
      const world = { opened, setInputFilesCalls: 0 }
      const newPage = () => {
        const pg = {
          typed: '', closes: 0,
          async close() { pg.closes += 1 },
          async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
          async waitForFunction() {},
          async evaluate() { return '---\n본문\n[CTA]' },
          async evaluateHandle() {
            return { asElement: () => ({ async setInputFiles() { world.setInputFilesCalls += 1 } }) }
          },
          locator() {
            const l = {
              async click() {}, async innerText() { return pg.typed },
              async setInputFiles() { world.setInputFilesCalls += 1 },
            }
            return { first: () => l, async all() { return [l] }, ...l }
          },
          keyboard: { async insertText(t) { pg.typed += String(t ?? '') }, async press() {} },
        }
        opened.push(pg)
        return pg
      }
      world.browser = {
        contexts: () => [{ pages: () => [], newPage: async () => adaptPage(newPage()) }],
        async close() {},
      }
      return world
    }

    for (const [label, bytes] of [['실제 최대', REAL_MAX], ['경계(2배)', REAL_MAX * 2]]) {
      const briefPath = path.join(T, `brief-${bytes}.md`)
      fs.writeFileSync(briefPath, makeBrief(bytes))
      const real = fs.statSync(briefPath).size
      const w = makeWorld()
      const r = await SESSION3.fetchManuscript({ ...FAST_FETCH,
        briefPath, outPath: path.join(T, `out-${bytes}.md`),
        promptText: '시험', requiredMarkers: [marker],
        timeoutMs: 200, connectTimeoutMs: 200,
        ensureTab: async () => ({ ok: true }),
        connect: async () => w.browser,
      })
      const typed = w.opened[0]?.typed ?? ''
      check(`🔴 ⑰ [${label}] ${real}B brief 가 전송까지 간다`, r.sent === true, `sent=${r.sent} reason=${r.reason ?? '-'}`)
      check(`🔴 ⑰ [${label}] 지정 문장이 본문에 있다`, typed.includes(marker), `${typed.length}자`)
      check(`🔴 ⑰ [${label}] 끝표지까지 들어갔다 (안 잘렸다)`, typed.includes('<<끝표지>>'), `${typed.length}자`)
      check(`🔴 ⑰ [${label}] setInputFiles 0회`, w.setInputFilesCalls === 0, `${w.setInputFilesCalls}회`)
    }

    /** 🔴 실제 운영 brief 그대로도 본다 — 있으면 */
    const REAL = '/Users/yanadoo/Documents/soransoran-magazine-runtime/drafts/magazine/checkup-items-50s/brief.md'
    if (fs.existsSync(REAL)) {
      const w = makeWorld()
      const briefText = fs.readFileSync(REAL, 'utf8')
      const msg = SESSION3.buildManuscriptMessage({ promptText: '시험', briefText })
      const rb = SESSION3.judgeComposerReadback({ expected: msg, actual: msg, markers: [] })
      check('🔴 ⑰ 실제 운영 brief 가 readback 을 통과한다', rb.ok === true, `${rb.code ?? ''} ${rb.why ?? ''} ${msg.length}자`)
      void w
    } else {
      check('  ⑰ 실제 운영 brief 없음 — 건너뜀', true, REAL)
    }

    void WEBUI3
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n⑱ producer 가 기존 재료를 버리지 않는다')
{
  /**
   * 🔴 **2026-09-28 공급 0건의 시작점이 여기였다.**
   *    draft 폴더가 있으면 `skipped` 로 버렸다 — 그 폴더 안에 brief·review·draft 가
   *    다 들어 있는데도. 25건 중 대부분이 이 사유로 빠져 `selected 0 · 재고 0` 이 됐고,
   *    producer 는 "후보가 없다" 고 끝냈다. **만들 것이 없는 것과 내보낼 것이 없는 것은 다르다.**
   *
   *    실제 `selectItems` 와 실제 `runProducerFlow` 를 돌린다.
   */
  const PLAN = await import('./magazine-producer-plan.mjs')
  const FLOW = await import('./lib/magazine-producer-flow.mjs')

  const queue = Array.from({ length: 6 }, (_, i) => ({
    day: i + 1, slug: `q-${i + 1}`, title: `제목 ${i + 1}`, category: '건강',
    riskLevel: 'LOW', keywords: ['갱년기'],
    // 🔴 프로필이 있어야 자동 레인을 탄다 — 없으면 PROFILE_UNRESOLVED 로 빠진다
    validationProfile: 'STANDARD',
  }))
  /** 앞 3건은 이미 폴더가 있다 — 재료가 있다는 뜻이다 */
  const have = new Set(['q-1', 'q-2', 'q-3'])

  const sel = PLAN.selectItems({
    queue, articles: [], today: '2026-09-28', produceCount: 5,
    draftExists: (slug) => have.has(slug),
  })
  check('🔴 ⑱ 폴더가 있는 3건은 reusable 이다', sel.reusable.length === 3,
    `reusable ${sel.reusable.length} · selected ${sel.selected.length}`)
  check('🔴 ⑱ reusable 이 selected 로 새지 않는다',
    sel.selected.every((x) => !have.has(x.slug)), sel.selected.map((x) => x.slug).join(','))
  check('  ⑱ 나머지는 새로 만든다', sel.selected.length === 3, `${sel.selected.length}건`)

  /** 🔴 전부 폴더가 있으면 selected 0 이지만 **일이 없는 것이 아니다** */
  const all = PLAN.selectItems({
    queue, articles: [], today: '2026-09-28', produceCount: 5,
    draftExists: () => true,
  })
  check('🔴 ⑱ 전부 있으면 selected 0 · reusable 6', all.selected.length === 0 && all.reusable.length === 6,
    `selected ${all.selected.length} · reusable ${all.reusable.length}`)

  /**
   * 🔴 **그 상태에서 brief 를 부르면 안 된다.** 만들 것이 없는데 ChatGPT 를 부르는 것이다.
   *    실제 flow 를 돌려 brief 단계가 실제로 안 불리는지 본다.
   */
  const calls = []
  const flow = await FLOW.runProducerFlow({ deps: {
    log: () => {},
    readSupply: () => ({ selected: 0, reusable: 6, queue: 6 }),
    // 전제 검사는 이 시험의 대상이 아니다 — 통과시키고 brief 호출 여부만 본다
    checkTools: () => ({ ok: true }),
    checkGit: () => ({ ok: true }),
    checkOutstanding: () => ({ ok: true, message: '없음' }),
    runPlan: () => { calls.push('plan'); return { spawnError: null, status: 0 } },
    runBrief: () => { calls.push('brief'); return { spawnError: null, status: 0 } },
    runFetch: () => { calls.push('fetch'); return { spawnError: null, status: 0 } },
    notify: () => ({ ok: true }),
  } })
  check('🔴 ⑱ 선정 0 · 재사용 6 이면 brief 를 부르지 않는다', !calls.includes('brief'), calls.join('>'))
  check('🔴 ⑱ 그래도 실패로 끝나지 않는다', flow.code === 0, `code ${flow.code} · ${flow.verdict}`)

  /** 🔴 반대로 선정이 있으면 brief 를 **반드시** 부른다 — 죽은 게이트가 아니다 */
  const calls2 = []
  await FLOW.runProducerFlow({ deps: {
    log: () => {},
    readSupply: () => ({ selected: 3, reusable: 0, queue: 6 }),
    // 전제 검사는 이 시험의 대상이 아니다 — 통과시키고 brief 호출 여부만 본다
    checkTools: () => ({ ok: true }),
    checkGit: () => ({ ok: true }),
    checkOutstanding: () => ({ ok: true, message: '없음' }),
    runPlan: () => { calls2.push('plan'); return { spawnError: null, status: 0 } },
    runBrief: () => { calls2.push('brief'); return { spawnError: null, status: 0 } },
    runFetch: () => { calls2.push('fetch'); return { spawnError: null, status: 0 } },
    notify: () => ({ ok: true }),
  } })
  check('🔴 ⑱ 선정이 있으면 brief 를 부른다', calls2.includes('brief'), calls2.join('>'))
}

console.log('\n⑲ 오탐을 내용 결함으로 세지 않는다')
{
  /**
   * 🔴 **규칙이 틀린 것과 원고가 틀린 것은 다르다** (2026-09-28 · Codex P0).
   *    "보장하지 않습니다" 는 보장한다는 말이 **아니다.** "이 글은 수익률을 다루지 않습니다"
   *    도 수익률 주장이 **아니다.** 이런 문장을 막으면 멀쩡한 원고가 격리되고,
   *    공급은 규칙 때문에 마른다. 실제 QA 함수를 돌려 확인한다.
   */
  const QA = await import('./lib/magazine-profile-qa.mjs')
  const FB = await import('./lib/magazine-forbidden.mjs')

  const body = (t) => `# 제목\n\n${t}\n`
  const fin = (t) => QA.runProfileQA({ profile: 'FINANCIAL', title: '노후 준비', bodyText: t })
  const codes = (r) => (r.failures ?? r.reasons ?? []).map((f) => f.code)

  /** ① 🔴 부정문은 통과해야 한다 — 절 단위로 본다 */
  for (const s of [
    '이 상품이 수익을 보장하지 않습니다.',
    '원금을 보장하지는 않으며, 손실이 날 수 있습니다.',
    '누구도 수익을 보장할 수 없습니다.',
  ]) {
    const r = fin(body(`${s} 조건에 따라 다릅니다. 투자 판단은 본인 책임입니다.`))
    check(`🔴 ⑲ 부정문이 보장 주장으로 걸리지 않는다 — "${s.slice(0, 16)}…"`,
      !codes(r).includes('FIN_RETURN_GUARANTEE'), codes(r).join(',') || '없음')
  }

  /** ② 🔴 진짜 보장 주장은 **반드시** 걸린다 — 죽은 게이트가 아니다 */
  for (const s of ['이 상품은 원금을 보장합니다.', '무조건 수익이 납니다.']) {
    const r = fin(body(`${s} 조건에 따라 다릅니다.`))
    check(`🔴 ⑲ 진짜 보장 주장은 걸린다 — "${s.slice(0, 14)}…"`,
      codes(r).includes('FIN_RETURN_GUARANTEE'), codes(r).join(',') || '없음')
  }

  /** ③ 🔴 "~는 다루지 않습니다" 는 주장이 아니다 */
  for (const s of ['이 글은 수익률을 다루지 않습니다.', '특정 종목은 언급하지 않습니다.']) {
    const at = s.indexOf(s.includes('수익률') ? '수익률' : '특정 종목')
    const pat = s.includes('수익률') ? '수익률' : '특정 종목'
    check(`🔴 ⑲ 제외 문구는 주장이 아니다 — "${s.slice(0, 14)}…"`,
      FB.isExclusionNotice(s, at, pat) === true, String(FB.isExclusionNotice(s, at, pat)))
  }

  /** ④ 🔴 **수치가 붙으면 제외 문구가 아니다** — 숫자를 말하면서 "안 다룬다" 는 없다 */
  const numeric = '연 12% 수익률은 다루지 않습니다.'
  check('🔴 ⑲ 수치가 붙으면 제외 예외를 주지 않는다',
    FB.isExclusionNotice(numeric, numeric.indexOf('수익률'), '수익률') === false,
    String(FB.isExclusionNotice(numeric, numeric.indexOf('수익률'), '수익률')))
}

console.log('\n⑳ 통합 — producer 선정 0 · 재사용 있음에서 끝까지 간다')
{
  /**
   * 🔴 **2026-09-28 회차를 그대로 재현한다.**
   *    그날은 `selected 0 · reusable 17` 이었고 공급이 **0건**으로 끝났다.
   *    각 조각이 따로 초록인 것과 **사슬이 이어지는 것**은 다르다.
   *
   * 🔴 **fixture 가 실제 최상위 명령 안까지 들어가야 한다** (Codex 재검토 4번).
   *    앞판은 임시 폴더를 만들어 놓고 CLI 는 **운영 폴더**를 봤다 — 그러면 그 검사는
   *    코드가 아니라 운영 상태를 본 것이고, 운영이 비면 초록이 뜬다.
   *    `SORAN_MAGAZINE_DRAFTS_DIR` 로 자식 프로세스까지 같은 fixture 를 보게 한다.
   *
   * 🔴 **이 검사가 증명하지 않는 것**: 실제 ChatGPT 전송·응답·저장.
   *    여기는 전송 0건이다. 브라우저에서 무엇이 되는지는 DOM 실측과
   *    다음 자연 회차만 말할 수 있다.
   */
  const { spawnSync } = await import('node:child_process')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-e2e-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const DATE = '2026-09-28'
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })

    /** 재료가 이미 있는 17건 — 단계는 실측 분포 그대로다 */
    const mk = (slug, files) => {
      fs.mkdirSync(path.join(D, slug), { recursive: true })
      for (const f of files) fs.writeFileSync(path.join(D, slug, f), '#\n')
    }
    const reusable = []
    for (let i = 1; i <= 5; i++) { mk(`e-need-${i}`, ['brief.md', 'review.ts']); reusable.push({ slug: `e-need-${i}` }) }
    for (let i = 1; i <= 2; i++) { mk(`e-conv-${i}`, ['brief.md', 'review.ts', 'draft.md']); reusable.push({ slug: `e-conv-${i}` }) }
    for (let i = 1; i <= 10; i++) { mk(`e-ready-${i}`, ['brief.md', 'review.ts', 'draft.md', 'article-draft.ts']); reusable.push({ slug: `e-ready-${i}` }) }
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', selected: [], reusable, inventoryDays: 0 }, null, 2))

    /** 🔴 자식 프로세스가 **이 fixture** 를 보게 한다. HOME 도 임시다. */
    // 🔴 시험 폴더 주입은 **시험 모드에서만** 열린다 — 자식에게도 그 사실을 명시한다
    const childEnv = { ...process.env, SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_MODE: '1' }
    // 🔴 호출마다 HOME 을 **명시한다.** 한 군데라도 빠지면 운영 HOME 을 물려받는다.
    const node = (args) => spawnSync(process.execPath, args,
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...childEnv, HOME: T } })

    /** ① 🔴 실제 최상위 회수 명령 — dry-run 이라 전송 0건 */
    const fetchRun = node(['scripts/magazine-webui-runner.mjs', '--fetch-run', '--date', DATE, '--dry-run'])
    const out1 = `${fetchRun.stdout}${fetchRun.stderr}`
    check('🔴 ⑳ 최상위 회수 명령이 fixture 를 본다 — 대상 17건',
      /대상 17건/.test(out1), out1.split('\n').find((l) => /대상/.test(l)) ?? out1.slice(0, 160))
    check('🔴 ⑳ selected 0 인데도 전송 예정 5건', /전송 예정 5건/.test(out1),
      out1.split('\n').find((l) => /전송 예정/.test(l)) ?? '(줄 없음)')
    check('🔴 ⑳ 한 글자도 보내지 않았다', /한 글자도 보내지 않았다/.test(out1) && !/전송 1건/.test(out1),
      out1.split('\n').filter((l) => /전송/.test(l)).join(' / ').slice(0, 160))

    /** ② 🔴 실제 최상위 등록 명령 — 같은 회차에서 후보 12건 */
    const gitStatus = () => spawnSync('git', ['status', '--porcelain'],
      { encoding: 'utf8', env: { ...childEnv, HOME: T } }).stdout
    const before = gitStatus()
    const ready = node(['scripts/magazine-auto-register-ready.mjs', '--run', DATE, '--dry-run', '--json'])
    const after = gitStatus()
    const out2 = `${ready.stdout}${ready.stderr}`
    check('🔴 ⑳ 최상위 등록 명령이 예외 없이 끝난다',
      !/ReferenceError|TypeError|is not defined/.test(ready.stderr ?? ''), (ready.stderr ?? '').slice(0, 200) || '(없음)')
    let pool = null
    try { pool = JSON.parse(out2.slice(out2.indexOf('{'), out2.lastIndexOf('}') + 1)).pool ?? null } catch { /* 아래에서 본문으로 본다 */ }
    check('🔴 ⑳ 같은 회차에서 등록 후보 12건',
      pool === 12 || /pool[^0-9]*12|후보 12/.test(out2), `pool=${pool} · ${out2.slice(0, 200)}`)
    check('🔴 ⑳ dry-run 은 repo 파일을 바꾸지 않는다', before === after, '작업트리가 달라졌다')

    /** ③ 🔴 회차 뒤 남는 것이 없다 */
    const support = path.join(T, 'Library', 'Application Support', 'soransoran')
    const leftover = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : [])
    check('🔴 ⑳ 재생성 패킷 0개', leftover(path.join(support, 'regen-packets')).length === 0,
      leftover(path.join(support, 'regen-packets')).join(', ') || '(없음)')
    check('🔴 ⑳ dry-run 은 회수 결과를 남기지 않는다',
      leftover(path.join(support, 'magazine-fetch-results')).length === 0,
      leftover(path.join(support, 'magazine-fetch-results')).join(', ') || '(없음)')

    /** ④ 🔴 fixture 가 실제로 쓰였다는 증거 — 운영 slug 가 아니라 이 fixture slug 가 나온다 */
    check('🔴 ⑳ 출력에 fixture slug 가 있다 (운영 폴더를 본 것이 아니다)',
      /e-need-1/.test(out1), out1.split('\n').filter((l) => /e-/.test(l)).slice(0, 2).join(' / ') || '(없음)')
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉑ 이미 보낸 글은 slug+지문으로 영구히 막힌다')
{
  /**
   * 🔴 **회차 지문으로는 못 막는다** (2026-09-28 · 재검토 P0-1).
   *    `runId` 는 목록 전체의 지문이라 **상관없는 후보 하나만 늘어도** 값이 바뀐다.
   *    그러면 이미 보낸 글의 HOLD 가 같이 풀리고 같은 brief 가 두 번 전송된다.
   *    보낸 사실은 `slug` + **보낸 글자**에 붙어야 한다.
   *
   *    아래는 전부 **실제 `fetchBatch`** 를 돌린 값이다. 전송 0건(dry-run)이다.
   */
  const WEBUI5 = await import('./magazine-webui-runner.mjs')
  const QN5 = await import('./lib/magazine-quarantine.mjs')

  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-hold-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const LEDGER = path.join(T, 'quarantine.json')
    const DATE = '2026-09-28'
    const writeRun = (date, list) => {
      fs.mkdirSync(path.join(D, '_runs', date), { recursive: true })
      fs.writeFileSync(path.join(D, '_runs', date, 'run.json'),
        JSON.stringify({ status: 'COMPLETED', selected: [], reusable: list, inventoryDays: 0 }, null, 2))
    }
    const mk = (slug, files, brief = '# brief\n본문\n') => {
      fs.mkdirSync(path.join(D, slug), { recursive: true })
      for (const f of files) fs.writeFileSync(path.join(D, slug, f), f === 'brief.md' ? brief : '#\n')
    }
    for (const s of ['h-a', 'h-b', 'h-c']) mk(s, ['brief.md', 'review.ts'])
    writeRun(DATE, [{ slug: 'h-a' }, { slug: 'h-b' }, { slug: 'h-c' }])

    const plan = async (date = DATE) => {
      const b = await WEBUI5.fetchBatch({
        date, dryRun: true, limit: 0, draftsDir: D, quarantinePath: LEDGER,
        resultPath: path.join(T, `r-${date}.json`),
      })
      return b.planned ?? []
    }
    const act = (p, slug) => p.find((x) => x.slug === slug)?.action
    const nFetch = (p) => p.filter((x) => x.action === 'fetch').length

    /** 기록이 없으면 셋 다 회수 대상 */
    check('  ㉑ 기록 없음 → 3건 회수', nFetch(await plan()) === 3, `${nFetch(await plan())}건`)

    /** 🔴 h-b 가 보냈는데 응답을 못 받았다 — **실제로 보낼 글자**의 지문으로 적는다 */
    const msgB = WEBUI5.plannedMessageFor('h-b', D)
    const fpB = QN5.deliveryFingerprintOf(msgB)
    QN5.updateQuarantine((cur) => ({
      ...cur,
      'h-b': QN5.recordDelivery(cur['h-b'], {
        sent: true, messageFingerprint: fpB, kind: 'DELIVERY_UNCERTAIN',
        reason: 'response_timeout', stage: 'await-response', now: Date.now(),
        runId: 'run-A', date: DATE,
      }),
    }), LEDGER)

    /** 반례 1 — 같은 회차 재실행 */
    const p1 = await plan()
    check('🔴 ㉑[1] 같은 회차 재실행 → h-b 전송 0', act(p1, 'h-b') === 'hold:delivery_uncertain', String(act(p1, 'h-b')))
    check('  ㉑[1] 나머지 2건은 계속 간다', nFetch(p1) === 2, `${nFetch(p1)}건`)

    /** 반례 2 — 관계없는 후보 추가 (runId 가 바뀐다) */
    mk('other', ['brief.md', 'review.ts'])
    writeRun(DATE, [{ slug: 'h-a' }, { slug: 'h-b' }, { slug: 'h-c' }, { slug: 'other' }])
    const p2 = await plan()
    check('🔴 ㉑[2] 관계없는 후보가 늘어도 h-b 전송 0',
      act(p2, 'h-b') === 'hold:delivery_uncertain', String(act(p2, 'h-b')))
    check('🔴 ㉑[2] 새 후보 other 는 진행된다', act(p2, 'other') === 'fetch', String(act(p2, 'other')))
    check('  ㉑[2] 회수 3건 (h-a·h-c·other)', nFetch(p2) === 3, `${nFetch(p2)}건`)

    /** 반례 3 — 날짜가 바뀌어도 같은 지문이면 막힌다 */
    const DATE2 = '2026-09-29'
    writeRun(DATE2, [{ slug: 'h-a' }, { slug: 'h-b' }, { slug: 'h-c' }])
    const p3 = await plan(DATE2)
    check('🔴 ㉑[3] 날짜가 바뀌어도 h-b 전송 0',
      act(p3, 'h-b') === 'hold:delivery_uncertain', String(act(p3, 'h-b')))

    /** 반례 4 — brief 가 바뀌면 지문이 달라져 다시 보낼 수 있다 */
    fs.writeFileSync(path.join(D, 'h-b', 'brief.md'), '# brief\n고친 본문\n')
    const fpB2 = QN5.deliveryFingerprintOf(WEBUI5.plannedMessageFor('h-b', D))
    check('  ㉑[4] brief 가 바뀌면 지문도 바뀐다', fpB2 !== fpB, `${String(fpB).slice(7, 19)} → ${String(fpB2).slice(7, 19)}`)
    const p4 = await plan(DATE2)
    check('🔴 ㉑[4] 지문이 달라지면 재시도 가능', act(p4, 'h-b') === 'fetch', String(act(p4, 'h-b')))

    /** 반례 5 — draft.md 가 생기면 회수에서 빠지고 등록 경로로 간다 */
    fs.writeFileSync(path.join(D, 'h-b', 'brief.md'), '# brief\n본문\n')   // 지문 원복 → 다시 HOLD 대상
    fs.writeFileSync(path.join(D, 'h-b', 'draft.md'), '---\n원고\n[CTA]\n')
    const p5 = await plan(DATE2)
    check('🔴 ㉑[5] draft.md 가 생기면 회수 대상이 아니다',
      act(p5, 'h-b') === 'skip:needs_convert', String(act(p5, 'h-b')))
    const READY5 = await import('./magazine-auto-register-ready.mjs')
    const scanned = READY5.scan({ runDate: DATE2, store: {}, draftsDir: D })
    check('🔴 ㉑[5] 등록 경로가 h-b 를 후보로 잡는다',
      (scanned.eligible ?? []).some((x) => x.slug === 'h-b') || scanned.pool >= 1,
      `pool ${scanned.pool}`)

    /** 반례 6 — 장부 write/read 뒤 sent:true·지문 보존 · 횟수 소비 0 */
    const back = QN5.readQuarantine(LEDGER)
    const row = back.store['h-b']
    check('🔴 ㉑[6] 장부가 sent:true 를 보존한다', row?.delivery?.sent === true, JSON.stringify(row?.delivery ?? null))
    check('🔴 ㉑[6] 장부가 지문을 그대로 보존한다', row?.delivery?.messageFingerprint === fpB,
      String(row?.delivery?.messageFingerprint).slice(0, 26))
    check('🔴 ㉑[6] attempts 소비 0', (row?.attempts ?? 0) === 0, `attempts ${row?.attempts}`)
    check('🔴 ㉑[6] regenCalls 소비 0', (row?.regenCalls ?? 0) === 0, `regenCalls ${row?.regenCalls}`)
    check('  ㉑[6] runId 는 출처로만 남는다', row?.delivery?.runId === 'run-A', String(row?.delivery?.runId))

    /** 🔴 죽은 게이트가 아니다 — 결말이 INFRA 면 막지 않는다 */
    const infraEntry = QN5.recordDelivery(null, {
      sent: false, messageFingerprint: fpB, kind: 'INFRA', reason: 'connect_failed', stage: 'connect', now: 1,
    })
    check('🔴 ㉑ INFRA 결말은 막지 않는다', QN5.deliveryHoldsFetch(infraEntry, fpB) === null,
      JSON.stringify(QN5.deliveryHoldsFetch(infraEntry, fpB)))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉒ 죽은 업로드 코드를 지웠다 — 이미지 경로는 그대로다')
{
  /**
   * 🔴 brief 첨부를 없앤 뒤 `pickDocumentFileInput` · `judgeUploadState` · `UPLOAD_*` 는
   *    **부르는 곳이 하나도 없다.** 남겨 두면 다음 사람이 "이 경로가 있구나" 하고
   *    다시 켠다. 설명도 같이 지운다 — 없는 동작을 설명하는 주석은 거짓말이다.
   *
   * 🔴 **이미지 생성 경로는 건드리지 않았다.** 그쪽은 파일을 올리지 않고
   *    composer 에 문장만 넣은 뒤 결과 이미지를 내려받는다. 실제로 그런지 본다.
   */
  const SESS = await import('./lib/chatgpt-session.mjs')
  for (const name of ['pickDocumentFileInput', 'judgeUploadState', 'UPLOAD_WAIT_MS', 'UPLOAD_POLL_MS', 'UPLOAD_DONE_CONTRACT']) {
    check(`🔴 ㉒ ${name} 이 더 이상 없다`, SESS[name] === undefined, typeof SESS[name])
  }
  check('  ㉒ composer 계약은 그대로 있다',
    typeof SESS.composerLocator === 'function' && typeof SESS.COMPOSER_SELECTOR === 'string',
    SESS.COMPOSER_SELECTOR)

  /** 🔴 이미지 경로가 **실제로 적재된다** — 지운 이름을 들고 있으면 여기서 터진다 */
  let heroLoaded = true
  let heroErr = ''
  try { await import('./magazine-hero-runner.mjs') } catch (e) { heroLoaded = false; heroErr = e.message }
  check('🔴 ㉒ 이미지 생성 경로가 그대로 적재된다', heroLoaded, heroErr)

  /** 🔴 이미지 경로의 순수 함수가 그대로 돈다 */
  const HERO = await import('./lib/magazine-hero.mjs')
  const prompt = HERO.buildPrompt({ slug: 'x', title: '제목', alt: '여성', brief: '내용' })
  check('🔴 ㉒ 이미지 프롬프트가 여전히 만들어진다',
    typeof prompt === 'string' && prompt.length > 0, `${String(prompt).length}자`)
  check('  ㉒ 이미지 크기 계약이 그대로다',
    Number.isFinite(HERO.HERO_WIDTH) && Number.isFinite(HERO.HERO_HEIGHT),
    `${HERO.HERO_WIDTH}×${HERO.HERO_HEIGHT}`)
}

console.log('\n㉓ 자동화 프로필 신원 — 사람 창으로는 절대 돌지 않는다')
{
  /**
   * 🔴 **2026-09-28 실측.** 자동화가 쓰던 `soransoran-chatgpt` 의 실제 신원은
   *    `내 Chrome` · `mogoyongseok@gmail.com` 이었다. 소란소란 사람용 프로필
   *    (`Profile 9` · `용석 (소란 소란)` · `soransoran.community@gmail.com`)도,
   *    자동화 전용도 아니었다. **엉뚱한 계정으로 글을 보내는 것은 조용한 사고다.**
   */
  const AP = await import('./lib/chatgpt-automation-profile.mjs')
  const okDir = AP.AUTOMATION_PROFILE_DIR
  const okPort = AP.AUTOMATION_CDP_PORT
  const okMarker = { schemaVersion: 1, purpose: 'soransoran-chatgpt-automation', cdpPort: okPort }
  const okLines = [`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${okDir} --remote-debugging-port=${okPort} https://chatgpt.com/`]
  const okPages = [{ type: 'page', url: 'https://chatgpt.com/' }]
  const base = {
    profileDir: okDir, port: okPort, marker: okMarker, markerMode: 0o600, dirMode: 0o700,
    commandLines: okLines, pages: okPages, portInUse: true,
  }
  const j = (over) => AP.judgeAutomationProfile({ ...base, ...over })

  /** 반례 1 — 사람용 Profile 9 */
  // 🔴 이 시험 파일은 운영 HOME 을 읽지 않는다 — 금지 경로는 **모듈이 알려 준다**
  const p9 = AP.FORBIDDEN_PROFILE_DIRS.find((d) => /Profile 9$/.test(d))
  const r1 = j({ profileDir: p9 })
  /**
   * 🔴 **왜 사유 문장까지 보는가.** 뒤에 "자동화 전용 폴더가 아니다" 라는 일반 검사가
   *    또 있어서, 금지 목록을 지워도 결과는 똑같이 차단이다 — 그러면 금지 목록은
   *    **죽은 게이트**가 된다(변이로 확인). 운영자가 읽을 사유가 달라지므로 그것을 고정한다.
   *    "사람용 프로필이라 막혔다" 와 "폴더가 다르다" 는 대처가 다른 말이다.
   */
  check('🔴 ㉓[1] 사람용 Profile 9 → 차단', r1.ok === false && r1.code === AP.MISMATCH, `${r1.code} — ${r1.why}`)
  check('🔴 ㉓[1] 사유가 사람용 프로필임을 말한다', /사람용·옛 프로필/.test(r1.why ?? ''), r1.why)

  /** 반례 2 — 옛 자동화 폴더 */
  const old = AP.FORBIDDEN_PROFILE_DIRS.find((d) => /soransoran-chatgpt$/.test(d))
  const r2 = j({ profileDir: old })
  check('🔴 ㉓[2] 옛 soransoran-chatgpt → 차단', r2.ok === false && r2.code === AP.MISMATCH, `${r2.code} — ${r2.why}`)
  check('🔴 ㉓[2] 사유가 옛 프로필임을 말한다', /사람용·옛 프로필/.test(r2.why ?? ''), r2.why)

  /** 반례 3 — 새 프로필이지만 표식 없음 */
  const r3 = j({ marker: null, markerMode: null, dirMode: null })
  check('🔴 ㉓[3] 표식 없음 → 차단', r3.ok === false && /표식/.test(r3.why), r3.why)

  /** 반례 4 — 새 프로필인데 ChatGPT 가 아닌 page */
  const r4 = j({ pages: [{ type: 'page', url: 'https://hoohootv1.org/watch/drama/4145' }] })
  check('🔴 ㉓[4] 비-ChatGPT 페이지 → 차단', r4.ok === false && /허용되지 않는 페이지/.test(r4.why), r4.why)

  /** 반례 5 — 정확한 프로필 + 표식 + ChatGPT page → 통과 */
  const r5 = j({})
  check('🔴 ㉓[5] 정확한 프로필+표식+ChatGPT → 통과', r5.ok === true, r5.why ?? JSON.stringify(r5.checked))

  /** 반례 6 — 다른 프로세스가 9344 를 쓰고 있다 */
  const r6 = j({ commandLines: [`/usr/bin/other --user-data-dir=/tmp/somewhere --remote-debugging-port=${okPort}`] })
  check('🔴 ㉓[6] 다른 프로세스가 포트 사용 → 차단', r6.ok === false && /다른 프로세스/.test(r6.why), r6.why)

  /** 🔴 곁가지 — 같은 폴더인데 포트가 다르면 붙지 않는다 */
  const r7 = j({
    portInUse: false,
    commandLines: [`Google Chrome --user-data-dir=${okDir} --remote-debugging-port=9999`],
  })
  check('🔴 ㉓ 같은 폴더·다른 포트 → 차단', r7.ok === false && /포트가 다르다/.test(r7.why), r7.why)

  /** 🔴 권한이 느슨하면 막는다 — 쿠키가 든 폴더다 */
  check('🔴 ㉓ 표식 0644 → 차단', j({ markerMode: 0o644 }).ok === false, j({ markerMode: 0o644 }).why)
  check('🔴 ㉓ 폴더 0755 → 차단', j({ dirMode: 0o755 }).ok === false, j({ dirMode: 0o755 }).why)

  /** 🔴 표식을 사람 프로필에 붙여도 소용없다 */
  const forced = AP.ensureAutomationProfile({ profileDir: p9 })
  check('🔴 ㉓ 사람 프로필에는 표식을 만들지 않는다', forced.ok === false, forced.why)

  /** 🔴 실제 probe 가 이 관문을 지난다 — 죽은 게이트가 아니다 */
  const SESS = await import('./lib/chatgpt-session.mjs')
  check('  ㉓ 세션이 전용 폴더를 쓴다', SESS.PROFILE_DIR === okDir, SESS.PROFILE_DIR)
  check('  ㉓ 세션이 전용 포트를 쓴다', SESS.CDP_PORT === okPort, String(SESS.CDP_PORT))
  const blocked = await SESS.probe({ verifyProfileFn: async () => ({ ok: false, code: AP.MISMATCH, why: '시험: 신원 불일치' }) })
  check('🔴 ㉓ 신원이 틀리면 probe 가 즉시 멈춘다',
    blocked.status === AP.MISMATCH, `${blocked.status} — ${blocked.errorDetail}`)
  check('🔴 ㉓ 그 실패는 회차 전역 실패다 (한 후보만 건너뛰지 않는다)',
    SESS.isFatal(AP.MISMATCH) === true, String(SESS.isFatal(AP.MISMATCH)))
  const FK23 = await import('./lib/magazine-failure-kind.mjs')
  const k23 = FK23.classifyFailure({ code: AP.MISMATCH, message: '신원 불일치', sent: false })
  check('🔴 ㉓ 신원 실패는 원고 탓이 아니다 (INFRA)', k23.kind === 'INFRA', k23.kind)
}

console.log('\n㉔ 시험 폴더 주입은 시험 모드에서만 열린다')
{
  /**
   * 🔴 폴더를 갈아끼우는 손잡이가 운영에서 켜지면 자동화가 **엉뚱한 폴더의 원고**를
   *    읽고 쓴다. 로그만 보면 정상이라 알아채기 어렵다.
   */
  const LOAD = await import('./lib/magazine-load.mjs')
  const r1 = LOAD.resolveDraftsDir({ SORAN_MAGAZINE_DRAFTS_DIR: '/tmp/x' })
  check('🔴 ㉔ TEST_MODE 없이 주입 → 차단', r1.ok === false && r1.code === 'DRAFTS_DIR_INJECTION_BLOCKED', r1.why)
  const r2 = LOAD.resolveDraftsDir({ SORAN_MAGAZINE_DRAFTS_DIR: '/tmp/x', SORAN_MAGAZINE_TEST_MODE: '1' })
  check('🔴 ㉔ TEST_MODE=1 이면 허용', r2.ok === true && r2.injected === true, r2.dir)
  const r3 = LOAD.resolveDraftsDir({})
  check('  ㉔ 안 주면 저장소 폴더', r3.ok === true && r3.injected === false, r3.dir)

  /** 🔴 실제 자식 프로세스가 **종료 코드 2** 로 끝난다 — 조용히 기본값으로 가지 않는다 */
  const { spawnSync } = await import('node:child_process')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-inject-'))
  try {
    const run = (env) => spawnSync(process.execPath,
      ['scripts/magazine-webui-runner.mjs', '--fetch-run', '--dry-run'],
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T, ...env } })
    const bad = run({ SORAN_MAGAZINE_DRAFTS_DIR: T })
    check('🔴 ㉔ 운영에서 주입되면 실제 명령이 non-zero', bad.status !== 0, `exit ${bad.status}`)
    check('🔴 ㉔ 그 사유를 말한다',
      /DRAFTS_DIR_INJECTION_BLOCKED/.test(`${bad.stdout}${bad.stderr}`), `${bad.stderr}`.slice(0, 120))
    check('🔴 ㉔ 파일을 하나도 건드리지 않았다고 말한다',
      /파일을 하나도 읽거나 쓰지 않았다/.test(`${bad.stdout}${bad.stderr}`), '문구 없음')
  } finally { fs.rmSync(T, { recursive: true, force: true }) }

  /** 🔴 launchd plist·운영 명령에 두 변수가 없다 */
  /** 🔴 실제 위치에서 읽는다 — 없는 폴더를 뒤지면 "0개 통과" 라는 공허한 초록이 뜬다 */
  const plists = spawnSyncTop('git', ['ls-files', '--', 'docs/operations/launchd'])
    .split('\n').filter((f) => /\.plist(\.template)?$/.test(f))
  check('  ㉔ 검사할 launchd 템플릿을 실제로 찾았다', plists.length > 0, `${plists.length}개`)
  const leaked = plists.filter((f) => /SORAN_MAGAZINE_(DRAFTS_DIR|TEST_MODE|TEST_FIXTURE)/.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8')))
  check('🔴 ㉔ launchd plist 에 시험 변수가 없다', leaked.length === 0,
    leaked.join(', ') || `검사한 plist ${plists.length}개`)
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  const badScripts = Object.entries(pkg.scripts ?? {})
    .filter(([, v]) => /SORAN_MAGAZINE_(DRAFTS_DIR|TEST_FIXTURE)/.test(String(v)))
  check('🔴 ㉔ package.json 운영 명령에도 없다', badScripts.length === 0, badScripts.map(([k]) => k).join(', ') || '0건')
}

console.log('\n㉕ ensureChrome 이 신원 정본이다 — 모든 경로가 여기를 지난다')
{
  /**
   * 🔴 **수정 전 결함** (2026-09-28 · 재검토 P0-1).
   *    `ensureChrome` 은 `cdpAvailable()` 하나만 보고 `{ok:true}` 를 돌려줬다.
   *    그래서 **이미 떠 있기만 하면** 폴더·표식·포트 주인·열린 페이지를 하나도 보지 않았다.
   *    `magazine-hero-runner` 는 `probe` 를 거치지 않고 `ensureChrome` 을 직접 부른다 —
   *    즉 이미지 경로는 **엉뚱한 프로필에 그대로 붙었다.**
   */
  const SESS = await import('./lib/chatgpt-session.mjs')
  const AP = await import('./lib/chatgpt-automation-profile.mjs')

  /**
   * 🔴 **환경을 읽지 않는다.** 실제 프로필을 보면 "그때 Chrome 이 떠 있었는지" 에 따라
   *    결과가 달라진다 — 지금 실제로 전용 창이 떠 있어서 LIVE 잠금에 걸렸다.
   *    폴더와 프로세스 목록을 고정한다.
   */
  const T25 = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-ensure-'))
  const call = async (over = {}) => {
    let spawned = 0
    const r = await SESS.ensureChrome({
      waitMs: 200, pollMs: 20, browserCheck: () => true,
      profileDir: T25, processes: () => '',
      spawnFn: () => { spawned += 1; return { unref() {} } },
      ...over,
    })
    return { r, spawned }
  }

  /** ① 🔴 **이미 떠 있어도** 신원이 틀리면 막는다 (옛 결함의 정확한 반례) */
  const a = await call({
    cdpCheck: async () => true,
    verifyProfileFn: async ({ requireRunning }) => (requireRunning
      ? { ok: false, code: AP.MISMATCH, why: '열린 페이지가 ChatGPT 가 아니다' }
      : { ok: true }),
  })
  check('🔴 ㉕ CDP 가 살아 있어도 신원이 틀리면 막는다',
    a.r.ok === false && a.r.reason === AP.MISMATCH, `${a.r.ok} · ${a.r.reason} — ${a.r.why}`)
  check('🔴 ㉕ 그때 spawn 0회', a.spawned === 0, `${a.spawned}회`)

  /** ② 🔴 띄우기 전 검사가 막으면 spawn 조차 하지 않는다 */
  const b = await call({
    cdpCheck: async () => false,
    verifyProfileFn: async () => ({ ok: false, code: AP.MISMATCH, why: '용도 표식이 없다' }),
  })
  check('🔴 ㉕ 표식이 없으면 띄우지도 않는다', b.r.reason === AP.MISMATCH && b.spawned === 0,
    `${b.r.reason} · spawn ${b.spawned}회`)
  check('🔴 ㉕ 자동 실행은 표식을 만들지 않는다 (생성 0)',
    !fs.existsSync(path.join(os.tmpdir(), 'never')) && /표식/.test(b.r.why ?? ''), b.r.why)

  /** ③ 🔴 **새로 띄운 뒤에도 다시 본다.** 우리가 spawn 했다고 우리 창이라는 보장은 없다 */
  // 🔴 **spawn 경로를 실제로 태운다** — 처음엔 포트가 닫혀 있다가 띄운 뒤 열린다
  let cdpPolls = 0
  const c = await call({
    cdpCheck: async () => { cdpPolls += 1; return cdpPolls > 1 },
    verifyProfileFn: async ({ requireRunning }) => (requireRunning
      ? { ok: false, code: AP.MISMATCH, why: '띄운 뒤 보니 다른 프로세스가 포트를 잡았다' }
      : { ok: true }),
  })
  check('  ㉕ 그 반례가 실제로 spawn 을 탔다', c.spawned === 1, `spawn ${c.spawned}회`)
  check('🔴 ㉕ 띄운 뒤 신원이 틀리면 ok 를 주지 않는다',
    c.r.ok === false && c.r.reason === AP.MISMATCH && c.r.started === true,
    `ok=${c.r.ok} started=${c.r.started} ${c.r.why}`)

  /** ④ 정상 경로는 그대로 통과한다 — 죽은 게이트가 아니다 */
  const d = await call({ cdpCheck: async () => true, verifyProfileFn: async () => ({ ok: true }) })
  check('  ㉕ 신원이 맞으면 통과한다', d.r.ok === true && d.r.started === false, JSON.stringify(d.r.reason ?? 'ok'))

  /**
   * ⑤ 🔴 **fail-closed** — 페이지 목록을 못 읽은 것을 "0건" 으로 바꾸지 않는다.
   *    옛 판은 `catch → []` 였고, 그 빈 배열이 그대로 정상 통과했다.
   */
  const read = (over) => AP.judgeAutomationProfile({
    profileDir: AP.AUTOMATION_PROFILE_DIR, port: AP.AUTOMATION_CDP_PORT,
    marker: { schemaVersion: 1, purpose: 'soransoran-chatgpt-automation', cdpPort: AP.AUTOMATION_CDP_PORT },
    markerMode: 0o600, dirMode: 0o700,
    commandLines: [`Chrome --user-data-dir=${AP.AUTOMATION_PROFILE_DIR} --remote-debugging-port=${AP.AUTOMATION_CDP_PORT}`],
    portInUse: true, requireRunning: true, ...over,
  })
  /**
   * 🔴 **"못 읽었다" 와 "0건" 은 다른 말이다.** 운영 모드에서는 0건도 막히므로
   *    둘을 구분하지 않으면 읽기 실패 분기가 **죽은 게이트**가 된다 (변이로 확인).
   *    ① 사유가 읽기 실패임을 말하는지 ② 0건이 허용되는 **로그인 모드에서도** 막는지 본다.
   */
  const unread = read({ pages: null, pagesReadOk: false })
  check('🔴 ㉕ 페이지 목록을 못 읽으면 막는다', unread.ok === false, unread.why)
  check('🔴 ㉕ 사유가 "읽지 못했다" 임을 말한다', /읽지 못했다/.test(unread.why ?? ''), unread.why)
  const unreadLogin = read({ pages: null, pagesReadOk: false, mode: 'login' })
  check('🔴 ㉕ 0건이 허용되는 로그인 모드에서도 읽기 실패는 막는다',
    unreadLogin.ok === false && /읽지 못했다/.test(unreadLogin.why ?? ''), unreadLogin.why)
  check('  ㉕ 로그인 모드에서 page 0건 자체는 허용된다',
    read({ pages: [], mode: 'login' }).ok === true, read({ pages: [], mode: 'login' }).why ?? 'ok')
  check('🔴 ㉕ 운영에서 page 0건도 막는다', read({ pages: [] }).ok === false, read({ pages: [] }).why)
  check('  ㉕ ChatGPT page 가 있으면 통과',
    read({ pages: [{ type: 'page', url: 'https://chatgpt.com/' }] }).ok === true, 'ok')

  /** ⑥ 🔴 auth.openai.com 은 **로그인 중에만** 허용된다 */
  const authPage = [{ type: 'page', url: 'https://auth.openai.com/mfa-challenge/email-otp' }]
  check('🔴 ㉕ 운영 실행은 auth.openai.com 을 막는다',
    read({ pages: authPage, mode: 'operate' }).ok === false, read({ pages: authPage, mode: 'operate' }).why)
  check('🔴 ㉕ 로그인 중에만 auth.openai.com 을 허용한다',
    read({ pages: authPage, mode: 'login' }).ok === true, read({ pages: authPage, mode: 'login' }).why ?? 'ok')
  check('🔴 ㉕ 로그인 중에도 엉뚱한 페이지는 막는다',
    read({ pages: [{ type: 'page', url: 'https://hoohootv1.org/watch' }], mode: 'login' }).ok === false,
    read({ pages: [{ type: 'page', url: 'https://hoohootv1.org/watch' }], mode: 'login' }).why)

  /**
   * ⑦ 🔴 **이미지 경로가 실제로 이 관문을 지난다.**
   *    `magazine-hero-runner` 는 `probe` 를 거치지 않는다 — `ensureChrome` 하나에 달려 있다.
   */
  const heroSrc = fs.readFileSync(path.join(process.cwd(), 'scripts/magazine-hero-runner.mjs'), 'utf8')
  check('  ㉕ hero 가 ensureChrome 을 거친다', /await ensureChrome\(/.test(heroSrc),
    heroSrc.split('\n').find((l) => /await ensureChrome\(/.test(l))?.trim() ?? '호출 없음')
  const HERO = await import('./magazine-hero-runner.mjs')
  check('  ㉕ hero 모듈이 적재된다', typeof HERO === 'object', typeof HERO)
  fs.rmSync(T25, { recursive: true, force: true })
}

const KILL_CHILD_SRC = "/**\n * \ud83d\udd34 **\uc804\uc1a1 \uc9c1\ud6c4 \ud504\ub85c\uc138\uc2a4\uac00 \uc8fd\ub294 \uc0c1\ud669\uc744 \uc2e4\uc81c\ub85c \ub9cc\ub4e0\ub2e4.**\n *    \uc2e4\uc81c `fetchManuscript` \ub97c \uac00\uc9dc \ube0c\ub77c\uc6b0\uc800\ub85c \ub3cc\ub9ac\ub418, send \ubc84\ud2bc\uc744 \ub204\ub974\ub294 \uc21c\uac04\n *    `SIGKILL` \ub85c \uc790\uae30 \uc790\uc2e0\uc744 \uc8fd\uc778\ub2e4. \uc815\ub9ac \ucf54\ub4dc\ub3c4, \ubc18\ud658\ub3c4 \uc5c6\ub2e4 \u2014 \uc9c4\uc9dc \uae09\uc0ac\ub2e4.\n */\nimport { writeFileSync, mkdirSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { fetchManuscript } from './scripts/lib/chatgpt-session.mjs'\nimport { updateQuarantine, recordDelivery } from './scripts/lib/magazine-quarantine.mjs'\n/**\n * \ud83d\udd34 **\ud504\ub86c\ud504\ud2b8\ub294 production \uac83\uc744 \uc4f4\ub2e4.** \uc9c0\ubb38\uc740 \"\ubcf4\ub0bc \uae00\uc790\" \ub85c \ub9cc\ub4e0\ub2e4 \u2014\n *    \uc2dc\ud5d8\uc774 \ub2e4\ub978 \ubb38\uc7a5\uc744 \uc4f0\uba74 \uc9c0\ubb38\uc774 \ub2ec\ub77c\uc838, \ub9c9\uc544\uc57c \ud560 \uac83\uc744 \ubabb \ub9c9\uace0\ub3c4 \ucd08\ub85d\uc774 \ub72c\ub2e4.\n */\nimport { manuscriptPromptText } from './scripts/magazine-webui-runner.mjs'\n\n// \ud83d\udd34 `node -e` \ub294 argv \uc5d0 \uc2a4\ud06c\ub9bd\ud2b8 \uacbd\ub85c\ub97c \ub123\uc9c0 \uc54a\ub294\ub2e4 \u2014 \ub4a4\uc5d0\uc11c \uc13c\ub2e4\nconst [briefPath, outPath, ledger, slug, message] = process.argv.slice(-5)\nvoid message\n\nconst makePage = () => {\n  let typed = ''\n  const composer = {\n    async click() {},\n    async innerText() { return typed },\n  }\n  const sendBtn = {\n    async click() {\n      // \ud83d\udd34 \uc5ec\uae30\uac00 \uc804\uc1a1\uc774\ub2e4. \ub204\ub974\ub294 \uc21c\uac04 \uae09\uc0ac\ud55c\ub2e4.\n      process.kill(process.pid, 'SIGKILL')\n      await new Promise(() => {})\n    },\n  }\n  return {\n    async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},\n    async waitForFunction() {},\n    async evaluate() { return { readOk: true, stop: false, units: [] } },\n    async evaluateHandle() { return { asElement: () => ({ async setInputFiles() {} }) } },\n    locator(sel) {\n      const isSend = /send-button|\ubcf4\ub0b4\uae30|Send/.test(String(sel ?? ''))\n      const l = isSend ? sendBtn : composer\n      return { first: () => l, async all() { return [l] }, ...l }\n    },\n    keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },\n  }\n}\nconst page = makePage()\nconst browser = {\n  contexts: () => [{ pages: () => [], newPage: async () => page }],\n  async close() {},\n}\n\nmkdirSync(join(outPath, '..'), { recursive: true })\nvoid writeFileSync\n\nconst r = await fetchManuscript({\n  briefPath, outPath, promptText: manuscriptPromptText(null), requiredMarkers: [],\n  timeoutMs: 500, connectTimeoutMs: 500,\n  ensureTab: async () => ({ ok: true }),\n  connect: async () => browser,\n  onBeforeSend: async ({ messageFingerprint }) => {\n    updateQuarantine((cur) => ({\n      ...cur,\n      [slug]: recordDelivery(cur[slug], {\n        sent: null, messageFingerprint, kind: 'DELIVERY_UNCERTAIN',\n        reason: 'sending', stage: 'send', now: Date.now(), date: '2026-09-28',\n      }),\n    }), ledger)\n    return { ok: true }\n  },\n})\n// \ud83d\udd34 \uc5ec\uae30 \ub3c4\ub2ec\ud558\uba74 \uae09\uc0ac\uac00 \uc77c\uc5b4\ub098\uc9c0 \uc54a\uc740 \uac83\uc774\ub2e4 \u2014 \uadf8\uac83\ub3c4 \uc0ac\uc2e4\ub300\ub85c \uc54c\ub9b0\ub2e4\nconsole.log(`NOT_KILLED ${JSON.stringify(r)}`)\n"

console.log('\n㉖ 전송 직전에 먼저 적는다 — 급사해도 다시 보내지 않는다')
{
  /**
   * 🔴 **수정 전 결함** (2026-09-28 · 재검토 P0-2).
   *    앞판은 send 를 누르고 **돌아온 뒤에** 장부를 적었다. 전송 직후 프로세스가 죽으면
   *    (맥이 잠들거나 launchd 가 끊거나 예외로 터지거나) 기록이 없다 —
   *    다음 회차는 "안 보냈다" 로 읽고 **같은 brief 를 다시 보낸다.**
   *
   *    아래는 **진짜 자식 프로세스**를 띄워 send 를 누르는 순간 `SIGKILL` 로 죽인다.
   *    정리 코드도 반환도 없다. 그 뒤 장부와 다음 회차 계획을 본다.
   */
  const { spawnSync } = await import('node:child_process')
  const WEBUI6 = await import('./magazine-webui-runner.mjs')
  const QN6 = await import('./lib/magazine-quarantine.mjs')

  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-kill-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const LEDGER = path.join(T, 'q.json')
    const DATE = '2026-09-28'
    const mk = (slug) => {
      fs.mkdirSync(path.join(D, slug), { recursive: true })
      fs.writeFileSync(path.join(D, slug, 'brief.md'), '# brief\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n')
      fs.writeFileSync(path.join(D, slug, 'review.ts'), '#\n')
    }
    for (const s of ['k-a', 'k-b']) mk(s)
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', selected: [], reusable: [{ slug: 'k-a' }, { slug: 'k-b' }], inventoryDays: 0 }))

    const plan = async () => {
      const b = await WEBUI6.fetchBatch({
        date: DATE, dryRun: true, limit: 0, draftsDir: D, quarantinePath: LEDGER,
        resultPath: path.join(T, 'r.json'),
      })
      return b.planned ?? []
    }
    const act = (p, slug) => p.find((x) => x.slug === slug)?.action

    check('  ㉖ 급사 전에는 2건 다 회수 대상',
      (await plan()).filter((x) => x.action === 'fetch').length === 2, '2건 아님')

    /** 🔴 실제 자식을 띄워 send 를 누르는 순간 SIGKILL */
    const child = spawnSync(process.execPath,
      ['--input-type=module', '-e', KILL_CHILD_SRC,
        path.join(D, 'k-a', 'brief.md'), path.join(D, 'k-a', 'draft.md'), LEDGER, 'k-a', 'x'],
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T } })
    check('🔴 ㉖ 자식이 전송 직후 실제로 급사했다 (SIGKILL)',
      child.signal === 'SIGKILL' || child.status === 137,
      `signal=${child.signal} status=${child.status} ${String(child.stdout).slice(0, 80)}`)
    check('🔴 ㉖ 급사라 draft 가 저장되지 않았다',
      !fs.existsSync(path.join(D, 'k-a', 'draft.md')), 'draft.md 가 있다')

    /** 🔴 그런데도 장부에는 전송 사실이 남아 있다 — 선기록 덕분이다 */
    const row = QN6.readQuarantine(LEDGER).store['k-a']
    check('🔴 ㉖ 급사해도 장부에 전송 기록이 남는다', !!row?.delivery, JSON.stringify(row ?? null))
    check('🔴 ㉖ 그 기록은 DELIVERY_UNCERTAIN 이다', row?.delivery?.kind === 'DELIVERY_UNCERTAIN', String(row?.delivery?.kind))
    check('🔴 ㉖ sent 는 모름(null) — 눌렀는지 확정할 수 없다', row?.delivery?.sent === null, String(row?.delivery?.sent))
    check('🔴 ㉖ 지문이 실제 보낼 메시지와 같다',
      row?.delivery?.messageFingerprint === QN6.deliveryFingerprintOf(WEBUI6.plannedMessageFor('k-a', D)),
      String(row?.delivery?.messageFingerprint).slice(0, 26))
    check('🔴 ㉖ attempts 소비 0', (row?.attempts ?? 0) === 0, `attempts ${row?.attempts}`)
    check('🔴 ㉖ regenCalls 소비 0', (row?.regenCalls ?? 0) === 0, `regenCalls ${row?.regenCalls}`)

    /** 🔴 다음 회차 — 재전송 0 · 다른 후보는 계속 */
    const p2 = await plan()
    check('🔴 ㉖ 재실행 시 k-a 전송 0', act(p2, 'k-a') === 'hold:delivery_uncertain', String(act(p2, 'k-a')))
    check('🔴 ㉖ 다른 후보 k-b 는 계속 진행', act(p2, 'k-b') === 'fetch', String(act(p2, 'k-b')))

    /** 🔴 brief 를 고치면 지문이 달라져 다시 보낼 수 있다 */
    fs.writeFileSync(path.join(D, 'k-a', 'brief.md'), '# brief\n\n## 반드시 그대로 넣을 문장\n1. 고친 문장\n')
    check('🔴 ㉖ brief 를 고치면 재시도 가능', act(await plan(), 'k-a') === 'fetch', String(act(await plan(), 'k-a')))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉗ 선기록에 실패하면 한 글자도 보내지 않는다')
{
  /**
   * 🔴 **기억할 수 없는 전송은 하지 않는다.** 장부에 적지 못한 채 보내면,
   *    다음 회차가 그 사실을 알 길이 없어 같은 brief 를 다시 보낸다.
   */
  const SESS27 = await import('./lib/chatgpt-session.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-pre-'))
  try {
    const briefPath = path.join(T, 'brief.md')
    fs.writeFileSync(briefPath, '# brief\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n')

    const makeWorld = () => {
      const w = { sendClicks: 0, setInputFiles: 0, typed: '' }
      const page = {
        async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
        async waitForFunction() {},
        async evaluate() { return '---\n본문\n[CTA]' },
        async evaluateHandle() { return { asElement: () => ({ async setInputFiles() { w.setInputFiles += 1 } }) } },
        locator(sel) {
          const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
          const l = {
            async click() { if (isSend) w.sendClicks += 1 },
            async innerText() { return w.typed },
            async setInputFiles() { w.setInputFiles += 1 },
          }
          return { first: () => l, async all() { return [l] }, ...l }
        },
        keyboard: { async insertText(t) { w.typed += String(t ?? '') }, async press() {} },
      }
      w.browser = { contexts: () => [{ pages: () => [], newPage: async () => adaptPage(page) }], async close() {} }
      return w
    }

    /** ① 선기록이 실패하면 누르지 않는다 */
    const w1 = makeWorld()
    const r1 = await SESS27.fetchManuscript({ ...FAST_FETCH,
      briefPath, outPath: path.join(T, 'out.md'), promptText: '시험', requiredMarkers: ['문장 하나'],
      timeoutMs: 300, connectTimeoutMs: 300,
      ensureTab: async () => ({ ok: true }), connect: async () => w1.browser,
      onBeforeSend: async () => ({ ok: false, why: '장부 잠김' }),
    })
    check('🔴 ㉗ 선기록 실패 → send 클릭 0회', w1.sendClicks === 0, `${w1.sendClicks}회`)
    check('🔴 ㉗ 전송 0건으로 끝난다', r1.ok === false && r1.sent === false, `ok=${r1.ok} sent=${r1.sent}`)
    check('🔴 ㉗ 사유가 선기록 실패임을 말한다',
      r1.reason === 'predelivery_record_failed' && /한 글자도 보내지 않았다/.test(r1.errorDetail ?? ''),
      `${r1.reason} — ${r1.errorDetail}`)
    check('  ㉗ setInputFiles 0회', w1.setInputFiles === 0, `${w1.setInputFiles}회`)

    /** ② 🔴 선기록은 **누르기 전**에 불린다 — 순서를 증명한다 */
    const w2 = makeWorld()
    const order = []
    await SESS27.fetchManuscript({ ...FAST_FETCH,
      briefPath, outPath: path.join(T, 'out2.md'), promptText: '시험', requiredMarkers: ['문장 하나'],
      timeoutMs: 300, connectTimeoutMs: 300,
      ensureTab: async () => ({ ok: true }),
      connect: async () => {
        const b = w2.browser
        const origCtx = b.contexts
        b.contexts = () => origCtx().map((c) => ({
          ...c,
          newPage: async () => {
            const p = await c.newPage()
            const loc = p.locator.bind(p)
            p.locator = (sel) => {
              const l = loc(sel)
              if (!/send-button|보내기|Send/.test(String(sel ?? ''))) return l
              return { ...l, first: () => ({ ...l.first(), async click() { order.push('send'); w2.sendClicks += 1 } }) }
            }
            return p
          },
        }))
        return b
      },
      onBeforeSend: async ({ messageFingerprint }) => { order.push(`record:${String(messageFingerprint).slice(7, 15)}`); return { ok: true } },
    })
    check('🔴 ㉗ 기록이 send 보다 먼저다', order[0]?.startsWith('record:') && order[1] === 'send', order.join(' → '))

    /** ③ 🔴 선기록 뒤에 실패하면 **전송 여부를 확정할 수 없다** */
    // 🔴 readback 은 통과시키고 **응답 대기에서** 터뜨린다 — send 를 누른 뒤의 실패다
    const w3 = makeWorld()
    const b3 = w3.browser
    const ctx3 = b3.contexts()[0]
    b3.contexts = () => [{
      ...ctx3,
      newPage: async () => {
        const p = await ctx3.newPage()
        p.waitForFunction = async () => { throw new Error('waitForFunction: Timeout') }
        return p
      },
    }]
    const r3 = await SESS27.fetchManuscript({ ...FAST_FETCH,
      briefPath, outPath: path.join(T, 'out3.md'), promptText: '시험', requiredMarkers: ['문장 하나'],
      timeoutMs: 300, connectTimeoutMs: 300,
      ensureTab: async () => ({ ok: true }), connect: async () => b3,
      onBeforeSend: async () => ({ ok: true }),
    })
    check('🔴 ㉗ 선기록 뒤 실패는 preRecorded 를 달고 온다', r3.preRecorded === true, String(r3.preRecorded))
    check('🔴 ㉗ 그 실패는 send 를 누른 뒤다', w3.sendClicks === 1 && r3.sent === true, `send ${w3.sendClicks}회 sent=${r3.sent}`)
    check('  ㉗ 그래야 호출부가 기록을 지우지 않는다', r3.ok === false && r3.reason === 'response_timeout', `${r3.reason}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉘ --login 만 표식을 만든다 · 포트 주인을 확인한다')
{
  const AP28 = await import('./lib/chatgpt-automation-profile.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-login-'))
  try {
    /** 🔴 표식 생성은 권한까지 맞춘다 */
    const made = AP28.ensureAutomationProfile({ profileDir: path.join(T, 'auto'), port: 9344 })
    check('  ㉘ 금지 폴더가 아니면 표식을 만든다', made.ok === true, made.why ?? 'ok')
    const f = AP28.markerPath(path.join(T, 'auto'))
    check('🔴 ㉘ 표식 권한 0600', (fs.statSync(f).mode & 0o777) === 0o600, (fs.statSync(f).mode & 0o777).toString(8))
    check('🔴 ㉘ 폴더 권한 0700',
      (fs.statSync(path.join(T, 'auto')).mode & 0o777) === 0o700,
      (fs.statSync(path.join(T, 'auto')).mode & 0o777).toString(8))
    const back = AP28.readMarker(path.join(T, 'auto'))
    check('  ㉘ 표식 내용이 계약대로다',
      back.marker.schemaVersion === 1 && back.marker.purpose === 'soransoran-chatgpt-automation' && back.marker.cdpPort === 9344,
      JSON.stringify(back.marker))

    /** 🔴 사람 프로필에는 만들지 않는다 */
    for (const bad of AP28.FORBIDDEN_PROFILE_DIRS) {
      const r = AP28.ensureAutomationProfile({ profileDir: bad })
      check(`🔴 ㉘ 금지 폴더에는 표식을 만들지 않는다 — ${path.basename(bad)}`,
        r.ok === false && !fs.existsSync(AP28.markerPath(bad)), r.why)
    }

    /**
     * 🔴 **자동 실행은 표식을 만들지 않는다.** `--login` 만 만든다.
     *    소스가 아니라 **실행**으로 본다: 표식 없는 폴더로 ensureChrome 을 부른 뒤
     *    표식 파일이 생겼는지 확인한다.
     */
    const SESS28 = await import('./lib/chatgpt-session.mjs')
    const blank = path.join(T, 'blank')
    fs.mkdirSync(blank, { recursive: true, mode: 0o700 })
    let spawned = 0
    const r = await SESS28.ensureChrome({
      waitMs: 60, pollMs: 20, profileDir: blank, processes: () => '',
      browserCheck: () => true, cdpCheck: async () => false,
      spawnFn: () => { spawned += 1; return { unref() {} } },
    })
    check('🔴 ㉘ 자동 실행은 표식 없는 폴더에서 멈춘다', r.ok === false, `${r.reason} — ${r.why}`)
    check('🔴 ㉘ 그리고 표식을 만들지 않았다', !fs.existsSync(AP28.markerPath(blank)), '표식이 생겼다')
    check('🔴 ㉘ spawn 0회', spawned === 0, `${spawned}회`)

    /** 🔴 포트 주인이 남이면 재사용하지 않는다 */
    const foreign = AP28.judgeAutomationProfile({
      profileDir: AP28.AUTOMATION_PROFILE_DIR, port: AP28.AUTOMATION_CDP_PORT, mode: 'login',
      marker: { schemaVersion: 1, purpose: 'soransoran-chatgpt-automation', cdpPort: AP28.AUTOMATION_CDP_PORT },
      markerMode: 0o600, dirMode: 0o700,
      commandLines: ['/usr/bin/other --user-data-dir=/tmp/x --remote-debugging-port=9344'],
      pages: [{ type: 'page', url: 'https://chatgpt.com/' }], portInUse: true, requireRunning: true,
    })
    check('🔴 ㉘ 로그인에서도 포트 주인이 남이면 막는다',
      foreign.ok === false && /다른 프로세스/.test(foreign.why), foreign.why)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉙ 실제 fetchBatch — 보낸 뒤 실패해도 기록을 덮지 않는다')
{
  /**
   * 🔴 **`fetchManuscript` 만 시험하면 그 사이가 비어 있다** (변이로 확인).
   *    선기록을 "실패 성격" 으로 덮어쓰도록 바꿔도 아무 검사가 깨지지 않았다 —
   *    `fetchSlug` 의 장부 처리를 **아무도 실행하지 않았기 때문**이다.
   *    여기서는 실제 `fetchBatch` 를 가짜 브라우저로 끝까지 태운다.
   */
  const WEBUI9 = await import('./magazine-webui-runner.mjs')
  const QN9 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-batch-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const LEDGER = path.join(T, 'q.json')
    const DATE = '2026-09-28'
    const mk = (slug) => {
      fs.mkdirSync(path.join(D, slug), { recursive: true })
      fs.writeFileSync(path.join(D, slug, 'brief.md'), '# brief\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n')
      fs.writeFileSync(path.join(D, slug, 'review.ts'), '#\n')
    }
    for (const s of ['b-a', 'b-b']) mk(s)
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', selected: [], reusable: [{ slug: 'b-a' }, { slug: 'b-b' }] }))

    /** 보낸 뒤 응답 대기에서 터지는 가짜 브라우저 */
    const world = { sendClicks: 0 }
    const makePage = () => {
      let typed = ''
      const page = {
        async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
        async waitForFunction() { throw new Error('waitForFunction: Timeout') },
        async evaluate() { return '---\n본문\n[CTA]' },
        async evaluateHandle() { return { asElement: () => ({ async setInputFiles() {} }) } },
        locator(sel) {
          const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
          const l = {
            async click() { if (isSend) world.sendClicks += 1 },
            async innerText() { return typed },
            async setInputFiles() {},
          }
          return { first: () => l, async all() { return [l] }, ...l }
        },
        keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
      }
      return page
    }
    const browserDeps = { ...FAST_FETCH,
      ensureTab: async () => ({ ok: true }),
      connect: async () => ({
        contexts: () => [{ pages: () => [], newPage: async () => adaptPage(makePage()) }],
        async close() {},
      }),
    }

    const live = await WEBUI9.fetchBatch({
      date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: LEDGER,
      resultPath: path.join(T, 'r.json'), probeFn: async () => ({ status: 'ok' }), browserDeps,
    })
    check('  ㉙ 실제로 두 건을 보냈다', world.sendClicks === 2, `${world.sendClicks}회`)
    check('  ㉙ 둘 다 실패로 끝났다',
      (live.results ?? []).filter((r) => r.status === 'failed').length === 2,
      JSON.stringify((live.results ?? []).map((r) => `${r.slug}:${r.status}:${r.reason}`)))

    /** 🔴 보낸 뒤 실패했으므로 기록이 **그대로** 남아야 한다 */
    for (const slug of ['b-a', 'b-b']) {
      const row = QN9.readQuarantine(LEDGER).store[slug]
      check(`🔴 ㉙ [${slug}] 선기록이 덮이지 않았다 (DELIVERY_UNCERTAIN)`,
        row?.delivery?.kind === 'DELIVERY_UNCERTAIN', JSON.stringify(row?.delivery ?? null))
      check(`  ㉙ [${slug}] attempts 소비 0`, (row?.attempts ?? 0) === 0, `attempts ${row?.attempts}`)
    }

    /** 🔴 그래서 다음 회차는 둘 다 안 보낸다 */
    const p2 = (await WEBUI9.fetchBatch({
      date: DATE, dryRun: true, limit: 0, draftsDir: D, quarantinePath: LEDGER,
      resultPath: path.join(T, 'r2.json'),
    })).planned ?? []
    check('🔴 ㉙ 다음 회차 전송 예정 0건',
      p2.filter((x) => x.action === 'fetch').length === 0,
      JSON.stringify(p2.map((x) => `${x.slug}:${x.action}`)))

    /**
     * 🔴 **가장 해로운 경우: send 클릭 자체가 터진다.**
     *    그때 `sent` 는 `false` 로 온다 — 눌렀는지 알 수 없는데도 그렇다.
     *    선기록을 그 값으로 덮으면 INFRA 가 되어 **HOLD 가 풀리고 다시 보낸다.**
     *    (이 경우를 안 보면 "덮어쓰기" 변이가 통과한다 — 다른 경로는 분류가 같아서다.)
     */
    const LEDGER3 = path.join(T, 'q3.json')
    let clicks3 = 0
    await WEBUI9.fetchBatch({
      date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: LEDGER3,
      resultPath: path.join(T, 'r5.json'), probeFn: async () => ({ status: 'ok' }),
      browserDeps: { ...FAST_FETCH,
        ensureTab: async () => ({ ok: true }),
        connect: async () => ({
          contexts: () => [{
            pages: () => [],
            newPage: async () => adaptPage(await (async () => {
              const p = makePage()
              const loc = p.locator.bind(p)
              p.locator = (sel) => {
                const l = loc(sel)
                if (!/send-button|보내기|Send/.test(String(sel ?? ''))) return l
                return { ...l, first: () => ({ ...l.first(),
                  async click() { clicks3 += 1; throw new Error('click: element is not visible') } }) }
              }
              return p
            })()),
          }],
          async close() {},
        }),
      },
    })
    check('  ㉙ send 클릭이 실제로 시도됐다', clicks3 >= 1, `${clicks3}회`)
    const row3 = QN9.readQuarantine(LEDGER3).store['b-a']
    check('🔴 ㉙ send 가 터져도 HOLD 를 유지한다 (sent=false 로 덮지 않는다)',
      row3?.delivery?.kind === 'DELIVERY_UNCERTAIN', JSON.stringify(row3?.delivery ?? null))
    const p4 = (await WEBUI9.fetchBatch({
      date: DATE, dryRun: true, limit: 0, draftsDir: D, quarantinePath: LEDGER3,
      resultPath: path.join(T, 'r6.json'),
    })).planned ?? []
    check('🔴 ㉙ 그래서 다음 회차도 보내지 않는다',
      p4.filter((x) => x.action === 'fetch').length === 0, JSON.stringify(p4.map((x) => x.action)))

    /**
     * 🔴 **죽은 게이트가 아니다** — 보내기 **전에** 실패하면 기록이 남지 않아야 한다.
     *    (그때는 안 보낸 것이 확실하므로 막을 이유가 없다.)
     */
    const LEDGER2 = path.join(T, 'q2.json')
    let sends2 = 0
    const before = await WEBUI9.fetchBatch({
      date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: LEDGER2,
      resultPath: path.join(T, 'r3.json'), probeFn: async () => ({ status: 'ok' }),
      browserDeps: { ...FAST_FETCH,
        ensureTab: async () => ({ ok: true }),
        connect: async () => ({
          contexts: () => [{
            pages: () => [],
            newPage: async () => adaptPage(await (async () => {
              const p = makePage()
              // composer 를 못 찾아 보내기 전에 끝난다
              p.waitForSelector = async () => { throw new Error('page.waitForSelector: Timeout 60000ms exceeded.') }
              const loc = p.locator.bind(p)
              p.locator = (sel) => {
                const l = loc(sel)
                if (!/send-button|보내기|Send/.test(String(sel ?? ''))) return l
                return { ...l, first: () => ({ ...l.first(), async click() { sends2 += 1 } }) }
              }
              return p
            })()),
          }],
          async close() {},
        }),
      },
    })
    void before
    check('  ㉙ 보내기 전 실패 — send 0회', sends2 === 0, `${sends2}회`)
    const rowBefore = QN9.readQuarantine(LEDGER2).store['b-a']
    check('🔴 ㉙ 보내기 전 실패는 DELIVERY_UNCERTAIN 이 아니다',
      rowBefore?.delivery?.kind !== 'DELIVERY_UNCERTAIN', JSON.stringify(rowBefore?.delivery ?? null))
    const p3 = (await WEBUI9.fetchBatch({
      date: DATE, dryRun: true, limit: 0, draftsDir: D, quarantinePath: LEDGER2,
      resultPath: path.join(T, 'r4.json'),
    })).planned ?? []
    check('🔴 ㉙ 그래서 다시 보낼 수 있다',
      p3.filter((x) => x.action === 'fetch').length === 2, JSON.stringify(p3.map((x) => x.action)))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

/**
 * 🔴 **시험용 fixture 모듈을 만든다** — CLI 자식이 `SORAN_MAGAZINE_TEST_FIXTURE` 로 읽는다.
 *    모든 fixture 는 **가짜 spawn 을 반드시 가진다.** 주입 경로가 망가져도(변이 포함)
 *    실제 Chrome 이 뜨지 않게 하기 위해서다.
 */
const writeFixture = (file, body) => { fs.writeFileSync(file, body); return file }
const fixtureHead = (log) => `import fs from 'node:fs'
${adaptPage.toString()}
const LOG = ${JSON.stringify(log)}
const rec = (ev, extra = {}) => fs.appendFileSync(LOG, JSON.stringify({ ev, pid: process.pid, ...extra }) + '\\n')
export const spawn = (cmd, args) => { rec('spawn', { cmd, args }); return { unref() {} } }
`
const readEvents = (log) => (fs.existsSync(log)
  ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const countEv = (log, ev) => readEvents(log).filter((e) => e.ev === ev).length
/** 🔴 실제 Chrome 이 이 임시 폴더를 쓰고 있는가 — 명령줄로 본다 */
const chromeUsing = (dir) => spawnSyncTop('ps', ['-Ao', 'command='])
  .split('\n').filter((l) => /Chrome/.test(l) && l.includes(dir)).length

console.log('\n㉚ --login 만 표식을 만든다 (실제 CLI · 실제 Chrome 없음 · 환경 독립)')
{
  /**
   * 🔴 **`ensureAutomationProfile` 을 직접 부르는 시험만으로는 부족하다** (변이로 확인).
   *    `login()` 에서 그 호출을 빼도 아무 검사가 깨지지 않았다. 그래서 실제 CLI 를 돌린다.
   *
   * 🔴 **앞판은 실제 환경을 읽었다** (2026-09-28 · P0-2).
   *    Linux CI 에는 macOS Chrome 경로가 없어 표식 전에 `BROWSER_MISSING` 으로 끝났고,
   *    로컬에서 9344 가 비어 있으면 **실제 Chrome 을 띄웠다.**
   *    이제 브라우저 판정·spawn 은 `SORAN_MAGAZINE_TEST_MODE=1` 의 fixture 가 준다.
   *    실제 경로·실제 포트를 한 번도 보지 않으므로 macOS·Linux 결과가 같다.
   */
  const { spawnSync } = await import('node:child_process')
  const AP30 = await import('./lib/chatgpt-automation-profile.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-login-'))
  try {
    const markerIn = (home) => path.join(home, 'Library', 'Application Support',
      'soransoran-chatgpt-auto', AP30.MARKER_FILE)
    const LOG = path.join(T, 'events.jsonl')
    const FX = writeFixture(path.join(T, 'fx-login.mjs'), `${fixtureHead(LOG)}
export const browserAvailable = () => { rec('browserAvailable'); return true }
export const cdpAvailable = async () => { rec('cdpAvailable'); return false }
export const profileInUse = () => false
`)
    /**
     * 🔴 **Linux 조건 재현** — macOS Chrome 절대경로가 없고 9344 에 아무도 없다.
     *    preload 가 `existsSync(Chrome 경로)` 를 false 로, 9344 로 가는 fetch 를 거부로 바꾼다.
     *    이 조건에서 **옛 방식(주입 없음)** 은 표식 전에 멈추고, 주입판은 macOS 와 같은 결과를 낸다.
     */
    const LINUX = writeFixture(path.join(T, 'linux-preload.mjs'), `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const real = fs.existsSync
fs.existsSync = (p) => (String(p).startsWith('/Applications/Google Chrome.app') ? false : real(p))
syncBuiltinESMExports()
const realFetch = globalThis.fetch
globalThis.fetch = (u, o) => (/:9344\\//.test(String(u)) ? Promise.reject(new Error('ECONNREFUSED 9344')) : realFetch(u, o))
`)
    const runLogin = (home, env, { linux = false } = {}) => spawnSync(process.execPath,
      [...(linux ? ['--import', LINUX] : []), 'scripts/magazine-webui-runner.mjs', '--login'],
      { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: home, ...env } })
    const TEST = { SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_TEST_FIXTURE: FX }

    const chromeBefore = chromeUsing(T)
    check('  ㉚ 시작 전에는 표식이 없다', !fs.existsSync(markerIn(T)), '이미 있다')

    // ── macOS 그대로 ──
    const r = runLogin(T, TEST)
    check('🔴 ㉚ --login 이 표식을 실제로 만든다', fs.existsSync(markerIn(T)),
      `${r.status} · ${String(r.stderr || r.stdout).slice(0, 160)}`)
    if (fs.existsSync(markerIn(T))) {
      const body = JSON.parse(fs.readFileSync(markerIn(T), 'utf8'))
      check('  ㉚ 표식 내용이 계약대로다',
        body.schemaVersion === 1 && body.purpose === 'soransoran-chatgpt-automation' && body.cdpPort === 9344,
        JSON.stringify(body))
      check('🔴 ㉚ 표식 권한 0600', (fs.statSync(markerIn(T)).mode & 0o777) === 0o600,
        (fs.statSync(markerIn(T)).mode & 0o777).toString(8))
    }
    const spawns = readEvents(LOG).filter((e) => e.ev === 'spawn')
    check('🔴 ㉚ 기동은 주입된 spawn 으로만 — 정확한 폴더 · 9344',
      spawns.length === 1
        && spawns[0].args.includes(`--user-data-dir=${path.dirname(markerIn(T))}`)
        && spawns[0].args.includes('--remote-debugging-port=9344'),
      JSON.stringify(spawns.map((s) => s.args.slice(0, 2))))
    check('🔴 ㉚ 로컬 9344 가 실제로 살아 있어도 그 포트를 읽지 않는다 (fixture 판정만)',
      countEv(LOG, 'cdpAvailable') === 1 && r.status === 0, `exit ${r.status}`)

    // ── Linux 조건 재현 ──
    const TL = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-login-linux-'))
    const TO = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-login-old-'))
    try {
      const LOGL = path.join(TL, 'events.jsonl')
      const FXL = writeFixture(path.join(TL, 'fx.mjs'), fs.readFileSync(FX, 'utf8').replace(JSON.stringify(LOG), JSON.stringify(LOGL)))
      const rl = runLogin(TL, { SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_TEST_FIXTURE: FXL }, { linux: true })
      check('🔴 ㉚ [Linux 재현] 주입판은 macOS 와 같은 결과 — 표식 생성 · spawn 1 · exit 0',
        fs.existsSync(markerIn(TL)) && countEv(LOGL, 'spawn') === 1 && rl.status === 0,
        `exit ${rl.status} · spawn ${countEv(LOGL, 'spawn')} · ${String(rl.stderr).slice(0, 120)}`)
      /** 🔴 옛 방식 반례 — 같은 Linux 조건에서 주입 없이 돌리면 표식 전에 멈춘다 (앞판 CI 실패의 재현) */
      const ro = runLogin(TO, {}, { linux: true })
      check('  ㉚ [Linux 재현] 주입 없는 옛 방식은 표식 전에 BROWSER_MISSING 으로 끝난다',
        ro.status === 1 && !fs.existsSync(markerIn(TO)) && /Chrome 을 찾지 못했다/.test(`${ro.stderr}${ro.stdout}`),
        `exit ${ro.status} · ${String(ro.stderr).trim().slice(0, 100)}`)
    } finally {
      fs.rmSync(TL, { recursive: true, force: true })
      fs.rmSync(TO, { recursive: true, force: true })
    }

    /** 🔴 fixture 가 자리를 빠뜨려도 **운영 함수로 떨어지지 않는다** — 거부 stub 이 막는다 */
    const TN = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-login-noinj-'))
    try {
      const LOGN = path.join(TN, 'events.jsonl')
      const FXN = writeFixture(path.join(TN, 'fx.mjs'), `${fixtureHead(LOGN)}
export const cdpAvailable = async () => false
export const profileInUse = () => false
`)
      const rn = runLogin(TN, { SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_TEST_FIXTURE: FXN })
      check('🔴 ㉚ 시험 모드에서 browserAvailable 을 안 주면 실제 경로를 읽지 않고 멈춘다',
        rn.status !== 0 && /TEST_MODE_NOT_INJECTED/.test(`${rn.stderr}${rn.stdout}`) && countEv(LOGN, 'spawn') === 0,
        `exit ${rn.status} · spawn ${countEv(LOGN, 'spawn')}`)
    } finally { fs.rmSync(TN, { recursive: true, force: true }) }

    /** 🔴 운영 모드에서 주입값이 보이면 **첫 read/write 전에** 멈춘다 */
    const TB = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-login-blocked-'))
    try {
      const LOGB = path.join(TB, 'events.jsonl')
      const FXB = writeFixture(path.join(TB, 'fx.mjs'), fs.readFileSync(FX, 'utf8').replace(JSON.stringify(LOG), JSON.stringify(LOGB)))
      const rb = runLogin(TB, { SORAN_MAGAZINE_TEST_FIXTURE: FXB })
      check('🔴 ㉚ 운영 모드 + 시험 주입 → exit 2 · TEST_INJECTION_BLOCKED',
        rb.status === 2 && /TEST_INJECTION_BLOCKED/.test(`${rb.stderr}${rb.stdout}`), `exit ${rb.status}`)
      check('🔴 ㉚ 그때 표식·spawn·fixture 호출 0',
        !fs.existsSync(markerIn(TB)) && readEvents(LOGB).length === 0, JSON.stringify(readEvents(LOGB)))
      const rb2 = spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', '--fetch-run', '--dry-run'],
        { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: TB, SORAN_MAGAZINE_TEST_FIXTURE: FXB } })
      check('  ㉚ 다른 명령도 같다 (--fetch-run --dry-run → exit 2)', rb2.status === 2, `exit ${rb2.status}`)
      const H = await import('./lib/magazine-test-harness.mjs')
      const h1 = H.resolveTestHarness({ SORAN_MAGAZINE_TEST_FIXTURE: '/x.mjs' })
      const h2 = H.resolveTestHarness({ SORAN_MAGAZINE_TEST_FIXTURE: '/x.mjs', SORAN_MAGAZINE_TEST_MODE: '1' })
      const h3 = await H.loadTestHarness({})
      check('  ㉚ 판정표 — 운영+주입 차단 · 시험+주입 허용 · 운영 무주입은 빈 의존성',
        h1.ok === false && h2.ok === true && h2.test === true && h3.ok && Object.keys(h3.deps).length === 0,
        JSON.stringify({ h1: h1.code, h2: h2.ok, h3: Object.keys(h3.deps ?? {}).length }))
    } finally { fs.rmSync(TB, { recursive: true, force: true }) }

    /** 🔴 자동 실행은 같은 조건에서 표식을 만들지 않는다 */
    const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cli-auto-'))
    try {
      const auto = spawnSync(process.execPath,
        ['scripts/magazine-webui-runner.mjs', '--fetch-run', '--dry-run'],
        { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T2, ...TEST } })
      check('🔴 ㉚ 자동 실행은 표식을 만들지 않는다', !fs.existsSync(markerIn(T2)) && auto.status === 0,
        `exit ${auto.status}`)
    } finally { fs.rmSync(T2, { recursive: true, force: true }) }

    check('🔴 ㉚ 이 시험 전체에서 실제 Chrome 이 임시 폴더로 뜨지 않았다',
      chromeUsing(T) === 0 && chromeBefore === 0, `${chromeBefore} → ${chromeUsing(T)}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉛ 재생성 회수도 같은 지문 HOLD 를 지난다 (실제 CLI 2회 orchestration)')
{
  /**
   * 🔴 **앞판의 구멍** (2026-09-28 · P0-1).
   *    `fetchBatch` 만 장부 지문을 봤다. `--fetch --force --regen-packet`(`fetchOne`) 은
   *    probe 부터 하고 곧장 보냈다 — 재생성 요청이 응답 대기에서 끊긴 뒤 다시 실행되면
   *    **같은 글자를 두 번째로 보냈다.**
   *
   *    여기서는 실제 `attemptRegeneration` → 실제 `webuiRegenRunner` → **실제 CLI 자식**
   *    (`--fetch <slug> --force --regen-packet <경로> --result-json <경로>`) 을 두 번 돌린다.
   *    브라우저만 fixture 로 바꾼다 — 보내고 나서 응답 대기에서 터진다.
   */
  const { spawnSync } = await import('node:child_process')
  const AR31 = await import('./magazine-auto-register.mjs')
  const RG31 = await import('./lib/magazine-regen.mjs')
  const QN31 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-regen-twice-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const LEDGER = path.join(T, 'ledger.json')
    const LOG = path.join(T, 'events.jsonl')
    const PK = path.join(T, 'packets')
    const mk = (slug) => {
      fs.mkdirSync(path.join(D, slug), { recursive: true })
      fs.writeFileSync(path.join(D, slug, 'brief.md'), `# ${slug}\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n`)
      fs.writeFileSync(path.join(D, slug, 'review.ts'), '#\n')
    }
    for (const s of ['rg-a', 'rg-b']) mk(s)
    const FX = writeFixture(path.join(T, 'fx-regen.mjs'), `${fixtureHead(LOG)}
export const quarantinePath = ${JSON.stringify(LEDGER)}
export const probe = async () => { rec('probe'); return { status: 'ok' } }
export const ensureTab = async () => { rec('ensureTab'); return { ok: true } }
export const connect = async () => {
  rec('connect')
  return { contexts: () => [{ pages: () => [], newPage: async () => adaptPage(makePage()) }], async close() {} }
}
function makePage() {
  let typed = ''
  return {
    async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
    // 🔴 보낸 뒤 응답 대기에서 터진다 — response_timeout · sent=true
    async waitForFunction() { throw new Error('waitForFunction: Timeout 300000ms exceeded') },
    async evaluate() { return '' },
    locator(sel) {
      const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
      const l = { async click() { if (isSend) rec('send', { len: typed.length }) }, async innerText() { return typed } }
      return { first: () => l, ...l }
    },
    keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
  }
}
`)
    const ENV = { HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX }
    /** 운영 `run()` 과 같은 모양 — 실제 자식 프로세스를 띄운다. 환경만 시험용이다 */
    const runFn = (file, args) => {
      const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, ...ENV } })
      return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
    }
    const regen = (slug, failures = [{ code: 'QA_FAIL', label: 'magazine QA FAIL' }]) => RG31.attemptRegeneration({
      slug, profile: 'MEDICAL', failures, quarantinePath: LEDGER, packetDir: PK,
      runner: (ctx) => AR31.webuiRegenRunner(ctx, { runFn, resultDir: T }),
    })
    const row = (slug) => QN31.readQuarantine(LEDGER).store[slug] ?? {}
    const ev = () => ({ probe: countEv(LOG, 'probe'), connect: countEv(LOG, 'connect'), send: countEv(LOG, 'send'), spawn: countEv(LOG, 'spawn') })

    // ── 1회차: 보냈는데 응답을 못 받았다 ──
    const r1 = regen('rg-a')
    const e1 = ev()
    const fpA = row('rg-a').delivery?.messageFingerprint
    check('  ㉛ 1회차 — 실제로 1건 보냈다', e1.send === 1 && e1.probe === 1, JSON.stringify(e1))
    check('  ㉛ 1회차 — 전송불명으로 분류된다', r1.code === 'REGEN_DELIVERY_UNCERTAIN', `${r1.code} — ${r1.why}`.slice(0, 160))
    check('🔴 ㉛ 1회차 — 장부에 slug+지문 DELIVERY_UNCERTAIN',
      row('rg-a').delivery?.kind === 'DELIVERY_UNCERTAIN' && /^sha256:/.test(fpA ?? ''), JSON.stringify(row('rg-a').delivery ?? null))
    check('  ㉛ 1회차 — regenCalls 0 · attempts 0', (row('rg-a').regenCalls ?? 0) === 0 && (row('rg-a').attempts ?? 0) === 0,
      `regen ${row('rg-a').regenCalls} · attempts ${row('rg-a').attempts}`)

    /** 🔴 날짜·runId 가 바뀌어도 판정에 들어가지 않는다 — 장부 행의 출처 기록만 바꿔 본다 */
    QN31.updateQuarantine((cur) => ({ ...cur, 'rg-a': { ...cur['rg-a'], delivery: { ...cur['rg-a'].delivery, date: '2026-10-05', runId: 'other-run' } } }), LEDGER)
    const deliveryBefore = JSON.stringify(row('rg-a').delivery)
    const sentBefore = row('rg-a').sent

    // ── 2회차: 같은 재생성 요청 · 새 프로세스(재시작) · 다른 날짜 ──
    const r2 = regen('rg-a')
    const e2 = ev()
    check('🔴 ㉛ 2회차 — send 0 (중복 전송 없음)', e2.send === e1.send, `${e1.send} → ${e2.send}`)
    check('🔴 ㉛ 2회차 — 브라우저 접근 0 (probe·connect·Chrome 기동 없음)',
      e2.probe === e1.probe && e2.connect === e1.connect && e2.spawn === 0, JSON.stringify(e2))
    check('🔴 ㉛ 2회차 — HOLD 로 끝난다', r2.code === 'REGEN_DELIVERY_HOLD' && r2.held === true && r2.sent === false,
      `${r2.code} — ${String(r2.why).slice(0, 120)}`)
    check('🔴 ㉛ 2회차 — regenCalls 0 · attempts 0 유지', (row('rg-a').regenCalls ?? 0) === 0 && (row('rg-a').attempts ?? 0) === 0,
      `regen ${row('rg-a').regenCalls} · attempts ${row('rg-a').attempts}`)
    check('🔴 ㉛ 2회차 — 앞선 전송 기록·sent 를 덮지 않는다',
      JSON.stringify(row('rg-a').delivery) === deliveryBefore && row('rg-a').sent === sentBefore,
      `sent ${sentBefore} → ${row('rg-a').sent}`)
    check('  ㉛ 2회차 — 판정한 지문이 1회차 지문과 같다', r2.messageFingerprint === fpA, `${r2.messageFingerprint}`)
    check('  ㉛ 패킷이 남지 않는다', RG31.packetsLeftFor('rg-a', PK).length === 0, RG31.packetsLeftFor('rg-a', PK).join(',') || '0건')

    /** 🔴 다른 후보는 계속 처리된다 */
    const rb = regen('rg-b')
    check('🔴 ㉛ 다른 후보(rg-b)는 그대로 보낸다', ev().send === e2.send + 1 && rb.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${rb.code} · send ${ev().send}`)

    // ── fetchOne 구조화 결과 (요구 7) ──
    const MANUAL_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538'
    const PKT = RG31.writePacket(RG31.buildFailurePacket({ slug: 'rg-a', profile: 'MEDICAL',
      failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL' }], attempt: 1, attemptId: MANUAL_ID }),
    RG31.packetPathFor('rg-a', path.join(T, 'manual'), MANUAL_ID))
    const RJ = path.join(T, 'one.json')
    const before7 = ev()
    const c7 = runFn('scripts/magazine-webui-runner.mjs', ['--fetch', 'rg-a', '--force', '--regen-packet', PKT, '--result-json', RJ])
    const body7 = JSON.parse(fs.readFileSync(RJ, 'utf8'))
    const row7 = body7.results?.[0] ?? {}
    check('🔴 ㉛ fetchOne 결과 — held · 사유 · 지문 · sent=false · 앞선 기록',
      c7.code === 1 && row7.status === 'held' && row7.reason === QN31.DELIVERY_HOLD_REASON
        && row7.sent === false && row7.messageFingerprint === fpA
        && row7.prior?.kind === 'DELIVERY_UNCERTAIN' && row7.prior?.messageFingerprint === fpA && body7.sentTotal === 0,
      JSON.stringify({ exit: c7.code, status: row7.status, reason: row7.reason, sent: row7.sent, prior: row7.prior?.kind }))
    check('  ㉛ 그 실행도 브라우저 접근 0', JSON.stringify(ev()) === JSON.stringify(before7), JSON.stringify(ev()))

    // ── 달라진 글자만 다시 열린다 ──
    const r3 = regen('rg-a', [{ code: 'MED_DOSAGE', label: '용량 단정', sentence: '하루 두 알' }])
    check('🔴 ㉛ 재생성 지시가 바뀌면(지문 다름) 다시 보낸다', ev().send === before7.send + 1 && r3.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${r3.code} · send ${ev().send}`)
    fs.appendFileSync(path.join(D, 'rg-a', 'brief.md'), '\n## 추가 지시\n- 한 줄 더\n')
    const s4 = ev().send
    const r4 = regen('rg-a')
    check('🔴 ㉛ brief 가 바뀌면(지문 다름) 다시 보낸다', ev().send === s4 + 1 && r4.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${r4.code} · send ${ev().send}`)
    check('  ㉛ 이 시험은 Chrome 을 한 번도 띄우지 않았다', countEv(LOG, 'spawn') === 0, `${countEv(LOG, 'spawn')}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉜ 전송 직전 재판정 — 다른 프로세스가 먼저 보냈거나 장부를 못 쓰면 누르지 않는다')
{
  /**
   * 🔴 계획표 판정과 send 사이에 다른 프로세스가 **같은 글자**를 보냈을 수 있다.
   *    `recordBeforeSend` 가 같은 읽기-수정-쓰기 안에서 다시 판정하는지 실제 `fetchBatch` 로 본다.
   *    🔴 장부를 못 읽는 경우 `updateQuarantine` 은 **예외가 아니라 `ok:false`** 로 돌아온다 —
   *       앞판은 이 반환값을 보지 않아 "적었다" 로 읽고 눌렀다.
   */
  const WEBUI32 = await import('./magazine-webui-runner.mjs')
  const QN32 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-late-hold-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const DATE = '2026-09-28'
    fs.mkdirSync(path.join(D, 'lh-a'), { recursive: true })
    fs.writeFileSync(path.join(D, 'lh-a', 'brief.md'), '# brief\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n')
    fs.writeFileSync(path.join(D, 'lh-a', 'review.ts'), '#\n')
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', selected: [], reusable: [{ slug: 'lh-a' }] }))

    const deps = (onTyped, world) => ({ ...FAST_FETCH,
      ensureTab: async () => ({ ok: true }),
      connect: async () => ({
        contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
          let typed = ''
          return {
            async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
            async waitForFunction() { throw new Error('Timeout') }, async evaluate() { return '' },
            locator(sel) {
              const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
              const l = { async click() { if (isSend) world.send += 1 }, async innerText() { return typed } }
              return { first: () => l, ...l }
            },
            keyboard: { async insertText(t) { typed += String(t ?? ''); onTyped(typed) }, async press() {} },
          }
        })()) }],
        async close() {},
      }),
    })

    // ① 다른 프로세스가 같은 글자를 먼저 보냈다
    const L1 = path.join(T, 'q1.json')
    const w1 = { send: 0 }
    const b1 = await WEBUI32.fetchBatch({
      date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: L1, resultPath: path.join(T, 'r1.json'),
      probeFn: async () => ({ status: 'ok' }),
      browserDeps: deps((typed) => QN32.updateQuarantine((cur) => ({ ...cur, 'lh-a': QN32.recordDelivery(cur['lh-a'], {
        sent: null, messageFingerprint: QN32.deliveryFingerprintOf(typed), kind: 'DELIVERY_UNCERTAIN',
        reason: 'sending', stage: 'send', now: Date.now(), date: DATE }) }), L1), w1),
    })
    const res1 = (b1.results ?? []).find((x) => x.slug === 'lh-a') ?? {}
    check('🔴 ㉜ 계획 뒤 다른 프로세스가 보냈으면 send 0', w1.send === 0, `send ${w1.send}`)
    check('🔴 ㉜ 그 결과는 held · stage=send · sent=false',
      res1.status === 'held' && res1.stage === 'send' && res1.sent === false, JSON.stringify(res1).slice(0, 160))

    // ② send 직전에 장부가 깨졌다
    const L2 = path.join(T, 'q2.json')
    const w2 = { send: 0 }
    const b2 = await WEBUI32.fetchBatch({
      date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: L2, resultPath: path.join(T, 'r2.json'),
      probeFn: async () => ({ status: 'ok' }),
      browserDeps: deps(() => fs.writeFileSync(L2, '{ 깨진'), w2),
    })
    const res2 = (b2.results ?? []).find((x) => x.slug === 'lh-a') ?? {}
    check('🔴 ㉜ send 직전 장부를 못 쓰면 누르지 않는다', w2.send === 0 && res2.sent === false,
      `send ${w2.send} · ${res2.reason} — ${String(res2.errorDetail).slice(0, 80)}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉝ 동시 2프로세스 — 같은 slug·같은 지문은 정확히 한 프로세스만 send 권한을 얻는다')
{
  /**
   * 🔴 **앞판은 장부에 프로세스 간 잠금이 없었다** (2026-09-28 · Codex P0).
   *    `updateQuarantine` 은 read → mutate → save 뿐이라, 두 프로세스가 동시에
   *    같은 slug·같은 지문을 들고 오면 **둘 다 "HOLD 없음" 을 읽고 둘 다 send 했다.**
   *
   *    여기서는 **실제 CLI 자식 2개**를 띄운다. preload 가 장부 `renameSync`(선기록 저장) 직전에
   *    barrier 를 건다 — 두 프로세스가 모두 그 지점에 올 때까지(최대 1.5초) 기다린다.
   *    잠금이 없으면 둘 다 판정을 마친 채 barrier 에 도착하고, 잠금이 있으면 한쪽은 잠금 앞에서
   *    기다리므로 barrier 에 오지 못한다.
   */
  const { spawn } = await import('node:child_process')
  const QN33 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-race-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    for (const s of ['cc-a', 'cc-b']) {
      fs.mkdirSync(path.join(D, s), { recursive: true })
      fs.writeFileSync(path.join(D, s, 'brief.md'), `# ${s}\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n`)
      fs.writeFileSync(path.join(D, s, 'review.ts'), '#\n')
    }
    /** 시나리오마다 새 장부·새 barrier */
    const scenario = async (name, slugs) => {
      const L = path.join(T, `${name}-ledger.json`)
      const LOG = path.join(T, `${name}-events.jsonl`)
      const BAR = path.join(T, `${name}-barrier`)
      fs.mkdirSync(BAR)
      const FX = writeFixture(path.join(T, `${name}-fx.mjs`), `${fixtureHead(LOG)}
export const quarantinePath = ${JSON.stringify(L)}
// 🔴 이 무대의 승자는 release 파일을 최대 60초 기다린다 — 응답 관찰 한도가 그보다 길어야 한다
export const fetchTiming = { pollMs: 5, stablePolls: 2, timeoutMs: 90000 }
export const probe = async () => { rec('probe'); return { status: 'ok' } }
export const ensureTab = async () => ({ ok: true })
export const connect = async () => ({
  contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
    let typed = ''
    return {
      async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
      async waitForFunction() { throw new Error('waitForFunction: Timeout 300000ms exceeded') },
      async evaluate() { return '' },
      locator(sel) {
        const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
        const l = { async click() { if (isSend) rec('send') }, async innerText() { return typed } }
        return { first: () => l, ...l }
      },
      keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
    }
  })()) }],
  async close() {},
})
`)
      const PRE = writeFixture(path.join(T, `${name}-barrier.mjs`), `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const LEDGER = ${JSON.stringify(L)}, DIR = ${JSON.stringify(BAR)}
const real = fs.renameSync
let first = true
fs.renameSync = (a, b) => {
  if (first && String(b) === LEDGER) {
    first = false
    fs.writeFileSync(DIR + '/' + process.pid, '')
    const until = Date.now() + 1500
    while (fs.readdirSync(DIR).length < 2 && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    fs.appendFileSync(DIR + '.log', JSON.stringify({ pid: process.pid, arrivals: fs.readdirSync(DIR).length }) + '\\n')
  }
  return real(a, b)
}
syncBuiltinESMExports()
`)
      const ENV = { HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX }
      const kids = await Promise.all(slugs.map((slug, i) => new Promise((ok) => {
        const RJ = path.join(T, `${name}-r${i}.json`)
        const c = spawn(process.execPath, ['--import', PRE, 'scripts/magazine-webui-runner.mjs', '--fetch', slug, '--result-json', RJ],
          { env: { ...process.env, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        c.stdout.on('data', (d) => { out += d }); c.stderr.on('data', (d) => { out += d })
        c.on('exit', (code) => ok({ pid: c.pid, code, out, slug,
          row: fs.existsSync(RJ) ? JSON.parse(fs.readFileSync(RJ, 'utf8')).results?.[0] ?? null : null }))
      })))
      const events = readEvents(LOG)
      const arrivals = fs.existsSync(`${BAR}.log`)
        ? fs.readFileSync(`${BAR}.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
      return { L, kids, events, arrivals, lockLeft: fs.existsSync(QN33.quarantineLockPath(L)) }
    }

    // ── 같은 slug · 같은 지문 ──
    const s1 = await scenario('same', ['cc-a', 'cc-a'])
    const sendsBy = (pid) => s1.events.filter((e) => e.ev === 'send' && e.pid === pid).length
    const winners = s1.kids.filter((k) => sendsBy(k.pid) === 1)
    const losers = s1.kids.filter((k) => sendsBy(k.pid) === 0)
    check('🔴 ㉝ 같은 slug·지문 — 브라우저 send 는 정확히 1회',
      s1.events.filter((e) => e.ev === 'send').length === 1,
      `send ${s1.events.filter((e) => e.ev === 'send').length} · barrier 도착 ${JSON.stringify(s1.arrivals.map((a) => a.arrivals))}`)
    check('🔴 ㉝ 권한을 얻은 프로세스는 하나 — 나머지 하나는 send 0',
      winners.length === 1 && losers.length === 1, `winners ${winners.length} · losers ${losers.length}`)
    const lr = losers[0]?.row ?? {}
    /**
     * 🔴 같은 slug 의 원고 작업은 lease 하나다 (2026-09-28 · Codex P0) — 일반+일반도 진 쪽은 **lease 에서**
     *    멈춘다. 앞판은 장부 예약에서 DELIVERY_UNCERTAIN_HOLD 로 멈췄지만, 그 전에 probe 까지 했다.
     */
    check('🔴 ㉝ 진 쪽은 status=held · MANUSCRIPT_IN_PROGRESS(lease) · sent=false · probe 0',
      lr.status === 'held' && lr.reason === QN33.MANUSCRIPT_IN_PROGRESS_REASON && lr.stage === 'lease' && lr.sent === false
        && s1.events.filter((e) => e.ev === 'probe' && e.pid === losers[0]?.pid).length === 0,
      JSON.stringify({ status: lr.status, reason: lr.reason, stage: lr.stage, sent: lr.sent }))
    const d1 = QN33.readQuarantine(s1.L).store['cc-a']?.delivery ?? {}
    check('  ㉝ 장부에는 이긴 쪽의 예약 하나 — DELIVERY_UNCERTAIN · 예약 ID 있음',
      d1.kind === 'DELIVERY_UNCERTAIN' && typeof d1.reservationId === 'string' && /^sha256:/.test(d1.messageFingerprint ?? ''),
      JSON.stringify({ kind: d1.kind, rid: !!d1.reservationId }))
    check('  ㉝ 잠금 파일이 남지 않는다', !s1.lockLeft, '남았다')

    // ── 서로 다른 slug — lost update ──
    const s2 = await scenario('diff', ['cc-a', 'cc-b'])
    const st2 = QN33.readQuarantine(s2.L).store
    check('🔴 ㉝ 다른 slug 동시 기록 — 두 행이 모두 남는다 (lost update 0)',
      st2['cc-a']?.delivery?.kind === 'DELIVERY_UNCERTAIN' && st2['cc-b']?.delivery?.kind === 'DELIVERY_UNCERTAIN',
      `남은 행 ${Object.keys(st2).join(',') || '없음'}`)
    check('  ㉝ 다른 slug 는 서로 막지 않는다 — 둘 다 보낸다', s2.events.filter((e) => e.ev === 'send').length === 2,
      `send ${s2.events.filter((e) => e.ev === 'send').length}`)

    // ── 살아 있는 잠금 — 시간 초과면 전송 금지 · 잠금을 건드리지 않는다 (실제 CLI) ──
    const L3 = path.join(T, 'held-ledger.json')
    const LOG3 = path.join(T, 'held-events.jsonl')
    const FX3 = writeFixture(path.join(T, 'held-fx.mjs'), fs.readFileSync(path.join(T, 'same-fx.mjs'), 'utf8')
      .replace(JSON.stringify(path.join(T, 'same-ledger.json')), JSON.stringify(L3))
      .replace(JSON.stringify(path.join(T, 'same-events.jsonl')), JSON.stringify(LOG3)))
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    const LK = QN33.quarantineLockPath(L3)
    const lockBody = JSON.stringify({ token: 'someone-else', pid: holder.pid, host: os.hostname(), at: new Date().toISOString() })
    fs.writeFileSync(LK, lockBody)
    try {
      const { spawnSync } = await import('node:child_process')
      const RJ3 = path.join(T, 'held-r.json')
      spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', '--fetch', 'cc-a', '--result-json', RJ3],
        { encoding: 'utf8', maxBuffer: 1e8,
          env: { ...process.env, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX3 } })
      const row3 = JSON.parse(fs.readFileSync(RJ3, 'utf8')).results?.[0] ?? {}
      check('🔴 ㉝ 살아 있는 잠금에 막혀 시간 초과 → send 0 · QUARANTINE_LOCK_TIMEOUT',
        countEv(LOG3, 'send') === 0 && row3.sent === false && /QUARANTINE_LOCK_TIMEOUT/.test(row3.errorDetail ?? ''),
        `send ${countEv(LOG3, 'send')} · ${row3.reason} — ${String(row3.errorDetail).slice(0, 90)}`)
      check('🔴 ㉝ 살아 있는 남의 잠금은 훔치거나 지우지 않는다', fs.existsSync(LK) && fs.readFileSync(LK, 'utf8') === lockBody, fs.existsSync(LK) ? '바뀌었다' : '지워졌다')
    } finally { holder.kill('SIGKILL'); fs.rmSync(LK, { force: true }) }
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉝-B 잠금 규약 — 판정 불가는 막고 · 죽은 주인만 거두고 · 내 잠금만 푼다')
{
  const QB = await import('./lib/magazine-quarantine.mjs')
  const { spawnSync, spawn } = await import('node:child_process')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-lock-'))
  try {
    const L = path.join(T, 'q.json')
    const LK = QB.quarantineLockPath(L)
    // 판정 불가 — 내용이 규약과 다르다
    fs.writeFileSync(LK, '{ 깨진')
    const u1 = QB.withQuarantineLock(L, () => 'ran', { waitMs: 200 })
    check('🔴 ㉝-B 잠금 상태 판정 불가 → 실패 · fn 미실행 · 잠금 그대로',
      u1.ok === false && u1.code === 'QUARANTINE_LOCK_TIMEOUT' && fs.existsSync(LK) && fs.readFileSync(LK, 'utf8') === '{ 깨진',
      `${u1.code} — ${String(u1.why).slice(0, 80)}`)
    fs.rmSync(LK)
    // 죽은 주인 — 확실히 없는 pid
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', env: { ...process.env, HOME: T } })
    fs.writeFileSync(LK, JSON.stringify({ token: 'dead-owner', pid: Number(dead.stdout), host: os.hostname(), at: 'x' }))
    const u2 = QB.updateQuarantine((cur) => ({ ...cur, a: { attempts: 0 } }), L)
    check('  ㉝-B 주인이 죽은 잠금은 거두고 진행한다 · 끝나면 잠금 0',
      u2.ok === true && !fs.existsSync(LK) && QB.readQuarantine(L).store.a, `${u2.ok} · ${u2.why ?? ''}`)
    // 살아 있는 주인
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      const body = JSON.stringify({ token: 'live-owner', pid: live.pid, host: os.hostname(), at: 'x' })
      fs.writeFileSync(LK, body)
      const u3 = QB.withQuarantineLock(L, () => 'ran', { waitMs: 200 })
      check('🔴 ㉝-B 살아 있는 잠금은 빼앗지 않는다 — 시간 초과 · 내용 그대로',
        u3.ok === false && fs.existsSync(LK) && fs.readFileSync(LK, 'utf8') === body, `${u3.code}`)
    } finally { live.kill('SIGKILL'); fs.rmSync(LK, { force: true }) }
    // 내 잠금만 푼다 — 임계구역 안에서 잠금 주인이 바뀌었다면 지우지 않는다
    const u4 = QB.withQuarantineLock(L, () => {
      fs.writeFileSync(LK, JSON.stringify({ token: 'intruder', pid: process.pid, host: os.hostname(), at: 'x' }))
      return 'ran'
    })
    check('🔴 ㉝-B 풀 때 토큰이 내 것이 아니면 지우지 않는다',
      u4.ok === true && fs.existsSync(LK) && JSON.parse(fs.readFileSync(LK, 'utf8')).token === 'intruder', '지웠다')
    fs.rmSync(LK, { force: true })
    // 장부 손상 — 잠금은 잡혀도 판정 불가
    fs.writeFileSync(L, '{ 깨진')
    const u5 = QB.updateQuarantine((cur) => cur, L)
    check('  ㉝-B 장부 손상 → ok:false (QUARANTINE_UNREADABLE) · 잠금 0',
      u5.ok === false && u5.code === 'QUARANTINE_UNREADABLE' && !fs.existsSync(LK), `${u5.code}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉞ 재생성 HOLD 경계에서 급사해도 regenCalls 0 · 재전송 0 (실제 자식 SIGKILL)')
{
  /**
   * 🔴 **앞판의 crash window** (2026-09-28 · Codex P1).
   *    packet 을 쓰고 regenCalls 를 올린 뒤 runner 를 불렀고, runner 가 HOLD 를 돌려준 뒤에야
   *    되돌렸다. 그 사이 죽으면 전송 0건인데 regenCalls=1 이 남았다.
   *
   *    여기서는 실제 재생성 driver(실제 `attemptRegeneration` + 실제 `webuiRegenRunner` + 실제 CLI)를
   *    **자식 프로세스**로 띄운다. runner 가 CLI 를 띄우는 순간(= 앞판의 HOLD 경계)을
   *    fixture 적재 신호로 잡아 프로세스 그룹째 SIGKILL 하고, 여러 시점의 SIGKILL 도 훑는다.
   */
  const { spawn, spawnSync } = await import('node:child_process')
  const QN34 = await import('./lib/magazine-quarantine.mjs')
  const RG34 = await import('./lib/magazine-regen.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-regen-kill-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const SLUG = 'ck-a'
    fs.mkdirSync(path.join(D, SLUG), { recursive: true })
    fs.writeFileSync(path.join(D, SLUG, 'brief.md'), `# ${SLUG}\n\n## 반드시 그대로 넣을 문장\n1. 문장 하나\n`)
    fs.writeFileSync(path.join(D, SLUG, 'review.ts'), '#\n')
    const L = path.join(T, 'ledger.json')
    const LOG = path.join(T, 'events.jsonl')
    const PK = path.join(T, 'packets')
    const FX = writeFixture(path.join(T, 'fx.mjs'), `${fixtureHead(LOG)}
rec('load')
export const quarantinePath = ${JSON.stringify(L)}
export const probe = async () => { rec('probe'); return { status: 'ok' } }
export const ensureTab = async () => ({ ok: true })
export const connect = async () => ({
  contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
    let typed = ''
    return {
      async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
      async waitForFunction() { throw new Error('waitForFunction: Timeout 300000ms exceeded') },
      async evaluate() { return '' },
      locator(sel) {
        const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
        const l = { async click() { if (isSend) rec('send') }, async innerText() { return typed } }
        return { first: () => l, ...l }
      },
      keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
    }
  })()) }],
  async close() {},
})
`)
    const ENV = { HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX }
    const url = (f) => JSON.stringify(new URL(`file://${path.resolve(f)}`).href)
    const DRV = writeFixture(path.join(T, 'driver.mjs'), `import { spawnSync } from 'node:child_process'
import { attemptRegeneration } from ${url('scripts/lib/magazine-regen.mjs')}
import { webuiRegenRunner } from ${url('scripts/magazine-auto-register.mjs')}
const runFn = (file, args) => {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', maxBuffer: 1e8, env: process.env })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
}
const r = attemptRegeneration({ slug: ${JSON.stringify(SLUG)}, profile: 'MEDICAL',
  failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL' }],
  quarantinePath: ${JSON.stringify(L)}, packetDir: ${JSON.stringify(PK)}, draftsDir: ${JSON.stringify(D)},
  runner: (ctx) => webuiRegenRunner(ctx, { runFn, resultDir: ${JSON.stringify(T)} }) })
process.stdout.write(JSON.stringify(r))
`)
    const runDriver = () => {
      const r = spawnSync(process.execPath, [DRV], { encoding: 'utf8', maxBuffer: 1e8, cwd: process.cwd(), env: { ...process.env, ...ENV } })
      try { return JSON.parse(r.stdout) } catch { return { code: 'NO_JSON', why: `${r.stdout}${r.stderr}`.slice(0, 200) } }
    }
    /** 프로세스 그룹째 띄워 그룹째 죽인다 — runner 가 띄운 CLI 자식까지 함께 죽는다 */
    const spawnDriver = () => spawn(process.execPath, [DRV],
      { cwd: process.cwd(), env: { ...process.env, ...ENV }, detached: true, stdio: 'ignore' })
    const exited = (c) => new Promise((ok) => (c.exitCode !== null || c.signalCode !== null ? ok() : c.once('exit', ok)))
    const killGroup = (c) => { try { process.kill(-c.pid, 'SIGKILL') } catch { /* 이미 끝났다 */ } }
    const row = () => QN34.readQuarantine(L).store[SLUG] ?? {}

    // ① 1회차 — 보냈는데 응답을 못 받았다 (전송불명 기록을 만든다)
    const r1 = runDriver()
    check('  ㉞ 1회차 — 실제로 보냈고 전송불명이다', countEv(LOG, 'send') === 1 && r1.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${r1.code} · send ${countEv(LOG, 'send')}`)
    const deliveryBefore = JSON.stringify(row().delivery)
    const loads0 = countEv(LOG, 'load')

    // ② HOLD 경계 — runner 가 CLI 를 띄우는 순간 그룹째 SIGKILL
    const c = spawnDriver()
    let killedAtBoundary = false
    const until = Date.now() + 20000
    while (c.exitCode === null && c.signalCode === null && Date.now() < until) {
      if (countEv(LOG, 'load') > loads0) { killGroup(c); killedAtBoundary = true; break }
      await new Promise((ok) => setTimeout(ok, 5))
    }
    await exited(c)
    check('🔴 ㉞ HOLD 경계에 도달하기 전에 끝난다 — runner(CLI) 기동 0',
      !killedAtBoundary && countEv(LOG, 'load') === loads0, killedAtBoundary ? 'runner 가 불려 SIGKILL 했다' : `load ${countEv(LOG, 'load') - loads0}`)
    check('🔴 ㉞ 경계 실행 뒤 regenCalls 0 · attempts 0', (row().regenCalls ?? 0) === 0 && (row().attempts ?? 0) === 0,
      `regen ${row().regenCalls} · attempts ${row().attempts}`)

    // ③ 여러 시점 SIGKILL — 어디서 죽어도 불변식이 유지된다
    const bad = []
    for (const ms of [0, 20, 60, 120, 250, 500]) {
      const k = spawnDriver()
      await new Promise((ok) => setTimeout(ok, ms))
      killGroup(k)
      await exited(k)
      const e = row()
      if ((e.regenCalls ?? 0) !== 0 || (e.attempts ?? 0) !== 0 || countEv(LOG, 'send') !== 1
        || JSON.stringify(e.delivery) !== deliveryBefore || fs.existsSync(QN34.quarantineLockPath(L))) {
        bad.push(`${ms}ms: regen ${e.regenCalls} · send ${countEv(LOG, 'send')} · lock ${fs.existsSync(QN34.quarantineLockPath(L))}`)
      }
    }
    check('🔴 ㉞ SIGKILL 6개 시점 모두 regenCalls 0 · 재전송 0 · 전송 기록 불변 · 잠금 0', bad.length === 0, bad.join(' | ') || '6/6')

    // ④ 재시작 — 다시 돌려도 HOLD · 아무것도 쓰지 않는다
    const r4 = runDriver()
    check('🔴 ㉞ 재시작 후 HOLD · runner 0 · send 0',
      r4.code === 'REGEN_DELIVERY_HOLD' && countEv(LOG, 'load') === loads0 && countEv(LOG, 'send') === 1,
      `${r4.code} · load ${countEv(LOG, 'load') - loads0} · send ${countEv(LOG, 'send')}`)
    check('🔴 ㉞ 앞선 전송 기록(sent=null · prior)을 덮지 않는다',
      JSON.stringify(row().delivery) === deliveryBefore && row().delivery?.sent === null, JSON.stringify(row().delivery))
    check('  ㉞ packet 파일 0', RG34.packetsLeftFor(SLUG, PK).length === 0, RG34.packetsLeftFor(SLUG, PK).join(',') || '0건')

    // ⑤ 죽은 게이트가 아니다 — brief 가 바뀌면(지문 다름) 새 시도가 실제로 돈다
    fs.appendFileSync(path.join(D, SLUG, 'brief.md'), '\n## 추가 지시\n- 한 줄 더\n')
    const r5 = runDriver()
    check('🔴 ㉞ brief 가 바뀌면 다시 보낸다', countEv(LOG, 'send') === 2 && r5.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${r5.code} · send ${countEv(LOG, 'send')}`)
    void QN34
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㉟ 예약은 주인만 지우고 · 실패한 쪽은 남의 예약을 덮지 않는다 (실제 fetchBatch)')
{
  /**
   * 🔴 예약 기록이 send 권한의 정본이면, 그 기록을 **다른 프로세스가 지우거나 덮는 길**도 막아야 한다.
   *    ① 성공한 프로세스는 **자기 예약 ID 일 때만** 지운다 — 그 사이 다른 지문으로 적힌 남의 예약을 지우면 HOLD 가 풀린다.
   *    ② 선기록에 실패한 프로세스(잠금 시간 초과)는 사후 기록에서 **같은 지문의 남의 예약을 덮지 않는다.**
   */
  const { spawnSync } = await import('node:child_process')
  const WEBUI35 = await import('./magazine-webui-runner.mjs')
  const QN35 = await import('./lib/magazine-quarantine.mjs')
  const MG35 = await import('./lib/magazine-manuscript-guard.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-reservation-'))
  try {
    const D = path.join(T, 'drafts', 'magazine')
    const DATE = '2026-09-28'
    fs.mkdirSync(path.join(D, 'rs-a'), { recursive: true })
    fs.writeFileSync(path.join(D, 'rs-a', 'brief.md'), '# brief\n\n본문 지시\n')
    fs.writeFileSync(path.join(D, 'rs-a', 'review.ts'), '#\n')
    fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
    fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'),
      JSON.stringify({ status: 'COMPLETED', selected: [], reusable: [{ slug: 'rs-a' }] }))
    const GOOD = `---\ntitle: 시험 원고\ndescription: 갱년기 몸의 변화를 우리 또래와 함께 살펴보는 시험 원고입니다\ncluster: menopause-body\n---\n\n## 첫 문단\n${'갱년기 몸의 변화를 천천히 살펴보고 우리 또래의 이야기를 나눕니다. '.repeat(40)}\n\n[CTA] 이야기 나눠요\n`
    check('  ㉟ 합성 원고가 실제 관문을 통과한다 (전제)', MG35.validateManuscript(GOOD).ok, JSON.stringify(MG35.validateManuscript(GOOD).reasons ?? []))
    const deps = ({ onTyped = () => {}, onAwait = () => {}, ok }, world) => ({ ...FAST_FETCH,
      ensureTab: async () => ({ ok: true }),
      connect: async () => ({
        contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
          let typed = ''
          return {
            async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
            async waitForFunction() { onAwait(); if (!ok) throw new Error('Timeout') },
            async evaluate() { return GOOD },
            locator(sel) {
              const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
              const l = { async click() { if (isSend) world.send += 1 }, async innerText() { return typed } }
              return { first: () => l, ...l }
            },
            keyboard: { async insertText(t) { typed += String(t ?? ''); onTyped(typed) }, async press() {} },
          }
        })()) }],
        async close() {},
      }),
    })
    const run = (L, d, rp) => WEBUI35.fetchBatch({ date: DATE, dryRun: false, limit: 0, draftsDir: D, quarantinePath: L,
      resultPath: path.join(T, rp), probeFn: async () => ({ status: 'ok' }), browserDeps: d })
    const other = { sent: null, messageFingerprint: 'sha256:other-brief', kind: 'DELIVERY_UNCERTAIN',
      reason: 'sending', stage: 'send', at: 1, runId: null, date: DATE, reservationId: 'other-process' }

    // ① 성공 — 내 예약이면 지운다 (기본 동작)
    const L1 = path.join(T, 'q1.json')
    const w1 = { send: 0 }
    const b1 = await run(L1, deps({ ok: true }, w1), 'r1.json')
    check('  ㉟ 성공하면 내 예약을 지운다', (b1.results ?? [])[0]?.status === 'ok' && !QN35.readQuarantine(L1).store['rs-a']?.delivery,
      JSON.stringify(QN35.readQuarantine(L1).store['rs-a'] ?? null))
    fs.rmSync(path.join(D, 'rs-a', 'draft.md'), { force: true })

    // ① 성공 — 그 사이 남의 예약(다른 지문)으로 바뀌었으면 지우지 않는다
    const L2 = path.join(T, 'q2.json')
    const w2 = { send: 0 }
    const b2 = await run(L2, deps({ ok: true, onAwait: () => QN35.updateQuarantine((cur) => ({ ...cur, 'rs-a': { ...(cur['rs-a'] ?? {}), delivery: other } }), L2) }, w2), 'r2.json')
    check('🔴 ㉟ 성공해도 남의 예약은 지우지 않는다',
      (b2.results ?? [])[0]?.status === 'ok' && QN35.readQuarantine(L2).store['rs-a']?.delivery?.reservationId === 'other-process',
      JSON.stringify(QN35.readQuarantine(L2).store['rs-a']?.delivery ?? null))
    fs.rmSync(path.join(D, 'rs-a', 'draft.md'), { force: true })

    // ② 잠금 시간 초과로 선기록 실패 — 그 사이 같은 지문을 예약한 남의 기록을 덮지 않는다
    const L3 = path.join(T, 'q3.json')
    const w3 = { send: 0 }
    let holderPid = null
    const b3 = await run(L3, deps({ ok: false, onTyped: (typed) => {
      // 다른 프로세스가 같은 글자를 예약했고, 아직 잠금을 쥐고 있다 (11초 뒤 죽는다)
      QN35.saveQuarantine({ 'rs-a': { delivery: { ...other, messageFingerprint: QN35.deliveryFingerprintOf(typed) } } }, L3)
      /**
       * 🔴 holder 는 **이 시험 프로세스의 자식이 아니어야 한다.** 자식이면 이 프로세스가 동기 대기 중이라
       *    끝난 holder 를 거두지 못해 좀비가 되고, 좀비는 `kill(pid, 0)` 에 "살아 있다" 로 답한다 —
       *    그러면 사후 기록 단계가 잠금을 끝내 못 잡아 **아무것도 안 쓰고** 이 시험이 공허하게 통과했다 (변이로 확인).
       *    sh 가 띄우고 바로 끝나므로 holder 는 init 이 거둔다.
       */
      holderPid = Number(spawnSync('sh', ['-c', `"${process.execPath}" -e "setTimeout(() => {}, 11000)" >/dev/null 2>&1 & echo $!`],
        { encoding: 'utf8', env: { ...process.env, HOME: T } }).stdout.trim())
      fs.writeFileSync(QN35.quarantineLockPath(L3), JSON.stringify({ token: 'other-lock', pid: holderPid, host: os.hostname(), at: 'x' }))
    } }, w3), 'r3.json')
    try {
      check('  ㉟ 사후 기록 단계가 실제로 잠금을 잡았다 (죽은 holder 의 잠금을 거뒀다 — 전제)',
        Number.isInteger(holderPid) && holderPid > 0 && !fs.existsSync(QN35.quarantineLockPath(L3)), `holder ${holderPid}`)
      const d3 = QN35.readQuarantine(L3).store['rs-a']?.delivery ?? {}
      check('🔴 ㉟ 선기록 실패(잠금 시간 초과) → send 0', w3.send === 0 && (b3.results ?? [])[0]?.sent === false,
        `send ${w3.send} · ${(b3.results ?? [])[0]?.reason}`)
      check('🔴 ㉟ 실패한 쪽이 남의 같은 지문 예약을 덮지 않는다',
        d3.reservationId === 'other-process' && d3.kind === 'DELIVERY_UNCERTAIN', JSON.stringify(d3))
    } finally { try { if (holderPid) process.kill(holderPid, 'SIGKILL') } catch { /* 이미 끝났다 */ } }
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

/**
 * 🔴 ㊱·㊲ 공용 — **실제 재생성 driver 자식**(실제 `attemptRegeneration` + 실제 `webuiRegenRunner` + 실제 CLI)
 *    를 여러 개 띄우는 무대. 브라우저만 fixture 다. 원고 응답은 `release` 파일이 생길 때까지 기다린다 —
 *    이긴 쪽이 **예약을 쥔 채 멈춰 있는 동안** 진 쪽을 여러 시점에 죽여 보기 위해서다.
 */
async function regenStage(T, name, { slug = 'rr-a', slugs = [slug], ledgerSeed = null, probeHook = '' } = {}) {
  const { spawn, spawnSync } = await import('node:child_process')
  const D = path.join(T, `${name}-drafts`)
  for (const sl of slugs) {
    fs.mkdirSync(path.join(D, sl), { recursive: true })
    fs.writeFileSync(path.join(D, sl, 'brief.md'), `# ${sl}\n\n본문 지시\n`)
    fs.writeFileSync(path.join(D, sl, 'review.ts'), '#\n')
  }
  // 🔴 무대마다 장부 폴더를 따로 둔다 — slug lease 폴더가 장부 옆에 생기므로 무대끼리 섞이지 않게
  fs.mkdirSync(path.join(T, name), { recursive: true })
  const L = path.join(T, name, 'ledger.json')
  if (ledgerSeed) saveQuarantine(ledgerSeed, L)
  const LOG = path.join(T, `${name}-events.jsonl`)
  const PK = path.join(T, `${name}-packets`)
  const RELEASE = path.join(T, `${name}-release`)
  const BAR = path.join(T, `${name}-barrier`)
  fs.mkdirSync(BAR)
  /** 🔴 자식 쪽 barrier — 두 자식이 **앞단(잠금 없는) 판정을 모두 지나 예약 직전까지** 오게 한다 */
  const CBAR = path.join(T, `${name}-child-barrier`)
  fs.mkdirSync(CBAR)
  const GOOD = `---\ntitle: 시험 원고\ndescription: 갱년기 몸의 변화를 우리 또래와 함께 살펴보는 시험 원고입니다\ncluster: menopause-body\n---\n\n## 첫 문단\n${'갱년기 몸의 변화를 천천히 살펴보고 우리 또래의 이야기를 나눕니다. '.repeat(40)}\n\n[CTA] 이야기 나눠요\n`
  const FX = writeFixture(path.join(T, `${name}-fx.mjs`), `${fixtureHead(LOG)}
export const quarantinePath = ${JSON.stringify(L)}
// 🔴 이 무대의 승자는 release 파일을 최대 60초 기다린다 — 응답 관찰 한도가 그보다 길어야 한다
export const fetchTiming = { pollMs: 5, stablePolls: 2, timeoutMs: 90000 }
export const probe = async () => {
  rec('probe')
  ${probeHook}
  fs.writeFileSync(${JSON.stringify(CBAR)} + '/' + process.pid, '')
  const until = Date.now() + 3000
  while (fs.readdirSync(${JSON.stringify(CBAR)}).length < 2 && Date.now() < until) await new Promise((ok) => setTimeout(ok, 5))
  return { status: 'ok' }
}
export const ensureTab = async () => ({ ok: true })
export const connect = async () => ({
  contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
    let typed = ''
    return {
      async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
      async waitForFunction() {
        const until = Date.now() + 60000
        while (!fs.existsSync(${JSON.stringify(RELEASE)})) {
          if (Date.now() > until) throw new Error('waitForFunction: Timeout')
          await new Promise((ok) => setTimeout(ok, 20))
        }
      },
      // 🔴 원고에 **이 자식이 보낸 지시의 코드**를 식별 문장으로 박는다 — 최종 draft 가 누구 것인지 가린다
      async evaluate() {
        rec('evaluate')
        return ${JSON.stringify(GOOD)}.replace('[CTA]', '식별 ' + ([...typed.matchAll(/\\[([A-Z_]+)\\]/g)].map((m) => m[1]).join(',') || 'NORMAL') + '\\n\\n[CTA]')
      },
      locator(sel) {
        const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
        const l = { async click() { if (isSend) rec('send', { ppid: process.ppid, codes: [...typed.matchAll(/\\[([A-Z_]+)\\]/g)].map((m) => m[1]) }) }, async innerText() { return typed } }
        return { first: () => l, ...l }
      },
      keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
    }
  })()) }],
  async close() {},
})
`)
  /** 부모가 패킷을 쓰는 순간(= 앞단 판정 통과 직후)에 두 부모를 세우는 barrier */
  const PRE = writeFixture(path.join(T, `${name}-barrier.mjs`), `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const real = fs.renameSync
let first = true
fs.renameSync = (a, b) => {
  if (first && String(b).startsWith(${JSON.stringify(PK + path.sep)})) {
    first = false
    fs.writeFileSync(${JSON.stringify(BAR)} + '/' + process.pid, '')
    const until = Date.now() + 3000
    while (fs.readdirSync(${JSON.stringify(BAR)}).length < 2 && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    fs.appendFileSync(${JSON.stringify(BAR)} + '.log', JSON.stringify({ pid: process.pid, arrivals: fs.readdirSync(${JSON.stringify(BAR)}).length }) + '\\n')
  }
  return real(a, b)
}
syncBuiltinESMExports()
`)
  const url = (f) => JSON.stringify(new URL(`file://${path.resolve(f)}`).href)
  const DRV = writeFixture(path.join(T, `${name}-driver.mjs`), `import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { attemptRegeneration } from ${url('scripts/lib/magazine-regen.mjs')}
import { webuiRegenRunner } from ${url('scripts/magazine-auto-register.mjs')}
const runFn = (file, args) => {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', maxBuffer: 1e8, env: process.env })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
}
const r = attemptRegeneration({ slug: process.env.RR_SLUG, profile: 'MEDICAL',
  failures: JSON.parse(process.env.RR_FAILURES),
  quarantinePath: ${JSON.stringify(L)}, packetDir: ${JSON.stringify(PK)}, draftsDir: ${JSON.stringify(D)},
  runner: (ctx) => webuiRegenRunner(ctx, { runFn, resultDir: ${JSON.stringify(T)} }) })
fs.writeFileSync(process.env.RR_OUT, JSON.stringify({ ...r, pid: process.pid }))
`)
  const ENV = { HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX }
  let n = 0
  const start = (failures, { barrier = false, slug: sl = slug } = {}) => {
    n += 1
    const out = path.join(T, `${name}-out-${n}.json`)
    const c = spawn(process.execPath, [...(barrier ? ['--import', PRE] : []), DRV],
      { cwd: process.cwd(), env: { ...process.env, ...ENV, RR_SLUG: sl, RR_FAILURES: JSON.stringify(failures), RR_OUT: out },
        detached: true, stdio: 'ignore' })
    const done = new Promise((ok) => c.once('exit', () => ok()))
    return { c, done, out, result: () => (fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null),
      kill: () => { try { process.kill(-c.pid, 'SIGKILL') } catch { /* 이미 끝났다 */ } } }
  }
  const row = (sl = slug) => readQuarantine(L).store[sl] ?? {}
  const draft = (sl = slug) => (fs.existsSync(path.join(D, sl, 'draft.md')) ? fs.readFileSync(path.join(D, sl, 'draft.md'), 'utf8') : '')
  const leasesLeft = () => (fs.existsSync(path.join(T, name, 'magazine-manuscript-leases'))
    ? fs.readdirSync(path.join(T, name, 'magazine-manuscript-leases')) : [])
  const events = (ev) => readEvents(LOG).filter((e) => e.ev === ev)
  const sends = () => readEvents(LOG).filter((e) => e.ev === 'send')
  const arrivals = () => (fs.existsSync(`${BAR}.log`)
    ? fs.readFileSync(`${BAR}.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).arrivals) : [])
  const release = () => fs.writeFileSync(RELEASE, '')
  const firstExit = (a, b) => Promise.race([a.done.then(() => a), b.done.then(() => b)])
  const childArrivals = () => fs.readdirSync(CBAR).length
  /** 이 무대 환경으로 실제 CLI 를 한 번 돈다 (일반 회수 등) */
  const runCli = (args) => spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', ...args],
    { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, ...ENV, HOME: T } })
  /** 같은 환경으로 실제 CLI 를 **비동기로** 띄운다 — 재생성과 동시에 도는 일반 회수 등 */
  const startCli = (args, rj) => {
    const c = spawn(process.execPath, ['scripts/magazine-webui-runner.mjs', ...args, '--result-json', rj],
      { cwd: process.cwd(), env: { ...process.env, ...ENV }, stdio: 'ignore' })
    const done = new Promise((ok) => c.once('exit', (code) => ok(code)))
    return { c, done, row: () => (fs.existsSync(rj) ? JSON.parse(fs.readFileSync(rj, 'utf8')).results?.[0] ?? null : null) }
  }
  const untilTrue = async (fn, ms = 15000) => { const t = Date.now() + ms; while (!fn() && Date.now() < t) await new Promise((ok) => setTimeout(ok, 10)); return fn() }
  return { slug, L, D, PK, start, row, sends, arrivals, release, firstExit, childArrivals, draft, leasesLeft, events, untilTrue, runCli, startCli }
}

console.log('\n㊱ 동시 재생성 — 판정·예약·횟수가 한 임계구역 (실제 driver 2개 · barrier · SIGKILL)')
{
  /**
   * 🔴 **앞판의 경합** (2026-09-28 · Codex P0).
   *    부모가 앞단 판정 뒤 **따로** regenCalls 를 올렸다. 두 부모가 앞단 판정을 동시에 통과하면
   *    둘 다 올렸고, 진 쪽은 옛 `budget.used` 로 이긴 쪽 횟수까지 되돌렸다.
   *    여기서는 두 부모를 **패킷을 쓰는 순간(= 앞단 판정 통과 직후)** 에 barrier 로 세운다.
   */
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-regen-race-'))
  try {
    const S = await regenStage(T, 'same')
    const F = [{ code: 'QA_FAIL', label: 'magazine QA FAIL' }]
    const a = S.start(F, { barrier: true })
    const b = S.start(F, { barrier: true })
    const loser = await S.firstExit(a, b)
    const winner = loser === a ? b : a
    const lr = loser.result() ?? {}
    check('  ㊱ 두 부모가 모두 앞단 판정을 통과했다 (barrier 도착 2 · 전제)',
      S.arrivals().length === 2 && S.arrivals().includes(2), JSON.stringify(S.arrivals()))
    /**
     * 🔴 **같은 slug 재생성은 lease 하나** (2026-09-28 · Codex P0) — 진 쪽 자식은 probe **전에** 멈춘다.
     *    그래서 자식 barrier 에는 이긴 쪽 하나만 온다. 이긴 쪽이 예약을 쥘 때까지 기다린 뒤에 본다.
     */
    // 🔴 예약은 send 클릭 **직전**에 적힌다 — 예약과 클릭이 모두 끝날 때까지 기다린 뒤에 본다 (타이밍 경합 제거)
    await S.untilTrue(() => Boolean(S.row().delivery?.reservationId) && S.sends().length >= 1)
    check('🔴 ㊱ 진 쪽 — REGEN_IN_PROGRESS · probe 0 · send 0 (자식 barrier 도착 1)',
      lr.code === 'REGEN_IN_PROGRESS' && S.events('probe').length === 1 && S.childArrivals() === 1 && S.sends().length === 1,
      `${lr.code} · probe ${S.events('probe').length} · barrier ${S.childArrivals()} · send ${S.sends().length}`)
    const r1 = S.row()
    const rid = r1.delivery?.reservationId
    check('🔴 ㊱ 이긴 쪽이 예약을 쥔 동안 regenCalls 정확히 1 · 예약 1개',
      r1.regenCalls === 1 && typeof rid === 'string' && r1.delivery?.kind === 'DELIVERY_UNCERTAIN',
      JSON.stringify({ regenCalls: r1.regenCalls, rid: !!rid, ids: r1.regenAttemptIds?.length }))

    // 진 쪽을 여러 시점에 SIGKILL — 이긴 쪽 횟수·예약이 그대로여야 한다
    const bad = []
    for (const ms of [0, 30, 80, 150, 300, 600]) {
      const k = S.start(F)
      await new Promise((ok) => setTimeout(ok, ms))
      k.kill()
      await k.done
      const e = S.row()
      if (e.regenCalls !== 1 || e.delivery?.reservationId !== rid || S.sends().length !== 1) {
        bad.push(`${ms}ms: regen ${e.regenCalls} · rid ${e.delivery?.reservationId === rid} · send ${S.sends().length}`)
      }
    }
    check('🔴 ㊱ 진 쪽을 6개 시점에 SIGKILL 해도 이긴 쪽 regenCalls·예약 보존 · send 1', bad.length === 0, bad.join(' | ') || '6/6')
    const extra = S.start(F)
    await extra.done
    check('  ㊱ 죽이지 않은 추가 시도도 HOLD · send 0 · 횟수 불변',
      extra.result()?.code === 'REGEN_DELIVERY_HOLD' && S.sends().length === 1 && S.row().regenCalls === 1,
      `${extra.result()?.code} · regen ${S.row().regenCalls}`)

    S.release()
    await winner.done
    const wr = winner.result() ?? {}
    check('🔴 ㊱ 최종 — send 합계 1 · regenCalls 정확히 1 · 이긴 쪽 REGENERATED',
      S.sends().length === 1 && S.row().regenCalls === 1 && wr.code === 'REGENERATED',
      `${wr.code} · send ${S.sends().length} · regen ${S.row().regenCalls}`)
    check('  ㊱ 이긴 쪽은 자기 예약만 지웠다 · 패킷 잔여 0',
      !S.row().delivery && packetsLeftFor(S.slug, S.PK).length === 0, packetsLeftFor(S.slug, S.PK).join(',') || '0건')

    // 소진 직전 — 서로 다른 지문 둘이 마지막 한 번을 두고 경합한다
    const X = await regenStage(T, 'last', { ledgerSeed: { 'rr-a': { attempts: 0, regenCalls: 1 } } })
    X.release()
    const xa = X.start([{ code: 'MED_A', label: '가' }], { barrier: true })
    const xb = X.start([{ code: 'MED_B', label: '나' }], { barrier: true })
    await Promise.all([xa.done, xb.done])
    const codes = [xa.result()?.code, xb.result()?.code].sort()
    check('  ㊱ [소진 직전] 두 부모 모두 앞단 판정을 통과했다 (전제)', X.arrivals().includes(2), JSON.stringify(X.arrivals()))
    check('🔴 ㊱ [소진 직전] 한쪽만 — send 1 · regenCalls 2 · 다른 쪽 REGEN_IN_PROGRESS (lease)',
      X.sends().length === 1 && X.row().regenCalls === 2 && codes.join(',') === 'REGENERATED,REGEN_IN_PROGRESS',
      `${codes.join(',')} · send ${X.sends().length} · regen ${X.row().regenCalls}`)

    /**
     * 🔴 **임계구역 안 최신 예산 확인은 여전히 정본이다.** lease 뒤 · 예약 전에 예산이 소진된 경우를
     *    probe hook 으로 만든다 (앞단 확인은 이미 통과한 뒤다). 예약 임계구역이 막아야 한다.
     */
    const Y = await regenStage(T, 'inlock', { ledgerSeed: { 'rr-a': { attempts: 0, regenCalls: 1 } },
      probeHook: `{ const f = ${JSON.stringify(path.join(T, 'inlock', 'ledger.json'))}; const j = JSON.parse(fs.readFileSync(f, 'utf8')); j['rr-a'].regenCalls = 2; fs.writeFileSync(f, JSON.stringify(j)) }` })
    Y.release()
    const ya = Y.start([{ code: 'MED_A', label: '가' }])
    await ya.done
    check('🔴 ㊱ [임계구역 예산] 앞단 뒤에 소진되면 예약 임계구역이 막는다 — REGEN_EXHAUSTED · send 0 · 예약 0 · regenCalls 2',
      ya.result()?.code === 'REGEN_EXHAUSTED' && Y.sends().length === 0 && !Y.row().delivery && Y.row().regenCalls === 2,
      `${ya.result()?.code} · send ${Y.sends().length} · regen ${Y.row().regenCalls}`)

    // 예약을 얻은 자식이 send 직후 급사 — 예약과 횟수를 보수적으로 남겨 재전송을 막는다
    const K = await regenStage(T, 'crash')
    const kk = K.start([{ code: 'QA_FAIL', label: 'magazine QA FAIL' }])
    const until = Date.now() + 20000
    while (K.sends().length === 0 && Date.now() < until) await new Promise((ok) => setTimeout(ok, 10))
    const childPid = K.sends()[0]?.pid
    try { process.kill(childPid, 'SIGKILL') } catch { /* 이미 끝났다 */ }
    await kk.done
    const kr = kk.result() ?? {}
    check('🔴 ㊱ [급사] 예약을 얻은 자식이 send 뒤 죽으면 regenCalls·예약이 남는다',
      K.sends().length === 1 && K.row().regenCalls === 1 && K.row().delivery?.kind === 'DELIVERY_UNCERTAIN'
        && kr.code === 'REGEN_DELIVERY_UNCERTAIN',
      `${kr.code} · regen ${K.row().regenCalls} · delivery ${K.row().delivery?.kind}`)
    const k2 = K.start([{ code: 'QA_FAIL', label: 'magazine QA FAIL' }])
    await k2.done
    check('🔴 ㊱ [급사] 재시작 — HOLD · 재전송 0 · 횟수 불변',
      k2.result()?.code === 'REGEN_DELIVERY_HOLD' && K.sends().length === 1 && K.row().regenCalls === 1,
      `${k2.result()?.code} · send ${K.sends().length} · regen ${K.row().regenCalls}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊲ 같은 slug 재생성은 수명주기 전체가 하나 — 다른 지문 2개 동시 · 다른 slug 는 동시 (실제 driver)')
{
  /**
   * 🔴 **앞판의 "둘 다 REGENERATED" 는 성공이 아니라 결함이었다** (2026-09-28 · Codex P0).
   *    같은 slug · 다른 지문 재생성 두 건이 동시에 보내고 **같은 draft.md 를 둘 다 썼다.**
   *    이제 slug lease 로 한 건만 진행한다. 패자는 probe·send·draft write·regenCalls 전부 0.
   *    barrier 로 두 부모가 모두 패킷을 쓴 뒤(= 앞단 판정 통과 뒤)에 자식이 뜨게 한다.
   */
  const { spawnSync, spawn } = await import('node:child_process')
  const QN37 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-slug-lease-'))
  try {
    const S = await regenStage(T, 'iso')
    S.release()
    const FA = [{ code: 'MED_ALPHA', label: '가' }]
    const FB = [{ code: 'MED_BETA', label: '나' }]
    const a = S.start(FA, { barrier: true })
    const b = S.start(FB, { barrier: true })
    await Promise.all([a.done, b.done])
    const ra = a.result() ?? {}
    const rb = b.result() ?? {}
    check('  ㊲ 두 부모가 모두 앞단 판정을 지나 패킷을 썼다 (barrier 도착 2 · 전제)', S.arrivals().includes(2), JSON.stringify(S.arrivals()))
    const [win, lose, winCode, loseCode, winRes, loseRes] = ra.code === 'REGENERATED'
      ? [a, b, 'MED_ALPHA', 'MED_BETA', ra, rb] : [b, a, 'MED_BETA', 'MED_ALPHA', rb, ra]
    const byParent = (pid) => S.sends().filter((e) => e.ppid === pid).flatMap((e) => e.codes)
    check('🔴 ㊲ 승자만 REGENERATED · 패자는 REGEN_IN_PROGRESS',
      winRes.code === 'REGENERATED' && loseRes.code === 'REGEN_IN_PROGRESS', `${ra.code} · ${rb.code}`)
    check('🔴 ㊲ 승자만 send 1 · 패자 send 0 · probe 는 승자 1회뿐',
      S.sends().length === 1 && byParent(lose.c.pid).length === 0 && S.events('probe').length === 1,
      `send ${S.sends().length} · 패자 ${JSON.stringify(byParent(lose.c.pid))} · probe ${S.events('probe').length}`)
    check('🔴 ㊲ draft write 는 승자 1회 · 최종 draft 에는 승자의 식별 문장만',
      S.events('evaluate').length === 1 && S.draft().includes(`식별 ${winCode}`) && !S.draft().includes(loseCode),
      `evaluate ${S.events('evaluate').length} · ${(S.draft().match(/식별 [A-Z_,]+/) ?? ['없음'])[0]}`)
    check('  ㊲ 승자는 자기 패킷의 지시만 보냈다', JSON.stringify(byParent(win.c.pid)) === JSON.stringify([winCode]), JSON.stringify(byParent(win.c.pid)))
    check('🔴 ㊲ 패자 regenCalls 소비 0 (최종 1) · 패자도 자기 패킷을 읽었다 (attemptId 일치)',
      S.row().regenCalls === 1 && loseRes.childAttemptId === loseRes.attemptId && Boolean(loseRes.attemptId),
      `regen ${S.row().regenCalls} · ${loseRes.childAttemptId === loseRes.attemptId}`)
    check('  ㊲ 각자 자기 packetHash (서로 다르다)',
      winRes.packetHash && loseRes.packetHash && winRes.packetHash !== loseRes.packetHash, `${winRes.packetHash} · ${loseRes.packetHash}`)
    check('🔴 ㊲ 종료 후 패킷 잔여 0 · lease 잔여 0',
      packetsLeftFor(S.slug, S.PK).length === 0 && S.leasesLeft().length === 0,
      `${packetsLeftFor(S.slug, S.PK).join(',') || '패킷 0'} · ${S.leasesLeft().join(',') || 'lease 0'}`)

    // 승자가 끝난 뒤에는 바뀐 지문의 다음 재생성이 순차로 된다
    const c = S.start(lose === a ? FA : FB)
    await c.done
    check('🔴 ㊲ 승자 종료 후 바뀐 지문은 순차 실행된다 — REGENERATED · draft 가 그 식별 문장으로',
      c.result()?.code === 'REGENERATED' && S.draft().includes(`식별 ${loseCode}`) && S.sends().length === 2,
      `${c.result()?.code} · send ${S.sends().length}`)

    // 다른 slug 두 건은 동시에 진행한다
    const M = await regenStage(T, 'multi', { slugs: ['rr-a', 'rr-b'] })
    M.release()
    const ma = M.start(FA, { barrier: true, slug: 'rr-a' })
    const mb = M.start(FB, { barrier: true, slug: 'rr-b' })
    await Promise.all([ma.done, mb.done])
    check('🔴 ㊲ 다른 slug 두 건은 동시에 — 둘 다 REGENERATED · send 2 · 각자 자기 draft',
      ma.result()?.code === 'REGENERATED' && mb.result()?.code === 'REGENERATED' && M.sends().length === 2
        && M.draft('rr-a').includes('식별 MED_ALPHA') && M.draft('rr-b').includes('식별 MED_BETA'),
      `${ma.result()?.code} · ${mb.result()?.code} · send ${M.sends().length}`)
    check('  ㊲ 다른 slug — 두 자식 모두 probe barrier 에 왔다 (서로 막지 않았다)', M.childArrivals() === 2, `${M.childArrivals()}`)

    // lease 주인 — 살아 있으면 빼앗지 않고 멈춘다 · 죽었으면 token 재확인 뒤 거둔다
    const Z = await regenStage(T, 'owner')
    Z.release()
    const LEASE = QN37.manuscriptLeasePath('rr-a', Z.L)
    fs.mkdirSync(path.dirname(LEASE), { recursive: true })
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      const body = JSON.stringify({ token: 'live-owner', pid: live.pid, host: os.hostname(), at: 'x', slug: 'rr-a' })
      fs.writeFileSync(LEASE, body)
      const z1 = Z.start(FA)
      await z1.done
      check('🔴 ㊲ 살아 있는 lease 주인 — REGEN_IN_PROGRESS · probe 0 · send 0 · lease 그대로',
        z1.result()?.code === 'REGEN_IN_PROGRESS' && Z.events('probe').length === 0 && Z.sends().length === 0
          && fs.existsSync(LEASE) && fs.readFileSync(LEASE, 'utf8') === body,
        `${z1.result()?.code} · probe ${Z.events('probe').length}`)
      // 🔴 일반 회수(패킷 없음)도 그 slug 가 재생성 중이면 멈춘다 — lease 는 잡지 않고 보기만 한다
      const RJN = path.join(T, 'normal-during-lease.json')
      const n1 = Z.runCli(['--fetch', 'rr-a', '--result-json', RJN])
      const nrow = fs.existsSync(RJN) ? JSON.parse(fs.readFileSync(RJN, 'utf8')).results?.[0] ?? {} : {}
      check('🔴 ㊲ 재생성 중인 slug 의 일반 회수 — MANUSCRIPT_IN_PROGRESS · probe 0 · send 0',
        n1.status !== 0 && nrow.reason === 'MANUSCRIPT_IN_PROGRESS' && Z.events('probe').length === 0 && Z.sends().length === 0,
        `exit ${n1.status} · ${nrow.reason} · probe ${Z.events('probe').length}`)
    } finally { live.kill('SIGKILL') }
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', env: { ...process.env, HOME: T } })
    fs.writeFileSync(LEASE, JSON.stringify({ token: 'dead-owner', pid: Number(dead.stdout), host: os.hostname(), at: 'x', slug: 'rr-a' }))
    const z2 = Z.start(FA)
    await z2.done
    check('  ㊲ 죽은 lease 주인 — token 재확인 뒤 거두고 진행 · 끝나면 lease 0',
      z2.result()?.code === 'REGENERATED' && !fs.existsSync(LEASE), `${z2.result()?.code}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊳ 늦게 온 옛 실패는 최신 상태를 건드리지 않는다 · 패킷 attemptId fail-closed')
{
  const RG38 = await import('./lib/magazine-regen.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-cas-'))
  try {
    /**
     * 🔴 **A. CAS** (2026-09-28 · Codex P1). 옛 시도가 예약·횟수를 얻고 느려진 사이, 새 시도가 성공하고
     *    등록까지 끝나 재생성 기록이 지워졌다(clearRegen). 그 뒤 옛 시도의 인프라 실패가 늦게 도착한다.
     *    앞판은 attemptId 가 없어도 kind·sent·lastRegenAt 을 덮어썼다 — 이제 장부는 한 바이트도 안 바뀐다.
     */
    const L = path.join(T, 'q.json')
    const PK = path.join(T, 'packets')
    let before = null
    let rNew = null
    const rOld = attemptRegeneration({ slug: 'cas-a', profile: 'MEDICAL', failures: [{ code: 'QA_FAIL', label: '옛' }],
      quarantinePath: L, packetDir: PK,
      runner: (ctxOld) => asChild(ctxOld, L, () => {
        rNew = attemptRegeneration({ slug: 'cas-a', profile: 'MEDICAL', failures: [{ code: 'MED_NEW', label: '새' }],
          quarantinePath: L, packetDir: PK, runner: (ctxNew) => asChild(ctxNew, L, () => ({ ok: true })) })
        RG38.clearRegen('cas-a', L)
        before = fs.readFileSync(L, 'utf8')
        return { ok: false, reason: 'connect_failed', stage: 'connect', sent: false, resultSource: 'file', why: '옛 인프라 실패(늦게 도착)' }
      }),
    })
    check('  ㊳ 새 시도는 성공했고 옛 시도는 인프라 실패로 끝났다 (전제)',
      rNew?.code === 'REGENERATED' && rOld.code === 'REGEN_INFRA_FAILED', `${rNew?.code} · ${rOld.code}`)
    check('🔴 ㊳ 늦게 온 옛 실패 — 최신 상태·예약·횟수 전부 불변 (장부 바이트 동일)',
      before !== null && fs.readFileSync(L, 'utf8') === before, '장부가 바뀌었다')

    /**
     * 🔴 **B. attemptId fail-closed** (regen-packet/3). 실제 CLI · fixture 브라우저 ·
     *    exit ≠ 0 · probe·connect·send 0 · 장부 바이트 불변.
     */
    const { spawnSync } = await import('node:child_process')
    const QB = await import('./lib/magazine-quarantine.mjs')
    const D = path.join(T, 'drafts')
    fs.mkdirSync(path.join(D, 'ai-a'), { recursive: true })
    fs.writeFileSync(path.join(D, 'ai-a', 'brief.md'), '# ai-a\n\n본문 지시\n')
    fs.writeFileSync(path.join(D, 'ai-a', 'review.ts'), '#\n')
    const LB = path.join(T, 'qb.json')
    QB.saveQuarantine({ 'ai-a': { attempts: 0, regenCalls: 1, note: '불변이어야 한다' } }, LB)
    const ledgerBefore = fs.readFileSync(LB, 'utf8')
    const LOG = path.join(T, 'events.jsonl')
    const FX = writeFixture(path.join(T, 'fx.mjs'), `${fixtureHead(LOG)}
export const quarantinePath = ${JSON.stringify(LB)}
export const probe = async () => { rec('probe'); return { status: 'ok' } }
export const ensureTab = async () => { rec('ensureTab'); return { ok: true } }
export const connect = async () => { rec('connect'); throw new Error('불려서는 안 된다') }
`)
    const A = 'a3bb189e-8bf9-4888-9912-ace4e6543002'
    const B = '7d444840-9dc0-41d2-9e4b-8a5d6f2b1c3e'
    const base = RG38.buildFailurePacket({ slug: 'ai-a', profile: 'MEDICAL', failures: [{ code: 'QA_FAIL', label: 'x' }], attempt: 1, attemptId: A })
    const PD = path.join(T, 'bad-packets')
    fs.mkdirSync(PD, { recursive: true })
    const cases = [
      ['attemptId 누락', (() => { const { attemptId, ...p } = base; void attemptId; return p })(), `ai-a.${A}.json`],
      ['빈 문자열', { ...base, attemptId: '' }, 'ai-a..json'],
      ['숫자', { ...base, attemptId: 12345 }, 'ai-a.12345.json'],
      ['잘못된 UUID', { ...base, attemptId: 'not-a-uuid' }, 'ai-a.not-a-uuid.json'],
      ['파일명 불일치', { ...base, attemptId: A }, `ai-a.${B}.json`],
    ]
    for (const [name, body, file] of cases) {
      const f = path.join(PD, file)
      fs.writeFileSync(f, JSON.stringify(body))
      const RJ = path.join(T, `r-${name}.json`)
      const r = spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', '--fetch', 'ai-a', '--force', '--regen-packet', f, '--result-json', RJ],
        { encoding: 'utf8', maxBuffer: 1e8,
          env: { ...process.env, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: D, SORAN_MAGAZINE_TEST_FIXTURE: FX } })
      const row = fs.existsSync(RJ) ? JSON.parse(fs.readFileSync(RJ, 'utf8')).results?.[0] ?? {} : {}
      check(`🔴 ㊳ [${name}] exit≠0 · REGEN_PACKET_ATTEMPT_ID · probe·connect·send 0 · 장부 불변`,
        r.status !== 0 && row.reason === 'REGEN_PACKET_ATTEMPT_ID' && row.sent === false && readEvents(LOG).length === 0
          && fs.readFileSync(LB, 'utf8') === ledgerBefore,
        `exit ${r.status} · ${row.reason} · events ${readEvents(LOG).length}`)
    }
    check('  ㊳ 패킷 생성자가 쓰는 판이 소비자가 받는 판과 같다 (regen-packet/3)',
      base.schemaVersion === 'regen-packet/3', base.schemaVersion)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊴ 같은 slug 원고 작업은 하나 — 일반+재생성 동시 · lease 주인 정체(PID 재사용) 판정')
{
  /**
   * 🔴 **앞판의 구멍** (2026-09-28 · Codex P0). 일반 회수는 재생성 lease 를 **보기만** 했다.
   *    본 직후 재생성이 lease 를 잡으면 둘 다 보내고 같은 draft.md 를 썼다 (수정 전 실측 send 2 · draft write 2).
   *    실제 CLI 자식 2개(일반 `--fetch` · 재생성 driver)를 probe barrier 에서 만나게 한다.
   */
  const { spawn, spawnSync } = await import('node:child_process')
  const QN39 = await import('./lib/magazine-quarantine.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-manuscript-lease-'))
  try {
    const S = await regenStage(T, 'mix')
    S.release()
    const normal = S.startCli(['--fetch', 'rr-a'], path.join(T, 'normal.json'))
    const regen = S.start([{ code: 'MED_REGEN', label: '재' }])
    await Promise.all([normal.done, regen.done])
    const nr = normal.row() ?? {}
    const rr = regen.result() ?? {}
    const normalWon = nr.status === 'ok'
    check('🔴 ㊴ 일반+재생성 동시 — 한쪽만 진행 · 다른 쪽은 구조화된 IN_PROGRESS',
      normalWon ? (rr.code === 'REGEN_IN_PROGRESS') : (rr.code === 'REGENERATED' && nr.status === 'held' && nr.reason === 'MANUSCRIPT_IN_PROGRESS' && nr.stage === 'lease'),
      JSON.stringify({ normal: `${nr.status}/${nr.reason}`, regen: rr.code }))
    check('🔴 ㊴ send 1 · draft write 1 · probe 1 (패자는 probe 전에 멈춤 · barrier 1)',
      S.sends().length === 1 && S.events('evaluate').length === 1 && S.events('probe').length === 1 && S.childArrivals() === 1,
      `send ${S.sends().length} · write ${S.events('evaluate').length} · probe ${S.events('probe').length} · barrier ${S.childArrivals()}`)
    check('🔴 ㊴ 최종 draft 에는 승자의 식별 문장만',
      S.draft().includes(normalWon ? '식별 NORMAL' : '식별 MED_REGEN') && !S.draft().includes(normalWon ? 'MED_REGEN' : 'NORMAL'),
      `${normalWon ? '일반' : '재생성'} 승 · ${(S.draft().match(/식별 [A-Z_,]+/) ?? ['없음'])[0]}`)
    check('  ㊴ 패자는 regenCalls·attempts 를 쓰지 않았다',
      (S.row().attempts ?? 0) === 0 && (S.row().regenCalls ?? 0) === (normalWon ? 0 : 1),
      `regen ${S.row().regenCalls} · attempts ${S.row().attempts}`)
    check('  ㊴ lease 잔여 0', S.leasesLeft().length === 0, S.leasesLeft().join(','))

    // 승자 종료 뒤 다음 요청은 순차로 된다 — 진 쪽을 다시 돌린다
    if (normalWon) {
      const again = S.start([{ code: 'MED_REGEN', label: '재' }])
      await again.done
      check('🔴 ㊴ 승자 종료 후 다음 요청은 순차 진행 (재생성 REGENERATED)',
        again.result()?.code === 'REGENERATED' && S.draft().includes('식별 MED_REGEN'), `${again.result()?.code}`)
    } else {
      const again = S.startCli(['--fetch', 'rr-a', '--force'], path.join(T, 'normal2.json'))
      await again.done
      check('🔴 ㊴ 승자 종료 후 다음 요청은 순차 진행 (일반 회수 ok)',
        again.row()?.status === 'ok' && S.draft().includes('식별 NORMAL'), `${again.row()?.status}/${again.row()?.reason}`)
    }

    // 다른 slug 두 건(일반 + 재생성)은 동시에 된다
    const M = await regenStage(T, 'multi', { slugs: ['rr-a', 'rr-b'] })
    M.release()
    const mn = M.startCli(['--fetch', 'rr-a'], path.join(T, 'mn.json'))
    const mr = M.start([{ code: 'MED_B', label: '나' }], { slug: 'rr-b' })
    await Promise.all([mn.done, mr.done])
    check('🔴 ㊴ 다른 slug 일반+재생성 — 둘 다 성공 · send 2 · 두 자식 모두 barrier 도착',
      mn.row()?.status === 'ok' && mr.result()?.code === 'REGENERATED' && M.sends().length === 2 && M.childArrivals() === 2,
      `${mn.row()?.status} · ${mr.result()?.code} · send ${M.sends().length} · barrier ${M.childArrivals()}`)

    /**
     * 🔴 **lease 주인 정체** (2026-09-28 · Codex P1). PID 가 있다고 주인이 살아 있는 것이 아니다.
     *    실제 주인 프로세스가 production `acquireManuscriptLease` 로 lease 를 잡게 한 뒤 판정을 본다.
     */
    const L = path.join(T, 'owner', 'ledger.json')
    fs.mkdirSync(path.dirname(L), { recursive: true })
    const LEASE = QN39.manuscriptLeasePath('own-a', L)
    const qUrl = JSON.stringify(new URL(`file://${path.resolve('scripts/lib/magazine-quarantine.mjs')}`).href)
    const OWNER = writeFixture(path.join(T, 'owner.mjs'), `import fs from 'node:fs'
const Q = await import(${qUrl})
const r = Q.acquireManuscriptLease({ slug: 'own-a', work: 'fetch', path: ${JSON.stringify(L)} })
fs.writeFileSync(process.argv[2], JSON.stringify({ ok: r.ok }))
setTimeout(() => {}, 60000)
`)
    const startOwner = async (env = {}) => {
      const ready = path.join(T, `ready-${Math.random()}`)
      // 주인은 장부 경로를 명시로 받는다 — HOME 에 기대는 기본 경로를 쓰지 않는다
      const c = spawn(process.execPath, [OWNER, ready], { stdio: 'ignore', env: { ...process.env, ...env } })
      const until = Date.now() + 10000
      while (!fs.existsSync(ready) && Date.now() < until) await new Promise((ok) => setTimeout(ok, 10))
      return c
    }
    const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
    const writeLease = (o) => fs.writeFileSync(LEASE, JSON.stringify({ token: `t-${Math.random()}`, host: os.hostname(), at: 'x', slug: 'own-a', work: 'fetch', ...o }))

    // ① 실제 주인 생존 — 로캘·시간대가 달라도 탈취하지 않는다
    const own = await startOwner({ TZ: 'America/New_York', LC_ALL: 'de_DE.UTF-8' })
    try {
      const body = fs.readFileSync(LEASE, 'utf8')
      const r1 = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'regen', path: L })
      check('🔴 ㊴ [주인 생존 · 다른 TZ/로캘] 탈취하지 않는다 — IN_PROGRESS · lease 그대로',
        r1.ok === false && r1.code === 'MANUSCRIPT_IN_PROGRESS' && fs.readFileSync(LEASE, 'utf8') === body, `${r1.code} — ${String(r1.why).slice(0, 80)}`)

      // ⑤ 프로세스 조회 실패 — 판단하지 않는다 (주입 · 실제 CLI 의 PATH 제거 둘 다)
      const r5 = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'regen', path: L, identityOf: () => null })
      check('🔴 ㊴ [조회 실패] 진행 금지 — IN_PROGRESS(UNKNOWN) · lease 그대로',
        r5.ok === false && /UNKNOWN/.test(r5.why) && fs.readFileSync(LEASE, 'utf8') === body, String(r5.why).slice(0, 90))
      const P = await regenStage(T, 'nopath', { slug: 'own-a' })
      fs.mkdirSync(path.dirname(QN39.manuscriptLeasePath('own-a', P.L)), { recursive: true })
      fs.copyFileSync(LEASE, QN39.manuscriptLeasePath('own-a', P.L))
      const RJ = path.join(T, 'nopath.json')
      const cli = spawnSync(process.execPath, ['scripts/magazine-webui-runner.mjs', '--fetch', 'own-a', '--result-json', RJ],
        { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: T, PATH: path.join(T, 'no-bin'),
          SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: P.D, SORAN_MAGAZINE_TEST_FIXTURE: path.join(T, 'nopath-fx.mjs') } })
      const crow = fs.existsSync(RJ) ? JSON.parse(fs.readFileSync(RJ, 'utf8')).results?.[0] ?? {} : {}
      check('🔴 ㊴ [조회 실패 · 실제 CLI · ps 없음] 진행 금지 — MANUSCRIPT_IN_PROGRESS · probe 0 · lease 그대로',
        cli.status !== 0 && crow.reason === 'MANUSCRIPT_IN_PROGRESS' && /UNKNOWN/.test(crow.errorDetail ?? '')
          && P.events('probe').length === 0 && fs.readFileSync(QN39.manuscriptLeasePath('own-a', P.L), 'utf8') === body,
        `exit ${cli.status} · ${crow.reason} · ${String(crow.errorDetail).slice(0, 60)}`)
    } finally { own.kill('SIGKILL') }

    // ② PID 없음 — 안전 회수
    const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', env: { ...process.env, HOME: T } })
    writeLease({ pid: Number(gone.stdout), start: 'Mon Jan  1 00:00:00 2024', cmd: 'node x' })
    const r2 = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'fetch', path: L })
    check('  ㊴ [PID 없음] 안전 회수 — 새 lease 획득', r2.ok === true, `${r2.code ?? 'ok'}`)
    r2.release?.()

    // ③ PID 가 unrelated process 로 재사용 — 명령줄이 다르다
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      await new Promise((ok) => setTimeout(ok, 150))
      const oid = QN39.processIdentity(other.pid)
      writeLease({ pid: other.pid, start: oid?.start, cmd: 'node scripts/magazine-webui-runner.mjs --fetch own-a' })
      const r3 = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'fetch', path: L })
      check('🔴 ㊴ [PID → unrelated 프로세스] 안전 회수 · 그 프로세스는 건드리지 않는다',
        Boolean(oid) && r3.ok === true && alive(other.pid), `${r3.code ?? 'ok'} · alive ${alive(other.pid)}`)
      r3.release?.()
    } finally { other.kill('SIGKILL') }

    // ④ PID 가 다른 magazine 실행으로 재사용 — 명령줄은 같지만 시작 시각이 다르다
    const mag = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'scripts/magazine-webui-runner.mjs', '--fetch', 'own-a'], { stdio: 'ignore' })
    try {
      await new Promise((ok) => setTimeout(ok, 150))
      const mid = QN39.processIdentity(mag.pid)
      writeLease({ pid: mag.pid, start: 'Mon Jan  1 00:00:00 2024', cmd: mid?.cmd })
      const r4 = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'fetch', path: L })
      check('🔴 ㊴ [PID → 다른 magazine 실행 · 시작 시각 불일치] 안전 회수',
        /magazine-webui-runner/.test(mid?.cmd ?? '') && r4.ok === true && alive(mag.pid), `${r4.code ?? 'ok'} · ${String(mid?.cmd).slice(-50)}`)
      r4.release?.()
      // 같은 명령줄 · 같은 시작 시각이면 같은 주인이다 — 빼앗지 않는다 (위 판정이 공허하지 않다는 대조군)
      writeLease({ pid: mag.pid, start: mid?.start, cmd: mid?.cmd })
      const body4 = fs.readFileSync(LEASE, 'utf8')
      const r4b = QN39.acquireManuscriptLease({ slug: 'own-a', work: 'fetch', path: L })
      check('  ㊴ [대조군] 시작 시각·명령줄이 모두 같으면 살아 있는 주인 — 빼앗지 않는다',
        r4b.ok === false && fs.readFileSync(LEASE, 'utf8') === body4, `${r4b.code ?? 'ok'}`)
    } finally { mag.kill('SIGKILL'); fs.rmSync(LEASE, { force: true }) }
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊵ 같은 날 옛 빈 계획 — 인식 가능한 것만 보존 후 재계산 · slug 별 멱등성 · 모르는 판 fail-closed')
{
  /**
   * 🔴 **2026-09-28 운영 사고.** 배포 전 옛 코드가 00:10 에 `COMPLETED · selected 0 · reusable 없음`
   *    run.json 을 만들었고, 배포 뒤 새 코드가 그것을 무조건 완료로 보고 종료했다 — 대상 0.
   *    그날 01:00 옛 auto-register 는 큐에서 6건을 처리했다(텍스트 전송 1 · 이미지 2 · 등록·PR 0).
   *    여기서는 **그 실측 상태를 그대로** 만든 뒤 실제 `planRun` → 실제 `fetchBatch` 를 돌린다.
   */
  const { spawn } = await import('node:child_process')
  const PLAN40 = await import('./magazine-producer-plan.mjs')
  const RF40 = await import('./lib/magazine-run-file.mjs')
  const QN40 = await import('./lib/magazine-quarantine.mjs')
  const WEBUI40 = await import('./magazine-webui-runner.mjs')
  const READY40 = await import('./magazine-auto-register-ready.mjs')
  const TODAY = '2026-09-28'
  const NOW = new Date('2026-09-28T09:00:00+09:00').getTime()
  const DONE6 = ['irp-tax-benefit', 'certificate-in-50s', 'how-much-talk-with-husband', 'retirement-prep-status', 'moment-body-changed', 'menopause-supplements-talk']
  const EXTRA = ['uncertain-a', 'broken-a', 'broken-b', 'registered-a']
  const HERO = new Set(['irp-tax-benefit', 'certificate-in-50s']) // 01:00 에 이미지 2건이 생성됐다

  /** 오늘 실측과 같은 무대 — 무대마다 새 폴더 */
  const stage = (name, { legacy = true, legacyOverride = {}, current = null, packages = false } = {}) => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), `m3a-legacy-${name}-`))
    const D = path.join(T, 'drafts')
    const RUNS = path.join(D, '_runs')
    const RD = path.join(RUNS, TODAY)
    fs.mkdirSync(RD, { recursive: true })
    const L = path.join(T, 'ledger.json')
    const brief = (sl) => {
      fs.mkdirSync(path.join(D, sl), { recursive: true })
      fs.writeFileSync(path.join(D, sl, 'brief.md'), `# ${sl}\n\n본문 지시\n`)
      fs.writeFileSync(path.join(D, sl, 'review.ts'), '#\n')
    }
    for (const sl of [...DONE6, ...EXTRA]) brief(sl)
    // 01:00 에 원고가 저장된 글 (irp 는 그날 텍스트 전송 1건으로 받았다)
    for (const sl of ['irp-tax-benefit', 'certificate-in-50s', 'how-much-talk-with-husband', 'retirement-prep-status', 'moment-body-changed']) {
      fs.writeFileSync(path.join(D, sl, 'draft.md'), `---\ntitle: ${sl}\n---\n\n본문\n`)
    }
    fs.writeFileSync(path.join(D, 'broken-a', 'draft.md'), '')   // 깨진 증거
    const fpOf = (sl) => QN40.deliveryFingerprintOf(WEBUI40.plannedMessageFor(sl, D))
    QN40.saveQuarantine({
      // 전송 전 실패(upload_timeout · sent 0) — 다시 처리 가능
      'menopause-supplements-talk': { attempts: 0, delivery: { sent: false, messageFingerprint: fpOf('menopause-supplements-talk'), kind: 'INFRA', reason: 'upload_timeout', stage: 'attach', at: 1, runId: null, date: TODAY, reservationId: null } },
      // 같은 지문 전송불명 — 재전송 금지
      'uncertain-a': { attempts: 0, delivery: { sent: null, messageFingerprint: fpOf('uncertain-a'), kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: TODAY, reservationId: 'r' } },
      // 깨진 전송 기록 — 지문 없는 전송불명
      'broken-b': { attempts: 0, delivery: { sent: null, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1 } },
    }, L)
    const legacyRun = {
      date: TODAY, startedAt: '2026-09-27T15:10:08.202Z', finishedAt: '2026-09-27T15:10:08.218Z', status: 'COMPLETED',
      dryRun: false, inventoryDays: 0, produceCount: 5, reviewCount: 1,
      counts: { total: 0, live: 0, scheduled: 0, blocked: 0, draft: 0 },
      selected: [], skipped: DONE6.map((sl, i) => ({ day: i + 1, slug: sl, reason: `drafts/magazine/${sl} 가 이미 있다` })),
      abortReason: null, ...legacyOverride,
    }
    if (current) fs.writeFileSync(path.join(RD, 'run.json'), JSON.stringify(current, null, 2) + '\n')
    else if (legacy) fs.writeFileSync(path.join(RD, 'run.json'), JSON.stringify(legacyRun, null, 2) + '\n')
    fs.writeFileSync(path.join(RD, 'report.md'), '# 옛 리포트\n')
    // 01:00 후속 처리 흔적 — 회차 전체를 막는 근거가 아니다
    fs.writeFileSync(path.join(RD, 'auto-register.json'), JSON.stringify({ processed: 6, done: [], pr: { made: false } }))
    fs.writeFileSync(path.join(RD, 'auto-merge.json'), JSON.stringify({ merged: false, pr: null }))
    if (packages) { fs.mkdirSync(path.join(RD, 'selected', 'pkg-a'), { recursive: true }); fs.writeFileSync(path.join(RD, 'selected', 'pkg-a', 'brief.todo.md'), 'x') }
    const queue = [...DONE6, ...EXTRA].map((slug, i) => ({ ...FIXTURE_QUEUE[0], day: 100 + i, slug, title: slug }))
    const deps = {
      today: TODAY, now: NOW, runsDir: RUNS, draftsDir: D, quarantinePath: L,
      loadQueueFn: () => queue,
      loadArticlesFn: () => [{ slug: 'registered-a', status: 'SCHEDULED' }],
      inventoryFn: () => ({ inventoryDays: 0, counts: { total: 0, live: 0, scheduled: 0, blocked: 0, draft: 0 } }),
      heroExists: (sl) => HERO.has(sl),
      log: () => {},
    }
    const bytes = () => fs.readFileSync(path.join(RD, 'run.json'), 'utf8')
    const preserved = () => fs.readdirSync(RD).filter((f) => /\.(legacy-empty|broken)-/.test(f))
    return { T, D, RD, L, deps, queue, bytes, preserved }
  }

  // ── A. 오늘 운영 사고와 같은 상태 ──
  const A = stage('a')
  const beforeA = A.bytes()
  const rA = PLAN40.planRun(A.deps)
  const newRun = JSON.parse(A.bytes())
  const pA = A.preserved()
  check('🔴 ㊵ A 옛 빈 계획 → 보존 후 새 판으로 재계산',
    rA.outcome === 'RECOMPUTED_LEGACY' && newRun.schemaVersion === RF40.RUN_SCHEMA_VERSION && newRun.status === 'COMPLETED',
    `${rA.outcome} · ${newRun.schemaVersion}`)
  const keptRun = pA.find((f) => f.startsWith('run.'))
  check('🔴 ㊵ A 옛 run.json·report.md 를 지우지 않고 고유 이름으로 보존 (내용 동일)',
    pA.length === 2 && keptRun && fs.readFileSync(path.join(A.RD, keptRun), 'utf8') === beforeA
      && fs.readFileSync(path.join(A.RD, pA.find((f) => f.startsWith('report.'))), 'utf8') === '# 옛 리포트\n',
    pA.join(', '))
  const reuse = new Map((newRun.reusable ?? []).map((r) => [r.slug, r]))
  const held = new Map((newRun.held ?? []).map((h) => [h.slug, h]))
  check('🔴 ㊵ A reusable 후보 > 0 — 처리된 6건 전부 (등록된 slug 제외)',
    DONE6.every((sl) => reuse.has(sl)) && !reuse.has('registered-a') && reuse.size === 6,
    [...reuse.keys()].join(','))
  check('🔴 ㊵ A 이미 있는 draft·hero 재사용 표시 (irp·certificate: draft+hero)',
    reuse.get('irp-tax-benefit')?.reuse?.draft && reuse.get('irp-tax-benefit')?.reuse?.hero
      && reuse.get('certificate-in-50s')?.reuse?.hero && reuse.get('how-much-talk-with-husband')?.stage === 'NEEDS_CONVERT',
    JSON.stringify(reuse.get('irp-tax-benefit')?.reuse))
  check('🔴 ㊵ A 판정 불가·전송불명 slug 만 HOLD (uncertain-a · broken-a · broken-b)',
    held.get('uncertain-a')?.code === 'DELIVERY_UNCERTAIN_HOLD' && held.get('broken-a')?.code === 'EVIDENCE_BROKEN'
      && held.get('broken-b')?.code === 'EVIDENCE_BROKEN' && held.size === 3,
    JSON.stringify([...held.values()].map((h) => `${h.slug}:${h.code}`)))
  check('  ㊵ A lock·임시 파일 잔여 0', !fs.existsSync(path.join(A.RD, '.lock')) && !fs.readdirSync(A.RD).some((f) => f.includes('.tmp-')),
    fs.readdirSync(A.RD).join(','))

  // A → 실제 fetchBatch: 안전하게 처리 가능한 slug 만 보낸다 (menopause 1건) · 기존 전송·원고 재전송 0
  const sendsA = []
  const fakeBrowser = { ...FAST_FETCH,
    ensureTab: async () => ({ ok: true }),
    connect: async () => ({
      contexts: () => [{ pages: () => [], newPage: async () => adaptPage(await (async () => {
        let typed = ''
        return {
          async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
          async waitForFunction() { throw new Error('Timeout') }, async evaluate() { return '' },
          locator(sel) {
            const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
            const l = { async click() { if (isSend) sendsA.push(typed.match(/^# ([a-z0-9-]+)$/m)?.[1] ?? '?') }, async innerText() { return typed } }
            return { first: () => l, ...l }
          },
          keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
        }
      })()) }],
      async close() {},
    }),
  }
  const fb = await WEBUI40.fetchBatch({ date: TODAY, dryRun: false, limit: 0, draftsDir: A.D, quarantinePath: A.L,
    resultPath: path.join(A.T, 'fetch.json'), probeFn: async () => ({ status: 'ok' }), browserDeps: fakeBrowser })
  check('🔴 ㊵ A 회수 — 안전하게 처리 가능한 slug 만 전송 (menopause 1건) · draft 있는 글·HOLD 글 재전송 0',
    JSON.stringify(sendsA) === JSON.stringify(['menopause-supplements-talk']),
    `${JSON.stringify(sendsA)} · planned ${JSON.stringify((fb.planned ?? []).map((p) => `${p.slug}:${p.action}`))}`)
  const regPool = READY40.scan({ runDate: TODAY, store: {}, draftsDir: A.D })
  check('  ㊵ A 등록 경로도 새 run 을 읽는다 — draft 있는 재사용 후보가 다음 단계로 간다 (source run)',
    regPool.source === `run:${TODAY}` && regPool.pool >= 5, `${regPool.source} · pool ${regPool.pool}`)
  const rA2 = PLAN40.planRun(A.deps)
  check('🔴 ㊵ A 같은 날 다시 돌면 새 판 COMPLETED — 재계산 0', rA2.outcome === 'ALREADY_COMPLETED' && A.preserved().length === 2, rA2.outcome)

  // ── B. 옛 판이지만 선정 1건 이상 ──
  const B = stage('b', { legacyOverride: { selected: [{ day: 1, slug: 'irp-tax-benefit' }] } })
  const bb = B.bytes()
  const rB = PLAN40.planRun(B.deps)
  check('🔴 ㊵ B 옛 판 · 선정 1건 이상 → 재계산 0 · 파일 불변', rB.outcome === 'LEGACY_COMPLETED' && B.bytes() === bb && B.preserved().length === 0, rB.outcome)

  // ── C. 옛 빈 계획이지만 선정 패키지(후속 증거)가 있다 ──
  const C = stage('c', { packages: true })
  const cb = C.bytes()
  const rC = PLAN40.planRun(C.deps)
  check('🔴 ㊵ C 옛 빈 계획 + 선정 패키지 증거 → 재계산 0 · 파일 불변', rC.outcome === 'LEGACY_COMPLETED' && C.bytes() === cb, rC.outcome)
  // C-2. v1(reusable 있음 · 판 표식 없음) COMPLETED — 재계산 0
  const C2 = stage('c2', { legacyOverride: { reusable: [] } })
  const c2b = C2.bytes()
  const rC2 = PLAN40.planRun(C2.deps)
  check('  ㊵ C2 옛 판 v1(reusable 있음) COMPLETED → 재계산 0', rC2.outcome === 'LEGACY_COMPLETED' && C2.bytes() === c2b, rC2.outcome)

  // ── D. 지금 판 COMPLETED ──
  const D0 = stage('d', { current: { schemaVersion: RF40.RUN_SCHEMA_VERSION, date: TODAY, status: 'COMPLETED', selected: [], reusable: [], held: [] } })
  const db = D0.bytes()
  const rD = PLAN40.planRun(D0.deps)
  check('🔴 ㊵ D 지금 판 COMPLETED → 재계산 0 · 파일 불변', rD.outcome === 'ALREADY_COMPLETED' && D0.bytes() === db, rD.outcome)

  // ── E. 모르는 미래 판 — fail-closed · 전송 0 ──
  const E = stage('e', { current: { schemaVersion: 'producer-run/9', date: TODAY, status: 'COMPLETED', selected: [{ slug: 'menopause-supplements-talk' }], reusable: [{ slug: 'menopause-supplements-talk' }] } })
  const eb = E.bytes()
  const rE = PLAN40.planRun(E.deps)
  check('🔴 ㊵ E 모르는 판 → code 3 (fail-closed) · 파일 불변', rE.code === 3 && rE.outcome === 'UNKNOWN_SCHEMA' && E.bytes() === eb, `${rE.code} ${rE.outcome}`)
  const sendsE = sendsA.length
  const fe = await WEBUI40.fetchBatch({ date: TODAY, dryRun: false, limit: 0, draftsDir: E.D, quarantinePath: E.L,
    resultPath: path.join(E.T, 'fetch.json'), probeFn: async () => ({ status: 'ok' }), browserDeps: fakeBrowser })
  const eScan = READY40.scan({ runDate: TODAY, store: {}, draftsDir: E.D })
  check('🔴 ㊵ E 소비자도 fail-closed — 회수 대상 0 · 전송 0 · 등록 후보가 큐 전체로 되돌아가지 않는다',
    (fe.planned ?? []).length === 0 && sendsA.length === sendsE && eScan.pool === 0,
    `planned ${(fe.planned ?? []).length} · send +${sendsA.length - sendsE} · pool ${eScan.pool} (${eScan.source})`)
  const { spawnSync } = await import('node:child_process')
  const cliE = spawnSync(process.execPath, ['scripts/magazine-producer-plan.mjs', '--now', '2026-09-28T09:00:00+09:00'],
    { encoding: 'utf8', maxBuffer: 1e8, env: { ...process.env, HOME: E.T, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_DRAFTS_DIR: E.D, TZ: 'Asia/Seoul' } })
  check('🔴 ㊵ E 실제 CLI 도 exit 3 · RUN_SCHEMA_UNKNOWN · 파일 불변',
    cliE.status === 3 && /RUN_SCHEMA_UNKNOWN/.test(`${cliE.stdout}${cliE.stderr}`) && E.bytes() === eb,
    `exit ${cliE.status} · ${String(cliE.stdout).trim().slice(0, 80)}`)

  // ── F. 동시 producer 2개 — 재계산 정확히 1회 · 기록 손실 0 ──
  const F = stage('f')
  const fBefore = F.bytes()
  const FIXJ = path.join(F.T, 'fixture.json')
  fs.writeFileSync(FIXJ, JSON.stringify({ ...F.deps, loadQueueFn: undefined, loadArticlesFn: undefined, inventoryFn: undefined,
    heroExists: undefined, log: undefined, queue: F.queue, hero: [...HERO] }))
  const planUrl = JSON.stringify(new URL(`file://${path.resolve('scripts/magazine-producer-plan.mjs')}`).href)
  const DRVF = writeFixture(path.join(F.T, 'driver.mjs'), `import fs from 'node:fs'
const P = await import(${planUrl})
const fx = JSON.parse(fs.readFileSync(${JSON.stringify(FIXJ)}, 'utf8'))
const hero = new Set(fx.hero)
const r = P.planRun({ ...fx, loadQueueFn: () => fx.queue, loadArticlesFn: () => [{ slug: 'registered-a' }],
  inventoryFn: () => ({ inventoryDays: 0, counts: { total: 0, live: 0, scheduled: 0, blocked: 0, draft: 0 } }),
  heroExists: (s) => hero.has(s), log: () => {} })
fs.writeFileSync(process.argv[2], JSON.stringify({ outcome: r.outcome, code: r.code }))
`)
  const BARF = path.join(F.T, 'barrier')
  fs.mkdirSync(BARF)
  /** 두 producer 가 **잠금을 잡기 직전**에 만나게 한다 — 판정을 모두 끝낸 상태로 잠금을 다툰다 */
  const PREF = writeFixture(path.join(F.T, 'pre.mjs'), `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const real = fs.openSync
let first = true
fs.openSync = (p, flags, ...rest) => {
  if (first && flags === 'wx' && String(p).endsWith('/.lock') && String(p).includes(${JSON.stringify(F.RD)})) {
    first = false
    fs.writeFileSync(${JSON.stringify(BARF)} + '/' + process.pid, '')
    const until = Date.now() + 3000
    while (fs.readdirSync(${JSON.stringify(BARF)}).length < 2 && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
  }
  return real(p, flags, ...rest)
}
syncBuiltinESMExports()
`)
  const outs = [path.join(F.T, 'o1.json'), path.join(F.T, 'o2.json')]
  await Promise.all(outs.map((o) => new Promise((ok) => {
    const c = spawn(process.execPath, ['--import', PREF, DRVF, o], { stdio: 'ignore', env: { ...process.env } })
    c.once('exit', ok)
  })))
  const res = outs.map((o) => (fs.existsSync(o) ? JSON.parse(fs.readFileSync(o, 'utf8')).outcome : 'NO_RESULT')).sort()
  const pF = F.preserved()
  const finalF = JSON.parse(F.bytes())
  check('  ㊵ F 두 producer 가 모두 잠금 직전까지 왔다 (barrier 2 · 전제)', fs.readdirSync(BARF).length === 2, `${fs.readdirSync(BARF).length}`)
  check('🔴 ㊵ F 동시 producer 2개 — 재계산 정확히 1회 · 다른 쪽은 실행 중/완료로 종료',
    res.filter((x) => x === 'RECOMPUTED_LEGACY').length === 1 && res.every((x) => ['RECOMPUTED_LEGACY', 'RUNNING', 'ALREADY_COMPLETED'].includes(x)),
    JSON.stringify(res))
  check('🔴 ㊵ F 기록 손실 0 — 옛 기록 보존 1쌍(원본과 동일) · 최종 run 새 판 · lock·임시 파일 0',
    pF.length === 2 && fs.readFileSync(path.join(F.RD, pF.find((f) => f.startsWith('run.'))), 'utf8') === fBefore
      && finalF.schemaVersion === RF40.RUN_SCHEMA_VERSION && !fs.existsSync(path.join(F.RD, '.lock'))
      && !fs.readdirSync(F.RD).some((f) => f.includes('.tmp-')),
    `${pF.join(', ')} · ${finalF.schemaVersion}`)

  /**
   * ── F2. 잠금 **안** 재판정 ──
   *    진 쪽이 잠금 밖에서 옛 빈 계획을 본 뒤 잠금을 기다리다가, 이긴 쪽이 **끝나고 잠금을 푼 뒤에**
   *    잠금을 잡는 순서. 잠금 안에서 다시 보지 않으면 새 run 을 옛 빈 계획으로 착각해 두 번째 재계산을 한다.
   */
  const F2 = stage('f2')
  const f2Before = F2.bytes()
  const FIXJ2 = path.join(F2.T, 'fixture.json')
  fs.writeFileSync(FIXJ2, JSON.stringify({ ...F2.deps, loadQueueFn: undefined, loadArticlesFn: undefined, inventoryFn: undefined,
    heroExists: undefined, log: undefined, queue: F2.queue, hero: [...HERO] }))
  const DRVF2 = writeFixture(path.join(F2.T, 'driver.mjs'), fs.readFileSync(DRVF, 'utf8').replace(JSON.stringify(FIXJ), JSON.stringify(FIXJ2)))
  const ARRIVED = path.join(F2.T, 'b-arrived')
  const HOLDB = writeFixture(path.join(F2.T, 'hold-b.mjs'), `import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const real = fs.openSync
let first = true
fs.openSync = (p, flags, ...rest) => {
  if (first && flags === 'wx' && String(p) === ${JSON.stringify(path.join(F2.RD, '.lock'))}) {
    first = false
    fs.writeFileSync(${JSON.stringify(ARRIVED)}, '')
    // 이긴 쪽이 새 판을 쓰고 잠금을 풀 때까지 붙잡는다
    const until = Date.now() + 20000
    const done = () => { try { return !fs.existsSync(${JSON.stringify(path.join(F2.RD, '.lock'))}) && JSON.parse(fs.readFileSync(${JSON.stringify(path.join(F2.RD, 'run.json'))}, 'utf8')).schemaVersion } catch { return false } }
    while (!done() && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
  return real(p, flags, ...rest)
}
syncBuiltinESMExports()
`)
  const outB = path.join(F2.T, 'b.json')
  const outA = path.join(F2.T, 'a.json')
  const bDone = new Promise((ok) => spawn(process.execPath, ['--import', HOLDB, DRVF2, outB], { stdio: 'ignore', env: { ...process.env } }).once('exit', ok))
  const untilB = Date.now() + 15000
  while (!fs.existsSync(ARRIVED) && Date.now() < untilB) await new Promise((ok) => setTimeout(ok, 10))
  await new Promise((ok) => spawn(process.execPath, [DRVF2, outA], { stdio: 'ignore', env: { ...process.env } }).once('exit', ok))
  await bDone
  const oA = fs.existsSync(outA) ? JSON.parse(fs.readFileSync(outA, 'utf8')).outcome : 'NO_RESULT'
  const oB = fs.existsSync(outB) ? JSON.parse(fs.readFileSync(outB, 'utf8')).outcome : 'NO_RESULT'
  const pF2 = F2.preserved()
  check('  ㊵ F2 진 쪽이 잠금 밖에서 옛 파일을 본 뒤 잠금 앞에서 기다렸다 (전제)', fs.existsSync(ARRIVED), '도착 안 함')
  check('🔴 ㊵ F2 잠금 안에서 다시 본다 — 이긴 쪽 뒤에 잡은 쪽은 ALREADY_COMPLETED · 재계산 1회 · 보존 1쌍(원본)',
    oA === 'RECOMPUTED_LEGACY' && oB === 'ALREADY_COMPLETED' && pF2.length === 2
      && fs.readFileSync(path.join(F2.RD, pF2.find((f) => f.startsWith('run.'))), 'utf8') === f2Before,
    `A ${oA} · B ${oB} · 보존 ${pF2.length}`)

  for (const s of [A, B, C, C2, D0, E, F, F2]) fs.rmSync(s.T, { recursive: true, force: true })
}

console.log('\n㊶ 응답 회수 — 새로 생긴 assistant 응답 하나 · 끝남 · 안정 (실측 DOM 골격)')
{
  /**
   * 🔴 **2026-09-28 실측.** ChatGPT 가 코드블록을 `<pre>` 없이(`[data-markdown-copy="code-block"]` 안의 `code`)
   *    렌더하고 `data-message-author-role` 도 없앴다. 옛 판정은 원고가 다 왔는데도 영원히 못 알아봤다.
   *    아래 트리는 그날 자동화 Chrome 에서 **읽기 전용으로 떠 온 골격**(태그·속성)을 그대로 옮긴 것이다.
   *    `readConversationDom` 은 `children`·`parentElement`·`tagName`·`getAttribute`·`textContent` 만 쓴다 —
   *    이 작은 트리가 같은 API 를 준다. 판독 함수는 production 그대로다.
   */
  const RESP = await import('./lib/chatgpt-response.mjs')
  const SESS41 = await import('./lib/chatgpt-session.mjs')
  const MG41 = await import('./lib/magazine-manuscript-guard.mjs')
  const el = (tag, attrs = {}, ...kids) => {
    const node = {
      tagName: tag.toUpperCase(), _attrs: attrs, _kids: [], parentElement: null,
      getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? String(this._attrs[n]) : null },
      get children() { return this._kids.filter((k) => typeof k !== 'string') },
      get textContent() { return this._kids.map((k) => (typeof k === 'string' ? k : k.textContent)).join('') },
    }
    for (const k of kids.flat()) {
      if (k === null || k === undefined || k === false) continue
      node._kids.push(k)
      if (typeof k !== 'string') k.parentElement = node
    }
    return node
  }
  const docOf = (...turns) => ({ body: el('body', {}, el('main', {}, ...turns)) })
  const MS = `---\ntitle: 시험 원고\ndescription: 갱년기 몸의 변화를 우리 또래와 함께 살펴보는 시험 원고입니다\ncluster: menopause-body\n---\n\n## 첫 문단\n${'갱년기 몸의 변화를 천천히 살펴보고 우리 또래의 이야기를 나눕니다. '.repeat(40)}\n\n[CTA] 이야기 나눠요\n`
  check('  ㊶ 시험 원고가 실제 관문을 통과한다 (전제)', MG41.validateManuscript(MS).ok, JSON.stringify(MG41.validateManuscript(MS).reasons ?? []))

  /** 새 DOM 한 턴 (실측 골격): 사용자 단위 + assistant 단위 + 턴 액션 버튼 */
  const userUnit = (uid) => el('div', { class: 'group/user-message flex flex-col items-end gap-2', 'data-chatgpt-search-unit-key': 'fallback-turn-0:0:user', 'data-chatgpt-search-message-ids': uid },
    el('div', { 'data-user-message-bubble': 'true' }, el('div', { class: 'whitespace-pre-wrap' }, '아래 BRIEF 시작/끝 사이의 지시를 따라…', el('code', {}, '[CTA] href | 문구')), el('button', { 'aria-label': '메시지 복사' })))
  const codeBlockContent = (text) => el('div', { 'data-selected-text-overlay-target': '_r_17_', 'data-markdown-text-style': 'assistant-message', class: 'MarkdownRoot-rZKhxa' },
    el('div', { 'data-markdown-copy': 'code-block', class: 'relative w-full' },
      el('div', { 'data-markdown-copy': 'exclude', class: 'flex items-center' }, el('div', {}, 'Markdown'), el('span', {}, el('button', { 'aria-label': '복사' }))),
      el('div', {}, el('code', { class: 'whitespace-pre! block' }, text))))
  const renderedContent = () => el('div', { 'data-markdown-text-style': 'assistant-message', class: 'MarkdownRoot-rZKhxa' },
    el('hr', {}),
    el('h2', {}, 'title: 시험 원고\ndescription: 갱년기 몸의 변화를 우리 또래와 함께 살펴보는 시험 원고입니다\ncluster: menopause-body'),
    el('h2', {}, '첫 문단'),
    el('p', {}, '갱년기 몸의 변화를 천천히 살펴보고 우리 또래의 이야기를 나눕니다. '.repeat(40).trim()),
    el('p', {}, '[CTA] 이야기 나눠요'))
  /**
   * 🔴 **2026-09-30 실측 rich-block 의 축소 골격.** 원문은 `data-markdown-copy-text` 에 ```markdown 으로 감싸져 있고,
   *    블록 안에는 제목 머리표(header)와 같은 원문을 담은 편집기(contenteditable 속 pre code)가 있다.
   */
  const richBlock = (raw, { title = '시험 원고 제목', editor = true, attrs = {} } = {}) => el('div', {
    'data-oai-writing-block-surface': '', 'data-markdown-copy': 'rich-block', ...(raw === undefined ? {} : { 'data-markdown-copy-text': raw }), ...attrs },
    el('div', { 'aria-hidden': 'true' }),
    el('div', {}, el('header', {}, el('div', {}, title), el('button', { 'aria-label': '복사' })),
      ...(editor ? [el('div', { contenteditable: 'true', 'aria-label': '작성을 시작하세요', role: 'textbox' },
        el('pre', {}, el('code', {}, el('span', {}, String(raw ?? '').replace(/^```markdown\n|\n```$/g, '')))))] : [])))
  const richContent = (...blocks) => el('div', { 'data-markdown-text-style': 'assistant-message' }, ...blocks)
  const fenced = (t) => `\`\`\`markdown\n${t.replace(/\n$/, '')}\n\`\`\``
  const asstUnit = (aid, content, n = 2) => el('div', { 'data-content-search-unit-key': `fallback-turn-0:${n}:assistant`, 'data-chatgpt-search-unit-key': `fallback-turn-0:${n}:assistant`, 'data-chatgpt-search-message-ids': `${aid} ${aid}` },
    el('h4', { class: 'sr-only m-0 select-none', 'data-conversation-role': 'assistant' }, 'ChatGPT 답변:'),
    el('div', { class: 'group flex min-w-0 flex-col', 'data-chatgpt-selection-conversation-id': 'conv-1', 'data-chatgpt-selection-message-id': aid }, content))
  const actions = () => el('div', {}, el('span', {}, el('button', { 'aria-label': '복사' })), el('button', { 'aria-label': '응답 다시 생성' }))
  const turn = (key, ...kids) => el('div', { 'data-turn-key': key }, el('div', { class: 'flex flex-col gap-1.5', 'data-content-search-turn-key': 'fallback-turn-0' }, ...kids))
  const stopBtn = () => el('div', {}, el('button', { 'aria-label': '스트리밍 중지', 'data-testid': 'stop-button' }))

  // ── 판독: 새 DOM 코드블록 ──
  const sNew = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('a1', codeBlockContent(MS)), actions())))
  const aNew = sNew.units.find((u) => u.role === 'assistant')
  check('🔴 ㊶ 새 DOM — pre 없이 렌더된 코드블록의 원문을 그대로 읽는다 · 완료 액션 인식',
    aNew?.id === 'a1' && aNew.candidates.length === 1 && aNew.candidates[0].text === MS && aNew.hasActions === true,
    JSON.stringify({ id: aNew?.id, cands: aNew?.candidates.length, actions: aNew?.hasActions }))
  const exNew = RESP.extractManuscript(aNew)
  check('  ㊶ 새 DOM — "ChatGPT 답변:" · "Markdown" 머리표가 원고에 섞이지 않는다', exNew.ok && exNew.text === MS && exNew.via === 'code-block', exNew.via)

  // ── 판독: 옛 DOM ──
  const oldDoc = docOf(el('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'o1' }, el('div', { class: 'markdown prose' }, el('pre', {}, el('code', {}, MS)))))
  const aOld = RESP.readConversationDom(oldDoc).units.find((u) => u.role === 'assistant')
  check('🔴 ㊶ 옛 DOM (data-message-author-role · pre code) 도 읽는다', aOld?.id === 'o1' && RESP.extractManuscript(aOld).text === MS, aOld?.id)

  // ── 판독: rich-block (2026-09-30 실측) ──
  const MS0 = MS.replace(/\n$/, '')
  const aRich = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r1', richContent(richBlock(fenced(MS), { title: '오랜만인 친구에게 먼저 연락해도 될까요?' }))), actions()))).units.find((u) => u.role === 'assistant')
  const exRich = RESP.extractManuscript(aRich)
  check('🔴 ㊶ rich-block 위에 제목이 있어도 원문은 --- 로 시작한다 (제목 머리표 미포함)',
    exRich.ok && exRich.via === 'rich-block' && exRich.text.startsWith('---\ntitle: 시험 원고\n') && !exRich.text.includes('오랜만인 친구에게'),
    JSON.stringify(String(exRich.text ?? exRich.why).slice(0, 60)))
  check('🔴 ㊶ rich-block — ```markdown 감싸기만 정확히 벗기고 frontmatter 부터 끝까지 보존',
    exRich.ok && exRich.text === MS0 && !exRich.text.includes('```'), `${exRich.text?.length} vs ${MS0.length}`)
  check('  ㊶ rich-block 안의 편집기 pre code 는 후보로 세지 않는다 (같은 원문 이중 계산 없음)', aRich?.candidates?.length === 1, String(aRich?.candidates?.length))
  check('🔴 ㊶ 되찾은 원문이 실제 원고 관문을 통과한다 (frontmatter·H2·CTA)', exRich.ok && MG41.validateManuscript(exRich.text).ok,
    JSON.stringify(MG41.validateManuscript(exRich.text ?? '').reasons ?? []))
  check('  ㊶ 감싸지 않은 원문 속성은 그대로 쓴다', RESP.stripMarkdownFence(MS0) === MS0 && RESP.stripMarkdownFence('```\nA\n```') === 'A' && RESP.stripMarkdownFence('```md\nA\nB\n```\n') === 'A\nB')
  const exMulti = RESP.extractManuscript(RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r2', richContent(richBlock(fenced(MS)), richBlock(fenced(MS)))), actions()))).units.find((u) => u.role === 'assistant'))
  const exMix = RESP.extractManuscript(RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r3', richContent(richBlock(fenced(MS)), el('pre', {}, el('code', {}, MS)))), actions()))).units.find((u) => u.role === 'assistant'))
  check('🔴 ㊶ 원문 후보가 여러 개면 고르지 않는다 (rich-block 2 · rich-block+코드블록)',
    !exMulti.ok && exMulti.code === 'response_multiple_candidates' && !exMix.ok && exMix.code === 'response_multiple_candidates', `${exMulti.code} · ${exMix.code}`)
  const exNoAttr = RESP.extractManuscript(RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r4', richContent(richBlock(undefined))), actions()))).units.find((u) => u.role === 'assistant'))
  const exEmpty = RESP.extractManuscript(RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r5', richContent(richBlock('  '))), actions()))).units.find((u) => u.role === 'assistant'))
  check('🔴 ㊶ rich-block 속성 누락·빈 값 → 저장 0 (편집기 글자로 대신하지 않는다)',
    !exNoAttr.ok && exNoAttr.code === 'response_rich_block_empty' && !exEmpty.ok && exEmpty.code === 'response_rich_block_empty', `${exNoAttr.code} · ${exEmpty.code}`)
  const exRendered = RESP.extractManuscript(RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('r6', renderedContent()), actions()))).units.find((u) => u.role === 'assistant'))
  check('🔴 ㊶ 그 밖의 형태(렌더된 마크다운만)는 추측하지 않는다 — response_format_unknown',
    !exRendered.ok && exRendered.code === 'response_format_unknown' && exRendered.form === 'unknown', exRendered.code)
  const FK41a = await import('./lib/magazine-failure-kind.mjs')
  check('🔴 ㊶ 보낸 뒤 판독 실패 코드는 전부 전송불명(DELIVERY_UNCERTAIN)이다',
    ['response_format_unknown', 'response_multiple_candidates', 'response_rich_block_empty']
      .every((c) => FK41a.classifyFailure({ code: c, sent: true }).kind === 'DELIVERY_UNCERTAIN'))

  // ── 관찰기: 부분 생성 → 끝 → 안정 ──
  const empty = RESP.readConversationDom(docOf(turn('u0', userUnit('u0'))))
  const w1 = RESP.createResponseWatch(empty, { stablePolls: 2 })
  const partial = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('a3', codeBlockContent(MS.slice(0, 400)))), stopBtn()))
  const o1 = w1.observe(partial)
  const full = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('a3', codeBlockContent(MS)), actions())))
  const o2 = w1.observe(full)
  const o3 = w1.observe(full)
  check('🔴 ㊶ 부분 생성(중지 버튼) 중에는 끝나지 않는다 · 끝난 뒤에도 연속 동일 관찰 전에는 끝나지 않는다',
    !o1.done && o1.phase === 'generating' && !o2.done && o3.done && o3.text === MS,
    JSON.stringify([o1.phase, o2.phase, o3.done]))
  const w1b = RESP.createResponseWatch(empty, { stablePolls: 2 })
  const noActions = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('a3', codeBlockContent(MS)))))
  w1b.observe(noActions)
  check('  ㊶ 새 DOM 에서 완료 액션이 아직 없으면 끝난 것으로 보지 않는다', !w1b.observe(noActions).done, '끝났다고 봤다')
  // 🔴 중지 버튼만이 가르는 반례 — 원문이 같고 완료 액션도 보이는데 생성 중 표시가 남아 있다
  const w1c = RESP.createResponseWatch(empty, { stablePolls: 2 })
  const stillStreaming = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('a3', codeBlockContent(MS)), actions()), stopBtn()))
  const s1c = [w1c.observe(stillStreaming), w1c.observe(stillStreaming), w1c.observe(stillStreaming)]
  const oldUser = () => el('div', { 'data-message-author-role': 'user', 'data-message-id': 'ou0' }, '질문')
  const w1d = RESP.createResponseWatch(RESP.readConversationDom(docOf(oldUser())), { stablePolls: 2 })
  const oldStreaming = RESP.readConversationDom(docOf(oldUser(),
    el('div', { 'data-message-author-role': 'assistant', 'data-message-id': 'o2' }, el('div', { class: 'markdown prose' }, el('pre', {}, el('code', {}, MS)))), stopBtn()))
  const s1d = [w1d.observe(oldStreaming), w1d.observe(oldStreaming), w1d.observe(oldStreaming)]
  check('🔴 ㊶ 생성 중 표시(중지 버튼)가 남아 있으면 원문이 같고 완료 액션이 보여도 끝나지 않는다 (새 DOM · 옛 DOM)',
    s1c.every((o) => !o.done && o.phase === 'generating') && s1d.every((o) => !o.done),
    JSON.stringify([s1c.map((o) => o.done), s1d.map((o) => o.done)]))

  // ── 관찰기: 기존 응답 오인 ──
  const withOld = RESP.readConversationDom(docOf(turn('u0', userUnit('u0'), asstUnit('a0', codeBlockContent(MS)), actions())))
  const w2 = RESP.createResponseWatch(withOld, { stablePolls: 2 })
  const r2a = w2.observe(withOld)
  const r2b = w2.observe(withOld)
  check('🔴 ㊶ 기준선에 있던 (완성된) 응답을 새 응답으로 읽지 않는다', !r2a.done && !r2b.done && r2b.phase === 'waiting', r2b.phase)
  const withNew = RESP.readConversationDom(docOf(
    turn('u0', userUnit('u0'), asstUnit('a0', codeBlockContent('---\n옛 원고\n'), 2), actions()),
    turn('u1', userUnit('u1'), asstUnit('a1', codeBlockContent(MS), 4), actions())))
  w2.observe(withNew)
  const r2c = w2.observe(withNew)
  check('🔴 ㊶ 새로 생긴 응답만 고른다 (이전 응답 무시)', r2c.done && r2c.text === MS && r2c.messageId === 'a1', r2c.messageId)

  // ── 관찰기: 판정 불가 ──
  const two = RESP.readConversationDom(docOf(turn('u1', userUnit('u1'), asstUnit('x1', codeBlockContent(MS), 2), asstUnit('x2', codeBlockContent(MS), 3), actions())))
  const r3 = RESP.createResponseWatch(empty, { stablePolls: 2 }).observe(two)
  const noId = { readOk: true, stop: false, units: [{ id: null, role: 'assistant', source: 'old', candidates: [{ form: 'code-block', text: MS }], text: '', hasActions: false }] }
  const r4 = RESP.createResponseWatch(empty, { stablePolls: 2 }).observe(noId)
  const r5 = RESP.createResponseWatch(withOld, { stablePolls: 2 }).observe(full)
  check('🔴 ㊶ 새 응답 2개 · 식별자 없음 · 기준선 응답 소실 → 판정 불가(저장 0)',
    r3.abort && r3.code === 'response_ambiguous' && r4.abort && r5.abort,
    JSON.stringify([r3.code, r4.code, r5.code]))

  // ── 통합: 실제 fetchManuscript 가 실제 readConversationDom 을 가짜 DOM 위에서 돌린다 ──
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-capture-'))
  try {
    const briefPath = path.join(T, 'brief.md')
    fs.writeFileSync(briefPath, '# brief\n\n본문 지시\n')
    const pageWith = (frames) => {
      let typed = ''
      let sent = false
      let i = 0
      const w = { sends: 0 }
      const page = {
        async close() {}, async goto() {}, async waitForSelector() {}, async waitForTimeout() {},
        url: () => 'https://chatgpt.com/c/conv-1?x=1',
        async evaluate(fn) {
          if (!sent) return fn(docOf(frames.before ?? turn('u0', userUnit('u0'))))
          const f = frames.after[Math.min(i, frames.after.length - 1)]; i += 1
          return fn(f)
        },
        locator(sel) {
          const isSend = /send-button|보내기|Send/.test(String(sel ?? ''))
          const l = { async click() { if (isSend) { sent = true; w.sends += 1 } }, async innerText() { return typed } }
          return { first: () => l, ...l }
        },
        keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
      }
      w.deps = { ensureTab: async () => ({ ok: true }), connect: async () => ({ contexts: () => [{ pages: () => [], newPage: async () => page }], async close() {} }) }
      return w
    }
    const baseDoc = turn('u0', userUnit('u0'))
    const mdFrames = {
      before: baseDoc,
      after: [
        docOf(turn('u1', userUnit('u1'), asstUnit('m1', el('div', { 'data-markdown-text-style': 'assistant-message' }, el('hr', {}))), stopBtn())),
        docOf(turn('u1', userUnit('u1'), asstUnit('m1', richContent(richBlock(fenced(MS), { title: '제목 머리표' }))), actions())),
      ],
    }
    const W1 = pageWith(mdFrames)
    const out1 = path.join(T, 'out1.md')
    const f1 = await SESS41.fetchManuscript({ briefPath, outPath: out1, promptText: '시험', validate: MG41.validateManuscript,
      pollMs: 1, stablePolls: 2, timeoutMs: 2000, ...W1.deps })
    check('🔴 ㊶ [통합] rich-block 응답을 회수해 저장한다 (via rich-block · --- 로 시작 · 관문 통과 · send 1)',
      f1.ok && f1.via === 'rich-block' && fs.existsSync(out1) && fs.readFileSync(out1, 'utf8').startsWith('---\ntitle: 시험 원고') && W1.sends === 1,
      `${f1.reason ?? 'ok'} · via ${f1.via} · send ${W1.sends}`)
    check('  ㊶ [통합] 성공 결과에 응답 식별자·형태를 남긴다', f1.assistantMessageId === 'm1' && f1.responseForm === 'rich-block', `${f1.assistantMessageId} · ${f1.responseForm}`)
    // 🔴 모르는 형태 → 전송불명 중단 · 저장 0 · 추가 send 0 · 실패해도 대화 주소·식별자·형태 보존
    const W5 = pageWith({ before: baseDoc, after: [docOf(turn('u1', userUnit('u1'), asstUnit('m5', renderedContent()), actions()))] })
    const out5 = path.join(T, 'out5.md')
    const f5 = await SESS41.fetchManuscript({ briefPath, outPath: out5, promptText: '시험', validate: MG41.validateManuscript,
      pollMs: 1, stablePolls: 2, timeoutMs: 2000, ...W5.deps })
    check('🔴 ㊶ [통합] 판독 실패 → 저장 0 · 추가 send 0 · 전송불명 · 대화 주소·응답 식별자·형태·stage 보존',
      !f5.ok && f5.reason === 'response_format_unknown' && f5.sent === true && W5.sends === 1 && !fs.existsSync(out5)
        && f5.conversationUrl === 'https://chatgpt.com/c/conv-1' && f5.assistantMessageId === 'm5' && f5.responseForm === 'unknown' && f5.stage === 'await-response',
      JSON.stringify({ r: f5.reason, sends: W5.sends, url: f5.conversationUrl, id: f5.assistantMessageId, form: f5.responseForm, stage: f5.stage }))
    const W6 = pageWith({ before: baseDoc, after: [docOf(turn('u1', userUnit('u1'), asstUnit('m6', richContent(richBlock(fenced('제목 없이 시작한 글')))), actions()))] })
    const f6 = await SESS41.fetchManuscript({ briefPath, outPath: path.join(T, 'out6.md'), promptText: '시험', validate: MG41.validateManuscript,
      pollMs: 1, stablePolls: 2, timeoutMs: 2000, ...W6.deps })
    check('🔴 ㊶ [통합] 관문 실패(invalid_manuscript)도 대화 주소·응답 식별자·형태·stage 를 남긴다',
      !f6.ok && f6.reason === 'invalid_manuscript' && f6.conversationUrl === 'https://chatgpt.com/c/conv-1' && f6.assistantMessageId === 'm6'
        && f6.responseForm === 'rich-block' && f6.stage === 'validate' && W6.sends === 1,
      JSON.stringify({ r: f6.reason, url: f6.conversationUrl, id: f6.assistantMessageId, form: f6.responseForm, stage: f6.stage }))
    check('  ㊶ [통합] 대화 주소를 남긴다 (쿼리 제거)', f1.conversationUrl === 'https://chatgpt.com/c/conv-1', String(f1.conversationUrl))

    const W2 = pageWith({ before: baseDoc, after: [docOf(turn('u1', userUnit('u1'), asstUnit('m2', codeBlockContent(MS.slice(0, 300)))), stopBtn())] })
    const out2 = path.join(T, 'out2.md')
    const f2 = await SESS41.fetchManuscript({ briefPath, outPath: out2, promptText: '시험', validate: MG41.validateManuscript,
      pollMs: 1, stablePolls: 2, timeoutMs: 60, ...W2.deps })
    check('🔴 ㊶ [통합] 부분 생성에서 끝나면 저장 0 · response_timeout · sent=true (전송불명 HOLD)',
      !f2.ok && f2.reason === 'response_timeout' && f2.sent === true && !fs.existsSync(out2), `${f2.reason} · sent ${f2.sent}`)

    const W3 = pageWith({ before: turn('u0', userUnit('u0'), asstUnit('p0', codeBlockContent(MS)), actions()),
      after: [docOf(turn('u0', userUnit('u0'), asstUnit('p0', codeBlockContent(MS)), actions()))] })
    const out3 = path.join(T, 'out3.md')
    const f3 = await SESS41.fetchManuscript({ briefPath, outPath: out3, promptText: '시험', validate: MG41.validateManuscript,
      pollMs: 1, stablePolls: 2, timeoutMs: 60, ...W3.deps })
    check('🔴 ㊶ [통합] 이전 대화의 완성된 응답을 이번 원고로 저장하지 않는다', !f3.ok && !fs.existsSync(out3), `${f3.reason}`)

    const W4 = pageWith({ before: baseDoc, after: [docOf(turn('u1', userUnit('u1'), asstUnit('q1', codeBlockContent(MS), 2), asstUnit('q2', codeBlockContent(MS), 3), actions()))] })
    const f4 = await SESS41.fetchManuscript({ briefPath, outPath: path.join(T, 'out4.md'), promptText: '시험',
      pollMs: 1, stablePolls: 2, timeoutMs: 2000, ...W4.deps })
    const FK41 = await import('./lib/magazine-failure-kind.mjs')
    check('🔴 ㊶ [통합] 새 응답을 가릴 수 없으면 저장 0 · 전송불명으로 분류된다',
      !f4.ok && f4.reason === 'response_ambiguous' && f4.sent === true
        && FK41.classifyFailure({ code: f4.reason, stage: f4.stage, sent: f4.sent }).kind === 'DELIVERY_UNCERTAIN',
      `${f4.reason}`)
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊷ 등록 경로의 회수 결과 — 구조화 결과가 정본 · HOLD·전송불명은 attempts 0')
{
  /**
   * 🔴 **2026-09-28 실측.** drive 가 회수 자식의 **사람용 출력**("⏸ HOLD — 이미 보낸 글이다")을 사유로 넘겼고,
   *    분류기가 CONTENT 로 추정해 원고 잘못이 아닌 4건이 attempts +1 · 7일 격리에 걸렸다.
   *    실제 drive → 실제 ready 로 돌리고, 자식 자리는 **자식이 실제로 쓰는 결과 파일**을 적는다.
   */
  const READY42 = await import('./magazine-auto-register-ready.mjs')
  const FR42 = await import('./lib/magazine-fetch-result.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-fetch-class-'))
  try {
    const run = (name, childRow, { code = 1, noFile = false, broken = false } = {}) => {
      const L = path.join(T, `${name}.json`)
      saveQuarantine({ [SLUG]: { attempts: 2, regenCalls: 0 } }, L)
      const deps = makeDeps({ qaFailsUntil: 0, ledgerPath: L, packetDir: path.join(T, `${name}-p`), calls: [] })
      deps.progress = () => ({ hasBrief: true, hasReview: true, hasDraftMd: false, hasArticleTs: false })
      deps.fetchResultDir = T
      const baseRun = deps.run
      deps.run = (file, args, opts) => {
        if (path.basename(String(file)) === 'magazine-webui-runner.mjs' && args.includes('--result-json')) {
          const rj = args[args.indexOf('--result-json') + 1]
          if (broken) fs.writeFileSync(rj, '{ 깨진')
          else if (!noFile) FR42.writeFetchResults(rj, { mode: 'fetch-one', results: [{ slug: SLUG, ...childRow }], sentTotal: childRow.sent === true ? 1 : 0 })
          return { code, stdout: '⏸ HOLD — 이미 보낸 글이다', stderr: '', json: null }
        }
        return baseRun(file, args, opts)
      }
      const report = { blocked: [], done: [] }
      const r = READY42.processCandidates({ write: true, wantPr: false, limit: 1, report, quarantinePath: L,
        scanFn: () => ({ source: 'fixture', pool: 1, eligible: [{ slug: SLUG, item: FIXTURE_QUEUE[0], progress: { hasBrief: true, hasReview: true, hasDraftMd: false } }], skipped: [], quarantined: [] }),
        driveFn: (sl, o) => drive(sl, o, deps) })
      const res = r.results[0] ?? {}
      const e = readQuarantine(L).store[SLUG] ?? {}
      return { res, e, msg: (res.blockedBy ?? []).map((b) => `${b.code}: ${b.message}`).join(' | ') }
    }
    const held = run('held', { status: 'held', reason: 'DELIVERY_UNCERTAIN_HOLD', stage: 'gate', sent: false, errorDetail: '이미 보낸 글이다' })
    // 🔴 HOLD 는 장부를 쓰지 않는다 (㊸) — 이미 적힌 전송 사실이 정본이다. 원고 격리도 없다
    check('🔴 ㊷ HOLD 결과 → [DELIVERY_UNCERTAIN] · attempts 증가 0 · 7일 CONTENT 격리 0 · 장부 쓰기 0',
      /\[DELIVERY_UNCERTAIN\]/.test(held.msg) && held.e.attempts === 2 && held.e.kind === undefined && held.res.held === true,
      `attempts ${held.e.attempts} · kind ${held.e.kind} · held ${held.res.held} · ${held.msg.slice(0, 80)}`)
    const tout = run('timeout', { status: 'failed', reason: 'response_timeout', stage: 'await-response', sent: true })
    check('🔴 ㊷ 보낸 뒤 응답 timeout → DELIVERY_UNCERTAIN · attempts 증가 0 · sent 보존',
      tout.e.attempts === 2 && tout.e.kind === 'DELIVERY_UNCERTAIN' && tout.e.sent === true, `attempts ${tout.e.attempts} · kind ${tout.e.kind} · sent ${tout.e.sent}`)
    const miss = run('missing', {}, { code: 0, noFile: true })
    check('🔴 ㊷ 결과 파일 누락 → CONTENT 로 추정하지 않는다 (전송불명 · sent 모름 · attempts 0)',
      /FETCH_RESULT_MISSING/.test(miss.msg) && miss.e.attempts === 2 && miss.e.kind === 'DELIVERY_UNCERTAIN' && miss.e.sent === null,
      `attempts ${miss.e.attempts} · kind ${miss.e.kind} · sent ${miss.e.sent}`)
    const brk = run('broken', {}, { broken: true })
    check('🔴 ㊷ 결과 파일 손상 → 같은 fail-closed', brk.e.attempts === 2 && brk.e.kind === 'DELIVERY_UNCERTAIN', `attempts ${brk.e.attempts} · kind ${brk.e.kind}`)
    const content = run('content', { status: 'failed', reason: 'invalid_manuscript', stage: 'await-response', sent: true })
    void content
    const cont2 = run('content2', { status: 'failed', reason: 'markers_missing', stage: 'await-response', sent: false })
    check('  ㊷ [대조군] 전송 안 된 진짜 내용 실패는 CONTENT 로 센다 (죽은 분류가 아니다)',
      cont2.e.attempts === 3 && cont2.e.kind === 'CONTENT', `attempts ${cont2.e.attempts} · kind ${cont2.e.kind}`)
    const okRun = run('ok', { status: 'ok', sent: true }, { code: 0 })
    check('  ㊷ 성공 결과는 회수로 친다 (결과 파일 행 · status ok)', !/FETCH_/.test(okRun.msg) && (okRun.res.steps ?? []).some((s) => s.stage === 'draft' && s.status === 'ok'),
      (okRun.res.steps ?? []).map((s) => `${s.stage}:${s.status}`).join(' '))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊸ HOLD 는 처리 자리를 쓰지 않는다 — 시도·등록 상한 소비 0 · runner·전송 0')
{
  /**
   * 🔴 **2026-09-29 01:00 실측.** gate 통과 8건이 전부 같은 지문 HOLD 였고, 시도 상한 9 중 8을 먹었다.
   *    전송 0 · 등록 0 · PR 0. HOLD 는 할 일이 없다는 뜻이지 시도가 아니다.
   *    ① 실제 drive → 실제 ready (추적 fixture 3건) 로 배선을 본다  ② 그 결과 객체를 복제해 예산 계약을 본다.
   */
  const READY43 = await import('./magazine-auto-register-ready.mjs')
  const DG43 = await import('./lib/magazine-delivery-gate.mjs')
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-hold-budget-'))
  const [A, B, C] = FIXTURE_SLUGS
  const holdRow = (fp) => ({ attempts: 2, delivery: { sent: null, messageFingerprint: fp, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: '2026-09-28', reservationId: 'r-old' } })
  try {
    // ── 재생성 HOLD 에 쓸 실제 패킷 지문을 잡는다 (첫 실행: runner 가 패킷을 받고 실패) ──
    const L0 = path.join(T, 'capture.json')
    saveQuarantine({}, L0)
    const seen0 = []
    const d0 = makeDeps({ qaFailsUntil: 9, ledgerPath: L0, packetDir: path.join(T, 'p0'), calls: [], packetsSeen: seen0, runnerFails: true })
    d0.progress = () => ({ hasBrief: true, hasReview: true, hasDraftMd: true, hasArticleTs: true })
    d0.firstFetchResult = null
    drive(B, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트', allowOptional: true, autoLane: true }, d0)
    const regenFp = seen0[0] ? DG43.deliveryGate({ slug: B, packet: seen0[0].packet, quarantinePath: L0 }).messageFingerprint : null
    const fetchFp = DG43.deliveryGate({ slug: A, quarantinePath: L0 }).messageFingerprint
    check('  ㊸ 시험 전제 — 실제 회수·재생성 메시지 지문을 잡았다', Boolean(regenFp && fetchFp), `${fetchFp?.slice(0, 16)} · ${regenFp?.slice(0, 16)}`)

    // ── ① 실제 drive → 실제 ready: 직접 회수 HOLD(A) · 재생성 HOLD(B) · 정상(C) ──
    const L = path.join(T, 'q.json')
    saveQuarantine({ [A]: holdRow(fetchFp), [B]: holdRow(regenFp) }, L)
    const calls = []
    const d1 = makeDeps({ qaFailsUntil: 9, ledgerPath: L, packetDir: path.join(T, 'p1'), calls, runnerFails: true })
    d1.progress = (sl) => ({ hasBrief: true, hasReview: true, hasDraftMd: sl === B, hasArticleTs: sl === B })
    d1.firstFetchResult = null
    d1.fetchResultDir = T
    const report = { blocked: [], done: [] }
    const r1 = READY43.processCandidates({ write: true, wantPr: false, limit: 1, report, quarantinePath: L,
      scanFn: () => ({ source: 'fixture', pool: 3, eligible: [A, B, C].map((sl) => ({ slug: sl, item: FIXTURE_QUEUE.find((q) => q.slug === sl), progress: d1.progress(sl) })), skipped: [], quarantined: [] }),
      driveFn: (sl, o) => drive(sl, o, d1) })
    const byA = r1.results.find((x) => x.slug === A)
    const byB = r1.results.find((x) => x.slug === B)
    const webui = calls.filter((c) => c === 'magazine-webui-runner.mjs').length
    const regenCallsN = calls.filter((c) => c.startsWith('REGEN:')).length
    check('🔴 ㊸ 직접 회수 HOLD — runner 0 · 전송 0 · held (부모 앞단 판정)',
      byA?.held === true && byA.blockedBy?.[0]?.code === 'DELIVERY_UNCERTAIN_HOLD', `${byA?.blockedBy?.[0]?.code} · held ${byA?.held}`)
    check('🔴 ㊸ 재생성 HOLD — 재생성 runner 0 · held',
      byB?.held === true && regenCallsN === 0, `${byB?.blockedBy?.[0]?.message?.slice(0, 60)} · held ${byB?.held} · regen ${regenCallsN}`)
    check('🔴 ㊸ HOLD 두 건 뒤 정상 후보가 처리된다 (회수 runner 는 정상 후보 1번만)',
      webui === 1 && r1.results.some((x) => x.slug === C && !x.held), `webui ${webui} · ${r1.results.map((x) => `${x.slug}:${x.held ? 'H' : x.verdict}`).join(' ')}`)
    check('🔴 ㊸ 시도 수는 실제 작업한 후보만 — attempted 1 · HOLD 2 (직접·재생성 혼합 모두 소비 0)',
      r1.attempted === 1 && r1.held.length === 2, `attempted ${r1.attempted} · held ${r1.held.length}`)
    const st1 = readQuarantine(L).store
    check('🔴 ㊸ HOLD 행은 장부에서 한 글자도 바뀌지 않는다 (전송 사실 보존)',
      JSON.stringify(st1[A]) === JSON.stringify(holdRow(fetchFp)) && JSON.stringify(st1[B]) === JSON.stringify(holdRow(regenFp)),
      JSON.stringify([st1[A]?.attempts, st1[B]?.attempts, st1[A]?.kind, st1[B]?.kind]))

    // ── 지문 변경 → 새 작업 ──
    const L2 = path.join(T, 'changed.json')
    saveQuarantine({ [A]: holdRow('sha256:brief-before-change') }, L2)
    const c2 = []
    const d2 = makeDeps({ qaFailsUntil: 0, ledgerPath: L2, packetDir: path.join(T, 'p2'), calls: c2 })
    d2.progress = () => ({ hasBrief: true, hasReview: true, hasDraftMd: false, hasArticleTs: false })
    d2.fetchResultDir = T
    const r2 = drive(A, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트', allowOptional: true, autoLane: true }, d2)
    check('🔴 ㊸ brief 가 바뀌어 지문이 다르면 HOLD 가 아니다 — 새 작업으로 runner 가 돈다',
      !r2.held && c2.includes('magazine-webui-runner.mjs'), `held ${r2.held} · ${c2.join(' → ')}`)

    // ── 장부 손상 → runner 0 · failClosed · 회차 정지 ──
    const L3 = path.join(T, 'broken.json')
    fs.writeFileSync(L3, '{ 깨진')
    const c3 = []
    const d3 = makeDeps({ qaFailsUntil: 0, ledgerPath: L3, packetDir: path.join(T, 'p3'), calls: c3 })
    d3.progress = () => ({ hasBrief: true, hasReview: true, hasDraftMd: false, hasArticleTs: false })
    d3.fetchResultDir = T
    const r3 = drive(A, { write: true, pr: false, publishAt: '2027-01-05', alt: '테스트', allowOptional: true, autoLane: true }, d3)
    check('🔴 ㊸ 장부 손상 — HOLD 여부를 모르면 runner 0 · 전송 0 · failClosed',
      r3.failClosed === true && !r3.held && !c3.includes('magazine-webui-runner.mjs'), `failClosed ${r3.failClosed} · ${c3.join(' → ')}`)
    const report3 = { blocked: [], done: [] }
    const r3b = READY43.processCandidates({ write: true, wantPr: false, limit: 3, report: report3, quarantinePath: L3,
      scanFn: () => ({ source: 'fixture', pool: 3, eligible: [A, B, C].map((sl) => ({ slug: sl, item: FIXTURE_QUEUE.find((q) => q.slug === sl) })), skipped: [], quarantined: [] }),
      driveFn: (sl, o) => drive(sl, o, d3) })
    check('🔴 ㊸ 장부 손상 회차 — 후보 0건 구동 · 전체 fail-closed 보고',
      r3b.results.length === 0 && report3.ledgerHold?.code === 'QUARANTINE_UNREADABLE', `구동 ${r3b.results.length} · ${report3.ledgerHold?.code}`)

    // ── ② 예산 계약 — 실제 drive 가 돌려준 HOLD·failClosed 결과를 복제한다 (가짜가 실제보다 강하지 않게) ──
    const heldProto = byA
    const closedProto = r3
    const clone = (proto, slug) => ({ ...JSON.parse(JSON.stringify(proto)), slug })
    const budgetRun = (plan, limit) => {
      const LB = path.join(T, `b-${Math.random().toString(36).slice(2)}.json`)
      saveQuarantine(Object.fromEntries(plan.filter((x) => x.kind === 'hold').map((x) => [x.slug, holdRow('sha256:x')])), LB)
      const driven = []
      const rep = { blocked: [], done: [] }
      const r = READY43.processCandidates({ write: true, wantPr: false, limit, report: rep, quarantinePath: LB,
        scanFn: () => ({ source: 'fixture', pool: plan.length, eligible: plan.map((x) => ({ slug: x.slug })), skipped: [], quarantined: [] }),
        driveFn: (sl) => {
          driven.push(sl)
          const x = plan.find((y) => y.slug === sl)
          if (x.kind === 'hold') return clone(heldProto, sl)
          if (x.kind === 'closed') return clone(closedProto, sl)
          if (x.kind === 'done') return { slug: sl, verdict: 'DONE', steps: [], blockedBy: [] }
          return { slug: sl, verdict: 'BLOCKED', steps: [], blockedBy: [{ code: 'QA_FAIL', message: 'magazine QA FAIL — 시험' }], sent: false }
        } })
      return { r, driven, rep, LB }
    }
    const H = (n, p = 'h') => Array.from({ length: n }, (_, i) => ({ slug: `${p}${i + 1}`, kind: 'hold' }))
    const N = (n, kind = 'fail', p = 'n') => Array.from({ length: n }, (_, i) => ({ slug: `${p}${i + 1}`, kind }))
    const b1 = budgetRun([...H(8), ...N(1)], 3)
    check('🔴 ㊸ 앞에 HOLD 8건 · 뒤에 정상 1건 → 정상 후보 처리 · attempted 1',
      b1.driven.includes('n1') && b1.r.attempted === 1 && b1.r.held.length === 8, `attempted ${b1.r.attempted} · held ${b1.r.held.length}`)
    const b2 = budgetRun([...H(9), ...N(3)], 3)
    check('🔴 ㊸ HOLD 9건 · 정상 3건 · 시도 상한 9 → 정상 3건 모두 처리 · attempted 3',
      ['n1', 'n2', 'n3'].every((x) => b2.driven.includes(x)) && b2.r.attempted === 3 && b2.r.ceiling === 9,
      `attempted ${b2.r.attempted} · ceiling ${b2.r.ceiling} · stop ${b2.r.budgetStop?.code ?? '-'}`)
    const b3 = budgetRun(H(30), 3)
    check('🔴 ㊸ HOLD 만 있는 회차 → 유한 종료 · 등록 0 · attempted 0 · HOLD 30건 보고',
      b3.r.results.length === 30 && b3.r.registered === 0 && b3.r.attempted === 0 && b3.r.held.length === 30 && b3.r.budgetStop === null,
      `results ${b3.r.results.length} · held ${b3.r.held.length} · stop ${b3.r.budgetStop?.code ?? 'EXHAUSTED'}`)
    const b4 = budgetRun(N(12), 3)
    check('🔴 ㊸ 기존 시도 상한 유지 — 정상 실패 12건이면 9건에서 멈춘다',
      b4.r.attempted === 9 && b4.driven.length === 9 && b4.r.budgetStop?.code === 'ATTEMPT_CEILING', `attempted ${b4.r.attempted} · driven ${b4.driven.length}`)
    const b5 = budgetRun([...H(4), ...N(5, 'done', 'd')], 3)
    check('🔴 ㊸ 기존 등록 상한 유지 — HOLD 사이에서도 등록 3건에서 멈춘다',
      b5.r.registered === 3 && b5.r.budgetStop?.code === 'BUDGET_MET' && b5.r.held.length === 4, `registered ${b5.r.registered} · ${b5.r.budgetStop?.code}`)
    const b6 = budgetRun([...N(1, 'fail', 'a'), { slug: 'x1', kind: 'closed' }, ...N(3, 'fail', 'z')], 3)
    check('🔴 ㊸ 회차 중 HOLD 판정 불가(장부 못 읽음) → 그 자리에서 회차 정지 · 뒤 후보 구동 0',
      b6.driven.join(',') === 'a1,x1' && b6.r.budgetStop?.code === 'LEDGER_UNREADABLE' && b6.rep.ledgerHold?.code === 'QUARANTINE_UNREADABLE',
      `driven ${b6.driven.join(',')} · ${b6.r.budgetStop?.code}`)
    const st6 = readQuarantine(b1.LB).store
    check('  ㊸ HOLD 는 장부를 쓰지 않고 정상 실패만 센다 (대조군)',
      st6.h1?.attempts === 2 && st6.h1?.kind === undefined && st6.n1?.attempts === 1 && st6.n1?.kind === 'CONTENT',
      JSON.stringify([st6.h1, st6.n1?.attempts, st6.n1?.kind]))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log('\n㊹ 무전송 회수 — 이미 온 응답만 읽는다 · send·composer 0 · 신원·지문 불일치면 저장 0')
{
  /**
   * 🔴 **2026-09-30 실측.** 원고는 rich-block 으로 온전히 왔는데 판독 결함으로 저장 0 · 같은 지문 HOLD.
   *    다시 보내지 않고, 신원이 확정된 그 대화에서만 원문을 읽는다. 실제 `recoverSlug` → 실제 `recoverManuscript`.
   */
  const W44 = await import('./magazine-webui-runner.mjs')
  const DG44 = await import('./lib/magazine-delivery-gate.mjs')
  const FR44 = await import('./lib/magazine-fetch-result.mjs')
  const SLUG44 = 'recover-canary'
  const DATE44 = '2026-09-30'
  const URL44 = 'https://chatgpt.com/c/6abc5296-452c-83ee-8788-44b8b66c8308'
  const el44 = (tag, attrs = {}, ...kids) => {
    const node = { tagName: tag.toUpperCase(), parentElement: null, attrs, kids: [] }
    node.getAttribute = (k) => (k in attrs ? String(attrs[k]) : null)
    for (const k of kids.flat()) if (k && typeof k === 'object') { k.parentElement = node; node.kids.push(k) } else if (k !== undefined && k !== null) node.kids.push(String(k))
    Object.defineProperty(node, 'children', { get: () => node.kids.filter((k) => typeof k === 'object') })
    Object.defineProperty(node, 'textContent', { get: () => node.kids.map((k) => (typeof k === 'object' ? k.textContent : k)).join('') })
    return node
  }
  const doc44 = (...kids) => ({ body: el44('body', {}, el44('main', {}, ...kids)) })
  const MS44 = `---\ntitle: 시험 회수\ndescription: 우리 또래가 오래된 친구에게 먼저 연락할지 망설이는 마음을 천천히 들여다보는 시험 원고입니다\ncluster: relationship\n---\n\n## 첫 문단\n${'오래된 이름 앞에서 손이 멈추는 날이 있습니다. '.repeat(60)}\n\n[CTA] /community/free | 이야기 남기기 | 남겨 주세요\n`
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'm3a-recover-'))
  try {
    const drafts = path.join(T, 'drafts')
    fs.mkdirSync(path.join(drafts, SLUG44), { recursive: true })
    fs.writeFileSync(path.join(drafts, SLUG44, 'brief.md'), '# 시험 brief\n\n본문 지시 `코드` 표시가 있다\n')
    const planned = DG44.plannedMessageFor(SLUG44, drafts)
    const fp = DG44.deliveryGate({ slug: SLUG44, draftsDir: drafts, quarantinePath: path.join(T, 'none.json') }).messageFingerprint
    const deliveryRow = { sent: null, messageFingerprint: fp, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: 'r1', date: DATE44, reservationId: 'res-44' }
    const setup = (name, { ledgerFp = fp, rowUrl = null, rowFp = fp } = {}) => {
      const L = path.join(T, `${name}-q.json`)
      saveQuarantine({ [SLUG44]: { attempts: 1, regenCalls: 1, delivery: { ...deliveryRow, messageFingerprint: ledgerFp } } }, L)
      const R = path.join(T, `${name}-r.json`)
      FR44.writeFetchResults(R, { date: DATE44, runId: 'r1', mode: 'fetch-run', sentTotal: 1,
        results: [{ slug: SLUG44, status: 'failed', reason: 'invalid_manuscript', sent: true, messageFingerprint: rowFp, conversationUrl: rowUrl }] })
      const draft = path.join(drafts, SLUG44, 'draft.md')
      fs.rmSync(draft, { force: true })
      return { L, R, draft }
    }
    const userBubble = (t) => el44('div', { 'data-chatgpt-search-unit-key': 'fallback-turn-0:0:user', 'data-chatgpt-search-message-ids': 'u-1' },
      el44('div', { 'data-user-message-bubble': 'true' }, el44('div', {}, String(t).replace(/`/g, ''))), el44('button', { 'aria-label': '메시지 복사' }))
    const asst = (id, raw) => el44('div', { 'data-chatgpt-search-unit-key': 'fallback-turn-0:1:assistant', 'data-chatgpt-search-message-ids': id },
      el44('div', { 'data-markdown-text-style': 'assistant-message' }, el44('div', { 'data-markdown-copy': 'rich-block', 'data-markdown-copy-text': raw },
        el44('header', {}, '오랜만인 친구에게 먼저 연락해도 될까요?'), el44('div', { contenteditable: 'true', role: 'textbox' }, el44('pre', {}, el44('code', {}, MS44))))))
    const turn44 = (...kids) => el44('div', { 'data-turn-key': 't1' }, ...kids, el44('button', { 'aria-label': '응답 다시 생성' }))
    const fenced44 = '```markdown\n' + MS44.replace(/\n$/, '') + '\n```'
    const fakeBrowser = (docFn, { landUrl = URL44 } = {}) => {
      const w = { sends: 0, typed: 0, locators: 0, opened: 0 }
      let cur = null
      const page = {
        async goto(u) { cur = u; w.opened += 1 }, async waitForTimeout() {}, async close() {},
        url: () => landUrl ?? cur,
        async evaluate(fn) { return fn(docFn()) },
        locator() { w.locators += 1; return { first: () => ({ async click() { w.sends += 1 } }), async click() { w.sends += 1 } } },
        keyboard: { async insertText() { w.typed += 1 }, async press() { w.typed += 1 } },
      }
      w.deps = { ensureTab: async () => ({ ok: true }), connect: async () => ({ contexts: () => [{ newPage: async () => page }], async close() {} }), settleMs: 0 }
      return w
    }
    const okAccess = async () => ({ status: 'ok' })
    const run44 = (paths, w, opts = {}) => W44.recoverSlug(SLUG44, { conversationUrl: URL44, date: DATE44, resultPath: paths.R, quarantinePath: paths.L,
      draftsDir: drafts, browserDeps: w.deps, accessFn: okAccess, ...opts })

    // ── 성공: 기존 응답 1건 회수 ──
    const P1 = setup('ok')
    const B1 = fakeBrowser(() => doc44(turn44(userBubble(planned), asst('a-44', fenced44))))
    const r1 = await run44(P1, B1)
    const e1 = readQuarantine(P1.L).store[SLUG44] ?? {}
    const row1 = FR44.readFetchResults(P1.R).body
    const d1 = fs.existsSync(P1.draft) ? fs.readFileSync(P1.draft, 'utf8') : ''
    check('🔴 ㊹ 기존 응답 1건 회수 — draft 는 --- 로 시작 · 제목 머리표 없음 · 원문 그대로',
      r1.status === 'ok' && d1 === MS44.replace(/\n$/, '') && d1.startsWith('---\n') && !d1.includes('오랜만인 친구에게'), `${r1.status} ${r1.reason ?? ''} ${r1.errorDetail ?? ''} · ${d1.length}`)
    check('🔴 ㊹ 재전송 0 — send 클릭 0 · composer 입력 0 · locator 0', B1.sends === 0 && B1.typed === 0 && B1.locators === 0, JSON.stringify(B1))
    check('🔴 ㊹ 같은 지문 DELIVERY_UNCERTAIN 만 성공 경로처럼 해소 · attempts·regenCalls 증가 0',
      e1.delivery === undefined && e1.attempts === 1 && e1.regenCalls === 1 && r1.released === true, JSON.stringify(e1))
    check('🔴 ㊹ 구조화 결과를 status ok 로 기록 · sentTotal 1 그대로 · 대화 주소·응답 식별자·형태',
      row1.results[0].status === 'ok' && row1.sentTotal === 1 && row1.runId === 'r1' && row1.results[0].conversationUrl === URL44
        && row1.results[0].assistantMessageId === 'a-44' && row1.results[0].responseForm === 'rich-block', JSON.stringify(row1.results[0]))
    check('  ㊹ 회수 뒤 slug lease 잔여 0', !fs.existsSync(path.join(T, 'magazine-manuscript-leases', `${SLUG44}.lease`)))

    // ── 반례: 하나라도 어긋나면 저장 0 · 장부 불변 ──
    const refuse = async (name, setupOpts, docFn, browserOpts = {}, runOpts = {}) => {
      const P = setup(name, setupOpts)
      const before = fs.readFileSync(P.L, 'utf8')
      const B = fakeBrowser(docFn, browserOpts)
      const r = await run44(P, B, runOpts)
      return { r, B, kept: fs.readFileSync(P.L, 'utf8') === before, noDraft: !fs.existsSync(P.draft),
        rowFailed: FR44.readFetchResults(P.R).body.results[0].status === 'failed' }
    }
    const good = () => doc44(turn44(userBubble(planned), asst('a-44', fenced44)))
    const x1 = await refuse('fp', { ledgerFp: 'sha256:other' }, good)
    check('🔴 ㊹ 지문 불일치 → 저장 0 · 기존 HOLD 유지 · 대화를 열지 않는다',
      x1.r.reason === 'recover_fingerprint_mismatch' && x1.kept && x1.noDraft && x1.B.opened === 0, `${x1.r.reason} · opened ${x1.B.opened}`)
    const x2 = await refuse('who', {}, () => doc44(turn44(userBubble('사람이 쓴 다른 대화입니다'), asst('a-44', fenced44))))
    check('🔴 ㊹ 대화의 사용자 메시지가 우리가 보낸 것과 다르면 저장 0 · HOLD 유지',
      x2.r.reason === 'recover_identity_mismatch' && x2.kept && x2.noDraft && x2.rowFailed, x2.r.reason)
    const x3 = await refuse('redirect', {}, good, { landUrl: 'https://chatgpt.com/' })
    check('🔴 ㊹ 다른 주소로 열리면 저장 0', x3.r.reason === 'recover_identity_mismatch' && x3.kept && x3.noDraft, x3.r.reason)
    const x4 = await refuse('two', {}, () => doc44(turn44(userBubble(planned), asst('a-44', fenced44), asst('a-45', fenced44))))
    check('🔴 ㊹ 응답이 둘 이상인 대화 → 저장 0 (한 번 보낸 한 대화가 아니다)', x4.r.reason === 'recover_identity_mismatch' && x4.kept && x4.noDraft, x4.r.reason)
    const x5 = await refuse('url', { rowUrl: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, good)
    check('🔴 ㊹ 결과 행의 대화 주소와 다르면 저장 0', x5.r.reason === 'recover_identity_mismatch' && x5.kept && x5.noDraft && x5.B.opened === 0, x5.r.reason)
    const x6 = await refuse('form', {}, () => doc44(turn44(userBubble(planned), asst('a-44', ''))))
    check('🔴 ㊹ rich-block 원문 속성이 비었으면 저장 0 · HOLD 유지', x6.r.reason === 'response_rich_block_empty' && x6.kept && x6.noDraft, x6.r.reason)
    const x7 = await refuse('check', {}, good, {}, { checkOnly: true })
    check('🔴 ㊹ --check 는 신원·원문·관문까지만 — 쓰기 0 · 장부 불변', x7.r.status === 'ok' && x7.r.checkOnly === true && x7.kept && x7.noDraft && x7.rowFailed, x7.r.status)
    const x8 = await refuse('access', {}, good, {}, { accessFn: async () => ({ status: 'profile_mismatch' }) })
    check('🔴 ㊹ 전용 자동화 프로필 신원 확인 실패 → 대화를 열지 않는다 · 저장 0', x8.r.status === 'failed' && x8.B.opened === 0 && x8.kept && x8.noDraft, x8.r.reason)
    const P9 = setup('exists')
    fs.writeFileSync(P9.draft, '사람이 둔 원고')
    const r9 = await run44(P9, fakeBrowser(good))
    check('  ㊹ draft.md 가 이미 있으면 덮지 않는다', r9.reason === 'recover_draft_exists' && fs.readFileSync(P9.draft, 'utf8') === '사람이 둔 원고', r9.reason)
    fs.rmSync(P9.draft, { force: true })
    const all = [B1, x1.B, x2.B, x3.B, x4.B, x5.B, x6.B, x7.B, x8.B]
    check('🔴 ㊹ 모든 회수 시도에서 send·composer 호출 합계 0', all.every((b) => b.sends === 0 && b.typed === 0 && b.locators === 0))
    const src44 = fs.readFileSync('scripts/lib/chatgpt-session.mjs', 'utf8')
    const body44 = src44.slice(src44.indexOf('export async function recoverManuscript'), src44.indexOf('export async function fetchManuscript'))
    check('  ㊹ 회수 함수 본문에 composer·send·keyboard 경로가 없다', !/composerLocator|send-button|keyboard|insertText|\.click\(/.test(body44))
  } finally { fs.rmSync(T, { recursive: true, force: true }) }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL`)
if (fail) for (const f of fails) console.log(`  🔴 ${f}`)
process.exit(fail === 0 ? 0 : 1)
