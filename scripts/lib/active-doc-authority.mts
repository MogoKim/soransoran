/**
 * 🔴 **활성 지침 · 실행 설명 문서의 authority 검사** (2026-09-30 · D100 canon "one loop" · Lane D)
 *
 *    `master-operating-doc-check` 는 권위 4문서 + README 를 본다. 에이전트가 **먼저 읽는** AGENTS.md · CLAUDE.md 와
 *    launchd · 상시 호스트 실행 설명이 옛 authority 를 다시 말하면, 권위 문서가 옳아도 에이전트는 낡은 쪽을 먼저 읽는다.
 *    그래서 같은 금지를 그 문서들에도 건다. 역사 표시(📜 절 · 📜/~~/`옛 경로` 줄)는 금지 대상에서 뺀다.
 *
 *    🔴 문단 단위로 본다 — 한 문장이 줄바꿈으로 나뉘어도 잡는다.
 *    🔴 부정문("~하지 않는다")은 걸리지 않게 긍정 서술형만 잡는다.
 */
import { readFileSync } from 'node:fs'

export const GUIDE_DOCS = ['AGENTS.md', 'CLAUDE.md'] as const
export const EXEC_DOCS = ['docs/operations/launchd/README.md', 'docs/operations/ALWAYS-ON-HOST.md'] as const
const AUTHORITY_DOCS = [
  'docs/operations/NORTH-STAR.md', 'docs/operations/2026-09-21-d100-goal-canon.md',
  'docs/operations/CURRENT-MILESTONE.md', 'docs/operations/MASTER-OPERATING-SYSTEM.md', 'docs/operations/README.md',
] as const

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
]

const read = (f: string): string => readFileSync(f, 'utf8')

/** 🔴 새 authority 의 뼈대 — 빠지면 실패한다 */
export function authorityRequired(): ReadonlyArray<readonly [string, boolean]> {
  const out: Array<readonly [string, boolean]> = []
  const AUTH = ['NORTH-STAR.md', '2026-09-21-d100-goal-canon.md', 'CURRENT-MILESTONE.md', 'MASTER-OPERATING-SYSTEM.md']
  for (const f of GUIDE_DOCS) {
    const t = read(f)
    out.push([`${f} 가 권위 인덱스 docs/operations/README.md 를 가리킨다`,
      t.includes('(docs/operations/README.md)') && t.includes('권위 인덱스')])
    out.push([`${f} 가 권위 4문서를 모두 싣는다`, AUTH.every((a) => t.includes(`docs/operations/${a}`))])
    out.push([`${f} 가 목표 수치의 정본을 D100 canon 으로 적는다`,
      /목표 수치[^\n]{0,60}2026-09-21-d100-goal-canon\.md/.test(t)])
    out.push([`${f} 가 StageDecision 단일 단계 authority 를 적는다`, /`StageDecision` 행 하나/.test(t)])
    out.push([`${f} 가 자동 일정 owner(launchd) 하나를 적는다`, /자동 일정 owner[^\n]{0,30}launchd[^\n]{0,10}하나/.test(t)])
    out.push([`${f} 가 그 목표 상태를 "구현 중 · 미배포" 로 정직하게 적는다`, /구현 중 · 미배포/.test(t)])
  }
  const launchd = read('docs/operations/launchd/README.md')
  out.push(['launchd README 가 자동 일정 owner 는 launchd 하나라고 적는다',
    launchd.includes('자동 일정 owner 는 launchd 하나') && launchd.includes('구현 중 · 미배포')])
  const current = read('docs/operations/CURRENT-MILESTONE.md')
  out.push(['CURRENT-MILESTONE 이 계약 유효 Persona 부족을 D1→D3 부터로 적는다', /D1→D3 부터/.test(current)])
  return out
}

/** 🔴 금지 위반 — 파일별 문단 */
export function authorityViolations(): { file: string; label: string; hits: string[] }[] {
  const out: { file: string; label: string; hits: string[] }[] = []
  for (const rule of AUTHORITY_RULES) {
    for (const file of rule.files) {
      const hits = paragraphsOf(liveTextOf(read(file))).filter((p) => rule.re.test(p))
      out.push({ file, label: rule.label, hits })
    }
  }
  return out
}
