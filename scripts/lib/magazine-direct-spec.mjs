/**
 * DIRECT_SPEC_V1 adapter — 매거진 자동 공급의 좁은 canary.
 *
 * 🔴 **이 adapter 는 운영 호출체인에 아직 연결돼 있지 않다.**
 *    `scripts/magazine-{producer,webui,auto-register,brief-auto,rehearsal}.mjs` 어디도
 *    이 파일을 import 하지 않는다. 아래 adapter 와 두 검사(`check:magazine-direct-spec`,
 *    `check:magazine-direct-spec-mutation`)만 쓴다.
 *
 *    운영 접근 0 의 근거는:
 *      · 운영 topic-queue 에 `directSpecMode === 'DIRECT_SPEC_V1'` 인 행이 없다
 *      · 운영 scripts 어디도 이 adapter 를 import 하지 않는다 (grep 로 확인한다)
 *      · 이 adapter 는 Chrome · CDP · ChatGPT 세션 · HTTP · DB · launchd 를 쓰지 않는다
 *      · 쓰기는 호출자가 넘긴 `draftsDir` 안에만 일어나고, 검사는 임시 디렉터리를 쓴다
 *
 * 🔴 **spec identity / hash 는 운영 함수와 공유한다.**
 *    `compileArticleSpec` · `verifyArticleSpec` · `buildManuscriptMessage` ·
 *    `deliveryFingerprintOf` · `BANNED_WORDS` · `BRIEF_ALLOWED_NOTATIONS` 등을
 *    그대로 재사용한다. 다른 곳에 복사해 두 벌을 만들지 않는다.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  ARTICLE_SPEC_MODE,
  ARTICLE_SPEC_SCHEMA,
  articleSpecHash,
  canonicalJson,
  compileArticleSpec,
  verifyArticleSpec,
} from './magazine-article-spec.mjs'
import { buildManuscriptMessage } from './chatgpt-session.mjs'
import { deliveryFingerprintOf, deliveryHoldsFetch } from './magazine-quarantine.mjs'
import {
  BRIEF_ALLOWED_NOTATIONS,
  judgeBriefFormatContract,
  describeBriefViolations,
} from './magazine-manuscript-format.mjs'

/** 운영 queueItem 에 이 값이 있을 때만 direct 경로로 간다 */
export const DIRECT_SPEC_OPT_IN_FIELD = 'directSpecMode'
export const DIRECT_SPEC_MODE = 'DIRECT_SPEC_V1'
export const LEGACY_BRIEF_MODE = 'LEGACY_BRIEF_V1'

/** 모르는 directSpecMode 를 봤을 때의 fail-closed 코드 — legacy provider 로도 보내지 않는다 */
export const UNKNOWN_MAGAZINE_AUTO_MODE = 'UNKNOWN_MAGAZINE_AUTO_MODE'

/** direct 경로가 쓰는 drafts 파일 이름 */
export const ARTICLE_SPEC_FILENAME = 'article-spec.json'
export const ARTICLE_SPEC_REGISTER_LEDGER = 'article-spec.registered.json'

/** 지문 식별 라인 — message 안에 들어가 fingerprint 가 spec identity 의 함수가 되게 한다 */
export const DIRECT_SPEC_PROMPT_MARKER = `[${DIRECT_SPEC_MODE} · ${ARTICLE_SPEC_SCHEMA}]`

/** direct 전송 요청의 prompt — legacy prompt 와 글자가 겹치지 않는다 (지문 분리 보장) */
export const DIRECT_SPEC_PROMPT_TEXT = [
  '[DIRECT_SPEC_V1] 아래 BRIEF 시작/끝 사이의 지시를 그대로 따라 최종 원고를 작성하세요.',
  '설명·인사·요약·후기를 붙이지 말고 원고 전체만 출력합니다.',
  '출력은 마크다운 코드블록 안에 마크다운 원본 표기 그대로 넣어 주세요.',
  'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',
  '웹 검색 인용 표기나 각주 마커를 본문에 남기지 마세요.',
  DIRECT_SPEC_PROMPT_MARKER,
].join(' ')

/**
 * 🔴 **운영 접근 0 보장 — adapter 는 사이드 이펙트 심볼을 import 하지 않는다.**
 *    아래 심볼은 모두 **순수 함수** 또는 **문자열 상수**다.
 *      compileArticleSpec       순수 compile
 *      verifyArticleSpec        순수 verify
 *      buildManuscriptMessage   `[prompt, '', BRIEF_BEGIN, brief, BRIEF_END].join('\n')`
 *      deliveryFingerprintOf    `sha256(message)` 하나
 *      BRIEF_ALLOWED_NOTATIONS  문자열 배열
 *      judgeBriefFormatContract 순수 판정
 */

const text = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim()

function fail(code, why) {
  const error = new TypeError(`${code}: ${why}`)
  error.code = code
  throw error
}

/**
 * 이 queueItem 이 direct 분기로 가는가.
 *
 * 🔴 **"모름" 은 legacy 가 아니다** — fail-closed 다.
 *    - undefined · null · '' · 'LEGACY_BRIEF_V1' → legacy (opt-in 없음 또는 명시 legacy)
 *    - 'DIRECT_SPEC_V1' → direct
 *    - 그 밖의 값 → `ok:false, code:UNKNOWN_MAGAZINE_AUTO_MODE`. legacy provider 로도 보내지 않는다.
 *      모르는 opt-in flag 는 코드 결함이거나 신호 손상이므로, 둘 다 legacy 에 묻어 넘기면 bounded
 *      rollback 계약이 깨진다.
 *
 * @returns {{ok:true, mode:'LEGACY_BRIEF_V1'|'DIRECT_SPEC_V1', reason:string}
 *          |{ok:false, mode:null, code:'UNKNOWN_MAGAZINE_AUTO_MODE', why:string}}
 */
export function resolveMagazineAutoMode(queueItem) {
  const mode = queueItem?.[DIRECT_SPEC_OPT_IN_FIELD]
  if (mode === undefined || mode === null || mode === '' || mode === LEGACY_BRIEF_MODE) {
    return { ok: true, mode: LEGACY_BRIEF_MODE, reason: '명시 legacy 또는 opt-in 없음' }
  }
  if (mode === DIRECT_SPEC_MODE) {
    return { ok: true, mode: DIRECT_SPEC_MODE, reason: 'queueItem opt-in' }
  }
  return {
    ok: false,
    mode: null,
    code: UNKNOWN_MAGAZINE_AUTO_MODE,
    why: `모르는 directSpecMode (${String(mode)}) — legacy provider 로도 보내지 않는다 (fail-closed)`,
  }
}

/** JSON 하나를 임시파일 → rename 으로 atomic 하게 쓴다 */
function atomicWriteJson(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  try { renameSync(tmp, path) }
  catch (e) {
    try { unlinkSync(tmp) } catch { /* best effort */ }
    throw e
  }
}

/**
 * canary 입력(hash·시계·네트워크 없이) 을 verifyArticleSpec 통과 spec 으로 만들고,
 * `drafts/{slug}/article-spec.json` 에 결정론적 canonical JSON 으로 쓴다.
 *
 * 🔴 verifyArticleSpec 이 실패하면 **쓰지 않고** fail-closed throw.
 * 🔴 같은 입력은 같은 canonical JSON 과 specHash 를 만든다.
 */
export function compileAndPersistDirectSpec({ input, draftsDir }) {
  const compiled = compileArticleSpec(input)
  const v = verifyArticleSpec(compiled)
  if (!v.ok) fail(v.code ?? 'ARTICLE_SPEC_INVALID', v.why ?? 'verify 실패')
  const specPath = join(draftsDir, compiled.identity.slug, ARTICLE_SPEC_FILENAME)
  atomicWriteJson(specPath, compiled)
  return {
    spec: compiled,
    specPath,
    specHash: compiled.specHash,
    schemaVersion: compiled.schemaVersion,
    mode: compiled.mode,
    canonicalJson: canonicalJson(compiled),
  }
}

/** 디스크에서 spec 을 읽어 verify 한다. 실패는 전부 fail-closed 로 코드 번역한다. */
export function readDirectSpec({ slug, draftsDir }) {
  const specPath = join(draftsDir, slug, ARTICLE_SPEC_FILENAME)
  if (!existsSync(specPath)) {
    return { ok: false, code: 'DIRECT_SPEC_MISSING', why: `${specPath} 가 없다` }
  }
  let raw
  try { raw = readFileSync(specPath, 'utf8') }
  catch (e) { return { ok: false, code: 'DIRECT_SPEC_UNREADABLE', why: `읽기 실패: ${e.message}` } }
  let parsed
  try { parsed = JSON.parse(raw) }
  catch (e) { return { ok: false, code: 'DIRECT_SPEC_UNREADABLE', why: `JSON 파싱 실패: ${e.message}` } }
  const v = verifyArticleSpec(parsed)
  if (!v.ok) return { ok: false, code: v.code, why: v.why }
  return { ok: true, spec: parsed, specPath, specHash: parsed.specHash }
}

/**
 * 🔴 **spec 하나를 brief.md 자리에 들어갈 결정론적 텍스트로 조립한다.**
 *
 *    - **brief.md 파일을 읽지 않는다.** direct 경로에서 사람이 손으로 쓴 brief 는 실행 권위가 아니다.
 *    - 같은 spec canonical JSON → 같은 글자 (model · clock · random · network 미참조).
 *    - 운영 `judgeBriefFormatContract` 를 통과한다:
 *        · 줄 맨 앞 `[CTA]` 지시 1개
 *        · 허용 표기 표 (`## ` · `> ` · `- ` · `[CTA]` 네 행)
 *        · 금지 규칙 (표 · 코드블록 · 외부 링크 · 이미지 · h1 · h4 · HTML · 번호 목록)
 *    - 상단 머리줄에 `schemaVersion` 과 `specHash` 가 들어가 **지문이 spec identity 의 함수**가 된다.
 */
export function directSpecBriefText(spec) {
  if (!spec || typeof spec !== 'object') fail('DIRECT_SPEC_INVALID', 'spec 이 객체가 아니다')
  const lines = []
  const push = (...v) => lines.push(...v)

  const i = spec.identity, a = spec.audience, e = spec.editorial, s = spec.safety
  const n = spec.navigation, p = spec.publication

  push(
    '---',
    `title: ${i.title}`,
    'description: 90~120자. 직접 쓴 요약',
    `cluster: ${i.cluster}`,
    '---',
    '',
    `# 작업 지시 — ${spec.schemaVersion} · ${spec.mode}`,
    '',
    `> schemaVersion: ${spec.schemaVersion}`,
    `> specHash: ${spec.specHash}`,
    `> graphVersion: ${i.graphVersion} · intentId: ${i.intentId}`,
    '',
    '## 검색 의도',
    '',
    `${a.searchIntent}`,
    `독자 질문: ${a.readerQuestion}`,
    '',
    '## 대상 독자',
    '',
    `- ${a.target}`,
    '',
    '## 도입에서 해야 할 것',
    '',
    `${e.whyNow}`,
    '',
    '## 글 구조',
    '',
  )
  for (const item of e.outline) push(`- ${item}`)
  push(
    '',
    '### 범위',
    '',
    '- 포함',
  )
  for (const item of e.include) push(`  - ${item}`)
  push('- 제외')
  for (const item of e.exclude) push(`  - ${item}`)
  push(
    '',
    '### 근거',
    '',
    '- 확인할 사실',
  )
  for (const item of spec.evidence.factsToVerify) push(`  - ${item}`)
  push('- 출처 요구')
  for (const item of spec.evidence.sourceRequirements) push(`  - ${item}`)

  push(
    '',
    '## 반드시 그대로 넣을 문장',
    '',
    `(validationProfile=${s.validationProfile} · riskLevel=${s.riskLevel} · reviewMode=${s.reviewMode})`,
    '',
    '## 절대 쓰지 말 것',
    '',
    '- 주제별 금지',
  )
  for (const item of s.topicConstraints) push(`  - ${item}`)
  push('- 공통 금지 호칭')
  for (const item of s.bannedTerms) push(`  - ${item}`)
  push('- 의료 단정 표현')
  for (const item of s.forbiddenAssertions) push(`  - ${item}`)

  push(
    '',
    '## 쓸 수 있는 표기',
    '',
    '| 표기 | 쓰임 |',
    '|---|---|',
    `| ${BRIEF_ALLOWED_NOTATIONS[0]} | h2 |`,
    `| ${BRIEF_ALLOWED_NOTATIONS[1]} | 인용 |`,
    `| ${BRIEF_ALLOWED_NOTATIONS[2]} | 목록 |`,
    `| ${BRIEF_ALLOWED_NOTATIONS[3]} /community/… \\| 문구 \\| 앞 문장\` | 마지막에 정확히 1개 |`,
    '',
    '🚫 표 · 코드블록 · 외부 링크 · 이미지 · h1 · h4 · HTML · 번호 목록',
    '',
    '## 관계 (3+1)',
    '',
  )
  for (const r of n.direct) push(`- ${r.source}:${r.relationType} \`${r.slug}\` — ${r.reason}`)
  push(`- ${n.discovery.source}:${n.discovery.relationType} \`${n.discovery.slug}\` — ${n.discovery.reason}`)

  push(
    '',
    `허브: \`${n.hub}\``,
    `시리즈: ${n.series ? `\`${n.series.id}\` #${n.series.order}` : '없음'}`,
    '',
    '## hero',
    '',
    `- mode: ${spec.hero.mode}${spec.hero.required ? ' (REQUIRED)' : ''}`,
    spec.hero.alt ? `- alt: ${spec.hero.alt}` : '- alt: (없음)',
    spec.hero.scene ? `- scene: ${spec.hero.scene}` : '- scene: (없음)',
    '',
    '## 예약',
    '',
    `- publishAt: ${p.publishAt}`,
    p.publishWindow
      ? `- publishWindow: ${p.publishWindow.after} ~ ${p.publishWindow.before}`
      : '- publishWindow: 없음 (EVERGREEN)',
    '',
    `[CTA] ${n.community.path} | ${n.community.label} | 지금 떠오른 밤 이야기 한 조각을 남겨 주세요`,
    '',
  )

  const brief = lines.join('\n')
  // 운영 brief format contract 를 adapter 가 **자기 조립한 brief 에 대고 다시 검증**한다.
  // 여기서 FAIL 이면 adapter 가 잘못 조립한 것이지 입력 결함이 아니다 — fail-closed throw.
  const contract = judgeBriefFormatContract(brief)
  if (!contract.ok) {
    fail('DIRECT_SPEC_BRIEF_FORMAT', `adapter 조립 brief 가 운영 형식 계약을 어겼다: ${describeBriefViolations(contract.violations)}`)
  }
  return brief
}

/**
 * direct 전송 message 를 조립한다. **운영 `buildManuscriptMessage` 를 그대로 쓴다.**
 * 지문 = `sha256(message)` 이고 message 안에 schemaVersion · specHash 가 있으므로
 * 지문은 spec identity 의 함수가 된다.
 *
 * @returns {{ok:true, message:string, messageFingerprint:string, specHash:string, schemaVersion:string, mode:string}
 *          |{ok:false, code:string, why:string}}
 */
export function directSpecMessageFor({ slug, draftsDir, promptText = DIRECT_SPEC_PROMPT_TEXT }) {
  const r = readDirectSpec({ slug, draftsDir })
  if (!r.ok) return r
  const briefText = directSpecBriefText(r.spec)
  const message = buildManuscriptMessage({ promptText, briefText })
  const messageFingerprint = deliveryFingerprintOf(message)
  return {
    ok: true,
    message,
    messageFingerprint,
    specHash: r.spec.specHash,
    schemaVersion: r.spec.schemaVersion,
    mode: r.spec.mode,
  }
}

/**
 * direct 전송 관문 — 운영 `deliveryGate` 와 **같은 모양**으로 돌려준다.
 * `readLedger` 를 주입하면 fake 장부로 변이 시험도 돌릴 수 있다.
 */
export function directSpecDeliveryGate({ slug, draftsDir, readLedger }) {
  if (typeof readLedger !== 'function') fail('DIRECT_SPEC_GATE', 'readLedger 함수가 필요하다 (운영 접근 0)')
  const m = directSpecMessageFor({ slug, draftsDir })
  if (!m.ok) return { ok: false, ...m, message: null, messageFingerprint: null }
  const ledger = readLedger()
  if (!ledger.ok) {
    return { ok: false, code: ledger.code ?? 'QUARANTINE_UNREADABLE', why: ledger.why,
      message: m.message, messageFingerprint: m.messageFingerprint, specHash: m.specHash, schemaVersion: m.schemaVersion }
  }
  const entry = ledger.store?.[slug] ?? null
  const hold = deliveryHoldsFetch(entry, m.messageFingerprint)
  return {
    ok: true,
    message: m.message,
    messageFingerprint: m.messageFingerprint,
    specHash: m.specHash,
    schemaVersion: m.schemaVersion,
    mode: m.mode,
    hold,
    entry,
  }
}

/**
 * QA 재생성 패킷 — spec identity 를 운반한다.
 * 전송 지문이 spec 과 묶여 있으므로 재생성이 schemaVersion/specHash 를 어긴 원고로 돌아가지 못한다.
 */
export function directSpecRegenPacket({ spec, failures, source = 'DIRECT_SPEC_V1_QA' }) {
  if (!spec || !spec.specHash) fail('DIRECT_SPEC_INVALID', 'spec/specHash 가 없다')
  if (!Array.isArray(failures) || failures.length === 0) fail('DIRECT_SPEC_INVALID', 'failures 가 비었다')
  const instruction = [
    `[${spec.mode} · ${spec.schemaVersion}] 아래 자동 검사 실패 항목만 수정하세요.`,
    `원고의 schemaVersion 과 specHash 는 유지합니다: ${spec.schemaVersion} / ${spec.specHash}.`,
    ...failures.map((f) => `- [${f.code}] ${f.label ?? ''}${f.sentence ? `: "${f.sentence}"` : ''}`),
    '🔴 다른 문단은 그대로 둔다. 새 주장을 추가하지 않는다.',
  ].join('\n')
  return {
    schema: 'direct-spec-regen-packet/1',
    source,
    specHash: spec.specHash,
    schemaVersion: spec.schemaVersion,
    graphNodeId: spec.identity.graphNodeId,
    intentId: spec.identity.intentId,
    slug: spec.identity.slug,
    instruction,
    packetHash: `sha256:${createHash('sha256').update(canonicalJson({ specHash: spec.specHash, failures })).digest('hex')}`,
  }
}

/**
 * **등록 side-car 장부** — 운영 `articles.ts` 를 건드리지 않고 spec identity 를 영구 기록한다.
 *   - 같은 (slug, specHash) 로 다시 부르면 멱등 (바이트 변경 0)
 *   - 다른 specHash 로 다시 부르면 fail-closed (identity 가 바뀌었는데 재등록은 안 한다)
 *
 * @returns {{written:boolean, path:string, specHash:string, record:object}}
 */
export function registerDirectSpecSidecar({ spec, draftsDir, registeredAt }) {
  if (!spec || !spec.specHash) fail('DIRECT_SPEC_INVALID', 'spec/specHash 가 없다')
  if (!registeredAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(registeredAt)) {
    fail('DIRECT_SPEC_REGISTER', 'registeredAt 은 초까지 포함한 KST(+09:00) 시각이어야 한다')
  }
  const slug = spec.identity.slug
  const path = join(draftsDir, slug, ARTICLE_SPEC_REGISTER_LEDGER)
  const record = {
    schema: 'direct-spec-register/1',
    schemaVersion: spec.schemaVersion,
    mode: spec.mode,
    specHash: spec.specHash,
    slug,
    graphNodeId: spec.identity.graphNodeId,
    intentId: spec.identity.intentId,
    publishAt: spec.publication.publishAt,
    registeredAt,
  }
  if (existsSync(path)) {
    let prev
    try { prev = JSON.parse(readFileSync(path, 'utf8')) }
    catch (e) { fail('DIRECT_SPEC_REGISTER', `등록 장부를 읽지 못했다: ${e.message}`) }
    if (prev?.specHash && prev.specHash !== spec.specHash) {
      fail('DIRECT_SPEC_REGISTER_IDENTITY',
        `이 slug 는 이미 다른 specHash 로 등록돼 있다 (prev=${prev.specHash} · now=${spec.specHash})`)
    }
    return { written: false, path, specHash: spec.specHash, record: prev }
  }
  atomicWriteJson(path, record)
  return { written: true, path, specHash: spec.specHash, record }
}

/**
 * **같은 입력** 에서 **같은 식별자** 가 provider · QA · register 세 자리로 흐르는지 한번에 확인한다.
 * 소비자 (운영 또는 rehearsal) 가 adapter 를 호출하는 유일한 "end-to-end" 자리다.
 *
 * @returns {{ok:true, specHash:string, schemaVersion:string, provider:object, qaPacket:object, register:object}
 *          |{ok:false, code:string, why:string}}
 */
export function directSpecIdentityHandoff({ input, draftsDir, failuresForRegen, registeredAt, readLedger }) {
  const persisted = compileAndPersistDirectSpec({ input, draftsDir })
  const provider = directSpecDeliveryGate({ slug: persisted.spec.identity.slug, draftsDir, readLedger })
  if (!provider.ok) return provider
  const qaPacket = directSpecRegenPacket({ spec: persisted.spec, failures: failuresForRegen })
  const register = registerDirectSpecSidecar({ spec: persisted.spec, draftsDir, registeredAt })
  // 🔴 identity 는 세 자리에서 **같다**. 하나라도 어긋나면 adapter 결함이다.
  if (provider.specHash !== persisted.specHash
    || qaPacket.specHash !== persisted.specHash
    || register.specHash !== persisted.specHash) {
    fail('DIRECT_SPEC_IDENTITY_DRIFT',
      `세 자리의 specHash 가 다르다 (provider=${provider.specHash} qa=${qaPacket.specHash} register=${register.specHash})`)
  }
  if (provider.schemaVersion !== ARTICLE_SPEC_SCHEMA
    || qaPacket.schemaVersion !== ARTICLE_SPEC_SCHEMA) {
    fail('DIRECT_SPEC_IDENTITY_DRIFT', 'schemaVersion 이 다르다')
  }
  if (persisted.spec.mode !== ARTICLE_SPEC_MODE) {
    fail('DIRECT_SPEC_IDENTITY_DRIFT', 'mode 가 DIRECT_SPEC_V1 이 아니다')
  }
  return {
    ok: true,
    specHash: persisted.specHash,
    schemaVersion: persisted.schemaVersion,
    provider: { message: provider.message, messageFingerprint: provider.messageFingerprint, hold: provider.hold, specHash: provider.specHash },
    qaPacket,
    register,
  }
}
