#!/usr/bin/env tsx
/**
 * 발행 슬롯 catch-up fixture — 🔴 **읽기만 한다. DB · 네트워크 · 파일 쓰기 0**
 *
 * 🔴 **이 fixture 가 지키는 것은 하나다** — *예약이 늦거나 빠져도 그날이 비지 않고,*
 *    *그렇다고 두 번 나가지도 않는다.*
 *
 * 🔴 **결함을 재주입해서 본다.** 고쳤다는 말이 아니라, 고치기 전의 그 입력을 그대로 넣어
 *    지금은 막히는지를 본다. 재주입하는 결함은 다섯이다 —
 *      ① 같은 슬롯이 두 번 불린다
 *      ② GitHub run 이 몇 시간 늦게 도착한다
 *      ③ 슬롯 하나가 아예 배달되지 않는다 (2026-09-14 실측)
 *      ④ 하루 상한을 넘겨 센다
 *      ⑤ d1/d3/d5/d10 의 슬롯을 서로 혼동한다
 */
import { readFileSync } from 'node:fs'

import {
  judgeCatchUp, simulateDay, dueSlotsAt, dueCountAt, kstMinuteOfDay, catchUpDailyCeiling,
  PUBLISH_WINDOW_END_MINUTE, PUBLISH_WINDOW_START_MINUTE, PER_RUN_MAX,
} from '../src/lib/publish-slot-catchup'
import {
  PROFILES, RELEASE_STAGES, slotCronUtc, minuteOfDay, CAPACITY_ENV, RELEASE_ENV,
} from '../src/lib/scale-profile'
import { allStageSlots } from '../src/lib/scale-workflow-render'
import {
  PUBLISH_RUNNER_ARGS, publishRunnerSlots, verifyRunnerSlotsInWindow,
  renderPublishRunnerPlist, PUBLISH_RUNNER_LABEL, PUBLISH_RUNNER_INSTALL_STEPS,
  judgeTriggerParity, describeTriggers, readCanonicalStages, parseCanonicalStages,
  RUNNER_SYSTEM_PATH, runnerPathValue, judgeRunnerEnv, judgeRunnerSecrets,
} from './lib/original-post-runner-template'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

/** 🔴 KST 시각을 UTC Date 로. 하루 경계는 러너의 `kstDayStart` 와 같아야 한다 */
const atKst = (h: number, m: number, day = '2026-09-14'): Date =>
  new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)

const codeOf = (p: string): string => readFileSync(p, 'utf-8')

// ─────────────────────────────────────────────────────────
console.log('\n══ 발행 슬롯 catch-up fixture ══\n')
console.log('① 시간축 — KST 하루 경계')
// ─────────────────────────────────────────────────────────
{
  check('🟢 09:30 KST 는 하루 570분째다', kstMinuteOfDay(atKst(9, 30)) === 570)
  check('🟢 00:00 KST 는 0분째다', kstMinuteOfDay(atKst(0, 0)) === 0)
  check('🟢 23:59 KST 는 1439분째다', kstMinuteOfDay(atKst(23, 59)) === 1439)
  // 🔴 UTC 15시 이후에 어제로 밀리던 자리 — setUTCHours(-9) 회귀
  check('🔴 [회귀] UTC 15시 직후(= KST 자정 직후)가 어제로 밀리지 않는다',
    kstMinuteOfDay(new Date('2026-09-14T15:01:00Z')) === 1)
  check('🟢 운영 창은 08:00~22:00 이다',
    PUBLISH_WINDOW_START_MINUTE === 480 && PUBLISH_WINDOW_END_MINUTE === 1320)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 도래 슬롯 — 🔴 앞당겨 내지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 d1 · 08:10 에는 도래한 슬롯이 없다', dueCountAt('d1', 8 * 60 + 10) === 0)
  check('🟢 d1 · 09:30 정각에 1건 도래', dueCountAt('d1', 9 * 60 + 30) === 1)
  check('🟢 d1 · 09:29 에는 아직 0건', dueCountAt('d1', 9 * 60 + 29) === 0)
  check('🟢 d1 · 하루 끝까지 도래는 1건뿐', dueCountAt('d1', PUBLISH_WINDOW_END_MINUTE) === 1)
  check('🟢 d3 · 14:00 이면 09:30·13:30 두 건 도래',
    dueCountAt('d3', 14 * 60) === 2
    && dueSlotsAt('d3', 14 * 60).map((s) => s.kst).join(',') === '09:30,13:30')
  check('🟢 d5 · 12:00 이면 08:10·10:50 두 건 도래', dueCountAt('d5', 12 * 60) === 2)
  check('🟢 d10 · 12:00 이면 08:10·09:30·10:50 세 건 도래', dueCountAt('d10', 12 * 60) === 3)
  check('🔴 nowMinute 가 정수가 아니면 도래 0 (fail-closed)', dueSlotsAt('d10', Number.NaN).length === 0)
  for (const stage of RELEASE_STAGES) {
    check(`🟢 ${stage} · 창이 끝나면 도래 합 = dailyTarget ${PROFILES[stage].dailyTarget}`,
      catchUpDailyCeiling(stage) === PROFILES[stage].dailyTarget)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 결함 재주입 ① — 같은 슬롯이 두 번 불린다')
// ─────────────────────────────────────────────────────────
{
  const cron = slotCronUtc({ hour: 9, minute: 30 })
  const first = judgeCatchUp({ stage: 'd1', now: atKst(9, 31), trigger: 'schedule', cron, publishedToday: 0 })
  check('🟢 첫 번째 회차는 1건 낸다', first.run && first.allowed === 1)
  // 🔴 첫 회차가 낸 뒤 같은 예약이 재실행됐다 (GitHub 재시도 · 중복 배달)
  const second = judgeCatchUp({ stage: 'd1', now: atKst(9, 33), trigger: 'schedule', cron, publishedToday: 1 })
  check('🔴 같은 슬롯이 두 번 불려도 두 번째는 0건', !second.run && second.allowed === 0)
  check('🔴 두 번째의 사유가 "이미 다 냈다" 로 남는다', second.reason.includes('이미 다 냈다'))
  // 🔴 세 번, 네 번 불려도 같다
  check('🔴 세 번째도 0건',
    !judgeCatchUp({ stage: 'd1', now: atKst(10, 0), trigger: 'schedule', cron, publishedToday: 1 }).run)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 결함 재주입 ② — GitHub run 이 늦게 도착한다 (실측 108~331분)')
// ─────────────────────────────────────────────────────────
{
  const cron = slotCronUtc({ hour: 9, minute: 30 })
  // 2026-09-13 실측: 09:30 예약이 14:08 에 도착했다
  const late = judgeCatchUp({ stage: 'd1', now: atKst(14, 8), trigger: 'schedule', cron, publishedToday: 0 })
  check('🟢 279분 늦게 도착해도 그 회차는 여전히 발행한다', late.run && late.allowed === 1)
  check('🟢 늦게 와도 자기 슬롯 정체성은 유지된다', late.ownSlot && late.slotKst === '09:30')
  // 🔴 그런데 그 사이 다른 트리거가 이미 냈다면 — 늦게 온 run 은 내지 않는다
  const lateAfterDone = judgeCatchUp({ stage: 'd1', now: atKst(14, 8), trigger: 'schedule', cron, publishedToday: 1 })
  check('🔴 늦게 온 run 과 정시 트리거가 겹쳐도 두 번 나가지 않는다', !lateAfterDone.run)
  // 🔴 어제 예약이 오늘 넘어와 도착해도 같다 — 판정은 **오늘 발행 수**로 한다
  check('🔴 어제 예약이 오늘 도착해도 오늘 몫을 넘기지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(9, 40), trigger: 'schedule', cron, publishedToday: 1 }).run)
  // 🔴 창을 넘겨 도착하면 버린다
  const tooLate = judgeCatchUp({ stage: 'd1', now: atKst(22, 30), trigger: 'schedule', cron, publishedToday: 0 })
  check('🔴 22시를 넘겨 도착하면 밀린 것을 메우지 않는다', !tooLate.run)
  check('🔴 그 사유가 운영 창으로 남는다', tooLate.reason.includes('운영 창'))
  check('🟢 21:59 이면 아직 창 안이다',
    judgeCatchUp({ stage: 'd1', now: atKst(21, 59), trigger: 'schedule', cron, publishedToday: 0 }).run)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 결함 재주입 ③ — 슬롯이 아예 배달되지 않는다 (2026-09-14 실측)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 실측 재현. 2026-09-14 에 d1 의 유일한 슬롯 `30 0 * * *`(09:30 KST)이 배달되지 않았고,
   *    도착한 것은 `10 23 * * *`(08:10 KST) 하나였다. 옛 판정은 "내 슬롯이 아니다" 로 쉬었고
   *    재고·배정·cap·kill switch 가 전부 준비된 채 **그날 0편**이 됐다.
   */
  const notMine = slotCronUtc({ hour: 10, minute: 50 })   // d1 의 슬롯이 아니다
  const rescue = judgeCatchUp({ stage: 'd1', now: atKst(10, 55), trigger: 'schedule', cron: notMine, publishedToday: 0 })
  check('🟢 [실측 재현] 내 슬롯이 아닌 run 이 밀린 09:30 을 대신 낸다', rescue.run && rescue.allowed === 1)
  check('🟢 그것이 catch-up 으로 표시된다', rescue.catchUp && !rescue.ownSlot)
  check('🟢 사유에 도래·발행·밀림이 같이 적힌다',
    rescue.reason.includes('도래 1건') && rescue.reason.includes('밀린 1건'))

  // 🔴 그래도 **앞당겨** 내지는 않는다 — 08:10 에 온 run 은 여전히 0건이다
  const early = judgeCatchUp({
    stage: 'd1', now: atKst(8, 12), trigger: 'schedule',
    cron: slotCronUtc({ hour: 8, minute: 10 }), publishedToday: 0,
  })
  check('🔴 [회귀] 09:30 전에는 catch-up 도 내지 않는다', !early.run && early.dueCount === 0)
  check('🔴 그 사유가 "첫 슬롯이 아직" 으로 남는다', early.reason.includes('아직 오지 않았다'))

  // 🔴 d3 에서 09:30 이 유실되고 13:30 이 도착한 경우 — 밀린 2건 중 1건만 낸다
  const d3Rescue = judgeCatchUp({
    stage: 'd3', now: atKst(13, 35), trigger: 'schedule',
    cron: slotCronUtc({ hour: 13, minute: 30 }), publishedToday: 0,
  })
  check('🟢 d3 · 09:30 유실 뒤 13:30 에 밀림 2건을 본다', d3Rescue.backlog === 2)
  check(`🔴 그래도 한 회차는 ${PER_RUN_MAX}건까지만 낸다 — 몰아 내지 않는다`,
    d3Rescue.allowed === PER_RUN_MAX)
  check('🟢 나머지는 다음 회차가 잇는다',
    judgeCatchUp({
      stage: 'd3', now: atKst(14, 0), trigger: 'local', cron: null, publishedToday: 1,
    }).allowed === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 결함 재주입 ④ — 하루 상한 초과')
// ─────────────────────────────────────────────────────────
{
  const cron = slotCronUtc({ hour: 9, minute: 30 })
  check('🔴 d1 · 이미 1건 냈으면 0건',
    !judgeCatchUp({ stage: 'd1', now: atKst(20, 0), trigger: 'schedule', cron, publishedToday: 1 }).run)
  check('🔴 d1 · 어쩌다 2건이 나갔어도 더 내지 않는다 (음수 backlog 를 0 으로 본다)',
    (() => {
      const v = judgeCatchUp({ stage: 'd1', now: atKst(20, 0), trigger: 'schedule', cron, publishedToday: 2 })
      return !v.run && v.backlog === 0
    })())
  check('🔴 d10 · 창 끝에서도 도래 10건을 넘겨 내지 않는다',
    !judgeCatchUp({
      stage: 'd10', now: atKst(21, 0), trigger: 'local', cron: null, publishedToday: 10,
    }).run)
  check('🔴 오늘 발행 수를 못 셌으면(null) 내지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron, publishedToday: null }).run)
  check('🔴 오늘 발행 수가 NaN 이어도 내지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron, publishedToday: Number.NaN }).run)
  check('🔴 오늘 발행 수가 소수여도 내지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron, publishedToday: 1.5 }).run)
  check('🔴 실행 시각을 읽지 못하면 내지 않는다',
    !judgeCatchUp({ stage: 'd1', now: new Date(Number.NaN), trigger: 'schedule', cron, publishedToday: 0 }).run)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 결함 재주입 ⑤ — d1/d3/d5/d10 슬롯 혼동')
// ─────────────────────────────────────────────────────────
{
  // 🔴 d1 은 d3 의 13:30 을 자기 슬롯으로 삼지 않는다 — 그래도 09:30 이 밀렸으면 대신 낸다
  const d1At1330 = judgeCatchUp({
    stage: 'd1', now: atKst(13, 35), trigger: 'schedule',
    cron: slotCronUtc({ hour: 13, minute: 30 }), publishedToday: 0,
  })
  check('🔴 d1 은 13:30 을 자기 슬롯으로 세지 않는다', !d1At1330.ownSlot)
  check('🟢 그래도 밀린 09:30 몫 1건은 낸다 (상한은 여전히 1)',
    d1At1330.run && d1At1330.allowed === 1 && d1At1330.dueCount === 1)
  check('🔴 d1 이 13:30 에서 2건을 내지 않는다', d1At1330.backlog === 1)

  // 🔴 단계별 도래 수가 서로 섞이지 않는다
  const at1400 = (stage: 'd1' | 'd3' | 'd5' | 'd10'): number => dueCountAt(stage, 14 * 60)
  check('🟢 14:00 도래 수 — d1:1 · d3:2 · d5:3 · d10:5',
    at1400('d1') === 1 && at1400('d3') === 2 && at1400('d5') === 3 && at1400('d10') === 5)

  // 🔴 d5 로 운영하는데 d10 만의 슬롯(12:10)이 도착해도 d5 의 도래 수를 바꾸지 않는다
  const d5At1215 = judgeCatchUp({
    stage: 'd5', now: atKst(12, 15), trigger: 'schedule',
    cron: slotCronUtc({ hour: 12, minute: 10 }), publishedToday: 2,
  })
  check('🔴 d5 · 12:15 도래는 2건이므로 2건 냈으면 더 내지 않는다',
    !d5At1215.run && d5At1215.dueCount === 2)
  check('🔴 d10 만의 슬롯이 d5 의 슬롯으로 세어지지 않는다', !d5At1215.ownSlot)

  // 🔴 모든 단계에서 창 끝 도래 합이 프로필 목표와 같다 (catch-up 이 상한을 늘리지 않는다)
  for (const stage of RELEASE_STAGES) {
    const v = judgeCatchUp({
      stage, now: atKst(21, 59), trigger: 'local', cron: null,
      publishedToday: PROFILES[stage].dailyTarget,
    })
    check(`🔴 ${stage} · 목표치를 다 내면 창 끝에서도 0건`, !v.run && v.backlog === 0)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 트리거 — 🔴 모르는 트리거로는 내보내지 않는다')
// ─────────────────────────────────────────────────────────
{
  const cron = slotCronUtc({ hour: 9, minute: 30 })
  check('🔴 수동 트리거는 발행하지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'manual', cron, publishedToday: 0 }).run)
  check('🔴 [회귀] schedule 인데 cron 이 없으면 발행하지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron: null, publishedToday: 0 }).run)
  check('🔴 schedule 인데 cron 이 빈 문자열이어도 발행하지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron: '   ', publishedToday: 0 }).run)
  check('🔴 슬롯으로 읽을 수 없는 cron 이면 발행하지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(12, 0), trigger: 'schedule', cron: '*/5 * * * *', publishedToday: 0 }).run)
  check('🟢 local 트리거는 cron 없이도 시각으로 판정한다',
    judgeCatchUp({ stage: 'd1', now: atKst(9, 31), trigger: 'local', cron: null, publishedToday: 0 }).run)
  check('🔴 local 도 도래 전에는 내지 않는다',
    !judgeCatchUp({ stage: 'd1', now: atKst(9, 29), trigger: 'local', cron: null, publishedToday: 0 }).run)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 배선 — 🔴 판정이 실제 쓰기 경로에 닿는가')
// ─────────────────────────────────────────────────────────
{
  const runner = codeOf('scripts/original-post-auto-publish.mts')
  check('🔴 러너가 judgeCatchUp 을 쓴다', /import \{ judgeCatchUp/.test(runner))
  check('🔴 [회귀] 러너가 옛 judgeSlotRun 을 쓰지 않는다', !/judgeSlotRun\(/.test(runner))
  check('🔴 러너가 트리거를 넘긴다', /trigger: TRIGGER/.test(runner))
  check('🔴 러너가 판정 결과를 게이트에 넘긴다', /const slot = \{ run: catchUp\.run/.test(runner))
  check('🔴 게이트 통과 전에는 write 가 없다',
    runner.indexOf('if (!gate.ok)') < runner.indexOf('updateMany('))

  const tx = codeOf('src/lib/original-post-publish-tx.ts')
  check('🔴 트랜잭션이 Serializable 이다', /isolationLevel: 'Serializable'/.test(tx))
  check('🔴 트랜잭션 안에서 오늘 발행 수를 다시 센다',
    /publishedTodayInTx = await tx\.personaActivityLog\.count/.test(tx))
  check('🔴 [회귀] 판정이 밖에서 받은 값을 쓰지 않는다',
    /publishedToday: publishedTodayInTx/.test(tx) && !/publishedToday: input\.publishedToday/.test(tx))
  /**
   * 🔴 **재시도 계약 — 정확히 한 번** (2026-09-26 개정). 앞판 문구("재시도하지 않는다")는 코드가
   *    바뀐 뒤에도 초록이었다(거짓 초록). 지금 계약: 충돌이면 한 번만 다시 시도하고(처음부터 다시 셈),
   *    두 번째 충돌은 실패다. 시도 횟수를 소스 구조로 고정한다 — 재시도를 없애도 늘려도 빨개진다.
   */
  const outer = tx.slice(tx.indexOf('export async function publishOriginalPostTx'), tx.indexOf('async function publishAttempt'))
  check('🔴 🔴 **직렬화 충돌은 정확히 한 번 재시도 — 두 번째 충돌은 실패**',
    /if \(isSerializationConflict\(err\)\) return \{ kind: 'conflict' \}/.test(tx)
    && (outer.match(/await publishAttempt\(prisma, input, deps\)/g) ?? []).length === 2
    && /const first = await publishAttempt\(prisma, input, deps\)\s*if \(first\.kind === 'conflict'\) \{\s*const second = await publishAttempt\(prisma, input, deps\)\s*if \(second\.kind === 'conflict'\) \{\s*return \{ kind: 'error'/.test(outer)
    && !/while\s*\(|for\s*\(/.test(outer))
  check('🔴 조건부 UPDATE 가 그대로 있다',
    /status: \{ in: \['APPROVED', 'EDITED'\] \}, createdPostId: null/.test(tx))
  check('🔴 cap 정본(ActivityLog) write 가 그대로 있다', /kind: 'post'/.test(tx))
  check('🔴 kill switch 검사가 그대로 있다', /personaGlobalSwitch/.test(tx))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 정시 트리거 템플릿 — 🔴 등록하지 않는다')
// ─────────────────────────────────────────────────────────
{
  const slots = publishRunnerSlots()
  check('🟢 정시 트리거가 모든 단계 슬롯의 합집합을 예약한다', slots.length === 10)
  check('🔴 모든 슬롯이 운영 창 안이다', verifyRunnerSlotsInWindow(slots).length === 0)
  check('🔴 인자에 --trigger=local 이 있다', PUBLISH_RUNNER_ARGS.includes('--trigger=local'))
  check('🔴 인자에 --limit=1 이 그대로 있다', PUBLISH_RUNNER_ARGS.includes('--limit=1'))
  const NODEBIN = '/Users/x/.nvm/versions/node/v24.14.0/bin'
  const plist = renderPublishRunnerPlist({
    runtimeRoot: '/Users/x/Documents/soransoran-runtime', npxPath: '/usr/local/bin/npx', logDir: '/tmp',
    nodeBinDir: NODEBIN,
  })
  check('🔴 plist 가 runtime 을 가리킨다', plist.includes('<string>/Users/x/Documents/soransoran-runtime</string>'))
  check('🔴 plist 가 RunAtLoad 를 켜지 않는다', plist.includes('<key>RunAtLoad</key><false/>'))
  check('🟢 plist 에 슬롯 10개가 들어간다', (plist.match(/<key>Hour<\/key>/g) ?? []).length === 10)
  check('🔴 label 이 기존 job 과 겹치지 않는다', PUBLISH_RUNNER_LABEL === 'com.soransoran.original-post-runner')
  /**
   * 🔴 **[P0 재현] PATH 가 빠지면 예약 실행이 뜨기도 전에 죽는다** (2026-09-15 실측).
   *    08:10 · 09:30 두 슬롯 모두 `exit 127` · stdout 0 bytes ·
   *    stderr `env: node: No such file or directory` · 발행 0건.
   *    plist 에 `EnvironmentVariables.PATH` 가 없었다 — 예약 job 5개 템플릿에는 있었다.
   */
  check('🔴 [P0] plist 에 EnvironmentVariables.PATH 가 있다',
    plist.includes('<key>EnvironmentVariables</key>') && plist.includes('<key>PATH</key>'))
  check('🔴 [P0] PATH 앞에 지금 node 의 bin 이 온다',
    plist.includes(`<string>${NODEBIN}:/usr/bin:/bin:/usr/sbin:/sbin</string>`))
  check('🔴 [P0] 표준 시스템 경로가 그대로 남는다',
    RUNNER_SYSTEM_PATH === '/usr/bin:/bin:/usr/sbin:/sbin'
    && ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].every((d) => runnerPathValue(NODEBIN).split(':').includes(d)))
  check('🔴 [P0] node 버전을 문자열로 박지 않는다 — 인자로 받는다', (() => {
    const t = codeOf('scripts/lib/original-post-runner-template.ts')
    return !/v\d+\.\d+\.\d+/.test(t) && /nodeBinDir/.test(t)
  })())
  check('🔴 [P0] PATH 정본이 예약 job 템플릿 검사와 같은 형태다',
    codeOf('scripts/launchd-template-check.mts')
      .includes(`PATH_VALUE = '${runnerPathValue('__NODEBIN__')}'`))
  check('🔴 [P0] PATH 누락 → FAIL', (() => {
    const v = judgeRunnerEnv({ installedPath: null, nodeBinDir: NODEBIN, nodeFound: false })
    return !v.ok && v.problems.some((x) => x.includes('EnvironmentVariables.PATH 가 없다'))
  })())
  check('🔴 [P0] 시스템 경로만 있는 PATH → FAIL (실측 장애 상태)',
    !judgeRunnerEnv({
      installedPath: '/usr/bin:/bin:/usr/sbin:/sbin', nodeBinDir: NODEBIN, nodeFound: false,
    }).ok)
  check('🔴 [P0] 엉뚱한 node 경로 → FAIL',
    !judgeRunnerEnv({
      installedPath: `/opt/other/bin:${RUNNER_SYSTEM_PATH}`, nodeBinDir: NODEBIN, nodeFound: true,
    }).ok)
  check('🔴 [P0] 표준 시스템 경로가 빠지면 FAIL',
    !judgeRunnerEnv({ installedPath: NODEBIN, nodeBinDir: NODEBIN, nodeFound: true }).ok)
  check('🟢 [P0] 지금 node bin + 시스템 경로 → PASS',
    judgeRunnerEnv({
      installedPath: runnerPathValue(NODEBIN), loadedPath: runnerPathValue(NODEBIN),
      nodeBinDir: NODEBIN, nodeFound: true, npxRunnable: true,
    }).ok)
  check('🔴 [P0] launchctl 실제 PATH 가 설치본과 다르면 FAIL',
    !judgeRunnerEnv({
      installedPath: runnerPathValue(NODEBIN), loadedPath: '/usr/bin:/bin:/usr/sbin:/sbin',
      nodeBinDir: NODEBIN, nodeFound: true, npxRunnable: true,
    }).ok)
  check('🔴 [P0] launchctl 관측 실패는 통과시키지 않는다(fail-closed)',
    !judgeRunnerEnv({
      installedPath: runnerPathValue(NODEBIN), loadedPath: null,
      nodeBinDir: NODEBIN, nodeFound: true, npxRunnable: true,
    }).ok)
  check('🔴 [P0] npx 가 실제로 안 뜨면 FAIL',
    !judgeRunnerEnv({
      installedPath: runnerPathValue(NODEBIN), nodeBinDir: NODEBIN, nodeFound: true, npxRunnable: false,
    }).ok)
  check('🔴 [P0] plist 에 비밀값이 없다', judgeRunnerSecrets(plist).ok)
  check('🔴 [P0] 비밀 키가 섞이면 잡는다', !judgeRunnerSecrets(`${plist}<key>DATABASE_URL</key>`).ok)
  check('🔴 [P0] EnvironmentVariables 에 PATH 말고 다른 키를 넣지 않는다', (() => {
    const dict = plist.slice(
      plist.indexOf('<key>EnvironmentVariables</key>'), plist.indexOf('<key>WorkingDirectory</key>'))
    return (dict.match(/<key>/g) ?? []).length === 2
  })())
  check('🔴 [P0] 인자가 그대로다 (--apply --limit=1 --trigger=local)',
    PUBLISH_RUNNER_ARGS.join(' ') === '--apply --limit=1 --trigger=local')
  check('🔴 [P0] RunAtLoad 는 여전히 false 다', plist.includes('<key>RunAtLoad</key><false/>'))
  check('🔴 [P0] 슬롯은 여전히 10개다', (plist.match(/<key>Hour<\/key>/g) ?? []).length === 10)
  check('🔴 [P0] WorkingDirectory 가 runtime 그대로다',
    plist.includes('<key>WorkingDirectory</key><string>/Users/x/Documents/soransoran-runtime</string>'))
  check('🔴 [P0] 등록 절차가 PATH 대조를 요구한다',
    PUBLISH_RUNNER_INSTALL_STEPS.some((x) => x.includes('PATH 를 대조한다')))

  const tpl = codeOf('scripts/lib/original-post-runner-template.ts')
  check('🔴 템플릿이 파일을 쓰지 않는다', !/writeFileSync|mkdirSync|execFileSync|execSync/.test(tpl))
  check('🔴 템플릿이 GitHub 예약을 끄라고 말하지 않는다',
    tpl.includes('GitHub 예약은 **끄지 않는다.**'))

  // 🔴 워크플로우 cron 을 늘려 문제를 덮지 않았는가
  const yml = codeOf('.github/workflows/auto-publish.yml')
  const crons = (yml.match(/-\s*cron:/g) ?? []).length
  check('🔴 [계약] 워크플로우 예약 수를 늘리지 않았다 (10개 그대로)', crons === 10)
  check('🔴 워크플로우가 트리거를 명시로 넘긴다', /--trigger=schedule/.test(yml))
  /**
   * 🔴 수동 실행 경로가 발행 경로로 새지 않는가 — **그 step 안만** 본다.
   *    `on:` 블록의 `workflow_dispatch` 까지 세면 검사가 뜻을 잃는다.
   */
  const dispatchStep = yml
    .slice(yml.indexOf('자동 발행 (dry-run — 수동 실행)'), yml.indexOf('자동 발행 (apply — 스케줄)'))
    // 🔴 주석은 설명문이다. 거기 적힌 `--apply` 를 실행 인자로 세지 않는다
    .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  check('🔴 수동 실행 step 이 실제로 있다', dispatchStep.length > 0)
  check('🔴 수동 실행 경로는 여전히 dry-run 이다 (--apply 없음)', !dispatchStep.includes('--apply'))
  check('🔴 수동 실행 경로는 트리거를 schedule 로 속이지 않는다',
    !dispatchStep.includes('--trigger=schedule') && !dispatchStep.includes('--trigger=local'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 상한 불변 — 🔴 이것은 **상한 증명**이지 운영 능력 증명이 아니다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **이 절을 운영 능력으로 읽지 않는다.**
   *    매분 트리거가 온다는 가정은 현실에 없다. 이 절이 답하는 것은 하나다 —
   *    *"트리거가 아무리 많이 와도 하루 상한을 넘지 않는가."*
   *    **실제로 몇 건이 나가는가**는 ⑫가 트리거 도착 시각을 넣어 따로 본다.
   */
  for (const stage of RELEASE_STAGES) {
    // 하루를 1분씩 훑어 "그 시각까지 낼 수 있는 누적" 이 목표를 넘지 않는지 본다
    let worst = 0
    let publishedToday = 0
    for (let m = 0; m <= 1439; m += 1) {
      const now = new Date(atKst(0, 0).getTime() + m * 60_000)
      const v = judgeCatchUp({ stage, now, trigger: 'local', cron: null, publishedToday })
      if (v.run) { publishedToday += v.allowed; worst = Math.max(worst, publishedToday) }
    }
    check(`🔴 ${stage} · 매분 트리거가 와도 ${PROFILES[stage].dailyTarget}건을 넘지 않는다 (상한 증명)`,
      worst === PROFILES[stage].dailyTarget)
    check(`🟢 ${stage} · 상한만큼은 도달 가능하다 (트리거가 충분할 때)`,
      publishedToday === PROFILES[stage].dailyTarget)
  }
  // 🔴 슬롯 정의가 바뀌어도 도래 합은 목표와 같아야 한다
  for (const stage of RELEASE_STAGES) {
    const total = PROFILES[stage].slots.reduce((n, s) => n + s.count, 0)
    check(`🔴 ${stage} · 슬롯 합 ${total} = 목표 ${PROFILES[stage].dailyTarget}`,
      total === PROFILES[stage].dailyTarget)
    check(`🔴 ${stage} · 모든 슬롯이 운영 창 안이다`,
      PROFILES[stage].slots.every((s) => {
        const m = minuteOfDay(s)
        return m >= PUBLISH_WINDOW_START_MINUTE && m <= PUBLISH_WINDOW_END_MINUTE
      }))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 🔴 실제 트리거 도착 시각으로 본 **단계별 실제 가능량**')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **세 입력을 분리한다.** 하나로 뭉개면 "10개 슬롯이 있으니 10건" 이 되어
   *    실제로는 7번밖에 안 오는 트리거를 10번 오는 것처럼 셈하게 된다.
   *
   *    ⓐ launchd · 맥이 깨어 있다        → 슬롯 시각 그대로
   *    ⓑ launchd · 절전 중 coalesce      → 지나간 슬롯이 wake 때 **1회로 합쳐진다**
   *    ⓒ GitHub 예약 · 2026-09-13 실측   → 각 슬롯 + 관측된 지연
   */
  const slotsAll = allStageSlots().map((s) => ({ h: s.hour, m: s.minute }))

  /** ⓐ 맥이 깨어 있을 때 — 슬롯 시각에 정확히 온다 */
  const awake = slotsAll.map((s) => atKst(s.h, s.m))

  /**
   * ⓑ 절전 coalesce — 09:00~18:00 절전, 18:00 wake.
   *    `man launchd.plist`: 절전 중 지나간 구간들은 wake 때 **단일 이벤트**로 합쳐진다.
   *    한 회차는 `PER_RUN_MAX` 건만 내므로 합쳐진 만큼이 한꺼번에 나가지 않는다.
   */
  const SLEEP_FROM = 9 * 60
  const SLEEP_TO = 18 * 60
  const coalesced = [
    ...slotsAll.filter((s) => s.h * 60 + s.m < SLEEP_FROM).map((s) => atKst(s.h, s.m)),
    atKst(18, 0), // 🔴 절전 중 지나간 슬롯 전부가 이 한 번으로 합쳐진다
    ...slotsAll.filter((s) => s.h * 60 + s.m > SLEEP_TO).map((s) => atKst(s.h, s.m)),
  ]

  /**
   * ⓒ 2026-09-13 GitHub 실측 지연 (cron → run 생성). 슬롯별 관측치를 그대로 적용한다.
   *    🔴 지어낸 수가 아니다 — `gh api .../runs` 로 읽은 `created_at` 에서 계산했다.
   */
  const OBSERVED_DELAY_MIN: Readonly<Record<string, number>> = {
    '08:10': 108, '09:30': 279, '10:50': 299, '12:10': 304, '13:30': 308,
    '14:50': 287, '16:10': 331, '17:30': 294, '19:00': 251, '20:30': 209,
  }
  const github = slotsAll.map((s) => {
    const label = `${String(s.h).padStart(2, '0')}:${String(s.m).padStart(2, '0')}`
    return new Date(atKst(s.h, s.m).getTime() + (OBSERVED_DELAY_MIN[label] ?? 0) * 60_000)
  })

  const inWindow = github.filter((d) => kstMinuteOfDay(d) <= PUBLISH_WINDOW_END_MINUTE).length
  console.log(`\n  ⓒ GitHub 실측 — 도착 ${github.length}회 중 22:00 KST 이전 **${inWindow}회**`
    + ` · 창 밖 ${github.length - inWindow}회`)
  check('🔴 [실측] GitHub 도착 중 일부는 운영 창을 넘긴다 — 그 회차는 버려진다',
    inWindow < github.length)

  const table: string[] = []
  for (const stage of RELEASE_STAGES) {
    const a = simulateDay({ stage, arrivals: awake })
    const b = simulateDay({ stage, arrivals: coalesced })
    const c = simulateDay({ stage, arrivals: github })
    table.push(`     ${stage.padEnd(4)} ⓐ awake ${a.published}/${a.target}`
      + ` · ⓑ 절전 coalesce ${b.published}/${b.target}`
      + ` · ⓒ GitHub 실측 ${c.published}/${c.target}`)

    // 🔴 ⓐ 는 슬롯이 곧 트리거이므로 목표를 채운다 — 그것이 "맥이 깨어 있을 때" 의 뜻이다
    check(`🟢 ${stage} · ⓐ 맥이 깨어 있으면 목표를 채운다 (${a.published}/${a.target})`, a.meetsTarget)
    // 🔴 어떤 입력에서도 목표를 넘지 않는다 — 상한은 트리거와 무관하다
    check(`🔴 ${stage} · 어떤 트리거 배열에서도 목표를 넘지 않는다`,
      a.published <= a.target && b.published <= b.target && c.published <= c.target)
  }
  console.log('\n  단계별 실제 가능량')
  for (const t of table) console.log(t)

  /**
   * 🔴 **핵심 사실 — GitHub 만으로는 d10 목표를 못 채운다.**
   *    22:00 이전 도착이 슬롯 수보다 적고, 한 회차가 1건이므로 그 이상은 불가능하다.
   *    🔴 "지금 배치라서 7건" 이 아니라 **"창 안 도착 수 < 슬롯 수면 미달"** 이 계약이다 —
   *       배치가 바뀌어도 이 부등식은 그대로 성립한다.
   */
  const d10 = simulateDay({ stage: 'd10', arrivals: github })
  console.log(`\n  🔴 d10 · GitHub 실측만으로는 ${d10.published}/${d10.target}건`
    + ` — 22:00 이전 도착 ${d10.triggersInWindow}회 · 창 밖 ${d10.triggersAfterWindow}회`)
  check('🔴 [실측 재현] d10 은 GitHub 예약만으로 하루 목표를 채우지 못한다', !d10.meetsTarget)
  check('🔴 그 상한은 "창 안 도착 수" 다 — 회차당 1건이므로 그 이상은 불가능하다',
    d10.published <= d10.triggersInWindow)
  check('🔴 [계약] 창 안 도착 수가 슬롯 수보다 적으면 미달이다 (배치가 바뀌어도 성립)',
    d10.triggersInWindow < PROFILES.d10.slots.length ? !d10.meetsTarget : true)

  /** 🔴 절전 coalesce 가 실제로 처리량을 깎는다 — "합쳐진 만큼 한꺼번에" 가 아니다 */
  const d10Sleep = simulateDay({ stage: 'd10', arrivals: coalesced })
  const d10Awake = simulateDay({ stage: 'd10', arrivals: awake })
  console.log(`  🔴 d10 · 절전 09:00~18:00 이면 ${d10Sleep.published}/${d10Sleep.target}건`
    + ` (깨어 있으면 ${d10Awake.published}/${d10Awake.target})`)
  check('🔴 [macOS 계약] 절전 중 합쳐진 회차는 한 번에 여러 건을 내지 않는다',
    d10Sleep.published < d10Awake.published)
  check('🔴 그래서 Mac OFF·sleep 에서 d10 10건을 보장한다고 쓸 수 없다', !d10Sleep.meetsTarget)

  /** 🔴 맥이 아예 꺼져 있으면 local 트리거는 0회다 */
  const off = simulateDay({ stage: 'd10', arrivals: [] })
  check('🔴 맥이 꺼져 있으면(트리거 0회) 발행 0건', off.published === 0 && !off.meetsTarget)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 🔴 설정 분리 preflight — 두 트리거가 같은 단계를 봐야 한다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 2026-09-14 실측 상태 재현 — local d3/d1 · GitHub 부재
  const real = judgeTriggerParity({
    local: { capacity: 'd3', release: 'd1' },
    github: { capacity: undefined, release: undefined },
  })
  check('🔴 [실측] local capacity=d3 · GitHub 부재면 capacity 가 다르다고 말한다',
    !real.ok && real.blockers.some((b) => b.includes('capacity 가 다르다')))
  check('🟢 그래도 실제 공개 단계는 양쪽 d1 로 같다 (지금 사고가 없는 이유)',
    real.local.effectiveRelease === 'd1' && real.github?.effectiveRelease === 'd1')

  check('🟢 양쪽이 완전히 같으면 통과',
    judgeTriggerParity({
      local: { capacity: 'd3', release: 'd3' }, github: { capacity: 'd3', release: 'd3' },
    }).ok)
  check('🔴 한쪽만 release 를 올리면 막힌다 — 실제 공개 단계가 갈린다',
    (() => {
      const v = judgeTriggerParity({
        local: { capacity: 'd3', release: 'd3' }, github: { capacity: 'd3', release: 'd1' },
      })
      return !v.ok && v.blockers.some((b) => b.includes('실제 공개 단계가 다르다'))
    })())
  check('🔴 GitHub 을 읽지 못하면 막는다 (fail-closed)',
    !judgeTriggerParity({ local: { capacity: 'd3', release: 'd3' }, github: null }).ok)
  check('🔴 허용 밖 값은 안전 단계로 떨어지고 그 사실이 남는다',
    (() => {
      const v = judgeTriggerParity({
        local: { capacity: 'd99', release: 'd3' }, github: { capacity: 'd99', release: 'd3' },
      })
      return v.local.capacity === 'd1' && v.local.fellBack && v.local.effectiveRelease === 'd1'
    })())
  check('🔴 capacity 가 release 를 누르는 규칙이 양쪽에 같이 적용된다',
    judgeTriggerParity({
      local: { capacity: 'd1', release: 'd10' }, github: { capacity: 'd1', release: 'd10' },
    }).local.effectiveRelease === 'd1')

  /**
   * 🔴 주석은 설명문이다 — 옛 함수 이름이 "왜 바꿨는지" 로 적혀 있을 수 있다.
   *    실제 호출만 보려면 주석을 걷어내고 본다(`original-post-publish-check` 와 같은 방식).
   */
  const pre = codeOf('scripts/publish-trigger-preflight.mts').split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/**')
    }).join('\n')
  check('🔴 preflight 가 GitHub 을 못 읽으면 null 로 둔다 ({} 로 보정하지 않는다)',
    /return null/.test(pre) && !/github = \{ capacity: undefined/.test(pre))
  check('🔴 preflight 가 실패하면 exit 1 이다', /process\.exit\(verdict\.ok \? 0 : 1\)/.test(pre))
  check('🔴 preflight 가 DB 를 열지 않는다', !/PrismaClient/.test(pre))
  check('🔴 preflight 가 설정을 쓰지 않는다', !/writeFileSync|gh variable set|launchctl/.test(pre))
  // 🔴 [회귀] cwd/.env.local · process.env 를 local 정본으로 쓰던 자리
  check('🔴 [회귀] preflight 가 loadEnvLocal 을 쓰지 않는다', !/loadEnvLocal/.test(pre))
  check('🔴 [회귀] preflight 가 process.env 를 local 정본으로 읽지 않는다',
    !/process\.env\[/.test(pre))
  check('🔴 preflight 가 정본 절대 경로를 읽는다', /readCanonicalStages\(\)/.test(pre))
  check('🔴 preflight 가 정본을 못 읽으면 대조 전에 exit 1 한다',
    /if \(!canonical\.ok\)/.test(pre) && pre.indexOf('if (!canonical.ok)') < pre.indexOf('judgeTriggerParity('))
  check('🔴 gh variable list 가 --repo 를 명시한다',
    /'--repo', PUBLISH_REPO/.test(pre) && /PUBLISH_REPO = 'MogoKim\/soransoran'/.test(pre))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 [회귀] 정본 env 읽기 — cwd · process.env 를 정본으로 쓰지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 재현 (2026-09-14).** PR 작업트리에는 `.env.local` 이 없다.
   *    옛 preflight 는 `loadEnvLocal()` → cwd → `process.env` 순으로 읽어
   *    `local d1/d1` 로 보고 **exit 0(거짓 통과)** 를 냈다. 실제 정본은 `d3/d1` 이었다.
   */
  const CANON_TEXT = [
    '# 로컬 전용. 커밋하지 않는다',
    'DATABASE_URL=postgresql://user:secret@host/db',
    'OPENAI_API_KEY=sk-should-never-be-read',
    'SORAN_CAPACITY_STAGE=d3',
    'SORAN_RELEASE_STAGE=d1',
  ].join('\n')

  const canon = readCanonicalStages({ path: '/fake/env.local', read: () => CANON_TEXT })
  check('🟢 [실측 재현] cwd 에 .env.local 이 없어도 정본에서 d3/d1 을 읽는다',
    canon.ok && canon.setting.capacity === 'd3' && canon.setting.release === 'd1')

  // 🔴 정본에서 단계 키 **둘만** 뽑는다 — 비밀은 메모리에도 올리지 않는다
  check('🔴 정본 파서가 단계 키 둘만 돌려준다 (DATABASE_URL · API key 미포함)',
    canon.ok && Object.keys(canon.setting).length === 2
    && !JSON.stringify(canon).includes('secret') && !JSON.stringify(canon).includes('sk-'))

  // 🔴 [회귀] process.env 를 d1/d1 로 심어도 정본이 이긴다
  const savedCap = process.env[CAPACITY_ENV]
  const savedRel = process.env[RELEASE_ENV]
  process.env[CAPACITY_ENV] = 'd1'
  process.env[RELEASE_ENV] = 'd1'
  const underEnv = readCanonicalStages({ path: '/fake/env.local', read: () => CANON_TEXT })
  check('🔴 [회귀] process.env 를 d1/d1 로 주입해도 정본 d3/d1 을 덮지 못한다',
    underEnv.ok && underEnv.setting.capacity === 'd3' && underEnv.setting.release === 'd1')
  if (savedCap === undefined) delete process.env[CAPACITY_ENV]; else process.env[CAPACITY_ENV] = savedCap
  if (savedRel === undefined) delete process.env[RELEASE_ENV]; else process.env[RELEASE_ENV] = savedRel

  // 🔴 그 정본과 GitHub 부재를 대조하면 불일치다
  const v = judgeTriggerParity({
    local: canon.ok ? canon.setting : { capacity: undefined, release: undefined },
    github: { capacity: undefined, release: undefined },
  })
  check('🔴 [실측 재현] 정본 d3/d1 vs GitHub d1/d1 → 불일치로 막는다',
    !v.ok && v.blockers.some((b) => b.includes('capacity 가 다르다')))

  // ── fail-closed 세 갈래 ──
  const missing = readCanonicalStages({
    path: '/fake/none', read: () => { const e = new Error('no'); (e as { code?: string }).code = 'ENOENT'; throw e },
  })
  check('🔴 정본 파일이 없으면 fail-closed', !missing.ok && missing.reason.includes('정본 파일이 없다'))
  const unreadable = readCanonicalStages({
    path: '/fake/x', read: () => { const e = new Error('no'); (e as { code?: string }).code = 'EACCES'; throw e },
  })
  check('🔴 정본을 읽지 못하면 fail-closed', !unreadable.ok && unreadable.reason.includes('읽지 못했다'))
  check('🔴 KEY=VALUE 줄이 없으면 파싱 실패다',
    !parseCanonicalStages('그냥 글\n또 글').ok)
  check('🔴 정본에 단계 키가 둘 다 없으면 fail-closed (조용히 d1 로 떨어뜨리지 않는다)',
    (() => {
      const r = parseCanonicalStages('DATABASE_URL=x\nFOO=bar')
      return !r.ok && r.reason.includes('둘 다 없다')
    })())

  // ── 통과 조건 ──
  const both = parseCanonicalStages('SORAN_CAPACITY_STAGE=d3\nSORAN_RELEASE_STAGE=d3')
  check('🟢 정본 d3/d3 · GitHub d3/d3 이면 통과',
    both.ok && judgeTriggerParity({ local: both.setting, github: { capacity: 'd3', release: 'd3' } }).ok)
  check('🟢 따옴표로 감싼 값도 읽는다',
    (() => {
      const r = parseCanonicalStages('SORAN_CAPACITY_STAGE="d5"\nSORAN_RELEASE_STAGE=\'d5\'')
      return r.ok && r.setting.capacity === 'd5' && r.setting.release === 'd5'
    })())
  check('🔴 한 키만 있으면 나머지는 (없음) 이고 fail-closed 로 d1 이 된다',
    (() => {
      const r = parseCanonicalStages('SORAN_CAPACITY_STAGE=d5')
      if (!r.ok) return false
      const p = judgeTriggerParity({ local: r.setting, github: { capacity: 'd5', release: undefined } })
      return r.setting.release === undefined && p.local.release === 'd1' && p.ok
    })())

  // ── 설치 순서: 배포·SHA → preflight → exit 0 일 때만 plist ──
  const steps = PUBLISH_RUNNER_INSTALL_STEPS
  const iDeploy = steps.findIndex((s) => s.includes('runtime:isolation-check'))
  const iPre = steps.findIndex((s) => s.includes('publish:trigger-preflight'))
  const iExit = steps.findIndex((s) => s.includes('exit 0 일 때만'))
  const iPlist = steps.findIndex((s) => s.includes('LaunchAgents'))
  check('🔴 설치 순서 — runtime 배포·SHA 확인 → preflight → exit 0 → plist',
    iDeploy >= 0 && iPre > iDeploy && iExit > iPre && iPlist > iExit)

  const tpl = codeOf('scripts/lib/original-post-runner-template.ts')
  check('🔴 등록 절차가 preflight 를 먼저 요구한다',
    PUBLISH_RUNNER_INSTALL_STEPS.some((s) => s.includes('publish:trigger-preflight')))
  check('🔴 템플릿이 launchd 를 "단기 임시 bridge" 로 적는다', tpl.includes('단기 임시 bridge'))
  check('🔴 템플릿이 절전 coalesce 를 기록한다', tpl.includes('wake 때 **1회로 합쳐진다**'))
  check('🔴 템플릿이 Mac OFF/sleep 보장을 주장하지 않는다',
    describeTriggers().localLimits.some((l) => l.includes('보장하지 못한다')))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
