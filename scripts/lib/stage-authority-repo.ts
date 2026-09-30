/**
 * 🔴 **이 저장소의 단일 실행 authority 판정** — 템플릿 파일 + TS 렌더러가 **실제로 내는** plist 를 함께 본다.
 *    `runtime-isolation-check` ⑦ · `publish:trigger-preflight` · `publish:heartbeat-preflight` 가 같은 함수를 부른다.
 *    🔴 read-only — 파일 읽기만. launchctl 0 · 네트워크 0 · DB 0.
 */
import { renderAuditRunnerPlist } from './auto-ready-audit-template'
import { renderKeepAwakePlist, renderRunnerRecoverPlist, renderStageControllerPlist } from './ops-loop-templates'
import { renderPublishHeartbeatPlist, renderPublishRunnerPlist, type RunnerPlistInput } from './original-post-runner-template'
import { renderCommentRunnerPlist } from './persona-comment-runner-template'
import { judgeAuthority, readAuthorityInputs, type AuthorityVerdict, type RenderedLaunchd } from './stage-authority-graph'

/** 🔴 렌더 입력 — 경로 모양만 있으면 된다(판정은 ProgramArguments 의 엔트리를 본다) */
export const AUTHORITY_RENDER_INPUT: RunnerPlistInput = {
  runtimeRoot: '/Users/x/Documents/soransoran-runtime',
  npxPath: '/Users/x/.nvm/versions/node/v20/bin/npx',
  logDir: '/Users/x/Library/Logs/soransoran',
  nodeBinDir: '/Users/x/.nvm/versions/node/v20/bin',
}

/** 🔴 TS 가 렌더하는 launchd job 전부 — 발행 정시판과 heartbeat 판은 **같은 label** 이다(둘 중 하나만 깔린다) */
export function renderedLaunchd(input: RunnerPlistInput = AUTHORITY_RENDER_INPUT): RenderedLaunchd[] {
  return [
    { source: 'render:original-post-runner(fixed)', xml: renderPublishRunnerPlist(input) },
    { source: 'render:original-post-runner(heartbeat)', xml: renderPublishHeartbeatPlist(input) },
    { source: 'render:stage-controller', xml: renderStageControllerPlist(input) },
    { source: 'render:runner-recover', xml: renderRunnerRecoverPlist(input) },
    { source: 'render:keep-awake', xml: renderKeepAwakePlist({ logDir: input.logDir }) },
    { source: 'render:auto-ready-audit', xml: renderAuditRunnerPlist(input) },
    { source: 'render:persona-comment-runner', xml: renderCommentRunnerPlist(input) },
  ]
}

export function judgeRepoAuthority(root: string = process.cwd()): AuthorityVerdict {
  return judgeAuthority(readAuthorityInputs(root, renderedLaunchd()))
}
