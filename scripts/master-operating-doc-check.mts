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

console.log(`\nMaster 운영 문서 검사: ${passed} pass, ${failed} fail`)
if (failed > 0) process.exit(1)
