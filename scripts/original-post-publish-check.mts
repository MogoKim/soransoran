#!/usr/bin/env tsx
/**
 * 발행 규칙 fixture — 🔴 DB · 네트워크 · LLM 없음
 *
 * 실행: npx tsx scripts/original-post-publish-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ORIGINAL_POST_FLAGS, ORIGINAL_POST_BOARD, FORBIDDEN_POST_KEYS, REQUIRED_POST_KEYS,
  PUBLISHABLE_STATUSES, FIRST_PUBLISH_VERDICT, DAILY_PUBLISH_CAP,
  PUBLISH_BLOCK_CODES, PUBLISH_BLOCK_LABEL,
  buildOriginalPostData, assertOriginalPostData, judgePublish, kstDayStart,
  type PublishCandidate, type PublishBlockCode,
} from '../src/lib/original-post-publish'
import { judgeRealMember } from '../src/lib/real-member-gate'
import {
  ORIGINAL_POST_VISIBILITY_FLAGS, MICRO_SEED_POST_VISIBILITY_FLAGS,
} from '../src/lib/post-visibility'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = join(HERE, '..', 'src', 'lib', 'original-post-publish.ts')
const TX = join(HERE, '..', 'src', 'lib', 'original-post-publish-tx.ts')
const CLI = join(HERE, 'original-post-publish-live.mts')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

const IN = { title: '제목입니다', content: '본문입니다. 두 문장쯤 됩니다.', authorId: 'u_1', personaId: 'p_1' }
const C = (o: Partial<PublishCandidate> = {}): PublishCandidate => ({
  status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
  matchedPersonaCode: 'P10', personaStatus: 'active', personaProviderId: null,
  // 🔴 기본은 "Account 0" — 운영 persona 의 정상 상태다. 누락(null)은 별도 fixture 가 본다
  personaAccountCount: 0, ...o,
})
const CTX = { killSwitchEnabled: false, publishedToday: 0 }

console.log('\n══ 발행 규칙 fixture ══\n')

// ── ① 🔴 3축이 전부 false — 이 레인만 색인된다 ──
{
  const offenders: string[] = []
  const f = ORIGINAL_POST_VISIBILITY_FLAGS
  if (f.isMicroSeed !== false) offenders.push('🔴 isMicroSeed 가 true')
  if (f.permanentNoindex !== false) offenders.push('🔴 permanentNoindex 가 true — 색인되지 않는다')
  if (f.indexPromotionBlocked !== false) offenders.push('🔴 indexPromotionBlocked 가 true')
  // 🔴 micro-seed 와 정반대여야 한다. 같으면 레인이 하나로 합쳐진 것이다
  // 🔴 리터럴 타입끼리 비교하면 tsc 가 "겹치지 않는다" 로 막는다 — boolean 으로 넓혀서 실측한다
  const m: Record<string, boolean> = { ...MICRO_SEED_POST_VISIBILITY_FLAGS }
  const o: Record<string, boolean> = { ...f }
  if (m.permanentNoindex === o.permanentNoindex) offenders.push('🔴 micro-seed 와 noindex 가 같다')
  if (m.isMicroSeed === o.isMicroSeed) offenders.push('🔴 micro-seed 와 isMicroSeed 가 같다')
  if (offenders.length) bad('🔴 3축 (색인 레인)', offenders.join(' / '))
  else ok('🔴 3축 (색인 레인)', '전부 false · micro-seed 와 정반대')
}

// ── ② 발행 데이터 조립 ──
{
  const d = buildOriginalPostData(IN) as Record<string, unknown>
  const offenders: string[] = []
  if (d.boardType !== ORIGINAL_POST_BOARD || d.boardType !== 'FREE') offenders.push(`boardType=${String(d.boardType)}`)
  if (d.source !== 'SYSTEM') offenders.push(`source=${String(d.source)}`)
  if (d.status !== 'PUBLISHED') offenders.push(`status=${String(d.status)}`)
  if (d.publishAt !== null) offenders.push('publishAt 이 null 이 아니다')
  // 🔴 작성자는 페르소나의 User 다
  if (d.authorId !== 'u_1' || d.personaId !== 'p_1') offenders.push('작성자/페르소나 미반영')
  // 🔴 출처 필드가 **없어야** 한다 — 타입에 자리가 없는 것이 첫 방어다
  for (const k of FORBIDDEN_POST_KEYS) if (k in d) offenders.push(`🔴 ${k} 가 있다`)
  for (const k of REQUIRED_POST_KEYS) if (!(k in d)) offenders.push(`${k} 가 없다`)
  // 🔴 플래그가 마지막이라 입력이 덮어쓸 수 없다
  // 🔴 타입에 자리가 없는 값을 억지로 넣어 본다 — 플래그가 마지막이라 이겨야 한다
  const hijackInput = { ...IN, permanentNoindex: true, source: 'USER' } as unknown as typeof IN
  const hijack = buildOriginalPostData(hijackInput) as Record<string, unknown>
  if (hijack.permanentNoindex !== false || hijack.source !== 'SYSTEM') offenders.push('🔴 입력이 플래그를 덮어썼다')
  if (offenders.length) bad('발행 데이터 조립', offenders.join(' / '))
  else ok('발행 데이터 조립', `FREE · SYSTEM · PUBLISHED · publishAt null · 출처 ${FORBIDDEN_POST_KEYS.length}종 0 · 입력이 덮어쓰지 못함`)
}

// ── ③ 🔴 assertOriginalPostData ──
{
  const offenders: string[] = []
  let t = false
  try { assertOriginalPostData(buildOriginalPostData(IN) as Record<string, unknown>) } catch { t = true }
  if (t) offenders.push('정상 data 에서 던짐')
  // 🔴 출처가 섞이면 던진다
  for (const k of FORBIDDEN_POST_KEYS) {
    let x = false
    try { assertOriginalPostData({ ...buildOriginalPostData(IN), [k]: 'v' } as Record<string, unknown>) } catch { x = true }
    if (!x) offenders.push(`🔴 ${k} 가 통과`)
  }
  // 🔴 3축이 어긋나면 던진다
  for (const k of Object.keys(ORIGINAL_POST_VISIBILITY_FLAGS)) {
    let x = false
    try { assertOriginalPostData({ ...buildOriginalPostData(IN), [k]: true } as Record<string, unknown>) } catch { x = true }
    if (!x) offenders.push(`🔴 ${k}=true 가 통과`)
  }
  // 🔴 작성자·본문이 비면 던진다
  for (const k of ['authorId', 'personaId', 'title', 'content']) {
    for (const v of ['', '   ']) {
      let x = false
      try { assertOriginalPostData({ ...buildOriginalPostData(IN), [k]: v } as Record<string, unknown>) } catch { x = true }
      if (!x) offenders.push(`🔴 ${k}="${v}" 가 통과`)
    }
  }
  // 🔴 필수 키가 빠지면 던진다
  for (const k of REQUIRED_POST_KEYS) {
    const d = { ...buildOriginalPostData(IN) } as Record<string, unknown>
    delete d[k]
    let x = false
    try { assertOriginalPostData(d) } catch { x = true }
    if (!x) offenders.push(`🔴 ${k} 누락이 통과`)
  }
  if (offenders.length) bad('🔴 assertOriginalPostData', offenders.slice(0, 6).join(' / '))
  else ok('🔴 assertOriginalPostData', `출처 ${FORBIDDEN_POST_KEYS.length}종 · 3축 · 빈 작성자/본문 · 필수 ${REQUIRED_POST_KEYS.length}키 누락 전부 차단`)
}

// ── ④ 🔴 발행 자격 (전수) ──
{
  const offenders: string[] = []
  if (judgePublish(C(), CTX).ok !== true) offenders.push('정상 후보가 거부됨')
  const cases: [string, Partial<PublishCandidate>, PublishBlockCode][] = [
    ['이미 발행', { createdPostId: 'post_1' }, 'ALREADY_PUBLISHED'],
    ['PUBLISHED', { status: 'PUBLISHED' }, 'ALREADY_PUBLISHED'],
    ['PENDING', { status: 'PENDING' }, 'NOT_PUBLISHABLE'],
    ['DECLINED', { status: 'DECLINED' }, 'NOT_PUBLISHABLE'],
    ['EXPIRED', { status: 'EXPIRED' }, 'NOT_PUBLISHABLE'],
    ['미배정', { matchedPersonaCode: null }, 'NO_MATCH'],
    ['빈 배정', { matchedPersonaCode: '  ' }, 'NO_MATCH'],
    ['draft 페르소나', { personaStatus: 'draft' }, 'PERSONA_NOT_ACTIVE'],
    ['paused 페르소나', { personaStatus: 'paused' }, 'PERSONA_NOT_ACTIVE'],
    ['실회원', { personaProviderId: 'kakao_1' }, 'REAL_MEMBER'],
    ['HOLD', { gateVerdict: 'HOLD' }, 'GATE_NOT_PASS'],
    ['BLOCK', { gateVerdict: 'BLOCK' }, 'GATE_NOT_PASS'],
  ]
  for (const [label, patch, code] of cases) {
    const v = judgePublish(C(patch), CTX)
    if (v.ok) offenders.push(`🔴 ${label} 통과`)
    else if (v.code !== code) offenders.push(`${label} → ${v.code} (기대 ${code})`)
  }
  // EDITED 는 발행 가능
  if (!judgePublish(C({ status: 'EDITED' }), CTX).ok) offenders.push('EDITED 가 막힘')
  // 🔴 kill switch · cap
  const ks = judgePublish(C(), { ...CTX, killSwitchEnabled: true })
  if (ks.ok || ks.code !== 'KILL_SWITCH') offenders.push('🔴 kill switch 가 막지 않음')
  const cap = judgePublish(C(), { ...CTX, publishedToday: DAILY_PUBLISH_CAP })
  if (cap.ok || cap.code !== 'DAILY_CAP') offenders.push('🔴 cap 이 막지 않음')
  // 🔴 이미 발행된 것은 kill switch 보다 먼저 잡힌다 — 순서가 규칙이다
  const both = judgePublish(C({ createdPostId: 'p' }), { ...CTX, killSwitchEnabled: true })
  if (both.ok || both.code !== 'ALREADY_PUBLISHED') offenders.push('🔴 발행 여부를 먼저 보지 않는다')
  if (offenders.length) bad('🔴 발행 자격', offenders.join(' / '))
  else ok('🔴 발행 자격', `${cases.length}종 차단 · EDITED 허용 · kill switch · cap ${DAILY_PUBLISH_CAP} · 순서 보장`)
}

// ── ⑤ 상수 · 라벨 · cap ──
{
  const offenders: string[] = []
  if (DAILY_PUBLISH_CAP !== 1) offenders.push(`🔴 cap ${DAILY_PUBLISH_CAP} (기대 1)`)
  if (FIRST_PUBLISH_VERDICT !== 'PASS') offenders.push(`첫 발행 판정 ${FIRST_PUBLISH_VERDICT}`)
  if (PUBLISHABLE_STATUSES.join(',') !== 'APPROVED,EDITED') offenders.push(`발행 가능 상태 ${PUBLISHABLE_STATUSES.join(',')}`)
  for (const c of PUBLISH_BLOCK_CODES) if (!PUBLISH_BLOCK_LABEL[c]) offenders.push(`${c} 라벨 없음`)
  if (ORIGINAL_POST_FLAGS.status !== 'PUBLISHED') offenders.push('status 고정값이 다르다')
  // KST 자정
  const d = kstDayStart(new Date('2026-09-02T15:30:00Z')) // KST 2026-09-03 00:30
  if (d.toISOString() !== '2026-09-02T15:00:00.000Z') offenders.push(`KST 자정 계산 오류: ${d.toISOString()}`)
  if (offenders.length) bad('상수 · 라벨 · cap', offenders.join(' / '))
  else ok('상수 · 라벨 · cap', `cap ${DAILY_PUBLISH_CAP} · PASS 만 · 차단 ${PUBLISH_BLOCK_CODES.length}종 라벨 · KST 자정 정확`)
}

// ── ⑥ 🔴 3축을 게이트 밖에서 쓰지 않는다 (C-2) ──
{
  const offenders: string[] = []
  for (const [label, path] of [['builder', BUILD], ['tx', TX]] as const) {
    const code = readFileSync(path, 'utf-8').split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
    for (const t of ['isMicroSeed', 'permanentNoindex', 'indexPromotionBlocked']) {
      // 🔴 게이트에서 가져오는 import · spread 는 정상이다. **리터럴 대입**만 막는다
      if (new RegExp(`${t}\\s*:\\s*(true|false)`).test(code)) offenders.push(`🔴 ${label}이 ${t} 를 리터럴로 쓴다`)
    }
  }
  // 🔴 경유 경로가 다르다 — builder 는 게이트를 직접 읽고, tx 는 builder 를 통해 간접 경유한다.
  //    tx 가 게이트를 직접 import 하면 3축을 만질 수 있게 되므로 오히려 그쪽이 나쁘다.
  const buildCode = readFileSync(BUILD, 'utf-8')
  const txCode = readFileSync(TX, 'utf-8')
  if (!buildCode.includes('ORIGINAL_POST_VISIBILITY_FLAGS')) offenders.push('builder 가 게이트를 읽지 않는다')
  if (!txCode.includes('buildOriginalPostData')) offenders.push('tx 가 builder 를 경유하지 않는다')
  if (txCode.includes('ORIGINAL_POST_VISIBILITY_FLAGS')) offenders.push('🔴 tx 가 3축을 직접 만질 수 있다')
  if (offenders.length) bad('🔴 3축은 게이트에서만', offenders.join(' / '))
  else ok('🔴 3축은 게이트에서만', 'builder · tx 리터럴 대입 0 · builder→게이트 · tx→builder 간접 경유')
}

// ── ⑦ 🔴 소스 스캔 — 트랜잭션 경계 ──
{
  const code = readFileSync(TX, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []
  // 🔴 세 write 가 한 트랜잭션 안에 있다
  if (!code.includes('$transaction')) offenders.push('🔴 트랜잭션이 없다')
  for (const w of ['tx.post.create', 'tx.originalPostApprovalQueue.updateMany', 'tx.personaActivityLog.create']) {
    if (!code.includes(w)) offenders.push(`🔴 ${w} 가 없다`)
  }
  // 🔴 createdPostId 와 status 는 같은 data 에 있다
  const upd = code.match(/updateMany\(\{[\s\S]*?\}\)/)?.[0] ?? ''
  if (!upd.includes("status: 'PUBLISHED'") || !upd.includes('createdPostId: post.id')) {
    offenders.push('🔴 status 와 createdPostId 가 같은 update 에 없다')
  }
  // 🔴 조건부 UPDATE + 롤백
  if (!/createdPostId:\s*null/.test(upd)) offenders.push('🔴 WHERE 에 createdPostId null 이 없다')
  if (!code.includes('QUEUE_RACE')) offenders.push('🔴 count 0 에서 롤백하지 않는다')
  // 🔴 트랜잭션 안에서 재검증
  if (!code.includes('judgePublish(')) offenders.push('🔴 트랜잭션 안에서 재판정하지 않는다')
  if (!code.includes('personaGlobalSwitch')) offenders.push('🔴 kill switch 를 보지 않는다')
  if (!code.includes('assertOriginalPostData(')) offenders.push('🔴 create 직전 방어가 없다')
  // 🔴 kill switch 를 조작하지 않는다
  if (/personaGlobalSwitch\.(create|update|upsert|delete)/.test(code)) offenders.push('🔴 kill switch 를 조작한다')
  // 🔴 예외 원문을 흘리지 않는다
  if (/message:\s*(err|e)\./.test(code)) offenders.push('🔴 예외 원문을 흘린다')
  if (offenders.length) bad('트랜잭션 경계', offenders.join(' / '))
  else ok('트랜잭션 경계', 'Post+Queue+ActivityLog 한 트랜잭션 · 조건부 UPDATE · 롤백 · 재판정 · kill switch 읽기만')
}

// ── ⑧ 🔴 CLI 경계 ──
{
  const code = readFileSync(CLI, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []
  // 🔴 CLI 는 직접 쓰지 않는다. 트랜잭션 함수를 부른다
  const writes = [...code.matchAll(/prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany)\b/g)]
  if (writes.length > 0) offenders.push(`🔴 CLI 가 직접 쓴다: ${writes.map((m) => m[0]).join(' · ')}`)
  if (!code.includes('publishOriginalPostTx(')) offenders.push('🔴 트랜잭션 함수를 부르지 않는다')
  if (!code.includes('judgePublish(')) offenders.push('🔴 자격 판정을 부르지 않는다')
  // 🔴 이중 스위치 + cap 상한
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*take\.length/.test(code)) offenders.push('🔴 --limit 대조가 없다')
  if (!/LIMIT\s*>\s*DAILY_PUBLISH_CAP/.test(code)) offenders.push('🔴 --limit 이 cap 을 넘는지 보지 않는다')
  if (!code.includes('--check')) offenders.push('🔴 --check 가 없다')
  // 🔴 본문 전문을 찍지 않는다
  if (/console\.log\([^)]*draftBody|console\.log\([^)]*editedBody/.test(code)) offenders.push('🔴 본문을 출력한다')
  for (const k of ['fetch(', 'anthropic', 'openai']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  if (offenders.length) bad('CLI 경계', offenders.join(' / '))
  else ok('CLI 경계', 'CLI 직접 write 0 · tx 경유 · 이중 스위치 · cap 상한 · --check · 본문 출력 0')
}

// ── 🔴 발행 직전 실회원 게이트 — 정본은 Account 다 (2026-09-08) ──
//    발행은 되돌릴 수 없다. 배정 때 통과했더라도 여기서 다시 본다.
{
  const offenders: string[] = []
  const v = (o: Partial<PublishCandidate>): ReturnType<typeof judgePublish> => judgePublish(C(o), CTX)
  const blocked = (o: Partial<PublishCandidate>): boolean => {
    const r = v(o)
    return !r.ok && r.code === 'REAL_MEMBER'
  }
  if (!v({}).ok) offenders.push('🟢 Account 0 · providerId null 인데 막혔다')
  if (!blocked({ personaAccountCount: 1 })) offenders.push('🔴 Account 1건인데 통과했다')
  if (!blocked({ personaAccountCount: 3 })) offenders.push('🔴 Account 3건인데 통과했다')
  // 🔴 fail-closed — 모르면 막는다
  if (!blocked({ personaAccountCount: null })) offenders.push('🔴 Account 를 모르는데 통과했다 (fail-closed 실패)')
  // 🔴 providerId 방어는 남는다
  if (!blocked({ personaProviderId: 'kakao:1' })) offenders.push('🔴 providerId 가 있는데 통과했다')
  // 🔴 실회원 User 에 persona 가 잘못 연결된 사고 상황
  if (!blocked({ personaAccountCount: 1, personaProviderId: 'kakao:9' })) offenders.push('🔴 실회원 연결 persona 가 통과했다')
  // 🔴 DB count 가 될 수 없는 값 — `NaN > 0` 은 false 라 검사 없이 두면 조용히 통과한다
  for (const [label, v] of [
    ['NaN', Number.NaN], ['Infinity', Number.POSITIVE_INFINITY], ['음수', -1], ['소수', 0.5],
  ] as const) {
    if (!blocked({ personaAccountCount: v })) offenders.push(`🔴 ${label} 이 통과했다`)
  }
  // 🔴 providerId 미조회도 막는다
  if (!blocked({ personaProviderId: undefined as never })) offenders.push('🔴 providerId 미조회가 통과했다')
  // 🔴 판정을 여기서 다시 쓰지 않는다 — 정본과 같은 답이어야 한다
  for (const [label, acc] of [['0', 0], ['1', 1], ['null', null], ['NaN', Number.NaN], ['소수', 0.5]] as const) {
    const gate = !v({ personaAccountCount: acc as never }).ok
    const canon = judgeRealMember({ accountCount: acc as never, providerId: null }).real
    if (gate !== canon) offenders.push(`🔴 ${label}: 발행 게이트(${gate}) 와 정본(${canon}) 이 다르다`)
  }
  // 🔴 사유가 무엇인지 말한다 — 사람이 어느 쪽인지 알아야 한다
  const r = v({ personaAccountCount: 2 })
  if (r.ok || !r.detail.includes('Account')) offenders.push('차단 사유에 Account 가 없다')
  const u = v({ personaAccountCount: null })
  if (u.ok || !u.detail.includes('fail-closed')) offenders.push('모름 차단 사유에 fail-closed 가 없다')
  // 🔴 REAL_MEMBER 코드는 유지된다 — 사유만 정본에서 온다
  if (!blocked({ personaAccountCount: 1 })) offenders.push('REAL_MEMBER 코드가 유지되지 않았다')

  if (offenders.length) bad('🔴 발행 게이트 실회원 판별', offenders.join(' / '))
  else ok('🔴 발행 게이트 실회원 판별', 'Account 0 통과 · 1건 이상 차단 · 모름 fail-closed · providerId 방어 · 사유 표기')
}


console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
