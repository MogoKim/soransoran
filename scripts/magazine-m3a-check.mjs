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
  /** 🔴 실제 큐 원고가 이 규칙으로 막히지 않는다 */
  {
    const { resolveValidationProfile: rvp } = await import('./lib/magazine-validation-profile.mjs')
    const blocked = loadQueue().filter((it) => {
      const f = `drafts/magazine/${it.slug}/article-draft.ts`
      if (!fs.existsSync(f)) return false
      const body = [...fs.readFileSync(f, 'utf8').matchAll(/text:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('\n')
      return !runProfileQA({ profile: rvp(it).profile, title: '', bodyText: body }).ok
    })
    check('🔴 실제 큐 원고가 이 규칙에 막히지 않는다', blocked.length === 0, blocked.map((i) => i.slug).join(','))
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
const FIXTURE_SLUGS = fs.readdirSync(DRAFT_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
  .map((e) => e.name).sort()
  .filter((name) => ['brief.md', 'review.ts', 'draft.md', 'article-draft.ts']
    .every((f) => fs.existsSync(path.join(DRAFT_ROOT, name, f))))
  .slice(0, 3)
check('🔴 시험 후보 3건을 저장소 draft 폴더에서 찾았다 (큐 의존 아님)',
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

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL`)
if (fail) for (const f of fails) console.log(`  🔴 ${f}`)
process.exit(fail === 0 ? 0 : 1)
