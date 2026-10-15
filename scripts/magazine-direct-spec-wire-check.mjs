#!/usr/bin/env node
/**
 * `DIRECT_SPEC_V1` adapter 계약 검사.
 *
 * 🔴 **운영 접근 0.** 이 검사는 임시 디렉터리에만 쓰고, Chrome · CDP · ChatGPT · HTTP · DB 를
 *    사용하지 않는다. adapter 외부에서 adapter 로 가는 유일한 자리다 — grep 으로 "운영
 *    scripts 가 adapter 를 import 하지 않는다" 를 확인한다.
 *
 * 반례 (각 반례는 adapter 또는 운영 계약이 깨졌을 때 FAIL 한다):
 *   W01  compile 은 결정론적이다 (같은 입력 → 같은 specHash · canonical JSON)
 *   W02  객체 key 순서 변화는 specHash 를 바꾸지 않는다
 *   W03  verifyArticleSpec 실패는 fail-closed throw (compile 뒤 persist 안 함)
 *   W04  opt-in flag 없는 queueItem 은 legacy 로 간다 (fail-closed · 기본 legacy)
 *   W05  모르는 directSpecMode 는 legacy 로 되돌아간다
 *   W06  message 는 schemaVersion · specHash 를 글자 그대로 포함한다 (identity 운반)
 *   W07  message 지문은 spec canonical JSON 의 함수다 — spec 바뀌면 지문 바뀐다
 *   W08  message 조립은 brief.md 파일을 읽지 않는다 (사람이 쓴 brief 조작과 무관)
 *   W09  adapter 조립 brief 는 운영 `judgeBriefFormatContract` 를 통과한다
 *   W10  direct 지문은 legacy 지문과 다르다 (같은 slug 라도 섞이지 않는다)
 *   W11  QA 재생성 패킷은 specHash 를 운반한다 — 같은 (specHash, failures) → 같은 packetHash
 *   W12  QA 재생성 패킷은 다른 failures → 다른 packetHash
 *   W13  register sidecar 는 멱등이다 (같은 specHash 두 번 → written=false)
 *   W14  register sidecar 는 identity 가 바뀌면 fail-closed (다른 specHash 재등록 금지)
 *   W15  handoff 는 세 자리 (provider · QA · register) 에서 **같은** specHash 를 흘려 보낸다
 *   W16  DELIVERY_UNCERTAIN HOLD 는 같은 지문에 대해서만 설정된다
 *   W17  spec 파일이 없으면 message/gate 는 DIRECT_SPEC_MISSING 으로 fail-closed
 *   W18  손상된 spec 은 verify 실패 코드로 fail-closed (즉, 쓰기 전 catch)
 *   W19  adapter 는 사이드-이펙트 심볼 (Chrome·CDP·HTTP·DB) 을 import 하지 않는다
 *   W20  운영 호출체인 scripts 는 adapter 를 import 하지 않는다 (운영 접근 0)
 *   W21  canary slug 는 운영 topic-queue · articles.ts 에 없다
 *   W22  LEGACY_BRIEF_V1 fallback 상수는 유지된다 (bounded rollback 경로)
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

import {
  ARTICLE_SPEC_MODE,
  ARTICLE_SPEC_SCHEMA,
  articleSpecHash,
  canonicalJson,
  compileArticleSpec,
  verifyArticleSpec,
} from './lib/magazine-article-spec.mjs'
import { buildManuscriptMessage } from './lib/chatgpt-session.mjs'
import { deliveryFingerprintOf } from './lib/magazine-quarantine.mjs'
import {
  ARTICLE_SPEC_FILENAME,
  ARTICLE_SPEC_REGISTER_LEDGER,
  DIRECT_SPEC_MODE,
  DIRECT_SPEC_OPT_IN_FIELD,
  DIRECT_SPEC_PROMPT_MARKER,
  DIRECT_SPEC_PROMPT_TEXT,
  LEGACY_BRIEF_MODE,
  compileAndPersistDirectSpec,
  directSpecBriefText,
  directSpecDeliveryGate,
  directSpecIdentityHandoff,
  directSpecMessageFor,
  directSpecRegenPacket,
  readDirectSpec,
  registerDirectSpecSidecar,
  resolveMagazineAutoMode,
} from './lib/magazine-direct-spec.mjs'
import { judgeBriefFormatContract } from './lib/magazine-manuscript-format.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FIXTURE_INPUT = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`) }
  catch (error) { fail++; console.error(`FAIL ${name}: ${error?.stack ?? error}`) }
}
const checkAsync = async (name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${name}`) }
  catch (error) { fail++; console.error(`FAIL ${name}: ${error?.stack ?? error}`) }
}

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_INPUT, 'utf8'))
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`))
}

const CLEANUP = []
function tmp(prefix) { const d = makeTmp(prefix); CLEANUP.push(d); return d }
process.on('exit', () => { for (const d of CLEANUP) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

// ── W01 · W02 결정론 ────────────────────────────────────────
check('W01 compile 은 결정론 — 같은 입력 → 같은 specHash 와 canonical JSON', () => {
  const input = loadFixture()
  const d1 = tmp('ds-w01-a'), d2 = tmp('ds-w01-b')
  const a = compileAndPersistDirectSpec({ input, draftsDir: d1 })
  const b = compileAndPersistDirectSpec({ input, draftsDir: d2 })
  assert.equal(a.specHash, b.specHash)
  assert.equal(a.canonicalJson, b.canonicalJson)
  assert.equal(a.schemaVersion, ARTICLE_SPEC_SCHEMA)
  assert.equal(a.mode, ARTICLE_SPEC_MODE)
})
check('W02 객체 key 순서는 specHash 에 영향을 주지 않는다', () => {
  const input = loadFixture()
  const reversed = JSON.parse(JSON.stringify(input))
  reversed.node = Object.fromEntries(Object.entries(reversed.node).reverse())
  reversed.queueItem = Object.fromEntries(Object.entries(reversed.queueItem).reverse())
  const a = compileAndPersistDirectSpec({ input, draftsDir: tmp('ds-w02-a') })
  const b = compileAndPersistDirectSpec({ input: reversed, draftsDir: tmp('ds-w02-b') })
  assert.equal(a.specHash, b.specHash)
})

// ── W03 verifyArticleSpec 실패 → fail-closed ───────────────
check('W03 node.status 가 APPROVED 아니면 fail-closed throw (쓰기 전)', () => {
  const input = loadFixture()
  input.node.status = 'DRAFT'
  const d = tmp('ds-w03')
  assert.throws(() => compileAndPersistDirectSpec({ input, draftsDir: d }),
    (e) => e.code === 'ARTICLE_SPEC_NODE_NOT_APPROVED')
  assert.equal(existsSync(join(d, input.queueItem.slug, ARTICLE_SPEC_FILENAME)), false)
})

// ── W04 · W05 opt-in / legacy fallback ─────────────────────
check('W04 opt-in flag 없는 queueItem 은 legacy', () => {
  const r = resolveMagazineAutoMode({ slug: 'x', contentType: 'EVERGREEN' })
  assert.equal(r.mode, LEGACY_BRIEF_MODE)
})
check('W05 모르는 directSpecMode 는 legacy 로 되돌아간다 (fail-closed)', () => {
  const r = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' })
  assert.equal(r.mode, LEGACY_BRIEF_MODE)
  assert.match(r.reason, /모르는/)
  const r2 = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE })
  assert.equal(r2.mode, DIRECT_SPEC_MODE)
  const r3 = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: LEGACY_BRIEF_MODE })
  assert.equal(r3.mode, LEGACY_BRIEF_MODE)
})

// ── W06 · W07 identity 운반 ────────────────────────────────
check('W06 message 는 schemaVersion · specHash 를 글자 그대로 포함한다', () => {
  const input = loadFixture()
  const d = tmp('ds-w06')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const msg = directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
  assert.equal(msg.ok, true)
  assert.ok(msg.message.includes(ARTICLE_SPEC_SCHEMA), 'schemaVersion 라인이 message 에 없다')
  assert.ok(msg.message.includes(p.specHash), 'specHash 라인이 message 에 없다')
  assert.ok(msg.message.includes(DIRECT_SPEC_PROMPT_MARKER), 'direct 식별 marker 가 prompt 에 없다')
})
check('W07 spec 이 바뀌면 message 지문도 바뀐다', () => {
  const input = loadFixture()
  const d1 = tmp('ds-w07-a'), d2 = tmp('ds-w07-b')
  const p1 = compileAndPersistDirectSpec({ input, draftsDir: d1 })
  const m1 = directSpecMessageFor({ slug: p1.spec.identity.slug, draftsDir: d1 })

  const input2 = loadFixture()
  input2.queueItem.title = `${input2.queueItem.title} (수정)`
  const p2 = compileAndPersistDirectSpec({ input: input2, draftsDir: d2 })
  const m2 = directSpecMessageFor({ slug: p2.spec.identity.slug, draftsDir: d2 })

  assert.notEqual(p1.specHash, p2.specHash, 'title 바뀌면 specHash 바뀌어야 한다')
  assert.notEqual(m1.messageFingerprint, m2.messageFingerprint, '지문도 바뀌어야 한다')
})

// ── W08 brief.md 는 실행 권위가 아니다 ──────────────────────
check('W08 direct 경로는 brief.md 파일을 읽지 않는다 (사람 조작과 무관)', () => {
  const input = loadFixture()
  const d = tmp('ds-w08')
  const slug = input.queueItem.slug
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const m1 = directSpecMessageFor({ slug, draftsDir: d })
  // 가짜 사람 손 brief.md 를 심고 다시 조립한다 — 지문·message 바이트가 **달라지지 않아야** 한다.
  mkdirSync(join(d, slug), { recursive: true })
  writeFileSync(join(d, slug, 'brief.md'), '# 사람이 쓴 brief — 이 글자가 message 에 들어가면 안 된다\n', 'utf8')
  const m2 = directSpecMessageFor({ slug, draftsDir: d })
  assert.equal(m1.message, m2.message, 'brief.md 를 읽어 message 가 바뀌면 adapter 결함이다')
  assert.equal(m1.messageFingerprint, m2.messageFingerprint)
  assert.ok(!m2.message.includes('사람이 쓴 brief'), 'adapter 가 brief.md 글자를 message 에 섞었다')
  // specHash 는 그대로
  assert.equal(m2.specHash, p.specHash)
})

// ── W09 BRIEF_FORMAT_CONTRACT 통과 ─────────────────────────
check('W09 adapter 조립 brief 는 운영 judgeBriefFormatContract 를 통과한다', () => {
  const input = loadFixture()
  const d = tmp('ds-w09')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const brief = directSpecBriefText(p.spec)
  const contract = judgeBriefFormatContract(brief)
  assert.equal(contract.ok, true, `brief format contract 위반: ${JSON.stringify(contract.violations)}`)
})

// ── W10 legacy 지문 분리 ───────────────────────────────────
check('W10 direct 지문은 legacy 지문과 다르다 (같은 slug 라도 섞이지 않는다)', () => {
  const input = loadFixture()
  const d = tmp('ds-w10')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const direct = directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
  // legacy 지문은 "sha256:" + "legacy prompt + brief 블록" 이다. legacy prompt 는 adapter 상수와 다르다.
  const legacyPrompt = '아래 BRIEF 시작/끝 사이의 지시를 그대로 따라 최종 원고를 작성하세요. 설명·인사·요약·후기를 붙이지 말고 원고 전체만 출력합니다. 출력은 마크다운 코드블록 안에 마크다운 원본 표기 그대로 넣어 주세요. frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다. 웹 검색 인용 표기나 각주 마커를 본문에 남기지 마세요.'
  const legacyMessage = buildManuscriptMessage({ promptText: legacyPrompt, briefText: directSpecBriefText(p.spec) })
  const legacyFp = deliveryFingerprintOf(legacyMessage)
  assert.notEqual(direct.messageFingerprint, legacyFp,
    'direct prompt 가 legacy prompt 와 같은 글자다 — 지문이 섞인다')
})

// ── W11 · W12 QA 재생성 패킷 ───────────────────────────────
check('W11 QA 재생성 패킷은 specHash 를 운반한다 (같은 입력 → 같은 packetHash)', () => {
  const input = loadFixture()
  const d = tmp('ds-w11')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const failures = [{ code: 'FORMAT_01', label: '마지막 CTA 1개 아님' }]
  const a = directSpecRegenPacket({ spec: p.spec, failures })
  const b = directSpecRegenPacket({ spec: p.spec, failures })
  assert.equal(a.specHash, p.specHash)
  assert.equal(b.specHash, p.specHash)
  assert.equal(a.packetHash, b.packetHash)
  assert.ok(a.instruction.includes(p.specHash), 'instruction 글자에 specHash 가 들어가야 재생성 응답도 identity 를 잇는다')
  assert.ok(a.instruction.includes(ARTICLE_SPEC_SCHEMA))
})
check('W12 QA 재생성 패킷 — 다른 failures 는 다른 packetHash', () => {
  const input = loadFixture()
  const d = tmp('ds-w12')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const a = directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'A', label: 'a' }] })
  const b = directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'B', label: 'b' }] })
  assert.notEqual(a.packetHash, b.packetHash)
})

// ── W13 · W14 register sidecar 멱등 · identity 가드 ────────
check('W13 register sidecar 는 멱등이다 (같은 specHash 두 번 → written=false)', () => {
  const input = loadFixture()
  const d = tmp('ds-w13')
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const r1 = registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
  const r2 = registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
  assert.equal(r1.written, true)
  assert.equal(r2.written, false)
  assert.equal(r1.specHash, r2.specHash)
})
check('W14 다른 specHash 재등록은 fail-closed', () => {
  const input = loadFixture()
  const d = tmp('ds-w14')
  const slug = input.queueItem.slug
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
  const input2 = loadFixture()
  input2.queueItem.title = `${input2.queueItem.title} (수정)`
  const p2 = compileAndPersistDirectSpec({ input: input2, draftsDir: d })
  assert.notEqual(p2.specHash, p.specHash)
  assert.throws(() => registerDirectSpecSidecar({ spec: p2.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' }),
    (e) => e.code === 'DIRECT_SPEC_REGISTER_IDENTITY')
})

// ── W15 handoff identity 공유 ──────────────────────────────
check('W15 handoff — 세 자리에서 같은 specHash', () => {
  const input = loadFixture()
  const d = tmp('ds-w15')
  const r = directSpecIdentityHandoff({
    input, draftsDir: d,
    failuresForRegen: [{ code: 'W15', label: 'test' }],
    registeredAt: '2026-10-22T10:30:00+09:00',
    readLedger: () => ({ ok: true, store: {} }),
  })
  assert.equal(r.ok, true)
  assert.equal(r.provider.specHash, r.specHash)
  assert.equal(r.qaPacket.specHash, r.specHash)
  assert.equal(r.register.specHash, r.specHash)
})

// ── W16 DELIVERY_UNCERTAIN HOLD ────────────────────────────
check('W16 DELIVERY_UNCERTAIN HOLD 는 같은 지문에 대해서만 설정된다', () => {
  const input = loadFixture()
  const d = tmp('ds-w16')
  const slug = input.queueItem.slug
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  const m = directSpecMessageFor({ slug, draftsDir: d })

  // same fingerprint → HOLD
  const sameFp = m.messageFingerprint
  const gateSame = directSpecDeliveryGate({ slug, draftsDir: d,
    readLedger: () => ({ ok: true, store: { [slug]: { delivery: {
      kind: 'DELIVERY_UNCERTAIN', sent: null, messageFingerprint: sameFp, reason: 'test',
    } } } }) })
  assert.equal(gateSame.ok, true)
  assert.ok(gateSame.hold, 'same fingerprint → hold set')

  // different fingerprint → no hold
  const otherFp = 'sha256:' + 'f'.repeat(64)
  const gateOther = directSpecDeliveryGate({ slug, draftsDir: d,
    readLedger: () => ({ ok: true, store: { [slug]: { delivery: {
      kind: 'DELIVERY_UNCERTAIN', sent: null, messageFingerprint: otherFp, reason: 'test',
    } } } }) })
  assert.equal(gateOther.hold, null)
})

// ── W17 · W18 fail-closed on missing / corrupted spec ──────
check('W17 spec 파일이 없으면 message/gate 는 DIRECT_SPEC_MISSING', () => {
  const d = tmp('ds-w17')
  const r = directSpecMessageFor({ slug: 'canary-direct-spec-01', draftsDir: d })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'DIRECT_SPEC_MISSING')
})
check('W18 손상 spec (조작된 outline) 은 verify 실패 코드로 fail-closed', () => {
  const input = loadFixture()
  const d = tmp('ds-w18')
  const slug = input.queueItem.slug
  const p = compileAndPersistDirectSpec({ input, draftsDir: d })
  // outline 을 바꿔 다시 쓴다 — hash 재계산 없이. verify 는 ARTICLE_SPEC_HASH 로 FAIL 해야 한다.
  const specPath = join(d, slug, ARTICLE_SPEC_FILENAME)
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  spec.editorial.outline[0] = '손상된 outline'
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
  const r = readDirectSpec({ slug, draftsDir: d })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ARTICLE_SPEC_HASH')
  const m = directSpecMessageFor({ slug, draftsDir: d })
  assert.equal(m.ok, false)
  assert.equal(m.code, 'ARTICLE_SPEC_HASH')
})

// ── W19 adapter 소스가 사이드-이펙트 심볼을 import 하지 않는다 ─
check('W19 adapter 는 사이드-이펙트 심볼을 import 하지 않는다 (운영 접근 0)', () => {
  const src = readFileSync(join(ROOT, 'scripts/lib/magazine-direct-spec.mjs'), 'utf8')
  const forbidden = [
    { re: /from ['"]node:child_process['"]/, why: 'child_process import' },
    { re: /from ['"]node:http['"]/, why: 'http import' },
    { re: /from ['"]node:https['"]/, why: 'https import' },
    { re: /from ['"]node:net['"]/, why: 'net import' },
    { re: /from ['"]@prisma/, why: 'prisma import' },
    { re: /from ['"]playwright/, why: 'playwright import' },
    { re: /PROFILE_DIR|AUTOMATION_CDP_PORT|CHATGPT_URL|chromeArgs|cdpAvailable|browserAvailable|openChatPage|typeInComposer/,
      why: 'chatgpt-session 사이드-이펙트 심볼' },
  ]
  for (const f of forbidden) {
    assert.ok(!f.re.test(src), `adapter 가 ${f.why} 를 쓴다 — 운영 접근 0 깨짐`)
  }
})

// ── W20 운영 호출체인은 adapter 를 import 하지 않는다 ──────
check('W20 운영 호출체인 scripts 는 adapter 를 import 하지 않는다 (운영 접근 0)', () => {
  // adapter 를 import 하는 자리는 **이 wire-check 와 mutation 뿐**이어야 한다.
  const scripts = [
    'scripts/magazine-producer-plan.mjs',
    'scripts/magazine-producer-run.mjs',
    'scripts/magazine-webui-runner.mjs',
    'scripts/magazine-auto-register.mjs',
    'scripts/magazine-auto-register-ready.mjs',
    'scripts/magazine-brief-auto.mjs',
    'scripts/magazine-rehearsal.mjs',
    'scripts/magazine-input-repair.mjs',
    'scripts/lib/magazine-delivery-gate.mjs',
    'scripts/lib/magazine-regen.mjs',
    'scripts/lib/magazine-auto-lane.mjs',
    'scripts/lib/magazine-manuscript-guard.mjs',
  ]
  for (const rel of scripts) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    const src = readFileSync(abs, 'utf8')
    assert.ok(!/magazine-direct-spec\.mjs/.test(src),
      `${rel} 가 adapter 를 import 한다 — 좁은 canary 밖으로 흘러나갔다`)
  }
})

// ── W21 canary slug 는 운영 queue · articles.ts 에 없다 ────
check('W21 canary slug 는 운영 topic-queue / articles.ts 에 없다', () => {
  const fixture = loadFixture()
  const canarySlug = fixture.queueItem.slug
  for (const rel of ['src/content/magazine/topic-queue.ts', 'src/content/magazine/articles.ts']) {
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue
    const src = readFileSync(abs, 'utf8')
    assert.ok(!src.includes(canarySlug),
      `${rel} 가 canary slug (${canarySlug}) 를 포함한다 — 운영 데이터로 샜다`)
  }
})

// ── W22 LEGACY_BRIEF_V1 fallback 상수 유지 ─────────────────
check('W22 LEGACY_BRIEF_V1 상수는 유지된다 (bounded rollback 경로)', () => {
  assert.equal(LEGACY_BRIEF_MODE, 'LEGACY_BRIEF_V1')
  const src = readFileSync(join(ROOT, 'scripts/lib/magazine-direct-spec.mjs'), 'utf8')
  assert.ok(src.includes('LEGACY_BRIEF_V1'), 'adapter 가 legacy 모드를 아예 지웠다 — rollback 경로 없음')
})

// ── 결과 ───────────────────────────────────────────────────
console.log(`\nDIRECT_SPEC_V1 wire-check: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)
