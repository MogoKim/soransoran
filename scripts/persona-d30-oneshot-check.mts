#!/usr/bin/env tsx
/**
 * D30 Persona 1회 투입 판정 검사 — 🔴 순수 함수만. DB 0 · launchctl 0 · 네트워크 0
 */
import {
  APPROVED_SUPPLEMENT_PLAN_DIGEST, COHORT_CODES, EXPECTED_RUNTIME_ASSET_IDENTITY, ONESHOT_LABEL,
  judgeOneShot, judgeOutcome, oneShotWindowOf, previousKstDateOf, remediationEligible, renderOneShotPlist,
  supplementApprovalDigestOf, type OneShotFacts,
} from './lib/persona-d30-oneshot.mjs'
import { planSupplementSnapshot } from './lib/persona-reference-supplement-plan.mjs'
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const SHA = 'a'.repeat(40)
const OLD40 = Array.from({ length: 40 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
const base = (): OneShotFacts => ({
  targetDate: '2026-11-15', kstDate: '2026-11-15', kstMinute: 7 * 60 + 5,
  stage: { kstDate: '2026-11-15', state: 'PREPARE', release: 'd20', capacity: 'd30', decidedBy: 'controller' },
  previousStage: { kstDate: '2026-11-14', state: 'PREPARE', release: 'd20', capacity: 'd30', decidedBy: 'controller' },
  originMain: SHA, head: SHA, pin: SHA, manifestSha: SHA,
  manifestIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY }, deployLock: false, runningJobs: [], unknownJobs: [],
  approvalDigest: APPROVED_SUPPLEMENT_PLAN_DIGEST, runtimeIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY },
  old40VoiceSame: true, old40ActiveCodes: [...OLD40], expectedOld40: [...OLD40], cohortExisting: [], adminCount: 1, marker: null,
  capacity: { contractValid: 40, stageActive: 40 },
})
const expect = (label: string, patch: Partial<OneShotFacts>, code: string, noop = false): void => {
  const v = judgeOneShot({ ...base(), ...patch })
  check(`${label} → ${code}${noop ? ' (no-op)' : ' · write 0'}`, !v.go && v.code === code && (v.go || (v.noop === true) === noop), `got ${v.code}`)
}

console.log('\n① 정상 — 모든 조건이 맞을 때만 GO')
check('정상 → GO', judgeOneShot(base()).go)
check('창 끝(07:19) → GO', judgeOneShot({ ...base(), kstMinute: 7 * 60 + 19 }).go)

console.log('\n② 날짜·창·표식')
expect('stale day(다음 날 깨어남)', { kstDate: '2026-11-16' }, 'STALE_DAY', true)
expect('stale day(전날)', { kstDate: '2026-11-14' }, 'STALE_DAY', true)
expect('--date 모양 오류', { targetDate: '20261115' }, 'BAD_TARGET_DATE')
expect('07:04 이른 실행', { kstMinute: 7 * 60 + 4 }, 'OUTSIDE_WINDOW')
expect('07:20 늦은 실행(절전 뒤 깨어남)', { kstMinute: 7 * 60 + 20 }, 'OUTSIDE_WINDOW')
expect('완료 표식', { marker: { state: 'done', date: '2026-11-15' } }, 'ALREADY_DONE', true)
for (const s of ['started', 'failed', 'held', 'paused'] as const) expect(`표식 ${s}(중간 사망·실패)`, { marker: { state: s, date: '2026-11-15' } }, 'MARKER_PRESENT')
expect('표식 판독 실패', { marker: undefined }, 'MARKER_UNREADABLE')

console.log('\n③ StageDecision — PREPARE·d20·d30·controller·비증명일만')
expect('UNKNOWN(DB 읽기 실패)', { stage: undefined }, 'STAGE_UNKNOWN')
expect('행 없음(controller 확정 전)', { stage: null }, 'STAGE_MISSING')
expect('다른 날 행', { stage: { ...base().stage!, kstDate: '2026-11-14' } }, 'STAGE_STALE')
expect('TRIAL(증명일)', { stage: { ...base().stage!, state: 'TRIAL' } }, 'PROOF_DAY')
expect('REPROVE(증명일)', { stage: { ...base().stage!, state: 'REPROVE' } }, 'PROOF_DAY')
expect('HOLD', { stage: { ...base().stage!, state: 'HOLD' } }, 'STAGE_NOT_PREPARE')
expect('FAIL 상태값', { stage: { ...base().stage!, state: 'FAIL' } }, 'STAGE_NOT_PREPARE')
expect('release d10', { stage: { ...base().stage!, release: 'd10' } }, 'STAGE_RELEASE')
expect('release d30(이미 개방)', { stage: { ...base().stage!, release: 'd30' } }, 'STAGE_RELEASE')
expect('capacity d20', { stage: { ...base().stage!, capacity: 'd20' } }, 'STAGE_CAPACITY')
expect('사람이 쓴 행', { stage: { ...base().stage!, decidedBy: 'founder' } }, 'STAGE_NOT_CONTROLLER')

console.log('\n③-b 🔴 결정 전 창(03:45~06:05) — 권위는 전날 controller 행 · 그날 행은 없어야 한다')
const pre = (patch: Partial<OneShotFacts> = {}): OneShotFacts => ({ ...base(), kstMinute: 3 * 60 + 45, stage: null, ...patch })
const preV = (patch: Partial<OneShotFacts> = {}) => judgeOneShot(pre(patch))
const expectPre = (label: string, patch: Partial<OneShotFacts>, code: string): void => {
  const v = preV(patch)
  check(`결정 전 · ${label} → ${code} · write 0`, !v.go && v.code === code, `got ${v.code}`)
}
{
  const g = preV()
  check('결정 전 03:45 · 그날 행 없음 · 전날 PREPARE·d20·d30 → GO (mode pre-decision)', g.go && g.mode === 'pre-decision', `got ${g.code}`)
  const g2 = preV({ kstMinute: 6 * 60 + 5 })
  check('결정 전 창 끝 06:05 → GO', g2.go && g2.mode === 'pre-decision', `got ${g2.code}`)
  const post = judgeOneShot(base())
  check('결정 뒤 07:05 → GO (mode post-decision)', post.go && post.mode === 'post-decision')
}
expectPre('03:44 이른 실행', { kstMinute: 3 * 60 + 44 }, 'OUTSIDE_WINDOW')
expectPre('06:06 늦은 실행', { kstMinute: 6 * 60 + 6 }, 'OUTSIDE_WINDOW')
expectPre('06:59 (두 창 사이)', { kstMinute: 6 * 60 + 59 }, 'OUTSIDE_WINDOW')
expectPre('그날 행이 이미 있다(PREPARE 여도)', { stage: base().stage }, 'STAGE_ALREADY_DECIDED')
expectPre('그날 행이 이미 있다(TRIAL)', { stage: { ...base().stage!, state: 'TRIAL' } }, 'STAGE_ALREADY_DECIDED')
expectPre('그날 행 판독 실패', { stage: undefined }, 'STAGE_UNKNOWN')
expectPre('--date 가 실재하지 않는 날(2026-02-30)', { targetDate: '2026-02-30', kstDate: '2026-02-30' }, 'PREV_DATE_INVALID')
expectPre('전날 행 판독 실패', { previousStage: undefined }, 'PREV_STAGE_UNKNOWN')
expectPre('전날 행 없음', { previousStage: null }, 'PREV_STAGE_MISSING')
expectPre('전날이 아니라 이틀 전 행', { previousStage: { ...base().previousStage!, kstDate: '2026-11-13' } }, 'STAGE_STALE')
expectPre('전날 행이 그날 날짜', { previousStage: { ...base().previousStage!, kstDate: '2026-11-15' } }, 'STAGE_STALE')
expectPre('전날 사람이 쓴 행', { previousStage: { ...base().previousStage!, decidedBy: 'founder' } }, 'STAGE_NOT_CONTROLLER')
expectPre('전날 TRIAL(전날이 증명일)', { previousStage: { ...base().previousStage!, state: 'TRIAL' } }, 'PROOF_DAY')
expectPre('전날 REPROVE', { previousStage: { ...base().previousStage!, state: 'REPROVE' } }, 'PROOF_DAY')
expectPre('전날 HOLD', { previousStage: { ...base().previousStage!, state: 'HOLD' } }, 'STAGE_NOT_PREPARE')
expectPre('전날 release d10', { previousStage: { ...base().previousStage!, release: 'd10' } }, 'STAGE_RELEASE')
expectPre('전날 capacity d20', { previousStage: { ...base().previousStage!, capacity: 'd20' } }, 'STAGE_CAPACITY')
expectPre('결정 전이라도 runtime 다름', { originMain: 'b'.repeat(40) }, 'RUNTIME_MISMATCH')
expectPre('결정 전이라도 job 실행 중', { runningJobs: ['com.soransoran.navercafe-collect-wgang-multi'] }, 'JOB_RUNNING')
expectPre('결정 전이라도 용량 39/39', { capacity: { contractValid: 39, stageActive: 39 } }, 'CAPACITY_BASELINE')
check('결정 전이라도 39/39 + 다른 게이트 통과면 P15 교정 1회 허용',
  remediationEligible(preV({ capacity: { contractValid: 39, stageActive: 39 } }), { capacity: { contractValid: 39, stageActive: 39 } }))
check('결정 뒤 창은 전날 행을 보지 않는다(전날 HOLD 여도 그날 PREPARE 면 GO)',
  judgeOneShot({ ...base(), previousStage: { ...base().previousStage!, state: 'HOLD' } }).go)
check('결정 뒤 창은 전날 행 판독 실패와 무관하다', judgeOneShot({ ...base(), previousStage: undefined }).go)
check('창 판정: 03:45 pre · 06:05 pre · 07:05 post · 07:19 post · 03:44/06:06/07:04/07:20 null',
  oneShotWindowOf(225)?.mode === 'pre-decision' && oneShotWindowOf(365)?.mode === 'pre-decision'
  && oneShotWindowOf(425)?.mode === 'post-decision' && oneShotWindowOf(439)?.mode === 'post-decision'
  && [224, 366, 424, 440].every((m) => oneShotWindowOf(m) === null))
check('전날 계산: 11-17→11-16 · 12-01→11-30 · 01-01→전년 12-31 · 모양 오류 null',
  previousKstDateOf('2026-11-17') === '2026-11-16' && previousKstDateOf('2026-12-01') === '2026-11-30'
  && previousKstDateOf('2027-01-01') === '2026-12-31' && previousKstDateOf('2026-02-30') === null && previousKstDateOf('x') === null)

console.log('\n④ runtime · lock · job')
expect('origin/main 다름', { originMain: 'b'.repeat(40) }, 'RUNTIME_MISMATCH')
expect('pin 다름', { pin: 'b'.repeat(40) }, 'RUNTIME_MISMATCH')
expect('manifest 다름', { manifestSha: 'b'.repeat(40) }, 'RUNTIME_MISMATCH')
expect('fetch 실패', { originMain: null }, 'RUNTIME_UNKNOWN')
expect('배포 잠금', { deployLock: true }, 'DEPLOY_LOCK')
expect('잠금 상태 모름', { deployLock: null }, 'DEPLOY_LOCK')
expect('job 실행 중', { runningJobs: ['com.soransoran.supply-process'] }, 'JOB_RUNNING')
expect('job 관측 불가', { unknownJobs: ['com.soransoran.stage-controller'] }, 'JOB_UNKNOWN')

console.log('\n⑤ 두 digest — 승인(source)과 runtime 식별자는 따로 막는다')
expect('승인 digest 낡음(cf3dbdac)', { approvalDigest: 'cf3dbdac17476f12a8b8cfe0e4dda0e5d7e350cacbeb3a8e5634be59d833de2c' }, 'SUPPLEMENT_APPROVAL_DIGEST')
expect('승인 digest 계산 실패', { approvalDigest: null }, 'SUPPLEMENT_APPROVAL_DIGEST')
expect('runtime 식별자 v1', { runtimeIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY, supplementDigest: '6d1b868480d90b3583a6a38da38606787ae678f9363f816419ee2c2480c1731e' } }, 'RUNTIME_ASSET_IDENTITY')
expect('runtime 식별자 측정 실패', { runtimeIdentity: null }, 'RUNTIME_ASSET_IDENTITY')
expect('manifest 식별자 옛 값(P0 결함 재발)', { manifestIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY, supplementDigest: '6d1b868480d90b3583a6a38da38606787ae678f9363f816419ee2c2480c1731e' } }, 'MANIFEST_ASSET_IDENTITY')
expect('승인은 맞고 runtime 만 틀림 — 하나가 다른 하나를 대신하지 않는다', { runtimeIdentity: { referenceDigest: 'c'.repeat(64), supplementDigest: null } }, 'RUNTIME_ASSET_IDENTITY')

console.log('\n⑥ 기존 40 · cohort 존재 · DB · credential')
expect('기존 40 말투 drift', { old40VoiceSame: false }, 'OLD40_VOICE_DRIFT')
expect('기존 40 말투 측정 실패', { old40VoiceSame: null }, 'OLD40_VOICE_DRIFT')
expect('기존 active 39', { old40ActiveCodes: OLD40.slice(1) }, 'OLD40_STATE')
expect('active 에 새 코드 섞임', { old40ActiveCodes: [...OLD40.slice(1), 'P44'] }, 'OLD40_STATE')
expect('active 41', { old40ActiveCodes: [...OLD40, 'P44'] }, 'OLD40_STATE')
expect('기존 40 DB 판독 실패', { old40ActiveCodes: null }, 'DB_UNREADABLE')
expect('부분 존재 1명', { cohortExisting: ['P44'] }, 'COHORT_PARTIAL')
expect('부분 존재 19명', { cohortExisting: COHORT_CODES.slice(1) }, 'COHORT_PARTIAL')
expect('전원 존재(재실행)', { cohortExisting: [...COHORT_CODES] }, 'COHORT_PRESENT')
expect('같은 코드 중복 행', { cohortExisting: ['P44', 'P44'] }, 'COHORT_DUPLICATE')
expect('cohort DB 판독 실패', { cohortExisting: null }, 'DB_UNREADABLE')
expect('관리자 0(감사 행위자 없음)', { adminCount: 0 }, 'ACTOR')
expect('관리자 2(누가 켰는지 모호)', { adminCount: 2 }, 'ACTOR')
expect('관리자 판독 실패', { adminCount: null }, 'ACTOR')

console.log('\n⑥-b 🔴 투입 전 정본 용량 hard gate — contract-valid 40 AND stage-active 40')
expect('정본 39/39(P15 미교정)', { capacity: { contractValid: 39, stageActive: 39 } }, 'CAPACITY_BASELINE')
expect('contract 40 · stage 39', { capacity: { contractValid: 40, stageActive: 39 } }, 'CAPACITY_BASELINE')
expect('contract 39 · stage 40', { capacity: { contractValid: 39, stageActive: 40 } }, 'CAPACITY_BASELINE')
expect('41/41', { capacity: { contractValid: 41, stageActive: 41 } }, 'CAPACITY_BASELINE')
expect('판독 실패(null)', { capacity: null }, 'CAPACITY_BASELINE')
expect('판독 일부 실패', { capacity: { contractValid: null, stageActive: 40 } }, 'CAPACITY_BASELINE')
check('용량 게이트는 마지막이다 — 다른 게이트가 먼저 막히면 그 코드가 나온다',
  judgeOneShot({ ...base(), capacity: { contractValid: 39, stageActive: 39 }, deployLock: true }).code === 'DEPLOY_LOCK'
  && judgeOneShot({ ...base(), capacity: { contractValid: 39, stageActive: 39 }, cohortExisting: ['P44'] }).code === 'COHORT_PARTIAL')
const v39 = judgeOneShot({ ...base(), capacity: { contractValid: 39, stageActive: 39 } })
check('교정 1회 허용: 다른 게이트 전부 통과 + 정확히 39/39', remediationEligible(v39, { capacity: { contractValid: 39, stageActive: 39 } }))
for (const [label, cap] of [['38/38', { contractValid: 38, stageActive: 38 }], ['39/40', { contractValid: 39, stageActive: 40 }], ['40/39', { contractValid: 40, stageActive: 39 }], ['null', null]] as const) {
  const v = judgeOneShot({ ...base(), capacity: cap })
  check(`교정 불허: ${label}`, !remediationEligible(v, { capacity: cap }))
}
const vLock = judgeOneShot({ ...base(), capacity: { contractValid: 39, stageActive: 39 }, deployLock: true })
check('교정 불허: 39/39 라도 다른 게이트(잠금)가 막히면', !remediationEligible(vLock, { capacity: { contractValid: 39, stageActive: 39 } }))
check('교정 불허: GO(40/40)면 교정하지 않는다', !remediationEligible(judgeOneShot(base()), { capacity: { contractValid: 40, stageActive: 40 } }))

console.log('\n⑦ 결과 판정 — PASS 가 아니면 새 cohort 만 되돌린다')
const ok = { activated: true, contractValid: 60, stageActive: 60, totalActive: 60, cohortActive: 20, old40Same: true, checkOk: true }
check('contract-valid 60 · stage-active 60 · active 60 · 새 20 · 기존 40 불변 · check 0 → PASS', judgeOutcome(ok).code === 'PASS')
for (const [label, v] of [['판독 실패(null)', null], ['59', 59], ['61', 61]] as const) {
  check(`contract-valid ${label} → PAUSE_NEW_COHORT`, judgeOutcome({ ...ok, contractValid: v }).code === 'PAUSE_NEW_COHORT')
  check(`stage-active ${label} → PAUSE_NEW_COHORT`, judgeOutcome({ ...ok, stageActive: v }).code === 'PAUSE_NEW_COHORT')
}
check('정본 판독 오류(둘 다 null) → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, contractValid: null, stageActive: null }).code === 'PAUSE_NEW_COHORT')
check('contract-valid 60 이어도 active 행 60 이 아니면 PASS 가 아니다', judgeOutcome({ ...ok, totalActive: 59 }).code === 'PAUSE_NEW_COHORT')
check('active 행 60 이어도 contract-valid 59 면 PASS 가 아니다(행 수로 대신하지 않는다)', judgeOutcome({ ...ok, contractValid: 59 }).code === 'PAUSE_NEW_COHORT')
check('active 59 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: 59 }).code === 'PAUSE_NEW_COHORT')
check('active 61 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: 61 }).code === 'PAUSE_NEW_COHORT')
check('기존 40 바뀜 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, old40Same: false }).code === 'PAUSE_NEW_COHORT')
check('check 위반 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, checkOk: false }).code === 'PAUSE_NEW_COHORT')
check('판독 실패 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: null }).code === 'PAUSE_NEW_COHORT')
check('켜기 전 실패(draft) → HOLD_DRAFT', judgeOutcome({ activated: false, contractValid: 40, stageActive: 40, totalActive: 40, cohortActive: 0, old40Same: true, checkOk: true }).code === 'HOLD_DRAFT')

console.log('\n⑧ 승인 digest 공식 = 정본 planSupplementSnapshot 공식 (공식 drift 차단)')
const plan = planSupplementSnapshot({
  canonRows: [], extraRows: [], baseCodes: [], newCodes: [], frozenBundles: [],
  baseSourceDigest: '9aa49018b1216171', saltId: 'salt-test-01', generatedAt: '2026-11-15T00:00:00.000Z', reason: 'x',
})
check('같은 asset·manifest 에서 두 공식이 같은 값', supplementApprovalDigestOf(plan.asset, plan.manifest) === plan.planDigest)
const plan2 = planSupplementSnapshot({
  canonRows: [], extraRows: [], baseCodes: [], newCodes: [], frozenBundles: [],
  baseSourceDigest: '9aa49018b1216171', saltId: 'salt-test-01', generatedAt: '2030-01-01T00:00:00.000Z', reason: 'other',
})
check('시각·사유는 승인 digest 에 들어가지 않는다', plan2.planDigest === plan.planDigest
  && supplementApprovalDigestOf(plan2.asset, plan2.manifest) === plan.planDigest)
check('saltId 가 바뀌면 승인 digest 도 바뀐다', supplementApprovalDigestOf(plan.asset, { ...plan.manifest, saltId: 'other' }) !== plan.planDigest)

console.log('\n⑨ plist — 고정 날짜 · 03:45 · 07:05 · runtime 트리 · RunAtLoad false')
const xml = renderOneShotPlist({ npx: '/n/bin/npx', nodebin: '/n/bin', runtimeRoot: '/U/rt', logdir: '/U/logs', date: '2026-11-15' })
check('Label', xml.includes(`<string>${ONESHOT_LABEL}</string>`))
check('인자에 --apply · --date 고정', xml.includes('<string>--apply</string>') && xml.includes('<string>--date=2026-11-15</string>'))
check('runtime 트리의 실행기', xml.includes('<string>/U/rt/scripts/persona-d30-oneshot.mts</string>') && xml.includes('<key>WorkingDirectory</key><string>/U/rt</string>'))
check('시작 시각 정확히 두 개 03:45 · 07:05 · RunAtLoad false',
  xml.includes('<dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>45</integer></dict>')
  && xml.includes('<dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>5</integer></dict>')
  && (xml.match(/<key>Hour<\/key>/g) ?? []).length === 2 && xml.includes('<key>RunAtLoad</key><false/>'))
let threw = false
try { renderOneShotPlist({ npx: 'n', nodebin: 'n', runtimeRoot: 'r', logdir: 'l', date: 'tomorrow' }) } catch { threw = true }
check('날짜 모양 오류는 렌더하지 않는다', threw)

console.log('\n⑩ 실행기 배선 — DB 클라이언트는 env 판독 뒤에만 만든다(04:10 host dry-run 재현)')
{
  const src = readFileSync(new URL('./persona-d30-oneshot.mts', import.meta.url), 'utf-8')
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
  const created = code.indexOf('new PrismaClient(')
  const filled = code.indexOf('if (!fillDbConnection())')
  const loaded = code.indexOf('await loadEnvLocal()')
  check('모듈 최상단에서 PrismaClient 를 만들지 않는다', !/^const \w+ = new PrismaClient\(/m.test(code))
  check('PrismaClient 생성은 loadEnvLocal · fillDbConnection 뒤 한 곳뿐', created > filled && filled > loaded && loaded > 0
    && code.split('new PrismaClient(').length === 2)
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
