#!/usr/bin/env tsx
/**
 * D30 Persona 1회 투입 판정 검사 — 🔴 순수 함수만. DB 0 · launchctl 0 · 네트워크 0
 */
import {
  APPROVED_SUPPLEMENT_PLAN_DIGEST, COHORT_CODES, EXPECTED_RUNTIME_ASSET_IDENTITY, ONESHOT_LABEL,
  judgeOneShot, judgeOutcome, renderOneShotPlist, supplementApprovalDigestOf, type OneShotFacts,
} from './lib/persona-d30-oneshot.mjs'
import { planSupplementSnapshot } from './lib/persona-reference-supplement-plan.mjs'

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
  originMain: SHA, head: SHA, pin: SHA, manifestSha: SHA,
  manifestIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY }, deployLock: false, runningJobs: [], unknownJobs: [],
  approvalDigest: APPROVED_SUPPLEMENT_PLAN_DIGEST, runtimeIdentity: { ...EXPECTED_RUNTIME_ASSET_IDENTITY },
  old40VoiceSame: true, old40ActiveCodes: [...OLD40], expectedOld40: [...OLD40], cohortExisting: [], adminCount: 1, marker: null,
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

console.log('\n⑦ 결과 판정 — PASS 가 아니면 새 cohort 만 되돌린다')
const ok = { activated: true, totalActive: 60, cohortActive: 20, old40Same: true, checkOk: true }
check('contract 60 · active 60 · 기존 40 불변 → PASS', judgeOutcome(ok).code === 'PASS')
check('active 59 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: 59 }).code === 'PAUSE_NEW_COHORT')
check('active 61 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: 61 }).code === 'PAUSE_NEW_COHORT')
check('기존 40 바뀜 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, old40Same: false }).code === 'PAUSE_NEW_COHORT')
check('check 위반 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, checkOk: false }).code === 'PAUSE_NEW_COHORT')
check('판독 실패 → PAUSE_NEW_COHORT', judgeOutcome({ ...ok, totalActive: null }).code === 'PAUSE_NEW_COHORT')
check('켜기 전 실패(draft) → HOLD_DRAFT', judgeOutcome({ activated: false, totalActive: 40, cohortActive: 0, old40Same: true, checkOk: true }).code === 'HOLD_DRAFT')

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

console.log('\n⑨ plist — 고정 날짜 · 07:05 · runtime 트리 · RunAtLoad false')
const xml = renderOneShotPlist({ npx: '/n/bin/npx', nodebin: '/n/bin', runtimeRoot: '/U/rt', logdir: '/U/logs', date: '2026-11-15' })
check('Label', xml.includes(`<string>${ONESHOT_LABEL}</string>`))
check('인자에 --apply · --date 고정', xml.includes('<string>--apply</string>') && xml.includes('<string>--date=2026-11-15</string>'))
check('runtime 트리의 실행기', xml.includes('<string>/U/rt/scripts/persona-d30-oneshot.mts</string>') && xml.includes('<key>WorkingDirectory</key><string>/U/rt</string>'))
check('07:05 하루 1번 · RunAtLoad false', xml.includes('<key>Hour</key><integer>7</integer><key>Minute</key><integer>5</integer>') && xml.includes('<key>RunAtLoad</key><false/>'))
let threw = false
try { renderOneShotPlist({ npx: 'n', nodebin: 'n', runtimeRoot: 'r', logdir: 'l', date: 'tomorrow' }) } catch { threw = true }
check('날짜 모양 오류는 렌더하지 않는다', threw)

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
