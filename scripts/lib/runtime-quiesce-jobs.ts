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
 *    · ops shadow observer `com.soransoran.ops-shadow-observer` (2026-11-11 · Phase 2 · 권위 0) — 60초마다 같은 runtime
 *      트리의 코드를 import 한다. checkout 중에 뜨면 반쯤 바뀐 트리를 읽는다. 설치는 ops-loop 설치기가 한다.
 */
import { AUDIT_RUNNER_LABEL } from './auto-ready-audit-template'
import { PUBLISH_RUNNER_LABEL } from './original-post-runner-template'
import { COMMENT_RUNNER_LABEL } from './persona-comment-runner-template'
import { OPS_SHADOW_OBSERVER_LABEL, RUNNER_RECOVER_LABEL, STAGE_CONTROLLER_LABEL } from './ops-loop-templates'

/** 🔴 같은 트리에서 **쓰는** job — production activation 의 writer 판정(`D100_WRITER_JOBS`)이 이 목록만 쓴다 */
export const DEPLOY_QUIESCE_WRITER_JOBS: readonly string[] = [
  PUBLISH_RUNNER_LABEL,
  AUDIT_RUNNER_LABEL,
  COMMENT_RUNNER_LABEL,
  RUNNER_RECOVER_LABEL,
  STAGE_CONTROLLER_LABEL,
]
/**
 * 🔴 같은 트리의 코드를 실행하지만 **제품 데이터를 쓰지 않는** job(reader) — 2026-11-11 · ops shadow observer(권위 0).
 *    배포 quiesce 의 주인은 runtime:deploy 다(실행 중이면 배포가 멈추고 · idle 이면 내렸다 되올린다 — checkout 중 새 코드 실행 0).
 *    writer 가 아니므로 production activation 의 writer 판정에는 넣지 않는다(돌고 있다는 이유로 운영 열림을 막거나 재시도시키지 않는다).
 *    observer 는 배포 잠금(`runtime-deploy.lock`)을 보면 tick 을 바로 끝내 배포 창에서 일을 시작하지 않는다.
 */
export const DEPLOY_QUIESCE_READER_JOBS: readonly string[] = [
  OPS_SHADOW_OBSERVER_LABEL,
]
export const DEPLOY_QUIESCE_JOBS: readonly string[] = [...DEPLOY_QUIESCE_WRITER_JOBS, ...DEPLOY_QUIESCE_READER_JOBS]
