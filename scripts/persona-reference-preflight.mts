#!/usr/bin/env tsx
/**
 * provider payload **preflight** — 🔴 외부 호출 0 · DB 0 · AI 0
 *
 * 🔴 **왜 필요한가** (2026-09-10, P0-1 사고 이후).
 *
 *    회차 `20260910-153254` 은 닉네임 약 454건을 프롬프트에 실어 보냈다.
 *    코드는 "댓글만 읽는다" 고 적혀 있었지만 **실제로 나가는 문자열을 아무도 보지 않았다.**
 *    선언이 아니라 **나갈 payload 자체**를 열어 확인한다.
 *
 * 🔴 이 스크립트는 프롬프트를 **만들기만** 하고 부르지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildCommentInput, voiceEvidenceFromAssets } from '../src/lib/persona-comment-input'
import { buildPromptFromInput } from './lib/persona-comment-bridge'
import {
  bundlesForPersonas, buildReferenceManifest, loadCanonAsset, loadLocalComments, REFERENCE_SOURCES,
} from './lib/persona-reference-store.mjs'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { judgeVoiceSeparation } from '../src/lib/persona-voice-reference'
import { COMMENT_REACTION_ROLES } from '../src/lib/persona-reaction-roles'
import { judgePostRichness, postBodyOf, SYNTHETIC_POSTS } from '../src/lib/persona-eval-posts'
import { findExperienceClaims, groundingTextOf } from '../src/lib/persona-experience-grounding'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, hint = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  ❌ ${name}${hint ? ` — ${hint}` : ''}`) }
}

console.log('\n══ provider payload preflight (🔴 호출 0) ══\n')

/**
 * 🔴 **정본 universe 를 그대로 쓴다** (2026-09-11 정정).
 *
 *    옛 판은 `S01`~`S10` 을 손으로 만들어 넣었다. 그 코드들은 합성 실험 시절의
 *    잔재이고 지금 정본 universe(`PRODUCTION_PERSONA_CODES` = P 코드)에 없다.
 *    그래서 `bundlesForPersonas` 가 열 개를 전부 "정본 밖" 으로 돌려보냈고,
 *    묶음이 하나도 서지 않아 **preflight 가 언제나 exit 1** 이었다 —
 *    payload 를 한 번도 열어 보지 못한 채 "근거가 없다" 만 찍고 끝났다.
 *
 * 🔴 목록을 여기 다시 적지 않는다. 정본이 늘면 이 스크립트도 같이 늘어야 한다.
 */
const ref = bundlesForPersonas({
  repoRoot: process.cwd(), personaCodes: PRODUCTION_PERSONA_CODES,
})
console.log(`  자산 출처  ${ref.origin}`)
console.log(`  대상 Persona  정본 ${PRODUCTION_PERSONA_CODES.length}종 · 묶음이 선 것 ${ref.byCode.size}종`)
for (const b of ref.blocks) console.log(`  🟡 ${b}`)
if (ref.byCode.size === 0) {
  /**
   * 🔴 **자산 "부재" 만 SKIP 이다.**
   *
   *    정본 파일이 아예 없고 개발 자산도 없으면 preflight 가 열어 볼 payload 자체가
   *    없다 — CI 는 worktree 밖 600 권한 자산을 볼 수 없으므로 늘 이 경우다.
   *    그때는 **건너뛴 사실을 크게 적고** 정상 종료한다.
   *
   * 🔴 **그 밖은 전부 실패다.** 자산이 있는데 digest 가 어긋났거나(`ASSET_DIGEST_MISMATCH`),
   *    manifest 가 없거나, 권한이 느슨하거나, 있는데도 묶음이 서지 않으면 exit 1 이다.
   *    "없어서 못 했다" 와 "있는데 틀렸다" 를 같이 넘기면 검사가 장식이 된다.
   */
  const canon = loadCanonAsset()
  if (canon.code === 'ASSET_MISSING' && ref.rows.length === 0) {
    console.log(`\n🟡 SKIP — 정본 자산이 없다 (${canon.code}) · 개발 자산도 없다`)
    console.log(`   ${canon.reason}`)
    console.log('   🔴 검사를 통과한 것이 아니다. 자산이 있는 곳에서 돌려야 한다.\n')
    process.exit(0)
  }
  console.log(`\n🔴 근거가 없다 — preflight 를 돌릴 것이 없다 (${canon.code}: ${canon.reason})\n`)
  process.exit(1)
}

// ── 🔴 대조군: 자산의 작성자·원글 본문을 실제로 읽어 둔다 ──
const authors = new Set<string>()
const bodies: string[] = []
for (const rel of REFERENCE_SOURCES) {
  let rows: { author?: unknown; body?: unknown; comments?: unknown }[] = []
  try { rows = JSON.parse(readFileSync(`${process.cwd()}/${rel}`, 'utf-8')) } catch { continue }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (typeof r.body === 'string' && r.body.trim() !== '') bodies.push(r.body.trim())
    for (const c of Array.isArray(r.comments) ? r.comments : []) {
      const a = (c as { author?: unknown }).author
      if (typeof a === 'string' && a.trim() !== '') authors.add(a.trim())
    }
  }
}
console.log(`  대조군  작성자 ${authors.size}명 · 원글 본문 ${bodies.length}건 (payload 에 있으면 안 되는 것들)\n`)

const manifest = buildReferenceManifest({
  sourceDigest: ref.sourceDigest ?? '(미상)', rows: ref.rows, bundles: [...ref.byCode.values()],
})
console.log(`  manifest  sanitizer ${manifest.sanitizerVersion} · 코퍼스 ${manifest.commentCount}건`)
console.log(`            corpus ${manifest.sanitizedCorpusDigest} · bundle ${manifest.personaBundleDigest}`)
check(`🔴 식별자 유출 검사를 돌렸다`, manifest.identityLeakCheck.ran)
check(`🔴 식별자 유출 0건 (${manifest.identityLeakCheck.detail})`, manifest.identityLeakCheck.hits === 0)

// ── 실제로 나갈 payload 를 만든다 ──
const ELIGIBLE = COMMENT_REACTION_ROLES.filter((r) => r !== 'experience')
const payloads: { code: string; role: string; system: string; user: string }[] = []
let i = 0
for (const [code, bundle] of ref.byCode) {
  const role = ELIGIBLE[i % ELIGIBLE.length]!
  const sp = SYNTHETIC_POSTS[i % SYNTHETIC_POSTS.length]!
  i += 1
  const built = buildCommentInput({
    persona: {
      code, ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
      identity: { job: `합성-${i}`, note: '비교용 합성 설정 — 실제 인물이 아니다' },
      voiceCore: { ending: '~해요', register: '존댓말', emoji: '없음', length: '중간 길이' },
      voiceVariations: ['질문형', '맞장구형'],
      noGoTopics: ['정치'], noGoExpressions: ['~하시길'], forbiddenReactionRoles: [],
    },
    post: {
      id: sp.id, title: sp.title,
      // 🔴 한 줄 요약이 아니라 여러 문장 (P0-3)
      bodyDigest: postBodyOf(sp), boardLabel: sp.boardLabel, existingCommentDigests: [],
    },
    reactionRole: role,
    voice: voiceEvidenceFromAssets({
      voiceCore: { ending: '~해요', register: '존댓말', emoji: '없음', length: '중간 길이' },
      voiceVariations: ['질문형', '맞장구형'],
    }),
    memory: { has: false, note: '' },
  })
  if (!built.ok) { console.log(`  🔴 ${code} 입력 실패 — ${built.blocks.map((b) => b.code).join(',')}`); continue }
  const p = buildPromptFromInput(built.input, [], bundle)
  if (!p.ok) { console.log(`  🔴 ${code} 프롬프트 실패 — ${p.blocks.map((b) => b.code).join(',')}`); continue }
  payloads.push({ code, role, system: p.prompt.systemPrompt, user: p.prompt.userPayload })
}
console.log(`\n  payload ${payloads.length}건 생성 (🔴 보내지 않는다)\n`)
check('payload 가 Persona 수만큼 만들어졌다', payloads.length === ref.byCode.size)

// ── 🔴 나갈 문자열 전수 검사 ──
const all = payloads.map((p) => `${p.system}\n${p.user}`).join('\n')
/**
 * 🔴 **두 갈래로 나눠 본다.**
 *
 *    ① 근거 텍스트가 작성자 식별자와 **완전히 같은가** — 이것이 진짜 유출이다.
 *    ② 지시문(참고 댓글 블록 **밖**)에 작성자명이 있는가 — 있으면 배선 사고다.
 *
 * 🔴 전체 payload 에 대한 부분일치는 쓰지 않는다. 두 글자 닉네임이
 *    평범한 문장 안에 우연히 들어 있어 늘 걸린다(실측 2건) —
 *    늘 걸리는 검사는 아무것도 말해 주지 않는다.
 */
const refTexts = new Set([...ref.byCode.values()].flatMap((b) => b.comments.map((c) => c.text)))
const exactHits = [...refTexts].filter((t) => authors.has(t.trim())).length
check(`🔴 근거 텍스트가 작성자 식별자와 같은 것 0건 (얻은 값 ${exactHits})`, exactHits === 0)

/** 지시문만 남긴다 — 참고 댓글 줄(`- ` 로 시작)을 걷어낸다 */
const scaffold = payloads.map((p) => p.system.split('\n')
  .filter((line) => !refTexts.has(line.replace(/^- /, '').trim()))
  .join('\n') + '\n' + p.user).join('\n')
const scaffoldHits = [...authors].filter((a) => a.length >= 3 && scaffold.includes(a))
check(`🔴 지시문에 작성자 식별자 0건 (얻은 값 ${scaffoldHits.length})`, scaffoldHits.length === 0)

const bodyHits = bodies.filter((b) => all.includes(b.slice(0, 40)) && b.length >= 40)
check(`🔴 payload 에 자산 원글 본문 0건 (얻은 값 ${bodyHits.length})`, bodyHits.length === 0)
check('🔴 payload 에 API key 문자열이 없다', !/sk-[A-Za-z0-9]/.test(all))

// ── 🔴 근거가 실제로 실렸는가 ──
let carried = 0
for (const p of payloads) {
  const b = ref.byCode.get(p.code)!
  if (b.comments.every((c) => p.system.includes(c.text))) carried += 1
}
check(`🟢 근거 댓글이 payload 에 실렸다 (${carried}/${payloads.length})`, carried === payloads.length)

// ── 🔴 억지 유도가 되살아나지 않았는가 ──
/**
 * 🔴 **지시문 기준으로 본다.** 참고 댓글에 우연히 같은 말이 들어 있을 수 있고,
 *    그것은 사람이 실제로 쓴 말이라 막을 이유가 없다. 막을 것은 **우리가 시키는 것**이다.
 */
/**
 * 🔴 **`'120자'` 는 목록에서 뺐다** (2026-09-11).
 *
 *    그 항목은 옛 프롬프트의 **고정 길이 지시**("120자 내외로")를 잡으려던 것이다.
 *    그런데 지금 길이 문장은 `${ref.lengths.median}자` 로 **그 Persona 자신의
 *    참고 댓글에서 잰 값**이다(`persona-prompt.ts`). P10 의 중앙값이 마침 120 이라
 *    금지어에 걸렸다 — 잡아야 할 것은 숫자가 아니라 **고정하라는 말**이다.
 *
 *    숫자 자체를 금지하면 다음 회차에 중앙값이 121 이 되는 순간 검사가 통과한다.
 *    늘 걸리거나 우연히 통과하는 검사는 아무것도 지키지 않는다.
 *    고정 지시 여부는 아래 ③ 이 **형태**로 본다.
 */
for (const bad of ['설거지하다 말고', '창밖 보다가', '커피 식는 줄도 모르고',
  '첫 문장을 여는 방법', '이 글자로 시작하지 않습니다', '한두 문장',
  '지금 뭘 하다 이 글을 봤는지', '말끝을 서로 다르게']) {
  check(`🔴 지시문에 "${bad}" 가 없다`, !scaffold.includes(bad))
}
check('🟢 원글에 직접 반응하라고 말한다', payloads.every((p) => p.system.includes('윗글에 직접 반응하면 됩니다')))
check('🔴 experience 역할이 배정되지 않았다', payloads.every((p) => p.role !== 'experience'))

// ── 말투 분리 ──
const sep = judgeVoiceSeparation([...ref.byCode.values()])
console.log(`\n  🔴 말투 분리(문체 거리) 최소 ${sep.minDistance.toFixed(3)} · 가장 가까운 쌍 ${sep.closestPair}`)
console.log('     🔴 "겹치지 않는다" 는 말투 차이의 증거가 아니다 — 위 거리가 근거다')
console.log('\n  code  역할       anchor 보완 비중  중앙  p90')
for (const t of ref.table) {
  const role = payloads.find((p) => p.code === t.personaCode)?.role ?? '-'
  console.log(`   ${t.personaCode}  ${role.padEnd(11)} ${String(t.anchorComments).padStart(4)}`
    + ` ${String(t.supplements).padStart(4)} ${(t.anchorRatio * 100).toFixed(0).padStart(4)}%`
    + ` ${String(t.medianLen).padStart(5)} ${String(t.p90Len).padStart(4)}`)
}

// ── 🔴 P0-3 사람이 읽고 확인할 것 셋 ──
console.log('\n══ 사람이 읽고 확인할 것 (🔴 아직 보내지 않았다) ══')
for (const sp of SYNTHETIC_POSTS) {
  const r = judgePostRichness(sp)
  check(`① 원글 「${sp.title}」에 반응할 정보가 충분한가 (${r.reason})`, r.ok)
}
/** ② 참고 댓글 사실이 Persona 사실로 섞이지 않았는가 — 프롬프트가 그렇게 말하는가 */
check('② 참고 댓글의 경험을 자기 것으로 옮기지 말라고 말한다',
  payloads.every((p) => p.system.includes('그 사람들의 경험은 당신의 경험이 아닙니다')))
check('② 근거 없는 Persona 에게 자기 이야기를 지어내지 말라고 말한다',
  payloads.every((p) => p.system.includes('들려줄 자기 이야기가 없습니다')))
/**
 * ③ 길이를 고정하지 않았는가 — 🔴 **숫자가 아니라 "고정하라는 말" 을 본다.**
 *
 *    옛 판은 `/\b120자\b/` 였다. JS 의 `\b` 는 `[A-Za-z0-9_]` 경계라
 *    `자` 앞뒤에서는 성립하지 않는다 — 그 정규식은 **어떤 입력에도 걸리지 않았고**,
 *    통과 표시만 찍고 아무것도 재지 않았다(실측: 지시문에 `120자` 가 있는데도 통과).
 *
 *    재야 하는 것은 "그 길이에 맞춰 써라" 는 **지시 형태**다.
 */
const FIXED_LENGTH = /\d+\s*자\s*(이내|안팎|정도로|내외|로 맞|에 맞|로 써|로 쓰|씩)/
check('③ 길이를 숫자 하나로 고정하지 않는다',
  payloads.every((p) => p.system.includes('맞출 필요는 없습니다')
    && !FIXED_LENGTH.test(p.system) && !p.system.includes('한두 문장')))
/** 🔴 그 정규식이 실제로 무언가를 잡는지 — 잡지 못하는 가드는 장식이다 */
check('③ 고정 길이 지시 형태를 실제로 잡는다',
  FIXED_LENGTH.test('120자 이내로 쓰세요') && FIXED_LENGTH.test('80자 내외')
  && !FIXED_LENGTH.test('보통 120자쯤, 긴 것은 167자 넘게도 씁니다'))

const OUT = 'tmp/wave-e/payload-preflight.txt'
mkdirSync('tmp/wave-e', { recursive: true })
writeFileSync(OUT, payloads.map((p) =>
  `${'='.repeat(70)}\n[${p.code} · ${p.role}]\n${'='.repeat(70)}\n`
  + `--- system ---\n${p.system}\n\n--- user ---\n${p.user}\n`).join('\n'), 'utf-8')
console.log(`\n  🔴 보낼 payload 전문을 파일로 남겼다 — ${OUT}`)
console.log('     (사람이 직접 열어 읽는다. 통과 표시만 보고 넘어가지 않는다)')

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
