import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APPROVED_DECISION } from '../src/lib/persona-canon-decision'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import {
  BOOTSTRAP_DAILY_MAX, countManagedPosts, judgeBootstrapBudget,
} from '../src/lib/persona-comment-bootstrap-budget'
import { PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-target-rules'
import {
  planRunnerSchedule, FIRST_COMMENT_MAX_MINUTES,
  RUNNER_WINDOW_START_HOUR, RUNNER_WINDOW_END_HOUR,
} from './lib/persona-comment-runner-template'
import { COMMENT_STAGES } from '../src/lib/persona-comment-stage'
import { PROFILES, RELEASE_STAGES, derive, minuteOfDay } from '../src/lib/scale-profile'

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
/**
 * 🔴 **Persona-first 가 "가동 중" 으로 읽히지 않게 한다.**
 *
 *    옛 판은 그 행에 `미구현` 이라는 글자가 있는지만 봤다. 그런데 2026-09-09 에
 *    입력 계약·분산 planner·속도 제어가 실제로 구현됐고, 그 행은 더 이상 "미구현" 이 아니다.
 *    글자 하나를 지키면 문서가 사실과 어긋나고, 사실을 적으면 가드가 깨진다 —
 *    그때 가드를 지우는 것이 아니라 **무엇을 지키려 했는지**로 다시 쓴다.
 *
 *    지켜야 하는 것은 "구현했다" 가 아니라 **공개 발행이 아직 꺼져 있다** 는 사실이다.
 */
check('Persona-first 레인이 공개 가동 중으로 읽히지 않는다',
  /Persona-first Generation[^\n]*\|[^\n]*(미구현|공개 미활성)/.test(master))
check('Persona 댓글 public 설정이 없음을 명시한다',
  /public 설정 \| 🔴 \*\*없음\*\*/.test(master))
/**
 * 🔴 **"코드가 됐다" 와 "공개가 돈다" 를 섞지 않게 한다.**
 *    상한이 0을 넘는 조건(실사용자 댓글·env)만 적어 두면, 그것만 채우면 자동 댓글이
 *    시작된다고 읽힌다. 실제로는 승인 Queue·transaction 재검사·runner 가 더 필요하다.
 */
check('자동 공개 runner·schedule 이 없음을 명시한다',
  /자동 공개 runner\/schedule \| 🔴 \*\*없음\*\*/.test(master))
check('실제 공개 가동이 0/day 임을 명시한다',
  /실제 공개 가동 \| 🔴 \*\*0\/day\*\*/.test(master))
check('env 와 댓글 3건만으로 시작되지 않음을 명시한다',
  master.includes('만으로 자동 댓글이 시작되지 않는다'))
check('공개 release 에 남은 항목을 표로 적는다',
  master.includes('공개 release 에 남은 것')
  && ['승인 Queue', 'transaction', 'runner'].every((t) => master.includes(t)))
/**
 * 🔴 **문자열이 있는가가 아니라 상태가 어긋나는가를 본다** (2026-09-10 정정).
 *
 *    옛 판은 `"provisional · winner 없음" 이라고 적혀 있는가` 를 통과 조건으로 삼았다.
 *    그런데 창업자가 모델을 확정한 날, 문서를 사실대로 고치면 검사가 깨지고
 *    검사를 지키면 문서가 거짓이 된다 — **검사가 거짓을 지키는 쪽**이 된다.
 *    실제로 그렇게 됐다: canon 은 confirmed 인데 문서는 provisional 이었고
 *    두 검사가 그 상태를 붙잡고 있었다.
 *
 *    그래서 기준을 **repo 안의 승인 결정**(`APPROVED_DECISION`) 으로 옮긴다.
 *    canon 정본 파일은 worktree 밖이라 CI 에서 읽히지 않는다 — 읽히지 않는 것을
 *    기준으로 삼으면 CI 에서는 아무것도 검사하지 못한다.
 */
check('문서가 승인된 winner 와 같은 모델을 적는다',
  master.includes(APPROVED_DECISION.winner))
check('문서가 승인된 확정 회차를 적는다',
  master.includes(APPROVED_DECISION.runId))
check('🔴 확정과 미확정을 동시에 주장하지 않는다',
  !master.includes('provisional · winner 없음')
  && !master.includes('모델 미확정으로 fail-closed')
  && !/모델 확정 경로[^\n]*아직 실행하지 않았다/.test(master))
/** 🔴 호출 수와 비용은 **실측**으로 적는다. 추정과 섞으면 "얼마 안 든다" 가 근거 없이 돈다 */
check('실제 API 호출 수와 실제 비용을 함께 적는다',
  /\*\*\d+회 · \$0\.\d+\*\*/.test(master))
/**
 * 🔴 **`statusPass` 를 "9관문 통과" 로 읽지 못하게 한다.**
 *    옛 집계가 `status === 'pass'` 만 보고 ⑧ 이 notRun 인 20건을 전부 통과로 셌다.
 */
check('모델 비교 표가 statusPass 와 fullGatePass 를 나눠 적는다',
  master.includes('| parse | statusPass | 🔴 fullGatePass | missingRequired | bootstrap review |'))
check('지금 표본의 fullGatePass 가 0 임을 정직하게 적는다',
  master.includes('fullGatePass 는 0/20'))
check('사람 채점 미완료와 winner null 을 적는다',
  master.includes('사람 채점 미완료 · winner null'))
/** 🔴 유료 결과가 dry-run 에 지워진 사고를 남겨 둔다 — 잊으면 같은 구조를 다시 만든다 */
check('평가 artifact 불변성 계약을 적는다',
  master.includes('유료 실행 결과를 dry-run 이 덮어썼다')
  && master.includes('덮어쓰지 않는다')
  && master.includes('성공한 유료 실행 뒤에만'))
check('Gate ⑧ cold-start 계약을 적는다',
  master.includes('첫 댓글을 영원히 시작할 수 없는 자리가 있었다')
  && master.includes('bootstrapReviewEligible')
  && master.includes('자동 공개 발행 **불가**')
  && master.includes('사람 승인 Queue 로만 이동'))
check('이번 PR 에 Queue write 경로가 없음을 명시한다',
  master.includes('공개 Queue write 경로가 없다'))
/**
 * 🔴 **없는 경로를 있다고 쓰지 않게 한다.**
 *    실제 DB 글로는 provider 를 부르지 않는데 "end-to-end 완료" 라고 적혀 있었다.
 */
check('실제 DB shadow 와 합성 eval 경로를 나눠 적는다',
  master.includes('경로는 **둘**이고 하나로 이어져 있지 않다')
  && master.includes('Gate 입력 사전검사')
  && master.includes('합성 input → buildPrompt → provider → 실제 Gate'))
check('단일 end-to-end 경로가 의도적으로 없다고 적는다',
  master.includes('의도적으로 막혀 있다')
  && master.includes('"end-to-end 완료" 라고 쓰지 않는다'))

/**
 * 🔴 **존재 여부 검사로는 모순을 못 잡는다.**
 *
 *    §9.3 이 "실제 DB 글은 provider 로 가지 않는다" 를 정확히 적어 두었는데도
 *    §9.4 상태표는 `end-to-end shadow 검증 | 완료 — … callProvider → 9관문 Gate` 였고,
 *    M10 은 `end-to-end shadow 파이프라인` 이었다. 두 문장이 문서 안에 함께 있었고
 *    검사가 **각각의 존재만** 봐서 102 pass 로 지나갔다(2026-09-09 Codex 지적).
 *
 *    그래서 여기서는 "옳은 문장이 있는가" 가 아니라
 *    **"현재 상태 표가 틀린 주장을 하고 있지 않은가"** 를 본다.
 *
 * 🔴 과거를 설명하는 역사 문장은 허용한다 — 사고를 지우면 같은 구조를 다시 만든다.
 *    그래서 §9.3 의 정정 문단(`앞선 판이 …`, `… 라고 쓰지 않는다`)은 대상에서 뺀다.
 */
{
  /** 상태를 주장하는 줄만 고른다 — 표의 행과 상태 표기 */
  const lines = master.split('\n')
  const HISTORY = [
    '앞선 판이', '사실이 아니다', '라고 쓰지 않는다', '의도적으로 막혀 있다',
    '옛 판', '한 줄로 합쳐 적으면',
  ]
  const isHistory = (l: string): boolean => HISTORY.some((h) => l.includes(h))

  /** 🔴 실제 DB 경로를 말하면서 provider 호출·9관문 완료를 주장하는 줄 */
  const badCurrent = lines.filter((l) => {
    if (isHistory(l)) return false
    // 표 행 또는 상태 문장만 본다
    const claimsDone = /완료|가동|파이프라인/.test(l)
    if (!claimsDone) return false
    const mentionsProvider = /callProvider|provider 호출|9관문 Gate/.test(l)
    const mentionsSynthetic = /합성/.test(l)
    // 🔴 합성이라고 밝힌 줄은 provider·Gate 완료를 말해도 된다
    return mentionsProvider && !mentionsSynthetic
  })
  check('🔴 현재 상태 표가 실제 DB 경로의 provider 호출·9관문 완료를 주장하지 않는다',
    badCurrent.length === 0)
  for (const l of badCurrent) console.log(`     🔴 모순: ${l.trim().slice(0, 110)}`)

  /** 🔴 `end-to-end shadow` 를 현재 상태로 쓰지 않는다 — 역사 문장만 허용 */
  const badE2E = lines.filter((l) => /end-to-end shadow/.test(l) && !isHistory(l))
  check('🔴 `end-to-end shadow` 를 현재 상태 표기로 쓰지 않는다', badE2E.length === 0)
  for (const l of badE2E) console.log(`     🔴 모순: ${l.trim().slice(0, 110)}`)

  // 🟢 반대로, 나눠 적은 두 행은 실제로 있어야 한다
  check('§9.4 가 실제 DB shadow 의 종점을 Gate 입력 사전검사로 적는다',
    /\| \*\*실제 DB shadow\*\* \|[^\n]*Gate 입력 사전검사[^\n]*외부 호출 0[^\n]*후보 Gate 실행 0/.test(master))
  check('§9.4 가 합성 eval 만 provider·9관문까지 갔다고 적는다',
    /\| \*\*합성 eval\*\* \|[^\n]*provider[^\n]*9관문 Gate[^\n]*실행 완료/.test(master))
  /**
   * 🔴 **문구를 하드코딩하지 않는다** (2026-09-10 정정).
   *
   *    옛 검사는 `실제 DB preflight + 합성 eval` 이라는 **글자**를 찾았다.
   *    그래서 M10 의 main 구현이 실제로 나아가도(PR #491 merge · 0024 적용)
   *    문서를 고치는 순간 검사가 깨졌다 — 낡은 상태를 지키는 검사였다.
   *    지금은 **계약**을 본다: 구현이 무엇이든 공개 댓글이 꺼져 있다고 말해야 한다.
   */
  const m10 = lines.find((l) => /^\| M10 \|/.test(l)) ?? ''
  check('M10 행이 존재한다', m10 !== '')
  check('🔴 M10 이 공개 댓글 OFF 를 명시한다',
    /공개 (댓글 )?(OFF|0\/day)/.test(m10) || m10.includes('공개 0/day'))
  check('🔴 M10 이 운영을 "완료" 로 적지 않는다', !/\| 완료 \|\s*$/.test(m10))
  check('Lane 표의 Persona-first Generation 이 Comment 경로임을 밝힌다',
    master.includes('Persona-first Generation (Comment 경로)'))
  check('그 행이 provider 호출은 합성 eval 만이라고 적는다',
    /Persona-first Generation \(Comment 경로\)[^\n]*provider 호출은 합성 eval 만/.test(master))
  check('shadow 검증 완료를 한 줄로 적지 않는다고 못박는다',
    master.includes('"shadow 검증 완료" 를 한 줄로 적지 않는다'))
}

/**
 * 🔴 **Wave 단계와 수집 능력은 구조로 검사한다** (2026-09-10).
 *
 *    숫자를 하드코딩하면 값이 바뀔 때마다 검사가 깨지고, 사람은 검사를 고친다.
 *    지켜야 하는 것은 값이 아니라 **구분**이다 —
 *    끝난 Wave 를 "다음 단계" 로 적지 않는 것, 등록을 능력으로 적지 않는 것.
 */
{
  console.log('\n── Wave 단계 · 수집 능력 구분')
  const lines = master.split('\n')
  /** 🔴 이미 끝난 Wave 를 "다음 단계" 로 가리키지 않는다 */
  const nextStepLines = lines.filter((l) => /\*\*다음 단계\*\*/.test(l))
  check('🔴 끝난 Wave 를 "다음 단계" 로 적지 않는다',
    !nextStepLines.some((l) => /Wave B/.test(l)))
  check('🔴 현재 단계를 명시한다', /\*\*현재 단계\*\*/.test(master))

  /** 🔴 Wave B 는 구현·설정과 운영 성공을 갈라 적는다 */
  check('🔴 Wave B 의 구현·설정과 운영 성공을 갈라 적는다',
    /Wave B 는 구현·설정은 끝났고 운영 성공은/.test(master))

  /** 🔴 수집 능력은 configured 와 observed 를 따로 적는다 */
  // 🔴 행 이름이 `설정된 상세 상한 (configured ceiling)` 으로 바뀌었다 (2026-09-14) —
  //    보는 것은 "설정값 행이 따로 있는가" 이지 특정 문구가 아니다
  check('🔴 수집 능력에 configured 행이 있다', /\(configured[^)]*\)/.test(master))
  check('🔴 수집 능력에 observed 행이 있다', /수집 능력 \(observed\)/.test(master))
  check('🔴 둘을 한 행으로 합치지 않는다',
    !lines.some((l) => /^\| 수집 능력 \(현재\) \|/.test(l)))

  /** 🔴 등록을 능력으로 읽지 말라고 못박는다 */
  check('🔴 "등록 ≠ 능력" 을 문서가 말한다', /등록은 능력이 아니다|등록 ≠ 능력/.test(master))
  check('🔴 슬롯 건강도 다섯 갈래를 적는다',
    ['OBSERVATION_PENDING', 'ACCUMULATING', 'DEGRADED', 'BROKEN', 'OK']
      .every((k) => master.includes(k)))
  check('🔴 guard closed + 요청 0 을 건강으로 읽지 말라고 적는다',
    /요청이 0회면 건강의 증거가 아니다/.test(master))

  /** 🔴 세션 정본이 절대 경로이고 worktree 밖이다 */
  check('🔴 세션 정본 절을 둔다', /### 8\.0-a 세션 정본/.test(master))
  check('🔴 세션 정본이 Application Support 아래다',
    /Application Support\/soransoran\/naver-session/.test(master))
  check('🔴 문서가 상대 경로를 정본으로 적지 않는다',
    !/SORAN_NAVERCAFE_SESSION_PATH\s*=\s*\.naver-session/.test(master))
  check('🔴 권한 700·600 을 적는다', /700/.test(master) && /600/.test(master))

  /** 🔴 세 값을 갈라 적는다 — 합치면 등록이 능력이 된다 */
  check('🔴 configured / scheduled liveness / observed 를 나눠 적는다',
    /`configured`/.test(master) && /`scheduled liveness`/.test(master) && /`observed`/.test(master))
  check('🔴 observed 를 설정값의 그림자로 만들지 말라고 적는다',
    /설정값의 그림자/.test(master))
  check('🔴 scout 가 예약 성공 증거가 아니라고 적는다',
    /--scout` 는 예약 경로의 성공 증거가 아니다|scout` 는 예약/.test(master))
  check('🔴 수동 회차가 예약 슬롯을 채우지 못한다고 적는다',
    /수동 preflight 가 성공해도/.test(master))
  check('🔴 경로 없음과 인증 만료를 다른 조치로 적는다',
    /RUN_SESSION_FILE_MISSING/.test(master) && /RUN_AUTH_EXPIRED/.test(master)
    && /env 를 고친다/.test(master))
  check('🔴 로그를 지워 통과시키지 않는다고 못박는다',
    /로그를 지우거나 잘라서 통과시키지 않는다/.test(master))
  check('🔴 기술적 성공과 공급 산출을 나눈다고 적는다',
    /기술적 성공과 공급 산출 성공을 나눈다/.test(master))
  check('🔴 setup 이 정본에 직접 쓰지 않는다고 적는다',
    /정본 자리에 직접 쓰지 않는다/.test(master))

  /**
   * 🔴 **옛 문구가 되돌아오면 잡는다** (2026-09-10).
   *    plist 템플릿과 README 가 "하루 2회 · 09:20/13:20 · 1회판 · 미등록" 으로
   *    되돌아가면 사람이 그것을 계약으로 읽는다.
   */
  const launchdDir = 'docs/operations/launchd'
  const launchdFiles = readdirSync(launchdDir)
    .filter((n) => n.endsWith('.template') || n === 'README.md')
  for (const n of launchdFiles) {
    const body = readFileSync(join(launchdDir, n), 'utf-8')
    /**
     * 🔴 **역사라고 표시한 줄은 현재 주장이 아니다.**
     *    정정문("더는 사실이 아니다")과 📜 로 시작하는 역사 블록을 빼고 본다 —
     *    그 표시가 없는 줄만 "지금 이렇다" 는 주장으로 읽힌다.
     */
    const claim = body.split('\n')
      .filter((l) => !l.includes('더는 사실이 아니다') && !l.includes('옛 문구')
        && !l.includes('📜') && !l.includes('그때의 기록'))
      .join('\n')
    check(`🔴 ${n} 에 옛 슬롯 문구가 없다`,
      !/카페는 하루 2회/.test(claim)
      && !/`09:20 remonterrace`/.test(claim))
  }

  /** 🔴 configured 를 current 로 부르지 않는다 */
  check('🔴 configured 를 current 라고 부르지 않는다',
    /`current` 라고 부르지 않는다|current 가 아니다/.test(master))
  check('🔴 observed 가 신규 고유 행이라고 적는다',
    /신규 고유 산출 행 수|신규 고유 행이다/.test(master))
  check('🔴 body-read 를 따로 적는다', /`body-read`/.test(master))
  check('🔴 NO_NEW 와 BODY_EMPTY 를 나눠 적는다',
    /NO_NEW/.test(master) && /BODY_EMPTY/.test(master))
  check('🔴 기록이 검사보다 먼저라고 적는다', /어떤 검사보다 먼저 연다/.test(master))

  /**
   * 🔴 **배포되지 않은 코드로 4/4 를 약속하지 않는다.**
   *    지금 runtime 은 이 PR 이전 SHA 다 — 다음 슬롯은 새 기록을 만들지 못한다.
   */
  /**
   * 🔴 **configured 를 current 라고 부르지 않는다** (2026-09-10 P1).
   *    §8.0 표가 `current` 라는 이름으로 등록 기반 값을 적고 있었다 —
   *    그 이름은 "지금 실제로 나오는 양" 으로 읽힌다.
   */
  check('🔴 §8.0 표가 configured 로 이름을 바꿨다',
    /~~current~~ → \*\*configured\*\*/.test(master))
  check('🔴 등록을 능력으로 읽지 말라고 그 자리에 적는다',
    /이 행을 `current` 라고 부르지 않는다/.test(master))
  check('🔴 화면 문구도 "설정" 이다', (() => {
    const inv = readFileSync('src/lib/collect-inventory.ts', 'utf-8')
    return /return `설정 \$\{Math\.round\(cur\.effectivePerDay\)\}건\/day/.test(inv)
      && !/return `현재 \$\{Math\.round/.test(inv)
  })())

  check('🔴 지금 배포된 것이 이 코드가 아니라고 밝힌다',
    /지금 배포된 것은 이 코드가 아니다/.test(master))
  check('🔴 "다음 슬롯부터 4\/4" 라고 쓰지 않는다',
    /다음 슬롯부터 4\/4 가 시작된다" 고 쓰지 않는다/.test(master)
    && !/^[^🔴\n]*다음 슬롯부터 4\/4 가 시작된다\s*$/m.test(master))
  check('🔴 4/4 는 배포 이후 슬롯부터라고 적는다',
    /merge 후 runtime 배포 시각 이후 슬롯부터/.test(master))
}
/** 🔴 bootstrap 숫자를 문서에 다시 적으면 코드와 어긋난다 */
check('bootstrap 기준을 Gate ⑧ 정본에서 파생한다고 적는다',
  master.includes('DEFAULT_FINGERPRINT_THRESHOLDS.minSamples')
  && master.includes('필요한 이전 발화는 `minSamples - 1` 건'))
check('옛 사각지대를 기록으로 남긴다',
  master.includes('bootstrap 도 막히고 ⑧ 도 돌지 않는 사각지대'))
check('필드 전달과 실제 실행 가능을 나눠 적는다',
  master.includes('**필드 전달**과 **실제 실행 가능**을 나눠 돌려준다'))
/**
 * 🔴 **공개를 켜는 조건이 문서에서 빠지지 않게 한다.**
 *    조건이 흩어지면 하나가 빠진 채로 켜지고, 빠진 것이 무엇인지 나중에 알게 된다.
 */
check('공개 release 조건을 표로 적는다',
  master.includes('### 9.5-d 공개 release 계약')
  && ['모델 확정', '사람이 승인한 Queue', 'bootstrap', '트랜잭션 재검사', 'runner/schedule 등록']
    .every((t) => master.includes(t)))
check('하나라도 빠지면 0 이라고 못박는다',
  master.includes('하나라도 빠지면 0 이다'))
check('runner 를 이번 PR 에서 등록하지 않았다고 적는다',
  master.includes('plist 를 쓰지도 load 하지도 않았다'))
/**
 * 🔴 Queue 가 막힌 **이유**는 바뀌었다 — 모델은 확정됐고, 지금 막는 것은
 *    shadow 미완료·허용량 0·runner 미등록이다. 막혀 있다는 사실만 지킨다.
 */
check('Queue 적재가 여전히 fail-closed 임을 적는다',
  /Queue 적재 실행 \|[^\n]*🔴 \*\*[^\n]*fail-closed\*\*/.test(master)
  && /Queue 적재 실행 \|[^\n]*DB write 0/.test(master))
/**
 * 🔴 **"구현됨" 을 "실가동" 으로 읽지 못하게 한다.**
 *    앞선 판은 계약을 만들고도 어느 것도 write 경로에 닿지 않았다.
 */
check('구현됨·연결됨·실가동을 나눠 적는다',
  master.includes('구현됨 / 연결됨 / 실가동을 나눈다')
  && /\| 축 \| 구현됨 \| 연결됨 \| 실가동 \|/.test(master))
check('runner schedule 이 미등록임을 그 표에도 적는다',
  /schedule 등록 \| ✅ 템플릿 \| 🔴 \*\*미등록\*\*/.test(master))
check('글로벌 상한을 Serializable 로 막는다고 적는다',
  master.includes('Serializable') && master.includes('재시도하지 않는다'))
check('bootstrap 자동 발행이 bootstrap-auto 단계로만 열린다고 적는다',
  master.includes('requireAdmin()') && master.includes('dead-end')
  && master.includes('**`bootstrap-auto` 단계 하나**에만 열린다'))
/** 🔴 production 에 적용하지 않은 것을 blocker 로 남긴다 */
check('provenance 전용 컬럼이 blocker 임을 적는다',
  master.includes('임의로 적용하지 않았다') && master.includes('창업자 승인이 필요한 blocker'))
check('--apply 가 계약을 이기지 못한다고 적는다',
  master.includes('플래그가 계약을 이기지 못하게 한다'))
check('실회원 글 외부 전송 금지를 release 절에도 적는다',
  master.includes('실회원이 쓴 글의 원문을 외부 모델로 보내지 않는다')
  && master.includes('`slice` 를 요약이나 익명화라고 부르지 않는다'))
check('댓글 회차를 글 발행량과 묶지 않는다고 적는다',
  master.includes('글 발행량(d1~d10)과 묶지 않는다'))
/**
 * 🔴 **"결과 9개" 를 "9관문 통과" 로 읽지 못하게 한다.**
 *    입력을 빠뜨리면 notRun 인 채로 9개가 채워진다 — 첫 shadow 판이 그랬다.
 */
check('9관문의 결과 존재와 실제 실행을 나눠 적는다',
  master.includes('"결과 9개" 와 "실제 실행" 을 나눈다')
  && ['결과 존재', '실제 실행', 'notRun', '필수 미실행'].every((t) => master.includes(t)))
check('notRun 을 pass 로 세지 않는다고 명시한다',
  master.includes('`notRun` 을 `pass` 로 세지 않는다'))
/** 🔴 자른 원문을 "요약" 이라 부르지 않게 한다 */
check('실제 회원 글의 외부 전송 금지를 명시한다',
  master.includes('요약이 아니라 원문 앞부분')
  && master.includes('PII 제거'))
check('옛 1회판 job 처리 상태를 적는다',
  master.includes('옛 1회판 수집 job') && master.includes('재부팅 재등록 차단'))
/** 🔴 앞선 판의 오진이 되살아나지 않게 한다 */
check('옛 생성기 오진을 정정한 채로 둔다',
  master.includes('그것은 사실이 아니다')
  && !master.includes('옛 생성기는 근거를 그 Persona 가 과거에 쓴'))
check('모델 비교가 합성 입력이었음을 명시한다',
  master.includes('합성 fixture') && master.includes('원문·닉네임·개인정보는 나가지 않았다'))
check('Memory·대댓글이 이번 범위가 아님을 명시한다',
  /Memory · 대댓글 \| 🔴 이번 범위 \*\*아님\*\*/.test(master))
/** 🔴 옛 수치가 "현재값" 으로 되살아나지 않게 한다 */
for (const stale of ['댓글 0개 25/30', '댓글 15건, 고유 기여자']) {
  check(`옛 댓글 수치가 상단에 남아 있지 않다 — ${stale}`, !master.includes(stale))
}
check('살아 있는 댓글 기준 실측을 §6.3 에 둔다',
  master.includes('최근 7일 살아 있는 실사용자 댓글'))
/**
 * 🔴 ratio 계약이 **문서에만** 남지 않게 한다.
 *    숫자를 문서에 적어 두고 코드가 그것을 모르면, 그 숫자는 지켜지지 않는다.
 */
check('ratio 계약의 정본이 코드임을 가리킨다',
  master.includes('src/lib/persona-comment-governor.ts'))
check('ratio 를 내림한다고 명시한다 (반올림하면 사람 1명에 봇 1개가 붙는다)',
  master.includes('내림한다') && master.includes('0.43건은 0건'))
check('집계 실패 시 상한 0 임을 명시한다',
  /집계에 실패하거나 값이 손상되면 상한은 0이다/.test(master))
check('글 발행량과 댓글 상한을 묶지 않는다고 명시한다',
  master.includes('글 발행량(d1/d3/d5/d10)과 댓글 상한을 묶지 않는다'))
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
/**
 * 🔴 **문서와 코드가 갈라지지 않는가** — 모순만 잡는다 (2026-09-12).
 *
 *    옛 판은 `master.includes('1슬롯/day, --limit=1')` 로 **고장난 상태를 고정**하고 있었다.
 *    워크플로우가 네 단계 슬롯을 예약하게 바뀌어도 문서가 "1슬롯/day" 라고 말하면
 *    이 검사는 초록이었다. 검사가 낡은 사실의 편에 서 있었던 것이다.
 *
 *    🔴 문자열 개수를 늘려 부풀리지 않는다. **사실이 갈라지는 다섯 지점**만 본다.
 */
check('현재 scheduled publish는 회차당 1건이다',
  /original-post-auto-publish\.mts --apply --limit=1\b/.test(workflow))
check('🔴 workflow 상단이 "매일 한 번" 이라고 주장하지 않는다', !workflow.includes('매일 한 번'))
check('🔴 Master 현재 상태에 workflow 1슬롯/day 가 남아 있지 않다', !master.includes('1슬롯/day'))
check('🔴 Master 현재 병목에 workflow 1/10 슬롯이 남아 있지 않다', (() => {
  // 취소선(~~…~~)으로 해소를 적은 줄은 역사 기록이다 — 현재 주장만 본다
  const live = master.split('\n').filter((l) => !l.includes('~~'))
  return !live.some((l) => l.includes('1/10 슬롯'))
})())
check('🔴 현재 설정을 "저장된 d1" 이라고 오기하지 않는다',
  /`SORAN_CAPACITY_STAGE`\s*\|\s*🔴 \*\*Variable 없음\*\*/.test(master)
  && /`SORAN_RELEASE_STAGE`\s*\|\s*🔴 \*\*Variable 없음\*\*/.test(master))
check('🔴 d3 전환 안내에 capacity 와 release 가 둘 다 있다', (() => {
  const m = /#### d3 로 올리는 절차[\s\S]*?(?=\n#{1,4} |$)/.exec(master)?.[0] ?? ''
  return m.includes('SORAN_CAPACITY_STAGE=d3') && m.includes('SORAN_RELEASE_STAGE=d3')
})())

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

/**
 * ══ 🔴 Persona 준비 상태 — **숫자끼리 어긋나는지** 본다 ══
 *
 *    창업자 지적: 문서가 "9명" 과 "15명" 과 "18명" 을 서로 다른 절에서 말하고 있었다.
 *    절마다 문자열이 있는지 세는 검사로는 이런 모순을 절대 잡지 못한다 —
 *    셋 다 "있었기" 때문이다.
 *
 *    그래서 §9.5-f 표의 숫자를 **뽑아서 서로 더해 본다.** 그리고 정본 universe 는
 *    문서가 아니라 코드(`PRODUCTION_PERSONA_CODES`)에서 가져와 맞춘다.
 */
const num = (label: string): number | null => {
  const m = new RegExp(`\\| \\*?\\*?${label}\\*?\\*? \\| \\*\\*(\\d+)명\\*\\*`).exec(master)
  return m === null ? null : Number(m[1])
}
const universe = num('production 정본 universe')
const bundleOk = num('reference bundle 성립')
const bundleNo = num('bundle 미성립')
const inputOk = num('production 입력 성립')
const inputNo = num('production 입력 실패')
const shadowRan = num('Gemini shadow 실행')
const fullPass = num('9관문 완주')

check('🔴 Persona 준비 상태 정본 표(§9.5-f)가 있다',
  master.includes('### 9.5-f Persona reference 준비 상태')
  && [universe, bundleOk, bundleNo, inputOk, inputNo, shadowRan, fullPass]
    .every((v) => v !== null))
check('🔴 문서의 정본 universe 가 코드의 정본 universe 와 같다',
  universe === PRODUCTION_PERSONA_CODES.length)
check('🔴 bundle 성립 + 미성립 = universe',
  universe !== null && bundleOk !== null && bundleNo !== null
  && bundleOk + bundleNo === universe)
check('🔴 입력 성립 + 입력 실패 = bundle 성립',
  bundleOk !== null && inputOk !== null && inputNo !== null
  && inputOk + inputNo === bundleOk)
check('🔴 shadow 실행이 입력 성립보다 많지 않다',
  shadowRan !== null && inputOk !== null && shadowRan <= inputOk)
/**
 * 🔴 **관문 ⑧ 이 돌지 않은 만큼은 9관문을 완주할 수 없다.**
 *    수만 비교하면 `9관문 완주 14 / shadow 14` 가 통과한다 — 같은 문서가
 *    바로 아래에서 `관문 ⑧ notRun 14` 라고 적고 있는데도. 두 문장을 함께 본다.
 */
const notRun8 = ((): number | null => {
  const m = /관문 ⑧ \*\*notRun (\d+)\*\*/.exec(master)
  return m === null ? null : Number(m[1])
})()
check('🔴 관문 ⑧ notRun 수를 적는다', notRun8 !== null)
check('🔴 9관문 완주가 shadow 실행보다 많지 않다',
  fullPass !== null && shadowRan !== null && fullPass <= shadowRan)
check('🔴 9관문 완주 + 관문 ⑧ notRun 이 shadow 실행을 넘지 않는다',
  fullPass !== null && shadowRan !== null && notRun8 !== null
  && fullPass + notRun8 <= shadowRan)
check('🔴 statusPass 를 9관문 통과로 읽지 말라고 적는다',
  master.includes('`statusPass` 를 "9관문 통과" 로 읽지 않는다'))
/** 🔴 막힌 P 코드를 적었으면 **개수가 표와 같아야 한다** */
const codesOf = (label: string): number => {
  const m = new RegExp(`\\| \\*?\\*?${label}\\*?\\*? \\|[^\\n]*\\| ((?:P\\d\\d ?)+)`).exec(master)
  return m === null ? -1 : m[1]!.trim().split(/\s+/).length
}
check('🔴 bundle 미성립 P 코드 개수가 표의 수와 같다', codesOf('bundle 미성립') === bundleNo)
check('🔴 입력 실패 P 코드 개수가 표의 수와 같다', codesOf('production 입력 실패') === inputNo)
/**
 * 🔴 **같은 숫자를 두 곳에서 말하지 않는다.** 두 곳에 적으면 한쪽만 고쳐지는 날이 온다 —
 *    "9명뿐이다 / 나머지 15명" 이 정확히 그렇게 남아 있었다.
 */
check('🔴 Persona 준비 수를 정본 표 밖에서 또 주장하지 않는다',
  !/(검증된 )?reference Persona (는|가) \d+명뿐/.test(master)
  && !/나머지 \d+명은 근거가 없어/.test(master))

/**
 * ══ 🔴 부트스트랩 정책 — **문서의 숫자를 코드로 계산해서 맞춘다** ══
 *
 *    표에 `100편 → 50건` 이라고 적어 두고 코드가 다른 답을 내면,
 *    그 표는 계약이 아니라 소망이다. 그래서 여기서 실제로 계산해 비교한다.
 */
check('🔴 부트스트랩 정본 절(§9.5-g)이 있다',
  master.includes('### 9.5-g 초기 부트스트랩'))
check('🔴 단계 네 개를 코드와 같은 이름으로 적는다',
  COMMENT_STAGES.every((s) => master.includes(`\`${s}\``)))
check('🔴 기본 단계가 shadow 임을 적는다',
  /\| `shadow` \(기본\) \| 🔴 0 \| 🔴 0 \|/.test(master))
check('🔴 모르는 값이 shadow 로 내려간다고 적는다',
  master.includes('모르는 값은 `shadow` 다'))
check('🔴 옛 문자열 이동을 적는다',
  master.includes('`release` → `organic`') && master.includes('`inspect` → `shadow`'))
check('🔴 옛 값이 bootstrap-auto 로 가지 않는다고 적는다',
  master.includes('옛 값이 `bootstrap-auto` 로 올라가는 경로는 없다'))
/**
 * 🔴 **단기 정본은 한 곳에만 있다** (2026-09-11).
 *    §2 는 장기(North Star), §9.5-g 는 단기다. 같은 수가 두 곳에 있으면
 *    반드시 한쪽이 낡고, 낡은 쪽이 먼저 읽힌다.
 */
check('🔴 §2 를 장기 정본으로 선언한다',
  master.includes('### 2.1 North Star — 🔴 장기 정본')
  && master.includes('이 절은 장기 정본이다. 단기 목표는 여기 적지 않는다'))
check('🔴 단기 목표가 §9.5-g 한 곳에만 있다고 적는다',
  master.includes('**§9.5-g 한 곳에만**')
  && master.includes('🔴 **이 절이 지금 분기의 단기 정본이다.**'))
check('🔴 Persona·봇 활동을 North Star 에 넣지 않는다고 적는다',
  master.includes('Persona·봇 활동과 게시량은 North Star 에 넣지 않는다'))
check('🔴 단기 정본 표가 있다', master.includes('#### 🔴 단기 정본 (2026-09-11 교체)'))
check('🔴 글당 상한을 코드와 같은 수로 적는다',
  master.includes(`| 한 글의 Persona 댓글 | **1~${PERSONA_COMMENTS_PER_POST_MAX}건** |`))
check('🔴 일 절대 상한을 코드와 같은 수로 적는다',
  master.includes(`| Persona 댓글 하루 상한 | **${BOOTSTRAP_DAILY_MAX}건** |`))
check('🔴 첫 댓글 목표를 코드와 같은 수로 적는다',
  master.includes(`| 새 관리형 글의 첫 댓글 | **${FIRST_COMMENT_MAX_MINUTES}분 안에** |`))
check('🔴 댓글 0개 글을 먼저 고른다고 적는다',
  master.includes('| 선택 순서 | **댓글 0개 글을 항상 먼저** |'))
check('🔴 같은 Persona 가 같은 글에 두 번 달지 않는다고 적는다',
  master.includes('| 같은 Persona 가 같은 글에 | **금지** |'))
check('🔴 30% 는 organic 에서만이라고 적는다',
  master.includes('| 30% ratio | **`organic` 단계에서만** |'))
/**
 * 🔴 **폐기한 계약을 역사로 명시한다.** 지우기만 하면 다음 사람이
 *    "왜 없지" 하고 되살린다 — 실제로 되살아난 적이 있다(은퇴 job 2개).
 */
for (const gone of ['coverage **50%**', '하루 **100건** 절대 상한',
  '한 글에 Persona **1명**', 'Queue 적재 **회차당 1건**',
  '한 Persona 는 **한 회차에 한 번**', '댓글 runner **하루 1회**(19:40)']) {
  check(`🔴 폐기 계약을 역사로 남긴다 — ${gone}`, master.includes(gone))
}
check('🔴 폐기 표에 "되살리지 않는다" 를 적는다',
  master.includes('폐기한 계약 — 역사로만 남긴다'))
/**
 * 🔴 **살아 있는 coverage 문구가 남아 있으면 안 된다.**
 *    폐기 표의 한 줄(`| coverage **50%** | ...`)만 허용한다 — 그 줄은 역사다.
 *    본문 어디든 다시 나타나면 다음 사람은 그것을 현재 계약으로 읽는다.
 */
{
  const lines = master.split('\n').filter((l) => l.includes('coverage **50%**'))
  check('🔴 coverage 50% 는 폐기 표의 한 줄로만 남아 있다',
    lines.length === 1 && lines[0]!.startsWith('| coverage **50%** |'))
}
/** 🔴 표의 네 줄을 실제 함수로 계산해 맞춘다 */
for (const posts of [1, 10, 100, 200]) {
  const budget = judgeBootstrapBudget({
    openSlots: posts * PERSONA_COMMENTS_PER_POST_MAX, publishedToday: 0, killSwitchOff: true,
  })
  const row = new RegExp(`\\| ${posts}편 \\| (\\d+) \\| \\*\\*(\\d+)건\\*\\*`).exec(master)
  check(`🔴 문서의 "글 ${posts}편 → 자리 N · 상한 M" 이 실제 계산과 같다`,
    row !== null
    && Number(row[1]) === posts * PERSONA_COMMENTS_PER_POST_MAX
    && Number(row[2]) === budget.remaining)
}
/**
 * 🔴 **남은 자리 표(기존 0/1/4/5 → 5/4/1/0)를 실제 계산과 맞춘다.**
 *    이 줄이 문서에만 있고 코드와 어긋나면, 다음 사람은 문서를 믿고 예산을 잘못 읽는다.
 */
{
  const row = /\| 남은 자리 \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/
    .exec(master)
  const want = [0, 1, 4, 5].map((had) => countManagedPosts([
    { authorKind: 'persona', externalSourced: false, personaCommentCount: had },
  ]).openSlots)
  check('🔴 "기존 0/1/4/5 → 남은 5/4/1/0" 이 실제 계산과 같다',
    row !== null && want.every((v, i) => Number(row[i + 1]) === v))
}
/** 🔴 이중 차감 정정을 기록으로 남긴다 — 지우면 같은 산식이 되살아난다 */
check('🔴 오늘 발행 수를 두 번 빼지 않는다고 적는다',
  master.includes('**오늘 발행 수를 두 번 빼지 않는다**')
  && master.includes('**3건**') && master.includes('**250건**'))
check('🔴 트랜잭션 재검증을 유지한다고 적는다',
  master.includes('**그 재검증은 유지한다.**'))
/** 🔴 산식이 실제로 이중 차감을 하지 않는지 값으로 확인한다 */
check('🔴 cap - used 가 remaining 과 같다 (재검증이 이중 차감이 되지 않는다)',
  [0, 1, 250, 499, 500].every((used) => {
    const b = judgeBootstrapBudget({ openSlots: 500, publishedToday: used, killSwitchOff: true })
    return b.cap - b.used === b.remaining
  }))
/** 🔴 Gate ⑧ cold-start 개방 범위를 문서가 좁게 적는다 */
check('🔴 cold-start 를 영구 blocker 로 쓰지 않는다고 적는다',
  master.includes('Gate ⑧ cold-start 를 자동화의 영구 blocker 로 쓰지 않는다'))
check('🔴 여는 단계가 bootstrap-auto 하나뿐이라고 적는다',
  master.includes('**`bootstrap-auto` 단계 하나**에만 열린다'))
check('🔴 여는 모양이 좁다고 적는다', master.includes('isGateEightColdStart'))
check('🔴 다른 Gate 실패는 그대로 막는다고 적는다',
  master.includes('① 유출이 `reject` 면 Gate 재검사에서 그대로 막힌다'))
/** 🔴 schedule 실측을 문서가 그대로 적는다 */
{
  const plan = planRunnerSchedule(BOOTSTRAP_DAILY_MAX)
  check('🔴 슬롯 수·간격·야간 공백을 실제 계산과 같이 적는다',
    master.includes(`회차당 25건 × **${plan.runs}회**`)
    && master.includes(`회차 간격 최대 ${plan.maxGapMinutes}분`)
    && master.includes(`야간 공백 ${plan.nightGapMinutes}분`))
  check('🔴 60분 계약을 슬롯이 실제로 만족한다',
    plan.maxGapMinutes !== null && plan.maxGapMinutes <= FIRST_COMMENT_MAX_MINUTES)
}
/** 🔴 ② 코퍼스 정본과 버린 길을 함께 적는다 */
check('🔴 ② 코퍼스 정본이 익명 정본 자산이라고 적는다',
  master.includes('② 댓글 코퍼스 공급원 — 소란소란 익명 정본 자산')
  && master.includes('loadCanonCorpusTexts'))
check('🔴 화자를 빈도 판정에 쓰지 않는다고 적는다',
  master.includes('`speakerId` 는 빈도 판정에 쓰지 않는다'))
check('🔴 원문을 Git·DB 로 복사하지 않는다고 적는다',
  master.includes('원문을 Git·DB 로 복사하지 않는다'))
check('🔴 버린 두 길을 기록으로 남긴다',
  master.includes('CafePost`') === false
  && master.includes('자체 `Comment` 표 + 500건 대기'))
check('🔴 자산 부재를 영구 정지로 만들지 않는다고 적는다',
  master.includes('bootstrap 전체를 영구 정지시키지 않는다'))
/** 🔴 운영 창 계약 — 글 발행도 같은 창 안이어야 한다 */
check('🔴 운영 창을 08~22 로 못박는다',
  master.includes('#### 🔴 운영 창 계약 — 08~22시')
  && master.includes('24시간으로 만들지 않는다'))
check('🔴 글 발행도 같은 창 안에 배치해야 한다고 적는다',
  master.includes('관리형 글 발행도 같은 창 안에 배치해야 한다'))
check('🔴 글 100/day 확장은 별도 승인 대상이라고 적는다',
  master.includes('글 파이프라인을 100/day 로 확장하는 것은 여전히 별도 승인 대상이다'))
/**
 * 🔴 **글 슬롯이 댓글 운영 창 안에 있는가** — 문서가 아니라 **코드**에 묻는다 (2026-09-12).
 *
 *    §9.5-g 는 "창 밖에 글을 내보내는 것이 계약 위반" 이라고 적어 두고도
 *    `PROFILES` 는 네 단계 전부 `00:05` 를 갖고 있었다. 문서와 코드가 갈라진 것이다.
 *    문자열을 세지 않고 **실제 슬롯과 실제 댓글 회차**를 대조한다.
 */
{
  const commentMins = planRunnerSchedule(BOOTSTRAP_DAILY_MAX).slots
    .map(minuteOfDay).sort((a, b) => a - b)
  const winStart = RUNNER_WINDOW_START_HOUR * 60
  const winEnd = RUNNER_WINDOW_END_HOUR * 60
  const allPostMins = RELEASE_STAGES.flatMap((st) => PROFILES[st].slots.map(minuteOfDay))
  check('🔴 모든 공개 슬롯이 댓글 운영 창 안이다 (코드 대조)',
    allPostMins.length > 0 && allPostMins.every((m) => m >= winStart && m <= winEnd))
  check('🔴 모든 공개 슬롯의 첫 댓글이 60분 안이다 (코드 대조)',
    allPostMins.every((m) => {
      const next = commentMins.find((c) => c >= m)
      return next !== undefined && next - m <= FIRST_COMMENT_MAX_MINUTES
    }))
  check('🔴 00:05 슬롯이 어느 단계에도 남아 있지 않다',
    !RELEASE_STAGES.some((st) => PROFILES[st].slots.some((s) => s.hour === 0 && s.minute === 5)))
}
/** 🔴 Persona 하루 1건 폐기를 기록으로 남긴다 */
check('🔴 Persona 하루 1건 폐기를 역사로 남긴다',
  master.includes('Persona **하루 1건** bootstrap')
  && master.includes('planner 의 soft balancing 이 다룬다'))
/** 🔴 마일스톤 — 하나라도 빠지면 로드맵이 아니다 */
for (const m of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) {
  check(`🔴 ${m} 을 적는다`, new RegExp(`\\*\\*${m}\\*\\*`).test(master))
}
/**
 * 🔴 **글 쪽 준비 상태를 숨기지 않는다.**
 *    댓글 목표 100/200 을 적으면서 글이 하루 1편인 사실을 빼면,
 *    읽는 사람은 100/day 가 이미 도는 줄로 읽는다.
 */
check('🔴 지금 글 단계가 d1 이고 하루 1편임을 적는다',
  master.includes('`SORAN_RELEASE_STAGE=d1`')
  && master.includes(`\`dailyTarget\` 은 **${PROFILES.d1.dailyTarget}**`))
check('🔴 이번 변경이 글을 올린 것이 아니라고 적는다',
  master.includes('글 자체를 100 으로 올린 것이 아니다'))
check('🔴 runner 를 등록하지 않았다고 적는다',
  master.includes('runner 는 등록하지 않았다'))

/**
 * 🔴 **운영 정본을 두 지침이 모두 가리킨다** (2026-09-11).
 *    한쪽만 가리키면 그 도구로 들어온 세션은 목적을 모른 채 일한다.
 */
for (const f of ['AGENTS.md', 'CLAUDE.md']) {
  const g = readFileSync(f, 'utf-8')
  check(`🔴 ${f} 가 NORTH-STAR 를 가리킨다`, g.includes('docs/operations/NORTH-STAR.md'))
  check(`🔴 ${f} 가 CURRENT-MILESTONE 을 가리킨다`, g.includes('docs/operations/CURRENT-MILESTONE.md'))
}
/** 🔴 정본을 복제하지 않는다 — 복제하면 한쪽이 낡고 낡은 쪽이 먼저 읽힌다 */
check('🔴 North Star 문장을 지침에 복제하지 않았다',
  ['AGENTS.md', 'CLAUDE.md'].every((f) =>
    !readFileSync(f, 'utf-8').includes('7일 안에 다시 방문해')))

/**
 * 🔴 **두 지침이 CURRENT-MILESTONE 과 반대말을 하지 않는다** (2026-09-11).
 *
 *    AGENTS.md 는 "정상 상태 봇 글·댓글 0건 · 봇으로 채우지 않는다" 라고 적고,
 *    CLAUDE.md 는 "봇 글·댓글로 채우기" 를 금지 목록에 두고 있었다.
 *    그런데 CURRENT-MILESTONE 의 승인된 단기 목표는 **관리형 공개 글 100/day 와
 *    글당 Persona 댓글 1~5건**이다. 두 문서가 정반대를 말하면, 먼저 읽은 쪽이 이긴다 —
 *    에이전트마다 다른 답을 내고, 그 차이를 아무도 못 본다.
 *
 * 🔴 막아야 할 것은 **없는 활동을 있는 것처럼 보이는 지표**이지 글과 댓글 자체가 아니다.
 */
for (const f of ['AGENTS.md', 'CLAUDE.md']) {
  const g = readFileSync(f, 'utf-8')
  check(`🔴 ${f} 에 "봇 글·댓글 0건" 류의 반대말이 없다`,
    !g.includes('봇 글·댓글 0건')
    && !g.includes('봇 글·댓글로 채우기')
    && !g.includes('봇으로 채우지 않는다'))
  check(`🟢 ${f} 가 가짜 지표 금지는 유지한다`,
    g.includes('접속자 수') || g.includes('가짜 실시간 지표'))
  check(`🟢 ${f} 가 실제 회원 원문 보호는 유지한다`, g.includes('실제 회원 원문'))
  // 🔴 목표 수치는 CURRENT-MILESTONE 한 곳에만 — 복제하면 한쪽이 낡는다
  check(`🔴 ${f} 가 목표 수치를 복제하지 않는다`,
    !/100\s*(건)?\/day/.test(g) && !g.includes('1~5건'))
}
check('🔴 CURRENT-MILESTONE 이 그 목표의 단일 정본이다', (() => {
  const m = readFileSync('docs/operations/CURRENT-MILESTONE.md', 'utf-8')
  return m.includes('100건/day') && m.includes('1~5건')
})())

/**
 * 🔴 **단계 진입 게이트는 `derive(profile).stockTarget` 하나다** (2026-09-12).
 *
 *    옛 판은 "재고 300 을 넘어야 d1 해제" 라고 적혀 있었다. 그런데 코드의 d3 재고 목표는
 *    42 다 — 문서가 코드보다 7배 높은 별도 게이트를 만들어 두고 있었고, 그 수는
 *    어디서도 계산되지 않았다. 재고 100·300·700 은 **성장 마일스톤**이지 진입 규제가 아니다.
 *
 *    🔴 문서가 그 값을 복제하므로 **코드에서 계산한 값과 같은지** 본다.
 */
{
  const milestone = readFileSync('docs/operations/CURRENT-MILESTONE.md', 'utf-8')
  for (const stage of ['d3', 'd5', 'd10'] as const) {
    const want = derive(PROFILES[stage]).stockTarget
    check(`🔴 CURRENT-MILESTONE 의 ${stage} 재고 목표가 코드(${want})와 같다`,
      new RegExp(`\\| ${stage} \\| \\*\\*${want}\\*\\* \\|`).test(milestone))
  }
  check('🔴 재고 300 을 d3 진입 게이트로 쓰지 않는다',
    !/재고\s*300\s*을?\s*(넘어야|이상이어야)/.test(milestone))
  check('🔴 100·300·700 은 성장 마일스톤이라고 적는다',
    milestone.includes('성장 마일스톤이지'))
}

console.log(`\nMaster 운영 문서 검사: ${passed} pass, ${failed} fail`)
if (failed > 0) process.exit(1)
