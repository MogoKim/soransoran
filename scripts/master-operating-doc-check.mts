import { readFileSync } from 'node:fs'

const MASTER = 'docs/operations/MASTER-OPERATING-SYSTEM.md'
const INDEX = 'docs/operations/README.md'

const master = readFileSync(MASTER, 'utf8')
const index = readFileSync(INDEX, 'utf8')

let passed = 0
let failed = 0

function check(label: string, condition: boolean): void {
  if (condition) {
    passed += 1
    console.log(`PASS ${label}`)
    return
  }
  failed += 1
  console.error(`FAIL ${label}`)
}

const requiredSections = [
  '## 1. 목적, 본질, 철학',
  '## 2. North Star와 지표 위계',
  '## 3. 전체 시스템 구조',
  '## 4. Lane별 계약과 실제 상태',
  '## 5. AI API와 모델 정본',
  '## 6. 현재 main, 설정, DB',
  '## 7. 마일스톤과 진행률',
  '## 8. Scale: 현재 능력과 목표',
  '## 9. 댓글 규모와 ratio 계약',
  '## 10. 82cook 사건과 수집 원칙',
  '## 11. 문서 감사 결과',
  '## 12. 다음 실행 계획',
  '## 13. 전략 변경 프로토콜',
]

for (const heading of requiredSections) {
  check(`Master 필수 절: ${heading}`, master.includes(heading))
}

check('운영 문서 index가 Master를 첫 진입점으로 지정한다', index.includes('[Master Operating System](./MASTER-OPERATING-SYSTEM.md)'))
check('North Star가 재방문+글/댓글+고유 실사용자를 모두 요구한다',
  /최근 7일 안에 재방문했고 글 또는 댓글을 한 번 이상 남긴 고유 실사용자 수/.test(master))
check('Persona를 North Star에서 제외한다', master.includes('Persona, 봇, 운영 계정은 제외한다'))
check('설계/main/설정/가동/관찰을 분리한다',
  ['설계', 'main 구현', '설정', '가동', '관찰'].every((term) => master.includes(term)))
check('Persona-first가 현재 미구현임을 명시한다',
  /Persona-first Generation[^\n]*\|[^\n]*미구현/.test(master))
check('RawContent 혼재 상태를 명시한다', master.includes('생성 후보 envelope도 이 테이블에 저장한다') || master.includes('생성·큐레이션 후보를 Queue에 연결하기 위한 envelope'))
check('82cook 10슬롯을 현재 READY로 표시하지 않는다', master.includes('82cook 10슬롯 활성화 보류'))
check('100/day와 공개 Persona 레인을 분리한다', master.includes('100/day는 Shadow 또는 별도 SEO Lane이며 Persona 공개 100/day가 아님'))

const judgeCode = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf8')
const draftCode = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf8')
const voiceContract = readFileSync('scripts/lib/voice-m3-contract.mts', 'utf8')

const judgeModel = judgeCode.match(/JUDGE_MODEL[^=]*=\s*'([^']+)'/)?.[1]
const draftModel = draftCode.match(/DRAFT_MODEL[^=]*=\s*'([^']+)'/)?.[1]
const analysisModel = voiceContract.match(/M3_ANALYSIS_MODEL\s*=\s*'([^']+)'/)?.[1]

check('judge 기본 모델을 코드에서 읽을 수 있다', typeof judgeModel === 'string')
check('draft 기본 모델을 코드에서 읽을 수 있다', typeof draftModel === 'string')
check('Voice 분석 모델을 코드에서 읽을 수 있다', typeof analysisModel === 'string')
check('Master의 Haiku 역할이 현재 코드와 일치한다',
  judgeModel === 'claude-haiku-4.5' && draftModel === judgeModel && analysisModel === judgeModel &&
  master.includes('`claude-haiku-4.5` | Voice M3 분석, 자동 judge, 자동 draft/review'))
check('분석 모델과 생성 모델 결정을 구분한다', master.includes('분석 모델 선정은 `생성 모델` 선정을 의미하지 않는다'))

const workflow = readFileSync('.github/workflows/auto-publish.yml', 'utf8')
check('현재 workflow는 d1 단일 cron이다', /- cron: '5 15 \* \* \*'/.test(workflow))
check('현재 scheduled publish는 회차당 1건이다', workflow.includes('original-post-auto-publish.mts --apply --limit=1'))
check('Master가 workflow 1슬롯과 limit 1을 현재 상태로 기록한다',
  master.includes('1슬롯/day, `--limit=1`'))

const historicalDocs = [
  'docs/operations/2026-08-26-soransoran-milestones.md',
  'docs/operations/2026-08-29-persona-network-strategy.md',
  'docs/operations/2026-08-30-persona-architecture-design.md',
  'docs/operations/2026-08-30-persona-safety-originality-gate-design.md',
  'docs/operations/2026-08-30-persona-mvp-activation-design.md',
  'docs/operations/2026-08-31-persona-db-model-design.md',
  'docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md',
  'docs/operations/2026-09-03-raw-supply-chain-design.md',
  'docs/operations/2026-09-02-original-post-lane-strategy.md',
  'docs/operations/2026-09-03-controlled-activity-automation-strategy.md',
]

for (const file of historicalDocs) {
  const body = readFileSync(file, 'utf8').slice(0, 1_200)
  check(`${file}가 현재 Master를 안내한다`, body.includes('MASTER-OPERATING-SYSTEM.md'))
}

/**
 * 🔴 **문서 내부 정합성 — 변동 숫자를 두 곳에 적지 않는다** (2026-09-09 실제 사고).
 *
 *    Wave A 로 Persona 가 8 → 24 명이 됐는데 §4 Lane 표에는 `재고 14/14` · `8명 대상 가동` 이,
 *    §6.3 에는 `User / Account 12 / 3` · `Persona 8, 모두 active` 가 그대로 남아 있었다.
 *    같은 값을 여러 절에 복제해 둔 것이 원인이다 — 한 곳을 고치면 다른 곳이 낡는다.
 *
 * 🔴 **그래서 "지금 값이 얼마인가" 를 검사하지 않는다.**
 *    검사기에 24·101·13/14 를 박아 두면 그 검사기 자체가 또 하나의 복제본이 되고,
 *    내일 사람이 한 명 늘면 **문서가 옳은데 검사기가 FAIL** 한다. 그건 같은 실수의 반복이다.
 *
 *    검사하는 것은 **구조**다.
 *      ① 현재 상태 절(§4 Lane 표 · §6.1)이 변동 숫자를 복제하지 않고 §6.3 을 가리키는가
 *      ② §6.3 에 필요한 행이 있고 **숫자로 파싱되는가**
 *      ③ §6.3 이 스스로 모순되지 않는가 ("모두 active" 면 총계 == active 수)
 *      ④ Wave A 의 24·101 은 **역사 기록**으로만 존재하는가 (현재값으로 읽히지 않는가)
 */
const sectionOf = (from: string, to: string): string => {
  const a = master.indexOf(from)
  const b = master.indexOf(to, a + 1)
  if (a < 0) return ''
  return master.slice(a, b < 0 ? master.length : b)
}
/** §4 Lane 표 — 표 헤더부터 §4.0 앞까지 */
const laneTable = sectionOf('| Lane | 입력 | 저장/출력 | AI |', '### 4.0')
/** §6.1 main 반영분 표 */
const mainTable = sectionOf('### 6.1 main 반영분', '### 6.2')
/** §6.3 — 현재 운영 숫자의 유일한 정본 */
const snapshot = sectionOf('### 6.3 DB 스냅샷', '## 7.')
/** §7.x Wave A — 역사적 실행 기록 */
const waveA = sectionOf('### 7.x Scale Activation Wave A', '### 8.0')
/** 현재 d10 병목 목록 */
const bottleneck = sectionOf('현재 d10 병목은 다음 네 가지다.', '### 7.x')

/** 🔴 표 행에서 값을 실제로 읽는다 — "그 글자가 있나" 가 아니라 "무슨 값인가" 를 본다 */
const rowValue = (body: string, label: string): string => {
  const m = new RegExp(`\\|\\s*${label}\\s*\\|([^|\\n]*)\\|`).exec(body)
  return m === null ? '' : m[1]!.trim()
}

// ── ① 현재 상태 절은 변동 숫자를 복제하지 않는다 ──
/**
 * 🔴 **현재 상태 절**은 §4 Lane 표 · §6.1 · d10 병목 목록이다.
 *    여기에 `숫자/숫자` 재고나 `active N명` 을 다시 쓰면 §6.3 과 갈라진다.
 */
const currentSections: ReadonlyArray<readonly [string, string]> = [
  ['§4 Lane 표', laneTable],
  ['§6.1 main 반영분', mainTable],
  ['현재 d10 병목', bottleneck],
]
for (const [label, body] of currentSections) {
  check(`${label} 이 비어 있지 않다 (앵커가 살아 있다)`, body !== '')
  check(`${label} 이 재고 숫자를 복제하지 않는다`, body !== '' && !/재고[^|\n]{0,6}\d+\/\d+/.test(body))
  check(`${label} 이 active 인원을 복제하지 않는다`,
    body !== '' && !/active\s*\d+\s*명/.test(body) && !/\d+\s*명\s*(전원|대상)\s*(active|가동)/.test(body))
  check(`${label} 이 §6.3 을 가리킨다`, body !== '' && /§6\.3/.test(body))
}
check('§4 Lane 표에 변동 숫자 금지 규칙이 있다',
  master.includes('이 표에 변동하는 운영 숫자를 적지 않는다'))
check('§6.1 에도 같은 규칙이 있다',
  master.includes('이 표에도 변동하는 운영 숫자를 적지 않는다'))

// ── ② §6.3 에 필요한 행이 있고 숫자로 파싱된다 ──
check('§6.3 이 존재하고 "여기 한 곳에서만 관리한다" 를 밝힌다',
  snapshot !== '' && /변동하는 운영 숫자는 여기 한 곳에서만 관리한다/.test(snapshot))
const userRow = rowValue(snapshot, 'User / Account')
const personaRow = rowValue(snapshot, 'Persona')
const auditRow = rowValue(snapshot, 'PersonaAuditLog')
const stockRow = rowValue(snapshot, '현재 사용 가능 재고')
check('§6.3 User / Account 행이 숫자 두 개로 파싱된다', /^\d+\s*\/\s*\d+/.test(userRow))
check('§6.3 Persona 행이 총계 숫자로 파싱된다', /^\d+\b/.test(personaRow))
check('§6.3 Persona 행이 상태 분포를 적는다', /active/.test(personaRow))
check('§6.3 PersonaAuditLog 행이 숫자다', /^\d+$/.test(auditRow))
check('§6.3 재고 행이 `쓸 수 있는 수/목표` 로 파싱된다', /\d+\s*\/\s*\d+/.test(stockRow))

// ── ③ §6.3 이 스스로 모순되지 않는다 ──
/**
 * 🔴 "모두 active" 라고 적었으면 총계와 active 수가 같아야 한다.
 *    숫자를 박지 않고 **문장과 숫자가 서로 맞는지**만 본다.
 */
check('§6.3 Persona 행이 스스로 모순되지 않는다 ("모두 active" ↔ 총계·분포)', (() => {
  const total = /^(\d+)/.exec(personaRow)
  if (total === null) return false
  const n = Number(total[1])
  if (/모두 active/.test(personaRow)) {
    // draft 를 함께 적었다면 0 이어야 "모두" 가 참이다
    const draft = /draft\s*(\d+)/.exec(personaRow)
    return draft === null || Number(draft[1]) === 0
  }
  // "모두" 가 아니면 분포 합이 총계와 같아야 한다
  const parts = [...personaRow.matchAll(/(?:active|draft|paused|retired)\s*(\d+)/g)].map((m) => Number(m[1]))
  return parts.length > 0 && parts.reduce((a, b) => a + b, 0) === n
})())
check('§6.3 재고가 목표를 넘지 않는다', (() => {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(stockRow)
  return m !== null && Number(m[1]) <= Number(m[2])
})())

// ── ④ Wave A 의 숫자는 **역사 기록**으로만 존재한다 ──
check('Wave A 절이 존재한다', waveA !== '')
check('Wave A 절이 before/after 실행 기록임을 밝힌다',
  /이 회차가 바꾼 것/.test(waveA) && /before/.test(waveA) && /after/.test(waveA))
check('Wave A 절이 지금 값의 정본을 §6.3 으로 넘긴다',
  /지금 값의 정본은 §6\.3 하나뿐이다/.test(waveA))
check('Wave A 의 숫자는 그 절 안에만 있다 — 현재 상태 절로 새지 않았다',
  currentSections.every(([, body]) => !/24 \(active 24/.test(body) && !/AuditLog\s*\|\s*101/.test(body)))

// ── ⑤ 옛 현재값이 남아 있지 않다 ──
for (const stale of [
  '8명 대상 가동',
  '| User / Account | 12 / 3 |',
  '| Persona | 8, 모두 active |',
  '재고 14/14',
  '재고가 14/140이다',
]) {
  check(`옛 현재값이 남아 있지 않다 — ${stale}`, !master.includes(stale))
}

console.log(`\nMaster 운영 문서 검사: ${passed} pass, ${failed} fail`)
if (failed > 0) process.exit(1)
