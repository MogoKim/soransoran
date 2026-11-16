#!/usr/bin/env tsx
/**
 * Persona 목소리 댓글 — 순수 판정 시험 + 소스 계약
 *
 * 🔴 DB 를 켜지 않는다. 실제 저장과 "D100 영향 0" 은 operator-persona-voice-db-check 가 격리 Postgres 에서 본다.
 * 🔴 판정 모듈은 `OPERATOR_PERSONA_VOICE_MODULE` 로 바꿔 끼울 수 있다 — 변이 하네스가 사본을 넣는다.
 * 🔴 25시간이 자동 레인 정본 상수와 맞는지는 D100 상수를 **읽기만** 해서 확인한다(운영 코드는 D100 을 import 하지 않는다).
 *
 * 사용법: tsx scripts/operator-persona-voice-check.mts (operator:compose-check 사슬에 이어져 CI 에서 돈다)
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { AUTO_FIRST_COMMENT_WINDOW_MS } from '../src/lib/persona-comment-auto-lane'
import { FOLLOWUP_POST_AGE_MAX_MS } from '../src/lib/persona-comment-followup'

type Target = Record<string, unknown>
type Mod = {
  PERSONA_VOICE_AUTO_POST_MIN_AGE_MS: number
  pvCodeOf: (c: string) => string | null
  judgePersonaVoiceTarget: (f: Target, nowMs: number) => { ok: boolean; kind?: string; code?: string; opensAtMs?: number }
  judgePersonaVoiceSpeaker: (f: { code: string; status: string | null; pendingReports: number | null }) => { ok: boolean; code?: string; pvCode?: string }
  personaCardOf: (p: Record<string, unknown>) => { label: string; value: string }[]
}
const modulePath = process.env.OPERATOR_PERSONA_VOICE_MODULE ?? new URL('../src/lib/operator-persona-voice.ts', import.meta.url).pathname
const m = (await import(pathToFileURL(modulePath).href)) as Mod

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}

const H = 3_600_000
const NOW = Date.parse('2026-11-17T03:00:00Z') // KST 12:00
const base: Target = {
  status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
  boardType: 'FREE', personaId: null, operatorWriterId: null, publishedAt: new Date(NOW - 2 * H),
  authorAccountCount: 1, authorProviderId: null,
}
const verdict = (over: Target, now = NOW) => {
  const v = m.judgePersonaVoiceTarget({ ...base, ...over }, now)
  return v.ok ? `OK:${v.kind}` : v.code
}

console.log('\n① 25시간 경계 — 자동 레인 정본 상수와의 관계')
expect('최소 나이 = 25시간', m.PERSONA_VOICE_AUTO_POST_MIN_AGE_MS, 25 * H)
const lastAutoWrite = Math.max(AUTO_FIRST_COMMENT_WINDOW_MS, FOLLOWUP_POST_AGE_MAX_MS)
expect('🔴 25시간 ≥ 자동 레인 마지막 쓰기 나이(첫 댓글·추가 댓글 중 큰 쪽) + 첫 댓글 창 — D100 상수가 바뀌면 여기서 깨진다',
  m.PERSONA_VOICE_AUTO_POST_MIN_AGE_MS >= lastAutoWrite + AUTO_FIRST_COMMENT_WINDOW_MS, true)

console.log('\n② 대상 글')
expect('실회원 글(카카오 계정) → 바로', verdict({}), 'OK:member')
expect('운영자 이름 글 → 바로', verdict({ operatorWriterId: 'op1', authorAccountCount: 0 }), 'OK:operator')
const personaPost = { personaId: 'pz', authorAccountCount: 0, publishedAt: new Date(NOW - 25 * H + 1) }
const tooEarly = m.judgePersonaVoiceTarget({ ...base, ...personaPost }, NOW)
expect('Persona 자동 글 25시간−1ms → 아직 · 열리는 시각 = 공개+25h', [tooEarly.code, tooEarly.opensAtMs], ['TOO_EARLY', NOW + 1])
expect('Persona 자동 글 25시간 정각 → 됨(경계 포함)', verdict({ ...personaPost, publishedAt: new Date(NOW - 25 * H) }), 'OK:persona')
expect('Persona 자동 글 공개 시각 모름 → 막음', verdict({ ...personaPost, publishedAt: null }), 'TOO_EARLY')
expect('🔴 Micro Seed 는 Persona 판정보다 먼저(personaId 가 있어도)', verdict({ ...personaPost, isMicroSeed: true, publishedAt: new Date(NOW - 99 * H) }), 'MICRO_SEED')
expect('매거진 → 막음', verdict({ boardType: 'MAGAZINE' }), 'NOT_BOARD')
expect('숨김 글 → 막음', verdict({ status: 'HIDDEN' }), 'NOT_PUBLIC')
expect('🔴 글쓴이 계정 실측 누락 → 막음(어느 레인 글인지 모름)', verdict({ authorAccountCount: null }), 'UNKNOWN_AUTHOR')
expect('🔴 계정 없는 글쓴이(Persona·운영자 연결도 없음) → 막음', verdict({ authorAccountCount: 0 }), 'UNKNOWN_AUTHOR')

console.log('\n③ 말하는 Persona')
const sp = (over: Partial<{ code: string; status: string | null; pendingReports: number | null }>) => {
  const v = m.judgePersonaVoiceSpeaker({ code: 'P07', status: 'active', pendingReports: 0, ...over })
  return v.ok ? `OK:${v.pvCode}` : v.code
}
expect('active · 신고 0 → PV07', sp({}), 'OK:PV07')
expect('paused · retired · draft · 모름 → 막음', ['paused', 'retired', 'draft', null].map((s) => sp({ status: s })), ['NOT_ACTIVE', 'NOT_ACTIVE', 'NOT_ACTIVE', 'NOT_ACTIVE'])
expect('처리 대기 신고 1 → 막음', sp({ pendingReports: 1 }), 'PENDING_REPORT')
expect('🔴 신고 수를 못 셈(null) → 막음', sp({ pendingReports: null }), 'PENDING_REPORT')
expect('코드 형식 밖 → 막음', sp({ code: 'X07' }), 'BAD_CODE')
expect('pvCodeOf P07 · P100 · OP01 · P', [m.pvCodeOf('P07'), m.pvCodeOf('P100'), m.pvCodeOf('OP01'), m.pvCodeOf('P')], ['PV07', 'PV100', null, null])

console.log('\n④ 말투 카드 — 모르는 값은 —')
const card = m.personaCardOf({
  ageBand: '50대 초반', region: null, lifeStage: '', identity: { workStatus: '직장(정규)', personality: 42 }, voiceCore: 'not-an-object',
  noGoTopics: ['정치', ''], noGoExpressions: [],
})
const v = (label: string) => card.find((r) => r.label === label)?.value
expect('문자·빈 값·숫자·잘못된 JSON·배열', [v('나이대'), v('지역'), v('생활 단계'), v('일'), v('성격'), v('말투'), v('피하는 주제'), v('피하는 표현')],
  ['50대 초반', '—', '—', '직장(정규)', '42', '—', '정치', '—'])

// 소스 계약 — 실제 저장소 파일(주석 제거)
const code = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
console.log('\n⑤ 소스 계약')
{
  const action = code('src/lib/actions/operator-compose.ts')
  const fn = action.slice(action.indexOf('export async function createPersonaVoiceComment'), action.indexOf('export async function createOperatorReply'))
  expect('액션이 읽는 FormData 키 = personaId · postId · content · requestKey 넷뿐', [...fn.matchAll(/formData\.get\('([^']+)'\)/g)].map((x) => x[1]).sort(), ['content', 'personaId', 'postId', 'requestKey'])
  expect('진입점 하나 — createOperatorContent 가 mode=persona-voice 로 보낸다', /if \(mode === 'persona-voice'\) return createPersonaVoiceComment\(prev, formData\)/.test(action), true)
  const tx = code('src/lib/operator-persona-voice-tx.ts')
  expect('tx 입력에 작성자 칸(authorId · operatorWriterId · writerId) 없음', /export type CreatePersonaVoiceCommentInput = \{[^}]*\b(authorId|operatorWriterId|writerId)\b/.test(tx), false)
  expect('$transaction 1회 · /best 동기화 0', [(tx.match(/\$transaction\(/g) ?? []).length, /syncBestEligibility/.test(tx)], [1, false])
  expect('PV 확보 = createMany + skipDuplicates', /operatorWriter\.createMany\(\{[^)]*skipDuplicates: true/.test(tx), true)
  const at = (needle: string) => tx.indexOf(needle)
  expect('🔴 PV 확보는 모든 판정 뒤 · 댓글 저장 앞', at('judgeKstQuietWindow(') < at('operatorWriter.createMany(') && at('judgePersonaVoiceSpeaker(') < at('operatorWriter.createMany(')
    && at('judgePersonaVoiceTarget(') < at('operatorWriter.createMany(') && at('userBlock.count(') < at('operatorWriter.createMany(') && at('operatorWriter.createMany(') < at('comment.create('), true)
  const body = tx.slice(at('db.$transaction('), at('} catch (err)'))
  expect('🔴 거절은 throw 로만(콜백 안 blocked return 0 — return 하면 앞의 PV 행이 커밋된다)', /return \{ kind: 'blocked'/.test(body), false)
  expect('저장은 운영자 댓글 정본(build · assert)으로', /buildOperatorCommentData\(/.test(tx) && /assertOperatorCommentData\(data\)/.test(tx), true)
  expect('작성자 판정은 Persona 목소리 모드', /'persona',\s*\)/.test(tx), true)
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
