#!/usr/bin/env tsx
/**
 * visibility-guard 실행 예산 fixture — 🔴 **DB 0 · 네트워크 0 · 파일 write 0**
 *
 * 왜 이 파일이 있는가:
 *   2026-09-15 Actions 무료 2,000 분이 소진되어 **발행이 멈췄다.**
 *   auto-publish 가 러너를 배정받지 못했다(run 34931463988 · steps=0).
 *   원인은 발행이 아니라 CI 였다 — visibility-guard 가 702 회 / 1,888 분을 썼다.
 *
 *   비용이 이렇게 된 이유는 하나씩 보면 전부 합리적이었다.
 *   step 을 하나 더 붙이는 것도, merge 후 한 번 더 도는 것도 각각은 옳다.
 *   **아무도 합계를 세지 않았을 뿐이다.** 실측: run 1 회가 2 주 만에 1.11 분 → 5.72 분.
 *
 *   그래서 합계를 세는 자리를 만든다. 이 fixture 가 깨지면
 *   "예산을 넘었다" 는 뜻이지 "코드가 틀렸다" 는 뜻이 아니다 —
 *   step 을 게이트 뒤로 옮기거나, 재고 뒤에 상한을 **의식적으로** 올린다.
 *
 * 지키는 것 네 가지
 *   ① merge 전 PR CI 가 살아 있다            (pull_request 트리거)
 *   ② main 통합을 매일 1 회 본다              (schedule 트리거)
 *   ③ 손으로 돌릴 길이 있다                   (workflow_dispatch)
 *   ④ 무거운 fixture 는 경로 조건 뒤에 있고,
 *      무조건 실행 step 이 말없이 늘지 않는다
 *
 * 사용법: npm run check:workflow-budget
 * 종료 코드: FAIL 이 있으면 1
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf-8')

let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

const WF = '.github/workflows/visibility-guard.yml'
const yml = read(WF)
const lines = yml.split('\n')

/** 🔴 주석을 판정 근거로 쓰지 않는다 — 주석에 적힌 `cron:` 이 트리거로 읽히면 안 된다 */
const code = lines.filter((l) => !/^\s*#/.test(l))

// ─────────────────────────────────────────────────────────
console.log('\n① 안전장치가 살아 있다')
// ─────────────────────────────────────────────────────────
const onIdx = code.findIndex((l) => /^on:\s*$/.test(l))
const jobsIdx = code.findIndex((l) => /^jobs:\s*$/.test(l))
check('🔴 on: 블록과 jobs: 블록이 있다', onIdx >= 0 && jobsIdx > onIdx)
const onBlock = code.slice(onIdx + 1, jobsIdx).join('\n')

check('🔴 merge 전 PR CI 가 산다 — pull_request 트리거가 있다',
  /^ {2}pull_request:\s*$/m.test(onBlock))
check('🔴 main 통합을 매일 본다 — schedule 트리거가 있다',
  /^ {2}schedule:\s*$/m.test(onBlock))
check('🔴 그 schedule 에 cron 이 정확히 1 줄이다 (하루 1 회)',
  (onBlock.match(/^\s*- cron:/gm) ?? []).length === 1)
check('🔴 손으로 돌릴 길이 있다 — workflow_dispatch 가 있다',
  /^ {2}workflow_dispatch:\s*$/m.test(onBlock))

/**
 * 🔴 **merge 마다 전체 재실행하던 구조로 되돌아가지 않는다.**
 *    2026-09 실측으로 265 회(38%) · 약 700 분이 여기서 나왔다.
 *    main 통합은 위 schedule 이 본다.
 */
check('🔴 push 트리거가 없다 — merge 마다 전체가 다시 돌지 않는다',
  !/^ {2}push:\s*$/m.test(onBlock))

/**
 * 🔴 **경로로 run 을 거르지 않는다.**
 *    옛 판은 docs 와 markdown 을 paths-ignore 로 걸렀다. 이 저장소의 문서는 검사 대상이다 —
 *    실측(2026-09-15): CURRENT-MILESTONE.md 의 `| d3 | **42** |` 한 줄을 고치면
 *    master:doc-check 가 exit 1 이다(그 값은 derive(PROFILES.d3).stockTarget 과 같아야 한다).
 *    걸렀다면 그 회차는 초록도 빨강도 아닌 **무음**이 됐다.
 */
check('🔴 pull_request 를 경로로 거르지 않는다 — 문서 전용 PR 도 워크플로우가 뜬다',
  !/paths-ignore:/.test(onBlock) && !/^ {4}paths:/m.test(onBlock))

// ─────────────────────────────────────────────────────────
console.log('\n② 경로 판정이 fail-closed 다')
// ─────────────────────────────────────────────────────────
const SCOPE_ID = 'scope'
check('🔴 변경 경로를 판정하는 step 이 있다', new RegExp(`^\\s*id: ${SCOPE_ID}\\s*$`, 'm').test(yml))

/** 🔴 판정 step 본문만 떼어 본다 — 다른 step 의 문자열을 근거로 삼지 않는다 */
const scopeStart = lines.findIndex((l) => l.includes(`id: ${SCOPE_ID}`))
const scopeEnd = lines.findIndex((l, i) => i > scopeStart && /^      - (name|uses):/.test(l))
/**
 * 🔴 **주석을 코드로 세지 않는다.** 이 파일 상단의 `code` 필터와 같은 원칙이다.
 *    판정 step 은 자기가 왜 `set -e` 를 쓰지 않는지 주석으로 적어 둔다 —
 *    그 설명이 "set -e 가 있다" 로 읽히면 가드가 사실이 아닌 것을 막는다.
 */
const scopeBlock = lines
  .slice(scopeStart, scopeEnd < 0 ? lines.length : scopeEnd)
  .filter((l) => !/^\s*#/.test(l))
  .join('\n')

check('🔴 기본값이 heavy=true 다 — 모르면 돌린다', /^\s*heavy=true\s*$/m.test(scopeBlock))
check('🔴 heavy=false 는 한 곳에서만 난다 — 빠져나갈 구멍이 하나여야 읽을 수 있다',
  (scopeBlock.match(/^\s*heavy=false\s*$/gm) ?? []).length === 1)
check('🔴 판정 결과를 출력으로 넘긴다', /echo "heavy=\$heavy" >> "\$GITHUB_OUTPUT"/.test(scopeBlock))
/**
 * 🔴 `set -e` 가 있으면 diff 실패가 job 을 죽인다. 그건 fail-closed 가 아니라 fail-stop 이다.
 *    판정에 실패하면 **무거운 쪽으로 남아야** 한다.
 */
check('🔴 판정 step 에 set -e 가 없다 — 실패해도 heavy 로 남는다', !/set -e/.test(scopeBlock))
check('🔴 base 커밋을 읽을 수 있을 때만 판정한다', /git cat-file -e/.test(scopeBlock))
check('🔴 diff 를 낼 수 있게 fetch-depth: 0 이다', /fetch-depth: 0/.test(yml))

/**
 * 🔴 **영향 범위가 넓은 경로는 화면 전용으로 분류하지 않는다.**
 *    이들이 바뀌면 어느 fixture 가 깨질지 미리 말할 수 없다.
 */
check('🔴 허용 목록(ALLOW)이 판정 step 안에 있다', /^\s*ALLOW='/m.test(scopeBlock))
check('🔴 금지 목록(DENY)이 판정 step 안에 있다', /^\s*DENY='/m.test(scopeBlock))
check('🔴 허용과 금지를 둘 다 세어서 본다 — 허용만으로는 부족하다',
  /grep -cE "\$ALLOW"/.test(scopeBlock) && /grep -cE "\$DENY"/.test(scopeBlock))
/** 🔴 금지에 하나라도 걸리면 무겁다 — 개수가 0 일 때만 내려간다 */
check('🔴 금지에 걸린 것이 0 건일 때만 화면 전용으로 내려간다',
  /\[ "\$risky" = '0' \]/.test(scopeBlock))
for (const broad of ['src/lib', 'scripts', 'prisma', 'package-lock', 'tsconfig', '.github', 'docs']) {
  check(`🔴 ${broad} 는 허용 목록에 없다 (바뀌면 무거운 검사를 돌린다)`,
    !new RegExp(`ALLOW='[^']*\\^?\\(?[^']*${broad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(scopeBlock))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 무거운 fixture 가 경로 조건 뒤에 있다')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **실측값이다** (2026-09-15 · 로컬 61 개 스크립트 전량 계측).
 *    이 다섯이 174.2 초 중 152.6 초(88%)다. 나머지 56 개를 합쳐도 21.6 초다.
 *    숫자를 베껴 적은 것이 아니라, 줄이는 판단의 근거라 여기 남긴다.
 */
const HEAVY_STEPS: readonly { script: string; sec: number }[] = [
  { script: 'd10:prep-check', sec: 41.6 },
  { script: 'collect:lock-check', sec: 41.5 },
  { script: 'supply:process-check', sec: 39.4 },
  { script: 'collect:guard-lock-check', sec: 18.2 },
  { script: 'scale:foundation-check', sec: 11.9 },
]

const GATE = `steps.${SCOPE_ID}.outputs.heavy == 'true'`

/** 어떤 step 의 `run:` 이 그 스크립트를 부르는가 — 그 step 이 게이트를 갖는가 */
function stepIsGated(script: string): boolean {
  const runIdx = lines.findIndex((l) => new RegExp(`^        run: npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l))
  if (runIdx < 0) return false
  // 이 run 이 속한 step 의 머리(`- name:`)까지 거슬러 올라가 그 사이에 if 가 있는지 본다
  for (let i = runIdx; i >= 0; i -= 1) {
    if (/^      - (name|uses):/.test(lines[i] ?? '')) {
      return lines.slice(i, runIdx).some((l) => l.includes(GATE))
    }
  }
  return false
}

for (const h of HEAVY_STEPS) {
  check(`🔴 ${h.script} (${h.sec}초) 가 경로 조건 뒤에 있다`, stepIsGated(h.script))
}

/**
 * 🔴 **새로 생기는 형제도 잡는다.** 위 목록은 오늘 아는 것이고,
 *    같은 성격의 fixture 가 내일 추가되면 목록에 없어서 통과해 버린다.
 *    이름 규칙으로 한 겹 더 받친다 — 실제 프로세스를 띄우거나 준비 상태를 재는 것들이다.
 */
const HEAVY_NAME = /npm run (\S*(lock-check|prep-check|process-check|foundation-check))\s*$/
for (const l of lines) {
  const m = HEAVY_NAME.exec(l)
  if (m === null) continue
  const script = m[1] ?? ''
  check(`🔴 이름 규칙상 무거운 ${script} 도 경로 조건 뒤에 있다`, stepIsGated(script))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 무조건 실행 step 이 말없이 늘지 않는다')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **상한을 올리려면 재야 한다.** 이 숫자는 2026-09-15 정본의 실제 값이다.
 *    step 을 더할 때 길은 둘뿐이다 —
 *      ① 무거우면 `if: steps.scope.outputs.heavy` 뒤로 보낸다 (상한을 안 쓴다)
 *      ② 가벼우면 실제로 재고 이 숫자를 **손으로** 올린다
 *    "일단 올리고 나중에 본다" 를 막으려고 헤드룸을 두지 않는다.
 *
 * 🔴 64 → 66 (2026-09-16). 매거진 자동 PR 레인 게이트 2 개를 무조건 실행으로 더했다.
 *    실측: `magazine:auto-check` 142ms · `chatgpt:session-check` 110ms.
 *    둘 다 DB·네트워크·브라우저·write 가 없는 순수 판정이라 경로 조건 뒤로 보내지 않는다 —
 *    그 레인은 무인으로 articles.ts 를 고치고 PR 을 열고, **매거진 파일을 건드리지 않는
 *    PR 도 articles.ts 재고를 바꿔** 그 게이트를 깨뜨릴 수 있다.
 *    실제로 #524 merge 뒤 13 건이 깨졌는데 CI 에 없어 아무도 몰랐다.
 */
const MAX_UNCONDITIONAL_STEPS = 66

let total = 0
let gated = 0
for (let i = 0; i < lines.length; i += 1) {
  if (!/^      - (name|uses):/.test(lines[i] ?? '')) continue
  total += 1
  const end = lines.findIndex((l, j) => j > i && /^      - (name|uses):/.test(l))
  const block = lines.slice(i, end < 0 ? lines.length : end)
  if (block.some((l) => l.includes(GATE))) gated += 1
}
const unconditional = total - gated

console.log(`  step ${total} 개 · 경로 조건 뒤 ${gated} 개 · 무조건 ${unconditional} 개 (상한 ${MAX_UNCONDITIONAL_STEPS})`)
check(`🔴 무조건 실행 step 이 ${MAX_UNCONDITIONAL_STEPS} 개 이하다`,
  unconditional <= MAX_UNCONDITIONAL_STEPS)
check('🔴 경로 조건 뒤에 있는 step 이 실제로 있다 (게이트가 통째로 사라지지 않았다)',
  gated >= HEAVY_STEPS.length)

/**
 * 🔴 실패를 삼키는 길을 막는다 — persona-comment-engine-check 가 지키는 것과 같은 원칙이다.
 *    거기서는 `|| echo` 하나가 preflight 의 **모든** 실패를 초록으로 바꿨다.
 */
check('🔴 continue-on-error 가 없다', !/continue-on-error/.test(yml))

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 화면 전용 판정이 실제 경로에서 맞는다')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **패턴을 여기 다시 적지 않는다.** 워크플로우에서 그대로 꺼내 쓴다 —
 *    복사본은 반드시 원본과 어긋나고, 어긋난 순간 이 가드가 거짓말을 한다.
 *
 * 🔴 판정을 눈으로만 읽지 않는 이유: 2026-09-15 개발 중에 `grep -qv` 로 짠 첫 판이
 *    ugrep 에서는 "화면 전용", GNU grep 에서는 "무거움" 으로 갈렸다.
 *    그래서 지금은 **세어서 비교**하고, 그 판정을 표본으로 고정한다.
 */
const grab = (name: string): RegExp | null => {
  const line = lines.find((l) => new RegExp(`^\\s*${name}='`).test(l))
  if (line === undefined) return null
  const m = new RegExp(`${name}='([^']+)'`).exec(line)
  return m === null ? null : new RegExp(m[1] ?? '')
}
const ALLOW = grab('ALLOW')
const DENY = grab('DENY')
check('🔴 허용 패턴(ALLOW)을 워크플로우에서 읽어 올 수 있다', ALLOW !== null)
check('🔴 금지 패턴(DENY)을 워크플로우에서 읽어 올 수 있다', DENY !== null)

if (ALLOW !== null && DENY !== null) {
  /** 워크플로우의 계수 비교와 같은 규칙 — 전부 허용에 들고, 금지에 하나도 안 걸려야 화면 전용이다 */
  const isLight = (files: readonly string[]): boolean =>
    files.length > 0
    && files.every((f) => ALLOW.test(f))
    && !files.some((f) => DENY.test(f))

  const CASES: readonly { light: boolean; why: string; files: readonly string[] }[] = [
    // 🔴 문서 — 워크플로우는 뜨지만(위 ① 참조) 무거운 검사도 돈다.
    //    d10:prep-check 가 MASTER-OPERATING-SYSTEM.md 를, scale:foundation-check 가
    //    persona-pool-design.md 를 읽는다. 문서만 고쳤다고 건너뛰면 그 검사를 건너뛴다.
    { light: false, why: '운영 정본 문서', files: ['docs/operations/MASTER-OPERATING-SYSTEM.md'] },
    { light: false, why: '분기 목표 문서', files: ['docs/operations/CURRENT-MILESTONE.md'] },
    { light: false, why: '문서 여러 개', files: ['docs/operations/NORTH-STAR.md', 'README.md'] },

    // 🔴 서버·쓰기 경로 — src/app 아래에 있어도 화면이 아니다
    { light: false, why: 'API route', files: ['src/app/api/example/route.ts'] },
    { light: false, why: '업로드 API', files: ['src/app/api/uploads/route.ts'] },
    { light: false, why: '인증 API', files: ['src/app/api/auth/[...nextauth]/route.ts'] },
    { light: false, why: '어드민 업로드 API', files: ['src/app/api/admin/hero-banners/upload/route.ts'] },
    { light: false, why: 'server action', files: ['src/app/dashboard/actions.ts'] },
    { light: false, why: 'server action (lib)', files: ['src/lib/actions/reports.ts'] },
    { light: false, why: '어드민 화면(use server 포함)', files: ['src/app/admin/(ops)/members/[id]/page.tsx'] },
    { light: false, why: '어드민 컴포넌트(use server 포함)', files: ['src/components/admin/ReportCard.tsx'] },
    { light: false, why: 'middleware', files: ['src/middleware.ts'] },
    /** 🔴 ALLOW 안에 있으면서 route.ts / middleware.ts 만이 잡는 자리 */
    { light: false, why: 'api 밖의 route.ts (route.ts 만 잡는다)', files: ['src/app/feed/route.ts'] },
    { light: false, why: 'app 안의 middleware (middleware.ts 만 잡는다)', files: ['src/app/middleware.ts'] },

    /**
     * 🔴 **DENY 의 각 항목을 하나씩 고립시켜 본다.**
     *    위 케이스들은 `api/` 와 `route.ts` 가 겹쳐 잡는다 — 그래서 `api` 를 빼도
     *    표본이 전부 통과했다(2026-09-15 음성 테스트 ⑬에서 실제로 새어 나갔다).
     *    항목마다 **그것만이 잡는** 경로를 둔다. 하나를 빼면 여기서 빨갛게 뜬다.
     */
    { light: false, why: 'api 하위 비-route 파일 (api/ 만 잡는다)', files: ['src/app/api/shared/helper.ts'] },
    { light: false, why: '어드민 화면 (admin/ 만 잡는다)', files: ['src/app/admin/settings/page.tsx'] },
    { light: false, why: '인증 화면 (auth/ 만 잡는다)', files: ['src/app/auth/callback/page.tsx'] },
    { light: false, why: '업로드 화면 (upload/ 만 잡는다)', files: ['src/app/uploads/preview.tsx'] },
    { light: false, why: 'actions 디렉터리 (actions/ 만 잡는다)', files: ['src/app/x/actions/save.tsx'] },

    // 🟢 진짜 화면만
    { light: true, why: '일반 화면 컴포넌트', files: ['src/components/post/PostCard.tsx'] },
    { light: true, why: '일반 페이지', files: ['src/app/page.tsx'] },
    { light: true, why: '화면 여러 개', files: ['src/app/page.tsx', 'src/components/ui/Button.tsx'] },
    { light: true, why: '스타일', files: ['src/styles/x.css'] },
    { light: true, why: '정적 자산', files: ['public/og.png'] },
    { light: true, why: '매거진 콘텐츠', files: ['src/content/magazine/articles.ts'] },

    // 🔴 섞이면 무겁다 — 화면 파일이 같이 있다고 가벼워지지 않는다
    { light: false, why: '화면 + API 혼합', files: ['src/app/page.tsx', 'src/app/api/example/route.ts'] },
    { light: false, why: '화면 + server action 혼합', files: ['src/components/ui/Button.tsx', 'src/lib/actions/scraps.ts'] },
    { light: false, why: '화면 + 문서 혼합', files: ['src/app/page.tsx', 'docs/operations/CURRENT-MILESTONE.md'] },
    { light: false, why: '화면 + 공용 lib', files: ['src/app/page.tsx', 'src/lib/collect-schedule.ts'] },

    // 🔴 영향 범위가 넓은 것들
    { light: false, why: '의존성 잠금', files: ['package-lock.json'] },
    { light: false, why: 'DB 스키마', files: ['prisma/schema.prisma'] },
    { light: false, why: '타입 설정', files: ['tsconfig.json'] },
    { light: false, why: '워크플로우 자신', files: ['.github/workflows/visibility-guard.yml'] },
    { light: false, why: 'fixture 자신', files: ['scripts/workflow-budget-check.mts'] },

    // 🔴 빈 목록은 화면 전용이 아니다 — 모르면 돌린다
    { light: false, why: '빈 목록', files: [] },
  ]
  for (const c of CASES) {
    check(`🔴 [${c.light ? '화면전용' : '무거움'}] ${c.why} — ${c.files.join(' · ') || '(없음)'}`,
      isLight(c.files) === c.light)
  }

  /**
   * 🔴 **DENY 가 통째로 사라지지 않았는지** 따로 본다.
   *    위 표본이 전부 통과해도 DENY 가 빈 패턴이면 의미가 없다.
   */
  check('🔴 DENY 가 실제로 서버 경로를 잡는다',
    DENY.test('src/app/api/x/route.ts') && DENY.test('src/lib/actions/y.ts'))
  check('🔴 DENY 가 평범한 화면 파일을 잡지 않는다',
    !DENY.test('src/app/page.tsx') && !DENY.test('src/components/post/PostCard.tsx'))
}

// ─────────────────────────────────────────────────────────
console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} PASS · ${failN} FAIL\n`)
process.exit(failN === 0 ? 0 : 1)
