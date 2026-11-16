#!/usr/bin/env tsx
/**
 * 재선정 권위 단일화 변이 시험 — retry-authority-v7 (2026-11-10 · P0-1)
 *
 *   npx tsx scripts/retry-authority-mutation.mts
 *
 * 보호 장치를 지운 코드로 `retry-authority-check` · `supply-jit-selection-check` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 🔴 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상이면 무효 — 죽은 변이를 통과로 세지 않는다).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다. 운영 파일 · DB · 네트워크 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = {
  gf: 'src/lib/content-core/generation-failure.ts',
  review: 'src/lib/content-core/review.ts',
  ws: 'src/lib/supply-workset.ts',
  fate: 'src/lib/ready-fate.ts',
  replan: 'scripts/lib/replan-personas.mts',
  funnel: 'src/lib/d100-supply-funnel.ts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '단일 권위 우회 — artifact 판독이 원인을 보지 않고 미완이면 transient',
    edits: [{ file: F.ws, find: '  return completionRetryClass(c, lastCallOutcomeOf(cost))', replace: "  return c.complete ? 'terminal' : 'transient'" }] },
  { name: 'terminal → retryable — 답을 받은 형식 오류 · 사용량 미상을 transient 로',
    edits: [{ file: F.gf, find: "    case 'parseFailed':\n    case 'usageUnknown':\n      return 'terminal'", replace: "    case 'parseFailed':\n    case 'usageUnknown':\n      return 'transient'" }] },
  { name: '제공사 영구 거절(400 · 401)을 transient 로',
    edits: [{ file: F.gf, find: "      return lastCall === 'providerPermanent' ? 'terminal' : 'transient'", replace: "      return 'transient'" }] },
  { name: 'speakerBound 를 결론으로 접는다 — 다른 묶음 2차 채택을 포기',
    edits: [{ file: F.gf, find: "    case 'loadBearingSelfImpossible':\n      return 'speakerBound'", replace: "    case 'loadBearingSelfImpossible':\n      return 'terminal'" }] },
  { name: '전체 후보 자격 없음을 speakerBound 로 — 결론을 다시 산다',
    edits: [{ file: F.gf, find: "    case 'speakerUnqualified':\n    case 'voiceUnready':", replace: "    case 'speakerUnqualified':\n      return 'speakerBound'\n    case 'voiceUnready':" }] },
  { name: 'fresh-first 제거 — 신규와 재선정을 한 줄로 세운다(앞판)',
    edits: [{ file: F.ws, find: "  const byRank = [...ranked.filter((c) => laneOf(c) === 'fresh'), ...ranked.filter((c) => laneOf(c) === 'retry')]", replace: '  const byRank = ranked' }] },
  { name: '재선정 몫 상한 제거 — 상한 전부를 재선정에',
    edits: [{ file: F.gf, find: '  return Math.floor(limit * RETRY_SHARE_MAX)', replace: '  return limit' }] },
  { name: '축소 운영 무시 — freshOnly 에도 재선정',
    edits: [{ file: F.gf, find: "  if (i.mode === 'freshOnly') return 0\n", replace: '' }] },
  { name: '회복 canary 에도 재선정을 섞는다',
    edits: [{ file: F.gf, find: "  return i.paidBasis === 'measuredYield' ? 'normal' : 'freshOnly'", replace: "  return 'normal'" }] },
  { name: '근거 지문당 상한 제거 — 끝나지 않은 시도를 무한히 다시 산다',
    edits: [{ file: F.ws, find: '    if (n > CROSS_RUN_TRANSIENT_RETRY_MAX) out.add(id)', replace: '    if (n > CROSS_RUN_TRANSIENT_RETRY_MAX + 9) out.add(id)' }] },
  { name: 'speakerBound 를 상한에서 뺀다 — Persona 실패만 무한 재구매',
    edits: [{ file: F.ws, find: "      || (r.state === 'retryable' && (r.retryClass === 'transient' || r.retryClass === 'speakerBound'))", replace: "      || (r.state === 'retryable' && r.retryClass === 'transient')" }] },
  { name: '채택 candidate 를 재선정 lane 으로 — 채택 원천을 유료 재생성',
    edits: [{ file: F.ws, find: "    case 'terminal': case 'rawLane': case 'candidate': return 'excluded'", replace: "    case 'terminal': case 'rawLane': return 'excluded'\n    case 'candidate': return 'retry'" }] },
  { name: '실패 지문에서 원인을 뺀다 — 서로 다른 실패가 한 지문',
    edits: [{ file: F.gf, find: "${i.speakerSetKey ?? 'unknown'}|${i.cause ?? 'complete'}|", replace: "${i.speakerSetKey ?? 'unknown'}|" }] },
  { name: '실패 지문에서 화자 묶음을 뺀다',
    edits: [{ file: F.gf, find: "${i.evidenceFingerprint}|${i.speakerSetKey ?? 'unknown'}|", replace: '${i.evidenceFingerprint}|' }] },
  { name: '근거 지문에서 계약을 뺀다 — 모델 · 프롬프트 · 원문이 바뀌어도 같은 지문',
    edits: [{ file: F.gf, find: '  return sha32(`${RETRY_POLICY_VERSION}|${i.artifactVersion}|${i.contractIdentity}`)', replace: '  return sha32(`${RETRY_POLICY_VERSION}|${i.artifactVersion}`)' }] },
  { name: '같은 화자 묶음 재구매 차단 무력화',
    edits: [{ file: F.ws, find: "    && r.retryClass === 'speakerBound' && r.speakerSetKey === speakerSetKey", replace: "    && r.retryClass === 'speakerBound'" }] },
  { name: '같은 묶음 차단이 해법을 보지 않는다 — 자리 해법(stance)까지 막는다',
    edits: [{ file: F.ws, find: "    && speakerRemedyOf(incompleteCauseOf(r.failedCause)) === 'speakerSet')", replace: ')' }] },
  { name: '캐시 key 바이트 분기 — helper 해시 길이가 앞판과 달라진다',
    edits: [{ file: F.gf, find: "  const d16 = (x: string): string => createHash('sha256').update(x, 'utf8').digest('hex').slice(0, 16)", replace: "  const d16 = (x: string): string => createHash('sha256').update(x, 'utf8').digest('hex').slice(0, 15)" }] },
  { name: '회차 안 재계획이 자기 결론 규칙을 다시 갖는다(두 권위)',
    edits: [{ file: F.replan, find: '  const concluded = concludedSourceKeys(input.outcomes).has(input.sourceKey)', replace: "  const concluded = input.outcomes.some((o) => o.sourceKey === input.sourceKey && o.stage === 'draft' && o.state === 'terminal')" }] },
  { name: 'review 가 generation-failure 를 런타임 import — 순환',
    edits: [{ file: F.review, find: "import { CLAIM_FACTS } from './source-facts'", replace: "import { CLAIM_FACTS } from './source-facts'\nimport { RETRY_CLASSES } from './generation-failure'\nexport const RETRY_CLASS_ECHO = RETRY_CLASSES" }] },
  { name: '옛 재시도 목록 부활 — review 에 RETRYABLE_CAUSES',
    edits: [{ file: F.review, find: 'export const REVIEW_WARNING_AXES', replace: "export const RETRYABLE_CAUSES = ['noResponse'] as const\nexport const REVIEW_WARNING_AXES" }] },
  { name: '화자 묶음 형식 판정을 느슨하게 — 임의 문자열을 받는다',
    edits: [{ file: F.gf, find: '  return typeof v === \'string\' && SPEAKER_SET_KEY_RE.test(v)', replace: "  return typeof v === 'string' && v !== ''" }] },
  { name: '읽는 쪽 fail-closed 제거 — 모양이 틀린 칸이어도 기록을 믿는다',
    edits: [{ file: F.ws, find: '    retryClass: raw.speakerSetDigest !== undefined && !isSpeakerSetKey(raw.speakerSetDigest)\n      ? null : artifactRetryClassOf(review, raw.cost),', replace: '    retryClass: artifactRetryClassOf(review, raw.cost),' }] },
  { name: '읽는 쪽이 모양이 틀린 열쇠를 그대로 나른다',
    edits: [{ file: F.ws, find: '    speakerSetKey: isSpeakerSetKey(raw.speakerSetDigest) ? raw.speakerSetDigest : null,', replace: "    speakerSetKey: typeof raw.speakerSetDigest === 'string' ? raw.speakerSetDigest : null," }] },
  { name: '관측 집계 fail-closed 제거 — 모양이 틀린 화자 묶음 칸도 분류한다',
    edits: [{ file: F.funnel, find: '    const cls = o === null || malformedSpeakerSet ? null : artifactRetryClassOf(o.review, o.cost)', replace: '    const cls = o === null ? null : artifactRetryClassOf(o.review, o.cost)' }] },
  { name: '비용 — 채택된 재구매를 회피 비용으로 센다',
    edits: [{ file: F.fate, find: '      if (a.adopted) {', replace: '      if (false) {' }] },
  { name: '비용 — 신규 자리의 결론(안전 · 품질 HOLD)까지 회피 비용으로 센다',
    edits: [{ file: F.fate, find: "    if (a.lane === 'retry' && a.priorRetryClass === 'terminal') {", replace: "    if (a.priorRetryClass === 'terminal' || a.retryClass === 'terminal') {" }] },
]

const CHECKS = ['scripts/retry-authority-check.mts', 'scripts/supply-jit-selection-check.mts']
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })

const runChecks = (): { failed: boolean; summary: string } => {
  const lines: string[] = []
  let failed = false
  for (const c of CHECKS) {
    const r = spawnSync(process.execPath, [...process.execArgv, c], { encoding: 'utf-8', timeout: 600_000 })
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status !== 0) {
      failed = true
      const f = text.split('\n').filter((l) => l.includes('FAIL') || /Error/.test(l)).slice(0, 1).map((l) => l.trim().slice(0, 160))
      lines.push(`${c.replace('scripts/', '')} exit ${String(r.status)} ${f.join('')}`)
    }
  }
  return { failed, summary: lines.join(' | ') || 'exit 0' }
}

let killed = 0
let survived = 0
let invalid = 0
try {
  const base = runChecks()
  if (base.failed) { console.log(`🔴 기준선 FAIL — ${base.summary}`); process.exit(1) }
  console.log('  ✅ 기준선 PASS')
  for (const m of MUTATIONS) {
    let valid = true
    for (const e of m.edits) {
      const cur = readFileSync(e.file, 'utf-8')
      const n = cur.split(e.find).length - 1
      if (n !== 1) { valid = false; console.log(`  ❌ 변이 무효(문장 ${n}회) — ${m.name} · ${e.file}`); break }
      writeFileSync(e.file, cur.replace(e.find, e.replace))
    }
    if (!valid) { invalid += 1; restore(); continue }
    const r = runChecks()
    restore()
    for (const [f, h] of HASH) if (sha(readFileSync(f, 'utf-8')) !== h) { console.log(`🔴 원복 해시 불일치 — ${f}`); process.exit(1) }
    if (r.failed) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) } else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}`) }
  }
} finally { restore() }
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인`)
process.exit(ok ? 0 : 1)
