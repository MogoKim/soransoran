#!/usr/bin/env tsx
/**
 * 🔴 **재선정 권위 단일화 검사 — retry-authority-v7** (2026-11-10 · P0-1)
 *
 *   npm run check:retry-authority      이 검사 + 변이 하네스
 *
 * 무엇을 고정하는가
 *   ① 단일 권위 — 원인 전수 표 · artifact 판독 · 옛 심볼(`RETRYABLE_CAUSES` · `artifactRetryable`) 운영 소비처 0 (ratchet)
 *   ② 의존 방향 — `review.ts` ← `generation-failure.ts`(타입만) ← 소비자 · 정적 순환 0
 *   ③ 지문 — 근거 지문(evidence · 계약 · 정책판)과 실패 지문(+ 원인 · 마지막 요청 결과)의 결정성 · 변화 규칙
 *   ④ transient 상한 — 같은 근거 지문당 회차를 넘어 한 번(원인이 바뀌어도 초기화되지 않는다)
 *   ⑤ 선택 자리 표 — 상태 × 단계 × 처리 → fresh · retry · excluded (채택 candidate 는 유료 재생성 lane 이 아니다)
 *   ⑥ 재선정 몫 — floor(상한 × 10%) · 상한 10 미만 0 · `freshOnly` 0 · 축소 운영 선택
 *   ⑦ 11-09·11-10 비식별 재생(12회차) — 옛 결과 대 v7: 결론 재선정 0 · 신규 굶김 0 · transient 지문당 1 · 재선정 ≤ 10%
 *   ⑧ 비용 귀속 — 통합 장부 현행 칸(sourceKey · runId · settledUsd)으로 opportunity · attempt · 원인에 붙인다 · 확정 회피 비용
 *
 * 🔴 DB 0 · 네트워크 0 · provider 0 · 운영 파일 0. fixture 는 불투명 라벨뿐이다(원문 · id · 해시 · 닉네임 없음).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import ts from 'typescript'

import {
  CROSS_RUN_TRANSIENT_RETRY_MAX, RETRY_CLASSES, RETRY_MODES, RETRY_POLICY_VERSION, RETRY_SHARE_MAX,
  completionRetryClass, evidenceFingerprintOf, failureFingerprintOf, generationAttemptKeyOf, retryClassOf, retryModeFor,
  isSpeakerSetKey, retrySlotsFor, speakerRemedyOf, speakerSetKeyOf, SPEAKER_SET_KEY_RE,
  type CallOutcome, type RetryClass,
} from '../src/lib/content-core/generation-failure'
import { INCOMPLETE_CAUSES, type IncompleteCause } from '../src/lib/content-core/review'
import { ARTIFACT_VERSION } from '../src/lib/content-core/artifact'
import { CONTENT_CORE_STAGES, generationIdentity, type GenerationContract } from '../src/lib/content-core/pipeline'
import {
  artifactOutcome, artifactRecordOutcome, artifactRetryClassOf, concludedSourceKeys, latestOutcomes, OUTCOME_STATES, selectionLaneOf, speakerSetAlreadyFailed,
  REPLAN_ATTEMPT_MAX, unfinishedAttemptsBySource, type PriorArtifactRow, type PriorOutcome,
} from '../src/lib/supply-workset'
import { retryCostAttributionOf, type RetryAttempt } from '../src/lib/ready-fate'
import { tallyRetryClasses } from '../src/lib/d100-supply-funnel'
import { personasForAttempt } from './lib/replan-personas.mjs'
import type { LedgerEntry } from '../src/lib/llm-ledger'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/**
 * 🔴 **AST 판독** — 정규식이 아니라 TypeScript 구문 트리로 본다(주석 · 여러 줄 · 다른 import 를 건너 잡는 오탐 0).
 *    `import type {…}` · 지정자가 전부 `type` 인 import 는 런타임 의존이 아니다. `export {…} from` 도 런타임 의존이다.
 */
const sourceOf = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function importsOf(file: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = []
  for (const st of sourceOf(file).statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause
      const named = c?.namedBindings !== undefined && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : []
      const typeOnly = c !== undefined && (c.isTypeOnly
        || (c.name === undefined && named.length > 0 && named.every((e) => e.isTypeOnly)))
      out.push({ spec: st.moduleSpecifier.text, typeOnly })
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier !== undefined && ts.isStringLiteral(st.moduleSpecifier)) {
      out.push({ spec: st.moduleSpecifier.text, typeOnly: st.isTypeOnly })
    }
  }
  return out
}
/** 🔴 `satisfies readonly IncompleteCause[]` 로 선언한 상수 이름 — 원인 목록 상수의 전수 */
function causeListConsts(file: string): string[] {
  const out: string[] = []
  for (const st of sourceOf(file).statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      const init = d.initializer
      if (init !== undefined && ts.isSatisfiesExpression(init) && /IncompleteCause\[\]/.test(init.type.getText())
        && ts.isIdentifier(d.name)) out.push(d.name.text)
    }
  }
  return out
}

console.log('\n══ 재선정 권위 단일화 (retry-authority-v7) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① 단일 권위 — 원인 전수 표 · 옛 심볼 운영 소비처 0')
// ─────────────────────────────────────────────────────────
const WANT: Readonly<Record<IncompleteCause, RetryClass>> = {
  budgetBlocked: 'unattempted', noResponse: 'transient', truncated: 'transient',
  usageUnknown: 'terminal', parseFailed: 'terminal', speakerSlotNarrowed: 'speakerBound', personaTransformFailed: 'speakerBound',
  loadBearingMismatch: 'speakerBound', loadBearingSelfImpossible: 'speakerBound', contextInsufficient: 'terminal',
  evidenceBudgetViolated: 'terminal', speakerUnqualified: 'terminal', voiceUnready: 'terminal', wiringBroken: 'terminal',
  deterministicFailed: 'terminal', meaningUnpreservable: 'terminal',
}
check('원인 전수 — 모든 미완주 원인이 정확히 한 처리로 간다',
  INCOMPLETE_CAUSES.length === Object.keys(WANT).length && INCOMPLETE_CAUSES.every((c) => retryClassOf(c, null) === WANT[c]),
  INCOMPLETE_CAUSES.filter((c) => retryClassOf(c, null) !== WANT[c]).join(','))
check('transient 는 답을 받지 못한 것뿐 — noResponse · truncated', INCOMPLETE_CAUSES.filter((c) => WANT[c] === 'transient').join(',') === 'noResponse,truncated')
check('무응답이라도 제공사가 요청 모양을 거절했으면(providerPermanent) 결론',
  retryClassOf('noResponse', 'providerPermanent') === 'terminal'
  && (['timeout', 'providerTransient', null] as (CallOutcome | null)[]).every((l) => retryClassOf('noResponse', l) === 'transient'))
check('완주(ADOPT·HOLD·DROP)는 결론', completionRetryClass({ complete: true, cause: null }, 'ok') === 'terminal')
check('artifact 판독도 같은 값 — 모양을 못 읽으면 null(unknown)',
  artifactRetryClassOf({ machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'notRun', cause: 'speakerSlotNarrowed' } }, undefined) === 'speakerBound'
  && artifactRetryClassOf({ machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'notRun', cause: 'parseFailed' } }, undefined) === 'terminal'
  && artifactRetryClassOf({ machineOutcome: 'hold' }, undefined) === null)
check('처리 이름은 넷 — transient · speakerBound · terminal · unattempted', RETRY_CLASSES.join(',') === 'transient,speakerBound,terminal,unattempted')
check('🔴 Persona 부적격 중 그 화자 묶음 탓 4종만 speakerBound — 전체 후보 자격 없음 · 뜻 보존 불가는 결론',
  INCOMPLETE_CAUSES.filter((c) => WANT[c] === 'speakerBound').join(',') === 'speakerSlotNarrowed,personaTransformFailed,loadBearingMismatch,loadBearingSelfImpossible'
  && WANT.speakerUnqualified === 'terminal' && WANT.meaningUnpreservable === 'terminal')
{
  /**
   * 🔴 **AST 식별자 ratchet** — 주석 속 역사 언급은 세지 않고, 코드의 식별자(선언 · import · 참조)만 센다.
   *    앞판은 `git grep -E '\\b…\\b'` 였는데 POSIX ERE 는 `\\b` 를 모른다 — 아무것도 잡지 못하는 죽은 ratchet 이었다.
   *    대상: 추적 · 미추적 src · scripts 의 .ts · .mts 전부.
   */
  const ls = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src', 'scripts'], { encoding: 'utf-8' })
  if (ls.status !== 0) throw new Error(`git ls-files 판독 실패 — exit ${String(ls.status)}`)
  const files = (ls.stdout ?? '').split('\n').filter((f) => /\.(ts|mts)$/.test(f))
  const OLD = new Set(['RETRYABLE_CAUSES', 'artifactRetryable'])
  const out: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf-8')
    if (!/RETRYABLE_CAUSES|artifactRetryable/.test(text)) continue
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && OLD.has(n.text)) out.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}:${n.text}`)
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  check('ratchet 대상 파일을 실제로 읽었다(판독기 생존)', files.length > 500, `${files.length}`)
  check('🔴 ratchet(AST) — 옛 심볼 `RETRYABLE_CAUSES` · `artifactRetryable` 의 코드 식별자 0 (주석 속 역사 언급은 세지 않는다)', out.length === 0, out.slice(0, 3).join(' | '))
}
{
  const ws = readFileSync('src/lib/supply-workset.ts', 'utf-8')
  const review = readFileSync('src/lib/content-core/review.ts', 'utf-8')
  check('🔴 ratchet — `review.ts` 가 재선정 판정을 갖지 않는다(원인 목록 · includes 판정 0)',
    !/includes\(c\.cause/.test(review) && !/export function artifact\w*\(/.test(review))
  check('🔴 ratchet — 지난 artifact 행은 `retryClass` 하나만 나른다(옛 `retryable` 불리언 칸 0)',
    /retryClass: RetryClass \| null/.test(ws) && !/^\s+retryable: boolean \| null/m.test(ws))
  // 🔴 원인 목록 상수는 회차 안 재계획의 화자 탓 목록(`PERSONA_REPLAN_CAUSES`) 하나뿐이다 — 재선정 판정 목록이 아니다(AST 전수).
  //    지난 artifact 의 상태는 `a.retryClass`(단일 권위 값)로만 정한다.
  const wsLists = causeListConsts('src/lib/supply-workset.ts')
  const reviewLists = causeListConsts('src/lib/content-core/review.ts')
  check('🔴 ratchet(AST) — supply-workset 의 원인 목록 상수는 화자 탓 목록 하나뿐 · 재선정 상태는 단일 권위 값으로만 정한다',
    wsLists.join(',') === 'PERSONA_REPLAN_CAUSES'
    && /a\.retryClass === 'terminal' \? 'terminal' : 'retryable'/.test(ws), wsLists.join(','))
  check('🔴 ratchet(AST) — review.ts 의 원인 목록은 형식 판독용뿐 · 재시도 목록 0',
    !reviewLists.some((n) => /RETRY/i.test(n)) && reviewLists.every((n) => ['NOT_RUN_CAUSES'].includes(n)), reviewLists.join(','))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 의존 방향 — 정적 순환 0')
// ─────────────────────────────────────────────────────────
{
  const runtimeImports = (file: string): string[] => importsOf(file).filter((i) => !i.typeOnly && i.spec.startsWith('.')).map((i) => i.spec)
  const gf = readFileSync('src/lib/content-core/generation-failure.ts', 'utf-8')
  const gfImports = importsOf('src/lib/content-core/generation-failure.ts')
  check('🔴 generation-failure 는 review 를 타입으로만 import 한다(AST)',
    gfImports.some((i) => i.spec === './review' && i.typeOnly) && !gfImports.some((i) => i.spec === './review' && !i.typeOnly)
    && gfImports.filter((i) => !i.typeOnly).every((i) => i.spec.startsWith('node:')), JSON.stringify(gfImports))
  check('🔴 review 는 generation-failure 를 import 하지 않는다(AST · 타입 포함)',
    !importsOf('src/lib/content-core/review.ts').some((i) => i.spec === './generation-failure'))
  void gf
  // 런타임 그래프 — content-core 전체 + 이번 소비자. 순환이 있으면 FAIL
  const resolve = (from: string, rel: string): string | null => {
    const base = `${from.replace(/\/[^/]+$/, '')}/${rel}`.split('/').reduce<string[]>((acc, p) => {
      if (p === '..') acc.pop(); else if (p !== '.') acc.push(p)
      return acc
    }, []).join('/')
    for (const cand of [`${base}.ts`, `${base}/index.ts`]) { try { readFileSync(cand); return cand } catch { /* 다음 */ } }
    return null
  }
  const roots = [
    'src/lib/content-core/generation-failure.ts', 'src/lib/content-core/review.ts', 'src/lib/supply-workset.ts',
    'src/lib/ready-fate.ts', 'src/lib/d100-supply-funnel.ts', 'src/lib/micro-seed-auto-draft.ts',
  ]
  const graph = new Map<string, string[]>()
  const stack = [...roots]
  while (stack.length > 0) {
    const f = stack.pop()!
    if (graph.has(f)) continue
    const deps = runtimeImports(f).map((r) => resolve(f, r)).filter((x): x is string => x !== null && x.startsWith('src/lib/'))
    graph.set(f, deps)
    stack.push(...deps)
  }
  const reachesBack = (start: string): boolean => {
    const seen = new Set<string>()
    const go = (f: string): boolean => (graph.get(f) ?? []).some((d) => d === start || (!seen.has(d) && (seen.add(d), go(d))))
    return go(start)
  }
  check('🔴 generation-failure · review 를 지나는 런타임 순환 0',
    !reachesBack('src/lib/content-core/generation-failure.ts') && !reachesBack('src/lib/content-core/review.ts'),
    `${graph.size} 파일 그래프`)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 지문 — 결정성 · 변화 규칙 · 원문 없음')
// ─────────────────────────────────────────────────────────
const CONTRACT = (o: Partial<GenerationContract> = {}): GenerationContract => ({
  sourceInputHash: 'h1', pipelineVersion: 'pv', promptVersion: 'pr', speakerPlanVersion: 'sp', reviewVersion: 'rv',
  planPromptDigest: 'pd', stageModels: Object.fromEntries(CONTENT_CORE_STAGES.map((s) => [s, 'm'])) as GenerationContract['stageModels'],
  stageMaxOutputLabel: 'mx', voiceAssetDigest: 'va', personaPoolDigest: 'pp', ...o,
})
{
  const ev = (c: GenerationContract, av = ARTIFACT_VERSION): string => evidenceFingerprintOf({ artifactVersion: av, contractIdentity: generationIdentity(c) })
  const e0 = ev(CONTRACT())
  check('근거 지문은 결정적이다(같은 입력 → 같은 값 · 32 hex)', e0 === ev(CONTRACT()) && /^[0-9a-f]{32}$/.test(e0))
  const changes: [string, string][] = [
    ['원문(evidence) 지문', ev(CONTRACT({ sourceInputHash: 'h2' }))], ['검수판(review)', ev(CONTRACT({ reviewVersion: 'rv2' }))],
    ['프롬프트(policy)', ev(CONTRACT({ promptVersion: 'pr2' }))], ['모델', ev(CONTRACT({ stageModels: { ...CONTRACT().stageModels, draftGen: 'm2' } }))],
    ['Persona 풀', ev(CONTRACT({ personaPoolDigest: 'pp2' }))], ['artifact 판', ev(CONTRACT(), 'human-review-v0')],
  ]
  check('🔴 review · policy · model · evidence · Persona 풀 · artifact 판이 바뀌면 새 근거 지문', changes.every(([, v]) => v !== e0),
    changes.filter(([, v]) => v === e0).map(([n]) => n).join(','))
  check('정책판 이름이 지문 재료에 들어간다', RETRY_POLICY_VERSION === 'retry-authority-v7')
  const ff = (cause: IncompleteCause | null, last: CallOutcome | null, set: string | null = 'speakers=a'): string =>
    failureFingerprintOf({ evidenceFingerprint: e0, speakerSetKey: set, cause, lastCall: last })
  check('🔴 실패 지문은 원인이 다르면 다르다(서로 다른 실패가 한 지문으로 합쳐지지 않는다)',
    new Set(INCOMPLETE_CAUSES.map((c) => ff(c, 'ok'))).size === INCOMPLETE_CAUSES.length)
  check('🔴 실패 지문은 마지막 요청 결과가 다르면 다르다(timeout ≠ providerTransient ≠ providerPermanent)',
    new Set([ff('noResponse', 'timeout'), ff('noResponse', 'providerTransient'), ff('noResponse', 'providerPermanent')]).size === 3)
  check('실패 지문도 결정적이다 · 근거 지문이 다르면 다르다',
    ff('parseFailed', 'ok') === ff('parseFailed', 'ok')
    && failureFingerprintOf({ evidenceFingerprint: ev(CONTRACT({ sourceInputHash: 'h2' })), speakerSetKey: 'speakers=a', cause: 'parseFailed', lastCall: 'ok' }) !== ff('parseFailed', 'ok'))
  check('🔴 실패 지문은 화자 묶음이 다르면 다르다 · 근거 지문은 화자 묶음과 무관하다(상한은 근거 지문에 걸린다)',
    ff('speakerSlotNarrowed', 'ok', 'speakers=a') !== ff('speakerSlotNarrowed', 'ok', 'speakers=b')
    && ff('speakerSlotNarrowed', 'ok', null) !== ff('speakerSlotNarrowed', 'ok', 'speakers=a'))
  // 🔴 캐시 key 바이트 동일성 — 앞판 문자열 조립과 단일 helper 가 같은 바이트를 낸다(캐시 무효화 0)
  const d16 = (x: string): string => createHash('sha256').update(x, 'utf8').digest('hex').slice(0, 16)
  const legacyTail = (codes: string[], excl: string[]): string =>
    `speakers=${d16(codes.join(','))}${excl.length === 0 ? '' : `|excl=${d16([...excl].sort().join(','))}`}`
  const sets: [string[], string[]][] = [[['P03', 'P05'], []], [['P11'], ['P02']], [['P01', 'P02', 'P03'], ['P09', 'P04']]]
  check('🔴 캐시 key 바이트 동일성 — `speakerSetKeyOf` = 앞판 `speakers=…|excl=…` 꼬리 · 시도 열쇠 = 앞판 v2Key 의 `ARTIFACT_VERSION|identity|…`',
    sets.every(([c0, x0]) => speakerSetKeyOf({ speakerCodes: c0, excludedCodes: x0 }) === legacyTail(c0, x0))
    && generationAttemptKeyOf({ artifactVersion: ARTIFACT_VERSION, contractIdentity: generationIdentity(CONTRACT()), speakerSetKey: legacyTail(['P03'], []) })
      === `${ARTIFACT_VERSION}|${generationIdentity(CONTRACT())}|speakers=${d16('P03')}`)
  const runnerSrc = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 러너의 캐시 key 와 artifact 의 화자 묶음 칸이 같은 helper 값을 쓴다(두 권위 0)',
    /const speakerSetKey = speakerSetKeyOf\(\{ speakerCodes: slotCodes, excludedCodes: replan\.excluded \}\)/.test(runnerSrc)
    && /generationAttemptKeyOf\(\{\s*artifactVersion: ARTIFACT_VERSION, contractIdentity: generationIdentity\(contract\), speakerSetKey,/.test(runnerSrc)
    && (runnerSrc.match(/speakerSetDigest: speakerSetKey/g) ?? []).length === 2
    && !/speakers=\$\{/.test(runnerSrc), '')
  check('지문에 입력 문자열이 그대로 남지 않는다(해시뿐)', ![e0, ff('truncated', 'truncated')].some((x) => /h1|pv|rv|truncated/.test(x)))
}

// ─────────────────────────────────────────────────────────
console.log('\n③-b 화자 묶음 열쇠 — 단일 형식 · 읽는 쪽 fail-closed · 낡은 문구 ratchet')
// ─────────────────────────────────────────────────────────
{
  const good = speakerSetKeyOf({ speakerCodes: ['P01', 'P02'], excludedCodes: ['P09'] })
  const plain = speakerSetKeyOf({ speakerCodes: ['P01'], excludedCodes: [] })
  check('🔴 helper 가 내는 모양은 언제나 단일 형식을 통과한다(제외 있음 · 없음)', isSpeakerSetKey(good) && isSpeakerSetKey(plain), `${good} · ${plain}`)
  const bad = ['', 'speakers=', 'speakers=xyz', 'speakers=0123456789abcde', 'speakers=0123456789ABCDEF', `${plain}|excl=zz`, `${plain} `,
    `x${plain}`, `${plain}|excl=0123456789abcdef|excl=0123456789abcdef`, 'P01,P02', 42, null]
  check('🔴 임의 문자열 · 대문자 · 길이 틀림 · 꼬리 덧붙임 · 숫자 · null 은 거절한다', bad.every((v) => !isSpeakerSetKey(v)),
    bad.filter((v) => isSpeakerSetKey(v)).map(String).join(','))
  check('형식 정규식은 하나다 — 시작 · 끝 고정', SPEAKER_SET_KEY_RE.source.startsWith('^') && SPEAKER_SET_KEY_RE.source.endsWith('$'))
  // 🔴 읽는 쪽 — 칸이 있는데 모양이 틀리면 그 기록 전체를 믿지 않는다(unknown · 상한에 센다), 칸이 없으면 모르는 것일 뿐
  const CK = CONTRACT()
  const raw = (digest: unknown): Record<string, unknown> => ({
    sourceSite: 'navercafe:wgang', sourceArticleId: 'v1', artifactVersion: ARTIFACT_VERSION, contract: CK,
    generatedAt: '2026-11-10T00:00:00.000Z', cost: { calls: [{ outcome: 'ok' }] },
    review: { machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'notRun', cause: 'speakerSlotNarrowed' } },
    ...(digest === undefined ? {} : { speakerSetDigest: digest }),
  })
  const hashOf = new Map([[artifactKeyOf('v1'), 'h1']])
  const base = (({ sourceInputHash: _h, ...b }) => b)(CK)
  const rd = (digest: unknown) => artifactRecordOutcome(raw(digest), hashOf, base, ARTIFACT_VERSION)
  const ok = rd(plain)
  const noField = rd(undefined)
  const invalid = rd('speakers=NOT-A-DIGEST')
  check('🔴 올바른 칸 → speakerBound · 열쇠를 그대로 나른다', ok?.state === 'retryable' && ok.retryClass === 'speakerBound' && ok.speakerSetKey === plain,
    JSON.stringify(ok))
  check('🔴 칸이 없는 옛 artifact → speakerBound · 열쇠 null(모르는 것)', noField?.retryClass === 'speakerBound' && noField.speakerSetKey === null)
  check('🔴 칸이 있는데 모양이 틀리면 fail-closed — unknown · 열쇠 null · 상한에 센다(같은 묶음 차단을 피해 가지 못한다)',
    invalid?.state === 'unknown' && invalid.retryClass === null && invalid.speakerSetKey === null
    && unfinishedAttemptsBySource([invalid]).get(invalid.sourceKey) === 1, JSON.stringify(invalid))
  // 🔴 관측 집계도 같은 fail-closed — 판독 권위와 집계가 같은 artifact 를 다르게 세지 않는다
  const tally = tallyRetryClasses([raw('speakers=NOT-A-DIGEST'), raw(undefined), raw(plain)])
  check('🔴 tallyRetryClasses — 칸이 있는데 모양이 틀리면 unknown · 칸 없음 옛 artifact 와 올바른 칸은 speakerBound 로 센다',
    tally !== null && tally.unknown === 1 && tally.speakerBound === 2 && tally.terminal === 0
    && tally.byCause.speakerSlotNarrowed === 2, JSON.stringify(tally))
  // 🔴 낡은 문구 ratchet — 고정 문자열(-F)로 전수 검색한다(정규식 경계 문제 0). 역사 문서 · 이 하네스 둘은 제외
  const STALE = [
    'Persona 부적격 · 같은 지문으로 다시 사지 않는다', '다음 단일 순위의 후보', '신규/재시도 상태가 원천 순위를 뒤집지',
    '다른 묶음을 받으면 쓸 수 있다', '재시도 자격을 유지', '신규·재시도를 한 줄', '신규·재시도를 나누지 않고', '재시도 예약석에 밀리지',
    'fresh/retry 섞여도', '재시도 신분이 순위를 꺾지',
    // 🔴 speakerBound 계약과 정면 충돌하던 문구 (2026-11-10 독립 검토)
    'Persona 부적격·답을 받은 실패는 재시도 대상이 아니다', '이 지문에서는 결론', '회차를 넘는 재선정 사유가 아니다',
    '원천 재시도로 위장하지 않는다(화자 예약',
    // 🔴 lane 먼저 계약과 모순되던 문구 · stance 해법을 지우던 문구 (2026-11-10 추가 독립 검토)
    '재시도 신분이나 대기 시간은 신선도 순서를 뒤집지 않는다', '화자 예약 구조(P0-3) 전까지는',
    // 🔴 legacy 호환 검사를 운영 계약처럼 쓰던 전역 문구 · speakerBound 를 결론이라 부르던 문구 (2026-11-10)
    '재시도 신분은 축 자리와 신선도 순서를 뒤집지 않는다', '재시도 예약석 없이', '재선정 처리는 둘 다 결론이다',
    '화자를 바꿔 쓰는 길은 화자 예약 구조', '손실 원인 구분 · 처리는 결론',
    // 🔴 stance 해법을 지우던 case 주석 · legacy 블록을 운영 계약처럼 읽히게 하던 제목 (2026-11-10)
    '다른 화자 묶음으로만 한 번', '재시도 단계는 관측값이고 선택은 실제 원문 신선도가 정한다', '신규/재시도 구분 없이',
  ]
  const hits: string[] = []
  for (const phrase of STALE) {
    const g = spawnSync('git', ['grep', '--untracked', '-n', '-F', phrase, '--', 'src', 'scripts',
      ':!scripts/retry-authority-check.mts', ':!scripts/retry-authority-mutation.mts'], { encoding: 'utf-8' })
    if (g.status !== 0 && g.status !== 1) throw new Error(`git grep 판독 실패 — exit ${String(g.status)}`)
    hits.push(...(g.stdout ?? '').split('\n').filter((l) => l.trim() !== '').map((l) => `${phrase} @ ${l.slice(0, 80)}`))
  }
  check('🔴 ratchet — 앞판 재시도 계약 문구(재시도 자격 유지 · 단일 순위 후보 · 같은 지문 재구매 금지 등) 0', hits.length === 0, hits.slice(0, 3).join(' | '))
  // 🔴 4개 speakerBound 원인은 원인 정의 주석마다 자기 해법과 "근거 지문당 딱 한 번" 계약을 적는다(review.ts)
  const reviewText = readFileSync('src/lib/content-core/review.ts', 'utf-8')
  const causesBlock = reviewText.slice(reviewText.indexOf('export const INCOMPLETE_CAUSES'), reviewText.indexOf('export type IncompleteCause'))
  check('🔴 review.ts 원인 정의 — speakerBound 4종이 모두 처리 · 해법 · "근거 지문당 딱 한 번" 을 적는다',
    (causesBlock.match(/`speakerBound` · 해법 `(speakerSet|stance)`/g) ?? []).length === 4
    && (causesBlock.match(/근거 지문당 딱 한 번/g) ?? []).length === 4)
  const gfHead = readFileSync('src/lib/content-core/generation-failure.ts', 'utf-8').split('*/')[0]!
  check('🔴 generation-failure 머리말이 계약 그대로다 — 같은 입력 재생성 금지 · transient/speakerBound 만 근거 지문당 딱 한 번',
    gfHead.includes('같은 입력으로 원천을 다시 생성하지 않는다') && gfHead.includes('`speakerBound`') && gfHead.includes('딱 한 번')
    && !gfHead.includes('답을 받은 실패는 재시도 대상이 아니다'))
  // 🔴 attemptedOutcomes 주석이 실제 선택 순서(lane 먼저 → lane 안 compareReleaseRank)를 적는다(supply-workset.ts)
  const wsText = readFileSync('src/lib/supply-workset.ts', 'utf-8')
  const attemptedDoc = wsText.slice(wsText.lastIndexOf('/**', wsText.indexOf('export function attemptedOutcomes')), wsText.indexOf('export function attemptedOutcomes'))
  check('🔴 attemptedOutcomes 주석 — lane 먼저 · 각 lane 안에서만 compareReleaseRank · 대기 시간은 정렬 열쇠 아님',
    attemptedDoc.includes('lane 먼저') && attemptedDoc.includes('각 lane 안에서만') && attemptedDoc.includes('compareReleaseRank'))
  // 🔴 실제 구현도 그 순서다 — fresh 묶음 뒤 retry 묶음, 각 묶음은 정본 순위 정렬 결과를 그대로 나눈 것
  check('🔴 선택 구현 — 정본 순위로 정렬한 뒤 fresh lane 을 retry lane 앞에 세운다',
    wsText.includes(".sort((a, b) => compareSupplyRank(a.sk, b.sk))")
    && wsText.includes("const byRank = [...ranked.filter((c) => laneOf(c) === 'fresh'), ...ranked.filter((c) => laneOf(c) === 'retry')]"))
  // 🔴 RetryClass 설명 — speakerBound 해법이 원인별로 나뉜다(speakerSet · stance)
  const gfText = readFileSync('src/lib/content-core/generation-failure.ts', 'utf-8')
  const rcDoc = gfText.slice(gfText.indexOf('한 원천의 지난 생성 결과를 다음 회차가'), gfText.indexOf('export const RETRY_CLASSES'))
  check('🔴 RetryClass 설명 — speakerSet(다른 화자 묶음) · stance(같은 사람 · SELF 아닌 자리) 를 따로 적는다',
    /`speakerSet`[^\n]*다른 화자 묶음/.test(rcDoc) && /`stance`[^\n]*같은 사람[^\n]*SELF/.test(rcDoc) && !rcDoc.includes('화자 예약 구조'))
  check('🔴 ratchet 판독기 생존 — 금지 문구 하나를 실제 파일에서 찾을 수 있다(이 하네스 자신)',
    readFileSync('scripts/retry-authority-check.mts', 'utf-8').includes(STALE[0]!))
}
function artifactKeyOf(id: string): string {
  return artifactOutcome({ sourceSite: 'navercafe:wgang', sourceArticleId: id, artifactVersion: ARTIFACT_VERSION, contract: CONTRACT(),
    outcome: 'hold', retryClass: 'terminal', generatedAt: '2026-11-10T00:00:00.000Z' }, CONTRACT(), ARTIFACT_VERSION)!.sourceKey
}

// ─────────────────────────────────────────────────────────
console.log('\n④ transient 상한 — 같은 근거 지문당 회차를 넘어 한 번 · 원인이 바뀌어도 초기화되지 않는다')
// ─────────────────────────────────────────────────────────
const C0 = CONTRACT()
const ART = (o: Partial<PriorArtifactRow> & { at: string }): PriorOutcome => artifactOutcome({
  sourceSite: 'navercafe:wgang', sourceArticleId: 'x1', artifactVersion: ARTIFACT_VERSION, contract: C0,
  outcome: 'hold', retryClass: 'transient', cause: 'noResponse', lastCall: 'timeout', generatedAt: o.at, ...o,
}, C0, ARTIFACT_VERSION)!
{
  const t1 = ART({ at: '2026-11-10T00:00:00.000Z' })
  const t2 = ART({ at: '2026-11-10T02:00:00.000Z', cause: 'truncated', lastCall: 'truncated' })
  const key = t1.sourceKey
  check('첫 transient 뒤에는 결론이 아니다(한 번 더 볼 수 있다)', !concludedSourceKeys([t1]).has(key) && unfinishedAttemptsBySource([t1]).get(key) === 1)
  check(`🔴 원인이 timeout → truncated 로 바뀌어도 같은 근거 지문의 두 번째 transient 뒤에는 결론(상한 ${CROSS_RUN_TRANSIENT_RETRY_MAX})`,
    concludedSourceKeys([t1, t2]).has(key) && t1.fingerprint === t2.fingerprint && t1.failureFingerprint !== t2.failureFingerprint)
  const u = ART({ at: '2026-11-10T03:00:00.000Z', retryClass: null })
  check('읽지 못한 artifact(unknown)도 돈을 쓴 시도로 센다 — transient 하나 + unknown 하나 = 결론', concludedSourceKeys([t1, u]).has(key))
  const b = ART({ at: '2026-11-10T04:00:00.000Z', retryClass: 'unattempted', cause: 'budgetBlocked', lastCall: 'blocked' })
  check('나가지 않은 요청(unattempted)은 시도로 세지 않는다', !concludedSourceKeys([t1, b]).has(key) && unfinishedAttemptsBySource([t1, b]).get(key) === 1)
  const term = ART({ at: '2026-11-10T05:00:00.000Z', retryClass: 'terminal', cause: 'parseFailed', lastCall: 'ok' })
  check('🔴 결론(terminal)은 한 번에 끝난다 — 같은 지문으로 다시 사지 않는다', concludedSourceKeys([term]).has(key))
  // ── speakerBound — 다른 화자 묶음으로만 · 같은 근거 지문당 한 번 ──
  const sbA = ART({ at: '2026-11-10T06:00:00.000Z', retryClass: 'speakerBound', cause: 'speakerSlotNarrowed', lastCall: 'ok', speakerSetKey: 'speakers=aaaa' })
  check('🔴 speakerBound 첫 실패 뒤에는 결론이 아니다(다른 묶음으로 한 번)', !concludedSourceKeys([sbA]).has(key) && unfinishedAttemptsBySource([sbA]).get(key) === 1)
  check('🔴 같은 화자 묶음으로는 다시 사지 않는다 · 다른 묶음 · 화자 묶음을 모르는 옛 기록은 막지 않는다',
    speakerSetAlreadyFailed([sbA], key, 'speakers=aaaa') && !speakerSetAlreadyFailed([sbA], key, 'speakers=bbbb')
    && !speakerSetAlreadyFailed([ART({ at: '2026-11-10T06:00:00.000Z', retryClass: 'speakerBound', cause: 'speakerSlotNarrowed', lastCall: 'ok' })], key, 'speakers=aaaa'))
  const sbStance = ART({ at: '2026-11-10T07:00:00.000Z', retryClass: 'speakerBound', cause: 'loadBearingSelfImpossible', lastCall: 'ok', speakerSetKey: 'speakers=aaaa' })
  check('🔴 해법이 자리(stance)인 speakerBound 는 같은 묶음이어도 막지 않는다 — 사람은 그대로, 1인칭을 금지한 다른 시도다',
    !speakerSetAlreadyFailed([sbStance], key, 'speakers=aaaa') && speakerRemedyOf('loadBearingSelfImpossible') === 'stance'
    && (['speakerSlotNarrowed', 'personaTransformFailed', 'loadBearingMismatch'] as const).every((c) => speakerRemedyOf(c) === 'speakerSet')
    && INCOMPLETE_CAUSES.filter((c) => speakerRemedyOf(c) !== null).every((c) => retryClassOf(c, 'ok') === 'speakerBound'))
  const sbB = ART({ at: '2026-11-10T08:00:00.000Z', retryClass: 'speakerBound', cause: 'personaTransformFailed', lastCall: 'ok', speakerSetKey: 'speakers=bbbb' })
  check('🔴 다른 묶음 · 다른 원인으로 두 번째 speakerBound 뒤에는 결론(기회당 1회 상한 · 원인 변화로 초기화되지 않음)',
    concludedSourceKeys([sbA, sbB]).has(key) && sbA.failureFingerprint !== sbB.failureFingerprint && sbA.fingerprint === sbB.fingerprint)
  check('🔴 transient 하나 + speakerBound 하나도 결론 — 두 처리가 상한을 함께 쓴다', concludedSourceKeys([t1, sbB]).has(key))
  // 🔴 생성 러너의 결론도 같은 정본 하나 — 회차 안 재계획(`personasForAttempt`)이 따로 상한을 세지 않는다
  const PC = [{ code: 'P01' }, { code: 'P02' }, { code: 'P03' }]
  const pick1 = personasForAttempt({ outcomes: [sbA], sourceKey: key, slotCodes: ['P01', 'P02', 'P03'], candidates: PC })
  const pick2 = personasForAttempt({ outcomes: [sbA, sbB], sourceKey: key, slotCodes: ['P01', 'P02', 'P03'], candidates: PC })
  check('🔴 회차 안 재계획도 결론 정본(`concludedSourceKeys`)을 쓴다 — 첫 speakerBound 뒤 한 번 · 두 번째 뒤 CONCLUDED',
    pick1.ok && !pick2.ok && pick2.code === 'CONCLUDED' && REPLAN_ATTEMPT_MAX === CROSS_RUN_TRANSIENT_RETRY_MAX + 1,
    `${JSON.stringify(pick1.ok)} · ${JSON.stringify(pick2)}`)
  check('🔴 다른 계약의 artifact 는 지금 지문의 기록이 아니다(읽는 단계에서 빠진다 — 차단 · 상한에 섞이지 않는다)',
    artifactOutcome({ sourceSite: 'navercafe:wgang', sourceArticleId: 'x1', artifactVersion: ARTIFACT_VERSION, contract: CONTRACT({ promptVersion: 'pr9' }),
      outcome: 'hold', retryClass: 'speakerBound', cause: 'speakerSlotNarrowed', lastCall: 'ok', speakerSetKey: 'speakers=aaaa',
      generatedAt: '2026-11-10T09:00:00.000Z' }, C0, ARTIFACT_VERSION) === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 선택 자리 표 — 상태 × 단계 × 처리')
// ─────────────────────────────────────────────────────────
{
  const P = (stage: 'judge' | 'draft', state: PriorOutcome['state'], retryClass?: RetryClass | null): PriorOutcome =>
    ({ sourceKey: 'k', sourceArticleId: 'k', atMs: 1, stage, state, ...(retryClass === undefined ? {} : { retryClass }) })
  const table: [string, PriorOutcome | undefined, string][] = [
    ['지난 결과 없음', undefined, 'fresh'],
    ['판정 seeded(생성 전 · 여력 대기)', P('judge', 'seeded'), 'fresh'],
    ['판정 terminal(AUTO_HOLD·DROP)', P('judge', 'terminal'), 'excluded'],
    ['판정 rawLane', P('judge', 'rawLane'), 'excluded'],
    ['판정 retryable(판정 미완)', P('judge', 'retryable'), 'retry'],
    ['판정 unknown', P('judge', 'unknown'), 'retry'],
    ['생성 candidate(채택)', P('draft', 'candidate', 'terminal'), 'excluded'],
    ['생성 terminal', P('draft', 'terminal', 'terminal'), 'excluded'],
    ['생성 retryable · transient', P('draft', 'retryable', 'transient'), 'retry'],
    ['생성 retryable · speakerBound(다른 화자 묶음으로 한 번)', P('draft', 'retryable', 'speakerBound'), 'retry'],
    ['생성 retryable · unattempted(예산 차단)', P('draft', 'retryable', 'unattempted'), 'fresh'],
    ['생성 unknown(읽지 못함)', P('draft', 'unknown', null), 'retry'],
  ]
  const bad = table.filter(([, p, want]) => selectionLaneOf(p) !== want)
  check('🔴 상태별 자리 표 전수 — 채택 candidate 는 excluded(유료 재생성 lane 아님)', bad.length === 0, bad.map(([n]) => n).join(','))
  check('표가 모든 상태를 덮는다', OUTCOME_STATES.every((st) => table.some(([, p]) => p?.state === st)))
  check('🔴 excluded 는 결론 집합과 같은 열쇠다(선택기 앞에서 빠진다)',
    table.filter(([, p]) => p !== undefined && selectionLaneOf(p) === 'excluded')
      .every(([, p]) => concludedSourceKeys([p!]).has('k')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 재선정 몫 · 축소 운영')
// ─────────────────────────────────────────────────────────
check('몫 = floor(상한 × 10%) — 1..9 → 0 · 10..19 → 1 · 20 → 2',
  RETRY_SHARE_MAX === 0.1 && [1, 5, 9].every((n) => retrySlotsFor({ limit: n, mode: 'normal' }) === 0)
  && retrySlotsFor({ limit: 10, mode: 'normal' }) === 1 && retrySlotsFor({ limit: 19, mode: 'normal' }) === 1
  && retrySlotsFor({ limit: 20, mode: 'normal' }) === 2)
check('🔴 freshOnly(축소 운영)는 0', retrySlotsFor({ limit: 20, mode: 'freshOnly' }) === 0 && RETRY_MODES.join(',') === 'normal,freshOnly')
check('🔴 실측 수율이 없는 회복 canary · 수요 0 은 신규만 — 측정 자리에 재선정을 섞지 않는다',
  retryModeFor({ paidBasis: 'boundedRecovery' }) === 'freshOnly' && retryModeFor({ paidBasis: 'noDemand' }) === 'freshOnly'
  && retryModeFor({ paidBasis: 'measuredYield' }) === 'normal')
check('잘못된 상한은 0', retrySlotsFor({ limit: -3, mode: 'normal' }) === 0 && retrySlotsFor({ limit: 2.5, mode: 'normal' }) === 0)

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 11-09·11-10 비식별 재생 — 옛 결과 대 v7')
// ─────────────────────────────────────────────────────────
type FxCand = { s: string; retry: boolean; raw: boolean; ageH: number; selected: boolean }
type FxAtt = { s: string; outcome: string; complete: boolean; cause: IncompleteCause | null; lastCall: CallOutcome | null; settledUsd: number | null }
type FxRun = { runId: string; kstSlot: string; cap: number; slots: number; candidates: FxCand[]; attempts: FxAtt[] }
const FX_PATH = 'scripts/__fixtures__/supply/retry-authority-replay-20261109-10.json'
const fxText = readFileSync(FX_PATH, 'utf-8')
const fx = JSON.parse(fxText) as { kind: string; runs: FxRun[] }
check('fixture 는 12회차 · 불투명 라벨뿐(원문 · 원문 id · 해시 · 닉네임 칸 0)',
  fx.kind === 'retry-authority-replay' && fx.runs.length === 12
  && !/"(title|body|bodyHead|sourceArticleId|sourceHash|sourceKey|url|nickname|personaCode|postId)"\s*:/.test(fxText)
  && !/(^|[^0-9.])[0-9]{5,}(?![0-9]*-)/m.test(fxText.replace(/"runId": "\d{8}-\d{6}"/g, '')))

const rowsSoFar: PriorOutcome[] = []
const attemptsLog: RetryAttempt[] = []
/** 🔴 각 시도의 지난 원인(attemptsLog 와 같은 순서) — 포기하는 채택을 원인별로 가르는 데만 쓴다 */
const priorCauses: string[] = []
const lastCause = new Map<string, string>()
const ledger: LedgerEntry[] = []
const report: string[] = []
let terminalReselectedNew = 0
let freshStarvedNew = 0
let retryOverShareNew = 0
let transientOverCapNew = 0
let freshDisplacedOld = 0
let oldRepeatTerminal = 0
const priorClassOf = (o: PriorOutcome | undefined, retryFlag: boolean): RetryAttempt['priorRetryClass'] =>
  o === undefined ? (retryFlag ? 'unknown' : 'none') : o.stage === 'judge' ? 'unknown'
    : o.state === 'candidate' ? 'terminal' : (o.retryClass ?? 'unknown')
const fxAt = (runId: string): string => `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(9, 11)}:${runId.slice(11, 13)}:${runId.slice(13, 15)}.000Z`
for (const run of fx.runs) {
  const latest = latestOutcomes(rowsSoFar)
  const concluded = concludedSourceKeys(rowsSoFar)
  const unfinished = unfinishedAttemptsBySource(rowsSoFar)
  const cands = run.candidates.filter((c) => !c.raw)
  const keyOf = (s: string): string => artifactKey(s)
  // ── v7 선택(정책 재생) — 결론 빼기 → 신규 먼저(나이 오름차순) → 재선정 몫 K ──
  const laneOf = (c: FxCand): 'fresh' | 'retry' | 'excluded' => {
    if (concluded.has(keyOf(c.s))) return 'excluded'
    const p = latest.get(keyOf(c.s))
    if (p === undefined) return c.retry ? 'retry' : 'fresh' // 창 밖 지난 결과(판정 미완 등)는 재선정 자리
    return selectionLaneOf(p)
  }
  const byAge = (a: FxCand, b: FxCand): number => a.ageH - b.ageH || a.s.localeCompare(b.s)
  const fresh = cands.filter((c) => laneOf(c) === 'fresh').sort(byAge)
  const retry = cands.filter((c) => laneOf(c) === 'retry').sort(byAge)
  const K = retrySlotsFor({ limit: run.cap, mode: 'normal' })
  const pickedFresh = fresh.slice(0, run.cap)
  const pickedRetry = retry.slice(0, Math.min(K, Math.max(0, run.cap - pickedFresh.length)))
  terminalReselectedNew += [...pickedFresh, ...pickedRetry].filter((c) => {
    const p = latest.get(keyOf(c.s)); return p !== undefined && (p.state === 'terminal' || p.state === 'candidate')
  }).length
  if (pickedRetry.length > 0 && pickedFresh.length < fresh.length) freshStarvedNew += 1
  if (pickedRetry.length > K) retryOverShareNew += 1
  transientOverCapNew += pickedRetry.filter((c) => (unfinished.get(keyOf(c.s)) ?? 0) > CROSS_RUN_TRANSIENT_RETRY_MAX).length
  // ── 옛 결과(fixture 그대로) ──
  const oldSel = cands.filter((c) => c.selected)
  const oldRetry = oldSel.filter((c) => c.retry)
  if (oldRetry.length > 0) freshDisplacedOld += cands.filter((c) => !c.retry && !c.selected).length
  const attBy = new Map(run.attempts.map((a) => [a.s, a]))
  const repeatTerm = oldRetry.filter((c) => { const p = latest.get(keyOf(c.s)); return p !== undefined && (p.state === 'terminal' || p.state === 'candidate') })
  oldRepeatTerminal += repeatTerm.length
  const adoptOld = run.attempts.filter((a) => a.outcome === 'adopt').length
  const adoptNewFresh = pickedFresh.filter((c) => attBy.get(c.s)?.outcome === 'adopt').length
  report.push(`${run.kstSlot} · 상한 ${run.cap} · K ${K} | 옛 선택 ${oldSel.length}(재선정 ${oldRetry.length} · 결론 재구매 ${repeatTerm.length}) 채택 ${adoptOld}`
    + ` | v7 신규 ${pickedFresh.length} + 재선정 ${pickedRetry.length} · 신규 중 실제 채택 ${adoptNewFresh}`)
  // ── 이 회차의 실제 시도를 다음 회차의 지난 결과로 ──
  for (const a of run.attempts) {
    const c = cands.find((x) => x.s === a.s)
    const p = latest.get(keyOf(a.s))
    const rc = a.complete ? 'terminal' as const : a.cause === null ? null : retryClassOf(a.cause, a.lastCall)
    attemptsLog.push({
      runId: run.runId, sourceKey: a.s, lane: c?.retry === true ? 'retry' : 'fresh',
      // 🔴 선택 시점에 v7 이 막는가 = 실제 결론 집합(결론 · 채택 · 기회당 상한 소진)에 있었는가
      priorRetryClass: concluded.has(keyOf(a.s)) ? 'terminal' : priorClassOf(p, c?.retry === true), cause: a.complete ? null : a.cause, retryClass: rc,
      adopted: a.outcome === 'adopt',
    })
    priorCauses.push(lastCause.get(a.s) ?? (c?.retry === true ? 'outsideWindow' : 'none'))
    if (a.settledUsd !== null) ledger.push(ledgerLine(run.runId, a.s, a.settledUsd))
    const o = artifactOutcome({
      sourceSite: 'navercafe:wgang', sourceArticleId: a.s, artifactVersion: ARTIFACT_VERSION, contract: C0,
      outcome: a.outcome, retryClass: rc, ...(a.complete || a.cause === null ? {} : { cause: a.cause }), lastCall: a.lastCall, generatedAt: fxAt(run.runId),
    }, C0, ARTIFACT_VERSION)
    if (o !== null) rowsSoFar.push(o)
    lastCause.set(a.s, a.complete ? (a.outcome === 'adopt' ? 'adopted' : 'completeHold') : (a.cause ?? 'unknown'))
  }
}
function artifactKey(s: string): string {
  return artifactOutcome({ sourceSite: 'navercafe:wgang', sourceArticleId: s, artifactVersion: ARTIFACT_VERSION, contract: C0,
    outcome: 'hold', retryClass: 'terminal', generatedAt: '2026-11-10T00:00:00.000Z' }, C0, ARTIFACT_VERSION)!.sourceKey
}
function ledgerLine(runId: string, sourceKey: string, usd: number): LedgerEntry {
  return {
    runId: `${runId}-d`, stage: 'sourceNeed', attemptId: `${runId}-${sourceKey}`, requestNo: 0, provider: 'p', apiModelId: 'm', model: 'm',
    status: 'settled', blockCode: null, countedInputTokens: null, maxOutputTokens: 1, reservedUsd: usd, inputTokens: 1, outputTokens: 1,
    cacheWriteTokens: null, cacheReadTokens: null, usageKeys: [], settledUsd: usd, pricingVersion: 'v', startedAt: fxAt(runId),
    endedAt: fxAt(runId), errorCode: null, sourceKey,
  } as LedgerEntry
}
for (const l of report) console.log(`   ${l}`)
const r1715 = fx.runs.find((r) => r.kstSlot === '11-10 17:15')!
const r2115 = fx.runs.find((r) => r.kstSlot === '11-10 21:15')!
check('재생 반례 재현 — 11-10 17:15 옛 선택 13 = 재선정 13 · 채택 0',
  r1715.candidates.filter((c) => c.selected && !c.raw).length === 13 && r1715.candidates.filter((c) => c.selected && c.retry).length === 13
  && r1715.attempts.every((a) => a.outcome !== 'adopt'))
check('재생 반례 재현 — 11-10 21:15 옛 재선정 13 채택 0 · 신규 7 중 3 채택', (() => {
  const by = new Map(r2115.attempts.map((a) => [a.s, a]))
  const sel = r2115.candidates.filter((c) => c.selected)
  const fr = sel.filter((c) => !c.retry); const rt = sel.filter((c) => c.retry)
  return rt.length === 13 && rt.every((c) => by.get(c.s)?.outcome !== 'adopt')
    && fr.length === 7 && fr.filter((c) => by.get(c.s)?.outcome === 'adopt').length === 3
})())
check('옛 판에서 결론을 다시 산 재선정이 있었다(결함 재현)', oldRepeatTerminal > 0, `${oldRepeatTerminal}건`)
check('옛 판에서 retry 가 신규를 밀어냈다(결함 재현)', freshDisplacedOld > 0, `${freshDisplacedOld}자리`)
check('🔴 v7 — 결론(terminal · 채택) 재선정 0', terminalReselectedNew === 0, `${terminalReselectedNew}`)
check('🔴 v7 — 신규 굶김 0(재선정이 들어온 회차에 남은 신규 0)', freshStarvedNew === 0, `${freshStarvedNew}`)
check('🔴 v7 — 재선정 ≤ floor(상한 × 10%)', retryOverShareNew === 0)
check('🔴 v7 — transient 는 같은 근거 지문당 1회를 넘지 않는다', transientOverCapNew === 0, `${transientOverCapNew}`)
{
  // 17:15 — 재선정 13건 전부가 창 안에서 결론 났거나(재구매 금지) 몫 밖이다 → v7 유료 0~2
  const line = report.find((l) => l.startsWith('11-10 17:15'))!
  check('🔴 v7 — 11-10 17:15 는 결론 원천을 사지 않는다(신규 0 · 재선정 ≤ 2)', /v7 신규 0 \+ 재선정 [0-2] /.test(line), line)
  const l21 = report.find((l) => l.startsWith('11-10 21:15'))!
  check('🔴 v7 — 11-10 21:15 는 신규 7 전부 · 그 7 의 실제 채택 3 은 그대로', /v7 신규 7 \+ 재선정 [0-2] · 신규 중 실제 채택 3/.test(l21), l21)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 비용 귀속 — 통합 장부 현행 칸 · 확정 회피 비용')
// ─────────────────────────────────────────────────────────
{
  const at = retryCostAttributionOf({ entries: ledger, attempts: attemptsLog })!
  const usdOf = (a: RetryAttempt): number => ledger.find((x) => x.runId === `${a.runId}-d` && x.sourceKey === a.sourceKey)?.settledUsd ?? 0
  const reb = attemptsLog.map((a, i) => ({ a, prior: priorCauses[i]! })).filter((x) => x.a.lane === 'retry' && x.a.priorRetryClass === 'terminal')
  const manualAvoid = reb.filter((x) => !x.a.adopted).reduce((n, x) => n + usdOf(x.a), 0)
  const manualAdopt = reb.filter((x) => x.a.adopted).reduce((n, x) => n + usdOf(x.a), 0)
  const r1715Avoid = reb.filter((x) => x.a.runId === r1715.runId && !x.a.adopted).reduce((n, x) => n + usdOf(x.a), 0)
  const r1715All = r1715.attempts.reduce((n, a) => n + (a.settledUsd ?? 0), 0)
  console.log(`   총 정산 $${at.totalUsd.toFixed(6)} · 신규 $${at.byLane.fresh.toFixed(6)} · 재선정 $${at.byLane.retry.toFixed(6)} · 미연결 $${at.unlinkedUsd.toFixed(6)}`)
  console.log(`   🔴 11-10 17:15 — 관측 손실(그 회차 정산 전부 · 재선정 13 · 채택 0) $${r1715All.toFixed(6)} · 그중 v7 창 안 확정 차단 $${r1715Avoid.toFixed(6)}`)
  console.log(`   🔴 재생 창(12회차) 확장 — 창 안 결론 재구매 · 채택 없음 $${at.confirmedAvoidableUsd.toFixed(6)} · ${at.confirmedAvoidableAttempts}건`)
  console.log(`   🔴 재생 창 — 결론 재구매가 채택된 시도 $${at.reselectedAdoptedUsd.toFixed(6)} · ${at.reselectedAdoptedAttempts}건 (v7 이 이 채택을 포기한다)`)
  // 🔴 포기하는 채택을 지난 원인별로 가른다 — 정책 안전성 재검토의 입력
  const byPrior = new Map<string, { adopt: number; total: number; usdAdopt: number }>()
  for (const x of reb) {
    const k = x.prior
    const v = byPrior.get(k) ?? { adopt: 0, total: 0, usdAdopt: 0 }
    v.total += 1
    if (x.a.adopted) { v.adopt += 1; v.usdAdopt += usdOf(x.a) }
    byPrior.set(k, v)
  }
  for (const [k, v] of [...byPrior].sort((p, q) => q[1].total - p[1].total)) {
    console.log(`      · 지난 원인 ${k}: 재구매 ${v.total}건 → 채택 ${v.adopt}건 (${v.total === 0 ? 0 : Math.round((v.adopt / v.total) * 100)}%) · 채택분 정산 $${v.usdAdopt.toFixed(6)}`)
  }
  console.log('      · 한계: "결론" 은 창 안(12회차) artifact 를 v7 규칙으로 읽은 것이다. 창 밖 지난 결과는 unknown 으로 세지 않았다(하한).')
  console.log(`   원인별 ${Object.entries(at.byCause).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${k} $${v.toFixed(4)}`).join(' · ')}`)
  check('귀속이 완전하다 — 미연결 0 · 장부 합 = 시도 합', at.unlinkedUsd === 0
    && Math.abs(at.totalUsd - ledger.reduce((n, e) => n + (e.settledUsd ?? 0), 0)) < 1e-9)
  check('🔴 확정 회피 = 창 안 결론을 재선정 자리에서 다시 사서 채택 없이 끝난 시도의 정산 합(손 계산과 같다)',
    Math.abs(at.confirmedAvoidableUsd - manualAvoid) < 1e-9 && at.confirmedAvoidableUsd > 0, `${at.confirmedAvoidableUsd} vs ${manualAvoid}`)
  check('🔴 채택된 재구매는 회피 비용에서 빠지고 따로 센다(합이 맞는다)',
    Math.abs(at.reselectedAdoptedUsd - manualAdopt) < 1e-9
    && Math.abs(at.confirmedAvoidableUsd + at.reselectedAdoptedUsd - reb.reduce((n, x) => n + usdOf(x.a), 0)) < 1e-9
    && at.reselectedAdoptedAttempts === reb.filter((x) => x.a.adopted).length)
  check('🔴 11-10 17:15 관측 손실 = 그 회차 정산 전부($0.018~0.023 · 재선정 13 · 채택 0)', r1715All >= 0.018 && r1715All <= 0.023
    && r1715.attempts.every((x) => x.outcome !== 'adopt'), `${r1715All}`)
  check('🔴 11-10 17:15 중 v7 이 창 안 기록만으로 확정 차단하는 몫 > 0 (나머지는 창 밖 unknown · 첫 speakerBound — 하한)',
    r1715Avoid > 0 && r1715Avoid <= r1715All + 1e-12, `${r1715Avoid}`)
  check('🔴 v7 이 포기하는 채택은 이미 채택된 원천의 재생성뿐 — Persona(speakerSlotNarrowed) 뒤 2차 채택은 포기하지 않는다',
    [...byPrior.entries()].every(([k, v]) => v.adopt === 0 || k === 'adopted'), JSON.stringify([...byPrior]))
  /**
   * 🔴 반례 — 신규 자리의 결론(결정적 안전 HOLD · 완주 품질 HOLD)·창 밖(unknown) 재선정·transient 뒤 재선정 비용은 확정 회피가 아니다.
   *    별도 장부 줄로 넣고 확정 회피 집합에 그 줄들이 들어가지 않는지 본다(동어반복이 아니라 실제 집합 판정).
   */
  const RID = '20261110-990000'
  const extra: RetryAttempt[] = [
    { runId: RID, sourceKey: 'X-safety', lane: 'fresh', priorRetryClass: 'none', cause: 'deterministicFailed', retryClass: 'terminal', adopted: false },
    { runId: RID, sourceKey: 'X-quality', lane: 'fresh', priorRetryClass: 'none', cause: null, retryClass: 'terminal', adopted: false },
    { runId: RID, sourceKey: 'X-unknownPrior', lane: 'retry', priorRetryClass: 'unknown', cause: 'speakerSlotNarrowed', retryClass: 'terminal', adopted: false },
    { runId: RID, sourceKey: 'X-transientPrior', lane: 'retry', priorRetryClass: 'transient', cause: 'parseFailed', retryClass: 'terminal', adopted: false },
    { runId: RID, sourceKey: 'X-rebuy', lane: 'retry', priorRetryClass: 'terminal', cause: 'parseFailed', retryClass: 'terminal', adopted: false },
  ]
  const extraLedger = extra.map((a, i) => ledgerLine(RID, a.sourceKey, 0.1 * (i + 1)))
  const at2 = retryCostAttributionOf({ entries: [...ledger, ...extraLedger], attempts: [...attemptsLog, ...extra] })!
  check('🔴 반례 — 신규 안전 HOLD · 신규 품질 HOLD · 창 밖(unknown) · transient 뒤 재선정은 확정 회피에 들어가지 않고, 결론 재구매(X-rebuy 0.5)만 들어간다',
    Math.abs(at2.confirmedAvoidableUsd - (at.confirmedAvoidableUsd + 0.5)) < 1e-9 && at2.confirmedAvoidableAttempts === at.confirmedAvoidableAttempts + 1,
    `${at2.confirmedAvoidableUsd - at.confirmedAvoidableUsd}`)
  check('🔴 반례 — 그 비용들은 자리 · 원인별 귀속에는 그대로 남는다(지우지 않는다)',
    Math.abs(at2.totalUsd - at.totalUsd - 1.5) < 1e-9 && Math.abs(at2.byLane.fresh - at.byLane.fresh - 0.3) < 1e-9)
  check('장부를 못 읽으면 귀속 자체가 null', retryCostAttributionOf({ entries: null, attempts: attemptsLog }) === null)
  check('정산 안 된 요청은 금액이 아니라 건수로만 센다', retryCostAttributionOf({
    entries: [{ ...ledgerLine(r1715.runId, 'S001', 0.01), status: 'usageUnknown', settledUsd: null } as LedgerEntry], attempts: [],
  })!.openRequests === 1)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB · 네트워크 · provider · 운영 파일 0. 재생은 정책 재생이다 — 실제 선택기의 슬롯 짝은 supply:jit-selection-check 가 본다.')
if (fail > 0) process.exit(1)
