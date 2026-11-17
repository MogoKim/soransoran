#!/usr/bin/env tsx
/**
 * 홈 갱년기톡 최소 배분 — 변이 하네스 (죽은 시험 금지)
 *
 * 원본 popularity.ts · home-exposure-rules.ts 를 **임시 디렉터리**에 복사해 한 곳씩 망가뜨리고,
 * scripts/lib/home-popularity-cases.mts 의 사례가 **하나 이상 실패**하는지 본다. 실패가 없으면 그 시험은 죽은 것이다.
 * home-popular-views.ts 는 문자열 변이 → loaderProblems 가 문제를 내야 한다.
 *
 * 🔴 repo 파일에 쓰지 않는다. 임시 디렉터리만 쓰고 끝나면 지운다.
 * 🔴 바꿀 문자열(needle)이 원본에 없으면 그 자체로 FAIL 이다 — "변이 지점 0곳" 은 아무것도 시험하지 않는다.
 *    원본 문구를 고치면 여기 needle 도 같이 고친다.
 * 🔴 먼저 무변이 원본으로 사례 실패 0 을 확인한다 — 원본이 이미 실패하면 변이 판정이 무의미하다.
 *
 * 사용법: npm run check:home-popularity-mutation
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loaderProblems, runQuotaCases, type QuotaModule } from './lib/home-popularity-cases.mjs'

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const POP = 'src/lib/popularity.ts'
const RULES = 'src/lib/home-exposure-rules.ts'
const VIEWS = 'src/lib/home-popular-views.ts'
const original = { [POP]: read(POP), [RULES]: read(RULES) } as Record<string, string>

type Mutation = { id: string; file: string; needle: string; replace: string; catches: string }
const MUTATIONS: Mutation[] = [
  { id: 'M1', file: POP, catches: 'T-P1 · T-P2 · T-P15',
    needle: 'return now.getTime() - post.createdAt.getTime() <= freshHours * HOUR_MS', replace: 'return true' },
  { id: 'M2', file: POP, catches: 'T-P4',
    needle: '<= freshHours * HOUR_MS', replace: '< freshHours * HOUR_MS' },
  { id: 'M3', file: POP, catches: 'T-P6',
    needle: 'Math.trunc(minimum) - pinnedGuaranteed', replace: 'Math.trunc(minimum) - 0' },
  { id: 'M4', file: POP, catches: 'T-P3',
    needle: 'for (let i = chosen.length - 1; i >= 0 && have < need && waiting.length > 0; i -= 1) {',
    replace: 'for (let i = 0; i < chosen.length && have < need && waiting.length > 0; i += 1) {' },
  { id: 'M5', file: POP, catches: 'T-P15(자동부 점수순)',
    needle: 'return chosen.sort(byScore).map((e) => e.post)', replace: 'return chosen.map((e) => e.post)' },
  { id: 'M6', file: POP, catches: 'T-P12',
    needle: 'b.post.createdAt.getTime() - a.post.createdAt.getTime() ||\n    (a.post.id < b.post.id ? 1 : a.post.id > b.post.id ? -1 : 0)',
    replace: 'b.post.createdAt.getTime() - a.post.createdAt.getTime()' },
  { id: 'M7', file: RULES, catches: 'T-P13',
    needle: 'a.createdAt.getTime() - b.createdAt.getTime() ||\n    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)', replace: '0' },
  { id: 'M8', file: RULES, catches: 'T-P16',
    needle: 'if (!allowed.has(post.id) || seen.has(post.id)) continue', replace: 'if (seen.has(post.id)) continue' },
  { id: 'M9', file: POP, catches: 'T-P1 · T-P2',
    needle: "if (unusedStale > 0 && unusedFresh === 0 && autoFree > 0) reasons.push('fresh-short')", replace: '' },
  { id: 'M10', file: POP, catches: 'T-P7',
    needle: "if (pinnedM + slots < minimum) reasons.push('slots-short')", replace: '' },
  { id: 'M11', file: POP, catches: 'T-P3 · T-P15',
    needle: '.filter((e) => isGuaranteed(e) && isWithinFreshWindow(e.post, freshHours, now))',
    replace: '.filter((e) => isWithinFreshWindow(e.post, freshHours, now))' },
]
const STRING_MUTATIONS = [
  { id: 'M12', catches: 'loaderProblems(가입인사 제외 2곳)', needle: '        AND: [EXCLUDE_GREETING],\n', replace: '' },
  { id: 'M13', catches: 'loaderProblems(id 2차 키)', needle: "orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]", replace: "orderBy: { createdAt: 'desc' }" },
]

let pass = 0
let fail = 0
const report = (ok: boolean, line: string) => {
  console.log(`  ${ok ? '✅' : '🔴'} ${line}`)
  ok ? (pass += 1) : (fail += 1)
}

async function loadFrom(files: Record<string, string>): Promise<QuotaModule> {
  const dir = mkdtempSync(join(tmpdir(), 'home-pop-mut-'))
  try {
    writeFileSync(join(dir, 'popularity.ts'), files[POP])
    writeFileSync(join(dir, 'home-exposure-rules.ts'), files[RULES])
    const stamp = `?t=${Date.now()}-${Math.random()}`
    const pop = await import(pathToFileURL(join(dir, 'popularity.ts')).href + stamp)
    const rules = await import(pathToFileURL(join(dir, 'home-exposure-rules.ts')).href + stamp)
    return { ...pop, ...rules } as QuotaModule
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  console.log('\n① 무변이 원본 — 사례 실패 0 이어야 변이 판정이 의미가 있다')
  const base = runQuotaCases(await loadFrom(original))
  report(base.length === 0, `원본 사례 실패 ${base.length}${base.length ? ` (${base.join(' · ')})` : ''}`)
  const views = read(VIEWS)
  report(loaderProblems(views).length === 0, `원본 로더 문제 ${loaderProblems(views).length}`)

  console.log('\n② 함수 변이 — 사례가 하나 이상 실패해야 한다')
  for (const m of MUTATIONS) {
    const src = original[m.file]
    if (!src.includes(m.needle)) {
      report(false, `${m.id} 적재 실패 — needle 이 ${m.file} 에 없다(원본 문구가 바뀌었다)`)
      continue
    }
    const failures = runQuotaCases(await loadFrom({ ...original, [m.file]: src.replace(m.needle, m.replace) }))
    report(failures.length > 0, `${m.id} (${m.catches}) → 실패 ${failures.length}${failures.length ? ` · 예: ${failures[0]}` : ' — 🔴 아무 시험도 잡지 못했다'}`)
  }

  console.log('\n③ 로더 문자열 변이 — loaderProblems 가 문제를 내야 한다')
  for (const m of STRING_MUTATIONS) {
    if (!views.includes(m.needle)) {
      report(false, `${m.id} 적재 실패 — needle 이 ${VIEWS} 에 없다`)
      continue
    }
    const problems = loaderProblems(views.replace(m.needle, m.replace))
    report(problems.length > 0, `${m.id} (${m.catches}) → 문제 ${problems.length}${problems.length ? ` · ${problems[0]}` : ''}`)
  }

  console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
