/**
 * 네이버 카페 수집 job 템플릿 — 🔴 **이 함수가 만든다. 시각을 손으로 적지 않는다**
 *
 * 왜 이 파일이 있는가:
 *   배포기(`runtime:deploy`)는 target commit 의 `docs/operations/launchd/*.plist.template` 파일을 설치한다 —
 *   옛 배포기도 같은 파일을 읽어야 하므로 템플릿은 파일로 남긴다. 대신 그 파일의 내용은 이 함수가 만들고,
 *   `launchd:template-check` 가 "파일 == 이 함수의 결과" 를 본다. 바퀴 시각을 바꾸면
 *   `cycle-schedule.ts` 를 고치고 `npm run launchd:collect-template -- --write` 한 번이다.
 */
import { COLLECT_JOB_LABEL } from '../../src/lib/collect-sources'
import { CYCLES, cycleLabel } from '../../src/lib/cycle-schedule'
import { templatePathOf } from './launchd-install.mjs'

export const COLLECT_TEMPLATE_PATH = templatePathOf(COLLECT_JOB_LABEL)
export const COLLECT_LOG_NAME = 'navercafe-collect'
export const COLLECT_ARGS: readonly string[] = ['__NPX__', 'tsx', '__REPO__/scripts/micro-seed-navercafe-run.mts', '--live']

export function renderCollectTemplate(): string {
  const slots = CYCLES.map((c) =>
    `    <dict><key>Hour</key><integer>${Math.floor(c.minute / 60)}</integer><key>Minute</key><integer>${c.minute % 60}</integer></dict>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  네이버 카페 수집 — 🔴 **이 파일은 생성된다. 손으로 고치지 않는다**
    만드는 곳  scripts/lib/navercafe-collect-template.mts (npm run launchd:collect-template -- --write)
    바퀴 시각  src/lib/cycle-schedule.ts 의 CYCLES — 하루 ${CYCLES.length}회 (${CYCLES.map((c) => cycleLabel(c.minute)).join(' ')})
    원천 목록  src/lib/collect-sources.ts — 바퀴마다 카페를 차례로 돈다(한 카페가 실패해도 다음 카페는 돈다)

  🔴 LOCAL ONLY — 네이버는 로그인 세션이 필요하다. 쿠키를 다른 곳에 올리지 않는다.
  🔴 kill switch 는 .env.local 의 SORAN_NAVERCAFE_COLLECT_ENABLED=true — plist 를 지우지 않고 멈춘다.
  🔴 launchd 기본 PATH 에는 nvm 의 node 가 없다(없으면 exit 78) · 로그는 Documents 밖(__LOGDIR__ · TCC).
-->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${COLLECT_JOB_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
${COLLECT_ARGS.map((a) => `    <string>${a}</string>`).join('\n')}
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
  <string>__LOGDIR__/${COLLECT_LOG_NAME}.log</string>
  <key>StandardErrorPath</key>
  <string>__LOGDIR__/${COLLECT_LOG_NAME}-error.log</string>
</dict>
</plist>
`
}
