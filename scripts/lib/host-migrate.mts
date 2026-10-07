/**
 * 상시 실행 호스트 이전 — 🔴 **판단만 한다. 파일·launchctl·네트워크를 직접 건드리지 않는다** (2026-09-29 · Track C)
 *
 * 🔴 **왜 생겼나.**
 *    D100 무인 루프(공급 처리·네이버 수집 2·발행 heartbeat·댓글 루프·감사·단계 controller·복구·keep-awake)가
 *    창업자 노트북의 launchd(gui 도메인)에서 돈다. 덮개·배터리 잠자기·로그아웃·네트워크 끊김이면 전부 선다.
 *    실측(2026-09-29 03:10~05:20): 배터리로 잠든 동안 DarkWake 만 반복됐다 — `caffeinate -s` 는 AC 에서만 듣는다.
 *    이것을 **상시 켜 둘 Mac 한 대(기종 무관 · MacBook 도 AC 연결이면 된다)로 옮기는 묶음**이 필요하다.
 *
 * 🔴 **첫 이전 범위는 D100 레인 하나다 — `D100_LANE_LABELS` 가 유일한 정본이다.**
 *    묶음·내리기·설치·되돌리기·소유 표식이 전부 이 목록에서 나온다. 목록 밖 job(매거진 4 · 꺼 둔 82cook ·
 *    개발용 · 모르는 것)은 **읽지도 옮기지도 내리지도 않는다(기본 거부)**. 원 호스트의 매거진은 그대로 돈다.
 *
 * 🔴 이 파일은 순수 판정이다 — 부르는 쪽(`scripts/host-migrate.mts`)이 진짜 명령을 붙인다.
 *    그래야 검사(`scripts/host-migrate-check.mts`)가 가짜를 붙여 실패·되돌리기를 시험할 수 있다.
 *
 * 🔴 **D100 이 두 Mac 에서 동시에 돌 수 없게 하는 구조** (정본 설명은 docs/operations/ALWAYS-ON-HOST.md)
 *    ① 원 호스트 `quiesce --apply` — D100 job 만 bootout + **그 plist 파일만 LaunchAgents 밖으로** 옮긴다
 *       (파일이 남으면 로그인·재부팅 때 launchd 가 되살린다 — 2026-09-09 실측 사고).
 *    ② `export --cutover` 는 원 호스트에 D100 loaded 0 · D100 plist 0 · d100 handoff 표식이 있을 때만 만든다.
 *    ③ 대상 `install --apply` 는 **d100 cutover 묶음만** 받는다. rehearsal 묶음·다른 레인 묶음은 거부한다.
 *    ④ 원 호스트 되살리기(`unquiesce`)는 대상 rollback 이 찍어 준 bundleId 를 요구한다.
 *    ⑤ 마지막 방어선: 글·댓글 발행 트랜잭션은 Serializable 안에서 오늘 수를 다시 센다
 *       (`src/lib/original-post-publish-tx.ts` · `src/lib/persona-publish-tx.ts`).
 */
import { leftoverPlaceholders, programArguments, render, valueOf } from './launchd-install.mjs'
import { PUBLISH_RUN_DIR_NAME } from './publish-run-record.mjs'

/** 🔴 2 = 레인 단위 묶음(lane 필드). 1(호스트 전체 묶음)은 받지 않는다 */
export const BUNDLE_FORMAT_VERSION = 2
export const BUNDLE_MANIFEST = 'host-bundle.json'
export const LABEL_PREFIX = 'com.soransoran.'

// ─────────────────────────────────────────────────────────
// 레인 — 🔴 이번 이전의 범위는 이 목록 하나다
// ─────────────────────────────────────────────────────────

export const LANE = 'd100'
export type Lane = typeof LANE

/**
 * 🔴 **D100 레인 allowlist — 단일 정본.** 묶음·quiesce·설치·되돌리기·handoff 가 전부 여기서 나온다.
 *    목록에 없는 label 은 판정 함수가 스스로 걸러 낸다(부르는 쪽이 걸러 주기를 믿지 않는다).
 *    새 D100 job 을 옮기려면 이 목록에 적고 검사를 다시 돌린다.
 */
export const D100_LANE_LABELS: readonly string[] = [
  'com.soransoran.navercafe-collect-wgang-multi',
  'com.soransoran.navercafe-collect-remonterrace-multi',
  'com.soransoran.supply-process',
  'com.soransoran.original-post-runner',
  'com.soransoran.persona-comment-runner',
  'com.soransoran.auto-ready-audit',
  'com.soransoran.stage-controller',
  'com.soransoran.runner-recover',
  'com.soransoran.keep-awake',
]

/**
 * 이번 범위 **밖**이라고 이름으로 적어 둔 job — plan 이 "건드리지 않음" 으로 보여 주려는 것뿐이다.
 * 🔴 판정은 이 목록을 보지 않는다. allowlist 에 없으면 여기 없어도(모르는 job 이어도) 건드리지 않는다.
 */
export const OUT_OF_LANE_LABELS: readonly { label: string; why: string }[] = [
  { label: 'com.soransoran.magazine-producer', why: '매거진 레인 — 원 호스트에 남는다' },
  { label: 'com.soransoran.magazine-watch', why: '매거진 레인 — 원 호스트에 남는다' },
  { label: 'com.soransoran.magazine-graph-watch', why: '매거진 레인 — 원 호스트에 남는다' },
  { label: 'com.soransoran.magazine-auto-register', why: '매거진 레인 — 원 호스트에 남는다' },
  { label: 'com.soransoran.supply-collect-82cook-thin', why: '82cook — 꺼 둔 job' },
  { label: 'com.soransoran.raw-collect-82cook', why: '82cook — 꺼 둔 job' },
]

export const isLaneLabel = (label: string): boolean => D100_LANE_LABELS.includes(label)
/** 🔴 `<label>.plist` 이고 label 이 allowlist 에 있을 때만 label 을 돌려준다 */
export function laneLabelOfPlistFile(file: string): string | null {
  if (!file.endsWith('.plist')) return null
  const label = file.slice(0, -'.plist'.length)
  return isLaneLabel(label) ? label : null
}
export const lanePlistFiles = (files: readonly string[]): string[] =>
  files.filter((f) => laneLabelOfPlistFile(f) !== null).sort()
/**
 * 로그 파일 → D100 레인인가. `<짧은 이름>[-error].log` 모양만 본다. 🔴 모르는 로그는 싣지 않는다.
 */
export function isLaneLog(name: string): boolean {
  const m = /^([a-z0-9-]+?)(?:-error)?\.log$/.exec(name)
  return m !== null && isLaneLabel(`${LABEL_PREFIX}${m[1]!}`)
}

/** 🔴 원 호스트가 **D100 레인** 소유권을 넘겼다는 표식 — CANON_DIR 바로 아래. 다른 레인은 이 표식과 무관하다 */
export const HANDOFF_FILE = `host-handoff-${LANE}.json`
/** 🔴 대상 호스트가 지금 **D100 레인** 주인이라는 표식 */
export const OWNER_FILE = `host-owner-${LANE}.json`
/** quiesce 가 D100 plist 를 옮겨 두는 곳 (CANON_DIR 아래) */
export const QUIESCE_DIR_NAME = `host-migrate-quiesced-${LANE}`
/** 대상 rollback 이 plist 를 옮겨 두는 곳 (대상 CANON_DIR 아래) */
export const TARGET_ROLLBACK_DIR_NAME = `host-migrate-rollback-${LANE}`

// ─────────────────────────────────────────────────────────
// 경로 — 🔴 홈 기준 상대 배치는 바꾸지 않는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **홈 아래 배치를 그대로 옮긴다.** runtime-deploy · runtime-isolation-check 가
 *    `join(homedir(), 'Documents', 'soransoran-runtime')` 를 박아 두었다 — 대상에서 다른 곳에 두면
 *    격리 검사가 runtime 을 찾지 못한다.
 */
export type HostPaths = {
  home: string
  canonDir: string
  agentDir: string
  logDir: string
  repoRoot: string
  runtimeRoot: string
  /** 🔴 D100 레인은 쓰지 않는다 — 묶음 위치 거부·템플릿 오염 판정에만 쓴다 */
  magazineRuntimeRoot: string
  slackEnv: string
}

export function hostPathsOf(home: string): HostPaths {
  return {
    home,
    canonDir: `${home}/Library/Application Support/soransoran`,
    agentDir: `${home}/Library/LaunchAgents`,
    logDir: `${home}/Library/Logs/soransoran`,
    repoRoot: `${home}/Documents/soransoran`,
    runtimeRoot: `${home}/Documents/soransoran-runtime`,
    magazineRuntimeRoot: `${home}/Documents/soransoran-magazine-runtime`,
    slackEnv: `${home}/.config/soransoran/slack.env`,
  }
}

// ─────────────────────────────────────────────────────────
// CANON_DIR 항목 분류 — 🔴 모르는 것은 옮기지 않는다
// ─────────────────────────────────────────────────────────

export type EntryKind = 'state' | 'secret' | 'exclude' | 'unclassified'
/**
 * 🔴 `contents` — 이름만으로는 안에 무엇이 쌓일지 보장할 수 없는 항목에 붙인다. 안의 모든 것이
 *    `allow` 에 맞는 **바로 아래 일반 파일**이어야 이 규칙을 쓴다. 하나라도 어긋나면 `unclassified` 로
 *    떨어져 export 가 멈춘다 — exclude 항목에 영구 데이터가 생겨도 조용히 빠지지 않고, state 항목에
 *    모르는 것이 생겨도 조용히 퍼지지 않는다.
 */
export type EntryContents = { allow: RegExp; what: string }
export type EntryRule = { kind: EntryKind; reason: string; contents?: EntryContents }

/**
 * 🔴 **이름으로 분류한다. 모르는 항목은 `unclassified` — export 가 거부한다.**
 *    새 항목을 조용히 옮기면 그 안에 무엇이 있는지(비밀인지) 아무도 보지 않은 채로 퍼진다.
 *    조용히 빼면 대상에서 그 루프가 빈 장부로 시작한다. 둘 다 사람이 이름을 보고 정해야 한다.
 */
const EXACT_RULES: Readonly<Record<string, EntryRule>> = {
  'env.local': { kind: 'secret', reason: '운영 env 정본 — DB·LLM 키. 0600 으로만 옮긴다' },
  'naver-session': { kind: 'secret', reason: '네이버 로그인 storage state(쿠키) — 자격증명' },
  'microseed-data': { kind: 'state', reason: '수집 원본·후보 장부' },
  'llm-ledger': { kind: 'state', reason: 'LLM 일 예산 장부 — 없으면 대상에서 예산이 0부터 다시 찬다' },
  'persona-comment-ledger': { kind: 'state', reason: '댓글 루프 예산 장부' },
  'persona-comment-loop': { kind: 'state', reason: '댓글 루프 상태' },
  'persona-comment-model.json': { kind: 'state', reason: '댓글 모델 확정 기록' },
  'persona-comment-eval': { kind: 'state', reason: '댓글 평가 기록' },
  'persona-reference': { kind: 'state', reason: '화자 reference 고정 배정' },
  /**
   * 🔴 Persona creative 결과(`persona-autogen --generate-creative --creative-out=<파일>`) — 유료 호출로 만들고
   *    사람이 검토한 결과다. 옮기지 않으면 대상에서 같은 돈을 다시 쓰거나 검토하지 않은 creative 로 적재하게 된다.
   *    2026-10-07 실측: `persona30-creative-20261006.json` 하나(0600). creative JSON 밖의 것이 생기면 다시 본다.
   */
  'persona-autogen': {
    kind: 'state',
    reason: 'Persona creative 결과(--creative-out) — 검토한 유료 생성물 · 대상에서 --supplement 적재 입력',
    contents: { allow: /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/, what: 'creative JSON 파일' },
  },
  /**
   * 🔴 **매거진** 큐 writer 잠금 디렉터리(`scripts/lib/magazine-queue-lock.mjs` 의 `QUEUE_LOCK_DIR`) — D100 레인은 쓰지 않는다.
   *    쥔 잠금을 옮기면 대상에서 영영 풀리지 않고, 매거진은 원 호스트에 남는다. 그 코드가 만드는 것은
   *    `<scope>.queue.lock` 과 회수용 `.reclaim` 뿐이다 — 그 밖의 것이 있으면 조용히 빼지 않고 export 를 멈춘다.
   */
  'queue-locks': {
    kind: 'exclude',
    reason: '매거진 큐 writer 잠금 — 매거진 레인 · 쥔 잠금은 옮기지 않는다(원 호스트에 남는다)',
    contents: { allow: /^[a-z0-9-]+\.queue\.lock(?:\.reclaim)?$/, what: '매거진 큐 잠금 파일' },
  },
  'publish-heartbeat': { kind: 'state', reason: '발행 heartbeat 틱 기록' },
  /**
   * 🔴 **싣지 않는다.** 원 호스트 launchd 회차의 기록이다. 옮기면 대상에서 한 번도 안 돈 러너가
   *    07:00 판정에서 "최근 실제 회차 성공" 으로 읽힌다 — 재등록을 정상으로 간주하는 것과 같다.
   *    대상은 기록 없음(모름)에서 시작해 첫 heartbeat 로 채운다.
   */
  [PUBLISH_RUN_DIR_NAME]: { kind: 'exclude', reason: '원 호스트 발행 회차 기록 — 대상은 첫 회차로 새로 쓴다(옮기면 안 돈 러너가 정상으로 읽힌다)' },
  'runner-recover': { kind: 'state', reason: '러너 복구 표식' },
  'auto-ready-audit': { kind: 'state', reason: '감사 러너 잠금 디렉터리(잠금 파일은 뺀다)' },
  'auto-ready-audit-ledger': { kind: 'state', reason: '감사 예산 장부' },
  'auto-ready-review': { kind: 'state', reason: '자동 READY 검토 묶음' },
  'collect-detail': { kind: 'state', reason: '상세 수집 회차 기록' },
  'collect-runs': { kind: 'state', reason: '수집 회차 기록' },
  'runtime-manifest.json': { kind: 'state', reason: 'runtime 배포 기록(SHA · 게이트)' },
  'runtime-pinned-sha': { kind: 'state', reason: 'runtime 고정 SHA — 대상 clone 기준' },
  'regen-packets': { kind: 'exclude', reason: '매거진 재생성 패킷 — 매거진 레인(원 호스트에 남는다)' },
  'runtime-deploy.lock': { kind: 'exclude', reason: '배포 잠금 — 옮기면 대상 첫 배포가 막힌다' },
  'env-backup': { kind: 'exclude', reason: '옛 env 사본 — 비밀을 더 퍼뜨리지 않는다(원 호스트에 남는다)' },
  'microseed-test-archive': { kind: 'exclude', reason: '시험 보관본' },
  'launchd-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본 — 원 호스트 경로가 박혀 있다' },
  'ops-loop-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'auto-ready-audit-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'comment-runner-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'publish-runner-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  [HANDOFF_FILE]: { kind: 'exclude', reason: '원 호스트 D100 handoff 표식 — manifest 가 따로 싣는다' },
  [QUIESCE_DIR_NAME]: { kind: 'exclude', reason: 'quiesce 로 내린 plist — launchd 입력으로 따로 싣는다' },
  [OWNER_FILE]: { kind: 'exclude', reason: 'D100 레인 소유 표식 — 호스트마다 새로 쓴다' },
  [TARGET_ROLLBACK_DIR_NAME]: { kind: 'exclude', reason: '대상 되돌리기 보관본' },
}

const PREFIX_RULES: readonly { prefix: string; rule: EntryRule }[] = [
  { prefix: 'env.local.bak', rule: { kind: 'exclude', reason: '옛 env 사본 — 비밀을 더 퍼뜨리지 않는다' } },
  { prefix: 'incident-', rule: { kind: 'exclude', reason: '사고 기록 — 원 호스트에 남긴다' } },
  { prefix: 'ops-backup-', rule: { kind: 'exclude', reason: '원 호스트 백업' } },
  { prefix: `host-handoff-${LANE}.undone-`, rule: { kind: 'exclude', reason: '되돌린 handoff 기록 — 원 호스트에 남긴다' } },
  // 🔴 매거진 레인 상태(quarantine · fetch 결과 · 원고 임대 등) — 이번 범위 밖. 원 호스트 매거진이 계속 쓴다
  { prefix: 'magazine-', rule: { kind: 'exclude', reason: '매거진 레인 상태 — 이번 이전 범위 밖(원 호스트에 남는다)' } },
]

export function classifyCanonEntry(name: string): EntryRule {
  const exact = EXACT_RULES[name]
  if (exact !== undefined) return exact
  for (const p of PREFIX_RULES) if (name.startsWith(p.prefix)) return p.rule
  return { kind: 'unclassified', reason: '분류 규칙 없음 — scripts/lib/host-migrate.mts 에 이름을 적고 다시 돌린다' }
}

/** 항목 안의 모양 — 🔴 이름과 종류만. 내용은 읽지 않는다. 링크는 따라가지 않는다(lstat) */
export type ChildEntry = { rel: string; type: 'file' | 'dir' | 'symlink' | 'other' }
export type EntryTree = { rootType: ChildEntry['type']; children: readonly ChildEntry[] }

/**
 * 🔴 **이름 판정 + 내용 규칙.** `contents` 가 붙은 항목은 디렉터리여야 하고, 안의 모든 것이 허용 모양의
 *    바로 아래 일반 파일이어야 한다. 어긋나면 `unclassified` — export 가 멈춘다.
 */
export function classifyCanonEntryIn(name: string, tree: EntryTree): EntryRule {
  const rule = classifyCanonEntry(name)
  if (rule.contents === undefined) return rule
  const allow = rule.contents.allow
  const bad = tree.rootType !== 'dir' ? [`(${name} 자체가 ${tree.rootType})`]
    : tree.children.filter((c) => c.type !== 'file' || c.rel.includes('/') || !allow.test(c.rel)).map((c) => `${c.rel}(${c.type})`)
  if (bad.length === 0) return rule
  return {
    kind: 'unclassified',
    reason: `${rule.contents.what}만 있어야 하는데 예상 밖 항목 ${bad.length}개: ${bad.slice(0, 5).join(' ')}${bad.length > 5 ? ' …' : ''} — 무엇인지 보고 분류를 고친다`,
  }
}

/**
 * 🔴 트리 안에서도 빼는 파일 — 잠금은 호스트마다 새로 잡는다.
 *    쥔 채로 옮긴 잠금은 대상에서 영영 풀리지 않는다(감사 잠금은 자동 회수하지 않는다).
 *    예외: 발행 heartbeat 의 `tick-<시각>.lock` 은 **지난 틱의 표식**이다 — 같은 틱을 대상이 다시
 *    돌지 않게 그대로 옮긴다(시각이 이름이라 미래 틱을 막지 않는다).
 */
export function isTransientFile(name: string, topEntry: string | null = null): boolean {
  if (topEntry === 'publish-heartbeat' && /^tick-[\dT-]+\.lock$/.test(name)) return false
  return name.endsWith('.lock') || name.includes('.tmp-') || name === '.DS_Store'
}

/**
 * 🔴 **대상에서 사람이 다시 로그인해야 하는 것** — 묶음에 싣지 않는다.
 *    Keychain·OAuth refresh token 은 기기에 묶이거나 복사하면 두 기기가 같은 토큰을 쓴다.
 */
export const MANUAL_REAUTH: readonly { what: string; why: string; how: string }[] = [
  { what: 'GitHub (gh · git fetch)', why: 'runtime clone · runtime:deploy fetch', how: 'gh auth login (Keychain 저장)' },
  { what: 'gcloud ADC', why: 'micro-seed 시트 읽기 (~/.config/gcloud)', how: 'gcloud auth application-default login' },
]

/**
 * 🔴 **싣지 않는 매거진 자격증명·작업트리** — plan 이 "원 호스트에 남는다" 로 보여 준다.
 *    이 경로들은 CANON_DIR 밖이라 묶음 걷기가 애초에 닿지 않는다. 여기 적는 것은 사람에게 알리려는 것이다.
 */
export const OUT_OF_LANE_PATHS: readonly { what: string; rel: string }[] = [
  { what: '매거진 runtime 작업트리', rel: 'Documents/soransoran-magazine-runtime' },
  { what: 'ChatGPT 자동화 프로필(매거진)', rel: 'Library/Application Support/soransoran-chatgpt-auto' },
  { what: 'ChatGPT 프로필(매거진)', rel: 'Library/Application Support/soransoran-chatgpt' },
  { what: 'claude CLI(매거진 PATH)', rel: '.local/bin/claude' },
]

// ─────────────────────────────────────────────────────────
// env — 🔴 값은 판정에만 쓴다. 화면·manifest 에 싣지 않는다
// ─────────────────────────────────────────────────────────

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    out.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return out
}

/** 🔴 비밀로 보는 키 — 이름으로 고른다 */
const SECRET_KEY_RE = /(URL|KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|COOKIE)/i
/** 너무 짧은 값은 흔한 문자열과 겹친다 — 누출 검사 오탐을 막는다 */
const SECRET_MIN_LEN = 8

/**
 * 비밀 값 목록 — 🔴 **누출 검사와 가림(redact)에만** 쓴다.
 *    DB URL 은 비밀번호 조각도 따로 넣는다 — 로그에는 URL 전체가 아니라 조각만 찍힐 수 있다.
 */
export function secretValuesOf(envText: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const [key, value] of parseEnv(envText)) {
    if (!SECRET_KEY_RE.test(key) || value.length < SECRET_MIN_LEN) continue
    out.push({ key, value })
    const m = /^[a-z]+:\/\/[^:/@]+:([^@]+)@/i.exec(value)
    if (m !== null && m[1]!.length >= SECRET_MIN_LEN) out.push({ key: `${key}(password)`, value: m[1]! })
  }
  return out
}

/** 🔴 값이 원 호스트 홈 경로인 키 — 대상에서 홈을 바꿔 쓴다. 이름만 돌려준다 */
export function homePathKeys(envText: string, home: string): string[] {
  return [...parseEnv(envText)].filter(([, v]) => v === home || v.startsWith(`${home}/`)).map(([k]) => k)
}

/**
 * 🔴 **홈 경로 값만 바꾼다.** 다른 줄은 바이트 그대로 둔다 — 주석·순서·따옴표를 지키지 않으면
 *    사람이 diff 로 확인할 수 없다.
 */
export function rewriteEnvHome(envText: string, fromHome: string, toHome: string): string {
  if (fromHome === toHome) return envText
  return envText.split('\n').map((line) => {
    const t = line.trim()
    if (t === '' || t.startsWith('#') || t.indexOf('=') <= 0) return line
    const eq = line.indexOf('=')
    const raw = line.slice(eq + 1)
    const q = /^\s*(["']?)/.exec(raw)![1]!
    const body = raw.trim().replace(/^["']|["']$/g, '')
    if (body !== fromHome && !body.startsWith(`${fromHome}/`)) return line
    return `${line.slice(0, eq + 1)}${q}${toHome}${body.slice(fromHome.length)}${q}`
  }).join('\n')
}

/**
 * 🔴 **비밀 모양 패턴** — env 에 없는 비밀(다른 파일에서 새어 들어온 것)도 잡는다.
 *    값 목록 대조만 하면 env 를 바꾼 뒤 옛 키가 로그에 남은 것을 놓친다.
 */
export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'postgres URL 비밀번호', re: /postgres(?:ql)?:\/\/[^\s"'<>:/@]+:[^\s"'<>@]{6,}@/i },
  { name: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Slack webhook', re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
]

export type LeakHit = { where: string; what: string }

/** 🔴 찾은 것의 **이름만** 돌려준다. 값·앞뒤 문맥을 돌려주면 보고서가 누출이 된다 */
export function scanForSecrets(where: string, text: string, secrets: readonly { key: string; value: string }[]): LeakHit[] {
  const hits: LeakHit[] = []
  for (const s of secrets) if (text.includes(s.value)) hits.push({ where, what: `env 값 ${s.key}` })
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push({ where, what: p.name })
  return hits
}

/** 🔴 화면에 나가는 모든 줄은 이것을 지난다 — 이중 안전장치(값을 찍는 코드가 생겨도 가린다) */
export function redact(text: string, secrets: readonly { key: string; value: string }[]): string {
  let out = text
  for (const s of [...secrets].sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(s.value).join(`‹${s.key} 가림›`)
  }
  for (const p of SECRET_PATTERNS) out = out.replace(new RegExp(p.re.source, `${p.re.flags.replace('g', '')}g`), `‹${p.name} 가림›`)
  return out
}

// ─────────────────────────────────────────────────────────
// 묶음 위치 — 🔴 저장소·git 작업트리 안에는 쓰지 않는다
// ─────────────────────────────────────────────────────────

export type OutVerdict = { ok: boolean; reason: string }

/**
 * 🔴 묶음에는 env·네이버 세션이 들어 있다. git 작업트리 안에 두면 `git add` 한 번에 커밋된다.
 *    `gitAncestor` 는 out 경로(또는 가장 가까운 존재하는 조상)에서 위로 올라가며 찾은 `.git` 의 위치다.
 */
export function judgeBundleOut(input: {
  outAbs: string
  gitAncestor: string | null
  forbiddenRoots: readonly string[]
  exists: boolean
  empty: boolean
}): OutVerdict {
  if (!input.outAbs.startsWith('/')) return { ok: false, reason: '--out 은 절대경로여야 한다' }
  if (input.gitAncestor !== null) {
    return { ok: false, reason: `git 작업트리 안이다(${input.gitAncestor}) — 비밀이 커밋될 수 있다` }
  }
  for (const r of input.forbiddenRoots) {
    if (input.outAbs === r || input.outAbs.startsWith(`${r}/`)) return { ok: false, reason: `운영 경로 안이다(${r})` }
  }
  if (input.exists && !input.empty) return { ok: false, reason: '이미 있는 비어 있지 않은 디렉터리다 — 덮어쓰지 않는다' }
  return { ok: true, reason: 'ok' }
}

// ─────────────────────────────────────────────────────────
// plist — 🔴 설치본을 템플릿으로 되돌리고, 대상 값으로 다시 찍는다
// ─────────────────────────────────────────────────────────

export type HostVars = {
  home: string
  nodeBin: string
  /** 원 호스트 PATH 에만 있는 도구 디렉터리(예: /opt/homebrew/bin)는 그대로 둔다 */
}

/**
 * 🔴 **치환 순서가 판정이다 — 긴 것부터.** 홈을 먼저 바꾸면 runtime 경로가 `__HOME__/Documents/…` 로
 *    쪼개져 대상 배치가 원 호스트 배치에 묶인다.
 */
function reverseVars(v: HostVars): { from: string; to: string }[] {
  const p = hostPathsOf(v.home)
  return [
    { from: `${v.nodeBin}/npx`, to: '__NPX__' },
    { from: `${v.nodeBin}/node`, to: '__NODE__' },
    { from: v.nodeBin, to: '__NODEBIN__' },
    { from: p.magazineRuntimeRoot, to: '__MAGAZINE_REPO__' },
    { from: p.runtimeRoot, to: '__REPO__' },
    { from: p.logDir, to: '__LOGDIR__' },
    { from: v.home, to: '__HOME__' },
  ]
}

/**
 * 설치 plist → 호스트 중립 템플릿.
 * 🔴 매거진 runtime 경로도 `__MAGAZINE_REPO__` 로 되돌린다 — D100 템플릿에 이것이 남으면
 *    `renderAndJudge` 가 잡는다(대상에는 매거진 runtime 을 만들지 않는다).
 */
export function templatizePlist(xml: string, source: HostVars): string {
  let out = xml
  for (const { from, to } of reverseVars(source)) out = out.split(from).join(to)
  return out
}

/**
 * 템플릿 → 대상 호스트 plist — 🔴 치환 정본은 `launchd-install.render` 하나다.
 * 🔴 `__MAGAZINE_REPO__` 는 채우지 않는다 — D100 레인 대상에는 매거진 runtime 이 없다.
 */
export function renderForHost(template: string, target: HostVars): string {
  const p = hostPathsOf(target.home)
  return render(template, {
    npx: `${target.nodeBin}/npx`,
    node: `${target.nodeBin}/node`,
    nodebin: target.nodeBin,
    repo: p.runtimeRoot,
    logdir: p.logDir,
    extra: { __HOME__: target.home },
  })
}

/** 🔴 대상 홈이 아닌 `/Users/<누구>` 경로 — 하나라도 있으면 그 job 은 남의 홈을 가리킨다 */
export function foreignHomePaths(xml: string, targetHome: string): string[] {
  const found = [...xml.matchAll(/\/Users\/[^/<\s"'…]+/g)].map((m) => m[0])
  return [...new Set(found.filter((h) => h !== targetHome))]
}

export type RenderedPlist = { label: string; xml: string; problems: string[] }

export function renderAndJudge(label: string, template: string, target: HostVars): RenderedPlist {
  const xml = renderForHost(template, target)
  const problems: string[] = []
  if (!isLaneLabel(label)) problems.push(`${LANE} 레인 allowlist 밖 label — 옮기지 않는다`)
  if (template.includes('__MAGAZINE_REPO__')) problems.push('매거진 runtime 을 가리킨다 — D100 레인 job 이 아니다')
  const left = leftoverPlaceholders(xml)
  if (left.length > 0) problems.push(`치환 안 된 placeholder ${left.join(' ')}`)
  const foreign = foreignHomePaths(xml, target.home)
  if (foreign.length > 0) problems.push(`대상 홈이 아닌 경로 ${foreign.join(' ')}`)
  if (valueOf(xml, 'Label') !== label) problems.push('Label 이 파일 이름과 다르다')
  if (programArguments(xml).length === 0) problems.push('ProgramArguments 없음')
  return { label, xml, problems }
}

/** 설치본에서 nvm node 버전을 읽는다 — 대상에 같은 버전이 있어야 한다 */
export function nodeBinsIn(xml: string): string[] {
  // 🔴 `:` 에서 끊는다 — PATH 한 줄 안의 앞 조각(~/.local/bin 등)을 node 경로로 붙여 읽지 않게
  return [...new Set([...xml.matchAll(/\/[^<\s":]*\/\.nvm\/versions\/node\/v[\d.]+\/bin/g)].map((m) => m[0]))]
}

// ─────────────────────────────────────────────────────────
// manifest
// ─────────────────────────────────────────────────────────

export type BundleEntryKind = 'state' | 'secret' | 'plist-template' | 'log'
export type BundleEntry = { path: string; sha256: string; size: number; mode: string; kind: BundleEntryKind }
export type BundleMode = 'rehearsal' | 'cutover'

export type BundleManifest = {
  formatVersion: number
  /** 🔴 어느 레인의 묶음인가 — 대상은 `LANE` 과 같은 묶음만 받는다 */
  lane: string
  bundleId: string
  mode: BundleMode
  createdAt: string
  source: { home: string; user: string; macos: string | null; arch: string; nodeBin: string; nodeVersion: string }
  runtime: { pinnedSha: string | null }
  envKeys: string[]
  envHomePathKeys: string[]
  plists: { label: string; file: string; loadedAtExport: boolean | null }[]
  /** allowlist 에 있지만 원 호스트에 설치 plist 가 없던 label — 대상에도 없다 */
  laneMissing: string[]
  excluded: { name: string; reason: string }[]
  quiesce: { handoffAt: string | null; loadedBefore: string[] } | null
  entries: BundleEntry[]
}

export type VerifyProblem = { code: 'HASH' | 'MISSING' | 'EXTRA' | 'PERM' | 'LEAK' | 'FORMAT' | 'PLIST' | 'LANE'; detail: string }

/**
 * 🔴 **내용을 다시 읽고 비교한다.** 크기만 보면 같은 길이로 바뀐 비밀을 놓친다.
 *    `actual` 은 묶음 안 실제 파일(manifest 제외)을 부르는 쪽이 해시해 넘긴다.
 */
export function judgeManifest(input: {
  manifest: BundleManifest
  actual: ReadonlyMap<string, { sha256: string; size: number; mode: number }>
}): VerifyProblem[] {
  const out: VerifyProblem[] = []
  if (input.manifest.formatVersion !== BUNDLE_FORMAT_VERSION) {
    out.push({ code: 'FORMAT', detail: `formatVersion ${input.manifest.formatVersion} ≠ ${BUNDLE_FORMAT_VERSION}` })
  }
  if (input.manifest.lane !== LANE) out.push({ code: 'LANE', detail: `묶음 레인 ${String(input.manifest.lane)} ≠ ${LANE}` })
  // 🔴 묶음에 allowlist 밖 job 이 끼어 있으면 대상에서 그것까지 올라간다
  for (const p of input.manifest.plists ?? []) {
    if (!isLaneLabel(p.label)) out.push({ code: 'LANE', detail: `allowlist 밖 job ${p.label}` })
  }
  const listed = new Set<string>()
  for (const e of input.manifest.entries) {
    listed.add(e.path)
    const a = input.actual.get(e.path)
    if (a === undefined) { out.push({ code: 'MISSING', detail: e.path }); continue }
    if (a.sha256 !== e.sha256 || a.size !== e.size) out.push({ code: 'HASH', detail: e.path })
    // 🔴 비밀은 그룹·기타가 읽을 수 없어야 한다
    if (e.kind === 'secret' && (a.mode & 0o077) !== 0) {
      out.push({ code: 'PERM', detail: `${e.path} 권한 ${(a.mode & 0o777).toString(8)} — 0600 이어야 한다` })
    }
  }
  for (const p of input.actual.keys()) if (!listed.has(p)) out.push({ code: 'EXTRA', detail: p })
  return out
}

// ─────────────────────────────────────────────────────────
// 두 호스트 가드
// ─────────────────────────────────────────────────────────

export type GuardVerdict = { ok: boolean; problems: string[] }

/**
 * 🔴 **cutover 묶음을 만들 수 있는가** — 원 호스트의 **D100 레인**이 완전히 내려가 있어야 한다.
 *    loaded 0 만 보면 재부팅 때 plist 파일이 job 을 되살린다. 파일 0 까지 본다.
 *    launchctl 을 **못 읽었으면**(null) 내려갔다고 보지 않는다.
 *    🔴 매거진·개발 job 은 여기서 세지 않는다 — 원 호스트에서 계속 돈다. 거르는 것은 이 함수 자신이다.
 */
export function judgeCutoverExport(input: {
  loadedLabels: readonly string[] | null
  installedPlists: readonly string[]
  handoffPresent: boolean
  handoffBundleId: string | null
}): GuardVerdict {
  const problems: string[] = []
  const loaded = input.loadedLabels === null ? null : input.loadedLabels.filter(isLaneLabel)
  const files = lanePlistFiles(input.installedPlists)
  if (loaded === null) problems.push('launchctl 을 읽지 못했다 — 내려갔는지 모른다')
  else if (loaded.length > 0) problems.push(`원 호스트에 아직 D100 loaded job ${loaded.length}개: ${loaded.join(' ')}`)
  if (files.length > 0) {
    problems.push(`원 호스트 LaunchAgents 에 D100 plist ${files.length}개 — 재부팅·로그인 때 되살아난다`)
  }
  if (!input.handoffPresent) problems.push('handoff 표식이 없다 — 먼저 quiesce --apply')
  if (input.handoffBundleId !== null) {
    problems.push(`이미 묶음 ${input.handoffBundleId} 으로 넘겼다 — 두 번째 cutover 묶음은 만들지 않는다`)
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 **대상에 올려도 되는가.**
 *    · rehearsal 묶음은 원 호스트가 살아 있는 채로 만든 것이다 — 올리면 D100 이 두 호스트에서 같이 돈다.
 *    · 다른 레인 묶음(또는 레인 없는 옛 묶음)은 받지 않는다.
 *    · 대상에 이미 D100 job·소유 표식이 있으면 누가 주인인지 모른다.
 *    · 묶음이 쓸 운영 파일이 대상에 이미 있으면 덮어쓰지 않는다.
 *    · 대상 사용자가 아닌 셸에서 부르면 `gui/<uid>` 가 다른 사람의 도메인이다.
 */
export function judgeTargetInstall(input: {
  bundleMode: BundleMode
  bundleLane: string
  verifyProblems: number
  targetPlists: readonly string[]
  targetLoaded: readonly string[] | null
  targetOwnerPresent: boolean
  targetCanonCollisions: readonly string[]
  targetRuntimeExists: boolean
  runningHome: string
  targetHome: string
  preflightFailures: number
}): GuardVerdict {
  const problems: string[] = []
  if (input.bundleLane !== LANE) problems.push(`${String(input.bundleLane)} 레인 묶음이다 — ${LANE} 묶음만 받는다`)
  if (input.bundleMode !== 'cutover') {
    problems.push('rehearsal 묶음이다 — 원 호스트가 살아 있을 때 만든 것이라 올리면 D100 이 두 호스트에서 같이 돈다')
  }
  if (input.verifyProblems > 0) problems.push(`verify 실패 ${input.verifyProblems}건`)
  const plists = lanePlistFiles(input.targetPlists)
  if (plists.length > 0) problems.push(`대상 LaunchAgents 에 이미 D100 plist ${plists.length}개`)
  if (input.targetLoaded === null) problems.push('대상 launchctl 을 읽지 못했다')
  else if (input.targetLoaded.some(isLaneLabel)) problems.push(`대상에 이미 D100 loaded job: ${input.targetLoaded.filter(isLaneLabel).join(' ')}`)
  if (input.targetOwnerPresent) problems.push(`대상에 이미 ${OWNER_FILE} — D100 주인이 이미 있다`)
  if (input.targetCanonCollisions.length > 0) {
    problems.push(`대상 운영 디렉터리에 묶음이 쓸 항목이 이미 있다(${input.targetCanonCollisions.join(' ')}) — 덮어쓰지 않는다`)
  }
  if (input.targetRuntimeExists) problems.push('대상 runtime 작업트리가 이미 있다')
  if (input.runningHome !== input.targetHome) {
    problems.push(`지금 셸의 홈(${input.runningHome})이 대상 홈(${input.targetHome})과 다르다 — 대상 사용자로 로그인해서 돌린다`)
  }
  if (input.preflightFailures > 0) problems.push(`사전 점검 미충족 ${input.preflightFailures}건`)
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 **원 호스트를 되살려도 되는가** — 대상 rollback 이 찍어 준 bundleId 를 사람이 옮겨 적어야 한다.
 *    원 호스트는 대상을 볼 수 없다. 그래서 "대상이 내려갔다" 는 증거를 사람 손으로 한 번 건넨다.
 */
export function judgeUnquiesce(input: { handoffBundleId: string | null; givenBundleId: string | null }): GuardVerdict {
  if (input.handoffBundleId === null) return { ok: true, problems: [] }
  if (input.givenBundleId === input.handoffBundleId) return { ok: true, problems: [] }
  return {
    ok: false,
    problems: [`묶음 ${input.handoffBundleId} 이 대상에 올라갔을 수 있다 — 대상 rollback --apply 뒤 --bundle-id=${input.handoffBundleId} 로 다시 부른다`],
  }
}

// ─────────────────────────────────────────────────────────
// launchctl list 읽기
// ─────────────────────────────────────────────────────────

/** `launchctl list` 출력 → 우리 label 과 pid(없으면 null) */
export function parseLaunchctlList(out: string): { label: string; pid: number | null }[] {
  const rows: { label: string; pid: number | null }[] = []
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 3) continue
    const label = cols[2]!
    if (!label.startsWith(LABEL_PREFIX)) continue
    rows.push({ label, pid: /^\d+$/.test(cols[0]!) ? Number(cols[0]) : null })
  }
  return rows
}

/**
 * 🔴 **돌고 있는 회차 위로 내리지 않는다** — 발행 트랜잭션이 반쯤 잘린다.
 *    keep-awake 는 늘 pid 가 있다(caffeinate 상주) — 이것만 예외다.
 */
export const ALWAYS_RUNNING_LABELS: readonly string[] = ['com.soransoran.keep-awake']

export function busyLabels(rows: readonly { label: string; pid: number | null }[]): string[] {
  return rows.filter((r) => r.pid !== null && !ALWAYS_RUNNING_LABELS.includes(r.label)).map((r) => r.label)
}

// ─────────────────────────────────────────────────────────
// 원 호스트 내리기 / 되살리기 — 🔴 D100 레인만. 매거진·개발 job 은 loaded 그대로, plist 제자리
// ─────────────────────────────────────────────────────────

export type QuiescePlan = {
  /** bootout 할 D100 label */
  bootout: string[]
  /** LaunchAgents 밖으로 옮길 D100 plist 파일 이름 */
  move: string[]
  /** 실행 중이라 지금 내리면 안 되는 D100 label */
  busy: string[]
  /** 건드리지 않는 loaded job (매거진·개발·모르는 것) */
  untouchedLoaded: string[]
  /** 건드리지 않는 plist 파일 */
  untouchedPlists: string[]
}

/** 🔴 allowlist 로 거르는 것이 이 함수의 일이다 — 부르는 쪽은 launchctl·디렉터리를 통째로 넘긴다 */
export function planQuiesce(input: { rows: readonly { label: string; pid: number | null }[]; plistFiles: readonly string[] }): QuiescePlan {
  const lane = input.rows.filter((r) => isLaneLabel(r.label))
  return {
    bootout: lane.map((r) => r.label),
    move: lanePlistFiles(input.plistFiles),
    busy: busyLabels(lane),
    untouchedLoaded: input.rows.filter((r) => !isLaneLabel(r.label)).map((r) => r.label),
    untouchedPlists: input.plistFiles.filter((f) => laneLabelOfPlistFile(f) === null),
  }
}

export type QuiesceEffects = {
  bootout: (label: string) => boolean
  movePlist: (file: string) => boolean
  /** 내린 뒤 다시 읽은 loaded label 전부 — 못 읽으면 null */
  loadedAfter: () => string[] | null
}

export type QuiesceResult = { ok: boolean; moved: string[]; residual: string[] }

/**
 * 🔴 **plan.bootout · plan.move 밖은 절대 부르지 않는다.** 실행 중 회차가 있으면 아무것도 하지 않는다.
 *    하나가 실패해도 나머지를 계속하고, 남은 D100 loaded·못 옮긴 파일을 적는다.
 */
export function runQuiesce(plan: QuiescePlan, fx: QuiesceEffects): QuiesceResult {
  if (plan.busy.length > 0) return { ok: false, moved: [], residual: plan.busy.map((l) => `실행 중 ${l}`) }
  const residual: string[] = []
  for (const l of plan.bootout) if (!isLaneLabel(l) || !fx.bootout(l)) residual.push(`bootout 실패 ${l}`)
  const moved: string[] = []
  for (const f of plan.move) {
    if (laneLabelOfPlistFile(f) !== null && fx.movePlist(f)) moved.push(f)
    else residual.push(`plist 옮기기 실패 ${f}`)
  }
  const after = fx.loadedAfter()
  if (after === null) residual.push('내린 뒤 launchctl 을 읽지 못했다')
  else for (const l of after.filter(isLaneLabel)) residual.push(`아직 loaded ${l}`)
  return { ok: residual.length === 0, moved, residual }
}

export type UnquiesceEffects = {
  restorePlist: (file: string) => boolean
  bootstrap: (label: string) => boolean
}

/**
 * 🔴 **handoff 에 적힌 것 중 allowlist 안만 되살린다.** handoff 파일이 손으로 고쳐져 매거진 label 이
 *    들어 있어도 여기서 걸러진다. 되살리는 job 은 내리기 전 loaded 였던 것만이다.
 */
export function runUnquiesce(handoff: { plists: readonly string[]; loadedBefore: readonly string[] }, fx: UnquiesceEffects): { ok: boolean; residual: string[] } {
  const residual: string[] = []
  for (const f of lanePlistFiles(handoff.plists)) if (!fx.restorePlist(f)) residual.push(`plist 제자리 실패 ${f}`)
  for (const l of handoff.loadedBefore.filter(isLaneLabel)) if (!fx.bootstrap(l)) residual.push(`bootstrap 실패 ${l}`)
  return { ok: residual.length === 0, residual }
}

/** 🔴 대상 되돌리기 — 묶음 manifest 의 label 중 allowlist 안만 내린다 */
export function targetRollbackLabels(manifestLabels: readonly string[]): string[] {
  return manifestLabels.filter(isLaneLabel)
}

// ─────────────────────────────────────────────────────────
// 전원 — 🔴 기종은 묻지 않는다. **AC 에 꽂혀 있는가**만 본다
// ─────────────────────────────────────────────────────────

export type PowerReading = {
  /** `Now drawing from '…'` */
  source: 'ac' | 'battery' | 'ups' | 'unknown'
  hasBattery: boolean
  /** 배터리 줄의 상태 조각 — charging · charged · discharging · AC attached · finishing charge … */
  batteryState: string | null
  percent: number | null
}

/**
 * `pmset -g batt` / `pmset -g ps` 출력 → 전원 상태. 두 명령은 같은 모양을 찍는다.
 *   Now drawing from 'AC Power'
 *    -InternalBattery-0 (id=…)	85%; charging; 1:02 remaining present: true
 */
export function parsePmsetBatt(text: string): PowerReading {
  const src = /Now drawing from '([^']+)'/.exec(text)?.[1] ?? null
  const source: PowerReading['source'] = src === null ? 'unknown'
    : /^AC Power$/i.test(src) ? 'ac' : /^Battery Power$/i.test(src) ? 'battery' : /^UPS Power$/i.test(src) ? 'ups' : 'unknown'
  const line = text.split('\n').find((l) => /InternalBattery/.test(l)) ?? null
  if (line === null) return { source, hasBattery: false, batteryState: null, percent: null }
  const m = /(\d+)%;\s*([^;]+);/.exec(line)
  return { source, hasBattery: true, batteryState: m?.[2]?.trim() ?? null, percent: m === null ? null : Number(m[1]) }
}

/**
 * 🔴 **D100 운영 조건 = AC 전원.** 배터리 있는 MacBook 도 된다 — 단 AC 에 꽂혀 있어야 한다.
 *    · 배터리로 돌고 있음(discharging · 'Battery Power') → 실패 — `caffeinate -s` 가 듣지 않아 잠든다.
 *    · UPS 로 돌고 있음 → 실패 — 정전 중이다.
 *    · 못 읽음 → 실패(관측 없음은 통과가 아니다).
 */
export function judgePower(p: PowerReading): { ok: boolean; detail: string } {
  if (p.source === 'unknown') return { ok: false, detail: '전원 관측 없음' }
  if (p.source === 'battery') return { ok: false, detail: `배터리로 돌고 있다${p.percent === null ? '' : ` (${p.percent}%)`} — AC 에 꽂는다` }
  if (p.source === 'ups') return { ok: false, detail: 'UPS 전원으로 돌고 있다 — 정전 중' }
  if (!p.hasBattery) return { ok: true, detail: 'AC (배터리 없음)' }
  const st = (p.batteryState ?? '').toLowerCase()
  if (st === 'discharging') return { ok: false, detail: 'AC 표시지만 배터리 방전 중 — 어댑터 출력 부족' }
  if (st === '') return { ok: false, detail: 'AC · 배터리 상태 관측 없음' }
  return { ok: true, detail: `AC 연결 · 배터리 ${p.batteryState ?? ''}${p.percent === null ? '' : ` ${p.percent}%`}` }
}

/**
 * 정전 뒤 자동으로 켜지는가 — 🔴 배터리가 있으면 배터리가 정전을 버티므로 autorestart 를 요구하지 않는다.
 *    배터리 없는 Mac 은 `pmset autorestart 1` 이어야 한다.
 */
export function judgeAutorestart(p: PowerReading, autorestart: string | null): { ok: boolean; detail: string } {
  if (p.hasBattery) return { ok: true, detail: '배터리가 짧은 정전을 버틴다 — autorestart 해당 없음' }
  return autorestart === '1' ? { ok: true, detail: '1' } : { ok: false, detail: autorestart ?? '관측 없음' }
}

// ─────────────────────────────────────────────────────────
// 대상 설치 — 🔴 진짜 명령은 부르는 쪽이 붙인다
// ─────────────────────────────────────────────────────────

export type InstallEffects = {
  cloneRepo: () => boolean
  addRuntime: (sha: string) => boolean
  installDeps: () => boolean
  restoreState: () => boolean
  writeEnv: () => boolean
  writePlist: (label: string, xml: string) => boolean
  lintPlist: (label: string) => boolean
  bootstrap: (label: string) => boolean
  isolationCheck: () => boolean
  writeOwner: () => boolean
  // 되돌리기
  bootout: (label: string) => boolean
  retirePlist: (label: string) => boolean
  removeOwner: () => boolean
  log: (m: string) => void
}

export type InstallInput = {
  pinnedSha: string
  plists: readonly RenderedPlist[]
  loadLabels: readonly string[]
}

export type InstallResult = { ok: boolean; phase: string; rollback: { complete: boolean; residual: string[] } | null }

/**
 * 🔴 **plist 를 쓰기 시작한 뒤의 실패는 되돌린다.** 되돌리다 하나가 실패해도 나머지를 계속하고
 *    남은 것을 적는다(runtime-deploy 와 같은 원칙).
 *    clone·state 복원 단계의 실패는 launchd 에 아무것도 올리지 않았으므로 멈추기만 한다.
 */
export function runInstall(input: InstallInput, fx: InstallEffects): InstallResult {
  const stop = (phase: string): InstallResult => ({ ok: false, phase, rollback: null })
  if (input.plists.some((p) => p.problems.length > 0)) return stop('render')
  // 🔴 allowlist 밖 job 은 대상에 쓰지도 올리지도 않는다(render 판정을 건너뛴 입력이어도)
  if (input.plists.some((p) => !isLaneLabel(p.label)) || input.loadLabels.some((l) => !isLaneLabel(l))) return stop('lane')
  if (!fx.cloneRepo()) return stop('clone')
  if (!fx.addRuntime(input.pinnedSha)) return stop('runtime')
  if (!fx.installDeps()) return stop('deps')
  if (!fx.restoreState()) return stop('state')
  if (!fx.writeEnv()) return stop('env')

  const written: string[] = []
  const booted: string[] = []
  const undo = (phase: string): InstallResult => {
    const residual: string[] = []
    // 🔴 내리기 먼저 — 파일을 치우기 전에 job 을 멈춘다
    for (const l of [...booted].reverse()) if (!fx.bootout(l)) residual.push(`bootout 실패 ${l}`)
    for (const l of [...written].reverse()) if (!fx.retirePlist(l)) residual.push(`plist 치우기 실패 ${l}`)
    if (!fx.removeOwner()) residual.push('소유 표식 지우기 실패')
    fx.log(residual.length === 0 ? '되돌림 완료' : `되돌림 잔여 ${residual.length}건`)
    return { ok: false, phase, rollback: { complete: residual.length === 0, residual } }
  }
  for (const p of input.plists) {
    if (!fx.writePlist(p.label, p.xml)) return undo(`write ${p.label}`)
    written.push(p.label)
    if (!fx.lintPlist(p.label)) return undo(`lint ${p.label}`)
  }
  // 🔴 소유 표식은 job 을 올리기 **전에** 쓴다 — 올린 뒤 쓰다 죽으면 주인 없는 job 이 돈다
  if (!fx.writeOwner()) return undo('owner')
  for (const l of input.loadLabels) {
    if (!fx.bootstrap(l)) return undo(`bootstrap ${l}`)
    booted.push(l)
  }
  if (!fx.isolationCheck()) return undo('isolation-check')
  return { ok: true, phase: 'done', rollback: null }
}

/** 전환 순서 — 🔴 문서와 CLI 가 같은 목록을 쓴다 */
export const CUTOVER_ORDER: readonly string[] = [
  '① [원] npm run host:migrate                                   계획(읽기 전용)',
  '② [원] npm run host:migrate -- export --out=<외장/임시>       rehearsal 묶음 → 대상에서 verify · install dry-run 으로 사전 점검',
  '③ [원] npm run host:migrate -- quiesce --apply                D100 job 만 bootout + 그 plist 만 LaunchAgents 밖으로 · d100 handoff 표식 (매거진은 그대로 돈다)',
  '④ [원] npm run host:migrate -- export --cutover --out=<dir>   D100 loaded 0 · D100 plist 0 · handoff 가 있어야 만든다',
  '⑤ 옮기기 — 암호화된 외장 볼륨 또는 AirDrop. 클라우드 드라이브·메신저 금지',
  '⑥ [대상] npm run host:migrate -- verify --bundle=<dir>',
  '⑦ [대상] npm run host:migrate -- install --bundle=<dir> --target-home=$HOME --apply',
  '⑧ [대상] npm run ops:status · 첫 발행 heartbeat · 댓글 회차 로그 확인',
  '⑨ 양쪽 묶음 삭제(rm -rf) — 비밀이 들어 있다',
]

export const ROLLBACK_ORDER: readonly string[] = [
  '① [대상] npm run host:migrate -- rollback --bundle=<dir> --target-home=$HOME --apply   D100 job bootout · plist 보관 · d100 소유 표식 삭제',
  '② [원]   npm run host:migrate -- unquiesce --bundle-id=<①이 찍은 id> --apply           D100 plist 제자리 · 내리기 전 loaded 였던 D100 job 만 bootstrap',
  '③ [원]   npm run runtime:isolation-check -- --require-runtime',
  '🔴 pin 은 되돌릴 것이 없다 — 원 호스트의 runtime-pinned-sha 는 이전 내내 바뀌지 않는다',
]
