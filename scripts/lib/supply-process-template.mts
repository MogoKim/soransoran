/**
 * 공급 처리 job 템플릿 — 🔴 **이 함수가 만든다. 시각을 손으로 적지 않는다**
 *
 * 왜 이 파일이 있는가:
 *   공급 러너는 launchd 가 띄운 시각이 정기 회차 창(`SUPPLY_RUN_SLOTS_KST`) 안일 때만 유료 요청을 보낸다.
 *   템플릿의 시각을 손으로 적으면 바퀴 표를 바꾼 날 job 은 옛 시각에 뜨고, 뜬 회차는 전부 "창 밖"이라
 *   글을 한 편도 만들지 못한다. 그래서 템플릿 파일의 내용은 이 함수가 만들고,
 *   `launchd:template-check` 가 "파일 == 이 함수의 결과" 를 본다. 바퀴 시각 · 공급 지연을 바꾸면
 *   `cycle-schedule.ts` 를 고치고 `npm run launchd:supply-template -- --write` 한 번이다.
 *   (배포기 `runtime:deploy` 는 target commit 의 템플릿 파일을 설치한다 — 그래서 파일로 남긴다.)
 */
import { CYCLES, SUPPLY_AFTER_COLLECT_MINUTES, cycleLabel } from '../../src/lib/cycle-schedule'
import { SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS } from '../../src/lib/supply-schedule-contract'
import { SUPPLY_PROCESS_LAUNCHD_LABEL } from '../../src/lib/supply-scheduled-reserve'
import { templatePathOf } from './launchd-install.mjs'

export const SUPPLY_TEMPLATE_PATH = templatePathOf(SUPPLY_PROCESS_LAUNCHD_LABEL)
export const SUPPLY_LOG_NAME = 'supply-process'
export const SUPPLY_ARGS: readonly string[] = [
  '__NPX__', 'tsx', '__REPO__/scripts/stage-consume-exec.mts', '--by=supply', '--',
  '__NPX__', 'tsx', '__REPO__/scripts/supply-process.mts', '--live',
]

export function renderSupplyTemplate(): string {
  const slots = SUPPLY_RUN_SLOTS_KST.map((s) =>
    `    <dict><key>Hour</key><integer>${s.hour}</integer><key>Minute</key><integer>${s.minute}</integer></dict>`)
  const times = SUPPLY_RUN_SLOTS_KST.map((s) => cycleLabel(s.hour * 60 + s.minute)).join(' ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  공급 처리(글 만들기) — 🔴 **이 파일은 생성된다. 손으로 고치지 않는다**
    만드는 곳  scripts/lib/supply-process-template.mts (npm run launchd:supply-template -- --write)
    회차 시각  src/lib/cycle-schedule.ts — 수집 바퀴(CYCLES ${CYCLES.length}회)마다 수집 시작 ${SUPPLY_AFTER_COLLECT_MINUTES}분 뒤 한 번
               (${times})
    회차 창    ${SUPPLY_RUN_WINDOW_MS / 60_000}분 — 이 시각들이 러너의 정기 회차 창과 같아야 유료 요청이 나간다

  하는 일: 디스크에 있는 미처리 수집 결과를 분류 → 판정 → 글쓴이 → 초안 → 검수 → 대기열까지 잇는다.
  🔴 수집하지 않는다 · 발행하지 않는다. 수집이 실패한 바퀴에도 뜬다 — 있는 입력만 처리하고, 없으면 정상 no-op 이다.
  🔴 kill switch 는 .env.local 의 SORAN_SUPPLY_PROCESS_ENABLED=true — plist 를 지우지 않고 멈춘다.
  🔴 동시 실행은 러너의 커널 lease 가 막는다(scripts/lib/supply-lease.mts) — 강제 종료 · 재부팅이면 커널이 푼다.
  🔴 launchd 기본 PATH 에는 nvm 의 node 가 없다(없으면 exit 78) · 로그는 Documents 밖(__LOGDIR__ · TCC).
  🔴 RunAtLoad 를 쓰지 않는다 — load 하는 순간 모델을 부르는 것은 의도가 아니다.
-->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SUPPLY_PROCESS_LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
${SUPPLY_ARGS.map((a) => `    <string>${a}</string>`).join('\n')}
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>__NODEBIN__:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>__REPO__</string>

  <key>StartCalendarInterval</key>
  <array>
${slots.join('\n')}
  </array>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>__LOGDIR__/${SUPPLY_LOG_NAME}.log</string>
  <key>StandardErrorPath</key>
  <string>__LOGDIR__/${SUPPLY_LOG_NAME}-error.log</string>
</dict>
</plist>
`
}
