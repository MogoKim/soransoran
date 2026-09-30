/**
 * 🔴 **단일 실행 authority 가드 — 활성 호출 그래프로 증명한다** (2026-09-30 · D100 Lane A)
 *
 * 정본: `soransoran-d100-canon` "single always-on runtime owner · no routine human stage/env command" ·
 *       "two independent authorities for the same decision are a defect".
 *
 * 🔴 **무엇을 막는가 (옛 authority 가 돌아오는 다섯 길)**
 *    ① **두 번째 schedule owner** — GitHub `on.schedule` 이 발행 엔트리에 닿거나, 같은 엔트리를
 *       workflow cron 과 launchd 가 함께 예약한다(2026-09-22~24 GitHub 예약이 실제로 11건을 발행했다).
 *    ② **consumer 우회** — 발행 · 공급 엔트리를 `stage-consume-exec --by=<같은 종류>` 없이 부른다.
 *       workflow run · package.json script · launchd ProgramArguments · 운영 셸 어디서든.
 *    ③ **옛 단계 변수 소비** — `SORAN_CAPACITY_STAGE` · `SORAN_RELEASE_STAGE` · `SORAN_RELEASE_CANARY_*` ·
 *       `SORAN_RELEASE_WINDOW_*` · `SORAN_STAGE_PROOF_*` · 표식(`SORAN_STAGE_DECISION_DATE`)을 workflow ·
 *       plist · package.json · 셸이 넘기거나(`vars.*` 포함), 허용 밖 TypeScript 가 읽는다.
 *    ④ **StageDecision 밖 stage authority** — 허용된 네 파일(정의 · 유일한 읽기 문 · 증명일 · 유일한 쓰기) 밖에서
 *       단계 운반 칸이나 표식을 다룬다.
 *    ⑤ **fixture 표식이 운영 경로로 샌다** — 검사 전용 `stage-decision-fixture` 를 운영 엔트리가 import 한다.
 *
 * 🔴 **문자열 grep 으로 끝내지 않는다.**
 *    · workflow 는 YAML 로 **파싱**해 `on.schedule` 존재와 각 step 의 `run` 명령을 꺼낸다(주석은 사라진다).
 *    · 명령은 셸 토큰으로 나누고 `npm run <x>` 는 **package.json 으로 해석**해 실제 스크립트 엔트리까지 따라간다.
 *    · `stage-consume-exec --by=X -- <cmd>` 는 감싼 명령을 다시 해석한다 — 감싼 종류가 엔트리 종류와 같아야 한다.
 *    · launchd 는 템플릿 파일과 TS 렌더러가 **실제로 내는 plist** 의 ProgramArguments 로 같은 판정을 한다.
 *    · 발행 엔트리는 손 목록이 아니라 **import 그래프**로 정한다 — 발행 트랜잭션(`original-post-publish-tx`)에
 *      닿는 top-level 스크립트 전부다.
 *
 * 🔴 순수 판정(`judgeAuthority`)과 읽기(`readAuthorityInputs`)를 나눈다 — 검사가 입력을 바꿔 변이 시험을 한다.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname, normalize, relative } from 'node:path'

// ─────────────────────────────────────────────────────────
// 정본 상수
// ─────────────────────────────────────────────────────────

/** 🔴 자동 실행의 유일한 문 */
export const CONSUMER_SCRIPT = 'scripts/stage-consume-exec.mts'
/** 🔴 발행 트랜잭션 — 여기에 닿는 top-level 스크립트가 발행 엔트리다 */
export const PUBLISH_TX_MODULE = 'src/lib/original-post-publish-tx.ts'
/** 🔴 결정을 소비해야 하는 공급 엔트리 — `--by=supply` 로만 부른다 */
export const SUPPLY_CONSUMER_ENTRIES: readonly string[] = ['scripts/supply-process.mts']
/** 🔴 검사 전용 표식 fixture — 운영 엔트리가 닿으면 안 된다 */
export const FIXTURE_MODULE = 'scripts/lib/stage-decision-fixture.ts'

/** 🔴 옛 단계 변수 · 운반 칸 · 표식 — workflow · plist · package.json · 셸에 나오면 실패 */
export const LEGACY_ENV_RE = /\bSORAN_(CAPACITY_STAGE|RELEASE_STAGE|RELEASE_CANARY_[A-Z_]+|RELEASE_WINDOW_[A-Z_]+|STAGE_PROOF_[A-Z_]+|STAGE_DECISION_DATE)\b/g
/** 🔴 CANARY · WINDOW 는 어떤 TypeScript 도 읽지 않는다(검사 파일 제외) */
export const DEAD_KEY_RE = /\bSORAN_RELEASE_(CANARY|WINDOW)_[A-Z_]+\b/g
/** 🔴 단계 운반 칸 · 표식 — 이름 문자열이든 상수 식별자든 */
export const STAGE_ENV_TOKEN_RE = /\bSORAN_(CAPACITY_STAGE|RELEASE_STAGE|STAGE_PROOF_STAGE|STAGE_PROOF_DATE|STAGE_DECISION_DATE)\b|\b(RELEASE_ENV|CAPACITY_ENV|PROOF_STAGE_ENV|PROOF_DATE_ENV|PROOF_ENV_KEYS|STAGE_DECISION_MARK_ENV)\b/g

/**
 * 🔴 **단계 칸을 다뤄도 되는 파일 — 이 넷(과 가드 자신)뿐이다.**
 *    정의(scale-profile) · 유일한 읽기 문(scale-runtime) · 증명일(stage-proof-day) · 유일한 쓰기(stage-controller.consumerEnvOf).
 */
export const STAGE_ENV_ALLOWED: readonly string[] = [
  'src/lib/scale-profile.ts',
  'src/lib/scale-runtime.ts',
  'src/lib/stage-proof-day.ts',
  'src/lib/stage-controller.ts',
  'scripts/lib/stage-authority-graph.ts',
  FIXTURE_MODULE,
]

/**
 * 🔴 **다른 레인 소유 파일의 남은 소비 지점 — 정확한 패치 사양과 함께 보고한다.**
 *    여기 있는 파일이 더 이상 위반하지 않으면 **실패한다**(낡은 허용 목록을 남기지 않는다).
 *    새 파일은 여기에 넣어 통과시키지 않는다 — 소유 레인이 고친 뒤 이 줄을 지운다.
 */
export const PENDING_OTHER_LANE: Readonly<Record<string, string>> = {
  'src/lib/wave-c-readiness.ts': 'Lane D — `planPromotion` 이 `.env.local` 의 SORAN_RELEASE_STAGE 를 사람이 바꾸라고 안내한다(수동 단계 명령)',
  'scripts/ops-status.mts': 'Lane D — 정본 env 에서 SORAN_RELEASE_STAGE · SORAN_CAPACITY_STAGE 를 읽는다(쓰지 않는 읽기 · 지울 것)',
}

export type EntryKind = 'publish' | 'supply'

// ─────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────

export type WorkflowInput = { file: string; text: string }
export type LaunchdInput = { source: string; xml: string }
export type AuthorityInputs = {
  workflows: readonly WorkflowInput[]
  launchd: readonly LaunchdInput[]
  /** package.json `scripts` */
  packageScripts: Readonly<Record<string, string>>
  shells: readonly { file: string; text: string }[]
  /** repo 상대 경로 → 소스 (src/** · scripts/** 의 .ts/.mts/.tsx/.mjs) */
  sources: ReadonlyMap<string, string>
}

// ─────────────────────────────────────────────────────────
// 셸 토큰 · 명령 해석
// ─────────────────────────────────────────────────────────

/** 🔴 한 run 블록 → 명령 목록(토큰 배열). 주석 줄 · 줄 이음 · && || ; | 를 나눈다. 따옴표는 한 토큰이다 */
export function shellCommands(block: string): string[][] {
  const joined = block.replace(/\\\r?\n/g, ' ')
  const out: string[][] = []
  for (const rawLine of joined.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    let cur: string[] = []
    let tok = ''
    let q: '"' | "'" | null = null
    let has = false
    const push = (): void => { if (has) { cur.push(tok); tok = ''; has = false } }
    const end = (): void => { push(); if (cur.length > 0) out.push(cur); cur = [] }
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i]!
      if (q !== null) {
        if (c === q) q = null
        else { tok += c; has = true }
        continue
      }
      if (c === '"' || c === "'") { q = c; has = true; continue }
      if (c === '#' && !has && (i === 0 || /\s/.test(line[i - 1]!))) break
      if (/\s/.test(c)) { push(); continue }
      if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}') {
        end()
        continue
      }
      if (c === '>' || c === '<') { push(); continue }
      tok += c; has = true
    }
    end()
  }
  return out
}

/** 🔴 절대 경로 · `__REPO__` 자리표시 → repo 상대 경로(`scripts/…` · `src/…`). 아니면 null */
export function repoRelative(p: string): string | null {
  const m = /(?:^|\/)((?:scripts|src)\/[^\s'"]+)$/.exec(p)
  return m === null ? null : normalize(m[1]!)
}

const base = (p: string): string => p.split('/').pop() ?? p
const isScriptFile = (t: string): boolean => /\.(m?ts|m?js|tsx)$/.test(t)

export type Reach = {
  /** 누가 불렀나 — workflow:… · launchd:… · shell:… */
  invoker: string
  /** repo 상대 엔트리 */
  entry: string
  /** 감싼 consumer 의 --by 값. 없으면 null */
  wrappedBy: EntryKind | null
  /** 해석 경로(npm run 이름 등) */
  via: readonly string[]
  /** 엔트리 뒤 인자(consumer 는 자기 인자) */
  args: readonly string[]
}

/**
 * 🔴 **토큰 배열 하나 → 도달한 스크립트 엔트리들.**
 *    `npx tsx F` · `tsx F` · `node F` · `npm run[-s] X [-- args]`(package.json 해석) · consumer 감싸기(재귀).
 */
export function resolveCommand(
  argv: readonly string[],
  ctx: { invoker: string; scripts: Readonly<Record<string, string>>; wrappedBy: EntryKind | null; via: readonly string[]; depth?: number },
): Reach[] {
  const depth = ctx.depth ?? 0
  if (depth > 8 || argv.length === 0) return []
  const out: Reach[] = []
  let i = 0
  // env 대입 접두(`FOO=bar cmd`)는 건너뛴다 — 값에 옛 키가 있으면 ③ 이 따로 잡는다
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i]!)) i += 1
  const head = argv[i]
  if (head === undefined) return []
  const b = base(head)
  // npm run
  if ((b === 'npm' || head === '__NPM__') && (argv[i + 1] === 'run' || argv[i + 1] === 'run-script')) {
    let j = i + 2
    while (j < argv.length && argv[j]!.startsWith('-') && argv[j] !== '--') j += 1
    const name = argv[j]
    if (name === undefined) return []
    const rest = argv.slice(j + 1)
    const extra = rest[0] === '--' ? rest.slice(1) : rest
    const body = ctx.scripts[name]
    if (body === undefined) return []
    const cmds = shellCommands(body)
    cmds.forEach((cmd, idx) => {
      // npm 은 `-- args` 를 script 의 마지막 명령 뒤에 붙인다
      const tail = idx === cmds.length - 1 ? [...cmd, ...extra] : cmd
      out.push(...resolveCommand(tail, { ...ctx, via: [...ctx.via, `npm run ${name}`], depth: depth + 1 }))
    })
    return out
  }
  // npx tsx F · tsx F · node F
  let j = i
  if (b === 'npx' || head === '__NPX__') {
    j = i + 1
    while (j < argv.length && argv[j]!.startsWith('-')) j += 1
    if (argv[j] === undefined) return []
  }
  const runner = base(argv[j] ?? '')
  if (runner === 'tsx' || runner === 'node' || runner === 'ts-node') {
    let k = j + 1
    while (k < argv.length && !isScriptFile(argv[k]!)) {
      if (argv[k] === '-e' || argv[k] === '--eval') return [] // 인라인 코드 — 엔트리가 아니다
      k += 1
    }
    const file = argv[k]
    if (file === undefined) return []
    const rel = repoRelative(file)
    if (rel === null) return []
    const args = argv.slice(k + 1)
    if (rel === CONSUMER_SCRIPT) {
      const sep = args.indexOf('--')
      const own = sep < 0 ? args : args.slice(0, sep)
      const by = own.find((a) => a.startsWith('--by='))?.slice(5)
      const kind: EntryKind | null = by === 'publish' || by === 'supply' ? by : null
      out.push({ invoker: ctx.invoker, entry: rel, wrappedBy: ctx.wrappedBy, via: ctx.via, args: own })
      if (sep >= 0) {
        out.push(...resolveCommand(args.slice(sep + 1), { ...ctx, wrappedBy: kind, via: [...ctx.via, `consume --by=${by ?? '?'}`], depth: depth + 1 }))
      }
      return out
    }
    out.push({ invoker: ctx.invoker, entry: rel, wrappedBy: ctx.wrappedBy, via: ctx.via, args })
    return out
  }
  return out
}

// ─────────────────────────────────────────────────────────
// workflow · launchd 파싱
// ─────────────────────────────────────────────────────────

type YamlLoad = (s: string) => unknown
const loadYaml: YamlLoad = ((): YamlLoad => {
  const req = createRequire(import.meta.url)
  const mod = req('js-yaml') as { load: YamlLoad }
  return (s: string) => mod.load(s)
})()

export type ParsedWorkflow = {
  file: string
  ok: boolean
  error: string | null
  /** 🔴 `on.schedule` 이 비어 있지 않은가 */
  scheduled: boolean
  cronCount: number
  triggers: readonly string[]
  /** step 마다 run 원문 */
  runs: readonly { job: string; step: string; run: string }[]
  /** 주석을 뺀 값 전체(JSON) — 옛 키 검사용 */
  valueText: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseWorkflow(file: string, text: string): ParsedWorkflow {
  let doc: unknown
  try { doc = loadYaml(text) } catch (e) {
    return { file, ok: false, error: `YAML 파싱 실패 — ${(e as Error).message.split('\n')[0]}`, scheduled: false, cronCount: 0, triggers: [], runs: [], valueText: '' }
  }
  if (!isObj(doc)) return { file, ok: false, error: 'YAML 최상위가 객체가 아니다', scheduled: false, cronCount: 0, triggers: [], runs: [], valueText: '' }
  const on = doc.on ?? doc.true
  const triggers: string[] = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : isObj(on) ? Object.keys(on) : []
  const sched = isObj(on) ? on.schedule : undefined
  const cronCount = Array.isArray(sched) ? sched.filter((x) => isObj(x) && typeof x.cron === 'string').length : 0
  const runs: { job: string; step: string; run: string }[] = []
  const jobs = isObj(doc.jobs) ? doc.jobs : {}
  for (const [jn, job] of Object.entries(jobs)) {
    if (!isObj(job) || !Array.isArray(job.steps)) continue
    job.steps.forEach((st, idx) => {
      if (isObj(st) && typeof st.run === 'string') runs.push({ job: jn, step: typeof st.name === 'string' ? st.name : `#${idx}`, run: st.run })
    })
  }
  return {
    file, ok: true, error: null,
    scheduled: cronCount > 0 || (Array.isArray(sched) && sched.length > 0),
    cronCount, triggers, runs, valueText: JSON.stringify(doc),
  }
}

export type ParsedLaunchd = {
  source: string
  label: string | null
  argv: readonly string[]
  scheduled: boolean
  /** EnvironmentVariables 키=값 · ProgramArguments 를 이어 붙인 텍스트(옛 키 검사용 · 주석 제외) */
  valueText: string
}

export function parseLaunchd(source: string, xml: string): ParsedLaunchd {
  const noComments = xml.replace(/<!--[\s\S]*?-->/g, '')
  const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(noComments)?.[1] ?? null
  const argsBlock = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(noComments)?.[1] ?? ''
  const argv = [...argsBlock.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!)
  const scheduled = /<key>(StartCalendarInterval|StartInterval)<\/key>/.test(noComments)
  const envBlock = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(noComments)?.[1] ?? ''
  return { source, label, argv, scheduled, valueText: `${argv.join(' ')}\n${envBlock}` }
}

/** 🔴 launchd argv → 명령 목록. `/bin/sh -c "<script>"` 이면 셸로 다시 나눈다 */
function launchdCommands(argv: readonly string[]): string[][] {
  const sh = base(argv[0] ?? '')
  if ((sh === 'sh' || sh === 'bash' || sh === 'zsh') && argv[1] === '-c' && argv[2] !== undefined) return shellCommands(argv[2])
  return [argv.slice()]
}

// ─────────────────────────────────────────────────────────
// TypeScript import 그래프 · 주석 제거
// ─────────────────────────────────────────────────────────

/**
 * 🔴 주석만 지운다 — 문자열 · 템플릿 · 정규식 리터럴 안의 `//` · 따옴표는 남긴다.
 *    정규식은 "식이 올 자리"(앞 글자가 `( , = : [ ! & | ? { } ; + - * % < > ~ ^` 이거나 줄 처음 · `return`)의 `/` 로 본다.
 */
export function stripTsComments(src: string): string {
  let out = ''
  let i = 0
  let q: string | null = null
  const exprStart = (): boolean => {
    let k = out.length - 1
    while (k >= 0 && /\s/.test(out[k]!)) k -= 1
    if (k < 0) return true
    const ch = out[k]!
    if ('(,=:[!&|?{};+-*%<>~^'.includes(ch)) return true
    return /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(out.slice(Math.max(0, k - 7), k + 1))
  }
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (q !== null) {
      out += c
      if (c === '\\') { out += n ?? ''; i += 2; continue }
      if (c === q || (q !== '`' && c === '\n')) q = null
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i += 1; continue }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue }
    if (c === '/' && exprStart()) {
      // 정규식 리터럴 — 클래스([...]) 안의 `/` 는 끝이 아니다
      let j = i + 1
      let cls = false
      while (j < src.length && src[j] !== '\n') {
        const d = src[j]!
        if (d === '\\') { j += 2; continue }
        if (d === '[') cls = true
        else if (d === ']') cls = false
        else if (d === '/' && !cls) break
        j += 1
      }
      if (src[j] === '/') { out += src.slice(i, j + 1); i = j + 1; continue }
    }
    out += c
    i += 1
  }
  return out
}

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

/** 상대 import → repo 상대 경로 (없으면 null). `.mjs`→`.mts` · `.js`→`.ts` 도 본다 */
export function resolveImport(fromFile: string, spec: string, has: (p: string) => boolean): string | null {
  let target: string
  if (spec.startsWith('.')) target = normalize(join(dirname(fromFile), spec))
  else if (spec.startsWith('@/')) target = normalize(join('src', spec.slice(2)))
  else return null
  const cands = [
    target,
    target.replace(/\.mjs$/, '.mts'), target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx'),
    `${target}.ts`, `${target}.mts`, `${target}.tsx`, join(target, 'index.ts'),
  ]
  return cands.find((c) => has(c)) ?? null
}

export function importsOf(file: string, sources: ReadonlyMap<string, string>): string[] {
  const src = sources.get(file)
  if (src === undefined) return []
  const out: string[] = []
  for (const m of stripTsComments(src).matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (spec === undefined) continue
    const r = resolveImport(file, spec, (p) => sources.has(p))
    if (r !== null) out.push(r)
  }
  return out
}

/** 🔴 file 에서 target 까지 import 로 닿는가(전이) */
export function reachesModule(file: string, target: string, sources: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>()
  const stack = [file]
  while (stack.length > 0) {
    const f = stack.pop()!
    if (f === target) return true
    if (seen.has(f)) continue
    seen.add(f)
    stack.push(...importsOf(f, sources))
  }
  return false
}

export const isCheckFile = (f: string): boolean => /(^|\/)[^/]*-check\.mts$/.test(f) || /(^|\/)[^/]*-check\.m?js$/.test(f)

/** 🔴 발행 트랜잭션을 **실제로 부르는** 호출 — import 만 하는 것(타입 · 도우미)은 발행자가 아니다 */
export const PUBLISH_WRITE_CALL_RE = /\bpublishOriginalPostTx\s*\(/

/** 발행 트랜잭션을 부르는 모듈(정의 파일 · 검사 파일 제외) */
export function publishCallersOf(sources: ReadonlyMap<string, string>): string[] {
  return [...sources.entries()]
    .filter(([f, src]) => f !== PUBLISH_TX_MODULE && !isCheckFile(f) && PUBLISH_WRITE_CALL_RE.test(stripTsComments(src)))
    .map(([f]) => f).sort()
}

/**
 * 🔴 **발행 엔트리 = top-level 스크립트(scripts/*.mts) 중 발행 트랜잭션 호출 모듈이거나 그 모듈에 import 로 닿는 것.**
 *    손 목록이 아니다 — 새 발행 스크립트를 만들면 자동으로 이 목록에 들어와 consumer 규칙을 받는다.
 */
export function publishEntriesOf(sources: ReadonlyMap<string, string>): string[] {
  const callers = publishCallersOf(sources)
  return [...sources.keys()]
    .filter((f) => /^scripts\/[^/]+\.mts$/.test(f) && !isCheckFile(f))
    .filter((f) => callers.some((c) => reachesModule(f, c, sources)))
    .sort()
}

// ─────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────

export type ViolationCode =
  | 'SCHEDULE_PUBLISH'      // ① GitHub 예약이 발행 엔트리에 닿는다
  | 'DUPLICATE_OWNER'       // ① 같은 엔트리의 자동 schedule owner 가 둘 이상
  | 'CONSUMER_BYPASS'       // ② 발행 · 공급 엔트리를 consumer 없이(또는 다른 --by 로) 부른다
  | 'LEGACY_ENV'            // ③ workflow · plist · package.json · 셸에 옛 단계 변수
  | 'DEAD_KEY_READ'         // ③ TypeScript 가 CANARY · WINDOW 키를 읽는다
  | 'STAGE_ENV_OUTSIDE'     // ④ 허용 밖 TypeScript 가 단계 칸 · 표식을 다룬다
  | 'FIXTURE_IN_RUNTIME'    // ⑤ 운영 엔트리가 검사 전용 표식 fixture 에 닿는다
  | 'PENDING_STALE'         // 허용 목록이 낡았다(이미 고쳐진 파일이 남아 있다)
  | 'PARSE_ERROR'

export type Violation = { code: ViolationCode; where: string; detail: string }

export type AuthorityVerdict = {
  ok: boolean
  violations: Violation[]
  /** 🔴 다른 레인 소유 · 보고 대상 — 실패로 세지 않지만 숨기지 않는다 */
  pending: { file: string; detail: string }[]
  reaches: Reach[]
  /** 엔트리 → 자동 schedule owner 목록 */
  owners: Record<string, string[]>
  publishEntries: string[]
  workflows: { file: string; scheduled: boolean; cronCount: number; triggers: readonly string[] }[]
}

export function entryKindOf(entry: string, publishEntries: readonly string[]): EntryKind | null {
  if (publishEntries.includes(entry)) return 'publish'
  if (SUPPLY_CONSUMER_ENTRIES.includes(entry)) return 'supply'
  return null
}

function legacyHits(text: string): string[] {
  return [...new Set([...text.matchAll(LEGACY_ENV_RE)].map((m) => m[0]))]
}

export function judgeAuthority(inp: AuthorityInputs): AuthorityVerdict {
  const violations: Violation[] = []
  const reaches: Reach[] = []
  /** 엔트리 → (owner → 정규화한 인자) */
  const owners: Record<string, Map<string, string>> = {}
  const addOwner = (r: Reach, who: string): void => { (owners[r.entry] ??= new Map()).set(who, r.args.join(' ')) }
  const publishEntries = publishEntriesOf(inp.sources)
  const workflows: AuthorityVerdict['workflows'] = []

  // ── workflows ──
  for (const w of inp.workflows) {
    const p = parseWorkflow(w.file, w.text)
    if (!p.ok) { violations.push({ code: 'PARSE_ERROR', where: w.file, detail: p.error ?? '' }); continue }
    workflows.push({ file: w.file, scheduled: p.scheduled, cronCount: p.cronCount, triggers: p.triggers })
    for (const k of legacyHits(p.valueText)) {
      violations.push({ code: 'LEGACY_ENV', where: w.file, detail: `옛 단계 변수 ${k} 를 넘긴다(env · vars · run 값)` })
    }
    for (const r of p.runs) {
      for (const cmd of shellCommands(r.run)) {
        const got = resolveCommand(cmd, { invoker: `workflow:${w.file}#${r.job}/${r.step}`, scripts: inp.packageScripts, wrappedBy: null, via: [] })
        reaches.push(...got)
        if (p.scheduled) for (const g of got) addOwner(g, `workflow:${w.file}#${r.job}/${r.step}`)
        if (p.scheduled && got.some((g) => publishEntries.includes(g.entry))) {
          violations.push({ code: 'SCHEDULE_PUBLISH', where: `${w.file}#${r.job}/${r.step}`, detail: `on.schedule(${p.cronCount}) 이 발행 엔트리에 닿는다 — 발행 schedule owner 는 host launchd 하나다` })
        }
      }
    }
  }

  // ── launchd ──
  for (const l of inp.launchd) {
    const p = parseLaunchd(l.source, l.xml)
    for (const k of legacyHits(p.valueText)) {
      violations.push({ code: 'LEGACY_ENV', where: l.source, detail: `plist 에 옛 단계 변수 ${k}` })
    }
    const who = `launchd:${p.label ?? l.source}`
    for (const cmd of launchdCommands(p.argv)) {
      const got = resolveCommand(cmd, { invoker: who, scripts: inp.packageScripts, wrappedBy: null, via: [] })
      reaches.push(...got)
      if (p.scheduled) for (const g of got) addOwner(g, who)
    }
  }

  // ── package.json · 셸 — 값에 옛 키 ──
  for (const [name, body] of Object.entries(inp.packageScripts)) {
    for (const k of legacyHits(body)) violations.push({ code: 'LEGACY_ENV', where: `package.json#${name}`, detail: `script 가 옛 단계 변수 ${k} 를 적는다` })
  }
  for (const s of inp.shells) {
    const text = s.text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    for (const k of legacyHits(text)) violations.push({ code: 'LEGACY_ENV', where: s.file, detail: `운영 셸이 옛 단계 변수 ${k} 를 적는다` })
    for (const cmd of shellCommands(s.text)) {
      reaches.push(...resolveCommand(cmd, { invoker: `shell:${s.file}`, scripts: inp.packageScripts, wrappedBy: null, via: [] }))
    }
  }

  // ── ② consumer 우회 ──
  for (const r of reaches) {
    const kind = entryKindOf(r.entry, publishEntries)
    if (kind === null) continue
    if (r.wrappedBy !== kind) {
      violations.push({
        code: 'CONSUMER_BYPASS', where: r.invoker,
        detail: `${r.entry}(${kind}) 를 ${r.wrappedBy === null ? 'consumer 없이' : `--by=${r.wrappedBy} 로`} 부른다${r.via.length > 0 ? ` · 경로 ${r.via.join(' → ')}` : ''}`,
      })
    }
  }

  // ── ① 같은 작업의 schedule owner 둘 이상 ──
  //    · 플랫폼이 둘(workflow cron + launchd)이면 같은 엔트리는 **인자가 달라도** 같은 작업이다(회차 상한만 다르다)
  //    · launchd 안에서는 **인자까지 같은** 두 label 이 중복이다(카페가 다른 두 수집 job 은 다른 작업이다)
  const ownersOut: Record<string, string[]> = {}
  for (const [entry, set] of Object.entries(owners)) {
    ownersOut[entry] = [...set.keys()].sort()
    if (entry === CONSUMER_SCRIPT) continue // 문 자체는 여러 job 이 지난다 — 감싼 엔트리로 센다
    const list = [...set.entries()]
    const platforms = new Set(list.map(([who]) => who.split(':')[0]))
    const byArgs = new Map<string, string[]>()
    // 🔴 같은 인자 중복은 launchd 안에서만 센다 — CI 가 한 검사를 두 step 에서 부르는 것은 운영 owner 가 아니다
    for (const [who, args] of list) if (who.startsWith('launchd:')) byArgs.set(args, [...(byArgs.get(args) ?? []), who])
    const sameArgs = [...byArgs.values()].filter((w) => w.length > 1)
    if (platforms.size > 1) {
      violations.push({ code: 'DUPLICATE_OWNER', where: entry, detail: `workflow cron 과 launchd 가 같은 작업을 예약한다 — ${ownersOut[entry]!.join(' · ')}` })
    } else if (sameArgs.length > 0) {
      violations.push({ code: 'DUPLICATE_OWNER', where: entry, detail: `같은 인자로 예약한 job 이 둘 이상이다 — ${sameArgs.map((w) => w.join(' · ')).join(' / ')}` })
    }
  }

  // ── ③ ④ ⑤ TypeScript ──
  const pending: { file: string; detail: string }[] = []
  const pendingHit = new Set<string>()
  for (const [file, src] of inp.sources) {
    if (isCheckFile(file)) continue
    const code = stripTsComments(src)
    if (file !== 'scripts/lib/stage-authority-graph.ts') {
      const dead = [...new Set([...code.matchAll(DEAD_KEY_RE)].map((m) => m[0]))]
      for (const k of dead) violations.push({ code: 'DEAD_KEY_READ', where: file, detail: `지운 권위의 키 ${k} 를 코드가 다룬다` })
    }
    if (!STAGE_ENV_ALLOWED.includes(file)) {
      const hits = [...new Set([...code.matchAll(STAGE_ENV_TOKEN_RE)].map((m) => m[0]))]
      if (hits.length > 0) {
        if (file in PENDING_OTHER_LANE) { pendingHit.add(file); pending.push({ file, detail: `${PENDING_OTHER_LANE[file]} · ${hits.join(',')}` }) }
        else violations.push({ code: 'STAGE_ENV_OUTSIDE', where: file, detail: `허용 밖에서 단계 칸 · 표식을 다룬다 — ${hits.join(', ')}` })
      }
    }
  }
  for (const f of Object.keys(PENDING_OTHER_LANE)) {
    if (!pendingHit.has(f)) violations.push({ code: 'PENDING_STALE', where: f, detail: '이미 고쳐졌다 — PENDING_OTHER_LANE 에서 지운다(낡은 허용 목록 금지)' })
  }
  for (const f of inp.sources.keys()) {
    if (!/^scripts\/[^/]+\.mts$/.test(f) || isCheckFile(f)) continue
    if (reachesModule(f, FIXTURE_MODULE, inp.sources)) {
      violations.push({ code: 'FIXTURE_IN_RUNTIME', where: f, detail: `검사 전용 ${FIXTURE_MODULE} 에 닿는다 — 표식을 손으로 만드는 길이 운영 경로에 생긴다` })
    }
  }

  return { ok: violations.length === 0, violations, pending, reaches, owners: ownersOut, publishEntries, workflows }
}

// ─────────────────────────────────────────────────────────
// 실제 저장소 읽기
// ─────────────────────────────────────────────────────────

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.git')) continue
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, keep, out)
    else if (keep(p)) out.push(p)
  }
  return out
}

export type RenderedLaunchd = { source: string; xml: string }

/**
 * 🔴 **실제 저장소를 읽는다.** TS 렌더러가 내는 plist 는 부르는 쪽이 넘긴다
 *    (이 모듈이 렌더러를 import 하면 렌더러 → 가드 순환이 생긴다).
 */
export function readAuthorityInputs(root: string, rendered: readonly RenderedLaunchd[]): AuthorityInputs {
  const rel = (p: string): string => relative(root, p)
  const wfDir = join(root, '.github', 'workflows')
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => ({ file: f, text: readFileSync(join(wfDir, f), 'utf-8') }))
    : []
  const templates = walk(join(root, 'docs', 'operations', 'launchd'), (p) => p.endsWith('.template'))
    .sort().map((p) => ({ source: rel(p), xml: readFileSync(p, 'utf-8') }))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> }
  const shells = [...walk(join(root, 'scripts'), (p) => p.endsWith('.sh')), ...walk(join(root, 'docs', 'operations'), (p) => p.endsWith('.sh'))]
    .sort().map((p) => ({ file: rel(p), text: readFileSync(p, 'utf-8') }))
  const sources = new Map<string, string>()
  for (const d of ['src', 'scripts']) {
    for (const p of walk(join(root, d), (f) => /\.(ts|mts|tsx)$/.test(f) && !f.endsWith('.d.ts'))) sources.set(rel(p), readFileSync(p, 'utf-8'))
  }
  return { workflows, launchd: [...templates, ...rendered], packageScripts: pkg.scripts ?? {}, shells, sources }
}

/** 사람이 읽는 한 줄 */
export function describeReach(r: Reach): string {
  return `${r.invoker} → ${r.entry}${r.wrappedBy === null ? '' : ` [consume --by=${r.wrappedBy}]`}${r.via.length > 0 ? ` (${r.via.join(' → ')})` : ''}`
}
