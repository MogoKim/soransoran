/**
 * 🔴 **배포 동안만 잠시 멈춰 두는 job 목록의 정본** (2026-09-28)
 *
 *    공급 job(`RUNTIME_JOBS`)도 퇴역 job 도 아니지만 **같은 runtime 작업 트리**에서 돈다.
 *    `checkout`·`npm ci` 중에 회차가 뜨면 반쯤 바뀐 트리를 읽는다 — 그래서 배포가
 *    돌고 있으면 멈추고(refuse), idle 이면 내렸다가 **배포 전 상태 그대로** 되올린다.
 *    render·install·retire·env 판정 어디에도 들어가지 않는다 — 설치되지 않은 job 은 끝까지 설치되지 않는다.
 *
 * 🔴 label 문자열을 여기 다시 적지 않는다 — 각 템플릿 파일이 정본이다.
 * 🔴 배포기(`scripts/runtime-deploy.mts`)와 격리 검사 fixture 가 **이 상수 하나**를 쓴다 —
 *    목록에서 하나를 빼면 fixture 의 행동 시험이 곧바로 빨개진다.
 *
 *    · 발행 러너 `com.soransoran.original-post-runner` (2026-09-20)
 *    · 자동 READY 감사 러너 `com.soransoran.auto-ready-audit` (2026-09-28) — 설치는 선택이다
 *    · 무인 댓글 루프 `com.soransoran.persona-comment-runner` (2026-09-28 · Track B) — 설치는 선택이다.
 *      회차가 checkout 중에 뜨면 반쯤 바뀐 트리로 발행 트랜잭션을 연다 — 감사 러너와 같은 이유다.
 */
import { AUDIT_RUNNER_LABEL } from './auto-ready-audit-template'
import { PUBLISH_RUNNER_LABEL } from './original-post-runner-template'
import { COMMENT_RUNNER_LABEL } from './persona-comment-runner-template'

export const DEPLOY_QUIESCE_JOBS: readonly string[] = [PUBLISH_RUNNER_LABEL, AUDIT_RUNNER_LABEL, COMMENT_RUNNER_LABEL]
