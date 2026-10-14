#!/usr/bin/env tsx
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  captureVoiceEvidence, evidenceRowProblems, memberKeyOf, readEvidenceSalt, rowsFromVoiceEvidence,
  speakerHashOf, type VoiceEvidenceRow,
} from './lib/voice-evidence-capture.mjs'
import { purgeVoiceEvidence } from './lib/voice-evidence-retention.mjs'
import { readVoiceEvidenceStatus } from './lib/voice-evidence-status.mjs'

let passed = 0
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { passed += 1; console.log(`  PASS ${name}`); return }
  failed += 1
  console.error(`  FAIL ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const now = new Date('2026-10-15T00:00:00.000Z')
const saltValue = 'voice-evidence-test-salt-0123456789abcdef'
const salt = readEvidenceSalt({ SORAN_VOICE_EVIDENCE_SALT: saltValue })
const otherSalt = readEvidenceSalt({ SORAN_VOICE_EVIDENCE_SALT: `${saltValue}-rotated` })
check('salt missing fails closed', readEvidenceSalt({}).ok === false)
check('short salt fails closed', readEvidenceSalt({ SORAN_VOICE_EVIDENCE_SALT: 'short' }).ok === false)
check('valid salt accepted', salt.ok)

const safeText = '그러게요, 이 부분은 다시 생각해 볼 만하네요.'
const author = '바람꽃'
const captured = captureVoiceEvidence({
  source: 'navercafe:test', articleId: '100', runId: 'run-1', now,
  comments: [{ author, text: safeText }],
}, salt)
check('safe public comment captured', captured.stored && captured.rows.length === 1, captured.code)
const row = captured.rows[0]!
check('stored row contains no raw author', !JSON.stringify(row).includes(author))
check('stored row contract passes', evidenceRowProblems(row, [author]).length === 0)
check('speaker HMAC deterministic', salt.ok
  && speakerHashOf(salt.salt, 'navercafe:test', author) === speakerHashOf(salt.salt, 'navercafe:test', author))
check('speaker HMAC is source scoped', salt.ok
  && speakerHashOf(salt.salt, 'navercafe:test', author) !== speakerHashOf(salt.salt, 'navercafe:other', author))
check('member HMAC is source independent', salt.ok
  && row.memberKey === memberKeyOf(salt.salt, author))

const piiTexts = [
  '연락은 010-1234-5678로 주시면 자세히 알려드릴게요.',
  '메일은 sample@example.com 으로 보내 주세요.',
  '서울 강남구 역삼동으로 오시면 바로 찾을 수 있어요.',
  '카 톡 아이디 알려드릴 테니 거기로 이야기해요.',
]
for (const [index, text] of piiTexts.entries()) {
  const result = captureVoiceEvidence({
    source: 'navercafe:test', articleId: String(200 + index), runId: 'run-pii', now,
    comments: [{ author: `작성자${index}`, text }],
  }, salt)
  check(`PII variant ${index + 1} blocked`, result.rows.length === 0)
}
const experience = captureVoiceEvidence({
  source: 'navercafe:test', articleId: '300', runId: 'run-exp', now,
  comments: [{ author: '해바라기', text: '저도 작년에 같은 일을 겪어서 한동안 정말 힘들었어요.' }],
}, salt)
check('lived experience is not retained as quote', experience.rows.length === 0)
const placeholder = captureVoiceEvidence({
  source: 'navercafe:test', articleId: '301', runId: 'run-placeholder', now,
  comments: [{ author: '해바라기', text: '삭제된 댓글입니다.' }],
}, salt)
check('deleted placeholder blocked', placeholder.rows.length === 0)

const readOk = rowsFromVoiceEvidence([row], { salt, members: { memberNames: [], personaNames: [] }, now })
check('valid row is readable', readOk.rows.length === 1)
const readMember = rowsFromVoiceEvidence([row], { salt, members: { memberNames: [author] }, now })
check('real member exact match excluded', readMember.rows.length === 0 && readMember.dropped.REAL_MEMBER_SPEAKER === 1)
const readNormalizedMember = rowsFromVoiceEvidence([row], { salt, members: { memberNames: ['바람 꽃'] }, now })
check('member exclusion uses N2 normalization', readNormalizedMember.rows.length === 0
  && readNormalizedMember.dropped.REAL_MEMBER_SPEAKER === 1)
const readPersona = rowsFromVoiceEvidence([row], { salt, members: { memberNames: [], personaNames: [author] }, now })
check('Persona exact match excluded', readPersona.rows.length === 0 && readPersona.dropped.REAL_MEMBER_SPEAKER === 1)
const splitIdentity: VoiceEvidenceRow = {
  ...row,
  articleId: '101',
  memberKey: `${row.memberKey.slice(0, -1)}${row.memberKey.endsWith('0') ? '1' : '0'}`,
}
const readWholeSpeaker = rowsFromVoiceEvidence([row, splitIdentity], { salt, members: { memberNames: [author] }, now })
check('one member match excludes every row from that speaker', readWholeSpeaker.rows.length === 0
  && readWholeSpeaker.dropped.REAL_MEMBER_SPEAKER === 2)
const readUnknownMembers = rowsFromVoiceEvidence([row], { salt, members: null, now })
check('member set unavailable fails closed', readUnknownMembers.rows.length === 0
  && readUnknownMembers.dropped.REAL_MEMBER_UNMEASURED === 1)
const readRotated = rowsFromVoiceEvidence([row], { salt: otherSalt, members: { memberNames: [] }, now })
check('salt rotation blocks old evidence', readRotated.rows.length === 0 && readRotated.dropped.SALT_ROTATED === 1)
const oldRow: VoiceEvidenceRow = { ...row, capturedAt: '2026-07-01T00:00:00.000Z' }
const readExpired = rowsFromVoiceEvidence([oldRow], { salt, members: { memberNames: [] }, now })
check('90 day retention blocks expired evidence', readExpired.rows.length === 0 && readExpired.dropped.EXPIRED === 1)
const readMalformed = rowsFromVoiceEvidence([{ ...row, rawAuthor: author }], {
  salt, members: { memberNames: [] }, now,
})
check('unexpected row field is malformed', readMalformed.rows.length === 0 && readMalformed.dropped.MALFORMED === 1)

const temp = mkdtempSync(join(tmpdir(), 'voice-evidence-check-'))
const missingPlan = purgeVoiceEvidence({ dataDir: join(temp, 'missing'), now, execute: false })
check('missing evidence directory is an empty dry-run', missingPlan.totals.files === 0 && !missingPlan.executed)
const oldPath = join(temp, 'navercafe-voice-test-old.voice-evidence.jsonl')
const mixedPath = join(temp, 'navercafe-voice-test-mixed.voice-evidence.jsonl')
const unrelatedPath = join(temp, 'other.jsonl')
const symlinkTarget = join(temp, 'outside.txt')
const symlinkPath = join(temp, 'navercafe-voice-test-link.voice-evidence.jsonl')
const eligiblePath = join(temp, 'navercafe-voice-test-eligible.voice-evidence.jsonl')
const insecurePath = join(temp, 'navercafe-voice-test-insecure.voice-evidence.jsonl')
writeFileSync(oldPath, `${JSON.stringify(oldRow)}\n`, { mode: 0o600 })
writeFileSync(mixedPath, `${JSON.stringify(oldRow)}\nnot-json\n${JSON.stringify(row)}\n`, { mode: 0o600 })
writeFileSync(unrelatedPath, 'leave-me\n')
writeFileSync(symlinkTarget, 'outside\n')
symlinkSync(symlinkTarget, symlinkPath)
const eligibleRows = [
  { ...row, articleId: '401', text: '그러게요, 찬찬히 다시 보면 답이 보일 것 같아요.' },
  { ...row, articleId: '402', text: '맞아요, 서두르지 말고 하나씩 살펴보면 좋겠네요.' },
  { ...row, articleId: '403', text: '저도 같은 생각이에요, 설명이 참 이해하기 쉽네요.' },
]
writeFileSync(eligiblePath, eligibleRows.map((value) => `${JSON.stringify(value)}\n`).join(''), { mode: 0o600 })
writeFileSync(insecurePath, `${JSON.stringify(row)}\n`, { mode: 0o600 })
chmodSync(insecurePath, 0o644)
const status = readVoiceEvidenceStatus({ dataDir: temp, salt, members: { memberNames: [] }, now })
check('status counts only secure regular evidence files', status.insecureFiles === 1 && status.files === 4)
check('status reports newly eligible stable speaker', status.eligible === 1 && status.nearMiss === 0)
const dry = purgeVoiceEvidence({ dataDir: temp, now, execute: false })
check('purge defaults to a write-free plan', !dry.executed && dry.totals.expired === 2 && dry.totals.malformed === 1
  && readFileSync(mixedPath, 'utf8').split('\n').filter(Boolean).length === 3)
const applied = purgeVoiceEvidence({ dataDir: temp, now, execute: true })
check('expired-only file deleted', applied.totals.deletedFiles === 1)
check('mixed file drops expired and malformed rows', readFileSync(mixedPath, 'utf8').split('\n').filter(Boolean).length === 1)
check('rewritten evidence remains mode 0600', (statSync(mixedPath).mode & 0o777) === 0o600)
check('unrelated file untouched', readFileSync(unrelatedPath, 'utf8') === 'leave-me\n')
check('matching symlink is not followed', readFileSync(symlinkTarget, 'utf8') === 'outside\n')

const collector = readFileSync(new URL('./micro-seed-collect-navercafe.mts', import.meta.url), 'utf8')
const gated = collector.slice(collector.indexOf('if (THIN && evidenceSalt.ok)'), collector.indexOf('console.log(`  ✅', collector.indexOf('if (THIN && evidenceSalt.ok)')))
const reader = collector.slice(collector.indexOf('async function readArticleComments'), collector.indexOf('\nmain()', collector.indexOf('async function readArticleComments')))
check('collector reads comments only inside thin plus salt gate', gated.includes('readArticleComments(page)'))
check('comment reader performs no navigation', !reader.includes('.goto(') && !reader.includes('guardedNavigate'))
check('collector writes evidence with restricted mode', collector.includes('writeSecureJsonl(evidencePath, keptEvidence)')
  && collector.includes('mode: 0o600'))
check('collector never logs comment text or raw author', !gated.includes('.text}') && !gated.includes('.author}'))

rmSync(temp, { recursive: true, force: true })
console.log(`\nvoice-evidence-capture-check: ${passed} pass / ${failed} fail`)
if (failed > 0) process.exit(1)
