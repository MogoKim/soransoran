#!/usr/bin/env tsx
/**
 * Persona creative 생성 **실제 CLI** 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 · 유료 호출 0 (2026-10-06)
 *
 *   DATABASE_URL=postgresql://postgres@localhost:55442/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npm run persona:creative-db-check
 *
 * 실제 `persona-autogen --db --generate-creative` 를 **자식 프로세스로** 돌린다 — 격리 DB · 임시 HOME 의
 * 합성 말투 자산 · 가짜 fetch(`fake-provider-hook`). 운영 자산 · 운영 DB · 실제 provider 0.
 *
 *   ① 생성 → 가짜 creative 로 운영 판정 그대로 valid · 호출 수 = 생성 대상 수 · 결과 파일 = --supplement 모양
 *   ② 🔴 나간 요청 본문 — 합성 말투 자산의 댓글 원문 0 · 표시명 0 · 화자 id 0
 *   ③ 🔴 형식이 깨진 응답 → 전원 CREATIVE_INVALID · valid 0 · 재시도 0
 *   ④ 결과 파일을 --supplement 로 다시 판정 → 같은 valid · provider 0
 *   ⑤ 🔴 부르기 전 probe 판정 — 운영 cadence 가 seed 검증을 깨면(렌더 뒤에야 드러난다) provider 0
 *   🔴 모든 회차 DB write 0 (Persona · User · 감사 · Post · Comment · Account)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

const { PrismaClient } = await import('@prisma/client')
const { writeFakePersonaAsset } = await import('./lib/fake-persona-asset.mjs')
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
})
const same = (a: Record<string, number>, b: Record<string, number>): boolean => Object.keys(a).every((k) => a[k] === b[k])

/** 🔴 합성 creative — 코드마다 다른 사람이다(운영 판정의 겹침 검사를 통과해야 fixture 가 실제보다 약하지 않다) */
const TITLES = ['혼자 가게 지키며 두 아이', '사별 뒤 직장과 간병 사이', '전업으로 다 큰 자식들 곁에', '혼자 살며 부모님 돌봄',
  '자식 둘 키워 낸 뒤 늦은 간병', '일하며 혼자 사는 오십 대', '따로 살며 손주 이야기', '가게 접고 간병하는 요즘']
const PERS = [['꼼꼼함', '말수 적음', '현실적'], ['참을성 있음', '담담함', '정 많음'], ['느긋함', '잘 웃음', '눈치 빠름'],
  ['독립적', '조용함', '책임감 강함'], ['걱정 많음', '다정함', '부지런함'], ['솔직함', '털털함', '계획적'],
  ['차분함', '살가움', '기억력 좋음'], ['씩씩함', '고집 있음', '손이 큼']]
const creativeOf = (i: number): PersonaCreative => ({
  title: TITLES[i]!,
  personality: PERS[i]!,
  noGoTopics: [`fixture 소재 ${i}가`, `fixture 소재 ${i}나`],
  noGoExpressions: [`"fixture 말버릇 ${i}" 류`],
  variations: ['짧은 공감', '되묻기', '한 줄', '경험 나눔', `fixture 변주 ${i}`],
})
const CODES = ['P26', 'P27', 'P28', 'P29', 'P30', 'P31', 'P32', 'P33']
const CADENCE_CODE = 'P47'
const NAME_PREFIX = 'creative-check-'
async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: CADENCE_CODE, user: { name: { startsWith: NAME_PREFIX } } }, select: { id: true, userId: true } })
  await prisma.persona.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: mine.map((m) => m.userId) } } })
}

const T = mkdtempSync(join(tmpdir(), 'soran-creative-db-'))
const asset = writeFakePersonaAsset({ home: T, speakers: 40 })
const assetTexts = (JSON.parse(readFileSync(asset.corpus, 'utf-8')) as { comments: { speakerId: string; content: string }[] }).comments
const creativeFile = join(T, 'fake-creative.json')
writeFileSync(creativeFile, JSON.stringify(Object.fromEntries(CODES.map((c, i) => [c, creativeOf(i)]))))

const cli = (args: string[], extraEnv: Record<string, string>) => {
  const log = join(T, `fetch-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  const bodies = join(T, `body-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  writeFileSync(log, '')
  writeFileSync(bodies, '')
  const run = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', ...args], {
    encoding: 'utf-8', timeout: 300_000,
    env: {
      ...process.env, HOME: T,
      // 🔴 키 값이 아니다 — 가짜 fetch 가 가로챈다. 키가 없으면 유료 경로가 NO_API_KEY 로 끝나 생성 경로를 못 본다
      ANTHROPIC_API_KEY: 'fixture-not-a-key',
      NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
      FAKE_PROVIDER_LOG: log, FAKE_PROVIDER_BODY_LOG: bodies, ...extraEnv,
    },
  })
  const paid = readFileSync(log, 'utf-8').split('\n').filter((l) => l.startsWith('paid')).length
  const sent = readFileSync(bodies, 'utf-8').split('\n').filter((l) => l.trim() !== '')
  return { run, out: `${run.stdout ?? ''}${run.stderr ?? ''}`, paid, sent }
}
const validOf = (out: string): number => Number(/valid (\d+) · quarantined/.exec(out)?.[1] ?? '-1')
const statusOf = (out: string, code: string): string => new RegExp(`^  ${code}  (\\S+)`, 'm').exec(out.split('── 후보 판정')[1] ?? '')?.[1] ?? ''

console.log('\n══ Persona creative 생성 — 실제 CLI · 격리 DB · 가짜 provider ══\n')
try {
  // ── 준비 — cadence 표본이 될 active Persona 1행(격리 DB) ──
  //    🔴 같은 격리 DB 를 앞뒤 검사가 함께 쓴다 — **이 검사가 만든 행만** 만들고 지운다(P47 · 생성 대상 P26~P33 밖)
  await cleanup()
  const u = await prisma.user.create({ data: { name: `${NAME_PREFIX}${Date.now().toString(36)}` }, select: { id: true } })
  await prisma.persona.create({ data: {
    code: CADENCE_CODE, userId: u.id, status: 'active', dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
  } })

  // ── ① 생성 ──
  console.log('① 생성 → 운영 판정 그대로')
  const out1 = join(T, 'creative-1.json')
  const b1 = await counts()
  const g = cli(['--db', '--count=8', '--generate-creative', `--creative-out=${out1}`], { FAKE_PROVIDER_CREATIVE_FILE: creativeFile })
  check('CLI 종료 코드 0', g.run.status === 0, g.out.slice(-600))
  const generated = CODES.filter((c) => new RegExp(`^  ${c}  generated`, 'm').test(g.out))
  const skipped = /부르지 않은 후보 — creative 말고 다른 이유로 막혔다: (.*)$/m.exec(g.out)?.[1] ?? ''
  check('🔴 fixture 가 생성 경로를 실제로 탄다 — 생성 대상 ≥ 1', generated.length >= 1, g.out.split('── creative 생성')[1]?.slice(0, 600) ?? g.out.slice(-400))
  check('🔴 호출 수 = 생성 대상 수 (재시도 0)', g.paid === generated.length, `paid ${g.paid} · generated ${generated.length}`)
  check('creative 말고 다른 이유로 막힌 후보는 부르지 않는다', generated.every((c) => !skipped.includes(c)))
  check('생성 대상 + 부르지 않은 후보 = 전체 후보', generated.length + skipped.split(' ').filter(Boolean).length === CODES.length, skipped)
  check('생성된 후보는 전부 운영 판정 valid', generated.every((c) => statusOf(g.out, c) === 'valid'),
    (g.out.split('── 후보 판정')[1] ?? '').split('\n').filter((l) => /^  P\d\d  /.test(l)).join(' | '))
  check('valid 수 = 생성 수', validOf(g.out) === generated.length, String(validOf(g.out)))
  const file = existsSync(out1) ? JSON.parse(readFileSync(out1, 'utf-8')) as Record<string, PersonaCreative> : {}
  check('결과 파일 = 생성된 코드만 · --supplement 모양', JSON.stringify(Object.keys(file).sort()) === JSON.stringify(generated)
    && generated.every((c) => file[c]?.title === creativeOf(CODES.indexOf(c)).title))
  check('장부 줄이 호출 수 · 비용을 적는다', new RegExp(`호출 ${generated.length}회 · 입력 \\d+ tok · 출력 \\d+ tok · 실제 비용 \\$0\\.\\d{4}`).test(g.out))
  check('🔴 ① 회차 DB write 0', same(b1, await counts()))

  // ── ② 나간 요청 본문 ──
  console.log('② 🔴 나간 요청 본문 — 원문 · 화자 · 표시명 0')
  const bodies = g.sent.map((l) => (JSON.parse(l) as { body: string }).body).join('\n')
  const leaked = assetTexts.filter((c) => bodies.includes(c.content)).length
  check('나간 요청 수 = 호출 수', g.sent.length === g.paid)
  check('🔴 합성 말투 자산 댓글 원문 0건', leaked === 0, `${leaked}건`)
  check('🔴 화자 id 0건', !assetTexts.some((c) => bodies.includes(c.speakerId)))
  const names = [...g.out.matchAll(/표시명[^\n]*/g)].map((m) => m[0])
  check('🔴 표시명 · 회원 이름 칸 0 (displayName · name 키 없음)', !/displayName|"name"/.test(bodies), names.join(' '))

  // ── ③ 형식이 깨진 응답 ──
  console.log('③ 🔴 형식이 깨진 응답 → fail-closed')
  const out3 = join(T, 'creative-3.json')
  const b3 = await counts()
  const bad = cli(['--db', '--count=8', '--generate-creative', `--creative-out=${out3}`], {})
  check('CLI 종료 코드 0', bad.run.status === 0, bad.out.slice(-400))
  check('🔴 valid 0', validOf(bad.out) === 0, String(validOf(bad.out)))
  check('🔴 같은 대상 수만큼만 불렀다 (재시도 0)', bad.paid === generated.length, `paid ${bad.paid}`)
  check('🔴 생성 대상 전원 CREATIVE_INVALID', generated.every((c) => new RegExp(`^  ${c}  quarantined[^\\n]*CREATIVE_INVALID`, 'm').test(bad.out.split('── 후보 판정')[1] ?? '')))
  check('결과 파일에 creative 0', existsSync(out3) && Object.keys(JSON.parse(readFileSync(out3, 'utf-8'))).length === 0)
  check('🔴 ③ 회차 DB write 0', same(b3, await counts()))

  // ── ④ --supplement 로 다시 판정 ──
  console.log('④ 결과 파일을 --supplement 로 — provider 0')
  const b4 = await counts()
  const sup = cli(['--db', '--count=8', `--supplement=${out1}`], {})
  check('CLI 종료 코드 0', sup.run.status === 0, sup.out.slice(-400))
  check('🔴 provider 요청 0', sup.paid === 0)
  check('같은 valid 수', validOf(sup.out) === generated.length, String(validOf(sup.out)))
  check('🔴 ④ 회차 DB write 0', same(b4, await counts()))

  // ── ⑤ probe 판정 — 카드를 렌더해야 드러나는 creative 무관 막힘 ──
  console.log('⑤ 🔴 부르기 전 probe 판정 — 렌더 뒤에야 드러나는 막힘에 돈을 쓰지 않는다')
  //    운영 cadence 최빈값이 seed 검증(dailyCap 1~10)을 깨면 전원 SEED_INVALID 다. creative 와 무관하고,
  //    creative 없이 판정하면 카드 렌더 전에 멈춰 보이지 않는다 — probe 가 그것을 부르기 전에 잡는가
  await prisma.persona.updateMany({ where: { code: CADENCE_CODE, user: { name: { startsWith: NAME_PREFIX } } }, data: { dailyCap: 11 } })
  const out5 = join(T, 'creative-5.json')
  const b5 = await counts()
  const pr = cli(['--db', '--count=8', '--generate-creative', `--creative-out=${out5}`], { FAKE_PROVIDER_CREATIVE_FILE: creativeFile })
  const skipped5 = /부르지 않은 후보 — creative 말고 다른 이유로 막혔다: (.*)$/m.exec(pr.out)?.[1] ?? ''
  check('CLI 종료 코드 0', pr.run.status === 0, pr.out.slice(-400))
  check('🔴 provider 요청 0', pr.paid === 0, `paid ${pr.paid}`)
  check('🔴 전원 SEED_INVALID 로 부르지 않았다', CODES.every((c) => new RegExp(`${c}\\([^)]*SEED_INVALID`).test(skipped5)), skipped5)
  check('valid 0', validOf(pr.out) === 0)
  check('🔴 ⑤ 회차 DB write 0', same(b5, await counts()))
} finally {
  await cleanup()
  await prisma.$disconnect()
  rmSync(T, { recursive: true, force: true })
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail`)
console.log('🔴 격리 DB · 임시 HOME 합성 말투 자산 · 가짜 fetch · 운영 DB 0 · 유료 호출 0')
process.exit(failN === 0 ? 0 : 1)
