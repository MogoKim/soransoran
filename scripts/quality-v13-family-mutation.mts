#!/usr/bin/env tsx
/**
 * quality-v13 가족 주장 변이 검사 (2026-10-20)
 *
 *   운영 D5 결함(P16 · `2살 아이 보험… 아이 거니까…`)을 고친 두 축을 **소스를 일부러 되돌린 사본**에서 증명한다:
 *     ① 숫자 나이(0~18살)를 정본 나이대로 읽는다 — 이 해석을 빼면 회귀 케이스가 실패로 드러나야 한다
 *     ② 물음표 · 묻는 어미가 1인칭 소유를 지우지 못한다 — 우회를 다시 넣으면 실패로 드러나야 한다
 *   그 밖에 과차단을 막는 보수 장치(경계 나이 · 회상 · 수식형 · 임자 판정)도 같은 방법으로 증명한다.
 *
 *   🔴 **문법 · 로드 오류는 잡힌 변이로 세지 않는다.** 변이 사본의 러너가 케이스를 실제로 돌려 `FAMILY_RESULT` 를 내고,
 *      그 결과에 **기대한 케이스의 실패**가 들어 있을 때만 DETECTED 다. 러너가 죽었거나 결과가 없으면 INVALID(검사 실패)다.
 *   🔴 변이는 **임시 사본**에만 적용한다 — 작업 트리의 소스는 건드리지 않는다(원복할 것이 없다).
 *   🔴 변이 지점 문자열이 사본에 정확히 한 번 없으면 검사가 실패한다(고친 소스를 따라가지 못한 죽은 변이를 막는다).
 *   🔴 DB 0 · 네트워크 0 · provider 0 · LLM 0.
 *
 *   npm 스크립트에는 아직 연결하지 않았다(이 변경의 범위에서 package.json 은 건드리지 않는다) — `tsx scripts/quality-v13-family-mutation.mts`.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MARK = 'FAMILY_RESULT '

// ═══════════════════════════════════════════════════════════
// 러너 모드 — 사본 안에서 돌아 케이스 실패 목록을 한 줄 JSON 으로 낸다
// ═══════════════════════════════════════════════════════════
if (process.argv.includes('--runner')) {
  const { failingFamilyResults, FAMILY_CASES } = await import('./lib/family-claim-cases.mjs')
  console.log(`${MARK}${JSON.stringify({ total: FAMILY_CASES.length, failing: failingFamilyResults().map((r) => `${r.id}/${r.plan}`) })}`)
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════
// 변이 목록 — 파일 · 되돌릴 지점(from → to) · 이 변이가 드러내야 할 케이스 id (하나라도 실패하면 DETECTED)
// ═══════════════════════════════════════════════════════════
type Mutation = { id: string; why: string; file: string; from: string; to: string; mustFail: readonly string[] }
const FS = 'src/lib/content-core/family-specifics.ts'
const GATE = 'src/lib/content-core/draft-life-gates.ts'

const MUTATIONS: readonly Mutation[] = [
  // ── ① 숫자 나이 해석 ──
  { id: 'M1', why: '숫자 나이 해석을 통째로 뺀다(v12 로 되돌림)', file: FS,
    from: '  bands.push(...readAgeMentions(text))\n', to: '',
    mustFail: ['p16-exact', 'p16-declarative', 'p16-months', 'p16-native-number', 'p02-numeric-teen'] },
  { id: 'M2', why: '0~5살을 성인으로 읽는다(모호한 말에서 성인 추측)', file: FS,
    from: "if (age <= 5) return ['영유아']", to: "if (age <= 5) return ['성인']",
    mustFail: ['p16-exact', 'p16-declarative'] },
  { id: 'M3', why: '경계 나이(6~7살)가 이웃 나이대 하나만 가리킨다', file: FS,
    from: "if (age <= 7) return ['영유아', '초등']", to: "if (age <= 7) return ['영유아']",
    mustFail: ['p02-boundary-7'] },
  { id: 'M4', why: '카드 대조가 가리킬 수 있는 나이대 중 첫째만 본다', file: FS,
    from: 'return b.anyOf.some((x) => cardBands.includes(x))', to: 'return cardBands.includes(b.anyOf[0]!)',
    mustFail: ['p02-boundary-7'] },
  { id: 'M5', why: '지난 때를 돌아보는 말(`2살 때`)도 지금 나이로 센다', file: FS,
    from: 'if (AGE_GAP_TAIL.test(tail) || (afterKid && AGE_RECALL_TAIL.test(tail))) continue', to: 'if (AGE_GAP_TAIL.test(tail)) continue',
    mustFail: ['recall-adult-child'] },
  // ── ② 물음표 우회 ──
  { id: 'M6', why: '묻는 어미가 1인칭을 다시 지운다(`askOk` 무시) — 문장 끝 우회 재도입', file: GATE,
    from: '(o.askOk !== true && QUESTION_END_RE.test(last.clause))', to: 'QUESTION_END_RE.test(last.clause)',
    mustFail: ['p16-question-ending', 'p16-explicit-question', 'p16-predicative-question'] },
  { id: 'M7', why: '물음표를 걷지 않는다(`?` 문장이 통째로 세상 이야기로 돌아간다) — 물음표 우회 재도입', file: GATE,
    from: "const unask = (t: string): string => t.replace(/[?？]/g, '.')", to: 'const unask = (t: string): string => t',
    mustFail: ['p16-question-ending', 'p16-explicit-question', 'p16-predicative-question'] },
  { id: 'M8', why: '묻는 어미 절의 명시적 자기 자녀 행동을 다시 건너뛴다(절 단위 우회)', file: GATE,
    from: "(QUESTION_END_RE.test(c) && k.owner !== 'explicit')", to: 'QUESTION_END_RE.test(c)',
    mustFail: ['p02-question-clause-money'] },
  { id: 'M9', why: '소유 표지(`아이 거니까` · `우리 아이`)를 읽지 않는다', file: FS,
    from: '  if (hits.length === 0) return null\n', to: '  return null\n',
    mustFail: ['p16-exact', 'p16-question-ending', 'p16-ellipsis-body'] },
  { id: 'M10', why: '서술 어미 없는 말줄임 토막을 건너뛴다(`fragmentOk` 무시)', file: GATE,
    from: 'if (o.fragmentOk !== true && !isPredicate(c)) return false', to: 'if (!isPredicate(c)) return false',
    mustFail: ['p16-ellipsis-body', 'p16-ellipsis-title'] },
  // ── 과차단 방지 장치 ──
  { id: 'M11', why: '수식형 숫자 나이(`1살 아기`)를 자기 가족 증거 없이도 자기 일로 센다', file: GATE,
    from: "if (shape === 'attributive') return owned && asked()", to: "if (shape === 'attributive') return asked()",
    mustFail: ['grandchild-attributive', 'general-question'] },
  { id: 'M12', why: '앞에 남이 선 말(`친구 아이가`)을 거르지 않는다', file: GATE,
    from: 'if (prev !== undefined && otherIn(prev, counterpart) && bareOrSubject(prev)) return false', to: '',
    mustFail: ['third-person-beside-own'] },
]

// ═══════════════════════════════════════════════════════════
// 사본 · 실행
// ═══════════════════════════════════════════════════════════
const ROOT = process.cwd()
const THIS = 'scripts/quality-v13-family-mutation.mts'
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'q13-family-mut-'))
try {
  for (const rel of ['src/lib', 'scripts/lib']) cpSync(join(ROOT, rel), join(tmp, rel), { recursive: true })
  mkdirSync(join(tmp, 'scripts'), { recursive: true })
  cpSync(join(ROOT, THIS), join(tmp, THIS))
  mkdirSync(join(tmp, 'docs/operations'), { recursive: true })
  cpSync(join(ROOT, POOL_DOC), join(tmp, POOL_DOC))
  for (const f of ['package.json', 'tsconfig.json']) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(tmp, f))
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'))

  const TSX = join(ROOT, 'node_modules/.bin/tsx')
  type Run = { ok: true; total: number; failing: string[] } | { ok: false; why: string }
  const run = (): Run => {
    const r = spawnSync(TSX, [THIS, '--runner'], { cwd: tmp, encoding: 'utf8', timeout: 120_000 })
    const line = r.stdout.split('\n').find((l) => l.startsWith(MARK))
    if (r.status !== 0 || line === undefined) return { ok: false, why: `exit ${r.status} · ${(r.stderr || r.stdout).split('\n').filter((l) => l.trim() !== '').slice(0, 2).join(' | ').slice(0, 200)}` }
    const j = JSON.parse(line.slice(MARK.length)) as { total: number; failing: string[] }
    return { ok: true, total: j.total, failing: j.failing }
  }

  console.log('\n══ quality-v13 가족 주장 변이 ══\n')
  console.log('── 기준선(변이 없음) — 사본의 러너가 케이스를 실제로 돌려 전부 기대대로여야 한다 ──')
  const base = run()
  check('기준선 러너가 케이스를 돌렸다', base.ok, base.ok ? '' : base.why)
  if (!base.ok) { console.log('\n🔴 기준선이 돌지 않으면 변이를 판정할 수 없다'); process.exit(1) }
  check(`기준선 — 케이스 ${base.total}개 전부 기대대로(실패 0)`, base.total > 0 && base.failing.length === 0, base.failing.join(', '))

  console.log('\n── 변이 — 각 변이는 기대한 케이스를 실패로 드러내야 한다(러너가 죽은 것은 잡힌 것이 아니다) ──')
  for (const m of MUTATIONS) {
    const path = join(tmp, m.file)
    const original = readFileSync(path, 'utf8')
    const hits = original.split(m.from).length - 1
    if (hits !== 1) { check(`${m.id} 변이 지점이 사본에 정확히 한 번 있다 (${m.why})`, false, `${hits}곳`); continue }
    writeFileSync(path, original.replace(m.from, () => m.to))
    const r = run()
    writeFileSync(path, original)
    if (!r.ok) { check(`${m.id} ${m.why}`, false, `INVALID — 러너가 돌지 못했다(문법·로드 오류는 변이를 잡은 것이 아니다): ${r.why}`); continue }
    const failedIds = new Set(r.failing.map((x) => x.split('/')[0]!))
    const missed = m.mustFail.filter((id) => !failedIds.has(id))
    check(`${m.id} ${m.why} → ${[...failedIds].length}개 케이스 실패로 드러남`, r.failing.length > 0 && missed.length === 0,
      r.failing.length === 0 ? 'SURVIVED — 어떤 케이스도 실패하지 않았다' : `기대한 실패가 빠졌다: ${missed.join(', ')}`)
  }
  const after = run()
  check('변이를 모두 원복한 사본이 다시 기준선과 같다', after.ok && after.failing.length === 0, after.ok ? after.failing.join(', ') : after.why)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n══ quality-v13 가족 주장 변이 결과 ══\n  통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
