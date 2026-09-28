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
import { attemptRegeneration, MAX_REGEN_CALLS, packetPathFor, readPacket } from './lib/magazine-regen.mjs'
import { readQuarantine, saveQuarantine } from './lib/magazine-quarantine.mjs'
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
      if (runnerThrows) throw new Error('재생성 경로 폭발')
      fpN += 1
      if (runnerFails) return { ok: false, why: '재생성 경로 실패(시험)' }
      return { ok: true }
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
      !fs.existsSync(packetPathFor(SLUG, packetDir)), packetPathFor(SLUG, packetDir))
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
          return sc.runner()
        },
        quarantinePath: ledgerPath, packetDir,
      })
      check(`  [${sc.name}] runner 가 읽을 때 패킷 파일이 있었다`, sawFile === true)
      check(`  [${sc.name}] runner 가 패킷 내용을 받았다`,
        sawPacket?.slug === 'pkt-slug' && sawPacket?.failures?.[0]?.code === 'MED_DIAGNOSIS')
      check(`🔴 [${sc.name}] 반환 뒤 패킷 파일 0`,
        !fs.existsSync(packetPathFor('pkt-slug', packetDir)))
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
          runner: () => { calls += 1; return { ok: true } },
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
        runner: () => { runnerCalls2 += 1; return { ok: true } },
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
    const good = { schemaVersion: REGEN_PACKET_SCHEMA, slug: 'sample-slug', profile: 'MEDICAL',
      attempt: 1, failures: [{ code: 'MED_DIAGNOSIS', label: '진단 확정', sentence: 'x' }],
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
    const okRead = readRegenPacket(w('good.json', JSON.stringify(good)), 'sample-slug')
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
      let spawned = 0
      const spawnFn = () => { spawned += 1; return { unref() {} } }
      // 🔴 프로필도 임시 fixture 다 — 실제 프로필이 살아 있든 죽었든 결과가 같아야 한다
      const rs = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, spawnFn, cdpCheck: async () => false, browserCheck: () => true,
        profileDir: dead,
      })
      check('🔴 반례2 죽은 잠금이면 기동을 시도한다', spawned === 1, `spawn ${spawned}회 · lock ${rs.lock?.state}`)

      /** 🔴 브라우저가 아예 없으면 띄우려 들지 않는다 — 그 판정은 그대로 살아 있다 */
      let spawned2 = 0
      const rNoBrowser = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => false, browserCheck: () => false, profileDir: dead,
        spawnFn: () => { spawned2 += 1; return { unref() {} } },
      })
      check('🔴 반례2 브라우저가 없으면 BROWSER_MISSING · spawn 0회',
        rNoBrowser.ok === false && rNoBrowser.reason === SESSION.STATUS.BROWSER_MISSING && spawned2 === 0,
        `${rNoBrowser.reason} · spawn ${spawned2}회`)

      /** 🔴 CDP 가 이미 살아 있으면 띄우지 않는다 */
      let spawned3 = 0
      const rAlive = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => true, browserCheck: () => true, profileDir: dead,
        spawnFn: () => { spawned3 += 1; return { unref() {} } },
      })
      check('  반례2 CDP 가 살아 있으면 기동하지 않는다',
        rAlive.ok === true && rAlive.started === false && spawned3 === 0, `spawn ${spawned3}회`)

      /** 🔴 살아 있는 프로필이면 띄우지 않는다 — 남의 창을 빼앗지 않는다 */
      let spawned4 = 0
      const rLive = await SESSION.ensureChrome({
        waitMs: 60, pollMs: 20, cdpCheck: async () => false, browserCheck: () => true, profileDir: live,
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
          contexts: () => [{ pages: () => [existing], newPage: async () => newPage() }],
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
        const r = await SESSION2.fetchManuscript({
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
        const r = await SESSION2.fetchManuscript({
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
        await SESSION2.fetchManuscript({
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
      await SESSION2.fetchManuscript({
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
        contexts: () => [{ pages: () => [], newPage: async () => newPage() }],
        async close() {},
      }
      return world
    }

    for (const [label, bytes] of [['실제 최대', REAL_MAX], ['경계(2배)', REAL_MAX * 2]]) {
      const briefPath = path.join(T, `brief-${bytes}.md`)
      fs.writeFileSync(briefPath, makeBrief(bytes))
      const real = fs.statSync(briefPath).size
      const w = makeWorld()
      const r = await SESSION3.fetchManuscript({
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
  check('🔴 ㉓[4] 비-ChatGPT 페이지 → 차단', r4.ok === false && /ChatGPT 가 아닌/.test(r4.why), r4.why)

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
  const leaked = plists.filter((f) => /SORAN_MAGAZINE_(DRAFTS_DIR|TEST_MODE)/.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8')))
  check('🔴 ㉔ launchd plist 에 시험 변수가 없다', leaked.length === 0,
    leaked.join(', ') || `검사한 plist ${plists.length}개`)
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  const badScripts = Object.entries(pkg.scripts ?? {})
    .filter(([, v]) => /SORAN_MAGAZINE_DRAFTS_DIR/.test(String(v)))
  check('🔴 ㉔ package.json 운영 명령에도 없다', badScripts.length === 0, badScripts.map(([k]) => k).join(', ') || '0건')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL`)
if (fail) for (const f of fails) console.log(`  🔴 ${f}`)
process.exit(fail === 0 ? 0 : 1)
