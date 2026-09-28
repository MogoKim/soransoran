/**
 * 상시 실행 호스트 이전 — 🔴 **판단만 한다. 파일·launchctl·네트워크를 직접 건드리지 않는다** (2026-09-29 · Track C)
 *
 * 🔴 **왜 생겼나.**
 *    무인 루프(공급·발행 heartbeat·댓글 루프·감사·단계 controller·복구·keep-awake·네이버 수집·매거진)가
 *    창업자 노트북의 launchd(gui 도메인)에서 돈다. 덮개·배터리 잠자기·로그아웃·네트워크 끊김이면 전부 선다.
 *    실측(2026-09-29 03:10~05:20): 배터리로 잠든 동안 DarkWake 만 반복됐다 — `caffeinate -s` 는 AC 에서만 듣는다.
 *    이것을 **전용 Mac 한 대로 한 번에 옮기는 묶음**이 필요하다.
 *
 * 🔴 이 파일은 순수 판정이다 — 부르는 쪽(`scripts/host-migrate.mts`)이 진짜 명령을 붙인다.
 *    그래야 검사(`scripts/host-migrate-check.mts`)가 가짜를 붙여 실패·되돌리기를 시험할 수 있다.
 *
 * 🔴 **두 호스트가 동시에 돌 수 없게 하는 구조** (정본 설명은 docs/operations/ALWAYS-ON-HOST.md)
 *    ① 원 호스트 `quiesce --apply` — job 전부 bootout + **plist 파일을 LaunchAgents 밖으로** 옮긴다
 *       (파일이 남으면 로그인·재부팅 때 launchd 가 되살린다 — 2026-09-09 실측 사고).
 *    ② `export --cutover` 는 원 호스트에 loaded job 0 · 설치 plist 0 · handoff 표식이 있을 때만 만든다.
 *    ③ 대상 `install --apply` 는 **cutover 묶음만** 받는다. rehearsal 묶음은 거부한다.
 *    ④ 원 호스트 되살리기(`unquiesce`)는 대상 rollback 이 찍어 준 bundleId 를 요구한다.
 *    ⑤ 마지막 방어선: 글·댓글 발행 트랜잭션은 Serializable 안에서 오늘 수를 다시 센다
 *       (`src/lib/original-post-publish-tx.ts` · `src/lib/persona-publish-tx.ts`).
 */
import { leftoverPlaceholders, programArguments, render, valueOf } from './launchd-install.mjs'

export const BUNDLE_FORMAT_VERSION = 1
export const BUNDLE_MANIFEST = 'host-bundle.json'
export const LABEL_PREFIX = 'com.soransoran.'
/** 🔴 원 호스트가 소유권을 넘겼다는 표식 — CANON_DIR 바로 아래 */
export const HANDOFF_FILE = 'host-handoff.json'
/** 🔴 대상 호스트가 지금 주인이라는 표식 */
export const OWNER_FILE = 'host-owner.json'
/** quiesce 가 plist 를 옮겨 두는 곳 (CANON_DIR 아래) */
export const QUIESCE_DIR_NAME = 'host-migrate-quiesced'
/** 대상 rollback 이 plist 를 옮겨 두는 곳 (대상 CANON_DIR 아래) */
export const TARGET_ROLLBACK_DIR_NAME = 'host-migrate-rollback'

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
export type EntryRule = { kind: EntryKind; reason: string }

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
  'publish-heartbeat': { kind: 'state', reason: '발행 heartbeat 틱 기록' },
  'auto-ready-audit': { kind: 'state', reason: '감사 러너 잠금 디렉터리(잠금 파일은 뺀다)' },
  'auto-ready-audit-ledger': { kind: 'state', reason: '감사 예산 장부' },
  'auto-ready-review': { kind: 'state', reason: '자동 READY 검토 묶음' },
  'collect-detail': { kind: 'state', reason: '상세 수집 회차 기록' },
  'collect-runs': { kind: 'state', reason: '수집 회차 기록' },
  'regen-packets': { kind: 'state', reason: '매거진 재생성 패킷' },
  'runtime-manifest.json': { kind: 'state', reason: 'runtime 배포 기록(SHA · 게이트)' },
  'runtime-pinned-sha': { kind: 'state', reason: 'runtime 고정 SHA — 대상 clone 기준' },
  'magazine-manuscript-leases': { kind: 'exclude', reason: '진행 중 원고 임대(잠금) — 옮기면 대상이 남의 임대에 막힌다' },
  'runtime-deploy.lock': { kind: 'exclude', reason: '배포 잠금 — 옮기면 대상 첫 배포가 막힌다' },
  'env-backup': { kind: 'exclude', reason: '옛 env 사본 — 비밀을 더 퍼뜨리지 않는다(원 호스트에 남는다)' },
  'microseed-test-archive': { kind: 'exclude', reason: '시험 보관본' },
  'launchd-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본 — 원 호스트 경로가 박혀 있다' },
  'ops-loop-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'auto-ready-audit-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'comment-runner-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  'publish-runner-rollback': { kind: 'exclude', reason: '원 호스트 전용 되돌리기 보관본' },
  [HANDOFF_FILE]: { kind: 'exclude', reason: '원 호스트 handoff 표식 — manifest 가 따로 싣는다' },
  [QUIESCE_DIR_NAME]: { kind: 'exclude', reason: 'quiesce 로 내린 plist — launchd 입력으로 따로 싣는다' },
  [OWNER_FILE]: { kind: 'exclude', reason: '호스트 소유 표식 — 호스트마다 새로 쓴다' },
  [TARGET_ROLLBACK_DIR_NAME]: { kind: 'exclude', reason: '대상 되돌리기 보관본' },
}

const PREFIX_RULES: readonly { prefix: string; rule: EntryRule }[] = [
  { prefix: 'env.local.bak', rule: { kind: 'exclude', reason: '옛 env 사본 — 비밀을 더 퍼뜨리지 않는다' } },
  { prefix: 'incident-', rule: { kind: 'exclude', reason: '사고 기록 — 원 호스트에 남긴다' } },
  { prefix: 'ops-backup-', rule: { kind: 'exclude', reason: '원 호스트 백업' } },
  { prefix: 'host-handoff.undone-', rule: { kind: 'exclude', reason: '되돌린 handoff 기록 — 원 호스트에 남긴다' } },
  { prefix: 'magazine-', rule: { kind: 'state', reason: '매거진 레인 상태(quarantine · fetch 결과 등)' } },
]

export function classifyCanonEntry(name: string): EntryRule {
  const exact = EXACT_RULES[name]
  if (exact !== undefined) return exact
  for (const p of PREFIX_RULES) if (name.startsWith(p.prefix)) return p.rule
  return { kind: 'unclassified', reason: '분류 규칙 없음 — scripts/lib/host-migrate.mts 에 이름을 적고 다시 돌린다' }
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
  { what: 'GitHub (gh · git fetch)', why: 'runtime clone · runtime:deploy fetch · 매거진 PR', how: 'gh auth login (Keychain 저장)' },
  { what: 'gcloud ADC', why: 'micro-seed 시트 읽기 (~/.config/gcloud)', how: 'gcloud auth application-default login' },
  { what: 'ChatGPT 자동화 프로필', why: '매거진 레인(~/Library/Application Support/soransoran-chatgpt-auto)', how: '매거진 runbook 의 프로필 준비 절차' },
  { what: 'claude CLI', why: '매거진 레인 PATH(~/.local/bin)', how: 'claude 설치 후 로그인' },
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

/** 설치 plist → 호스트 중립 템플릿 */
export function templatizePlist(xml: string, source: HostVars): string {
  let out = xml
  for (const { from, to } of reverseVars(source)) out = out.split(from).join(to)
  return out
}

/** 템플릿 → 대상 호스트 plist — 🔴 치환 정본은 `launchd-install.render` 하나다 */
export function renderForHost(template: string, target: HostVars): string {
  const p = hostPathsOf(target.home)
  return render(template, {
    npx: `${target.nodeBin}/npx`,
    node: `${target.nodeBin}/node`,
    nodebin: target.nodeBin,
    repo: p.runtimeRoot,
    logdir: p.logDir,
    extra: { __MAGAZINE_REPO__: p.magazineRuntimeRoot, __HOME__: target.home },
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
  bundleId: string
  mode: BundleMode
  createdAt: string
  source: { home: string; user: string; macos: string | null; arch: string; nodeBin: string; nodeVersion: string }
  runtime: { pinnedSha: string | null; magazineSha: string | null }
  envKeys: string[]
  envHomePathKeys: string[]
  plists: { label: string; file: string; loadedAtExport: boolean | null }[]
  excluded: { name: string; reason: string }[]
  quiesce: { handoffAt: string | null; loadedBefore: string[] } | null
  entries: BundleEntry[]
}

export type VerifyProblem = { code: 'HASH' | 'MISSING' | 'EXTRA' | 'PERM' | 'LEAK' | 'FORMAT' | 'PLIST'; detail: string }

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
 * 🔴 **cutover 묶음을 만들 수 있는가** — 원 호스트가 완전히 내려가 있어야 한다.
 *    loaded 0 만 보면 재부팅 때 plist 파일이 job 을 되살린다. 파일 0 까지 본다.
 *    launchctl 을 **못 읽었으면**(null) 내려갔다고 보지 않는다.
 */
export function judgeCutoverExport(input: {
  loadedLabels: readonly string[] | null
  installedPlists: readonly string[]
  handoffPresent: boolean
  handoffBundleId: string | null
}): GuardVerdict {
  const problems: string[] = []
  if (input.loadedLabels === null) problems.push('launchctl 을 읽지 못했다 — 내려갔는지 모른다')
  else if (input.loadedLabels.length > 0) problems.push(`원 호스트에 아직 loaded job ${input.loadedLabels.length}개: ${input.loadedLabels.join(' ')}`)
  if (input.installedPlists.length > 0) {
    problems.push(`원 호스트 LaunchAgents 에 plist ${input.installedPlists.length}개 — 재부팅·로그인 때 되살아난다`)
  }
  if (!input.handoffPresent) problems.push('handoff 표식이 없다 — 먼저 quiesce --apply')
  if (input.handoffBundleId !== null) {
    problems.push(`이미 묶음 ${input.handoffBundleId} 으로 넘겼다 — 두 번째 cutover 묶음은 만들지 않는다`)
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 **대상에 올려도 되는가.**
 *    · rehearsal 묶음은 원 호스트가 살아 있는 채로 만든 것이다 — 올리면 두 호스트가 같이 돈다.
 *    · 대상에 이미 job 이 있으면 누가 주인인지 모른다.
 *    · 대상 사용자가 아닌 셸에서 부르면 `gui/<uid>` 가 다른 사람의 도메인이다.
 */
export function judgeTargetInstall(input: {
  bundleMode: BundleMode
  verifyProblems: number
  targetPlists: readonly string[]
  targetLoaded: readonly string[] | null
  targetCanonNonEmpty: boolean
  targetRuntimeExists: boolean
  runningHome: string
  targetHome: string
  preflightFailures: number
}): GuardVerdict {
  const problems: string[] = []
  if (input.bundleMode !== 'cutover') {
    problems.push('rehearsal 묶음이다 — 원 호스트가 살아 있을 때 만든 것이라 올리면 두 호스트가 같이 돈다')
  }
  if (input.verifyProblems > 0) problems.push(`verify 실패 ${input.verifyProblems}건`)
  if (input.targetPlists.length > 0) problems.push(`대상 LaunchAgents 에 이미 plist ${input.targetPlists.length}개`)
  if (input.targetLoaded === null) problems.push('대상 launchctl 을 읽지 못했다')
  else if (input.targetLoaded.length > 0) problems.push(`대상에 이미 loaded job: ${input.targetLoaded.join(' ')}`)
  if (input.targetCanonNonEmpty) problems.push('대상 운영 디렉터리가 비어 있지 않다 — 덮어쓰지 않는다')
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
// 대상 설치 — 🔴 진짜 명령은 부르는 쪽이 붙인다
// ─────────────────────────────────────────────────────────

export type InstallEffects = {
  cloneRepo: () => boolean
  addRuntime: (sha: string) => boolean
  addMagazineRuntime: (sha: string) => boolean
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
  magazineSha: string | null
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
  if (!fx.cloneRepo()) return stop('clone')
  if (!fx.addRuntime(input.pinnedSha)) return stop('runtime')
  if (input.magazineSha !== null && !fx.addMagazineRuntime(input.magazineSha)) return stop('magazine-runtime')
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
  '③ [원] npm run host:migrate -- quiesce --apply                job 전부 bootout + plist 를 LaunchAgents 밖으로 · handoff 표식',
  '④ [원] npm run host:migrate -- export --cutover --out=<dir>   loaded 0 · plist 0 · handoff 가 있어야 만든다',
  '⑤ 옮기기 — 암호화된 외장 볼륨 또는 AirDrop. 클라우드 드라이브·메신저 금지',
  '⑥ [대상] npm run host:migrate -- verify --bundle=<dir>',
  '⑦ [대상] npm run host:migrate -- install --bundle=<dir> --target-home=$HOME --apply',
  '⑧ [대상] npm run ops:status · 첫 발행 heartbeat · 댓글 회차 로그 확인',
  '⑨ 양쪽 묶음 삭제(rm -rf) — 비밀이 들어 있다',
]

export const ROLLBACK_ORDER: readonly string[] = [
  '① [대상] npm run host:migrate -- rollback --bundle=<dir> --target-home=$HOME --apply   job bootout · plist 보관 · 소유 표식 삭제',
  '② [원]   npm run host:migrate -- unquiesce --bundle-id=<①이 찍은 id> --apply           plist 제자리 · 내리기 전 loaded 였던 job 만 bootstrap',
  '③ [원]   npm run runtime:isolation-check -- --require-runtime',
  '🔴 pin 은 되돌릴 것이 없다 — 원 호스트의 runtime-pinned-sha 는 이전 내내 바뀌지 않는다',
]
