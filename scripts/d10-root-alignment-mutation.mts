#!/usr/bin/env tsx
/**
 * 🔴 **2026-10-24~26 D10 근본 보정 — 변이 시험** (Content Core 단일 권위 · 실질 변경 계약 · 400 요청 모양 거부 · 글쓴이 답글 · 첫 댓글 기능 소비)
 *
 *   npx tsx scripts/d10-root-alignment-mutation.mts
 *
 *   막는 줄 하나를 바꾸면 그 축의 순수 검사가 **판정으로** FAIL 해야 한다. 한 변이라도 살아남으면 exit 1.
 *
 * 🔴 문법·로드 오류는 잡힌 변이로 세지 않는다 — 검사가 non-zero 로 끝나고 **실패 판정 줄(❌ · 🔴 FAIL)을 찍었을 때만** 잡힘이다.
 *    판정 줄 없이 죽으면 "로드 실패" 로 적고 하네스 자체를 FAIL 로 둔다.
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 먼저 변이 없는 사본이 각 검사에서 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEM = 'src/lib/auto-ready-semantic-audit.ts'
const MAT = 'src/lib/content-core/material-contract.ts'
const PROMPTS = 'scripts/lib/content-core-prompts.mts'
const REVIEW = 'src/lib/content-core/review.ts'
const PIPE = 'scripts/lib/persona-comment-pipeline.ts'
const GENF = 'src/lib/content-core/generation-failure.ts'
const FU = 'src/lib/persona-comment-followup.ts'
const RUN = 'scripts/lib/persona-comment-followup-run.mts'
const EV = 'src/lib/stage-evidence.ts'

const AUDIT_CHECK = 'scripts/auto-ready-audit-check.mts'
const LOSS_CHECK = 'scripts/semantic-loss-check.mts'
const ENGINE_CHECK = 'scripts/persona-comment-engine-check.mts'
const FU_CHECK = 'scripts/persona-comment-followup-check.mts'
const EV_CHECK = 'scripts/stage-evidence-check.mts'
const FORM_CHECK = 'scripts/source-form-check.mts'
const CORE_CHECK = 'scripts/content-core-v2-check.mts'
const LIFE_CHECK = 'scripts/draft-life-gates-check.mts'
const EVID = 'src/lib/content-core/evidence.ts'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const M = (name: string, file: string, check: string, from: string, to: string): Mutation => ({ name, file, from, to, check })
const MUTATIONS: Mutation[] = [
  // ── A · Content Core 단일 의미 품질 권위 ──
  M('사후 모델 finding이 다시 차단', SEM, AUDIT_CHECK,
    "  return advisoryNo(binding, first.defect === 'yes' ? 'MODEL_FINDING' : null, first.reasons)",
    "  return { outcome: 'measured', defect: first.defect, confirmation: 'none', code: null, reasons: first.reasons, binding, ...VERSIONS }"),
  M('결속 뒤 제공사 실패가 다시 전역을 차단', SEM, AUDIT_CHECK,
    '  if (!first.ok) return advisoryNo(binding, first.code, [`관측 실패 ${first.code} — ${first.reason}`])',
    '  if (!first.ok) return retryable(first.code, first.reason, binding)'),
  M('계약과 다른 모델이 다시 전역을 차단', SEM, AUDIT_CHECK,
    "    return advisoryNo(binding, 'MODEL_MISMATCH', [`제공사 모델 ${provider.model} ≠ 계약 ${SEMANTIC_AUDIT_MODEL}`])",
    "    return retryable('MODEL_MISMATCH', `제공사 모델 ${provider.model}`, binding)"),
  M('결속 무결성 결함을 재시도로 완화', SEM, AUDIT_CHECK,
    '    return ctxRes.integrity ? integrity(ctxRes.code, ctxRes.reason) : retryable(ctxRes.code, ctxRes.reason, null)',
    '    return retryable(ctxRes.code, ctxRes.reason, null)'),
  M('모델 finding 뒤 중복 확인 호출 부활', SEM, AUDIT_CHECK,
    "  return advisoryNo(binding, first.defect === 'yes' ? 'MODEL_FINDING' : null, first.reasons)",
    "  if (first.defect === 'yes') await measureOnce(provider, req)\n  return advisoryNo(binding, first.defect === 'yes' ? 'MODEL_FINDING' : null, first.reasons)"),
  M('의미 감사 지시문이 공유 실질 변경 계약을 싣지 않음', SEM, AUDIT_CHECK,
    "  ...MATERIAL_CONTRACT_LINES,\n  '주체·행동·원인·결과를", "  '주체·행동·원인·결과를"),
  M('시간 바꿔쓰기 줄 제거(공유 계약)', MAT, AUDIT_CHECK,
    "  '시간 표현은 낱말이 달라졌다는 이유만으로 바뀐 것이 아니다. \"새벽\"·\"이 밤\"·\"밤늦게\"처럼 같은 장면의 시간대를 달리 말한 것은 바꿔쓰기다.',\n", ''),
  M('Content Core 검수 지시문이 공유 실질 변경 계약을 싣지 않음', PROMPTS, LOSS_CHECK,
    "    ...MATERIAL_CONTRACT_LINES,\n    '',\n    ...REVIEW_SEVERITY_LINES,", "    ...REVIEW_SEVERITY_LINES,"),
  // ── 검수 등급(막음/참고) · 시스템이 바꾼 나이 · 전달자 지시 (quality-v28) ──
  M('검수 지시문이 등급 줄을 싣지 않음', PROMPTS, LOSS_CHECK,
    "    ...REVIEW_SEVERITY_LINES,\n", ''),
  M('등급 없는 항목을 참고로 읽음(fail-open)', REVIEW, LOSS_CHECK,
    "o.severity === 'note'", "o.severity !== 'block'"),
  M('참고 항목이 막음 배열에 남음', REVIEW, LOSS_CHECK,
    "      if (isNote(o)) advisories.push({ axis: key, ...item })\n      else out.push(item)", '      out.push(item)'),
  M('시스템 나이가 든 문장이면 다른 지어낸 사실이 섞여도 참고로 옮김', REVIEW, LOSS_CHECK,
    "  return rest.replace(/[.,!?~…·]/g, '') === ''", '  return true'),
  M('등급 줄에서 새 전달자 막음이 빠짐', PROMPTS, LOSS_CHECK,
    " — **자리가 무엇이든** ·',", " ·',"),
  M('시스템이 바꾼 나이 낱말이면 나이 축이 아닌 모순도 참고로 옮김', REVIEW, LOSS_CHECK,
    "    x.fact === 'age' && marks.some(", '    marks.some('),
  M('초안 지시문에 전달자를 세워 전하라는 줄 부활', PROMPTS, LOSS_CHECK,
    "말과 행동만 **그 사람을 주어로** 둡니다. 없던 전달자를 앞에 세우지 않습니다.',",
    "말과 행동은 \"어떤 분이 … 그러셨대요\" 처럼 **그 사람을 주어로** 전합니다.',"),
  // ── 낱말은 새로, 꼴은 원문 그대로 (quality-v30 · v2-draft-p17) ──
  M('생성 요청 페이로드에서 꼴을 뺌', PROMPTS, FORM_CHECK,
    '    꼴: sourceFormOf(sourceBodyOf(input.packet)),\n', ''),
  M('꼴을 제목까지 붙인 원문 덩어리로 잼', PROMPTS, FORM_CHECK,
    '    꼴: sourceFormOf(sourceBodyOf(input.packet)),', '    꼴: sourceFormOf(sourceBlock(input.packet)),'),
  M('지운 "감상 · 질문 · 비유" 줄 부활', PROMPTS, FORM_CHECK,
    '    ...DRAFT_FORM_LINES,\n',
    "    ...DRAFT_FORM_LINES,\n    '- 원문 핵심을 바꾸지 않는 범위에서 **감상 · 질문 · 비유 · 연결 문장 · 일반적인 관찰**로 새 글을 만듭니다.',\n"),
  M('초안 지시문이 꼴 절을 싣지 않음', PROMPTS, FORM_CHECK, '    ...DRAFT_FORM_LINES,\n', ''),
  M('줄 끝 모양을 공백째 잼', 'src/lib/content-core/source-form.ts', FORM_CHECK,
    "lastChars(l.replace(/\\s+/g, ''), LINE_END_CHARS)", 'lastChars(l, LINE_END_CHARS)'),
  // ── 수집 때 잘린 원문은 끝맺은 자리까지 걷는다 (quality-v31 · content-core-v2.4 · draft-gates-v14) ──
  M('runContentCore 가 걷지 않은 본문으로 근거 묶음을 만듦', 'scripts/lib/content-core-run.mts', CORE_CHECK,
    'const sourceBody = closedCutBody(input.maskedBody, input.sourceMeta.bodyLength)', 'const sourceBody = input.maskedBody'),
  M('closedCutBody 가 자르지 않음', EVID, FORM_CHECK,
    '  return end > 0 ? t.slice(0, end).trim() : t\n', '  return t\n'),
  M('잘림 판정이 원래 길이를 버림', EVID, FORM_CHECK,
    '  return originalLength === null || !(originalLength > 0) || originalLength > n\n', '  return true\n'),
  M('두 벌 본문도 자름', EVID, FORM_CHECK, ' || collapseRepeatedBody(t).collapsed) return t', ') return t'),
  M('공백 앞 다·네·음 낱말도 끝으로 봄', EVID, FORM_CHECK,
    'const WORD_CLOSING_RE = /[가-힣](?:요|죠|니다)$/', 'const WORD_CLOSING_RE = /[가-힣](?:요|죠|니다|다|네|음)$/'),
  M('잘린 원문 게이트가 원래 길이를 버림', 'src/lib/content-core/draft-life-gates.ts', LIFE_CHECK,
    '  const tail = openTailOf(src.body, src.bodyLength)', '  const tail = openTailOf(src.body, null)'),
  M('캐시 채택 게이트 원천이 걷지 않은 본문', 'scripts/micro-seed-auto-draft.mts', LIFE_CHECK,
    'body: closedCutBody(meta.bodyHead, meta.bodyLength), ...gateSourceMetaOf(meta)', 'body: meta.bodyHead, ...gateSourceMetaOf(meta)'),
  M('원천 메타에 원래 길이를 싣지 않음', 'scripts/micro-seed-auto-draft.mts', FORM_CHECK,
    'imageCount: m.imageCount, bodyLength: m.bodyLength,', 'imageCount: m.imageCount, bodyLength: null,'),
  // ── 초안 생성 생각 수준 low (quality-v32 · content-core-v2.5) ──
  M('draftGen 생각 수준을 provider 기본값으로 되돌림', 'src/lib/content-core/pipeline.ts', 'scripts/supply-chain-e2e-check.mts',
    "  draftGen: 'low',\n  semanticReview: null,", '  draftGen: null,\n  semanticReview: null,'),
  // ── C · 400 요청 모양 거부 ──
  M('400 도 다음 후보로 재시도', PIPE, ENGINE_CHECK,
    'if (!res.ok && requestShapeRejected(res.errorCode)) {', 'if (false) {'),
  M('모든 실패에서 회차 중단(일시 오류 재시도 제거)', GENF, ENGINE_CHECK,
    "return (code ?? '').trim() === 'HTTP_400'", "return (code ?? '').trim() !== ''"),
  // ── B · 글쓴이 답글 ──
  M('글쓴이 답글 자리 없음(옛 동작)', FU, FU_CHECK,
    'author: (hook) => (forAuthor === undefined || author === null ? null', 'author: (hook) => (true ? null'),
  M('글쓴이 답글 3회 상한 제거', FU, FU_CHECK,
    'turnsOf(author) >= PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX', 'false'),
  M('고르기가 정해진 사람의 자리를 무시(무작위 Persona)', FU, FU_CHECK,
    "  if (speaker.kind !== 'other') {\n    // 🔴 정해진 사람의 자리", "  if (false) {\n    // 🔴 정해진 사람의 자리"),
  M('트랜잭션이 정해진 사람의 자리에 다른 Persona 를 허용', FU, FU_CHECK,
    "} else if (!here.some((s) => s.speaker.kind === 'other')) blockers.push(", '} else if (false) blockers.push('),
  // ── B · 대화 감사 ──
  M('대화 감사 — 글쓴이 최상위 추가 허용', EV, EV_CHECK, 'own.some((c) => c.parentId === null) || ', ''),
  M('대화 감사 — 글쓴이 답글 여러 번 허용', EV, EV_CHECK,
    ' || own.length > PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX)', ')'),
  M('대화 감사 — 글쓴이 답글 한 번도 결함(옛 동작)', EV, EV_CHECK,
    "if (own.some((c) => c.parentId === null) || own.length > PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX) codes.add('FOLLOWUP_SELF')",
    "if (own.length > 0) codes.add('FOLLOWUP_SELF')"),
]

const FAIL_LINE = /❌|🔴 FAIL/
const dir = mkdtempSync(join(tmpdir(), 'd10-root-mut-'))
const run = (check: string): { code: number; judged: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { code: r.status ?? 99, judged: FAIL_LINE.test(r.stdout ?? ''), tail: out.trim().split('\n').slice(-1)[0] ?? '' }
}
let bad = 0
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ D10 근본 보정 변이 시험 (worktree 변경 0 · 판정 FAIL 만 잡힘으로 센다) ══')
  for (const c of [...new Set(MUTATIONS.map((m) => m.check))]) {
    const b = run(c)
    console.log(`  ${b.code === 0 ? '✅' : '🔴'} 기준선 ${c} — exit ${b.code} (${b.tail})`)
    if (b.code !== 0) throw new Error(`기준선이 FAIL 이다 — ${c}`)
  }
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) { bad += 1; console.log(`  🔴 변이 자리 ${n}곳(정확히 1곳이어야 한다) — ${m.name}`); continue }
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run(m.check)
      if (r.code === 0) { bad += 1; console.log(`  🔴 살아남음 ${m.name}`) }
      else if (!r.judged) { bad += 1; console.log(`  🔴 로드 실패(잡힘 아님) ${m.name} — exit ${r.code} · ${r.tail}`) }
      else console.log(`  ✅ 잡힘 ${m.name}`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad === 0 ? '✅ PASS' : `🔴 FAIL ${bad}건`} — 변이 ${MUTATIONS.length}개`)
process.exit(bad === 0 ? 0 : 1)
