#!/usr/bin/env tsx
/**
 * Persona cohort seed materializer **실제 CLI** 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 · provider 0 (2026-10-08)
 *
 *   DATABASE_URL=postgresql://postgres@localhost:55442/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npm run persona:cohort-seed-db-check
 *
 * 실제 `persona-cohort-seed` 를 **자식 프로세스로** 돌린다 — 임시 cwd(출력 `tmp/` 가 저장소에 생기지 않게) ·
 * 임시 HOME 합성 말투 자산 · 가짜 fetch(호출 0 확인용) · 격리 DB.
 *
 * 🔴 같은 격리 DB 를 앞뒤 검사가 함께 쓴다 — **이 검사가 만든 행만** 만들고 바꾸고 지운다(이름 접두어).
 *    "운영 active cadence 없음" 반례는 다른 검사의 cadence 있는 active 행이 0 일 때만 성립한다 —
 *    있으면 건너뛰지 않고 FAIL 한다(그 수를 함께 적는다).
 *
 *   ① dry-run → 현재 runnable D30 cohort 전원 seed · lifeStage · 파일 0
 *   ② --write → 원자적 파일 · 권한 600 · cohort 전원 key · privacy · 같은 내용 재실행 no-op · 다른 내용 기존 파일 → 거부
 *   ②-b 🔴 기존 파일 권한 경계 — 같은 내용 0600 no-op · 같은 내용 0644 dry-run 거부 · --write 는 권한만 고침 ·
 *       다른 내용 0644 → 내용 · 권한 모두 그대로
 *   ③ 승인 D30 fixture SHA·카드·creative는 실제 CLI가 재검증하고,
 *      말투 세대(v1 → v2) 누락 · cadence 없음 → 파일 0
 *   🔴 모든 회차 DB write 0 · provider 요청 0
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE_URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(BASE_URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(BASE_URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}
const URL = BASE_URL
const REPO = process.cwd()

const { PrismaClient } = await import('@prisma/client')
const { writeFakePersonaAsset } = await import('./lib/fake-persona-asset.mjs')
const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
const { COHORTS, COHORT_EXPANSION_FIXTURES, PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { lifeStageOf } = await import('../src/lib/persona-autogen')
const { sha256Hex } = await import('./lib/persona-cohort-seed.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')
const { parseExpansionFixture } = await import('./lib/persona-expansion-gate.mjs')
type PersonaCreative = import('../src/lib/persona-autogen').PersonaCreative

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}

const prisma = new PrismaClient()
const counts = async (): Promise<Record<string, number>> => ({
  users: await prisma.user.count(), personas: await prisma.persona.count(), audits: await prisma.personaAuditLog.count(),
  posts: await prisma.post.count(), comments: await prisma.comment.count(), accounts: await prisma.account.count(),
  activity: await prisma.personaActivityLog.count(),
})
const same = (a: Record<string, number>, b: Record<string, number>): boolean => Object.keys(a).every((k) => a[k] === b[k])
const NAME_PREFIX = 'cohort-seed-check-'
/** 🔴 이 검사가 만든 행만 — 이름 접두어로 찾는다 */
async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { user: { name: { startsWith: NAME_PREFIX } } }, select: { id: true, userId: true } })
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: mine.map((m) => m.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { name: { startsWith: NAME_PREFIX }, accounts: { none: {} } } })
}

const COHORT = 'wave7-d30'
const CODES = COHORTS[COHORT].codes
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const card = (c: string) => pool.cards.find((x) => x.code === c)!
const expansionRef = COHORT_EXPANSION_FIXTURES[COHORT]!
const expansionRaw = readFileSync(join(REPO, expansionRef.path), 'utf-8')
if (sha256Hex(expansionRaw) !== expansionRef.sha256) throw new Error('D30 승인 fixture SHA가 manifest와 다르다')
const expansionParsed = parseExpansionFixture(expansionRaw)
if (!('fixture' in expansionParsed)) throw new Error(`D30 승인 fixture 판독 실패: ${expansionParsed.problems.join(' / ')}`)
const GOOD: Record<string, PersonaCreative> = Object.fromEntries(
  expansionParsed.fixture.candidates.map((candidate) => [candidate.code, candidate.creative]),
)

const T = mkdtempSync(join(tmpdir(), 'soran-cohort-seed-'))
const HOME_OK = join(T, 'home-ok')
const HOME_THIN = join(T, 'home-thin')
const HOME_NO_V1 = join(T, 'home-no-v1')
const HOME_NO_V2 = join(T, 'home-no-v2')
mkdirSync(HOME_OK); mkdirSync(HOME_THIN); mkdirSync(HOME_NO_V1); mkdirSync(HOME_NO_V2)
const BASE_CODES = PRODUCTION_PERSONA_CODES.slice(0, 30)
const V1_CODES = COHORTS['wave6-d20-canary'].codes
const asset = writeFakePersonaAsset({ home: HOME_OK, speakers: BASE_CODES.length })
// 🔴 보충 세대가 둘 다 없으면 canonical fallback은 base30뿐이라
// 기존 wave6 기준선부터 닫힌다. 화자 수를 늘려도 세대 snapshot을 대신할 수 없다.
writeFakePersonaAsset({ home: HOME_THIN, speakers: BASE_CODES.length })
const assetNoV1 = writeFakePersonaAsset({ home: HOME_NO_V1, speakers: BASE_CODES.length })
const assetNoV2 = writeFakePersonaAsset({ home: HOME_NO_V2, speakers: BASE_CODES.length })
const assetRows = (JSON.parse(readFileSync(asset.corpus, 'utf-8')) as { comments: { speakerId: string; content: string }[] }).comments
const assetManifest = JSON.parse(readFileSync(asset.manifest, 'utf-8')) as { sourceDigest: string }
// 현재 운영과 같은 세대 계약: canonical base30 → 동결 v1(+10) → active v2(+20).
// 임시 HOME의 합성 행만 쓰고 운영 자산은 읽지 않는다.
const { planSupplementSnapshot } = await import('./lib/persona-reference-supplement-plan.mjs')
const canonRows = assetRows.map((row) => ({ speakerId: row.speakerId, text: row.content }))
const extraRows = (prefix: string, codes: readonly string[]) => codes.flatMap((_, speakerIndex) => [
  { speakerId: `${prefix}-extra-${speakerIndex}`, text: `${speakerIndex + 1}번째 말벗처럼 차분히 읽어 보니 마음이 놓이네요 (${prefix})` },
  { speakerId: `${prefix}-extra-${speakerIndex}`, text: `${speakerIndex + 1}번째 말벗처럼 무리하지 말고 천천히 쉬어 가세요 (${prefix})` },
  { speakerId: `${prefix}-extra-${speakerIndex}`, text: `${speakerIndex + 1}번째 말벗처럼 서두르지 않아도 괜찮으니 편하게 나눠요 (${prefix})` },
])
const supplementV1 = planSupplementSnapshot({
  canonRows,
  extraRows: extraRows('v1', V1_CODES),
  baseCodes: BASE_CODES,
  newCodes: V1_CODES,
  baseSourceDigest: assetManifest.sourceDigest,
  saltId: 'c'.repeat(12),
  generatedAt: '2026-10-15T00:00:00.000Z',
  reason: 'fixture generation one',
})
if (!supplementV1.ok) throw new Error(`합성 v1 snapshot 계획 실패: ${supplementV1.problems.join(' / ')}`)
const supplementV2 = planSupplementSnapshot({
  canonRows,
  extraRows: extraRows('v2', CODES),
  baseCodes: BASE_CODES,
  newCodes: CODES,
  frozenBundles: supplementV1.asset.bundles,
  baseSourceDigest: assetManifest.sourceDigest,
  saltId: 'd'.repeat(12),
  generatedAt: '2026-11-14T00:00:00.000Z',
  reason: 'fixture generation two',
})
if (!supplementV2.ok) throw new Error(`합성 v2 snapshot 계획 실패: ${supplementV2.problems.join(' / ')}`)
writeFileSync(join(asset.dir, 'supplement-v1.json'), supplementV1.assetText, { mode: 0o600 })
writeFileSync(join(asset.dir, 'supplement-v1-manifest.json'), supplementV1.manifestText, { mode: 0o600 })
writeFileSync(join(asset.dir, 'supplement-v2.json'), supplementV2.assetText, { mode: 0o600 })
writeFileSync(join(asset.dir, 'supplement-v2-manifest.json'), supplementV2.manifestText, { mode: 0o600 })
// 🔴 세대별 누락을 각각 재현한다. 둘 다 없는 HOME_THIN 하나로는
// v1 baseline 누락과 v2 target 누락을 구분해 검증할 수 없다.
writeFileSync(join(assetNoV1.dir, 'supplement-v2.json'), supplementV2.assetText, { mode: 0o600 })
writeFileSync(join(assetNoV1.dir, 'supplement-v2-manifest.json'), supplementV2.manifestText, { mode: 0o600 })
writeFileSync(join(assetNoV2.dir, 'supplement-v1.json'), supplementV1.assetText, { mode: 0o600 })
writeFileSync(join(assetNoV2.dir, 'supplement-v1-manifest.json'), supplementV1.manifestText, { mode: 0o600 })
// 🔴 임시 cwd — 출력 `tmp/` 가 저장소에 생기지 않는다. 정본 Pool 문서만 그대로 연결한다
const CWD = join(T, 'cwd')
mkdirSync(join(CWD, 'docs'), { recursive: true })
symlinkSync(join(REPO, 'docs', 'operations'), join(CWD, 'docs', 'operations'))
mkdirSync(join(CWD, 'scripts', '__fixtures__'), { recursive: true })
const CWD_EXPANSION_FIXTURE = join(CWD, expansionRef.path)
symlinkSync(join(REPO, expansionRef.path), CWD_EXPANSION_FIXTURE)
const OUT = join(CWD, 'tmp', `persona-${COHORT}-seed.json`)

const cli = (args: string[], home = HOME_OK) => {
  const log = join(T, `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  writeFileSync(log, '')
  const run = spawnSync('npx', ['tsx', join(REPO, 'scripts', 'persona-cohort-seed.mts'), `--cohort=${COHORT}`, ...args], {
    cwd: CWD, encoding: 'utf-8', timeout: 300_000,
    env: {
      ...process.env, HOME: home, DATABASE_URL: URL,
      NODE_OPTIONS: `--import=${join(REPO, 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
      FAKE_PROVIDER_LOG: log,
    },
  })
  const requests = readFileSync(log, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}`, requests }
}
const tmpLeft = (): string[] => (existsSync(join(CWD, 'tmp')) ? readdirSync(join(CWD, 'tmp')).filter((f) => f.includes('.tmp-')) : [])

console.log('\n══ Persona cohort seed — 실제 CLI · 격리 DB · 임시 cwd · 가짜 fetch ══\n')
try {
  await cleanup()
  // 운영 cadence 표본 — active Persona 1행(격리 DB 에 비어 있는 production 코드 — 운영에 실제로 있는 모양)
  const present = new Set((await prisma.persona.findMany({ select: { code: true } })).map((r) => r.code))
  const CADENCE_CODE = PRODUCTION_PERSONA_CODES.find((c) => !present.has(c) && !CODES.includes(c)) ?? ''
  check('준비 — 비어 있는 production 코드로 cadence 행', CADENCE_CODE !== '')
  const u = await prisma.user.create({ data: { name: `${NAME_PREFIX}${Date.now().toString(36)}` }, select: { id: true } })
  await prisma.persona.create({ data: {
    code: CADENCE_CODE, userId: u.id, status: 'active', dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
  } })
  const b0 = await counts()

  // ── ① dry-run ──
  console.log('① dry-run')
  const d = cli([])
  check('CLI 종료 0', d.status === 0, d.out.slice(-600))
  check('🔴 반례 12 — --write 없음 → 파일 0', !existsSync(OUT) && /dry-run — 파일 0/.test(d.out))
  check(`🔴 반례 1 — ${CODES.length}명 전원 verifySeedCard ✅`, CODES.every((c) => new RegExp(`^  ${c}  .*verifySeedCard ✅`, 'm').test(d.out)) && !/불일치/.test(d.out))
  check('🔴 반례 2~5 — 출력 lifeStage = lifeStageOf(카드)', CODES.every((c) => new RegExp(`^  ${c}  ${lifeStageOf(card(c))} `, 'm').test(d.out)))
  check(`말투 묶음 ${CODES.length}/${CODES.length} · 기존 production 배정 drift 0`, new RegExp(`말투 묶음 ${CODES.length}/${CODES.length} · 기존 production ${PRODUCTION_PERSONA_CODES.length - CODES.length}명 배정 drift 0`).test(d.out))

  // ── ② --write ──
  console.log('② --write')
  const w = cli(['--write'])
  check('CLI 종료 0', w.status === 0, w.out.slice(-400))
  const raw = existsSync(OUT) ? readFileSync(OUT, 'utf-8') : ''
  const seeds = raw === '' ? {} : JSON.parse(raw) as Record<string, Record<string, unknown>>
  check(`🔴 반례 13 — 파일 생성 · 권한 600 · 정확히 ${CODES.length}키 · 임시 파일 0`, raw !== '' && (statSync(OUT).mode & 0o777) === 0o600
    && JSON.stringify(Object.keys(seeds)) === JSON.stringify(CODES) && tmpLeft().length === 0, `${raw === '' ? '파일 없음' : (statSync(OUT).mode & 0o777).toString(8)}`)
  check('출력 digest = 파일 sha256', w.out.includes(`digest ${sha256Hex(raw)}`))
  check('seed lifeStage = lifeStageOf(카드) · 카드 제목 아님', CODES.every((c) => seeds[c]?.lifeStage === lifeStageOf(card(c)) && seeds[c]?.lifeStage !== card(c).title))
  check('variations = 승인 creative 그대로', CODES.every((c) => JSON.stringify(seeds[c]?.voiceVariations) === JSON.stringify(GOOD[c]!.variations)))
  check('🔴 privacy — 합성 자산 댓글 원문 · 화자 id 0', raw !== '' && !assetRows.some((r) => raw.includes(r.content) || raw.includes(r.speakerId)))
  // ── ②-b 기존 파일 권한 경계 ──
  console.log('②-b 🔴 기존 파일 권한 경계')
  const modeOf = (): number => statSync(OUT).mode & 0o777
  const mtime = existsSync(OUT) ? statSync(OUT).mtimeMs : 0
  const again = cli(['--write'])
  check('🔴 권한 반례 1 — 같은 내용 + 0600 → 성공 · no-op · 내용 · mtime 불변', again.status === 0 && /이미 같은 내용이다/.test(again.out)
    && statSync(OUT).mtimeMs === mtime && readFileSync(OUT, 'utf-8') === raw && modeOf() === 0o600)
  chmodSync(OUT, 0o644)
  const mtime644 = statSync(OUT).mtimeMs
  const permDry = cli([])
  check('🔴 권한 반례 2 — 같은 내용 + 0644 + dry-run → exit 1 · [OUTPUT_PERMISSION] · 내용 · 권한 · mtime 불변',
    permDry.status === 1 && /\[OUTPUT_PERMISSION\]/.test(permDry.out) && readFileSync(OUT, 'utf-8') === raw && modeOf() === 0o644
    && statSync(OUT).mtimeMs === mtime644, `${modeOf().toString(8)} · ${permDry.out.split('\n').find((l) => l.includes('[')) ?? ''}`)
  const permFix = cli(['--write'])
  check('🔴 권한 반례 3 — 같은 내용 + 0644 + --write → 내용 다시 쓰지 않음(mtime 불변) · 권한 0600 · 임시 파일 0',
    permFix.status === 0 && /권한 644 → 600/.test(permFix.out) && readFileSync(OUT, 'utf-8') === raw && modeOf() === 0o600
    && statSync(OUT).mtimeMs === mtime644 && tmpLeft().length === 0, `${modeOf().toString(8)} · ${permFix.out.slice(-200)}`)
  const other = `${raw.trimEnd().slice(0, -1)},"note":"다른 실행"}\n`
  writeFileSync(OUT, other)
  chmodSync(OUT, 0o644)
  const conflict = cli(['--write'])
  check('🔴 권한 반례 4 — 다른 내용 + 0644 + --write → exit 1 · [OUTPUT_CONFLICT] · 내용 · 권한 모두 불변',
    conflict.status === 1 && /\[OUTPUT_CONFLICT\]/.test(conflict.out) && readFileSync(OUT, 'utf-8') === other && modeOf() === 0o644 && tmpLeft().length === 0)
  rmSync(join(CWD, 'tmp'), { recursive: true, force: true })

  // ── ③ fail-closed — 전부 파일 0 ──
  console.log('③ 🔴 fail-closed → 파일 0')
  const bad = (label: string, run: ReturnType<typeof cli>, tag: string): void =>
    check(`🔴 ${label} → exit 1 · [${tag}] · 파일 0 · provider 0`, run.status === 1 && run.out.includes(`[${tag}]`) && !existsSync(OUT) && run.requests === 0,
      run.out.split('\n').filter((l) => l.includes('[')).slice(0, 2).join(' | ').slice(0, 300))
  // 승인 fixture의 실제 CLI 분기까지 검증한다. 저장소 fixture는 건드리지 않고
  // 임시 CWD의 symlink만 변조 사본으로 잠깐 바꾼 뒤 즉시 복원한다.
  rmSync(CWD_EXPANSION_FIXTURE)
  writeFileSync(CWD_EXPANSION_FIXTURE, `${expansionRaw}\n`)
  bad('반례 6a — 승인 fixture SHA 불일치', cli(['--write']), 'CREATIVE_SHA_MISMATCH')
  rmSync(CWD_EXPANSION_FIXTURE)
  symlinkSync(join(REPO, expansionRef.path), CWD_EXPANSION_FIXTURE)
  bad('반례 6b — 말투 v1 baseline 누락(v2만 있음)', cli(['--write'], HOME_NO_V1), 'VOICE_BASELINE_MISSING')
  bad('반례 6c — 말투 v2 target 누락(v1만 있음)', cli(['--write'], HOME_NO_V2), 'VOICE_BUNDLE_MISSING')
  bad('반례 6d — 말투 v1·v2 모두 누락(합성 자산만 있음)', cli(['--write'], HOME_THIN), 'VOICE_BASELINE_MISSING')
  const mineOnly = { user: { name: { startsWith: NAME_PREFIX } } }
  await prisma.persona.updateMany({ where: mineOnly, data: { status: 'paused' } })
  const foreign = await prisma.persona.count({ where: { status: 'active', dailyCap: { not: null }, weeklyCap: { not: null }, silenceRate: { not: null } } })
  check('반례 11 전제 — 이 검사 밖 cadence 있는 active 행 0', foreign === 0, `${foreign}행 — 다른 검사가 남긴 행이다`)
  bad('반례 7 — 운영 active cadence 없음', cli(['--write']), 'CADENCE_UNMEASURED')
  await prisma.persona.updateMany({ where: mineOnly, data: { status: 'active' } })

  // ── 전 회차 ──
  console.log('④ 🔴 전 회차')
  const all = [d, w, again, permDry, permFix, conflict]
  check('🔴 반례 14 — 모든 회차 provider 요청 0', all.every((r) => r.requests === 0))
  check('🔴 반례 14 — 모든 회차 DB write 0 (Persona · User · 감사 · Post · Comment · Account · 활동)', same(b0, await counts()))
} finally {
  await cleanup()
  await prisma.$disconnect()
  rmSync(T, { recursive: true, force: true })
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail`)
console.log('🔴 격리 DB(이 검사 행만) · 임시 cwd · 임시 HOME 합성 말투 자산 · 가짜 fetch · 운영 DB 0 · 유료 호출 0')
process.exit(failN === 0 ? 0 : 1)
