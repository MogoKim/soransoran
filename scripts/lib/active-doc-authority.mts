/**
 * 🔴 **활성 지침 · 실행 설명 문서의 authority 검사** (2026-09-30 · D100 canon "one loop" · Lane D ·
 *    2026-10-11 P0-0 권위 세 문서 재정렬)
 *
 *    `master-operating-doc-check` 는 권위 세 문서 + README + MASTER 를 본다. 에이전트가 **먼저 읽는** AGENTS.md ·
 *    CLAUDE.md 와 launchd · 상시 호스트 실행 설명이 옛 authority 를 다시 말하면, 권위 문서가 옳아도 에이전트는 낡은
 *    쪽을 먼저 읽는다. 그래서 같은 금지를 그 문서들에도 건다. 역사 표시(📜 절 · 📜/~~/`옛 경로` 줄)는 금지 대상에서 뺀다.
 *
 *    🔴 문단 단위로 본다 — 한 문장이 줄바꿈으로 나뉘어도 잡는다.
 *    🔴 부정문("~하지 않는다")은 걸리지 않게 긍정 서술형만 잡는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

export const GUIDE_DOCS = ['AGENTS.md', 'CLAUDE.md'] as const
export const EXEC_DOCS = ['docs/operations/launchd/README.md', 'docs/operations/ALWAYS-ON-HOST.md'] as const
const AUTHORITY_DOCS = [
  'docs/operations/NORTH-STAR.md', 'docs/operations/2026-09-21-d100-goal-canon.md',
  'docs/operations/CURRENT-MILESTONE.md', 'docs/operations/MASTER-OPERATING-SYSTEM.md', 'docs/operations/README.md',
] as const

/**
 * 🔴 **권위 트리 — 공통 정책·현재 상태를 말하는 문서는 이 셋뿐이다** (2026-10-11 P0-0).
 *    MASTER 는 필요할 때만 여는 기술 지도·역사(`REFERENCE`)다. README · inventory · AGENTS · CLAUDE 가 같은 셋을
 *    같은 순서로 말해야 한다 — 하나라도 다르면 에이전트마다 다른 권위를 읽는다.
 */
export const AUTHORITY_TREE = ['NORTH-STAR.md', '2026-09-21-d100-goal-canon.md', 'CURRENT-MILESTONE.md'] as const

/** 🔴 역사 표시를 뺀 "지금 이렇다" 는 주장만 — `master-operating-doc-check` 와 같은 규칙 */
export function liveTextOf(body: string): string {
  const out: string[] = []
  let historyLevel: number | null = null
  let fence = false
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence
    const h = fence ? null : /^(#{1,6})\s/.exec(line)
    if (h !== null) {
      const level = h[1]!.length
      if (historyLevel !== null && level <= historyLevel) historyLevel = null
      if (historyLevel === null && line.includes('📜')) { historyLevel = level; continue }
    }
    if (historyLevel !== null) continue
    if (line.includes('📜') || line.includes('~~') || line.includes('옛 경로')) continue
    out.push(line)
  }
  return out.join('\n')
}

/** 문단(빈 줄 경계)을 한 줄로 */
export const paragraphsOf = (live: string): string[] =>
  live.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter((p) => p !== '')

/**
 * 🔴 **에이전트가 실제로 읽는 지침 본문** — `CLAUDE.md` 의 `@AGENTS.md` 같은 한 줄 import 를 펼친다.
 *    Claude Code 는 그 줄을 import 로 읽는다. 펼치지 않으면 "복제하지 않은 지침" 이 검사에서 비어 보인다.
 *    import 는 한 단계만 펼친다(순환·깊은 사슬 금지). 대상이 없으면 그 줄을 그대로 둔다 — 검사가 빈칸으로 실패한다.
 */
export function guideTextOf(file: string): string {
  const body = readFileSync(file, 'utf8')
  return body.split('\n').map((line) => {
    const m = /^@(\S+\.md)\s*$/.exec(line)
    if (m === null) return line
    const target = normalize(join(dirname(file), m[1]!))
    return existsSync(target) ? readFileSync(target, 'utf8') : line
  }).join('\n')
}

/** 🔴 지침의 번호 목록(`1. [`docs/operations/X.md`]…`)에서 권위 트리 순서를 읽는다 */
export function guideAuthorityOrder(text: string): string[] {
  return [...text.matchAll(/^\d+\.\s*\[`docs\/operations\/([^`]+\.md)`\]/gm)].map((m) => m[1]!)
}

/**
 * 🔴 **상대 링크 무결성** — `](./x.md)` · `](docs/…)` · `](../…)` 가 실제 파일을 가리키는가.
 *    URL · 앵커만 있는 링크는 보지 않는다. 링크 뒤 `#앵커` 는 떼고 파일만 본다.
 */
export function brokenLinksOf(file: string): string[] {
  const body = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const raw = m[1]!
    if (/^(https?:|mailto:|#)/.test(raw)) continue
    const path = raw.split('#')[0]!
    if (path === '') continue
    if (!existsSync(normalize(join(dirname(file), path)))) out.push(raw)
  }
  return out
}

export type AuthorityRule = { label: string; re: RegExp; files: readonly string[] }

export const AUTHORITY_RULES: readonly AuthorityRule[] = [
  {
    label: '완성 글 700·2일치·14일치 재고를 성공·실행 기준으로 쓰지 않는다',
    files: [...GUIDE_DOCS, ...EXEC_DOCS],
    re: /(700|이틀|2일|14일)\s*(치|편|건)?[^|]{0,20}(완성 글|재고|stock|inventory)|(재고|stock)[^|]{0,15}(700|2일치|14일치)/,
  },
  {
    label: 'GitHub stage Variables · 예약 cron · canary 창을 단계 authority 로 쓰지 않는다',
    files: [...GUIDE_DOCS, ...EXEC_DOCS, ...AUTHORITY_DOCS],
    re: /vars\.SORAN_(RELEASE|CAPACITY)_STAGE|(GitHub|GHA)[^|]{0,20}(Variables?|vars|변수)[^|]{0,30}(단계|stage)[^|]{0,15}(정한다|정본이다|올린다|바꾼다|결정한다)|(canary|카나리)\s*(창|window)[^|]{0,20}(단계|stage)[^|]{0,6}(정한다|연다|올린다)|SORAN_(RELEASE|CAPACITY)_STAGE[^|]{0,25}(단계|stage)[^|]{0,6}(정한다|올린다|결정한다)/,
  },
  {
    label: '🔴 "Persona 0명이라 D3→D5 가 막힌다" 는 틀렸다 — preflight 는 다음 단계 하한을 본다(D1→D3 부터)',
    files: [...GUIDE_DOCS, ...EXEC_DOCS, ...AUTHORITY_DOCS],
    re: /(Persona|페르소나)[^|]{0,60}D3\s*(→|->|에서)\s*D5[^|]{0,30}(막|차단|못 올|승급[이을]? 멈)|D3\s*(→|->|에서)\s*D5[^|]{0,20}(승급|승격)[^|]{0,30}(Persona|페르소나)[^|]{0,30}(막|차단)/,
  },
  {
    label: '목표 수치는 D100 canon 이 정본이다 — CURRENT-MILESTONE 하나에만 있다고 쓰지 않는다',
    files: [...GUIDE_DOCS],
    re: /목표 수치[^|]{0,120}CURRENT-MILESTONE[^|]{0,60}(하나에만|에만)/,
  },
  /**
   * 🔴 2026-10-11 P0-0 — 지침은 라우터다. 운영 SHA · 오늘의 단계 · 배포 상태를 복제하면 낡는다.
   *    역사 커밋 인용(브랜드 팔레트의 첫 커밋 같은)은 runtime·main·pin·manifest·HEAD 문맥이 아니라 걸리지 않는다.
   */
  {
    label: '지침이 운영 SHA · 현재 단계 · 배포 상태를 복제하지 않는다 (CURRENT 가 적는다)',
    files: [...GUIDE_DOCS],
    re: /(runtime|main|pin|manifest|HEAD)[^|]{0,30}`?[0-9a-f]{7,40}`?|(공개|release)\s*d\d+[^|]{0,12}(준비|capacity)\s*d\d+|오늘[^|]{0,10}(단계|stage)[^|]{0,6}d\d+|(main|runtime)[^|]{0,30}배포됐다/,
  },
  {
    label: '지침이 평상시 매일 정확한 Dn 편수를 현재 계약으로 주장하지 않는다 (canon §1.1)',
    files: [...GUIDE_DOCS],
    re: /(평상시|매일|하루마다)[^|]{0,25}정확히\s*(N|n|Dn|\d+)\s*편?[^|]{0,15}(공개한다|발행한다|채운다|낸다|강제한다)(?![^|]{0,6}(않|아니))/,
  },
  {
    label: '지침이 MASTER 를 현재 권위 · 기본 필독으로 올리지 않는다',
    files: [...GUIDE_DOCS],
    re: /MASTER-OPERATING-SYSTEM\.md[^|]{0,80}(권위 문서다|정본이다|반드시 읽는다|기본 필독이다|현재 정책을 정한다)/,
  },
]

const read = (f: string): string => readFileSync(f, 'utf8')

/** 🔴 새 authority 의 뼈대 — 빠지면 실패한다 */
export function authorityRequired(): ReadonlyArray<readonly [string, boolean]> {
  const out: Array<readonly [string, boolean]> = []
  for (const f of GUIDE_DOCS) {
    const t = guideTextOf(f)
    out.push([`${f} 가 권위 인덱스 docs/operations/README.md 를 가리킨다`,
      t.includes('(docs/operations/README.md)') && t.includes('권위 인덱스')])
    out.push([`${f} 가 권위 세 문서를 모두 싣는다`, AUTHORITY_TREE.every((a) => t.includes(`docs/operations/${a}`))])
    out.push([`${f} 의 권위 번호 목록이 README 권위 트리와 같다`,
      JSON.stringify(guideAuthorityOrder(t)) === JSON.stringify(AUTHORITY_TREE)])
    out.push([`${f} 가 MASTER 를 필요할 때만 여는 비권위 문서로 적는다`,
      /MASTER-OPERATING-SYSTEM\.md[^\n]{0,120}필요할 때만[^\n]{0,80}(기본 필독이 아니|권위가 아니)/.test(t)])
    out.push([`${f} 가 목표 수치의 정본을 D100 canon 으로 적는다`,
      /목표 수치[^\n]{0,60}2026-09-21-d100-goal-canon\.md/.test(t)])
    out.push([`${f} 가 StageDecision 단일 단계 authority 를 적는다`, /`StageDecision` 행 하나/.test(t)])
    out.push([`${f} 가 자동 일정 owner(launchd) 하나를 적는다`, /자동 일정 owner[^\n]{0,30}launchd[^\n]{0,10}하나/.test(t)])
    out.push([`${f} 가 저장소 밖 handoff · memory 를 정본이 아니라고 적는다`,
      /handoff[^\n]{0,60}memory[^\n]{0,20}정본이 아니다/.test(t)])
    out.push([`${f} 가 소란소란 repo identity 사전 확인을 요구한다`,
      t.includes('git rev-parse --show-toplevel')
      && t.includes("require('./package.json').name")
      && t.includes('unao-main')
      && t.includes('D100-DOCUMENT-INVENTORY.md')])
    out.push([`${f} 의 상대 링크가 모두 실제 파일을 가리킨다`, brokenLinksOf(f).length === 0])
  }
  out.push(['CLAUDE.md 가 공통 지침을 복제하지 않고 `@AGENTS.md` 로 가져온다',
    /^@AGENTS\.md\s*$/m.test(read('CLAUDE.md'))
    && !read('CLAUDE.md').includes('## 0. 역할')])
  const launchd = read('docs/operations/launchd/README.md')
  out.push(['launchd README 가 자동 일정 owner 는 launchd 하나라고 적는다',
    launchd.includes('자동 일정 owner 는 launchd 하나')
    && launchd.includes('main과 보조 Mac runtime에 배포됐다')
    && launchd.includes('direct supply:health')])
  const current = read('docs/operations/CURRENT-MILESTONE.md')
  out.push(['CURRENT-MILESTONE 이 최신 D5 증거 판정 · Persona contract-valid · D10 blocker 코드를 분리해 적는다',
    /d3 증거[^\n]*FAIL|자동 D5[^\n]*preflight 3개 코드로 BLOCK/.test(current)
    && /contract-valid \d+/.test(current)
    && /OPPORTUNITY_SHORT/.test(current)
    && /THROUGHPUT_(SHORT|UNKNOWN)/.test(current)
    && /SUPPLY_COST_(SHORT|UNKNOWN)/.test(current)])
  return out
}

/** 🔴 금지 위반 — 파일별 문단. 지침은 import 를 펼친 본문으로 본다 */
export function authorityViolations(): { file: string; label: string; hits: string[] }[] {
  const out: { file: string; label: string; hits: string[] }[] = []
  for (const rule of AUTHORITY_RULES) {
    for (const file of rule.files) {
      const body = (GUIDE_DOCS as readonly string[]).includes(file) ? guideTextOf(file) : read(file)
      const hits = paragraphsOf(liveTextOf(body)).filter((p) => rule.re.test(p))
      out.push({ file, label: rule.label, hits })
    }
  }
  return out
}
