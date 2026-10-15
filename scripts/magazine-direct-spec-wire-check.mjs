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
 *   W04  opt-in flag 없는 queueItem 은 legacy 로 간다 (ok:true · 기본 legacy)
 *   W05  모르는 directSpecMode 는 **legacy 로도 가지 않는다** — ok:false, code:UNKNOWN_MAGAZINE_AUTO_MODE
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
 *   W20  **운영 공용 경계(`deliveryGate`) wiring 동작 단언** — fixture queueItem 으로 direct 1, legacy 1 을 증명한다
 *   W21  canary slug 는 운영 topic-queue · articles.ts 에 없다
 *   W22  LEGACY_BRIEF_V1 fallback 상수는 유지된다 (bounded rollback 경로)
 *   W23  legacy 입력 — queueItem 미지정 / 명시 LEGACY_BRIEF_V1 / 빈 flag — 셋이 **같은 바이트**다
 *   W24  모르는 directSpecMode — deliveryGate 가 legacy provider 로도 보내지 않는다 (ok:false, 메시지·지문 0)
 *   W25  direct mode + article-spec.json 없음 — deliveryGate 가 DIRECT_SPEC_MISSING 으로 fail-closed (전송·예약 0)
 *   W26  direct mode + 손상 spec — deliveryGate 가 ARTICLE_SPEC_HASH 로 fail-closed (전송·예약 0)
 *   W27  direct mode + regen packet — 같은 spec identity 만 허용하고 다른 identity 는 차단
 *   W28  auto-lane gate — direct 는 brief/review 없이, **현재 승인 source 와 같은 spec 일 때만** 통과
 *        (source 없음 → DIRECT_SPEC_SOURCE_NOT_READY · 2026-10-15 Codex P0). legacy 는 기존대로 차단
 *   W29  run target — legacy runId 불변, direct mode 신원과 queueItem 운반
 *   W30  batch plan — direct spec 누락은 probe·Chrome 0
 *   W31  merge gate — 등록 slug의 spec/sidecar만 허용
 *   W32  auto-register — 성공한 direct 등록에만 spec sidecar 영수증 기록
 *   W33  auto-register — sidecar identity 충돌 시 BLOCKED·기존 바이트 보존
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
  UNKNOWN_MAGAZINE_AUTO_MODE,
  compileAndPersistDirectSpec,
  directSpecBriefText,
  directSpecDeliveryGate,
  directSpecIdentityHandoff,
  directSpecMessageFor,
  directSpecRegenPacket,
  directSpecRegenMessageFor,
  readDirectSpec,
  registerDirectSpecSidecar,
  resolveMagazineAutoMode,
} from './lib/magazine-direct-spec.mjs'
import { deliveryGate, plannedMessageFor } from './lib/magazine-delivery-gate.mjs'
import { saveQuarantine, QUARANTINE_PATH } from './lib/magazine-quarantine.mjs'
import { judgeBriefFormatContract } from './lib/magazine-manuscript-format.mjs'
import { gate as autoLaneGate } from './lib/magazine-auto-lane.mjs'
import {
  DIRECT_SPEC_SOURCE_SCHEMA, directSpecSourceHash, directSpecSourcePath, productBasisFor, readProductGraphState, readProductGraphVersion,
} from './lib/magazine-direct-spec-source.mjs'

/** 등록 gate 는 현재 승인 source 를 요구한다 — 시험 폴더에 fixture 와 같은 내용의 승인 source 를 놓는다 */
function writeApprovedSource(d, input, gv) {
  // 🔴 승인 basis — 소비 관문과 같은 helper 로 실제 제품 판에서 계산한다
  const productBasis = productBasisFor(readProductGraphState(ROOT), { intentId: input.node.intentId, queueCluster: input.queueItem.cluster })
  const entry = { status: 'APPROVED', approvedBy: 'wire-check', approvedAt: '2026-10-15T12:00:00+09:00',
    g8ManifestHash: input.queueItem.g8ManifestHash, node: input.node, relations: input.relations,
    hero: input.hero, publication: input.publication, productBasis }
  entry.sourceHash = directSpecSourceHash(entry)
  const sp = directSpecSourcePath(d, gv)
  mkdirSync(dirname(sp), { recursive: true })
  writeFileSync(sp, JSON.stringify({ schema: DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: gv, entries: [entry] }))
}
import { fetchTargets, runIdOf } from './lib/magazine-run-targets.mjs'
import { judgeFile } from './lib/magazine-merge-gate.mjs'
import { fetchBatch } from './magazine-webui-runner.mjs'
import { drive } from './magazine-auto-register.mjs'

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

// ── W04 · W05 opt-in / legacy / unknown ────────────────────
check('W04 opt-in flag 없는 queueItem 은 legacy (ok:true)', () => {
  const r = resolveMagazineAutoMode({ slug: 'x', contentType: 'EVERGREEN' })
  assert.equal(r.ok, true)
  assert.equal(r.mode, LEGACY_BRIEF_MODE)
  // null · undefined · '' 도 전부 legacy
  for (const v of [null, undefined, '']) {
    const rv = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: v })
    assert.equal(rv.ok, true)
    assert.equal(rv.mode, LEGACY_BRIEF_MODE)
  }
})
check('W05 모르는 directSpecMode — ok:false, UNKNOWN_MAGAZINE_AUTO_MODE (legacy provider 로도 보내지 않는다)', () => {
  const r = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' })
  assert.equal(r.ok, false, '모르는 mode 는 ok:true 로 돌려주면 안 된다 (legacy 로 묻어 넘기면 rollback 계약이 깨진다)')
  assert.equal(r.code, UNKNOWN_MAGAZINE_AUTO_MODE)
  assert.equal(r.mode, null)
  assert.match(r.why, /모르는/)

  // 명시 LEGACY_BRIEF_V1 은 ok:true · legacy
  const rl = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: LEGACY_BRIEF_MODE })
  assert.equal(rl.ok, true)
  assert.equal(rl.mode, LEGACY_BRIEF_MODE)

  // 명시 DIRECT_SPEC_V1 은 ok:true · direct
  const rd = resolveMagazineAutoMode({ [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE })
  assert.equal(rd.ok, true)
  assert.equal(rd.mode, DIRECT_SPEC_MODE)
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

// ── W20 운영 공용 경계(deliveryGate) wiring 동작 단언 ──────
//    🔴 **adapter 미사용 단언은 폐기한다.** 적절한 자리에서는 운영이 adapter 를 "써야" 한다 —
//       그 자리가 narrow common boundary (`deliveryGate` · `plannedMessageFor`) 다. 아래는
//       그 경계를 **실제로 import 해 호출하고**, direct 1 / legacy 1 이 동작하는지 바이트로 본다.
//    🔴 fixture 입력만 쓴다 — 운영 topic-queue 에는 opt-in 행이 없다. 운영 접근 0 은
//       W19 (adapter 가 Chrome/CDP/HTTP/DB 미import), W21 (canary slug 가 운영 큐에 없음) 이 지킨다.

/** direct · legacy 공용 sandbox — article-spec.json 과 brief.md 를 같이 둔다.
 *    🔴 legacy brief.md 는 adapter 조립 brief 에서 **specHash 라인을 뺀** 글자다. legacy 경로가
 *       spec identity 를 **"의도치 않게" 운반하지 못하도록** 분리한다 — 그래야 direct 와 legacy 가
 *       지문·바이트로 확실히 구분된다. */
function makeDirectAndLegacySandbox() {
  const input = loadFixture()
  // 🔴 전송 관문은 현재 제품 판 basis 를 다시 맞춘다 — fixture 를 현재 graphVersion 에 둔다
  input.node.graphVersion = readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
  const d = tmp('ds-w20')
  const persisted = compileAndPersistDirectSpec({ input, draftsDir: d })
  const slug = persisted.spec.identity.slug
  mkdirSync(join(d, slug), { recursive: true })
  const legacyBrief = directSpecBriefText(persisted.spec)
    .split('\n')
    .filter((line) => !line.includes('specHash'))
    .join('\n')
  writeFileSync(join(d, slug, 'brief.md'), legacyBrief, 'utf8')
  const quarantinePath = join(d, 'quarantine.json')
  saveQuarantine({}, quarantinePath)
  // 🔴 전송 경계는 정본 큐 행 + 현재 승인 source 로 다시 검증한다 — 시험 판·큐를 주입한다
  writeApprovedSource(d, input, input.node.graphVersion)
  const directSourceDeps = { queue: () => [input.queueItem], expectedGraphVersion: () => input.node.graphVersion, productRoot: () => ROOT }
  // 🔴 legacy 호출은 direct 흔적(article-spec.json)이 없는 폴더에서 한다 — 흔적이 있으면 legacy 로 강등하지 않는다
  const legacyDraftsDir = tmp('ds-w20-legacy')
  mkdirSync(join(legacyDraftsDir, slug), { recursive: true })
  writeFileSync(join(legacyDraftsDir, slug, 'brief.md'), legacyBrief, 'utf8')
  return { input, draftsDir: d, slug, specHash: persisted.specHash, quarantinePath, directSourceDeps, legacyDraftsDir }
}

check('W20 wiring 동작 — fixture queueItem 으로 deliveryGate 를 호출해 direct 1 · legacy 1 을 증명한다', () => {
  const { input, draftsDir, slug, specHash, quarantinePath, directSourceDeps, legacyDraftsDir } = makeDirectAndLegacySandbox()

  // ── direct 1: queueItem.directSpecMode === 'DIRECT_SPEC_V1' ─────
  const directQI = { ...input.queueItem, [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE }
  const directGate = deliveryGate({ slug, draftsDir, quarantinePath, queueItem: directQI, directSourceDeps })
  assert.equal(directGate.ok, true, `direct gate 가 ok 가 아니다 — ${directGate.code ?? ''}: ${directGate.why ?? ''}`)
  assert.equal(directGate.mode, DIRECT_SPEC_MODE, 'direct gate 가 mode 를 알리지 않는다 (wiring 미적용?)')
  assert.equal(directGate.specHash, specHash, 'direct gate 가 specHash 를 운반하지 않는다')
  assert.ok(directGate.message.includes(specHash),
    'direct message 글자에 specHash 가 없다 — adapter 가 아닌 다른 생성기가 돌았다')
  assert.ok(directGate.message.includes(ARTICLE_SPEC_SCHEMA),
    'direct message 글자에 schemaVersion 이 없다 — identity 운반 끊김')
  assert.ok(directGate.message.includes(DIRECT_SPEC_PROMPT_MARKER),
    'direct marker 가 message 에 없다 — adapter prompt 가 조립되지 않았다')

  // ── legacy 1: 미지정 queueItem — 기존 호출자와 **같은 바이트** ─
  const legacyGate = deliveryGate({ slug, draftsDir: legacyDraftsDir, quarantinePath })
  assert.equal(legacyGate.ok, true, `legacy gate 가 ok 가 아니다 — ${legacyGate.code ?? ''}: ${legacyGate.why ?? ''}`)
  assert.notEqual(legacyGate.message, directGate.message,
    'legacy message 가 direct message 와 글자 동일 — adapter 가 legacy 자리까지 침범했다')
  assert.notEqual(legacyGate.messageFingerprint, directGate.messageFingerprint,
    '지문이 같으면 HOLD 가 섞인다 — direct · legacy 는 다른 지문이어야 한다')

  // 🔴 legacy 는 **wiring 전/후 바이트 동일**을 지문으로 증명한다 — plannedMessageFor 를
  //    queueItem 미지정으로 다시 돌려 **지금 wiring 분기를 지난 결과**와 bitwise 같아야 한다.
  const legacyPlanned = plannedMessageFor(slug, legacyDraftsDir)
  assert.equal(legacyGate.message, legacyPlanned,
    'deliveryGate 와 plannedMessageFor 가 legacy 자리에서 다른 글자를 만들었다 — wiring 가 legacy 를 건드렸다')
})

check('W23 legacy 입력 — 미지정 · 명시 LEGACY · 빈 flag · 임의 non-opt-in 속성 — 넷이 같은 바이트', () => {
  const { slug, quarantinePath, legacyDraftsDir: draftsDir } = makeDirectAndLegacySandbox()
  const gUndef = deliveryGate({ slug, draftsDir, quarantinePath })
  const gExplicit = deliveryGate({ slug, draftsDir, quarantinePath, queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: LEGACY_BRIEF_MODE } })
  const gEmpty = deliveryGate({ slug, draftsDir, quarantinePath, queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: '' } })
  const gUnrelated = deliveryGate({ slug, draftsDir, quarantinePath, queueItem: { slug, title: 't', contentType: 'EVERGREEN' } })
  for (const [label, g] of [['undef', gUndef], ['explicit', gExplicit], ['empty', gEmpty], ['unrelated', gUnrelated]]) {
    assert.equal(g.ok, true, `${label} gate 가 ok 가 아니다 — ${g.code ?? ''}`)
  }
  assert.equal(gExplicit.message, gUndef.message, '명시 LEGACY_BRIEF_V1 과 미지정이 바이트 다르다')
  assert.equal(gEmpty.message, gUndef.message, '빈 flag 와 미지정이 바이트 다르다')
  assert.equal(gUnrelated.message, gUndef.message, '비관련 queueItem 과 미지정이 바이트 다르다')
  assert.equal(gExplicit.messageFingerprint, gUndef.messageFingerprint)
})

check('W24 모르는 directSpecMode — deliveryGate 가 legacy provider 로도 보내지 않는다 (ok:false · 메시지·지문 0)', () => {
  const { draftsDir, slug, quarantinePath } = makeDirectAndLegacySandbox()
  const g = deliveryGate({ slug, draftsDir, quarantinePath,
    queueItem: { slug, [DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' } })
  assert.equal(g.ok, false, '모르는 directSpecMode 를 legacy 로 묻어 전송 가능 상태로 돌려줬다 — rollback 계약 깨짐')
  assert.equal(g.code, UNKNOWN_MAGAZINE_AUTO_MODE)
  assert.equal(g.message, null, 'fail-closed 인데 message 를 조립했다 — provider 로 흘러갈 글자가 생겼다')
  assert.equal(g.messageFingerprint, null, 'fail-closed 인데 지문이 있다 — HOLD 장부와 섞인다')
})

check('W25 direct mode + article-spec.json 없음 — DIRECT_SPEC_MISSING 으로 fail-closed (provider·예약 0)', () => {
  const d = tmp('ds-w25') // spec 을 쓰지 않는다
  const quarantinePath = join(d, 'quarantine.json')
  saveQuarantine({}, quarantinePath)
  const g = deliveryGate({ slug: 'canary-direct-spec-01', draftsDir: d, quarantinePath,
    queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE } })
  assert.equal(g.ok, false, 'spec 없는 direct 입력을 ok 로 돌려줬다 — provider 가 깨어난다')
  assert.equal(g.code, 'DIRECT_SPEC_MISSING')
  assert.equal(g.message, null)
  assert.equal(g.messageFingerprint, null)
})

check('W26 direct mode + 손상 spec — ARTICLE_SPEC_HASH 로 fail-closed (verify 가 deliveryGate 로 올라온다)', () => {
  const { input, draftsDir, slug, quarantinePath } = makeDirectAndLegacySandbox()
  // 디스크의 spec.outline 을 조작한다 (hash 재계산 없이)
  const specPath = join(draftsDir, slug, ARTICLE_SPEC_FILENAME)
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  spec.editorial.outline[0] = '손상된 outline'
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
  const g = deliveryGate({ slug, draftsDir, quarantinePath,
    queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE } })
  assert.equal(g.ok, false, 'verify 가 deliveryGate 로 올라오지 않았다 — 손상 spec 이 provider 로 흘러간다')
  assert.equal(g.code, 'ARTICLE_SPEC_HASH')
  assert.equal(g.message, null)
})

check('W27 direct mode + regen packet — 같은 identity 허용 · 다른 identity 차단', () => {
  const { draftsDir, slug, quarantinePath, specHash, directSourceDeps } = makeDirectAndLegacySandbox()
  const spec = readDirectSpec({ slug, draftsDir }).spec
  writeFileSync(join(draftsDir, slug, 'draft.md'), '---\ntitle: t\n---\n\n## 본문\n\n[CTA] /community/free | t | t\n', 'utf8')
  const directPacket = directSpecRegenPacket({ spec, failures: [{ code: 'X', label: 't', sentence: '' }] })
  const packet = {
    schemaVersion: 'regen-packet/3', slug, profile: 'STANDARD', attempt: 1,
    failures: [{ code: 'X', label: 't', sentence: '' }], instruction: directPacket.instruction,
    specHash: directPacket.specHash, articleSpecSchemaVersion: directPacket.schemaVersion,
  }
  const g = deliveryGate({ slug, draftsDir, quarantinePath,
    queueItem: { [DIRECT_SPEC_OPT_IN_FIELD]: DIRECT_SPEC_MODE },
    packet, directSourceDeps })
  assert.equal(g.ok, true, `${g.code ?? ''}: ${g.why ?? ''}`)
  assert.equal(g.specHash, specHash)
  assert.ok(g.message.includes(specHash))

  const drift = directSpecRegenMessageFor({ slug, draftsDir,
    packet: { ...packet, specHash: `sha256:${'0'.repeat(64)}` }, currentDraft: 'draft' })
  assert.equal(drift.ok, false)
  assert.equal(drift.code, 'DIRECT_SPEC_REGEN_IDENTITY')
})

check('W28 auto-lane gate — direct 는 brief/review 없이, 승인 source 와 같은 spec 일 때만 통과 · legacy 는 차단', () => {
  const input = loadFixture()
  input.node.graphVersion = readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
  const d = tmp('ds-w28')
  compileAndPersistDirectSpec({ input, draftsDir: d })
  const gv = input.node.graphVersion
  const opts = { expectedGraphVersionFn: () => gv }
  const noSource = autoLaneGate(input.queueItem.slug, [input.queueItem], d, opts)
  assert.equal(noSource.ok, false, 'source 없이 direct 가 등록 gate 를 통과했다')
  assert.ok(noSource.blockedBy.some((x) => x.code === 'DIRECT_SPEC_SOURCE_NOT_READY'))
  writeApprovedSource(d, input, gv)
  const direct = autoLaneGate(input.queueItem.slug, [input.queueItem], d, opts)
  assert.equal(direct.ok, true, JSON.stringify(direct.blockedBy))
  const legacyItem = { ...input.queueItem }
  delete legacyItem.directSpecMode
  const legacy = autoLaneGate(legacyItem.slug, [legacyItem], d)
  assert.equal(legacy.ok, false)
  assert.ok(legacy.blockedBy.some((x) => x.code === 'BRIEF_MISSING'))
  assert.ok(legacy.blockedBy.some((x) => x.code === 'REVIEW_MISSING'))
})

check('W29 run target — legacy runId 불변, direct mode 신원·queueItem 운반', () => {
  const legacyString = runIdOf({ status: 'COMPLETED', selected: ['a'], reusable: [] })
  const legacyObject = runIdOf({ status: 'COMPLETED', selected: [{ slug: 'a' }], reusable: [] })
  const direct = runIdOf({ status: 'COMPLETED', selected: [{ slug: 'a', directSpecMode: DIRECT_SPEC_MODE }], reusable: [] })
  assert.equal(legacyString, legacyObject)
  assert.notEqual(direct, legacyString)
  const targets = [{ slug: 'a', queueItem: { slug: 'a', directSpecMode: DIRECT_SPEC_MODE },
    material: { stage: 'NEEDS_BRIEF', draftMd: false, articleSpec: false } }]
  assert.equal(fetchTargets(targets).length, 1, 'spec 누락 direct도 gate에 도달해 fail-closed 해야 한다')
})

await checkAsync('W30 batch plan — direct spec 누락은 probe·Chrome 0', async () => {
  const input = loadFixture()
  const d = tmp('ds-w30')
  const date = '2026-10-22'
  const runDir = join(d, '_runs', date)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify({
    status: 'COMPLETED', inventoryDays: 0, selected: [input.queueItem], reusable: [],
  }, null, 2)}\n`, 'utf8')
  const quarantinePath = join(d, 'quarantine.json')
  saveQuarantine({}, quarantinePath)
  let probes = 0
  const out = await fetchBatch({ date, dryRun: false, draftsDir: d, quarantinePath,
    probeFn: async () => { probes += 1; throw new Error('probe 호출 금지') } })
  assert.equal(probes, 0)
  assert.equal(out.sentTotal, 0)
  assert.equal(out.results[0]?.reason, 'DIRECT_SPEC_MISSING')
})

check('W31 merge gate — 등록 slug의 spec/sidecar만 허용', () => {
  const slugs = new Set(['canary-direct-spec-01'])
  assert.equal(judgeFile('drafts/magazine/canary-direct-spec-01/article-spec.json', slugs).ok, true)
  assert.equal(judgeFile('drafts/magazine/canary-direct-spec-01/article-spec.registered.json', slugs).ok, true)
  assert.equal(judgeFile('drafts/magazine/foreign/article-spec.json', slugs).code, 'FOREIGN_SLUG_FILE')
})

function directDriveSandbox(prefix) {
  const input = loadFixture()
  // 🔴 drive 의 등록 gate 는 제품 current graphVersion 의 승인 source 를 본다
  const gv = readProductGraphVersion(join(ROOT, 'src/content/magazine/graph/current.ts'))
  input.node.graphVersion = gv
  const d = tmp(prefix)
  writeApprovedSource(d, input, gv)
  const persisted = compileAndPersistDirectSpec({ input, draftsDir: d })
  const slug = input.queueItem.slug
  const dir = join(d, slug)
  writeFileSync(join(dir, 'draft.md'), [
    '---', 'title: 잠들기 전 밤 마음을 돌보는 방법',
    'description: 잠들기 전 반복되는 생각을 줄이고 편안한 밤 루틴을 만드는 방법을 살펴봅니다.',
    'cluster: sleep', 'medical: false', '---', '',
    '하루를 마치고 불을 끈 뒤에도 생각이 이어지는 밤이 있습니다.', '',
    '## 오늘 밤에 할 수 있는 일', '',
    '잠들기 전 내일 할 일을 짧게 적고 휴대전화를 멀리 두어 보세요.', '',
    '[CTA] /community/free | 밤 이야기를 나눠요 | 오늘 밤 떠오른 생각을 남겨 주세요', '',
  ].join('\n'), 'utf8')
  writeFileSync(join(dir, 'article-draft.ts'), 'export const article = {}\n', 'utf8')
  const quarantinePath = join(d, 'quarantine.json')
  saveQuarantine({}, quarantinePath)
  const heroFile = join(d, 'hero.webp')
  const fakeRun = (cmd) => {
    if (String(cmd).endsWith('magazine-batch-qa.mjs')) {
      return { code: 0, json: { results: [{ slug, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [] }] } }
    }
    if (String(cmd).endsWith('magazine-register.mjs')) return { code: 0, json: { verdict: 'READY' } }
    return { code: 0, stdout: '', stderr: '' }
  }
  const deps = {
    draftsDir: d,
    quarantinePath,
    loadQueue: () => [input.queueItem],
    queueItem: input.queueItem,
    progress: () => ({ hasDraftMd: true }),
    heroFilePath: () => heroFile,
    run: fakeRun,
    now: Date.parse('2026-10-15T03:00:00Z'),
  }
  return { d, input, persisted, slug, dir, deps }
}

check('W32 auto-register — 성공한 direct 등록에 spec sidecar 영수증 기록', () => {
  const s = directDriveSandbox('ds-w32')
  const r = drive(s.slug, { write: true, publishAt: '2026-10-22', autoLane: true }, s.deps)
  assert.equal(r.verdict, 'DONE', JSON.stringify(r.blockedBy))
  assert.equal(r.mode, DIRECT_SPEC_MODE)
  assert.equal(r.specHash, s.persisted.specHash)
  const receiptPath = join(s.dir, ARTICLE_SPEC_REGISTER_LEDGER)
  assert.equal(existsSync(receiptPath), true)
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  assert.equal(receipt.specHash, s.persisted.specHash)
  assert.equal(receipt.registeredAt, '2026-10-15T12:00:00+09:00')
})

check('W33 auto-register — sidecar identity 충돌 시 BLOCKED·기존 바이트 보존', () => {
  const s = directDriveSandbox('ds-w33')
  const receiptPath = join(s.dir, ARTICLE_SPEC_REGISTER_LEDGER)
  const before = `${JSON.stringify({
    schema: 'direct-spec-register/1',
    schemaVersion: s.persisted.spec.schemaVersion,
    mode: s.persisted.spec.mode,
    specHash: s.persisted.specHash,
    slug: s.slug,
    graphNodeId: 'wrong-graph-node',
    intentId: s.persisted.spec.identity.intentId,
    publishAt: s.persisted.spec.publication.publishAt,
    registeredAt: '2026-10-15T12:00:00+09:00',
  }, null, 2)}\n`
  writeFileSync(receiptPath, before, 'utf8')
  const r = drive(s.slug, { write: true, publishAt: '2026-10-22', autoLane: true }, s.deps)
  assert.equal(r.verdict, 'BLOCKED')
  assert.ok(r.blockedBy.some((x) => x.code === 'DIRECT_SPEC_REGISTER_IDENTITY'))
  assert.equal(readFileSync(receiptPath, 'utf8'), before)
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
